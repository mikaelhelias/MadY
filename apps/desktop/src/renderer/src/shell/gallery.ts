/**
 * Chart gallery — one fit-for-purpose synthetic example per chart family, so each
 * graph type can be inspected on its own. Pure data (no document
 * mutation): each item is a throwaway DataTable + Plot fed straight to
 * buildPlotScene. **Maintain this list as new chart kinds are added.**
 */
import { findPreset, MadyDocument, planSignificanceBrackets, tableDatasets } from "@mady/core";
import type { CellValue, ColumnRole, DataTable, NodeId, PcaGraphData, Plot, PlotKind, Project, RocCurve, TableKind } from "@mady/core";
import { applyPresetWithKindDefaults } from "./seedStyle";
import { capturePlotStyle, SHARED_KEYS } from "./templates";
import { richCards } from "./showcase";

/**
 * Does a graph made from a gallery card earlier still look like that card does now?
 *
 * Reopening by name alone would make the gallery misleading as soon as a default changes: a
 * Y axis title added to the XY card appears on the card, but a click would hand back the graph
 * made from that card earlier, and a graph keeps the look it was created with. The card
 * promises "this is what you get", and a stale reopen breaks that promise silently.
 *
 * Compared over `SHARED_KEYS` (sizes, fonts, axes, grid, frame, legend, background, palette)
 * plus annotations and the significance options, which are as much part of the look: without
 * them, a bar graph whose brackets were removed would still count as the card. These are
 * gallery-only keys — the panel assembler's "match across panels" must never copy brackets
 * between graphs, so they are not part of `SHARED_KEYS`/`MATCH_KEYS`.
 * Note: `seriesStyles` is excluded — `insertGraph` gives the copy fresh column ids, so those
 * keys can never match and every click would fork a duplicate. Annotations are safe:
 * `insertGraph` copies them verbatim, ids included.
 *
 * A graph that no longer matches is restyled in place, never forked. Leaving a non-matching
 * copy alone and making a fresh one would duplicate both the datasheet and the graph each time
 * a preset-restyled card graph is clicked again. There is no reason to copy the data or the
 * graph; `applyCardLook` below restyles the current graph, so a card click still means "give me
 * the current default" without creating copies.
 */
const GALLERY_LOOK_KEYS: (keyof Plot)[] = [...SHARED_KEYS, "annotations", "significance", "significanceControl"];
export function sameGalleryLook(stored: Plot, card: Plot): boolean {
  return JSON.stringify(capturePlotStyle(stored, GALLERY_LOOK_KEYS)) === JSON.stringify(capturePlotStyle(card, GALLERY_LOOK_KEYS));
}

/**
 * Restyle an existing card-made graph back to the card's current look, in place.
 *
 * Two halves, because `insertGraph` gave the copy fresh column ids:
 *   • the plot-level look (`GALLERY_LOOK_KEYS`: fonts/axes/grid/frame/sizes/legend/
 *     annotations/significance) — applied as one deep-cloned patch;
 *   • the per-series styles — mapped from the card's datasets to the copy's by position,
 *     since the ids can never match (the same reason `sameGalleryLook` skips them).
 * Every mutation goes through the document's own undoable methods.
 */
export function applyCardLook(
  doc: MadyDocument,
  plotId: string,
  copySource: DataTable,
  card: { table: DataTable; plot: Plot },
): void {
  const patch = JSON.parse(JSON.stringify(capturePlotStyle(card.plot, GALLERY_LOOK_KEYS))) as Partial<Plot>;
  doc.setPlotOptions(plotId, patch);
  const src = tableDatasets(card.table);
  const dst = tableDatasets(copySource);
  src.forEach((ds, i) => {
    const style = card.plot.seriesStyles?.[ds.id];
    const target = dst[i];
    if (style && target) doc.setSeriesStyle(plotId, target.id, JSON.parse(JSON.stringify(style)) as typeof style);
  });
}

/**
 * The gallery's sections, in display order. A card is filed under exactly one of them
 * (`GALLERY_ORDER`); the pane draws one heading per family. `gallery-families.test` refuses an
 * unfiled card, an empty family, and a listed key with no card.
 */
export const GALLERY_FAMILIES = [
  "XY & continuous",
  "Bars & columns",
  "Distributions & paired comparisons",
  "Parts of a whole, hierarchy & sets",
  "Matrix, multivariable & networks",
  "Clinical, time-to-event & meta-analysis",
  "Genomics",
  "Ordination (PCA / PCoA)",
] as const;
export type GalleryFamily = (typeof GALLERY_FAMILIES)[number];

/**
 * Card key → family, and the display order within each family. The canonical card of a kind
 * (plain XY, the bracketed grouped bar, the plain histogram) leads its option-wearing siblings
 * (bump, Pareto, histogram + density): several tests take "the first card of kind X" and mean
 * the canonical one — `gallery-families.test` pins those three.
 */
export const GALLERY_ORDER: Record<GalleryFamily, readonly string[]> = {
  // "timecourse", "stream", "rankeddots", "stackline" and "bubblegrid" are additional cards:
  // each shows a combination its kind's plain card does not, and each sits right after the
  // plain card it extends, never before it.
  "XY & continuous": ["xy", "twosheets", "timecourse", "bump", "area", "stream", "bubble"],
  "Bars & columns": ["bar", "columnbar", "barline", "stackline", "pareto", "waterfall", "abundance", "pyramid", "lollipop", "rankeddots"],
  "Distributions & paired comparisons": ["box", "violin", "scatter", "raincloud", "floatingbar", "estimation", "histogram", "histdensity", "ridgeline", "rose", "beforeafter", "paireddot"],
  "Parts of a whole, hierarchy & sets": ["pie", "treemap", "sunburst", "ternary", "venn", "upset"],
  "Matrix, multivariable & networks": ["heatmap", "heatmapsplit", "bubblegrid", "corrmatrix", "parallel", "scatter3d", "radar", "dendrogram", "alluvial", "network", "chord"],
  "Clinical, time-to-event & meta-analysis": ["survival", "swimmer", "tracks", "forest", "funnel", "blandaltman", "roc"],
  "Genomics": ["volcano", "qq", "manhattan", "oncoprint"],
  "Ordination (PCA / PCoA)": ["pcascore", "pcaload", "pcabiplot", "triplot", "scree"],
};

/** File each card under its family and put the cards in GALLERY_ORDER. An unlisted card keeps
 *  `family` undefined and sinks to the end — visible, and failed by the guard. */
function fileByFamily(cards: Omit<GalleryItem, "family">[]): GalleryItem[] {
  const rank = new Map<string, { family: GalleryFamily; i: number }>();
  let i = 0;
  for (const family of GALLERY_FAMILIES) for (const key of GALLERY_ORDER[family]) rank.set(key, { family, i: i++ });
  return cards
    .map((c) => ({ ...c, family: rank.get(c.key)?.family as GalleryFamily }))
    .sort((a, b) => (rank.get(a.key)?.i ?? Infinity) - (rank.get(b.key)?.i ?? Infinity));
}

/**
 * Fixtures that show option-only drawables.
 *
 * Why this exists: the checks that click and drag every element enumerate gallery cards, and a
 * card shows a kind's default look. Anything that appears only when an option is switched on —
 * a heatmap split, an annotation strip — is therefore invisible to both, so such a drawable can
 * ship without a click or a drag while every such check passes. A drawable those checks cannot
 * see is a drawable that is not being checked.
 *
 * Add a fixture here whenever an option draws something new. It is the cheapest way to put a
 * new drawable under the interaction rules (clickable · editable · draggable · opens its own
 * section) without changing what a gallery card looks like.
 */
export function optionDrawables(): { title: string; table: DataTable; plot: Plot }[] {
  const table: DataTable = {
    id: "opt-hm", kind: "xy", name: "Split heatmap",
    columns: [
      { id: "g", name: "Gene" }, { id: "grp", name: "Group" }, { id: "pur", name: "Purity" },
      { id: "c0", name: "S1" }, { id: "c1", name: "S2" }, { id: "c2", name: "S3" }, { id: "c3", name: "S4" },
    ],
    rows: ["G1", "G2", "G3", "G4", "G5", "G6"].map((g, i) => ({
      id: `r${i}`,
      cells: { g, grp: i < 3 ? "Ctrl" : "Treated", pur: 20 + i * 7, c0: i + 1, c1: i + 2, c2: (i % 3) + 1, c3: i + 4 },
    })),
  };
  // Icon array (pie → Waffle + Cells as shapes + one cell per observation): the cells become marker
  // shapes over see-through click targets, the legend keys become shapes, and a caption under the
  // grid says what one icon is — nothing a gallery card shows.
  const icons: DataTable = {
    id: "opt-icons", kind: "partsofwhole", name: "Icon array",
    columns: [{ id: "cat", name: "Group", role: "x" }, { id: "n", name: "Patients" }],
    rows: [
      { id: "ri0", cells: { cat: "Responded", n: 46 } },
      { id: "ri1", cells: { cat: "Stable", n: 31 } },
      { id: "ri2", cells: { cat: "Progressed", n: 17 } },
      // Two small groups, combined into "Other" by waffleMaxGroups: 3.
      { id: "ri3", cells: { cat: "Withdrew", n: 4 } },
      { id: "ri4", cells: { cat: "Lost to follow-up", n: 2 } },
    ],
  };
  // Notched boxes (`SeriesStyle.boxNotch`): the box becomes a notched outline — a different shape from the plain box
  // every gallery card draws.
  const notchT = distributionTable("opt-notch");
  const notchStyles = Object.fromEntries(notchT.columns.filter((c) => c.role !== "x").map((c) => [c.id, { boxNotch: true }]));
  // Box and violin with every point shown (Show all points): the swarm, and the Point spread that moves it, appear only
  // behind that switch.
  const pointsT = distributionTable("opt-dist-points");
  // Find & highlight (`SeriesStyle.highlightNames`): the found points are painted and labelled by name — labels that
  // exist only behind the option.
  const genesT: DataTable = {
    id: "opt-genes", kind: "xy", name: "Named samples",
    columns: [{ id: "x", name: "Dose", role: "x" }, { id: "y", name: "Response", role: "y" }, { id: "g", name: "Gene", type: "text" }],
    rows: ["TP53", "EGFR", "MYC", "KRAS", "BRCA1", "PTEN", "AKT1", "CDK4"].map((g, i) => ({ id: `rg${i}`, cells: { x: i + 1, y: ((i * 5) % 8) + 2, g } })),
  };
  return [{
    title: "Scatter with names found and highlighted",
    table: genesT,
    plot: { id: "opt-genes-p", name: "Highlighted names", source: genesT.id, status: "ok", styleOverrides: {}, kind: "xy", seriesStyles: { y: { highlightNames: ["MYC", "PTEN"] } } },
  }, {
    title: "Box plot with notches",
    table: notchT,
    plot: { id: "opt-notch-p", name: "Notched box", source: notchT.id, status: "ok", styleOverrides: {}, kind: "box", seriesStyles: notchStyles },
  }, {
    title: "Box plot with every point shown",
    table: pointsT,
    plot: { id: "opt-box-points-p", name: "Box with points", source: pointsT.id, status: "ok", styleOverrides: {}, kind: "box", showBoxPoints: true },
  }, {
    title: "Violin with every point shown",
    table: pointsT,
    plot: { id: "opt-violin-points-p", name: "Violin with points", source: pointsT.id, status: "ok", styleOverrides: {}, kind: "violin", showBoxPoints: true },
  }, {
    title: "Waffle drawn as an icon array",
    table: icons,
    plot: {
      id: "opt-icons-p", name: "Icon array", source: icons.id, status: "ok", styleOverrides: {},
      // Counted: one icon per patient, so the caption under the grid is drawn too.
      kind: "pie", pieDisplay: "waffle", waffleIcons: true, waffleUnit: "count", waffleUnitName: "patient", waffleMaxGroups: 3,
    },
  }, {
    title: "Heatmap with splits + annotation strips",
    table,
    plot: {
      id: "opt-p", name: "Split heatmap", source: table.id, status: "ok", styleOverrides: {},
      kind: "heatmap",
      heatmap: {
        rowSplits: [{ at: 2, label: "Baseline" }],
        colSplits: [{ at: 1 }],
        splitStyle: "both",
        // Two row strips, one of each reading: a strip of words keys itself, a numeric one
        // draws a colour bar (its key). Only the numeric one puts that key drawable in front of
        // those checks — with a categorical fixture alone they cannot see it at all.
        rowTracks: [{ column: "grp", name: "Group" }, { column: "pur", name: "Purity" }],
        colTracks: [{ name: "Batch", values: { c0: "A", c1: "A", c2: "B", c3: "B" } }],
      },
    },
  }];
}

