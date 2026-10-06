import type { AnalysisResult } from "@mady/contracts";
/**
 * Document model — the versioned, serializable shape of a MadY project.
 *
 * Modelled on the grammar of graphics (layers/aesthetics/scales/facets/themes).
 * Plain data only — behaviour lives in `MadyDocument`.
 */

import type { SimulateSpec } from "./simulate";
import type { ClusterMetric, ClusterLinkage } from "./cluster";
import type { CorrelationMethod } from "./correlation";
import { sciText } from "./sciFormat";

export type NodeId = string;
export type SchemaVersion = number;

export const CURRENT_SCHEMA_VERSION = 5 as const;

export type CellValue = number | string | null;

/**
 * A column's role within its dataset (replicate subcolumn semantics). A
 * "dataset" is a set of columns sharing a `group` id: one or more `y` replicate
 * subcolumns ("enter replicates side-by-side"), or — for the "error
 * values computed elsewhere" entry mode — a `y` mean plus `sd`/`sem` and `n`.
 * `undefined` is the legacy/back-compat shape: column 0 is the X axis, every
 * other column is its own single-replicate `y` dataset.
 */
export type ColumnRole =
  | "x"
  | "y"
  | "sd"
  | "sem"
  | "n"
  | "xerr"
  | "cv"
  | "errlow"
  | "errhigh"
  // Pre-computed centre+spread entered directly (drawn via the same `ReplicateSummary` →
  // `errorPoint` path as raw replicates): `min`/`max` (range), `q1`/`q3` (IQR, lead = median),
  // `geosd` (geometric SD factor, lead = geometric mean), `ci` (95% CI half-width about the mean).
  | "min"
  | "max"
  | "q1"
  | "q3"
  | "geosd"
  | "ci"
  // Survival start/end-date entry (a `date`-typed pair): elapsed time = end − start,
  // computed at analysis time in `table.survivalDates.unit`. Absent = the plain
  // single elapsed-time-column survival format.
  | "survStart"
  | "survEnd";

/**
 * How a column's cells are parsed on entry and formatted for display (the
 * cell types). Storage stays a plain `CellValue`: `date` is a number of days
 * since 1970-01-01 (UTC), `elapsed` a number of seconds, `categorical`/`text`
 * a string, `number` (default) a number. See `cells.ts` for parse/format.
 */
export type ColumnType = "number" | "text" | "date" | "elapsed" | "categorical";

export interface Column {
  id: NodeId;
  name: string;
  /** Role within its dataset. Omitted = "x" for column 0, "y" otherwise. */
  role?: ColumnRole | undefined;
  /**
   * The dataset this column belongs to — the id of the dataset's lead `y`
   * column (replicate/summary columns of one Y dataset share this). Omitted = a
   * standalone column that is its own single-column dataset.
   */
  group?: NodeId | undefined;
  /** Cell type for parse + display. Omitted = `number` (numeric, auto-trimmed). */
  type?: ColumnType | undefined;
  /** Fixed display decimal places (number columns). Storage keeps full precision; omitted = auto-trim. */
  decimals?: number | undefined;
  /**
   * Calculated-variable formula: an expression referencing other columns
   * by letter (A/B/C… = column position) — e.g. `A/B`, `LOG(A)`, `IF(A>0, B, C)`,
   * `A - MEAN(A)`. When set, the column is read-only and its cells are materialised by
   * `recomputeFormulas` on every table edit. Omitted = an ordinary data column. */
  formula?: string | undefined;
}

export interface Row {
  /** Stable identity. Style overrides key to this id, never to row position. */
  id: NodeId;
  /** Values keyed by column id. */
  cells: Record<NodeId, CellValue>;
}

/**
 * The data-table formats — *the format determines capability* (which
 * analyses + graphs a table unlocks). Nine general formats: `xy`/`column`/`grouped`,
 * `contingency` (r×c counts), `survival` (time + 1/0 event columns),
 * `partsofwhole` (each column a whole, rows are slices), `multivariable` (row =
 * case, column = variable — gates multivariate stats + multiple/logistic
 * regression + calculated columns), `pca` (a dedicated multivariate / ordination
 * sheet; New graph on it goes straight to the PCA score plot) and `nested`
 * (subcolumns nested within columns) complete the set. `pca` shares
 * `multivariable`'s data semantics (lead-less; each column a variable, the text
 * column groups cases) — it exists so PCA / ordination data has its own format
 * whose default graph is the score plot, never an empty XY. The remaining six
 * (`sets`, `timeline`, `meta`, `edgelist`, `alterations`, `association`) are
 * fixed-shape formats, each described below. See `tableFormats.ts`.
 */
export type TableKind =
  | "xy"
  | "column"
  | "grouped"
  | "contingency"
  | "survival"
  | "partsofwhole"
  | "multivariable"
  | "pca"
  | "nested"
  /** Set membership: row = item, one column per set; a non-empty, non-zero cell = the item
   *  belongs to that set. The Venn/Euler + UpSet input sheet. */
  | "sets"
  /** Subject timeline: one row per subject — Start/End (or the survival date pair), the
   *  named Response/Ongoing columns, every other numeric column an event series. The
   *  swimmer plot's input sheet (a drawing format: no statistics apply). */
  | "timeline"
  /** Meta-analysis: one row per study — a point estimate with its entered Lower/Upper
   *  confidence limits, Study label lead. The input sheet of the forest and funnel plots and of
   *  the meta-analysis and publication-bias methods. Group-comparison statistics do not apply
   *  (Lower/Upper are not independent groups). */
  | "meta"
  /** Network edge list: one row per link — source and target in the first two columns,
   *  then an optional (signed) weight and per-node attribute columns. The network graph's
   *  input sheet (a drawing format: rows are links, not cases, so case statistics like
   *  correlation/PCA/regression do not apply). */
  | "edgelist"
  /** Genomic alterations: one row per alteration event — Sample · Gene · Alteration type. The
   *  oncoprint's input sheet (a drawing format: rows are events, not cases, so case statistics do
   *  not apply; one cell may hold several alterations). */
  | "alterations"
  /** GWAS association results: one row per marker/SNP — Marker · Chromosome · Position(bp) ·
   *  P-value. The Manhattan + QQ input sheet (a drawing format: rows are pre-computed association
   *  results, not cases, so t-tests/ANOVA/regression over them mislead — only the QQ's genomic
   *  inflation λ is a legitimate statistic). */
  | "association";

/**
 * How a *derived* table is recomputed from a source table — the reactive
 * data-manipulation edge (Transform/Reshape/Frequency/QQ results are
 * *live*). Stored on the derived `DataTable`; an edit to `source` cascade-marks
 * this table `stale` (see `MadyDocument.markDependentsStale`) and it is
 * regenerated deterministically by `recomputeDerived` (`derive.ts`). A
 * discriminated union on `op`; every `spec` is plain serialisable data so it
 * round-trips in the `.mady` JSON. Add a new derivation by extending this union
 * and the `recomputeDerived` switch.
 */
export type TableDerivation =
  | {
      source: NodeId;
      op: "transform";
      /** A `TransformSpec`-shaped object (`fn` widens to string for storage). `xColumn`
       *  supplies X for the X-combining functions; `swapXY` = interchange X and Y. */
      spec: { fn: string; columns: number[]; k?: number; append?: boolean; xColumn?: number; swapXY?: { xCol: number; yCol: number }; seed?: number };
    }
  | {
      source: NodeId;
      op: "reshape";
      spec: {
        mode: "wide-to-long" | "long-to-wide";
        idColumns: number[];
        /** wide-to-long: the columns to unpivot. */
        valueColumns?: number[];
        keyName?: string;
        valueName?: string;
        dropEmpty?: boolean;
        /** long-to-wide: the key/value column indices. */
        keyColumn?: number;
        valueColumn?: number;
        /** long-to-wide: the format the pivoted (wide) result should adopt, so tidy/long data
         *  reaches the right analyses (a two-factor pivot is a `grouped` table, not `xy`).
         *  Persisted in the derivation so a reactive recompute keeps the chosen format. Default
         *  `grouped`. Absent → the legacy `xy`. */
        resultKind?: TableKind;
      };
    }
  | {
      source: NodeId;
      op: "frequency";
      /** `mode: "exact"` = unbinned empirical CDF (ignores bins/binWidth). `fractions` also
       *  emits the relative/cumulative frequencies as fractions (0–1), not only percentages.
       *  `gaussian` appends expected-frequency columns from the data's best-fit normal
       *  (bin-aligned Gaussian overlay). */
      spec: {
        col: number;
        /** ≥2 columns → a per-column (per-subcolumn) frequency on a shared bin grid,
         *  one Count column each (binned modes only). undefined/1 = the single-column table. */
        cols?: number[];
        mode: "auto" | "count" | "width" | "exact";
        bins?: number;
        binWidth?: number;
        cumulativeFromTop?: boolean;
        fractions?: boolean;
        gaussian?: boolean;
      };
    }
  | {
      source: NodeId;
      op: "qq";
      /** `position` is a `PlotPosition` ("blom" | "hazen" | "weibull"); stored as string.
       *  `variant: "lognormal"` runs the QQ on log(values) (default "normal"). */
      spec: { col: number; position: string; variant?: string };
    }
  | {
      source: NodeId;
      op: "simulate";
      /** A seeded simulation — has no real source (`source` is a sentinel, e.g. ""),
       *  so it never reactively recomputes; the spec + seed make it regenerable. */
      spec: SimulateSpec;
    }
  | {
      source: NodeId;
      op: "rowstats";
      /** Per-row summary across `dataColumns` (each row's cells = one sample);
       *  `keepColumns` (X / labels) are carried through; `stats` picks which
       *  statistics to emit (RowStat ids). */
      spec: { dataColumns: number[]; keepColumns?: number[]; stats: string[] };
    }
  | {
      source: NodeId;
      op: "prune";
      /** Keep a subset of rows (same columns); see `pruneRows`. */
      spec: { mode: "everyNth" | "firstN" | "lastN" | "range" | "dropBlank"; n?: number; offset?: number; col?: number; min?: number; max?: number };
    }
  | {
      source: NodeId;
      op: "colmath";
      /** Remove-baseline (mode "baseline") or column arithmetic (mode "columnmath");
       *  see `removeBaseline` / `columnMath`. */
      spec:
        | { mode: "baseline"; dataColumns: number[]; keepColumns?: number[]; baselineFrom: "column" | "firstRow" | "meanRows" | "constant"; baselineCol?: number; from?: number; to?: number; value?: number; operation?: "subtract" | "divide" }
        | { mode: "columnmath"; keepColumns?: number[]; a: number; b: number; operator: "add" | "subtract" | "multiply" | "divide"; resultName?: string };
    }
  | {
      source: NodeId;
      op: "transpose";
      /** Transpose rows↔columns; `labelCol` (≥0) supplies the new headers, −1/out-of-range = generic. */
      spec: { labelCol?: number };
    }
  | {
      source: NodeId;
      op: "extract";
      /** Output the source columns in `columns` order (subset + reorder). */
      spec: { columns: number[] };
    }
  | {
      source: NodeId;
      op: "split";
      /** Split the text of column `col` at `sep` into parts that replace it (`splitTextColumn`). */
      spec: { col: number; sep: string };
    };

export interface DataTable {
  id: NodeId;
  kind: TableKind;
  name: string;
  columns: Column[];
  rows: Row[];
  /**
   * Present only on *derived* tables: how to recompute from `derivation.source`.
   * Absent = a normal authored source table.
   */
  derivation?: TableDerivation | undefined;
  /**
   * Recompute status of a *derived* table: `"stale"` = its source changed and it
   * needs regeneration (mirrors `Plot.status`). Absent/`"ok"` = current; always
   * undefined on a source table.
   */
  status?: "ok" | "stale" | undefined;
  /** Frozen tables are read-only ("Freeze data table"). */
  frozen?: boolean | undefined;
  /** Navigator highlight colour (hex) for this sheet; undefined = none. */
  color?: string | undefined;
  /** Pinned sheets sort to the top of their Navigator container. */
  pinned?: boolean | undefined;
  /**
   * Present on a table imported with a live link to its source file: the file path
   * + the parse options to replay, so the table auto-updates when the file changes
   * on disk (a main-process fs.watch → re-read → `relinkTableData`, which preserves
   * column ids so plots/analyses stay valid). Absent = a normal one-off import.
   */
  linkedSource?: LinkedSource | undefined;
  /**
   * Set when the most recent auto re-read of the linked file failed (unreadable, or its
   * columns changed and need review). The table keeps its last-good data; the message is
   * shown as a badge so a broken auto-update isn't silent. Cleared on the next good read.
   */
  linkError?: string | undefined;
  /**
   * Excluded cells — kept in the data but omitted from analyses/graphs (shown
   * blue-italic + asterisk). Maps a row id to the set of excluded column ids.
   * Read values through `effectiveValue` (`cells.ts`) so exclusions are honoured.
   */
  excluded?: Record<NodeId, NodeId[]> | undefined;
  /**
   * Per-cell background colour — a purely visual highlight for organising the sheet, never
   * touching the data (unlike `excluded`, it does not change analyses or graphs). Maps a row id
   * to `{ colId → CSS colour }`. Keyed by stable ids (like `excluded`) so a fill survives sort,
   * reorder and exclude; a fill on a since-deleted id is simply never rendered.
   */
  cellFills?: Record<NodeId, Record<NodeId, string>> | undefined;
  /**
   * Per-cell pattern overlay (hatch / dots / grid …) — a purely visual fill for organising the
   * sheet, drawn over the cell's `cellFills` colour, never touching the data. Same id-keyed shape
   * and survival rules as `cellFills`: a pattern on a since-deleted id is simply never rendered.
   * Each cell carries a `kind` from the shared `PatternKind` vocabulary + its foreground `color`.
   */
  cellPatterns?: Record<NodeId, Record<NodeId, CellPattern>> | undefined;
  /**
   * Survival tables only: present ⇒ time is entered as a start-date / end-date pair
   * (two `date`-typed columns roled `survStart`/`survEnd`) and elapsed time is computed
   * as `end − start` in `unit` at analysis time. Absent ⇒ the plain single
   * elapsed-time-column format. `unit` divides the day difference (weeks ÷7, months
   * ÷30.4375, years ÷365.25 — the last two approximate). Ignored on non-survival tables.
   */
  survivalDates?: { unit: SurvivalTimeUnit } | undefined;
}

/** Unit for elapsed survival time computed from a start/end date pair. Divides the
 *  day difference: weeks ÷7, months ÷30.4375, years ÷365.25 (months/years approximate). */
export type SurvivalTimeUnit = "days" | "weeks" | "months" | "years";

/** Days per one `SurvivalTimeUnit` — the divisor applied to an (end − start) day
 *  difference. Mean Gregorian month/year so a whole-year span reads as ~1.0. */
export const SURVIVAL_UNIT_DAYS: Record<SurvivalTimeUnit, number> = {
  days: 1,
  weeks: 7,
  months: 30.4375,
  years: 365.25,
};

/**
 * A live link from an imported table back to its source file. The parse options are
 * stored so a re-read reproduces the same table shape (`parseLinkedText`). Text /
 * delimited sources only (an Excel file cannot be linked).
 */
export interface LinkedSource {
  /** Absolute path of the linked source file. */
  path: string;
  /** Column delimiter to replay ("," / "\t" / ";" / " "); undefined = auto-detect. */
  delimiter?: string | undefined;
  /** Whether the grid was transposed on import. */
  transpose?: boolean | undefined;
  /** Preamble rows to drop from the top of the file before header/data (metadata/notes lines). */
  skipRows?: number | undefined;
  /** Whether row 0 is a header (undefined = re-infer on each read). */
  header?: boolean | undefined;
  /** Decimal mark to replay ("," = European); undefined = point / auto-detect on each read. */
  decimal?: "." | "," | undefined;
  /** Tokens to treat as missing on each read (e.g. ["NA","N/A"]); undefined = blanks only. */
  naTokens?: readonly string[] | undefined;
  /** Thousands/grouping separator to strip from numbers on each read ("," / " " / "."). */
  thousands?: string | undefined;
  /** Comment marker whose lines are dropped on each read ("#" / "//"); undefined = none. */
  comment?: string | undefined;
  /** Extra header rows beyond row 0 folded into the column name (a units row) — 0/1. */
  unitRows?: number | undefined;
}

/** A per-element style delta, e.g. `{ color: "#1f9e8f" }`. */
export type StyleDelta = Record<string, string | number>;

/** Axis scale type. `undefined` on a Plot = auto-chosen by the renderer.
 *  "probit" = a probability ("normal-probability paper") axis: values are probabilities
 *  in (0,1), spaced by their inverse-normal quantile (Φ⁻¹), so a normal CDF plots straight. */
export type AxisScale = "linear" | "log10" | "log2" | "ln" | "probit";

/**
 * Tick-number format (Axis tab → Numbering). `auto` = the renderer's default
 * (trimmed decimals on linear; decade values on log). `decimal` = fixed places;
 * `scientific` = mantissa×10ⁿ; `power10` = 10ⁿ exponent labels (log axes);
 * `enotation` = mantissa E exponent (1.5E3); `antilog` = the plain value, never an
 * exponent (a log axis reads 0.001 … 1, 10, 100); `si` = shortened with k/M/G/T (1.5k).
 */
export type NumberFormat = "auto" | "decimal" | "scientific" | "power10" | "percent" | "enotation" | "antilog" | "si";
/** Digit-grouping (thousands) separator for tick numbers. Default "none" (no grouping). */
export type ThousandsSeparator = "none" | "comma" | "period" | "space" | "apostrophe";
/** Decimal mark for tick numbers ("point" = 3.14, "comma" = 3,14). Default "point". */
export type DecimalSeparator = "point" | "comma";

/**
 * Typography for one figure text element (the "Change → Font…" controls). All fields
 * optional; undefined = inherit the figure default (size/weight/colour the
 * renderer picks). `family` = a CSS font stack; undefined = the theme default.
 */
export interface FontSpec {
  family?: string | undefined;
  /** Size in px; undefined = the element's default. */
  size?: number | undefined;
  bold?: boolean | undefined;
  italic?: boolean | undefined;
  /** Text colour (hex); undefined = the theme default (ink / muted). */
  color?: string | undefined;
}

/** The figure text elements whose font can be set independently. */
export type FontElement = "title" | "subtitle" | "axisTitle" | "tick" | "legend" | "sliceLabel" | "valueLabel";

/**
 * Legend placement. `right` = the classic outside-right column (reserves margin);
 * `top` = an outside row above the plot, under the title (reserves a top band, wraps into
 * more rows when the names do not fit the plot's width); the four corners overlay the plot
 * interior; `none` hides it.
 */
export type LegendPosition = "right" | "top" | "topright" | "topleft" | "bottomright" | "bottomleft" | "none" | "direct";

/** Legend configuration (legend formatting). All optional. */
export interface LegendSpec {
  /** Show the legend; undefined = auto (shown when there are ≥2 series). */
  show?: boolean | undefined;
  /**
   * Where the legend sits. Default "right" (outside, vertical column).
   *
   * `"top"` is the other outside place: one horizontal row between the title and the plot,
   * centred on the plot, wrapping into further rows when the names are wider than the plot.
   * The builder reserves the band it needs above the plot rect (the plot gets shorter, never
   * narrower), the way "right" reserves a column. `orientation` is ignored there — an outside
   * row is horizontal by definition.
   *
   * `"direct"` is not a place — it is the other answer to the same question. Instead of a key
   * the reader must look away to decode, each series is named on the drawing beside its own
   * line, in its own colour, and no legend block is drawn at all. Publication figures often
   * read better this way.
   *
   * Only offered where a series has marks to sit beside. A pie's slices, a treemap's cells
   * and a radar's spokes are already labelled on the drawing, so a direct label would print the
   * same word twice. The Inspector's list is derived from the builder by
   * `direct-labels-offered.test.tsx`, never hand-kept.
   */
  position?: LegendPosition | undefined;
  /** Lay entries in a row vs a column. Default "vertical". */
  orientation?: "vertical" | "horizontal" | undefined;
  /** Draw a frame around the legend box. Default false. */
  border?: boolean | undefined;
  /** Fill the legend box with the paper colour (so it reads over the plot). Default false. */
  background?: boolean | undefined;
  /** Distance (px) between the plot and an outside legend column ("right"). Default 12. */
  gap?: number | undefined;
  /** Padding (px) between the plot corner and an inside legend (the corner positions). Default 8. */
  inset?: number | undefined;
  /**
   * Size of the legend's symbols (the swatch: marker, line stub, dot) as a multiple of the
   * size they take from the legend font. Default 1. Range 0.4–3.
   *
   * A multiplier, not a pixel size: the swatch size derives from the legend font so that a
   * larger font draws larger symbols (fixed pixel sizes — marker 4px, dot r3, a 12×2.4px line
   * stub — would draw tiny symbols beside 24px text), and the multiplier adjusts that
   * font-derived size. An absolute pixel field would lose the link to the font.
   *
   * Note: the swatch column width follows it, and the builder reserves the outside-right margin
   * from the same number — a symbol that grows without the reservation growing just lands
   * under the labels.
   */
  symbolScale?: number | undefined;
  /**
   * What a bar series' key shows when the chart draws both the bar and its data points: the bar (a fill block,
   * the default) or the data point (the dot exactly as drawn over the bar); the choice is offered whenever both are
   * shown. Undefined = "bar". A series that
   * draws no points keeps the bar either way.
   */
  barKey?: "bar" | "point" | undefined;

  /* ── The legend's own frame, paper and padding ───────────────────────────────────────────
   *
   * `border` and `background` above are on/off switches; these fields set how the frame looks.
   * The renderer defaults are a 1 px `var(--line)` stroke, a `var(--bg)` fill, a 4 px corner
   * radius and a 6 px pad; the fields let a figure on tinted paper, or a journal style that
   * wants a hairline key box, choose otherwise.
   *
   * Every field is optional and falls back to the renderer default, so a legend that
   * sets none draws with the renderer defaults. A new preset parameter must not
   * change the current defaults or any existing preset (`preset-invariance.test.ts`).
   */
  /** Frame colour; undefined = the theme's line colour. Needs `border`. */
  borderColor?: string | undefined;
  /** Frame thickness px; undefined = 1. Needs `border`. */
  borderWidth?: number | undefined;
  /** Frame corner radius px; undefined = 4. 0 = square corners. */
  borderRadius?: number | undefined;
  /** Box fill; undefined = the theme's paper colour. Needs `background`. */
  backgroundColor?: string | undefined;
  /**
   * Padding px between the frame and the rows; undefined = 6.
   *
   * Note: the outside-right margin reservation follows it. A fixed `+ 10` for the box's own
   * padding would let a larger pad push the rows under the figure edge — the same issue the
   * `symbolScale` note above describes.
   */
  padding?: number | undefined;
}

/**
 * An on-graph annotation (the annotation layer). `hline`/`vline` = a reference
 * line at an axis `value` spanning the plot; `text` = a free text box anchored
 * in data space (`x`/`y`); `bracket` = a significance bar spanning `from`..`to`
 * at height `bracketY` with a `label` (e.g. "***").
 *
 * **Drawing shapes**: `rect`/`ellipse` occupy a fractional plot-space box
 * (`x`,`y` top-left + `w`,`h`); `arrow`/`segment` run from (`x`,`y`) to (`x2`,`y2`)
 * in fractional plot-space; `callout` = a text box at (`x`,`y`) with an arrow to a
 * target (`x2`,`y2`). Fractional anchoring keeps shapes in place on resize/zoom.
 * Only the fields a kind needs are set — all optional so the shape persists cleanly.
 */
export type AnnotationKind =
  | "hline"
  | "vline"
  | "text"
  | "bracket"
  | "rect"
  /** Highlight box: a `rect`-shaped region with a bold coloured outline + a faint
   *  same-colour tint (a "highlighter" over a region of the plot). */
  | "highlight"
  | "ellipse"
  | "arrow"
  | "segment"
  | "callout"
  /** An embedded image (logo / diagram / micrograph), placed in a fractional plot-space box like `rect`.
   *  The bytes live in `href` as a self-contained data URI, so the `.mady` file needs no external asset. */
  | "image"
  /** Shaded band behind the plot: `vband` spans an X range (full height), `hband` a Y range (full width). */
  | "vband"
  | "hband";

/** Arrowhead placement for arrow/segment/callout shapes. */
export type ArrowHead = "none" | "end" | "both";

/** The annotation kinds that occupy a free 2-D plot-space box and can be aligned /
 *  distributed as objects (the "Arrange" toolbar). Reference lines and brackets are
 *  axis-locked (their position is a data value); bands span a whole axis and carry their
 *  own placement (fractional, or an axis-value range when data-anchored) — all excluded. */
export function isArrangeableAnnotation(kind: AnnotationKind): boolean {
  return (
    kind === "text" ||
    kind === "callout" ||
    kind === "rect" ||
    kind === "highlight" ||
    kind === "ellipse" ||
    kind === "image" ||
    kind === "arrow" ||
    kind === "segment"
  );
}

export interface Annotation {
  id: NodeId;
  kind: AnnotationKind;
  /** Reference-line axis value (hline = Y, vline = X). */
  value?: number | undefined;
  /** Label text (line caption / text-box body / bracket label / callout text). */
  label?: string | undefined;
  /** Stroke / text colour; undefined = theme default. */
  color?: string | undefined;
  /** Line dash (hline / vline / bracket / shape border). Default "dashed" for ref lines, "solid" for shapes. */
  dash?: LineDash | undefined;
  /** Line / border width px. Default 1.5. */
  width?: number | undefined;
  /** Font size px of the text: a text box / callout, or the caption of a band or reference line
   *  ("hline"/"vline"/"hband"/"vband"); undefined = a sensible default (a caption: the legend font). */
  size?: number | undefined;
  /** Text-box font family stack (kind "text"/"callout"); undefined = theme default. */
  fontFamily?: string | undefined;
  /** Bold text (kind "text"/"callout"). */
  bold?: boolean | undefined;
  /** Italic text (kind "text"/"callout"). */
  italic?: boolean | undefined;
  /** Anchor as a fraction of the plot rect, 0..1: text/callout anchor, or rect/ellipse top-left, or shape start point. */
  x?: number | undefined;
  y?: number | undefined;
  /** Second point as a fraction of the plot rect (arrow/segment/callout end; unused otherwise). */
  x2?: number | undefined;
  y2?: number | undefined;
  /** Box size as a fraction of the plot rect (rect/ellipse/image). */
  w?: number | undefined;
  h?: number | undefined;
  /**
   * Data-anchored zone band (kind hband/vband): the band spans this axis-value range
   * instead of a fraction of the plot — hband a Y range [bandLo, bandHi], vband an X range.
   * When both are set the band is re-placed on every rebuild through the same value→pixel
   * scale a reference line uses (so it tracks the axis when the data / zoom / scale change)
   * and clips to the axis; its geometry is axis-locked — edited by value in the Inspector like
   * hline/vline, not dragged — so the fractional `x`/`w` (`y`/`h`) are ignored while set.
   * Absent = the original fractional band. Opt-in: a new band starts fractional; the Inspector's
   * "Anchor" toggle sets/clears these. Order-independent (lo/hi are sorted at build).
   */
  bandLo?: number | undefined;
  bandHi?: number | undefined;
  /** Image bytes as a self-contained data URI (kind "image"); embeds in the `.mady` file. */
  href?: string | undefined;
  /** Interior fill colour for rect/ellipse/callout box; undefined = no fill (transparent). */
  fill?: string | undefined;
  /** Interior fill opacity (0–1). Default 1. */
  fillOpacity?: number | undefined;
  /** Text box (text / callout): the words' alignment inside their box. The box stays centred on the
   *  text's point; `fill`/`fillOpacity` are its background, `borderColor` + `width` + `dash` its border, `w` its
   *  wrap width (a plot-rect fraction; canvas px on the figure canvas). Undefined = centred. */
  align?: "start" | "middle" | "end" | undefined;
  /** Text box: space between the words and the box edge (px). Undefined = 6 across, 4 down. */
  padding?: number | undefined;
  /** Text box: corner radius (px). Undefined = 4. */
  radius?: number | undefined;
  /** Text box: border colour; undefined = no border. */
  borderColor?: string | undefined;
  /** Data anchor: pin a point to axis values instead of a place on the plot — a text's point, or
   *  the end (tip) of a callout / arrow / line. Each axis on its own (presence is the flag, like `bandLo`/`bandHi`);
   *  the point then follows the data when the axis range changes. On a horizontal-bar chart the value axis is drawn
   *  across, so `anchorY` moves the point sideways. An axis that cannot take a value (a category axis) keeps the
   *  plot position and says so in the warnings. The fractional `x`/`y` (`x2`/`y2`) keep tracking the point, so
   *  going back to a plot position never jumps. */
  anchorX?: number | undefined;
  anchorY?: number | undefined;
  /** Arrowhead placement (arrow/callout = "end"; segment = "none"). */
  arrowHead?: ArrowHead | undefined;
  /** Rotation in degrees about the shape centre (rect/ellipse). Default 0. */
  rotation?: number | undefined;
  /** Bracket span on X (kind "bracket") + its Y height. */
  from?: number | undefined;
  to?: number | undefined;
  bracketY?: number | undefined;
  /** `bracketY` was computed by the significance planner's data-unit ladder, not set by a
   *  hand. The planner cannot know pixel ink (a default-sized data point's disc extends ~14px
   *  above the top value), so the scene's collision pass may lift a planned ladder — every
   *  planned bracket together, uniformly, so shared rungs stay shared — clear of the drawn
   *  ink. Dragging the height is a decision: [[MadyDocument.moveAnnotation]] clears this
   *  flag, and a hand-set height is never moved (a rule, asserted in buildScene.test). */
  plannedY?: boolean | undefined;
  /** Free lateral offset of a bracket along the category axis, as a fraction of the plot
   *  rect's width (or its height on a transposed chart). 0 / undefined = centred on the
   *  two groups it spans — the position the auto-placer chose, and the magnetic "home"
   *  a canvas drag snaps back to. `bracketY` moves it along the value axis; together the
   *  two make a bracket freely draggable instead of locked to one axis. */
  bracketShift?: number | undefined;
  /** Per-bracket shape override (square corners / rounded / curly brace / plain bar);
   *  undefined = the plot-wide `significance.shape`. */
  bracketShape?: BracketShape | undefined;
  /** Per-bracket legs override — equal (a flat bracket) or reaching down to each end's own
   *  bar; undefined = the plot-wide `significance.legs`. Bar charts only, like that setting. */
  bracketLegs?: "equal" | "reach" | undefined;
  /** Sub-bar (cell) refinement of a bracket endpoint on a side-by-side grouped bar: the
   *  1-based dataset position inside the category `from`/`to` names — so a bracket can say
   *  "Control vs Treated within Day 1". Undefined = the whole-category
   *  centre. Only the grouped bar layouts have a sub-position to point
   *  at; a kind/layout without one refuses the endpoint with a `warnings` entry, and
   *  the Inspector withholds the picker there. */
  fromSeries?: number | undefined;
  toSeries?: number | undefined;
  /** Per-bracket label parts: show the significance signs and/or the
   *  numeric p-value, ticked independently on the clicked bracket. Both undefined = the
   *  plot-wide `significance.display` verbatim, so every saved figure keeps its text.
   *  When either is set: signs default on, p defaults off, joined with a space —
   *  `★★ p=0.0043` when both. Both false = a bare bracket (an explicit choice, unlike
   *  `hideNs` which suppresses the whole element). */
  showSymbol?: boolean | undefined;
  showP?: boolean | undefined;
  /** Free position & size for a bracket: tick to unlock it from the
   *  groups its endpoints name. Round handles appear on its ends; dragging one stores that
   *  end in `x`/`x2` as a fraction of the plot rect along the category axis (the same
   *  plot-space convention the drawing shapes use), each end independently — an end never
   *  dragged keeps standing on its group. Unticking clears `x`/`x2`, snapping the bracket
   *  back to the groups it names; `bracketY`/`bracketShift` keep working throughout. */
  freeform?: boolean | undefined;
  /** Comparison p-value behind a significance bracket; when set, the bracket's
   *  label is rendered from it via the plot's `significance` format (else `label`). */
  p?: number | undefined;
  /** A user-typed label that wins over the live p-derived one, without discarding `p`.
   *
   *  Deliberately a separate field rather than reusing `label`: auto-placed brackets
   *  already store a frozen `label` beside `p`, so making `label` win would pin every
   *  existing bracket to its creation-time text and break the display / decimals /
   *  threshold switches. Clearing this reverts to the live p. */
  labelOverride?: string | undefined;
  /** Provenance tag for managed annotations: "stats" = the key-result label (the
   *  "Show key stats" toggle); "equation" = the best-fit equation label (the "Show
   *  fit equation" toggle). Still freely movable / editable / deletable. */
  role?: "stats" | "equation" | "significance" | undefined;
  /** Where a significance marker's `p` came from, so a re-run can re-sync it and a second
   *  "add brackets" can update rather than stack a duplicate. Parsed once at creation:
   *  re-parsing the term later is how a group name silently rots (survival appends
   *  " (log-rank)", two-way cell means join with " · "). */
  sig?: SignificanceRef | undefined;
  /** Object-group id: annotations sharing a `group` translate together when one is
   *  dragged (the "Group objects" command). Undefined = ungrouped. */
  group?: NodeId | undefined;
  /** Locked: the object can't be moved / resized by dragging (guards accidental edits).
   *  Style/text edits and deletion still work. Default false. */
  locked?: boolean | undefined;
  /**
   * A drawn line (hline / vline / segment / arrow — [[canJoinLegend]]) listed as a row of the
   * series legend: its own dash, colour and width as the key, its `label` as the words. While it
   * is in the legend its caption is not drawn on the plot — the row replaces it. Where no legend
   * block is drawn (hidden, or direct labels) the caption stays. Set by the "Show in legend" box
   * or by dropping the caption onto the legend. Default off.
   */
  inLegend?: boolean | undefined;
  /** Free drag offset (px) of a drawn line's caption from where the line puts it; the line does
   *  not move. Undefined = the caption's home. Line kinds only ([[canJoinLegend]]). */
  labelOffset?: { dx: number; dy: number } | undefined;
}

