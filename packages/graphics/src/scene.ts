/**
 * Scene graph — the *rendered* form of a Plot.
 *
 * `buildPlotScene` (pure, DOM-free) turns a DataTable + Plot into this fully
 * resolved, serializable geometry. A thin view layer (the React/SVG renderer, or any
 * other) maps it to pixels. Keeping it pure makes it unit-testable via structural
 * snapshots (the visual-regression strategy) and keeps editing — every element
 * addressable by a stable id — independent of the renderer.
 */

import type {
  ErrorBarDir,
  FrameStyle,
  MetallicKind,
  NodeId,
  PatternKind,
  PlotKind,
  SpecialKind,
  SymbolFill,
  SymbolShape,
  TickDir,
  WhiskerSides,
} from "@mady/core";
import type { BackdropScene } from "./backdrop.js";

/**
 * Resolved paint for a filled shape (bar/box/violin) — a DOM-free descriptor the
 * view turns into a flat colour or an SVG <pattern>/<linearGradient> def.
 */
export type FillSpec =
  | { type: "solid"; color: string }
  | { type: "pattern"; pattern: PatternKind; color: string; bg: string | null; scale: number }
  | { type: "gradient"; from: string; to: string; angle: number }
  /** A multi-stop horizontal gradient in user space, anchored to the plot's X pixels (x1→x2)
   *  rather than each shape's own box — so many shapes sharing one (x1,x2,stops) read as a
   *  single axis-wide spectrum. `stops` are pre-resolved colours (a perceptual colormap), so a
   *  blue→red spectrum passes through vivid colours instead of a muddy 2-stop midpoint. Used by
   *  the ridgeline "spectrum" fill. */
  | { type: "axisGradient"; stops: { offset: number; color: string }[]; x1: number; x2: number }
  | { type: "metallic"; kind: MetallicKind }
  | { type: "special"; kind: SpecialKind };

export type ScaleType = "linear" | "log10" | "log2" | "ln" | "probit";

export interface AxisTick {
  /** Data-space value of the tick. */
  value: number;
  /** Pixel position along the axis (x for the x-axis, y for the y-axis). */
  pos: number;
  /** Formatted label; empty string for an unlabelled (minor) tick. */
  label: string;
  /** The label this tick would carry, kept when de-overlap blanked `label` to stop
   *  crowded category names colliding, or when a narrow figure shortened it to fit (the
   *  paired dot's "Untreated contr…"). Renderers must keep using `label` (so nothing
   *  hidden gets drawn); this exists so a consumer that needs the tick's identity —
   *  category grouping — is not defeated by a purely visual decision. Undefined when
   *  `label` is already the full text. */
  suppressedLabel?: string | undefined;
  /** Minor ticks are drawn shorter and without gridlines/labels. */
  minor: boolean;
  /** Colour for this tick's label text, overriding the shared tick font colour —
   *  set when the label itself carries a data channel (a category coloured by its
   *  group). Undefined = inherit the group fill. The tick mark is unaffected; it
   *  always follows the axis line colour. */
  color?: string | undefined;
}

/** One resolved category group on a banded axis — the geometry for all four
 *  redundant channels. Emitted only for axes with `band: true`; the per-tick
 *  label colour rides on `AxisTick.color` instead of appearing here. */
export interface CategoryGroupScene {
  /** Group name, as it appears in the source column. Also the override key. */
  label: string;
  /** Resolved group colour (explicit, else the palette by first appearance). */
  color: string;
  /** Which visual axis the group sits on. */
  axis: "x" | "y";
  /** Block tint spanning the plot across the group's categories. Undefined = tint off. */
  tint?: { x: number; y: number; w: number; h: number; opacity: number } | undefined;
  /** Rule at the group's leading edge, across the plot. Undefined on the first
   *  group (nothing to separate it from) or when separators are off. */
  separator?: { x1: number; y1: number; x2: number; y2: number; dash?: string | undefined } | undefined;
  /** Group name placement outside the plot: rotated 90° to the right of a vertical
   *  category axis, horizontal below a horizontal one. Undefined = names off.
   *  `x`/`y` are the unoffset anchor; the user's drag offset rides separately in
   *  `dx`/`dy` because the renderer's drag reports an accumulated offset — folding
   *  it into the anchor would compound it on the second drag. */
  name?: { x: number; y: number; angle: number; dx?: number | undefined; dy?: number | undefined } | undefined;
}

export interface AxisScene {
  type: ScaleType;
  /** Data-space domain actually drawn (after nice()/decade-snapping). */
  domain: [number, number];
  /** Pixel range: x-axis is [left, right]; y-axis is [bottom, top] (inverted). */
  range: [number, number];
  ticks: AxisTick[];
  title: string;
  /** Absolute x (px) for the title baseline, when it must be derived from the
   *  margins (the right/Y2 axis: just outside its tick labels, clear of the
   *  legend). Left/X titles use the renderer's edge-pinned default. */
  titleX?: number;
  /** Free drag offset (px) of the axis title from its default position. */
  titleOffset?: { dx: number; dy: number } | undefined;
  /**
   * Where the axis title belongs, derived from this axis's tick labels: the baseline y for a
   * horizontal (X) title, the rotate-anchor x for a vertical (Y) one.
   *
   * Pinning the title to the canvas edge while the tick labels are placed from the plot rect
   * would make the gap between them incidental: a larger font would push the title into the
   * numbers, smaller data would leave it in whitespace. Anchoring to the labels makes the gap
   * exactly `titleGap` by construction.
   *
   * Undefined = no title, a hidden axis, or a kind that positions its own.
   */
  titlePos?: number | undefined;
  /** Font size for the title after capping it to fit the canvas. A rotated Y title runs its
   *  length down the figure, so a long one ("% variance explained") would not fit at a
   *  large font and would be clipped. Undefined = use the resolved title font unchanged. */
  titleFont?: number | undefined;
  /** Centre of the title along the axis, moved off the plot centre only when centring would push
   *  a long title off the canvas. Undefined = centre on the plot rect. */
  titleCenter?: number | undefined;
  /**
   * A vertical axis's title when it is not drawn at its default turn (Axis tab ▸ Title direction):
   * the text's anchor point (baseline), its anchor, and its angle in degrees turned anticlockwise from
   * level. Every renderer draws the title from this when present — `translate(x y) rotate(-angle)`.
   * `text`: the title broken into lines to fit beside the axis; undefined = the title as typed.
   * Undefined = the default turned title, placed from `titlePos` / `titleCenter`.
   */
  titleTurn?: { angle: number; x: number; y: number; anchor: "start" | "middle" | "end"; text?: string | undefined } | undefined;
  /** Categorical (band) axis — ticks are category labels at band centres; no pan/zoom or gridlines. */
  band?: boolean;
  /** Axis-line + tick colour (hex), or null/undefined for the theme default. */
  lineColor?: string | null;
  /** Axis-line thickness px; undefined = renderer default (1.25). */
  lineWidth?: number;
  /** Tick-mark thickness px; undefined = follow the axis line thickness. */
  tickWidth?: number;
  /** Tick-mark length px for this axis; undefined = the plot-wide tickLen. */
  tickLen?: number;
  /** Hide this axis's tick marks (labels stay); undefined/false = show. */
  hideTicks?: boolean;
  /** Pixel positions of axis-break marks (compressed cuts) along this axis. */
  breakMarks?: number[];
  /** The visible stretches between the cuts and the pixels each occupies — present only when the axis has cuts.
   *  They let anything placed by value after the scale is gone (custom ticks, shaded bands) map through a cut
   *  axis instead of being dropped in silence. A value inside a cut
   *  still has no pixel — that is refused out loud instead. */
  segments?: Array<{ from: number; to: number; p0: number; p1: number }>;
  /** Glyph drawn at each break mark: "slash" (default), "zigzag" or "gap". */
  breakStyle?: "slash" | "zigzag" | "gap";
  /** Rotate this axis's tick-number labels by N degrees (resolved from the spec). */
  tickRotation?: number;
  /** Hidden axis (ticks/labels/title cleared at the choke point) — kept as a flag for
   *  the renderer to also suppress the axis line/gridlines if it wants. */
  hidden?: boolean;
  /** Pixel X for the axis line + ticks when the axis is drawn offset in the right margin
   *  (Y3, which stacks outside Y2). Undefined = the renderer's default (plot right edge). */
  axisX?: number;
  /** Where a second value axis is drawn: "top" on a horizontal bar chart, whose values run left
   *  to right; undefined = the right-hand side, as on every vertical chart.
   *  With "top", `range` runs left → right, each tick's `pos` is an x pixel, and `titlePos` is
   *  the title's baseline y above the tick numbers. */
  side?: "top" | undefined;
}

/** A single rendered datapoint, addressable by its source row's stable id. */
export interface MarkScene {
  /** Stable id of the source row — the override/selection key (never the index). */
  rowId: NodeId;
  /** 1-based row number, for the hover tooltip. */
  rowNumber: number;
  /** Data-space values (dy = the dataset mean / plotted centre). */
  dx: number;
  dy: number;
  /** Pixel coordinates within the scene (for bars: cx = bar centre, cy = value/top edge). */
  cx: number;
  cy: number;
  /** Bar rectangle in pixel space (present only on bar charts). */
  bar?: { x: number; y: number; w: number; h: number };
  /** Box-and-whisker geometry in pixel space (present only on box charts). */
  box?: {
    /** Box left edge + width. */
    x: number;
    w: number;
    /** Pixel Y of the quartiles (q3 = box top, q1 = box bottom) + median line.
     *  `median: null` suppresses the centre line entirely (floating bar "Line = None"). */
    q1: number;
    q3: number;
    median: number | null;
    /** Pixel Y of the whisker ends. */
    whiskerLow: number;
    whiskerHigh: number;
    /** Pixel Y of each outlier point (drawn as dots). */
    outliers: number[];
    /** Pixel Y (vertical) / X (horizontal) of the group mean — the "+" overlay
     *  (box / violin when Plot.showBoxMean). undefined = no mean glyph drawn. */
    mean?: number;
    /** Draw only the mean "+" — no box/whiskers/median (a violin with its inner box
     *  hidden but "Show mean" still on). */
    meanOnly?: boolean;
    /** The notch (`SeriesStyle.boxNotch`): pixel position (Y upright, X horizontal) of median − / + 1.58·IQR/√n.
     *  Absent = a plain box. May reach past q1 / q3 (few values, a skewed group) — drawn as asked, and warned. */
    notch?: { low: number; high: number };
  };
  /**
   * Violin silhouette in pixel space (present only on violin charts): a closed
   * SVG path mirroring the KDE about the band centre `cx`, plus that centre + the
   * half-width extent (for selection hit-testing / edge handles).
   */
  violin?: {
    path: string;
    cx: number;
    halfWidth: number;
  };
  /**
   * Individual replicate dots for a column-scatter chart (present only on
   * `scatter`): each value's pixel position, pre-offset for density spread.
   */
  points?: { cx: number; cy: number }[];
  /** Per-mark fill override (value-graduated fills); falls back to the series paint. */
  fill?: string;
  /** Per-mark fill-opacity override (graduated transparency ramps). */
  fillOpacity?: number;
  /** Per-mark fill shape override (pattern / gradient / metallic / special) for a
   *  single bar "Format this bar"; falls back to the series fill. Takes precedence
   *  over `fill` (a flat colour) when present and non-solid. */
  fillSpec?: FillSpec;
  /** Per-mark contour colour / width override (single bar); falls back to series. */
  borderColor?: string;
  borderWidth?: number;
  /** Per-bar value-label override text; falls back to the formatted numeric value. */
  valueText?: string;
  /** Per-bar value-label pixel nudge (drag to reposition a single label). */
  valueDx?: number;
  valueDy?: number;
  /** Data-driven point label (`SeriesStyle.pointLabels`): the resolved text drawn
   *  beside this marker. undefined = no label. XY / area / bubble only. */
  pointLabel?: string;
  /**
   * Where that label sits relative to the mark centre, in px, after the placement rule has
   * kept it clear of the other marks, the connecting line, the legend and the other labels.
   * Absent = beside the marker (the default placement).
   *
   * Separate from `valueDx`/`valueDy`, which are the user's drag: the two add up, so a
   * dragged label still lands where the user put it and the rule never overwrites their work.
   */
  pointLabelDx?: number;
  pointLabelDy?: number;
  pointLabelAnchor?: "start" | "end";
  /** A leader line from this mark to its label, in scene px — present only when the placement
   *  rule had to move the label far enough that the pairing would otherwise be a guess. */
  pointLabelLeader?: { x1: number; y1: number; x2: number; y2: number; color?: string | undefined; width?: number | undefined };
  /** Per-mark symbol overrides ("Format this point" on an XY / scatter mark) —
   *  shape, size, fill mode, opacity, outline. Each falls back to the series symbol. */
  symbol?: SymbolShape;
  symbolSize?: number;
  symbolFill?: SymbolFill;
  symbolOpacity?: number;
  symbolOutline?: string;
  /** The swarm dot's own colour, from a per-point `pointColor` override — the per-mark twin of
   *  `SeriesScene.pointColor` (a bar drawn as dots, coloured one by one). */
  pointColor?: string;
  /** Per-mark interior fill for open markers; falls back to the series. */
  symbolFillColor?: string;
  /** Category label (categorical charts) — shown in the tooltip in place of dx. */
  label?: string;
  /** Replicate count behind this point (tooltip; n=1 → no error bar). */
  n?: number;
  /** Pixel Y of the lower / upper error-bar ends (absent when not drawable). */
  errLowCy?: number;
  errHighCy?: number;
  /** Pixel X of the lower / upper error-bar ends — horizontal bars only. */
  errLowCx?: number;
  errHighCx?: number;
  /** Data-space error-bar reach (for the tooltip). */
  errLow?: number;
  errHigh?: number;
}

/** A cross-series spread ribbon + optional dotted mean line, in pixel space. */
export interface SpreadBandScene {
  /** Closed SVG path for the shaded ribbon (low edge out, high edge back). */
  bandPath: string;
  /** Ribbon fill colour + opacity. */
  color: string;
  opacity: number;
  /** Dotted mean-across-series line ("" when hidden). */
  meanPath?: string;
  /** Mean-line colour. */
  meanColor?: string;
  /** Direct end label for the mean line + its anchor point, when labelled. */
  meanLabel?: { text: string; x: number; y: number; color: string };
}

