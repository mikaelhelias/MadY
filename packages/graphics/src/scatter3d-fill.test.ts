import { describe, expect, it } from "vitest";
import type { DataTable, Plot } from "@mady/core";
import { buildPlotScene } from "./buildScene";

/**
 * The 3-D scatter fills its own plot area.
 *
 * Rule: grow the drawing inside the box it is given — never shrink the box, never drop
 * content. Guards against a fit that only shrinks the cube to make room for the axis names,
 * leaving a small cube centred in unused space.
 *
 * The drawing's extent is measured from the scene — edges, tick numbers and axis names (as text
 * boxes, with the same width function the builder is given), floor and points — against the plot
 * rect and the canvas.
 */
const measure = (text: string, px: number): number => text.length * px * 0.56;

const table: DataTable = {
  id: "t", kind: "xy", name: "T",
  columns: [{ id: "x", name: "Length (mm)", role: "x" }, { id: "y", name: "Width (mm)", role: "y" }, { id: "z", name: "Height (mm)", role: "y" }],
  rows: [[12, 6, 4], [14, 7, 5], [15, 9, 6], [17, 8, 7], [11, 5, 3], [16, 10, 8], [13, 6.5, 4.5], [18, 11, 9]].map((v, i) => ({ id: `r${i}`, cells: { x: v[0]!, y: v[1]!, z: v[2]! } })),
};
const plotOf = (patch: Partial<Plot> = {}): Plot => ({ id: "p", name: "3D scatter", source: "t", status: "ok", styleOverrides: {}, kind: "scatter3d", title: "3D scatter", ...patch }) as Plot;

function drawnBox(s: ReturnType<typeof buildPlotScene>) {
  const d = s.scatter3d!;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const pt = (x: number, y: number) => { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); };
  // names and numbers are drawn centred on x, on their baseline (PlotFigure: textAnchor middle, no dominant-baseline)
  const text = (label: string, cx: number, cy: number, px: number) => { const hw = measure(label, px) / 2; pt(cx - hw, cy - px * 0.8); pt(cx + hw, cy + px * 0.25); };
  d.axes.forEach((a, i) => {
    if (a.hidden) return;
    pt(a.x1, a.y1); pt(a.x2, a.y2);
    const off = d.labelOffsets[i] ?? { dx: 0, dy: 0 };
    text(a.label, a.lx + off.dx, a.ly + off.dy, a.titleSize ?? s.fonts.axisTitle.size);
    for (const t of a.ticks ?? []) text(t.label, t.lx, t.ly, a.tickFont?.size ?? s.fonts.tick.size);
  });
  for (const f of d.floor) { pt(f.x1, f.y1); pt(f.x2, f.y2); }
  for (const p of d.points) { pt(p.x - p.r, p.y - p.r); pt(p.x + p.r, p.y + p.r); }
  return { x0, y0, x1, y1 };
}

describe("3-D scatter: the cube, its ticks and names fill the plot area", () => {
  const SIZES = [[580, 380], [928, 608], [420, 620], [1200, 500]] as const;
  for (const [w, h] of SIZES) {
    for (const size of [14, 22]) {
      it(`${w}×${h}, axis names ${size}px: fills the limiting side and stays on the canvas`, () => {
        const s = buildPlotScene(table, plotOf({ fonts: { axisTitle: { size } } } as Partial<Plot>), { width: w, height: h, measure });
        const b = drawnBox(s);
        const p = s.plot;
        const fillW = (b.x1 - b.x0) / p.width, fillH = (b.y1 - b.y0) / p.height;
        expect(Math.max(fillW, fillH), `the drawing spans ${(fillW * 100).toFixed(0)}% of the plot width and ${(fillH * 100).toFixed(0)}% of its height — neither side is filled`).toBeGreaterThanOrEqual(0.9);
        expect(b.x0, "drawn past the left edge").toBeGreaterThanOrEqual(0);
        expect(b.y0, "drawn past the top edge").toBeGreaterThanOrEqual(0);
        expect(b.x1, "drawn past the right edge").toBeLessThanOrEqual(w);
        expect(b.y1, "drawn past the bottom edge").toBeLessThanOrEqual(h);
      });
    }
  }

  // A figure panel re-draws the 3-D scatter with `stretch`. Guards against skewing the projected
  // cube to fill the box edge to edge, which leaves no room for the axis names and lets the panel
  // card cut them off. Stretched, it must draw exactly as unstretched.
  for (const [w, h] of [[600, 300], [300, 600], [580, 380]] as const) {
    it(`${w}×${h} stretched (a figure panel's re-draw): names and numbers stay in the box, cube not skewed`, () => {
      const st = buildPlotScene(table, plotOf(), { width: w, height: h, measure, stretch: true });
      const plain = buildPlotScene(table, plotOf(), { width: w, height: h, measure });
      const b = drawnBox(st);
      expect(b.x0, "drawn past the left edge").toBeGreaterThanOrEqual(0);
      expect(b.y0, "drawn past the top edge").toBeGreaterThanOrEqual(0);
      expect(b.x1, "drawn past the right edge").toBeLessThanOrEqual(w);
      expect(b.y1, "drawn past the bottom edge").toBeLessThanOrEqual(h);
      expect(st.scatter3d!.axes.map((a) => [a.x1, a.y1, a.x2, a.y2].map((v) => Math.round(v * 100) / 100))).toEqual(
        plain.scatter3d!.axes.map((a) => [a.x1, a.y1, a.x2, a.y2].map((v) => Math.round(v * 100) / 100)),
      );
    });
  }

  it("the mouse-wheel zoom multiplies the fitted cube", () => {
    const edge = (zoom: number) => {
      const a = buildPlotScene(table, plotOf({ scatter3d: { zoom } }), { width: 580, height: 380, measure }).scatter3d!.axes[0]!;
      return Math.hypot(a.x2 - a.x1, a.y2 - a.y1);
    };
    expect(edge(2) / edge(1)).toBeCloseTo(2, 5);
  });
});