/** The annotation kinds that are drawn lines — the ones that can be listed in the legend
 *  ([[Annotation.inLegend]]) and whose caption drags on its own ([[Annotation.labelOffset]]). */
export function canJoinLegend(kind: AnnotationKind): boolean {
  return kind === "hline" || kind === "vline" || kind === "segment" || kind === "arrow";
}

/** How a significance bracket's p-value is shown. `stars` = `*`/`**`/`***`/`****`;
 *  `numeric` = `p=0.012`; `threshold` = `p<0.05`/`p<0.01`/… */
export type SignificanceDisplay = "stars" | "numeric" | "threshold";

/** How a significance bracket is drawn between its two end-ticks.
 *  `bracket` = a square-cornered staple (the default); `rounded` = the same with radiused
 *  corners and round line ends; `brace` = a curly brace peaking at the label;
 *  `line` = a plain bar with no end-ticks at all (the minimal journal style). */
export type BracketShape = "bracket" | "rounded" | "brace" | "line";

/** Plot-wide significance-bracket formatting (the "significance" options). */
export interface SignificanceStyle {
  /** Label style for brackets carrying a p-value. Default "stars". */
  display?: SignificanceDisplay | undefined;
  /** Decimal places for the numeric display. Default 3 (e.g. p=0.012). */
  decimals?: number | undefined;
  /** Bracket line + label colour for all significance brackets; undefined = per-bracket/theme. */
  color?: string | undefined;
  /** Bracket line width for all significance brackets; undefined = per-bracket (1.5). */
  width?: number | undefined;
  /** Bracket shape for all significance brackets; undefined = per-bracket, else "bracket". */
  shape?: BracketShape | undefined;
  /** How long the two legs are. "equal" (default): both the tick length — a flat bracket high
   *  over both bars. "reach": each leg runs down to just above its own bar (bar end · error
   *  bar · points), so a bracket between a tall and a short bar has a long leg on the short
   *  side instead of hovering. Bar charts only; brace and line shapes have no legs to lengthen. */
  legs?: "equal" | "reach" | undefined;
  /** End-tick length in px — how far the bracket's ends turn back toward the data.
   *  Default 6. 0 draws a plain bar (the same look as `shape: "line"`). */
  tick?: number | undefined;
  /** Font size (px) of the symbol above the bracket; undefined = the legend font size. */
  labelSize?: number | undefined;
  /** Symbol colour; undefined = the bracket's own colour (line and text as one). Set it
   *  to print black stars over a grey bracket, which several journals ask for. */
  labelColor?: string | undefined;
  /** Show an auto threshold legend at the bottom (e.g. `* p<0.05  ** p<0.01 …`). Default false. */
  legend?: boolean | undefined;
  /** What goes between the legend's entries. Default "; " — the entries are separate
   *  facts and would run together as one string if only spaces divided them. */
  legendSeparator?: string | undefined;
  /** Legend caption font size (px); undefined = the legend font size. */
  legendSize?: number | undefined;
  /** Legend caption font family stack; undefined = the figure's font. */
  legendFontFamily?: string | undefined;
  /** Legend caption bold / italic. Default false. */
  legendBold?: boolean | undefined;
  legendItalic?: boolean | undefined;
  /** Legend caption colour; undefined = the muted theme ink. */
  legendColor?: string | undefined;
  /** Free drag offset (px) of the legend caption from its centred anchor; undefined =
   *  centred (the magnetic home the drag snaps back to). */
  legendOffset?: { dx: number; dy: number } | undefined;
  /** Print a very small p exactly, typeset, instead of flooring it.
   *
   *  Default false = the journal-standard floor (`p<0.001` at 3 decimals): past a few
   *  decimals the exact value is not meaningful, and most style guides cap it.
   *  True = `p=1.2 × 10⁻⁶`, which is what a reader wants when the result is the headline.
   *  Published figures differ on this, so it is an option rather than a house rule.
   *
   *  Only affects the `numeric` display — `stars` and `threshold` are cut-point
   *  vocabularies by definition and have no exact form to show. */
  exactP?: boolean | undefined;
  /** The user's own threshold ladder: what counts as significant, and what to print.
   *
   *  Undefined = the factory ladder, so an existing figure renders byte-identically.
   *  Once set, this is the vocabulary for both symbolic displays (`stars` and
   *  `threshold`) — at that point the symbols are what the user typed. */
  thresholds?: SignificanceThreshold[] | undefined;
  /** What to print for a p that clears no rung. Default "ns" — only reachable when
   *  `hideNs` is turned off, since a hidden comparison prints nothing at all. */
  nsSymbol?: string | undefined;
  /** Draw nothing at all for a comparison that clears no rung. A bracket with no label
   *  is meaningless, so this suppresses the whole element, not just its text.
   *
   *  **Default true**: the auto-placer already skips non-significant comparisons, so a
   *  drawn "ns" only comes from a hand-set p or an explicit "all comparisons" run — and a
   *  figure full of ns rails costs vertical space without adding information. Set it to `false` (not undefined) to show them again; `undefined`
   *  means "follow the default", which is to hide. */
  hideNs?: boolean | undefined;
}

/** Provenance for a managed significance annotation. */
export interface SignificanceRef {
  /** The `Analysis.id` that produced the p-value. */
  analysisId?: NodeId | undefined;
  /** The tidy row's `term`, verbatim — the join key back into the result. */
  term?: string | undefined;
  /** The two group names, as resolved when the marker was placed. */
  groupA?: string | undefined;
  groupB?: string | undefined;
  /** What those names denote, so a re-sync can re-resolve the endpoints. `cell` = a
   *  "row · dataset" cell name (a within-group marker from a two-way cell-means run). */
  domain?: "dataset" | "row" | "cell" | "pcaGroup" | undefined;
  /** The user has hand-edited this marker — a re-sync leaves it alone. */
  pinned?: boolean | undefined;
  /** The re-run no longer produces this comparison. Flagged, never auto-deleted. */
  stale?: boolean | undefined;
}

/** One rung of the significance ladder: a p strictly below `p` prints `symbol`. */
export interface SignificanceThreshold {
  /** Strict upper bound, 0 < p ≤ 1. */
  p: number;
  /** What to print. Free text — "*", "★", "p<0.05", "a" — so a lab's own convention fits. */
  symbol: string;
}

/**
 * The factory ladder: the canonical cut-points, printed as solid stars.
 *
 * The solid star glyph is used rather than the typographic asterisk: an `*` sits on the
 * text baseline's shoulder, so a run of them reads as superscript rather than as a mark
 * of its own, and it is the one glyph in the figure that has to be legible at a glance.
 * A graph with its own ladder is unaffected, and Reset in
 * the ladder editor returns to exactly this.
 */
export const FACTORY_SIGNIFICANCE_THRESHOLDS: readonly SignificanceThreshold[] = [
  { p: 0.0001, symbol: "★★★★" },
  { p: 0.001, symbol: "★★★" },
  { p: 0.01, symbol: "★★" },
  { p: 0.05, symbol: "★" },
];

/** The same cut-points in the `p<…` vocabulary, for `display: "threshold"`. */
export const FACTORY_THRESHOLD_LABELS: readonly SignificanceThreshold[] = [
  { p: 0.0001, symbol: "p<0.0001" },
  { p: 0.001, symbol: "p<0.001" },
  { p: 0.01, symbol: "p<0.01" },
  { p: 0.05, symbol: "p<0.05" },
];

/**
 * The ladder actually in force: the user's rows if they set any, else the factory ladder
 * for this display. Sorted ascending by p, so the first rung a value clears is the
 * strongest one that applies.
 *
 * Deliberately total — it never throws. A user typing into a ladder editor passes through
 * every half-finished state, so invalid rows (a blank symbol, p = 0, a duplicate cut-point,
 * rows entered out of order) are normalised rather than rejected: duplicates keep the
 * first, and an unusable row is dropped. An empty ladder is legal and means "everything
 * is ns" — the editor's live preview is what makes that visible rather than mysterious.
 */
export function resolveThresholds(
  list: readonly SignificanceThreshold[] | undefined,
  display: SignificanceDisplay = "stars",
): SignificanceThreshold[] {
  const factory = display === "threshold" ? FACTORY_THRESHOLD_LABELS : FACTORY_SIGNIFICANCE_THRESHOLDS;
  if (list === undefined) return factory.slice();
  const seen = new Set<number>();
  const rows = list
    .filter((t) => Number.isFinite(t?.p) && t.p > 0 && t.p <= 1 && typeof t.symbol === "string" && t.symbol !== "")
    .filter((t) => (seen.has(t.p) ? false : (seen.add(t.p), true)))
    .sort((a, b) => a.p - b.p);
  return rows;
}

/**
 * Format a p-value for a significance bracket per the chosen `display`
 * (the significance label options). Stars/threshold use the canonical
 * 0.05/0.01/0.001/0.0001 cut-points; numeric shows `p=…` to `decimals` places
 * (and `p<10⁻ᵈ` below the displayable floor). `ns` when p ≥ 0.05.
 *
 * `exact` lifts the numeric floor: below it, the value is typeset in scientific
 * form (`p=1.2 × 10⁻⁶`) rather than reported as `p<0.001` — never as `1.2e-6`,
 * which reads as unfinished in a figure. Off by default.
 */
export function formatSignificance(
  p: number,
  display: SignificanceDisplay = "stars",
  decimals = 3,
  exact = false,
  /** The user's ladder. Omitted ⇒ the factory ladder, i.e. the behaviour above verbatim. */
  opts: { thresholds?: readonly SignificanceThreshold[] | undefined; nsSymbol?: string | undefined } = {},
): string {
  if (!Number.isFinite(p)) return "";
  const ns = opts.nsSymbol ?? "ns";
  if (display === "stars" || display === "threshold") {
    // First rung the value clears, walking the ascending ladder — so the strongest
    // applicable symbol wins.
    const rung = resolveThresholds(opts.thresholds, display).find((t) => p < t.p);
    return rung ? rung.symbol : ns;
  }
  const d = Math.max(0, Math.min(6, Math.round(decimals)));
  const floor = Math.pow(10, -d);
  if (p >= floor) return `p=${p.toFixed(d)}`;
  // Below the floor: either report the cap, or print the real number properly.
  // p = 0 exactly is underflow, not a measurement — no exact form is accurate there.
  return exact && p > 0 ? `p=${sciText(p, 2)}` : `p<${floor.toFixed(d)}`;
}

/**
 * Which field a rename types into: the live-p brackets get `labelOverride`, everything
 * else gets `label`. An empty string clears, reverting a bracket to its p-derived text.
 *
 * Exported because the routing is the contract, and more than one caller has to agree on
 * it: the canvas rename handler and `annotation-census.test.tsx` both go through here, so a
 * test that says "the rename reaches the drawing" is testing the real path rather than
 * a re-implementation of it. Kept out of `updateAnnotation` on purpose — a mutation that
 * quietly redirects one field into another hides mistakes.
 */
export function annotationRenamePatch(
  a: Pick<Annotation, "p">,
  text: string,
): { label?: string | undefined; labelOverride?: string | undefined } {
  const value = text.trim() === "" ? undefined : text;
  return a.p != null ? { labelOverride: value } : { label: value };
}

/** `formatSignificance` driven by a whole `SignificanceStyle` — the form every caller
 *  that has the plot's style should use, so the ladder is never accidentally dropped. */
export function formatSignificanceWith(p: number, sig?: SignificanceStyle): string {
  return formatSignificance(p, sig?.display ?? "stars", sig?.decimals ?? 3, sig?.exactP ?? false, {
    thresholds: sig?.thresholds,
    nsSymbol: sig?.nsSymbol,
  });
}

/**
 * Category groups on a banded axis — a grouping over the categories (not the
 * series), drawn as up to four redundant channels at once.
 *
 * Group membership is matched by category label, never by row index, so
 * filtering or reordering the data can never silently mis-assign a group: an
 * unmatched category simply falls outside every group and renders ungrouped.
 *
 * The group name is data (it comes from a column), so it is renamed in the
 * datasheet like any other cell — the canvas only owns its position
 * (`nameOffsets`), matching the builder-owned-label rule.
 */
export interface CategoryGroupSpec {
  /** Column whose cell on each row names that row's group. Undefined = use `map`. */
  column?: NodeId | undefined;
  /** Explicit category-label → group-name map. Wins over `column` when both are set. */
  map?: Record<string, string> | undefined;
  /** Per-group colour (keyed by group name); a group with no entry takes the
   *  plot palette in first-appearance order. */
  colors?: Record<string, string> | undefined;
  /** Colour each category's tick label text by its group — the strongest of the four
   *  channels. Default true. */
  labelColor?: boolean | undefined;
  /** Rule between adjacent groups, at each group's leading edge. Default true. */
  separators?: boolean | undefined;
  /** Separator dash pattern; undefined = dashed ("4 3"). Pass "" for a solid rule. */
  separatorDash?: string | undefined;
  /** Print the group's name alongside the axis — rotated 90° down the right edge for a
   *  vertical category axis, horizontal beneath the tick labels for a horizontal one.
   *  Reserves its own band, so it never collides with the data. Default true. */
  names?: boolean | undefined;
  /** Faint block tint behind each group's categories, spanning the plot. Default false —
   *  it is the most intrusive channel and real figures use it sparingly. */
  tint?: boolean | undefined;
  /** Tint alpha. Default 0.06. */
  tintOpacity?: number | undefined;
  /** Per-group-name drag offsets (scene px, keyed by group name) — set by dragging a
   *  group name. A missing entry centres the name on its group. */
  nameOffsets?: Record<string, { dx: number; dy: number }> | undefined;
}

/**
 * Per-axis configuration (the Axis tab, one section per axis). All optional;
 * the renderer fills sensible defaults. `min`/`max` undefined = auto-fit that
 * end; set either to pin it (manual range). `title` undefined = follow
 * the source column name.
 */
export interface AxisSpec {
  /** Scale type; undefined = renderer auto-suggests (log10 for wide positive spans). */
  scale?: AxisScale | undefined;
  /** Manual lower bound; undefined = auto-fit. */
  min?: number | undefined;
  /** Manual upper bound; undefined = auto-fit. */
  max?: number | undefined;
  /** Reverse the axis direction (high→low). Default false. */
  reversed?: boolean | undefined;
  /** Tick-number format. Default "auto". */
  format?: NumberFormat | undefined;
  /** Fixed decimal places (decimal/scientific). undefined = trim trailing zeros. */
  decimals?: number | undefined;
  /** Text prepended to every tick label (e.g. "$"). */
  prefix?: string | undefined;
  /** Text appended to every tick label (e.g. "%"). */
  suffix?: string | undefined;
  /** Digit-grouping (thousands) separator for tick numbers: comma 1,000,000 · period
   *  1.000.000 · space 1 000 000 · apostrophe 1'000'000. Default "none" (no grouping). */
  thousands?: ThousandsSeparator | undefined;
  /** Decimal mark for tick numbers ("point" = 3.14, "comma" = 3,14). Default "point".
   *  Pair with `thousands:"period"` for the European 1.234,5 convention. */
  decimalSep?: DecimalSeparator | undefined;
  /** Manual axis title; undefined = follow the source column name. */
  title?: string | undefined;
  /** Free drag offset (px) of the axis title from its default position. */
  titleOffset?: { dx: number; dy: number } | undefined;
  /**
   * Per-axis title typography — overrides the shared `fonts.axisTitle` for this
   * axis only (so the X and Y titles can differ). Each field falls back to the
   * shared axis-title font, then the theme default. Undefined = fully inherit.
   */
  titleFont?: FontSpec | undefined;
  /**
   * Per-axis tick-label typography — overrides the shared `fonts.tick` for this axis only.
   *
   * The reason it exists: on a category axis these labels are names (treatments, groups),
   * and on the value axis they are numbers. Most bar figures want the names larger than the
   * numbers, which one shared size cannot express. Same field-by-field merge as `titleFont`,
   * so `{ size: 22 }` enlarges only the size and keeps the shared family/weight.
   */
  tickFont?: FontSpec | undefined;
  /** Manual spacing between major ticks; undefined = auto (the "nice" interval). */
  majorStep?: number | undefined;
  /** Minor ticks per major interval (linear axes); undefined = none. */
  minorCount?: number | undefined;
  /** Axis breaks / cuts (linear and log axes): data ranges [from, to] to omit, each
   *  drawn as a compressed gap with a break mark. Several cuts allowed. undefined = none. */
  breaks?: Array<{ from: number; to: number }> | undefined;
  /** Break-mark glyph drawn at each cut: "slash" (∕∕, default), "zigzag" (a wave),
   *  or "gap" (a clean erased gap with no glyph). */
  breakStyle?: "slash" | "zigzag" | "gap" | undefined;
  /** Axis line + tick colour (hex); undefined = theme default. */
  lineColor?: string | undefined;
  /** Axis line thickness px; undefined = 1.25. */
  lineWidth?: number | undefined;
  /** Tick-mark thickness px; undefined = follow the axis line thickness (`lineWidth`). */
  tickWidth?: number | undefined;
  /** Tick-mark length px for this axis; undefined = the plot-wide `tickLen` (default 5). */
  tickLen?: number | undefined;
  /** Hide this axis's tick marks (labels stay). undefined/false = show. A per-axis override of
   *  the plot-wide `tickDir` "none". */
  hideTicks?: boolean | undefined;
  /** Gap (px) between the tick labels and the axis (tick-label spacing). Undefined = default (X 6, Y 8). */
  tickLabelGap?: number | undefined;
  /** Gap (px) between the axis title and the tick labels. Undefined = default (6). */
  titleGap?: number | undefined;
  /**
   * Direction of a vertical axis's title (on-screen Y, Y2, Y3), in degrees turned
   * anticlockwise from level: 0 = level, 90 = turned to read upwards (the left axis's
   * default), 270 = turned to read downwards (a right axis's default). Undefined = that default.
   * Ignored, with a warning, on an axis drawn across the figure.
   */
  titleAngle?: number | undefined;
  /** A level vertical-axis title written above the top end of its axis instead of beside it. */
  titleAbove?: boolean | undefined;
  /** Which side of the axis line the tick labels (and, on a 3-D scatter, the name) sit on.
   *  "auto" (default) = the outward side away from the plot/cube; "flip" = the opposite side.
   *  Honoured only by the 3-D scatter (its edges have no fixed inside/outside). */
  labelSide?: "auto" | "flip" | undefined;
  /** Extra ticks + gridlines at explicit data values, each with an optional custom
   *  label (blank = the formatted value). Drawn as major ticks (with a gridline).
   *  Positioned on the axis's own scale (linear or log). undefined = none. */
  extraTicks?: Array<{ value: number; label?: string | undefined }> | undefined;
  /** Rotate this axis's tick-number labels by N degrees (e.g. 45, 90). Default 0. */
  tickRotation?: number | undefined;
  /** Axis-anchored shaded bands: shade the plot between two axis values (a "normal
   *  range" strip that moves with the scale). Colour/opacity optional; an optional
   *  label is drawn at the band's start edge. undefined = none. */
  bands?: Array<{ from: number; to: number; color?: string | undefined; opacity?: number | undefined; label?: string | undefined }> | undefined;
  /** Category groups on a categorical (band) axis — e.g. traits grouped by domain. Only
   *  resolves when this axis is banded; ignored on a numeric axis.
   *  Grouping is stated redundantly, and each channel is independently toggleable,
   *  because real figures use two or three at once. undefined = no grouping. */
  categoryGroups?: CategoryGroupSpec | undefined;
  /** Hide this axis — its tick marks, tick-number labels, and title — while keeping the
   *  data mapping. Gridlines (which follow the ticks) drop too. Pair with `scaleBar` (and
   *  usually frame:"none") for the clean "scale-bar only" imaging look. Default false. */
  hidden?: boolean | undefined;
  /** Draw a corner scale bar of `length` data units instead of a numbered axis — a short
   *  segment in the bottom-left + a label ("<length><suffix>" unless `label` overrides),
   *  the imaging / electrophysiology convention. Usually paired with `hidden`. undefined = none. */
  scaleBar?: { length: number; label?: string | undefined } | undefined;
}

/** Plot frame: full box · L-shape (left+bottom) · offset (axes pulled out) · none. */
export type FrameStyle = "box" | "lshape" | "offset" | "none";
/** Tick-mark direction relative to the plot: outward · inward · both · hidden. */
export type TickDir = "out" | "in" | "both" | "none";

/** Marker shape for a series' datapoints. */
export type SymbolShape =
  | "circle"
  | "square"
  | "triangle"
  | "triangle-down"
  | "diamond"
  | "plus"
  | "cross"
  | "star"
  | "hexagon"
  | "pentagon"
  | "octagon"
  // Four additional shapes that stay distinguishable without colour: the ring's hole,
  // the squircle's flat sides, the oval's aspect, the waffle's grid.
  | "ring"
  | "squircle"
  | "oval"
  | "waffle"
  | "none";
/** Symbol fill mode: solid interior · open (page-colour) · clear (transparent / see-through). */
export type SymbolFill = "solid" | "open" | "clear" | "twotone";

/** How a bar/box/violin is filled. `solid` = flat colour; `twotone` derives a light
 *  fill + a darker contour from one base colour (so changing the hue re-tints both);
 *  the rest are richer fills. */
export type FillType = "solid" | "twotone" | "pattern" | "gradient" | "metallic" | "special" | "graduated";

/** What a graduated fill maps to: the mark's value (bar height), its X position, or its order. */
export type GradMap = "value" | "x" | "order";

/**
 * Graduated-fill ramp: simple shades (lightness / transparency / both / two-colour)
 * + perceptual & classic scientific colormaps. Low value → light/faint/ramp-start.
 */
export type GradRamp =
  | "lightness"
  | "transparency"
  | "lightness-transparency"
  | "twocolor"
  | "viridis"
  | "magma"
  | "plasma"
  | "inferno"
  | "cividis"
  | "turbo"
  | "grayscale"
  | "rainbow"
  | "blues"
  | "reds"
  | "greens"
  | "spectral"
  | "coolwarm"
  /** A gradient the user built, stored once in `Project.gradients` (or the user library) and
   *  referenced by id from any number of plots. Resolved by `resolveRamp()` in @mady/graphics;
   *  an id that no longer exists falls back to viridis and puts the missing name in the scene's
   *  `warnings` — never a silent substitution. See [[Gradient]]. */
  | `custom:${string}`;

/** The 17 ramps that are built into the program (i.e. every `GradRamp` that is not a
 *  `custom:<id>` reference). Kept as a value so option lists and guards can enumerate
 *  them without re-typing the union. */
export const BUILTIN_GRAD_RAMPS = [
  "lightness", "transparency", "lightness-transparency", "twocolor", "viridis", "magma",
  "plasma", "inferno", "cividis", "turbo", "grayscale", "rainbow", "blues", "reds", "greens",
  "spectral", "coolwarm",
] as const satisfies readonly GradRamp[];

/** True when a ramp reference points at a user-built [[Gradient]] rather than a built-in. */
export function isCustomRamp(ramp: GradRamp): ramp is `custom:${string}` {
  return ramp.startsWith("custom:");
}

/** The gradient id inside a `custom:<id>` reference (empty string for a built-in). */
export function customRampId(ramp: GradRamp): string {
  return isCustomRamp(ramp) ? ramp.slice("custom:".length) : "";
}

/** One colour stop of a user-built gradient: a colour (and optional alpha) at a position
 *  along the ramp, 0 = the low end, 1 = the high end. */
export interface GradStop {
  pos: number;
  color: string;
  /** 0..1; undefined = fully opaque (the `opacityCurve` still applies on top). */
  opacity?: number | undefined;
}

/** Colour space the gradient interpolates between its stops in. `rgb` is the default (so a
 *  saved gradient without this field draws the same); `hsl` keeps a rainbow
 *  vivid instead of passing through grey; `lab` is perceptually even. */
export type GradSpace = "rgb" | "hsl" | "lab";

/** How the class edges are chosen when a gradient is drawn in discrete `steps`. */
export type GradStepMode = "equal" | "quantile" | "breaks";

/** Parameters of a generated gradient (`Gradient.mode = "sweep"`) — the parametric rainbow:
 *  a hue sweep round the colour wheel, materialised into `sweepStops` stops. Kept alongside
 *  the generated stops so the editor can re-open the gradient in the form it was built in;
 *  "convert to stops" simply drops this and keeps `stops`. */
export interface GradientSweep {
  /** Start / end hue, degrees on the colour wheel (0 = red, 120 = green, 240 = blue). */
  hueFrom: number;
  hueTo: number;
  /** Which way round the wheel the sweep travels. Default "cw" (increasing hue). */
  hueDirection?: "cw" | "ccw" | undefined;
  /** How many times round the wheel (>1 = a repeating ramp for cyclic data). Default 1. */
  hueCycles?: number | undefined;
  /** Saturation: one value for the whole sweep, or a [start, end] pair. 0..1. Default 1. */
  saturation?: number | [number, number] | undefined;
  /** Lightness: one value, or a [start, end] pair (a light-to-dark rainbow). 0..1. Default 0.5. */
  lightness?: number | [number, number] | undefined;
  /** How many stops the sweep is materialised into. Default 33. */
  sweepStops?: number | undefined;
}

/**
 * A colour ramp the user built, stored once and referenced from many plots as
 * `custom:<id>`. Lives in `Project.gradients` (travels with the .mady file) and/or the
 * durable user library (available in every project).
 *
 * Two authoring modes produce the same thing — a stop list the resolver samples:
 *  • `"stops"` — hand-built. Any built-in can be opened into this mode pre-filled with its
 *    real stops, which is what "edit the rainbow" means: its seven stops become editable.
 *  • `"sweep"` — generated from `sweep`'s hue parameters, then frozen into `stops`.
 *
 * The shaping fields below apply to both, and are what make one stop list usable on many
 * datasets: where the middle of the ramp sits, how the detail is distributed, and whether
 * the ramp is continuous or a set of classes.
 */
export interface Gradient {
  /** Stable id; referenced as `custom:<id>`. */
  id: string;
  /** Display name ("Lab rainbow", "Fig 3 diverging"). */
  name: string;
  mode: "stops" | "sweep";
  /** The stops, ascending by `pos`. For a sweep this is the materialised result. */
  stops: GradStop[];
  /** Sweep parameters, kept so the editor can re-open a generated gradient. */
  sweep?: GradientSweep | undefined;
  /** Interpolation space between stops. Default "rgb". */
  space?: GradSpace | undefined;
  /** Where the middle of the ramp sits, as a fraction of the mapped data range (0..1).
   *  Pin it to the fraction that 0 falls at so a diverging map centres on zero.
   *  Undefined = the centre (no remap). */
  midpoint?: number | undefined;
  /** Bends the mapping toward the low (>1) or high (<1) end without moving the end
   *  colours: a position `u` along the ramp becomes `u ** gamma`. Default 1 (linear). */
  gamma?: number | undefined;
  /** 0/undefined = continuous; n ≥ 2 = n discrete classes. */
  steps?: number | undefined;
  /** How the class edges are chosen when `steps` ≥ 2. Default "equal". */
  stepMode?: GradStepMode | undefined;
  /** Explicit class edges (data values) when `stepMode` = "breaks". */
  breaks?: number[] | undefined;
  /** Alpha at the low end → alpha at the high end. Default [1, 1]. Generalises the
   *  built-in "transparency" ramp. */
  opacityCurve?: [number, number] | undefined;
  /** Colour for missing / non-numeric values. Undefined = the site's own default. */
  nanColor?: string | undefined;
  /** Colour for values below / above the pinned scale bounds; undefined = clamp to the
   *  end colour (the default). */
  underColor?: string | undefined;
  overColor?: string | undefined;
}

/** A datasheet cell's pattern overlay: a `PatternKind` tile in a foreground `color`, drawn over
 *  the cell's background fill. (`DataTable.cellPatterns`.) */
export interface CellPattern {
  kind: PatternKind;
  color: string;
}

/** Pattern (hatch / dots / weave …) for a `pattern` fill — many seamless tiles. */
export type PatternKind =
  | "hatch"
  | "hatch-cross"
  | "horizontal"
  | "vertical"
  | "grid"
  | "dots"
  | "dots-lg"
  | "rings"
  | "checker"
  | "squares"
  | "zigzag"
  | "chevron"
  | "waves"
  | "scales"
  | "triangles"
  | "diamond"
  | "herringbone"
  | "basketweave"
  | "brick"
  | "plus"
  | "crosses"
  | "stipple";

/** Metallic / iridescent sheen preset for a `metallic` fill. */
export type MetallicKind =
  | "gold"
  | "silver"
  | "bronze"
  | "copper"
  | "chrome"
  | "rosegold"
  | "platinum"
  | "gunmetal"
  | "brass"
  | "pearl"
  | "oilslick"
  | "holographic";

/** Themed / special-effect fill (gradient + pattern composites). The first is
 *  the default, and what a name this build does not know is drawn as. */
export const SPECIAL_KINDS = [
  "facets",
  "cards",
  "night",
  "stars",
  "galaxy",
  "ocean",
  "sunset",
  "carbon",
  "honeycomb",
  "bubbles",
  "confetti",
  "camo",
] as const;
export type SpecialKind = (typeof SPECIAL_KINDS)[number];

/** The special fill to draw for a stored value: the value itself when this build knows it,
 *  else the default. A project saved by another build can carry a name this one lacks. */
export function specialKindOf(v: unknown): SpecialKind {
  return (SPECIAL_KINDS as readonly unknown[]).includes(v) ? (v as SpecialKind) : SPECIAL_KINDS[0];
}
/** Connecting-line / curve interpolation between a series' points. */
export type ConnectMode =
  | "none"
  | "straight"
  | "step"
  | "stepBefore"
  | "stepAfter"
  | "smooth"
  | "cardinal"
  | "catmullRom"
  | "basis"
  | "natural";
/** Line dash pattern. */
export type LineDash = "solid" | "dashed" | "dotted" | "dashdot" | "longdash";

/** One builder-made reference line's own look (`Plot.refLineStyles[id]`). Every field
 *  undefined = fall back to the all-lines `Plot.refLine`, then to the built-in default,
 *  so an untouched chart is unchanged. See `refLines.ts` for the ids. */
export interface RefLineStyle {
  /** Line colour; undefined = the all-lines colour, then the chart's default ink. */
  color?: string | undefined;
  /** Line thickness, px; undefined = the all-lines width, then the chart's default. */
  width?: number | undefined;
  /** Dash pattern; undefined = the all-lines dash, then the line's own default (a
   *  Bland-Altman bias is solid while its limits are dashed — the distinction is
   *  meaningful, so it survives until someone overrides it deliberately). */
  dash?: LineDash | undefined;
}

