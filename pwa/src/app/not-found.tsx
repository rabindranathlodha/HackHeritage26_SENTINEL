import Link from "next/link";
import { getTranslations } from "next-intl/server";

// "No dead ends." A wrong link is a designed state here, not the framework's
// default page — and it always offers the way back rather than leaving someone
// to find it themselves.
export default async function NotFound() {
  const t = await getTranslations("states");
  const checkIn = await getTranslations("checkIn");

  return (
    <main data-testid="not-found-root" className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-end gap-8 px-6 pt-24 pb-9">
      <div className="flex flex-col gap-4">
        <h1 className="anchor">{t("notFoundTitle")}</h1>
        <p className="text-ink-2 text-lg leading-relaxed">{t("notFoundBody")}</p>
      </div>

      <Link
        href="/home"
        className="bg-ember text-on-ember flex min-h-14 items-center justify-center rounded-lg text-[17px] font-semibold"
      >
        {checkIn("backHome")}
      </Link>
    </main>
  );
}
