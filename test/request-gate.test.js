"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { MIN_GAP_MS, DEFAULT_GAP_MS, acquireSlot, resetSlots } = require("../src/main/shared/request-gate");

/**
 * A clock that never advances, so acquireSlot's reported wait is the full
 * spacing rather than whatever real time elapsed between calls.
 */
const frozenClock = (at) => () => at;

test("the first caller for a source is not held", async () => {
  resetSlots();
  assert.equal(await acquireSlot("ebay", frozenClock(1_000)), 0);
});

test("subsequent callers are spaced by the source's gap", async () => {
  resetSlots();
  const now = frozenClock(1_000);
  await acquireSlot("ebay", now);
  assert.equal(await acquireSlot("ebay", now), MIN_GAP_MS.ebay);
  assert.equal(await acquireSlot("ebay", now), MIN_GAP_MS.ebay * 2);
});

test("each source keeps its own books", async () => {
  resetSlots();
  const now = frozenClock(1_000);
  await acquireSlot("ebay", now);
  await acquireSlot("ebay", now);
  // Vinted has not been asked yet, so it starts immediately despite eBay's queue.
  assert.equal(await acquireSlot("vinted", now), 0);
  assert.equal(await acquireSlot("vinted", now), MIN_GAP_MS.vinted);
});

test("an unknown source gets the default gap", async () => {
  resetSlots();
  const now = frozenClock(1_000);
  await acquireSlot("etsy", now);
  assert.equal(await acquireSlot("etsy", now), DEFAULT_GAP_MS);
});

test("a source named after an Object.prototype key does not inherit one", async () => {
  resetSlots();
  const now = frozenClock(1_000);
  await acquireSlot("constructor", now);
  assert.equal(await acquireSlot("constructor", now), DEFAULT_GAP_MS);
});

test("the reservation happens before the await, so a tick's callers cannot collide", async () => {
  resetSlots();
  const now = frozenClock(1_000);
  // Started together, without awaiting in between — each must still get its own
  // slot rather than all reading the same free one.
  const waits = await Promise.all([acquireSlot("ebay", now), acquireSlot("ebay", now), acquireSlot("ebay", now)]);
  assert.deepEqual(waits, [0, MIN_GAP_MS.ebay, MIN_GAP_MS.ebay * 2]);
});

test("time passing frees the queue rather than accumulating debt", async () => {
  resetSlots();
  await acquireSlot("ebay", frozenClock(1_000));
  // Far enough into the future that the previous reservation has long expired.
  assert.equal(await acquireSlot("ebay", frozenClock(1_000 + MIN_GAP_MS.ebay * 10)), 0);
});

test("resetSlots clears the books", async () => {
  resetSlots();
  const now = frozenClock(1_000);
  await acquireSlot("ebay", now);
  await acquireSlot("ebay", now);
  resetSlots();
  assert.equal(await acquireSlot("ebay", now), 0);
});
