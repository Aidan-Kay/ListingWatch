// ─── Feed ─────────────────────────────────────────────────────────────────────

/**
 * Update the feed page subheading with the current listing count.
 * Shows "X listings" normally, "X of Y listings (filtered)" when a filter is
 * active, or the default descriptor when there are no items.
 */
function updateFeedSubtitle(filteredCount, totalCount) {
  const subtitleEl = document.getElementById("header-subtitle");
  if (!subtitleEl || currentPage !== "feed") return;
  if (totalCount === 0) {
    subtitleEl.textContent = "New listings from all active searches";
  } else if (filteredCount !== totalCount) {
    subtitleEl.textContent = `${filteredCount} of ${plural(totalCount, "listing")} (filtered)`;
  } else {
    subtitleEl.textContent = plural(totalCount, "listing");
  }
}

const FORMAT_BADGE_LABELS = { "Buy It Now": "BIN", "Best Offer": "Offer" };

// Cached filtered item count, updated by renderFeed() and incrementally maintained
// by prependFeedItems() to avoid a full O(n) re-filter on every batch prepend.
let _filteredCount = 0;

const ZOOM_CONFIG = {
  small: { minCol: "300px", img: "w-24 h-24", title: "text-xs", price: "text-sm", meta: "text-xs" },
  medium: { minCol: "400px", img: "w-28 h-28", title: "text-sm", price: "text-base", meta: "text-xs" },
  large: { minCol: "480px", img: "w-32 h-32", title: "text-base", price: "text-lg", meta: "text-sm" },
};

// Set of favourite IDs, rebuilt at the start of each render so that
// `renderFeedCard` is O(1) per item rather than O(favourites.length).
let _favouriteIdSet = new Set();
function _refreshFavouriteIdSet() {
  _favouriteIdSet = new Set(favourites.map((f) => f.id));
}

const IMAGE_PLACEHOLDER_SVG = `
  <svg class="w-6 h-6 text-neutral-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3 3h18"/>
  </svg>`;

/**
 * Thumbnail cell. The placeholder is always the bottom layer and the photo sits
 * on top of it, so a broken image only has to hide itself — which is what the
 * delegated `error` listener in initCardGridInteractions does. The alternative,
 * rebuilding the placeholder inside an inline onerror attribute, needs an
 * escaped SVG inside an escaped HTML string inside a template literal, and
 * nobody edits that safely.
 */
function _cardThumbnail(item, zoom) {
  const photo = item.image
    ? `<img src="${escapeAttr(item.image)}" alt="" loading="lazy" class="card-thumb absolute inset-0 w-full h-full object-cover object-center" />
       <div class="image-zoom absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors flex items-center justify-center" data-item-id="${escapeAttr(item.id)}">
         <svg class="w-5 h-5 text-white opacity-0 group-hover:opacity-100 transition-opacity drop-shadow" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
           <path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-4.35-4.35M17 11A6 6 0 115 11a6 6 0 0112 0zm-3-1h-2V8m0 0V6m0 2H10"/>
         </svg>
       </div>
       ${
         item.imageCount > 1
           ? `<span class="absolute bottom-1 right-1 text-xs text-white bg-black/70 px-1.5 py-0.5 rounded font-medium leading-tight pointer-events-none">${escapeHtml(String(item.imageCount))}</span>`
           : ""
       }`
    : "";

  return `
    <div class="${zoom.img} flex-shrink-0 rounded-md overflow-hidden bg-neutral-700 relative group">
      <div class="absolute inset-0 flex items-center justify-center">${IMAGE_PLACEHOLDER_SVG}</div>
      ${photo}
    </div>`;
}

