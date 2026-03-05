"use strict";

const { HttpClient } = require("../../shared/http-client");

// ─── Vinted-Specific Headers ──────────────────────────────────────────────────
const VINTED_HEADERS = {
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "en-GB,*;q=0.5",
  "X-Requested-With": "XMLHttpRequest",
  "Sec-Fetch-Dest": "empty",
  "Sec-Fetch-Mode": "cors",
  "Sec-Fetch-Site": "same-origin",
};

/**
 * Vinted-specific HTTP client.
 *
 * Extends `HttpClient` with Vinted's cookie-based authentication flow:
 * visits the Vinted homepage to acquire session cookies, then uses those
 * cookies for subsequent API requests.
 */
class VintedClient extends HttpClient {
  /**
   * @param {string} domain  e.g. "www.vinted.co.uk"
   */
  constructor(domain = "www.vinted.co.uk") {
    super({
      baseUrl: `https://${domain}/`,
      headers: VINTED_HEADERS,
      timeout: 20000,
      maxRetries: 3,
      retryBaseDelay: 1000,
      browser: "chrome",
    });
    this._domain = domain;
  }

  /**
   * Vinted auth: clear cookies and visit the homepage to acquire fresh
   * session cookies.
   * @returns {Promise<void>}
   */
  async refreshAuth() {
    await this._jar.removeAllCookies();
    await this._client.fetch(this._baseUrl);
    console.log(`[vinted] Cookies set for ${this._domain}!`);
  }
}

// Per-domain requester pool — eliminates cookie/locale race conditions when
// multiple Vinted searches target different country sites concurrently.
const _requesters = new Map();

/**
 * Return (or create) a VintedClient for the given domain.
 * @param {string} domain  e.g. "www.vinted.co.uk"
 * @returns {VintedClient}
 */
function getRequester(domain) {
  if (!_requesters.has(domain)) {
    _requesters.set(domain, new VintedClient(domain));
  }
  return _requesters.get(domain);
}

module.exports = { VintedClient, getRequester };
