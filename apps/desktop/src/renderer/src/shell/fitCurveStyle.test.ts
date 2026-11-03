import { describe, expect, it } from "vitest";
import { fitCurveRemoval, fitStylePatch, fitStyleReset } from "./fitCurveStyle";

describe("fitCurveRemoval", () => {
  const pf = (label: string, analysisSource?: string) => ({ label, points: [[0, 0], [1, 1]] as [number, number][], ...(analysisSource ? { analysisSource } : {}) });
  const plot = {
    fit: pf("S", "an1"),
    fits: [pf("A", "an2"), pf("B", "an2")],
    fitStyles: { "an1:S": { color: "#111111" }, "an2:B": { color: "#00aa00" } },
    fitsOffsets: { "an2:B": { label: { dx: 1, dy: 2 } }, "0": { label: { dx: 9, dy: 9 } } },
  };
  it("takes a per-sample curve out, with its own style and offsets, and leaves the others", () => {
    const r = fitCurveRemoval(plot, "an2:B");
    expect(r.fits?.map((f) => f.label)).toEqual(["A"]);
    expect(r.fit?.label).toBe("S");
    expect(r.fitStyles).toEqual({ "an1:S": { color: "#111111" } });
    expect(r.fitsOffsets).toEqual({ "0": { label: { dx: 9, dy: 9 } } });
  });
  it("takes the single fit out, and the per-sample curves stay", () => {
    const r = fitCurveRemoval(plot, "an1:S");
    expect(r.fit).toBeUndefined();
    expect(r.fits?.length).toBe(2);
    expect(r.fitStyles).toEqual({ "an2:B": { color: "#00aa00" } });
  });
  it("also takes offsets a saved graph stored under the curve's position", () => {
    const r = fitCurveRemoval(plot, "an2:A");
    expect(r.fitsOffsets).toEqual({ "an2:B": { label: { dx: 1, dy: 2 } } });
  });
  it("removing the last per-sample curve leaves no fits list; an unknown key changes nothing", () => {
    expect(fitCurveRemoval({ fits: [pf("A", "an2")] }, "an2:A").fits).toBeUndefined();
    expect(fitCurveRemoval(plot, "nope")).toEqual({ fit: plot.fit, fits: plot.fits, fitStyles: plot.fitStyles, fitsOffsets: plot.fitsOffsets });
  });
});

describe("fitStylePatch", () => {
  it("one curve: the field goes to that curve's own entry and fitStyle is untouched", () => {
    const r = fitStylePatch({ fitStyle: { width: 3 } }, "1", { color: "#00aa00" });
    expect(r.fitStyles).toEqual({ "1": { color: "#00aa00" } });
    expect(r.fitStyle).toEqual({ width: 3 });
  });

  it("one curve: a second field joins its entry, the first is kept", () => {
    const r = fitStylePatch({ fitStyles: { "1": { color: "#00aa00" } } }, "1", { width: 5 });
    expect(r.fitStyles).toEqual({ "1": { color: "#00aa00", width: 5 } });
  });

  it("one curve: another curve's entry is left alone", () => {
    const r = fitStylePatch({ fitStyles: { "0": { color: "#111111" } } }, "1", { color: "#00aa00" });
    expect(r.fitStyles).toEqual({ "0": { color: "#111111" }, "1": { color: "#00aa00" } });
  });

  it("one curve: the graph-wide fields (legend, control shift) are still written to fitStyle", () => {
    const r = fitStylePatch({}, "0", { inLegend: true, markerDelta: false });
    expect(r.fitStyle).toEqual({ inLegend: true, markerDelta: false });
    expect(r.fitStyles).toBeUndefined();
  });

  it("one curve: setting a field to undefined removes it, and an empty entry is dropped", () => {
    const r = fitStylePatch({ fitStyles: { "1": { color: "#00aa00" } } }, "1", { color: undefined });
    expect(r.fitStyles).toBeUndefined();
  });

  it("every curve: the field goes to fitStyle and is taken off each curve's own entry, so all really is all", () => {
    const plot = { fitStyle: { width: 3 }, fitStyles: { "0": { color: "#111111", dash: "dashed" as const }, "1": { color: "#00aa00" } } };
    const r = fitStylePatch(plot, "all", { color: "#ff0000" });
    expect(r.fitStyle).toEqual({ width: 3, color: "#ff0000" });
    expect(r.fitStyles).toEqual({ "0": { dash: "dashed" } }); // its dash stays; the emptied entry of curve 1 is dropped
  });

  it("every curve: a field the curves do not own leaves their entries as they were", () => {
    const plot = { fitStyles: { "1": { color: "#00aa00" } } };
    const r = fitStylePatch(plot, "all", { width: 4 });
    expect(r.fitStyle).toEqual({ width: 4 });
    expect(r.fitStyles).toEqual({ "1": { color: "#00aa00" } });
  });

  it("does not change the plot it reads", () => {
    const plot = { fitStyle: { width: 3 }, fitStyles: { "0": { color: "#111111" } } };
    const before = JSON.stringify(plot);
    fitStylePatch(plot, "all", { color: "#ff0000" });
    fitStylePatch(plot, "0", { width: 9 });
    expect(JSON.stringify(plot)).toBe(before);
  });
});

describe("fitStyleReset", () => {
  const plot = { fitStyle: { width: 3, inLegend: true }, fitStyles: { "0": { color: "#111111" }, "1": { color: "#00aa00" } } };
  it("every curve clears fitStyle and every curve's own entry", () => {
    expect(fitStyleReset(plot, "all")).toEqual({ fitStyle: undefined, fitStyles: undefined });
  });
  it("one curve clears only its own entry", () => {
    expect(fitStyleReset(plot, "1")).toEqual({ fitStyle: plot.fitStyle, fitStyles: { "0": { color: "#111111" } } });
  });
  it("one curve with no entry of its own changes nothing", () => {
    expect(fitStyleReset({ fitStyle: { width: 3 } }, "0")).toEqual({ fitStyle: { width: 3 }, fitStyles: undefined });
  });
});
