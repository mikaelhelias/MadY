/**
 * New-graph creation catalog + executor — the data behind the "New
 * Graph" dialog. The user picks a graph genre (icon); each genre declares the
 * `PlotKind` it produces and the `TableKind`(s) that can feed it (best first), so
 * the dialog can auto-filter to the compatible datasheet formats — exactly the way
 * AnalyzeDialog gates methods by table kind. No such PlotKind↔TableKind map exists
 * in core, so this module is the single source of truth for it.
 *
 * Pure + document-driven: `createNewGraph` builds the seed table + plot through the
 * same public document methods the manual paths use (`addTable` → `setReplicateCount`/
 * `setEntryMode` → `addPlot` → `setPlotKind` → `setErrorBars`), so it can never
 * drift from how tables/plots are really made, and it is unit-testable against a
 * real in-memory `MadyDocument`.
 */
import { drawableErrorTypes, replicateCount, tableDatasets, tableEntryMode, tableFormat, xColumn } from "@mady/core";
import { buildPlotScene, sceneHasInk } from "@mady/graphics";
import type { PlotScene } from "@mady/graphics";
import { sampleFor } from "./gallery";
import { getAppDefaults } from "./profile";
import type {
  BoxWhisker,
  ColumnType,
  DataTable,
  EntryMode,
  ErrorBarType,
  MadyDocument,
  NodeId,
  Plot,
  PlotKind,
  TableKind,
  WorkspaceTarget,
} from "@mady/core";

/** One graph genre offered in the New-Graph dialog. */
export interface NewGraphGenre {
  /** Stable genre id (dialog selection + tests). */
  key: string;
  /** Picker label. */
  label: string;
  /** One-line "when to use this graph". */
  note: string;
  /** The plot kind this genre creates. */
  plotKind: PlotKind;
  /** Compatible table formats, best first (the first is auto-selected). */
  formats: TableKind[];
  /** Draws mean ± error bars → the dialog offers an error-type control. */
  errorCapable?: boolean;
  /** Extra plot options applied on create (e.g. bar layout) via `setPlotOptions`. */
  plotPatch?: Partial<Plot>;
  /**
   * Seed columns for the genre's fresh datasheet, replacing the format's own
   * (`tableFormat(kind).seedColumns`) — only when the genre needs a shape the format's default
   * lacks. Bubble: its size comes from a 2nd Y dataset, so the plain xy seed ("X · Y1") would warn
   * "needs a 2nd Y column" on the very sheet the wizard just made for it.
   */
  seedColumns?: string[];
  /**
   * Roles for `seedColumns`, positionally — needed on a lead-less format (multivariable, pca),
   * where an untagged first column is a variable, not the label column. Without it the ternary's
   * "Sample" column would become composition #1 and no row would be placeable.
   */
  seedRoles?: ("x" | "y")[];
  /**
   * A seed for one listed format that needs a different shape than `seedColumns` (before–after:
   * two group columns on Column, but Subject · Before · After on XY). Wins over `seedColumns`
   * for that format; roles from `seedRolesByFormat`, else the format's own convention.
   */
  seedColumnsByFormat?: Partial<Record<TableKind, string[]>>;
  seedRolesByFormat?: Partial<Record<TableKind, ("x" | "y")[]>>;
  /**
   * The graph is drawn from an analysis result (PCA score/loadings/biplot/scree, ROC,
   * Kaplan-Meier): the analysis method id. Create opens Analyze pre-set to this method on the
   * open sheet — the graph appears when the analysis runs — instead of an empty frame. The
   * wizard includes every type of datasheet and graph; every chart
   * kind is listed here, and `newGraph.test` fails the build if one is missing.
   */
  analysis?: string;
}

/**
 * Every chart kind the program draws, in display order — `newGraph.test` fails the build if a
 * PlotKind (other than `image`, a picture panel) has no genre here. Kinds drawn from an analysis
 * result carry `analysis`: Create opens Analyze on the sheet instead of making an empty frame.
 */
