"use strict";

const { app, BrowserWindow, screen } = require("electron");
const path = require("path");
const log = require("electron-log/main");

// ─── Logging ──────────────────────────────────────────────────────────────────
// Initialise electron-log: writes to file in userData and mirrors to console.
log.initialize();
log.transports.file.maxSize = 5 * 1024 * 1024; // 5 MB rotation
Object.assign(console, log.functions); // Override console.log/error/warn globally

const ebay = require("./ebay/ebay");
const { loadSearches, loadSettings, loadWindowState, saveWindowState, userDataPath } = require("./persistence");
const { setupIpc, makeCallbacks } = require("./ipc-handlers");
const { startAllSearches, stopAllSearches } = require("./polling");

// ─── Shared Mutable State ─────────────────────────────────────────────────────
// feed is an array — reassigned by ipcMain handlers, so we hold it on the state
// object so both polling.js and ipc-handlers.js see the same reference.
const state = {
  searches: [], // Array of search config objects
  feed: [], // Array of listing items  { id, searchId, … }
  seenIds: {}, // Record<searchId, Set<itemId>> — per-search dedup sets (avoids O(n) prefix scan on delete)
  initialised: {}, // searchId → bool (has first fetch occurred)
  timers: {}, // searchId → setTimeout handle
};

let settings = {};
const getSettings = () => settings;
const setSettings = (s) => {
  settings = s;
};

let mainWindow = null;
const getWindow = () => mainWindow;

// ─── Window ───────────────────────────────────────────────────────────────────
function createWindow() {
  const saved = loadWindowState();

  // Validate saved position is within a visible display (handles disconnected monitors).
  let winX = saved?.x;
  let winY = saved?.y;
  if (winX != null && winY != null) {
    const displays = screen.getAllDisplays();
    const visible = displays.some((d) => {
      const b = d.bounds;
      return winX >= b.x && winY >= b.y && winX < b.x + b.width && winY < b.y + b.height;
    });
    if (!visible) {
      winX = undefined;
      winY = undefined;
      console.warn("[window] Saved position was off-screen — resetting to default.");
    }
  }

  mainWindow = new BrowserWindow({
    width: saved?.width ?? 1500,
    height: saved?.height ?? 1100,
    x: winX,
    y: winY,
    minWidth: 800,
    minHeight: 600,
    backgroundColor: "#171717",
    titleBarStyle: "hidden",
    titleBarOverlay: {
      color: "#171717",
      symbolColor: "#d4d4d4",
      height: 36,
    },
    webPreferences: {
      preload: path.join(__dirname, "../preload/preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
    icon: path.join(__dirname, "../../assets/icon.png"),
  });

  mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));
  // Use 'resized'/'moved' (fire once after gesture ends) instead of 'resize'/'move'
  // (fire on every pixel) to avoid hammering disk during continuous drags.
  mainWindow.on("resized", () => saveWindowState(mainWindow));
  mainWindow.on("moved", () => saveWindowState(mainWindow));
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

// ─── App Lifecycle ────────────────────────────────────────────────────────────
app.whenReady().then(() => {
  state.searches = loadSearches();
  settings = loadSettings();

  ebay.configure(getSettings, userDataPath);
  setupIpc(state, getSettings, setSettings, getWindow);
  createWindow();

  const { onNewItems, onStatus } = makeCallbacks(state, getSettings, getWindow);
  startAllSearches(state, onNewItems, onStatus, getSettings);
});

app.on("window-all-closed", () => {
  stopAllSearches(state);
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// ─── Global Error Handlers ────────────────────────────────────────────────────
process.on("uncaughtException", (err) => {
  console.error("Uncaught exception:", err);
});

process.on("unhandledRejection", (reason) => {
  console.error("Unhandled promise rejection:", reason);
});
