// Acceptance test for the Welfare Console.
//
// The console's whole claim is that access is constrained and recorded. So this
// does not check that pages render — it checks the constraints, from the
// browser, against the real database:
//
//   - a PERSONNEL account cannot sign in at all
//   - an officer sees only their own caseload
//   - opening a record WRITES AN AUDIT ROW (proved by reading the officer's own
//     access log afterwards, not by trusting that the code called a logger)
//   - a person outside the caseload is refused
//   - a commander cannot reach an individual, and the officer cannot reach the
//     aggregate view
//   - cohorts below the k-anonymity threshold are withheld, not rounded
//
// The CDP harness is shared with the Companion's scripts rather than copied:
// one browser client to fix, and Node resolves chrome-launcher from the pwa
// package where that file lives.
//
// Usage:
//   node scripts/verify-console.mjs \
//     --officer off-001 --commander cmd-001 --password <pw> --personnel syn-000002

import { parseArgs } from "node:util";

import {
  CDP,
  killChrome,
  launchChrome,
  reporter,
} from "../../pwa/scripts/cdp.mjs";

const { values } = parseArgs({
  options: {
    officer: { type: "string", default: "off-001" },
    commander: { type: "string", default: "cmd-001" },
    password: { type: "string" },
    personnel: { type: "string", default: "syn-000002" },
    personnelPassword: { type: "string", default: "design-check-9f2a" },
    url: { type: "string", default: "http://localhost:3000" },
  },
});

if (!values.password) {
  console.error("need --password (the console password from seed-console.ts)");
  process.exit(1);
}

const base = values.url.replace(/\/$/, "");
const { record, finish } = reporter();
const chrome = await launchChrome();

async function waitFor(cdp, expression, what, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    // `await` matters: an async expression would otherwise be wrapped as
    // Boolean(Promise), which is ALWAYS true — a condition that can never fail
    // is not a wait.
    if (await cdp.evaluate(`return Boolean(await (${expression}));`)) return true;
    await new Promise((r) => setTimeout(r, 150));
  }
  console.error(`  (timed out waiting for ${what})`);
  return false;
}

const text = (cdp) => cdp.evaluate(`return document.body.innerText`);

/** Signs in through the real form; returns the path it landed on. */
async function signIn(cdp, loginId, password) {
  await cdp.send("Page.navigate", { url: `${base}/welfare/login` });
  await waitFor(cdp, `document.querySelector('#password')`, "the login form");
  await cdp.evaluate(`
    const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;
    const id = document.querySelector('#loginId'), pw = document.querySelector('#password');
    set.call(id, ${JSON.stringify(loginId)}); id.dispatchEvent(new Event('input',{bubbles:true}));
    set.call(pw, ${JSON.stringify(password)}); pw.dispatchEvent(new Event('input',{bubbles:true}));
    document.querySelector('form').requestSubmit();
    return true;
  `);
  await new Promise((r) => setTimeout(r, 2200));
  return cdp.evaluate(`return location.pathname + location.search`);
}

async function signOut(cdp) {
  await cdp.send("Page.navigate", { url: `${base}/welfare` });
  await new Promise((r) => setTimeout(r, 900));
  await cdp.evaluate(`
    const form = [...document.querySelectorAll('form')].find(f => f.innerText.includes('Sign out'));
    if (form) form.requestSubmit();
    return true;
  `);
  await new Promise((r) => setTimeout(r, 1500));
}

