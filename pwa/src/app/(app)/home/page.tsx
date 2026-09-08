import { getTranslations } from "next-intl/server";

import { auth, signOut } from "@/auth";
import { LanguageToggle } from "@/components/LanguageToggle";

export async function generateMetadata() {
  const t = await getTranslations("app");
  return { title: t("name") };
}

// Spec 4.2: never a score, a band, or a risk number. Supportive status only.
export default async function HomePage() {
  await auth();
  const t = await getTranslations("home");

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-end gap-8 px-6 pb-16 pt-24">
      <div className="space-y-3">
        <h1 className="text-3xl font-medium tracking-tight text-balance">
          {t("greeting")}
        </h1>
        <p className="text-muted-foreground text-base leading-relaxed">
          {t("supportive")}
        </p>
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
          className="border-border h-14 w-full rounded-xl border text-base font-medium"
        >
          {t("signOut")}
        </button>
      </form>
    </main>
  );
}