export interface SeriesScene {
  id: NodeId;
  /** Series label — the source column's name (drives the legend + tooltip). */
  name: string;
  /** Set when the series is borrowed from another datasheet (`plot.overlays`): which table it
   *  came from and that sheet's name — the Series-row chip, the tooltip and the legend name it,
   *  so a reader never mistakes it for a column of the plot's own sheet. Absent = local. */
  from?: { table: NodeId; name: string } | undefined;
  /** Resolved colour (fill when filled; marker + series identity otherwise). */
  color: string;
  /** Resolved connecting-line colour — independent of the marker colour (omitted =
   *  follow `color`, so the line and points stay linked until overridden). */
  lineColor?: string;
  /** SVG path data for the connecting line/curve; "" when not connected. */
  linePath: string;
  /** Composite: an overlaid connecting line drawn over a categorical (bar) chart when
   *  this series' `plotAs` is "line" — a bars+line combination graph. "" / absent otherwise. */
  overlayLine?: string | undefined;
  /** SVG path filling from the line down to the baseline (area charts); "" otherwise. */
  areaPath?: string;
  /** Nested level bands replacing this series' plain fill (ridgeline `bands`): one filled
   *  path per level, drawn in order so deeper levels sit on shallower ones — the
   *  iso-contour / horizon figure. Colours are resolved by the builder (light tint → the
   *  ramp anchor; positive and negative sides on their own hues). Absent = no banding. */
  levelBands?: { path: string; color: string }[] | undefined;
  /** Filled band following this series: the survival CI, or (XY / area) the error interval
   *  drawn as a ribbon instead of T-bars — `SeriesStyle.errorDisplay` = band/both. "" otherwise. */
  bandPath?: string | undefined;
  /** Band fill opacity; undefined = the renderer default. */
  bandOpacity?: number | undefined;
  /** Band fill colour; undefined = follow the line/series colour. */
  bandColor?: string | undefined;
  /** Band outline thickness (px), colour and dash. Width 0/undefined = no outline.
   *  Note: the outline traces the same closed path as the fill, so it can never disagree with
   *  the interval — there is no second geometry to keep in step. */
  bandEdgeWidth?: number | undefined;
  bandEdgeColor?: string | undefined;
  bandEdgeDash?: string | null | undefined;
  /**
   * Draw the T-bars? Default (undefined) = yes.
   *
   * False when `SeriesStyle.errorDisplay` is "band": the ribbon and the bars are the same
   * interval, so drawing both is double ink over identical numbers. The marks keep their
   * `errLow`/`errHigh` regardless — the axis domain, the tooltip and the exported data all
   * read them, and stripping them to hide a drawing would change the graph's extent as a
   * side effect of a rendering choice.
   */
  showErrorBars?: boolean | undefined;
  /** Censoring tick marks on a survival step line (pixel positions). */
  censorTicks?: { x: number; y: number }[] | undefined;
  /** Resolved marker + line style. */
  symbol: SymbolShape;
  symbolSize: number;
  /** Filled flag (= `symbolFill === "solid"`), a shorthand for consumers that only need solid vs not. */
  filled: boolean;
  /** Resolved symbol fill mode: solid / open (page colour) / clear (transparent). */
  symbolFill: SymbolFill;
  /** Symbol fill + outline opacity (0–1). */
  symbolOpacity: number;
  /** Symbol outline (border) colour — may differ from the fill/series colour. */
  symbolOutline: string;
  /** Interior fill for open markers (undefined = page colour, the hollow look). */
  symbolFillColor?: string;
  /** Colour of the raw-point swarm (raincloud rain, column-scatter dots, the points overlay on
   *  a box/violin/bar). Undefined = the series colour. */
  pointColor?: string;
  /** Resolved point-label colour + size (data-driven point labels); undefined =
   *  labels off / fall back to the series colour + the valueLabel font size. */
  pointLabelColor?: string;
  pointLabelSize?: number;
  borderWidth: number;
  /**
   * Outline thickness for the series' markers, when it must differ from `borderWidth`.
   *
   * Note: on a bar chart `borderWidth` is the bar's own contour width, and the markers are
   * the individual-points swarm drawn over it — two unrelated marks, so they need separate
   * widths or thickening a bar's outline would thicken every dot's outline with it.
   * Undefined everywhere else, where the marker is the series and inheriting
   * `borderWidth` is correct.
   */
  symbolBorderWidth?: number;
  lineWidth: number;
  /** SVG stroke-dasharray for the line, or null for solid. */
  dash: string | null;
  /** Draw caps (T-bars) on error bars. */
  errorCaps: boolean;
  /** Which half of each error bar to draw (up / down / both). */
  errorDir: ErrorBarDir;
  /** Resolved error-bar style. */
  errorColor: string;
  errorWidth: number;
  errorCapWidth: number;
  /** Resolved fill/contour style (bars + boxes). */
  fillColor: string;
  fillOpacity: number;
  borderColor: string;
  /** Resolved fill paint descriptor (solid / pattern / gradient / metallic). */
  fillSpec: FillSpec;
  // --- box & whisker glyph styling (only set on box/whisker series) ---
  whiskerSides?: WhiskerSides;
  whiskerColor?: string;
  whiskerWidth?: number;
  whiskerCaps?: boolean;
  whiskerCapWidth?: number;
  medianColor?: string;
  medianWidth?: number;
  showOutliers?: boolean;
  outlierSize?: number;
  /**
   * Direct label — this series' name printed on the drawing beside its own data, instead of a
   * legend row (`legend.position` = "direct"). Absent on every other setting.
   *
   * Placed by the builder against the same rule as every other label (clear of the marks, the
   * connecting lines, the plot edge and each other), in the series' own colour, at the series'
   * last point — the end of the line is where the eye already is.
   */
  directLabel?: {
    /**
     * The words to print — the legend row's text, which is not always the series' name.
     *
     * A ROC row reads "Biomarker (AUC 0.860, 95% CI 0.790–0.930)" for a series called
     * "Biomarker", and the AUC is the entire point of a ROC key. Drawing `series.name` would
     * lose it — and would draw a shorter string than the one the placer measured, so the box
     * it was kept clear of would be the wrong size too.
     */
    text: string;
    x: number;
    y: number;
    anchor: "start" | "middle" | "end";
    /** Thin line back to the point it names — only when the placer moved it far enough that
     *  the pairing would otherwise be a guess. */
    /** `color` / `width` only when the series sets its own leader look (`SeriesStyle.leader*`). */
    leader?: { x1: number; y1: number; x2: number; y2: number; color?: string | undefined; width?: number | undefined } | undefined;
    /** The user's own drag (`SeriesStyle.directLabelOffset`), carried through for the renderer
     *  to add on top of `x`/`y` — the same split the point labels use, so a nudge stays
     *  relative to wherever the rule put the name. */
    offset?: { dx: number; dy: number } | undefined;
  } | undefined;
  marks: MarkScene[];
}

/** One legend row: a colour swatch + the series label. `symbol`, when present,
 *  makes the renderer draw that marker shape (data-driven symbol/colour legend)
 *  instead of the default line+dot swatch. */
export interface LegendEntry {
  label: string;
  /** The row's label as built, when the user renamed it on the graph (`Plot.legendLabels`) and `label` is the new
   *  words — the key a further rename writes under. Undefined = `label` is the built label. */
  labelKey?: string | undefined;
  /** The label broken onto several lines, when it is too long for the right-hand column (`wrapLegendLabel`). Absent =
   *  one line, the label as it is. The label itself stays whole: it names the row. */
  lines?: string[] | undefined;
  color: string;
  /**
   * What clicking this row selects — set by the builder, which knows.
   *
   * Without it the renderer would have to reverse-engineer the target from the label string
   * (`scene.series.find(s => s.name === label)`), and that fails silently on eight kinds:
   * pie · treemap · radar · parallel · lollipop · paireddot draw outside the series layer so
   * `scene.series` is empty; volcano's rows are categories over one series; and ROC's row reads
   * "Biomarker (AUC 0.860)" against a series named "Biomarker" — a near miss an exact string
   * match never catches. On those kinds the click would fall through to the figure background
   * and select the whole graph.
   *
   * `as` names the selection kind, so a row can point at whatever it actually is:
   *  • `series` — a styled data series (`id` = its series/column id)
   *  • `pie-slice` / `treemap-cell` — one drawn part (`id` = its slice / cell id)
   *  • `section` — the row names a group with no per-object target of its own (a volcano
   *    category, a treemap region, a parallel-coordinates group). `id` is the Inspector
   *    section that owns that group's appearance, e.g. "Volcano". Clicking opens it.
   *
   *  • `annotation` — a drawn line the user listed in the legend (`id` = the annotation id)
   *  • `fit` — a fitted curve listed in the legend (`id` = "fit", or the index into `plot.fits`)
   *
   * Undefined = fall back to matching by name, which is right for every kind whose legend
   * labels are its series names.
   */
  select?: { as: "series" | "pie-slice" | "treemap-cell" | "section" | "annotation" | "fit"; id: string };
  /** The key's line dash (an SVG dasharray), for a row keying a dashed line — a reference line or a
   *  fitted curve listed in the legend. Undefined = a solid key. */
  dash?: string | undefined;
  /** The key's line width (px, before the legend's own scale), for a row keying a drawn line or
   *  fitted curve, so the key is as thick as the line it names. Undefined = the series stub width. */
  lineWidth?: number | undefined;
  symbol?: SymbolShape;
  /** Edge colour of the key's symbol when it differs from `color` — an icon-array waffle's
   *  two-tone category (light fill, darker edge), so the key looks like its cells.
   *  Undefined = the edge is `color`. */
  outline?: string;
  /**
   * Whether the swatch draws a data-point dot. Default (undefined) = yes, matching a
   * series that plots points. Set false for a line-only trace (ROC, Kaplan-Meier) so its
   * swatch is just the line — otherwise the legend implies data points the curve never draws.
   */
  marker?: boolean;
  /**
   * Whether the swatch draws a line. Undefined = yes; false for a series that draws no line (a scatter, a
   * swimmer's events, an ordination's sites) — no line in the
   * legend when none is in the graph. Set at the choke point from what the series draws.
   */
  line?: boolean | undefined;
  /**
   * The key's marker, copied from the dots this row names, for a chart that draws its dots itself and has no
   * `scene.series` for the legend to read (radar, lollipop, paired dot). Same fields the renderer's `Marker`
   * takes. Undefined = the series' own marker, or the flat `color`.
   */
  dot?: {
    shape?: SymbolShape | undefined;
    size: number;
    color: string;
    fill: SymbolFill;
    fillColor?: string | undefined;
    outline: string;
    opacity?: number | undefined;
    borderWidth: number;
  } | undefined;
  /** A data-driven row (one category of a colour-by-column binding): its `color` is the
   *  category's, not the series', so the key must be drawn solid in that colour — the way
   *  `paintMarkColour` draws the points — never in the series' two-tone tint. */
  dataDriven?: boolean;
  /**
   * The series' configured marker radius (px), so the legend swatch matches the data point
   * size — set the point size to 6 and the legend symbol becomes 6. Stamped
   * by `resolveLegend` from the series' `symbolSize`; undefined = the series uses the default
   * marker size, and the renderer draws its default swatch.
   */
  symbolSize?: number;
  /**
   * "bar" = the row keys a bar series, so the swatch is a small fill block carrying the bar's
   * resolved fill + contour — sized by the legend font, like every journal's bar key. Without
   * it a bar row would draw the line-stub + point-marker key, which (a) implies a line and points
   * the bars never draw, and (b) with the marker following the series' point size, inflates to
   * the swarm-dot radius — a giant dot keying invisible points on a stacked bar.
   * A bar series rendered `plotAs: "line"`
   * keeps the stub+dot key: that row really is a line.
   */
  swatch?: "bar";
  /** Inside a "bar" block: draw the key as a pie wedge (a pie's slice) or a square (a waffle's cell) instead of
   *  the bar's upright block — the key takes the shape of the mark it names wherever it can. */
  keyShape?: "wedge" | "square" | undefined;
}

/** Resolved legend placement / framing for the renderer. */
export interface LegendLayout {
  /** "right" = outside column (margin reserved); "top" = outside row above the plot (top band
   *  reserved, `topRows` says how the entries wrap); corners overlay the plot; "none" = hidden;
   *  "direct" = no legend block at all — each series is named on the drawing (`directEntries`). */
  position: "right" | "top" | "topright" | "topleft" | "bottomright" | "bottomleft" | "none" | "direct";
  /**
   * Outside-top legend only: the entries of `PlotScene.legend` grouped into the rows they wrap
   * into (indices, in order), decided by the builder with the same text measure it used to
   * reserve the top band. The renderer lays the rows out from this rather than wrapping again
   * with its own width estimate — two wraps that disagree by one row would put the legend on
   * the title or on the plot.
   */
  topRows?: number[][] | undefined;
  /**
   * Direct labels — the rows that became names on the drawing instead of a legend block
   * (`position` = "direct"). Present only then, and `PlotScene.legend` is empty beside it,
   * because there really is no legend: the `scene.legend.length > 0` checks that draw the
   * block, and the panel assembler's shared legend, all go quiet on the same fact.
   *
   * Carried here rather than plumbed separately because every builder already hands its
   * resolved layout to the scene; the placement pass at the choke point reads it there.
   */
  directEntries?: LegendEntry[] | undefined;
  /** Loose rows (`Plot.legendLoose`): pulled out of the block and drawn on their own at (x, y) — the row's top-left,
   *  figure px. `index` = the row's place in the full order, so the block can open that slot when it comes back.
   *  Absent when none is loose. `PlotScene.legend` holds the rows still in the block. */
  looseEntries?: { entry: LegendEntry; index: number; x: number; y: number }[] | undefined;
  orientation: "vertical" | "horizontal";
  border: boolean;
  background: boolean;
  /** Distance (px) from the plot for an outside legend; default 12. */
  gap: number;
  /** Padding (px) from the plot corner for an inside legend; default 8. */
  inset: number;
  /**
   * Extra horizontal offset (px) for an outside-right legend, so it clears content a
   * builder draws in the right margin before the legend column (e.g. paired-dot rotated
   * section labels, a Y2 axis). The builder already reserved this space in `marginRight`;
   * without it the legend lands on top of that content. Default 0.
   */
  outsidePad?: number | undefined;
  /** Legend symbol size as a multiple of the font-derived size (`LegendSpec.symbolScale`).
   *  Default 1. The renderer scales the marker / line stub / dot by it, and the swatch
   *  column width below was reserved with the same number. */
  symbolScale: number;
  /** A bar series' key shows its data point instead of the bar block (`LegendSpec.barKey`). Absent = the bar. */
  barKey?: "point" | undefined;
  /**
   * The frame / paper / padding the user chose, when they chose any. Each is absent unless set,
   * and the renderer falls back to its standard values (line colour, 1 px, radius 4,
   * paper fill, 6 px pad) when none is set.
   */
  borderColor?: string | undefined;
  borderWidth?: number | undefined;
  borderRadius?: number | undefined;
  backgroundColor?: string | undefined;
  padding?: number | undefined;
  /** Width (px) reserved for the swatch column, left of every label. Grows with the legend
   *  font and `symbolScale`, so a big symbol never sits under the text. */
  swatchWidth: number;
}

