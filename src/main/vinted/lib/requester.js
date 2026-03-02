"use strict";

const axios = require("axios");
const { wrapper } = require("axios-cookiejar-support");
const { CookieJar } = require("tough-cookie");

class Requester {
  constructor() {
    this.MAX_RETRIES = 3;
    this.VINTED_AUTH_URL = "https://www.vinted.fr/";
    this._cookiesFetched = false;

    this._jar = new CookieJar();
    this._client = wrapper(
      axios.create({
        jar: this._jar,
        withCredentials: true,
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
    this._cookiesFetched = false; // force re-auth on locale change
    this._client.defaults.headers.common = {
      ...this._buildHeaders(),
    };
  }

  /**
   * Perform a GET request to the Vinted homepage so session cookies are set.
   */
  async setCookies() {
    await this._jar.removeAllCookies();
    try {
      await this._client.get(this.VINTED_AUTH_URL, {
        responseType: "text",
        maxRedirects: 5,
      });
      this._cookiesFetched = true;
      console.log("Cookies set!");
    } catch (err) {
      // Even a non-2xx status may have set cookies; treat as non-fatal.
      this._cookiesFetched = true;
      console.warn(`[vinted] Cookie fetch warning: ${err.message}`);
    }
  }

  /**
   * Perform an HTTP GET request, refreshing cookies proactively and retrying on 401.
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
        if (status === 401 && tried < this.MAX_RETRIES) {
          console.log(`[vinted] Cookies invalid, retrying ${tried}/${this.MAX_RETRIES}`);
          await this.setCookies();
          continue;
        }
        if (tried === this.MAX_RETRIES) throw err;
      }
    }
  }

}

// Singleton – one shared requester instance across the app.
const requester = new Requester();

module.exports = { Requester, requester };
