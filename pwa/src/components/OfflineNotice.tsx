"use client";

import { useEffect, useState } from "react";

import { DEFAULT_LOCALE, LOCALE_COOKIE, isLocale, type Locale } from "@/i18n/locale";

type Copy = Record<Locale, { title: string; body: string }>;

// The offline page is the one screen that must be PRECACHED, which means it
// must be statically rendered. Resolving the locale on the server reads a
// cookie, which makes the route dynamic, which means it is not in the precache
// manifest — so the fallback would be missing at exactly the moment it exists
// for. Both languages ship in the bundle instead and the cookie is read here.
export function OfflineNotice({ copy }: { copy: Copy }) {
  // Start on the default so the prerendered HTML and the first client render
  // agree; correct it once the cookie is readable.
  const [locale, setLocale] = useState<Locale>(DEFAULT_LOCALE);

  useEffect(() => {
    const match = document.cookie
      .split("; ")
      .find((entry) => entry.startsWith(`${LOCALE_COOKIE}=`));
    const value = match?.split("=")[1];
    if (isLocale(value)) setLocale(value);
  }, []);

  const text = copy[locale];

  return (
    <div className="flex flex-col gap-4" lang={locale}>
      <h1 className="anchor">{text.title}</h1>
      <p className="text-ink-2 text-lg leading-relaxed">{text.body}</p>
    </div>
  );
}
