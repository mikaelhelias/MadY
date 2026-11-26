/**
 * Axis ▸ Reversed on the Manhattan and QQ plots. Both builders drew with fixed pixel ranges, so the setting changed
 * nothing on either axis. Reversed now mirrors the marks: the smallest value sits where the largest did.
 */
import { describe, expect, it } from "vitest";
import type { Column, DataTable, Plot } from "@mady/core";
import { buildPlotScene } from "./buildScene";

const SIZE = { width: 620, height: 420 };
const col = (id: string, name: string, role: Column["role"]): Column => ({ id, name, role } as Column);
const gwas: DataTable = {
  id: "t", name: "gwas",
  columns: [col("chr", "Chr", "x"), col("pos", "Pos", "y"), col("p", "P", "y")],
  rows: Array.from({ length: 24 }, (_, i) => ({ id: `r${i}`, cells: { chr: String(1 + (i % 3)), pos: 1000 * (i + 1), p: 10 ** -(1 + (i % 7)) } })),
} as unknown as DataTable;
const plot = (kind: "manhattan" | "qq", patch: Partial<Plot> = {}): Plot => ({ id: "p", name: kind, kind, source: "t", ...patch }) as Plot;
const marks = (p: Plot) => buildPlotScene(gwas, p, SIZE).series.flatMap((s) => s.marks).filter((m) => m.cx != null && m.cy != null);
/** The pixel of the mark with the smallest data value, and of the one with the largest, along an axis. */
const ends = (p: Plot, axis: "x" | "y"): [number, number] => {
  const ms = marks(p);
  const key = axis === "x" ? "dx" : "dy";
  const lo = ms.reduce((a, b) => ((b[key] as number) < (a[key] as number) ? b : a));
  const hi = ms.reduce((a, b) => ((b[key] as number) > (a[key] as number) ? b : a));
  return axis === "x" ? [lo.cx!, hi.cx!] : [lo.cy!, hi.cy!];
};

describe("Reversed on genome-scan axes", () => {
  for (const kind of ["manhattan", "qq"] as const) {
    for (const axis of ["x", "y"] as const) {
      it(`${kind} ${axis.toUpperCase()}: reversed swaps the ends`, () => {
        const [lo, hi] = ends(plot(kind), axis);
        expect(lo).not.toBe(hi);
        const spec = axis === "x" ? "xAxis" : "yAxis";
        const [rlo, rhi] = ends(plot(kind, { [spec]: { reversed: true } }), axis);
        // The smallest value now sits on the side the largest was on.
        expect(Math.sign(rhi - rlo)).toBe(-Math.sign(hi - lo));
      });
      it(`${kind} ${axis.toUpperCase()}: reversed keeps every axis label`, () => {
        const spec = axis === "x" ? "xAxis" : "yAxis";
        const labels = (p: Plot): string[] => buildPlotScene(gwas, p, SIZE)[axis].ticks.filter((t) => !t.minor && t.label).map((t) => t.label).sort();
        expect(labels(plot(kind, { [spec]: { reversed: true } }))).toEqual(labels(plot(kind)));
      });
    }
  }
});
