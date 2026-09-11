// Acceptance test for step 3.7.
//
// "Record voice → transcribed locally → same on-device NLP path → raw
//  audio/text never transmitted."
//
// The risk this guards is specific and easy to miss. The Web Speech API sends
// audio to a remote service by default; Chrome streams it to Google. An app can
// use it, work perfectly, and quietly break its central promise. So the test
// does not check that voice "works" — it checks that every recogniser the app
// creates is configured for on-device processing, and that nothing carrying
// audio or the transcript leaves the page.
//
// Chrome is launched with a fake microphone. Real speech cannot be produced, so
// what is asserted is configuration and transmission, not recognition accuracy;
// the recognition itself is the browser's, not ours.
//
// Usage: node scripts/verify-voice.mjs --login <id> --password <pw>

import { parseArgs } from "node:util";

import { launch } from "chrome-launcher";

import { CDP, killChrome, reporter, settled, gate } from "./cdp.mjs";

const { values } = parseArgs({
  options: {
    login: { type: "string", default: process.env.TEST_LOGIN_ID },
    password: { type: "string", default: process.env.TEST_PASSWORD },
    url: { type: "string", default: "http://localhost:3100" },
  },
});

if (!values.login || !values.password) {
  console.error("need --login and --password");
  process.exit(1);
}

const SPOKEN = "qxv the nights are long and I keep waking bpz";

const base = values.url.replace(/\/$/, "");
const { record, finish } = reporter();

// A fake capture device, and the permission prompt auto-accepted, so the page
// can reach the microphone path at all in a headless run.
const chrome = await launch({
  chromeFlags: [
    "--headless=new",
    "--no-sandbox",
    "--disable-gpu",
    "--use-fake-device-for-media-stream",
    "--use-fake-ui-for-media-stream",
  ],
});

async function waitFor(cdp, expression, what, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await cdp.evaluate(`return Boolean(await (${expression}));`)) return true;
    await new Promise((r) => setTimeout(r, 200));
  }
  console.error(`  (timed out waiting for ${what})`);
  return false;
}

async function waitForHydration(cdp, selector) {
  return waitFor(
    cdp,
    `(() => { const el = document.querySelector(${JSON.stringify(selector)});
              return el && Object.keys(el).some(k => k.startsWith('__react')); })()`,
    `hydration of ${selector}`,
  );
}

// Wraps the SpeechRecognition constructor so every instance the app creates is
// observed, along with what it was configured with. Installed before the app's
// code runs, so nothing can be created behind it.
const OBSERVE_SPEECH = `
  window.__recognisers = [];
  const Original = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (Original) {
    const Wrapped = function () {
      const instance = new Original();
      const seen = { processLocally: undefined, lang: undefined, started: false };
      window.__recognisers.push(seen);
      const originalStart = instance.start.bind(instance);
      instance.start = () => {
        // Read at start(), not at construction: what matters is the state the
        // recogniser was actually launched with.
        seen.processLocally = instance.processLocally;
        seen.lang = instance.lang;
        seen.started = true;
        return originalStart();
      };
      return instance;
    };
    Wrapped.available = Original.available?.bind(Original);
    Wrapped.install = Original.install?.bind(Original);
    window.SpeechRecognition = Wrapped;
    window.webkitSpeechRecognition = Wrapped;
  }

  // Anything that could carry audio off the device.
  window.__sent = [];
  const originalFetch = window.fetch;
  window.fetch = async (...args) => {
    const [input, init] = args;
    let body = '';
    if (typeof init?.body === 'string') body = init.body;
    else if (init?.body instanceof Blob) body = '[blob ' + init.body.type + ' ' + init.body.size + ']';
    else if (init?.body instanceof FormData) body = '[formdata]';
    window.__sent.push({ url: typeof input === 'string' ? input : input.url, body });
    return originalFetch(...args);
  };
  const originalSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function (body) {
    window.__sent.push({ url: 'xhr', body: typeof body === 'string' ? body : '[non-string]' });
    return originalSend.call(this, body);
  };

  // MediaRecorder must not be used at all: an audio Blob that exists is an
  // audio Blob that can be sent.
  window.__mediaRecorderUsed = false;
  if (typeof MediaRecorder !== 'undefined') {
    const OriginalRecorder = MediaRecorder;
    window.MediaRecorder = function (...args) {
      window.__mediaRecorderUsed = true;
      return new OriginalRecorder(...args);
    };
  }
  return true;
`;

