/**
 * Shared per-kind fixtures — one table + plot config per PlotKind, and the scene builder.
 *
 * Extracted so every per-kind suite enrols from the same list: add a PlotKind here once and
 * the direct-manipulation contract (PlotFigure.matrix.test.tsx) and the annotation census
 * (annotation-census.test.tsx) both start covering it automatically. Keeping two lists is
 * how a kind ends up "covered" by a suite that never actually saw it.
 */
import type { DataTable, Plot, PlotKind } from "@mady/core";
import { buildPlotScene } from "@mady/graphics";

// ---- shared tables ---------------------------------------------------------
export const catTable: DataTable = {
  id: "tc", kind: "column", name: "C",
  columns: [
    { id: "c", name: "Group", role: "x" },
    { id: "a", name: "Baseline", role: "y" },
    { id: "b", name: "Treated", role: "y" },
  ],
  rows: [
    { id: "r1", cells: { c: "Alpha", a: 5, b: 8 } },
    { id: "r2", cells: { c: "Beta", a: 9, b: 4 } },
    { id: "r3", cells: { c: "Gamma", a: 6, b: 7 } },
    { id: "r4", cells: { c: "Delta", a: 3, b: 9 } },
  ],
};
export const netTable: DataTable = {
  id: "tn", kind: "edgelist", name: "N",
  columns: [
    { id: "s", name: "Source", role: "x" },
    { id: "t", name: "Target", role: "y" },
    { id: "w", name: "Weight", role: "y" },
    { id: "v", name: "Value", role: "y" },
  ],
  rows: [
    { id: "r1", cells: { s: "A", t: "B", w: 2, v: 1.5 } },
    { id: "r2", cells: { s: "A", t: "C", w: 1, v: 1.5 } },
    { id: "r3", cells: { s: "B", t: "D", w: 3, v: -0.5 } },
    { id: "r4", cells: { s: "C", t: "D", w: 1, v: 0.4 } },
    { id: "r5", cells: { s: "D", t: "E", w: 2, v: -1.2 } },
  ],
};
export const xyTable: DataTable = {
  id: "tx", kind: "xy", name: "X",
  columns: [
    { id: "x", name: "X", role: "x" },
    { id: "y", name: "Y", role: "y" },
    { id: "z", name: "Z", role: "y" },
  ],
  rows: [
    { id: "r1", cells: { x: 1, y: 2, z: 3 } },
    { id: "r2", cells: { x: 2, y: 5, z: 2 } },
    { id: "r3", cells: { x: 3, y: 4, z: 6 } },
    { id: "r4", cells: { x: 4, y: 9, z: 4 } },
    { id: "r5", cells: { x: 5, y: 6, z: 8 } },
  ],
};
export const hmTable: DataTable = {
  id: "th", kind: "xy", name: "H",
  columns: [
    { id: "g", name: "Gene", role: "x" },
    { id: "c1", name: "Cond1", role: "y" },
    { id: "c2", name: "Cond2", role: "y" },
    { id: "c3", name: "Cond3", role: "y" },
  ],
  rows: [
    { id: "r1", cells: { g: "G1", c1: 1, c2: 5, c3: 3 } },
    { id: "r2", cells: { g: "G2", c1: 8, c2: 2, c3: 6 } },
    { id: "r3", cells: { g: "G3", c1: 4, c2: 7, c3: 1 } },
  ],
};
export const pieTable: DataTable = {
  id: "tp", kind: "partsofwhole", name: "P",
  columns: [{ id: "c", name: "Cat" }, { id: "v", name: "V" }],
  rows: [
    { id: "r1", cells: { c: "Alpha", v: 3 } },
    { id: "r2", cells: { c: "Beta", v: 5 } },
    { id: "r3", cells: { c: "Gamma", v: 2 } },
  ],
};
// Forest: study label + estimate / lower CI / upper CI (all positive → log-scale valid).
export const forestTable: DataTable = {
  id: "tf", kind: "meta", name: "F",
  columns: [
    { id: "s", name: "Study", role: "x" },
    { id: "e", name: "Est", role: "y" },
    { id: "lo", name: "Lo", role: "y" },
    { id: "hi", name: "Hi", role: "y" },
  ],
  rows: [
    { id: "r1", cells: { s: "A", e: 1.2, lo: 0.9, hi: 1.6 } },
    { id: "r2", cells: { s: "B", e: 0.8, lo: 0.6, hi: 1.1 } },
    { id: "r3", cells: { s: "C", e: 1.5, lo: 1.1, hi: 2.0 } },
    { id: "r4", cells: { s: "D", e: 0.95, lo: 0.7, hi: 1.3 } },
  ],
};
export const swimmerTable: DataTable = {
  id: "tswim", kind: "timeline", name: "Swim",
  columns: [
    { id: "subj", name: "Subject", role: "x" },
    { id: "s", name: "Start", role: "y" },
    { id: "e", name: "End", role: "y" },
    { id: "rs", name: "Response start", role: "y" },
    { id: "re", name: "Response end", role: "y" },
    { id: "on", name: "Ongoing", role: "y" },
    { id: "ev", name: "Relapse", role: "y" },
  ],
  rows: [
    { id: "w1", cells: { subj: "A", s: 1, e: 10, rs: 2, re: 8, on: 1, ev: 6 } },
    { id: "w2", cells: { subj: "B", s: 1, e: 7, rs: "", re: "", on: "", ev: 4 } },
    { id: "w3", cells: { subj: "C", s: 2, e: 5, rs: "", re: "", on: "", ev: "" } },
  ],
};
export const ternaryTable: DataTable = {
  id: "ttern", kind: "multivariable", name: "Compositions",
  columns: [
    { id: "smp", name: "Sample", role: "x" },
    { id: "ca", name: "Sand", role: "y" },
    { id: "cb", name: "Silt", role: "y" },
    { id: "cc", name: "Clay", role: "y" },
  ],
  rows: [
    { id: "t1", cells: { smp: "P", ca: 70, cb: 20, cc: 10 } },
    { id: "t2", cells: { smp: "Q", ca: 30, cb: 50, cc: 20 } },
    { id: "t3", cells: { smp: "R", ca: 10, cb: 30, cc: 60 } },
    { id: "t4", cells: { smp: "S", ca: 33, cb: 33, cc: 34 } },
  ],
};
export const sunburstTable: DataTable = {
  id: "tsun", kind: "multivariable", name: "Taxonomy",
  columns: [
    { id: "lvl1", name: "Kingdom" },
    { id: "lvl2", name: "Phylum" },
    { id: "val", name: "Species", role: "y" },
    { id: "val2", name: "Genera", role: "y" },
  ],
  rows: [
    { id: "s1", cells: { lvl1: "Animalia", lvl2: "Chordata", val: 6, val2: 2 } },
    { id: "s2", cells: { lvl1: "Animalia", lvl2: "Arthropoda", val: 9, val2: 3 } },
    { id: "s3", cells: { lvl1: "Plantae", lvl2: "Angiosperms", val: 4, val2: 2 } },
  ],
};
export const oncoprintTable: DataTable = {
  id: "tonco", kind: "alterations", name: "Alterations",
  columns: [{ id: "s", name: "Sample" }, { id: "g", name: "Gene" }, { id: "a", name: "Alteration" }],
  rows: [
    { id: "o1", cells: { s: "S1", g: "TP53", a: "Missense" } },
    { id: "o2", cells: { s: "S2", g: "TP53", a: "Truncating" } },
    { id: "o3", cells: { s: "S1", g: "KRAS", a: "Amplification" } },
    { id: "o4", cells: { s: "S3", g: "EGFR", a: "Missense" } },
  ],
};
export const chordTable: DataTable = {
  id: "tchord", kind: "edgelist", name: "Flows",
  columns: [{ id: "s", name: "From" }, { id: "d", name: "To" }, { id: "w", name: "Weight" }],
  rows: [
    { id: "e1", cells: { s: "A", d: "B", w: 3 } },
    { id: "e2", cells: { s: "A", d: "C", w: 1 } },
    { id: "e3", cells: { s: "B", d: "C", w: 2 } },
  ],
};
export const roseTable: DataTable = {
  id: "trose", kind: "column", name: "Wind",
  columns: [
    { id: "dir", name: "Direction (°)", role: "y" },
    { id: "spd", name: "Speed", role: "y" },
  ],
  rows: [
    { id: "a1", cells: { dir: 30, spd: 3 } },
    { id: "a2", cells: { dir: 210, spd: 8 } },
    { id: "a3", cells: { dir: 225, spd: 12 } },
    { id: "a4", cells: { dir: 240, spd: 5 } },
    { id: "a5", cells: { dir: 100, spd: 6 } },
    { id: "a6", cells: { dir: 300, spd: 2 } },
  ],
};
export const tracksTable: DataTable = {
  id: "ttracks", kind: "xy", name: "Tracks",
  columns: [
    { id: "t", name: "Week", role: "x" },
    { id: "diet", name: "Diet", role: "y" },
    { id: "shan", name: "Shannon", role: "y" },
    { id: "bact", name: "Bacteroides", role: "y" },
  ],
  rows: [
    { id: "k0", cells: { t: 0, diet: "Chow", shan: 3.4, bact: 41 } },
    { id: "k1", cells: { t: 1, diet: "Chow", shan: 3.5, bact: 44 } },
    { id: "k2", cells: { t: 2, diet: "High-fat", shan: 2.6, bact: 28 } },
    { id: "k3", cells: { t: 3, diet: "High-fat", shan: 2.4, bact: 22 } },
    { id: "k4", cells: { t: 4, diet: "Chow", shan: 3.1, bact: 36 } },
  ],
};
export const setsTable: DataTable = {
  id: "tsets", kind: "sets", name: "Sets",
  columns: [
    { id: "item", name: "Item", role: "x" },
    { id: "sa", name: "Set A", role: "y" },
    { id: "sb", name: "Set B", role: "y" },
    { id: "sc", name: "Set C", role: "y" },
  ],
  rows: [
    { id: "m1", cells: { item: "one", sa: 1, sb: "", sc: "" } },
    { id: "m2", cells: { item: "two", sa: 1, sb: 1, sc: "" } },
    { id: "m3", cells: { item: "three", sa: "", sb: 1, sc: 1 } },
    { id: "m4", cells: { item: "four", sa: 1, sb: 1, sc: 1 } },
    { id: "m5", cells: { item: "five", sa: "", sb: "", sc: 1 } },
  ],
};

