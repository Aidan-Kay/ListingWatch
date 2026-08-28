// ─── Keyword (Match) Lists ────────────────────────────────────────────────────
// Reusable named term lists. A search with lists attached keeps only listings
// whose title matches one of the terms — the inverse of exclude keywords, and
// what makes a keyword-less category search usable.
//
// Depends on: state.js (keywordLists, editingKeywordListId, searchModalIncludeLists),
//             helpers.js (escapeHtml, escapeAttr), app.js (showToast)

/**
 * Split a textarea's contents into terms (one per line, or comma-separated).
 *
 * A comma inside an alternation group ("(7,VII)") or a quoted phrase belongs to
 * the term, so only top-level commas separate. Mirrors splitTerms() in
 * main/shared/keyword-match.js — the renderer loads plain scripts and cannot
 * require it, so the two are kept in step by hand.
 */
function parseTermsInput(text) {
  const str = String(text || "");
  const terms = [];
  let current = "";
  let depth = 0;
  let i = 0;

  while (i < str.length) {
    const ch = str[i];
    if (ch === '"') {
      let j = i + 1;
      while (j < str.length && str[j] !== '"' && str[j] !== "\n" && str[j] !== "\r") j++;
      const end = str[j] === '"' ? j + 1 : j;
      current += str.slice(i, end);
      i = end;
      continue;
    }
    if (ch === "\n" || ch === "\r" || (ch === "," && depth === 0)) {
      terms.push(current);
      current = "";
      i++;
      continue;
    }
    if (ch === "(") depth++;
    else if (ch === ")") depth = Math.max(0, depth - 1);
    current += ch;
    i++;
  }
  terms.push(current);

  return terms.map((t) => t.trim()).filter(Boolean);
}

/** Terms currently in the editor textarea. */
function currentEditorTerms() {
  return parseTermsInput(document.getElementById("kl-terms").value);
}

// ─── Search-modal checkbox group ──────────────────────────────────────────────

/**
 * Render the list checkboxes shown inside the search modal, reflecting
 * `searchModalIncludeLists`.
 */
function renderIncludeListOptions() {
  const container = document.getElementById("modal-include-lists");
  if (!container) return;

  if (keywordLists.length === 0) {
    container.innerHTML = `<p class="text-xs text-neutral-500 italic">No match lists yet — create one on the Match Lists page.</p>`;
    return;
  }

  container.innerHTML = keywordLists
    .map((list) => {
      const checked = searchModalIncludeLists.includes(list.id);
      return `
        <label class="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-neutral-700/50 cursor-pointer">
          <input type="checkbox" ${checked ? "checked" : ""} value="${escapeAttr(list.id)}"
            onchange="toggleIncludeList('${escapeAttr(list.id)}', this.checked)"
            class="accent-accent-500" />
          <span class="text-sm text-secondary flex-1 truncate">${escapeHtml(list.name)}</span>
          <span class="text-xs text-neutral-500 flex-shrink-0">${list.terms.length} ${list.terms.length === 1 ? "term" : "terms"}</span>
        </label>`;
    })
    .join("");
}

function toggleIncludeList(id, checked) {
  if (checked) {
    if (!searchModalIncludeLists.includes(id)) searchModalIncludeLists.push(id);
  } else {
    searchModalIncludeLists = searchModalIncludeLists.filter((x) => x !== id);
  }
}

// ─── Match Lists page ─────────────────────────────────────────────────────────

/**
 * Entering the page: show the currently-edited list, or the first one, or the
 * empty state. Called by showPage('lists').
 */
function renderKeywordListsPage() {
  if (keywordLists.length === 0) {
    editingKeywordListId = null;
    showListsEmptyState(true);
  } else {
    const stillExists = keywordLists.some((l) => l.id === editingKeywordListId);
    showListsEmptyState(false);
    selectKeywordList(stillExists ? editingKeywordListId : keywordLists[0].id);
  }
  renderKeywordListSidebar();
  updateListsCountBadge();
}

