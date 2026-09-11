import { createFileRoute } from "@tanstack/react-router";
import { Check, Languages, Moon, Settings, Sun } from "lucide-react";
import type { ReactNode } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import { useLanguage } from "@/lib/language";
import { useTheme } from "@/lib/theme";
import { useTranslation } from "react-i18next";

export const Route = createFileRoute("/settings")({
  head: () => ({
    meta: [
      { title: "Settings — SENTINEL" },
      { name: "description", content: "Adjust your SENTINEL preferences, notifications, and check-in cadence." },
      { property: "og:title", content: "Settings — SENTINEL" },
      { property: "og:description", content: "Adjust your SENTINEL preferences, notifications, and check-in cadence." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: SettingsRoute,
});

function SettingsRoute() {
  const { t } = useTranslation();
  const { language, setLanguage } = useLanguage();
  const { theme, setTheme } = useTheme();

  return (
    <AppShell>
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <span className="flex size-11 items-center justify-center rounded-2xl bg-mint text-primary shadow-soft">
            <Settings aria-hidden="true" className="size-5" />
          </span>
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.16em] text-emerald">{t("settings.eyebrow")}</p>
            <h1 className="text-2xl font-bold text-foreground sm:text-3xl">{t("settings.title")}</h1>
          </div>
        </div>
        <p className="max-w-2xl leading-relaxed text-muted-foreground">{t("settings.body")}</p>
        <div className="grid gap-4 md:grid-cols-2">
          <SettingsSection
            icon={Sun}
            title={t("settings.appearance")}
            description={t("settings.appearanceBody")}
          >
            <p className="text-sm text-muted-foreground">{t("settings.chooseAppearance")}</p>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <PreferenceButton
                active={theme === "light"}
                icon={Sun}
                label={t("settings.light")}
                onClick={() => setTheme("light")}
              />
              <PreferenceButton
                active={theme === "dark"}
                icon={Moon}
                label={t("settings.dark")}
                onClick={() => setTheme("dark")}
              />
            </div>
          </SettingsSection>

          <SettingsSection
            icon={Languages}
            title={t("language.label")}
            description={t("settings.languageBody")}
          >
            <p className="text-sm text-muted-foreground">{t("settings.chooseLanguage")}</p>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <PreferenceButton
                active={language === "en"}
                label={t("language.english")}
                onClick={() => setLanguage("en")}
              />
              <PreferenceButton
                active={language === "hi"}
                label={t("language.hindi")}
                onClick={() => setLanguage("hi")}
              />
            </div>
          </SettingsSection>
        </div>
      </div>
    </AppShell>
  );
}

function SettingsSection({
  icon: Icon,
  title,
  description,
  children,
}: {
  icon: typeof Settings;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-3xl border border-border bg-card p-6 shadow-soft sm:p-8">
      <div className="flex items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-mint text-primary">
          <Icon aria-hidden="true" className="size-5" />
        </span>
        <div>
          <h2 className="font-semibold text-foreground">{title}</h2>
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{description}</p>
        </div>
      </div>
      <div className="mt-6">{children}</div>
    </section>
  );
}

function PreferenceButton({
  active,
  icon: Icon,
  label,
  onClick,
}: {
  active: boolean;
  icon?: typeof Sun;
  label: string;
  onClick: () => void;
}) {
  return (
    <Button
      type="button"
      variant={active ? "default" : "outline"}
      aria-pressed={active}
      onClick={onClick}
      className="h-auto min-h-11 justify-between px-3 py-2.5"
    >
      <span className="flex items-center gap-2">
        {Icon ? <Icon aria-hidden="true" /> : null}
        {label}
      </span>
      {active ? <Check aria-hidden="true" /> : null}
    </Button>
  );
}
