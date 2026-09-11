// Acceptance test for step 3.6.
//
// "Journal text → local inference → only nlpContribution (number) sent,
//  verified in network tab that raw text is NOT in any request payload."
//
// The verification is done at the network layer, not by reading the source.
// Every request the page makes — fetch, XHR, and navigations — is captured with
// its body, and a distinctive phrase from the journal entry is searched for
// across all of them. Reviewing the code proves what today's code does; this
// proves what the running app actually sends.
//
// Usage: node scripts/verify-ondevice.mjs --login <id> --password <pw>

import { parseArgs } from "node:util";

import { CDP, gate, killChrome, launchChrome, reporter, settled } from "./cdp.mjs";

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

// Distinctive enough that a substring search cannot hit it by accident, and
// shaped like something a person would actually write.
const SECRET = "zqx the roster left me hollow and sleepless vfp";

const base = values.url.replace(/\/$/, "");
const { record, finish } = reporter();
const chrome = await launchChrome();

async function waitFor(cdp, expression, what, timeoutMs = 120000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await cdp.evaluate(`return Boolean(await (${expression}));`)) return true;
    await new Promise((r) => setTimeout(r, 250));
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
    30000,
  );
}

// Captures request BODIES, which the CDP Network domain does not retain for
// requests it did not intercept. Patching both APIs the app could use is the
// reliable way to see everything the page sends.
const INSTALL_CAPTURE = `
  if (!window.__sent) {
    window.__sent = [];
    const originalFetch = window.fetch;
    window.fetch = async (...args) => {
      const [input, init] = args;
      window.__sent.push({
        kind: 'fetch',
        url: typeof input === 'string' ? input : input.url,
        body: typeof init?.body === 'string' ? init.body : '',
      });
      return originalFetch(...args);
    };
    const originalSend = XMLHttpRequest.prototype.send;
    const originalOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (method, url, ...rest) {
      this.__url = url;
      return originalOpen.call(this, method, url, ...rest);
    };
    XMLHttpRequest.prototype.send = function (body) {
      window.__sent.push({
        kind: 'xhr',
        url: this.__url ?? '',
        body: typeof body === 'string' ? body : '',
      });
      return originalSend.call(this, body);
    };
    const originalBeacon = navigator.sendBeacon?.bind(navigator);
    if (originalBeacon) {
      navigator.sendBeacon = (url, data) => {
        window.__sent.push({ kind: 'beacon', url, body: String(data ?? '') });
        return originalBeacon(url, data);
      };
    }
  }
  return true;
`;