/** Title row: name, NEW/ENDED/SOLD badges, and the favourite star. */
function _cardHeader(item, zoom, isFavourited) {
  const isNew = Date.now() - new Date(item.foundAt).getTime() < NEW_ITEM_WINDOW_MS;
  const isEnded = item.listingEndDate && new Date(item.listingEndDate).getTime() < Date.now();
  const isSold = isEnded && item.bidCount > 0 && (item.buyingFormats || []).includes("Auction");

  const endedBadge = isEnded
    ? `<span class="badge ${isSold ? "bg-green-600/20 text-green-400" : "bg-neutral-700 text-neutral-500"} ${zoom.meta}">${isSold ? "SOLD" : "ENDED"}</span>`
    : "";

  return `
    <div class="flex items-start justify-between gap-2">
      <p class="${zoom.title} font-medium text-secondary leading-snug line-clamp-2 flex-1">${escapeHtml(item.title)}</p>
      <div class="flex items-center gap-0.5 flex-shrink-0">
        <span class="badge badge-accent feed-new-badge ${zoom.meta} ${isNew ? "" : "hidden"}" data-found-at="${escapeAttr(item.foundAt)}">NEW</span>
        ${endedBadge}
        <button
          class="fav-btn transition-colors z-10 p-1 rounded ${isFavourited ? "text-yellow-400" : "text-neutral-400 hover:bg-neutral-700"}"
          data-item-id="${escapeAttr(item.id)}"
          data-tooltip="${isFavourited ? "Remove from favourites" : "Add to favourites"}"
        >
          <svg class="w-5 h-5" fill="${isFavourited ? "currentColor" : "none"}" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M11.48 3.499a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.84.61l-4.725-2.885a.563.563 0 00-.586 0L6.982 20.54a.562.562 0 01-.84-.61l1.285-5.386a.562.562 0 00-.182-.557l-4.204-3.602a.562.562 0 01.321-.988l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z"/>
          </svg>
        </button>
      </div>
    </div>`;
}

/** Condition line plus the matched-terms line, either of which may be absent. */
function _cardSubtitles(item, zoom) {
  const condition = item.condition ? `<p class="${zoom.meta} text-neutral-400 truncate">${escapeHtml(item.condition)}</p>` : "";
  const matched =
    Array.isArray(item.matchedTerms) && item.matchedTerms.length > 0
      ? `<p class="${zoom.meta} text-accent-500 truncate" title="Matched: ${escapeAttr(item.matchedTerms.join(", "))}">${escapeHtml(item.matchedTerms.join(", "))}</p>`
      : "";
  return condition + matched;
}

/** Price row, age, and the search/format/site line. */
function _cardFooter(item, zoom) {
  const dateForAge = item.listingDate || item.foundAt;
  const formatBadges = (item.buyingFormats || [])
    .map((format) => {
      const classes = { Auction: "badge-auction", "Buy It Now": "badge-bin", "Best Offer": "badge-offer" };
      return `<span class="badge ${classes[format] || "badge-default"} ${zoom.meta}">${escapeHtml(FORMAT_BADGE_LABELS[format] || format)}</span>`;
    })
    .join("");

  const price = item.price
    ? `<span class="${zoom.price} font-semibold text-white">${escapeHtml(item.price)}</span>`
    : `<span class="${zoom.meta} text-neutral-400">No price</span>`;
  const shipping = item.shipping ? `<span class="${zoom.meta} text-neutral-400">${escapeHtml(item.shipping)}</span>` : "";
  const bids = item.bidCount > 0 ? `<span class="${zoom.meta} text-neutral-400">${plural(item.bidCount, "bid")}</span>` : "";

  const attribution =
    Array.isArray(item.searchIds) && item.searchIds.length > 1
      ? `<span class="badge bg-neutral-700 text-neutral-400 ${zoom.meta}" title="${escapeAttr(item.searchIds.join(", "))}">${item.searchIds.length} searches</span>`
      : escapeHtml(item.searchName);

  return `
    <div class="flex flex-col gap-0.5 mt-auto pt-1">
      <div class="flex items-center gap-2">${price}${shipping}${bids}</div>
      <span class="${zoom.meta} text-neutral-400 feed-age" data-date="${escapeAttr(dateForAge)}">Listed ${timeAgo(dateForAge)}</span>
      <div class="flex items-center justify-between gap-2">
        <span class="truncate ${zoom.meta} text-neutral-400">${attribution}</span>
        <div class="flex items-center gap-1 flex-shrink-0">
          ${formatBadges}
          ${getSiteBadge(item, zoom.meta)}
        </div>
      </div>
    </div>`;
}

