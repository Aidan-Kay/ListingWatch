"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { apiHostFor, toAttributeName, buildSearchParams, VINTED_PAGE_SIZE } = require("../src/main/vinted/lib/query");
const { Item, absoluteUrl } = require("../src/main/vinted/lib/item");
const { VINTED_CONDITIONS, toVintedConditionIds } = require("../src/shared/constants");

// ─── Host ─────────────────────────────────────────────────────────────────────

test("the catalogue API host is the site domain with www swapped for api", () => {
  assert.equal(apiHostFor("www.vinted.co.uk"), "api.vinted.co.uk");
  assert.equal(apiHostFor("www.vinted.fr"), "api.vinted.fr");
  assert.equal(apiHostFor("www.vinted.de"), "api.vinted.de");
});

test("a domain without a www prefix is left alone", () => {
  assert.equal(apiHostFor("api.vinted.co.uk"), "api.vinted.co.uk");
});

// ─── Attribute names ──────────────────────────────────────────────────────────

test("website filter spellings become bare attribute names", () => {
  // These are the spellings url-import.js pulls out of a pasted Vinted link.
  assert.equal(toAttributeName("video_game_platform_ids[]"), "video_game_platform");
  assert.equal(toAttributeName("catalog[]"), "catalog");
  assert.equal(toAttributeName("status_ids"), "status");
  assert.equal(toAttributeName("brand_ids[]"), "brand");
});

test("attribute name translation is idempotent", () => {
  assert.equal(toAttributeName(toAttributeName("video_game_platform_ids[]")), "video_game_platform");
  assert.equal(toAttributeName("status"), "status");
});

test("surrounding whitespace is trimmed", () => {
  assert.equal(toAttributeName("  status_ids[] "), "status");
});

// ─── Search params ────────────────────────────────────────────────────────────

test("a bare search sends only the fixed paging and ordering params", () => {
  assert.deepEqual(buildSearchParams({}), { page: 1, per_page: VINTED_PAGE_SIZE, order: "newest_first" });
});

test("keywords, prices and category map onto the new parameter names", () => {
  const params = buildSearchParams({ keywords: "zelda", minPrice: 5, maxPrice: 50, vintedCategory: "3026" });
  assert.equal(params.search_text, "zelda");
  assert.equal(params.price_from, 5);
  assert.equal(params.price_to, 50);
  assert.equal(params["attribute_ids[catalog]"], "3026");
  // The retired endpoint's spelling must not survive: the service ignores
  // unknown params silently and would return an unfiltered page.
  assert.ok(!("catalog_ids" in params));
});

test("empty values are omitted rather than sent blank", () => {
  const params = buildSearchParams({ keywords: "", minPrice: 0, maxPrice: null, vintedCategory: "" });
  assert.ok(!("search_text" in params));
  assert.ok(!("price_from" in params));
  assert.ok(!("price_to" in params));
  assert.ok(!("attribute_ids[catalog]" in params));
});

test("multi-value filters are comma-joined into one param, never repeated", () => {
  // Repeating a key is a 400 from the catalogue service.
  const params = buildSearchParams({
    vintedFilters: [{ name: "video_game_platform_ids[]", values: "1270, 1269" }],
  });
  assert.equal(params["attribute_ids[video_game_platform]"], "1270,1269");
  assert.ok(!Array.isArray(params["attribute_ids[video_game_platform]"]));
});

test("no param value is ever an array", () => {
  const params = buildSearchParams({
    keywords: "zelda",
    vintedCategory: "3026",
    vintedFilters: [
      { name: "video_game_platform_ids[]", values: "1270,1269" },
      { name: "status_ids", values: "6,1" },
    ],
  });
  for (const [key, value] of Object.entries(params)) {
    assert.ok(!Array.isArray(value), `${key} must not be an array`);
  }
});

test("a category and an imported catalog filter merge instead of overwriting", () => {
  const params = buildSearchParams({
    vintedCategory: "3026",
    vintedFilters: [{ name: "catalog[]", values: "1187" }],
  });
  assert.equal(params["attribute_ids[catalog]"], "3026,1187");
});

test("duplicate values are collapsed", () => {
  const params = buildSearchParams({
    vintedCategory: "3026",
    vintedFilters: [{ name: "catalog[]", values: "3026, 1187" }],
  });
  assert.equal(params["attribute_ids[catalog]"], "3026,1187");
});

test("blank and malformed filters are skipped", () => {
  const params = buildSearchParams({
    vintedFilters: [{ name: "", values: "1" }, { name: "status_ids", values: "" }, null, { values: "2" }],
  });
  assert.deepEqual(params, { page: 1, per_page: VINTED_PAGE_SIZE, order: "newest_first" });
});

test("the requested page number is honoured", () => {
  assert.equal(buildSearchParams({}, 3).page, 3);
});

