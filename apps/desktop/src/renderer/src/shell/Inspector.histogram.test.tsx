// @vitest-environment jsdom
// A histogram is drawn as bars, so it needs the bar controls.
//
// Three options change a histogram's drawing and need a control in the Inspector:
// `barShape`, `seriesStyles.plotAs` and `seriesStyles.symbolBorderWidth`. Each is checked by
// setting the option and comparing the drawing.
//
// `seriesStyles.errorBars` is not offered: a histogram draws no error bars under any of the
// seven types — no mark carries error geometry — so the control would do nothing. A test below
// checks that this stays true.
//
// `symbolBorderWidth` also keeps two controls apart. `symbolFields` maps its "Outline width"
// row to `symbolBorderWidth` on a bar and to `borderWidth` everywhere else — and a histogram
// gets `fillFields` too, whose "Contour width" row also writes `borderWidth`. Without the bar
// mapping, two controls in two different groups would write one number: thickening the bars'
// outline would thicken every dot drawn on them, and the markers' own outline width could not
// be set at all.
//
// Both halves are checked, because a control that does nothing could satisfy either alone:
//   1. the control is reachable on a histogram, and
//   2. the option it writes moves the histogram's drawing.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import type { DataTable, ErrorBarType, Plot, SeriesStyle } from "@mady/core";
import { buildPlotScene } from "@mady/graphics";
import { PlotFigure } from "./PlotFigure";
import { Inspector } from "./Inspector";
import { galleryItems } from "./gallery";

afterEach(cleanup);

const SIZE = { width: 620, height: 420 };
const hist = (): { plot: Plot; table: DataTable } => {
  const g = galleryItems().find((x) => (x.plot.kind ?? "xy") === "histogram");
  if (!g) throw new Error("no histogram in galleryItems() — this test takes its histogram from the gallery");
  return { plot: g.plot as Plot, table: g.table as DataTable };
};

const handlers = (over: Record<string, unknown> = {}) => ({
  onSelect: vi.fn(),
  onSetAxis: vi.fn(), onSetAxisLength: vi.fn(), onSetAxisTitleFont: vi.fn(),
  onSetSeriesStyle: vi.fn(), onSetSeriesStyleAll: vi.fn(), onSetPointStyle: vi.fn(), onClearPointStyles: vi.fn(),
  onSetGrid: vi.fn(), onSetFrame: vi.fn(), onSetKind: vi.fn(), onSetBarLayout: vi.fn(), onSetBarShape: vi.fn(), onSetBoxWhisker: vi.fn(),
  onSetPlotOptions: vi.fn(), onSetGraphTitle: vi.fn(), onSetPlotFont: vi.fn(), onHomogenizeFont: vi.fn(),
  onSetLegend: vi.fn(), onSetSignificance: vi.fn(), onApplyPreset: vi.fn(), 
  onApplyUserPreset: vi.fn(), onSaveUserPreset: vi.fn(), onDeleteUserPreset: vi.fn(), onSetProfileDefault: vi.fn(),
  annotationOps: { add: vi.fn(), update: vi.fn(), remove: vi.fn(), reorder: vi.fn(), align: vi.fn(), group: vi.fn(), ungroup: vi.fn(), setLocked: vi.fn(), addImage: vi.fn(), replaceImage: vi.fn() },
  ...over,
});

/** The id of a series the scene actually draws — a histogram draws bins, not the table's rows. */
function liveSeriesId(plot: Plot, table: DataTable): string {
  const id = buildPlotScene(table, plot, SIZE).series[0]?.id;
  if (!id) throw new Error("the histogram fixture draws no series");
  return id;
}

/** Render a panel and return it plus the recorded handlers. `over` swaps in a variant plot. */
function panel(selection: unknown, extra: Record<string, unknown> = {}, over?: Plot) {
  const { plot: base, table } = hist();
  const plot = over ?? base;
  const h = handlers(extra);
  const r = render(
    <Inspector activeSection="graphs" selection={selection as never} plot={plot} table={table}
      userPresets={[]} profileDefault={null} wholeGraph={false} onSetWholeGraph={() => {}} {...h} />,
  );
  return { ...r, h, plot, table };
}

/** Control labels, never `textContent` — hidden <option> text would make guards here unfailable. */
const labelsIn = (c: HTMLElement): string[] =>
  [...c.querySelectorAll("label > span:first-child, .inspsub, .insphd")].map((e) => (e.textContent ?? "").trim()).filter(Boolean);

