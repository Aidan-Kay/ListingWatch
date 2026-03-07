"use strict";

const ebay = require("./ebay/ebay");
const vinted = require("./vinted/vinted");
const { SEEN_IDS_MAX_SIZE } = require("./shared/constants");

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
 * Maintains feedIndex for O(1) cross-search dedup lookups.
 */
function pushToFeed(state, items) {
  for (const item of items) {
    state.feedIndex.set(`${item.source}:${item.itemId}`, item);
  }
  state.feed.unshift(...items);
  if (state.feed.length > FEED_MAX_SIZE) {
    const removed = state.feed.splice(FEED_MAX_SIZE);
    for (const item of removed) {
      state.feedIndex.delete(`${item.source}:${item.itemId}`);
    }
  }
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

    // Client-side exclude-keyword filtering: drop any item whose title
    // contains one of the user's excluded words/phrases.
    const excludeKeywords = Array.isArray(search.excludeKeywords) ? search.excludeKeywords : [];
    const filteredItems =
      excludeKeywords.length > 0
        ? items.filter((item) => {
            const title = (item.title || "").toLowerCase();
            return !excludeKeywords.some((kw) => title.includes(kw));
          })
        : items;

    const isInit = !state.initialised[search.id];
    // Per-search seen-ID set: O(1) lookup/add, O(1) delete when search is removed.
    const searchSeenIds = (state.seenIds[search.id] ??= new Set());

    // Collect IDs of all raw items (including excluded) so we can mark them
    // as seen without re-announcing them if exclude keywords are later changed.
    const previouslySeen = new Set(searchSeenIds);

    // Mark every returned item as seen (excluded or not).
    for (const item of items) {
      searchSeenIds.add(item.itemId);
    }

    // Only items that passed the exclude filter AND weren't previously seen
    // are truly new.
    const newItems = filteredItems.filter((item) => !previouslySeen.has(item.itemId));
    // Initialise searchIds on all new items
    for (const item of newItems) {
      item.searchIds = [item.searchId];
    }

    // Prune seenIds to cap memory usage. V8 Sets preserve insertion order so
    // slicing from the end retains the most-recently-seen IDs.
    if (searchSeenIds.size > SEEN_IDS_MAX_SIZE) {
      const entries = [...searchSeenIds];
      state.seenIds[search.id] = new Set(entries.slice(entries.length - SEEN_IDS_MAX_SIZE));
      console.log(`[polling] [${search.name}] Pruned seenIds from ${entries.length} to ${SEEN_IDS_MAX_SIZE}`);
    }

    // Reset consecutive-error counter on any successful fetch.
    if (search._errorCount) search._errorCount = 0;

    if (isInit) {
      state.initialised[search.id] = true;
      const showHours = settings.showListingsFromHours || 0;
      let initialItems = [];
      if (showHours > 0) {
        const cutoff = Date.now() - showHours * 3600_000;
        initialItems = newItems.filter((item) => {
          const ts = item.listingDate || item.foundAt;
          return ts && new Date(ts).getTime() >= cutoff;
        });
      }
      if (initialItems.length > 0) {
        pushToFeed(state, initialItems);
        onNewItems(initialItems, true);
        const excludedCount = items.length - filteredItems.length;
        const excludedNote = excludedCount > 0 ? `, ${excludedCount} excluded` : "";
        console.log(
          `[${search.source}] [${search.name}] Initialised - ${items.length} listing(s) seen${excludedNote}, ${initialItems.length} from last ${showHours}h added to feed`,
        );
      } else {
        const excludedCount = items.length - filteredItems.length;
        const excludedNote = excludedCount > 0 ? `, ${excludedCount} excluded` : "";
        console.log(`[${search.source}] [${search.name}] Initialised - ${items.length} listing(s) seen${excludedNote}, none added to feed`);
      }
      onStatus(search.id, { lastFetched: new Date().toISOString(), error: null });
    } else if (newItems.length > 0) {
      // Cross-search duplicate detection: items already in the feed from a different
      // search are merged (their searchIds extended) rather than re-announced.
      const trulyNew = [];
      for (const item of newItems) {
        const canonical = `${item.source}:${item.itemId}`;
        const existing = state.feedIndex.get(canonical);
        if (existing) {
          if (!Array.isArray(existing.searchIds)) existing.searchIds = [existing.searchId];
          if (!existing.searchIds.includes(item.searchId)) {
            existing.searchIds.push(item.searchId);
            console.log(`[${search.source}] [${search.name}] Cross-search duplicate merged: ${item.itemId}`);
          }
        } else {
          trulyNew.push(item);
        }
      }
      if (trulyNew.length > 0) {
        console.log(`[${search.source}] [${search.name}] Found ${trulyNew.length} new listing(s)`);
        pushToFeed(state, trulyNew);
        onNewItems(trulyNew, false);
        onStatus(search.id, { lastFetched: new Date().toISOString(), newCount: trulyNew.length, error: null });
      } else {
        onStatus(search.id, { lastFetched: new Date().toISOString(), error: null });
      }
    } else {
      onStatus(search.id, { lastFetched: new Date().toISOString(), error: null });
    }
  } catch (err) {
    console.error(`[${search.source}] [${search.name}] Fetch error:`, err.message);
    // Only apply exponential backoff for non-connectivity errors.
    // No-internet errors (DNS failure, network unreachable) use normal intervals
    // so the app recovers quickly once connectivity is restored.
    if (!isNoInternetError(err)) {
      search._errorCount = (search._errorCount || 0) + 1;
    } else {
      console.warn(`[${search.source}] [${search.name}] No internet — will retry at normal interval (no backoff)`);
    }
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

/**
 * Determine whether an error indicates the machine has no internet connectivity.
 * These errors should not trigger exponential backoff — the app should retry at
 * normal intervals so it recovers quickly when connectivity is restored.
 */
function isNoInternetError(err) {
  if (
    err.code === "ENOTFOUND" ||
    err.code === "ENETUNREACH" ||
    err.code === "EAI_AGAIN" ||
    err.code === "ENETDOWN" ||
    err.code === "EHOSTUNREACH"
  ) {
    return true;
  }
  // Generic fetch failures when truly offline often surface as TypeError
  // with messages about network access.
  if (err.name === "TypeError" && /fetch failed|network/i.test(err.message)) {
    return true;
  }
  return false;
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
