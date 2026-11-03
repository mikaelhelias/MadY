import { describe, expect, it } from "vitest";
import { fitCurves, fitOffsetsOf, resolveFitStyle } from "./fitStyle";
import type { PlotFit } from "./model";

const pf = (label: string, analysisSource?: string): PlotFit => ({ label, points: [[0, 0], [1, 1]], ...(analysisSource ? { analysisSource } : {}) });

describe("fitCurves", () => {
  it("the single fit comes first, then the per-sample curves, in drawing order", () => {
    const refs = fitCurves({ fit: pf("S"), fits: [pf("A"), pf("B")] });
    expect(refs.map((r) => [r.pf.label, r.slot])).toEqual([["S", "fit"], ["A", 0], ["B", 1]]);
  });
  it("a curve with no analysis behind it is keyed by its place", () => {
    expect(fitCurves({ fit: pf("S"), fits: [pf("A"), pf("B")] }).map((r) => r.key)).toEqual(["fit", "0", "1"]);
  });
  it("a curve an analysis made is keyed by the analysis and its name, wherever it is stored", () => {
    expect(fitCurves({ fit: pf("S", "an1"), fits: [pf("A", "an2")] }).map((r) => r.key)).toEqual(["an1:S", "an2:A"]);
  });
  it("two curves with one key still get their own keys", () => {
    expect(fitCurves({ fits: [pf("A", "an1"), pf("A", "an1")] }).map((r) => r.key)).toEqual(["an1:A", "an1:A#2"]);
  });
  it("a plot with no curves has none", () => {
    expect(fitCurves({})).toEqual([]);
  });
});

describe("fitOffsetsOf", () => {
  const ref = (key: string, slot: "fit" | number) => ({ key, slot });
  it("reads the offsets stored under the key", () => {
    expect(fitOffsetsOf({ fitsOffsets: { "an1:A": { label: { dx: 1, dy: 2 } } } }, ref("an1:A", 0))).toEqual({ label: { dx: 1, dy: 2 } });
  });
  it("falls back to the position a saved graph used", () => {
    expect(fitOffsetsOf({ fitsOffsets: { "0": { label: { dx: 3, dy: 4 } } } }, ref("an1:A", 0))).toEqual({ label: { dx: 3, dy: 4 } });
  });
  it("never reads a position for the single-fit slot", () => {
    expect(fitOffsetsOf({ fitsOffsets: { "0": { label: { dx: 3, dy: 4 } } } }, ref("an1:S", "fit"))).toBeUndefined();
  });
});

describe("resolveFitStyle", () => {
  it("with no per-curve entry, every curve gets the graph-wide style", () => {
    const plot = { fitStyle: { color: "#111111", width: 3 } };
    expect(resolveFitStyle(plot, "0")).toEqual({ color: "#111111", width: 3 });
    expect(resolveFitStyle({}, "fit")).toEqual({});
  });

  it("a field the curve sets wins for that curve only; the rest fall back to the graph-wide style", () => {
    const plot = { fitStyle: { color: "#111111", width: 3 }, fitStyles: { "1": { color: "#ff0000" } } };
    expect(resolveFitStyle(plot, "1")).toEqual({ color: "#ff0000", width: 3 });
    expect(resolveFitStyle(plot, "0")).toEqual({ color: "#111111", width: 3 });
  });

  it("a field set to undefined on the curve does not blank the graph-wide value", () => {
    const plot = { fitStyle: { color: "#111111" }, fitStyles: { "0": { color: undefined, dash: "dashed" as const } } };
    expect(resolveFitStyle(plot, "0")).toEqual({ color: "#111111", dash: "dashed" });
  });

  it("show=false on one curve hides that curve while the graph-wide style stays on", () => {
    const plot = { fitStyle: {}, fitStyles: { "0": { show: false } } };
    expect(resolveFitStyle(plot, "0").show).toBe(false);
    expect(resolveFitStyle(plot, "1").show).toBeUndefined();
  });

  it("does not change the plot it reads", () => {
    const plot = { fitStyle: { width: 3 }, fitStyles: { "0": { width: 5 } } };
    const before = JSON.stringify(plot);
    resolveFitStyle(plot, "0");
    expect(JSON.stringify(plot)).toBe(before);
  });
});
