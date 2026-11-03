/**
 * Small graphs (Graph ▸ Split into small graphs) — the pure half.
 *
 * A small graph is a copy of one original graph that shows one series. It is re-made from the
 * original after every change (`MadyDocument.syncSplitCopies`), the way a sheet made from another
 * sheet is recomputed. The copy keeps as its own only what the user placed by hand on it:
 * positions and sizes. Everything else — colours, axes, fonts, the data — comes from the original.
 *
 * What counts as "a position" is decided by the setting's name, not by a hand list: the drag
 * handlers write into ~35 different places, many nested inside a chart's own settings
 * (`heatmap.rowTracks[i].nameOffset`, `categoryGroups.nameOffsets`…). A hand list would miss the
 * next one added. `splitCopies.test.ts` checks the name rule against every drag handler's target.
 */
import type { NodeId, Plot } from "./model";

/** A setting whose name marks it as a hand-placed position or a size. */
const POSITION_KEY = /(Offsets?|Positions|[lL]abelPos)$|^(offset|axisLabelOff|figureWidth|figureHeight|displayScale|xAxisLength|yAxisLength|valueLabelDy|valueDx|valueDy|legendLoose)$/;

/** Inside an annotation (a note, arrow, bracket, reference line), these place it on the graph. */
const ANNOTATION_POSITION_KEYS = new Set(["x", "y", "x2", "y2", "w", "h", "rotation", "bracketY", "bracketShift", "value", "from", "to"]);

export function isPositionKey(key: string): boolean {
  return POSITION_KEY.test(key);
}

/** The same axis range on every small graph: data-space [low, high] per numeric axis. */
export interface SplitPins {
  x?: [number, number] | undefined;
  y?: [number, number] | undefined;
}

type Json = unknown;

function isObject(v: Json): v is Record<string, Json> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * `made` with every position/size setting taken from `own` instead. Walks both trees together;
 * array items are matched by `id` when they carry one (annotations), else by index.
 */
export function keepPositions(made: Json, own: Json, inAnnotation = false): Json {
  if (Array.isArray(made) && Array.isArray(own)) {
    const byId = made.every((m) => isObject(m) && typeof m.id === "string");
    return made.map((m, i) => {
      const o = byId ? own.find((x) => isObject(x) && x.id === (m as Record<string, Json>).id) : own[i];
      return o === undefined ? m : keepPositions(m, o, inAnnotation);
    });
  }
  if (!isObject(made) || !isObject(own)) return made;
  const out: Record<string, Json> = {};
  const keys = new Set([...Object.keys(made), ...Object.keys(own)]);
  for (const k of keys) {
    const position = isPositionKey(k) || (inAnnotation && ANNOTATION_POSITION_KEYS.has(k));
    const inner = inAnnotation || k === "annotations";
    // A group only the copy has (the original never set a Y axis, or a per-point style) still
    // carries the copy's positions inside it — keep those, and nothing else of it.
    const v = position ? own[k] : k in made ? keepPositions(made[k], own[k], inner) : onlyPositions(own[k], inner);
    if (v !== undefined) out[k] = v;
  }
  return out;
}

/** The positions inside a group the original does not have; undefined when there are none. */
function onlyPositions(own: Json, inAnnotation: boolean): Json {
  if (!isObject(own) || inAnnotation) return undefined;
  const kept = keepPositions({}, own) as Record<string, Json>;
  return Object.keys(kept).length ? kept : undefined;
}

/**
 * What the small graph `copy` should be right now: the original, showing only the copy's
 * series, with the shared axis range pinned, and the copy's own positions and sizes kept.
 * `series` = every series of the original's sheet. The copy's title is its series' name — a small
 * graph must say which series it shows, and the figure page shows these titles.
 */
export function deriveSplitCopy(source: Plot, copy: Plot, series: readonly { id: NodeId; name: string }[], pins?: SplitPins): Plot {
  const seriesIds = series.map((d) => d.id);
  const made: Plot = JSON.parse(JSON.stringify(source));
  made.id = copy.id;
  made.name = copy.name;
  made.splitFrom = copy.splitFrom;
  made.status = copy.status;
  const own = copy.splitFrom?.series;
  const styles = { ...(made.seriesStyles ?? {}) };
  for (const id of seriesIds) styles[id] = { ...(styles[id] ?? {}), hidden: id === own ? undefined : true };
  for (const id of Object.keys(styles)) if (styles[id] && styles[id]!.hidden === undefined) delete styles[id]!.hidden;
  made.seriesStyles = styles;
  const ownName = series.find((d) => d.id === own)?.name;
  if (ownName !== undefined) made.title = ownName;
  if (pins?.x) made.xAxis = { ...(made.xAxis ?? {}), min: pins.x[0], max: pins.x[1] };
  if (pins?.y) made.yAxis = { ...(made.yAxis ?? {}), min: pins.y[0], max: pins.y[1] };
  return keepPositions(made, copy) as Plot;
}

/** Deep equality of two JSON values, treating a missing key and an `undefined` one alike. */
export function sameJson(a: Json, b: Json): boolean {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((v, i) => sameJson(v, b[i]));
  }
  if (!isObject(a) || !isObject(b)) return false;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) if (!sameJson(a[k], b[k])) return false;
  return true;
}

/** Chart types a graph can be split for: ones that draw each series as its own mark — a line or
 *  XY scatter, an area, bars, a box, violin, column scatter or raincloud, a histogram, a radar
 *  polygon or lollipops. Others (pie, heatmap, venn…) have no "one series" to show alone — pie
 *  already draws its own small pies. */
export const SPLITTABLE_KINDS: ReadonlySet<string> = new Set([
  "xy", "area", "bar", "box", "violin", "scatter", "raincloud", "histogram", "radar", "lollipop",
]);

/** Why this graph cannot be split, or null when it can. */
export function splitRefusal(plot: Plot, seriesCount: number): string | null {
  if (plot.splitFrom) return "This graph is already a small graph.";
  if (!SPLITTABLE_KINDS.has(plot.kind ?? "xy")) return "Only line, scatter, area, bar, box, violin, column scatter, raincloud, histogram, radar and lollipop charts can be split into one graph per series.";
  if (seriesCount < 2) return "The graph has only one series.";
  return null;
}
