import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { MadyDocument } from "./document";
import { effectiveValue, isCellExcluded } from "./cells";
import type { DataTable } from "./model";

/**
 * Two ways the document could silently change a user's numbers.
 *
 * 1. `duplicateTable` must carry every field that makes the numbers right. A copy built from a
 *    hand-written `{id, kind, name, columns, rows}` would drop `excluded`, so every deliberately
 *    excluded outlier would re-enter every statistic computed on the copy, and drop `frozen`,
 *    making a read-only sheet editable.
 * 2. `deleteExperiment` / `deleteFolder` cascade to plots and analyses, and must also handle
 *    `derivation.source`: a derived table outside the deleted folder would otherwise be left
 *    pointing at a table that does not exist — never recomputing (recompute does nothing on a
 *    missing source) while `status: "ok"` claimed it was current.
 */

/** A sheet with an obvious outlier in the last row of "Y". */
function docWithOutlier() {
  const doc = new MadyDocument();
  const t = doc.addTable("Readings", "xy", ["X", "Y"]);
  doc.addRow(t.id, [1, 10]);
  doc.addRow(t.id, [2, 11]);
  doc.addRow(t.id, [3, 999]);
  return { doc, t };
}

/** Source table filed into a folder/experiment, plus a derived table left loose. */
function docWithDerived(level: "folder" | "experiment") {
  const doc = new MadyDocument();
  const src = doc.addTable("Source", "xy", ["X", "Y"]);
  doc.addRow(src.id, [1, 10]);
  doc.addRow(src.id, [2, 20]);
  const folder = doc.addFolder("Project 1");
  const exp = level === "experiment" ? doc.addExperiment(folder.id, "Experiment 1") : undefined;
  doc.fileObject(
    { kind: "table", id: src.id },
    exp ? { level: "experiment", folderId: folder.id, experimentId: exp.id } : { level: "folder", folderId: folder.id },
  );
  // `deriveTable` files to `loose`, so a derived sheet is never inside the experiment by
  // default — this is the ordinary case, not an edge case.
  const derived = doc.deriveTable("Derived", { source: src.id, op: "extract", spec: { columns: [0, 1] } });
  return { doc, src, derived, folderId: folder.id, expId: exp?.id };
}

