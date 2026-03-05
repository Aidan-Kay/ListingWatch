"use strict";

const fs = require("fs");
const path = require("path");
const { app, safeStorage } = require("electron");

// ─── Paths ────────────────────────────────────────────────────────────────────
const userDataPath = app.getPath("userData");
const searchesFile = path.join(userDataPath, "searches.json");
const settingsFile = path.join(userDataPath, "settings.json");
const windowStateFile = path.join(userDataPath, "window-state.json");
const favouritesFile = path.join(userDataPath, "favourites.json");
const apiUsageFile = path.join(userDataPath, "api-usage.json");

// ─── Searches ─────────────────────────────────────────────────────────────────
function loadSearches() {
  try {
    if (fs.existsSync(searchesFile)) {
      const parsed = JSON.parse(fs.readFileSync(searchesFile, "utf8"));
      // Strip transient runtime fields that may have been persisted in older versions
      return parsed.map(({ error: _ignored, ...rest }) => rest);
    }
  } catch (e) {
    console.error("Failed to load searches:", e);
  }
  return [];
}

// Runtime-only fields that should never be written to disk
const SEARCH_RUNTIME_FIELDS = ["error", "_errorCount", "_pollTimer"];

function saveSearches(searches) {
  try {
    const sanitised = searches.map((s) => {
      const copy = { ...s };
      SEARCH_RUNTIME_FIELDS.forEach((f) => delete copy[f]);
      return copy;
    });
    fs.writeFileSync(searchesFile, JSON.stringify(sanitised, null, 2), "utf8");
  } catch (e) {
    console.error("Failed to save searches:", e);
  }
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
  if (!value || !safeStorage.isEncryptionAvailable()) return value;
  try {
    return safeStorage.decryptString(Buffer.from(value, "base64"));
  } catch (e) {
    console.error("Failed to decrypt credential field — clearing it to prevent startup crash:", e.message);
    return "";
  }
}

function loadSettings() {
  try {
    if (fs.existsSync(settingsFile)) {
      const raw = { ...DEFAULT_SETTINGS, ...JSON.parse(fs.readFileSync(settingsFile, "utf8")) };

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
  } catch (e) {
    console.error("Failed to load settings:", e);
  }
  return { ...DEFAULT_SETTINGS };
}

function saveSettings(settings) {
  try {
    const toWrite = { ...settings };
    if (safeStorage.isEncryptionAvailable()) {
      for (const field of CREDENTIAL_FIELDS) {
        if (toWrite[field]) toWrite[field] = encryptField(toWrite[field]);
      }
      toWrite._credentialsEncrypted = true;
    }
    fs.writeFileSync(settingsFile, JSON.stringify(toWrite, null, 2), "utf8");
  } catch (e) {
    console.error("Failed to save settings:", e);
  }
}

// ─── Favourites ─────────────────────────────────────────────────────────────
function loadFavourites() {
  try {
    if (fs.existsSync(favouritesFile)) {
      return JSON.parse(fs.readFileSync(favouritesFile, "utf8"));
    }
  } catch (e) {
    console.error("Failed to load favourites:", e);
  }
  return [];
}

function saveFavourites(items) {
  try {
    fs.writeFileSync(favouritesFile, JSON.stringify(items, null, 2), "utf8");
  } catch (e) {
    console.error("Failed to save favourites:", e);
  }
}

// ─── API Usage ────────────────────────────────────────────────────────────────
function loadApiUsage() {
  try {
    if (fs.existsSync(apiUsageFile)) {
      return JSON.parse(fs.readFileSync(apiUsageFile, "utf8"));
    }
  } catch (e) {
    console.error("Failed to load API usage:", e);
  }
  return { calls: 0, date: "" };
}

function saveApiUsage(usage) {
  try {
    fs.writeFileSync(apiUsageFile, JSON.stringify(usage, null, 2), "utf8");
  } catch (e) {
    console.error("Failed to save API usage:", e);
  }
}

// ─── Window State ─────────────────────────────────────────────────────────────
function loadWindowState() {
  try {
    return JSON.parse(fs.readFileSync(windowStateFile, "utf8"));
  } catch {
    return null;
  }
}

let _windowSaveTimer = null;
function saveWindowState(win) {
  clearTimeout(_windowSaveTimer);
  _windowSaveTimer = setTimeout(() => {
    if (!win || win.isDestroyed() || win.isMinimized() || win.isMaximized()) return;
    const [x, y] = win.getPosition();
    const [width, height] = win.getSize();
    try {
      fs.writeFileSync(windowStateFile, JSON.stringify({ x, y, width, height }), "utf8");
    } catch (e) {
      console.warn("Failed to save window state:", e.message);
    }
  }, 500);
}

module.exports = {
  userDataPath,
  DEFAULT_SETTINGS,
  loadSearches,
  saveSearches,
  loadSettings,
  saveSettings,
  loadWindowState,
  saveWindowState,
  loadFavourites,
  saveFavourites,
  loadApiUsage,
  saveApiUsage,
};
