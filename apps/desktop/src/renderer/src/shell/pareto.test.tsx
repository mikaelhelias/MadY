// @vitest-environment jsdom
// Pareto: a bar-chart option, not a kind.
// `plot.paretoLine` adds a derived cumulative-% line over the bars on a right-hand 0–100 % axis,
// following the drawn category order (Sort bars = Largest first gives the classic Pareto; any
// order is honoured). The line is chrome (a readout of the bars), clickable to "Chart type",
// with its own colour. On horizontal bars it is not drawn and the graph shows a warning saying
// why (there is no second value axis there).
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { buildPlotScene } from "@mady/graphics";
import type { DataTable, Plot } from "@mady/core";
import { PlotFigure } from "./PlotFigure";
import { Inspector } from "./Inspector";
import { galleryItems } from "./gallery";
import { NEW_GRAPH_GENRES } from "./newGraph";

afterEach(cleanup);
const SIZE = { width: 640, height: 460 };
const t: DataTable = {
  id: "t", kind: "column", name: "Defects",
  columns: [
    { id: "g", name: "Cause", role: "x" },
    { id: "n", name: "Count", role: "y" },
  ],
  rows: [
    { id: "r1", cells: { g: "Scratch", n: 10 } },
    { id: "r2", cells: { g: "Dent", n: 40 } },
    { id: "r3", cells: { g: "Crack", n: 25 } },
    { id: "r4", cells: { g: "Stain", n: 20 } },
    { id: "r5", cells: { g: "Other", n: 5 } },
  ],
};
type PLine = { path: string; color: string; width: number; points: { cx: number; cy: number; value: number; label: string }[] };
const plot = (over: Partial<Plot> = {}): Plot => ({ id: "p", name: "P", source: "t", kind: "bar", ...over }) as Plot;
const pareto = (scene: ReturnType<typeof buildPlotScene>): PLine | undefined => (scene as unknown as { paretoLine?: PLine }).paretoLine;

describe("Pareto cumulative-% line — builder", () => {
  it("off by default; on, a derived line over the bars on a 0–100 % right axis, cumulative in the drawn order", () => {
    expect(pareto(buildPlotScene(t, plot(), SIZE))).toBeUndefined();
    const scene = buildPlotScene(t, plot({ barSort: "desc", paretoLine: true }), SIZE);
    const pl = pareto(scene)!;
    expect(pl).toBeDefined();
    expect(pl.path).toMatch(/^M/);
    expect(scene.y2).toBeDefined();
    expect(scene.y2!.domain).toEqual([0, 100]);
    expect(scene.y2!.title).toBe("Cumulative %");
    // sorted desc: 40, 25, 20, 10, 5 → 40, 65, 85, 95, 100
    expect(pl.points.map((p) => p.label)).toEqual(["Dent", "Crack", "Stain", "Scratch", "Other"]);
    expect(pl.points.map((p) => Math.round(p.value))).toEqual([40, 65, 85, 95, 100]);
    // each point sits on its bar's centre and on the Y2 scale (the last one at the 100 % tick = plot top)
    const bars = scene.series[0]!.marks;
    pl.points.forEach((p, i) => expect(p.cx).toBeCloseTo(bars[i]!.cx, 3));
    expect(pl.points[pl.points.length - 1]!.cy).toBeCloseTo(scene.plot.y, 0);
    expect(scene.warnings).toEqual([]);
  });

  it("without a sort it still follows the table order and ends at 100 %", () => {
    const pl = pareto(buildPlotScene(t, plot({ paretoLine: true }), SIZE))!;
    expect(pl.points.map((p) => Math.round(p.value))).toEqual([10, 50, 75, 95, 100]);
  });

  it("colour is the option's own; the legend gains a 'Cumulative %' row that opens Chart type", () => {
    const scene = buildPlotScene(t, plot({ paretoLine: true, paretoLineColor: "#ab12cd", legend: { show: true } }), SIZE);
    expect(pareto(scene)!.color).toBe("#ab12cd");
    const row = scene.legend.find((e) => e.label === "Cumulative %");
    expect(row).toBeDefined();
    expect(row!.select).toEqual({ as: "section", id: "Chart type" });
    expect(row!.marker).toBe(false);
  });

  it("the legend clears the Y2 axis: the layout reserves the axis' width between the plot edge and the legend", () => {
    // Guards against the legend's first row sitting on the "100" tick label: the bar builder
    // reserves the Y2 width in marginRight and must also pass it to the legend layout
    // (outsidePad), as the XY builder does. Applies to any bars + Y2 chart with a legend.
    const scene = buildPlotScene(t, plot({ barSort: "desc", paretoLine: true, legend: { show: true } }), SIZE);
    expect(scene.y2).toBeDefined();
    const labelW = Math.max(...scene.y2!.ticks.filter((k) => !k.minor).map((k) => k.label.length)) * 4; // a floor, font-agnostic
    expect(scene.legendLayout.outsidePad ?? 0, "legend outsidePad must cover the Y2 axis").toBeGreaterThanOrEqual(labelW);
  });

  // Note: a horizontal bar has a second axis (along the top), but the Pareto line is drawn on
  // vertical bars only.
  it("refuses on a horizontal bar — the line is drawn on vertical bars only — and says so", () => {
    const scene = buildPlotScene(t, plot({ paretoLine: true, barOrientation: "horizontal" }), SIZE);
    expect(pareto(scene)).toBeUndefined();
    expect(scene.warnings.some((w) => /cumulative/i.test(w) && /horizontal/i.test(w))).toBe(true);
  });
});

