"use client";

import { Link } from "@tanstack/react-router";
import {
  ArrowRight,
  Check,
  CircleUserRound,
  Eye,
  HeartHandshake,
  LockKeyhole,
  MessageCircleHeart,
  ScanLine,
  ShieldCheck,
  Sparkles,
  TrendingUp,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { DataUsageSheet } from "@/components/privacy/DataUsageSheet";
import { PrivacyBadge } from "@/components/privacy/PrivacyBadge";

export function HeroSection() {
  const { t } = useTranslation();

  return (
    <section className="relative overflow-hidden border-b border-border bg-hero-mesh">
      <div className="mx-auto grid min-h-[640px] w-full max-w-6xl items-center gap-14 px-4 py-20 sm:px-6 lg:grid-cols-[1.05fr_0.95fr] lg:gap-20 lg:py-28">
        <div className="relative z-10 max-w-2xl">
          <PrivacyBadge tone="device">{t("landing.badge")}</PrivacyBadge>
          <h1 className="text-balance-tight mt-6 text-5xl font-bold leading-[1.04] tracking-tight text-foreground sm:text-6xl lg:text-7xl">
            {t("landing.heroTitle")}
          </h1>
          <p className="mt-6 max-w-xl text-lg leading-relaxed text-muted-foreground sm:text-xl">
            {t("landing.heroBody")}
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Button asChild size="lg" className="min-h-12 px-6">
              <Link to="/consent">{t("landing.ctaStart")} <ArrowRight aria-hidden="true" /></Link>
            </Button>
            <Button asChild variant="outline" size="lg" className="min-h-12 px-6">
              <Link to="/privacy">{t("landing.ctaPrivacy")}</Link>
            </Button>
          </div>
          <div className="mt-8 flex flex-wrap gap-x-5 gap-y-2 text-sm text-muted-foreground">
            <span className="inline-flex items-center gap-2"><Check aria-hidden="true" className="size-4 text-emerald" />{t("landing.check1")}</span>
            <span className="inline-flex items-center gap-2"><Check aria-hidden="true" className="size-4 text-emerald" />{t("landing.check2")}</span>
            <span className="inline-flex items-center gap-2"><Check aria-hidden="true" className="size-4 text-emerald" />{t("landing.check3")}</span>
          </div>
        </div>

        <div className="relative mx-auto w-full max-w-md lg:max-w-none">
          <div className="absolute -inset-8 rounded-[40%] bg-mint/60 blur-3xl" aria-hidden="true" />
          <div className="relative rounded-[2rem] border border-border/80 bg-card p-5 shadow-lift sm:p-7">
            <div className="flex items-center justify-between border-b border-border pb-5">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">{t("landing.snapshotEyebrow")}</p>
                <p className="mt-1 text-lg font-semibold text-foreground">{t("landing.snapshotTitle")}</p>
              </div>
              <span className="flex size-10 items-center justify-center rounded-2xl bg-mint text-emerald"><TrendingUp aria-hidden="true" className="size-5" /></span>
            </div>
            <div className="py-6">
              <div className="flex items-end justify-between">
                <div><p className="text-sm text-muted-foreground">{t("landing.steadiness")}</p><p className="mt-1 text-5xl font-bold text-primary">68<span className="text-xl font-medium text-muted-foreground">/100</span></p></div>
                <PrivacyBadge tone="private">{t("landing.onlyYou")}</PrivacyBadge>
              </div>
              <div className="mt-6 flex h-28 items-end gap-2" aria-label={t("landing.trendLabel")}>
                {[46, 57, 50, 64, 58, 72, 68].map((height, index) => <span key={index} className="flex-1 rounded-t-lg bg-gradient-primary opacity-80" style={{ height: `${height}%` }} />)}
              </div>
              <div className="mt-3 flex justify-between text-[11px] text-muted-foreground"><span>{t("landing.weeksAgo")}</span><span>{t("landing.thisWeek")}</span></div>
            </div>
            <div className="grid grid-cols-2 gap-3 border-t border-border pt-5">
              <div className="rounded-2xl bg-secondary p-3"><p className="text-xs text-muted-foreground">{t("landing.checkIns")}</p><p className="mt-1 text-lg font-semibold text-foreground">{t("landing.checkInsValue")}</p></div>
              <div className="rounded-2xl bg-secondary p-3"><p className="text-xs text-muted-foreground">{t("landing.reflections")}</p><p className="mt-1 text-lg font-semibold text-foreground">{t("landing.reflectionsValue")}</p></div>
            </div>
          </div>
        </div>
      </div>
      <div className="mx-auto h-2 w-24 rounded-full bg-attention" aria-hidden="true" />
    </section>
  );
}

export function FeatureBento() {
  const { t } = useTranslation();
  const features = [
    { icon: ScanLine, title: t("landing.f1t"), body: t("landing.f1b") },
    { icon: LockKeyhole, title: t("landing.f2t"), body: t("landing.f2b") },
    { icon: MessageCircleHeart, title: t("landing.f3t"), body: t("landing.f3b") },
    { icon: CircleUserRound, title: t("landing.f4t"), body: t("landing.f4b") },
  ];

  return <section className="mx-auto w-full max-w-6xl px-4 py-20 sm:px-6 lg:py-28" id="features">
    <div className="max-w-2xl"><p className="text-sm font-semibold uppercase tracking-[0.16em] text-emerald">{t("landing.featuresEyebrow")}</p><h2 className="mt-4 text-3xl font-bold text-foreground sm:text-4xl">{t("landing.featuresTitle")}</h2><p className="mt-4 text-base leading-relaxed text-muted-foreground">{t("landing.featuresBody")}</p></div>
    <div className="mt-10 grid gap-4 md:grid-cols-2">
      {features.map(({ icon: Icon, title, body }, index) => <article key={title} className={index === 0 ? "rounded-3xl bg-primary p-6 text-primary-foreground shadow-lift md:row-span-2 md:p-8" : "rounded-3xl border border-border bg-card p-6 shadow-soft"}>
        <span className={index === 0 ? "flex size-11 items-center justify-center rounded-2xl bg-primary-foreground/15" : "flex size-11 items-center justify-center rounded-2xl bg-mint text-primary"}><Icon aria-hidden="true" className="size-5" /></span>
        <h3 className="mt-7 text-xl font-semibold">{title}</h3><p className={index === 0 ? "mt-3 max-w-sm leading-relaxed text-primary-foreground/75" : "mt-3 leading-relaxed text-muted-foreground"}>{body}</p>
        {index === 0 ? <div className="mt-14 flex items-center gap-3 text-sm font-medium"><HeartHandshake aria-hidden="true" className="size-5" />{t("landing.builtFor")}</div> : null}
      </article>)}
    </div>
  </section>;
}

export function HowItWorks() {
  const { t } = useTranslation();
  const steps = [
    ["01", t("landing.s1t"), t("landing.s1b")],
    ["02", t("landing.s2t"), t("landing.s2b")],
    ["03", t("landing.s3t"), t("landing.s3b")],
  ];
  return <section className="border-y border-border bg-secondary/50" id="how-it-works"><div className="mx-auto w-full max-w-6xl px-4 py-20 sm:px-6 lg:py-24"><div className="grid gap-12 lg:grid-cols-[0.8fr_1.2fr] lg:gap-20"><div><p className="text-sm font-semibold uppercase tracking-[0.16em] text-emerald">{t("landing.stepsEyebrow")}</p><h2 className="mt-4 text-3xl font-bold text-foreground sm:text-4xl">{t("landing.stepsTitle")}</h2><p className="mt-4 leading-relaxed text-muted-foreground">{t("landing.stepsBody")}</p></div><ol className="divide-y divide-border border-y border-border">{steps.map(([number, title, body]) => <li key={number} className="grid gap-4 py-6 sm:grid-cols-[64px_1fr] sm:items-start"><span className="text-sm font-bold text-attention">{number}</span><div><h3 className="text-lg font-semibold text-foreground">{title}</h3><p className="mt-2 max-w-lg text-sm leading-relaxed text-muted-foreground">{body}</p></div></li>)}</ol></div></div></section>;
}

export function PrivacySection() {
  const { t } = useTranslation();
  return <section className="mx-auto grid w-full max-w-6xl gap-10 px-4 py-20 sm:px-6 lg:grid-cols-[1fr_1.1fr] lg:items-center lg:py-28"><div><span className="flex size-12 items-center justify-center rounded-2xl bg-mint text-primary"><ShieldCheck aria-hidden="true" className="size-6" /></span><h2 className="mt-6 text-3xl font-bold text-foreground sm:text-4xl">{t("landing.privacyTitle")}</h2><p className="mt-4 max-w-lg leading-relaxed text-muted-foreground">{t("landing.privacyBody")}</p><div className="mt-7"><DataUsageSheet><Button variant="outline">{t("landing.dataJourney")} <Eye aria-hidden="true" /></Button></DataUsageSheet></div></div><div className="grid gap-3 sm:grid-cols-2"><div className="rounded-3xl border border-border bg-card p-5 shadow-soft"><LockKeyhole className="size-5 text-emerald" /><h3 className="mt-5 font-semibold text-foreground">{t("landing.p1t")}</h3><p className="mt-2 text-sm leading-relaxed text-muted-foreground">{t("landing.p1b")}</p></div><div className="rounded-3xl border border-border bg-card p-5 shadow-soft sm:translate-y-8"><Eye className="size-5 text-emerald" /><h3 className="mt-5 font-semibold text-foreground">{t("landing.p2t")}</h3><p className="mt-2 text-sm leading-relaxed text-muted-foreground">{t("landing.p2b")}</p></div></div></section>;
}

export function DashboardPreview() {
  const { t } = useTranslation();
  return <section className="border-y border-border bg-mint/50"><div className="mx-auto grid w-full max-w-6xl gap-10 px-4 py-20 sm:px-6 lg:grid-cols-[1fr_0.9fr] lg:items-center lg:py-24"><div><PrivacyBadge>{t("landing.dashEyebrow")}</PrivacyBadge><h2 className="mt-5 text-3xl font-bold text-foreground sm:text-4xl">{t("landing.dashTitle")}</h2><p className="mt-4 max-w-xl leading-relaxed text-muted-foreground">{t("landing.dashBody")}</p><Button asChild variant="outline" className="mt-7"><Link to="/dashboard">{t("landing.dashCta")} <ArrowRight aria-hidden="true" /></Link></Button></div><div className="rounded-[2rem] border border-border bg-card p-5 shadow-soft sm:p-7"><div className="flex items-center justify-between"><div><p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">{t("landing.dashCardEyebrow")}</p><p className="mt-2 text-2xl font-bold text-foreground">{t("landing.dashCardTitle")}</p></div><Sparkles className="size-6 text-attention" /></div><div className="mt-8 flex items-center gap-4"><div className="relative size-24 rounded-full p-2" style={{ background: "conic-gradient(var(--color-emerald) 68%, var(--color-mint) 0)" }}><div className="flex size-full items-center justify-center rounded-full bg-card text-xl font-bold text-primary">68</div></div><div><p className="font-semibold text-foreground">{t("landing.recentPattern")}</p><p className="mt-1 text-sm text-muted-foreground">{t("landing.recentPatternBody")}</p></div></div></div></div></section>;
}

export function FinalCta() {
  const { t } = useTranslation();
  return <section className="mx-auto w-full max-w-6xl px-4 py-20 sm:px-6 lg:py-28"><div className="relative overflow-hidden rounded-[2rem] bg-primary px-6 py-12 text-center shadow-lift sm:px-12 sm:py-16"><div className="relative z-10 mx-auto max-w-2xl"><p className="text-sm font-semibold uppercase tracking-[0.16em] text-primary-foreground/70">{t("landing.ctaEyebrow")}</p><h2 className="mt-4 text-3xl font-bold text-primary-foreground sm:text-5xl">{t("landing.ctaTitle")}</h2><p className="mx-auto mt-5 max-w-xl leading-relaxed text-primary-foreground/75">{t("landing.ctaBody")}</p><Button asChild size="lg" className="mt-8 min-h-12 bg-primary-foreground text-primary hover:bg-primary-foreground/90"><Link to="/consent">{t("landing.ctaStart")} <ArrowRight aria-hidden="true" /></Link></Button></div><div className="absolute -right-24 -top-24 size-72 rounded-full border-[32px] border-primary-foreground/10" aria-hidden="true" /><div className="absolute -bottom-36 -left-24 size-72 rounded-full border-[32px] border-attention/30" aria-hidden="true" /></div></section>;
}
