// ─── URL Import ───────────────────────────────────────────────────────────────
// Parses eBay and Vinted search URLs into form data and populates the search modal.
// Depends on: shared/constants.js (toEbayConditionIds, toVintedConditionIds)

// ─── Domain → Site Mappings ───────────────────────────────────────────────────
const EBAY_DOMAIN_TO_SITE = {
  "www.ebay.com": "US",
  "www.ebay.co.uk": "UK",
  "www.ebay.com.au": "AU",
  "www.ebay.ca": "CA",
  "www.ebay.de": "DE",
  "www.ebay.fr": "FR",
  "www.ebay.es": "ES",
  "www.ebay.it": "IT",
};

const VINTED_DOMAIN_TO_SITE = {
  "www.vinted.co.uk": "UK",
  "www.vinted.fr": "FR",
  "www.vinted.de": "DE",
  "www.vinted.be": "BE",
  "www.vinted.es": "ES",
  "www.vinted.it": "IT",
  "www.vinted.nl": "NL",
  "www.vinted.pl": "PL",
  "www.vinted.com": "US",
};

// eBay system params that are NOT aspect filters
const EBAY_SYSTEM_PARAMS = new Set([
  "_nkw",
  "_dcat",
  "_sacat",
  "_from",
  "_fsrp",
  "_dmd",
  "_dmpt",
  "_trksid",
  "_blrs",
  "_pgn",
  "_skc",
  "_stpos",
  "_sop",
  "_ipg",
  "_udlo",
  "_udhi",
  "_mPrRngCbx",
  "hash",
  "rt",
  "_odkw",
  "_osacat",
  "_oexkw",
  "_fss",
  "_fcid",
  "_localstpos",
  "_pppn",
  "_sargn",
]);

// eBay LH_ params handled specifically
const EBAY_LH_PARAMS = new Set(["LH_BIN", "LH_Auction", "LH_PrefLoc", "LH_ItemCondition", "LH_Complete", "LH_Sold", "LH_FS"]);

// Vinted params that should not become category filters. `status_ids[]` is the
// condition filter, which has its own picker — leaving it here too would put the
// same attribute in two places in the form.
const VINTED_SYSTEM_PARAMS = new Set([
  "search_text",
  "catalog[]",
  "status_ids[]",
  "price_from",
  "price_to",
  "order",
  "page",
  "per_page",
  "time",
  "search_id",
]);

/**
 * Attempt to parse a URL string as an eBay or Vinted search URL.
 * Returns { source, site, ...formFields } on success, or null if unrecognised.
 */
function parseSearchUrl(urlString) {
  let url;
  try {
    url = new URL(urlString.trim());
  } catch {
    return null;
  }

  const hostname = url.hostname.toLowerCase();

  if (EBAY_DOMAIN_TO_SITE[hostname]) return parseEbayUrl(url, hostname);
  if (VINTED_DOMAIN_TO_SITE[hostname]) return parseVintedUrl(url, hostname);

  return null;
}

