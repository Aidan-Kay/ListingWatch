// ─── Condition Multi-Select ───────────────────────────────────────────────────
// Manages the condition dropdown in the search modal. eBay offers a different
// set of conditions per category, so the list is loaded for whichever category
// is selected rather than being a fixed set — see loadConditionsForCategory().
// Depends on: state.js (selectedConditions, conditionDropdownOpen),
//             shared/constants.js (EBAY_CONDITIONS), helpers.js (escapeHtml/escapeAttr)

// The conditions currently offered, as [{ id, label }]. Starts as the full
// static list; narrowed to the category's real set once one is chosen.
let availableConditions = [...EBAY_CONDITIONS];

// Guards against a slow lookup for a category the user has already moved on
// from overwriting the list with stale options.
let conditionRequestToken = 0;

/**
 * Load the conditions eBay offers for a category and rebuild the dropdown.
 *
 * `pruneSelection` drops selections the new category does not offer — right when
 * the user picks a different category, since those IDs cannot match anything
 * there. It is off when a saved search is first opened: the list comes from live
 * refinements, so a condition with no current listings is briefly absent, and
 * quietly deleting it from the user's search just for opening the modal would
 * lose a filter they deliberately set.
 */
async function loadConditionsForCategory(site, categoryId, { pruneSelection = true } = {}) {
  const token = ++conditionRequestToken;
  setConditionsLoading(true);

  let conditions = [...EBAY_CONDITIONS];
  try {
    const result = await window.api.getCategoryConditions(site, categoryId);
    if (result.ok && Array.isArray(result.conditions) && result.conditions.length > 0) {
      conditions = result.conditions;
    }
  } catch (e) {
    console.warn("[conditions] Lookup failed, using the full list:", e.message);
  }

  if (token !== conditionRequestToken) return; // superseded by a later category

  const offered = new Set(conditions.map((c) => c.id));
  if (pruneSelection) {
    selectedConditions = selectedConditions.filter((id) => offered.has(id));
    availableConditions = conditions;
  } else {
    // Keep any saved selection visible and checked even if this category's
    // refinements do not currently include it.
    const missing = selectedConditions.filter((id) => !offered.has(id));
    availableConditions = [...conditions, ...missing.map(describeCondition)];
  }

  setConditionsLoading(false);
  if (conditionDropdownOpen) initConditionDropdown();
  updateConditionDisplay();
}

/** Best-known label for a condition ID that the category did not report. */
function describeCondition(id) {
  const known = EBAY_CONDITIONS.find((c) => c.id === id);
  return known ? { ...known } : { id, label: `Condition ${id}` };
}

function setConditionsLoading(loading) {
  const trigger = document.getElementById("condition-trigger");
  if (trigger) trigger.classList.toggle("opacity-60", loading);
  if (loading && conditionDropdownOpen) {
    const list = document.getElementById("condition-list");
    if (list) list.innerHTML = '<div class="px-3 py-2 text-sm text-neutral-500">Loading conditions…</div>';
  }
}

/** Reset to the full list — used when the modal opens without a category. */
function resetConditions() {
  conditionRequestToken++;
  availableConditions = [...EBAY_CONDITIONS];
}

function initConditionDropdown() {
  const list = document.getElementById("condition-list");
  if (!list) return;
  if (availableConditions.length === 0) {
    list.innerHTML = '<div class="px-3 py-2 text-sm text-neutral-500">No conditions available</div>';
    return;
  }
  // IDs and labels come from the eBay API rather than the fixed list they used
  // to, so they go in a data- attribute and the change is caught by delegation.
  // escapeAttr is not sufficient inside an inline handler: the HTML parser
  // decodes the entities back before the body is compiled as JavaScript.
  list.innerHTML = availableConditions
    .map(
      (c) => `
    <label class="flex items-center gap-3 px-3 py-2 hover:bg-neutral-700 cursor-pointer select-none">
      <input type="checkbox" class="condition-checkbox" data-condition-id="${escapeAttr(c.id)}"
        ${selectedConditions.includes(c.id) ? "checked" : ""}>
      <span class="text-sm text-secondary">${escapeHtml(c.label)}</span>
    </label>
  `,
    )
    .join("");
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
    const c = availableConditions.find((c) => c.id === selectedConditions[0]);
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

// Checkbox changes are delegated: the rows are rebuilt whenever the category
// changes, so per-row handlers would have to be re-bound every time.
document.addEventListener("change", (e) => {
  const box = e.target.closest?.("#condition-list .condition-checkbox");
  if (box) toggleCondition(box.dataset.conditionId);
});

// Close the dropdown when clicking outside it
document.addEventListener(
  "click",
  (e) => {
    const container = document.getElementById("condition-dropdown-container");
    if (container && !container.contains(e.target)) closeConditionDropdown();
  },
  true,
);
