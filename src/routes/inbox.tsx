import { createFileRoute } from "@tanstack/react-router";
import { Inbox } from "lucide-react";
import { useTranslation } from "react-i18next";
import { AppShell } from "@/components/layout/AppShell";

export const Route = createFileRoute("/inbox")({
  head: () => ({
    meta: [
      { title: "Inbox — SENTINEL" },
      { name: "description", content: "Your SENTINEL inbox — check-ins, nudges, and updates in one place." },
      { property: "og:title", content: "Inbox — SENTINEL" },
      { property: "og:description", content: "Your SENTINEL inbox — check-ins, nudges, and updates in one place." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: InboxRoute,
});

function InboxRoute() {
  const { t } = useTranslation();
  return (
    <AppShell>
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <span className="flex size-11 items-center justify-center rounded-2xl bg-mint text-primary shadow-soft">
            <Inbox aria-hidden="true" className="size-5" />
          </span>
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.16em] text-emerald">{t("inbox.eyebrow")}</p>
            <h1 className="text-2xl font-bold text-foreground sm:text-3xl">{t("inbox.title")}</h1>
          </div>
        </div>
        <p className="max-w-2xl leading-relaxed text-muted-foreground">
          {t("inbox.body")}
        </p>
        <section className="rounded-3xl border border-border bg-card p-8 shadow-soft">
          <p className="text-sm text-muted-foreground">{t("inbox.empty")}</p>
        </section>
      </div>
    </AppShell>
  );
}
