// @vitest-environment jsdom
/**
 * Box selection (Shift-drag). Shift-drag a rectangle over an XY / bubble / volcano
 * chart; the points inside are picked and a menu offers Exclude, Highlight by name and Copy to a new sheet.
 *
 * jsdom has no screen geometry, so the figure is given an identity screen mapping (client px = figure px) — the drag
 * then runs through PlotFigure's real pointer handlers. Checked both ways: a Shift-drag picks exactly the points inside
 * and does not pan; a plain drag still pans and opens no menu.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import type { DataTable, Plot } from "@mady/core";
import { buildPlotScene } from "@mady/graphics";
import { PlotFigure } from "./PlotFigure";
import { cellsOfPoints, highlightNamesFor, pointsInBox, rowsOfPoints } from "./boxSelect";

afterEach(cleanup);

beforeAll(() => {
  // Identity client → figure mapping (see the header).
  const g = globalThis as unknown as { DOMPoint?: unknown };
  if (!g.DOMPoint) {
    g.DOMPoint = class {
      constructor(public x = 0, public y = 0) {}
      matrixTransform(): { x: number; y: number } {
        return { x: this.x, y: this.y };
      }
    };
  }
  (SVGElement.prototype as unknown as { getScreenCTM: () => unknown }).getScreenCTM = () => ({ inverse: () => ({}) });
});

const SIZE = { width: 580, height: 380 };
/** Eight named samples, X 1..8; Y a replicate pair (two subcolumns). */
const table = {
  id: "t1", kind: "xy", name: "Samples",
  columns: [
    { id: "x", name: "Dose", role: "x" }, { id: "y", name: "Response", role: "y" }, { id: "y2", name: "Response 2", role: "y", group: "y" },
    { id: "g", name: "Gene", type: "text" },
  ],
  rows: ["TP53", "EGFR", "MYC", "KRAS", "BRCA1", "PTEN", "AKT1", "CDK4"].map((g, i) => ({ id: `r${i}`, cells: { x: i + 1, y: i + 2, y2: i + 2.4, g } })),
} as unknown as DataTable;
const plot = { id: "p1", name: "Samples", source: "t1", status: "ok", styleOverrides: {}, kind: "xy" } as unknown as Plot;
const scene = buildPlotScene(table, plot, SIZE);
const marks = scene.series.find((s) => s.id === "y")!.marks;
/** A box around the marks of rows r2..r4 (figure px). */
const around = (ids: string[]) => {
  const ms = marks.filter((m) => ids.includes(m.rowId));
  return { a: { x: Math.min(...ms.map((m) => m.cx)) - 3, y: Math.min(...ms.map((m) => m.cy)) - 3 }, b: { x: Math.max(...ms.map((m) => m.cx)) + 3, y: Math.max(...ms.map((m) => m.cy)) + 3 } };
};

describe("box selection — which points, and what each action touches", () => {
  it("pointsInBox picks exactly the marks inside, in any drag direction", () => {
    const { a, b } = around(["r2", "r3", "r4"]);
    expect(pointsInBox(scene, a, b).map((p) => p.rowId).sort()).toEqual(["r2", "r3", "r4"]);
    expect(pointsInBox(scene, b, a).map((p) => p.rowId).sort()).toEqual(["r2", "r3", "r4"]);
    expect(pointsInBox(scene, { x: 0, y: 0 }, { x: 1, y: 1 })).toEqual([]);
  });

  it("Exclude takes every replicate of the picked rows", () => {
    expect(cellsOfPoints(table, [{ columnId: "y", rowId: "r3" }])).toEqual([{ rowId: "r3", colId: "y" }, { rowId: "r3", colId: "y2" }]);
  });

  it("Highlight reads the names from the column of names; a sheet without one says so (null)", () => {
    expect(highlightNamesFor(table, plot, [{ columnId: "y", rowId: "r2" }, { columnId: "y", rowId: "r4" }])).toEqual(new Map([["y", ["MYC", "BRCA1"]]]));
    const bare = { ...table, columns: table.columns.slice(0, 3) } as DataTable;
    expect(highlightNamesFor(bare, plot, [{ columnId: "y", rowId: "r2" }])).toBeNull();
  });

  it("Copy takes the picked rows, every column, in sheet order", () => {
    const r = rowsOfPoints(table, [{ columnId: "y", rowId: "r4" }, { columnId: "y", rowId: "r2" }]);
    expect(r.columnNames).toEqual(["Dose", "Response", "Response 2", "Gene"]);
    expect(r.rows).toEqual([[3, 4, 4.4, "MYC"], [5, 6, 6.4, "BRCA1"]]);
  });
});

