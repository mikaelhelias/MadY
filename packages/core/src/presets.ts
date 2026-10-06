/**
 * Graph-style presets + user-profile shape.
 *
 * A `StylePreset` is a one-click look: fonts (family + per-element sizes), axis
 * thickness/colour, gridlines, a series palette, marker styling, and the
 * frame/tick style. Applying one restyles a whole graph in a single undoable
 * action (`MadyDocument.applyStylePreset`). The same shape is the **user
 * profile** — personal defaults persisted by the app and applied to every newly
 * created graph.
 *
 * Presets live in core (not the UI) so they are shared, serialisable, and unit
 * tested. They are pure data — no DOM, no rendering.
 *
 * Two of the looks:
 *   • **Editorial** — the data-journalism look: a clean
 *     humanist sans (Segoe UI), a big bold left-aligned dark title over a grey
 *     subtitle, a *frameless, gridless* canvas, and a purple-led palette
 *     (lead colour #843CC0). No marker halos — markers stay flat and solid.
 *   • **Scientific Journal** — the published-paper look: Helvetica, a
 *     muted journal palette, thin soft-black axes, no grid, small filled markers
 *     carrying a thin page-colour halo so overlapping points stay legible.
 */

import type { AxisSpec, DataTable, FillType, FontElement, FontSpec, FrameStyle, LegendSpec, LineDash, Plot, PlotKind, SeriesStyle, SymbolFill, SymbolShape, TickDir } from "./model";

export interface StylePreset {
  /** Display name (also the key the UI/profile stores). */
  name: string;
  /** One-line description for the picker. */
  description: string;
  /** Font family for every text element; undefined = the theme default. */
  fontFamily?: string;
  titleSize: number;
  subtitleSize: number;
  axisTitleSize: number;
  tickSize: number;
  legendSize: number;
  /** Bold the graph title. */
  titleBold?: boolean;
  /** Axis line + tick-mark thickness (px). */
  axisThickness: number;
  /** Axis line + tick colour (hex); undefined = theme default (near-black). */
  axisColor?: string;
  /** Draw background gridlines. */
  gridShow: boolean;
  gridWidth?: number;
  gridDash?: LineDash;
  /** Gridline colour (hex) when shown — modern figures use a whisper-faint grey. */
  gridColor?: string;
  /** Target gridline count on linear axes. */
  gridDensity?: number;
  /** Series palette, cycled across datasets in order. */
  palette: string[];
  frame?: FrameStyle;
  tickDir?: TickDir;
  /** Title/subtitle horizontal anchor (the Editorial look is left-aligned). */
  titleAlign?: "left" | "center" | "right";
  /** Data line / curve thickness (px); undefined = leave each series' own width. */
  seriesLineWidth?: number;
  /** Marker size (px); undefined = leave each series' own size. */
  markerSize?: number;
  /** Marker fill mode (solid/open/clear); undefined = leave each series' own. */
  symbolFill?: SymbolFill;
  /** Marker outline (halo) colour; undefined = leave each series' own (= its colour).
   *  A page-colour halo ("#ffffff") is the modern "separated markers" look. */
  symbolOutline?: string;
  /** Marker outline thickness (px) — drives the halo width; undefined = leave own. */
  symbolBorderWidth?: number;
  /** Marker opacity (0–1), the "transparent points" look. Written to a series only when the
   *  preset defines it (a preset without one leaves a hand-set opacity alone). */
  symbolOpacity?: number;
  /** Interior fill colour for open markers (the two-tone look); undefined = leave own. */
  symbolFillColor?: string;
  /** Bar / box / area fill opacity (0–1); undefined = leave each series' own. */
  fillOpacity?: number;
  /**
   * Bar / box / area fill treatment — solid, two-tone, pattern…
   *
   * Note: distinct from `symbolFill`, which is the marker's treatment. A preset that sets only
   * `symbolFill` leaves its bars on the builder's `solid` default, so the bars come out flat
   * while the dots are two-tone. Undefined = leave the series' own (i.e. solid), so presets
   * that do not set it are unchanged.
   */
  fillType?: FillType;
  /** Tick-label colour (hex); undefined = theme default (muted grey). */
  tickColor?: string;
  /** Bold the axis titles (separate from `titleBold`, which is the graph title). ggplotplus
   *  sets its axis titles bold at rel(1.125) — the label a reader needs before the numbers
   *  mean anything. undefined = not bold. */
  axisTitleBold?: boolean;
  /** Paper colour behind the whole figure (hex). ggplotplus uses a warm off-white `#FFFEFD`
   *  rather than pure white, which it pairs with removing the grey panel. undefined = the
   *  theme default. */
  background?: string;

  /* ── Captured-on-definition parameters ───────────────────────────────────────────────────
   *
   * Additional parameters a preset may carry, captured when the preset is defined. A preset
   * that does not set them leaves the graph's own values alone.
   *
   * Every field here is optional, is set by only a few built-in presets, and
   * `applyStylePreset` writes it only when the preset defines it. That last part is essential: the marker fields above are
   * written unconditionally on purpose (so switching presets cannot leave one preset's halo
   * behind), and copying that pattern here would clear a user's own tick length on every preset
   * apply. `preset-invariance.test.ts` hashes every built-in × every gallery card against the
   * drawing they produced without these fields.
   *
   * Note: a user-saved preset already captures all four, because it stores whole `Plot` keys
   * (`SHARED_KEYS` in templates.ts includes `xAxis`, `yAxis`, `tickLen`). These fields exist so a
   * built-in preset can express the same thing.
   */
  /** Tick-mark length px → `Plot.tickLen`. undefined = leave whatever the graph has. */
  tickLen?: number;
  /** Tick-mark thickness px → each axis's `tickWidth`. undefined = ticks follow the axis line. */
  tickWidth?: number;
  /** Gap px between an axis title and its tick labels → each axis's `titleGap`. */
  titleGap?: number;
  /** Gap px between tick labels and the axis line → each axis's `tickLabelGap`. */
  tickLabelGap?: number;
  /**
   * Pie / donut / treemap slice label size px → `fonts.sliceLabel`, and bar / point value label
   * size px → `fonts.valueLabel`. Without these, no built-in preset can reach these two text
   * elements (13 px on every kind unless edited by hand). undefined = the preset writes
   * neither — same conditional rule as the axis parameters above.
   */
  sliceLabelSize?: number;
  valueLabelSize?: number;
  /**
   * The legend's own look — frame, paper, padding, and the geometry fields (`position`,
   * `orientation`, `gap`, `inset`, `symbolScale`) that a preset otherwise could not touch.
   *
   * Merged over whatever the graph has, and only when the preset carries one. `show` is
   * deliberately left to the graph — a preset that switched every legend on would be changing
   * what the figure says, not how it looks.
   */
  legend?: Omit<LegendSpec, "show">;
  /**
   * Marker shapes, cycled across the series exactly as `palette` cycles colours.
   *
   * The purpose is redundant encoding. A figure that separates its series by colour alone stops
   * working the moment it is printed in greyscale or read by someone who cannot tell those hues
   * apart — about 1 in 12 men for a red/green pair. Shape carries the same information through
   * both. It is why ggplotplus ships `geom_point_plus`, whose shapes exist to "vary in their
   * openness, spikiness, and intersectionality" so groups are distinguishable "even without the
   * aid of differing colors".
   *
   * Note: its own shapes are not reused: they live in `data/ggplotplus_shapes_list.rda`, a
   * binary R data file. Only the idea transfers.
   *
   * Written per series only when a preset defines this, so a preset that says nothing about
   * shape leaves the one the user picked alone (`SeriesStyle.symbol`).
   */
  symbolShapes?: SymbolShape[];
}