/**
 * Render one listing card. Every interactive part carries its identity in a
 * data- attribute and is dispatched by initCardGridInteractions rather than an
 * inline handler: escapeAttr is right for a plain attribute but not for one the
 * HTML parser decodes *before* compiling it as JavaScript, so `&#039;` in an
 * onclick turns back into a quote and a hostile item URL escapes the string.
 */
function renderFeedCard(item, zoom) {
  const cardColorStyle = item.cardColor
    ? `border-color: ${hexToRgba(item.cardColor, 0.75)}; background-image: linear-gradient(135deg, ${hexToRgba(item.cardColor, 0.15)} 0%, ${hexToRgba(item.cardColor, 0.04)} 25%, transparent 40%);`
    : "";
  const endedStyle = item.listingEndDate && new Date(item.listingEndDate).getTime() < Date.now() ? "opacity: 0.5;" : "";

  return `
    <div
      class="card p-3 flex gap-3 cursor-pointer hover:bg-neutral-700/50 animate-fade-in relative"
      style="${cardColorStyle}${endedStyle}"
      data-item-id="${escapeAttr(item.id)}"
      data-url="${escapeAttr(item.url)}"
      data-end-date="${escapeAttr(item.listingEndDate || "")}"
      title="${escapeAttr(item.title)}"
    >
      ${_cardThumbnail(item, zoom)}
      <div class="flex-1 min-w-0 flex flex-col">
        <div class="flex flex-col gap-0.5">
          ${_cardHeader(item, zoom, _favouriteIdSet.has(item.id))}
          ${_cardSubtitles(item, zoom)}
        </div>
        ${_cardFooter(item, zoom)}
      </div>
    </div>
  `;
}

/**
 * Wire up the feed and favourites grids once. Delegation replaces one inline
 * handler per card — cheaper than ~70 of them, and the prerequisite for
 * dropping 'unsafe-inline' from the CSP.
 */
function initCardGridInteractions() {
  for (const gridId of ["feed-grid", "favourites-grid"]) {
    const grid = document.getElementById(gridId);
    if (!grid) continue;

    grid.addEventListener("click", (e) => {
      const fav = e.target.closest(".fav-btn");
      if (fav) {
        e.stopPropagation();
        toggleFavourite(fav.dataset.itemId);
        return;
      }
      const zoom = e.target.closest(".image-zoom");
      if (zoom) {
        e.stopPropagation();
        openImagePopup(zoom.dataset.itemId);
        return;
      }
      const card = e.target.closest("[data-url]");
      if (card && card.dataset.url) openListing(card.dataset.url);
    });

    // `error` doesn't bubble, so this has to listen in the capture phase.
    // Hiding the photo reveals the placeholder already sitting behind it.
    grid.addEventListener(
      "error",
      (e) => {
        if (e.target.classList && e.target.classList.contains("card-thumb")) e.target.classList.add("hidden");
      },
      true,
    );
  }
}

// ─── Feed Filtering & Sorting ─────────────────────────────────────────────────

/**
 * Extract a numeric value from a formatted price string (e.g. "£12.99", "Bid: $5.00")
 * for sorting purposes. Returns Infinity for items with no price (sorts to the end).
 */
function parsePriceNumeric(str) {
  if (!str) return Infinity;
  const match = str.match(/[\d,]+\.?\d*/);
  if (!match) return Infinity;
  return parseFloat(match[0].replace(/,/g, ""));
}

