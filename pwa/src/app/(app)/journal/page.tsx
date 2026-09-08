import { getLocale, getTranslations } from "next-intl/server";

import { JournalEditor } from "@/components/JournalEditor";
import { DEFAULT_LOCALE, isLocale } from "@/i18n/locale";

export async function generateMetadata() {
  const t = await getTranslations("journal");
  return { title: t("title") };
}

export default async function JournalPage() {
  const t = await getTranslations("journal");
  const raw = await getLocale();
  const locale = isLocale(raw) ? raw : DEFAULT_LOCALE;

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col gap-8 px-6 pb-16 pt-16">
      <div className="space-y-3">
        <h1 className="text-3xl font-medium tracking-tight text-balance">
          {t("title")}
        </h1>
        <p className="text-muted-foreground text-base leading-relaxed">{t("prompt")}</p>
        {/* The promise, stated on the screen where it applies rather than only
            on the transparency page. */}
        <p className="text-sm font-medium">{t("onDevice")}</p>
      </div>

      <JournalEditor locale={locale} />
    </main>
  );
}
