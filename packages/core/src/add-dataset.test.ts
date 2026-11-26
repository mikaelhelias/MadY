/**
 * Adding a column to a table with sub-columns adds a whole new group.
 *
 * With replicates, adding a column to the datasheet must add a whole new group or treatment
 * with the same number of replicates as the others.
 *
 * Guards against the rail's "Add column" (and the header menu's Insert left/right) appending one
 * bare column on a column-format table with replicates — which `tableDatasets` would read as its
 * own single-replicate group (n = 1 next to groups with n = 3, say), and likewise on every
 * summary format (Mean+SD+N gaining a lone "mean").
 *
 * The rule: a new column mirrors the last dataset's shape — the same replicate count, the
 * same summary sub-columns (SD/N/…), named after the new group. A plain one-column-per-dataset
 * table gains exactly one bare column.
 */
import { describe, expect, it } from "vitest";
import { MadyDocument } from "./document";
import { ENTRY_MODE_OPTIONS, KIND_COLUMNS, kindHasLeadColumn, nextColumnName, tableDatasets, tableEntryMode } from "./dataset";
import type { TableKind } from "./model";

const shape = (doc: MadyDocument, tableId: string) =>
  tableDatasets(doc.toJSON().tables.find((t) => t.id === tableId)!).map((d) => ({ name: d.name, reps: d.replicates.length, sd: !!d.sd, n: !!d.n }));

