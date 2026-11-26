/**
 * Switching a table's format (the datasheet format badge → `setTableKind`) restructures the
 * sheet to match. Guards against switching a grouped bar's sheet to Column leaving
 * "Timepoint | Control | Treated" (+ replicate subcolumns) unchanged. A Column sheet is one
 * column per group — no leading label/X column, no replicate subcolumns — so the switch rebuilds
 * it from the datasets: the lead is eliminated and the subcolumns collapse in one step.
 */
import { describe, expect, it } from "vitest";
import { MadyDocument } from "./document";
import { tableFormat, validateTable } from "./tableFormats";
import { xColumn } from "./dataset";
import type { Project } from "./model";

const doc = () => new MadyDocument({ schemaVersion: 4, tables: [], plots: [], analyses: [], log: [], workspace: { folders: [], loose: [] } } as Project);
const tbl = (d: MadyDocument, id: string) => d.toJSON().tables.find((t) => t.id === id)!;

describe("setTableKind restructures the sheet to match the new format", () => {
  it("grouped → column removes the lead and leaves one column per group", () => {
    const d = doc();
    const g = d.addTable("G", "grouped", [...tableFormat("grouped").seedColumns]); // ["", "Control", "Treated"]
    d.setTableKind(g.id, "column");
    const t = tbl(d, g.id);
    expect(t.columns.map((c) => c.name)).toEqual(["Control", "Treated"]); // no lead column
    expect(t.columns.every((c) => c.role === "y")).toBe(true);
    expect(xColumn(t)).toBeUndefined();
  });

  it("grouped with replicate subcolumns + lead data → column drops both (one column per group)", () => {
    const d = new MadyDocument({
      schemaVersion: 4, analyses: [], plots: [], log: [], workspace: { folders: [], loose: [] },
      tables: [{
        id: "t", kind: "grouped", name: "T",
        columns: [
          { id: "x", name: "Timepoint" },
          { id: "c1", name: "Control" }, { id: "c2", name: "c2", group: "c1" }, { id: "c3", name: "c3", group: "c1" },
          { id: "t1", name: "Treated" }, { id: "t2", name: "t2", group: "t1" },
        ],
        rows: [{ id: "r0", cells: { x: "Day 1", c1: 20, c2: 22, c3: 19, t1: 30, t2: 33 } }],
      }],
    } as unknown as Project);
    d.setTableKind("t", "column");
    const t = tbl(d, "t");
    expect(t.columns.map((c) => c.name)).toEqual(["Control", "Treated"]); // Timepoint lead + c2/c3/t2 subcols gone
    expect(t.columns.every((c) => c.role === "y" && c.group == null)).toBe(true);
    expect(xColumn(t)).toBeUndefined();
    expect(t.rows[0]!.cells["c1"]).toBe(20); // each group's own values survive
    expect(t.rows[0]!.cells["t1"]).toBe(30);
  });

  it("switching to a NO-replicate format (contingency/survival/parts/multivariable) strips subcolumns", () => {
    const make = () => new MadyDocument({
      schemaVersion: 4, analyses: [], plots: [], log: [], workspace: { folders: [], loose: [] },
      tables: [{
        id: "t", kind: "grouped", name: "T",
        columns: [
          { id: "x", name: "Timepoint" },
          { id: "c1", name: "Control" }, { id: "c2", name: "c2", group: "c1" }, { id: "c3", name: "c3", group: "c1" },
          { id: "t1", name: "Treated" }, { id: "t2", name: "t2", group: "t1" },
        ],
        rows: [{ id: "r0", cells: { x: "Day 1", c1: 20, c2: 22, c3: 19, t1: 30, t2: 33 } }],
      }],
    } as unknown as Project);
    for (const k of ["contingency", "survival", "partsofwhole", "multivariable"] as const) {
      const d = make();
      d.setTableKind("t", k);
      const t = tbl(d, "t");
      expect(t.columns.filter((c) => c.group).length, `${k} must carry NO replicate subcolumns`).toBe(0);
    }
  });

  it("switching to a replicate format (xy/grouped/nested) keeps subcolumns", () => {
    const d = new MadyDocument({
      schemaVersion: 4, analyses: [], plots: [], log: [], workspace: { folders: [], loose: [] },
      tables: [{
        id: "t", kind: "grouped", name: "T",
        columns: [{ id: "x", name: "T" }, { id: "c1", name: "Control" }, { id: "c2", name: "c2", group: "c1" }, { id: "c3", name: "c3", group: "c1" }],
        rows: [{ id: "r0", cells: { x: "a", c1: 1, c2: 2, c3: 3 } }],
      }],
    } as unknown as Project);
    d.setTableKind("t", "nested");
    expect(tbl(d, "t").columns.filter((c) => c.group).length).toBe(2); // c2, c3 survive
  });

  it("column → grouped re-adds a leading label column", () => {
    const d = doc();
    const c = d.addTable("C", "column", [...tableFormat("column").seedColumns], tableFormat("column").seedRoles);
    d.setTableKind(c.id, "grouped");
    const t = tbl(d, c.id);
    expect(t.columns.length).toBe(3); // a lead inserted before Control/Treated
    expect(xColumn(t)).toBeDefined();
  });

  it("switching to a fixed-shape drawing format seeds its named columns (no 'needs these columns' warning)", () => {
    // Guards against a plain sheet switched to GWAS/alterations/meta/timeline via the format chip
    // staying "Control | Treated" and warning "needs Marker, Chromosome, Position and P-value". A
    // fixed-shape format's columns are positional inputs, so the switch configures the sheet to
    // that shape. A blank sheet adopts the seed outright.
    const expected = {
      association: ["Marker", "Chromosome", "Position", "P-value"],
      alterations: ["Sample", "Gene", "Alteration"],
      meta: ["Study", "Estimate", "Lower", "Upper"],
      timeline: ["Subject", "Start", "End", "Response start", "Response end", "Ongoing"],
      sets: ["Item", "Set A", "Set B", "Set C"],
      edgelist: ["Source", "Target", "Weight"],
    };
    for (const [kind, cols] of Object.entries(expected)) {
      const d = doc();
      const c = d.addTable("Sheet", "column", ["Control", "Treated"]); // a plain new datasheet
      d.setTableKind(c.id, kind as keyof typeof expected);
      expect(tbl(d, c.id).columns.map((x) => x.name), `${kind} was not reshaped to its seed`).toEqual(cols);
      expect(validateTable(tbl(d, c.id)), `${kind} still warns after the switch`).toEqual([]);
    }
  });

  it("switching a sheet with data to a fixed-shape format keeps the data and only appends the missing columns", () => {
    // Non-destructive: an XY sheet the user has filled must not lose its values on a switch to GWAS —
    // its columns stay, and the missing tail (Position, P-value) is appended so the shape is complete.
    const d = new MadyDocument({
      schemaVersion: 4, analyses: [], plots: [], log: [], workspace: { folders: [], loose: [] },
      tables: [{ id: "t", kind: "xy", name: "T", columns: [{ id: "x", name: "SNP", role: "x" }, { id: "y", name: "Chr", role: "y" }], rows: [{ id: "r0", cells: { x: "rs1", y: 7 } }] }],
    } as unknown as Project);
    d.setTableKind("t", "association");
    const t = tbl(d, "t");
    expect(t.columns.map((c) => c.name)).toEqual(["SNP", "Chr", "Position", "P-value"]); // kept SNP/Chr, appended the rest
    expect(t.rows[0]!.cells["x"]).toBe("rs1"); // data preserved
    expect(t.rows[0]!.cells["y"]).toBe(7);
    expect(validateTable(t)).toEqual([]);
  });

  it("is undoable — the original structure comes back", () => {
    const d = doc();
    const g = d.addTable("G", "grouped", [...tableFormat("grouped").seedColumns]);
    const before = JSON.stringify(tbl(d, g.id).columns);
    d.setTableKind(g.id, "column");
    d.commands.undo();
    expect(JSON.stringify(tbl(d, g.id).columns)).toEqual(before);
    expect(tbl(d, g.id).kind).toBe("grouped");
  });
});
