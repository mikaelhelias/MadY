/**
 * Read-back for an LLM agent: build a graph's scene and say, in plain serializable facts,
 * what actually reached the drawing.
 *
 * Why this exists: an LLM driving MadY over the MCP server can set an option, but without this
 * it cannot tell whether the option landed, whether the builder refused it, or what the axes
 * ended up as. `buildPlotScene` already resolves real pixel geometry and already records what it
 * could not place in `scene.warnings`; nothing new is computed here, the scene is only reported.
 *
 * No second mutation path, and no second geometry. This module is read-only: it calls the
 * same `buildPlotScene` the app's panes call, through the same `scenePaletteOpt` resolution, so
 * a description can never disagree with the picture the user would see.
 *
 * Note: text widths are estimated. The app passes a DOM-backed `measure`; headless callers get
 * `buildPlotScene`'s built-in `estimateWidth` fallback, exactly as the headless tests do.
 * Geometry that depends on text width (label placement, some margins) is therefore close, not
 * exact. Everything reported here — domains, ticks, counts, colours, warnings — is unaffected.
 */
import type { DataTable, NodeId, Plot } from "@mady/core";
import { buildPlotScene, type BuildPlotSceneOptions } from "./buildScene.js";
import type { AxisScene, PlotScene } from "./scene.js";
import { scenePaletteOpt } from "./scenePalette.js";

export interface AxisDescription {
  title: string;
  /** "linear" | "log" | … — the resolved scale, not what was asked for. */
  type: string;
  /** True for a category (band) axis: `domain` is then an index range, not data values. */
  band: boolean;
  /** The domain actually drawn, after nice()/decade snapping. */
  domain: [number, number];
  tickCount: number;
  /** Up to 10 tick labels; a longer axis is elided in the middle so both ends stay visible. */
  tickLabels: string[];
}

export interface SeriesDescription {
  id: NodeId;
  name: string;
  color: string;
  /** Data marks drawn for this series (points/bars/…). */
  marks: number;
  hasLine: boolean;
  hasArea: boolean;
  hasBand: boolean;
  /** Set when the series is borrowed from another datasheet (`plot.overlays`). */
  fromTable?: string;
}

export interface SceneDescription {
  kind: string;
  size: { width: number; height: number };
  plotRect: { x: number; y: number; width: number; height: number };
  title: string;
  subtitle: string;
  axes: { x?: AxisDescription; y?: AxisDescription; y2?: AxisDescription; y3?: AxisDescription };
  series: SeriesDescription[];
  /** Every populated drawable layer → how many things it holds. See `collectDrawn`. */
  drawn: Record<string, number>;
  drawnTotal: number;
  /**
   * True when the graph draws real content but `series` is empty.
   *
   * Why this field exists: eight kinds draw outside the series layer — pie, treemap,
   * radar, parallel, lollipop, paireddot (and volcano/ROC in part), per the `LegendEntry.selects`
   * note in scene.ts. Anything that judged "is this graph empty?" by `series.length` would call
   * a finished pie chart blank, and an agent believing that would set about "fixing" a working
   * figure. Read `drawnTotal`, never `series.length`.
   */
  drawsOutsideSeriesLayer: boolean;
  /** Legend rows, with what each one selects (so an agent can target it). */
  legend: { label: string; selects?: string }[];
  /** Annotation kind → count (text, bracket, hline, …). */
  annotations: Record<string, number>;
  /** Fitted curves drawn over the data (`fit` plus per-dataset `fits`). */
  fits: number;
  /**
   * The builder's own account of what it could not do. This is the single most useful field
   * for an agent: a refusal is a value here, not a silent drop.
   */
  warnings: string[];
  /** Present only when the scene could not be built at all; everything else is then empty. */
  error?: string;
}

/**
 * Scene fields that are structure, chrome or config rather than a layer of drawn things.
 *
 * Note: the default is to count, and the direction matters. An unlisted config field gets counted
 * and merely adds noise; an unlisted drawable field would go uncounted, and a finished graph
 * would be reported as empty (see `drawsOutsideSeriesLayer` above). So a new scene field is described automatically and a
 * new chart kind needs no edit here — the failure mode of forgetting is noise, not a wrong report.
 * Scalars are skipped without being listed (a number or string is never a layer of marks).
 */
const NOT_A_DRAWN_LAYER = new Set<string>([
  // geometry / structure
  "plot", "x", "y", "y2", "y3", "auto", "zoomable", "image",
  // typography, framing and offsets
  "fonts", "axisGaps", "axisLabels", "grid", "axisStyle", "legendLayout", "backdrop",
  "titleOffset", "subtitleOffset", "legendOffset", "colorbarOffset", "significanceCaptionStyle",
  "footer",
  // reported on their own fields, so counting them here would double-count
  "series", "legend", "annotations", "warnings", "fit", "fits",
]);

/**
 * How many things a drawable layer holds.
 *
 * A per-kind layer is an object holding its parts (`pie.slices`, `heatmap.cells`, `venn.sets`…),
 * so report the largest array it carries — "pie: 7" means seven slices, not a bare 1.
 *
 * An object that has part-arrays but whose arrays are all empty counts 0, not 1. Falling back
 * to 1 there would report an empty layer as drawn — the same misreport, one level down, that
 * `drawsOutsideSeriesLayer` exists to prevent. Only a layer with no part-arrays at all (an
 * atomic drawable like `spreadBand` or `colorbar`) counts as 1.
 */
