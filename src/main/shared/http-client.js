"use strict";

const { Impit } = require("impit");
const { CookieJar } = require("tough-cookie");
const { isTransientError } = require("./retry");

/**
 * Generic HTTP client with browser-like TLS fingerprinting (via impit),
 * cookie jar support, retry with exponential backoff, and concurrent-safe
 * auth refresh.
 *
 * Subclasses must implement `refreshAuth()` to provide platform-specific
 * authentication (e.g. fetching session cookies from a homepage).
 */
class HttpClient {
  /**
   * @param {Object}  options
   * @param {string}  options.baseUrl        - Base URL for auth requests.
   * @param {Object}  [options.headers]      - Default headers for every request.
   * @param {number}  [options.timeout]      - Request timeout in ms (default: 20000).
   * @param {number}  [options.maxRetries]   - Max retry attempts (default: 3).
   * @param {number}  [options.retryBaseDelay] - Initial backoff delay in ms (default: 1000).
   * @param {string}  [options.browser]      - Browser to impersonate: "chrome" | "firefox" (default: "chrome").
   */
  constructor({ baseUrl, headers = {}, timeout = 20000, maxRetries = 3, retryBaseDelay = 1000, browser = "chrome" } = {}) {
    this._baseUrl = baseUrl;
    this._maxRetries = maxRetries;
    this._retryBaseDelay = retryBaseDelay;
    this._authReady = false;
    this._authRefreshPromise = null;

    this._jar = new CookieJar();
    this._client = new Impit({
      browser,
      timeout,
      headers,
      cookieJar: this._jar,
    });
  }

  // ─── Auth ─────────────────────────────────────────────────────────────────

  /**
   * Platform-specific auth logic. Subclasses override this.
   * Called when no auth exists or when a 401/403 invalidates the current session.
   * @returns {Promise<void>}
   */
  async refreshAuth() {
    throw new Error("HttpClient.refreshAuth() must be implemented by subclass");
  }

  /**
   * Ensure auth is ready. Concurrent callers share a single in-flight refresh
   * to avoid duplicate requests.
   * @returns {Promise<void>}
   */
  ensureAuth() {
    if (!this._authRefreshPromise) {
      this._authRefreshPromise = this._refreshAuthWithRetry().finally(() => {
        this._authRefreshPromise = null;
      });
    }
    return this._authRefreshPromise;
  }

  /**
   * Retry auth refresh with exponential backoff.
   * @returns {Promise<void>}
   */
  async _refreshAuthWithRetry() {
    let lastErr;
    for (let attempt = 0; attempt < this._maxRetries; attempt++) {
      try {
        await this.refreshAuth();
        this._authReady = true;
        return;
      } catch (err) {
        lastErr = err;
        const delay = this._retryBaseDelay * Math.pow(2, attempt);
        if (attempt < this._maxRetries - 1) {
          console.warn(
            `[http-client] Auth refresh failed (attempt ${attempt + 1}/${this._maxRetries}), retrying in ${delay}ms: ${err.message}`,
          );
          await new Promise((r) => setTimeout(r, delay));
        } else {
          console.error(`[http-client] Auth refresh failed (attempt ${attempt + 1}/${this._maxRetries}): ${err.message}`);
        }
      }
    }
    this._authReady = false;
    throw new Error(`Auth refresh failed after ${this._maxRetries} attempts: ${lastErr.message}`);
  }

  // ─── HTTP Methods ─────────────────────────────────────────────────────────

  /**
   * Perform an HTTP GET request with retry and auth-refresh-on-401/403.
   *
   * Returns a normalised response: `{ status, data }` where `data` is the
   * parsed JSON body.
   *
   * @param {string} url     - Full URL to fetch.
   * @param {Object} [params] - Query parameters (appended to URL).
   * @returns {Promise<{ status: number, data: any }>}
   */
  async get(url, params = {}) {
    if (!this._authReady) {
      await this.ensureAuth();
    }

    let tried = 0;
    while (tried < this._maxRetries) {
      tried++;
      const isLast = tried >= this._maxRetries;
      try {
        const fullUrl = this._buildUrl(url, params);
        const response = await this._client.fetch(fullUrl);
        const data = await response.json();
        return { status: response.status, data };
      } catch (err) {
        const status = err.status || err.response?.status;

        if (status === 401 || status === 403) {
          console.log(`[http-client] Session rejected (${status}) on attempt ${tried}/${this._maxRetries}`);
          if (isLast) throw err;
          this._authReady = false;
          await this.ensureAuth();
          continue;
        }

        if (isLast || !isTransientError(err)) throw err;

        const delay = this._retryBaseDelay * Math.pow(2, tried - 1);
        console.warn(`[http-client] Transient error (attempt ${tried}/${this._maxRetries}), retrying in ${delay}ms:`, err.message);
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  /**
   * Build a full URL with query parameters.
   * @param {string} url
   * @param {Object} params
   * @returns {string}
   */
  _buildUrl(url, params) {
    const entries = Object.entries(params).filter(([, v]) => v !== undefined && v !== null);
    if (entries.length === 0) return url;
    const qs = entries.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&");
    return url.includes("?") ? `${url}&${qs}` : `${url}?${qs}`;
  }
}

module.exports = { HttpClient };
