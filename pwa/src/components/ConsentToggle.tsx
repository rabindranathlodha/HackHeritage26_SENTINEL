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
        className="border-line bg-surface flex min-h-14 items-start gap-3.5 rounded-xl border px-[17px] py-4 text-left disabled:opacity-60"
      >
        <span className="flex flex-1 flex-col gap-1">
          <span className="text-base font-semibold">{t("biometricHeading")}</span>
          <span className="text-ink-2 text-[13px] leading-snug">
            {t("biometricBody")}
          </span>
          {/* The state, spelled out. A switch graphic alone asks the person to
              remember which side means on — this says it, and says that
              turning it back off is one tap. */}
          <span className={`meta mt-1 ${on ? "text-ember-ink" : "text-ink-3"}`}>
            {on ? t("consentOn") : t("consentOff")}
          </span>
        </span>

        <span
          aria-hidden
          className={
            "relative h-8 w-14 shrink-0 rounded-full transition-colors duration-200 " +
            (on ? "bg-ember" : "bg-line")
          }
        >
          <motion.span
            className="absolute top-[3px] size-[26px] rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,.18)]"
            animate={{ left: on ? 27 : 3 }}
            transition={reduceMotion ? { duration: 0 } : { duration: 0.18 }}
          />
        </span>
      </button>

      {failed && (
        <p role="alert" className="text-destructive text-[15px]">
          {t("consentFailed")}
        </p>
      )}
    </div>
  );
}
