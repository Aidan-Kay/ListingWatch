// ─── Category Tree ─────────────────────────────────────────────────────────────
// Loads the eBay category tree from the main process, populates the two-level
// dropdowns in the search modal, and keeps currentCategoryTree in sync.
// Depends on: state.js (currentCategoryTree), helpers.js (escapeHtml)

// Renderer-side cache: avoids repeated IPC round-trips when the same site's
// modal is opened multiple times. The main process already has a 7-day disk cache.
const _categoryTreeCache = {};

async function loadCategoryTreeForModal(site, currentCategoryId) {
  const l1 = document.getElementById("modal-category-l1");
  const l2 = document.getElementById("modal-category-l2");
  currentCategoryTree = [];

  l1.innerHTML = '<option value="">Loading categories…</option>';
  l2.innerHTML = '<option value="">All sub-categories</option>';
  l2.classList.add("hidden");

  try {
    if (_categoryTreeCache[site]) {
      // Serve from renderer-side cache — no IPC needed.
      currentCategoryTree = _categoryTreeCache[site];
    } else {
      const result = await window.api.getCategoryTree(site);
      if (!result.ok) {
        l1.innerHTML = `<option value="">⚠ ${escapeHtml(result.error || "Failed to load")}</option>`;
        return;
      }
      currentCategoryTree = result.categories;
      _categoryTreeCache[site] = result.categories;
    }

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
            populateL2(parent);
            l2.value = saved.id;
          }
        }
      }
    }
  } catch (e) {
    l1.innerHTML = `<option value="">Error loading categories</option>`;
  }
}

function populateL2(parentCat) {
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
  populateL2(selectedCat);
}

function onCategoryL2Change() {
  const l1 = document.getElementById("modal-category-l1");
  const l2 = document.getElementById("modal-category-l2");
  const catInput = document.getElementById("modal-category");
  catInput.value = l2.value || l1.value;
}
