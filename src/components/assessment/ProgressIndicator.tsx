"use client";

import { useTranslation } from "react-i18next";
import { Progress } from "@/components/ui/progress";

export function ProgressIndicator({ current, total }: { current: number; total: number }) {
  const { t } = useTranslation();
  return <div className="space-y-2"><div className="flex justify-between text-xs font-medium text-muted-foreground"><span>{t("checkin.yourCheckIn")}</span><span>{t("checkin.progress", { current, total })}</span></div><Progress value={(current / total) * 100} aria-label={t("checkin.progress", { current, total })} /></div>;
}
