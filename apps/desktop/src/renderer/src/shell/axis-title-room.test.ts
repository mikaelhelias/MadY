// @vitest-environment node
import { describe, expect, it } from "vitest";
import { buildPlotScene } from "@mady/graphics";
import type { Plot } from "@mady/core";
import { galleryItems } from "./gallery";

/**
 * A Y-axis title the user typed must be given room.
 *
 * The title is placed by `titleAnchorOf`, which walks left past the widest tick number and then
 * leaves `titleGap`. It ends with `Math.max(x, …)` so the title can never leave the canvas, and
 * the builder's `marginLeft` is what keeps that clamp from binding — the comment at the clamp
 * says the room must come from the builder's margin, not from the clamp.
 *
 * On the XY / area / bubble / volcano builder, a margin term gated on
 * `datasets.length === 1 ? datasets[0].name : ""` would ignore an explicit `yAxis.title`
 * entirely: with two or more series the title would be drawn with no room reserved, the clamp
 * would bind, and it would land on top of the tick numbers.
 *
 * The check is the collision itself, not the margin: the rotated title's glyph band must sit
 * clear of the leftmost tick label. `buildPlotScene`'s default text measurement is used on both
 * sides, so the two agree by construction.
 */
const SIZE = { width: 620, height: 420 };
const TEXT_ASCENT = 1.08;
const TEXT_DESCENT = 0.27;
const measure = (t: string, size: number): number => t.length * size * 0.6;
const TITLE = "A Y AXIS TITLE";

describe("an explicit Y-axis title clears the tick labels", () => {
  const items = galleryItems().filter((i) => {
    const s = buildPlotScene(i.table, { ...i.plot, yAxis: { ...(i.plot.yAxis ?? {}), title: TITLE } } as Plot, SIZE);
    return s.y.title === TITLE && s.y.titlePos != null;
  });

  it("covers a real spread of kinds (guards the guard)", () => {
    expect(items.length, "no gallery kind places a Y-axis title — the filter is broken").toBeGreaterThan(10);
  });

  for (const item of items) {
    const kind = item.plot.kind ?? "xy";
    it(`${kind}: the title's glyphs do not run into the tick numbers`, () => {
      const scene = buildPlotScene(item.table, { ...item.plot, yAxis: { ...(item.plot.yAxis ?? {}), title: TITLE } } as Plot, SIZE);
      const size = scene.fonts.yAxisTitle.size;
      const labels = scene.y.ticks.filter((t) => !t.minor && t.label !== "");
      const widest = labels.length ? Math.max(...labels.map((t) => measure(t.label, scene.fonts.yTick.size))) : 0;
      const labelsLeft = scene.plot.x - (scene.axisGaps?.yTick ?? 8) - widest;
      // A −90° title's glyphs sit to the left of its anchor by the ascent (mirrors the renderer).
      const titleRight = scene.y.titlePos! + size * TEXT_DESCENT;
      expect(
        titleRight,
        `${kind}: the Y title sits at ${scene.y.titlePos} and the tick numbers start at ${labelsLeft} — no margin was reserved for it`,
      ).toBeLessThanOrEqual(labelsLeft + 0.5);
      expect(scene.y.titlePos!, `${kind}: the Y title was pushed off the left edge`).toBeGreaterThanOrEqual(size * TEXT_ASCENT - 0.5);
    });
  }
});