/**
 * Error-bar style for a dataset's mean (the Error bars settings).
 * `sd`/`sem`/`ci95`/`range` plot the arithmetic mean; `geoSd` plots the
 * geometric mean with a ×/÷ geometric-SD factor (symmetric on a log axis);
 * `asymmetric` draws the pre-entered lower/upper error values directly (the
 * "Mean ± error" and "Mean with upper & lower limits" entry formats);
 * `iqr` plots the median with the interquartile range (Q1–Q3).
 *
 * Note: the type carries the centre as well as the reach. That is why "plot the median"
 * is not a separate switch multiplied by these: `median ± SD` is not a standard summary,
 * and a type × centre grid would have made three-quarters of its cells meaningless.
 */
export type ErrorBarType = "none" | "sd" | "sem" | "ci95" | "range" | "geoSd" | "asymmetric" | "iqr";

/** Which half of the error bar to draw (up / down / both). */
export type ErrorBarDir = "both" | "up" | "down";

/** Which whiskers a box plot draws (both / upper only / lower only). */
export type WhiskerSides = "both" | "upper" | "lower";

/** What a pie slice's label shows. */
export type PieLabelMode = "none" | "percent" | "value" | "label" | "label-percent" | "label-value";

/** How a heatmap maps its data to coloured marks.
 *  `matrix` = one cell per (row × column) value (the classic grid);
 *  `density2d` = a smooth 2-D KDE density cloud of (x, y) points (first two columns);
 *  `hexbin` = hexagonal binning of (x, y) point counts. */
export type HeatmapMode = "matrix" | "density2d" | "hexbin";

/** How a heatmap split is drawn: an empty space, a rule, or a rule sitting inside a space. */
export type HeatSplitStyle = "gap" | "line" | "both";

/**
 * One split in a heatmap — the break between two blocks of rows (or columns).
 *
 * Every look field is optional and falls back to the chart-wide default
 * (`HeatmapStyle.splitStyle` / `splitGap` / `splitLineWidth` / `splitColor`), which is what
 * makes "change every break at once, or just this one" work: set the default and every split
 * follows it; set a field here and this split alone departs from it. Same field-by-field
 * fallback as `titleFont`.
 */
export interface HeatSplit {
  /** The split sits after this row/column index (0-based): `at: 2` breaks between the 3rd and
   *  4th. Out of range (< 0, or ≥ the count) is refused with a warning — a split outside the
   *  matrix would silently do nothing. */
  at: number;
  /** Space, rule, or both. Undefined = the chart-wide `splitStyle`. */
  style?: HeatSplitStyle | undefined;
  /** Width of the space in px (styles "gap" and "both"). Undefined = `splitGap`. */
  gap?: number | undefined;
  /** Thickness of the rule in px (styles "line" and "both"). Undefined = `splitLineWidth`. */
  lineWidth?: number | undefined;
  /** Rule colour. Undefined = `splitColor`. */
  color?: string | undefined;
  /** Rule dash pattern. Undefined = `splitDash`. */
  dash?: LineDash | undefined;
  /** Name of the block that ends at this split (drawn beside/above it). Empty = none. */
  label?: string | undefined;
  /** Free drag offset (px) of that block name — every text on a graph can be moved. */
  labelOffset?: { dx: number; dy: number } | undefined;
}

/**
 * One annotation track — the thin strip of coloured blocks beside a heatmap that says what each
 * row (or column) is: treatment, timepoint, cluster, responder.
 *
 * Where the values come from differs by axis, because a table has a value per row but nothing
 * per column:
 *  • a row track reads a column of the sheet (one value per row) — the same arrangement
 *    `parallel.colorColumn` uses, and that column drops out of the matrix so it is not drawn
 *    twice;
 *  • a column track carries its values here, one per matrix column, because there is nowhere in
 *    the sheet for them to live.
 *
 * A numeric row track shades through a colour ramp; anything else takes one hue per distinct
 * value. Either way the strip explains itself: the track's name sits beside it, and each run of
 * equal values is labelled where there is room.
 */
export interface HeatTrack {
  /** The strip's name, drawn beside it. Empty = unnamed. */
  name?: string | undefined;
  /** Row tracks: the sheet column whose per-row value drives the strip. */
  column?: NodeId | undefined;
  /** Column tracks: the value for each matrix column, keyed by that column's dataset id. */
  values?: Record<string, string> | undefined;
  /** Strip thickness in px. Default 14. */
  size?: number | undefined;
  /** Colour for one value, overriding the automatic palette hue. Keyed by the value itself. */
  colors?: Record<string, string> | undefined;
  /** Ramp for a numeric track. Default "blues". Any `GradRamp`, including a `custom:<id>`. */
  ramp?: GradRamp | undefined;
  /** Force the reading: "auto" (numeric → ramp, else categories), or pick one. Default "auto". */
  scale?: "auto" | "category" | "value" | undefined;
  /** Free drag offset (px) of the strip's name — every text on a graph can be moved. */
  nameOffset?: { dx: number; dy: number } | undefined;
  /** Free drag offset (px) of this strip's key (the little colour bar, its caption and its
   *  min/max move as one block — the colour-bar rule). Numeric strips only. */
  keyOffset?: { dx: number; dy: number } | undefined;
  /** Free drag offsets of the words drawn on the strip, keyed by the value each one names.
   *  Keyed by value, not by position: a run moves when the rows are clustered or collapsed, and
   *  an index-keyed offset would then hop onto a different word. */
  labelOffsets?: Record<string, { dx: number; dy: number }> | undefined;
}

/** Heatmap appearance (Plot.heatmap when kind = "heatmap"). All optional. */
export interface HeatmapStyle {
  /** Mapping mode (matrix grid · 2-D density cloud · hexbin). Default "matrix". */
  mode?: HeatmapMode | undefined;
  /** How a matrix cell draws its value: "tile" (default — the classic filled
   *  heatmap) or "bubble" — a centred dot whose area is proportional to the value's
   *  magnitude (|value| when the colour domain crosses zero, corrplot-style), coloured by
   *  the same ramp. The publication "bubble grid" / dot plot. Matrix mode only; the
   *  density/hexbin views refuse it with a warning. */
  cellShape?: "tile" | "bubble" | undefined;
  /** Grid/bin resolution for density2d/hexbin (cells across the wider axis). Default 40. */
  resolution?: number | undefined;
  /** Colour ramp; any `GradRamp`. Default "viridis". */
  colormap?: GradRamp | undefined;
  /** Flip the ramp (high values take the low-end colour). Default false. */
  reverse?: boolean | undefined;
  /** Heatmap cells + the colour bar — the colour shaping knobs, honoured for whichever ramp is chosen (built-in or
   *  `custom:<id>`). They override the same fields stored on a custom [[Gradient]], one field at
   *  a time (the `titleFont` merge idiom); a built-in ramp carries no shaping of its own, so for
   *  one of those these are the only source.
   *
   *  Note: `colorMidpoint` is a data value — the value that takes the middle colour of the ramp.
   *  Pin it to 0 so a diverging map centres on zero. (`Gradient.midpoint` is a fraction
   *  instead, because a saved gradient knows nothing about the data it will be used on.)
   *  Undefined = the centre of the range, i.e. no remap. */
  colorMidpoint?: number | undefined;
  /** Bends the mapping toward the low (>1) or high (<1) end of the data without moving the end
   *  colours — pulls detail out of a skewed distribution. Default 1 (linear). */
  colorGamma?: number | undefined;
  /** 0/undefined = a continuous ramp; n ≥ 2 = n discrete classes (the classic 5-class map), each
   *  taking the colour at its own centre. The colour bar follows. */
  colorSteps?: number | undefined;
  /** Colour space the ramp interpolates in: "rgb" (default),
   *  "hsl" (keeps a rainbow vivid instead of passing through grey) or "lab" (perceptually even). */
  colorSpace?: GradSpace | undefined;
  /** Manual colour-scale bounds; undefined = auto from the data. */
  valueMin?: number | undefined;
  valueMax?: number | undefined;
  /** Colour for missing / non-numeric cells. Default "#dddddd". */
  nanColor?: string | undefined;
  /** Print each cell's numeric value. Default false. */
  showValues?: boolean | undefined;
  /** Cell-value text colour; undefined = auto contrast (black/white per cell). */
  valueColor?: string | undefined;
  /** Gridline colour between cells; undefined = none. */
  cellBorderColor?: string | undefined;
  /** Gridline width, px. Default 0 (no border). */
  cellBorderWidth?: number | undefined;
  /** Show the row (left) labels. Default true. */
  showRowLabels?: boolean | undefined;
  /** Show the column (top) labels. Default true. */
  showColLabels?: boolean | undefined;
  /** Show the colour-scale bar. Default true. */
  showColorbar?: boolean | undefined;
  /** Colour-scale bar title (a rotated label beside the bar). Empty/undefined = none. */
  colorbarTitle?: string | undefined;
  /** Show intermediate tick labels along the colour bar (not just min/max). Default false. */
  colorbarTicks?: boolean | undefined;
  /** Explicit colour-bar tick values (each labelled at its position). Undefined = auto
   *  (min/max, or quartiles when colorbarTicks is on). Mirrors the bubble size legend. */
  colorbarTickValues?: number[] | undefined;
  /** Font for the colour-bar labels/title; undefined = follow the legend font. */
  colorbarFont?: FontSpec | undefined;
  /** Font for the row/column labels; undefined = follow the tick font (capped ≤12px). */
  labelFont?: FontSpec | undefined;
  /** Column-label rotation in degrees (0 = horizontal, 45/90 = angled/vertical). Default 0. */
  labelRotation?: number | undefined;
  /** Per-label free drag offsets (px), keyed by column / row index — each label moves
   *  independently (double-click still renames it). */
  colLabelOffsets?: Record<string, { dx: number; dy: number }> | undefined;
  rowLabelOffsets?: Record<string, { dx: number; dy: number }> | undefined;
  /** Hierarchical-clustering reorder: reorder the rows / columns / both so similar
   *  profiles sit adjacent (revealing blocks), and draw the attached dendrogram(s).
   *  "none" = keep the table order. Default "none". */
  cluster?: "none" | "rows" | "columns" | "both" | undefined;
  /** Distance metric for clustering. Default "euclidean". */
  clusterMetric?: ClusterMetric | undefined;
  /** Linkage for clustering. Default "average". */
  clusterLinkage?: ClusterLinkage | undefined;
  /** Draw the attached dendrogram tree(s) beside the clustered axes. Default true. */
  showDendrogram?: boolean | undefined;

  // --- Splits: break the matrix into blocks -------------------------------------------------
  /**
   * Splits between blocks of rows / columns — the "split heatmap": replicates grouped together,
   * treatments held apart by a space or a rule. Each entry says where (after which index) and,
   * optionally, how it should look; anything it leaves undefined follows the four chart-wide
   * defaults below, so one setting can restyle every break at once.
   */
  rowSplits?: HeatSplit[] | undefined;
  colSplits?: HeatSplit[] | undefined;
  /**
   * Blocks from the tree. 2 or more = stop taking the breaks from `rowSplits`/`colSplits` and
   * cut the clustering dendrogram into this many blocks instead, so the breaks follow the data
   * and stay right when it changes. Undefined / 0/1 = the hand-placed list above.
   *
   * Needs that axis clustered — there is no tree to cut otherwise, and the builder says so
   * rather than quietly drawing nothing. Derived breaks take the chart-wide look (a break the
   * tree placed has no stable identity to hang an override on); place them by hand when one
   * break has to differ from the rest.
   */
  rowSplitK?: number | undefined;
  colSplitK?: number | undefined;

  /**
   * Replicate collapse. "off" (default) draws every replicate as its own row / column; "mean" or
   * "median" averages the ones that share an annotation value into one.
   *
   * What belongs together is read from an annotation strip on that axis (`collapseRowsBy` /
   * `collapseColsBy` pick which one, by position; the first strip by default) — the same values
   * that colour the strip, so what the figure shows and what it averages cannot disagree.
   *
   * Collapsing changes the numbers the picture shows, so it says so where it cannot be
   * missed: a collapsed row/column is labelled "Control (mean of 3)". A group of one keeps its
   * plain name — nothing was averaged. Without a strip to group by there is nothing to collapse,
   * and the builder refuses with a warning rather than drawing the same matrix as if it had worked.
   */
  collapseRows?: "off" | "mean" | "median" | undefined;
  collapseCols?: "off" | "mean" | "median" | undefined;
  /** Which strip says what belongs together (index into `rowTracks` / `colTracks`). Default 0. */
  collapseRowsBy?: number | undefined;
  collapseColsBy?: number | undefined;
  /** Default look for every split that does not override it. */
  splitStyle?: HeatSplitStyle | undefined;
  /** Default space width, px (styles "gap"/"both"). Default 8. */
  splitGap?: number | undefined;
  /** Default rule thickness, px (styles "line"/"both"). Default 1.5. */
  splitLineWidth?: number | undefined;
  /** Default rule colour. Default the theme ink. */
  splitColor?: string | undefined;
  /** Default rule dash pattern. Default "solid". */
  splitDash?: LineDash | undefined;
  /** Font for the block labels; undefined = follow the row/column label font. */
  splitLabelFont?: FontSpec | undefined;

  // --- Annotation tracks: strips that say what each row / column is -------------------------
  /** Strips drawn beside the rows (between the row labels and the cells), each reading one
   *  column of the sheet. See [[HeatTrack]]. */
  rowTracks?: HeatTrack[] | undefined;
  /** Strips drawn above the columns, each carrying its own value per column. */
  colTracks?: HeatTrack[] | undefined;
  /** Default strip thickness for tracks that do not set their own, px. Default 14. */
  trackSize?: number | undefined;
  /** Gap between a strip and the cells (and between two strips), px. Default 3. */
  trackGap?: number | undefined;
  /** Font for the track names + the labels drawn on the strips; undefined = the label font. */
  trackFont?: FontSpec | undefined;
  /**
   * Draw a key for every numeric strip — a small colour bar with the strip's name and its
   * min/max. Default true.
   *
   * A categorical strip explains itself: it carries the words. A numeric one shades through a
   * ramp with nothing to decode it, so without this the reader can see that a row is darker
   * and never learn what that means. Same answer the `tracks` kind already gives its numeric
   * strips (each carries its own bar); this is that bar, in the heatmap's right-margin stack.
   */
  trackKeys?: boolean | undefined;
}

/** Correlation-matrix appearance (Plot.corrmatrix when kind = "corrmatrix"). Each cell
 *  is a glyph encoding the pairwise correlation r between two of the table's numeric
 *  columns: pie fill-fraction ∝ |r|, hue blue(+)/red(−) saturating with |r|. All optional. */
export interface CorrMatrixStyle {
  /** How r is computed from the columns: Pearson (linear) or Spearman (rank). Default "pearson". */
  method?: CorrelationMethod | undefined;
  /** Which cells to draw: lower triangle + diagonal (default), upper, or the full square. */
  triangle?: "lower" | "upper" | "full" | undefined;
  /** Cell glyph: filled pie wedge (default), area-scaled circle, corrplot ellipse, colour-only square, or the number. */
  glyph?: "pie" | "circle" | "ellipse" | "square" | "number" | undefined;
  /**
   * Size of the glyph inside each cell, as a multiple of the size it takes from the cell
   * (1 = 42% of the cell, the default look).
   *
   * Note: the slider stops at 1.2 because 0.42 × 1.2 ≈ half a cell — glyphs exactly touching
   * their neighbours. That is the limit of the drawing, so it is the limit of the control,
   * rather than a value the builder accepts and then silently clamps.
   */
  glyphScale?: number | undefined;
  /**
   * Size of the symbols in the correlation-scale key, as a multiple of the size they take
   * from the cell (1 = the default look, capped at a 9px radius regardless of the figure or
   * font size).
   *
   * Note: the reserved right-hand strip follows this number, or a bigger symbol would land
   * under its own label (the same issue `LegendSpec.symbolScale` documents).
   */
  legendGlyphScale?: number | undefined;
  /** Hue for r = +1 and r = −1 (each blended toward white at r = 0). Defaults: blue / red. */
  positiveColor?: string | undefined;
  negativeColor?: string | undefined;
  /** Draw the r = 1 self-correlation glyphs on the diagonal. Default true. */
  showDiagonal?: boolean | undefined;
  /** Print the r value in each cell (independent of the glyph). Default false. */
  showValues?: boolean | undefined;
  /** Value-label decimal places. Default 2. */
  valueDecimals?: number | undefined;
  /** Show the row (left) / column (top) variable labels. Default true. */
  showRowLabels?: boolean | undefined;
  showColLabels?: boolean | undefined;
  /** Column-label rotation degrees (0 = horizontal, 45/90 = angled/vertical). Default 45. */
  labelRotation?: number | undefined;
  /** Show the correlation-scale legend (a strip of pie glyphs from +1 … −1). Default true. */
  showLegend?: boolean | undefined;
  /** Gridline colour between cells; undefined = a faint theme line. "" / "none" = none. */
  cellBorderColor?: string | undefined;
  /** Consecutive variable-group sizes → dashed block dividers + a faint tint on the
   *  diagonal blocks (e.g. groups of variables from one domain). Empty/undefined = no blocks. */
  blockSizes?: number[] | undefined;
  /** Font for the row/column labels; undefined = the tick font (capped ≤12). */
  labelFont?: FontSpec | undefined;
  /** Per-label drag offsets (px), keyed by the 0-based variable index — each row / column
   *  variable label moves independently (mirrors the heatmap). Missing = no offset. */
  rowLabelOffsets?: Record<string, { dx: number; dy: number }> | undefined;
  colLabelOffsets?: Record<string, { dx: number; dy: number }> | undefined;
  /** Correlation-scale legend drag offset (px) from its reserved right-strip anchor. */
  legendOffset?: { dx: number; dy: number } | undefined;
  /** Per-cell colour overrides, keyed `${row}:${col}` — click a cell to recolour just that
   *  glyph (wins over the diverging r→colour scale). Missing = the r-encoded colour. */
  cellColors?: Record<string, string> | undefined;
}

/** Alluvial / parallel-sets appearance (Plot.alluvial when kind = "alluvial"). The plot
 *  has N ordered categorical axes; between adjacent axes, ribbons connect category blocks,
 *  each ribbon sized by the count of rows sharing that category pair. All optional. */
export interface AlluvialStyle {
  /** Categorical columns forming the ordered axes (left→right). Empty/undefined = auto
   *  (every mostly-text column, in table order). Needs ≥2. */
  columns?: NodeId[] | undefined;
  /** Colour each ribbon by its category at the first axis (default) or the last axis. */
  colorBy?: "first" | "last" | undefined;
  /** Node (category block) width, px. Default 16. */
  nodeWidth?: number | undefined;
  /** Vertical gap between stacked nodes on an axis, as a fraction of plot height. Default 0.02. */
  nodeGap?: number | undefined;
  /** Ribbon fill opacity (0..1). Default 0.5. */
  ribbonOpacity?: number | undefined;
  /** Straight (angular) ribbons instead of smooth curves. Default false. */
  straight?: boolean | undefined;
  /** Draw each node's category label + count. Default true. */
  showLabels?: boolean | undefined;
  /** Node block colour; undefined = a neutral theme fill. */
  nodeColor?: string | undefined;
  /** Per-node colour overrides keyed by `"axis:category"` — set by selecting a node and
   *  recolouring it. A node on the colour axis also recolours the flows it originates. */
  nodeColors?: Record<string, string> | undefined;
}

/** Node-link network graph appearance (Plot.network when kind = "network"). The
 *  source table is an edge list — the first two columns are the edge endpoints
 *  (source, target), an optional numeric column is the edge weight, and a further
 *  optional numeric column is a per-node value (colours each node on a diverging
 *  scale, taken from the node's first appearance as a source). All optional. */
export interface NetworkStyle {
  /** Node placement. "force" = Fruchterman-Reingold spring embedding (default);
   *  "circular" = nodes evenly on a circle; "layered" = ranked left→right columns
   *  (longest-path layers + barycentre ordering — the multi-column node-link form). */
  layout?: "force" | "circular" | "layered" | undefined;
  /** Base node radius, px. Default 6. */
  nodeSize?: number | undefined;
  /** Scale each node's radius by its degree (more edges = bigger). Default true. */
  sizeByDegree?: boolean | undefined;
  /** Colour each node from this column's value on the row where the node first leads
   *  (appears as source) — one palette hue per distinct value, plus a group legend
   *  (e.g. taxa coloured by phylum in a co-occurrence network). Wins over the value ramp; a per-node
   *  override still wins over the group. Undefined = off. */
  groupColumn?: NodeId | undefined;
  /** Size each node from this numeric column (same first-lead rule) — radius spans the
   *  same 0.7–1.6× band degree sizing uses, √-scaled so area tracks the value. Beats
   *  `sizeByDegree`; a hand-set `nodeSizes` radius still wins. Undefined = off. */
  sizeColumn?: NodeId | undefined;
  /** Colour each link by its weight's sign (positive/negative correlation look) plus a
   *  sign legend. A weightless link keeps `edgeColor`; a per-link override still wins.
   *  Default false. */
  edgeSignColors?: boolean | undefined;
  /** The two sign colours. Defaults `#c0392b` (positive) / `#3b6fb0` (negative) — the
   *  same red/blue pair the node value ramp uses. */
  edgePositiveColor?: string | undefined;
  edgeNegativeColor?: string | undefined;
  /** Node fill when not coloured by a value; undefined = the first palette hue. */
  nodeColor?: string | undefined;
  /** Diverging colour-scale endpoints for the per-node value (low → high). Undefined
   *  = blue→red (`#3b6fb0` → `#c0392b`), the usual look for z-scores. */
  lowColor?: string | undefined;
  highColor?: string | undefined;
  /** Edge line width at weight = 1, px (heavier edges scale up). Default 1. */
  edgeWidth?: number | undefined;
  /** Edge colour; undefined = a translucent neutral link colour. */
  edgeColor?: string | undefined;
  /** Edge opacity (0..1). Default 0.5. */
  edgeOpacity?: number | undefined;
  /** Curve the edges (quadratic arc) instead of straight lines. Default false. */
  curved?: boolean | undefined;
  /** Draw node labels. Default true. */
  showLabels?: boolean | undefined;
  /** Only label nodes whose degree is ≥ this (0 = label all). Default 0. */
  labelMinDegree?: number | undefined;
  /** Node-label font size (px). Undefined = `NETWORK_LABEL_SIZE` (12).
   *  Note: node labels do not follow the tick font: that font is sized for axis charts, and at
   *  its default (20px) a name like "CXCL10" is wider than the gap between nodes, which swamps
   *  a node-link diagram. This field sizes labels for the diagram instead. */
  labelSize?: number | undefined;
  /** Force-layout RNG seed override (undefined = derived from the node ids, stable). */
  seed?: number | undefined;
  /** Per-node colour overrides (node id → colour) — set by selecting a node and
   *  recolouring it. Wins over the value ramp / flat node colour for that node. */
  nodeColors?: Record<string, string> | undefined;
  /** Manual node positions (node id → fractional plot-rect coords 0..1) — set by
   *  dragging a node. Pinned nodes keep this position; the rest auto-lay-out. */
  nodePositions?: Record<string, { x: number; y: number }> | undefined;
  /** Per-node display-label overrides (node id → text) — set by editing a node's
   *  label. Changes only the drawn label, not the underlying edge data. */
  nodeLabels?: Record<string, string> | undefined;
  /** Per-link colour overrides (edge key → colour) — set by clicking one link and
   *  recolouring it. Wins over the shared `edgeColor` for that link. Key = [[networkEdgeKey]]. */
  edgeColors?: Record<string, string> | undefined;
  /** Per-link width overrides (edge key → px). Unlike the shared `edgeWidth` (a width at
   *  weight = 1 that each edge scales up from), this is the drawn width for that one link:
   *  tuning a single link means picking its actual thickness, so weight scaling no longer
   *  applies to it. Key = [[networkEdgeKey]]. */
  edgeWidths?: Record<string, number> | undefined;
  /** Per-link opacity overrides (edge key → 0..1). Wins over `edgeOpacity`. Key = [[networkEdgeKey]]. */
  edgeOpacities?: Record<string, number> | undefined;
  /** Outline colour for all nodes. Undefined = the theme background (a thin separating ring). */
  nodeStroke?: string | undefined;
  /** Outline width for all nodes, px. Default 1. */
  nodeStrokeWidth?: number | undefined;
  /** Two-tone fill for all nodes: the outline is drawn as a darker shade of the node's fill
   *  colour (the same convention as two-tone markers/bars — outline darker than the inner
   *  fill). An explicit `nodeStroke` colour overrides the derived shade. */
  nodeTwoTone?: boolean | undefined;
  /** Per-node outline colour (node id → colour). Wins over `nodeStroke`. */
  nodeStrokes?: Record<string, string> | undefined;
  /** Per-node outline width (node id → px). Wins over `nodeStrokeWidth`. */
  nodeStrokeWidths?: Record<string, number> | undefined;
  /** Per-node two-tone fill (node id → on) — a darker-shade outline for that node. Wins over `nodeTwoTone`. */
  nodeTwoTones?: Record<string, boolean> | undefined;
  /** Per-node radius overrides (node id → px). Like a hand-set link width, this is the drawn
   *  radius: sizing one node by hand means picking its size, so degree scaling no longer
   *  applies to it. */
  nodeSizes?: Record<string, number> | undefined;
}

/** Stable key for one network link — the selection + per-edge override key (`source→target`).
 *  Direction matters (the edge list is directed), and it survives a re-layout because it's
 *  derived from the node ids, never from an index. */
export function networkEdgeKey(sourceId: string, targetId: string): string {
  return `${sourceId}→${targetId}`;
}

/** Ridgeline / joyplot appearance (Plot.ridgeline when kind = "ridgeline"). All optional. */
export interface RidgelineStyle {
  /** Overlap factor = each trace's height ÷ the baseline pitch. >1 = traces overlap
   *  the row above (the classic joyplot look). Default 1.5. */
  overlap?: number | undefined;
  /** KDE bandwidth multiplier (× Silverman) — lower = spikier, higher = smoother. Default 1. */
  bandwidth?: number | undefined;
  /** Trace fill opacity (0–1) — translucent so overlapping rows read through. Default 0.55. */
  fillOpacity?: number | undefined;
  /** Fill every ridge with one horizontal gradient anchored to the X axis (not per-ridge),
   *  shared across all rows — so a left-leaning ridge reads as the low-value colour and a
   *  right-leaning one as the high-value colour. Off by default. */
  spectrum?: boolean | undefined;
  /** Which colormap the spectrum ramps through (a `COLORMAPS` name, e.g. "coolwarm", "spectral",
   *  "rainbow", "turbo", "viridis"). Default "coolwarm" — a smooth, perceptual blue→red. */
  spectrumMap?: string | undefined;
  /** The axis-anchored spectrum fill — the colour shaping knobs, honoured for whichever ramp is chosen (built-in or
   *  `custom:<id>`). They override the same fields stored on a custom [[Gradient]], one field at
   *  a time (the `titleFont` merge idiom); a built-in ramp carries no shaping of its own, so for
   *  one of those these are the only source.
   *
   *  Note: `spectrumMidpoint` is a data value — the value that takes the middle colour of the ramp.
   *  Pin it to 0 so a diverging map centres on zero. (`Gradient.midpoint` is a fraction
   *  instead, because a saved gradient knows nothing about the data it will be used on.)
   *  Undefined = the centre of the range, i.e. no remap. */
  spectrumMidpoint?: number | undefined;
  /** Bends the mapping toward the low (>1) or high (<1) end of the data without moving the end
   *  colours — pulls detail out of a skewed distribution. Default 1 (linear). */
  spectrumGamma?: number | undefined;
  /** 0/undefined = a continuous ramp; n ≥ 2 = n discrete classes (the classic 5-class map), each
   *  taking the colour at its own centre. The colour bar follows. */
  spectrumSteps?: number | undefined;
  /** Colour space the ramp interpolates in: "rgb" (default),
   *  "hsl" (keeps a rainbow vivid instead of passing through grey) or "lab" (perceptually even). */
  spectrumSpace?: GradSpace | undefined;
  /** What each row draws. "density" (default) = a KDE of the dataset's pooled values, x = the
   *  measured value — the classic joyplot. "profile" = the dataset's value over the
   *  table's X column (x = the shared axis, row height = |value|; a negative value folds
   *  upward — level bands give it the negative colours). Needs an X column with numeric
   *  values; without one the builder says so and draws densities. */
  source?: "density" | "profile" | undefined;
  /** Nested level bands: slice each row's height into this many equal levels and fill each
   *  slice one shade deeper than the slice below — the iso-contour / horizon figure, keyed by
   *  a band legend. 0/undefined = off (the plain fill). In profile mode a negative value's
   *  bands take the negative ramp; a density is never negative, so density bands use the
   *  positive ramp alone. Bands replace the spectrum fill when both are on (the scene warns). */
  bands?: number | undefined;
  /** Band ramp anchors: level 1 draws as a light tint of the anchor and the top level as the
   *  anchor itself, so the whole ramp derives from one hue per side. Defaults: a blue for
   *  positive levels, a red for negative. */
  bandPosColor?: string | undefined;
  bandNegColor?: string | undefined;
  /** The banded horizon fold's origin, per row: deviations are measured from each row's own
   *  median (default — so raw abundances work without
   *  pre-computed z-scores), its mean, or zero (values used as entered — the right choice
   *  when the rows already are z-scores). Only the banded profile fold uses it: a plain
   *  (bands-off) profile ridge keeps the simple |value| lobe, where re-centring on a median
   *  would fold half of every row upward with no sign channel to say so. */
  origin?: "median" | "mean" | "zero" | undefined;
}

/** Floating-bar appearance (Plot.floatingBar when kind = "floatingbar"). A floating
 *  bar spans each group's min→max with a line at its centre — "floating bars". */
export interface FloatingBarStyle {
  /** The horizontal line drawn inside each bar: at the group mean (default), median, or none. */
  line?: "mean" | "median" | "none" | undefined;
}

/** Column-scatter overlay (Plot.columnScatter when kind = "scatter"): the central line
 *  drawn over the swarm and the error interval around it. All exact arithmetic — SD/SEM
 *  around the mean, IQR = q1..q3, range = min..max — so no statistical approximation.
 *  Default = mean ± SD. */
export interface ColumnScatterStyle {
  /** Central line: at the group mean (default) or median. */
  center?: "mean" | "median" | undefined;
  /** Error interval: SD (default) / SEM / 95% CI (exact t) around the mean, IQR (q1–q3),
   *  full range, or none. SD/SEM/CI/range reuse the validated core `errorPoint`.
   *  `ciMedian` = the 95% CI of the median, exact from order statistics (`medianCI`, the same
   *  rule as the engine's Describe). Needs ≥ 6 raw values; otherwise none is drawn and the
   *  scene warns. Kept apart from `ci95` so a saved median + ci95 pair still draws as saved. */
  error?: "sd" | "sem" | "ci95" | "iqr" | "range" | "ciMedian" | "none" | undefined;
}

/** Gardner-Altman estimation-plot config (Plot.estimation when kind = "estimation").
 *  Two groups (control = first dataset, test = second) shown as raw swarm dots, plus a
 *  right-hand effect-size axis carrying the mean difference with a bootstrap CI + the
 *  bootstrap distribution as a half-violin. Reproducible (seeded bootstrap). */
export interface EstimationStyle {
  /** Paired (Gardner-Altman paired): bootstrap the per-subject differences. Default false. */
  paired?: boolean | undefined;
  /** Bootstrap resamples. Default 2000. */
  resamples?: number | undefined;
  /** PRNG seed (reproducible). Default 20240704. */
  seed?: number | undefined;
  /** Confidence level for the effect CI (0–1). Default 0.95. */
  ciLevel?: number | undefined;
}

/** Forest-plot appearance (Plot.forest when kind = "forest"). Rows = studies; the first
 *  three value columns give the point estimate, its lower CI, and its upper CI. A vertical
 *  reference line marks the null / no-effect value. The effect (X) axis can be set to a log
 *  scale via the normal Axis panel (natural for ratio measures — OR / RR / HR). */
export interface ForestStyle {
  /** Value where the vertical no-effect reference line is drawn; null = no line. Default 1
   *  (the null for ratio measures; set 0 for differences). */
  refValue?: number | null | undefined;
  /** Scale each study's marker area by its inverse-variance weight (meta-analysis convention;
   *  weight derived from the CI width). Default false → uniform markers. */
  weightMarkers?: boolean | undefined;
  /** Draw a pooled inverse-variance summary diamond below the studies (pooling in log space
   *  when the effect axis is log). Only meaningful when the CIs are inverse-variance based.
   *  Default false. */
  showSummary?: boolean | undefined;
  /** Pooling model for the summary diamond: "fixed" (fixed-effect inverse-variance, default —
   *  one true effect) or "random" (DerSimonian-Laird random-effects — effects vary between
   *  studies; wider interval, τ²-inflated weights). Heterogeneity (I², τ²) is reported for both. */
  model?: "fixed" | "random" | undefined;
  /** Confidence level the entered lower/upper limits were computed at (0–1), used to
   *  back-calculate each study's SE for pooling and inverse-variance marker weights. Default
   *  0.95. Set 0.90 / 0.99 to match how the study CIs were reported, or the weights are wrong. */
  ciLevel?: number | undefined;
}

