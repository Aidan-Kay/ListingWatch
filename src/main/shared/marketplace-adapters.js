"use strict";

// Marketplace adapter registry. Each adapter must export a `search(query)`
// function returning an array of normalised ListingItem objects, and a
// `getItemImages(itemId, site)` function returning an array of image URLs.
//
// To add a new marketplace, implement those two functions and add an entry here.
// `polling.js`, `ipc-handlers.js`, etc. all dispatch through this map so no
// other file needs to change.

const ebay = require("../ebay/ebay");
const vinted = require("../vinted/vinted");

const ADAPTERS = Object.freeze({
  ebay,
  vinted,
});

/**
 * Get the marketplace adapter for a given source.
 * @param {string} source
 * @returns {{search: Function, getItemImages: Function}}
 */
function getAdapter(source) {
  const adapter = ADAPTERS[source];
  if (!adapter) {
    throw new Error(`Unknown marketplace source: ${source}`);
  }
  return adapter;
}

module.exports = { ADAPTERS, getAdapter };
