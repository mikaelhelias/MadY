// @vitest-environment jsdom
/**
 * One box / violin dot on its own: the figure draws it with its own look (a hollow dot: page-colour interior, its
 * colour as the outline); a click on it selects that dot's row; the series panel offers the "Data points" rows while
 * the group draws dots; and with one dot selected (whole series unticked) an edit goes to that dot alone.
 */
import type { ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import type { DataTable, Plot } from "@mady/core";
import { buildPlotScene } from "@mady/graphics";
import { Inspector } from "./Inspector";
import { PlotFigure } from "./PlotFigure";

afterEach(cleanup);
Element.prototype.scrollIntoView = Element.prototype.scrollIntoView ?? (() => {});

const VALUES = [3, -8, 11, 0, 6, -2, 9];
const table: DataTable = {
  id: "t", kind: "column", name: "T",
  columns: [{ id: "m", name: "Mice", role: "y" }, { id: "s", name: "Shuffled", role: "y" }],
  rows: VALUES.map((v, i) => ({ id: `r${i}`, cells: { m: v, s: i % 2 } })),
};
const plotOf = (kind: "box" | "violin", over: Partial<Plot> = {}): Plot =>
  ({ id: "p", name: "P", source: "t", status: "ok", styleOverrides: {}, kind, showBoxPoints: true, seriesStyles: { m: { color: "#3366cc", symbolFill: "solid" } }, ...over }) as Plot;
const SIZE = { width: 640, height: 420 };

for (const kind of ["box", "violin"] as const) {
  describe(`${kind}: one dot on its own`, () => {
    beforeEach(() => globalThis.localStorage?.clear());

    it("the figure draws row r2's dot hollow and every other dot of the group solid", () => {
      const scene = buildPlotScene(table, plotOf(kind, { pointStyles: { "m:r2": { symbolFill: "open" } } }), SIZE);
      const m = scene.series.find((s) => s.id === "m")!.marks[0]!;
      const { container } = render(<PlotFigure scene={scene} />);
      const circleAt = (p: { cx: number; cy: number }) =>
        [...container.querySelectorAll("circle")].find((c) => Number(c.getAttribute("cx")) === p.cx && Number(c.getAttribute("cy")) === p.cy && c.getAttribute("fill") !== "transparent")!;
      m.points!.forEach((p, i) => {
        const c = circleAt(p);
        expect(c, `no dot drawn at row ${m.pointRows![i]}`).toBeDefined();
        if (m.pointRows![i] === "r2") {
          expect(c.getAttribute("fill")).toBe("var(--bg)");
          expect(c.getAttribute("stroke")).toBe("#3366cc");
        } else expect(c.getAttribute("fill")).toBe("#3366cc");
      });
    });

    it("a click on a dot selects that dot's row, not the whole group", () => {
      const scene = buildPlotScene(table, plotOf(kind), SIZE);
      const m = scene.series.find((s) => s.id === "m")!.marks[0]!;
      const onSelect = vi.fn();
      const { container } = render(<PlotFigure scene={scene} onSelect={onSelect} />);
      const k = m.pointRows!.indexOf("r4");
      const hit = [...container.querySelectorAll("circle")].find((c) => c.getAttribute("fill") === "transparent" && Number(c.getAttribute("cx")) === m.points![k]!.cx && Number(c.getAttribute("cy")) === m.points![k]!.cy)!;
      expect(hit, "no hit circle on the dot").toBeDefined();
      fireEvent.click(hit);
      expect(onSelect.mock.calls.at(-1)?.[0]).toEqual(expect.objectContaining({ kind: "series", columnId: "m", rowId: "r4" }));
    });

    const panel = (rowId: string | undefined, over: Partial<Plot> = {}) => {
      const onSetSeriesStyle = vi.fn();
      const onSetPointStyle = vi.fn();
      const onSetSeriesStyleAll = vi.fn();
      const { container } = render(
        <Inspector {...({} as ComponentProps<typeof Inspector>)} activeSection="graphs" selection={{ kind: "series", columnId: "m", ...(rowId ? { rowId } : {}) } as never}
          plot={plotOf(kind, over)} table={table} userPresets={[]} profileDefault={null} wholeGraph={false} onSetWholeGraph={() => {}} onSelect={vi.fn()}
          onSetSeriesStyle={onSetSeriesStyle} onSetSeriesStyleAll={onSetSeriesStyleAll} onSetPointStyle={onSetPointStyle} onSetPlotOptions={vi.fn()} />,
      );
      const rowOf = (label: string) => [...container.querySelectorAll("label.frow")].find((l) => l.querySelector("span")?.textContent?.trim() === label);
      return { container, rowOf, onSetSeriesStyle, onSetSeriesStyleAll, onSetPointStyle };
    };

    it("series panel: the Data points rows (Shape) are offered while the group draws dots, and not without dots", () => {
      expect(panel(undefined).rowOf("Shape"), "no Data points Shape row").toBeDefined();
      cleanup();
      expect(panel(undefined, { showBoxPoints: false }).rowOf("Shape")).toBeUndefined();
    });

    it("the dots' Outline colour is offered with their other rows, and the figure draws it", () => {
      const { rowOf, onSetSeriesStyle, onSetSeriesStyleAll } = panel(undefined);
      const input = rowOf("Outline colour")?.querySelector("input");
      expect(input, "no Outline colour row for the dots").toBeTruthy();
      fireEvent.change(input!, { target: { value: "#ff0000" } });
      fireEvent.blur(input!);
      // A violin edit with Apply to whole series ticked goes to every violin, as all its rows do.
      const wrote = [...onSetSeriesStyle.mock.calls.map((c) => c[1]), ...onSetSeriesStyleAll.mock.calls.map((c) => c[1])];
      expect(wrote).toContainEqual(expect.objectContaining({ symbolOutline: "#ff0000" }));
      cleanup();
      const scene = buildPlotScene(table, plotOf(kind, { seriesStyles: { m: { color: "#3366cc", symbolFill: "solid", symbolOutline: "#ff0000" } } }), SIZE);
      const { container } = render(<PlotFigure scene={scene} />);
      expect([...container.querySelectorAll("circle")].some((c) => c.getAttribute("stroke") === "#ff0000"), "the outline colour is not drawn").toBe(true);
    });

    it("one dot selected, whole series unticked: Fill → Open goes to that dot alone", () => {
      globalThis.localStorage?.setItem("mady.applyWholeSeries", "0");
      const { rowOf, onSetPointStyle, onSetSeriesStyle } = panel("r2");
      const sel = rowOf("Fill")!.querySelector("select")!;
      fireEvent.change(sel, { target: { value: "open" } });
      expect(onSetPointStyle).toHaveBeenLastCalledWith("m", "r2", expect.objectContaining({ symbolFill: "open" }));
      expect(onSetSeriesStyle).not.toHaveBeenCalled();
    });

    it("one dot selected: only the dot's rows are shown, not the box's (no Whiskers / Contour rows)", () => {
      globalThis.localStorage?.setItem("mady.applyWholeSeries", "0");
      const { rowOf } = panel("r2");
      expect(rowOf("Fill")).toBeDefined();
      expect(rowOf("Contour width")).toBeUndefined();
    });

    it("a row selected while the group draws no dots is not a dot: the box's own rows stay", () => {
      globalThis.localStorage?.setItem("mady.applyWholeSeries", "0");
      const { rowOf } = panel("r2", { showBoxPoints: false });
      expect(rowOf("Contour width")).toBeDefined();
      expect(rowOf("Shape")).toBeUndefined();
    });
  });
}
