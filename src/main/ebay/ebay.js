"use strict";

const fs = require("fs");
const path = require("path");
const { CURRENCY_SYMBOLS } = require("../shared/constants");

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

// ─── Configuration ────────────────────────────────────────────────────────────
// Call configure() once at startup with a settings getter and the userData path.
let _getSettings = () => ({});
let _userDataPath = "";

function configure(getSettings, userDataPath) {
  _getSettings = getSettings;
  _userDataPath = userDataPath;
}

// ─── OAuth Token Cache ────────────────────────────────────────────────────────
let accessToken = null;
let tokenExpiry = 0;

async function getAccessToken() {
  if (accessToken && Date.now() < tokenExpiry - 60000) return accessToken;

  const { clientId, clientSecret } = _getSettings();
  if (!clientId || !clientSecret) throw new Error("eBay API credentials not configured. Add your Client ID and Client Secret in Settings.");

  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const res = await fetch("https://api.ebay.com/identity/v1/oauth2/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials&scope=https%3A%2F%2Fapi.ebay.com%2Foauth%2Fapi_scope",
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`eBay auth failed (${res.status}): ${text}`);
  }

  const data = await res.json();
  accessToken = data.access_token;
  tokenExpiry = Date.now() + data.expires_in * 1000;
  console.log("eBay access token acquired, expires in", data.expires_in, "s");
  return accessToken;
}

function invalidateToken() {
  accessToken = null;
  tokenExpiry = 0;
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
    /* ignore stale cache */
  }

  const treeId = CATEGORY_TREE_IDS[site] || "0";
  const token = await getAccessToken();
  const marketplaceId = MARKETPLACE_IDS[site] || "EBAY_US";

  const res = await fetch(`https://api.ebay.com/commerce/taxonomy/v1/category_tree/${treeId}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      "X-EBAY-C-MARKETPLACE-ID": marketplaceId,
    },
    signal: AbortSignal.timeout(30000),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Category tree fetch failed (${res.status}): ${text.slice(0, 100)}`);
  }

  const data = await res.json();
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
    /* ignore write errors */
  }

  categoryTreeCache[site] = categories;
  return categories;
}

// ─── Search ───────────────────────────────────────────────────────────────────
async function search(search) {
  const token = await getAccessToken();
  const marketplaceId = MARKETPLACE_IDS[search.site] || "EBAY_US";
  const currency = CURRENCY_CODES[search.site] || "USD";

  const params = new URLSearchParams();
  if (search.keywords) params.set("q", search.keywords);
  if (search.category) params.set("category_ids", search.category);
  params.set("sort", "newlyListed");
  params.set("limit", "50");

  const filters = [];
  if (search.minPrice || search.maxPrice) {
    const min = search.minPrice || "";
    const max = search.maxPrice || "";
    filters.push(`price:[${min}..${max}],priceCurrency:${currency}`);
  }
  if (search.format === "buy_now") filters.push("buyingOptions:{FIXED_PRICE}");
  else if (search.format === "auction") filters.push("buyingOptions:{AUCTION}");
  else filters.push("buyingOptions:{AUCTION|FIXED_PRICE|BEST_OFFER}");
  const locCode = search.itemLocation ? search.itemLocation.toUpperCase() : null;
  if (locCode) filters.push(`itemLocationCountry:${locCode}`);
  if (search.conditions && search.conditions.length > 0) {
    filters.push(`conditions:{${search.conditions.join("|")}}`);
  }
  if (filters.length) params.set("filter", filters.join(","));
  if (search.aspectFilters && search.aspectFilters.length > 0 && search.category) {
    const validAspects = search.aspectFilters.filter((af) => af.name && af.values && af.values.length > 0);
    if (validAspects.length > 0) {
      const parts = [`categoryId:${search.category}`];
      for (const af of validAspects) {
        parts.push(`${af.name}:{${af.values.join("|")}}`);
      }
      params.set("aspect_filter", parts.join(","));
    }
  }

  const url = `https://api.ebay.com/buy/browse/v1/item_summary/search?${params}`;
  console.log(`[ebay] [${search.name}] API Request: ${url}`);

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      "X-EBAY-C-MARKETPLACE-ID": marketplaceId,
    },
    signal: AbortSignal.timeout(15000),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`eBay API ${res.status}: ${text.slice(0, 200)}`);
  }

  const data = await res.json();
  return parseApiResults(data, search);
}

function parseApiResults(data, search) {
  const siteBase = EBAY_SITE_URLS[search.site] || EBAY_SITE_URLS["US"];
  return (data.itemSummaries || []).map((item) => {
    let price = null;
    const priceSource = item.currentBidPrice || item.price || null;
    if (priceSource) {
      const sym = CURRENCY_SYMBOLS[priceSource.currency] || priceSource.currency + " ";
      const label = item.currentBidPrice ? "Bid: " : "";
      price = `${label}${sym}${parseFloat(priceSource.value).toFixed(2)}`;
    }

    let image = item.image?.imageUrl || (item.thumbnailImages && item.thumbnailImages[0]?.imageUrl) || null;
    if (image) image = image.replace(/s-l\d+/, "s-l300");

    // Collect all available images (primary + additional thumbnails), deduped, at full resolution
    const imagesSet = new Set();
    if (item.image?.imageUrl) imagesSet.add(item.image.imageUrl.replace(/s-l\d+/, "s-l1600"));
    if (Array.isArray(item.thumbnailImages)) {
      for (const t of item.thumbnailImages) {
        if (t.imageUrl) imagesSet.add(t.imageUrl.replace(/s-l\d+/, "s-l1600"));
      }
    }
    const images = imagesSet.size > 0 ? [...imagesSet] : image ? [image.replace(/s-l\d+/, "s-l1600")] : [];

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
      id: `${search.id}_${numericId}`,
      itemId: numericId,
      searchId: search.id,
      searchName: search.name,
      cardColor: search.cardColor || null,
      site: search.site,
      source: "ebay",
      title: item.title,
      price,
      shipping,
      condition: item.condition || null,
      image,
      images,
      url: itemUrl,
      buyingFormats,
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
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      "X-EBAY-C-MARKETPLACE-ID": marketplaceId,
    },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`eBay item fetch failed (${res.status}): ${text.slice(0, 200)}`);
  }
  const data = await res.json();
  const images = [];
  if (data.image?.imageUrl) images.push(data.image.imageUrl.replace(/s-l\d+/, "s-l1600"));
  if (Array.isArray(data.additionalImages)) {
    for (const img of data.additionalImages) {
      if (img.imageUrl) images.push(img.imageUrl.replace(/s-l\d+/, "s-l1600"));
    }
  }
  return images;
}

module.exports = { configure, getAccessToken, invalidateToken, search, loadCategoryTree, getItemImages };
