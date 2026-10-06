// @vitest-environment jsdom
// A population pyramid's bars must be stylable one at a time.
//
// A pyramid draws back-to-back bars, and the builder honours a per-point fill on each one:
// a `pointStyles` override moves exactly one of the twelve bars, and the patterned bar
// references the <pattern> by url(#…) with no orphan defs left behind.
//
// The risk is a wrong-target write, not a missing control: the rows are on the panel. If
// `POINT_KEYS` gains the bar-fill keys only when `barLike` (bar | histogram), then on a pyramid
// `applyStyle` puts fillType / pattern / gradient / metallic / contour into `rest` and sends them
// to `onSetSeriesStyle`, so asking to pattern one bar patterns all six. That is worse than a
// control that does nothing, because it appears to work.
//
// Both halves are checked here, because either alone can pass while the wrong-target write remains:
//   1. the row calls onSetPointStyle (not onSetSeriesStyle), and
//   2. the key it writes moves exactly one bar of the pyramid's twelve.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import type { DataTable, Plot, SeriesStyle } from "@mady/core";
import { tableDatasets } from "@mady/core";
import { buildPlotScene } from "@mady/graphics";
import { PlotFigure } from "./PlotFigure";
import { Inspector } from "./Inspector";
import { galleryItems } from "./gallery";

afterEach(cleanup);
afterEach(() => globalThis.localStorage?.clear());

const SIZE = { width: 620, height: 420 };

const pyramid = (): { plot: Plot; table: DataTable } => {
  const g = galleryItems().find((x) => (x.plot.kind ?? "xy") === "pyramid");
  if (!g) throw new Error("no pyramid gallery fixture — the tests that cover every chart type enumerate from galleryItems()");
  return { plot: g.plot as Plot, table: g.table as DataTable };
};
const target = (table: DataTable) => ({
  colId: tableDatasets(table)[0]!.id,
  rowId: table.rows[1]!.id,
});

/** Only the marks carrying a mark id — the bars, not the frame, the defs or the axis. */
function bars(html: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of html.matchAll(/<(?:rect|path|circle|polygon)\b[^>]*\bid="(mark-[^"]+)"[^>]*>/g)) out[m[1]!] = m[0]!;
  return out;
}

/**
 * How many of the pyramid's bars does this per-point override move?
 *
 * Counts marks by id, never the raw string. A pattern fill adds a `<pattern>` def, which
 * changes the element count and would make a naive diff unreadable, and a def nothing
 * references could be mistaken for a working control.
 */
