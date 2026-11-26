/**
 * Several analyses of the same data can each draw their fitted curve on one graph. Attaching one analysis's curves
 * keeps every other analysis's; a re-run replaces only its own, in place; deleting an analysis takes only its own off.
 */
import { describe, expect, it } from "vitest";
import { MadyDocument, fitCurves } from "@mady/core";
import type { AnalysisResult } from "@mady/core";
import { buildPlotScene } from "@mady/graphics";
import { applyAnalysisFit } from "./analysisFits";

const line = (title: string, y: number[]): AnalysisResult => ({ method: "regression", title, summary: "", glance: {}, terms: [], extra: { curve: { x: [1, 2, 3], y } } }) as AnalysisResult;
const global = (labels: string[]): AnalysisResult => ({ method: "globalfit", title: "Global", summary: "", glance: {}, terms: [], extra: { curves: labels.map((label, k) => ({ label, x: [1, 2, 3], y: [k + 1, k + 2, k + 3] })) } }) as AnalysisResult;

function setup() {
  const doc = new MadyDocument();
  const t = doc.importTable("XY", "xy", ["X", "A", "B"], [[1, 2, 3], [2, 4, 6], [3, 6, 9]]);
  const plot = doc.addPlot("G", t.id);
  const cols = t.columns.map((c) => c.id);
  const reg = (name: string, result: AnalysisResult) => {
    const a = doc.addAnalysis(name, "regression", t.id, { columns: cols });
    doc.setAnalysisResult(a.id, result);
    return a;
  };
  const glob = (labels: string[]) => {
    const a = doc.addAnalysis("Global", "globalfit", t.id, { columns: cols.slice(1) });
    doc.setAnalysisResult(a.id, global(labels));
    return a;
  };
  return { doc, t, plot, reg, glob };
}

