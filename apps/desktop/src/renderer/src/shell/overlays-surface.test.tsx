// @vitest-environment jsdom
// The series controls for a series borrowed from another datasheet.
// A foreign series that draws but has no Series row, no click target and an anonymous tooltip
// cannot be selected or edited. The Inspector receives the joined table (the plot's sheet + the
// overlay columns) plus `foreignSeries` (column id → sheet name) so its ~30 dataset-keyed sites
// see the borrowed series for free; the row and the tooltip say which sheet it came from.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { buildPlotScene } from "@mady/graphics";
import { resolveOverlays } from "@mady/core";
import type { DataTable, Plot } from "@mady/core";
import { Inspector } from "./Inspector";
import { PlotFigure } from "./PlotFigure";

afterEach(cleanup);
const SIZE = { width: 640, height: 460 };
const a: DataTable = {
  id: "A", kind: "xy", name: "Measured",
  columns: [{ id: "ax", name: "Dose", role: "x" }, { id: "ay", name: "Response", role: "y" }],
  rows: [{ id: "a1", cells: { ax: 1, ay: 10 } }, { id: "a2", cells: { ax: 2, ay: 20 } }, { id: "a3", cells: { ax: 3, ay: 30 } }],
};
const b: DataTable = {
  id: "B", kind: "xy", name: "Model",
  columns: [{ id: "bx", name: "Dose", role: "x" }, { id: "by", name: "Fit", role: "y" }],
  rows: [{ id: "b1", cells: { bx: 1, by: 12 } }, { id: "b2", cells: { bx: 2, by: 19 } }, { id: "b3", cells: { bx: 3, by: 31 } }],
};
const tables = (id: string): DataTable | undefined => ({ A: a, B: b })[id];
const plot: Plot = { id: "p", name: "P", source: "A", kind: "xy", overlays: [{ id: "o1", table: "B", column: "by" }] } as Plot;

const handlers = () => ({
  onSelect: vi.fn(),
  onSetAxis: vi.fn(), onSetAxisLength: vi.fn(), onSetAxisTitleFont: vi.fn(),
  onSetSeriesStyle: vi.fn(), onSetSeriesStyleAll: vi.fn(), onSetPointStyle: vi.fn(), onClearPointStyles: vi.fn(),
  onSetGrid: vi.fn(), onSetFrame: vi.fn(), onSetKind: vi.fn(), onSetBarLayout: vi.fn(), onSetBarShape: vi.fn(), onSetBoxWhisker: vi.fn(),
  onSetPlotOptions: vi.fn(), onSetGraphTitle: vi.fn(), onSetPlotFont: vi.fn(), onHomogenizeFont: vi.fn(),
  onSetLegend: vi.fn(), onSetSignificance: vi.fn(), onApplyPreset: vi.fn(), 
  onApplyUserPreset: vi.fn(), onSaveUserPreset: vi.fn(), onDeleteUserPreset: vi.fn(), onSetProfileDefault: vi.fn(),
  annotationOps: { add: vi.fn(), update: vi.fn(), remove: vi.fn(), reorder: vi.fn(), align: vi.fn(), group: vi.fn(), ungroup: vi.fn(), setLocked: vi.fn(), addImage: vi.fn(), replaceImage: vi.fn() },
});
const joined = resolveOverlays(a, plot, tables);
const foreignSeries = Object.fromEntries([...joined.foreign].map(([id, f]) => [id, f.name]));
const panel = (selection: unknown) => {
  const h = handlers();
  const r = render(
    <Inspector activeSection="graphs" selection={selection as never} plot={plot} table={joined.table} foreignSeries={foreignSeries}
      userPresets={[]} profileDefault={null} wholeGraph={false} onSetWholeGraph={() => {}} {...h} />,
  );
  return { ...r, h };
};

