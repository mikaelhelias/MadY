// @vitest-environment jsdom
// Bubble grid. A bubble grid is a matrix of size-encoded dots — the classic
// publication "dot plot" (corrplot, scRNA-seq marker dots). It is not a new kind: the matrix
// heatmap already owns the grid, the labels, the ramp and the colour bar, so it lands as the
// heatmap's "Cells" option (Tiles / Bubbles). This checks all three parts: the builder sizes
// accurately (area ∝ magnitude; |v| on a diverging domain), the renderer really draws circles
// (and keeps the cell click target), and the Inspector control writes the field.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import type { DataTable, Plot } from "@mady/core";
import { buildPlotScene } from "@mady/graphics";
import { PlotFigure } from "./PlotFigure";
import { Inspector } from "./Inspector";
import { galleryItems } from "./gallery";

afterEach(cleanup);

function heatmapFixture(): { plot: Plot; table: DataTable } {
  const g = galleryItems().find((x) => (x.plot.kind ?? "xy") === "heatmap");
  if (!g) throw new Error("no heatmap gallery fixture");
  return { plot: JSON.parse(JSON.stringify(g.plot)) as Plot, table: g.table as DataTable };
}

/** A small hand-made matrix crossing zero, to pin the diverging size rule. */
const divTable: DataTable = {
  id: "t", kind: "xy", name: "M",
  columns: [
    { id: "x", name: "Row", role: "x" },
    { id: "a", name: "A", role: "y" },
    { id: "b", name: "B", role: "y" },
  ],
  rows: [
    { id: "r1", cells: { x: "one", a: -8, b: 2 } },
    { id: "r2", cells: { x: "two", a: 8, b: null } },
  ],
};
const divPlot = (over: Partial<NonNullable<Plot["heatmap"]>> = {}): Plot => ({
  id: "p", name: "H", source: "t", status: "ok", styleOverrides: {}, kind: "heatmap",
  heatmap: { cellShape: "bubble", ...over },
});

describe("bubble grid — builder sizing", () => {
  it("bubble mode gives every finite cell a radius; missing cells get none; tiles get none", () => {
    const { plot, table } = heatmapFixture();
    const tiles = buildPlotScene(table, plot);
    expect(tiles.heatmap!.cells.every((c) => c.r === undefined), "tile mode must not carry radii").toBe(true);
    plot.heatmap = { ...plot.heatmap, cellShape: "bubble" };
    const bubbles = buildPlotScene(table, plot);
    for (const c of bubbles.heatmap!.cells) {
      if (c.value == null) expect(c.r).toBeUndefined();
      else expect(c.r!, "a real value must never be invisible").toBeGreaterThan(0);
    }
  });

  it("a domain crossing zero sizes by |value| — the −max bubble equals the +max bubble", () => {
    const scene = buildPlotScene(divTable, divPlot());
    const cells = scene.heatmap!.cells;
    const neg = cells.find((c) => c.value === -8)!;
    const pos = cells.find((c) => c.value === 8)!;
    const mid = cells.find((c) => c.value === 2)!;
    expect(neg.r).toBeCloseTo(pos.r!, 5);
    expect(mid.r!).toBeLessThan(pos.r!);
    // area ∝ magnitude: 2 is a quarter of 8 → half the radius
    expect(mid.r! / pos.r!).toBeCloseTo(Math.sqrt(2 / 8), 2);
  });

  it("the largest bubble fits its cell (r ≤ 45% of the shorter cell side)", () => {
    const scene = buildPlotScene(divTable, divPlot());
    for (const c of scene.heatmap!.cells) {
      if (c.r != null) expect(c.r).toBeLessThanOrEqual(Math.min(c.w, c.h) * 0.45 + 1e-6);
    }
  });

  it("bubbles on a density/hexbin view are refused with a warning, never silently", () => {
    const { plot, table } = heatmapFixture();
    plot.heatmap = { ...plot.heatmap, mode: "density2d", cellShape: "bubble" };
    const scene = buildPlotScene(table, plot);
    expect(scene.warnings.some((w) => /bubble/i.test(w)), `warnings: ${scene.warnings.join(" | ")}`).toBe(true);
  });
});

