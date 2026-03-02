"use strict";

const fs = require("fs");
const path = require("path");
const { app } = require("electron");

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

function loadSettings() {
  try {
    if (fs.existsSync(settingsFile)) {
      return { ...DEFAULT_SETTINGS, ...JSON.parse(fs.readFileSync(settingsFile, "utf8")) };
    }
  } catch (e) {
    console.error("Failed to load settings:", e);
  }
  return { ...DEFAULT_SETTINGS };
}

function saveSettings(settings) {
  try {
    fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 2), "utf8");
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
    } catch {}
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
