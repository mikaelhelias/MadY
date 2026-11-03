/**
 * Dataset grouping (replicate subcolumns). A DataTable is a flat list of columns;
 * a *dataset* is the set of columns that plot as one series: one or more `y`
 * replicate subcolumns, optionally with pre-computed `sd`/`sem` + `n` summary
 * columns. Columns of one dataset share a `group` id (the lead column's id).
 *
 * Back-compat: a column with no `role`/`group` is its own single-replicate `y`
 * dataset (and column 0 is the X axis) — so every legacy table groups cleanly.
 */

import type { Column, DataTable, ErrorBarType, NodeId, TableKind } from "./model";
import { numericCell } from "./numeric";
import { summaryErrorPoint } from "./stats";

/**
 * Per-format column semantics — the single source of truth for what each table
 * kind's columns *mean*, so the data sheet, the new-column namer, and the header
 * role tags all agree. `lead` is the leftmost independent/label column (the X
 * axis, the time column, the row-category labels…); `data` is the singular noun
 * for the value/series columns. `noLead: true` marks formats with NO leading
 * column — every column is a peer (multivariable: each column is a variable).
 */
export interface KindColumns {
  /** Tag shown on the leading X/label column, or undefined when `noLead`. */
  lead?: string;
  /** Singular noun for a data/series column (drives the role tag + new-column name). */
  data: string;
  /** When true the format has no leading column — every column is a `data` peer. */
  noLead?: boolean;
}

export const KIND_COLUMNS: Record<TableKind, KindColumns> = {
  xy: { lead: "X", data: "Y" },
  column: { lead: "Labels", data: "Group" },
  grouped: { lead: "Rows", data: "Group" },
  contingency: { lead: "Rows", data: "Outcome" },
  survival: { lead: "Time", data: "Group" },
  partsofwhole: { lead: "Labels", data: "Sample" },
  multivariable: { data: "Variable", noLead: true },
  pca: { data: "Variable", noLead: true }, // same lead-less shape as multivariable
  nested: { lead: "Labels", data: "Group" },
  sets: { lead: "Item", data: "Set" },
  timeline: { lead: "Subject", data: "Event" },
  meta: { lead: "Study", data: "Value" },
  edgelist: { lead: "Source", data: "Value" }, // col 0 = source; Target/Weight/attrs are value columns
  association: { lead: "Marker", data: "Value" }, // col 0 = marker/SNP; Chr/Position/P are value columns
  alterations: { lead: "Sample", data: "Value" }, // col 0 = sample; Gene/Alteration are value columns (one row per event)
};

/** Does this format have a leading independent/label column (col 0)? */
export function kindHasLeadColumn(kind: TableKind): boolean {
  return !KIND_COLUMNS[kind].noLead;
}

/**
 * The default name for a new data/series column of a table, format-aware: `Y2`
 * for XY, `Group 3` for column/grouped/nested/survival, `Variable 4` for
 * multivariable, `Outcome 2` for contingency, `Sample 2` for parts-of-whole. The
 * ordinal counts the existing datasets (groups) — not columns, so a table with three
 * replicates per group names the third group "Group 3", not "Group 7". When the table
 * has no columns yet and the format has a lead, the first column is the lead (e.g. "X").
 */
export function nextColumnName(table: DataTable): string {
  const cfg = KIND_COLUMNS[table.kind];
  const hasLead = kindHasLeadColumn(table.kind);
  if (table.columns.length === 0 && hasLead) return cfg.lead ?? "X";
  const dataOrdinal = tableDatasets(table).length + 1;
  // XY keeps the compact "Y1/Y2" convention; others read "Group 3", "Variable 4".
  return table.kind === "xy" ? `${cfg.data}${dataOrdinal}` : `${cfg.data} ${dataOrdinal}`;
}

/**
 * The columns a new dataset needs to match the table's current shape — the same replicate
 * count and the same summary sub-columns (SD / N / min / max …) as the last existing dataset,
 * named after the new group ("Group 3", "Group 3·2", "Group 3 SD"). So "Add column" on a
 * replicate or summary-format table adds a whole new group, not a lone n = 1 column beside
 * groups of n = 3. A plain table — every dataset a single bare column —
 * yields exactly one bare column.
 *
 * `mintId` supplies fresh column ids (the document's id factory); the first column returned
 * is the lead and the rest carry `group = lead.id`.
 */
