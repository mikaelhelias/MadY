/**
 * Data-processing analyses (the Data menu's transform operations) that manipulate a
 * table into a NEW derived grid: row statistics, prune rows, remove baseline &
 * column math, transpose, extract & rearrange. Each is a pure NamedTable →
 * NamedTable transform, wired through `recomputeDerived` (`derive.ts`) so the
 * result stays reactive — it regenerates whenever its source table changes.
 *
 * Pure + DOM-free (a `@mady/core` module): only grid-in → grid-out.
 */
import type { CellValue } from "./model";
import type { NamedTable } from "./reshape";
import { summarize, quantileSorted, ciMultiplier } from "./stats";

/** Coerce a cell to a finite number, or null (blanks / non-numeric / excluded). */
function toNum(v: CellValue): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") {
    const t = v.trim();
    if (t === "") return null;
    const n = Number(t);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

// ── Row statistics ──────────────────────────────────────────────────────────

/** The per-row summary statistics offered ("Row means / totals"). */
export type RowStat =
  | "mean" | "sd" | "sem" | "n" | "cv" | "median"
  | "min" | "max" | "range" | "sum" | "geomean" | "ci95lo" | "ci95hi";

const ROW_STAT_LABEL: Record<RowStat, string> = {
  mean: "Mean", sd: "SD", sem: "SEM", n: "N", cv: "%CV", median: "Median",
  min: "Min", max: "Max", range: "Range", sum: "Sum", geomean: "Geo. mean",
  ci95lo: "95% CI low", ci95hi: "95% CI high",
};

/** Ordered list of stats for a "select which columns to emit" UI. */
export const ROW_STATS: ReadonlyArray<{ id: RowStat; label: string }> =
  (Object.keys(ROW_STAT_LABEL) as RowStat[]).map((id) => ({ id, label: ROW_STAT_LABEL[id] }));

function rowStatValue(st: RowStat, s: ReturnType<typeof summarize>, vals: number[], sorted: number[]): number | null {
  const fin = (x: number): number | null => (Number.isFinite(x) ? x : null);
  switch (st) {
    case "mean": return fin(s.mean);
    case "sd": return fin(s.sd);
    case "sem": return fin(s.sem);
    case "n": return s.n;
    case "cv": return s.n >= 2 && s.mean !== 0 ? fin((s.sd / Math.abs(s.mean)) * 100) : null;
    case "median": return sorted.length ? fin(quantileSorted(sorted, 0.5)) : null;
    case "min": return fin(s.min);
    case "max": return fin(s.max);
    case "range": return s.n ? fin(s.max - s.min) : null;
    case "sum": return vals.length ? fin(vals.reduce((a, b) => a + b, 0)) : null;
    case "geomean": return fin(s.geoMean);
    case "ci95lo": return s.n >= 2 ? fin(s.mean - ciMultiplier(0.95, s.n - 1) * s.sem) : null;
    case "ci95hi": return s.n >= 2 ? fin(s.mean + ciMultiplier(0.95, s.n - 1) * s.sem) : null;
  }
}

/**
 * Per-row summary across `dataColumns` (each row's selected cells = one sample):
 * emit one column per requested statistic. `keepColumns` (e.g. the X column or
 * row labels) are carried through unchanged, on the left. Unknown stat ids are
 * dropped; an empty `stats` falls back to Mean/SD/N.
 */
export function rowStatistics(
  src: NamedTable,
  spec: { dataColumns: number[]; keepColumns?: number[]; stats: string[] },
): NamedTable {
  const keep = spec.keepColumns ?? [];
  const stats = (spec.stats.filter((s): s is RowStat => s in ROW_STAT_LABEL));
  const chosen: RowStat[] = stats.length ? stats : ["mean", "sd", "n"];
  const columnNames = [
    ...keep.map((c) => src.columnNames[c] ?? `Col ${c + 1}`),
    ...chosen.map((s) => ROW_STAT_LABEL[s]),
  ];
  const rows = src.rows.map((row) => {
    const vals: number[] = [];
    for (const c of spec.dataColumns) {
      const n = toNum(row[c] ?? null);
      if (n !== null) vals.push(n);
    }
    const s = summarize(vals);
    const sorted = [...vals].sort((a, b) => a - b);
    const out: CellValue[] = keep.map((c) => row[c] ?? null);
    for (const st of chosen) out.push(rowStatValue(st, s, vals, sorted));
    return out;
  });
  return { columnNames, rows };
}

// ── Prune rows ────────────────────────────────────────────────────────────────

const isBlank = (v: CellValue): boolean => v == null || (typeof v === "string" && v.trim() === "");

