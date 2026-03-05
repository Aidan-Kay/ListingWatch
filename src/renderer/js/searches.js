// ─── Searches ─────────────────────────────────────────────────────────────────
function renderSearchCard(search) {
  const hasError = !!search.error;
  const lastFetched = search.lastFetched ? timeAgo(search.lastFetched) : "Never";
  const sym = SITE_CURRENCY_SYMBOL[search.site] || "$";
  const priceRange =
    search.minPrice || search.maxPrice ? ` · ${sym}${search.minPrice || "0"} – ${search.maxPrice ? sym + search.maxPrice : "∞"}` : "";
  const notifyOn = search.notify !== false;
  const isVintedSearch = search.source === "vinted";
  const searchCardColorStyle = search.cardColor
    ? `border-color: ${hexToRgba(search.cardColor, 0.75)}; background-image: linear-gradient(135deg, ${hexToRgba(search.cardColor, 0.15)} 0%, ${hexToRgba(search.cardColor, 0.04)} 25%, transparent 40%);`
    : "";

  return `
    <div
      data-search-id="${escapeAttr(search.id)}"
      class="card p-4 flex items-center gap-4 cursor-pointer group hover:bg-neutral-700/30" style="${searchCardColorStyle}" onclick="openSearchModal('${escapeAttr(search.id)}')">
      <!-- Status dot -->
      <div class="flex-shrink-0">
        <div class="w-2.5 h-2.5 rounded-full ${search.enabled ? (hasError ? "bg-danger-500" : "bg-success-500") : "bg-neutral-600"}"></div>
      </div>

      <!-- Info -->
      <div class="flex-1 min-w-0">
        <div class="flex items-center gap-2">
          <p class="text-sm font-medium text-secondary truncate">${escapeHtml(search.name)}</p>
          <svg class="w-3 h-3 text-neutral-500 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125"/>
          </svg>
          ${getSiteBadge(search)}
          ${!search.enabled ? '<span class="badge bg-neutral-700 text-neutral-500 text-xs">Paused</span>' : ""}
        </div>
        <p class="text-xs text-neutral-400 mt-0.5 truncate">
          ${search.keywords ? escapeHtml(search.keywords) : '<span class="italic">No keywords</span>'}
          ${priceRange}
          ${search.format && search.format !== "all" ? ` · ${buyingFormatLabel(search.format)}` : ""}
        </p>
        <p class="text-xs mt-0.5 ${hasError ? "text-danger-500" : search.lastFetched ? "text-neutral-400" : "text-neutral-600"}" ${hasError ? `title="${escapeAttr(search.error)}"` : ""}>
          ${hasError ? `Error: ${escapeHtml(search.error.length > 80 ? search.error.slice(0, 80) + "\u2026" : search.error)}` : `Last checked: <span class="search-last-checked" data-date="${escapeAttr(search.lastFetched || "")}">${lastFetched}</span>`}
        </p>
      </div>

      <!-- Actions -->
      <div class="flex items-center gap-1 flex-shrink-0" onclick="event.stopPropagation()">
        <!-- Notify toggle (bell icon) -->
        <button
          onclick="toggleSearchNotify('${escapeAttr(search.id)}', ${!notifyOn})"
          data-tooltip="${notifyOn ? "Disable notifications" : "Enable notifications"}"
          role="switch"
          aria-checked="${notifyOn}"
          aria-label="Notifications"
          class="btn-icon p-2.5 ${notifyOn ? "text-accent-500 hover:text-accent-400" : ""}"
        >
          <svg class="w-5 h-5" fill="${notifyOn ? "currentColor" : "none"}" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
            <path stroke-linecap="round" stroke-linejoin="round" d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0"/>
          </svg>
        </button>

        <!-- Active/pause toggle (play or pause icon) -->
        <button
          onclick="toggleSearch('${escapeAttr(search.id)}', ${!search.enabled})"
          data-tooltip="${search.enabled ? "Pause search" : "Resume search"}"
          role="switch"
          aria-checked="${search.enabled}"
          aria-label="Enable search"
          class="btn-icon p-2.5 ${search.enabled ? "text-accent-500 hover:text-accent-400" : ""}"
        >
          <svg class="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
            ${
              search.enabled
                ? `<path d="M6.75 5.25a.75.75 0 01.75-.75H9a.75.75 0 01.75.75v13.5a.75.75 0 01-.75.75H7.5a.75.75 0 01-.75-.75V5.25zm7.5 0A.75.75 0 0115 4.5h1.5a.75.75 0 01.75.75v13.5a.75.75 0 01-.75.75H15a.75.75 0 01-.75-.75V5.25z"/>`
                : `<path d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.347a1.125 1.125 0 010 1.972l-11.54 6.347a1.125 1.125 0 01-1.667-.986V5.653z"/>`
            }
          </svg>
        </button>

        <!-- Duplicate -->
        <button
          onclick="duplicateSearch('${escapeAttr(search.id)}')"
          data-tooltip="Duplicate search"
          class="btn-icon p-2.5"
        >
          <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M15.75 17.25v3.375c0 .621-.504 1.125-1.125 1.125h-9.75a1.125 1.125 0 01-1.125-1.125V7.875c0-.621.504-1.125 1.125-1.125H6.75a9.06 9.06 0 011.5.124m7.5 10.376h3.375c.621 0 1.125-.504 1.125-1.125V11.25c0-4.46-3.243-8.161-7.5-8.876a9.06 9.06 0 00-1.5-.124H9.375c-.621 0-1.125.504-1.125 1.125v3.5m7.5 10.375H9.375a1.125 1.125 0 01-1.125-1.125v-9.25m12 6.625v-1.875a3.375 3.375 0 00-3.375-3.375h-1.5a1.125 1.125 0 01-1.125-1.125v-1.5a3.375 3.375 0 00-3.375-3.375H9.75"/>
          </svg>
        </button>

        <!-- Delete -->
        <button
          onclick="deleteSearch('${escapeAttr(search.id)}')"
          data-tooltip="Delete search"
          class="btn-icon p-2.5 hover:text-danger-500 hover:bg-danger-500/10 hover:border-danger-500/20"
        >
          <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0"/>
          </svg>
        </button>
      </div>
    </div>
  `;
}

function renderSearches() {
  const empty = document.getElementById("searches-empty");
  const list = document.getElementById("searches-list");
  const countBadge = document.getElementById("searches-count");

  countBadge.textContent = searches.length;

  if (searches.length === 0) {
    empty.classList.remove("hidden");
    list.classList.add("hidden");
    updateFeedFilterSearchOptions();
    return;
  }

  empty.classList.add("hidden");
  list.classList.remove("hidden");

  list.innerHTML = searches
    .slice()
    .sort((a, b) => {
      if (a.error && !b.error) return -1;
      if (!a.error && b.error) return 1;
      return a.name.localeCompare(b.name);
    })
    .map(renderSearchCard)
    .join("");

  // Keep the feed filter's saved-search dropdown in sync with the current search list
  updateFeedFilterSearchOptions();
}

async function toggleSearch(id, enabled) {
  searches = await window.api.toggleSearch(id, enabled);
  renderSearches();
  showToast(`Search ${enabled ? "resumed" : "paused"}`, "info");
}

async function toggleSearchNotify(id, notify) {
  searches = await window.api.toggleNotify(id, notify);
  renderSearches();
  showToast(`Notifications ${notify ? "enabled" : "disabled"} for search`, "info");
}

/**
 * Re-render a single search card in-place rather than rebuilding the full list.
 * Falls back to a full renderSearches() if the card element isn’t found in the DOM.
 */
function updateSearchCard(search) {
  const el = document.querySelector(`[data-search-id="${CSS.escape(search.id)}"]`);
  if (!el) {
    renderSearches();
    return;
  }
  el.outerHTML = renderSearchCard(search);
}

/**
 * Clone a search with a new ID and " (copy)" suffix. The duplicate starts paused
 * so it does not immediately begin polling alongside its source.
 */
async function duplicateSearch(id) {
  const original = searches.find((s) => s.id === id);
  if (!original) return;

  // Deep-clone via JSON round-trip, then strip runtime-only fields.
  const clone = JSON.parse(JSON.stringify(original));
  delete clone.id; // main process will generate a new ID
  delete clone.lastFetched;
  delete clone.error;
  clone.name = `${clone.name} (copy)`;
  clone.enabled = false; // Start paused to avoid duplicate polling noise

  searches = await window.api.saveSearch(clone);
  renderSearches();
  showToast(`Duplicated "${original.name}"`, "success");
}

async function deleteSearch(id) {
  const search = searches.find((s) => s.id === id);
  if (!search) return;
  if (!(await appConfirm(`Delete the search "${search.name}"? This cannot be undone.`, "Delete", true))) return;

  searches = await window.api.deleteSearch(id);
  feedItems = feedItems.filter((item) => item.searchId !== id);
  renderSearches();
  renderFeed();
  showToast("Search deleted", "info");
}
