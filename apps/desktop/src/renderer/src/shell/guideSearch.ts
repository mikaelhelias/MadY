/**
 * Searching the manual — ranked, over the function index and the chapters.
 *
 * A plain whole-section substring filter (`sectionText(s).includes(query)`) has two
 * shortcomings. It cannot rank — "axis" hides the chapter on axes among the eight others that
 * happen to say the word once — and it can only match words the prose literally contains, so a
 * reader searching "color" or "scale" or "spreadsheet" finds nothing even when the feature exists.
 *
 * This answers the question directly: typing "axis" must say where axis tuning is. So
 * the index (`guideIndex.ts`) is searched first and its hits lead, each carrying its route; the
 * chapters follow, for the reader who wants the explanation rather than the control.
 *
 * Three rules, all of them deliberate:
 *
 *  1. **AND of terms, in any order** — the Ctrl+K rule (`CommandPalette.tsx`). "export png"
 *     must find the one thing that is both, not everything that is either.
 *  2. **Word-prefix, not substring.** "cat" matching "duplicate" is noise; "cat" matching
 *     "categories" is what someone typing three letters wants. A term matches at the start of
 *     any word (or the whole field).
 *  3. **Synonyms are the user's words, not the program's.** The manual says "datasheet"; people type
 *     "spreadsheet", "table", "sheet". A table of those is the difference between a search box
 *     that works and one people stop using.
 *
 * Pure — no React, no DOM — so the ranking is testable on its own.
 */
import { GUIDE, stepTexts, type GuideBlock, type GuideSection } from "./guide";
import { guideIndex, whereLine, type GuideEntry } from "./guideIndex";
import { howTosBySurface } from "./howTo";

/**
 * The words a reader types → the words the program uses. Both directions: entering either
 * word searches for both, because there is no way to know which side of the pair someone
 * learned first.
 *
 * Keep these to genuine synonyms. A loose association ("plot" → "significance") pollutes
 * every result and cannot be un-learned by the reader.
 */
export const SYNONYMS: string[][] = [
  ["axis", "axes", "scale", "ticks", "range", "gridlines", "grid"],
  // Note: "palette" is deliberately absent, though it is a colour word: expanding "colour" to it
  // would put the command palette second in the results for "colour". Someone typing "palette"
  // still lands on the Colour scheme section, which carries the word as a keyword — the useful
  // direction is kept and the collision avoided.
  ["colour", "color", "colours", "colors", "hue"],
  ["datasheet", "table", "sheet", "spreadsheet", "data"],
  ["graph", "chart", "plot", "figure"],
  ["remove", "delete", "clear"],
  // Not "image": it would expand "export" onto the Inspector's Image section (a picture used as
  // a panel), which would outrank the PNG format for "export png". The export entries carry "picture"
  // as their own keyword instead.
  ["export", "save as", "png", "svg", "pdf"],
  ["error bar", "sd", "sem", "ci", "confidence interval", "errorbar"],
  ["exclude", "omit", "ignore", "hide"],
  ["legend", "key"],
  ["font", "typeface", "text size", "type"],
  ["symbol", "marker", "point", "shape"],
  ["line", "stroke", "curve"],
  ["p value", "significance", "stars", "asterisk", "brackets"],
  ["undo", "revert", "mistake"],
  ["import", "open", "load", "read"],
  ["annotation", "annotate", "label", "note", "callout"],
  ["panel", "layout", "montage", "multi-panel", "composite"],
  ["preset", "theme", "style", "look"],
];

/** term → every term it should also search for (including itself). */
const EXPANSION: Map<string, string[]> = (() => {
  const m = new Map<string, string[]>();
  for (const group of SYNONYMS)
    for (const word of group) {
      const have = m.get(word) ?? [word];
      m.set(word, [...new Set([...have, ...group])]);
    }
  return m;
})();

