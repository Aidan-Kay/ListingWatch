const { app, BrowserWindow, ipcMain, shell, Notification, nativeImage, dialog } = require("electron");
const path = require("path");
const fs = require("fs");

// ─── Paths ────────────────────────────────────────────────────────────────────
const userDataPath = app.getPath("userData");
const searchesFile = path.join(userDataPath, "searches.json");
const settingsFile = path.join(userDataPath, "settings.json");

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

// ─── eBay OAuth Token Cache ───────────────────────────────────────────────────
let accessToken = null;
let tokenExpiry = 0;

async function getAccessToken() {
  if (accessToken && Date.now() < tokenExpiry - 60000) return accessToken;

  const { clientId, clientSecret } = settings;
  if (!clientId || !clientSecret) throw new Error("eBay API credentials not configured. Add your Client ID and Client Secret in Settings.");

  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const res = await fetch("https://api.ebay.com/identity/v1/oauth2/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials&scope=https%3A%2F%2Fapi.ebay.com%2Foauth%2Fapi_scope",
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`eBay auth failed (${res.status}): ${text}`);
  }

  const data = await res.json();
  accessToken = data.access_token;
  tokenExpiry = Date.now() + data.expires_in * 1000;
  console.log("eBay access token acquired, expires in", data.expires_in, "s");
  return accessToken;
}

function invalidateToken() {
  accessToken = null;
  tokenExpiry = 0;
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

// ─── eBay Browse API ──────────────────────────────────────────────────────────
const MARKETPLACE_IDS = {
  US: "EBAY_US",
  UK: "EBAY_GB",
  AU: "EBAY_AU",
  DE: "EBAY_DE",
  FR: "EBAY_FR",
  ES: "EBAY_ES",
  IT: "EBAY_IT",
  CA: "EBAY_CA",
};

const CURRENCY_CODES = {
  US: "USD",
  UK: "GBP",
  AU: "AUD",
  DE: "EUR",
  FR: "EUR",
  ES: "EUR",
  IT: "EUR",
  CA: "CAD",
};

const CURRENCY_SYMBOLS = {
  USD: "$",
  GBP: "£",
  EUR: "€",
  AUD: "A$",
  CAD: "C$",
};

// ─── Category Tree ────────────────────────────────────────────────────────────
const CATEGORY_TREE_IDS = {
  US: "0",
  UK: "3",
  AU: "15",
  CA: "2",
  DE: "77",
  FR: "71",
  ES: "186",
  IT: "101",
};

let categoryTreeCache = {};

async function loadCategoryTree(site) {
  if (categoryTreeCache[site]) return categoryTreeCache[site];

  const cacheFile = path.join(userDataPath, `category_tree_${site}.json`);
  try {
    if (fs.existsSync(cacheFile)) {
      const cached = JSON.parse(fs.readFileSync(cacheFile, "utf8"));
      // Cache valid for 7 days
      if (cached.timestamp && Date.now() - cached.timestamp < 7 * 24 * 60 * 60 * 1000) {
        categoryTreeCache[site] = cached.categories;
        return cached.categories;
      }
    }
  } catch (e) {
    /* ignore stale cache */
  }

  const treeId = CATEGORY_TREE_IDS[site] || "0";
  const token = await getAccessToken();
  const marketplaceId = MARKETPLACE_IDS[site] || "EBAY_US";

  const res = await fetch(`https://api.ebay.com/commerce/taxonomy/v1/category_tree/${treeId}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      "X-EBAY-C-MARKETPLACE-ID": marketplaceId,
    },
    signal: AbortSignal.timeout(30000),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Category tree fetch failed (${res.status}): ${text.slice(0, 100)}`);
  }

  const data = await res.json();
  const categories = [];

  function traverse(node, parentId, depth) {
    if (!node.category || depth > 2) return;
    const { categoryId, categoryName } = node.category;
    if (depth > 0) {
      categories.push({ id: categoryId, name: categoryName, depth, parentId: parentId || null });
    }
    if (node.childCategoryTreeNodes) {
      for (const child of node.childCategoryTreeNodes) {
        traverse(child, depth > 0 ? categoryId : null, depth + 1);
      }
    }
  }
  traverse(data.rootCategoryNode, null, 0);

  try {
    fs.writeFileSync(cacheFile, JSON.stringify({ timestamp: Date.now(), categories }), "utf8");
  } catch (e) {
    /* ignore write errors */
  }

  categoryTreeCache[site] = categories;
  return categories;
}