/** A resolved annotation in pixel space (the annotation layer). `line` covers
 *  reference lines; `text`/`bracket`/`rect`/`ellipse`/`arrow`/`segment`/`callout`
 *  are the drawing shapes. All geometry is in pixel space. */
export interface AnnotationScene {
  id: string;
  kind: "line" | "text" | "bracket" | "rect" | "ellipse" | "image" | "arrow" | "segment" | "callout" | "band";
  /** Endpoints (line/arrow/segment) or box corners (rect/ellipse/image: x1,y1 = top-left, x2,y2 = bottom-right). */
  x1?: number;
  y1?: number;
  x2?: number;
  y2?: number;
  /** Image bytes as a data URI (kind "image"). */
  href?: string;
  /** SVG path for a multi-segment shape (kind "bracket"). */
  path?: string;
  /** Stroke / text colour, or null for the theme default. */
  color: string | null;
  /** Interior fill (rect/ellipse/callout box), or null for none. */
  fill?: string | null;
  /** Interior fill opacity (0–1). */
  fillOpacity?: number;
  /** Arrowhead placement (arrow/segment/callout). */
  arrowHead?: "none" | "end" | "both";
  /** Rotation in degrees about the shape centre (rect/ellipse). */
  rotation?: number;
  /** SVG stroke-dasharray, or null for solid. */
  dash: string | null;
  width: number;
  /** Round line caps + joins (kind "bracket", shape "rounded"). */
  round?: boolean;
  /** The lateral offset already baked into this bracket's geometry, in px along the
   *  category axis. The renderer needs it to continue a drag from where the bracket
   *  actually is: without it a second drag would jump the bracket back to its home. */
  shift?: number;
  /** This bracket's height was not chosen by the user (no `bracketY`), so the layout
   *  pass may move it clear of the data. A user-set height is never touched. */
  autoY?: boolean;
  /** This bracket's `bracketY` came from the significance planner's data-unit ladder
   *  ([[Annotation.plannedY]]), not from a hand — the layout pass may lift the whole
   *  planned set, uniformly, clear of pixel ink it could not know about (a house-sized
   *  point's disc). Dragging the height clears the source flag, so this never marks a
   *  user decision. */
  plannedY?: boolean;
  /** Free position & size is on for this bracket: the renderer offers round handles on
   *  its two ends; dragging one commits that end as a plot-rect fraction (x/x2). */
  freeform?: boolean;
  /** Legs that reach the bars (`significance.legs === "reach"`): the value-axis pixel where
   *  each leg ends — absolute, anchored to the ink under that end. The auto-placement pass
   *  moves the rail but re-pins the leg ends here, so a lifted bracket does not drag its legs
   *  down into the bars with it. */
  legEnds?: { v1: number; v2: number };
  /** The geometry is fixed — the renderer must not offer a move/resize/delete affordance.
   *  True for a user-locked annotation, and for builder-owned shapes whose position is data
   *  (a PCA loading arrow = the loading vector). Selection + style edits still work; without
   *  this the renderer shows a `cursor:move` + drag handles that the document layer refuses,
   *  which is a dead affordance. */
  locked?: boolean;
  /** This element cannot be deleted (default: it can).
   *
   *  Distinct from `locked`, which is about geometry: a builder-owned label (a pyramid value,
   *  a PCA loading name) is freely movable and renamable, yet deleting it is meaningless —
   *  it has no entry in `plot.annotations` and the builder regenerates it from the analysis
   *  on the next rebuild. `removeAnnotation` therefore refuses it, so the renderer must not
   *  draw a × or honour the Delete key on it. Hide the whole class with its kind's
   *  show-labels toggle instead. */
  deletable?: boolean;
  /** Optional caption + its anchor point. */
  label?: string;
  labelX?: number;
  labelY?: number;
  labelAnchor?: "start" | "middle" | "end";
  /** This caption can be nudged off its anchor, and this is the offset it currently carries
   *  (px, already committed — the renderer translates by it rather than the builder baking it
   *  in, matching PieSlice / ParallelAxisScene).
   *
   *  Presence is the affordance: absent = the caption is welded to the shape. It exists for
   *  the one case where the two differ — a `locked` line whose position is a computed
   *  statistic (Bland-Altman's bias / limits of agreement) but whose readout is presentation
   *  and lands on the data. The line stays put; the words move. */
  labelOffset?: { dx: number; dy: number } | undefined;
  /** Label font size (kind "text"/"callout"); undefined = the renderer's default. */
  fontSize?: number;
  /** Which data anchors (`Annotation.anchorX` / `anchorY`) the builder resolved for this annotation's point
   *  (a text's point; a callout / arrow / line's end). Absent = the point sits at its plot position. The renderer turns
   *  a drag of an anchored point back into values through this. */
  anchored?: "x" | "y" | "xy" | undefined;
  /** The Y anchor was drawn across (the builder's horizontal layout: the value axis is visual X), so a drag reads the
   *  pinned value from the horizontal position. Said by the builder, never guessed from the drawing. */
  anchorAcross?: true | undefined;
  /** A text box's layout (kind "text"/"callout", `layoutTextBox`): the display lines, the x they are drawn at with
   *  `anchor`, and — when it has a background or a border — the box behind them. `label` / `labelX` / `labelAnchor`
   *  stay the text's own words and point, so editing, dragging and nudging never see a wrap. Absent = a plain text
   *  with no box. */
  textBox?: {
    lines: string[];
    x: number;
    anchor: "start" | "middle" | "end";
    box?: { x: number; y: number; w: number; h: number; rx: number; fill: string | null; fillOpacity: number; stroke: string | null; strokeWidth: number; dash: string | null } | undefined;
  } | undefined;
  /** Label colour when it differs from the shape's stroke (a significance symbol printed
   *  in a different ink from its bracket); undefined = follow `color`. */
  labelColor?: string | null;
  /** Text-box font family stack (kind "text"/"callout"); undefined = theme default. */
  fontFamily?: string;
  /** Bold / italic text (kind "text"/"callout"). */
  bold?: boolean;
  italic?: boolean;
}

/** One pie slice (centred at the PieScene's cx/cy via the path; label is absolute). */
export interface PieSlice {
  /** Source dataset id — the selection target for per-slice editing. */
  id: NodeId;
  label: string;
  color: string;
  value: number;
  fraction: number;
  /** SVG arc path centred at (0,0) — render translated to (cx + ox, cy + oy). */
  path: string;
  /** Explode offset added to (cx, cy) when rendering this slice. */
  ox: number;
  oy: number;
  /** Absolute label anchor (already includes the explode offset). */
  labelX: number;
  labelY: number;
  /** Pre-formatted label text ("" = hidden). */
  labelText: string;
  /** Label drawn inside the slice (light) vs outside the rim (ink). */
  labelInside: boolean;
  /** An inside label's ink when white would not read on the slice's fill (a pale two-tone tint); absent = white. */
  labelInk?: string | undefined;
  /** Per-slice label font override; undefined = the shared `fonts.sliceLabel`. */
  labelFont?: ResolvedFont | undefined;
  /** Per-slice label drag offset (px); the label can be nudged off its auto anchor. */
  labelDx?: number | undefined;
  labelDy?: number | undefined;
  /** Slice border colour; null = the page background. */
  strokeColor: string | null;
  strokeWidth: number;
}

/** One unit cell of a waffle / square-grid pie: a filled square coloured by category.
 *  `id`/`label` are the slice-category (a row id for a parts-of-whole table), so a cell is
 *  the same selection target as its legend entry — clicking any cell selects that category. */
export interface WaffleCell {
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
  id: NodeId;
  label: string;
  /** Icon-array mode (`plot.waffleIcons`): the category's marker shape, drawn centred in the
   *  cell instead of the square. Undefined = the plain square. */
  shape?: SymbolShape | undefined;
  /** Icon edge colour (a two-tone category's darker edge); undefined = the fill colour. */
  outline?: string | undefined;
}

/** Resolved pie-chart geometry (kind "pie"). */
export interface PieScene {
  cx: number;
  cy: number;
  r: number;
  slices: PieSlice[];
  /** Waffle / square-grid display (`plot.pieDisplay === "waffle"`): a grid of unit cells
   *  coloured by category (each cell ≈ 1% of the whole). When present the renderer draws
   *  these instead of the arc `slices`; `slices` still ride along for legend/bbox parity. */
  cells?: WaffleCell[] | undefined;
  /** Count waffle (`plot.waffleUnit === "count"`): the line under the grid saying what one cell
   *  stands for ("1 icon = 3 patients"), centred under the grid in the legend font. */
  caption?: { text: string; x: number; y: number; offset?: { dx: number; dy: number } | undefined } | undefined;
  /** Anisotropic scale for the wedge paths (stretch-to-fill an elliptical box). The arc paths
   *  stay circular (radius r); the renderer applies `scale(sx,sy)` about the centre. Label
   *  positions are already scaled in the scene. undefined = a plain circle. */
  scale?: { sx: number; sy: number } | undefined;
  /**
   * Small multiples — one pie per "whole". A parts-of-whole table with more than one value
   * column is more than one whole (e.g. one column per sample), so it draws a grid of pies that
   * share one legend and one colour per slice-category. When present, the renderer draws these
   * panels instead of the single `cx/cy/r/slices` above (those still mirror the first panel so
   * every reader of the single-pie fields — getBBox, exports, tests — keeps working). A
   * single-whole pie leaves `panels` undefined and draws from `cx/cy/r/slices`.
   */
  panels?: PiePanel[] | undefined;
}

/** One pie in a small-multiples grid: its own centre/radius, title (the value column's name)
 *  and slices. Slice ids are the row ids, shared across every panel, so a slice category is one
 *  colour and one selection target everywhere it appears (a consistent legend across the grid). */
export interface PiePanel {
  cx: number;
  cy: number;
  r: number;
  slices: PieSlice[];
  /** The whole's name (the value column) drawn above the pie. */
  title: string;
  titleX: number;
  titleY: number;
  scale?: { sx: number; sy: number } | undefined;
}

/** One radar (spider) axis radiating from the centre to a labelled spoke end. */
export interface RadarSpoke {
  /** Spoke end (full-radius) pixel position. */
  x: number;
  y: number;
  /** Category label + its anchored text position (just past the spoke end). */
  label: string;
  labelX: number;
  labelY: number;
  labelAnchor: "start" | "middle" | "end";
  /** Source row id (the label's per-spoke drag-offset key) + the stored offset. */
  rowId?: NodeId | undefined;
  labelDx?: number | undefined;
  labelDy?: number | undefined;
}

/** Resolved isometric 3-D scatter geometry (kind "scatter3d"). All coords are pre-projected to 2-D pixels. */
export interface Scatter3DScene {
  /** Projected cube/axis edges (origin → each axis end) with an axis-name label.
   *
   *  Each edge also carries a real scale: `ticks` are the axis's tick marks
   *  projected onto the slanted edge (mark endpoints + number position, all pre-computed by the
   *  builder so they survive an orbit — the outward direction is recomputed per build), and
   *  `color`/`width`/`titleSize`/`tickFont` are that axis's own styling (AxisSpec), falling back
   *  to the shared `axisColor`/`axisWidth` and fonts when unset. `hidden` drops the edge, its
   *  ticks and its name while the data mapping stays. */
  axes: {
    x1: number; y1: number; x2: number; y2: number; label: string; lx: number; ly: number;
    ticks?: { x: number; y: number; tx1: number; ty1: number; tx2: number; ty2: number; label: string; lx: number; ly: number }[];
    color?: string | undefined;
    width?: number | undefined;
    titleSize?: number | undefined;
    tickFont?: ResolvedFont | undefined;
    hidden?: boolean | undefined;
  }[];
  /** Per-axis label drag offsets, in build order [X, Y, Z]. Applied on top of `lx`/`ly`,
   *  which the builder already nudges clear of the axis end. */
  labelOffsets: { dx: number; dy: number }[];
  /** Projected floor-grid line segments (the x–z plane at y=0). */
  floor: { x1: number; y1: number; x2: number; y2: number }[];
  /** Floor-grid line colour (undefined = a neutral theme line). */
  gridColor?: string | undefined;
  /** Whether the floor grid is shown. Default true. */
  showGrid?: boolean | undefined;
  /** Projected data points, sorted back-to-front (painter's order). `overrideFill` =
   *  a per-point colour override (highlight), else the shared marker fill is used. `alpha` =
   *  a per-point opacity factor (0–1) from the depth cue, absent when depth shading is off. */
  points: {
    x: number; y: number; color: string; r: number; rowId: NodeId; overrideFill?: string | undefined; alpha?: number | undefined;
    /** The point's own data values — its hover text in the interactive HTML export (a projected
     *  pixel cannot be read back into three values). */
    value?: { x: number; y: number; z: number } | undefined;
  }[];
  /** Isometric axis-line colour + width (honours the style preset's axis style). */
  axisColor: string;
  axisWidth: number;
  /** Resolved point-marker paint (so the house two-tone / open markers carry through). */
  marker: { fill: string; stroke: string; width: number; opacity: number };
  /** Current orbit camera (radians + zoom) so the figure can compute drag deltas. */
  cam: { az: number; el: number; zoom: number };
  /** The styling column id (the Y column) — the per-point selection / edit target. */
  seriesId?: NodeId | undefined;
}

