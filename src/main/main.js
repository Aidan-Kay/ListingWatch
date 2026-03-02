const { app, BrowserWindow, ipcMain, shell, Notification, nativeImage, dialog } = require("electron");
const path = require("path");
const fs = require("fs");

// ─── Source modules ───────────────────────────────────────────────────────────
const ebay = require("./ebay/ebay");
const vinted = require("./vinted/vinted");

// ─── Paths ────────────────────────────────────────────────────────────────────
const userDataPath = app.getPath("userData");
const searchesFile = path.join(userDataPath, "searches.json");
const settingsFile = path.join(userDataPath, "settings.json");
const windowStateFile = path.join(userDataPath, "window-state.json");

// ─── State ────────────────────────────────────────────────────────────────────
let mainWindow = null;
let searches = [];
let settings = {
  minInterval: 30,
  maxInterval: 120,
  clientId: "",
  clientSecret: "",
  notifyFormats: ["Auction", "Buy It Now"],
};
let feed = []; // { id, searchId, searchName, title, price, image, url, foundAt }
let seenIds = new Set(); // item IDs seen globally (to detect new vs. initial)
let timers = {}; // searchId -> timeout handle
let initialised = {}; // searchId -> bool (has had first fetch)

// ─── Convenience wrappers (keep callers unchanged) ────────────────────────────
function getEbayAccessToken() {
  return ebay.getAccessToken();
}
function invalidateEbayToken() {
  return ebay.invalidateToken();
}
function searchEbay(search) {
  return ebay.search(search);
}
function loadEbayCategoryTree(site) {
  return ebay.loadCategoryTree(site);
}
function getEbayItemImages(itemId, site) {
  return ebay.getItemImages(itemId, site);
}
function searchVinted(search) {
  return vinted.search(search);
}
function getVintedItemImages(itemId, site) {
  return vinted.getItemImages(itemId, site);
}

// ─── Persistence ──────────────────────────────────────────────────────────────
function loadSearches() {
  try {
    if (fs.existsSync(searchesFile)) {
      searches = JSON.parse(fs.readFileSync(searchesFile, "utf8"));
    }
  } catch (e) {
    console.error("Failed to load searches:", e);
    searches = [];
  }
}

function saveSearches() {
  try {
    fs.writeFileSync(searchesFile, JSON.stringify(searches, null, 2), "utf8");
  } catch (e) {
    console.error("Failed to save searches:", e);
  }
}

function loadSettings() {
  try {
    if (fs.existsSync(settingsFile)) {
      settings = { ...settings, ...JSON.parse(fs.readFileSync(settingsFile, "utf8")) };
    }
  } catch (e) {
    console.error("Failed to load settings:", e);
  }
}

function saveSettingsFile() {
  try {
    fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 2), "utf8");
  } catch (e) {
    console.error("Failed to save settings:", e);
  }
}

// ─── Taskbar Badge ────────────────────────────────────────────────────────────
function updateTaskbarBadge(count, dataUrl) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (count > 0 && dataUrl) {
    mainWindow.setOverlayIcon(nativeImage.createFromDataURL(dataUrl), `${count} unseen listing${count !== 1 ? "s" : ""}`);
  } else {
    mainWindow.setOverlayIcon(null, "");
  }
}

// ─── Notifications ────────────────────────────────────────────────────────────
function sendNotifications(items) {
  if (!Notification.isSupported()) return;

  // Suppress notifications when eBayWatch is the focused window (unless setting is enabled)
  if (!settings.notifyWhenFocused && mainWindow && !mainWindow.isDestroyed() && mainWindow.isFocused()) return;

  // Filter by global allowed formats and per-search notify flag
  const allowed = settings.notifyFormats && settings.notifyFormats.length > 0 ? settings.notifyFormats : ["Auction", "Buy It Now"];

  const filtered = items.filter((item) => {
    const search = searches.find((s) => s.id === item.searchId);
    if (search && search.notify === false) return false;
    const formats = item.buyingFormats || [];
    return formats.some((f) => allowed.includes(f));
  });

  if (filtered.length === 0) return;

  if (filtered.length === 1) {
    const item = filtered[0];
    const notif = new Notification({
      title: "ListingWatch",
      body: `${item.searchName}: ${item.title}${item.price ? `  ·  ${item.price}` : ""}`,
      silent: false,
    });
    notif.on("click", () => shell.openExternal(item.url));
    notif.show();
  } else {
    const notif = new Notification({
      title: "ListingWatch",
      body:
        filtered
          .map((i) => `${i.title}${i.price ? ` · ${i.price}` : ""}`)
          .slice(0, 3)
          .join("\n") + (filtered.length > 3 ? `\n…and ${filtered.length - 3} more` : ""),
      silent: false,
    });
    notif.show();
  }
}

