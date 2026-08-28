"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  MAX_TERM_VARIANTS,
  normalise,
  expandAlternatives,
  splitExclusions,
  parsePhrases,
  splitTerms,
  compileList,
  compileLists,
  countTerms,
  matchTitle,
  invalidateCompiled,
} = require("../src/shared/keyword-match");

/** Build a list whose terms are all in one anonymous list. */
function listOf(terms, id = "list_test", version = 1) {
  return { id, name: "test", terms, version };
}

/** Terms a title matches, via the full compile → match path. */
function matches(title, terms) {
  invalidateCompiled("list_test");
  return matchTitle(title, [compileList(listOf(terms))]);
}

test("normalise strips diacritics, case, and punctuation", () => {
  assert.equal(normalise("Pokémon Écarlate"), "pokemon ecarlate");
  assert.equal(normalise("FIFA-21 (PS4)"), "fifa 21 ps4");
  assert.equal(normalise("  spaced   out  "), "spaced out");
});

test("a term matches when all its tokens appear, in any order", () => {
  assert.deepEqual(matches("Paper Mario The Thousand Year Door", ["Paper Mario Thousand Year Door"]), [
    "Paper Mario Thousand Year Door",
  ]);
  assert.deepEqual(matches("Mario Kart 8 Deluxe - Nintendo Switch", ["kart mario"]), ["kart mario"]);
});

test("extra words in the title are tolerated", () => {
  assert.deepEqual(matches("Sealed Zelda Ocarina of Time N64 PAL", ["Ocarina of Time"]), ["Ocarina of Time"]);
});

test("a term does not match a prefix of a longer token", () => {
  assert.deepEqual(matches("Final Fantasy VIII", ["Final Fantasy VII"]), []);
  assert.deepEqual(matches("Resident Evil 30th Anniversary", ["Resident Evil 3"]), []);
  assert.deepEqual(matches("bicolour socks", ["ico"]), []);
});

test("spacing variants match through the squashed form", () => {
  assert.deepEqual(matches("FIFA21 for PS4", ["FIFA 21"]), ["FIFA 21"]);
  assert.deepEqual(matches("FIFA 21 for PS4", ["FIFA21"]), ["FIFA21"]);
});

test("alternation accepts both | and , as separators", () => {
  assert.deepEqual(expandAlternatives("Final Fantasy (7|VII)").map((v) => normalise(v)), ["final fantasy 7", "final fantasy vii"]);
  assert.deepEqual(expandAlternatives("Final Fantasy (7,VII)").map((v) => normalise(v)), ["final fantasy 7", "final fantasy vii"]);
  assert.deepEqual(matches("Final Fantasy VII Remake", ["Final Fantasy (7|VII)"]), ["Final Fantasy (7|VII)"]);
  assert.deepEqual(matches("Final Fantasy IX", ["Final Fantasy (7|VII)"]), []);
});

test("alternation multiplies across groups", () => {
  assert.equal(expandAlternatives("(Res|Resident) Evil (2|II)").length, 4);
});

test("expansion is capped so a nest of alternations cannot blow up", () => {
  const wide = Array.from({ length: 8 }, () => "(a|b|c|d)").join(" ");
  assert.ok(expandAlternatives(wide).length <= MAX_TERM_VARIANTS);
});

test("a quoted phrase must appear together and in order", () => {
  assert.deepEqual(matches("The Legend of Zelda Breath of the Wild", ['"The Legend of Zelda"']), ['"The Legend of Zelda"']);
  assert.deepEqual(matches("Zelda The Legend of", ['"The Legend of Zelda"']), []);
});

test("words outside a phrase stay order-free", () => {
  const term = '"paper mario" thousand year door';
  assert.deepEqual(matches("Paper Mario The Thousand Year Door", [term]), [term]);
  assert.deepEqual(matches("Thousand Year Door Paper Mario", [term]), [term]);
  assert.deepEqual(matches("Mario Paper Thousand Year Door", [term]), []);
});

test("parsePhrases separates quoted runs from loose words", () => {
  const { loose, phrases } = parsePhrases('"paper mario" thousand year door');
  assert.deepEqual(phrases, ["paper mario"]);
  assert.match(loose, /thousand year door/);
});

