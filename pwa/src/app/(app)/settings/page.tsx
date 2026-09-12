import { getTranslations } from "next-intl/server";

import { auth, signOut } from "@/auth";
import { BottomNav } from "@/components/BottomNav";
import { ClearLocalData } from "@/components/ClearLocalData";
import { ConsentToggle } from "@/components/ConsentToggle";
import { LanguageToggle } from "@/components/LanguageToggle";
import { OutreachToggle } from "@/components/OutreachToggle";
import { ReminderSettings } from "@/components/ReminderSettings";
import { getConsent, getPreferences } from "@/lib/api";
import type { Preferences } from "@/lib/schemas";

export async function generateMetadata() {
  const t = await getTranslations("settings");
  return { title: t("title") };
}

// "Your controls" — the design's name for this screen, and a better one than
// "Settings": it says whose they are.
//
// Every sensing option ships OFF and reverses in one tap. There is no
// confirmation dialog anywhere on this screen, because a dialog between a
// person and withdrawing consent is friction pointed the wrong way.
export default async function SettingsPage() {
  const session = await auth();
  const t = await getTranslations("settings");

  // Read from the server, not from a local cache. The toggle must show what is
  // actually recorded — a stale "on" would misrepresent what the person has
  // shared, and a stale "off" would be worse.
  let consent = false;
  try {
    if (session?.user?.id) consent = await getConsent(session.user.id);
  } catch {
    // Fail to OFF: the state that cannot overstate what has been shared.
    consent = false;
  }

  // Same rule for both of these. Outreach shown as OFF cannot claim somebody
  // agreed to be approached when the record could not be read, and a reminder
  // shown as OFF is a missing nudge rather than a promise of one that will
  // never arrive.
  let preferences: Preferences = {
    allowWelfareOutreach: false,
    reminder: { enabled: false, dow: null, hour: null, tz: null },
    devices: 0,
  };
  try {
    if (session?.user?.id) preferences = await getPreferences(session.user.id);
  } catch {
    // Defaults above.
  }

  return (
    <main data-testid="settings-root" className="mx-auto flex min-h-dvh w-full max-w-md flex-col">
      <div className="flex flex-col gap-4.5 px-6 pt-8 pb-10">
        <h1 className="anchor">{t("title")}</h1>

        <div className="flex flex-col gap-2.5">
          <ConsentToggle initial={consent} />

          <OutreachToggle initial={preferences.allowWelfareOutreach} />

          <ReminderSettings
            initial={preferences.reminder}
            devices={preferences.devices}
          />

          <section className="border-line bg-surface flex flex-col gap-2.5 rounded-xl border px-[17px] py-4">
            <h2 className="text-base font-semibold">{t("language")}</h2>
            <LanguageToggle />
          </section>

          <ClearLocalData />
        </div>

        <form
          action={async () => {
            "use server";
            await signOut({ redirectTo: "/login" });
          }}
        >
          <button type="submit" className="text-ink-2 min-h-14 w-full text-[15px]">
            {t("signOut")}
          </button>
        </form>
      </div>

      <BottomNav />
    </main>
  );
}
