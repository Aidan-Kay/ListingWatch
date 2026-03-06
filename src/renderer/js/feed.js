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
  small: { minCol: "300px", img: "w-24 h-24", title: "text-xs", price: "text-xs", meta: "text-xs" },
  medium: { minCol: "400px", img: "w-28 h-28", title: "text-sm", price: "text-sm", meta: "text-xs" },
  large: { minCol: "480px", img: "w-32 h-32", title: "text-base", price: "text-base", meta: "text-sm" },
};

function renderFeedCard(item, index, zoom) {
  const dateForAge = item.listingDate || item.foundAt;
  const isNew = Date.now() - new Date(item.foundAt).getTime() < NEW_ITEM_WINDOW_MS;
  const isEnded = item.listingEndDate && new Date(item.listingEndDate).getTime() < Date.now();
  const isSold = isEnded && item.bidCount > 0 && (item.buyingFormats || []).includes("Auction");
  const formats = item.buyingFormats || [];
  const formatBadges = formats
    .map((f) => {
      const clsMap = { Auction: "badge-auction", "Buy It Now": "badge-bin", "Best Offer": "badge-offer" };
      const cls = clsMap[f] || "badge-default";
      return `<span class="badge ${cls} ${zoom.meta}">${escapeHtml(FORMAT_BADGE_LABELS[f] || f)}</span>`;
    })
    .join("");

  const cardColorStyle = item.cardColor
    ? `border-color: ${hexToRgba(item.cardColor, 0.75)}; background-image: linear-gradient(135deg, ${hexToRgba(item.cardColor, 0.15)} 0%, ${hexToRgba(item.cardColor, 0.04)} 25%, transparent 40%);`
    : "";
  const endedStyle = isEnded ? "opacity: 0.5;" : "";
  const isFavourited = favourites.some((f) => f.id === item.id);

  return `
    <div
      class="card p-3 flex gap-3 cursor-pointer hover:bg-neutral-700/50 animate-fade-in relative"
      style="animation-delay: ${Math.min(index, 10) * 30}ms; ${cardColorStyle}${endedStyle}"
      data-item-id="${escapeAttr(item.id)}"
      data-end-date="${escapeAttr(item.listingEndDate || "")}"
      onclick="openListing('${escapeAttr(item.url)}')"
      title="${escapeAttr(item.title)}"
    >
      <!-- Thumbnail -->
      <div class="${zoom.img} flex-shrink-0 rounded-md overflow-hidden bg-neutral-700 relative group">
        ${
          item.image
            ? `<img src="${escapeAttr(item.image)}" alt="" loading="lazy" class="w-full h-full object-cover object-center" onerror="this.parentElement.innerHTML='<div class=\\'w-full h-full flex items-center justify-center\\'><svg class=\\'w-6 h-6 text-neutral-600\\' fill=\\'none\\' viewBox=\\'0 0 24 24\\' stroke=\\'currentColor\\'><path stroke-linecap=\\'round\\' stroke-linejoin=\\'round\\' stroke-width=\\'1.5\\' d=\\'M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3 3h18\\'/></svg></div>'" />
              <div class="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors flex items-center justify-center" onclick="event.stopPropagation(); openImagePopup('${escapeAttr(item.id)}')"
              ><svg class="w-5 h-5 text-white opacity-0 group-hover:opacity-100 transition-opacity drop-shadow" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-4.35-4.35M17 11A6 6 0 115 11a6 6 0 0112 0zm-3-1h-2V8m0 0V6m0 2H10"/></svg></div>
              ${item.imageCount > 1 ? `<span class="absolute bottom-1 right-1 text-xs text-white bg-black/70 px-1.5 py-0.5 rounded font-medium leading-tight pointer-events-none">${item.imageCount}</span>` : ""}`
            : `<div class="w-full h-full flex items-center justify-center">
              <svg class="w-6 h-6 text-neutral-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3 3h18"/>
              </svg>
            </div>`
        }
      </div>

      <div class="flex-1 min-w-0 flex flex-col">
        <div class="flex flex-col gap-0.5">
          <div class="flex items-start justify-between gap-2">
            <p class="${zoom.title} font-medium text-secondary leading-snug line-clamp-2 flex-1">${escapeHtml(item.title)}</p>
            <div class="flex items-center gap-0.5 flex-shrink-0">
              <span class="badge badge-accent feed-new-badge ${zoom.meta} ${isNew ? "" : "hidden"}" data-found-at="${escapeAttr(item.foundAt)}">NEW</span>
              ${isEnded ? `<span class="badge ${isSold ? "bg-green-600/20 text-green-400" : "bg-neutral-700 text-neutral-500"} ${zoom.meta}">${isSold ? "SOLD" : "ENDED"}</span>` : ""}
              <button
                class="fav-btn transition-colors z-10 p-1 rounded ${isFavourited ? "text-yellow-400" : "text-neutral-400 hover:bg-neutral-700"}"
                onclick="event.stopPropagation(); toggleFavourite('${escapeAttr(item.id)}')"
                title="${isFavourited ? "Remove from favourites" : "Add to favourites"}"
              >
                <svg class="w-5 h-5" fill="${isFavourited ? "currentColor" : "none"}" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M11.48 3.499a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.84.61l-4.725-2.885a.563.563 0 00-.586 0L6.982 20.54a.562.562 0 01-.84-.61l1.285-5.386a.562.562 0 00-.182-.557l-4.204-3.602a.562.562 0 01.321-.988l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z"/>
                </svg>
              </button>
            </div>
          </div>
          ${item.condition ? `<p class="${zoom.meta} text-neutral-400 truncate">${escapeHtml(item.condition)}</p>` : ""}
        </div>
        <div class="flex flex-col gap-0.5 mt-auto pt-1">
          <div class="flex items-center gap-2">
            ${
              item.price
                ? `<span class="${zoom.price} font-semibold text-white">${escapeHtml(item.price)}</span>`
                : `<span class="${zoom.meta} text-neutral-400">No price</span>`
            }
            ${item.shipping ? `<span class="${zoom.meta} text-neutral-400">${escapeHtml(item.shipping)}</span>` : ""}
            ${item.bidCount > 0 ? `<span class="${zoom.meta} text-neutral-400">${plural(item.bidCount, "bid")}</span>` : ""}
          </div>
          <span class="${zoom.meta} text-neutral-400 feed-age" data-date="${escapeAttr(dateForAge)}">Listed ${timeAgo(dateForAge)}</span>
          <div class="flex items-center justify-between gap-2">
            <span class="truncate ${zoom.meta} text-neutral-400">${
              Array.isArray(item.searchIds) && item.searchIds.length > 1
                ? `<span class="badge bg-neutral-700 text-neutral-400 ${zoom.meta}" title="${escapeAttr(item.searchIds.join(", "))}">${item.searchIds.length} searches</span>`
                : escapeHtml(item.searchName)
            }</span>
            <div class="flex items-center gap-1 flex-shrink-0">
              ${formatBadges}
              ${getSiteBadge(item, zoom.meta)}
            </div>
          </div>
        </div>
      </div>
    </div>
  `;
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
 * Returns a filtered copy of `items` based on the current `feedFilters` state.
 * The backing `feedItems` array is never modified — filters are display-only.
 */
function applyFeedFilters(items) {
  const { text, platform, searchId, buyingFormat } = feedFilters;
  const hasActiveFilter = text || platform !== "all" || searchId !== "all" || buyingFormat !== "all";

  const clearBtn = document.getElementById("filter-active-badge");
  if (clearBtn) clearBtn.classList.toggle("hidden", !hasActiveFilter);

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
 * Returns a sorted copy of `items` based on the given sort order.
 * Does not modify the source array. Price sorting uses raw numeric values;
 * items with no parseable price sort to the end.
 */
function sortFeedItems(items, order) {
  if (order === "newest") return items; // feedItems is already newest-first
  const copy = [...items];
  if (order === "oldest") return copy.reverse();
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
 * Repopulate the saved-search dropdown in the filter bar with the current
 * list of searches. Call after searches are loaded or mutated.
 */
function updateFeedFilterSearchOptions() {
  const select = document.getElementById("filter-search");
  if (!select) return;
  const currentVal = feedFilters.searchId;

  select.innerHTML = '<option value="all">All Searches</option>';

  const GROUPS = [
    { source: "ebay",   label: "eBay" },
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

  // If the previously selected search no longer exists, reset to "all"
  if (feedFilters.searchId !== "all" && !searches.find((s) => s.id === feedFilters.searchId)) {
    feedFilters.searchId = "all";
    const filterSearchEl = document.getElementById("filter-search");
    if (filterSearchEl) filterSearchEl.value = "all";
    renderFeed();
  }
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
      if (!hasSearches) {
        cta.innerHTML = `<button onclick="openSearchModal(null)" class="btn-primary text-sm mt-1">Add Your First Search</button>`;
        cta.classList.remove("hidden");
      } else if (!hasActive) {
        cta.innerHTML = `<button onclick="showPage('searches')" class="btn-secondary text-sm mt-1">Go to Searches</button>`;
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

  grid.innerHTML = sorted.map((item, index) => renderFeedCard(item, index, zoom)).join("");
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

function drawBadgeImage(count) {
  const size = 16;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = "#ef4444";
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
  ctx.fill();

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

  // Non-default sort: new items may not belong at the top — rebuild the whole feed.
  if (feedSortOrder !== "newest") {
    renderFeed();
    return;
  }

  // Feed was empty before these items arrived — full render to unhide the grid.
  if (feedItems.length === newItems.length) {
    renderFeed();
    return;
  }

  // Filter the incoming items — only render those matching active filters.
  // Items that don't match are already stored in feedItems and will appear when filters clear.
  const visibleNewItems = applyFeedFilters(newItems);

  // Update the count display incrementally — avoids re-filtering all feedItems
  _filteredCount += visibleNewItems.length;
  updateFeedSubtitle(_filteredCount, feedItems.length);

  if (visibleNewItems.length === 0) return; // All new items filtered out — no DOM changes needed

  const empty = document.getElementById("feed-empty");
  const grid = document.getElementById("feed-grid");
  empty.classList.add("hidden");
  grid.classList.remove("hidden");
  const zoom = ZOOM_CONFIG[feedZoom] || ZOOM_CONFIG.medium;
  grid.style.gridTemplateColumns = `repeat(auto-fill, minmax(${zoom.minCol}, 1fr))`;

  const fragment = document.createDocumentFragment();
  visibleNewItems.forEach((item, i) => {
    const wrapper = document.createElement("div");
    wrapper.innerHTML = renderFeedCard(item, i, zoom).trim();
    if (wrapper.firstElementChild) fragment.appendChild(wrapper.firstElementChild);
  });
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