/** Resolved radar/spider geometry (kind "radar"): spokes, concentric rings, one polygon per series. */
export interface RadarScene {
  cx: number;
  cy: number;
  r: number;
  spokes: RadarSpoke[];
  /** Concentric grid rings: radius + the value at that ring (for radial tick labels).
   *  `labelled: false` draws the ring but not its value — the labels all stack at the same x up
   *  the vertical axis, so at a large font they run into each other and into the topmost spoke
   *  label. These are numeric axis values, so thinning them is the right trade (unlike a
   *  category name, which is never redundant). */
  rings: { radius: number; value: number; labelled?: boolean | undefined }[];
  /** One closed polygon per series: vertices (pixel), stroke colour, and resolved fill + opacity. */
  polygons: { id: string; name: string; color: string; fill: string; fillOpacity: number; lineWidth?: number; points: { x: number; y: number }[]; vertexFill?: string; vertexOutline?: string | undefined }[];
  /** Spoke (radial axis) line colour + width. */
  spokeColor?: string | undefined;
  spokeWidth?: number | undefined;
  /** Concentric-ring (grid) colour + width. */
  gridColor?: string | undefined;
  gridWidth?: number | undefined;
  /** Vertex markers: whether to draw a dot at each vertex, and its radius. */
  showDots?: boolean | undefined;
  dotSize?: number | undefined;
  /** SVG stroke-dasharray for the rings / spokes, or null for solid. */
  gridDash?: string | null | undefined;
  spokeDash?: string | null | undefined;
  /** Tick marks on the vertical axis at each labelled ring (pixel segments), with their
   *  colour. Absent = none. Their geometry is computed by the builder so the renderer never
   *  has to work out where a ring meets the vertical. */
  ticks?: { x1: number; y1: number; x2: number; y2: number }[] | undefined;
  tickColor?: string | undefined;
  /** Font for the spoke category labels, and for the ring value labels. Undefined = the
   *  chart's tick font. */
  labelFont?: ResolvedFont | undefined;
  ringFont?: ResolvedFont | undefined;
  /** Per-series spread whiskers (radar's error bars): for each series, a radial segment at each
   *  vertex from the low to the high value along its spoke, with small end caps. Present only
   *  when `radar.errorType` is set and the data has replicate/summary spread. */
  errorBars?: { id: string; color: string; width: number; segments: { x1: number; y1: number; x2: number; y2: number }[] }[] | undefined;
  /** Per-series spread bands: the low + high polygons whose in-between area the renderer shades
   *  (an even-odd path). Present only when `radar.errorBand` is on and the data has spread. */
  errorBands?: { id: string; fill: string; fillOpacity: number; lo: { x: number; y: number }[]; hi: { x: number; y: number }[] }[] | undefined;
}

/** One Voronoi-treemap cell: a convex polygon sized by its value, plus its label. */
export interface TreemapCellScene {
  /** Source row id — the per-cell selection / style target. */
  id: string;
  label: string;
  value: number;
  /** Cell polygon vertices (pixel space). */
  points: { x: number; y: number }[];
  fill: string;
  fillOpacity: number;
  /** Label anchor (the cell's visual centre, pixel space). */
  labelX: number;
  labelY: number;
  /** Resolved label font size (px). */
  labelSize: number;
  /** Auto-contrast label colour (dark on light cells, light on dark). */
  labelColor: string;
  /** Value string drawn beneath the label ("" = none). */
  valueLabel: string;
  /** Per-cell label drag offset (px) — set by dragging the cell label. */
  labelDx?: number | undefined;
  labelDy?: number | undefined;
  /** Per-cell border override (wins over the treemap's global stroke). */
  stroke?: string | undefined;
  strokeWidth?: number | undefined;
  /** Small icon/emoji drawn as a badge atop the cell (from the icon column). */
  icon?: string | undefined;
  /**
   * Baseline y for that icon, absolute like `labelY`.
   *
   * Note: the builder owns this. The lift is computed once here and read by the placement
   * pass, the de-confliction pass and the renderer, so a change to the geometry in the
   * builder reaches the drawing; separate copies of the factor would drift apart.
   */
  iconY?: number | undefined;
}

/** A region heading placed just outside the treemap boundary (from `showGroupLabels`). */
export interface TreemapGroupLabelScene {
  /** The group value — also the drag-offset key. */
  text: string;
  /** Anchor point on the perimeter (pixel space). */
  x: number;
  y: number;
  /** Tangential rotation (deg) so the label reads along the boundary arc. */
  angle: number;
  color: string;
  fontSize: number;
  /** Per-region drag offset (px), from `groupLabelOffsets`. */
  dx?: number | undefined;
  dy?: number | undefined;
}

/** Resolved Voronoi-treemap geometry (kind "treemap"): area-proportional convex cells. */
export interface TreemapScene {
  cells: TreemapCellScene[];
  /** Cell border colour + width. */
  stroke: string;
  strokeWidth: number;
  /** Whether to draw the per-cell labels. */
  showLabels: boolean;
  /** Region headings around the boundary (empty = none). */
  groupLabels?: TreemapGroupLabelScene[] | undefined;
}

/** One vertical axis of a parallel-coordinates plot (a variable). */
export interface ParallelAxisScene {
  /** Axis x pixel. `topY`/`botY` are the drawn extent of the rule — they say nothing about
   *  which end is the low value; see `yAtMin`/`yAtMax` for that. */
  x: number;
  topY: number;
  botY: number;
  /**
   * Pixel y of this axis's minimum and maximum. Normally `yAtMin === botY`, but a reversed
   * axis swaps them.
   *
   * The renderer must interpolate between these, never re-derive the direction from
   * `topY`/`botY` and a flag. The brush converts a pixel drag into a data range and back, so
   * if the builder and the renderer disagreed about which end is "low", a brush would silently
   * select the inverse of what was dragged over — on that one axis, with no error anywhere.
   * Carrying the two endpoints means the two sides cannot disagree.
   */
  yAtMin: number;
  yAtMax: number;
  /** Variable name + its draggable label anchor (above the axis top). */
  label: string;
  labelX: number;
  labelY: number;
  /** Source column id (the label's drag-offset key) + stored offset. */
  colId?: string | undefined;
  labelDx?: number | undefined;
  labelDy?: number | undefined;
  /** Axis data range — the column's own extent, not rounded outward, so the bundle fills the
   *  axis. The tick ladder sits inside it. This is also the domain the renderer's brush
   *  maths reads back, so it must stay the domain the lines were scaled through. */
  min: number;
  max: number;
  /** Value-tick ladder, low → high. Every label on one axis carries the same decimal count
   *  (enough to print each value exactly), so an axis never mixes "6" with "1.30" and never
   *  rounds a tick into a value it is not at. Empty when `showTicks` is off. */
  ticks: ParallelTickScene[];
  /** Active brush filter on this axis, [lo, hi] in data units (undefined = none). */
  brush?: [number, number] | undefined;
}

/** One value tick on a parallel-coordinates axis. */
export interface ParallelTickScene {
  /** Data value and its pixel y on the axis. */
  value: number;
  y: number;
  label: string;
  /** A minor tick: drawn shorter and never labelled (`label` is ""). */
  minor?: boolean | undefined;
}

/** One polyline (a data row) crossing every axis of a parallel-coordinates plot. */
export interface ParallelLineScene {
  /** Source row id. */
  id: string;
  color: string;
  points: { x: number; y: number }[];
  /** Dimmed because it falls outside a brush filter (drawn faint, not hidden). */
  dim?: boolean | undefined;
  /** Per-line width override (px); undefined = the scene's `lineWidth`. */
  width?: number | undefined;
  /** Per-line opacity override (0..1); undefined = the scene's `lineOpacity`. */
  opacity?: number | undefined;
}

/** Resolved parallel-coordinates geometry (kind "parallel"). */
export interface ParallelScene {
  axes: ParallelAxisScene[];
  lines: ParallelLineScene[];
  lineWidth: number;
  lineOpacity: number;
  /** Smooth (curved) links vs straight segments. */
  curved: boolean;
  /** Draw each axis' value-tick ladder. */
  showTicks: boolean;
  /** Tick-mark length + the gap to its label (px), drawn to the left of the axis. */
  tickLen: number;
  /**
   * Font for the variable name above each axis — `fonts.axisTitle`, deliberately not the tick
   * font the scale numbers use.
   *
   * An axis draws two different things; sharing one font would give them the same size,
   * weight and colour and they could not be tuned apart: shrinking the numbers would shrink
   * the names with them. The name is the axis's title; the numbers are its ticks.
   */
  nameFont: ResolvedFont;
  /** Axis line colour + width. */
  axisColor?: string | undefined;
}

/** One heatmap cell rectangle, coloured by its value. */
export interface HeatCell {
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
  value: number | null;
  /** Grid position — the per-cell selection target. */
  row: number;
  col: number;
  /** Pre-formatted in-cell value label ("" = hidden). */
  label: string;
  /** Auto-contrast colour for the in-cell label. */
  labelColor: string;
  /** Bubble radius, px (cellShape "bubble" only): area ∝ the value's magnitude. Absent =
   *  tile mode, or a missing value (a bubble grid draws nothing for missing — the tiles'
   *  nanColor would read as a value-sized dot). */
  r?: number | undefined;
}

/** One hexagonal bin (hexbin mode): a flat-top hex path centred at (cx,cy), coloured by count. */
export interface HexBin {
  /** Closed SVG hexagon path centred at (cx,cy). */
  path: string;
  cx: number;
  cy: number;
  color: string;
  /** Number of points in the bin (the colour-mapped value). */
  count: number;
}

/** Resolved heatmap geometry (kind "heatmap"): cell grid + axis labels + a colour-scale bar. */
export interface HeatmapScene {
  cells: HeatCell[];
  /**
   * Column / row labels; dx/dy = this label's individual drag offset (px).
   *
   * Each label carries what it names. The drawn order is not the table order — clustering
   * reorders it, an annotation strip takes its column out of the matrix, and a collapse turns
   * many rows into one — so a renderer that hands back only the position would make a rename
   * land on whatever sits at that index in the table (e.g. with rows clustered [G1,G3,G5,…],
   * renaming the 2nd drawn row would rename G2).
   *
   * `ids` are the source objects this label stands for: one row / one dataset normally, several
   * when a collapse joined them. `groupValue` is set only for a collapsed label — it is the
   * annotation value the group shares, which is the thing a rename should actually change (and
   * what the editor opens with, so the "(mean of 3)" suffix is never typed back in).
   */
  colLabels: { label: string; x: number; dx?: number; dy?: number; ids?: NodeId[]; groupValue?: string; trackIndex?: number }[];
  rowLabels: { label: string; y: number; dx?: number; dy?: number; ids?: NodeId[]; groupValue?: string; groupColumn?: NodeId }[];
  /** Point-data mode (density2d / hexbin): draw continuous X/Y axes + gridlines + frame. */
  pointMode?: boolean;
  /** Hexagonal bins (hexbin mode); undefined/empty otherwise. */
  hexes?: HexBin[];
  /** Set (point mode only) when the table has no usable (x,y) points — e.g. a matrix
   *  heatmap switched to density2d/hexbin. A centred message is drawn in the plot instead
   *  of an empty canvas / a meaningless flat field, telling the user to switch Mode to
   *  "matrix". Absent when the mode drew normally. */
  notice?: string | undefined;
  min: number;
  max: number;
  /** Cell gridlines; null colour = none. */
  border: { color: string | null; width: number };
  /** Show the colour-scale bar. */
  showColorbar: boolean;
  /** Vertical colour-scale bar rect + its gradient stops (0→min … 1→max). */
  bar: { x: number; y: number; w: number; h: number };
  scaleStops: { offset: number; color: string }[];
  /** Optional colour-bar title (rotated label beside the bar). */
  colorbarTitle?: string | undefined;
  /** Intermediate colour-bar ticks (value + y). Auto = quartiles + the renderer draws
   *  min/max; custom (see colorbarCustom) = the user's explicit values only. */
  colorbarTicks?: { value: number; y: number }[] | undefined;
  /** The colour-bar ticks are the user's explicit values → the renderer must not also
   *  draw the auto min/max labels (they'd clash). */
  colorbarCustom?: boolean | undefined;
  /** Resolved font for the colour-bar labels/title; undefined = use scene.fonts.legend. */
  barFont?: ResolvedFont | undefined;
  /** Resolved font for the row/column labels; undefined = use the (capped) tick font. */
  labelFont?: ResolvedFont | undefined;
  /** Column-label rotation in degrees (0 = horizontal). */
  labelRotation?: number | undefined;
  /**
   * How far above the grid the column labels' pivot sits (px) — the twin of the correlation
   * matrix's field of the same name.
   *
   * A rotated column label is anchored at its end and rotated about that point, so its tail
   * hangs down-left by `width × sin(angle)`. A flat offset would let 45° labels fall into the
   * first row of cells while the band `marginTop` reserves for them sat empty. The builder
   * computes the lift and hands it to the renderer. At rotation 0 it is 5 px.
   */
  colLabelLift: number;
  /** Attached clustering dendrograms (SVG paths in the reserved margins), when the
   *  heatmap is clustered: `row` grows leftward beside the row labels; `col` grows
   *  upward above the columns. Both in the figure's pixel space. */
  dendrograms?: { row?: string | undefined; col?: string | undefined; color: string } | undefined;
  /**
   * Splits — the breaks that cut the matrix into blocks. One entry per split the user placed,
   * whether or not it draws a rule: a pure space has `lineWidth: 0` and still appears here, so
   * it can be clicked, counted and reasoned about. `x1..y2` is the full span of the break
   * across the cells (a row split runs horizontally, a column split vertically), and `gap` is
   * the space it opened, so the renderer can centre a rule inside it.
   */
  splits?: HeatSplitScene[] | undefined;
  /** Resolved font for the split block names; undefined = follow the row/column label font. */
  splitLabelFont?: ResolvedFont | undefined;
  /** Annotation strips beside the rows / above the columns (see [[HeatTrackScene]]). */
  tracks?: HeatTrackScene[] | undefined;
  /** Resolved font for the track names and their on-strip labels. */
  trackFont?: ResolvedFont | undefined;
  /**
   * How far the row / column labels move outward to clear the annotation strips.
   *
   * The strips sit between the cells and the labels — adjacency is the point of an
   * annotation — so without this offset a label would be drawn over a strip's words.
   * The renderer draws labels a fixed step outside the plot; this is the extra step.
   */
  labelInset?: { left: number; top: number } | undefined;
}

