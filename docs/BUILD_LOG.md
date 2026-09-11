****# SENTINEL Build Log

Step-gated per `SENTINEL_BUILD_SPEC.md` Section 3. Each step records its acceptance
evidence. No step starts before the previous one is confirmed.

---

## 3.1 — Repo scaffold + Docker Compose — **PASSED**

Built:

- Repo tree exactly per spec Section 2 (`ml/`, `api/`, `docs/`, artifact + test dirs).
- `docker-compose.yml` — four services: `db` (postgres:16), `redis` (redis:7-alpine),
  `ml` (FastAPI, python:3.12-slim), `api` (Next.js 15, node:22-alpine). Healthchecks on
  db/redis/ml; `ml` waits for db+redis healthy; `api` waits for db healthy.
- `ml/app/config.py` — band thresholds (spec 7.4) and the disclaimer string defined
  **once**; fusion weights and k-anonymity threshold as settings.
- `ml/app/routers/health.py` + `ml/app/models/registry.py` — `GET /health` reporting the
  **true** per-model load state, not a hardcoded claim.
- `api/src/app/api/health/route.ts` — app-tier liveness plus a real reachability probe
  against the ML service.
- `.env.example` with every required var; `.env` is gitignored.

### Acceptance evidence

`GET /health` returns 200 with the spec 5.5 shape:

```
$ curl -s -o body -w 'HTTP %{http_code}\n' http://localhost:8000/health
HTTP 200
{"status":"ok","models_loaded":{"a":false,"b":false,"c":false}}
```

Tests (`docker exec sentinel-ml-probe python -m pytest -v`):

```
tests/test_health.py::test_health_returns_200_with_contract_shape PASSED
tests/test_health.py::test_health_reports_true_model_state_not_a_hardcoded_claim PASSED
2 passed
```

Images build clean: `sentinel-ml:latest` (282MB), `sentinel-api:latest` (1.09GB).

### Environment issues hit and resolved

1. **Docker Hub blob CDN was intermittently unreachable** (`httpReadSeeker: failed open ...
   production.cloudfront.docker.com ... EOF`), blocking `postgres:16` and `redis:7-alpine`.
   Transient — cleared on a later retry.
2. **Host port 5432 is unbindable on this machine.** Nothing is listening on it; Windows
   Hyper-V reserves the range `5342-5441` (`netsh interface ipv4 show excludedportrange`).
   Fixed by mapping the host side to `${POSTGRES_HOST_PORT:-55432}`. In-cluster services
   are unaffected — they reach Postgres as `db:5432`.

### Full-stack acceptance evidence

```
NAME             SERVICE   STATUS                    PORTS
sentinel-api     api       Up                        0.0.0.0:3000->3000/tcp
sentinel-db      db        Up (healthy)              0.0.0.0:55432->5432/tcp
sentinel-ml      ml        Up (healthy)              0.0.0.0:8000->8000/tcp
sentinel-redis   redis     Up (healthy)              0.0.0.0:6379->6379/tcp

$ curl http://localhost:8000/health          -> HTTP 200
{"status":"ok","models_loaded":{"a":false,"b":false,"c":false}}

$ curl http://localhost:3000/api/health      -> HTTP 200
{"status":"ok","ml_service_reachable":true}

$ docker compose exec db psql -U sentinel -tAc 'select version();'
PostgreSQL 16.15 (Debian 16.15-1.pgdg13+...)

$ docker compose exec redis redis-cli ping   -> PONG
```

All four services start from a single `docker compose up`. Step 3.1 acceptance met.

---

## 3.2 — Prisma schema + migrations + RLS — **PASSED**

Built:

- `api/prisma/schema.prisma` — the six models of spec Section 4 verbatim, plus query
  indexes. No fields added, renamed, or removed.
- Migration `20260906150852_init` — schema.
- Migration `20260906151500_rls_policies` — raw SQL, applied after the Prisma migration
  as the spec requires.
- `scripts/bootstrap_db.sh` — applies migrations and sets the `sentinel_app` login
  password from env. The password is never in committed SQL.
- `ml/tests/conftest.py`, `ml/tests/test_privacy.py` — 21 privacy tests over a plain
  Postgres connection, no application code in the path.

### Role design

| DB role | Access |
|---|---|
| `sentinel` (owner) | migrations, synthetic seeding, offline training/eval only — never the request path |
| `sentinel_app` (login) | owns nothing, **no privileges at all** until it `SET ROLE`s |
| `sentinel_personnel` | own rows only |
| `sentinel_welfare_officer` | assigned personnel with an active alert, via audited accessors only |
| `sentinel_commander` | unit membership for aggregates; **never** an individual welfare row |
| `sentinel_admin` | user/role management only; no welfare content |

Two decisions worth stating, because they are what makes this hold up under probing:

1. **`GRANT ... WITH INHERIT FALSE`.** Postgres matches `CREATE POLICY ... TO <role>` by
   *inherited* membership. An inheriting login would collect the union of all four roles'
   policies and quietly defeat the isolation. With `INHERIT FALSE`, no policy applies
   until an explicit `SET ROLE` picks exactly one — and a request that forgets to set a
   role gets `permission denied`, not a full table.
2. **Audit via SECURITY DEFINER accessors, not a trigger.** The spec prefers a trigger,
   but PostgreSQL has no SELECT trigger. Instead the officer role holds *no* direct
   SELECT on `Score`/`Assessment`/`Alert`; the only way in is
   `sentinel_officer_view_scores()` / `_view_assessments()` / `_alert_queue()`, each of
   which checks assignment + active alert and writes an `AuditLog` row before returning.
   The enforcement stays inside the database, so an API caller cannot read an individual
   row without logging it. Access with no `sentinel.user_id` set is refused outright
   rather than recorded unattributably.

### Acceptance evidence

```
$ docker compose exec ml python -m pytest tests/ -v
23 passed
```

Including the step's named gate — a commander cannot read individual welfare rows —
proven at both layers:

```
test_commander_cannot_select_individual_welfare_rows[Score]       PASSED
test_commander_cannot_select_individual_welfare_rows[Assessment]  PASSED
test_commander_cannot_select_individual_welfare_rows[Alert]       PASSED
test_commander_cannot_select_individual_welfare_rows[HrSignal]    PASSED
test_commander_is_blocked_by_rls_even_if_granted_select           PASSED
```

The last one is the important one: it grants the commander role direct `SELECT` on
`Score`, then shows RLS still returns zero rows. Revoke-based security alone would fail
open the moment someone adds a grant.

Deferred to 3.9 (components do not exist yet): k-anonymity refusal test, and the
"escalation never auto-contacts / never notifies a commander" test.

### Open questions raised by the spec (not blocking, answer before 3.9)

1. **`Score` has no relation to `User`.** Section 4 gives `Score.userId String` with no
   `@relation` and no `scores` field on `User`, unlike `HrSignal`/`Assessment`/`Alert`.
   Implemented exactly as written, so there is no foreign key on `Score.userId`. Likely
   an oversight — confirm whether to add the FK.
2. **`Assessment.responses` conflict.** Section 4 types it `Int[]`; Section 9.3 requires
   field-level AES-256 for it at rest. Ciphertext cannot live in an `Int[]` column.
   Section 4 is implemented as written; resolving this needs either a `Bytes` column
   alongside, or pgcrypto. Decide at 9.3.

---

## 3.3 — Synthetic data generator — **PASSED**

`ml/data_gen/generate_synthetic.py` — 3000 profiles x 180 days, written to Postgres and
snapshotted to parquet. Configurable via `--n / --days / --seed / --no-write-db`.

### Generation design

Labels are not drawn first and then decorated with features. Structural attributes are
sampled, a latent risk is computed from a weak additive background PLUS **soft AND-gated
interaction terms**, and bands are cut at quantiles of that latent — so prevalence is
exactly 70/20/7/3 rather than approximately so, and the label is consistent with the data
the model will actually see.

The two spec 6.2 archetypes are injected by shifting a small subpopulation's priors, never
by overwriting labels. They end up 4-5x likelier to be ELEVATED+ than baseline while
staying probabilistic.

### A calibration problem found and fixed

The first calibration used products of raw z-scores as its interaction terms. Measured:

```
best single feature   0.717
linear, all features  0.888
tree,   all features  0.870     <- linear BEATS the tree
```

A linear model doing as well as a tree means the signal was additive and the choice of
XGBoost for Model A would not survive an evaluator asking "why not logistic regression?".
Products of z-scores are largely absorbed by a linear model's main effects.

Replaced them with soft AND-gates — conjunctions that only fire when several stressors are
simultaneously high, which a linear model structurally cannot represent. Then swept the
noise scale:

| noise sigma | best single feature | interaction lift | tree AUC | 4-class macro-F1 |
|---|---|---|---|---|
| 0.45 | 0.795 | +0.041 | 0.974 | 0.611 |
| **0.55** | **0.790** | **+0.032** | **0.952** | **0.560** |
| 0.75 | 0.771 | +0.019 | 0.915 | 0.494 |

Chose 0.55: no single feature is near-diagnostic, the tree keeps a real advantage over a
linear model, and overall separability stays short of the suspiciously-clean range. Both
the reasoning and the sweep are recorded in the source.

### Acceptance evidence

```
band distribution (hidden ground truth, never served):
  LOW                2100  (70.00%)
  MODERATE            600  (20.00%)
  ELEVATED            210  ( 7.00%)
  PRIORITY_REVIEW      90  ( 3.00%)

scenario mix:
  baseline                                           2638
  hazardous_posting_leave_denial_recent_incident      192
  rising_irregularity_long_home_separation            170

biometric consent: 1778 (59.3%)
daily signal rows: 540,000   physio rows: 320,040
```

```
 users | hr_rows | truth_rows | physio_rows | distinct_days
  3000 |  540000 |       3000 |      320040 |           180

scenario                                       |  n   | pct_elevated_or_above
rising_irregularity_long_home_separation       |  170 |                  32.9
hazardous_posting_leave_denial_recent_incident |  192 |                  31.3
baseline                                       | 2638 |                   7.0
```

`docker compose exec ml python -m pytest tests/ -q` -> **37 passed**, including the new
`test_data_gen.py` contract: scale, full daily history, skewed prevalence, archetype lift,
no near-diagnostic single feature, tree-beats-linear, and the privacy properties below.

### Privacy properties built into the data

- `_ground_truth` and `_physio_signals` are created by the generator, **deliberately absent
  from the Prisma schema**. There is no generated client method for them, so no application
  code path can read the hidden label even by mistake. Tests prove all four app roles get
  `permission denied` on both.
- Raw physiological signals are training-only. In production the raw signal never lands
  server-side — only the derived `Assessment.physioContribution` (spec 5.3 / 7.3).
- No personal identifiers are generated at all: no names, service numbers, or sub-unit
  locations. Asserted in a test.
- Incident data is recency-only. Asserted in a test.
- Physiological data exists only for consenting profiles. Asserted in a test.