describe("borrowed series — Inspector", () => {
  it("the Series list shows the foreign column with a chip naming its sheet; the local one has no chip", () => {
    const { container } = panel({ kind: "plot" });
    const text = container.textContent ?? "";
    expect(text).toContain("Fit");
    expect(text).toContain("Response");
    const chips = [...container.querySelectorAll(".serfrom")].map((e) => (e.textContent ?? "").trim());
    expect(chips).toEqual(["from Model"]);
  });

  it("clicking the foreign series opens its series panel (marker controls), keyed by the foreign column id", () => {
    const { container, h } = panel({ kind: "series", columnId: "by", part: "points" });
    const labels = [...container.querySelectorAll("label > span:first-child")].map((e) => (e.textContent ?? "").trim());
    expect(labels).toContain("Shape");
    expect(container.textContent).toContain("from Model");
    // and an edit writes to the foreign column id on this plot's seriesStyles
    const shapeRow = [...container.querySelectorAll("label")].find((l) => (l.querySelector("span:first-child")?.textContent ?? "").trim() === "Shape");
    fireEvent.change(shapeRow!.querySelector("select")!, { target: { value: "square" } });
    expect(h.onSetSeriesStyle).toHaveBeenCalledWith("by", expect.objectContaining({ symbol: "square" }));
  });
});

describe("borrowed series — adding and removing (Data ▸ Series)", () => {
  const c: DataTable = {
    id: "C", kind: "xy", name: "Controls",
    columns: [{ id: "cx", name: "Dose", role: "x" }, { id: "cy", name: "Vehicle", role: "y" }, { id: "cz", name: "Sham", role: "y" }],
    rows: [{ id: "c1", cells: { cx: 1, cy: 5, cz: 4 } }],
  };
  const withPicker = (p: Plot, others: DataTable[]) => {
    const h = handlers();
    const j = resolveOverlays(a, p, (id) => ({ A: a, B: b, C: c })[id]);
    const r = render(
      <Inspector activeSection="graphs" selection={{ kind: "plot" } as never} plot={p} table={j.table}
        foreignSeries={Object.fromEntries([...j.foreign].map(([id, f]) => [id, f.name]))} otherTables={others}
        userPresets={[]} profileDefault={null} wholeGraph={false} onSetWholeGraph={() => {}} {...h} />,
    );
    return { ...r, h };
  };

  it("the Series section offers every column of every other sheet, never the plot's own; picking one adds an overlay", () => {
    const { container, h } = withPicker(plot, [a, b, c]);
    const sel = container.querySelector<HTMLSelectElement>("select[aria-label='Add series from another datasheet']");
    expect(sel, "no picker in the Series section").not.toBeNull();
    const options = [...sel!.options].map((o) => o.textContent?.trim());
    expect(options).toContain("Controls ▸ Vehicle");
    expect(options).toContain("Controls ▸ Sham");
    expect(options.some((o) => o?.startsWith("Measured"))).toBe(false); // the plot's own sheet
    expect(options).not.toContain("Model ▸ Fit"); // already borrowed
    fireEvent.change(sel!, { target: { value: "C::cz" } });
    expect(h.onSetPlotOptions).toHaveBeenCalledWith({
      overlays: [{ id: "o1", table: "B", column: "by" }, expect.objectContaining({ table: "C", column: "cz" })],
    });
  });

  it("a borrowed row has a remove button that drops just that overlay", () => {
    const { container, h } = withPicker(plot, [b, c]);
    const remove = container.querySelector<HTMLButtonElement>("button[aria-label='Remove borrowed series Fit']");
    expect(remove).not.toBeNull();
    fireEvent.click(remove!);
    expect(h.onSetPlotOptions).toHaveBeenCalledWith({ overlays: undefined });
  });

  it("a kind with no shared axis offers no picker", () => {
    const pie = { ...plot, kind: "pie", overlays: undefined } as Plot;
    const { container } = withPicker(pie, [b, c]);
    expect(container.querySelector("select[aria-label='Add series from another datasheet']")).toBeNull();
  });
});

describe("borrowed series — figure tooltip", () => {
  it("hovering a foreign point names the sheet it came from; a local point does not", () => {
    const scene = buildPlotScene(a, plot, { ...SIZE, tables });
    const { container } = render(<PlotFigure scene={scene} zoom={1} onSelect={vi.fn()} />);
    const hits = (id: string) => [...container.querySelectorAll(`.gfx-series[data-mady-series="${id}"] circle[fill='transparent']`)];
    fireEvent.mouseEnter(hits("by")[1]!);
    expect(container.textContent).toMatch(/row 2 of Model/);
    fireEvent.mouseEnter(hits("ay")[1]!);
    expect(container.textContent).toMatch(/row 2(?! of)/);
    expect(container.textContent).not.toMatch(/of Model/);
  });
});
