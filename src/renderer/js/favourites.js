// ─── Favourites ───────────────────────────────────────────────────────────────

/**
 * Patch the favourite star button(s) for a given item ID in the DOM without
 * re-rendering the whole feed. Targets every card with a matching
 * `data-item-id` attribute (handles deduped multi-search cards too).
 */
function updateFavStars(itemId, isFavourited) {
  document.querySelectorAll(`[data-item-id="${CSS.escape(itemId)}"] .fav-btn`).forEach((btn) => {
    btn.classList.toggle("text-yellow-400", isFavourited);
    btn.classList.toggle("text-neutral-400", !isFavourited);
    btn.classList.toggle("hover:bg-neutral-700", !isFavourited);
    btn.dataset.tooltip = isFavourited ? "Remove from favourites" : "Add to favourites";
    const svg = btn.querySelector("svg");
    if (svg) svg.setAttribute("fill", isFavourited ? "currentColor" : "none");
  });
}

/**
 * Toggle an item's favourite status. Adds to favourites if not present,
 * removes if already saved. Persists via IPC and re-renders affected UI.
 */
async function toggleFavourite(itemId) {
  const existingIndex = favourites.findIndex((f) => f.id === itemId);
  const nowFavourited = existingIndex < 0;

  if (existingIndex >= 0) {
    // Remove from favourites
    favourites.splice(existingIndex, 1);
    await window.api.removeFavourite(itemId);
  } else {
    // Add to favourites — source item from the feed or, if evicted, from favourites
    const item = feedItems.find((f) => f.id === itemId) || favourites.find((f) => f.id === itemId);
    if (!item) return;
    favourites.unshift(item);
    await window.api.saveFavourite(item);
  }

  // Patch only the affected star(s) — no full feed re-render needed
  updateFavStars(itemId, nowFavourited);

  // If currently viewing the favourites page, refresh it too
  if (currentPage === "favourites") {
    renderFavourites();
    updateFavouritesHeader();
  }
}

/**
 * Render the favourites grid with the current `favourites` array.
 * Uses the same card renderer as the main feed.
 */
function renderFavourites() {
  const grid = document.getElementById("favourites-grid");
  const empty = document.getElementById("favourites-empty");
  if (!grid || !empty) return;

  if (favourites.length === 0) {
    grid.innerHTML = "";
    empty.classList.remove("hidden");
    return;
  }

  empty.classList.add("hidden");
  const zoom = ZOOM_CONFIG[feedZoom] || ZOOM_CONFIG.medium;
  grid.style.gridTemplateColumns = `repeat(auto-fill, minmax(${zoom.minCol}, 1fr))`;
  grid.innerHTML = favourites.map((item, i) => renderFeedCard(item, i, zoom)).join("");
}

/**
 * Update the favourites count label in the page header.
 * Called whenever the favourites array changes while on the favourites page.
 */
function updateFavouritesHeader() {
  const countEl = document.getElementById("favourites-count");
  if (countEl) {
    countEl.textContent = favourites.length ? plural(favourites.length, "listing") : "";
  }
}

/**
 * Clear all saved favourites after user confirmation.
 */
async function clearFavourites() {
  if (favourites.length === 0) return;
  if (!(await appConfirm(`Remove all ${favourites.length} saved favourite${favourites.length !== 1 ? "s" : ""}?`, "Clear All", true)))
    return;

  const formerIds = favourites.map((f) => f.id);
  await window.api.clearFavourites();
  favourites.length = 0;

  // Patch each affected star without re-rendering the whole feed
  formerIds.forEach((id) => updateFavStars(id, false));
  renderFavourites();
  updateFavouritesHeader();
}
