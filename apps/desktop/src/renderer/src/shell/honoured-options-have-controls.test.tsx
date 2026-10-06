// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { tableDatasets } from "@mady/core";
import type { Plot, PlotKind } from "@mady/core";
import { Inspector } from "./Inspector";
import { galleryItems } from "./gallery";
import type { GraphSelection } from "./AppShell";

afterEach(cleanup);
afterEach(() => globalThis.localStorage?.clear());

/**
 * Options the drawing honours, each held to a control on that kind (measured against the real
 * builder).
 *
 *  - `whiskerColor` / `whiskerWidth` move a violin and a floating bar, so the Whiskers group
 *    is offered there as well as on `box` (and raincloud).
 *  - `barOrientation` / `barWidth` move a histogram, so the bar-options block is not gated
 *    on `kind === "bar"` alone. Layout stays bar-only: a histogram has one series of bins, so there
 *    is nothing to group or stack. Shape does not — see the note on that test.
 */
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

function labels(kind: PlotKind, sel?: GraphSelection): string[] {
  const item = galleryItems().find((g) => (g.plot.kind ?? "xy") === kind)!;
  const ds = tableDatasets(item.table)[0];
  const selection: GraphSelection = sel ?? (ds ? { kind: "series", columnId: ds.id, part: "points" } : { kind: "plot" });
  const { container } = render(
    <Inspector activeSection="graphs" selection={selection} plot={item.plot as Plot} table={item.table}
      userPresets={[]} profileDefault={null} {...handlers()} />,
  );
  return [...container.querySelectorAll("label > span:first-child, .inspsub, .insphd")]
    .map((e) => (e.textContent ?? "").trim()).filter(Boolean);
}

describe("honoured options have controls", () => {
  it("guards the guard — box has the Whiskers group", () => {
    expect(labels("box")).toContain("▾Whiskers");
  });

  for (const kind of ["violin", "floatingbar"] as PlotKind[]) {
    it(`${kind}: draws whiskers, so it offers the Whiskers group`, () => {
      expect(
        labels(kind),
        `${kind} honours whiskerColor/whiskerWidth but offers no whisker controls`,
      ).toContain("▾Whiskers");
    });
  }

  // A floating bar's box span is a BoxWhisker choice (min→max / percentile / mean±SD/SEM/CI),
  // surfaced in the plot panel as "Bar spans" (not "Whiskers" — it draws none). Box keeps "Whiskers".
  it("floating bar offers a 'Bar spans' definition in the plot panel; box keeps 'Whiskers'", () => {
    const fb = labels("floatingbar", { kind: "plot" });
    expect(fb, "floating bar honours boxWhisker for its span but offered no control").toContain("Bar spans");
    expect(fb, "a floating bar draws no whiskers — must not mislabel the span 'Whiskers'").not.toContain("Whiskers");
    expect(labels("box", { kind: "plot" }), "box keeps its Whiskers definition control").toContain("Whiskers");
  });

  it("histogram: orientation and bar width are reachable", () => {
    const l = labels("histogram", { kind: "plot" });
    expect(l, "a histogram honours barOrientation but offered no control").toContain("Orientation");
    expect(l, "a histogram honours barWidth but offered no control").toContain("Bar width");
  });

  /**
   * Bar shape is offered on a histogram.
   *
   * Rounding is per bar, not between bars, so a histogram has bars to round. On
   * a histogram `rounded` turns each bin's `rx="0"` into `rx="7"`, and `roundtop` replaces the
   * bin `<rect>` with a path curving only its top corners. Both move the drawing, in either
   * orientation. The render-proof lives in `Inspector.histogram.test.tsx`; this row just holds
   * the control in place.
   *
   * Bar layout stays out: a histogram is one series of bins, so grouped / stacked / overlaid
   * have nothing to arrange.
   */
  it("histogram: bar layout stays bar-only (one series of bins — nothing to group), but shape does not", () => {
    const l = labels("histogram", { kind: "plot" });
    expect(l, "a histogram offers a bar-layout control with only one series to lay out").not.toContain("Bars");
    expect(l, "a histogram honours barShape — every bin changes shape — but offers no control").toContain("Bar shape");
  });

  // A bar chart's Bar width is on the Data tab, with its "whole graph" tick box — so this holds
  // the four where they live: three in Chart type, Bar width in a bar series' panel.
  it("bar keeps all four", () => {
    const l = labels("bar", { kind: "plot" });
    for (const row of ["Bars", "Bar shape", "Orientation"]) expect(l).toContain(row);
    cleanup();
    expect(labels("bar"), "a bar series' panel has no Bar width").toContain("Bar width");
  });
});