describe("Pareto line — renderer", () => {
  it("draws the line and routes a click to the Chart-type block", () => {
    const scene = buildPlotScene(t, plot({ barSort: "desc", paretoLine: true }), SIZE);
    const onSelect = vi.fn();
    const { container } = render(<PlotFigure scene={scene} zoom={1} onSelect={onSelect} />);
    expect(container.querySelector(".gfx-pareto")).not.toBeNull();
    const hit = container.querySelector(".gfx-pareto-hit");
    expect(hit).not.toBeNull();
    fireEvent.click(hit!);
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ kind: "chart-section", title: "Chart type" }));
  });
});

describe("Pareto line — Inspector", () => {
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
  const panel = (p: Plot) => {
    const h = handlers();
    const r = render(
      <Inspector activeSection="graphs" selection={{ kind: "chart-section", title: "Chart type" } as never} plot={p} table={t}
        userPresets={[]} profileDefault={null} wholeGraph={false} onSetWholeGraph={() => {}} {...h} />,
    );
    const labels = [...r.container.querySelectorAll("label > span:first-child")].map((e) => (e.textContent ?? "").trim());
    const tick = (text: string): HTMLInputElement | null => {
      for (const lab of r.container.querySelectorAll("label")) {
        if ((lab.querySelector("span:first-child")?.textContent ?? "").trim() === text) return lab.querySelector("input");
      }
      return null;
    };
    return { labels, tick, h };
  };

  it("'Cumulative % line' sits beside 'Sort bars' on a vertical bar; its colour row appears only when on", () => {
    const off = panel(plot());
    expect(off.labels).toContain("Sort bars");
    expect(off.labels).toContain("Cumulative % line");
    expect(off.labels).not.toContain("Line colour");
    expect(off.labels.indexOf("Cumulative % line")).toBe(off.labels.indexOf("Sort bars") + 1);
    fireEvent.click(off.tick("Cumulative % line")!);
    expect(off.h.onSetPlotOptions).toHaveBeenCalledWith({ paretoLine: true });
    cleanup();
    expect(panel(plot({ paretoLine: true })).labels).toContain("Line colour");
    cleanup();
    // hidden on a horizontal bar, where the builder refuses it
    expect(panel(plot({ barOrientation: "horizontal" })).labels).not.toContain("Cumulative % line");
  });
});

describe("Pareto — discoverable from both doors", () => {
  it("a gallery card and a New-graph genre, both = sort largest-first + the cumulative line", () => {
    const card = galleryItems().find((g) => g.key === "pareto");
    expect(card).toBeDefined();
    expect(card!.plot.kind).toBe("bar");
    expect(card!.plot.barSort).toBe("desc");
    expect(card!.plot.paretoLine).toBe(true);
    expect(pareto(buildPlotScene(card!.table as DataTable, card!.plot as Plot, SIZE))).toBeDefined();
    const genre = NEW_GRAPH_GENRES.find((g) => g.key === "pareto");
    expect(genre).toBeDefined();
    expect(genre!.plotKind).toBe("bar");
    expect(genre!.plotPatch?.barSort).toBe("desc");
    expect(genre!.plotPatch?.paretoLine).toBe(true);
  });
});