export const NEW_GRAPH_GENRES: NewGraphGenre[] = [
  // ── XY ──
  { key: "xy", label: "XY: points & line", note: "Continuous X vs Y — dose-response, kinetics, correlations.", plotKind: "xy", formats: ["xy"], errorCapable: true },
  { key: "area", label: "Area", note: "Filled magnitude over a continuous axis.", plotKind: "area", formats: ["xy"], errorCapable: true },
  // ── Column (one grouping factor) ──
  { key: "bar", label: "Bar / column", note: "Compare a value across categories; mean ± error.", plotKind: "bar", formats: ["column", "grouped"], errorCapable: true },
  { key: "scatter", label: "Column scatter", note: "Every replicate as a dot + mean ± error — small n.", plotKind: "scatter", formats: ["column", "grouped", "nested"], errorCapable: true },
  { key: "box", label: "Box & whisker", note: "Median, quartiles and whiskers per group.", plotKind: "box", formats: ["column", "grouped", "nested"] },
  { key: "violin", label: "Violin", note: "Distribution shape (kernel density) per group.", plotKind: "violin", formats: ["column", "grouped", "nested"] },
  { key: "raincloud", label: "Raincloud", note: "Half-violin + box + jittered raw points per group.", plotKind: "raincloud", formats: ["column", "grouped"] },
  // column first: the column seed (Control · Treated) draws a before-after at once; the xy seed
  // (X · Y1) warns until a second Y column is added.
  { key: "beforeafter", label: "Before–after (paired)", note: "Paired measurements per subject across conditions.", plotKind: "beforeafter", formats: ["column", "xy"], seedColumnsByFormat: { xy: ["Subject", "Before", "After"] } },
  { key: "floatingbar", label: "Floating bars (min→max)", note: "A bar spanning each group's range, line at the mean.", plotKind: "floatingbar", formats: ["column", "grouped"] },
  { key: "estimation", label: "Estimation plot", note: "Raw dots + the mean difference with a bootstrap CI.", plotKind: "estimation", formats: ["column"] },
  // ── Grouped (two grouping factors) ──
  { key: "groupedbar", label: "Grouped bars", note: "Two grouping factors, bars interleaved side by side.", plotKind: "bar", formats: ["grouped"], errorCapable: true, plotPatch: { barLayout: "grouped" } },
  { key: "stackedbar", label: "Stacked bars", note: "Two grouping factors, bars stacked into a total.", plotKind: "bar", formats: ["grouped"], plotPatch: { barLayout: "stacked" } },
  { key: "pyramid", label: "Population pyramid", note: "Two groups as mirrored horizontal bars across categories.", plotKind: "pyramid", formats: ["grouped", "column"] },
  // ── Contingency ──
  { key: "contingency", label: "Contingency (counts)", note: "Grouped bars of counts from an r×c table.", plotKind: "bar", formats: ["contingency"] },
  // ── Survival ──
  { key: "survival", label: "Survival (Kaplan-Meier)", note: "Time-to-event staircase with censoring, per group. Create opens Analyze ▸ Survival on the datasheet — the curves are drawn from that result.", plotKind: "survival", formats: ["survival"], analysis: "survival" },
  // ── Parts of whole ──
  { key: "pie", label: "Pie", note: "Parts of a whole (proportions).", plotKind: "pie", formats: ["partsofwhole"] },
  { key: "treemap", label: "Treemap (Voronoi)", note: "Parts of a whole as area-proportional cells — an infographic packing.", plotKind: "treemap", formats: ["partsofwhole", "column"] },
  { key: "sunburst", label: "Sunburst", note: "A hierarchy as concentric rings — the leading category columns are the levels (inner ring first), each arc sized by its share of the parent, with an optional value column.", plotKind: "sunburst", formats: ["multivariable", "partsofwhole", "grouped"], seedColumns: ["Level 1", "Level 2", "Value"] },
  // ── Matrix / multivariable ──
  // `xy` is a real home for a heatmap: a labelled matrix (genes × conditions) is entered as
  // one text X column + numeric columns — the demo's "Gene expression" sheet is exactly that,
  // and its heatmap draws from an xy table. `xy` is its last format so it is never
  // the format-level default there; `dataAwareFirst` promotes it when the X column is text.
  { key: "heatmap", label: "Heatmap", note: "A value per (row × column) cell — matrices, expression.", plotKind: "heatmap", formats: ["grouped", "multivariable", "xy"] },
  { key: "corrmatrix", label: "Correlation matrix", note: "Pairwise correlations between columns — pie glyphs, blue (+) / red (−).", plotKind: "corrmatrix", formats: ["multivariable", "grouped"] },
  { key: "alluvial", label: "Alluvial / parallel sets", note: "Flows across ordered categorical columns — ribbons sized by shared-row counts.", plotKind: "alluvial", formats: ["multivariable", "grouped"] },
  { key: "network", label: "Network graph", note: "Node-link graph from an edge list (source · target · signed weight, plus optional node group/value/size columns) — force-directed.", plotKind: "network", formats: ["edgelist", "multivariable", "xy"] },
  { key: "chord", label: "Chord / circos", note: "Relationships around a ring: each entity an arc sized by its total weight, each weighted link a ribbon across the interior. Reads an edge list (source · target · weight) — or a square adjacency matrix.", plotKind: "chord", formats: ["edgelist", "multivariable"], seedColumns: ["Source", "Target", "Weight"] },
  { key: "oncoprint", label: "Oncoprint", note: "A genes × samples alteration matrix: genes down the rows (ordered by frequency), samples across the columns (staircase-sorted), each cell coloured by its alteration type. Reads an alterations sheet — one row per Sample · Gene · Alteration event.", plotKind: "oncoprint", formats: ["alterations"], seedColumns: ["Sample", "Gene", "Alteration"] },
  { key: "bubble", label: "Bubble", note: "XY where a third column sets each point's size.", plotKind: "bubble", formats: ["xy"], errorCapable: true, seedColumns: ["X", "Y1", "Size"] },
  { key: "histogram", label: "Histogram", note: "Frequency distribution of one variable's values.", plotKind: "histogram", formats: ["column", "xy"] },
  // ── Distributions, 3-D & specialty ──
  { key: "radar", label: "Radar / spider", note: "Compare several metrics across a few series.", plotKind: "radar", formats: ["column", "grouped"] },
  { key: "parallel", label: "Parallel coordinates", note: "Multivariate patterns — each numeric column an axis, each row a line.", plotKind: "parallel", formats: ["multivariable", "grouped", "xy"] },
  { key: "scatter3d", label: "3D scatter", note: "Three numeric coordinates per point (X · Y · Z).", plotKind: "scatter3d", formats: ["multivariable", "xy"], seedColumnsByFormat: { xy: ["X", "Y", "Z"] } },
  { key: "ridgeline", label: "Ridgeline / joyplot", note: "Compare a distribution's shape across many groups.", plotKind: "ridgeline", formats: ["column", "grouped"] },
  { key: "lollipop", label: "Lollipop / dumbbell", note: "Value per category, or a before→after change.", plotKind: "lollipop", formats: ["column", "xy"], errorCapable: true },
  { key: "paireddot", label: "Paired dot plot", note: "Two values per category as dots on a shared row; group rows into labelled sections with a text column.", plotKind: "paireddot", formats: ["xy", "column", "grouped"] },
  // ── Drawn straight from the data ──
  { key: "volcano", label: "Volcano", note: "log2 fold-change (X) vs −log10 p (Y); points coloured up / down / not significant with threshold guides.", plotKind: "volcano", formats: ["xy"], seedColumns: ["log2 fold-change", "-log10 p"] },
  { key: "forest", label: "Forest plot", note: "One row per study: estimate with its CI whisker, a no-effect line and an optional pooled summary — meta-analysis.", plotKind: "forest", formats: ["meta", "column"], seedColumns: ["Study", "Estimate", "Lower", "Upper"] },
  { key: "funnel", label: "Funnel plot", note: "Publication-bias check for a meta-analysis: each study at (effect, standard error) with a pseudo-CI funnel — same columns as the forest plot.", plotKind: "funnel", formats: ["meta", "column"], seedColumns: ["Study", "Estimate", "Lower", "Upper"] },
  { key: "venn", label: "Venn / Euler diagram", note: "Overlap counts between 2–3 sets from a membership sheet: row = item, one column per set, any non-empty non-zero cell = member. Area-proportional on demand.", plotKind: "venn", formats: ["sets"] },
  { key: "upset", label: "UpSet plot", note: "Set overlaps past what a Venn can draw: intersection-size bars + the membership dot matrix, any number of sets — same membership sheet as the Venn.", plotKind: "upset", formats: ["sets"], seedColumns: ["Item", "Set A", "Set B", "Set C", "Set D"] },
  { key: "swimmer", label: "Swimmer plot", note: "One bar per subject from Start to End: response interval inside the bar, an Ongoing arrow, and every further numeric column as an event-glyph series.", plotKind: "swimmer", formats: ["timeline", "column"], seedColumns: ["Subject", "Start", "End", "Response start", "Response end", "Ongoing"] },
  { key: "ternary", label: "Ternary plot", note: "Three-part compositions (the first three value columns, normalized per row) as points in an equilateral triangle — soil textures, phase diagrams, mixture designs.", plotKind: "ternary", formats: ["multivariable", "column"], seedColumns: ["Sample", "A (%)", "B (%)", "C (%)"], seedRoles: ["x", "y", "y", "y"] },
  { key: "rose", label: "Polar histogram / wind rose", note: "One angle column (degrees) binned into equal sectors, each count a wedge from the centre; an optional magnitude column stacks the wedges into bands — the wind rose.", plotKind: "rose", formats: ["column", "xy"], seedColumns: ["Observation", "Direction (°)", "Speed"] },
  { key: "tracks", label: "Timeline tracks", note: "Stacked tile strips over one shared time axis: a Time column, then one column per track — a numeric column ramps on its own scale, a text column becomes a categorical strip. Built to stack above another time-axis chart.", plotKind: "tracks", formats: ["xy", "multivariable"], seedColumns: ["Time", "Diet", "Shannon diversity", "Bacteroides (%)"] },
  { key: "qq", label: "QQ plot", note: "GWAS quantile-quantile: observed vs expected −log10 p-values against the uniform null, a y = x line and the genomic inflation factor λ. Reads the P-value column of an association-results sheet.", plotKind: "qq", formats: ["association", "multivariable"], seedColumns: ["Marker", "Chromosome", "Position", "P-value"] },
  { key: "manhattan", label: "Manhattan plot", note: "GWAS genome-wide association: −log10 p for every marker along the genome (chromosomes laid end to end, shaded in alternating tones), with the genome-wide (5×10⁻⁸) and suggestive significance lines. Reads Marker · Chromosome · Position · P-value from an association-results sheet.", plotKind: "manhattan", formats: ["association"], seedColumns: ["Marker", "Chromosome", "Position", "P-value"] },
  {
    key: "waterfall",
    label: "Waterfall (response)",
    note: "Per-patient best % change as bars sorted largest-first around a zero baseline, with the −30% response and +20% progression zones — early-phase oncology's standard figure. An ordinary bar chart underneath: every bar control applies.",
    plotKind: "bar",
    formats: ["column"],
    seedColumns: ["Patient", "Change %"],
    plotPatch: {
      barSort: "desc",
      // The RECIST zones, anchored to axis values so they track zoom/scale like reference
      // lines do. Partial response below −30, progressive disease above +20.
      annotations: [
        { id: "wf-pr", kind: "hband", bandLo: -100, bandHi: -30, fill: "#2f9e44", fillOpacity: 0.08, label: "Response" },
        { id: "wf-pd", kind: "hband", bandLo: 20, bandHi: 100, fill: "#e03131", fillOpacity: 0.07, label: "Progression" },
      ],
    },
  },
  {
    key: "pareto",
    label: "Pareto",
    note: "Counts by category as bars sorted largest-first, with the running total as a % line on a right-hand axis — which few causes account for most of the whole. It is an ordinary bar chart with Sort bars and the cumulative % line turned on.",
    plotKind: "bar",
    formats: ["column"],
    seedColumns: ["Cause", "Count"],
    plotPatch: {
      barSort: "desc",
      paretoLine: true,
      showBarPoints: false,
    },
  },
  {
    key: "abundance",
    label: "Relative abundance (stacked)",
    note: "Each group as a 100%-stacked bar — every column normalised to shares of a whole — with translucent ribbons tracing each stratum (taxon, cell type, clone) into the next bar. An ordinary bar chart underneath: every bar control applies.",
    plotKind: "bar",
    formats: ["grouped", "column"],
    seedColumns: ["Group", "Taxon A", "Taxon B", "Taxon C"],
    plotPatch: {
      barLayout: "percent",
      barRibbons: true,
      yAxis: { title: "Relative abundance (%)" },
    },
  },
  { key: "blandaltman", label: "Bland-Altman", note: "Method agreement: difference vs mean of two measurements per subject, with bias and limits of agreement.", plotKind: "blandaltman", formats: ["column"], seedColumns: ["Subject", "Method A", "Method B"] },
  { key: "dendrogram", label: "Dendrogram (clustering)", note: "Hierarchical-clustering tree of the rows (or columns) of a labelled matrix — which profiles group, and how tightly.", plotKind: "dendrogram", formats: ["grouped", "column", "multivariable"] },
  // ── Drawn from an analysis result: Create opens Analyze pre-set on the sheet ──
  { key: "pcascore", label: "Ordination — sites", note: "Every case as a point on two ordination axes, coloured by group with confidence ellipses. Made by Analyze ▸ PCA, PCoA, NMDS or correspondence analysis; a CA or an ordination that placed its variables draws them here too.", plotKind: "pcascore", formats: ["pca", "multivariable"], analysis: "pca" },
  { key: "pcaload", label: "Ordination — variables", note: "Each variable as a vector from the origin — a PCA loading. Made by Analyze ▸ PCA (“PCA graph suite”); the distance-based ordinations have no loadings to draw.", plotKind: "pcaload", formats: ["pca", "multivariable"], analysis: "pca" },
  { key: "pcabiplot", label: "Ordination — biplot", note: "Cases and the variable vectors that drive them, on one graph. Made by Analyze ▸ PCA (“PCA graph suite”).", plotKind: "pcabiplot", formats: ["pca", "multivariable"], analysis: "pca" },
  { key: "triplot", label: "Ordination — triplot", note: "A constrained ordination in one picture: the cases, the response variables as points, and the explanatory ones as arrows (a factor level as a centroid). Made by Analyze ▸ redundancy analysis.", plotKind: "triplot", formats: ["pca", "multivariable"], analysis: "rda" },
  { key: "scree", label: "Scree plot", note: "Variance (or inertia) explained per axis — the elbow that says how many to keep. Made by Analyze ▸ PCA, PCoA or correspondence analysis.", plotKind: "scree", formats: ["pca", "multivariable"], analysis: "pca" },
  { key: "roc", label: "ROC curve", note: "Sensitivity vs 1 − specificity for a score against a 0/1 outcome, with the AUC. Made by Analyze ▸ ROC.", plotKind: "roc", formats: ["xy", "column"], analysis: "roc" },
];