/** Drive the numeric input whose label is `text`, and return it. */
function driveNumberLabelled(c: HTMLElement, text: string): HTMLInputElement | null {
  for (const lab of c.querySelectorAll("label")) {
    if ((lab.querySelector("span:first-child")?.textContent ?? "").trim() !== text) continue;
    const input = lab.querySelector<HTMLInputElement>('input[type="number"], input[type="range"]');
    if (!input) continue;
    fireEvent.change(input, { target: { value: String(Number(input.value || 1) + 2) } });
    fireEvent.blur(input);
    return input;
  }
  return null;
}

/** How many of this plot's drawn marks carry error-bar geometry, with `type` set on series 1? */
function errorMarks(table: DataTable, plot: Plot, type: ErrorBarType): number {
  const id = buildPlotScene(table, plot, SIZE).series[0]?.id;
  if (!id) throw new Error("the fixture draws no series");
  const styled: Plot = { ...plot, seriesStyles: { ...(plot.seriesStyles ?? {}), [id]: { ...(plot.seriesStyles?.[id] ?? {}), errorBars: type } } };
  let n = 0;
  for (const s of buildPlotScene(table, styled, SIZE).series) {
    for (const m of (s as unknown as { marks?: Record<string, unknown>[] }).marks ?? []) {
      if (m["errLow"] !== undefined || m["errHigh"] !== undefined) n++;
    }
  }
  return n;
}

/** Does this series-style patch move the histogram's drawing? `over` swaps in a variant plot. */
function movesDrawing(patch: SeriesStyle, over?: Plot): boolean {
  const { plot: base, table } = hist();
  const plot = over ?? base;
  const draw = (p: Plot): string => renderToStaticMarkup(createElement(PlotFigure, { scene: buildPlotScene(table, p, SIZE) }));
  const id = liveSeriesId(plot, table);
  const styled: Plot = { ...plot, seriesStyles: { ...(plot.seriesStyles ?? {}), [id]: { ...(plot.seriesStyles?.[id] ?? {}), ...patch } } };
  return draw(plot) !== draw(styled);
}

