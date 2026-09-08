"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { SCALE_MAX, SCALE_MIN } from "@/content/questionnaire";
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
  next: string;
  back: string;
  submit: string;
  submitting: string;
  error: string;
  retry: string;
};

type Props = {
  questions: string[];
  labels: Labels;
  locale: string;
};

const SCALE_VALUES = Array.from(
  { length: SCALE_MAX - SCALE_MIN + 1 },
  (_, i) => SCALE_MIN + i,
);

export function CheckInFlow({ questions, labels, locale }: Props) {
  const router = useRouter();
  const reduceMotion = useReducedMotion();

  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<(number | null)[]>(
    () => Array(questions.length).fill(null),
  );
  const [direction, setDirection] = useState<1 | -1>(1);
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);

  const total = questions.length;
  const isLast = index === total - 1;
  const answered = answers[index] !== null;

  // Motion is here to make one-question-at-a-time feel like a single continuous
  // surface rather than a page reload. Under prefers-reduced-motion it becomes
  // an instant swap — no fade, no slide, no duration.
  const slide = reduceMotion
    ? { initial: false, animate: {}, exit: {}, transition: { duration: 0 } }
    : {
        initial: { opacity: 0, x: direction * 24 },
        animate: { opacity: 1, x: 0 },
        exit: { opacity: 0, x: direction * -24 },
        transition: { duration: 0.22, ease: [0.22, 1, 0.36, 1] as const },
      };

  function choose(value: number) {
    setAnswers((current) => {
      const next = [...current];
      next[index] = value;
      return next;
    });
  }

  function goBack() {
    setDirection(-1);
    setIndex((i) => Math.max(0, i - 1));
  }

  function goNext() {
    setDirection(1);
    setIndex((i) => Math.min(total - 1, i + 1));
  }

  async function submit() {
    const parsed = responsesSchema.safeParse(answers);
    if (!parsed.success) return;

    setPending(true);
    setFailed(false);

    const submission = {
      responses: parsed.data,
      language: locale as "en" | "hi",
      // Stubbed at this step. 3.6 replaces it with on-device inference; the
      // contract already carries the field so nothing changes but the value.
      nlpContribution: null,
      // Generated once, here, and reused by every retry of THIS submission.
      // Generating it per attempt would defeat the whole point.
      clientId: crypto.randomUUID(),
    };

    async function queueIt() {
      await enqueue(submission);
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
    <main className="flex min-h-dvh flex-col">
      {/* Progress sits at the top; the question and the answers sit within
          thumb reach at the bottom of a 360px phone held one-handed. */}
      <div className="px-6 pt-10">
        <p id="check-in-progress" className="text-muted-foreground text-sm tabular-nums">
          {labels.progress[index]}
        </p>
        <div
          className="bg-border mt-3 h-1.5 w-full overflow-hidden rounded-full"
          role="progressbar"
          // A progressbar without a name is announced as an unlabelled value.
          // Reuse the visible "Question 3 of 9" text rather than inventing a
          // second string a translator would have to keep in sync.
          aria-labelledby="check-in-progress"
          aria-valuenow={index + 1}
          aria-valuemin={1}
          aria-valuemax={total}
        >
          <motion.div
            className="bg-primary h-full rounded-full"
            initial={false}
            animate={{ width: `${((index + 1) / total) * 100}%` }}
            transition={reduceMotion ? { duration: 0 } : { duration: 0.3 }}
          />
        </div>
      </div>

      <div className="flex flex-1 flex-col justify-end px-6 pb-10">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div key={index} {...slide} className="flex flex-col gap-8">
            <h1 className="text-2xl font-medium leading-snug tracking-tight text-balance">
              {questions[index]}
            </h1>

            <fieldset className="flex flex-col gap-3">
              <legend className="sr-only">{questions[index]}</legend>
              {SCALE_VALUES.map((value) => {
                const selected = answers[index] === value;
                return (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => choose(value)}
                    // min-h-14: a comfortable target for a gloved thumb.
                    className={
                      "min-h-14 rounded-2xl border px-5 text-left text-base transition-colors " +
                      (selected
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border bg-card")
                    }
                  >
                    {labels.scale[value]}
                  </button>
                );
              })}
            </fieldset>
          </motion.div>
        </AnimatePresence>

        {failed && (
          <p role="alert" className="text-destructive mt-6 text-sm">
            {labels.error}
          </p>
        )}

        <div className="mt-8 flex gap-3">
          {index > 0 && (
            <button
              type="button"
              onClick={goBack}
              className="border-border min-h-14 flex-1 rounded-xl border text-base font-medium"
            >
              {labels.back}
            </button>
          )}
          <button
            type="button"
            disabled={!answered || pending}
            onClick={isLast ? submit : goNext}
            className="bg-primary text-primary-foreground min-h-14 flex-[2] rounded-xl text-base font-medium disabled:opacity-50"
          >
            {isLast ? (pending ? labels.submitting : labels.submit) : labels.next}
          </button>
        </div>
      </div>
    </main>
  );
}
