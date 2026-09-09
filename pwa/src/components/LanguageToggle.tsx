"use client";

import { useLocale } from "next-intl";
import { useTransition } from "react";

import { setLocale } from "@/i18n/actions";
import { LOCALES, LOCALE_LABELS } from "@/i18n/locale";

// Each language is written in its own script. Someone looking for Hindi scans
// for "हिन्दी", not for the word "Hindi" spelled in Latin letters.
export function LanguageToggle() {
  const active = useLocale();
  const [pending, startTransition] = useTransition();

  return (
    // A segmented pair rather than pills: two languages are a choice between
    // equals, and giving each half the width says so before the label is read.
    <div role="group" aria-label="Language" className="flex gap-2">
      {LOCALES.map((locale) => {
        const isActive = locale === active;
        return (
          <button
            key={locale}
            type="button"
            // lang on the button itself, so the Devanagari label is rendered
            // with the Devanagari stack even while the app is in English.
            lang={locale}
            aria-pressed={isActive}
            disabled={pending}
            onClick={() => startTransition(() => setLocale(locale))}
            className={
              "min-h-14 flex-1 rounded-md border-[1.5px] px-4 text-[17px] font-semibold transition-colors duration-200 disabled:opacity-60 " +
              (isActive
                ? "border-ember bg-ember text-on-ember"
                : "border-line text-ink-2")
            }
          >
            {LOCALE_LABELS[locale]}
          </button>
        );
      })}
    </div>
  );
}
