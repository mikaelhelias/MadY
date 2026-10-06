// @vitest-environment jsdom
// A raincloud's cloud and its inner box must take different fills.
//
// A raincloud series carries three marks — `<id>-cloud`, `<id>-box`, `<id>-rain` — and clicking
// one already selects it by name (`PlotFigure` passes `rowId: m.rowId`). The builder reads a
// per-mark fill for two of them. Guards against the Inspector treating the group as one glyph
// (`glyphSeries`), where every write goes to the series and the cloud and the box can only
// share one fill.
//
// The rain is deliberately not targetable. A per-mark fill on `<id>-rain` moves nothing, so
// it keeps routing to the series; a control that wrote there would silently do nothing.
//
// Both halves are checked here, because broken routing can satisfy either one alone:
//   1. the row writes to the part (onSetPointStyle with that mark's id), and
//   2. the key it writes moves that part and not the other one.
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

const rain = (): { plot: Plot; table: DataTable } => {
  const g = galleryItems().find((x) => (x.plot.kind ?? "xy") === "raincloud");
  if (!g) throw new Error("no raincloud gallery card — this test takes its fixture from galleryItems()");
  return { plot: g.plot as Plot, table: g.table as DataTable };
};

/** The scene's first series and the three mark ids it really draws — never hand-built. */
function parts(): { seriesId: string; cloud: string; box: string; rainId: string } {
  const { plot, table } = rain();
  const s = buildPlotScene(table, plot, SIZE).series[0];
  if (!s) throw new Error("the raincloud fixture draws no series");
  const ids = s.marks.map((m) => String(m.rowId));
  const find = (suffix: string): string => {
    const hit = ids.find((i) => i.endsWith(suffix));
    if (!hit) throw new Error(`the raincloud draws no ${suffix} mark — ids were ${ids.join(", ")}`);
    return hit;
  };
  return { seriesId: s.id, cloud: find("-cloud"), box: find("-box"), rainId: find("-rain") };
}

const draw = (table: DataTable, p: Plot): string =>
  renderToStaticMarkup(createElement(PlotFigure, { scene: buildPlotScene(table, p, SIZE) }));
/** Every drawable element, in order. The raincloud emits no mark ids, so position is the handle. */
const tags = (html: string): string[] =>
  [...html.matchAll(/<(?:rect|path|circle|polygon|ellipse|line)\b[^>]*>/g)].map((m) => m[0]!);
/** Which drawable elements differ? `[-1]` when the element count changed (not comparable). */
function movedIndices(a: string, b: string): number[] {
  const x = tags(a), y = tags(b);
  if (x.length !== y.length) return [-1];
  const out: number[] = [];
  for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) out.push(i);
  return out;
}
/** Which elements does a per-mark override move? */
function movedByPart(markId: string, patch: SeriesStyle): number[] {
  const { plot, table } = rain();
  const { seriesId } = parts();
  return movedIndices(draw(table, plot), draw(table, {
    ...plot, pointStyles: { ...(plot.pointStyles ?? {}), [`${seriesId}:${markId}`]: patch },
  }));
}

/** Render the panel with one part selected, and drive rows by label. */
function panelFor(markId: string | undefined) {
  // Unreachable unless both scope toggles are off; `useWholeSeries` defaults on and persists.
  globalThis.localStorage.setItem("mady.applyWholeSeries", "0");
  const { plot, table } = rain();
  const { seriesId } = parts();
  const calls: { where: "POINT" | "SERIES"; row: string; keys: string[] }[] = [];
  const h = {
    onSelect: vi.fn(),
    onSetAxis: vi.fn(), onSetAxisLength: vi.fn(), onSetAxisTitleFont: vi.fn(),
    onSetSeriesStyle: (_i: string, p: object) => calls.push({ where: "SERIES", row: "", keys: Object.keys(p) }),
    onSetSeriesStyleAll: vi.fn(),
    onSetPointStyle: (_i: string, r: string, p: object) => calls.push({ where: "POINT", row: r, keys: Object.keys(p) }),
    onClearPointStyles: vi.fn(),
    onSetGrid: vi.fn(), onSetFrame: vi.fn(), onSetKind: vi.fn(), onSetBarLayout: vi.fn(), onSetBarShape: vi.fn(), onSetBoxWhisker: vi.fn(),
    onSetPlotOptions: vi.fn(), onSetGraphTitle: vi.fn(), onSetPlotFont: vi.fn(), onHomogenizeFont: vi.fn(),
    onSetLegend: vi.fn(), onSetSignificance: vi.fn(), onApplyPreset: vi.fn(), 
    onApplyUserPreset: vi.fn(), onSaveUserPreset: vi.fn(), onDeleteUserPreset: vi.fn(), onSetProfileDefault: vi.fn(),
    annotationOps: { add: vi.fn(), update: vi.fn(), remove: vi.fn(), reorder: vi.fn(), align: vi.fn(), group: vi.fn(), ungroup: vi.fn(), setLocked: vi.fn(), addImage: vi.fn(), replaceImage: vi.fn() },
  };
  const { container } = render(
    <Inspector activeSection="graphs"
      selection={{ kind: "series", columnId: seriesId, part: "points", ...(markId ? { rowId: markId } : {}) } as never}
      plot={plot} table={table} userPresets={[]} profileDefault={null}
      wholeGraph={false} onSetWholeGraph={() => {}} {...h} />,
  );
  const drive = (text: string): { where: string; row: string; keys: string[] } | null => {
    for (const lab of container.querySelectorAll("label")) {
      if ((lab.querySelector("span:first-child")?.textContent ?? "").trim() !== text) continue;
      const col = lab.querySelector<HTMLInputElement>('input[type="color"]');
      const num = lab.querySelector<HTMLInputElement>('input[type="number"], input[type="range"]');
      const sel = lab.querySelector<HTMLSelectElement>("select");
      calls.length = 0;
      if (col) fireEvent.change(col, { target: { value: "#ff0000" } });
      else if (num) { fireEvent.change(num, { target: { value: String(Number(num.value || 1) + 0.2) } }); fireEvent.blur(num); }
      else if (sel) {
        const other = [...sel.options].map((o) => o.value).find((v) => v !== sel.value);
        if (other === undefined) continue;
        fireEvent.change(sel, { target: { value: other } });
      } else continue;
      return calls.length ? calls[0]! : null;
    }
    return null;
  };
  return { container, drive };
}

