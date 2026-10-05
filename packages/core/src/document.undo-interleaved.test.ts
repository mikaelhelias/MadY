import { describe, expect, it } from "vitest";
import { MadyDocument } from "./document";

/**
 * Undo keeps working across interleaved commands.
 *
 * Commands close over the live objects they edit — `setCell` captures the `row`. If a
 * snapshot/restore command (`insertRow`, `removeTable`, `deleteExperiment`, …) rebuilt the arrays
 * out of fresh JSON clones, it would detach every earlier command's closure: its `undo()` would
 * mutate a dead object and the visible document would silently not change. So a plain
 *
 *     edit a cell → insert a row → Ctrl+Z → Ctrl+Z
 *
 * would leave the cell at the wrong value. A test that drives one command in isolation cannot
 * see this; the interleaved case is what real editing looks like.
 *
 * These tests interleave a reference-capturing command with a snapshot/restore one, in both
 * orders, and walk the stack all the way back.
 */
function docWithRow() {
  const doc = new MadyDocument();
  const table = doc.addTable("T", "xy", ["X", "Y"]);
  doc.insertRow(table.id, 0);
  const rowId = doc.toJSON().tables[0]!.rows[0]!.id;
  const colId = table.columns[1]!.id;
  const cell = (): unknown => {
    const t = doc.toJSON().tables.find((x) => x.id === table.id)!;
    return t.rows.find((r) => r.id === rowId)?.cells[colId] ?? null;
  };
  return { doc, table, rowId, colId, cell };
}

describe("undo across a snapshot/restore command", () => {
  it("setCell → insertRow → undo → undo restores the original cell", () => {
    const { doc, table, rowId, colId, cell } = docWithRow();
    doc.setCell(table.id, rowId, colId, 10);
    doc.setCell(table.id, rowId, colId, 99);
    expect(cell()).toBe(99);

    doc.insertRow(table.id, 1); // snapshot/restore command
    doc.commands.undo(); // undo insertRow
    expect(cell()).toBe(99);
    doc.commands.undo(); // undo setCell(99)
    expect(cell(), "the cell edit before the insert must still undo").toBe(10);
    doc.commands.undo(); // undo setCell(10)
    expect(cell()).toBe(null);
  });

  it("setCell → removeTable(another) → undo → undo restores the original cell", () => {
    const { doc, table, rowId, colId, cell } = docWithRow();
    const other = doc.addTable("Other", "xy", ["A", "B"]);
    doc.setCell(table.id, rowId, colId, 10);
    doc.setCell(table.id, rowId, colId, 99);

    doc.removeTable(other.id); // project-level snapshot/restore (cascade delete)
    doc.commands.undo(); // undo removeTable
    expect(doc.toJSON().tables.some((t) => t.id === other.id), "the deleted table comes back").toBe(true);
    doc.commands.undo(); // undo setCell(99)
    expect(cell(), "the cell edit before the delete must still undo").toBe(10);
  });

  it("survives repeated interleaving, and redo agrees with undo", () => {
    const { doc, table, rowId, colId, cell } = docWithRow();
    doc.setCell(table.id, rowId, colId, 1);
    doc.insertRow(table.id, 1);
    doc.setCell(table.id, rowId, colId, 2);
    doc.insertRow(table.id, 2);
    doc.setCell(table.id, rowId, colId, 3);
    expect(cell()).toBe(3);

    doc.commands.undo(); // setCell(3)
    expect(cell()).toBe(2);
    doc.commands.undo(); // insertRow
    doc.commands.undo(); // setCell(2)
    expect(cell()).toBe(1);

    doc.commands.redo(); // setCell(2)
    expect(cell()).toBe(2);
    doc.commands.redo(); // insertRow
    doc.commands.redo(); // setCell(3)
    expect(cell()).toBe(3);
  });

  it("the row object a command captured stays the live one after a restore", () => {
    // The mechanism itself: identity must survive, or every closure above is detached.
    const { doc, table, rowId } = docWithRow();
    const before = doc.toJSON().tables[0]!.rows.find((r) => r.id === rowId);
    doc.insertRow(table.id, 1);
    doc.commands.undo();
    const after = doc.toJSON().tables[0]!.rows.find((r) => r.id === rowId);
    expect(after).toBe(before);
  });

  it("a genuinely new row is still created fresh (identity reuse is by id only)", () => {
    const { doc, table } = docWithRow();
    doc.insertRow(table.id, 1);
    const ids = doc.toJSON().tables[0]!.rows.map((r) => r.id);
    expect(new Set(ids).size, "no duplicate row ids").toBe(ids.length);
    expect(ids).toHaveLength(2);
  });
});
