const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("api", {
  // Searches
  getSearches: () => ipcRenderer.invoke("get-searches"),
  saveSearch: (search) => ipcRenderer.invoke("save-search", search),
  deleteSearch: (id) => ipcRenderer.invoke("delete-search", id),
  toggleSearch: (id, enabled) => ipcRenderer.invoke("toggle-search", id, enabled),
  toggleNotify: (id, notify) => ipcRenderer.invoke("toggle-notify", id, notify),

  // Settings
  getSettings: () => ipcRenderer.invoke("get-settings"),
  saveSettings: (settings) => ipcRenderer.invoke("save-settings", settings),
  testConnection: () => ipcRenderer.invoke("test-connection"),

  // Feed
  getFeed: () => ipcRenderer.invoke("get-feed"),
  clearFeed: () => ipcRenderer.invoke("clear-feed"),

  // Browser
  openExternal: (url) => ipcRenderer.invoke("open-external", url),

  // eBay Taxonomy
  getCategoryTree: (site) => ipcRenderer.invoke("get-category-tree", site),

  // eBay Item Images
  getEbayItemImages: (numericId, site) => ipcRenderer.invoke("get-ebay-item-images", numericId, site),

  // Vinted Item Images
  getVintedItemImages: (itemId, site) => ipcRenderer.invoke("get-vinted-item-images", itemId, site),

  // Taskbar badge
  updateBadge: (count, dataUrl) => ipcRenderer.invoke("update-badge", count, dataUrl),

  // Polling control
  pauseAll: () => ipcRenderer.invoke("pause-all"),
  resumeAll: () => ipcRenderer.invoke("resume-all"),

  // Favourites
  getFavourites: () => ipcRenderer.invoke("get-favourites"),
  saveFavourite: (item) => ipcRenderer.invoke("save-favourite", item),
  removeFavourite: (itemId) => ipcRenderer.invoke("remove-favourite", itemId),

  // Export / Import
  exportData: () => ipcRenderer.invoke("export-data"),
  importData: () => ipcRenderer.invoke("import-data"),

  // Events from main -> renderer
  onNewListings: (callback) => {
    ipcRenderer.removeAllListeners("new-listings");
    ipcRenderer.on("new-listings", (_event, listings) => callback(listings));
  },
  onSearchStatus: (callback) => {
    ipcRenderer.removeAllListeners("search-status");
    ipcRenderer.on("search-status", (_event, status) => callback(status));
  },
  onScrollToListing: (callback) => {
    ipcRenderer.removeAllListeners("scroll-to-listing");
    ipcRenderer.on("scroll-to-listing", (_event, itemIds) => callback(itemIds));
  },
});
