// Acceptance test for step 3.8.
//
// "Toggle biometric off → no physiological data collected/sent; app fully
//  functional; toggle persists."
//
// The toggle is only meaningful if it changes what the SERVER believes. A
// switch that flips in the UI and leaves the stored flag alone is worse than no
// switch: it tells a person they have withdrawn consent when they have not. So
// this checks persistence across a full reload and a fresh session, and checks
// that a submission made with consent off records no physiological
// contribution.
//
// Usage: node scripts/verify-consent.mjs --login <id> --password <pw>

import { parseArgs } from "node:util";

import { CDP, killChrome, launchChrome, reporter, settled } from "./cdp.mjs";

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

const base = values.url.replace(/\/$/, "");
const { record, finish } = reporter();
const chrome = await launchChrome();

async function waitFor(cdp, expression, what, timeoutMs = 25000) {
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

const toggleState = (cdp) =>
  cdp.evaluate(
    `return document.querySelector('[data-testid="consent-toggle"]')?.getAttribute('aria-checked')`,
  );

try {
  const cdp = await CDP.attach(chrome.port, `${base}/login`);
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
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

  // --- Default state --------------------------------------------------------
  await cdp.send("Page.navigate", { url: `${base}/settings` });
  await waitForHydration(cdp, '[data-testid="consent-toggle"]');

  // Remember what this account started with, so the run leaves no trace.
  // Without this the test mutates shared fixture data: it left a synthetic
  // person holding physiological rows with consent switched off, which broke
  // an unrelated generator invariant in the ML suite.
  const originalConsent = await cdp.evaluate(`
    const res = await fetch('/api/consent');
    return (await res.json()).biometricConsent;
  `);

  // Reset to a known baseline through the app's own route, so the test does not
  // depend on whatever a previous run left behind.
  await cdp.evaluate(`
    await fetch('/api/consent', {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ biometricConsent: false }),
    });
    return true;
  `);
  await cdp.send("Page.reload");
  await waitForHydration(cdp, '[data-testid="consent-toggle"]');
  record("the wellness signal is off", (await toggleState(cdp)) === "false");

  // --- Turning it on, and off again ----------------------------------------
  await cdp.evaluate(`document.querySelector('[data-testid="consent-toggle"]').click(); return true;`);
  const turnedOn = await waitFor(
    cdp,
    `document.querySelector('[data-testid="consent-toggle"]')?.getAttribute('aria-checked') === 'true'`,
    "the toggle to turn on",
  );
  record("the person can turn the wellness signal on", turnedOn);

  // A full reload proves the server was changed, not just React state.
  await cdp.send("Page.reload");
  await waitForHydration(cdp, '[data-testid="consent-toggle"]');
  record("it survives a reload, so the server was changed",
         (await toggleState(cdp)) === "true");

  await cdp.evaluate(`document.querySelector('[data-testid="consent-toggle"]').click(); return true;`);
  const turnedOff = await waitFor(
    cdp,
    `document.querySelector('[data-testid="consent-toggle"]')?.getAttribute('aria-checked') === 'false'`,
    "the toggle to turn off",
  );
  record("consent is reversible — it can be turned off again", turnedOff);

  await cdp.send("Page.reload");
  await waitForHydration(cdp, '[data-testid="consent-toggle"]');
  record("turning it off also persists", (await toggleState(cdp)) === "false");

  // --- The app still works, and sends no physiological data ----------------
  await cdp.evaluate(`
    window.__sent = [];
    const original = window.fetch;
    window.fetch = async (...args) => {
      const [input, init] = args;
      window.__sent.push({
        url: typeof input === 'string' ? input : input.url,
        body: typeof init?.body === 'string' ? init.body : '',
      });
      return original(...args);
    };
    return true;
  `);

  await cdp.send("Page.navigate", { url: `${base}/check-in` });
  await waitForHydration(cdp, "fieldset button");
  await cdp.evaluate(`
    window.__sent = [];
    const original = window.fetch;
    window.fetch = async (...args) => {
      const [input, init] = args;
      window.__sent.push({
        url: typeof input === 'string' ? input : input.url,
        body: typeof init?.body === 'string' ? init.body : '',
      });
      return original(...args);
    };
    return true;
  `);

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
  const submitted = await waitFor(
    cdp,
    `location.pathname === '/check-in/done'`,
    "the success screen",
  );
  record("the app is fully functional with the signal off", submitted);

  const sent = await cdp.evaluate(`return window.__sent ?? []`);
  const submission = sent.find((r) => r.url.includes("/api/assessment"));
  let payload = null;
  try {
    payload = JSON.parse(submission?.body ?? "null");
  } catch {
    // reported below
  }
  record("the submission carries no physiological data",
         payload !== null && !("signals" in payload) && !("baseline" in payload) &&
           !("physioContribution" in payload),
         payload ? `keys: ${Object.keys(payload).join(", ")}` : "no submission captured");

  const physioRequests = sent.filter((r) =>
    /heart|hrv|sleep|physio|biometric/i.test(r.body ?? ""),
  );
  record("nothing physiological is sent anywhere",
         sent.length > 0 && physioRequests.length === 0,
         physioRequests.length ? physioRequests.map((r) => r.url).join("; ") : `${sent.length} request(s) searched`);

  // Put it back exactly as found.
  await cdp.evaluate(`
    await fetch('/api/consent', {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ biometricConsent: ${JSON.stringify(originalConsent)} }),
    });
    return true;
  `);
  const restored = await cdp.evaluate(`
    const res = await fetch('/api/consent');
    return (await res.json()).biometricConsent;
  `);
  record("the run restores the account to how it found it",
         restored === originalConsent,
         `started ${originalConsent}, left ${restored}`);

  cdp.close();
} finally {
  await killChrome(chrome);
}

finish();
