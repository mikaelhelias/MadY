// @vitest-environment jsdom
// Stacked flow — options on existing kinds, not new kinds:
//  · area has AreaStack "stream" (the streamgraph's centred baseline —
//    smoothing is the per-series Connect curve, event lines are vlines),
//  · bar has BarLayout "percent" (100%-stacked relative-abundance bars),
//  · stacked/percent bars have `barRibbons` — translucent ribbons joining each series'
//    segment to the same series' segment in the next category (an alluvial-linked look).
//    Ribbons ride the SeriesScene.bandPath field.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import type { DataTable, Plot } from "@mady/core";
import { buildPlotScene, type PlotScene } from "@mady/graphics";
import { Inspector } from "./Inspector";

afterEach(cleanup);

/** Linear data-value → pixel via the axis' own major ticks (linear scales only). */
const pxOf = (scene: PlotScene, v: number): number => {
  const t = scene.y.ticks.filter((tk) => !tk.minor);
  const a = t[0]!;
  const b = t[t.length - 1]!;
  return a.pos + ((v - a.value) * (b.pos - a.pos)) / (b.value - a.value);
};

// --- fixtures -------------------------------------------------------------------------

/** XY table, 2 series over 2 x positions: a=[2,4], b=[6,4] → column totals 8, 8. */
const areaTable: DataTable = {
  id: "t", kind: "xy", name: "T",
  columns: [
    { id: "x", name: "Time", role: "x" },
    { id: "a", name: "A", role: "y" },
    { id: "b", name: "B", role: "y" },
  ],
  rows: [
    { id: "r1", cells: { x: 1, a: 2, b: 6 } },
    { id: "r2", cells: { x: 2, a: 4, b: 4 } },
  ],
};
const areaPlot = (over: Partial<Plot> = {}): Plot => ({
  id: "p", name: "S", source: "t", status: "ok", styleOverrides: {}, kind: "area", ...over,
});

/** Grouped-style bar table: 2 categories × 2 series. A: 10+30=40 · B: 45+15=60. */
const barTable: DataTable = {
  id: "t", kind: "column", name: "T",
  columns: [
    { id: "x", name: "Group", role: "x" },
    { id: "u", name: "Firm", role: "y" },
    { id: "v", name: "Bact", role: "y" },
  ],
  rows: [
    { id: "rA", cells: { x: "A", u: 10, v: 30 } },
    { id: "rB", cells: { x: "B", u: 45, v: 15 } },
  ],
};
const barPlot = (over: Partial<Plot> = {}): Plot => ({
  id: "p", name: "W", source: "t", status: "ok", styleOverrides: {}, kind: "bar", ...over,
});

/** First "M x y" point of an SVG path. */
const firstPoint = (d: string): [number, number] => {
  const m = /M\s*([-\d.]+)[ ,]+([-\d.]+)/.exec(d);
  expect(m, `no M point in path: ${d.slice(0, 60)}`).toBeTruthy();
  return [Number(m![1]), Number(m![2])];
};

// --- 1. area "stream" ------------------------------------------------------------------

describe("areaStack 'stream' — the centred streamgraph baseline", () => {
  it("centres each column: every series' top sits at (cumulative − total/2)", () => {
    const scene = buildPlotScene(areaTable, areaPlot({ areaStack: "stream" }));
    expect(scene.warnings).toEqual([]);
    const [sA, sB] = scene.series;
    // totals 8,8 → offset 4. A tops: 2−4=−2, 4−4=0 · B tops: 8−4=4, 8−4=4.
    expect(sA!.marks[0]!.cy).toBeCloseTo(pxOf(scene, -2), 1);
    expect(sA!.marks[1]!.cy).toBeCloseTo(pxOf(scene, 0), 1);
    expect(sB!.marks[0]!.cy).toBeCloseTo(pxOf(scene, 4), 1);
    expect(sB!.marks[1]!.cy).toBeCloseTo(pxOf(scene, 4), 1);
    // and the filled band exists
    expect(sA!.areaPath).toBeTruthy();
    expect(sB!.areaPath).toBeTruthy();
  });

  it("the y domain reaches the negative half (the bottom series lives below zero)", () => {
    const scene = buildPlotScene(areaTable, areaPlot({ areaStack: "stream" }));
    const values = scene.y.ticks.filter((t) => !t.minor).map((t) => t.value);
    expect(Math.min(...values)).toBeLessThan(0);
  });

  it("is a different geometry from 'stacked' — unequal totals centre per column", () => {
    // Note: with equal column totals a stream is a stacked chart with a relabeled axis (a
    // uniform shift), so this fixture's totals differ (8 vs 5) — the case where the
    // stream's midline actually moves.
    const uneven: DataTable = {
      ...areaTable,
      rows: [
        { id: "r1", cells: { x: 1, a: 2, b: 6 } },
        { id: "r2", cells: { x: 2, a: 4, b: 1 } },
      ],
    };
    const stacked = buildPlotScene(uneven, areaPlot({ areaStack: "stacked" }));
    const stream = buildPlotScene(uneven, areaPlot({ areaStack: "stream" }));
    // stream tops at x2: A = 4−2.5 = 1.5, B = 5−2.5 = 2.5 (each column centred on its own total)
    expect(stream.series[0]!.marks[1]!.cy).toBeCloseTo(pxOf(stream, 1.5), 1);
    expect(stream.series[1]!.marks[1]!.cy).toBeCloseTo(pxOf(stream, 2.5), 1);
    // and that is a genuinely different picture from stacked (B's top: 5 of [0,8] vs 2.5 of [−4,4])
    expect(stream.series[1]!.marks[1]!.cy).not.toBeCloseTo(stacked.series[1]!.marks[1]!.cy, 0);
  });
});