/** Split a query into lower-case terms. */
export function terms(query: string): string[] {
  return query.toLowerCase().split(/\s+/).filter(Boolean);
}

/**
 * Does `term` start a word in `text`? Prefix rather than substring, so three letters find
 * "categories" without also finding "duplicate".
 */
export function wordPrefix(text: string, term: string): boolean {
  const hay = text.toLowerCase();
  let at = hay.indexOf(term);
  while (at >= 0) {
    // A word boundary is the start of the string or anything that is not a letter or digit —
    // so "error bar" is found by "bar", and "log₁₀" by "log".
    if (at === 0 || !/[a-z0-9]/.test(hay[at - 1]!)) return true;
    at = hay.indexOf(term, at + 1);
  }
  // …and the other way round: a word in the text can be the start of the term. "gridlines" has
  // to reach the section called "Grid, frame & axes", or the reader's plural finds everything
  // except the control. Four characters minimum, or every three-letter word in a description
  // would claim every long word that happens to begin with it.
  for (const word of hay.split(/[^a-z0-9]+/))
    if (word.length >= 4 && term.length > word.length && term.startsWith(word)) return true;
  return false;
}

/**
 * How well one term hits one field: 0 nothing · 1 through a synonym · 2 the word as typed.
 *
 * The distinction matters. Without it, "gridlines" would put the axis groups (Scale, Range,
 * Ticks — reached only because they share a synonym group with "grid") above "Grid, frame &
 * axes", the section that actually owns gridlines: all five would score the same, and the tie
 * would fall to whichever name was shortest. A synonym is a guess about what someone meant; the word they typed is not.
 */
function termHit(field: string, term: string): 0 | 1 | 2 {
  if (wordPrefix(field, term)) return 2;
  for (const t of EXPANSION.get(term) ?? []) if (t !== term && wordPrefix(field, t)) return 1;
  return 0;
}

/** Whether a term reaches a field at all (directly or through a synonym). */
function termHits(field: string, term: string): boolean {
  return termHit(field, term) > 0;
}

/**
 * The weights. A hit on a name is what the reader typed; a hit in a body paragraph is a
 * coincidence until several of them line up. The gap between 10 and 1 is what makes "axis"
 * put the Axis controls above the eight chapters that mention an axis in passing.
 */
export const WEIGHTS = {
  entryName: 10,
  entryKeywords: 8,
  entryWhere: 6,
  sectionTitle: 6,
  sectionKeywords: 5,
  entryWhat: 3,
  sectionSummary: 3,
  sectionBody: 1,
} as const;

/** A weighted bag of fields to score one candidate against. */
type Field = { text: string; weight: number };

/**
 * Score a candidate: every term must hit something (the AND rule), and the score is the sum of
 * the best weight each term reached. A term matching a heavy field twice does not out-rank two
 * terms matching two fields — otherwise a chapter that repeats one word wins every search.
 */
function score(fields: Field[], q: string[]): number {
  let total = 0;
  for (const term of q) {
    let best = 0;
    for (const f of fields) {
      const hit = termHit(f.text, term);
      // A synonym scores one below the word as typed, so an exact hit on a heavier field always
      // wins and an exact hit on the same field wins the tie.
      if (hit > 0) best = Math.max(best, f.weight - (hit === 1 ? 1 : 0));
    }
    if (best === 0) return 0; // this term is nowhere — the candidate is out
    total += best;
  }
  return total;
}

/** Everything in a section a search should look at, weighted. */
function sectionFields(s: GuideSection): Field[] {
  return [
    { text: s.title, weight: WEIGHTS.sectionTitle },
    { text: (s.keywords ?? []).join(" "), weight: WEIGHTS.sectionKeywords },
    { text: s.summary, weight: WEIGHTS.sectionSummary },
    { text: blockText(s.blocks), weight: WEIGHTS.sectionBody },
  ];
}

