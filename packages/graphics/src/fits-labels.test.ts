/**
 * Per-series fits (`Plot.fits[]`) carry their potency label and parameter block like the single
 * `Plot.fit` does — and, with two of them, the blocks stack instead of overprinting, and each
 * fit's dragged offsets are its own (`Plot.fitsOffsets`, keyed by fit index).
 * Guards against a 4PL fit whose crosshairs draw while neither its label nor its parameter block does.
 */
import { assert, describe, expect, it } from "vitest";
import { buildPlotScene } from "./buildScene";
import type { DataTable, Plot, PlotFit } from "@mady/core";

const table: DataTable = {
  id: "t", kind: "xy", name: "T",
  columns: [{ id: "x", name: "Dose", role: "x" }, { id: "a", name: "A", role: "y" }, { id: "b", name: "B", role: "y" }],
  rows: [[0.1, 5, 6], [1, 20, 12], [10, 80, 40], [100, 95, 85]].map((r, i) => ({ id: `r${i}`, cells: { x: r[0]!, a: r[1]!, b: r[2]! } })),
};
const fit = (label: string, ec50: number): PlotFit => ({
  label,
  points: [[0.1, 5], [1, 20], [10, 80], [100, 95]],
  params: [`EC_{50} = ${ec50}`, "Hill = 1.1", "Top = 95"],
  marker: { x: ec50, y: 50, label: `EC50 = ${ec50}` },
});
const plot = (extra: Partial<Plot> = {}): Plot => ({
  id: "p", name: "P", source: "t", status: "ok", styleOverrides: {}, kind: "xy",
  fits: [fit("A (4PL)", 2), fit("B (4PL)", 30)], xAxis: { scale: "log10" }, ...extra,
});
const SIZE = { width: 720, height: 500 };

describe("per-series fits carry their label and parameter block", () => {
  it("every fit has its potency label and its parameter lines", () => {
    const s = buildPlotScene(table, plot(), SIZE);
    expect(s.fits).toHaveLength(2);
    for (const f of s.fits!) {
      expect(f.marker?.label).toMatch(/^EC50 = /);
      expect(f.params?.lines.length).toBe(3);
    }
  });
  it("two parameter blocks stack — the second sits wholly above the first", () => {
    const s = buildPlotScene(table, plot(), SIZE);
    const [a, b] = s.fits!.map((f) => f.params!);
    assert(a && b, "Both fit parameter blocks must exist");
    const height = (p: typeof a) => (p.lines.length - 1) * p.size * 1.25 + p.size; // baselines + the last line's glyphs
    expect(b.y + height(b), "block B overprints block A").toBeLessThan(a.y);
    expect(b.x).toBe(a.x);
  });
  it("a fit's dragged offsets are its OWN (fitsOffsets[index]), not every fit's", () => {
    const s = buildPlotScene(table, plot({ fitsOffsets: { "1": { label: { dx: 7, dy: -9 }, params: { dx: -30, dy: 4 } } } }), SIZE);
    expect(s.fits![1]!.marker!.labelOffset).toEqual({ dx: 7, dy: -9 });
    expect(s.fits![1]!.params!.offset).toEqual({ dx: -30, dy: 4 });
    expect(s.fits![0]!.marker!.labelOffset).toBeUndefined();
    expect(s.fits![0]!.params!.offset).toBeUndefined();
  });
  it("the single-fit offsets stay the single fit's (a fits[] entry never borrows them)", () => {
    const s = buildPlotScene(table, plot({ fitLabelOffset: { dx: 3, dy: 3 }, fitParams: { offset: { dx: 5, dy: 5 } } }), SIZE);
    for (const f of s.fits!) {
      expect(f.marker!.labelOffset).toBeUndefined();
      expect(f.params!.offset).toBeUndefined();
    }
  });
});