/**
 * One annotation strip, resolved to pixels.
 *
 * `blocks` are the drawn rectangles — one per row/column, already coloured. `runs` are the
 * runs of equal values, which is what a reader needs labelled: five consecutive "Treated" rows
 * want one word, not five. A run whose box is too small for its word carries `label: ""`, so
 * the renderer never has to decide whether text fits.
 */
export interface HeatTrackScene {
  axis: "row" | "col";
  /** The strip's name, drawn at its head. Empty = unnamed. */
  name: string;
  /**
   * Where the name is drawn: under a row strip, left of a column strip.
   *
   * `nameAngle` is -90 for a row strip — it reads bottom-to-top, hanging below the plot, and
   * the anchor point is the top of that text. A row strip's band is ~16px wide, so two
   * horizontal names centred under their own bands would print through each other
   * ("Depth" and "Tumour purity" would overlap).
   */
  nameX: number;
  nameY: number;
  /** Rotation of the strip name, degrees. -90 = reads bottom-to-top (row strips). */
  nameAngle?: number | undefined;
  blocks: { x: number; y: number; w: number; h: number; color: string; value: string }[];
  /** Labelled runs of equal values; `label` is empty when the run is too small to carry it.
   *  `value` is what the run names (its identity, for the label's own drag offset). */
  runs: { x: number; y: number; w: number; h: number; label: string; value: string; off?: { dx: number; dy: number } | undefined }[];
  /** True when the strip shades a number through a ramp (so it keys as a bar, not as hues). */
  numeric: boolean;
  /**
   * Numeric strips only: the strip's key — a small colour bar in the right-margin stack, with
   * the strip's name above it and its min/max at the ends. Absent on a categorical strip (its
   * own words are its key) and when `heatmap.trackKeys` is off.
   *
   * `stops` is a staircase for a stepped ramp (two stops share an offset at each class edge),
   * so the renderer paints segments rather than one blended gradient — the `tracks` kind's bar
   * and the main colour bar both do this, for the same reason.
   */
  key?: {
    bar: { x: number; y: number; w: number; h: number };
    stops: { offset: number; color: string }[];
    min: number;
    max: number;
    /**
     * What the key says it decodes, drawn above the bar. The strip's own name when it has one,
     * else the sheet column it reads (a strip is added unnamed, and a bar with numbers but no
     * subject would be an unreadable key). Empty only when there is neither — a
     * column strip whose values the user typed by hand and never named.
     */
    caption: string;
    /** Where the caption sits. */
    nameX: number;
    nameY: number;
    /** The whole key block's drag offset (px). */
    off?: { dx: number; dy: number } | undefined;
  } | undefined;
  /** The strip name's own drag offset (px). */
  nameOff?: { dx: number; dy: number } | undefined;
}

/** One drawn heatmap split (see [[HeatmapScene.splits]]). */
export interface HeatSplitScene {
  axis: "row" | "col";
  /** The index it sits after, as the user placed it. */
  at: number;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** Rule thickness in px; 0 = this split is a pure space and draws no rule. */
  lineWidth: number;
  color: string;
  /** SVG dash-array for the rule; null = solid. */
  dash: string | null;
  /** The space opened, px (0 when the split is a rule only). */
  gap: number;
  /** Block name drawn at the split; empty = none. */
  label: string;
  /** That name's own drag offset (px). */
  labelOff?: { dx: number; dy: number } | undefined;
}

/** One correlation-matrix cell: a glyph encoding r for the (row,col) variable pair. */
export interface CorrCell {
  /** Cell box (pixel space). */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Grid indices (row/column position in the matrix) — also the per-cell selection key
   *  (`{kind:"corr-cell", row, col}`) for click-to-recolour + the cellColors override. */
  row: number;
  col: number;
  /** The correlation value (null = not drawn: a hidden triangle half, or undefined r). */
  r: number | null;
  /** Diverging fill for this r (blue⁺ / red⁻, saturating toward white at r = 0). */
  color: string;
  /** SVG path for the glyph, positioned in the cell (pie wedge / circle / square). "" = none. */
  glyphPath: string;
  /** Faint full-circle outline behind a pie / circle glyph ("" = none). */
  outlinePath: string;
  /** In-cell value label ("" = hidden), its auto-contrast colour + text anchor. */
  label: string;
  labelColor: string;
  labelX: number;
  labelY: number;
}

/** One pie-glyph swatch in the correlation-scale legend. */
export interface CorrLegendItem {
  glyphPath: string;
  outlinePath: string;
  color: string;
  label: string;
  labelX: number;
  labelY: number;
}

/** Resolved correlation-matrix geometry (kind "corrmatrix"): a grid of r-encoding glyphs. */
export interface CorrMatrixScene {
  cells: CorrCell[];
  /** Column (top) labels: x centre + rotation degrees (label pivots about that point). Optional
   *  per-label drag offset dx/dy (px). */
  colLabels: { label: string; x: number; angle: number; dx?: number; dy?: number }[];
  /** Row (left) labels: y centre (right-aligned against the grid's left edge). Optional
   *  per-label drag offset dx/dy (px). */
  rowLabels: { label: string; y: number; dx?: number; dy?: number }[];
  /** The cell-grid rect (selection + block backdrop). */
  grid: { x: number; y: number; w: number; h: number };
  /** Square cell edge (px). */
  cell: number;
  /** Resolved row/column + value label size (px) — matches the builder's margin math. */
  labelSize: number;
  /** How far above the grid the column labels' pivot sits.
   *
   *  A rotated column label is anchored at its end, so its tail hangs down-left from the pivot by
   *  `width × sin(angle)`. With the pivot only a few px above the grid the tail would drop into the
   *  first row's band and collide with that row's label. The builder already reserves the
   *  rotated height in `marginTop`; this is the same number, so the renderer lifts the pivot into
   *  the space that was set aside for it instead of guessing a small constant. */
  colLabelLift: number;
  /** Gridline colour between cells; null = none. */
  border: string | null;
  /** Domain blocks: dashed dividers over the grid + a faint tint on the diagonal blocks. */
  blockDividers?: { x1: number; y1: number; x2: number; y2: number }[] | undefined;
  blockTints?: { x: number; y: number; w: number; h: number; color: string }[] | undefined;
  /** Correlation-scale legend (pie glyphs +1 … −1); undefined = hidden. `offset` = drag delta (px). */
  scaleLegend?: { title: string; titleX: number; titleY: number; items: CorrLegendItem[]; offset?: { dx: number; dy: number } } | undefined;
  /** Resolved row/column label font. */
  labelFont?: ResolvedFont | undefined;
}

/** One category block (stacked node) on an alluvial axis. */
export interface AlluvialNode {
  /** Axis index (0 = leftmost) + the category value. */
  axis: number;
  category: string;
  /** Block rect (pixel space). */
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
  /** Category + count label ("" = hidden) + its anchor. */
  label: string;
  count: number;
  labelX: number;
  labelY: number;
  labelAnchor: "start" | "end" | "middle";
  /** Label drag offset (px), stored per node in `pointStyles["<axisColId>:<category>"]`. */
  labelDx?: number | undefined;
  labelDy?: number | undefined;
  /** The axis's source column id — the key half of the drag offset above, and what a label
   *  drag has to report back. Undefined only if the axis column vanished from the table. */
  colId?: string | undefined;
}

/** One ribbon between adjacent alluvial axes (rows sharing a category pair). */
export interface AlluvialRibbon {
  /** Closed SVG path: a band from the left node's slice to the right node's slice. */
  path: string;
  color: string;
  opacity: number;
  count: number;
  /**
   * The node this ribbon's colour comes from — its category on the colour axis (the first axis
   * by default, the last when `colorBy: "last"`).
   *
   * Stated by the builder, which is the only thing that knows it: `nodeColors` is keyed
   * `"axis:category"` and a node on the colour axis recolours every flow it originates, so a
   * ribbon has no colour of its own to edit. Clicking a ribbon therefore selects that node —
   * the one whose swatch actually moves this band. Without this field the renderer would have
   * to guess from the pixel geometry, which is the mistake the legend row's `select` exists to
   * prevent (reverse-engineering a target from the label string).
   */
  select: { axis: number; category: string };
}

/** Resolved alluvial / parallel-sets geometry (kind "alluvial"). */
export interface AlluvialScene {
  nodes: AlluvialNode[];
  ribbons: AlluvialRibbon[];
  /** Axis (column) header labels: name + x centre + y, plus the drag offset and the source
   *  column id it is keyed by (`pointStyles["<colId>:<colId>"]`, the same self-keyed convention
   *  a parallel-coordinates axis label uses). */
  axisLabels: { label: string; x: number; y: number; dx?: number | undefined; dy?: number | undefined; colId?: string | undefined }[];
  /** Node block stroke colour. */
  nodeStroke: string;
}

/** One node of a node-link network graph (pixel space). */
export interface NetworkNode {
  /** Node id (also the selection target). */
  id: string;
  cx: number;
  cy: number;
  /** Radius, px. */
  r: number;
  color: string;
  /** Label text ("" = hidden). */
  label: string;
  /** The label this node would carry, kept when de-confliction dropped it because it would have
   *  landed on a higher-degree node's label. Same contract as `AxisTick.suppressedLabel`: the
   *  renderer draws `label`, but the node's identity is never lost to a layout decision. */
  suppressedLabel?: string | undefined;
  /** Which side of the node the label hangs on. "start" (default) puts it to the right; a node
   *  near the right edge flips to "end" so its name stays on the canvas instead of running off
   *  it — node positions are clamped to the plot, and this keeps their labels on it too. */
  labelAnchor?: "start" | "end" | undefined;
  /**
   * Where the label sits relative to the node centre, in px. Absent = the default placement
   * (beside the node, `r + 3` out on the `labelAnchor` side).
   *
   * Beside the node is often the one place a label cannot go: both sides are frequently over
   * an edge or another node. The placement rule can then put the label above or below, e.g.
   * "up-left of the node", which an anchor alone cannot express.
   */
  labelDx?: number | undefined;
  labelDy?: number | undefined;
  /** A leader line from this node to its label, in scene px — present only when the placement
   *  rule had to move the label far enough that which node it names would otherwise be a guess. */
  labelLeader?: { x1: number; y1: number; x2: number; y2: number } | undefined;
  degree: number;
  /** Per-node value (undefined = neutral colour). */
  value?: number | undefined;
  /** Outline colour (per-node override ⊕ shared ⊕ derived from two-tone). Undefined = the theme background ring. */
  stroke?: string | undefined;
  /** Outline width, px (per-node override ⊕ shared). Undefined = 1. */
  strokeWidth?: number | undefined;
}

/** One edge of a node-link network graph (pixel space). */
export interface NetworkEdge {
  /** Edge key `source→target` (also the selection + per-edge override target). */
  id: string;
  sourceId: string;
  targetId: string;
  /** Straight-line endpoints. */
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** Control point for a quadratic curve (undefined = straight line). */
  cx?: number | undefined;
  cy?: number | undefined;
  width: number;
  color: string;
  opacity: number;
}

/** Resolved node-link network geometry (kind "network"). No cartesian axes. */
export interface NetworkScene {
  nodes: NetworkNode[];
  edges: NetworkEdge[];
  /** Resolved node-label font size (px). The same number the builder de-conflicted the labels
   *  with — the renderer must draw at this size or labels will hide/collide inconsistently. */
  labelSize: number;
  /** Colour-scale legend for the per-node value (present only when values exist).
   *  `ramp` is a precomputed low→high colour strip the renderer draws directly.
   *  `minLabel`/`maxLabel` are the exact strings the renderer must draw — the builder
   *  measured them to reserve the left margin, so re-formatting in the renderer would give
   *  the geometry two sources of truth that can disagree. */
  valueLegend?: { min: number; max: number; ramp: string[]; minLabel: string; maxLabel: string } | undefined;
}

/** One dot on a lollipop/dumbbell row (a dataset's value for that category). */
export interface LollipopDot {
  /** Source dataset id — the per-series selection target. */
  id: NodeId;
  cx: number;
  cy: number;
  color: string;
  value: number;
  /** Pre-formatted value label ("" = hidden). */
  label: string;
  /** Resolved symbol style (series ⊕ per-point override). Each undefined field
   *  falls back to the lollipop default (circle / dotSize / solid / opaque). */
  symbol?: SymbolShape | undefined;
  size?: number | undefined;
  symbolFill?: SymbolFill | undefined;
  symbolOpacity?: number | undefined;
  symbolOutline?: string | undefined;
  /** Interior fill for an open dot (undefined = page colour). */
  symbolFillColor?: string | undefined;
  borderWidth?: number | undefined;
  /** Per-point nudge (px) for the value label — drag offset, from the point style. */
  valueDx?: number | undefined;
  valueDy?: number | undefined;
  /** Mean±error whisker along the value axis; undefined = none (a single/summary value with
   *  no spread, or the error type is "none" — lollipop error bars are opt-in). `lowPx/highPx` are the value-axis pixel ends; `low/high` the data-space values
   *  (used for the axis fit + tests). Styling is resolved (series ⊕ per-point override). */
  error?: {
    low: number;
    high: number;
    lowPx: number;
    highPx: number;
    color: string;
    width: number;
    capWidth: number;
    caps: boolean;
    dir: "both" | "up" | "down";
  } | undefined;
}

