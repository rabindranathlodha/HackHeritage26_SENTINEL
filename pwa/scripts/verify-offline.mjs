// Acceptance test for step 3.5.
//
// "Turn off network → submit → item queues → turn on → auto-syncs. No data loss."
//
// It also tests the thing the spec asks for in the same breath and which is
// easy to leave unproven: idempotency. A queued item is deliberately replayed
// after it has already synced, and the database must still hold exactly one
// row. Without that, a flaky connection files a person's check-in twice and
// each duplicate can raise another alert for a welfare officer.
//
// Usage: node scripts/verify-offline.mjs --login <id> --password <pw>

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

async function waitFor(cdp, expression, what, timeoutMs = 25000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    // `await` matters: an async expression would otherwise be wrapped as
    // Boolean(Promise), which is ALWAYS true — a condition that can never
    // fail is not a wait, and it reported a queue as drained when it was not.
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

const setOffline = (cdp, offline) =>
  cdp.send("Network.emulateNetworkConditions", {
    offline,
    latency: 0,
    downloadThroughput: offline ? 0 : -1,
    uploadThroughput: offline ? 0 : -1,
  });

// Reads the outbox directly, because "it queued" must mean the record is in
// IndexedDB and would survive the app being closed — not that a variable in
// memory says so.
const outbox = (cdp) =>
  cdp.evaluate(`
    const db = await new Promise((resolve, reject) => {
      const req = indexedDB.open('sentinel-companion');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    if (!db.objectStoreNames.contains('outbox')) return [];
    return await new Promise((resolve, reject) => {
      const tx = db.transaction('outbox', 'readonly');
      const req = tx.objectStore('outbox').getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  `);

async function completeCheckIn(cdp) {
  const total = await cdp.evaluate(`
    const el = document.querySelector('[role=progressbar]');
    return Number(el?.getAttribute('aria-valuemax') ?? 0);
  `);
  for (let step = 0; step < total; step += 1) {
    await cdp.evaluate(`
      [...document.querySelectorAll('fieldset button')][${step % 4}]?.click();
      return true;
    `);
    await new Promise((r) => setTimeout(r, 120));
    await cdp.evaluate(`
      const buttons = [...document.querySelectorAll('button')];
      buttons[buttons.length - 1]?.click();
      return true;
    `);
    await new Promise((r) => setTimeout(r, 320));
  }
  return total;
}

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
  record("signed in", await waitFor(cdp, settled("/home"), "sign-in"));

  // --- Submit with the network off -----------------------------------------
  await cdp.send("Page.navigate", { url: `${base}/check-in` });
  await waitForHydration(cdp, "fieldset button");
  await gate(cdp, record, "check-in-root", "the check-in rendered");
  await setOffline(cdp, true);

  const answered = await completeCheckIn(cdp);
  const reachedDone = await waitFor(
    cdp,
    `location.pathname === '/check-in/done'`,
    "the success screen while offline",
  );
  const done = await cdp.evaluate(`
    return { search: location.search,
             body: document.body.innerText };
  `);
  record("submitting offline still reaches the success screen", reachedDone,
         `${answered} questions answered`);
  record("the person is told it is saved, not that it failed",
         done.search.includes("queued=1"), done.body.split("\n")[1] ?? "");

  const queued = await outbox(cdp);
  record("the submission is in IndexedDB, not just in memory",
         queued.length === 1, `${queued.length} item(s) in the outbox`);
  record("the queued item carries the answers and a client id",
         queued[0]?.responses?.length === answered && Boolean(queued[0]?.clientId),
         queued[0] ? `${queued[0].responses.length} answers, id ${queued[0].clientId?.slice(0, 8)}…` : "empty");

  const queuedId = queued[0]?.clientId;

  // --- Reconnect and let it flush on its own -------------------------------
  await cdp.send("Page.navigate", { url: `${base}/home` });
  await waitForHydration(cdp, "a[href='/check-in'], button");
  await setOffline(cdp, false);
  await cdp.evaluate(`window.dispatchEvent(new Event('online')); return true;`);

  const drained = await waitFor(
    cdp,
    `(async () => {
       const db = await new Promise(r => { const q = indexedDB.open('sentinel-companion'); q.onsuccess = () => r(q.result); });
       if (!db.objectStoreNames.contains('outbox')) return true;
       return await new Promise(r => {
         const req = db.transaction('outbox','readonly').objectStore('outbox').count();
         req.onsuccess = () => r(req.result === 0);
       });
     })()`,
    "the outbox to drain",
  );
  record("reconnecting flushes the queue automatically", drained);

  const after = await outbox(cdp);
  record(
    "nothing is left waiting",
    after.length === 0,
    after.length
      ? after
          .map((i) => `id ${i.clientId?.slice(0, 8)}… attempts=${i.attempts} last=${i.lastError ?? "none"}`)
          .join("; ")
      : "0 item(s)",
  );

  // --- Idempotency: replay the same submission ------------------------------
  const replay = await cdp.evaluate(`
    const res = await fetch('/api/assessment', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        responses: ${JSON.stringify(queued[0]?.responses ?? [])},
        language: 'en',
        nlpContribution: null,
        clientId: ${JSON.stringify(queuedId ?? "")},
      }),
    });
    return { status: res.status, body: await res.text() };
  `);
  record("replaying the same submission is accepted, not rejected",
         replay.status === 200, `status ${replay.status}`);

  let acknowledged = null;
  try {
    acknowledged = JSON.parse(replay.body);
  } catch {
    // fall through: the assertion below reports it
  }
  record("the replay is recognised as a duplicate, not recorded again",
         acknowledged?.duplicate === true,
         acknowledged ? `body=${replay.body.slice(0, 120)}` : "unparseable body");

  cdp.close();
} finally {
  await killChrome(chrome);
}

finish();
