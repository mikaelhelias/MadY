import { expect, it } from "vitest";
import { MadyDocument } from "./document";
import type { AnalysisResult } from "./model";
import { extractPicks } from "./persist";

const result: AnalysisResult = { method: "describe", title: "Mean", terms: [], glance: { mean: 2 }, summary: "Mean 2" };
function seed() {
  const doc = new MadyDocument();
  const table = doc.importTable("Data", "column", ["Y"], [[1], [2], [3]]);
  const analysis = doc.addAnalysis("Mean", "describe", table.id, { columns: [table.columns[0]!.id] });
  return { doc, table, analysis };
}

it("accepts only the latest request on unchanged inputs", () => {
  const { doc, analysis } = seed();
  const first = doc.beginAnalysisRun(analysis.id);
  const second = doc.beginAnalysisRun(analysis.id);
  expect(doc.completeAnalysisRun(first, { result })).toBe(false);
  expect(doc.completeAnalysisRun(second, { result })).toBe(true);
  expect(doc.completeAnalysisRun(second, { result })).toBe(false);
  expect(analysis.result).toEqual(result);
});

it("rejects a completion after input edits, including edit then undo", () => {
  const { doc, analysis, table } = seed();
  const run = doc.beginAnalysisRun(analysis.id);
  doc.setCell(table.id, table.rows[0]!.id, table.columns[0]!.id, 100);
  expect(doc.completeAnalysisRun(run, { result })).toBe(false);
  doc.commands.undo();
  expect(doc.completeAnalysisRun(run, { result })).toBe(false);
  expect(analysis.result).toBeUndefined();
});

it("rejects deleted analyses, changed parameters and tokens from another document", () => {
  const { doc, analysis } = seed();
  const run = doc.beginAnalysisRun(analysis.id);
  analysis.params.conf = 0.9;
  expect(doc.completeAnalysisRun(run, { result })).toBe(false);
  const next = doc.beginAnalysisRun(analysis.id);
  expect(new MadyDocument(doc.toJSON()).completeAnalysisRun(next, { result })).toBe(false);
  doc.removeAnalysis(analysis.id);
  expect(doc.completeAnalysisRun(next, { error: "old failure" })).toBe(false);
});

it("records a current engine error without accepting an older success", () => {
  const { doc, analysis } = seed();
  const old = doc.beginAnalysisRun(analysis.id);
  const current = doc.beginAnalysisRun(analysis.id);
  expect(doc.completeAnalysisRun(current, { error: "failed" })).toBe(true);
  expect(doc.completeAnalysisRun(old, { result })).toBe(false);
  expect(analysis.status).toBe("error");
});

it("a snapshot stays stale after rerun, across save/reload and style edits", () => {
  const { doc, analysis, table } = seed();
  doc.setAnalysisResult(analysis.id, result);
  const plot = doc.addPlot("Snapshot", table.id);
  doc.setPlotOptions(plot.id, { analysisSource: analysis.id });
  doc.refreshPlotStatus();
  expect(plot.status).toBe("ok");
  doc.setAnalysisResult(analysis.id, { ...result, summary: "New result" });
  doc.refreshPlotStatus();
  expect(plot.status).toBe("stale");
  doc.setPlotOptions(plot.id, { name: "Restyled" });
  const loaded = new MadyDocument(JSON.parse(JSON.stringify(doc.toJSON())));
  loaded.refreshPlotStatus();
  expect(loaded.toJSON().plots[0]!.status).toBe("stale");
});

it("bound fits remain stale until replaced by a fit from the new result", () => {
  const { doc, analysis, table } = seed();
  doc.setAnalysisResult(analysis.id, result);
  const plot = doc.addPlot("Fit", table.id);
  doc.setPlotFit(plot.id, { label: "Fit", points: [[1,2],[3,6]], analysisSource: analysis.id });
  doc.refreshPlotStatus();
  expect(plot.status).toBe("ok");
  doc.setCell(table.id, table.rows[0]!.id, table.columns[0]!.id, 100);
  doc.refreshPlotStatus();
  expect(plot.status).toBe("stale");
  doc.setAnalysisResult(analysis.id, { ...result, summary: "New fit" });
  doc.refreshPlotStatus();
  expect(plot.status).toBe("stale");
  doc.setPlotFit(plot.id, { label: "Fit", points: [[1,100],[3,6]], analysisSource: analysis.id });
  doc.refreshPlotStatus();
  expect(plot.status).toBe("ok");
  doc.commands.undo();
  doc.refreshPlotStatus();
  expect(plot.status).toBe("stale");
});

it("legacy unbound fits and ROC snapshots become stale after data edits", () => {
  const { doc, table } = seed();
  const plot = doc.addPlot("Legacy", table.id);
  doc.setPlotFit(plot.id, { label: "Old fit", points: [[1,2],[3,6]] });
  const roc = doc.addPlot("Legacy ROC", table.id);
  doc.setRoc(roc.id, [{ label: "ROC", auc: 1, points: [{ fpr: 0, tpr: 1 }] }]);
  doc.setCell(table.id, table.rows[0]!.id, table.columns[0]!.id, 100);
  doc.refreshPlotStatus();
  expect(plot.status).toBe("stale");
  expect(roc.status).toBe("stale");
});

it("saving a fitted graph carries its source analysis and result version", () => {
  const { doc, analysis, table } = seed();
  doc.setAnalysisResult(analysis.id, result);
  const plot = doc.addPlot("Fit", table.id);
  doc.setPlotFit(plot.id, { label: "Fit", points: [[1,2],[3,6]], analysisSource: analysis.id });
  const saved = extractPicks(doc.toJSON(), [{ level: "object", kind: "plot", id: plot.id }]);
  expect(saved.analyses.map(a => a.id)).toEqual([analysis.id]);
  const loaded = new MadyDocument(JSON.parse(JSON.stringify(saved)));
  loaded.refreshPlotStatus();
  expect(loaded.toJSON().plots[0]!.status).toBe("ok");
});

it("replacing one legacy overlay cannot clear another stale snapshot", () => {
  const { doc, table } = seed();
  const plot = doc.addPlot("Mixed legacy overlays", table.id);
  doc.setPlotFit(plot.id, { label: "First", points: [[1,2],[3,6]] });
  doc.setPlotFits(plot.id, [{ label: "Second", points: [[1,4],[3,12]] }]);
  doc.setCell(table.id, table.rows[0]!.id, table.columns[0]!.id, 100);
  doc.setPlotFit(plot.id, null);
  doc.refreshPlotStatus();
  expect(plot.status).toBe("stale");
});
