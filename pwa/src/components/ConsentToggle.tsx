"use client";

import { motion, useReducedMotion } from "motion/react";
import { useTranslations } from "next-intl";
import { useState } from "react";

// The wellness-signal opt-in (PWA spec 4.6, principle 4).
//
// Three things this deliberately does NOT do:
//
//   It does not assume success. The switch shows what the server confirmed, not
//   what was clicked. A person who taps "off" and sees "off" while the server
//   still holds "on" has been told something untrue about their own data.
//
//   It does not require confirmation to turn OFF. Withdrawing consent should be
//   the easiest thing on the screen, not a flow with a dialog in the way.
//
//   It does not warn that anything will stop working. Nothing does — the app is
//   fully functional without this, and implying otherwise is pressure.
export function ConsentToggle({ initial }: { initial: boolean }) {
  const t = useTranslations("settings");
  const reduceMotion = useReducedMotion();

  const [on, setOn] = useState(initial);
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);

  async function change(next: boolean) {
    setPending(true);
    setFailed(false);
    try {
      const res = await fetch("/api/consent", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ biometricConsent: next }),
      });
      if (!res.ok) throw new Error(String(res.status));
      const body = (await res.json()) as { biometricConsent: boolean };
      // The server's answer, not the optimistic one.
      setOn(body.biometricConsent);
    } catch {
      setFailed(true);
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <button
        type="button"
        role="switch"
        aria-checked={on}
        data-testid="consent-toggle"
        disabled={pending}
        onClick={() => change(!on)}
        className="border-border flex min-h-14 items-center justify-between gap-4 rounded-2xl border px-5 text-left disabled:opacity-60"
      >
        <span className="text-base font-medium">{t("biometricHeading")}</span>
        <span
          aria-hidden
          className={
            "relative h-7 w-12 shrink-0 rounded-full transition-colors " +
            (on ? "bg-primary" : "bg-border")
          }
        >
          <motion.span
            className="bg-background absolute top-1 size-5 rounded-full"
            animate={{ left: on ? 26 : 4 }}
            transition={reduceMotion ? { duration: 0 } : { duration: 0.18 }}
          />
        </span>
      </button>

      <p className="text-muted-foreground text-sm leading-relaxed">
        {t("biometricBody")}
      </p>

      {failed && (
        <p role="alert" className="text-destructive text-sm">
          {t("consentFailed")}
        </p>
      )}
    </div>
  );
}
