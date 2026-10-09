// ─── Category Tree ─────────────────────────────────────────────────────────────
// eBay's category tree, mirrored at full depth. Offers two ways to reach a
// category: type-to-search across every level (matched on the whole path), and
// drill-down selects that grow one level at a time. Both write the chosen ID to
// the hidden #modal-category input and refresh the condition list.
// Depends on: state.js (currentCategoryTree), helpers.js (escapeHtml),
//             condition-select.js (loadConditionsForCategory, resetConditions)

// Renderer-side cache: avoids repeated IPC round-trips when the same site's
// modal is opened multiple times. The main process already has a 7-day disk cache.
const _categoryTreeCache = {};

// id → category, rebuilt whenever the tree changes. Walking parentId chains to
// build breadcrumbs is O(depth) per lookup, and search does it for every hit.
let _categoryById = new Map();

// How many search hits to render. The full tree runs to tens of thousands of
// categories, and nobody scrolls past the first screenful of matches.
const CATEGORY_SEARCH_LIMIT = 40;

function indexCategories(categories) {
  _categoryById = new Map(categories.map((c) => [c.id, c]));
}

/** The chain from top-level down to `id`, outermost first. */
function categoryPath(id) {
  const chain = [];
  let node = _categoryById.get(id);
  while (node) {
    chain.unshift(node);
    node = node.parentId ? _categoryById.get(node.parentId) : null;
  }
  return chain;
}

function categoryPathText(id) {
  return categoryPath(id)
    .map((c) => c.name)
    .join(" › ");
}

function childrenOf(parentId) {
  return currentCategoryTree
    .filter((c) => c.parentId === parentId)
    .sort((a, b) => a.name.localeCompare(b.name));
}

function topLevelCategories() {
  return currentCategoryTree.filter((c) => c.depth === 1).sort((a, b) => a.name.localeCompare(b.name));
}

// ─── Loading ───────────────────────────────────────────────────────────────────

async function loadCategoryTreeForModal(site, currentCategoryId) {
  const levels = document.getElementById("category-levels");
  currentCategoryTree = [];
  _categoryById = new Map();
  clearCategoryLevels(levels);
  levels.innerHTML = '<div class="text-sm text-neutral-500 px-1">Loading categories…</div>';

  try {
    if (_categoryTreeCache[site]) {
      // Serve from renderer-side cache — no IPC needed.
      currentCategoryTree = _categoryTreeCache[site];
    } else {
      const result = await window.api.getCategoryTree(site);
      if (!result.ok) {
        levels.innerHTML = `<div class="text-sm text-danger-500 px-1">⚠ ${escapeHtml(result.error || "Failed to load")}</div>`;
        return;
      }
      currentCategoryTree = result.categories;
      _categoryTreeCache[site] = result.categories;
    }

    indexCategories(currentCategoryTree);
    setCategorySelection(currentCategoryId || "", { initial: true });
  } catch (e) {
    levels.innerHTML = `<div class="text-sm text-danger-500 px-1">Error loading categories</div>`;
  }
}

// ─── Selection ─────────────────────────────────────────────────────────────────

/**
 * Make `categoryId` the selection and rebuild the picker around it.
 *
 * `initial` marks the paint that happens when the modal opens, as opposed to a
 * category the user just picked. The distinction only matters to the condition
 * list, which must not prune a saved search's selections just for being opened.
 */
function setCategorySelection(categoryId, { initial = false } = {}) {
  document.getElementById("modal-category").value = categoryId || "";
  renderCategoryBreadcrumb(categoryId);
  renderCategoryLevels(categoryId);
  syncConditionsToCategory({ pruneSelection: !initial });
}

function clearCategorySelection() {
  document.getElementById("category-search").value = "";
  closeCategorySearchResults();
  setCategorySelection("");
}

function renderCategoryBreadcrumb(categoryId) {
  const box = document.getElementById("category-selected");
  const text = document.getElementById("category-selected-path");
  if (!box || !text) return;

  const node = categoryId ? _categoryById.get(categoryId) : null;
  if (!node) {
    box.classList.add("hidden");
    box.classList.remove("flex");
    return;
  }
  text.textContent = categoryPathText(categoryId);
  box.classList.remove("hidden");
  box.classList.add("flex");
}

/**
 * Draw one select per level of the selected category's path, plus a trailing
 * select for choosing among its children.
 *
 * A leaf has no trailing select — there is nothing below it. That is the whole
 * point of tracking `leaf`: the picker stops exactly where eBay's tree does,
 * rather than at a fixed depth.
 */
function renderCategoryLevels(categoryId) {
  const container = document.getElementById("category-levels");
  if (!container) return;
  clearCategoryLevels(container);

  const path = categoryId ? categoryPath(categoryId) : [];

  // One select per ancestor level, each showing that level's siblings.
  const levelParents = [null, ...path.map((c) => c.id)];
  for (let depth = 0; depth < levelParents.length; depth++) {
    const parentId = levelParents[depth];
    const options = depth === 0 ? topLevelCategories() : childrenOf(parentId);
    if (options.length === 0) break; // reached a leaf — nothing further to offer

    const selected = path[depth] ? path[depth].id : "";
    container.appendChild(buildLevelSelect(options, selected, depth, path[depth - 1]));
  }

  // Style the new selects to match the rest of the form. initCustomSelects skips
  // anything already replaced, so this is safe to call on every render.
  initCustomSelects(container);
}

