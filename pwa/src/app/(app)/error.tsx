"use client";

import { useTranslations } from "next-intl";
import { useEffect } from "react";

// The error boundary for every signed-in screen (spec 3.10).
//
// Tone is the whole design here. A person who has just written something
// private and hit a failure needs to know it is not lost, in plain words, with
// something to do next. No stack trace, no error code, no apology theatre.
//
// The design gives failure the sunk ground rather than a red one: nothing that
// can go wrong in this app is the person's fault, and colouring it as an alarm
// would say otherwise.
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
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-end gap-8 px-6 pt-24 pb-9">
      <div className="bg-sunk flex flex-col gap-3 rounded-2xl p-[22px]">
        <h1 className="text-2xl leading-tight font-semibold">{t("errorTitle")}</h1>
        <p className="text-ink-2 text-base leading-relaxed">{t("errorBody")}</p>
      </div>

      <button
        type="button"
        onClick={reset}
        className="bg-ember text-on-ember min-h-14 rounded-lg text-[17px] font-semibold"
      >
        {t("errorRetry")}
      </button>
    </main>
  );
}