// ─── Polling ──────────────────────────────────────────────────────────────────
function randomInterval(search) {
  const globalMin = (settings.minInterval || 30) * 1000;
  const globalMax = (settings.maxInterval || 120) * 1000;
  const min = search && search.minInterval ? search.minInterval * 1000 : globalMin;
  const max = search && search.maxInterval ? search.maxInterval * 1000 : globalMax;
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

async function fetchSearch(search) {
  try {
    const items = search.source === "vinted" ? await searchVinted(search) : await searchEbay(search);

    const isInit = !initialised[search.id];
    const newItems = [];

    for (const item of items) {
      if (!seenIds.has(item.id)) {
        seenIds.add(item.id);
        newItems.push(item); // collect all unseen items; init logic handled below
      }
    }

    if (isInit) {
      initialised[search.id] = true;
      const initialCount = search.initialCount > 0 ? Math.min(search.initialCount, newItems.length) : 0;
      if (initialCount > 0) {
        const initialItems = newItems.slice(0, initialCount);
        feed.unshift(...initialItems);
        if (feed.length > 500) feed = feed.slice(0, 500);
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send("new-listings", initialItems);
        }
        console.log(`[${search.source}] [${search.name}] Initialised - ${items.length} listing(s) seen, ${initialCount} added to feed`);
      } else {
        console.log(`[${search.source}] [${search.name}] Initialised - ${items.length} listing(s) seen, none added to feed`);
      }
      updateSearchStatus(search.id, { lastFetched: new Date().toISOString(), error: null });
    } else if (newItems.length > 0) {
      console.log(`[${search.source}] [${search.name}] Found ${newItems.length} new listing(s)`);
      feed.unshift(...newItems);
      // Keep feed at a reasonable size
      if (feed.length > 500) feed = feed.slice(0, 500);

      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("new-listings", newItems);
      }
      sendNotifications(newItems);
      updateSearchStatus(search.id, { lastFetched: new Date().toISOString(), newCount: newItems.length, error: null });
    } else {
      updateSearchStatus(search.id, { lastFetched: new Date().toISOString(), error: null });
    }
  } catch (err) {
    console.error(`[${search.source}] [${search.name}] Fetch error:`, err.message);
    updateSearchStatus(search.id, { error: err.message });
  }
}

function updateSearchStatus(searchId, status) {
  const s = searches.find((x) => x.id === searchId);
  if (s) Object.assign(s, status);
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("search-status", { searchId, ...status });
  }
}

function scheduleSearch(search) {
  if (!search.enabled) return;

  // Do an immediate fetch first
  fetchSearch(search).then(() => {
    // Then schedule repeating fetches
    function scheduleNext() {
      const current = searches.find((s) => s.id === search.id);
      if (!current || !current.enabled) return;
      const delay = randomInterval(current);
      console.log(`[${current.source}] [${current.name}] Next fetch in ${Math.round(delay / 1000)}s`);
      timers[search.id] = setTimeout(async () => {
        const latest = searches.find((s) => s.id === search.id);
        if (latest && latest.enabled) {
          await fetchSearch(latest);
          scheduleNext();
        }
      }, delay);
    }
    scheduleNext();
  });
}

function stopSearch(searchId) {
  if (timers[searchId]) {
    clearTimeout(timers[searchId]);
    delete timers[searchId];
  }
  delete initialised[searchId];
}

function stopAllSearches() {
  for (const id of Object.keys(timers)) {
    clearTimeout(timers[id]);
    delete timers[id];
  }
}

function startAllSearches() {
  for (const search of searches) {
    if (search.enabled) {
      scheduleSearch(search);
    }
  }
}

// ─── Window ───────────────────────────────────────────────────────────────────
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

