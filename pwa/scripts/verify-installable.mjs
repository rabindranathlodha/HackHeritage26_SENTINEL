// Acceptance test for step 3.1: is this thing actually installable and offline-capable?
//
// The spec asks for "Lighthouse PWA audit passes installable". That audit no
// longer exists — the PWA category was removed in Lighthouse 12, and running
// Lighthouse 13 with --only-audits=installable-manifest returns a report with
// zero audits. So this checks the underlying criteria directly, and then checks
// the thing the criteria are a proxy for: that the app still opens with the
// network switched off.
//
// Usage: node scripts/verify-installable.mjs [url]

import { launch } from "chrome-launcher";

const URL_UNDER_TEST = process.argv[2] ?? "http://localhost:3100/";

/** Minimal CDP client. Chrome speaks this over one WebSocket; no library needed. */
class CDP {
  #ws;
  #id = 0;
  #pending = new Map();

  static async attach(port, url) {
    const res = await fetch(
      `http://127.0.0.1:${port}/json/new?${encodeURIComponent(url)}`,
      { method: "PUT" },
    );
    const target = await res.json();
    const client = new CDP();
    await client.#connect(target.webSocketDebuggerUrl);
    return client;
  }

  #connect(wsUrl) {
    this.#ws = new WebSocket(wsUrl);
    this.#ws.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      const resolver = this.#pending.get(message.id);
      if (!resolver) return;
      this.#pending.delete(message.id);
      if (message.error) {
        resolver.reject(new Error(message.error.message));
      } else {
        resolver.resolve(message.result);
      }
    });
    return new Promise((resolve, reject) => {
      this.#ws.addEventListener("open", resolve, { once: true });
      this.#ws.addEventListener("error", reject, { once: true });
    });
  }

  send(method, params = {}) {
    const id = ++this.#id;
    this.#ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) =>
      this.#pending.set(id, { resolve, reject }),
    );
  }

  /** Evaluate in the page and return the JSON value, not a remote handle. */
  async evaluate(expression) {
    const { result, exceptionDetails } = await this.send("Runtime.evaluate", {
      expression: `(async () => { ${expression} })()`,
      awaitPromise: true,
      returnByValue: true,
    });
    if (exceptionDetails) {
      throw new Error(exceptionDetails.exception?.description ?? "evaluate failed");
    }
    return result.value;
  }

  close() {
    this.#ws.close();
  }
}

const checks = [];
const record = (name, pass, detail) => {
  checks.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
};

const chrome = await launch({
  chromeFlags: ["--headless=new", "--no-sandbox", "--disable-gpu"],
});

try {
  const cdp = await CDP.attach(chrome.port, URL_UNDER_TEST);
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  await cdp.send("Network.enable");

  // --- The manifest, against the installability criteria -----------------
  const manifest = await cdp.evaluate(`
    const link = document.querySelector('link[rel=manifest]');
    if (!link) return { error: 'no <link rel=manifest>' };
    const res = await fetch(link.href);
    if (!res.ok) return { error: 'manifest HTTP ' + res.status };
    return { url: link.href, body: await res.json() };
  `);

  if (manifest.error) {
    record("manifest is served", false, manifest.error);
  } else {
    const m = manifest.body;
    record("manifest is served and parses", true, manifest.url);
    record("has a name and short_name", Boolean(m.name && m.short_name),
           `${m.name} / ${m.short_name}`);
    record("start_url and scope are set", Boolean(m.start_url && m.scope),
           `${m.start_url} scope=${m.scope}`);
    record("display is a standalone mode",
           ["standalone", "fullscreen", "minimal-ui"].includes(m.display), m.display);
    const sizes = (m.icons ?? []).map((i) => `${i.sizes}:${i.purpose ?? "any"}`);
    record("has 192px and 512px icons",
           sizes.some((s) => s.startsWith("192x192")) &&
           sizes.some((s) => s.startsWith("512x512")), sizes.join(" "));
    // Not strictly required to install, but without it Android crops a circle
    // out of the icon and clips the mark.
    record("has a maskable icon", sizes.some((s) => s.endsWith(":maskable")));
  }

  // --- The service worker -------------------------------------------------
  const worker = await cdp.evaluate(`
    if (!('serviceWorker' in navigator)) return { error: 'no serviceWorker API' };
    const deadline = Date.now() + 15000;
    let reg = await navigator.serviceWorker.getRegistration();
    while (!reg?.active && Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 250));
      reg = await navigator.serviceWorker.getRegistration();
    }
    if (!reg) return { error: 'no registration' };
    await navigator.serviceWorker.ready;
    return { scope: reg.scope, state: reg.active?.state,
             script: reg.active?.scriptURL, controller: !!navigator.serviceWorker.controller };
  `);

  if (worker.error) {
    record("service worker registers", false, worker.error);
  } else {
    record("service worker registers and activates",
           worker.state === "activated", `${worker.state} at ${worker.scope}`);
  }

  // --- The point of all of it: does it work with the network off? ---------
  // A manifest and a worker are only a proxy for this. Personnel in remote
  // postings are the reason the criteria matter at all.
  await cdp.send("Network.emulateNetworkConditions", {
    offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0,
  });
  await cdp.send("Page.reload", { ignoreCache: false });
  await new Promise((r) => setTimeout(r, 3000));

  const offline = await cdp.evaluate(`
    return { title: document.title,
             heading: document.querySelector('h1')?.textContent?.trim() ?? null,
             bodyLength: document.body?.innerText?.trim().length ?? 0,
             online: navigator.onLine };
  `);
  record("app shell renders with the network off",
         offline.bodyLength > 0 && Boolean(offline.heading),
         `"${offline.heading}" (${offline.bodyLength} chars, navigator.onLine=${offline.online})`);

  await cdp.send("Network.emulateNetworkConditions", {
    offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1,
  });
  cdp.close();
} finally {
  try {
    // chrome-launcher's temp-dir cleanup throws EPERM on Windows after the
    // browser has already exited, and it throws SYNCHRONOUSLY — a .catch() on
    // the returned promise never sees it. The checks are done by this point, so
    // a cleanup failure must not fail the run.
    await chrome.kill();
  } catch (error) {
    if (error?.code !== "EPERM") throw error;
  }
}

const failed = checks.filter((c) => !c.pass);
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
if (failed.length) {
  console.log(`FAILED: ${failed.map((c) => c.name).join(", ")}`);
  process.exit(1);
}