/**
 * Keep a SUBSET of the source rows (same columns) — "Remove rows":
 * - `everyNth` — keep 1 of every N rows, starting at `offset` (thin the data);
 * - `firstN` / `lastN` — keep only the first / last N rows;
 * - `range` — keep rows whose value in column `col` lies in [`min`, `max`]
 *   (non-numeric / blank cells fail the test and drop out);
 * - `dropBlank` — drop rows blank in column `col`, or (col undefined) fully blank.
 */
export function pruneRows(
  src: NamedTable,
  spec: { mode: "everyNth" | "firstN" | "lastN" | "range" | "dropBlank"; n?: number; offset?: number; col?: number; min?: number; max?: number },
): NamedTable {
  const rows = src.rows;
  let kept: CellValue[][];
  switch (spec.mode) {
    case "firstN":
      kept = rows.slice(0, Math.max(0, Math.floor(spec.n ?? 0)));
      break;
    case "lastN": {
      const k = Math.max(0, Math.floor(spec.n ?? 0));
      kept = k >= rows.length ? rows.slice() : rows.slice(rows.length - k);
      break;
    }
    case "everyNth": {
      const n = Math.max(1, Math.floor(spec.n ?? 1));
      const off = Math.max(0, Math.floor(spec.offset ?? 0));
      kept = rows.filter((_, i) => i >= off && (i - off) % n === 0);
      break;
    }
    case "range": {
      const c = spec.col ?? 0;
      const lo = spec.min ?? -Infinity;
      const hi = spec.max ?? Infinity;
      kept = rows.filter((r) => { const v = toNum(r[c] ?? null); return v !== null && v >= lo && v <= hi; });
      break;
    }
    case "dropBlank": {
      const c = spec.col;
      kept = c == null
        ? rows.filter((r) => !r.every((v) => isBlank(v ?? null)))
        : rows.filter((r) => !isBlank(r[c] ?? null));
      break;
    }
    default:
      kept = rows.slice();
  }
  return { columnNames: [...src.columnNames], rows: kept.map((r) => [...r]) };
}

// ── Remove baseline & column math ─────────────────────────────────────────────

const colName = (src: NamedTable, c: number): string => src.columnNames[c] ?? `Col ${c + 1}`;

/** Binary arithmetic on two nullable numbers (null on a missing operand or ÷0). */
function binop(op: "add" | "subtract" | "multiply" | "divide", a: number | null, b: number | null): number | null {
  if (a === null || b === null) return null;
  switch (op) {
    case "add": return a + b;
    case "subtract": return a - b;
    case "multiply": return a * b;
    case "divide": return b !== 0 ? a / b : null;
  }
}

/**
 * Remove a baseline from each data column ("Remove baseline"). The baseline
 * per data column comes from one of:
 * - `column`   — subtract the value in `baselineCol` for that same row;
 * - `firstRow` — subtract each data column's value in row 0 (a per-column constant);
 * - `meanRows` — subtract the mean of rows [`from`,`to`] of that data column;
 * - `constant` — subtract a fixed `value`.
 * `operation` = subtract (default) or divide (ratio to baseline). Keep columns are
 * carried through; a missing value or missing baseline → blank; divide-by-zero → blank.
 */
export function removeBaseline(
  src: NamedTable,
  spec: {
    dataColumns: number[]; keepColumns?: number[];
    baselineFrom: "column" | "firstRow" | "meanRows" | "constant";
    baselineCol?: number; from?: number; to?: number; value?: number;
    operation?: "subtract" | "divide";
  },
): NamedTable {
  const keep = spec.keepColumns ?? [];
  const dataCols = spec.dataColumns;
  const op = spec.operation ?? "subtract";
  // Row-independent baselines (per data column) for firstRow / meanRows / constant.
  const perCol = new Map<number, number | null>();
  if (spec.baselineFrom === "firstRow") {
    for (const c of dataCols) perCol.set(c, toNum(src.rows[0]?.[c] ?? null));
  } else if (spec.baselineFrom === "meanRows") {
    const from = Math.max(0, Math.floor(spec.from ?? 0));
    const to = Math.min(src.rows.length - 1, Math.floor(spec.to ?? 0));
    for (const c of dataCols) {
      const vals: number[] = [];
      for (let i = from; i <= to; i++) { const v = toNum(src.rows[i]?.[c] ?? null); if (v !== null) vals.push(v); }
      perCol.set(c, vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null);
    }
  } else if (spec.baselineFrom === "constant") {
    for (const c of dataCols) perCol.set(c, spec.value ?? 0);
  }
  const columnNames = [...keep.map((c) => colName(src, c)), ...dataCols.map((c) => colName(src, c))];
  const rows = src.rows.map((row) => {
    const out: CellValue[] = keep.map((c) => row[c] ?? null);
    const rowBase = spec.baselineFrom === "column" ? toNum(row[spec.baselineCol ?? 0] ?? null) : null;
    for (const c of dataCols) {
      const v = toNum(row[c] ?? null);
      const base = spec.baselineFrom === "column" ? rowBase : (perCol.get(c) ?? null);
      if (v === null || base === null) { out.push(null); continue; }
      out.push(op === "divide" ? (base !== 0 ? v / base : null) : v - base);
    }
    return out;
  });
  return { columnNames, rows };
}

