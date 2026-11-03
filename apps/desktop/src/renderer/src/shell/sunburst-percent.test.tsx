// @vitest-environment jsdom
/**
 * A sunburst segment's share of the whole, printed beside its name, rounds an exact half up like the pie's labels do.
 * 31.5 of a total that adds up to a hair over 100 prints "32%", though the fraction is 0.31499999999999995.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import type { DataTable, Plot } from "@mady/core";
import { buildPlotScene } from "@mady/graphics";
import { PlotFigure } from "./PlotFigure";

afterEach(cleanup);

const shares = [31.5, 14.2, 13.1, 8.4, 7.9, 4.4, 12.0, 8.5];
const table = {
  id: "t", kind: "multivariable", name: "t",
  columns: [{ id: "g", name: "Item", role: "x" }, { id: "v", name: "Share", role: "y" }],
  rows: shares.map((v, i) => ({ id: `r${i}`, cells: { g: `Item ${i + 1}`, v } })),
} as unknown as DataTable;
const plot = {
  id: "p", name: "p", source: "t", status: "ok", styleOverrides: {}, kind: "sunburst",
  sunburst: { levelColumns: ["g"], valueColumn: "v", showValues: true, showLabels: true },
} as unknown as Plot;

describe("sunburst percent labels", () => {
  it("31.5 reads 32 %, not 31 %", () => {
    const scene = buildPlotScene(table, plot, { width: 640, height: 640 });
    const first = scene.sunburst!.segments.find((s) => s.label === "Item 1")!;
    expect(first.frac * 100, "no binary dust — the fixture proves nothing").toBeLessThan(31.5);
    const { container } = render(<PlotFigure scene={scene} />);
    const texts = [...container.querySelectorAll("svg.gfx-figure text")].map((t) => t.textContent ?? "");
    expect(texts).toContain("Item 1 32%");
    expect(texts.join("|")).not.toContain("Item 1 31%");
  });
});