export function layerSize(value: unknown): number {
  if (Array.isArray(value)) return value.length;
  if (value === null || typeof value !== "object") return 0;
  let best = 0;
  let hasArrayPart = false;
  for (const v of Object.values(value as Record<string, unknown>)) {
    if (Array.isArray(v)) {
      hasArrayPart = true;
      if (v.length > best) best = v.length;
    }
  }
  return hasArrayPart ? best : 1;
}

/** Every populated drawable layer in the scene, keyed by its scene field. */
function collectDrawn(scene: PlotScene): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(scene as unknown as Record<string, unknown>)) {
    if (NOT_A_DRAWN_LAYER.has(key)) continue;
    if (value === null || value === undefined) continue;
    if (typeof value !== "object") continue; // scalars are settings, never a layer
    const n = layerSize(value);
    if (n > 0) out[key] = n;
  }
  return out;
}

/** Keep both ends of a long tick list visible rather than truncating the tail away. */
function sampleLabels(labels: string[], max = 10): string[] {
  if (labels.length <= max) return labels;
  const head = labels.slice(0, max - 3);
  return [...head, `… (${labels.length - (max - 2)} more)`, labels[labels.length - 1]!];
}

function describeAxis(axis: AxisScene | undefined): AxisDescription | undefined {
  if (!axis) return undefined;
  return {
    title: axis.title,
    type: String(axis.type),
    band: axis.band === true,
    domain: axis.domain,
    tickCount: axis.ticks.length,
    tickLabels: sampleLabels(axis.ticks.map((t) => String(t.label ?? ""))),
  };
}

/**
 * Build `plot` against `table` and describe the resulting scene.
 *
 * `options` is passed through to `buildPlotScene` — a caller with a project should supply
 * `tables` (so `plot.overlays` series from other datasheets are joined) and `gradients` (so a
 * `custom:<id>` ramp resolves), exactly as the live pane does. The palette is resolved here so
 * every call site obeys the one rule; an explicit `options.palette` still wins.
 */
export function describeScene(
  table: DataTable,
  plot: Plot,
  options: BuildPlotSceneOptions = {},
): SceneDescription {
  let scene: PlotScene;
  try {
    scene = buildPlotScene(table, plot, { ...scenePaletteOpt(plot), ...options });
  } catch (e) {
    // A failure is a value, matching the agent API's contract — never a throw at the caller.
    return {
      kind: String(plot.kind ?? "xy"),
      size: { width: 0, height: 0 },
      plotRect: { x: 0, y: 0, width: 0, height: 0 },
      title: "",
      subtitle: "",
      axes: {},
      series: [],
      drawn: {},
      drawnTotal: 0,
      drawsOutsideSeriesLayer: false,
      legend: [],
      annotations: {},
      fits: 0,
      warnings: [],
      error: e instanceof Error ? e.message : String(e),
    };
  }

  const drawn = collectDrawn(scene);
  const series: SeriesDescription[] = scene.series.map((s) => ({
    id: s.id,
    name: s.name,
    color: s.color,
    marks: s.marks?.length ?? 0,
    hasLine: Boolean(s.linePath) || Boolean(s.overlayLine),
    hasArea: Boolean(s.areaPath),
    hasBand: Boolean(s.bandPath),
    ...(s.from ? { fromTable: s.from.name } : {}),
  }));
  if (series.length > 0) drawn.series = series.reduce((n, s) => n + Math.max(s.marks, 1), 0);

  const annotations: Record<string, number> = {};
  for (const a of scene.annotations ?? []) {
    const k = String((a as { kind?: unknown }).kind ?? "unknown");
    annotations[k] = (annotations[k] ?? 0) + 1;
  }

  const drawnTotal = Object.values(drawn).reduce((a, b) => a + b, 0);

  return {
    kind: String(scene.kind),
    size: { width: scene.width, height: scene.height },
    plotRect: scene.plot,
    title: scene.title ?? "",
    subtitle: scene.subtitle ?? "",
    axes: {
      ...(describeAxis(scene.x) ? { x: describeAxis(scene.x)! } : {}),
      ...(describeAxis(scene.y) ? { y: describeAxis(scene.y)! } : {}),
      ...(describeAxis(scene.y2) ? { y2: describeAxis(scene.y2)! } : {}),
      ...(describeAxis(scene.y3) ? { y3: describeAxis(scene.y3)! } : {}),
    },
    series,
    drawn,
    drawnTotal,
    drawsOutsideSeriesLayer: series.length === 0 && drawnTotal > 0,
    // Note: the field is `select` (singular). Reading a misspelt `selects` would silently produce
    // rows with no target at all — the exact silent drop this module exists to expose.
    legend: (scene.legend ?? []).map((l) => ({
      label: l.label,
      ...(l.select ? { selects: `${l.select.as}:${l.select.id}` } : {}),
    })),
    annotations,
    fits: (scene.fit ? 1 : 0) + (scene.fits?.length ?? 0),
    warnings: scene.warnings ?? [],
  };
}
