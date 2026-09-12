# SENTINEL — demo runbook

Everything below was verified running, end to end, immediately before this was
written. No mock data anywhere: every figure on screen comes out of Postgres,
computed by the models.

## Start

```bash
cd sentinel
docker compose up -d          # db, redis, ml, api
cd pwa && npm run build && npx next start -p 3100
```

| Surface | URL |
|---|---|
| Personnel Companion (the phone app) | http://localhost:3100 |
| Welfare Console (the officer's desk) | http://localhost:3000/welfare |
| ML service health | http://localhost:8000/health |

## Logins

| Who | ID | Password |
|---|---|---|
| Constable — check-in still due | `syn-003000` | `demo2026` |
| Constable — already checked in | `syn-000000` | `demo2026` |
| Welfare officer | `off-001` | `console-demo-7k3x` |
| Commander | `cmd-001` | `console-demo-7k3x` |

Issue more: `docker compose exec -T -e DATABASE_URL="postgresql://sentinel:sentinel@db:5432/sentinel" api node prisma/issue-credentials.ts --user <id> --password <pw> --rotate`

---

## The five-minute run

### 1. The promise, before the person signs in — `localhost:3100/welcome`

Four screens, one promise each. Screen three names what the commander never
sees. Screen four is honest about what sign-in costs: no name, no service number
— the login id is an opaque handle by construction.

### 2. A person checks in — sign in as `syn-003000`

This account was created for the demo and has **never checked in**: no
assessments, no scores, no alerts, no HR history. Home greets them with "How are
you doing this week?" and offers the check-in. Nothing was fabricated for them —
the only rows that exist are the account and its password hash.

Nine questions, one per screen. Point at two things:

- **"Saved on this phone"** appears under an answer only once the write to
  IndexedDB came back true. Leave mid-way, come back, the answers are there.
- **The done screen shows no number.** Not a score, not a band, not a streak.
  That is the product's first principle, and there is a test that fails the
  build if a score field ever reaches the browser.

### 3. Show that it landed

```bash
docker compose exec -T db psql -U sentinel -d sentinel \
  -c 'select "userId", "submittedAt", language from "Assessment" order by "submittedAt" desc limit 3;'
```

And that the answers are unreadable at rest:

```bash
docker compose exec -T db psql -U sentinel -d sentinel \
  -c 'select encode(substring("responsesEnc" from 1 for 24), :hex) from "Assessment" order by "submittedAt" desc limit 1;'
```

*(replace `:hex` with `'"'"'hex'"'"'` — field-level AES-256, spec §9.3)*

### 4. The backend actually computing — one curl

```bash
TOKEN=$(grep '^INTERNAL_API_TOKEN=' .env | cut -d= -f2)
curl -s -X POST http://localhost:3000/api/assessments \
  -H "content-type: application/json" -H "x-internal-token: $TOKEN" \
  -d '{"userId":"syn-000010","responses":[2,3,3,2,3,2,3,3,2],
       "text":"Long stretch on the perimeter. Not sleeping much and leave was turned down again.",
       "language":"en"}'
```

Returns a real fused result — Model A on the questionnaire, Model B on the text,
weighted fusion, a confidence interval, category-level SHAP, and the required
disclaimer. A `Score` row is written by the same call.

This is the route for the demo and the dashboard. **The phone app does not use
it** — the Companion posts a pre-computed number to `/api/assessment` and gets
back no score at all.

### 5. The officer's side — `localhost:3000/welfare`, sign in as `off-001`

16 alerts, triaged by band then by how long someone has waited. Open one:

- The indicator, **with its plausible range drawn as a band** rather than
  printed beside a number.
- **What moved it** — category contributions only, never the words anyone wrote.
- A blue notice at the top: opening this record has been recorded.
- The contact preference, above the buttons.

Then go back to the queue and look at **Your access log** — the view you just
made is in it. That row was written by the database, inside the same
transaction, because the officer role holds no `SELECT` on `Score` at all. The
only way in is through an accessor that logs first.

### 6. The refusal, which is the best thing to show

Sign out, sign in as `cmd-001`. A commander lands on **Units**, never a
caseload — enforced in middleware, and the database would refuse them anyway.

37 units show their spread. **3 units are withheld**, each saying why: fewer
than 10 scored members, so nothing is shown — not the size, not the spread, not
an average. Not a rounded number, not an empty row. A visible refusal.

Then try typing an individual's URL as the commander. It bounces.

### 7. If asked "is it really bilingual"

Language toggles on both apps. The Companion has its own Devanagari type at a
larger optical size; the console switches the whole queue and the refusal text.

---

## Numbers as at this run

| | |
|---|---|
| Personnel in the synthetic cohort | 3,000 |
| Scores computed | 1,827 |
| Alerts awaiting review | 16 |
| Units visible / withheld | 37 / 3 |
| Audit rows | 276+ |
| Models loaded | A, B, C |

## Tests, if a judge asks

```bash
cd api && npm test                 # 42, against the live database
cd pwa && npm test                 # 31
cd api && npm run verify:console   # 25 browser checks
cd pwa && npm run verify:checkin   # the end-to-end integration gate
```

## The three sentences worth memorising

1. **The person never sees a score.** Two tests fail the build if one reaches
   the browser, and the API the phone talks to does not return one.
2. **Raw journal text never leaves the phone.** It is read by an ONNX model
   in-browser; only a single number is sent. A test inspects every outgoing
   request.
3. **An officer cannot read a welfare row without writing an audit row.** Not by
   convention — the role has no `SELECT` on those tables. Deleting our
   application code would not weaken it.
