"use strict";

// Shaping eBay's category taxonomy, kept free of Electron and network deps so
// it can be exercised directly by the tests.

/**
 * Flatten eBay's nested category tree into rows the picker can index.
 *
 * Every level is kept. The root itself is skipped — it is the marketplace, not a
 * category anyone searches in — so the top-level categories come back at depth 1
 * with a null parent, and each row records whether it is a leaf.
 */
function flattenCategoryTree(rootNode) {
  const categories = [];

  function traverse(node, parentId, depth) {
    if (!node || !node.category) return;
    const { categoryId, categoryName } = node.category;
    const children = node.childCategoryTreeNodes;
    if (depth > 0) {
      categories.push({
        id: categoryId,
        name: categoryName,
        depth,
        parentId: parentId || null,
        // eBay marks leaves explicitly; falling back to "has no children" keeps
        // this right if the flag is ever missing. Only leaves hold listings, so
        // the picker uses this to know when to stop offering another level.
        leaf: node.leafCategoryTreeNode === true || !children || children.length === 0,
      });
    }
    if (children) {
      for (const child of children) {
        traverse(child, depth > 0 ? categoryId : null, depth + 1);
      }
    }
  }

  traverse(rootNode, null, 0);
  return categories;
}

module.exports = { flattenCategoryTree };
