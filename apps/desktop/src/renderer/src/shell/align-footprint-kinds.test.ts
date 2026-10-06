/**
 * FOOTPRINT_ALIGN_KINDS is derived, not hand-guessed — this guard re-measures it.
 *
 * The panel assembler aligns axis-bearing panels by their shared data-axis length: under
 * Align X/Y each panel is built with an `xAxisLength`/`yAxisLength` override so their axes
 * line up. A kind that ignores those overrides renders at the raw scene size instead, so
 * building it that way under align would produce a 900×700 panel and the grid placer would
 * stack the panels on top of each other (e.g. treemap + network + dot plot + XY piled on one
 * corner). Those kinds must tile by their outer footprint — `FOOTPRINT_ALIGN_KINDS`.
 *
 * This test rebuilds every gallery kind with the align overrides and classifies it by whether
 * it shrank (cartesian) or stayed at the raw size (footprint). The set in panes.tsx must equal
 * the measured footprint set exactly — so adding a kind, or a builder change to axis-length
 * handling, fails here instead of silently breaking Align all.
 *
 * Heatmap must stay cartesian here: a matrix heatmap consumes the axis lengths to grow its
 * cell grid, which is why it keeps its own `isAxisless` expansion path.
 */
import { describe, expect, it } from "vitest";
import type { Plot } from "@mady/core";
import { buildPlotScene } from "@mady/graphics";
import { galleryItems } from "./gallery";
import { scenePaletteOpt } from "./scenePalette";
import { FOOTPRINT_ALIGN_KINDS } from "./panes";

const measure = (t: string, px: number): number => t.length * px * 0.6;
// The assembler's align constants (panes.tsx ALIGN_AX/ALIGN_AY) and its 900×700 align build.
const ALIGN_AX = 300, ALIGN_AY = 200, ALIGN_W = 900, ALIGN_H = 700;

/** True when the built scene stayed near the raw align size on either axis, i.e. the kind
 *  ignored an axis-length override — so the data-axis align mechanism can't size it there and
 *  it must tile by its outer footprint. (Both-axis kinds blow up to 900×700; paireddot ignores
 *  only width, stretching to ~800 to fit its row labels — still a footprint case.) */
function ignoresAxisLengths(item: ReturnType<typeof galleryItems>[number]): boolean {
  const plot = { ...item.plot, xAxisLength: ALIGN_AX, yAxisLength: ALIGN_AY } as Plot;
  const scene = buildPlotScene(item.table, plot, { measure, width: ALIGN_W, height: ALIGN_H, ...scenePaletteOpt(item.plot) });
  return scene.width > 800 || scene.height > 620; // near-raw on either axis ⇒ that length ignored
}

describe("FOOTPRINT_ALIGN_KINDS matches the measured non-cartesian set", () => {
  const items = galleryItems();

  it("covers the whole gallery (the measurement can't pass vacuously)", () => {
    expect(items.length).toBeGreaterThan(30);
    expect(FOOTPRINT_ALIGN_KINDS.size).toBeGreaterThan(0);
  });

  it("the declared set equals the kinds that ignore the align axis-lengths", () => {
    const measured = new Set<string>();
    for (const item of items) if (ignoresAxisLengths(item)) measured.add(item.plot.kind ?? "xy");
    expect([...measured].sort(), "panes.tsx FOOTPRINT_ALIGN_KINDS has drifted from the measurement").toEqual([...FOOTPRINT_ALIGN_KINDS].sort());
  });

  it("heatmap is not footprint — it consumes the axis lengths for its cell grid", () => {
    const hm = items.find((i) => (i.plot.kind ?? "xy") === "heatmap")!;
    expect(ignoresAxisLengths(hm), "a matrix heatmap must shrink under the axis-length overrides").toBe(false);
    expect(FOOTPRINT_ALIGN_KINDS.has("heatmap")).toBe(false);
  });
});