export function newDatasetColumns(table: DataTable, leadName: string, mintId: () => NodeId): Column[] {
  const template = tableDatasets(table).at(-1);
  const cols = template ? table.columns.filter((c) => (c.group ?? c.id) === template.id) : [];
  const templateLead = cols.find((c) => c.id === template?.id) ?? cols[0];
  if (cols.length <= 1) {
    // Keep an explicit `y` role if the table tags its columns (a replicate table set back to
    // n = 1 still does); a legacy untagged table stays untagged.
    return [{ id: mintId(), name: leadName, ...(templateLead?.role ? { role: templateLead.role } : {}) }];
  }
  const lead: Column = { id: mintId(), name: leadName, role: templateLead?.role ?? "y" };
  const out: Column[] = [lead];
  const tName = templateLead?.name ?? "";
  for (const c of cols) {
    if (c === templateLead) continue;
    // "Control·2" → "Group 3·2", "Control SD" → "Group 3 SD"; a sub-column that does not
    // start with the group's name keeps its own suffix after the new name.
    const suffix = tName && c.name.startsWith(tName) ? c.name.slice(tName.length) : ` ${c.name}`;
    out.push({ id: mintId(), name: `${leadName}${suffix}`, role: c.role ?? "y", group: lead.id });
  }
  return out;
}

export interface Dataset {
  /** Dataset id = the lead `y` column's id (the key used for series styling). */
  id: NodeId;
  /** Display name = the lead column's name (drives legend / axis title). */
  name: string;
  /** Replicate `y` column ids, in table order (≥1). */
  replicates: NodeId[];
  /** Pre-computed summary columns (error values computed elsewhere). */
  sd?: NodeId | undefined;
  sem?: NodeId | undefined;
  n?: NodeId | undefined;
  /** Pre-computed coefficient of variation (%CV) column, if entered. */
  cv?: NodeId | undefined;
  /** Asymmetric error: lower / upper columns (Mean±error uses errHigh only). */
  errLow?: NodeId | undefined;
  errHigh?: NodeId | undefined;
  /** Pre-computed range (min / max) columns — drawn as `errorPoint(…, "range")`. */
  min?: NodeId | undefined;
  max?: NodeId | undefined;
  /** Pre-computed IQR quartile columns (lead holds the median) — `errorPoint(…, "iqr")`. */
  q1?: NodeId | undefined;
  q3?: NodeId | undefined;
  /** Pre-computed geometric SD factor (lead holds the geometric mean) — `errorPoint(…, "geoSd")`. */
  geoSd?: NodeId | undefined;
  /** Pre-computed 95% CI half-width about the mean — drawn as a symmetric CI (`asymmetricErrorPoint`). */
  ci?: NodeId | undefined;
}

/** The X column of a table: the explicit `role:"x"` column, else column 0.
 * A multivariable table has no shared X (every column is an independent
 * variable / case attribute), so it returns undefined unless one is tagged. */
export function xColumn(table: DataTable): Column | undefined {
  const explicit = table.columns.find((c) => c.role === "x");
  if (explicit) return explicit;
  // Lead-less formats (multivariable, pca) have NO implicit X — every column is a variable.
  // Guarded lookup: a synthetic table may carry a kind not in the registry (analysis fixtures),
  // and such a table falls through to the first-column logic.
  if (KIND_COLUMNS[table.kind]?.noLead) return undefined;
  const first = table.columns[0];
  // A simple Column sheet tags every group column "y" and has no leading label column, so a
  // column 0 carrying a data role is never the implicit X — its first group must not be taken
  // as labels. An untagged column 0 is the implicit X, which is how older saved projects are drawn.
  if (first?.role && first.role !== "x") return undefined;
  return first;
}

/** The shared X-error column (the XY "X error" subcolumn), if the table has one. */
export function xErrorColumn(table: DataTable): Column | undefined {
  return table.columns.find((c) => c.role === "xerr");
}

/** The table-wide replicate count = the largest dataset's replicate-subcolumn count (≥1). */
export function replicateCount(table: DataTable): number {
  const ds = tableDatasets(table);
  return ds.length ? Math.max(1, ...ds.map((d) => d.replicates.length)) : 1;
}

/**
 * How a table's Y values are entered (the "Format Data Table" mode). `replicates`
 * = raw side-by-side replicate subcolumns (mean ± error computed across them);
 * the `mean-*` modes are the "error values already computed elsewhere" formats —
 * a single mean column plus pre-computed error column(s), the summary
 * data-entry modes: SD/SEM with N, SD/SEM without N, %CV+N, a single ± error
 * value, and separate lower/upper limits (asymmetric). The next four are the
 * pre-computed forms of the graph's own centre+spread display types, drawn through
 * the same `errorPoint` spine: a range (min/max), a median + IQR (q1/q3), a
 * geometric mean ± SD factor, and a symmetric 95% CI half-width. `box-values` is the
 * per-group five-number summary (min · Q1 · median · Q3 · max) that box/violin draw as
 * a box directly, without raw observations.
 */
