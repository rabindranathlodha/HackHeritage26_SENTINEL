"use client";

import { Languages } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { useLanguage } from "@/lib/language";

export function LanguageToggle({ className }: { className?: string }) {
  const { language, setLanguage } = useLanguage();
  const { t } = useTranslation();

  return (
    <button
      type="button"
      onClick={() => setLanguage(language === "hi" ? "en" : "hi")}
      aria-label={t("language.switch")}
      title={t("language.switch")}
      className={cn(
        "flex h-9 items-center gap-1.5 rounded-full border border-border bg-card px-3 text-xs font-semibold text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground",
        className,
      )}
    >
      <Languages aria-hidden="true" className="size-4" />
      {language === "hi" ? t("language.hindi") : "EN"}
    </button>
  );
}