/**
 * Pure filter function: returns items matching the given filter criteria.
 * Shared between the feed and favourites pages.
 */
function filterItems(items, filters) {
  const { text, platform, searchId, buyingFormat } = filters;
  const hasActiveFilter = text || platform !== "all" || searchId !== "all" || buyingFormat !== "all";
  if (!hasActiveFilter) return items;

  const lowerText = text.toLowerCase();
  return items.filter((item) => {
    if (text && !item.title.toLowerCase().includes(lowerText)) return false;
    if (platform !== "all" && item.source !== platform) return false;
    if (searchId !== "all") {
      const ids = Array.isArray(item.searchIds) ? item.searchIds : [item.searchId];
      if (!ids.includes(searchId)) return false;
    }
    if (buyingFormat !== "all" && !(item.buyingFormats || []).includes(buyingFormat)) return false;
    return true;
  });
}

/**
 * Returns a filtered copy of `items` based on the current `feedFilters` state.
 * The backing `feedItems` array is never modified — filters are display-only.
 */
function applyFeedFilters(items) {
  const hasActiveFilter =
    feedFilters.text || feedFilters.platform !== "all" || feedFilters.searchId !== "all" || feedFilters.buyingFormat !== "all";

  const clearBtn = document.getElementById("filter-active-badge");
  if (clearBtn) clearBtn.classList.toggle("hidden", !hasActiveFilter);

  return filterItems(items, feedFilters);
}

/**
 * Returns a sorted copy of `items` based on the given sort order.
 * Does not modify the source array. Price sorting uses raw numeric values;
 * items with no parseable price sort to the end.
 */
/**
 * Extract a numeric timestamp from an item's listing date (preferred) or
 * found-at date (fallback). Used for chronological sorting.
 */
function itemListingTime(item) {
  return new Date(item.listingDate || item.foundAt).getTime();
}

function sortFeedItems(items, order) {
  const copy = [...items];
  if (order === "newest") return copy.sort((a, b) => itemListingTime(b) - itemListingTime(a));
  if (order === "oldest") return copy.sort((a, b) => itemListingTime(a) - itemListingTime(b));
  if (order === "price-asc") return copy.sort((a, b) => parsePriceNumeric(a.price) - parsePriceNumeric(b.price));
  if (order === "price-desc") return copy.sort((a, b) => parsePriceNumeric(b.price) - parsePriceNumeric(a.price));
  return copy;
}

/** Update a single feed filter key and re-render the feed. */
function setFeedFilter(key, value) {
  feedFilters[key] = value;
  // Show/hide the clear button when the text filter changes
  if (key === "text") {
    const clearBtn = document.getElementById("filter-text-clear");
    if (clearBtn) clearBtn.classList.toggle("hidden", !value);
  }
  renderFeed();
}

/** Clear the text filter input and re-render. */
function clearTextFilter() {
  feedFilters.text = "";
  const input = document.getElementById("filter-text");
  if (input) input.value = "";
  const clearBtn = document.getElementById("filter-text-clear");
  if (clearBtn) clearBtn.classList.add("hidden");
  renderFeed();
}

/** Update the feed sort order and re-render. */
function setFeedSort(order) {
  feedSortOrder = order;
  renderFeed();
}

/**
 * Populate a saved-search dropdown select element with grouped options.
 * Reusable for both the feed and favourites filter bars.
 */
function populateSearchFilterDropdown(selectId, currentVal) {
  const select = document.getElementById(selectId);
  if (!select) return;

  select.innerHTML = '<option value="all">All Searches</option>';

  const GROUPS = [
    { source: "ebay", label: "eBay" },
    { source: "vinted", label: "Vinted" },
  ];

  for (const { source, label } of GROUPS) {
    const groupSearches = searches.filter((s) => s.source === source);
    if (groupSearches.length === 0) continue;

    const group = document.createElement("optgroup");
    group.label = label;
    for (const s of groupSearches) {
      const opt = document.createElement("option");
      opt.value = s.id;
      opt.textContent = s.name;
      if (s.id === currentVal) opt.selected = true;
      group.appendChild(opt);
    }
    select.appendChild(group);
  }
}

