import { getTranslations } from "next-intl/server";

import { auth, signOut } from "@/auth";
import { ClearLocalData } from "@/components/ClearLocalData";
import { ConsentToggle } from "@/components/ConsentToggle";
import { LanguageToggle } from "@/components/LanguageToggle";
import { getConsent } from "@/lib/api";

export async function generateMetadata() {
  const t = await getTranslations("settings");
  return { title: t("title") };
}

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

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col gap-10 px-6 pb-16 pt-16">
      <h1 className="text-3xl font-medium tracking-tight text-balance">{t("title")}</h1>

      <ConsentToggle initial={consent} />

      <section className="flex flex-col gap-3">
        <h2 className="text-base font-medium">{t("language")}</h2>
        <LanguageToggle />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-base font-medium">{t("localHeading")}</h2>
        <p className="text-muted-foreground text-sm leading-relaxed">{t("localBody")}</p>
        <ClearLocalData />
      </section>

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