/** Colourblind-safe Okabe–Ito (the app default order). */
const OKABE_ITO = ["#0072B2", "#E69F00", "#009E73", "#D55E00", "#CC79A7", "#56B4E9", "#F0E442", "#000000"];
/**
 * Muted journal palette (values from the ggsci R package's journal palettes, derived
 * from published-paper figures) — the recognisable print-journal look. Colourblind-aware,
 * print-safe.
 */
const JOURNAL = ["#E64B35", "#4DBBD5", "#00A087", "#3C5488", "#F39B7F", "#8491B4", "#91D1C2", "#DC0000", "#7E6148", "#B09C85"];
/** Modern high-chroma palette for infographics — saturated hues that still sit well together. */
const VIBRANT = ["#FF4D6D", "#3A86FF", "#FFB703", "#06D6A0", "#7B2FF7", "#00BBF9", "#FB5607", "#F15BB5"];
/** Print-safe greyscale ramp. */
const GRAYSCALE = ["#1A1A1A", "#5C5C5C", "#8A8A8A", "#B5B5B5", "#404040", "#737373", "#A0A0A0", "#2B2B2B"];
/**
 * "Editorial" — the data-journalism / social-media palette. It leads with violet (#843CC0), then the
 * green / red used for up-vs-down contrast, then a supporting cool→warm spread.
 */
const EDITORIAL = ["#843CC0", "#0C9048", "#CC3024", "#2563EB", "#E0A21E", "#0E9D9D", "#C026D3", "#475569"];

/** Soft near-black used for axes/ticks in the refined presets (true black reads harsh). */
const SOFT_INK = "#2B2B2B";
/** Page-colour marker halo — the modern "separated markers" look. */
const HALO = "#FFFFFF";
/** Native modern UI sans — Segoe UI on Windows; the Editorial and Bold infographic looks use it. */
const EDITORIAL_FONT = "'Segoe UI', system-ui, -apple-system, sans-serif";

