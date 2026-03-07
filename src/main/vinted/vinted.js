"use strict";

const { getRequester } = require("./lib/requester");
const { Item } = require("./lib/item");
const { CURRENCY_SYMBOLS } = require("../shared/constants");

const VINTED_API_URL = "/api/v2";
const VINTED_PRODUCTS_ENDPOINT = "catalog/items";

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

  const apiUrl = `https://${domain}${VINTED_API_URL}/${VINTED_PRODUCTS_ENDPOINT}`;

  const params = {
    search_text: query.keywords || undefined,
    catalog_ids: query.vintedCategory || undefined,
    price_from: query.minPrice || undefined,
    price_to: query.maxPrice || undefined,
    order: "newest_first",
    per_page: 50,
    page: 1,
  };
  // Drop undefined keys so they're not sent as empty query params
  for (const key of Object.keys(params)) {
    if (params[key] === undefined) delete params[key];
  }

  // Apply Vinted category-specific filters (e.g. video_game_platform_ids[] = "1270,1269")
  // Comma-separated values are split into arrays so _buildUrl repeats the key for each
  // value, producing video_game_platform_ids[]=1269&video_game_platform_ids[]=1270.
  if (Array.isArray(query.vintedFilters)) {
    for (const vf of query.vintedFilters) {
      if (vf.name && vf.values) {
        const key = vf.name.endsWith("[]") ? vf.name : `${vf.name}[]`;
        const raw = String(vf.values);
        params[key] = raw.includes(",") ? raw.split(",").map((s) => s.trim()) : raw;
      }
    }
  }

  console.log(`[vinted] [${query.name}] API Request: ${apiUrl}`);

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
    const item = new Item(raw);
    const currencySymbol = CURRENCY_SYMBOLS[item.currency] || item.currency + " ";
    const price = item.price ? `${currencySymbol}${parseFloat(item.price).toFixed(2)}` : null;
    const images =
      Array.isArray(raw.photos) && raw.photos.length > 0
        ? raw.photos.map((p) => p.full_size_url || p.url).filter(Boolean)
        : [item.photo].filter(Boolean);
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
      condition: item.sizeTitle || null,
      image: item.photo || null,
      images,
      imageCount: images.length,
      url: item.url,
      buyingFormats: ["Buy It Now"],
      priceNumeric: item.price ? parseFloat(item.price) : null,
      bidCount: 0,
      listingDate: item.createdAtTs ? item.createdAtTs.toISOString() : null,
      listingEndDate: null,
      foundAt: new Date().toISOString(),
    };
  });
}

// Fetch all images for a single Vinted listing via the item detail API
async function getItemImages(itemId, site) {
  const domain = VINTED_DOMAINS[site] || "www.vinted.co.uk";
  const requester = getRequester(domain);

  const apiUrl = `https://${domain}${VINTED_API_URL}/items/${itemId}`;
  const response = await requester.get(apiUrl);

  if (response.status !== 200) {
    throw new Error(`Vinted item API returned status ${response.status}`);
  }

  const item = response.data.item;
  const photos = item.photos || (item.photo ? [item.photo] : []);
  return photos.map((p) => p.url).filter(Boolean);
}

module.exports = { search, getItemImages };
