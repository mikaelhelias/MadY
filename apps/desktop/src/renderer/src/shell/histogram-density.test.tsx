// @vitest-environment jsdom
// Histogram + density (KDE) curve, bars kept.
//
// The curve is the violin's kernel density estimate (core `gaussianKde`, Silverman bandwidth ×
// a "Smoothness" multiplier), scaled to the frequency axis by the same factor the normal
// curve uses, so the two curves are comparable on one histogram. Both ride one scene list,
// `distributionCurves`, and both are clickable to "Chart type".
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { buildPlotScene } from "@mady/graphics";
import type { DataTable, Plot } from "@mady/core";
import { PlotFigure } from "./PlotFigure";
import { Inspector } from "./Inspector";
import { galleryItems } from "./gallery";

afterEach(cleanup);
const SIZE = { width: 640, height: 460 };

const hist = (): { plot: Plot; table: DataTable } => {
  const g = galleryItems().find((x) => (x.plot.kind ?? "xy") === "histogram");
  if (!g) throw new Error("no histogram gallery fixture");
  return { plot: g.plot as Plot, table: g.table as DataTable };
};
const build = (over: Partial<NonNullable<Plot["histogram"]>> = {}, plotOver: Partial<Plot> = {}) => {
  const { plot, table } = hist();
  const p: Plot = { ...plot, ...plotOver, histogram: { ...(plot.histogram ?? {}), ...over } };
  return { plot: p, table, scene: buildPlotScene(table, p, SIZE) };
};
type Curve = { path: string; color: string; width: number; dash: string | null; label: string };
const curves = (scene: ReturnType<typeof buildPlotScene>): Curve[] =>
  ((scene as unknown as { distributionCurves?: Curve[] }).distributionCurves ?? []);
const pts = (c: Curve): [number, number][] => c.path.slice(1).split(" L").map((p) => p.split(",").map(Number) as [number, number]);
/** Pixel y → data value on the frequency axis (the scene's own linear mapping). */
const yData = (scene: ReturnType<typeof buildPlotScene>, py: number): number => {
  const [r0, r1] = scene.y.range;
  const [d0, d1] = scene.y.domain;
  return d0 + ((py - r0) / (r1 - r0)) * (d1 - d0);
};

describe("histogram density curve — builder", () => {
  it("off by default; on, one 'density' curve with a real path appears next to the bars (bars kept)", () => {
    expect(curves(build().scene)).toEqual([]);
    const { scene } = build({ densityCurve: true });
    const dens = curves(scene).filter((c) => c.label === "density");
    expect(dens).toHaveLength(1);
    expect(dens[0]!.path.startsWith("M")).toBe(true);
    expect(pts(dens[0]!).length).toBeGreaterThan(10);
    // The bins are still bars — the curve is an overlay, not a replacement.
    expect(scene.series[0]!.marks.filter((m) => m.bar).length).toBeGreaterThan(2);
  });

  it("is scaled like the normal curve: the two curves enclose about the same area on the frequency axis", () => {
    const { scene } = build({ densityCurve: true, normalCurve: true });
    const dens = curves(scene).find((c) => c.label === "density")!;
    const norm = curves(scene).find((c) => c.label === "normal")!;
    const area = (c: Curve): number => pts(c).reduce((s, [, py]) => s + Math.max(0, yData(scene, py)), 0);
    const ratio = area(dens) / area(norm);
    expect(ratio).toBeGreaterThan(0.8);
    expect(ratio).toBeLessThan(1.25);
  });

  it("Smoothness (× Silverman) moves the curve: a lower multiplier peaks higher (spikier)", () => {
    const peak = (bw: number): number => {
      const { scene } = build({ densityCurve: true, densityBandwidth: bw });
      return Math.max(...pts(curves(scene)[0]!).map(([, py]) => yData(scene, py)));
    };
    expect(peak(0.4)).toBeGreaterThan(peak(2.5));
  });

  it("both curves at once: density solid, normal dashed, each its own colour", () => {
    const { scene } = build({ densityCurve: true, normalCurve: true, densityCurveColor: "#123456", normalCurveColor: "#654321" });
    const dens = curves(scene).find((c) => c.label === "density")!;
    const norm = curves(scene).find((c) => c.label === "normal")!;
    expect(dens.dash).toBeNull();
    expect(norm.dash).not.toBeNull();
    expect(dens.color).toBe("#123456");
    expect(norm.color).toBe("#654321");
  });

  it("the value axis grows to fit a curve it was asked to draw — no curve point is clamped flat at the plot top", () => {
    // The gallery histogram's KDE peaks above the tallest bar; clamping it to the bars' range
    // would draw it as a flat plateau along the top edge of the plot box.
    const { scene } = build({ densityCurve: true, normalCurve: true, densityBandwidth: 0.4 });
    for (const c of curves(scene)) {
      const top = Math.min(...pts(c).map(([, py]) => py));
      expect(top, `${c.label} curve touches the plot top`).toBeGreaterThan(scene.plot.y + 1);
    }
    // A user-pinned axis maximum still wins (the curve is clamped, the user's choice is kept).
    const pinned = build({ densityCurve: true }, { yAxis: { max: 4 } }).scene;
    expect(pinned.y.domain[1]).toBe(4);
  });

  it("refuses out loud on cumulative modes and on custom (unequal) bins — no curve, a warning that names it", () => {
    const cum = build({ densityCurve: true, freq: "cumulative" }).scene;
    expect(curves(cum).filter((c) => c.label === "density")).toEqual([]);
    expect(cum.warnings.some((w) => /density curve/i.test(w))).toBe(true);
    const custom = build({ densityCurve: true, binRanges: [[0, 10], [10, 40], [40, null]] }).scene;
    expect(curves(custom).filter((c) => c.label === "density")).toEqual([]);
    expect(custom.warnings.some((w) => /density curve/i.test(w))).toBe(true);
  });
});

