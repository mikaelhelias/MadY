// @vitest-environment jsdom
/**
 * A category name with a line break ("Vanilla\ncross validation") draws as a block: every line starts at the label's
 * own place, level or turned. Without that, each line began where the one above ended and the name came out as a
 * staircase.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import type { DataTable, Plot } from "@mady/core";
import { buildPlotScene } from "@mady/graphics";
import { PlotFigure } from "./PlotFigure";

afterEach(cleanup);

const table: DataTable = {
  id: "t", kind: "column", name: "T",
  columns: [{ id: "a", name: "Vanilla\ncross validation", role: "y" }, { id: "b", name: "Split by\ncell line", role: "y" }],
  rows: [{ id: "r1", cells: { a: 1, b: 2 } }, { id: "r2", cells: { a: 2, b: 3 } }],
};
const plotOf = (tickRotation: number): Plot => ({ id: "p", name: "P", source: "t", status: "ok", styleOverrides: {}, kind: "bar", xAxis: { tickRotation } }) as Plot;

for (const rot of [0, 45]) {
  describe(`two-line category names, labels turned ${rot}°`, () => {
    it("the fixture reaches the drawing with its line break", () => {
      const scene = buildPlotScene(table, plotOf(rot), { width: 500, height: 360 });
      expect(scene.x.ticks.some((t) => t.label.includes("\n"))).toBe(true);
    });

    it("each line of a name starts at the label's own x", () => {
      const scene = buildPlotScene(table, plotOf(rot), { width: 500, height: 360 });
      const { container } = render(<PlotFigure scene={scene} />);
      // The axis names: below the plot area (the legend shows the same names, to the right).
      const below = scene.plot.y + scene.plot.height;
      const names = [...container.querySelectorAll("text")].filter((t) =>
        t.querySelectorAll(":scope > tspan").length === 2 && /Vanilla|Split by/.test(t.textContent ?? "") && Number(t.getAttribute("y")) > below &&
        Number(t.getAttribute("x")) < scene.plot.x + scene.plot.width);
      expect(names.length).toBe(2);
      for (const text of names) {
        const x = text.getAttribute("x");
        for (const line of text.querySelectorAll(":scope > tspan")) expect(line.getAttribute("x"), text.textContent ?? "").toBe(x);
      }
    });
  });
}
