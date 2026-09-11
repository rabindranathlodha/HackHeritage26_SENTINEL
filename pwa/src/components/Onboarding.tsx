"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { LanguageToggle } from "@/components/LanguageToggle";

// Four screens, one promise each.
//
// The design's rule for this sequence is that every screen makes a single
// privacy promise concrete rather than listing terms. It is deliberately
// skippable from the first screen and deliberately not a wall: a person who
// does not want to read it has already been failed by every other form they
// have been handed, and making this one mandatory would prove their point.
//
// Nothing here is stored. There is no "seen onboarding" flag, because a flag
// keyed to a device would silently hide these promises from someone reinstalling
// on a new handset — which is exactly when they would want to read them again.
// It is reachable forever from the sign-in screen.

const TOTAL = 4;

export function Onboarding() {
  const t = useTranslations("onboarding");
  const reduceMotion = useReducedMotion();
  const [step, setStep] = useState(0);

  // "420ms, 12px upward drift and fade. Slow enough to feel accompanied."
  const transition = reduceMotion
    ? { initial: false, animate: {}, exit: {}, transition: { duration: 0 } }
    : {
        initial: { opacity: 0, y: 12 },
        animate: { opacity: 1, y: 0 },
        exit: { opacity: 0, y: -12 },
        transition: { duration: 0.42, ease: [0.22, 0.61, 0.36, 1] as const },
      };

  const isLast = step === TOTAL - 1;

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-6 pt-8 pb-9">
      <div className="flex items-center justify-between">
        <span aria-hidden className="bg-ember size-[34px] rounded-lg" />
        {!isLast && (
          <Link href="/login" className="text-ink-3 min-h-11 px-2 text-[15px] leading-[44px]">
            {t("skip")}
          </Link>
        )}
      </div>

      <p className="sr-only" aria-live="polite">
        {t("step", { current: step + 1, total: TOTAL })}
      </p>

      <div className="flex flex-1 flex-col justify-center py-10">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div key={step} {...transition} className="flex flex-col gap-6">
            {step === 0 && (
              <>
                <h1 className="anchor">{t("step1Title")}</h1>
                <p className="text-ink-2 max-w-[26ch] text-lg leading-relaxed">
                  {t("step1Body")}
                </p>
              </>
            )}

            {step === 1 && (
              <>
                <h1 className="anchor">{t("step2Title")}</h1>
                {/* The promise drawn as two rows rather than asserted in a
                    sentence: one lit, one deliberately dimmed and hollow. */}
                <div className="border-line bg-surface flex flex-col gap-4 rounded-2xl border p-5">
                  <div className="flex flex-col gap-2">
                    <div className="flex items-center gap-3.5">
                      <span aria-hidden className="bg-ember size-2.5 shrink-0 rounded-full" />
                      <span className="text-base font-semibold">{t("step2Mine")}</span>
                    </div>
                    <p className="meta text-ink-3 pl-6">{t("step2MineWhere")}</p>
                  </div>
                  <div className="bg-line h-px" />
                  <div className="flex flex-col gap-2 opacity-55">
                    <div className="flex items-center gap-3.5">
                      <span
                        aria-hidden
                        className="border-ink-3 size-2.5 shrink-0 rounded-full border-[1.5px]"
                      />
                      <span className="text-base">{t("step2Them")}</span>
                    </div>
                    <p className="meta text-ink-3 pl-6">{t("step2ThemWhere")}</p>
                  </div>
                </div>
                <p className="text-ink-2 leading-relaxed">{t("step2Body")}</p>
              </>
            )}

            {step === 2 && (
              <>
                <h1 className="anchor">{t("step3Title")}</h1>
                <p className="text-ink-2 leading-relaxed">{t("step3Body")}</p>
                <div className="flex flex-col gap-2.5">
                  <p className="bg-ember-soft text-ember-ink rounded-md px-4 py-3.5 text-base font-semibold">
                    {t("step3Yes")}
                  </p>
                  {/* Struck through, not absent. Naming what does NOT happen is
                      the whole reassurance; leaving it out would make the list
                      read as a list of who does see this. */}
                  <p className="border-line text-ink-2 rounded-md border border-dashed px-4 py-3.5 text-base line-through">
                    {t("step3No1")}
                  </p>
                  <p className="border-line text-ink-2 rounded-md border border-dashed px-4 py-3.5 text-base line-through">
                    {t("step3No2")}
                  </p>
                </div>
              </>
            )}

            {step === 3 && (
              <>
                <h1 className="anchor">{t("step4Title")}</h1>
                <p className="text-ink-2 text-lg leading-relaxed">{t("step4Body")}</p>
              </>
            )}
          </motion.div>
        </AnimatePresence>
      </div>

      <div className="flex flex-col gap-4">
        <div className="flex gap-1.5" aria-hidden>
          {Array.from({ length: TOTAL }, (_, i) => (
            <span
              key={i}
              className={`h-[3px] w-6.5 rounded-sm transition-colors ${
                i === step ? "bg-ember" : "bg-line"
              }`}
            />
          ))}
        </div>

        {isLast ? (
          <Link
            href="/login"
            className="bg-ember text-on-ember flex min-h-14 items-center justify-center rounded-lg text-[17px] font-semibold"
          >
            {t("enter")}
          </Link>
        ) : (
          <button
            type="button"
            onClick={() => setStep((current) => Math.min(TOTAL - 1, current + 1))}
            className="bg-ember text-on-ember min-h-14 rounded-lg text-[17px] font-semibold"
          >
            {t("next")}
          </button>
        )}

        {/* Language is offered on the first screen, before a single promise has
            been made in a language the reader may not want it in. */}
        {step === 0 && <LanguageToggle />}
      </div>
    </main>
  );
}
