// @vitest-environment jsdom
// Options the builder honours that each need a control to write them.
//
// Each (option × chart kind) pair below changes the drawing and needs a control on that kind's
// panel. This file checks both halves per pair:
//   1. the option changes the drawing on that kind, and
//   2. a labelled row on that kind's panel writes it.
//
// Related pairs that change the drawing but need no row of their own:
//   `seriesStyles.lineWidth` × bar · estimation · forest · scatter — it only supplies the
//     error-bar thickness default, and `errorWidth` has its own row (reachable in effect).
//   `pointStyles.color` / `fillColor` / `symbolOutline` and `seriesStyles.borderWidth` × volcano —
//     the rows exist, behind a single-point selection (`Inspector.volcano.test.tsx`).
//   `seriesStyles.symbolSize` × radar — with `radar.dotSize` set, the plot-wide dot size wins
//     and a per-series row would have no effect, so there is none.
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
const pick = (k: string): { plot: Plot; table: DataTable } => {
  const g = galleryItems().find((x) => (x.plot.kind ?? "xy") === k);
  if (!g) throw new Error(`no ${k} gallery fixture`);
  return { plot: g.plot as Plot, table: g.table as DataTable };
};
const draw = (t: DataTable, p: Plot): string =>
  renderToStaticMarkup(createElement(PlotFigure, { scene: buildPlotScene(t, p, SIZE) }));

/**
 * Style every dataset, not `scene.series[0]`.
 * A radar's scene carries no `series` at all, so a series[0] key writes to nothing and the
 * option would wrongly read as inert.
 */
const allStyled = (t: DataTable, p: Plot, patch: SeriesStyle): Plot =>
  ({ ...p, seriesStyles: Object.fromEntries(tableDatasets(t).map((d) => [d.id, { ...(p.seriesStyles?.[d.id] ?? {}), ...patch }])) }) as Plot;

/** Half 1 — does the drawing honour it? `from`/`to` differ only in the option under test. */
function movesDrawing(kind: string, from: SeriesStyle, to: SeriesStyle): boolean {
  const { plot, table } = pick(kind);
  return draw(table, allStyled(table, plot, from)) !== draw(table, allStyled(table, plot, to));
}

/** Half 2 — does a labelled row on this kind's panel write that key? */
/** Note: ridgeline reaches `areaFillFields` from the line part, not the points part. */
const PART_FOR = (kind: string): "points" | "line" => (kind === "ridgeline" ? "line" : "points");

function panelWrites(kind: string, label: string, seed?: SeriesStyle): string[] {
  const { plot: base, table } = pick(kind);
  const plot = seed ? allStyled(table, base, seed) : base;
  const ds = tableDatasets(table)[0];
  const keys: string[] = [];
  const h = {
    onSelect: vi.fn(),
    onSetAxis: vi.fn(), onSetAxisLength: vi.fn(), onSetAxisTitleFont: vi.fn(),
    onSetSeriesStyle: (_i: string, p: object) => keys.push(...Object.keys(p)),
    onSetSeriesStyleAll: (_i: string[], p: object) => keys.push(...Object.keys(p)),
    onSetPointStyle: (_i: string, _r: string, p: object) => keys.push(...Object.keys(p)),
    onClearPointStyles: vi.fn(),
    onSetGrid: vi.fn(), onSetFrame: vi.fn(), onSetKind: vi.fn(), onSetBarLayout: vi.fn(), onSetBarShape: vi.fn(), onSetBoxWhisker: vi.fn(),
    onSetPlotOptions: vi.fn(), onSetGraphTitle: vi.fn(), onSetPlotFont: vi.fn(), onHomogenizeFont: vi.fn(),
    onSetLegend: vi.fn(), onSetSignificance: vi.fn(), onApplyPreset: vi.fn(), 
    onApplyUserPreset: vi.fn(), onSaveUserPreset: vi.fn(), onDeleteUserPreset: vi.fn(), onSetProfileDefault: vi.fn(),
    annotationOps: { add: vi.fn(), update: vi.fn(), remove: vi.fn(), reorder: vi.fn(), align: vi.fn(), group: vi.fn(), ungroup: vi.fn(), setLocked: vi.fn(), addImage: vi.fn(), replaceImage: vi.fn() },
  };
  const { container } = render(
    <Inspector activeSection="graphs"
      selection={{ kind: "series", columnId: ds?.id ?? "", part: PART_FOR(kind) } as never}
      plot={plot} table={table} userPresets={[]} profileDefault={null}
      wholeGraph={false} onSetWholeGraph={() => {}} {...h} />,
  );
  for (const lab of container.querySelectorAll("label")) {
    if ((lab.querySelector("span:first-child")?.textContent ?? "").trim() !== label) continue;
    const sel = lab.querySelector<HTMLSelectElement>("select");
    const num = lab.querySelector<HTMLInputElement>('input[type="number"], input[type="range"]');
    const col = lab.querySelector<HTMLInputElement>('input[type="color"]');
    if (sel) {
      const other = [...sel.options].map((o) => o.value).find((v) => v !== sel.value);
      if (other !== undefined) fireEvent.change(sel, { target: { value: other } });
    } else if (num) { fireEvent.change(num, { target: { value: String(Number(num.value || 1) + 1) } }); fireEvent.blur(num); }
    else if (col) { fireEvent.change(col, { target: { value: "#ff0000" } }); }
    break;
  }
  cleanup();
  return keys;
}

