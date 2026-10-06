import { expect, it } from "vitest";
import { MadyDocument } from "@mady/core";
import { applyAnalysisFit } from "./analysisFits";

it("refreshes bound fit data and bands while preserving graph styling", () => {
  const doc = new MadyDocument();
  const t = doc.importTable("XY", "xy", ["X", "Y"], [[1,2],[2,4],[3,6]]);
  const p = doc.addPlot("Fit", t.id);
  const a = doc.addAnalysis("Line", "regression", t.id, { columns: t.columns.map(c => c.id) });
  doc.setPlotOptions(p.id, { fitStyle: { color: "#123456", width: 7 } });
  doc.setAnalysisResult(a.id, { method: "regression", title: "Line", summary: "", glance: {}, terms: [],
    extra: { curve: { x: [1,3], y: [2,6], ciLow: [1,5], ciHigh: [3,7] } } });
  expect(applyAnalysisFit(doc, a.id, p.id)).toBe(true);
  const old = p.fit;
  doc.setAnalysisResult(a.id, { ...a.result!, extra: { curve: { x: [1,3], y: [4,12], ciLow: [3,11], ciHigh: [5,13] } } });
  expect(applyAnalysisFit(doc, a.id, p.id)).toBe(true);
  doc.refreshPlotStatus();
  expect(p.fit?.points).toEqual([[1,4],[3,12]]);
  expect(p.fit?.confidenceBand).toEqual([[1,3,5],[3,11,13]]);
  expect(p.fit?.analysisSource).toBe(a.id);
  expect(p.status).toBe("ok");
  expect(p.fitStyle).toEqual({ color: "#123456", width: 7 });
  expect(old?.points).toEqual([[1,2],[3,6]]);
});

it("global fits keep each dataset colour and update all fitted curves", () => {
  const doc = new MadyDocument();
  const t = doc.importTable("XY", "xy", ["X", "A", "B"], [[1,2,3],[2,4,6]]);
  const p = doc.addPlot("Global", t.id);
  const a = doc.addAnalysis("Global", "globalfit", t.id, { columns: t.columns.slice(1).map(c => c.id) });
  doc.setSeriesStyle(p.id, t.columns[1]!.id, { color: "#123456" });
  doc.setAnalysisResult(a.id, { method: "globalfit", title: "Global", summary: "", glance: {}, terms: [],
    extra: { curves: [{ label: "A", x: [1,2], y: [2,4] }, { label: "B", x: [1,2], y: [3,6] }] } });
  expect(applyAnalysisFit(doc, a.id, p.id)).toBe(true);
  expect(p.fits?.map(f => f.points)).toEqual([[[1,2],[2,4]], [[1,3],[2,6]]]);
  expect(p.fits?.[0]?.color).toBe("#123456");
  expect(p.fits?.every(f => f.analysisSource === a.id)).toBe(true);
});

it("refuses incomplete results rather than stamping an old fit current", () => {
  const doc = new MadyDocument();
  const t = doc.importTable("XY", "xy", ["X", "Y"], [[1,2],[2,4]]);
  const p = doc.addPlot("Fit", t.id);
  const a = doc.addAnalysis("Fit", "curvefit", t.id, { columns: t.columns.map(c => c.id) });
  doc.setAnalysisResult(a.id, { method: "curvefit", title: "Fit", terms: [], glance: {}, summary: "" });
  expect(applyAnalysisFit(doc, a.id, p.id)).toBe(false);
  expect(p.fit).toBeUndefined();
  doc.setAnalysisResult(a.id, { method: "globalfit", title: "Fit", terms: [], glance: {}, summary: "", extra: { curves: "invalid" } });
  a.method = "globalfit";
  expect(applyAnalysisFit(doc, a.id, p.id)).toBe(false);
});
