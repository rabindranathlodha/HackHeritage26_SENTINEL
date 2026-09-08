// Voice transcription, on the device (PWA spec 3.7).
//
// THE IMPORTANT PART: the Web Speech API sends audio to a remote service by
// default. Chrome streams it to Google. Using it as it comes out of the box
// would mean a person's voice leaving their phone from the one screen that
// promises it never will — a direct breach of principle 2, and one nothing in
// the app would reveal.
//
// So this module only ever uses the on-device path:
//
//   * `processLocally = true` is set on every recogniser, without exception.
//   * Availability is checked with `SpeechRecognition.available({ processLocally: true })`
//     before anything starts.
//   * If on-device recognition is not available, voice is simply not offered.
//     There is no fallback to server-side recognition, because the fallback IS
//     the thing being avoided. The person types instead.
//
// There is also no MediaRecorder here, deliberately. The spec's stack table
// names it, but the recogniser captures the microphone itself, so recording a
// second copy of the audio into a Blob would create an artifact that has to be
// kept from leaving — instead of never existing. Not holding the audio is a
// stronger guarantee than holding it carefully.

import type { Locale } from "@/i18n/locale";

// Chrome's on-device speech API is recent enough that TypeScript's DOM library
// does not describe it yet.
type SpeechAvailability = "unavailable" | "downloadable" | "downloading" | "available";

type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  processLocally?: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
};

type SpeechRecognitionEventLike = {
  resultIndex: number;
  results: ArrayLike<
    ArrayLike<{ transcript: string }> & { isFinal: boolean }
  >;
};

type SpeechRecognitionConstructor = {
  new (): SpeechRecognitionLike;
  available?(options: {
    langs: string[];
    processLocally: boolean;
  }): Promise<SpeechAvailability>;
  install?(options: { langs: string[]; processLocally: boolean }): Promise<boolean>;
};

const BCP47: Record<Locale, string> = {
  en: "en-US",
  hi: "hi-IN",
};

function constructor(): SpeechRecognitionConstructor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export type VoiceSupport =
  /** On-device recognition is ready to use. */
  | { state: "ready" }
  /** Supported, but the language pack has to be downloaded first. */
  | { state: "downloadable" }
  | { state: "downloading" }
  /** No on-device recognition here. Voice is not offered; typing still works. */
  | { state: "unsupported" };

export async function voiceSupport(locale: Locale): Promise<VoiceSupport> {
  const SR = constructor();
  // No API, or an old implementation with no on-device mode at all. Either way
  // this device does not get voice — it does not get cloud recognition instead.
  if (!SR?.available) return { state: "unsupported" };

  try {
    const availability = await SR.available({
      langs: [BCP47[locale]],
      processLocally: true,
    });
    if (availability === "available") return { state: "ready" };
    if (availability === "downloadable") return { state: "downloadable" };
    if (availability === "downloading") return { state: "downloading" };
    return { state: "unsupported" };
  } catch {
    return { state: "unsupported" };
  }
}

/**
 * Downloads the on-device language pack.
 *
 * Deliberately a separate, person-initiated step: it is a large download, and
 * starting it because someone opened a screen would be the same mistake as
 * fetching the NLP model on page load.
 */
export async function installVoice(locale: Locale): Promise<boolean> {
  const SR = constructor();
  if (!SR?.install) return false;
  try {
    return await SR.install({ langs: [BCP47[locale]], processLocally: true });
  } catch {
    return false;
  }
}

export type Transcriber = {
  stop(): void;
};

/**
 * Starts on-device transcription.
 *
 * `onText` receives the transcript so far. It stays in the page; nothing here
 * writes it anywhere or sends it.
 */
export function transcribe(
  locale: Locale,
  handlers: {
    onText: (text: string, isFinal: boolean) => void;
    onError: (reason: string) => void;
    onEnd: () => void;
  },
): Transcriber | null {
  const SR = constructor();
  if (!SR) return null;

  const recognition = new SR();
  recognition.lang = BCP47[locale];
  recognition.continuous = true;
  recognition.interimResults = true;

  // The line this whole module exists for. If the browser cannot honour it,
  // recognition fails and voice is unavailable — which is the correct outcome,
  // not a reason to relax it.
  recognition.processLocally = true;

  let finalText = "";

  recognition.onresult = (event) => {
    let interim = "";
    for (let i = event.resultIndex; i < event.results.length; i += 1) {
      const result = event.results[i];
      const text = result[0]?.transcript ?? "";
      if (result.isFinal) finalText += text;
      else interim += text;
    }
    handlers.onText((finalText + interim).trim(), interim === "");
  };

  recognition.onerror = (event) => handlers.onError(event.error);
  recognition.onend = () => handlers.onEnd();

  try {
    recognition.start();
  } catch {
    return null;
  }

  return {
    stop: () => {
      try {
        recognition.stop();
      } catch {
        recognition.abort();
      }
    },
  };
}
