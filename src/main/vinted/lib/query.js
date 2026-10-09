"use strict";

// ─── Vinted Catalogue Service ────────────────────────────────────────────────
//
// Vinted retired the monolith's `/api/v2/catalog/items` endpoint (it now answers
// 404 `{"code":104,"message":"Content not found"}`) and moved catalogue search to
// a standalone service on `api.<domain>`. Three things changed with it:
//
//   - the host: www.vinted.co.uk -> api.vinted.co.uk
//   - facet names: `catalog_ids=3026` -> `attribute_ids[catalog]=3026`
//   - multi-value facets must be comma-joined into ONE parameter. Repeating the
//     key (`attribute_ids[catalog]=1&attribute_ids[catalog]=2`) returns 400.
//
// Unrecognised parameters are ignored silently rather than rejected — sending the
// old `catalog_ids` returns 200 and a full, unfiltered page — so a mistake here
// surfaces as wrong results, never as an error. Keep the names exact.

const { toVintedConditionIds } = require("../../../shared/constants");

const VINTED_API_PATH = "/svc-catalogue/items";
const VINTED_PAGE_SIZE = 50;

/**
 * Map a site domain to the host serving its catalogue API.
 * @param {string} domain  e.g. "www.vinted.co.uk"
 * @returns {string}       e.g. "api.vinted.co.uk"
 */
function apiHostFor(domain) {
  return domain.replace(/^www\./, "api.");
}

/**
 * Translate a stored filter key into its `attribute_ids[...]` name.
 *
 * Saved searches hold the spelling used by Vinted's own website URLs, which is
 * what `url-import.js` parses out of a pasted link (`video_game_platform_ids[]`,
 * `catalog[]`, `status_ids`). The catalogue service wants the bare attribute name.
 * The transform is idempotent, so a key already in the new spelling passes through.
 *
 * @param {string} name
 * @returns {string}
 */
function toAttributeName(name) {
  return String(name)
    .trim()
    .replace(/\[\]$/, "")
    .replace(/_ids$/, "");
}

/**
 * Build the query parameters for a catalogue search.
 *
 * Values are returned as plain strings — never arrays — because the requester
 * repeats a key once per array element, which this API rejects with a 400.
 *
 * @param {Object} query  Saved search definition.
 * @param {number} [page] 1-based page number.
 * @returns {Object<string, string|number>}
 */
function buildSearchParams(query, page = 1) {
  const params = {
    page,
    per_page: VINTED_PAGE_SIZE,
    order: "newest_first",
  };

  if (query.keywords) params.search_text = query.keywords;
  if (query.minPrice) params.price_from = query.minPrice;
  if (query.maxPrice) params.price_to = query.maxPrice;

  // Collect every facet into one bucket per attribute so that a category picked
  // in the UI and one arriving through an imported URL merge into a single
  // comma-joined parameter instead of overwriting each other.
  const attributes = new Map();
  const add = (name, rawValues) => {
    const attribute = toAttributeName(name);
    if (!attribute) return;
    const values = attributes.get(attribute) ?? new Set();
    for (const value of String(rawValues).split(",")) {
      const trimmed = value.trim();
      if (trimmed) values.add(trimmed);
    }
    attributes.set(attribute, values);
  };

  if (query.vintedCategory) add("catalog", query.vintedCategory);
  // Conditions are the same six site-wide values everywhere, so they are stored
  // as their own field rather than as a hand-typed filter row — but they share
  // the `status` attribute with one, and the bucket merges the two.
  const conditions = toVintedConditionIds(query.vintedConditions);
  if (conditions.length > 0) add("status", conditions.join(","));
  if (Array.isArray(query.vintedFilters)) {
    for (const filter of query.vintedFilters) {
      if (filter?.name && filter?.values) add(filter.name, filter.values);
    }
  }

  for (const [attribute, values] of attributes) {
    if (values.size > 0) params[`attribute_ids[${attribute}]`] = [...values].join(",");
  }

  return params;
}

module.exports = { VINTED_API_PATH, VINTED_PAGE_SIZE, apiHostFor, toAttributeName, buildSearchParams };
