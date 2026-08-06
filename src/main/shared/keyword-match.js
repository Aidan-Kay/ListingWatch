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
// stays a plain comparison; only compilation knows about the syntax. Options
// may be separated by "|" or by "," so a query copied off eBay works unchanged.
//
// Quoting part of a term makes it a phrase: "The Legend of Zelda" only matches
// titles carrying those words together and in that order, which is the escape
// hatch from rule 1's order-free recall when a term's words would otherwise be
// satisfied by different parts of a bundle listing. A phrase is checked by
// rule 2 alone — that rule already tests a contiguous run against whole tokens,
// so adjacency and order come for free and spacing variants keep working
// ("FIFA 21" still finds FIFA21). Words outside the quotes stay loose, so
// '"paper mario" thousand year door' constrains only the part that needed it.
//
// A term may also carry exclusions, written as a leading "-" on a word:
// "Super Mario Party -Jamboree" matches "Super Mario Party - Nintendo Switch"
// but not "Super Mario Party Jamboree". Exclusions are matched by the same
// rules as the term itself — including phrases, as in -"breath of the wild" —
// and any one of them hitting rejects the whole term (other terms in the list
// are unaffected). This is the counterpart to a search's exclude-keywords, but
// scoped to the one term that needs it.
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
 * Index just past the phrase opening at `open`, i.e. one past its closing
 * quote. An unterminated quote runs to the end of the text.
 *
 * Every parser here treats a quoted stretch as opaque, so "(", ")", "|", ","
 * and "-" inside a phrase are the characters they look like rather than
 * syntax — '"Rock, Paper, Scissors"' is one phrase, not three alternatives.
 *
 * @param {string} text
 * @param {number} open index of the opening quote
 * @returns {number}
 */
function endOfPhrase(text, open) {
  const close = text.indexOf('"', open + 1);
  return close === -1 ? text.length : close + 1;
}

/**
 * Index of the ")" closing the group opened at `open`, or -1 if there isn't
 * one. Quoted stretches are skipped so '("a)b", c)' closes in the right place.
 */
function endOfGroup(text, open) {
  let i = open + 1;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '"') {
      i = endOfPhrase(text, i);
      continue;
    }
    if (ch === ")") return i;
    i++;
  }
  return -1;
}

/**
 * Split a group's body into its alternatives. Both "|" and "," separate, since
 * eBay writes groups as "(a,b)" and copying one over should just work; a
 * separator inside a quoted phrase is part of that phrase.
 *
 * @param {string} body
 * @returns {string[]}
 */
function splitOptions(body) {
  const options = [];
  let current = "";
  let i = 0;

  while (i < body.length) {
    const ch = body[i];
    if (ch === '"') {
      const end = endOfPhrase(body, i);
      current += body.slice(i, end);
      i = end;
      continue;
    }
    if (ch === "|" || ch === ",") {
      options.push(current);
      current = "";
      i++;
      continue;
    }
    current += ch;
    i++;
  }
  options.push(current);

  return options.map((o) => o.trim()).filter(Boolean);
}

/**
 * Expand alternation groups into concrete term strings.
 *
 *   "Final Fantasy (7|VII)"      -> ["Final Fantasy 7", "Final Fantasy VII"]
 *   "Final Fantasy (7,VII)"      -> the same two
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
    if (ch === '"') {
      // Carried through whole — parsePhrases picks it up after expansion.
      const end = endOfPhrase(text, i);
      literal += text.slice(i, end);
      i = end;
      continue;
    }
    if (ch !== "(") {
      literal += ch;
      i++;
      continue;
    }

    const close = endOfGroup(text, i);
    if (close === -1) {
      // Unmatched opener — treat the rest as literal text.
      literal += text.slice(i);
      break;
    }

    const options = splitOptions(text.slice(i + 1, close));
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
 * excluded chunk runs to the next top-level space, so an alternation group or a
 * quoted phrase comes along whole: "-(Jamboree|Superstars)", or
 * -"breath of the wild" to reject only that exact sequence.
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
    if (text[i] === '"') {
      // A "-" inside a phrase is part of what the user is matching on.
      const end = endOfPhrase(text, i);
      include += text.slice(i, end);
      i = end;
      continue;
    }

    const opensWord = i === 0 || /\s/.test(text[i - 1]);
    const next = text[i + 1];
    if (text[i] !== "-" || !opensWord || !next || /\s/.test(next)) {
      include += text[i];
      i++;
      continue;
    }

    // Consume up to the next space outside an alternation group or a phrase.
    let j = i + 1;
    let depth = 0;
    while (j < text.length) {
      const ch = text[j];
      if (ch === '"') {
        j = endOfPhrase(text, j);
        continue;
      }
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
 * Separate the quoted phrases of a term from the rest of its words.
 *
 *   '"paper mario" thousand year door'
 *     -> { loose: " thousand year door", phrases: ["paper mario"] }
 *
 * An unterminated quote is treated as ordinary text rather than as a phrase
 * running to the end of the term — the same forgiving reading unmatched "("
 * gets, and the one that costs a user the fewest listings when they typo.
 *
 * @param {string} text
 * @returns {{loose: string, phrases: string[]}}
 */
