"use strict";

// Values and pure helpers shared by the main process and the renderer.

// Currency symbol map shared by eBay and Vinted modules.
const CURRENCY_SYMBOLS = {
  USD: "$",
  GBP: "£",
  EUR: "€",
  AUD: "A$",
  CAD: "C$",
  PLN: "zł",
};

// Maximum number of item IDs tracked per search to prevent unbounded memory growth.
// V8 Sets preserve insertion order, so the oldest entries are evicted first when pruning.
const SEEN_IDS_MAX_SIZE = 10_000;

// Allowed values for `search.source`. Used by save-search / import-data validation
// and by the marketplace adapter registry.
const MARKETPLACE_SOURCES = Object.freeze(["ebay", "vinted"]);

// Maximum listings held in the feed. The main process trims state.feed to this
// and the renderer trims its mirror to the same number. These were two separate
// declarations, and the renderer's copy quietly stopped being applied at all.
const FEED_MAX_SIZE = 500;

// How long a listing wears the "NEW" badge after it is found.
const NEW_ITEM_WINDOW_MS = 60_000;

/**
 * Rewrite an eBay image URL to a different rendered size. eBay encodes the size
 * in the path ("s-l225"), so asking for a bigger one is a string swap. Both
 * processes need it — main to pick thumbnail and full sizes off a search
 * result, the renderer to upgrade a thumbnail when the lightbox opens.
 */
function ebayImageUrl(url, size = 1600) {
  if (!url) return url;
  return url.replace(/s-l\d+/, `s-l${size}`);
}

// ─── eBay Item Conditions ─────────────────────────────────────────────────────
// Conditions are identified by eBay's numeric condition ID, not by name. The
// Browse API's `conditions:{NAME}` filter accepts any name it is given and then
// silently ignores all but NEW and USED — a search filtered to "Like New" came
// back completely unfiltered. `conditionIds:{1500}` filters for real, so the ID
// is the value that gets stored, sent, and compared everywhere.
//
// This list is the fallback shown before a category is chosen, or when the
// per-category lookup finds nothing. Real per-category lists come from the
// Browse API's condition refinements — see ebay.loadCategoryConditions().
const EBAY_CONDITIONS = Object.freeze([
  { id: "1000", label: "New" },
  { id: "1500", label: "Opened – never used" },
  { id: "1750", label: "New with defects" },
  { id: "2000", label: "Certified - Refurbished" },
  { id: "2010", label: "Excellent - Refurbished" },
  { id: "2020", label: "Very Good - Refurbished" },
  { id: "2030", label: "Good - Refurbished" },
  { id: "2500", label: "Seller refurbished" },
  { id: "3000", label: "Used" },
  { id: "4000", label: "Very Good" },
  { id: "5000", label: "Good" },
  { id: "6000", label: "Acceptable" },
  { id: "7000", label: "For parts or not working" },
]);

// Searches saved before the switch to numeric IDs hold condition *names*. Map
// them on read so those searches keep filtering as their owner intended rather
// than silently matching everything. LIKE_NEW and NEW_OTHER both collapse onto
// 1500, which is the single condition eBay actually exposes for both.
const EBAY_LEGACY_CONDITION_IDS = Object.freeze({
  NEW: "1000",
  LIKE_NEW: "1500",
  NEW_OTHER: "1500",
  NEW_WITH_DEFECTS: "1750",
  CERTIFIED_REFURBISHED: "2000",
  EXCELLENT_REFURBISHED: "2010",
  VERY_GOOD_REFURBISHED: "2020",
  GOOD_REFURBISHED: "2030",
  SELLER_REFURBISHED: "2500",
  USED: "3000",
  VERY_GOOD: "4000",
  GOOD: "5000",
  ACCEPTABLE: "6000",
  FOR_PARTS_OR_NOT_WORKING: "7000",
});

