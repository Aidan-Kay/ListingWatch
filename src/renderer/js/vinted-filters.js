// ─── Vinted Filters ──────────────────────────────────────────────────────────
// Manages the dynamic Vinted-filter rows in the search modal.
// Depends on: state.js (vintedFilters, vintedFilterCounter), helpers.js (escapeAttr)

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
  const container = document.getElementById("vinted-filters-list");
  for (const vf of saved) {
    const id = ++vintedFilterCounter;
    vintedFilters.push({ id, name: vf.name || "", values: vf.values || "" });
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
