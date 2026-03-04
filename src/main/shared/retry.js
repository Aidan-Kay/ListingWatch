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
 * Handles both fetch() and axios errors.
 */
function isTransientError(err) {
  // Network errors (fetch: TypeError; axios: code === 'ECONNRESET' | 'ETIMEDOUT' etc.)
  if (
    err.name === "TypeError" ||
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
  // HTTP status-based (works for both fetch-wrapped errors and axios errors)
  const status = err.status || err.response?.status;
  if (status === 429 || status === 502 || status === 503 || status === 504) {
    return true;
  }
  return false;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = { withRetry, isTransientError };
