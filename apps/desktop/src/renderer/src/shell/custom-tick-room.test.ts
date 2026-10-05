/**
 * A custom tick label gets its room beside a Y axis — on every chart type that has one.
 *
 * Guards against sizing the space beside a value axis from the automatic tick labels only, which lets a
 * longer label typed on a custom tick ("Add tick") run off the canvas and be blanked, with a warning. The
 * width is measured in one helper shared by every chart builder, so this census holds each gallery card
 * that draws a numeric axis on the left or right to it - a builder that forgets fails here by name, rather
 * than only the xy fixture in custom-tick-labels.test.ts.
 *
 * The opposite direction - a graph with no custom tick lays out unchanged - is held by
 * preset-invariance.test.ts, which hashes every gallery card's scene.
 */
import { describe, expect, it } from "vitest";
import type { AxisSpec, Plot } from "@mady/core";
import { buildPlotScene } from "@mady/graphics";
import type { AxisScene, PlotScene } from "@mady/graphics";
import { galleryItems } from "./gallery";

const SIZE = { width: 620, height: 420 };
const LONG = "a very long custom label";

type AxisKey = "yAxis" | "xAxis" | "y2Axis" | "y3Axis";
/** Which spec carries the ticks drawn on a vertical (left / right) axis of this scene. */
function verticalAxes(plot: Plot, scene: PlotScene): { key: AxisKey; ax: AxisScene }[] {
  const out: { key: AxisKey; ax: AxisScene }[] = [];
  // The LEFT axis draws the data Y axis on an upright chart and the data X axis on a flipped one: the builder's
  // own rule (specY = transposed ? xAxis : yAxis) is visible in the scene as which spec's title it shows.
  const leftKey: AxisKey = plot.xAxis?.title != null && scene.y.title === plot.xAxis.title && plot.yAxis?.title !== plot.xAxis.title ? "xAxis" : "yAxis";
  out.push({ key: leftKey, ax: scene.y });
  if (scene.y2 && scene.y2.side !== "top") out.push({ key: "y2Axis", ax: scene.y2 });
  if (scene.y3) out.push({ key: "y3Axis", ax: scene.y3 });
  return out;
}

const numeric = (ax: AxisScene | undefined): ax is AxisScene =>
  !!ax && !ax.band && !ax.hidden && ax.ticks.some((t) => !t.minor && t.label !== "") && Number.isFinite(ax.domain[0]) && Number.isFinite(ax.domain[1]);

describe("a long custom tick label is drawn in full beside every vertical value axis", () => {
  const items = galleryItems() as unknown as { key: string; table: never; plot: Plot }[];
  let checked = 0;

  for (const item of items) {
    const kind = item.plot.kind ?? "xy";
    const base = buildPlotScene(item.table, item.plot, SIZE);
    for (const { key, ax } of verticalAxes(item.plot, base)) {
      if (!numeric(ax)) continue;
      it(`${kind} [${item.key}] ${key}`, () => {
        checked++;
        const [a, b] = ax.domain;
        const mid = (a + b) / 2;
        const spec: AxisSpec = { ...(item.plot[key] ?? {}), extraTicks: [...(item.plot[key]?.extraTicks ?? []), { value: mid, label: LONG }] };
        const s = buildPlotScene(item.table, { ...item.plot, [key]: spec } as Plot, SIZE);
        const target = key === "y2Axis" ? s.y2 : key === "y3Axis" ? s.y3 : s.y;
        const tick = target?.ticks.find((t) => t.label === LONG || t.suppressedLabel === LONG);
        // A chart type that does not take custom ticks on this axis at all has nothing to prove here.
        if (!tick) return;
        expect(tick.label, `${kind} [${item.key}]: the custom label on ${key} was blanked - no room was made for it`).toBe(LONG);
        expect(s.warnings.filter((w) => w.includes(LONG)), `${kind} [${item.key}]: still warns there is no room`).toEqual([]);
      });
    }
  }

  it("the census reaches real value axes (it cannot pass by measuring nothing)", () => {
    expect(checked).toBeGreaterThan(20);
  });
});