/** One category row of a lollipop/dumbbell chart: a stem + one or more value dots. */
export interface LollipopRow {
  /** Source category row id (selection). */
  rowId: NodeId;
  label: string;
  /** Connector line: baseline→dot (lollipop) or first→last dot (dumbbell), pixel space. */
  stem: { x1: number; y1: number; x2: number; y2: number };
  /** Per-row stem colour when the stem is linked to the data-point colour (follows
   *  this row's dot). undefined = use the chart-wide LollipopScene.stemColor. */
  stemColor?: string | undefined;
  dots: LollipopDot[];
  /** Green Δ% change label at the value end ("" / undefined = hidden). `dx`/`dy`
   *  are the drag nudge (px), stored under the reserved point-style key
   *  `__delta__:<rowId>` so the label is movable like the per-point value labels. */
  delta?: { text: string; x: number; y: number; anchor: "start" | "middle" | "end"; color: string; dx?: number | undefined; dy?: number | undefined };
}

/** Resolved lollipop / dumbbell geometry (kind "lollipop"). */
export interface LollipopScene {
  rows: LollipopRow[];
  /** Horizontal layout: value axis on X, categories band down Y. */
  horizontal: boolean;
  /** Dot radius + stem width (px). */
  dotSize: number;
  stemWidth: number;
  /** Stem colour; undefined = a neutral theme line. */
  stemColor?: string | undefined;
  /** Index/reference line (single-series baseline) in pixel space; undefined = none. */
  baseline?: { x1: number; y1: number; x2: number; y2: number };
}

/** One marker on a paired-dot row (a series' value for that category). */
export interface PairedDotMark {
  /** Source series (dataset) id — the per-series selection target. */
  id: NodeId;
  cx: number;
  cy: number;
  color: string;
  value: number;
  /** Pre-formatted value label ("" = hidden). */
  label: string;
  /** Stem baseline→dot for the `toZero` (double-lollipop) mode; undefined = none. */
  stem?: { x1: number; y1: number; x2: number; y2: number } | undefined;
  /** Resolved symbol style (series ⊕ per-point override); undefined fields fall back
   *  to the paired-dot default (circle / dotSize / solid / opaque). */
  symbol?: SymbolShape | undefined;
  size?: number | undefined;
  symbolFill?: SymbolFill | undefined;
  symbolOpacity?: number | undefined;
  symbolOutline?: string | undefined;
  symbolFillColor?: string | undefined;
  borderWidth?: number | undefined;
  /** Per-point value-label nudge (px), from the point style. */
  valueDx?: number | undefined;
  valueDy?: number | undefined;
}

/** One category row of a paired-dot chart: a set of markers (one per series). */
export interface PairedDotRow {
  /** Source category row id (selection). */
  rowId: NodeId;
  label: string;
  /** The label this row would carry when the rows are packed too tightly for even the
   *  minimum readable font, so `label` was blanked. Same contract as `AxisTick.suppressedLabel`:
   *  renderers draw `label`, but nothing that needs the row's identity is defeated by a purely
   *  visual decision. Undefined whenever `label` is already the full text. */
  suppressedLabel?: string | undefined;
  /** Row band centre y (pixel space) — the category-label baseline. */
  cy: number;
  marks: PairedDotMark[];
  /** Dumbbell connector joining the row's markers (`dumbbell` mode); undefined = none. */
  connector?: { x1: number; y1: number; x2: number; y2: number; color: string } | undefined;
}

/** A labeled group of contiguous rows (from the table's text grouping column). */
export interface PairedDotSection {
  /** Section text — also the label's drag-offset key. Always the full name, never trimmed,
   *  so a saved drag offset survives a resize that changes what is displayed. */
  label: string;
  /** What to draw: `label` trimmed to the section's band with an ellipsis, because the heading
   *  is rotated and a name longer than its band overruns the next section's heading. Undefined
   *  when the full name fits; empty string when even a trimmed one will not. */
  display?: string | undefined;
  /** Dashed divider drawn at the section's leading edge (pixel space); undefined = none. */
  divider?: { x1: number; y1: number; x2: number; y2: number } | undefined;
  /** Rotated section-label anchor on the right of the plot (pixel space). */
  labelX: number;
  labelY: number;
  /** Per-section label drag offset (px), from `sectionLabelOffsets`. */
  dx?: number | undefined;
  dy?: number | undefined;
}

/** Resolved paired / grouped Cleveland dot-plot geometry (kind "paireddot").
 *  Horizontal only: value axis on X, category bands down Y. */
export interface PairedDotScene {
  rows: PairedDotRow[];
  sections: PairedDotSection[];
  /**
   * Font size actually usable for the row labels, capped so stacked labels cannot collide.
   *
   * A vertical category axis has no `deOverlapX` equivalent — and dropping labels would be the
   * wrong answer here anyway, because on this chart every row is a named entity, so a blanked
   * label loses the reader's only handle on that row. Shrinking to fit keeps all of them, and
   * matches what the heatmap already does with its row/column labels.
   */
  labelFont: number;
  /** Dot radius + stem/connector width (px). */
  dotSize: number;
  stemWidth: number;
  /** Connector colour; undefined = a neutral theme line. */
  stemColor?: string | undefined;
  /** Section divider + label colour; undefined = a muted theme ink. */
  sectionColor?: string | undefined;
  /** Section-divider thickness, px. The dividers are a reference line (registry id
   *  `pd-section`), so this is resolved from `plot.refLineStyles` like every other one. */
  sectionWidth: number;
  /** Section-divider SVG stroke-dasharray, or null for solid. */
  sectionDash: string | null;
}

/** Resolved background-gridline style for the view. */
export interface GridScene {
  show: boolean;
  /** Gridline colour, or `null` to use the view's theme default. */
  color: string | null;
  width: number;
  /** SVG stroke-dasharray for gridlines, or null for solid. */
  dash: string | null;
  /** Draw minor-tick gridlines too (the faint ones). */
  minor: boolean;
}

/** Resolved frame + tick-mark style for the view (Axis tab → Frame). */
export interface AxisStyleScene {
  frame: FrameStyle;
  tickDir: TickDir;
  tickLen: number;
}

/** Axis labels for the hover tooltip (column names). */
export interface AxisLabels {
  x: string;
  y: string;
}

/** A fully-resolved font for one text element — defaults merged with overrides.
 *  `family`/`color` null = use the renderer's theme default. */
export interface ResolvedFont {
  /** Size in px. */
  size: number;
  /** CSS font-family stack, or null for the theme default. */
  family: string | null;
  /** Numeric weight (400 normal, 700 bold). */
  weight: number;
  italic: boolean;
  /** Hex colour, or null for the theme default (ink / muted). */
  color: string | null;
}

/** Resolved per-element typography, shared by the margin math and the renderer. */
export interface SceneFonts {
  /**
   * Tick labels — the shared fallback, and what non-axis "tick-styled" text uses
   * (heatmap cell labels, network node labels, treemap labels…).
   *
   * Note: for axis tick labels prefer the per-axis members below. A site that reads `tick`
   * gets the shared size, so it ignores a per-axis override but is never wrong otherwise.
   */
  tick: ResolvedFont;
  /** X-axis tick labels — `xAxis.tickFont` over the shared `tick`. */
  xTick: ResolvedFont;
  /** Y-axis tick labels — `yAxis.tickFont` over the shared `tick`. */
  yTick: ResolvedFont;
  /** Right-hand (Y2) axis tick labels. */
  y2Tick: ResolvedFont;
  /** Second right-hand (Y3) axis tick labels. */
  y3Tick: ResolvedFont;
  /** Axis titles (shared fallback; X/Y resolve their own below). */
  axisTitle: ResolvedFont;
  /** X-axis title — `xAxis.titleFont` over the shared `axisTitle`. */
  xAxisTitle: ResolvedFont;
  /** Y-axis title — `yAxis.titleFont` over the shared `axisTitle`. */
  yAxisTitle: ResolvedFont;
  /** Second value axis title (Y2 on the right, or X2 along the top of a horizontal chart) — `y2Axis.titleFont` over
   *  the main Y title font, over the shared `axisTitle` (`axisTitleFontSpec`). Present only when the axis has a title
   *  font of its own; absent, the title draws with the main value axis's title font, and the field adds nothing
   *  to the hash of a scene without the override (`preset-invariance.test.ts`). */
  y2AxisTitle?: ResolvedFont | undefined;
  /** Third value axis (Y3) title — `y3Axis.titleFont` over the main Y title font. Present only when set, as above. */
  y3AxisTitle?: ResolvedFont | undefined;
  /** Legend labels. */
  legend: ResolvedFont;
  /** Graph title heading. */
  title: ResolvedFont;
  /** Subtitle line under the title. */
  subtitle: ResolvedFont;
  /** Pie slice labels. */
  sliceLabel: ResolvedFont;
  /** Bar value (data) labels. */
  valueLabel: ResolvedFont;
}

/** A resolved confidence/data ellipse for one series, in pixel space. */
export interface EllipseSceneItem {
  /** Source series id (so it inherits / can be styled with the series). */
  id: NodeId;
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  /** Rotation of the major axis, degrees (SVG clockwise). */
  angle: number;
  color: string;
  fillOpacity: number;
  borderWidth: number;
}

/** An overlaid fitted curve (SVG path in pixel space) from a regression / curve-fit /
 *  global-fit analysis, with optional confidence & prediction bands. */
/** One distribution curve overlaid on a histogram (`PlotScene.distributionCurves`): the
 *  normal fit or the kernel density estimate. `label` names
 *  which; `dash` is the resolved SVG dash (null = solid) — the normal curve is dashed when
 *  both are drawn so they can be told apart. */
/** The Pareto cumulative-% line (`PlotScene.paretoLine`): a ready-to-draw path through one
 *  point per drawn category (the bar's centre x, the cumulative % on the Y2 scale). `points`
 *  carry the readout (value in %, category label) for hover/tests; the line is chrome — a
 *  readout of the bars — toggled + recoloured in the bar "Chart type" block. */
export interface ParetoLineScene {
  path: string;
  color: string;
  width: number;
  points: { cx: number; cy: number; value: number; label: string }[];
}

export interface DistributionCurveScene {
  path: string;
  color: string;
  width: number;
  dash: string | null;
  label: "normal" | "density";
}

export interface FitScene {
  path: string;
  color: string;
  label: string;
  /** Draw the curve itself (`fitStyle.show`); false = bands/marker/params only. */
  showCurve: boolean;
  /** Curve thickness px (default 2.4), dash pattern (SVG string, null = solid) and opacity —
   *  resolved from `plot.fitStyle`; an untouched graph draws the defaults. */
  width: number;
  dash: string | null;
  opacity: number;
  /** Band fills — colour + opacity — resolved from `plot.fitStyle` (defaults: the curve's
   *  colour at 0.18 for the confidence band and 0.08 for the prediction band). */
  ciColor: string;
  ciOpacity: number;
  piColor: string;
  piOpacity: number;
  /** Fitted-parameter block: typeset rich-text lines plus where to draw them. Present only
   *  when the fit carries parameters and the plot has not switched the block off. */
  params?: {
    /** The shown lines' text, in order (the user's own text where they typed one). */
    lines: string[];
    /** The same shown lines, one per statistic: its key (`PlotFit.paramKeys`) and its own
     *  drag offset. Drawn one text each unless `together`. Optional: a scene without it
     *  (a fit with no `paramKeys`) draws `lines` as one block. */
    items?: { key: string; text: string; offset?: { dx: number; dy: number } | undefined }[] | undefined;
    /** true = the lines drag as one block (`Plot.fitParams.together`); per-line offsets unused. */
    together?: boolean | undefined;
    /** Anchor inside the plot rect (already offset by any user drag). */
    x: number;
    y: number;
    size: number;
    anchor: "start" | "end";
    /** Persisted free-drag offset (px) from (x, y). */
    offset?: { dx: number; dy: number } | undefined;
  } | undefined;
  /** Filled-area SVG path for the 95% confidence band of the mean (if any). */
  confidenceBandPath?: string | undefined;
  /** Filled-area SVG path for the 95% prediction band (if any). */
  predictionBandPath?: string | undefined;
  /** Potency crosshair (dose-response): a vertical drop-line from the curve point
   *  (vx, cy) down to the X-axis (baseY) marks the EC50/IC50 dose; a segment from
   *  the Y-axis (leftX) to the point marks the response; `label` reads "EC50 = …". */
  marker?: {
    vx: number;
    cy: number;
    baseY: number;
    leftX: number;
    label: string;
    labelX: number;
    labelY: number;
    /** Persisted free-drag offset (px) of the label from (labelX, labelY). */
    labelOffset?: { dx: number; dy: number } | undefined;
    /** Text anchor of the label; absent = "start" (the default). Set by the router when
     *  a figure has two or more potency labels and one had to go to the left of its crosshair. */
    labelAnchor?: "start" | "end" | undefined;
    /** The label's own font when the graph sets one (`refLineLabelFonts["fit-marker"]`); absent = the tick font. */
    labelFont?: ResolvedFont | undefined;
    /** Line look — resolved through the reference-line registry (id `fit-marker`):
     *  `refLineStyles["fit-marker"]` → `refLine` → the built-in dashed look. */
    color: string;
    width: number;
    dash: string | null;
  } | undefined;
}

/** A continuous colour-scale bar for a data-driven "colour by a column" (continuous
 *  mode): a vertical gradient in the right margin with min/max + optional title. */
export interface ColorbarScene {
  bar: { x: number; y: number; w: number; h: number };
  /** Gradient stops (offset 0 = bottom/min … 1 = top/max). */
  stops: Array<{ offset: number; color: string }>;
  min: number;
  max: number;
  /** The bound column's name, drawn rotated beside the bar. */
  title?: string | undefined;
}