/** Venn / Euler diagram (Plot.venn when kind = "venn"), from a "sets" membership table:
 *  2–3 overlapping circles, one per set column, each exclusive zone showing its item count.
 *  Set colours are the ordinary per-dataset series colours. */
export interface VennStyle {
  /** Area-proportional layout: circle areas ∝ set sizes and overlaps ∝ intersection counts —
   *  exact for 2 sets; best-fit for 3 (circles cannot always be faithful — the builder warns
   *  when the drawn zones misstate the counts). Subsets nest and disjoint sets separate
   *  (the Euler behaviour). Default false = classic equal circles. */
  proportional?: boolean | undefined;
  /** Print each zone's item count. Default true. */
  showCounts?: boolean | undefined;
  /** Append each zone's share of the union, e.g. "12 (20%)". Default false. */
  showPercents?: boolean | undefined;
  /** Fill opacity of each disc (overlaps read by colour blending). Default 0.35. */
  fillOpacity?: number | undefined;
  /** Circle outline width, px. Default 1.5; 0 = no outline. */
  outlineWidth?: number | undefined;
  /** Circle outline colour; undefined = each set's own (darker) colour. */
  outlineColor?: string | undefined;
  /** Per-set label drag offsets (px), keyed by dataset id — written by dragging the label. */
  labelOffsets?: Record<NodeId, { dx: number; dy: number }> | undefined;
}

/** UpSet plot (Plot.upset when kind = "upset") — the Venn's any-number-of-sets sibling,
 *  from the same "sets" membership table: exclusive-intersection bars on a real count Y
 *  axis, the set-membership dot matrix under them, set-size bars at the left. Count labels
 *  above the bars are the standard value-label machinery ([[Plot.showValues]]), not a field
 *  here. */
export interface UpsetStyle {
  /** Column order: "size" (largest intersection first, the classic look — default) or
   *  "degree" (fewest-sets first, then size within a degree). */
  sortBy?: "size" | "degree" | undefined;
  /** Show at most this many intersection columns (default 15). Truncation is never silent —
   *  the scene warns with how many were hidden. */
  maxIntersections?: number | undefined;
  /** Also draw the zero-count set combinations (all 2ⁿ−1 of them, still capped by
   *  [[maxIntersections]]). Default false. */
  showEmpty?: boolean | undefined;
  /** Hide intersections smaller than this count. Default 0 (show all non-empty). */
  minSize?: number | undefined;
  /** Draw the per-set total-size bars at the left of the matrix. Default true. */
  showSetSizes?: boolean | undefined;
  /** One colour for every intersection bar (bars cannot be recoloured one by one).
   *  Default the neutral dark ink. */
  barColor?: string | undefined;
  /** Default colour of the matrix membership dots, connectors and set-size bars. A set
   *  column's SeriesStyle `color` overrides it for that set's dots + size bar. */
  dotColor?: string | undefined;
  /** Per-set matrix-label drag offsets (px), keyed by dataset id — written by dragging. */
  labelOffsets?: Record<NodeId, { dx: number; dy: number }> | undefined;
}

/** Swimmer plot (Plot.swimmer when kind = "swimmer") — one horizontal bar per subject from
 *  Start to End on a real time axis (xy table, one row per subject): an optional response
 *  interval drawn inside the bar, an arrow cap for subjects still on treatment, and every
 *  further numeric column drawn as an event-glyph series (standard marker/colour/legend
 *  controls). Duration labels are the standard value-label machinery ([[Plot.showValues]]);
 *  glyph size is the standard per-series marker Size — neither is a field here. */
export interface SwimmerStyle {
  /** Row order: "duration" (longest bar first, the classic look — default) or "table"
   *  (the sheet's row order). Per-subject styles are rowId-keyed and survive the sort. */
  sortBy?: "duration" | "table" | undefined;
  /** Bar thickness as a fraction of the subject band (0.1–1). Default 0.55. */
  barHeight?: number | undefined;
  /** Draw an arrow cap on subjects whose "Ongoing" cell is non-empty and non-zero
   *  (the sets membership rule). Default true. */
  showOngoingArrow?: boolean | undefined;
  /** Fill of the response-interval overlay drawn inside the bar. Default the house green. */
  responseFill?: string | undefined;
  /** Opacity of the response overlay (0–1). Default 0.9. */
  responseOpacity?: number | undefined;
}

/** Polar histogram / wind rose (Plot.rose when kind = "rose") — the first value column
 *  is an angle in degrees (wrapped mod 360), binned into equal sectors; each sector's
 *  count draws as a wedge from the centre. An optional second value column (magnitude)
 *  stacks the wedges into equal-width bands — the wind rose. */
export interface RoseStyle {
  /** Number of angular sectors (bins). Default 16; clamped 4–36. */
  sectors?: number | undefined;
  /** Number of magnitude bands the wedges stack into (needs a magnitude column).
   *  Default 4; clamped 1–8. */
  bands?: number | undefined;
  /** true (default): compass convention — 0° = North at the top, clockwise, N/NE/E…
   *  labels. false: mathematical — 0° = East, counterclockwise, degree labels. */
  compass?: boolean | undefined;
  /** The count rings (the circle lines, clickable and editable). Their own look, like the
   *  radar's rings: style presets never touch them. Show: default true. Colour: default the theme's line colour.
   *  Width: px, default 1. Dash: default solid. The ring numbers keep their own font and stay when the lines hide. */
  ringShow?: boolean | undefined;
  ringColor?: string | undefined;
  ringWidth?: number | undefined;
  ringDash?: LineDash | undefined;
  /** A magnitude band's own colour, keyed by band number from "0" (the lowest). A band with no entry keeps its shade
   *  of the Wedge colour. Its legend key follows. */
  bandColors?: Record<string, string> | undefined;
  /** A compass letter renamed on the graph (double-click), keyed by its own default words ("N", "NE", … or "0°",
   *  "45°", …) so a rename stays on its direction. Blank / the default words = back to the default. */
  directionText?: Record<string, string> | undefined;
  /** A compass letter dragged on the graph: its offset from where the chart places it, keyed like `directionText`. */
  directionOffsets?: Record<string, { dx: number; dy: number }> | undefined;
}

/** Timeline tracks (Plot.tracks when kind = "tracks"). Several stacked
 *  single-row tile strips, one per data column, laid along one shared time (x) axis. Each
 *  track colours on its own scale: a numeric column ramps on that column's own min/max
 *  (colormap + reverse come from the per-column colour settings — `seriesStyles[col].colorFromRamp`
 *  / `colorFromReversed`, the same knobs "Colour by data" uses); a text column becomes a
 *  categorical track, one palette hue per distinct label. Built to stack above/below another
 *  time-axis chart in the panel assembler: it consumes xAxisLength (the heatmap path, not a
 *  footprint kind), so its tile columns line up time-for-time with the neighbouring graph.
 *  This style slot holds only layout — the per-track colour choices live on the column. */
export interface TracksStyle {
  /** Height of each track strip, px. Undefined = share the plot height evenly across all
   *  tracks (honouring yAxisLength). Set to pin a fixed strip height. */
  trackHeight?: number | undefined;
  /** Gap between adjacent track strips, px. Default 4. */
  trackGap?: number | undefined;
  /** Gap between adjacent tiles within a track, px (0 = a seamless run of tiles). Default 0. */
  tileGap?: number | undefined;
  /** Show the track-name labels down the left category axis. Default true. */
  showTrackLabels?: boolean | undefined;
  /** Fallback colour ramp for numeric tracks that don't set their own per-column ramp.
   *  Default "viridis". */
  colormap?: GradRamp | undefined;
  /** Numeric track tiles + their strip colour bars — the colour shaping knobs, honoured for whichever ramp is chosen (built-in or
   *  `custom:<id>`). They override the same fields stored on a custom [[Gradient]], one field at
   *  a time (the `titleFont` merge idiom); a built-in ramp carries no shaping of its own, so for
   *  one of those these are the only source.
   *
   *  Note: `colorMidpoint` is a data value — the value that takes the middle colour of the ramp.
   *  Pin it to 0 so a diverging map centres on zero. (`Gradient.midpoint` is a fraction
   *  instead, because a saved gradient knows nothing about the data it will be used on.)
   *  Undefined = the centre of the range, i.e. no remap. */
  colorMidpoint?: number | undefined;
  /** Bends the mapping toward the low (>1) or high (<1) end of the data without moving the end
   *  colours — pulls detail out of a skewed distribution. Default 1 (linear). */
  colorGamma?: number | undefined;
  /** 0/undefined = a continuous ramp; n ≥ 2 = n discrete classes (the classic 5-class map), each
   *  taking the colour at its own centre. The colour bar follows. */
  colorSteps?: number | undefined;
  /** Colour space the ramp interpolates in: "rgb" (default),
   *  "hsl" (keeps a rainbow vivid instead of passing through grey) or "lab" (perceptually even). */
  colorSpace?: GradSpace | undefined;
  /** Fill a missing / non-numeric cell with `nanColor` instead of leaving a gap. Default
   *  false (a gap in the strip reads as "no data at that time"). */
  fillGaps?: boolean | undefined;
  /** Colour drawn for a missing cell when `fillGaps` is on. Default "#dddddd". */
  nanColor?: string | undefined;
}

/** Ternary plot (Plot.ternary when kind = "ternary") — each row a 3-part composition
 *  (first three value columns by position, normalized per row) drawn as one point inside
 *  an equilateral triangle. The three edge axes carry ticks and the column names; the
 *  triangular grid rides the standard Plot.grid options (density = divisions). */
export interface TernaryStyle {
  /** Tick labels read 0–100 (percent, default) instead of 0–1 fractions. */
  percent?: boolean | undefined;
  /** Per-edge-title drag offsets, keyed by the composition column's dataset id. Carried
   *  beside the base anchor so repeated drags compose (the venn/upset label rule). */
  axisLabelOff?: Record<NodeId, { dx: number; dy: number }> | undefined;
}

/** Funnel plot (Plot.funnel when kind = "funnel") — the publication-bias companion to the
 *  forest plot, drawn from the same table (Study · Estimate · Lower · Upper): X = effect,
 *  Y = each study's back-calculated standard error on an inverted axis (SE 0 at the top, the
 *  convention), one dot per study, a pseudo-CI triangle around the pooled effect. */
export interface FunnelStyle {
  /** Pooling model for the centre line + region apex: "fixed" (default) or "random"
   *  (DerSimonian-Laird). Same semantics as the forest plot's summary. */
  model?: "fixed" | "random" | undefined;
  /** Confidence level of the entered CIs (back-calculates each SE) and of the pseudo-CI
   *  region's slope. Default 0.95. */
  ciLevel?: number | undefined;
  /** Draw the dashed pooled-effect centre line (the registered `funnel-pooled` reference
   *  line — its look lives in refLineStyles like every other built line). Default true. */
  showPooled?: boolean | undefined;
  /** Shade the pseudo-CI triangle around the pooled effect. Default true. */
  showRegion?: boolean | undefined;
  /** Pseudo-CI region fill opacity (0–1). Default 0.08. */
  regionOpacity?: number | undefined;
  /** Contour-enhanced mode: shade significance bands (p .10 / .05 / .01) centred on zero
   *  instead of the pooled effect — the standard aid for judging whether asymmetry sits in
   *  significant or non-significant territory. Default false. */
  contour?: boolean | undefined;
  /** Scale each study dot's area by its inverse-variance weight (the forest plot's
   *  weightMarkers rule). Default false → uniform dots. */
  sizeByPrecision?: boolean | undefined;
  /** Duval-Tweedie trim-and-fill overlay: draw the imputed (mirrored) studies as hollow
   *  dots and mark the adjusted pooled effect with a second centre line (the registered
   *  `funnel-adjusted` reference line). Default false. */
  trimFill?: boolean | undefined;
}

/** GWAS QQ plot appearance (`Plot.qq` when kind = "qq"). Observed −log10(p) vs the uniform-null
 *  expectation; the y = x line and the genomic inflation λ are the standard companions. */
export interface QQStyle {
  /** Which column holds the P-values. Default: the "association" sheet's P column, else the
   *  first numeric column. A NodeId (column id). */
  pColumn?: NodeId | undefined;
  /** Draw the y = x null reference line (the registered `qq-identity` reference line — its look
   *  lives in refLineStyles). Default true. */
  showIdentityLine?: boolean | undefined;
  /** Print the genomic inflation factor λ in the corner. Default true. */
  showLambda?: boolean | undefined;
}

/** GWAS Manhattan plot appearance (`Plot.manhattan` when kind = "manhattan"). −log10(p) (Y) for
 *  every marker along the genome (X): chromosomes are laid end to end, one tick per chromosome at
 *  its span's midpoint, points coloured in two alternating shades per chromosome, with
 *  genome-wide + suggestive significance reference lines. A real GWAS is 10⁵–10⁶ points, so the
 *  dense low cloud is thinned by a pixel grid (peaks above [[keepAbove]] are never thinned). */
export interface ManhattanStyle {
  /** Column holding the P-values. Default: the "association" sheet's P column (last numeric). */
  pColumn?: NodeId | undefined;
  /** Column holding the chromosome of each marker. Default: the sheet's Chromosome column. */
  chrColumn?: NodeId | undefined;
  /** Column holding the base-pair position of each marker. Default: the sheet's Position column. */
  posColumn?: NodeId | undefined;
  /** Draw the genome-wide significance line (the registered `manhattan-genomewide` reference
   *  line — its look lives in refLineStyles). Default true. */
  genomeWideLine?: boolean | undefined;
  /** Genome-wide significance threshold as a P-value (the line sits at −log10 of it).
   *  Default 5×10⁻⁸ (−log10 ≈ 7.30). */
  genomeWideP?: number | undefined;
  /** Draw the suggestive significance line (the registered `manhattan-suggestive` reference
   *  line). Default true. */
  suggestiveLine?: boolean | undefined;
  /** Suggestive significance threshold as a P-value. Default 1×10⁻⁵ (−log10 = 5). */
  suggestiveP?: number | undefined;
  /** The first of the two alternating per-chromosome point colours (even chromosomes).
   *  Default a mid slate. */
  colorA?: string | undefined;
  /** The second alternating per-chromosome point colour (odd chromosomes). Default a light slate. */
  colorB?: string | undefined;
  /** Thin the dense sub-threshold cloud so the drawn count is capped by the pixel grid, not the
   *  input size (the shape is preserved; peaks above [[keepAbove]] are kept whole). Default true. */
  decimate?: boolean | undefined;
  /** Keep every point at or above this −log10(p) un-thinned — the interesting peaks are never
   *  binned away. Default 2 (p ≤ 0.01). */
  keepAbove?: number | undefined;
}

/** Bland-Altman (method-comparison) appearance (Plot.blandAltman when kind = "blandaltman").
 *  The first two value columns are the paired measurements from methods A and B. X = their
 *  mean, Y = their difference (A − B). Reference lines mark the bias (mean difference) and the
 *  limits of agreement (bias ± k·SD of the differences). */
export interface BlandAltmanStyle {
  /** Plot the difference as a percent of the mean (100·(A−B)/mean) instead of absolute units —
   *  the proportional-bias form. Default false. */
  percent?: boolean | undefined;
  /** Limits-of-agreement multiplier (× SD of the differences). Default 1.96 (≈ 95% limits). */
  agreementK?: number | undefined;
}

/** Population-pyramid appearance (Plot.pyramid when kind = "pyramid"). Rows = shared
 *  categories (e.g. age bands); the first two value columns are the two groups drawn as
 *  mirrored horizontal bars — group 1 grows left, group 2 grows right — from a central
 *  zero axis. The value axis is symmetric and its tick labels show absolute magnitudes. */
export interface PyramidStyle {
  /** Print each bar's value at its tip. Default false. */
  showValues?: boolean | undefined;
  /** Bar thickness as a fraction of the category band (0.1–1). Default 0.8. */
  barWidth?: number | undefined;
  /** Per-value-label position override (fractional plot-rect coords, keyed by
   *  `${datasetId}-${rowId}`) — set by dragging a value label. A missing entry
   *  keeps the label at its data-derived bar-tip position. Only meaningful when
   *  [[showValues]] is on. */
  valueLabelPos?: Record<string, { x: number; y: number }> | undefined;
  /** Per-value-label text override (keyed the same way) — set by double-click-editing a
   *  value label. Presentation only: the cell value is untouched. A missing/blank entry
   *  falls back to the formatted data value. */
  valueLabelText?: Record<string, string> | undefined;
}

/** Lollipop / dumbbell appearance (Plot.lollipop when kind = "lollipop"). All optional.
 *  One dataset → a lollipop (stem from the baseline to a value dot, + Δ% vs baseline);
 *  two+ datasets → a dumbbell (a dot per dataset joined by the stem, + Δ% first→last). */
export interface LollipopStyle {
  /** Baseline / index value the single-series stem grows from (and the reference line
   *  is drawn at). Default 0. Ignored for the dumbbell (two-dot) form. */
  baseline?: number | undefined;
  /** Print each dot's value as a bold data label. Default true. */
  showValues?: boolean | undefined;
  /** Print the Δ% change label at the value end. Default true. */
  showDelta?: boolean | undefined;
  /** Δ% change-label colour; undefined = the default green (`#1a9850`). */
  deltaColor?: string | undefined;
  /** Dot radius, px. Default 5. */
  dotSize?: number | undefined;
  /** Stem (connector) thickness, px. Default 2. */
  stemWidth?: number | undefined;
  /** Stem (connector) colour when unlinked; undefined = a neutral theme line. */
  stemColor?: string | undefined;
  /** Link the stem colour to the data-point (marker) colour. When true, the stem
   *  follows each dot's colour and `stemColor` is ignored. Default false (the stem
   *  is independent — its own `stemColor` / the neutral default). */
  stemLinkColor?: boolean | undefined;
}

/** Paired / grouped Cleveland dot plot (Plot.paireddot when kind = "paireddot").
 *  Horizontal category rows, one marker per numeric series on each row. A leading
 *  text column (besides the row-label X column) is auto-detected as a section
 *  grouping — rows are then bracketed by dashed dividers with a rotated section
 *  label on the right.
 *  All optional. */
export interface PairedDotStyle {
  /** How the per-series dots on a row relate. Default "toZero".
   *  "toZero" = a stem from the value-axis baseline to each dot (a double
   *  lollipop, the dots spread vertically within the band) · "dumbbell" = the
   *  dots sit on the row centre line joined by one connector · "none" = dots only. */
  connector?: "toZero" | "dumbbell" | "none" | undefined;
  /** Baseline the `toZero` stems grow from. Default 0. */
  baseline?: number | undefined;
  /** Dot radius, px. Default 5. */
  dotSize?: number | undefined;
  /** Stem / connector thickness, px. Default 2. */
  stemWidth?: number | undefined;
  /** Connector colour (dumbbell), and the `toZero` stem colour when not linked to
   *  the dot; undefined = a neutral theme line. */
  stemColor?: string | undefined;
  /** Link each `toZero` stem's colour to its own dot (the dumbbell connector always
   *  uses `stemColor` / the neutral default). Default true. */
  stemLinkColor?: boolean | undefined;
  /** Vertical spread of the stacked series dots within a row band, as a fraction of
   *  the band height (0 = all on the centre line, 1 = fill the band). Only applies in
   *  `toZero` mode. Default 0.55. */
  seriesSpread?: number | undefined;
  /** Print each dot's value as a bold data label. Default false. */
  showValues?: boolean | undefined;
  /** Draw the section dividers + rotated section labels when the table carries a
   *  text grouping column. Default true. */
  showSections?: boolean | undefined;
  /** Section divider / label colour; undefined = a muted brown-grey theme ink. */
  sectionColor?: string | undefined;
  /** Per-section-label drag offsets (scene px, keyed by the section's text) — set by
   *  dragging a rotated section heading. A missing entry centres it on the section. */
  sectionLabelOffsets?: Record<string, { dx: number; dy: number }> | undefined;
}

/** Histogram appearance (kind = "histogram"). */
export interface HistogramStyle {
  /** Number of bins; undefined = auto (a nice bin width near the Sturges target).
   *  Setting an explicit count divides the data range exactly into that many bins. */
  bins?: number | undefined;
  /** Explicit bin width (data units). Takes precedence over `bins`; the first edge
   *  snaps to a multiple of the width (unless `origin` is set) so the edges stay tidy. */
  binWidth?: number | undefined;
  /** First-bin lower edge. Undefined = auto (data min, or a nice multiple of the width). */
  origin?: number | undefined;
  /** Explicit histogram bins, each a `[lo, hi]` range in data units; `null` = open-ended on that
   *  side. Supports unequal widths, gaps (a value in no range is left out — the scene reports how
   *  many) and open bins: `[90, null]` = "90+", `[null, 10]` = "under 10". Bins are half-open
   *  `[lo, hi)`, except a value on a bin's upper edge that no other bin claims falls into it (so
   *  the maximum, and shared edges, land where a histogram expects). Takes precedence over
   *  `binWidth`/`bins`/`origin`. Empty / all-invalid = ignored (falls back to width/count). */
  binRanges?: Array<[number | null, number | null]> | undefined;
  /** Draw each bar's width proportional to its bin's data range on a continuous numeric X axis,
   *  so unequal bins read correctly (a 40-wide bin is twice a 20-wide one) — a true
   *  variable-width histogram. Default false = equal-width categorical bars with range labels.
   *  Vertical bars only; open-ended bins are clamped to the data extent for their width. */
  proportionalWidth?: boolean | undefined;
  /** Draw a data-point marker at each bar's top. Default false — a histogram is bars; the dots
   *  are off unless switched on. (The bar-width slider governs the gaps between bars.) */
  showPoints?: boolean | undefined;
  /** What the bar heights represent. Default "count".
   *  relative = fraction of total · percent = % of total · cumulative(+Percent) = running total. */
  freq?: "count" | "relative" | "percent" | "cumulative" | "cumulativePercent" | undefined;
  /** Overlay a fitted normal (Gaussian) curve — the bell with the data's own mean and SD, scaled
   *  to the histogram's frequency axis (count / relative / percent). Default false. Drawn on
   *  frequency modes only (a cumulative histogram warns instead). */
  normalCurve?: boolean | undefined;
  /** Colour of the normal-curve overlay. Default a dark accent. */
  normalCurveColor?: string | undefined;
  /** Overlay a kernel density estimate (the violin's Gaussian KDE, Silverman bandwidth) scaled to
   *  the frequency axis exactly like the normal curve — the data's own smooth shape, no
   *  distribution assumed. Default false. Same refusals as the normal curve (cumulative modes,
   *  custom/open bins). When both curves are on, the normal one is dashed. */
  densityCurve?: boolean | undefined;
  /** Colour of the density-curve overlay. Default a teal accent. */
  densityCurveColor?: string | undefined;
  /** Bandwidth multiplier (× Silverman's rule) for the density curve: <1 spikier, >1 smoother.
   *  Default 1. */
  densityBandwidth?: number | undefined;
}

/** 3-D scatter camera (kind = "scatter3d"): orbit angles + dolly so the user can
 *  drag to rotate and scroll to zoom. Undefined fields fall back to a default
 *  three-quarter view from slightly above. */
export interface Scatter3DStyle {
  /** Horizontal orbit angle (radians); undefined = default. */
  azimuth?: number | undefined;
  /** Vertical tilt angle (radians), clamped so the view never flips; undefined = default. */
  elevation?: number | undefined;
  /** Zoom / dolly factor (1 = default), clamped to 0.3–4. */
  zoom?: number | undefined;
  /** Z-axis title fallback: `zAxis.title` takes precedence, and undefined here = the 3rd
   *  column's name. (X/Y titles live on the standard xAxis/yAxis specs.) */
  zTitle?: string | undefined;
  /** Free drag offset (px) of the Z axis label. X and Y keep theirs on their own AxisSpec
   *  (`titleOffset`); the Z offset lives here, and the builder reads it from here rather than
   *  from `zAxis.titleOffset`.
   *
   *  The labels orbit with the camera, and every text on a graph is draggable, so the
   *  offset is applied after projection: it survives an orbit instead of fighting it. */
  zTitleOffset?: { dx: number; dy: number } | undefined;
  /** Floor-grid line colour; undefined = a neutral theme line. */
  gridColor?: string | undefined;
  /** Show the floor grid (x–z plane). Default true. */
  showGrid?: boolean | undefined;
  /** Depth cue: fade points nearer the back of the cloud so front/back reads on a
   *  no-perspective isometric view. Default false → every point the same opacity.
   *  Opacity only (never size — this chart has no size channel to borrow). */
  depthShade?: boolean | undefined;
}

/** Radar/spider chart (kind = "radar"): the concentric grid, spokes, scale, and
 *  vertex markers. Per-series line/fill colour live on SeriesStyle; these are the
 *  chart-wide frame controls (the "Radar chart" inspector section). */
export interface RadarStyle {
  /** Spoke (radial axis) line colour; undefined = a neutral theme line. */
  spokeColor?: string | undefined;
  /** Spoke line width. Default 1. */
  spokeWidth?: number | undefined;
  /** Concentric-ring (grid) colour; undefined = a neutral theme line. */
  gridColor?: string | undefined;
  /** Concentric-ring width. Default 1. */
  gridWidth?: number | undefined;
  /** Number of concentric rings. Default 4. */
  ringCount?: number | undefined;
  /** Outer scale value (the outermost ring). Undefined = auto (nice ceiling of the data). */
  scaleMax?: number | undefined;
  /** Draw a marker dot at each vertex. Default true. */
  showDots?: boolean | undefined;
  /** Vertex dot radius. Default 2.5. */
  dotSize?: number | undefined;
  /**
   * The web's own styling: clicking the spider grid selects it, and its panel holds colour,
   * thickness, dashes and tick marks. Colour and thickness are above; these are the rest.
   */
  /** Concentric-ring dash pattern. Default "solid". */
  gridDash?: LineDash | undefined;
  /** Spoke (radial axis) dash pattern. Default "solid". */
  spokeDash?: LineDash | undefined;
  /** Tick marks on the vertical axis at each labelled ring, like an axis has. Default false. */
  showTicks?: boolean | undefined;
  /** Tick-mark length, px. Default 5. */
  tickLen?: number | undefined;
  /** Tick-mark colour; undefined = the grid colour. */
  tickColor?: string | undefined;
  /**
   * Font for the category labels at each spoke end. Separate from the tick font, which a
   * radar has no other use for and which no panel on this chart shows.
   */
  labelFont?: FontSpec | undefined;
  /** Font for the ring value labels up the vertical axis; undefined = follow `labelFont`,
   *  then the tick font. Separate because they are numbers, not names — a reader usually
   *  wants them smaller than the category labels. */
  ringFont?: FontSpec | undefined;
  /**
   * Draw a spread interval at each vertex when the data has replicates (or summary stats) —
   * radar's answer to error bars. "none" (default) = no interval. sd/sem = ±spread of the replicate mean; ci95 = a 95% CI. The interval is computed
   * per (series, spoke) through the same `errorPoint` routine as bars/points. On a
   * single-value dataset there is nothing to spread, so it draws nothing. */
  errorType?: "none" | "sd" | "sem" | "ci95" | undefined;
  /** Show the interval as a translucent band between the low/high polygons instead of a radial
   *  whisker at each vertex. Default false (whiskers). */
  errorBand?: boolean | undefined;
}

/** Voronoi treemap (kind = "treemap"): an area-proportional tessellation — one
 *  convex cell per row, sized by its value, tiling a boundary. Per-cell colour
 *  comes from the palette / seriesStyles / group; these are the chart-wide frame
 *  controls (the "Treemap" inspector section). */
export interface TreemapStyle {
  /** Tessellation algorithm. "voronoi" = weighted-Voronoi cells (any boundary);
   *  "squarified" = the classic rectangular treemap (nested by group). Default "voronoi". */
  layout?: "voronoi" | "squarified" | undefined;
  /** Boundary shape the cells tile (Voronoi layout only). Default "circle". */
  boundary?: "circle" | "ellipse" | "rect" | undefined;
  /** Colour cells by a category column (a "region" grouping): the id of a column
   *  whose per-row value assigns each cell to a group. Each group gets a palette
   *  hue; cells within a group are shaded light→dark by value. Undefined = colour
   *  each cell independently from the palette. Parts-of-whole tables only. */
  groupColumn?: NodeId | undefined;
  /** Draw each region's name as a curved label around the boundary perimeter. Only takes
   *  effect with `groupColumn` set on a Voronoi circle/ellipse boundary. Default false. */
  showGroupLabels?: boolean | undefined;
  /** Per-region drag offsets (scene px) for the perimeter region labels, keyed by the
   *  group value. Set by dragging a region heading. */
  groupLabelOffsets?: Record<string, { dx: number; dy: number }> | undefined;
  /** Column whose per-row text/emoji is drawn as a small badge atop each cell (a flag
   *  or symbol). Parts-of-whole tables only. Undefined = none. */
  iconColumn?: NodeId | undefined;
  /** Draw each cell's label (from the leading label column). Default true. */
  showLabels?: boolean | undefined;
  /** Append each cell's value beneath its label. Default false. */
  showValues?: boolean | undefined;
  /** Shrink label text on smaller cells (so labels fit). Default true. */
  scaleLabels?: boolean | undefined;
  /** Base label font size (px); undefined = the theme tick size. */
  labelSize?: number | undefined;
  /** Cell border colour. Default "#ffffff". */
  stroke?: string | undefined;
  /** Cell border width (px). Default 1.5. */
  strokeWidth?: number | undefined;
  /** Cell fill opacity (0..1). Default 1. */
  fillOpacity?: number | undefined;
  /** Solver iteration budget — higher = tighter area fidelity, slower. Default 160. */
  iterations?: number | undefined;
  /** Seed for the deterministic initial layout (change to reshuffle the packing). */
  seed?: number | undefined;
}

/** Sunburst appearance (`Plot.sunburst` when kind = "sunburst"). A radial parts-of-a-whole: the
 *  leading categorical columns are hierarchy levels (inner ring = level 1), a value column (or the
 *  row count) sizes each leaf, and a segment sweeps the angle of its share of the whole. */
export interface SunburstStyle {
  /** The hierarchy level columns, inner→outer, as column ids. Default: the leading text columns
   *  (the alluvial rule). Must name at least one. */
  levelColumns?: NodeId[] | undefined;
  /** Column whose per-row number sizes each leaf. Default: the first numeric column after the
   *  level columns; absent → each row counts as 1. */
  valueColumn?: NodeId | undefined;
  /** Draw each segment's category label along its arc. Default true. */
  showLabels?: boolean | undefined;
  /** Append each segment's value/percentage beneath its label. Default false. */
  showValues?: boolean | undefined;
  /** Base label font size (px); undefined = the theme tick size. */
  labelSize?: number | undefined;
  /** Angular gap between sibling segments, in degrees (0..5). Default 0. */
  padAngle?: number | undefined;
  /** Radius of the empty centre hole as a fraction of the full radius (0 = full pie, 0.4 = a
   *  donut hole). Default 0. */
  innerRadius?: number | undefined;
  /** Segment border colour. Default "#ffffff". */
  stroke?: string | undefined;
  /** Segment border width (px). Default 1. */
  strokeWidth?: number | undefined;
  /** Segment fill opacity (0..1). Default 1. */
  fillOpacity?: number | undefined;
  /** Print the grand total in the centre hole (only visible with a non-zero [[innerRadius]]).
   *  Default false. */
  showTotal?: boolean | undefined;
}

/** Chord / circos appearance (`Plot.chord` when kind = "chord"). Entities are arcs around a ring;
 *  a weighted relationship is a ribbon whose ends sit on the two arcs. Reads an edge list
 *  (Source · Target · Weight) or a square adjacency matrix. */
