# Policy corpus

The RAG recommendation engine (spec Section 11) retrieves from the documents here. Every
document must be declared in `manifest.json` with its provenance — the index builder
refuses anything undeclared, and refuses any entry missing a publisher or source URL. An
untraceable chunk cannot be cited, so it does not get indexed.

Rebuild after any change:

```bash
docker compose exec ml python -m training.fetch_policy_corpus
docker compose exec ml python -m training.build_policy_index
```

## What is in here now

| Document | Publisher | Licence | Authoritative |
|---|---|---|---|
| Guidelines on Mental Health at Work (2022) | World Health Organization | CC BY-NC-SA 3.0 IGO | yes |

Fetched verbatim from the published PDF, page numbers preserved so any citation can be
checked against the original. 45 of 134 pages carried actionable guidance; of the chunks
those produced, **24 were withheld by the clinical-claims guard** (see below) and 24 were
indexed.

**Scope caveat, stated plainly:** this is generic workplace guidance, not CAPF policy. It
is evidence-graded and directly relevant to workload, psychosocial risk, manager training
and return to work — but it does not know anything about deployment rotation, leave
sanction chains, or force-specific welfare provision. Force-specific circulars would be a
strict improvement and are not publicly downloadable.

## Sources evaluated and REJECTED

Do not re-add these without reading why they were dropped.

**MHA Annual Reports 2023-24 and 2021-22.** Authentic, authoritative, public — and
containing no personnel-welfare guidance whatsoever. Across 718 pages, every
welfare-vocabulary match referred to someone other than CAPF personnel:

- "CISF personnel prevented 01 passenger from committing suicide" — a traveller
- "SSB ... set up to build up the morale ... of the border population" — civilians
- "NCRB ... publishes Accidental Deaths and Suicides in India" — statistics
- "counselling/therapies ... support to prison inmates" — prisoners
- "NDMA had initiated Psychosocial Care Helpline for people testing positive for COVID 19"
  — the public

An earlier version of the fetcher indexed them anyway on a looser keyword filter and
selected budget tables and an airport lost-property report. Those citations would have been
real and useless. A retrieval of "CISF prevented a passenger from committing suicide" in
answer to a jawan's risk profile is worse than returning nothing, because it reads as
on-topic.

The generalisable point: an annual report is a **reporting** document — it records what was
spent and what happened. A corpus that answers "what should this officer consider" needs
**guidance** documents.

## The clinical-claims guard filters at ingest

Real occupational-health guidance uses clinical vocabulary that spec Section 10 forbids in
SENTINEL responses. Quoting WHO is not SENTINEL diagnosing anyone — but relaxing the output
guard to permit "quoted" text would create exactly the bypass the guard exists to prevent,
since anything could then be laundered through a citation.

So chunks carrying forbidden terms are **never indexed**, and the output guard stays
absolute. The corpus can only ever answer in language the system is permitted to use. This
costs coverage — half the WHO chunks — and that is the correct trade.

## Adding force-specific sources

Add an entry to `SOURCES` in `training/fetch_policy_corpus.py` (for anything fetchable) or
drop a `.md`/`.txt` file in and add a manifest entry by hand:

```json
{
  "id": "crpf-welfare-circular-2024",
  "title": "CRPF welfare and grievance-redress circular",
  "publisher": "Central Reserve Police Force",
  "source_url": "https://crpf.gov.in/...",
  "retrieved_on": "2026-09-07",
  "licence": "Government of India open publication",
  "authoritative": true,
  "file": "crpf_welfare_circular.md"
}
```

Worth pursuing, none openly downloadable at the time of writing:

| Document | Where |
|---|---|
| Standing Committee on Home Affairs, Demands for Grants — CAPF welfare, leave and rotation sections | https://sansad.in/rs/committees |
| Parliamentary answers on CAPF leave policy and counselling provision | Lok Sabha / Rajya Sabha question archives |
| CRPF welfare and grievance-redress circulars | https://crpf.gov.in |