/** Look up a genre by its key. */
export function genreByKey(key: string): NewGraphGenre | undefined {
  return NEW_GRAPH_GENRES.find((g) => g.key === key);
}

/** The default (best) format for a genre — its first compatible table kind. */
export function defaultFormat(genre: NewGraphGenre): TableKind {
  return genre.formats[0]!;
}

/**
 * The order the "Suggested graphs" grid lists a format's compatible genres — the first is
 * the pre-selected suggestion. Default: catalogue order. A format listed here puts these
 * keys first, in this order; the rest follow in catalogue order.
 *
 * multivariable: a Multiple-variables sheet is typically a text grouping
 * column + several numeric measures per case (the demo: cell types × Size / Granularity /
 * Markers). Parallel coordinates draws exactly that (each column an axis, each row a line);
 * a correlation matrix and a 3-D scatter come next. A heatmap needs the text column tagged
 * as row labels first and read as an empty grey column otherwise, so it drops behind them.
 */
export const SUGGESTION_ORDER: Partial<Record<TableKind, readonly string[]>> = {
  multivariable: ["parallel", "corrmatrix", "scatter3d", "heatmap"],
  // A PCA / ordination sheet offers the PCA graphs only — the score plot
  // (pre-selected), then biplot, loadings and scree. Its whole reason to be a distinct format is
  // that New-graph goes straight to PCA, never XY and never the wider multivariable graph set.
  // The triplot sits after the biplot: it is the same picture with a third family, and it
  // needs a constrained analysis behind it, so it should not lead.
  pca: ["pcascore", "pcabiplot", "triplot", "pcaload", "scree"],
};

