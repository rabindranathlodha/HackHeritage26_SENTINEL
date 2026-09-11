import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";

import { auth, signOut } from "@/auth";
import { Ambient } from "@/components/Ambient";
import { BottomNav } from "@/components/BottomNav";
import { CheckInCard } from "@/components/CheckInCard";
import { SyncStatus } from "@/components/SyncStatus";
import { ITEMS } from "@/content/questionnaire";
import { getCheckInStatus } from "@/lib/api";

export async function generateMetadata() {
  const t = await getTranslations("app");
  return { title: t("name") };
}

/** One quiet door. Never the primary action — those are ember, these are not. */
function Door({
  href,
  title,
  hint,
}: {
  href: string;
  title: string;
  hint: string;
}) {
  return (
    <Link
      href={href}
      className="border-line flex items-center justify-between gap-4 rounded-xl border px-5 py-4"
    >
      <span className="flex flex-col gap-0.5">
        <span className="text-[17px] font-semibold">{title}</span>
        <span className="text-ink-2 text-sm">{hint}</span>
      </span>
      <span aria-hidden className="text-ink-3 text-xl">
        →
      </span>
    </Link>
  );
}

// Spec 4.2: never a score, a band, or a risk number. Supportive status only.
//
// The design's phrase for this screen is "supportive status, never a score":
// one bold greeting, one primary action, quiet doors to everything else. The
// only "status" here is an acknowledgement that the person showed up.
export default async function HomePage() {
  const session = await auth();
  const locale = await getLocale();
  const t = await getTranslations("home");

  // If the app tier is unreachable, offer the check-in rather than block it.
  // A person who wants to check in should never be told they cannot.
  let due = true;
  try {
    if (session?.user?.id) {
      due = (await getCheckInStatus(session.user.id)).due;
    }
  } catch {
    due = true;
  }

  // The design's eyebrow is "TUESDAY · WEEK 32". The weekday is real and
  // localised; the week number is not shown, because a person counting weeks
  // is a person being measured, which is the opposite of the brief.
  const weekday = new Intl.DateTimeFormat(locale, { weekday: "long" }).format(
    new Date(),
  );

  return (
    <main data-testid="home-root" className="relative mx-auto flex min-h-dvh w-full max-w-md flex-col">
      {/* Clipped to the top of the screen so the glow bleeds off the corner
          rather than being a circle sitting on the page. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-80 overflow-hidden"
      >
        <Ambient />
      </div>

      <div className="relative flex flex-col gap-8 px-6 pt-10 pb-10">
        <div>
          <p className="meta text-ink-3">{weekday}</p>
          <h1 className="anchor mt-4">{due ? t("greeting") : t("checkedIn")}</h1>
        </div>

        <SyncStatus />

        {due ? (
          <CheckInCard total={ITEMS.length} />
        ) : (
          <p className="text-ink-2 text-lg leading-relaxed">{t("checkedInBody")}</p>
        )}

        <div className="flex flex-col gap-3">
          <Door
            href="/journal"
            title={t("journalCard")}
            hint={t("journalCardHint")}
          />
          <Door
            href="/transparency"
            title={t("transparencyCard")}
            hint={t("transparencyCardHint")}
          />
          <Door
            href="/settings"
            title={t("settingsCard")}
            hint={t("settingsCardHint")}
          />
        </div>

        <form
          action={async () => {
            "use server";
            await signOut({ redirectTo: "/login" });
          }}
        >
          <button
            type="submit"
            className="text-ink-2 min-h-14 w-full text-[15px]"
          >
            {t("signOut")}
          </button>
        </form>
      </div>

      <BottomNav />
    </main>
  );
}
