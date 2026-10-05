// @vitest-environment jsdom
// Guards for graph and datasheet behaviours that are easy to break: each block fails if its behaviour does.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { buildPlotScene } from "@mady/graphics";
import { MadyDocument } from "@mady/core";
import type { DataTable, Plot } from "@mady/core";
import { Inspector } from "./Inspector";
import { PlotFigure } from "./PlotFigure";
import { galleryItems } from "./gallery";
import { createNewGraph, defaultFormat, NEW_GRAPH_GENRES } from "./newGraph";
import { seedPlotStyle } from "./seedStyle";

afterEach(cleanup);
const SIZE = { width: 640, height: 460 };
const card = (kind: string) => galleryItems().find((g) => (g.plot.kind ?? "xy") === kind)!;
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

// ── the Axis rail tab is greyed on the axis-less kinds ─────────────────────────────────────────
describe("Axis tab greyed on axis-less kinds", () => {
  // Not parallel coordinates: its per-column axes are real, clickable axes with their own panel
  // (chart-furniture-click.test proves a tick number lights the Axis tab there).
  const axisless = ["alluvial", "chord", "corrmatrix", "oncoprint", "sunburst", "treemap"];
  for (const kind of axisless) {
    it(`${kind}: the Axis tab is disabled with a reason`, () => {
      const c = card(kind);
      const { container } = render(
        <Inspector activeSection="graphs" selection={{ kind: "plot" } as never} plot={c.plot as Plot} table={c.table as DataTable}
          userPresets={[]} profileDefault={null} wholeGraph={false} onSetWholeGraph={() => {}} {...handlers()} />,
      );
      const tab = [...container.querySelectorAll("button.inspcat")].find((b) => (b.textContent ?? "").trim() === "Axis")!;
      expect(tab, "no Axis rail tab rendered").toBeDefined();
      expect(tab.getAttribute("aria-disabled"), `${kind}: the Axis tab is live but the kind draws no axes`).toBe("true");
      expect((tab.getAttribute("title") ?? "").length).toBeGreaterThan(20);
    });
  }
  it("negative control: an XY keeps its Axis tab live", () => {
    const c = card("xy");
    const { container } = render(
      <Inspector activeSection="graphs" selection={{ kind: "plot" } as never} plot={c.plot as Plot} table={c.table as DataTable}
        userPresets={[]} profileDefault={null} wholeGraph={false} onSetWholeGraph={() => {}} {...handlers()} />,
    );
    const tab = [...container.querySelectorAll("button.inspcat")].find((b) => (b.textContent ?? "").trim() === "Axis")!;
    expect(tab.getAttribute("aria-disabled")).toBeNull();
  });
});

// ── New graph ▸ Ternary on its recommended format draws once values are typed ───────────────
describe("ternary from the door", () => {
  it("four typed rows on the genre's own seed sheet place four points", () => {
    const g = NEW_GRAPH_GENRES.find((x) => x.key === "ternary")!;
    const doc = new MadyDocument();
    const fmt = defaultFormat(g);
    const { table, plot } = createNewGraph(doc, { genre: g.key, tableKind: fmt });
    seedPlotStyle(doc, plot!.id, plot!.kind);
    for (const r of [["S1", 60, 30, 10], ["S2", 20, 50, 30], ["S3", 33, 33, 34], ["S4", 10, 10, 80]]) doc.addRow(table.id, r as never);
    const json = doc.toJSON();
    const t = json.tables.find((x) => x.id === table.id)!;
    const p = json.plots.find((x) => x.id === plot!.id)!;
    const s = buildPlotScene(t, p, SIZE);
    const placed = s.series.reduce((n, x) => n + x.marks.filter((m) => Number.isFinite(m.cx)).length, 0);
    expect(placed, `warnings: ${s.warnings.join(" | ")}`).toBe(4);
    expect(s.warnings).toEqual([]);
  });
});

