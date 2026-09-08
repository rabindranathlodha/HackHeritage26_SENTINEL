import Link from "next/link";
import { getTranslations } from "next-intl/server";

export default async function NotFound() {
  const t = await getTranslations("states");
  const checkIn = await getTranslations("checkIn");

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-end gap-8 px-6 pb-16 pt-24">
      <div className="space-y-3">
        <h1 className="text-2xl font-medium tracking-tight">{t("notFoundTitle")}</h1>
        <p className="text-muted-foreground text-base leading-relaxed">
          {t("notFoundBody")}
        </p>
      </div>

      <Link
        href="/home"
        className="border-border flex min-h-14 items-center justify-center rounded-xl border text-base font-medium"
      >
        {checkIn("backHome")}
      </Link>
    </main>
  );
}
