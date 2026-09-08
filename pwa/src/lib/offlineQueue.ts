import { OUTBOX as STORE, db, type QueuedSubmission } from "@/lib/db";
import type { CheckInSubmission } from "@/lib/schemas";

// The offline queue (PWA spec 6).
//
// Personnel are in remote postings with poor connectivity, so a submission has
// to survive the network being absent, the app being closed, and the phone
// being restarted. IndexedDB is the only browser store that gives all three.
//
// Two rules shape everything here:
//
//   Never lose data. An item leaves the queue only when the server has
//   confirmed it. A failed attempt stays queued and is retried; it is not
//   dropped, and it is not reported to the person as an error.
//
//   Never double-submit. Each item carries the UUID generated when the person
//   pressed the button, not one generated per attempt, so the app tier can
//   recognise a replay of the same check-in.

export type { QueuedSubmission };

/** Adds a submission to the outbox. Safe to call with an id already present. */
export async function enqueue(submission: CheckInSubmission): Promise<void> {
  const database = await db();
  await database.put(STORE, {
    ...submission,
    queuedAt: Date.now(),
    attempts: 0,
  });
}

/** Everything waiting, oldest first — the order it will be sent in. */
export async function pending(): Promise<QueuedSubmission[]> {
  const database = await db();
  return database.getAllFromIndex(STORE, "queuedAt");
}

export async function pendingCount(): Promise<number> {
  const database = await db();
  return database.count(STORE);
}

async function markAttempt(item: QueuedSubmission, error: string): Promise<void> {
  const database = await db();
  // Only if it is still there. put() would otherwise RESURRECT an item that a
  // concurrent flush had already sent and deleted, leaving the person's
  // check-in queued forever and re-sent on every reconnect.
  const current = await database.get(STORE, item.clientId);
  if (!current) return;
  await database.put(STORE, {
    ...current,
    attempts: current.attempts + 1,
    lastError: error,
  });
}

export type FlushResult = { sent: number; remaining: number };

let inFlight: Promise<FlushResult> | null = null;

/**
 * Serialised: a second call while one is running joins the first rather than
 * starting its own pass.
 *
 * SyncStatus flushes on mount and again on the `online` event, and both fire
 * within milliseconds of a reconnect. Two passes over the same outbox raced —
 * one sent an item and deleted it while the other, holding a stale copy,
 * wrote it back.
 */
export function flush(): Promise<FlushResult> {
  inFlight ??= runFlush().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

/**
 * Sends everything in the outbox, oldest first, stopping at the first failure.
 *
 * Stopping matters: submissions are weekly check-ins and their order is the
 * order the person made them. Racing them in parallel would also mean several
 * simultaneous scoring runs from one phone coming back online.
 *
 * A 4xx other than 408/429 means the server will never accept this item — it is
 * malformed, or the session is gone. Retrying forever would block every later
 * item behind it, so it is dropped and counted as sent. Anything else stays.
 */
async function runFlush(): Promise<FlushResult> {
  const items = await pending();
  const database = await db();
  let sent = 0;

  for (const item of items) {
    let response: Response;
    try {
      response = await fetch("/api/assessment", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          responses: item.responses,
          language: item.language,
          nlpContribution: item.nlpContribution,
          clientId: item.clientId,
        }),
      });
    } catch (error) {
      await markAttempt(item, error instanceof Error ? error.message : "network");
      break;
    }

    if (response.ok) {
      await database.delete(STORE, item.clientId);
      sent += 1;
      continue;
    }

    const permanent =
      response.status >= 400 &&
      response.status < 500 &&
      response.status !== 408 &&
      response.status !== 429;

    if (permanent) {
      console.error(
        `dropping a queued check-in the server refused (${response.status})`,
      );
      await database.delete(STORE, item.clientId);
      sent += 1;
      continue;
    }

    await markAttempt(item, `http ${response.status}`);
    break;
  }

  return { sent, remaining: await pendingCount() };
}

/** Removes everything. Used by settings' "clear local data", and by tests. */
export async function clearQueue(): Promise<void> {
  const database = await db();
  await database.clear(STORE);
}
