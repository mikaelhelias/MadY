// @vitest-environment jsdom
// Axis tab ▸ Title direction — the control is where every chart's title controls are, on every chart type
// that draws a Y title, writes to the spec that owns that title (the category spec on a flipped chart), and
// what it writes reaches the drawing. It is absent where the axis runs across the figure.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import type { AxisSpec, DataTable, Plot } from "@mady/core";
import { dataAxisOf, isTransposedPlot, tableDatasets } from "@mady/core";
import { buildPlotScene } from "@mady/graphics";
import { Inspector, TitleDirectionRows } from "./Inspector";
import { galleryItems } from "./gallery";
import type { GraphSelection } from "./AppShell";

afterEach(cleanup);
afterEach(() => globalThis.localStorage?.clear());

const handlers = (onSetAxis: (axis: string, patch: Partial<AxisSpec>) => void) => ({
  onSelect: vi.fn(),
  onSetAxis, onSetAxisLength: vi.fn(), onSetAxisTitleFont: vi.fn(),
  onSetSeriesStyle: vi.fn(), onSetSeriesStyleAll: vi.fn(), onSetPointStyle: vi.fn(), onClearPointStyles: vi.fn(),
  onSetGrid: vi.fn(), onSetFrame: vi.fn(), onSetKind: vi.fn(), onSetBarLayout: vi.fn(), onSetBarShape: vi.fn(), onSetBoxWhisker: vi.fn(),
  onSetPlotOptions: vi.fn(), onSetGraphTitle: vi.fn(), onSetPlotFont: vi.fn(), onHomogenizeFont: vi.fn(),
  onSetLegend: vi.fn(), onSetSignificance: vi.fn(), onApplyPreset: vi.fn(),
  onApplyUserPreset: vi.fn(), onSaveUserPreset: vi.fn(), onDeleteUserPreset: vi.fn(), onSetProfileDefault: vi.fn(),
  annotationOps: { add: vi.fn(), update: vi.fn(), remove: vi.fn(), reorder: vi.fn(), align: vi.fn(), group: vi.fn(), ungroup: vi.fn(), setLocked: vi.fn(), addImage: vi.fn(), replaceImage: vi.fn() },
});

function panel(plot: Plot, table: DataTable, axis: GraphSelection) {
  const writes: Array<{ axis: string; patch: Partial<AxisSpec> }> = [];
  const { container } = render(
    <Inspector activeSection="graphs" selection={axis} plot={plot} table={table} userPresets={[]} profileDefault={null} {...handlers((a, p) => writes.push({ axis: a, patch: p }))} />,
  );
  return { container, writes };
}
const directionRow = (c: HTMLElement): HTMLElement | undefined =>
  [...c.querySelectorAll<HTMLElement>(".frow")].find((r) => r.querySelector(":scope > span")?.textContent === "Title direction");
const button = (row: HTMLElement, text: string): HTMLButtonElement =>
  [...row.querySelectorAll("button")].find((b) => b.textContent === text)!;

/** Every gallery chart type, with a Y title typed (a heatmap draws one only then). */
const seen = new Set<string>();
const cards = galleryItems().flatMap((g) => {
  const k = (g.plot.kind ?? "xy") + (isTransposedPlot(g.plot) ? "-flipped" : "");
  if (seen.has(k)) return [];
  seen.add(k);
  const key = `${dataAxisOf(g.plot, "y")}Axis` as "xAxis" | "yAxis";
  const plot = { ...g.plot, [key]: { ...(g.plot[key] ?? {}), title: "Response (units)" } } as Plot;
  return buildPlotScene(g.table, plot, { width: 580, height: 380 }).y.title !== "" ? [{ ...g, plot }] : [];
});

