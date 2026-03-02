// ─── Aspect Filters (eBay) ────────────────────────────────────────────────────
// Manages the dynamic aspect-filter rows in the search modal.
// Depends on: state.js (aspectFilters, aspectFilterCounter), helpers.js (escapeAttr)

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
  const container = document.getElementById("aspect-filters-list");
  for (const af of saved) {
    const id = ++aspectFilterCounter;
    const valString = Array.isArray(af.values) ? af.values.join(", ") : af.values || "";
    aspectFilters.push({ id, name: af.name || "", values: valString });
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