export type EntryMode =
  | "replicates"
  | "mean-sd-n"
  | "mean-sem-n"
  | "mean-sd"
  | "mean-sem"
  | "mean-cv-n"
  | "mean-err"
  | "mean-limits"
  | "mean-range"
  | "median-iqr"
  | "geomean-sd"
  | "mean-ci"
  | "box-values";

/**
 * The table's effective entry mode, derived from which pre-computed column(s) the
 * datasets carry — checked **most-specific first** so a distinctive shape isn't
 * mistaken for a plainer one: q1+q3 → `median-iqr`; min+max → `mean-range`; geoSd →
 * `geomean-sd`; ci → `mean-ci`; errLow+errHigh → `mean-limits`; errHigh only →
 * `mean-err`; cv → `mean-cv-n`; sem → (N ? `mean-sem-n` : `mean-sem`); sd → (N ?
 * `mean-sd-n` : `mean-sd`); otherwise raw `replicates`.
 */
export function tableEntryMode(table: DataTable): EntryMode {
  const ds = tableDatasets(table);
  const anyN = ds.some((d) => d.n !== undefined);
  // Box values (a full five-number summary) before the partial IQR / range forms, so a
  // table carrying both quartiles and min/max reads as a box, not one of its halves.
  if (ds.some((d) => (d.q1 !== undefined || d.q3 !== undefined) && (d.min !== undefined || d.max !== undefined))) return "box-values";
  if (ds.some((d) => d.q1 !== undefined || d.q3 !== undefined)) return "median-iqr";
  if (ds.some((d) => d.min !== undefined || d.max !== undefined)) return "mean-range";
  if (ds.some((d) => d.geoSd !== undefined)) return "geomean-sd";
  if (ds.some((d) => d.ci !== undefined)) return "mean-ci";
  if (ds.some((d) => d.errLow !== undefined && d.errHigh !== undefined)) return "mean-limits";
  if (ds.some((d) => d.errHigh !== undefined)) return "mean-err";
  if (ds.some((d) => d.cv !== undefined)) return "mean-cv-n";
  if (ds.some((d) => d.sem !== undefined)) return anyN ? "mean-sem-n" : "mean-sem";
  if (ds.some((d) => d.sd !== undefined)) return anyN ? "mean-sd-n" : "mean-sd";
  return "replicates";
}

/**
 * Label + compact label for every entry mode. A `Record<EntryMode, …>` makes this
 * exhaustive: adding a mode to the `EntryMode` union is a compile error here until it
 * gets labels. Declaration order is display
 * order — JS preserves string-key insertion order.
 *
 * `label` is the roomy form for the New-Graph dialog; `short` is the compact form for
 * the space-constrained datasheet rail. Both dropdowns render `ENTRY_MODE_OPTIONS`, so
 * they cannot drift.
 */
const ENTRY_MODE_LABELS: Record<EntryMode, { label: string; short: string }> = {
  replicates: { label: "Replicate values (side-by-side subcolumns)", short: "Replicates" },
  "mean-sd-n": { label: "Mean, SD and N", short: "Mean + SD + N" },
  "mean-sem-n": { label: "Mean, SEM and N", short: "Mean + SEM + N" },
  "mean-sd": { label: "Mean and SD (no N)", short: "Mean + SD" },
  "mean-sem": { label: "Mean and SEM (no N)", short: "Mean + SEM" },
  "mean-cv-n": { label: "Mean, %CV and N", short: "Mean + %CV + N" },
  "mean-err": { label: "Mean ± error value", short: "Mean ± error" },
  "mean-limits": { label: "Mean with lower & upper limits", short: "Mean + limits" },
  "mean-range": { label: "Mean with min & max (range)", short: "Mean + range" },
  "median-iqr": { label: "Median with Q1 & Q3 (IQR)", short: "Median + IQR" },
  "geomean-sd": { label: "Geometric mean & SD factor", short: "Geo mean ± SD" },
  "mean-ci": { label: "Mean ± 95% CI (half-width)", short: "Mean + 95% CI" },
  "box-values": { label: "Box values (min, Q1, median, Q3, max)", short: "Box values" },
};

/** One data-entry-format choice, offered in the New-Graph dialog and the datasheet rail. */
export interface EntryModeOption {
  id: EntryMode;
  /** Descriptive label (New-Graph dialog). */
  label: string;
  /** Compact label (datasheet toolbar). */
  short: string;
}

