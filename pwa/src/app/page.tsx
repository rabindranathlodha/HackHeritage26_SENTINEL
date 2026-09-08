// Step 3.1 placeholder. The real home screen is 4.2, and every string here
// moves into messages/{en,hi}.json at 3.3 — nothing user-facing stays hardcoded
// past that step (spec §8).

export default function Home() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-end gap-6 px-6 pb-16 pt-24">
      <div className="space-y-3">
        <h1 className="text-3xl font-medium tracking-tight text-balance">
          Your private wellness companion
        </h1>
        <p className="text-muted-foreground text-base leading-relaxed">
          A place to check in with yourself. What you write here stays on your
          phone.
        </p>
      </div>
    </main>
  );
}
