// @vitest-environment jsdom
/**
 * Two controls that must keep changing the drawing.
 *
 * Both guard the same shape of defect: a value earlier in a `??` chain permanently shadowing the
 * control, so the slider moves and the picture does not.
 *
 *   column scatter "Width"   with `step = min(DOT, 2·maxHalf/(k−1))` and DOT a fixed 6px, `maxHalf`
 *                            following the slider would only cap the spacing, and with a few
 *                            replicates per 7px row the constant would always win.
 *   network "Two-tone fill"  a two-tone branch placed after `?? cfg.nodeStroke` would never apply,
 *                            because the network house default always sets `nodeStroke: "var(--bg)"`.
 *
 * Note: measured by rendering, and across a range. Comparing scenes would pass on both of these (a
 * scene echoes the spec it was handed), and comparing two neighbouring values would not reliably
 * detect either.
 */
import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { render } from "@testing-library/react";
import type { DataTable, Plot } from "@mady/core";
import { buildPlotScene } from "@mady/graphics";
import { galleryItems } from "./gallery";
import { PlotFigure } from "./PlotFigure";
import { Inspector } from "./Inspector";

/** Every Inspector callback as a spy — this file asserts what is drawn, never a mutation. */
const inspectorHandlers = () => ({
  onSelect: vi.fn(),
  onSetAxis: vi.fn(), onSetAxisLength: vi.fn(), onSetAxisTitleFont: vi.fn(),
  onSetSeriesStyle: vi.fn(), onSetSeriesStyleAll: vi.fn(), onSetPointStyle: vi.fn(), onClearPointStyles: vi.fn(),
  onSetGrid: vi.fn(), onSetFrame: vi.fn(), onSetKind: vi.fn(), onSetBarLayout: vi.fn(), onSetBarShape: vi.fn(), onSetBoxWhisker: vi.fn(),
  onSetPlotOptions: vi.fn(), onSetGraphTitle: vi.fn(), onSetPlotFont: vi.fn(), onHomogenizeFont: vi.fn(),
  onSetLegend: vi.fn(), onSetSignificance: vi.fn(), onApplyPreset: vi.fn(), 
  onApplyUserPreset: vi.fn(), onSaveUserPreset: vi.fn(), onDeleteUserPreset: vi.fn(), onSetProfileDefault: vi.fn(),
  annotationOps: { add: vi.fn(), update: vi.fn(), remove: vi.fn(), reorder: vi.fn(), align: vi.fn(), group: vi.fn(), ungroup: vi.fn(), setLocked: vi.fn(), addImage: vi.fn(), replaceImage: vi.fn() },
});

const SIZE = { width: 620, height: 420 };

function card(kind: string): { table: DataTable; plot: Plot } {
  const item = galleryItems().find((i) => (i.plot.kind ?? "xy") === kind);
  if (!item) throw new Error(`no gallery card for ${kind}`);
  return item as unknown as { table: DataTable; plot: Plot };
}
const draw = (table: DataTable, plot: Plot, size = SIZE): string =>
  renderToStaticMarkup(createElement(PlotFigure, { scene: buildPlotScene(table, plot, size) }));

/** Set `boxWidth` on every series — the "Width" slider's target. */
function width(plot: Plot, v: number): Plot {
  const ss: Record<string, unknown> = { ...((plot.seriesStyles ?? {}) as Record<string, unknown>) };
  for (const id of Object.keys(ss)) ss[id] = { ...(ss[id] as object), boxWidth: v };
  return { ...plot, seriesStyles: ss } as Plot;
}

