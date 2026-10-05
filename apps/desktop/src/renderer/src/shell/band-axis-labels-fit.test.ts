// Category names down the left axis are drawn, fit on the canvas, and the side title clears them.
//
// Guards horizontal box / violin / column scatter charts against a missing group name and an axis
// title printed over the names.
//
// Two failure modes, one layout:
//   • the horizontal box / violin / column-scatter builder must size its left margin for the category
//     names with the font they are drawn in and reserve room for the side title, or the longest name
//     runs off the canvas and the title is clamped onto the names;
//   • the choke point's "blank a label that escapes the canvas" rule must not apply to the band
//     (category) Y axis ("a category name that will not fit is a layout bug to fix, not a label to
//     delete"), or it deletes the name instead of exposing the margin.
//
// Swept over every gallery card, plus the flipped (horizontal) forms of the kinds that have one, so a
// category axis anywhere in the program is held to it.
import { describe, expect, it } from "vitest";
import type { DataTable, Plot } from "@mady/core";
import { buildPlotScene } from "@mady/graphics";
import { galleryItems } from "./gallery";

const SIZE = { width: 580, height: 380 };
/** A deterministic width estimate — the same one every build here uses, so the check and the layout agree. */
const measure = (text: string, px: number): number => text.length * px * 0.58;
const FLIPPABLE = new Set(["bar", "box", "violin", "scatter", "floatingbar"]);

const cases = galleryItems().flatMap((g) => {
  const plot = g.plot as Plot;
  const kind = plot.kind ?? "xy";
  const base = [{ name: `${kind} · ${g.title}`, table: g.table as DataTable, plot }];
  return FLIPPABLE.has(kind) && (plot.barOrientation ?? "vertical") !== "horizontal"
    ? [...base, { name: `${kind} · ${g.title} · flipped horizontal`, table: g.table as DataTable, plot: { ...plot, barOrientation: "horizontal" } as Plot }]
    : base;
});

describe("category names down the left axis", () => {
  it.each(cases)("$name: every category name is drawn, on the canvas, and the side title clears them", ({ table, plot }) => {
    const s = buildPlotScene(table, plot, { ...SIZE, measure });
    if (!s.y?.band || s.y.hidden) return; // no category axis down the left on this chart
    const kind = plot.kind ?? "xy";
    const font = s.fonts.yTick.size;
    const gap = s.axisGaps?.yTick ?? 8;
    const labelled = s.y.ticks.filter((t) => !t.minor && t.label !== "");
    // 1 · On the horizontal distribution charts nothing thins the names: every one must be drawn.
    if (["box", "violin", "scatter", "floatingbar"].includes(kind) && plot.barOrientation === "horizontal") {
      const deleted = s.y.ticks.filter((t) => t.label === "" && (t as { suppressedLabel?: string }).suppressedLabel);
      expect(deleted.map((t) => (t as { suppressedLabel?: string }).suppressedLabel), "a category name was deleted").toEqual([]);
    }
    // 2 · Every name that is drawn fits on the canvas (right-anchored just left of the plot).
    for (const t of labelled) {
      const left = s.plot.x - gap - measure(t.label, font);
      expect(left, `"${t.label}" starts ${left.toFixed(1)} px — off the left edge of the canvas`).toBeGreaterThanOrEqual(-0.5);
    }
    // 3 · The side title (rotated, anchored at titlePos) stays clear of the widest drawn name.
    if (s.y.title && s.y.titlePos != null && labelled.length) {
      const widest = Math.max(...labelled.map((t) => measure(t.label, font)));
      const namesLeft = s.plot.x - gap - widest;
      const titleSize = s.y.titleFont ?? s.fonts.yAxisTitle.size;
      // The −90° title's glyphs extend right of its anchor by about their descent (~0.25 em).
      expect(s.y.titlePos + titleSize * 0.25, `the side title "${s.y.title}" runs into the category names`).toBeLessThanOrEqual(namesLeft + 0.5);
    }
  });
});
