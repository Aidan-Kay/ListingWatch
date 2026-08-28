"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { fetchSearch, stopSearch, stopAllSearches } = require("../src/main/polling");
const { resetSlots } = require("../src/main/shared/request-gate");
const { invalidateCompiled } = require("../src/shared/keyword-match");
const { SEEN_IDS_MAX_SIZE, FEED_MAX_SIZE } = require("../src/shared/constants");

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makeSearch(overrides = {}) {
  return {
    id: "search_1",
    name: "Test Search",
    source: "ebay",
    enabled: true,
    excludeKeywords: [],
    includeLists: [],
    ...overrides,
  };
}

function makeState(searches) {
  return {
    searches,
    keywordLists: [],
    feed: [],
    feedIndex: new Map(),
    seenIds: {},
    deliveredIds: {},
    initialised: {},
    timers: {},
  };
}

/** A listing as an adapter would hand it back. */
function makeItem(itemId, overrides = {}) {
  return {
    id: `ebay:${itemId}`,
    itemId,
    searchId: "search_1",
    searchName: "Test Search",
    source: "ebay",
    title: `Listing ${itemId}`,
    foundAt: new Date().toISOString(),
    listingDate: new Date().toISOString(),
    ...overrides,
  };
}

/** An adapter that returns a fixed page, and records how often it was asked. */
function fakeAdapter(pages) {
  let call = 0;
  return {
    calls: () => call,
    search: async () => {
      const page = pages[Math.min(call, pages.length - 1)];
      call++;
      return page.map((item) => ({ ...item }));
    },
  };
}

/** Collect the batches handed to onNewItems, and the last status per search. */
function recorder() {
  const batches = [];
  const statuses = [];
  return {
    batches,
    statuses,
    onNewItems: (items, isInit) => batches.push({ items, isInit }),
    onStatus: (searchId, patch) => statuses.push({ searchId, ...patch }),
  };
}

const SETTINGS = { showListingsFromHours: 0 };

/**
 * fetchSearch, without waiting out the per-marketplace spacing. The gate is
 * real and worth having, but it is covered by its own tests — paying its
 * seconds again here would only make this suite slow.
 */
function fetchNow(...args) {
  resetSlots();
  return fetchSearch(...args);
}

// ─── Init ─────────────────────────────────────────────────────────────────────

test("the first fetch seeds seenIds without announcing anything", async () => {
  const search = makeSearch();
  const state = makeState([search]);
  const rec = recorder();

  await fetchNow(search, state, rec.onNewItems, rec.onStatus, SETTINGS, fakeAdapter([[makeItem("a"), makeItem("b")]]));

  assert.deepEqual(rec.batches, [], "init with showListingsFromHours=0 shows nothing");
  assert.equal(state.initialised[search.id], true);
  assert.equal(state.seenIds[search.id].size, 2);
  assert.equal(state.feed.length, 0);
});

test("showListingsFromHours backfills recent listings on the first fetch", async () => {
  const search = makeSearch();
  const state = makeState([search]);
  const rec = recorder();
  const old = new Date(Date.now() - 5 * 3600_000).toISOString();

  await fetchNow(
    search,
    state,
    rec.onNewItems,
    rec.onStatus,
    { showListingsFromHours: 2 },
    fakeAdapter([[makeItem("recent"), makeItem("stale", { listingDate: old, foundAt: old })]]),
  );

  assert.equal(rec.batches.length, 1);
  assert.equal(rec.batches[0].isInit, true);
  assert.deepEqual(
    rec.batches[0].items.map((i) => i.itemId),
    ["recent"],
  );
});

// ─── Steady state ─────────────────────────────────────────────────────────────

test("only listings not previously seen are announced", async () => {
  const search = makeSearch();
  const state = makeState([search]);
  const rec = recorder();
  const adapter = fakeAdapter([[makeItem("a")], [makeItem("a"), makeItem("b")]]);

  await fetchNow(search, state, rec.onNewItems, rec.onStatus, SETTINGS, adapter);
  await fetchNow(search, state, rec.onNewItems, rec.onStatus, SETTINGS, adapter);

  assert.equal(rec.batches.length, 1);
  assert.deepEqual(
    rec.batches[0].items.map((i) => i.itemId),
    ["b"],
  );
  assert.equal(rec.batches[0].isInit, false);
});

// ─── MF-1 regression ──────────────────────────────────────────────────────────

