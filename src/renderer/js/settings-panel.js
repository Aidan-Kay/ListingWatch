// ─── Settings ─────────────────────────────────────────────────────────────────
function applySettings() {
  document.getElementById("setting-client-id").value = settings.clientId || "";
  document.getElementById("setting-client-secret").value = settings.clientSecret || "";
  document.getElementById("setting-min-interval").value = settings.minInterval || 30;
  document.getElementById("setting-max-interval").value = settings.maxInterval || 120;

  // Notification format checkboxes — default all on
  const formats = settings.notifyFormats || ["Auction", "Buy It Now"];
  document.getElementById("notif-auction").checked = formats.includes("Auction");
  document.getElementById("notif-buy-it-now").checked = formats.includes("Buy It Now");
  document.getElementById("notif-when-focused").checked = settings.notifyWhenFocused || false;

  // System tray
  document.getElementById("setting-minimize-to-tray").checked = settings.minimizeToTray !== false;

  // Appearance
  feedZoom = settings.feedZoom || "medium";
  selectAccentColor(settings.accentColor || DEFAULT_ACCENT_COLOR);
  updateApiCallEstimate();
}

let _settingsSaveTimer = null;
let _settingsSavedTimer = null;
function debounceSettingsSave(delay = 800) {
  clearTimeout(_settingsSaveTimer);
  _settingsSaveTimer = setTimeout(() => autoSaveSettings(), delay);
}

async function autoSaveSettings() {
  const clientId = document.getElementById("setting-client-id").value.trim();
  const clientSecret = document.getElementById("setting-client-secret").value.trim();
  const minRaw = parseInt(document.getElementById("setting-min-interval").value, 10);
  const maxRaw = parseInt(document.getElementById("setting-max-interval").value, 10);
  // Fall back to last saved value if the field contains an invalid number
  const minInterval = isNaN(minRaw) || minRaw < 10 ? settings.minInterval || 30 : minRaw;
  const maxInterval = isNaN(maxRaw) || maxRaw < minInterval ? settings.maxInterval || 120 : maxRaw;

  const notifyFormats = [];
  if (document.getElementById("notif-auction").checked) notifyFormats.push("Auction");
  if (document.getElementById("notif-buy-it-now").checked) notifyFormats.push("Buy It Now");
  const notifyWhenFocused = document.getElementById("notif-when-focused").checked;
  const accentColor = document.getElementById("setting-accent-color").value || DEFAULT_ACCENT_COLOR;

  const minimizeToTray = document.getElementById("setting-minimize-to-tray").checked;

  settings = await window.api.saveSettings({
    clientId,
    clientSecret,
    minInterval,
    maxInterval,
    notifyFormats,
    notifyWhenFocused,
    accentColor,
    feedZoom,
    minimizeToTray,
  });
  applyAccentColor(settings.accentColor);
  updateApiCallEstimate();
  // Flash a brief "saved" indicator in the Settings page subtitle
  if (currentPage === "settings") {
    const subtitleEl = document.getElementById("header-subtitle");
    if (subtitleEl) {
      subtitleEl.textContent = "Settings saved ✓";
      clearTimeout(_settingsSavedTimer);
      _settingsSavedTimer = setTimeout(() => {
        if (currentPage === "settings" && subtitleEl) {
          subtitleEl.textContent = PAGE_META.settings.subtitle;
        }
      }, 2000);
    }
  }
}

/**
 * Compute and display the estimated daily eBay API call count based on the
 * current interval settings and number of enabled eBay searches.
 */
function updateApiCallEstimate() {
  const el = document.getElementById("api-call-estimate");
  if (!el) return;
  const minInterval = parseInt(document.getElementById("setting-min-interval").value, 10) || settings.minInterval || 30;
  const maxInterval = parseInt(document.getElementById("setting-max-interval").value, 10) || settings.maxInterval || 120;
  const enabledCount = searches.filter((s) => s.enabled && s.source === "ebay").length;
  if (enabledCount === 0) {
    el.textContent = "";
    return;
  }
  const minCalls = Math.round((86400 / maxInterval) * enabledCount);
  const maxCalls = Math.round((86400 / minInterval) * enabledCount);
  el.textContent = `With ${enabledCount} active eBay ${enabledCount === 1 ? "search" : "searches"} at ${minInterval}–${maxInterval}s intervals: ~${minCalls.toLocaleString()}–${maxCalls.toLocaleString()} calls/day`;
}

