// ─── State ────────────────────────────────────────────────────────────────────
let searches = [];
let feedItems = [];
let settings = {};
let currentPage = "feed";
let modalEnabled = true;
let newCount = 0;
let modalCardColor = null;
// Category tree state
let currentCategoryTree = []; // flat array of { id, name, depth, parentId }

// Condition multi-select state
let selectedConditions = []; // array of condition value strings
let conditionDropdownOpen = false;

// Aspect filter state
let aspectFilters = []; // array of { id, name, values: string }
let aspectFilterCounter = 0;

// Condition definitions
const CONDITIONS = [
  { id: "NEW", label: "New" },
  { id: "LIKE_NEW", label: "Like New" },
  { id: "NEW_OTHER", label: "New (Other)" },
  { id: "NEW_WITH_DEFECTS", label: "New with Defects" },
  { id: "CERTIFIED_REFURBISHED", label: "Certified Refurbished" },
  { id: "EXCELLENT_REFURBISHED", label: "Excellent Refurbished" },
  { id: "VERY_GOOD_REFURBISHED", label: "Very Good Refurbished" },
  { id: "GOOD_REFURBISHED", label: "Good Refurbished" },
  { id: "SELLER_REFURBISHED", label: "Seller Refurbished" },
  { id: "USED", label: "Used" },
  { id: "VERY_GOOD", label: "Very Good" },
  { id: "GOOD", label: "Good" },
  { id: "ACCEPTABLE", label: "Acceptable" },
  { id: "FOR_PARTS_OR_NOT_WORKING", label: "For Parts / Not Working" },
];
// ─── Init ─────────────────────────────────────────────────────────────────────
(async () => {
  searches = await window.api.getSearches();
  feedItems = await window.api.getFeed();
  settings = await window.api.getSettings();

  applySettings();
  renderSearches();
  renderFeed();
  updateStatus();
  showPage("feed");

  // Listen for new listings pushed from main process
  window.api.onNewListings((items) => {
    feedItems.unshift(...items);
    newCount += items.length;
    renderFeed();
    updateFeedBadge();
    if (currentPage !== "feed") {
      showToast(`${items.length} new listing${items.length > 1 ? "s" : ""} found`, "success");
    }
  });

  // Listen for search status updates
  window.api.onSearchStatus((status) => {
    const s = searches.find((x) => x.id === status.searchId);
    if (s) {
      Object.assign(s, status);
      renderSearches();
    }
    updateStatus();
  });

  // Listen for toast messages from main
  window.api.onToast(({ message, type }) => showToast(message, type));
})();

// ─── Navigation ───────────────────────────────────────────────────────────────
const PAGE_META = {
  feed: {
    title: "Feed",
    subtitle: "New listings from all active searches",
    actions: () => `
      <span id="feed-count" class="text-xs text-neutral-500">${feedItems.length ? `${feedItems.length} listing${feedItems.length !== 1 ? "s" : ""}` : ""}</span>
      <button onclick="clearFeed()" class="btn-ghost text-xs">Clear Feed</button>
    `,
  },
  searches: {
    title: "Searches",
    subtitle: "Configure your eBay searches to monitor",
    actions: () => `
      <button onclick="openSearchModal(null)" class="btn-primary flex items-center gap-2">
        <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
          <path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15"/>
        </svg>
        Add Search
      </button>
    `,
  },
  settings: {
    title: "Settings",
    subtitle: "Configure application behaviour",
    actions: () => "",
  },
};

function showPage(page) {
  currentPage = page;

  document.querySelectorAll(".page").forEach((el) => el.classList.add("hidden"));
  document.querySelectorAll(".nav-item").forEach((el) => el.classList.remove("active"));

  document.getElementById(`page-${page}`).classList.remove("hidden");
  document.querySelector(`[data-page="${page}"]`).classList.add("active");

  // Update unified header
  const meta = PAGE_META[page];
  if (meta) {
    document.getElementById("header-title").textContent = meta.title;
    document.getElementById("header-subtitle").textContent = meta.subtitle;
    document.getElementById("header-actions").innerHTML = meta.actions();
  }

  if (page === "feed") {
    newCount = 0;
    updateFeedBadge();
  }
}

