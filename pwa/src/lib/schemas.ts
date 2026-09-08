import { z } from "zod";

import { ITEM_COUNT, SCALE_MAX, SCALE_MIN } from "@/content/questionnaire";
import { LOCALES } from "@/i18n/locale";

// Zod schemas mirroring the app tier's contract (PWA spec 7).
//
// Validated on the client so a person is told about a problem before a round
// trip, and again on the server, because a client-side check is a courtesy and
// not a control.

export const responsesSchema = z
  .array(z.number().int().min(SCALE_MIN).max(SCALE_MAX))
  .length(ITEM_COUNT, `expected ${ITEM_COUNT} answers`);

export const checkInSubmissionSchema = z.object({
  responses: responsesSchema,
  language: z.enum(LOCALES),
  /**
   * Computed on the phone from the person's own words. Null when there is no
   * journal entry, or when the device cannot run the model at all — never a
   * reason to block a check-in, and never a reason to send the text instead.
   */
  nlpContribution: z.number().min(0).max(1).nullable().default(null),
  /** Idempotency key, generated on the device (spec 6). */
  clientId: z.uuid(),
});

export type CheckInSubmission = z.infer<typeof checkInSubmissionSchema>;

// What the app tier returns. Deliberately narrow: if a score ever appeared in
// this response, parsing would strip it before any component could render it.
export const assessmentAckSchema = z.object({
  ok: z.literal(true),
  recorded_at: z.string(),
  // Present when the app tier recognised a replay. Not an error: the queue
  // treats it exactly like a first success and drops the item.
  duplicate: z.boolean().optional(),
});

export const checkInStatusSchema = z.object({
  due: z.boolean(),
  last_check_in: z.string().nullable(),
  week_starting: z.string(),
});

export type CheckInStatus = z.infer<typeof checkInStatusSchema>;