describe("histogram density curve — renderer + click route", () => {
  it("draws every curve, and clicking one opens the Chart-type block, as every drawn element opens its own controls", () => {
    const { scene } = build({ densityCurve: true, normalCurve: true });
    const onSelect = vi.fn();
    const { container } = render(<PlotFigure scene={scene} zoom={1} onSelect={onSelect} />);
    const drawn = container.querySelectorAll(".gfx-distcurve");
    expect(drawn).toHaveLength(2);
    const hit = container.querySelector(".gfx-distcurve-hit");
    expect(hit, "the curve needs a hit-stroke — the visible path is pointer-events:none").not.toBeNull();
    fireEvent.click(hit!);
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ kind: "chart-section", title: "Chart type" }));
  });
});

describe("histogram density curve — Inspector", () => {
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
  const labelsIn = (c: HTMLElement): string[] =>
    [...c.querySelectorAll("label > span:first-child")].map((e) => (e.textContent ?? "").trim()).filter(Boolean);
  const panel = (plot: Plot, table: DataTable) => {
    const h = handlers();
    const r = render(
      <Inspector activeSection="graphs" selection={{ kind: "chart-section", title: "Chart type" } as never} plot={plot} table={table}
        userPresets={[]} profileDefault={null} wholeGraph={false} onSetWholeGraph={() => {}} {...h} />,
    );
    return { ...r, h };
  };
  const tick = (c: HTMLElement, text: string): HTMLInputElement => {
    for (const lab of c.querySelectorAll("label")) {
      if ((lab.querySelector("span:first-child")?.textContent ?? "").trim() === text) return lab.querySelector("input")!;
    }
    throw new Error(`no control labelled "${text}"`);
  };

  it("'Density curve' sits beside 'Normal curve' in the Chart-type block; its colour + Smoothness rows appear only when on", () => {
    const { plot, table } = hist();
    const off = panel(plot, table);
    const labels = labelsIn(off.container);
    expect(labels).toContain("Normal curve");
    expect(labels).toContain("Density curve");
    expect(labels).not.toContain("Smoothness");
    expect(labels.indexOf("Density curve")).toBe(labels.indexOf("Normal curve") + 1);
    fireEvent.click(tick(off.container, "Density curve"));
    expect(off.h.onSetPlotOptions).toHaveBeenCalledWith({ histogram: expect.objectContaining({ densityCurve: true }) });
    cleanup();
    const on = panel({ ...plot, histogram: { ...(plot.histogram ?? {}), densityCurve: true } }, table);
    const onLabels = labelsIn(on.container);
    expect(onLabels).toContain("Smoothness");
    expect(onLabels.filter((l) => l === "Curve colour")).toHaveLength(1);
    fireEvent.change(tick(on.container, "Smoothness"), { target: { value: "1.8" } });
    expect(on.h.onSetPlotOptions).toHaveBeenCalledWith({ histogram: expect.objectContaining({ densityBandwidth: 1.8 }) });
  });
});
