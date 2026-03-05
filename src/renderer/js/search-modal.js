// ─── Search Modal ─────────────────────────────────────────────────────────────
// Core modal lifecycle: open, close, save, source/enabled/notify/card-color toggles.
// Category tree    → category-tree.js
// Condition select → condition-select.js
// Aspect filters   → aspect-filters.js
// Vinted filters   → vinted-filters.js

function resetSearchForm() {
  document.getElementById("modal-search-id").value = "";
  document.getElementById("modal-name").value = "";
  document.getElementById("modal-source").value = "ebay";
  setSearchModalSource("ebay");
  document.getElementById("modal-site").value = "UK";
  document.getElementById("modal-vinted-site").value = "UK";
  document.getElementById("modal-vinted-category").value = "";
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
  document.getElementById("modal-initial-count").value = "";
  selectedConditions = [];
  updateConditionDisplay();
  closeConditionDropdown();
  clearAspectFilters();
  clearVintedFilters();
  document.getElementById("modal-max-notify-price").value = "";
  setSearchModalEnabled(true);
  setSearchModalNotify(true);
  setSearchModalCardColor(null);
}

function populateSearchForm(search) {
  document.getElementById("modal-search-id").value = search.id;
  document.getElementById("modal-name").value = search.name || "";
  const source = search.source || "ebay";
  setSearchModalSource(source);
  if (source === "vinted") {
    document.getElementById("modal-vinted-site").value = search.site || "UK";
    document.getElementById("modal-vinted-category").value = search.vintedCategory || "";
  } else {
    document.getElementById("modal-site").value = search.site || "UK";
  }
  document.getElementById("modal-keywords").value = search.keywords || "";
  document.getElementById("modal-category").value = search.category || "";
  document.getElementById("modal-min-price").value = search.minPrice || "";
  document.getElementById("modal-max-price").value = search.maxPrice || "";
  document.getElementById("modal-location").value = search.itemLocation ? search.itemLocation.toUpperCase() : "";
  document.getElementById("modal-format").value = search.format || "all";
  document.getElementById("modal-min-interval").value = search.minInterval || "";
  document.getElementById("modal-max-interval").value = search.maxInterval || "";
  document.getElementById("modal-initial-count").value = search.initialCount || "";
  selectedConditions = Array.isArray(search.conditions) ? [...search.conditions] : [];
  updateConditionDisplay();
  loadAspectFiltersFromSaved(search.aspectFilters);
  loadVintedFiltersFromSaved(search.vintedFilters);
  document.getElementById("modal-max-notify-price").value = search.maxNotifyPrice != null ? search.maxNotifyPrice : "";
  setSearchModalEnabled(search.enabled !== false);
  setSearchModalNotify(search.notify !== false);
  setSearchModalCardColor(search.cardColor || null);
}