export interface PlotScene {
  /** Logical scene size (the SVG viewBox); the view scales it responsively. */
  width: number;
  height: number;
  /** Figure (paper) background fill; null/undefined = the theme default (no backing rect). */
  background?: string | null;
  /** Opt-in decorative backdrop (gradient + wave bands) drawn behind the whole figure;
   *  null/undefined = none, which is the default. Purely presentational. */
  backdrop?: BackdropScene | null;
  /** Inner plotting rectangle (inside the axis margins). */
  plot: { x: number; y: number; width: number; height: number };
  /** A picture panel (kind "image"): the bytes + how to fit them to [[plot]]. Present only
   *  for that kind — there is no data mapping, so the renderer draws this and nothing else.
   *  `rotate` (quarter turns) and `crop` (fractions of the displayed orientation) window the
   *  source; they need `naturalWidth`/`naturalHeight` (source px, captured at add time) to
   *  draw at the true aspect — absent on old panels, where the renderer measures at runtime. */
  image?: {
    src: string;
    alt?: string | undefined;
    fit: "contain" | "cover" | "fill";
    rotate?: 0 | 90 | 180 | 270 | undefined;
    crop?: { x: number; y: number; w: number; h: number } | undefined;
    naturalWidth?: number | undefined;
    naturalHeight?: number | undefined;
  } | undefined;
  x: AxisScene;
  y: AxisScene;
  /** Optional right-hand second value axis (Y2); present only when ≥1 series is assigned to it. */
  y2?: AxisScene | undefined;
  /** Optional right-hand third value axis (Y3), drawn outside Y2; present only when ≥1
   *  series is assigned to it. Its axis line sits at `axisX` (in the right margin). */
  y3?: AxisScene | undefined;
  /** The natural "home" domains auto-fit would pick (the soft-lock target for pan/zoom). */
  auto: { x: [number, number]; y: [number, number] };
  /**
   * The pan/zoom windows this scene's builder actually honours — one entry per zoomable
   * axis, absent/empty when it honours none.
   *
   * `visual` is the axis the user drags on screen; `key` is the `BuildPlotSceneOptions`
   * (and `GraphView`) domain the new window has to be reported back through. **They are
   * not always the same.** A horizontal bar draws its values along X, but that scale is
   * built from `yDomain` — categorical charts keep the value spec in `plot.yAxis`
   * whichever way they are drawn (`dataAxisOf`). Report a horizontal bar's zoom as
   * `xDomain` and nothing moves.
   *
   * The renderer must read this rather than test the kind. A kind list of its own would
   * miss scroll-to-zoom on every bar/box/violin whose builder honours a value-domain
   * override — and the inverse is worse: offering
   * the gesture on a kind that ignores the override is a silent no-op, where the drag
   * lands, the view state changes, and the picture never moves.
   */
  zoomable?: { visual: "x" | "y"; key: "x" | "y" }[] | undefined;
  series: SeriesScene[];
  /** An overlaid fitted curve (SVG path in pixel space), if the plot has one. */
  fit?: FitScene | undefined;
  /** Overlaid per-dataset fitted curves from a global fit (one per dataset),
   *  each colour-matched to its series; drawn in addition to `fit`. */
  fits?: FitScene[] | undefined;
  /** Continuous colour-scale bar (data-driven colour-by-column, continuous mode). */
  colorbar?: ColorbarScene | undefined;
  /** Cross-series spread ribbon (drawn behind the series) + optional dotted mean line. */
  spreadBand?: SpreadBandScene;
  /** Distribution curves drawn over the plot (the histogram's normal-curve + density-curve
   *  overlays), each a ready-to-draw SVG polyline path in pixel space plus its look. */
  distributionCurves?: DistributionCurveScene[] | undefined;
  /** Pareto cumulative-% line over a bar chart (`plot.paretoLine`), on the Y2 axis. */
  paretoLine?: ParetoLineScene | undefined;
  /** Per-series confidence/data ellipses (covariance ellipses in pixel space). */
  ellipses?: EllipseSceneItem[];
  /** Legend rows (one per series); empty when hidden/single-series. */
  legend: LegendEntry[];
  /** Resolved legend placement / framing. */
  legendLayout: LegendLayout;
  /** Resolved on-graph annotations (reference lines / text / brackets) in pixel space. */
  annotations: AnnotationScene[];
  /** Number-at-risk table under a survival graph: one row per curve (label + colour),
   *  `cols` = the X pixel of each time point (aligned to the axis), `top` = table origin. */
  atRisk?: {
    rowH: number;
    top: number;
    labelX: number;
    cols: number[];
    /** `seriesId` links the row back to its KM curve so clicking the row selects it. */
    rows: { label: string; color: string; seriesId: string; atRisk: number[] }[];
    /** The table's own font when the graph sets one (`survivalAtRiskFont`); absent = the tick font. */
    font?: ResolvedFont | undefined;
  } | undefined;
  /** Bar corner shape (bar charts): "square" | "rounded" | "roundtop". */
  barShape?: "square" | "rounded" | "roundtop";
  /** Bars run horizontally (value on X, categories on Y). Bar charts only. */
  barHorizontal?: boolean;
  /** How many bars share one category band's inner fill — the divisor the edge-drag width resize
   *  needs. Grouped bars = the series count; a colMode / stacked / overlay bar is one-per-band = 1.
   *  Resizing by `series.length` instead would make a one-per-band bar's width jump to the max,
   *  and it could never be narrowed (an edge handle that does nothing on the simple column bar). Bar charts only. */
  barsPerBand?: number;
  /** Three-way grouped bar: the outer group labels, one per cluster per category band, at
   *  absolute pixel positions (below the category tick labels on a vertical bar, left of them
   *  on a horizontal one). Empty / absent on an ordinary bar. Renderer draws them as plain text. */
  barGroupLabels?: { text: string; x: number; y: number; anchor: "start" | "middle" | "end" }[] | undefined;
  /** Bar value-label config (resolved); present + show=true → the renderer draws each bar's value. */
  valueLabels?: { show: boolean; decimals?: number | undefined; dy: number; placement?: "above" | "insideEnd" | "insideBase" | undefined };
  /**
   * Distribution charts (box/violin/scatter) run horizontally: the value axis is
   * X and the category bands run down Y. When set, the glyph geometry is
   * transposed — a box's `q1/q3/median/whiskerLow/whiskerHigh/outliers` are X
   * pixels and its `x/w` are the Y band start/extent; a violin's `cx` is the band
   * centre Y; a scatter's mean ± SD reach uses `errLowCx/errHighCx`.
   */
  distHorizontal?: boolean;
  /** Pie-chart geometry (only when kind = "pie"). */
  pie?: PieScene;
  /** Radar/spider geometry (only when kind = "radar"). */
  radar?: RadarScene;
  /** Voronoi-treemap geometry (only when kind = "treemap"). */
  treemap?: TreemapScene;
  /** Parallel-coordinates geometry (only when kind = "parallel"). */
  parallel?: ParallelScene;
  /** Isometric 3-D scatter geometry (only when kind = "scatter3d"). */
  scatter3d?: Scatter3DScene;
  /** Heatmap geometry (only when kind = "heatmap"). */
  heatmap?: HeatmapScene;
  /** Correlation-matrix geometry (only when kind = "corrmatrix"). */
  corrmatrix?: CorrMatrixScene;
  /** Alluvial / parallel-sets geometry (only when kind = "alluvial"). */
  alluvial?: AlluvialScene;
  /** Node-link network geometry (only when kind = "network"). */
  network?: NetworkScene;
  /** Lollipop / dumbbell geometry (only when kind = "lollipop"). */
  lollipop?: LollipopScene;
  /** Venn / Euler diagram (kind "venn"): one disc per set + the exclusive-zone counts.
   *  Discs are click-targets (selection "venn-set"); zone counts are computed data. */
  venn?: {
    circles: {
      /** The set's source dataset (column) id — the selection + colour key. */
      setId: string;
      label: string;
      cx: number;
      cy: number;
      r: number;
      color: string;
      fillOpacity: number;
      outline: string;
      outlineWidth: number;
      /** Set-label base anchor (px); the stored drag offset rides separately in
       *  `labelOff` so DraggableTitle can compose repeated drags (as upset does). */
      labelX: number;
      labelY: number;
      labelOff?: { dx: number; dy: number } | undefined;
    }[];
    /** Exclusive zones ("A" · "AB" · "ABC" …, letters in set order): count + label spot.
     *  `text` is the drawn string (count, plus the union share in percent mode). */
    zones: { key: string; count: number; text: string; labelX: number; labelY: number }[];
  };
  /** UpSet plot (kind "upset"): the membership dot matrix + left set-size bars drawn under
   *  and beside the intersection bars (which live in `series` — they are the bar builder's
   *  own marks, so value labels / brackets / hlines are the bar machinery's). Set-size bars
   *  and matrix row labels are click-targets (selection "upset-set"); counts are data. */
  upset?: {
    /** Drawn intersection columns, left→right (already sorted + truncated). `members` are
     *  indices into `sets`; `cx` is the shared column-centre x the bars + dots sit on. */
    columns: { key: string; members: number[]; count: number; cx: number }[];
    /** One row per (visible) set, top matrix row first. `bar` is the left set-size bar
     *  (absent when showSetSizes is off); `color` already resolves SeriesStyle over the
     *  dot colour. `labelX/labelY` is the base anchor; the stored drag offset rides
     *  separately in `labelOff` so DraggableTitle can compose repeated drags. */
    sets: {
      setId: string;
      label: string;
      total: number;
      rowCy: number;
      color: string;
      bar?: { x: number; y: number; w: number; h: number } | undefined;
      labelX: number;
      labelY: number;
      labelOff?: { dx: number; dy: number } | undefined;
    }[];
    /** Matrix band metrics: top edge, row pitch, dot radius. */
    matrix: { top: number; rowH: number; dotR: number };
    /** Default dot/connector colour (a set's `color` wins for its own dots). */
    dotColor: string;
  };
  /** Swimmer plot (kind "swimmer"): one timeline bar per subject, drawn by the generic
   *  figure as a layer under the event-glyph series (which live in `series` — real series,
   *  standard controls). A bar click selects the Start dataset's per-row point. */
  swimmer?: {
    /** Drawn top→bottom (already sorted). `barX1 ≤ barX2` in px; `duration` is data units. */
    rows: {
      rowId: NodeId;
      subject: string;
      cy: number;
      barX1: number;
      barX2: number;
      barH: number;
      color: string;
      ongoing: boolean;
      duration: number;
      /** Response-interval overlay (px), when the row carries both response values. */
      response?: { x1: number; x2: number } | undefined;
      /** Duration label (only when Plot.showValues); drawn in the value-label font. `dx`/`dy` are
       *  the drag offset (persisted in pointStyles like every other value label). */
      label?: { text: string; x: number; y: number; dx?: number | undefined; dy?: number | undefined } | undefined;
    }[];
    /** The bar-anchor (Start) dataset id — bar clicks + per-row colours key off it.
     *  Null in survival-date mode (no Start dataset exists; bars select the chart). */
    startId: NodeId | null;
    responseFill: string;
    responseOpacity: number;
  };
  /** Funnel plot (kind "funnel"): the pooled effect + the pseudo-CI region + optional
   *  zero-centred significance contours. Study dots live in `series` like any scatter;
   *  the pooled centre line is a registered reference line in `annotations`. */
  funnel?: {
    /** Pooled effect, value space (back-transformed on a log axis). */
    pooled: number;
    /** The SE-axis maximum the region base is drawn at. */
    seMax: number;
    /** Pseudo-CI triangle around the pooled effect; absent when showRegion is off. */
    region?: { path: string; apexX: number; halfWidthAtMaxSe: number; opacity: number } | undefined;
    /** Contour-enhanced significance bands (p .10/.05/.01), zero-centred; absent unless on. */
    contours?: { path: string; fill: string; opacity: number; p: number }[] | undefined;
    /** Trim-and-fill imputed (mirrored) studies, drawn as hollow dots above the region —
     *  chrome, not series marks (no table row exists to click). Absent unless the overlay
     *  is on and imputes at least one study. `est` is value space (back-transformed). */
    imputed?: { cx: number; cy: number; r: number; est: number; se: number }[] | undefined;
    /** Trim-and-fill readout while the overlay is on: how many studies were imputed, on
     *  which side, and the adjusted pooled effect (value space — the `funnel-adjusted`
     *  line's position). */
    trimFill?: { k0: number; side: "left" | "right"; adjusted: number } | undefined;
  };
  /** Polar histogram / wind rose (kind "rose"): the whole drawing is chrome-with-clicks —
   *  wedges are bins (many table rows each, never series marks; a wedge click selects the
   *  chart-section), the ring circles are the radial count ladder, and the direction
   *  labels are the angular axis's ticks. */
  rose?: {
    /** Centre + the full-scale radius in px. */
    cx: number;
    cy: number;
    maxR: number;
    /** One wedge per sector, in sector order (index 0 starts at 0°). `segments` are the
     *  stacked magnitude bands, innermost first (a single-band rose has exactly one). */
    wedges: {
      index: number;
      count: number;
      midX: number;
      midY: number;
      outerR: number;
      segments: { band: number; count: number; path: string; color: string }[];
    }[];
    /** The radial count ladder: ring circles + their labels. */
    rings: { r: number; count: number; labelX: number; labelY: number }[];
    /** The ring lines' look (`RoseStyle.ring*`). Absent = the theme line colour, 1 px, solid, shown - so a rose
     *  with no ring setting carries no ring style in its scene. */
    ringStyle?: { show: boolean; color: string | null; width: number; dash: string | null } | undefined;
    /** Angular tick labels: N/NE/E… in compass mode, degree marks otherwise. */
    /** `key` = the label's default words, written only when it is renamed (`text` is then the new words); `off` = its
     *  drag offset, written only when moved - so an untouched rose's labels carry neither. */
    directionLabels: { text: string; x: number; y: number; key?: string | undefined; off?: { dx: number; dy: number } | undefined }[];
    /** Magnitude-band ranges backing the legend (empty without a magnitude column). */
    bandRanges: { lo: number; hi: number; color: string }[];
  };
  /** Sunburst (kind "sunburst"): a radial hierarchy of ring segments. Ring depth 1 is the
   *  innermost drawn ring; each segment is an annular sector whose angular sweep is its share of
   *  the whole. A segment click selects its level column (→ Data panel); labels are per-segment
   *  and follow the data, like pie/treemap cell labels. */
  sunburst?: {
    /** Centre + the outer/inner radii in px (innerR > 0 makes a donut hole). */
    cx: number;
    cy: number;
    maxR: number;
    innerR: number;
    /** Segment border colour + width, and the fill opacity (plot-wide). */
    stroke: string;
    strokeWidth: number;
    fillOpacity: number;
    /** Append each segment's percentage after its label. */
    showValues: boolean;
    /** The sunburst's own Label size (px) — the size its labels are fitted and drawn at. Absent = the tick size, for
     *  both. Optional, so it adds nothing to the fingerprint of a scene without one (preset-invariance). */
    labelSize?: number | undefined;
    segments: {
      /** Stable key (the category path joined) — selection + label id. */
      key: string;
      /** Ring depth (1 = innermost). */
      depth: number;
      label: string;
      value: number;
      /** Share of the grand total (for percentage labels). */
      frac: number;
      /** Angular span (radians, clockwise from 12 o'clock) — the geometry the path was drawn
       *  from, so a guard can check the ring closes (a1 − a0 sums to a full turn per ring). */
      a0: number;
      a1: number;
      /** Annular-sector SVG path. */
      path: string;
      color: string;
      /** Centroid label placement + whether the segment is big enough to draw it. */
      labelX: number;
      labelY: number;
      labelAngle: number;
      showLabel: boolean;
      /** The level column this segment's category came from (click → its Data panel). */
      columnId?: NodeId | undefined;
      /** A representative source row (the selection payload). */
      rowId?: NodeId | undefined;
    }[];
    /** Grand-total label in the centre hole (only when a donut hole + showTotal). */
    centerLabel?: { text: string; x: number; y: number } | undefined;
  };
  /** Chord / circos (kind "chord"): entities as arc segments around a ring, weighted relationships
   *  as ribbons across the interior. An arc click selects its node; a ribbon click selects the
   *  edge; both route to the Chart type section (bins, no per-row object). Labels follow the arc
   *  geometry. */
  chord?: {
    cx: number;
    cy: number;
    /** Outer radius of the node ring, px. */
    r: number;
    arcs: {
      name: string;
      /** Annular-sector path for the node's arc. */
      path: string;
      color: string;
      /** Label placement + orientation (outside the arc). */
      labelX: number;
      labelY: number;
      labelAngle: number;
      labelAnchor: "start" | "end";
      showLabel: boolean;
      value: number;
    }[];
    ribbons: {
      /** The two endpoint node names — the selection payload. */
      source: string;
      target: string;
      /** Filled ribbon path (two arcs joined by Béziers through the centre). */
      path: string;
      color: string;
      value: number;
    }[];
    /** Ribbon fill opacity (plot-wide). */
    ribbonOpacity: number;
    /** Node-label font size (px) — the renderer sizes the arc labels with it. */
    labelSize: number;
  };
  /** Oncoprint (kind "oncoprint"): a genes × samples grid of categorical tiles. Genes down the
   *  rows (ordered by alteration frequency), samples across the columns (memo-sorted). Each cell is
   *  a background rect plus one coloured band per alteration type (stacked when a cell has several).
   *  A tile click selects the Chart type section (cells are aggregates); labels follow the grid. */
  oncoprint?: {
    tiles: {
      /** Cell rect (px). */
      x: number;
      y: number;
      w: number;
      h: number;
      gene: string;
      sample: string;
      /** No alteration in this cell (drawn as the empty-cell background only). */
      empty: boolean;
      /** One coloured band per alteration type in the cell (stacked to fill the tile). */
      bands: { y: number; h: number; color: string }[];
    }[];
    /** Gene names down the left, one per row. */
    /** `off` = the name's drag offset, written only when it has been moved. */
    geneLabels: { text: string; x: number; y: number; off?: { dx: number; dy: number } | undefined }[];
    /** Per-gene altered-sample percentage, at the right of each row (empty when hidden). */
    percentLabels: { text: string; x: number; y: number }[];
    /** Sample names under the columns (empty when hidden). */
    sampleLabels: { text: string; x: number; y: number; angle: number; off?: { dx: number; dy: number } | undefined }[];
    /** The empty-cell background colour. */
    emptyColor: string;
    /** The panel behind the tiles that colours their gaps (`gapColor`); absent when unset or there is no gap. */
    gap?: { x: number; y: number; w: number; h: number; color: string } | undefined;
    /** Gene / sample / percent label font size (px) — the renderer sizes the labels with it. */
    labelSize: number;
  };
  /** Timeline tracks (kind "tracks"): stacked single-row tile strips sharing
   *  the X (time) value axis and a Y category axis of track names. Each strip is one data
   *  column; numeric strips carry their own colour bar (drawn beside the strip), categorical
   *  strips put their label keys in the standard `legend`. A strip click selects its column
   *  (series); the whole stack + its layout controls live in the "Chart type" section. */
  tracks?: {
    strips: {
      /** The column id — a track is its column (the series selection target). */
      id: NodeId;
      /** Track label (drawn on the Y category axis). */
      name: string;
      /** Band geometry, px. */
      y: number;
      h: number;
      /** Whether this strip is a continuous (numeric) or categorical track. */
      numeric: boolean;
      /** Tiles left→right in time order; a missing cell is simply omitted (a gap). */
      tiles: { x: number; w: number; color: string; value: number | null; label: string }[];
      /** Numeric track only: its own colour bar beside the strip (same height), with the
       *  gradient stops (0→min … 1→max) and the min/max end labels. */
      colorbar?:
        | { x: number; y: number; w: number; h: number; min: number; max: number; stops: { offset: number; color: string }[] }
        | undefined;
    }[];
  };
  /** Ternary plot (kind "ternary"): the triangle furniture — edges, edge ticks, the
   *  triangular grid (styled by the standard Plot.grid options) and the three edge titles
   *  (= composition column names; click routes to that column's Data panel, double-click
   *  renames the column, drag stores `ternary.axisLabelOff`). The points are ordinary
   *  series marks — never part of this chrome. */
  ternary?: {
    /** Triangle corners in px: [A bottom-left, B bottom-right, C top]. */
    corners: [{ x: number; y: number }, { x: number; y: number }, { x: number; y: number }];
    /** Edge tick marks with their labels (label empty when a tick is unlabelled). */
    ticks: { x1: number; y1: number; x2: number; y2: number; label: string; lx: number; ly: number; anchor: "start" | "middle" | "end" }[];
    /** Triangular grid segments (three edge-parallel families); empty when grid is off. */
    gridLines: { x1: number; y1: number; x2: number; y2: number }[];
    /** Grid ink resolved from the standard Plot.grid options. */
    gridStyle: { color: string; width: number; dash: string | null };
    /** The three edge titles, base anchor + separate drag offset (the venn label rule). */
    axisTitles: { datasetId: NodeId; text: string; x: number; y: number; angle: number; off?: { dx: number; dy: number } | undefined }[];
  };
  /** Paired / grouped Cleveland dot-plot geometry (only when kind = "paireddot"). */
  paireddot?: PairedDotScene;
  /** Forest-plot pooled summary (pixel space); drawn when the forest plot shows a fixed-effect
   *  summary. The forms, chosen by `shape`:
   *  - `"diamond"` — polygon (xLo,cy) (cx,cy−halfH) (xHi,cy) (cx,cy+halfH)
   *  - `"bar"` / `"roundbar"` — rectangle xLo→xHi, 2·halfH tall, centred on cy (round = rounded ends)
   *  - `"lens"` — pointed oval (quadratic arcs meeting at the CI ends)
   *  - `"ellipse"` — smooth oval with rounded ends (cubic arcs, vertical tangents at the ends)
   *  - `"bowtie"` — pinched at the estimate, flaring to the CI ends
   *  - `"marker"` — one `symbol` glyph at (cx,cy) with the CI drawn as a whisker xLo→xHi
   *
   *  Note: the horizontal extent is data — xLo/xHi are the pooled confidence interval, which is
   *  the meaning of the shape. Only the height, glyph, colours and outline are style;
   *  there is deliberately no "width" control, because a summary with a settable width would no
   *  longer report the CI. Resolved from `seriesStyles["forest-summary"]` at the choke point
   *  (including whether it follows the study style) so the renderer does no lookup of its own. */
  forestSummary?: {
    shape: "diamond" | "bar" | "roundbar" | "lens" | "bowtie" | "ellipse" | "marker";
    xLo: number;
    xHi: number;
    cx: number;
    cy: number;
    halfH: number;
    /** Interior fill; "none" for a hollow (clear) summary. */
    color: string;
    fillOpacity: number;
    /** Outline colour — independent of the fill, so a light summary can carry a dark edge. */
    outline: string;
    outlineWidth: number;
    /** `shape: "marker"` only — the glyph and its radius, plus the whisker's thickness. */
    symbol: SymbolShape;
    symbolSize: number;
    /** `shape: "marker"` only — the fill mode, so an open/clear summary marker reads the same
     *  way a study marker does. */
    symbolFill: "solid" | "open" | "clear";
  } | undefined;
  /** Axis-anchored shaded bands (resolved to pixel rects at the choke point) — drawn
   *  behind the series. Each spans the plot perpendicular to its axis. */
  axisBands?: Array<{ x: number; y: number; w: number; h: number; color: string; opacity: number; label?: string | undefined; labelX: number; labelY: number }> | undefined;
  /** Corner scale bars (hide-axis + scale-bar): a short segment of known data length +
   *  a label, resolved to pixels at the choke point. `vertical` = a Y-axis bar. */
  scaleBars?: Array<{ x1: number; y1: number; x2: number; y2: number; label: string; labelX: number; labelY: number; color: string; vertical: boolean }> | undefined;
  /** Category groups on a banded axis (resolved at the choke point) — tint blocks,
   *  leading-edge separators and rotated group names. The fourth channel, per-category
   *  label colour, rides on `AxisTick.color`. */
  categoryGroups?: CategoryGroupScene[] | undefined;
  /** Background-gridline style (resolved from the plot's grid config). */
  grid: GridScene;
  /** Frame + tick-mark style (resolved from the plot's frame/tick config). */
  axisStyle: AxisStyleScene;
  /** Resolved graph-title heading text ("" = hidden / blank). */
  title: string;
  /** Heading drag offset (px) from centred; undefined = centred. Moves the whole heading
   *  block — the subtitle rides along. */
  titleOffset?: { dx: number; dy: number } | undefined;
  /** The subtitle's own offset, applied on top of `titleOffset` (so dragging the title still
   *  moves both, but the subtitle can be nudged alone). Undefined = under the title. */
  subtitleOffset?: { dx: number; dy: number } | undefined;
  /** Free drag offset (px) of the legend block; undefined = anchored. */
  legendOffset?: { dx: number; dy: number } | undefined;
  /** Free drag offset (px) of the heatmap colour-scale bar. */
  colorbarOffset?: { dx: number; dy: number } | undefined;
  /** Bubble size legend (kind "bubble"): representative radii → value labels, drawn
   *  vertically on the right. Undefined = none (no size column, or turned off). */
  bubbleLegend?: {
    title: string;
    /** The plotted-bubble marker paint and shape, so the legend keys match the graph exactly —
     *  a key drawing circles beside square marks would not identify them (e.g. when a preset's
     *  shape cycle reaches a single-series bubble). */
    marker: { symbol: SymbolShape; color: string; symbolFill: SeriesScene["symbolFill"]; symbolFillColor?: string | undefined; symbolOutline: string; symbolOpacity: number; borderWidth: number };
    /** Free drag offset (px) from the right-side anchor. */
    offset?: { dx: number; dy: number } | undefined;
    /** How far right of the plot edge this column starts, px. Default 16. The builder raises
     *  it past anything else already occupying the right margin (a Y2/Y3 axis, the colour bar)
     *  — every block there is drawn from the same edge, so somebody has to state the order. */
    inset?: number | undefined;
    items: { radius: number; label: string }[];
  } | undefined;
  /** Zone key — a small legend for the shaded zone bands, overlaid in a plot corner
   *  (`Plot.zoneLegend`). One row per labelled band: its fill swatch + its caption. The box's
   *  top-left is `x,y` (px); the renderer draws swatch rects + labels down from there. Absent
   *  when the key is off or no band carries a label. */
  zoneLegend?: {
    x: number;
    y: number;
    /** Box size (px), measured by the builder so the renderer draws the frame without measuring. */
    w: number;
    h: number;
    entries: { label: string; color: string }[];
  } | undefined;
  /** Title/subtitle horizontal anchor; undefined = centred. */
  titleAlign?: "left" | "center" | "right" | undefined;
  /** Resolved subtitle line under the title ("" = none). */
  subtitle: string;
  /** Footer/source mark text (left + right), drawn in a reserved bottom band; undefined = none. */
  footer?: { left?: string; right?: string } | undefined;
  /** Auto significance-threshold legend (e.g. `* p<0.05; ** p<0.01 …`); undefined = none. Drawn at the figure bottom. */
  significanceCaption?: string | undefined;
  /** Resolved typography + drag offset for that caption. Present whenever the caption is;
   *  `size` also fixes the reserved band's height, so the renderer must read the height
   *  from here rather than assuming the legend font. */
  significanceCaptionStyle?: {
    size: number;
    family?: string | undefined;
    bold?: boolean | undefined;
    italic?: boolean | undefined;
    color?: string | undefined;
    offset?: { dx: number; dy: number } | undefined;
  } | undefined;
  /** Resolved tick-label / axis-title gaps (px) per axis — the renderer offsets labels by these. */
  axisGaps?: { xTick: number; xTitle: number; yTick: number; yTitle: number };
  axisLabels: AxisLabels;
  /** Chart kind (xy = continuous scatter/line; bar/box/violin/scatter = categorical). */
  kind: PlotKind;
  /** Resolved figure font sizes (the renderer uses these — single source of truth). */
  fonts: SceneFonts;
  /** Non-fatal issues (e.g. points dropped for a log scale). */
  warnings: string[];
  /**
   * Which visual axis carries values (the other one bands the categories).
   *
   * Undefined = "y", the ordinary orientation. The renderer needs this to invert a drag:
   * a bracket's height is a value, so dragging it on a horizontal bar / lollipop / paired
   * dot / forest / pyramid must read the X scale, not the Y one.
   *
   * Not derived from `isTransposedPlot`: that helper covers bar, box, violin, column scatter and
   * floating bar only, so it returns false for a lollipop, which the builder draws horizontal by
   * default (`barOrientation` unset). Using it would stack a bracket on the wrong axis.
   */
  valueAxis?: "x" | "y" | undefined;
}
