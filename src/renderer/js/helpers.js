// ─── Site + Brand Helpers ─────────────────────────────────────────────────────
// CURRENCY_SYMBOLS, SITE_CURRENCY_SYMBOL, BRAND_LABELS, EBAY_SITE_LABELS and
// VINTED_SITE_LABELS are defined in constants.js (loaded before this file).

function getBrandLabel(item) {
  return BRAND_LABELS[item.source] || item.source || "Unknown";
}

function getSiteLabel(item) {
  if (item.source === "ebay") {
    return EBAY_SITE_LABELS[item.site] || item.site || "eBay";
  } else if (item.source === "vinted") {
    return VINTED_SITE_LABELS[item.site] || item.site || "Vinted";
  }
}

function getSiteBadge(item, zoomClass) {
  const site = getSiteLabel(item);
  if (item.source === "ebay") {
    const colours = ["#ff343b", "#0c68ca", "#d19600", "#76ad00"];
    const styledEbay = BRAND_LABELS.ebay
      .split("")
      .map((ch, i) => `<span style="color: ${colours[i]}">${ch}</span>`)
      .join("");
    return `<span class="badge ${zoomClass} bg-neutral-200 text-neutral-800">${styledEbay}${item.site ? `<span style="margin-left:0.2em">${escapeHtml(item.site)}</span>` : ""}</span>`;
  } else if (item.source === "vinted") {
    return `<span class="badge ${zoomClass} bg-teal-600 text-neutral-100">${escapeHtml(site)}</span>`;
  }
}

// ─── Accent Colour ────────────────────────────────────────────────────────────
function hexToRgba(hex, alpha) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function darkenHex(hex, factor = 0.82) {
  const r = Math.round(parseInt(hex.slice(1, 3), 16) * factor);
  const g = Math.round(parseInt(hex.slice(3, 5), 16) * factor);
  const b = Math.round(parseInt(hex.slice(5, 7), 16) * factor);
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
}

function applyAccentColor(color) {
  if (!color) color = DEFAULT_ACCENT_COLOR;
  const dark = darkenHex(color);
  const rgba20 = hexToRgba(color, 0.2);
  let style = document.getElementById("accent-override");
  if (!style) {
    style = document.createElement("style");
    style.id = "accent-override";
    document.head.appendChild(style);
  }
  style.textContent = `
    .btn-primary { background-color: ${color} !important; }
    .btn-primary:hover { background-color: ${dark} !important; }
    .nav-item.active { color: ${color} !important; border-color: ${color} !important; }
    .text-accent-500 { color: ${color} !important; }
    .bg-accent-500 { background-color: ${color} !important; }
    .border-accent-500 { border-color: ${color} !important; }
    .focus\\:border-accent-500:focus { border-color: ${color} !important; }
    .badge-accent { background-color: ${rgba20} !important; color: ${color} !important; }
    .condition-checkbox { accent-color: ${color} !important; }
    .text-accent-600 { color: ${dark} !important; }
    .hover\\:text-accent-400:hover, .hover\\:text-accent-600:hover { color: ${dark} !important; }
    a.text-accent-500 { color: ${color} !important; }
  `;
}

function selectAccentColor(color) {
  const input = document.getElementById("setting-accent-color");
  if (input) input.value = color;
  document.querySelectorAll(".accent-swatch").forEach((el) => {
    const isSelected = el.dataset.color === color;
    el.classList.toggle("ring-white", isSelected);
    el.classList.toggle("ring-transparent", !isSelected);
  });
  const customPreview = document.getElementById("accent-swatch-custom-preview");
  if (customPreview) customPreview.style.background = color;
  const customInput = document.getElementById("accent-color-custom-input");
  if (customInput) customInput.value = color;
  applyAccentColor(color);
  // Auto-save so the colour persists without requiring "Save Settings"
  if (typeof settings !== "undefined" && window.api) {
    settings.accentColor = color;
    autoSaveSettings();
  }
}

// ─── Utilities ────────────────────────────────────────────────────────────────
function timeAgo(isoString) {
  if (!isoString) return "Unknown";
  const diff = Date.now() - new Date(isoString).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function plural(n, singular, pluralForm) {
  return `${n} ${n === 1 ? singular : pluralForm || singular + "s"}`;
}

function ebayImageUrl(url, size = 1600) {
  if (!url) return url;
  return url.replace(/s-l\d+/, `s-l${size}`);
}

function escapeHtml(str) {
  if (!str) return "";
  return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

function escapeAttr(str) {
  if (!str) return "";
  return String(str).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

function buyingFormatLabel(format) {
  const labels = { buy_now: "Buy It Now", auction: "Auction", all: "All Listings" };
  return labels[format] || format;
}