function entryFields(e: GuideEntry): Field[] {
  return [
    { text: e.name, weight: WEIGHTS.entryName },
    { text: (e.keywords ?? []).join(" "), weight: WEIGHTS.entryKeywords },
    { text: e.where.map(whereLine).join(" "), weight: WEIGHTS.entryWhere },
    { text: e.what, weight: WEIGHTS.entryWhat },
  ];
}

/** Every readable string in a section's blocks. */
export function blockText(blocks: GuideBlock[]): string {
  const parts: string[] = [];
  for (const b of blocks) {
    if (b.kind === "p" || b.kind === "note" || b.kind === "goal" || b.kind === "h") parts.push(b.text);
    else if (b.kind === "ul") parts.push(...b.items);
    else if (b.kind === "steps") parts.push(...stepTexts(b));
    // A reference table is prose to a reader searching for a control name.
    else if (b.kind === "table") parts.push(...b.head, ...b.rows.flat());
    else if (b.kind === "keys") parts.push(...b.rows.map((r) => `${r.keys} ${r.what}`));
    else if (b.kind === "shot" || b.kind === "video") parts.push(b.caption, b.alt);
    // The how-to rows are this chapter's body — the prose a reader scrolls through. Leaving them
    // out would make a chapter such as Axis look almost empty to the chapter search, because
    // most of what it says lives in `howTo.ts`.
    else if (b.kind === "howto")
      for (const g of howTosBySurface(b.surface)) {
        parts.push(g.group);
        for (const r of g.rows) parts.push(r.name, r.what, r.how, r.only ?? "", ...(r.keywords ?? []));
      }
    // "cite" is rendered from the running version and carries no text of its own.
  }
  return parts.join(" ");
}

export interface FunctionHit {
  kind: "function";
  entry: GuideEntry;
  score: number;
}
export interface ChapterHit {
  kind: "chapter";
  section: GuideSection;
  score: number;
  /** The sentence the query matched, for the result list. Empty when only the title matched. */
  snippet: string;
}
export type Hit = FunctionHit | ChapterHit;

export interface GuideResults {
  functions: FunctionHit[];
  chapters: ChapterHit[];
}

/**
 * The first sentence-ish run of body text carrying one of the terms — what the reader sees
 * under a chapter hit so they can tell whether it is the paragraph they wanted.
 */
export function snippetFor(s: GuideSection, q: string[]): string {
  const sentences = blockText(s.blocks).split(/(?<=[.!?])\s+/);
  for (const sentence of sentences) if (q.every((t) => termHits(sentence, t))) return sentence.trim();
  // No single sentence has all the terms — fall back to one carrying any of them, then to
  // nothing (the summary is already shown above the snippet, so repeating it says nothing).
  for (const sentence of sentences) if (q.some((t) => termHits(sentence, t))) return sentence.trim();
  return "";
}

/**
 * Search the manual. Functions first (the "where is it" answer), chapters after (the "how does
 * it work" answer). An empty query returns nothing — the caller shows the contents list, which
 * is a better landing page than a long list of unranked chapters.
 */
export function searchGuide(query: string): GuideResults {
  const q = terms(query);
  if (q.length === 0) return { functions: [], chapters: [] };

  const functions: FunctionHit[] = [];
  for (const e of guideIndex()) {
    const s = score(entryFields(e), q);
    if (s > 0) functions.push({ kind: "function", entry: e, score: s });
  }
  const chapters: ChapterHit[] = [];
  for (const sec of GUIDE) {
    const s = score(sectionFields(sec), q);
    if (s > 0) chapters.push({ kind: "chapter", section: sec, score: s, snippet: snippetFor(sec, q) });
  }

  // Ties broken by name length: with "bar" scoring the same on both, "Bar chart" is a better
  // answer than "Bar chart with error bars and a connecting ribbon".
  const byScore = (a: { score: number }, b: { score: number }): number => b.score - a.score;
  functions.sort((a, b) => byScore(a, b) || a.entry.name.length - b.entry.name.length);
  chapters.sort((a, b) => byScore(a, b) || a.section.title.length - b.section.title.length);
  return { functions, chapters };
}

