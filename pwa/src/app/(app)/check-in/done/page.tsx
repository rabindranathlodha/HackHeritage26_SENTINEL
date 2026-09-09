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
// The design gives this screen the only full-bleed accent in the product: the
// ember-soft ground marks it as an arrival rather than another page. It is
// also the one screen with no bottom nav, because there is nothing here to
// navigate — the person is finished.
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
    <main className="bg-ember-soft mx-auto flex min-h-dvh w-full max-w-md flex-col justify-end gap-8 px-6 pt-24 pb-9">
      <div className="flex flex-col gap-6">
        <h1 className="anchor">{t("thanks")}</h1>

        <p className="text-ember-ink max-w-[28ch] text-lg leading-relaxed">
          {queued === "1" ? t("queued") : t("thanksBody")}
        </p>

        {/* The door, named but never opened for them. Nothing in this app
            contacts anyone on a person's behalf — so this says where the door
            is and leaves the decision where it belongs. */}
        <p className="bg-surface/70 text-ink-2 rounded-xl px-5 py-4.5 text-base leading-relaxed">
          {t("doneAside")}
        </p>
      </div>

      <Link
        href="/home"
        className="bg-ember text-on-ember flex min-h-14 items-center justify-center rounded-lg text-[17px] font-semibold"
      >
        {t("backHome")}
      </Link>
    </main>
  );
}