/** Built-in graph-style presets (the design-mode starter set). */
export const STYLE_PRESETS: StylePreset[] = [
  {
    // The house look: Helvetica, large title + ticks, thick black axes, no grid, two-tone
    // markers (a lighter fill under a darker outline) and the colourblind-safe Okabe–Ito
    // palette.
    name: "MadY default",
    description: "House default — Helvetica, bold black axes, two-tone markers (clearer fill, darker outline).",
    fontFamily: "Helvetica, Arial, sans-serif",
    /**
     * The house type sizes: axis title 22, graph title 26, axis labels 20, by default for all
     * graph types where they apply. They are set here, on the house preset, because that is the
     * one place every chart type reads from.
     *
     * Note: these sizes are the house figure style by design. They stay this large for tight
     * layouts and small exports too.
     */
    titleSize: 26,
    subtitleSize: 12,
    axisTitleSize: 22,
    tickSize: 20,
    tickColor: "#0a0a0a",
    legendSize: 12,
    // Axis line + tick-mark thickness. Tick width follows this (buildScene axisLine), so 2.5
    // keeps the axis rule and its ticks light together without going thin.
    axisThickness: 2.5,
    axisColor: "#000000",
    gridShow: false,
    /**
     * The palette and line width are the gallery's look — Okabe–Ito order (blue first
     * series, then orange) at 2px traces, the default everywhere. The gallery cards draw
     * exactly this (OKABE_ITO[i] + lineWidth 2 on every card series), and the preset carries it
     * so every surface produces it.
     */
    palette: OKABE_ITO,
    frame: "lshape",
    tickDir: "out",
    titleAlign: "center",
    seriesLineWidth: 2,
    markerSize: 6.5,
    // Two-tone markers by default: a clearer (lighter-tinted) fill + a darker outline, both
    // derived from each series' own colour (twoToneFill / twoToneContour), not a fixed grey.
    // Reads cleaner than a flat outline. No fixed fill/outline colour here so the two-tone
    // derivation drives them per series (black → grey fill + black edge; blue → pale + deep).
    symbolFill: "twotone",
    // Bars carry the same two-tone treatment as the markers:
    // a light fill under a darker edge, both derived from the series' own hue. Without this
    // the two-tone look would cover only the dots, and the bars would render flat.
    fillType: "twotone",
    symbolBorderWidth: 2,
  },
  {
    // The published-paper look: sans-serif Helvetica, compact
    // type, thin soft-black axis lines + outward ticks, no background grid, an
    // accessible journal palette, small filled markers with a thin white halo so
    // overlapping points & the connecting line stay legible.
    // Note: LEGACY_PRESET_NAMES keeps profiles that stored an earlier name for this preset
    // resolving.
    name: "Scientific Journal",
    description: "Journal house style — Helvetica, muted journal palette, thin soft axes, no grid, haloed markers.",
    fontFamily: "Helvetica, Arial, sans-serif",
    // Real printed journal figures set tiny type (≈7–9pt) because they print two-column
    // and small. On screen at MadY's default canvas that is too small to read, so
    // the sizes are raised for legibility while keeping this the most compact preset
    // (still well below MadY-default / Bold, and in line with the Grayscale-print look).
    titleSize: 16,
    subtitleSize: 12,
    axisTitleSize: 15,
    tickSize: 13,
    legendSize: 12,
    titleBold: false,
    axisThickness: 1,
    axisColor: SOFT_INK,
    gridShow: false,
    palette: JOURNAL,
    frame: "lshape",
    tickDir: "out",
    seriesLineWidth: 1.75,
    markerSize: 4.5,
    symbolFill: "solid",
    symbolOutline: HALO,
    symbolBorderWidth: 1.3,
    fillOpacity: 0.95,
  },
  {
    name: "Bold infographic",
    description: "Large bold type, thick axes, modern vivid palette, light grid.",
    fontFamily: EDITORIAL_FONT,
    titleSize: 24,
    subtitleSize: 15,
    axisTitleSize: 17,
    tickSize: 14,
    legendSize: 14,
    titleBold: true,
    axisThickness: 2.5,
    axisColor: "#1A1A1A",
    gridShow: true,
    gridWidth: 1,
    gridDash: "dashed",
    gridColor: "#E2E2E2",
    gridDensity: 5,
    palette: VIBRANT,
    frame: "box",
    tickDir: "out",
    seriesLineWidth: 3,
    markerSize: 6,
    symbolFill: "solid",
    symbolOutline: HALO,
    symbolBorderWidth: 2,
    fillOpacity: 0.95,
  },
  {
    // The data-journalism look: Segoe UI, a big bold dark left-aligned title, a
    // frameless + gridless canvas with only the faintest axis line, a
    // purple-led palette, and thick flat lines / solid flat markers (no halo).
    name: "Editorial",
    description: "Data-journalism look — Segoe UI, big bold left title, frameless, gridless, purple-led palette.",
    fontFamily: EDITORIAL_FONT,
    titleSize: 26,
    subtitleSize: 14,
    axisTitleSize: 13,
    tickSize: 12,
    legendSize: 12,
    titleBold: true,
    axisThickness: 1,
    axisColor: "#C7CBD1",
    gridShow: false,
    palette: EDITORIAL,
    frame: "none",
    tickDir: "out",
    titleAlign: "left",
    seriesLineWidth: 3,
    markerSize: 5.5,
    symbolFill: "solid",
    fillOpacity: 0.85,
  },
  {
    name: "Grayscale (print)",
    description: "Grayscale palette, marker shapes cycle per series, medium type, thin soft axes — B/W printing.",
    fontFamily: "Helvetica, Arial, sans-serif",
    titleSize: 16,
    subtitleSize: 12,
    axisTitleSize: 14,
    tickSize: 12,
    legendSize: 12,
    axisThickness: 1,
    axisColor: SOFT_INK,
    gridShow: false,
    palette: GRAYSCALE,
    frame: "lshape",
    tickDir: "out",
    seriesLineWidth: 1.75,
    markerSize: 4.5,
    symbolFill: "solid",
    symbolOutline: HALO,
    symbolBorderWidth: 1.3,
    fillOpacity: 0.95,
    /**
     * The shape cycle. In black and white the series differ only by grey level; the
     * shapes tell them apart. Same order as Universal design: the first four are unmistakable
     * at 5 px (round · pointed · flat-sided · rotated), the near-circular hexagon and the
     * stroked cross come last. Its rows in `preset-invariance.fixtures.json` reflect this cycle.
     */
    symbolShapes: ["circle", "triangle", "square", "diamond", "star", "triangle-down", "hexagon", "cross"],
  },
  {
    /**
     * Universal design — MadY's reading of **ggplotplus** (Dr Alex Bajcz, MIT), the R package that
     * overrides ggplot2's less accessible defaults. Every number below is taken from that
     * package's own source (`R/UserFacingCoreFunctions.R`), not invented here.
     *
     * Note: the values must come from the source, not a summary of it. The details that
     * define the look are only visible there:
     *   • `theme_plus` eliminates major and minor gridlines and offers them back only through
     *     a separate opt-in (`gridlines_plus`);
     *   • the palette is viridis, truncated at 0.72, not Okabe–Ito;
     *   • the warm off-white paper, the bold axis titles and the heavier geometry are most of
     *     what makes one of its figures recognisable.
     *
     * What it sets, and where each comes from:
     *  • Palette — viridis option D sampled from 0 to **0.72**. The truncation is the point:
     *    viridis's last quarter is a pale yellow-green that disappears on white paper. Sampled
     *    with this app's own ramp interpolation so it matches everywhere viridis is drawn.
     *  • Paper — `#FFFEFD`, a warm off-white. ggplotplus pairs dropping ggplot's grey panel
     *    with a paper that is not clinical white.
     *  • No gridlines — `theme_plus` removes major and minor gridlines to cut visual clutter.
     *  • Type — a 16 pt base with everything relative to it: axis titles rel(1.125) and bold,
     *    tick labels rel(1) in black, legend rel(1). Scaled here to MadY's own base so the
     *    house 26/22/20 headline sizes are not shrunk, with the ratios preserved.
     *  • Geometry — point size 5, a fillable circle with a black border at 1.2, and a default
     *    line width of 1.35. Distinctive marks that survive being printed small.
     *
     * Note: one setting is not followed: ggplotplus puts the legend **above the plot,
     * horizontal** (`legend.position = "top"`). This preset does not move the legend — it
     * leaves it where the graph has it; MadY's own `legend.position = "top"` puts it there.
     */
    name: "Universal design",
    description: "After ggplotplus (Dr Bajcz): viridis to 0.72, warm off-white paper, no gridlines, bold axis titles, heavier marks.",
    fontFamily: "Helvetica, Arial, sans-serif",
    // The house headline sizes (26 / 22 / 20) are kept; ggplotplus's ratios are what carry
    // over — axis title above the tick labels, and a legend that matches the ticks rather than
    // shrinking to 12.
    titleSize: 26,
    subtitleSize: 16,
    axisTitleSize: 22,
    axisTitleBold: true,
    tickSize: 20,
    tickColor: "#000000",
    legendSize: 20,
    titleBold: true,
    axisThickness: 1.2,
    axisColor: "#000000",
    background: "#FFFEFD",
    gridShow: false,
    /**
     * viridis D at t = 0, 0.72/7, … 0.72 — computed with `rampColor` over this app's own
     * viridis stops so the discrete series and a viridis heatmap agree. Do not "extend" it
     * to the pale end: that is exactly what the 0.72 cut-off exists to avoid.
     *
     * Interleaved, not in ramp order — a deliberate deviation from ggplotplus. There, viridis
     * is sampled across the actual number of groups, so two groups get the two ends of the
     * range. MadY cycles a fixed list by index, so ramp order would give a two-series chart
     * the first two samples — #440154 and #462574, two dark purples a reader cannot tell
     * apart.
     *
     * The order below walks the ends inwards (0, 0.72, then the midpoints), so any number of
     * series is well separated and the eight-group set is still exactly ggplotplus's.
     */
    palette: ["#440154", "#51c369", "#34618c", "#22948b", "#462574", "#28ac81", "#3f4585", "#297b8d"],
    frame: "lshape",
    tickDir: "out",
    seriesLineWidth: 1.35,
    markerSize: 5,
    symbolFill: "solid",
    symbolOutline: "#000000",
    symbolBorderWidth: 1.2,
    // The README's own points: `geom_point_plus(size = 5, alpha = 0.7)` — solid, black-edged,
    // 70 % opaque, so overlapping points read as overlap (transparent data point fills).
    // `theme_plus` itself sets no alpha; the value is the README figure's.
    symbolOpacity: 0.7,
    /* ── Tick, gap and legend parameters taken from ggplotplus ──────────────────────────────
     *
     * These four use the optional preset fields declared on `StylePreset`. This preset is the
     * only built-in that sets them, so only its rows in `preset-invariance.fixtures` reflect
     * them — the other five stay pinned to their recording. Re-record only the rows a change
     * is meant to move.
     *
     * Note: converted by ratio to the type, not by absolute size, exactly as the font sizes were:
     * MadY keeps the house 26/22/20 rather than ggplotplus's 16 pt base, so an absolute
     * 0.2 cm tick under 20 px type would read as a stub. base = 16 pt throughout.
     */
    /** 0.2 cm = 5.67 pt = 0.354 × base font → 20 px × 0.354 ≈ 7. */
    tickLen: 7,
    /** rel(0.75) × base linewidth 1.2 = 0.9 — ticks lighter than the axis line they sit on. */
    tickWidth: 0.9,
    /**
     * 10 pt = 0.625 × base font → 20 px × 0.625 ≈ 12.
     *
     * Note: this is an approximation. ggplotplus sets the x-axis title margin to 10 pt and the
     * y-axis title's to 15 pt (the rotated title needs more clearance). A preset carries one
     * `titleGap` for both axes, so this takes the x value; a per-axis pair would be two more
     * preset fields for a few points of margin.
     */
    titleGap: 12,
    /**
     * `theme_plus` gives the legend the same warm paper as the figure. No frame: the
     * "legend frame width rel(1)" in its source is the colourbar's frame (continuous scales),
     * which is MadY's colour bar and has no `LegendSpec` field — not the series key's box.
     */
    legend: { background: true, backgroundColor: "#FFFEFD" },
    /**
     * Redundant encoding — shape as well as colour, so the figure survives greyscale printing
     * and does not depend on telling hues apart.
     *
     * Note: this is ggplotplus's principle, not its theme. `geom_point_plus` is a separate opt-in
     * function there and `theme_plus`'s own default is shape 21 (a fillable circle) for every
     * series — so the cycle is MadY's decision, taken on the preset whose name is about being
     * legible to everyone. Their nine shapes are not reused in any case: the coordinates
     * live in `data/ggplotplus_shapes_list.rda`, a binary R data file.
     *
     * Ordered for early distinctness, not alphabetically. Most figures have two to four
     * series, so the first four must be unmistakable at 5 px: round · pointed · flat-sided ·
     * rotated. The near-circular ones (hexagon) and the stroked glyphs (cross, which draws from
     * `color` rather than the fill/outline this preset sets) come last, where a figure with
     * eight series will take them anyway.
     *
     * Eight, matching the palette, so colour and shape stay in step rather than drifting into
     * odd pairings on a chart with many series.
     */
    symbolShapes: ["circle", "triangle", "square", "diamond", "star", "triangle-down", "hexagon", "cross"],
    // The four MadY-specific shapes (losange · waffle · oval · ring) are not in this cycle: they
    // separate groups less clearly than the shapes above. They remain per-series options in the
    // Inspector.
  },
];

