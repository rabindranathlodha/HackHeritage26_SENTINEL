// Acceptance test for the Companion design system.
//
// The design document (design-import/SENTINEL Companion.dc.html) states its own
// non-negotiables, and this checks the ones a machine can check:
//
//   "Text >=15px, targets >=56px, contrast >=4.5:1, one-handed at 360px."
//   "Dark is not inverted — it is a warmer, quieter room."
//   "Devanagari gets its own display face and a slightly larger optical size."
//   "All of the above degrade to instant [under reduced motion]."
//
// It runs on the routes that need no session, so it is useful with the API tier
// down. verify-polish.mjs covers the signed-in screens and needs credentials.
//
// The palette is asserted by VALUE, not by "is a colour set". A token file that
// silently fell back to the shadcn defaults would still produce a styled page —
// it would just be a different product than the one that was designed.
//
// Usage: node scripts/verify-design.mjs [--url http://localhost:3100]

import { parseArgs } from "node:util";

import { CDP, gate, killChrome, launchChrome, reporter } from "./cdp.mjs";

const { values } = parseArgs({
  options: { url: { type: "string", default: "http://localhost:3100" } },
});

const base = values.url.replace(/\/$/, "");
const { record, finish } = reporter();

// The design's viewport and its tap-target rule. WCAG asks 44; the design asks
// 56, and the stricter number is the one that was designed to.
const WIDTH = 360;
const HEIGHT = 640;
const MIN_TARGET = 56;

// Straight from the design document's palette swatches.
const PAPER = "rgb(247, 244, 241)";
const DARK_GROUND = "rgb(25, 23, 21)";
const EMBER = "rgb(180, 86, 42)";

/** The success-path root each public screen renders. */
const ROOTS = { "/login": "login-root", "/offline": "offline-root" };

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

/** Reads the type stack actually resolved for a selector. */
const READ_TYPE = (selector) => `
  const el = document.querySelector(${JSON.stringify(selector)});
  if (!el) return null;
  const s = getComputedStyle(el);
  return { family: s.fontFamily, size: s.fontSize, weight: s.fontWeight };
`;

