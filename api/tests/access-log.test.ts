// Regression test for the officer access log's parameter binding.
//
// The bug: `sentinel_officer_access_log(integer)` reported "function does not
// exist" at runtime while the function was plainly there in the database. The
// cause was not a missing migration — it was that Prisma binds a JavaScript
// number as `bigint`, and PostgreSQL will not implicitly cast bigint to integer
// when resolving a function overload. The error message points at the wrong
// thing, which is why it cost time.
//
// THIS TEST MUST GO THROUGH PRISMA. A psql test passes while the app fails,
// because psql sends an untyped literal that Postgres coerces happily. Running
// the same SQL through a different binding path is not testing the bug — it is
// testing a different query that happens to share a name.
//
// Needs a live database:
//   SENTINEL_APP_DATABASE_URL=postgresql://sentinel_app:<pw>@localhost:55432/sentinel \
//     node --test tests/access-log.test.ts

import assert from "node:assert/strict";
import { test } from "node:test";

import { myAccessLog } from "../src/lib/welfare.ts";
import { withRole } from "../src/lib/withRole.ts";

// Seeded by prisma/seed-console.ts. The officer only needs to exist — the
// accessor filters to the caller and returns an empty list if they have looked
// at nothing, which is still a successful call.
const OFFICER = process.env.TEST_OFFICER_ID ?? "off-001";

test("the access log is callable through Prisma with a JavaScript number", async () => {
  const rows = await myAccessLog(OFFICER, 12);
  assert.ok(Array.isArray(rows), "expected an array of audit rows");
});

test("a non-default limit binds too, not just the default", async () => {
  // The original failure was visible only for an explicit limit, because the
  // default is applied inside Postgres and never crosses the binding boundary.
  const rows = await myAccessLog(OFFICER, 3);
  assert.ok(Array.isArray(rows));
  assert.ok(rows.length <= 3, `asked for 3, got ${rows.length}`);
});

test("the bug is real: the same call without the cast still fails", async () => {
  // A test that only proves the fixed path works cannot tell you whether the
  // fix is what is doing the work. This asserts the failure mode itself, so if
  // someone removes `::int` believing it to be decorative, the suite says why
  // it was there.
  //
  // If this ever starts passing, somebody has changed the function signature to
  // accept bigint. That is a legitimate choice — but then the cast at the call
  // site is the thing that should go, and it should go everywhere at once. Do
  // not have both conventions in the codebase.
  await assert.rejects(
    () =>
      withRole("sentinel_welfare_officer", OFFICER, (tx) =>
        tx.$queryRaw`SELECT * FROM sentinel_officer_access_log(${12})`,
      ),
    (error: unknown) =>
      error instanceof Error && /does not exist/i.test(error.message),
    "expected an uncast JS number to fail function resolution",
  );
});
