"use client";

import { motion, useReducedMotion } from "motion/react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { VoiceRecorder } from "@/components/VoiceRecorder";
import type { Locale } from "@/i18n/locale";
import { entries as keptEntries, keepEntry, stashContribution } from "@/lib/journal";
import { capability, scoreText } from "@/lib/onnx";

// The journal (PWA spec 4.4).
//
// The whole design is one promise: what you type here is read on this phone and
// stays on this phone. The only thing that leaves is a number, and only when
// you next check in.
//
// There is no code path from this component to a request carrying `text`. The
// submit handler passes the words to scoreText(), which returns a number, and
// the number is what gets stored. A test inspects every outgoing payload to
// keep it that way.
export function JournalEditor({ locale }: { locale: Locale }) {
  const t = useTranslations("journal");
  const router = useRouter();
  const reduceMotion = useReducedMotion();

  const [text, setText] = useState("");
  const [keep, setKeep] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [failed, setFailed] = useState(false);
  const [canScore, setCanScore] = useState<boolean | null>(null);
  const [kept, setKept] = useState<{ id: string; writtenAt: number; text: string }[]>([]);

  // What the person chose to keep. Until now an entry could be kept and never
  // shown again, which made the checkbox a promise with nowhere to land.
  const refreshKept = useCallback(async () => {
    setKept(await keptEntries());
  }, []);

  useEffect(() => {
    // A capability check, not a load. Whether WebAssembly exists is known
    // immediately; whether the model downloads is not asked until there is
    // something to score. Opening the journal must not cost ~190 MB.
    setCanScore(capability().available);
    void refreshKept();
  }, [refreshKept]);

  async function save() {
    const words = text.trim();
    if (!words) return;

    setBusy(true);
    setFailed(false);
    try {
      // On this device. Null when the model is missing or the device cannot run
      // it — the check-in proceeds without a contribution, and the words still
      // never leave.
      const contribution = await scoreText(words);
      if (contribution !== null) await stashContribution(contribution);

      // Their words, kept only if they said so.
      if (keep) {
        await keepEntry(words);
        await refreshKept();
      }

      setText("");
      setSaved(true);
      router.refresh();
    } catch {
      // The design's rule for this state: "Your words are still here on the
      // screen — nothing is lost." So the textarea is deliberately NOT cleared
      // on this path. A person whose phone ran out of storage should not also
      // lose what they just wrote.
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      {failed && (
        <div role="alert" className="bg-sunk flex flex-col gap-3 rounded-2xl p-5">
          <h2 className="text-[22px] leading-tight font-semibold">{t("errorTitle")}</h2>
          <p className="text-ink-2 text-base leading-relaxed">{t("errorBody")}</p>
          <button
            type="button"
            onClick={save}
            disabled={busy}
            className="bg-ember text-on-ember min-h-14 rounded-md text-base font-semibold disabled:opacity-50"
          >
            {t("save")}
          </button>
        </div>
      )}

      <label htmlFor="journal" className="sr-only">
        {t("title")}
      </label>
      <textarea
        id="journal"
        value={text}
        onChange={(event) => {
          setText(event.target.value);
          setSaved(false);
        }}
        rows={8}
        className="border-line bg-surface focus-visible:ring-ring/50 min-h-48 rounded-xl border-[1.5px] p-[18px] text-[17px] leading-relaxed outline-none focus-visible:ring-3"
      />

      {/* Speech goes into the same box, so the person can read and correct it
          before anything is scored. It is not a separate, hidden pathway. */}
      <VoiceRecorder
        locale={locale}
        onTranscript={(spoken) => {
          setText(spoken);
          setSaved(false);
        }}
      />

      <label className="flex items-start gap-3 text-[15px]">
        <input
          type="checkbox"
          checked={keep}
          onChange={(event) => setKeep(event.target.checked)}
          className="accent-ember mt-1 size-5 shrink-0"
        />
        <span>
          {t("keepOnPhone")}
          <span className="text-ink-2 mt-0.5 block text-[13px] leading-snug">
            {t("keepHint")}
          </span>
        </span>
      </label>

      {canScore === false && (
        <p className="text-ink-2 text-[15px] leading-relaxed">{t("unavailable")}</p>
      )}

      <button
        type="button"
        onClick={save}
        disabled={busy || text.trim().length === 0}
        className="bg-ember text-on-ember min-h-14 rounded-lg text-[17px] font-semibold disabled:opacity-50"
      >
        {busy ? t("processing") : t("save")}
      </button>

      {saved && (
        <motion.p
          role="status"
          aria-live="polite"
          initial={reduceMotion ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          className="meta text-ember-ink flex items-center gap-2"
        >
          <span aria-hidden className="bg-ember size-[7px] rounded-full" />
          {t("saved")}
        </motion.p>
      )}

      <section className="border-line mt-1 flex flex-col gap-3 border-t pt-6">
        <h2 className="meta text-ink-3">{t("historyHeading")}</h2>

        {kept.length === 0 ? (
          // The design writes the empty state as reassurance, not as an
          // absence: "Nothing here yet — and that's fine." Someone who has
          // never written should not be made to feel behind.
          <div className="flex flex-col gap-3 py-2">
            <p className="text-ink-2 text-[22px] leading-tight font-semibold">
              {t("emptyTitle")}
            </p>
            <p className="text-ink-3 text-[15px] leading-relaxed">{t("emptyBody")}</p>
          </div>
        ) : (
          <ul className="flex flex-col gap-3">
            {kept.map((entry) => (
              <li
                key={entry.id}
                className="border-line bg-surface rounded-2xl border p-5"
              >
                <time
                  className="meta text-ink-3 block"
                  dateTime={new Date(entry.writtenAt).toISOString()}
                >
                  {new Date(entry.writtenAt).toLocaleDateString(locale, {
                    weekday: "long",
                    day: "numeric",
                    month: "short",
                  })}
                </time>
                <p className="mt-2.5 text-[17px] leading-relaxed whitespace-pre-wrap">
                  {entry.text}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
