import webpush from "web-push";

import { offendingTerms, reminderCopy } from "../content/notifications.ts";
import {
  dueReminders,
  markReminderSent,
  retireSubscription,
  type DueReminder,
} from "./preferences.ts";

// Sending the weekly reminder.
//
// The whole job is: find who asked to be reminded, at the hour they asked for,
// and put six fixed words on their phone. Everything interesting about it is
// what it deliberately does not do — it does not read a score, does not vary
// its message, does not escalate, and cannot contact anybody who did not ask.
//
// It runs as sentinel_reminder, which holds six scheduling columns and the push
// endpoints and nothing else. That is not a convention this file maintains; it
// is what the role is granted.

export type DispatchResult = {
  due: number;
  sent: number;
  retired: number;
  failed: number;
};

/** Fails closed: no keys, no sending. */
function configureVapid(): boolean {
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT;
  if (!publicKey || !privateKey || !subject) return false;
  webpush.setVapidDetails(subject, publicKey, privateKey);
  return true;
}

/**
 * The last gate before a string reaches a lock screen.
 *
 * The copy is a constant and a test already checks it, so in a correct build
 * this can never fire. It is here anyway because the cost of the two checks is
 * nothing and the cost of being wrong is a person outed to whoever is standing
 * next to them. A notification that fails this is not sent at all — a silent
 * missed reminder is recoverable, a disclosure is not.
 */
function safeToSend(title: string, body: string): boolean {
  const offending = [...offendingTerms(title), ...offendingTerms(body)];
  if (offending.length > 0) {
    console.error(
      `refusing to send a notification containing: ${offending.join(", ")}`,
    );
    return false;
  }
  return true;
}

async function sendOne(actorId: string, row: DueReminder): Promise<"sent" | "retired" | "failed"> {
  const copy = reminderCopy(row.locale);
  if (!safeToSend(copy.title, copy.body)) return "failed";

  try {
    await webpush.sendNotification(
      {
        endpoint: row.endpoint,
        keys: { p256dh: row.p256dh, auth: row.auth },
      },
      JSON.stringify({ title: copy.title, body: copy.body, url: "/check-in" }),
      { TTL: 6 * 60 * 60 },
    );
    return "sent";
  } catch (error) {
    // 404/410 mean the endpoint is gone — the app was uninstalled or the
    // subscription expired. Retiring it stops an infinite weekly retry against
    // a device that no longer exists.
    const status = (error as { statusCode?: number }).statusCode;
    if (status === 404 || status === 410) {
      await retireSubscription(actorId, row.endpoint);
      return "retired";
    }
    console.error("push delivery failed", status ?? error);
    return "failed";
  }
}

/**
 * One dispatch pass.
 *
 * Safe to run on any cadence. The six-day floor on `lastReminderSentAt` means a
 * run inside the same hour as a previous one finds nothing due, so a scheduler
 * firing every ten minutes sends exactly one reminder per person per week.
 *
 * A person is stamped as reminded when at least one of their devices accepted
 * the push. Stamping on a total failure would swallow the week; stamping per
 * device would send twice to someone with a phone and a tablet.
 */
export async function dispatchReminders(actorId: string): Promise<DispatchResult> {
  if (!configureVapid()) {
    throw new Error(
      "VAPID keys are not configured; refusing to dispatch reminders",
    );
  }

  const due = await dueReminders(actorId);
  const result: DispatchResult = { due: due.length, sent: 0, retired: 0, failed: 0 };
  const reminded = new Set<string>();

  for (const row of due) {
    const outcome = await sendOne(actorId, row);
    result[outcome] += 1;
    if (outcome === "sent") reminded.add(row.userId);
  }

  await markReminderSent(actorId, [...reminded]);
  return result;
}
