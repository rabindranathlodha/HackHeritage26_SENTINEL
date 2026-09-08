import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { auth, signOut } from "@/auth";
import { LanguageToggle } from "@/components/LanguageToggle";
import { SyncStatus } from "@/components/SyncStatus";
import { getCheckInStatus } from "@/lib/api";

export async function generateMetadata() {
  const t = await getTranslations("app");
  return { title: t("name") };
}

// Spec 4.2: never a score, a band, or a risk number. Supportive status only.
export default async function HomePage() {
  const session = await auth();
  const t = await getTranslations("home");
  const settings = await getTranslations("settings");

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

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-end gap-8 px-6 pb-16 pt-24">
      <div className="space-y-3">
        <h1 className="text-3xl font-medium tracking-tight text-balance">
          {t("greeting")}
        </h1>
        <p className="text-muted-foreground text-base leading-relaxed">
          {/* Both states are supportive. Neither reports on the person. */}
          {due ? t("supportive") : t("checkedIn")}
        </p>
      </div>

      <SyncStatus />

      <div className="flex flex-col gap-3">
        {due && (
          <Link
            href="/check-in"
            className="bg-primary text-primary-foreground flex min-h-14 items-center justify-center rounded-xl text-base font-medium"
          >
            {t("startCheckIn")}
          </Link>
        )}

        <Link
          href="/journal"
          className="border-border flex min-h-14 items-center justify-center rounded-xl border text-base font-medium"
        >
          {t("openJournal")}
        </Link>

        <Link
          href="/settings"
          className="border-border flex min-h-14 items-center justify-center rounded-xl border text-base font-medium"
        >
          {settings("title")}
        </Link>
      </div>

      <LanguageToggle />

      <form
        action={async () => {
          "use server";
          await signOut({ redirectTo: "/login" });
        }}
      >
        <button
          type="submit"
          className="border-border min-h-14 w-full rounded-xl border text-base font-medium"
        >
          {t("signOut")}
        </button>
      </form>
    </main>
  );
}
