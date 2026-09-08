// The transparency screen has to stay true, not just start true.
//
// Every other test here checks behaviour. This one checks a document, because
// on this screen a sentence IS the product: "your words never leave this phone"
// is the reason someone opens the app at all. The realistic failure is not a
// bug — it is a kind, plausible line added later by someone who did not know it
// had stopped being accurate.
//
// So: a claim may not be rendered unless content/transparency.ts pairs it with
// a mechanism and with evidence, and the page may not render a claim that has
// no entry. Adding comforting copy is not enough to get it on screen.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import {
  BEHAVIOURAL_WORDS,
  CLAIMS,
  FORBIDDEN_PROMISES,
  SIGNPOSTS,
} from "../src/content/transparency.ts";

const ROOT = join(import.meta.dirname, "..");

const page = readFileSync(
  join(ROOT, "src/app/(app)/transparency/page.tsx"),
  "utf8",
);

const messages = Object.fromEntries(
  ["en", "hi"].map((locale) => [
    locale,
    JSON.parse(readFileSync(join(ROOT, `messages/${locale}.json`), "utf8"))
      .transparency as Record<string, string>,
  ]),
);

/** The body keys the page actually renders, read from its SECTIONS table. */
function renderedBodies(): string[] {
  const table = page.slice(page.indexOf("const SECTIONS"), page.indexOf("] as const;"));
  return [...table.matchAll(/bodies:\s*\[([^\]]+)\]/g)].flatMap((match) =>
    [...match[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]),
  );
}

test("the page renders the sections the spec asks for", () => {
  // Spec 4.5: collected, what stays on device, what the welfare team sees, what
  // the chain of command sees, and the person's controls.
  for (const heading of [
    "collectedHeading",
    "onDeviceHeading",
    "teamHeading",
    "commanderHeading",
    "controlsHeading",
  ]) {
    assert.ok(page.includes(heading), `the page does not render ${heading}`);
  }
});

test("every rendered claim is backed by a mechanism and evidence", () => {
  const backed = new Map(CLAIMS.map((claim) => [claim.id, claim]));
  const signposted = new Set(SIGNPOSTS.map((s) => s.id));

  for (const id of renderedBodies()) {
    if (signposted.has(id)) continue;
    const claim = backed.get(id);
    assert.ok(
      claim,
      `"${id}" is rendered on the transparency screen with nothing behind it. ` +
        `Add it to content/transparency.ts with the mechanism that makes it ` +
        `true and the test that proves it — or do not make the claim.`,
    );
    assert.ok(claim.mechanism.length > 40, `${id} has no real mechanism`);
    assert.ok(claim.evidence.length > 20, `${id} has no real evidence`);
  }
});

test("a signpost may not smuggle in a claim about the system", () => {
  // The exemption is for sentences that point at a human, not for unbacked
  // statements about behaviour wearing a different label.
  for (const signpost of SIGNPOSTS) {
    assert.ok(signpost.why.length > 40, `${signpost.id} is exempted without a reason`);
    for (const [locale, block] of Object.entries(messages)) {
      const text = (block[signpost.id] ?? "").toLowerCase();
      for (const word of BEHAVIOURAL_WORDS) {
        assert.ok(
          // String.raw, because in a plain template literal `\b` is a backspace
          // character, not a word boundary — the first version of this could
          // never match anything and silently passed.
          !new RegExp(String.raw`\b` + word + String.raw`\b`).test(text),
          `${signpost.id} in ${locale} says "${word}" — that is a claim about ` +
            `the system and belongs in CLAIMS with evidence`,
        );
      }
    }
  }
});

test("the exemption list stays small", () => {
  // If this needs raising, the question to ask first is whether the screen has
  // started explaining itself instead of stating what it does.
  assert.ok(SIGNPOSTS.length <= 2, `${SIGNPOSTS.length} exemptions is too many`);
});

test("evidence points at something checkable, not at an assurance", () => {
  for (const claim of CLAIMS) {
    assert.match(
      claim.evidence,
      /tests?\/|scripts\/|schema|trigger|policy|grant/i,
      `${claim.id}'s evidence does not name a test or an enforced constraint: ` +
        `"${claim.evidence}"`,
    );
  }
});

test("no claim is backed but silently dropped from the page", () => {
  // The reverse direction: a claim documented as true but never shown is a
  // promise the person never sees, which is its own kind of drift.
  const rendered = new Set(renderedBodies());
  for (const claim of CLAIMS) {
    assert.ok(
      rendered.has(claim.id),
      `${claim.id} is documented but not rendered — either show it or remove it`,
    );
  }
});

test("every claim exists in both languages", () => {
  for (const claim of CLAIMS) {
    for (const [locale, block] of Object.entries(messages)) {
      assert.ok(block[claim.id], `${claim.id} is missing from ${locale}.json`);
      assert.ok(
        block[claim.id].trim().length > 20,
        `${claim.id} in ${locale} is too short to be a real statement`,
      );
    }
  }
});

test("the screen does not promise erasure the system does not perform", () => {
  // docs/DATA_RETENTION.md sets erasure-on-withdrawal as the policy for a real
  // deployment, flagged for privacy-counsel review, and no code implements it —
  // this build holds no raw physiological history to erase. Promising deletion
  // here would put the overclaim on the one page that must be exactly true.
  for (const [locale, block] of Object.entries(messages)) {
    const text = Object.values(block).join(" ").toLowerCase();
    for (const phrase of FORBIDDEN_PROMISES) {
      assert.ok(
        !text.includes(phrase),
        `${locale}.json promises "${phrase}" on the transparency screen, which ` +
          `the running system does not do (see docs/DATA_RETENTION.md)`,
      );
    }
  }
});

test("the screen never shows the person a score or a band", () => {
  // Principle 5, applied to the page most tempted to explain the system: an
  // explanation of how scoring works must not become a place the score appears.
  for (const [locale, block] of Object.entries(messages)) {
    const text = Object.values(block).join(" ").toLowerCase();
    for (const term of ["score", "band", "risk", "diagnosis", "स्कोर", "जोखिम"]) {
      assert.ok(!text.includes(term), `${locale}.json uses "${term}"`);
    }
  }
});

test("the signpost guard can actually fire", () => {
  // Proving the matcher works, because the version above it originally used a
  // plain template literal and could never match anything while reporting PASS.
  const matches = (word: string, text: string) =>
    new RegExp(String.raw`\b` + word + String.raw`\b`).test(text);

  assert.ok(matches("never", "your words never leave"), "the matcher does not fire");
  assert.ok(!matches("never", "nevertheless"), "the matcher ignores word boundaries");
  assert.ok(BEHAVIOURAL_WORDS.includes("never"));
});

test("the guard would catch an unbacked claim", () => {
  // A test that cannot fail is not a test.
  const backed = new Set(CLAIMS.map((c) => c.id));
  assert.ok(!backed.has("weNeverLookAtAnything"));
  assert.ok(
    FORBIDDEN_PROMISES.some((phrase) =>
      "we delete everything the moment you ask".includes(phrase),
    ),
    "the erasure guard would not catch an obvious deletion promise",
  );
});