export interface GalleryItem {
  key: string;
  title: string;
  /** One-line "when to use this chart". */
  note: string;
  /** The gallery section this card is listed under (see GALLERY_FAMILIES). */
  family: GalleryFamily;
  table: DataTable;
  plot: Plot;
  /** Further datasheets the card ships because its plot borrows series from them
   *  (`plot.overlays`). Inserted with the card, ids remapped together. */
  extraTables?: DataTable[] | undefined;
}

/** Table lookup for a card's scene: its own sheet plus any it ships for overlays. */
export function galleryLookup(it: { table: DataTable; extraTables?: DataTable[] | undefined }): (id: NodeId) => DataTable | undefined {
  return (id) => (it.table.id === id ? it.table : it.extraTables?.find((t) => t.id === id));
}

interface Col {
  id: string;
  name: string;
  role?: ColumnRole;
  group?: string;
}

// Caution: pass the right `kind`. A demo card is opened as a real editable graph (and its
// datasheet) when a user clicks it, so the fixture's `kind` becomes the user's table kind. It
// also drives the datasheet's format badge + `validateTable`. A categorical-X chart (bar,
// forest, radar, heatmap, …) left at the "xy" default is a table claiming to be XY, which makes
// validateTable demand a numeric X and show a false "The X column should be numeric" warning.
// Match the kind the New-Graph wizard would assign (see GENRES.formats).
function mkTable(id: string, cols: Col[], rows: CellValue[][], kind: TableKind = "xy"): DataTable {
  return {
    id,
    kind,
    name: id,
    columns: cols.map((c) => ({
      id: c.id,
      name: c.name,
      ...(c.role ? { role: c.role } : {}),
      ...(c.group ? { group: c.group } : {}),
    })),
    rows: rows.map((r, i) => ({
      id: `${id}-r${i}`,
      cells: Object.fromEntries(cols.map((c, j) => [c.id, r[j] ?? null])),
    })),
  };
}

/**
 * The value axis needs a name, and seven demo tables would otherwise leave it without one.
 * A builder auto-names the value axis only when there is exactly one series (it borrows that
 * series' name); with two or more it stays blank on purpose, because the legend is what names
 * them and a title would have to be invented. XY, bar and the five distribution cards all have
 * two or three series, so without these titles all seven draw a bare axis.
 *
 * These are fixtures, not behaviour: a card is the real figure scaled down (`GalleryPane`),
 * so a card with an unnamed value axis suggests that MadY draws unnamed axes. Nothing
 * about how a user's own graph resolves its titles changes here.
 */
const VALUE_AXIS = (title: string): Partial<Plot> => ({ yAxis: { title } });
/** The three-group distribution table is shared by box · violin · scatter · raincloud · floating bar. */
const DIST_UNITS = "Measurement (a.u.)";
/**
 * …and the category axis needs a name too. The category tick labels (Control · Low dose ·
 * High dose) say what each group is; they do not say what the groups are of. That axis has no
 * source column to borrow from either — the groups come from the Y column names — so nothing
 * can derive it, and it has to be stated.
 */
/**
 * A paired dot plot of twelve traits named "Educational attainment" and "Cannabis use disorder"
 * needs a wide figure; at the default type sizes it does not fit 580: the builder shortens the
 * row labels and says so, and a gallery card that emits a warning is a card previewing a
 * cramped figure. 800 is the first width at which every label is drawn in full. The card is
 * scaled into its slot either way, so this costs nothing on screen.
 */
const PAIRED_WIDE: Partial<Plot> = { figureWidth: 800 };

const DIST_AXES: Partial<Plot> = { yAxis: { title: DIST_UNITS }, xAxis: { title: "Treatment" } };

/** The title each plain card's graph is drawn with — what its sample data show. A card's own
 *  `name` in its patch wins. */
const CARD_TITLES: Record<string, string> = {
  "p-twosheets": "Measured points, fitted model",
  "p-bump": "Team rankings over five rounds",
  "p-area": "Signal over time",
  "p-bubble": "Life expectancy and income",
  "p-bar": "Expression by day, treated vs control",
  "p-columnbar": "Response by dose",
  "p-barline": "Monthly cases and positivity",
  "p-pareto": "Defects by cause",
  "p-waterfall": "Best response per patient",
  "p-abundance": "Gut community by group",
  "p-pyramid": "Population by age band",
  "p-lol": "Metrics, 2023 vs 2024",
  "p-box": "Spread of a measurement by treatment",
  "p-violin": "Shape of each group's values",
  "p-scatter": "Every replicate, by treatment",
  "p-floatbar": "Range of each group",
  "p-est": "Mean difference and its 95% CI",
  "p-hist": "Distribution of a measurement",
  "p-histdens": "Reaction times",
  "p-rose": "Wind direction and speed",
  "p-ba": "Before and after, per subject",
  "p-paired": "Heritability: family studies vs GWAS",
  "p-pie": "Protein by compartment",
  "p-treemap": "GDP by state",
  "p-ternary": "Soil texture",
  "p-venn": "Genes up under each drug",
  "p-upset": "Genes up across drugs and times",
  "p-hm": "Gene expression across samples",
  "p-corr": "Study habits and scores",
  "p-parallel": "Flower measurements by species",
  "p-3d": "Length, width and height",
  "p-radar": "Two models across six attributes",
  "p-dendro": "Genes clustered by profile",
  "p-network": "Gut microbes that occur together",
  "p-tracks": "Diet and gut community over time",
  "p-forest": "Six studies and the pooled estimate",
  "p-funnel": "Study effects against precision",
  "p-bland": "Agreement between two methods",
  "p-roc": "Biomarker diagnostic accuracy",
  "p-qq": "Observed vs expected p-values",
  "p-manh": "Genome-wide association scan",
  "p-pcaload": "PCA — variable loadings",
  "p-pcabiplot": "PCA biplot — cases and variables",
  "p-scree": "Variance explained per component",
};

function mkPlot(id: string, tableId: string, kind: PlotKind | undefined, patch: Partial<Plot> = {}): Plot {
  return { id, name: CARD_TITLES[id] ?? id, source: tableId, status: "ok", styleOverrides: {}, ...(kind ? { kind } : {}), ...patch };
}

/** Three groups each with 3 replicate subcolumns → a distribution per group (box/violin/scatter). */
function distributionTable(id: string): DataTable {
  // Simple column format: one column per group, the 12 observations straight down the rows —
  // no leading Row/X column, no fake replicate subcolumns. A distribution pools every value, so
  // that is the accurate shape. Tagged "y" so there is no implicit X.
  const cols: Col[] = [
    { id: "a1", name: "Control", role: "y" },
    { id: "b1", name: "Low dose", role: "y" },
    { id: "c1", name: "High dose", role: "y" },
  ];
  // 12 observations per group; means rise across groups, spreads differ.
  const rows: CellValue[][] = [
    [12, 18, 30], [14, 20, 34], [11, 16, 28], [15, 22, 33],
    [13, 19, 29], [16, 24, 36], [11, 17, 27], [16, 23, 35],
    [13, 21, 31], [14, 21, 32], [12, 18, 30], [15, 20, 38],
  ];
  return mkTable(id, cols, rows, "column");
}

const synthRoc: RocCurve[] = [
  { label: "Biomarker", auc: 0.86, aucLow: 0.79, aucHigh: 0.93, aucConf: 0.95, points: [{ fpr: 0, tpr: 0 }, { fpr: 0.05, tpr: 0.42 }, { fpr: 0.15, tpr: 0.68 }, { fpr: 0.3, tpr: 0.85 }, { fpr: 0.55, tpr: 0.94 }, { fpr: 1, tpr: 1 }] },
];

// Synthetic PCA output (2 well-separated groups) for the score / loadings / biplot / scree cards.
const synthPca: PcaGraphData = {
  varLabels: ["Area", "Perimeter", "Texture", "Compactness"],
  pcLabels: ["PC1", "PC2", "PC3"],
  explained: [0.62, 0.24, 0.14],
  eigenvalues: [2.48, 0.96, 0.56],
  loadings: [
    [0.55, -0.21, 0.30],
    [0.53, -0.18, 0.42],
    [0.31, 0.82, -0.35],
    [0.56, 0.12, -0.78],
  ],
  scores: [
    [-1.9, 0.4, 0.1], [-1.6, -0.5, 0.2], [-2.2, 0.1, -0.3], [-1.3, 0.7, 0.4], [-1.7, -0.2, -0.1],
    [1.8, 0.5, 0.2], [2.1, -0.3, -0.2], [1.5, 0.6, 0.3], [2.3, -0.1, 0.1], [1.6, 0.2, -0.4],
  ],
  groups: ["Benign", "Benign", "Benign", "Benign", "Benign", "Malignant", "Malignant", "Malignant", "Malignant", "Malignant"],
};

// Synthetic ordination output for the score-plot card: three treatment clusters, the
// PCoA/PCA "cases in component space" figure with a per-group confidence ellipse. Its own
// dataset (not `synthPca`) so the loadings/biplot/scree cards keep their two-group story.
// Note: each cluster needs genuine 2-D scatter: an exactly-collinear cluster has a degenerate
// covariance and its ellipse collapses to an invisible line.
// Note: the third component must exist and straddle zero: the score plot depth-sizes its dots
// by PC3 (a feature with its own guards, `pca-dot-depth.test.tsx`), and this card is
// the fixture those guards run on. Numbers are fictitious, like every gallery card's.
const synthOrdination: PcaGraphData = {
  varLabels: ["OTU richness", "Shannon", "Evenness", "Biomass"],
  pcLabels: ["PC1", "PC2", "PC3"],
  explained: [0.46, 0.38, 0.16],
  eigenvalues: [1.84, 1.52, 0.64],
  loadings: [
    [0.58, -0.15, 0.25],
    [0.49, -0.31, 0.44],
    [0.28, 0.79, -0.31],
    [0.58, 0.16, -0.71],
  ],
  scores: [
    [-2.1, 0.6, 0.3], [-1.6, 1.2, -0.4], [-1.9, 1.1, 0.1], [-1.4, 0.7, 0.5], [-2.3, 1.0, -0.2], [-1.7, 0.8, 0.2],
    [0.5, -1.1, -0.5], [-0.1, -1.6, 0.4], [0.3, -1.0, 0.0], [0.6, -1.7, -0.1], [0.0, -1.3, 0.6], [0.4, -1.5, -0.3],
    [1.4, 0.3, 0.2], [2.1, 0.8, -0.6], [1.7, 0.2, 0.4], [2.2, 0.5, 0.1], [1.6, 0.9, -0.2], [1.9, 0.4, 0.5],
  ],
  groups: ["Control", "Control", "Control", "Control", "Control", "Control",
           "Drug A", "Drug A", "Drug A", "Drug A", "Drug A", "Drug A",
           "Drug B", "Drug B", "Drug B", "Drug B", "Drug B", "Drug B"],
};

