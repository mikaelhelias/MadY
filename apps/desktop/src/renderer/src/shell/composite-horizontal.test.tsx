// @vitest-environment jsdom
// Composite series on horizontal bars: they honour `plotAs` (line / points / area, transposed).
//
// The horizontal bar branch is separate code from the vertical one. The value axis is X, so
// the line runs down the categories through each mark's value pixel, the area fills from the
// value-0 X back to each value, and points keep the swarm (spread down the bar's thickness).
// `axis:"y2"` draws the second value axis along the top (bar-horizontal-top-axis.test.ts).
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { buildPlotScene } from "@mady/graphics";
import type { DataTable, Plot, SeriesStyle } from "@mady/core";
import { Inspector } from "./Inspector";
import { galleryItems } from "./gallery";

afterEach(cleanup);
const SIZE = { width: 640, height: 460 };
const t3: DataTable = {
  id: "t3", kind: "column", name: "T3",
  columns: [
    { id: "g", name: "Group", role: "x" },
    { id: "bar", name: "Sales", role: "y" },
    { id: "line", name: "Trend", role: "y" },
  ],
  rows: [
    { id: "r1", cells: { g: "A", bar: 2, line: 3 } },
    { id: "r2", cells: { g: "B", bar: 6, line: 5 } },
    { id: "r3", cells: { g: "C", bar: 10, line: 4 } },
  ],
};
const hplot = (styles: Record<string, SeriesStyle>, over: Partial<Plot> = {}): Plot =>
  ({ id: "p", name: "P", source: "t3", kind: "bar", barOrientation: "horizontal", seriesStyles: styles, ...over }) as Plot;
const ser = (p: Plot, id: string) => buildPlotScene(t3, p, SIZE).series.find((s) => s.id === id)!;
const nums = (path: string): number[] => (path.match(/-?\d+(\.\d+)?/g) ?? []).map(Number);

describe("horizontal composite — builder", () => {
  it("line: rects dropped, a path down the categories through each value pixel", () => {
    const s = ser(hplot({ line: { plotAs: "line" } }), "line");
    expect(s.marks.every((m) => m.bar === undefined)).toBe(true);
    expect(s.overlayLine ?? "").toMatch(/^M/);
    const xs = nums(s.overlayLine!).filter((_, i) => i % 2 === 0);
    const ys = nums(s.overlayLine!).filter((_, i) => i % 2 === 1);
    // transposed: the categories run down Y (monotonic), the values vary along X
    expect(ys).toEqual([...ys].sort((a, b) => a - b));
    expect(new Set(xs.map((x) => Math.round(x))).size).toBeGreaterThan(1);
    // the other series still draws bars
    expect(ser(hplot({ line: { plotAs: "line" } }), "bar").marks.every((m) => m.bar !== undefined)).toBe(true);
  });

  it("points: rects dropped, one marker at the mean per category (summary data)", () => {
    const s = ser(hplot({ line: { plotAs: "points" } }), "line");
    expect(s.marks.every((m) => m.bar === undefined)).toBe(true);
    for (const m of s.marks) {
      expect(m.points).toHaveLength(1);
      expect(m.points![0]!.cx).toBeCloseTo(m.cx, 3);
      expect(m.points![0]!.cy).toBeCloseTo(m.cy, 3);
    }
  });

  it("area: a closed fill from the value-0 X back to each category's value", () => {
    const plainBar = ser(hplot({}), "line").marks[0]!.bar!;
    const baselineX = plainBar.x; // a positive horizontal bar starts at value 0
    const s = ser(hplot({ line: { plotAs: "area" } }), "line");
    expect(s.marks.every((m) => m.bar === undefined)).toBe(true);
    expect(s.areaPath ?? "").toMatch(/^M/);
    expect(s.areaPath!.trim().endsWith("Z")).toBe(true);
    const xs = nums(s.areaPath!).filter((_, i) => i % 2 === 0);
    expect(Math.min(...xs)).toBeCloseTo(baselineX, 0);
    expect(Math.max(...xs)).toBeCloseTo(Math.max(...s.marks.map((m) => m.cx)), 0);
    expect(s.overlayLine ?? "").toMatch(/^M/);
  });

  // The second axis on horizontal bars runs along the top (bar-horizontal-top-axis.test.ts has
  // the detail).
  it("axis:'y2' on a horizontal bar draws a top second axis, titled as typed, and refuses nothing", () => {
    const scene = buildPlotScene(t3, hplot({ line: { plotAs: "line", axis: "y2" } }, { y2Axis: { title: "Price" } }), SIZE);
    expect(scene.y2?.side).toBe("top");
    expect(scene.y2!.title).toBe("Price");
    expect(scene.warnings.some((w) => /second value axis|right-hand axis/i.test(w))).toBe(false);
    // the line half still works
    expect(scene.series.find((s) => s.id === "line")!.overlayLine ?? "").toMatch(/^M/);
  });
});

describe("horizontal composite — Inspector", () => {
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
  const labels = (p: Plot, table: DataTable, columnId: string): string[] => {
    const { container } = render(
      <Inspector activeSection="graphs" selection={{ kind: "series", columnId, part: "points" } as never} plot={p} table={table}
        userPresets={[]} profileDefault={null} wholeGraph={false} onSetWholeGraph={() => {}} {...handlers()} />,
    );
    return [...container.querySelectorAll("label > span:first-child")].map((e) => (e.textContent ?? "").trim());
  };

  // A horizontal bar's second axis is its top axis, so the "Value axis" row reads Bottom / Top.
  it("a horizontal bar offers 'Render as' and 'Value axis' — Bottom, or Top (2nd axis)", () => {
    const l = labels(hplot({}), t3, "line");
    expect(l).toContain("Render as");
    expect(l).toContain("Value axis");
    cleanup();
    const { container } = render(
      <Inspector activeSection="graphs" selection={{ kind: "series", columnId: "line", part: "points" } as never} plot={hplot({})} table={t3}
        userPresets={[]} profileDefault={null} wholeGraph={false} onSetWholeGraph={() => {}} {...handlers()} />,
    );
    const row = [...container.querySelectorAll("label")].find((el) => (el.querySelector("span:first-child")?.textContent ?? "").trim() === "Value axis");
    expect([...row!.querySelectorAll("option")].map((o) => o.textContent)).toEqual(["Bottom", "Top (2nd axis)"]);
  });

  it("a horizontal histogram offers 'Render as' — its line overlay draws", () => {
    const g = galleryItems().find((x) => (x.plot.kind ?? "xy") === "histogram")!;
    const horiz: Plot = { ...(g.plot as Plot), barOrientation: "horizontal" };
    const id = buildPlotScene(g.table as DataTable, horiz, SIZE).series[0]!.id;
    expect(labels(horiz, g.table as DataTable, id)).toContain("Render as");
    const styled: Plot = { ...horiz, seriesStyles: { [id]: { plotAs: "line" } } };
    expect(buildPlotScene(g.table as DataTable, styled, SIZE).series[0]!.overlayLine ?? "").toMatch(/^M/);
  });
});
