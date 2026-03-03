"use strict";

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

module.exports = { CURRENCY_SYMBOLS, SEEN_IDS_MAX_SIZE };