function createWindow() {
  const saved = loadWindowState();
  mainWindow = new BrowserWindow({
    width: saved?.width ?? 1500,
    height: saved?.height ?? 1100,
    x: saved?.x,
    y: saved?.y,
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

  mainWindow.on("resize", () => saveWindowState(mainWindow));
  mainWindow.on("move", () => saveWindowState(mainWindow));

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

// ─── IPC Handlers ─────────────────────────────────────────────────────────────
function setupIpc() {
  ipcMain.handle("get-searches", () => searches);

  ipcMain.handle("save-search", (_event, search) => {
    if (search.id) {
      // Update existing
      const idx = searches.findIndex((s) => s.id === search.id);
      if (idx !== -1) {
        const wasEnabled = searches[idx].enabled;
        searches[idx] = { ...searches[idx], ...search };
        // Restart polling if enabled state or config changed
        stopSearch(search.id);
        if (search.enabled) {
          scheduleSearch(searches[idx]);
        }
      }
    } else {
      // Create new
      search.id = `search_${Date.now()}`;
      search.enabled = search.enabled !== false;
      search.lastFetched = null;
      search.error = null;
      searches.push(search);
      if (search.enabled) {
        scheduleSearch(search);
      }
    }
    saveSearches();
    return searches;
  });

  ipcMain.handle("delete-search", (_event, id) => {
    stopSearch(id);
    // Remove seenIds for this search
    for (const seenId of [...seenIds]) {
      if (seenId.startsWith(`${id}_`)) seenIds.delete(seenId);
    }
    // Remove from feed
    feed = feed.filter((item) => item.searchId !== id);
    searches = searches.filter((s) => s.id !== id);
    saveSearches();
    return searches;
  });

  ipcMain.handle("toggle-search", (_event, id, enabled) => {
    const search = searches.find((s) => s.id === id);
    if (!search) return searches;
    search.enabled = enabled;
    if (enabled) {
      scheduleSearch(search);
    } else {
      stopSearch(id);
    }
    saveSearches();
    return searches;
  });

  ipcMain.handle("toggle-notify", (_event, id, notify) => {
    const search = searches.find((s) => s.id === id);
    if (!search) return searches;
    search.notify = notify;
    saveSearches();
    return searches;
  });

  ipcMain.handle("get-settings", () => settings);

  ipcMain.handle("save-settings", (_event, newSettings) => {
    const credentialsChanged = newSettings.clientId !== settings.clientId || newSettings.clientSecret !== settings.clientSecret;
    settings = { ...settings, ...newSettings };
    if (credentialsChanged) invalidateEbayToken();
    saveSettingsFile();
    return settings;
  });

  ipcMain.handle("test-connection", async () => {
    try {
      invalidateEbayToken();
      await getEbayAccessToken();
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle("get-feed", () => feed);

  ipcMain.handle("clear-feed", () => {
    feed = [];
    updateTaskbarBadge(0);
    return feed;
  });

  ipcMain.handle("open-external", (_event, url) => {
    shell.openExternal(url);
  });

  ipcMain.handle("get-category-tree", async (_event, site) => {
    try {
      const categories = await loadEbayCategoryTree(site);
      return { ok: true, categories };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle("get-ebay-item-images", async (_event, itemId, site) => {
    try {
      const images = await getEbayItemImages(itemId, site);
      return { ok: true, images };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle("get-vinted-item-images", async (_event, itemId, site) => {
    try {
      const images = await getVintedItemImages(itemId, site);
      return { ok: true, images };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle("update-badge", (_event, count, dataUrl) => {
    updateTaskbarBadge(count, dataUrl);
  });

  // ─── Export / Import ────────────────────────────────────────────────────────
  ipcMain.handle("export-data", async () => {
    const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
      title: "Export ListingWatch Data",
      defaultPath: `listingwatch-backup-${new Date().toISOString().slice(0, 10)}.json`,
      filters: [{ name: "JSON", extensions: ["json"] }],
    });
    if (canceled || !filePath) return { ok: false, canceled: true };
    try {
      const data = { version: 1, exportedAt: new Date().toISOString(), searches, settings };
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
      return { ok: true, filePath };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle("import-data", async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
      title: "Import ListingWatch Data",
      filters: [{ name: "JSON", extensions: ["json"] }],
      properties: ["openFile"],
    });
    if (canceled || !filePaths.length) return { ok: false, canceled: true };
    try {
      const raw = fs.readFileSync(filePaths[0], "utf8");
      const data = JSON.parse(raw);
      if (!data.searches || !data.settings) throw new Error("Invalid backup file: missing searches or settings.");

      // Stop all currently running searches before replacing
      stopAllSearches();

      // Replace state
      searches = data.searches;
      settings = { ...settings, ...data.settings };

      // Persist
      saveSearches();
      saveSettingsFile();

      // Restart polling for enabled searches
      startAllSearches();

      // Invalidate token in case credentials changed
      invalidateEbayToken();

      return { ok: true, searchCount: searches.length };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });
}

// ─── App Lifecycle ────────────────────────────────────────────────────────────
app.whenReady().then(() => {
  loadSearches();
  loadSettings();
  ebay.configure(() => settings, userDataPath);
  setupIpc();
  createWindow();
  startAllSearches();
});

app.on("window-all-closed", () => {
  stopAllSearches();
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