// PCA graph data (from a PCA analysis' extra.pca) for the score/loadings/biplot/scree kinds.
export const pcaGraph = {
  varLabels: ["V1", "V2", "V3"],
  pcLabels: ["PC1", "PC2", "PC3"],
  explained: [0.6, 0.25, 0.15],
  eigenvalues: [1.8, 0.75, 0.45],
  loadings: [[0.6, -0.3, 0.2], [0.5, 0.5, -0.4], [0.4, -0.2, 0.7]],
  scores: [[-1.5, 0.3, 0.1], [-1.2, -0.4, 0.2], [1.4, 0.5, -0.1], [1.1, -0.3, 0.3], [-0.9, 0.2, -0.2], [1.0, -0.1, 0.1]],
};

// ---- fixtures: one per PlotKind -------------------------------------------
export interface Fx {
  kind: PlotKind;
  table: DataTable;
  extra?: Partial<Plot>;
  /** Cartesian axes whose Spacing (tickLabelGap) should shift the plot rect. */
  axisBearing: boolean;
  /** Non-title label font roles this kind renders (besides "title", which all have). */
  fontRoles: ("tick" | "sliceLabel" | "legend")[];
  /** Renders whole-figure resize grips (.gfx-figresize). */
  figResize: boolean;
  /** The continuous value axis (honours manual range / reversed / log). Default "y";
   *  ridgeline plots values along X, lollipop defaults to horizontal (value on X). */
  valueAxis?: "x" | "y";
  /** Whether a log value scale is supported. Default true. `false` = the value axis is
   *  intentionally linear (zero-anchored bars/stems, pre-transformed data, or a
   *  bounded probability axis) — the log test then asserts it stays linear. */
  logValue?: boolean;
}
export const valAxisOf = (fx: Fx): "x" | "y" => fx.valueAxis ?? "y";

