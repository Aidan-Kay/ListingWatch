"use strict";

class Item {
  /**
   * @param {Object} data  Raw item object from the Vinted API response.
   */
  constructor(data) {
    this.rawData = data;
    this.id = data.id;
    this.title = data.title;
    this.brandTitle = data.brand_title;
    this.sizeTitle = data.size_title ?? null;
    this.currency = data.price?.currency_code ?? null;
    this.price = data.price?.amount ?? null;
    this.photo = data.photo?.url ?? null;
    this.url = data.url;

    const ts = data.photo?.high_resolution?.timestamp ?? null;
    this.createdAtTs = ts != null ? new Date(ts * 1000) : null;
    this.rawTimestamp = ts;
  }

  equals(other) {
    return this.id === other.id;
  }
}

module.exports = { Item };
