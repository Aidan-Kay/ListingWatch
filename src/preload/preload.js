const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("api", {
  // Searches
  getSearches: () => ipcRenderer.invoke("get-searches"),
  saveSearch: (search) => ipcRenderer.invoke("save-search", search),
  deleteSearch: (id) => ipcRenderer.invoke("delete-search", id),
  toggleSearch: (id, enabled) => ipcRenderer.invoke("toggle-search", id, enabled),

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

  // Taskbar badge
  updateBadge: (count, dataUrl) => ipcRenderer.invoke("update-badge", count, dataUrl),

  // Export / Import
  exportData: () => ipcRenderer.invoke("export-data"),
  importData: () => ipcRenderer.invoke("import-data"),

  // Events from main -> renderer
  onNewListings: (callback) => {
    ipcRenderer.on("new-listings", (_event, listings) => callback(listings));
  },
  onSearchStatus: (callback) => {
    ipcRenderer.on("search-status", (_event, status) => callback(status));
  },
  onToast: (callback) => {
    ipcRenderer.on("toast", (_event, message) => callback(message));
  },
});
