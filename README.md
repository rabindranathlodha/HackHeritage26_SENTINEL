# SENTINEL — Backend & ML/NLP

Predictive personnel welfare-risk system for uniformed forces (SIH26186). Backend API, three
ML/NLP models, synthetic data pipeline, and the privacy layer.

> Surfaces elevated welfare-risk indicators for human review. Not a clinical diagnosis.

---

## Contents

- [What you need](#what-you-need)
- [First-time setup](#first-time-setup)
- [Everyday commands](#everyday-commands)
- [The pipeline, stage by stage](#the-pipeline-stage-by-stage)
- [Using the API](#using-the-api)
- [Tests, lint, CI](#tests-lint-ci)
- [Configuration](#configuration)
- [Troubleshooting](#troubleshooting)
- [Project layout](#project-layout)
- [How it works](#how-it-works)
- [Known limits](#known-limits)

---

## What you need

- Docker Desktop (or Docker Engine + Compose v2)
- ~12 GB free disk if you train Model B; ~3 GB otherwise
- Node 22 and Python 3.12 on the host only if you want to lint outside Docker

Everything else runs in containers. You do not need Python or Postgres installed locally.

---

## First-time setup

**1. Environment file.**

```bash
cp .env.example .env
```

`.env.example` ships placeholders for the secrets. Generate real values:

```bash
python -c "import base64,os;print('AES_KEY='+base64.b64encode(os.urandom(32)).decode());print('NEXTAUTH_SECRET='+base64.b64encode(os.urandom(32)).decode());print('SENTINEL_APP_PASSWORD='+base64.urlsafe_b64encode(os.urandom(24)).decode().rstrip('='))"
```

Paste the three lines into `.env`, replacing the placeholders. `AES_KEY` must decode to
exactly 32 bytes — the app tier refuses to start otherwise rather than writing
questionnaires in plaintext.

**2. Start the stack.**

```bash
docker compose up -d --build
```

Four containers: `sentinel-db` (Postgres 16), `sentinel-redis`, `sentinel-ml` (FastAPI),
`sentinel-api` (Next.js). First build pulls PyTorch and takes 10-20 minutes.

**3. Database.**

```bash
./scripts/bootstrap_db.sh
```

Applies all seven migrations, including the row-level security policies, then sets the
login password for `sentinel_app` from your `.env`.

**4. Data and models.**

```bash
docker compose exec ml python -m data_gen.generate_synthetic --n 3000 --days 180
docker compose exec ml python -m training.train_model_a
docker compose exec ml python -m training.train_model_c
docker compose exec ml python -m data_gen.score_population --limit 600 --reset
```

Roughly 10 minutes total. Check it worked:

```bash
curl http://localhost:8000/health
# {"status":"ok","models_loaded":{"a":true,"b":false,"c":true}}
```

`b:false` is correct — Model B is optional and not trained yet.

**5. Optional extras.**

```bash
docker compose exec ml python -m training.train_model_b        # 1-2 h on CPU
docker compose exec ml python -m training.evaluate             # bias audit + PR curve
docker compose exec ml python -m training.fetch_policy_corpus  # downloads WHO guidance
docker compose exec ml python -m training.build_policy_index   # enables /recommend
```

---

## Everyday commands

| Task | Command |
|---|---|
| Start | `docker compose up -d` |
| Stop (keep data) | `docker compose stop` |
| Stop and remove containers | `docker compose down` |
| Wipe everything including the database | `docker compose down -v` |
| Rebuild after a dependency change | `docker compose build ml && docker compose up -d ml` |
| Follow logs | `docker compose logs -f ml` |
| Shell into the ML service | `docker compose exec ml bash` |
| psql | `docker compose exec db psql -U sentinel -d sentinel` |
| Redis CLI | `docker compose exec redis redis-cli` |

After `docker compose down -v` you must redo steps 3 and 4 — the database is gone.

Source is bind-mounted, so editing `ml/app/**` reloads automatically. Editing
`ml/training/**` or `ml/data_gen/**` needs no restart either (they run as one-off commands).
Adding a Python dependency needs a rebuild.

---

## The pipeline, stage by stage

Each stage writes artifacts the next one reads. Run them in this order.

### Generate synthetic data

```bash
docker compose exec ml python -m data_gen.generate_synthetic --n 3000 --days 180
```

3,000 personnel with 180 days of daily HR signals each. Writes `User` and `HrSignal` to
Postgres, plus `_ground_truth` and `_physio_signals` — two training-only tables deliberately
absent from the Prisma schema, so no application code can read the hidden label. Also drops
parquet snapshots in `ml/artifacts/`.

Options: `--n`, `--days`, `--seed`, `--no-write-db`.

### Train Model A (behavioural)

```bash
docker compose exec ml python -m training.train_model_a
```

XGBoost over the 12 engineered features, calibrated on a held-out split, with SHAP folded
into six categories. Prints per-class precision/recall — accuracy is meaningless at 70/20/7/3
prevalence. Writes `model_a.json`, `model_a_calibrator.joblib`, `model_a_meta.json`.

### Train Model C (physiological)

```bash
docker compose exec ml python -m training.train_model_c
```

Per-person baseline deviation over the consenting subset. One training row per person-day,
split by person so nobody's baseline leaks across the split.

### Train Model B (self-report text)

```bash
docker compose exec ml python -m training.train_model_b --epochs 2
```

Fine-tunes `ai4bharat/IndicBERTv2-MLM-only` on Dreaddit, then evaluates English and Hindi
separately. Slow on CPU. Use `--base-model google/muril-base-cased` to train the alternate.

### Score the population

```bash
docker compose exec ml python -m data_gen.score_population --limit 600 --reset
```

Runs people through the real pipeline at three historical cut-offs, so score history exists
for trend detection and cohort aggregates. `--reset` is required when re-running.

### Bias audit

```bash
docker compose exec ml python -m training.evaluate --folds 5
```

Out-of-fold over everyone, with bootstrap confidence intervals on every cohort rate. Writes
`pr_curve.png` and `evaluation_report.json`.

### Calibration sensitivity

```bash
docker compose exec ml python -m training.sensitivity --draws 12
```

Perturbs every `[ASSUMPTION]` constant by ±25% at once and re-runs the whole pipeline per
draw, to show which conclusions depend on the unverified calibration. Offline analysis, not
part of CI: 13 full regenerate-and-retrain cycles take ~40 minutes. Writes
`sensitivity_report.json`.

### Policy corpus

```bash
docker compose exec ml python -m training.fetch_policy_corpus
docker compose exec ml python -m training.build_policy_index
```

Downloads the WHO mental-health-at-work guidance, keeps the pages carrying actionable
guidance, and embeds them into a local Chroma store. See
`ml/data/policy_corpus/README.md` for how to add force-specific sources.

### On-device export (optional, not yet shippable)

```bash
docker compose exec ml python -m training.prune_model_b_vocab
docker compose exec ml python -m training.export_model_b_onnx \
  --model-dir artifacts/model_b_pruned --out artifacts/model_b_onnx_pruned --precision fp16
```

See [Known limits](#known-limits).

---

## Using the API

### Health

```bash
curl http://localhost:8000/health      # ML service
curl http://localhost:3000/api/health  # app tier
```

### Submit an assessment (the main path)

```bash
curl -X POST http://localhost:3000/api/assessments \
  -H 'content-type: application/json' \
  -d '{"userId":"syn-000034","responses":[3,2,3,2]}'
```

Returns the fused score, band, confidence interval, SHAP categories, which signals were
used, and whether a pending review was raised.

With a self-report and wearable readings:

```bash
curl -X POST http://localhost:3000/api/assessments \
  -H 'content-type: application/json' \
  -d '{
    "userId": "syn-000034",
    "responses": [3,2,3,2],
    "text": "I have not been sleeping and there is nobody here I can talk to.",
    "language": "en",
    "signals": {"resting_hr":82,"hrv_ms":24,"sleep_hours":4.6,"sleep_efficiency":0.68},
    "baseline": {"resting_hr_mean":66,"resting_hr_sd":3.2,"hrv_ms_mean":52,"hrv_ms_sd":7.5,
                 "sleep_hours_mean":6.9,"sleep_hours_sd":0.6,
                 "sleep_efficiency_mean":0.885,"sleep_efficiency_sd":0.035}
  }'
```

Non-ASCII text through a shell is easy to corrupt. Put the body in a file and use
`--data-binary @body.json`.

### Individual model endpoints

```bash
curl -X POST http://localhost:8000/predict/text \
  -H 'content-type: application/json' \
  -d '{"user_id":"u1","text":"I cannot sleep at all any more.","language":"en"}'

curl -X POST http://localhost:8000/predict/physiological \
  -H 'content-type: application/json' \
  -d '{"user_id":"u1","consent":false}'
# {"score_c":null,"used":false}  <- correct, not an error

curl -X POST http://localhost:8000/predict/fusion \
  -H 'content-type: application/json' \
  -d '{"user_id":"u1","score_a":0.2,"score_b":0.85}'
```

### Cohort aggregates (commander view)

```bash
curl -X POST http://localhost:8000/cohort/summary \
  -H 'content-type: application/json' -d '{}'
```

Cohorts below k=10 come back as a refusal object with no figures.

### Recommendations

```bash
curl -X POST http://localhost:8000/recommend \
  -H 'content-type: application/json' \
  -d '{"band":"ELEVATED","shap_categories":{"leave_pattern":0.5,"deployment_load":0.3}}'
```

Adding `user_id` returns 422 — the schema forbids identifying fields.

Full contracts: `docs/API_CONTRACT.md`.

---

## Tests, lint, CI

```bash
docker compose exec ml python -m pytest -v                                  # 229 tests
docker compose exec ml python -m pytest tests/test_privacy.py -v            # one file
docker compose exec ml ruff check app training data_gen tests
docker compose exec ml ruff check app training data_gen tests --fix

cd api && npx eslint . && npx tsc --noEmit
```

Tests that need an artifact you have not built skip rather than fail, so a partial setup
still gives a meaningful run.

GitHub Actions (`.github/workflows/ci.yml`) lints, then builds a real system — Postgres with
the RLS migrations, a generated dataset, Models A and C — and runs the suite against it. The
privacy guarantees cannot be checked against a mock. Model B and the RAG index are skipped
there because they are multi-GB.

---

## Configuration

| Variable | Purpose |
|---|---|
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | Database owner credentials, used for migrations and seeding only |
| `POSTGRES_HOST_PORT` | Host port for Postgres, default 55432 |
| `DATABASE_URL` | Owner connection. Migrations, seeding and training. Never the request path |
| `SENTINEL_APP_DATABASE_URL` | Request-path login. No privileges until it `SET ROLE`s |
| `SENTINEL_APP_PASSWORD` | Password for that login, applied by `bootstrap_db.sh` |
| `AES_KEY` | 32 bytes base64. Field encryption for questionnaire answers. No default |
| `NEXTAUTH_SECRET` | Session signing for the app tier |
| `REDIS_URL` | Alert queue |
| `ML_SERVICE_URL` | Where the app tier finds the ML service |
| `K_ANONYMITY_THRESHOLD` | Seeds the value in `PrivacyConfig`; the database column is what enforces |
| `LLM_API_KEY` | Optional. Without it `/recommend` quotes retrieved text directly |
| `ARTIFACTS_DIR` | Where models are read and written, default `artifacts` |

---

## Troubleshooting

**`ports are not available: 0.0.0.0:5432`** — Windows/Hyper-V reserves `5342-5441`. Already
handled by mapping to 55432; set `POSTGRES_HOST_PORT` if 55432 is also taken.

**`AES_KEY is not set; refusing to store plaintext`** — the app tier will not fall back.
Generate a key as in setup and `docker compose up -d --force-recreate api`.

**`permission denied for table Score`** — something ran without `SET ROLE`, or a `SET LOCAL
ROLE` was lost at a `commit()`. The login has no privileges by design; this is the system
working, not a misconfiguration.

**`prisma migrate dev` wants to reset the database** — it detects the training-only tables.
Use `npx prisma migrate deploy`, which is what `bootstrap_db.sh` runs.

**`no policy index at artifacts/policy_index`** — run `fetch_policy_corpus` then
`build_policy_index`. `/recommend` returns 503 until then.

**`manifest names ... but it is not present`** — corpus source files are regenerable and not
committed. Run `fetch_policy_corpus`.

**503 from a predict endpoint** — that model is not trained. Check `/health`; the flags are
honest.

**Docker Hub pull failures** — transient CDN errors. Retry `docker compose pull`.

**Tests hang** — a previous run left a lock. `docker compose restart db`.

---

## Project layout

```
ml/
  app/
    models/          model A, B, C, fusion, load registry
    routers/         health, predict, cohort, recommend
    schemas/         request/response types
    privacy/         claims guard, k-anonymity
    services/        feature pipelines, SHAP categories, escalation, RAG
    config.py        band thresholds, disclaimer, trigger tau
    db.py            role-scoped connections
  training/          offline scripts, never imported by the service
  data_gen/          synthetic generator and batch scorer
  tests/             229 tests
  artifacts/         trained models (gitignored)
  data/policy_corpus manifest and README tracked; sources are not
api/
  prisma/            schema and seven migrations, RLS in raw SQL
  src/lib/           prisma client, withRole, field encryption
  src/app/api/       route handlers
docs/                build log, API contract, deployment economics
```

---

## How it works

A person's daily HR signals become 12 engineered features (one shared module, used by both
training and serving). Model A scores those. Model B scores a self-report if one was
submitted; Model C scores wearable readings if the person consented and their device sent a
baseline. Fusion combines whatever exists, never letting a weak signal lower the score, and
raises the band if the self-report is high. If the result lands in PRIORITY_REVIEW, or the
person's scores are trending up, a `PENDING_REVIEW` alert is created for their assigned
welfare officer.

Nothing contacts anyone. Row-level security means a commander cannot read an individual
welfare row at all, an officer reaches one only through an audited function, and the scoring
pipeline can write scores without being able to read any.

---

## Known limits

- **About half of elevated-risk people are missed** (miss rate 0.49); 64.4% of the
  highest-risk band is surfaced. Detection is tunable — see `docs/DEPLOYMENT_ECONOMICS.html`
  for the workload/detection curve.
- **On-device Model B is not shippable, and distillation did not rescue it.** fp16 is
  functionally exact but 196 MB against a 150 MB budget; int8 fits at 136 MB but flips
  6.6% of override decisions. Vocabulary pruning already removed the vocabulary from the
  problem — the pruned embedding table is 12.3M of 98M parameters, so the remaining
  overshoot is encoder depth. A 6-layer student (55.4M parameters, 111 MB fp16) was trained
  and **rejected by its own gate**: it disagreed with the server model on 27% of override
  decisions and was measurably worse in both languages. With 2,051 labelled training rows
  there is not enough signal to transfer the teacher's function to a shallower model. The
  remaining choice is a product one — accept 196 MB as a one-time cached asset, or invest
  in encoder distillation over a large unlabelled corpus. Until one is taken, the privacy
  claim is "text is discarded immediately after scoring", not "text never leaves the
  device". See `training/distil_model_b.py` and `docs/BUILD_LOG.md`.
- **The policy corpus is generic workplace guidance**, not CAPF policy. MHA Annual Reports
  were evaluated and rejected as reporting rather than guidance documents.
- **Synthetic calibration is unverified, but now bounded.** The ranges are still plausible
  working values marked `[ASSUMPTION]`, not figures checked against the cited sources.
  `training/sensitivity.py` perturbs all ~40 constants at once by ±25% and re-runs the whole
  pipeline 12 times: the model still ranks usefully (worst ROC-AUC 0.9252), a tree still beats
  a linear baseline (by 0.017–0.065 — justified, but a scaled logistic regression reaches
  0.90–0.94 on the same features), and no single feature becomes diagnostic (worst 0.8364
  against a 0.85 bar, which is the narrowest of the three). This bounds the effect of the
  assumptions being wrong; it is not evidence they are right, and says nothing about whether
  the generator's *structure* resembles real data.
- **Model B is English-trained.** Hindi performance is measured on machine translations, a
  lower bound that does not capture code-mixing.
