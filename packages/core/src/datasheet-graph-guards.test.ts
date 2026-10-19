/**
 * Datasheet ↔ graph — datasheet edits keep the graph's data: the X column, the X-error column and
 * grouped columns.
 */
import { describe, expect, it } from "vitest";
import { MadyDocument } from "./document";
import { tableDatasets, xColumn, xErrorColumn } from "./dataset";

const names = (doc: MadyDocument) => doc.toJSON().tables[0]!.columns.map((c) => c.name);

describe("'Use as X axis' re-tags the X (a bare move would change nothing on role-tagged sheets)", () => {
  it("on a replicate sheet: the chosen column becomes X, the old X becomes an ordinary Y dataset, order agrees with the header", () => {
    const doc = new MadyDocument();
    const t = doc.addTable("T", "xy", ["X", "Y1", "Y2"]);
    doc.setReplicateCount(t.id, 2); // stamps roles: X:x · Y1:y · Y1·2:y(group) · Y2:y · Y2·2:y(group)
    doc.addRow(t.id, [1, 11, 12, 21, 22]);
    const y2 = doc.toJSON().tables[0]!.columns[3]!;
    doc.setXColumn(t.id, 3);
    const tbl = doc.toJSON().tables[0]!;
    expect(xColumn(tbl)?.id, "the chosen column is now the X").toBe(y2.id);
    expect(tbl.columns[0]!.id, "…and it sits at index 0 (the grouped header draws X there)").toBe(y2.id);
    expect(tbl.columns[0]!.role).toBe("x");
    expect(tbl.columns[0]!.group).toBeUndefined();
    // The old X is data now, and Y2·2 (which lost its lead) is still a dataset — nothing vanished.
    const ds = tableDatasets(tbl).map((d) => d.name);
    expect(ds).toContain("X");
    expect(ds).toContain("Y1");
    expect(ds).toContain("Y2·2");
    // One Undo restores everything.
    doc.commands.undo();
    expect(names(doc)).toEqual(["X", "Y1", "Y1·2", "Y2", "Y2·2"]);
    expect(xColumn(doc.toJSON().tables[0]!)?.name).toBe("X");
  });

  it("on an X-tagged-only sheet the moved column does not vanish from the graph", () => {
    const doc = new MadyDocument();
    const t = doc.addTable("T", "xy", ["X", "A", "B"]);
    doc.setColumnRole(t.id, doc.toJSON().tables[0]!.columns[0]!.id, "x");
    doc.setXColumn(t.id, 2);
    const tbl = doc.toJSON().tables[0]!;
    expect(xColumn(tbl)?.name).toBe("B");
    expect(tableDatasets(tbl).map((d) => d.name).sort()).toEqual(["A", "X"]);
  });

  it("a plain sheet (no roles): the column moves to 0 and reads as X", () => {
    const doc = new MadyDocument();
    const t = doc.addTable("T", "xy", ["X", "A", "B"]);
    doc.setXColumn(t.id, 1);
    const tbl = doc.toJSON().tables[0]!;
    expect(names(doc)).toEqual(["A", "X", "B"]);
    expect(xColumn(tbl)?.name).toBe("A");
  });
});

describe("Replicates ± and the Entry dropdown keep the X-error column and its data", () => {
  const withXerr = () => {
    const doc = new MadyDocument();
    const t = doc.addTable("T", "xy", ["X", "Y1"]);
    doc.setXError(t.id, true);
    doc.addRow(t.id, [1, 5, 0.3]);
    const xe = xErrorColumn(doc.toJSON().tables[0]!);
    expect(xe, "fixture: no X-error column was created").toBeDefined();
    return { doc, t, xeId: xe!.id };
  };
  it("setReplicateCount", () => {
    const { doc, t, xeId } = withXerr();
    doc.setReplicateCount(t.id, 3);
    const tbl = doc.toJSON().tables[0]!;
    expect(xErrorColumn(tbl)?.id).toBe(xeId);
    expect(tbl.rows[0]!.cells[xeId], "the X-error value must survive").toBe(5); // addRow fills positionally: X · X error · Y1
  });
  it("setEntryMode", () => {
    const { doc, t, xeId } = withXerr();
    doc.setEntryMode(t.id, "mean-sd-n");
    expect(xErrorColumn(doc.toJSON().tables[0]!)?.id).toBe(xeId);
    doc.setEntryMode(t.id, "replicates");
    expect(xErrorColumn(doc.toJSON().tables[0]!)?.id).toBe(xeId);
  });
});

describe("typing into a spare column of a grouped sheet grows it by a whole group", () => {
  it("3-replicate sheet: the first spare column typed into becomes a 3-replicate group", () => {
    const doc = new MadyDocument();
    const t = doc.addTable("T", "column", ["Labels", "Control", "Treated"]);
    doc.setReplicateCount(t.id, 3); // 7 columns
    doc.editCellAt(t.id, 0, 7, 42);
    const tbl = doc.toJSON().tables[0]!;
    const last = tableDatasets(tbl).at(-1)!;
    expect(last.name).toBe("Group 3");
    expect(last.replicates).toHaveLength(3);
    // The typed value landed in the group's lead (column 7).
    expect(tbl.rows[0]!.cells[tbl.columns[7]!.id]).toBe(42);
  });
  it("plain sheet: still one bare column", () => {
    const doc = new MadyDocument();
    const t = doc.addTable("T", "xy", ["X", "Y1"]);
    doc.editCellAt(t.id, 0, 2, 7);
    expect(doc.toJSON().tables[0]!.columns).toHaveLength(3);
  });
});
