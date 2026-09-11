import Link from "next/link";

// The app tier serves two things: the route handlers the Companion calls, and
// the Welfare Console at /welfare. This page is neither — it exists so that
// hitting the root gives a person a door rather than a 404.
export default function Home() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center gap-5 px-6">
      <div className="flex items-center gap-2.5">
        <span aria-hidden className="bg-accent size-6 rounded-sm" />
        <span className="meta text-ink-3">SENTINEL</span>
      </div>
      <h1 className="text-2xl font-bold">App tier</h1>
      <p className="text-ink-2 leading-relaxed">
        Route handlers for the Personnel Companion, and the console assigned
        welfare officers sign in to.
      </p>
      <Link
        href="/welfare"
        className="bg-accent text-on-accent flex min-h-12 items-center justify-center rounded-md font-semibold"
      >
        Welfare Console
      </Link>
    </main>
  );
}