/**
 * Repopulate the saved-search dropdown in both the feed and favourites filter
 * bars with the current list of searches. Call after searches are loaded or mutated.
 */
function updateFeedFilterSearchOptions() {
  populateSearchFilterDropdown("filter-search", feedFilters.searchId);
  populateSearchFilterDropdown("fav-filter-search", favouritesFilters.searchId);

  // If the previously selected search no longer exists, reset to "all"
  if (feedFilters.searchId !== "all" && !searches.find((s) => s.id === feedFilters.searchId)) {
    feedFilters.searchId = "all";
    const filterSearchEl = document.getElementById("filter-search");
    if (filterSearchEl) filterSearchEl.value = "all";
    renderFeed();
  }
  if (favouritesFilters.searchId !== "all" && !searches.find((s) => s.id === favouritesFilters.searchId)) {
    favouritesFilters.searchId = "all";
    const favSearchEl = document.getElementById("fav-filter-search");
    if (favSearchEl) favSearchEl.value = "all";
    if (currentPage === "favourites") renderFavourites();
  }
}

/** Build one empty-state call-to-action button. */
function _ctaButton(label, variant, onClick) {
  const button = document.createElement("button");
  button.className = `${variant} text-sm mt-1`;
  button.textContent = label;
  button.addEventListener("click", onClick);
  return button;
}

function renderFeed() {
  const empty = document.getElementById("feed-empty");
  const grid = document.getElementById("feed-grid");

  const filtered = applyFeedFilters(feedItems);
  const sorted = sortFeedItems(filtered, feedSortOrder);

  _filteredCount = filtered.length;
  updateFeedSubtitle(_filteredCount, feedItems.length);

  if (feedItems.length === 0) {
    empty.classList.remove("hidden");
    grid.classList.add("hidden");
    const subtitle = document.getElementById("feed-empty-subtitle");
    const cta = document.getElementById("feed-empty-cta");
    const hasSearches = searches.length > 0;
    const hasActive = searches.some((s) => s.enabled);
    if (subtitle) {
      subtitle.textContent = hasActive
        ? "Monitoring for new listings..."
        : hasSearches
          ? "Resume or add a search to see listings"
          : "Add a search to start monitoring";
    }
    if (cta) {
      cta.innerHTML = "";
      if (!hasSearches) {
        cta.appendChild(_ctaButton("Add Your First Search", "btn-primary", () => openSearchModal(null)));
        cta.classList.remove("hidden");
      } else if (!hasActive) {
        cta.appendChild(_ctaButton("Go to Searches", "btn-secondary", () => showPage("searches")));
        cta.classList.remove("hidden");
      } else {
        cta.classList.add("hidden");
      }
    }
    return;
  }

  if (sorted.length === 0) {
    // Items exist but all filtered out — show an appropriate empty state
    empty.classList.remove("hidden");
    grid.classList.add("hidden");
    const subtitle = document.getElementById("feed-empty-subtitle");
    if (subtitle) subtitle.textContent = "No listings match the current filters";
    return;
  }

  empty.classList.add("hidden");
  grid.classList.remove("hidden");
  const zoom = ZOOM_CONFIG[feedZoom] || ZOOM_CONFIG.medium;
  grid.style.gridTemplateColumns = `repeat(auto-fill, minmax(${zoom.minCol}, 1fr))`;

  _refreshFavouriteIdSet();
  grid.innerHTML = sorted.map((item) => renderFeedCard(item, zoom)).join("");
}

/**
 * Reset all feed filters to their defaults and re-render.
 */
