import { NextResponse } from "next/server";

import { authoriseInternal } from "@/lib/internalAuth";
import { dispatchReminders } from "@/lib/reminders";

// POST /api/internal/reminders/dispatch — send whatever is due right now.
//
// Deliberately a pull, not a daemon. Something outside this process decides
// when to call it (a cron entry, a Kubernetes CronJob, any scheduler), and the
// route is idempotent within the hour because lastReminderSentAt carries a
// six-day floor. Calling it every ten minutes and calling it once an hour both
// send exactly one reminder per person per week.
//
// A background timer inside the web process would have looked more finished and
// been worse: it fires N times with N replicas, dies silently on restart, and
// has nowhere to report a failure to.
//
// `actor` is the identity written into sentinel.user_id for the transaction.
// The reminder role's policies do not depend on it — it reads every due row —
// but withRole refuses an unattributable connection, and a named actor is what
// makes a dispatch traceable to whatever ran it.

export async function POST(request: Request) {
  const refused = authoriseInternal(request, "reminder dispatch");
  if (refused) return refused;

  const actor =
    new URL(request.url).searchParams.get("actor") ?? "system-reminder-dispatcher";

  try {
    return NextResponse.json(await dispatchReminders(actor));
  } catch (error) {
    const message = error instanceof Error ? error.message : "dispatch failed";
    console.error("reminder dispatch failed", message);
    // 503, not 500: the usual cause is unconfigured VAPID keys, and a scheduler
    // should read that as "not ready, retry" rather than as a bug to page on.
    return NextResponse.json({ error: message }, { status: 503 });
  }
}
