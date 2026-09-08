// Acceptance test for step 3.3: "Language toggle switches all UI copy".
//
// Checks the rendered page, not the message files — a key that exists in
// hi.json but is never wired into a component still leaves English on screen,
// and the copy test cannot see that.
//
// Usage: node scripts/verify-i18n.mjs [--url http://localhost:3100]

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";

import { CDP, killChrome, launchChrome, reporter } from "./cdp.mjs";

const { values } = parseArgs({
  options: { url: { type: "string", default: "http://localhost:3100" } },
});

const base = values.url.replace(/\/$/, "");
const root = join(import.meta.dirname, "..");
const en = JSON.parse(readFileSync(join(root, "messages/en.json"), "utf8"));
const hi = JSON.parse(readFileSync(join(root, "messages/hi.json"), "utf8"));

const { record, finish } = reporter();
const chrome = await launchChrome();

/**
 * Waits for React to hydrate, not merely for the markup to exist.
 *
 * An <h1> is present in the server-rendered HTML immediately, so waiting for it
 * proves nothing about interactivity — a click dispatched before hydration hits
 * a button with no listener and silently does nothing. Presence of a React
 * fiber on the node is the real signal.
 */
async function waitForHydration(cdp, selector, timeoutMs = 15000) {
  return waitFor(
    cdp,
    `(() => {
       const el = document.querySelector(${JSON.stringify(selector)});
       return el && Object.keys(el).some(k => k.startsWith('__react'));
     })()`,
    "hydration",
    timeoutMs,
  );
}

async function waitFor(cdp, expression, what, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await cdp.evaluate(`return Boolean(${expression});`)) return true;
    await new Promise((r) => setTimeout(r, 150));
  }
  console.error(`  (timed out waiting for ${what})`);
  return false;
}

const read = (cdp) =>
  cdp.evaluate(`
    return { lang: document.documentElement.lang,
             heading: document.querySelector('h1')?.textContent?.trim() ?? '',
             body: document.body.innerText };
  `);

try {
  const cdp = await CDP.attach(chrome.port, `${base}/login`);
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  await waitForHydration(cdp, "button[lang='hi']");

  // --- English is the default for a phone with no preference stored ---------
  const english = await read(cdp);
  record("defaults to English with no cookie set", english.lang === "en", english.lang);
  record(
    "renders the English heading from the message file",
    english.heading === en.login.heading,
    english.heading,
  );

  // --- Switch --------------------------------------------------------------
  await cdp.evaluate(`
    const button = [...document.querySelectorAll('button[lang="hi"]')][0];
    button?.click();
    return true;
  `);
  await waitFor(
    cdp,
    `document.documentElement.lang === 'hi'`,
    "the page to switch to Hindi",
  );

  const hindi = await read(cdp);
  record("the toggle switches the document language", hindi.lang === "hi", hindi.lang);
  record(
    "the heading is now the Hindi string",
    hindi.heading === hi.login.heading,
    hindi.heading,
  );

  // Every string the login screen shows must have moved, not just the heading.
  const englishLeftOver = [
    en.login.heading,
    en.login.reassurance,
    en.login.idLabel,
    en.login.passwordLabel,
    en.login.submit,
  ].filter((text) => hindi.body.includes(text));
  record(
    "no English copy is left on the screen after switching",
    englishLeftOver.length === 0,
    englishLeftOver.length ? `still showing: ${englishLeftOver.join(" | ")}` : "none",
  );

  const hindiShown = [
    hi.login.reassurance,
    hi.login.idLabel,
    hi.login.passwordLabel,
    hi.login.submit,
  ].filter((text) => hindi.body.includes(text));
  record(
    "the Hindi strings are actually rendered",
    hindiShown.length === 4,
    `${hindiShown.length}/4 present`,
  );

  // --- The choice has to survive a reload ----------------------------------
  await cdp.send("Page.reload");
  await waitForHydration(cdp, "button[lang='en']");
  const afterReload = await read(cdp);
  record(
    "the choice survives a reload",
    afterReload.lang === "hi" && afterReload.heading === hi.login.heading,
    afterReload.lang,
  );

  // --- And switching back must work, not be a one-way door ------------------
  await cdp.evaluate(`
    const button = [...document.querySelectorAll('button[lang="en"]')][0];
    button?.click();
    return true;
  `);
  await waitFor(cdp, `document.documentElement.lang === 'en'`, "the switch back");
  const back = await read(cdp);
  record("switching back to English works", back.lang === "en" && back.heading === en.login.heading, back.lang);

  cdp.close();
} finally {
  await killChrome(chrome);
}

finish();
