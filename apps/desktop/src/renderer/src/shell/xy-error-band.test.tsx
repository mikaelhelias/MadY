// @vitest-environment jsdom
/**
 * The error interval as a shaded band, and the median curve that needs one.
 *
 * On XY graphs, a curve can trace the median or mean value and show the error (SD / SEM / …)
 * as a shaded background around the curve; the interval itself is chosen under
 * Data → Error bars → Type. This file covers:
 *   1. drawing that interval as a ribbon following the curve rather than as T-bars;
 *   2. tracing the median instead of the mean.
 *
 * The central property, and what most of this file checks: **the band is the same interval
 * the bars are.** It is a rendering choice, so switching to it must not move a single
 * number — a graph that quietly draws a different statistic would be a serious error.
 *
 * The median is a `Type` (Median + IQR), not a separate centre switch. A centre × interval
 * grid would offer "median ± SD", which is not a meaningful statistic.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import type { DataTable, Plot } from "@mady/core";
import { summarize, errorPoint } from "@mady/core";
import { buildPlotScene } from "@mady/graphics";
import { PlotFigure } from "./PlotFigure";
import { Inspector } from "./Inspector";
import { galleryItems } from "./gallery";

afterEach(cleanup);
afterEach(() => globalThis.localStorage?.clear());

const SIZE = { width: 620, height: 420 };

/** An XY table with 3 replicates per row, deliberately skewed so mean ≠ median. */
const table: DataTable = {
  id: "t", kind: "xy", name: "T",
  columns: [
    { id: "x", name: "Dose", role: "x" },
    { id: "y1", name: "Drug A", role: "y" },
    { id: "y2", name: "y2", role: "y", group: "y1" },
    { id: "y3", name: "y3", role: "y", group: "y1" },
  ],
  rows: [
    { id: "r1", cells: { x: 1, y1: 10, y2: 11, y3: 30 } },
    { id: "r2", cells: { x: 2, y1: 20, y2: 21, y3: 60 } },
    { id: "r3", cells: { x: 3, y1: 30, y2: 33, y3: 90 } },
    { id: "r4", cells: { x: 4, y1: 40, y2: 44, y3: 120 } },
  ],
};
const base: Plot = { id: "p", name: "XY", source: "t", status: "ok", styleOverrides: {}, kind: "xy" };
const build = (style: Record<string, unknown> = {}, over: Partial<Plot> = {}) =>
  buildPlotScene(table, { ...base, seriesStyles: { y1: style }, ...over } as Plot, SIZE);
const s0 = (scene: ReturnType<typeof build>) => scene.series.find((s) => s.id === "y1")!;