// eBay search URLs come in two vintages. Modern ones put real condition IDs in
// LH_ItemCondition (LH_ItemCondition=1000|3000); older ones use single-digit
// group codes, and a search imported from one of those is still on disk holding
// a bare "3". Only the two unambiguous codes are translated — guessing at the
// rest would apply a filter the user never asked for.
const EBAY_LEGACY_URL_CONDITION_IDS = Object.freeze({ 1: "1000", 3: "3000" });

/**
 * Coerce a stored `conditions` array to numeric eBay condition IDs.
 *
 * Accepts the IDs written by current builds, the condition names written by
 * older ones, and both vintages of eBay's `LH_ItemCondition` URL parameter — so
 * URL import needs no separate translation.
 *
 * Anything else is dropped rather than passed through. eBay discards a
 * conditionIds filter containing an unknown ID rather than ignoring just that
 * one, so a single stray value silently widens the search to everything —
 * exactly the failure the old name-based filter had. Real IDs are four digits
 * (1000–7000); any four-digit value is allowed through so that conditions this
 * list has never heard of, returned by the per-category lookup, still survive a
 * save/reload round trip.
 */
function toEbayConditionIds(conditions) {
  if (!Array.isArray(conditions)) return [];
  const ids = [];
  for (const raw of conditions) {
    const value = String(raw ?? "").trim();
    if (!value) continue;
    let id;
    if (/^\d+$/.test(value)) {
      id = value.length >= 4 ? value : EBAY_LEGACY_URL_CONDITION_IDS[value];
    } else {
      id = EBAY_LEGACY_CONDITION_IDS[value.toUpperCase()];
    }
    if (id && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

// ─── Vinted Item Conditions ───────────────────────────────────────────────────
// Unlike eBay, Vinted offers the same conditions everywhere — the IDs are global
// rather than per-category, so this list is the whole set and needs no lookup.
// The catalogue service filters on them through `attribute_ids[status]`, and
// "Not fully functional" (7) is only ever attached to electronics listings even
// though the ID itself is valid site-wide.
//
// Verified against api.vinted.co.uk: each ID below returns only listings whose
// condition line matches its label, and comma-joined IDs return their union.
const VINTED_CONDITIONS = Object.freeze([
  { id: "6", label: "New with tags" },
  { id: "1", label: "New without tags" },
  { id: "2", label: "Very good" },
  { id: "3", label: "Good" },
  { id: "4", label: "Satisfactory" },
  { id: "7", label: "Not fully functional" },
]);

/**
 * Coerce a stored `vintedConditions` array to known Vinted status IDs.
 *
 * Unrecognised values are dropped. An ID Vinted does not use returns an empty
 * page rather than being ignored, so letting one through would leave a search
 * silently finding nothing at all — the filter has to be known-good or absent.
 *
 * @param {unknown} conditions
 * @returns {string[]}
 */
function toVintedConditionIds(conditions) {
  if (!Array.isArray(conditions)) return [];
  const known = new Set(VINTED_CONDITIONS.map((c) => c.id));
  const ids = [];
  for (const raw of conditions) {
    const value = String(raw ?? "").trim();
    if (known.has(value) && !ids.includes(value)) ids.push(value);
  }
  return ids;
}

// Dual-loadable. The main process require()s this file; the renderer <script>-loads
// it, where the top-level declarations above already become globals — so only the
// CommonJS side needs an explicit export. One definition of this either way, rather
// than a hand-maintained copy on each side of the process boundary.
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    CURRENCY_SYMBOLS,
    SEEN_IDS_MAX_SIZE,
    MARKETPLACE_SOURCES,
    FEED_MAX_SIZE,
    NEW_ITEM_WINDOW_MS,
    EBAY_CONDITIONS,
    EBAY_LEGACY_CONDITION_IDS,
    toEbayConditionIds,
    VINTED_CONDITIONS,
    toVintedConditionIds,
    ebayImageUrl,
  };
}