export interface ChordStyle {
  /** Column holding the link source. Default: the edge-list sheet's first column. */
  sourceColumn?: NodeId | undefined;
  /** Column holding the link target. Default: the second column. */
  targetColumn?: NodeId | undefined;
  /** Column holding the link weight. Default: the first numeric column after the endpoints; a
   *  missing weight counts as 1. */
  weightColumn?: NodeId | undefined;
  /** Colour each node's arc by a category column (a node's group travels with its first
   *  appearance as a source — the network rule). Undefined = one palette hue per node. */
  groupColumn?: NodeId | undefined;
  /** Order the nodes around the ring: first-appearance ("input", default), by descending
   *  incident weight ("weight"), or alphabetically ("name"). */
  order?: "input" | "weight" | "name" | undefined;
  /** Gap between adjacent node arcs, in degrees (0..10). Default 2. */
  padAngle?: number | undefined;
  /** Radial thickness of the node ring as a fraction of the radius (0.02..0.2). Default 0.08. */
  arcThickness?: number | undefined;
  /** Ribbon fill opacity (0..1). Default 0.65. */
  ribbonOpacity?: number | undefined;
  /** Colour each ribbon by its source node's hue (else a neutral grey). Default true. */
  colorBySource?: boolean | undefined;
  /** Draw each node's name outside its arc. Default true. */
  showLabels?: boolean | undefined;
  /** Node-label font size (px); undefined = the theme tick size. */
  labelSize?: number | undefined;
}

/** Oncoprint appearance (`Plot.oncoprint` when kind = "oncoprint"). A genes × samples grid of
 *  categorical tiles: genes down the rows (ordered by alteration frequency), samples across the
 *  columns (memo-sorted into the staircase), each cell coloured by its alteration type(s). Reads an
 *  "alterations" sheet (Sample · Gene · Alteration, one row per event). */
export interface OncoprintStyle {
  /** Column holding the sample of each event. Default: the sheet's first column. */
  sampleColumn?: NodeId | undefined;
  /** Column holding the gene. Default: the second column. */
  geneColumn?: NodeId | undefined;
  /** Column holding the alteration type. Default: the third column. */
  alterationColumn?: NodeId | undefined;
  /** Order the gene rows: by descending alteration frequency ("freq", default) or first
   *  appearance ("input"). */
  geneSort?: "freq" | "input" | undefined;
  /** Order the sample columns: the memo staircase ("memo", default) or first appearance
   *  ("input"). */
  sampleSort?: "memo" | "input" | undefined;
  /** Gap between tiles as a fraction of the cell (0..0.5). Default 0.15. */
  tileGap?: number | undefined;
  /** Print each gene's altered-sample percentage at the left of its row. Default true. */
  showPercent?: boolean | undefined;
  /** Draw the sample names under the columns (hundreds of samples → off by default). Default false. */
  showSampleLabels?: boolean | undefined;
  /** Colour of an unaltered cell's background. Default a light grey. */
  emptyColor?: string | undefined;
  /** Colour of the gaps between tiles (the gap line colour): a panel
   *  of it behind the tiles, from the first tile's edge to the last. Undefined = nothing behind (see-through). */
  gapColor?: string | undefined;
  /** A gene / sample name dragged on the graph: its offset from where the chart places it, keyed by the name. */
  geneLabelOffsets?: Record<string, { dx: number; dy: number }> | undefined;
  sampleLabelOffsets?: Record<string, { dx: number; dy: number }> | undefined;
  /** Row/column label font size (px); undefined = the theme tick size. */
  labelSize?: number | undefined;
}

/**
 * Overrides for one axis of a parallel-coordinates plot, keyed by its column id in
 * `ParallelStyle.perAxis`. Every field falls back to the plot-wide value when unset.
 *
 * Deliberately not `AxisSpec`. That interface has over thirty fields and a parallel axis can only
 * honour a handful; declaring the whole thing here would make the other ~28 silent no-ops —
 * a control that looks live and does nothing, which is the exact defect class the dead
 * style-field detector exists to catch. Grow this interface one honoured field at a time.
 */
export interface ParallelAxisSpec {
  /** Exact tick interval in data units (e.g. every 0.5). Undefined = auto spacing.
   *  Wins over `tickCount` — an interval is a stronger statement than a count. */
  majorStep?: number | undefined;
  /** Unlabelled minor ticks between each pair of majors. Default 0 (none). */
  minorCount?: number | undefined;
  /** Ticks on this axis; undefined = the plot-wide `ParallelStyle.tickCount`. */
  tickCount?: number | undefined;
  /**
   * How this axis's numbers are written. One variable can be a percentage and the next a
   * count, so each axis has its own format.
   *
   * Note: an explicit `decimals` takes precedence over the ladder's own rule ("as many places
   * as it takes to print each tick exactly"). That rule is the fallback when no value is set;
   * a request for 1 decimal place prints 1.
   */
  format?: NumberFormat | undefined;
  decimals?: number | undefined;
  prefix?: string | undefined;
  suffix?: string | undefined;
  thousands?: ThousandsSeparator | undefined;
  /** Replace the label above this axis. Undefined = the column's own name. Presentation only —
   *  the column is untouched, so "Sepal length (cm)" on the figure leaves `sl` in the sheet. */
  title?: string | undefined;
  /**
   * Flip this axis so its low values sit at the top. Default false.
   *
   * Not cosmetic: where two neighbouring variables are negatively correlated every line
   * crosses between them in an X, and individual cases cannot be followed through it. Flipping
   * one of the two turns that X into a parallel sheaf and the pattern reappears — the same job
   * as dragging axes into a better order, which this chart already supports.
   */
  reversed?: boolean | undefined;
  /**
   * Extra ticks at chosen values, drawn on top of the automatic ladder — a threshold, a
   * reference level, a clinical cut-off. A blank label prints the formatted number, so a tick
   * added purely to mark a value still reads.
   *
   * A value outside this axis's data extent is dropped, not clamped: a tick pinned to an end
   * would claim the axis reaches a value it does not.
   */
  extraTicks?: Array<{ value: number; label?: string | undefined }> | undefined;
}

/** Parallel-coordinates plot (kind = "parallel"): each numeric column is a
 *  vertical axis (independently scaled); each row is a polyline crossing every
 *  axis at its value — a multivariate pattern view. Lines colour by an optional
 *  category column; these are the chart-wide frame controls. */
export interface ParallelStyle {
  /** Column whose per-row value colours each line. Excluded from the axes.
   *  Undefined = a single line colour. */
  colorColumn?: NodeId | undefined;
  /** How the colour column maps to line colour: "auto" (a numeric column → a continuous
   *  value ramp + colorbar; else category hues + legend), or force one. Default "auto". */
  colorScale?: "auto" | "category" | "value" | undefined;
  /** Colour ramp for the continuous ("value") colouring. Default "viridis". */
  colorRamp?: GradRamp | undefined;
  /** Reverse the value ramp (high values take the low-end colour). Default false. */
  colorReverse?: boolean | undefined;
  /** Parallel-coordinate lines + their colour bar — the colour shaping knobs, honoured for whichever ramp is chosen (built-in or
   *  `custom:<id>`). They override the same fields stored on a custom [[Gradient]], one field at
   *  a time (the `titleFont` merge idiom); a built-in ramp carries no shaping of its own, so for
   *  one of those these are the only source.
   *
   *  Note: `colorMidpoint` is a data value — the value that takes the middle colour of the ramp.
   *  Pin it to 0 so a diverging map centres on zero. (`Gradient.midpoint` is a fraction
   *  instead, because a saved gradient knows nothing about the data it will be used on.)
   *  Undefined = the centre of the range, i.e. no remap. */
  colorMidpoint?: number | undefined;
  /** Bends the mapping toward the low (>1) or high (<1) end of the data without moving the end
   *  colours — pulls detail out of a skewed distribution. Default 1 (linear). */
  colorGamma?: number | undefined;
  /** 0/undefined = a continuous ramp; n ≥ 2 = n discrete classes (the classic 5-class map), each
   *  taking the colour at its own centre. The colour bar follows. */
  colorSteps?: number | undefined;
  /** Colour space the ramp interpolates in: "rgb" (default),
   *  "hsl" (keeps a rainbow vivid instead of passing through grey) or "lab" (perceptually even). */
  colorSpace?: GradSpace | undefined;
  /** Line width (px). Default 1. */
  lineWidth?: number | undefined;
  /** Line opacity (0..1) — low values reveal density in a dense plot. Default 0.6. */
  lineOpacity?: number | undefined;
  /** Draw smooth (curved) links instead of straight segments. Default false. */
  curved?: boolean | undefined;
  /** Draw each axis' value-tick ladder. Default true. */
  showTicks?: boolean | undefined;
  /** Ticks per axis. Undefined = auto, derived from the axis length and the tick font size so
   *  the labels can never stack on each other. A hint, not a promise: the ladder is snapped to
   *  round 1/2/5 values, so the count landed on is the nearest one that stays on that
   *  sequence and clears the minimum label gap. */
  tickCount?: number | undefined;
  /** Per-axis overrides, keyed by column id — the same keying as `brushes` and `axisOrder`,
   *  so a setting survives a re-sort of the table. Unset axes use the plot-wide values. */
  perAxis?: Record<NodeId, ParallelAxisSpec> | undefined;
  /** Axis line colour; undefined = a neutral theme line. */
  axisColor?: string | undefined;
  /** Single line colour when no colour column is set; undefined = the first palette hue. */
  lineColor?: string | undefined;
  /** Per-line colour overrides (source row id → colour) — set by clicking one line and
   *  recolouring it, to pull a single case out of the bundle. Wins over the colour-column
   *  mapping / `lineColor` for that row only. Keyed by row id, so it survives a re-sort. */
  lineColors?: Record<string, string> | undefined;
  /** Per-line width overrides (row id → px). Colour alone could not pull one case out of a
   *  dense bundle — thickness is what makes a trace readable against the rest. Same row-id
   *  keying as `lineColors`, so it survives a re-sort. */
  lineWidths?: Record<string, number> | undefined;
  /** Per-line opacity overrides (row id → 0..1). Lets one trace stay solid while the bundle
   *  behind it stays faint. Same row-id keying as `lineColors`. */
  lineOpacities?: Record<string, number> | undefined;
  /** Heading drawn beside the value colour bar; undefined = the colour column's name.
   *  Presentation only — the column itself is untouched. */
  colorbarTitle?: string | undefined;
  /** Per-axis brush filter: column id → [lo, hi] data range. A line is dimmed unless it
   *  falls within every brushed axis's range (drag on an axis to set; click to clear). */
  brushes?: Record<string, [number, number]> | undefined;
  /** Axis (column) display order, by column id. Columns not listed keep their natural
   *  table order after the listed ones. Undefined = table order (drag a label to reorder). */
  axisOrder?: NodeId[] | undefined;
}

/** Bubble chart (kind = "bubble"): a 3rd column drives each point's radius. These
 *  parameters (the size legend + radius range) live in the Annotate section. */
export interface BubbleStyle {
  /** Show the vertical size legend on the right. Default true. */
  showSizeLegend?: boolean | undefined;
  /** Size-legend heading; undefined = the size column's name. */
  sizeLegendTitle?: string | undefined;
  /** Smallest / largest bubble radius in px (the size column min/max map to these). */
  minRadius?: number | undefined;
  maxRadius?: number | undefined;
  /** Explicit reference values shown in the size legend (each gets its own sphere at
   *  the matching radius). Undefined = auto (max · mid · min of the size column). */
  sizeLegendValues?: number[] | undefined;
  /** Legend display scale (1 = default); resizes the reference spheres + labels. */
  sizeLegendScale?: number | undefined;
}

/** Volcano plot (kind = "volcano"): X = log2 fold-change, Y = −log10 p-value.
 *  Points are coloured by significance (up / down / not-significant) against two
 *  thresholds, with dashed guide lines drawn at them. */
export interface VolcanoStyle {
  /** |log2 fold-change| cutoff for "significant". Default 1 (a 2-fold change). */
  fcThreshold?: number | undefined;
  /** −log10 p cutoff for "significant". Default ≈1.30 (p < 0.05). */
  pThreshold?: number | undefined;
  /** Significance-zone colours (editable). Defaults: up #1a9850, down #d62728, ns #b3b6bd. */
  upColor?: string | undefined;
  downColor?: string | undefined;
  nsColor?: string | undefined;
}

/** Per-series presentation overrides (keyed by the series' source column id). */
export interface SeriesStyle {
  /**
   * Colour of the raw-point swarm — a raincloud's rain, a column scatter's dots, the "show all
   * points" overlay on a box/violin/bar. Undefined = the series colour.
   *
   * Exists because the rain shares `color` with the violin body it sits beside; a colour of
   * its own lets the dots read against the cloud. Rain points have size and colour settings,
   * like any data point.
   */
  pointColor?: string | undefined;
  /** Symbol + line colour (fill when filled; border when open). Any CSS/hex colour. */
  color?: string | undefined;
  /** Which value axis this series is plotted against: "y" (left, default), "y2" (the
   *  first right-hand axis) or "y3" (a second right-hand axis, outside y2). Assigning
   *  ≥1 series to "y2"/"y3" draws that axis. */
  axis?: "y" | "y2" | "y3" | undefined;
  /** Composite (combination) charts: render this series over a bar/column chart as a `line`
   *  (through its category values), as `points` (its replicate swarm, or one marker at the
   *  mean on summary data) or as an `area` (filled from its values down to the baseline, the
   *  line along the top) instead of bars. Absent/"bars" = the chart's own kind. Honoured by
   *  the vertical categorical (bar/column) builder; refused with a warning on stacked/percent
   *  layouts. Drawn area → bars → line/points, so a fill never hides the bars.
   *  On an XY plot: absent/"auto" = markers + a connecting line (Connect/Shape decide);
   *  "line" hides the markers, "points" drops the line, "area" fills this series down to the
   *  baseline (refused on a log Y axis). `plotAs` beats Connect/Shape. */
  plotAs?: "auto" | "bars" | "line" | "points" | "area" | undefined;
  /** Hide this series' own line/markers. It still feeds the spread band + average
   *  (e.g. a band over every team with only a few teams drawn). Default false. */
  hidden?: boolean | undefined;
  /**
   * Focus this series: while any series on the plot carries it, every series without it is
   * drawn in grey — still there, still readable, but pushed to the background.
   *
   * The sibling of `hidden`, and deliberately not the same thing. Hiding a curve removes the
   * evidence; a reader cannot tell whether the others were flat, absent, or never measured.
   * Greying keeps the whole dataset on the page and says which part of it the figure is about
   * — the "highlight one group, mute the rest" figure.
   *
   * Off unless something is focused. With no series carrying it the plot draws exactly as
   * before, so switching the last one back off is the one click that undoes the whole effect.
   */
  focus?: boolean | undefined;
  /** Marker shape. Default "circle". */
  symbol?: SymbolShape | undefined;
  /** Marker size (radius-equivalent, px). Default 4. Continuous. */
  symbolSize?: number | undefined;
  /** Filled marker vs open (hollow). Default true. Read only when `symbolFill` is unset. */
  filled?: boolean | undefined;
  /**
   * Symbol fill mode: `solid` (filled interior), `open` (page-colour interior —
   * hides what's behind), `clear` (transparent interior — overlapping points and
   * lines show through). Default derives from `filled` (true→solid, false→open).
   */
  symbolFill?: SymbolFill | undefined;
  /** Symbol fill + outline opacity (0–1). Default 1 (opaque). */
  symbolOpacity?: number | undefined;
  /** Symbol outline (border) colour; default = the series colour (lets fill ≠ edge). */
  symbolOutline?: string | undefined;
  /** Interior fill colour for open (hollow) markers — lets a hollow circle carry a
   *  light fill under a darker outline (a two-tone marker). Only used when
   *  `symbolFill` = "open"; undefined = the page background (the classic hollow look). */
  symbolFillColor?: string | undefined;
  /** Contour (border) thickness for open markers, px. Default 1.5. Continuous.
   *  Note: on a bar chart this is the bar's contour width — see `symbolBorderWidth` for the
   *  outline of the individual-points swarm drawn over it. */
  borderWidth?: number | undefined;
  /** Outline thickness for the individual-points swarm on a bar chart, px. Default 1.5.
   *  Separate from `borderWidth` so thickening a bar's contour does not thicken every dot
   *  on it — the bar and the points over it are unrelated marks. */
  symbolBorderWidth?: number | undefined;
  /** Two-tone lightness/darkness for the points on a bar chart (0–1). Separate from
   *  `twoToneTint`/`twoToneShade`, which are the bar's own two-tone fill — tuning one
   *  must not move the other. Undefined = the marker default, not the bar's value. */
  symbolTwoToneTint?: number | undefined;
  symbolTwoToneShade?: number | undefined;
  /** Make the individual points inherit the bar's fill look (its colour and its two-tone
   *  lightness/darkness) instead of carrying their own. Undefined = on: a dot drawn over its
   *  own bar reads as part of that bar, so matching it is the default and diverging is a
   *  deliberate choice. Set `false` to
   *  unlink and tune the points with their own colour / `symbolTwoToneTint` / `symbolTwoToneShade`. */
  linkPointsToBar?: boolean | undefined;
  /**
   * Forest summary only (`seriesStyles["forest-summary"]`) — how the pooled estimate is drawn.
   *
   * - `"diamond"` (default), `"bar"`, `"roundbar"`, `"lens"` and `"bowtie"` all span the pooled
   *   confidence interval: their width is the CI, which is the meaning of the shape. They
   *   have no glyph to choose. Every summary shape spans the interval — a shape that did not
   *   would stop reporting it, which is the summary's purpose.
   *     · `roundbar` — a bar with its ends rounded off.
   *     · `lens`     — a pointed oval (an ellipse pinched at the CI ends).
   *     · `bowtie`   — narrow at the estimate, flaring to the CI ends.
   *     · `ellipse`  — a smooth oval with rounded ends (the lens's pointed ends, softened).
   * - `"marker"` draws one symbol at the pooled estimate with the CI as a whisker, exactly like
   *   a study row. Only then does the summary's own `symbol` apply — which is why the Shape
   *   row appears only in this mode.
   *
   * Note: independent of `linkSummaryToStudies`: the link carries the summary's colours, not its
   * form. A pooled diamond among study squares is the convention.
   */
  summaryShape?: "diamond" | "bar" | "roundbar" | "lens" | "bowtie" | "ellipse" | "marker" | undefined;
  /**
   * Forest summary only — the summary wears the study markers' appearance (colour, fill mode,
   * fill colour, opacity, outline colour, outline width, size) instead of its own.
   *
   * Default true on a graph that has never styled its summary, so a new forest plot reads as
   * one object and restyling the studies carries the summary with it. Default false when the
   * plot already carries summary appearance overrides, so a hand-styled summary does not
   * revert when this field is first read. The Inspector shows it as a tickbox, on by default;
   * unticking it allows the summary to be tuned separately.
   *
   * Unticking it in the Inspector seeds the summary's own fields with the look it currently
   * has, so nothing jumps and the next edit starts from what is on screen.
   */
  linkSummaryToStudies?: boolean | undefined;
  /** How points are connected. Default "straight". */
  connect?: ConnectMode | undefined;
  /** Link the connecting-line colour to the data-point/series colour. Default true
   *  (they move together). Set false to colour the line independently via `lineColor`. */
  linkLineColor?: boolean | undefined;
  /** The connecting-line's own colour, used only when `linkLineColor` is false.
   *  Undefined even then = fall back to the series `color`. */
  lineColor?: string | undefined;
  /** Connecting-line / curve thickness, px. Default 2. Continuous. */
  lineWidth?: number | undefined;
  /** Line dash pattern. Default "solid". */
  lineDash?: LineDash | undefined;
  /** Smoothness (0–1) for the "cardinal" connect curve. Default 0.5. */
  lineTension?: number | undefined;
  /**
   * Error-bar type for this dataset. Default: "sd" when the dataset has ≥2
   * replicates (or summary error columns), else "none". Keyed by dataset id
   * (the lead `y` column), like the rest of this style.
   */
  errorBars?: ErrorBarType | undefined;
  /** Draw caps (T-bars) on the error bars. Default true. */
  errorCaps?: boolean | undefined;
  /** Which half of the bar to draw. Default "both". */
  errorDir?: ErrorBarDir | undefined;
  /** Error-bar colour. Default = the series colour. */
  errorColor?: string | undefined;
  /** Error-bar line thickness, px. Default derives from the line width. */
  errorWidth?: number | undefined;
  /** Error-bar cap half-width, px. Default derives from the symbol size. */
  errorCapWidth?: number | undefined;
  /**
   * How the error interval is drawn: as T-bars (default), as a filled ribbon following the
   * curve, or both.
   *
   * `band` shades the error interval as a ribbon around the curve through the mean or median.
   * The interval itself is the same either way — this is only its rendering, so
   * switching to `band` cannot alter what the graph reports: the ribbon's edges are the same
   * numbers as the caps.
   *
   * Note: a ribbon needs an ordered X and a curve to follow, so it is offered on XY and area
   * only. Elsewhere the control is hidden and the builder warns rather than silently ignoring.
   */
  errorDisplay?: "bars" | "band" | "both" | undefined;
  /** Ribbon fill colour (`errorDisplay` band/both); undefined = the series colour. */
  bandColor?: string | undefined;
  /** Ribbon fill opacity 0–1. Default 0.18 — light enough that overlapping series stay
   *  readable, which is the whole reason to prefer a band over bars. */
  bandOpacity?: number | undefined;
  /** Outline thickness on the ribbon's two edges, px. Default 0 = no outline (a soft fill).
   *  A thin edge is the usual journal look: it makes the interval's boundary exact when the
   *  fill is faint, and keeps two overlapping bands separable. */
  bandEdgeWidth?: number | undefined;
  /** Ribbon outline colour; undefined = the band's fill colour, at full opacity. */
  bandEdgeColor?: string | undefined;
  /** Ribbon outline dash pattern. Default "solid". */
  bandEdgeDash?: LineDash | undefined;
  // --- fill / contour (bar + box + area) ---
  /** Fill colour for bars/boxes. Default = the series colour. */
  fillColor?: string | undefined;
  /** Fill opacity (0–1). Default ≈0.9 for bars, ≈0.18 for boxes. */
  fillOpacity?: number | undefined;
  // --- per-bar value label (when the plot's `showValues` is on) ---
  /** Override text for this bar's value label; undefined = the formatted numeric value. */
  valueText?: string | undefined;
  /** Per-bar value-label horizontal nudge, scene px. Layers on the label's anchor. */
  valueDx?: number | undefined;
  /** Per-bar value-label vertical nudge, scene px. Layers on the plot-wide `valueLabelDy`. */
  valueDy?: number | undefined;
  // --- advanced fills (bars/boxes/violins) ---
  /** Fill style: solid colour · two-tone · pattern · gradient · metallic. Default "solid". */
  fillType?: FillType | undefined;
  // --- two-tone fill (fillType = "twotone"): derive both colours from one base hue ---
  /** Fill = base mixed this far toward white (0–1). Default 0.7 (a light tint). */
  twoToneTint?: number | undefined;
  /** Contour = base mixed this far toward black (0–1). Default 0.35 (a darker shade). */
  twoToneShade?: number | undefined;
  /** Custom edge (outline) colour for a two-tone marker. When set it overrides the
   *  hue-derived contour, letting you edit the edge for a two-tone fill too (the
   *  interior still derives from the hue + tint). Its own field — never seeded by a
   *  preset — so it can't stale-pin the derivation when unset. undefined = derived. */
  twoToneEdge?: string | undefined;
  /** Pattern tile (when fillType = "pattern"). Default "hatch". */
  pattern?: PatternKind | undefined;
  /** Pattern foreground (ink) colour; default = the fill colour. */
  patternColor?: string | undefined;
  /** Pattern background; "none"/undefined = transparent (chart shows through). */
  patternBg?: string | undefined;
  /** Pattern density/scale — multiplies the tile size (0.5 = fine, 2+ = bold). Default 1. */
  patternScale?: number | undefined;
  /** Themed special-effect preset when fillType = "special". Default "facets"; see [[specialKindOf]]. */
  special?: SpecialKind | undefined;
  // --- value-graduated fill (each bar/box shaded by its value) ---
  /** What the graduated fill maps to (value / x / order). Default "value". */
  gradMap?: GradMap | undefined;
  /** Graduated ramp / colormap. Default "lightness" (low = light, high = dark). */
  gradRamp?: GradRamp | undefined;
  /** Flip the ramp so low values read dark / opaque / ramp-end. Default false. */
  gradReversed?: boolean | undefined;
  /** High-end colour for the "twocolor" ramp (low end = the fill colour). */
  gradTo?: string | undefined;
  /** Value-graduated fills — the colour shaping knobs, honoured for whichever ramp is chosen (built-in or
   *  `custom:<id>`). They override the same fields stored on a custom [[Gradient]], one field at
   *  a time (the `titleFont` merge idiom); a built-in ramp carries no shaping of its own, so for
   *  one of those these are the only source.
   *
   *  Note: `gradMidpoint` is a data value — the value that takes the middle colour of the ramp.
   *  Pin it to 0 so a diverging map centres on zero. (`Gradient.midpoint` is a fraction
   *  instead, because a saved gradient knows nothing about the data it will be used on.)
   *  Undefined = the centre of the range, i.e. no remap. */
  gradMidpoint?: number | undefined;
  /** Bends the mapping toward the low (>1) or high (<1) end of the data without moving the end
   *  colours — pulls detail out of a skewed distribution. Default 1 (linear). */
  gradGamma?: number | undefined;
  /** 0/undefined = a continuous ramp; n ≥ 2 = n discrete classes (the classic 5-class map), each
   *  taking the colour at its own centre. The colour bar follows. */
  gradSteps?: number | undefined;
  /** Colour space the ramp interpolates in: "rgb" (default),
   *  "hsl" (keeps a rainbow vivid instead of passing through grey) or "lab" (perceptually even). */
  gradSpace?: GradSpace | undefined;

  /** Manual low/high bounds for the mapped value; undefined = auto (min/max). */
  gradMin?: number | undefined;
  gradMax?: number | undefined;
  /** Gradient end colour (start = the fill colour) when fillType = "gradient". */
  gradientTo?: string | undefined;
  /** Gradient angle in degrees (0 = →, 90 = ↓). Default 90. */
  gradientAngle?: number | undefined;
  /** Metallic / iridescent preset when fillType = "metallic". Default "silver". */
  metallic?: MetallicKind | undefined;
  /** Contour (outline/border) colour for bars/boxes. Default = the series colour. */
  borderColor?: string | undefined;
  /** Box width as a fraction of its category band (0.1–0.9). Default 0.5. On a column scatter saved
   *  without `pointSpread` it holds the dots' spread; read there only when `pointSpread` is unset. */
  boxWidth?: number | undefined;
  /** This series' own point spread (Data tab ▸ Point spread with "whole graph" unticked): overrides the graph's
   *  `Plot.pointSpread` for this series only. Same scale, 0.25–3; undefined = follow the graph. */
  pointSpread?: number | undefined;
  // --- violin (kind = "violin") ---
  /** Draw the inner quartile box inside the silhouette. Default true. */
  violinShowBox?: boolean | undefined;
  /** Inner quartile-box width as a fraction of the silhouette band (0.1–1). Default 0.34. */
  violinBoxWidth?: number | undefined;
  /** KDE bandwidth multiplier (× Silverman) — lower = spikier, higher = smoother. Default 1. */
  violinBandwidth?: number | undefined;
  // --- box & whisker glyph (the whiskers are conventionally styled as "error bars") ---
  /** Which whiskers draw: both / upper only / lower only. Default "both". */
  whiskerSides?: WhiskerSides | undefined;
  /** Whisker + cap colour. Default = the box contour (`borderColor`) / series colour. */
  whiskerColor?: string | undefined;
  /** Whisker + cap line thickness, px. Default = `borderWidth`. */
  whiskerWidth?: number | undefined;
  /** Draw the T-bar caps at the whisker ends. Default true. */
  whiskerCaps?: boolean | undefined;
  /** Cap (T-bar) half-width as a fraction of the box width (0–0.5). Default 0.28. */
  whiskerCapWidth?: number | undefined;
  /** Median line colour. Default = the box contour / series colour. */
  medianColor?: string | undefined;
  /** Median line thickness, px. Default = `borderWidth` + 0.8. */
  medianWidth?: number | undefined;
  /** Notch the box at the median: the notch spans median ± 1.58·IQR/√n, an approximate 95% CI of the median
   *  (McGill, Tukey & Larsen 1978 — the rule R and ggplot2 use). Two notches that do not overlap suggest the medians
   *  differ. Box, violin inner box and raincloud inner box. Default false. */
  boxNotch?: boolean | undefined;
  /** Draw the outlier dots beyond the whiskers. Default true. */
  showOutliers?: boolean | undefined;
  /** Outlier dot radius, px. Default 2.4. */
  outlierSize?: number | undefined;
  // --- data-driven per-point formatting (XY / area / bubble): map a table column to
  // each point's colour / symbol / label. All
  // resolved once at the buildPlotScene choke point (`paintDataDriven`), so a manual
  // "Format this point" override still wins over the column binding. ---
  /** Column id whose per-row value drives each point's colour. undefined = off
   *  (every point keeps the series colour). Only honoured on xy / area / bubble. */
  colorFromColumn?: NodeId | undefined;
  /** How the colour column maps: "auto" (numeric → a continuous ramp, else a palette
   *  per distinct value), "continuous" (force a ramp), "category" (force a palette).
   *  Default "auto". */
  colorFromMode?: "auto" | "continuous" | "category" | undefined;
  /** Continuous ramp / colormap for `colorFromColumn` (reuses the graduated-fill
   *  ramps: viridis / magma / … / lightness / twocolor). Default "viridis". */
  colorFromRamp?: GradRamp | undefined;
  /** Flip the continuous ramp (low value → the ramp's high end). Default false. */
  colorFromReversed?: boolean | undefined;
  /** Per-point colour from a data column (and the plot's colour bar) — the colour shaping knobs, honoured for whichever ramp is chosen (built-in or
   *  `custom:<id>`). They override the same fields stored on a custom [[Gradient]], one field at
   *  a time (the `titleFont` merge idiom); a built-in ramp carries no shaping of its own, so for
   *  one of those these are the only source.
   *
   *  Note: `colorFromMidpoint` is a data value — the value that takes the middle colour of the ramp.
   *  Pin it to 0 so a diverging map centres on zero. (`Gradient.midpoint` is a fraction
   *  instead, because a saved gradient knows nothing about the data it will be used on.)
   *  Undefined = the centre of the range, i.e. no remap. */
  colorFromMidpoint?: number | undefined;
  /** Bends the mapping toward the low (>1) or high (<1) end of the data without moving the end
   *  colours — pulls detail out of a skewed distribution. Default 1 (linear). */
  colorFromGamma?: number | undefined;
  /** 0/undefined = a continuous ramp; n ≥ 2 = n discrete classes (the classic 5-class map), each
   *  taking the colour at its own centre. The colour bar follows. */
  colorFromSteps?: number | undefined;
  /** Colour space the ramp interpolates in: "rgb" (default),
   *  "hsl" (keeps a rainbow vivid instead of passing through grey) or "lab" (perceptually even). */
  colorFromSpace?: GradSpace | undefined;

  /** Column id whose distinct values drive each point's symbol shape (values cycle
   *  through the shape set). undefined = off. Only honoured on xy / area / bubble. */
  symbolFromColumn?: NodeId | undefined;
  /** Label each point with a data value: "none" (default) · "x" (its X value) · "y"
   *  (its Y value) · "col" (a chosen column's value — `pointLabelColumn`). */
  pointLabels?: "none" | "x" | "y" | "col" | undefined;
  /** The column whose value labels each point when `pointLabels` = "col". */
  pointLabelColumn?: NodeId | undefined;
  /** Point-label font size (px). Default 9. */
  pointLabelSize?: number | undefined;
  /** Point-label colour. Default = the series colour. */
  pointLabelColor?: string | undefined;
  // --- find & highlight (beside Point labels): type or paste names; the points whose row carries one are drawn on
  // top in a highlight colour and labelled with it. Names not found are listed in the warning line. ---
  /** The names to find (case and surrounding spaces ignored). Empty/undefined = off. */
  highlightNames?: string[] | undefined;
  /** The column the names are in. Undefined = the Label column if set, else the table's first column of text. */
  highlightColumn?: NodeId | undefined;
  /** The highlight colour. Default magenta (#d81b60) — apart from the palette and a volcano's red / blue. */
  highlightColor?: string | undefined;
  /** Label each found point with its name. Default true. */
  highlightLabels?: boolean | undefined;
  /**
   * The user's drag of this series' direct label (`legend.position` = "direct"), in px from
   * where the placer put it.
   *
   * A dragged label is fixed: the builder places it at the drag and never moves it again,
   * and it becomes an obstacle the other labels must clear. Same rule as every other label in
   * this program — the placer owns an untouched label, the user owns a moved one.
   */
  directLabelOffset?: { dx: number; dy: number } | undefined;
  /** This series' leader lines — the thin line from its name (direct labels) or a moved value label back to its point
   *  (with its own editing tools). Show: default true. Colour: default the series colour
   *  at 60 % (its own colour draws at full strength). Width: px, default 0.75. */
  leaderShow?: boolean | undefined;
  leaderColor?: string | undefined;
  leaderWidth?: number | undefined;
  /** Bar chart: this series' own bar width, as a share of its place in the group (0.1–1; 100 % fills it, the default).
   *  Set with the Data tab's Bar width while its "whole graph" box is unticked; the bar keeps its centre, so its
   *  neighbours never move. The graph's width is `Plot.barWidth`. */
  barWidth?: number | undefined;
  // --- pie slice (when the parent plot kind = "pie"; `color` is the slice fill) ---
  /** Pull this slice out from the centre, as a fraction of the radius (0–0.4). Default 0. */
  sliceExplode?: number | undefined;
  /** Slice border colour; undefined = the page background (gap effect). */
  sliceStroke?: string | undefined;
  /** Slice border thickness, px. Default 1.5. */
  sliceStrokeWidth?: number | undefined;
  /** Per-slice label override; undefined = follow the plot's `pieLabels`. */
  sliceLabel?: PieLabelMode | undefined;
  /** Per-slice label font size (px) — overrides the shared slice-label font for this slice only. */
  sliceLabelSize?: number | undefined;
  /** Per-slice bold label. */
  sliceLabelBold?: boolean | undefined;
  /** Per-slice italic label. */
  sliceLabelItalic?: boolean | undefined;
}

