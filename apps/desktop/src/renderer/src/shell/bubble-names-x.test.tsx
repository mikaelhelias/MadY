// @vitest-environment jsdom
/**
 * A bubble chart whose X column holds names: the names sit along a category axis and the bubbles
 * that share a name sit side by side (by the colour column, else by row order).
 *
 * The Inspector follows the data, not the kind: clicking the X axis offers the category-axis panel
 * (label rotation, spacing, category groups, the names' font), the Data tab offers Point spread for
 * the side-by-side gap, and the controls the builder refuses on names (spread band, confidence
 * ellipse, 1:1 scale) are hidden. A bubble chart with a numeric X keeps every one of them.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import type { DataTable, Plot } from "@mady/core";
import { buildPlotScene } from "@mady/graphics";
import { Inspector } from "./Inspector";
import { PlotFigure } from "./PlotFigure";

afterEach(cleanup);

const namesTable: DataTable = {
  id: "t", kind: "xy", name: "Pathways",
  columns: [{ id: "g", name: "gene group" }, { id: "nes", name: "NES" }, { id: "n", name: "Gene set size" }, { id: "tr", name: "treatment" }],
  rows: ([
    ["ribosome", -2.1, 50, "Drug A"], ["Oxidative Phosphorylation", -2.6, 30, "Drug A"],
    ["ribosome", 1.5, 50, "Drug B"], ["Oxidative Phosphorylation", -2.2, 30, "Drug B"],
  ] as const).map(([g, nes, n, tr], i) => ({ id: `r${i}`, cells: { g, nes, n, tr } })),
};
// The same sheet with numbers along X: the ordinary continuous bubble chart.
const numbersTable: DataTable = { ...namesTable, rows: namesTable.rows.map((r, i) => ({ ...r, cells: { ...r.cells, g: i + 1 } })) };
const plot: Plot = { id: "p", name: "P", source: "t", status: "ok", styleOverrides: {}, kind: "bubble", seriesStyles: { nes: { colorFromColumn: "tr" } } };

const handlers = (onSetPlotOptions: (p: Partial<Plot>) => void = () => {}) => ({
  onSelect: vi.fn(),
  onSetAxis: vi.fn(), onSetAxisLength: vi.fn(), onSetAxisTitleFont: vi.fn(),
  onSetSeriesStyle: vi.fn(), onSetSeriesStyleAll: vi.fn(), onSetPointStyle: vi.fn(), onClearPointStyles: vi.fn(),
  onSetGrid: vi.fn(), onSetFrame: vi.fn(), onSetKind: vi.fn(), onSetBarLayout: vi.fn(), onSetBarShape: vi.fn(), onSetBoxWhisker: vi.fn(),
  onSetPlotOptions, onSetGraphTitle: vi.fn(), onSetPlotFont: vi.fn(), onHomogenizeFont: vi.fn(),
  onSetLegend: vi.fn(), onSetSignificance: vi.fn(), onApplyPreset: vi.fn(),
  onApplyUserPreset: vi.fn(), onSaveUserPreset: vi.fn(), onDeleteUserPreset: vi.fn(), onSetProfileDefault: vi.fn(),
  annotationOps: { add: vi.fn(), update: vi.fn(), remove: vi.fn(), reorder: vi.fn(), align: vi.fn(), group: vi.fn(), ungroup: vi.fn(), setLocked: vi.fn(), addImage: vi.fn(), replaceImage: vi.fn() },
});
const inspect = (table: DataTable, selection: unknown, onSetPlotOptions?: (p: Partial<Plot>) => void, p: Plot = plot) =>
  render(<Inspector activeSection="graphs" selection={selection as never} plot={p} table={table} userPresets={[]} profileDefault={null} wholeGraph={false} onSetWholeGraph={() => {}} {...handlers(onSetPlotOptions)} />).container;
const text = (c: HTMLElement) => c.textContent ?? "";
const fieldLabels = (c: HTMLElement) => [...c.querySelectorAll("label.frow > span:first-child")].map((x) => x.textContent);
const slider = (c: HTMLElement) => c.querySelector<HTMLInputElement>('input[aria-label="Point spread"]');

describe("Bubble chart coloured by a column — every key looks like what it names", () => {
  // The house two-tone marker: a light interior and a darker edge.
  const twoTone: Plot = { ...plot, seriesStyles: { nes: { colorFromColumn: "tr", symbolFill: "twotone" } } };
  const scene = (p: Plot) => buildPlotScene(namesTable, p, { width: 640, height: 440 });

  it("the bubbles stay two-tone, each from its own treatment colour", () => {
    const marks = scene(twoTone).series[0]!.marks;
    for (const m of marks) expect(m.symbolFill).toBe("open");
    expect(new Set(marks.map((m) => m.symbolFillColor)).size).toBe(2);
  });

  it("a treatment key is the bubble's own dot — same interior and edge — with no line, drawn and in the scene", () => {
    const s = scene(twoTone);
    const rows = s.legend.filter((e) => e.dataDriven);
    expect(rows.map((e) => e.label)).toEqual(["Drug A", "Drug B"]);
    for (const e of rows) {
      const m = s.series[0]!.marks.find((x) => x.fill === e.color)!;
      expect(e.line, `${e.label}: a line key on a chart that draws no line`).toBe(false);
      expect(e.dot?.fill).toBe("open");
      expect(e.dot?.fillColor).toBe(m.symbolFillColor);
      expect(e.dot?.outline).toBe(m.symbolOutline);
    }
    const { container } = render(<PlotFigure scene={s} />);
    expect(container.querySelectorAll(".gfx-legend line").length, "a line drawn in the legend").toBe(0);
  });

  it("the size key is a hollow grey ring, never a fill that could read as a treatment's colour", () => {
    // In every fill style, and so under a greyscale palette too, where a grey fill would name a grey treatment.
    for (const symbolFill of ["twotone", "solid", "open"] as const) {
      const k = scene({ ...plot, seriesStyles: { nes: { colorFromColumn: "tr", symbolFill } } }).bubbleLegend!.marker;
      expect(k.symbolFill, symbolFill).toBe("open");
      expect(k.symbolFillColor, symbolFill).toBeUndefined();
      expect(k.symbolOutline, symbolFill).toBe("#7a7a7a");
    }
    // Without a colour column the key wears the series' own colour.
    const plain = scene({ ...plot, seriesStyles: { nes: { color: "#123456", symbolFill: "solid" } } }).bubbleLegend!.marker;
    expect(plain.color).toBe("#123456");
  });
});

describe("Bubble chart with names along X — the Inspector follows the data", () => {
  it("the X axis offers the category-axis panel; a numeric X keeps the numbers panel", () => {
    expect(text(inspect(namesTable, { kind: "axis", axis: "x" }))).toContain("X axis (categories)");
    cleanup();
    expect(text(inspect(numbersTable, { kind: "axis", axis: "x" }))).not.toContain("X axis (categories)");
  });

  it("Point spread is on the Data tab and moves the bubbles apart", () => {
    const writes: Partial<Plot>[] = [];
    const c = inspect(namesTable, { kind: "series", columnId: "nes" }, (p) => writes.push(p));
    expect(slider(c), "no Point spread slider for the side-by-side gap").not.toBeNull();
    fireEvent.click(c.querySelector<HTMLInputElement>('input[aria-label="Point spread: whole graph"]')!);
    cleanup();
    // The control writes the field the builder reads: moving it to 1.5× widens the gap between two treatments.
    const gap = (p: Plot) => { const m = buildPlotScene(namesTable, p, { width: 640, height: 440 }).series[0]!.marks; return m[2]!.cx - m[0]!.cx; };
    const c2 = inspect(namesTable, { kind: "series", columnId: "nes" }, (p) => writes.push(p));
    fireEvent.change(slider(c2)!, { target: { value: "1.5" } });
    const after = { ...plot, ...writes.at(-1) } as Plot;
    expect(after.pointSpread).toBe(1.5);
    expect(gap(after)).toBeGreaterThan(gap(plot) + 1);
    cleanup();
    expect(slider(inspect(numbersTable, { kind: "series", columnId: "nes" })), "a numeric bubble chart spreads nothing").toBeNull();
    cleanup();
    // One bubble per name: nothing sits side by side, so there is nothing for the slider to move.
    const onePerName: DataTable = { ...namesTable, rows: namesTable.rows.filter((r) => r.cells.tr === "Drug A") };
    expect(slider(inspect(onePerName, { kind: "series", columnId: "nes" })), "a slider that can move nothing").toBeNull();
  });

  it("spread band, confidence ellipse and the 1:1 scale are hidden on names, offered on numbers", () => {
    const names = inspect(namesTable, { kind: "plot" });
    expect(fieldLabels(names)).not.toContain("Spread band");
    expect(text(names)).not.toContain("Confidence ellipse");
    cleanup();
    expect(fieldLabels(inspect(namesTable, { kind: "axis", axis: "y" }))).not.toContain("Equal aspect (1:1)");
    cleanup();
    const numbers = inspect(numbersTable, { kind: "plot" });
    expect(fieldLabels(numbers)).toContain("Spread band");
    expect(text(numbers)).toContain("Confidence ellipse");
    cleanup();
    expect(fieldLabels(inspect(numbersTable, { kind: "axis", axis: "y" }))).toContain("Equal aspect (1:1)");
  });
});
