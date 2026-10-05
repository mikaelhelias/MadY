/**
 * Table-format registry — the core principle that *the format determines
 * capability*: each `TableKind` unlocks a specific set of analyses
 * and graphs, expects a particular column layout, and has its own data-entry
 * rules. This module is the single source of truth describing each format
 * (label, blurb, seed columns, what it unlocks) plus a non-blocking `validateTable`
 * that flags data inconsistent with the declared format — surfaced the same way as
 * scene warnings, never blocking entry.
 *
 * Pure + DOM-free. Adding a `TableKind` is a compile error here until you add its
 * entry to `TABLE_FORMATS` (the `Record` is exhaustive), so capability metadata
 * can never silently go missing.
 */
import type { CellValue, Column, DataTable, TableKind } from "./model";
import { replicateCount } from "./dataset";

export interface TableFormatInfo {
  kind: TableKind;
  /** Menu / picker label, e.g. "Multiple variables". */
  label: string;
  /** One-line description of the layout + what it's for. */
  description: string;
  /** Does each dataset carry side-by-side replicate subcolumns? */
  replicates: boolean;
  /** Column names used to seed a fresh table of this format. */
  seedColumns: string[];
  /**
   * Explicit roles for the seeded columns (parallel to `seedColumns`). The `column` format seeds
   * lead-less: every column is a group tagged `"y"`, so a simple column sheet is just the group
   * columns with replicates down the rows — no label column, no subcolumns. Other formats keep
   * their untagged seed (column 0 = the X / labels column).
   */
  seedRoles?: ReadonlyArray<Column["role"]>;
  /** Analyses this format unlocks (labels) — drives menus + guidance. */
  analyses: string[];
  /** Graph kinds this format naturally produces (labels). */
  graphs: string[];
  /**
   * A fixed, positional column shape: every `seedColumns` entry is a named, required column (GWAS
   * Marker/Chromosome/Position/P-value, meta Study/Estimate/Lower/Upper, …), not a flexible count
   * of group/variable columns. Switching a sheet to such a format reshapes it to this seed so it is
   * configured, never left warning "needs these columns" (see `reconcileLeadForKind`). These are
   * exactly the formats with a structural column-count warning in `validateTable`.
   */
  fixedShape?: boolean;
}

/** Display order for menus / pickers: XY, Column and Grouped first, then the specialised formats. */
export const TABLE_FORMAT_ORDER: readonly TableKind[] = [
  "xy",
  "column",
  "grouped",
  "contingency",
  "survival",
  "partsofwhole",
  "multivariable",
  "pca",
  "nested",
  "sets",
  "timeline",
  "meta",
  "edgelist",
  "association",
  "alterations",
];

/**
 * Every format's capability metadata. The `Record<TableKind, …>` is exhaustive:
 * a new `TableKind` won't compile until described here.
 */
