import { describe, expect, it } from "vitest";
import type { DataTable, Plot } from "@mady/core";
import { buildPlotScene } from "./buildScene";

/**
 * The correlation matrix's row names clear the figure's left edge.
 *
 * Guards against names touching the edge on the gallery card at any width. Reserving only the widest
 * measured name + 10, with the figure drawing names ending 6px left of the grid, leaves 4px of slack,
 * which a measured width a few pixels short of the rendered one (a font the measurer does not know)
 * uses up entirely.
 */
const RENDER_GAP = 6; // PlotFigure draws a row name ending at grid.x − 6
const EDGE = 8;
const measure = (text: string, px: number): number => text.length * px * 0.58;
const names = ["Study hrs", "Test score", "Absences", "Sleep hrs", "Stress"];
const table: DataTable = {
  id: "t", kind: "multivariable", name: "T",
  columns: names.map((n, i) => ({ id: `c${i}`, name: n, role: "y" as const })),
  rows: Array.from({ length: 12 }, (_, r) => ({ id: `r${r}`, cells: Object.fromEntries(names.map((_n, i) => [`c${i}`, Math.sin(r * (i + 1)) * 10 + r])) })),
};
const plot = (patch: Partial<Plot> = {}): Plot => ({ id: "p", name: "P", source: "t", status: "ok", styleOverrides: {}, kind: "corrmatrix", ...patch }) as Plot;

describe("correlation matrix: the widest row name leaves room at the figure's left edge", () => {
  for (const [w, h] of [[660, 608], [928, 608], [420, 420]] as const) {
    for (const size of [12, 20]) {
      it(`${w}×${h}, names ${size}px`, () => {
        const s = buildPlotScene(table, plot({ corrmatrix: { labelFont: { size } } } as Partial<Plot>), { width: w, height: h, measure });
        const grid = s.corrmatrix!.grid;
        const widest = Math.max(...names.map((n) => measure(n, size)));
        const left = grid.x - RENDER_GAP - widest;
        expect(left, `the widest row name starts ${left.toFixed(1)}px from the left edge`).toBeGreaterThanOrEqual(EDGE);
      });
    }
  }
});
