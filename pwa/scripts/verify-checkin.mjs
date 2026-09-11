// Acceptance test for step 3.4, the integration gate.
//
// "Submit a self-assessment → backend Assessment row created → success screen."
//
// It also checks the property that makes this route different from the demo
// one: nothing the browser receives may contain a score, a band, a confidence
// interval or SHAP. Every response the page sees is captured and inspected,
// rather than trusting that the server was written correctly.
//
// Usage: node scripts/verify-checkin.mjs --login <id> --password <pw>

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

const base = values.url.replace(/\/$/, "");
const { record, finish } = reporter();
const chrome = await launchChrome();

// Anything that would tell the person how they scored. `score` and `band` are
// the ones the contract forbids; the rest would betray the same thing.
const FORBIDDEN_FIELDS = [
  "sentinel_score",
  "score_a",
  "score_b",
  "score_c",
  "band",
  "confidence",
  "shap_categories",
  "override_fired",
];

async function waitFor(cdp, expression, what, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    // `await` matters: an async expression would otherwise be wrapped as
    // Boolean(Promise), which is ALWAYS true — a condition that can never
    // fail is not a wait, and it reported a queue as drained when it was not.
    if (await cdp.evaluate(`return Boolean(await (${expression}));`)) return true;
    await new Promise((r) => setTimeout(r, 150));
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

try {
  const cdp = await CDP.attach(chrome.port, `${base}/login`);
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  await waitForHydration(cdp, "#password");

  // --- Sign in -------------------------------------------------------------
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
  const signedIn = await waitFor(cdp, settled("/home"), "sign-in");
  record("signed in and reached the home screen", signedIn);
  await gate(cdp, record, "home-root", "the home screen rendered");

  const home = await cdp.evaluate(`return { body: document.body.innerText }`);
  // Check for the actual affordance, not merely that text rendered — a React
  // error boundary renders text too, and "body.length > 0" passed on one.
  const offersCheckIn = await cdp.evaluate(
    `return Boolean([...document.querySelectorAll('a')].find(a => a.getAttribute('href') === '/check-in'))`,
  );
  record(
    "the home screen offers the check-in when one is due",
    offersCheckIn,
    home.body.split("\n")[0],
  );

  // --- Walk the check-in ---------------------------------------------------
  await cdp.send("Page.navigate", { url: `${base}/check-in` });
  await waitForHydration(cdp, "fieldset button");
  await gate(cdp, record, "check-in-root", "the check-in rendered");

  // Installed AFTER the navigation, not before. Page.navigate is a full
  // document load: it tears down the JS context and takes any patched fetch
  // with it, which is why the first version of this captured nothing while
  // still reporting "no leak".
  await cdp.evaluate(`
    window.__captured = [];
    const original = window.fetch;
    window.fetch = async (...args) => {
      const response = await original(...args);
      try {
        const clone = response.clone();
        window.__captured.push({
          url: typeof args[0] === 'string' ? args[0] : args[0].url,
          status: response.status,
          body: await clone.text(),
        });
      } catch {}
      return response;
    };
    return true;
  `);


  const total = await cdp.evaluate(`
    const el = document.querySelector('[role=progressbar]');
    return Number(el?.getAttribute('aria-valuemax') ?? 0);
  `);
  record("the check-in presents the whole questionnaire", total >= 8 && total <= 10,
         `${total} questions`);

  const seen = new Set();
  for (let step = 0; step < total; step += 1) {
    const question = await cdp.evaluate(`return document.querySelector('h1')?.textContent?.trim() ?? ''`);
    seen.add(question);

    // Answer, then advance. The last step's button submits instead.
    await cdp.evaluate(`
      const options = [...document.querySelectorAll('fieldset button')];
      options[${step % 4}]?.click();
      return true;
    `);
    await new Promise((r) => setTimeout(r, 120));
    await cdp.evaluate(`
      const buttons = [...document.querySelectorAll('button')];
      buttons[buttons.length - 1]?.click();
      return true;
    `);
    await new Promise((r) => setTimeout(r, 350));
  }

  record("each question was shown on its own screen",
         total > 0 && seen.size === total,
         `${seen.size} distinct questions across ${total} steps`);

  const landed = await waitFor(
    cdp,
    `location.pathname === '/check-in/done'`,
    "the success screen",
  );
  const done = await cdp.evaluate(`
    return { path: location.pathname,
             heading: document.querySelector('h1')?.textContent?.trim() ?? null,
             body: document.body.innerText };
  `);
  record("submitting reaches the success screen", landed, `${done.path} — "${done.heading}"`);

  // --- The privacy property -------------------------------------------------
  const captured = await cdp.evaluate(`return window.__captured ?? []`);
  const submission = captured.find((c) => c.url.includes("/api/assessment"));
  record("the submission returned 200", submission?.status === 200,
         submission ? `status ${submission.status}` : "no request captured");

  const leaked = captured.flatMap((c) =>
    FORBIDDEN_FIELDS.filter((field) => c.body?.includes(`"${field}"`)).map(
      (field) => `${field} in ${c.url}`,
    ),
  );
  // Requires that responses were actually captured: "nothing leaked" is
  // meaningless when nothing was inspected.
  record("no response to the browser contains a score, band or SHAP",
         captured.length > 0 && leaked.length === 0,
         leaked.length
           ? leaked.join("; ")
           : `${captured.length} responses inspected`);

  const shownTerms = ["score", "band", "risk", "diagnosis"].filter((term) =>
    done.body.toLowerCase().includes(term),
  );
  record("the success screen shows no score, band or clinical term",
         landed && shownTerms.length === 0,
         shownTerms.length ? shownTerms.join(", ") : "none");

  cdp.close();
} finally {
  await killChrome(chrome);
}

finish();
