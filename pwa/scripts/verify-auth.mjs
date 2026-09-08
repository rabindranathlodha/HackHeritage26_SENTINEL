// Acceptance test for step 3.2: "Login works; unauthenticated users redirect to /login".
//
// Drives a real browser rather than asserting on HTTP status codes alone,
// because the interesting failures are the ones a curl cannot see: a form that
// posts nothing, a session cookie that never lands, a sign-out that leaves the
// session live.
//
// Credentials come from the environment or the command line. They are never
// committed — issue one with:
//   docker compose exec -T -e DATABASE_URL=... api node prisma/issue-credentials.ts --user <id>
//
// Usage: node scripts/verify-auth.mjs --login <id> --password <pw> [--url http://localhost:3100]

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
  console.error(
    "need --login and --password (or TEST_LOGIN_ID / TEST_PASSWORD in the environment)",
  );
  process.exit(1);
}

const base = values.url.replace(/\/$/, "");
const { record, finish } = reporter();
const chrome = await launchChrome();

/**
 * Waits for a condition in the page rather than for a duration. A fixed sleep
 * passes on a warm server and fails on a cold one — the first scrypt
 * verification after a restart is slow by design, and a sign-in round trip is
 * exactly the thing whose timing must not be assumed.
 */
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

const settle = () => new Promise((r) => setTimeout(r, 600));

try {
  const cdp = await CDP.attach(chrome.port, `${base}/home`);
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  await settle();

  // --- Unauthenticated -----------------------------------------------------
  const anonymous = await cdp.evaluate(`return { url: location.pathname + location.search }`);
  record(
    "unauthenticated /home redirects to /login",
    anonymous.url.startsWith("/login"),
    anonymous.url,
  );

  // --- A wrong password is refused, and says nothing useful ----------------
  const wrong = await cdp.evaluate(`
    document.querySelector('#loginId').value = ${JSON.stringify(values.login)};
    document.querySelector('#password').value = 'definitely-not-the-password';
    document.querySelector('#loginId').dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('#password').dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  `);
  if (wrong) {
    // React controlled inputs ignore a raw .value assignment, so set through the
    // native setter the way the browser does.
    await cdp.evaluate(`
      const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      const id = document.querySelector('#loginId');
      const pw = document.querySelector('#password');
      set.call(id, ${JSON.stringify(values.login)});
      id.dispatchEvent(new Event('input', { bubbles: true }));
      set.call(pw, 'definitely-not-the-password');
      pw.dispatchEvent(new Event('input', { bubbles: true }));
      document.querySelector('form').requestSubmit();
      return true;
    `);
    await waitFor(
      cdp,
      `document.querySelector('[role=alert]') || location.pathname !== '/login'`,
      "the sign-in attempt to resolve",
    );
    const afterWrong = await cdp.evaluate(`
      return { path: location.pathname,
               alert: document.querySelector('[role=alert]')?.textContent?.trim() ?? null,
               cookie: document.cookie };
    `);
    record(
      "a wrong password is rejected and stays on /login",
      afterWrong.path === "/login" && Boolean(afterWrong.alert),
      afterWrong.alert ?? "(no message shown)",
    );
    record(
      "no session cookie is set on a failed sign-in",
      !afterWrong.cookie.includes("authjs.session-token"),
    );
  }

  // --- The real credential -------------------------------------------------
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
  await waitFor(cdp, settled("/home"), "the redirect to /home");

  const afterLogin = await cdp.evaluate(`
    return { path: location.pathname,
             heading: document.querySelector('h1')?.textContent?.trim() ?? null,
             body: document.body.innerText };
  `);
  record("a correct password signs in and lands on /home",
         afterLogin.path === "/home", `${afterLogin.path} — "${afterLogin.heading}"`);

  const cookies = await cdp.send("Network.getCookies", { urls: [base] });
  const session = cookies.cookies.find((c) => c.name.includes("authjs.session-token"));
  record("a session cookie is set", Boolean(session));
  record("the session cookie is httpOnly and sameSite",
         Boolean(session?.httpOnly) && session?.sameSite === "Lax",
         session ? `httpOnly=${session.httpOnly} sameSite=${session.sameSite}` : "no cookie");

  // Principle 5: the person never sees a score, a band, or a clinical term.
  const forbidden = ["score", "band", "risk", "diagnosis", "depression", "patient", "disorder"];
  const shown = afterLogin.body.toLowerCase();
  const found = forbidden.filter((term) => shown.includes(term));
  record("no score, band or clinical term is shown to the person",
         found.length === 0, found.length ? `found: ${found.join(", ")}` : "none");

  // --- Sign out actually ends the session ---------------------------------
  // Hydration, not just "loaded": the sign-out button submits a server action,
  // and a synthetic click before React attaches does nothing at all. A React
  // fiber on the node is the signal that it will respond.
  await waitFor(
    cdp,
    `(() => { const el = document.querySelector('form button');
              return el && Object.keys(el).some(k => k.startsWith('__react')); })()`,
    "the sign-out button to become interactive",
  );
  await cdp.evaluate(`
    const button = [...document.querySelectorAll('button')]
      .find(b => b.textContent.trim().toLowerCase() === 'sign out');
    button?.click();
    return true;
  `);
  await waitFor(cdp, settled("/login"), "sign-out to complete");

  await cdp.send("Page.navigate", { url: `${base}/home` });
  await settle();
  const afterSignOut = await cdp.evaluate(`return { path: location.pathname }`);
  record("after sign out, /home redirects to /login again",
         afterSignOut.path === "/login", afterSignOut.path);

  cdp.close();
} finally {
  await killChrome(chrome);
}

finish();