/** kind · panel label · the key it must write · two styles that differ only in that option. */
const CELLS: [string, string, string, SeriesStyle, SeriesStyle, SeriesStyle | undefined][] = [
  // area + ridgeline: the Style select must offer metallic/special, or neither the mode nor
  // its own row can be reached — while the builder honours both.
  ["area", "Metal", "metallic", { fillType: "metallic", metallic: "silver" }, { fillType: "metallic", metallic: "gold" }, { fillType: "metallic" }],
  ["area", "Theme", "special", { fillType: "special", special: "cards" }, { fillType: "special", special: "galaxy" }, { fillType: "special" }],
  ["ridgeline", "Metal", "metallic", { fillType: "metallic", metallic: "silver" }, { fillType: "metallic", metallic: "gold" }, { fillType: "metallic" }],
  ["ridgeline", "Theme", "special", { fillType: "special", special: "cards" }, { fillType: "special", special: "galaxy" }, { fillType: "special" }],
  // radar's vertex markers need their own fill controls.
  // Note: twotone vs open, not solid vs open: on a radar a solid and an open vertex render
  // identically, so that pair would measure the option as inert and refuse a real control.
  ["radar", "Marker fill", "symbolFill", { symbolFill: "twotone" }, { symbolFill: "open" }, undefined],
  ["radar", "Fill lightness", "twoToneTint", { symbolFill: "twotone", twoToneTint: 0.7 }, { symbolFill: "twotone", twoToneTint: 0.15 }, { symbolFill: "twotone" }],
  ["radar", "Edge darkness", "twoToneShade", { symbolFill: "twotone", twoToneShade: 0.35 }, { symbolFill: "twotone", twoToneShade: 0.85 }, { symbolFill: "twotone" }],
  // bubble · histogram · volcano: the builder draws a real second value axis
  // (6-7 ticks appear), so `supportsY2` must not withhold the control.
  ["bubble", "Plot on", "axis", { axis: "y" }, { axis: "y2" }, undefined],
  ["histogram", "Plot on", "axis", { axis: "y" }, { axis: "y2" }, undefined],
  ["volcano", "Plot on", "axis", { axis: "y" }, { axis: "y2" }, undefined],
  // box · violin · column scatter: the drawing has a right axis and the series panel the same
  // "Plot on" row the XY family has.
  ["box", "Plot on", "axis", { axis: "y" }, { axis: "y2" }, undefined],
  ["violin", "Plot on", "axis", { axis: "y" }, { axis: "y2" }, undefined],
  ["scatter", "Plot on", "axis", { axis: "y" }, { axis: "y2" }, undefined],
  // the raincloud's rain needs a fill mode and an error-bar colour beside Shape/Size/Opacity.
  ["raincloud", "Marker fill", "symbolFill", { symbolFill: "solid" }, { symbolFill: "open" }, undefined],
  ["raincloud", "Error-bar colour", "errorColor", { errorColor: "#111111" }, { errorColor: "#ff0000" }, undefined],
];

