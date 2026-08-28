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

// Dual-loadable. The main process require()s this file; the renderer <script>-loads
// it, where the top-level declarations above already become globals — so only the
// CommonJS side needs an explicit export. One definition of this either way, rather
// than a hand-maintained copy on each side of the process boundary.
if (typeof module !== "undefined" && module.exports) {
  module.exports = { CURRENCY_SYMBOLS, SEEN_IDS_MAX_SIZE, MARKETPLACE_SOURCES, FEED_MAX_SIZE, NEW_ITEM_WINDOW_MS, ebayImageUrl };
}
