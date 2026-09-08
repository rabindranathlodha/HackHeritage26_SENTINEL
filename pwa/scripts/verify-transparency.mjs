// Acceptance test for step 3.9.
//
// "Plain-language screen showing exactly what data is used, what stays on
//  device, what the person's chain of command can and cannot see."
//
// The static guard lives in tests/transparency.test.ts: no claim may be
// rendered without a mechanism and evidence behind it. This checks the screen
// as a person actually meets it — signed in, in both languages, with nothing
// on it the app is not allowed to show them.
//
// Usage: node scripts/verify-transparency.mjs --login <id> --password <pw>

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";

import { CDP, killChrome, launchChrome, reporter } from "./cdp.mjs";

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
const root = join(import.meta.dirname, "..");
const messages = Object.fromEntries(
  ["en", "hi"].map((locale) => [
    locale,
    JSON.parse(readFileSync(join(root, `messages/${locale}.json`), "utf8")).transparency,
  ]),
);

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

const readScreen = (cdp) =>
  cdp.evaluate(`
    return { path: location.pathname,
             lang: document.documentElement.lang,
             headings: [...document.querySelectorAll('h2')].map(h => h.textContent.trim()),
             body: document.body.innerText };
  `);

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
  record("signed in", await waitFor(cdp, `location.pathname === '/home'`, "sign-in"));

  record(
    "the home screen offers the transparency screen",
    await cdp.evaluate(
      `return Boolean([...document.querySelectorAll('a')].find(a => a.getAttribute('href') === '/transparency'))`,
    ),
  );

  // --- English -------------------------------------------------------------
  await cdp.send("Page.navigate", { url: `${base}/transparency` });
  await waitFor(cdp, `document.querySelector('h2')`, "the transparency screen");
  const english = await readScreen(cdp);

  record("the screen is reachable while signed in", english.path === "/transparency",
         english.path);
  record("it shows every section the spec asks for", english.headings.length >= 5,
         `${english.headings.length} sections`);

  // Each of spec 4.5's questions must actually be answered on the page, by the
  // exact sentence from the message file — not merely by a heading existing.
  const answers = {
    "what is collected": messages.en.collectedBody,
    "what stays on the device": messages.en.onDeviceBody,
    "what the welfare team sees": messages.en.teamBody,
    "what the chain of command sees": messages.en.commanderBody,
    "what the person controls": messages.en.controlsBody,
  };
  const missing = Object.entries(answers)
    .filter(([, text]) => !english.body.includes(text))
    .map(([question]) => question);
  record("it answers each question the spec names", missing.length === 0,
         missing.length ? `missing: ${missing.join(", ")}` : "all five answered");

  // --- The boundaries this screen must not cross ---------------------------
  const shown = english.body.toLowerCase();
  const clinical = ["score", "band", "risk", "diagnosis", "depression", "patient", "disorder"]
    .filter((term) => shown.includes(term));
  record("it shows no score, band or clinical term", clinical.length === 0,
         clinical.length ? clinical.join(", ") : "none");

  // The constraint recorded in docs/DATA_RETENTION.md: this build performs no
  // erasure of history, so this screen must not say it does.
  const erasure = ["we delete", "will be deleted", "erased", "wiped"]
    .filter((phrase) => shown.includes(phrase));
  record("it promises no erasure the system does not perform", erasure.length === 0,
         erasure.length ? erasure.join(", ") : "none");

  // --- Hindi ----------------------------------------------------------------
  await cdp.send("Page.navigate", { url: `${base}/settings` });
  await waitForHydration(cdp, "button[lang='hi']");
  await cdp.evaluate(`document.querySelector('button[lang="hi"]')?.click(); return true;`);
  await waitFor(cdp, `document.documentElement.lang === 'hi'`, "the switch to Hindi");

  await cdp.send("Page.navigate", { url: `${base}/transparency` });
  await waitFor(cdp, `document.querySelector('h2')`, "the Hindi transparency screen");
  const hindi = await readScreen(cdp);

  record("it is served in Hindi too", hindi.lang === "hi", hindi.lang);

  const hindiShown = [
    messages.hi.collectedBody,
    messages.hi.onDeviceBody,
    messages.hi.commanderBody,
    messages.hi.controlsBody,
  ].filter((text) => hindi.body.includes(text));
  record("the Hindi passages are actually rendered", hindiShown.length === 4,
         `${hindiShown.length}/4 present`);

  const leftInEnglish = Object.values(answers).filter((text) => hindi.body.includes(text));
  record(
    "no passage is left in English for a Hindi reader",
    hindiShown.length === 4 && leftInEnglish.length === 0,
    leftInEnglish.length
      ? `${leftInEnglish.length} untranslated passage(s)`
      : `${hindi.headings.length} sections, fully translated`,
  );

  cdp.close();
} finally {
  await killChrome(chrome);
}

finish();
