"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { flattenCategoryTree } = require("../src/main/ebay/category-tree");

/** Build a taxonomy node in the shape the eBay API returns. */
function node(id, name, children, leaf) {
  const n = { category: { categoryId: id, categoryName: name } };
  if (children) n.childCategoryTreeNodes = children;
  if (leaf !== undefined) n.leafCategoryTreeNode = leaf;
  return n;
}

// Toys & Games › Diecast & Vehicles › Cars, Trucks & Vans › Corgi — four levels,
// which the old two-level traversal could not reach the bottom of.
const SAMPLE = node("0", "Root", [
  node("220", "Toys & Games", [
    node("222", "Diecast & Vehicles", [
      node("180", "Cars, Trucks & Vans", [node("4next", "Corgi", null, true)]),
      node("181", "Farm Vehicles", null, true),
    ]),
    node("233", "Games", null, true),
  ]),
  node("1", "Collectables", [node("34", "Advertising", null, true)]),
]);

test("every level is kept, not just the top two", () => {
  const flat = flattenCategoryTree(SAMPLE);
  assert.deepEqual(
    flat.map((c) => c.id).sort(),
    ["1", "180", "181", "220", "222", "233", "34", "4next"].sort(),
  );
  assert.equal(Math.max(...flat.map((c) => c.depth)), 4);
});

test("the root is not itself a category", () => {
  const flat = flattenCategoryTree(SAMPLE);
  assert.equal(
    flat.find((c) => c.id === "0"),
    undefined,
  );
});

test("top-level categories sit at depth 1 with no parent", () => {
  const flat = flattenCategoryTree(SAMPLE);
  const toys = flat.find((c) => c.id === "220");
  assert.equal(toys.depth, 1);
  assert.equal(toys.parentId, null);
});

test("parentId chains back to the root, one level at a time", () => {
  const flat = flattenCategoryTree(SAMPLE);
  const byId = new Map(flat.map((c) => [c.id, c]));
  const path = [];
  let cur = byId.get("4next");
  while (cur) {
    path.unshift(cur.name);
    cur = cur.parentId ? byId.get(cur.parentId) : null;
  }
  assert.deepEqual(path, ["Toys & Games", "Diecast & Vehicles", "Cars, Trucks & Vans", "Corgi"]);
});

test("depth matches the position in the chain", () => {
  const flat = flattenCategoryTree(SAMPLE);
  const byId = new Map(flat.map((c) => [c.id, c]));
  assert.equal(byId.get("220").depth, 1);
  assert.equal(byId.get("222").depth, 2);
  assert.equal(byId.get("180").depth, 3);
  assert.equal(byId.get("4next").depth, 4);
});

test("leaves are flagged and containers are not", () => {
  const flat = flattenCategoryTree(SAMPLE);
  const byId = new Map(flat.map((c) => [c.id, c]));
  assert.equal(byId.get("4next").leaf, true, "Corgi is a leaf");
  assert.equal(byId.get("233").leaf, true, "Games is a leaf");
  assert.equal(byId.get("220").leaf, false, "Toys & Games is a container");
  assert.equal(byId.get("180").leaf, false, "Cars, Trucks & Vans is a container");
});

test("a node with no children counts as a leaf even without the flag", () => {
  // The flag is eBay's, so the structure has to stand on its own if it is absent.
  const flat = flattenCategoryTree(node("0", "Root", [node("9", "Unflagged")]));
  assert.equal(flat[0].leaf, true);
});

test("an explicit leaf flag wins over having an empty children array", () => {
  const flat = flattenCategoryTree(node("0", "Root", [node("9", "Odd", [], true)]));
  assert.equal(flat[0].leaf, true);
});

test("malformed nodes are skipped rather than throwing", () => {
  assert.deepEqual(flattenCategoryTree(null), []);
  assert.deepEqual(flattenCategoryTree({}), []);
  assert.deepEqual(flattenCategoryTree({ childCategoryTreeNodes: [{}] }), []);
});
