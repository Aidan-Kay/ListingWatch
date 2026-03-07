"use strict";

const { ipcMain, shell, dialog, nativeImage, session } = require("electron");
const fs = require("fs");
const ebay = require("./ebay/ebay");
const vinted = require("./vinted/vinted");
const { configureRequesterProxy } = require("./vinted/lib/requester");
const { saveSearches, saveSettings, saveFavourites } = require("./persistence");
const { scheduleSearch, stopSearch, stopAllSearches, startAllSearches } = require("./polling");
const { sendNotifications } = require("./notifications");

/**
 * Update a search's runtime status on the state object and push it to the renderer.
 * @param {string}  searchId
 * @param {Object}  statusPatch
 * @param {Object}  state - { searches }
 * @param {Electron.BrowserWindow|null} mainWindow
 */
function updateSearchStatus(searchId, statusPatch, state, mainWindow) {
  const match = state.searches.find((x) => x.id === searchId);
  if (match) Object.assign(match, statusPatch);
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("search-status", { searchId, ...statusPatch });
  }
}

/**
 * Draw a small red badge image (used for the taskbar overlay icon).
 * Returns a NativeImage.
 */
function updateTaskbarBadge(count, dataUrl, mainWindow) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (count > 0 && dataUrl) {
    mainWindow.setOverlayIcon(nativeImage.createFromDataURL(dataUrl), `${count} unseen listing${count !== 1 ? "s" : ""}`);
  } else {
    mainWindow.setOverlayIcon(null, "");
  }
}

/**
 * Create onNewItems / onStatus callbacks wired up to the window and shared state.
 * @param {Function} [getTray] - Optional () => Tray|null for tooltip updates.
 */
function makeCallbacks(state, getSettings, getWindow, getTray) {
  function onNewItems(items, isInit) {
    const win = getWindow();
    if (win && !win.isDestroyed()) {
      win.webContents.send("new-listings", items);
    }
    if (!isInit) {
      sendNotifications(items, getSettings(), state.searches, win);
    }
    // Update tray tooltip with current feed size when new items arrive.
    const t = getTray && getTray();
    if (t && !t.isDestroyed()) {
      const n = state.feed.length;
      t.setToolTip(`ListingWatch \u00b7 ${n} listing${n !== 1 ? "s" : ""} in feed`);
    }
  }

  function onStatus(searchId, patch) {
    updateSearchStatus(searchId, patch, state, getWindow());
  }

  return { onNewItems, onStatus };
}

/**
 * Register all ipcMain handlers.
 *
 * @param {Object}   state       - Shared mutable state: { searches, feed, seenIds, initialised, timers }
 * @param {Function} getSettings - () => settings
 * @param {Function} setSettings - (newSettings) => void
 * @param {Function} getWindow   - () => BrowserWindow|null
 * @param {Function} [getTray]   - () => Tray|null (optional, for tooltip updates)
 */