/** Is this column text in practice — fewer than half its filled cells parse as numbers? */
export function isTextColumn(table: DataTable, colId: NodeId): boolean {
  const col = table.columns.find((c) => c.id === colId);
  if (col?.type === "text" || col?.type === "categorical") return true;
  if (col?.type === "number" || col?.type === "date" || col?.type === "elapsed") return false;
  let filled = 0;
  let numeric = 0;
  for (const r of table.rows) {
    const v = r.cells[colId];
    if (v === undefined || v === null || v === "") continue;
    filled++;
    if (typeof v === "number" ? Number.isFinite(v) : Number.isFinite(Number(String(v).trim())) && String(v).trim() !== "") numeric++;
  }
  return filled > 0 && numeric < filled / 2;
}

/**
 * Data-aware first choices — what the format alone cannot say. An `xy` sheet whose first
 * (X) column is text is not a scatter at all: with two or more text columns and numbers after
 * them it is an edge list (source · target · weight — the demo's "Immune signaling") → network;
 * with exactly one text column and numbers after it it is a labelled matrix (genes ×
 * conditions — the demo's "Gene expression") → heatmap. Returns genre keys to put first,
 * or [] when the format's own order stands.
 *
 * A matrix has unique row labels. Repeated X labels are long-format data (location · date ·
 * counts, one row per observation) — a 700×6 heatmap of that is not a suggestion, so no
 * promotion there.
 */