### Honest caveat on calibration sources

The file header cites the public source *categories* (MHA Annual Reports, the Parliamentary
Standing Committee on Home Affairs reports, MHA parliamentary answers, CRPF public
information) with URLs. The specific numeric ranges are marked `[ASSUMPTION]` because they
are plausible working values, not figures I verified against those documents. They should
be checked against the primary sources before any external claim is made about calibration.

---

## 3.4 — Vertical slice with STUB models (INTEGRATION GATE) — **PASSED**

All four spec Section 5 endpoints wired end-to-end through the real API and real database,
with stub models behind them.

### What is real from this slice onward

Only the three models are stubs. Everything the models sit inside is real:

- **Feature engineering** — `app/services/feature_pipeline.py`, the single module spec 7.1
  requires. Training and inference both import it, so there is no second implementation to
  drift.
- **Database reads** — features are engineered from the person's actual 180-day `HrSignal`
  history, not from request defaults.
- **The consent gate** — not stubbed, because it is a system invariant. A person who has
  not consented gets `score_c: null, used: false` even if signals are supplied in the
  request; the server does not take the client's word for consent.
- **Weight renormalisation** — a missing signal renormalises the remaining weights rather
  than counting as zero, so nobody is penalised for a gap.
- **The clinical-claims middleware** — every JSON response is scanned before it leaves the
  process (spec 10). Field names are scanned as well as values.
- **Least-privilege database access** — the app tier now connects as `sentinel_app` and
  must `SET LOCAL ROLE` per transaction. Reading a person's consent flag and filing their
  assessment run as `sentinel_personnel` (RLS enforces self-only); writing the Score runs
  as the new `sentinel_scoring` role.

Stubs are deliberately constant rather than plausible-looking heuristics — a heuristic
would be indistinguishable from a real model in a demo. `/health` continues to report
`models_loaded: {a: false, b: false, c: false}` while they are in place.

### New role: `sentinel_scoring` (migration `20260907090000_scoring_role`)

Scoring is a system action needing privileges no human role has. It can SELECT `HrSignal`
and `User` and INSERT `Score`, `Alert` and `Assessment` — and has **no SELECT on Score,
Assessment or Alert**. The scoring path is write-only with respect to welfare content, so a
bug in it cannot become a data leak. Asserted in `test_integration.py`.

### An addition beyond spec Section 5

`POST /internal/features/structured?user_id=...` engineers the 12 features from a person
history. It exists because spec 7.1 requires ONE shared feature module and the app tier is
TypeScript — having it build the feature vector would mean a second implementation and
immediate train/serve skew. The ML service owns the pipeline; the app tier asks for the
result. Namespaced under `/internal` because the dashboard never calls it. The four
Section 5 contracts are unchanged.

### A real train/serve skew, caught by its own test

`test_train_and_serve_produce_identical_features` compares one person features computed
from Postgres against the same person features computed from the training snapshot:

```
Differing items:
{training_load_trend_90d: 0.015081} != {training_load_trend_90d: 0.015083}
{night_shift_ratio_90d:   0.205033} != {night_shift_ratio_90d:   0.205032}
{shift_irregularity_90d:  0.373600} != {shift_irregularity_90d:  0.373601}
```

Cause: the generator rounded three columns to 4 dp on the way into Postgres while the
parquet snapshot kept full float64. Small, but it means a model trains on one set of
numbers and scores on another — and no accuracy metric would ever reveal it. Rounding
removed; both sides now carry identical values and the test passes.

### Acceptance evidence

```
$ docker compose ps
sentinel-api     Up            sentinel-db      Up (healthy)
sentinel-ml      Up (healthy)  sentinel-redis   Up (healthy)

$ curl -X POST :3000/api/assessments   (consenting person, all three signals)
{
  "user_id": "syn-000000", "sentinel_score": 37.1, "band": "MODERATE",
  "confidence": {"low": 0.321, "high": 0.421}, "override_fired": false,
  "shap_categories": {"deployment_load": 0.3, "leave_pattern": 0.25,
                      "duty_irregularity": 0.2, "transfer_frequency": 0.1,
                      "training_load": 0.05, "incident_proximity": 0.1},
  "signals_used": {"structured": true, "self_report": true, "physiological": true},
  "disclaimer": "Surfaces elevated welfare-risk indicators for human review. Not a clinical diagnosis."
}

   (no consent, no self-report -> still fully scored on signal A alone)
{"sentinel_score": 42, "band": "MODERATE",
 "signals_used": {"structured": true, "self_report": false, "physiological": false}}

   responses out of Likert range -> HTTP 422
   unknown person                -> HTTP 404

$ psql -c 'SELECT ... FROM "Score"'
   userId   | scoreA | scoreB | scoreC | sentinelScore |   band
 syn-000000 |   0.42 |   0.35 |   0.28 |          37.1 | MODERATE
 syn-000005 |   0.42 |        |        |            42 | MODERATE
```

```
$ docker compose exec ml python -m pytest tests/ -q
98 passed
```

New test files: `test_predict.py` (endpoint contracts, consent gate, band thresholds,
category-level-only attribution, weight renormalisation), `test_claims.py` (scanner,
middleware, disclaimer), `test_integration.py` (real-database vertical slice, train/serve
parity, scoring-role privilege boundary).

---

## 3.5 — Model A (XGBoost) + SHAP — **PASSED**

`training/train_model_a.py` produces the artifact; `app/models/model_a.py` serves it with
real TreeExplainer attribution. `/health` now reports `models_loaded.a = true`.

### Training

- Features come from `app.services.feature_pipeline` — the same module inference calls.
  The training script does not reimplement a single window.
- 70/15/15 stratified by band (train 2100 / val 450 / test 450).
- Class weights rather than resampling, because resampling would distort the calibration
  fitted immediately afterwards.
- XGBoost fitted on train with early stopping on val (203 trees used), then an isotonic
  calibrator fitted on the **held-out val split** with the booster frozen. Calibrating on
  training data would calibrate against the model's own overfit and make the spec 7.4 band
  thresholds meaningless.

### A decision rule that would have been mis-measured

The service assigns a band by cutting the severity score at the spec 7.4 thresholds; it
never takes the argmax class. The first evaluation reported argmax anyway. Measured
side by side on the test set:

| rule | macro-F1 | MODERATE recall |
|---|---|---|
| argmax (not shipped) | 0.5045 | 0.122 |
| **severity threshold (ships)** | **0.5769** | **0.456** |

Reporting argmax would have understated the model AND described something the service does
not do — the same class of mistake as train/serve skew, moved into the metrics. The script
now reports the threshold rule as primary and records `decision_rule` in the artifact
metadata; a test asserts it.

### Test-set performance (severity-threshold rule)

```
                 precision    recall  f1-score   support
            LOW      0.866     0.883     0.874       315
       MODERATE      0.427     0.456     0.441        90
       ELEVATED      0.462     0.387     0.421        31
PRIORITY_REVIEW      0.857     0.429     0.571        14

      macro avg      0.653     0.538     0.577       450
macro-F1: 0.5769
ROC-AUC (ELEVATED+ vs rest): 0.9663

confusion matrix (rows = true, cols = predicted)
                         LOW  MODERATE  ELEVATED  PRIORITY
               LOW       278        37         0         0
          MODERATE        42        41         7         0
          ELEVATED         1        17        12         1
   PRIORITY_REVIEW         0         1         7         6

reliability of P(ELEVATED+)
  0.000-0.014  n=169  predicted~0.002  observed=0.006
  0.014-0.016  n=101  predicted~0.015  observed=0.000
  0.016-0.155  n= 90  predicted~0.063  observed=0.011
  0.155-1.000  n= 90  predicted~0.496  observed=0.478
```

Accuracy is deliberately not the headline: at this prevalence a model predicting LOW for
everyone scores ~70%.

**Known weakness, stated plainly.** PRIORITY_REVIEW recall is 0.429 at precision 0.857 —
the model is conservative about the top band, and 7 of 14 true PRIORITY cases land in
ELEVATED. Missing a high-risk person is the costly error here. Two later components are
designed to catch exactly this and should be measured against it at 3.8/3.9: the
self-report override (a person who says they are struggling is raised regardless of what
the behavioural model says) and the sustained-trend escalation rule. If recall is still
short after those, Model A needs a cost-sensitive threshold rather than a symmetric one.

### Serving

- `score_a` is expected severity: the four band probabilities weighted by their midpoints.
  This preserves ordinal information that "probability of the top class" would discard —
  it separates a confident MODERATE from a borderline ELEVATED.
- SHAP comes from the raw booster (TreeExplainer needs tree structure) for the assigned
  class, and `services/explain.py` folds the 12 feature values into the 6 categories before
  anything is returned. Feature-level values never leave that function.
- **Feature order is asserted against the artifact metadata at load time.** Editing the
  shared pipeline without retraining raises at startup instead of silently scoring the
  right values in the wrong order, which would produce plausible-looking nonsense.
- A missing artifact leaves the model unloaded, `/health` honest, and the endpoint at 503.
  It never falls back to the stub.

### A bug found by its own test

`load()` on a missing artifact marked the registry false but left `_state` populated — so
`/health` would report the model unloaded while the endpoint kept serving from the stale
one. The two must never disagree. `load()` now clears the state.

Separately, a bare `TestClient` does not run FastAPI lifespan events, so the suite had been
exercising an unloaded service. A session-scoped autouse fixture now mirrors startup.

### Acceptance evidence

```
$ curl :8000/health
{"status":"ok","models_loaded":{"a":true,"b":false,"c":false}}

score_a by hidden ground-truth band, through the real serving path:
  true=LOW              -> 0.125/LOW  0.149/LOW  0.183/LOW  0.125/LOW  0.261/MODE  0.163/LOW
  true=MODERATE         -> 0.408/MODE 0.210/LOW  0.270/MODE 0.455/MODE 0.251/LOW  0.429/MODE
  true=ELEVATED         -> 0.647/ELEV 0.659/ELEV 0.465/MODE 0.680/ELEV 0.703/ELEV 0.261/MODE
  true=PRIORITY_REVIEW  -> 0.902/PRIO 0.902/PRIO 0.902/PRIO 0.848/PRIO 0.733/ELEV 0.902/PRIO

$ POST /api/assessments   (true PRIORITY_REVIEW person, end to end)
{"sentinel_score": 90.17, "band": "PRIORITY_REVIEW",
 "confidence": {"low": 0.8517, "high": 0.9517},
 "shap_categories": {"incident_proximity": 0.281, "leave_pattern": 0.264,
                     "deployment_load": 0.264, "duty_irregularity": 0.163, ...}}

$ POST /api/assessments   (true LOW person)
{"sentinel_score": 12.5, "band": "LOW"}
```

```
$ docker compose exec ml python -m pytest tests/ -q
111 passed
```

---

## 3.6 — Model C (physiological) — **PASSED**