test("an unterminated quote degrades to ordinary text", () => {
  const { phrases } = parsePhrases('"paper mario thousand');
  assert.deepEqual(phrases, []);
});

test("a leading - on a word excludes", () => {
  const term = "Super Mario Party -Jamboree";
  assert.deepEqual(matches("Super Mario Party - Nintendo Switch", [term]), [term]);
  assert.deepEqual(matches("Super Mario Party Jamboree", [term]), []);
});

test("exclusions can be phrases", () => {
  const term = 'Zelda -"breath of the wild"';
  assert.deepEqual(matches("Zelda Ocarina of Time", [term]), [term]);
  assert.deepEqual(matches("Zelda Breath of the Wild", [term]), []);
});

test("a spaced-out dash is a separator, not an exclusion", () => {
  assert.deepEqual(splitExclusions("Zelda - Ocarina").excludes, []);
  assert.equal(splitExclusions("Zelda - Ocarina").include, "Zelda - Ocarina");
});

test("hyphenated titles are left intact", () => {
  assert.deepEqual(splitExclusions("Spider-Man 2").excludes, []);
  assert.deepEqual(matches("Spider-Man 2 PS5", ["Spider-Man 2"]), ["Spider-Man 2"]);
});

test("an exclusion group comes along whole", () => {
  const term = "Super Mario Party -(Jamboree|Superstars)";
  assert.deepEqual(matches("Super Mario Party Deluxe", [term]), [term]);
  assert.deepEqual(matches("Super Mario Party Superstars", [term]), []);
});

test("splitTerms separates on newlines and top-level commas only", () => {
  assert.deepEqual(splitTerms("zelda\nmario"), ["zelda", "mario"]);
  assert.deepEqual(splitTerms("zelda, mario"), ["zelda", "mario"]);
  assert.deepEqual(splitTerms("final fantasy (7,VII)"), ["final fantasy (7,VII)"]);
  assert.deepEqual(splitTerms('"a, b"'), ['"a, b"']);
  assert.deepEqual(splitTerms("  \n zelda \n\n "), ["zelda"]);
});

test("degenerate terms fail closed rather than matching everything", () => {
  assert.deepEqual(matches("literally anything at all", ["()"]), []);
  assert.deepEqual(matches("literally anything at all", ["-Jamboree"]), []);
  assert.deepEqual(matches("literally anything at all", ["zelda|"]), []);
});

test("an unmatched ( degrades to a literal", () => {
  assert.deepEqual(matches("Silent Hill 2001 edition", ["Silent Hill (2001"]), ["Silent Hill (2001"]);
});

test("nested groups warn instead of silently mis-matching", () => {
  const warnings = [];
  const original = console.warn;
  console.warn = (msg) => warnings.push(String(msg));
  try {
    expandAlternatives("a (b (c|d)|e)");
  } finally {
    console.warn = original;
  }
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /nests alternation groups/);
});

test("compiled lists are cached, and a version bump invalidates the cache", () => {
  const id = "list_version";
  invalidateCompiled(id);
  const first = compileList(listOf(["zelda"], id, 1));
  assert.equal(compileList(listOf(["zelda"], id, 1)), first, "same version should reuse the compiled form");

  const second = compileList(listOf(["mario"], id, 2));
  assert.notEqual(second, first, "a version bump must recompile");
  assert.deepEqual(matchTitle("Mario Kart", [second]), ["mario"]);
  invalidateCompiled(id);
});

test("countTerms reports the number of usable terms across lists", () => {
  const lists = [listOf(["zelda", "mario"], "list_a"), listOf(["sonic"], "list_b")];
  invalidateCompiled("list_a");
  invalidateCompiled("list_b");
  assert.equal(countTerms(compileLists(["list_a", "list_b"], lists)), 3);
  assert.equal(countTerms(compileLists([], lists)), 0);
  assert.equal(countTerms(compileLists(["list_missing"], lists)), 0, "a dangling reference contributes nothing");
});

test("matchTitle reports every term that matched", () => {
  const matched = matches("Super Mario Kart Deluxe", ["mario", "kart", "sonic"]);
  assert.deepEqual(matched.sort(), ["kart", "mario"]);
});