/** Toggle between the editor and the "no lists yet" placeholder. */
function showListsEmptyState(empty) {
  document.getElementById("lists-empty").classList.toggle("hidden", !empty);
  document.getElementById("lists-editor").classList.toggle("hidden", empty);
}

/** Sidebar nav badge showing how many lists exist. */
function updateListsCountBadge() {
  const badge = document.getElementById("lists-count");
  if (badge) badge.textContent = keywordLists.length;
}

function renderKeywordListSidebar() {
  const container = document.getElementById("keyword-list-sidebar");
  if (!container) return;

  if (keywordLists.length === 0) {
    container.innerHTML = `<p class="text-xs text-neutral-500 italic px-2 py-1.5">No lists yet</p>`;
    return;
  }

  container.innerHTML = keywordLists
    .map((list) => {
      const active = list.id === editingKeywordListId;
      return `
        <button type="button" data-list-id="${escapeAttr(list.id)}"
          class="w-full text-left px-2 py-1.5 rounded text-sm transition-colors ${
            active ? "bg-accent-500 text-white" : "text-secondary hover:bg-neutral-700"
          }">
          <span class="block truncate">${escapeHtml(list.name)}</span>
          <span class="block text-xs ${active ? "text-white/70" : "text-neutral-500"}">${list.terms.length} ${
            list.terms.length === 1 ? "term" : "terms"
          }</span>
        </button>`;
    })
    .join("");
}

/**
 * One delegated listener for the sidebar, replacing an inline onclick per list —
 * same reasoning as renderFeedCard: escapeAttr is not safe in a JS-string
 * context, and the sidebar is rebuilt on every save.
 */
function initKeywordListSidebar() {
  const container = document.getElementById("keyword-list-sidebar");
  if (!container) return;
  container.addEventListener("click", (e) => {
    const button = e.target.closest("[data-list-id]");
    if (button) selectKeywordList(button.dataset.listId);
  });
}

function selectKeywordList(id) {
  const list = keywordLists.find((l) => l.id === id);
  if (!list) return;
  editingKeywordListId = id;
  document.getElementById("kl-name").value = list.name;
  document.getElementById("kl-terms").value = list.terms.join("\n");
  document.getElementById("kl-delete").classList.remove("hidden");
  updateKeywordListCount();
  renderKeywordListSidebar();
  updateKeywordListUsage();
}

function newKeywordList() {
  editingKeywordListId = null;
  showListsEmptyState(false);
  document.getElementById("kl-name").value = "";
  document.getElementById("kl-terms").value = "";
  document.getElementById("kl-delete").classList.add("hidden");
  updateKeywordListCount();
  renderKeywordListSidebar();
  updateKeywordListUsage();
  document.getElementById("kl-name").focus();
}

