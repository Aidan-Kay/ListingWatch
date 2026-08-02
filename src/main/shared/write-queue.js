"use strict";

const fs = require("fs");

/**
 * Per-file write-through queue. Serialises async writes to the same path so
 * we never race-write torn JSON, while keeping the main process unblocked.
 *
 * Callers fire-and-forget (`saveSearches(...)` returns a Promise but most
 * call sites don't await it). On `flushAllPendingWrites()` (called at quit)
 * we wait for every queue to drain.
 */
const _queues = new Map();

function queueWrite(filePath, data) {
  const json = JSON.stringify(data, null, 2);
  const previous = _queues.get(filePath) ?? Promise.resolve();
  const job = previous
    .catch(() => {}) // never let a prior failure block subsequent writes
    .then(() => fs.promises.writeFile(filePath, json, "utf8"))
    .catch((err) => {
      console.error(`[persist] Failed to write ${filePath}:`, err.message);
    });
  _queues.set(filePath, job);
  return job;
}

/** Wait for every pending write across every file to finish. */
async function flushAllPendingWrites() {
  await Promise.allSettled(_queues.values());
}

module.exports = { queueWrite, flushAllPendingWrites };
