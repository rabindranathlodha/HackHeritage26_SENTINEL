"use client";

import { useTranslation } from "react-i18next";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export function JournalInput({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const { t } = useTranslation();
  return <div className="space-y-3"><div className="flex items-baseline justify-between gap-3"><Label htmlFor="reflection" className="text-base font-semibold text-foreground">{t("checkin.anythingToRemember")}</Label><span className="text-xs text-muted-foreground">{t("checkin.optional")}</span></div><Textarea id="reflection" value={value} onChange={(event) => onChange(event.target.value)} placeholder={t("checkin.reflectionPlaceholder")} maxLength={600} className="min-h-32 resize-none rounded-2xl bg-background" /><p className="text-xs text-muted-foreground">{t("checkin.reflectionNote")}</p></div>;
}