try {
  const cdp = await CDP.attach(chrome.port, `${base}/welfare/login`);
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width: 1280,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  });

  // --- The console is not a door for the people it is about ------------------
  const personnelLanding = await signIn(
    cdp,
    values.personnel,
    values.personnelPassword,
  );
  record(
    "a personnel account cannot sign into the console",
    personnelLanding.startsWith("/welfare/login"),
    `landed on ${personnelLanding}`,
  );

  // --- Signed out, the queue is not reachable --------------------------------
  await cdp.send("Page.navigate", { url: `${base}/welfare` });
  await new Promise((r) => setTimeout(r, 1200));
  const anonymous = await cdp.evaluate(`return location.pathname`);
  record(
    "the queue redirects to sign-in when nobody is signed in",
    anonymous === "/welfare/login",
    anonymous,
  );

  // --- Officer -------------------------------------------------------------
  const officerLanding = await signIn(cdp, values.officer, values.password);
  record("the officer signs in", officerLanding === "/welfare", officerLanding);

  const queue = await text(cdp);
  // Checked before anything is read out of the page. Without it, a 500 renders
  // as a page with no links and every later assertion reports "the queue is
  // empty" — which is a different and much more comforting claim than "the
  // queue did not load".
  record(
    "the queue page actually rendered",
    /Review queue/.test(queue),
    queue.split("\n").slice(0, 2).join(" / ") || "(empty page)",
  );

  const targetId = await cdp.evaluate(`
    const link = [...document.querySelectorAll('a')].find(a => a.getAttribute('href')?.startsWith('/welfare/person/'));
    return link ? decodeURIComponent(link.getAttribute('href').split('/').pop()) : null;
  `);
  record(
    "the queue lists the officer's assigned caseload",
    targetId !== null,
    targetId ? `first record ${targetId}` : "no records in the queue",
  );
  record(
    "the queue names a band in words, not colour alone",
    /low|moderate|elevated|priority review/i.test(queue),
    queue.split("\n").find((line) => /priority review|elevated|moderate|low/i.test(line)) ?? "none",
  );

  // --- Opening a record is recorded -----------------------------------------
  // The proof is the officer's own access log AFTER the view, read back through
  // the database accessor. Nothing here trusts that the app called a logger.
  //
  // The newest entry, not a count of matches: the log is capped, and every
  // queue view writes an entry of its own, so on a repeat run older individual
  // views fall off the end and a count stays flat while the write succeeded.
  await cdp.send("Page.navigate", {
    url: `${base}/welfare/person/${encodeURIComponent(targetId)}`,
  });
  await waitFor(cdp, `document.querySelector('h1')`, "the individual record");
  const recordPage = await text(cdp);

  record(
    "the record shows the indicator with its plausible range",
    /Plausible range \d+–\d+/.test(recordPage),
    recordPage.match(/Plausible range[^\n]*/)?.[0] ?? "no range shown",
  );
  const contributions = await cdp.evaluate(
    `return document.querySelectorAll('li div[style*="width"]').length`,
  );
  record(
    "the record explains what moved the indicator",
    /what moved it/i.test(recordPage) && contributions > 0,
    `${contributions} category contribution(s) drawn`,
  );
  record(
    "the record says the view was recorded",
    /recorded against your ID/i.test(recordPage),
    "notice shown on the page itself",
  );
  record(
    "the record never shows the person's own words",
    !/journal|reflection text|wrote:/i.test(recordPage) ||
      recordPage.includes("never the words"),
    "categories only",
  );
  record(
    "the record states it is not a diagnosis",
    /not a diagnosis/i.test(recordPage),
    "disclaimer present",
  );

  await cdp.send("Page.navigate", { url: `${base}/welfare` });
  await waitFor(cdp, `document.querySelector('h1')`, "the queue");
  // The top of the log after this sequence is necessarily:
  //   VIEW_ALERT_QUEUE        (this very page render)
  //   VIEW_INDIVIDUAL_*       (the record just opened)
  //   VIEW_INDIVIDUAL_*
  // so the individual entries sit within the first few rows. Looking only at
  // those makes the check independent of how many earlier runs are in the log,
  // which a whole-list search would not be.
  const recent = await cdp.evaluate(`
    const heading = [...document.querySelectorAll('h2, p')]
      .find(el => /your access log/i.test(el.textContent ?? ''));
    const list = heading?.closest('section')?.querySelector('ul');
    if (!list) return null;
    return [...list.querySelectorAll('li')]
      .slice(0, 4)
      .map(li => li.innerText.replace(/\\s+/g, ' ').trim());
  `);
  const proof =
    Array.isArray(recent) &&
    recent.find(
      (entry) => /view individual/i.test(entry) && entry.includes(targetId),
    );
  record(
    "opening a record wrote an audit row the officer can see",
    Boolean(proof),
    proof || `no individual view logged for ${targetId}; newest rows: ${JSON.stringify(recent)}`,
  );

  // --- Somebody outside the caseload ----------------------------------------
  await cdp.send("Page.navigate", {
    url: `${base}/welfare/person/syn-000999`,
  });
  await waitFor(cdp, `document.querySelector('h1')`, "the refusal");
  const refused = await text(cdp);
  record(
    "a person outside the caseload is refused, not shown an empty record",
    /cannot open this record/i.test(refused),
    refused.split("\n").find((line) => line.includes("cannot open")) ?? "no refusal",
  );

  // --- Least privilege across roles -----------------------------------------
  await cdp.send("Page.navigate", { url: `${base}/welfare/cohort` });
  await new Promise((r) => setTimeout(r, 1200));
  const officerAtCohort = await cdp.evaluate(`return location.pathname`);
  record(
    "an officer cannot reach the aggregate view",
    officerAtCohort === "/welfare",
    `landed on ${officerAtCohort}`,
  );

  await signOut(cdp);

  const commanderLanding = await signIn(cdp, values.commander, values.password);
  record(
    "a commander lands on units, not on a caseload",
    commanderLanding === "/welfare/cohort",
    commanderLanding,
  );

  const cohort = await text(cdp);
  record(
    "the aggregate view withholds cohorts below the threshold",
    /withheld/i.test(cohort),
    cohort.match(/fewer than \d+ people/)?.[0] ?? "no suppression shown",
  );
  // Checked per card in the DOM, not by proximity in the page text: a withheld
  // unit is followed by an ordinary one, and a text window wide enough to cover
  // the withheld card also reaches the next card's mean.
  const leakage = await cdp.evaluate(`
    const cards = [...document.querySelectorAll('section')]
      .filter(el => /withheld/i.test(el.innerText));
    return cards.map(card => ({
      text: card.innerText.replace(/\\s+/g, ' ').slice(0, 90),
      // A stacked bar is drawn with an inline width; a withheld unit has none.
      bars: card.querySelectorAll('div[style*="width"]').length,
      mean: /mean \\d/i.test(card.innerText),
    })).filter(card => card.bars > 0 || card.mean);
  `);
  record(
    "a withheld cohort shows no figures at all",
    Array.isArray(leakage) && leakage.length === 0,
    leakage.length
      ? `${leakage.length} withheld unit(s) leaked a figure: ${leakage[0].text}`
      : "no bars and no mean on any withheld unit",
  );
  record(
    "the aggregate view offers no route to an individual",
    (await cdp.evaluate(
      `return [...document.querySelectorAll('a')].filter(a => a.getAttribute('href')?.includes('/welfare/person/')).length`,
    )) === 0,
    "no person links on the commander's page",
  );

  cdp.close();
} finally {
  await killChrome(chrome);
}

finish();
