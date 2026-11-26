// @vitest-environment jsdom
// Composite charts — `plotAs` "points" and "area" on a vertical bar chart.
//
// points = the series drops its rects and keeps its dots: the replicate swarm when the data
//          has replicates, one marker at the mean when it is summary data.
// area   = the series drops its rects and fills from its category values down to the baseline
//          (the XY area's d3area through the category centres), with the line along the top.
// Z-order: area → bars → line/points, so an area never hides the bars and a line always rides
// on top. Refused with a warning on stacked/percent layouts; a one-category line/points/area
// warns instead of silently drawing nothing.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { buildPlotScene } from "@mady/graphics";
import type { DataTable, Plot, SeriesStyle } from "@mady/core";
import { PlotFigure } from "./PlotFigure";
import { Inspector } from "./Inspector";
import { galleryItems } from "./gallery";

afterEach(cleanup);
const SIZE = { width: 640, height: 460 };

/** Summary data: one value per category per series (rows = categories). */
const t3: DataTable = {
  id: "t3", kind: "column", name: "T3",
  columns: [
    { id: "g", name: "Group", role: "x" },
    { id: "bar", name: "Sales", role: "y" },
    { id: "line", name: "Trend", role: "y" },
    { id: "area", name: "Capacity", role: "y" },
  ],
  rows: [
    { id: "r1", cells: { g: "A", bar: 2, line: 3, area: 5 } },
    { id: "r2", cells: { g: "B", bar: 6, line: 5, area: 8 } },
    { id: "r3", cells: { g: "C", bar: 10, line: 4, area: 12 } },
  ],
};
const oneCat: DataTable = { ...t3, id: "t1", rows: [t3.rows[0]!] };
const plot = (styles: Record<string, SeriesStyle>, over: Partial<Plot> = {}, source = "t3"): Plot =>
  ({ id: "p", name: "P", source, kind: "bar", seriesStyles: styles, ...over }) as Plot;
const nums = (path: string): number[] => (path.match(/-?\d+(\.\d+)?/g) ?? []).map(Number);

describe("plotAs points / area — builder", () => {
  it("points: rects dropped, one marker at the mean per category on summary data", () => {
    const plain = buildPlotScene(t3, plot({}), SIZE);
    const s = buildPlotScene(t3, plot({ line: { plotAs: "points" } }), SIZE).series.find((x) => x.id === "line")!;
    expect(s.marks.every((m) => m.bar === undefined)).toBe(true);
    expect(s.overlayLine ?? "").toBe("");
    for (const m of s.marks) {
      expect(m.points).toHaveLength(1);
      expect(m.points![0]!.cx).toBeCloseTo(m.cx, 3);
      expect(m.points![0]!.cy).toBeCloseTo(m.cy, 3);
    }
    // the other series still draws bars, at the same heights as before
    const bars = buildPlotScene(t3, plot({ line: { plotAs: "points" } }), SIZE).series.find((x) => x.id === "bar")!;
    expect(bars.marks.every((m) => m.bar !== undefined)).toBe(true);
    expect(bars.marks.map((m) => Math.round(m.cy))).toEqual(plain.series.find((x) => x.id === "bar")!.marks.map((m) => Math.round(m.cy)));
  });

  it("points: on replicate data the swarm is kept (same dots as the bar drew), only the rects go", () => {
    const g = galleryItems().find((x) => (x.plot.kind ?? "xy") === "bar")!;
    const base = { ...(g.plot as Plot), showBarPoints: true, barLayout: "grouped" as const };
    const plain = buildPlotScene(g.table as DataTable, base, SIZE);
    const id = plain.series[0]!.id;
    const swarm = plain.series[0]!.marks.map((m) => m.points?.length ?? 0);
    expect(Math.max(...swarm), "the fixture must carry replicates or this proves nothing").toBeGreaterThan(1);
    const s = buildPlotScene(g.table as DataTable, { ...base, seriesStyles: { ...(base.seriesStyles ?? {}), [id]: { ...(base.seriesStyles?.[id] ?? {}), plotAs: "points" } } }, SIZE).series[0]!;
    expect(s.marks.every((m) => m.bar === undefined)).toBe(true);
    expect(s.marks.map((m) => m.points?.length ?? 0)).toEqual(swarm);
  });

  it("area: rects dropped, a closed fill from the category values down to the baseline, the line along the top", () => {
    const plain = buildPlotScene(t3, plot({}), SIZE);
    const barOf = plain.series.find((x) => x.id === "area")!.marks[0]!.bar!;
    const baseline = barOf.y + barOf.h; // a positive bar's bottom edge = the value-0 pixel
    const s = buildPlotScene(t3, plot({ area: { plotAs: "area" } }), SIZE).series.find((x) => x.id === "area")!;
    expect(s.marks.every((m) => m.bar === undefined)).toBe(true);
    expect(s.areaPath ?? "").toMatch(/^M/);
    expect(s.areaPath!.trim().endsWith("Z")).toBe(true);
    const ys = nums(s.areaPath!).filter((_, i) => i % 2 === 1);
    // the fill touches the baseline at both ends and reaches every category's value
    expect(Math.max(...ys)).toBeCloseTo(baseline, 0);
    expect(Math.min(...ys)).toBeCloseTo(Math.min(...s.marks.map((m) => m.cy)), 0);
    expect(s.overlayLine ?? "").toMatch(/^M/);
  });

  it("refuses on stacked / percent layouts — bars kept, a warning that says why", () => {
    for (const barLayout of ["stacked", "percent"] as const) {
      const scene = buildPlotScene(t3, plot({ line: { plotAs: "points" }, area: { plotAs: "area" } }, { barLayout }), SIZE);
      for (const id of ["line", "area"]) expect(scene.series.find((x) => x.id === id)!.marks.every((m) => m.bar !== undefined), `${barLayout}/${id}`).toBe(true);
      expect(scene.warnings.some((w) => /stacked/i.test(w) && /points|area/i.test(w)), barLayout).toBe(true);
    }
  });

  it("a one-category line / points / area warns instead of silently drawing nothing", () => {
    for (const plotAs of ["line", "points", "area"] as const) {
      const scene = buildPlotScene(oneCat, plot({ line: { plotAs } }, {}, "t1"), SIZE);
      expect(scene.warnings.some((w) => /two categories|2 categories|one category/i.test(w)), plotAs).toBe(true);
    }
    // …and the shipped two-category-plus case does NOT warn
    expect(buildPlotScene(t3, plot({ line: { plotAs: "line" } }), SIZE).warnings.some((w) => /categor/i.test(w))).toBe(false);
  });

  it("legend key follows the render: points → the marker row, area → the fill block", () => {
    const scene = buildPlotScene(t3, plot({ line: { plotAs: "points" }, area: { plotAs: "area" } }, { legend: { show: true } }), SIZE);
    const rows = Object.fromEntries(scene.legend.map((e) => [e.label, e]));
    expect(rows["Sales"]!.swatch).toBe("bar");
    expect(rows["Trend"]!.swatch).toBeUndefined();
    expect(rows["Capacity"]!.swatch).toBe("bar");
  });
});

