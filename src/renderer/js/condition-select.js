// ─── Condition Multi-Select ───────────────────────────────────────────────────
// Manages the condition dropdown in the search modal.
// Depends on: state.js (selectedConditions, conditionDropdownOpen)

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

// Close the dropdown when clicking outside it
document.addEventListener(
  "click",
  (e) => {
    const container = document.getElementById("condition-dropdown-container");
    if (container && !container.contains(e.target)) closeConditionDropdown();
  },
  true,
);