/** Live term counter under the textarea, plus a nudge for unbalanced brackets. */
function updateKeywordListCount() {
  const terms = currentEditorTerms();
  const unique = new Set(terms.map((t) => t.toLowerCase())).size;
  const dupeNote = unique !== terms.length ? ` · ${terms.length - unique} duplicate${terms.length - unique === 1 ? "" : "s"}` : "";

  // An unmatched "(" is read as literal text rather than an alternation group,
  // which fails silently — worth flagging before it costs a missed listing.
  const unbalanced = terms.filter((t) => (t.match(/\(/g) || []).length !== (t.match(/\)/g) || []).length).length;
  const bracketNote = unbalanced > 0 ? ` · ${unbalanced} unbalanced ( )` : "";

  // Likewise an odd number of quotes: the stray one is read as a literal
  // character, so the phrase the user meant to pin down isn't pinned at all.
  const unpaired = terms.filter((t) => (t.match(/"/g) || []).length % 2 !== 0).length;
  const quoteNote = unpaired > 0 ? ` · ${unpaired} unpaired "` : "";

  // A line of nothing but exclusions has no term left to match, so the matcher
  // drops it — say so rather than letting it look like a working filter. The
  // chunk after "-" runs to the next space unless a phrase or group extends it.
  const excludeOnly = terms.filter(
    (t) => !/[\p{L}\p{N}]/u.test(t.replace(/(^|\s)-(?:"[^"]*"?|\([^)]*\)?|\S+)/gu, " ")),
  ).length;
  const excludeNote = excludeOnly > 0 ? ` · ${excludeOnly} with no term to match` : "";

  const warn = unbalanced > 0 || unpaired > 0 || excludeOnly > 0;
  const el = document.getElementById("kl-count");
  el.textContent = `${unique} ${unique === 1 ? "term" : "terms"}${dupeNote}${bracketNote}${quoteNote}${excludeNote}`;
  el.classList.toggle("text-yellow-500", warn);
  el.classList.toggle("text-neutral-500", !warn);
}

/** Show how many searches use the list being edited, so deletes aren't blind. */
function updateKeywordListUsage() {
  const el = document.getElementById("kl-usage");
  if (!el) return;
  if (!editingKeywordListId) {
    el.textContent = "";
    return;
  }
  const count = searches.filter((s) => Array.isArray(s.includeLists) && s.includeLists.includes(editingKeywordListId)).length;
  el.textContent = count === 0 ? "Not used by any search" : `Used by ${count} search${count === 1 ? "" : "es"}`;
}

async function saveKeywordList() {
  const name = document.getElementById("kl-name").value.trim();
  if (!name) {
    showToast("Please enter a list name", "error");
    document.getElementById("kl-name").focus();
    return;
  }

  try {
    const { lists, id } = await window.api.saveKeywordList({
      id: editingKeywordListId || undefined,
      name,
      terms: currentEditorTerms(),
    });
    keywordLists = lists;
    // Keep the editor on what was just saved. The id comes from the handler
    // rather than a name lookup, which picked the wrong list when two shared a
    // name — and the next Save would then overwrite that list's terms.
    editingKeywordListId = id;
    renderKeywordListSidebar();
    updateKeywordListUsage();
    updateListsCountBadge();
    renderIncludeListOptions();
    showToast(`List "${name}" saved`, "success");
  } catch (err) {
    showToast(`Failed to save list: ${err.message}`, "error");
  }
}

async function deleteKeywordList() {
  if (!editingKeywordListId) return;
  const list = keywordLists.find((l) => l.id === editingKeywordListId);
  if (!list) return;

  const used = searches.filter((s) => Array.isArray(s.includeLists) && s.includeLists.includes(list.id)).length;
  const warning = used > 0 ? `\n\nIt is used by ${used} search${used === 1 ? "" : "es"}, which will stop filtering by it.` : "";
  if (!(await appConfirm(`Delete "${list.name}"?${warning}`, "Delete", true))) return;

  try {
    keywordLists = await window.api.deleteKeywordList(list.id);
    // Searches were detached in the main process — refresh so the UI agrees.
    searches = await window.api.getSearches();
    searchModalIncludeLists = searchModalIncludeLists.filter((id) => id !== list.id);
    renderSearches();
    if (keywordLists.length > 0) {
      selectKeywordList(keywordLists[0].id);
    } else {
      editingKeywordListId = null;
      showListsEmptyState(true);
    }
    renderKeywordListSidebar();
    updateListsCountBadge();
    renderIncludeListOptions();
    showToast(`List "${list.name}" deleted`, "success");
  } catch (err) {
    showToast(`Failed to delete list: ${err.message}`, "error");
  }
}

/** Append terms from a .txt/.csv file into the editor. */
async function importKeywordListFile() {
  const result = await window.api.importKeywordListFile();
  if (!result || result.canceled) return;
  if (!result.ok) {
    showToast(`Import failed: ${result.error}`, "error");
    return;
  }

  const existing = currentEditorTerms();
  const merged = [...existing, ...result.terms];
  document.getElementById("kl-terms").value = merged.join("\n");
  if (!document.getElementById("kl-name").value.trim() && result.name) {
    document.getElementById("kl-name").value = result.name;
  }
  updateKeywordListCount();
  showToast(`Imported ${result.terms.length} term${result.terms.length === 1 ? "" : "s"} — review, then Save`, "success");
}