// ─── Toast ────────────────────────────────────────────────────────────────────
function showToast(message, type = "info") {
  const container = document.getElementById("toast-container");
  const toast = document.createElement("div");

  const colors = {
    success: "bg-success-500",
    error: "bg-danger-500",
    info: "bg-neutral-700",
    warning: "bg-yellow-600",
  };

  toast.className = `animate-toast-in pointer-events-auto flex items-center gap-3 px-4 py-3 rounded-lg shadow-xl text-white text-sm font-medium ${colors[type] || colors.info}`;
  toast.innerHTML = `
    <div class="flex-1">${message}</div>
    <button onclick="this.parentElement.remove()" class="text-white/70 hover:text-white ml-2">
      <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
        <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/>
      </svg>
    </button>
  `;

  container.appendChild(toast);
  setTimeout(() => toast.classList.add("opacity-0", "transition-opacity", "duration-500"), 3500);
  setTimeout(() => toast.remove(), 4000);
}

// ─── Feed ─────────────────────────────────────────────────────────────────────
function renderFeed() {
  const empty = document.getElementById("feed-empty");
  const grid = document.getElementById("feed-grid");
  const countEl = document.getElementById("feed-count");

  if (countEl) countEl.textContent = feedItems.length ? `${feedItems.length} listing${feedItems.length !== 1 ? "s" : ""}` : "";

  if (feedItems.length === 0) {
    empty.classList.remove("hidden");
    grid.classList.add("hidden");
    return;
  }

  empty.classList.add("hidden");
  grid.classList.remove("hidden");

  // Sort feed by listing date descending (newest listing first)
  const sorted = [...feedItems].sort((a, b) => {
    const da = new Date(a.listingDate || a.foundAt).getTime();
    const db = new Date(b.listingDate || b.foundAt).getTime();
    return db - da;
  });

  grid.innerHTML = sorted
    .map((item, index) => {
      const dateForAge = item.listingDate || item.foundAt;
      const isNew = Date.now() - new Date(item.foundAt).getTime() < 60000;
      const formats = Array.isArray(item.buyingFormats) ? item.buyingFormats : item.buyingFormat ? [item.buyingFormat] : [];
      const FORMAT_LABELS = { "Buy It Now": "BIN", "Best Offer": "Offer" };
      const formatBadges = formats
        .map((f) => {
          const cls = f === "Auction" ? "badge-auction" : "badge-default";
          return `<span class="badge ${cls} mr-1">${escapeHtml(FORMAT_LABELS[f] || f)}</span>`;
        })
        .join("");

      const cardColorStyle = item.cardColor
        ? `border-color: ${hexToRgba(item.cardColor, 0.75)}; background-image: linear-gradient(135deg, ${hexToRgba(item.cardColor, 0.22)} 0%, ${hexToRgba(item.cardColor, 0.06)} 40%, transparent 65%);`
        : "";

      return `
      <div
        class="card p-3 flex gap-3 cursor-pointer hover:bg-neutral-700/50 animate-fade-in"
        style="animation-delay: ${Math.min(index, 10) * 30}ms; ${cardColorStyle}"
        onclick="openListing('${escapeAttr(item.url)}')"
        title="${escapeAttr(item.title)}"
      >
        <!-- Thumbnail -->
        <div class="w-20 h-20 flex-shrink-0 rounded-md overflow-hidden bg-neutral-700 relative group">
          ${
            item.image
              ? `<img src="${escapeAttr(item.image)}" alt="" class="w-full h-full object-cover" onerror="this.parentElement.innerHTML='<div class=\\'w-full h-full flex items-center justify-center\\'><svg class=\\'w-6 h-6 text-neutral-600\\' fill=\\'none\\' viewBox=\\'0 0 24 24\\' stroke=\\'currentColor\\'><path stroke-linecap=\\'round\\' stroke-linejoin=\\'round\\' stroke-width=\\'1.5\\' d=\\'M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3 3h18\\'/></svg></div>'" />
                <div class="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors flex items-center justify-center cursor-zoom-in" onclick="event.stopPropagation(); openImagePopup('${escapeAttr(item.image)}')"
                ><svg class="w-5 h-5 text-white opacity-0 group-hover:opacity-100 transition-opacity drop-shadow" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-4.35-4.35M17 11A6 6 0 115 11a6 6 0 0112 0zm-3-1h-2V8m0 0V6m0 2H10"/></svg></div>`
              : `<div class="w-full h-full flex items-center justify-center">
                <svg class="w-6 h-6 text-neutral-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3 3h18"/>
                </svg>
              </div>`
          }
        </div>

        <!-- Info -->
        <div class="flex-1 min-w-0 flex flex-col gap-1">
          <!-- Row 1: Title + NEW badge -->
          <div class="flex items-start justify-between gap-2">
            <p class="text-sm font-medium text-secondary leading-snug line-clamp-2 flex-1">${escapeHtml(item.title)}</p>
            <span class="badge badge-accent flex-shrink-0 feed-new-badge ${isNew ? "" : "hidden"}" data-found-at="${escapeAttr(item.foundAt)}">NEW</span>
          </div>
          <!-- Row 2: Price / shipping (left) · Condition (right) -->
          <div class="flex items-center justify-between gap-2">
            <div class="flex items-center gap-2 min-w-0">
              ${
                item.price
                  ? `<span class="text-sm font-semibold text-accent-500 flex-shrink-0">${escapeHtml(item.price)}</span>`
                  : `<span class="text-xs text-neutral-500 flex-shrink-0">No price</span>`
              }
              ${item.shipping ? `<span class="text-xs text-neutral-500 truncate">${escapeHtml(item.shipping)}</span>` : ""}
            </div>
            ${item.condition ? `<span class="text-xs text-neutral-400 flex-shrink-0 truncate max-w-[45%] text-right">${escapeHtml(item.condition)}</span>` : ""}
          </div>
          <!-- Row 3: Age · search name (left) · badges (right) -->
          <div class="flex items-center justify-between gap-2 mt-auto pt-0.5">
            <div class="flex items-center gap-1.5 min-w-0 text-xs text-neutral-500">
              <span class="flex-shrink-0 feed-age" data-date="${escapeAttr(dateForAge)}">${timeAgo(dateForAge)}</span>
              <span class="text-neutral-600 flex-shrink-0">·</span>
              <span class="truncate">${escapeHtml(item.searchName)}</span>
            </div>
            <div class="flex items-center gap-1 flex-shrink-0 ml-1">
              ${formatBadges}
              <span class="badge bg-neutral-700 text-neutral-400 text-xs">${escapeHtml(item.site || "")}</span>
            </div>
          </div>
        </div>
      </div>
    `;
    })
    .join("");
}

function drawBadgeImage(count) {
  const size = 16;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");

  // Red circle
  ctx.fillStyle = "#ef4444";
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
  ctx.fill();

  // White number
  const label = count > 99 ? "99+" : String(count);
  ctx.fillStyle = "#ffffff";
  ctx.font = `bold ${label.length > 1 ? 7 : 9}px sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, size / 2, size / 2 + 0.5);

  return canvas.toDataURL();
}

