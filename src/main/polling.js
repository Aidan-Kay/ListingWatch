"use strict";

const ebay = require("./ebay/ebay");
const vinted = require("./vinted/vinted");

// ─── Constants ────────────────────────────────────────────────────────────────
const FEED_MAX_SIZE = 500;

/**
 * @typedef {Object} PollState
 * @property {Map<string, ReturnType<typeof setTimeout>>} timers
 * @property {Set<string>} seenIds
 * @property {Object<string, boolean>} initialised
 */

/**
 * Compute a random poll delay for a search, respecting per-search overrides.
 * @param {Object} search
 * @param {Object} settings
 * @returns {number} delay in milliseconds
 */
function randomInterval(search, settings) {
  const globalMin = (settings.minInterval || 30) * 1000;
  const globalMax = (settings.maxInterval || 120) * 1000;
  const min = search && search.minInterval ? search.minInterval * 1000 : globalMin;
  const max = search && search.maxInterval ? search.maxInterval * 1000 : globalMax;
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * Prepend items to the feed, capping at FEED_MAX_SIZE.
 */
function pushToFeed(state, items) {
  state.feed.unshift(...items);
  if (state.feed.length > FEED_MAX_SIZE) state.feed.splice(FEED_MAX_SIZE);
}

/**
 * Fetch new listings for a single search and update shared state.
 *
 * @param {Object}   search
 * @param {Object}   state      - { searches, feed, seenIds, initialised }
 * @param {Function} onNewItems - callback(newItems, isInit) after processing
 * @param {Function} onStatus   - callback(searchId, statusPatch)
 * @param {Object}   settings
 */
async function fetchSearch(search, state, onNewItems, onStatus, settings) {
  try {
    const items = search.source === "vinted" ? await vinted.search(search) : await ebay.search(search);

    const isInit = !state.initialised[search.id];
    // Per-search seen-ID set: O(1) lookup/add, O(1) delete when search is removed.
    const searchSeenIds = (state.seenIds[search.id] ??= new Set());
    const newItems = [];

    for (const item of items) {
      if (!searchSeenIds.has(item.itemId)) {
        searchSeenIds.add(item.itemId);
        newItems.push(item);
      }
    }

    // Reset consecutive-error counter on any successful fetch.
    if (search._errorCount) search._errorCount = 0;

    if (isInit) {
      state.initialised[search.id] = true;
      const initialCount = search.initialCount > 0 ? Math.min(search.initialCount, newItems.length) : 0;
      if (initialCount > 0) {
        const initialItems = newItems.slice(0, initialCount);
        pushToFeed(state, initialItems);
        onNewItems(initialItems, true);
        console.log(`[${search.source}] [${search.name}] Initialised - ${items.length} listing(s) seen, ${initialCount} added to feed`);
      } else {
        console.log(`[${search.source}] [${search.name}] Initialised - ${items.length} listing(s) seen, none added to feed`);
      }
      onStatus(search.id, { lastFetched: new Date().toISOString(), error: null });
    } else if (newItems.length > 0) {
      console.log(`[${search.source}] [${search.name}] Found ${newItems.length} new listing(s)`);
      pushToFeed(state, newItems);
      onNewItems(newItems, false);
      onStatus(search.id, { lastFetched: new Date().toISOString(), newCount: newItems.length, error: null });
    } else {
      onStatus(search.id, { lastFetched: new Date().toISOString(), error: null });
    }
  } catch (err) {
    console.error(`[${search.source}] [${search.name}] Fetch error:`, err.message);
    // Increment error counter so scheduleNext can apply exponential backoff.
    search._errorCount = (search._errorCount || 0) + 1;
    onStatus(search.id, { error: err.message });
  }
}

/**
 * Schedule repeating fetches for a search. Performs an immediate fetch, then
 * queues the next one after a random interval.
 *
 * @param {Object}   search
 * @param {Object}   state    - { searches, timers, feed, seenIds, initialised }
 * @param {Function} onNewItems
 * @param {Function} onStatus
 * @param {Function} getSettings - () => settings (read latest at schedule time)
 */
function scheduleSearch(search, state, onNewItems, onStatus, getSettings) {
  if (!search.enabled) return;

  fetchSearch(search, state, onNewItems, onStatus, getSettings()).then(() => {
    function scheduleNext() {
      const current = state.searches.find((s) => s.id === search.id);
      if (!current || !current.enabled) return;
      // Exponential back-off when consecutive errors accumulate (max 16× normal interval).
      const errorCount = current._errorCount || 0;
      const backoffMultiplier = Math.min(Math.pow(2, errorCount), 16);
      const delay = randomInterval(current, getSettings()) * backoffMultiplier;
      if (errorCount > 0) {
        console.warn(
          `[${current.source}] [${current.name}] ${errorCount} consecutive error(s) — backing off. Next fetch in ${Math.round(delay / 1000)}s`,
        );
      } else {
        console.log(`[${current.source}] [${current.name}] Next fetch in ${Math.round(delay / 1000)}s`);
      }
      state.timers[search.id] = setTimeout(async () => {
        const latest = state.searches.find((s) => s.id === search.id);
        if (latest && latest.enabled) {
          await fetchSearch(latest, state, onNewItems, onStatus, getSettings());
          scheduleNext();
        }
      }, delay);
    }
    scheduleNext();
  });
}

/**
 * Stop polling for a single search.
 * @param {string} searchId
 * @param {Object} state - { timers, initialised }
 */
function stopSearch(searchId, state) {
  if (state.timers[searchId]) {
    clearTimeout(state.timers[searchId]);
    delete state.timers[searchId];
  }
  delete state.initialised[searchId];
}

/**
 * Stop all active pollers.
 * @param {Object} state - { timers }
 */
function stopAllSearches(state) {
  for (const id of Object.keys(state.timers)) {
    clearTimeout(state.timers[id]);
    delete state.timers[id];
  }
}

/**
 * Start polling for all enabled searches.
 * @param {Object}   state
 * @param {Function} onNewItems
 * @param {Function} onStatus
 * @param {Function} getSettings
 */
function startAllSearches(state, onNewItems, onStatus, getSettings) {
  for (const search of state.searches) {
    if (search.enabled) {
      scheduleSearch(search, state, onNewItems, onStatus, getSettings);
    }
  }
}

module.exports = {
  FEED_MAX_SIZE,
  randomInterval,
  fetchSearch,
  scheduleSearch,
  stopSearch,
  stopAllSearches,
  startAllSearches,
};