describe("histogram — the bar controls it needs", () => {
  it("Bar shape is on the plot panel", () => {
    const { container } = panel({ kind: "plot" });
    expect(labelsIn(container), "the histogram's plot panel offers no Bar shape control").toContain("Bar shape");
  });

  it("Bar shape changes the histogram's drawing (so the control has an effect)", () => {
    const { plot, table } = hist();
    const draw = (p: Plot): string => renderToStaticMarkup(createElement(PlotFigure, { scene: buildPlotScene(table, p, SIZE) }));
    expect(draw(plot) !== draw({ ...plot, barShape: "roundtop" }), "barShape does nothing on a histogram").toBe(true);
  });

  /**
   * The reason there is no error-bars section: a histogram draws no error bars under any type.
   *
   * It asks the question directly: how many drawn marks carry error geometry? Comparing the
   * whole rendered figure as a string would report a type such as `geoSd` on a floating-point
   * difference in a bin's height (in the 14th decimal) with no error bar anywhere. Counting the
   * geometry cannot be fooled that way, and the bar row below proves the counter can actually
   * find one.
   *
   * If a histogram ever draws an error bar, this fails, and the Inspector then needs an error-bars
   * section for it.
   */
  it("no error-bar geometry on a histogram under any type (so the section stays off)", () => {
    // Keyed off the union so a new error-bar type cannot be added without re-measuring it here.
    const everyType: Record<Exclude<ErrorBarType, "none">, true> = {
      // `iqr` is median + Q1–Q3. This union is deliberately exhaustive — the point is that a
      // new type gets measured on a histogram rather than assumed harmless.
      sd: true, sem: true, ci95: true, range: true, geoSd: true, asymmetric: true, iqr: true,
    };
    const types = Object.keys(everyType) as Exclude<ErrorBarType, "none">[];

    // Guards the guard. A bar chart does draw them, so a counter that reports 0 everywhere
    // is broken, not reassuring.
    //
    // Note: the count must come from the overridden series alone — on a two-series bar, the
    // other series' default SD bars would satisfy it under "asymmetric" and prove nothing.
    // Asymmetric does not draw from raw replicates at all (it is the display for entered
    // limits — `summaryPointForRow`): the replicate types are proven on the single-series bar
    // card, and asymmetric on a mean-limits table — the entry shape that display exists for.
    const barItem = galleryItems().find((g) => (g.plot.kind ?? "xy") === "bar");
    if (!barItem) throw new Error("no bar gallery fixture");
    for (const t of types.filter((x) => x !== "asymmetric")) {
      expect(errorMarks(barItem.table as DataTable, barItem.plot as Plot, t),
        `the counter found no error bars on a bar chart under "${t}" — it is measuring nothing`).toBeGreaterThan(0);
    }
    const limitsT: DataTable = {
      id: "t-limits", kind: "xy", name: "limits",
      columns: [
        { id: "x", name: "Group", role: "x" },
        { id: "m", name: "Mean", role: "y" },
        { id: "lo", name: "Lower", role: "errlow", group: "m" },
        { id: "hi", name: "Upper", role: "errhigh", group: "m" },
      ],
      rows: [
        { id: "r1", cells: { x: "A", m: 20, lo: 16, hi: 25 } },
        { id: "r2", cells: { x: "B", m: 31, lo: 27, hi: 34 } },
      ],
    };
    const limitsPlot: Plot = { id: "p-limits", name: "p-limits", source: "t-limits", status: "ok", styleOverrides: {}, kind: "bar" };
    expect(errorMarks(limitsT, limitsPlot, "asymmetric"),
      'the counter found no error bars under "asymmetric" on a mean-limits bar — it is measuring nothing').toBeGreaterThan(0);

    const { plot, table } = hist();
    for (const t of types) {
      expect(errorMarks(table, plot, t), `errorBars:"${t}" draws on a histogram, which offers no control for it`).toBe(0);
    }
    const { container } = panel({ kind: "series", columnId: liveSeriesId(plot, table), part: "points" });
    expect(labelsIn(container), "an error-bars section appeared on a kind that draws none").not.toContain("Type");
  });

  it("'Render as' is on the series panel", () => {
    const { plot, table } = hist();
    const { container } = panel({ kind: "series", columnId: liveSeriesId(plot, table), part: "points" });
    expect(labelsIn(container), "a histogram cannot be rendered as a line over its bars").toContain("Render as");
  });

  it("plotAs changes the histogram's drawing", () => {
    expect(movesDrawing({ plotAs: "line" }), "plotAs does nothing on a histogram").toBe(true);
  });

  /**
   * The horizontal builder draws the transposed line overlay, so on a horizontal histogram the
   * option moves the drawing and the control must stay. `isTransposedPlot()` does not cover
   * histogram, so the orientation handling in `Inspector.tsx` is what keeps them in step.
   * Both halves: the option moves the drawing and the control is present.
   */
  it("flipping the histogram horizontal keeps 'Render as', because the overlay draws there too", () => {
    const { plot, table } = hist();
    const horiz: Plot = { ...plot, barOrientation: "horizontal" };
    expect(movesDrawing({ plotAs: "line" }, horiz), "plotAs does nothing on a horizontal histogram").toBe(true);
    const { container } = panel({ kind: "series", columnId: liveSeriesId(horiz, table), part: "points" }, {}, horiz);
    expect(labelsIn(container), "'Render as' missing on a horizontal histogram, where it works").toContain("Render as");
  });

  it("'Value axis' does not come with it — a histogram draws no second value axis", () => {
    const { plot, table } = hist();
    const { container } = panel({ kind: "series", columnId: liveSeriesId(plot, table), part: "points" });
    expect(labelsIn(container), "a histogram offers a 2nd-value-axis control while drawing no 2nd value axis").not.toContain("Value axis");
  });

  /**
   * Two rows, two groups, and they must not be one number.
   *
   * "Contour width" (Fill) is the bar's outline. "Outline width" (Data points) is the markers'.
   * A histogram draws both, so writing `borderWidth` from each would make them the same control.
   */
  it("the markers' Outline width and the bars' Contour width are different numbers", () => {
    const { plot, table } = hist();
    const seen: string[] = [];
    const { container } = panel(
      { kind: "series", columnId: liveSeriesId(plot, table), part: "points" },
      { onSetSeriesStyle: (_id: string, patch: SeriesStyle) => seen.push(...Object.keys(patch)) },
    );
    expect(driveNumberLabelled(container, "Outline width"), "no 'Outline width' control on the histogram's series panel").not.toBeNull();
    expect(driveNumberLabelled(container, "Contour width"), "no 'Contour width' control on the histogram's series panel").not.toBeNull();
    expect(seen, "'Outline width' must write the markers' width").toContain("symbolBorderWidth");
    expect(seen, "'Contour width' must write the bars' width").toContain("borderWidth");
  });

  it("the markers' outline width changes the histogram's drawing (with data points on)", () => {
    // Dots are off by default, so style them with showPoints enabled.
    const { plot } = hist();
    const withPoints: Plot = { ...plot, histogram: { ...(plot.histogram ?? {}), showPoints: true } };
    expect(movesDrawing({ symbolBorderWidth: 4 }, withPoints), "symbolBorderWidth does nothing on a histogram").toBe(true);
  });

  it("Data points tickbox is on the plot panel, commits, and is off by default", () => {
    const { container, h } = panel({ kind: "plot" });
    expect(labelsIn(container), "no Data points control on the histogram panel").toContain("Data points");
    const row = [...container.querySelectorAll("label")].find((l) => (l.querySelector("span:first-child")?.textContent ?? "").trim() === "Data points");
    const box = row?.querySelector<HTMLInputElement>('input[type="checkbox"]');
    expect(box, "no Data points checkbox").not.toBeNull();
    expect(box!.checked, "data points should default to off on a histogram").toBe(false);
    fireEvent.click(box!);
    const wrote = h.onSetPlotOptions.mock.calls.map((c) => (c[0] as Partial<Plot>).histogram?.showPoints).filter((v) => v !== undefined).pop();
    expect(wrote, "the tickbox did not write showPoints").toBe(true);
  });

  it("Custom bins parses a gap + open-ended range list into binRanges", () => {
    const { container, h } = panel({ kind: "plot" });
    expect(labelsIn(container), "the histogram's plot panel offers no Custom bins control").toContain("Custom bins");
    const row = [...container.querySelectorAll("label")].find((l) => (l.querySelector("span:first-child")?.textContent ?? "").trim() === "Custom bins");
    const input = row?.querySelector<HTMLInputElement>('input[type="text"]');
    expect(input, "no Custom bins text field on the histogram panel").not.toBeNull();
    // A gap (30–50 skipped) and an open-ended top bin — the shapes an edge list cannot express.
    fireEvent.change(input!, { target: { value: "10-30, 50-70, 90+" } });
    const wrote = h.onSetPlotOptions.mock.calls.map((c) => (c[0] as Partial<Plot>).histogram?.binRanges).filter(Boolean).pop();
    expect(wrote, "Custom bins did not parse the ranges into binRanges").toEqual([[10, 30], [50, 70], [90, null]]);
  });

  it("a bare edge list still parses to contiguous bins", () => {
    const { container, h } = panel({ kind: "plot" });
    const row = [...container.querySelectorAll("label")].find((l) => (l.querySelector("span:first-child")?.textContent ?? "").trim() === "Custom bins");
    const input = row!.querySelector<HTMLInputElement>('input[type="text"]')!;
    fireEvent.change(input, { target: { value: "10, 30, 90" } });
    const wrote = h.onSetPlotOptions.mock.calls.map((c) => (c[0] as Partial<Plot>).histogram?.binRanges).filter(Boolean).pop();
    expect(wrote, "an edge list should expand to contiguous ranges").toEqual([[10, 30], [30, 90]]);
  });

  it("custom bins change the histogram's drawing (so the control has an effect)", () => {
    // The gallery fixture's values span ~22–80, so these unequal-width bins rebuild the picture
    // versus the auto ~7 equal bins.
    const { plot, table } = hist();
    const draw = (p: Plot): string => renderToStaticMarkup(createElement(PlotFigure, { scene: buildPlotScene(table, p, SIZE) }));
    const withBins: Plot = { ...plot, histogram: { ...(plot.histogram ?? {}), binRanges: [[20, 40], [40, 60], [60, 80]] } };
    expect(draw(plot) !== draw(withBins), "binRanges does nothing on a histogram").toBe(true);
  });

  it("Proportional width tickbox is on the plot panel and commits", () => {
    const { container, h } = panel({ kind: "plot" });
    expect(labelsIn(container), "the histogram's plot panel offers no Proportional width control").toContain("Proportional width");
    const row = [...container.querySelectorAll("label")].find((l) => (l.querySelector("span:first-child")?.textContent ?? "").trim() === "Proportional width");
    const box = row?.querySelector<HTMLInputElement>('input[type="checkbox"]');
    expect(box, "no Proportional width checkbox").not.toBeNull();
    fireEvent.click(box!);
    const wrote = h.onSetPlotOptions.mock.calls.map((c) => (c[0] as Partial<Plot>).histogram?.proportionalWidth).filter((v) => v !== undefined).pop();
    expect(wrote, "the tickbox did not write proportionalWidth").toBe(true);
  });

  it("proportional width changes the drawing (unequal bins render unequal, so the control has an effect)", () => {
    const { plot, table } = hist();
    const draw = (p: Plot): string => renderToStaticMarkup(createElement(PlotFigure, { scene: buildPlotScene(table, p, SIZE) }));
    const bins: Plot = { ...plot, histogram: { ...(plot.histogram ?? {}), binRanges: [[20, 40], [40, 90]] } };
    const prop: Plot = { ...bins, histogram: { ...bins.histogram, proportionalWidth: true } };
    expect(draw(bins) !== draw(prop), "proportionalWidth does nothing on a histogram").toBe(true);
  });
});