// ─── eBay URL Parsing ─────────────────────────────────────────────────────────
function parseEbayUrl(url, hostname) {
  const site = EBAY_DOMAIN_TO_SITE[hostname];
  const params = url.searchParams;

  // Keywords
  const keywords = params.get("_nkw") || "";

  // Category — from _dcat param or URL path (e.g. /sch/139973/i.html)
  let category = params.get("_dcat") || params.get("_sacat") || "";
  if (!category) {
    const pathMatch = url.pathname.match(/\/sch\/(\d+)\//);
    if (pathMatch) category = pathMatch[1];
  }

  // Price
  const minPrice = params.get("_udlo") || "";
  const maxPrice = params.get("_udhi") || "";

  // Buying format
  let format = "all";
  if (params.get("LH_BIN") === "1") format = "buy_now";
  else if (params.get("LH_Auction") === "1") format = "auction";

  // Conditions
  const conditionRaw = params.get("LH_ItemCondition") || "";
  const conditions = conditionRaw
    ? conditionRaw
        .split("|")
        .map((c) => c.trim())
        .filter(Boolean)
    : [];

  // Item location — LH_PrefLoc=1 means "domestic only"
  let itemLocation = "";
  if (params.get("LH_PrefLoc") === "1") {
    // Map eBay site to the domestic country code
    const siteToCountry = { US: "US", UK: "GB", AU: "AU", CA: "CA", DE: "DE", FR: "FR", ES: "ES", IT: "IT" };
    itemLocation = siteToCountry[site] || "";
  }

  // Aspect filters — any param that isn't a system param or LH_ param
  const aspectFilters = [];
  for (const [key, rawValue] of params.entries()) {
    if (key.startsWith("_") || key.startsWith("LH_") || EBAY_SYSTEM_PARAMS.has(key) || EBAY_LH_PARAMS.has(key)) continue;

    // Values are pipe-separated; double-encoded spaces show up as %2520
    let decoded = rawValue;
    try {
      decoded = decodeURIComponent(rawValue);
    } catch {
      /* already decoded */
    }
    const values = decoded
      .split("|")
      .map((v) => v.trim())
      .filter((v) => v && v !== "!");
    if (values.length > 0) {
      aspectFilters.push({ name: key, values: values.join(", ") });
    }
  }

  // Generate a sensible name
  const name = [keywords, `eBay ${site}`].filter(Boolean).join(" — ");

  return {
    source: "ebay",
    site,
    name,
    keywords,
    category,
    minPrice,
    maxPrice,
    format,
    conditions,
    itemLocation,
    aspectFilters,
    vintedCategory: null,
    vintedFilters: [],
    vintedConditions: [],
  };
}

// ─── Vinted URL Parsing ───────────────────────────────────────────────────────
function parseVintedUrl(url, hostname) {
  const site = VINTED_DOMAIN_TO_SITE[hostname];
  const params = url.searchParams;

  // Keywords
  const keywords = params.get("search_text") || "";

  // Category
  const vintedCategory = params.get("catalog[]") || params.getAll("catalog[]")[0] || "";

  // Price
  const minPrice = params.get("price_from") || "";
  const maxPrice = params.get("price_to") || "";

  // Condition — repeated as one status_ids[] per condition. Normalised here so a
  // value Vinted no longer uses is dropped instead of saved into a filter that
  // would return nothing at all.
  const vintedConditions = toVintedConditionIds(params.getAll("status_ids[]"));

  // Vinted-specific filters — any param with [] that isn't a system param
  const vintedFilters = [];
  const filterMap = new Map(); // key → Set of values (handles repeated params)
  for (const [key, value] of params.entries()) {
    if (VINTED_SYSTEM_PARAMS.has(key)) continue;
    // Most Vinted filter params end with [] (e.g. video_game_platform_ids[])
    if (!key.endsWith("[]")) continue;
    const baseName = key.replace(/\[\]$/, "");
    if (!filterMap.has(baseName)) filterMap.set(baseName, new Set());
    filterMap.get(baseName).add(value);
  }
  for (const [baseName, valuesSet] of filterMap) {
    vintedFilters.push({ name: baseName, values: [...valuesSet].join(",") });
  }

  // Generate a sensible name
  const name = [keywords, `Vinted ${site}`].filter(Boolean).join(" — ");

  return {
    source: "vinted",
    site,
    name,
    keywords,
    vintedCategory,
    minPrice,
    maxPrice,
    format: "all",
    conditions: [],
    itemLocation: "",
    aspectFilters: [],
    vintedFilters,
    vintedConditions,
  };
}

// ─── UI Integration ───────────────────────────────────────────────────────────

/** Toggle the URL import section visibility. */
function toggleUrlImport() {
  const section = document.getElementById("url-import-section");
  const input = document.getElementById("url-import-input");
  const isHidden = section.classList.contains("hidden");
  section.classList.toggle("hidden");
  if (isHidden) {
    input.value = "";
    input.focus();
  }
}

/** Parse the URL in the import input and populate the search form. */
function importSearchFromUrl() {
  const input = document.getElementById("url-import-input");
  const urlString = input.value.trim();
  if (!urlString) {
    showToast("Please paste a search URL", "error");
    input.focus();
    return;
  }

  const parsed = parseSearchUrl(urlString);
  if (!parsed) {
    showToast("Unrecognised URL — paste an eBay or Vinted search URL", "error");
    input.focus();
    return;
  }

  // Populate the form
  document.getElementById("modal-name").value = parsed.name;
  setSearchModalSource(parsed.source);

  if (parsed.source === "vinted") {
    document.getElementById("modal-vinted-site").value = parsed.site;
    document.getElementById("modal-vinted-category").value = parsed.vintedCategory || "";
    setVintedConditions(parsed.vintedConditions);
    // Load Vinted filters
    clearVintedFilters();
    for (const vf of parsed.vintedFilters) {
      addVintedFilter();
      const lastFilter = vintedFilters[vintedFilters.length - 1];
      if (lastFilter) {
        updateVintedFilter(lastFilter.id, "name", vf.name);
        updateVintedFilter(lastFilter.id, "values", vf.values);
      }
    }
  } else {
    document.getElementById("modal-site").value = parsed.site;
    document.getElementById("modal-category").value = parsed.category || "";
    document.getElementById("modal-location").value = parsed.itemLocation || "";
    document.getElementById("modal-format").value = parsed.format || "all";
    // load conditions — eBay's LH_ItemCondition already carries the numeric IDs
    // the app stores, but run them through the same normaliser so anything
    // unrecognised is dropped rather than widening the search once it is saved.
    selectedConditions = toEbayConditionIds(parsed.conditions);
    updateConditionDisplay();
    // Load aspect filters
    clearAspectFilters();
    for (const af of parsed.aspectFilters) {
      addAspectFilter();
      const lastFilter = aspectFilters[aspectFilters.length - 1];
      if (lastFilter) {
        updateAspectFilter(lastFilter.id, "name", af.name);
        updateAspectFilter(lastFilter.id, "values", af.values);
      }
    }
    // Load category tree for eBay site
    loadCategoryTreeForModal(parsed.site, parsed.category || "");
  }

  document.getElementById("modal-keywords").value = parsed.keywords;
  document.getElementById("modal-min-price").value = parsed.minPrice || "";
  document.getElementById("modal-max-price").value = parsed.maxPrice || "";

  // Collapse the import section
  document.getElementById("url-import-section").classList.add("hidden");
  showToast(`Imported ${parsed.source === "vinted" ? "Vinted" : "eBay"} search — review fields and save`, "success");
}
