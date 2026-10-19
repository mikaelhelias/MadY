// @vitest-environment jsdom
// An explicit "Render as" on XY: `plotAs` = auto | line | points | area.
//
// line / points put in one control what Connect = None and Shape = None also do. area gives
// that one series an area fill (`areaPath`) on an ordinary XY plot, without the whole plot being
// of kind `area`. `plotAs` is the coarse choice and beats Connect/Shape;
// the Inspector hides the Line group for a points series and shows the area fill for an area one.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { buildPlotScene } from "@mady/graphics";
import type { DataTable, Plot, SeriesStyle } from "@mady/core";
import { Inspector } from "./Inspector";

afterEach(cleanup);
const SIZE = { width: 640, height: 460 };
const t: DataTable = {
  id: "t", kind: "xy", name: "T",
  columns: [
    { id: "x", name: "X", role: "x" },
    { id: "a", name: "A", role: "y" },
    { id: "b", name: "B", role: "y" },
  ],
  rows: [
    { id: "r1", cells: { x: 1, a: 2, b: 5 } },
    { id: "r2", cells: { x: 2, a: 6, b: 4 } },
    { id: "r3", cells: { x: 3, a: 4, b: 7 } },
    { id: "r4", cells: { x: 4, a: 8, b: 6 } },
  ],
};
const plot = (styles: Record<string, SeriesStyle>, over: Partial<Plot> = {}): Plot =>
  ({ id: "p", name: "P", source: "t", kind: "xy", seriesStyles: styles, ...over }) as Plot;
const series = (p: Plot, id: string) => buildPlotScene(t, p, SIZE).series.find((s) => s.id === id)!;

describe("XY Render as — builder", () => {
  it("auto keeps markers + line; line hides the markers; points drops the line", () => {
    const auto = series(plot({}), "a");
    expect(auto.linePath).toMatch(/^M/);
    expect(auto.symbol).not.toBe("none");
    const line = series(plot({ a: { plotAs: "line", symbol: "square" } }), "a");
    expect(line.symbol).toBe("none");
    expect(line.linePath).toMatch(/^M/);
    const pts = series(plot({ a: { plotAs: "points", connect: "straight" } }), "a");
    expect(pts.linePath).toBe("");
    expect(pts.symbol).not.toBe("none");
  });

  it("area: this series gets a closed fill down to the baseline on an ordinary xy plot; the other series is untouched", () => {
    const a = series(plot({ a: { plotAs: "area" } }), "a");
    expect(a.areaPath ?? "").toMatch(/^M/);
    expect(a.areaPath!.trim().endsWith("Z")).toBe(true);
    expect(a.linePath).toMatch(/^M/);
    const b = series(plot({ a: { plotAs: "area" } }), "b");
    expect(b.areaPath ?? "").toBe("");
    // the fill reaches the value-0 baseline: the lowest fill edge sits below every mark
    const ys = (a.areaPath!.match(/-?\d+(\.\d+)?/g) ?? []).map(Number).filter((_, i) => i % 2 === 1);
    expect(Math.max(...ys)).toBeGreaterThan(Math.max(...a.marks.map((m) => m.cy)));
  });

  it("refuses area on a log Y axis — no finite baseline — with a warning that says so", () => {
    const scene = buildPlotScene(t, plot({ a: { plotAs: "area" } }, { yAxis: { scale: "log10" } }), SIZE);
    expect(scene.series.find((s) => s.id === "a")!.areaPath ?? "").toBe("");
    expect(scene.warnings.some((w) => /area/i.test(w) && /log/i.test(w))).toBe(true);
  });
});

describe("XY Render as — Inspector", () => {
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
  const panel = (p: Plot, part: "points" | "line" = "points") => {
    const { container } = render(
      <Inspector activeSection="graphs" selection={{ kind: "series", columnId: "a", part } as never} plot={p} table={t}
        userPresets={[]} profileDefault={null} wholeGraph={false} onSetWholeGraph={() => {}} {...handlers()} />,
    );
    const labels = [...container.querySelectorAll("label > span:first-child")].map((e) => (e.textContent ?? "").trim());
    const renderAs = [...container.querySelectorAll("label")].find((l) => (l.querySelector("span:first-child")?.textContent ?? "").trim() === "Render as");
    const options = renderAs ? [...renderAs.querySelectorAll("option")].map((o) => (o.textContent ?? "").trim()) : [];
    return { labels, options };
  };

  it("'Render as' is on the xy series panel with Auto / Line / Points / Area", () => {
    const { options } = panel(plot({}));
    expect(options).toEqual(["Auto (markers + line)", "Line only", "Points only", "Area"]);
  });

  it("points hides the Line group; line hides the marker group; area shows the fill group", () => {
    expect(panel(plot({ a: { plotAs: "points" } })).labels).not.toContain("Connect");
    cleanup();
    expect(panel(plot({ a: { plotAs: "line" } })).labels).not.toContain("Shape");
    cleanup();
    const area = panel(plot({ a: { plotAs: "area" } }));
    expect(area.labels).toContain("Style"); // the "Area fill" group's first row
    expect(area.labels).toContain("Connect");
  });
});
