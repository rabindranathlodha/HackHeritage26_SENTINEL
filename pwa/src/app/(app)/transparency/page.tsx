import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { BottomNav } from "@/components/BottomNav";

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
//
// `tone` is the design's bento, adapted. The design tiles a 2-column grid
// because its tile copy is three to eight words; these bodies are full
// sentences, and two columns of prose at 360px is unreadable. So the bento's
// vocabulary is kept — an eyebrow, differentiated grounds, one statement per
// tile — in a single column. The hierarchy comes from ground, not from
// position: `hero` is the promise that matters most, `accent` is the one
// exception to it, and the rest are plain.
const SECTIONS = [
  { heading: "collectedHeading", tone: "plain", bodies: ["collectedBody", "collectedWearable"] },
  { heading: "onDeviceHeading", tone: "hero", bodies: ["onDeviceBody"] },
  { heading: "teamHeading", tone: "accent", bodies: ["teamBody", "teamAudit"] },
  { heading: "commanderHeading", tone: "plain", bodies: ["commanderBody"] },
  { heading: "controlsHeading", tone: "plain", bodies: ["controlsBody", "controlsContact"] },
  { heading: "questionsHeading", tone: "quiet", bodies: ["questionsBody"] },
] as const;

const TILE = {
  plain: "bg-surface border-line border",
  hero: "bg-hero text-hero-ink",
  accent: "bg-ember-soft",
  quiet: "bg-sunk",
} as const;

const EYEBROW = {
  plain: "text-ink-3",
  hero: "text-hero-meta",
  accent: "text-ember-ink",
  quiet: "text-ink-3",
} as const;

const BODY = {
  plain: "text-ink-2",
  hero: "text-hero-meta",
  accent: "text-ink",
  quiet: "text-ink-2",
} as const;

export default async function TransparencyPage() {
  const t = await getTranslations("transparency");
  const settings = await getTranslations("settings");
  const home = await getTranslations("home");

  return (
    <main data-testid="transparency-root" className="mx-auto flex min-h-dvh w-full max-w-md flex-col">
      <div className="flex flex-col gap-4 px-6 pt-8 pb-10">
        <h1 className="anchor">{t("title")}</h1>
        <p className="text-ink-2 text-[17px] leading-relaxed">{t("intro")}</p>

        <div className="mt-2 flex flex-col gap-2.5">
          {SECTIONS.map((section) => (
            <section
              key={section.heading}
              className={`flex flex-col gap-2.5 rounded-xl p-5 ${TILE[section.tone]}`}
            >
              <h2 className={`meta ${EYEBROW[section.tone]}`}>{t(section.heading)}</h2>
              {section.bodies.map((body) => (
                <p
                  key={body}
                  className={`text-[15px] leading-relaxed ${BODY[section.tone]}`}
                >
                  {t(body)}
                </p>
              ))}
            </section>
          ))}

          {/* The design puts "Your controls" at the end of this screen rather
              than in the navigation: the place that tells you what is shared
              is the place that lets you change it. */}
          <Link
            href="/settings"
            className="border-line bg-surface flex items-center justify-between gap-4 rounded-xl border px-5 py-4"
          >
            <span className="flex flex-col gap-0.5">
              <span className="text-base font-semibold">{settings("title")}</span>
              <span className="text-ink-2 text-[13px]">
                {home("settingsCardHint")}
              </span>
            </span>
            <span aria-hidden className="text-ink-3 text-xl">
              →
            </span>
          </Link>
        </div>
      </div>

      <BottomNav />
    </main>
  );
}