/** One row of the short "In the manual" list — a place to open, and two lines to say why. */
export interface ManualHit {
  id: string;
  name: string;
  /** What the control does, or what the chapter covers. */
  where: string;
  /** Where to land: a function's entry, or a chapter. Same shape as `GuideTarget`. */
  target: { entry?: string | undefined; section?: string | undefined };
}

/**
 * The short "In the manual" list that Ctrl+K and the Ask bar both show under what you typed —
 * one function, so the two boxes cannot rank or de-duplicate differently from each other, or
 * from the Documentation tab (it is `searchGuide` underneath).
 *
 * Functions first (the "where is it" answer), chapters after, never more than `limit` rows,
 * and nothing under two characters — one letter matches half the manual.
 *
 * Two things are dropped, both measured on "export":
 *  1. an entry for a command the caller is already offering (`exclude`: the palette passes the
 *     ids of the actions it lists). The row above runs it; a second row pointing at its
 *     documentation is noise. `action:export-repro` and `tool:save` both carry the action's
 *     own id after the colon. (A command that is currently disabled is not in the palette's
 *     list, so the manual still explains it — exactly when a reader most needs it.)
 *  2. a name already listed. `action:export` and `tool:export` are both "Export", and two
 *     identical rows are a bug to look at whatever the ids say.
 */
export function manualHits(query: string, opts: { exclude?: Set<string>; limit?: number } = {}): ManualHit[] {
  if (query.trim().length < 2) return [];
  const limit = opts.limit ?? 5;
  const exclude = opts.exclude ?? new Set<string>();
  const res = searchGuide(query);
  const seen = new Set<string>();
  const out: ManualHit[] = [];
  for (const h of res.functions) {
    const owner = /^(action|tool):(.+)$/.exec(h.entry.id)?.[2];
    if (owner && exclude.has(owner)) continue;
    if (seen.has(h.entry.name)) continue;
    seen.add(h.entry.name);
    out.push({ id: h.entry.id, name: h.entry.name, where: h.entry.what, target: { entry: h.entry.id } });
    if (out.length >= limit) return out;
  }
  for (const h of res.chapters) {
    if (seen.has(h.section.title)) continue;
    seen.add(h.section.title);
    out.push({ id: `sec:${h.section.id}`, name: h.section.title, where: h.section.summary, target: { section: h.section.id } });
    if (out.length >= limit) return out;
  }
  return out;
}

/**
 * Split `text` into runs for display, marking the runs that a query term starts — the same
 * word-prefix rule the search matches by, so what is marked is what matched. Case is kept from
 * the text; the comparison ignores it. "Axis break" over "Breaks (cuts)" → [Break][s (cuts)].
 *
 * Pure and React-free so it can be tested as data; the Ask bar wraps `hit` runs in <mark>.
 */
export function markSegments(text: string, query: string): { text: string; hit: boolean }[] {
  const ts = terms(query).filter((t) => /[a-z0-9]/.test(t));
  if (ts.length === 0 || !text) return [{ text, hit: false }];
  const hay = text.toLowerCase();
  const out: { text: string; hit: boolean }[] = [];
  let i = 0;
  let plain = "";
  while (i < hay.length) {
    const atWordStart = i === 0 || !/[a-z0-9]/.test(hay[i - 1]!);
    const t = atWordStart ? ts.find((term) => hay.startsWith(term, i)) : undefined;
    if (t) {
      if (plain) out.push({ text: plain, hit: false });
      plain = "";
      out.push({ text: text.slice(i, i + t.length), hit: true });
      i += t.length;
    } else {
      plain += text[i];
      i += 1;
    }
  }
  if (plain) out.push({ text: plain, hit: false });
  return out;
}
