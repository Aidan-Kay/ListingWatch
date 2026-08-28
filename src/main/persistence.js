"use strict";

const fs = require("fs");
const path = require("path");
const { app, safeStorage } = require("electron");
const { queueWrite, writeAtomicSync, flushAllPendingWrites } = require("./shared/write-queue");
// ─── Paths ────────────────────────────────────────────────────────────────────
const userDataPath = app.getPath("userData");
const searchesFile = path.join(userDataPath, "searches.json");
const settingsFile = path.join(userDataPath, "settings.json");
const windowStateFile = path.join(userDataPath, "window-state.json");
const favouritesFile = path.join(userDataPath, "favourites.json");
const apiUsageFile = path.join(userDataPath, "api-usage.json");
const keywordListsFile = path.join(userDataPath, "keyword-lists.json");

// ─── JSON loading ─────────────────────────────────────────────────────────────
/**
 * Read and parse a JSON file, falling back to `fallback` if it is missing,
 * unreadable, or doesn't match the expected shape. Every persisted file is
 * user-editable and has to survive crashes, so none of them can be trusted to
 * parse into what we expect — a settings object arriving as an array, or a
 * favourites array arriving as a string, would otherwise throw deep inside an
 * IPC handler rather than here.
 *
 * A file that exists but cannot be used is set aside as `<name>.corrupt` rather
 * than left in place to be silently overwritten by the next save, so there is
 * something left to recover from.
 */
function loadJson(file, fallback, isValid = () => true) {
  if (!fs.existsSync(file)) return fallback;
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (e) {
    console.error(`[persist] ${path.basename(file)} could not be parsed:`, e.message);
    quarantine(file);
    return fallback;
  }
  if (!isValid(parsed)) {
    console.error(`[persist] ${path.basename(file)} has an unexpected shape — using defaults`);
    quarantine(file);
    return fallback;
  }
  return parsed;
}

/** Move an unusable file aside so the next save doesn't silently destroy it. */
function quarantine(file) {
  const target = `${file}.corrupt`;
  try {
    fs.renameSync(file, target);
    console.error(`[persist] Moved it to ${path.basename(target)} — starting with defaults.`);
  } catch (e) {
    console.error(`[persist] Could not set aside ${path.basename(file)}:`, e.message);
  }
}

const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

// ─── Searches ─────────────────────────────────────────────────────────────────
function loadSearches() {
  // Strip transient runtime fields that may have been persisted in older versions
  return loadJson(searchesFile, [], Array.isArray)
    .filter(isObject)
    .map(({ error: _ignored, ...rest }) => rest);
}

// Main-process bookkeeping the renderer has no business seeing. `error` is
// deliberately absent: the renderer renders it on the search card.
const SEARCH_INTERNAL_FIELDS = ["_errorCount", "_generation"];

// The above plus the live error string — none of it belongs on disk or in a
// backup, where restoring it would show stale error text on a healthy search.
const SEARCH_RUNTIME_FIELDS = ["error", ...SEARCH_INTERNAL_FIELDS];

function omitFields(searches, fields) {
  return searches.map((s) => {
    const copy = { ...s };
    for (const field of fields) delete copy[field];
    return copy;
  });
}

/**
 * The shape a search takes on disk and in an exported backup. One definition, so
 * "persisted search" cannot drift between saveSearches and export-data.
 */
const sanitiseSearches = (searches) => omitFields(searches, SEARCH_RUNTIME_FIELDS);

/**
 * The shape a search takes when handed to the renderer. Without this the
 * renderer's mirror carries _generation, and duplicating a search clones it
 * straight back to save-search — so a brand-new search is born mid-generation.
 */
const searchesForRenderer = (searches) => omitFields(searches, SEARCH_INTERNAL_FIELDS);

function saveSearches(searches) {
  return queueWrite(searchesFile, sanitiseSearches(searches));
}

// ─── Keyword Lists ────────────────────────────────────────────────────────────
// Reusable named term lists ({ id, name, terms[], version, updatedAt }) that
// searches reference by id via `search.includeLists`.
function loadKeywordLists() {
  return loadJson(keywordListsFile, [], Array.isArray).filter(isObject);
}

function saveKeywordLists(lists) {
  return queueWrite(keywordListsFile, lists);
}

// ─── Settings ─────────────────────────────────────────────────────────────────
const DEFAULT_SETTINGS = {
  minInterval: 30,
  maxInterval: 120,
  clientId: "",
  clientSecret: "",
  notifyFormats: ["Auction", "Buy It Now"],
  notifyWhenFocused: false,
  feedZoom: "medium",
  accentColor: "#7d8efc",
  minimizeToTray: false,
  startMinimized: false,
  // Sound
  notificationSoundEnabled: true,
  notificationSoundFile: null,
  notificationVolume: 1.0,
  // Proxy
  proxyEnabled: false,
  proxyUrl: "",
  // eBay API quota
  ebayApiDailyLimit: 5000,
  // Initial feed
  showListingsFromHours: 0,
};

