import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { auth } from "@/auth";
import { LanguageToggle } from "@/components/LanguageToggle";
import { LoginForm } from "@/components/LoginForm";

export async function generateMetadata() {
  const t = await getTranslations("login");
  return { title: t("submit") };
}

// The design's welcome screen: "This one is yours."
//
// It opens with the promise rather than the form, because the first thing a
// wary person needs is not a field to fill in. The design's onboarding makes
// this promise across four screens before any sign-in; here it is condensed
// into the one screen this build actually has.
export default async function LoginPage() {
  // Already signed in: no reason to show a login form.
  const session = await auth();
  if (session?.user) redirect("/home");

  const t = await getTranslations("login");

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-end gap-8 px-6 pt-24 pb-9">
      <div className="flex flex-col gap-6">
        {/* The mark, as a plain ember tile. No wordmark: someone glancing at
            this person's phone should not see a monitoring product named. */}
        <div aria-hidden className="bg-ember size-[34px] rounded-lg" />

        <div className="flex flex-col gap-5">
          <h1 className="anchor">{t("heading")}</h1>
          {/* Spec 4.1: no mention of scores, monitoring or reporting. */}
          <p className="text-ink-2 text-lg leading-relaxed">{t("reassurance")}</p>
        </div>
      </div>

      <LoginForm
        labels={{
          id: t("idLabel"),
          password: t("passwordLabel"),
          submit: t("submit"),
          submitting: t("submitting"),
          failed: t("failed"),
        }}
      />

      {/* Before sign-in, not after: a person who cannot read the form cannot
          reach a settings screen to fix it. */}
      <LanguageToggle />
    </main>
  );
}