test("listings found while a search is paused are still delivered on resume", async () => {
  const search = makeSearch();
  const state = makeState([search]);
  const rec = recorder();
  const adapter = fakeAdapter([[makeItem("a")], [makeItem("a"), makeItem("b")]]);

  await fetchNow(search, state, rec.onNewItems, rec.onStatus, SETTINGS, adapter);
  stopSearch(search.id, state);
  await fetchNow(search, state, rec.onNewItems, rec.onStatus, SETTINGS, adapter);

  assert.equal(rec.batches.length, 1, "the backlog must not be swallowed by a second init");
  assert.deepEqual(
    rec.batches[0].items.map((i) => i.itemId),
    ["b"],
  );
});

test("listings found during a Pause All are still delivered on resume", async () => {
  const search = makeSearch();
  const state = makeState([search]);
  const rec = recorder();
  const adapter = fakeAdapter([[makeItem("a")], [makeItem("a"), makeItem("b")]]);

  await fetchNow(search, state, rec.onNewItems, rec.onStatus, SETTINGS, adapter);
  stopAllSearches(state);
  await fetchNow(search, state, rec.onNewItems, rec.onStatus, SETTINGS, adapter);

  assert.equal(rec.batches.length, 1);
  assert.deepEqual(
    rec.batches[0].items.map((i) => i.itemId),
    ["b"],
  );
});

// ─── Filtering ────────────────────────────────────────────────────────────────

test("excludeKeywords drop matching titles but still mark them seen", async () => {
  const search = makeSearch({ excludeKeywords: ["broken"] });
  const state = makeState([search]);
  const rec = recorder();
  const adapter = fakeAdapter([
    [makeItem("init")],
    [makeItem("init"), makeItem("good", { title: "Mint condition" }), makeItem("bad", { title: "BROKEN for parts" })],
  ]);

  await fetchNow(search, state, rec.onNewItems, rec.onStatus, SETTINGS, adapter);
  await fetchNow(search, state, rec.onNewItems, rec.onStatus, SETTINGS, adapter);

  assert.deepEqual(
    rec.batches[0].items.map((i) => i.itemId),
    ["good"],
  );
  assert.ok(state.seenIds[search.id].has("bad"), "an excluded item is still seen, so it cannot resurface");
});

test("an include-list keeps only matching titles and tags them", async () => {
  const search = makeSearch({ includeLists: ["list_a"] });
  const state = makeState([search]);
  state.keywordLists = [{ id: "list_a", name: "Wanted", terms: ["zelda"], version: 1 }];
  invalidateCompiled("list_a");
  const rec = recorder();
  const adapter = fakeAdapter([
    [makeItem("init")],
    [makeItem("init"), makeItem("hit", { title: "Zelda Ocarina of Time" }), makeItem("miss", { title: "Mario Kart" })],
  ]);

  await fetchNow(search, state, rec.onNewItems, rec.onStatus, SETTINGS, adapter);
  await fetchNow(search, state, rec.onNewItems, rec.onStatus, SETTINGS, adapter);

  assert.deepEqual(
    rec.batches[0].items.map((i) => i.itemId),
    ["hit"],
  );
  assert.deepEqual(rec.batches[0].items[0].matchedTerms, ["zelda"]);
});

test("a search whose lists resolve to no terms is passed through unfiltered", async () => {
  const search = makeSearch({ includeLists: ["list_gone"] });
  const state = makeState([search]);
  const rec = recorder();
  const adapter = fakeAdapter([[makeItem("init")], [makeItem("init"), makeItem("kept", { title: "Anything at all" })]]);

  await fetchNow(search, state, rec.onNewItems, rec.onStatus, SETTINGS, adapter);
  await fetchNow(search, state, rec.onNewItems, rec.onStatus, SETTINGS, adapter);

  assert.deepEqual(
    rec.batches[0].items.map((i) => i.itemId),
    ["kept"],
  );
});

// ─── Cross-search dedup ───────────────────────────────────────────────────────

test("a listing already in the feed from another search is merged, not re-announced", async () => {
  const first = makeSearch({ id: "search_1", name: "First" });
  const second = makeSearch({ id: "search_2", name: "Second" });
  const state = makeState([first, second]);
  const rec = recorder();

  const shared = (searchId) => makeItem("shared", { searchId });

  // First search picks it up and puts it in the feed.
  await fetchNow(first, state, rec.onNewItems, rec.onStatus, SETTINGS, fakeAdapter([[makeItem("seed_1")]]));
  await fetchNow(first, state, rec.onNewItems, rec.onStatus, SETTINGS, fakeAdapter([[makeItem("seed_1"), shared("search_1")]]));
  assert.equal(state.feed.length, 1);
  const batchesAfterFirst = rec.batches.length;

  // Second search meets it in its steady state, where it looks new to that
  // search but is already on screen.
  await fetchNow(second, state, rec.onNewItems, rec.onStatus, SETTINGS, fakeAdapter([[makeItem("seed_2", { searchId: "search_2" })]]));
  await fetchNow(
    second,
    state,
    rec.onNewItems,
    rec.onStatus,
    SETTINGS,
    fakeAdapter([[makeItem("seed_2", { searchId: "search_2" }), shared("search_2")]]),
  );

  assert.equal(rec.batches.length, batchesAfterFirst, "the second search must not re-announce it");
  assert.equal(state.feed.length, 1, "and must not add a second card");
  assert.deepEqual(state.feed[0].searchIds, ["search_1", "search_2"]);
  assert.ok(state.deliveredIds["search_2"].has("shared"), "it counts as delivered for the second search too");
});

