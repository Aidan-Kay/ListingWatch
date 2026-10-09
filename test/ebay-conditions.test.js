"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { EBAY_CONDITIONS, EBAY_LEGACY_CONDITION_IDS, toEbayConditionIds } = require("../src/shared/constants");

test("numeric IDs pass through unchanged", () => {
  assert.deepEqual(toEbayConditionIds(["1000", "3000"]), ["1000", "3000"]);
});

test("legacy condition names are mapped to numeric IDs", () => {
  assert.deepEqual(toEbayConditionIds(["NEW", "USED"]), ["1000", "3000"]);
  assert.deepEqual(toEbayConditionIds(["FOR_PARTS_OR_NOT_WORKING"]), ["7000"]);
});

test("every legacy name maps to a condition the dropdown can show", () => {
  const known = new Set(EBAY_CONDITIONS.map((c) => c.id));
  for (const [name, id] of Object.entries(EBAY_LEGACY_CONDITION_IDS)) {
    assert.ok(known.has(id), `${name} maps to ${id}, which is not in EBAY_CONDITIONS`);
  }
});

test("LIKE_NEW and NEW_OTHER collapse onto one ID without duplicating it", () => {
  assert.deepEqual(toEbayConditionIds(["LIKE_NEW", "NEW_OTHER"]), ["1500"]);
});

test("duplicates are removed and order is preserved", () => {
  assert.deepEqual(toEbayConditionIds(["3000", "1000", "3000"]), ["3000", "1000"]);
});

test("legacy single-digit URL codes are translated, not passed through", () => {
  // A real saved search held ["3", "NEW"] after a URL import — "3" is eBay's old
  // group code for Used, not a condition ID. Sent as-is it would poison the
  // whole conditionIds filter.
  assert.deepEqual(toEbayConditionIds(["3", "NEW"]), ["3000", "1000"]);
  assert.deepEqual(toEbayConditionIds(["1"]), ["1000"]);
});

test("ambiguous short codes are dropped rather than guessed at", () => {
  assert.deepEqual(toEbayConditionIds(["2", "4", "11"]), []);
});

test("four-digit IDs the static list has never seen still survive", () => {
  // The per-category lookup can return conditions this file does not enumerate;
  // dropping them would lose the selection on the next save/reload.
  assert.deepEqual(toEbayConditionIds(["2750"]), ["2750"]);
});

test("unrecognised values are dropped rather than passed through", () => {
  // eBay ignores a malformed conditionIds filter wholesale, which would widen
  // the search instead of narrowing it — so junk must never reach the query.
  assert.deepEqual(toEbayConditionIds(["BANANA", "1000"]), ["1000"]);
  assert.deepEqual(toEbayConditionIds(["USED_EXCELLENT"]), []);
});

test("empty, blank, and non-array inputs yield no filter", () => {
  assert.deepEqual(toEbayConditionIds([]), []);
  assert.deepEqual(toEbayConditionIds(["", "  ", null, undefined]), []);
  assert.deepEqual(toEbayConditionIds(undefined), []);
  assert.deepEqual(toEbayConditionIds(null), []);
  assert.deepEqual(toEbayConditionIds("1000"), []);
});

test("names are matched case-insensitively and trimmed", () => {
  assert.deepEqual(toEbayConditionIds([" new ", "used"]), ["1000", "3000"]);
});

test("numeric values are accepted as numbers, not just strings", () => {
  assert.deepEqual(toEbayConditionIds([1000, 3000]), ["1000", "3000"]);
});
