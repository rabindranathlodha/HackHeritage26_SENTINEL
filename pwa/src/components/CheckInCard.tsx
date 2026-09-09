"use client";

import { motion, useReducedMotion } from "motion/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";

import { answeredCount, clearDraft, readDraft } from "@/lib/draft";

// The home screen's one primary action, in its two states.
//
// The design draws these as separate screens — "check-in due" and "unfinished
// check-in" — but they are the same card with different contents, and treating
// them as one component is what stops the two drifting apart.
//
// The resume state exists because the check-in autosaves. Without a draft on
// the phone there would be nothing to resume, and this would be a button that
// promises to remember something the app had already forgotten.
export function CheckInCard({ total }: { total: number }) {
  const t = useTranslations("home");
  const router = useRouter();
  const reduceMotion = useReducedMotion();

  const [draft, setDraft] = useState<{ done: number; at: number } | null>(null);

  const look = useCallback(() => {
    void readDraft(total).then((found) => {
      if (!found) return setDraft(null);
      const done = answeredCount(found);
      // A draft with nothing answered is not a thing to resume, and one that
      // is complete belongs in the outbox rather than on this card.
      setDraft(
        done > 0 && done < total
          ? { done, at: Math.min(found.index + 1, total) }
          : null,
      );
    });
  }, [total]);

  useEffect(look, [look]);

  async function startOver() {
    await clearDraft();
    setDraft(null);
    router.push("/check-in");
  }

  // The fresh state is also what the server renders, so the first paint is
  // never empty while IndexedDB is being read.
  if (!draft) {
    return (
      <div className="flex flex-col gap-3.5">
        <div className="bg-surface border-line rounded-2xl border p-[22px]">
          <p className="text-ink-2 text-[17px] leading-relaxed">
            {/* The real number of questions, not the design's illustrative
                six. A person told "six" who then answers ten has been misled
                by the one screen that promised not to. */}
            {t("checkInBlurb", { count: total })}
          </p>
          <Link
            href="/check-in"
            className="bg-ember text-on-ember mt-4.5 flex min-h-14 items-center justify-center rounded-lg text-[17px] font-semibold"
          >
            {t("startCheckIn")}
          </Link>
        </div>
        <p className="text-ink-2 text-center text-[15px]">{t("notNow")}</p>
      </div>
    );
  }

  return (
    <div className="bg-surface border-line flex flex-col gap-3 rounded-2xl border p-[22px]">
      <p className="text-[22px] leading-tight font-semibold">
        {t("resumeTitle", { number: draft.at })}
      </p>

      <div className="bg-line h-[5px] w-full overflow-hidden rounded-full">
        <motion.div
          className="bg-ember h-full rounded-full"
          initial={reduceMotion ? false : { width: 0 }}
          animate={{ width: `${(draft.done / total) * 100}%` }}
          transition={reduceMotion ? { duration: 0 } : { duration: 0.5, ease: "easeOut" }}
        />
      </div>

      <p className="meta text-ink-3">
        {t("resumeProgress", { done: draft.done, total })}
      </p>

      {/* Ember-soft rather than solid ember: resuming is a continuation, not a
          new commitment, and the design gives it the quieter of the two fills. */}
      <Link
        href="/check-in?resume=1"
        className="bg-ember-soft text-ember-ink mt-2 flex min-h-14 items-center justify-center rounded-lg text-[17px] font-semibold"
      >
        {t("resume")}
      </Link>

      <button
        type="button"
        onClick={startOver}
        className="text-ink-2 min-h-14 text-base"
      >
        {t("startOver")}
      </button>
    </div>
  );
}
