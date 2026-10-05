// @vitest-environment jsdom
/**
 * A bar series' key can show its data point: when both are shown, the legend can key a series by its data point or
 * by its bar square. `legend.barKey = "point"` keys each series whose bars carry their
 * data points by the point, drawn exactly as the dots over its bars are; the default keeps the bar block. Checked on
 * the drawing: the key's dot (radius, fill, edge) is a dot the chart itself draws. The control is offered only where
 * the chart draws both, and writes the field the builder reads.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import type { Plot } from "@mady/core";
import { buildPlotScene } from "@mady/graphics";
import { PlotFigure } from "./PlotFigure";
import { Inspector } from "./Inspector";
import { galleryItems } from "./gallery";

afterEach(cleanup);
const SIZE = { width: 580, height: 380 };
const card = (name: string) => galleryItems().find((g) => g.plot.name === name || g.plot.id === name)!;
const withKey = (p: Plot, barKey?: "bar" | "point"): Plot => ({ ...p, legend: { ...(p.legend ?? {}), show: true, ...(barKey ? { barKey } : {}) } }) as Plot;

describe("bar-or-point legend key — the drawing", () => {
  for (const name of ["p-bar", "p-columnbar"]) {
    it(`${name}: "Data point" keys every series by the dot its bars carry, drawn as it is drawn`, () => {
      const g = card(name);
      const scene = buildPlotScene(g.table, withKey(g.plot, "point"), SIZE);
      expect(scene.series.some((s) => s.marks.some((m) => m.bar && m.points?.length)), "the fixture draws no points on its bars").toBe(true);
      const { container } = render(<PlotFigure scene={scene} />);
      const rows = [...container.querySelectorAll("[data-mady-legend-row]")];
      expect(rows.length).toBeGreaterThan(0);
      const figureDots = [...container.querySelectorAll("svg.gfx-figure circle")].filter((c) => !c.closest(".gfx-legend"));
      const sig = (c: Element) => `${Number(c.getAttribute("r")).toFixed(2)}|${c.getAttribute("fill")}|${c.getAttribute("stroke")}`;
      const drawn = new Set(figureDots.map(sig));
      for (const row of rows) {
        expect(row.querySelector(".gfx-legbar"), `"${row.textContent}" still shows a bar block`).toBeNull();
        expect(row.querySelector("line"), `"${row.textContent}" shows a line the chart does not draw`).toBeNull();
        const key = row.querySelector("circle");
        expect(key, `"${row.textContent}" has no dot`).not.toBeNull();
        expect(drawn.has(sig(key!)), `"${row.textContent}" key ${sig(key!)} is not a dot the chart draws`).toBe(true);
      }
    });

    it(`${name}: the default keeps the bar block`, () => {
      const g = card(name);
      const { container } = render(<PlotFigure scene={buildPlotScene(g.table, withKey(g.plot), SIZE)} />);
      for (const row of container.querySelectorAll("[data-mady-legend-row]")) expect(row.querySelector(".gfx-legbar"), `"${row.textContent}"`).not.toBeNull();
    });
  }

  it("a bar series that draws NO points keeps its bar block even when Data point is chosen", () => {
    const g = card("p-barline");
    const scene = buildPlotScene(g.table, withKey(g.plot, "point"), SIZE);
    const bars = scene.legend.filter((e) => e.select?.as === "series" && e.label === "Cases");
    expect(bars.length).toBe(1);
    expect(bars[0]!.swatch).toBe("bar");
  });
});

const handlers = (onSetLegend: (p: unknown) => void) => ({
  onSelect: vi.fn(),
  onSetAxis: vi.fn(), onSetAxisLength: vi.fn(), onSetAxisTitleFont: vi.fn(),
  onSetSeriesStyle: vi.fn(), onSetSeriesStyleAll: vi.fn(), onSetPointStyle: vi.fn(), onClearPointStyles: vi.fn(),
  onSetGrid: vi.fn(), onSetFrame: vi.fn(), onSetKind: vi.fn(), onSetBarLayout: vi.fn(), onSetBarShape: vi.fn(), onSetBoxWhisker: vi.fn(),
  onSetPlotOptions: vi.fn(), onSetGraphTitle: vi.fn(), onSetPlotFont: vi.fn(), onHomogenizeFont: vi.fn(),
  onSetLegend, onSetSignificance: vi.fn(), onApplyPreset: vi.fn(),
  onApplyUserPreset: vi.fn(), onSaveUserPreset: vi.fn(), onDeleteUserPreset: vi.fn(), onSetProfileDefault: vi.fn(),
  annotationOps: { add: vi.fn(), update: vi.fn(), remove: vi.fn(), reorder: vi.fn(), align: vi.fn(), group: vi.fn(), ungroup: vi.fn(), setLocked: vi.fn(), addImage: vi.fn(), replaceImage: vi.fn() },
});
const control = (c: HTMLElement) => c.querySelector<HTMLSelectElement>('select[aria-label="Legend key for bars with points"]');
const inspect = (plot: Plot, table: unknown, onSetLegend: (p: unknown) => void = () => {}) =>
  render(<Inspector activeSection="graphs" selection={{ kind: "plot" }} plot={plot} table={table as never} userPresets={[]} profileDefault={null} {...handlers(onSetLegend)} />).container;

describe("bar-or-point legend key — the control", () => {
  it("is offered where the bars carry their points, and writes what the builder reads", () => {
    const g = card("p-bar");
    const writes: unknown[] = [];
    const c = inspect(withKey(g.plot), g.table, (p) => writes.push(p));
    const sel = control(c);
    expect(sel, "no key choice on a bar chart that draws its points").not.toBeNull();
    expect(sel!.value).toBe("bar");
    fireEvent.change(sel!, { target: { value: "point" } });
    expect(writes).toEqual([{ barKey: "point" }]);
    cleanup();
    // Back to Bar writes undefined, so an untouched graph carries no field.
    const back: unknown[] = [];
    fireEvent.change(control(inspect(withKey(g.plot, "point"), g.table, (p) => back.push(p)))!, { target: { value: "bar" } });
    expect(back).toEqual([{ barKey: undefined }]);
  });

  it("is not offered where the chart does not draw both (bars without points, an XY chart)", () => {
    const barline = card("p-barline");
    expect(control(inspect(withKey(barline.plot), barline.table)), "offered on bars that carry no points").toBeNull();
    cleanup();
    const xy = galleryItems().find((g) => g.plot.kind === "xy")!;
    expect(control(inspect(withKey(xy.plot), xy.table)), "offered on an XY chart").toBeNull();
  });
});