const OP_SYMBOL: Record<"add" | "subtract" | "multiply" | "divide", string> = { add: "+", subtract: "−", multiply: "×", divide: "÷" };

/**
 * Column math: a binary arithmetic operation between columns
 * `a` and `b` into a new result column (`resultName`, or an auto "A ÷ B" label).
 * Keep columns are carried through on the left.
 */
export function columnMath(
  src: NamedTable,
  spec: { keepColumns?: number[]; a: number; b: number; operator: "add" | "subtract" | "multiply" | "divide"; resultName?: string },
): NamedTable {
  const keep = spec.keepColumns ?? [];
  const label = spec.resultName?.trim() || `${colName(src, spec.a)} ${OP_SYMBOL[spec.operator]} ${colName(src, spec.b)}`;
  const columnNames = [...keep.map((c) => colName(src, c)), label];
  const rows = src.rows.map((row) => {
    const out: CellValue[] = keep.map((c) => row[c] ?? null);
    out.push(binop(spec.operator, toNum(row[spec.a] ?? null), toNum(row[spec.b] ?? null)));
    return out;
  });
  return { columnNames, rows };
}

// ── Transpose ─────────────────────────────────────────────────────────────────

/**
 * Transpose the grid into a live results table ("Transpose X and Y"): the
 * source's columns become rows and vice-versa. When `labelCol` is a valid column,
 * its cell values become the NEW column headers (and its title becomes the corner
 * header); every OTHER column becomes a row led by its title. `labelCol < 0` (or
 * out of range) → a plain transpose with generic "Row N" headers over all columns.
 */
export function transposeTable(src: NamedTable, spec: { labelCol?: number }): NamedTable {
  const nCols = src.columnNames.length;
  const lc = spec.labelCol ?? 0;
  const useLabel = lc >= 0 && lc < nCols;
  const bodyCols = src.columnNames.map((_, i) => i).filter((i) => !useLabel || i !== lc);
  const corner = useLabel ? colName(src, lc) : "";
  const headers = useLabel
    ? src.rows.map((r) => { const v = r[lc]; return v == null ? "" : String(v); })
    : src.rows.map((_, i) => `Row ${i + 1}`);
  const columnNames = [corner, ...headers];
  const rows = bodyCols.map((c) => [colName(src, c), ...src.rows.map((r) => r[c] ?? null)] as CellValue[]);
  return { columnNames, rows };
}

// ── Extract & rearrange ───────────────────────────────────────────────────────

/**
 * Extract & rearrange columns ("Extract and rearrange"): output the source
 * columns named in `columns`, in exactly that order (so it both selects a subset
 * and reorders them). Out-of-range indices are dropped. Rows are preserved.
 */
export function extractColumns(src: NamedTable, spec: { columns: number[] }): NamedTable {
  const cols = spec.columns.filter((c) => Number.isInteger(c) && c >= 0 && c < src.columnNames.length);
  const columnNames = cols.map((c) => colName(src, c));
  const rows = src.rows.map((r) => cols.map((c) => r[c] ?? null));
  return { columnNames, rows };
}

// ── Merge two datasheets ──────────────────────────────────────────────────────

/** How `mergeTables` keeps rows: only rows whose key is in BOTH sheets, or every row of the first sheet. */
export type MergeKeep = "matched" | "allFirst";

/** What a merge did, counted — so nothing is dropped without being said. */
export interface MergeReport {
  /** Rows of the first sheet that found their key in the second. */
  matched: number;
  /** Rows of the first sheet whose key is not in the second (kept with blanks, or left out). */
  unmatchedFirst: number;
  /** Distinct keys of the second sheet no row of the first sheet asked for (their rows are not in the result). */
  unusedSecond: number;
  /** Keys that appear more than once in the second sheet — the FIRST such row is the one used. */
  duplicateSecond: string[];
  /** Rows of the first sheet with a blank key (they never match). */
  blankFirst: number;
}

