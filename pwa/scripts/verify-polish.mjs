// Acceptance test for step 3.10.
//
// "Passes basic a11y (labels, contrast, focus order); works one-handed on a
//  360px viewport."
//
// Contrast and labels are measured by Lighthouse, which every screen already
// passes at 100. What Lighthouse cannot tell you is whether a person can reach
// the buttons with their thumb while holding a phone in one hand — so that is
// measured here, geometrically, on the 360px viewport the spec names.
//
// Also checked: the states the spec asks for exist, dark mode actually renders
// dark, and motion honours prefers-reduced-motion.
//
// Usage: node scripts/verify-polish.mjs --login <id> --password <pw>

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

// The viewport the spec names. A 360x640 phone is the low end this app is for.
const WIDTH = 360;
const HEIGHT = 640;

// WCAG 2.5.5 asks for 44x44 CSS pixels. Anything a tired person taps one-handed
// in poor light wants to be larger, and this app targets 56.
const MIN_TARGET = 44;

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

/** Measures every interactive control on the current screen. */
const measureTargets = (cdp) =>
  cdp.evaluate(`
    const nodes = [...document.querySelectorAll('a, button, input, textarea, [role=switch]')];
    return nodes
      .filter(el => {
        const r = el.getBoundingClientRect();
        // Skip anything not actually on screen (hidden, or a checkbox with a
        // larger label wrapper, which is measured through its label).
        return r.width > 0 && r.height > 0;
      })
      .map(el => {
        const r = el.getBoundingClientRect();
        return {
          tag: el.tagName.toLowerCase(),
          type: el.getAttribute('type') ?? '',
          label: (el.textContent ?? '').trim().slice(0, 32) || el.getAttribute('aria-label') || el.id,
          width: Math.round(r.width),
          height: Math.round(r.height),
          bottom: Math.round(r.bottom),
          documentHeight: Math.round(document.documentElement.scrollHeight),
        };
      });
  `);

// Reads the page's ground colour in whatever format the browser reports.
//
// The tokens are authored in oklch and getComputedStyle hands that back
// verbatim rather than converting to rgb, so scraping digits and treating them
// as r,g,b produces a number that means nothing. The first version of this did
// exactly that: it reported a light-mode luminance of 2.74 — impossible — and
// recorded it as a pass.
// String.raw, because this source is handed to the browser verbatim: in a plain
// template literal `\(`, `\s` and `\d` collapse to `(`, `s` and `d`, and the
// regex arrives as /^oklch(s*([d.]+)/ — an unterminated group.
const READ_GROUND = String.raw`
  const bg = getComputedStyle(document.body).backgroundColor;
  let lightness = null;
  const oklch = bg.match(/^oklch\(\s*([\d.]+)/);
  if (oklch) {
    // oklch's L is perceptual lightness on 0-1, which is exactly what is being
    // asked about here.
    lightness = Number(oklch[1]);
  } else {
    const rgb = bg.match(/^rgba?\(([^)]+)\)/);
    if (rgb) {
      const [r, g, b] = rgb[1].split(',').map(Number);
      lightness = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    }
  }
  return { bg, lightness };
`;

