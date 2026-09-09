import { DRAFTS, db, type CheckInDraft } from "@/lib/db";

// The check-in draft: what makes "leaving mid-way costs nothing" true.
//
// Every function here reports whether it actually worked rather than throwing
// or silently swallowing. That matters because the screen shows "Saved on this
// phone" next to the answer, and on a device where IndexedDB is unavailable —
// a private window, a browser with site data blocked — nothing is saved. A
// reassurance shown when the save failed is worse than no reassurance at all,
// so the caller only renders it on a confirmed `true`.

const ID = "check-in" as const;

/**
 * The draft for the current questionnaire, or null.
 *
 * A draft written against a different number of items is deleted rather than
 * returned: replaying nine old answers into ten new questions would silently
 * shift every answer onto the wrong item.
 */
export async function readDraft(questionCount: number): Promise<CheckInDraft | null> {
  try {
    const draft = await (await db()).get(DRAFTS, ID);
    if (!draft) return null;
    if (draft.questionCount !== questionCount || draft.answers.length !== questionCount) {
      await clearDraft();
      return null;
    }
    return draft;
  } catch {
    return null;
  }
}

/** True only if the write actually landed on this device. */
export async function saveDraft(
  answers: (number | null)[],
  index: number,
): Promise<boolean> {
  try {
    await (await db()).put(DRAFTS, {
      id: ID,
      answers,
      index,
      questionCount: answers.length,
      updatedAt: Date.now(),
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Removes the draft.
 *
 * Called once a check-in is submitted or queued — at that point the answers
 * live in the outbox, and leaving a copy here would mean a person who opens
 * the check-in again is offered their already-sent answers to send twice.
 */
export async function clearDraft(): Promise<void> {
  try {
    await (await db()).delete(DRAFTS, ID);
  } catch {
    // Nothing to do: the draft either never existed or the store is gone.
  }
}

export function answeredCount(draft: CheckInDraft): number {
  return draft.answers.filter((answer) => answer !== null).length;
}
