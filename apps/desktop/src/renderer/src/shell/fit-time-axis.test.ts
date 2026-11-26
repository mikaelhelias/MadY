/**
 * A fit on a time-typed X: on a date X the curve (fitted on days since the first date) is drawn back onto the dates,
 * and the fitted times print as times — a half-life in days, a midpoint as its date; on an elapsed-time X (seconds)
 * as h:mm:ss, like the axis.
 */
import { describe, expect, it } from "vitest";
import { MadyDocument } from "@mady/core";
import type { Plot } from "@mady/core";
import { applyAnalysisFit } from "./analysisFits";
import { fitParamRows } from "./fitParams";

function fitted(type: "date" | "elapsed", xs: number[], curveX: number[], terms: { term: string; estimate: number; se?: number }[]) {
  const doc = new MadyDocument();
  const t = doc.importTable("T", "xy", ["Time", "A", "B"], xs.map((x, i) => [x, 100 - i * 10, 90 - i * 8]));
  doc.setColumnType(t.id, t.columns[0]!.id, type);
  const p = doc.addPlot("G", t.id);
  const a = doc.addAnalysis("Fit A", "curvefit", t.id, { columns: [t.columns[0]!.id, t.columns[1]!.id], variant: "exp_decay" });
  doc.setAnalysisResult(a.id, { method: "curvefit", title: "Fit", summary: "", glance: {}, terms, curve: { x: curveX, y: curveX.map((x) => 100 - x) } } as never);
  expect(applyAnalysisFit(doc, a.id, p.id)).toBe(true);
  return doc.toJSON().plots.find((q) => q.id === p.id) as Plot;
}

describe("a fit on a time-typed X", () => {
  it("a date X: the curve goes back onto the dates; a half-life in days, a midpoint as its date", () => {
    const plot = fitted("date", [19000, 19007, 19014, 19030], [0, 10, 20, 30], [
      { term: "Half-life", estimate: 69.3, se: 2.1 }, { term: "Midpoint", estimate: 14 }, { term: "K", estimate: 0.01 },
    ]);
    const fit = plot.fit ?? plot.fits![0]!;
    expect(fit.points.map((q) => q[0])).toEqual([19000, 19010, 19020, 19030]);
    expect(fit.params).toEqual(["Half-life = 69.3 days ± 2.1 days", "Midpoint = 2022-01-22", "K = 0.01"]);
  });

  it("an elapsed X: fitted times as h:mm:ss, the curve as fitted", () => {
    const plot = fitted("elapsed", [0, 3600, 7200, 10800], [0, 3600, 7200, 10800], [{ term: "Half-life", estimate: 8580, se: 120 }, { term: "Doubling time", estimate: 7180 }]);
    const fit = plot.fit ?? plot.fits![0]!;
    expect(fit.points.map((q) => q[0])).toEqual([0, 3600, 7200, 10800]);
    expect(fit.params).toEqual(["Half-life = 2:23:00 ± 0:02:00", "Doubling time = 1:59:40"]);
  });

  it("a number X: unchanged", () => {
    expect(fitParamRows([{ term: "Half-life", estimate: 2.31 } as never]).map((r) => r.text)).toEqual(["Half-life = 2.31"]);
  });
});