function updateFeedBadge() {
  const badge = document.getElementById("feed-badge");
  if (newCount > 0 && currentPage !== "feed") {
    badge.textContent = newCount > 99 ? "99+" : newCount;
    badge.classList.remove("hidden");
    window.api.updateBadge(newCount, drawBadgeImage(newCount));
  } else {
    badge.classList.add("hidden");
    window.api.updateBadge(0, null);
  }
}

async function clearFeed() {
  feedItems = await window.api.clearFeed();
  newCount = 0;
  updateFeedBadge();
  renderFeed();
  showToast("Feed cleared", "info");
}

function openListing(url) {
  window.api.openExternal(url);
}

function openImagePopup(thumbUrl) {
  const lightbox = document.getElementById("image-lightbox");
  const img = document.getElementById("image-lightbox-img");
  // Swap thumbnail size suffix for a larger version
  const fullUrl = thumbUrl.replace(/s-l\d+/, "s-l1600");
  img.src = fullUrl;
  img.onerror = () => { img.src = thumbUrl; }; // fall back to thumb if full-res 404s
  lightbox.classList.remove("hidden");
  lightbox.classList.add("flex");
}

function closeImagePopup() {
  const lightbox = document.getElementById("image-lightbox");
  lightbox.classList.add("hidden");
  lightbox.classList.remove("flex");
  document.getElementById("image-lightbox-img").src = "";
}

// ─── Searches ─────────────────────────────────────────────────────────────────
const SITE_CURRENCY_SYMBOL = {
  US: "$",
  UK: "£",
  AU: "A$",
  CA: "C$",
  DE: "€",
  FR: "€",
  ES: "€",
  IT: "€",
};

