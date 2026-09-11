import { redirect } from "next/navigation";

import { signIn } from "@/lib/consoleAuth";
import { readSession, startSession } from "@/lib/session";

export const metadata = { title: "Sign in" };

// One message for every failure, and no hint about which half was wrong.
const FAILED = "That ID and password did not match.";

export default async function ConsoleLogin({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  if (await readSession()) redirect("/welfare");
  const { error } = await searchParams;

  async function attempt(formData: FormData) {
    "use server";
    const session = await signIn(
      String(formData.get("loginId") ?? ""),
      String(formData.get("password") ?? ""),
    );
    if (!session) redirect("/welfare/login?error=1");
    await startSession(session);
    redirect("/welfare");
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center gap-8 px-6 py-16">
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-2.5">
          <span aria-hidden className="bg-accent size-6 rounded-sm" />
          <span className="meta text-ink-3">SENTINEL</span>
        </div>
        <h1 className="text-3xl font-bold">Welfare Console</h1>
        <p className="text-ink-2 leading-relaxed">
          For assigned welfare officers. Every individual record you open is
          recorded, with your name and the time.
        </p>
      </div>

      <form action={attempt} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="loginId" className="meta text-ink-3">
            Officer ID
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
            Password
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
            {FAILED}
          </p>
        )}

        <button
          type="submit"
          className="bg-accent text-on-accent mt-2 min-h-12 rounded-md font-semibold"
        >
          Sign in
        </button>
      </form>

      <p className="text-ink-3 text-[13px] leading-relaxed">
        This console shows indicators for human review. It is not a clinical
        assessment and it does not decide anything.
      </p>
    </main>
  );
}
