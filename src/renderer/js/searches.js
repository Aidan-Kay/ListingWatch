// ─── Searches ─────────────────────────────────────────────────────────────────

/**
 * " · Matches: PS2 Games" for searches with keyword lists attached. Ids with no
 * surviving list are skipped, mirroring how polling treats a dangling reference.
 */
function attachedListLabel(search) {
  if (!Array.isArray(search.includeLists) || search.includeLists.length === 0) return "";
  const names = search.includeLists.map((id) => keywordLists.find((l) => l.id === id)).filter(Boolean).map((l) => l.name);
  return names.length > 0 ? ` · <span class="text-accent-500">Matches: ${escapeHtml(names.join(", "))}</span>` : "";
}

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
      class="card search-card p-4 flex items-center gap-4 cursor-pointer group hover:bg-neutral-700/30" style="${searchCardColorStyle}">
      <!-- Enable toggle -->
      <button
        data-action="toggle-enabled"
        data-enable="${!search.enabled}"
        data-tooltip="${search.enabled ? "Pause search" : "Resume search"}"
        role="switch"
        aria-checked="${search.enabled}"
        aria-label="Enable search"
        class="search-toggle flex-shrink-0 ${search.enabled ? (hasError ? "bg-danger-500" : "bg-success-500") : "bg-neutral-600"}"
      >
        <span class="search-toggle-knob ${search.enabled ? "translate-x-4" : "translate-x-0.5"}"></span>
      </button>

      <!-- Info -->
      <div class="flex-1 min-w-0">
        <div class="flex items-center gap-2">
          <p class="text-sm font-medium text-secondary truncate">${escapeHtml(search.name)}</p>
          ${getSiteBadge(search)}
        </div>
        <p class="text-xs text-neutral-400 mt-0.5 truncate">
          ${search.keywords ? escapeHtml(search.keywords) : '<span class="italic">No keywords</span>'}
          ${priceRange}
          ${search.format && search.format !== "all" ? ` · ${buyingFormatLabel(search.format)}` : ""}
          ${attachedListLabel(search)}
        </p>
        <p class="text-xs mt-0.5 ${hasError ? "text-danger-500" : search.lastFetched ? "text-neutral-400" : "text-neutral-600"}" ${hasError ? `title="${escapeAttr(search.error)}"` : ""}>
          ${hasError ? `Error: ${escapeHtml(search.error.length > 80 ? search.error.slice(0, 80) + "\u2026" : search.error)}` : `Last checked: <span class="search-last-checked" data-date="${escapeAttr(search.lastFetched || "")}">${lastFetched}</span>`}
        </p>
      </div>

      <!-- Actions -->
      <div class="flex items-center gap-2 flex-shrink-0">
        <!-- Notify toggle (bell icon) -->
        <button
          data-action="toggle-notify"
          data-notify="${!notifyOn}"
          data-tooltip="${notifyOn ? "Disable notifications" : "Enable notifications"}"
          role="switch"
          aria-checked="${notifyOn}"
          aria-label="Notifications"
          class="btn-icon ${!notifyOn ? "btn-icon-off" : ""}"
        >
          <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
            <path stroke-linecap="round" stroke-linejoin="round" d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0"/>
          </svg>
          ${!notifyOn ? `<svg class="absolute inset-0 m-auto w-5 h-5 pointer-events-none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><line x1="2" y1="22" x2="22" y2="2"/></svg>` : ""}
        </button>

        <!-- Duplicate -->
        <button
          data-action="duplicate"
          data-tooltip="Duplicate search"
          class="btn-icon"
        >
          <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M15.75 17.25v3.375c0 .621-.504 1.125-1.125 1.125h-9.75a1.125 1.125 0 01-1.125-1.125V7.875c0-.621.504-1.125 1.125-1.125H6.75a9.06 9.06 0 011.5.124m7.5 10.376h3.375c.621 0 1.125-.504 1.125-1.125V11.25c0-4.46-3.243-8.161-7.5-8.876a9.06 9.06 0 00-1.5-.124H9.375c-.621 0-1.125.504-1.125 1.125v3.5m7.5 10.375H9.375a1.125 1.125 0 01-1.125-1.125v-9.25m12 6.625v-1.875a3.375 3.375 0 00-3.375-3.375h-1.5a1.125 1.125 0 01-1.125-1.125v-1.5a3.375 3.375 0 00-3.375-3.375H9.75"/>
          </svg>
        </button>

        <!-- Delete -->
        <button
          data-action="delete"
          data-tooltip="Delete search"
          class="btn-icon hover:text-danger-500 hover:bg-danger-500/10 hover:border-danger-500/20"
        >
          <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0"/>
          </svg>
        </button>
      </div>
    </div>
  `;
}

/**
 * One delegated listener for the whole list. The buttons carry their intent in
 * data-action rather than an inline onclick, for the reason spelled out on
 * renderFeedCard: escapeAttr does not survive being re-parsed as JavaScript.
 */
function initSearchListInteractions() {
  const list = document.getElementById("searches-list");
  if (!list) return;

  list.addEventListener("click", (e) => {
    const card = e.target.closest(".search-card");
    if (!card) return;
    const id = card.dataset.searchId;
    const button = e.target.closest("[data-action]");

    if (!button) {
      openSearchModal(id);
      return;
    }
    // Every action button sits on the card, which would otherwise open the editor.
    e.stopPropagation();
    switch (button.dataset.action) {
      case "toggle-enabled":
        toggleSearch(id, button.dataset.enable === "true");
        break;
      case "toggle-notify":
        toggleSearchNotify(id, button.dataset.notify === "true");
        break;
      case "duplicate":
        duplicateSearch(id);
        break;
      case "delete":
        deleteSearch(id);
        break;
    }
  });
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

  // Group searches by marketplace source, sorted by name within each group
  const sorted = searches.slice().sort((a, b) => {
    if (a.error && !b.error) return -1;
    if (!a.error && b.error) return 1;
    return a.name.localeCompare(b.name);
  });

  const groups = {};
  for (const search of sorted) {
    const source = search.source || "ebay";
    (groups[source] ??= []).push(search);
  }

  // Render each group with a heading — order: eBay first, then Vinted, then any others
  const sourceOrder = ["ebay", "vinted"];
  const allSources = [...new Set([...sourceOrder, ...Object.keys(groups)])];
  const sourceLabels = { ebay: "eBay", vinted: "Vinted" };

  list.innerHTML = allSources
    .filter((source) => groups[source]?.length > 0)
    .map((source) => {
      const label = sourceLabels[source] || source;
      const count = groups[source].length;
      return `
        <div class="mb-4">
          <div class="flex items-center gap-2 mb-2 px-1">
            <h3 class="text-xs font-semibold text-neutral-500 uppercase tracking-wide">${escapeHtml(label)}</h3>
            <span class="text-xs text-neutral-600">${count}</span>
          </div>
          <div class="space-y-2">
            ${groups[source].map(renderSearchCard).join("")}
          </div>
        </div>
      `;
    })
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
  // Re-fetch the authoritative feed from the main process rather than applying
  // our own filter. The main process correctly handles multi-search items
  // (trimming the deleted search ID instead of removing them outright), and
  // duplicating that logic in the renderer would create a divergence risk.
  const updatedFeed = await window.api.getFeed();
  feedItems.splice(0, feedItems.length, ...updatedFeed);
  renderSearches();
  renderFeed();
  showToast("Search deleted", "info");
}