function renderSearches() {
  const empty = document.getElementById("searches-empty");
  const list = document.getElementById("searches-list");
  const countBadge = document.getElementById("searches-count");

  countBadge.textContent = searches.length;

  if (searches.length === 0) {
    empty.classList.remove("hidden");
    list.classList.add("hidden");
    return;
  }

  empty.classList.add("hidden");
  list.classList.remove("hidden");

  list.innerHTML = searches
    .map((search) => {
      const hasError = !!search.error;
      const lastFetched = search.lastFetched ? timeAgo(search.lastFetched) : "Never";
      const sym = SITE_CURRENCY_SYMBOL[search.site] || "$";
      const priceRange =
        search.minPrice || search.maxPrice ? ` · ${sym}${search.minPrice || "0"} – ${search.maxPrice ? sym + search.maxPrice : "∞"}` : "";

      return `
      <div class="card p-4 flex items-center gap-4">
        <!-- Status dot -->
        <div class="flex-shrink-0">
          <div class="w-2.5 h-2.5 rounded-full ${search.enabled ? (hasError ? "bg-danger-500" : "bg-success-500") : "bg-neutral-600"}"></div>
        </div>

        <!-- Info -->
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-2">
            <p class="text-sm font-medium text-secondary truncate">${escapeHtml(search.name)}</p>
            <span class="badge bg-neutral-700 text-neutral-400 text-xs flex-shrink-0">${escapeHtml(search.site || "US")}</span>
            ${search.cardColor ? `<span class="w-2.5 h-2.5 rounded-full flex-shrink-0" style="background:${escapeAttr(search.cardColor)}"></span>` : ""}
            ${!search.enabled ? '<span class="badge bg-neutral-700 text-neutral-500 text-xs">Paused</span>' : ""}
          </div>
          <p class="text-xs text-neutral-500 mt-0.5 truncate">
            ${search.keywords ? escapeHtml(search.keywords) : '<span class="italic">No keywords</span>'}
            ${priceRange}
            ${search.format && search.format !== "all" ? ` · ${formatLabel(search.format)}` : ""}
          </p>
          <p class="text-xs mt-0.5 ${hasError ? "text-danger-500" : "text-neutral-600"}">
            ${hasError ? `Error: ${escapeHtml(search.error)}` : `Last checked: ${lastFetched}`}
          </p>
        </div>

        <!-- Actions -->
        <div class="flex items-center gap-2 flex-shrink-0">
          <!-- Toggle -->
          <button
            onclick="toggleSearch('${escapeAttr(search.id)}', ${!search.enabled})"
            title="${search.enabled ? "Pause search" : "Resume search"}"
            class="relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${search.enabled ? "bg-accent-500" : "bg-neutral-700"}"
          >
            <span class="inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${search.enabled ? "translate-x-4" : "translate-x-1"}"></span>
          </button>

          <button
            onclick="openSearchModal('${escapeAttr(search.id)}')"
            title="Edit search"
            class="btn-ghost px-2 py-1.5"
          >
            <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125"/>
            </svg>
          </button>

          <button
            onclick="deleteSearch('${escapeAttr(search.id)}')"
            title="Delete search"
            class="btn-ghost px-2 py-1.5 hover:text-danger-500 hover:bg-danger-500/10"
          >
            <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0"/>
            </svg>
          </button>
        </div>
      </div>
    `;
    })
    .join("");
}

async function toggleSearch(id, enabled) {
  searches = await window.api.toggleSearch(id, enabled);
  renderSearches();
  showToast(`Search ${enabled ? "resumed" : "paused"}`, "info");
}

async function deleteSearch(id) {
  const search = searches.find((s) => s.id === id);
  if (!search) return;
  if (!confirm(`Delete the search "${search.name}"? This cannot be undone.`)) return;

  searches = await window.api.deleteSearch(id);
  feedItems = feedItems.filter((item) => item.searchId !== id);
  renderSearches();
  renderFeed();
  showToast("Search deleted", "info");
}

