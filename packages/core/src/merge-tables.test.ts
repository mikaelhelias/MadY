/**
 * Merging two datasheets (a one-time copy, not live). Expected results are written
 * out by hand below — the rows a reader would get by matching the two sheets on paper.
 */
import { describe, expect, it } from "vitest";
import { mergeTables, mergeReportText } from "./dataprocess";
import type { NamedTable } from "./reshape";

/** Sample · Dose. S2 appears twice in the lab sheet; S9 is only in the clinic sheet; S4 only in the lab sheet. */
const clinic: NamedTable = {
  columnNames: ["Sample", "Age", "Dose"],
  rows: [["S1", 40, 1], ["S2", 51, 2], ["S3", 38, 1], [" S9 ", 62, 3], ["", 70, 2]],
};
const lab: NamedTable = {
  columnNames: ["ID", "Dose", "CRP"],
  rows: [["S3", 10, 4.1], ["S1", 20, 2.2], ["S2", 30, 7.5], ["S2", 99, 9.9], ["S4", 40, 1.0]],
};

describe("mergeTables", () => {
  it("keep matched: only rows in both, first sheet's order; the second key column is dropped; a taken name is suffixed", () => {
    const { table, report } = mergeTables(clinic, lab, { keyFirst: 0, keySecond: 0, keep: "matched", secondName: "Lab" });
    expect(table.columnNames).toEqual(["Sample", "Age", "Dose", "Dose (Lab)", "CRP"]);
    expect(table.rows).toEqual([
      ["S1", 40, 1, 20, 2.2],
      ["S2", 51, 2, 30, 7.5], // the first S2 row of the lab sheet
      ["S3", 38, 1, 10, 4.1],
    ]);
    expect(report).toEqual({ matched: 3, unmatchedFirst: 1, unusedSecond: 1, duplicateSecond: ["S2"], blankFirst: 1 });
  });

  it("keep every row of the first sheet: unmatched rows stay, with blanks", () => {
    const { table } = mergeTables(clinic, lab, { keyFirst: 0, keySecond: 0, keep: "allFirst" });
    expect(table.rows).toEqual([
      ["S1", 40, 1, 20, 2.2],
      ["S2", 51, 2, 30, 7.5],
      ["S3", 38, 1, 10, 4.1],
      [" S9 ", 62, 3, null, null],
      ["", 70, 2, null, null],
    ]);
  });

  it("keys match as trimmed text: 7 and \"7\" and \" 7 \" are one key", () => {
    const a: NamedTable = { columnNames: ["k", "a"], rows: [[7, "x"], [" 8 ", "y"]] };
    const b: NamedTable = { columnNames: ["k", "b"], rows: [["7", 1], [8, 2]] };
    expect(mergeTables(a, b, { keyFirst: 0, keySecond: 0, keep: "matched" }).table.rows).toEqual([[7, "x", 1], [" 8 ", "y", 2]]);
  });

  it("the report in plain words names every loss", () => {
    const { report } = mergeTables(clinic, lab, { keyFirst: 0, keySecond: 0, keep: "matched" });
    expect(mergeReportText(report, "matched")).toBe(
      "3 rows matched · 1 row of the first sheet had no match (left out) · 1 row of the first sheet had a blank key (left out) · " +
        "1 key of the second sheet matched nothing (not in the result) · 1 key appears more than once in the second sheet — the first row was used (S2).",
    );
    expect(mergeReportText({ matched: 2, unmatchedFirst: 0, unusedSecond: 0, duplicateSecond: [], blankFirst: 0 }, "allFirst")).toBe("2 rows matched.");
  });
});
