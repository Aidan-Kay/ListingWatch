"use strict";

const fs = require("fs");
const path = require("path");

/**
 * Per-file write-through queue. Serialises async writes to the same path so
 * we never race-write torn JSON, while keeping the main process unblocked.
 *
 * Callers fire-and-forget (`saveSearches(...)` returns a Promise but most
 * call sites don't await it). On `flushAllPendingWrites()` (called at quit)
 * we wait for every queue to drain.
 */
const _queues = new Map();

/**
 * Write to a sibling temp file, then rename it over the target. rename() is
 * atomic on NTFS and POSIX, so a crash or power loss leaves either the old
 * file or the new one — never a truncated one. writeFile alone truncates
 * first and writes second, and every loader treats an unparseable file as
 * "no data", so a torn write would silently discard the user's whole
 * hand-curated set of searches or favourites.
 */
async function writeAtomic(filePath, json) {
  const tmp = path.join(path.dirname(filePath), `.${path.basename(filePath)}.tmp`);
  try {
    await fs.promises.writeFile(tmp, json, "utf8");
    await fs.promises.rename(tmp, filePath);
  } catch (err) {
    // Leaving a stale temp file behind would shadow the next write on Windows,
    // where rename onto an existing path can fail if the source is still open.
    await fs.promises.rm(tmp, { force: true }).catch(() => {});
    throw err;
  }
}

/**
 * Synchronous counterpart to writeAtomic, for the quit path where a write has
 * to complete before the process exits and there is no chance to await.
 */
function writeAtomicSync(filePath, json) {
  const tmp = path.join(path.dirname(filePath), `.${path.basename(filePath)}.tmp`);
  try {
    fs.writeFileSync(tmp, json, "utf8");
    fs.renameSync(tmp, filePath);
  } catch (err) {
    try {
      fs.rmSync(tmp, { force: true });
    } catch {
      /* best effort */
    }
    throw err;
  }
}

function queueWrite(filePath, data) {
  const json = JSON.stringify(data, null, 2);
  const previous = _queues.get(filePath) ?? Promise.resolve();
  const job = previous
    .catch(() => {}) // never let a prior failure block subsequent writes
    .then(() => writeAtomic(filePath, json))
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

module.exports = { queueWrite, writeAtomic, writeAtomicSync, flushAllPendingWrites };
