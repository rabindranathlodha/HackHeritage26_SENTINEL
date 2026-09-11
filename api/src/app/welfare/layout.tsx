import Link from "next/link";
import { redirect } from "next/navigation";

import { endSession, readSession } from "@/lib/session";

// The console shell.
//
// The banner is not decoration. An officer works here all shift, and the one
// thing that should never fade into the furniture is that opening somebody's
// record is an act with a record of its own.
export default async function ConsoleLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await readSession();

  async function signOutAction() {
    "use server";
    await endSession();
    // Without the redirect the cookie is gone but the rendered page stays,
    // leaving an officer looking at a queue they are no longer signed in to.
    redirect("/welfare/login");
  }

  return (
    <div className="flex min-h-dvh flex-col">
      {session && (
        <header className="border-line bg-surface sticky top-0 z-10 border-b">
          <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center gap-x-6 gap-y-3 px-6 py-3">
            <Link href="/welfare" className="flex items-center gap-2.5">
              <span aria-hidden className="bg-accent size-5 rounded-sm" />
              <span className="meta text-ink-3">SENTINEL Console</span>
            </Link>

            <nav className="flex items-center gap-1" aria-label="Sections">
              <Link
                href="/welfare"
                className="hover:bg-sunk rounded-sm px-3 py-2 text-sm font-medium"
              >
                Queue
              </Link>
              {(session.role === "COMMANDER" || session.role === "ADMIN") && (
                <Link
                  href="/welfare/cohort"
                  className="hover:bg-sunk rounded-sm px-3 py-2 text-sm font-medium"
                >
                  Units
                </Link>
              )}
            </nav>

            <div className="ml-auto flex items-center gap-4">
              <span className="meta text-ink-3">
                {session.userId} · {session.role.replace("_", " ")}
              </span>
              <form action={signOutAction}>
                <button
                  type="submit"
                  className="text-ink-2 hover:bg-sunk rounded-sm px-3 py-2 text-sm"
                >
                  Sign out
                </button>
              </form>
            </div>
          </div>
        </header>
      )}

      {children}
    </div>
  );
}