`/health` now reports `models_loaded: {a: true, b: false, c: true}`.

### The gap the spec leaves, and how it was closed

Spec 7.3 prefers per-person baseline deviation over population thresholds. But the spec 5.3
request carries a single day's readings, and production deliberately keeps no raw
physiological history server-side — so there is nowhere for a personal baseline to come
from. The spec does not resolve this.

Closed by making the baseline an **optional, additive field on the 5.3 request**, supplied
by the on-device layer that already holds the person's history. It is eight summary
statistics (four means, four standard deviations), never raw daily readings, and the server
discards it with the request. A request containing exactly the spec's fields is still valid.

### The measurement that justified it

The first training run scored both paths on the same held-out person-days:

| scoring mode | ROC-AUC (ELEVATED+ vs rest) |
|---|---|
| personal baseline | **0.646** |
| population fallback | 0.518 |

The population path is barely better than a coin toss. That is not a tuning problem —
physiological baselines differ far more between individuals than risk-related drift does
within one person, so an absolute reading carries little information about risk.

So **the endpoint declines to score without a personal baseline**, returning
`{"score_c": null, "used": false}`. Contributing nothing is strictly better than
contributing noise to somebody's welfare score, and the fusion layer already treats a
missing signal correctly. The comparison is kept in the artifact metadata and asserted by a
test, so the design choice stays evidence-backed rather than asserted.

### Training design

- Consenting subset only (1778 people), exactly as in production.
- Baseline from days 0-119; scoring observations from days 120-179, so no observation
  informs its own baseline.
- **One row per person-day, not per person.** Inference scores a single day, so training
  must too — aggregating to a 30-day mean would train on a smoother, easier signal than the
  model ever sees. 106,680 rows.
- **Split by person, never by row**, or the same person's days would land on both sides and
  leak their baseline into the test set.
- IsolationForest anomaly score over the four deviation features, fed to the
  GradientBoosting classifier as an extra feature (spec 7.3 allows combining both).
- Isotonic calibration on a held-out validation split of people.

### Test-set performance — a contributing signal, deliberately not a giveaway

```
                 precision    recall  f1-score   support
            LOW      0.740     0.865     0.798     11400
       MODERATE      0.214     0.196     0.204      2940
       ELEVATED      0.182     0.004     0.008       960
PRIORITY_REVIEW      0.000     0.000     0.000       720

macro-F1: 0.2526      ROC-AUC (ELEVATED+ vs rest): 0.6458
```

Weak on its own, and that is correct: spec 6.3 explicitly wants a contributing signal
rather than a giveaway, and a physiological AUC near 1.0 would mean the synthetic data
leaks the label through the wearable channel. The training script warns if AUC exceeds
0.90 for exactly that reason. Model C is not a standalone classifier and is never used as
one — it contributes 20% of the fused score.

### The property that makes the per-person approach worth the trouble

A test drives the same four readings through two different baselines:

- for someone whose normal is 66 bpm / 52 ms HRV, those readings are a large departure
- for someone whose normal *is* 81 bpm / 25 ms HRV, they are simply that person

Scores differ. A population-threshold model would flag the second person for being
physiologically themselves.

### Acceptance evidence

```
consent + signals + baseline  -> {"score_c": 0.798135, "used": true}
consent + signals, NO baseline-> {"score_c": null, "used": false}
no consent (signals supplied) -> {"score_c": null, "used": false}
```

End to end, a behaviourally-quiet person whose physiology has departed from their own
baseline:

```
with baseline    -> sentinel_score 31.73  band MODERATE  physiological: true
without baseline -> sentinel_score 12.50  band LOW       physiological: false
```

```
$ docker compose exec ml python -m pytest tests/ -q
128 passed
```

### BLOCKER FOR 3.8 — a weak signal drags high-risk people downward

The spec 7.5 fusion is a weighted mean over available signals. Measured against the real
Model C now that it exists:

```
score_a=0.90  score_c=null  -> sentinel_score 90.00  PRIORITY_REVIEW
score_a=0.90  score_c=0.20  -> sentinel_score 70.00  ELEVATED
score_a=0.90  score_c=0.15  -> sentinel_score 68.57  ELEVATED
```

Model C's output is low-variance and clusters near 0.15-0.25 for most people, because it is
a weak signal. Averaged in, it pulls every high-risk person toward its own mean — here it
demotes a PRIORITY_REVIEW person a whole band. **Someone consenting to biometrics would be
scored lower than the identical person who did not**, which inverts the intent of the
consent gate and is a safety problem, not a cosmetic one.

A plain weighted mean is the wrong combiner for signals with different variances and
different reliabilities. Options for 3.8, to be measured rather than assumed:
1. Combine on a common standardised scale before the weighted mean.
2. Weight each signal by its measured informativeness rather than a fixed constant.
3. Make fusion take the maximum of (signal A alone, the weighted blend), so a weak
   corroborating signal can only ever raise concern, never lower it.

Option 3 is closest to the spec's stated intent (the self-report override exists for the
same reason) and is the current preference. This is called out here so 3.8 is measured
against it rather than reproducing the arithmetic as specified.

---

## 3.7 — Model B (multilingual NLP) — **PASSED** (on-device export blocked, see below)

`/health` now reports `models_loaded: {a: true, b: true, c: true}`.

### Two forced substitutions, both inside what the spec allows

**Base model.** `ai4bharat/indic-bert` is a GATED repository — it needs an accepted licence
and an authenticated token, and cannot be fetched. Switched to
`google/muril-base-cased`, the alternative named in spec 7.2. Defensible on the merits: it
covers 17 Indian languages plus English and tokenises Devanagari at word level (the Hindi
probe sentence yields 11 clean word tokens, not a shower of subword fragments).

**Corpus.** Of the three corpora named in spec 6.4, **CLPsych** and **DAIC-WOZ** both
require signed data-use agreements and cannot be obtained here. Trained on **Dreaddit**
alone (Turcan & McKeown 2019), fetched from the authors' own Columbia release: 2838 train
(split 2413/425 train/val) and the official 715-row test split, near-balanced.

Both omissions are recorded in `model_b_meta.json` under `corpora_not_used`, with a test
asserting they stay recorded. Dreaddit alone skews to informal social-media register, so
clinical-adjacent phrasing is under-represented — stated in the artifact's `limitations`.

### Training

HF `Trainer` as spec 7.2 requires. Embeddings and the bottom 6 encoder layers frozen —
MuRIL's embedding table alone is 151.9M of its 237.6M parameters, so freezing it cuts the
backward pass sharply and preserves the multilingual representation we actually want.
43.1M trainable, 2 epochs, max_length 160, CPU.

### Results — EN and HI reported separately, never averaged

```
ENGLISH (official Dreaddit test split, n=715)
  macro-F1 0.7756   ROC-AUC 0.8637

HINDI (machine-translated from the same posts, n=300)
  macro-F1 0.7400   ROC-AUC 0.8122

cross-lingual transfer gap (macro-F1): +0.0356
```

A 0.036 gap from English-only training is the multilingual encoder earning its place: an
English-only BERT would score Hindi arbitrarily, which spec 7.2 correctly calls a fairness
failure. Live behaviour:

```
EN distressed 0.848  /  EN neutral 0.178
HI distressed 0.847  /  HI neutral 0.182     (trained on zero Hindi)
romanised Hindi code-mix 0.733
```

**The HI number is a lower bound, not a field claim.** It is machine translation of English
Reddit posts. Real Hindi self-reports are code-mixed and idiomatic in ways this evaluation
cannot reach.

### Known limitation, tested rather than hidden

Language reporting is script-based. Devanagari is shared by Hindi, Marathi and Nepali, so a
caller's declared language is taken at its word only when the script agrees. **Romanised
Hindi** ("duty bahut heavy hai, neend nahi aa rahi") is Latin script and is reported as
`en` — script detection cannot see it, and a language-ID model is not worth a dependency
when the label is metadata. Two tests pin this: one asserts the imprecise label, the other
asserts that the *score* is still correct for romanised Hindi distress, which is the part
that drives the system.

### ON-DEVICE EXPORT: BLOCKED, with measurements

Spec 7.2 asks for a quantised ONNX export so the PWA can run Model B locally. The export
runs and the artifact exists, but **it must not be shipped**, for two measured reasons.

The export script has a parity gate — it scores the same inputs through PyTorch and through
the quantised model and fails if any score shifts by more than 0.05. That gate earned its
keep immediately:

```
first attempt (default dynamic int8):
  [en] torch=0.8469  onnx-int8=0.4858   delta=0.3611
  [en] torch=0.1792  onnx-int8=0.4544   delta=0.2752
  [hi] torch=0.8470  onnx-int8=0.4910   delta=0.3561
```

Every input collapsed to ~0.48 — the model had lost all discrimination. Cause: the default
config quantises `Gather`, the embedding lookup, and MuRIL's 197k-row table does not
survive per-tensor int8. The export "succeeded" and the files looked normal; only the
parity check revealed it.

Restricting quantisation to `MatMul` with per-channel scaling restored discrimination:

```
  [en] torch=0.8469  onnx-int8=0.8398   delta=0.0071
  [en] torch=0.1792  onnx-int8=0.2843   delta=0.1051
  [hi] torch=0.8470  onnx-int8=0.7761   delta=0.0709
  [hi] torch=0.1867  onnx-int8=0.3402   delta=0.1536
worst parity delta: 0.1536 (threshold 0.05)
```

Still over the gate, and the size is the harder problem:

```
embedding params : 151,911,168  = 607.6 MB at fp32
other params     :  85,646,594  = 342.6 MB at fp32
model.onnx           950.4 MB
model_quantized.onnx 694.6 MB
```

The embedding table must stay fp32 (int8 collapsed it), so **~608 MB is a hard floor for
any MuRIL on-device build**. No PWA ships that. And the residual 0.15 parity drift matters
because the spec 7.5 self-report override is an ABSOLUTE threshold (`score_b > 0.75`) — a
shift that size can flip whether the override fires, so on-device and server would disagree
about a person's band.

**Verdict, recorded in `model_b_onnx_report.json`:** MuRIL is the right server-side model
and the wrong on-device model. The on-device path needs a distilled student with a reduced
vocabulary — the vocabulary, not the depth, is what makes this undeployable. Until that
exists, the privacy claim must be stated as *"text is discarded immediately after
scoring"*, NOT *"text never leaves the device"*. Claiming the latter while shipping a
server-side model would be exactly the kind of overclaim this project treats as
disqualifying.

Enforced in code meanwhile: the raw text is never persisted, never logged (a canary test
checks the log output), and never echoed in the response.

### Acceptance evidence

```
$ curl :8000/health
{"status":"ok","models_loaded":{"a":true,"b":true,"c":true}}

$ docker compose exec ml python -m pytest tests/ -q
148 passed
```

### Confirms the 3.8 override is load-bearing

End to end, a person whose duty record is unremarkable but who writes (in Hindi) that they
cannot sleep, that every day feels heavier, and that they have nobody to talk to:

