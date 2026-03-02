// ─── Searches ─────────────────────────────────────────────────────────────────
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
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((search) => {
      const hasError = !!search.error;
      const lastFetched = search.lastFetched ? timeAgo(search.lastFetched) : "Never";
      const sym = SITE_CURRENCY_SYMBOL[search.site] || "$";
      const priceRange =
        search.minPrice || search.maxPrice ? ` · ${sym}${search.minPrice || "0"} – ${search.maxPrice ? sym + search.maxPrice : "∞"}` : "";
      const notifyOn = search.notify !== false;
      const isVintedSearch = search.source === "vinted";
      const searchCardColorStyle = search.cardColor
        ? `border-color: ${hexToRgba(search.cardColor, 0.75)}; background-image: linear-gradient(135deg, ${hexToRgba(search.cardColor, 0.22)} 0%, ${hexToRgba(search.cardColor, 0.06)} 40%, transparent 65%);`
        : "";

      return `
      <div class="card p-4 flex items-center gap-4 cursor-pointer" style="${searchCardColorStyle}" onclick="openSearchModal('${escapeAttr(search.id)}')">
        <!-- Status dot -->
        <div class="flex-shrink-0">
          <div class="w-2.5 h-2.5 rounded-full ${search.enabled ? (hasError ? "bg-danger-500" : "bg-success-500") : "bg-neutral-600"}"></div>
        </div>

        <!-- Info -->
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-2">
            <p class="text-sm font-medium text-secondary truncate">${escapeHtml(search.name)}</p>
            ${getSiteBadge(search)}
            ${!search.enabled ? '<span class="badge bg-neutral-700 text-neutral-500 text-xs">Paused</span>' : ""}
          </div>
          <p class="text-xs text-neutral-400 mt-0.5 truncate">
            ${search.keywords ? escapeHtml(search.keywords) : '<span class="italic">No keywords</span>'}
            ${priceRange}
            ${search.format && search.format !== "all" ? ` · ${formatLabel(search.format)}` : ""}
          </p>
          <p class="text-xs mt-0.5 ${hasError ? "text-danger-500" : "text-neutral-400"}">
            ${hasError ? `Error: ${escapeHtml(search.error)}` : `Last checked: <span class="search-last-checked" data-date="${escapeAttr(search.lastFetched || "")}">${lastFetched}</span>`}
          </p>
        </div>

        <!-- Actions -->
        <div class="flex items-center gap-3 flex-shrink-0" onclick="event.stopPropagation()">
          <!-- Notify toggle -->
          <div class="flex flex-col items-center gap-1">
            <span class="text-xs text-neutral-400">Notify</span>
            <button
              onclick="toggleSearchNotify('${escapeAttr(search.id)}', ${!notifyOn})"
              title="${notifyOn ? "Disable notifications" : "Enable notifications"}"
              class="relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${notifyOn ? "bg-accent-500" : "bg-neutral-700"}"
            >
              <span class="inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${notifyOn ? "translate-x-4" : "translate-x-1"}"></span>
            </button>
          </div>

          <!-- Active toggle -->
          <div class="flex flex-col items-center gap-1">
            <span class="text-xs text-neutral-400">Active</span>
            <button
              onclick="toggleSearch('${escapeAttr(search.id)}', ${!search.enabled})"
              title="${search.enabled ? "Pause search" : "Resume search"}"
              class="relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${search.enabled ? "bg-accent-500" : "bg-neutral-700"}"
            >
              <span class="inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${search.enabled ? "translate-x-4" : "translate-x-1"}"></span>
            </button>
          </div>

          <!-- Delete -->
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

async function toggleSearchNotify(id, notify) {
  searches = await window.api.toggleNotify(id, notify);
  renderSearches();
  showToast(`Notifications ${notify ? "enabled" : "disabled"} for search`, "info");
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
