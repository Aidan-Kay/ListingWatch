"use strict";

// Term matching for keyword include-lists.
//
// Marketplace titles are user-typed and messy ("FIFA21", "Fifa 21 ps4",
// "Pokémon Écarlate"), so a plain substring test is both too strict (misses
// spacing variants) and too loose (a term like "ico" matches "bicolour").
// Instead both sides are normalised, and a term matches when either:
//   1. every one of its tokens appears somewhere in the title, in any order and
//      not necessarily adjacent, or
//   2. its squashed form aligns with whole tokens of the squashed title,
//      which catches spacing variants ("FIFA 21" vs "Fifa21").
//
// Rule 1 deliberately favours recall over precision: a missed listing is worse
// than an extra one. It means "Paper Mario Thousand Year Door" still matches
// "Paper Mario The Thousand Year Door" (extra words are fine), and word order
// does not matter. The cost is that a term's words may be satisfied by
// different parts of a bundle listing.
//
// Rule 2 checks token boundaries rather than doing a plain substring test.
// Without that, a term matches a prefix of a longer token: "Final Fantasy VII"
// would match "Final Fantasy VIII", and "Resident Evil 3" would match
// "Resident Evil 30th Anniversary".
//
// Terms may contain alternation groups — "Final Fantasy (7|VII)" expands at
// compile time into "final fantasy 7" and "final fantasy vii". Matching itself
// stays a plain comparison; only compilation knows about the syntax.
//
// A term may also carry exclusions, written as a leading "-" on a word:
// "Super Mario Party -Jamboree" matches "Super Mario Party - Nintendo Switch"
// but not "Super Mario Party Jamboree". Exclusions are matched by the same two
// rules as the term itself, and any one of them hitting rejects the whole term
// (other terms in the list are unaffected). This is the counterpart to a
// search's exclude-keywords, but scoped to the one term that needs it.
//
// Pure module: no Electron dependencies, so it can be exercised standalone.

// Ceiling on the variants one term may expand to, so a line of nested
// alternations can't blow up a 2000-term list.
const MAX_TERM_VARIANTS = 64;

/**
 * Normalise a string for comparison: strip diacritics, lowercase, and collapse
 * every run of non-alphanumeric characters to a single space.
 *
 * Decomposing first (NFKD) then dropping combining marks means "Pokémon" and
 * "Pokemon" normalise identically. Characters that survive neither step
 * (e.g. Polish "ł") become spaces — lossy, but applied identically to terms
 * and titles, so matching stays consistent.
 *
 * @param {string} str
 * @returns {string}
 */