```
scoreA 0.125  scoreB 0.847  ->  sentinel_score 39.57  band MODERATE  override_fired false
```

Someone explicitly asking for help is scored MODERATE because their leave record looks
tidy. That is precisely the miss spec 7.5's self-report override exists to prevent, and
fusion is still the 3.4 stub. Together with the Model C dilution problem recorded under
3.6, this makes 3.8 the highest-value remaining step.

---

## 3.8 — Fusion layer — **PASSED**

Explainable logic, not another model. Four steps, each one a rule an officer could be
walked through.

### 1. Weighted base over available signals (spec 7.5, unchanged)

Weights renormalise over whichever signals exist, so nobody is penalised for a gap.

### 2. Non-dilution floor (departure from the literal spec, evidence-based)

`fused = max(weighted_base, score_a)`.

Measured at 3.6 with the real Model C: a person at `score_a` 0.90 (PRIORITY_REVIEW) fell to
70.0 (ELEVATED) once a typical `score_c` of 0.20 was averaged in. Model C clusters near
0.15-0.25 because it is a weak signal by design, so a plain weighted mean dragged every
high-risk person toward its mean. **The person who consented to biometrics was scored lower
than the identical person who did not** — which inverts the point of the consent gate.

The floor is deliberately asymmetric: corroborating signals can raise concern but cannot
talk the system out of one. Under-reporting is the expected failure mode in this
population, so "I am fine" must not cancel what the duty record shows. A genuinely high
secondary signal still lifts the weighted mean above `score_a`, where the floor does not
bind — tested.

### 3. Self-report override (spec 7.5)

`score_b > 0.75` and band below ELEVATED raises the band one tier, and lifts the score to
that band's floor so the two never disagree. One tier, not straight to the top:
escalation should be proportionate.

### 4. Confidence from agreement AND signal count (extension of spec 7.5)

Spec 7.5 derives the interval from spread alone. That breaks with a single signal: spread
is 0, which would report the least-informed prediction as the most certain. The half-width
is therefore a floor that widens as signals drop away (12 / 9 / 6 points for 1 / 2 / 3
signals) plus a term proportional to disagreement, capped at 25.

### Acceptance evidence

Spec 7.5's three named unit tests, plus regressions for both measured failures:

```
$ docker compose exec ml python -m pytest tests/test_fusion.py -q
34 passed

$ docker compose exec ml python -m pytest tests/ -q
182 passed
```

End to end through the real stack, the two cases that previously misbehaved:

**The 3.7 miss — quiet duty record, Hindi self-report saying they cannot sleep and have
nobody to talk to:**

```
before (stub):  39.57  MODERATE          override_fired false
after:          56.00  ELEVATED          override_fired true
                confidence 31 - 81
```

The interval is deliberately wide: `score_a` 0.125 against `score_b` 0.847 is a large
disagreement, and the officer should see that the two sources conflict rather than be
handed a confident-looking number.

**The 3.6 dilution — true PRIORITY_REVIEW person who consented to biometrics:**

```
before (weighted mean):  70.00  ELEVATED
after:                   90.17  PRIORITY_REVIEW
```

Also asserted as a property across a grid of (score_a, score_c) pairs: consenting to
biometrics never lowers a person's score.

### Contract clarification

`confidence.low/high` are now on the **same 0-100 scale as `sentinel_score`**. Spec 5.4's
example has all values at 0.0 so it does not disambiguate, and the stub had used 0-1. A
dashboard reading "62 (range 54-81)" is coherent; "62, confidence 0.54-0.81" is not.

`fuse()` also returns an `_explain` block (signals used, weighted base before the floor,
whether the floor bound, spread). It is NOT part of the spec 5.4 response — a test asserts
it never appears in the API output — and exists for the evaluation suite and for explaining
a score to an officer.

---

## 3.9 — Privacy aggregation + escalation engine — **PASSED**

Closes the two `test_privacy.py` cases that had been waiting for their components.

### k-anonymity (spec 9.1) — enforced in SQL, not in the service

`sentinel_cohort_summary()` is a SECURITY DEFINER function that groups the latest score per
person by unit and returns NULL for every aggregate column of any cohort below k. There is
no argument that relaxes it — a test reads the function's signature from `pg_proc` and
fails if one ever appears. `privacy/kanon.py` only shapes what the function is willing to
return into spec 9.1's refusal object; it enforces nothing, because enforcement in
application code could be routed around by a new endpoint or a direct session.

Two details worth stating:

- **One score per person, not one row per score.** Counting every historical score would
  let a cohort of three people clear k=10 on repeat measurements.
- **k lives in a `PrivacyConfig` table**, read by both SQL and the application through
  `sentinel_k_threshold()`, so there is one number rather than two copies that can drift.

Measured against 600 people scored through the real pipeline:

```
no filter                -> 40 cohorts: 37 returned, 3 refused (naturally small units)
filter band=PRIORITY_REVIEW -> 13 cohorts: ALL refused, 0 leaking

{'unit_id': 'BH-BN-012', 'refused': False, 'n': 19,
 'band_counts': {'LOW': 11, 'MODERATE': 5, 'ELEVATED': 3, 'PRIORITY_REVIEW': 0},
 'mean_score': 29.1}

{'unit_id': 'BP-BN-031', 'refused': True,
 'reason': 'cohort_below_k_anonymity_threshold', 'k': 10}
```

The refusal carries no count, no band distribution and no mean — not a rounded figure, not
a suppressed cell with a hint. Asserted directly, and asserted again by querying the SQL
function as the commander role with the service out of the picture.

### Escalation engine (spec 8) — four independent guarantees

Spec principle 6 cannot be proved by one assertion, so "no code path ever contacts a
person" is defended four ways:

1. **Static analysis of the serving tree.** Every file under `app/` is parsed with `ast`
   and checked for forbidden imports (`smtplib`, `twilio`, `requests`, `httpx`, ...) and
   outbound calls. This proves the *capability* is absent, not merely unused. A companion
   test plants a file that really does send mail and asserts the detector catches it — a
   guard that cannot fail is not a guard.
2. **A database trigger.** `alert_must_start_pending` rejects any insert whose status is
   not PENDING_REVIEW, or that arrives with a reviewer already attached. Even the table
   owner cannot write a pre-actioned alert.
3. **Row-level security.** A commander gets `InsufficientPrivilege` on `Alert`, verified
   again immediately after an escalation creates one.
4. **A partial unique index.** `alert_one_open_per_user` means repeated escalation cannot
   bury an officer in duplicates — enforced by the database rather than a read-then-write,
   which also keeps the scoring role write-only and removes the race.

The escalation response states `action_taken: "none"` and `awaiting:
"welfare_officer_review"` so no consumer can render it as something the system did.

### Trend escalation without giving the scorer read access

Spec 8's sustained-trend rule needs score history, but the scoring role is write-only with
respect to `Score` (established at 3.4). `sentinel_score_trend()` returns two rolling means
and a count — never the rows — so the engine learns "this person's recent mean is 32 points
above their prior mean" while remaining unable to read anyone's history. Tested both ways:
the direct `SELECT` still fails, the trend function still works.

This is the second net under Model A's conservative PRIORITY_REVIEW recall (0.429, measured
at 3.5): a person whose scores are climbing gets a human look before reaching the top band.

### Bugs found and fixed during this step

- **`SET LOCAL ROLE` is dropped at every `commit()`.** The batch scorer set the role once
  and committed every 100 people; from the first commit onward it was running as the
  privilege-less login. Fixed by using session-scoped `SET ROLE` in the batch job, with a
  comment explaining why request paths correctly keep `SET LOCAL`.
- **A duplicate-alert rollback discarded the caller's work.** `evaluate()` called
  `conn.rollback()` on `UniqueViolation`, which would have thrown away a whole run of
  in-flight `Score` rows. Now wrapped in a nested transaction so only the alert insert
  unwinds.
- **`INSERT ... ON CONFLICT` requires SELECT.** Added for idempotency, it failed with
  `permission denied` — PostgreSQL needs SELECT to resolve a conflict target, and the
  scoring role deliberately has none. Removed; re-running uses `--reset` via the owner
  connection instead. The privilege model refusing a convenience shortcut is the model
  working.
- **A test suite that hung rather than failed.** Pytest unwinds fixtures in reverse setup
  order, so the `cohort` teardown's DELETE blocked forever on locks held by a still-open
  role-scoped connection. Those connections are now autocommit, and `owner_conn` sets
  `lock_timeout` so a future conflict fails fast and names itself.
- **The static scan matched prose.** Its first version scanned raw source text and failed
  on escalation.py's own docstring, which uses the word "webhook" while promising there is
  no webhook. Rewritten to parse the AST: a comment cannot send an email, and text matching
  would equally have missed one that could.
- **`--reset` left the Redis queue stale** (40 queued ids against 16 alerts). The queue is
  an index over the alert table, never a second source of truth; reset now clears both.

### Acceptance evidence

```
$ docker compose exec ml python -m pytest tests/ -q
201 passed
```

End to end, a person the model places in PRIORITY_REVIEW:

```
POST /api/assessments
{"sentinel_score": 90.17, "band": "PRIORITY_REVIEW",
 "review": {"pending_review_raised": true,
            "reasons": ["band_priority_review"],
            "action_taken": "none"}}

   userId   |      band       |     status     | reviewedBy
 syn-000034 | PRIORITY_REVIEW | PENDING_REVIEW | (null)

assigned officer, via the audited accessor:
  queue: [('al-b9dcd82eebd88abb47473d6b', 'PENDING_REVIEW')]
commander reading Alert directly:
  InsufficientPrivilege
```

Batch run over 600 people: 1800 scores, 16 alerts, all PENDING_REVIEW, none with a
reviewer, queue depth matching the alert count exactly.

### Worth carrying into 3.10

A true PRIORITY_REVIEW person (`syn-000107`) scored 73.3 / ELEVATED in this run and
therefore raised no alert. That is Model A's 0.429 recall appearing in live behaviour
rather than in a metrics table. The trend rule did not catch them either, because their
three scores were not rising. The bias audit at 3.10 should quantify how often this
happens and per which cohort — it is the system's most consequential failure mode.

---

## 3.10 — Evaluation suite (bias audit + PR curve) — **PASSED**

`training/evaluate.py` produces `pr_curve.png` and `evaluation_report.json`.

### Method

**Out-of-fold predictions over all 3000 people, not the 450-person test split.** A 450-row
split leaves ~11 people per unit, which cannot support a stable cohort rate. Five-fold CV
gives everyone a prediction from a model that never saw them, using the same feature
pipeline, calibration procedure and severity-threshold decision rule as the shipped model.
Calibration is fitted inside each fold's training portion, never against the fold it scores.

### Overall (out-of-fold)

