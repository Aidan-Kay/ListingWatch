"use strict";

const { getAdapter } = require("./shared/marketplace-adapters");
const { isNoInternetError } = require("./shared/retry");
const { SEEN_IDS_MAX_SIZE } = require("./shared/constants");
const { compileLists, countTerms, matchTitle } = require("./shared/keyword-match");

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
  // Hard floor: never poll faster than every 30 seconds, even with corrupted settings.
  const safeMin = Math.max(min, 30_000);
  const safeMax = Math.max(max, safeMin);
  return Math.floor(Math.random() * (safeMax - safeMin + 1)) + safeMin;
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
 * Split items against the feed: those already present have their `searchIds`
 * extended in place (cross-search duplicate merge), and the rest are returned
 * as genuinely new. Both the init and steady-state paths use this so a search
 * whose seen-IDs were reset cannot re-add cards already on screen.
 *
 * @returns {Object[]} items not already in the feed
 */
function dedupeAgainstFeed(state, items, search) {
  const trulyNew = [];
  for (const item of items) {
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
  return trulyNew;
}

/**
 * Apply the search's keyword include-lists, tagging each surviving item with
 * the terms it matched. A search with no lists — or whose lists resolve to no
 * usable terms — is passed through unfiltered rather than matching nothing.
 */
function applyIncludeLists(items, search, state) {
  const compiled = compileLists(search.includeLists, state.keywordLists);
  if (countTerms(compiled) === 0) return items;

  const kept = [];
  for (const item of items) {
    const matched = matchTitle(item.title, compiled);
    if (matched.length > 0) {
      item.matchedTerms = matched;
      kept.push(item);
    }
  }
  return kept;
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
  // Capture the generation that owns this fetch. If a save/delete supersedes
  // the search before we resolve, we abort instead of writing stale state.
  const fetchGen = search._generation || 0;
  const isCurrent = () => {
    const live = state.searches.find((s) => s.id === search.id);
    return !!live && (live._generation || 0) === fetchGen;
  };

  try {
    const adapter = getAdapter(search.source);
    const items = await adapter.search(search);

    if (!isCurrent()) {
      // Search was deleted or replaced while the network call was in flight.
      return;
    }

    // Client-side filtering, applied in order:
    //   1. include-lists — keep only titles matching an attached keyword list
    //      (used by keyword-less category searches that pull a whole feed)
    //   2. exclude-keywords — drop titles containing an excluded word/phrase
    const includedItems = applyIncludeLists(items, search, state);

    const excludeKeywords = Array.isArray(search.excludeKeywords) ? search.excludeKeywords : [];
    const filteredItems =
      excludeKeywords.length > 0
        ? includedItems.filter((item) => {
            const title = (item.title || "").toLowerCase();
            return !excludeKeywords.some((kw) => title.includes(kw));
          })
        : includedItems;

    const isInit = !state.initialised[search.id];
    // Per-search seen-ID set: O(1) lookup/add, O(1) delete when search is removed.
    const searchSeenIds = (state.seenIds[search.id] ??= new Set());

    // Collect IDs of all raw items (including filtered-out ones) so we can mark
    // them as seen without re-announcing them if the filters are later changed.
    const previouslySeen = new Set(searchSeenIds);

    // Mark every returned item as seen (filtered out or not).
    for (const item of items) {
      searchSeenIds.add(item.itemId);
    }

    // Only items that passed the filters AND weren't previously seen are new.
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

    // Filtering summary for the logs — the main signal for whether an
    // include-list is doing what the user expects.
    const filterNote = filteredItems.length !== items.length ? `, ${filteredItems.length} matched` : "";

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
        initialItems = dedupeAgainstFeed(state, initialItems, search);
      }
      if (initialItems.length > 0) {
        pushToFeed(state, initialItems);
        onNewItems(initialItems, true);
        console.log(
          `[${search.source}] [${search.name}] Initialised - ${items.length} listing(s) seen${filterNote}, ${initialItems.length} from last ${showHours}h added to feed`,
        );
      } else {
        console.log(`[${search.source}] [${search.name}] Initialised - ${items.length} listing(s) seen${filterNote}, none added to feed`);
      }
      onStatus(search.id, { lastFetched: new Date().toISOString(), error: null });
    } else if (newItems.length > 0) {
      // Cross-search duplicate detection: items already in the feed from a different
      // search are merged (their searchIds extended) rather than re-announced.
      const trulyNew = dedupeAgainstFeed(state, newItems, search);
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
    if (!isCurrent()) return;
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

  // Bump the generation token so any in-flight fetch from a superseded
  // schedule (e.g. previous start before a config change) cannot mutate
  // state when it eventually resolves.
  search._generation = (search._generation || 0) + 1;

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
  // Bump generation so any in-flight fetch becomes a no-op when it resolves.
  const search = state.searches.find((s) => s.id === searchId);
  if (search) search._generation = (search._generation || 0) + 1;
}

/**
 * Stop all active pollers.
 * @param {Object} state - { timers, searches }
 */
function stopAllSearches(state) {
  for (const id of Object.keys(state.timers)) {
    clearTimeout(state.timers[id]);
    delete state.timers[id];
  }
  // Mirror stopSearch — bump generation on every search so in-flight fetches
  // become no-ops. Also clear `initialised` so resume re-runs init logic.
  for (const s of state.searches) {
    s._generation = (s._generation || 0) + 1;
  }
  state.initialised = {};
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