/** A key as it is matched: its text with the surrounding spaces dropped (so 7 and "7" match); blank → null. */
function mergeKey(v: CellValue | undefined): string | null {
  if (v === null || v === undefined) return null;
  const t = String(v).trim();
  return t === "" ? null : t;
}

/**
 * Merge two datasheets on a key column ("Data ▸ Merge datasheets…"). The result has every column of the FIRST sheet,
 * then every column of the second except its key; a second-sheet column whose name is already taken is suffixed with
 * `secondName` in brackets. Each row of the first sheet is joined to the first row of the second with the same key
 * (keys compared as trimmed text, case kept). `keep: "matched"` leaves out first-sheet rows with no match; `"allFirst"`
 * keeps them with the second sheet's cells blank. A one-time copy: the result does not follow later edits.
 */
export function mergeTables(
  first: NamedTable,
  second: NamedTable,
  spec: { keyFirst: number; keySecond: number; keep: MergeKeep; secondName?: string },
): { table: NamedTable; report: MergeReport } {
  const { keyFirst, keySecond, keep } = spec;
  const secondCols = second.columnNames.map((_, i) => i).filter((i) => i !== keySecond);
  const taken = new Set(first.columnNames.map((_, i) => colName(first, i)));
  const secondNames = secondCols.map((c) => {
    const base = colName(second, c);
    if (!taken.has(base)) {
      taken.add(base);
      return base;
    }
    let name = `${base} (${spec.secondName ?? "2"})`;
    for (let k = 2; taken.has(name); k++) name = `${base} (${spec.secondName ?? "2"} ${k})`;
    taken.add(name);
    return name;
  });
  const byKey = new Map<string, CellValue[]>();
  const dup = new Set<string>();
  for (const row of second.rows) {
    const k = mergeKey(row[keySecond]);
    if (k === null) continue;
    if (byKey.has(k)) dup.add(k);
    else byKey.set(k, row);
  }
  const used = new Set<string>();
  const report: MergeReport = { matched: 0, unmatchedFirst: 0, unusedSecond: 0, duplicateSecond: [...dup], blankFirst: 0 };
  const rows: CellValue[][] = [];
  for (const row of first.rows) {
    const k = mergeKey(row[keyFirst]);
    if (k === null) report.blankFirst++;
    const hit = k === null ? undefined : byKey.get(k);
    if (hit) {
      report.matched++;
      used.add(k!);
    } else if (k !== null) {
      report.unmatchedFirst++;
    }
    if (!hit && keep === "matched") continue;
    rows.push([...first.columnNames.map((_, i) => row[i] ?? null), ...secondCols.map((c) => (hit ? hit[c] ?? null : null))]);
  }
  report.unusedSecond = [...byKey.keys()].filter((k) => !used.has(k)).length;
  return { table: { columnNames: [...first.columnNames.map((_, i) => colName(first, i)), ...secondNames], rows }, report };
}

/** The merge report in plain words, for the dialog and the project log. Empty parts are left out. */
export function mergeReportText(r: MergeReport, keep: MergeKeep): string {
  const s = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;
  const parts = [`${s(r.matched, "row", "rows")} matched`];
  if (r.unmatchedFirst > 0) parts.push(`${s(r.unmatchedFirst, "row", "rows")} of the first sheet had no match${keep === "allFirst" ? " (kept, with blanks)" : " (left out)"}`);
  if (r.blankFirst > 0) parts.push(`${s(r.blankFirst, "row", "rows")} of the first sheet had a blank key${keep === "allFirst" ? " (kept, with blanks)" : " (left out)"}`);
  if (r.unusedSecond > 0) parts.push(`${s(r.unusedSecond, "key", "keys")} of the second sheet matched nothing (not in the result)`);
  if (r.duplicateSecond.length > 0) {
    const shown = r.duplicateSecond.slice(0, 5).join(", ") + (r.duplicateSecond.length > 5 ? ", …" : "");
    parts.push(`${s(r.duplicateSecond.length, "key appears", "keys appear")} more than once in the second sheet — the first row was used (${shown})`);
  }
  return parts.join(" · ") + ".";
}

// ── Split a text column ───────────────────────────────────────────────────────

/** Most parts one split may make — past this the column was not split on a real separator. */
export const SPLIT_MAX_PARTS = 20;