// --- 2. bar "percent" ------------------------------------------------------------------

describe("barLayout 'percent' — 100%-stacked bars", () => {
  it("normalises each category to 100: shares are drawn, the top bar reaches 100", () => {
    const scene = buildPlotScene(barTable, barPlot({ barLayout: "percent" }));
    expect(scene.warnings).toEqual([]);
    const [sU, sV] = scene.series;
    // A: 10/40, 30/40 → 25/75 · B: 45/60, 15/60 → 75/25
    expect(sU!.marks.map((m) => m.dy)).toEqual([25, 75]);
    expect(sV!.marks.map((m) => m.dy)).toEqual([75, 25]);
    // the topmost segment's top edge sits at the 100 line in both categories
    for (const m of sV!.marks) expect(m.bar!.y).toBeCloseTo(pxOf(scene, 100), 1);
  });

  it("a negative value cannot claim a share — drawn as 0, with a warning", () => {
    const neg: DataTable = {
      ...barTable,
      rows: [
        { id: "rA", cells: { x: "A", u: -5, v: 20 } },
        { id: "rB", cells: { x: "B", u: 10, v: 10 } },
      ],
    };
    const scene = buildPlotScene(neg, barPlot({ barLayout: "percent" }));
    expect(scene.warnings.some((w) => /negative/i.test(w))).toBe(true);
    expect(scene.series[0]!.marks[0]!.bar!.h).toBeCloseTo(0, 1);
    // the positive series still fills the whole column
    expect(scene.series[1]!.marks[0]!.dy).toBe(100);
  });

  it("sorting composes: barSort orders by the raw totals, then normalises", () => {
    const scene = buildPlotScene(barTable, barPlot({ barLayout: "percent", barSort: "desc" }));
    // raw totals A=40, B=60 → desc puts B first (after normalising both read 100)
    const labels = scene.x.ticks.filter((t) => !t.minor).map((t) => t.label);
    expect(labels).toEqual(["B", "A"]);
  });

  it("a simple Column table refuses percent like it refuses stacked (nothing to stack)", () => {
    const simple: DataTable = {
      id: "t", kind: "column", name: "T",
      columns: [
        { id: "x", name: "", role: "x" },
        { id: "u", name: "Ctrl", role: "y" },
        { id: "v", name: "Drug", role: "y" },
      ],
      rows: [
        { id: "r1", cells: { x: "", u: 3, v: 5 } },
        { id: "r2", cells: { x: "", u: 4, v: 6 } },
      ],
    };
    const scene = buildPlotScene(simple, barPlot({ barLayout: "percent" }));
    expect(scene.warnings.some((w) => /second grouping factor/i.test(w))).toBe(true);
  });
});

// --- 3. bar ribbons --------------------------------------------------------------------