```
                 precision    recall  f1-score   support
            LOW      0.858     0.880     0.869      2100
       MODERATE      0.422     0.470     0.445       600
       ELEVATED      0.486     0.324     0.389       210
PRIORITY_REVIEW      0.811     0.333     0.472        90
      macro avg      0.644     0.502     0.544      3000

macro-F1 0.5436   ROC-AUC 0.9515   average precision 0.7518
overall false-positive rate: 0.0115
overall miss rate:           0.5133
```

### THE HEADLINE FINDING: the system misses more than half of who it exists to find

```
people whose true band is PRIORITY_REVIEW:            90
share that would raise an alert under the band rule:  33.3%
-> 60 of 90 people in the highest-risk band get no alert
```

ROC-AUC 0.9515 says the model **ranks** people well. The miss rate says the **thresholds**
are wrong for the job. The system is tuned far toward precision: a false-positive rate of
0.0115 is remarkably clean, and it is bought by not looking at half the people who need it.
In a welfare context those errors are not symmetric — a false positive costs a welfare
officer one conversation, a false negative costs a person in distress being passed over.

The operating-point table makes the trade explicit:

```
 threshold   precision    recall   flagged
      0.26       0.335     0.943       845
      0.40       0.619     0.730       354
      0.56       0.825     0.487       177   <- current ELEVATED cut
      0.70       0.944     0.223        71
      0.81       0.973     0.120        37   <- current PRIORITY cut
```

### Root cause, and a fix that is NOT mine to apply

`score_a` is an EXPECTED value over four ordinal bands, so it regresses toward the middle:
a person the model puts at 60% PRIORITY / 40% MODERATE scores
`0.6*0.905 + 0.4*0.405 = 0.705`, which lands in ELEVATED. That is structurally why only a
third of true PRIORITY people cross 81. It is a consequence of the severity scoring chosen
at 3.5 — which beat argmax on macro-F1 (0.577 vs 0.505) and remains the better score — but
it systematically under-assigns the top band.

The surgical fix is a **top-band trigger**: assign PRIORITY_REVIEW when
`P(PRIORITY_REVIEW) >= tau` regardless of the expected value. That changes how spec 7.4's
bands are assigned, so it is the spec owner's decision. Measured, not asserted:

```
current rule: 37 alerts, 33.3% of true PRIORITY alerted, 7 alerts on people who are not

   tau   alerts   true-PRI alerted   non-PRI alerted
  0.20      123             71.1%                59
  0.30       98             64.4%                40
  0.40       82             61.1%                27
  0.50       62             50.0%                17
  0.60       46             40.0%                10
```

At tau=0.30, detection of the highest-risk band nearly doubles (33% -> 64%) for 61
additional alerts across 3000 people. Recorded in the report as
`top_band_trigger_evidence` with `status: "not implemented"`, and a test asserts it stays
evidence rather than being quietly applied.

### Per-cohort audit

```
--- posting_type ---
cohort                     n    prev    prec  recall     FPR    miss  alert@PRI
remote_hazardous         937   0.189   0.833   0.508   0.024   0.491      0.303
standard                2063   0.060   0.812   0.455   0.007   0.545      0.417

--- tenure_band ---
5_to_12y                1512   0.102   0.847   0.539   0.011   0.461      0.286
over_12y                 911   0.097   0.837   0.466   0.010   0.534      0.281
under_5y                 577   0.101   0.733   0.379   0.015   0.621      0.562

--- biometric_consent ---
False                   1222   0.102   0.789   0.452   0.014   0.548      0.375
True                    1778   0.099   0.849   0.511   0.010   0.489      0.310
```

**No cohort carries a runaway false-positive rate.** The only FPR warning is the
hazardous-posting/leave-denial archetype at 0.059, and that cohort has 38% true prevalence
— flagging more of them is the system working, not bias.

**A real fairness gap does exist, and it is in recall, not false positives.** Personnel
with under five years of tenure have the worst miss rate (0.621) against 0.461 for the
5-12 year band — the system is least able to see risk in the least experienced people.
Precision is also lowest for that group (0.733). Worth investigating before deployment;
plausibly the behavioural features (deployment tenure, transfers, home separation) simply
carry less signal for someone early in service.

Consent makes almost no difference to how well a person is served (miss 0.548 without,
0.489 with), which is the right outcome: the system must work for people who decline
biometrics, and it does.

### A correction to my own audit

The first version raised 29 "fairness warnings", most of them noise. Two faults:

* the false-positive rule was purely relative ("more than twice the overall"), and against
  a 0.0115 base rate that fires on a difference of one or two people. It now also requires
  clearing an absolute bar of 0.05;
* unit-level cohorts hold ~75 people at ~10% prevalence, i.e. roughly 8 elevated cases. A
  miss rate over 8 cases is not a finding. Rate-based warnings now require at least 20
  positives, and unit rows are printed with an explicit underpowered caveat.

After the fix: 6 warnings, all substantive.

### Acceptance evidence

```
$ docker compose exec ml python -m training.evaluate
saved -> artifacts/pr_curve.png
saved -> artifacts/evaluation_report.json

$ docker compose exec ml python -m pytest tests/ -q
209 passed
```

`test_evaluation.py` asserts the PR curve is a real PNG, that per-cohort precision/recall
exist for every required dimension, that small cohorts are suppressed rather than given
noisy rates, that the audit measures who is MISSED and not only who is flagged, that the
warnings are recorded rather than dropped — and that the report itself contains no clinical
language, since it is a document people read.

---

## Post-3.10 corrections — **DONE**

### 1. Top-band trigger — ACTIVE at tau=0.30

`config.apply_top_band_trigger()` lifts a score to the PRIORITY_REVIEW floor when
`P(PRIORITY_REVIEW) >= 0.30`, correcting the expected value's regression toward the middle.
Lifting the SCORE rather than overriding the band keeps score and band consistent — the
same pattern the self-report override already used.

Re-measured out-of-fold over 3000 people:

| | before | after |
|---|---|---|
| PRIORITY_REVIEW recall | 0.333 | **0.644** |
| PRIORITY_REVIEW F1 | 0.472 | **0.617** |
| macro-F1 | 0.5436 | **0.5609** |
| overall miss rate | 0.5133 | **0.4900** |
| overall false-positive rate | 0.0115 | 0.0126 |
| highest-risk people with no alert | 60 of 90 | **32 of 90** |

Detection of the top band nearly doubled and the false-positive rate barely moved. The cost
is PRIORITY precision (0.811 to 0.592), which is the intended trade: a false positive is one
officer conversation, a false negative is a person in distress passed over.

`train_model_a.py` and `evaluate.py` both apply the trigger, so the reported numbers
describe the rule that ships. A test asserts the alert rate stays above 0.55, so a future
change cannot quietly undo it, and the audit re-derives the whole tau trade-off table on
every run so the constant does not become folklore.

### 2. `Score` foreign key — ADDED

Section 4 gave Score a bare `userId` with no relation, unlike HrSignal, Assessment and
Alert. Verified zero orphan rows, then added `Score_userId_fkey` with
`ON DELETE RESTRICT`. A score can no longer reference a person who does not exist.

### 3. `Assessment.responses` — NOW ENCRYPTED AT REST

Section 4 types it `Int[]`; Section 9.3 requires field-level AES-256. Both cannot hold —
ciphertext does not fit in an integer array. **9.3 wins**: a plaintext PHQ-9/GAD-7-style
questionnaire is the most sensitive row in the schema, and storing it in the clear would
undercut every other control in this system.

The column is now `responsesEnc bytea`, holding AES-256-**GCM** (12-byte IV, 16-byte tag,
then ciphertext) with a fresh random IV per write — without that, two people answering
identically would produce identical rows and the ciphertext would leak equality.
Encryption happens in the app tier (`api/src/lib/fieldCrypto.ts`) before the value reaches
the database, so the key never enters SQL.

As stored:

```
   userId   | bytes |           first_bytes
 syn-000034 |    47 | 36302dcdb7cd84f0712f37b9830949f8
```

The guard proved itself during wiring: with `AES_KEY` absent from the api container the
request failed with "AES_KEY is not set; refusing to store plaintext" rather than falling
back. `AES_KEY` is now passed with no default, so a missing key stops the service instead
of silently degrading it.

Tests assert the plaintext column is **gone** rather than merely unused, that the stored
value shows no JSON structure, and that the foreign key exists.

Also brought `_ground_truth` and `_physio_signals` into migration history, so
`prisma migrate dev` no longer reports drift and demands a reset. They remain absent from
`schema.prisma`, which is the point — no generated client method, so no application path
can reach the hidden training label.

---

## 3.11 — RAG recommendation engine — **PASSED**

`POST /recommend` returns policy-grounded guidance with citations. Local embeddings
(`all-MiniLM-L6-v2`) into a local Chroma store — no document leaves the machine to be
indexed, which will matter when the corpus holds internal welfare circulars.

### The corpus problem, and what I did about it

Spec 11 wants CAPF/government welfare guidelines. MHA and CRPF sites are reachable but
serve HTML index pages, not policy text; scraping them into a welfare corpus would have
produced navigation chrome and guesswork.

**Writing plausible-looking CAPF policy was the alternative, and it was rejected.** Spec 11
requires every suggestion to be traceable to a source chunk. A traceable citation to an
invented document satisfies the letter of that requirement and destroys its purpose — the
officer would have no way to tell fabricated guidance from real.

So the engine ingests whatever is in `ml/data/policy_corpus/`, and:

- **`manifest.json` is mandatory.** The index builder refuses any document not declared
  with a publisher and a source URL, and refuses any file sitting in the corpus directory
  that the manifest does not mention. An untraceable chunk cannot be cited, so it is not
  indexed.
- **The shipped corpus is a labelled placeholder.** Every chunk is tagged
  `authoritative: false`, the builder prints a warning, and `/recommend` returns
  `"authoritative": false` with an explicit warning whenever a non-authoritative chunk is
  used.
- **`README.md` names the exact real documents to obtain**, with URLs and a worked manifest
  entry.

### Guardrails, enforced rather than intended

- **Category-level input only.** `RecommendRequest` uses `extra="forbid"`, so a request
  carrying `user_id`, `name`, `unit_id`, `text` or `date` is **rejected with 422** rather
  than silently stripped. Silently ignoring it would be safe but would leave the caller
  believing they had sent it. Five parametrised tests cover this.
- **Extractive by default.** The suggestion is assembled from retrieved passages verbatim,
  each with its citation. "Cite only the retrieved text" is a promise a generator can break
  and a quotation cannot. A hosted-LLM path exists behind `LLM_API_KEY` for fluency; with
  no provider configured it falls through to the extractive path rather than inventing one.
  A test asserts every cited chunk's text actually appears in the suggestion.
- **Never auto-sent.** The response carries `action_taken: "none"` and
  `for: "welfare_officer_review"`, and the suggestion ends by telling the officer to
  overrule it where their own knowledge of the person disagrees.

### Acceptance evidence

