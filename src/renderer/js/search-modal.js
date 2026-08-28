// ─── Search Modal ─────────────────────────────────────────────────────────────
// Core modal lifecycle: open, close, save, source/enabled/notify/card-color toggles.
// Category tree    → category-tree.js
// Condition select → condition-select.js
// Aspect filters   → aspect-filters.js
// Vinted filters   → vinted-filters.js

/** Parse a string to int, returning null for empty/non-numeric values (handles 0 correctly). */
function parseIntOrNull(value) {
  const trimmed = (value ?? "").toString().trim();
  if (trimmed === "") return null;
  const n = parseInt(trimmed, 10);
  return Number.isNaN(n) ? null : n;
}

/** Parse a string to float, returning null for empty/non-numeric values (handles 0 correctly). */
function parseFloatOrNull(value) {
  const trimmed = (value ?? "").toString().trim();
  if (trimmed === "") return null;
  const n = parseFloat(trimmed);
  return Number.isNaN(n) ? null : n;
}

function resetSearchForm() {
  document.getElementById("modal-search-id").value = "";
  const urlSection = document.getElementById("url-import-section");
  if (urlSection) urlSection.classList.add("hidden");
  document.getElementById("modal-name").value = "";
  document.getElementById("modal-source").value = "ebay";
  setSearchModalSource("ebay");
  document.getElementById("modal-site").value = "UK";
  document.getElementById("modal-vinted-site").value = "UK";
  document.getElementById("modal-vinted-category").value = "";
  document.getElementById("modal-keywords").value = "";
  document.getElementById("modal-exclude-keywords").value = "";
  searchModalIncludeLists = [];
  renderIncludeListOptions();
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
  document.getElementById("modal-exclude-keywords").value = Array.isArray(search.excludeKeywords)
    ? search.excludeKeywords.join(", ")
    : search.excludeKeywords || "";
  searchModalIncludeLists = Array.isArray(search.includeLists) ? [...search.includeLists] : [];
  renderIncludeListOptions();
  document.getElementById("modal-category").value = search.category || "";
  document.getElementById("modal-min-price").value = search.minPrice || "";
  document.getElementById("modal-max-price").value = search.maxPrice || "";
  document.getElementById("modal-location").value = search.itemLocation ? search.itemLocation.toUpperCase() : "";
  document.getElementById("modal-format").value = search.format || "all";
  document.getElementById("modal-min-interval").value = search.minInterval || "";
  document.getElementById("modal-max-interval").value = search.maxInterval || "";
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

  // Show the "Import from URL" button only when adding new searches
  const urlToggle = document.getElementById("url-import-toggle");
  if (urlToggle) urlToggle.classList.toggle("hidden", !!id);

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
    ebayBtn.className = `flex-1 py-2 rounded text-sm font-medium transition-colors ${!isVinted ? "bg-yellow-600 text-white" : "border border-neutral-600 text-neutral-300 hover:bg-neutral-700"}`;
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
  const excludeKeywordsRaw = document.getElementById("modal-exclude-keywords").value.trim();
  const excludeKeywords = excludeKeywordsRaw
    ? excludeKeywordsRaw
        .split(",")
        .map((k) => k.trim().toLowerCase())
        .filter(Boolean)
    : [];
  const vintedCategory = isVinted ? document.getElementById("modal-vinted-category").value || null : null;
  const category = isVinted ? "" : document.getElementById("modal-category").value.trim();
  // A Vinted search can be keyword-less: the category returns the whole feed and
  // an attached match list does the filtering client-side.
  const hasScope = isVinted ? keywords || vintedCategory : keywords || category;
  if (!hasScope) {
    showToast(isVinted ? "Please enter keywords or a category ID" : "Please enter keywords or select a category", "error");
    document.getElementById("modal-keywords").focus();
    return null;
  }
  if (isVinted && !keywords && searchModalIncludeLists.length === 0) {
    showToast("Category-only searches return the whole category — attach a match list to filter them", "warning");
  }

  const site = isVinted ? document.getElementById("modal-vinted-site").value : document.getElementById("modal-site").value;

  return {
    id: document.getElementById("modal-search-id").value || undefined,
    source,
    name,
    site,
    keywords,
    excludeKeywords,
    includeLists: [...searchModalIncludeLists],
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
    minInterval: parseIntOrNull(document.getElementById("modal-min-interval").value),
    maxInterval: parseIntOrNull(document.getElementById("modal-max-interval").value),
    maxNotifyPrice: parseFloatOrNull(document.getElementById("modal-max-notify-price").value),
    notify: searchModalNotify,
    enabled: searchModalEnabled,
  };
}

async function saveSearch() {
  const search = collectSearchFormData();
  if (!search) return;

  try {
    searches = await window.api.saveSearch(search);
    // Cards already on screen carry a snapshot of the search's name and colour,
    // so an edit has to patch them or a renamed search keeps showing its old
    // name until the app restarts.
    if (search.id) {
      const newColor = search.cardColor || null;
      let feedUpdated = false;
      for (const item of feedItems) {
        const belongsToSearch = item.searchId === search.id || (Array.isArray(item.searchIds) && item.searchIds.includes(search.id));
        if (!belongsToSearch) continue;
        if (item.cardColor !== newColor) {
          item.cardColor = newColor;
          feedUpdated = true;
        }
        // searchName is only the primary search's, so leave a merged card alone.
        if (item.searchId === search.id && item.searchName !== search.name) {
          item.searchName = search.name;
          feedUpdated = true;
        }
      }
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
