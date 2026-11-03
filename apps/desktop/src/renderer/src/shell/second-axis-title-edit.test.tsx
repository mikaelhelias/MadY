// @vitest-environment jsdom
/**
 * Every text on a graph can be edited in place — including the Y2 and Y3 axis titles.
 *
 * The Y2 / Y3 titles are draggable (second-axis-title-drag.test.tsx) and double-click editable like
 * the X and Y titles. Guards against the inline editor's target only accepting `axis: "x" | "y"`,
 * which leaves the second and third axes' titles without an editor.
 *
 * For every place such a title is drawn - down the right (Y2, Y3) and along the top of a horizontal
 * chart - this checks: double-click opens the editor seeded with the title, the SVG text hides while
 * it is open, committing raises onEditText for that axis, the erase button clears it, and the app's
 * routing (dataAxisOf) sends the edit to that axis's own spec on a flipped chart too.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { MadyDocument, dataAxisOf } from "@mady/core";
import type { DataTable, Plot, Project } from "@mady/core";
import { buildPlotScene } from "@mady/graphics";
import { PlotFigure } from "./PlotFigure";

afterEach(cleanup);
const SIZE = { width: 640, height: 420 };

const xyTable: DataTable = {
  id: "t", kind: "xy", name: "T",
  columns: [
    { id: "x", name: "Dose", role: "x" }, { id: "a", name: "Response", role: "y" },
    { id: "b", name: "Toxicity", role: "y" }, { id: "c", name: "Cost", role: "y" },
  ],
  rows: [1, 2, 3, 4, 5].map((v, i) => ({ id: `r${i}`, cells: { x: v, a: v * 2, b: 100 - v * 7, c: 1000 + v * 90 } })),
};
const barTable: DataTable = {
  id: "t", kind: "column", name: "T",
  columns: [{ id: "g", name: "Group", role: "x" }, { id: "s", name: "Sales", role: "y" }, { id: "p", name: "Profit share", role: "y" }],
  rows: [["A", 2, 30], ["B", 6, 50], ["C", 10, 40]].map(([g, s, p], i) => ({ id: `r${i}`, cells: { g: g as string, s: s as number, p: p as number } })),
};
const xyPlot = (): Plot => ({
  id: "p", name: "P", source: "t", status: "ok", styleOverrides: {}, kind: "xy",
  seriesStyles: { b: { axis: "y2" }, c: { axis: "y3" } }, y2Axis: { title: "Toxicity axis" }, y3Axis: { title: "Cost axis" },
}) as unknown as Plot;
const hbarPlot = (): Plot => ({
  id: "p", name: "P", source: "t", status: "ok", styleOverrides: {}, kind: "bar", barOrientation: "horizontal",
  seriesStyles: { p: { axis: "y2" } }, y2Axis: { title: "Share axis" },
}) as unknown as Plot;

const CASES = [
  { name: "Y2 down the right", table: xyTable, plot: xyPlot, axis: "y2" as const, title: "Toxicity axis" },
  { name: "Y3 outside Y2", table: xyTable, plot: xyPlot, axis: "y3" as const, title: "Cost axis" },
  { name: "the second axis along the top of a horizontal bar", table: barTable, plot: hbarPlot, axis: "y2" as const, title: "Share axis" },
];

const titleEl = (c: HTMLElement, text: string): SVGTextElement | undefined =>
  [...c.querySelectorAll("text")].find((t) => (t.textContent ?? "").trim() === text) as SVGTextElement | undefined;
const editorOf = (c: HTMLElement): HTMLTextAreaElement | HTMLInputElement | null =>
  c.querySelector<HTMLTextAreaElement | HTMLInputElement>(".gfx-textedit");

describe("the Y2 and Y3 axis titles edit in place", () => {
  for (const c of CASES) {
    describe(c.name, () => {
      it("double-click opens the editor seeded with the title, and the SVG text hides meanwhile", () => {
        const { container } = render(<PlotFigure scene={buildPlotScene(c.table, c.plot(), SIZE)} onEditText={vi.fn()} onMoveAxisTitle={vi.fn()} />);
        const el = titleEl(container, c.title)!;
        expect(el, "the title is not on the page - the fixture cannot exhibit the bug").toBeTruthy();
        expect(editorOf(container)).toBeFalsy();
        fireEvent.doubleClick(el);
        const ed = editorOf(container);
        expect(ed, "double-click opened no editor").toBeTruthy();
        expect(ed!.value).toBe(c.title);
        expect(titleEl(container, c.title)!.getAttribute("opacity"), "the SVG title still shows under the editor").toBe("0");
      });

      it("committing raises onEditText for that axis", () => {
        const onEditText = vi.fn();
        const { container } = render(<PlotFigure scene={buildPlotScene(c.table, c.plot(), SIZE)} onEditText={onEditText} onMoveAxisTitle={vi.fn()} />);
        fireEvent.doubleClick(titleEl(container, c.title)!);
        const ed = editorOf(container)!;
        fireEvent.change(ed, { target: { value: "Renamed axis" } });
        fireEvent.keyDown(ed, { key: "Enter", ctrlKey: true });
        expect(onEditText).toHaveBeenCalledWith({ kind: "axisTitle", axis: c.axis }, "Renamed axis");
      });

      it("the erase button clears it, like every other axis title", () => {
        const onEditText = vi.fn();
        const { container } = render(<PlotFigure scene={buildPlotScene(c.table, c.plot(), SIZE)} onEditText={onEditText} onMoveAxisTitle={vi.fn()} />);
        fireEvent.doubleClick(titleEl(container, c.title)!);
        const erase = container.querySelector<HTMLElement>("button.texterase");
        expect(erase, "no erase control beside the editor").toBeTruthy();
        fireEvent.pointerDown(erase!);
        fireEvent.click(erase!);
        expect(onEditText).toHaveBeenCalledWith({ kind: "axisTitle", axis: c.axis }, "");
      });

      it("the app routes the edit to that axis's own spec, and the drawing shows it", () => {
        const plot = c.plot();
        const doc = new MadyDocument({ schemaVersion: 4, tables: [c.table], plots: [plot], analyses: [], log: [], workspace: { folders: [], loose: [] } } as Project);
        const target = dataAxisOf(plot, c.axis);
        expect(target, "a flipped chart must not remap a second axis").toBe(c.axis);
        doc.setPlotAxis(plot.id, target, { title: "Renamed axis" });
        const saved = doc.toJSON().plots[0]!;
        expect(buildPlotScene(c.table, saved, SIZE)[c.axis]?.title).toBe("Renamed axis");
      });
    });
  }
});
