// @vitest-environment jsdom
/**
 * Bar width per series: Bar width works like Point spread. It sits on the
 * Data tab with a "whole graph" tick box beside it, ticked by default: ticked = every bar (`Plot.barWidth`, the share of
 * the category band); unticked = only the clicked series (`SeriesStyle.barWidth`, its share of its
 * own place in the group — 100 % fills it). A narrower bar keeps its centre, so neighbours never move or overlap.
 * Dragging a bar's edge follows the same tick box. Histogram and UpSet (one series each) keep Bar width on Chart type.
 */
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { tableDatasets, type DataTable, type Plot } from "@mady/core";
import { buildPlotScene } from "@mady/graphics";
import { Inspector } from "./Inspector";
import { galleryItems } from "./gallery";
import { barWidthFromDrag, barWidthShown, barWidthWholeGraph } from "./barWidth";

afterEach(cleanup);
Element.prototype.scrollIntoView = Element.prototype.scrollIntoView ?? (() => {});

const SIZE = { width: 640, height: 420 };
const card = (name: string) => {
  const g = galleryItems().find((x) => x.plot.name === name || x.plot.id === name || (name.startsWith("kind:") && x.plot.kind === name.slice(5)));
  if (!g) throw new Error(`no card ${name}`);
  return { table: g.table as DataTable, plot: g.plot as Plot };
};
const own = (plot: Plot, id: string, w: number) => ({ ...plot, seriesStyles: { ...plot.seriesStyles, [id]: { ...(plot.seriesStyles?.[id] ?? {}), barWidth: w } } }) as Plot;
const bars = (s: ReturnType<typeof buildPlotScene>, id: string) => s.series.find((x) => x.id === id)!.marks.filter((m) => m.bar).map((m) => m.bar!);

describe("bar width per series — the drawing", () => {
  for (const [label, extra] of [["upright", {}], ["horizontal", { barOrientation: "horizontal" }]] as const) {
    it(`${label}: a series' own width narrows only its bars, around the same centre`, () => {
      const c = card("p-bar");
      const [a, b] = tableDatasets(c.table).map((d) => d.id);
      const plot = { ...c.plot, ...extra } as Plot;
      const base = buildPlotScene(c.table, plot, SIZE);
      const after = buildPlotScene(c.table, own(plot, a!, 0.5), SIZE);
      const h = label === "horizontal";
      const size = (r: { w: number; h: number }) => (h ? r.h : r.w);
      const mid = (r: { x: number; y: number; w: number; h: number }) => (h ? r.y + r.h / 2 : r.x + r.w / 2);
      const before = bars(base, a!), now = bars(after, a!);
      expect(before.length, "no bars - this proves nothing").toBeGreaterThan(1);
      now.forEach((r, i) => {
        expect(size(r)).toBeCloseTo(size(before[i]!) * 0.5, 5);
        expect(mid(r)).toBeCloseTo(mid(before[i]!), 5);
      });
      expect(JSON.stringify(bars(after, b!)), "another series moved").toBe(JSON.stringify(bars(base, b!)));
    });
  }

  it("untouched: the scene is exactly what it was", () => {
    const c = card("p-bar");
    expect(JSON.stringify(buildPlotScene(c.table, c.plot, SIZE).series)).toBe(JSON.stringify(buildPlotScene(c.table, { ...c.plot } as Plot, SIZE).series));
    expect(c.plot.seriesStyles && Object.values(c.plot.seriesStyles).some((s) => s?.barWidth !== undefined)).toBeFalsy();
  });

  // Histogram and UpSet share the bar drawing but offer no per-series width (one series each; their drag stays
  // graph-wide), so a series' own width must not reach them — the ability would be one nobody can set.
  it.each(["kind:histogram", "kind:upset"])("%s: a series' own width changes nothing", (name) => {
    const c = card(name);
    // Every id the chart draws (UpSet's bars belong to a series it makes itself, not a data column) and every column.
    const ids = [...new Set([...buildPlotScene(c.table, c.plot, SIZE).series.map((x) => x.id), ...tableDatasets(c.table).map((d) => d.id)])];
    const all = { ...c.plot, seriesStyles: Object.fromEntries(ids.map((id) => [id, { ...(c.plot.seriesStyles?.[id] ?? {}), barWidth: 0.4 }])) } as Plot;
    expect(JSON.stringify(buildPlotScene(c.table, all, SIZE).series)).toBe(JSON.stringify(buildPlotScene(c.table, c.plot, SIZE).series));
  });

  it("the bar's dots stay inside the narrower bar", () => {
    const c = card("p-bar");
    const id = tableDatasets(c.table)[0]!.id;
    const s = buildPlotScene(c.table, own(c.plot, id, 0.4), SIZE);
    let n = 0;
    for (const m of s.series.find((x) => x.id === id)!.marks) for (const p of m.points ?? []) {
      n++;
      expect(p.cx).toBeGreaterThanOrEqual(m.bar!.x - 1e-6);
      expect(p.cx).toBeLessThanOrEqual(m.bar!.x + m.bar!.w + 1e-6);
    }
    expect(n, "the card draws no dots on its bars - this proves nothing").toBeGreaterThan(0);
  });
});

