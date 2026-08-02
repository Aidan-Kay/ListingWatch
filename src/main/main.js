"use strict";

const { app, BrowserWindow, Tray, Menu, screen, session, powerMonitor, net } = require("electron");
const path = require("path");
const log = require("electron-log/main");

// ─── Logging ──────────────────────────────────────────────────────────────────
// Initialise electron-log: writes to file in userData and mirrors to console.
log.initialize();
log.transports.file.maxSize = 5 * 1024 * 1024; // 5 MB rotation
Object.assign(console, log.functions); // Override console.log/error/warn globally

// ─── App Identity ─────────────────────────────────────────────────────────────
// Must be set before app is ready. Controls the Windows notification sender
// name — without this it falls back to "electron.app.Electron".
app.name = "ListingWatch";
if (process.platform === "win32") {
  app.setAppUserModelId("ListingWatch");
}

// ─── Chromium Stability Switches ────────────────────────────────────────────────
// Disable QUIC (HTTP/3) — its Chromium implementation in Electron is unstable
// under concurrent hidden-window traffic and causes "Network service crashed"
// crashes in network_service_instance_impl.cc.
app.commandLine.appendSwitch("disable-quic");

// ─── Single Instance Lock ─────────────────────────────────────────────────────
// Prevents a second instance from running alongside one already in the tray.
// If a second instance is launched, we focus the existing window and quit.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
}

// When a second instance is launched (e.g. user double-clicks app icon while
// already running in the tray), restore and focus the existing window.
app.on("second-instance", () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  }
});

const ebay = require("./ebay/ebay");
const {
  loadSearches,
  loadSettings,
  loadFavourites,
  loadWindowState,
  saveWindowState,
  flushWindowState,
  flushAllPendingWrites,
  userDataPath,
} = require("./persistence");
const { setupIpc, makeCallbacks } = require("./ipc-handlers");
const { startAllSearches, stopAllSearches } = require("./polling");
const { configureRequesterProxy } = require("./vinted/lib/requester");

// ─── Shared Mutable State ─────────────────────────────────────────────────────
// feed is an array — reassigned by ipcMain handlers, so we hold it on the state
// object so both polling.js and ipc-handlers.js see the same reference.
const state = {
  searches: [], // Array of search config objects
  feed: [], // Array of listing items  { id, searchId, … }
  feedIndex: new Map(), // Map<"source:itemId", feedItem> — O(1) cross-search dedup index
  favourites: [], // Array of favourited listing snapshots (persisted to favourites.json)
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

let tray = null;
const getTray = () => tray;

// Set to true before calling app.quit() so the close event doesn't intercept.
let isQuitting = false;

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

  // Intercept close: hide to tray if minimizeToTray is enabled, unless we're
  // actually quitting (e.g. from the tray "Quit" menu item).
  mainWindow.on("close", (event) => {
    if (!isQuitting && getSettings().minimizeToTray) {
      event.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
    // When minimizeToTray is off, quit the app explicitly. Hidden BrowserWindows
    // (e.g. Vinted clients) can prevent window-all-closed from firing.
    if (!isQuitting && !getSettings().minimizeToTray) {
      isQuitting = true;
      app.quit();
    }
  });
}

// ─── Tray ─────────────────────────────────────────────────────────────────────
function createTray() {
  const iconPath = path.join(__dirname, "../../assets/icon.png");
  tray = new Tray(iconPath);
  tray.setToolTip("ListingWatch");

  const contextMenu = Menu.buildFromTemplate([
    {
      label: "Open ListingWatch",
      click: () => {
        if (mainWindow) {
          if (mainWindow.isMinimized()) mainWindow.restore();
          mainWindow.show();
          mainWindow.focus();
        } else {
          createWindow();
        }
      },
    },
    { type: "separator" },
    {
      label: "Pause All Searches",
      click: () => stopAllSearches(state),
    },
    {
      label: "Resume All Searches",
      click: () => {
        const { onNewItems, onStatus } = makeCallbacks(state, getSettings, getWindow, getTray);
        startAllSearches(state, onNewItems, onStatus, getSettings);
      },
    },
    { type: "separator" },
    {
      label: "Quit",
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]);

  // Right-click shows the context menu. Avoids setContextMenu() which on
  // Windows hijacks left-click and prevents the double-click event from firing.
  tray.on("right-click", () => {
    tray.popUpContextMenu(contextMenu);
  });

  // Double-click restores the window (Windows/Linux standard behaviour).
  tray.on("double-click", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    } else {
      createWindow();
    }
  });
}

