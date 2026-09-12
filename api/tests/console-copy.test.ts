// The Welfare Console's copy, checked the way the Companion's message files are.
//
// Two properties matter here and neither is about style:
//
//   1. Every string exists in both languages. A half-translated console is
//      worse than an untranslated one — an officer reading Hindi hits an
//      English sentence exactly where the copy got harder, which is usually
//      where it matters most.
//   2. No string makes a diagnostic claim. The console may say "band" and
//      "indicator", because triage is the officer's job and hiding the
//      vocabulary from the person doing the work helps nobody. What it may
//      never do is diagnose.
//
// The required disclaimer is the exception that proves the second rule: it
// contains the word "diagnosis" precisely in order to deny one. Denials are
// allowlisted BY KEY rather than by pattern-matching for a negation, because
// "not a diagnosis" and "a diagnosis" are one dropped word apart and a regex
// that tries to tell them apart will eventually get it wrong in the permissive
// direction.

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  CONSOLE_LOCALES,
  CONSOLE_MESSAGES,
  translator,
  type ConsoleKey,
} from "../src/content/console.ts";

/** Diagnostic language. "band" and "indicator" are deliberately absent. */
const DENIED = [
  "diagnos",
  "depress",
  "anxiet",
  "anxious",
  "patient",
  "disorder",
  "symptom",
  "mental illness",
  "therapy",
  "treatment",
  "suicid",
  // Hindi
  "निदान",
  "अवसाद",
  "डिप्रेशन",
  "मरीज़",
  "रोगी",
  "विकार",
  "लक्षण",
  "मानसिक रोग",
  "इलाज",
];

/**
 * Keys allowed to name a clinical term in order to DENY it.
 *
 * Kept short on purpose. If this list grows, the question to ask is whether the
 * console has started explaining what it is not instead of saying what it does.
 */
const DISCLAIMERS: ConsoleKey[] = ["loginDisclaimer", "recordDisclaimer"];

function offending(text: string): string[] {
  const lower = text.toLowerCase();
  return DENIED.filter((term) => lower.includes(term));
}

test("every key exists in both languages", () => {
  const [first, ...rest] = CONSOLE_LOCALES;
  const reference = Object.keys(CONSOLE_MESSAGES[first]).sort();
  for (const locale of rest) {
    assert.deepEqual(
      Object.keys(CONSOLE_MESSAGES[locale]).sort(),
      reference,
      `${locale} does not have the same keys as ${first}`,
    );
  }
});

test("no string is empty or left as a placeholder", () => {
  for (const locale of CONSOLE_LOCALES) {
    for (const [key, text] of Object.entries(CONSOLE_MESSAGES[locale])) {
      assert.ok(text.trim().length > 0, `${locale}.${key} is empty`);
      assert.ok(!/^TODO|^TBD/i.test(text.trim()), `${locale}.${key} is a placeholder`);
    }
  }
});

test("the Hindi copy is translated, not copied", () => {
  // A key whose Hindi is byte-identical to its English has almost certainly
  // been pasted rather than translated. Short labels legitimately collide, so
  // this only looks at strings long enough to be a sentence.
  const copied: string[] = [];
  for (const [key, english] of Object.entries(CONSOLE_MESSAGES.en)) {
    if (english.length < 40) continue;
    if (CONSOLE_MESSAGES.hi[key as ConsoleKey] === english) copied.push(key);
  }
  assert.deepEqual(copied, [], `left in English: ${copied.join(", ")}`);
});

test("no string makes a diagnostic claim", () => {
  for (const locale of CONSOLE_LOCALES) {
    for (const [key, text] of Object.entries(CONSOLE_MESSAGES[locale])) {
      if (DISCLAIMERS.includes(key as ConsoleKey)) continue;
      const found = offending(text);
      assert.equal(
        found.length,
        0,
        `${locale}.${key} uses ${found.join(", ")}: ${JSON.stringify(text)}`,
      );
    }
  }
});

test("the disclaimers deny a diagnosis rather than making one", () => {
  // They are exempt from the scan, so they get their own assertion instead of
  // being trusted.
  assert.match(CONSOLE_MESSAGES.en.recordDisclaimer, /not a diagnosis/i);
  assert.match(CONSOLE_MESSAGES.en.loginDisclaimer, /not a clinical assessment/i);
  assert.match(CONSOLE_MESSAGES.hi.recordDisclaimer, /निदान नहीं/);
  assert.match(CONSOLE_MESSAGES.hi.loginDisclaimer, /नहीं/);
});

test("placeholders match across languages", () => {
  // A translation that drops {k} renders a sentence with a hole in it, and a
  // translation that invents {n} renders the brace. Both are silent.
  const names = (text: string) =>
    [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

  for (const [key, english] of Object.entries(CONSOLE_MESSAGES.en)) {
    assert.deepEqual(
      names(CONSOLE_MESSAGES.hi[key as ConsoleKey]),
      names(english),
      `${key}: Hindi placeholders differ from English`,
    );
  }
});

test("substitution fills every placeholder it is given", () => {
  const t = translator("en");
  const filled = t("cohortWithheldBody", { k: 10 });
  assert.ok(filled.includes("10"));
  assert.ok(!filled.includes("{k}"), "a placeholder survived substitution");
});

test("an unknown locale falls back to English rather than to the key name", () => {
  // An officer seeing "cohortWithheldBody" learns nothing. Seeing the English
  // sentence learns everything except which language it is in.
  const t = translator("hi");
  assert.notEqual(t("cohortTitle"), "cohortTitle");
  assert.equal(t("cohortTitle"), CONSOLE_MESSAGES.hi.cohortTitle);
});

test("the guard would actually catch something", () => {
  assert.deepEqual(offending("Shows signs of depression"), ["depress"]);
  assert.deepEqual(offending("रोगी की जाँच"), ["रोगी"]);
  assert.deepEqual(offending("Priority review band, elevated indicator"), []);
});