// ─── Taskbar Badge ────────────────────────────────────────────────────────────
function createBadgeImage() {
  const size = 16;
  const buf = Buffer.alloc(size * size * 4, 0);
  const cx = 7.5,
    cy = 7.5,
    r = 7;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - cx,
        dy = y - cy;
      if (dx * dx + dy * dy <= r * r) {
        const i = (y * size + x) * 4;
        buf[i] = 239;
        buf[i + 1] = 68;
        buf[i + 2] = 68;
        buf[i + 3] = 255;
      }
    }
  }
  return nativeImage.createFromBuffer(buf, { width: size, height: size });
}

function updateTaskbarBadge(count, dataUrl) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (count > 0) {
    const img = dataUrl ? nativeImage.createFromDataURL(dataUrl) : createBadgeImage();
    mainWindow.setOverlayIcon(img, `${count} unseen listing${count !== 1 ? "s" : ""}`);
  } else {
    mainWindow.setOverlayIcon(null, "");
  }
}

const EBAY_SITE_URLS = {
  US: "https://www.ebay.com",
  UK: "https://www.ebay.co.uk",
  AU: "https://www.ebay.com.au",
  DE: "https://www.ebay.de",
  FR: "https://www.ebay.fr",
  ES: "https://www.ebay.es",
  IT: "https://www.ebay.it",
  CA: "https://www.ebay.ca",
};

async function searchEbay(search) {
  const token = await getAccessToken();
  const marketplaceId = MARKETPLACE_IDS[search.site] || "EBAY_US";
  const currency = CURRENCY_CODES[search.site] || "USD";

  const params = new URLSearchParams();
  if (search.keywords) params.set("q", search.keywords);
  if (search.category) params.set("category_ids", search.category);
  params.set("sort", "newlyListed");
  params.set("limit", "20");

  // Build filter string
  const filters = [];
  if (search.minPrice || search.maxPrice) {
    const min = search.minPrice || "";
    const max = search.maxPrice || "";
    filters.push(`price:[${min}..${max}],priceCurrency:${currency}`);
  }
  if (search.format === "buy_now") filters.push("buyingOptions:{FIXED_PRICE}");
  else if (search.format === "auction") filters.push("buyingOptions:{AUCTION}");
  else if (search.format === "best_offer") filters.push("buyingOptions:{BEST_OFFER|FIXED_PRICE}");
  else filters.push("buyingOptions:{AUCTION|FIXED_PRICE|BEST_OFFER}");
  const locCode = search.itemLocation ? { UK: "GB" }[search.itemLocation.toUpperCase()] || search.itemLocation.toUpperCase() : null;
  if (locCode) filters.push(`itemLocationCountry:${locCode}`);
  if (search.conditions && search.conditions.length > 0) {
    filters.push(`conditions:{${search.conditions.join("|")}}`);
  }
  if (filters.length) params.set("filter", filters.join(","));
  if (search.aspectFilters && search.aspectFilters.length > 0 && search.category) {
    // aspect_filter requires categoryId first, then each aspect as Name:{Value1|Value2}
    // Multiple aspects are comma-separated; multiple values within an aspect use |
    const validAspects = search.aspectFilters.filter((af) => af.name && af.values && af.values.length > 0);
    if (validAspects.length > 0) {
      const parts = [`categoryId:${search.category}`];
      for (const af of validAspects) {
        parts.push(`${af.name}:{${af.values.join("|")}}`);
      }
      params.set("aspect_filter", parts.join(","));
    }
  }

  const url = `https://api.ebay.com/buy/browse/v1/item_summary/search?${params}`;
  console.log(`[${search.name}] Browse API: ${url}`);

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      "X-EBAY-C-MARKETPLACE-ID": marketplaceId,
    },
    signal: AbortSignal.timeout(15000),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`eBay API ${res.status}: ${text.slice(0, 200)}`);
  }

  const data = await res.json();
  return parseApiResults(data, search);
}

