// Prints a session cookie so Lighthouse can audit an authenticated route.
// Test-only helper: it signs in as the account you give it and prints nothing
// else. The cookie is short-lived and never written to disk.
import { parseArgs } from "node:util";

import { CDP, killChrome, launchChrome } from "./cdp.mjs";

const { values } = parseArgs({
  options: {
    login: { type: "string" },
    password: { type: "string" },
    url: { type: "string", default: "http://localhost:3100" },
  },
});

const base = values.url.replace(/\/$/, "");
const chrome = await launchChrome();
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
try {
  const cdp = await CDP.attach(chrome.port, `${base}/login`);
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  await wait(2500);
  await cdp.evaluate(`
    const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;
    const id = document.querySelector('#loginId'), pw = document.querySelector('#password');
    set.call(id, ${JSON.stringify(values.login)}); id.dispatchEvent(new Event('input',{bubbles:true}));
    set.call(pw, ${JSON.stringify(values.password)}); pw.dispatchEvent(new Event('input',{bubbles:true}));
    document.querySelector('form').requestSubmit(); return true;
  `);
  await wait(4000);
  const { cookies } = await cdp.send("Network.getCookies", { urls: [base] });
  const session = cookies.find((c) => c.name.includes("authjs.session-token"));
  if (!session) {
    console.error("no session cookie; sign-in failed");
    process.exit(1);
  }
  process.stdout.write(`${session.name}=${session.value}`);
  cdp.close();
} finally {
  await killChrome(chrome);
}
