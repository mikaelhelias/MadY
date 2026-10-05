// @vitest-environment node
import { describe, expect, it } from "vitest";
import { buildPlotScene } from "@mady/graphics";
import type { Plot } from "@mady/core";
import { galleryItems } from "./gallery";

/**
 * "Minor gridlines" must reach the drawing on every kind that has a grid.
 *
 * The Grid section offers show / colour / width / dash / minor for every kind, and each scene
 * builder assembles its own `grid` object. Guards against a builder hard-coding `minor: false`
 * instead of reading `plot.grid.minor` (the tickbox would write a value the builder discards).
 *
 * The figure draws a minor gridline per minor tick, and minor ticks only exist once the axis
 * carries a `minorCount` — so the fixture sets one. Without it the figure has no minor gridline
 * to draw, and this guard would pass even when a builder drops the setting.
 *
 * Kinds that draw no grid at all (pie, treemap, heatmap, corrmatrix, alluvial, network, radar,
 * parallel, scatter3d — they force `grid.show` false) are excluded by asking the builder itself,
 * not by a hand-list that can go stale.
 */
const SIZE = { width: 620, height: 420 };

const asked = (plot: Plot, minor: boolean): Plot => ({
  ...plot,
  grid: { ...(plot.grid ?? {}), show: true, minor },
  xAxis: { ...(plot.xAxis ?? {}), minorCount: 4 },
  yAxis: { ...(plot.yAxis ?? {}), minorCount: 4 },
}) as Plot;

describe("grid.minor reaches the drawing", () => {
  const items = galleryItems().filter(
    (i) => buildPlotScene(i.table, asked(i.plot, true), SIZE).grid.show,
  );

  it("covers most gallery kinds (the filter keeps the kinds that draw a grid)", () => {
    expect(items.length, "no gallery kind draws a grid — the filter is broken").toBeGreaterThan(20);
  });

  for (const item of items) {
    const kind = item.plot.kind ?? "xy";
    it(`${kind}: the builder keeps the value the tickbox wrote`, () => {
      expect(
        buildPlotScene(item.table, asked(item.plot, true), SIZE).grid.minor,
        `${kind}: this builder hard-codes grid.minor and drops what the user asked for`,
      ).toBe(true);
    });

    it(`${kind}: minor ticks exist, so switching it on adds gridlines`, () => {
      const scene = buildPlotScene(item.table, asked(item.plot, true), SIZE);
      const minorTicks = [...scene.x.ticks, ...scene.y.ticks].filter((t) => t.minor).length;
      // Not every kind subdivides both axes (a category axis has no minors), but a kind with a
      // grid and no minor tick anywhere would make the assertion above unfalsifiable.
      expect(minorTicks, `${kind}: minorCount produced no minor tick — this fixture cannot show a dropped setting`).toBeGreaterThan(0);
    });
  }
});
