// @vitest-environment jsdom
/**
 * Print size: buttons that size a graph for a
 * journal column or a full page.
 *
 * A print size never re-lays-out the graph. Setting Width/Height instead would redraw the
 * graph at e.g. 321 px with its text at full size — the graph's items changing scale against the
 * graph (the same "Keep proportions" rule as for panels). A print size is
 * how wide the whole drawing prints, scaled uniformly; the Export dialog starts from it.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import type { DataTable, Plot } from "@mady/core";
import { buildPlotScene } from "@mady/graphics";
import { Inspector } from "./Inspector";
import { GRAPH_PRINT_SIZES, mmToPx, PRINT_WIDTHS, printedPt, printWidthFor } from "./printSizes";
import type { GraphSelection } from "./AppShell";

afterEach(cleanup);

describe("print sizes — the numbers", () => {
  it("millimetres to pixels", () => {
    // 85 mm ÷ 25.4 mm/in × 300 px/in = 1003.9 px.
    expect(mmToPx(85, 300)).toBe(1004);
    expect(mmToPx(174, 96)).toBe(658);
  });

  it("the column buttons are widths the Export dialog offers", () => {
    const widths = new Set(PRINT_WIDTHS.map((p) => p.mm));
    for (const s of GRAPH_PRINT_SIZES.filter((x) => x.hMm === undefined)) {
      expect(widths.has(s.wMm), `${s.label} (${s.wMm} mm) is not in the Export dialog`).toBe(true);
    }
  });

  it("a column is its width; a page is the widest width at which the whole graph fits it", () => {
    const col = GRAPH_PRINT_SIZES.find((x) => x.label === "1 column")!;
    const tall = GRAPH_PRINT_SIZES.find((x) => x.label === "Page ↕")!;
    const wide = GRAPH_PRINT_SIZES.find((x) => x.label === "Page ↔")!;
    expect(printWidthFor(col, 580 / 380)).toBe(85);
    // A 580 × 380 graph on a 174 × 235 page: width-limited (174 mm wide is 114 mm tall).
    expect(printWidthFor(tall, 580 / 380)).toBe(174);
    // The same graph on a 235 × 174 page: height-limited, 174 mm tall is 265.6 mm wide → 235.
    expect(printWidthFor(wide, 580 / 380)).toBe(235);
    // A tall 380 × 580 graph on the tall page: 235 mm tall is 154 mm wide.
    expect(printWidthFor(tall, 380 / 580)).toBe(154);
  });

  it("text prints at its pixels scaled by the print width over the graph width", () => {
    // Independent arithmetic: 85 mm = 240.9 pt across; a 580 px graph → 0.4154 pt per px.
    expect(printedPt(12, 580, 85)).toBeCloseTo(4.985, 3);
    expect(printedPt(12, 321, 85)).toBeCloseTo(9.0, 1);
  });
});

const table: DataTable = {
  id: "t", kind: "xy", name: "T",
  columns: [{ id: "x", name: "X", role: "x" }, { id: "y", name: "Y", role: "y" }],
  rows: [{ id: "r1", cells: { x: 1, y: 2 } }, { id: "r2", cells: { x: 2, y: 3 } }],
};
function panel(plot: Plot, opts = vi.fn<(patch: Partial<Plot>) => void>()) {
  const sel: GraphSelection = { kind: "chart-section", title: "Graph size" };
  const { container } = render(
    <Inspector
      activeSection="graphs" selection={sel} plot={plot} table={table}
      userPresets={[]} profileDefault={null} onSelect={vi.fn()}
      onSetAxis={vi.fn()} onSetAxisLength={vi.fn()} onSetAxisTitleFont={vi.fn()}
      onSetSeriesStyle={vi.fn()} onSetSeriesStyleAll={vi.fn()} onSetPointStyle={vi.fn()} onClearPointStyles={vi.fn()}
      onSetGrid={vi.fn()} onSetFrame={vi.fn()} onSetKind={vi.fn()} onSetBarLayout={vi.fn()} onSetBarShape={vi.fn()} onSetBoxWhisker={vi.fn()}
      onSetPlotOptions={opts} onSetGraphTitle={vi.fn()} onSetPlotFont={vi.fn()} onHomogenizeFont={vi.fn()}
      onSetLegend={vi.fn()} onSetSignificance={vi.fn()} onApplyPreset={vi.fn()}
      onApplyUserPreset={vi.fn()} onSaveUserPreset={vi.fn()} onDeleteUserPreset={vi.fn()} onSetProfileDefault={vi.fn()}
      annotationOps={{ add: vi.fn(), update: vi.fn(), remove: vi.fn(), reorder: vi.fn(), align: vi.fn(), group: vi.fn(), ungroup: vi.fn(), setLocked: vi.fn(), addImage: vi.fn(), replaceImage: vi.fn() }}
    />,
  );
  return { container, opts };
}
const base: Plot = { id: "p", name: "P", source: "t", status: "ok", styleOverrides: {}, kind: "xy", figureWidth: 580, figureHeight: 380 };
const printRow = (c: HTMLElement) => [...c.querySelectorAll<HTMLElement>(".frow")].find((r) => (r.querySelector(":scope > span")?.textContent ?? "").trim() === "Print size");
const buttons = (c: HTMLElement) => [...printRow(c)!.querySelectorAll("button")];

describe("print size — the Graph size section", () => {
  it("offers one button per size, each titled with its millimetres, plus Off", () => {
    const { container } = panel(base);
    expect(printRow(container), "no 'Print size' row in Graph size").toBeTruthy();
    const labels = buttons(container).map((b) => b.textContent);
    expect(labels).toEqual([...GRAPH_PRINT_SIZES.map((s) => s.label), "Off"]);
    for (const [i, s] of GRAPH_PRINT_SIZES.entries()) expect(buttons(container)[i]!.getAttribute("title") ?? "").toContain(`${s.wMm}`);
  });

  it("a press records the print width and NEVER touches the graph's own Width or Height", () => {
    const { container, opts } = panel(base);
    fireEvent.click(buttons(container)[0]!);
    expect(opts).toHaveBeenLastCalledWith({ printWidthMm: 85 });
    fireEvent.click(buttons(container)[4]!);
    expect(opts).toHaveBeenLastCalledWith({ printWidthMm: printWidthFor(GRAPH_PRINT_SIZES[4]!, 580 / 380) });
    for (const call of opts.mock.calls) {
      expect(call[0]).not.toHaveProperty("figureWidth");
      expect(call[0]).not.toHaveProperty("figureHeight");
    }
    fireEvent.click(buttons(container).at(-1)!);
    expect(opts).toHaveBeenLastCalledWith({ printWidthMm: undefined });
  });

  it("shows the size it is set to as pressed, and says what the text will print at", () => {
    const { container } = panel({ ...base, printWidthMm: 85 });
    const pressed = buttons(container).filter((b) => b.getAttribute("aria-pressed") === "true").map((b) => b.textContent);
    expect(pressed).toEqual(["1 column"]);
    const note = container.querySelector('[data-print-note]')?.textContent ?? "";
    expect(note).toMatch(/85 mm/);
    // The graph is 580 px wide and 85 mm = 240.94 pt: its axis numbers print at px × 240.94 / 580 —
    // below the 6 pt most journals ask for at this width.
    const tick = buildPlotScene(table, { ...base, printWidthMm: 85 }, { width: 580, height: 380 }).fonts.tick.size;
    expect(note).toContain(`(${tick} px) print at ${((tick * (85 / 25.4) * 72) / 580).toFixed(1)} pt`);
    expect(note).toMatch(/6 pt/);
    cleanup();
    const off = panel(base).container;
    expect(buttons(off).filter((b) => b.getAttribute("aria-pressed") === "true").map((b) => b.textContent)).toEqual(["Off"]);
    expect(off.querySelector("[data-print-note]")).toBeNull();
  });
});
