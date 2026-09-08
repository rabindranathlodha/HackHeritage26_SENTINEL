import { JOURNAL, SIGNALS, db, type JournalEntry } from "@/lib/db";

// The journal (PWA spec 4.4).
//
// The person's words are scored on this device and the words themselves stay
// here. Two separate decisions, kept separate in the code:
//
//   The derived number is queued for the next check-in. It is a probability,
//   not text, and it is the only thing that ever leaves.
//
//   The words are kept ONLY if the person asked to keep them, and then only in
//   this browser's IndexedDB. Nothing reads them back except this app, for
//   them. Default is not to keep — a phone can be borrowed, and someone else
//   scrolling a journal is a harm the app should not make possible by default.

/** Stores a contribution for the next check-in to pick up. */
export async function stashContribution(value: number): Promise<void> {
  const database = await db();
  await database.put(SIGNALS, { id: "nlp", value, at: Date.now() });
}

/**
 * Reads and clears the pending contribution.
 *
 * Clearing is the point: a contribution belongs to the check-in it was written
 * for. Leaving it would attach one week's journal to next week's check-in.
 */
export async function takeContribution(): Promise<number | null> {
  const database = await db();
  const pending = await database.get(SIGNALS, "nlp");
  if (!pending) return null;
  await database.delete(SIGNALS, "nlp");
  return pending.value;
}

export async function peekContribution(): Promise<number | null> {
  const database = await db();
  return (await database.get(SIGNALS, "nlp"))?.value ?? null;
}

export async function keepEntry(text: string): Promise<void> {
  const database = await db();
  await database.put(JOURNAL, {
    id: crypto.randomUUID(),
    writtenAt: Date.now(),
    text,
  });
}

export async function entries(): Promise<JournalEntry[]> {
  const database = await db();
  return (await database.getAllFromIndex(JOURNAL, "writtenAt")).reverse();
}

/** Erases every kept entry. Offered in settings, and irreversible by design. */
export async function forgetEntries(): Promise<void> {
  const database = await db();
  await database.clear(JOURNAL);
}
