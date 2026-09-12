// The clinical-claims guard, pointed at the one surface that reaches a person
// without them opening the app.
//
// The general copy guard runs over the PWA's message files. Notification text
// is built server-side and never passes through them, so without this it would
// be the one string in the product nothing checks — and it is the string most
// likely to be read by somebody other than its recipient.

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  NOTIFICATION_DENYLIST,
  REMINDER_COPY,
  offendingTerms,
  reminderCopy,
} from "../src/content/notifications.ts";

test("no notification string uses a forbidden term", () => {
  for (const [locale, copy] of Object.entries(REMINDER_COPY)) {
    for (const [field, text] of Object.entries(copy)) {
      const found = offendingTerms(text);
      assert.equal(
        found.length,
        0,
        `${locale}.${field} uses ${found.join(", ")}: ${JSON.stringify(text)}`,
      );
    }
  }
});

test("the title is the app's neutral name, not the product's", () => {
  // Someone glancing at this person's phone must not see a monitoring product
  // named. The home-screen name is already "Companion"; a notification that
  // says "SENTINEL" undoes that in the one place it matters most.
  for (const copy of Object.values(REMINDER_COPY)) {
    assert.ok(!/sentinel/i.test(copy.title), `title reveals the product: ${copy.title}`);
  }
});

test("every supported language has copy, and it is not the English fallback", () => {
  assert.ok(REMINDER_COPY.en.body.length > 0);
  assert.ok(REMINDER_COPY.hi.body.length > 0);
  assert.notEqual(
    REMINDER_COPY.hi.body,
    REMINDER_COPY.en.body,
    "Hindi copy is missing and falling through to English",
  );
});

test("an unknown or absent locale falls back to English rather than throwing", () => {
  assert.equal(reminderCopy(undefined).body, REMINDER_COPY.en.body);
  assert.equal(reminderCopy(null).body, REMINDER_COPY.en.body);
  assert.equal(reminderCopy("ta").body, REMINDER_COPY.en.body);
  assert.equal(reminderCopy("hi").body, REMINDER_COPY.hi.body);
});

test("the copy carries no interpolation point", () => {
  // A template is where a name or a number gets added later. There is nothing
  // to substitute into, so making this notification personal would require
  // deliberately editing the file the guard watches.
  for (const copy of Object.values(REMINDER_COPY)) {
    for (const text of Object.values(copy)) {
      assert.ok(
        !/\{|\}|\$|%s/.test(text),
        `notification copy contains a placeholder: ${text}`,
      );
    }
  }
});

test("the guard would actually catch something", () => {
  // A test that can only pass is not a test.
  assert.deepEqual(offendingTerms("Your risk score is elevated"), ["risk", "score"]);
  assert.deepEqual(offendingTerms("आपका जोखिम बढ़ा है"), ["जोखिम"]);
  assert.deepEqual(
    offendingTerms("Your welfare officer would like to talk"),
    ["welfare", "officer"],
  );
  assert.deepEqual(offendingTerms("Time for your weekly check-in."), []);
  assert.ok(NOTIFICATION_DENYLIST.includes("welfare"));
});
