/**
 * The results of one run of several fits, side by side: one column per series (any number), one row per
 * statistic, each column named and coloured as its series.
 */
import { describe, expect, it } from "vitest";
import { MadyDocument } from "@mady/core";
import type { AnalysisResult, Project } from "@mady/core";
import { runAnalyses, runComparison, runComparisonCsv, runComparisonGrid, runComparisonTsv, runTitle } from "./runResults";

const fitResult = (ec50: number, hill: number, extra = false): AnalysisResult => ({
  method: "curvefit", title: "Dose-response (4PL, variable slope)",
  terms: [
    { term: "Bottom", estimate: 3, se: 1.2 },
    { term: "Top", estimate: 97, se: 1.5 },
    { term: "Hill slope", estimate: hill, se: 0.1 },
    { term: "EC50", estimate: ec50 },
    { term: "R²", estimate: 0.99 },
    ...(extra ? [{ term: "Plateau", estimate: 1 }] : []),
  ],
  glance: {}, summary: "",
});

function seed(series = 3): { project: Project; run: string; ids: string[] } {
  const doc = new MadyDocument();
  const names = ["Compound A", "Compound B", "Compound C", "Compound D", "Compound E"].slice(0, series);
  const table = doc.importTable("Doses", "xy", ["Concentration (µM)", ...names], [[1, ...names.map(() => 5)], [10, ...names.map(() => 50)]]);
  const x = table.columns[0]!.id;
  const ids = names.map((n, i) => {
    const a = doc.addAnalysis(`Dose-response 4PL — ${n} vs Concentration (µM)`, "curvefit", table.id, { columns: [x, table.columns[i + 1]!.id] });
    doc.setAnalysisResult(a.id, fitResult(2.9 * (i + 1) ** 2, 1 + i / 10, i === series - 1));
    return a.id;
  });
  const run = doc.markAnalysisRun(ids);
  return { project: doc.toJSON(), run, ids };
}

describe("runComparison", () => {
  it("one column per series, in order, named after the series fitted — five series as well as two", () => {
    for (const n of [2, 5]) {
      const { project, run } = seed(n);
      const c = runComparison(project, run)!;
      expect(c.columns.map((col) => col.series)).toEqual(["Compound A", "Compound B", "Compound C", "Compound D", "Compound E"].slice(0, n));
      expect(c.rows.find((r) => r.term === "EC50")!.cells.map((t) => t?.estimate)).toEqual(Array.from({ length: n }, (_, i) => 2.9 * (i + 1) ** 2));
    }
  });

  it("a statistic only some series have gets a row, empty where a series has none", () => {
    const { project, run } = seed(3);
    const row = runComparison(project, run)!.rows.find((r) => r.term === "Plateau")!;
    expect(row.cells.map((t) => t?.estimate)).toEqual([undefined, undefined, 1]);
  });

  it("each column wears the colour its curve is drawn in, and its series colour otherwise", () => {
    const { project, run, ids } = seed(2);
    const plotted: Project = { ...project, plots: [{ id: "p", name: "P", source: project.tables[0]!.id, kind: "xy", status: "ok", styleOverrides: {},
      fits: [{ label: "B", points: [[1, 1], [2, 2]], analysisSource: ids[1]!, color: "#123456" }] }] };
    const cols = runComparison(plotted, run)!.columns;
    expect(cols[1]!.color).toBe("#123456");
    expect(cols[0]!.color).toMatch(/^#/);
    expect(cols[0]!.color).not.toBe(cols[1]!.color);
  });

  it("a column of names on the sheet takes no colour slot: the first series keeps the first colour", () => {
    const doc = new MadyDocument();
    const t = doc.importTable("Doses", "xy", ["Dose", "Note", "A", "B"], [[1, "w1", 5, 4], [10, "w2", 50, 20]]);
    const [x, , a, b] = t.columns.map((c) => c.id);
    const ids = [a, b].map((y) => doc.addAnalysis("Fit", "curvefit", t.id, { columns: [x!, y!] }).id);
    const run = doc.markAnalysisRun(ids);
    const plain = seed(2);
    const cols = runComparison(doc.toJSON(), run)!.columns;
    expect(cols.map((c) => c.color)).toEqual(runComparison(plain.project, plain.run)!.columns.map((c) => c.color));
  });

  it("an analysis not in the run is left out; an unknown run gives nothing", () => {
    const { project, run } = seed(2);
    const other = { ...project.analyses[0]!, id: "an_other", run: undefined };
    expect(runAnalyses({ analyses: [...project.analyses, other] }, run)).toHaveLength(2);
    expect(runComparison(project, "an_nothing")).toBeUndefined();
  });
});

describe("export and title", () => {
  it("the grid keeps numbers as numbers: per series its estimate, and its SE where it has one", () => {
    const { project, run } = seed(2);
    const grid = runComparisonGrid(runComparison(project, run)!);
    expect(grid.columns).toEqual(["Statistic", "Compound A", "Compound A SE", "Compound B", "Compound B SE"]);
    expect(grid.rows[0]).toEqual(["Bottom", 3, 1.2, 3, 1.2]);
    expect(grid.rows.find((r) => r[0] === "EC50")).toEqual(["EC50", 2.9, null, 11.6, null]);
  });

  it("CSV and clipboard text carry the title and the table", () => {
    const { project, run } = seed(2);
    const c = runComparison(project, run)!;
    expect(runComparisonCsv("Run", c).split("\r\n").slice(0, 3)).toEqual(["Run", "", "Statistic,Compound A,Compound A SE,Compound B,Compound B SE"]);
    expect(runComparisonTsv("Run", c).split("\n")[2]).toBe("Statistic\tCompound A\tCompound A SE\tCompound B\tCompound B SE");
  });

  it("the title counts the series", () => {
    const { project, run } = seed(3);
    expect(runTitle(project, run)).toBe("Dose-response 4PL — 3 series vs Concentration (µM)");
  });
});
