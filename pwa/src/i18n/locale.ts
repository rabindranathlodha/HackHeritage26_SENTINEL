// Locale is a cookie, not a URL prefix.
//
// next-intl offers routed locales (/en/home, /hi/home). This app deliberately
// does not use them: the service worker precaches an app shell, and prefixed
// routes would double every cached entry for a phone that only ever needs one
// language. A person picks their language once in settings; the URL is not
// where that belongs. It also keeps deep links stable when someone switches.

export const LOCALES = ["en", "hi"] as const;
export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "en";

export const LOCALE_COOKIE = "sentinel-locale";

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}

// Shown in each language's own script, never translated into the other. A
// person scanning for their language looks for "हिन्दी", not for "Hindi".
export const LOCALE_LABELS: Record<Locale, string> = {
  en: "English",
  hi: "हिन्दी",
};
