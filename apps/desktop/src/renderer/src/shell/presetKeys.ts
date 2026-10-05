/**
 * Which plot fields a preset may carry, and for which graph types.
 *
 * A saved preset has two halves: the look every graph type shares (`SHARED_KEYS`, in
 * templates.ts — fonts, axes, grid, legend, frame, colours) and, per graph type, that type's
 * own settings (bar width, the pie labels, the heatmap block…). This file is the one place that
 * says which top-level `Plot` field is which. Every field of `Plot` must be in exactly one of
 * the three tables — `presetKeys.test.ts` reads the interface out of model.ts and refuses a
 * field that is in none (default-deny) or in two.
 *
 * The kind lists are measured, not guessed. A key's kind list names the graph types whose drawing
 * changes when the key changes. The lists below come from setting each key on each kind and
 * comparing the drawing, and the test re-measures every (key, kind) pair on that
 * type's gallery card: a listed kind whose drawing does not move fails the build. Why it
 * matters: a bar chart that used to be a pie still carries `pieDonut`; the kind list is what
 * keeps that out of the bar section of a preset.
 */
import type { Plot, PlotKind } from "@mady/core";
import { EQUAL_ASPECT_KINDS, stripPlotRefs } from "@mady/core";
import { SHARED_KEYS, capturePlotStyle } from "./templates";

type Owners = readonly PlotKind[];

const BAR_FAMILY: Owners = ["bar", "histogram", "upset"];
const GROUPED: Owners = ["bar", "box", "violin", "scatter", "raincloud", "beforeafter", "paireddot", "floatingbar", "estimation", "lollipop"];
const XY_FAMILY: Owners = ["xy", "area", "bubble", "volcano"];

/** Kind-specific style keys → the graph types that draw them. */
export const KIND_STYLE_KEYS: Partial<Record<keyof Plot, Owners>> = {
  // bars
  barLayout: ["bar"],
  barSort: ["bar", "histogram", "box", "violin", "scatter"],
  barShape: BAR_FAMILY,
  barWidth: BAR_FAMILY,
  barRibbons: BAR_FAMILY,
  barRibbonOpacity: ["bar"],
  paretoLine: BAR_FAMILY,
  paretoLineColor: ["bar"],
  showBarPoints: ["bar"],
  showValues: ["bar", "histogram", "swimmer", "upset"],
  valueDecimals: BAR_FAMILY,
  valueLabelDy: BAR_FAMILY,
  valuePlacement: BAR_FAMILY,
  barOrientation: ["bar", "box", "floatingbar", "histogram", "lollipop", "scatter", "violin"],
  // boxes
  boxWhisker: ["box", "floatingbar", "raincloud", "violin"],
  showBoxPoints: ["box", "violin"],
  showBoxMean: ["box", "violin"],
  pointSpread: ["bar", "box", "violin", "estimation", "scatter"],
  // areas and lines
  areaStack: ["area"],
  areaBaseline: ["area"],
  spread: XY_FAMILY,
  showIdentity: ["xy"],
  plotRanks: ["xy"],
  equalAspect: [...EQUAL_ASPECT_KINDS],
  fitStyle: XY_FAMILY,
  ellipse: ["xy", "area", "bubble", "volcano", "pcascore", "pcabiplot", "triplot"],
  refLine: ["xy", "area", "bubble", "volcano", "blandaltman", "estimation", "forest", "funnel", "manhattan", "paireddot", "pcabiplot", "pcaload", "pcascore", "pyramid", "qq", "roc", "triplot"],
  zoneLegend: ["bar"],
  // survival
  survivalShowCI: ["survival"],
  survivalCiOpacity: ["survival"],
  survivalShowCensor: ["survival"],
  survivalShowAtRisk: ["survival"],
  survivalAtRiskFont: ["survival"],
  survivalCumulativeIncidence: ["survival"],
  // pies
  pieStartAngle: ["pie"],
  pieDirection: ["pie"],
  pieDonut: ["pie"],
  pieLabels: ["pie"],
  pieLabelPosition: ["pie"],
  pieDisplay: ["pie"],
  waffleIcons: ["pie"],
  waffleMaxGroups: ["pie"],
  // significance brackets: formatting of the brackets an analysis draws over groups
  significance: GROUPED,
  // one block per bespoke kind (the key is the kind's name, with four spelling exceptions)
  heatmap: ["heatmap"],
  corrmatrix: ["corrmatrix"],
  alluvial: ["alluvial"],
  network: ["network"],
  ridgeline: ["ridgeline"],
  histogram: ["histogram"],
  scatter3d: ["scatter3d"],
  zAxis: ["scatter3d"],
  radar: ["radar"],
  treemap: ["treemap"],
  parallel: ["parallel"],
  bubble: ["bubble", "pcascore", "pcabiplot"],
  volcano: ["volcano"],
  lollipop: ["lollipop"],
  paireddot: ["paireddot"],
  floatingBar: ["floatingbar"],
  columnScatter: ["scatter"],
  estimation: ["estimation"],
  forest: ["forest"],
  funnel: ["funnel"],
  venn: ["venn"],
  upset: ["upset"],
  swimmer: ["swimmer"],
  ternary: ["ternary"],
  qq: ["qq"],
  manhattan: ["manhattan"],
  sunburst: ["sunburst"],
  chord: ["chord"],
  oncoprint: ["oncoprint"],
  rose: ["rose"],
  tracks: ["tracks"],
  blandAltman: ["blandaltman"],
  pyramid: ["pyramid"],
  pcaStyle: ["pcascore", "pcaload", "pcabiplot", "scree", "triplot"],
  dendrogram: ["dendrogram"],
};

