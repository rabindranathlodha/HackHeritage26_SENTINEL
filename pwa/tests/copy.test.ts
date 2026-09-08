// The clinical-claims boundary, applied to everything the person can read
// (PWA spec 9, mirroring backend spec 10).
//
// The backend enforces this on API responses. Nothing enforced it on the UI,
// which is the surface the person actually reads — a compliant API rendered
// under the heading "Your risk score" would satisfy every backend test and
// break the principle completely.
//
// Run with: npm test

import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const ROOT = join(import.meta.dirname, "..");

// Spec 9's list. "risk" and "score" are included even though they are ordinary
// English words: this app must never put either in front of the person, and a
// false positive here is cheap to reword.
const FORBIDDEN_EN = [
  "diagnosis",
  "diagnose",
  "depression",
  "depressed",
  "anxiety",
  "anxious",
  "risk",
  "score",
  "patient",
  "disorder",
  "symptom",
  "mental illness",
  "therapy",
  "treatment",
];

// The same boundary in Hindi. Without these, the guard is bypassed by
// translating — the English file stays clean while the Hindi one says
// "जोखिम स्कोर" and every test still passes.
const FORBIDDEN_HI = [
  "निदान", // diagnosis
  "अवसाद", // depression
  "डिप्रेशन", // depression, transliterated
  "चिंता रोग", // anxiety disorder
  "जोखिम", // risk
  "स्कोर", // score
  "मरीज़", // patient
  "मरीज", // patient, without the nuqta
  "रोगी", // patient
  "विकार", // disorder
  "लक्षण", // symptom
  "मानसिक रोग", // mental illness
  "मानसिक बीमारी", // mental illness
  "इलाज", // treatment
];

/** Every string value in a nested object, with the path that reached it. */
function* strings(value: unknown, path: string[] = []): Generator<[string, string]> {
  if (typeof value === "string") {
    yield [path.join("."), value];
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      yield* strings(child, [...path, key]);
    }
  }
}

function offendingTerms(text: string): string[] {
  const lower = text.toLowerCase();
  const found: string[] = [];
  for (const term of FORBIDDEN_EN) {
    // Word boundaries: "score" must fail, "underscore" must not, and "risk"
    // must fail without also failing "brisk".
    if (new RegExp(`\\b${term}\\b`).test(lower)) found.push(term);
  }
  for (const term of FORBIDDEN_HI) {
    // Devanagari has no \b that JavaScript recognises, so match the substring.
    if (text.includes(term)) found.push(term);
  }
  return found;
}

const messageFiles = readdirSync(join(ROOT, "messages")).filter((f) =>
  f.endsWith(".json"),
);

test("there is a message file for every supported locale", () => {
  const locale = readFileSync(join(ROOT, "src/i18n/locale.ts"), "utf8");
  const declared = [...locale.matchAll(/"(\w{2})"/g)]
    .map((m) => m[1])
    .filter((code) => code === "en" || code === "hi");
  assert.ok(declared.length >= 2, "expected en and hi to be declared");
  for (const code of new Set(declared)) {
    assert.ok(
      messageFiles.includes(`${code}.json`),
      `messages/${code}.json is missing`,
    );
  }
});

test("no message file renders a clinical term to the person", () => {
  for (const file of messageFiles) {
    const parsed = JSON.parse(readFileSync(join(ROOT, "messages", file), "utf8"));
    for (const [path, value] of strings(parsed)) {
      const found = offendingTerms(value);
      assert.equal(
        found.length,
        0,
        `${file} → ${path} uses ${found.join(", ")}: ${JSON.stringify(value)}`,
      );
    }
  }
});

test("the questionnaire uses no clinical term in any language", () => {
  const source = readFileSync(join(ROOT, "src/content/questionnaire.ts"), "utf8");
  // Only the quoted item text, not the surrounding commentary — the file
  // explains WHY it avoids "depressed", and that explanation must be allowed
  // to name the word it is avoiding.
  const quoted = [...source.matchAll(/^\s+(?:en|hi):\s*"([^"]+)"/gm)].map((m) => m[1]);
  assert.ok(quoted.length >= 18, `expected 9 items in 2 languages, found ${quoted.length}`);

  for (const text of quoted) {
    const found = offendingTerms(text);
    assert.equal(found.length, 0, `questionnaire item uses ${found.join(", ")}: ${text}`);
  }
});

test("the guard would actually catch something", () => {
  // A test that can only pass is not a test. If the matcher breaks, this fails
  // before the real checks start reporting false confidence.
  assert.deepEqual(offendingTerms("Your risk score today"), ["risk", "score"]);
  assert.deepEqual(offendingTerms("आपका जोखिम स्कोर"), ["जोखिम", "स्कोर"]);
  assert.deepEqual(offendingTerms("underscore the brisk walk"), []);
});

test("every message key exists in every language", () => {
  const keysOf = (file: string) =>
    new Set(
      [...strings(JSON.parse(readFileSync(join(ROOT, "messages", file), "utf8")))].map(
        ([path]) => path,
      ),
    );

  const [first, ...rest] = messageFiles;
  const reference = keysOf(first);
  for (const file of rest) {
    const keys = keysOf(file);
    const missing = [...reference].filter((k) => !keys.has(k));
    const extra = [...keys].filter((k) => !reference.has(k));
    assert.deepEqual(
      { missing, extra },
      { missing: [], extra: [] },
      `${file} does not match ${first}`,
    );
  }
});

test("every questionnaire item is written in both languages", () => {
  const source = readFileSync(join(ROOT, "src/content/questionnaire.ts"), "utf8");
  const items = [...source.matchAll(/id:\s*"([^"]+)"/g)].map((m) => m[1]);
  const en = [...source.matchAll(/^\s+en:\s*"([^"]+)"/gm)].length;
  const hi = [...source.matchAll(/^\s+hi:\s*"([^"]+)"/gm)].length;

  assert.ok(items.length >= 8 && items.length <= 10, `spec 4.3 asks for 8-10 items, found ${items.length}`);
  assert.equal(en, items.length, "an item is missing its English text");
  assert.equal(hi, items.length, "an item is missing its Hindi text");
  assert.equal(new Set(items).size, items.length, "item ids must be unique");
});
