"use strict";

// Minimum spacing between outbound requests to the same marketplace.
//
// Every enabled search fetches immediately when polling starts, so a profile
// with a dozen eBay searches fired a dozen requests in one tick — on app start,
// on Resume All, and after an import. The randomised poll interval only spreads
// out *subsequent* rounds; the first one always arrived as a burst, which is
// both the least neighbourly moment and the one most likely to trip a rate
// limit. Steady-state polls collide too, just less often.
//
// A caller awaits a slot before its request. Slots are handed out per source in
// the order they were asked for, each at least the source's gap after the one
// before it, so a burst is smeared over a few seconds. This is a spacer, not a
// quota — nothing is ever dropped, only delayed. The eBay daily call budget is
// tracked separately in ebay.js.
//
// Only the polling path goes through here. Interactive calls (opening a listing
// to load its images) stay immediate: queueing those behind a poll would put a
// visible delay on a click to solve a problem clicks don't cause.
//
// Pure module: no Electron dependencies, so it can be exercised standalone.

// Per-source minimum gap. Values are deliberately conservative — the cost of
// being wrong is a slightly later listing, and polls run on a 30s+ interval.
const MIN_GAP_MS = Object.freeze({
  // Browse API is a metered REST endpoint that tolerates bursts; the gap is
  // about not stacking the whole profile into one instant.
  ebay: 1_000,
  // Vinted is driven through a real browser session with no published limit, and
  // a page load is heavier than an API call — so give it more room.
  vinted: 3_000,
});

const DEFAULT_GAP_MS = 1_000;

// source -> epoch ms from which the next slot may start.
const _nextSlot = new Map();

/**
 * Wait until this source's next slot is free, reserving it for the caller.
 *
 * The reservation is made synchronously, before any await: two callers landing
 * in the same tick must not both read the same free slot and then both take it.
 *
 * @param {string} source - marketplace id ("ebay", "vinted")
 * @param {() => number} [now] - clock, injectable for tests
 * @returns {Promise<number>} how long the caller was held, in ms
 */
async function acquireSlot(source, now = Date.now) {
  const gap = Object.prototype.hasOwnProperty.call(MIN_GAP_MS, source) ? MIN_GAP_MS[source] : DEFAULT_GAP_MS;
  const t = now();
  const startAt = Math.max(t, _nextSlot.get(source) || 0);
  _nextSlot.set(source, startAt + gap);

  const wait = startAt - t;
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  return wait;
}

/**
 * Forget all outstanding reservations.
 *
 * Called when polling stops wholesale: those slots were booked for fetches that
 * are about to be abandoned, and leaving them on the books would make a Resume
 * All sit out the queue of a session that no longer exists. Callers already
 * waiting keep their timers — they abort on the generation check instead.
 */
function resetSlots() {
  _nextSlot.clear();
}

module.exports = { MIN_GAP_MS, DEFAULT_GAP_MS, acquireSlot, resetSlots };
