/**
 * Fitting several series of one graph, one fit each: the run splits into one ordinary fit per
 * series, and on a graph of two or more series each fitted curve is drawn in the colour of the
 * series it fitted.
 */
import { describe, expect, it } from "vitest";
import { MadyDocument } from "@mady/core";
import type { AnalysisResult, NodeId } from "@mady/core";
import { buildPlotScene } from "@mady/graphics";
import { applyAnalysisFit } from "./analysisFits";
import { oneSpecPerCurve } from "./analyzeCurves";

const fitResult = (title: string, y: number[]): AnalysisResult =>
  ({ method: "curvefit", title, summary: "", glance: {}, terms: [], curve: { x: [1, 2, 3], y } }) as unknown as AnalysisResult;

function graph(columns: string[]) {
  const doc = new MadyDocument();
  const rows = [1, 2, 3].map((x) => [x, ...columns.slice(1).map((_, k) => x * (k + 2))]);
  const t = doc.importTable("XY", "xy", columns, rows);
  const plot = doc.addPlot("G", t.id);
  const ids = t.columns.map((c) => c.id);
  const fit = (y: NodeId, title: string, values: number[]) => {
    const a = doc.addAnalysis(title, "curvefit", t.id, { columns: [ids[0]!, y] });
    doc.setAnalysisResult(a.id, fitResult(title, values));
    expect(applyAnalysisFit(doc, a.id, plot.id)).toBe(true);
    return a;
  };
  const draw = () => buildPlotScene(doc.toJSON().tables[0]!, doc.toJSON().plots[0]!, { width: 620, height: 420 });
  return { doc, ids, fit, draw };
}

describe("one spec per ticked curve", () => {
  it("a curve fit of several series becomes one fit per series, the same X and settings in each", () => {
    const spec = { method: "curvefit", variant: "4pl", columns: ["x", "a", "b"], conf: 0.95, weighting: "1/Y2" };
    expect(oneSpecPerCurve(spec)).toEqual([
      { ...spec, columns: ["x", "a"] },
      { ...spec, columns: ["x", "b"] },
    ]);
  });

  it("a curve fit of one series, and every other method, pass through unchanged", () => {
    const one = { method: "curvefit", columns: ["x", "a"], conf: 0.95 };
    const global = { method: "globalfit", columns: ["a", "b", "c"], conf: 0.95 };
    expect(oneSpecPerCurve(one)).toEqual([one]);
    expect(oneSpecPerCurve(global)).toEqual([global]);
  });
});

describe("several fits on one graph", () => {
  it("each fitted curve is drawn in the colour of the series it fitted", () => {
    const { ids, fit, draw } = graph(["X", "A", "B"]);
    fit(ids[1]!, "Fit A", [2, 4, 6]);
    fit(ids[2]!, "Fit B", [3, 6, 9]);
    const scene = draw();
    const seriesColor = (name: string) => scene.series.find((s) => s.name === name)!.color;
    const fitColor = (label: string) => [scene.fit, ...(scene.fits ?? [])].find((f) => f?.label === label)!.color;
    expect(fitColor("Fit A")).toBe(seriesColor("A"));
    expect(fitColor("Fit B")).toBe(seriesColor("B"));
  });

  it("a column of names on the sheet takes no colour slot: each fit still wears its own series' colour", () => {
    const doc = new MadyDocument();
    const t = doc.importTable("XY", "xy", ["X", "Note", "A", "B"], [[1, "w1", 2, 3], [2, "w2", 4, 6], [3, "w3", 6, 9]]);
    const plot = doc.addPlot("G", t.id);
    const [x, , a, b] = t.columns.map((c) => c.id);
    for (const [y, title, v] of [[a!, "Fit A", [2, 4, 6]], [b!, "Fit B", [3, 6, 9]]] as const) {
      const an = doc.addAnalysis(title, "curvefit", t.id, { columns: [x!, y] });
      doc.setAnalysisResult(an.id, fitResult(title, [...v]));
      applyAnalysisFit(doc, an.id, plot.id);
    }
    const scene = buildPlotScene(doc.toJSON().tables[0]!, doc.toJSON().plots[0]!, { width: 620, height: 420 });
    expect(scene.series.map((s) => s.name), "the graph draws A and B, not the note").toEqual(["A", "B"]);
    const fitColor = (label: string) => [scene.fit, ...(scene.fits ?? [])].find((f) => f?.label === label)!.color;
    expect(fitColor("Fit A")).toBe(scene.series[0]!.color);
    expect(fitColor("Fit B")).toBe(scene.series[1]!.color);
  });

  it("each fit names the series it fitted, so the graph can draw it on that series' axis", () => {
    const { doc, ids, fit } = graph(["X", "A", "B"]);
    fit(ids[1]!, "Fit A", [2, 4, 6]);
    fit(ids[2]!, "Fit B", [3, 6, 9]);
    const p = doc.toJSON().plots[0]!;
    expect([p.fit, ...(p.fits ?? [])].map((f) => f?.series)).toEqual([ids[1], ids[2]]);
  });

  it("the series' own colour, when the user set one, is the colour its fit takes", () => {
    const { doc, ids, fit, draw } = graph(["X", "A", "B"]);
    doc.setSeriesStyle(doc.toJSON().plots[0]!.id, ids[2]!, { color: "#123456" });
    fit(ids[2]!, "Fit B", [3, 6, 9]);
    expect(draw().fit?.color).toBe("#123456");
  });

  it("a graph of one series keeps the fit in its own contrasting colour, as before", () => {
    const { doc, ids, fit } = graph(["X", "A"]);
    fit(ids[1]!, "Fit A", [2, 4, 6]);
    expect(doc.toJSON().plots[0]!.fit?.color).toBeUndefined();
  });
});
