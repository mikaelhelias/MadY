// @vitest-environment jsdom
/**
 * The halo the builder asks for is drawn.
 *
 * A number wider than its circle (correlation matrix) or bubble (bubble heatmap) carries
 * `labelHalo`; the figure must draw it as a page-coloured stroke under the glyphs, or the number
 * stays unreadable where it crosses from the glyph onto the page. A number that fits has none.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import type { DataTable, Plot } from "@mady/core";
import { buildPlotScene } from "@mady/graphics";
import { PlotFigure } from "./PlotFigure";

afterEach(cleanup);

const haloed = (scene: ReturnType<typeof buildPlotScene>, label: string): boolean[] =>
  [...render(<PlotFigure scene={scene} selected={null} />).container.querySelectorAll("text")]
    .filter((t) => t.textContent === label)
    .map((t) => t.getAttribute("stroke") === "var(--bg)" && t.getAttribute("paint-order") === "stroke");

describe("overhanging numbers are drawn with their halo", () => {
  const table = {
    id: "t", kind: "multivariable", name: "H",
    columns: [{ id: "n", name: "Athlete", role: "x" }, { id: "s", name: "Sprint", role: "y" }, { id: "e", name: "Endurance", role: "y" }],
    rows: [["Ana", 82, 64], ["Ben", 58, 88], ["Dev", 66, 59]].map(([n, s, e], i) => ({ id: `r${i}`, cells: { n, s, e } })),
  } as unknown as DataTable;
  const plot = { id: "p", name: "H", source: "t", kind: "heatmap", heatmap: { cellShape: "bubble", showValues: true } } as unknown as Plot;

  it("bubble heatmap: the small bubble's number has the halo, the big bubble's does not", () => {
    const scene = buildPlotScene(table, plot, { width: 520, height: 420 });
    const cells = scene.heatmap!.cells;
    const small = cells.find((c) => c.labelHalo)!;
    const big = cells.find((c) => c.label && !c.labelHalo)!;
    expect(small, "the fixture has no overhanging number").toBeTruthy();
    expect(haloed(scene, small.label)).toContain(true);
    expect(haloed(scene, big.label).every((h) => !h)).toBe(true);
  });

  it("correlation matrix: a number wider than its circle has the halo", () => {
    const a = Array.from({ length: 12 }, (_, i) => i);
    const c = [3, -1, 4, 1, -5, 9, -2, 6, -5, 3, -5, 8];
    const t = {
      id: "t", kind: "multivariable", name: "M",
      columns: [{ id: "a", name: "A", role: "y" }, { id: "c", name: "C", role: "y" }],
      rows: a.map((v, i) => ({ id: `r${i}`, cells: { a: v, c: c[i] } })),
    } as unknown as DataTable;
    const p = { id: "p", name: "C", source: "t", kind: "corrmatrix", corrmatrix: { glyph: "circle", showValues: true, triangle: "full" } } as unknown as Plot;
    const scene = buildPlotScene(t, p, { width: 420, height: 420 });
    const weak = scene.corrmatrix!.cells.find((x) => x.labelHalo)!;
    expect(weak, "the fixture has no overhanging number").toBeTruthy();
    expect(haloed(scene, weak.label)).toContain(true);
  });
});
