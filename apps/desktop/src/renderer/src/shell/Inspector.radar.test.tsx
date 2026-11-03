// @vitest-environment jsdom
// Radar's series panel — which scope toggles and controls it offers, and why.
//
// Radar has the whole-graph toggle, since fanning a style to every polygon changes the drawing.
// It has no whole-series toggle, and that is correct — `buildRadarScene` reads no `pointStyles`
// for its vertices (its one lookup there is a spoke label drag offset), so the row whose off
// state means "just the point you clicked" would govern nothing.
//
// Deliberately absent, because both would be misleading controls. The reasons are asserted
// here, so that if a builder change ever makes them effective this file fails and says so:
//  • a per-series size box: radar's dot size is plot-wide (`radar.dotSize` wins; under it
//    `plotMarkerDefault` takes the first series naming a `symbolSize` for the whole chart).
//  • a per-series dot fill: `resolveSymbol`'s two-tone branch — the house default — discards an
//    explicit `symbolFillColor`, and the mode that would honour it ("open") draws identically to
//    "solid" because radar's scene has no hollow vertex.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import type { DataTable, Plot, SeriesStyle } from "@mady/core";
import { buildPlotScene } from "@mady/graphics";
import { Inspector } from "./Inspector";
import { PlotFigure } from "./PlotFigure";
import { galleryItems } from "./gallery";
import type { GraphSelection } from "./AppShell";

afterEach(cleanup);
afterEach(() => globalThis.localStorage?.clear());

const radar = (): { table: DataTable; plot: Plot } => {
  const it = galleryItems().find((i) => (i.plot.kind ?? "xy") === "radar")!;
  return { table: it.table, plot: it.plot };
};

const polygons = (table: DataTable, plot: Plot) =>
  buildPlotScene(table, plot, { width: 360, height: 250 }).radar?.polygons ?? [];
const dotSize = (table: DataTable, plot: Plot) =>
  buildPlotScene(table, plot, { width: 360, height: 250 }).radar?.dotSize;

function panel(plot: Plot, table: DataTable, seriesId: string) {
  const sel: GraphSelection = { kind: "series", columnId: seriesId, part: "points" };
  const { container } = render(
    <Inspector
      activeSection="graphs"
      selection={sel}
      plot={plot}
      table={table}
      userPresets={[]}
      profileDefault={null}
      onSelect={vi.fn()}
      onSetAxis={vi.fn()} onSetAxisLength={vi.fn()} onSetAxisTitleFont={vi.fn()}
      onSetSeriesStyle={vi.fn()} onSetSeriesStyleAll={vi.fn()} onSetPointStyle={vi.fn()} onClearPointStyles={vi.fn()}
      onSetGrid={vi.fn()} onSetFrame={vi.fn()} onSetKind={vi.fn()} onSetBarLayout={vi.fn()} onSetBarShape={vi.fn()} onSetBoxWhisker={vi.fn()}
      onSetPlotOptions={vi.fn()} onSetGraphTitle={vi.fn()} onSetPlotFont={vi.fn()} onHomogenizeFont={vi.fn()}
      onSetLegend={vi.fn()} onSetSignificance={vi.fn()} onApplyPreset={vi.fn()} 
      onApplyUserPreset={vi.fn()} onSaveUserPreset={vi.fn()} onDeleteUserPreset={vi.fn()} onSetProfileDefault={vi.fn()}
      annotationOps={{ add: vi.fn(), update: vi.fn(), remove: vi.fn(), reorder: vi.fn(), align: vi.fn(), group: vi.fn(), ungroup: vi.fn(), setLocked: vi.fn(), addImage: vi.fn(), replaceImage: vi.fn() }}
    />,
  );
  return container;
}

/** The control on the `.frow` whose own label is exactly `label`. */
function control(container: HTMLElement, label: string): HTMLElement | undefined {
  for (const row of container.querySelectorAll<HTMLElement>(".frow")) {
    if (((row.querySelector(":scope > span")?.textContent) ?? "").trim() !== label) continue;
    const el = row.querySelector<HTMLElement>("input, select");
    if (el) return el;
  }
  return undefined;
}