describe("duplicating a dataset keeps what makes its numbers right", () => {
  it("carries the exclusions, re-keyed onto the copy's own row/column ids", () => {
    const { doc, t } = docWithOutlier();
    const rowId = t.rows[2]!.id;
    const colId = t.columns[1]!.id;
    doc.setCellsExcluded(t.id, [{ rowId, colId }], true);

    const copy = doc.duplicateTable(t.id);
    const copyRow = copy.rows[2]!;
    const copyCol = copy.columns[1]!;

    // Re-keyed, not copied verbatim: the copy's ids are its own.
    expect(copy.excluded).toBeDefined();
    expect(Object.keys(copy.excluded!)).toEqual([copyRow.id]);
    expect(copy.excluded![copyRow.id]).toEqual([copyCol.id]);
    expect(Object.keys(copy.excluded!)).not.toContain(rowId);
    // …and it actually takes effect where every analysis reads.
    expect(isCellExcluded(copy, copyRow.id, copyCol.id)).toBe(true);
    expect(effectiveValue(copy, copyRow, copyCol)).toBeNull();
  });

  it("the outlier stays out of a real computation off the copy", () => {
    const { doc, t } = docWithOutlier();
    doc.setCellsExcluded(t.id, [{ rowId: t.rows[2]!.id, colId: t.columns[1]!.id }], true);
    const copy = doc.duplicateTable(t.id);
    // `derive.ts` reads through `effectiveValue`, so a derived table stands in for
    // "every stat": 999 must not come back.
    const d = doc.deriveTable("d", { source: copy.id, op: "extract", spec: { columns: [0, 1] } });
    expect(d.rows[2]!.cells[d.columns[1]!.id]).toBeNull();
  });

  it("a read-only sheet duplicates read-only, and the sheet's own presentation follows", () => {
    const { doc, t } = docWithOutlier();
    doc.setTableFrozen(t.id, true);
    doc.setSheetColor("table", t.id, "#ff0000");
    doc.setSheetPinned("table", t.id, true);
    const copy = doc.duplicateTable(t.id);
    expect(copy.frozen).toBe(true);
    expect(copy.color).toBe("#ff0000");
    expect(copy.pinned).toBe(true);
  });

  it("the copy is independent: not derived, not a second live file link", () => {
    const { doc, src } = docWithDerived("experiment");
    const copyOfDerived = doc.duplicateTable(doc.toJSON().tables.find((x) => x.derivation)!.id);
    // Duplicating a derived sheet snapshots its values as a plain dataset — a copy that
    // recomputed from the source would immediately overwrite itself.
    expect(copyOfDerived.derivation).toBeUndefined();
    expect(copyOfDerived.status).toBeUndefined();
    expect(copyOfDerived.rows.length).toBe(doc.toJSON().tables.find((x) => x.id === src.id)!.rows.length);
    expect(copyOfDerived.linkedSource).toBeUndefined();
  });

  /**
   * Every field is carried by default.
   *
   * A hand-written keep-list goes stale as fields are added. `duplicateTable` spreads the
   * source, so a new `DataTable` field is carried automatically; this reads the field
   * names out of `model.ts` and fails if one is neither carried nor named below as a
   * deliberate omission. Adding a field to `DataTable` therefore forces a decision.
   */
  it("every DataTable field is either carried or a listed deliberate omission", () => {
    const model = readFileSync(fileURLToPath(new URL("./model.ts", import.meta.url)), "utf8");
    const block = model.slice(model.indexOf("export interface DataTable {"));
    const fields = [...block.slice(0, block.indexOf("\n}")).matchAll(/^\s{2}(\w+)\??:/gm)].map((m) => m[1]!);
    expect(fields).toContain("excluded"); // the reader found the interface

    // Fresh per copy (identity/structure), or deliberately independent.
    const OVERRIDDEN: Record<string, string> = {
      id: "a copy is a new object",
      name: "the copy is named “… copy”",
      columns: "fresh column ids",
      rows: "fresh row ids",
      excluded: "carried, re-keyed onto the fresh row/column ids",
      cellFills: "carried, re-keyed onto the fresh row/column ids (like excluded)",
      cellPatterns: "carried, re-keyed onto the fresh row/column ids (like cellFills)",
      derivation: "omitted — a copy is an independent snapshot, not a second live derivation",
      status: "omitted — meaningless without a derivation",
      linkedSource: "omitted — two sheets auto-updating from one file would fight over it",
      linkError: "omitted — belongs to linkedSource",
    };

    const doc = new MadyDocument();
    const t = doc.addTable("T", "xy", ["X", "Y"]);
    doc.addRow(t.id, [1, 2]);
    const src = t as unknown as Record<string, unknown>;

    // Note: set every field under test first. Checking a pristine table would pass
    // vacuously — with nothing set, nothing can be reported missing, and this test would
    // pass against the very code it exists to catch. Assigned directly rather
    // than through setters: the subject is the copy mechanism, not the setters.
    const probed = fields.filter((f) => !OVERRIDDEN[f]);
    for (const f of probed) src[f] = "__census__";

    const copy = doc.duplicateTable(t.id) as unknown as Record<string, unknown>;
    const dropped = probed.filter((f) => copy[f] !== "__census__");
    expect(
      dropped,
      `DataTable field(s) silently dropped by duplicateTable, and not listed as a deliberate omission: ${dropped.join(", ")}`,
    ).toEqual([]);

    // The census only means something if it read real fields and actually probed some.
    expect(fields.length).toBeGreaterThan(6);
    expect(probed.length).toBeGreaterThan(0);
  });

  it("a duplicated dataset carries cell colours, re-keyed onto the fresh ids", () => {
    const doc = new MadyDocument();
    const t = doc.importTable("T", "xy", ["X", "Y"], [[1, 2]]);
    doc.setCellsFill(t.id, [{ rowId: t.rows[0]!.id, colId: t.columns[1]!.id }], "#abc123");
    const copy = doc.duplicateTable(t.id);
    // the colour rode across onto the copy's own new ids…
    expect(copy.cellFills?.[copy.rows[0]!.id]?.[copy.columns[1]!.id]).toBe("#abc123");
    // …not the source's ids (carrying the map verbatim would look right but colour nothing)
    expect(copy.cellFills?.[t.rows[0]!.id]).toBeUndefined();
  });

  it("a duplicated dataset carries cell patterns, re-keyed onto the fresh ids", () => {
    const doc = new MadyDocument();
    const t = doc.importTable("T", "xy", ["X", "Y"], [[1, 2]]);
    doc.setCellsPattern(t.id, [{ rowId: t.rows[0]!.id, colId: t.columns[1]!.id }], { kind: "hatch", color: "#333" });
    const copy = doc.duplicateTable(t.id);
    expect(copy.cellPatterns?.[copy.rows[0]!.id]?.[copy.columns[1]!.id]).toEqual({ kind: "hatch", color: "#333" });
    expect(copy.cellPatterns?.[t.rows[0]!.id]).toBeUndefined();
  });
});

