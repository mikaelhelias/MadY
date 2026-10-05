/**
 * A graph's look as data: `capturePlotStyle` copies the presentation of a plot (everything but
 * its data), `SHARED_KEYS` is the part that transfers across graph types, and `MATCH_KEYS` are
 * the per-aspect sets behind the panel assembler's "match across panels" buttons.
 *
 * Saved graph templates (a named look per graph type, kept per machine in localStorage) are read
 * here only so that `migrateTemplates.ts` can fold them into presets at start-up; a preset
 * carries a graph type's own settings as a per-type section (`presetKeys.ts`). Nothing writes or
 * deletes the template store.
 */
import type { AxisSpec, FontSpec, Plot, PlotKind } from "@mady/core";
import { dGet } from "./durableStore";

/** Full presentation of a graph for its own graph type — everything but the data,
 *  source, kind, status, and on-graph annotations/fits. */
const TEMPLATE_KEYS: (keyof Plot)[] = [
  "figureWidth", "figureHeight", "xAxisLength", "yAxisLength", "plotPad",
  // Note: y2/y3 travel with x/y. Without them a dual-axis graph would save its look and silently
  // lose the second axis's tick length, thickness, spacing and number format (the keys exist on
  // Plot as `y2Axis`, `y3Axis`). `capturePlotStyle` skips undefined, so a graph without a second
  // axis is unaffected.
  "fonts", "xAxis", "yAxis", "y2Axis", "y3Axis", "grid", "frame", "tickDir", "tickLen",
  "legend", "legendOffset", "colorbarOffset", "titleAlign", "titleOffset", "footer",
  "background", "palette", "paletteColors", "seriesStyles",
  // kind-specific look (harmless on other kinds — only applied for same-type):
  "barLayout", "barShape", "barWidth", "barOrientation", "barSeriesGroups", "areaStack", "spread",
  "boxWhisker", "showValues", "valueDecimals", "pieStartAngle", "pieDirection",
  "pieDonut", "pieLabels", "pieLabelPosition", "pieDisplay", "heatmap", "ridgeline", "lollipop",
  "significance",
];

/** The subset that transfers cleanly across graph types (cross-type homogenise):
 *  dimensions, typography, axis + legend look, colours — no kind-specific geometry
 *  and no per-series styles (datasets differ between graphs). */
export const SHARED_KEYS: (keyof Plot)[] = [
  "figureWidth", "figureHeight", "xAxisLength", "yAxisLength", "plotPad",
  // y2/y3 as above — a dual-axis look transfers whole, and is skipped when absent.
  "fonts", "xAxis", "yAxis", "y2Axis", "y3Axis", "grid", "frame", "tickDir", "tickLen",
  // `paletteColors` rides with `palette`: an applied preset stores its palette as
  // literal colours there, and a capture that dropped it would restyle every kind
  // except the builder-coloured ones (survival/ROC/PCA/treemap/…).
  "legend", "titleAlign", "background", "palette", "paletteColors",
];

/** Per-aspect key sets for the panel assembler's "match across panels" buttons. */
export const MATCH_KEYS: Record<"all" | "size" | "fonts" | "axes" | "colours", (keyof Plot)[]> = {
  all: SHARED_KEYS,
  size: ["figureWidth", "figureHeight", "xAxisLength", "yAxisLength", "plotPad"],
  fonts: ["fonts"],
  axes: ["xAxis", "yAxis", "y2Axis", "y3Axis", "grid", "frame", "tickDir", "tickLen"],
  colours: ["palette", "paletteColors"],
};

/**
 * The per-target half of a "Match → Fonts" (and "Everything"): the font carriers a
 * generic `fonts` transfer can never reach, translated from the reference.
 *
 * Without it, a fonts match leaves a heatmap's row and column label fonts unchanged. In general,
 * a kind whose text reads a kind-specific carrier keeps it through a fonts match —
 *   • heatmap row/column labels read `heatmap.labelFont` (stamped 20px at creation),
 *   • network node labels read `network.labelSize`,
 *   • any per-axis `tickFont`/`titleFont` override (the pyramid's stamped 22px
 *     y-axis title) silently beats the freshly-matched `fonts`.
 * The patch rebases each of those onto the reference's fonts: kind carriers follow the
 * reference's tick font; per-axis overrides are rebased to the reference's own (usually
 * none — cleared, so the matched `fonts` rule). Nested objects are merged from the
 * target, so ramps/titles/ranges survive. Returns null when nothing needs translating.
 */
export function kindFontMatchPatch(target: Plot, ref: Plot): Partial<Plot> | null {
  const refTick: FontSpec | undefined = ref.fonts?.tick;
  const patch: Partial<Plot> = {};
  if (target.kind === "heatmap" && (target.heatmap?.labelFont || refTick)) {
    patch.heatmap = { ...(target.heatmap ?? {}), labelFont: refTick ? { ...refTick } : undefined };
  }
  if (target.kind === "network" && (target.network?.labelSize !== undefined || refTick?.size !== undefined)) {
    patch.network = { ...(target.network ?? {}), labelSize: refTick?.size };
  }
  const rebaseAxis = (t: AxisSpec | undefined, r: AxisSpec | undefined): AxisSpec | undefined => {
    const has = t?.tickFont || t?.titleFont || r?.tickFont || r?.titleFont;
    if (!has) return undefined;
    return {
      ...(t ?? {}),
      tickFont: r?.tickFont ? { ...r.tickFont } : undefined,
      titleFont: r?.titleFont ? { ...r.titleFont } : undefined,
    };
  };
  const x = rebaseAxis(target.xAxis, ref.xAxis);
  const y = rebaseAxis(target.yAxis, ref.yAxis);
  if (x) patch.xAxis = x;
  if (y) patch.yAxis = y;
  return Object.keys(patch).length ? patch : null;
}

export interface GraphTemplate {
  name: string;
  kind: PlotKind;
  /** The captured presentation (a partial Plot). */
  style: Partial<Plot>;
}

const KEY = "mady.templates.v1";

/** Capture the presentation of a plot into a template style object. */
export function capturePlotStyle(
  plot: Plot,
  keys: (keyof Plot)[] = TEMPLATE_KEYS,
  /** Include keys whose value is undefined (as an explicit "reset to default").
   *  Needed for matching — so matching a default-styled reference clears the
   *  target's overrides instead of silently doing nothing. Off for saved templates. */
  includeUndefined = false,
): Partial<Plot> {
  const out: Partial<Plot> = {};
  for (const k of keys) {
    const v = plot[k];
    if (v !== undefined) (out as Record<string, unknown>)[k] = JSON.parse(JSON.stringify(v));
    else if (includeUndefined) (out as Record<string, unknown>)[k] = undefined;
  }
  return out;
}

function readAll(): GraphTemplate[] {
  try {
    const raw = dGet(KEY);
    return raw ? (JSON.parse(raw) as GraphTemplate[]) : [];
  } catch {
    return [];
  }
}

/** Every saved template, read-only — the start-up migration folds them into presets. */
export function allTemplates(): GraphTemplate[] {
  return readAll();
}