export const FIX: Fx[] = [
  // The XY fixture carries a fit (curve + both bands + EC50 marker), the area fixture the
  // multi-fit form — what Analyze → Dose-response / Global fit would have attached. Without
  // them the scene census could not see the fit layer at all; these are what prove the
  // census's "fit / fits are interactive" claim.
  {
    kind: "xy", table: xyTable, axisBearing: true, fontRoles: ["tick"], figResize: true,
    extra: {
      fit: {
        label: "Fit",
        points: [[1, 2.2], [2, 3.8], [3, 5.1], [4, 6.6], [5, 7.9]],
        confidenceBand: [[1, 1.6, 2.8], [2, 3.3, 4.3], [3, 4.6, 5.6], [4, 6.0, 7.2], [5, 7.1, 8.7]],
        predictionBand: [[1, 0.5, 3.9], [2, 2.2, 5.4], [3, 3.5, 6.7], [4, 4.9, 8.3], [5, 6.0, 9.8]],
        marker: { x: 3, y: 5.1, label: "EC50 = 3" },
      },
    },
  },
  {
    kind: "area", table: xyTable, axisBearing: true, fontRoles: ["tick"], figResize: true,
    extra: { fits: [{ label: "Fit Y", points: [[1, 2.2], [5, 7.9]] }, { label: "Fit Z", points: [[1, 2.5], [5, 7.5]] }] },
  },
  // Bars carry the category-group fixture: an explicit label→group map (rather than a
  // grouping column) so catTable stays shared with every other categorical kind. This is
  // what proves the scene census's "categoryGroups is interactive" claim.
  // The bar fixture is also the only carrier of a significance bracket. Without one, both
  // censuses would silently skip the whole kind, and a bracket rename could be a no-op (the
  // typed label stored and then ignored in favour of the p-derived label) with every guard
  // green. One entry here enrols significance markers into the annotation census and the
  // scene census at once.
  { kind: "bar", table: catTable, extra: { xAxis: { categoryGroups: { map: { Alpha: "First pair", Beta: "First pair", Gamma: "Second pair", Delta: "Second pair" } } }, annotations: [{ id: "sig1", kind: "bracket", from: 1, to: 2, bracketY: 10, p: 0.004 }] }, axisBearing: true, fontRoles: ["tick"], figResize: true, logValue: false }, // bars anchor at 0
  { kind: "box", table: catTable, axisBearing: true, fontRoles: ["tick"], figResize: true },
  { kind: "violin", table: catTable, axisBearing: true, fontRoles: ["tick"], figResize: true },
  { kind: "scatter", table: catTable, axisBearing: true, fontRoles: ["tick"], figResize: true },
  { kind: "raincloud", table: catTable, axisBearing: true, fontRoles: ["tick"], figResize: true },
  { kind: "floatingbar", table: catTable, axisBearing: true, fontRoles: ["tick"], figResize: true },
  { kind: "estimation", table: catTable, axisBearing: true, fontRoles: ["tick"], figResize: true, logValue: false },
  // `showSummary` is part of the fixture, not decoration: the pooled summary is a selection
  // target of its own (`seriesStyles["forest-summary"]`), and a forest drawn without one cannot
  // exercise it — the scene census refuses an "interactive" claim no fixture reaches.
  { kind: "forest", table: forestTable, extra: { forest: { showSummary: true } }, axisBearing: true, fontRoles: ["tick"], figResize: true, valueAxis: "x" }, // horizontal; effect axis on X, log-capable
  { kind: "funnel", table: forestTable, axisBearing: true, fontRoles: ["tick"], figResize: true, valueAxis: "x" }, // effect (X, log-capable) × standard error (Y, inverted, linear-only)
  { kind: "venn", table: setsTable, axisBearing: false, fontRoles: ["legend"], figResize: true }, // 2–3 discs, no axes; counts + set labels use the legend font
  { kind: "ternary", table: ternaryTable, axisBearing: false, fontRoles: ["tick"], figResize: true }, // composition triangle, no cartesian axes; edge ticks use the tick font
  { kind: "rose", table: roseTable, axisBearing: false, fontRoles: ["tick"], figResize: true }, // polar histogram; ring numbers + direction labels use the tick font
  { kind: "tracks", table: tracksTable, axisBearing: true, fontRoles: ["tick"], figResize: true, valueAxis: "x", logValue: false }, // stacked tile strips; time on X (linear-only), track names band down Y
  { kind: "upset", table: setsTable, axisBearing: true, fontRoles: ["tick"], figResize: true, valueAxis: "y", logValue: false }, // intersection bars on a real count Y axis (linear-only); matrix labels use the x tick font
  { kind: "swimmer", table: swimmerTable, axisBearing: true, fontRoles: ["tick"], figResize: true, valueAxis: "x", logValue: false }, // subject timeline bars; time on X (linear-only — durations start at 0)
  { kind: "blandaltman", table: catTable, axisBearing: true, fontRoles: ["tick"], figResize: true, logValue: false }, // difference (Y) spans zero → linear
  { kind: "pyramid", table: catTable, axisBearing: true, fontRoles: ["tick"], figResize: true, valueAxis: "x", logValue: false }, // mirrored horizontal bars, symmetric value axis
  { kind: "pcascore", table: xyTable, extra: { pca: pcaGraph }, axisBearing: true, fontRoles: ["tick"], figResize: true, logValue: false }, // PC scores; both axes signed → linear
  { kind: "pcaload", table: xyTable, extra: { pca: pcaGraph }, axisBearing: true, fontRoles: ["tick"], figResize: true, logValue: false }, // variable loadings + arrows
  { kind: "pcabiplot", table: xyTable, extra: { pca: pcaGraph }, axisBearing: true, fontRoles: ["tick"], figResize: true, logValue: false }, // scores + scaled loading vectors
  // The triplot needs the constrained parts as well, or it is a score plot: the explanatory
  // arrows and both case placements are what the kind exists for.
  { kind: "triplot", table: xyTable, extra: { pca: { ...pcaGraph, speciesScores: [[0.8, 0.2], [-0.5, 0.6], [0.3, -0.7]], speciesLabels: ["Alpha", "Beta", "Gamma"], envScores: [[0.7, 0.1], [-0.4, 0.6]], envLabels: ["Temp", "Depth"], envIsFactor: [false, false], lcScores: pcaGraph.scores, waScores: pcaGraph.scores.map((r) => [r[0]! * 1.1, r[1]! * 0.9]) } }, axisBearing: true, fontRoles: ["tick"], figResize: true, logValue: false }, // cases + response points + explanatory arrows
  { kind: "scree", table: xyTable, extra: { pca: pcaGraph, pcaStyle: { screeCumulative: true } }, axisBearing: true, fontRoles: ["tick"], figResize: true, logValue: false }, // variance per component + cumulative curve (2-series → legend)
  { kind: "dendrogram", table: catTable, axisBearing: true, fontRoles: ["tick"], figResize: true, logValue: false }, // clustering tree; height axis (Y) is a distance → linear
  { kind: "bubble", table: xyTable, axisBearing: true, fontRoles: ["tick", "legend"], figResize: true }, // size-legend title/labels use the 'legend' font
  { kind: "histogram", table: xyTable, axisBearing: true, fontRoles: ["tick"], figResize: true, logValue: false }, // count bars anchor at 0
  { kind: "volcano", table: xyTable, axisBearing: true, fontRoles: ["tick"], figResize: true, logValue: false }, // axes are already log-transformed
  // survival is a bounded probability. The at-risk table is part of the fixture so the scene
  // census can prove its rows select their curve — an interactive claim no fixture draws is an
  // unchecked claim.
  { kind: "survival", table: xyTable, extra: { survival: [{ label: "A", times: [0, 1, 2, 3, 4], surv: [1, 0.8, 0.6, 0.4, 0.2] }], survivalAtRisk: { times: [0, 1, 2, 3, 4], rows: [{ label: "A", atRisk: [20, 15, 10, 6, 2] }] } }, axisBearing: true, fontRoles: ["tick"], figResize: true, logValue: false },
  { kind: "roc", table: xyTable, extra: { roc: [{ label: "Test", points: [{ fpr: 0, tpr: 0 }, { fpr: 0.2, tpr: 0.6 }, { fpr: 0.5, tpr: 0.85 }, { fpr: 1, tpr: 1 }], auc: 0.79 }] }, axisBearing: true, fontRoles: ["tick"], figResize: true, logValue: false }, // sensitivity/1-specificity are bounded [0,1]
  { kind: "beforeafter", table: catTable, axisBearing: true, fontRoles: ["tick"], figResize: true, logValue: true }, // paired lines; log value axis supported (≤0 points dropped)
  { kind: "ridgeline", table: catTable, axisBearing: true, fontRoles: ["tick"], figResize: true, valueAxis: "x" },
  { kind: "lollipop", table: catTable, axisBearing: true, fontRoles: ["tick"], figResize: true, valueAxis: "x", logValue: false }, // horizontal by default; stems anchor at baseline (figure-resize grips wired)
  { kind: "paireddot", table: catTable, axisBearing: true, fontRoles: ["tick"], figResize: true, valueAxis: "x", logValue: false }, // horizontal Cleveland dot plot; value axis on X, stems to baseline
  { kind: "heatmap", table: hmTable, extra: { heatmap: { mode: "matrix", showValues: true } }, axisBearing: false, fontRoles: ["tick"], figResize: true },
  // density heatmap: real continuous x/y axes over (x,y) points — unlike matrix mode it
  // declares zoomable, so the zoom tests must cover it (a declaration with no component
  // offering the gesture would be a silent no-op).
  { kind: "heatmap", table: xyTable, extra: { heatmap: { mode: "density2d" } }, axisBearing: false, fontRoles: ["tick"], figResize: true, logValue: false },
  // correlation matrix: N×N pie glyphs over the numeric columns' pairwise r (no axes).
  { kind: "corrmatrix", table: hmTable, axisBearing: false, fontRoles: ["tick"], figResize: true },
  // alluvial: categorical axes + ribbons (no cartesian axes).
  { kind: "alluvial", table: catTable, axisBearing: false, fontRoles: ["tick"], figResize: true },
  // network: node-link graph from an edge list (no axes); labels use the tick font.
  { kind: "network", table: netTable, axisBearing: false, fontRoles: ["tick"], figResize: true },
  // radar's spoke labels + radial ring numbers use the tick font (not sliceLabel).
  { kind: "radar", table: catTable, axisBearing: false, fontRoles: ["tick"], figResize: true },
  { kind: "pie", table: pieTable, extra: { pieLabels: "label" }, axisBearing: false, fontRoles: ["sliceLabel"], figResize: true },
  // treemap: area-proportional Voronoi cells (no axes); labels use the tick font.
  { kind: "treemap", table: pieTable, axisBearing: false, fontRoles: ["tick"], figResize: true },
  // sunburst: concentric hierarchy rings (no axes); segment labels use the tick font.
  { kind: "sunburst", table: sunburstTable, axisBearing: false, fontRoles: ["tick"], figResize: true },
  // chord: a ring of node arcs + interior ribbons (no axes); node labels use the tick font.
  { kind: "chord", table: chordTable, axisBearing: false, fontRoles: ["tick"], figResize: true },
  // oncoprint: a genes×samples tile grid (no cartesian axes); gene/sample labels use the tick font.
  { kind: "oncoprint", table: oncoprintTable, axisBearing: false, fontRoles: ["tick"], figResize: true },
  // parallel coords: N vertical variable-axes + one polyline per row; own axes.
  // Value-coloured, on a 3-numeric-column table: the colour column is consumed as the scale
  // and drops out of the axes, so c1 colours while c2/c3 stay as axes (catTable has only two
  // numeric columns, so colouring there would leave a single axis — not parallel coords).
  // This shape also makes the fixture emit scene.colorbar, so the census can prove the bar is
  // clickable rather than take it on trust.
  { kind: "parallel", table: hmTable, extra: { parallel: { colorColumn: "c1", colorScale: "value" } }, axisBearing: false, fontRoles: ["tick"], figResize: true },
  { kind: "scatter3d", table: xyTable, axisBearing: false, fontRoles: [], figResize: true },
];

export const FAM = "MatrixFace, serif";
export const buildFor = (fx: Fx, over: Partial<Plot> = {}): ReturnType<typeof buildPlotScene> => {
  const plot: Plot = { id: "p", name: "P", source: fx.table.id, status: "ok", styleOverrides: {}, kind: fx.kind, title: "Kind Title", ...(fx.extra ?? {}), ...over };
  return buildPlotScene(fx.table, plot, { width: 520, height: 360 });
};