function barsMovedByPointStyle(patch: SeriesStyle): number {
  const { plot, table } = pyramid();
  const { colId, rowId } = target(table);
  const draw = (p: Plot): string => renderToStaticMarkup(createElement(PlotFigure, { scene: buildPlotScene(table, p, SIZE) }));
  const after = draw({ ...plot, pointStyles: { ...(plot.pointStyles ?? {}), [`${colId}:${rowId}`]: patch } });
  const a = bars(draw(plot)), b = bars(after);
  return [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((k) => a[k] !== b[k]).length;
}

/** Does the changed bar actually use the pattern/gradient it declared? (no orphan defs) */
function patternIsReferenced(patch: SeriesStyle): boolean {
  const { plot, table } = pyramid();
  const { colId, rowId } = target(table);
  const html = renderToStaticMarkup(createElement(PlotFigure, {
    scene: buildPlotScene(table, { ...plot, pointStyles: { ...(plot.pointStyles ?? {}), [`${colId}:${rowId}`]: patch } }, SIZE),
  }));
  const declared = [...html.matchAll(/<(?:pattern|linearGradient)\b[^>]*\bid="([^"]+)"/g)].map((m) => m[1]!);
  const referenced = new Set([...html.matchAll(/url\(#([^)]+)\)/g)].map((m) => m[1]!));
  return declared.length > 0 && declared.every((d) => referenced.has(d));
}

/** Render the pyramid's per-bar panel and record which handler each row calls. */
function perBarPanel(over?: Partial<Plot>) {
  // The per-point panel is unreachable unless both scope toggles are off, and
  // `useWholeSeries` defaults to on and is persisted in localStorage.
  globalThis.localStorage.setItem("mady.applyWholeSeries", "0");
  const { plot: base, table } = pyramid();
  const plot = { ...base, ...over } as Plot;
  const { colId, rowId } = target(table);
  const calls: { where: "POINT" | "SERIES"; keys: string[] }[] = [];
  const h = {
    onSelect: vi.fn(),
    onSetAxis: vi.fn(), onSetAxisLength: vi.fn(), onSetAxisTitleFont: vi.fn(),
    onSetSeriesStyle: (_i: string, p: object) => calls.push({ where: "SERIES", keys: Object.keys(p) }),
    onSetSeriesStyleAll: vi.fn(),
    onSetPointStyle: (_i: string, _r: string, p: object) => calls.push({ where: "POINT", keys: Object.keys(p) }),
    onClearPointStyles: vi.fn(),
    onSetGrid: vi.fn(), onSetFrame: vi.fn(), onSetKind: vi.fn(), onSetBarLayout: vi.fn(), onSetBarShape: vi.fn(), onSetBoxWhisker: vi.fn(),
    onSetPlotOptions: vi.fn(), onSetGraphTitle: vi.fn(), onSetPlotFont: vi.fn(), onHomogenizeFont: vi.fn(),
    onSetLegend: vi.fn(), onSetSignificance: vi.fn(), onApplyPreset: vi.fn(), 
    onApplyUserPreset: vi.fn(), onSaveUserPreset: vi.fn(), onDeleteUserPreset: vi.fn(), onSetProfileDefault: vi.fn(),
    annotationOps: { add: vi.fn(), update: vi.fn(), remove: vi.fn(), reorder: vi.fn(), align: vi.fn(), group: vi.fn(), ungroup: vi.fn(), setLocked: vi.fn(), addImage: vi.fn(), replaceImage: vi.fn() },
  };
  const { container } = render(
    <Inspector activeSection="graphs" selection={{ kind: "series", columnId: colId, rowId, part: "points" } as never}
      plot={plot} table={table} userPresets={[]} profileDefault={null}
      wholeGraph={false} onSetWholeGraph={() => {}} {...h} />,
  );
  /** Drive the row labelled `text`; return where its write went, or null if there is no such row. */
  const drive = (text: string): { where: string; keys: string[] } | null => {
    for (const lab of container.querySelectorAll("label")) {
      if ((lab.querySelector("span:first-child")?.textContent ?? "").trim() !== text) continue;
      const sel = lab.querySelector<HTMLSelectElement>("select");
      const num = lab.querySelector<HTMLInputElement>('input[type="number"], input[type="range"]');
      const col = lab.querySelector<HTMLInputElement>('input[type="color"]');
      calls.length = 0;
      if (sel) {
        const other = [...sel.options].map((o) => o.value).find((v) => v !== sel.value);
        if (other === undefined) continue;
        fireEvent.change(sel, { target: { value: other } });
      } else if (num) {
        fireEvent.change(num, { target: { value: String(Number(num.value || 1) + 2) } });
        fireEvent.blur(num);
      } else if (col) {
        fireEvent.change(col, { target: { value: "#ff0000" } });
      } else continue;
      return calls.length ? { where: calls[0]!.where, keys: calls[0]!.keys } : null;
    }
    return null;
  };
  return { container, drive };
}

describe("pyramid — one bar at a time", () => {
  it("the drawing supports a per-bar fill at all (12 bars, exactly 1 moves)", () => {
    expect(barsMovedByPointStyle({ fillType: "pattern" }),
      "a per-point fillType does not move exactly one of the pyramid's bars").toBe(1);
    expect(patternIsReferenced({ fillType: "pattern", pattern: "dots" }),
      "the <pattern> def is an orphan — nothing on the drawing references it").toBe(true);
  });

  /**
   * Guards the guard. The counter and the driver are first shown to work on a bar chart, the
   * kind whose rows route per-bar through the standard path, so a pass on the pyramid below is
   * not an artefact of a broken counter.
   */
  it("guards the guard — the same rows already route per-bar on a bar chart", () => {
    const g = galleryItems().find((x) => (x.plot.kind ?? "xy") === "bar")!;
    const table = g.table as DataTable, plot = g.plot as Plot;
    const colId = tableDatasets(table)[0]!.id, rowId = table.rows[1]!.id;
    const draw = (p: Plot): string => renderToStaticMarkup(createElement(PlotFigure, { scene: buildPlotScene(table, p, SIZE) }));
    const a = bars(draw(plot));
    const b = bars(draw({ ...plot, pointStyles: { [`${colId}:${rowId}`]: { fillType: "pattern" } } }));
    expect([...new Set([...Object.keys(a), ...Object.keys(b)])].filter((k) => a[k] !== b[k]).length,
      "a bar chart's per-point fillType does not move exactly one bar — the counter is broken").toBe(1);
  });

  // Every row the pyramid's per-bar panel offers must write to the bar, not the series.
  // "Style" and "Contour width" are visible under the default solid fill; the rest only
  // appear once the fill mode is set, so those cases seed it on the point first.
  for (const [label, seed] of [
    ["Style", undefined],
    // Note: the pyramid fixture's fill is two-tone, where the contour is derived and its picker is
    // hidden on purpose. Seed a solid fill or this row is legitimately absent.
    ["Contour", { fillType: "solid" }],
    ["Contour width", undefined],
    ["Pattern", { fillType: "pattern" }],
    ["Density", { fillType: "pattern" }],
    ["Ink", { fillType: "pattern" }],
    ["Background", { fillType: "pattern" }],
    ["Gradient → to", { fillType: "gradient" }],
    ["Angle", { fillType: "gradient" }],
    ["Metal", { fillType: "metallic" }],
    ["Theme", { fillType: "special" }],
  ] as [string, SeriesStyle | undefined][]) {
    it(`"${label}" restyles the selected bar, not the whole series`, () => {
      const { table } = pyramid();
      const { colId, rowId } = target(table);
      const over = seed ? { pointStyles: { [`${colId}:${rowId}`]: seed } } : undefined;
      const hit = perBarPanel(over).drive(label);
      expect(hit, `no "${label}" row on the pyramid's per-bar panel`).not.toBeNull();
      expect(hit!.where, `"${label}" wrote ${hit!.keys.join("+")} to the whole series — every bar changes`).toBe("POINT");
    });
  }

  it("the keys those rows write each move exactly one bar", () => {
    for (const patch of [
      { fillType: "pattern", pattern: "dots" },
      { fillType: "pattern", patternScale: 2.5 },
      { fillType: "pattern", patternColor: "#ff0000" },
      { fillType: "gradient", gradientTo: "#ff0000" },
      { fillType: "gradient", gradientAngle: 135 },
      { fillType: "metallic", metallic: "gold" },
      { fillType: "special", special: "glass" },
      { borderColor: "#ff0000", borderWidth: 3 },
      { borderWidth: 6 },
    ] as SeriesStyle[]) {
      expect(barsMovedByPointStyle(patch),
        `${Object.keys(patch).join("+")} does not move exactly one pyramid bar`).toBe(1);
    }
  });
});