// ─── Search Modal ─────────────────────────────────────────────────────────────
async function openSearchModal(id) {
  const modal = document.getElementById("search-modal");
  const titleEl = document.getElementById("modal-title");

  // Reset form
  document.getElementById("modal-search-id").value = "";
  document.getElementById("modal-name").value = "";
  document.getElementById("modal-site").value = "US";
  document.getElementById("modal-keywords").value = "";
  document.getElementById("modal-category").value = "";
  document.getElementById("modal-category-l1").innerHTML = '<option value="">— Browse top-level categories —</option>';
  document.getElementById("modal-category-l2").innerHTML = '<option value="">All sub-categories</option>';
  document.getElementById("modal-category-l2").classList.add("hidden");
  document.getElementById("modal-min-price").value = "";
  document.getElementById("modal-max-price").value = "";
  document.getElementById("modal-location").value = "";
  document.getElementById("modal-format").value = "all";
  document.getElementById("modal-min-interval").value = "";
  document.getElementById("modal-max-interval").value = "";
  selectedConditions = [];
  updateConditionDisplay();
  closeConditionDropdown();
  clearAspectFilters();
  setModalEnabled(true);
  setModalCardColor(null);

  if (id) {
    const search = searches.find((s) => s.id === id);
    if (!search) return;
    titleEl.textContent = "Edit Search";
    document.getElementById("modal-search-id").value = search.id;
    document.getElementById("modal-name").value = search.name || "";
    document.getElementById("modal-site").value = search.site || "US";
    document.getElementById("modal-keywords").value = search.keywords || "";
    document.getElementById("modal-category").value = search.category || "";
    document.getElementById("modal-min-price").value = search.minPrice || "";
    document.getElementById("modal-max-price").value = search.maxPrice || "";
    // Location: map legacy 'UK' -> 'GB'
    const loc = search.itemLocation ? { UK: "GB" }[search.itemLocation.toUpperCase()] || search.itemLocation.toUpperCase() : "";
    document.getElementById("modal-location").value = loc;
    document.getElementById("modal-format").value = search.format || "all";
    document.getElementById("modal-min-interval").value = search.minInterval || "";
    document.getElementById("modal-max-interval").value = search.maxInterval || "";
    selectedConditions = Array.isArray(search.conditions) ? [...search.conditions] : [];
    updateConditionDisplay();
    loadAspectFiltersFromSaved(search.aspectFilters);
    setModalEnabled(search.enabled !== false);
    setModalCardColor(search.cardColor || null);
  } else {
    titleEl.textContent = "Add Search";
  }

  modal.classList.remove("hidden");
  modal.classList.add("flex");
  document.getElementById("modal-name").focus();

  // Load category tree for selected site (async — populates dropdowns after modal is visible)
  const site = document.getElementById("modal-site").value;
  const existingCategoryId = id ? searches.find((s) => s.id === id)?.category || "" : "";
  loadCategoryTreeForModal(site, existingCategoryId);
}

function closeSearchModal(event) {
  if (event && event.target !== document.getElementById("search-modal")) return;
  const modal = document.getElementById("search-modal");
  modal.classList.add("hidden");
  modal.classList.remove("flex");
}

function toggleModalEnabled() {
  setModalEnabled(!modalEnabled);
}

function setModalCardColor(color) {
  modalCardColor = color || null;
  document.querySelectorAll(".color-swatch").forEach((el) => {
    el.classList.remove("ring-white");
    el.classList.add("ring-transparent");
  });
  const noneBtn = document.getElementById("color-swatch-none");
  const customLabel = document.getElementById("color-swatch-custom");
  if (noneBtn) {
    noneBtn.classList.remove("ring-white");
    noneBtn.classList.add("ring-transparent");
  }
  if (customLabel) {
    customLabel.classList.remove("ring-white");
    customLabel.classList.add("ring-transparent");
  }

  if (!color) {
    if (noneBtn) {
      noneBtn.classList.add("ring-white");
      noneBtn.classList.remove("ring-transparent");
    }
  } else {
    const preset = document.querySelector(`.color-swatch[data-color="${color}"]`);
    if (preset) {
      preset.classList.add("ring-white");
      preset.classList.remove("ring-transparent");
    } else if (customLabel) {
      const preview = document.getElementById("color-swatch-custom-preview");
      if (preview) preview.style.background = color;
      const input = document.getElementById("modal-card-color-custom");
      if (input) input.value = color;
      customLabel.classList.add("ring-white");
      customLabel.classList.remove("ring-transparent");
    }
  }
}

function hexToRgba(hex, alpha) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function setModalEnabled(value) {
  modalEnabled = value;
  const toggle = document.getElementById("modal-enabled-toggle");
  const knob = document.getElementById("modal-enabled-knob");
  if (modalEnabled) {
    toggle.classList.remove("bg-neutral-700");
    toggle.classList.add("bg-accent-500");
    knob.classList.remove("translate-x-1");
    knob.classList.add("translate-x-4");
  } else {
    toggle.classList.add("bg-neutral-700");
    toggle.classList.remove("bg-accent-500");
    knob.classList.add("translate-x-1");
    knob.classList.remove("translate-x-4");
  }
}