export function dataAwareFirst(table: DataTable): string[] {
  if (table.kind !== "xy" || table.columns.length < 2 || table.rows.length === 0) return [];
  const x = xColumn(table);
  if (!x || !isTextColumn(table, x.id)) return [];
  const textCols = table.columns.filter((c) => isTextColumn(table, c.id));
  const numericCols = table.columns.filter((c) => !isTextColumn(table, c.id));
  if (numericCols.length === 0) return [];
  if (textCols.length >= 2) return ["network"];
  const labels = table.rows.map((r) => String(r.cells[x.id] ?? "").trim()).filter((s) => s !== "");
  if (new Set(labels).size !== labels.length) return [];
  return ["heatmap"];
}

/**
 * Does the scene put anything on the page? A builder that has nothing to place does not always
 * say so — xy / area / bar / before-after / pyramid build a warning-free empty frame from an
 * all-text or 0-row sheet, a correlation matrix / heatmap of text columns is a grid of null
 * cells. "No warning" is therefore only half of "draws"; this is the other half.
 * Ink = a series with marks or a path, a finite heatmap / correlation cell, or a non-empty
 * node / line / point / slice / cell / row list on the kind-specific scene block.
 */
export function hasInk(scene: PlotScene): boolean {
  // The rule itself lives in graphics (`sceneHasInk`) so the build choke point can apply it too;
  // this wrapper serves the wizard's callers and tests.
  return sceneHasInk(scene);
}

/**
 * Does this genre draw the table without a builder warning? The builders warn when a
 * kind cannot place what it was given ("No finite data points to plot", "Bubble chart needs a
 * 2nd Y column…"), so a warned scene is one the user would open to an empty or half frame.
 * Used to rank the suggestion grid when a real sheet is in hand; a throw counts as "no".
 * And the scene must have ink (`hasInk`): a silent builder that placed nothing is not "clean".
 */
export function drawsCleanly(table: DataTable, genre: NewGraphGenre): boolean {
  const plot: Plot = { id: "__suggest", name: genre.label, source: table.id, kind: genre.plotKind, ...(genre.plotPatch ?? {}) } as Plot;
  try {
    const scene = buildPlotScene(table, plot, { width: 600, height: 400 });
    return (scene.warnings ?? []).length === 0 && hasInk(scene);
  } catch {
    return false;
  }
}

/**
 * The rows the clean-rank is measured on. Ranking is a look, not a render: the first 200 rows
 * say whether a genre draws this sheet, while building 20+ genres on a large sheet would take
 * seconds, most of it in network's force layout, which is O(iterations × n²).
 */
export const RANK_ROW_CAP = 200;

/**
 * Genres compatible with a datasheet format, in suggestion order — the first is the card the
 * dialog pre-selects, so this order is a recommendation. With no table: the format's SUGGESTION_ORDER,
 * then catalogue order. With the open table in hand, three data-aware ranks come first
 * (the format alone can pre-select a card that cannot draw the sheet): `dataAwareFirst` (text-X xy → network / heatmap), then genres that draw the sheet
 * without a builder warning before those that warn, then the format order as the tie-break.
 */