function setupIpc(state, getSettings, setSettings, getWindow, getTray) {
  // ─── Searches ───────────────────────────────────────────────────────────────
  ipcMain.handle("get-searches", () => state.searches);

  ipcMain.handle("save-search", (_event, search) => {
    const { onNewItems, onStatus } = makeCallbacks(state, getSettings, getWindow, getTray);

    if (search.id) {
      const idx = state.searches.findIndex((s) => s.id === search.id);
      if (idx !== -1) {
        state.searches[idx] = { ...state.searches[idx], ...search };
        stopSearch(search.id, state);
        if (search.enabled) {
          scheduleSearch(state.searches[idx], state, onNewItems, onStatus, getSettings);
        }
      }
    } else {
      search.id = `search_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      search.enabled = search.enabled !== false;
      search.lastFetched = null;
      search.error = null;
      state.searches.push(search);
      if (search.enabled) {
        scheduleSearch(search, state, onNewItems, onStatus, getSettings);
      }
    }
    saveSearches(state.searches);
    return state.searches;
  });

  ipcMain.handle("delete-search", (_event, id) => {
    stopSearch(id, state);
    // Per-search seenIds — O(1) delete rather than O(n) prefix scan
    delete state.seenIds[id];
    // Mutate feed in-place to preserve the shared reference used by polling.js.
    // For multi-search items (searchIds array), remove just the deleted search's ID;
    // only remove the item from the feed if it has no remaining search associations.
    for (let i = state.feed.length - 1; i >= 0; i--) {
      const item = state.feed[i];
      const ids = Array.isArray(item.searchIds) ? item.searchIds : [item.searchId];
      if (ids.includes(id)) {
        if (ids.length <= 1) {
          state.feedIndex.delete(`${item.source}:${item.itemId}`);
          state.feed.splice(i, 1);
        } else {
          item.searchIds = ids.filter((s) => s !== id);
          // If the primary searchId was the deleted search, reassign to the next one.
          if (item.searchId === id) {
            item.searchId = item.searchIds[0];
            const replacement = state.searches.find((x) => x.id === item.searchId);
            if (replacement) {
              item.searchName = replacement.name;
              item.cardColor = replacement.cardColor || null;
            }
          }
        }
      }
    }
    for (let i = state.searches.length - 1; i >= 0; i--) {
      if (state.searches[i].id === id) state.searches.splice(i, 1);
    }
    saveSearches(state.searches);
    return state.searches;
  });

  ipcMain.handle("toggle-search", (_event, id, enabled) => {
    const search = state.searches.find((s) => s.id === id);
    if (!search) return state.searches;
    search.enabled = enabled;
    const { onNewItems, onStatus } = makeCallbacks(state, getSettings, getWindow, getTray);
    if (enabled) {
      scheduleSearch(search, state, onNewItems, onStatus, getSettings);
    } else {
      stopSearch(id, state);
    }
    saveSearches(state.searches);
    return state.searches;
  });

  ipcMain.handle("toggle-notify", (_event, id, notify) => {
    const search = state.searches.find((s) => s.id === id);
    if (!search) return state.searches;
    search.notify = notify;
    saveSearches(state.searches);
    return state.searches;
  });

  // ─── Pause / Resume All ────────────────────────────────────────────────────
  ipcMain.handle("pause-all", () => {
    stopAllSearches(state);
    const t = getTray && getTray();
    if (t && !t.isDestroyed()) t.setToolTip("ListingWatch \u00b7 Paused");
  });

  ipcMain.handle("resume-all", () => {
    const { onNewItems, onStatus } = makeCallbacks(state, getSettings, getWindow, getTray);
    startAllSearches(state, onNewItems, onStatus, getSettings);
    const t = getTray && getTray();
    if (t && !t.isDestroyed()) {
      const n = state.feed.length;
      t.setToolTip(`ListingWatch \u00b7 ${n} listing${n !== 1 ? "s" : ""} in feed`);
    }
  });

  // ─── Settings ───────────────────────────────────────────────────────────────
  ipcMain.handle("get-settings", () => getSettings());

  ipcMain.handle("save-settings", (_event, newSettings) => {
    const current = getSettings();
    const credentialsChanged = newSettings.clientId !== current.clientId || newSettings.clientSecret !== current.clientSecret;
    const proxyChanged = newSettings.proxyEnabled !== current.proxyEnabled || newSettings.proxyUrl !== current.proxyUrl;
    const merged = { ...current, ...newSettings };
    setSettings(merged);
    if (credentialsChanged) ebay.invalidateToken();
    saveSettings(merged);

    // Apply proxy settings to Electron's session (affects net.fetch in main process)
    // and rebuild the Vinted requester pool with the new proxy URL.
    if (proxyChanged) {
      const proxyRules = merged.proxyEnabled && merged.proxyUrl ? merged.proxyUrl : "direct://";
      session.defaultSession.setProxy({ proxyRules }).catch((err) => {
        console.warn("[proxy] Failed to set session proxy:", err.message);
      });
      configureRequesterProxy(merged.proxyEnabled && merged.proxyUrl ? merged.proxyUrl : null);
    }

    return merged;
  });

  ipcMain.handle("test-connection", async () => {
    try {
      ebay.invalidateToken();
      await ebay.getAccessToken();
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // ─── Feed ───────────────────────────────────────────────────────────────────
  ipcMain.handle("get-feed", () => state.feed);

  ipcMain.handle("clear-feed", () => {
    state.feed.splice(0); // In-place clear to preserve shared reference
    state.feedIndex.clear();
    updateTaskbarBadge(0, null, getWindow());
    const t = getTray && getTray();
    if (t && !t.isDestroyed()) t.setToolTip("ListingWatch");
    return state.feed;
  });

  // ─── Favourites ─────────────────────────────────────────────────────────────
  // favourites.json stores a snapshot of each favourited item. Load once on
  // startup (via get-favourites) and persist on every change.
  ipcMain.handle("get-favourites", () => state.favourites);

  ipcMain.handle("save-favourite", (_event, item) => {
    const idx = state.favourites.findIndex((f) => f.id === item.id);
    if (idx !== -1) {
      state.favourites[idx] = item; // Update existing snapshot
    } else {
      state.favourites.unshift(item); // Prepend so newest favourites appear first
    }
    saveFavourites(state.favourites);
    return state.favourites;
  });

  ipcMain.handle("remove-favourite", (_event, itemId) => {
    const idx = state.favourites.findIndex((f) => f.id === itemId);
    if (idx !== -1) state.favourites.splice(idx, 1);
    saveFavourites(state.favourites);
    return state.favourites;
  });

  ipcMain.handle("clear-favourites", () => {
    state.favourites.splice(0);
    saveFavourites(state.favourites);
    return state.favourites;
  });

  // ─── Sound ───────────────────────────────────────────────────────────
  ipcMain.handle("select-sound-file", async () => {
    const win = getWindow();
    const { canceled, filePaths } = await dialog.showOpenDialog(win, {
      title: "Select Notification Sound",
      filters: [{ name: "Audio", extensions: ["mp3", "wav", "ogg", "aac", "m4a", "flac"] }],
      properties: ["openFile"],
    });
    if (canceled || !filePaths.length) return null;
    return filePaths[0];
  });

  // ─── Proxy ───────────────────────────────────────────────────────────
  ipcMain.handle("test-proxy", async (_event, proxyUrl) => {
    if (!proxyUrl) return { ok: false, error: "No proxy URL provided" };
    try {
      // Use an isolated session so the test doesn't affect in-flight requests
      // on the default session.
      const testSession = session.fromPartition("temp:proxy-test");
      await testSession.setProxy({ proxyRules: proxyUrl });
      const res = await require("electron").net.fetch("https://api.ipify.org?format=json", {
        signal: AbortSignal.timeout(8000),
        session: testSession,
      });
      const data = await res.json();
      return { ok: true, ip: data.ip };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // ─── eBay API Usage ─────────────────────────────────────────────────────────
  ipcMain.handle("get-api-usage", () => {
    const usage = ebay.getApiUsage();
    const settings = getSettings();
    return { ...usage, limit: settings.ebayApiDailyLimit || 5000 };
  });

  // ─── Browser ────────────────────────────────────────────────────────────────
  ipcMain.handle("open-external", async (_event, url) => {
    try {
      const parsed = new URL(url);
      if (!["http:", "https:"].includes(parsed.protocol)) {
        console.warn("[security] Blocked open-external for non-http(s) URL:", url);
        return;
      }
      await shell.openExternal(url);
    } catch {
      console.warn("[security] Invalid URL passed to open-external:", url);
    }
  });

  // ─── eBay Taxonomy ──────────────────────────────────────────────────────────
  ipcMain.handle("get-category-tree", async (_event, site) => {
    try {
      const categories = await ebay.loadCategoryTree(site);
      return { ok: true, categories };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // ─── Item Images ────────────────────────────────────────────────────────────
  ipcMain.handle("get-ebay-item-images", async (_event, itemId, site) => {
    try {
      const images = await ebay.getItemImages(itemId, site);
      return { ok: true, images };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle("get-vinted-item-images", async (_event, itemId, site) => {
    try {
      const images = await vinted.getItemImages(itemId, site);
      return { ok: true, images };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // ─── Taskbar Badge ──────────────────────────────────────────────────────────
  ipcMain.handle("update-badge", (_event, count, dataUrl) => {
    updateTaskbarBadge(count, dataUrl, getWindow());
  });

  // ─── Export / Import ────────────────────────────────────────────────────────
  ipcMain.handle("export-data", async () => {
    const win = getWindow();
    const { canceled, filePath } = await dialog.showSaveDialog(win, {
      title: "Export ListingWatch Data",
      defaultPath: `listingwatch-backup-${new Date().toISOString().slice(0, 10)}.json`,
      filters: [{ name: "JSON", extensions: ["json"] }],
    });
    if (canceled || !filePath) return { ok: false, canceled: true };
    try {
      const exportSettings = { ...getSettings() };
      // Strip credentials from backup — they should not leave the machine
      delete exportSettings.clientId;
      delete exportSettings.clientSecret;
      const data = { version: 1, exportedAt: new Date().toISOString(), searches: state.searches, settings: exportSettings };
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
      return { ok: true, filePath };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle("import-data", async () => {
    const win = getWindow();
    const { canceled, filePaths } = await dialog.showOpenDialog(win, {
      title: "Import ListingWatch Data",
      filters: [{ name: "JSON", extensions: ["json"] }],
      properties: ["openFile"],
    });
    if (canceled || !filePaths.length) return { ok: false, canceled: true };
    try {
      const raw = fs.readFileSync(filePaths[0], "utf8");
      const data = JSON.parse(raw);
      if (!Array.isArray(data.searches) || typeof data.settings !== "object" || data.settings === null) {
        throw new Error("Invalid backup file: 'searches' must be an array and 'settings' must be an object.");
      }
      for (const s of data.searches) {
        if (!s.id || !s.name || !s.source) {
          throw new Error("Invalid backup file: a search entry is missing required fields (id, name, source).");
        }
      }

      stopAllSearches(state);

      // Mutate in-place so existing closures in polling.js retain the same array reference.
      state.searches.splice(0, state.searches.length, ...data.searches);
      // Clear per-search runtime state for a clean slate after import.
      state.seenIds = {};
      state.initialised = {};
      const merged = { ...getSettings(), ...data.settings };
      setSettings(merged);

      saveSearches(state.searches);
      saveSettings(merged);

      const { onNewItems, onStatus } = makeCallbacks(state, getSettings, getWindow, getTray);
      startAllSearches(state, onNewItems, onStatus, getSettings);

      ebay.invalidateToken();

      return { ok: true, searchCount: state.searches.length };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });
}

module.exports = { setupIpc, updateSearchStatus, updateTaskbarBadge, makeCallbacks };