// ─── App Lifecycle ────────────────────────────────────────────────────────────
app.whenReady().then(() => {
  state.searches = loadSearches();
  state.favourites = loadFavourites();
  settings = loadSettings();

  // Apply persisted proxy settings before any network activity.
  if (settings.proxyEnabled && settings.proxyUrl) {
    session.defaultSession.setProxy({ proxyRules: settings.proxyUrl }).catch((err) => {
      console.warn("[proxy] Startup proxy config failed:", err.message);
    });
    configureRequesterProxy(settings.proxyUrl);
  }

  ebay.configure(getSettings, userDataPath);
  setupIpc(state, getSettings, setSettings, getWindow, getTray);
  createWindow();
  createTray();

  const { onNewItems, onStatus } = makeCallbacks(state, getSettings, getWindow, getTray);
  startAllSearches(state, onNewItems, onStatus, getSettings);
});

// ─── Power / Connectivity ─────────────────────────────────────────────────────
// When the PC resumes from sleep, the network stack often isn't ready yet.
// Searches that fire immediately will fail, and without this handler those
// failures would trigger exponential backoff, making the user wait a long time.
// Instead we wait for connectivity, reset error counters, and restart polling.
powerMonitor.on("resume", () => {
  console.log("[power] System resumed from sleep — waiting for connectivity...");

  function checkAndRestart() {
    if (net.isOnline()) {
      console.log("[power] Internet available — restarting all searches");
      for (const search of state.searches) {
        search._errorCount = 0;
      }
      stopAllSearches(state);
      const { onNewItems, onStatus } = makeCallbacks(state, getSettings, getWindow, getTray);
      startAllSearches(state, onNewItems, onStatus, getSettings);
    } else {
      setTimeout(checkAndRestart, 3000);
    }
  }

  // Give the OS network stack a moment to initialise.
  setTimeout(checkAndRestart, 2000);
});

let _quitFlushed = false;
app.on("before-quit", (event) => {
  isQuitting = true;
  // Flush pending debounced window-state write synchronously before exit.
  if (mainWindow && !mainWindow.isDestroyed()) {
    flushWindowState(mainWindow);
  }
  ebay.flushApiUsage();
  if (tray) {
    tray.destroy();
    tray = null;
  }
  // Wait for any in-flight async file writes (favourites/searches/settings/api-usage)
  // to drain before the process exits. Without this, rapid changes immediately
  // before quit can be lost.
  if (!_quitFlushed) {
    event.preventDefault();
    _quitFlushed = true;
    flushAllPendingWrites().finally(() => app.quit());
  }
});

app.on("window-all-closed", () => {
  // When minimizeToTray is on, the window is hidden rather than closed, so
  // this event only fires once the user explicitly quits from the tray menu.
  stopAllSearches(state);
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// ─── Global Error Handlers ────────────────────────────────────────────────────
process.on("uncaughtException", (err) => {
  console.error("Uncaught exception:", err); // Surface to the user in dev so silent crashes are obvious. In production we
  // still log to electron-log file. We deliberately do NOT auto-relaunch — a
  // crash loop should fail loudly, not silently restart.
  if (!app.isPackaged) {
    const { dialog } = require("electron");
    try {
      dialog.showErrorBox("ListingWatch — Uncaught Exception", String(err.stack || err));
    } catch {
      // dialog can fail very early in startup
    }
  }
});

process.on("unhandledRejection", (reason) => {
  console.error("Unhandled promise rejection:", reason);
});
