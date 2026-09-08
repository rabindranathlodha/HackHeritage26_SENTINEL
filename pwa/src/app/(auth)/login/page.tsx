import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { LanguageToggle } from "@/components/LanguageToggle";
import { LoginForm } from "@/components/LoginForm";

export async function generateMetadata() {
  const t = await getTranslations("login");
  return { title: t("submit") };
}

export default async function LoginPage() {
  // Already signed in: no reason to show a login form.
  const session = await auth();
  if (session?.user) redirect("/home");

  const t = await getTranslations("login");

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-end gap-8 px-6 pb-16 pt-24">
      <div className="space-y-3">
        <h1 className="text-3xl font-medium tracking-tight text-balance">
          {t("heading")}
        </h1>
        {/* Spec 4.1: no mention of scores, monitoring or reporting. */}
        <p className="text-muted-foreground text-base leading-relaxed">
          {t("reassurance")}
        </p>
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