async function openSearchModal(id) {
  const modal = document.getElementById("search-modal");
  const titleEl = document.getElementById("modal-title");

  resetSearchForm();

  if (id) {
    const search = searches.find((s) => s.id === id);
    if (!search) return;
    titleEl.textContent = "Edit Search";
    populateSearchForm(search);
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

// ─── Source Toggle ────────────────────────────────────────────────────────────
function setSearchModalSource(source) {
  const el = document.getElementById("modal-source");
  if (el) el.value = source;
  const isVinted = source === "vinted";
  document.getElementById("ebay-site-section")?.classList.toggle("hidden", isVinted);
  document.getElementById("vinted-site-section")?.classList.toggle("hidden", !isVinted);
  document.getElementById("ebay-only-fields")?.classList.toggle("hidden", isVinted);
  document.getElementById("vinted-only-fields")?.classList.toggle("hidden", !isVinted);
  const ebayBtn = document.getElementById("source-btn-ebay");
  const vintedBtn = document.getElementById("source-btn-vinted");
  if (ebayBtn)
    ebayBtn.className = `flex-1 py-2 rounded text-sm font-medium transition-colors ${!isVinted ? "bg-accent-500 text-white" : "border border-neutral-600 text-neutral-300 hover:bg-neutral-700"}`;
  if (vintedBtn)
    vintedBtn.className = `flex-1 py-2 rounded text-sm font-medium transition-colors ${isVinted ? "bg-teal-600 text-white" : "border border-neutral-600 text-neutral-300 hover:bg-neutral-700"}`;
}

// ─── Toggle Helpers ───────────────────────────────────────────────────────────
function setToggleState(toggleId, knobId, active) {
  const toggle = document.getElementById(toggleId);
  const knob = document.getElementById(knobId);
  if (!toggle || !knob) return;
  toggle.classList.toggle("bg-neutral-700", !active);
  toggle.classList.toggle("bg-accent-500", active);
  knob.classList.toggle("translate-x-1", !active);
  knob.classList.toggle("translate-x-4", active);
  toggle.setAttribute("aria-checked", active ? "true" : "false");
}

// ─── Enabled Toggle ───────────────────────────────────────────────────────────
function toggleSearchModalEnabled() {
  setSearchModalEnabled(!searchModalEnabled);
}

function setSearchModalEnabled(value) {
  searchModalEnabled = value;
  setToggleState("modal-enabled-toggle", "modal-enabled-knob", value);
}

// ─── Notify Toggle ────────────────────────────────────────────────────────────
function toggleSearchModalNotify() {
  setSearchModalNotify(!searchModalNotify);
}

function setSearchModalNotify(value) {
  searchModalNotify = value;
  setToggleState("modal-notify-toggle", "modal-notify-knob", value);
}

// ─── Card Colour ──────────────────────────────────────────────────────────────
function setSearchModalCardColor(color) {
  searchModalCardColor = color || null;
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

// ─── Save ─────────────────────────────────────────────────────────────────────
function collectSearchFormData() {
  const name = document.getElementById("modal-name").value.trim();
  if (!name) {
    showToast("Please enter a search name", "error");
    document.getElementById("modal-name").focus();
    return null;
  }

  const source = document.getElementById("modal-source").value || "ebay";
  const isVinted = source === "vinted";

  const keywords = document.getElementById("modal-keywords").value.trim();
  const vintedCategory = isVinted ? document.getElementById("modal-vinted-category").value || null : null;
  const category = isVinted ? "" : document.getElementById("modal-category").value.trim();
  if (!keywords && !category) {
    showToast(isVinted ? "Please enter keywords" : "Please enter keywords or select a category", "error");
    document.getElementById("modal-keywords").focus();
    return null;
  }

  const site = isVinted ? document.getElementById("modal-vinted-site").value : document.getElementById("modal-site").value;

  return {
    id: document.getElementById("modal-search-id").value || undefined,
    source,
    name,
    site,
    keywords,
    category: isVinted ? null : category,
    vintedCategory: isVinted ? vintedCategory : null,
    minPrice: document.getElementById("modal-min-price").value || null,
    maxPrice: document.getElementById("modal-max-price").value || null,
    itemLocation: isVinted ? null : document.getElementById("modal-location").value || null,
    format: isVinted ? null : document.getElementById("modal-format").value,
    conditions: isVinted ? [] : selectedConditions.length > 0 ? [...selectedConditions] : [],
    aspectFilters: isVinted
      ? []
      : aspectFilters
          .filter((af) => af.name.trim() && af.values.trim())
          .map((af) => ({
            name: af.name.trim(),
            values: af.values
              .split(",")
              .map((v) => v.trim())
              .filter((v) => v),
          })),
    vintedFilters: isVinted
      ? vintedFilters
          .filter((vf) => vf.name.trim() && vf.values.trim())
          .map((vf) => ({
            name: vf.name.trim(),
            values: vf.values.trim(),
          }))
      : [],
    cardColor: searchModalCardColor || null,
    minInterval: parseInt(document.getElementById("modal-min-interval").value) || null,
    maxInterval: parseInt(document.getElementById("modal-max-interval").value) || null,
    initialCount: parseInt(document.getElementById("modal-initial-count").value) || 0,
    maxNotifyPrice: parseFloat(document.getElementById("modal-max-notify-price").value) || null,
    notify: searchModalNotify,
    enabled: searchModalEnabled,
  };
}

async function saveSearch() {
  const search = collectSearchFormData();
  if (!search) return;

  try {
    searches = await window.api.saveSearch(search);
    // Retroactively update cardColor on any existing feed items from this search
    if (search.id) {
      const newColor = search.cardColor || null;
      let feedUpdated = false;
      feedItems.forEach((item) => {
        if (item.searchId === search.id && item.cardColor !== newColor) {
          item.cardColor = newColor;
          feedUpdated = true;
        }
      });
      if (feedUpdated) renderFeed();
    }
    renderSearches();
    closeSearchModal();
    showToast(`Search "${search.name}" ${search.id ? "updated" : "added"}`, "success");
  } catch (err) {
    showToast(`Failed to save search: ${err.message}`, "error");
  }
}

function openEbayCategories() {
  const site = document.getElementById("modal-site").value;
  window.api.openExternal(EBAY_CATEGORY_URLS[site] || EBAY_CATEGORY_URLS["US"]);
}