async function saveSearch() {
  const name = document.getElementById("modal-name").value.trim();
  if (!name) {
    showToast("Please enter a search name", "error");
    document.getElementById("modal-name").focus();
    return;
  }

  const keywords = document.getElementById("modal-keywords").value.trim();
  const category = document.getElementById("modal-category").value.trim();
  if (!keywords && !category) {
    showToast("Please enter keywords or select a category", "error");
    document.getElementById("modal-keywords").focus();
    return;
  }

  const search = {
    id: document.getElementById("modal-search-id").value || undefined,
    name,
    site: document.getElementById("modal-site").value,
    keywords,
    category,
    minPrice: document.getElementById("modal-min-price").value || null,
    maxPrice: document.getElementById("modal-max-price").value || null,
    itemLocation: document.getElementById("modal-location").value || null,
    format: document.getElementById("modal-format").value,
    conditions: selectedConditions.length > 0 ? [...selectedConditions] : [],
    aspectFilters: aspectFilters
      .filter((af) => af.name.trim() && af.values.trim())
      .map((af) => ({
        name: af.name.trim(),
        values: af.values
          .split(",")
          .map((v) => v.trim())
          .filter((v) => v),
      })),
    cardColor: modalCardColor || null,
    minInterval: parseInt(document.getElementById("modal-min-interval").value) || null,
    maxInterval: parseInt(document.getElementById("modal-max-interval").value) || null,
    enabled: modalEnabled,
  };

  try {
    searches = await window.api.saveSearch(search);
    // Retroactively update cardColor on any existing feed items from this search
    if (search.id) {
      let feedUpdated = false;
      feedItems.forEach((item) => {
        if (item.searchId === search.id && item.cardColor !== (search.cardColor || null)) {
          item.cardColor = search.cardColor || null;
          feedUpdated = true;
        }
      });
      if (feedUpdated) renderFeed();
    }
    renderSearches();
    closeSearchModal();
    showToast(`Search "${name}" ${search.id ? "updated" : "added"}`, "success");
  } catch (err) {
    showToast(`Failed to save search: ${err.message}`, "error");
  }
}

function openEbayCategories() {
  const site = document.getElementById("modal-site").value;
  const urls = {
    US: "https://www.ebay.com/n/all-categories",
    UK: "https://www.ebay.co.uk/n/all-categories",
    AU: "https://www.ebay.com.au/n/all-categories",
    CA: "https://www.ebay.ca/n/all-categories",
    DE: "https://www.ebay.de/n/all-categories",
    FR: "https://www.ebay.fr/n/all-categories",
    ES: "https://www.ebay.es/n/all-categories",
    IT: "https://www.ebay.it/n/all-categories",
  };
  window.api.openExternal(urls[site] || urls["US"]);
}

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

  settings = await window.api.saveSettings({ clientId, clientSecret, minInterval, maxInterval, notifyFormats });
  showToast("Settings saved", "success");
}

async function testConnection() {
  const statusEl = document.getElementById("connection-status");
  statusEl.textContent = "Testing…";
  statusEl.className = "text-xs text-neutral-400";

  // Save current credentials first so main process uses the latest values
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

// ─── Export / Import ────────────────────────────────────────────────────────
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
    // Reload state from main process
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

// ─── Helpers ──────────────────────────────────────────────────────────────────
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

// Tick every 15s to update visible timestamps and expire NEW badges without re-rendering the feed
setInterval(() => {
  document.querySelectorAll(".feed-age[data-date]").forEach((el) => {
    el.textContent = timeAgo(el.dataset.date);
  });
  document.querySelectorAll(".feed-new-badge[data-found-at]").forEach((el) => {
    const age = Date.now() - new Date(el.dataset.foundAt).getTime();
    if (age >= 60000) el.classList.add("hidden");
  });
}, 15000);

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    const lightbox = document.getElementById("image-lightbox");
    if (lightbox && !lightbox.classList.contains("hidden")) closeImagePopup();
  }
});

