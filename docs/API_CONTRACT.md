# SENTINEL API Contract

Authoritative source: `SENTINEL_BUILD_SPEC.md` Section 5.

> Every response passes through the clinical-claims middleware before it leaves the
> process. A forbidden term anywhere in the payload — including in a field name — fails
> the request with a 500 rather than shipping.

## ML service

### `GET /health` (spec 5.5)

```json
{ "status": "ok", "models_loaded": { "a": false, "b": false, "c": false } }
```

`models_loaded` reports the **true** in-process load state. While a model is a stub its
flag stays `false`: A becomes true at step 3.5, C at 3.6, B at 3.7.

### `POST /predict/structured` (spec 5.1) — Model A

Request `{ "user_id": str, "features": { ...the 12 fields... } }`
Response `{ "score_a": float, "band": RiskBand, "shap_categories": { ...6 categories... } }`

`shap_categories` is **category level only** — never a raw feature name, never a date,
never an event detail. Malformed or incomplete features return 422.

### `POST /predict/text` (spec 5.2) — Model B

Request `{ "user_id": str, "text": str, "language": str }`
Response `{ "score_b": float, "language_detected": str }`

The raw text is never persisted and never echoed back. In production the text is processed
on-device and only the derived contribution is transmitted; this endpoint serves the demo
path and on-device parity testing.

### `POST /predict/physiological` (spec 5.3) — Model C

Request `{ "user_id": str, "consent": bool, "signals": {...} | null }`
Response `{ "score_c": float | null, "used": bool }`

Without consent or signals: `{ "score_c": null, "used": false }` with **HTTP 200**. This is
a normal outcome, not an error. Consent is evaluated server-side against the stored flag —
supplying signals in the request does not grant it.

### `POST /predict/fusion` (spec 5.4) — the main endpoint

Request `{ "user_id": str, "score_a": float, "score_b": float|null, "score_c": float|null,
"shap_categories": {} }`

Response `{ "sentinel_score", "band", "confidence": {low, high}, "override_fired",
"shap_categories", "disclaimer" }`

Weights renormalise over whichever signals are present, so a missing signal is not counted
as a zero. `disclaimer` is required on every response.

`confidence.low/high` are on the **same 0-100 scale as `sentinel_score`**. The interval
widens both when the available signals disagree and when there are fewer of them — a single
signal has nothing to corroborate it, so it is reported as less certain, not more.

Two behaviours beyond the literal 7.5 arithmetic, both added because a measurement showed
the literal version scoring people below what the evidence warranted (see BUILD_LOG 3.6,
3.7, 3.8):

* **Non-dilution floor.** The fused score is never below `score_a`. A weak corroborating
  signal can raise concern but cannot lower it, so consenting to biometrics can never
  reduce a person's score.
* **Self-report override.** `score_b > 0.75` with a band below ELEVATED raises the band one
  tier and sets `override_fired: true`.

### `POST /internal/features/structured?user_id=...` — NOT part of Section 5

Engineers the 12 features from a person's HR history.

Added because spec 7.1 requires one shared feature module and the app tier is TypeScript;
without this endpoint the app tier would need a second implementation of the feature
windows, which is train/serve skew by construction. The dashboard never calls it. Returns
404 when the person has no history.

## App tier

### `GET /api/health`

`{ "status": "ok", "ml_service_reachable": bool }` — a real probe, not a claim.

### `POST /api/assessments`

Request `{ "userId", "responses": int[] (Likert 0-3), "text"?, "language"?, "signals"? }`

Orchestrates: consent read → feature engineering → Model A → Model B (if text supplied) →
Model C (if consented) → fusion → persist Assessment and Score → return the score with
`signals_used` and the disclaimer.

Returns 422 on non-Likert responses and 404 on an unknown person. No code path in this
handler contacts a person or notifies a commander.

Database access is least-privilege throughout: the consent read and the Assessment insert
run as `sentinel_personnel` (row-level security scopes both to the submitter themselves),
and the Score insert runs as `sentinel_scoring`, which can write a score but cannot read
anyone's.

### `POST /recommend` (spec Section 11)

Request `{ "band": RiskBand, "shap_categories": { ...category: weight... } }`

Response `{ "suggestion", "sources": [{citation, title, publisher, source_url,
authoritative}], "authoritative", "warning", "action_taken", "for" }`

**The request schema forbids extra fields.** A body carrying `user_id`, `name`, `unit_id`,
`text` or `date` is rejected with **422** — spec 11 allows category-level context only, and
rejecting is better than silently stripping, which would leave the caller believing they
had sent it.

The suggestion is assembled from retrieved passages verbatim, each with its citation, so
every sentence is traceable to a source chunk. `authoritative` is `false` — with an explicit
`warning` — whenever any retrieved chunk comes from a non-authoritative corpus. The corpus
shipped in this repository is a labelled placeholder; see `ml/data/policy_corpus/README.md`.

`action_taken` is always `"none"`. Nothing is sent to anyone.