function initSettingsListeners() {
  document.getElementById("setting-client-id").addEventListener("input", () => debounceSettingsSave());
  document.getElementById("setting-client-secret").addEventListener("input", () => debounceSettingsSave());

  document.getElementById("setting-min-interval").addEventListener("change", () => {
    const val = parseInt(document.getElementById("setting-min-interval").value, 10);
    if (isNaN(val) || val < 10) {
      showToast("Minimum interval must be at least 10 seconds", "error");
      document.getElementById("setting-min-interval").value = settings.minInterval || 30;
      return;
    }
    autoSaveSettings();
  });

  document.getElementById("setting-max-interval").addEventListener("change", () => {
    const minVal = parseInt(document.getElementById("setting-min-interval").value, 10);
    const val = parseInt(document.getElementById("setting-max-interval").value, 10);
    if (isNaN(val) || val < minVal) {
      showToast("Maximum interval must be greater than or equal to minimum", "error");
      document.getElementById("setting-max-interval").value = settings.maxInterval || 120;
      return;
    }
    autoSaveSettings();
  });

  document.getElementById("notif-auction").addEventListener("change", () => autoSaveSettings());
  document.getElementById("notif-buy-it-now").addEventListener("change", () => autoSaveSettings());
  document.getElementById("notif-when-focused").addEventListener("change", () => autoSaveSettings());

  document.getElementById("setting-minimize-to-tray").addEventListener("change", () => autoSaveSettings());
}

async function testConnection() {
  const statusEl = document.getElementById("connection-status");
  statusEl.textContent = "Testing…";
  statusEl.className = "text-xs text-neutral-400";

  const clientId = document.getElementById("setting-client-id").value.trim();
  const clientSecret = document.getElementById("setting-client-secret").value.trim();
  if (!clientId || !clientSecret) {
    statusEl.textContent = "Enter credentials first";
    statusEl.className = "text-xs text-danger-500";
    return;
  }
  await window.api.saveSettings({ clientId, clientSecret });

  const result = await window.api.testConnection();
  if (result.ok) {
    statusEl.textContent = "✓ Connected successfully";
    statusEl.className = "text-xs text-success-500";
  } else {
    statusEl.textContent = `✗ ${result.error}`;
    statusEl.className = "text-xs text-danger-500";
  }
}

function openDevPortal() {
  window.api.openExternal("https://developer.ebay.com/my/auth/?env=production&index=0");
}

// ─── Export / Import ─────────────────────────────────────────────────────────
async function exportData() {
  const result = await window.api.exportData();
  if (result.canceled) return;
  if (result.ok) {
    showToast("Data exported successfully", "success");
  } else {
    showToast(`Export failed: ${result.error}`, "error");
  }
}

async function importData() {
  if (!(await appConfirm("Importing will replace all current searches and settings. Continue?", "Import", false))) return;
  const result = await window.api.importData();
  if (result.canceled) return;
  if (result.ok) {
    searches = await window.api.getSearches();
    settings = await window.api.getSettings();
    applySettings();
    renderSearches();
    showToast(`Imported ${plural(result.searchCount, "search", "searches")} and settings`, "success");
  } else {
    showToast(`Import failed: ${result.error}`, "error");
  }
}

// ─── Status ───────────────────────────────────────────────────────────────────
function updateStatus() {
  const dot = document.getElementById("status-dot");
  const text = document.getElementById("status-text");
  const pauseBtn = document.getElementById("pause-all-btn");

  const enabled = searches.filter((s) => s.enabled);
  const errored = searches.filter((s) => s.error);

  if (enabled.length === 0) {
    dot.className = "w-2 h-2 rounded-full bg-neutral-600 flex-shrink-0";
    dot.title = "Inactive — no searches are running";
    text.textContent = "○ No active searches";
  } else if (errored.length > 0) {
    dot.className = "w-2 h-2 rounded-full bg-yellow-500 flex-shrink-0";
    dot.title = `Warning — ${errored.length} search error${errored.length !== 1 ? "s" : ""}`;
    text.textContent = `⚠ ${enabled.length} active · ${plural(errored.length, "error")}`;
  } else {
    dot.className = "w-2 h-2 rounded-full bg-success-500 flex-shrink-0 animate-pulse";
    dot.title = "Active — all searches running";
    text.textContent = `◉ ${plural(enabled.length, "active search", "active searches")}`;
  }

  if (pauseBtn) {
    if (searches.length === 0) {
      pauseBtn.classList.add("hidden");
    } else {
      pauseBtn.classList.remove("hidden");
      pauseBtn.textContent = allPaused || enabled.length === 0 ? "Resume All" : "Pause All";
    }
  }
}

async function togglePauseAll() {
  const anyEnabled = searches.some((s) => s.enabled) && !allPaused;
  if (anyEnabled) {
    allPaused = true;
    await window.api.pauseAll();
    showToast("All searches paused", "info");
  } else {
    allPaused = false;
    await window.api.resumeAll();
    showToast("All searches resumed", "info");
  }
  updateStatus();
}
