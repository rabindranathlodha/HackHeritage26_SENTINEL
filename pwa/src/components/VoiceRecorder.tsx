"use client";

import { motion, useReducedMotion } from "motion/react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";

import type { Locale } from "@/i18n/locale";
import {
  installVoice,
  transcribe,
  voiceSupport,
  type Transcriber,
  type VoiceSupport,
} from "@/lib/speech";

// Speaking instead of typing (PWA spec 4.4).
//
// The transcript is appended to the journal box the person can see and edit. It
// takes the same path as anything typed: scored on the device, and only the
// number leaves. There is no separate handling for voice, and no audio is
// retained anywhere — see lib/speech.ts for why there is no MediaRecorder.
export function VoiceRecorder({
  locale,
  onTranscript,
}: {
  locale: Locale;
  onTranscript: (text: string) => void;
}) {
  const t = useTranslations("journal");
  const reduceMotion = useReducedMotion();

  const [support, setSupport] = useState<VoiceSupport | null>(null);
  const [listening, setListening] = useState(false);
  const [failed, setFailed] = useState(false);
  const [installing, setInstalling] = useState(false);
  const session = useRef<Transcriber | null>(null);

  useEffect(() => {
    void voiceSupport(locale).then(setSupport);
    return () => session.current?.stop();
  }, [locale]);

  const start = useCallback(() => {
    setFailed(false);
    const active = transcribe(locale, {
      onText: (text) => onTranscript(text),
      onError: () => {
        setFailed(true);
        setListening(false);
      },
      onEnd: () => setListening(false),
    });
    if (!active) {
      setFailed(true);
      return;
    }
    session.current = active;
    setListening(true);
  }, [locale, onTranscript]);

  const stop = useCallback(() => {
    session.current?.stop();
    session.current = null;
    setListening(false);
  }, []);

  async function download() {
    setInstalling(true);
    try {
      await installVoice(locale);
      setSupport(await voiceSupport(locale));
    } finally {
      setInstalling(false);
    }
  }

  // Nothing rendered until the check has run, so the button never appears and
  // then vanishes.
  if (support === null) return null;

  if (support.state === "unsupported") {
    return <p className="text-muted-foreground text-sm">{t("voiceUnsupported")}</p>;
  }

  if (support.state === "downloadable" || support.state === "downloading") {
    return (
      <button
        type="button"
        onClick={download}
        disabled={installing || support.state === "downloading"}
        className="border-border min-h-14 rounded-xl border text-base font-medium disabled:opacity-60"
      >
        {installing || support.state === "downloading"
          ? t("voiceDownloading")
          : t("voiceDownload")}
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <button
        type="button"
        data-testid="voice-toggle"
        aria-pressed={listening}
        onClick={listening ? stop : start}
        className={
          "flex min-h-14 items-center justify-center gap-3 rounded-xl border text-base font-medium " +
          (listening ? "border-primary text-primary" : "border-border")
        }
      >
        {listening && (
          <motion.span
            aria-hidden
            className="bg-primary size-2.5 rounded-full"
            animate={reduceMotion ? {} : { opacity: [1, 0.3, 1] }}
            transition={reduceMotion ? { duration: 0 } : { duration: 1.6, repeat: Infinity }}
          />
        )}
        {listening ? t("listening") : t("record")}
      </button>

      {/* Stated where the microphone is, not only on the transparency screen. */}
      <p className="text-muted-foreground text-xs">{t("voiceOnDevice")}</p>

      {failed && (
        <p role="alert" className="text-muted-foreground text-sm">
          {t("voiceError")}
        </p>
      )}
    </div>
  );
}