/**
 * Every entry mode, in display order, with both label forms — the single source both
 * the New-Graph dialog and the datasheet "Entry" dropdown render, so the two can never
 * offer different sets. Add a mode by extending `EntryMode` + `ENTRY_MODE_LABELS`.
 */
export const ENTRY_MODE_OPTIONS: readonly EntryModeOption[] = (
  Object.keys(ENTRY_MODE_LABELS) as EntryMode[]
).map((id) => ({ id, ...ENTRY_MODE_LABELS[id] }));

/**
 * The error-bar types a dataset can actually draw, given how its values were entered
 * — ordered so the entered statistic leads (that is what `naturalErrorType` picks).
 * Mirrors what `summaryErrorPoint` / `errorPoint` will produce, so it is the one
 * source for: gating the error-type control (never offer an undrawable option),
 * warning when a saved graph asks for one it can't draw, and repairing the type when
 * the entry mode changes. Excludes `"none"`, which is always available separately.
 *
 * - **Pre-computed range / IQR / geometric / CI**: exactly the one type they were entered as.
 * - **Asymmetric entry** (± value or lower/upper limits): drawn exactly as entered.
 * - **Mean + SD / SEM / %CV**: which of SD·SEM·CI is drawable follows one rule (N is
 *   needed for a CI, and to convert SD↔SEM) — that rule is asked of `summaryErrorPoint`
 *   itself, not re-encoded here, so the two can't drift. Ordered entered-stat-first (a
 *   SEM entry defaults to SEM) — a display preference, the only thing decided locally.
 * - **Raw replicates** (≥2 per row): summarised → any interval; <2 → nothing.
 */
export function drawableErrorTypes(ds: Dataset): ErrorBarType[] {
  // Box values carry both quartiles and min/max — on an error-bar graph either interval
  // is drawable (the box itself belongs to box/violin, handled by the distribution builder).
  if ((ds.q1 !== undefined || ds.q3 !== undefined) && (ds.min !== undefined || ds.max !== undefined)) return ["iqr", "range"];
  if (ds.q1 !== undefined || ds.q3 !== undefined) return ["iqr"];
  if (ds.min !== undefined || ds.max !== undefined) return ["range"];
  if (ds.geoSd !== undefined) return ["geoSd"];
  if (ds.ci !== undefined) return ["ci95"];
  if (ds.errLow !== undefined || ds.errHigh !== undefined) return ["asymmetric"];
  if (ds.sd !== undefined || ds.sem !== undefined || ds.cv !== undefined) {
    // Mirror how `summaryPointForRow` reads this dataset (%CV → SD, so not SEM; else the
    // entered stat leads), then let `summaryErrorPoint` decide what its N supports.
    const isSem = ds.cv === undefined && ds.sem !== undefined;
    const n = ds.n !== undefined ? 2 : NaN;
    const order: ErrorBarType[] = isSem ? ["sem", "sd", "ci95"] : ["sd", "sem", "ci95"];
    return order.filter((t) => summaryErrorPoint(1, 1, n, isSem, t).hasError);
  }
  if (ds.replicates.length >= 2) return ["sd", "sem", "ci95", "range", "geoSd", "iqr"];
  return [];
}

/** The natural error-bar type for a dataset — the entered statistic (or `"asymmetric"`
 *  for limit/±-value entry), else `"none"` when nothing is drawable. Used to repair a
 *  plot's error type when a switch of entry mode strands its old, now-undrawable choice. */
export function naturalErrorType(ds: Dataset): ErrorBarType {
  return drawableErrorTypes(ds)[0] ?? "none";
}

/** Effective role of a column (legacy columns: col 0 = x, the rest = y). In a
 * multivariable table every untagged column is an independent variable (`y`),
 * including the first — so each becomes its own selectable dataset/variable. */
function roleOf(table: DataTable, col: Column, index: number): NonNullable<Column["role"]> {
  if (col.role) return col.role;
  // Lead-less formats (multivariable, pca): every untagged column is a variable, not an implicit X.
  if (KIND_COLUMNS[table.kind]?.noLead) return "y";
  return index === 0 ? "x" : "y";
}

/**
 * Group a table's non-X columns into datasets, preserving first-appearance
 * order. Columns sharing a `group` (or a lone column keyed by its own id) form
 * one dataset; the lead is the `y` column whose id is the group key, else the
 * first `y` column seen.
 */
