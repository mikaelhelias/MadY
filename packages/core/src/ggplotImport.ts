/**
 * Importing a ggplot script — the declarative subset, translated; everything else refused with a reason.
 *
 * A ggplot script is R code. MadY has no R, so nothing here computes: the chain
 * `ggplot(data, aes(…)) + geom_*() + scale_*() + coord_*() + labs() + theme_*()` is read as a
 * description of a figure and mapped onto a MadY plot kind, its options, and the styles of its
 * series. The script usually points at a dataset it does not carry (as most of the example
 * scripts in `docs/ggplot-corpus/` do), so the flow is script → report → the user picks a
 * datasheet → `bindGgplot` reshapes that sheet into the wide form MadY draws.
 *
 * The central rule: every call and every `aes()` argument lands in the report as `honoured` /
 * `approximated` (with what changed) / `refused` (with why), and the report is shown before the
 * graph exists. A silent mistranslation is worse than a refusal — the user may publish it.
 *
 * Three further rules, all applied here:
 *  1. the theme's preset is applied first, the script's own scales after (the preset's colour
 *     pass would otherwise replace a `scale_fill_gradient2`);
 *  2. scales the script does not mention are pinned to linear — never left to the suggester;
 *  3. `geom_bar` has no replicate dots and flat corners — MadY's defaults (replicate dots, rounded
 *     corners) are the opposite, so the translator writes them.
 */
import type { CellValue, Column, DataTable, LineDash, Plot, PlotKind, Row, SeriesStyle, SymbolShape, TableKind } from "./model";

// ── R surface syntax ────────────────────────────────────────────────────────────────────────

export interface RArg {
  /** `key = value` → key; a positional argument → null. */
  key: string | null;
  /** The raw value text, trimmed (`"red"`, `factor(cyl)`, `c(1, 2)`). */
  value: string;
}

export interface RCall {
  name: string;
  args: RArg[];
  raw: string;
}

/** Split on `sep` at nesting depth 0, respecting quotes. */
export function splitTop(s: string, sep: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  let quote: string | null = null;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!;
    if (quote) {
      cur += ch;
      if (ch === "\\" && i + 1 < s.length) { cur += s[++i]; continue; }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "\"" || ch === "'") { quote = ch; cur += ch; continue; }
    if (ch === "(" || ch === "[" || ch === "{") depth++;
    else if (ch === ")" || ch === "]" || ch === "}") depth--;
    if (ch === sep && depth === 0) { out.push(cur); cur = ""; } else cur += ch;
  }
  out.push(cur);
  return out.map((x) => x.trim()).filter((x) => x !== "");
}

/** `name(args)` → call; anything else → null. */
export function parseCall(expr: string): RCall | null {
  const m = /^([A-Za-z_.][\w.]*(?:::[A-Za-z_.][\w.]*)?)\s*\(([\s\S]*)\)\s*$/.exec(expr.trim());
  if (!m) return null;
  return { name: m[1]!, args: parseArgs(m[2]!), raw: expr.trim() };
}

export function parseArgs(args: string): RArg[] {
  return splitTop(args, ",").map((a) => {
    const m = /^([A-Za-z_.][\w.]*)\s*=(?!=)\s*([\s\S]*)$/.exec(a);
    return m ? { key: m[1]!, value: m[2]!.trim() } : { key: null, value: a.trim() };
  });
}

/** Strip `#` comments (outside quotes), keep newlines. */
export function stripComments(text: string): string {
  return text
    .split("\n")
    .map((line) => {
      let quote: string | null = null;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i]!;
        if (quote) { if (ch === quote) quote = null; continue; }
        if (ch === "\"" || ch === "'") quote = ch;
        else if (ch === "#") return line.slice(0, i);
      }
      return line;
    })
    .join("\n");
}