describe("barRibbons — ribbons joining a series' segments across categories", () => {
  it("off by default: no bandPath, no warning", () => {
    const scene = buildPlotScene(barTable, barPlot({ barLayout: "percent" }));
    for (const s of scene.series) expect(s.bandPath ?? "").toBe("");
  });

  it("draws one ribbon path per series, joining the bars' facing edges exactly", () => {
    const scene = buildPlotScene(barTable, barPlot({ barLayout: "percent", barRibbons: true }));
    expect(scene.warnings).toEqual([]);
    for (const s of scene.series) {
      expect(s.bandPath, `series ${s.id} has no ribbon`).toBeTruthy();
      const bars = s.marks.map((m) => m.bar!);
      const [x0, y0] = firstPoint(s.bandPath!);
      // starts at the right edge of the first bar, at its segment's top edge
      expect(x0).toBeCloseTo(bars[0]!.x + bars[0]!.w, 1);
      expect(y0).toBeCloseTo(bars[0]!.y, 1);
      // and reaches the left edge of the next bar (its x appears in the path)
      expect(s.bandPath!).toContain(String(Math.round(bars[1]!.x * 10) / 10).slice(0, 4));
    }
    // default opacity
    expect(scene.series[0]!.bandOpacity).toBeCloseTo(0.45, 3);
  });

  it("honours the opacity option", () => {
    const scene = buildPlotScene(
      barTable,
      barPlot({ barLayout: "stacked", barRibbons: true, barRibbonOpacity: 0.8 }),
    );
    expect(scene.series[0]!.bandOpacity).toBeCloseTo(0.8, 3);
  });

  it("works on horizontal stacked bars (ribbons flow down the category axis)", () => {
    const scene = buildPlotScene(
      barTable,
      barPlot({ barLayout: "percent", barRibbons: true, barOrientation: "horizontal" }),
    );
    const s = scene.series[0]!;
    expect(s.bandPath).toBeTruthy();
    const bars = s.marks.map((m) => m.bar!);
    const [x0, y0] = firstPoint(s.bandPath!);
    // starts at the bottom edge of the first category's bar, at its segment's left edge
    expect(y0).toBeCloseTo(bars[0]!.y + bars[0]!.h, 1);
    expect(x0).toBeCloseTo(bars[0]!.x, 1);
  });

  it("grouped / overlay layouts refuse with a warning (no stratum edges to join)", () => {
    for (const layout of ["grouped", "overlay"] as const) {
      const scene = buildPlotScene(barTable, barPlot({ barLayout: layout, barRibbons: true }));
      expect(scene.warnings.some((w) => /ribbon/i.test(w)), `${layout} must warn`).toBe(true);
      for (const s of scene.series) expect(s.bandPath ?? "").toBe("");
    }
  });
});

// --- 4. the bar legend key is the bar, not a point marker ----------

import { PlotFigure } from "./PlotFigure";

describe("bar legend key — a fill block, never the swarm-dot marker", () => {
  const legendOn = (over: Partial<Plot> = {}): Plot =>
    barPlot({ legend: { show: true }, ...over });

  it("the builder stamps swatch 'bar' on bar rows; a plotAs-line row keeps the stub+dot", () => {
    const scene = buildPlotScene(barTable, legendOn({ seriesStyles: { v: { plotAs: "line" } } }));
    const rows = Object.fromEntries(scene.legend.map((e) => [e.label, e]));
    expect(rows["Firm"]!.swatch).toBe("bar");
    expect(rows["Bact"]!.swatch).toBeUndefined();
  });

  it("renders the block with the series' resolved bar fill — no Marker dot in the row", () => {
    const scene = buildPlotScene(barTable, legendOn({ seriesStyles: { u: { fillColor: "#123456" } } }));
    const { container } = render(<PlotFigure scene={scene} zoom={1} />);
    const blocks = [...container.querySelectorAll("rect.gfx-legbar")];
    expect(blocks).toHaveLength(2);
    expect(blocks.some((b) => b.getAttribute("fill") === "#123456")).toBe(true);
  });

  it("the block is font-sized: a huge point size must not inflate the key", () => {
    const small = buildPlotScene(barTable, legendOn());
    const big = buildPlotScene(barTable, legendOn({ seriesStyles: { u: { symbolSize: 14 }, v: { symbolSize: 14 } } }));
    const h = (s: typeof small) =>
      Number(render(<PlotFigure scene={s} zoom={1} />).container.querySelector("rect.gfx-legbar")!.getAttribute("height"));
    expect(h(big)).toBeCloseTo(h(small), 3);
    // and the reservation ignores it too — no oversized swatch column
    expect(big.legendLayout.swatchWidth).toBeCloseTo(small.legendLayout.swatchWidth, 3);
  });

  it("an XY legend is untouched — its key still follows the point size", () => {
    const xyPlot: Plot = {
      id: "p", name: "X", source: "t", status: "ok", styleOverrides: {}, kind: "xy",
      legend: { show: true },
    };
    const scene = buildPlotScene(areaTable, xyPlot);
    expect(scene.legend.every((e) => e.swatch === undefined)).toBe(true);
    const { container } = render(<PlotFigure scene={scene} zoom={1} />);
    expect(container.querySelector("rect.gfx-legbar")).toBeNull();
  });
});

// --- 5. the Inspector controls ---------------------------------------------------------

