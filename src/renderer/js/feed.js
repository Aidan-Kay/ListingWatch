// ─── Feed ─────────────────────────────────────────────────────────────────────
const FORMAT_BADGE_LABELS = { "Buy It Now": "BIN", "Best Offer": "Offer" };
const ZOOM_CONFIG = {
  small: { minCol: "300px", img: "w-24 h-24", title: "text-xs", price: "text-xs", meta: "text-xs" },
  medium: { minCol: "380px", img: "w-28 h-28", title: "text-sm", price: "text-sm", meta: "text-xs" },
  large: { minCol: "480px", img: "w-32 h-32", title: "text-base", price: "text-base", meta: "text-sm" },
};

function renderFeed() {
  const empty = document.getElementById("feed-empty");
  const grid = document.getElementById("feed-grid");
  const countEl = document.getElementById("feed-count");

  if (countEl) countEl.textContent = feedItems.length ? `${feedItems.length} listing${feedItems.length !== 1 ? "s" : ""}` : "";

  if (feedItems.length === 0) {
    empty.classList.remove("hidden");
    grid.classList.add("hidden");
    const subtitle = document.getElementById("feed-empty-subtitle");
    if (subtitle) {
      const hasActive = searches.some((s) => s.enabled);
      subtitle.textContent = hasActive ? "Monitoring for new listings..." : "Add searches to start monitoring listings";
    }
    return;
  }

  empty.classList.add("hidden");
  grid.classList.remove("hidden");
  const zc = ZOOM_CONFIG[feedZoom] || ZOOM_CONFIG.medium;
  grid.style.gridTemplateColumns = `repeat(auto-fill, minmax(${zc.minCol}, 1fr))`;

  grid.innerHTML = feedItems
    .map((item, index) => {
      const zc = ZOOM_CONFIG[feedZoom] || ZOOM_CONFIG.medium;
      const dateForAge = item.listingDate || item.foundAt;
      const isNew = Date.now() - new Date(item.foundAt).getTime() < 60000;
      const isEnded = item.listingEndDate && new Date(item.listingEndDate).getTime() < Date.now();
      const isSold = isEnded && item.bidCount > 0 && (item.buyingFormats || []).includes("Auction");
      const formats = item.buyingFormats || [];
      const formatBadges = formats
        .map((f) => {
          const clsMap = { Auction: "badge-auction", "Buy It Now": "badge-bin", "Best Offer": "badge-offer" };
          const cls = clsMap[f] || "badge-default";
          return `<span class="badge ${cls} ${zc.meta}">${escapeHtml(FORMAT_BADGE_LABELS[f] || f)}</span>`;
        })
        .join("");

      const cardColorStyle = item.cardColor
        ? `border-color: ${hexToRgba(item.cardColor, 0.75)}; background-image: linear-gradient(135deg, ${hexToRgba(item.cardColor, 0.22)} 0%, ${hexToRgba(item.cardColor, 0.06)} 40%, transparent 65%);`
        : "";
      const endedStyle = isEnded ? "opacity: 0.5;" : "";

      return `
      <div
        class="card p-3 flex gap-3 cursor-pointer hover:bg-neutral-700/50 animate-fade-in"
        style="animation-delay: ${Math.min(index, 10) * 30}ms; ${cardColorStyle}${endedStyle}"
        data-end-date="${escapeAttr(item.listingEndDate || "")}"
        onclick="openListing('${escapeAttr(item.url)}')"
        title="${escapeAttr(item.title)}"
      >
        <!-- Thumbnail: full card height, square crop -->
        <div class="${zc.img} flex-shrink-0 rounded-md overflow-hidden bg-neutral-700 relative group">
          ${
            item.image
              ? `<img src="${escapeAttr(item.image)}" alt="" class="w-full h-full object-cover object-center" onerror="this.parentElement.innerHTML='<div class=\\'w-full h-full flex items-center justify-center\\'><svg class=\\'w-6 h-6 text-neutral-600\\' fill=\\'none\\' viewBox=\\'0 0 24 24\\' stroke=\\'currentColor\\'><path stroke-linecap=\\'round\\' stroke-linejoin=\\'round\\' stroke-width=\\'1.5\\' d=\\'M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3 3h18\\'/></svg></div>'" />
                <div class="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors flex items-center justify-center" onclick="event.stopPropagation(); openImagePopup('${escapeAttr(item.id)}')"
                ><svg class="w-5 h-5 text-white opacity-0 group-hover:opacity-100 transition-opacity drop-shadow" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-4.35-4.35M17 11A6 6 0 115 11a6 6 0 0112 0zm-3-1h-2V8m0 0V6m0 2H10"/></svg></div>`
              : `<div class="w-full h-full flex items-center justify-center">
                <svg class="w-6 h-6 text-neutral-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3 3h18"/>
                </svg>
              </div>`
          }
        </div>

        <!-- Info -->
        <div class="flex-1 min-w-0 flex flex-col">
          <!-- Top group: title + condition (anchored to top) -->
          <div class="flex flex-col gap-0.5">
            <!-- Row 1: Title + NEW/ENDED badges -->
            <div class="flex items-start justify-between gap-2">
              <p class="${zc.title} font-medium text-secondary leading-snug line-clamp-2 flex-1">${escapeHtml(item.title)}</p>
              <div class="flex flex-col items-end gap-0.5 flex-shrink-0">
                <span class="badge badge-accent feed-new-badge ${isNew ? "" : "hidden"}" data-found-at="${escapeAttr(item.foundAt)}">NEW</span>
                ${isEnded ? `<span class="badge ${isSold ? "bg-green-600/20 text-green-400" : "bg-neutral-700 text-neutral-500"} ${zc.meta}">${isSold ? "SOLD" : "ENDED"}</span>` : ""}
              </div>
            </div>
            <!-- Row 2: Condition -->
            ${item.condition ? `<p class="${zc.meta} text-neutral-400 truncate">${escapeHtml(item.condition)}</p>` : ""}
          </div>
          <!-- Bottom group: price, age, search/badges (pushed to bottom) -->
          <div class="flex flex-col gap-0.5 mt-auto pt-1">
            <!-- Row 3: Price + P&P -->
            <div class="flex items-center gap-2">
              ${
                item.price
                  ? `<span class="${zc.price} font-semibold text-yellow-400">${escapeHtml(item.price)}</span>`
                  : `<span class="${zc.meta} text-neutral-400">No price</span>`
              }
              ${item.shipping ? `<span class="${zc.meta} text-neutral-400">${escapeHtml(item.shipping)}</span>` : ""}
              ${item.bidCount > 0 ? `<span class="${zc.meta} text-neutral-400">${item.bidCount} bid${item.bidCount !== 1 ? "s" : ""}</span>` : ""}
            </div>
            <!-- Row 4: Listing Age -->
            <span class="${zc.meta} text-neutral-400 feed-age" data-date="${escapeAttr(dateForAge)}">Listed ${timeAgo(dateForAge)}</span>
            <!-- Row 5: Search name + Badges -->
            <div class="flex items-center justify-between gap-2">
              <span class="truncate ${zc.meta} text-neutral-400">${escapeHtml(item.searchName)}</span>
              <div class="flex items-center gap-1 flex-shrink-0">
                ${formatBadges}
                <span class="badge ${item.source === "vinted" ? "bg-teal-700/40 text-teal-400" : "bg-yellow-600/20 text-yellow-400"} ${zc.meta}">${escapeHtml(getSiteLabel(item.site))}</span>
              </div>
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
  const item = feedItems.find((i) => i.id === itemId);
  if (!item || !item.image) return;

  // Show the thumbnail immediately so the lightbox opens without delay
  _lightboxImages = [item.image.replace(/s-l\d+/, "s-l1600")];
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
      // Silently ignore - user still sees the primary image
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
    img.src = url.replace(/s-l\d+/, "s-l640");
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

document.addEventListener("keydown", (e) => {
  const lightbox = document.getElementById("image-lightbox");
  if (!lightbox || lightbox.classList.contains("hidden")) return;
  if (e.key === "Escape") closeImagePopup();
  else if (e.key === "ArrowRight") lightboxNav(1);
  else if (e.key === "ArrowLeft") lightboxNav(-1);
});