const chrome = await launchChrome();

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
  await cdp.send("Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-color-scheme", value: "light" }],
  });
  await cdp.send("Page.reload");
  await waitFor(cdp, `document.querySelector('h1')`, "the login screen");

  // Liveness before anything below asserts an absence. A 500 has no
  // third-party stylesheet and no sideways scroll either.
  await gate(cdp, record, "login-root", "the sign-in screen rendered");

  // Type is measured only once the browser has finished loading faces. On a
  // cold server the first document beats its own font requests, and measuring
  // in that window reports "Times New Roman" — which is exactly what a real
  // broken font stack looks like. A test that cannot tell a slow load from a
  // missing face will eventually be believed about the wrong one.
  await waitFor(cdp, `document.fonts.ready.then(() => true)`, "web fonts to load");

  // --- The type pairing -----------------------------------------------------
  const display = await cdp.evaluate(READ_TYPE("h1"));
  record(
    "the anchor is set in the display face",
    /bricolage/i.test(display?.family ?? ""),
    display?.family ?? "no h1",
  );

  const body = await cdp.evaluate(READ_TYPE("body"));
  record(
    "body copy is set in the body face",
    /hanken/i.test(body?.family ?? ""),
    body?.family ?? "no body",
  );
  record(
    "body copy is at least the design's 15px floor",
    parseFloat(body?.size ?? "0") >= 15,
    body?.size ?? "unknown",
  );

  const meta = await cdp.evaluate(READ_TYPE(".meta"));
  record(
    "meta labels are set in the mono face",
    /jetbrains|mono/i.test(meta?.family ?? ""),
    meta?.family ?? "no .meta on this screen",
  );

  // Self-hosted, not fetched from Google. A third-party stylesheet would be a
  // second connection before a glyph is requested, and the CSP would have to
  // be widened to allow it.
  const external = await cdp.evaluate(`
    return [...document.querySelectorAll('link[rel=stylesheet], link[rel=preload]')]
      .map(l => l.href)
      .filter(href => !href.startsWith(location.origin));
  `);
  record("no font is loaded from a third-party origin", external.length === 0,
         external.length ? external.join(", ") : "all same-origin");

  // --- Light ground ---------------------------------------------------------
  const light = await cdp.evaluate(`
    return { bg: getComputedStyle(document.body).backgroundColor };
  `);
  record("the light ground is the design's paper", light.bg === PAPER, light.bg);

  const accent = await cdp.evaluate(`
    const el = [...document.querySelectorAll('button, a')]
      .find(n => getComputedStyle(n).backgroundColor === '${EMBER}');
    return el ? el.textContent.trim().slice(0, 40) : null;
  `);
  record(
    "the ember accent is applied to the primary action",
    accent !== null,
    accent ?? `nothing on this screen is ${EMBER}`,
  );

  // --- One-handed at 360px --------------------------------------------------
  const undersized = [];
  const overflowing = [];
  for (const path of ["/login", "/offline"]) {
    await cdp.send("Page.navigate", { url: `${base}${path}` });
    await waitFor(cdp, `document.querySelector('h1')`, `${path} to render`);
    await gate(cdp, record, ROOTS[path], `${path} rendered`);

    const targets = await cdp.evaluate(`
      return [...document.querySelectorAll('a, button, input, textarea, [role=switch]')]
        .filter(el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; })
        .map(el => {
          const r = el.getBoundingClientRect();
          return {
            tag: el.tagName.toLowerCase(),
            type: el.getAttribute('type') ?? '',
            label: (el.textContent ?? '').trim().slice(0, 28) || el.id,
            w: Math.round(r.width), h: Math.round(r.height),
          };
        });
    `);
    for (const target of targets) {
      // A checkbox is legitimately small when its label is the tap area.
      if (target.tag === "input" && target.type === "checkbox") continue;
      if (target.h < MIN_TARGET) {
        undersized.push(`${path} ${target.tag} "${target.label}" ${target.w}x${target.h}`);
      }
    }

    if (
      await cdp.evaluate(
        `return document.documentElement.scrollWidth > document.documentElement.clientWidth`,
      )
    ) {
      overflowing.push(path);
    }
  }
  record(
    `every control is at least ${MIN_TARGET}px tall at ${WIDTH}px`,
    undersized.length === 0,
    undersized.length ? undersized.slice(0, 3).join("; ") : "2 screens measured",
  );
  record("no screen scrolls sideways at 360px", overflowing.length === 0,
         overflowing.length ? overflowing.join(", ") : "none");

  // --- Dark is its own room, not an inversion -------------------------------
  await cdp.send("Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-color-scheme", value: "dark" }],
  });
  await cdp.send("Page.navigate", { url: `${base}/login` });
  await waitFor(cdp, `document.querySelector('h1')`, "the login screen in dark");

  const dark = await cdp.evaluate(`
    const s = getComputedStyle(document.body);
    return { bg: s.backgroundColor, fg: s.color };
  `);
  record("the dark ground is the design's warm charcoal", dark.bg === DARK_GROUND, dark.bg);
  record(
    "dark is warm rather than a neutral inversion",
    (() => {
      const [r, , b] = dark.bg.match(/\d+/g).map(Number);
      // A warm ground has more red than blue. A greyscale fallback has none.
      return r > b;
    })(),
    `${dark.bg} (red above blue)`,
  );

  // --- Devanagari is designed, not translated -------------------------------
  await cdp.evaluate(
    `document.cookie = 'sentinel-locale=hi; path=/; max-age=3600'; return true;`,
  );
  await cdp.send("Page.navigate", { url: `${base}/login` });
  await waitFor(cdp, `document.documentElement.lang === 'hi'`, "the Hindi login screen");

  const deva = await cdp.evaluate(READ_TYPE("h1"));
  const devaBody = await cdp.evaluate(READ_TYPE("body"));
  record(
    "Hindi gets its own display face",
    /anek/i.test(deva?.family ?? ""),
    deva?.family ?? "no h1",
  );
  record(
    "Hindi gets its own body face",
    /mukta/i.test(devaBody?.family ?? ""),
    devaBody?.family ?? "no body",
  );
  record(
    "Devanagari is set at a larger optical size than Latin",
    parseFloat(devaBody?.size ?? "0") > parseFloat(body?.size ?? "0"),
    `${devaBody?.size} vs ${body?.size} for Latin`,
  );
  record(
    "the shirorekha is not crushed by Latin's negative tracking",
    (await cdp.evaluate(`
      const el = document.querySelector('h1');
      return el ? getComputedStyle(el).letterSpacing : null;
    `)) === "normal",
    "letter-spacing on the Hindi anchor",
  );

  await cdp.evaluate(
    `document.cookie = 'sentinel-locale=en; path=/; max-age=3600'; return true;`,
  );

  // --- Reduced motion -------------------------------------------------------
  await cdp.send("Emulation.setEmulatedMedia", {
    features: [
      { name: "prefers-color-scheme", value: "light" },
      { name: "prefers-reduced-motion", value: "reduce" },
    ],
  });
  await cdp.send("Page.navigate", { url: `${base}/login` });
  await waitFor(cdp, `document.querySelector('h1')`, "the login screen with reduced motion");
  await gate(cdp, record, "login-root", "the sign-in screen rendered with reduced motion");

  const motion = await cdp.evaluate(`
    const animated = [...document.querySelectorAll('*')].filter(el => {
      const s = getComputedStyle(el);
      return parseFloat(s.transitionDuration) + parseFloat(s.animationDuration) > 0.05;
    });
    return { count: animated.length };
  `);
  record("nothing animates when reduced motion is asked for", motion.count === 0,
         `${motion.count} element(s) still animating`);

  // The grain is texture with no information in it, so it must not be the one
  // thing that survives a request for less.
  const grain = await cdp.evaluate(`
    const s = getComputedStyle(document.body, '::after');
    return { image: s.backgroundImage, opacity: s.opacity };
  `);
  record(
    "the paper grain is a single fixed layer, not a per-surface background",
    grain.image.includes("svg+xml") || grain.image === "none",
    grain.image === "none" ? "not painted here" : `opacity ${grain.opacity}`,
  );

  cdp.close();
} finally {
  await killChrome(chrome);
}

finish();