describe("Title direction in the Axis tab", () => {
  it("reaches the chart types that draw a Y title", () => {
    expect(cards.length).toBeGreaterThanOrEqual(35);
  });

  for (const g of cards) {
    const label = (g.plot.kind ?? "xy") + (isTransposedPlot(g.plot) ? " (flipped)" : "");
    it(`${label}: offered on the Y axis, not on X; Level writes to the title's own spec and reaches the drawing`, () => {
      const x = panel(g.plot, g.table, { kind: "axis", axis: "x" });
      expect(directionRow(x.container), `${label}: X axis runs across — no Title direction`).toBeUndefined();
      cleanup();
      const y = panel(g.plot, g.table, { kind: "axis", axis: "y" });
      const row = directionRow(y.container);
      expect(row, `${label}: no Title direction on the Y axis`).toBeDefined();
      fireEvent.click(button(row!, "Level"));
      const w = y.writes.at(-1)!;
      const owner = dataAxisOf(g.plot, "y");
      expect(w.axis, `${label}: wrote to the wrong axis spec`).toBe(owner);
      expect(w.patch.titleAngle).toBe(0);
      const key = `${owner}Axis` as "xAxis" | "yAxis";
      const next = { ...g.plot, [key]: { ...(g.plot[key] ?? {}), ...w.patch } } as Plot;
      const scene = buildPlotScene(g.table, next, { width: 580, height: 380 });
      expect(scene.y.titleTurn?.angle, `${label}: the choice did not reach the drawing`).toBe(0);
    });
  }

  it("a right (Y2) axis offers it; a top one (horizontal bar) does not", () => {
    const xy = cards.find((c) => (c.plot.kind ?? "xy") === "xy")!;
    const ds = tableDatasets(xy.table);
    const withY2 = { ...xy.plot, seriesStyles: { [ds[1]!.id]: { axis: "y2" } } } as Plot;
    const r = panel(withY2, xy.table, { kind: "axis", axis: "y2" });
    const row = directionRow(r.container)!;
    expect(row).toBeDefined();
    expect(button(row, "270°")).toBeDefined();
    fireEvent.click(button(row, "Level"));
    expect(r.writes.at(-1)).toEqual({ axis: "y2", patch: { titleAngle: 0 } });
    cleanup();
    const bar = galleryItems().find((c) => c.plot.kind === "bar" && isTransposedPlot(c.plot))!;
    const bds = tableDatasets(bar.table);
    const top = { ...bar.plot, seriesStyles: { [bds[0]!.id]: { axis: "y2" } } } as Plot;
    expect(directionRow(panel(top, bar.table, { kind: "axis", axis: "y2" }).container)).toBeUndefined();
  });
});

describe("TitleDirectionRows", () => {
  const rows = (spec: AxisSpec, side: "left" | "right") => {
    const set = vi.fn();
    const r = render(<TitleDirectionRows spec={spec} side={side} set={set} />);
    return { ...r, set, row: directionRow(r.container)! };
  };
  it("marks the current angle, stores the default as no choice, and lets go of 'above' off level", () => {
    const a = rows({}, "left");
    expect(button(a.row, "90°").getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(button(a.row, "90°"));
    expect(a.set).toHaveBeenLastCalledWith({ titleAngle: undefined, titleAbove: undefined });
    fireEvent.click(button(a.row, "135°"));
    expect(a.set).toHaveBeenLastCalledWith({ titleAngle: 135, titleAbove: undefined });
    fireEvent.change(a.row.querySelector("input")!, { target: { value: "405" } });
    expect(a.set).toHaveBeenLastCalledWith({ titleAngle: 45, titleAbove: undefined });
    expect(a.container.textContent).not.toContain("Above the axis");
    cleanup();
    const b = rows({ titleAngle: 0 }, "left");
    const above = [...b.container.querySelectorAll("label")].find((l) => l.textContent?.includes("Above the axis"))!;
    fireEvent.click(above.querySelector("input")!);
    expect(b.set).toHaveBeenLastCalledWith({ titleAbove: true });
    cleanup();
    const c = rows({}, "right");
    expect(button(c.row, "270°").getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(button(c.row, "270°"));
    expect(c.set).toHaveBeenLastCalledWith({ titleAngle: undefined, titleAbove: undefined });
  });
});
