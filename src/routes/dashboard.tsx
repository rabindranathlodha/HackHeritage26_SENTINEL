import { createFileRoute, Link } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { ArrowRight, CalendarCheck, ChevronRight, HeartPulse, ShieldCheck, Sparkles } from "lucide-react";
import { useTranslation } from "react-i18next";
import { AppShell } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import { PrivacyBadge } from "@/components/privacy/PrivacyBadge";
import { useSentinelState } from "@/lib/sentinel/store";
import { wellbeingQuery } from "@/lib/sentinel/queries";

export const Route = createFileRoute("/dashboard")({
  loader: ({ context }) => context.queryClient.ensureQueryData(wellbeingQuery),
  head: () => ({ meta: [
    { title: "Your dashboard — SENTINEL" },
    { name: "description", content: "A private overview of your recent SENTINEL wellbeing check-ins." },
    { property: "og:title", content: "Your dashboard — SENTINEL" },
    { property: "og:description", content: "A private overview of your recent SENTINEL wellbeing check-ins." },
    { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary_large_image" },
  ] }),
  component: DashboardRoute,
});

function DashboardRoute() {
  const { t } = useTranslation();
  const { data } = useSuspenseQuery(wellbeingQuery);
  const { lastCheckInAt, lastCheckInQueued } = useSentinelState();
  const latest = data[data.length - 1];
  return <AppShell><div className="space-y-8"><div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end"><div><p className="text-sm font-semibold uppercase tracking-[0.16em] text-emerald">{t("dashboard.eyebrow")}</p><h1 className="mt-3 text-3xl font-bold text-foreground sm:text-4xl">{t("dashboard.title")}</h1><p className="mt-3 max-w-xl leading-relaxed text-muted-foreground">{t("dashboard.subtitle")}</p></div><Button asChild><Link to="/consent"><CalendarCheck aria-hidden="true" />{t("dashboard.startWeek")}</Link></Button></div><div className="grid gap-4 md:grid-cols-[1.25fr_0.75fr]"><section className="rounded-[2rem] bg-primary p-6 text-primary-foreground shadow-lift sm:p-8"><div className="flex items-start justify-between gap-4"><div><p className="text-sm text-primary-foreground/70">{t("dashboard.steadiness")}</p><p className="mt-3 text-6xl font-bold">{latest?.balance ?? 0}<span className="text-xl font-medium text-primary-foreground/60">{t("dashboard.scoreSuffix")}</span></p></div><span className="flex size-12 items-center justify-center rounded-2xl bg-primary-foreground/15"><HeartPulse aria-hidden="true" className="size-6" /></span></div><div className="mt-8 flex items-center gap-2 text-sm text-primary-foreground/75"><Sparkles aria-hidden="true" className="size-4" />{lastCheckInAt ? lastCheckInQueued ? t("dashboard.queued") : t("dashboard.upToDate") : t("dashboard.baseline")}</div></section><section className="rounded-[2rem] border border-border bg-card p-6 shadow-soft sm:p-8"><PrivacyBadge>{t("dashboard.justForYou")}</PrivacyBadge><h2 className="mt-6 text-xl font-semibold text-foreground">{t("dashboard.historyTitle")}</h2><p className="mt-2 text-sm leading-relaxed text-muted-foreground">{t("dashboard.historyBody")}</p><Button asChild variant="link" className="mt-5 h-auto px-0"><Link to="/wellbeing">{t("dashboard.openWellbeing")} <ArrowRight aria-hidden="true" /></Link></Button></section></div><section className="grid gap-4 sm:grid-cols-3"><Stat label={t("dashboard.weeksCheckedIn")} value={`${data.filter((point) => point.checkedIn).length}`} icon={CalendarCheck} /><Stat label={t("dashboard.reflectionsKept")} value={`${data.reduce((sum, point) => sum + point.reflections, 0)}`} icon={HeartPulse} /><Stat label={t("dashboard.privacyStatus")} value={t("dashboard.on")} icon={ShieldCheck} /></section><div className="rounded-3xl border border-border bg-secondary/60 p-5"><Link to="/privacy" className="flex items-center justify-between gap-4"><div><p className="font-semibold text-foreground">{t("dashboard.privacyCentre")}</p><p className="mt-1 text-sm text-muted-foreground">{t("dashboard.privacyCentreBody")}</p></div><ChevronRight aria-hidden="true" className="size-5 text-muted-foreground" /></Link></div></div></AppShell>;
}

function Stat({ label, value, icon: Icon }: { label: string; value: string; icon: typeof CalendarCheck }) {
  return <div className="rounded-3xl border border-border bg-card p-5 shadow-soft"><Icon aria-hidden="true" className="size-5 text-emerald" /><p className="mt-5 text-2xl font-bold text-foreground">{value}</p><p className="mt-1 text-sm text-muted-foreground">{label}</p></div>;
}