describe("raincloud — the cloud and the inner box style apart", () => {
  it("the fixture really draws three separately-named marks", () => {
    const p = parts();
    expect(p.cloud).not.toBe(p.box);
    expect(p.box).not.toBe(p.rainId);
  });

  /** Checks the premise of the tests below — if a per-mark fill moved nothing, every routing
   *  test would be asserting a control that cannot work. And it must move one part, not both. */
  it("the drawing gives the cloud and the box their own fill, and the series key moves both", () => {
    const p = parts();
    const cloudOnly = movedByPart(p.cloud, { fillColor: "#ff0000" });
    const boxOnly = movedByPart(p.box, { fillColor: "#ff0000" });
    expect(cloudOnly.length, "a per-mark fill on the cloud does not move exactly one element").toBe(1);
    expect(boxOnly.length, "a per-mark fill on the inner box does not move exactly one element").toBe(1);
    expect(cloudOnly[0], "the cloud and the inner box are the same element — nothing to style apart").not.toBe(boxOnly[0]);

    const { plot, table } = rain();
    const bothViaSeries = movedIndices(draw(table, plot), draw(table, {
      ...plot, seriesStyles: { ...(plot.seriesStyles ?? {}), [p.seriesId]: { ...(plot.seriesStyles?.[p.seriesId] ?? {}), fillColor: "#ff0000" } },
    }));
    expect(bothViaSeries, "the series fill does not paint both parts — the premise of these tests does not hold")
      .toEqual(expect.arrayContaining([cloudOnly[0]!, boxOnly[0]!]));
  });

  for (const [part, label] of [["cloud", "Fill"], ["cloud", "Colour"], ["cloud", "Opacity"],
                               ["box", "Fill"], ["box", "Colour"], ["box", "Opacity"]] as [("cloud" | "box"), string][]) {
    it(`"${label}" on the ${part} writes to the ${part}, not the whole raincloud`, () => {
      const p = parts();
      const markId = part === "cloud" ? p.cloud : p.box;
      const hit = panelFor(markId).drive(label);
      expect(hit, `no "${label}" row on the raincloud panel`).not.toBeNull();
      expect(hit!.where, `"${label}" wrote ${hit!.keys.join("+")} to the whole series — the ${part} cannot differ`).toBe("POINT");
      expect(hit!.row, `"${label}" targeted the wrong mark`).toBe(markId);
    });
  }

  /**
   * The refusals. These keys move nothing per part — measured one by one — so they must keep
   * going to the series. A control that wrote them to a mark would be a silent no-op.
   */
  it("the keys that do not work per part still go to the series", () => {
    const p = parts();
    for (const label of ["Style", "Contour width", "Smoothness", "Box width", "Shape", "Size"]) {
      const hit = panelFor(p.cloud).drive(label);
      if (!hit) continue; // show-gated in this fixture's fill mode — not this test's business
      expect(hit.where, `"${label}" was routed to one part, where it does nothing`).toBe("SERIES");
    }
  });

  it("those keys really have no effect per part (which is why they route to the series)", () => {
    const p = parts();
    for (const patch of [
      { fillType: "gradient", gradientTo: "#ff0000" },
      { fillType: "metallic", metallic: "gold" },
      { borderColor: "#00ff00" },
      { borderWidth: 5 },
      { symbol: "square" },
      { symbolOpacity: 0.3 },
    ] as SeriesStyle[]) {
      expect(movedByPart(p.cloud, patch),
        `${Object.keys(patch).join("+")} moves the cloud per part, so the part panel should offer it`).toEqual([]);
    }
  });

  /** The rain is not targetable, and that is measured, not assumed. */
  it("the rain takes no per-part fill, so its rows stay series-wide", () => {
    const p = parts();
    for (const patch of [{ fillColor: "#ff0000" }, { fillOpacity: 0.2 }, { color: "#ff0000" }] as SeriesStyle[]) {
      expect(movedByPart(p.rainId, patch),
        `${Object.keys(patch).join("+")} moves the rain per part, so the rain could be targeted too`).toEqual([]);
    }
    const hit = panelFor(p.rainId).drive("Fill");
    expect(hit, "no Fill row on the raincloud panel").not.toBeNull();
    expect(hit!.where, "clicking the rain targeted it with a fill that does nothing").toBe("SERIES");
  });

  it("with no part selected the panel still restyles the whole raincloud", () => {
    const hit = panelFor(undefined).drive("Fill");
    expect(hit, "no Fill row on the raincloud panel").not.toBeNull();
    expect(hit!.where).toBe("SERIES");
  });
});