// ─── Conditions ───────────────────────────────────────────────────────────────

test("selected conditions become one comma-joined status attribute", () => {
  const params = buildSearchParams({ keywords: "zelda", vintedConditions: ["6", "1"] });
  assert.equal(params["attribute_ids[status]"], "6,1");
});

test("no conditions selected means no status filter at all", () => {
  for (const vintedConditions of [[], undefined, null, "6"]) {
    assert.ok(!("attribute_ids[status]" in buildSearchParams({ vintedConditions })));
  }
});

test("an unknown condition ID is dropped rather than sent", () => {
  // Vinted answers an unused status ID with an empty page, so passing one
  // through would leave the search silently finding nothing.
  const params = buildSearchParams({ vintedConditions: ["6", "99"] });
  assert.equal(params["attribute_ids[status]"], "6");
  assert.ok(!("attribute_ids[status]" in buildSearchParams({ vintedConditions: ["99"] })));
});

test("the condition picker and an imported status filter merge", () => {
  const params = buildSearchParams({
    vintedConditions: ["6"],
    vintedFilters: [{ name: "status_ids[]", values: "1,6" }],
  });
  assert.equal(params["attribute_ids[status]"], "6,1");
});

test("every offered condition ID is one Vinted actually uses", () => {
  // Verified live against api.vinted.co.uk — each returns only listings whose
  // condition line matches its label. 0, 5, 8 and 9 return nothing.
  assert.deepEqual(
    VINTED_CONDITIONS.map((c) => c.id),
    ["6", "1", "2", "3", "4", "7"],
  );
});

test("stored conditions are normalised on read", () => {
  assert.deepEqual(toVintedConditionIds([" 2 ", 3, "2", "", null, "nope"]), ["2", "3"]);
  assert.deepEqual(toVintedConditionIds("2"), []);
});

// ─── Item mapping ─────────────────────────────────────────────────────────────

const RAW = {
  id: 10005039098,
  title: "Zelda style Keychain necklace",
  url: "/items/10005039098-zelda-style-keychain-necklace",
  item_box: { first_line: "Zelda", second_line: "New without tags" },
  price: { amount: "5.24", currency_code: "GBP" },
  total_item_price: { amount: "6.20", currency_code: "GBP" },
  photo: { url: "https://images1.vinted.net/t/x/f800/a.webp", full_size_url: "https://images1.vinted.net/tc/x/a.webp" },
  photos: [{ url: "https://images1.vinted.net/t/x/f800/a.webp", full_size_url: "https://images1.vinted.net/tc/x/a.webp" }],
};

test("a relative listing URL is resolved against the site domain", () => {
  const item = new Item(RAW, "www.vinted.co.uk");
  assert.equal(item.url, "https://www.vinted.co.uk/items/10005039098-zelda-style-keychain-necklace");
});

test("an already absolute URL is left as-is", () => {
  assert.equal(absoluteUrl("https://www.vinted.fr/items/1-x", "www.vinted.co.uk"), "https://www.vinted.fr/items/1-x");
});

test("a missing URL yields null rather than a link to the domain root", () => {
  assert.equal(absoluteUrl(null, "www.vinted.co.uk"), null);
});

test("condition and brand are read from item_box", () => {
  const item = new Item(RAW, "www.vinted.co.uk");
  assert.equal(item.conditionTitle, "New without tags");
  assert.equal(item.brandTitle, "Zelda");
});

test("price, currency and total price are mapped", () => {
  const item = new Item(RAW, "www.vinted.co.uk");
  assert.equal(item.price, "5.24");
  assert.equal(item.currency, "GBP");
  assert.equal(item.totalPrice, "6.20");
});

test("the thumbnail prefers the sized render and the gallery the full-size one", () => {
  const item = new Item(RAW, "www.vinted.co.uk");
  assert.equal(item.photo, "https://images1.vinted.net/t/x/f800/a.webp");
  assert.deepEqual(item.photos, ["https://images1.vinted.net/tc/x/a.webp"]);
});

test("an item with no photos array still yields its main photo", () => {
  const item = new Item({ ...RAW, photos: undefined }, "www.vinted.co.uk");
  assert.deepEqual(item.photos, ["https://images1.vinted.net/t/x/f800/a.webp"]);
});

test("a photoless item yields no images rather than a null entry", () => {
  const item = new Item({ ...RAW, photo: undefined, photos: [] }, "www.vinted.co.uk");
  assert.equal(item.photo, null);
  assert.deepEqual(item.photos, []);
});

test("fields the retired endpoint provided are absent, not silently wrong", () => {
  const item = new Item(RAW, "www.vinted.co.uk");
  // The catalogue service reports no listing time at all; callers stand in
  // first-seen. Guards against a stray created_at_ts mapping creeping back.
  assert.equal(item.createdAtTs, undefined);
});
