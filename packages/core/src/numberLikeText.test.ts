import { describe, expect, it } from "vitest";
import { numberLikeTextCells, numberLikeTextWarning } from "./numberLikeText";
import { validateTable } from "./tableFormats";
import type { DataTable } from "./model";

/** A kill-curve sheet: counts with a detection-limit token, a share-price volume written with
 *  commas, and a column of names that must never be reported. */
const sheet = (): DataTable => ({
  id: "t", kind: "xy", name: "T",
  columns: [
    { id: "h", name: "Hour" },
    { id: "cfu", name: "Antibiotic (CFU/mL)" },
    { id: "vol", name: "Volume" },
    { id: "id", name: "Sample" },
    { id: "note", name: "Note", type: "text" },
  ],
  rows: [
    { id: "r0", cells: { h: 0, cfu: 130000, vol: "1,160,799", id: "S1", note: "<10" } },
    { id: "r1", cells: { h: 6, cfu: "<10", vol: "1,048,963", id: "GENE001", note: "x" } },
    { id: "r2", cells: { h: 8, cfu: "<10", vol: "948,963", id: "12-15", note: "y" } },
    { id: "r3", cells: { h: 12, cfu: 0, vol: "1,334,706", id: "2025-01-02", note: "z" } },
  ],
}) as unknown as DataTable;

describe("numberLikeTextCells — number-looking text in number columns", () => {
  it("finds the detection-limit tokens and the comma-grouped numbers, nothing else", () => {
    const got = numberLikeTextCells(sheet());
    expect(got.map((g) => [g.columnName, g.count, g.examples])).toEqual([
      ["Antibiotic (CFU/mL)", 2, ["<10"]],
      ["Volume", 4, ["1,160,799", "1,048,963", "948,963"]],
    ]);
  });

  it("names (S1, GENE001, 12-15, a date) and a text-typed column are never reported", () => {
    const names = numberLikeTextCells(sheet()).map((g) => g.columnName);
    expect(names).not.toContain("Sample");
    expect(names).not.toContain("Note");
  });

  it("plain numbers stored as text (\"1\", \" 2.5 \") are read by graphs and analyses, so they are not reported", () => {
    const t = sheet();
    t.rows = ["1", " 2.5 ", "-3e2"].map((v, i) => ({ id: `q${i}`, cells: { cfu: v } })) as never;
    expect(numberLikeTextCells(t, ["cfu"])).toEqual([]);
  });

  it("an excluded cell is not reported", () => {
    const t = sheet();
    t.excluded = { r1: ["cfu"], r2: ["cfu"] };
    expect(numberLikeTextCells(t).map((g) => g.columnName)).toEqual(["Volume"]);
  });

  it("can be limited to the columns a graph or an analysis reads", () => {
    expect(numberLikeTextCells(sheet(), ["h", "cfu"]).map((g) => g.columnName)).toEqual(["Antibiotic (CFU/mL)"]);
  });

  it("other number-like writings: ≥ 5, 1 000, 1,5, 12 %", () => {
    const t = sheet();
    t.rows = ["≥ 5", "1 000", "1,5", "12 %", "abc"].map((v, i) => ({ id: `q${i}`, cells: { cfu: v } })) as never;
    expect(numberLikeTextCells(t, ["cfu"])[0]!.count).toBe(4);
  });

  it("the notice names the column, the count and what is written there", () => {
    const [e] = numberLikeTextCells(sheet(), ["cfu"]);
    expect(numberLikeTextWarning(e!)).toBe('"Antibiotic (CFU/mL)" has 2 cells written as text ("<10"), so graphs and analyses skip them. Enter them as a number, or exclude them.');
  });
});

describe("validateTable says when a number column holds text", () => {
  it("the sheet warning lists each such column", () => {
    const w = validateTable(sheet());
    expect(w.some((x) => x.startsWith('"Antibiotic (CFU/mL)" has 2 cells written as text'))).toBe(true);
    expect(w.some((x) => x.startsWith('"Volume" has 4 cells written as text'))).toBe(true);
  });
});
