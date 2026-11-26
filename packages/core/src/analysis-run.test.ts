/**
 * Analyses made by one run (a curve fit of several series, one fit each) are marked as one run, so their
 * results can be shown together; the mark is undoable and survives a save and a reopen.
 */
import { describe, expect, it } from "vitest";
import { MadyDocument } from "./document";
import { migrate } from "./migrations";

function seed() {
  const doc = new MadyDocument();
  const table = doc.importTable("Doses", "xy", ["Dose", "A", "B", "C"], [[1, 5, 4, 3], [10, 50, 20, 9], [100, 95, 80, 40]]);
  const [x, a, b, c] = table.columns.map((col) => col.id);
  const fits = [a, b, c].map((y, i) => doc.addAnalysis(`Fit ${i}`, "curvefit", table.id, { columns: [x!, y!] }));
  return { doc, fits };
}

describe("markAnalysisRun", () => {
  it("marks every analysis of the run with the first one's id, and returns it", () => {
    const { doc, fits } = seed();
    const run = doc.markAnalysisRun(fits.map((f) => f.id));
    expect(run).toBe(fits[0]!.id);
    expect(doc.toJSON().analyses.map((a) => a.run)).toEqual([run, run, run]);
  });

  it("is undone in one step", () => {
    const { doc, fits } = seed();
    doc.markAnalysisRun(fits.map((f) => f.id));
    doc.commands.undo();
    expect(doc.toJSON().analyses.every((a) => a.run === undefined && !("run" in a))).toBe(true);
  });

  it("refuses an id that does not exist instead of marking the rest", () => {
    const { doc, fits } = seed();
    expect(() => doc.markAnalysisRun([fits[0]!.id, "an_missing"])).toThrow(/not found/);
    expect(doc.toJSON().analyses.every((a) => a.run === undefined)).toBe(true);
  });

  it("survives a save and a reopen", () => {
    const { doc, fits } = seed();
    const run = doc.markAnalysisRun(fits.map((f) => f.id));
    const reopened = new MadyDocument(migrate(JSON.parse(JSON.stringify(doc.toJSON()))));
    expect(reopened.toJSON().analyses.map((a) => a.run)).toEqual([run, run, run]);
  });
});
