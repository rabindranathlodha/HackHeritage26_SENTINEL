import { WordPieceTokenizer } from "@/lib/tokenizer";

// On-device NLP (PWA spec 5), the principle this app is built around.
//
// The person's words are tokenised and scored HERE, on their phone. What leaves
// the device is one number between 0 and 1. There is no code path in this file,
// or reachable from it, that transmits the text — the caller receives a number
// and nothing else, so there is nothing for a later mistake to leak.
//
// Everything degrades rather than blocks (spec 5): an old device without
// WebAssembly, a model that failed to download, an inference that threw — all
// produce `null`, the check-in proceeds, and the text still never leaves. The
// one thing this must never do is fall back to sending the words to a server.

const MODEL_URL = "/models/model_b_quant.onnx";
const TOKENIZER_URL = "/models/tokenizer.json";
const MAX_LENGTH = 160;

export type NlpAvailability =
  | { available: true }
  | { available: false; reason: "unsupported" | "unavailable" };

type Session = {
  run(feeds: Record<string, unknown>): Promise<Record<string, { data: Float32Array }>>;
};

let loading: Promise<{ session: Session; tokenizer: WordPieceTokenizer } | null> | null =
  null;

function webAssemblySupported(): boolean {
  return typeof WebAssembly === "object" && typeof WebAssembly.instantiate === "function";
}

async function load() {
  if (!webAssemblySupported()) return null;

  // Imported here rather than at module scope so onnxruntime-web is fetched the
  // first time someone opens the journal, not on every cold start of the app.
  const ort = await import("onnxruntime-web");

  // The runtime's .wasm files are copied into public/ort by `npm run ort:assets`
  // and served from this origin. Left unset, the runtime reaches for a CDN —
  // which would be a request to a third party from a screen whose whole promise
  // is that nothing leaves the phone.
  ort.env.wasm.wasmPaths = "/ort/";
  ort.env.wasm.numThreads = 1;

  const [session, tokenizerJson] = await Promise.all([
    ort.InferenceSession.create(MODEL_URL, {
      executionProviders: ["wasm"],
      graphOptimizationLevel: "all",
    }),
    fetch(TOKENIZER_URL).then((res) => {
      if (!res.ok) throw new Error(`tokenizer ${res.status}`);
      return res.json();
    }),
  ]);

  return {
    session: session as unknown as Session,
    tokenizer: WordPieceTokenizer.fromJSON(tokenizerJson),
  };
}

/** Loads once and remembers the outcome, including failure. */
function ensureLoaded() {
  loading ??= load().catch((error) => {
    console.warn("on-device scoring is unavailable; check-ins are unaffected", error);
    return null;
  });
  return loading;
}

/**
 * Whether this device could run the model — WITHOUT downloading it.
 *
 * The first version of this called ensureLoaded(), so merely opening the
 * journal fetched ~190 MB. That cost the page a Lighthouse Performance score of
 * 61 and, far worse, spent a person's data allowance on a screen they might
 * only have opened to read. The model is fetched when there is something to
 * score, and not before.
 */
export function capability(): NlpAvailability {
  return webAssemblySupported()
    ? { available: true }
    : { available: false, reason: "unsupported" };
}

/** Whether the model is actually loadable. Downloads it; call it deliberately. */
export async function availability(): Promise<NlpAvailability> {
  if (!webAssemblySupported()) return { available: false, reason: "unsupported" };
  const loaded = await ensureLoaded();
  return loaded ? { available: true } : { available: false, reason: "unavailable" };
}

/**
 * Scores text on this device.
 *
 * Returns a probability in 0-1, or null when scoring is not possible. Null is a
 * normal outcome, not an error: the assessment contract carries
 * `nlpContribution: null` and the fusion layer renormalises over the signals it
 * actually has.
 */
export async function scoreText(text: string): Promise<number | null> {
  const trimmed = text.trim();
  if (!trimmed) return null;

  const loaded = await ensureLoaded();
  if (!loaded) return null;

  try {
    const ort = await import("onnxruntime-web");
    const { inputIds, attentionMask } = loaded.tokenizer.encode(trimmed, MAX_LENGTH);

    // int64, because that is what the exported graph declares. Passing int32
    // fails at run time rather than silently, but only on the first attempt of
    // a person's first journal entry — so it is pinned here.
    const dims = [1, MAX_LENGTH];
    const feeds = {
      input_ids: new ort.Tensor("int64", BigInt64Array.from(inputIds, BigInt), dims),
      attention_mask: new ort.Tensor(
        "int64",
        BigInt64Array.from(attentionMask, BigInt),
        dims,
      ),
    };

    const output = await loaded.session.run(feeds);
    const logits = Object.values(output)[0]?.data;
    if (!logits || logits.length < 2) return null;

    // Softmax over the two classes; index 1 is the distress signal, matching
    // the label order recorded in model_b_meta.json.
    const [a, b] = [Number(logits[0]), Number(logits[1])];
    const max = Math.max(a, b);
    const expA = Math.exp(a - max);
    const expB = Math.exp(b - max);
    const probability = expB / (expA + expB);

    return Number.isFinite(probability) ? probability : null;
  } catch (error) {
    // An inference failure must never become a reason to send the text.
    console.warn("on-device scoring failed; sending no contribution", error);
    return null;
  }
}
