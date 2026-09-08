import { getLocale, getTranslations } from "next-intl/server";

import { CheckInFlow } from "@/components/CheckInFlow";
import { ITEMS } from "@/content/questionnaire";
import { DEFAULT_LOCALE, isLocale } from "@/i18n/locale";

export async function generateMetadata() {
  const t = await getTranslations("checkIn");
  return { title: t("title") };
}

export default async function CheckInPage() {
  const t = await getTranslations("checkIn");
  const errors = await getTranslations("errors");
  const raw = await getLocale();
  const locale = isLocale(raw) ? raw : DEFAULT_LOCALE;

  // Question text comes from content/questionnaire.ts (spec 8 keeps the items
  // there, with both languages, rather than in the message files).
  const questions = ITEMS.map((item) => item.text[locale]);

  return (
    <CheckInFlow
      locale={locale}
      questions={questions}
      labels={{
        progress: ITEMS.map((_, i) =>
          t("progress", { current: i + 1, total: ITEMS.length }),
        ),
        scale: [t("scale.0"), t("scale.1"), t("scale.2"), t("scale.3")],
        next: t("next"),
        back: t("back"),
        submit: t("submit"),
        submitting: t("submitting"),
        error: errors("generic"),
        retry: errors("retry"),
      }}
    />
  );
}