describe("options that move the drawing — a control writes each one", () => {
  for (const [kind, label, key, from, to, seed] of CELLS) {
    it(`${kind}: "${label}" writes ${key}, and ${key} changes the drawing`, () => {
      expect(movesDrawing(kind, from, to),
        `${key} does not change a ${kind}, so its "${label}" row would do nothing`).toBe(true);
      expect(panelWrites(kind, label, seed),
        `${kind} has no "${label}" row writing ${key}`).toContain(key);
    });
  }

  /**
   * Guards against the lollipop's Outline width writing to the wrong target. `borderWidth` is
   * not in the base highlight set, so `applyStyle` could send it to the whole series, and thickening one lollipop would thicken every one.
   */
  it("lollipop: Outline width targets the clicked mark, not the whole series", () => {
    globalThis.localStorage.setItem("mady.applyWholeSeries", "0");
    const { plot, table } = pick("lollipop");
    // Resolve the key the way `optionEffects.liveKey` does — scene first, table as the
    // fallback. A lollipop's scene carries no mark with a rowId, and assuming series[0] would
    // address the wrong mark.
    const scene = buildPlotScene(table, plot, SIZE);
    const drawn = scene.series.flatMap((se) => se.marks.filter((m) => m.rowId != null).map((m) => ({ id: se.id, rowId: String(m.rowId) })))[0];
    const ds0 = tableDatasets(table)[0], row0 = table.rows[0];
    const s0 = drawn ?? (ds0 && row0 ? { id: ds0.id, rowId: row0.id } : undefined);
    if (!s0) throw new Error("the lollipop fixture has no addressable point");
    const rowId = s0.rowId;

    // The drawing supports it: a per-mark override moves exactly one element.
    const before = draw(table, plot);
    const after = draw(table, { ...plot, pointStyles: { [`${s0.id}:${rowId}`]: { borderWidth: 6 } } } as Plot);
    expect(after, "a per-point borderWidth does nothing on a lollipop").not.toBe(before);

    const calls: string[] = [];
    const h = {
      onSelect: vi.fn(),
      onSetAxis: vi.fn(), onSetAxisLength: vi.fn(), onSetAxisTitleFont: vi.fn(),
      onSetSeriesStyle: () => calls.push("SERIES"),
      onSetSeriesStyleAll: vi.fn(),
      onSetPointStyle: () => calls.push("POINT"),
      onClearPointStyles: vi.fn(),
      onSetGrid: vi.fn(), onSetFrame: vi.fn(), onSetKind: vi.fn(), onSetBarLayout: vi.fn(), onSetBarShape: vi.fn(), onSetBoxWhisker: vi.fn(),
      onSetPlotOptions: vi.fn(), onSetGraphTitle: vi.fn(), onSetPlotFont: vi.fn(), onHomogenizeFont: vi.fn(),
      onSetLegend: vi.fn(), onSetSignificance: vi.fn(), onApplyPreset: vi.fn(), 
      onApplyUserPreset: vi.fn(), onSaveUserPreset: vi.fn(), onDeleteUserPreset: vi.fn(), onSetProfileDefault: vi.fn(),
      annotationOps: { add: vi.fn(), update: vi.fn(), remove: vi.fn(), reorder: vi.fn(), align: vi.fn(), group: vi.fn(), ungroup: vi.fn(), setLocked: vi.fn(), addImage: vi.fn(), replaceImage: vi.fn() },
    };
    const { container } = render(
      <Inspector activeSection="graphs"
        selection={{ kind: "series", columnId: s0.id, rowId, part: "points" } as never}
        plot={plot} table={table} userPresets={[]} profileDefault={null}
        wholeGraph={false} onSetWholeGraph={() => {}} {...h} />,
    );
    let drove = false;
    for (const lab of container.querySelectorAll("label")) {
      if ((lab.querySelector("span:first-child")?.textContent ?? "").trim() !== "Outline width") continue;
      const num = lab.querySelector<HTMLInputElement>('input[type="number"]');
      if (!num) break;
      fireEvent.change(num, { target: { value: "6" } });
      fireEvent.blur(num);
      drove = true;
      break;
    }
    expect(drove, "no Outline width row on the lollipop panel").toBe(true);
    expect(calls[0], "Outline width restyled every lollipop instead of the one clicked").toBe("POINT");
  });
});
