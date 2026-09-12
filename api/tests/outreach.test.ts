// The outreach preference: what it governs, and what it must never govern.
//
// This is a safety decision before it is a feature, so the tests are written
// against the rule rather than the widget. The rule:
//
//   - It controls whether an officer CONTACTS someone, never whether the system
//     NOTICES them. Alerts are raised the same either way.
//   - Below PRIORITY_REVIEW with the preference off, the officer is told to
//     hold off.
//   - At PRIORITY_REVIEW the alert is still shown, and the officer is told the
//     person did not agree to be approached.
//
// The last one is the one worth having a test for. Suppressing the highest
// severity signal on a preference toggle is an easy, kind-looking change for
// somebody to make later, and it could cost a life.

import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { alertQueue, outreachGuidance, type RiskBand } from "../src/lib/welfare.ts";
import { getPreferences, setOutreach } from "../src/lib/preferences.ts";
import { withRole } from "../src/lib/withRole.ts";

const OFFICER = process.env.TEST_OFFICER_ID ?? "off-001";

let subject: string;
let original: boolean;

before(async () => {
  const queue = await alertQueue(OFFICER);
  assert.ok(
    queue.length > 0,
    `${OFFICER} has no caseload; run prisma/seed-console.ts before this suite`,
  );
  subject = queue[0].userId;
  original = (await getPreferences(subject)).allowWelfareOutreach;
});

after(async () => {
  // Leave the account as we found it. A test that silently flips somebody's
  // contact preference and leaves it flipped is a test that changed the
  // product's behaviour for a person.
  await setOutreach(subject, original);
});

test("outreach is off until the person turns it on", async () => {
  const [row] = await withRole("sentinel_admin", OFFICER, (tx) =>
    tx.$queryRaw<{ n: bigint }[]>`
      SELECT count(*) AS n FROM "User"
      WHERE role = 'PERSONNEL' AND "allowWelfareOutreach" IS NOT false
    `,
  );
  assert.equal(
    Number(row.n),
    0,
    "some personnel default to allowing outreach; it must be opt-in",
  );
});

test("the preference never decides whether an alert exists", async () => {
  const before = await alertQueue(OFFICER);
  const bandOf = new Map(before.map((alert) => [alert.userId, alert.band]));

  await setOutreach(subject, false);
  const withOutreachOff = await alertQueue(OFFICER);

  assert.equal(
    withOutreachOff.length,
    before.length,
    "turning outreach off changed how many alerts the officer can see",
  );
  assert.equal(
    withOutreachOff.find((alert) => alert.userId === subject)?.band,
    bandOf.get(subject),
    "turning outreach off changed the band",
  );
});

test("a PRIORITY_REVIEW alert is shown even when outreach is refused", async () => {
  await setOutreach(subject, false);
  const queue = await alertQueue(OFFICER);
  const priority = queue.filter((alert) => alert.band === "PRIORITY_REVIEW");

  // Not an assumption about the seed: if there are none, say so rather than
  // pass silently on an empty set.
  assert.ok(
    priority.length > 0,
    "no PRIORITY_REVIEW alert in the queue, so this test proved nothing",
  );

  for (const alert of priority) {
    const guidance = outreachGuidance(alert.band, false);
    assert.equal(guidance.mayContact, true, "severity must leave the decision open");
    assert.equal(guidance.overridden, true, "the officer must be told it was overridden");
    assert.equal(guidance.tone, "judgement");
  }
});

test("below priority, a refused preference means do not approach", () => {
  for (const band of ["LOW", "MODERATE", "ELEVATED"] as RiskBand[]) {
    const guidance = outreachGuidance(band, false);
    assert.equal(guidance.mayContact, false, `${band} should hold off`);
    assert.equal(guidance.overridden, false);
    assert.equal(guidance.tone, "hold");
  }
});

test("agreeing to contact reads the same at every band", () => {
  for (const band of ["LOW", "MODERATE", "ELEVATED", "PRIORITY_REVIEW"] as RiskBand[]) {
    const guidance = outreachGuidance(band, true);
    assert.equal(guidance.mayContact, true);
    assert.equal(guidance.overridden, false, "nothing was overridden; they agreed");
    assert.equal(guidance.tone, "clear");
  }
});

test("the guidance never hides an alert", () => {
  // There is no return value that means "do not show this". If somebody adds
  // one, this fails and asks them to explain themselves.
  const tones = new Set<string>();
  for (const band of ["LOW", "MODERATE", "ELEVATED", "PRIORITY_REVIEW"] as RiskBand[]) {
    for (const allow of [true, false]) {
      tones.add(outreachGuidance(band, allow).tone);
    }
  }
  assert.deepEqual([...tones].sort(), ["clear", "hold", "judgement"]);
});

test("a person can set their own preference and nobody else's", async () => {
  await setOutreach(subject, true);
  assert.equal((await getPreferences(subject)).allowWelfareOutreach, true);

  // Acting as the subject, try to change somebody else. The row policy scopes
  // UPDATE to their own id, so this must affect zero rows rather than raise —
  // silently changing nothing is the correct outcome of a policy, and the
  // assertion is that the other person is untouched.
  const other = (await alertQueue(OFFICER)).map((a) => a.userId).find((id) => id !== subject);
  assert.ok(other, "need a second person in the queue for this test");

  const beforeOther = (await getPreferences(other)).allowWelfareOutreach;
  await withRole("sentinel_personnel", subject, (tx) =>
    tx.$executeRaw`
      UPDATE "User" SET "allowWelfareOutreach" = true WHERE id = ${other}
    `,
  );
  assert.equal(
    (await getPreferences(other)).allowWelfareOutreach,
    beforeOther,
    "one person changed another person's contact preference",
  );
});

test("the column grant does not let a person change anything else", async () => {
  // The grant is column-scoped precisely so a settings screen cannot become
  // privilege escalation. Postgres checks column privileges independently of
  // row policies, so this is refused outright rather than filtered to zero rows.
  await assert.rejects(
    () =>
      withRole("sentinel_personnel", subject, (tx) =>
        tx.$executeRaw`UPDATE "User" SET role = 'COMMANDER' WHERE id = ${subject}`,
      ),
    "a person was able to change their own role",
  );

  await assert.rejects(
    () =>
      withRole("sentinel_personnel", subject, (tx) =>
        tx.$executeRaw`
          UPDATE "User" SET "welfareOfficerId" = NULL WHERE id = ${subject}
        `,
      ),
    "a person was able to reassign their welfare officer",
  );
});