/** Fields a preset must never carry, each with the reason. */
export const PRESET_EXCLUDED: Partial<Record<keyof Plot, string>> = {
  // identity and lineage
  id: "the plot's own id",
  name: "the plot's name",
  kind: "the graph type is the target's, never the preset's",
  source: "the datasheet the plot draws",
  analysisSource: "the analysis that spawned the plot",
  analysisResultVersion: "bookkeeping for a stale analysis snapshot",
  snapshotStale: "bookkeeping for a stale analysis snapshot",
  status: "stale/ok bookkeeping",
  overlays: "series borrowed from another datasheet — data, keyed by sheet and column ids",
  splitFrom: "the link from a small graph to its original graph and series — identity, not a look",
  image: "the picture panel's bytes",
  // analysis results and data-derived content
  fit: "an analysis result",
  fits: "analysis results",
  survival: "an analysis result",
  survivalAtRisk: "the number-at-risk table from an analysis",
  roc: "an analysis result",
  pca: "an analysis result",
  barSeriesGroups: "which dataset belongs to which group — data, keyed by column id",
  significanceControl: "which group is the control — a choice about the data, not its look",
  waffleUnit: "what one waffle cell stands for (1 % or one observation) — a choice about the data, not its look",
  annotations: "the plot's own notes, brackets and reference marks",
  // text content
  title: "the graph's own title",
  subtitle: "the graph's own subtitle",
  footer: "the graph's own footer",
  refLineLabels: "captions of this graph's reference lines",
  waffleUnitName: "the word for what this graph counts",
  waffleCaption: "the graph's own caption under its waffle",
  waffleOtherName: "the graph's own name for its combined groups",
  legendLabels: "the graph's own names for its legend rows, keyed by the labels its data builds",
  // hand-placed positions (drag offsets), not a style
  titleOffset: "a dragged position",
  subtitleOffset: "a dragged position",
  legendOffset: "a dragged position",
  legendLoose: "legend rows dragged out of the block — dragged positions",
  colorbarOffset: "a dragged position",
  waffleCaptionOffset: "a dragged position",
  printWidthMm: "how wide this one graph prints — a choice for its journal, not a look",
  displayScale: "how big this one graph is shown on screen — a view size, not a look",
  fitLabelOffset: "a dragged position",
  fitsOffsets: "dragged positions",
  fitParams: "the fit-parameters box: its placement is dragged, and it exists only where a fit ran",
  refLineLabelOffsets: "dragged positions",
  // per-element maps keyed by this graph's own ids
  seriesStyles: "per-dataset styles keyed by column id — a preset carries an ordered palette and shape cycle instead",
  pointStyles: "per-point styles keyed by column and row id",
  styleOverrides: "per-row overrides keyed by row",
  refLineStyles: "per-line overrides keyed by the reference line's id; `refLine` is the all-lines style",
  refLineLabelFonts: "per-line caption fonts keyed by the reference line's id, like refLineStyles",
  refLineHidden: "which of this graph's reference lines are hidden",
  // legacy and UI
  xScale: "superseded by xAxis.scale; kept for old files",
  yScale: "superseded by yAxis.scale; kept for old files",
  color: "the Navigator's highlight colour for this sheet",
  pinned: "Navigator ordering",
  hideExclusionNote: "a per-graph dismissal, explicitly not a style field",
  // plot-wide looks kept out of the shared set on purpose; adding them there would change
  // Apply-look, panel matching and the gallery's "same look" test at once
  backdrop: "a poster/slide backdrop; kept out of the shared set",
  showTitle: "title visibility; kept out of the shared set",
};

/** The kind-specific keys a graph of this type owns. */
export function kindOwnedKeys(kind: PlotKind): (keyof Plot)[] {
  return (Object.keys(KIND_STYLE_KEYS) as (keyof Plot)[]).filter((k) => KIND_STYLE_KEYS[k]!.includes(kind));
}

/**
 * The graph type's own settings, as a preset section: every owned key the plot has set, with
 * any column / row / table reference stripped (a preset is applied to graphs drawn from other
 * sheets). `undefined` when the plot has none — a section with nothing in it is not written.
 */
export function captureKindSection(plot: Plot): Partial<Plot> | undefined {
  const section = stripPlotRefs(capturePlotStyle(plot, kindOwnedKeys(plot.kind ?? "xy")));
  return Object.keys(section).length > 0 ? section : undefined;
}

/** The shared look of a plot, with sheet references stripped (a category-group column, say). */
export function captureSharedStyle(plot: Plot): Partial<Plot> {
  return stripPlotRefs(capturePlotStyle(plot, SHARED_KEYS));
}
