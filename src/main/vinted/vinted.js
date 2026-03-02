"use strict";

const { requester } = require("./lib/requester");
const { Item } = require("./lib/item");
const { CURRENCY_SYMBOLS } = require("../shared/constants");

const VINTED_API_URL = "/api/v2";
const VINTED_PRODUCTS_ENDPOINT = "catalog/items";

// ─── Vinted Domains ───────────────────────────────────────────────────────────
const VINTED_DOMAINS = {
  VK: "www.vinted.co.uk",
  VFR: "www.vinted.fr",
  VDE: "www.vinted.de",
  VBE: "www.vinted.be",
  VES: "www.vinted.es",
  VIT: "www.vinted.it",
  VNL: "www.vinted.nl",
  VPL: "www.vinted.pl",
  VUS: "www.vinted.com",
};

// ─── Search ───────────────────────────────────────────────────────────────────
async function searchVinted(search) {
  const domain = VINTED_DOMAINS[search.site] || "www.vinted.co.uk";
  requester.setLocale(domain);

  const apiUrl = `https://${domain}${VINTED_API_URL}/${VINTED_PRODUCTS_ENDPOINT}`;

  const params = {
    search_text: search.keywords || undefined,
    catalog_ids: search.vintedCategory || undefined,
    price_from: search.minPrice || undefined,
    price_to: search.maxPrice || undefined,
    order: "newest_first",
    per_page: 50,
    page: 1,
  };
  // Drop undefined keys so they're not sent as empty query params
  for (const key of Object.keys(params)) {
    if (params[key] === undefined) delete params[key];
  }

  // Apply Vinted category-specific filters (e.g. video_game_platform_ids[] = "1270,1269")
  if (Array.isArray(search.vintedFilters)) {
    for (const vf of search.vintedFilters) {
      if (vf.name && vf.values) {
        const key = vf.name.endsWith("[]") ? vf.name : `${vf.name}[]`;
        params[key] = vf.values;
      }
    }
  }

  console.log(`[vinted] [${search.name}] API Request: ${apiUrl}`, params);

  const response = await requester.get(apiUrl, params);
  if (response.status !== 200) {
    throw new Error(`Vinted API returned status ${response.status}`);
  }

  return response.data.items.map((raw) => {
    const item = new Item(raw);
    const currencySymbol = CURRENCY_SYMBOLS[item.currency] || item.currency + " ";
    const price = item.price ? `${currencySymbol}${parseFloat(item.price).toFixed(2)}` : null;
    return {
      id: `${search.id}_${item.id}`,
      itemId: String(item.id),
      searchId: search.id,
      searchName: search.name,
      cardColor: search.cardColor || null,
      site: search.site,
      source: "vinted",
      title: item.title,
      price,
      shipping: null,
      condition: item.sizeTitle || null,
      image: item.photo || null,
      url: item.url,
      buyingFormats: ["Buy It Now"],
      bidCount: 0,
      listingDate: item.createdAtTs ? item.createdAtTs.toISOString() : null,
      listingEndDate: null,
      foundAt: new Date().toISOString(),
    };
  });
}

module.exports = { searchVinted, VINTED_DOMAINS };
