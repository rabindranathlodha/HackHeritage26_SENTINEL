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
    <div role="group" aria-label="Language" className="flex gap-2">
      {LOCALES.map((locale) => {
        const isActive = locale === active;
        return (
          <button
            key={locale}
            type="button"
            lang={locale}
            aria-pressed={isActive}
            disabled={pending}
            onClick={() => startTransition(() => setLocale(locale))}
            className={
              "min-h-11 rounded-full border px-4 text-sm font-medium transition-colors " +
              (isActive
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border text-muted-foreground")
            }
          >
            {LOCALE_LABELS[locale]}
          </button>
        );
      })}
    </div>
  );
}
