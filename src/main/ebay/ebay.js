"use strict";

const fs = require("fs");
const path = require("path");
const { net } = require("electron");
const { CURRENCY_SYMBOLS } = require("../shared/constants");
const { withRetry, isTransientError } = require("../shared/retry");
const { loadApiUsage, saveApiUsage } = require("../persistence");

// Use Electron's net.fetch (Chromium stack, respects session.setProxy) in the
// main process. Falls back to global fetch if net is unavailable (tests/etc).
const _fetch = (...args) => (net && net.fetch ? net.fetch(...args) : fetch(...args));

const MARKETPLACE_IDS = {
  US: "EBAY_US",
  UK: "EBAY_GB",
  AU: "EBAY_AU",
  DE: "EBAY_DE",
  FR: "EBAY_FR",
  ES: "EBAY_ES",
  IT: "EBAY_IT",
  CA: "EBAY_CA",
};

const CURRENCY_CODES = {
  US: "USD",
  UK: "GBP",
  AU: "AUD",
  DE: "EUR",
  FR: "EUR",
  ES: "EUR",
  IT: "EUR",
  CA: "CAD",
};

const EBAY_SITE_URLS = {
  US: "https://www.ebay.com",
  UK: "https://www.ebay.co.uk",
  AU: "https://www.ebay.com.au",
  DE: "https://www.ebay.de",
  FR: "https://www.ebay.fr",
  ES: "https://www.ebay.es",
  IT: "https://www.ebay.it",
  CA: "https://www.ebay.ca",
};

