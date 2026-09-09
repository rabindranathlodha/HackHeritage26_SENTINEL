import { getLocale, getTranslations } from "next-intl/server";

import { BottomNav } from "@/components/BottomNav";
import { JournalEditor } from "@/components/JournalEditor";
import { PrivacyChip } from "@/components/PrivacyChip";
import { DEFAULT_LOCALE, isLocale } from "@/i18n/locale";

export async function generateMetadata() {
  const t = await getTranslations("journal");
  return { title: t("title") };
}

// "Privacy is drawn, not disclaimed" — the design's rule for this screen.
//
// The chip sits directly under the title, on the surface where the person is
// about to write, rather than the promise living only on the transparency page
// they read once during onboarding and never again.
export default async function JournalPage() {
  const t = await getTranslations("journal");
  const raw = await getLocale();
  const locale = isLocale(raw) ? raw : DEFAULT_LOCALE;

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col">
      <div className="flex flex-col gap-6 px-6 pt-8 pb-10">
        <div className="flex flex-col items-start gap-3">
          <h1 className="anchor">{t("title")}</h1>
          <PrivacyChip>{t("onPhoneOnly")}</PrivacyChip>
        </div>

        <p className="text-ink-2 text-[17px] leading-relaxed">{t("prompt")}</p>

        <JournalEditor locale={locale} />
      </div>

      <BottomNav />
    </main>
  );
}