/**
 * Renamed presets: old stored name → current name. A profile/per-kind default stores the
 * preset name, so a rename would silently strip the look from every profile that saved the
 * old string — the lookup keeps resolving it instead.
 */
const LEGACY_PRESET_NAMES: Record<string, string> = {
  // A stored name only: it resolves to the current preset and is never shown in the program.
  Nature: "Scientific Journal",
};

/** Look up a preset by name (case-sensitive); legacy names resolve; undefined if unknown. */
export function findPreset(name: string): StylePreset | undefined {
  const current = LEGACY_PRESET_NAMES[name] ?? name;
  return STYLE_PRESETS.find((p) => p.name === current);
}

/**
 * Per-kind house defaults — a chart type's own starting look, layered on top of the style
 * preset when a new graph is created (`seedNewPlot`).
 *
 * Why this exists separately from `StylePreset`: a preset is kind-agnostic, so a value good
 * for one chart type is wrong for another. The bar chart below uses 14px data points —
 * right for a swarm of replicates sitting over a bar, far too large on an XY scatter, where 14px
 * markers would swallow the line. Anything genuinely universal still belongs in the preset.
 *
 * Note: style only. Figure size is deliberately excluded (a graph keeps its own figure size, so
 * it stays homogeneous with the other graphs), and so is content — axis titles such as
 * "Group" / "Mean" describe one dataset, not a house style.
 */
export interface KindHouseDefault {
  /** Patch applied to the Plot itself. */
  plot?: Partial<Plot>;
  /** Per-element font overrides, applied to every listed element. */
  fonts?: Partial<Record<FontElement, FontSpec>>;
  /** Axis patches, applied per axis. */
  axes?: Partial<Record<"x" | "y", Partial<AxisSpec>>>;
  /** Style applied to every series of the new graph. */
  series?: SeriesStyle;
  /**
   * Style for one named series id, applied verbatim.
   *
   * For the series a builder invents rather than reads from the table — a PCA group
   * (`"pca-g1"`), an estimation Difference (`"est-diff"`), a forest summary. `series` above walks
   * the table's datasets, so it can never reach any of them.
   *
   * Caution: the id is a contract with a specific builder, not a column. Adding one here without
   * checking the builder still emits that id is how a default becomes silently dead.
   */
  seriesStyles?: Record<string, SeriesStyle>;
}

/**
 * Per-kind house defaults: `KIND_HOUSE_DEFAULTS` below.
 * Values not listed there fall through to `STYLE_PRESETS[0]`.
 */
