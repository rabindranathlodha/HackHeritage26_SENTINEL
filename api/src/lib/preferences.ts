import { withRole } from "./withRole.ts";

// A person's own settings: who may contact them, and when to remind them.
//
// Everything here runs as sentinel_personnel with the person's own id, so the
// row policy and the column grants decide what is permitted. There is no
// "userId" parameter that an API caller could point at somebody else — the id
// comes from the session and is used as the acting identity, which is the same
// thing RLS checks against.

export type ReminderSchedule = {
  enabled: boolean;
  /** 0 = Sunday .. 6 = Saturday. Null when the reminder is off. */
  dow: number | null;
  /** 0-23, the person's own local hour. Null when the reminder is off. */
  hour: number | null;
  /** IANA zone. Null when the reminder is off. */
  tz: string | null;
};

export type Preferences = {
  allowWelfareOutreach: boolean;
  reminder: ReminderSchedule;
  /** How many devices are subscribed to push. Never the endpoints themselves. */
  devices: number;
};

type PreferenceRow = {
  allowWelfareOutreach: boolean;
  weeklyReminderEnabled: boolean;
  weeklyReminderDow: number | null;
  weeklyReminderHour: number | null;
  weeklyReminderTz: string | null;
};

/**
 * True if the runtime recognises this as a real IANA zone.
 *
 * Checked before it reaches SQL, because `now() AT TIME ZONE <junk>` raises
 * inside the dispatcher — which would turn one person's bad input into a
 * failure that stops everybody else's reminder.
 */
export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export async function getPreferences(userId: string): Promise<Preferences> {
  return withRole("sentinel_personnel", userId, async (tx) => {
    const [row] = await tx.$queryRaw<PreferenceRow[]>`
      SELECT "allowWelfareOutreach", "weeklyReminderEnabled",
             "weeklyReminderDow", "weeklyReminderHour", "weeklyReminderTz"
      FROM "User" WHERE id = ${userId}
    `;
    const [{ n }] = await tx.$queryRaw<{ n: bigint }[]>`
      SELECT count(*) AS n FROM "PushSubscription"
      WHERE "userId" = ${userId} AND "failedAt" IS NULL
    `;

    return {
      allowWelfareOutreach: row?.allowWelfareOutreach ?? false,
      reminder: {
        enabled: row?.weeklyReminderEnabled ?? false,
        dow: row?.weeklyReminderDow ?? null,
        hour: row?.weeklyReminderHour ?? null,
        tz: row?.weeklyReminderTz ?? null,
      },
      devices: Number(n),
    };
  });
}

/** Returns what the database now holds, not what was asked for. */
export async function setOutreach(userId: string, allow: boolean): Promise<boolean> {
  return withRole("sentinel_personnel", userId, async (tx) => {
    await tx.$executeRaw`
      UPDATE "User" SET "allowWelfareOutreach" = ${allow} WHERE id = ${userId}
    `;
    const [row] = await tx.$queryRaw<{ allowWelfareOutreach: boolean }[]>`
      SELECT "allowWelfareOutreach" FROM "User" WHERE id = ${userId}
    `;
    return row.allowWelfareOutreach;
  });
}

/**
 * Sets the reminder schedule.
 *
 * Turning it off clears the schedule rather than keeping it "for later". A
 * stored day and hour that nothing reads is a setting the person cannot see
 * and did not ask to keep.
 */
export async function setReminder(
  userId: string,
  next: ReminderSchedule,
): Promise<ReminderSchedule> {
  const dow = next.enabled ? next.dow : null;
  const hour = next.enabled ? next.hour : null;
  const tz = next.enabled ? next.tz : null;

  return withRole("sentinel_personnel", userId, async (tx) => {
    await tx.$executeRaw`
      UPDATE "User"
      SET "weeklyReminderEnabled" = ${next.enabled},
          "weeklyReminderDow"     = ${dow},
          "weeklyReminderHour"    = ${hour},
          "weeklyReminderTz"      = ${tz}
      WHERE id = ${userId}
    `;
    const [row] = await tx.$queryRaw<PreferenceRow[]>`
      SELECT "allowWelfareOutreach", "weeklyReminderEnabled",
             "weeklyReminderDow", "weeklyReminderHour", "weeklyReminderTz"
      FROM "User" WHERE id = ${userId}
    `;
    return {
      enabled: row.weeklyReminderEnabled,
      dow: row.weeklyReminderDow,
      hour: row.weeklyReminderHour,
      tz: row.weeklyReminderTz,
    };
  });
}