describe("adding a column to a grouped table", () => {
  it("replicates: Add column adds a group with the same replicate count", () => {
    const doc = new MadyDocument();
    const t = doc.addTable("T", "column", ["Labels", "Control", "Treated"]);
    doc.setReplicateCount(t.id, 3);
    expect(shape(doc, t.id)).toEqual([{ name: "Control", reps: 3, sd: false, n: false }, { name: "Treated", reps: 3, sd: false, n: false }]);

    doc.addColumn(t.id);
    const after = shape(doc, t.id);
    expect(after).toHaveLength(3);
    expect(after[2], "the new group must carry the table's replicate count, not 1").toEqual({ name: "Group 3", reps: 3, sd: false, n: false });
    // The sub-columns are named after the new group, like the existing ones.
    const cols = doc.toJSON().tables[0]!.columns;
    expect(cols.slice(-3).map((c) => c.name)).toEqual(["Group 3", "Group 3·2", "Group 3·3"]);
    expect(cols.slice(-3).map((c) => c.role)).toEqual(["y", "y", "y"]);
    // …and the table's format is unchanged.
    expect(tableEntryMode(doc.toJSON().tables[0]!)).toBe("replicates");
  });

  it("summary formats: Add column adds a group with the same sub-columns (mean · SD · N)", () => {
    const doc = new MadyDocument();
    const t = doc.addTable("T", "column", ["Labels", "Control", "Treated"]);
    doc.setEntryMode(t.id, "mean-sd-n");
    doc.addColumn(t.id);
    const after = shape(doc, t.id);
    expect(after[2]).toEqual({ name: "Group 3", reps: 1, sd: true, n: true });
    const cols = doc.toJSON().tables[0]!.columns;
    expect(cols.slice(-3).map((c) => `${c.name}:${c.role}`)).toEqual(["Group 3:y", "Group 3 SD:sd", "Group 3 N:n"]);
    expect(tableEntryMode(doc.toJSON().tables[0]!)).toBe("mean-sd-n");
  });

  it("insert left / right lands the whole group at a group boundary, never inside another group", () => {
    const doc = new MadyDocument();
    const t = doc.addTable("T", "column", ["Labels", "Control", "Treated"]);
    doc.setReplicateCount(t.id, 2);
    // Columns: Labels · Control · Control·2 · Treated · Treated·2 — insert "left of Treated·2"
    // (index 4, inside the Treated group) → the group goes after Treated, not between its reps.
    doc.insertColumn(t.id, 4);
    let cols = doc.toJSON().tables[0]!.columns.map((c) => c.name);
    expect(cols).toEqual(["Labels", "Control", "Control·2", "Treated", "Treated·2", "Group 3", "Group 3·2"]);
    // Insert left of Control (index 1) → before the Control group.
    doc.insertColumn(t.id, 1);
    cols = doc.toJSON().tables[0]!.columns.map((c) => c.name);
    expect(cols.slice(0, 3)).toEqual(["Labels", "Group 4", "Group 4·2"]);
    expect(shape(doc, t.id).map((d) => d.reps)).toEqual([2, 2, 2, 2]);
  });

  it("'insert left' of the label column puts the group after it, never before the lead", () => {
    const doc = new MadyDocument();
    const t = doc.addTable("T", "column", ["Labels", "Control", "Treated"]);
    doc.setReplicateCount(t.id, 2);
    doc.insertColumn(t.id, 0);
    const names = doc.toJSON().tables[0]!.columns.map((c) => c.name);
    expect(names[0]).toBe("Labels");
    expect(names.slice(1, 3)).toEqual(["Group 3", "Group 3·2"]);
  });

  it("undo removes the whole group in one step", () => {
    const doc = new MadyDocument();
    const t = doc.addTable("T", "column", ["Labels", "A", "B"]);
    doc.setReplicateCount(t.id, 3);
    const before = doc.toJSON().tables[0]!.columns.length;
    doc.addColumn(t.id);
    expect(doc.toJSON().tables[0]!.columns.length).toBe(before + 3);
    doc.commands.undo();
    expect(doc.toJSON().tables[0]!.columns.length).toBe(before);
  });

  it("a plain table (one column per dataset) gains exactly one bare column", () => {
    const doc = new MadyDocument();
    const t = doc.addTable("T", "xy", ["X", "Y1"]);
    doc.addColumn(t.id);
    const cols = doc.toJSON().tables[0]!.columns;
    expect(cols).toHaveLength(3);
    expect(cols[2]!.name).toBe("Y2");
    expect(cols[2]!.role).toBeUndefined();
    expect(cols[2]!.group).toBeUndefined();
  });

  /**
   * The matrix — every table kind × every entry shape, enumerated from the model (KIND_COLUMNS
   * and ENTRY_MODE_OPTIONS) so a new kind or format is enrolled as soon as it exists. Column
   * addition is checked for every datasheet type.
   * Each cell asserts the same three things: the new group has the same shape as its neighbours
   * (replicate count + every summary role), it is named by group ordinal with the format's
   * noun, and the table's entry format is unchanged.
   */
  const KINDS = Object.keys(KIND_COLUMNS) as TableKind[];
  const roles = (doc: MadyDocument, tableId: string) => {
    const t = doc.toJSON().tables.find((x) => x.id === tableId)!;
    return tableDatasets(t).map((d) => t.columns.filter((c) => (c.group ?? c.id) === d.id).map((c) => c.role ?? "y").join("+"));
  };
  for (const kind of KINDS) {
    const noun = KIND_COLUMNS[kind].data;
    const seed = kindHasLeadColumn(kind) ? ["Lead", "A", "B"] : ["A", "B"];

    it(`${kind}: plain → exactly one bare column, named "${noun}${kind === "xy" ? "3" : " 3"}"`, () => {
      const doc = new MadyDocument();
      const t = doc.addTable("T", kind, seed);
      const before = doc.toJSON().tables[0]!.columns.length;
      const col = doc.addColumn(t.id);
      expect(doc.toJSON().tables[0]!.columns.length).toBe(before + 1);
      expect(col.name).toBe(kind === "xy" ? `${noun}3` : `${noun} 3`);
      expect(roles(doc, t.id).at(-1)).toBe("y");
    });

    it(`${kind}: 3 replicates → a new 3-replicate group`, () => {
      const doc = new MadyDocument();
      const t = doc.addTable("T", kind, seed);
      doc.setReplicateCount(t.id, 3);
      const shapesBefore = roles(doc, t.id);
      expect(shapesBefore.every((s) => s === "y+y+y"), `fixture: ${kind} did not become 3-replicate (${shapesBefore})`).toBe(true);
      const col = doc.addColumn(t.id);
      const after = roles(doc, t.id);
      expect(after).toHaveLength(shapesBefore.length + 1);
      expect(after.at(-1), `${kind}: the new group's shape`).toBe("y+y+y");
      expect(col.name).toBe(kind === "xy" ? `${noun}3` : `${noun} 3`);
      expect(tableEntryMode(doc.toJSON().tables[0]!)).toBe("replicates");
      // …and the datasheet's replicate count is what it was.
      expect(new Set(tableDatasets(doc.toJSON().tables[0]!).map((d) => d.replicates.length))).toEqual(new Set([3]));
    });

    for (const { id: mode } of ENTRY_MODE_OPTIONS) {
      if (mode === "replicates") continue;
      it(`${kind} · ${mode}: a new group with the same sub-columns`, () => {
        const doc = new MadyDocument();
        const t = doc.addTable("T", kind, seed);
        doc.setEntryMode(t.id, mode);
        const shapesBefore = roles(doc, t.id);
        const template = shapesBefore.at(-1)!;
        expect(template.includes("+"), `fixture: ${kind}/${mode} made no sub-columns (${template})`).toBe(true);
        doc.addColumn(t.id);
        const after = roles(doc, t.id);
        expect(after).toHaveLength(shapesBefore.length + 1);
        expect(after.at(-1), `${kind}/${mode}: the new group's shape`).toBe(template);
        expect(tableEntryMode(doc.toJSON().tables[0]!), `${kind}/${mode}: the format changed`).toBe(mode);
        // The sub-columns are named after the new group.
        const cols = doc.toJSON().tables[0]!.columns;
        const lead = tableDatasets(doc.toJSON().tables[0]!).at(-1)!;
        const mine = cols.filter((c) => (c.group ?? c.id) === lead.id);
        for (const c of mine) expect(c.name.startsWith(lead.name), `${kind}/${mode}: "${c.name}" is not named after "${lead.name}"`).toBe(true);
      });
    }
  }

  it("the new group's name counts groups, not columns", () => {
    const doc = new MadyDocument();
    const t = doc.addTable("T", "column", ["Labels", "Control", "Treated"]);
    doc.setReplicateCount(t.id, 4);
    // 9 columns, 2 groups → the next group is "Group 3", not "Group 9".
    expect(nextColumnName(doc.toJSON().tables[0]!)).toBe("Group 3");
  });
});
