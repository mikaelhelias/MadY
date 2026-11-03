/**
 * One fitted curve can be styled on its own. `plot.fitStyle` styles every curve alike; `plot.fitStyles[id]` lays that
 * curve's own fields over it ("fit" for the single fit, "0", "1"… for `fits[i]`).
 */
import { describe, expect, it } from "vitest";
import type { DataTable, Plot, PlotFit } from "@mady/core";
import { buildPlotScene } from "./buildScene.js";

const fit = (label: string, k: number): PlotFit => ({
  label,
  points: [0, 1, 2, 3].map((x) => [x, k * x] as [number, number]),
  confidenceBand: [0, 1, 2, 3].map((x) => [x, k * x - 0.3, k * x + 0.3] as [number, number, number]),
  marker: { x: 1.5, y: 1.5 * k, label: `EC50 ${label}` },
});
const table: DataTable = {
  id: "t", kind: "xy", name: "T",
  columns: [{ id: "x", name: "X" }, { id: "a", name: "A" }, { id: "b", name: "B" }],
  rows: [0, 1, 2, 3].map((x, i) => ({ id: `r${i}`, cells: { x, a: x, b: 2 * x } })),
};
const base: Plot = { id: "p", name: "P", source: "t", status: "ok", styleOverrides: {}, kind: "xy", fits: [fit("A", 1), fit("B", 2)] };
const build = (patch: Partial<Plot>) => buildPlotScene(table, { ...base, ...patch }, {});

describe("per-curve fitted-curve style", () => {
  it("is what the graph shows when no curve has its own entry: both curves share fitStyle", () => {
    const s = build({ fitStyle: { color: "#ff0000", width: 5 } });
    expect(s.fits!.map((f) => f.color)).toEqual(["#ff0000", "#ff0000"]);
    expect(s.fits!.map((f) => f.width)).toEqual([5, 5]);
  });

  it("colour set on one curve changes that curve only, with its bands and its marker", () => {
    const s = build({ fitStyles: { "1": { color: "#00aa00" } } });
    expect(s.fits![0]!.color).toBe("#0072B2"); // the palette default, untouched
    expect(s.fits![1]!.color).toBe("#00aa00");
    expect(s.fits![1]!.ciColor).toBe("#00aa00"); // the bands follow their own curve
    expect(s.fits![1]!.marker?.color).toBe("#00aa00"); // so does its EC50 crosshair
    expect(s.fits![0]!.ciColor).toBe("#0072B2");
  });

  it("width, dash and opacity are per curve", () => {
    const s = build({ fitStyles: { "0": { width: 6, dash: "dashed", opacity: 0.5 } } });
    expect(s.fits![0]!.width).toBe(6);
    expect(s.fits![0]!.dash).not.toBeNull();
    expect(s.fits![0]!.opacity).toBe(0.5);
    expect(s.fits![1]!.width).toBe(2.4);
    expect(s.fits![1]!.dash).toBeNull();
    expect(s.fits![1]!.opacity).toBe(1);
  });

  it("a curve's own field wins over fitStyle; its other fields still follow fitStyle", () => {
    const s = build({ fitStyle: { color: "#111111", width: 4 }, fitStyles: { "1": { color: "#00aa00" } } });
    expect(s.fits!.map((f) => f.color)).toEqual(["#111111", "#00aa00"]);
    expect(s.fits!.map((f) => f.width)).toEqual([4, 4]);
  });

  it("show=false hides one curve and keeps the other", () => {
    const s = build({ fitStyles: { "0": { show: false } } });
    expect(s.fits!.map((f) => f.showCurve)).toEqual([false, true]);
  });

  it("the single fit is keyed \"fit\"", () => {
    const s = buildPlotScene(table, { ...base, fits: undefined, fit: fit("A", 1), fitStyles: { fit: { color: "#00aa00" } } }, {});
    expect(s.fit!.color).toBe("#00aa00");
  });

  describe("curves an analysis made are keyed by the analysis and their name", () => {
    const withParams = (label: string, k: number, analysisSource?: string): PlotFit => ({ ...fit(label, k), params: ["a = 1"], ...(analysisSource ? { analysisSource } : {}) });
    const made = (over: Partial<Plot> = {}) => build({ fits: [withParams("A", 1, "an1"), withParams("B", 2, "an1")], ...over });

    it("a curve's key is in its scene, and a style stored under it reaches that curve", () => {
      const s = made({ fitStyles: { "an1:B": { color: "#00aa00" } } });
      expect(s.fits!.map((f) => f.key)).toEqual(["an1:A", "an1:B"]);
      expect(s.fits![1]!.color).toBe("#00aa00");
      expect(s.fits![0]!.color).toBe("#0072B2");
    });

    it("a style stored under the old position does not reach it any more", () => {
      const s = made({ fitStyles: { "1": { color: "#00aa00" } } });
      expect(s.fits![1]!.color).toBe("#E69F00");
    });

    it("dragged offsets stored under the key apply, and so do offsets saved under the position", () => {
      const byKey = made({ fitsOffsets: { "an1:B": { params: { dx: 40, dy: -30 } } } });
      expect(byKey.fits![1]!.params?.offset).toEqual({ dx: 40, dy: -30 });
      const byPosition = made({ fitsOffsets: { "1": { params: { dx: 5, dy: 6 } } } });
      expect(byPosition.fits![1]!.params?.offset).toEqual({ dx: 5, dy: 6 });
      expect(byPosition.fits![0]!.params?.offset).toBeUndefined();
    });

    it("the key wins over the old position when both are stored", () => {
      const s = made({ fitsOffsets: { "an1:B": { params: { dx: 40, dy: -30 } }, "1": { params: { dx: 5, dy: 6 } } } });
      expect(s.fits![1]!.params?.offset).toEqual({ dx: 40, dy: -30 });
    });
  });

  it("the single fit's parameter block and the per-sample blocks are stacked, not printed over each other", () => {
    const s = buildPlotScene(table, { ...base, fit: { ...fit("Single", 1), params: ["k = 1"] }, fits: [{ ...fit("A", 1), params: ["a = 1"] }, { ...fit("B", 2), params: ["b = 2"] }] }, {});
    const ys = [s.fit!, ...s.fits!].map((f) => f.params!.y);
    expect(new Set(ys).size, "three blocks at three different heights").toBe(3);
    expect(ys[1]!).toBeLessThan(ys[0]!); // each placed wholly above the one before
    expect(ys[2]!).toBeLessThan(ys[1]!);
  });

  it("the legend row of a curve shows that curve's own look, and a hidden curve lists nothing", () => {
    const s = build({ fitStyle: { inLegend: true }, fitStyles: { "0": { color: "#00aa00", width: 5 }, "1": { show: false } } });
    const rows = s.legend.filter((e) => e.select?.as === "fit");
    expect(rows.map((r) => r.label)).toEqual(["A"]);
    expect(rows[0]!.color).toBe("#00aa00");
    expect(rows[0]!.lineWidth).toBe(5);
  });
});