/**
 * Split one text column at a separator ("Data ▸ Split text column…"): "Liver_Day7" at "_" → "Liver" | "Day7". The
 * column is REPLACED, in place, by as many columns as the longest split needs (named "<column> 1", "<column> 2", …, at
 * most `SPLIT_MAX_PARTS`, the rest kept joined in the last part); every other column is kept. A part that is a number
 * becomes a number, so "Mouse_3" gives 3 you can plot. A cell without the separator lands whole in part 1. An empty
 * separator or a column that does not exist leaves the sheet as it is.
 */
export function splitTextColumn(src: NamedTable, spec: { col: number; sep: string }): NamedTable {
  const { col, sep } = spec;
  if (sep === "" || !(col >= 0 && col < src.columnNames.length)) return { columnNames: src.columnNames.map((_, i) => colName(src, i)), rows: src.rows.map((r) => [...r]) };
  const pieces = src.rows.map((r) => {
    const v = r[col];
    if (v === null || v === undefined || String(v) === "") return [] as string[];
    const all = String(v).split(sep);
    return all.length > SPLIT_MAX_PARTS ? [...all.slice(0, SPLIT_MAX_PARTS - 1), all.slice(SPLIT_MAX_PARTS - 1).join(sep)] : all;
  });
  const k = Math.max(1, ...pieces.map((p) => p.length));
  const base = colName(src, col);
  const asCell = (s: string | undefined): CellValue => {
    if (s === undefined) return null;
    const t = s.trim();
    if (t === "") return null;
    const n = Number(t);
    return Number.isFinite(n) ? n : t;
  };
  const columnNames = [
    ...src.columnNames.slice(0, col).map((_, i) => colName(src, i)),
    ...Array.from({ length: k }, (_, j) => `${base} ${j + 1}`),
    ...src.columnNames.slice(col + 1).map((_, i) => colName(src, col + 1 + i)),
  ];
  const rows = src.rows.map((r, ri) => [
    ...src.columnNames.slice(0, col).map((_, i) => r[i] ?? null),
    ...Array.from({ length: k }, (_, j) => asCell(pieces[ri]![j])),
    ...src.columnNames.slice(col + 1).map((_, i) => r[col + 1 + i] ?? null),
  ]);
  return { columnNames, rows };
}

/** How a split went, for the dialog: rows split, rows without the separator (whole in part 1), and the parts made. */
export function splitCounts(src: NamedTable, spec: { col: number; sep: string }): { split: number; unsplit: number; parts: number } {
  let split = 0;
  let unsplit = 0;
  let parts = 1;
  if (spec.sep === "" || !(spec.col >= 0 && spec.col < src.columnNames.length)) return { split, unsplit, parts };
  for (const r of src.rows) {
    const v = r[spec.col];
    if (v === null || v === undefined || String(v) === "") continue;
    const n = Math.min(SPLIT_MAX_PARTS, String(v).split(spec.sep).length);
    if (n > 1) split++;
    else unsplit++;
    parts = Math.max(parts, n);
  }
  return { split, unsplit, parts };
}

// ── Find & replace ────────────────────────────────────────────────────────────

/** What to find and what to put in its place (`replaceInCell`, `MadyDocument.replaceInTable`). */
export interface FindReplaceSpec {
  find: string;
  replace: string;
  /** Upper and lower case must match. Default false. */
  matchCase?: boolean | undefined;
  /** Only a cell whose whole text is `find` (spaces around it ignored) changes. Default false = anywhere in the text. */
  wholeCell?: boolean | undefined;
}

/**
 * Find & replace in one cell. The text is found literally (no patterns). A number cell is searched as its text and
 * stays a number when the result is one ("7" → "8" gives 8); otherwise it becomes text. Returns the new value
 * and whether it changed. An empty `find` changes nothing.
 */
export function replaceInCell(v: CellValue, spec: FindReplaceSpec): { value: CellValue; changed: boolean } {
  if (spec.find === "" || v === null || v === undefined) return { value: v, changed: false };
  const text = String(v);
  const norm = (s: string): string => (spec.matchCase ? s : s.toLowerCase());
  let out: string;
  if (spec.wholeCell) {
    if (norm(text.trim()) !== norm(spec.find.trim())) return { value: v, changed: false };
    out = spec.replace;
  } else {
    const esc = spec.find.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(esc, spec.matchCase ? "g" : "gi");
    if (!re.test(text)) return { value: v, changed: false };
    out = text.replace(new RegExp(esc, spec.matchCase ? "g" : "gi"), () => spec.replace);
  }
  if (out === text) return { value: v, changed: false };
  if (typeof v === "number") {
    const n = Number(out.trim());
    if (out.trim() !== "" && Number.isFinite(n)) return { value: n, changed: n !== v };
  }
  return { value: out === "" ? null : out, changed: true };
}
