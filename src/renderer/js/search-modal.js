// ─── Search Modal ─────────────────────────────────────────────────────────────

// Condition definitions (only used by the search modal)
const CONDITIONS = [
  { id: "NEW", label: "New" },
  { id: "LIKE_NEW", label: "Like New" },
  { id: "NEW_OTHER", label: "New (Other)" },
  { id: "NEW_WITH_DEFECTS", label: "New with Defects" },
  { id: "CERTIFIED_REFURBISHED", label: "Certified Refurbished" },
  { id: "EXCELLENT_REFURBISHED", label: "Excellent Refurbished" },
  { id: "VERY_GOOD_REFURBISHED", label: "Very Good Refurbished" },
  { id: "GOOD_REFURBISHED", label: "Good Refurbished" },
  { id: "SELLER_REFURBISHED", label: "Seller Refurbished" },
  { id: "USED", label: "Used" },
  { id: "VERY_GOOD", label: "Very Good" },
  { id: "GOOD", label: "Good" },
  { id: "ACCEPTABLE", label: "Acceptable" },
  { id: "FOR_PARTS_OR_NOT_WORKING", label: "For Parts / Not Working" },
];

async function openSearchModal(id) {
  const modal = document.getElementById("search-modal");
  const titleEl = document.getElementById("modal-title");

  // Reset form
  document.getElementById("modal-search-id").value = "";
  document.getElementById("modal-name").value = "";
  document.getElementById("modal-source").value = "ebay";
  setSearchModalSource("ebay");
  document.getElementById("modal-site").value = "US";
  document.getElementById("modal-vinted-site").value = "VK";
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
  setSearchModalEnabled(true);
  setSearchModalNotify(true);
  setSearchModalCardColor(null);

  if (id) {
    const search = searches.find((s) => s.id === id);
    if (!search) return;
    titleEl.textContent = "Edit Search";
    document.getElementById("modal-search-id").value = search.id;
    document.getElementById("modal-name").value = search.name || "";
    const source = search.source || "ebay";
    setSearchModalSource(source);
    if (source === "vinted") {
      document.getElementById("modal-vinted-site").value = search.site || "VK";
      document.getElementById("modal-vinted-category").value = search.vintedCategory || "";
    } else {
      document.getElementById("modal-site").value = search.site || "US";
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
    setSearchModalEnabled(search.enabled !== false);
    setSearchModalNotify(search.notify !== false);
    setSearchModalCardColor(search.cardColor || null);
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

function toggleSearchModalEnabled() {
  setSearchModalEnabled(!searchModalEnabled);
}

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
    ebayBtn.className = `flex-1 py-2 rounded text-sm font-medium transition-colors ${!isVinted ? "bg-accent-500 text-white" : "bg-neutral-700 text-neutral-400 hover:text-secondary"}`;
  if (vintedBtn)
    vintedBtn.className = `flex-1 py-2 rounded text-sm font-medium transition-colors ${isVinted ? "bg-teal-600 text-white" : "bg-neutral-700 text-neutral-400 hover:text-secondary"}`;
}

function setSearchModalEnabled(value) {
  searchModalEnabled = value;
  const toggle = document.getElementById("modal-enabled-toggle");
  const knob = document.getElementById("modal-enabled-knob");
  if (searchModalEnabled) {
    toggle.classList.remove("bg-neutral-700");
    toggle.classList.add("bg-accent-500");
    knob.classList.remove("translate-x-1");
    knob.classList.add("translate-x-4");
  } else {
    toggle.classList.add("bg-neutral-700");
    toggle.classList.remove("bg-accent-500");
    knob.classList.add("translate-x-1");
    knob.classList.remove("translate-x-4");
  }
}

function toggleSearchModalNotify() {
  setSearchModalNotify(!searchModalNotify);
}

function setSearchModalNotify(value) {
  searchModalNotify = value;
  const toggle = document.getElementById("modal-notify-toggle");
  const knob = document.getElementById("modal-notify-knob");
  if (!toggle || !knob) return;
  if (searchModalNotify) {
    toggle.classList.remove("bg-neutral-700");
    toggle.classList.add("bg-accent-500");
    knob.classList.remove("translate-x-1");
    knob.classList.add("translate-x-4");
  } else {
    toggle.classList.add("bg-neutral-700");
    toggle.classList.remove("bg-accent-500");
    knob.classList.add("translate-x-1");
    knob.classList.remove("translate-x-4");
  }
}

async function saveSearch() {
  const name = document.getElementById("modal-name").value.trim();
  if (!name) {
    showToast("Please enter a search name", "error");
    document.getElementById("modal-name").focus();
    return;
  }

  const source = document.getElementById("modal-source").value || "ebay";
  const isVinted = source === "vinted";

  const keywords = document.getElementById("modal-keywords").value.trim();
  const vintedCategory = isVinted ? document.getElementById("modal-vinted-category").value || null : null;
  const category = isVinted ? "" : document.getElementById("modal-category").value.trim();
  if (!keywords && !category) {
    showToast(isVinted ? "Please enter keywords" : "Please enter keywords or select a category", "error");
    document.getElementById("modal-keywords").focus();
    return;
  }

  const site = isVinted ? document.getElementById("modal-vinted-site").value : document.getElementById("modal-site").value;

  const search = {
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
    notify: searchModalNotify,
    enabled: searchModalEnabled,
  };

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
    showToast(`Search "${name}" ${search.id ? "updated" : "added"}`, "success");
  } catch (err) {
    showToast(`Failed to save search: ${err.message}`, "error");
  }
}

function openEbayCategories() {
  const site = document.getElementById("modal-site").value;
  const urls = {
    US: "https://www.ebay.com/n/all-categories",
    UK: "https://www.ebay.co.uk/n/all-categories",
    AU: "https://www.ebay.com.au/n/all-categories",
    CA: "https://www.ebay.ca/n/all-categories",
    DE: "https://www.ebay.de/n/all-categories",
    FR: "https://www.ebay.fr/n/all-categories",
    ES: "https://www.ebay.es/n/all-categories",
    IT: "https://www.ebay.it/n/all-categories",
  };
  window.api.openExternal(urls[site] || urls["US"]);
}

// ─── Category Tree ────────────────────────────────────────────────────────────
async function loadCategoryTreeForModal(site, currentCategoryId) {
  const l1 = document.getElementById("modal-category-l1");
  const l2 = document.getElementById("modal-category-l2");
  currentCategoryTree = [];

  l1.innerHTML = '<option value="">Loading categories…</option>';
  l2.innerHTML = '<option value="">All sub-categories</option>';
  l2.classList.add("hidden");

  try {
    const result = await window.api.getCategoryTree(site);
    if (!result.ok) {
      l1.innerHTML = `<option value="">⚠ ${escapeHtml(result.error || "Failed to load")}</option>`;
      return;
    }
    currentCategoryTree = result.categories;

    // Populate L1 (depth=1) sorted alphabetically
    const topLevel = currentCategoryTree.filter((c) => c.depth === 1).sort((a, b) => a.name.localeCompare(b.name));
    l1.innerHTML = '<option value="">— Browse top-level categories —</option>';
    for (const cat of topLevel) {
      const opt = document.createElement("option");
      opt.value = cat.id;
      opt.textContent = cat.name;
      l1.appendChild(opt);
    }

    // If editing, pre-select the saved category
    if (currentCategoryId) {
      const saved = currentCategoryTree.find((c) => c.id === currentCategoryId);
      if (saved) {
        if (saved.depth === 1) {
          l1.value = saved.id;
          onCategoryL1Change();
        } else if (saved.depth === 2) {
          const parent = currentCategoryTree.find((c) => c.id === saved.parentId);
          if (parent) {
            l1.value = parent.id;
            _populateL2(parent);
            l2.value = saved.id;
          }
        }
      }
    }
  } catch (e) {
    l1.innerHTML = `<option value="">Error loading categories</option>`;
  }
}

function _populateL2(parentCat) {
  const l2 = document.getElementById("modal-category-l2");
  const children = currentCategoryTree
    .filter((c) => c.depth === 2 && c.parentId === parentCat.id)
    .sort((a, b) => a.name.localeCompare(b.name));
  l2.innerHTML = `<option value="">All — ${escapeHtml(parentCat.name)}</option>`;
  for (const child of children) {
    const opt = document.createElement("option");
    opt.value = child.id;
    opt.textContent = child.name;
    l2.appendChild(opt);
  }
  if (children.length > 0) {
    l2.classList.remove("hidden");
  } else {
    l2.classList.add("hidden");
  }
}

function onSiteChange() {
  const site = document.getElementById("modal-site").value;
  loadCategoryTreeForModal(site, "");
  document.getElementById("modal-category").value = "";
  document.getElementById("modal-category-l2").innerHTML = '<option value="">All sub-categories</option>';
  document.getElementById("modal-category-l2").classList.add("hidden");
}

function onCategoryL1Change() {
  const l1 = document.getElementById("modal-category-l1");
  const catInput = document.getElementById("modal-category");

  if (!l1.value) {
    document.getElementById("modal-category-l2").innerHTML = '<option value="">All sub-categories</option>';
    document.getElementById("modal-category-l2").classList.add("hidden");
    catInput.value = "";
    return;
  }

  const selectedCat = currentCategoryTree.find((c) => c.id === l1.value);
  if (!selectedCat) return;
  catInput.value = selectedCat.id;
  _populateL2(selectedCat);
}

function onCategoryL2Change() {
  const l1 = document.getElementById("modal-category-l1");
  const l2 = document.getElementById("modal-category-l2");
  const catInput = document.getElementById("modal-category");
  catInput.value = l2.value || l1.value;
}

// ─── Condition Multi-Select ───────────────────────────────────────────────────
function initConditionDropdown() {
  const list = document.getElementById("condition-list");
  list.innerHTML = CONDITIONS.map(
    (c) => `
    <label class="flex items-center gap-3 px-3 py-2 hover:bg-neutral-700 cursor-pointer select-none">
      <input type="checkbox" value="${c.id}" class="condition-checkbox"
        ${selectedConditions.includes(c.id) ? "checked" : ""}
        onchange="toggleCondition('${c.id}')">
      <span class="text-sm text-secondary">${c.label}</span>
    </label>
  `,
  ).join("");
}

function toggleCondition(id) {
  if (selectedConditions.includes(id)) {
    selectedConditions = selectedConditions.filter((c) => c !== id);
  } else {
    selectedConditions.push(id);
  }
  updateConditionDisplay();
}

function updateConditionDisplay() {
  const display = document.getElementById("condition-display");
  if (!display) return;
  if (selectedConditions.length === 0) {
    display.textContent = "Any condition";
    display.className = "text-neutral-500 text-sm truncate";
  } else if (selectedConditions.length === 1) {
    const c = CONDITIONS.find((c) => c.id === selectedConditions[0]);
    display.textContent = c ? c.label : selectedConditions[0];
    display.className = "text-secondary text-sm truncate";
  } else {
    display.textContent = `${selectedConditions.length} conditions selected`;
    display.className = "text-secondary text-sm truncate";
  }
}

function toggleConditionDropdown(e) {
  e.stopPropagation();
  conditionDropdownOpen = !conditionDropdownOpen;
  const list = document.getElementById("condition-list");
  if (conditionDropdownOpen) {
    initConditionDropdown();
    list.classList.remove("hidden");
  } else {
    list.classList.add("hidden");
  }
}

function closeConditionDropdown() {
  conditionDropdownOpen = false;
  const list = document.getElementById("condition-list");
  if (list) list.classList.add("hidden");
}

// Close condition dropdown on outside click
document.addEventListener(
  "click",
  (e) => {
    const container = document.getElementById("condition-dropdown-container");
    if (container && !container.contains(e.target)) closeConditionDropdown();
  },
  true,
);

// ─── Aspect Filters ───────────────────────────────────────────────────────────
function addAspectFilter() {
  const id = ++aspectFilterCounter;
  aspectFilters.push({ id, name: "", values: "" });
  const container = document.getElementById("aspect-filters-list");
  const div = document.createElement("div");
  div.className = "flex gap-2";
  div.dataset.afId = String(id);
  div.innerHTML = `
    <input type="text" placeholder="Attribute name" class="input-field w-2/5 text-sm"
      oninput="updateAspectFilter(${id}, 'name', this.value)" />
    <input type="text" placeholder="Values (comma-separated)" class="input-field flex-1 text-sm"
      oninput="updateAspectFilter(${id}, 'values', this.value)" />
    <button type="button" onclick="removeAspectFilter(${id})"
      class="btn-ghost px-2 py-1.5 hover:text-danger-500 flex-shrink-0" title="Remove">
      <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
        <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/>
      </svg>
    </button>
  `;
  container.appendChild(div);
  div.querySelector("input").focus();
}

function removeAspectFilter(id) {
  aspectFilters = aspectFilters.filter((af) => af.id !== id);
  const el = document.querySelector(`[data-af-id="${id}"]`);
  if (el) el.remove();
}

function updateAspectFilter(id, field, value) {
  const af = aspectFilters.find((f) => f.id === id);
  if (af) af[field] = value;
}

function clearAspectFilters() {
  aspectFilters = [];
  aspectFilterCounter = 0;
  const container = document.getElementById("aspect-filters-list");
  if (container) container.innerHTML = "";
}

function loadAspectFiltersFromSaved(saved) {
  clearAspectFilters();
  if (!Array.isArray(saved)) return;
  for (const af of saved) {
    const id = ++aspectFilterCounter;
    const valString = Array.isArray(af.values) ? af.values.join(", ") : af.values || "";
    aspectFilters.push({ id, name: af.name || "", values: valString });
    const container = document.getElementById("aspect-filters-list");
    const div = document.createElement("div");
    div.className = "flex gap-2";
    div.dataset.afId = String(id);
    div.innerHTML = `
      <input type="text" placeholder="Attribute name" class="input-field w-2/5 text-sm"
        value="${escapeAttr(af.name || "")}"
        oninput="updateAspectFilter(${id}, 'name', this.value)" />
      <input type="text" placeholder="Values (comma-separated)" class="input-field flex-1 text-sm"
        value="${escapeAttr(valString)}"
        oninput="updateAspectFilter(${id}, 'values', this.value)" />
      <button type="button" onclick="removeAspectFilter(${id})"
        class="btn-ghost px-2 py-1.5 hover:text-danger-500 flex-shrink-0" title="Remove">
        <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
          <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/>
        </svg>
      </button>
    `;
    container.appendChild(div);
  }
}

// ─── Vinted Filters ──────────────────────────────────────────────────────────
function addVintedFilter() {
  const id = ++vintedFilterCounter;
  vintedFilters.push({ id, name: "", values: "" });
  const container = document.getElementById("vinted-filters-list");
  const div = document.createElement("div");
  div.className = "flex gap-2";
  div.dataset.vfId = String(id);
  div.innerHTML = `
    <input type="text" placeholder="Filter key (e.g. video_game_platform_ids)" class="input-field w-2/5 text-sm"
      oninput="updateVintedFilter(${id}, 'name', this.value)" />
    <input type="text" placeholder="Values (comma-separated IDs)" class="input-field flex-1 text-sm"
      oninput="updateVintedFilter(${id}, 'values', this.value)" />
    <button type="button" onclick="removeVintedFilter(${id})"
      class="btn-ghost px-2 py-1.5 hover:text-danger-500 flex-shrink-0" title="Remove">
      <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
        <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/>
      </svg>
    </button>
  `;
  container.appendChild(div);
  div.querySelector("input").focus();
}

function removeVintedFilter(id) {
  vintedFilters = vintedFilters.filter((vf) => vf.id !== id);
  const el = document.querySelector(`[data-vf-id="${id}"]`);
  if (el) el.remove();
}

function updateVintedFilter(id, field, value) {
  const vf = vintedFilters.find((f) => f.id === id);
  if (vf) vf[field] = value;
}

function clearVintedFilters() {
  vintedFilters = [];
  vintedFilterCounter = 0;
  const container = document.getElementById("vinted-filters-list");
  if (container) container.innerHTML = "";
}

function loadVintedFiltersFromSaved(saved) {
  clearVintedFilters();
  if (!Array.isArray(saved)) return;
  for (const vf of saved) {
    const id = ++vintedFilterCounter;
    vintedFilters.push({ id, name: vf.name || "", values: vf.values || "" });
    const container = document.getElementById("vinted-filters-list");
    const div = document.createElement("div");
    div.className = "flex gap-2";
    div.dataset.vfId = String(id);
    div.innerHTML = `
      <input type="text" placeholder="Filter key (e.g. video_game_platform_ids)" class="input-field w-2/5 text-sm"
        value="${escapeAttr(vf.name || "")}"
        oninput="updateVintedFilter(${id}, 'name', this.value)" />
      <input type="text" placeholder="Values (comma-separated IDs)" class="input-field flex-1 text-sm"
        value="${escapeAttr(vf.values || "")}"
        oninput="updateVintedFilter(${id}, 'values', this.value)" />
      <button type="button" onclick="removeVintedFilter(${id})"
        class="btn-ghost px-2 py-1.5 hover:text-danger-500 flex-shrink-0" title="Remove">
        <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
          <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/>
        </svg>
      </button>
    `;
    container.appendChild(div);
  }
}
