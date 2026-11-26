/**
 * The fit-parameter block of a graph does not print over its data.
 *
 * Built through the real XY builder: a decaying series ends in the bottom-right corner, the
 * block's default place, so the block takes a corner that is clear; when no corner is clear it keeps its
 * place and the graph says how many points it covers; a side the user chose is left alone.
 */
import { describe, expect, it } from "vitest";
import type { DataTable, Plot } from "@mady/core";
import { buildPlotScene } from "./buildScene";
import { fitBlockHeight } from "./fitBlockSteps";

const times = [0, 6, 12, 18, 24, 30, 36, 42, 48, 54, 60, 66, 72, 78, 84, 90];
const decay = (t: number) => 5000 * Math.exp(-t / 20) + 150;
const table = {
  id: "t", kind: "xy", name: "Decay",
  columns: [{ id: "x", name: "Time", role: "x" }, { id: "y", name: "Counts", role: "y" }],
  rows: times.map((t, i) => ({ id: `r${i}`, cells: { x: t, y: Math.round(decay(t)) } })),
} as unknown as DataTable;
const fit = {
  label: "One-phase decay",
  points: Array.from({ length: 80 }, (_, i) => { const t = (90 * i) / 79; return [t, decay(t)] as [number, number]; }),
  params: ["Y0 = 5150 ± 29", "Plateau = 150 ± 18", "K = 0.05 ± 0.0007", "Half-life = 13.9", "R² = 0.9996", "Adjusted R² = 0.9996"],
};
const plot = (over: Partial<Plot> = {}): Plot => ({ id: "p", name: "P", source: "t", kind: "xy", fit, ...over }) as Plot;
const build = (p: Plot, size = { width: 560, height: 400 }) => buildPlotScene(table, p, size);
const coverWarning = (w: string[]) => w.filter((x) => /fit parameters cover/.test(x));

describe("the fit-parameter block of an XY graph", () => {
  it("leaves the corner where the decay ends, for a clear one, and says nothing", () => {
    const s = build(plot());
    const p = s.fit!.params!;
    expect(p.y, "still at the bottom, over the last points").toBeLessThan(s.plot.y + s.plot.height / 2);
    expect(coverWarning(s.warnings)).toEqual([]);
  });

  /** Where the block sits when anchored bottom-right: its first line, stacked up from the bottom edge. */
  const bottomRight = (s: ReturnType<typeof build>) => {
    const p = s.fit!.params!;
    return { x: s.plot.x + s.plot.width - 8, y: s.plot.y + s.plot.height - 8 - fitBlockHeight(p.lines, p.size) };
  };

  it("keeps its place and says how many points it covers when no corner is clear", () => {
    // Text so large the block covers points wherever it goes.
    const s = build(plot({ fitParams: { size: 30 } } as Partial<Plot>));
    const p = s.fit!.params!;
    expect(p.anchor).toBe("end");
    expect({ x: p.x, y: p.y }).toEqual(bottomRight(s));
    expect(coverWarning(s.warnings)).toHaveLength(1);
  });

  it("a side the user chose is left alone", () => {
    const s = build(plot({ fitParams: { align: "right" } } as Partial<Plot>));
    const p = s.fit!.params!;
    expect({ x: p.x, y: p.y }).toEqual(bottomRight(s));
  });
});