function clearAllFilters() {
  feedFilters = { text: "", platform: "all", searchId: "all", buyingFormat: "all" };
  const textEl = document.getElementById("filter-text");
  const platformEl = document.getElementById("filter-platform");
  const searchEl = document.getElementById("filter-search");
  const formatEl = document.getElementById("filter-format");
  if (textEl) textEl.value = "";
  if (platformEl) platformEl.value = "all";
  if (searchEl) searchEl.value = "all";
  if (formatEl) formatEl.value = "all";
  renderFeed();
}

// Cache the badge image data URL by count. drawBadgeImage was previously called
// from updateFeedBadge() on every feed-page navigation, regenerating an
// identical canvas/data URL each time and shipping it across IPC.
const _badgeImageCache = new Map();
function drawBadgeImage(count) {
  const key = count > 99 ? "99+" : String(count);
  const cached = _badgeImageCache.get(key);
  if (cached) return cached;

  const size = 16;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = "#ef4444";
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#ffffff";
  ctx.font = `bold ${key.length > 1 ? 7 : 9}px sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(key, size / 2, size / 2 + 0.5);

  const dataUrl = canvas.toDataURL();
  _badgeImageCache.set(key, dataUrl);
  return dataUrl;
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
  const result = await window.api.clearFeed();
  feedItems.splice(0, feedItems.length, ...result);
  newCount = 0;
  updateFeedBadge();
  renderFeed();
  showToast("Feed cleared", "info");
}

/**
 * Prepend only newly-arrived items to the feed grid, avoiding a full rebuild.
 * Falls back to a full renderFeed() when:
 *   - The grid was previously empty (first items ever).
 *   - A non-default sort order is active (items may not belong at the top).
 * When filters are active, only matching items are added to the DOM; all items
 * are still stored in `feedItems` so they appear when filters are cleared.
 */
function prependFeedItems(newItems) {
  if (!newItems.length) return;

  // Non-default sort or price sort: new items may not belong at the top — rebuild.
  if (feedSortOrder !== "newest") {
    renderFeed();
    return;
  }

  // Feed was empty before these items arrived — full render to unhide the grid.
  if (feedItems.length === newItems.length) {
    renderFeed();
    return;
  }

  // Check if the new items are actually newer (by listing time) than the
  // existing top item. If not, a full re-render is needed to maintain order.
  const grid = document.getElementById("feed-grid");
  if (grid && grid.firstElementChild) {
    const oldestNewTime = Math.min(...newItems.map(itemListingTime));
    const topExistingId = grid.firstElementChild.dataset.itemId;
    const topExisting = feedItems.find((i) => i.id === topExistingId);
    if (topExisting && oldestNewTime < itemListingTime(topExisting)) {
      renderFeed();
      return;
    }
  }

  // Filter the incoming items — only render those matching active filters.
  // Items that don't match are already stored in feedItems and will appear when filters clear.
  const visibleNewItems = applyFeedFilters(newItems);

  // Update the count display incrementally — avoids re-filtering all feedItems
  _filteredCount += visibleNewItems.length;
  updateFeedSubtitle(_filteredCount, feedItems.length);

  if (visibleNewItems.length === 0) return; // All new items filtered out — no DOM changes needed

  const empty = document.getElementById("feed-empty");
  empty.classList.add("hidden");
  grid.classList.remove("hidden");
  const zoom = ZOOM_CONFIG[feedZoom] || ZOOM_CONFIG.medium;
  grid.style.gridTemplateColumns = `repeat(auto-fill, minmax(${zoom.minCol}, 1fr))`;

  // Sort the new items by listing time (descending) before DOM insertion
  const sortedNew = [...visibleNewItems].sort((a, b) => itemListingTime(b) - itemListingTime(a));

  _refreshFavouriteIdSet();
  const fragment = document.createDocumentFragment();
  for (const item of sortedNew) {
    const wrapper = document.createElement("div");
    wrapper.innerHTML = renderFeedCard(item, zoom).trim();
    if (wrapper.firstElementChild) fragment.appendChild(wrapper.firstElementChild);
  }
  grid.prepend(fragment);

  // Trim excess DOM nodes to stay within FEED_MAX_SIZE
  while (grid.children.length > FEED_MAX_SIZE) {
    grid.removeChild(grid.lastChild);
  }
}

function setFeedZoom(zoom) {
  feedZoom = zoom;
  renderFeed();
  // Re-render header actions to update active button state
  if (currentPage === "feed") {
    document.getElementById("header-actions").innerHTML = PAGE_META.feed.actions();
  }
  // Auto-save preference
  window.api.saveSettings({ ...settings, feedZoom: zoom }).then((s) => {
    settings = s;
  });
}

function openListing(url) {
  window.api.openExternal(url);
}

// ─── Lightbox ─────────────────────────────────────────────────────────────────
let _lightboxImages = [];
let _lightboxIndex = 0;

async function openImagePopup(itemId) {
  const item = feedItems.find((i) => i.id === itemId) || favourites.find((f) => f.id === itemId);
  if (!item || !item.image) return;

  // Show the thumbnail immediately so the lightbox opens without delay
  _lightboxImages = [ebayImageUrl(item.image)];
  _lightboxIndex = 0;
  _lightboxSetImage();

  const lightbox = document.getElementById("image-lightbox");
  lightbox.classList.remove("hidden");
  lightbox.classList.add("flex");

  // Async-fetch all listing images for eBay items
  if (item.source === "ebay" && item.itemId && window.api.getEbayItemImages) {
    try {
      const result = await window.api.getEbayItemImages(item.itemId, item.site);
      // Only update if the lightbox is still showing the same item
      if (result.ok && result.images.length > 1 && !lightbox.classList.contains("hidden")) {
        _lightboxImages = result.images;
        _lightboxSetImage();
      }
    } catch (e) {
      console.warn("[feed] Failed to fetch eBay item images:", e.message);
    }
  } else if (item.source === "vinted" && Array.isArray(item.images) && item.images.length > 1) {
    // Photos are already available from the search result — no extra API call needed
    if (!lightbox.classList.contains("hidden")) {
      _lightboxImages = item.images;
      _lightboxIndex = 0;
      _lightboxSetImage();
    }
  }
}

function _lightboxSetImage() {
  const img = document.getElementById("image-lightbox-img");
  const counter = document.getElementById("lightbox-counter");
  const prevBtn = document.getElementById("lightbox-prev");
  const nextBtn = document.getElementById("lightbox-next");

  const url = _lightboxImages[_lightboxIndex];
  img.src = url;
  img.onerror = () => {
    img.src = ebayImageUrl(url, 640);
  };

  const total = _lightboxImages.length;
  if (total > 1) {
    counter.textContent = `${_lightboxIndex + 1} / ${total}`;
    counter.classList.remove("hidden");
    prevBtn.classList.remove("hidden");
    nextBtn.classList.remove("hidden");
    prevBtn.style.opacity = _lightboxIndex === 0 ? "0.35" : "1";
    nextBtn.style.opacity = _lightboxIndex === total - 1 ? "0.35" : "1";
  } else {
    counter.classList.add("hidden");
    prevBtn.classList.add("hidden");
    nextBtn.classList.add("hidden");
  }
}

function lightboxNav(dir) {
  const total = _lightboxImages.length;
  if (total < 2) return;
  _lightboxIndex = (_lightboxIndex + dir + total) % total;
  _lightboxSetImage();
}

function closeImagePopup() {
  const lightbox = document.getElementById("image-lightbox");
  lightbox.classList.add("hidden");
  lightbox.classList.remove("flex");
  document.getElementById("image-lightbox-img").src = "";
  _lightboxImages = [];
  _lightboxIndex = 0;
}