/** Background-gridline style for a plot. All optional; the renderer fills defaults. */
/**
 * Named decorative backdrop palettes: `aurora` = pale blue→peach (light/airy), `spectrum` =
 * navy→purple→orange (vivid/dark), `tide` = cream→teal→deep blue (editorial/calm).
 */
export type BackdropPreset = "aurora" | "spectrum" | "tide";

/**
 * Opt-in decorative figure backdrop: a multi-stop gradient plus optional flowing
 * wave bands, drawn behind the whole figure (the poster/slide/social look).
 *
 * Note: off by default and never auto-applied. Wave opacity is capped by the builder
 * so the decoration cannot overpower the data and the figure stays readable.
 */
export interface BackdropStyle {
  /** Which palette to use. Default "aurora". */
  preset?: BackdropPreset | undefined;
  /** Gradient direction in degrees, clockwise from "to top". Default 135. */
  angle?: number | undefined;
  /** Draw the flowing wave bands over the gradient. Default true. */
  waves?: boolean | undefined;
  /** How many wave bands to draw (1–6). Default 3. */
  waveCount?: number | undefined;
  /** Wave band strength (0–1). Default 0.22. Note: the builder clamps the resulting per-band
   *  opacity to a hard cap, so setting this to 1 still cannot obscure the data. */
  waveOpacity?: number | undefined;
  /** Overall backdrop opacity (0–1). Default 1. */
  opacity?: number | undefined;
  /** Legibility scrim (0–1): a white veil over the decoration, under the figure content,
   *  so near-black chart text stays readable. Undefined = the preset's tuned default.
   *  Caution: lowering this on a dark preset reduces contrast; the default is chosen to
   *  clear the 4.5:1 body-text threshold. */
  scrim?: number | undefined;
  /** Seed for the deterministic wave shapes — change it to reshuffle. Default 1. */
  seed?: number | undefined;
}

export interface GridStyle {
  /** Show background gridlines. Default true. */
  show?: boolean | undefined;
  /** Gridline colour (hex); undefined = theme default. */
  color?: string | undefined;
  /** Gridline width in px. Default 1. */
  width?: number | undefined;
  /** Gridline dash pattern (solid/dashed/dotted/…). Default "solid". */
  dash?: LineDash | undefined;
  /** Target gridline count on linear axes ("grid size"). Default 6. */
  density?: number | undefined;
  /** Also draw minor gridlines (e.g. the 2–9 lines per decade on a log axis). Default false. */
  minor?: boolean | undefined;
}

/**
 * Confidence/data-ellipse overlay config (XY scatter). A covariance ellipse is
 * drawn around each series' points — the classic "uncertainty ellipse" of
 * ordination/PCA/PCoA plots. `mode`: `data` = the spread of the points (a 95%
 * data ellipse, default); `mean` = the confidence ellipse of the group mean
 * (shrinks by √n). `level` = the confidence level (0–1, default 0.95).
 */
export type EllipseMode = "data" | "mean" | "sd" | "sem";

export interface EllipseSpec {
  /** Draw the ellipses. Default false. */
  show?: boolean | undefined;
  /**
   * Uncertainty type:
   * - `data`  — confidence region of the points (χ² at `level`; the 95% data ellipse).
   * - `mean`  — confidence region of the group mean (χ² at `level`, ÷√n).
   * - `sd`    — `k` standard deviations along each principal axis.
   * - `sem`   — `k` standard errors of the mean (k·SD ÷√n).
   * Default "data".
   */
  mode?: EllipseMode | undefined;
  /** Confidence level 0–1 for the `data`/`mean` modes (e.g. 0.95). Default 0.95. */
  level?: number | undefined;
  /** Multiplier for the `sd`/`sem` modes (e.g. 1/2/3). Default 2. */
  k?: number | undefined;
  /** Interior fill opacity (0–1). Default 0.12. */
  fillOpacity?: number | undefined;
  /** Border thickness px. Default 1.5. */
  borderWidth?: number | undefined;
}

/** One line of a fit's parameter block, as the user set it ([[Plot.fitParams]]`.lines`). */
export interface FitParamLine {
  /** Shown on the graph? Undefined = the default: the first six lines are, the rest are not. */
  show?: boolean | undefined;
  /** The user's own text for the line (typed on the graph); undefined = the fitted text. */
  text?: string | undefined;
  /** The fitted text at the moment `text` was typed. When a re-fit prints something else the
   *  user's text is kept and the graph warns that the fitted value changed. */
  fittedText?: string | undefined;
  /** Free-drag offset (px) of this line from its place in the block. */
  offset?: { dx: number; dy: number } | undefined;
}

/** An overlaid fitted curve on a plot (from a curve-fit analysis), in data space. */
export interface PlotFit {
  /** Analysis/result generation that produced these points; absent on legacy/manual fits. */
  analysisSource?: NodeId | undefined;
  analysisResultVersion?: number | undefined;
  /** Legend label, e.g. "Dose-response (4PL)". */
  label: string;
  /** Fitted curve points in data space, as [x, y] pairs. */
  points: Array<[number, number]>;
  /** Line colour (hex); undefined = a default fit colour. */
  color?: string | undefined;
  /** 95% confidence band of the mean response: [x, yLow, yHigh] per point. */
  confidenceBand?: Array<[number, number, number]> | undefined;
  /** 95% prediction band for a new observation: [x, yLow, yHigh] per point. */
  predictionBand?: Array<[number, number, number]> | undefined;
  /** The fitted parameters, as typeset rich-text lines ("K_{M} = 29 ± 3"), drawn as a
   *  block inside the axes — the convention every journal kinetics panel follows. Built by
   *  `fitParamRows` from the analysis's tidy terms when the fit is attached — every numeric
   *  term, parameters and fit-quality rows alike; absent for a fit that reported no numeric
   *  parameters. Which lines show, their text and positions: [[Plot.fitParams]]. */
  params?: string[] | undefined;
  /** The engine's term name behind each `params` line, in the same order ("V50", "R²") — the
   *  key a line's show / text / position is stored under in `Plot.fitParams.lines`, so a
   *  re-fit that adds or drops a row keeps each choice on its own statistic. Absent on fits
   *  from older projects; their lines are keyed by position ("#0", "#1", …). */
  paramKeys?: string[] | undefined;
  /** Potency marker (dose-response fits): a crosshair at the EC50/IC50 dose on the
   *  curve — a vertical drop-line to the X-axis marks the dose (`x`), a short
   *  segment to the Y-axis marks the response (`y`), and `label` reads e.g.
   *  "EC50 = 10". Absent for fits with no potency estimate (linear, exponential…). */
  marker?: {
    x: number; y: number; label: string;
    /** Only the drop-line to the X axis (a Tm marks a temperature; the half-way signal it
     *  crosses means nothing on its own). Undefined = both lines, as a potency marker draws. */
    dropOnly?: boolean | undefined;
  } | undefined;
}

/**
 * How a plot's fitted curve(s) and their bands look (`Plot.fitStyle`). Presentation only —
 * the curve, the bands and the EC50/IC50 marker are what the analysis produced (`Plot.fit` /
 * `Plot.fits`) and are replaced wholesale on every re-fit, so the look lives outside them and
 * survives a re-run. Every field undefined = the built-in look (an untouched graph is
 * unchanged). Applies to the single `fit` and to every per-dataset `fits[i]` alike.
 *
 * The EC50/IC50 marker lines are not here: they are reference lines (id `fit-marker` in
 * `refLines.ts`) and answer to `refLine` / `refLineStyles` / `refLineHidden` like every other
 * builder-made guide line.
 */
export interface FitStyle {
  /** Draw the fitted curve. Default true. Bands and the marker stay when this is off. */
  show?: boolean | undefined;
  /** Curve colour; undefined = the fit's own colour (`PlotFit.color`), then the default. */
  color?: string | undefined;
  /** Curve thickness, px. Default 2.4. */
  width?: number | undefined;
  /** Curve dash pattern. Default solid. */
  dash?: LineDash | undefined;
  /** Curve opacity 0–1. Default 1. */
  opacity?: number | undefined;
  /** Draw the confidence band (of the mean). Default true when the fit shipped one. */
  ciShow?: boolean | undefined;
  /** Confidence-band fill colour; undefined = the curve's colour. */
  ciColor?: string | undefined;
  /** Confidence-band fill opacity 0–1. Default 0.18. */
  ciOpacity?: number | undefined;
  /** Draw the prediction band (for a new observation). Default true when the fit shipped one. */
  piShow?: boolean | undefined;
  /** Prediction-band fill colour; undefined = the curve's colour. */
  piColor?: string | undefined;
  /** Prediction-band fill opacity 0–1. Default 0.08. */
  piOpacity?: number | undefined;
  /** List every drawn fitted curve as a row of the series legend (its line as the key, the fit's
   *  label as the words). Default off. */
  inLegend?: boolean | undefined;
}

/**
 * What kind of chart a Plot renders. `xy` = the continuous-axis scatter/line
 * graph; `bar`/`box`/`violin`/`scatter` are categorical-axis charts (one mark
 * per category). Default (undefined) = `xy`, so existing plots are unchanged.
 */
export type PlotKind =
  /** A picture (micrograph, blot, schematic, diagram) as a figure panel — not a chart. Its
   *  bytes live in [[Plot.image]]; it has no data mapping, and its `source` table is unused.
   *  Exists so a multi-panel figure can hold the image panels real papers mix with graphs. */
  | "image"
  | "xy"
  | "area"
  | "bar"
  | "box"
  | "violin"
  | "scatter"
  | "raincloud"
  | "bubble"
  | "histogram"
  | "volcano"
  | "survival"
  | "roc"
  | "beforeafter"
  | "pie"
  | "heatmap"
  | "corrmatrix"
  | "alluvial"
  | "network"
  | "treemap"
  | "radar"
  | "parallel"
  | "scatter3d"
  | "ridgeline"
  | "lollipop"
  | "paireddot"
  | "floatingbar"
  | "estimation"
  | "forest"
  | "funnel"
  | "venn"
  | "upset"
  | "swimmer"
  | "ternary"
  | "rose"
  | "tracks"
  | "blandaltman"
  | "pyramid"
  | "pcascore"
  | "pcaload"
  | "pcabiplot"
  /**
   * Triplot — a constrained ordination's own graph (RDA, CCA, db-RDA). Three
   * families in one picture: the cases, the response variables as points, and the explanatory
   * variables as arrows from the origin (a factor's levels as centroids instead, because a
   * level has a place, not a direction). Its own kind and not an option on the biplot: a
   * biplot draws two families, one set of case scores and no scaling choice.
   */
  | "triplot"
  | "scree"
  | "dendrogram"
  | "qq"
  | "manhattan"
  | "sunburst"
  | "chord"
  | "oncoprint";

/** One Kaplan-Meier step curve (from a survival analysis) — time vs survival fraction. */
export interface SurvivalCurve {
  label: string;
  /** Line colour; undefined = the renderer's palette. */
  color?: string | undefined;
  /** Step times (start at 0). */
  times: number[];
  /** Survival fraction at each time (start at 1, in [0,1]). */
  surv: number[];
  /** Greenwood 95% CI lower/upper bounds, aligned with `times`/`surv` (optional). */
  lower?: number[] | undefined;
  upper?: number[] | undefined;
  /** Censoring times (draw a small tick on the step line at each). */
  censor?: number[] | undefined;
}

/** Number-at-risk table (from a survival analysis) — the risk-set size per group at a
 *  set of time points, drawn under the Kaplan-Meier graph aligned to the X axis. */
export interface SurvivalAtRisk {
  /** The time points (X values) the risk sets are reported at. */
  times: number[];
  /** One row per curve: its label + the number still at risk at each `times` point. */
  rows: { label: string; atRisk: number[] }[];
}

/** One ROC curve (from a `roc` analysis) — sensitivity (TPR) vs 1−specificity (FPR). */
export interface RocCurve {
  label: string;
  /** Line colour; undefined = the renderer's palette. */
  color?: string | undefined;
  /** Curve points, ascending by fpr; each = (1−specificity, sensitivity), both in [0,1]. */
  points: { fpr: number; tpr: number }[];
  /** Area under the curve (for the on-graph label). */
  auc: number;
  /** AUC confidence-interval bounds (Hanley-McNeil), for the legend — e.g. "AUC 0.86
   *  (95% CI 0.79–0.93)". Both must be present to be shown; absent = show the AUC alone. */
  aucLow?: number | undefined;
  aucHigh?: number | undefined;
  /** Confidence level of aucLow/aucHigh (0–1); drives the "95% CI" label. Default 0.95. */
  aucConf?: number | undefined;
}

/** PCA graph data (from a PCA analysis' `extra.pca`) — drives the score / loadings /
 *  biplot / scree graph kinds. All numeric arrays are component-indexed the same way
 *  (`pcLabels[k]` ↔ column k of `loadings`/`scores`, `eigenvalues[k]`, `explained[k]`). */
export interface PcaGraphData {
  /** Variable names (rows of `loadings`). */
  varLabels: string[];
  /** Component names, e.g. ["PC1","PC2",…]. */
  pcLabels: string[];
  /** Loadings (eigenvectors): `loadings[variable][component]`. */
  loadings: number[][];
  /** Case scores: `scores[case][component]`. */
  scores: number[][];
  /** Eigenvalue per component. */
  eigenvalues: number[];
  /** Fraction (0–1) of total variance explained per component. */
  explained: number[];
  /** Optional per-case group label (colours the score/biplot points). */
  groups?: string[] | undefined;
  /**
   * Species (variable) points drawn in the same space as the cases — `speciesScores[j][axis]`.
   *
   * Not loadings. A loading is a direction (an arrow from the origin); these are positions.
   * In a correspondence analysis both families come out of the same decomposition and a site
   * sits near the species it is rich in — that joint plot is the point of the method. On a
   * PCoA / NMDS map they are weighted averages of the sites each species occurs in. Absent on
   * a PCA, which has loadings instead.
   */
  speciesScores?: number[][] | undefined;
  /** Names for those points; falls back to `varLabels`. */
  speciesLabels?: string[] | undefined;
  /**
   * Constrained ordination (the triplot) — the explanatory variables' directions, one row per
   * explanatory column: `envScores[j][axis]`, their correlations with the axes.
   *
   * `envIsFactor[j]` marks a column that came from expanding a categorical variable. Those
   * are drawn as centroids, not arrows: "Habitat: dry" names a place in the ordination, and an
   * arrow would claim a direction of increase that a category does not have.
   */
  envScores?: number[][] | undefined;
  envLabels?: string[] | undefined;
  envIsFactor?: boolean[] | undefined;
  /** The two ways a constrained ordination places the cases — LC from the explanatory
   *  variables, WA from what was observed. `PcaStyle.siteScores` chooses which is drawn. */
  lcScores?: number[][] | undefined;
  waScores?: number[][] | undefined;
}

/**
 * Ordination result payload (`AnalysisResult.extra.ordination`) — PCoA and NMDS.
 *
 * Deliberately not `extra.pca`: an ordination has **no loadings**. PCA's arrows are the
 * variables' directions in the same space as the cases; a PCoA maps a distance matrix and an
 * NMDS fits ranks, so neither has a direction to draw. Species can still be placed by weighted
 * averaging (`speciesScores`), which is a different claim and drawn differently.
 */
/**
 * Variance partitioning's result — the fractions, and what each block explains on its own.
 *
 * Not an `OrdinationData`: there are no scores, no axes and no map. A partition is a set of
 * shares of the total variation, which is why it earns a bar chart rather than the ordination
 * graph suite.
 */
export interface VarpartData {
  /** What each block is called in the readout, in the order they were given. */
  blockLabels: string[];
  /** Each block's own total (its unique share plus everything it shares) — what a
   *  single-block model would have reported. */
  blocks: { label: string; adjR2: number; columns: number }[];
  /** The fractions themselves. `testable` is false for a shared fraction, which has no model
   *  to permute and therefore no `p` — the absence is the correct answer, not a gap.
   *  `adjR2` may be negative. That is a real result (the blocks together explaining less than
   *  the sum of their separate explanations) and must never be clamped: the fractions and the
   *  residual sum to exactly 1, and clamping breaks that. */
  fractions: { label: string; adjR2: number; testable: boolean; p?: number }[];
  /** All blocks together (adjusted R²), and what nothing explains. They sum to 1 with the
   *  fractions. */
  explained: number;
  residual: number;
  transform?: string;
  permutations?: number;
  varLabels?: string[];
  caseLabels?: (string | null)[];
  groups?: (string | null)[];
}

export interface OrdinationData {
  /** Variable (species) names — the columns that went in. */
  varLabels: string[];
  /** Axis names, e.g. ["PCoA1","PCoA2",…] / ["NMDS1","NMDS2"]. */
  pcLabels: string[];
  /** Case coordinates: `scores[case][axis]`. */
  scores: number[][];
  /** Case (site) names from the sheet's lead column, when it has one. */
  caseLabels?: string[] | undefined;
  /** PCoA only — eigenvalue per axis, and the fraction of the total each carries.
   *  NMDS has neither: it fits rank order, not variance. */
  eigenvalues?: number[] | undefined;
  explained?: number[] | undefined;
  /** PCoA: how many eigenvalues came out negative (the dissimilarity is not Euclidean),
   *  and which correction was applied ("none" | "lingoes" | "cailliez"). */
  negativeEigenvalues?: number | undefined;
  correction?: string | undefined;
  /** NMDS: Kruskal's stress-1 and the Shepard diagram behind it — observed dissimilarity,
   *  the distance on the map, and the fitted monotone step, one entry per pair of cases. */
  stress?: number | undefined;
  shepard?: { dissimilarity: number[]; distance: number[]; fitted: number[] } | undefined;
  /** Species placed by weighted averaging (`speciesScores[variable][axis]`), when the data
   *  are non-negative. Not loadings — a weighted average of the sites a species occurs in. */
  speciesScores?: number[][] | undefined;
  /** Optional per-case group label (colours the map). */
  groups?: string[] | undefined;
  /** The distance and the transformation the map was built from — the two choices that
   *  decide what it means, carried so a figure can state them. */
  metric?: string | undefined;
  transform?: string | undefined;
  /**
   * Constrained ordination (RDA, CCA, db-RDA) only — the parts an unconstrained one has no equivalent of.
   *
   * `lcScores` place the cases from the explanatory variables (the fitted values); `waScores`
   * place the same cases from what was actually observed. Which to draw is a live argument in
   * the literature, so both are carried and the graph chooses; `siteScores` says which one
   * `scores` currently holds. `envScores` are the explanatory variables' correlations with the
   * axes — the arrow directions of a triplot.
   */
  lcScores?: number[][] | undefined;
  waScores?: number[][] | undefined;
  siteScores?: string | undefined;
  envScores?: number[][] | undefined;
  envLabels?: string[] | undefined;
  /** The share of the response variance the constraints explain, raw and Ezekiel-adjusted —
   *  quote the adjusted one: R² rises with every variable added, adjusted R² does not. */
  r2?: number | undefined;
  adjR2?: number | undefined;
  /** The permutation test of the whole model: its statistic, its p, and how many
   *  rearrangements it was drawn from (the smallest reachable p is 1/(permutations + 1)). */
  pseudoF?: number | undefined;
  p?: number | undefined;
  permutations?: number | undefined;
  /** What the constraints could not explain, as an eigenvalue spectrum. */
  unconstrainedEigenvalues?: number[] | undefined;
  /** CA / RDA: whose distances the coordinates preserve. */
  scaling?: string | undefined;
}

/** Dendrogram appearance (Plot.dendrogram when kind = "dendrogram"). A hierarchical-
 *  clustering tree of the table's rows (or columns). Clusters the value columns per row
 *  (or each column across rows), then draws the merge tree with leaf labels. */
export interface DendrogramStyle {
  /** Cluster the rows (each row a profile across the value columns) or the columns
   *  (each column a profile across the rows). Default "rows". */
  target?: "rows" | "columns" | undefined;
  /** Distance metric. Default "euclidean". */
  metric?: ClusterMetric | undefined;
  /** Linkage. Default "average". */
  linkage?: ClusterLinkage | undefined;
  /** Tree growth direction: "vertical" = leaves along the bottom, tree grows up;
   *  "horizontal" = leaves down the left, tree grows right. Default "vertical". */
  orientation?: "vertical" | "horizontal" | undefined;
  /** Colour this many top-level clusters distinctly (branches below the cut). 0/1 =
   *  a single colour. Default 0. */
  colorClusters?: number | undefined;
}

/** Display config for the PCA graph kinds (`pcascore`/`pcaload`/`pcabiplot`/`scree`). */
export interface PcaStyle {
  /** 0-based component index on the X axis (score/loadings/biplot). Default 0 (PC1). */
  xComponent?: number | undefined;
  /** 0-based component index on the Y axis. Default 1 (PC2). */
  yComponent?: number | undefined;
  /**
   * A third component shown as each score dot's size — depth: the most negative score is
   * the smallest dot (far), the most positive the largest (near), so size reads as depth,
   * as in a 3-D view.
   *
   * `-1` = off (every dot the same size). Undefined = auto: both the score plot and the
   * biplot size by the first component that is on neither axis (usually PC3) when the
   * analysis produced one.
   *
   * On a biplot the arrows are projected onto the two plotted axes only, so a large dot has
   * no vector to explain it; sizing is still on by default there, and `-1` turns the third
   * dimension off.
   *
   * Note: the signed score, never |score| — in a 3-D view the two ends of the depth axis are
   * the nearest and the furthest thing, so they must not draw the same size.
   * Radii come from `Plot.bubble.minRadius`/`maxRadius` (defaults 2 / 9 px here), and the
   * size legend from the rest of `Plot.bubble` — the same panel as the bubble chart's.
   */
  sizeComponent?: number | undefined;
  /**
   * Triplot: which set of case scores to draw — "lc" (linear-combination: the cases placed
   * from the explanatory variables, the fitted values) or "wa" (weighted average: placed from
   * what was actually observed). Default "wa", matching the usual plotting convention.
   *
   * This is a real argument in the literature, not a cosmetic choice: LC shows what the model
   * says, WA shows what the data did, and they disagree exactly where the model fits badly.
   */
  siteScores?: "lc" | "wa" | undefined;
  /** Triplot: draw the explanatory variables (arrows, and centroids for a factor's levels). */
  showEnv?: boolean | undefined;
  /** Triplot: draw the cases. Off leaves the variables' picture alone. */
  showSites?: boolean | undefined;
  /** Triplot: how the response variables are drawn — "points" (default) or "arrows". */
  speciesAs?: "points" | "arrows" | undefined;
  /** Triplot: multiplier on the explanatory arrows' length. They are correlations, so their
   *  natural length is ≤ 1 and has to be stretched to the cloud; 0.8 of the cloud's reach is
   *  the convention, and it is the one number every ordination figure gets argued over. */
  arrowScale?: number | undefined;
  /** Draw the species (variable) points when the analysis carries them — a correspondence
   *  analysis puts sites and species in one picture, and a PCoA / NMDS can place species by
   *  weighted averaging. Default true when the data has them; no effect on a PCA, which has
   *  loadings (arrows) instead. */
  showSpecies?: boolean | undefined;
  /** Scree Y metric: "percent" of variance (default) or the raw "eigenvalue". */
  screeMetric?: "percent" | "eigenvalue" | undefined;
  /** Overlay the cumulative-variance curve on the scree plot. Default false. */
  screeCumulative?: boolean | undefined;
  /** Per-loading-label position override (fractional plot-rect coords, keyed by the
   *  0-based variable index as a string) — set by dragging a loading (variable) label
   *  on a loadings/biplot plot. A missing entry keeps the label next to its arrow tip. */
  labelPos?: Record<string, { x: number; y: number }> | undefined;
  /** Per-loading-label text override (keyed the same way) — set by double-click-renaming a
   *  loading label. Presentation only: the analysis' `varLabels` are untouched, so a re-run
   *  keeps the rename. A missing/blank entry falls back to the analysis variable name. */
  varLabelText?: Record<string, string> | undefined;
  /** Per-loading-vector colour override (keyed the same way) — set by clicking one loading
   *  arrow and picking a colour (e.g. to highlight a single variable's vector). A missing entry
   *  falls back to the shared `seriesStyles["pca-loadings"].color` / the kind default.
   *
   *  Note: this is the arrow's colour. The label falls back to it (so an untouched chart
   *  reads the pair as one unit by default) and `varLabelColors` overrides it, so the arrow
   *  and its name can have different colours. */
  arrowColors?: Record<string, string> | undefined;
  /** Per-variable-label colour, keyed the same way. Undefined = follow this vector's arrow
   *  colour (the default). */
  varLabelColors?: Record<string, string> | undefined;
  /**
   * The loading vectors' line styling — the vectors take edits like an axis's.
   *
   * Shared across all vectors (they are one family, like a chart's gridlines); the per-vector
   * `arrowColors` above is the only thing that varies by variable. Length and direction are
   * not here: an arrow's geometry is the loading, so it is data, not style.
   */
  /** Loading-arrow thickness, px. Default 1.4. */
  arrowWidth?: number | undefined;
  /** Loading-arrow dash pattern. Default "solid". */
  arrowDash?: LineDash | undefined;
  /** Draw the arrowhead. Default true — a headless vector reads as a line, not a direction.
   *  Note: no separate head size: the renderer already derives it from the line width
   *  (`max(7, width*3+4)`), so a second knob would fight the first. */
  arrowHead?: boolean | undefined;
}

/** Arrangement of a multi-dataset bar chart. "grouped" = interleaved sub-bars;
 *  "stacked" = summed on a running total; "overlay" = every series shares the same
 *  centred full-width slot (drawn baseline-anchored, back-to-front) — with
 *  opposite-sign series this gives diverging up/down bars (e.g. purchases up,
 *  sales down); "percent" = stacked then normalised so every category's positive
 *  values sum to 100% (the relative-abundance / 100%-stacked bar; a negative value
 *  cannot claim a share of a whole, so it draws as 0 with a warning). */
export type BarLayout = "grouped" | "stacked" | "overlay" | "percent";

/** Stacking mode for a multi-series area chart (overlay · stacked · 100% · stream).
 *  "none" = areas overlap; "stacked" = each series sits on the cumulative
 *  total below it; "percent" = stacked then normalised so every X column sums to 100%;
 *  "stream" = stacked then centred on the x axis (each column shifted down by half its
 *  total) — the streamgraph / ThemeRiver look, where band thickness carries the value
 *  and the y position is only an offset. Values are unchanged, only the baseline moves. */
export type AreaStack = "none" | "stacked" | "percent" | "stream";

/** How a spread band's extent is computed across the series at each X.
 *  range = min→max · sd = mean±k·SD · sem = mean±k·SEM · iqr = Q1→Q3 (25–75%). */
export type SpreadMode = "none" | "range" | "sd" | "sem" | "iqr";

/** A data-driven spread ribbon for line/area charts (the full range of every series
 *  as a band): shade the cross-series spread at each X behind the plot, with an
 *  optional dotted mean-across-series line. Computed from all series (including
 *  hidden ones), so a few selected curves can sit inside the population band. */
export interface SpreadBand {
  /** Spread statistic; "none" (or undefined `spread`) = no band. */
  mode: SpreadMode;
  /** Multiplier on SD/SEM (mode "sd"/"sem"). Default 1. */
  k?: number | undefined;
  /** Band fill colour; undefined = a neutral grey. */
  color?: string | undefined;
  /** Band fill opacity (0–1). Default 0.15. */
  opacity?: number | undefined;
  /** Draw the dotted centre line across series. Default false. */
  showMean?: boolean | undefined;
  /** What the centre line traces: the mean or the median across series. Default "mean".
   *  Named `center` because with "median" the mean* fields keep their (stable) names but
   *  describe the centre line, whichever statistic it shows. */
  center?: "mean" | "median" | undefined;
  /** Centre-line colour; undefined = a mid grey / the band colour. */
  meanColor?: string | undefined;
  /** Mean-line label (direct end label, e.g. "League avg"); undefined = none. */
  meanLabel?: string | undefined;
}

/** Bar corner shape: square · rounded (all corners) · round top (only the value end). */
export type BarShape = "square" | "rounded" | "roundtop";

/** Whisker definition for a box-and-whisker plot. The `sd`/`sem`/`ci95` variants are
 *  mean-centered: the box collapses to the mean and the whiskers reach mean ± that error,
 *  so box/violin/raincloud can show SD/SEM/CI, like bars/scatter. */
export type BoxWhisker = "tukey" | "minmax" | "p10_90" | "p5_95" | "p2_5_97_5" | "p1_99" | "sd" | "sem" | "ci95";

/** One series borrowed from another datasheet (`Plot.overlays`): a reference, not a copy. */
export interface PlotOverlay {
  /** Stable identity of the overlay entry (remove / reorder key). */
  id: NodeId;
  /** The other datasheet. */
  table: NodeId;
  /** The lead `y` column of the dataset to draw (its replicate/summary columns come along). */
  column: NodeId;
}