export const TABLE_FORMATS: Record<TableKind, TableFormatInfo> = {
  xy: {
    kind: "xy",
    label: "XY",
    description: "Shared X with one or more Y datasets (replicate subcolumns). For regression, correlation, curve fits.",
    replicates: true,
    seedColumns: ["X", "Y1"],
    analyses: ["Linear regression", "Curve fit", "Correlation", "Area under curve", "Interpolate a standard curve"],
    graphs: ["Scatter", "Line", "Area", "Before-after", "Timeline tracks"],
  },
  column: {
    kind: "column",
    label: "Column",
    description: "One grouping variable; each column is a group, values entered down the rows. For t-tests, one-way ANOVA, descriptives.",
    replicates: true,
    // Lead-less: a simple column sheet is just the group columns — one per group, replicates
    // down the rows, no leading label column. Tagged "y" so `xColumn()`
    // picks no implicit X and the first group is never eaten as labels. `grouped` is separate.
    seedColumns: ["Control", "Treated"],
    seedRoles: ["y", "y"],
    analyses: ["t test", "One-way ANOVA", "Descriptive statistics", "Normality tests", "Identify outliers"],
    graphs: ["Column bar", "Box-and-whisker", "Violin", "Column scatter", "Polar histogram"],
  },
  grouped: {
    kind: "grouped",
    label: "Grouped",
    description: "Two grouping variables (rows × dataset columns), replicate subcolumns. For two-way ANOVA, grouped bars.",
    replicates: true,
    seedColumns: ["", "Control", "Treated"],
    analyses: ["Two-way ANOVA", "Repeated-measures ANOVA", "Mixed-effects model"],
    graphs: ["Grouped/stacked bars", "Grouped box/violin", "Heat map"],
  },
  contingency: {
    kind: "contingency",
    label: "Contingency",
    description: "r×c table of integer counts (one count per cell). For chi-square, Fisher's exact, odds/risk ratios.",
    replicates: false,
    seedColumns: ["", "Outcome 1", "Outcome 2"],
    analyses: ["Contingency (χ² / Fisher)"],
    graphs: ["Grouped bars of counts"],
  },
  survival: {
    kind: "survival",
    label: "Survival",
    description: "Row = subject: an elapsed-time column plus one 1 (event) / 0 (censored) column per group. For Kaplan-Meier + log-rank.",
    replicates: false,
    seedColumns: ["Time", "Group A"],
    analyses: ["Survival (Kaplan-Meier)", "Cox regression"],
    graphs: ["Kaplan-Meier staircase"],
  },
  partsofwhole: {
    kind: "partsofwhole",
    label: "Parts of whole",
    description: "Each column is one whole; each row is a slice of it. For fraction-of-total, goodness-of-fit, pie/donut.",
    replicates: false,
    seedColumns: ["Slice", "Sample 1"],
    analyses: ["Goodness-of-fit (χ² / binomial)"],
    graphs: ["Pie", "Doughnut"],
  },
  multivariable: {
    kind: "multivariable",
    label: "Multiple variables",
    description: "Row = case, column = variable (numeric or categorical), no subcolumns. Unlocks multiple/logistic regression, correlation matrix, PCA, clustering.",
    replicates: false,
    seedColumns: ["Variable 1", "Variable 2", "Variable 3"],
    analyses: ["Multiple linear regression", "Logistic regression", "Correlation matrix", "Principal component analysis (PCA)", "Cluster analysis"],
    // What the New-graph wizard offers for this format, best first (bubble is not listed: it is
    // an XY graph and is offered on XY sheets). PCA graphs come from Analyze ▸ PCA.
    // "Network" is not in this list: the edge list has its own format ("edgelist"),
    // which owns the network graph. A multivariable sheet with two text columns still opens
    // the network door in the wizard (the network genre also lists this format, so an edge list
    // typed on a Multiple-variables sheet can still be drawn as a network).
    graphs: ["Parallel coordinates", "Correlation matrix", "3D scatter", "Heatmap", "Alluvial", "Ternary plot", "Timeline tracks", "PCA score/loadings/biplot"],
  },
  pca: {
    kind: "pca",
    // A dedicated multivariate / ordination sheet. Same data shape as
    // `multivariable` — lead-less, every column a variable, the text column groups cases — but its
    // own format so New-graph on it goes straight to the PCA score plot (wizard, PCA pre-selected),
    // never an empty XY. Reusing multivariable's semantics keeps every analysis / grouping path it
    // already has; only the identity and the default graph differ.
    label: "PCA / ordination",
    description: "Row = case, column = a measured variable; the text column names/groups each case. A PCA-only format — New-graph goes straight to the PCA score plot (biplot, loadings and scree also offered).",
    replicates: false,
    seedColumns: ["Group", "Variable 1", "Variable 2", "Variable 3"],
    // Each badge must match a real method's label — the format registry's gate checks that,
    // so a friendly summary like "Ordination: PCoA, NMDS, CA" is refused. Name them one by one.
    analyses: ["Principal component analysis (PCA)", "Principal coordinates (PCoA — any distance)", "Non-metric multidimensional scaling (NMDS)", "Correspondence analysis (CA — counts, sites + species)", "Redundancy analysis (RDA — constrained by explanatory variables)"],
    graphs: ["PCA score/loadings/biplot", "Ordination triplot", "Scree plot"],
  },
  nested: {
    kind: "nested",
    label: "Nested",
    description: "Subcolumns nested within columns (replicates stacked). For nested t tests and nested (hierarchical) ANOVA.",
    replicates: true,
    seedColumns: ["", "Group A", "Group B"],
    analyses: ["Nested ANOVA / nested t"],
    graphs: ["Nested column scatter / box / violin"],
  },
  sets: {
    kind: "sets",
    label: "Set membership",
    description: "Row = item, one column per set; a non-empty, non-zero cell means the item is a member. For Venn / Euler diagrams (and the UpSet plot).",
    replicates: false,
    seedColumns: ["Item", "Set A", "Set B", "Set C"],
    analyses: [],
    graphs: ["Venn / Euler diagram", "UpSet plot"],
    fixedShape: true,
  },
  timeline: {
    kind: "timeline",
    label: "Subject timeline",
    description: "One row per subject: Start and End (or the survival date pair), optional \"Response start\"/\"Response end\" and \"Ongoing\" columns, and every other numeric column as an event series. For swimmer plots.",
    replicates: false,
    seedColumns: ["Subject", "Start", "End", "Response start", "Response end", "Ongoing"],
    analyses: [],
    graphs: ["Swimmer plot"],
    fixedShape: true,
  },
  meta: {
    kind: "meta",
    label: "Meta-analysis",
    description: "One row per study: a point estimate with its entered Lower and Upper confidence limits (Study label lead). Unlocks the meta-analysis (pooling + heterogeneity), the publication-bias tests (Egger + trim-and-fill), and the forest and funnel plots.",
    replicates: false,
    seedColumns: ["Study", "Estimate", "Lower", "Upper"],
    analyses: ["Meta-analysis (pool studies)", "Publication bias (Egger + trim-and-fill)"],
    graphs: ["Forest plot", "Funnel plot"],
    fixedShape: true,
  },
  edgelist: {
    kind: "edgelist",
    label: "Network (edge list)",
    description: "One row per link: source and target in the first two columns, then an optional weight (a signed weight — e.g. a correlation — colours links by sign) and per-node columns (group, value, size), read from the row where a node first appears as a source. The network graph's sheet (a drawing format — rows are links, not cases, so no statistics apply).",
    replicates: false,
    seedColumns: ["Source", "Target", "Weight"],
    seedRoles: ["x", "y", "y"],
    analyses: [],
    graphs: ["Network graph", "Chord diagram"],
    fixedShape: true,
  },
  association: {
    kind: "association",
    label: "GWAS association results",
    description: "One row per marker/SNP: a label, its Chromosome, Position (bp) and association P-value. The Manhattan + QQ plot sheet (a drawing format — the rows are pre-computed results, not cases, so t-tests / ANOVA / regression over them mislead; only the QQ's genomic inflation λ is a legitimate statistic).",
    replicates: false,
    seedColumns: ["Marker", "Chromosome", "Position", "P-value"],
    seedRoles: ["x", "y", "y", "y"],
    analyses: [],
    graphs: ["Manhattan plot", "QQ plot"],
    fixedShape: true,
  },
  alterations: {
    kind: "alterations",
    label: "Genomic alterations",
    description: "One row per alteration event: a Sample, a Gene, and the Alteration type (missense, truncating, amplification, deep deletion, fusion…). The oncoprint's sheet (a drawing format — the rows are events, not cases, so t-tests / ANOVA / regression over them mislead; one gene × sample cell may hold several alterations).",
    replicates: false,
    seedColumns: ["Sample", "Gene", "Alteration"],
    seedRoles: ["x", "y", "y"],
    analyses: [],
    graphs: ["Oncoprint"],
    fixedShape: true,
  },
};