describe("bar width per series — the control, on the Data tab", () => {
  const panel = (plot: Plot, table: DataTable, selection: unknown, wholeGraph = false) => {
    const onSetPlotOptions = vi.fn(), onSetSeriesStyle = vi.fn();
    const { container } = render(
      <Inspector {...({} as ComponentProps<typeof Inspector>)} activeSection="graphs" selection={selection as never} plot={plot} table={table}
        userPresets={[]} profileDefault={null} wholeGraph={wholeGraph} onSetWholeGraph={() => {}} onSelect={vi.fn()}
        onSetPlotOptions={onSetPlotOptions} onSetSeriesStyle={onSetSeriesStyle} onSetSeriesStyleAll={vi.fn()} onSetPointStyle={vi.fn()} />,
    );
    return { container, onSetPlotOptions, onSetSeriesStyle };
  };
  const slider = (c: HTMLElement) => c.querySelector<HTMLInputElement>('input[aria-label="Bar width"]');
  const box = (c: HTMLElement) => c.querySelector<HTMLInputElement>('input[aria-label="Bar width: whole graph"]');

  it("a bar series: Bar width + a ticked whole-graph box; moving it sets every bar in one write", () => {
    const c = card("p-bar");
    const [a, b] = tableDatasets(c.table).map((d) => d.id);
    const plot = own(c.plot, b!, 0.6);
    const p = panel(plot, c.table, { kind: "series", columnId: a });
    expect(slider(p.container), "no Bar width on the Data tab").not.toBeNull();
    expect(box(p.container)!.checked).toBe(true);
    expect(Number(slider(p.container)!.value)).toBeCloseTo(plot.barWidth ?? 0.82);
    fireEvent.change(slider(p.container)!, { target: { value: "0.5" } });
    expect(p.onSetSeriesStyle).not.toHaveBeenCalled();
    const after = { ...plot, ...p.onSetPlotOptions.mock.calls.at(-1)![0] } as Plot;
    expect(after.barWidth).toBe(0.5);
    expect(after.seriesStyles?.[b!]?.barWidth, "a series kept its own width").toBeUndefined();
  });

  it("unticked: it shows and sets only the clicked series' own width (100 % = fills its place)", () => {
    const c = card("p-bar");
    const a = tableDatasets(c.table)[0]!.id;
    const p = panel(c.plot, c.table, { kind: "series", columnId: a });
    fireEvent.click(box(p.container)!);
    expect(Number(slider(p.container)!.value)).toBe(1);
    fireEvent.change(slider(p.container)!, { target: { value: "0.6" } });
    expect(p.onSetPlotOptions).not.toHaveBeenCalled();
    expect(p.onSetSeriesStyle).toHaveBeenLastCalledWith(a, { barWidth: 0.6 });
  });

  it("not on the bar chart's Chart tab; histogram and UpSet keep theirs there", () => {
    const bar = card("p-bar");
    // By its row label: a Chart-tab slider has no accessible name, so looking for the input proves nothing.
    const barLabels = [...panel(bar.plot, bar.table, { kind: "plot" }).container.querySelectorAll("label.frow > span:first-child")].map((s) => s.textContent);
    expect(barLabels, "the bar chart's Chart tab still has Bar width").not.toContain("Bar width");
    cleanup();
    const hist = card("kind:histogram");
    const labels = [...panel(hist.plot, hist.table, { kind: "plot" }).container.querySelectorAll("label.frow > span:first-child")].map((s) => s.textContent);
    expect(labels).toContain("Bar width");
  });

  it("a series drawn as points (no bar): no Bar width", () => {
    const c = card("p-bar");
    const a = tableDatasets(c.table)[0]!.id;
    const plot = { ...c.plot, seriesStyles: { ...c.plot.seriesStyles, [a]: { ...(c.plot.seriesStyles?.[a] ?? {}), plotAs: "points" } } } as Plot;
    expect(slider(panel(plot, c.table, { kind: "series", columnId: a }).container)).toBeNull();
  });

  it("with the main Apply to whole graph ticked, the box is ticked and locked", () => {
    const c = card("p-bar");
    const p = panel(c.plot, c.table, { kind: "series", columnId: tableDatasets(c.table)[0]!.id }, true);
    expect(box(p.container)!.checked).toBe(true);
    expect(box(p.container)!.disabled).toBe(true);
  });
});

describe("bar width per series — what gets written", () => {
  const plot = { id: "p", kind: "bar", barWidth: 0.8, seriesStyles: { a: { barWidth: 0.5, color: "#f00" }, b: { barWidth: 0.7 } } } as unknown as Plot;

  it("shown: the series' own width unticked, the graph's ticked", () => {
    expect(barWidthShown(plot, "a", false)).toBe(0.5);
    expect(barWidthShown(plot, "c", false)).toBe(1);
    expect(barWidthShown(plot, "a", true)).toBe(0.8);
    expect(barWidthShown({ ...plot, barWidth: undefined } as Plot, "a", true)).toBe(0.82);
  });

  it("whole graph: the graph's width, every series' own cleared, one patch", () => {
    expect(barWidthWholeGraph(plot, 0.6)).toEqual({ barWidth: 0.6, seriesStyles: { a: { color: "#f00" } } });
  });

  it("a drag: whole graph = the band share as-is; one series = its share of its place", () => {
    // The drag reports the band share the dragged bar implies; unticked, that over the graph's share is the series' own.
    expect(barWidthFromDrag(plot, "a", 0.4, true)).toEqual({ plot: { barWidth: 0.4, seriesStyles: { a: { color: "#f00" } } } });
    expect(barWidthFromDrag(plot, "a", 0.4, false)).toEqual({ series: { id: "a", barWidth: 0.5 } });
    expect(barWidthFromDrag(plot, "a", 2, false)).toEqual({ series: { id: "a", barWidth: 1 } });
  });
});
