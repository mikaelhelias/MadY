/**
 * The shared axis range for small graphs (Graph ▸ Split into small graphs): the range the
 * original graph draws, with all its series, read from its real scene. Every small graph is
 * pinned to it (`MadyDocument.syncSplitCopies`), so the panels can be compared by eye — a copy
 * left to pick its own range would scale 0–50 next to 0–500.
 *
 * Only numeric axes are pinned; a category axis (bars, boxes) has no range to share. A flipped
 * chart draws its value axis across, so the on-screen axis is mapped back to the setting it
 * belongs to (`dataAxisOf`).
 */
import { dataAxisOf, type DataTable, type Plot, type SplitPins } from "@mady/core";
import { buildPlotScene } from "./buildScene.js";

export function splitPins(table: DataTable, plot: Plot): SplitPins {
  const size = { width: 480, height: 360 };
  const scene = buildPlotScene(table, plot, size);
  const pins: SplitPins = {};
  for (const visual of ["x", "y"] as const) {
    const ax = scene[visual];
    if (!ax || ax.band) continue;
    const [lo, hi] = ax.domain;
    if (!Number.isFinite(lo) || !Number.isFinite(hi) || lo === hi) continue;
    const axis = dataAxisOf(plot, visual);
    if (axis !== "x" && axis !== "y") continue;
    // Pin only where pinning changes nothing on the original's own drawing. An automatic XY
    // range leaves a gap between the axis and the first point; an exact min/max removes it, so a
    // pinned small graph would draw its first point on the tick numbers. There the hidden series still
    // set the range (XY keeps them in it), so the copies match without a pin.
    const range: [number, number] = [Math.min(lo, hi), Math.max(lo, hi)];
    const specKey = axis === "x" ? "xAxis" : "yAxis";
    const pinned = buildPlotScene(table, { ...plot, [specKey]: { ...(plot[specKey] ?? {}), min: range[0], max: range[1] } }, size);
    const at = (s: typeof scene): string => JSON.stringify(s[visual]?.ticks.map((t) => [t.label, Math.round(t.pos)]));
    if (at(pinned) === at(scene)) pins[axis] = range;
  }
  return pins;
}
