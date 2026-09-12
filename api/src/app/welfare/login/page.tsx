import { redirect } from "next/navigation";

import { ConsoleLanguageToggle } from "@/components/ConsoleLanguageToggle";
import { translator } from "@/content/console";
import { consoleLocale } from "@/lib/consoleLocale";
import { signIn } from "@/lib/consoleAuth";
import { readSession, startSession } from "@/lib/session";

export const metadata = { title: "Sign in" };

export default async function ConsoleLogin({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  if (await readSession()) redirect("/welfare");
  const { error } = await searchParams;
  const t = translator(await consoleLocale());

  async function attempt(formData: FormData) {
    "use server";
    const session = await signIn(
      String(formData.get("loginId") ?? ""),
      String(formData.get("password") ?? ""),
    );
    // One message for every failure, and no hint about which half was wrong.
    if (!session) redirect("/welfare/login?error=1");
    await startSession(session);
    redirect("/welfare");
  }

  return (
    <main
      data-testid="console-login-root"
      className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center gap-8 px-6 py-16"
    >
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <span aria-hidden className="bg-accent size-6 rounded-sm" />
            <span className="meta text-ink-3">SENTINEL</span>
          </div>
          {/* Offered before sign-in: an officer who cannot read the form
              cannot reach a setting inside the console to fix it. */}
          <ConsoleLanguageToggle />
        </div>
        <h1 className="text-3xl font-bold">{t("loginTitle")}</h1>
        <p className="text-ink-2 leading-relaxed">{t("loginIntro")}</p>
      </div>

      <form action={attempt} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="loginId" className="meta text-ink-3">
            {t("loginId")}
          </label>
          <input
            id="loginId"
            name="loginId"
            autoComplete="username"
            required
            className="border-line bg-surface min-h-12 rounded-md border px-3.5 text-base outline-none focus-visible:border-transparent"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="password" className="meta text-ink-3">
            {t("loginPassword")}
          </label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            className="border-line bg-surface min-h-12 rounded-md border px-3.5 text-base outline-none focus-visible:border-transparent"
          />
        </div>

        {error && (
          <p role="alert" className="text-band-priority text-sm">
            {t("loginFailed")}
          </p>
        )}

        <button
          type="submit"
          className="bg-accent text-on-accent mt-2 min-h-12 rounded-md font-semibold"
        >
          {t("loginSubmit")}
        </button>
      </form>

      <p className="text-ink-3 text-[13px] leading-relaxed">{t("loginDisclaimer")}</p>
    </main>
  );
}
