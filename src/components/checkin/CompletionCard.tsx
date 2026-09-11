"use client";

import { Link } from "@tanstack/react-router";
import { CheckCircle2, LineChart, ShieldCheck } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import type { SubmitResult } from "@/lib/sentinel/mock-service";

export function CompletionCard({ result }: { result: SubmitResult }) {
  const { t } = useTranslation();
  return <div className="mx-auto max-w-xl rounded-[2rem] border border-border bg-card p-6 text-center shadow-lift sm:p-10"><span className="mx-auto flex size-16 items-center justify-center rounded-full bg-mint text-emerald"><CheckCircle2 aria-hidden="true" className="size-8" /></span><p className="mt-6 text-sm font-semibold uppercase tracking-[0.14em] text-emerald">{result.status === "queued" ? t("checkin.completeQueued") : t("checkin.completeSynced")}</p><h1 className="mt-3 text-3xl font-bold text-foreground">{t("checkin.completeTitle")}</h1><p className="mt-4 leading-relaxed text-muted-foreground">{result.message}</p><div className="mt-7 flex items-center justify-center gap-2 text-xs text-muted-foreground"><ShieldCheck aria-hidden="true" className="size-4 text-emerald" />{t("checkin.personalView")}</div><div className="mt-8 flex flex-col gap-3 sm:flex-row"><Button asChild className="flex-1"><Link to="/dashboard"><LineChart aria-hidden="true" />{t("checkin.viewDashboard")}</Link></Button><Button asChild variant="outline" className="flex-1"><Link to="/wellbeing">{t("checkin.seeHistory")}</Link></Button></div></div>;
}
