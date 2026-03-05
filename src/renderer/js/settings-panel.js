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

  // Notification sound
  const soundEnabled = settings.notificationSoundEnabled !== false;
  document.getElementById("setting-sound-enabled").checked = soundEnabled;
  const soundFileDisplay = document.getElementById("setting-sound-file-display");
  if (settings.notificationSoundFile) {
    soundFileDisplay.value = settings.notificationSoundFile.split(/[\\/]/).pop();
  } else {
    soundFileDisplay.value = "";
  }
  const volSlider = document.getElementById("setting-sound-volume");
  const volLabel = document.getElementById("setting-sound-volume-label");
  const vol = settings.notificationVolume != null ? settings.notificationVolume : 1.0;
  volSlider.value = vol;
  volLabel.textContent = `${Math.round(vol * 100)}%`;

  // Proxy
  document.getElementById("setting-proxy-enabled").checked = settings.proxyEnabled || false;
  document.getElementById("setting-proxy-url").value = settings.proxyUrl || "";

  // eBay API quota
  document.getElementById("setting-ebay-daily-limit").value = settings.ebayApiDailyLimit || 5000;
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

  // Sound
  const notificationSoundEnabled = document.getElementById("setting-sound-enabled").checked;
  const notificationVolume = parseFloat(document.getElementById("setting-sound-volume").value);
  // soundFile is stored in `settings` by browseSoundFile/clearSoundFile — not read from display input
  const notificationSoundFile = settings.notificationSoundFile || null;

  // Proxy
  const proxyEnabled = document.getElementById("setting-proxy-enabled").checked;
  const proxyUrl = document.getElementById("setting-proxy-url").value.trim();

  // eBay API quota
  const ebayApiDailyLimitRaw = parseInt(document.getElementById("setting-ebay-daily-limit").value, 10);
  const ebayApiDailyLimit =
    isNaN(ebayApiDailyLimitRaw) || ebayApiDailyLimitRaw < 1 ? settings.ebayApiDailyLimit || 5000 : ebayApiDailyLimitRaw;

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
    notificationSoundEnabled,
    notificationSoundFile,
    notificationVolume,
    proxyEnabled,
    proxyUrl,
    ebayApiDailyLimit,
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

  // Sound
  document.getElementById("setting-sound-enabled").addEventListener("change", () => autoSaveSettings());
  document.getElementById("setting-sound-volume").addEventListener("input", (e) => {
    document.getElementById("setting-sound-volume-label").textContent = `${Math.round(e.target.value * 100)}%`;
    debounceSettingsSave(400);
  });

  // Proxy
  document.getElementById("setting-proxy-enabled").addEventListener("change", () => autoSaveSettings());
  document.getElementById("setting-proxy-url").addEventListener("input", () => debounceSettingsSave());

  // eBay API quota
  document.getElementById("setting-ebay-daily-limit").addEventListener("change", () => autoSaveSettings());
}

// ─── Sound helpers ────────────────────────────────────────────────────────────
async function browseSoundFile() {
  const filePath = await window.api.selectSoundFile();
  if (!filePath) return;
  settings.notificationSoundFile = filePath;
  document.getElementById("setting-sound-file-display").value = filePath.split(/[\\/]/).pop();
  await autoSaveSettings();
}

async function clearSoundFile() {
  settings.notificationSoundFile = null;
  document.getElementById("setting-sound-file-display").value = "";
  await autoSaveSettings();
}

// ─── Proxy helpers ────────────────────────────────────────────────────────────
async function testProxyConnection() {
  const statusEl = document.getElementById("proxy-status");
  statusEl.textContent = "Testing…";
  statusEl.className = "text-xs text-neutral-400";

  const proxyUrl = document.getElementById("setting-proxy-url").value.trim();
  if (!proxyUrl) {
    statusEl.textContent = "Enter a proxy URL first";
    statusEl.className = "text-xs text-danger-500";
    return;
  }

  const result = await window.api.testProxy(proxyUrl);
  if (result.ok) {
    statusEl.textContent = `✓ Connected — IP: ${result.ip}`;
    statusEl.className = "text-xs text-success-500";
  } else {
    statusEl.textContent = `✗ ${result.error}`;
    statusEl.className = "text-xs text-danger-500";
  }
}

// ─── eBay API Usage helpers ───────────────────────────────────────────────────
async function refreshApiUsage() {
  const usage = await window.api.getApiUsage();
  const bar = document.getElementById("api-usage-bar");
  const text = document.getElementById("api-usage-text");
  if (!usage) return;

  const limit = usage.limit || settings.ebayApiDailyLimit || 5000;
  const calls = usage.calls || 0;
  const pct = Math.min(100, Math.round((calls / limit) * 100));

  text.textContent = `${calls.toLocaleString()} / ${limit.toLocaleString()} (${pct}%)`;
  bar.style.width = `${pct}%`;
  bar.className = `h-2 rounded-full transition-all ${pct >= 90 ? "bg-danger-500" : pct >= 70 ? "bg-yellow-500" : "bg-accent-500"}`;
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
    text.textContent = "No active searches";
  } else if (errored.length > 0) {
    dot.className = "w-2 h-2 rounded-full bg-yellow-500 flex-shrink-0";
    dot.title = `Warning — ${errored.length} search error${errored.length !== 1 ? "s" : ""}`;
    text.textContent = `${enabled.length} active · ${plural(errored.length, "error")}`;
  } else {
    dot.className = "w-2 h-2 rounded-full bg-success-500 flex-shrink-0 animate-pulse";
    dot.title = "Active — all searches running";
    text.textContent = `${plural(enabled.length, "active search", "active searches")}`;
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
