/** Where a bar's value label rests, and how far the labels of a horizontal bar chart reach past its plot. */
import type { PlotScene } from "./scene.js";
import { swarmDotRadius } from "./markGeometry.js";

/** Format a bar's value label: fixed decimals when set, else trimmed to ~6 sig digits. */
export function fmtValueLabel(v: number, decimals?: number | undefined): string {
  if (!Number.isFinite(v)) return "";
  return decimals != null ? v.toFixed(decimals) : String(Number(v.toFixed(6)));
}

/**
 * Where a bar's value label rests (before any per-label nudge), by `plot.valuePlacement`:
 *   above      — just past the bar's end (the default placement);
 *   insideEnd  — inside the bar, tucked under its end;
 *   insideBase — inside the bar at its foot, just off the axis (at the bottom of the
 *                bar, still inside, and not colliding with the X axis).
 * A bar too short to hold the text (inside placements) falls back to "above" — a number that
 * would sit half outside a stub, or on the axis line, is worse than the default position. For the
 * inside placements a negative bar mirrors: its end is the low edge, its foot the axis edge.
 * Pure.
 */
export function valueLabelPlace(
  scene: { barHorizontal?: boolean | undefined; valueLabels?: { dy: number; placement?: "above" | "insideEnd" | "insideBase" | undefined } | undefined; fonts: { valueLabel: { size: number } } },
  bar: { x: number; y: number; w: number; h: number },
  value: number,
  text: string,
  /** Every data point drawn over the bars ("points on bars"), with its radius. A one-value bar draws its point exactly
   *  at its end, and the next series' dot is only a bar's thickness away, so a label that rests "above" starts past the
   *  edge of every dot that shares its line (horizontal bars) or its column (vertical bars), not inside it. */
  dots?: ReadonlyArray<{ cx: number; cy: number; r: number }> | undefined,
): { anchor: "start" | "middle" | "end"; baseX: number; baseY: number; placement: "above" | "insideEnd" | "insideBase" } {
  const size = scene.fonts.valueLabel.size;
  const nudge = scene.valueLabels?.dy ?? 0;
  const want = scene.valueLabels?.placement ?? "above";
  const neg = value < 0;
  if (scene.barHorizontal) {
    // Horizontal bars: the end is the right edge (left for negatives), the foot is the axis edge.
    const textW = text.length * size * 0.6 + 8;
    const fits = bar.w >= textW;
    const placement = want !== "above" && !fits ? "above" : want;
    const midY = bar.y + bar.h / 2 + size * 0.34 + nudge;
    if (placement === "insideEnd") return neg ? { anchor: "start", baseX: bar.x + 4, baseY: midY, placement } : { anchor: "end", baseX: bar.x + bar.w - 4, baseY: midY, placement };
    if (placement === "insideBase") return neg ? { anchor: "end", baseX: bar.x + bar.w - 4, baseY: midY, placement } : { anchor: "start", baseX: bar.x + 4, baseY: midY, placement };
    // "above" ignores the value's sign: the label always sits past the right edge — or past the edge of the furthest dot
    // that shares its line (the text spans from 0.8 of its size above the baseline to 0.2 below).
    const inLine = (dots ?? []).filter((d) => d.cy + d.r > midY - size * 0.8 && d.cy - d.r < midY + size * 0.2);
    const reach = Math.max(bar.x + bar.w, ...inLine.map((d) => d.cx + d.r));
    return { anchor: "start", baseX: reach + 4, baseY: midY, placement: "above" };
  }
  const fits = bar.h >= size + 8;
  const placement = want !== "above" && !fits ? "above" : want;
  const cx = bar.x + bar.w / 2;
  if (placement === "insideEnd") return { anchor: "middle", baseX: cx, baseY: (neg ? bar.y + bar.h - 4 : bar.y + size + 2) + nudge, placement };
  if (placement === "insideBase") return { anchor: "middle", baseX: cx, baseY: (neg ? bar.y + size + 2 : bar.y + bar.h - 4) + nudge, placement };
  // "above" ignores the value's sign: the label always sits just above the bar's top edge — or the top of the highest dot
  // beside it (the text is about 0.6 of its size wide per character).
  const half = (text.length * size * 0.6) / 2;
  const inColumn = (dots ?? []).filter((d) => d.cx + d.r > cx - half && d.cx - d.r < cx + half);
  const top = Math.min(bar.y, ...inColumn.map((d) => d.cy - d.r));
  return { anchor: "middle", baseX: cx, baseY: top - 4 + nudge, placement: "above" };
}

/** Every data point drawn over the bars ("points on bars"), with its radius: what a number resting "above" must clear. */
export function barNumberDots(series: PlotScene["series"]): Array<{ cx: number; cy: number; r: number }> {
  return series.flatMap((s) => s.marks.flatMap((m) => (m.points ?? []).map((p) => ({ cx: p.cx, cy: p.cy, r: swarmDotRadius(m.symbolSize ?? s.symbolSize) }))));
}

/**
 * How far right the numbers of a horizontal bar chart reach, in the scene's px: the right end of the furthest one, as the
 * renderer rests it (`valueLabelPlace`, the same dots and text). The builder compares this with where the right-hand legend
 * starts and makes room, so a number that overhangs the plot's edge is never drawn under the legend. `undefined` when the
 * scene draws no bar-end numbers.
 */
export function barEndLabelReach(
  scene: Pick<PlotScene, "barHorizontal" | "valueLabels" | "fonts" | "series">,
  measure: (text: string, fontPx: number) => number,
): number | undefined {
  if (!scene.barHorizontal || !scene.valueLabels?.show) return undefined;
  const size = scene.fonts.valueLabel.size;
  const dots = barNumberDots(scene.series);
  let reach: number | undefined;
  for (const s of scene.series) {
    for (const m of s.marks) {
      if (!m.bar || !Number.isFinite(m.dy) || m.valueText === "") continue;
      const text = m.valueText ?? fmtValueLabel(m.dy, scene.valueLabels.decimals);
      const p = valueLabelPlace(scene, m.bar, m.dy, text, dots);
      // Only the numbers that rest past the bar can overhang: an inside number is within it.
      if (p.placement !== "above") continue;
      // The resting position only: a number the user dragged is theirs to place, and must not move the legend.
      const right = p.baseX + measure(text, size);
      if (reach === undefined || right > reach) reach = right;
    }
  }
  return reach;
}
