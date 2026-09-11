import { createFileRoute } from "@tanstack/react-router";
import { MessageCircle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { AppShell } from "@/components/layout/AppShell";

export const Route = createFileRoute("/messages")({
  head: () => ({
    meta: [
      { title: "Messages — SENTINEL" },
      { name: "description", content: "Conversations and check-in messages from your wellbeing team." },
      { property: "og:title", content: "Messages — SENTINEL" },
      { property: "og:description", content: "Conversations and check-in messages from your wellbeing team." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: MessagesRoute,
});

function MessagesRoute() {
  const { t } = useTranslation();
  return (
    <AppShell>
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <span className="flex size-11 items-center justify-center rounded-2xl bg-mint text-primary shadow-soft">
            <MessageCircle aria-hidden="true" className="size-5" />
          </span>
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.16em] text-emerald">
              {t("messages.eyebrow")}
            </p>
            <h1 className="text-2xl font-bold text-foreground sm:text-3xl">{t("messages.title")}</h1>
          </div>
        </div>
        <p className="max-w-2xl leading-relaxed text-muted-foreground">{t("messages.body")}</p>
        <section className="rounded-3xl border border-border bg-card p-8 shadow-soft">
          <p className="text-sm text-muted-foreground">{t("messages.empty")}</p>
        </section>
      </div>
    </AppShell>
  );
}
