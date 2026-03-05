// ─── Navigation ───────────────────────────────────────────────────────────────
const PAGE_META = {
  feed: {
    title: "Feed",
    subtitle: "New listings from all active searches",
    actions: () => `
      <div class="flex items-center gap-0.5 p-0.5 bg-neutral-800 rounded-md border border-neutral-700">
        ${["small", "medium", "large"].map((z) => `<button onclick="setFeedZoom('${z}')" title="${z.charAt(0).toUpperCase() + z.slice(1)} cards" class="px-2.5 py-1 rounded text-xs transition-colors ${feedZoom === z ? "bg-neutral-700 text-secondary" : "text-neutral-500 hover:text-secondary"}">${z === "small" ? "S" : z === "medium" ? "M" : "L"}</button>`).join("")}
      </div>
      <button onclick="clearFeed()" class="btn-ghost text-xs">Clear Feed</button>
      <button onclick="openSearchModal(null)" class="btn-ghost text-xs flex items-center gap-1.5">
        <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
          <path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15"/>
        </svg>
        Add Search
      </button>
    `,
  },
  searches: {
    title: "Searches",
    subtitle: "Configure your searches to monitor",
    actions: () => `
      <button onclick="openSearchModal(null)" class="btn-ghost text-xs flex items-center gap-1.5">
        <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
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
  favourites: {
    title: "Favourites",
    subtitle: "Your saved listings",
    actions: () => `
      <span id="favourites-count" class="text-xs text-neutral-500">${favourites.length ? plural(favourites.length, "listing") : ""}</span>
      <button onclick="clearFavourites()" class="btn-ghost text-xs">Clear All</button>
    `,
  },
};

function showPage(page) {
  currentPage = page;

  document.querySelectorAll(".page").forEach((el) => el.classList.add("hidden"));
  document.querySelectorAll(".nav-item").forEach((el) => {
    el.classList.remove("active");
    el.removeAttribute("aria-current");
  });

  document.getElementById(`page-${page}`).classList.remove("hidden");
  const activeNavEl = document.querySelector(`[data-page="${page}"]`);
  activeNavEl.classList.add("active");
  activeNavEl.setAttribute("aria-current", "page");

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

  if (page === "favourites") {
    renderFavourites();
  }

  if (page === "settings") {
    refreshApiUsage();
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

// ─── Interval timer (timestamps, badges, ended listings) ──────────────────────
setInterval(() => {
  document.querySelectorAll(".feed-age[data-date]").forEach((el) => {
    el.textContent = timeAgo(el.dataset.date);
  });
  document.querySelectorAll(".feed-new-badge[data-found-at]").forEach((el) => {
    const age = Date.now() - new Date(el.dataset.foundAt).getTime();
    if (age >= NEW_ITEM_WINDOW_MS) el.classList.add("hidden");
  });
  document.querySelectorAll(".search-last-checked[data-date]").forEach((el) => {
    if (el.dataset.date) el.textContent = timeAgo(el.dataset.date);
  });
  document.querySelectorAll("[data-end-date]").forEach((el) => {
    const endDate = el.dataset.endDate;
    if (endDate && new Date(endDate).getTime() < Date.now()) {
      el.style.opacity = "0.5";
    }
  });
}, 5000);

// ─── Keyboard shortcuts ───────────────────────────────────────────────────────
// Single listener handles all keyboard shortcuts app-wide.
document.addEventListener("keydown", (e) => {
  const lightbox = document.getElementById("image-lightbox");
  const lightboxOpen = lightbox && !lightbox.classList.contains("hidden");

  // Ctrl+F focuses the feed text filter when on the feed page
  if (e.ctrlKey && e.key === "f" && !lightboxOpen) {
    const modal = document.getElementById("search-modal");
    const modalOpen = modal && !modal.classList.contains("hidden");
    if (!modalOpen && currentPage === "feed") {
      e.preventDefault();
      const filterInput = document.getElementById("filter-text");
      if (filterInput) {
        filterInput.focus();
        filterInput.select();
      }
    }
  } else if (e.key === "Escape") {
    if (lightboxOpen) {
      closeImagePopup();
    } else {
      const searchModal = document.getElementById("search-modal");
      if (searchModal && !searchModal.classList.contains("hidden")) {
        closeSearchModal();
      }
    }
  } else if (lightboxOpen) {
    if (e.key === "ArrowRight") lightboxNav(1);
    else if (e.key === "ArrowLeft") lightboxNav(-1);
  }
});

// ─── Offline Banner ──────────────────────────────────────────────────────────
function showOfflineBanner(visible) {
  let banner = document.getElementById("offline-banner");
  if (!banner && visible) {
    banner = document.createElement("div");
    banner.id = "offline-banner";
    banner.className = "w-full bg-red-600/20 border-b border-red-600/40 text-red-400 text-xs text-center py-1.5 px-3 flex-shrink-0";
    banner.textContent = "No internet connection — polling is paused until connectivity is restored.";
    const header = document.querySelector("header");
    header.insertAdjacentElement("afterend", banner);
  }
  if (banner) banner.classList.toggle("hidden", !visible);
}

// ─── Init ─────────────────────────────────────────────────────────────────────
(async () => {
  searches = await window.api.getSearches();
  feedItems = await window.api.getFeed();
  settings = await window.api.getSettings();
  favourites = await window.api.getFavourites();

  applySettings();
  initSettingsListeners();
  renderSearches();
  renderFeed();
  updateStatus();
  showPage("feed");

  // Listen for new listings pushed from main process
  window.api.onNewListings((items) => {
    feedItems.unshift(...items);
    newCount += items.length;
    prependFeedItems(items);
    updateFeedBadge();
    if (currentPage !== "feed") {
      showToast(`${plural(items.length, "new listing")} found`, "success");
    }
  });

  // Listen for search status updates
  window.api.onSearchStatus((status) => {
    const search = searches.find((x) => x.id === status.searchId);
    if (search) {
      Object.assign(search, status);
      updateSearchCard(search);
    }
    updateStatus();
  });

  // Scroll the feed to a specific listing when a notification is clicked.
  // Switches to the feed page and highlights the first matching card.
  window.api.onScrollToListing((itemIds) => {
    showPage("feed");
    if (!Array.isArray(itemIds) || itemIds.length === 0) return;

    // Find the first card that exists in the DOM
    for (const id of itemIds) {
      const card = document.querySelector(`[data-item-id="${CSS.escape(id)}"]`);
      if (card) {
        card.scrollIntoView({ behavior: "smooth", block: "center" });
        card.classList.add("ring-2", "ring-accent-500", "ring-offset-1", "ring-offset-neutral-800");
        setTimeout(() => {
          card.classList.remove("ring-2", "ring-accent-500", "ring-offset-1", "ring-offset-neutral-800");
        }, 2500);
        break;
      }
    }
  });
  window.api.onPlayNotificationSound(({ soundFile, volume }) => {
    try {
      const normalized = soundFile.startsWith("file://") ? soundFile : `file:///${soundFile.replace(/\\/g, "/")}`;
      const audio = new Audio(normalized);
      audio.volume = Math.max(0, Math.min(1, volume ?? 1.0));
      audio.play().catch((e) => console.warn("[sound] Playback failed:", e.message));
    } catch (e) {
      console.warn("[sound] Audio error:", e.message);
    }
  });

  // Connectivity detection
  window.addEventListener("offline", () => showOfflineBanner(true));
  window.addEventListener("online", () => showOfflineBanner(false));
  if (!navigator.onLine) showOfflineBanner(true);
})();