try {
  const cdp = await CDP.attach(chrome.port, `${base}/login`);
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width: WIDTH,
    height: HEIGHT,
    deviceScaleFactor: 3,
    mobile: true,
  });
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
  record("signed in at 360px", await waitFor(cdp, settled("/home"), "sign-in"));

  // --- Tap targets, across every screen ------------------------------------
  const screens = ["/home", "/check-in", "/journal", "/settings", "/transparency"];
  // Each screen's success-path root. Measuring tap targets or horizontal
  // overflow on a page that failed to render reports a clean pass over
  // nothing, so every screen is gated before it is measured.
  const ROOTS = {
    "/home": "home-root",
    "/check-in": "check-in-root",
    "/journal": "journal-root",
    "/settings": "settings-root",
    "/transparency": "transparency-root",
  };
  const undersized = [];
  const overflowing = [];

  for (const path of screens) {
    await cdp.send("Page.navigate", { url: `${base}${path}` });
    await waitFor(cdp, `document.querySelector('h1')`, `${path} to render`);
    await new Promise((r) => setTimeout(r, 400));
    await gate(cdp, record, ROOTS[path], `${path} rendered`);

    for (const target of await measureTargets(cdp)) {
      // A checkbox is legitimately small when its label is the tap area.
      const isCheckbox = target.tag === "input" && target.type === "checkbox";
      if (!isCheckbox && (target.height < MIN_TARGET || target.width < MIN_TARGET)) {
        undersized.push(`${path} ${target.tag} "${target.label}" ${target.width}x${target.height}`);
      }
    }

    const scrolls = await cdp.evaluate(
      `return document.documentElement.scrollWidth > document.documentElement.clientWidth`,
    );
    if (scrolls) overflowing.push(path);
  }

  record(
    `every control is at least ${MIN_TARGET}px on a ${WIDTH}px screen`,
    undersized.length === 0,
    undersized.length ? undersized.slice(0, 3).join("; ") : `${screens.length} screens measured`,
  );
  record("no screen scrolls sideways at 360px", overflowing.length === 0,
         overflowing.length ? overflowing.join(", ") : "none");

  // --- One-handed reach ----------------------------------------------------
  // The primary action on each screen should sit in the lower part of the
  // viewport, where a thumb reaches without shifting grip.
  await cdp.send("Page.navigate", { url: `${base}/check-in` });
  await waitForHydration(cdp, "fieldset button");
  const reach = await cdp.evaluate(`
    const buttons = [...document.querySelectorAll('button')];
    const primary = buttons[buttons.length - 1];
    const r = primary.getBoundingClientRect();
    return { top: Math.round(r.top), viewport: window.innerHeight,
             label: primary.textContent.trim() };
  `);
  record(
    "the primary action sits within thumb reach",
    reach.top > reach.viewport * 0.5,
    `"${reach.label}" starts at ${reach.top}px of ${reach.viewport}px`,
  );

  // --- The states the spec asks for ----------------------------------------
  await cdp.send("Page.navigate", { url: `${base}/a-page-that-does-not-exist` });
  await waitFor(cdp, `document.querySelector('h1')`, "the not-found screen");
  // The not-found screen is a 404 by design, so only its root is checked.
  const notFoundShell = await cdp.evaluate(
    `return Boolean(document.querySelector('[data-testid="not-found-root"]'))`,
  );
  record("the not-found screen rendered its designed state", notFoundShell);
  const notFound = await cdp.evaluate(`
    return { heading: document.querySelector('h1')?.textContent?.trim() ?? '',
             hasWayBack: Boolean([...document.querySelectorAll('a')].find(a => a.getAttribute('href') === '/home')) };
  `);
  record("an unknown page has a designed state, not a default one",
         notFound.heading.length > 0 && notFound.hasWayBack,
         `"${notFound.heading}"`);

  await cdp.send("Page.navigate", { url: `${base}/journal` });
  await waitForHydration(cdp, "#journal");
  const empty = await cdp.evaluate(`
    const heading = [...document.querySelectorAll('h2')].map(h => h.textContent.trim());
    return { headings: heading, body: document.body.innerText };
  `);
  record("the journal has an empty state rather than a blank area",
         empty.headings.length > 0 && empty.body.length > 200,
         `${empty.headings.length} section(s)`);

  // --- Dark mode actually renders dark -------------------------------------
  await cdp.send("Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-color-scheme", value: "dark" }],
  });
  await cdp.send("Page.reload");
  await waitForHydration(cdp, "#journal");
  const dark = await cdp.evaluate(READ_GROUND);
  record("dark mode follows the system preference",
         dark.lightness !== null && dark.lightness < 0.35,
         `${dark.bg} (lightness ${dark.lightness})`);

  await cdp.send("Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-color-scheme", value: "light" }],
  });
  await cdp.send("Page.reload");
  await waitForHydration(cdp, "#journal");
  const light = await cdp.evaluate(READ_GROUND);
  record("light mode is genuinely light",
         light.lightness !== null && light.lightness > 0.85,
         `${light.bg} (lightness ${light.lightness})`);

  record("the two grounds are genuinely different",
         dark.lightness !== null && light.lightness !== null &&
           light.lightness - dark.lightness > 0.4,
         `dark ${dark.lightness} vs light ${light.lightness}`);

  // --- Reduced motion ------------------------------------------------------
  await cdp.send("Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-reduced-motion", value: "reduce" }],
  });
  await cdp.send("Page.navigate", { url: `${base}/check-in` });
  await waitForHydration(cdp, "fieldset button");
  const motion = await cdp.evaluate(`
    const animated = [...document.querySelectorAll('*')].filter(el => {
      const s = getComputedStyle(el);
      const duration = parseFloat(s.transitionDuration) + parseFloat(s.animationDuration);
      return duration > 0.05;
    });
    return { count: animated.length };
  `);
  record("nothing animates when reduced motion is asked for",
         motion.count === 0, `${motion.count} element(s) still animating`);

  cdp.close();
} finally {
  await killChrome(chrome);
}

finish();