/**
 * Synthetic constrained-ordination output for the triplot card: three families in one picture.
 *
 * The story: sites along a wetness gradient, four plant species, and three measured
 * conditions — two continuous (arrows) and one factor level (a centroid, because "Grazed" is
 * a place in the ordination, not a direction of increase). The species sit at the end of the
 * gradient each prefers, so the picture reads the way a real RDA does.
 *
 * Note: LC and WA are deliberately different here (WA jittered off LC): the card exists partly to
 * show the toggle, and identical arrays would make the control look inert.
 */
const synthTriplot: PcaGraphData = {
  varLabels: ["Sphagnum", "Carex", "Festuca", "Thymus"],
  pcLabels: ["RDA1", "RDA2"],
  explained: [0.51, 0.17],
  eigenvalues: [2.04, 0.68],
  loadings: [],
  scores: [
    [-1.9, 0.5], [-1.6, -0.4], [-2.1, 0.1], [-1.2, 0.8],
    [-0.2, -0.9], [0.1, 0.6], [-0.4, -0.2], [0.3, -0.7],
    [1.5, 0.4], [1.9, -0.5], [2.2, 0.2], [1.6, 0.9],
  ],
  lcScores: [
    [-1.9, 0.5], [-1.6, -0.4], [-2.1, 0.1], [-1.2, 0.8],
    [-0.2, -0.9], [0.1, 0.6], [-0.4, -0.2], [0.3, -0.7],
    [1.5, 0.4], [1.9, -0.5], [2.2, 0.2], [1.6, 0.9],
  ],
  waScores: [
    [-2.2, 0.7], [-1.4, -0.6], [-2.4, 0.3], [-0.9, 1.0],
    [-0.4, -1.2], [0.4, 0.8], [-0.7, 0.1], [0.6, -0.9],
    [1.2, 0.6], [2.2, -0.7], [2.5, 0.0], [1.3, 1.2],
  ],
  speciesScores: [[-2.0, 0.2], [-0.7, -0.6], [1.1, 0.5], [2.1, -0.2]],
  speciesLabels: ["Sphagnum", "Carex", "Festuca", "Thymus"],
  envScores: [[-0.93, 0.12], [0.81, 0.35], [0.44, -0.72]],
  envLabels: ["Water table", "pH", "Management: grazed"],
  envIsFactor: [false, false, true],
  groups: ["Bog", "Bog", "Bog", "Bog", "Fen", "Fen", "Fen", "Fen", "Grassland", "Grassland", "Grassland", "Grassland"],
};

// The datasheets the PCA / ROC cards are drawn from. Pointing these five cards at the XY
// dose-response table (`xyT`) would make "Datasheet" open "Dose (µM) · Drug A · Drug B".
// The plots render from the embedded blobs above (`buildScene.ts` reads `plot.pca`; ROC reads
// `plot.roc`), so the table is purely the "open datasheet" data — it has to be a real sheet of
// the analysis's own kind.
// Guarded by gallery.test.ts ("every card is drawn from the datasheet it ships" + kind + no-borrow).

// PCA loadings / biplot / scree are three views of one two-group PCA (`synthPca`) → one
// PCA / ordination datasheet: cell-nuclei measurements per case, benign vs malignant.
const pcaLoadingsT = mkTable(
  "g-pca",
  [
    { id: "area", name: "Area" },
    { id: "perim", name: "Perimeter" },
    { id: "texture", name: "Texture" },
    { id: "compact", name: "Compactness" },
    { id: "dx", name: "Diagnosis" },
  ],
  [
    [420, 78, 12.1, 0.09, "Benign"],
    [388, 74, 11.4, 0.08, "Benign"],
    [455, 82, 13.0, 0.10, "Benign"],
    [402, 76, 12.4, 0.09, "Benign"],
    [370, 72, 11.0, 0.08, "Benign"],
    [910, 118, 19.6, 0.21, "Malignant"],
    [1020, 131, 22.1, 0.24, "Malignant"],
    [865, 112, 18.4, 0.19, "Malignant"],
    [1105, 138, 23.5, 0.26, "Malignant"],
    [940, 124, 20.8, 0.22, "Malignant"],
  ],
  "pca",
);

// The triplot card is a constrained ordination, so its sheet carries both blocks the analysis
// reads: the four species (the response) and the three conditions (the explanatory variables),
// on one sheet — the shape the ordination analyses read.
const triplotT = mkTable(
  "g-triplot",
  [
    { id: "sph", name: "Sphagnum" },
    { id: "car", name: "Carex" },
    { id: "fes", name: "Festuca" },
    { id: "thy", name: "Thymus" },
    { id: "wt", name: "Water table" },
    { id: "ph", name: "pH" },
    { id: "mgmt", name: "Management" },
  ],
  [
    [38, 12, 0, 0, -4, 4.2, "ungrazed"],
    [41, 9, 1, 0, -6, 4.0, "ungrazed"],
    [35, 14, 0, 0, -3, 4.4, "ungrazed"],
    [44, 7, 0, 1, -8, 3.9, "ungrazed"],
    [12, 26, 8, 1, -18, 5.6, "ungrazed"],
    [9, 31, 6, 2, -22, 5.9, "grazed"],
    [14, 24, 11, 0, -16, 5.4, "ungrazed"],
    [7, 29, 13, 3, -25, 6.1, "grazed"],
    [1, 6, 28, 19, -46, 7.1, "grazed"],
    [0, 4, 33, 24, -52, 7.4, "grazed"],
    [2, 8, 25, 17, -41, 6.9, "grazed"],
    [0, 3, 30, 22, -49, 7.3, "grazed"],
  ],
  "pca",
);

// The PCoA / PCA score card tells a three-treatment story (`synthOrdination`), so it has its own
// PCA / ordination datasheet: community metrics per sample across three treatments.
const pcaScoreT = mkTable(
  "g-pca-score",
  [
    { id: "rich", name: "OTU richness" },
    { id: "shannon", name: "Shannon" },
    { id: "even", name: "Evenness" },
    { id: "biomass", name: "Biomass" },
    { id: "treat", name: "Treatment" },
  ],
  [
    [142, 3.8, 0.82, 5.1, "Control"],
    [138, 3.7, 0.80, 4.9, "Control"],
    [151, 3.9, 0.84, 5.4, "Control"],
    [147, 3.85, 0.83, 5.2, "Control"],
    [135, 3.65, 0.79, 4.7, "Control"],
    [144, 3.82, 0.81, 5.0, "Control"],
    [98, 2.9, 0.66, 3.4, "Drug A"],
    [92, 2.7, 0.63, 3.1, "Drug A"],
    [105, 3.1, 0.69, 3.7, "Drug A"],
    [88, 2.6, 0.61, 3.0, "Drug A"],
    [101, 3.0, 0.67, 3.5, "Drug A"],
    [95, 2.8, 0.64, 3.2, "Drug A"],
    [120, 3.3, 0.74, 4.2, "Drug B"],
    [128, 3.5, 0.76, 4.5, "Drug B"],
    [116, 3.2, 0.72, 4.0, "Drug B"],
    [124, 3.4, 0.75, 4.3, "Drug B"],
    [131, 3.55, 0.77, 4.6, "Drug B"],
    [119, 3.25, 0.73, 4.1, "Drug B"],
  ],
  "pca",
);

// ROC is an XY-family analysis (a marker value + true disease state per subject); the curve
// itself renders from `synthRoc`. Its own diagnostic sheet rather than a share of `xyT`.
const rocSourceT = mkTable(
  "g-roc",
  [
    { id: "marker", name: "Biomarker (ng/mL)", role: "x" },
    { id: "disease", name: "Disease (1=yes)", role: "y" },
  ],
  [
    [1.2, 0], [1.8, 0], [2.1, 0], [1.5, 0], [2.6, 0], [1.9, 0], [3.0, 0],
    [3.4, 1], [4.2, 1], [2.9, 1], [5.1, 1], [3.8, 1], [4.7, 1], [3.3, 1],
  ],
);

/**
 * Restyle every gallery plot in the **"MadY default" house style** — the preset plus
 * each chart type's own house default, via a throwaway in-memory document.
 *
 * Pinned to the house style on purpose, not to the user's profile: a profile that points
 * at an all-black user preset would make every card draw black-and-white instead of in the
 * default palette. The cards show the program's default look; the profile affects new graphs
 * only. Keep this independent of the profile. Guarded both ways by
 * `one-default-look.test.ts` (factory profile: card ≡ created graph; any other
 * profile: cards unchanged).
 *
 * The kind-default step is what makes the card an accurate preview: a preset is
 * kind-agnostic, so without it the bar card would show 82%-wide bars with 6.5px dots
 * while the bar chart the user then creates has the tuned 0.38 / 14px look.
 */
function applyHouseStyle(items: GalleryItem[]): GalleryItem[] {
  const preset = findPreset("MadY default");
  if (!preset) return items;
  const tablesById = new Map(items.map((i) => [i.table.id, i.table]));
  const project: Project = {
    schemaVersion: 4,
    tables: [...tablesById.values()],
    plots: items.map((i) => i.plot),
    analyses: [],
    log: [],
    workspace: { folders: [], loose: [] },
  };
  const doc = new MadyDocument(project);
  for (const i of items) applyPresetWithKindDefaults(doc, i.plot.id, i.plot.kind, preset);
  const styled = new Map(doc.toJSON().plots.map((p) => [p.id, p]));
  return items.map((i) => ({ ...i, plot: styled.get(i.plot.id) ?? i.plot }));
}

