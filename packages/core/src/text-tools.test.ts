/**
 * Text-column tools: Data ▸ Split text column… (a live derived sheet) and Data ▸ Find & replace…
 * (an in-place edit, one undoable command). Expected results written out by hand.
 */
import { describe, expect, it } from "vitest";
import { replaceInCell, splitCounts, splitTextColumn, SPLIT_MAX_PARTS } from "./dataprocess";
import { MadyDocument } from "./document";
import type { NamedTable } from "./reshape";

const samples: NamedTable = {
  columnNames: ["Sample", "Value"],
  rows: [["Liver_Day7_3", 1.5], ["Heart_Day14", 2.5], ["Blood", 3], [null, 4]],
};

describe("splitTextColumn", () => {
  it("replaces the column by its parts, as many as the longest needs; numbers become numbers; no separator → whole in part 1", () => {
    expect(splitTextColumn(samples, { col: 0, sep: "_" })).toEqual({
      columnNames: ["Sample 1", "Sample 2", "Sample 3", "Value"],
      rows: [["Liver", "Day7", 3, 1.5], ["Heart", "Day14", null, 2.5], ["Blood", null, null, 3], [null, null, null, 4]],
    });
    expect(splitCounts(samples, { col: 0, sep: "_" })).toEqual({ split: 2, unsplit: 1, parts: 3 });
  });

  it("a middle column keeps its neighbours in place", () => {
    const t: NamedTable = { columnNames: ["A", "Tag", "B"], rows: [[1, "x-y", 2]] };
    expect(splitTextColumn(t, { col: 1, sep: "-" })).toEqual({ columnNames: ["A", "Tag 1", "Tag 2", "B"], rows: [[1, "x", "y", 2]] });
  });

  it("an empty separator or a missing column leaves the sheet as it is", () => {
    expect(splitTextColumn(samples, { col: 0, sep: "" })).toEqual(samples);
    expect(splitTextColumn(samples, { col: 9, sep: "_" })).toEqual(samples);
  });

  it(`never more than ${SPLIT_MAX_PARTS} parts — the rest stays joined in the last`, () => {
    const long = Array.from({ length: 25 }, (_, i) => `p${i}`).join(",");
    const out = splitTextColumn({ columnNames: ["S"], rows: [[long]] }, { col: 0, sep: "," });
    expect(out.columnNames).toHaveLength(SPLIT_MAX_PARTS);
    expect(out.rows[0]![SPLIT_MAX_PARTS - 1]).toBe(Array.from({ length: 6 }, (_, i) => `p${i + 19}`).join(","));
  });
});

describe("replaceInCell", () => {
  it("finds literally, anywhere, ignoring case by default", () => {
    expect(replaceInCell("WT_rep1 wt", { find: "wt", replace: "Control" })).toEqual({ value: "Control_rep1 Control", changed: true });
    expect(replaceInCell("WT_rep1", { find: "wt", replace: "C", matchCase: true })).toEqual({ value: "WT_rep1", changed: false });
    expect(replaceInCell("a.b", { find: ".", replace: "-" })).toEqual({ value: "a-b", changed: true }); // not a pattern
  });

  it("whole cell only: a cell that merely contains the text is left alone", () => {
    expect(replaceInCell(" NA ", { find: "na", replace: "", wholeCell: true })).toEqual({ value: null, changed: true });
    expect(replaceInCell("NAME", { find: "na", replace: "", wholeCell: true })).toEqual({ value: "NAME", changed: false });
  });

  it("a number stays a number when the result is one, else becomes the text asked for", () => {
    expect(replaceInCell(7, { find: "7", replace: "8" })).toEqual({ value: 8, changed: true });
    expect(replaceInCell(-99, { find: "-99", replace: "missing", wholeCell: true })).toEqual({ value: "missing", changed: true });
  });
});

describe("MadyDocument.replaceInTable", () => {
  function doc() {
    const d = new MadyDocument();
    const t = d.importTable("Sheet", "xy", ["Group", "Value"], [["WT", 1], ["wt", 2], ["KO", 3]]);
    return { d, t };
  }
  const cells = (d: MadyDocument, id: string) => {
    const t = d.toJSON().tables.find((x) => x.id === id)!;
    return t.rows.map((r) => t.columns.map((c) => r.cells[c.id]));
  };

  it("changes every match in one command, returns the count, and Ctrl+Z puts every cell back", () => {
    const { d, t } = doc();
    expect(d.replaceInTable(t.id, { find: "wt", replace: "Control", wholeCell: true })).toBe(2);
    expect(cells(d, t.id)).toEqual([["Control", 1], ["Control", 2], ["KO", 3]]);
    d.commands.undo();
    expect(cells(d, t.id)).toEqual([["WT", 1], ["wt", 2], ["KO", 3]]);
  });

  it("limited to chosen columns; no match → 0 and nothing to undo", () => {
    const { d, t } = doc();
    const before = d.commands.canUndo;
    expect(d.replaceInTable(t.id, { find: "1", replace: "9", columnIds: [t.columns[0]!.id] })).toBe(0);
    expect(d.commands.canUndo).toBe(before);
    expect(d.replaceInTable(t.id, { find: "1", replace: "9", columnIds: [t.columns[1]!.id] })).toBe(1);
    expect(cells(d, t.id)[0]).toEqual(["WT", 9]);
  });

  it("refuses, out loud, a sheet made from another and a frozen sheet", () => {
    const { d, t } = doc();
    const derived = d.deriveTable("Split", { source: t.id, op: "split", spec: { col: 0, sep: "_" } });
    expect(() => d.replaceInTable(derived.id, { find: "WT", replace: "C" })).toThrow(/made from another sheet/);
    d.setTableFrozen(t.id, true);
    expect(() => d.replaceInTable(t.id, { find: "WT", replace: "C" })).toThrow(/frozen/);
  });

  it("the split sheet is live: it follows its source", () => {
    const d = new MadyDocument();
    const t = d.importTable("Samples", "xy", ["Sample", "Value"], [["Liver_Day7", 1]]);
    const s = d.deriveTable("Split", { source: t.id, op: "split", spec: { col: 0, sep: "_" } });
    expect(s.columns.map((c) => c.name)).toEqual(["Sample 1", "Sample 2", "Value"]);
    d.replaceInTable(t.id, { find: "Liver", replace: "Heart" });
    d.recomputeStaleDerived();
    const now = d.toJSON().tables.find((x) => x.id === s.id)!;
    expect(now.rows[0]!.cells[now.columns[0]!.id]).toBe("Heart");
  });
});
