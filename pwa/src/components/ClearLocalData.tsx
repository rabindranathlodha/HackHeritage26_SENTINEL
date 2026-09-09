"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";

import { forgetEntries } from "@/lib/journal";

// "Clear local journal" (spec 4.6).
//
// Deletes only what is on this phone. It deliberately does NOT touch check-ins
// waiting in the outbox — those are the person's own answers on their way to
// their welfare team, and silently discarding them under a button labelled
// "delete my journal" would lose data they believe they submitted.
//
// The design's label for this control is "Delete everything on this phone".
// That is a bigger promise than the code keeps, so the copy here says what
// actually happens instead. On the one screen about control, a label that
// overstates its own reach is the worst possible place to be approximate.
export function ClearLocalData() {
  const t = useTranslations("settings");
  const [done, setDone] = useState(false);

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        data-testid="clear-journal"
        onClick={async () => {
          await forgetEntries();
          setDone(true);
        }}
        // Outlined rather than filled: this is the one destructive control in
        // the product, and the design gives destruction no colour at all — a
        // red button invites the tap it should be discouraging.
        className="border-line flex min-h-14 flex-col gap-1 rounded-xl border-[1.5px] px-[17px] py-4 text-left"
      >
        <span className="text-base font-semibold">{t("clearJournal")}</span>
        <span className="text-ink-2 text-[13px] leading-snug">
          {t("clearJournalBody")}
        </span>
      </button>
      {done && (
        <p role="status" className="text-ember-ink meta">
          {t("clearJournalDone")}
        </p>
      )}
    </div>
  );
}
