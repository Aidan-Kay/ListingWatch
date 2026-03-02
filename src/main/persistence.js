"use strict";

const fs = require("fs");
const path = require("path");
const { app, safeStorage } = require("electron");

// ─── Paths ────────────────────────────────────────────────────────────────────
const userDataPath = app.getPath("userData");
const searchesFile = path.join(userDataPath, "searches.json");
const settingsFile = path.join(userDataPath, "settings.json");
const windowStateFile = path.join(userDataPath, "window-state.json");

// ─── Searches ─────────────────────────────────────────────────────────────────
function loadSearches() {
  try {
    if (fs.existsSync(searchesFile)) {
      return JSON.parse(fs.readFileSync(searchesFile, "utf8"));
    }
  } catch (e) {
    console.error("Failed to load searches:", e);
  }
  return [];
}

function saveSearches(searches) {
  try {
    fs.writeFileSync(searchesFile, JSON.stringify(searches, null, 2), "utf8");
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
  return safeStorage.decryptString(Buffer.from(value, "base64"));
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
};