function normalise(str) {
  return String(str ?? "")
    .normalize("NFKD")
    .replace(/\p{M}/gu, "") // combining marks left behind by NFKD
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Expand alternation groups into concrete term strings.
 *
 *   "Final Fantasy (7|VII)"      -> ["Final Fantasy 7", "Final Fantasy VII"]
 *   "(Res|Resident) Evil (2|II)" -> 4 variants
 *
 * Groups do not nest. An unmatched "(" is treated as a literal character, so a
 * title like "Silent Hill (2001)" still behaves sensibly — a single-option
 * group just yields the text back. Empty alternatives are dropped: a stray
 * trailing "|" would otherwise silently widen the term to match everything.
 *
 * @param {string} text
 * @returns {string[]}
 */
function expandAlternatives(text) {
  let variants = [""];
  let literal = "";
  let i = 0;
  let truncated = false;

  while (i < text.length) {
    const ch = text[i];
    if (ch !== "(") {
      literal += ch;
      i++;
      continue;
    }

    const close = text.indexOf(")", i);
    if (close === -1) {
      // Unmatched opener — treat the rest as literal text.
      literal += text.slice(i);
      break;
    }

    const options = text
      .slice(i + 1, close)
      .split("|")
      .map((o) => o.trim())
      .filter(Boolean);
    i = close + 1;
    if (options.length === 0) continue; // "()" contributes nothing

    const prefix = literal;
    literal = "";
    const next = [];
    for (const v of variants) {
      for (const o of options) {
        if (next.length >= MAX_TERM_VARIANTS) {
          truncated = true;
          break;
        }
        next.push(`${v}${prefix} ${o} `);
      }
    }
    variants = next;
  }

  if (truncated) {
    console.warn(`[keyword-match] "${text}" exceeds ${MAX_TERM_VARIANTS} variants — later alternatives ignored`);
  }
  return variants.map((v) => v + literal);
}

/**
 * Split a term into the part that must match and the parts that must not.
 *
 * A "-" negates only when it opens a word — at the start of the term or after
 * whitespace — and is followed by a non-space character. That keeps hyphenated
 * titles intact ("Spider-Man", "Yu-Gi-Oh") and leaves a spaced-out dash
 * separator ("Zelda - Ocarina of Time") as the literal it looks like. The
 * excluded chunk runs to the next top-level space, so an alternation group
 * comes along whole: "-(Jamboree|Superstars)", or "-(breath of the wild)" for
 * a phrase.
 *
 *   "Super Mario Party -Jamboree" -> { include: "Super Mario Party ", excludes: ["Jamboree"] }
 *
 * @param {string} text
 * @returns {{include: string, excludes: string[]}}
 */
function splitExclusions(text) {
  let include = "";
  const excludes = [];
  let i = 0;

  while (i < text.length) {
    const opensWord = i === 0 || /\s/.test(text[i - 1]);
    const next = text[i + 1];
    if (text[i] !== "-" || !opensWord || !next || /\s/.test(next)) {
      include += text[i];
      i++;
      continue;
    }

    // Consume up to the next space outside of an alternation group.
    let j = i + 1;
    let depth = 0;
    while (j < text.length) {
      const ch = text[j];
      if (ch === "(") depth++;
      else if (ch === ")") depth = Math.max(0, depth - 1);
      else if (depth === 0 && /\s/.test(ch)) break;
      j++;
    }
    excludes.push(text.slice(i + 1, j));
    i = j;
  }

  return { include, excludes };
}

/**
 * Expand a piece of term text into its matchable variants, dropping any that
 * normalise to nothing or repeat one already produced here.
 *
 * @param {string} text
 * @returns {{tokens: string[], squashed: string}[]}
 */
function compileVariants(text) {
  const variants = [];
  const seen = new Set();
  for (const candidate of expandAlternatives(text)) {
    const norm = normalise(candidate);
    if (!norm || seen.has(norm)) continue;
    seen.add(norm);
    const tokens = norm.split(" ");
    variants.push({ tokens, squashed: tokens.join("") });
  }
  return variants;
}

// Compiled-form cache, keyed by list id. Invalidated when the list's version
// changes so a 2000-term list is normalised on edit rather than on every poll.
const _compiled = new Map();

/**
 * Compile a keyword list into its matchable form. Each term expands to one or
 * more variants (via alternation groups) plus any exclusions; variants that
 * normalise to nothing, or that duplicate one already seen, are dropped. `raw`
 * is preserved so the feed can report the term the user actually wrote, not the
 * expanded variant.
 *
 * Two terms only count as duplicates when their exclusions agree as well, so
 * "Mario Party" and "Mario Party -Jamboree" both survive in one list.
 *
 * A term that is nothing but exclusions ("-Jamboree") is dropped: read
 * literally it would match every listing, which is never what was meant.
 *
 * @param {{id: string, version: number, terms: string[]}} list
 * @returns {{id: string, version: number, terms: {raw: string, variants: {tokens: string[], squashed: string}[], excludes: {tokens: string[], squashed: string}[]}[]}}
 */
function compileList(list) {
  const version = list.version || 0;
  const cached = _compiled.get(list.id);
  if (cached && cached.version === version) return cached;

  const seen = new Set();
  const terms = [];
  for (const raw of Array.isArray(list.terms) ? list.terms : []) {
    const { include, excludes: excludeText } = splitExclusions(String(raw ?? ""));
    const excludes = excludeText.flatMap((text) => compileVariants(text));
    // Normalised tokens never contain "|", so it separates the two halves of
    // the dedupe key without "a b" colliding with "a" excluding "b".
    const signature = excludes.map((e) => e.tokens.join(" ")).join("|");

    const variants = [];
    for (const variant of compileVariants(include)) {
      const key = `${variant.tokens.join(" ")}|${signature}`;
      if (seen.has(key)) continue;
      seen.add(key);
      variants.push(variant);
    }
    if (variants.length > 0) terms.push({ raw: String(raw).trim(), variants, excludes });
  }

  const entry = { id: list.id, version, terms };
  _compiled.set(list.id, entry);
  return entry;
}

/**
 * Resolve a search's list ids against the stored lists and compile them.
 * Ids that no longer exist are skipped — a deleted list contributes no terms
 * rather than causing the search to match nothing.
 *
 * @param {string[]} listIds
 * @param {Object[]} allLists
 * @returns {Object[]} compiled lists
 */
function compileLists(listIds, allLists) {
  if (!Array.isArray(listIds) || listIds.length === 0) return [];
  const compiled = [];
  for (const id of listIds) {
    const list = (allLists || []).find((l) => l && l.id === id);
    if (list) compiled.push(compileList(list));
  }
  return compiled;
}

/**
 * Total number of usable terms across compiled lists. Callers use this to
 * decide whether include-filtering applies at all — zero terms means "no
 * filter", never "match nothing".
 *
 * @param {Object[]} compiledLists
 * @returns {number}
 */
function countTerms(compiledLists) {
  return compiledLists.reduce((n, l) => n + l.terms.length, 0);
}

/**
 * Find which terms from the compiled lists match a listing title.
 *
 * Cost is O(items × terms) per poll — roughly 100k short-string comparisons for
 * a 50-item page against a 2000-term list, which is a few milliseconds.
 *
 * @param {string} title
 * @param {Object[]} compiledLists
 * @returns {string[]} matched terms, in their original form, deduplicated
 */
function matchTitle(title, compiledLists) {
  const norm = normalise(title);
  if (!norm) return [];

  const titleTokens = norm.split(" ");
  const titleTokenSet = new Set(titleTokens);
  const titleSquashed = titleTokens.join("");

  // Offsets in `titleSquashed` where a token begins and ends. A squashed match
  // is only accepted when it lines up with both, which is what stops
  // "finalfantasyvii" from matching inside "finalfantasyviii".
  const starts = new Set();
  const ends = new Set();
  let offset = 0;
  for (const token of titleTokens) {
    starts.add(offset);
    offset += token.length;
    ends.add(offset);
  }

  const hits = (variant) =>
    hasAllTokens(titleTokenSet, variant.tokens) || hasSquashedRun(titleSquashed, starts, ends, variant.squashed);

  const matched = new Set();
  for (const list of compiledLists) {
    for (const term of list.terms) {
      // Exclusions are only worth checking once the term itself has matched.
      if (term.variants.some(hits) && !term.excludes.some(hits)) matched.add(term.raw);
    }
  }
  return [...matched];
}

/**
 * True when `needle` occurs in `haystack` starting at a token boundary and
 * ending at one — i.e. it spans whole tokens, only the spacing differs.
 */
function hasSquashedRun(haystack, starts, ends, needle) {
  if (!needle) return false;
  let i = haystack.indexOf(needle);
  while (i !== -1) {
    if (starts.has(i) && ends.has(i + needle.length)) return true;
    i = haystack.indexOf(needle, i + 1);
  }
  return false;
}

/**
 * True when every one of `termTokens` appears in the title. Order and adjacency
 * are not required — "soul reaver legacy kain" matches "Legacy of Kain: Soul
 * Reaver", and intervening words like "The" are ignored.
 */
function hasAllTokens(titleTokenSet, termTokens) {
  if (termTokens.length === 0) return false;
  for (const token of termTokens) {
    if (!titleTokenSet.has(token)) return false;
  }
  return true;
}

/**
 * Drop a list from the compiled cache (called when a list is deleted).
 */
function invalidateCompiled(listId) {
  _compiled.delete(listId);
}

module.exports = {
  MAX_TERM_VARIANTS,
  normalise,
  expandAlternatives,
  splitExclusions,
  compileList,
  compileLists,
  countTerms,
  matchTitle,
  invalidateCompiled,
};