function parseApiResults(data, search) {
  const siteBase = EBAY_SITE_URLS[search.site] || EBAY_SITE_URLS["US"];
  return (data.itemSummaries || []).map((item) => {
    // Price formatting — auctions use currentBidPrice, fixed-price use price
    let price = null;
    const priceSource = item.currentBidPrice || item.price || null;
    if (priceSource) {
      const sym = CURRENCY_SYMBOLS[priceSource.currency] || priceSource.currency + " ";
      const label = item.currentBidPrice ? "Bid: " : "";
      price = `${label}${sym}${parseFloat(priceSource.value).toFixed(2)}`;
    }

    // Image — prefer a real thumbnail
    let image = item.image?.imageUrl || (item.thumbnailImages && item.thumbnailImages[0]?.imageUrl) || null;
    if (image) image = image.replace(/s-l\d+/, "s-l300");

    // Item ID — API returns 'v1|123456789012|0', extract numeric part
    const rawId = item.itemId || "";
    const numericId = rawId.replace(/^v1\|/, "").replace(/\|.*$/, "");

    // Buying options → array of human labels
    const options = item.buyingOptions || [];
    const buyingFormats = [];
    if (options.includes("AUCTION")) buyingFormats.push("Auction");
    if (options.includes("FIXED_PRICE")) buyingFormats.push("Buy It Now");
    if (options.includes("BEST_OFFER")) buyingFormats.push("Best Offer");
    if (buyingFormats.length === 0) buyingFormats.push("Other");

    const itemUrl = item.itemWebUrl || `${siteBase}/itm/${numericId}`;

    return {
      id: `${search.id}_${numericId}`,
      itemId: numericId,
      searchId: search.id,
      searchName: search.name,
      cardColor: search.cardColor || null,
      site: search.site,
      title: item.title,
      price,
      image,
      url: itemUrl,
      buyingFormats,
      listingDate: item.itemCreationDate || null,
      foundAt: new Date().toISOString(),
    };
  });
}

// ─── Notifications ────────────────────────────────────────────────────────────
function sendNotifications(items) {
  if (!Notification.isSupported()) return;

  // Filter by allowed formats (default: all)
  const allowed = settings.notifyFormats && settings.notifyFormats.length > 0 ? settings.notifyFormats : ["Auction", "Buy It Now"];

  const filtered = items.filter((item) => {
    const formats = item.buyingFormats || [];
    return formats.some((f) => allowed.includes(f));
  });

  if (filtered.length === 0) return;

  // Group into a single notification if many new items, individual if just a few
  if (filtered.length === 1) {
    const item = filtered[0];
    const notif = new Notification({
      title: `New listing — ${item.searchName}`,
      body: `${item.title}${item.price ? `  ·  ${item.price}` : ""}`,
      silent: false,
    });
    notif.on("click", () => shell.openExternal(item.url));
    notif.show();
  } else {
    const notif = new Notification({
      title: `${filtered.length} new listings`,
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
function randomInterval() {
  const min = (settings.minInterval || 30) * 1000;
  const max = (settings.maxInterval || 120) * 1000;
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

async function fetchSearch(search) {
  try {
    const items = await searchEbay(search);

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
      // Add the 10 most recent listings to the feed on first load
      const initItems = newItems.slice(0, 10);
      console.log(`[${search.name}] Initialised — adding ${initItems.length} of ${items.length} listings to feed`);
      if (initItems.length > 0) {
        feed.unshift(...initItems);
        if (feed.length > 500) feed = feed.slice(0, 500);
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send("new-listings", initItems);
        }
      }
      updateSearchStatus(search.id, { lastFetched: new Date().toISOString(), error: null });
    } else if (newItems.length > 0) {
      console.log(`[${search.name}] Found ${newItems.length} new listing(s)`);
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
    console.error(`[${search.name}] Fetch error:`, err.message);
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
      if (!searches.find((s) => s.id === search.id && s.enabled)) return;
      const delay = randomInterval();
      console.log(`[${search.name}] Next fetch in ${Math.round(delay / 1000)}s`);
      timers[search.id] = setTimeout(async () => {
        const current = searches.find((s) => s.id === search.id);
        if (current && current.enabled) {
          await fetchSearch(current);
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
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1500,
    height: 1100,
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

  ipcMain.handle("get-settings", () => settings);

  ipcMain.handle("save-settings", (_event, newSettings) => {
    const credentialsChanged = newSettings.clientId !== settings.clientId || newSettings.clientSecret !== settings.clientSecret;
    settings = { ...settings, ...newSettings };
    if (credentialsChanged) invalidateToken();
    saveSettingsFile();
    return settings;
  });

  ipcMain.handle("test-connection", async () => {
    try {
      invalidateToken();
      await getAccessToken();
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
      const categories = await loadCategoryTree(site);
      return { ok: true, categories };
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
      title: "Export eBayWatch Data",
      defaultPath: `ebaywatch-backup-${new Date().toISOString().slice(0, 10)}.json`,
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
      title: "Import eBayWatch Data",
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
      invalidateToken();

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