export function tableDatasets(table: DataTable): Dataset[] {
  const x = xColumn(table);
  const order: NodeId[] = [];
  const groups = new Map<NodeId, Column[]>();
  table.columns.forEach((col, i) => {
    if (col === x) return;
    const role = roleOf(table, col, i);
    if (role === "x") return; // a second x-role column is ignored as data
    if (role === "xerr") return; // the shared X-error column is not a Y dataset
    if (role === "survStart" || role === "survEnd") return; // survival date-pair columns are not Y datasets
    const key = col.group ?? col.id;
    if (!groups.has(key)) {
      groups.set(key, []);
      order.push(key);
    }
    groups.get(key)!.push(col);
  });

  const datasets: Dataset[] = [];
  for (const key of order) {
    const cols = groups.get(key)!;
    const replicates: NodeId[] = [];
    let sd: NodeId | undefined;
    let sem: NodeId | undefined;
    let n: NodeId | undefined;
    let cv: NodeId | undefined;
    let errLow: NodeId | undefined;
    let errHigh: NodeId | undefined;
    let min: NodeId | undefined;
    let max: NodeId | undefined;
    let q1: NodeId | undefined;
    let q3: NodeId | undefined;
    let geoSd: NodeId | undefined;
    let ci: NodeId | undefined;
    for (const col of cols) {
      const role = col.role ?? "y";
      if (role === "y") replicates.push(col.id);
      else if (role === "sd") sd ??= col.id;
      else if (role === "sem") sem ??= col.id;
      else if (role === "n") n ??= col.id;
      else if (role === "cv") cv ??= col.id;
      else if (role === "errlow") errLow ??= col.id;
      else if (role === "errhigh") errHigh ??= col.id;
      else if (role === "min") min ??= col.id;
      else if (role === "max") max ??= col.id;
      else if (role === "q1") q1 ??= col.id;
      else if (role === "q3") q3 ??= col.id;
      else if (role === "geosd") geoSd ??= col.id;
      else if (role === "ci") ci ??= col.id;
    }
    // A dataset must have at least one y column; if a group somehow has only
    // summary columns, treat its first column as the lead so it still plots.
    const lead = cols.find((c) => c.id === key) ?? cols.find((c) => (c.role ?? "y") === "y") ?? cols[0]!;
    if (replicates.length === 0) replicates.push(lead.id);
    datasets.push({ id: lead.id, name: lead.name, replicates, sd, sem, n, cv, errLow, errHigh, min, max, q1, q3, geoSd, ci });
  }
  return datasets;
}

/** The swimmer plot's column partition over a table's datasets — one home, read by the
 *  builder (what draws) and the Inspector (which series rows carry a hide box: the
 *  structural columns must not offer one, hiding half a bar is not a drawing).
 *  Contract: all-text datasets are attribute columns (Stage, arm… — bindable, never
 *  series); datasets named exactly "Response start" / "Response end" / "Ongoing"
 *  (case-insensitive) are the overlay/flag; the first two remaining numeric datasets are
 *  the bar Start/End — unless the survival date-role pair (survStart/survEnd) exists, in
 *  which case the bar is elapsed time and no dataset is consumed; everything left is an
 *  event-glyph series. */
export interface SwimmerColumns {
  start?: Dataset | undefined;
  end?: Dataset | undefined;
  responseStart?: Dataset | undefined;
  responseEnd?: Dataset | undefined;
  ongoing?: Dataset | undefined;
  /** The event-glyph series, in column order. */
  events: Dataset[];
  /** All-text attribute datasets (never drawn as series). */
  attributes: Dataset[];
  /** True when the survival date pair supplies the bar (start/end stay unset). */
  dateMode: boolean;
}

export function swimmerColumns(table: DataTable): SwimmerColumns {
  const dateMode =
    table.columns.some((c) => c.role === "survStart") && table.columns.some((c) => c.role === "survEnd");
  const out: SwimmerColumns = { events: [], attributes: [], dateMode };
  const isText = (ds: Dataset): boolean =>
    table.rows.length > 0 &&
    table.rows.every((r) => ds.replicates.every((id) => numericCell(r.cells[id]) == null)) &&
    table.rows.some((r) => String(r.cells[ds.replicates[0] ?? ds.id] ?? "").trim() !== "");
  const rest: Dataset[] = [];
  for (const ds of tableDatasets(table)) {
    if (isText(ds)) {
      out.attributes.push(ds);
      continue;
    }
    const n = ds.name.trim().toLowerCase();
    if (!out.responseStart && n === "response start") out.responseStart = ds;
    else if (!out.responseEnd && n === "response end") out.responseEnd = ds;
    else if (!out.ongoing && n === "ongoing") out.ongoing = ds;
    else rest.push(ds);
  }
  if (!dateMode) {
    out.start = rest.shift();
    out.end = rest.shift();
  }
  out.events = rest;
  return out;
}
