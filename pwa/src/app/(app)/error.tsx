"use client";

import { useTranslations } from "next-intl";
import { useEffect } from "react";

// The error boundary for every signed-in screen (spec 3.10).
//
// Tone is the whole design here. A person who has just written something
// private and hit a failure needs to know it is not lost, in plain words, with
// something to do next. No stack trace, no error code, no apology theatre.
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations("states");

  useEffect(() => {
    // To the console, never to the screen: a digest is useful to whoever
    // supports this and meaningless to the person reading it.
    console.error("screen failed to render", error);
  }, [error]);

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-end gap-8 px-6 pb-16 pt-24">
      <div className="space-y-3">
        <h1 className="text-2xl font-medium tracking-tight">{t("errorTitle")}</h1>
        <p className="text-muted-foreground text-base leading-relaxed">
          {t("errorBody")}
        </p>
      </div>

      <button
        type="button"
        onClick={reset}
        className="bg-primary text-primary-foreground min-h-14 rounded-xl text-base font-medium"
      >
        {t("errorRetry")}
      </button>
    </main>
  );
}