describe("radar series panel — scope", () => {
  it('offers "Apply to whole graph", and a fan-out reaches every polygon', () => {
    const { table, plot } = radar();
    const polys = polygons(table, plot);
    expect(polys.length, "the radar fixture needs two series to show a fan-out").toBeGreaterThan(1);

    expect(panel(plot, table, polys[0]!.id).querySelector(".ppoint-graph"), "radar has no whole-graph scope toggle").toBeTruthy();

    const before = polys.map((p) => p.color);
    expect(new Set(before).size, "fixture check: the polygons must not already share a colour").toBeGreaterThan(1);
    const fanned: Record<string, Partial<SeriesStyle>> = Object.fromEntries(polys.map((p) => [p.id, { color: "#654321" }]));
    expect(
      polygons(table, { ...plot, seriesStyles: fanned }).map((p) => p.color),
      "a whole-graph fan-out did not reach every polygon",
    ).toEqual(before.map(() => "#654321"));
  });

  it('withholds "Apply to whole series" — radar has no per-vertex style layer to govern', () => {
    const { table, plot } = radar();
    expect(panel(plot, table, polygons(table, plot)[0]!.id).querySelector(".ppoint-series")).toBeNull();
  });
});

describe("radar series panel — the two controls deliberately not offered", () => {
  it("no per-series Size box, because a second series' symbolSize is ignored", () => {
    const { table, plot } = radar();
    const [a, b] = polygons(table, plot);
    expect(control(panel(plot, table, b!.id), "Size"), "a per-series Size box cannot work on radar — see the header").toBeUndefined();

    // The reason, asserted: with the first series naming a size, the second's is never read.
    const withFirst = { ...(plot.seriesStyles ?? {}), [a!.id]: { ...(plot.seriesStyles?.[a!.id] ?? {}), symbolSize: 3 } };
    const bSmall = { ...plot, radar: { ...(plot.radar ?? {}), dotSize: undefined }, seriesStyles: { ...withFirst, [b!.id]: { symbolSize: 4 } } };
    const bHuge = { ...plot, radar: { ...(plot.radar ?? {}), dotSize: undefined }, seriesStyles: { ...withFirst, [b!.id]: { symbolSize: 40 } } };
    expect(dotSize(table, bSmall), "fixture check: the first series' size must be the one in force").toBe(3);
    expect(dotSize(table, bHuge), "the second series' symbolSize is read after all — the Size box may now be real").toBe(3);
  });

  it("no per-series dot Fill, because the default two-tone mode discards symbolFillColor", () => {
    const { table, plot } = radar();
    const id = polygons(table, plot)[0]!.id;
    expect(control(panel(plot, table, id), "Dot fill"), "a Dot fill swatch is inert under the default look — see the header").toBeUndefined();

    // The reason, asserted: two-tone derives the vertex colours from the hue and ignores the
    // explicit fill colour, while "open" produces the same vertex as "solid".
    const vfill = (style: Partial<SeriesStyle>) =>
      polygons(table, { ...plot, seriesStyles: { ...(plot.seriesStyles ?? {}), [id]: style } })[0]!.vertexFill;
    expect(vfill({ symbolFill: "twotone", symbolFillColor: "#123456" }), "two-tone now honours symbolFillColor — a Dot fill control may be real").not.toBe("#123456");
    expect(vfill({ symbolFill: "open" })).toBe(vfill({ symbolFill: "solid" }));
  });
});

