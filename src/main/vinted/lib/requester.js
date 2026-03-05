"use strict";

const { BrowserWindow, session } = require("electron");
const { isTransientError } = require("../../shared/retry");

/**
 * Vinted-specific HTTP client.
 *
 * Uses a persistent hidden BrowserWindow to make API requests from within a
 * real browser page context.  This ensures:
 *
 * - Chromium TLS fingerprint (passes Cloudflare bot-detection)
 * - Correct same-origin `Sec-Fetch-*` headers
 * - Automatic cookie management (`cf_clearance`, session cookies)
 * - Cloudflare JS challenges execute naturally in the page
 *
 * Each VintedClient maintains exactly one hidden window for its domain.
 */
class VintedClient {
  /**
   * @param {string} domain  e.g. "www.vinted.co.uk"
   * @param {string|null} [proxy]  Optional proxy URL, e.g. "http://host:port"
   */
  constructor(domain = "www.vinted.co.uk", proxy = null) {
    this._domain = domain;
    this._baseUrl = `https://${domain}/`;
    this._maxRetries = 3;
    this._retryBaseDelay = 1000;
    this._partition = `persist:vinted-${domain}`;
    this._session = session.fromPartition(this._partition);
    this._win = null;
    this._windowReady = false;
    this._windowInitPromise = null;

    // Configure proxy on the session (resolves almost instantly).
    this._proxyReady = proxy ? this._session.setProxy({ proxyRules: proxy }) : Promise.resolve();
  }

  // ─── Browser Window Management ──────────────────────────────────────────────

  /**
   * Return the persistent BrowserWindow, creating it if needed.
   * Loads the Vinted homepage to establish session cookies.
   * Concurrent callers share a single in-flight initialisation.
   * @returns {Promise<BrowserWindow>}
   */
  async _ensureWindow() {
    if (this._win && !this._win.isDestroyed() && this._windowReady) {
      return this._win;
    }
    if (!this._windowInitPromise) {
      this._windowInitPromise = this._createWindow().finally(() => {
        this._windowInitPromise = null;
      });
    }
    return this._windowInitPromise;
  }

  /**
   * Create a fresh hidden BrowserWindow and load the homepage.
   * @returns {Promise<BrowserWindow>}
   */
  async _createWindow() {
    await this._proxyReady;

    if (this._win && !this._win.isDestroyed()) {
      this._win.destroy();
    }

    const win = new BrowserWindow({
      show: false,
      width: 800,
      height: 600,
      webPreferences: {
        session: this._session,
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
      },
    });

    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        console.log(`[vinted] Homepage load timed out for ${this._domain}`);
        resolve();
      }, 20000);

      win.webContents.on("did-finish-load", () => {
        clearTimeout(timer);
        // Give Cloudflare JS a moment to set cookies.
        setTimeout(resolve, 1500);
      });

      win.loadURL(this._baseUrl).catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
    });

    this._win = win;
    this._windowReady = true;
    console.log(`[vinted] Browser window ready for ${this._domain}`);
    return win;
  }

  /**
   * Tear down and reset the window (e.g. after persistent challenge failures).
   * @returns {Promise<void>}
   */
  async _resetWindow() {
    this._windowReady = false;
    if (this._win && !this._win.isDestroyed()) {
      this._win.destroy();
    }
    this._win = null;
    await this._session.clearStorageData();
  }

  // ─── HTTP ───────────────────────────────────────────────────────────────────

  /**
   * Perform an HTTP GET request by executing `fetch()` inside the hidden
   * BrowserWindow's page context.  This produces a genuine same-origin XHR
   * with all the correct browser headers and cookies.
   *
   * @param {string} url      - Full URL to fetch.
   * @param {Object} [params] - Query parameters (appended to URL).
   * @returns {Promise<{ status: number, data: any }>}
   */
  async get(url, params = {}) {
    let tried = 0;
    while (tried < this._maxRetries) {
      tried++;
      const isLast = tried >= this._maxRetries;

      try {
        const win = await this._ensureWindow();
        const fullUrl = this._buildUrl(url, params);

        // Execute fetch from within the browser page context.
        const result = await win.webContents.executeJavaScript(`
          fetch(${JSON.stringify(fullUrl)}, {
            headers: {
              "Accept": "application/json, text/plain, */*",
              "Accept-Language": "en-GB,en;q=0.5",
              "X-Requested-With": "XMLHttpRequest"
            },
            credentials: "same-origin"
          }).then(async (r) => {
            const ct = r.headers.get("content-type") || "";
            const body = await r.text();
            return { status: r.status, contentType: ct, body: body };
          })
        `);

        // Check for HTML challenge response (Cloudflare).
        if (result.contentType.includes("text/html")) {
          console.log(`[vinted] HTML challenge on attempt ${tried}/${this._maxRetries} (status ${result.status})`);
          if (isLast) throw new Error("Received HTML challenge page instead of JSON after all retry attempts");
          await this._resetWindow();
          const delay = this._retryBaseDelay * Math.pow(2, tried - 1);
          await new Promise((r) => setTimeout(r, delay));
          continue;
        }

        const data = JSON.parse(result.body);
        return { status: result.status, data };
      } catch (err) {
        if (isLast || !isTransientError(err)) throw err;

        const delay = this._retryBaseDelay * Math.pow(2, tried - 1);
        console.warn(`[vinted] Error on attempt ${tried}/${this._maxRetries}, retrying in ${delay}ms: ${err.message}`);
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }

  // ─── Helpers ────────────────────────────────────────────────────────────────

  /**
   * Build a full URL with query parameters.
   * @param {string} url
   * @param {Object} params
   * @returns {string}
   */
  _buildUrl(url, params) {
    const entries = Object.entries(params).filter(([, v]) => v !== undefined && v !== null);
    if (entries.length === 0) return url;
    const parts = [];
    for (const [k, v] of entries) {
      const values = Array.isArray(v) ? v : [v];
      for (const val of values) {
        parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(val)}`);
      }
    }
    const qs = parts.join("&");
    return url.includes("?") ? `${url}&${qs}` : `${url}?${qs}`;
  }

  /** Clean up resources when the client is no longer needed. */
  destroy() {
    if (this._win && !this._win.isDestroyed()) {
      this._win.destroy();
    }
    this._win = null;
    this._windowReady = false;
  }
}

// Per-domain requester pool — eliminates cookie/locale race conditions when
// multiple Vinted searches target different country sites concurrently.
const _requesters = new Map();

// Active proxy URL — set via configureRequesterProxy(). Requester pool is
// keyed by domain only; changing the proxy invalidates the entire pool.
let _activeProxy = null;

/**
 * Return (or create) a VintedClient for the given domain.
 * @param {string} domain  e.g. "www.vinted.co.uk"
 * @returns {VintedClient}
 */
function getRequester(domain) {
  if (!_requesters.has(domain)) {
    _requesters.set(domain, new VintedClient(domain, _activeProxy));
  }
  return _requesters.get(domain);
}

/**
 * Set (or clear) the proxy URL used for all new Vinted requesters.
 * Clears the requester pool so that new clients pick up the updated proxy.
 * @param {string|null} proxyUrl
 */
function configureRequesterProxy(proxyUrl) {
  _activeProxy = proxyUrl || null;
  _requesters.clear();
  if (_activeProxy) {
    console.log(`[vinted] Proxy configured: ${_activeProxy}`);
  } else {
    console.log("[vinted] Proxy cleared");
  }
}

module.exports = { VintedClient, getRequester, configureRequesterProxy };
