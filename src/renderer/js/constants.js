// ─── Renderer-side Constants ──────────────────────────────────────────────────
// Single source of truth for site/currency data used across renderer modules.
// Note: CURRENCY_SYMBOLS (currency code → symbol) lives only in
// src/main/shared/constants.js — the renderer uses SITE_CURRENCY_SYMBOL instead.

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
const DEFAULT_ACCENT_COLOR = "#7d8efc";

// Polling / feed limits (mirrors main-process constants)
const FEED_MAX_SIZE = 500;
const NEW_ITEM_WINDOW_MS = 60_000; // 1 minute — threshold for "NEW" badge