describe("column scatter — the Width slider spreads the swarm", () => {
  it("narrow and wide draw different figures", () => {
    const { table, plot } = card("scatter");
    expect(
      draw(table, width(plot, 0.9)),
      'the "Width" slider does nothing on a column scatter — 0.2 and 0.9 render identically',
    ).not.toBe(draw(table, width(plot, 0.2)));
  });

  it("…and it is monotonic, not just different: wider spreads the dots further", () => {
    // "The markup changed" is not the claim. Read the actual dot spread back out of the scene:
    // a wider setting must put the outermost dot further from the column centre. A change that is
    // merely *different* could be a rounding wobble.
    const { table, plot } = card("scatter");
    const spreadOf = (v: number): number => {
      const scene = buildPlotScene(table, width(plot, v), SIZE);
      const mark = scene.series.flatMap((s) => s.marks).find((m) => (m.points?.length ?? 0) > 2);
      if (!mark?.points) throw new Error("no swarm with enough points — the fixture cannot exhibit this");
      return Math.max(...mark.points.map((p) => Math.abs(p.cx - mark.cx)));
    };
    const narrow = spreadOf(0.2);
    const wide = spreadOf(0.9);
    expect(wide, `wider Width must spread the dots further (0.2 → ${narrow}px, 0.9 → ${wide}px)`).toBeGreaterThan(narrow);
  });

  it("a flipped column scatter keeps it — the control must not depend on orientation", () => {
    const { table, plot } = card("scatter");
    const flipped = { ...plot, barOrientation: "horizontal" } as Plot;
    expect(draw(table, width(flipped, 0.9))).not.toBe(draw(table, width(flipped, 0.2)));
  });

  it("the 0.5 default is unchanged — no saved figure moves", () => {
    // The spread multiplier is 1 at the default, so this must be byte-identical to leaving
    // `boxWidth` unset. Without this, a change to how the slider acts could silently restyle
    // every existing column scatter.
    const { table, plot } = card("scatter");
    const unset = { ...plot, seriesStyles: Object.fromEntries(Object.entries((plot.seriesStyles ?? {}) as Record<string, object>).map(([k, v]) => [k, { ...v, boxWidth: undefined }])) } as Plot;
    expect(draw(table, width(unset, 0.5)), "the default look changed").toBe(draw(table, unset));
  });
});

describe("network — the Two-tone fill checkbox rings the node", () => {
  const twoTone = (plot: Plot, v: boolean | undefined): Plot =>
    ({ ...plot, network: { ...(plot.network ?? {}), nodeTwoTone: v } }) as Plot;

  it("on and off draw different figures, even with the house halo set", () => {
    // The case guarded: `nodeStroke` is "var(--bg)" in the house default and must not win outright.
    const { table, plot } = card("network");
    expect(plot.network?.nodeStroke, "fixture: the house halo is not set, so the case guarded cannot occur").toBe("var(--bg)");
    expect(
      draw(table, twoTone(plot, true)),
      '"Two-tone fill" does nothing on a network — the shared node outline is shadowing it',
    ).not.toBe(draw(table, twoTone(plot, false)));
  });

  it("on derives the ring from the node's own fill, not from the theme", () => {
    const { table, plot } = card("network");
    const scene = buildPlotScene(table, twoTone(plot, true), SIZE);
    const rings = (scene.network?.nodes ?? []).map((n) => n.stroke);
    expect(rings.every((s) => typeof s === "string" && s.startsWith("#")), `two-tone rings must be real colours derived from each fill, got ${JSON.stringify(rings.slice(0, 3))}`).toBe(true);
    // …and they differ between nodes, because the fills do.
    expect(new Set(rings).size, "every node got the same ring — it is not following the fill").toBeGreaterThan(1);
  });

  it("untouched still draws the house halo — the default look is unchanged", () => {
    // The backward-compatibility half. Leaving the checkbox alone keeps the page-colour halo,
    // not a derived dark ring.
    const { table, plot } = card("network");
    const scene = buildPlotScene(table, twoTone(plot, undefined), SIZE);
    expect((scene.network?.nodes ?? []).every((n) => n.stroke === "var(--bg)"), "an untouched network stopped drawing its page-colour halo").toBe(true);
  });

  it("off is the halo too, and differs from on", () => {
    const { table, plot } = card("network");
    const off = buildPlotScene(table, twoTone(plot, false), SIZE);
    expect((off.network?.nodes ?? []).every((n) => n.stroke === "var(--bg)")).toBe(true);
  });

  /**
   * And the checkbox must report the state correctly. Reading `nodeTwoTone ?? true` would leave the
   * box ticked on every network built from the house preset while the nodes draw a plain
   * page-colour halo — a control describing a state the figure does not have, which is its own
   * kind of dead control.
   */
  it("the checkbox's untouched state matches what the nodes actually draw", () => {
    const { table, plot } = card("network");
    const { container } = render(
      <Inspector activeSection="graphs" selection={{ kind: "chart-section", title: "Network graph" }} plot={plot} table={table}
        userPresets={[]} profileDefault={null} {...inspectorHandlers()} />,
    );
    const box = container.querySelector<HTMLInputElement>('input[aria-label="Two-tone nodes (darker outline)"]');
    expect(box, "no Two-tone control on a network").not.toBeNull();
    const drawsTwoTone = (buildPlotScene(table, plot, SIZE).network?.nodes ?? []).some((n) => (n.stroke ?? "").startsWith("#"));
    expect(box!.checked, `the tick says ${box!.checked} but the figure draws ${drawsTwoTone ? "two-tone" : "a plain halo"}`).toBe(drawsTwoTone);
  });
});