describe("the fixture can exhibit the behaviour", () => {
  it("has replicates, so an error interval exists at all", () => {
    const marks = s0(build({ errorBars: "sem" })).marks;
    expect(marks).toHaveLength(4);
    expect(marks.every((m) => m.errLowCy !== undefined && m.errHighCy !== undefined)).toBe(true);
  });

  it("is skewed — mean and median differ, so 'the curve moved' is a real question", () => {
    // Without this, a median curve identical to the mean curve would look like success.
    const sm = summarize([10, 11, 30]);
    expect(sm.mean).not.toBeCloseTo(sm.median, 3);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 1. The band is drawn, and it is the same interval as the bars.
// ─────────────────────────────────────────────────────────────────────────────
describe("the band", () => {
  it("is absent by default — an existing graph is untouched", () => {
    expect(s0(build({ errorBars: "sem" })).bandPath).toBeUndefined();
    expect(s0(build({ errorBars: "sem" })).showErrorBars).toBeUndefined();
  });

  it("appears when asked, and the bars stand down", () => {
    const s = s0(build({ errorBars: "sem", errorDisplay: "band" }));
    expect(s.bandPath).toBeTruthy();
    expect(s.showErrorBars).toBe(false);
  });

  it('"both" keeps the bars and draws the ribbon', () => {
    const s = s0(build({ errorBars: "sem", errorDisplay: "both" }));
    expect(s.bandPath).toBeTruthy();
    expect(s.showErrorBars).toBeUndefined(); // = bars still drawn
  });

  /**
   * The central check. Every mark keeps its interval byte-for-byte across all three
   * display modes: the band is a rendering of the same numbers, not a different statistic.
   */
  it("does not move a single number — bars, band and both carry identical intervals", () => {
    const reach = (d: string) =>
      s0(build({ errorBars: "sem", errorDisplay: d })).marks.map((m) => [m.dy, m.errLow, m.errHigh, m.errLowCy, m.errHighCy]);
    expect(reach("band")).toEqual(reach("bars"));
    expect(reach("both")).toEqual(reach("bars"));
  });

  it("the axis domain is identical too — a display choice must not resize the graph", () => {
    expect(build({ errorBars: "sem", errorDisplay: "band" }).y.domain).toEqual(build({ errorBars: "sem", errorDisplay: "bars" }).y.domain);
  });

  it("follows the chosen type — a SEM band is narrower than an SD band", () => {
    // If the ribbon were built from anything other than the resolved interval, these would
    // come out the same. `errLowCy` is in pixels and y grows downward, so a wider interval
    // has the larger low-y.
    const sem = s0(build({ errorBars: "sem", errorDisplay: "band" })).marks[0]!;
    const sd = s0(build({ errorBars: "sd", errorDisplay: "band" })).marks[0]!;
    expect(sd.errLowCy!).toBeGreaterThan(sem.errLowCy!);
  });

  it("takes its own colour and opacity", () => {
    const s = s0(build({ errorBars: "sem", errorDisplay: "band", bandColor: "#ff0000", bandOpacity: 0.5 }));
    expect(s.bandColor).toBe("#ff0000");
    expect(s.bandOpacity).toBe(0.5);
  });

  describe("the edge", () => {
    it("is off by default — a soft fill with no outline", () => {
      const s = s0(build({ errorBars: "sem", errorDisplay: "band" }));
      expect(s.bandEdgeWidth).toBeUndefined();
    });

    it("takes a width, a colour and a dash, and they reach the drawing", () => {
      const scene = build({ errorBars: "sem", errorDisplay: "band", bandColor: "#00aa00", bandEdgeWidth: 2, bandEdgeColor: "#112233", bandEdgeDash: "dashed" });
      const s = s0(scene);
      expect(s.bandEdgeWidth).toBe(2);
      expect(s.bandEdgeColor).toBe("#112233");
      expect(s.bandEdgeDash).toBe("12.0,8.0"); // dashed, scaled by the 2px edge
      const { container } = render(<PlotFigure scene={scene} zoom={1} />);
      const band = [...container.querySelectorAll("path")].find((p) => p.getAttribute("fill") === "#00aa00")!;
      expect(band.getAttribute("stroke")).toBe("#112233");
      expect(band.getAttribute("stroke-width")).toBe("2");
      expect(band.getAttribute("stroke-dasharray")).toBe("12.0,8.0");
    });

    it("falls back to the band's own colour when no edge colour is set", () => {
      expect(s0(build({ errorBars: "sem", errorDisplay: "band", bandColor: "#00aa00", bandEdgeWidth: 1 })).bandEdgeColor).toBe("#00aa00");
    });

    /**
     * The edge strokes the same path the fill uses. That is what makes it safe: there is no
     * second geometry that could be computed differently and quietly show a boundary the
     * interval does not have.
     */
    it("outlines the very same path as the fill — one geometry, so it cannot disagree", () => {
      const scene = build({ errorBars: "sem", errorDisplay: "band", bandEdgeWidth: 2 });
      const { container } = render(<PlotFigure scene={scene} zoom={1} />);
      const band = [...container.querySelectorAll("path")].find((p) => p.getAttribute("stroke-width") === "2")!;
      expect(band.getAttribute("d")).toBe(s0(scene).bandPath);
    });

    it("is clamped, so a pasted value cannot draw an edge thicker than the band", () => {
      expect(s0(build({ errorBars: "sem", errorDisplay: "band", bandEdgeWidth: 99 })).bandEdgeWidth).toBe(8);
    });
  });

  it("reaches the drawing — a filled path, behind the line, that ignores the pointer", () => {
    const scene = build({ errorBars: "sem", errorDisplay: "band", bandColor: "#ff0000", bandOpacity: 0.5 });
    const { container } = render(<PlotFigure scene={scene} zoom={1} />);
    const band = [...container.querySelectorAll("path")].find((p) => p.getAttribute("fill") === "#ff0000");
    expect(band, "no band path in the rendered figure").toBeDefined();
    expect(band!.getAttribute("fill-opacity")).toBe("0.5");
    expect(band!.getAttribute("pointer-events")).toBe("none");
  });

  it("the T-bars are gone from the drawing in band mode, and present in both", () => {
    // Note: this counts the drawn geometry instead of trusting the flag, because
    // `showErrorBars` could be set and read by nothing.
    const bars = (d: string) => {
      const { container } = render(<PlotFigure scene={build({ errorBars: "sem", errorDisplay: d })} zoom={1} />);
      const n = container.querySelectorAll("[id^='err-'], g.gfx-series line").length;
      cleanup();
      return n;
    };
    const withBars = bars("bars");
    expect(withBars, "the counter found no error bars at all — it is measuring nothing").toBeGreaterThan(0);
    expect(bars("band")).toBeLessThan(withBars);
    expect(bars("both")).toBe(withBars);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. The median curve.
// ─────────────────────────────────────────────────────────────────────────────
describe("Median + IQR", () => {
  it("traces the median, not the mean", () => {
    const mean = s0(build({ errorBars: "sd" })).marks.map((m) => m.dy);
    const med = s0(build({ errorBars: "iqr" })).marks.map((m) => m.dy);
    expect(med).not.toEqual(mean);
    expect(med[0]).toBeCloseTo(11, 6); // median of 10, 11, 30
    expect(mean[0]).toBeCloseTo(17, 6); // mean of the same
  });

  it("reaches from Q1 to Q3 — the interval that belongs to a median", () => {
    const m = s0(build({ errorBars: "iqr" })).marks[0]!;
    const sm = summarize([10, 11, 30]);
    expect(m.errLow).toBeCloseTo(sm.q1, 9);
    expect(m.errHigh).toBeCloseTo(sm.q3, 9);
  });

  it("agrees with the core statistic — the builder does not recompute quartiles its own way", () => {
    const ep = errorPoint(summarize([10, 11, 30]), "iqr");
    const m = s0(build({ errorBars: "iqr" })).marks[0]!;
    expect([m.dy, m.errLow, m.errHigh]).toEqual([ep.center, ep.low, ep.high]);
  });

  it("bands too — median + IQR can be drawn as a ribbon", () => {
    expect(s0(build({ errorBars: "iqr", errorDisplay: "band" })).bandPath).toBeTruthy();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Refusals — out loud, never silent.
// ─────────────────────────────────────────────────────────────────────────────
describe("when it cannot draw a band it says so", () => {
  it("one point with an interval is not a ribbon", () => {
    const one: DataTable = { ...table, rows: [table.rows[0]!] };
    const scene = buildPlotScene(one, { ...base, seriesStyles: { y1: { errorBars: "sem", errorDisplay: "band" } } } as Plot, SIZE);
    expect(scene.series[0]!.bandPath).toBeUndefined();
    expect(scene.warnings.join(" ")).toMatch(/at least two points/i);
    // …and the bars must not have stood down for a band that was never drawn.
    expect(scene.series[0]!.showErrorBars).toBeUndefined();
  });

  it("a chart with no curve to follow refuses and explains", () => {
    const scene = buildPlotScene(table, { ...base, kind: "volcano", seriesStyles: { y1: { errorBars: "sem", errorDisplay: "band" } } } as Plot, SIZE);
    expect(scene.series.every((s) => !s.bandPath)).toBe(true);
    expect(scene.warnings.join(" ")).toMatch(/XY and area charts only/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. The controls.
// ─────────────────────────────────────────────────────────────────────────────
const handlers = (onSetSeriesStyle: (id: string, patch: unknown) => void) => ({
  onSelect: vi.fn(),
  onSetAxis: vi.fn(), onSetAxisLength: vi.fn(), onSetAxisTitleFont: vi.fn(),
  onSetSeriesStyle, onSetSeriesStyleAll: vi.fn(), onSetPointStyle: vi.fn(), onClearPointStyles: vi.fn(),
  onSetGrid: vi.fn(), onSetFrame: vi.fn(), onSetKind: vi.fn(), onSetBarLayout: vi.fn(), onSetBarShape: vi.fn(), onSetBoxWhisker: vi.fn(),
  onSetPlotOptions: vi.fn(), onSetGraphTitle: vi.fn(), onSetPlotFont: vi.fn(), onHomogenizeFont: vi.fn(),
  onSetLegend: vi.fn(), onSetSignificance: vi.fn(), onApplyPreset: vi.fn(), 
  onApplyUserPreset: vi.fn(), onSaveUserPreset: vi.fn(), onDeleteUserPreset: vi.fn(), onSetProfileDefault: vi.fn(),
  annotationOps: { add: vi.fn(), update: vi.fn(), remove: vi.fn(), reorder: vi.fn(), align: vi.fn(), group: vi.fn(), ungroup: vi.fn(), setLocked: vi.fn(), addImage: vi.fn(), replaceImage: vi.fn() },
});

function panel(plot: Plot, tbl: DataTable = table) {
  const writes: { id: string; patch: unknown }[] = [];
  const { container } = render(
    <Inspector activeSection="graphs" selection={{ kind: "series", columnId: "y1", part: "points" }} plot={plot} table={tbl}
      userPresets={[]} profileDefault={null} {...handlers((id, patch) => writes.push({ id, patch }))} />,
  );
  return { container, writes };
}

/** A visible control whose row label is exactly `label`. */
function control<T extends HTMLElement = HTMLElement>(container: HTMLElement, label: string): T | undefined {
  for (const row of container.querySelectorAll<HTMLElement>(".frow")) {
    const span = row.querySelector(":scope > span");
    if ((span?.textContent ?? "").trim() !== label) continue;
    for (let n: HTMLElement | null = row; n; n = n.parentElement) if (n.hidden) return undefined;
    const el = row.querySelector<T>("select, input");
    if (el) return el;
  }
  return undefined;
}

describe("the controls", () => {
  it('XY offers "Show as", and choosing the band writes what the builder reads', () => {
    const plot = { ...base, seriesStyles: { y1: { errorBars: "sem" } } } as Plot;
    const { container, writes } = panel(plot);
    const sel = control<HTMLSelectElement>(container, "Show as");
    expect(sel, "no Show-as control on an XY series with error bars").toBeDefined();
    fireEvent.change(sel!, { target: { value: "band" } });
    expect(writes).toHaveLength(1);
    // Apply what the panel wrote and rebuild — the claim that counts.
    const after = buildPlotScene(table, { ...plot, seriesStyles: { y1: { ...(writes[0]!.patch as object) } } } as Plot, SIZE);
    expect(after.series.find((s) => s.id === "y1")!.bandPath).toBeTruthy();
  });

  it("Median + IQR is offered as a Type", () => {
    const { container } = panel({ ...base, seriesStyles: { y1: { errorBars: "sem" } } } as Plot);
    const sel = control<HTMLSelectElement>(container, "Type");
    expect([...sel!.options].map((o) => o.value)).toContain("iqr");
  });

  it("Band colour + opacity + edge appear only once a band is chosen", () => {
    const off = panel({ ...base, seriesStyles: { y1: { errorBars: "sem" } } } as Plot).container;
    expect(control(off, "Band colour")).toBeUndefined();
    expect(control(off, "Band edge")).toBeUndefined();
    cleanup();
    const on = panel({ ...base, seriesStyles: { y1: { errorBars: "sem", errorDisplay: "band" } } } as Plot).container;
    expect(control(on, "Band colour")).toBeDefined();
    expect(control(on, "Band opacity")).toBeDefined();
    expect(control(on, "Band edge")).toBeDefined();
  });

  it("the edge's own colour + dash appear only once the edge has a width", () => {
    // A colour picker for a line of zero thickness is a control that cannot show its effect.
    const noEdge = panel({ ...base, seriesStyles: { y1: { errorBars: "sem", errorDisplay: "band" } } } as Plot).container;
    expect(control(noEdge, "Edge colour")).toBeUndefined();
    cleanup();
    const edge = panel({ ...base, seriesStyles: { y1: { errorBars: "sem", errorDisplay: "band", bandEdgeWidth: 1.5 } } } as Plot).container;
    expect(control(edge, "Edge colour")).toBeDefined();
    expect(control(edge, "Edge dashes")).toBeDefined();
  });

  it("a kind that cannot draw a ribbon is not offered one", () => {
    // The control and the builder must agree: a volcano warns instead of drawing, so it
    // must not advertise the option in the first place.
    const { container } = panel({ ...base, kind: "volcano", seriesStyles: { y1: { errorBars: "sem" } } } as Plot);
    expect(control(container, "Show as")).toBeUndefined();
  });

  /**
   * No replicates → no interval → no band, by design.
   *
   * The gallery's own XY card has two plain Y columns, so `errorBars` defaults to "none" and
   * there is no interval to shade: a shaded error band needs data that has an error.
   *
   * The Inspector states the reason instead of showing a "Type" menu that reads "none" and
   * offers intervals it cannot draw; the whole section is refused with an explanation.
   */
  it("a graph with no replicates is not offered a band — there is no interval to shade", () => {
    const g = galleryItems().find((x) => (x.plot.kind ?? "xy") === "xy")!;
    const { container } = render(
      <Inspector activeSection="graphs" selection={{ kind: "series", columnId: "ya", part: "points" }} plot={g.plot} table={g.table}
        userPresets={[]} profileDefault={null} {...handlers(vi.fn())} />,
    );
    expect(control(container, "Show as"), "no interval → no ribbon").toBeUndefined();
    expect(control(container, "Type"), "…and not a Type menu either: there is nothing for it to choose").toBeUndefined();
    expect(container.querySelector('[data-refusal="Error bars"]')?.textContent, "and it must say why")
      .toMatch(/no error bar to style/);
  });

  it("…and a real gallery table that has replicates offers it — not only the hand-made fixture", () => {
    /*
     * Note: the distribution demo tables (box/violin/scatter/…) are single-column — one value per
     * cell, no replicate subcolumns — so the gallery has no replicate-bearing XY table to borrow.
     * The grouped bar card carries replicates, so — treated as XY — its replicate series offers
     * the ribbon control. That the band draws on numeric-X replicate data is covered by the
     * hand-made cases above (`bandPath`); this checks only the control, because the bar card's X
     * is categorical and so cannot itself draw an XY ribbon.
     */
    const g = galleryItems().find((x) => x.key === "bar")!;
    const lead = g.table.columns.find((c) => c.role === "y" && !c.group)!.id;
    const asXy = { ...g.plot, kind: "xy", annotations: [], seriesStyles: { [lead]: { errorBars: "sem" } } } as Plot;
    const { container } = render(
      <Inspector activeSection="graphs" selection={{ kind: "series", columnId: lead, part: "points" }} plot={asXy} table={g.table}
        userPresets={[]} profileDefault={null} {...handlers(vi.fn())} />,
    );
    expect(control(container, "Show as"), "a replicate-bearing gallery table offers no band control").toBeDefined();
  });
});
