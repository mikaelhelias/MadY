// @vitest-environment jsdom
/**
 * FOCUS — the control, and the way back.
 *
 * A look a user cannot undo is a look they will not try. The ring in each Series row focuses
 * that series (everything else goes grey); "Clear focus" is the one click that puts the whole
 * plot back, and this asserts the DRAWING returns identical, not merely that the flag cleared.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import type { DataTable, Plot, SeriesStyle } from "@mady/core";
import { buildPlotScene } from "@mady/graphics";
import { PlotFigure } from "./PlotFigure";
import { Inspector } from "./Inspector";

afterEach(cleanup);

const SIZE = { width: 520, height: 360 };
const table: DataTable = {
  id: "t", kind: "xy", name: "t",
  columns: [
    { id: "x", name: "Dose", role: "x", type: "number" },
    { id: "a", name: "Drug A", role: "y", type: "number" },
    { id: "b", name: "Drug B", role: "y", type: "number" },
  ],
  rows: [0, 1, 2, 3].map((i) => ({ id: `r${i}`, cells: { x: i, a: i * 2 + 1, b: i * 1.4 } })),
};
const plot: Plot = { id: "p", name: "p", source: "t", status: "ok", styleOverrides: {}, kind: "xy", legend: { show: true } };

const handlers = (onSetSeriesStyle: (id: string, d: SeriesStyle) => void) => ({
  onSelect: vi.fn(), onSetAxis: vi.fn(), onSetAxisLength: vi.fn(), onSetAxisTitleFont: vi.fn(),
  onSetSeriesStyle, onSetSeriesStyleAll: vi.fn(), onSetPointStyle: vi.fn(), onClearPointStyles: vi.fn(),
  onSetGrid: vi.fn(), onSetFrame: vi.fn(), onSetKind: vi.fn(), onSetBarLayout: vi.fn(), onSetBarShape: vi.fn(), onSetBoxWhisker: vi.fn(),
  onSetPlotOptions: vi.fn(), onSetGraphTitle: vi.fn(), onSetPlotFont: vi.fn(), onHomogenizeFont: vi.fn(),
  onSetLegend: vi.fn(), onSetSignificance: vi.fn(), onApplyPreset: vi.fn(), 
  onApplyUserPreset: vi.fn(), onSaveUserPreset: vi.fn(), onDeleteUserPreset: vi.fn(), onSetProfileDefault: vi.fn(),
  annotationOps: { add: vi.fn(), update: vi.fn(), remove: vi.fn(), reorder: vi.fn(), align: vi.fn(), group: vi.fn(), ungroup: vi.fn(), setLocked: vi.fn(), addImage: vi.fn(), replaceImage: vi.fn() },
});

const inspector = (p: Plot, onSetSeriesStyle = vi.fn()) =>
  render(<Inspector activeSection="graphs" selection={{ kind: "plot" }} plot={p} table={table}
    userPresets={[]} profileDefault={null} {...handlers(onSetSeriesStyle)} />);

describe("focus — the control", () => {
  it("gives every series in the list its own focus ring", () => {
    const { container } = inspector(plot);
    expect(container.querySelectorAll(".focusbtn")).toHaveLength(2);
  });

  it("clicking a ring focuses that series", () => {
    const set = vi.fn();
    const { container } = inspector(plot, set);
    fireEvent.click(container.querySelectorAll(".focusbtn")[0]!);
    expect(set).toHaveBeenCalledWith("a", { focus: true });
  });

  it("clicking a lit ring takes that series back out of focus", () => {
    const set = vi.fn();
    const { container } = inspector({ ...plot, seriesStyles: { a: { focus: true } } }, set);
    expect(container.querySelector(".focusbtn.on")).toBeTruthy();
    fireEvent.click(container.querySelectorAll(".focusbtn")[0]!);
    expect(set).toHaveBeenCalledWith("a", { focus: undefined });
  });

  /** Six focused series is six clicks back to a normal plot without this. */
  it("offers Clear focus only when something is focused, and clears every one", () => {
    expect(inspector(plot).queryByText("Clear focus")).toBeNull();
    cleanup();
    const set = vi.fn();
    const { getByText } = inspector({ ...plot, seriesStyles: { a: { focus: true }, b: { focus: true } } }, set);
    fireEvent.click(getByText("Clear focus"));
    expect(set).toHaveBeenCalledWith("a", { focus: undefined });
    expect(set).toHaveBeenCalledWith("b", { focus: undefined });
  });
});

describe("focus — the way back", () => {
  const draw = (p: Plot): string => renderToStaticMarkup(createElement(PlotFigure, { scene: buildPlotScene(table, p, SIZE) }));

  it("clearing the focus redraws the graph exactly as it was", () => {
    const before = draw(plot);
    const focused = draw({ ...plot, seriesStyles: { a: { focus: true } } });
    expect(focused, "focusing changed nothing on the drawing").not.toBe(before);
    // What the "Clear focus" button writes: focus back to undefined on every row.
    expect(draw({ ...plot, seriesStyles: { a: { focus: undefined } } })).toBe(before);
  });

  it("a de-emphasised series is actually drawn grey, and the focused one is not", () => {
    const s = buildPlotScene(table, { ...plot, seriesStyles: { a: { focus: true } } }, SIZE);
    const [a, b] = [s.series.find((x) => x.id === "a")!, s.series.find((x) => x.id === "b")!];
    const chroma = (hex: string): number => {
      const [r, g, bl] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
      return Math.max(r!, g!, bl!) - Math.min(r!, g!, bl!);
    };
    expect(chroma(b.color), `"${b.name}" is still vivid (${b.color})`).toBeLessThan(chroma(a.color));
    expect(chroma(b.color)).toBeLessThan(40);
  });
});
