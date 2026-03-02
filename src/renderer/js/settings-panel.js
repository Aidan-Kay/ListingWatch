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

  // Appearance
  feedZoom = settings.feedZoom || "medium";
  selectAccentColor(settings.accentColor || "#f97316");
}

async function saveSettings() {
  const clientId = document.getElementById("setting-client-id").value.trim();
  const clientSecret = document.getElementById("setting-client-secret").value.trim();
  const minInterval = parseInt(document.getElementById("setting-min-interval").value, 10);
  const maxInterval = parseInt(document.getElementById("setting-max-interval").value, 10);

  if (!clientId || !clientSecret) {
    showToast("Please enter your eBay API Client ID and Client Secret", "error");
    return;
  }
  if (isNaN(minInterval) || minInterval < 10) {
    showToast("Minimum interval must be at least 10 seconds", "error");
    return;
  }
  if (isNaN(maxInterval) || maxInterval < minInterval) {
    showToast("Maximum interval must be greater than or equal to minimum", "error");
    return;
  }

  const notifyFormats = [];
  if (document.getElementById("notif-auction").checked) notifyFormats.push("Auction");
  if (document.getElementById("notif-buy-it-now").checked) notifyFormats.push("Buy It Now");
  const notifyWhenFocused = document.getElementById("notif-when-focused").checked;

  const accentColor = document.getElementById("setting-accent-color").value || "#f97316";

  settings = await window.api.saveSettings({
    clientId,
    clientSecret,
    minInterval,
    maxInterval,
    notifyFormats,
    notifyWhenFocused,
    accentColor,
    feedZoom,
  });
  applyAccentColor(settings.accentColor);
  showToast("Settings saved", "success");
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
  if (!confirm("Importing will replace all current searches and settings. Continue?")) return;
  const result = await window.api.importData();
  if (result.canceled) return;
  if (result.ok) {
    searches = await window.api.getSearches();
    settings = await window.api.getSettings();
    applySettings();
    renderSearches();
    showToast(`Imported ${result.searchCount} search${result.searchCount !== 1 ? "es" : ""} and settings`, "success");
  } else {
    showToast(`Import failed: ${result.error}`, "error");
  }
}

// ─── Status ───────────────────────────────────────────────────────────────────
function updateStatus() {
  const dot = document.getElementById("status-dot");
  const text = document.getElementById("status-text");

  const enabled = searches.filter((s) => s.enabled);
  const errored = searches.filter((s) => s.error);

  if (enabled.length === 0) {
    dot.className = "w-2 h-2 rounded-full bg-neutral-600 flex-shrink-0";
    text.textContent = "No active searches";
  } else if (errored.length > 0) {
    dot.className = "w-2 h-2 rounded-full bg-yellow-500 flex-shrink-0";
    text.textContent = `${enabled.length} active · ${errored.length} error${errored.length > 1 ? "s" : ""}`;
  } else {
    dot.className = "w-2 h-2 rounded-full bg-success-500 flex-shrink-0 animate-pulse";
    text.textContent = `${enabled.length} active search${enabled.length > 1 ? "es" : ""}`;
  }
}
