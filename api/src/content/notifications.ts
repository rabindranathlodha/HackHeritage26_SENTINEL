// The only text this system ever puts on a person's lock screen.
//
// A notification is the one message that arrives whether or not the person is
// holding the phone, and that anyone standing beside them can read. So the bar
// is higher than the general clinical-claims boundary: it is not enough to
// avoid "depression" and "risk". A bystander in a barracks reading
// "SENTINEL Welfare — we're concerned about you" has learned something about
// that person that no one consented to share, and the person learns that the
// app can expose them. That is the end of the product.
//
// Three rules, in order of how much they cost to get wrong:
//
//   1. The title is the app's neutral name, never "SENTINEL" and never
//      "Welfare". The home-screen name is already "Companion" for exactly this
//      reason; a notification that says otherwise undoes it.
//   2. The body says only that a routine thing is due. No state, no concern,
//      no urgency, nothing personal, nothing that varies by the person.
//   3. It is identical for everyone. Copy that changes with someone's band is
//      a side channel — a bystander who sees two different notifications on
//      two phones has read a comparison.
//
// Because it never varies, it is a constant rather than a template. There is
// no interpolation point for a name or a number to be added later without
// somebody deliberately changing this file, and `tests/notification-copy.test.ts`
// checks every string here against the denylist.

export type NotificationLocale = "en" | "hi";

export type NotificationCopy = {
  title: string;
  body: string;
};

export const REMINDER_COPY: Record<NotificationLocale, NotificationCopy> = {
  en: {
    title: "Companion",
    body: "Time for your weekly check-in.",
  },
  hi: {
    title: "साथी",
    body: "इस हफ़्ते की बातचीत का समय हो गया है।",
  },
};

export function reminderCopy(locale: string | null | undefined): NotificationCopy {
  return locale === "hi" ? REMINDER_COPY.hi : REMINDER_COPY.en;
}

/**
 * Terms that must never appear in a notification.
 *
 * Wider than the clinical denylist on purpose. "support", "welfare",
 * "officer" and "concern" are all perfectly good words inside the app, where
 * the person chose to be; on a lock screen they are a disclosure. "urgent" and
 * "important" are here because urgency is itself a signal about state.
 */
export const NOTIFICATION_DENYLIST = [
  // Clinical boundary (backend spec §10, PWA spec §9)
  "diagnos",
  "depress",
  "anxiet",
  "anxious",
  "risk",
  "score",
  "band",
  "patient",
  "disorder",
  "symptom",
  "mental",
  "therapy",
  "treatment",
  "suicid",
  // Lock-screen disclosure: true of the product, but nobody else's business
  "welfare",
  "officer",
  "commander",
  "concern",
  "worried",
  "alert",
  "urgent",
  "important",
  "immediately",
  "sentinel",
  // Hindi equivalents, so the guard cannot be walked around by translating
  "जोखिम",
  "स्कोर",
  "कल्याण",
  "अधिकारी",
  "चिंता",
  "ज़रूरी",
  "तुरंत",
] as const;

/** Every offending term in a string, or an empty array. */
export function offendingTerms(text: string): string[] {
  const lower = text.toLowerCase();
  return NOTIFICATION_DENYLIST.filter((term) => lower.includes(term));
}