describe("deleting a folder cuts derived sheets loose instead of orphaning them", () => {
  for (const level of ["experiment", "folder"] as const) {
    it(`delete ${level}: the derived sheet survives, keeps its data, and stops claiming to be live`, () => {
      const { doc, src, derived, folderId, expId } = docWithDerived(level);
      const before = derived.rows[1]!.cells[derived.columns[1]!.id];

      if (level === "experiment") doc.deleteExperiment(folderId, expId!);
      else doc.deleteFolder(folderId);

      const p = doc.toJSON();
      const kept = p.tables.find((x) => x.id === derived.id);
      expect(p.tables.some((x) => x.id === src.id)).toBe(false); // source gone
      expect(kept).toBeDefined();                                 // dependent kept
      // No dangling source, and no "ok" on a sheet that can never recompute.
      expect(kept!.derivation).toBeUndefined();
      expect(kept!.status).toBeUndefined();
      // The data is preserved exactly as it stood.
      expect(kept!.rows[1]!.cells[kept!.columns[1]!.id]).toBe(before);
    });
  }

  it("undo restores the derivation, so cutting loose is not a one-way door", () => {
    const { doc, derived, folderId, expId } = docWithDerived("experiment");
    doc.deleteExperiment(folderId, expId!);
    expect(doc.toJSON().tables.find((x) => x.id === derived.id)!.derivation).toBeUndefined();
    doc.commands.undo();
    const back = doc.toJSON().tables.find((x) => x.id === derived.id)!;
    expect(back.derivation).toBeDefined();
    expect(back.derivation!.source).toBeDefined();
    // …and the source is present again, so the link is real rather than dangling.
    expect(doc.toJSON().tables.some((x) => x.id === back.derivation!.source)).toBe(true);
  });

  it("a derived sheet inside the deleted folder is still deleted, not cut loose", () => {
    const { doc, derived, folderId, expId } = docWithDerived("experiment");
    doc.fileObject({ kind: "table", id: derived.id }, { level: "experiment", folderId, experimentId: expId! });
    doc.deleteExperiment(folderId, expId!);
    expect(doc.toJSON().tables.some((x) => x.id === derived.id)).toBe(false);
  });

  it("a derived-of-derived chain keeps working — only direct dependents are cut loose", () => {
    const { doc, derived, folderId, expId } = docWithDerived("experiment");
    const second = doc.deriveTable("Second", { source: derived.id, op: "extract", spec: { columns: [0, 1] } });
    doc.deleteExperiment(folderId, expId!);
    const p = doc.toJSON();
    expect(p.tables.find((x) => x.id === derived.id)!.derivation).toBeUndefined(); // direct → cut loose
    const chained = p.tables.find((x) => x.id === second.id)!;
    expect(chained.derivation).toBeDefined();                                       // its source still exists
    expect(chained.derivation!.source).toBe(derived.id);
  });

  it("announces the cut-loose sheets up front, and records each one in the log", () => {
    const { doc, derived, folderId, expId } = docWithDerived("experiment");
    // The prompt asks the document what it is about to change, before deleting.
    const predicted = doc.orphansOfDeletingExperiment(folderId, expId!);
    expect(predicted.map((t) => t.id)).toEqual([derived.id]);

    doc.deleteExperiment(folderId, expId!);
    const entry = doc.toJSON().log.find((l) => l.label.includes("Derived"));
    expect(entry, "cutting a sheet loose must leave an audit-log entry").toBeDefined();
    expect(entry!.refId).toBe(derived.id);
  });

  it("predicts nothing when no derived sheet depends on the folder", () => {
    const doc = new MadyDocument();
    const t = doc.addTable("Plain", "xy", ["X"]);
    const folder = doc.addFolder("P");
    doc.fileObject({ kind: "table", id: t.id }, { level: "folder", folderId: folder.id });
    expect(doc.orphansOfDeletingFolder(folder.id)).toEqual([]);
  });
});
