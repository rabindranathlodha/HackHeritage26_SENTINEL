// The weekly reminder: when it fires, when it must not, and what it may say.
//
// The requirement that carries the most weight is the negative one — a person
// who never enables it must never receive one — so that is asserted against the
// whole table rather than against one account.

import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import {
  addSubscription,
  dueReminders,
  getPreferences,
  isValidTimeZone,
  markReminderSent,
  removeSubscription,
  setReminder,
  type ReminderSchedule,
} from "../src/lib/preferences.ts";
import { withRole } from "../src/lib/withRole.ts";

const ACTOR = process.env.TEST_OFFICER_ID ?? "off-001";
const ENDPOINT = "https://push.example.invalid/sentinel-test-endpoint";

let subject: string;
let original: ReminderSchedule;
let originalStamp: Date | null = null;

before(async () => {
  const [row] = await withRole("sentinel_admin", ACTOR, (tx) =>
    tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM "User" WHERE role = 'PERSONNEL' ORDER BY id LIMIT 1
    `,
  );
  subject = row.id;
  original = (await getPreferences(subject)).reminder;

  // Clear the delivery system's own stamp before the suite runs.
  //
  // "being reminded once stops them being due again" deliberately sets it, and
  // the person cannot clear it — that grant is withheld on purpose. So without
  // this the suite passes once and then fails for six days, which looks like a
  // regression in the due calculation and is actually a test that did not put
  // the world back. Captured and restored rather than blanked, so a real
  // deployment's stamp survives a test run.
  const [stamp] = await withRole("sentinel_admin", ACTOR, (tx) =>
    tx.$queryRaw<{ lastReminderSentAt: Date | null }[]>`
      SELECT "lastReminderSentAt" FROM "User" WHERE id = ${subject}
    `,
  );
  originalStamp = stamp.lastReminderSentAt;
  await setStamp(null);
});

/** Only sentinel_admin may write this column; the person never can. */
async function setStamp(value: Date | null) {
  await withRole("sentinel_admin", ACTOR, (tx) =>
    tx.$executeRaw`
      UPDATE "User" SET "lastReminderSentAt" = ${value} WHERE id = ${subject}
    `,
  );
}

after(async () => {
  await removeSubscription(subject, ENDPOINT);
  await setReminder(subject, original);
  await setStamp(originalStamp);
});

/** The schedule that makes `subject` due right now, in UTC. */
function nowInUtc(): ReminderSchedule {
  const now = new Date();
  return {
    enabled: true,
    dow: now.getUTCDay(),
    hour: now.getUTCHours(),
    tz: "UTC",
  };
}

test("the reminder is off for everyone who has not asked", async () => {
  const [row] = await withRole("sentinel_admin", ACTOR, (tx) =>
    tx.$queryRaw<{ n: bigint }[]>`
      SELECT count(*) AS n FROM "User" WHERE "weeklyReminderEnabled" IS NOT false
    `,
  );
  assert.equal(Number(row.n), 0, "somebody is scheduled for a reminder they did not ask for");
});

test("enabling without a schedule is refused by the database", async () => {
  // Not just by the form. A reminder that is on with no day or hour either
  // never fires or fires at a default the person did not choose.
  await assert.rejects(
    () =>
      withRole("sentinel_personnel", subject, (tx) =>
        tx.$executeRaw`
          UPDATE "User" SET "weeklyReminderEnabled" = true,
            "weeklyReminderDow" = NULL, "weeklyReminderHour" = NULL,
            "weeklyReminderTz" = NULL
          WHERE id = ${subject}
        `,
      ),
    /user_reminder_complete|violates check constraint/i,
  );
});

test("out-of-range days and hours are refused by the database", async () => {
  for (const [column, value] of [
    ['"weeklyReminderDow"', 7],
    ['"weeklyReminderHour"', 24],
  ] as const) {
    await assert.rejects(
      () =>
        withRole("sentinel_personnel", subject, (tx) =>
          tx.$executeRawUnsafe(
            `UPDATE "User" SET ${column} = ${value} WHERE id = $1`,
            subject,
          ),
        ),
      /violates check constraint/i,
      `${column} = ${value} was accepted`,
    );
  }
});

test("a person with no device is never due, however they are scheduled", async () => {
  await removeSubscription(subject, ENDPOINT);
  await setReminder(subject, nowInUtc());

  const due = await dueReminders(ACTOR);
  assert.ok(
    !due.some((row) => row.userId === subject),
    "scheduled with no push endpoint, yet reported as due",
  );
});

test("a scheduled person with a device is due at their own local hour", async () => {
  await setReminder(subject, nowInUtc());
  await addSubscription(subject, {
    endpoint: ENDPOINT,
    p256dh: "test-p256dh",
    auth: "test-auth",
    locale: "hi",
  });

  const due = await dueReminders(ACTOR);
  const mine = due.find((row) => row.userId === subject);
  assert.ok(mine, "due at the scheduled hour but not returned");
  assert.equal(mine.endpoint, ENDPOINT);
  assert.equal(mine.locale, "hi", "the language rides with the device");
});

test("an hour that is not theirs is not due", async () => {
  const now = new Date();
  await setReminder(subject, {
    enabled: true,
    dow: now.getUTCDay(),
    // Three hours away in either direction, so this never collides with now.
    hour: (now.getUTCHours() + 3) % 24,
    tz: "UTC",
  });

  const due = await dueReminders(ACTOR);
  assert.ok(!due.some((row) => row.userId === subject), "due at the wrong hour");
});

test("the timezone is the person's, not the server's", async () => {
  // Scheduled for the hour it currently is in Kolkata. On a UTC server that is
  // a different clock hour, so a naive implementation reading the server's own
  // time would find nobody due.
  const kolkataHour = Number(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Kolkata",
      hour: "numeric",
      hour12: false,
    }).format(new Date()),
  ) % 24;
  const kolkataDow = new Date(
    new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" }),
  ).getDay();

  await setReminder(subject, {
    enabled: true,
    dow: kolkataDow,
    hour: kolkataHour,
    tz: "Asia/Kolkata",
  });

  const due = await dueReminders(ACTOR);
  assert.ok(
    due.some((row) => row.userId === subject),
    "a person in Asia/Kolkata was not due at their own local hour",
  );
});

test("being reminded once stops them being due again in the same week", async () => {
  await setReminder(subject, nowInUtc());
  assert.ok((await dueReminders(ACTOR)).some((row) => row.userId === subject));

  await markReminderSent(ACTOR, [subject]);

  assert.ok(
    !(await dueReminders(ACTOR)).some((row) => row.userId === subject),
    "a second dispatch in the same hour would have sent a duplicate",
  );
});

test("turning the reminder off clears the schedule rather than parking it", async () => {
  await setReminder(subject, nowInUtc());
  const off = await setReminder(subject, {
    enabled: false,
    dow: null,
    hour: null,
    tz: null,
  });

  assert.equal(off.enabled, false);
  assert.equal(off.dow, null, "a stored day nothing reads is a setting they cannot see");
  assert.equal(off.hour, null);
  assert.equal(off.tz, null);
  assert.ok(!(await dueReminders(ACTOR)).some((row) => row.userId === subject));
});

test("the reminder role cannot read a single welfare row", async () => {
  // The point of a purpose-limited role, asserted rather than described. The
  // process that reaches a person's lock screen has no path to a score.
  for (const table of ["Score", "Assessment", "Alert", "HrSignal", "AuditLog"]) {
    await assert.rejects(
      () =>
        withRole("sentinel_reminder", ACTOR, (tx) =>
          tx.$queryRawUnsafe(`SELECT * FROM "${table}" LIMIT 1`),
        ),
      `sentinel_reminder can read "${table}"`,
    );
  }
});

test("a person cannot clear their own last-sent stamp", async () => {
  // It is the delivery system's bookkeeping. Someone who could reset it could
  // make the dispatcher send the same reminder over and over.
  await assert.rejects(
    () =>
      withRole("sentinel_personnel", subject, (tx) =>
        tx.$executeRaw`
          UPDATE "User" SET "lastReminderSentAt" = NULL WHERE id = ${subject}
        `,
      ),
    "a person was able to rewrite the dispatcher's own bookkeeping",
  );
});

test("time zones are validated before they reach SQL", () => {
  // now() AT TIME ZONE <junk> raises inside the dispatcher, which would turn
  // one person's bad input into everybody else's missed reminder.
  assert.equal(isValidTimeZone("Asia/Kolkata"), true);
  assert.equal(isValidTimeZone("UTC"), true);
  assert.equal(isValidTimeZone("Mars/Olympus_Mons"), false);
  assert.equal(isValidTimeZone("'; DROP TABLE \"User\"; --"), false);
});
