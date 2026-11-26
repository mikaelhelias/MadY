// A heading over the series legend ("Treatment" over Drug A / Drug B / Drug C): the plot's own setting, reserved
// for in the margin, drawn only where a heading has a place to sit.
import { describe, expect, it } from "vitest";
import type { DataTable, Plot } from "@mady/core";
import { buildPlotScene } from "./buildScene";
import { legendBoxWidth } from "./legendBox";

const table: DataTable = {
  id: "t", kind: "xy", name: "T",
  columns: [{ id: "x", name: "X" }, { id: "a", name: "Compound A" }, { id: "b", name: "Compound B" }],
  rows: [1, 2, 3, 4].map((i) => ({ id: `r${i}`, cells: { x: i, a: i * 2, b: i * 3 } })),
};
const plotOf = (legend?: NonNullable<Plot["legend"]>): Plot => ({ id: "p", name: "P", source: "t", status: "ok", styleOverrides: {}, kind: "xy", ...(legend ? { legend } : {}) });
const sceneOf = (legend?: NonNullable<Plot["legend"]>) => buildPlotScene(table, plotOf(legend), { width: 800, height: 500 });

describe("legend heading", () => {
  it("has none by default, and none for a blank heading", () => {
    expect(sceneOf().legendLayout.title).toBeUndefined();
    expect(sceneOf({ title: "   " }).legendLayout.title).toBeUndefined();
  });

  it("is carried on the layout when the plot sets one", () => {
    expect(sceneOf({ title: "Treatment" }).legendLayout.title).toBe("Treatment");
  });

  it("a heading wider than the longest row widens the room reserved at the right", () => {
    const plain = sceneOf();
    const long = sceneOf({ title: "A very long legend heading indeed" });
    expect(long.plot.width).toBeLessThan(plain.plot.width);
    // …and a short one costs nothing: it fits over the rows
    expect(sceneOf({ title: "Dose" }).plot.width).toBe(plain.plot.width);
  });

  it("is drawn above a legend inside the plot as well", () => {
    expect(sceneOf({ position: "topright", title: "Treatment" }).legendLayout.title).toBe("Treatment");
  });

  it("is not drawn on a row above the plot or on direct labels, and the figure says so", () => {
    for (const position of ["top", "direct"] as const) {
      const s = sceneOf({ position, title: "Treatment" });
      expect(s.legendLayout.title, position).toBeUndefined();
      expect(s.warnings.join("\n"), position).toMatch(/legend heading is not drawn/i);
    }
  });

  it("no warning when no heading was asked for", () => {
    expect(sceneOf({ position: "top" }).warnings.join("\n")).not.toMatch(/legend heading/i);
  });
});

describe("legendBoxWidth", () => {
  const layout = { swatchWidth: 18, padding: 6 };
  it("grows to hold a heading wider than the rows, and ignores a short one", () => {
    const base = legendBoxWidth(layout, ["Compound A", "Compound B"], 13);
    expect(legendBoxWidth({ ...layout, title: "A much longer heading than the rows" }, ["Compound A", "Compound B"], 13)).toBeGreaterThan(base);
    expect(legendBoxWidth({ ...layout, title: "Dose" }, ["Compound A", "Compound B"], 13)).toBe(base);
  });
});