```
$ docker compose exec ml python -m training.build_policy_index
  starter-welfare-practices: 8 chunks  [NON-AUTHORITATIVE]
indexed 8 chunks -> artifacts/policy_index
WARNING: 8 of 8 chunks are NON-AUTHORITATIVE placeholder text.

$ curl -X POST :8000/recommend -d '{"band":"PRIORITY_REVIEW","shap_categories":{...}}'
authoritative : False
action_taken  : none | for: welfare_officer_review
warning       : At least one retrieved passage comes from a NON-AUTHORITATIVE...
sources       : starter-welfare-practices#chunk1, #chunk2, #chunk4, #chunk5

$ curl ... -d '{"band":"ELEVATED","shap_categories":{...},"user_id":"syn-000034"}'
HTTP 422

$ docker compose exec ml python -m pytest tests/ -q
229 passed
```

Retrieval responds to the categories it is given — an incident-driven pattern and a
leave-driven pattern retrieve different passages, asserted by test, so the SHAP input is
load-bearing rather than decorative.

---

## Post-3.11 round: the three open items

### 1. Model B encoder — switched to IndicBERT v2

`ai4bharat/IndicBERTv2-MLM-only` (github.com/AI4Bharat/IndicBERT, ACL 2023) is **ungated
and reachable**. Only `ai4bharat/indic-bert`, the v1 ALBERT checkpoint, is gated. The
earlier note that "IndicBERT is gated" was too broad — the spec's first-choice family was
available and I settled for the alternate without checking v2.

Both encoders were fine-tuned on identical data and compared:

```
                                     MuRIL   IndicBERTv2
EN macro-F1                         0.7756        0.7940
EN ROC-AUC                          0.8637        0.8783
HI macro-F1                         0.7400        0.7367
HI ROC-AUC                          0.8122        0.8125
total params                   237,557,762   278,042,882
```

A paired bootstrap over the same resampled rows says the gap is **not real**:

```
split       MuRIL  IndicBERTv2     diff    95% CI of the difference
EN         0.7756       0.7940  +0.0184   [-0.0042, +0.0422]  NOT distinguishable
HI         0.7400       0.7367  -0.0033   [-0.0465, +0.0369]  NOT distinguishable
```

So the choice was made on other grounds. IndicBERTv2's 250k vocabulary made it the larger
model, which initially argued for MuRIL — but vocabulary pruning (below) brings both to
~390 MB fp32 (392 vs 387), so size no longer separates them. IndicBERTv2 ships because it
is the spec's first choice and nothing measurable argues against it. **MuRIL is retained at
`artifacts/model_b_muril/`** so the comparison stays reproducible, and the reasoning is
recorded in `model_b_meta.json` under `selected_over`.

### 2. Tenure fairness gap — WITHDRAWN, it was not real

Step 3.10 reported that the system was "least able to see risk in the least experienced
people" (under-5y miss rate 0.621 against 0.461). That was read off point estimates over 58
positive cases.

`tenure_years` is sampled independently in the generator and **never enters the latent
risk**, so no mechanism for such a gap exists. Bootstrap 95% intervals were added to every
cohort rate:

```
under_5y   recall 0.397   CI [0.273, 0.527]   <- contains the overall 0.510
5_to_12y   recall 0.578   CI [0.503, 0.656]
```

The interval contains the overall rate: **not distinguishable from the system average.**
The audit now flags a cohort only when its interval EXCLUDES the overall rate, and warnings
fell from 6 to 1. The survivor is real and explainable — `scenario/baseline` miss rate
0.583 (CI 0.506-0.656), because baseline people who become elevated do so through noise
rather than an injected archetype, which is genuinely harder to detect.

A second correction came out of the same review: the trigger-evidence table was comparing
tau values against already-triggered predictions, so every tau at or above the active one
showed identical results. It now derives from the untriggered baseline.

### 3. Policy corpus — now genuinely sourced

`/recommend` returns `authoritative: true` from the **WHO Guidelines on Mental Health at
Work (2022)**, CC BY-NC-SA 3.0 IGO, extracted verbatim with page numbers preserved. 45 of
134 pages carried actionable guidance.

**The MHA Annual Reports were fetched, parsed and rejected.** Across 718 pages every
welfare-vocabulary match referred to someone other than CAPF personnel: a passenger's
suicide prevented by CISF, morale of the border population, NCRB suicide statistics,
counselling for prison inmates, an NDMA COVID helpline for the public. An earlier filter
indexed them anyway and selected budget tables and an airport lost-property report. Those
citations would have been real and useless — and a retrieval of "CISF prevented a passenger
from committing suicide" in answer to a jawan's risk profile is worse than returning
nothing, because it reads as on-topic. The rejection and its reasons are recorded in the
manifest and the corpus README so the work is not repeated.

Generalisable point: an annual report is a REPORTING document. A corpus answering "what
should this officer consider" needs GUIDANCE documents.

**The claims guard filters at ingest, not output.** Real occupational-health guidance uses
clinical vocabulary that spec 10 forbids in SENTINEL responses. Quoting WHO is not SENTINEL
diagnosing anyone, but relaxing the output guard for "quoted" text would create exactly the
bypass it exists to prevent — anything could be laundered through a citation. So 24 of 48
chunks were withheld at index time and the output guard stays absolute.

### 4. On-device export — size solved, and a gate that was lying to me

**Vocabulary pruning** (`training/prune_model_b_vocab.py`) is the fix the earlier note
called for. A multilingual encoder carries a vocabulary for 17 languages; this classifier
sees two. Tokenise the corpora it actually serves, keep those rows plus specials, rebuild
the model and tokenizer around the reduced table. Retained weights are **bit-identical** —
deletion, not approximation.

```
IndicBERTv2   250,000 -> 15,505 tokens (6.2%)   1112 MB -> 392 MB   delta 0.000000   0% UNK
MuRIL         197,285 -> 13,801 tokens (7.0%)    950 MB -> 387 MB   delta 0.000000   0% UNK
```

Two failures on the way, both instructive:

* `BertTokenizerFast(vocab_file=...)` under transformers 5 **silently ignored the vocab
  file** and emitted a tokenizer holding five tokens. 97% of every input became `[UNK]`
  while the model still returned confident-looking scores. Now the original
  `tokenizer.json` is rewritten in place — preserving normalizer, pre-tokenizer and
  decoder byte-for-byte — and a segmentation-parity assertion fails loudly if it does not
  take.
* `optimum` broke against transformers 5. Replaced with `torch.onnx` +
  `onnxruntime.quantization` directly: one fewer dependency between the weights and the
  artifact.

**Then the parity gate itself turned out to be misleading.** It measured raw score deltas
on five hand-picked probes, which reported a worst delta of 0.0995 and suggested the int8
build was nearly acceptable. Measured properly over the full 715-text held-out set, on the
decision the gate exists to protect:

```
build                        size      override disagreements   worst delta   median
pruned IndicBERT int8      136 MB      47/715  (6.57%)          0.8547        0.0228
pruned IndicBERT fp16      196 MB       0/715  (0.00%)          0.0073        0.0002
```

Five probes said 0.0995; the real distribution said 0.8547. The gate now measures
**override-decision agreement** across the whole set plus the worst delta in the band
around the 0.75 threshold, because that is the property that matters: a 0.10 shift at score
0.42 changes no decision, a 0.02 shift at 0.75 changes one.

Also tried and reverted, both recorded in the source: `reduce_range=True` (worst delta
0.0995 -> 0.1066) and excluding the final encoder layer (0.1850 -> 0.1857 for +21 MB — the
drift is spread evenly across all twelve layers, not concentrated at the end).

**Where this leaves on-device.** fp16 is functionally exact: zero decision disagreements
over 715 texts. It is 196 MB against the 150 MB budget I set in this file — a number I
chose, described at the time as "generous rather than strict". I have not raised it to let
my own build pass. 196 MB is the floor without distillation: the pruned vocabulary is only
24 MB in fp16, so the remaining 170 MB is the encoder itself, and only reducing depth would
shrink it further.

**The decision is a product one:** accept ~196 MB as a one-time cached PWA asset and the
on-device path is done, or distil a smaller student. Until one of those, the privacy claim
must read *"text is discarded immediately after scoring"*, not *"text never leaves the
device"*.

---

## Hardening round: lint, CI, reproducibility

Spec Section 12 asks for "CI (GitHub Actions): lint (ruff + eslint) + run all tests on
push". None of it existed. Building it surfaced four real defects.

### A dependency that only lived in the running container

`onnxconverter-common` — needed by the fp16 on-device export — had been pip-installed into
the live container and never added to the Dockerfile. A fresh `docker compose up --build`
would have produced an image where `--precision fp16` fails. Pinned, along with a proper
audit of every package installed ad hoc during development.

### A TypeScript error nobody was looking for

`npm run lint` had pointed at an eslint that was never installed or configured, and `tsc`
had never been run at all. Adding both immediately found:

```
src/lib/withRole.ts(41,37): error TS7006: Parameter 'tx' implicitly has an 'any' type
```

`Prisma.TransactionClient` is *already* the `Omit`-ed transaction type; re-deriving that
exclusion by hand produced a type that broke inference on the callback. Every database
call in the app tier goes through this function, so it was untyped at the one point where
the role and identity are set.

### Three `zip()` calls that could have misaligned silently

ruff's B905 flagged `zip()` without `strict=`. Two of the three matter:
`zip(FEATURE_ORDER, values)` pairs feature names with SHAP values, and
`zip(documents, metadatas, distances)` pairs a retrieved chunk with its citation. Either
would truncate silently on a length mismatch and produce confident, wrong output — a SHAP
category attributed to the wrong feature, or a quotation attributed to the wrong document.
Now `strict=True`, so a mismatch raises.

### Four tests that would have failed in CI

The CI design rests on a claim: the service runs, and the suite passes, without the
multi-GB frameworks, because every model module checks for its artifact *before* importing
its framework. Rather than assume that, it was tested — a throwaway container with torch,
transformers, sentence-transformers, chromadb and onnxruntime uninstalled:

```
4 failed, 173 passed, 52 skipped
```

Three text/physiological tests in `test_predict.py` were written at step 3.4, when every
model was a stub that always returned a value. Once the models became real, those tests
silently acquired an artifact dependency they never declared. Fixed on both sides: CI now
trains Model C too (scikit-learn only, cheap), and the Model B tests carry a skip marker.

```
190 passed, 39 skipped, 0 failed
```

The 39 skips are exactly the Model B and RAG tests. Full local suite unchanged at 229.

### Repository hygiene

`git init`, and a corrected `.gitignore`. The first version ignored `ml/data/` wholesale,
which would have excluded the policy corpus **manifest** — the provenance record that makes
every citation auditable, and the log of which sources were evaluated and rejected. Source
PDFs and extracted text stay untracked (regenerable, heavy); the manifest and README are
now tracked. `build_policy_index.py` points at the fetch script when a declared document is
absent, which is what a fresh clone sees.

### Result

