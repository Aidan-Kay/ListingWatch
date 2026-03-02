"use strict";

const axios = require("axios");
const { wrapper } = require("axios-cookiejar-support");
const { CookieJar } = require("tough-cookie");
const { isTransientError } = require("../../shared/retry");

const REQUEST_TIMEOUT_MS = 20000;

class Requester {
  constructor() {
    this.MAX_RETRIES = 3;
    this.RETRY_BASE_DELAY_MS = 1000;
    this.VINTED_AUTH_URL = "https://www.vinted.fr/";
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
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
      "Accept-Language": "en-GB,en;q=0.5",
      "Accept-Encoding": "gzip, deflate, br",
      Referer: "https://www.google.com/",
      Connection: "keep-alive",
      "Upgrade-Insecure-Requests": "1",
    };
  }

  /**
   * Update the locale (domain) used for requests.
   * @param {string} locale  e.g. "www.vinted.co.uk"
   */
  setLocale(locale) {
    const newUrl = `https://${locale}/`;
    if (newUrl === this.VINTED_AUTH_URL) return; // same locale, keep existing cookies
    this.VINTED_AUTH_URL = newUrl;
    this._cookiesFetched = false;
    this._cookiesFetchingPromise = null; // invalidate any in-flight auth for the old locale
    this._client.defaults.headers.common = {
      ...this._buildHeaders(),
    };
  }

  /**
   * Perform a GET request to the Vinted homepage so session cookies are set.
   * Concurrent callers share a single in-flight request to avoid duplicate auth.
   */
  setCookies() {
    if (!this._cookiesFetchingPromise) {
      this._cookiesFetchingPromise = this._jar
        .removeAllCookies()
        .then(() => this._client.get(this.VINTED_AUTH_URL, { responseType: "text", maxRedirects: 5 }))
        .then(() => {
          this._cookiesFetched = true;
          this._cookiesFetchingPromise = null;
          console.log("[vinted] Cookies set!");
        })
        .catch((err) => {
          // Even a non-2xx status may have set cookies; treat as non-fatal.
          this._cookiesFetched = true;
          this._cookiesFetchingPromise = null;
          console.warn(`[vinted] Cookie fetch warning: ${err.message}`);
        });
    }
    return this._cookiesFetchingPromise;
  }

  /**
   * Perform an HTTP GET request, refreshing cookies proactively and retrying on
   * transient errors (401, 429, 5xx, network/timeout failures).
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
      try {
        const response = await this._client.get(url, { params });
        return response;
      } catch (err) {
        const status = err.response && err.response.status;
        const isLast = tried >= this.MAX_RETRIES;

        if (isLast) throw err;

        // 401 → cookie expired, refresh and retry immediately
        if (status === 401) {
          console.log(`[vinted] Cookies invalid, retrying ${tried}/${this.MAX_RETRIES}`);
          await this.setCookies();
          continue;
        }

        // Other transient errors → backoff and retry
        if (isTransientError(err)) {
          const delay = this.RETRY_BASE_DELAY_MS * Math.pow(2, tried - 1);
          console.warn(`[vinted] Transient error (attempt ${tried}/${this.MAX_RETRIES}), retrying in ${delay}ms:`, err.message);
          await new Promise((r) => setTimeout(r, delay));
          continue;
        }

        // Non-transient error → throw immediately
        throw err;
      }
    }
  }
}

// Singleton – one shared requester instance across the app.
const requester = new Requester();

module.exports = { Requester, requester };
