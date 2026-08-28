// ─── Renderer-side Constants ──────────────────────────────────────────────────
// Site/currency data used across renderer modules. Values shared with the main
// process live in src/shared/constants.js instead; CURRENCY_SYMBOLS (currency
// code → symbol) is there but unused here — the renderer wants
// SITE_CURRENCY_SYMBOL, which is keyed by site.

// Maps site key → currency symbol (used in search list price display)
const SITE_CURRENCY_SYMBOL = {
  US: "$",
  UK: "£",
  AU: "A$",
  CA: "C$",
  DE: "€",
  FR: "€",
  ES: "€",
  IT: "€",
  BE: "€",
  NL: "€",
  PL: "zł",
};

const EBAY_SITE_LABELS = {
  US: "eBay US",
  UK: "eBay UK",
  AU: "eBay AU",
  CA: "eBay CA",
  DE: "eBay DE",
  FR: "eBay FR",
  ES: "eBay ES",
  IT: "eBay IT",
};

const VINTED_SITE_LABELS = {
  UK: "Vinted UK",
  FR: "Vinted FR",
  DE: "Vinted DE",
  BE: "Vinted BE",
  ES: "Vinted ES",
  IT: "Vinted IT",
  NL: "Vinted NL",
  PL: "Vinted PL",
  US: "Vinted US",
};

const BRAND_LABELS = {
  ebay: "eBay",
  vinted: "Vinted",
};

// External eBay category browsing URLs per site key
const EBAY_CATEGORY_URLS = {
  US: "https://www.ebay.com/n/all-categories",
  UK: "https://www.ebay.co.uk/n/all-categories",
  AU: "https://www.ebay.com.au/n/all-categories",
  CA: "https://www.ebay.ca/n/all-categories",
  DE: "https://www.ebay.de/n/all-categories",
  FR: "https://www.ebay.fr/n/all-categories",
  ES: "https://www.ebay.es/n/all-categories",
  IT: "https://www.ebay.it/n/all-categories",
};

// Default accent colour used when no user preference has been saved
const DEFAULT_ACCENT_COLOR = "#5d66f6";

// FEED_MAX_SIZE and NEW_ITEM_WINDOW_MS come from src/shared/constants.js, which
// index.html loads before this file — they have to agree with the main process.
