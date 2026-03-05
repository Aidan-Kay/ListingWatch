// ─── Global State ─────────────────────────────────────────────────────────────
let searches = [];
let feedItems = [];
let settings = {};
let currentPage = "feed";
let newCount = 0;
let feedZoom = "medium";
let allPaused = false;
let feedSortOrder = "newest";
let feedFilters = { text: "", platform: "all", searchId: "all", buyingFormat: "all" };
let favourites = [];

// Search modal state  (prefixed searchModal to distinguish from future modals)
let searchModalEnabled = true;
let searchModalCardColor = null;
let searchModalNotify = true;

// Category tree state
let currentCategoryTree = []; // flat array of { id, name, depth, parentId }

// Condition multi-select state
let selectedConditions = []; // array of condition value strings
let conditionDropdownOpen = false;

// Aspect filter state (eBay)
let aspectFilters = []; // array of { id, name, values: string }
let aspectFilterCounter = 0;

// Vinted filter state
let vintedFilters = []; // array of { id, name, values: string }
let vintedFilterCounter = 0;