export interface Plot {
  id: NodeId;
  name: string;
  /** Chart type; undefined = "xy". */
  kind?: PlotKind | undefined;
  /** Small graph made by Graph ▸ Split into small graphs: this graph is a copy of `plot` that
   *  shows only the series `series`. After every change (and every undo) it is re-copied from
   *  `plot` (`splitCopies.ts`), so colours, axes, fonts and data follow the original. What it
   *  keeps as its own is every position and size: dragged labels, legend, title, figure size.
   *  Any other edit made on the copy is refused with a message. Detach removes this link and
   *  the graph becomes an ordinary one. */
  splitFrom?: { plot: NodeId; series: NodeId } | undefined;
  /** The picture drawn by an [[PlotKind]] `"image"` panel.
   *
   *  `src` is a self-contained data URI, so the image travels inside the `.mady` file
   *  exactly like an image annotation does — a project is never left pointing at a file
   *  that has moved. `alt` is the accessibility description, and is what the figure-caption
   *  drafter uses to describe this panel (it cannot read the picture). `fit` decides how the
   *  picture fills a panel of a different aspect ratio: "contain" (default, letterboxed —
   *  never distorts or crops), "cover" (fills, cropping the overflow) or "fill" (stretches).
   *
   *  Note: "contain" is the default because silently cropping or stretching a micrograph
   *  would misrepresent the data in it.
   *
   *  `crop` shows only a window of the source — fractions of the source image, applied in the
   *  picture's displayed orientation (after `rotate`) — and `rotate` turns it in quarter
   *  turns (a scan that arrived sideways). Both are explicit user edits, so the "never
   *  silently crop" rule holds: the crop is the user's own framing, shown in the Inspector.
   *  `naturalWidth`/`naturalHeight` are the source's pixel size, captured when the picture is
   *  added — crop/rotate need the true aspect to draw correctly; panels saved before these
   *  fields exist fall back to a runtime measure. */
  image?: {
    src: string;
    alt?: string | undefined;
    fit?: "contain" | "cover" | "fill" | undefined;
    rotate?: 0 | 90 | 180 | 270 | undefined;
    crop?: { x: number; y: number; w: number; h: number } | undefined;
    naturalWidth?: number | undefined;
    naturalHeight?: number | undefined;
  } | undefined;
  /** Bar arrangement (bar charts); undefined = "grouped". */
  barLayout?: BarLayout | undefined;
  /** Sort the bar chart's categories by value ("asc"/"desc"); undefined/"none" keeps table
   *  order. Single series sorts by its own value; grouped/stacked sort by the category
   *  total. The waterfall (tumor-response) look = "desc" + threshold zone bands. Refused
   *  with a warning when three-way `barSeriesGroups` are set (sorting would tear the
   *  clusters apart). Also sorts the groups of a box / violin (by median) and a column scatter (by its drawn
   *  centre, mean or median); their colours and brackets follow their groups. */
  barSort?: "none" | "asc" | "desc" | undefined;
  /** Area stacking mode (area charts); undefined = "none" (overlaid areas). */
  areaStack?: AreaStack | undefined;
  /** Baseline value the area fill drops to (overlaid areas only; stacked areas use the
   *  cumulative base). Undefined = 0. e.g. set the axis minimum to fill the whole band. */
  areaBaseline?: number | undefined;
  /** Survival (Kaplan-Meier) chart: show the 95% confidence band. Default true. */
  survivalShowCI?: boolean | undefined;
  /** Survival chart: fill opacity of the confidence band (0..1). Default 0.15. */
  survivalCiOpacity?: number | undefined;
  /** Survival chart: show the censoring ticks on the step lines. Default true. */
  survivalShowCensor?: boolean | undefined;
  /** Survival chart: the number-at-risk table (from the analysis' `extra.atrisk`). */
  survivalAtRisk?: SurvivalAtRisk | undefined;
  /** Survival chart: draw the number-at-risk table under the graph. Default true when data present. */
  survivalShowAtRisk?: boolean | undefined;
  /** Survival chart: the number-at-risk table's own font (heading, row names, counts); undefined = the
   *  chart's tick font. */
  survivalAtRiskFont?: FontSpec | undefined;
  /** Survival chart: plot the ascending cumulative-incidence curve (1 − S, the event
   *  rate) instead of the descending survival fraction. Both lie in [0,1], so only the
   *  plotted value and the Y-axis title change. Default false = descending survival. */
  survivalCumulativeIncidence?: boolean | undefined;
  /** Style override for a chart's synthetic reference/threshold lines (volcano thresholds,
   *  ROC chance diagonal, forest no-effect line, Bland-Altman bias/limits, PCA origin cross).
   *  Every field unset = the built-in defaults (no change); `show:false` hides the lines.
   *  This is the all-lines setting; `refLineStyles` overrides one line at a time. */
  refLine?: { color?: string | undefined; width?: number | undefined; dash?: LineDash | undefined; show?: boolean | undefined } | undefined;
  /** Per-line style for those same reference lines (line id → its own colour / thickness /
   *  dash), keyed exactly like `refLineHidden`. The ids are the registry in `refLines.ts`.
   *
   *  Resolution order, narrowest first: `refLineStyles[id]` → `refLine` (all lines) → the
   *  built-in look. So a chart where nothing is set renders byte-identically, setting the
   *  all-lines colour still moves every line, and one line can then diverge.
   *
   *  Style and hide only — never position. These lines sit at computed statistics (a bias,
   *  a null value, an origin), so moving or deleting one would assert something the data does
   *  not say; the builder puts it back on the next rebuild regardless. */
  refLineStyles?: Record<string, RefLineStyle> | undefined;
  /** Per-line label overrides for those same synthetic reference lines (annotation id →
   *  text) — set by double-click-renaming one on the canvas (e.g. Bland-Altman's
   *  "Bias 0.42" → "Mean difference"). Presentation only: the line still sits at its
   *  computed value, and blank restores the generated readout. */
  refLineLabels?: Record<string, string> | undefined;
  /** A reference line's caption font, keyed exactly like `refLineStyles`. Only the EC50 / IC50
   *  label (`fit-marker`) reads it, in place of the tick font. */
  refLineLabelFonts?: Record<string, FontSpec> | undefined;
  /** Per-line label nudge for those same lines (annotation id → px offset from the
   *  anchor the builder picked). The line stays fixed at its computed value — dragging
   *  it would assert a bias the data does not have — but the caption is presentation, so
   *  it moves freely off the data it lands on (e.g. a Bland-Altman bias caption). */
  refLineLabelOffsets?: Record<string, { dx: number; dy: number }> | undefined;
  /** Per-line hide for those same lines (annotation id → true). `refLine.show:false`
   *  hides every one of them at once; this hides one without the others.
   *  Hiding, not deleting, is the correct operation here: the line has no entry in
   *  `plot.annotations` — the builder recomputes it from the data on every rebuild — so a
   *  delete could not stick and `removeAnnotation` refuses it. */
  refLineHidden?: Record<string, boolean> | undefined;
  /** XY graphs: draw the line of identity (y = x) — the diagonal a perfect agreement would
   *  follow, for method-comparison scatter. Opt-in (default false, so existing graphs are
   *  unchanged); it is a reference line (registry id `identity`), so its colour / thickness /
   *  dashes / hide come from `refLine` / `refLineStyles` like every other. Drawn only where
   *  the X and Y data ranges overlap (a y = x line is meaningful when the axes share units). */
  showIdentity?: boolean | undefined;
  /** Bump chart (line/xy only): plot each series' rank among the series at every X, not its
   *  raw Y. The largest value at each X is rank 1; the Y axis becomes a reversed integer "Rank"
   *  axis (1 at the top). A one-click rankings-over-stages chart on the ordinary line renderer —
   *  no new kind. `rankValues` (core) does the per-X ranking. */
  plotRanks?: boolean | undefined;
  /** Equal aspect: make one data unit the same number of pixels on X as on Y (a 1:1 scale).
   *  On a map-like scatter — an ordination above all — the distance between two points is the
   *  reading, and a stretched figure misrepresents it. Off by default, because on an ordinary XY
   *  graph the two axes carry different quantities (dose vs response) and a shared pixel scale
   *  would mean nothing.
   *
   *  It re-ranges a domain, never the plot box: one axis is grown or narrowed about its own
   *  centre until the two scales match. At rest neither axis is pinned and only growing is
   *  allowed, so the view gains empty plane and no point is ever cropped. When the user has
   *  pinned an axis — a hand-typed min/max, or the pan/zoom window they are looking through —
   *  that axis is left exactly as they set it and the other one follows, narrowing if that is
   *  what 1:1 needs: a map that stopped being 1:1 the moment you zoomed into it would be the
   *  distortion this option exists to remove. With both axes pinned there is nothing left to
   *  move and the builder refuses with a `warnings` entry.
   *
   *  Offered only where both axes are continuous value axes; a log / probit axis, or one with
   *  breaks, has no constant units-per-pixel to equalise and is refused the same way. */
  equalAspect?: boolean | undefined;
  /** Cross-series spread band (line/area charts); undefined = none. */
  spread?: SpreadBand | undefined;
  /** Bar corner shape (bar charts); undefined = "square". */
  barShape?: BarShape | undefined;
  /** Fraction of each category band the bars fill (0.1–1.0). Default 0.82. */
  barWidth?: number | undefined;
  /** Stacked / 100%-stacked bars: connect each series' segment to the same series' segment
   *  in the next category with a translucent ribbon (the alluvial-linked relative-abundance
   *  look). The ribbon spans the gutter between adjacent bars, joining the two segments'
   *  edges exactly — it adds no numbers, only traces how a stratum's share moves. Refused
   *  with a warning on grouped/overlay layouts (side-by-side bars have no stratum edges to
   *  join). Default false. */
  barRibbons?: boolean | undefined;
  /** Ribbon fill opacity (0–1) for `barRibbons`. Default 0.45 — light enough that the bars
   *  stay the primary ink, dark enough to trace a stratum across the figure. */
  barRibbonOpacity?: number | undefined;
  /** Pareto: draw a derived cumulative-percent line over the bars on a right-hand 0–100 % axis,
   *  following the drawn category order (with `barSort:"desc"` = the classic Pareto chart: the
   *  vital few on the left, the line showing how much of the total they cover). A readout of the
   *  bars, not a series — no statistics, no datasheet column. Vertical bars only (a horizontal
   *  bar draws no second value axis; refused with a warning). Default false. */
  paretoLine?: boolean | undefined;
  /** Colour of the Pareto line. Default a dark accent. */
  paretoLineColor?: string | undefined;
  /** Series drawn from other datasheets (composite graphs): each is a reference to a column of
   *  another table, joined into this plot's table at build time (`resolveOverlays`) — by numeric X
   *  on xy/area, by category label on bars; unmatched categories are skipped with a warning. The
   *  foreign series then behaves as a local one: its look and render mode live in
   *  `seriesStyles[column]` (colour, `plotAs`, `axis:"y2"`…). Nothing is copied; the other sheet
   *  keeps its format and statistics. A dangling reference warns and is skipped, never thrown. */
  overlays?: PlotOverlay[] | undefined;
  /** Orientation for bar and distribution charts (box/violin/column-scatter).
   *  Default "vertical" (value on Y); "horizontal" = value on X, categories on Y. */
  barOrientation?: "vertical" | "horizontal" | undefined;
  /** Three-way grouped bar: an outer grouping of the datasets (the third factor). Maps each
   *  dataset (series) id to an outer-group name; within every category band the bars are then
   *  clustered by group, with a gap between clusters and the group name labelled under each
   *  cluster. Absent, fewer than 2 distinct groups, or any dataset unassigned ⇒ the ordinary
   *  even side-by-side layout (existing bars unchanged). Grouped layout only (not stacked /
   *  overlay / one-per-column). */
  barSeriesGroups?: Record<NodeId, string> | undefined;
  /** Figure width in px (the whole graph). Undefined = renderer default (580). */
  figureWidth?: number | undefined;
  /** Figure height in px (the whole graph). Undefined = renderer default (380). */
  figureHeight?: number | undefined;
  /**
   * How big the graph is shown: the whole drawing scaled uniformly - text, marks, legend and all - never re-laid-out
   * (resizing keeps proportions; a smaller graph is a uniform scale of the same drawing).
   * Dragging the graph's corner or typing its size sets this; `figureWidth` / `figureHeight` stay the size it is laid
   * out at. Undefined = 1, or the window-fit scale for a graph that has no size of its own.
   */
  displayScale?: number | undefined;
  /** Explicit X-axis length = plot-area width in px (the axis length). When
   *  set it overrides the figure-derived plot width; the figure grows to fit
   *  (length + margins). Undefined = derive from figureWidth − margins. */
  xAxisLength?: number | undefined;
  /** Explicit Y-axis length = plot-area height in px. Overrides figure-derived
   *  height; undefined = derive from figureHeight − margins. */
  yAxisLength?: number | undefined;
  /** Extra plot-area margin padding (px) added to the auto-derived margins on
   *  each side — the whitespace ring between the plotting area and the figure
   *  edge (Frame → Plot margins). Each side undefined/0 = auto only.
   *  Applies to axis-bearing charts; ignored by radial kinds (pie/radar/3D). */
  plotPad?: { top?: number; right?: number; bottom?: number; left?: number } | undefined;
  /** Whisker definition (box plots); undefined = "tukey". */
  boxWhisker?: BoxWhisker | undefined;
  /** Overlay every observation as a swarm of points on box / violin plots. Default false. */
  showBoxPoints?: boolean | undefined;
  /** Overlay the group mean as a "+" on box / violin plots. Default false. */
  showBoxMean?: boolean | undefined;
  /** Overlay every replicate as a dot over its own bar, alongside (not instead of) the error
   *  bars — the "bar + individual data points" figure journals ask for at small n. Undefined =
   *  on: a bar alone hides the distribution, so showing the points is the default and hiding
   *  them is a deliberate choice. Not drawn on stacked bars (a segment's points would sit at
   *  the wrong height) or on summary-entered (mean/SD) data, which has no individual values;
   *  when the option was switched on explicitly, the builder says why in a warning. */
  showBarPoints?: boolean | undefined;
  /** How far apart a group's data points sit sideways (bar points, box / violin points, estimation
   *  swarm): a multiple of the dot-to-dot gap, 0.25–3. Undefined = 1, the standard look. The dots
   *  never leave their group — each chart keeps its own sideways limit (the bar's width, the box's width).
   *  Also applies to the column scatter. A series' own `SeriesStyle.pointSpread` overrides it. The raincloud
   *  widens its rain with its Width slider, which scales the whole raincloud. */
  pointSpread?: number | undefined;
  /** Show each bar's value as a data label (bar charts). Default false. */
  showValues?: boolean | undefined;
  /** Decimal places for bar value labels; undefined = trim trailing zeros. */
  valueDecimals?: number | undefined;
  /** Vertical nudge (px) applied to every bar value label — the "drag the labels" offset. Default 0. */
  valueLabelDy?: number | undefined;
  /** Where each bar's value label sits: above the bar's end (default), inside the bar at its
   *  end, or inside at its foot (just off the axis). A bar too short to hold the text falls
   *  back to "above" so the number is never hidden. */
  valuePlacement?: "above" | "insideEnd" | "insideBase" | undefined;
  // --- pie chart (kind = "pie") ---
  /** Rotation of the first slice, degrees clockwise from 12 o'clock. Default 0. */
  pieStartAngle?: number | undefined;
  /** Sweep direction. Default "cw" (clockwise). */
  pieDirection?: "cw" | "ccw" | undefined;
  /** Donut hole radius as a fraction of the pie radius (0–0.9). Default 0 (solid). */
  pieDonut?: number | undefined;
  /** What each slice's label shows. Default "percent". */
  pieLabels?: PieLabelMode | undefined;
  /** Slice labels inside the slice or outside the rim. Default "inside". */
  pieLabelPosition?: "inside" | "outside" | undefined;
  /** Parts-of-whole display: a normal "pie" (arc wedges, the default) or a "waffle" — a
   *  10×10 grid of unit cells coloured by category, each cell ≈ 1% of the whole. Same data,
   *  legend and per-category selection; only the mark differs. Default "pie". */
  pieDisplay?: "pie" | "waffle" | undefined;
  /** Waffle display only: draw each cell as its category's marker shape (an icon array) instead
   *  of a plain square, so groups are told apart by shape as well as colour. The shape is the
   *  category's own `seriesStyles[rowId].symbol`, else the icon cycle. Default false. */
  waffleIcons?: boolean | undefined;
  /** Waffle display only: what one cell stands for. "percent" (default) = 1 % of the whole, a
   *  10 × 10 grid. "count" = one observation per cell (the values are counts); above 100 in
   *  total, one cell stands for several, and a caption under the grid says how many. */
  waffleUnit?: "percent" | "count" | undefined;
  /** Count waffle: the word for one observation in the caption ("patient"). Default "observation". */
  waffleUnitName?: string | undefined;
  /** Count waffle: the caption's text, typed over the automatic "1 icon = 1 patient". Blank = automatic. */
  waffleCaption?: string | undefined;
  /** Count waffle: the caption's drag offset from its place under the grid (px). */
  waffleCaptionOffset?: { dx: number; dy: number } | undefined;
  /** Waffle display only: show at most this many groups (the largest, in table order) and combine
   *  the rest into one "Other" group, drawn last. Undefined = show every group. */
  waffleMaxGroups?: number | undefined;
  /** Waffle display only: the combined group's name. Blank = "Other". */
  waffleOtherName?: string | undefined;
  /** How wide this graph prints (mm) — the whole drawing scaled uniformly, never re-laid-out. The
   *  Graph size section's Print size buttons set it; the Export dialog starts its print width from it.
   *  Undefined = no print size chosen. */
  printWidthMm?: number | undefined;
  /** Heatmap appearance (kind = "heatmap"); undefined = defaults. */
  heatmap?: HeatmapStyle | undefined;
  /** Correlation-matrix appearance (kind = "corrmatrix"); undefined = defaults. */
  corrmatrix?: CorrMatrixStyle | undefined;
  /** Alluvial / parallel-sets appearance (kind = "alluvial"); undefined = defaults. */
  alluvial?: AlluvialStyle | undefined;
  /** Node-link network graph appearance (kind = "network"); undefined = defaults. */
  network?: NetworkStyle | undefined;
  /** Ridgeline / joyplot appearance (kind = "ridgeline"); undefined = defaults. */
  ridgeline?: RidgelineStyle | undefined;
  /** Histogram appearance (kind = "histogram"); undefined = auto bins. */
  histogram?: HistogramStyle | undefined;
  /** 3-D scatter camera (kind = "scatter3d"): orbit angles + zoom. Undefined = default view. */
  scatter3d?: Scatter3DStyle | undefined;
  /** Radar chart (kind = "radar") frame: grid/spokes/scale/vertex markers. Undefined = defaults. */
  radar?: RadarStyle | undefined;
  /** Voronoi treemap (kind = "treemap") frame: boundary shape, labels, cell borders. Undefined = defaults. */
  treemap?: TreemapStyle | undefined;
  /** Parallel-coordinates (kind = "parallel") frame: colour column, line width/opacity, curve. Undefined = defaults. */
  parallel?: ParallelStyle | undefined;
  /** Bubble chart (kind = "bubble") parameters: size legend + radius range.
   *  The size legend's drag offset reuses `colorbarOffset` (a plot is one kind, so
   *  the heatmap colour-bar and bubble legend never coexist). */
  bubble?: BubbleStyle | undefined;
  /** Volcano thresholds (kind = "volcano"); undefined = defaults (fc 1, p<0.05). */
  volcano?: VolcanoStyle | undefined;
  /** Lollipop / dumbbell appearance (kind = "lollipop"); undefined = defaults. */
  lollipop?: LollipopStyle | undefined;
  /** Paired / grouped Cleveland dot-plot appearance (kind = "paireddot"); undefined = defaults. */
  paireddot?: PairedDotStyle | undefined;
  /** Floating-bar appearance (kind = "floatingbar"); undefined = defaults (line at mean). */
  floatingBar?: FloatingBarStyle | undefined;
  /** Column-scatter centre + error overlay (kind = "scatter"); undefined = mean ± SD. */
  columnScatter?: ColumnScatterStyle | undefined;
  /** Gardner-Altman estimation-plot config (kind = "estimation"); undefined = defaults. */
  estimation?: EstimationStyle | undefined;
  /** Forest-plot config (kind = "forest"); undefined = defaults (reference line at 1). */
  forest?: ForestStyle | undefined;
  /** Funnel-plot appearance (kind "funnel") — see [[FunnelStyle]]. */
  funnel?: FunnelStyle | undefined;
  /** Venn / Euler appearance (kind "venn") — see [[VennStyle]]. */
  venn?: VennStyle | undefined;
  /** UpSet plot appearance (kind "upset") — see [[UpsetStyle]]. */
  upset?: UpsetStyle | undefined;
  /** Swimmer plot appearance (kind "swimmer") — see [[SwimmerStyle]]. */
  swimmer?: SwimmerStyle | undefined;
  /** Ternary plot appearance (kind "ternary") — see [[TernaryStyle]]. */
  ternary?: TernaryStyle | undefined;
  /** GWAS QQ plot appearance (kind "qq") — see [[QQStyle]]. */
  qq?: QQStyle | undefined;
  /** GWAS Manhattan plot appearance (kind "manhattan") — see [[ManhattanStyle]]. */
  manhattan?: ManhattanStyle | undefined;
  /** Sunburst appearance (kind "sunburst") — see [[SunburstStyle]]. */
  sunburst?: SunburstStyle | undefined;
  /** Chord / circos appearance (kind "chord") — see [[ChordStyle]]. */
  chord?: ChordStyle | undefined;
  /** Oncoprint appearance (kind "oncoprint") — see [[OncoprintStyle]]. */
  oncoprint?: OncoprintStyle | undefined;
  /** Polar histogram / wind rose appearance (kind "rose") — see [[RoseStyle]]. */
  rose?: RoseStyle | undefined;
  /** Timeline-tracks appearance (kind "tracks") — see [[TracksStyle]]. */
  tracks?: TracksStyle | undefined;
  /** Bland-Altman config (kind = "blandaltman"); undefined = defaults (95% limits). */
  blandAltman?: BlandAltmanStyle | undefined;
  /** Population-pyramid config (kind = "pyramid"); undefined = defaults. */
  pyramid?: PyramidStyle | undefined;
  /** Id of the source DataTable (the reactive dependency edge). */
  source: NodeId;
  /** Id of the Analysis that spawned this plot (ROC / PCA / curve-fit / Bland-Altman / cluster
   *  score plots etc.), when it was created from an analysis result. Powers the lineage view;
   *  undefined for graphs made directly from a data table. */
  analysisSource?: NodeId | undefined;
  /** Result generation used when this graph's snapshot was created. */
  analysisResultVersion?: number | undefined;
  /** Unbound legacy snapshot data changed upstream and cannot refresh automatically. */
  snapshotStale?: boolean | undefined;
  /** "stale" = upstream data changed and the stored drawing needs refreshing. */
  status: "ok" | "stale";
  /** Navigator highlight colour (hex) for this sheet; undefined = none. */
  color?: string | undefined;
  /** Pinned sheets sort to the top of their Navigator container. */
  pinned?: boolean | undefined;
  /** Manual overrides, keyed by a stable key — see `rowOverrideKey`. */
  styleOverrides: Record<string, StyleDelta>;
  /** Axis scale overrides; undefined = auto-suggested by the renderer.
   *  Superseded by xAxis/yAxis.scale when present (kept as a back-compat fallback). */
  xScale?: AxisScale | undefined;
  yScale?: AxisScale | undefined;
  /** Full per-axis config (the Axis tab): scale, manual range, reversed, number format, title. */
  xAxis?: AxisSpec | undefined;
  yAxis?: AxisSpec | undefined;
  /** Optional right-hand second value axis (Y2). Reuses AxisSpec; only drawn when at
   *  least one series is assigned to it via SeriesStyle.axis = "y2". (XY / area / bubble /
   *  histogram / volcano; bar (linear only), box, violin and column scatter in either orientation —
   *  a horizontal one draws it along the top. Raincloud and floating bar have none.) */
  y2Axis?: AxisSpec | undefined;
  /** Optional right-hand third value axis (Y3), drawn outside Y2. Reuses AxisSpec; only
   *  drawn when ≥1 series is assigned via SeriesStyle.axis = "y3". */
  y3Axis?: AxisSpec | undefined;
  /**
   * The 3-D scatter's Z axis (kind = "scatter3d" only — no other kind reads it). Reuses
   * AxisSpec so Z gets the same range / scale / ticks / fonts / line styling as X and Y,
   * and one panel serves all three, so the Axis tab and its editing work for Z
   * too (`scatter3d.zTitle` is kept as a fallback title).
   *
   * Note: not every AxisSpec field applies to a projected cube edge. The builder
   * honours: scale (linear/log) · min/max · title (+titleFont; its drag offset is
   * `scatter3d.zTitleOffset`) · tickFont ·
   * majorStep · format/decimals/prefix/suffix · lineColor/lineWidth · hideTicks · hidden.
   * Breaks/bands/categoryGroups/rotation are refused with a message in the panel, not dropped.
   */
  zAxis?: AxisSpec | undefined;
  /** Series colour scheme — a key into the renderer's named palettes (e.g.
   *  "Vibrant", "Warm", "Grayscale"); undefined = the default Okabe–Ito
   *  colourblind-safe palette. Per-series colours in `seriesStyles` still win. */
  palette?: string | undefined;
  /**
   * The applied style preset's series palette, as literal colours. Written by
   * `applyStylePreset` / `applyUserPreset` / `applyStyleParams` so the palette
   * reaches the kinds that colour from the scene builder's `palette` option
   * rather than from per-dataset `seriesStyles` (survival & ROC curves, the PCA
   * groups, treemap regions, parallel/alluvial groups, the correlation matrix's
   * +/− pair, dendrogram clusters, …), so a preset recolours those kinds as well
   * as their furniture. Wins over `palette` (the named registry choice) when set;
   * the Inspector's palette picker clears it, so whichever was set last is what draws.
   */
  paletteColors?: string[] | undefined;
  /** Per-series style, keyed by source column id. */
  seriesStyles?: Record<NodeId, SeriesStyle> | undefined;
  /**
   * Per-point style overrides ("Format this point" — used to highlight individual
   * data points). Keyed by `${columnId}:${rowId}`; each delta layers on top of the
   * series style for that one mark. Empty/absent = every point follows its series.
   */
  pointStyles?: Record<string, SeriesStyle> | undefined;
  /** Background-gridline style; undefined = renderer defaults (shown). */
  grid?: GridStyle | undefined;
  /** Figure (paper) background fill: a CSS colour, or "transparent" (no paper); undefined = theme default. */
  background?: string | undefined;
  /** Opt-in decorative figure backdrop (gradient + flowing wave bands) drawn behind the
   *  whole figure. Undefined = none, the default: this is a poster/slide/social look,
   *  not intended for a publication figure. */
  backdrop?: BackdropStyle | undefined;
  /** Frame style (box / L-shape / offset / none). Default "lshape". */
  frame?: FrameStyle | undefined;
  /** Tick-mark direction (out / in / both / none). Default "out". */
  tickDir?: TickDir | undefined;
  /** Major tick-mark length in px. Default 5. */
  tickLen?: number | undefined;
  /** Graph title heading; undefined = follow the plot name, "" = explicitly blank. */
  title?: string | undefined;
  /** Show the graph title heading. Default true. */
  showTitle?: boolean | undefined;
  /** Heading drag offset (px) from the centred default; undefined = centred. Moves the whole
   *  heading block — the subtitle rides along, which is what dragging a title should do. */
  titleOffset?: { dx: number; dy: number } | undefined;
  /** The subtitle's own drag offset, applied on top of `titleOffset` — set by dragging the
   *  subtitle itself. Stacking (rather than replacing) keeps both gestures intuitive: drag
   *  the title and the block moves together; drag the subtitle and only it shifts.
   *  Undefined = sits directly under the title. */
  subtitleOffset?: { dx: number; dy: number } | undefined;
  /** Title/subtitle horizontal anchor. Default "center"; "left" = the editorial house style. */
  titleAlign?: "left" | "center" | "right" | undefined;
  /** Optional subtitle line under the title; undefined/"" = none. */
  subtitle?: string | undefined;
  /** Optional footer/source mark band at the figure bottom (left + right text). */
  footer?: { left?: string; right?: string } | undefined;
  /**
   * Hide the on-screen "n values are excluded" note under this graph.
   *
   * Note: not a style field and not drawn into the figure — the note lives in the graph pane
   * only, so this suppresses a piece of UI, not part of the artwork. Stored per plot so the
   * choice survives a reload; absent/false = the note shows whenever the source table has
   * exclusions, so the default reports them.
   */
  hideExclusionNote?: boolean | undefined;
  /** Per-element typography overrides (title/subtitle/axisTitle/tick/legend). */
  fonts?: Partial<Record<FontElement, FontSpec>> | undefined;
  /** Legend placement / framing; undefined = auto (outside-right when ≥2 series). */
  legend?: LegendSpec | undefined;
  /** Free drag offset (px) of the whole legend block from its anchored position. */
  legendOffset?: { dx: number; dy: number } | undefined;
  /**
   * The words of a legend row the user renamed on the graph (double-click the row), keyed by the row's own label as
   * the chart builds it (a sunburst branch, an oncoprint alteration type, a rose speed band, an ordination group, a
   * volcano zone, a pie slice). Presentation only: the data is untouched. A row that names a data column is renamed by
   * renaming the column instead (the direct-label rule), so it never lands here. Undefined = every row as built.
   */
  legendLabels?: Record<string, string> | undefined;
  /** Loose legend rows: a row pulled out of the block (click it, then drag it out), drawn on
   *  its own at this place — the row's top-left, figure px — keyed like `legendLabels` by its label as built. Dragged
   *  back onto the block, its entry is removed and it returns to its own slot. */
  legendLoose?: Record<string, { x: number; y: number }> | undefined;
  /**
   * Zone key — a small legend for the shaded zone bands (`hband`/`vband`), separate from the
   * series legend. Each band that carries a `label` becomes one keyed row (its fill swatch +
   * its label), so a stack of zones (VIF Low/Moderate/High, a normal range, a threshold) reads
   * as a key. Overlaid inside a plot corner — `"off"` (default, or undefined) hides it; the four
   * corners place it. Bands with no label are skipped; with none labelled the key does not draw.
   */
  zoneLegend?: "off" | "topleft" | "topright" | "bottomleft" | "bottomright" | undefined;
  /** Free drag offset (px) of the heatmap colour-scale bar. */
  colorbarOffset?: { dx: number; dy: number } | undefined;
  /** Free drag offset (px) of the curve-fit potency label (EC50/IC50 = …) so the fitted
   *  equation/potency text can be repositioned off the crosshair. */
  fitLabelOffset?: { dx: number; dy: number } | undefined;
  /** Free-drag offsets of a per-series fit's potency label and parameter block ([[Plot.fits]]),
   *  keyed by the fit's index in `fits`. The single [[Plot.fit]] keeps `fitLabelOffset` /
   *  `fitParams.offset`; a `fits[]` entry never borrows those, so dragging one moves only it. */
  fitsOffsets?: Record<string, { label?: { dx: number; dy: number } | undefined; params?: { dx: number; dy: number } | undefined }> | undefined;
  /** How the fitted-parameter block ([[PlotFit.params]]) is drawn: a right-aligned stack
   *  inside the plot rect, near the bottom-right, where fitted parameters are usually printed.
   *  Undefined = shown at the default size and position whenever the fit has parameters
   *  (running a fit is an explicit request for its numbers, so they are not hidden behind
   *  another switch). `show: false` turns it off. */
  fitParams?: {
    show?: boolean | undefined;
    /** Free-drag offset (px) from the default corner. */
    offset?: { dx: number; dy: number } | undefined;
    /** Font size px; undefined = the legend size. */
    size?: number | undefined;
    /** Text alignment within the block. Default "right", as fitted parameters are usually printed. */
    align?: "left" | "right" | undefined;
    /** true = the lines move as one block (a drag on any line moves them all, per-line
     *  positions ignored). Undefined = each line drags on its own. */
    together?: boolean | undefined;
    /** Per-line choices, keyed by [[PlotFit.paramKeys]] (or "#i" for an older fit). */
    lines?: Record<string, FitParamLine> | undefined;
  } | undefined;
  /** On-graph annotations (reference lines / text / significance brackets). */
  annotations?: Annotation[] | undefined;
  /** Plot-wide significance-bracket formatting (label style / decimals / colour / width). */
  significance?: SignificanceStyle | undefined;
  /**
   * Reference (control) group name for analysis-driven significance markers: set it and the
   * markers show every treatment against this group instead of every pair.
   *
   * Deliberately not part of `SignificanceStyle` — that interface is presentation, read by
   * the builders, and this decides which comparisons exist. It is consumed by the
   * analysis→graph sync, so a plot carries the choice and a re-run reproduces it. */
  significanceControl?: string | undefined;
  /** An overlaid fitted curve (from a curve-fit / regression analysis); undefined = none. */
  fit?: PlotFit | undefined;
  /** Overlaid per-dataset fitted curves from a global fit (one per dataset), each
   *  colour-matched to its series. Drawn in addition to `fit`; undefined = none. */
  fits?: PlotFit[] | undefined;
  /** How `fit` / `fits` and their bands look (colour, thickness, dashes, opacity, show).
   *  Kept apart from the fit itself so a re-fit does not reset the look. */
  fitStyle?: FitStyle | undefined;
  /** Per-series confidence/data ellipse overlay (XY scatter): a covariance ellipse
   *  around each series' points (the "uncertainty ellipse" used in PCA/PCoA/ordination). */
  ellipse?: EllipseSpec | undefined;
  /** Kaplan-Meier step curves (when kind = "survival"); from a survival analysis. */
  survival?: SurvivalCurve[] | undefined;
  /** ROC curves (when kind = "roc"); from a ROC analysis. */
  roc?: RocCurve[] | undefined;
  /** PCA graph data (when kind = "pcascore"/"pcaload"/"pcabiplot"/"scree"); from a PCA analysis. */
  pca?: PcaGraphData | undefined;
  /** PCA graph display config (component selection, scree metric). */
  pcaStyle?: PcaStyle | undefined;
  /** Dendrogram config (when kind = "dendrogram"); undefined = defaults (cluster rows). */
  dendrogram?: DendrogramStyle | undefined;
}

/** Categorical charts whose category↔value axes transpose with `barOrientation`.
 *  Bar/box/violin/column-scatter default to value-on-Y (vertical); flipping to
 *  "horizontal" draws the value axis on X (bottom) and the category band on Y
 *  (left). Lollipop manages its own orientation; raincloud is vertical-only. */
