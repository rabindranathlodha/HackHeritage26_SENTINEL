import Link from "next/link";
import { getTranslations } from "next-intl/server";

export async function generateMetadata() {
  const t = await getTranslations("checkIn");
  return { title: t("thanks") };
}

// Spec 4.3: "compute nothing user-facing beyond a thank-you". No score, no
// band, no interpretation of what was just submitted — the app tier does not
// even send those to this app.
//
// The only variation is whether it went out now or is waiting in the outbox,
// and both are phrased as success. A person with no signal has done nothing
// wrong and should not be shown a warning for it.
export default async function CheckInDonePage({
  searchParams,
}: {
  searchParams: Promise<{ queued?: string }>;
}) {
  const t = await getTranslations("checkIn");
  const { queued } = await searchParams;

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-end gap-8 px-6 pb-16 pt-24">
      <div className="space-y-3">
        <h1 className="text-3xl font-medium tracking-tight text-balance">
          {t("thanks")}
        </h1>
        <p className="text-muted-foreground text-base leading-relaxed">
          {queued === "1" ? t("queued") : t("thanksBody")}
        </p>
      </div>

      <Link
        href="/home"
        className="border-border flex min-h-14 items-center justify-center rounded-xl border text-base font-medium"
      >
        {t("backHome")}
      </Link>
    </main>
  );
}
