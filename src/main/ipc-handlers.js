"use strict";

const { ipcMain, shell, dialog, nativeImage, session } = require("electron");
const fs = require("fs");
const path = require("path");
const ebay = require("./ebay/ebay");
const { configureRequesterProxy } = require("./vinted/lib/requester");
const { saveSearches, saveSettings, saveFavourites, saveKeywordLists } = require("./persistence");
const { scheduleSearch, stopSearch, stopAllSearches, startAllSearches } = require("./polling");
const { sendNotifications } = require("./notifications");
const { MARKETPLACE_SOURCES } = require("./shared/constants");
const { getAdapter } = require("./shared/marketplace-adapters");
const { invalidateCompiled, splitTerms } = require("./shared/keyword-match");

// Cap on a single imported term file, to keep a mis-selected file from being
// slurped into memory and written back out to keyword-lists.json.
const KEYWORD_FILE_MAX_BYTES = 5 * 1024 * 1024;

/**
 * Clean a raw term array: trim, drop blanks, and collapse case-insensitive
 * duplicates while keeping the first spelling the user typed.
 */
function cleanTerms(terms) {
  const seen = new Set();
  const out = [];
  for (const raw of terms) {
    const term = String(raw ?? "").trim();
    if (!term) continue;
    const key = term.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(term);
  }
  return out;
}

/**
 * Send a search back to its first-fetch state. The next poll re-reads the whole
 * page through the init path, which respects `showListingsFromHours` and passes
 * isInit so no notifications fire. Used whenever a filter changes, since items
 * already marked seen may now qualify — clearing seenIds alone would make the
 * steady-state path treat the entire page as new and spam notifications.
 *
 * seenIds is rebuilt from deliveredIds rather than emptied. The point of the
 * reset is to reconsider listings the filters previously rejected, not to
 * re-announce ones the user has already been shown — those may well have been
 * cleared from the feed, which would otherwise leave nothing to suppress them.
 */
function resetSearchSeenState(state, searchId) {
  const delivered = state.deliveredIds[searchId];
  if (delivered && delivered.size > 0) {
    state.seenIds[searchId] = new Set(delivered);
  } else {
    delete state.seenIds[searchId];
  }
  delete state.initialised[searchId];
}

/**
 * Reset every search that references a given keyword list.
 */
function resetSearchesUsingList(state, listId) {
  for (const s of state.searches) {
    if (Array.isArray(s.includeLists) && s.includeLists.includes(listId)) {
      resetSearchSeenState(state, s.id);
    }
  }
}

/**
 * Set the tray tooltip to reflect the current feed size, or a custom message.
 * Centralises the formatting that was previously inlined in 4+ call sites.
 */