/** Every gallery item, in display order. Add a new entry per new chart kind. */
export function galleryItems(): GalleryItem[] {
  // --- Bump chart: rankings over ordered stages (the plotRanks XY option) ---
  //     4 teams' scores across 5 rounds; the leader changes, so the rank lines cross.
  const bumpT = mkTable(
    "g-bump",
    [
      { id: "x", name: "Round", role: "x" },
      { id: "ta", name: "Team A", role: "y" },
      { id: "tb", name: "Team B", role: "y" },
      { id: "tc", name: "Team C", role: "y" },
      { id: "td", name: "Team D", role: "y" },
    ],
    [
      [1, 82, 74, 60, 91],
      [2, 88, 79, 95, 70],
      [3, 76, 90, 84, 88],
      [4, 94, 71, 80, 86],
      [5, 90, 96, 72, 83],
    ],
  );

  // --- GWAS QQ: association p-values vs the uniform null (the "association" sheet) ---
  //     A few strong hits at the top pull away from the diagonal; λ reads a little above 1.
  const gwasT = mkTable(
    "g-gwas",
    [
      { id: "snp", name: "Marker", role: "x" },
      { id: "chr", name: "Chromosome", role: "y" },
      { id: "pos", name: "Position", role: "y" },
      { id: "p", name: "P-value", role: "y" },
    ],
    [
      ["rs1001", 1, 1_200_000, 0.62], ["rs1002", 1, 4_500_000, 0.31], ["rs1003", 1, 8_800_000, 0.08],
      ["rs2001", 2, 2_100_000, 0.44], ["rs2002", 2, 6_700_000, 0.017], ["rs2003", 2, 9_900_000, 0.20],
      ["rs3001", 3, 3_300_000, 0.004], ["rs3002", 3, 7_200_000, 0.53], ["rs3003", 3, 1_000_000, 0.72],
      ["rs4001", 4, 5_500_000, 2e-8], ["rs4002", 4, 8_100_000, 0.11], ["rs4003", 4, 2_600_000, 0.39],
    ],
    "association",
  );

  // --- GWAS Manhattan: −log10 p along the genome, chromosomes end to end, a peak on chr 5 above
  //     the genome-wide line (5e-8) and a suggestive hit on chr 2. Six chromosomes so the
  //     alternating shading and the chromosome ruler both read at a glance. ---
  const manhT = mkTable(
    "g-manh",
    [
      { id: "snp", name: "Marker", role: "x" },
      { id: "chr", name: "Chromosome", role: "y" },
      { id: "pos", name: "Position", role: "y" },
      { id: "p", name: "P-value", role: "y" },
    ],
    [
      ["rs1001", 1, 1_000_000, 0.42], ["rs1002", 1, 5_000_000, 0.11], ["rs1003", 1, 9_000_000, 0.63],
      ["rs1004", 1, 13_000_000, 0.28], ["rs1005", 1, 17_000_000, 3e-4],
      ["rs2001", 2, 2_000_000, 0.51], ["rs2002", 2, 6_000_000, 2e-6], ["rs2003", 2, 10_000_000, 0.19],
      ["rs2004", 2, 14_000_000, 0.72], ["rs2005", 2, 18_000_000, 0.06],
      ["rs3001", 3, 1_500_000, 0.33], ["rs3002", 3, 5_500_000, 0.47], ["rs3003", 3, 9_500_000, 0.014],
      ["rs3004", 3, 13_500_000, 0.58],
      ["rs4001", 4, 3_000_000, 0.22], ["rs4002", 4, 7_000_000, 0.81], ["rs4003", 4, 11_000_000, 0.09],
      ["rs4004", 4, 15_000_000, 0.37],
      ["rs5001", 5, 2_500_000, 0.44], ["rs5002", 5, 6_500_000, 0.006], ["rs5003", 5, 8_200_000, 4e-9],
      ["rs5004", 5, 8_600_000, 1e-7], ["rs5005", 5, 12_500_000, 0.24], ["rs5006", 5, 16_500_000, 0.66],
      ["rs6001", 6, 3_500_000, 0.29], ["rs6002", 6, 7_500_000, 0.53], ["rs6003", 6, 11_500_000, 0.17],
      ["rs6004", 6, 15_500_000, 0.71],
    ],
    "association",
  );

  // --- Area: a signal over time ---
  const areaT = mkTable(
    "g-area",
    [
      { id: "x", name: "Time (s)", role: "x" },
      { id: "y", name: "Signal", role: "y" },
    ],
    [
      [0, 2],
      [1, 6],
      [2, 14],
      [3, 22],
      [4, 19],
      [5, 12],
      [6, 7],
      [7, 4],
      [8, 3],
    ],
  );

  // --- Bar: the grouped two-factor form — Timepoint ×
  // Control/Treated, 3 replicate subcolumns each → side-by-side bars with SD error bars. ---
  const barT = mkTable(
    "g-bar",
    [
      { id: "x", name: "Timepoint", role: "x" },
      { id: "c1", name: "Control", role: "y" },
      { id: "c2", name: "c2", role: "y", group: "c1" },
      { id: "c3", name: "c3", role: "y", group: "c1" },
      { id: "t1", name: "Treated", role: "y" },
      { id: "t2", name: "t2", role: "y", group: "t1" },
      { id: "t3", name: "t3", role: "y", group: "t1" },
    ],
    [
      ["Day 1", 20, 22, 19, 30, 33, 28],
      ["Day 2", 24, 21, 26, 41, 38, 44],
      ["Day 3", 18, 22, 20, 52, 49, 55],
    ],
    "grouped", // Timepoint × Control/Treated, two grouping factors — a grouped table, not xy
  );

  // Within-group significance brackets: Control vs Treated inside each
  // timepoint — the comparison this figure exists to make, drawn via `fromSeries`/
  // `toSeries`. Stacked by the real planner (the same `planSignificanceBrackets` the
  // "add markers" flow calls) from two-way-style cell terms ("Day 1 · Control vs Day 1 ·
  // Treated"), with control="Control" — so the card carries exactly the shape a two-way
  // cell-means run places, and the three disjoint pairs share one height instead of
  // staircasing. Labels render live through the threshold ladder (* / ** / ***).
  const barVals = barT.rows.flatMap((r) => barT.columns.filter((c) => c.id !== "x").map((c) => Number(r.cells[c.id])));
  const barDays = barT.rows.map((r) => String(r.cells.x));
  const barSeries = ["Control", "Treated"];
  const barSig: Plot["annotations"] = planSignificanceBrackets({
    terms: [
      { term: "Day 1 · Control vs Day 1 · Treated", p: 0.021 },
      { term: "Day 2 · Control vs Day 2 · Treated", p: 0.0043 },
      { term: "Day 3 · Control vs Day 3 · Treated", p: 0.0002 },
    ],
    categoryIndex: new Map(barDays.map((d, i) => [d, i + 1])),
    cellIndex: new Map(barDays.flatMap((d, di) => barSeries.map((s, si) => [`${d} · ${s}`, { cat: di + 1, series: si + 1 }] as const))),
    range: { min: Math.min(...barVals), max: Math.max(...barVals), span: Math.max(...barVals) - Math.min(...barVals) },
    control: "Control",
  }).map((b, i) => ({
    id: `p-bar-sig${i + 1}`,
    kind: "bracket",
    from: b.from,
    to: b.to,
    ...(b.fromSeries != null ? { fromSeries: b.fromSeries } : {}),
    ...(b.toSeries != null ? { toSeries: b.toSeries } : {}),
    bracketY: b.bracketY,
    // Planner height, so the scene may lift the shared rung clear of the r=14 dots.
    plannedY: true,
    p: b.p,
    role: "significance",
  }));

  // --- Simple Column bar: one grouping factor. Each column is a group; replicates run
  // down the rows; the label column is blank (no row categories). Draws one bar per column
  // at the column's pooled mean ± SD — the true simple-column bar, distinct from the grouped
  // card above. The blank lead is what tells the builder to pool per
  // column instead of banding by row. ---
  const columnBarT = mkTable(
    "g-columnbar",
    [
      // Lead-less simple column sheet: one column per group (tagged "y"), replicates down the
      // rows — no label column, no subcolumns. One bar per column at its pooled mean.
      { id: "ctrl", name: "Control", role: "y" },
      { id: "low", name: "Low dose", role: "y" },
      { id: "high", name: "High dose", role: "y" },
    ],
    [
      [20, 28, 41],
      [22, 31, 44],
      [19, 27, 39],
      [23, 30, 43],
      [21, 29, 42],
    ],
    "column",
  );

  const distT = distributionTable("g-dist");

  // --- Before-after: subjects × Pre/Post ---
  const baT = mkTable(
    "g-ba",
    [
      { id: "s", name: "Subject", role: "x" },
      { id: "pre", name: "Pre", role: "y" },
      { id: "post", name: "Post", role: "y" },
    ],
    [
      ["S1", 5, 8],
      ["S2", 6, 7],
      ["S3", 4, 9],
      ["S4", 7, 11],
      ["S5", 5, 6],
      ["S6", 8, 13],
    ],
    "column", // Subject (label) + Pre/Post groups — a column table, not xy
  );

  // --- Pie: the parts-of-whole format (each row a slice, one value column = the whole) — exactly
  // what a wizard-made pie is. The row-per-slice pie carries the full pie styling (per-slice
  // two-tone strokes + slice explode), so the card matches a real pie rather than a
  // column-per-slice xy shape.
  const pieT = mkTable(
    "g-pie",
    [
      { id: "slice", name: "Compartment" },
      { id: "v", name: "Protein (%)", role: "y" },
    ],
    [
      ["Mitochondria", 42],
      ["Cytosol", 28],
      ["Nucleus", 18],
      ["Membrane", 12],
    ],
    "partsofwhole",
  );

  // --- Treemap: parts of a whole, area-proportional cells, coloured by region ---
  // A parts-of-whole table (row per state) with a Region column so the gallery
  // demo shows group colouring — each region a hue, states shaded by size.
  // Each region gets an emoji badge.
  const regionIcon: Record<string, string> = { West: "🌲", South: "☀️", Northeast: "🍁", Midwest: "🌾" };
  const treemapRows: [string, number, string][] = [
    ["California", 4.3, "West"], ["Washington", 0.9, "West"], ["Colorado", 0.58, "West"], ["Arizona", 0.6, "West"],
    ["Texas", 2.9, "South"], ["Florida", 1.8, "South"], ["Georgia", 0.93, "South"], ["N. Carolina", 0.89, "South"],
    ["New York", 2.5, "Northeast"], ["Pennsylvania", 1.1, "Northeast"], ["New Jersey", 0.89, "Northeast"], ["Massachusetts", 0.82, "Northeast"],
    ["Illinois", 1.2, "Midwest"], ["Ohio", 0.97, "Midwest"], ["Michigan", 0.73, "Midwest"],
  ];
  const treemapT: DataTable = {
    id: "g-treemap",
    kind: "partsofwhole",
    name: "GDP by state",
    columns: [
      { id: "state", name: "State", role: "x" },
      { id: "gdp", name: "GDP ($T)", role: "y" },
      { id: "region", name: "Region", role: "x" },
      { id: "icon", name: "Icon", role: "x" },
    ],
    rows: treemapRows.map(([s, g, r], i) => ({ id: `g-tm-r${i}`, cells: { state: s, gdp: g, region: r, icon: regionIcon[r] ?? "" } })),
  };

  // --- Parallel coordinates: multivariable (iris-like), lines coloured by group ---
  // 90 rows, not 12. A parallel-coordinates plot is useful for overplotted data — where the
  // groups separate, where they cross, how tight each bundle is — and a dozen lines show
  // none of that. Generated from a fixed LCG (never Math.random) so the card is byte-identical
  // on every run: tests that render this table compare exact output and would otherwise fail
  // intermittently.
  let pcSeed = 20260808;
  const pcRnd = (): number => {
    pcSeed = (pcSeed * 1103515245 + 12345) % 2147483648;
    return pcSeed / 2147483648 - 0.5;
  };
  const pcSpread = [0.9, 0.7, 1.0, 0.55];
  const parallelRows: [number, number, number, number, string][] = (
    [
      ["setosa", [5.0, 3.4, 1.5, 0.25]],
      ["versicolor", [5.9, 2.8, 4.3, 1.35]],
      ["virginica", [6.6, 3.0, 5.6, 2.05]],
    ] as [string, number[]][]
  ).flatMap(([sp, centre]) =>
    Array.from({ length: 30 }, () => {
      const v = centre.map((m, j) => Number((m + pcRnd() * pcSpread[j]!).toFixed(2)));
      return [v[0]!, v[1]!, v[2]!, v[3]!, sp] as [number, number, number, number, string];
    }),
  );
  const parallelT: DataTable = {
    id: "g-parallel",
    kind: "multivariable",
    name: "Iris",
    columns: [
      { id: "sl", name: "Sepal L" },
      { id: "sw", name: "Sepal W" },
      { id: "pl", name: "Petal L" },
      { id: "pw", name: "Petal W" },
      { id: "sp", name: "Species" },
    ],
    rows: parallelRows.map(([a, b, c, d, s], i) => ({ id: `g-pc-r${i}`, cells: { sl: a, sw: b, pl: c, pw: d, sp: s } })),
  };

  // --- Heatmap: genes × samples ---
  const hmT = mkTable(
    "g-hm",
    [
      { id: "x", name: "Gene", role: "x" },
      { id: "s1", name: "Sample 1", role: "y" },
      { id: "s2", name: "Sample 2", role: "y" },
      { id: "s3", name: "Sample 3", role: "y" },
      { id: "s4", name: "Sample 4", role: "y" },
    ],
    [
      ["GeneA", 1.2, 2.4, 0.6, 3.1],
      ["GeneB", 2.8, 1.1, 3.6, 0.9],
      ["GeneC", 0.5, 3.3, 2.0, 1.7],
      ["GeneD", 3.0, 0.8, 1.4, 2.6],
    ],
    "grouped", // Gene (label) × samples matrix — a grouped table, not xy
  );

  // --- Correlation matrix: several study traits across subjects → pairwise r ---
  const corrT = mkTable(
    "g-corr",
    [
      { id: "subj", name: "Subject", role: "x" },
      { id: "study", name: "Study hrs", role: "y" },
      { id: "score", name: "Test score", role: "y" },
      { id: "absent", name: "Absences", role: "y" },
      { id: "sleep", name: "Sleep hrs", role: "y" },
      { id: "stress", name: "Stress", role: "y" },
    ],
    [
      ["S1", 2, 55, 8, 6.0, 7],
      ["S2", 4, 68, 5, 7.0, 6],
      ["S3", 3, 60, 6, 6.5, 6],
      ["S4", 6, 80, 3, 8.0, 4],
      ["S5", 5, 75, 4, 7.0, 5],
      ["S6", 8, 92, 1, 8.0, 2],
      ["S7", 7, 88, 2, 7.5, 3],
      ["S8", 9, 95, 1, 8.5, 2],
      ["S9", 1, 50, 9, 5.5, 8],
      ["S10", 10, 98, 0, 9.0, 1],
    ],
    "multivariable", // Subject label + numeric variables per case — the correlation matrix's natural format
  );

  // --- Network graph: a co-occurrence edge list (source, target, signed rho, source-node
  // group, source-node abundance) → a correlation-network look:
  // node colour = phylum group (+ legend), node size = abundance, link colour = rho's sign
  // (+ legend), link width = |rho|. Every taxon leads at least one row, because a node's
  // group/abundance travel with its first appearance as a source. ---
  const networkT = mkTable(
    "g-network",
    [
      { id: "src", name: "Source", role: "x" },
      { id: "tgt", name: "Target", role: "y" },
      { id: "rho", name: "Rho", role: "y" },
      { id: "grp", name: "Phylum", role: "y" },
      { id: "ab", name: "Abundance", role: "y" },
    ],
    [
      ["Faecalibact.", "Ruminococcus", 0.72, "Firmicutes", 9.1],
      ["Ruminococcus", "Lachnospira", 0.61, "Firmicutes", 7.4],
      ["Lachnospira", "Clostridium", 0.44, "Firmicutes", 5.0],
      ["Clostridium", "Faecalibact.", 0.58, "Firmicutes", 6.2],
      ["Bacteroides", "Prevotella", 0.66, "Bacteroidetes", 8.3],
      ["Prevotella", "Parabact.", 0.39, "Bacteroidetes", 6.8],
      ["Parabact.", "Bacteroides", 0.52, "Bacteroidetes", 4.2],
      // One edge between the Actinobacteria pair, led by Collinsella (so it still carries its
      // attributes) — a reciprocal second edge pulls the two nodes onto each other in the
      // force layout, and Collinsella's disc then sits on the "Bifidobact." label.
      ["Collinsella", "Bifidobact.", 0.55, "Actinobacteria", 3.1],
      ["Escherichia", "Klebsiella", 0.63, "Proteobacteria", 2.4],
      ["Klebsiella", "Prevotella", -0.29, "Proteobacteria", 1.8],
      ["Faecalibact.", "Escherichia", -0.58, "Firmicutes", 9.1],
      ["Bacteroides", "Escherichia", -0.41, "Bacteroidetes", 8.3],
      ["Bifidobact.", "Escherichia", -0.35, "Actinobacteria", 5.6],
      ["Faecalibact.", "Bacteroides", 0.31, "Firmicutes", 9.1],
    ],
    "edgelist", // the network's own format: one row per link, no case statistics offered
  );

  // --- Clustering demo: 6 genes × 2 control + 3 treated → two clear gene & sample groups ---
  const clusterT = mkTable(
    "g-cluster",
    [
      { id: "x", name: "Gene", role: "x" },
      { id: "c1", name: "Ctrl 1", role: "y" },
      { id: "c2", name: "Ctrl 2", role: "y" },
      { id: "t1", name: "Treat 1", role: "y" },
      { id: "t2", name: "Treat 2", role: "y" },
      { id: "t3", name: "Treat 3", role: "y" },
    ],
    [
      ["Gene1", 1.0, 1.2, 5.0, 5.3, 4.8],
      ["Gene2", 1.1, 0.9, 5.2, 4.9, 5.1],
      ["Gene3", 0.8, 1.0, 4.6, 5.0, 4.7],
      ["Gene4", 5.0, 4.8, 1.0, 1.1, 0.9],
      ["Gene5", 4.9, 5.1, 0.8, 1.0, 1.2],
      ["Gene6", 5.2, 4.7, 1.1, 0.9, 1.0],
    ],
    "grouped", // Gene (label) × sample columns matrix — a grouped table, not xy
  );

  // --- Radar / spider: several metrics across two series ---
  const radarT = mkTable(
    "g-radar",
    [
      // Grouped: rows = attributes (spokes), each model a dataset with 3 raw replicate
      // subcolumns — so you enter your three measurements directly and the radar computes the
      // mean ± error. No pre-computing Mean/SD.
      { id: "x", name: "Attribute", role: "x" },
      { id: "a1", name: "Model A", role: "y" },
      { id: "a2", name: "Model A", role: "y", group: "a1" },
      { id: "a3", name: "Model A", role: "y", group: "a1" },
      { id: "b1", name: "Model B", role: "y" },
      { id: "b2", name: "Model B", role: "y", group: "b1" },
      { id: "b3", name: "Model B", role: "y", group: "b1" },
    ],
    [
      ["Speed", 80, 84, 76, 60, 64, 56],
      ["Power", 63, 67, 65, 88, 92, 90],
      ["Range", 68, 72, 70, 48, 52, 50],
      ["Comfort", 83, 87, 85, 70, 74, 72],
      ["Economy", 52, 58, 55, 80, 84, 82],
      ["Safety", 88, 92, 90, 66, 70, 68],
    ],
    "grouped", // rows × dataset-columns × replicate subcolumns — raw replicates per series
  );

  // --- 3D scatter: three numeric coordinates per point ---
  const xyzT = mkTable(
    "g-3d",
    [
      { id: "x", name: "Length (mm)", role: "x" },
      { id: "y", name: "Width (mm)", role: "y" },
      { id: "z", name: "Height (mm)", role: "y" },
    ],
    [
      [10, 6, 3],
      [14, 9, 5],
      [8, 5, 2],
      [18, 12, 7],
      [12, 8, 4],
      [16, 7, 6],
      [20, 14, 9],
      [9, 10, 3],
      [15, 11, 8],
    ],
  );

  // --- Lollipop / dumbbell: a value per category vs an index (before/after pair) ---
  const lollipopT = mkTable(
    "g-lol",
    [
      { id: "x", name: "Metric", role: "x" },
      { id: "before", name: "2023", role: "y" },
      { id: "after", name: "2024", role: "y" },
    ],
    [
      ["Speed", 62, 78],
      ["Power", 55, 71],
      ["Range", 70, 66],
      ["Accuracy", 48, 64],
      ["Stamina", 80, 88],
    ],
    "column", // Metric (label) + 2023/2024 value columns — a column table, not xy
  );

  // --- Paired dot plot: a trait (row label) + a text section column + two series
  // (twin-study vs GWAS heritability), grouped into domains. ---
  const pairedT = mkTable(
    "g-paired",
    [
      { id: "trait", name: "Trait", role: "x" },
      { id: "domain", name: "Domain", role: "y" },
      { id: "h2", name: "Twin/family (h²)", role: "y" },
      { id: "h2snp", name: "GWAS (h²SNP)", role: "y" },
    ],
    [
      ["Educational attainment", "Cognition & SES", 0.43, 0.11],
      ["Adult IQ", "Cognition & SES", 0.8, 0.19],
      ["Childhood IQ", "Cognition & SES", 0.42, 0.28],
      ["Subjective wellbeing", "Psychology", 0.36, 0.04],
      ["Neuroticism", "Psychology", 0.37, 0.09],
      ["Risk-taking", "Psychology", 0.35, 0.05],
      ["Alcohol dependence", "Substance use", 0.49, 0.18],
      ["Cigarettes per day", "Substance use", 0.66, 0.11],
      ["Cannabis use disorder", "Substance use", 0.54, 0.15],
      ["ADHD", "Psychiatric", 0.74, 0.22],
      ["Bipolar disorder", "Psychiatric", 0.75, 0.13],
      ["Schizophrenia", "Psychiatric", 0.81, 0.2],
    ],
    "column", // Trait (label) + Domain section + two value columns — a column table, not xy
  );

  // --- Bubble: XY where a third column (Size) sets each point's radius ---
  // x=GDP, y=Life expectancy, size=Population (2nd Y), and a 4th column (CO₂ / capita) as an
  // independent variable that can be mapped to colour (Series → Colour by) — so size and colour show
  // different dimensions, a true 4-variable bubble. The 4th Y is drawn as neither position nor
  // size (bubble uses the 1st Y for position, 2nd for size); it only feeds the colour ramp.
  const bubbleT = mkTable(
    "g-bubble",
    [
      { id: "x", name: "GDP / capita", role: "x" },
      { id: "y", name: "Life expectancy", role: "y" },
      { id: "s", name: "Population", role: "y" },
      { id: "co2", name: "CO₂ / capita", role: "y" },
    ],
    [
      [5, 62, 30, 3],
      [12, 70, 82, 8],
      [22, 76, 15, 14],
      [35, 80, 50, 11],
      [48, 83, 8, 19],
      [18, 73, 124, 6],
      [28, 78, 41, 16],
      [9, 66, 96, 4],
      [40, 81, 22, 13],
    ],
  );

  // --- Histogram: one column of values → a frequency distribution (auto-binned) ---
  const histVals = [
    22, 28, 31, 34, 35, 38, 39, 41, 42, 43, 44, 45, 46, 47, 48, 49, 49, 50,
    50, 51, 51, 52, 53, 54, 55, 56, 57, 58, 60, 61, 63, 66, 68, 71, 75, 80,
  ];
  const histT = mkTable(
    "g-hist",
    [
      { id: "x", name: "Row", role: "x" },
      { id: "v", name: "Measurement", role: "y" },
    ],
    histVals.map((v, i) => [i + 1, v]),
  );

  // --- Forest: one row per study — point estimate + lower/upper CI columns ---
  const forestT = mkTable(
    "g-forest",
    [
      { id: "s", name: "Study", role: "x" },
      { id: "e", name: "Odds ratio", role: "y" },
      { id: "lo", name: "Lower", role: "y" },
      { id: "hi", name: "Upper", role: "y" },
    ],
    [
      ["Anderson 2011", 0.82, 0.64, 1.05],
      ["Brown 2014", 1.14, 0.90, 1.44],
      ["Chen 2016", 0.67, 0.49, 0.92],
      ["Davies 2018", 1.03, 0.77, 1.38],
      ["Evans 2020", 0.78, 0.61, 1.0],
      ["Foster 2022", 0.71, 0.52, 0.97],
    ],
    "meta", // Study + estimate/lower/upper — the meta-analysis format
  );

  // --- Funnel plot: the forest's companion (its own table — no card borrows another's).
  //     More studies than the forest demo so the funnel shape actually reads; CI widths
  //     vary so the dots spread down the SE axis. ---
  const funnelT = mkTable(
    "g-funnel",
    [
      { id: "s", name: "Study", role: "x" },
      { id: "e", name: "Odds ratio", role: "y" },
      { id: "lo", name: "Lower", role: "y" },
      { id: "hi", name: "Upper", role: "y" },
    ],
    [
      ["Almeida 2009", 0.95, 0.82, 1.10],
      ["Becker 2010", 0.88, 0.70, 1.11],
      ["Costa 2012", 1.08, 0.83, 1.40],
      ["Diaz 2013", 0.79, 0.55, 1.13],
      ["Egami 2015", 1.21, 0.78, 1.88],
      ["Fischer 2016", 0.68, 0.41, 1.13],
      ["Grant 2018", 1.35, 0.76, 2.40],
      ["Hoang 2020", 0.62, 0.33, 1.17],
      ["Iqbal 2022", 1.52, 0.74, 3.12],
    ],
    "meta", // Study + estimate/lower/upper — the meta-analysis format
  );

  // --- Ternary: the classic soil-texture triangle — sand/silt/clay compositions with a
  //     texture-class column bound to colour (the grouped look + its categorical legend). ---
  const ternT = mkTable(
    "g-ternary",
    [
      { id: "s", name: "Sample", role: "x" },
      { id: "a", name: "Sand", role: "y" },
      { id: "b", name: "Silt", role: "y" },
      { id: "c", name: "Clay", role: "y" },
      { id: "g", name: "Class", role: "y" },
    ],
    [
      ["Dune", 90, 5, 5, "Sand"],
      ["Riverbank", 80, 12, 8, "Sand"],
      ["Orchard", 65, 25, 10, "Loam"],
      ["Meadow", 40, 40, 20, "Loam"],
      ["Terrace", 32, 34, 34, "Loam"],
      ["Floodplain", 20, 65, 15, "Silt"],
      ["Delta", 8, 72, 20, "Silt"],
      ["Basin", 10, 45, 45, "Clay"],
      ["Pond bed", 20, 20, 60, "Clay"],
      ["Kiln pit", 10, 12, 78, "Clay"],
    ],
    "multivariable",
  );

  // --- Wind rose: a season of wind observations, prevailing south-westerly — direction
  //     (degrees) + speed; the speed column stacks each sector into magnitude bands. ---
  const roseT = mkTable(
    "g-rose",
    [
      { id: "dir", name: "Wind direction (°)", role: "y" },
      { id: "spd", name: "Speed (m/s)", role: "y" },
    ],
    [
      [225, 9], [232, 12], [218, 7], [241, 10], [227, 14], [235, 6], [222, 11], [248, 8],
      [214, 5], [230, 13], [238, 9], [225, 4], [252, 7], [209, 10], [228, 8], [244, 12],
      [198, 6], [261, 5], [219, 9], [236, 11], [270, 4], [203, 8], [255, 6], [225, 15],
      [180, 5], [292, 3], [158, 4], [312, 5], [135, 3], [90, 2], [45, 4], [341, 2],
      [10, 3], [68, 2], [117, 5], [174, 6], [285, 7], [329, 3], [22, 2], [246, 10],
    ],
    "column",
  );

  // --- Timeline tracks: host-factor tracks over study weeks aligned to one
  //     time axis — Diet is a categorical track (a hue per phase), Shannon diversity and
  //     Bacteroides abundance are continuous tracks, each ramped on its own scale. ---
  const tracksT = mkTable(
    "g-tracks",
    [
      { id: "t", name: "Study week", role: "x" },
      { id: "diet", name: "Diet", role: "y" },
      { id: "shan", name: "Shannon diversity", role: "y" },
      { id: "bact", name: "Bacteroides (%)", role: "y" },
    ],
    [
      [0, "Chow", 3.4, 41], [1, "Chow", 3.5, 44], [2, "Chow", 3.3, 39], [3, "Chow", 3.6, 46],
      [4, "High-fat", 2.9, 33], [5, "High-fat", 2.6, 28], [6, "High-fat", 2.4, 22], [7, "High-fat", 2.5, 25],
      [8, "High-fat", 2.3, 21], [9, "Chow", 2.8, 30], [10, "Chow", 3.1, 36], [11, "Chow", 3.3, 40],
      [12, "Chow", 3.5, 43], [13, "Chow", 3.6, 45],
    ],
    "xy",
  );

  // --- Waterfall (tumor response): per-patient best % change, sorted bars + RECIST zones.
  //     An ordinary bar chart with the waterfall patch (barSort desc + value-anchored
  //     threshold bands) — card key = the "waterfall" wizard genre key. ---
  const waterfallT = mkTable(
    "g-waterfall",
    [
      { id: "x", name: "Patient", role: "x" },
      { id: "v", name: "Best change from baseline (%)", role: "y" },
    ],
    [
      ["P01", -72], ["P02", -55], ["P03", -41], ["P04", -33], ["P05", -28],
      ["P06", -21], ["P07", -12], ["P08", -6], ["P09", 3], ["P10", 9],
      ["P11", 17], ["P12", 26], ["P13", 38],
    ],
    "column",
  );

  // --- Relative abundance: 100%-stacked bars + stratum ribbons (a microbiome
  // composition figure with gut-cohort-style data) ---
  const abundanceT = mkTable(
    "g-abundance",
    [
      { id: "x", name: "Group", role: "x" },
      { id: "t1", name: "Firmicutes", role: "y" },
      { id: "t2", name: "Actinobacteria", role: "y" },
      { id: "t3", name: "Bacteroidetes", role: "y" },
      { id: "t4", name: "Proteobacteria", role: "y" },
      { id: "t5", name: "Others", role: "y" },
    ],
    [
      ["Baseline", 41, 20, 27, 8, 4],
      ["1 month", 52, 21, 17, 6, 4],
      ["6 months", 49, 25, 15, 7, 4],
      ["Controls", 51, 29, 12, 5, 3],
    ],
    "grouped",
  );

  // --- Composite starters: bars + a rate line on a 2nd axis; histogram + density ---
  // Monthly case counts (bars, left axis) with the test-positivity rate (a line, right axis) —
  // two units, one panel: the classic counts + rate combination. Its own table, so the card
  // shares its datasheet with no other card.
  const barlineT = mkTable(
    "g-barline",
    [
      { id: "x", name: "Month", role: "x" },
      { id: "cases", name: "Cases", role: "y" },
      { id: "rate", name: "Positivity (%)", role: "y" },
    ],
    [
      ["Jan", 120, 4.1],
      ["Feb", 160, 5.3],
      ["Mar", 240, 8.9],
      ["Apr", 210, 7.6],
      ["May", 150, 5.0],
      ["Jun", 90, 3.2],
    ],
    "grouped",
  );
  // A right-skewed sample (reaction times, ms): the kernel density follows the long tail the
  // fitted normal cannot — which is exactly what the card is there to show.
  const histDensVals = [
    182, 190, 196, 201, 205, 208, 211, 214, 217, 219, 221, 223, 225, 227, 229, 231, 233, 236,
    238, 241, 244, 247, 251, 255, 259, 264, 269, 275, 282, 290, 299, 310, 323, 339, 358, 382,
    412, 450, 498, 560,
  ];
  const histDensT = mkTable(
    "g-histdens",
    [
      { id: "x", name: "Row", role: "x" },
      { id: "v", name: "Reaction time (ms)", role: "y" },
    ],
    histDensVals.map((v, i) => [i + 1, v]),
  );

  // Pareto: defect counts by cause, deliberately in unsorted table order so the
  // card's Sort bars = Largest first visibly does the ordering. Its own table.
  const paretoT = mkTable(
    "g-pareto",
    [
      { id: "x", name: "Cause", role: "x" },
      { id: "n", name: "Defects", role: "y" },
    ],
    [
      ["Scratches", 18],
      ["Misalignment", 54],
      ["Cracks", 31],
      ["Discolouration", 12],
      ["Dents", 24],
      ["Other", 6],
    ],
    "column",
  );

  // Two sheets, one graph: measured dose–response points from one datasheet,
  // the fitted model curve from another (a finer dose grid), borrowed onto the same axes.
  const twoSheetsT = mkTable(
    "g-twosheets",
    [
      { id: "x", name: "Dose (µM)", role: "x" },
      { id: "y", name: "Measured", role: "y" },
      { id: "y2", name: "Measured", role: "y", group: "y" },
      { id: "y3", name: "Measured", role: "y", group: "y" },
    ],
    [
      [0.1, 5, 7, 4],
      [0.3, 11, 9, 13],
      [1, 24, 27, 22],
      [3, 49, 46, 52],
      [10, 74, 71, 76],
      [30, 88, 91, 87],
      [100, 95, 97, 94],
    ],
  );
  const twoSheetsModelT = mkTable(
    "g-twosheets-model",
    [
      { id: "mx", name: "Dose (µM)", role: "x" },
      { id: "my", name: "Model (4PL)", role: "y" },
    ],
    [0.05, 0.1, 0.2, 0.3, 0.5, 1, 2, 3, 5, 10, 20, 30, 50, 100, 200].map((d) => [d, Number((3 + 95 / (1 + Math.pow(3.2 / d, 1.1))).toFixed(1))]),
  );
  // The second sheet is inserted under its own name (the card title names only the first), and
  // the Series chip + tooltip read it — so it must be a real name, not the fixture id.
  twoSheetsModelT.name = "Model curve (4PL)";

  // --- Venn: gene-list membership across three conditions (the "sets" door) ---
  const vennT = mkTable(
    "g-venn",
    [
      { id: "g", name: "Gene", role: "x" },
      { id: "a", name: "Up in drug A", role: "y" },
      { id: "b", name: "Up in drug B", role: "y" },
      { id: "c", name: "Up in combo", role: "y" },
    ],
    [
      ["ATF3", 1, "", ""], ["FOS", 1, "", ""], ["JUN", 1, "", ""], ["EGR1", 1, "", ""],
      ["MYC", "", 1, ""], ["KLF4", "", 1, ""], ["SOX2", "", 1, ""],
      ["TP53", "", "", 1], ["CDKN1A", "", "", 1],
      ["HSPA5", 1, 1, ""], ["DDIT3", 1, 1, ""],
      ["GADD45A", 1, "", 1], ["XBP1", "", 1, 1],
      ["NFKB1", 1, 1, 1], ["STAT3", 1, 1, 1],
    ],
    "sets",
  );

  // --- UpSet: gene-list membership across five conditions (more than a Venn can draw) ---
  const upsetT = mkTable(
    "g-upset",
    [
      { id: "g", name: "Gene", role: "x" },
      { id: "a", name: "Drug A", role: "y" },
      { id: "b", name: "Drug B", role: "y" },
      { id: "c", name: "Combo", role: "y" },
      { id: "d", name: "24 h", role: "y" },
      { id: "e", name: "72 h", role: "y" },
    ],
    [
      ["ATF3", 1, "", "", "", ""], ["FOS", 1, "", "", "", ""], ["JUN", 1, "", "", "", ""],
      ["EGR1", 1, "", "", "", ""], ["KLF2", 1, "", "", "", ""], ["IER2", 1, "", "", "", ""],
      ["MYC", "", 1, "", "", ""], ["KLF4", "", 1, "", "", ""], ["SOX2", "", 1, "", "", ""],
      ["TP53", "", "", 1, "", ""], ["CDKN1A", "", "", 1, "", ""],
      ["HSPA5", 1, 1, "", "", ""], ["DDIT3", 1, 1, "", "", ""], ["ATF4", 1, 1, "", "", ""],
      ["XBP1", 1, 1, 1, "", ""], ["NFKB1", 1, 1, 1, "", ""],
      ["GADD45A", "", "", "", 1, ""], ["SESN2", "", "", "", 1, 1],
      ["TRIB3", "", "", "", "", 1], ["ASNS", 1, "", "", 1, 1],
      ["PPP1R15A", 1, 1, "", 1, ""], ["VEGFA", "", "", 1, "", 1],
    ],
    "sets",
  );

  // --- Bland-Altman: two methods measured on the same subjects (paired rows) ---
  const blandT = mkTable(
    "g-bland",
    [
      { id: "s", name: "Subject", role: "x" },
      { id: "a", name: "Method A", role: "y" },
      { id: "b", name: "Method B", role: "y" },
    ],
    [
      [1, 10.1, 10.5], [2, 12.6, 12.1], [3, 8.9, 9.3], [4, 15.2, 14.6], [5, 11.4, 11.8],
      [6, 13.8, 13.2], [7, 9.6, 10.1], [8, 16.5, 15.7], [9, 12.0, 12.5], [10, 14.3, 13.6],
      [11, 10.8, 11.3], [12, 17.1, 16.2],
    ],
    "column", // Subject label + Method A / Method B — Bland-Altman's natural (column) format
  );

  // --- Population pyramid: shared categories, two groups drawn back-to-back ---
  const pyramidT = mkTable(
    "g-pyramid",
    [
      { id: "age", name: "Age band", role: "x" },
      { id: "m", name: "Male", role: "y" },
      { id: "f", name: "Female", role: "y" },
    ],
    [
      ["0–14", 62, 59], ["15–29", 71, 68], ["30–44", 66, 70], ["45–59", 54, 58],
      ["60–74", 38, 45], ["75+", 19, 31],
    ],
    "grouped", // Age band (label) × Male/Female groups — a grouped table, not xy
  );

  return applyHouseStyle(fileByFamily([
    { key: "bump", title: "Bump chart (rankings)", note: "Each series' rank over ordered stages — the lines cross as the leader changes. Made with the line chart's Rank chart option.", table: bumpT, plot: mkPlot("p-bump", bumpT.id, "xy", { plotRanks: true, xAxis: { title: "Round" } }) },
    { key: "qq", title: "QQ plot (GWAS)", note: "Observed vs expected −log10 p — points hug the y = x null until real associations pull away at the top; the genomic inflation λ rides in the legend.", table: gwasT, plot: mkPlot("p-qq", gwasT.id, "qq") },
    { key: "manhattan", title: "Manhattan plot (GWAS)", note: "−log10 p for every marker along the genome — chromosomes laid end to end and shaded in alternating tones, with the genome-wide (5×10⁻⁸) and suggestive lines. The chr-5 peak clears genome-wide significance.", table: manhT, plot: mkPlot("p-manh", manhT.id, "manhattan") },
    { key: "area", title: "Area", note: "Magnitude over a continuous axis; filled trends.", table: areaT, plot: mkPlot("p-area", areaT.id, "area") },
    { key: "bar", title: "Bar / column (+ error bars)", note: "Compare a value across categories; grouped, mean ± SD — Treated tested against Control within each timepoint.", table: barT, plot: mkPlot("p-bar", barT.id, "bar", { ...VALUE_AXIS("Expression (a.u.)"), annotations: barSig, significanceControl: "Control" }) },
    { key: "columnbar", title: "Simple column bar (one factor)", note: "One bar per column at its pooled mean ± SD — replicates run down the rows, no grouping factor.", table: columnBarT, plot: mkPlot("p-columnbar", columnBarT.id, "bar", { ...VALUE_AXIS("Response (a.u.)"), xAxis: { title: "Group" } }) },
    { key: "box", title: "Box & whisker", note: "Distribution summary (median, quartiles, whiskers) per group.", table: distT, plot: mkPlot("p-box", distT.id, "box", DIST_AXES) },
    { key: "violin", title: "Violin", note: "Distribution shape (kernel density) per group.", table: distT, plot: mkPlot("p-violin", distT.id, "violin", DIST_AXES) },
    { key: "scatter", title: "Column scatter", note: "Every replicate as a dot + mean ± SD — small n.", table: distT, plot: mkPlot("p-scatter", distT.id, "scatter", DIST_AXES) },
    { key: "floatingbar", title: "Floating bars (min→max)", note: "A bar spanning each group's min→max with a line at the mean.", table: distT, plot: mkPlot("p-floatbar", distT.id, "floatingbar", DIST_AXES) },
    { key: "estimation", title: "Estimation (Gardner-Altman)", note: "Two groups' raw dots + the mean difference with a bootstrap CI on a right effect-size axis — modern estimation statistics.", table: distT, plot: mkPlot("p-est", distT.id, "estimation", DIST_AXES) },
    { key: "forest", title: "Forest plot", note: "One row per study: a point estimate with its CI whisker + a no-effect reference line and pooled summary — meta-analysis.", table: forestT, plot: mkPlot("p-forest", forestT.id, "forest", { forest: { showSummary: true }, yAxis: { title: "Study" } }) },
    { key: "funnel", title: "Funnel plot", note: "Publication-bias check beside a meta-analysis: each study at (effect, standard error), SE 0 on top — the cloud should fill the pseudo-CI funnel symmetrically.", table: funnelT, plot: mkPlot("p-funnel", funnelT.id, "funnel", { xAxis: { scale: "log10", title: "Odds ratio" } }) },
    { key: "venn", title: "Venn diagram", note: "Overlap counts between 2–3 sets from a membership sheet (row = item, one column per set) — classic circles, or area-proportional Euler.", table: vennT, plot: mkPlot("p-venn", vennT.id, "venn") },
    { key: "upset", title: "UpSet plot", note: "Set overlaps past what a Venn can draw: intersection-size bars on a count axis, the membership dot matrix beneath, set-size bars at the left — any number of sets.", table: upsetT, plot: mkPlot("p-upset", upsetT.id, "upset") },
    { key: "ternary", title: "Ternary plot", note: "Three-part compositions as points in a triangle — each row's Sand + Silt + Clay normalized to 100%; colour bound to the texture class.", table: ternT, plot: mkPlot("p-ternary", ternT.id, "ternary", { seriesStyles: { a: { colorFromColumn: "g", colorFromMode: "category" } } }) },
    { key: "rose", title: "Polar histogram (wind rose)", note: "Wind directions binned into 16 sectors, each wedge stacked by speed band — the prevailing south-westerly reads at a glance; 0° = North, clockwise.", table: roseT, plot: mkPlot("p-rose", roseT.id, "rose") },
    { key: "tracks", title: "Timeline tracks", note: "Stacked tile strips over one shared time axis — a categorical Diet track plus Shannon-diversity and Bacteroides tracks, each ramped on its own scale. Built to stack above another time-axis chart.", table: tracksT, plot: mkPlot("p-tracks", tracksT.id, "tracks", { xAxis: { title: "Study week" }, yAxis: { title: "Track" } }) },
    {
      key: "abundance",
      title: "Relative abundance (stacked)",
      note: "Groups as 100%-stacked bars with translucent ribbons tracing each taxon into the next bar — the microbiome composition figure. An ordinary bar chart wearing the look: every bar control applies.",
      table: abundanceT,
      plot: mkPlot("p-abundance", abundanceT.id, "bar", {
        barLayout: "percent",
        barRibbons: true,
        yAxis: { title: "Relative abundance (%)" },
      }),
    },
    {
      key: "waterfall",
      title: "Waterfall (response)",
      note: "Per-patient best % change, sorted largest-first around zero, with the −30% response / +20% progression zones — an ordinary bar chart wearing the waterfall look.",
      table: waterfallT,
      plot: mkPlot("p-waterfall", waterfallT.id, "bar", {
        barSort: "desc",
        yAxis: { title: "Change from baseline (%)" },
        annotations: [
          { id: "wf-pr", kind: "hband", bandLo: -100, bandHi: -30, fill: "#2f9e44", fillOpacity: 0.08, label: "Response" },
          { id: "wf-pd", kind: "hband", bandLo: 20, bandHi: 100, fill: "#e03131", fillOpacity: 0.07, label: "Progression" },
        ],
      }),
    },
    { key: "blandaltman", title: "Bland-Altman", note: "Method agreement: difference vs mean of two measurements, with bias + 95% limits of agreement.", table: blandT, plot: mkPlot("p-bland", blandT.id, "blandaltman") },
    { key: "pyramid", title: "Population pyramid", note: "Two groups as mirrored horizontal bars across shared categories (e.g. age bands).", table: pyramidT, plot: mkPlot("p-pyramid", pyramidT.id, "pyramid", { pyramid: { showValues: true } }) },
    { key: "pcascore", title: "Ordination — sites", note: "Cases in component space (principal coordinates or components), coloured by treatment, each treatment wearing its confidence ellipse — the workhorse ordination graph. Click an ellipse to edit them.", table: pcaScoreT, plot: mkPlot("p-pcascore", pcaScoreT.id, "pcascore", { name: "PCoA — treatment ordination", pca: synthOrdination, ellipse: { show: true } }) },
    { key: "pcaload", title: "Ordination — variables", note: "Each variable as an arrow from the origin — how it projects onto the components.", table: pcaLoadingsT, plot: mkPlot("p-pcaload", pcaLoadingsT.id, "pcaload", { pca: synthPca }) },
    { key: "pcabiplot", title: "Ordination — biplot", note: "Scores + scaled loading vectors overlaid: cases and the variables that drive them, together.", table: pcaLoadingsT, plot: mkPlot("p-pcabiplot", pcaLoadingsT.id, "pcabiplot", { pca: synthPca }) },
    { key: "triplot", title: "Ordination — triplot (constrained)", note: "A constrained ordination in one picture: the cases, the response variables as points, and the explanatory ones as arrows (a factor's level as a centroid, because a category has a place, not a direction). Made by Analyze ▸ redundancy analysis. The Chart section switches the cases between LC and WA scores.", table: triplotT, plot: mkPlot("p-triplot", triplotT.id, "triplot", { name: "RDA triplot — bog to grassland", pca: synthTriplot }) },
    { key: "scree", title: "Scree plot", note: "Variance retained per component — the elbow for choosing how many PCs to keep; optional cumulative curve.", table: pcaLoadingsT, plot: mkPlot("p-scree", pcaLoadingsT.id, "scree", { pca: synthPca, pcaStyle: { screeCumulative: true } }) },
    { key: "dendrogram", title: "Dendrogram", note: "Hierarchical-clustering tree of the rows (or columns) — which profiles group, and how tightly.", table: clusterT, plot: mkPlot("p-dendro", clusterT.id, "dendrogram", { dendrogram: { colorClusters: 2 }, xAxis: { title: "Gene" } }) },
    { key: "bubble", title: "Bubble", note: "XY where a third column sets each point's size — multivariable relationships.", table: bubbleT, plot: mkPlot("p-bubble", bubbleT.id, "bubble", { seriesStyles: { y: { symbolOpacity: 0.55 } } }) },
    { key: "histogram", title: "Histogram", note: "Frequency distribution of one variable's values — auto-binned, adjustable.", table: histT, plot: mkPlot("p-hist", histT.id, "histogram") },
    // ── Composite starters — after the plain histogram: the tests that pick "the
    // histogram fixture" by kind must keep finding the plain card first (density off by default).
    {
      key: "histdensity",
      title: "Histogram + density",
      note: "The bins stay; a smooth kernel-density curve rides over them and follows the long tail a fitted normal cannot (turn Normal curve on to compare).",
      table: histDensT,
      plot: mkPlot("p-histdens", histDensT.id, "histogram", {
        // 25 ms bins (a content choice for this sample): the auto width gives five 100 ms bins for
        // 40 values, which hides the skew the density curve is there to show.
        histogram: { densityCurve: true, binWidth: 25 },
      }),
    },
    {
      key: "barline",
      title: "Bars + line (2nd axis)",
      note: "Monthly case counts as bars on the left axis with the positivity rate drawn as a line on a right-hand axis — two units in one panel. Any bar series can be rendered as a line, points or an area (Render as).",
      table: barlineT,
      plot: mkPlot("p-barline", barlineT.id, "bar", {
        // overlay = every series shares the full-width centred slot, so the bars fill each band
        // and the line passes through the band centres (grouped would park the bars in the left
        // half and the line in the right). One value per month → no replicate dots to show.
        barLayout: "overlay",
        showBarPoints: false,
        // symbol none: with bar points off the line carries no markers, so its legend key
        // must not show one either (a legend key matches the drawing).
        seriesStyles: { rate: { plotAs: "line", axis: "y2", symbol: "none" } },
        yAxis: { title: "Cases" },
        y2Axis: { title: "Positivity (%)" },
        legend: { show: true },
      }),
    },
    {
      key: "twosheets",
      title: "Two sheets, one graph",
      note: "Measured dose–response points from one datasheet with the fitted model curve borrowed from another (a finer dose grid) — Data ▸ Series ▸ Add series from another datasheet. The model sheet keeps its own data; this graph only holds a reference.",
      table: twoSheetsT,
      extraTables: [twoSheetsModelT],
      plot: mkPlot("p-twosheets", twoSheetsT.id, "xy", {
        overlays: [{ id: "ov-my", table: twoSheetsModelT.id, column: "my" }],
        seriesStyles: {
          y: { plotAs: "points" },
          my: { plotAs: "line", connect: "cardinal" },
        },
        xAxis: { scale: "log10" },
        yAxis: { title: "Response (%)" },
        legend: { show: true },
      }),
    },
    {
      key: "pareto",
      title: "Pareto",
      note: "Defect causes as bars sorted largest-first with the running total as a % line on a right-hand axis — the vital few on the left, and how much of the whole they cover. It is an ordinary bar chart with Sort bars and the cumulative % line turned on.",
      table: paretoT,
      plot: mkPlot("p-pareto", paretoT.id, "bar", {
        barSort: "desc",
        paretoLine: true,
        showBarPoints: false,
      }),
    },
    { key: "beforeafter", title: "Before–after (paired)", note: "Paired measurements per subject across conditions.", table: baT, plot: mkPlot("p-ba", baT.id, "beforeafter", { xAxis: { title: "Condition" } }) },
    { key: "pie", title: "Pie", note: "Parts of a whole (proportions).", table: pieT, plot: mkPlot("p-pie", pieT.id, "pie") },
    { key: "treemap", title: "Treemap", note: "Parts of a whole as area-proportional cells (Voronoi or squarified), coloured by region with perimeter region labels + per-cell icons.", table: treemapT, plot: mkPlot("p-treemap", treemapT.id, "treemap", { treemap: { groupColumn: "region", showValues: true, showGroupLabels: true, iconColumn: "icon" } }) },
    { key: "heatmap", title: "Heatmap", note: "A value per (row × column) cell — matrices, expression.", table: hmT, plot: mkPlot("p-hm", hmT.id, "heatmap") },
    { key: "corrmatrix", title: "Correlation matrix", note: "Pairwise correlations between variables — pie glyphs; fill ∝ |r|, +/− coloured by the palette.", table: corrT, plot: mkPlot("p-corr", corrT.id, "corrmatrix") },
    { key: "network", title: "Network graph", note: "Co-occurrence network from an edge list (source · target · signed weight) — nodes coloured by a group column and sized by a metric column, links red/blue by the weight's sign.", table: networkT, plot: mkPlot("p-network", networkT.id, "network", { network: { groupColumn: "grp", sizeColumn: "ab", edgeSignColors: true,
      // The house default makes edges recede (opacity 0.25) so the nodes carry the message —
      // right for structural edges, not here: this card's edges carry data (the sign colours),
      // so they are drawn stronger. Card-only, like the bubble card's demo translucency.
      edgeOpacity: 0.55, edgeWidth: 1.6 } }) },
    { key: "radar", title: "Radar / spider", note: "Compare several metrics across a few series; one axis per row. Replicate error bars per vertex.", table: radarT, plot: mkPlot("p-radar", radarT.id, "radar", { radar: { errorType: "sd" } }) },
    { key: "parallel", title: "Parallel coordinates", note: "Multivariate patterns — each numeric column an axis, each row a line, coloured by group.", table: parallelT, plot: mkPlot("p-parallel", parallelT.id, "parallel", { parallel: { colorColumn: "sp" } }) },
    { key: "scatter3d", title: "3D scatter", note: "Three numeric coordinates per point (X · Y · Z), isometric.", table: xyzT, plot: mkPlot("p-3d", xyzT.id, "scatter3d") },
    { key: "lollipop", title: "Lollipop / dumbbell", note: "Value per category vs an index, or a before→after change (two dots + Δ%).", table: lollipopT, plot: mkPlot("p-lol", lollipopT.id, "lollipop") },
    { key: "paireddot", title: "Paired dot plot", note: "Two values per category as dots on a shared row (Cleveland / double-lollipop), grouped into labelled sections.", table: pairedT, plot: mkPlot("p-paired", pairedT.id, "paireddot", PAIRED_WIDE) },
    { key: "roc", title: "ROC curve", note: "Diagnostic accuracy: sensitivity vs 1−specificity, with AUC; from a ROC analysis.", table: rocSourceT, plot: mkPlot("p-roc", rocSourceT.id, "roc", { roc: synthRoc }) },
    // The rich cards (`showcase.ts`): each replaces the plain card of its kind under the same key;
    // the split heatmap and the cards in `ADDED_CARD_KEYS` are added beside them. `fileByFamily`
    // files them by GALLERY_ORDER.
    ...richCards(),
  ]));
}