try {
  const cdp = await CDP.attach(chrome.port, `${base}/login`);
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  await cdp.send("Browser.grantPermissions", {
    origin: base,
    permissions: ["audioCapture"],
  }).catch(() => {});
  await waitForHydration(cdp, "#password");

  await cdp.evaluate(`
    const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    const id = document.querySelector('#loginId');
    const pw = document.querySelector('#password');
    set.call(id, ${JSON.stringify(values.login)});
    id.dispatchEvent(new Event('input', { bubbles: true }));
    set.call(pw, ${JSON.stringify(values.password)});
    pw.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('form').requestSubmit();
    return true;
  `);
  record("signed in", await waitFor(cdp, settled("/home"), "sign-in"));

  // --- The journal, with the speech API under observation ------------------
  // addScriptToEvaluateOnNewDocument runs BEFORE the app's own scripts, so the
  // wrapper cannot be bypassed by code that grabs the constructor early.
  await cdp.send("Page.addScriptToEvaluateOnNewDocument", {
    source: OBSERVE_SPEECH.replace(/return true;\s*$/, ""),
  });
  await cdp.send("Page.navigate", { url: `${base}/journal` });
  await waitForHydration(cdp, "#journal");
  await gate(cdp, record, "journal-root", "the journal rendered");

  const support = await cdp.evaluate(`
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR?.available) return 'no-api';
    try { return await SR.available({ langs: ['en-US'], processLocally: true }); }
    catch (e) { return 'error: ' + e.message; }
  `);

  const toggle = await cdp.evaluate(`
    return Boolean(document.querySelector('[data-testid="voice-toggle"]'));
  `);

  // The app must offer voice only when on-device recognition is actually ready.
  record(
    "voice is offered only when on-device recognition is available",
    support === "available" ? toggle : !toggle,
    `availability=${support}, control shown=${toggle}`,
  );

  if (toggle) {
    await cdp.evaluate(`
      document.querySelector('[data-testid="voice-toggle"]')?.click();
      return true;
    `);
    await waitFor(cdp, `window.__recognisers?.length > 0`, "a recogniser to start", 15000);
  }

  const recognisers = await cdp.evaluate(`return window.__recognisers ?? []`);
  const started = recognisers.filter((r) => r.started);

  // Whether a recogniser starts here depends on a language pack being installed
  // on this machine, which has nothing to do with the code. So the positive
  // case — "started, and started locally" — is asserted deterministically in
  // tests/speech.test.ts against a faked API. What is checked HERE is the
  // invariant that holds either way, and would fail loudly if it broke.
  record(
    "no recogniser was ever started with remote processing",
    !recognisers.some((r) => r.started && r.processLocally !== true),
    started.length
      ? started.map((r) => `${r.lang} processLocally=${r.processLocally}`).join("; ")
      : `${recognisers.length} constructed, none started (on-device pack not installed here)`,
  );

  // --- Nothing carrying audio or words may leave ---------------------------
  await cdp.evaluate(`
    const set = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
    const box = document.querySelector('#journal');
    set.call(box, ${JSON.stringify(SPOKEN)});
    box.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  `);
  await cdp.evaluate(`[...document.querySelectorAll('button')].at(-1)?.click(); return true;`);
  await waitFor(
    cdp,
    `(async () => {
       const db = await new Promise(r => { const q = indexedDB.open('sentinel-companion'); q.onsuccess = () => r(q.result); });
       if (!db.objectStoreNames.contains('signals')) return false;
       return await new Promise(r => {
         const req = db.transaction('signals','readonly').objectStore('signals').get('nlp');
         req.onsuccess = () => r(Boolean(req.result));
       });
     })()`,
    "the spoken words to be scored on the device",
    120000,
  );

  const sent = await cdp.evaluate(`return window.__sent ?? []`);
  const audioLeaks = sent.filter(
    (r) => /audio|blob|formdata/i.test(r.body ?? "") || /audio/i.test(r.url ?? ""),
  );
  record("no request carries audio", audioLeaks.length === 0,
         audioLeaks.length ? audioLeaks.map((r) => r.url).join("; ") : `${sent.length} request(s) searched`);

  const wordLeaks = sent.filter(
    (r) => r.body?.includes(SPOKEN) || r.body?.includes("nights are long"),
  );
  record("no request carries the spoken words",
         sent.length > 0 && wordLeaks.length === 0,
         wordLeaks.length ? wordLeaks.map((r) => r.url).join("; ") : `${sent.length} request(s) searched`);

  const usedRecorder = await cdp.evaluate(`return window.__mediaRecorderUsed === true`);
  record("no audio recording is created at all", usedRecorder === false,
         usedRecorder ? "MediaRecorder was constructed" : "MediaRecorder never used");

  cdp.close();
} finally {
  await killChrome(chrome);
}

finish();
