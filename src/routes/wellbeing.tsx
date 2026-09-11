import { createFileRoute, Link } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { ArrowLeft, BookOpen, CalendarDays, MessageCircleHeart } from "lucide-react";
import { useTranslation } from "react-i18next";
import { AppShell } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import { WellbeingTrend } from "@/components/wellbeing/WellbeingTrend";
import { describePatternKey } from "@/lib/sentinel/mock-service";
import { wellbeingQuery } from "@/lib/sentinel/queries";

export const Route = createFileRoute("/wellbeing")({
  loader: ({ context }) => context.queryClient.ensureQueryData(wellbeingQuery),
  head: () => ({ meta: [
    { title: "My wellbeing history — SENTINEL" },
    { name: "description", content: "Explore your self-reported wellbeing patterns over time, privately." },
    { property: "og:title", content: "My wellbeing history — SENTINEL" },
    { property: "og:description", content: "Explore your self-reported wellbeing patterns over time, privately." },
    { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary_large_image" },
  ] }),
  component: WellbeingRoute,
});

function WellbeingRoute() {
  const { t } = useTranslation();
  const { data } = useSuspenseQuery(wellbeingQuery);
  const latest = data[data.length - 1];
  return <AppShell><div className="space-y-8"><div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end"><div><p className="text-sm font-semibold uppercase tracking-[0.16em] text-emerald">{t("wellbeing.eyebrow")}</p><h1 className="mt-3 text-3xl font-bold text-foreground sm:text-4xl">{t("wellbeing.title")}</h1><p className="mt-3 max-w-xl leading-relaxed text-muted-foreground">{t("wellbeing.subtitle")}</p></div><Button asChild variant="outline"><Link to="/dashboard"><ArrowLeft aria-hidden="true" />{t("wellbeing.back")}</Link></Button></div><WellbeingTrend data={data} /><div className="grid gap-4 md:grid-cols-2"><Insight icon={MessageCircleHeart} title={t("wellbeing.gentleRead")} body={t(describePatternKey(data))} /><Insight icon={BookOpen} title={t("wellbeing.latestWeek")} body={t("wellbeing.latestWeekBody", { value: latest?.balance ?? "—" })} /></div><div className="flex items-center gap-2 text-xs text-muted-foreground"><CalendarDays aria-hidden="true" className="size-4 text-emerald" />{t("wellbeing.demoNote")}</div></div></AppShell>;
}

function Insight({ icon: Icon, title, body }: { icon: typeof MessageCircleHeart; title: string; body: string }) {
  return <section className="rounded-3xl border border-border bg-card p-6 shadow-soft"><span className="flex size-10 items-center justify-center rounded-2xl bg-mint text-primary"><Icon aria-hidden="true" className="size-5" /></span><h2 className="mt-5 font-semibold text-foreground">{title}</h2><p className="mt-2 text-sm leading-relaxed text-muted-foreground">{body}</p></section>;
}