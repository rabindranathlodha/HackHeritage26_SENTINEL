# API tier tests

These run against a **live database**, on purpose.

The bugs they exist for are binding-level and privilege-level: a JavaScript
number arriving as `bigint`, a role that cannot read a table, a trigger that
refuses a write. None of those reproduce against a mock, and two of them
reproduce differently under `psql` than under Prisma — which is exactly how the
access-log bug survived a green test run.

```bash
docker compose up -d db api
docker compose exec -T -e DATABASE_URL="postgresql://sentinel:sentinel@db:5432/sentinel" \
  api node prisma/seed-console.ts          # once, for an officer with a caseload

SENTINEL_APP_DATABASE_URL="postgresql://sentinel_app:<password>@localhost:55432/sentinel" \
  npm test
```

`<password>` is `SENTINEL_APP_PASSWORD` from the repo `.env`. The tests connect
as `sentinel_app`, the same least-privilege login the request path uses, so a
missing GRANT fails here the way it would fail in production.