const CATEGORY_TREE_IDS = {
  US: "0",
  UK: "3",
  AU: "15",
  CA: "2",
  DE: "77",
  FR: "71",
  ES: "186",
  IT: "101",
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
function ebayImageUrl(url, size = 1600) {
  if (!url) return url;
  return url.replace(/s-l\d+/, `s-l${size}`);
}

// ─── Configuration ────────────────────────────────────────────────────────────
// Call configure() once at startup with a settings getter and the userData path.
let _getSettings = () => ({});
let _userDataPath = "";

function configure(getSettings, userDataPath) {
  _getSettings = getSettings;
  _userDataPath = userDataPath;
}

// ─── API Call Counter ─────────────────────────────────────────────────────────
let _usage = null; // lazy-loaded on first call

function _getTodayUtc() {
  return new Date().toISOString().slice(0, 10);
}

function _ensureUsageLoaded() {
  if (!_usage) _usage = loadApiUsage();
  const today = _getTodayUtc();
  if (_usage.date !== today) {
    _usage = { calls: 0, date: today };
    saveApiUsage(_usage);
  }
}

function incrementApiCalls(n = 1) {
  _ensureUsageLoaded();
  _usage.calls += n;
  saveApiUsage(_usage);
}

function getApiUsage() {
  _ensureUsageLoaded();
  return { calls: _usage.calls, date: _usage.date };
}

// ─── OAuth Token Cache ────────────────────────────────────────────────────────
let accessToken = null;
let tokenExpiry = 0;
let _tokenFetchingPromise = null; // deduplicates concurrent token requests

function getAccessToken() {
  if (accessToken && Date.now() < tokenExpiry - 60000) return Promise.resolve(accessToken);

  if (!_tokenFetchingPromise) {
    const { clientId, clientSecret } = _getSettings();
    if (!clientId || !clientSecret) {
      return Promise.reject(new Error("eBay API credentials not configured. Add your Client ID and Client Secret in Settings."));
    }

    const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

    _tokenFetchingPromise = withRetry(
      async () => {
        const res = await _fetch("https://api.ebay.com/identity/v1/oauth2/token", {
          method: "POST",
          headers: {
            Authorization: `Basic ${credentials}`,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: "grant_type=client_credentials&scope=https%3A%2F%2Fapi.ebay.com%2Foauth%2Fapi_scope",
          signal: AbortSignal.timeout(15000),
        });

        if (!res.ok) {
          const text = await res.text();
          const err = new Error(`eBay auth failed (${res.status}): ${text}`);
          err.status = res.status;
          throw err;
        }

        return await res.json();
      },
      { retries: 3, label: "ebay:auth" },
    )
      .then((data) => {
        accessToken = data.access_token;
        tokenExpiry = Date.now() + data.expires_in * 1000;
        _tokenFetchingPromise = null;
        console.log("[ebay] Access token acquired, expires in", data.expires_in, "s");
        return accessToken;
      })
      .catch((err) => {
        _tokenFetchingPromise = null;
        throw err;
      });
  }

  return _tokenFetchingPromise;
}

function invalidateToken() {
  accessToken = null;
  tokenExpiry = 0;
  _tokenFetchingPromise = null;
}

// ─── Category Tree ─────────────────────────────────────────────────────────────
let categoryTreeCache = {};

async function loadCategoryTree(site) {
  if (categoryTreeCache[site]) return categoryTreeCache[site];

  const cacheFile = path.join(_userDataPath, `category_tree_${site}.json`);
  try {
    if (fs.existsSync(cacheFile)) {
      const cached = JSON.parse(fs.readFileSync(cacheFile, "utf8"));
      // Cache valid for 7 days
      if (cached.timestamp && Date.now() - cached.timestamp < 7 * 24 * 60 * 60 * 1000) {
        categoryTreeCache[site] = cached.categories;
        return cached.categories;
      }
    }
  } catch (e) {
    console.warn(`[ebay] Failed to read category cache for ${site}:`, e.message);
  }

  const treeId = CATEGORY_TREE_IDS[site] || "0";
  const token = await getAccessToken();
  const marketplaceId = MARKETPLACE_IDS[site] || "EBAY_US";

  const data = await withRetry(
    async () => {
      const res = await _fetch(`https://api.ebay.com/commerce/taxonomy/v1/category_tree/${treeId}`, {
        headers: {
          Authorization: `Bearer ${token}`,
          "X-EBAY-C-MARKETPLACE-ID": marketplaceId,
        },
        signal: AbortSignal.timeout(30000),
      });

      if (!res.ok) {
        const text = await res.text();
        const err = new Error(`Category tree fetch failed (${res.status}): ${text.slice(0, 100)}`);
        err.status = res.status;
        throw err;
      }

      return await res.json();
    },
    { retries: 3, label: `ebay:categories:${site}` },
  );
  const categories = [];

  function traverse(node, parentId, depth) {
    if (!node.category || depth > 2) return;
    const { categoryId, categoryName } = node.category;
    if (depth > 0) {
      categories.push({ id: categoryId, name: categoryName, depth, parentId: parentId || null });
    }
    if (node.childCategoryTreeNodes) {
      for (const child of node.childCategoryTreeNodes) {
        traverse(child, depth > 0 ? categoryId : null, depth + 1);
      }
    }
  }
  traverse(data.rootCategoryNode, null, 0);

  try {
    fs.writeFileSync(cacheFile, JSON.stringify({ timestamp: Date.now(), categories }), "utf8");
  } catch (e) {
    console.warn(`[ebay] Failed to write category cache for ${site}:`, e.message);
  }

  categoryTreeCache[site] = categories;
  return categories;
}

// ─── Search ───────────────────────────────────────────────────────────────────
function buildSearchFilters(query, currency) {
  const filters = [];
  if (query.minPrice || query.maxPrice) {
    filters.push(`price:[${query.minPrice || ""}..${query.maxPrice || ""}],priceCurrency:${currency}`);
  }
  if (query.format === "buy_now") filters.push("buyingOptions:{FIXED_PRICE}");
  else if (query.format === "auction") filters.push("buyingOptions:{AUCTION}");
  else filters.push("buyingOptions:{AUCTION|FIXED_PRICE|BEST_OFFER}");
  const locCode = query.itemLocation ? query.itemLocation.toUpperCase() : null;
  if (locCode) filters.push(`itemLocationCountry:${locCode}`);
  if (query.conditions && query.conditions.length > 0) {
    filters.push(`conditions:{${query.conditions.join("|")}}`);
  }
  return filters;
}

async function search(query) {
  const marketplaceId = MARKETPLACE_IDS[query.site] || "EBAY_US";
  const currency = CURRENCY_CODES[query.site] || "USD";

  const params = new URLSearchParams();
  if (query.keywords) params.set("q", query.keywords);
  if (query.category) params.set("category_ids", query.category);
  params.set("sort", "newlyListed");
  params.set("limit", "50");

  const filters = buildSearchFilters(query, currency);
  if (filters.length) params.set("filter", filters.join(","));
  if (query.aspectFilters && query.aspectFilters.length > 0 && query.category) {
    const validAspects = query.aspectFilters.filter((af) => af.name && af.values && af.values.length > 0);
    if (validAspects.length > 0) {
      const parts = [`categoryId:${query.category}`];
      for (const af of validAspects) {
        parts.push(`${af.name}:{${af.values.join("|")}}`);
      }
      params.set("aspect_filter", parts.join(","));
    }
  }

  const url = `https://api.ebay.com/buy/browse/v1/item_summary/search?${params}`;
  console.log(`[ebay] [${query.name}] API Request: https://api.ebay.com/buy/browse/v1/item_summary/search`);

  const data = await withRetry(
    async () => {
      // Re-acquire token on each attempt so a mid-request 401 (stale token) is
      // automatically recovered on the next retry after invalidation.
      const token = await getAccessToken();
      incrementApiCalls();
      const res = await _fetch(url, {
        headers: {
          Authorization: `Bearer ${token}`,
          "X-EBAY-C-MARKETPLACE-ID": marketplaceId,
        },
        signal: AbortSignal.timeout(15000),
      });

      if (res.status === 401) {
        invalidateToken();
        const err = new Error("eBay token rejected mid-search (401) — will retry with fresh token");
        err.status = 401;
        throw err;
      }
      if (!res.ok) {
        const text = await res.text();
        const err = new Error(`eBay API ${res.status}: ${text.slice(0, 200)}`);
        err.status = res.status;
        throw err;
      }

      return await res.json();
    },
    { retries: 3, shouldRetry: (err) => err.status === 401 || isTransientError(err), label: `ebay:search:${query.name}` },
  );

  return parseApiResults(data, query);
}

function formatItemPrice(item) {
  const priceSource = item.currentBidPrice || item.price || null;
  if (!priceSource) return null;
  const sym = CURRENCY_SYMBOLS[priceSource.currency] || priceSource.currency + " ";
  const label = item.currentBidPrice ? "Bid: " : "";
  return `${label}${sym}${parseFloat(priceSource.value).toFixed(2)}`;
}

function collectItemImages(item) {
  const thumbnail = item.image?.imageUrl || null;
  const image = thumbnail ? ebayImageUrl(thumbnail, 300) : null;
  const imagesSet = new Set();
  if (item.image?.imageUrl) imagesSet.add(ebayImageUrl(item.image.imageUrl));
  // additionalImages contains the extra photos uploaded by the seller.
  // thumbnailImages is only a small-thumbnail copy of the primary image — not additional photos.
  if (Array.isArray(item.additionalImages)) {
    for (const t of item.additionalImages) {
      if (t.imageUrl) imagesSet.add(ebayImageUrl(t.imageUrl));
    }
  }
  const images = imagesSet.size > 0 ? [...imagesSet] : image ? [ebayImageUrl(image)] : [];
  return { image, images };
}

function parseApiResults(data, query) {
  const siteBase = EBAY_SITE_URLS[query.site] || EBAY_SITE_URLS["US"];
  return (data.itemSummaries || []).map((item) => {
    const price = formatItemPrice(item);
    const priceSource = item.currentBidPrice || item.price || null;
    const priceNumeric = priceSource ? parseFloat(priceSource.value) : null;
    const { image, images } = collectItemImages(item);

    const rawId = item.itemId || "";
    const numericId = rawId.replace(/^v1\|/, "").replace(/\|.*$/, "");

    const options = item.buyingOptions || [];
    const buyingFormats = [];
    if (options.includes("AUCTION")) buyingFormats.push("Auction");
    if (options.includes("FIXED_PRICE")) buyingFormats.push("Buy It Now");
    if (options.includes("BEST_OFFER")) buyingFormats.push("Best Offer");
    if (buyingFormats.length === 0) buyingFormats.push("Other");

    const itemUrl = item.itemWebUrl || `${siteBase}/itm/${numericId}`;

    let shipping = null;
    if (Array.isArray(item.shippingOptions) && item.shippingOptions.length > 0) {
      const opt = item.shippingOptions[0];
      if (opt.shippingCost) {
        const sc = opt.shippingCost;
        const shipSym = CURRENCY_SYMBOLS[sc.currency] || sc.currency + " ";
        const val = parseFloat(sc.value);
        shipping = val === 0 ? "Free P&P" : `+${shipSym}${val.toFixed(2)} P&P`;
      }
    }

    return {
      id: `${query.id}_${numericId}`,
      itemId: numericId,
      searchId: query.id,
      searchName: query.name,
      cardColor: query.cardColor || null,
      site: query.site,
      source: "ebay",
      title: item.title,
      price,
      shipping,
      condition: item.condition || null,
      image,
      images,
      imageCount: images.length,
      url: itemUrl,
      buyingFormats,
      priceNumeric,
      bidCount: item.bidCount || 0,
      listingDate: item.itemCreationDate || null,
      listingEndDate: item.itemEndDate || null,
      foundAt: new Date().toISOString(),
    };
  });
}

// Fetch all images for a single listing via the Browse Item API
async function getItemImages(numericId, site) {
  const token = await getAccessToken();
  const marketplaceId = MARKETPLACE_IDS[site] || "EBAY_US";
  const encodedId = encodeURIComponent(`v1|${numericId}|0`);
  const url = `https://api.ebay.com/buy/browse/v1/item/${encodedId}`;

  const data = await withRetry(
    async () => {
      const res = await _fetch(url, {
        headers: {
          Authorization: `Bearer ${token}`,
          "X-EBAY-C-MARKETPLACE-ID": marketplaceId,
        },
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) {
        const text = await res.text();
        const err = new Error(`eBay item fetch failed (${res.status}): ${text.slice(0, 200)}`);
        err.status = res.status;
        throw err;
      }
      return await res.json();
    },
    { retries: 2, label: `ebay:item:${numericId}` },
  );

  const images = [];
  if (data.image?.imageUrl) images.push(ebayImageUrl(data.image.imageUrl));
  if (Array.isArray(data.additionalImages)) {
    for (const img of data.additionalImages) {
      if (img.imageUrl) images.push(ebayImageUrl(img.imageUrl));
    }
  }
  return images;
}

module.exports = { configure, getAccessToken, invalidateToken, search, loadCategoryTree, getItemImages, getApiUsage, incrementApiCalls };