export function suggestedGenres(kind: TableKind, table?: DataTable): NewGraphGenre[] {
  const compat = NEW_GRAPH_GENRES.filter((g) => g.formats.includes(kind));
  const first = SUGGESTION_ORDER[kind] ?? [];
  const formatRank = (g: NewGraphGenre): number => { const i = first.indexOf(g.key); return i < 0 ? first.length : i; };
  if (!table || table.kind !== kind) {
    return [...compat].sort((a, b) => formatRank(a) - formatRank(b) || compat.indexOf(a) - compat.indexOf(b));
  }
  const pref = dataAwareFirst(table);
  const prefRank = (g: NewGraphGenre): number => { const i = pref.indexOf(g.key); return i < 0 ? pref.length : i; };
  // Clean-rank on a row-capped head; network is not built here — `dataAwareFirst` already
  // decides it (an edge list → clean, anything else → not), and its force layout is the whole
  // cost.
  const head: DataTable = table.rows.length > RANK_ROW_CAP ? { ...table, rows: table.rows.slice(0, RANK_ROW_CAP) } : table;
  // An analysis-fed genre (PCA / ROC / survival) never draws from the raw sheet — it opens Analyze,
  // which then makes the graph — so "does it draw the sheet now" is the wrong question for it. But
  // only treat it as clean when this format deliberately promotes it (it is in the format's
  // SUGGESTION_ORDER); otherwise it stays a warned candidate ranked last. This
  // is what lets a PCA sheet pre-select the PCA score plot without promoting ROC on a stray xy sheet.
  const promoted = new Set(first);
  const clean = new Map(compat.map((g) => [g.key,
    g.analysis && promoted.has(g.key) ? true
    : g.key === "network" ? pref.includes("network")
    : drawsCleanly(head, g)] as const));
  const cleanRank = (g: NewGraphGenre): number => (clean.get(g.key) ? 0 : 1);
  return [...compat].sort(
    (a, b) => prefRank(a) - prefRank(b) || cleanRank(a) - cleanRank(b) || formatRank(a) - formatRank(b) || compat.indexOf(a) - compat.indexOf(b),
  );
}

/**
 * What the New-Graph dialog resolves to on confirm. `genre` keys the catalog
 * (which supplies the plot kind + any plot patch); `tableKind` is the chosen
 * compatible format; the rest configure the seed table's replicate / error shape.
 */
/**
 * Where a newly-created datasheet (+ its graph) should be filed in the workspace
 * side tree. Absent — or resolving to no project — leaves the objects loose at the
 * top level. `newFolderName` creates the project first;
 * `newExperimentName` creates an experiment under the chosen/created project.
 * A `folderId`/`experimentId` names an existing node. See `fileCreatedGraph`.
 */
export interface NewGraphDest {
  /** Existing project (folder) to file under. Ignored when `newFolderName` is set. */
  folderId?: NodeId | undefined;
  /** Create a new project with this name and file under it. */
  newFolderName?: string | undefined;
  /** Existing experiment (within `folderId`) to file under. */
  experimentId?: NodeId | undefined;
  /** Create a new experiment (under the chosen/created project) and file under it. */
  newExperimentName?: string | undefined;
}

export interface NewGraphSpec {
  /** What to create: a datasheet + graph (default) or just a blank datasheet. */
  output?: "graph" | "table";
  /**
   * Graph an existing datasheet instead of creating a new one — the id of the open table.
   * The dialog offers this (and defaults to it) when it was opened from a datasheet whose
   * format the chosen graph accepts, so "suggested graphs for this datasheet" and the
   * "Your data" badge draw that sheet rather than a new, empty one. With this set: no table is created,
   * `tableKind` / `entryMode` / `replicates` / `sampleData` / `xColumnType` / `dest` are
   * ignored, and the plot is filed beside its source.
   */
  sourceTableId?: NodeId;
  /** The genre is drawn from an analysis result (genre.analysis): the method to open Analyze on.
   *  With `sourceTableId` the dialog closes and Analyze opens pre-set on that sheet; without one
   *  the blank sheet is created and opened, and the log says to run the analysis on it. */
  analysis?: string;
  /** NEW_GRAPH_GENRES key. Optional for a table-only create (no graph). */
  genre?: string;
  /** Chosen compatible table format. */
  tableKind: TableKind;
  /** How Y is entered: raw replicates or a pre-computed summary format. Default "replicates". */
  entryMode?: EntryMode;
  /** Replicate subcolumns per dataset (when `entryMode` is "replicates"). Default 1. */
  replicates?: number;
  /** Error-bar display type for the plot's series (errorCapable genres). Default "sd". */
  errorBars?: ErrorBarType;
  /** Whisker/spread definition for box · violin · raincloud (incl. mean ± SD/SEM/CI). */
  boxWhisker?: BoxWhisker;
  /** Start with the genre's ready-made sample dataset instead of a blank datasheet
   *  (graph mode only, when a sample exists). */
  sampleData?: boolean;
  /** X-column type for an XY datasheet — "date" / "elapsed" format the X axis as
   *  dates / h:mm:ss. Default numeric. */
  xColumnType?: ColumnType;
  /** Override the created table's name. */
  tableName?: string;
  /** Override the created plot's name. */
  plotName?: string;
  /** Where to file the new datasheet + graph in the workspace tree. Default: loose. */
  dest?: NewGraphDest;
}

/** Summary entry modes imply their own error-bar type; replicates honour the choice
 *  (falling back to the caller-supplied default when the spec doesn't name one). */
