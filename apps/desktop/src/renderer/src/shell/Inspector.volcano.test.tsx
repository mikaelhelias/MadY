// @vitest-environment jsdom
// Volcano's per-point colour: the control exists, and `fillColor` is another name for it.
//
// `pointStyles.color` and `pointStyles.fillColor` both change a volcano's drawing, and neither
// has a row on the default (whole-series) panel. Neither needs one, and this file states why as
// executable checks:
//
//  1. `pointStyles.color` has a control. The per-point panel's "Colour" row writes it. The row
//     is gated on `!(volcano && !perPoint)`, so it appears only once a single point is
//     selected — as does `symbolOutline`, the other row carrying that gate.
//
//  2. `pointStyles.fillColor` is an alias. Under the default two-tone fill it renders byte for byte
//     the same as `color`; under `open` it does nothing (that is `symbolFillColor`, which has its
//     own control); under `solid` it is the one distinct case, and `color` + `symbolOutline` —
//     both already on the panel — reproduce it exactly.
//
// So there is no separate control. A "Fill colour" row would duplicate "Colour" in the default
// fill mode, do nothing in another, and be reachable in the third — two names for one result.
//
// If any of these stops being true this file fails, and the control is needed.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import type { DataTable, Plot, SeriesStyle } from "@mady/core";
import { buildPlotScene } from "@mady/graphics";
import { PlotFigure } from "./PlotFigure";
import { Inspector } from "./Inspector";
import { galleryItems } from "./gallery";

afterEach(cleanup);
afterEach(() => globalThis.localStorage?.clear());

const SIZE = { width: 620, height: 420 };
const volcano = (): { plot: Plot; table: DataTable } => {
  const g = galleryItems().find((x) => (x.plot.kind ?? "xy") === "volcano");
  if (!g) throw new Error("no volcano gallery fixture");
  return { plot: g.plot as Plot, table: g.table as DataTable };
};
/** The series id and a mark id the scene really draws — never hand-built. */
function live(): { seriesId: string; rowId: string; markId: string } {
  const { plot, table } = volcano();
  const s = buildPlotScene(table, plot, SIZE).series[0];
  if (!s) throw new Error("the volcano fixture draws no series");
  const m = s.marks.find((x) => x.rowId != null);
  if (!m) throw new Error("the volcano fixture draws no marks");
  return { seriesId: s.id, rowId: String(m.rowId), markId: `mark-${s.id}-${String(m.rowId)}` };
}

/** One gene's rendered group, verbatim — the unit the two keys are compared on. */
function markup(patch: SeriesStyle | null): string {
  const { plot, table } = volcano();
  const { seriesId, rowId, markId } = live();
  const p: Plot = patch
    ? { ...plot, pointStyles: { ...(plot.pointStyles ?? {}), [`${seriesId}:${rowId}`]: patch } }
    : plot;
  const html = renderToStaticMarkup(createElement(PlotFigure, { scene: buildPlotScene(table, p, SIZE) }));
  const i = html.indexOf(`id="${markId}"`);
  if (i < 0) throw new Error(`the lookup missed its target: no ${markId} in the figure`);
  return html.slice(html.lastIndexOf("<g", i), html.indexOf("</g>", i) + 4);
}

describe("volcano — the per-point Colour control, and fillColor as its alias", () => {
  it("guards the lookup — the mark really is on the page and the fixture is two-tone by default", () => {
    const base = markup(null);
    expect(base).toContain("<circle");
    // A two-tone marker derives a light fill and a darker stroke from one colour: they differ.
    const fill = /fill="([^"]+)"/.exec(base)?.[1];
    const stroke = /stroke="([^"]+)"/.exec(base)?.[1];
    expect(fill, "the fixture's marker is not two-tone — the alias cases below do not hold").not.toBe(stroke);
  });

  it("the per-point panel has a Colour control, and it writes pointStyles.color", () => {
    // Unreachable unless both scope toggles are off; `useWholeSeries` defaults to on and persists.
    globalThis.localStorage.setItem("mady.applyWholeSeries", "0");
    const { plot, table } = volcano();
    const { seriesId, rowId } = live();
    const calls: { where: string; keys: string[] }[] = [];
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
      <Inspector activeSection="graphs" selection={{ kind: "series", columnId: seriesId, rowId, part: "points" } as never}
        plot={plot} table={table} userPresets={[]} profileDefault={null}
        wholeGraph={false} onSetWholeGraph={() => {}} {...h} />,
    );
    let drove = false;
    for (const lab of container.querySelectorAll("label")) {
      if ((lab.querySelector("span:first-child")?.textContent ?? "").trim() !== "Colour") continue;
      const col = lab.querySelector<HTMLInputElement>('input[type="color"]');
      expect(col, "the volcano per-point Colour row has no colour input").not.toBeNull();
      fireEvent.change(col!, { target: { value: "#123456" } });
      drove = true;
      break;
    }
    expect(drove, "no Colour row on the volcano per-point panel — pointStyles.color would have no control").toBe(true);
    expect(calls, "the Colour row wrote nothing").not.toHaveLength(0);
    expect(calls[0]!.where, "the volcano Colour row does not target the clicked point").toBe("POINT");
    expect(calls[0]!.keys, "the volcano Colour row does not write `color`").toContain("color");
  });

  it("under the default (two-tone) fill, fillColor renders byte for byte the same as color", () => {
    // Both must actually move the marker first, or "identical" is two no-ops matching.
    expect(markup({ fillColor: "#ff0000" }), "fillColor moves nothing here").not.toBe(markup(null));
    expect(markup({ color: "#ff0000" }), "color moves nothing here").not.toBe(markup(null));
    expect(markup({ fillColor: "#ff0000" }),
      "fillColor and color differ under two-tone — fillColor may need its own control")
      .toBe(markup({ color: "#ff0000" }));
  });

  it("under an open marker, fillColor does nothing at all (symbolFillColor is that control)", () => {
    expect(markup({ symbolFill: "open", fillColor: "#ff0000" }),
      "fillColor moves an open marker — it may need its own control")
      .toBe(markup({ symbolFill: "open" }));
    // ...and the control that does paint a hollow interior is a different key, which has a row.
    expect(markup({ symbolFill: "open", symbolFillColor: "#ff0000" }))
      .not.toBe(markup({ symbolFill: "open" }));
  });

  it("under a solid marker fillColor is distinct — and Colour + Outline colour reproduce it exactly", () => {
    const viaFillColor = markup({ symbolFill: "solid", fillColor: "#ff0000" });
    expect(viaFillColor, "fillColor is not distinct under solid").not.toBe(markup({ symbolFill: "solid", color: "#ff0000" }));

    // The outline colour the zone leaves behind, read off the drawing rather than assumed.
    const zoneStroke = /stroke="([^"]+)"/.exec(markup({ symbolFill: "solid", fillColor: "#ff0000" }))?.[1];
    expect(zoneStroke, "could not read the solid marker's outline colour").toBeTruthy();
    expect(markup({ symbolFill: "solid", color: "#ff0000", symbolOutline: zoneStroke }),
      "Colour + Outline colour do not reproduce fillColor — fillColor needs its own control")
      .toBe(viaFillColor);
  });
});
