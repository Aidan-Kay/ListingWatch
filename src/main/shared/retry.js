"use strict";

/**
 * Retry an async function on transient failures with exponential backoff.
 *
 * @param {Function} fn          - Async function to execute.
 * @param {Object}   [options]
 * @param {number}   [options.retries=3]       - Max retry attempts (total calls = retries + 1).
 * @param {number}   [options.baseDelay=1000]  - Initial backoff delay in ms, doubled each retry.
 * @param {Function} [options.shouldRetry]     - (error) => bool. Defaults to retrying transient HTTP/network errors.
 * @param {string}   [options.label]           - Label for log messages.
 * @returns {Promise<*>}
 */
async function withRetry(fn, options = {}) {
  const { retries = 3, baseDelay = 1000, shouldRetry = isTransientError, label = "" } = options;

  let lastError;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt < retries && shouldRetry(err)) {
        const delay = baseDelay * Math.pow(2, attempt);
        console.warn(
          `${label ? `[${label}] ` : ""}Transient error (attempt ${attempt + 1}/${retries + 1}), retrying in ${delay}ms:`,
          err.message,
        );
        await sleep(delay);
      }
    }
  }
  throw lastError;
}

/**
 * Determine whether an error is transient and worth retrying.
 * Handles fetch() errors and Electron-specific renderer errors.
 */
function isTransientError(err) {
  // A whole-network outage is not worth a 3-attempt inner loop: withRetry would
  // burn 1s + 2s + 4s per search before throwing, and only then would polling.js
  // recognise it as connectivity and skip backoff. With a dozen searches that is
  // a lot of pointless sleeping. The poll interval is the right retry here.
  if (isNoInternetError(err)) return false;

  // fetch() network failures surface as TypeError with a network-y message.
  // We deliberately do NOT treat *all* TypeErrors as transient — that hid bugs
  // (e.g. parsing errors) behind silent retries.
  if (err.name === "TypeError" && err.message && /fetch|network|failed to fetch/i.test(err.message)) {
    return true;
  }
  if (
    err.code === "ECONNRESET" ||
    err.code === "ETIMEDOUT" ||
    err.code === "ECONNABORTED" ||
    err.code === "ENOTFOUND" ||
    err.code === "ENETUNREACH" ||
    err.code === "UND_ERR_CONNECT_TIMEOUT"
  ) {
    return true;
  }
  // AbortError from AbortSignal.timeout
  if (err.name === "AbortError" || err.name === "TimeoutError") {
    return true;
  }
  // Electron renderer-process errors (e.g. BrowserWindow destroyed mid-request)
  if (
    err.message &&
    (err.message.includes("disposed") || err.message.includes("Render frame was disposed") || err.message.includes("ERR_ABORTED"))
  ) {
    return true;
  }
  // HTTP status-based
  const status = err.status || err.response?.status;
  if (status === 429 || status === 502 || status === 503 || status === 504) {
    return true;
  }
  return false;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Errors that indicate the machine has no internet connectivity.
 *
 * This is the stronger classification of the two: isTransientError defers to it
 * and returns false, so a connectivity failure skips the retry loop entirely and
 * polling.js then skips exponential backoff as well — the app keeps polling at
 * normal intervals and recovers promptly once the network is back.
 */
function isNoInternetError(err) {
  if (
    err.code === "ENOTFOUND" ||
    err.code === "ENETUNREACH" ||
    err.code === "EAI_AGAIN" ||
    err.code === "ENETDOWN" ||
    err.code === "EHOSTUNREACH"
  ) {
    return true;
  }
  if (err.name === "TypeError" && err.message && /fetch failed|network/i.test(err.message)) {
    return true;
  }
  return false;
}

module.exports = { withRetry, isTransientError, isNoInternetError };
