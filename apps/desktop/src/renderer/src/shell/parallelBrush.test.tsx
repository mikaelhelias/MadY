// @vitest-environment jsdom
/**
 * A parallel-coordinates axis's brush (the value range that keeps lines bright) is stored in data units. Dragging always
 * stays on the axis, but a typed range, a script, or an axis whose range changed when the data did can leave it past an
 * axis end — and the rectangle that shows it must stay on the axis, not run off it (and stretch the figure to hold it).
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import type { DataTable, Plot } from "@mady/core";
import { buildPlotScene } from "@mady/graphics";
import { PlotFigure } from "./PlotFigure";
import { brushRectPx } from "./parallelBrush";

afterEach(cleanup);

// An axis from 0 (at y=400) up to 10 (at y=100), and the same axis reversed.
const up = { yAtMin: 400, yAtMax: 100, min: 0, max: 10 };
const down = { yAtMin: 100, yAtMax: 400, min: 0, max: 10 };

describe("brushRectPx", () => {
  it("a brush inside the axis spans the pixels of its two values", () => {
    expect(brushRectPx(up, [2, 4])).toEqual({ top: 280, bottom: 340 });
  });

  it("a reversed axis puts the same range at the mirrored place, still top above bottom", () => {
    expect(brushRectPx(down, [2, 4])).toEqual({ top: 160, bottom: 220 });
  });

  it("a brush running past the top end stops at the axis's top", () => {
    expect(brushRectPx(up, [8, 99])).toEqual({ top: 100, bottom: 160 }); // the value 8 is at pixel 400 − 0.8 × 300 = 160
  });

  it("a brush running past the bottom end stops at the axis's foot", () => {
    expect(brushRectPx(up, [-50, 3])).toEqual({ top: 310, bottom: 400 });
  });

  it("clamps on a reversed axis too", () => {
    expect(brushRectPx(down, [8, 99])).toEqual({ top: 340, bottom: 400 });
  });

  it("a brush wider than the axis covers the whole axis", () => {
    expect(brushRectPx(up, [-5, 50])).toEqual({ top: 100, bottom: 400 });
  });

  it("a brush wholly outside the axis has no rectangle to draw", () => {
    expect(brushRectPx(up, [20, 30])).toBeNull();
    expect(brushRectPx(up, [-9, -1])).toBeNull();
    expect(brushRectPx(down, [20, 30])).toBeNull();
  });

  it("an empty or reversed-order range still resolves to a rectangle between its values", () => {
    expect(brushRectPx(up, [4, 2])).toEqual({ top: 280, bottom: 340 });
  });
});

describe("a drawn parallel plot", () => {
  const NAMES = ["Alcohol", "Malic acid", "Ash"];
  const table: DataTable = {
    id: "pc", kind: "multivariable", name: "Wine",
    columns: [{ id: "s", name: "Sample", role: "x" }, ...NAMES.map((n, j) => ({ id: `c${j}`, name: n, role: "y" as const }))],
    rows: Array.from({ length: 20 }, (_, i) => ({ id: `r${i}`, cells: { s: `W${i}`, ...Object.fromEntries(NAMES.map((_n, j) => [`c${j}`, 11 + ((i * (j + 3)) % 9) * 0.5 + j * 4])) } })),
  };
  const draw = (parallel: NonNullable<Plot["parallel"]>) => {
    const plot: Plot = { id: "p", name: "P", source: "pc", status: "ok", styleOverrides: {}, kind: "parallel", figureWidth: 600, figureHeight: 420, parallel };
    const scene = buildPlotScene(table, plot, { width: 600, height: 420 });
    const { container } = render(<PlotFigure scene={scene} zoom={1} />);
    const rects = [...container.querySelectorAll<SVGRectElement>("svg rect")].filter((r) => r.getAttribute("width") === "10" && r.getAttribute("fill-opacity") === "0.18");
    return { scene, rects };
  };

  it("with no brush no brush rectangle is drawn", () => {
    expect(draw({}).rects.length).toBe(0);
  });

  it("a brush inside the axis is drawn on it", () => {
    const { scene, rects } = draw({ brushes: { c0: [12, 13] } });
    expect(rects.length).toBe(1);
    const ax = scene.parallel!.axes[0]!;
    const y = Number(rects[0]!.getAttribute("y"));
    const h = Number(rects[0]!.getAttribute("height"));
    expect(y).toBeGreaterThanOrEqual(ax.topY - 0.01);
    expect(y + h).toBeLessThanOrEqual(ax.botY + 0.01);
  });

  it("a brush that runs past the axis's top is cut at the axis, not drawn above it", () => {
    const { scene, rects } = draw({ brushes: { c0: [12, 500] } });
    expect(rects.length).toBe(1);
    const ax = scene.parallel!.axes[0]!;
    expect(Number(rects[0]!.getAttribute("y"))).toBeGreaterThanOrEqual(ax.topY - 0.01);
  });

  it("a brush wholly outside the axis draws no rectangle", () => {
    expect(draw({ brushes: { c0: [0.3, 0.9] } }).rects.length).toBe(0);
  });

  it("a brush on a reversed axis is drawn", () => {
    const { scene, rects } = draw({ brushes: { c0: [12, 13] }, perAxis: { c0: { reversed: true } } });
    expect(rects.length).toBe(1);
    const ax = scene.parallel!.axes[0]!;
    const y = Number(rects[0]!.getAttribute("y"));
    expect(y).toBeGreaterThanOrEqual(ax.topY - 0.01);
    expect(y + Number(rects[0]!.getAttribute("height"))).toBeLessThanOrEqual(ax.botY + 0.01);
  });
});