describe("plotAs points / area — renderer", () => {
  it("draws area → bars → line, so the fill sits behind the bars and the line rides on top", () => {
    const scene = buildPlotScene(t3, plot({ line: { plotAs: "line" }, area: { plotAs: "area" } }), SIZE);
    const { container } = render(<PlotFigure scene={scene} zoom={1} onSelect={vi.fn()} />);
    const order = [...container.querySelectorAll(".gfx-series")].map((g) => g.getAttribute("data-mady-series"));
    expect(order).toEqual(["area", "bar", "line"]);
    // the area series really paints a fill, and the points series really paints dots
    const areaG = container.querySelector('.gfx-series[data-mady-series="area"]')!;
    expect(areaG.querySelector("path[fill]:not([fill='none'])")).not.toBeNull();
    const pts = buildPlotScene(t3, plot({ line: { plotAs: "points" } }), SIZE);
    cleanup();
    const r2 = render(<PlotFigure scene={pts} zoom={1} onSelect={vi.fn()} />);
    const lineG = r2.container.querySelector('.gfx-series[data-mady-series="line"]')!;
    expect(lineG.querySelectorAll("rect").length).toBe(0);
    expect(lineG.querySelectorAll("circle, path.gfx-sym, .gfx-scatter *").length).toBeGreaterThan(0);
  });
});

describe("plotAs points / area — Inspector", () => {
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
  const renderAsOptions = (p: Plot): string[] => {
    const { container } = render(
      <Inspector activeSection="graphs" selection={{ kind: "series", columnId: "line", part: "points" } as never} plot={p} table={t3}
        userPresets={[]} profileDefault={null} wholeGraph={false} onSetWholeGraph={() => {}} {...handlers()} />,
    );
    for (const lab of container.querySelectorAll("label")) {
      if ((lab.querySelector("span:first-child")?.textContent ?? "").trim() !== "Render as") continue;
      return [...lab.querySelectorAll("option")].map((o) => (o.textContent ?? "").trim());
    }
    return [];
  };

  it("'Render as' offers Points and Area on a vertical bar; a stacked bar offers neither", () => {
    expect(renderAsOptions(plot({}))).toEqual(["Bars", "Line (over bars)", "Points", "Area"]);
    cleanup();
    expect(renderAsOptions(plot({}, { barLayout: "stacked" }))).toEqual(["Bars", "Line (over bars)"]);
  });
});
