import { describe, expect, it } from "vitest";
import type { DataTable, Plot } from "@mady/core";
import { buildPlotScene } from "./buildScene";

/**
 * A 3-D axis name stands clear of the last number on its own edge: at least 6 px of white between the two text
 * boxes. The builder only dropped a number the name covered by more than 3 px, so with large type the last
 * number could end exactly where the name began ("30Energy (kWh)").
 */
const measure = (text: string, px: number): number => text.length * px * 0.56;

const table: DataTable = {
  id: "t", kind: "xy", name: "T",
  columns: [{ id: "x", name: "Energy (kWh)", role: "x" }, { id: "y", name: "Occupants", role: "y" }, { id: "z", name: "Outdoor temp (C)", role: "y" }],
  rows: [[12, 2, 4], [14, 3, 5], [15, 4, 6], [17, 3.5, 7], [11, 2.5, 3], [16, 4, 8], [30, 1.5, 4.5], [18, 3, 9]].map((v, i) => ({ id: `r${i}`, cells: { x: v[0]!, y: v[1]!, z: v[2]! } })),
};
const plotOf = (patch: Partial<Plot> = {}): Plot => ({ id: "p", name: "3D scatter", source: "t", status: "ok", styleOverrides: {}, kind: "scatter3d", title: "3D scatter", ...patch }) as Plot;

/** The smallest white gap between each axis name and any of that axis's numbers (negative = the boxes overlap). */
function gaps(plot: Plot, size: { width: number; height: number }): number[] {
  const s = buildPlotScene(table, plot, { ...size, measure });
  const out: number[] = [];
  for (const a of s.scatter3d!.axes) {
    if (a.hidden) continue;
    const tp = a.tickFont?.size ?? s.fonts.tick.size, np = a.titleFont?.size ?? s.fonts.axisTitle.size;
    const nw = measure(a.label, np), nh = np;
    let best = Infinity;
    for (const t of a.ticks ?? []) {
      const tw = measure(t.label, tp);
      const gapX = Math.abs(t.lx - a.lx) - (tw + nw) / 2;
      const gapY = Math.abs(t.ly - a.ly) - (tp * 1.05 + nh * 1.05) / 2;
      best = Math.min(best, Math.max(gapX, gapY));
    }
    if (best !== Infinity) out.push(best);
  }
  return out;
}

describe("3-D axis names against their numbers", () => {
  it("keep 6 px clear with large type, at the sizes a card and a panel use", () => {
    const big = { fonts: { tick: { size: 20 }, axisTitle: { size: 22, bold: true } } } as unknown as Partial<Plot>;
    for (const size of [{ width: 760, height: 520 }, { width: 580, height: 380 }, { width: 420, height: 320 }]) {
      for (const g of gaps(plotOf(big), size)) expect(g, `${size.width}×${size.height}`).toBeGreaterThanOrEqual(6);
    }
  });

  it("with the default type too", () => {
    for (const g of gaps(plotOf(), { width: 580, height: 380 })) expect(g).toBeGreaterThanOrEqual(6);
  });
});