function setTrayFeedTooltip(getTray, state, override) {
  const t = getTray && getTray();
  if (!t || t.isDestroyed()) return;
  if (override) {
    t.setToolTip(override);
    return;
  }
  const n = state.feed.length;
  t.setToolTip(`ListingWatch \u00b7 ${n} listing${n !== 1 ? "s" : ""} in feed`);
}

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
    setTrayFeedTooltip(getTray, state);
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
    // ─── Defensive validation ───────────────────────────────────────────────────
    if (!search || typeof search !== "object") {
      throw new Error("save-search: invalid search payload");
    }
    if (!MARKETPLACE_SOURCES.includes(search.source)) {
      throw new Error(`save-search: unknown source "${search.source}". Expected one of: ${MARKETPLACE_SOURCES.join(", ")}`);
    }
    if (search.minInterval != null) {
      search.minInterval = Math.max(30, Math.floor(Number(search.minInterval) || 30));
    }
    if (search.maxInterval != null) {
      search.maxInterval = Math.max(search.minInterval || 30, Math.floor(Number(search.maxInterval) || 120));
    }
    if (search.maxNotifyPrice != null) {
      const parsed = Number(search.maxNotifyPrice);
      search.maxNotifyPrice = Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
    }
    search.includeLists = Array.isArray(search.includeLists) ? search.includeLists.filter((id) => typeof id === "string") : [];

    const { onNewItems, onStatus } = makeCallbacks(state, getSettings, getWindow, getTray);

    if (search.id) {
      const idx = state.searches.findIndex((s) => s.id === search.id);
      if (idx !== -1) {
        // Attaching or detaching a list changes what qualifies, so items already
        // marked seen have to be reconsidered.
        const prevLists = Array.isArray(state.searches[idx].includeLists) ? state.searches[idx].includeLists : [];
        const listsChanged = prevLists.join(",") !== search.includeLists.join(",");

        state.searches[idx] = { ...state.searches[idx], ...search };
        stopSearch(search.id, state);
        if (listsChanged) resetSearchSeenState(state, search.id);
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
    delete state.deliveredIds[id];
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

  // ─── Keyword Lists ──────────────────────────────────────────────────────────
  // Reusable named term lists. Searches reference them by id through
  // `search.includeLists`; polling.js keeps only titles matching a term.
  ipcMain.handle("get-keyword-lists", () => state.keywordLists);

  ipcMain.handle("save-keyword-list", (_event, list) => {
    if (!list || typeof list !== "object") {
      throw new Error("save-keyword-list: invalid payload");
    }
    const name = String(list.name || "").trim();
    if (!name) throw new Error("save-keyword-list: name is required");
    const terms = cleanTerms(Array.isArray(list.terms) ? list.terms : []);

    const existing = list.id ? state.keywordLists.find((l) => l.id === list.id) : null;
    if (existing) {
      // Only bump the version when the terms actually change — the version is
      // both the compiled-form cache key and the trigger for re-scanning.
      const termsChanged = existing.terms.length !== terms.length || existing.terms.some((t, i) => t !== terms[i]);
      existing.name = name;
      existing.terms = terms;
      existing.updatedAt = new Date().toISOString();
      if (termsChanged) {
        existing.version = (existing.version || 0) + 1;
        resetSearchesUsingList(state, existing.id);
      }
    } else {
      state.keywordLists.push({
        id: `list_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        name,
        terms,
        version: 1,
        updatedAt: new Date().toISOString(),
      });
    }

    saveKeywordLists(state.keywordLists);
    return state.keywordLists;
  });

  ipcMain.handle("delete-keyword-list", (_event, id) => {
    const idx = state.keywordLists.findIndex((l) => l.id === id);
    if (idx === -1) return state.keywordLists;

    state.keywordLists.splice(idx, 1);
    invalidateCompiled(id);

    // Detach from any search using it. Those searches become less filtered, so
    // reset them too or newly-qualifying listings would stay invisible.
    let searchesChanged = false;
    for (const s of state.searches) {
      if (Array.isArray(s.includeLists) && s.includeLists.includes(id)) {
        s.includeLists = s.includeLists.filter((listId) => listId !== id);
        resetSearchSeenState(state, s.id);
        searchesChanged = true;
      }
    }
    if (searchesChanged) saveSearches(state.searches);

    saveKeywordLists(state.keywordLists);
    return state.keywordLists;
  });

  // Read terms out of a plain-text/CSV file so the user can review them in the
  // editor before saving — deliberately does not create the list itself.
  ipcMain.handle("import-keyword-list-file", async () => {
    const win = getWindow();
    const { canceled, filePaths } = await dialog.showOpenDialog(win, {
      title: "Import Terms",
      filters: [{ name: "Text", extensions: ["txt", "csv"] }],
      properties: ["openFile"],
    });
    if (canceled || !filePaths.length) return { ok: false, canceled: true };
    try {
      const { size } = fs.statSync(filePaths[0]);
      if (size > KEYWORD_FILE_MAX_BYTES) {
        throw new Error(`File is too large (${Math.round(size / 1024 / 1024)} MB). Limit is 5 MB.`);
      }
      const raw = fs.readFileSync(filePaths[0], "utf8");
      const terms = cleanTerms(splitTerms(raw));
      return { ok: true, terms, name: path.basename(filePaths[0]).replace(/\.[^.]+$/, "") };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // ─── Pause / Resume All ────────────────────────────────────────────────────
  ipcMain.handle("pause-all", () => {
    stopAllSearches(state);
    setTrayFeedTooltip(getTray, state, "ListingWatch \u00b7 Paused");
  });

  ipcMain.handle("resume-all", () => {
    const { onNewItems, onStatus } = makeCallbacks(state, getSettings, getWindow, getTray);
    startAllSearches(state, onNewItems, onStatus, getSettings);
    setTrayFeedTooltip(getTray, state);
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
    setTrayFeedTooltip(getTray, state, "ListingWatch");
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
  // Both eBay and Vinted dispatch through the adapter registry. Adding a new
  // marketplace requires no changes here — just register it in marketplace-adapters.js.
  ipcMain.handle("get-ebay-item-images", async (_event, itemId, site) => {
    try {
      const images = await getAdapter("ebay").getItemImages(itemId, site);
      return { ok: true, images };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle("get-vinted-item-images", async (_event, itemId, site) => {
    try {
      const images = await getAdapter("vinted").getItemImages(itemId, site);
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
      const data = {
        version: 2,
        exportedAt: new Date().toISOString(),
        searches: state.searches,
        keywordLists: state.keywordLists,
        settings: exportSettings,
      };
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
      // v1 backups predate keyword lists — absent means "leave existing lists
      // alone", which keeps any lists the user already has referenced.
      if (data.keywordLists !== undefined && !Array.isArray(data.keywordLists)) {
        throw new Error("Invalid backup file: 'keywordLists' must be an array.");
      }
      for (const s of data.searches) {
        if (!s.id || !s.name || !s.source) {
          throw new Error("Invalid backup file: a search entry is missing required fields (id, name, source).");
        }
        if (!MARKETPLACE_SOURCES.includes(s.source)) {
          throw new Error(`Invalid backup file: search "${s.name}" has unknown source "${s.source}".`);
        }
      }

      stopAllSearches(state);

      // Mutate in-place so existing closures in polling.js retain the same array reference.
      state.searches.splice(0, state.searches.length, ...data.searches);
      if (Array.isArray(data.keywordLists)) {
        for (const l of state.keywordLists) invalidateCompiled(l.id);
        state.keywordLists.splice(0, state.keywordLists.length, ...data.keywordLists);
        saveKeywordLists(state.keywordLists);
      }
      // Clear per-search runtime state for a clean slate after import.
      state.seenIds = {};
      state.deliveredIds = {};
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