describe("box selection — the gesture on the figure", () => {
  function drag(shift: boolean, from: { x: number; y: number }, to: { x: number; y: number }) {
    const onBoxAction = vi.fn();
    const onViewChange = vi.fn();
    const { container } = render(<PlotFigure scene={scene} onBoxAction={onBoxAction} onViewChange={onViewChange} />);
    const svg = container.querySelector("svg.gfx-figure")!;
    fireEvent.pointerDown(svg, { button: 0, shiftKey: shift, clientX: from.x, clientY: from.y, pointerId: 1 });
    fireEvent.pointerMove(svg, { button: 0, shiftKey: shift, clientX: (from.x + to.x) / 2, clientY: (from.y + to.y) / 2, pointerId: 1 });
    fireEvent.pointerMove(svg, { button: 0, shiftKey: shift, clientX: to.x, clientY: to.y, pointerId: 1 });
    fireEvent.pointerUp(svg, { button: 0, shiftKey: shift, clientX: to.x, clientY: to.y, pointerId: 1 });
    return { container, onBoxAction, onViewChange };
  }

  it("Shift-drag: rings the picked points, opens the menu, does not pan; Exclude hands over exactly those points", () => {
    const { a, b } = around(["r2", "r3", "r4"]);
    const { container, onBoxAction, onViewChange } = drag(true, a, b);
    expect(onViewChange, "a Shift-drag must not pan the chart").not.toHaveBeenCalled();
    expect(container.querySelectorAll(".gfx-boxpick")).toHaveLength(3);
    const menu = container.querySelector('[aria-label="Selected points"]')!;
    expect(menu.textContent).toContain("3 points selected");
    fireEvent.click([...menu.querySelectorAll("button")].find((x) => x.textContent === "Exclude from analyses")!);
    expect(onBoxAction).toHaveBeenCalledTimes(1);
    const [action, points] = onBoxAction.mock.calls[0]!;
    expect(action).toBe("exclude");
    expect((points as { rowId: string }[]).map((p) => p.rowId).sort()).toEqual(["r2", "r3", "r4"]);
    expect(container.querySelector('[aria-label="Selected points"]'), "the menu closes after the action").toBeNull();
  });

  it("an empty box says so, and offers nothing to do", () => {
    const { container } = drag(true, { x: 1, y: 1 }, { x: 12, y: 12 });
    const menu = container.querySelector('[aria-label="Selected points"]')!;
    expect(menu.textContent).toContain("No data points in the box.");
    expect([...menu.querySelectorAll("button")].map((x) => x.textContent)).toEqual(["Close"]);
  });

  it("a plain drag (no Shift) still pans and opens no menu", () => {
    const { a, b } = around(["r2", "r3", "r4"]);
    const { container, onViewChange } = drag(false, a, b);
    expect(onViewChange).toHaveBeenCalled();
    expect(container.querySelector('[aria-label="Selected points"]')).toBeNull();
  });

  it("Highlight by name is off, with its reason, when the sheet has no column of names", () => {
    const { a, b } = around(["r2"]);
    const onBoxAction = vi.fn();
    const { container } = render(<PlotFigure scene={scene} onBoxAction={onBoxAction} boxHighlightBlocked="This sheet has no column of names to highlight by" />);
    const svg = container.querySelector("svg.gfx-figure")!;
    fireEvent.pointerDown(svg, { button: 0, shiftKey: true, clientX: a.x, clientY: a.y, pointerId: 1 });
    fireEvent.pointerMove(svg, { button: 0, shiftKey: true, clientX: b.x, clientY: b.y, pointerId: 1 });
    fireEvent.pointerUp(svg, { button: 0, shiftKey: true, clientX: b.x, clientY: b.y, pointerId: 1 });
    const btn = [...container.querySelectorAll('[aria-label="Selected points"] button')].find((x) => x.textContent?.trim() === "Highlight by name") as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(btn.title).toBe("This sheet has no column of names to highlight by");
  });
});
