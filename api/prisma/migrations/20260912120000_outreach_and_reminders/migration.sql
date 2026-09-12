-- Outreach preference and the weekly reminder.
--
-- Two separate things that are easy to confuse, so they are named apart here
-- and everywhere else:
--
--   allowWelfareOutreach  — may an officer CONTACT me uninvited?
--   biometricConsent      — may the wellness signal be USED about me?
--
-- Neither is a switch for being noticed. Nothing in this migration suppresses
-- an alert, and the console shows a PRIORITY_REVIEW alert whatever the outreach
-- preference says. Describing the toggle as "stop monitoring me" would be a
-- lie that gets somebody hurt: a person who believed it would turn it on and
-- assume nothing was being computed.

-- ---------------------------------------------------------------------------
-- Columns
-- ---------------------------------------------------------------------------

ALTER TABLE "User"
  ADD COLUMN IF NOT EXISTS "allowWelfareOutreach"  BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "weeklyReminderEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "weeklyReminderDow"     INTEGER,
  ADD COLUMN IF NOT EXISTS "weeklyReminderHour"    INTEGER,
  ADD COLUMN IF NOT EXISTS "weeklyReminderTz"      TEXT,
  ADD COLUMN IF NOT EXISTS "lastReminderSentAt"    TIMESTAMP(3);

COMMENT ON COLUMN "User"."allowWelfareOutreach" IS
  'Whether an assigned welfare officer may proactively contact this person. '
  'Off by default. It governs CONTACT, never DETECTION: alerts are still '
  'raised and a PRIORITY_REVIEW alert is still shown to the officer, who is '
  'told the person has not consented to being approached and uses judgement.';

COMMENT ON COLUMN "User"."weeklyReminderEnabled" IS
  'Off by default. A person who never enables it must never receive one.';

COMMENT ON COLUMN "User"."weeklyReminderTz" IS
  'IANA zone. The schedule is stored in the person''s local terms rather than '
  'as a UTC instant so it survives a transfer or a DST change without anybody '
  'recomputing it.';

-- Ranges, enforced here rather than only in the form. A day-of-week of 9 is
-- not a validation failure someone should be able to reach by any route.
ALTER TABLE "User" DROP CONSTRAINT IF EXISTS "user_reminder_dow_range";
ALTER TABLE "User" ADD CONSTRAINT "user_reminder_dow_range"
  CHECK ("weeklyReminderDow" IS NULL OR "weeklyReminderDow" BETWEEN 0 AND 6);

ALTER TABLE "User" DROP CONSTRAINT IF EXISTS "user_reminder_hour_range";
ALTER TABLE "User" ADD CONSTRAINT "user_reminder_hour_range"
  CHECK ("weeklyReminderHour" IS NULL OR "weeklyReminderHour" BETWEEN 0 AND 23);

-- A reminder that is on but has no schedule either never fires or fires at a
-- default the person did not pick. Both are worse than refusing the write.
ALTER TABLE "User" DROP CONSTRAINT IF EXISTS "user_reminder_complete";
ALTER TABLE "User" ADD CONSTRAINT "user_reminder_complete"
  CHECK (
    NOT "weeklyReminderEnabled"
    OR (
      "weeklyReminderDow" IS NOT NULL
      AND "weeklyReminderHour" IS NOT NULL
      AND "weeklyReminderTz" IS NOT NULL
    )
  );

-- The person sets their own preferences. Column-scoped for the same reason the
-- biometric grant is: a table-wide UPDATE would let someone set their own role
-- to COMMANDER or reassign their welfare officer, turning a settings screen
-- into privilege escalation. The existing user_self_consent policy already
-- restricts WHICH row may be updated; these grants restrict which columns.
GRANT UPDATE (
  "allowWelfareOutreach",
  "weeklyReminderEnabled",
  "weeklyReminderDow",
  "weeklyReminderHour",
  "weeklyReminderTz"
) ON "User" TO sentinel_personnel;

-- Deliberately NOT granted to the person: lastReminderSentAt is the delivery
-- system's own bookkeeping, and a person who could clear it could make the
-- dispatcher send the same reminder repeatedly.

