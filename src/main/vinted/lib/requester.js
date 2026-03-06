"use strict";

const { BrowserWindow, session } = require("electron");
const { isTransientError } = require("../../shared/retry");

// ─── Cloudflare Detection ──────────────────────────────────────────────────

/** Markers in HTML body that indicate a Cloudflare challenge page. */
const CF_MARKERS = ["challenges.cloudflare.com", "Just a moment", "cf-turnstile", "cdn-cgi/challenge-platform"];

/**
 * Determine whether an HTML response body is a Cloudflare challenge page
 * (as opposed to a genuine HTML error from Vinted's own servers).
 * @param {string} body  Raw HTML response body.
 * @returns {boolean}
 */
function isCloudflareChallenge(body) {
  return CF_MARKERS.some((marker) => body.includes(marker));
}

/**
 * Check whether a URL belongs to Cloudflare's challenge infrastructure.
 * Used to exclude CF resources from the network-resource blocker.
 * @param {string} url
 * @returns {boolean}
 */
function isCloudflareUrl(url) {
  return url.includes("challenges.cloudflare.com") || url.includes("cdn-cgi/challenge-platform");
}

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

    // Block heavy resources that aren't needed for cookie / JS-challenge
    // establishment. This cuts network load in the hidden window and reduces
    // the surface area for network-service crashes caused by media/image
    // fetches. Cloudflare challenge URLs are always allowed through — Turnstile
    // needs its own stylesheets and scripts to render and solve.
    const BLOCKED_TYPES = new Set(["image", "stylesheet", "font", "media", "ping", "cspReport"]);
    this._session.webRequest.onBeforeRequest({ urls: ["<all_urls>"] }, (details, callback) => {
      if (isCloudflareUrl(details.url)) {
        callback({ cancel: false });
        return;
      }
      callback({ cancel: BLOCKED_TYPES.has(details.resourceType) });
    });

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

    this._win = win;
    await this._navigateAndWaitForChallenge(this._baseUrl);
    this._windowReady = true;
    console.log(`[vinted] Browser window ready for ${this._domain}`);
    return win;
  }

  /**
   * Navigate the BrowserWindow to a URL and wait for any Cloudflare
   * challenge to resolve. Works for both initial homepage loads and
   * mid-session challenge solving.
   *
   * Strategy: load the URL, then watch for either:
   *   (a) `did-navigate` to a URL on our domain (CF solved, redirected), or
   *   (b) `did-finish-load` on a non-challenge page (no CF, or CF already passed)
   *
   * A 30-second timeout acts as a safety net — if CF can't solve in that
   * time, we resolve anyway and let the caller decide.
   *
   * @param {string} url  URL to navigate to (usually the homepage).
   * @returns {Promise<void>}
   */
  async _navigateAndWaitForChallenge(url) {
    const win = this._win;
    if (!win || win.isDestroyed()) return;

    const MAX_WAIT = 30_000;

    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        console.warn(`[vinted] Challenge wait timed out after ${MAX_WAIT / 1000}s for ${this._domain}`);
        resolve();
      }, MAX_WAIT);

      const cleanup = () => {
        clearTimeout(timer);
        win.webContents.removeListener("did-navigate", onNavigate);
        win.webContents.removeListener("did-finish-load", onFinishLoad);
      };

      const onNavigate = (_event, navUrl) => {
        // Cloudflare redirects to our domain once the challenge is solved.
        // Ignore navigations to challenge subdomains / cdn-cgi paths.
        if (navUrl.startsWith(this._baseUrl) && !navUrl.includes("cdn-cgi/")) {
          cleanup();
          // Small buffer for final cookie writes after redirect.
          setTimeout(resolve, 2000);
        }
      };

      const onFinishLoad = () => {
        const currentUrl = win.webContents.getURL();
        // If we finished loading and it's our domain (not a challenge interstitial),
        // we're done. If it's a CF challenge page, keep waiting for the redirect.
        if (currentUrl.startsWith(this._baseUrl) && !currentUrl.includes("cdn-cgi/")) {
          cleanup();
          setTimeout(resolve, 2000);
        }
      };

      win.webContents.on("did-navigate", onNavigate);
      win.webContents.on("did-finish-load", onFinishLoad);

      win.loadURL(url).catch((err) => {
        cleanup();
        reject(err);
      });
    });
  }

  /**
   * Solve a Cloudflare challenge by navigating the existing BrowserWindow
   * to the homepage. Cloudflare's JS executes naturally during the page
   * load, computes the challenge response, sets the `cf_clearance` cookie,
   * and redirects to the real page.
   *
   * Unlike `_resetWindow()`, this preserves the window and its cookies —
   * destroying them would lose exactly the context Cloudflare needs.
   *
   * @returns {Promise<void>}
   */
  async _solveChallenge() {
    if (!this._win || this._win.isDestroyed()) {
      // Window was lost — fall back to full recreation.
      this._windowReady = false;
      this._win = null;
      await this._ensureWindow();
      return;
    }

    console.log(`[vinted] Navigating to homepage to solve Cloudflare challenge for ${this._domain}...`);
    await this._navigateAndWaitForChallenge(this._baseUrl);
  }

  /**
   * Tear down and reset the window. This is a last-resort fallback — it
   * destroys the window and clears session cookies. Only used when the
   * window itself is broken (e.g. renderer crash, disposed webContents).
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
            signal: AbortSignal.timeout(15000),
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

        // Check for HTML response — could be a Cloudflare challenge or a
        // genuine error page from Vinted's servers.
        if (result.contentType.includes("text/html")) {
          if (isCloudflareChallenge(result.body)) {
            console.log(`[vinted] Cloudflare challenge on attempt ${tried}/${this._maxRetries} (status ${result.status})`);
            if (isLast) throw new Error("Cloudflare challenge could not be solved after all retry attempts");
            // Navigate the existing window to the homepage so Cloudflare's
            // challenge JS can execute naturally and set cf_clearance.
            await this._solveChallenge();
            continue;
          }
          // Genuine HTML error from Vinted (e.g. geo-block, maintenance).
          console.warn(`[vinted] Non-JSON HTML response on attempt ${tried}/${this._maxRetries} (status ${result.status})`);
          throw new Error(`Vinted returned HTML (status ${result.status}) — not a Cloudflare challenge`);
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
    throw new Error(`VintedClient.get: exhausted ${this._maxRetries} retries without a result`);
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
