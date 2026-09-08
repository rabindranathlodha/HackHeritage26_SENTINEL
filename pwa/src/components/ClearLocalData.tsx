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
        className="border-border min-h-14 rounded-xl border text-base font-medium"
      >
        {t("clearJournal")}
      </button>
      {done && (
        <p role="status" className="text-muted-foreground text-sm">
          {t("clearJournalDone")}
        </p>
      )}
    </div>
  );
}