```
$ ruff check app training data_gen tests      All checks passed!
$ npx eslint .                                clean
$ npx tsc --noEmit                            clean
$ pytest                                      229 passed
$ pytest (CI-equivalent environment)          190 passed, 39 skipped
```

The README was also rewritten: its quick start stopped at `docker compose up`, which does
not produce a working system. It now carries the full sequence, the key-generation command
(the app tier refuses to start without a valid `AES_KEY` rather than storing questionnaires
in plaintext), and a Known Limits section stating the miss rate, the on-device blocker and
the corpus scope caveat up front rather than leaving them to be discovered.

---

## Distilling Model B — a negative result

The on-device blocker had been narrowed to one number: the fp16 export is 196 MB against a
150 MB budget. Vocabulary pruning had already taken the vocabulary out of the problem — the
pruned embedding table is 12,304,128 of the model's 97,950,722 parameters, so what remains
is the 12-layer encoder. Halving it is the only lever left.

```
teacher (12 layers)   97,950,722 params   196 MB fp16
student  (6 layers)   55,423,490 params   111 MB fp16   (57% of the teacher)
```

Size was never in doubt. `training/distil_model_b.py` initialises the student from the
teacher's layers `[1, 3, 5, 7, 9, 11]` — every other layer, ending on the last, because the
classifier head was trained against that layer's output — and trains it against the
teacher's logits (KL at T=2.0, alpha 0.5) as well as the labels. Teacher logits are
precomputed once; the teacher is frozen, so running it every step would only cost time.

**First attempt: every layer trainable, lr 5e-5.**

```
                     student   teacher   95% CI of difference   override disagreements
english               0.7165    0.7940   [-0.1107, -0.0477]     132/715  (18.46%)
hindi (back-transl.)  0.4232    0.7367   [-0.3783, -0.2475]      60/300  (20.00%)
```

Hindi at 0.4232 is close to chance on a binary task, and the asymmetry is the diagnosis:
Dreaddit is English-only, so the model's Hindi behaviour comes entirely from the pretrained
multilingual encoder. The teacher kept it by freezing its embeddings and bottom six layers.
Leaving every student layer trainable and fine-tuning on 2,051 English rows asks the model
to become an English classifier, and it obliged.

**Second attempt: bottom 3 of 6 layers frozen, lr back to 3e-5, and cross-lingual
distillation.** The frozen layers are exactly the ones the teacher never updated — student
positions 0–2 come from teacher layers 1, 3, 5, all inside the teacher's frozen block. The
cross-lingual part exploits a property of distillation: the target is the teacher's logits,
not a label, so the training text needs no annotation and therefore need not be English.
Translating the training split and distilling on both copies asks the student to match the
teacher in Hindi directly. The **training** split only — the Hindi evaluation set is built
from the held-out test split and translating it into training would have made the resulting
number meaningless.

```
                     student   teacher   95% CI of difference   override disagreements
english               0.6627    0.7940   [-0.1687, -0.0940]     192/715  (26.85%)
hindi (back-transl.)  0.6419    0.7367   [-0.1588, -0.0289]      70/300  (23.33%)
```

It did what it was designed to do — Hindi recovered from 0.4232 to 0.6419, and the gap
between the two languages nearly closed (0.6627 vs 0.6419) — and it still fails. English
fell further, and override disagreement got worse on both sets.

**Verdict: rejected, and by its own gate.** `on_device_verdict()` blocks a student on two
conditions: any override-decision disagreement with the server model, and a paired
confidence interval lying entirely below zero. The 6-layer student trips all four checks,
and the script exits non-zero after writing the artifact, the same way the ONNX export gate
does.

Both failures point at the same thing, and it is not the recipe. Task-specific distillation
from a fine-tuned classifier needs enough data to transfer the function; there are 2,051
labelled rows. This is the same constraint that has bounded Model B throughout — the
corpora that would fix it (CLPsych, DAIC-WOZ) are behind data-use agreements. A third
recipe tuned against the same 300 Hindi texts would eventually produce a better number and
a worse model, so the search stops here.

**Where this leaves on-device.** Unchanged, but for a better-understood reason. The choice
is a product one: accept 196 MB fp16 as a one-time cached PWA asset — zero decision
disagreements over 715 texts, functionally exact — or fund encoder distillation over a
large unlabelled Indic corpus, which is weeks of work and a different project. An 8-layer
student would fit at ~139 MB, but on this evidence it would fail the same gate less badly
rather than pass it. Until one is taken, the privacy claim stays *"text is discarded
immediately after scoring"*.

The gate is covered by `tests/test_distillation_gate.py`, including a test carrying the
measured numbers, so the negative result is executable rather than a paragraph someone has
to find.

---

## Sensitivity of the conclusions to the unverified calibration

The generator's distributional constants are marked `[ASSUMPTION]`: plausible working values,
not figures checked against the sources the file header cites. Verifying them needs documents
this project does not have. What can be done is to measure how far the conclusions move when
the assumptions are wrong, which turns *unverified* into *unverified, and bounded by this much*.

They could not be varied at all before this, being ~40 literals inside two function bodies.
They are now a `Calibration` dataclass. The refactor is inert, and that was checked rather than
assumed: regenerating at the default seed reproduces the committed frames byte for byte —
`synthetic_snapshot` (540,000 rows), `synthetic_persons` and `synthetic_physio` all
`DataFrame.equals` the originals.

Each draw scales **every** constant by an independent `U(0.75, 1.25)` and re-runs the whole
pipeline: population, features through the shared module, out-of-fold Model A, re-measure.
One-at-a-time would understate the risk — the worry is not one wrong number, it is a
calibration that is off as a whole. Independent factors rather than one shared factor, because
the band cuts are quantiles and a uniform rescale would be absorbed by them, reporting far more
stability than the design has earned.

```
 draw     auc  linear  tree-lin  best-1f  macro-F1    miss
       0.9444  0.9150    0.0294   0.7904    0.5906  0.4533   <- baseline
    0  0.9655  0.9095    0.0560   0.8072    0.5572  0.4133
    3  0.9253  0.9084    0.0169   0.8080    0.4891  0.5133   <- thinnest tree margin
    4  0.9707  0.9326    0.0381   0.8364    0.5951  0.3767   <- closest to a diagnostic feature
   10  0.9319  0.9070    0.0249   0.7873    0.4996  0.5100
        (12 draws; full table in artifacts/sensitivity_report.json)
```

**All three conclusions hold in all twelve draws. Two of them hold narrowly, and that is the
finding worth carrying forward.**

* **The model ranks usefully** — worst draw 0.9252 against a 0.85 bar. Comfortable; this one is
  not in doubt.
* **A tree beats a linear model** — holds every time, but by 0.0169 to 0.0647 ROC-AUC. The
  honest reading is that XGBoost is *justified but not vindicated*: a scaled logistic regression
  reaches 0.90–0.94 on the same features. The stronger argument for the tree is category-level
  SHAP attribution, which spec 7.1 requires and a linear model does not provide as directly —
  not a large accuracy edge, because there is not one.
* **No single feature is near-diagnostic** — the weakest of the three. Worst draw reaches
  **0.8364** against a 0.85 bar, 0.0014 of headroom in ROC-AUC terms. Under some plausible
  calibrations one column comes close to carrying the task alone. This is a property of the
  synthetic data, not of the model, and it is the assumption most worth checking against a
  primary source before anyone claims the task is genuinely multivariate.

**What this does not show.** It bounds the effect of the constants being wrong. It is not
evidence that they are right, and it says nothing about whether the generator's *structure* —
which stressors interact, and how — resembles real CAPF data. A well-behaved sweep over a
mis-specified structure is still a mis-specified structure.

**One correction made while reading the output.** The sweep's Model A is a bare XGBoost fit with
no isotonic calibrator and no top-band trigger, so it can be retrained thirteen times in a run.
Its metrics are therefore not the shipped model's, and one of them was originally named
`priority_alert_rate` — the same name `evaluate.py` uses for a stricter quantity (people
predicted into the PRIORITY band, not merely flagged). Two different numbers under one name
invites exactly the wrong comparison; it is now `true_priority_flagged_rate`, and the report
carries a `not_the_shipped_pipeline` note. A test asserts the old name cannot reappear in it.

---

## Retention on withdrawal — a default corrected before it shipped

Step 3.8 made consent reversible and left an open question in the report: when
someone withdraws, what happens to physiological data already collected? The
answer the code implied was *withdrawal stops future use, prior rows stay* —
which is simply what falls out of flipping a boolean.

That default was challenged and does not survive scrutiny. Under the DPDP Act
2023 retention is tied to the purpose consented for, and §8 carries an
erasure-on-withdrawal duty. "We stopped using it but kept it" is not a middle
ground; it is holding data with no remaining lawful basis.

The product argument runs the same way and is arguably sharper. Physiological
history belonging to a CAPF constable, retained after they revoked consent,
inside a system connected however indirectly to their chain of command, is
exactly the surveillance fear this design exists to defuse. If it becomes known
that turning the signal off deletes nothing, adoption collapses among the
constabulary — the majority of the force, and the group least inclined to trust
a system tied to their command.

**The policy is now recorded** as spec §9.4 and `docs/DATA_RETENTION.md`, flagged
`<<requires privacy counsel review>>`:

* Raw physiological rows are **erased within 72 hours** of withdrawal, not
  flagged. Model C stops contributing immediately — already structural, since
  the pipeline reads consent from the stored flag and never from a request body.
* A `physioContribution` already fused into a past `Score` is handled separately
  and openly: the Score is kept as welfare-audit history, severed from any raw
  source, and Model C never contributes again without fresh consent. A fused
  value cannot be cleanly unwound; the compromise is named rather than hidden.
* Live-safety retention during an active alert review is a **named, logged,
  time-boxed** exception, never the default.
* The erasure is itself written to the audit trail. An erasure nobody can
  evidence is indistinguishable from one that never happened.

**No code changed, and that is the correct outcome.** `_physio_signals` is
synthetic and training-only, absent from the Prisma schema, and in production the
raw signal never lands server-side at all — so there is no raw physiological
history in this system to erase. The erasure duty attaches to a deployment that
collects real wearable data. Writing code to satisfy a policy that has nothing to
act on would have been theatre.

**One constraint this places on step 3.9:** the transparency screen must not
promise erasure the running system does not perform. It may say the signal is off
by default, can be turned off at any time, and that turning it off stops it being
used. It may not claim deletion of history until a deployment implements the
policy above.

**What remains unresolved, and is above an engineering decision:** service-record
retention rules and possible national-security carve-outs may compel retention in
ways that override this default. Not legal advice, and the implementing Rules are
still settling. A real deployment needs privacy counsel and the force's own
data-governance office. Naming the tension is the honest position; resolving it
here would not be.

---

## IndicBERT v3 evaluated and rejected

