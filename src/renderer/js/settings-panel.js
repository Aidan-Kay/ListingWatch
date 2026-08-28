// ─── Settings ─────────────────────────────────────────────────────────────────

/**
 * Set a settings toggle switch (button with role="switch") to the given state.
 */
function setSettingsToggle(id, active) {
  const toggle = document.getElementById(id);
  if (!toggle) return;
  const knob = toggle.querySelector(".settings-toggle-knob");
  toggle.classList.toggle("bg-neutral-700", !active);
  toggle.classList.toggle("bg-accent-500", active);
  toggle.setAttribute("aria-checked", active ? "true" : "false");
  if (knob) {
    knob.classList.toggle("translate-x-1", !active);
    knob.classList.toggle("translate-x-4", active);
  }
}

/**
 * Read the current state of a settings toggle switch.
 */
function getSettingsToggle(id) {
  const toggle = document.getElementById(id);
  return toggle ? toggle.getAttribute("aria-checked") === "true" : false;
}

/**
 * Toggle a settings switch and auto-save.
 */
function toggleSettingsSwitch(id) {
  const current = getSettingsToggle(id);
  setSettingsToggle(id, !current);
  autoSaveSettings();
}

function applySettings() {
  document.getElementById("setting-client-id").value = settings.clientId || "";
  document.getElementById("setting-client-secret").value = settings.clientSecret || "";
  document.getElementById("setting-min-interval").value = settings.minInterval || 30;
  document.getElementById("setting-max-interval").value = settings.maxInterval || 120;

  // Notification format toggles — default all on
  const formats = settings.notifyFormats || ["Auction", "Buy It Now"];
  setSettingsToggle("notif-auction", formats.includes("Auction"));
  setSettingsToggle("notif-buy-it-now", formats.includes("Buy It Now"));
  setSettingsToggle("notif-when-focused", settings.notifyWhenFocused || false);

  // System tray
  setSettingsToggle("setting-minimize-to-tray", settings.minimizeToTray !== false);

  // Appearance
  feedZoom = settings.feedZoom || "medium";
  selectAccentColor(settings.accentColor || DEFAULT_ACCENT_COLOR, false);
  updateApiCallEstimate();

  // Notification sound
  const soundEnabled = settings.notificationSoundEnabled !== false;
  setSettingsToggle("setting-sound-enabled", soundEnabled);
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
  setSettingsToggle("setting-proxy-enabled", settings.proxyEnabled || false);
  document.getElementById("setting-proxy-url").value = settings.proxyUrl || "";

  // eBay API quota
  document.getElementById("setting-ebay-daily-limit").value = settings.ebayApiDailyLimit || 5000;

  // Show listings from hours
  document.getElementById("setting-show-listings-hours").value = settings.showListingsFromHours || 0;
}

let _settingsSaveTimer = null;
let _settingsToastTimer = null;
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
  if (getSettingsToggle("notif-auction")) notifyFormats.push("Auction");
  if (getSettingsToggle("notif-buy-it-now")) notifyFormats.push("Buy It Now");
  const notifyWhenFocused = getSettingsToggle("notif-when-focused");
  const accentColor = document.getElementById("setting-accent-color").value || DEFAULT_ACCENT_COLOR;

  const minimizeToTray = getSettingsToggle("setting-minimize-to-tray");

  // Sound
  const notificationSoundEnabled = getSettingsToggle("setting-sound-enabled");
  const notificationVolume = parseFloat(document.getElementById("setting-sound-volume").value);
  // soundFile is stored in `settings` by browseSoundFile/clearSoundFile — not read from display input
  const notificationSoundFile = settings.notificationSoundFile || null;

  // Proxy
  const proxyEnabled = getSettingsToggle("setting-proxy-enabled");
  const proxyUrl = document.getElementById("setting-proxy-url").value.trim();

  // eBay API quota
  const ebayApiDailyLimitRaw = parseInt(document.getElementById("setting-ebay-daily-limit").value, 10);
  const ebayApiDailyLimit =
    isNaN(ebayApiDailyLimitRaw) || ebayApiDailyLimitRaw < 1 ? settings.ebayApiDailyLimit || 5000 : ebayApiDailyLimitRaw;

  // Show listings from hours
  const showListingsFromHoursRaw = parseInt(document.getElementById("setting-show-listings-hours").value, 10);
  const showListingsFromHours = isNaN(showListingsFromHoursRaw) || showListingsFromHoursRaw < 0 ? 0 : showListingsFromHoursRaw;

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
    showListingsFromHours,
  });
  applyAccentColor(settings.accentColor);
  updateApiCallEstimate();
  // Debounce the toast so rapid saves (e.g. typing in a text field) only show one.
  clearTimeout(_settingsToastTimer);
  _settingsToastTimer = setTimeout(() => showToast("Settings saved", "success"), 400);
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

  // Sound volume
  document.getElementById("setting-sound-volume").addEventListener("input", (e) => {
    document.getElementById("setting-sound-volume-label").textContent = `${Math.round(e.target.value * 100)}%`;
    debounceSettingsSave(400);
  });

  // Proxy URL
  document.getElementById("setting-proxy-url").addEventListener("input", () => debounceSettingsSave());

  // eBay API quota
  document.getElementById("setting-ebay-daily-limit").addEventListener("change", () => autoSaveSettings());

  // Show listings from hours
  document.getElementById("setting-show-listings-hours").addEventListener("change", () => autoSaveSettings());
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
    favourites = await window.api.getFavourites();
    applySettings();
    renderSearches();
    showToast(`Imported ${plural(result.searchCount, "search", "searches")} and settings`, "success");
  } else {
    showToast(`Import failed: ${result.error}`, "error");
  }
}

// ─── Status ───────────────────────────────────────────────────────────────────
// Mirrors the main process's pause state, which is pushed over `polling-state`.
// The renderer must not decide this for itself: the tray menu pauses too, and a
// renderer-local flag went stale the moment it did.
let _allPaused = false;

/** Apply a pause state pushed from the main process. */
function setAllPaused(paused) {
  _allPaused = paused;
  updateStatus();
}

function updateStatus() {
  const dot = document.getElementById("status-dot");
  const text = document.getElementById("status-text");
  const pauseBtn = document.getElementById("pause-all-btn");

  const enabled = searches.filter((s) => s.enabled);
  const errored = searches.filter((s) => s.error);

  if (_allPaused && enabled.length > 0) {
    dot.className = "w-2 h-2 rounded-full bg-neutral-500 flex-shrink-0";
    dot.title = "Paused — all searches are paused";
    text.textContent = `${plural(enabled.length, "search", "searches")} paused`;
  } else if (enabled.length === 0) {
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
      const anyEnabled = searches.some((s) => s.enabled);
      pauseBtn.textContent = anyEnabled && !_allPaused ? "Pause All" : "Resume All";
    }
  }
}

/**
 * Pause or resume every search. Pausing stops the polling timers without
 * touching any search's `enabled` flag. The button reflects whatever the main
 * process reports, so it stays right even when the tray did the pausing.
 */
async function togglePauseAll() {
  if (_allPaused) {
    await window.api.resumeAll();
    showToast("All searches resumed", "info");
  } else {
    await window.api.pauseAll();
    showToast("All searches paused", "info");
  }
}