// ── ternary legend keys carry the class colours the points are drawn in ────────────────────
describe("ternary legend keys", () => {
  it("the four class rows show four distinct colours, matching the plotted points", () => {
    const c = card("ternary");
    const scene = buildPlotScene(c.table as DataTable, c.plot as Plot, SIZE);
    expect(scene.legend.length).toBeGreaterThanOrEqual(3);
    const { container } = render(<PlotFigure scene={scene} zoom={1} onSelect={vi.fn()} />);
    const keyColours = [...container.querySelectorAll(".gfx-legend .gfx-legmark, .gfx-legend circle, .gfx-legend path[data-legkey]")]
      .map((el) => `${el.getAttribute("fill")}|${el.getAttribute("stroke")}`);
    const distinct = new Set(keyColours);
    // Every class row, including the one whose class colour equals the series colour (a colour
    // comparison cannot tell that row apart, so it carries a data-driven flag).
    expect(keyColours.length, "no legend markers rendered").toBe(scene.legend.length);
    expect(distinct.size, `legend keys are not distinct: ${[...distinct].join(" ; ")}`).toBe(scene.legend.length);
    for (const k of keyColours) expect(k, "a key wears the series' two-tone tint").not.toMatch(/#b3d5e8/);
    // the plotted points' colours (per-mark) are the same set as the keys' visible colour
    const pointColours = new Set(scene.series.flatMap((s) => s.marks.map((m) => m.fill ?? s.color)));
    const keyVisible = new Set(scene.legend.map((e) => e.color));
    for (const col of keyVisible) expect([...pointColours].includes(col), `key colour ${col} is not a point colour`).toBe(true);
  });
});

// ── sunburst sectors fill the full turn ────────────────────────────────────────────────────
describe("sunburst spans", () => {
  it("the inner ring's sectors sum to a full circle and each spans its share", () => {
    const c = card("sunburst");
    const scene = buildPlotScene(c.table as DataTable, c.plot as Plot, SIZE);
    const segs = (scene.sunburst!.segments as unknown as { depth: number; frac: number; a0?: number; a1?: number }[]).filter((s) => s.depth === 1);
    expect(segs.length).toBeGreaterThanOrEqual(3);
    const spans = segs.map((s) => (s.a1 ?? NaN) - (s.a0 ?? NaN));
    expect(spans.every((x) => Number.isFinite(x)), "segments carry no angular span (a0/a1)").toBe(true);
    const total = spans.reduce((a, b) => a + b, 0);
    expect(total).toBeCloseTo(2 * Math.PI, 3);
    segs.forEach((s, i) => expect(spans[i]!).toBeCloseTo(2 * Math.PI * s.frac, 3));
  });
});

// ── Manhattan points carry their chromosome colour into the drawing ────────────────────────
describe("Manhattan chromosome colours", () => {
  it("adjacent chromosomes render with different marker colours (not one series tint)", () => {
    const c = card("manhattan");
    const scene = buildPlotScene(c.table as DataTable, c.plot as Plot, SIZE);
    const { container } = render(<PlotFigure scene={scene} zoom={1} onSelect={vi.fn()} />);
    const looks = new Set<string>();
    for (const g of container.querySelectorAll("g[id^='mark-']")) {
      const shape = g.querySelector("circle, path, rect, polygon");
      if (!shape) continue;
      looks.add(`${shape.getAttribute("fill")}|${shape.getAttribute("stroke")}`);
    }
    expect(looks.size, `every marker renders the same: ${[...looks].join(" ; ")}`).toBeGreaterThanOrEqual(2);
  });
});

// ── Chart ▸ Type never draws an empty graph silently ───────────────────────────────────────
describe("silent empty graphs from the kind picker", () => {
  it("Manhattan on a grouped sheet warns instead of drawing nothing", () => {
    const g = card("bar");
    const p = { ...(g.plot as Plot), kind: "manhattan" } as Plot;
    const s = buildPlotScene(g.table as DataTable, p, SIZE);
    const ink = s.series.some((x) => x.marks.some((m) => Number.isFinite(m.cx) && Number.isFinite(m.cy)));
    expect(ink).toBe(false);
    expect(s.warnings.length, "empty drawing with no warning").toBeGreaterThan(0);
  });
  it("bar / before-after / heatmap / correlation matrix / lollipop on an alterations sheet warn", () => {
    const g = card("oncoprint");
    for (const kind of ["bar", "beforeafter", "heatmap", "corrmatrix", "lollipop"] as const) {
      const s = buildPlotScene(g.table as DataTable, { ...(g.plot as Plot), kind } as Plot, SIZE);
      expect(s.warnings.length, `${kind}: empty drawing with no warning`).toBeGreaterThan(0);
    }
  });
  it("negative control: a real drawing carries no such warning", () => {
    const g = card("xy");
    const s = buildPlotScene(g.table as DataTable, g.plot as Plot, SIZE);
    expect(s.series.some((x) => x.marks.length > 0), "the negative control drew nothing — it proves nothing").toBe(true);
    // "Such" = the empty-drawing class this block is about. The card may correctly carry other
    // notes at this size (with two fits its potency labels are routed, and at 640×460 under
    // the house 20-px type the placer reports them crowded) — those are a different claim,
    // held by their own guards.
    const empty = s.warnings.filter((w) => /Nothing to draw|no columns it can read|found no columns/.test(w));
    expect(empty).toEqual([]);
  });
});