-- ---------------------------------------------------------------------------
-- Push subscriptions
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "PushSubscription" (
  "id"        TEXT NOT NULL,
  "userId"    TEXT NOT NULL,
  "endpoint"  TEXT NOT NULL,
  "p256dh"    TEXT NOT NULL,
  "auth"      TEXT NOT NULL,
  -- Which language to send in. Held here rather than on "User" so the reminder
  -- role learns it without being granted another column on the person's row.
  "locale"    TEXT NOT NULL DEFAULT 'en',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "failedAt"  TIMESTAMP(3),
  CONSTRAINT "PushSubscription_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "PushSubscription"
  ADD COLUMN IF NOT EXISTS "locale" TEXT NOT NULL DEFAULT 'en';

CREATE UNIQUE INDEX IF NOT EXISTS "PushSubscription_endpoint_key"
  ON "PushSubscription"("endpoint");
CREATE INDEX IF NOT EXISTS "PushSubscription_userId_idx"
  ON "PushSubscription"("userId");

ALTER TABLE "PushSubscription" DROP CONSTRAINT IF EXISTS "PushSubscription_userId_fkey";
ALTER TABLE "PushSubscription" ADD CONSTRAINT "PushSubscription_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- The reminder sender's role
-- ---------------------------------------------------------------------------
--
-- Sending a notification is a system action with no business knowing anything
-- about welfare. This role is the narrowest in the system: it can read the six
-- scheduling columns on "User" and the push endpoints, and write back one
-- timestamp. It has NO privilege on Score, Assessment, Alert, HrSignal or
-- AuditLog, and cannot even read a person's role or unit.
--
-- Stated as a property rather than an intention: the process that reaches a
-- person's lock screen cannot see a single welfare row.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sentinel_reminder') THEN
    CREATE ROLE sentinel_reminder NOLOGIN;
  END IF;
END
$$;

-- INHERIT FALSE, as with every other app role: policies match on inherited
-- membership, so an inheriting login would silently collect this role's
-- policies on top of whichever role it had chosen.
GRANT sentinel_reminder TO sentinel_app WITH INHERIT FALSE;
GRANT USAGE ON SCHEMA public TO sentinel_reminder;

-- Column-scoped SELECT. Not "SELECT on User" — that would hand the notifier
-- welfareOfficerId, unitId, role and biometricConsent, none of which it needs.
GRANT SELECT (
  "id",
  "weeklyReminderEnabled",
  "weeklyReminderDow",
  "weeklyReminderHour",
  "weeklyReminderTz",
  "lastReminderSentAt"
) ON "User" TO sentinel_reminder;

GRANT UPDATE ("lastReminderSentAt") ON "User" TO sentinel_reminder;

REVOKE ALL ON "PushSubscription" FROM PUBLIC;
GRANT SELECT, INSERT, DELETE ON "PushSubscription" TO sentinel_personnel;
GRANT SELECT ON "PushSubscription" TO sentinel_reminder;
GRANT UPDATE ("failedAt") ON "PushSubscription" TO sentinel_reminder;

ALTER TABLE "PushSubscription" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PushSubscription" FORCE ROW LEVEL SECURITY;

-- A person manages only their own devices.
DROP POLICY IF EXISTS push_self_read ON "PushSubscription";
CREATE POLICY push_self_read ON "PushSubscription" FOR SELECT TO sentinel_personnel
  USING ("userId" = sentinel_current_user_id());

DROP POLICY IF EXISTS push_self_write ON "PushSubscription";
CREATE POLICY push_self_write ON "PushSubscription" FOR INSERT TO sentinel_personnel
  WITH CHECK ("userId" = sentinel_current_user_id());

DROP POLICY IF EXISTS push_self_delete ON "PushSubscription";
CREATE POLICY push_self_delete ON "PushSubscription" FOR DELETE TO sentinel_personnel
  USING ("userId" = sentinel_current_user_id());

-- The dispatcher reads every endpoint, because it sends to every due person.
DROP POLICY IF EXISTS push_reminder_read ON "PushSubscription";
CREATE POLICY push_reminder_read ON "PushSubscription" FOR SELECT TO sentinel_reminder
  USING (true);

DROP POLICY IF EXISTS push_reminder_retire ON "PushSubscription";
CREATE POLICY push_reminder_retire ON "PushSubscription" FOR UPDATE TO sentinel_reminder
  USING (true) WITH CHECK (true);

-- No policy for sentinel_welfare_officer, sentinel_commander or
-- sentinel_scoring. An officer cannot enumerate a person's devices, and the
-- scoring pipeline has no reason to know a phone exists.

DROP POLICY IF EXISTS user_reminder_read ON "User";
CREATE POLICY user_reminder_read ON "User" FOR SELECT TO sentinel_reminder
  USING (true);

DROP POLICY IF EXISTS user_reminder_stamp ON "User";
CREATE POLICY user_reminder_stamp ON "User" FOR UPDATE TO sentinel_reminder
  USING (true) WITH CHECK (true);
