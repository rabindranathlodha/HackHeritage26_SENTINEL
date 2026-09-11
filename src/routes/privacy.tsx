import { createFileRoute } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { Eye, HandHeart, LockKeyhole, MessageCircleHeart, ShieldCheck } from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { PrivacyCard } from "@/components/privacy/PrivacyCard";
import { AccessHistoryCard } from "@/components/privacy/AccessHistoryCard";
import { DataUsageSheet } from "@/components/privacy/DataUsageSheet";
import { Button } from "@/components/ui/button";
import { accessHistoryQuery } from "@/lib/sentinel/queries";

export const Route = createFileRoute("/privacy")({
  loader: ({ context }) => context.queryClient.ensureQueryData(accessHistoryQuery),
  head: () => ({ meta: [
    { title: "Privacy centre — SENTINEL" },
    { name: "description", content: "Understand your SENTINEL choices, data journey, and access history." },
    { property: "og:title", content: "Privacy centre — SENTINEL" },
    { property: "og:description", content: "Understand your SENTINEL choices, data journey, and access history." },
    { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary_large_image" },
  ] }),
  component: PrivacyRoute,
});

function PrivacyRoute() {
  const { data } = useSuspenseQuery(accessHistoryQuery);
  return <AppShell><div className="space-y-8"><div><p className="text-sm font-semibold uppercase tracking-[0.16em] text-emerald">Privacy centre</p><h1 className="mt-3 text-3xl font-bold text-foreground sm:text-4xl">You’re in control.</h1><p className="mt-3 max-w-2xl leading-relaxed text-muted-foreground">SENTINEL is built to support you, not to watch you. Review the choices and information trail that shape your experience.</p></div><div className="grid gap-4 md:grid-cols-3"><PrivacyCard icon={HandHeart} title="Your choice" description="Self-assessment is voluntary. You can skip a week or turn off optional extras." badge="Voluntary" badgeTone="optional" /><PrivacyCard icon={LockKeyhole} title="Your data" description="Your full check-in history is personal to you, with a clear record of access." badge="Private" /><PrivacyCard icon={Eye} title="Your view" description="Support sees aggregated signals for care planning, never an individual score." badge="Clear by default" badgeTone="device" /></div><section id="data-usage" className="rounded-[2rem] border border-border bg-gradient-mint p-6 sm:p-8"><div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-center"><div className="flex items-start gap-4"><span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-card text-primary shadow-soft"><ShieldCheck aria-hidden="true" className="size-5" /></span><div><h2 className="text-xl font-semibold text-foreground">Know what happens next.</h2><p className="mt-2 max-w-xl text-sm leading-relaxed text-muted-foreground">Follow the plain-language journey from your device to your personal wellbeing view.</p></div></div><DataUsageSheet><Button variant="outline">View data journey <MessageCircleHeart aria-hidden="true" /></Button></DataUsageSheet></div></section><div id="support" className="grid gap-4 md:grid-cols-[1.05fr_0.95fr]"><AccessHistoryCard events={data} /><section className="rounded-3xl border border-border bg-card p-6 shadow-soft"><p className="text-sm font-semibold uppercase tracking-[0.14em] text-emerald">Need support?</p><h2 className="mt-4 text-xl font-bold text-foreground">You don’t need a check-in to ask for help.</h2><p className="mt-3 text-sm leading-relaxed text-muted-foreground">SENTINEL is one optional way to notice patterns. A real conversation is always available outside the app.</p><Button variant="outline" className="mt-6">Find support resources</Button></section></div></div></AppShell>;
}