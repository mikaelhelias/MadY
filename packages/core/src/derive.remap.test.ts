import { describe, expect, it } from "vitest";
import { MadyDocument } from "./document";
import { remapDerivationColumns } from "./derive";
import type { TableDerivation } from "./model";

/**
 * A derived table must keep computing the column the user chose.
 *
 * Derivation specs address their source columns by numeric index, so they must be remapped
 * when the source's columns change shape. Without that, inserting a column ahead of the
 * referenced one silently re-points the transform:
 *
 *     before: ["X", "log(Y)"]          log10(100) = 2
 *     after:  ["Y2", "log(X)", "Y"]    log10(1)   = 0     ← same table name, different maths
 *
 * Everything downstream (graphs, analyses) would then show numbers for a column nobody selected.
 */
function docWithDerived(fn = "log10", columns = [1]) {
  const doc = new MadyDocument();
  const src = doc.addTable("Src", "xy", ["X", "Y"]);
  doc.insertRow(src.id, 0);
  const rowId = doc.toJSON().tables[0]!.rows[0]!.id;
  doc.setCell(src.id, rowId, src.columns[0]!.id, 1);
  doc.setCell(src.id, rowId, src.columns[1]!.id, 100);
  const derived = doc.deriveTable("D", { source: src.id, op: "transform", spec: { fn, columns } } as TableDerivation);
  /** Column names, plus the value under a named column. The passthrough columns legitimately
   *  change when the source gains/loses one — what must never change is the TRANSFORMED value. */
  const read = (): { cols: string[]; valueOf: (name: string) => unknown } => {
    const t = doc.toJSON().tables.find((x) => x.id === derived.id)!;
    return {
      cols: t.columns.map((c) => c.name),
      valueOf: (name: string) => {
        const col = t.columns.find((c) => c.name === name);
        return col ? (t.rows[0]?.cells[col.id] ?? null) : undefined;
      },
    };
  };
  return { doc, src, derived, read };
}

describe("derived tables survive a structural change to their source", () => {
  it("insertColumn does not re-point the transform", () => {
    const { doc, src, read } = docWithDerived();
    const before = read();
    expect(before.cols).toContain("log(Y)");

    doc.insertColumn(src.id, 0); // everything shifts right
    doc.recomputeStaleDerived();

    const after = read();
    expect(after.cols, "still the transform of Y, not of some other column").toContain("log(Y)");
    expect(after.valueOf("log(Y)"), "log10(100) = 2, unchanged").toBe(before.valueOf("log(Y)"));
  });

  it("moveColumn follows the column to its new position", () => {
    const { doc, src, read } = docWithDerived();
    const before = read();
    doc.moveColumn(src.id, 1, 0); // Y moves to the front
    doc.recomputeStaleDerived();
    const after = read();
    expect(after.cols).toContain("log(Y)");
    expect(after.valueOf("log(Y)")).toBe(before.valueOf("log(Y)"));
  });

  it("deleting an EARLIER column keeps the transform on the same data", () => {
    const { doc, src, read } = docWithDerived();
    const before = read();
    doc.deleteColumn(src.id, 0); // remove X; Y becomes index 0
    doc.recomputeStaleDerived();
    const after = read();
    expect(after.cols).toContain("log(Y)");
    expect(after.valueOf("log(Y)")).toBe(before.valueOf("log(Y)"));
  });

  it("undo restores the original derivation spec too", () => {
    const { doc, src, read } = docWithDerived();
    const before = read();
    doc.insertColumn(src.id, 0);
    doc.recomputeStaleDerived();
    doc.commands.undo();
    doc.recomputeStaleDerived();
    const after = read();
    expect(after.cols).toEqual(before.cols);
    expect(after.valueOf("log(Y)")).toBe(before.valueOf("log(Y)"));
  });

  it("a structural change with no derived tables still works (and stays undoable)", () => {
    const doc = new MadyDocument();
    const t = doc.addTable("T", "xy", ["X", "Y"]);
    doc.insertColumn(t.id, 0);
    expect(doc.toJSON().tables[0]!.columns).toHaveLength(3);
    doc.commands.undo();
    expect(doc.toJSON().tables[0]!.columns).toHaveLength(2);
  });
});

describe("remapDerivationColumns covers every op's index fields", () => {
  const shiftRight = (i: number): number => i + 1;
  const deleteOne = (i: number): number | null => (i === 1 ? null : i > 1 ? i - 1 : i);

  it("remaps a list, an optional scalar and a nested pair (transform)", () => {
    const d: TableDerivation = {
      source: "s", op: "transform",
      spec: { fn: "log10", columns: [0, 2], xColumn: 1, swapXY: { xCol: 0, yCol: 2 } },
    } as TableDerivation;
    const out = remapDerivationColumns(d, shiftRight) as Extract<TableDerivation, { op: "transform" }>;
    expect(out.spec.columns).toEqual([1, 3]);
    expect(out.spec.xColumn).toBe(2);
    expect(out.spec.swapXY).toEqual({ xCol: 1, yCol: 3 });
  });

  it("drops deleted entries from lists and OMITS a deleted optional scalar", () => {
    const d: TableDerivation = {
      source: "s", op: "transform", spec: { fn: "log10", columns: [0, 1, 2], xColumn: 1 },
    } as TableDerivation;
    const out = remapDerivationColumns(d, deleteOne) as Extract<TableDerivation, { op: "transform" }>;
    expect(out.spec.columns).toEqual([0, 1]); // index 1 gone, index 2 shifted down
    expect("xColumn" in out.spec, "a deleted optional column is omitted, not undefined").toBe(false);
  });

  it("a deleted REQUIRED scalar becomes -1 (an empty result, not a different column)", () => {
    const d: TableDerivation = { source: "s", op: "qq", spec: { col: 1, position: "blom" } } as TableDerivation;
    const out = remapDerivationColumns(d, deleteOne) as Extract<TableDerivation, { op: "qq" }>;
    expect(out.spec.col).toBe(-1);
  });

  it("leaves a simulation alone (its source is a sentinel)", () => {
    const d = { source: "", op: "simulate", spec: { kind: "normal", n: 10 } } as unknown as TableDerivation;
    expect(remapDerivationColumns(d, shiftRight)).toEqual(d);
  });
});
