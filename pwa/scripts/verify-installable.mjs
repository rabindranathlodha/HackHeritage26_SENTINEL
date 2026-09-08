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

import { CDP, killChrome, launchChrome, reporter } from "./cdp.mjs";

const URL_UNDER_TEST = process.argv[2] ?? "http://localhost:3100/";

const { record, finish } = reporter();
const chrome = await launchChrome();

try {
  const cdp = await CDP.attach(chrome.port, URL_UNDER_TEST);
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  await cdp.send("Network.enable");

  // Wait for navigation to settle before reading the DOM. "/" redirects to
  // /home and then to /login when signed out, and querying mid-chain reads the
  // document that is about to be replaced — which reports a missing manifest on
  // a page that has one.
  await cdp.evaluate(`
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      if (document.readyState === 'complete' &&
          document.querySelector('link[rel=manifest]')) break;
      await new Promise(r => setTimeout(r, 200));
    }
    return document.readyState;
  `);

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
  await killChrome(chrome);
}

finish();
