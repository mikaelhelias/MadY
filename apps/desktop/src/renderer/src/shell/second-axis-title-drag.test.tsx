// @vitest-environment jsdom
/**
 * Every text on a graph can be dragged — including the Y2 and Y3 axis titles.
 *
 * Guards the second and third value axes' titles: they must be draggable (not plain `<text>`),
 * `moveAxisTitle` must accept y2 / y3 as well as x / y / z, and the builder must read
 * `y2Axis.titleOffset` / `y3Axis.titleOffset`. `text-draggable.sweep.test.tsx` cannot cover
 * this: no gallery card carries a Y2 title.
 *
 * This drives the whole path for each place such a title is drawn — down the right of a vertical
 * chart (Y2, Y3) and along the top of a horizontal one (the second axis is drawn there):
 *   1. dragging the title on the figure raises onMoveAxisTitle with the data axis ("y2" / "y3");
 *   2. the document stores it on that axis (`setAxisTitleOffset`), undoably;
 *   3. the rebuilt drawing puts the title where it was dropped.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { MadyDocument } from "@mady/core";
import type { DataTable, Plot, Project } from "@mady/core";
import { buildPlotScene } from "@mady/graphics";
import { PlotFigure } from "./PlotFigure";

afterEach(cleanup);
const SIZE = { width: 640, height: 420 };

const xyTable: DataTable = {
  id: "t", kind: "xy", name: "T",
  columns: [
    { id: "x", name: "Dose", role: "x" },
    { id: "a", name: "Response", role: "y" },
    { id: "b", name: "Toxicity", role: "y" },
    { id: "c", name: "Cost", role: "y" },
  ],
  rows: [1, 2, 3, 4, 5].map((v, i) => ({ id: `r${i}`, cells: { x: v, a: v * 2, b: 100 - v * 7, c: 1000 + v * 90 } })),
};
const barTable: DataTable = {
  id: "t", kind: "column", name: "T",
  columns: [{ id: "g", name: "Group", role: "x" }, { id: "s", name: "Sales", role: "y" }, { id: "p", name: "Profit share", role: "y" }],
  rows: [["A", 2, 30], ["B", 6, 50], ["C", 10, 40]].map(([g, s, p], i) => ({ id: `r${i}`, cells: { g: g as string, s: s as number, p: p as number } })),
};

/** A plot with series on the second (and third) axis, each axis carrying a title of its own. */
const xyPlot = (): Plot => ({
  id: "p", name: "P", source: "t", status: "ok", styleOverrides: {}, kind: "xy",
  seriesStyles: { b: { axis: "y2" }, c: { axis: "y3" } },
  y2Axis: { title: "Toxicity axis" }, y3Axis: { title: "Cost axis" },
}) as unknown as Plot;
const hbarPlot = (): Plot => ({
  id: "p", name: "P", source: "t", status: "ok", styleOverrides: {}, kind: "bar", barOrientation: "horizontal",
  seriesStyles: { p: { axis: "y2" } }, y2Axis: { title: "Share axis" },
}) as unknown as Plot;

const titleEl = (container: HTMLElement, text: string): SVGTextElement | undefined =>
  [...container.querySelectorAll("text")].find((t) => (t.textContent ?? "").trim() === text) as SVGTextElement | undefined;

/** Where the title is actually drawn: its own x/y, then any translate on it. */
function drawnAt(el: SVGTextElement): { x: number; y: number } {
  let x = Number(el.getAttribute("x") ?? 0);
  let y = Number(el.getAttribute("y") ?? 0);
  const t = /translate\(\s*(-?[\d.]+)[ ,]+(-?[\d.]+)\s*\)/.exec(el.getAttribute("transform") ?? "");
  if (t) { x += Number(t[1]); y += Number(t[2]); }
  return { x, y };
}

const CASES = [
  { name: "Y2, down the right of a vertical chart", table: xyTable, plot: xyPlot, axis: "y2" as const, title: "Toxicity axis" },
  { name: "Y3, outside Y2 on a vertical chart", table: xyTable, plot: xyPlot, axis: "y3" as const, title: "Cost axis" },
  { name: "the second axis along the top of a horizontal bar chart", table: barTable, plot: hbarPlot, axis: "y2" as const, title: "Share axis" },
];

describe("the Y2 and Y3 axis titles drag, are remembered, and are redrawn where dropped", () => {
  for (const c of CASES) {
    describe(c.name, () => {
      it("the fixture really draws that title (so a title that ignores the drag would show)", () => {
        const scene = buildPlotScene(c.table, c.plot(), SIZE);
        expect(scene[c.axis]?.title, `no ${c.axis} axis title in the scene`).toBe(c.title);
        const { container } = render(<PlotFigure scene={scene} />);
        expect(titleEl(container, c.title), "the title is not on the page").toBeTruthy();
      });

      it("1. dragging it raises onMoveAxisTitle with the data axis", () => {
        const onMoveAxisTitle = vi.fn();
        const scene = buildPlotScene(c.table, c.plot(), SIZE);
        const { container } = render(<PlotFigure scene={scene} onMoveAxisTitle={onMoveAxisTitle} onSelect={() => {}} />);
        const el = titleEl(container, c.title)!;
        expect(el.style.cursor, "the title does not advertise that it drags").toBe("move");
        fireEvent.pointerDown(el, { clientX: 300, clientY: 200 });
        fireEvent.pointerMove(el, { clientX: 330, clientY: 215 });
        fireEvent.pointerUp(el, { clientX: 330, clientY: 215 });
        expect(onMoveAxisTitle).toHaveBeenCalledWith(c.axis, expect.any(Number), expect.any(Number));
      });

      it("2 + 3. stored on that axis, undoably, and redrawn where dropped", () => {
        const plot = c.plot();
        const project: Project = { schemaVersion: 4, tables: [c.table], plots: [plot], analyses: [], log: [], workspace: { folders: [], loose: [] } };
        const doc = new MadyDocument(project);
        const before = drawnAt(titleEl(render(<PlotFigure scene={buildPlotScene(c.table, doc.toJSON().plots[0]!, SIZE)} />).container, c.title)!);
        cleanup();

        doc.setAxisTitleOffset(plot.id, c.axis, 25, -12);
        const saved = doc.toJSON().plots[0]!;
        expect(saved[`${c.axis}Axis`]?.titleOffset).toEqual({ dx: 25, dy: -12 });
        // …and the main axes are untouched: the offset landed on the axis that was dragged.
        expect(saved.yAxis?.titleOffset).toBeUndefined();

        const moved = drawnAt(titleEl(render(<PlotFigure scene={buildPlotScene(c.table, saved, SIZE)} />).container, c.title)!);
        cleanup();
        expect({ dx: Math.round(moved.x - before.x), dy: Math.round(moved.y - before.y) }).toEqual({ dx: 25, dy: -12 });

        doc.commands.undo();
        expect(doc.toJSON().plots[0]![`${c.axis}Axis`]?.titleOffset).toBeUndefined();
      });
    });
  }

  it("an untouched second-axis title writes no offset field into the scene", () => {
    const scene = buildPlotScene(xyTable, xyPlot(), SIZE);
    expect(scene.y2 && "titleOffset" in scene.y2).toBe(false);
    expect(scene.y3 && "titleOffset" in scene.y3).toBe(false);
  });
});