function escapeHtml(str) {
  if (!str) return "";
  return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

function escapeAttr(str) {
  if (!str) return "";
  return String(str).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

function formatLabel(format) {
  const labels = {
    buy_now: "Buy It Now",
    auction: "Auction",
    best_offer: "Best Offer",
    all: "All Listings",
  };
  return labels[format] || format;
}

// ─── Category Tree ────────────────────────────────────────────────────────────
async function loadCategoryTreeForModal(site, currentCategoryId) {
  const l1 = document.getElementById("modal-category-l1");
  const l2 = document.getElementById("modal-category-l2");
  currentCategoryTree = [];

  l1.innerHTML = '<option value="">Loading categories…</option>';
  l2.innerHTML = '<option value="">All sub-categories</option>';
  l2.classList.add("hidden");

  try {
    const result = await window.api.getCategoryTree(site);
    if (!result.ok) {
      l1.innerHTML = `<option value="">⚠ ${escapeHtml(result.error || "Failed to load")}</option>`;
      return;
    }
    currentCategoryTree = result.categories;

    // Populate L1 (depth=1) sorted alphabetically
    const topLevel = currentCategoryTree.filter((c) => c.depth === 1).sort((a, b) => a.name.localeCompare(b.name));
    l1.innerHTML = '<option value="">— Browse top-level categories —</option>';
    for (const cat of topLevel) {
      const opt = document.createElement("option");
      opt.value = cat.id;
      opt.textContent = cat.name;
      l1.appendChild(opt);
    }

    // If editing, pre-select the saved category
    if (currentCategoryId) {
      const saved = currentCategoryTree.find((c) => c.id === currentCategoryId);
      if (saved) {
        if (saved.depth === 1) {
          l1.value = saved.id;
          onCategoryL1Change(); // populate L2 without auto-setting category input
        } else if (saved.depth === 2) {
          const parent = currentCategoryTree.find((c) => c.id === saved.parentId);
          if (parent) {
            l1.value = parent.id;
            _populateL2(parent);
            l2.value = saved.id;
          }
        }
      }
    }
  } catch (e) {
    l1.innerHTML = `<option value="">Error loading categories</option>`;
  }
}

function _populateL2(parentCat) {
  const l2 = document.getElementById("modal-category-l2");
  const children = currentCategoryTree
    .filter((c) => c.depth === 2 && c.parentId === parentCat.id)
    .sort((a, b) => a.name.localeCompare(b.name));
  l2.innerHTML = `<option value="">All — ${escapeHtml(parentCat.name)}</option>`;
  for (const child of children) {
    const opt = document.createElement("option");
    opt.value = child.id;
    opt.textContent = child.name;
    l2.appendChild(opt);
  }
  if (children.length > 0) {
    l2.classList.remove("hidden");
  } else {
    l2.classList.add("hidden");
  }
}

function onSiteChange() {
  const site = document.getElementById("modal-site").value;
  loadCategoryTreeForModal(site, "");
  // Clear category when site changes
  document.getElementById("modal-category").value = "";
  document.getElementById("modal-category-l2").innerHTML = '<option value="">All sub-categories</option>';
  document.getElementById("modal-category-l2").classList.add("hidden");
}

function onCategoryL1Change() {
  const l1 = document.getElementById("modal-category-l1");
  const catInput = document.getElementById("modal-category");

  if (!l1.value) {
    document.getElementById("modal-category-l2").innerHTML = '<option value="">All sub-categories</option>';
    document.getElementById("modal-category-l2").classList.add("hidden");
    catInput.value = "";
    return;
  }

  const selectedCat = currentCategoryTree.find((c) => c.id === l1.value);
  if (!selectedCat) return;
  catInput.value = selectedCat.id;
  _populateL2(selectedCat);
}

function onCategoryL2Change() {
  const l1 = document.getElementById("modal-category-l1");
  const l2 = document.getElementById("modal-category-l2");
  const catInput = document.getElementById("modal-category");
  catInput.value = l2.value || l1.value;
}

// ─── Condition Multi-Select ───────────────────────────────────────────────────
function initConditionDropdown() {
  const list = document.getElementById("condition-list");
  list.innerHTML = CONDITIONS.map(
    (c) => `
    <label class="flex items-center gap-3 px-3 py-2 hover:bg-neutral-700 cursor-pointer select-none">
      <input type="checkbox" value="${c.id}" class="condition-checkbox"
        ${selectedConditions.includes(c.id) ? "checked" : ""}
        onchange="toggleCondition('${c.id}')">
      <span class="text-sm text-secondary">${c.label}</span>
    </label>
  `,
  ).join("");
}

function toggleCondition(id) {
  if (selectedConditions.includes(id)) {
    selectedConditions = selectedConditions.filter((c) => c !== id);
  } else {
    selectedConditions.push(id);
  }
  updateConditionDisplay();
}

function updateConditionDisplay() {
  const display = document.getElementById("condition-display");
  if (!display) return;
  if (selectedConditions.length === 0) {
    display.textContent = "Any condition";
    display.className = "text-neutral-500 text-sm truncate";
  } else if (selectedConditions.length === 1) {
    const c = CONDITIONS.find((c) => c.id === selectedConditions[0]);
    display.textContent = c ? c.label : selectedConditions[0];
    display.className = "text-secondary text-sm truncate";
  } else {
    display.textContent = `${selectedConditions.length} conditions selected`;
    display.className = "text-secondary text-sm truncate";
  }
}

function toggleConditionDropdown(e) {
  e.stopPropagation();
  conditionDropdownOpen = !conditionDropdownOpen;
  const list = document.getElementById("condition-list");
  if (conditionDropdownOpen) {
    initConditionDropdown();
    list.classList.remove("hidden");
  } else {
    list.classList.add("hidden");
  }
}

function closeConditionDropdown() {
  conditionDropdownOpen = false;
  const list = document.getElementById("condition-list");
  if (list) list.classList.add("hidden");
}

// Close on outside click (capture phase so modal's stopPropagation doesn't block it)
document.addEventListener(
  "click",
  (e) => {
    const container = document.getElementById("condition-dropdown-container");
    if (container && !container.contains(e.target)) closeConditionDropdown();
  },
  true,
);

// ─── Aspect Filters ───────────────────────────────────────────────────────────
function addAspectFilter() {
  const id = ++aspectFilterCounter;
  aspectFilters.push({ id, name: "", values: "" });
  const container = document.getElementById("aspect-filters-list");
  const div = document.createElement("div");
  div.className = "flex gap-2";
  div.dataset.afId = String(id);
  div.innerHTML = `
    <input type="text" placeholder="Attribute name" class="input-field w-2/5 text-sm"
      oninput="updateAspectFilter(${id}, 'name', this.value)" />
    <input type="text" placeholder="Values (comma-separated)" class="input-field flex-1 text-sm"
      oninput="updateAspectFilter(${id}, 'values', this.value)" />
    <button type="button" onclick="removeAspectFilter(${id})"
      class="btn-ghost px-2 py-1.5 hover:text-danger-500 flex-shrink-0" title="Remove">
      <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
        <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/>
      </svg>
    </button>
  `;
  container.appendChild(div);
  div.querySelector("input").focus();
}

function removeAspectFilter(id) {
  aspectFilters = aspectFilters.filter((af) => af.id !== id);
  const el = document.querySelector(`[data-af-id="${id}"]`);
  if (el) el.remove();
}

function updateAspectFilter(id, field, value) {
  const af = aspectFilters.find((f) => f.id === id);
  if (af) af[field] = value;
}

function clearAspectFilters() {
  aspectFilters = [];
  aspectFilterCounter = 0;
  const container = document.getElementById("aspect-filters-list");
  if (container) container.innerHTML = "";
}

function loadAspectFiltersFromSaved(saved) {
  clearAspectFilters();
  if (!Array.isArray(saved)) return;
  for (const af of saved) {
    const id = ++aspectFilterCounter;
    const valString = Array.isArray(af.values) ? af.values.join(", ") : af.values || "";
    aspectFilters.push({ id, name: af.name || "", values: valString });
    const container = document.getElementById("aspect-filters-list");
    const div = document.createElement("div");
    div.className = "flex gap-2";
    div.dataset.afId = String(id);
    div.innerHTML = `
      <input type="text" placeholder="Attribute name" class="input-field w-2/5 text-sm"
        value="${escapeAttr(af.name || "")}"
        oninput="updateAspectFilter(${id}, 'name', this.value)" />
      <input type="text" placeholder="Values (comma-separated)" class="input-field flex-1 text-sm"
        value="${escapeAttr(valString)}"
        oninput="updateAspectFilter(${id}, 'values', this.value)" />
      <button type="button" onclick="removeAspectFilter(${id})"
        class="btn-ghost px-2 py-1.5 hover:text-danger-500 flex-shrink-0" title="Remove">
        <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
          <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/>
        </svg>
      </button>
    `;
    container.appendChild(div);
  }
}

// ─── Keyboard Shortcuts ───────────────────────────────────────────────────────
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    const modal = document.getElementById("search-modal");
    if (!modal.classList.contains("hidden")) {
      closeSearchModal();
    }
  }
});
