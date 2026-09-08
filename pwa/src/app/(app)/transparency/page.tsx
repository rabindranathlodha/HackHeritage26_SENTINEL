import Link from "next/link";
import { getTranslations } from "next-intl/server";

export async function generateMetadata() {
  const t = await getTranslations("transparency");
  return { title: t("title") };
}

// The trust centrepiece (PWA spec 4.5).
//
// Every claim rendered here is paired, in content/transparency.ts, with the
// mechanism that makes it true and the test that proves it. A sentence cannot
// appear on this screen without that pairing — the guard exists because the
// realistic failure here is not a bug but a well-meant line that stops being
// true six months after someone wrote it, and this is the one page where an
// inaccuracy costs the product its whole premise.
const SECTIONS = [
  { heading: "collectedHeading", bodies: ["collectedBody", "collectedWearable"] },
  { heading: "onDeviceHeading", bodies: ["onDeviceBody"] },
  { heading: "teamHeading", bodies: ["teamBody", "teamAudit"] },
  { heading: "commanderHeading", bodies: ["commanderBody"] },
  { heading: "controlsHeading", bodies: ["controlsBody", "controlsContact"] },
  { heading: "questionsHeading", bodies: ["questionsBody"] },
] as const;

export default async function TransparencyPage() {
  const t = await getTranslations("transparency");
  const checkIn = await getTranslations("checkIn");

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col gap-10 px-6 pb-16 pt-16">
      <div className="space-y-3">
        <h1 className="text-3xl font-medium tracking-tight text-balance">
          {t("title")}
        </h1>
        <p className="text-muted-foreground text-base leading-relaxed">{t("intro")}</p>
      </div>

      {SECTIONS.map((section) => (
        <section key={section.heading} className="flex flex-col gap-3">
          <h2 className="text-lg font-medium tracking-tight">{t(section.heading)}</h2>
          {section.bodies.map((body) => (
            <p key={body} className="text-muted-foreground text-base leading-relaxed">
              {t(body)}
            </p>
          ))}
        </section>
      ))}

      <Link
        href="/home"
        className="border-border flex min-h-14 items-center justify-center rounded-xl border text-base font-medium"
      >
        {checkIn("backHome")}
      </Link>
    </main>
  );
}