/**
 * Equal aspect (`plot.equalAspect`) — the chart kinds whose builder can make one data unit the
 * same number of pixels on X as on Y.
 *
 * The requirement is simply that both axes are continuous value axes drawn on one plane, so this
 * is the continuous-XY family plus the ordination maps. Everywhere else a 1:1 scale would be a
 * category count against a measurement (bar, box), a genome position against a p-value
 * (Manhattan), or a time against a probability (survival) — a ratio of two different things,
 * which has no meaning to equalise. The control is hidden on those kinds and the builder emits a
 * warning if the flag reaches it anyway.
 *
 * Derived from the builder and re-checked by `equal-aspect-kinds.test.ts`: a kind in this list
 * whose drawn pixel scale does not become equal fails the build, and so does a kind outside it
 * that quietly honours the flag.
 */
export const EQUAL_ASPECT_KINDS: ReadonlySet<PlotKind> = new Set<PlotKind>([
  "xy", "area", "bubble", "volcano",
  "pcascore", "pcaload", "pcabiplot", "triplot",
]);

export const KIND_HOUSE_DEFAULTS: Partial<Record<PlotKind, KindHouseDefault>> = {
  /**
   * XY — an 18px legend and 8px markers.
   *
   * The three type sizes live in the house preset instead (they are for every chart type).
   * Not set here:
   *   • series colours — the palette (`OKABE_ITO`) already colours them, and a per-series
   *     colour cannot be a kind default anyway: `series` applies one style to every series,
   *     and series differ between graphs.
   *   • `lineWidth` — the preset already sets the line width.
   *   • `legendOffset` — a dragged legend position belongs to one figure, in absolute px.
   */
  xy: {
    // symbolScale left at the default 1: the legend symbol follows the series point size,
    // so a 1:1 key needs no multiplier; a larger value would draw the key bigger than the
    // data point.
    fonts: { legend: { size: 18 } },
    // 8px markers, up from the preset's 6.5.
    series: { symbolSize: 8 },
  },
  /**
   * Area — the markers on the curve, 6.5 → 8, matching the XY size. Everything else is the
   * preset's.
   */
  area: {
    series: { symbolSize: 8 },
  },
  bar: {
    // Bars 0.38 of the category band wide.
    // 18px legend text.
    // No `legend.symbolScale` (default 1): the bar key is a font-sized fill block
    // (LegendEntry.swatch "bar"), so at slider 1 it is already the intended size — a larger
    // value would draw it bigger than the data point.
    plot: { barWidth: 0.38 },
    /**
     * No per-kind title / axis-title / tick sizes. The house sizes are 26 / 22 / 20 for all graph
     * types where they apply — and a per-kind override silently wins over the preset, so setting
     * them here would make bar the one chart type that ignored that rule.
     *
     * Per-kind sizes, should they be wanted, take this form: `fonts: { title: { size: 28 },
     * axisTitle: { size: 24 } }` and `axes: { x: { tickFont: { size: 19 } }, y: { tickFont: { size: 19 } } }`.
     *
     * Note: `legend` is not one of those three. It is per-kind on purpose — 18 on bar, 17 on the
     * PCA score plot, 18 on XY — so there is no single global value to move it to.
     */
    fonts: { legend: { size: 18 } },
    series: { symbolSize: 14 },
  },
  /**
   * Box & whisker — one width for every box, 0.22.
   *
   * Note: narrow on purpose — slim boxes with space between them, not the wide boxes the
   * kind-agnostic preset gives.
   */
  box: {
    plot: { figureWidth: 672, figureHeight: 473 },
    series: { boxWidth: 0.22 },
  },
  /**
   * Column scatter — dots 6.5 → 10, and a 2px error bar.
   *
   * A `series` default applies one style to every series, so every column gets the same dot
   * size and error-bar width.
   */
  scatter: {
    plot: { figureWidth: 655, figureHeight: 497 },
    /**
     * `boxWidth` is not set: on a column scatter the value changes nothing (0.2 and 0.9 draw
     * the same figure), so writing it would be a default that does nothing.
     */
    series: { symbolSize: 10, errorWidth: 2 },
  },
  /**
   * Floating bars — one width for every bar, 0.19, rounded to two places like `barWidth`.
   */
  floatingbar: {
    plot: { figureWidth: 675, figureHeight: 566 },
    series: { boxWidth: 0.19 },
  },
  /**
   * Bland-Altman — the difference markers, 6.5 → 8. A Bland-Altman plots one cloud out of a
   * pair of columns, so setting the size on the second column alone or on every series (which
   * is all a kind default can do) gives the same drawing.
   */
  blandaltman: {
    series: { symbolSize: 8 },
  },
  /**
   * Forest plot — the study markers, 6.5 → 7.5. Same reasoning as Bland-Altman: a forest reads a
   * triple of columns (estimate / lower / upper), and the drawing moves identically whether the
   * size is set on the estimate column alone or on all three.
   */
  forest: {
    series: { symbolSize: 7.5 },
  },
  /** Funnel plot — the forest's companion; the same 7.5px study markers so the two read as
   *  one family side by side. */
  funnel: {
    series: { symbolSize: 7.5 },
  },
  /** Venn — disc-shaped: a near-square figure box, so the drawing fills it.
   *
   *  580 wide. Three overlapping discs make a shape taller than wide, so a wider box leaves a
   *  blank band on each side; at 580×600 the discs fill the largest share of the figure. */
  venn: {
    plot: { figureWidth: 580, figureHeight: 600 },
  },
  /** UpSet — landscape (bars + matrix are wide); counts above the bars is the classic look,
   *  delivered through the standard value-label machinery. */
  upset: {
    plot: { figureWidth: 720, figureHeight: 620, showValues: true },
  },
  /** Swimmer — landscape timelines; one band per subject. */
  swimmer: {
    plot: { figureWidth: 720, figureHeight: 540 },
  },
  /** Ternary — near-square, so the triangle fills its box. No grid floor: the house
   *  preset's no-grid journal look wins over kind floors by design, and the edge ticks
   *  carry the reading; the standard Grid checkbox turns the triangular grid on.
   *
   *  700 wide: with the triangle filling its figure, a narrower box is limited by the legend's
   *  strip on the right and leaves a blank band below; wider boxes leave blank flanks. 700×600
   *  is where the drawing fills the largest share of the figure. */
  ternary: {
    plot: { figureWidth: 700, figureHeight: 600 },
  },
  /** Rose — near-square (a circle in a box); the ring/label margins do the rest. */
  rose: {
    plot: { figureWidth: 640, figureHeight: 600 },
  },
  /** Tracks — landscape (a run of tile strips over a shared time axis); short bands. */
  tracks: {
    plot: { figureWidth: 780, figureHeight: 420 },
  },
  /**
   * PCA score plot — the legend and the range of dot sizes.
   *
   *   legend 17px + symbolScale 1.5   the key, sized like bar's but a touch smaller
   *   maxRadius 12 / minRadius 2      the score dots' size range. A score plot draws its dots
   *                                   through the bubble size scale, which is why these live
   *                                   under `bubble` on a plot with no bubbles.
   *   sizeLegendScale 1.7             the size key beside it, to match
   *
   * Not used: a per-group `seriesStyles["pca-g1"].symbolSize` — see below.
   */
  pcascore: {
    // `equalAspect` — on for every ordination map, and off everywhere else. These four kinds
    // are read as distances: how far apart two sites sit is the result, so a stretched figure
    // reports a difference the data does not contain. An ordinary XY graph plots two different
    // quantities against each other and has no such reading, which is why it stays opt-in.
    plot: { equalAspect: true, legend: { symbolScale: 1.5 }, bubble: { maxRadius: 12, minRadius: 2, sizeLegendScale: 1.7 } },
    fonts: { legend: { size: 17 } },
    /**
     * A per-group `seriesStyles["pca-g1"].symbolSize` is not set here: it does nothing
     * (checked by `kind-house-defaults.efficacy.test.tsx`). A score plot sizes its group
     * dots from the depth scale (`bubble.minRadius`–`maxRadius`, the 2–12 above), so a per-group
     * `symbolSize` inside that range is ignored: rendering it as 2, 3, 5 or 12 is byte-identical;
     * only above 12 does anything move, and then only because it escapes the scale.
     *
     * Note: the small dots come from `minRadius: 2` above, not from a per-group setting. A check
     * comparing 2 against 20 would pass for the wrong reason, since 20 escapes the scale.
     */
  },
  /**
   * Ordination — biplot and triplot. Nothing here but the 1:1 scale; both draw through the score
   * plot's builder and inherit its look from the style preset. See `pcascore` for why.
   */
  pcabiplot: {
    plot: { equalAspect: true },
  },
  triplot: {
    plot: { equalAspect: true },
  },
  /**
   * Network — a modern node-link look. Each value here addresses a specific problem:
   *
   *   a page-colour halo                       a dark 1px ring on an 8px node eats the fill;
   *                                            a light ring separates overlapping nodes
   *                                            without darkening them
   *   curved                                   straight lines crossing each other read as
   *                                            dated and cluttered
   *   edgeColor + edgeOpacity 0.25             edges recede so the nodes carry the message
   *   nodeSize 9                               nodes read as objects rather than dots
   *   low/highColor                            the important one. The ramp is a straight
   *                                            RGB mix, so #3b6fb0 → #c0392b passes through
   *                                            muddy mauve (#904d5b) at the midpoint. These
   *                                            lighter endpoints put a clean warm grey there
   *                                            instead — same two-stop mix, no mud.
   *
   * `layout` is deliberately absent. Force-directed is the right default for an unknown
   * graph; "layered" suits a directed cascade and is a per-graph choice, which the merge in
   * `applyKindHouseDefaults` preserves.
   *
   * Note: `nodeStroke` is `var(--bg)`, not `#ffffff` — the halo has to be the page colour, so it
   * follows the light/dark theme. A hardcoded white ring glows on a dark background.
   */
  /**
   * `nodeTwoTone` is not set: left unset, a node keeps the shared page-colour halo
   * (`nodeStroke` below), which is the house look; "Two-tone fill" in the Inspector switches
   * it on per graph (the precedence is explained where the network builder in `buildScene.ts`
   * resolves the node stroke; `kind-house-defaults.efficacy.test.tsx` guards it).
   */
  network: {
    plot: {
      network: {
        curved: true,
        nodeStroke: "var(--bg)",
        nodeStrokeWidth: 2,
        edgeColor: "#8b95a3",
        edgeOpacity: 0.25,
        nodeSize: 9,
        // 16: at panel-miniature scale (~0.58) an 11px node name renders ~6.3px, which is
        // unreadable. 16 keeps them legible standalone and ≥9px in a figure panel.
        labelSize: 16,
        lowColor: "#6baed6",
        highColor: "#fc8d59",
      },
    },
  },
  /**
   * Parallel coordinates — fonts, axis colour and line weight.
   *
   *   name 15             the variable name reads `fonts.axisTitle`, and the house preset's
   *   tick 11             size suits a chart with one or two axis titles — N of them across
   *                       the top of a figure is too heavy. The numbers can go properly
   *                       quiet (11) because they do not share a font with the names: N
   *                       ladders sit inside the data field, where the house tick size reads as
   *                       clutter. 15/11 keeps the name dominant and the scale subordinate.
   *   axisColor           `var(--line-2)` is a table-rule grey. Against a field of coloured
   *                       lines it vanishes, and the figure reads as a tangle of lines with no
   *                       structure. `var(--muted)` is what every other chart's axis furniture
   *                       uses. Note: a CSS var, not a hex, so it follows the light/dark theme —
   *                       same reason `network.nodeStroke` is `var(--bg)`.
   *   lineWidth 1 → 1.4   a 1px line at 0.6 opacity is barely present; 1.4 gives each trace
   *                       weight without the bundle merging into a mass.
   *   lineOpacity → 0.5   slightly airier than 0.6, which suits a real multivariate table
   *                       (dozens to hundreds of rows) while staying crisp at small n.
   *
   */
  /**
   * …plus a 17px legend at 1.2×. One of the per-kind legend sizes —
   * there is no single global to move them to (pie 15 · roc 16 · pcascore 17 · parallel 17 ·
   * pyramid/survival 18 · radar 21).
   *
   * Two per-graph settings are not style and are not here:
   *   • `parallel.colorColumn` — a column id from one table. A kind default is applied to
   *     every new graph of this kind, and that id means nothing in another table; it would either
   *     miss or, worse, colour by whichever column happened to share the id. Which variable colours
   *     the lines is a per-graph choice, like `network.layout`.
   *   • `parallel.brushes` — one graph's interactive brush state.
   */
  parallel: {
    plot: { parallel: { axisColor: "var(--muted)", lineWidth: 1.4, lineOpacity: 0.5 }, legend: { symbolScale: 1.2 } },
    fonts: { axisTitle: { size: 15 }, tick: { size: 11 }, legend: { size: 17 } },
  },
  /**
   * Histogram — `barWidth` 0.53. The data markers are 11.5 rather than the preset's 6.5, so the
   * points stay visible on top of the bars, as the bar chart's 14 does.
   */
  histogram: {
    plot: { barWidth: 0.53, figureWidth: 801, figureHeight: 531 },
    series: { symbolSize: 11.5 },
  },
  /**
   * Lollipop — starts clean; the user adds text.
   *
   * The builder's own fallbacks are `showValues ?? true` and `showDelta ?? true`, so without
   * this a lollipop carries two layers of text per row — the value at each dot and a Δ% beside
   * it. Both have a tickbox in the Lollipop block; only the starting state changes.
   *
   * Note: a creation default, deliberately: it reaches new lollipops and the gallery card, and
   * lollipops already saved in a project keep the labels they were drawn with. Turning those off
   * too would mean flipping the builder's fallback (`buildScene.ts`, `cfg.showValues ?? true`),
   * which would silently change existing figures, so the fallback stays `true`.
   */
  lollipop: {
    plot: { lollipop: { showValues: false, showDelta: false } },
  },
  /**
   * ─── Per-kind legend sizes ───────────────────────────────────────────────────────────
   *
   * The legend sizes (text px / key scale) differ by kind: pie 15/1.7× · roc 16/1.6× ·
   * pcascore 17/1.5× · parallel 17/1.2× · pyramid 18/1.2× · survival 18/1.9× · bar 18/1× ·
   * xy 18/1× · radar 21/1× · heatmap 22/1×. That is why legend type is per-kind and not in the shared
   * preset (whose `legendSize` is 12): there is no single number to move it to. A radar's legend has few
   * entries beside a compact web and can carry 21px; a pyramid's key sits under a wide chart at 18.
   *
   * Each entry changes the drawing; `kind-house-defaults.efficacy.test.tsx` renders the gallery
   * plot with and without each value to check it.
   */
  /**
   * Pie — a 15px legend at 1.7×, and a near-square figure.
   *
   * No default explode: new pies open with the slices together.
   * "Explode (all slices)" under Donut hole pulls every slice out in one control. Saved pies
   * keep their own explode.
   */
  pie: {
    // Near-square figure: a circle can only use min(w,h), so a wide box draws an empty flank.
    // The near-square default is the box the disc can actually fill, as for the heatmap; a
    // size the user sets is always honoured as given.
    // 760 wide: with the pie fitted to what it actually draws (each slice out along its own
    // direction, the drawing centred), a narrower box is width-limited by the legend's strip,
    // with a blank band below; 760×644 is where the drawing fills the largest share of the figure.
    plot: { legend: { symbolScale: 1.7 }, figureWidth: 760, figureHeight: 644 },
    fonts: { legend: { size: 15 } },
  },
  /**
   * PCA loadings — the arrow plot. Smaller square markers so the variable arrows dominate, and
   * a heavier arrow (1 → 2) so they read at figure size.
   *
   * `pcaStyle.labelPos` is not set: it is where loading labels were dragged on one figure, in
   * fractional coordinates — per-figure, like `legendOffset`.
   */
  pcaload: {
    // equalAspect: the loading arrows are directions in the same plane — an unequal scale turns
    // the correlation circle into an ellipse and bends every angle between two variables.
    plot: { equalAspect: true, pcaStyle: { arrowWidth: 2 } },
    // A `series` block sets one style on every series: 4.5px squares on all of them.
    series: { symbolSize: 4.5, symbol: "square" },
  },
  /**
   * Heatmap — the two fonts that belong to the heatmap itself: its colour-bar numbers and its
   * row/column labels. Both live under `plot.heatmap`, not `fonts`, because a heatmap has no
   * axis panel to put them in.
   *
   * No per-kind title size. The graph title is 26 globally (for all graph types where it
   * applies), and a per-kind font override silently beats the preset — so a title size here
   * would make the heatmap the one chart type ignoring that rule (the same reasoning as the bar
   * entry above).
   *
   * Note: the colour-bar size is written as `fonts.legend`, not as `heatmap.colorbarFont`, and
   * the two are not interchangeable:
   *   • `colorbarFont: {size: 18}` makes `fonts.legend` style nothing on a heatmap, and the
   *     "Legend font" control — which is offered here precisely because it styles the colour bar
   *     (`LEGEND_FONT_ONLY`) — stops working. `legend-offered.test.tsx` guards this.
   *   • the two render byte-identical markup. So this is the same bar size with a working
   *     control, and it uses the same per-kind legend-font mechanism as the other kinds here.
   */
  heatmap: {
    // labelFont 26, legend 22: the heatmap's 823×595 design shrinks to ~0.38 in an aligned
    // figure panel, where 20px labels render ~7px. Larger designed type keeps the panel
    // readable; the standalone graph gains with it.
    plot: { heatmap: { labelFont: { size: 26 } }, figureWidth: 823, figureHeight: 595 },
    fonts: { legend: { size: 22 } },
  },
  radar: {
    // Near-square default figure (the ring cannot use a 3:2 figure; same reasoning as
    // pie/treemap).
    // Legend symbol size left at 1: keys draw the dot the chart draws, so a larger scale would
    // make the key bigger than the radar's dots (keys match their marks, as on XY).
    plot: { figureWidth: 780, figureHeight: 580 },
    fonts: { legend: { size: 21 } },
  },
  /**
   * Treemap — label base 26 rather than 20 (the tick default): small cells floor at 0.55× the
   * base, and at panel-miniature scale (~0.53) a 20px base renders their value text ~5.5px.
   * The cell-fit machinery already drops any label that stops fitting, so a larger base never
   * overflows a cell — it only promotes readable text where there is room.
   */
  treemap: {
    // Near-square default figure (a pane-wide box leaves a blank flank; the disc + its heading
    // ring + the legend fill a ~square one).
    plot: { treemap: { labelSize: 26 }, figureWidth: 600, figureHeight: 580 },
  },
  /**
   * 3-D scatter — a figure the cube can fill. With the cube filling its plot area the card is
   * height-limited: the cube drawn at the default camera is ~1.35:1, so a wider box (928×608 is
   * 1.53:1) leaves a blank right strip. At height 608, width 720 is where the drawing fills the
   * largest share of the figure. Same reasoning as pie / treemap / radar; a size the user sets
   * is always honoured as given.
   */
  scatter3d: {
    plot: { figureWidth: 720, figureHeight: 608 },
  },
  /**
   * Correlation matrix — a figure the square grid can fill (as for pie / treemap). Cells are
   * square (the glyphs are circles), so the grid is height-limited; in a 928×608 box the grid and
   * its key use the left two-thirds and the rest is blank. At height 608, with the row names' 8px
   * edge room, width 670 is where the drawing fills the largest share of the figure.
   */
  corrmatrix: {
    plot: { figureWidth: 670, figureHeight: 608 },
  },
  /**
   * Volcano — points at 0.85 opacity (many overlapping points read better a little
   * translucent). Volcano is creatable from the New-graph wizard, and a created graph must look
   * like its gallery card (`one-default-look.test.ts`), so this is a kind default rather than a
   * card-only tweak.
   */
  volcano: {
    series: { symbolOpacity: 0.85 },
    // A volcano's points are coloured by significance zone, so a new volcano turns the legend on to
    // name those zones — the up/down/ns key. The zone key is emitted by the
    // builder whenever legend.show === true (buildScene volcano branch); a bare volcano built with no
    // legend stays keyless, which the default-geometry contract protects. This is a
    // floor — a graph that already set legend.show keeps its own choice (applyKindHouseDefaults merge).
    plot: { legend: { show: true } },
  },
  survival: {
    plot: { legend: { symbolScale: 1.9 } },
    fonts: { legend: { size: 18 } },
  },
  /**
   * ROC — a 16px legend at 1.6×.
   *
   * A ROC legend is outside-right and its labels are long ("Biomarker (AUC 0.860)"), so without a
   * limit legend type takes plot width — at 360px wide a 16px legend would reserve 313px and leave
   * 1px of plot, which `gallery.test.ts` rejects. Even the default 12px legend takes a large share
   * of the width, so the limit comes from the legend layout: `resolveLegend` keeps an outside-right
   * legend within about a third of the width by breaking long labels onto more lines, every label
   * kept whole (not ellipsised). At the gallery card's 580×380 the legend stays outside-right.
   */
  roc: {
    plot: { legend: { symbolScale: 1.6 } },
    fonts: { legend: { size: 16 } },
  },
  /**
   * Population pyramid — an 18px legend at 1.2×, and a Y axis title.
   *
   * Note: "Age band" is content: it names what a pyramid's rows usually are, and every new pyramid
   * arrives carrying it whatever its rows hold. This is a deliberate exception to the rule that
   * content stays out of kind defaults (see the bar chart's "Group"/"Mean") — a pyramid's Y
   * axis is age bands often enough for it to be a sensible starting label, and it is one click to
   * change. `titleFont: 22` matches the shared preset, so it changes nothing until the global
   * moves; it keeps the pyramid's Y title at 22 if the global changes.
   */
  pyramid: {
    plot: { legend: { symbolScale: 1.2 } },
    fonts: { legend: { size: 18 } },
    axes: { y: { title: "Age band", titleFont: { size: 22 } } },
  },
  /**
   * Estimation (Gardner-Altman) — bigger swarm dots and a slightly heavier interval whisker on
   * every group.
   *
   * `seriesStyles` also styles the synthetic **Difference** marker:
   * `est-diff` is the id `buildEstimationScene` gives that series, which `series` can
   * never reach because it is not a table dataset. Both settings change the drawing: solid
   * differs from open, and two-tone from plain solid.
   */
  estimation: {
    // Note: `series` reaches every dataset, so the card's third column also picks up
    // `errorWidth: 1.75` — it draws no interval of its own on this kind, so nothing visible
    // changes there.
    series: { symbolSize: 9, errorWidth: 1.75 },
    seriesStyles: { "est-diff": { symbolFill: "solid", fillType: "twotone" } },
  },
  /**
   * Note: the PCA score plot's entry is above (`pcascore`).
   */
};