describe("several analyses on one graph", () => {
  it("a second curve fit adds its curve; the first stays", () => {
    const { doc, plot, reg } = setup();
    const a = reg("Line A", line("Line A", [2, 4, 6]));
    const b = reg("Line B", line("Line B", [3, 6, 9]));
    expect(applyAnalysisFit(doc, a.id, plot.id)).toBe(true);
    expect(applyAnalysisFit(doc, b.id, plot.id)).toBe(true);
    expect(plot.fit?.analysisSource).toBe(a.id);
    expect(plot.fits?.map((f) => f.analysisSource)).toEqual([b.id]);
    expect(fitCurves(plot).map((c) => c.pf.label)).toEqual(["Line A", "Line B"]);
    const keys = fitCurves(plot).map((c) => c.key);
    expect(new Set(keys).size).toBe(2);
  });

  it("a re-run replaces only that analysis's curve, in place", () => {
    const { doc, plot, reg } = setup();
    const a = reg("Line A", line("Line A", [2, 4, 6]));
    const b = reg("Line B", line("Line B", [3, 6, 9]));
    applyAnalysisFit(doc, a.id, plot.id);
    applyAnalysisFit(doc, b.id, plot.id);
    doc.setAnalysisResult(b.id, line("Line B", [30, 60, 90]));
    applyAnalysisFit(doc, b.id, plot.id);
    expect(plot.fit?.points).toEqual([[1, 2], [2, 4], [3, 6]]); // A untouched
    expect(plot.fits).toHaveLength(1);
    expect(plot.fits![0]!.points).toEqual([[1, 30], [2, 60], [3, 90]]);
  });

  it("a global fit and a curve fit live together; re-running the global fit with the same count keeps positions", () => {
    const { doc, plot, reg, glob } = setup();
    const a = reg("Line A", line("Line A", [2, 4, 6]));
    const g = glob(["A", "B"]);
    applyAnalysisFit(doc, a.id, plot.id);
    applyAnalysisFit(doc, g.id, plot.id);
    expect(plot.fit?.analysisSource).toBe(a.id);
    expect(plot.fits?.map((f) => f.label)).toEqual(["A", "B"]);
    doc.setAnalysisResult(g.id, global(["A", "B"]));
    applyAnalysisFit(doc, g.id, plot.id);
    expect(plot.fits?.map((f) => f.label)).toEqual(["A", "B"]);
    expect(plot.fit?.analysisSource).toBe(a.id);
  });

  it("a re-run of the first of two global fits keeps its curves first, so the drawing order and the default colours stay", () => {
    const { doc, plot, glob } = setup();
    const g1 = glob(["A", "B"]);
    const g2 = glob(["C", "D"]);
    applyAnalysisFit(doc, g1.id, plot.id);
    applyAnalysisFit(doc, g2.id, plot.id);
    expect(plot.fits?.map((f) => f.label)).toEqual(["A", "B", "C", "D"]);
    doc.setAnalysisResult(g1.id, global(["A", "B"]));
    applyAnalysisFit(doc, g1.id, plot.id);
    expect(plot.fits?.map((f) => f.label)).toEqual(["A", "B", "C", "D"]); // not C, D, A, B
  });

  it("a re-run that changes the number of curves removes the old ones and appends the new", () => {
    const { doc, plot, reg, glob } = setup();
    const g = glob(["A", "B"]);
    const a = reg("Line A", line("Line A", [2, 4, 6]));
    applyAnalysisFit(doc, g.id, plot.id);
    applyAnalysisFit(doc, a.id, plot.id);
    doc.setAnalysisResult(g.id, global(["A"]));
    applyAnalysisFit(doc, g.id, plot.id);
    expect(plot.fits?.map((f) => f.label)).toEqual(["A"]);
    expect(plot.fit?.analysisSource).toBe(a.id);
  });

  it("Undo takes the added analysis off again and puts the graph back as it was", () => {
    const { doc, plot, reg } = setup();
    const a = reg("Line A", line("Line A", [2, 4, 6]));
    const b = reg("Line B", line("Line B", [3, 6, 9]));
    applyAnalysisFit(doc, a.id, plot.id);
    applyAnalysisFit(doc, b.id, plot.id);
    doc.commands.undo();
    expect(plot.fit?.analysisSource).toBe(a.id);
    expect(plot.fits).toBeUndefined();
  });

  it("deleting an analysis takes only its own curves off the graph", () => {
    const { doc, plot, reg } = setup();
    const a = reg("Line A", line("Line A", [2, 4, 6]));
    const b = reg("Line B", line("Line B", [3, 6, 9]));
    applyAnalysisFit(doc, a.id, plot.id);
    applyAnalysisFit(doc, b.id, plot.id);
    doc.removeAnalysis(b.id);
    expect(plot.fit?.analysisSource).toBe(a.id);
    expect(plot.fits).toBeUndefined();
    doc.removeAnalysis(a.id);
    expect(plot.fit).toBeUndefined();
  });

  it("each analysis's curve is drawn, and its own style follows it through a re-run", () => {
    const { doc, plot, reg } = setup();
    const a = reg("Line A", line("Line A", [2, 4, 6]));
    const b = reg("Line B", line("Line B", [3, 6, 9]));
    applyAnalysisFit(doc, a.id, plot.id);
    applyAnalysisFit(doc, b.id, plot.id);
    const keyB = fitCurves(plot).find((c) => c.pf.analysisSource === b.id)!.key;
    doc.setPlotOptions(plot.id, { fitStyles: { [keyB]: { color: "#00aa00", width: 6 } } });
    const draw = () => buildPlotScene(doc.toJSON().tables[0]!, doc.toJSON().plots[0]!, { width: 620, height: 420 });
    let s = draw();
    expect(s.fit && s.fits?.length).toBe(1);
    expect([s.fit!.color, s.fits![0]!.color]).not.toEqual(["#00aa00", "#00aa00"]);
    expect(s.fits![0]!.color).toBe("#00aa00");
    expect(s.fits![0]!.width).toBe(6);
    expect(s.fit!.width).toBe(2.4);
    // a re-run of B, and then of A, keeps each style on its own curve
    doc.setAnalysisResult(b.id, line("Line B", [30, 60, 90]));
    applyAnalysisFit(doc, b.id, plot.id);
    doc.setAnalysisResult(a.id, line("Line A", [20, 40, 60]));
    applyAnalysisFit(doc, a.id, plot.id);
    s = draw();
    expect(s.fits![0]!.color).toBe("#00aa00");
    expect(s.fit!.color).not.toBe("#00aa00");
  });
});