const CREDENTIAL_FIELDS = ["clientId", "clientSecret"];

/**
 * Encrypt a string using Electron's safeStorage (OS keychain-backed).
 * Returns a base64-encoded encrypted blob, or the original string if safeStorage
 * is unavailable.
 */
function encryptField(value) {
  if (!value || !safeStorage.isEncryptionAvailable()) return value;
  return safeStorage.encryptString(value).toString("base64");
}

/**
 * Decrypt a base64-encoded encrypted blob back to a string.
 */
function decryptField(value) {
  if (!value) return value;
  if (!safeStorage.isEncryptionAvailable()) {
    // The file says this value is ciphertext and there is no key to undo that —
    // the profile moved machines, or the keychain went away. Returning the blob
    // verbatim would hand eBay a base64 string as a client ID and surface as a
    // baffling 401 against credentials that look correct in Settings.
    console.error("[persist] Credentials are encrypted but safeStorage is unavailable — clearing. Re-enter them in Settings.");
    return "";
  }
  try {
    return safeStorage.decryptString(Buffer.from(value, "base64"));
  } catch (e) {
    console.error("Failed to decrypt credential field — clearing it to prevent startup crash:", e.message);
    return "";
  }
}

function loadSettings() {
  const stored = loadJson(settingsFile, null, isObject);
  if (!stored) return { ...DEFAULT_SETTINGS };

  const raw = { ...DEFAULT_SETTINGS, ...stored };
  if (raw._credentialsEncrypted) {
    // Decrypt credential fields
    for (const field of CREDENTIAL_FIELDS) {
      if (raw[field]) raw[field] = decryptField(raw[field]);
    }
  } else if (raw.clientId || raw.clientSecret) {
    // Migration: plaintext credentials on disk — re-save encrypted
    saveSettings(raw);
  }
  delete raw._credentialsEncrypted;
  return raw;
}

function saveSettings(settings) {
  const toWrite = { ...settings };
  if (safeStorage.isEncryptionAvailable()) {
    for (const field of CREDENTIAL_FIELDS) {
      if (toWrite[field]) toWrite[field] = encryptField(toWrite[field]);
    }
    toWrite._credentialsEncrypted = true;
  }
  return queueWrite(settingsFile, toWrite);
}

// ─── Favourites ─────────────────────────────────────────────────────────────
function loadFavourites() {
  return loadJson(favouritesFile, [], Array.isArray).filter(isObject);
}

function saveFavourites(items) {
  return queueWrite(favouritesFile, items);
}

// ─── API Usage ────────────────────────────────────────────────────────────────
function loadApiUsage() {
  return loadJson(apiUsageFile, { calls: 0, date: "" }, isObject);
}

function saveApiUsage(usage) {
  return queueWrite(apiUsageFile, usage);
}

// ─── Window State ─────────────────────────────────────────────────────────────
function loadWindowState() {
  return loadJson(windowStateFile, null, isObject);
}

let _windowSaveTimer = null;
function saveWindowState(win) {
  clearTimeout(_windowSaveTimer);
  _windowSaveTimer = setTimeout(() => writeWindowState(win), 500);
}

/**
 * Write window state immediately (used at quit time to flush any pending
 * debounced save). Synchronous because it must complete before the process
 * exits — the queueWrite path is fire-and-forget and would race app.exit().
 */
function flushWindowState(win) {
  clearTimeout(_windowSaveTimer);
  _windowSaveTimer = null;
  writeWindowState(win);
}

function writeWindowState(win) {
  if (!win || win.isDestroyed() || win.isMinimized()) return;
  // A maximised window reports the screen as its bounds, which would overwrite
  // the size to restore down to. getNormalBounds() is the pre-maximise geometry,
  // so the flag and the bounds can both be saved and the app reopens as it was.
  const { x, y, width, height } = win.getNormalBounds();
  const maximised = win.isMaximized();
  try {
    writeAtomicSync(windowStateFile, JSON.stringify({ x, y, width, height, maximised }));
  } catch (e) {
    console.warn("Failed to save window state:", e.message);
  }
}

module.exports = {
  userDataPath,
  DEFAULT_SETTINGS,
  loadSearches,
  saveSearches,
  sanitiseSearches,
  searchesForRenderer,
  loadKeywordLists,
  saveKeywordLists,
  loadSettings,
  saveSettings,
  loadWindowState,
  saveWindowState,
  flushWindowState,
  loadFavourites,
  saveFavourites,
  loadApiUsage,
  saveApiUsage,
  flushAllPendingWrites,
};
