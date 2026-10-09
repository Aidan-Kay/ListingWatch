"use strict";

const { getRequester } = require("./lib/requester");
const { Item } = require("./lib/item");
const { VINTED_API_PATH, buildSearchParams, apiHostFor } = require("./lib/query");
const { CURRENCY_SYMBOLS } = require("../../shared/constants");

// ─── Vinted Domains ───────────────────────────────────────────────────────────
const VINTED_DOMAINS = {
  UK: "www.vinted.co.uk",
  FR: "www.vinted.fr",
  DE: "www.vinted.de",
  BE: "www.vinted.be",
  ES: "www.vinted.es",
  IT: "www.vinted.it",
  NL: "www.vinted.nl",
  PL: "www.vinted.pl",
  US: "www.vinted.com",
};

// ─── Search ───────────────────────────────────────────────────────────────────
async function search(query) {
  const domain = VINTED_DOMAINS[query.site] || "www.vinted.co.uk";
  const requester = getRequester(domain);

  // The catalogue service lives on api.<domain>, not the site domain. Requests
  // still originate from a page loaded on the site domain, which is what makes
  // them pass CORS — see the requester's hidden-window fetch.
  const apiUrl = `https://${apiHostFor(domain)}${VINTED_API_PATH}`;
  const params = buildSearchParams(query);

  // Log the parameters, not just the endpoint: the service ignores names it does
  // not recognise instead of rejecting them, so a mis-mapped filter shows up as
  // quietly wrong results and this line is the only place it is visible.
  const paramNote = Object.entries(params)
    .map(([key, value]) => `${key}=${value}`)
    .join("&");
  console.log(`[vinted] [${query.name}] API Request: ${apiUrl}?${paramNote}`);

  const response = await requester.get(apiUrl, params);
  if (response.status !== 200) {
    throw new Error(`Vinted API returned status ${response.status}`);
  }

  const items = response.data?.items;
  if (!Array.isArray(items)) {
    console.warn(`[vinted] [${query.name}] Unexpected API response shape:`, JSON.stringify(response.data).slice(0, 200));
    return [];
  }
  return items.map((raw) => {
    const item = new Item(raw, domain);
    const currencySymbol = CURRENCY_SYMBOLS[item.currency] || item.currency + " ";
    const price = item.price ? `${currencySymbol}${parseFloat(item.price).toFixed(2)}` : null;
    const images = item.photos;

    // Vinted's catalogue service exposes no listing timestamp, so the moment the
    // app first saw the listing stands in for one. Only genuinely new items reach
    // the feed — anything already in seenIds is never re-pushed — so this is
    // stamped once, on first sighting, and stays put from then on.
    const foundAt = new Date().toISOString();

    return {
      id: `${query.id}_${item.id}`,
      itemId: String(item.id),
      searchId: query.id,
      searchName: query.name,
      cardColor: query.cardColor || null,
      site: query.site,
      source: "vinted",
      title: item.title,
      price,
      shipping: null,
      condition: item.conditionTitle,
      image: item.photo,
      images,
      imageCount: images.length,
      url: item.url,
      buyingFormats: ["Buy It Now"],
      priceNumeric: item.price ? parseFloat(item.price) : null,
      bidCount: 0,
      listingDate: foundAt,
      // Flags listingDate as a first-seen stand-in rather than a real listing
      // time, so age-based logic can tell the difference. Without it the initial
      // backfill would read every listing on the first page as brand new.
      listingDateEstimated: true,
      // Vinted listings do not expire the way an auction does; kept for shape
      // parity with the eBay adapter.
      listingEndDate: null,
      foundAt,
    };
  });
}

/**
 * Fetch all images for a single Vinted listing.
 *
 * No longer possible: `/api/v2/items/{id}` was retired alongside the catalogue
 * endpoint, and its replacement (`api.<domain>/item-details/item/{id}`) refuses
 * browser clients outright with `{"code":"WEB_NOT_SUPPORTED"}` — it serves the
 * mobile apps only. The item page itself is server-rendered with its photo URLs
 * buried in escaped Next.js flight data, which is too brittle to scrape.
 *
 * Catalogue results already carry the main photo, so callers fall back to the
 * item's own `images`. Kept to satisfy the marketplace-adapter contract.
 *
 * @returns {Promise<string[]>} Always empty — no additional images are available.
 */
async function getItemImages() {
  return [];
}

module.exports = { search, getItemImages };