/** Capability metadata for a format. */
export function tableFormat(kind: TableKind): TableFormatInfo {
  return TABLE_FORMATS[kind];
}

/** All formats in display order (for the new-table picker / Insert menu). */
export function tableFormatList(): TableFormatInfo[] {
  return TABLE_FORMAT_ORDER.map((k) => TABLE_FORMATS[k]);
}

/** Parse a cell to a finite number, or null (blank / non-numeric). */
function asNumber(v: CellValue | undefined): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * Non-blocking warnings for a table given its declared format (surfaced
 * as advice — data is never rejected). Returns an empty array for a
 * well-formed table or a format with no special rules. Used by the table view to
 * nudge users toward the right shape for the analyses the format unlocks.
 */
export function validateTable(table: DataTable): string[] {
  const warnings: string[] = [];
  // The count / value cells only — column 0 is the row-label column for contingency and
  // parts-of-whole, and a numeric label (a dose "2.5", a coded "-1") is not a count. Scanning it
  // would make the negative / whole-number checks fire on the label, a false warning; the analysis
  // extractor likewise reads only the outcome columns, never column 0.
  const valueCells = (): number[] => {
    const out: number[] = [];
    for (const row of table.rows) {
      for (let c = 1; c < table.columns.length; c++) {
        const n = asNumber(row.cells[table.columns[c]!.id]);
        if (n !== null) out.push(n);
      }
    }
    return out;
  };
  // A fresh sheet (nothing typed yet) must not warn about too few rows/values — that advice is
  // premature and reads as "the format is broken" before entry has started. Column-structure checks
  // still fire (a wrong column count is a real shape problem, independent of data).
  const hasData = table.rows.some((r) => Object.values(r.cells).some((v) => v != null && String(v).trim() !== ""));

  switch (table.kind) {
    case "contingency": {
      // Chi-square / Fisher need a ≥2×2 grid: ≥2 count columns (beside the row-label column) and
      // ≥2 rows. Report only what is actually missing — the fresh seed already has 2 count columns,
      // so it must not claim otherwise, and it must not warn about rows before any are entered.
      if (table.columns.length - 1 < 2) warnings.push("A contingency table needs at least 2 count columns (beside the row-label column).");
      else if (hasData && table.rows.length < 2) warnings.push("A contingency table needs at least 2 rows.");
      const nums = valueCells();
      if (nums.some((n) => n < 0)) warnings.push("Counts cannot be negative.");
      if (nums.some((n) => !Number.isInteger(n))) warnings.push("Counts should be whole numbers (integer counts per cell).");
      break;
    }
    case "survival": {
      if (table.columns.length < 2) {
        warnings.push("A survival table needs a time column plus at least one event/censor (1/0) column.");
      }
      // Date-pair entry: both a Start-date and End-date column must be present, and no row
      // may end before it starts (a negative elapsed span — a data-entry error that the
      // analysis silently drops).
      if (table.survivalDates) {
        const startCol = table.columns.find((c) => c.role === "survStart");
        const endCol = table.columns.find((c) => c.role === "survEnd");
        if (!startCol || !endCol) {
          warnings.push("Date entry needs a Start-date and an End-date column.");
        } else if (table.rows.some((row) => {
          const s = asNumber(row.cells[startCol.id]);
          const e = asNumber(row.cells[endCol.id]);
          return s !== null && e !== null && e < s;
        })) {
          warnings.push("Some rows end before they start — the elapsed time would be negative and those rows are dropped.");
        }
      }
      // Event/censor columns should be 1 (event), 0 (censored) or blank. Skip col 0 (the
      // time column) and the date pair (which hold dates, not event codes).
      for (let c = 1; c < table.columns.length; c++) {
        const col = table.columns[c]!;
        if (col.role === "survStart" || col.role === "survEnd" || col.type === "date") continue;
        const bad = table.rows.some((row) => {
          const n = asNumber(row.cells[col.id]);
          return n !== null && n !== 0 && n !== 1;
        });
        if (bad) {
          warnings.push(`Column "${col.name}" should hold 1 (event), 0 (censored) or blank.`);
          break;
        }
      }
      break;
    }
    case "partsofwhole": {
      if (valueCells().some((n) => n < 0)) warnings.push("Parts-of-whole values cannot be negative.");
      break;
    }
    case "multivariable": {
      // Each column is a variable. The analyses this format gates — PCA, correlation matrix,
      // multiple/logistic regression — run on the numeric variables, and they need at least two.
      //
      // A single categorical column is not an error here: it is the group/label column these
      // graphs rely on — PCA colours cases and draws confidence ellipses by group, parallel
      // coordinates colour lines by group, clustering labels the rows. Advising to "code
      // categories as numbers" for an all-text column would be wrong: numeric-coding that column
      // would destroy the very grouping the graph exists to show. So the real precondition is
      // "≥2 numeric variables", not "no text anywhere" — warn only when too few columns are
      // numeric for any of these analyses to run.
      const numericCols = table.columns.filter((col) =>
        table.rows.some((row) => asNumber(row.cells[col.id]) !== null),
      ).length;
      if (hasData && numericCols < 2) {
        warnings.push("Multiple-variables analyses (regression, PCA, correlation matrix) need at least 2 numeric variables (columns).");
      }
      break;
    }
    case "pca": {
      // Same precondition as multivariable: PCA / ordination / clustering need ≥2 numeric
      // variables. A single text column is the group column, not an error.
      const numericCols = table.columns.filter((col) =>
        table.rows.some((row) => asNumber(row.cells[col.id]) !== null),
      ).length;
      if (hasData && numericCols < 2) {
        warnings.push("PCA / ordination needs at least 2 numeric variables (columns).");
      }
      break;
    }
    case "xy": {
      // Structure only.
      //
      // Caution: a "the X column should be numeric" check does not belong here, because it
      // cannot be right: this function sees only the table, and it runs while the user is
      // typing — before any graph or analysis exists — so it has no way to know whether the
      // sheet is a dose-response curve (needs a numeric X) or a labelled matrix (genes x
      // conditions, whose column 0 is row labels and which draws a perfect heatmap). Guessing
      // would tell every heatmap sheet its data is wrong (the demo project's "Gene expression"
      // and "Immune signaling" sheets included), and the New-graph wizard offers a heatmap on an
      // XY sheet. Plot-awareness does not rescue it either — at data entry there is no plot to
      // inspect.
      //
      // A text X is reported where intent is known and the message is actionable: running the
      // analysis. Those paths already fail with an error on it (engine.py: "regression needs >= 3
      // paired values"), because a text column yields no numeric pairs. Improve it there, not here.
      // This mirrors the `hasData` rule above — premature advice reads as "the format is broken".
      if (table.columns.length < 2) {
        warnings.push("An XY table needs an X column and at least one Y column.");
      }
      break;
    }
    case "column": {
      // Lead-less: a comparison needs at least two group columns.
      if (table.columns.length < 2) warnings.push("A column table needs at least two group columns to compare.");
      break;
    }
    case "grouped": {
      // Two/three-way ANOVA + grouped bars need a second grouping factor = ≥2 group columns.
      if (table.columns.length - 1 < 2) warnings.push("A grouped table needs a row-label column plus at least two group columns (the column grouping factor).");
      break;
    }
    case "nested": {
      // Nested t / nested ANOVA compare ≥2 groups, each with replicate subcolumns.
      if (table.columns.length - 1 < 2) warnings.push("A nested table needs at least two group columns; enter replicate subcolumns within each to define the nesting.");
      // …and the nesting itself needs ≥2 replicate subcolumns in at least one group — with
      // one value per group there is nothing to nest (nested ANOVA has no subgroup level). Only
      // once data is being entered, though — a fresh sheet is not "malformed", just empty.
      else if (hasData && replicateCount(table) < 2) warnings.push("A nested table needs replicate subcolumns within each group (≥2) — with a single value per group there is no subgroup level for the nested test.");
      break;
    }
    case "meta": {
      // One row per study: Estimate · Lower · Upper by position after the Study lead.
      if (table.columns.length < 4) {
        warnings.push("A meta-analysis table needs a Study label plus Estimate, Lower and Upper columns.");
      } else if (hasData) {
        // A CI entered backwards cannot be placed — the drawings drop such studies with a
        // warning; say it at the sheet too, where the typo happens.
        const loCol = table.columns[2]!;
        const hiCol = table.columns[3]!;
        const backwards = table.rows.some((row) => {
          const lo = asNumber(row.cells[loCol.id]);
          const hi = asNumber(row.cells[hiCol.id]);
          return lo !== null && hi !== null && lo > hi;
        });
        if (backwards) warnings.push("Some rows have Lower above Upper — the confidence interval is backwards and those studies cannot be placed.");
      }
      break;
    }
    case "timeline": {
      // Structural only (non-blocking, like the rest): a swimmer needs the Subject lead plus
      // Start and End — or the survival date pair. The builder itself refuses with a warning when
      // it cannot draw; this just explains the shape before a graph exists.
      const datePair =
        table.columns.some((c) => c.role === "survStart") && table.columns.some((c) => c.role === "survEnd");
      if (!datePair && table.columns.length < 3) {
        warnings.push("A subject timeline needs a Subject column plus numeric Start and End columns (or the survival date pair).");
      }
      break;
    }
    case "edgelist": {
      // Structural only (non-blocking): the first two columns are the link's endpoints. The
      // builder itself refuses with a warning when it finds no edges; this explains the shape.
      // Note: no "endpoints look numeric" check — numeric node ids (gene/OTU codes) are legal.
      if (table.columns.length < 2) {
        warnings.push("An edge list needs a source column and a target column (the first two columns — one row per link).");
      }
      break;
    }
    case "alterations": {
      // Structural only: Sample · Gene · Alteration, one row per event. The oncoprint builder
      // refuses with a warning when a column is missing; this explains the shape.
      if (table.columns.length < 3) {
        warnings.push("An alterations sheet needs a Sample column, a Gene column and an Alteration column (the first three columns — one row per alteration event).");
      }
      break;
    }
    case "sets": {
      // Structural + cell values: an Item column plus at least one set column; a membership
      // cell is 1 / 0 / blank / x / yes / true — anything else cannot be counted as in or out.
      if (table.columns.length < 2) {
        warnings.push("A membership sheet needs an Item column plus one column per set (a 1, x or yes marks membership).");
      } else {
        const setCols = table.columns.slice(1);
        const ok = (v: unknown): boolean => {
          if (v == null) return true;
          const s = String(v).trim().toLowerCase();
          return s === "" || s === "0" || s === "1" || s === "x" || s === "yes" || s === "no" || s === "true" || s === "false";
        };
        const bad = table.rows.reduce((n, r) => n + setCols.filter((c) => !ok(r.cells[c.id])).length, 0);
        if (bad > 0) warnings.push(`${bad} membership cell${bad === 1 ? "" : "s"} ${bad === 1 ? "is" : "are"} neither in nor out — use 1 / x / yes for a member and 0 / blank for a non-member.`);
      }
      break;
    }
    case "association": {
      // Marker · Chromosome · Position · P-value: the QQ and Manhattan sheet. Structural, plus
      // the two things that make a GWAS row unusable and are easy to type wrong.
      if (table.columns.length < 4) {
        warnings.push("An association sheet needs Marker, Chromosome, Position and P-value columns (the first four columns).");
        break;
      }
      const pos = table.columns[2]!, pcol = table.columns[3]!;
      let badP = 0, badPos = 0;
      for (const r of table.rows) {
        const p = r.cells[pcol.id], x = r.cells[pos.id];
        if (p != null && String(p).trim() !== "") { const v = Number(p); if (!Number.isFinite(v) || v < 0 || v > 1) badP++; }
        if (x != null && String(x).trim() !== "") { const v = Number(x); if (!Number.isFinite(v) || v < 0) badPos++; }
      }
      if (badP > 0) warnings.push(`${badP} P-value${badP === 1 ? "" : "s"} outside 0–1 (or not a number) — those markers cannot be placed.`);
      if (badPos > 0) warnings.push(`${badPos} position${badPos === 1 ? "" : "s"} negative or not a number — those markers cannot be placed along the genome.`);
      break;
    }
    default:
      break;
  }
  return warnings;
}