const unquote = (v: string): string => v.replace(/^["']|["']$/g, "");
const isQuoted = (v: string): boolean => /^["'].*["']$/.test(v);
/** A number, or undefined — not `Number("")`, which is 0: an absent `alpha` would read as
 *  opacity 0 (invisible points), an absent `shape` as pch 0 (a square) and an absent `size` as
 *  width 0, drawing a figure with no points and no lines. */
const numberOf = (v: string | undefined): number | undefined => {
  if (v === undefined || v.trim() === "") return undefined;
  const n = Number(v.replace(/L$/, ""));
  return Number.isFinite(n) ? n : undefined;
};

/**
 * ColorBrewer's qualitative palettes (Cynthia Brewer, Apache 2.0 — https://colorbrewer2.org),
 * so `scale_*_brewer(palette = "Set2")` is honoured, not approximated. The sequential and
 * diverging ones map to MadY ramps in the gradient branch.
 */
const BREWER: Record<string, string[]> = {
  set1: ["#E41A1C", "#377EB8", "#4DAF4A", "#984EA3", "#FF7F00", "#FFFF33", "#A65628", "#F781BF", "#999999"],
  set2: ["#66C2A5", "#FC8D62", "#8DA0CB", "#E78AC3", "#A6D854", "#FFD92F", "#E5C494", "#B3B3B3"],
  set3: ["#8DD3C7", "#FFFFB3", "#BEBADA", "#FB8072", "#80B1D3", "#FDB462", "#B3DE69", "#FCCDE5", "#D9D9D9", "#BC80BD", "#CCEBC5", "#FFED6F"],
  dark2: ["#1B9E77", "#D95F02", "#7570B3", "#E7298A", "#66A61E", "#E6AB02", "#A6761D", "#666666"],
  paired: ["#A6CEE3", "#1F78B4", "#B2DF8A", "#33A02C", "#FB9A99", "#E31A1C", "#FDBF6F", "#FF7F00", "#CAB2D6", "#6A3D9A", "#FFFF99", "#B15928"],
  accent: ["#7FC97F", "#BEAED4", "#FDC086", "#FFFF99", "#386CB0", "#F0027F", "#BF5B17", "#666666"],
  pastel1: ["#FBB4AE", "#B3CDE3", "#CCEBC5", "#DECBE4", "#FED9A6", "#FFFFCC", "#E5D8BD", "#FDDAEC", "#F2F2F2"],
  pastel2: ["#B3E2CD", "#FDCDAC", "#CBD5E8", "#F4CAE4", "#E6F5C9", "#FFF2AE", "#F1E2CC", "#CCCCCC"],
};
/** `c(a, b, c)` → items (raw); a bare value → [value]. */
const vectorOf = (v: string): string[] => {
  const m = /^c\s*\(([\s\S]*)\)$/.exec(v.trim());
  return m ? splitTop(m[1]!, ",") : [v.trim()];
};
/** `seq(a, b, s)` / `seq(a, b, by = s)` → step. */
const seqStep = (v: string): number | undefined => {
  const c = parseCall(v);
  if (!c || c.name !== "seq") return undefined;
  const by = c.args.find((a) => a.key === "by") ?? c.args.filter((a) => a.key === null)[2];
  return by ? numberOf(by.value) : undefined;
};
const arg = (c: RCall, key: string, pos?: number): string | undefined => {
  const k = c.args.find((a) => a.key === key);
  if (k) return k.value;
  if (pos === undefined) return undefined;
  const positional = c.args.filter((a) => a.key === null);
  return positional[pos]?.value;
};

/** From `text`, the full `ggplot(…) + … + …` chain (the last one), with `p <- ggplot(…)` then
 *  `p + …` joined, and `data %>% ggplot(…)` unwrapped. Returns the calls in order. */
export function extractChain(text: string): { calls: RCall[]; dataArg: string | null } {
  const src = stripComments(text);
  // Walk a `+` chain from a `(`: returns [endIndex, callTexts].
  const walk = (from: number): { end: number; parts: string[] } => {
    const parts: string[] = [];
    let i = from;
    for (;;) {
      // read one call: identifier then a balanced (...)
      const startTok = i;
      while (i < src.length && /[\w.:]/.test(src[i]!)) i++;
      while (i < src.length && /\s/.test(src[i]!)) i++;
      if (src[i] !== "(") { return { end: startTok, parts }; }
      let depth = 0;
      let quote: string | null = null;
      let j = i;
      for (; j < src.length; j++) {
        const ch = src[j]!;
        if (quote) { if (ch === "\\") { j++; continue; } if (ch === quote) quote = null; continue; }
        if (ch === "\"" || ch === "'") quote = ch;
        else if (ch === "(") depth++;
        else if (ch === ")") { depth--; if (depth === 0) break; }
      }
      parts.push(src.slice(startTok, j + 1).trim());
      i = j + 1;
      // continue past `+` (with any whitespace / newlines)
      const save = i;
      while (i < src.length && /\s/.test(src[i]!)) i++;
      if (src[i] === "+") { i++; while (i < src.length && /\s/.test(src[i]!)) i++; continue; }
      return { end: save, parts };
    }
  };
  const starts: number[] = [];
  const re = /\bggplot\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) starts.push(m.index);
  if (starts.length === 0) return { calls: [], dataArg: null };
  const start = starts[starts.length - 1]!;
  const head = walk(start);
  let parts = head.parts;
  // `name <- ggplot(...)`: later `name + geom…` statements extend the chain.
  const assign = /([A-Za-z_.][\w.]*)\s*<-\s*$/.exec(src.slice(0, start));
  if (assign) {
    const v = assign[1]!;
    const later = new RegExp(`(^|[\\n;])\\s*${v.replace(/\./g, "\\.")}\\s*\\+\\s*`, "g");
    later.lastIndex = head.end;
    let mm: RegExpExecArray | null;
    while ((mm = later.exec(src))) {
      const w = walk(mm.index + mm[0].length);
      parts = [...parts, ...w.parts];
      later.lastIndex = Math.max(w.end, mm.index + mm[0].length);
    }
  }
  // `data %>% ggplot(aes(...))` / `data |> ggplot(...)`: the data is the piped name.
  const piped = /([A-Za-z_.][\w.]*)\s*(?:%>%|\|>)\s*$/.exec(src.slice(0, start));
  const calls = parts.map(parseCall).filter((c): c is RCall => c !== null);
  const g = calls[0];
  let dataArg: string | null = piped ? piped[1]! : null;
  if (g && g.name === "ggplot") {
    const d = g.args.find((a) => a.key === "data") ?? g.args.find((a) => a.key === null && !a.value.startsWith("aes("));
    if (d) dataArg = d.value;
  }
  return { calls, dataArg };
}

// ── the translation ─────────────────────────────────────────────────────────────────────────

export type Verdict = "honoured" | "approximated" | "refused";

export interface GgplotReportRow {
  /** What the script said (a call, or `aes(key = value)`). */
  call: string;
  verdict: Verdict;
  /** What MadY does with it, or why it cannot. */
  note: string;
}

/** The columns the script's aesthetics name — the contract the chosen datasheet must meet. */
export interface GgplotAes {
  x?: string | undefined;
  y?: string | undefined;
  /** The column that splits the data into series (colour / fill / shape / group — the first). */
  group?: string | undefined;
  groupAes?: string | undefined;
  /** `ymin = y - col` / `ymax = y + col`: the error column. */
  err?: string | undefined;
  /** `ymin = lower`, `ymax = upper`: asymmetric limit columns. */
  lower?: string | undefined;
  upper?: string | undefined;
  /** A tile's fill column (the cell value). */
  fill?: string | undefined;
  /** A column that should order the categories (`reorder(term, estimate)`). */
  sortBy?: string | undefined;
}

/** The wide datasheet shape the binder builds from the user's long sheet. */
export type GgplotShape =
  | "x-series" //   x column + one dataset per group level (replicates / mean ± sd)
  | "groups" //     one column of values per group level (box / violin / column scatter)
  | "matrix" //     rows = y levels, columns = x levels, cells = fill (tile / raster)
  | "values"; //    one value column (histogram)

export interface GgplotTranslation {
  /** The primary geom mapped to a kind — without one there is no graph. */
  ok: boolean;
  kind: PlotKind | undefined;
  geoms: string[];
  shape: GgplotShape;
  aes: GgplotAes;
  report: GgplotReportRow[];
  /** Where the script says its data comes from. */
  data: { name: string | null; file: string | null; computed: boolean; notes: string[] };
  /** The MadY preset the theme maps to (applied FIRST, then `plot` / `series` on top). */
  preset: string | null;
  /** Plot options that need no column ids. */
  plot: Partial<Plot>;
  /** Per-series look, in group-level order (index i → the i-th level), or by level name. */
  series: { colours: string[]; colourByName: Record<string, string>; symbols: SymbolShape[]; every: SeriesStyle };
  /** A title for the datasheet / plot. */
  name: string;
}

const KIND_OF_GEOM: Record<string, { kind: PlotKind; shape: GgplotShape; note: string }> = {
  geom_point: { kind: "xy", shape: "x-series", note: "XY points" },
  geom_line: { kind: "xy", shape: "x-series", note: "XY line" },
  geom_path: { kind: "xy", shape: "x-series", note: "XY line (path order = row order)" },
  geom_area: { kind: "xy", shape: "x-series", note: "XY area" },
  geom_col: { kind: "bar", shape: "x-series", note: "bars at the values given" },
  geom_boxplot: { kind: "box", shape: "groups", note: "box & whisker per group" },
  geom_violin: { kind: "violin", shape: "groups", note: "violin per group" },
  geom_jitter: { kind: "scatter", shape: "groups", note: "column scatter (every value as a dot)" },
  geom_histogram: { kind: "histogram", shape: "values", note: "histogram" },
  geom_tile: { kind: "heatmap", shape: "matrix", note: "heatmap matrix" },
  geom_raster: { kind: "heatmap", shape: "matrix", note: "heatmap matrix" },
  geom_errorbar: { kind: "xy", shape: "x-series", note: "error bars" },
  geom_pointrange: { kind: "xy", shape: "x-series", note: "points with error bars" },
  geom_linerange: { kind: "xy", shape: "x-series", note: "error bars without caps" },
  geom_crossbar: { kind: "xy", shape: "x-series", note: "error bars (no crossbar mark in MadY)" },
};
/** Geoms that decide the kind when present — the structural ones win over points/lines. */
const STRUCTURAL = ["geom_boxplot", "geom_violin", "geom_histogram", "geom_tile", "geom_raster", "geom_col", "geom_bar"];

const THEME_PRESET: Record<string, string> = {
  theme_bw: "MadY default", theme_gray: "MadY default", theme_grey: "MadY default", theme_linedraw: "MadY default",
  theme_classic: "Scientific Journal", theme_minimal: "Editorial", theme_light: "Editorial", theme_void: "Editorial",
  theme_ipsum: "Editorial", theme_ipsum_rc: "Editorial", theme_cowplot: "Scientific Journal", theme_pubr: "Scientific Journal",
};

/** R `pch` numbers → MadY shapes. */
const PCH: Record<number, SymbolShape> = {
  0: "square", 1: "ring", 2: "triangle", 3: "cross", 4: "cross", 5: "diamond", 6: "triangle-down", 8: "star",
  15: "square", 16: "circle", 17: "triangle", 18: "diamond", 19: "circle", 20: "circle", 21: "circle", 22: "square", 23: "diamond", 24: "triangle", 25: "triangle-down",
};

const DASH: Record<string, LineDash> = { dashed: "dashed", dotted: "dotted", dotdash: "dashdot", longdash: "dashed", twodash: "dashdot", solid: "solid" };

/** Read one `aes(...)` argument list into the contract + report rows. */
function readAes(args: RArg[], aes: GgplotAes, report: GgplotReportRow[]): void {
  const positional = ["x", "y"];
  let p = 0;
  for (const a of args) {
    const key = a.key ?? positional[p++] ?? `arg${p}`;
    const v = a.value.trim();
    const say = (verdict: Verdict, note: string): void => { report.push({ call: `aes(${key} = ${v})`, verdict, note }); };
    const col = (expr: string): string | null => {
      const m = /^(?:factor|as\.factor|as\.character)\(\s*([A-Za-z_.][\w.]*)\s*\)$/.exec(expr);
      if (m) return m[1]!;
      return /^[A-Za-z_.][\w.]*$/.test(expr) ? expr : null;
    };
    const k = key === "color" ? "colour" : key;
    if (k === "x" || k === "y") {
      const c = col(v);
      const re = /^reorder\(\s*([A-Za-z_.][\w.]*)\s*,\s*-?\s*([A-Za-z_.][\w.]*)\s*\)$/.exec(v);
      if (c) { aes[k] = c; say("honoured", `${k} = column "${c}"`); }
      else if (re) { aes[k] = re[1]!; aes.sortBy = re[2]!; say("approximated", `${k} = "${re[1]}", categories sorted by "${re[2]}" on import`); }
      else say("refused", `${k} is an expression, not a column — compute it in the datasheet first`);
    } else if (k === "colour" || k === "fill" || k === "shape" || k === "group" || k === "linetype") {
      const c = col(v);
      if (!c) { say("refused", `${k} is an expression, not a column`); continue; }
      if (aes.group && aes.group !== c) { say("approximated", `${k} = "${c}" — series already split by "${aes.group}" (${aes.groupAes}); a second grouping is not drawn`); continue; }
      if (k === "fill" && !aes.group && aes.fill === undefined && false) { /* unreachable */ }
      aes.group = c; aes.groupAes = k;
      say("honoured", `one series per level of "${c}" (${k})`);
    } else if (k === "ymin" || k === "ymax" || k === "xmin" || k === "xmax") {
      const pm = /^([A-Za-z_.][\w.]*)\s*([-+])\s*([A-Za-z_.][\w.]*)$/.exec(v);
      const c = col(v);
      if (pm) { aes.err = pm[3]!; say("honoured", `${k} = ${pm[1]} ${pm[2]} ${pm[3]}: "${pm[3]}" is the error column (drawn as ± SD)`); }
      else if (c) { if (k.endsWith("min")) aes.lower = c; else aes.upper = c; say("honoured", `${k} = column "${c}" (asymmetric limits)`); }
      else say("refused", `${k} is an expression, not a column ± an error column`);
    } else if (k === "size") {
      say("approximated", "size is not mapped — MadY sizes points per series (a bubble chart needs a size column: New graph ▸ Bubble)");
    } else if (k === "alpha") {
      say("approximated", "alpha per row is not mapped; set the series opacity in the Inspector");
    } else if (k === "weight") {
      say("refused", "weighted counts are computed in R");
    } else if (k === "label") {
      say("approximated", `labels from "${v}" — turn on point labels in the Inspector after import`);
    } else if (k === "lower" || k === "middle" || k === "upper") {
      say("refused", "a precomputed five-number box (stat = identity) is not readable — supply the raw values");
    } else {
      say("refused", `aes(${key}) is not a MadY aesthetic`);
    }
  }
}

/** Translate a script. Never throws on R it cannot read — the report says so. */
export function translateGgplot(text: string): GgplotTranslation {
  const report: GgplotReportRow[] = [];
  const src = stripComments(text);
  const { calls, dataArg } = extractChain(text);
  const aes: GgplotAes = {};
  const plot: Partial<Plot> = {};
  const series: GgplotTranslation["series"] = { colours: [], colourByName: {}, symbols: [], every: {} };
  const data: GgplotTranslation["data"] = { name: null, file: null, computed: false, notes: [] };

  // ── the preamble: where the data comes from ──
  const file = /read(?:\.csv|\.csv2|\.table|\.delim|_csv|_tsv|_delim|xlsx|_excel)\s*\(\s*["']([^"']+)["']/.exec(src);
  if (file) { data.file = file[1]!; data.notes.push(`reads "${file[1]}" — pick that file's datasheet (import it first if needed)`); }
  const libs = [...src.matchAll(/library\(\s*["']?([\w.]+)["']?\s*\)/g)].map((m) => m[1]!);
  for (const l of libs) {
    if (["ggplot2", "tidyverse", "dplyr", "plyr", "readr", "tibble", "scales"].includes(l)) continue;
    if (["viridis", "viridisLite", "RColorBrewer", "hrbrthemes", "ggthemes", "cowplot"].includes(l)) data.notes.push(`package ${l}: its palettes / themes map to MadY's nearest`);
    else if (l === "ggpubr") data.notes.push("package ggpubr: p-values come from MadY's own tests after import");
    else data.notes.push(`package ${l}: not known — its layers are refused if used`);
  }
  if (/%>%|\|>|\btransform\(|\bddply\(|\bmutate\(|\bsummarise\(|\bsummarize\(|\bfilter\(|\bsubset\(|\brnorm\(|\brunif\(|\bfunction\s*\(/.test(src)) {
    data.computed = true;
    data.notes.push("the data is prepared by R code MadY cannot run — the datasheet you pick must already hold the prepared table");
  }
  data.name = dataArg;
  if (!dataArg && !file) data.notes.push("the script names no dataset — pick the datasheet to draw");

  // ── the chain ──
  if (calls.length === 0 || calls[0]!.name !== "ggplot") {
    report.push({ call: "ggplot(…)", verdict: "refused", note: "no ggplot() chain found in this script" });
    return { ok: false, kind: undefined, geoms: [], shape: "x-series", aes, report, data, preset: null, plot, series, name: "ggplot import" };
  }
  const g = calls[0]!;
  const gAes = g.args.find((a) => a.value.startsWith("aes(")) ?? g.args.find((a) => a.key === "mapping");
  if (gAes) { const c = parseCall(gAes.value); if (c) readAes(c.args, aes, report); }

  const geoms: string[] = [];
  let kind: PlotKind | undefined;
  let shape: GgplotShape = "x-series";
  let preset: string | null = null;
  let plotAsPoints = false, plotAsLine = false, hasErrorGeom = false, hasJitter = false, hasBox = false;
  const annotations: NonNullable<Plot["annotations"]> = [];
  let annId = 0;
  const say = (c: RCall, verdict: Verdict, note: string): void => { report.push({ call: c.name + "(…)", verdict, note }); };

  // pick the structural geom first, so a jitter over a box reads as a box with points
  const geomCalls = calls.slice(1).filter((c) => c.name.startsWith("geom_") || c.name.startsWith("stat_"));
  const structural = geomCalls.find((c) => STRUCTURAL.includes(c.name));

  for (const c of calls.slice(1)) {
    const n = c.name;
    // layer-local aes
    const la = c.args.find((a) => a.value.startsWith("aes(")) ?? c.args.find((a) => a.key === "mapping");
    if (la && (n.startsWith("geom_") || n.startsWith("stat_"))) { const p = parseCall(la.value); if (p) readAes(p.args, aes, report); }
    if (c.args.some((a) => a.key === "data")) say(c, "refused", "a layer with its own data= frame — MadY draws one datasheet per graph");

    if (n === "geom_bar") {
      geoms.push(n);
      const stat = unquote(arg(c, "stat") ?? "count");
      if (stat === "identity") { kind = "bar"; shape = "x-series"; say(c, "honoured", "bars at the values given"); }
      else { say(c, "refused", "geom_bar counts rows per category in R — make a datasheet of the counts and use geom_col"); continue; }
    } else if (n in KIND_OF_GEOM) {
      const k = KIND_OF_GEOM[n]!;
      geoms.push(n);
      if (n === "geom_jitter") { hasJitter = true; if (structural && structural.name !== "geom_jitter") { say(c, "honoured", "every value as a dot over the " + (structural.name === "geom_boxplot" ? "boxes" : structural.name === "geom_violin" ? "violins" : "bars")); continue; } }
      if (n === "geom_point") plotAsPoints = true;
      if (n === "geom_line" || n === "geom_path") plotAsLine = true;
      if (n === "geom_errorbar" || n === "geom_pointrange" || n === "geom_linerange" || n === "geom_crossbar") { hasErrorGeom = true; if (structural || kind) { say(c, "honoured", "error bars from the ± column"); continue; } }
      if (n === "geom_boxplot") hasBox = true;
      const take = !kind || (STRUCTURAL.includes(n) && !STRUCTURAL.includes(geoms[geoms.length - 2] ?? ""));
      if (take) { kind = k.kind; shape = k.shape; }
      say(c, n === "geom_crossbar" ? "approximated" : "honoured", k.note);
      if (n === "geom_area") series.every = { ...series.every, plotAs: "area" };
    } else if (n === "geom_smooth" || n === "stat_smooth") {
      geoms.push(n);
      const method = unquote(arg(c, "method") ?? "loess");
      if (c.args.some((a) => a.key === "formula")) say(c, "refused", "a smooth with a formula (splines / polynomials) — fit it from Analyze ▸ Nonlinear regression after import");
      else if (method === "lm") say(c, "approximated", "a linear fit: run Analyze ▸ Linear regression on the new graph (MadY draws the line + band from the analysis)");
      else say(c, "approximated", `a ${method} smooth: run Analyze ▸ Nonlinear regression (or LOWESS) on the new graph`);
    } else if (n === "stat_summary") {
      geoms.push(n);
      const fun = arg(c, "fun") ?? arg(c, "fun.y") ?? "";
      if (/mean/.test(fun)) { plotAsLine = plotAsLine || /line/.test(unquote(arg(c, "geom") ?? "")); say(c, "approximated", "the mean per X is what MadY draws for replicates (mean ± error)"); }
      else say(c, "refused", "stat_summary with a custom function is computed in R");
    } else if (n === "stat_compare_means") {
      say(c, "approximated", "p-values come from MadY: run Analyze ▸ t-test / ANOVA on the new graph and the bracket is drawn");
    } else if (n === "geom_hline" || n === "geom_vline") {
      const v = numberOf(arg(c, n === "geom_hline" ? "yintercept" : "xintercept") ?? "");
      const dash = DASH[unquote(arg(c, "linetype") ?? "solid")];
      if (v === undefined) { say(c, "refused", "the intercept is not a number"); continue; }
      annotations.push({ id: `gg-ann-${++annId}`, kind: n === "geom_hline" ? "hline" : "vline", value: v, ...(dash ? { dash } : {}), ...(isQuoted(arg(c, "colour") ?? arg(c, "color") ?? "") ? { color: unquote(arg(c, "colour") ?? arg(c, "color")!) } : {}) });
      say(c, "honoured", `reference line at ${v}`);
    } else if (n === "annotate") {
      const what = unquote(arg(c, "geom", 0) ?? "");
      const label = arg(c, "label");
      if (what === "text" && label && isQuoted(label)) {
        annotations.push({ id: `gg-ann-${++annId}`, kind: "text", label: unquote(label), x: 0.82, y: 0.12 });
        say(c, "approximated", `text "${unquote(label)}" placed near the top-right of the plot (data coordinates are not kept) — drag it`);
      } else say(c, "refused", `annotate("${what}") is not mapped`);
    } else if (n === "facet_wrap" || n === "facet_grid") {
      say(c, "refused", "facets are not imported — make one graph per level and arrange them in a figure (Insert ▸ New layout)");
    } else if (n === "labs") {
      for (const a of c.args) {
        if (!a.key || !isQuoted(a.value) && a.value !== "NULL") continue;
        const v = a.value === "NULL" ? "" : unquote(a.value);
        if (a.key === "title") { plot.name = v; plot.title = v; }
        else if (a.key === "subtitle") plot.subtitle = v;
        else if (a.key === "x") plot.xAxis = { ...plot.xAxis, title: v };
        else if (a.key === "y") plot.yAxis = { ...plot.yAxis, title: v };
      }
      const rest = c.args.filter((a) => a.key && !["title", "subtitle", "x", "y"].includes(a.key)).map((a) => a.key);
      say(c, rest.length ? "approximated" : "honoured", rest.length ? `title / axis titles set; legend titles (${rest.join(", ")}) are the series names in MadY` : "title / axis titles");
    } else if (n === "ggtitle") { const t = arg(c, "label", 0); if (t && isQuoted(t)) { plot.name = unquote(t); plot.title = unquote(t); } say(c, "honoured", "title"); }
    else if (n === "xlab") { const t = arg(c, "label", 0); if (t) plot.xAxis = { ...plot.xAxis, title: t === "NULL" ? "" : unquote(t) }; say(c, "honoured", "X title"); }
    else if (n === "ylab") { const t = arg(c, "label", 0); if (t) plot.yAxis = { ...plot.yAxis, title: t === "NULL" ? "" : unquote(t) }; say(c, "honoured", "Y title"); }
    else if (/^scale_(colou?r|fill)_manual$/.test(n)) {
      const values = arg(c, "values");
      if (!values) { say(c, "refused", "no values ="); continue; }
      const items = vectorOf(values);
      const named = items.map((it) => /^(?:["']([^"']+)["']|([A-Za-z_.][\w.]*))\s*=\s*(["'][^"']+["'])$/.exec(it));
      if (named.every((m) => m)) { for (const m of named) series.colourByName[(m![1] ?? m![2])!] = unquote(m![3]!); }
      else series.colours = items.map(unquote);
      say(c, "honoured", `series colours: ${items.map(unquote).join(", ")}`);
    } else if (/^scale_shape_manual$/.test(n)) {
      const values = arg(c, "values");
      const items = values ? vectorOf(values) : [];
      const range = /^(\d+):(\d+)$/.exec(values ?? "");
      const nums = range ? Array.from({ length: Number(range[2]) - Number(range[1]) + 1 }, (_, i) => Number(range[1]) + i) : items.map((v) => numberOf(v)).filter((v): v is number => v !== undefined);
      series.symbols = nums.map((p) => PCH[p] ?? "circle");
      say(c, "honoured", `series symbols from pch ${nums.join(", ")}`);
    } else if (/^scale_(x|y)_log10$/.test(n)) {
      const ax = n.includes("_x_") ? "xAxis" : "yAxis";
      plot[ax] = { ...plot[ax], scale: "log10" };
      say(c, c.args.some((a) => a.key === "breaks") ? "approximated" : "honoured", c.args.some((a) => a.key === "breaks") ? "log10 axis (ticks at the decades; the custom breaks are not kept)" : "log10 axis");
    } else if (/^scale_(x|y)_(continuous|discrete)$/.test(n)) {
      const ax = n.includes("_x_") ? "xAxis" : "yAxis";
      const lim = arg(c, "limits");
      const br = arg(c, "breaks");
      const patch: NonNullable<Plot["xAxis"]> = { ...plot[ax] };
      const notes: string[] = [];
      if (lim) { const [a, b] = vectorOf(lim).map(numberOf); if (a !== undefined) patch.min = a; if (b !== undefined) patch.max = b; notes.push(`limits ${a} to ${b}`); }
      if (br) { const s = seqStep(br); if (s !== undefined) { patch.majorStep = s; notes.push(`a tick every ${s}`); } else notes.push("custom breaks are not kept"); }
      const trans = unquote(arg(c, "trans") ?? arg(c, "transform") ?? "");
      if (trans === "log10") { patch.scale = "log10"; notes.push("log10"); }
      else if (trans && trans !== "identity") notes.push(`transform "${trans}" is not available`);
      const name = arg(c, "name");
      if (name && isQuoted(name)) patch.title = unquote(name);
      plot[ax] = patch;
      say(c, notes.some((x) => x.includes("not")) ? "approximated" : "honoured", notes.join(", ") || "axis");
    } else if (/^scale_(x|y)_sqrt$/.test(n) || n === "coord_trans" || n === "coord_transform" || /^scale_(x|y)_binned$/.test(n) || /^scale_(x|y)_reverse$/.test(n)) {
      say(c, "refused", "this axis transform is not available (MadY axes are linear, log10, log2, ln, probit)");
    } else if (/^scale_(colou?r|fill)_(viridis|viridis_[cd]|viridis_b)$/.test(n)) {
      plot.heatmap = { ...plot.heatmap, colormap: "viridis" };
      say(c, "honoured", "viridis");
    } else if (/^scale_(colou?r|fill)_gradient2?$/.test(n) || /^scale_(colou?r|fill)_distiller$/.test(n) || /^scale_(colou?r|fill)_gradientn$/.test(n)) {
      const mid = numberOf(arg(c, "midpoint") ?? "");
      const lim = arg(c, "limits");
      const hm: NonNullable<Plot["heatmap"]> = { ...plot.heatmap, colormap: n.endsWith("gradient2") ? "coolwarm" : "blues" };
      if (mid !== undefined) hm.colorMidpoint = mid;
      if (lim) { const [a, b] = vectorOf(lim).map(numberOf); if (a !== undefined) hm.valueMin = a; if (b !== undefined) hm.valueMax = b; }
      plot.heatmap = hm;
      say(c, "approximated", `${n.endsWith("gradient2") ? "diverging (coolwarm)" : "sequential (blues)"} ramp${mid !== undefined ? ` pinned at ${mid}` : ""}${lim ? " with the limits" : ""}; the exact colours are not copied — edit the gradient in the Inspector`);
    } else if (/^scale_(colou?r|fill)_brewer$/.test(n)) {
      const pal = unquote(arg(c, "palette") ?? "");
      const hexes = BREWER[pal.toLowerCase()];
      if (hexes) { series.colours = hexes; say(c, "honoured", `ColorBrewer ${pal}`); }
      else say(c, "approximated", `ColorBrewer "${pal}" is sequential / diverging or unknown — the preset's palette is used for series`);
    } else if (/^scale_(colou?r|fill)_(ordinal|hue|grey|gray|discrete|identity)$/.test(n)) {
      say(c, "approximated", "the preset's palette is used");
    } else if (n === "coord_flip") {
      plot.barOrientation = "horizontal";
      say(c, "honoured", "horizontal (transposed)");
    } else if (n === "coord_fixed" || n === "coord_equal") {
      // A heatmap's cells are square already, and MadY refuses `equalAspect` on a kind whose two
      // axes are not one plane — so say so instead of tripping that refusal.
      if (structural && (structural.name === "geom_tile" || structural.name === "geom_raster")) say(c, "honoured", "square cells (a heatmap's default)");
      else { plot.equalAspect = true; say(c, "honoured", "equal aspect (1:1)"); }
    } else if (n === "coord_cartesian") {
      for (const k of ["xlim", "ylim"] as const) {
        const v = arg(c, k); if (!v) continue;
        const [a, b] = vectorOf(v).map(numberOf);
        const ax = k === "xlim" ? "xAxis" : "yAxis";
        plot[ax] = { ...plot[ax], ...(a !== undefined ? { min: a } : {}), ...(b !== undefined ? { max: b } : {}) };
      }
      say(c, "honoured", "axis range");
    } else if (n === "coord_polar") {
      say(c, "refused", "polar coordinates — use New graph ▸ Pie / Rose / Radar");
    } else if (n in THEME_PRESET) {
      preset = THEME_PRESET[n]!;
      say(c, "approximated", `→ the "${preset}" preset (MadY's nearest look)`);
    } else if (n.startsWith("theme_")) {
      say(c, "refused", `${n} has no MadY equivalent — the default look is kept`);
    } else if (n === "theme") {
      for (const a of c.args) {
        const k = a.key ?? "";
        const v = a.value;
        const row = (verdict: Verdict, note: string): void => { report.push({ call: `theme(${k} = …)`, verdict, note }); };
        if (k === "legend.position") {
          const pos = unquote(v);
          if (pos === "none") { plot.legend = { ...plot.legend, position: "none" }; row("honoured", "no legend"); }
          else if (pos === "top") { plot.legend = { ...plot.legend, position: "top" }; row("honoured", "legend above the plot"); }
          else if (pos === "bottom") { plot.legend = { ...plot.legend, position: "top" }; row("approximated", "legend below → above the plot (MadY has no outside-bottom)"); }
          else if (pos === "right") { plot.legend = { ...plot.legend, position: "right" }; row("honoured", "legend outside right"); }
          else if (pos === "left") { plot.legend = { ...plot.legend, position: "right" }; row("approximated", "legend left → outside right"); }
          else { plot.legend = { ...plot.legend, position: "topright" }; row("approximated", "legend at a coordinate → inside top-right; drag it"); }
        } else if (k === "axis.text.x" || k === "axis.text.y" || k === "axis.text") {
          const ang = /angle\s*=\s*(-?\d+)/.exec(v);
          const size = /size\s*=\s*(\d+)/.exec(v);
          if (ang && k !== "axis.text.y") {
            // A heatmap's column labels are its own (`heatmap.labelRotation`); every other kind rotates its X ticks.
            if (structural && (structural.name === "geom_tile" || structural.name === "geom_raster")) plot.heatmap = { ...plot.heatmap, labelRotation: Number(ang[1]) };
            else plot.xAxis = { ...plot.xAxis, tickRotation: Number(ang[1]) };
          }
          if (size) plot.fonts = { ...plot.fonts, tick: { ...plot.fonts?.tick, size: Number(size[1]) } };
          row(ang || size ? "honoured" : "approximated", [ang ? `tick labels rotated ${ang[1]}°` : "", size ? `tick font ${size[1]} px` : ""].filter(Boolean).join(", ") || "tick label styling beyond angle/size is not kept");
        } else if (k.startsWith("panel.grid")) {
          if (/element_blank/.test(v)) { plot.grid = { ...plot.grid, show: false }; row("honoured", "gridlines off"); }
          else row("approximated", "gridline styling is set by the preset");
        } else if (k === "plot.title") {
          const size = /size\s*=\s*(\d+)/.exec(v);
          if (size) plot.fonts = { ...plot.fonts, title: { ...plot.fonts?.title, size: Number(size[1]) } };
          row(size ? "honoured" : "approximated", size ? `title ${size[1]} px` : "title styling beyond size is not kept");
        } else if (k === "text") {
          const size = /size\s*=\s*(\d+)/.exec(v);
          row("approximated", size ? `base text ${size[1]} px is not applied — set the font sizes in the Inspector after import` : "text styling is set by the preset");
        } else if (k.startsWith("strip.")) row("refused", "facet strips are not imported");
        else if (k === "legend.title") row("approximated", "legend title styling is not kept");
        else if (k === "legend.text") { const size = /size\s*=\s*(\d+)/.exec(v); if (size) plot.fonts = { ...plot.fonts, legend: { ...plot.fonts?.legend, size: Number(size[1]) } }; row(size ? "honoured" : "approximated", size ? `legend font ${size[1]} px` : "legend text styling is not kept"); }
        else if (k.startsWith("axis.title")) { const size = /size\s*=\s*(\d+)/.exec(v); if (size) plot.fonts = { ...plot.fonts, axisTitle: { ...plot.fonts?.axisTitle, size: Number(size[1]) } }; row(size ? "honoured" : "approximated", size ? `axis title font ${size[1]} px` : "axis title styling is not kept"); }
        else if (/element_blank/.test(v) && /axis\.(line|ticks)/.test(k)) row("approximated", "axis lines and ticks are set by the preset");
        else row("refused", `theme(${k}) is not expressible in MadY`);
      }
    } else if (n.startsWith("position_")) {
      // handled on the geom that carries it
    } else if (n === "guides" || n.startsWith("guide_")) {
      say(c, "approximated", "legend guide options are not kept");
    } else if (n.startsWith("geom_") || n.startsWith("stat_")) {
      say(c, "refused", `${n} has no MadY equivalent`);
    } else {
      say(c, "refused", `${n}() is a user function or an extension — MadY cannot run R`);
    }

    // per-geom options that reach the drawing
    if (n.startsWith("geom_")) {
      const pos = arg(c, "position");
      if (pos) {
        const p = /^position_(\w+)/.exec(pos)?.[1] ?? unquote(pos);
        if (p === "dodge" || p === "dodge2") { plot.barLayout = "grouped"; report.push({ call: `${n}(position = ${p})`, verdict: "honoured", note: "grouped (side by side)" }); }
        else if (p === "stack") { plot.barLayout = "stacked"; report.push({ call: `${n}(position = stack)`, verdict: /reverse\s*=\s*T/.test(pos) ? "approximated" : "honoured", note: /reverse\s*=\s*T/.test(pos) ? "stacked (reverse order → reorder the series)" : "stacked" }); }
        else if (p === "fill") { plot.barLayout = "percent"; report.push({ call: `${n}(position = fill)`, verdict: "honoured", note: "stacked to 100 %" }); }
        else if (p === "jitter" || p === "jitterdodge") { hasJitter = true; }
        else if (p !== "identity") report.push({ call: `${n}(position = ${p})`, verdict: "approximated", note: "position adjustment not kept" });
      }
      const colour = arg(c, "colour") ?? arg(c, "color");
      const fill = arg(c, "fill");
      const size = numberOf(arg(c, "size") ?? "");
      const shapeArg = numberOf(arg(c, "shape") ?? "");
      const alpha = numberOf(arg(c, "alpha") ?? "");
      if (n === "geom_col" || n === "geom_bar") {
        if (colour && isQuoted(colour)) series.every = { ...series.every, borderColor: unquote(colour) };
        if (fill && isQuoted(fill)) series.every = { ...series.every, color: unquote(fill) };
      } else if (n === "geom_point" || n === "geom_jitter" || n === "geom_line" || n === "geom_boxplot" || n === "geom_violin") {
        if (colour && isQuoted(colour) && !(hasBox && n === "geom_jitter")) series.every = { ...series.every, color: unquote(colour) };
        if (fill && isQuoted(fill) && (n === "geom_boxplot" || n === "geom_violin")) series.every = { ...series.every, color: unquote(fill) };
        if (size !== undefined && (n === "geom_point" || n === "geom_jitter")) series.every = { ...series.every, symbolSize: Math.max(1, size * 1.6) };
        if (shapeArg !== undefined && PCH[shapeArg]) series.every = { ...series.every, symbol: PCH[shapeArg]! };
        if (alpha !== undefined && n !== "geom_line") series.every = { ...series.every, symbolOpacity: alpha };
        if (n === "geom_line" && size !== undefined) series.every = { ...series.every, lineWidth: size * 1.5 };
      } else if (n === "geom_tile" || n === "geom_raster") {
        if (colour && isQuoted(colour)) plot.heatmap = { ...plot.heatmap, cellBorderColor: unquote(colour), cellBorderWidth: 1 };
      } else if (n === "geom_histogram") {
        const bw = numberOf(arg(c, "binwidth") ?? "");
        const bins = numberOf(arg(c, "bins") ?? "");
        if (bw !== undefined) { plot.histogram = { ...plot.histogram, binWidth: bw }; report.push({ call: "geom_histogram(binwidth)", verdict: "honoured", note: `bin width ${bw}` }); }
        else if (bins !== undefined) { plot.histogram = { ...plot.histogram, bins }; report.push({ call: "geom_histogram(bins)", verdict: "honoured", note: `${bins} bins` }); }
        if (arg(c, "breaks")) report.push({ call: "geom_histogram(breaks)", verdict: "refused", note: "custom bin edges computed in R — set them in the Inspector (Histogram ▸ custom bins)" });
        if (fill && isQuoted(fill)) series.every = { ...series.every, color: unquote(fill) };
        if (colour && isQuoted(colour)) series.every = { ...series.every, borderColor: unquote(colour) };
      }
      for (const o of ["notch", "varwidth", "outlier.shape", "outlier.colour", "outlier.color", "outlier.alpha", "draw_quantiles", "trim", "scale", "adjust", "span", "just", "width", "stroke", "linewidth", "orientation", "na.rm", "se", "method", "height"] as const) {
        if (c.args.some((a) => a.key === o) && !["se", "method", "na.rm", "width", "height"].includes(o)) {
          report.push({ call: `${n}(${o})`, verdict: "approximated", note: o === "outlier.shape" && /NA/.test(arg(c, o) ?? "") ? "outliers hidden — MadY draws them as part of the points" : `${o} is not kept` });
        }
      }
    }
  }

  // ── resolve the kind from what the layers said ──
  if (kind === "xy") {
    if (plotAsPoints && !plotAsLine) series.every = { ...series.every, plotAs: hasErrorGeom ? "points" : "points" };
    else if (plotAsLine && !plotAsPoints) series.every = { ...series.every, plotAs: "line" };
    // error-bar geoms alone → points with error bars
    if (!plotAsPoints && !plotAsLine && hasErrorGeom) series.every = { ...series.every, plotAs: "points" };
  }
  if (kind === "bar") { plot.showBarPoints = false; plot.barShape = "square"; if (!plot.barLayout) plot.barLayout = "grouped"; }
  if (kind === "box" || kind === "violin") { if (hasJitter) plot.showBoxPoints = true; }
  if (kind === "scatter") shape = "groups";
  if (kind === "histogram") shape = "values";
  if (kind === "heatmap") { shape = "matrix"; if (aes.groupAes === "fill" && aes.group) { aes.fill = aes.group; aes.group = undefined; aes.groupAes = undefined; } }
  // rule 2: pin the scales the script did not mention
  if (kind && kind !== "heatmap") {
    if (!plot.xAxis?.scale) plot.xAxis = { ...plot.xAxis, scale: "linear" };
    if (!plot.yAxis?.scale) plot.yAxis = { ...plot.yAxis, scale: "linear" };
  }
  if (annotations.length) plot.annotations = annotations;
  if (plot.title === undefined) plot.showTitle = false;
  const name = plot.name ?? (dataArg ? `ggplot of ${dataArg}` : "ggplot import");
  const ok = kind !== undefined;
  if (!ok && geoms.length === 0) report.push({ call: "(no geom)", verdict: "refused", note: "the chain draws nothing MadY can map — no geom layer was found" });
  return { ok, kind, geoms, shape, aes, report, data, preset, plot, series, name };
}

// ── binding a datasheet to the translation ──────────────────────────────────────────────────

export interface GgplotBinding {
  ok: boolean;
  /** Columns the aesthetics name that the datasheet does not have. */
  missing: string[];
  /** How each aesthetic was matched (column name → datasheet column name). */
  matched: Record<string, string>;
  /** The wide datasheet to adopt (local ids; the document re-ids it). */
  table: DataTable | null;
  /** Styles keyed by the built table's column name (ids change on adoption). */
  seriesStylesByName: Record<string, SeriesStyle>;
  notes: GgplotReportRow[];
}

const norm = (s: string): string => s.trim().toLowerCase().replace(/[\s._-]+/g, "");

/** Find a datasheet column by name, forgiving case / spaces / dots. */
export function matchColumn(table: DataTable, name: string): Column | undefined {
  const exact = table.columns.find((c) => c.name === name);
  if (exact) return exact;
  const n = norm(name);
  return table.columns.find((c) => norm(c.name) === n);
}

const numOrText = (v: CellValue): CellValue => {
  if (v == null) return null;
  if (typeof v === "number") return v;
  const t = v.trim();
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : t;
};

/** Distinct values of a column in first-appearance order (ggplot would sort text levels
 *  alphabetically; the datasheet's own order is kept and the report says so). */
function levels(table: DataTable, col: Column): CellValue[] {
  const seen = new Set<string>();
  const out: CellValue[] = [];
  for (const r of table.rows) {
    const v = numOrText(r.cells[col.id] ?? null);
    if (v == null) continue;
    const k = String(v);
    if (!seen.has(k)) { seen.add(k); out.push(v); }
  }
  return out;
}

export function bindGgplot(t: GgplotTranslation, src: DataTable): GgplotBinding {
  const notes: GgplotReportRow[] = [];
  const matched: Record<string, string> = {};
  const missing: string[] = [];
  const need = (key: keyof GgplotAes): Column | undefined => {
    const name = t.aes[key];
    if (!name) return undefined;
    const c = matchColumn(src, name);
    if (c) matched[name] = c.name; else missing.push(name);
    return c;
  };
  const X = need("x");
  const Y = need("y");
  const G = need("group");
  const ERR = need("err");
  const LO = need("lower");
  const HI = need("upper");
  const FILL = need("fill");
  const SORT = need("sortBy");
  const fail = (): GgplotBinding => ({ ok: false, missing, matched, table: null, seriesStylesByName: {}, notes });
  if (!t.ok) { notes.push({ call: "datasheet", verdict: "refused", note: "nothing to bind — the script has no drawable geom" }); return fail(); }

  let id = 0;
  const cid = (): string => `ggc${++id}`;
  const cols: Column[] = [];
  const rows: Row[] = [];
  let kind: TableKind = "xy";
  const styles: Record<string, SeriesStyle> = {};
  const styleFor = (levelIndex: number, levelName: string): SeriesStyle => {
    const s: SeriesStyle = { ...t.series.every };
    const byName = t.series.colourByName[levelName];
    if (byName) s.color = byName;
    else if (t.series.colours[levelIndex]) s.color = t.series.colours[levelIndex]!;
    if (t.series.symbols[levelIndex]) s.symbol = t.series.symbols[levelIndex]!;
    return s;
  };

  if (t.shape === "values") {
    if (!X) { if (missing.length === 0) missing.push(t.aes.x ?? "x"); return fail(); }
    kind = "column";
    const c = { id: cid(), name: X.name, role: "y" as const };
    cols.push(c);
    for (const r of src.rows) rows.push({ id: `ggr${rows.length + 1}`, cells: { [c.id]: numOrText(r.cells[X.id] ?? null) } });
    notes.push({ call: "datasheet", verdict: "honoured", note: `one column of "${X.name}" values` });
  } else if (t.shape === "groups") {
    const value = Y ?? X;
    const groupCol = G ?? (Y ? X : undefined);
    if (!value) { return fail(); }
    kind = "column";
    if (!groupCol) {
      const c = { id: cid(), name: value.name, role: "y" as const };
      cols.push(c);
      for (const r of src.rows) rows.push({ id: `ggr${rows.length + 1}`, cells: { [c.id]: numOrText(r.cells[value.id] ?? null) } });
      styles[c.name] = styleFor(0, c.name);
    } else {
      const lv = levels(src, groupCol);
      const colOf = new Map<string, Column>();
      lv.forEach((l, i) => { const c = { id: cid(), name: String(l), role: "y" as const }; cols.push(c); colOf.set(String(l), c); styles[c.name] = styleFor(i, c.name); });
      const per = new Map<string, CellValue[]>();
      for (const r of src.rows) {
        const g = numOrText(r.cells[groupCol.id] ?? null); if (g == null) continue;
        const arr = per.get(String(g)) ?? []; arr.push(numOrText(r.cells[value.id] ?? null)); per.set(String(g), arr);
      }
      const n = Math.max(0, ...[...per.values()].map((a) => a.length));
      for (let i = 0; i < n; i++) rows.push({ id: `ggr${i + 1}`, cells: Object.fromEntries(lv.map((l) => [colOf.get(String(l))!.id, per.get(String(l))?.[i] ?? null])) });
      notes.push({ call: "datasheet", verdict: "honoured", note: `${lv.length} group column${lv.length === 1 ? "" : "s"} from "${groupCol.name}" (${lv.map(String).join(", ")}), values down the rows` });
    }
  } else if (t.shape === "matrix") {
    const fillCol = FILL ?? (t.aes.group ? G : undefined);
    if (!X || !Y || !fillCol) { if (!fillCol && missing.length === 0) missing.push(t.aes.fill ?? "fill"); return fail(); }
    const rowsLv = levels(src, Y);
    const colsLv = levels(src, X);
    const lead = { id: cid(), name: Y.name, role: "x" as const };
    cols.push(lead);
    const colOf = new Map<string, Column>();
    for (const l of colsLv) { const c = { id: cid(), name: String(l), role: "y" as const }; cols.push(c); colOf.set(String(l), c); }
    const cell = new Map<string, CellValue>();
    for (const r of src.rows) cell.set(`${String(numOrText(r.cells[Y.id] ?? null))} ${String(numOrText(r.cells[X.id] ?? null))}`, numOrText(r.cells[fillCol.id] ?? null));
    for (const rl of rowsLv) rows.push({ id: `ggr${rows.length + 1}`, cells: { [lead.id]: rl, ...Object.fromEntries(colsLv.map((cl) => [colOf.get(String(cl))!.id, cell.get(`${String(rl)} ${String(cl)}`) ?? null])) } });
    notes.push({ call: "datasheet", verdict: "honoured", note: `${rowsLv.length} × ${colsLv.length} matrix: rows = "${Y.name}", columns = "${X.name}", cells = "${fillCol.name}"` });
  } else {
    // x-series
    if (!X || !Y) return fail();
    const lead = { id: cid(), name: X.name, role: "x" as const };
    cols.push(lead);
    const xs = levels(src, X);
    const xOrder = [...xs];
    if (SORT) {
      const score = new Map<string, number>();
      for (const r of src.rows) { const x = numOrText(r.cells[X.id] ?? null); const s = numOrText(r.cells[SORT.id] ?? null); if (x != null && typeof s === "number") score.set(String(x), s); }
      xOrder.sort((a, b) => (score.get(String(a)) ?? 0) - (score.get(String(b)) ?? 0));
    }
    const lv = G ? levels(src, G) : [null];
    // observations per (x, level)
    const obs = new Map<string, CellValue[]>();
    const errOf = new Map<string, CellValue>();
    const loOf = new Map<string, CellValue>();
    const hiOf = new Map<string, CellValue>();
    for (const r of src.rows) {
      const x = numOrText(r.cells[X.id] ?? null); if (x == null) continue;
      const g = G ? numOrText(r.cells[G.id] ?? null) : null;
      const k = `${String(x)} ${g == null ? "" : String(g)}`;
      const arr = obs.get(k) ?? []; arr.push(numOrText(r.cells[Y.id] ?? null)); obs.set(k, arr);
      if (ERR) errOf.set(k, numOrText(r.cells[ERR.id] ?? null));
      if (LO) loOf.set(k, numOrText(r.cells[LO.id] ?? null));
      if (HI) hiOf.set(k, numOrText(r.cells[HI.id] ?? null));
    }
    const maxRep = Math.max(1, ...[...obs.values()].map((a) => a.length));
    const summary = (ERR || (LO && HI)) && maxRep === 1;
    const leadOf = new Map<string, Column>();
    const subOf = new Map<string, Column[]>();
    lv.forEach((l, i) => {
      const name = l == null ? Y.name : String(l);
      const c = { id: cid(), name, role: "y" as const };
      cols.push(c); leadOf.set(String(l), c); styles[name] = styleFor(i, name);
      const subs: Column[] = [];
      if (summary) {
        if (ERR) subs.push({ id: cid(), name: "SD", role: "sd", group: c.id });
        else { subs.push({ id: cid(), name: "Low", role: "errlow", group: c.id }, { id: cid(), name: "High", role: "errhigh", group: c.id }); }
      } else {
        for (let r = 1; r < maxRep; r++) subs.push({ id: cid(), name: `${name} ${r + 1}`, role: "y", group: c.id });
      }
      cols.push(...subs); subOf.set(String(l), subs);
    });
    for (const x of xOrder) {
      const cells: Record<string, CellValue> = { [lead.id]: x };
      for (const l of lv) {
        const k = `${String(x)} ${l == null ? "" : String(l)}`;
        const values = obs.get(k) ?? [];
        const c = leadOf.get(String(l))!;
        cells[c.id] = values[0] ?? null;
        const subs = subOf.get(String(l))!;
        if (summary) {
          if (ERR) cells[subs[0]!.id] = errOf.get(k) ?? null;
          else { cells[subs[0]!.id] = loOf.get(k) ?? null; cells[subs[1]!.id] = hiOf.get(k) ?? null; }
        } else subs.forEach((s, i) => { cells[s.id] = values[i + 1] ?? null; });
      }
      rows.push({ id: `ggr${rows.length + 1}`, cells });
    }
    const groupNote = G ? `one series per level of "${G.name}" (${lv.map(String).join(", ")})` : `one series ("${Y.name}")`;
    const repNote = summary ? (ERR ? `mean ± "${ERR.name}" as SD` : `mean with "${LO!.name}" / "${HI!.name}" limits`) : maxRep > 1 ? `${maxRep} replicate subcolumns per series` : "one value per X";
    notes.push({ call: "datasheet", verdict: "honoured", note: `X = "${X.name}" (${xOrder.length} values), ${groupNote}, ${repNote}` });
    if (G && lv.length > 1) notes.push({ call: "series order", verdict: "approximated", note: "levels in the datasheet's order of appearance (ggplot sorts text levels alphabetically)" });
    if (SORT) notes.push({ call: "reorder", verdict: "approximated", note: `categories sorted by "${SORT.name}"` });
    if ((ERR || LO) && maxRep > 1) notes.push({ call: "error bars", verdict: "approximated", note: "several rows per X: the error column is ignored and MadY computes the spread from the replicates" });
  }
  if (missing.length) return fail();
  const table: DataTable = { id: "ggplot-import", kind, name: t.name, columns: cols, rows };
  return { ok: true, missing, matched, table, seriesStylesByName: styles, notes };
}
