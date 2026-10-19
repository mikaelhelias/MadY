/**
 * Every test the Analyze dialog offers must reach the engine.
 *
 * The engine sees only the request `buildAnalysisData` builds from the analysis. If two choices
 * in the dialog's test list produce the same request, the engine cannot tell them apart, and the
 * second choice silently runs the first — for example "Friedman (nonparametric)" running the
 * parametric repeated-measures ANOVA when the request carries no variant.
 *
 * The check is structural, so it covers every method with a test list and any choice added later:
 * for each method, each offered variant must give a request different from every other variant's.
 */
import { describe, expect, it } from "vitest";
import { buildAnalysisData, type DataTable } from "@mady/core";
import { VARIANTS } from "./AnalyzeDialog";

// One sheet every listed method can read: four positive numeric columns, eight complete rows,
// a 0/1 outcome in the last column (ROC / logistic), no blanks.
const table = {
  id: "t", kind: "xy", name: "T",
  columns: [
    { id: "c0", name: "X", role: "x" },
    { id: "c1", name: "A", role: "y" },
    { id: "c2", name: "B", role: "y" },
    { id: "c3", name: "C", role: "y" },
  ],
  rows: [
    [1, 2.1, 3.5, 0], [2, 2.9, 4.1, 1], [3, 4.2, 3.9, 0], [4, 5.1, 6.2, 1],
    [5, 6.3, 5.5, 1], [6, 6.8, 7.9, 0], [7, 8.4, 7.1, 1], [8, 9.0, 9.6, 1],
  ].map((v, i) => ({ id: `r${i}`, cells: { c0: v[0], c1: v[1], c2: v[2], c3: v[3] } })),
} as unknown as DataTable;
const columns = ["c0", "c1", "c2", "c3"];

/** The request for one choice, or the error text when the sheet does not suit it. */
function request(method: string, variant: string): string {
  try {
    return JSON.stringify(buildAnalysisData(method, { columns, variant } as never, table));
  } catch (e) {
    return `THREW ${String(e)}`;
  }
}

describe("each test offered in the Analyze dialog is a different request to the engine", () => {
  const methods = Object.entries(VARIANTS).filter(([, vs]) => vs.length > 1);

  it("the sheet suits every method with a choice of test (otherwise this check would see nothing)", () => {
    const threw = methods.flatMap(([m, vs]) => vs.filter((v) => request(m, v.id).startsWith("THREW")).map((v) => `${m}/${v.id}`));
    expect(threw).toEqual([]);
  });

  it.each(methods.map(([m, vs]) => [m, vs.map((v) => v.id)] as const))("%s: no two choices send the same request", (m, ids) => {
    const seen = new Map<string, string>();
    const same: string[] = [];
    for (const id of ids) {
      const r = request(m, id);
      const prev = seen.get(r);
      if (prev) same.push(`"${id}" sends the same request as "${prev}"`);
      else seen.set(r, id);
    }
    expect(same).toEqual([]);
  });
});