export type PushKeys = { endpoint: string; p256dh: string; auth: string; locale: string };

/** Idempotent: re-subscribing the same device refreshes it rather than duplicating. */
export async function addSubscription(userId: string, sub: PushKeys): Promise<void> {
  await withRole("sentinel_personnel", userId, async (tx) => {
    // DELETE then INSERT rather than ON CONFLICT DO UPDATE: the person holds
    // INSERT and DELETE on this table but not UPDATE, and widening that grant
    // to support an upsert would let them edit another column later.
    await tx.$executeRaw`
      DELETE FROM "PushSubscription"
      WHERE "endpoint" = ${sub.endpoint} AND "userId" = ${userId}
    `;
    await tx.$executeRaw`
      INSERT INTO "PushSubscription" (id, "userId", endpoint, p256dh, auth, locale)
      VALUES (${`ps-${crypto.randomUUID()}`}, ${userId}, ${sub.endpoint},
              ${sub.p256dh}, ${sub.auth}, ${sub.locale})
    `;
  });
}

export async function removeSubscription(userId: string, endpoint: string): Promise<void> {
  await withRole("sentinel_personnel", userId, async (tx) => {
    await tx.$executeRaw`
      DELETE FROM "PushSubscription"
      WHERE "endpoint" = ${endpoint} AND "userId" = ${userId}
    `;
  });
}

export type DueReminder = {
  userId: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  locale: string;
};

/**
 * Everyone whose local time is the hour they asked for, with a live device.
 *
 * The timezone arithmetic is done by Postgres against each person's own zone
 * rather than in JavaScript against the server's, so a server in UTC and a
 * constable in Kolkata agree about when 19:00 is.
 *
 * The six-day floor on lastReminderSentAt is what makes a dispatcher that runs
 * every ten minutes safe: the first run in the matching hour sends, and the
 * five after it find the stamp already set. It is six rather than seven so a
 * DST shift or a slightly late run cannot skip a week entirely.
 */
export async function dueReminders(actorId: string): Promise<DueReminder[]> {
  return withRole("sentinel_reminder", actorId, async (tx) => {
    return tx.$queryRaw<DueReminder[]>`
      WITH local AS (
        SELECT u.id,
               u."lastReminderSentAt" AS last,
               u."weeklyReminderDow"  AS dow,
               u."weeklyReminderHour" AS hr,
               (now() AT TIME ZONE u."weeklyReminderTz") AS lt
        FROM "User" u
        WHERE u."weeklyReminderEnabled"
      )
      SELECT l.id AS "userId", p.endpoint, p.p256dh, p.auth, p.locale
      FROM local l
      JOIN "PushSubscription" p ON p."userId" = l.id AND p."failedAt" IS NULL
      WHERE EXTRACT(DOW FROM l.lt) = l.dow
        AND EXTRACT(HOUR FROM l.lt) = l.hr
        AND (l.last IS NULL OR l.last < now() - interval '6 days')
    `;
  });
}

export async function markReminderSent(actorId: string, userIds: string[]): Promise<void> {
  if (userIds.length === 0) return;
  await withRole("sentinel_reminder", actorId, async (tx) => {
    await tx.$executeRaw`
      UPDATE "User" SET "lastReminderSentAt" = now()
      WHERE id = ANY(${userIds}::text[])
    `;
  });
}

/**
 * Marks an endpoint dead after the push service rejects it.
 *
 * Kept rather than deleted so a device that has been uninstalled stops being
 * retried forever, and so the person's settings screen can still say honestly
 * how many live devices they have.
 */
export async function retireSubscription(actorId: string, endpoint: string): Promise<void> {
  await withRole("sentinel_reminder", actorId, async (tx) => {
    await tx.$executeRaw`
      UPDATE "PushSubscription" SET "failedAt" = now() WHERE endpoint = ${endpoint}
    `;
  });
}
