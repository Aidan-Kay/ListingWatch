"use strict";

const axios = require("axios");
const { wrapper } = require("axios-cookiejar-support");
const { CookieJar } = require("tough-cookie");
const { isTransientError } = require("../../shared/retry");

const REQUEST_TIMEOUT_MS = 20000;

class Requester {
  /**
   * @param {string} domain  e.g. "www.vinted.co.uk"
   */
  constructor(domain = "www.vinted.co.uk") {
    this.MAX_RETRIES = 3;
    this.RETRY_BASE_DELAY_MS = 1000;
    this.VINTED_AUTH_URL = `https://${domain}/`;
    this._cookiesFetched = false;

    this._cookiesFetchingPromise = null; // deduplicates concurrent setCookies() calls

    this._jar = new CookieJar();
    this._client = wrapper(
      axios.create({
        jar: this._jar,
        withCredentials: true,
        timeout: REQUEST_TIMEOUT_MS,
        headers: this._buildHeaders(),
      }),
    );
  }

  /**
   * Build the standard request headers.
   * Host is intentionally omitted — letting Node.js set it automatically avoids
   * mismatches that cause Vinted to reject requests.
   * @returns {Object}
   */
  _buildHeaders() {
    return {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      Accept: "application/json, text/plain, */*",
      "Accept-Encoding": "gzip, deflate, br, zstd",
      "Accept-Language": "en-GB,*;q=0.5",
      Connection: "keep-alive",
      "X-Requested-With": "XMLHttpRequest",
      "Sec-Fetch-Dest": "empty",
      "Sec-Fetch-Mode": "cors",
      "Sec-Fetch-Site": "same-origin",
    };
  }

  /**
   * Attempt to fetch session cookies, retrying with backoff on failure.
   * Throws if all attempts are exhausted.
   */
  async _fetchCookiesWithRetry() {
    let lastErr;
    for (let attempt = 0; attempt < this.MAX_RETRIES; attempt++) {
      try {
        await this._jar.removeAllCookies();
        await this._client.get(this.VINTED_AUTH_URL, { maxRedirects: 5 });
        this._cookiesFetched = true;
        console.log("[vinted] Cookies set!");
        return;
      } catch (err) {
        lastErr = err;
        const delay = this.RETRY_BASE_DELAY_MS * Math.pow(2, attempt);
        if (attempt < this.MAX_RETRIES - 1) {
          console.warn(`[vinted] Cookie fetch failed (attempt ${attempt + 1}/${this.MAX_RETRIES}), retrying in ${delay}ms: ${err.message}`);
          await new Promise((r) => setTimeout(r, delay));
        } else {
          console.error(`[vinted] Cookie fetch failed (attempt ${attempt + 1}/${this.MAX_RETRIES}): ${err.message}`);
        }
      }
    }
    this._cookiesFetched = false;
    throw new Error(`[vinted] Failed to fetch Vinted session cookies after ${this.MAX_RETRIES} attempts: ${lastErr.message}`);
  }

  /**
   * Fetch session cookies. Concurrent callers share a single in-flight request
   * to avoid duplicate auth. Throws if cookie fetching fails.
   * @returns {Promise<void>}
   */
  setCookies() {
    if (!this._cookiesFetchingPromise) {
      this._cookiesFetchingPromise = this._fetchCookiesWithRetry().finally(() => {
        this._cookiesFetchingPromise = null;
      });
    }
    return this._cookiesFetchingPromise;
  }

  /**
   * Perform an HTTP GET request, retrying on transient errors with backoff.
   * On 401/403, refreshes cookies before retrying.
   * @param {string} url
   * @param {Object} [params]
   * @returns {Promise<import('axios').AxiosResponse>}
   */
  async get(url, params = {}) {
    if (!this._cookiesFetched) {
      await this.setCookies();
    }

    let tried = 0;
    while (tried < this.MAX_RETRIES) {
      tried++;
      const isLast = tried >= this.MAX_RETRIES;
      try {
        return await this._client.get(url, { params });
      } catch (err) {
        const status = err.response?.status;

        if (status === 401 || status === 403) {
          console.log(`[vinted] Session rejected (${status}) on attempt ${tried}/${this.MAX_RETRIES}`);
          if (isLast) throw err;
          this._cookiesFetched = false;
          await this.setCookies(); // throws if cookie refresh fails, aborting further retries
          continue;
        }

        if (isLast || !isTransientError(err)) throw err;

        const delay = this.RETRY_BASE_DELAY_MS * Math.pow(2, tried - 1);
        console.warn(`[vinted] Transient error (attempt ${tried}/${this.MAX_RETRIES}), retrying in ${delay}ms:`, err.message);
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }
}

// Per-domain requester pool — eliminates cookie/locale race conditions when
// multiple Vinted searches target different country sites concurrently.
const _requesters = new Map();

/**
 * Return (or create) a Requester for the given domain.
 * @param {string} domain  e.g. "www.vinted.co.uk"
 * @returns {Requester}
 */
function getRequester(domain) {
  if (!_requesters.has(domain)) {
    _requesters.set(domain, new Requester(domain));
  }
  return _requesters.get(domain);
}

module.exports = { Requester, getRequester };
