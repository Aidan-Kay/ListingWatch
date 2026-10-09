"use strict";

/**
 * Resolve a catalogue URL against its site domain.
 * The catalogue service returns item URLs relative to the site root
 * ("/items/123-slug"); other Vinted services return them absolute.
 * @param {string|null|undefined} url
 * @param {string} domain
 * @returns {string|null}
 */
function absoluteUrl(url, domain) {
  if (!url) return null;
  if (/^https?:\/\//i.test(url)) return url;
  return `https://${domain}${url.startsWith("/") ? "" : "/"}${url}`;
}

class Item {
  /**
   * @param {Object} data    Raw item object from the catalogue service.
   * @param {string} domain  Site domain, used to absolutise the listing URL.
   */
  constructor(data, domain) {
    this.rawData = data;
    this.id = data.id;
    this.title = data.title ?? null;

    // `item_box` carries what the retired endpoint exposed as top-level
    // `brand_title` and `size_title`. Its `second_line` is size and condition
    // joined ("M / UK 12-14 · Very good"), or condition alone when the listing
    // has no size — and it is localised by the request's Locale header, so
    // without that header it comes back in French whatever the domain.
    this.brandTitle = data.item_box?.first_line ?? null;
    this.conditionTitle = data.item_box?.second_line ?? null;

    this.currency = data.price?.currency_code ?? null;
    this.price = data.price?.amount ?? null;
    // Price the buyer actually pays, including Buyer Protection.
    this.totalPrice = data.total_item_price?.amount ?? null;

    // `url` is the f800 render used for the feed thumbnail; `full_size_url` is
    // the larger original kept for the lightbox.
    this.photo = data.photo?.url ?? data.photo?.full_size_url ?? null;
    // Catalogue results carry only the main photo; the full set is no longer
    // reachable from the web API at all (see getItemImages in vinted.js).
    const photos = Array.isArray(data.photos) ? data.photos : [];
    this.photos = photos.map((p) => p.full_size_url || p.url).filter(Boolean);
    if (this.photos.length === 0 && this.photo) this.photos = [this.photo];

    this.url = absoluteUrl(data.url, domain);

    // The catalogue service returns no listing timestamp of any kind — both
    // `created_at_ts` and the photo's `high_resolution.timestamp` are gone — so
    // a listing's true age is simply not knowable from this API. Callers stand
    // in the time the app first saw the listing instead.
  }
}

module.exports = { Item, absoluteUrl };
