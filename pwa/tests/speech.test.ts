// The on-device guarantee for voice, tested deterministically.
//
// The browser test cannot cover this: whether a recogniser starts at all
// depends on a language pack being installed on the machine running it, so the
// assertion that matters would pass or fail for reasons unrelated to the code.
// Here the API is faked, so what is being tested is this module's behaviour and
// nothing else.
//
// What must hold, on every device and in every branch:
//   * a recogniser is never started without processLocally = true
//   * voice is not offered when on-device recognition is unavailable
//   * there is no fallback to server-side recognition, ever

import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

type FakeInstance = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  processLocally?: boolean;
  startedWith?: { processLocally?: boolean; lang: string };
  start(): void;
  stop(): void;
  abort(): void;
  onresult: unknown;
  onerror: unknown;
  onend: unknown;
};

const created: FakeInstance[] = [];

function installFakeApi(options: {
  availability?: string;
  omitAvailable?: boolean;
  omitApi?: boolean;
}) {
  created.length = 0;

  function Fake(this: FakeInstance) {
    const instance: FakeInstance = {
      lang: "",
      continuous: false,
      interimResults: false,
      processLocally: undefined,
      start() {
        // Captured at start(), because that is the moment the configuration
        // takes effect — setting it afterwards would be too late.
        instance.startedWith = {
          processLocally: instance.processLocally,
          lang: instance.lang,
        };
      },
      stop() {},
      abort() {},
      onresult: null,
      onerror: null,
      onend: null,
    };
    created.push(instance);
    return instance;
  }

  const api = Fake as unknown as Record<string, unknown>;
  if (!options.omitAvailable) {
    api.available = async () => options.availability ?? "available";
  }

  (globalThis as unknown as { window: unknown }).window = options.omitApi
    ? {}
    : { SpeechRecognition: api };
}

afterEach(() => {
  delete (globalThis as unknown as { window?: unknown }).window;
});

async function speech() {
  // Imported fresh each time so it reads the window that was just installed.
  return import(`../src/lib/speech.ts?${Math.random()}`);
}

test("a recogniser is never started without on-device processing", async () => {
  installFakeApi({});
  const { transcribe } = await speech();

  const session = transcribe("en", { onText() {}, onError() {}, onEnd() {} });
  assert.ok(session, "expected a session");
  assert.equal(created.length, 1);
  assert.equal(
    created[0].startedWith?.processLocally,
    true,
    "the recogniser was started without processLocally — audio would go to a server",
  );
});

test("the language is passed through as a BCP-47 tag", async () => {
  installFakeApi({});
  const { transcribe } = await speech();

  transcribe("hi", { onText() {}, onError() {}, onEnd() {} });
  assert.equal(created[0].startedWith?.lang, "hi-IN");
});

test("voice is not offered when on-device recognition is unavailable", async () => {
  installFakeApi({ availability: "unavailable" });
  const { voiceSupport } = await speech();
  assert.deepEqual(await voiceSupport("en"), { state: "unsupported" });
});

test("a browser with no on-device mode at all is treated as unsupported", async () => {
  // An older Web Speech implementation: the API exists, but `available` does
  // not, so there is no way to ask for local processing. This must NOT fall
  // through to using it anyway.
  installFakeApi({ omitAvailable: true });
  const { voiceSupport } = await speech();
  assert.deepEqual(await voiceSupport("en"), { state: "unsupported" });
});

test("a browser with no speech API is treated as unsupported", async () => {
  installFakeApi({ omitApi: true });
  const { voiceSupport } = await speech();
  assert.deepEqual(await voiceSupport("en"), { state: "unsupported" });
});

test("a downloadable language pack is reported, not silently used", async () => {
  installFakeApi({ availability: "downloadable" });
  const { voiceSupport } = await speech();
  assert.deepEqual(await voiceSupport("en"), { state: "downloadable" });
});

test("availability is asked for with processLocally set", async () => {
  let asked: { langs: string[]; processLocally: boolean } | null = null;
  installFakeApi({});
  const api = (globalThis as unknown as { window: { SpeechRecognition: Record<string, unknown> } })
    .window.SpeechRecognition;
  api.available = async (options: { langs: string[]; processLocally: boolean }) => {
    asked = options;
    return "available";
  };

  const { voiceSupport } = await speech();
  await voiceSupport("en");
  assert.deepEqual(asked, { langs: ["en-US"], processLocally: true });
});

test("the test would catch a regression to remote processing", async () => {
  // A guard that cannot fail is not a guard: prove the assertion detects the
  // exact mistake it exists for.
  installFakeApi({});
  const { transcribe } = await speech();
  transcribe("en", { onText() {}, onError() {}, onEnd() {} });

  created[0].processLocally = false;
  created[0].start();
  assert.equal(created[0].startedWith?.processLocally, false);
});
