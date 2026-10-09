// ─── Global State ─────────────────────────────────────────────────────────────
let searches = [];
let feedItems = [];
let settings = {};
let currentPage = "feed";
let newCount = 0;
let feedZoom = "medium";
let feedSortOrder = "newest";
let feedFilters = { text: "", platform: "all", searchId: "all", buyingFormat: "all" };
let favourites = [];
let favouritesSortOrder = "newest";
let favouritesFilters = { text: "", platform: "all", searchId: "all", buyingFormat: "all" };

// Search modal state  (prefixed searchModal to distinguish from future modals)
let searchModalEnabled = true;
let searchModalCardColor = null;
let searchModalNotify = true;
let searchModalIncludeLists = []; // ids of keyword lists attached to the search

// Keyword (match) list state
let keywordLists = []; // array of { id, name, terms[], version, updatedAt }
let editingKeywordListId = null; // id being edited in the manager, null = new/unsaved

// Category tree state
let currentCategoryTree = []; // flat array of { id, name, depth, parentId, leaf } — eBay's full tree, every level

// Condition multi-select state
let selectedConditions = []; // array of condition value strings
let conditionDropdownOpen = false;

// Aspect filter state (eBay)
let aspectFilters = []; // array of { id, name, values: string }
let aspectFilterCounter = 0;

// Vinted filter state
let vintedFilters = []; // array of { id, name, values: string }
let vintedFilterCounter = 0;

// Vinted condition multi-select state — the same six IDs in every category,
// so unlike the eBay picker there is no per-category list to track.
let selectedVintedConditions = []; // array of Vinted status ID strings
let vintedConditionDropdownOpen = false;