try {
  const cdp = await CDP.attach(chrome.port, `${base}/login`);
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  await cdp.send("Network.enable");
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
  record("signed in", await waitFor(cdp, settled("/home"), "sign-in", 30000));

  // --- Write a journal entry and let the device score it -------------------
  await cdp.send("Page.navigate", { url: `${base}/journal` });
  await waitForHydration(cdp, "#journal");
  await gate(cdp, record, "journal-root", "the journal rendered");
  await cdp.evaluate(INSTALL_CAPTURE);

  await cdp.evaluate(`
    const set = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
    const box = document.querySelector('#journal');
    set.call(box, ${JSON.stringify(SECRET)});
    box.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  `);
  await cdp.evaluate(`
    [...document.querySelectorAll('button')].at(-1)?.click();
    return true;
  `);

  // Loading and running the model takes a while on a cold wasm start.
  const scored = await waitFor(
    cdp,
    `(async () => {
       const db = await new Promise(r => { const q = indexedDB.open('sentinel-companion'); q.onsuccess = () => r(q.result); });
       if (!db.objectStoreNames.contains('signals')) return false;
       return await new Promise(r => {
         const req = db.transaction('signals','readonly').objectStore('signals').get('nlp');
         req.onsuccess = () => r(Boolean(req.result));
       });
     })()`,
    "on-device inference to produce a contribution",
  );

  const contribution = await cdp.evaluate(`
    const db = await new Promise(r => { const q = indexedDB.open('sentinel-companion'); q.onsuccess = () => r(q.result); });
    if (!db.objectStoreNames.contains('signals')) return null;
    return await new Promise(r => {
      const req = db.transaction('signals','readonly').objectStore('signals').get('nlp');
      req.onsuccess = () => r(req.result ?? null);
    });
  `);

  record("the model runs on the device and produces a contribution", scored,
         contribution ? `nlpContribution = ${contribution.value.toFixed(4)}` : "none");
  // Measured against the Python model on the same text:
  //   python (torch, pruned fp32) 0.859503
  //   browser (onnx fp16, js tok) 0.859428   difference 7.5e-5
  //
  // The tolerance is wide enough for fp16 rounding and narrow enough to fail if
  // the tokenizer changes or a different export is dropped in — the int8 build
  // shifts scores by up to 0.85, and that must not pass silently.
  const EXPECTED = 0.859503;
  const TOLERANCE = 0.01;
  record("the on-device score matches the server-side model",
         typeof contribution?.value === "number" &&
           Math.abs(contribution.value - EXPECTED) < TOLERANCE,
         contribution
           ? `browser ${contribution.value.toFixed(6)} vs python ${EXPECTED} (delta ${Math.abs(contribution.value - EXPECTED).toExponential(1)})`
           : "no contribution");

  record("the contribution is a probability",
         typeof contribution?.value === "number" &&
           contribution.value >= 0 && contribution.value <= 1,
         String(contribution?.value));

  // The words themselves: not kept, because the box was left unticked.
  const kept = await cdp.evaluate(`
    const db = await new Promise(r => { const q = indexedDB.open('sentinel-companion'); q.onsuccess = () => r(q.result); });
    if (!db.objectStoreNames.contains('journal')) return [];
    return await new Promise(r => {
      const req = db.transaction('journal','readonly').objectStore('journal').getAll();
      req.onsuccess = () => r(req.result);
    });
  `);
  record("the words are not stored unless the person asked", kept.length === 0,
         `${kept.length} entr(y/ies) kept`);

  // --- Submit a check-in, which attaches the number ------------------------
  await cdp.send("Page.navigate", { url: `${base}/check-in` });
  await waitForHydration(cdp, "fieldset button");
  await cdp.evaluate(INSTALL_CAPTURE);

  const total = await cdp.evaluate(`
    return Number(document.querySelector('[role=progressbar]')?.getAttribute('aria-valuemax') ?? 0);
  `);
  for (let step = 0; step < total; step += 1) {
    await cdp.evaluate(`[...document.querySelectorAll('fieldset button')][${step % 4}]?.click(); return true;`);
    await new Promise((r) => setTimeout(r, 120));
    await cdp.evaluate(`
      const buttons = [...document.querySelectorAll('button')];
      buttons[buttons.length - 1]?.click();
      return true;
    `);
    await new Promise((r) => setTimeout(r, 320));
  }
  await waitFor(cdp, `location.pathname === '/check-in/done'`, "the success screen", 30000);

  const sent = await cdp.evaluate(`return window.__sent ?? []`);
  const submission = sent.find((r) => r.url.includes("/api/assessment"));
  record("the check-in was submitted", Boolean(submission),
         `${sent.length} request(s) captured`);

  let payload = null;
  try {
    payload = JSON.parse(submission?.body ?? "null");
  } catch {
    // reported below
  }
  record("the submission carries the number the device computed",
         typeof payload?.nlpContribution === "number" &&
           Math.abs(payload.nlpContribution - (contribution?.value ?? -1)) < 1e-9,
         `sent ${payload?.nlpContribution}`);

  // --- The guarantee -------------------------------------------------------
  const needles = [SECRET, "hollow", "sleepless", "roster left me"];
  const leaks = sent.flatMap((r) =>
    needles
      .filter((needle) => r.body?.includes(needle) || r.url?.includes(encodeURIComponent(needle)))
      .map((needle) => `"${needle}" in ${r.kind} ${r.url}`),
  );
  record("no request contains the journal text",
         sent.length > 0 && leaks.length === 0,
         leaks.length ? leaks.join("; ") : `${sent.length} request(s) searched`);

  record("the submission has no text field at all",
         payload !== null && !("text" in payload) && !("journal" in payload),
         payload ? `keys: ${Object.keys(payload).join(", ")}` : "unparseable");

  cdp.close();
} finally {
  await killChrome(chrome);
}

finish();
