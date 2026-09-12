"use client";

import { motion, useReducedMotion } from "motion/react";
import { useTranslations } from "next-intl";
import { useState } from "react";

// Whether a welfare officer may contact this person first.
//
// The explanation sits ABOVE the control and is always visible. It is not
// behind a "learn more", not in a tooltip, and not below the fold. Consent to
// being approached is only meaningful if the person knew what they were
// agreeing to before they agreed, and the thing they most need to know is what
// this switch does NOT do.
//
// It does not stop their check-ins being read, and it does not suppress an
// alert. Someone who believed otherwise would turn it off and assume nothing
// was being computed about them — which would be a lie this screen told them.
// So the copy says "contacted, not noticed" in the first sentence, and the
// state line underneath says who makes the first move rather than what is
// hidden.
export function OutreachToggle({ initial }: { initial: boolean }) {
  const t = useTranslations("settings");
  const reduceMotion = useReducedMotion();

  const [on, setOn] = useState(initial);
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);

  async function change(next: boolean) {
    setPending(true);
    setFailed(false);
    try {
      const res = await fetch("/api/preferences", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ allowWelfareOutreach: next }),
      });
      if (!res.ok) throw new Error(String(res.status));
      const body = (await res.json()) as { allowWelfareOutreach: boolean };
      // The server's answer, not the optimistic one.
      setOn(body.allowWelfareOutreach);
    } catch {
      setFailed(true);
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="border-line bg-surface flex flex-col gap-3 rounded-xl border px-[17px] py-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-base font-semibold">{t("outreachHeading")}</h2>
        <p className="text-ink-2 text-[13px] leading-snug">{t("outreachBody")}</p>
      </div>

      {/* Read before the switch is reachable, by position rather than by
          instruction. Given its own ground so it is not skimmed as small print. */}
      <p className="bg-sunk text-ink-2 rounded-md px-3.5 py-3 text-[13px] leading-relaxed">
        {t("outreachPlain")}
      </p>

      <button
        type="button"
        role="switch"
        aria-checked={on}
        data-testid="outreach-toggle"
        disabled={pending}
        onClick={() => change(!on)}
        className="flex min-h-14 items-center gap-3.5 text-left disabled:opacity-60"
      >
        <span className={`meta flex-1 ${on ? "text-ember-ink" : "text-ink-3"}`}>
          {on ? t("outreachOn") : t("outreachOff")}
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
