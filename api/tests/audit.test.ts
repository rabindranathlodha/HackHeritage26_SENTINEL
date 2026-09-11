// Regression test for the audit trail.
//
// The bug: the acceptance check counted occurrences of "VIEW INDIVIDUAL SCORE"
// in the officer's rendered access log and asserted the count rose. It passed
// twice and then failed — and the failure was not a failure to write. The log
// is capped for display, and every queue view writes an entry of its own, so on
// a repeat run older individual views scroll off the end while new ones are
// still being written. The count was flat; the writes were fine.
//
// A count was never the right instrument. This asserts IDENTITY: the exact row,
// matching actor, action, target and a timestamp after this test began.
//
// Needs a live database and a seeded officer with a caseload:
//   SENTINEL_APP_DATABASE_URL=... node --test tests/audit.test.ts

import assert from "node:assert/strict";
import { before, test } from "node:test";

import { alertQueue, myAccessLog, personScores } from "../src/lib/welfare.ts";
import { withRole } from "../src/lib/withRole.ts";

const OFFICER = process.env.TEST_OFFICER_ID ?? "off-001";

/** Read back as sentinel_admin — the only role granted SELECT on "AuditLog". */
async function auditRows(query: {
  actorId: string;
  action: string;
  targetUserId: string;
  since: Date;
}) {
  return withRole("sentinel_admin", query.actorId, (tx) =>
    tx.$queryRaw<{ id: string; action: string; targetUserId: string; at: Date }[]>`
      SELECT id, action, "targetUserId", at
      FROM "AuditLog"
      WHERE "actorId" = ${query.actorId}
        AND action = ${query.action}
        AND "targetUserId" = ${query.targetUserId}
        AND at >= ${query.since}
      ORDER BY at DESC
    `,
  );
}

async function storedCount(actorId: string): Promise<number> {
  const [row] = await withRole("sentinel_admin", actorId, (tx) =>
    tx.$queryRaw<{ n: bigint }[]>`
      SELECT count(*) AS n FROM "AuditLog" WHERE "actorId" = ${actorId}
    `,
  );
  return Number(row.n);
}

let target: string;

before(async () => {
  const queue = await alertQueue(OFFICER);
  assert.ok(
    queue.length > 0,
    `${OFFICER} has no caseload; run prisma/seed-console.ts before this suite`,
  );
  target = queue[0].userId;
});

test("opening a record writes exactly the audit row we expect", async () => {
  // Postgres timestamps are millisecond precision; step back one so a row
  // written in the same millisecond as the read is not excluded by `>=`.
  const since = new Date(Date.now() - 1);

  await personScores(OFFICER, target);

  const rows = await auditRows({
    actorId: OFFICER,
    action: "VIEW_INDIVIDUAL_SCORE",
    targetUserId: target,
    since,
  });

  assert.equal(
    rows.length,
    1,
    `expected exactly one VIEW_INDIVIDUAL_SCORE for ${target} since the test began, got ${rows.length}`,
  );
  assert.ok(rows[0].at >= since, "the row predates the action that should have written it");
});

test("reading assessments writes its own distinct row, not a shared one", async () => {
  const since = new Date(Date.now() - 1);

  await personScores(OFFICER, target);

  const scoreRows = await auditRows({
    actorId: OFFICER,
    action: "VIEW_INDIVIDUAL_SCORE",
    targetUserId: target,
    since,
  });
  const assessmentRows = await auditRows({
    actorId: OFFICER,
    action: "VIEW_INDIVIDUAL_ASSESSMENT",
    targetUserId: target,
    since,
  });

  assert.equal(scoreRows.length, 1);
  assert.equal(
    assessmentRows.length,
    0,
    "a score read must not be recorded as an assessment read",
  );
});

test("the cap of 12 is a display limit, never a storage limit", async () => {
  // The distinction matters beyond tidiness. If the trail evicted rows, the
  // "every access is recorded" guarantee in the transparency screen and in the
  // spec would be false for anyone whose officer looks at enough records —
  // which is precisely the officer worth auditing. So this proves the rows
  // survive past the display window rather than assuming it.
  const before = await storedCount(OFFICER);

  for (let i = 0; i < 14; i += 1) {
    await personScores(OFFICER, target);
  }

  const after = await storedCount(OFFICER);
  assert.ok(
    after >= before + 14,
    `14 reads should have written 14 rows; stored went ${before} -> ${after}`,
  );
  assert.ok(after > 12, "the storage test is vacuous below the display cap");

  const displayed = await myAccessLog(OFFICER, 12);
  assert.equal(displayed.length, 12, "the display limit should still cap at 12");
});

test("the audit trail is append-only: no role can delete from it", async () => {
  // The guarantee is not "we do not delete", it is "we cannot". There is no
  // DELETE policy for any role, so this fails closed even for an admin.
  await assert.rejects(
    () =>
      withRole("sentinel_admin", OFFICER, (tx) =>
        tx.$executeRaw`DELETE FROM "AuditLog" WHERE "actorId" = ${OFFICER}`,
      ),
    "an audit trail that can be deleted is not an audit trail",
  );
});
