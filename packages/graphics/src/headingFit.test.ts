import { describe, expect, it } from "vitest";
import type { DataTable, Plot, PlotKind } from "@mady/core";
import { fitHeadingSize } from "./headingFit.js";
import { buildPlotScene } from "./buildScene.js";

const measure = (t: string, px: number): number => t.length * px * 0.6;

describe("fitHeadingSize — a title or subtitle that would run past the figure is drawn smaller", () => {
  it("keeps the size when the text fits", () => {
    expect(fitHeadingSize("Short title", 20, measure, 400, 12)).toBe(20);
  });

  it("shrinks to the largest whole size that fits, counting measure's under-reading", () => {
    const text = "A title far longer than the room it is given";
    const size = fitHeadingSize(text, 26, measure, 300, 8);
    expect(size).toBeLessThan(26);
    expect(measure(text, size) * 1.1).toBeLessThanOrEqual(300);
    expect(measure(text, size + 1) * 1.1, "one pixel larger would not fit").toBeGreaterThan(300);
  });

  it("the longest line of a multi-line title decides", () => {
    const text = "Short\nA considerably longer second line of the title";
    const size = fitHeadingSize(text, 24, measure, 280, 8);
    expect(measure("A considerably longer second line of the title", size) * 1.1).toBeLessThanOrEqual(280);
  });

  it("never goes below the floor, and never grows a title", () => {
    expect(fitHeadingSize("A very long title indeed, much too long for forty pixels", 24, measure, 40, 12)).toBe(12);
    expect(fitHeadingSize("A very long title indeed", 10, measure, 40, 12)).toBe(10);
    expect(fitHeadingSize("x", 18, measure, 1000, 12)).toBe(18);
  });

  it("an empty title or no room at all changes nothing", () => {
    expect(fitHeadingSize("", 20, measure, 300, 12)).toBe(20);
    expect(fitHeadingSize("Anything", 20, measure, 0, 12)).toBe(20);
  });
});

// The same rule on every chart kind, for both alignments: the title the figure draws stays inside the figure.
describe("the graph title stays inside the figure, on every kind", () => {
  const xy: DataTable = {
    id: "t", kind: "column", name: "t",
    columns: [{ id: "s", name: "Participant", role: "x" }, { id: "a", name: "A", role: "y" }, { id: "b", name: "B", role: "y" }],
    rows: Array.from({ length: 10 }, (_, i) => ({ id: `r${i}`, cells: { s: `P${i + 1}`, a: 10 + i, b: 14 + i } })),
  };
  const LONG = "Systolic pressure per participant, before and after";
  const kinds: PlotKind[] = ["xy", "bar", "beforeafter", "box", "pie", "heatmap", "treemap", "lollipop"];
  // Sizes of 28 and 20 px are asked for, so the long text must shrink — to a size above the floor, so it can fit.
  const at = (kind: PlotKind, titleAlign: "left" | "center" | "right", width: number) => {
    const p = { id: "p", name: LONG, source: "t", status: "ok", styleOverrides: {}, kind, titleAlign, figureWidth: width, figureHeight: 420, subtitle: "A subtitle that is rather long here", fonts: { title: { size: 28 }, subtitle: { size: 20 } } } as Plot;
    return buildPlotScene(xy, p, { width, height: 420, measure });
  };
  const room = (s: ReturnType<typeof at>, align: "left" | "center" | "right"): number =>
    align === "left" ? s.width - s.plot.x : align === "right" ? s.plot.x + s.plot.width : s.width;

  for (const kind of kinds) for (const align of ["left", "center", "right"] as const) {
    it(`${kind}, ${align}-aligned: title and subtitle fit the room they are anchored in`, () => {
      const s = at(kind, align, 560);
      expect(s.title, "the fixture must draw a title").toBeTruthy();
      expect(measure(s.title!, s.fonts.title.size) * 1.1, `${kind} title ${s.fonts.title.size}px`).toBeLessThanOrEqual(room(s, align));
      expect(measure(s.subtitle!, s.fonts.subtitle.size) * 1.1, `${kind} subtitle ${s.fonts.subtitle.size}px`).toBeLessThanOrEqual(room(s, align));
    });
  }

  it("a title that already fits keeps the size it was given", () => {
    const p: Plot = { id: "p", name: "Short", source: "t", status: "ok", styleOverrides: {}, kind: "xy", figureWidth: 600, figureHeight: 420 };
    const s = buildPlotScene(xy, p, { width: 600, height: 420, measure });
    const big = buildPlotScene(xy, { ...p, name: "Short", fonts: { title: { size: 30 } } } as Plot, { width: 600, height: 420, measure });
    expect(big.fonts.title.size).toBe(30);
    expect(s.fonts.title.size).toBeGreaterThan(0);
  });
});