// ---------------------------------------------------------------------------------------------
// Discoverability. Hiding the series list on pie · radar · scatter3d removes no
// capability (clicking the element still opens its editor) but removes the only sign that the
// capability exists, so the panel says so. The note is only accurate while the click path it
// describes is real, so this checks both halves together.
describe("series-list note where the list is withheld", () => {
  // Pie is absent on purpose: its own Chart section already says "Click a slice to set its
  // colour, explode, border, and label.", so a second sentence would be noise. Its click path
  // is still checked below.
  const NAMED: Record<string, string> = { radar: "a polygon", scatter3d: "a point" };

  it("tells the user which element to click", () => {
    for (const [kind, noun] of Object.entries(NAMED)) {
      const item = galleryItems().find((i) => (i.plot.kind ?? "xy") === kind)!;
      const container = render(
        <Inspector
          activeSection="graphs"
          selection={{ kind: "plot" } as GraphSelection}
          plot={item.plot}
          table={item.table}
          userPresets={[]}
          profileDefault={null}
          onSelect={vi.fn()}
          onSetAxis={vi.fn()} onSetAxisLength={vi.fn()} onSetAxisTitleFont={vi.fn()}
          onSetSeriesStyle={vi.fn()} onSetSeriesStyleAll={vi.fn()} onSetPointStyle={vi.fn()} onClearPointStyles={vi.fn()}
          onSetGrid={vi.fn()} onSetFrame={vi.fn()} onSetKind={vi.fn()} onSetBarLayout={vi.fn()} onSetBarShape={vi.fn()} onSetBoxWhisker={vi.fn()}
          onSetPlotOptions={vi.fn()} onSetGraphTitle={vi.fn()} onSetPlotFont={vi.fn()} onHomogenizeFont={vi.fn()}
          onSetLegend={vi.fn()} onSetSignificance={vi.fn()} onApplyPreset={vi.fn()} 
          onApplyUserPreset={vi.fn()} onSaveUserPreset={vi.fn()} onDeleteUserPreset={vi.fn()} onSetProfileDefault={vi.fn()}
          annotationOps={{ add: vi.fn(), update: vi.fn(), remove: vi.fn(), reorder: vi.fn(), align: vi.fn(), group: vi.fn(), ungroup: vi.fn(), setLocked: vi.fn(), addImage: vi.fn(), replaceImage: vi.fn() }}
        />,
      ).container;
      // The rail hides non-active-tab sections, so read the DOM rather than what is visible.
      const text = (container.textContent ?? "").replace(/\s+/g, " ");
      expect(text, `${kind}: the panel does not tell the user what to click`).toContain(`Click ${noun} on the graph to style it`);
      cleanup();
    }
  });

  it("says nothing on the kinds that DO have a series list", () => {
    for (const kind of ["xy", "bar", "pie"]) {
      const item = galleryItems().find((i) => (i.plot.kind ?? "xy") === kind)!;
      const container = render(
        <Inspector
          activeSection="graphs"
          selection={{ kind: "plot" } as GraphSelection}
          plot={item.plot}
          table={item.table}
          userPresets={[]}
          profileDefault={null}
          onSelect={vi.fn()}
          onSetAxis={vi.fn()} onSetAxisLength={vi.fn()} onSetAxisTitleFont={vi.fn()}
          onSetSeriesStyle={vi.fn()} onSetSeriesStyleAll={vi.fn()} onSetPointStyle={vi.fn()} onClearPointStyles={vi.fn()}
          onSetGrid={vi.fn()} onSetFrame={vi.fn()} onSetKind={vi.fn()} onSetBarLayout={vi.fn()} onSetBarShape={vi.fn()} onSetBoxWhisker={vi.fn()}
          onSetPlotOptions={vi.fn()} onSetGraphTitle={vi.fn()} onSetPlotFont={vi.fn()} onHomogenizeFont={vi.fn()}
          onSetLegend={vi.fn()} onSetSignificance={vi.fn()} onApplyPreset={vi.fn()} 
          onApplyUserPreset={vi.fn()} onSaveUserPreset={vi.fn()} onDeleteUserPreset={vi.fn()} onSetProfileDefault={vi.fn()}
          annotationOps={{ add: vi.fn(), update: vi.fn(), remove: vi.fn(), reorder: vi.fn(), align: vi.fn(), group: vi.fn(), ungroup: vi.fn(), setLocked: vi.fn(), addImage: vi.fn(), replaceImage: vi.fn() }}
        />,
      ).container;
      expect((container.textContent ?? "").replace(/\s+/g, " ")).not.toContain("on the graph to style it");
      cleanup();
    }
  });
  // The other half: the note is only accurate while the click path it points at is real. Render
  // the actual figure and click its marks — at least one must open a per-element editor.
  it("and that click path really does open a per-element editor", () => {
    for (const kind of ["pie", "radar", "scatter3d"]) {
      const item = galleryItems().find((i) => (i.plot.kind ?? "xy") === kind)!;
      const scene = buildPlotScene(item.table, item.plot, { width: 360, height: 250 });
      const picks: { kind: string }[] = [];
      const { container } = render(
        <PlotFigure scene={scene} zoom={1} onSelect={(s: GraphSelection) => picks.push(s as { kind: string })} />,
      );
      for (const el of container.querySelectorAll("path, circle, polygon")) fireEvent.click(el);
      // Note: narrow on purpose. The legend also selects a series, as `{kind:"series", columnId}`
      // with no `part` — so accepting any series selection would let a legend click stand in for
      // the mark the note actually points at. A slice reports `pie-slice`; a radar polygon and a
      // 3-D point both carry `part: "points"`.
      const perElement = picks.filter((p) =>
        kind === "pie" ? p.kind === "pie-slice" : p.kind === "series" && (p as { part?: string }).part === "points",
      );
      expect(perElement.length, `${kind}: clicking its marks opens no per-element editor, so the note is misleading`).toBeGreaterThan(0);
      cleanup();
    }
  });
});