/**
 * Empty the level container, taking the styled dropdowns with it.
 *
 * CustomSelect parks its panel on document.body rather than beside the select,
 * so clearing innerHTML alone would strand one panel per level on every
 * category change. destroy() removes both halves.
 */
function clearCategoryLevels(container) {
  for (const sel of container.querySelectorAll("select")) CustomSelect.destroy(sel);
  container.innerHTML = "";
}

function buildLevelSelect(options, selectedId, depth, parent) {
  const select = document.createElement("select");
  select.className = "select-field";
  select.id = `modal-category-level-${depth}`;
  select.dataset.level = String(depth);

  const placeholder = depth === 0 ? "— All categories —" : `All — ${parent ? parent.name : ""}`;
  select.appendChild(new Option(placeholder, ""));
  for (const cat of options) {
    const opt = new Option(cat.name, cat.id);
    if (cat.id === selectedId) opt.selected = true;
    select.appendChild(opt);
  }

  select.addEventListener("change", () => {
    // Clearing a level falls back to its parent, which is the category the user
    // has narrowed to so far — not to "no category at all".
    setCategorySelection(select.value || (parent ? parent.id : ""));
  });
  return select;
}

// ─── Search ────────────────────────────────────────────────────────────────────

/**
 * Rank categories against a query, matched on the full breadcrumb path.
 *
 * Matching the path rather than the leaf name alone is what makes "toys corgi"
 * or "diecast cars" work — the words the user remembers are usually spread
 * across levels. Leaves sort first: they are where listings actually are.
 */
function searchCategories(query) {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return [];

  const hits = [];
  for (const cat of currentCategoryTree) {
    const path = categoryPathText(cat.id).toLowerCase();
    if (!terms.every((t) => path.includes(t))) continue;
    const name = cat.name.toLowerCase();
    // Prefer a hit on the category's own name, and an exact one over a partial.
    const score = (name === terms.join(" ") ? 0 : terms.every((t) => name.includes(t)) ? 1 : 2) + (cat.leaf ? 0 : 0.5);
    hits.push({ cat, score });
    if (hits.length > 2000) break; // enough to rank well without scanning forever
  }

  return hits
    .sort((a, b) => a.score - b.score || a.cat.name.length - b.cat.name.length)
    .slice(0, CATEGORY_SEARCH_LIMIT)
    .map((h) => h.cat);
}

function renderCategorySearchResults(query) {
  const box = document.getElementById("category-search-results");
  if (!box) return;

  if (query.trim().length < 2) {
    closeCategorySearchResults();
    return;
  }

  const matches = searchCategories(query.trim());
  if (matches.length === 0) {
    box.innerHTML = '<div class="px-3 py-2 text-sm text-neutral-500">No matching categories</div>';
    box.classList.remove("hidden");
    return;
  }

  box.innerHTML = matches
    .map((cat) => {
      const path = categoryPath(cat.id);
      const trail = path
        .slice(0, -1)
        .map((c) => escapeHtml(c.name))
        .join(" › ");
      return `
        <button type="button" data-category-id="${escapeAttr(cat.id)}"
          class="w-full text-left px-3 py-2 hover:bg-neutral-700 border-b border-neutral-800 last:border-0">
          <div class="text-sm text-secondary">${escapeHtml(cat.name)}</div>
          ${trail ? `<div class="text-xs text-neutral-500 truncate">${trail}</div>` : ""}
        </button>`;
    })
    .join("");
  box.classList.remove("hidden");
}

function closeCategorySearchResults() {
  const box = document.getElementById("category-search-results");
  if (box) box.classList.add("hidden");
}

// ─── Conditions ────────────────────────────────────────────────────────────────

/**
 * Refresh the condition dropdown to match whichever category is now selected.
 *
 * eBay offers a different set of item conditions per category, so this runs on
 * every path that changes `modal-category`. With no category chosen there is
 * nothing to narrow to, which the renderer can answer by itself — no IPC.
 */
function syncConditionsToCategory({ pruneSelection = true } = {}) {
  const site = document.getElementById("modal-site").value;
  const categoryId = document.getElementById("modal-category").value;

  if (!categoryId) {
    resetConditions();
    if (conditionDropdownOpen) initConditionDropdown();
    updateConditionDisplay();
    return;
  }
  loadConditionsForCategory(site, categoryId, { pruneSelection });
}

// ─── Events ────────────────────────────────────────────────────────────────────

function onSiteChange() {
  const site = document.getElementById("modal-site").value;
  clearCategorySelection();
  loadCategoryTreeForModal(site, "");
}

document.addEventListener("input", (e) => {
  if (e.target.id === "category-search") renderCategorySearchResults(e.target.value);
});

// Capture phase, not bubble: the search modal's panel carries
// onclick="event.stopPropagation()" so that clicks inside it do not reach the
// backdrop's close handler. That also stops every click inside the modal from
// ever reaching document on the way up, which would leave the result list inert
// and permanently open. Capturing runs from document downwards, before the
// panel gets to stop anything — the same reason the condition dropdown's
// outside-click listener captures.
document.addEventListener(
  "click",
  (e) => {
    const hit = e.target.closest?.("#category-search-results [data-category-id]");
    if (hit) {
      document.getElementById("category-search").value = "";
      closeCategorySearchResults();
      setCategorySelection(hit.dataset.categoryId);
      return;
    }
    const container = document.getElementById("category-search-container");
    if (container && !container.contains(e.target)) closeCategorySearchResults();
  },
  true,
);