const inspectorHarness = () => {
  const onSetPlotOptions = vi.fn();
  const onSetBarLayout = vi.fn();
  const h = {
    onSelect: vi.fn(), onSetAxis: vi.fn(), onSetAxisLength: vi.fn(), onSetAxisTitleFont: vi.fn(),
    onSetSeriesStyle: vi.fn(), onSetSeriesStyleAll: vi.fn(), onSetPointStyle: vi.fn(), onClearPointStyles: vi.fn(),
    onSetGrid: vi.fn(), onSetFrame: vi.fn(), onSetKind: vi.fn(), onSetBarLayout, onSetBarShape: vi.fn(), onSetBoxWhisker: vi.fn(),
    onSetPlotOptions, onSetGraphTitle: vi.fn(), onSetPlotFont: vi.fn(), onHomogenizeFont: vi.fn(),
    onSetLegend: vi.fn(), onSetSignificance: vi.fn(), onApplyPreset: vi.fn(), 
    onApplyUserPreset: vi.fn(), onSaveUserPreset: vi.fn(), onDeleteUserPreset: vi.fn(), onSetProfileDefault: vi.fn(),
    annotationOps: { add: vi.fn(), update: vi.fn(), remove: vi.fn(), reorder: vi.fn(), align: vi.fn(), group: vi.fn(), ungroup: vi.fn(), setLocked: vi.fn(), addImage: vi.fn(), replaceImage: vi.fn() },
  };
  return { h, onSetPlotOptions, onSetBarLayout };
};

const rowByLabel = (container: HTMLElement, label: string) =>
  [...container.querySelectorAll("label")].find(
    (l) => (l.querySelector("span:first-child")?.textContent ?? "").trim() === label,
  );

describe("the Inspector controls", () => {
  it("Bars select offers Stacked 100%", () => {
    const { h, onSetBarLayout } = inspectorHarness();
    const { container } = render(
      <Inspector activeSection="graphs" selection={{ kind: "plot" }} plot={barPlot()} table={barTable}
        userPresets={[]} profileDefault={null} wholeGraph={false} onSetWholeGraph={() => {}} {...h} />,
    );
    const row = rowByLabel(container, "Bars");
    expect(row, "no Bars control").toBeTruthy();
    const opts = [...row!.querySelectorAll("option")].map((o) => o.getAttribute("value"));
    expect(opts).toContain("percent");
    fireEvent.change(row!.querySelector("select")!, { target: { value: "percent" } });
    expect(onSetBarLayout.mock.calls.at(-1)![0]).toBe("percent");
  });

  it("Connect stacks (stacked/percent only) writes barRibbons; opacity slider follows", () => {
    const { h, onSetPlotOptions } = inspectorHarness();
    const { container } = render(
      <Inspector activeSection="graphs" selection={{ kind: "plot" }}
        plot={barPlot({ barLayout: "percent" })} table={barTable}
        userPresets={[]} profileDefault={null} wholeGraph={false} onSetWholeGraph={() => {}} {...h} />,
    );
    const row = rowByLabel(container, "Connect stacks");
    expect(row, "no Connect stacks control").toBeTruthy();
    fireEvent.click(row!.querySelector("input[type=checkbox]")!);
    expect((onSetPlotOptions.mock.calls.at(-1)![0] as Partial<Plot>).barRibbons).toBe(true);
    // hidden on grouped (there is nothing it could draw there)
    const { container: c2 } = render(
      <Inspector activeSection="graphs" selection={{ kind: "plot" }} plot={barPlot()} table={barTable}
        userPresets={[]} profileDefault={null} wholeGraph={false} onSetWholeGraph={() => {}} {...h} />,
    );
    expect(rowByLabel(c2, "Connect stacks")).toBeFalsy();
  });

  it("area Stacking select offers Stream (centred)", () => {
    const { h, onSetPlotOptions } = inspectorHarness();
    const { container } = render(
      <Inspector activeSection="graphs" selection={{ kind: "plot" }} plot={areaPlot()} table={areaTable}
        userPresets={[]} profileDefault={null} wholeGraph={false} onSetWholeGraph={() => {}} {...h} />,
    );
    const row = rowByLabel(container, "Stacking");
    expect(row, "no Stacking control").toBeTruthy();
    const opts = [...row!.querySelectorAll("option")].map((o) => o.getAttribute("value"));
    expect(opts).toContain("stream");
    fireEvent.change(row!.querySelector("select")!, { target: { value: "stream" } });
    expect((onSetPlotOptions.mock.calls.at(-1)![0] as Partial<Plot>).areaStack).toBe("stream");
  });
});
