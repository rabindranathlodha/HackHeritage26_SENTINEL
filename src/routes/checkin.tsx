import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/layout/AppShell";
import { CheckInCard } from "@/components/checkin/CheckInCard";
import { useTranslation } from "react-i18next";

export const Route = createFileRoute("/checkin")({
  head: () => ({ meta: [
    { title: "Weekly check-in — SENTINEL" },
    { name: "description", content: "Take a short, voluntary moment to reflect on your week with SENTINEL." },
    { property: "og:title", content: "Weekly check-in — SENTINEL" },
    { property: "og:description", content: "Take a short, voluntary moment to reflect on your week with SENTINEL." },
    { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary_large_image" },
  ] }),
  component: CheckInRoute,
});

function CheckInRoute() {
  const { t } = useTranslation();
  return <AppShell><div className="mb-8 space-y-2"><p className="text-sm font-semibold uppercase tracking-[0.16em] text-emerald">{t("checkin.eyebrow")}</p><h1 className="text-3xl font-bold text-foreground sm:text-4xl">{t("checkin.title")}</h1><p className="max-w-xl leading-relaxed text-muted-foreground">{t("checkin.subtitle")}</p></div><CheckInCard /></AppShell>;
}