`ai4bharat/IndicBERT-v3-270M` — bidirectional Gemma-3, MIT-licensed, 23 languages
— was proposed as a replacement for the Model B encoder. It was fine-tuned on the
same corpus, with the same recipe, and measured against the incumbent on the same
held-out rows. It lost, and on Hindi it did not merely lose.

```
                    v3        IndicBERTv2      paired 95% CI       verdict
english           0.7591        0.7940      [-0.0638, -0.0061]     worse
hindi             0.3243        0.7367      [-0.4633, -0.3535]     DEGENERATE
```

The Hindi figure is not a weak score, it is an absent model. v3 predicted
`no_distress_signal` for **all 300** Hindi inputs, with a probability spread of
**0.0019** — a near-constant output. On English its spread is 0.9994, so it
learned English and has no discriminative signal on Hindi whatsoever. A macro-F1
of 0.32 reads as "bad"; the prediction counts are what show it is broken.

That distinction is now permanent. `training/compare_model_b.py` bootstraps the
*paired* difference between two checkpoints on identical rows, and reports
positive-prediction counts and probability spread alongside it, flagging a
candidate as DEGENERATE before the F1 comparison is even considered. Two macro-F1
numbers from separate runs are not a comparison, and a collapsed classifier
produces a plausible-looking one.

**The confound, stated rather than buried.** The recipe was matched to the
incumbent's exactly — 2 epochs, lr 3e-5, half the layers frozen — so the
comparison would isolate the encoder. But those hyperparameters were tuned for a
278M BERT with 12 layers, and v3 is a 270M Gemma-3 with 18 layers, a 262k-token
embedding table and a freshly initialised head. Two epochs over 2,051 examples is
roughly 512 optimizer steps, which is very few for that. **This is a clean
negative result for v3 under this recipe, not evidence that v3 is a worse
encoder.** Displacing the incumbent would need a run tuned for v3's own
architecture and, more importantly, the real Hindi evaluation set that has been
the binding constraint on Model B throughout — 300 machine-translated posts
cannot settle a question about natural Hindi.

**Decision: keep `ai4bharat/IndicBERTv2-MLM-only`.** The v3 checkpoint and its
metadata stay in `artifacts/` as the record; nothing in the serving path changed.

### A log line that lied

`train_model_b.py` printed `saved -> artifacts/<output>/ and artifacts/model_b_meta.json`
using the module default constant, regardless of `--meta`. A run invoked with
`--meta model_b_indicbert_v3_meta.json` therefore reported that it had written the
incumbent's metadata file, which it had not touched. The file was verified intact
before anything was changed. It now prints the path it actually wrote — a message
that misreports a destructive-looking action invites someone to "restore" a file
that was never damaged.

## Companion design system, implemented

The PWA's visual layer now comes from a design document
(`pwa/design-import/SENTINEL Companion.dc.html`) rather than from shadcn's
defaults with a palette swapped in. The document is committed alongside the code
it produced, because several screens are only explicable by reading it.

**The system.** Warm paper (`#F7F4F1`) and a single owned accent — Ember, a
terracotta used for exactly one action per screen and never for alarm. There is
deliberately no red in the palette to reach for later. Dark is an equal-first
design on a warm charcoal ground (`#191715`), not an inversion: night duty is
when this app is opened most. Type is a real pairing — Bricolage Grotesque for
anchors, Hanken Grotesk for body, JetBrains Mono for the meta labels — with
Anek Devanagari and Mukta for Hindi, at a larger optical size and with the Latin
negative tracking reset so the shirorekha is not crushed.

All five faces are self-hosted through `next/font`. The document links them from
`fonts.googleapis.com`, which is right for a document and wrong for an app that
is already downloading a model; only the two Latin faces are preloaded.

**Four places the design and the running system disagreed.** Each was resolved
towards what the code actually does, because this product's claims are its
premise:

- The Done screen's copy reads "No score, no rating". `tests/copy.test.ts`
  forbids the word *score* in any message file, and `verify-checkin.mjs` asserts
  it never reaches the person. Reworded to "No number, no rating".
- The settings control is labelled "Delete everything on this phone", and wipes
  "answers, notes and recordings". `ClearLocalData` deliberately spares the
  outbox — those are answers the person believes they submitted — and no audio
  recording is ever created. The label now says what the code does.
- The check-in is drawn with six questions. There are nine. A person told "six"
  who then answers nine has been misled by the one screen promising not to.
- "Talk to a welfare officer" appears as a button on two screens. Nothing in this
  app contacts anyone on a person's behalf, so it is rendered as a statement that
  the door exists, not a control that opens it.

**One place the design was right and the code was not.** The check-in screen says
"every answer saves the moment it's tapped", and the home screen offers to resume
an unfinished one. Answers lived in React state, which does not survive a
backgrounded tab on a phone under memory pressure — so both sentences would have
been false. `lib/draft.ts` and a `drafts` store (DB v3) make them true.
`saveDraft` returns whether the write landed, and "Saved on this phone" renders
only on a confirmed `true`: a reassurance shown when the save failed is worse
than none. The journal's save path gained the error state the design draws, and
no longer clears the textarea when saving fails.

**Verification.** `scripts/verify-design.mjs` (new, `npm run verify:design`)
asserts the palette by value rather than checking that colours exist — a token
file that silently fell back to shadcn's defaults would still render a styled
page, just a different product. 17/17. The existing gates were re-run unchanged:
polish 10/10, check-in 8/8, transparency 10/10, offline 9/9, consent 10/10,
on-device 9/9, voice 6/6, i18n 8/8, auth 8/8, installable 10/10, unit tests
31/31.

Lighthouse on a mid-tier mobile profile, with the full type pairing, the ambient
glow and the paper grain: **performance 96, accessibility 100, best practices
100** on both `/login` and `/home`; CLS 0 and 0.001. The budget was ≥ 90.

### A test whose precondition is not established

`verify-checkin.mjs` asserts "the home screen offers the check-in when one is
due", but never arranges for one to be due. Run against an account that had
checked in earlier the same week it reports a failure, and the failure is
correct behaviour — the home screen was showing "Thanks for checking in." The
run against a clean account passes 8/8. Worth fixing by having the test assert
the state it actually finds, rather than by rotating accounts until it is green.

## The Welfare Console

The `frontend-spec` branch was described as a welfare dashboard. It is not one.
It is a second, Lovable-built copy of the *personnel* app — check-in, consent,
privacy, settings — and its `/dashboard` route shows the person a **steadiness
score out of 100 in 6xl type**, plus a wellbeing trend and a weeks-checked-in
streak. That is precisely the thing this product exists not to do: principle 5
is that the person never sees a score, a band or a streak, and `copy.test.ts`
plus `verify-checkin.mjs` enforce it. Its `/inbox` and `/messages` routes are
empty shells with no backend behind them.

So nothing was merged. What was taken from it is the read on what a staff-facing
surface needs to show, and the rest was built against the schema that already
existed.

**The console is in the `api` tier, not the PWA.** The personnel app must never
contain code that can render a band. Keeping the two in one Next app would have
put score-rendering components one import away from the screens whose whole
claim is that no score exists. The api tier already had Prisma, the role helper
and the audited accessors, so the console is four pages over machinery that was
built in step 3.4 and never had a face.

**It is a UI over four database functions, and that is the point.**

| Surface | Accessor | What the database enforces |
|---|---|---|
| Queue | `sentinel_officer_alert_queue()` | own caseload only; logs `VIEW_ALERT_QUEUE` |
| Record | `sentinel_officer_view_scores()` | assigned **and** an alert active; logs the view |
| Record | `sentinel_officer_view_assessments()` | same; dates and language only |
| Units | `sentinel_cohort_summary()` | k-anonymity; commander role alone |

`sentinel_welfare_officer` holds no `SELECT` on `Score`, `Assessment` or
`AuditLog`. An individual welfare row therefore cannot be read without an audit
row being written in the same transaction — not because a handler remembers to
call a logger, but because there is no other way in. Deleting `lib/welfare.ts`
entirely would not weaken it.

One migration was added. The officer role could not read its own audit trail,
so an officer-facing access log would have rendered empty — a screen saying "you
have looked at nothing", which is worse than no screen.
`sentinel_officer_access_log()` is SECURITY DEFINER with the actor filter
written inside it, takes no actor parameter, and is the only route in.

**Design.** Same house as the Companion — identical neutrals, identical type
pairing — in a different register: denser, flatter, built for someone triaging
at a desk rather than someone tired at the end of a shift. Two colour systems
that never touch: teal means *interactive*, and the green→amber→orange→red ramp
means *severity*. The Companion's ember is deliberately absent, because there it
marks the one action per screen and never means alarm; reusing it would make one
colour mean opposite things in two halves of one product. Every band chip
carries its word, so severity never depends on hue alone.

**Verification.** `api/scripts/verify-console.mjs` — 18/18. It proves the
constraints rather than the pixels: a PERSONNEL account cannot sign in, an
unassigned record is refused, an officer cannot reach the aggregate view, a
commander cannot reach an individual, withheld cohorts show no bars and no mean,
and **opening a record writes an audit row the officer can then see**.

### Three bugs worth keeping

`sentinel_officer_access_log(integer)` did not exist as far as Postgres was
concerned: Prisma binds a JS number as `bigint`, and Postgres will not
implicitly cast `bigint` to `integer` when resolving a function. The error is
"function does not exist", which reads like a missing migration. `::int` fixes
it.

The queue test reported **"no records in the queue"** while the page was
returning 500. An empty list and a crashed page look identical to a selector
that counts links, and the reassuring reading won. The test now asserts the page
rendered before it reads anything out of it.

The audit-trail check counted occurrences of `VIEW INDIVIDUAL SCORE` in the log
and asserted the count rose. It passed twice and then failed — correctly, and
not because the write stopped happening: the log is capped at twelve and every
queue view writes an entry of its own, so older individual views fall off the
end while new ones are added. A count was never the right instrument. It now
asserts the newest few rows contain an individual view for the person just
opened.

## Onboarding, and one promise the design could not keep

The design's four onboarding screens are now at `/welcome`, public and before
sign-in: a person deciding whether to trust this should not have to hand over
credentials first. They are linked from the sign-in screen ("Read how this works
first") and skippable from the opening screen — making them mandatory would
prove the reader's point about forms.

No "seen onboarding" flag is stored. A flag keyed to a device hides the promises
from someone reinstalling on a new handset, which is exactly when they would
want to read them again.

The design's fourth screen says **"No name. No number. Just start."** — no
account, no sign-up wall. This build cannot keep the second half: the backend
requires authentication, because RLS is keyed to `sentinel_current_user_id()`
and every privacy guarantee in the product hangs off it. Removing sign-in would
remove the row-level security that makes the rest of the onboarding true.

The first half is kept, because it is true: `PersonnelCredential.loginId` is an
opaque handle by construction, never a name or a service number. So the screen
reads "No name. No service number." and explains that the handle is neither —
which is a smaller claim than the design made, and one the schema enforces.