/** Built fresh on every call, never cached: each call rebuilds the tables and plots and
 *  runs the house style over them (`applyHouseStyle`), so a sample always shows the current
 *  defaults. The build is a few milliseconds; GalleryPane rebuilds per render too. */
function samples(): GalleryItem[] {
  return [...galleryItems(), ...wizardOnlySamples()];
}

/**
 * Samples the New-graph wizard seeds that are not gallery cards.
 *
 * Ridgeline: the gallery card is the XY horizon-fold showcase, which would hand the wizard's
 * ridgeline genre ("compare a distribution's shape across many groups", on a Column or Grouped
 * sheet) an XY profile sheet. Its sample is a Column joyplot instead: one column per group,
 * observations down the rows, no X column.
 */
function wizardOnlySamples(): GalleryItem[] {
  const ridgeT = mkTable(
    "g-ridge-col",
    [
      { id: "mu", name: "Museums", role: "y" },
      { id: "un", name: "Universities", role: "y" },
      { id: "so", name: "Software", role: "y" },
      { id: "ho", name: "Hospitals", role: "y" },
      { id: "ba", name: "Banking", role: "y" },
      { id: "sa", name: "Sales", role: "y" },
      { id: "co", name: "Coal mining", role: "y" },
    ],
    [
      [2, 2, 2, 9, 18, 28, 38], [2, 2, 10, 19, 28, 38, 48], [2, 9, 18, 27, 36, 46, 56], [6, 15, 24, 33, 42, 52, 62],
      [11, 20, 29, 38, 47, 57, 67], [15, 24, 33, 42, 51, 61, 71], [18, 27, 36, 45, 54, 64, 74], [21, 30, 39, 48, 57, 67, 77],
      [23, 32, 41, 50, 59, 69, 79], [26, 35, 44, 53, 62, 72, 82], [29, 38, 47, 56, 65, 75, 85], [33, 42, 51, 60, 69, 79, 89],
      [38, 47, 56, 65, 74, 84, 94], [44, 53, 62, 71, 80, 90, 98], [52, 61, 70, 79, 88, 98, 98], [62, 71, 80, 89, 98, 98, 98],
      [9, 18, 27, 36, 45, 55, 65], [35, 44, 53, 62, 71, 81, 91], [16, 25, 34, 43, 52, 62, 72], [28, 37, 46, 55, 64, 74, 84],
      [20, 29, 38, 47, 56, 66, 76], [24, 33, 42, 51, 60, 70, 80], [31, 40, 49, 58, 67, 77, 87], [13, 22, 31, 40, 49, 59, 69],
    ],
    "column",
  );
  return applyHouseStyle([
    {
      key: RIDGELINE_WIZARD_SAMPLE,
      title: "Ridgeline / joyplot",
      note: "Compare a distribution's shape across many groups; stacked KDE traces.",
      family: "Distributions & paired comparisons",
      table: ridgeT,
      plot: mkPlot("p-ridge-col", ridgeT.id, "ridgeline", { yAxis: { title: "Group" }, xAxis: { title: "Share (%)" }, ridgeline: { overlap: 2.4, fillOpacity: 0.9 } }),
    },
  ]);
}
const RIDGELINE_WIZARD_SAMPLE = "ridgeline-column";