/**
 * Apply a chart type's house default to a freshly-created plot.
 *
 * Lives here, beside the data it applies, so it can be tested directly rather than only by
 * rendering the whole app and inspecting an SVG — which is how a default that never reaches
 * the plot goes unnoticed.
 *
 * No-op for a kind with no house default, so every other chart type is untouched.
 */
export function applyKindHouseDefaults(
  doc: {
    toJSON(): { plots: Plot[]; tables: DataTable[] };
    setPlotOptions(plotId: string, patch: Partial<Plot>): void;
    setPlotFont(plotId: string, element: FontElement, patch: Partial<FontSpec>): void;
    setPlotAxis(plotId: string, axis: "x" | "y" | "y2" | "y3", patch: Partial<AxisSpec>): void;
    setSeriesStyle(plotId: string, columnId: string, delta: SeriesStyle): void;
  },
  plotId: string,
  kind: PlotKind | undefined,
  datasetsOf: (table: DataTable) => { id: string }[],
): void {
  const house = KIND_HOUSE_DEFAULTS[kind ?? "xy"];
  if (!house) return;
  if (house.plot) {
    /**
     * Caution: merge the nested style objects; do not replace them.
     *
     * `setPlotOptions` is `Object.assign`, so a house default carrying `network: {…}` would
     * replace whatever the plot already had under that key. The bar default is all scalars
     * (`barWidth`) and is unaffected; the network default is a whole `NetworkStyle`, and
     * replacing it would silently discard the per-graph choice sitting there — e.g. the gallery
     * card's `layout: "layered"` would revert to force-directed.
     *
     * The house default is a floor, not an override: anything already set on the plot is a
     * deliberate choice and wins.
     */
    const snap = doc.toJSON();
    const cur = snap.plots.find((p) => p.id === plotId) as Record<string, unknown> | undefined;
    const patch: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(house.plot as Record<string, unknown>)) {
      const existing = cur?.[k];
      patch[k] =
        v && typeof v === "object" && !Array.isArray(v) && existing && typeof existing === "object" && !Array.isArray(existing)
          ? { ...(v as object), ...(existing as object) }
          : v;
    }
    doc.setPlotOptions(plotId, patch as Partial<Plot>);
  }
  for (const [el, spec] of Object.entries(house.fonts ?? {})) doc.setPlotFont(plotId, el as FontElement, spec);
  for (const [ax, patch] of Object.entries(house.axes ?? {})) doc.setPlotAxis(plotId, ax as "x" | "y", patch);
  if (house.series) {
    const snap = doc.toJSON();
    const plot = snap.plots.find((p) => p.id === plotId);
    const table = plot ? snap.tables.find((t) => t.id === plot.source) : undefined;
    if (table) for (const ds of datasetsOf(table)) doc.setSeriesStyle(plotId, ds.id, house.series);
  }
  /**
   * Named series last, so a builder-invented series (a PCA group, an estimation Difference) can
   * differ from the blanket `series` style above rather than being overwritten by it.
   */
  for (const [id, style] of Object.entries(house.seriesStyles ?? {})) doc.setSeriesStyle(plotId, id, style);
}
