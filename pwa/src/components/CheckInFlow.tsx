"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { SCALE_MAX, SCALE_MIN } from "@/content/questionnaire";
import { clearDraft, readDraft, saveDraft } from "@/lib/draft";
import { takeContribution } from "@/lib/journal";
import { enqueue } from "@/lib/offlineQueue";
import { responsesSchema } from "@/lib/schemas";

type Labels = {
  /**
   * One pre-formatted string per step, not a formatter function.
   *
   * A function cannot cross the server/client boundary — React has to serialize
   * props, and passing one throws "Functions cannot be passed directly to
   * Client Components". Formatting on the server also keeps ICU plurals and
   * number formatting with next-intl, where they belong.
   */
  progress: string[];
  scale: string[];
  eyebrow: string;
  next: string;
  back: string;
  submit: string;
  submitting: string;
  savedOnPhone: string;
  leaveForNow: string;
  error: string;
  retry: string;
};

type Props = {
  questions: string[];
  labels: Labels;
  locale: string;
  /** Arrived from Home's "continue where you left off" rather than cold. */
  resume?: boolean;
};

const SCALE_VALUES = Array.from(
  { length: SCALE_MAX - SCALE_MIN + 1 },
  (_, i) => SCALE_MIN + i,
);

export function CheckInFlow({ questions, labels, locale, resume = false }: Props) {
  const router = useRouter();
  const reduceMotion = useReducedMotion();

  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<(number | null)[]>(
    () => Array(questions.length).fill(null),
  );
  const [direction, setDirection] = useState<1 | -1>(1);
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  // Set only when a write to this phone actually succeeded. Not a proxy for
  // "an answer is selected" — see lib/draft.ts.
  const [savedHere, setSavedHere] = useState(false);

  const total = questions.length;
  const isLast = index === total - 1;
  const answered = answers[index] !== null;

  // Pick up a check-in left half-finished. Answers always come back; the
  // position only does when the person chose to resume from Home, so that
  // opening the check-in cold still starts at the first question rather than
  // dropping them into the middle of something they had forgotten about.
  useEffect(() => {
    let live = true;
    readDraft(questions.length).then((draft) => {
      if (!live || !draft) return;
      setAnswers(draft.answers);
      setSavedHere(draft.answers[resume ? draft.index : 0] !== null);
      if (resume) setIndex(Math.min(draft.index, questions.length - 1));
    });
    return () => {
      live = false;
    };
  }, [questions.length, resume]);

  // "Screen change: 420ms · 12px upward drift + fade" and "question to question:
  // 320ms crossfade, outgoing question leaves first". mode="wait" is what makes
  // the outgoing question leave first rather than the two crossing over.
  // Under prefers-reduced-motion it becomes an instant swap.
  const slide = reduceMotion
    ? { initial: false, animate: {}, exit: {}, transition: { duration: 0 } }
    : {
        initial: { opacity: 0, x: direction * 20 },
        animate: { opacity: 1, x: 0 },
        exit: { opacity: 0, x: direction * -20 },
        transition: { duration: 0.32, ease: [0.22, 0.61, 0.36, 1] as const },
      };

  async function choose(value: number) {
    const next = [...answers];
    next[index] = value;
    setAnswers(next);
    // Saved the moment it is tapped, which is what lets the screen say so and
    // what makes leaving mid-way genuinely free.
    setSavedHere(await saveDraft(next, index));
  }

  function goBack() {
    setDirection(-1);
    const to = Math.max(0, index - 1);
    setIndex(to);
    setSavedHere(answers[to] !== null);
  }

  function goNext() {
    setDirection(1);
    const to = Math.min(total - 1, index + 1);
    setIndex(to);
    setSavedHere(answers[to] !== null);
    void saveDraft(answers, to);
  }

  async function submit() {
    const parsed = responsesSchema.safeParse(answers);
    if (!parsed.success) return;

    setPending(true);
    setFailed(false);

    // The number the journal produced on this device, if there is one. Read
    // and cleared here, so a contribution belongs to exactly one check-in.
    // Null is normal: no journal entry, or a device that cannot run the model.
    const nlpContribution = await takeContribution();

    const submission = {
      responses: parsed.data,
      language: locale as "en" | "hi",
      nlpContribution,
      // Generated once, here, and reused by every retry of THIS submission.
      // Generating it per attempt would defeat the whole point.
      clientId: crypto.randomUUID(),
    };

    async function queueIt() {
      await enqueue(submission);
      // Only after the answers are somewhere durable. Clearing first would put
      // a failed enqueue between the draft and the outbox, with the answers in
      // neither.
      await clearDraft();
      router.replace("/check-in/done?queued=1");
      router.refresh();
    }

    // Offline: do not attempt and do not fail. Queue it and thank them.
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      await queueIt();
      setPending(false);
      return;
    }

    try {
      const res = await fetch("/api/assessment", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(submission),
      });

      if (res.ok) {
        await clearDraft();
        router.replace("/check-in/done");
        router.refresh();
        return;
      }

      // A 4xx that is not a timeout or a rate limit will never succeed on
      // replay — queueing it would hide a real problem behind silence.
      const permanent =
        res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429;
      if (permanent) {
        setFailed(true);
        return;
      }
      await queueIt();
    } catch {
      // The network went away mid-flight. The answers are not lost; they are
      // in the outbox, and the person is told nothing alarming.
      await queueIt();
    } finally {
      setPending(false);
    }
  }

  return (
    <main data-testid="check-in-root" className="mx-auto flex min-h-dvh w-full max-w-md flex-col">
      {/* Progress, a way back, and a count. No app name and no title bar: the
          question is the only thing on this screen that should be read. */}
      <div className="flex items-center gap-3 px-6 pt-4">
        {index > 0 ? (
          <button
            type="button"
            onClick={goBack}
            aria-label={labels.back}
            className="text-ink-2 -ml-4 flex size-14 shrink-0 items-center justify-center text-[22px]"
          >
            <span aria-hidden>←</span>
          </button>
        ) : (
          <span aria-hidden className="-ml-4 size-14 shrink-0" />
        )}

        <p id="check-in-progress" className="sr-only">
          {labels.progress[index]}
        </p>
        <div
          className="bg-line h-[5px] w-full overflow-hidden rounded-full"
          role="progressbar"
          // A progressbar without a name is announced as an unlabelled value.
          // Reuse the "Question 3 of 10" text rather than inventing a second
          // string a translator would have to keep in sync.
          aria-labelledby="check-in-progress"
          aria-valuenow={index + 1}
          aria-valuemin={1}
          aria-valuemax={total}
        >
          <motion.div
            className="bg-ember h-full rounded-full"
            initial={false}
            animate={{ width: `${((index + 1) / total) * 100}%` }}
            // "Progress bar fills over 500ms ease-out."
            transition={reduceMotion ? { duration: 0 } : { duration: 0.5, ease: "easeOut" }}
          />
        </div>

        <span aria-hidden className="meta text-ink-3 shrink-0 tabular-nums">
          {index + 1}/{total}
        </span>
      </div>

      <div className="px-6 pt-12">
        <p className="meta text-ink-3">{labels.eyebrow}</p>

        <AnimatePresence mode="wait" initial={false}>
          <motion.div key={index} {...slide}>
            <h1 className="mt-4 text-[clamp(1.625rem,7.5vw,2.125rem)] leading-[1.12] font-bold">
              {questions[index]}
            </h1>

            <fieldset className="mt-9 flex flex-col gap-2.5">
              <legend className="sr-only">{questions[index]}</legend>
              {SCALE_VALUES.map((value) => {
                const selected = answers[index] === value;
                return (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => void choose(value)}
                    // min-h-14: a comfortable target for a gloved thumb.
                    // "Selection: 180ms ease-out fill, no bounce."
                    className={`flex min-h-14 items-center gap-3.5 rounded-lg border-[1.5px] px-5 text-left text-[17px] transition-colors duration-200 ease-out ${
                      selected
                        ? "border-ember bg-ember-soft text-ember-ink font-semibold"
                        : "border-line"
                    }`}
                  >
                    <span
                      aria-hidden
                      className={`size-3.5 shrink-0 rounded-full ${
                        selected ? "bg-ember" : "border-ink-3 border-[1.5px]"
                      }`}
                    />
                    {labels.scale[value]}
                  </button>
                );
              })}
            </fieldset>
          </motion.div>
        </AnimatePresence>

        {/* Shown only once the write to this phone came back true. */}
        {savedHere && (
          <p className="meta text-ink-3 mt-5 flex items-center gap-2">
            <span aria-hidden className="bg-ember size-[7px] rounded-full" />
            {labels.savedOnPhone}
          </p>
        )}
      </div>

      <div className="mt-auto px-6 pt-8 pb-8">
        {failed && (
          <p role="alert" className="text-destructive mb-4 text-[15px]">
            {labels.error}
          </p>
        )}

        {answered ? (
          <button
            type="button"
            disabled={pending}
            onClick={isLast ? submit : goNext}
            className="bg-ember text-on-ember min-h-14 w-full rounded-lg text-[17px] font-semibold disabled:opacity-50"
          >
            {isLast ? (pending ? labels.submitting : labels.submit) : labels.next}
          </button>
        ) : (
          // "Exit is always available and never questioned." No confirmation
          // dialog, no "are you sure", no warning that progress will be lost —
          // because it will not be.
          <Link
            href="/home"
            className="text-ink-2 flex min-h-14 items-center justify-center text-center text-base"
          >
            {labels.leaveForNow}
          </Link>
        )}
      </div>
    </main>
  );
}