/**
 * Which gallery card seeds a New-Graph genre's "start with sample data", given the datasheet format
 * the user chose (the gallery cards themselves are unchanged). Most genres share their key with one
 * card; the "Bar / column" genre is the exception — it draws both a simple one-factor column bar and
 * a two-factor grouped bar, so its example must follow the format:
 *  - `bar` on the grouped format → the grouped "bar" showcase (Control vs Treated within each
 *    timepoint) — an actual clustered grouped bar.
 *  - `bar` on any other (simple column) format → the simple-column example (`columnbar`), one bar
 *    per group.
 *  - `groupedbar` ("Grouped bars") → always the grouped showcase.
 */
function sampleCardKey(genreKey: string, format?: TableKind): string {
  if (genreKey === "bar") return format === "grouped" ? "bar" : "columnbar";
  if (genreKey === "groupedbar") return "bar";
  if (genreKey === "ridgeline") return RIDGELINE_WIZARD_SAMPLE; // the gallery card is an XY profile, not a distribution
  return genreKey;
}

/**
 * The gallery example that seeds a New-Graph genre's "start with sample data" for the chosen format.
 * Genres with no example (stacked / contingency) return undefined.
 */
export function sampleFor(genreKey: string, format?: TableKind): GalleryItem | undefined {
  const cardKey = sampleCardKey(genreKey, format);
  return samples().find((it) => it.key === cardKey);
}

/** Whether a genre has a ready-made sample dataset for the chosen format (drives the dialog checkbox). */
export function hasSample(genreKey: string, format?: TableKind): boolean {
  const cardKey = sampleCardKey(genreKey, format);
  return samples().some((it) => it.key === cardKey);
}