function parsePhrases(text) {
  const phrases = [];
  let loose = "";
  let i = 0;

  while (i < text.length) {
    if (text[i] !== '"') {
      loose += text[i];
      i++;
      continue;
    }
    const close = text.indexOf('"', i + 1);
    if (close === -1) {
      loose += ` ${text.slice(i + 1)}`;
      break;
    }
    phrases.push(text.slice(i + 1, close));
    i = close + 1;
  }

  return { loose, phrases };
}

/**
 * Expand a piece of term text into its matchable variants, dropping any that
 * normalise to nothing or repeat one already produced here.
 *
 * `squashed` is only meaningful when the variant has no phrases: with phrases
 * present, matching tests each phrase separately (see matchTitle) rather than
 * the variant as one run, because the loose words may sit anywhere.
 *
 * @param {string} text
 * @returns {{tokens: string[], squashed: string, phrases: string[]}[]}
 */
function compileVariants(text) {
  const variants = [];
  const seen = new Set();
  for (const candidate of expandAlternatives(text)) {
    const { loose, phrases } = parsePhrases(candidate);
    const norm = normalise(loose);
    const tokens = norm ? norm.split(" ") : [];
    // A phrase is held squashed: hasSquashedRun is what enforces adjacency.
    const phraseForms = [];
    for (const phrase of phrases) {
      const squashed = normalise(phrase).split(" ").join("");
      if (squashed) phraseForms.push(squashed);
    }
    if (tokens.length === 0 && phraseForms.length === 0) continue;

    const key = variantKey({ tokens, phrases: phraseForms });
    if (seen.has(key)) continue;
    seen.add(key);
    variants.push({ tokens, squashed: tokens.join(""), phrases: phraseForms });
  }
  return variants;
}

/**
 * Identity of a compiled variant, for dedupe. Normalised tokens are `[a-z0-9 ]`
 * and phrases are squashed, so "#" cannot occur in either half.
 */
function variantKey(variant) {
  return `${variant.phrases.join(",")}#${variant.tokens.join(" ")}`;
}

/**
 * Split raw text into terms: one per line, or comma-separated.
 *
 * A comma only separates at the top level. Inside an alternation group it is an
 * option separator ("(7,VII)") and inside a phrase it is punctuation, so
 * neither gets torn in half here. A newline always separates, even mid-phrase —
 * an unclosed quote is far more likely to be a typo than a term spanning lines.
 *
 * The renderer keeps its own copy of this (it loads plain scripts and cannot
 * require this module); the two need to agree.
 *
 * @param {string} text
 * @returns {string[]}
 */
function splitTerms(text) {
  const str = String(text ?? "");
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
    // A variant key never contains "|", so it separates the two halves of the
    // dedupe key without "a b" colliding with "a" excluding "b".
    const signature = excludes.map(variantKey).join("|");

    const variants = [];
    for (const variant of compileVariants(include)) {
      const key = `${variantKey(variant)}|${signature}`;
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

  const hits = (variant) => {
    // Without phrases, either rule may carry the variant on its own.
    if (variant.phrases.length === 0) {
      return hasAllTokens(titleTokenSet, variant.tokens) || hasSquashedRun(titleSquashed, starts, ends, variant.squashed);
    }
    // With them, every phrase has to land as a contiguous run of whole tokens —
    // rule 1 is off for the quoted part, which is the point of quoting it — and
    // any words left outside the quotes still just have to be present.
    for (const phrase of variant.phrases) {
      if (!hasSquashedRun(titleSquashed, starts, ends, phrase)) return false;
    }
    return variant.tokens.length === 0 || hasAllTokens(titleTokenSet, variant.tokens);
  };

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
  parsePhrases,
  splitTerms,
  compileList,
  compileLists,
  countTerms,
  matchTitle,
  invalidateCompiled,
};