function effectiveError(spec: NewGraphSpec, fallback: ErrorBarType = "sd"): ErrorBarType {
  switch (spec.entryMode) {
    case "mean-sd-n":
    case "mean-sd":
    case "mean-cv-n":
      return "sd";
    case "mean-sem-n":
    case "mean-sem":
      return "sem";
    case "mean-err":
    case "mean-limits":
      return "asymmetric";
    case "mean-range":
      return "range";
    case "median-iqr":
      return "iqr";
    case "geomean-sd":
      return "geoSd";
    case "mean-ci":
      return "ci95";
    case "box-values":
      return "iqr"; // on an error-bar graph a box-values dataset draws its IQR
    default:
      return spec.errorBars ?? fallback;
  }
}

/**
 * Create a new datasheet (+ graph) from a dialog spec, through the real document
 * methods (one seed table of the chosen format + its replicate / entry shape; then,
 * unless `output` is "table", a plot of the genre's kind with the chosen error bars).
 * Returns the created `{ table, plot? }` — the caller opens it and recomputes. Every
 * mutation is undoable.
 */
/**
 * Write the chosen error-bar type onto the datasets of a table that already holds data — the open
 * datasheet, or a ready-made sample. Shared by both paths so they can never disagree.
 *
 * The table's real entry format decides the type (a Median+IQR sheet cannot draw "Mean ± SD"); the
 * dialog's own entry-mode state describes a sheet that was never made. And it writes per dataset
 * only what that dataset can draw — a replicate sheet with one value per row, or a summary sheet,
 * keeps the builder's natural default instead of a type that would warn "can't be computed … no
 * error bars drawn".
 */
function applyErrorBarsToData(doc: MadyDocument, plotId: Plot["id"], table: DataTable, spec: NewGraphSpec): void {
  const err = effectiveError({ ...spec, entryMode: tableEntryMode(table) }, getAppDefaults().errorBars ?? "sd");
  if (err === "none") return;
  for (const ds of tableDatasets(table)) {
    if (drawableErrorTypes(ds).includes(err)) doc.setErrorBars(plotId, ds.id, { errorBars: err });
  }
}

