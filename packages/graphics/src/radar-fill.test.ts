import { describe, expect, it } from "vitest";
import type { DataTable, Plot } from "@mady/core";
import { buildPlotScene } from "./buildScene.js";

/**
 * A radar fills its box (rule: the graph always occupies as much space as possible).
 *
 * In a figure card with Keep proportions off the radar is laid out at the card's size with its text at full size. In a
 * 350×227 card the spoke names (both sides) and the legend would take nearly all the width and the web would fall to its
 * 10 px minimum; in a narrow card the names would also be cut at the edge, silently. The names and the legend therefore
 * shrink just enough for the web to fill its room (never below 8 px), saying so when that size was set. At its own size
 * nothing changes.
 */
const measure = (text: string, px: number): number => text.length * px * 0.56;
const names = ["Speed", "Power", "Range", "Comfort", "Economy", "Safety"];
const table: DataTable = {
  id: "t",
  name: "Radar",
  format: "column",
  columns: [
    { id: "x", name: "Metric", role: "x" },
    { id: "a", name: "Model A", role: "y" },
    { id: "b", name: "Model B", role: "y" },
  ],
  datasets: [
    { id: "a", name: "Model A", replicates: ["a"] },
    { id: "b", name: "Model B", replicates: ["b"] },
  ],
  rows: names.map((n, i) => ({ id: `r${i}`, cells: { x: n, a: 40 + 7 * i, b: 80 - 6 * i } })),
} as unknown as DataTable;
const plot = (extra: Partial<Plot> = {}): Plot =>
  ({ id: "p", name: "Radar", kind: "radar", source: "t", fonts: { tick: { size: 20 }, legend: { size: 21 } }, showTitle: false, ...extra }) as unknown as Plot;

function measureRadar(p: Plot, w: number, h: number) {
  const s = buildPlotScene(table, p, { width: w, height: h, measure });
  const r = s.radar!;
  const px = (r.labelFont ?? s.fonts.tick).size;
  let cut = 0;
  for (const sp of r.spokes) {
    const tw = measure(sp.label, px);
    const x1 = sp.labelAnchor === "end" ? sp.labelX - tw : sp.labelAnchor === "middle" ? sp.labelX - tw / 2 : sp.labelX;
    if (x1 < -0.5 || x1 + tw > w + 0.5) cut++;
  }
  return { r: r.r, px, legendPx: s.fonts.legend.size, cut, warnings: s.warnings };
}

describe("radar: the web fills its box", () => {
  it("fixture: at its own size (640×420) the web is large and nothing is shrunk or said", () => {
    const m = measureRadar(plot(), 640, 420);
    expect(m.r).toBeGreaterThan(100);
    expect(m.px).toBe(20);
    expect(m.warnings.filter((x) => x.includes("Radar names"))).toEqual([]);
  });
  for (const [w, h] of [[350, 227], [378, 259], [230, 400], [280, 180]] as const) {
    it(`${w}×${h}: the web fills its room, names inside the box, text ≥ 8 px, and it says so (its sizes are set)`, () => {
      const m = measureRadar(plot(), w, h);
      const room = Math.min(w, h);
      expect(m.r * 2, `web diameter ${Math.round(m.r * 2)} px in a ${w}×${h} box`).toBeGreaterThanOrEqual(0.35 * room);
      expect(m.cut, "spoke names cut at the box edge").toBe(0);
      expect(m.px).toBeGreaterThanOrEqual(8);
      expect(m.legendPx).toBeGreaterThanOrEqual(8);
      expect(m.px).toBeLessThan(20);
      expect(m.warnings.some((x) => x.includes("Radar names are drawn at"))).toBe(true);
    });
  }
  it("a size never set on the graph is fitted QUIETLY — like every other 'drawn at N px' fit (the New Graph wizard ranks a warned scene as one that does not draw)", () => {
    const bare = { id: "p", name: "Radar", kind: "radar", source: "t", showTitle: false } as unknown as Plot;
    const big = buildPlotScene(table, bare, { width: 640, height: 420, measure });
    const s = buildPlotScene(table, bare, { width: 200, height: 160, measure });
    expect(s.fonts.tick.size, "fixture: this box does make the fit shrink the names").toBeLessThan(big.fonts.tick.size);
    expect(s.warnings.filter((x) => x.includes("Radar names"))).toEqual([]);
  });
  it("minTextPx raises the floor — a panel drawing at 0.7 asks for 8 / 0.7 so the names still reach 8 px on screen", () => {
    const free = measureRadar(plot(), 350, 227);
    expect(free.px, "fixture: unconstrained, the fit goes below 11.4 px here").toBeLessThan(8 / 0.7);
    const s = buildPlotScene(table, plot(), { width: 350, height: 227, measure, minTextPx: 8 / 0.7 });
    expect(s.fonts.tick.size).toBeGreaterThanOrEqual(8 / 0.7 - 0.05);
    expect(s.fonts.legend.size).toBeGreaterThanOrEqual(8 / 0.7 - 0.05);
  });
  it("its own Label size is fitted the same way (the names are measured at the size they are drawn)", () => {
    const m = measureRadar(plot({ radar: { labelFont: { size: 24 } } } as Partial<Plot>), 350, 227);
    expect(m.cut).toBe(0);
    expect(m.px).toBeLessThan(24);
    expect(m.r * 2).toBeGreaterThanOrEqual(0.35 * 227);
  });
});
