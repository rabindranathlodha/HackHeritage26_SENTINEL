"use client";

import { motion, useReducedMotion } from "motion/react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import type { Locale } from "@/i18n/locale";
import { keepEntry, stashContribution } from "@/lib/journal";
import { capability, scoreText } from "@/lib/onnx";
import { VoiceRecorder } from "@/components/VoiceRecorder";

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
  const [canScore, setCanScore] = useState<boolean | null>(null);

  useEffect(() => {
    // A capability check, not a load. Whether WebAssembly exists is known
    // immediately; whether the model downloads is not asked until there is
    // something to score. Opening the journal must not cost ~190 MB.
    setCanScore(capability().available);
  }, []);

  async function save() {
    const words = text.trim();
    if (!words) return;

    setBusy(true);
    try {
      // On this device. Null when the model is missing or the device cannot run
      // it — the check-in proceeds without a contribution, and the words still
      // never leave.
      const contribution = await scoreText(words);
      if (contribution !== null) await stashContribution(contribution);

      // Their words, kept only if they said so.
      if (keep) await keepEntry(words);

      setText("");
      setSaved(true);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
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
        className="border-border bg-card focus-visible:ring-ring/50 min-h-48 rounded-2xl border p-4 text-base leading-relaxed outline-none focus-visible:ring-3"
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

      <label className="flex items-start gap-3 text-sm">
        <input
          type="checkbox"
          checked={keep}
          onChange={(event) => setKeep(event.target.checked)}
          className="mt-1 size-5 shrink-0"
        />
        <span>
          {t("keepOnPhone")}
          <span className="text-muted-foreground block text-xs">{t("keepHint")}</span>
        </span>
      </label>

      {canScore === false && (
        <p className="text-muted-foreground text-sm">{t("unavailable")}</p>
      )}

      <button
        type="button"
        onClick={save}
        disabled={busy || text.trim().length === 0}
        className="bg-primary text-primary-foreground min-h-14 rounded-xl text-base font-medium disabled:opacity-50"
      >
        {busy ? t("processing") : t("save")}
      </button>

      {saved && (
        <motion.p
          role="status"
          aria-live="polite"
          initial={reduceMotion ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          className="text-muted-foreground text-sm"
        >
          {t("saved")}
        </motion.p>
      )}
    </div>
  );
}