export function createNewGraph(doc: MadyDocument, spec: NewGraphSpec): { table: DataTable; plot?: Plot | undefined } {
  const genre = genreByKey(spec.genre ?? "");

  // Graph the open datasheet: no new table, the plot goes on the existing one (and is filed
  // beside it, where "New graph of this data" puts one). Everything table-shaped in the spec
  // is moot here — the data already has its shape.
  if (spec.sourceTableId && spec.output !== "table") {
    const table = doc.toJSON().tables.find((t) => t.id === spec.sourceTableId);
    if (!table) throw new Error(`The datasheet to graph was not found (${spec.sourceTableId}).`);
    const plot = doc.addPlot(spec.plotName ?? genre?.label ?? "Graph", table.id);
    if (genre?.plotKind) doc.setPlotKind(plot.id, genre.plotKind);
    if (genre?.plotPatch) doc.setPlotOptions(plot.id, genre.plotPatch);
    if (genre?.errorCapable) applyErrorBarsToData(doc, plot.id, table, spec);
    if (spec.boxWhisker) doc.setBoxWhisker(plot.id, spec.boxWhisker);
    doc.fileObject({ kind: "plot", id: plot.id }, doc.locationOf({ kind: "table", id: table.id }));
    return { table, plot };
  }

  // Start with sample data (graph mode): drop in the genre's ready-made example
  // {table, plot} — insertGraph remaps all ids in one undoable command.
  if (spec.sampleData && spec.output !== "table" && spec.genre) {
    // The sample follows the chosen format: a "Bar / column" graph on the grouped format seeds the
    // grouped example, on a simple column format the one-bar-per-group example.
    const item = sampleFor(spec.genre, spec.tableKind);
    if (item) {
      const made = doc.insertGraph(item.table, item.plot, spec.plotName ?? item.title);
      // The sample brings its own data, but every choice in the wizard still applies to it.
      // Note: `made.*`, not `item.*` — insertGraph remaps every id.
      //
      // Shape first (it rebuilds the columns, so it must run before anything keyed on dataset id).
      // Both document methods keep each dataset's lead column and its values and add the extra
      // sub-columns empty, so the worked example survives — all 7 rows of the XY sample stay
      // intact at 1/3/5 replicates and in mean-sd / mean-sem-n. Skipped entirely when the
      // pick already matches the sample, so an untouched control never restructures anything.
      const wantMode = spec.entryMode;
      if (wantMode && wantMode !== "replicates") {
        if (wantMode !== tableEntryMode(made.table)) doc.setEntryMode(made.table.id, wantMode);
      } else if (spec.replicates != null && spec.replicates !== replicateCount(made.table)) {
        doc.setReplicateCount(made.table.id, spec.replicates);
      }
      // Re-read: the shape change rebuilt the column list, so the snapshot above is stale.
      const table = doc.toJSON().tables.find((t) => t.id === made.table.id) ?? made.table;
      // Then what the error bars / whiskers mean — the same way the open-sheet path does it. Only
      // when asked: with no pick, the sample keeps the styling it ships with.
      if (genre?.errorCapable && spec.errorBars) applyErrorBarsToData(doc, made.plot.id, table, spec);
      if (spec.boxWhisker) doc.setBoxWhisker(made.plot.id, spec.boxWhisker);
      return { table, plot: made.plot };
    }
  }

  const kind = spec.tableKind;
  const fmt = tableFormat(kind);
  // The genre may need a shape the format's seed lacks (bubble: a Size dataset). A genre seed
  // (bubble/volcano/forest/blandaltman) carries its own labelled lead untagged; otherwise the
  // format's seed + roles apply (the column format is lead-less, tagged "y", so a simple column
  // sheet is just its group columns).
  // The genre's own seed applies on every format the genre lists, not only its first: otherwise
  // picking the second format would open a warned or empty graph on the format's generic seed.
  // A genre without seed columns keeps the format's seed.
  const byFormat = genre?.seedColumnsByFormat?.[kind];
  const useGenreSeed = !byFormat && !!genre?.seedColumns && !!genre.formats.includes(kind);
  const seed = byFormat ?? (useGenreSeed ? genre!.seedColumns! : fmt.seedColumns);
  const roles = byFormat ? genre?.seedRolesByFormat?.[kind] : useGenreSeed ? genre!.seedRoles : fmt.seedRoles;
  const table = doc.addTable(spec.tableName ?? genre?.label ?? fmt.label, kind, [...seed], roles);

  // Replicate structure / entry mode — only meaningful for replicate-capable formats.
  if (fmt.replicates) {
    if (spec.entryMode && spec.entryMode !== "replicates") {
      doc.setEntryMode(table.id, spec.entryMode);
    } else {
      const n = Math.max(1, Math.floor(spec.replicates ?? 1));
      if (n > 1) doc.setReplicateCount(table.id, n);
    }
  }

  // X-axis column type (date / elapsed) → the XY datasheet's X column formats + its axis.
  if (spec.xColumnType && spec.xColumnType !== "number" && kind === "xy") {
    const xc = xColumn(table);
    if (xc) doc.setColumnType(table.id, xc.id, spec.xColumnType);
  }

  // Table-only: no graph. An analysis-fed genre with no open sheet is table-only too — an
  // empty PCA / ROC / survival frame would be the dead end this whole flow exists to avoid;
  // the caller opens the sheet and says which analysis to run on it.
  if (spec.output === "table" || spec.analysis) return { table, plot: undefined };

  const plot = doc.addPlot(spec.plotName ?? genre?.label ?? "Graph", table.id);
  if (genre?.plotKind) doc.setPlotKind(plot.id, genre.plotKind);
  if (genre?.plotPatch) doc.setPlotOptions(plot.id, genre.plotPatch);

  // Error-bar display type on every dataset series (only genres that draw them).
  if (genre?.errorCapable) {
    const err = effectiveError(spec, getAppDefaults().errorBars ?? "sd");
    if (err !== "none") {
      for (const ds of tableDatasets(table)) doc.setErrorBars(plot.id, ds.id, { errorBars: err });
    }
  }

  // Whisker/spread definition for the distribution graphs (box/violin/raincloud).
  if (spec.boxWhisker) doc.setBoxWhisker(plot.id, spec.boxWhisker);

  return { table, plot };
}

/**
 * Resolve a `NewGraphDest` to a concrete `WorkspaceTarget`, creating the project
 * and/or experiment first when the user asked for a new one. Returns `null` when
 * the destination is the top level (loose) — nothing needs filing then, because
 * `createNewGraph` already left the objects loose.
 */
function resolveDest(doc: MadyDocument, dest: NewGraphDest | undefined): WorkspaceTarget | null {
  if (!dest) return null;
  const newFolder = dest.newFolderName?.trim();
  const folderId: NodeId | undefined = newFolder ? doc.addFolder(newFolder).id : dest.folderId;
  if (!folderId) return null; // top level
  const newExp = dest.newExperimentName?.trim();
  const experimentId: NodeId | undefined = newExp
    ? doc.addExperiment(folderId, newExp).id
    : dest.experimentId;
  return experimentId
    ? { level: "experiment", folderId, experimentId }
    : { level: "folder", folderId };
}

/**
 * File a freshly-created datasheet (and its graph) into the chosen workspace
 * destination — creating the project/experiment first if the user picked "New…".
 * Both refs go to the same target so a graph and its source datasheet stay
 * together in the tree (the "family" model). No destination (or one that resolves
 * to no project) leaves them loose at the top level, the default.
 *
 * Uses the same public document commands the Navigator and gallery use
 * (`addFolder` / `addExperiment` / `fileObject`), so it never drifts from how the
 * tree is really built, and is unit-testable against a real in-memory document.
 */
export function fileCreatedGraph(
  doc: MadyDocument,
  refs: { table: DataTable; plot?: Plot | undefined },
  dest?: NewGraphDest | undefined,
): void {
  const target = resolveDest(doc, dest);
  if (!target) return; // loose — createNewGraph already filed them there
  doc.fileObject({ kind: "table", id: refs.table.id }, target);
  if (refs.plot) doc.fileObject({ kind: "plot", id: refs.plot.id }, target);
}
