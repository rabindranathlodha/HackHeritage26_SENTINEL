"use client";

import { useEffect, type ReactNode } from "react";
import { I18nextProvider, useTranslation } from "react-i18next";
import i18n, { LANGUAGE_STORAGE_KEY } from "./i18n";

export type Language = "en" | "hi";

export function LanguageProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    const stored = localStorage.getItem(LANGUAGE_STORAGE_KEY) as Language | null;
    if (stored && stored !== i18n.language) {
      void i18n.changeLanguage(stored);
    }
    document.documentElement.lang = stored ?? (i18n.language.startsWith("hi") ? "hi" : "en");
  }, []);

  return <I18nextProvider i18n={i18n}>{children}</I18nextProvider>;
}

export function useLanguage() {
  const { i18n: instance } = useTranslation();
  const language = (instance.language?.startsWith("hi") ? "hi" : "en") as Language;

  const setLanguage = (next: Language) => {
    void instance.changeLanguage(next);
    try {
      localStorage.setItem(LANGUAGE_STORAGE_KEY, next);
      document.documentElement.lang = next;
    } catch {
      /* storage unavailable */
    }
  };

  return { language, setLanguage };
}
