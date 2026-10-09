// ─── Vinted Condition Multi-Select ────────────────────────────────────────────
// Manages the condition dropdown in the Vinted half of the search modal.
// Vinted offers the same six conditions in every category, so — unlike the eBay
// picker in condition-select.js — the list is fixed and needs no lookup.
// Depends on: state.js (selectedVintedConditions, vintedConditionDropdownOpen),
//             shared/constants.js (VINTED_CONDITIONS), helpers.js (escapeHtml)

function initVintedConditionDropdown() {
  const list = document.getElementById("vinted-condition-list");
  if (!list) return;
  // IDs come from a frozen list in this app's own source, never from an API, so
  // they are safe to interpolate into an inline handler.
  list.innerHTML = VINTED_CONDITIONS.map(
    (c) => `
    <label class="flex items-center gap-3 px-3 py-2 hover:bg-neutral-700 cursor-pointer select-none">
      <input type="checkbox" onchange="toggleVintedCondition('${c.id}')"
        ${selectedVintedConditions.includes(c.id) ? "checked" : ""}>
      <span class="text-sm text-secondary">${escapeHtml(c.label)}</span>
    </label>
  `,
  ).join("");
}

function toggleVintedCondition(id) {
  if (selectedVintedConditions.includes(id)) {
    selectedVintedConditions = selectedVintedConditions.filter((c) => c !== id);
  } else {
    selectedVintedConditions.push(id);
  }
  updateVintedConditionDisplay();
}

function updateVintedConditionDisplay() {
  const display = document.getElementById("vinted-condition-display");
  if (!display) return;
  if (selectedVintedConditions.length === 0) {
    display.textContent = "Any condition";
    display.className = "text-neutral-500 text-sm truncate";
  } else if (selectedVintedConditions.length === 1) {
    const c = VINTED_CONDITIONS.find((c) => c.id === selectedVintedConditions[0]);
    display.textContent = c ? c.label : selectedVintedConditions[0];
    display.className = "text-secondary text-sm truncate";
  } else {
    display.textContent = `${selectedVintedConditions.length} conditions selected`;
    display.className = "text-secondary text-sm truncate";
  }
}

function toggleVintedConditionDropdown(e) {
  e.stopPropagation();
  vintedConditionDropdownOpen = !vintedConditionDropdownOpen;
  const list = document.getElementById("vinted-condition-list");
  if (vintedConditionDropdownOpen) {
    initVintedConditionDropdown();
    list.classList.remove("hidden");
  } else {
    list.classList.add("hidden");
  }
}

function closeVintedConditionDropdown() {
  vintedConditionDropdownOpen = false;
  const list = document.getElementById("vinted-condition-list");
  if (list) list.classList.add("hidden");
}

/** Replace the selection wholesale — used by the modal's reset, edit, and import paths. */
function setVintedConditions(conditions) {
  selectedVintedConditions = toVintedConditionIds(conditions);
  if (vintedConditionDropdownOpen) initVintedConditionDropdown();
  updateVintedConditionDisplay();
}

// Close the dropdown when clicking outside it
document.addEventListener(
  "click",
  (e) => {
    const container = document.getElementById("vinted-condition-dropdown-container");
    if (container && !container.contains(e.target)) closeVintedConditionDropdown();
  },
  true,
);