describe("bubble grid — the drawing", () => {
  it("bubble mode draws one circle per finite cell and keeps the cell CLICK target", () => {
    const scene = buildPlotScene(divTable, divPlot());
    const onSelect = vi.fn();
    const { container } = render(<PlotFigure scene={scene} selected={null} zoom={1} onSelect={onSelect} />);
    const circles = container.querySelectorAll("circle.heatbubble");
    expect(circles.length).toBe(scene.heatmap!.cells.filter((c) => c.value != null).length);
    // the whole cell stays clickable (the invisible target rect), selecting THAT cell
    const target = container.querySelector('[data-heatcell="0-0"]');
    expect(target, "no per-cell click target in bubble mode").toBeTruthy();
    fireEvent.click(target!);
    expect(onSelect).toHaveBeenCalledWith({ kind: "heatmap-cell", row: 0, col: 0 });
  });

  it("tile mode draws no circles (saved heatmaps unchanged)", () => {
    const scene = buildPlotScene(divTable, divPlot({ cellShape: undefined }));
    const { container } = render(<PlotFigure scene={scene} selected={null} zoom={1} />);
    expect(container.querySelectorAll("circle.heatbubble").length).toBe(0);
  });
});

describe("bubble grid — the Inspector control", () => {
  function renderInspector(plot: Plot) {
    const onSetPlotOptions = vi.fn();
    const h = {
      onSelect: vi.fn(), onSetAxis: vi.fn(), onSetAxisLength: vi.fn(), onSetAxisTitleFont: vi.fn(),
      onSetSeriesStyle: vi.fn(), onSetSeriesStyleAll: vi.fn(), onSetPointStyle: vi.fn(), onClearPointStyles: vi.fn(),
      onSetGrid: vi.fn(), onSetFrame: vi.fn(), onSetKind: vi.fn(), onSetBarLayout: vi.fn(), onSetBarShape: vi.fn(), onSetBoxWhisker: vi.fn(),
      onSetPlotOptions, onSetGraphTitle: vi.fn(), onSetPlotFont: vi.fn(), onHomogenizeFont: vi.fn(),
      onSetLegend: vi.fn(), onSetSignificance: vi.fn(), onApplyPreset: vi.fn(), 
      onApplyUserPreset: vi.fn(), onSaveUserPreset: vi.fn(), onDeleteUserPreset: vi.fn(), onSetProfileDefault: vi.fn(),
      annotationOps: { add: vi.fn(), update: vi.fn(), remove: vi.fn(), reorder: vi.fn(), align: vi.fn(), group: vi.fn(), ungroup: vi.fn(), setLocked: vi.fn(), addImage: vi.fn(), replaceImage: vi.fn() },
    };
    const { container } = render(
      <Inspector activeSection="graphs" selection={{ kind: "plot" }} plot={plot} table={divTable}
        userPresets={[]} profileDefault={null} wholeGraph={false} onSetWholeGraph={() => {}} {...h} />,
    );
    return { container, onSetPlotOptions };
  }
  const cellsRow = (container: HTMLElement) =>
    [...container.querySelectorAll("label")].find((l) => (l.querySelector("span:first-child")?.textContent ?? "").trim() === "Cells");

  it("a Cells select (Tiles / Bubbles) writes heatmap.cellShape", () => {
    const { container, onSetPlotOptions } = renderInspector(divPlot({ cellShape: undefined }));
    const row = cellsRow(container);
    expect(row, "no Cells control in the Heatmap section").toBeTruthy();
    fireEvent.change(row!.querySelector("select")!, { target: { value: "bubble" } });
    const patch = onSetPlotOptions.mock.calls.at(-1)![0] as { heatmap: { cellShape?: string } };
    expect(patch.heatmap.cellShape).toBe("bubble");
  });

  it("the control is only offered on the matrix view (bubbles mean nothing in a density cloud)", () => {
    const { container } = renderInspector(divPlot({ mode: "density2d", cellShape: undefined }));
    expect(cellsRow(container)).toBeUndefined();
  });
});
