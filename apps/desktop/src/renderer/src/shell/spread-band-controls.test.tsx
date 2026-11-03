// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import type { DataTable, Plot, PlotKind } from "@mady/core";
import { buildPlotScene } from "@mady/graphics";
import { Inspector } from "./Inspector";
import { galleryItems } from "./gallery";

afterEach(cleanup);
afterEach(() => globalThis.localStorage?.clear());

/**
 * The spread band's own colour and opacity must be reachable.
 *
 * The builder honours `spread.color` and `spread.opacity`, and the Inspector must offer a
 * control for each (they are not reachable from the graph ribbon or by direct manipulation).
 *
 * Note: match labels, never `textContent`. Assertions on `textContent` can match the text of
 * hidden <option> elements and pass even with the control removed.
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

function labels(kind: PlotKind, spreadOn: boolean): string[] {
  const item = galleryItems().find((g) => (g.plot.kind ?? "xy") === kind)!;
  const plot = { ...item.plot, ...(spreadOn ? { spread: { mode: "sd" } } : {}) } as Plot;
  const { container } = render(
    <Inspector activeSection="graphs" selection={{ kind: "plot" }} plot={plot} table={item.table}
      userPresets={[]} profileDefault={null} {...handlers()} />,
  );
  return [...container.querySelectorAll("label > span:first-child, .inspsub, .insphd")]
    .map((e) => (e.textContent ?? "").trim()).filter(Boolean);
}

const KINDS: PlotKind[] = ["xy", "area", "bubble", "volcano"];

describe("spread band colour + opacity are reachable", () => {
  it("guards the guard — the band's mode row is there to begin with", () => {
    expect(labels("xy", false)).toContain("Spread band");
  });

  for (const kind of KINDS) {
    it(`${kind}: offers Band colour and Band opacity once a mode is set`, () => {
      const l = labels(kind, true);
      expect(l, `${kind} honours spread.color but offers no control`).toContain("Band colour");
      expect(l, `${kind} honours spread.opacity but offers no control`).toContain("Band opacity");
    });
  }

  it("they stay hidden while the band is off — no control for something not drawn", () => {
    const l = labels("xy", false);
    expect(l).not.toContain("Band colour");
    expect(l).not.toContain("Band opacity");
  });
});

/** Same helper, but with the average line switched on too. */
function labelsWithLine(kind: PlotKind): string[] {
  const item = galleryItems().find((g) => (g.plot.kind ?? "xy") === kind)!;
  const plot = { ...item.plot, spread: { mode: "iqr", showMean: true } } as Plot;
  const { container } = render(
    <Inspector activeSection="graphs" selection={{ kind: "plot" }} plot={plot} table={item.table}
      userPresets={[]} profileDefault={null} {...handlers()} />,
  );
  return [...container.querySelectorAll("label > span:first-child, .inspsub, .insphd")]
    .map((e) => (e.textContent ?? "").trim()).filter(Boolean);
}

describe("the average line's statistic and colour are reachable", () => {
  // An option draws the centre line as the median or the mean, and `spread.meanColor`
  // (honoured by the builder) needs a control like Band colour above.
  it("offers Line shows (mean/median) + Line colour once the line is on", () => {
    const l = labelsWithLine("xy");
    expect(l, "no control chooses what the centre line traces").toContain("Line shows");
    expect(l, "spread.meanColor is honoured but unreachable").toContain("Line colour");
  });

  it("neither row shows while the line is off", () => {
    const l = labels("xy", true); // band on, line off
    expect(l).not.toContain("Line shows");
    expect(l).not.toContain("Line colour");
  });
});

describe("the builder traces the statistic the option names", () => {
  // Values {1, 2, 30} per X: mean 11, median 2 — far enough apart that the two centre
  // lines cannot be confused. If the fixture ever stops skewing, the guard dies with it.
  const skewTable: DataTable = {
    id: "t",
    kind: "xy",
    name: "Skew",
    columns: [
      { id: "x", name: "X", role: "x" },
      { id: "a", name: "A", role: "y" },
      { id: "b", name: "B", role: "y" },
      { id: "c", name: "C", role: "y" },
    ],
    rows: [
      { id: "r1", cells: { x: 1, a: 1, b: 2, c: 30 } },
      { id: "r2", cells: { x: 2, a: 1, b: 2, c: 30 } },
      { id: "r3", cells: { x: 3, a: 1, b: 2, c: 30 } },
    ],
  } as unknown as DataTable;
  const scene = (center?: "mean" | "median") =>
    buildPlotScene(
      skewTable,
      {
        id: "p", name: "P", source: "t", status: "ok", styleOverrides: {},
        spread: { mode: "iqr", showMean: true, ...(center ? { center } : {}) },
      } as unknown as Plot,
      { width: 520, height: 360 },
    );

  it("center: median draws a different, lower-valued centre line than the mean", () => {
    const mean = scene().spreadBand;
    const median = scene("median").spreadBand;
    expect(mean?.meanPath, "the fixture draws no centre line at all — it cannot exhibit this").toBeTruthy();
    expect(median?.meanPath, "center: median silently dropped the line").toBeTruthy();
    expect(median!.meanPath, "the median line is byte-identical to the mean line").not.toBe(mean!.meanPath);
    // Median (2) < mean (11) → on screen the median line sits lower (larger SVG y).
    const firstY = (d: string): number => Number(/[ML]?\s*[-\d.]+\s*,\s*([-\d.]+)/.exec(d)?.[1]);
    expect(firstY(median!.meanPath!), "the 'median' line does not sit at the median").toBeGreaterThan(firstY(mean!.meanPath!));
  });
});