// ─── Generation token ─────────────────────────────────────────────────────────

test("a fetch superseded while in flight writes nothing", async () => {
  const search = makeSearch({ _generation: 1 });
  const state = makeState([search]);
  const rec = recorder();

  const adapter = {
    search: async () => {
      // Whatever supersedes the fetch — a save, a delete, a stop — bumps the
      // generation while the network call is outstanding.
      search._generation = 2;
      return [makeItem("a")];
    },
  };

  await fetchNow({ ...search, _generation: 1 }, state, rec.onNewItems, rec.onStatus, SETTINGS, adapter);

  assert.deepEqual(rec.batches, []);
  assert.deepEqual(rec.statuses, []);
  assert.equal(state.initialised[search.id], undefined);
  assert.equal(state.seenIds[search.id], undefined);
});

test("a deleted search's in-flight fetch writes nothing", async () => {
  const search = makeSearch();
  const state = makeState([search]);
  const rec = recorder();

  const adapter = {
    search: async () => {
      state.searches.length = 0;
      return [makeItem("a")];
    },
  };

  await fetchNow(search, state, rec.onNewItems, rec.onStatus, SETTINGS, adapter);
  assert.deepEqual(rec.batches, []);
});

// ─── Caps ─────────────────────────────────────────────────────────────────────

test("seenIds is pruned to the cap, keeping the most recent ids", async () => {
  const search = makeSearch();
  const state = makeState([search]);
  const rec = recorder();

  const page = Array.from({ length: SEEN_IDS_MAX_SIZE + 10 }, (_, i) => makeItem(`item_${i}`));
  await fetchNow(search, state, rec.onNewItems, rec.onStatus, SETTINGS, fakeAdapter([page]));

  const seen = state.seenIds[search.id];
  assert.equal(seen.size, SEEN_IDS_MAX_SIZE);
  assert.ok(seen.has(`item_${SEEN_IDS_MAX_SIZE + 9}`), "newest id retained");
  assert.ok(!seen.has("item_0"), "oldest id evicted");
});

test("the feed is capped and its index stays in step", async () => {
  const search = makeSearch();
  const state = makeState([search]);
  const rec = recorder();

  const page = Array.from({ length: FEED_MAX_SIZE + 25 }, (_, i) => makeItem(`item_${i}`));
  await fetchNow(search, state, rec.onNewItems, rec.onStatus, SETTINGS, fakeAdapter([[makeItem("seed")]]));
  await fetchNow(search, state, rec.onNewItems, rec.onStatus, SETTINGS, fakeAdapter([page]));

  assert.equal(state.feed.length, FEED_MAX_SIZE);
  assert.equal(state.feedIndex.size, FEED_MAX_SIZE, "evicted items must leave the index too");
});

// ─── Errors ───────────────────────────────────────────────────────────────────

test("a fetch failure records the error and counts towards backoff", async () => {
  const search = makeSearch();
  const state = makeState([search]);
  const rec = recorder();

  const adapter = {
    search: async () => {
      throw new Error("eBay API 503");
    },
  };

  await fetchNow(search, state, rec.onNewItems, rec.onStatus, SETTINGS, adapter);
  assert.equal(search._errorCount, 1);
  assert.equal(rec.statuses.at(-1).error, "eBay API 503");
});

test("a connectivity failure does not count towards backoff", async () => {
  const search = makeSearch();
  const state = makeState([search]);
  const rec = recorder();

  const adapter = {
    search: async () => {
      throw Object.assign(new Error("getaddrinfo ENOTFOUND api.ebay.com"), { code: "ENOTFOUND" });
    },
  };

  await fetchNow(search, state, rec.onNewItems, rec.onStatus, SETTINGS, adapter);
  assert.equal(search._errorCount, undefined, "no backoff — the poll interval is the right retry");
});

test("a successful fetch clears the consecutive-error counter", async () => {
  const search = makeSearch({ _errorCount: 3 });
  const state = makeState([search]);
  const rec = recorder();

  await fetchNow(search, state, rec.onNewItems, rec.onStatus, SETTINGS, fakeAdapter([[makeItem("a")]]));
  assert.equal(search._errorCount, 0);
});