export function isTransposedPlot(plot: Pick<Plot, "kind" | "barOrientation">): boolean {
  const kind = plot.kind ?? "xy";
  if (kind !== "bar" && kind !== "box" && kind !== "violin" && kind !== "scatter" && kind !== "floatingbar") return false;
  return (plot.barOrientation ?? "vertical") === "horizontal";
}

/** Map a visual axis (as drawn on / clicked on the canvas) to the data `AxisSpec`
 *  that governs it. For a transposed categorical chart the value spec (`yAxis`) is
 *  drawn on X and the category spec (`xAxis`) on Y, so x↔y swap; otherwise the
 *  visual and data axes coincide. Y2 never transposes. This keeps the title /
 *  scale / range / line edits routed to the spec the renderer actually reads,
 *  so a flipped graph's labels follow their axis. */
export function dataAxisOf(
  plot: Pick<Plot, "kind" | "barOrientation">,
  visual: "x" | "y" | "y2" | "y3",
): "x" | "y" | "y2" | "y3" {
  if (visual === "y2" || visual === "y3" || !isTransposedPlot(plot)) return visual;
  return visual === "x" ? "y" : "x";
}

// --- statistics ------------------------------------------------------------

/**
 * One row of a tidy results table (broom-style: term · estimate · SE · statistic
 * · df · p · CI). Extra numeric/string columns are allowed (e.g. n, W, U).
 */
export type { TidyTerm } from "@mady/contracts";

/**
 * The single shape every analysis emits — the tidy contract. The
 * stats engine returns a matching JSON; the renderer stores it on the Analysis.
 */
export type { AnalysisResult } from "@mady/contracts";

/**
 * Thresholds for flagging a questionable nonlinear fit ("flag poor fits"). The engine
 * compares each stored diagnostic to its threshold and, when `enabled`, returns
 * `flagged` + a human-readable reason per breached criterion. A threshold left
 * `undefined` disables that one criterion (the others still apply). Defaults live in
 * `DEFAULT_FIT_FLAGS`; the direction of each test is fixed (see the field comments).
 */
export interface FitFlagThresholds {
  /** Master switch — flagging only runs when true. */
  enabled: boolean;
  /** Flag when R² is below this (poor overall fit). */
  rSqBelow?: number | undefined;
  /** Flag when the number of points n is below this (too little data). */
  nBelow?: number | undefined;
  /** Flag when the max parameter dependency is above this (parameters not separable). */
  dependencyAbove?: number | undefined;
  /** Flag when max Hougaard |skewness| is above this (SE-based CIs unreliable). */
  skewnessAbove?: number | undefined;
  /** Flag when the residual-normality (Shapiro) p is below this (residuals non-normal). */
  residNormalityBelow?: number | undefined;
  /** Flag when the number of ROUT-removed outliers is above this (only when ROUT ran). */
  outliersAbove?: number | undefined;
}

/** Built-in flag thresholds — chosen to agree with the engine's existing prose warnings
 *  (dependency > 0.99, |skewness| > 1). Disabled by default; the dialog toggles it on. */
export const DEFAULT_FIT_FLAGS: Required<FitFlagThresholds> = {
  enabled: false,
  rSqBelow: 0.5,
  nBelow: 5,
  dependencyAbove: 0.99,
  skewnessAbove: 1.0,
  residNormalityBelow: 0.05,
  outliersAbove: 0,
};

/** Re-runnable parameters for an analysis (what the user chose). */
export interface AnalysisParams {
  /** Source column ids the test reads (1+ depending on method). */
  columns: NodeId[];
  /** Test variant, e.g. ttest: "one-sample"|"unpaired"|"welch"|"paired"|"mann-whitney"|"wilcoxon". */
  variant?: string | undefined;
  /** Second model for "compare models" (comparefits): `variant` is model A, this is model B. */
  variant2?: string | undefined;
  /** ROC DeLong compare: a second marker (score) column id; runs the correlated-AUC comparison. */
  marker2?: string | undefined;
  /** Reference value for a one-sample test. */
  mu?: number | undefined;
  /** Confidence level (default 0.95). */
  conf?: number | undefined;
  /** Contingency 2×2 effect-size CI method: "score" (Koopman RR + Newcombe risk-diff, default) | "log" (Katz + Wald). */
  ciMethod?: string | undefined;
  /** Survival (≥3 groups): also run pairwise log-rank comparisons of the curves. */
  pairwise?: boolean | undefined;
  /** Survival pairwise multiplicity correction: holm-sidak|bonferroni|sidak|none (default holm-sidak). */
  pairwiseMethod?: string | undefined;
  /** Bland-Altman: plot the difference as a percent of the mean instead of absolute units. */
  percent?: boolean | undefined;
  /** Bland-Altman: limits-of-agreement multiplier × SD of the differences (default 1.96). */
  agreementK?: number | undefined;
  /** Deming regression: error-variance ratio λ = σ²(Y)/σ²(X) (default 1 = orthogonal). */
  lambda?: number | undefined;
  /** AUC: drop peaks shorter than this fraction of the tallest peak's height (0 = keep all). */
  minPeakFraction?: number | undefined;
  /** AUC: numeric baseline value, used when the baseline variant is "custom". */
  baselineValue?: number | undefined;
  /** Test direction for t-tests / correlation: "two-sided" (default) | "greater" | "less". */
  tail?: string | undefined;
  /** Equivalence (TOST): the equivalence bound, read as ± this value unless boundLow/High
   *  are given. Its units follow `boundMode`. This is a scientific judgement, not a default
   *  worth guessing — the smallest difference that would actually matter. */
  bound?: number | undefined;
  /** Equivalence: how `bound` is expressed — "absolute" (raw data units, default) |
   *  "sd" (pooled-SD units, i.e. Cohen's d) | "percent" (of the reference mean). */
  boundMode?: string | undefined;
  /** Equivalence: explicit asymmetric bounds in raw units (override the symmetric `bound`). */
  boundLow?: number | undefined;
  boundHigh?: number | undefined;
  /** Equivalence: significance level for each one-sided test (default 0.05). The interval
   *  TOST decides on is (1 − 2·alpha), so 0.05 → the 90% CI. */
  alpha?: number | undefined;
  /** Equivalence (unpaired): use the pooled-variance (Student) SE instead of Welch's. */
  pooled?: boolean | undefined;
  /** Permutation: number of random rearrangements when exact enumeration is infeasible. */
  nResamples?: number | undefined;
  /** Permutation (unpaired): the test statistic — "mean" (default) | "median" | "t". */
  statistic?: string | undefined;
  /** Bayes factor: the Cauchy prior scale on the effect size — "medium" (√2/2, default)
   *  | "wide" (1) | "ultrawide" (√2), or a positive number for a custom scale. */
  rscale?: string | number | undefined;
  /** ANOVA post-hoc test: tukey|bonferroni|sidak|holm-sidak|dunnett. */
  posthoc?: string | undefined;
  /** Post-hoc comparison scheme: "all-pairs" | "vs-control" | "selected-pairs". */
  scheme?: string | undefined;
  /** Two-way ANOVA post-hoc comparison family: "rowmeans" (factor A) | "colmeans"
   *  (factor B) | "cellmeans" (every cell). Present ⇒ run post-hoc after the two-way. */
  compare?: string | undefined;
  /** Control group index (0-based) for vs-control / Dunnett schemes. */
  control?: number | undefined;
  /** Selected-pairs scheme: the chosen [i, j] group-index pairs (multiplicity = their count). */
  pairs?: number[][] | undefined;
  /** Curve-fit / regression weighting scheme: "none"|"1/Y"|"1/Y2"|"1/X"|"1/X2"|"1/SD2"|"poisson". */
  weighting?: string | undefined;
  /** Curve fit: identify + remove outliers (ROUT, Motulsky & Brown) before the least-squares fit. */
  rout?: boolean | undefined;
  /** Nonlinear fit: flag a questionable fit against user thresholds (the engine returns
   *  `flagged` + `flagReasons` and appends the reasons to the fit's assumptions). Absent
   *  or `{ enabled: false }` = no flagging. */
  flag?: FitFlagThresholds | undefined;
  /** Curve transform (smooth) and melting temperature (derivative Tm): Savitzky-Golay window size (odd; 0 / omitted = auto ≈10% of points). */
  smoothWindow?: number | undefined;
  /** Melting temperature: fit with sloped (linear) pre- and post-transition baselines. */
  sloped?: boolean | undefined;
  /** Melting temperature: only X within [rangeFrom, rangeTo] is used (either bound optional). */
  rangeFrom?: number | undefined;
  rangeTo?: number | undefined;
  /** Linear regression: force the line through an arbitrary fixed point (x₀, y₀). */
  throughPoint?: { x: number; y: number } | undefined;
  /** Nonlinear fit (curvefit): a user-defined equation `Y = f(X, params…)` to fit
   *  (user-defined equations). Used when `variant === "custom"`; the engine
   *  compiles it safely (no eval) + auto-detects the parameters. */
  equation?: string | undefined;
  /** User-defined-equation fit: optional starting value per parameter name (default 1). */
  initialValues?: Record<string, number> | undefined;
  /** Nonlinear fit (curvefit/globalfit): fix parameters to a constant (name → value). */
  fixed?: Record<string, number> | undefined;
  /** Nonlinear fit: per-parameter [min, max] bounds (null = unbounded that side). */
  paramBounds?: Record<string, [number | null, number | null]> | undefined;
  /** Dose-response: also report EC/IC at these response percents (e.g. [10, 90]). */
  ecLevels?: number[] | undefined;
  /** Dose-response (inhibition): convert IC50 → Ki via Cheng-Prusoff, given [ligand] + its Kd. */
  chengProsuff?: { conc: number; kd: number } | undefined;
  /** Global-fit: parameter names shared across all datasets (the rest are local). */
  shared?: string[] | undefined;
  /** Global-fit: also test whether one curve (every parameter shared) fits all datasets - extra-sum-of-squares F. */
  compareOneCurve?: boolean | undefined;
  /** Global-fit with a per-dataset constant (e.g. enzyme-inhibition [I]): dataset id → value. */
  consts?: Record<string, number> | undefined;
  /** PCA: optional column id to group cases by (for grouped score plots / ellipses). */
  groupBy?: NodeId | undefined;
  /** PCA: components to retain — parallel (Horn's) | kaiser | fixedk | variance | all. */
  componentSelection?: string | undefined;
  /** PCA (kaiser): retain eigenvalues above this threshold (default 1.0). */
  kaiserThreshold?: number | undefined;
  /** PCA (fixedk): retain exactly this many components. */
  fixedK?: number | undefined;
  /** PCA (variance): retain the fewest PCs reaching this cumulative-variance fraction (0–1). */
  varianceThreshold?: number | undefined;
  /** PCA (parallel analysis): percentile of the random eigenvalue distribution (default 95). */
  parallelPercentile?: number | undefined;
  /** Cluster analysis: number of clusters (k-means k / hierarchical cut). */
  k?: number | undefined;
  /** PRNG seed for any randomized method — the k-means++ init, and the permutation
   *  test's Monte Carlo rearrangements — so a run is exactly reproducible. */
  seed?: number | undefined;
  /** Cluster analysis: z-score each variable before clustering. Default true. */
  standardize?: boolean | undefined;
  /** Cluster analysis: distance metric (euclidean|manhattan|cosine|correlation). */
  metric?: string | undefined;
  /** Cluster analysis (hierarchical): linkage (ward|average|weighted|complete|single|centroid|median). */
  linkage?: string | undefined;
  /** Cluster analysis: also scan k=2…kMax and report elbow (within-SS) + silhouette per k. */
  scanK?: boolean | undefined;
  /** Cluster analysis (scanK): the largest k to try in the scan (default 10). */
  kMax?: number | undefined;
  /** Ordination (PCoA / NMDS): the standardization applied before the distance is taken
   *  — "hellinger" | "chisq" | "wisconsin" | "total" | "sqrt" | "log1p" | "none".
   *  It is half of what the map means: a Euclidean-geometry method on raw species counts
   *  is the classic misuse, and the transformation corrects it. */
  transform?: string | undefined;
  /** PCoA: negative-eigenvalue correction — "none" (report them) | "lingoes" | "cailliez". */
  correction?: string | undefined;
  /** NMDS: how many axes the map has (default 2). */
  dimensions?: number | undefined;
  /** NMDS: random restarts, because the fit can settle in a local minimum (default 20). */
  tries?: number | undefined;
  /** CA / RDA: which family's distances the drawn picture preserves —
   *  "symmetric" (both, the usual joint plot) | "sites" | "species". */
  scaling?: string | undefined;
  /** A constrained ordination (RDA, CCA, db-RDA): the explanatory column ids, from the same sheet as the
   *  response. Both blocks come from the same table, because an analysis reads one source table. */
  explanatory?: NodeId[] | undefined;
  /** Variance partitioning: the second and (optionally) third blocks of explanatory
   *  columns. `explanatory` above is the first. Every block comes from the same sheet as
   *  the response and a column may belong to at most one of them — that is what makes the
   *  fractions a partition rather than an overlap of overlaps. Two blocks is the minimum:
   *  with one there is nothing to partition. */
  explanatory2?: NodeId[] | undefined;
  explanatory3?: NodeId[] | undefined;
  /** Variance partitioning: what to call each block in the readout ("Climate", "Soil").
   *  Presentation only — the fractions are named from these, so an unnamed block reads as
   *  "Block A" rather than as nothing. */
  blockLabels?: string[] | undefined;
  /** RDA: rearrangements for the permutation test (default 999). */
  permutations?: number | undefined;
}

/**
 * A first-class analysis object: an engine method bound to a source table +
 * parameters, with its last tidy result. Reactive — goes `stale` when the source
 * table changes (re-runnable from `params`). Persisted in `.mady`.
 */
export interface Analysis {
  id: NodeId;
  name: string;
  /** Engine method id (e.g. "describe","normality","ttest"). */
  method: string;
  /** Id of the source DataTable (the reactive dependency edge). */
  source: NodeId;
  params: AnalysisParams;
  status: "ok" | "stale" | "error";
  result?: AnalysisResult | undefined;
  /** Monotonic result generation, persisted so graph freshness survives save/load. */
  resultVersion?: number | undefined;
  error?: string | undefined;
  /** Navigator highlight colour (hex) for this sheet; undefined = none. */
  color?: string | undefined;
  /** Pinned sheets sort to the top of their Navigator container. */
  pinned?: boolean | undefined;
}

/** A node in the data→analysis→graph provenance/lineage DAG (the "Family" / lineage view). */
export interface LineageNode {
  kind: "table" | "analysis" | "plot" | "layout";
  id: NodeId;
  name: string;
  status: "ok" | "stale" | "error";
}

/** A directed provenance edge (from = upstream source, to = downstream dependent). */
export interface LineageEdge {
  from: NodeId;
  to: NodeId;
  relation: "derives" | "analyzes" | "plots" | "spawns" | "panel";
}

/** The connected provenance component around a node: its nodes + the edges among them. */
export interface Lineage {
  nodes: LineageNode[];
  edges: LineageEdge[];
}

/**
 * A saved, re-applicable analysis "Method" (Analysis Method files): an
 * engine method + its column-independent parameters, with the source columns
 * captured by position (not id) so the method can be re-applied to a different,
 * same-shaped table. Persisted in the project (and exportable to a `.madymethod`
 * file). `analysisToMethod` builds one from an analysis; `methodApplyParams`
 * remaps it onto a target table. Not bound to any table (unlike `Analysis`).
 */
export interface MethodSpec {
  id: NodeId;
  name: string;
  /** Engine method id (mirrors `Analysis.method`). */
  method: string;
  /** Source column positions (0-based) the analysis read — remapped onto the target table. */
  columns: number[];
  /** PCA group-by column position, if the analysis used one. */
  groupBy?: number | undefined;
  /** The rest of the analysis parameters (variant / conf / posthoc / control / …) — column-independent. */
  params: Omit<AnalysisParams, "columns" | "groupBy">;
}

// --- reproducible analysis log --------------------------------------------

/** Kind of a logged step (drives its icon + grouping). */
export type LogKind = "import" | "graph" | "analyze" | "transform" | "fit" | "note";

/**
 * One step in the reproducible analysis log — a chronological, persisted record
 * of the meaningful actions taken (import / analyze / graph / fit …). Human-
 * readable; entries that produced an object reference it (so the drawer can open
 * or re-run it).
 */
export interface LogEntry {
  id: NodeId;
  kind: LogKind;
  /** Short headline, e.g. "Unpaired t test — A vs B". */
  label: string;
  /** Optional one-line detail (params / result summary). */
  detail?: string | undefined;
  /** The object this step produced (if any), so the drawer can open it. */
  refKind?: WorkspaceObjectKind | undefined;
  refId?: NodeId | undefined;
}

/**
 * Organizational layer. A tree of **project folders →
 * experiments → object references**. The entities themselves (tables, plots, …)
 * stay in the flat `Project` stores; the workspace tree only *references* them by
 * id. So an object can be filed, moved, or left unfiled at any of three optional
 * levels — loose · folder · experiment — without touching the entity stores or
 * the reactive DAG: every level is optional.
 */
export type WorkspaceObjectKind = "table" | "plot" | "analysis" | "layout";

/** A reference from the organizational tree to an entity in a flat store. */
export interface WorkspaceRef {
  kind: WorkspaceObjectKind;
  /** Id of the referenced entity (e.g. a `DataTable.id`). */
  id: NodeId;
}

/** Mid level (optional): groups objects of one experiment within a project. */
export interface Experiment {
  id: NodeId;
  name: string;
  /** Objects shown under this experiment, in display order. */
  members: WorkspaceRef[];
}

/** Top level (optional): a project folder, with its own documentation. */
export interface ProjectFolder {
  id: NodeId;
  name: string;
  /** Objects filed directly under the folder (no experiment). */
  members: WorkspaceRef[];
  experiments: Experiment[];
  /** Per-project documentation (methods / notes / log) — the folder's Docs tab. */
  documentation: string;
}

export interface Workspace {
  folders: ProjectFolder[];
  /** Objects not filed under any folder (the top level is optional). */
  loose: WorkspaceRef[];
}

/** Where to file an object in the workspace tree. */
export type WorkspaceTarget =
  | { level: "loose" }
  | { level: "folder"; folderId: NodeId }
  | { level: "experiment"; folderId: NodeId; experimentId: NodeId };

/**
 * A multi-panel figure layout (the figure assembler): an ordered set of graphs
 * (plot ids) tiled in a responsive grid with auto A/B/C panel lettering, or placed
 * freely on a canvas (`freeform` + `panelPositions`).
 */
/** Default gap (px) between panels in a figure layout. See [[FigureLayout.gutter]]. */
export const DEFAULT_FIGURE_GUTTER = 16;

export interface FigureLayout {
  id: NodeId;
  name: string;
  /** Navigator highlight colour (hex) for this sheet; undefined = none. */
  color?: string | undefined;
  /** Pinned sheets sort to the top of their Navigator container. */
  pinned?: boolean | undefined;
  /** Plot ids tiled into the figure, in panel order (A, B, C …). */
  panels: NodeId[];
  /** Fixed number of columns; undefined = responsive auto-fit. */
  columns?: number | undefined;
  /** Gap (px) between panels (both row + column). Default [[DEFAULT_FIGURE_GUTTER]] (16) —
   *  panels touching edge-to-edge read as one image, so a fresh figure starts with real
   *  whitespace. 0 is still selectable for a deliberately flush montage. */
  gutter?: number | undefined;
  /** Panel-letter style: "upper" = A/B/C (default), "lower" = a/b/c,
   *  "numeric" = 1/2/3, "none" = no letters. */
  lettering?: "upper" | "lower" | "numeric" | "none" | undefined;
  /** Show an alignment-assist grid behind the panels. Default false. */
  showGrid?: boolean | undefined;
  /** Auto-scale newly-added panels to the first panel's look (size/fonts/axes/colours)
   *  as they're imported, so the figure stays homogeneous. Default false. */
  autoScale?: boolean | undefined;
  /** Whether each panel shares its plot with the dedicated graph tab (default true).
   *  When false the figure holds independent clone plots, so styling a panel does
   *  not change the source graph (and vice versa). */
  linked?: boolean | undefined;
  /** When unlinked, maps each panel's clone plot id → the source (original) plot id
   *  it was detached from (so inclusion/exclusion + re-linking can be resolved). */
  panelSource?: Record<NodeId, NodeId> | undefined;
  /** Free-drag mode: panels are absolutely positioned (see panelPositions) instead of
   *  the auto-grid. Opt-in; default false keeps the responsive grid. */
  freeform?: boolean | undefined;
  /** Per-panel top-left position (px) within the free-drag canvas, keyed by plot id.
   *  Panels without an entry fall back to a grid-derived default. Only used when freeform. */
  panelPositions?: Record<NodeId, { x: number; y: number }> | undefined;
  /** Show each panel's in-graph title heading (the plot's own Format → Title). Default
   *  false — a multi-panel figure is labelled by its A/B/C letters, not per-graph titles.
   *  When false the freed vertical space is reclaimed by the plot (graph grows). */
  showPanelTitles?: boolean | undefined;
  /** Show the per-panel card header name (the graph's name above each panel in the
   *  arrange view). Default true. Purely an editing-UI affordance — the card name is
   *  never part of the exported figure. */
  showPanelNames?: boolean | undefined;
  /** Replace the panels' repeated legends with one legend for the whole figure, drawn below
   *  the panels. A figure whose panels all plot the same series needs one key, not N copies
   *  of it — and the space they were using goes back to the graphs.
   *
   *  Opt-in, and applied only where it is accurate: every panel that shows a legend must
   *  carry the same entries (same labels, colours and marker shapes). If any panel's legend
   *  differs, nothing is merged and each panel keeps its own — one shared key cannot speak
   *  for series that don't match. Default false. */
  mergedLegend?: boolean | undefined;
  /** Label only the figure's outer edges: panels that aren't in the first column drop their
   *  Y tick labels + title, and panels that aren't in the last row of their column drop their
   *  X ones. The freed margin goes back to the plot, so the panels tighten up. This is what
   *  makes a grid of panels read as one figure rather than several graphs side by side.
   *
   *  Opt-in, and applied only where it is accurate: a panel keeps its own labels unless
   *  it genuinely shares that axis with the edge panel — same axis title, same scale type and
   *  the same tick labels. Panels with different units or ranges are left alone, because
   *  hiding their scale would misrepresent them. Needs a detected grid (aligned or an
   *  explicit column count). Default false. */
  sharedAxisLabels?: boolean | undefined;
  /** How many grid columns a panel spans, keyed by plot id. Missing/1 = one cell. Lets a
   *  figure use the commonest published shape — one wide panel across the top, smaller ones
   *  beneath — without abandoning the grid for free drag.
   *
   *  Only meaningful in grid mode (`freeform` off) with an explicit [[columns]] count: a
   *  span is a fraction of a known column count, so "span 2 of auto-fill" has no meaning.
   *  A spanning panel is re-laid-out to fill its spanned width (axes/ticks recomputed, as
   *  with [[panelSizes]]) — it is not scaled.
   *
   *  Note: a spanning panel is deliberately a different width from its neighbours, so it is
   *  excluded as a target when sizing others: it does not set the axis-less (heatmap) width
   *  match, nor the [[uniformColumnWidth]] column target. It still receives both. */
  panelSpan?: Record<NodeId, number> | undefined;
  /** How many grid rows a panel occupies (default 1) — the vertical counterpart of
   *  [[panelSpan]], so the aligned grid can express the journal "tall left" / "wide top"
   *  shapes: a panel owns several row slots and the others tile around
   *  it, on shared grid lines, surviving every re-align. Same preconditions as
   *  [[panelSpan]]: grid mode with an explicit [[columns]] count. A row-spanning panel
   *  follows the alignment lines but never defines them — its axis crosses its rows, so
   *  no single row's axis line can be shared with it. */
  panelRowSpan?: Record<NodeId, number> | undefined;
  /** Per-panel override of the panel-letter text, keyed by plot id — set by double-clicking
   *  a label. Missing entry = the letter the [[lettering]] scheme generates for that
   *  position, so unedited labels keep re-lettering themselves as panels are reordered.
   *  Lets a figure use "(a)", "A(i)", "S1", or continue a previous figure's sequence.
   *  An empty string suppresses just that one label. Ignored when lettering is "none". */
  letterText?: Record<NodeId, string> | undefined;
  /** Panel-letter (A/B/C) font-family stack. undefined = theme default (system sans). */
  letterFont?: string | undefined;
  /** Panel-letter (A/B/C) font size in px. undefined = 15. */
  letterSize?: number | undefined;
  /** Panel-letter (A/B/C) bold weight. undefined/true = bold (700), false = normal (400). */
  letterBold?: boolean | undefined;
  /** Panel-letter (A/B/C) colour. undefined = theme ink. */
  letterColor?: string | undefined;
  /** Per-panel graph (scene) size in px, keyed by plot id — set by dragging a panel's
   *  resize handle. Missing entry = the default 380×260. The plot is re-laid-out at the
   *  new size (axes/ticks recomputed), not merely scaled. Ignored while aligning axes. */
  panelSizes?: Record<NodeId, { w: number; h: number }> | undefined;
  /** Per-panel card (outer box) size in px, keyed by plot id — set by dragging a card's
   *  edges (card edges resize the card, the inner handle resizes the
   *  graph). A floor: the card never shrinks below its graph + chrome, and with no entry
   *  it hugs the graph. A card bigger than its graph centres the graph
   *  in the extra space, so resizing the graph inside does not move the card (or the
   *  aligned grid around it). */
  cardSizes?: Record<NodeId, { w: number; h: number }> | undefined;
  /** Auto-align the panels' X-axes: every panel down a column shares one horizontal data
   *  extent (axes line up vertically). Non-destructive — a uniform axis length is applied
   *  at render only. Rows/columns are auto-detected from the panel arrangement. Default false. */
  alignX?: boolean | undefined;
  /** Auto-align the panels' Y-axes: every panel across a row shares one vertical data extent
   *  (axes line up horizontally). See [[alignX]]. Default false. */
  alignY?: boolean | undefined;
  /** Make every graph in a detected row share one height (the row's tallest). Rows may still
   *  differ from each other. The graphs are re-laid-out to fill that height (stretch, not
   *  letterbox). Enters grid mode like the align toggles. Default false. */
  uniformRowHeight?: boolean | undefined;
  /** Make every graph in a detected column share one width (the column's widest). Columns may
   *  still differ from each other. Graphs are re-laid-out to fill that width. See
   *  [[uniformRowHeight]]. Default false. */
  uniformColumnWidth?: boolean | undefined;
  /** Per-panel A/B/C label position (px) from the card's top-left, keyed by plot id — set by
   *  dragging the label. Missing entry = the default top-left corner. */
  labelPos?: Record<NodeId, { x: number; y: number }> | undefined;
  /** Auto-align the A/B/C labels vertically (every label shares the reference label's X, so
   *  they line up in a column). Default false. */
  labelAlignX?: boolean | undefined;
  /** Auto-align the A/B/C labels horizontally (every label shares the reference label's Y, so
   *  they line up in a row). Default false. */
  labelAlignY?: boolean | undefined;
  /** Show a measuring ruler (px ticks) along the top + left of the arrange canvas.
   *  Pairs with showGrid. Default false. */
  showRuler?: boolean | undefined;
  /** Guides dragged out of the rulers (canvas px): `v` = vertical lines at these x, `h` = horizontal
   *  lines at these y. A dragged panel snaps to them. An editing aid — drawn on the canvas only, never
   *  exported, never in a figure template. Undefined = none. */
  guides?: { v?: number[] | undefined; h?: number[] | undefined } | undefined;
  /** "Snap to grid": a dragged panel's corner rounds to the canvas grid (only while the grid shows).
   *  An editing aid, never in a figure template. Default off. */
  snapToGrid?: boolean | undefined;
  /** The page the figure is laid out on (mm): its outline is drawn behind the panels (with a dashed
   *  inner margin when `marginMm` is set), the canvas is at least the page, and the export is the
   *  page. Never moves a panel. House style — kept in a figure template. Undefined = no page. */
  page?: { wMm: number; hMm: number; marginMm?: number | undefined } | undefined;
  /** "Keep proportions": draw each panel as a true uniform-scale
   *  miniature of the full graph — built at the graph's own figure size and rendered
   *  scaled, so fonts, markers, strokes and margins all keep the designed proportions.
   *  Off = the graph re-lays-out at card size. The field is named `panelFontScale`
   *  for compatibility with saved figures. Render-only; the source graphs are untouched. Default false so
   *  saved figures keep their look; `addLayout` seeds new figures with true. */
  panelFontScale?: boolean | undefined;
  /** In an aligned grid whose last row holds a single panel, stretch that panel across the
   *  full row width instead of leaving a hole beside it (an aligned 3-panel figure otherwise
   *  fills about 70% of its box). Off = the panel keeps its width. The stretched panel
   *  follows the alignment lines but never defines them — its axes span the row, so it
   *  cannot share a column's axis line. Render-only. */
  stretchLastPanel?: boolean | undefined;
  /** In an aligned grid, a graph with no axes (pie, treemap, network, Venn, sunburst…) keeps its own
   *  width and sits centred in its column, instead of being widened to the column's width (a round
   *  treemap widened to a wide column leaves the empty space inside its card on one side of the
   *  disc; centred, it is shared evenly either side). Its letter goes with its card.
   *  Axis graphs are untouched. Default off = the widening. Render-only. */
  centreNoAxisPanels?: boolean | undefined;
  /** Stacking order for overlapping panels, keyed by plot id — higher = in front. Missing = 0;
   *  ties keep `panels` order. Deliberately separate from `panels`: that order is the A/B/C
   *  lettering / reading order, so bringing a panel to the front must not renumber the figure. */
  panelZ?: Record<NodeId, number> | undefined;
  /** Panels whose layout is frozen (the lock), keyed by plot id. A locked panel can't be
   *  dragged, resized, nudged, arranged or removed from the figure — but its graph stays fully
   *  editable: the lock is about placement, not content. */
  panelLocked?: Record<NodeId, boolean> | undefined;
  /** Persistent panel groups, keyed by plot id → a shared group tag.
   *  Grouped panels keep moving as one — free-drag and keyboard nudge translate every
   *  unlocked member by the same delta — until ungrouped. Movement only: a group never
   *  resizes its members, and the computed grid modes ignore it exactly as they ignore
   *  hand positions (Align re-derives the dense figure). Missing entry = ungrouped. */
  panelGroups?: Record<NodeId, string> | undefined;
  /** Free objects drawn on the figure canvas, between/across panels — a shared heading, an
   *  A→B arrow, a divider line, a box around related panels. The same [[Annotation]] shape a
   *  graph uses, with one deviation: `x`/`y`/`x2`/`y2`/`w`/`h` are canvas px in the
   *  panel-position space ([[panelPositions]]), not fractions — the canvas has no fixed box a
   *  fraction could be "of", and an arrow tying two panels together must stay put when a third
   *  panel grows the canvas. Only free-box kinds are offered ([[isArrangeableAnnotation]]);
   *  axis-locked kinds (reference lines, brackets, bands) have no axis here to anchor to. */
  figureAnnotations?: Annotation[] | undefined;
}

export interface Project {
  schemaVersion: SchemaVersion;
  tables: DataTable[];
  plots: Plot[];
  /** Statistical analyses bound to source tables. */
  analyses: Analysis[];
  /** Saved, re-applicable analysis Methods (Method files). Optional/additive. */
  methods?: MethodSpec[] | undefined;
  /** User-built colour ramps referenced by plots as `custom:<id>` ([[Gradient]]). Stored in
   *  the document so a shared .mady opens with the same colours; a gradient taken from the
   *  durable user library is copied in here the first time it is used. Optional/additive. */
  gradients?: Gradient[] | undefined;
  /** Multi-panel figure layouts (the assembler). Optional/additive (absent on pre-layout docs). */
  layouts?: FigureLayout[] | undefined;
  /** Chronological record of meaningful actions (reproducible analysis log). */
  log: LogEntry[];
  /** The organizational tree over the flat entity stores above. */
  workspace: Workspace;
}

/** An empty organizational tree (no folders, nothing filed). */
export function emptyWorkspace(): Workspace {
  return { folders: [], loose: [] };
}

/**
 * Stable key for a style override on a data-derived mark. Keyed by the row's
 * stable id so an override survives row insert / remove / reorder and recompute
 * (override survival). Never key an override by row index.
 */
export function rowOverrideKey(rowId: NodeId): string {
  return `row:${rowId}`;
}
