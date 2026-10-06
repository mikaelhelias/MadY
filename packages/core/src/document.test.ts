import { describe, expect, it } from "vitest";
import { MadyDocument } from "./document";
import { createSampleDocument } from "./sample";
import { applyKindHouseDefaults, findPreset } from "./presets";
import { tableDatasets, tableEntryMode } from "./dataset";
import { isCellExcluded } from "./cells";
import type { DataTable, Plot } from "./model";

describe("MadyDocument", () => {
  it("marks a dependent plot stale on a cell edit and clears it on recompute", () => {
    const doc = new MadyDocument();
    const table = doc.addTable("T", "xy", ["X", "Y"]);
    const row = doc.addRow(table.id, [1, 2]);
    const plot = doc.addPlot("P", table.id);
    doc.recompute();
    expect(doc.plotStatus(plot.id)).toBe("ok");

    const yColumn = table.columns[1]!;
    doc.setCell(table.id, row.id, yColumn.id, 99);
    expect(doc.plotStatus(plot.id)).toBe("stale");

    doc.recompute();
    expect(doc.plotStatus(plot.id)).toBe("ok");
  });

  it("computes the data→analysis→graph lineage DAG + the stale-downstream set", () => {
    const doc = new MadyDocument();
    const table = doc.addTable("Raw", "xy", ["X", "Y"]);
    const row = doc.addRow(table.id, [1, 2]);
    const graph = doc.addPlot("Graph", table.id);
    doc.recompute();
    const analysis = doc.addAnalysis("t test", "ttest", table.id, { columns: [table.columns[1]!.id] });
    // a spawned plot that records the analysis that produced it (e.g. a PCA score plot)
    const spawned = doc.addPlot("Scores", table.id);
    doc.setPlotOptions(spawned.id, { analysisSource: analysis.id });

    // Query helpers.
    expect(doc.analysesFor(table.id).map((a) => a.id)).toEqual([analysis.id]);
    expect(new Set(doc.plotsFor(table.id).map((p) => p.id))).toEqual(new Set([graph.id, spawned.id]));
    expect(doc.plotsForAnalysis(analysis.id).map((p) => p.id)).toEqual([spawned.id]); // precise via analysisSource

    // Lineage of the table = its whole family, with typed relation edges.
    const lin = doc.lineageOf({ id: table.id });
    const ids = new Set(lin.nodes.map((n) => n.id));
    expect(ids.has(table.id) && ids.has(graph.id) && ids.has(analysis.id) && ids.has(spawned.id)).toBe(true);
    expect(lin.edges).toContainEqual({ from: table.id, to: analysis.id, relation: "analyzes" });
    expect(lin.edges).toContainEqual({ from: table.id, to: graph.id, relation: "plots" });
    expect(lin.edges).toContainEqual({ from: analysis.id, to: spawned.id, relation: "spawns" });

    // Anchored on the spawned plot, the traversal still reaches the root table (ancestors).
    expect(new Set(doc.lineageOf({ id: spawned.id }).nodes.map((n) => n.id)).has(table.id)).toBe(true);

    // Whole-project lineage = every sheet as a node (for the lineage view).
    expect(new Set(doc.projectLineage().nodes.map((n) => n.id))).toEqual(new Set([table.id, graph.id, analysis.id, spawned.id]));

    // Editing the source marks the graph stale → staleDownstream(table) surfaces it.
    doc.setCell(table.id, row.id, table.columns[1]!.id, 99);
    expect(new Set(doc.staleDownstream({ id: table.id }).map((n) => n.id)).has(graph.id)).toBe(true);
  });

  it("colours and pins sheets (Navigator metadata) undoably", () => {
    const doc = new MadyDocument();
    const table = doc.addTable("T", "xy", ["X", "Y"]);
    const plot = doc.addPlot("G", table.id);
    const tbl = () => doc.toJSON().tables.find((t) => t.id === table.id)!;
    const grf = () => doc.toJSON().plots.find((p) => p.id === plot.id)!;

    doc.setSheetColor("plot", plot.id, "#3f8fd0");
    expect(grf().color).toBe("#3f8fd0");
    doc.commands.undo();
    expect(grf().color).toBeUndefined();

    doc.setSheetPinned("table", table.id, true);
    expect(tbl().pinned).toBe(true);
    doc.setSheetPinned("table", table.id, false); // unpin clears the flag (no lingering false)
    expect(tbl().pinned).toBeUndefined();
    doc.commands.undo();
    expect(tbl().pinned).toBe(true);
  });

  it("recomputes a calculated (formula) column reactively on a source-cell edit", () => {
    const doc = new MadyDocument();
    const table = doc.addTable("T", "xy", ["A", "B"]);
    const r0 = doc.addRow(table.id, [10, 2]);
    doc.addRow(table.id, [9, 3]);
    const col = doc.addFormulaColumn(table.id, "Ratio", "A/B");
    const cur = () => doc.toJSON().tables.find((t) => t.id === table.id)!;
    const ratio = () => cur().rows.map((r) => r.cells[col.id]);
    expect(ratio()).toEqual([5, 3]); // materialised now (10/2, 9/3)

    const bCol = cur().columns[1]!;
    doc.setCell(table.id, r0.id, bCol.id, 5);
    expect(ratio()).toEqual([2, 3]); // 10/5 recomputed reactively

    doc.commands.undo(); // restores the cell and the recomputed formula
    expect(ratio()).toEqual([5, 3]);
  });

  it("setColumnFormula makes a column calculated; clearing freezes the values", () => {
    const doc = new MadyDocument();
    const table = doc.addTable("T", "xy", ["A", "B", "C"]);
    doc.addRow(table.id, [3, 4, 0]);
    const cCol = table.columns[2]!;
    doc.setColumnFormula(table.id, cCol.id, "A+B");
    const cur = () => doc.toJSON().tables.find((t) => t.id === table.id)!;
    expect(cur().rows[0]!.cells[cCol.id]).toBe(7);

    doc.setColumnFormula(table.id, cCol.id, undefined); // clear → keep the computed value as data
    expect(cur().columns[2]!.formula).toBeUndefined();
    expect(cur().rows[0]!.cells[cCol.id]).toBe(7);
  });

  it("keeps a style override bound to its row across a reorder (override-survival)", () => {
    const doc = new MadyDocument();
    const table = doc.addTable("T", "xy", ["X", "Y"]);
    const r1 = doc.addRow(table.id, [1, 1]);
    const r2 = doc.addRow(table.id, [2, 2]);
    const r3 = doc.addRow(table.id, [3, 3]);
    const plot = doc.addPlot("P", table.id);

    doc.setRowOverride(plot.id, r2.id, { color: "#c1602f" });
    expect(doc.getRowOverride(plot.id, r2.id)).toEqual({ color: "#c1602f" });

    // Reorder rows: the override must still resolve to r2, not to a position.
    doc.reorderRows(table.id, [r3.id, r1.id, r2.id]);
    expect(doc.getRowOverride(plot.id, r2.id)).toEqual({ color: "#c1602f" });
    expect(doc.getRowOverride(plot.id, r1.id)).toBeUndefined();
  });

  it("supports real undo/redo of mutations", () => {
    const doc = new MadyDocument();
    doc.addTable("T", "column", ["A"]);
    expect(doc.toJSON().tables).toHaveLength(1);

    doc.commands.undo();
    expect(doc.toJSON().tables).toHaveLength(0);
    expect(doc.commands.canRedo).toBe(true);

    doc.commands.redo();
    expect(doc.toJSON().tables).toHaveLength(1);
  });

  it("setTableKind reinterprets the format (undoable, data untouched)", () => {
    const doc = new MadyDocument();
    const t = doc.importTable("Counts", "xy", ["A", "B"], [[1, 2], [3, 4]]);
    const kindOf = () => doc.toJSON().tables.find((x) => x.id === t.id)!.kind;
    doc.setTableKind(t.id, "contingency");
    expect(kindOf()).toBe("contingency");
    // data is preserved across a format change
    expect(doc.toJSON().tables.find((x) => x.id === t.id)!.rows).toHaveLength(2);
    doc.commands.undo();
    expect(kindOf()).toBe("xy");
    // changing to the same kind is a no-op (no spurious undo step)
    doc.setTableKind(t.id, "xy");
    expect(kindOf()).toBe("xy");
    expect(doc.commands.canRedo).toBe(true); // the redo is still the contingency change
  });

  describe("appendImportedRows (merge-on-import)", () => {
    // Read a table's rows as arrays aligned to its current column order.
    const rowsOf = (doc: MadyDocument, id: string) => {
      const t = doc.toJSON().tables.find((x) => x.id === id)!;
      return { columns: t.columns.map((c) => c.name), rows: t.rows.map((r) => t.columns.map((c) => r.cells[c.id] ?? null)) };
    };

    it("appends rows matched by name regardless of incoming column order", () => {
      const doc = new MadyDocument();
      const t = doc.importTable("T", "xy", ["Dose", "Resp"], [[1, 10], [2, 20]]);
      // incoming columns are in the opposite order — name-matching must realign them
      const n = doc.appendImportedRows(t.id, ["Resp", "Dose"], [[30, 3], [40, 4]], "name");
      expect(n).toBe(2);
      expect(rowsOf(doc, t.id)).toEqual({ columns: ["Dose", "Resp"], rows: [[1, 10], [2, 20], [3, 30], [4, 40]] });
    });

    it("appends by position when asked (ignores names)", () => {
      const doc = new MadyDocument();
      const t = doc.importTable("T", "xy", ["Dose", "Resp"], [[1, 10]]);
      doc.appendImportedRows(t.id, ["x", "y"], [[2, 20]], "position");
      expect(rowsOf(doc, t.id).rows).toEqual([[1, 10], [2, 20]]);
    });

    it("adds a column for an unmatched incoming name; existing rows read blank for it", () => {
      const doc = new MadyDocument();
      const t = doc.importTable("T", "xy", ["Dose", "Resp"], [[1, 10]]);
      doc.appendImportedRows(t.id, ["Dose", "Resp", "Batch"], [[2, 20, "B"]], "name");
      const out = rowsOf(doc, t.id);
      expect(out.columns).toEqual(["Dose", "Resp", "Batch"]);
      expect(out.rows).toEqual([[1, 10, null], [2, 20, "B"]]); // old row blank in the new column
    });

    it("preserves the target's column ids (a plot stays bound) and is one undo step", () => {
      const doc = new MadyDocument();
      const t = doc.importTable("T", "xy", ["Dose", "Resp"], [[1, 10]]);
      const colIds = doc.toJSON().tables.find((x) => x.id === t.id)!.columns.map((c) => c.id);
      doc.appendImportedRows(t.id, ["Dose", "Resp"], [[2, 20]], "name");
      expect(doc.toJSON().tables.find((x) => x.id === t.id)!.columns.map((c) => c.id)).toEqual(colIds); // ids unchanged
      doc.commands.undo();
      expect(rowsOf(doc, t.id).rows).toEqual([[1, 10]]); // one undo removes the whole append
    });
  });

  describe("setCellsFill (datasheet cell colours)", () => {
    const fillOf = (doc: MadyDocument, tableId: string, rowId: string, colId: string): string | undefined =>
      doc.toJSON().tables.find((t) => t.id === tableId)!.cellFills?.[rowId]?.[colId];

    it("sets a colour, clears it with null, and is one undo step", () => {
      const doc = new MadyDocument();
      const t = doc.importTable("T", "xy", ["X", "Y"], [[1, 2], [3, 4]]);
      const r0 = t.rows[0]!.id, cY = t.columns[1]!.id;
      doc.setCellsFill(t.id, [{ rowId: r0, colId: cY }], "#ffcc00");
      expect(fillOf(doc, t.id, r0, cY)).toBe("#ffcc00");
      doc.setCellsFill(t.id, [{ rowId: r0, colId: cY }], null);
      expect(fillOf(doc, t.id, r0, cY)).toBeUndefined();
      expect(doc.toJSON().tables.find((x) => x.id === t.id)!.cellFills).toBeUndefined(); // empty → dropped
      doc.commands.undo();
      expect(fillOf(doc, t.id, r0, cY)).toBe("#ffcc00"); // the clear was one undo
    });

    it("is purely visual — colouring a cell does not make a dependent graph stale", () => {
      const doc = new MadyDocument();
      const t = doc.importTable("T", "xy", ["X", "Y"], [[1, 2]]);
      const plot = doc.addPlot("P", t.id);
      doc.recompute();
      expect(doc.plotStatus(plot.id)).toBe("ok");
      doc.setCellsFill(t.id, [{ rowId: t.rows[0]!.id, colId: t.columns[1]!.id }], "#f00");
      expect(doc.plotStatus(plot.id), "a cell colour must not invalidate the graph").toBe("ok");
    });

    it("survives a sort — the fill follows its cell (keyed by id, not position)", () => {
      const doc = new MadyDocument();
      const t = doc.importTable("T", "xy", ["Dose", "Y"], [[2, 20], [1, 10]]);
      const bottomRow = t.rows[1]!.id, cY = t.columns[1]!.id; // the Dose=1 row (will move to top on asc sort)
      doc.setCellsFill(t.id, [{ rowId: bottomRow, colId: cY }], "#0f0");
      doc.sortRowsByColumn(t.id, t.columns[0]!.id, "asc");
      // the same row id is now at the top; its colour moved with it
      const after = doc.toJSON().tables.find((x) => x.id === t.id)!;
      expect(after.rows[0]!.id).toBe(bottomRow);
      expect(fillOf(doc, t.id, bottomRow, cY)).toBe("#0f0");
    });

    it("a Duplicate (adoptImportedTable) carries the fills onto the new ids", () => {
      const doc = new MadyDocument();
      const t = doc.importTable("T", "xy", ["X", "Y"], [[1, 2]]);
      doc.setCellsFill(t.id, [{ rowId: t.rows[0]!.id, colId: t.columns[1]!.id }], "#abcdef");
      const src = doc.toJSON().tables.find((x) => x.id === t.id)!;
      const copy = doc.adoptImportedTable(src, "T copy");
      // the copy's own (new) ids carry the colour; not the source's ids
      expect(copy.cellFills?.[copy.rows[0]!.id]?.[copy.columns[1]!.id]).toBe("#abcdef");
    });
  });

  describe("setCellsPattern (datasheet cell patterns)", () => {
    const patOf = (doc: MadyDocument, tableId: string, rowId: string, colId: string) =>
      doc.toJSON().tables.find((t) => t.id === tableId)!.cellPatterns?.[rowId]?.[colId];

    it("sets a pattern, clears it with null, and is one undo step", () => {
      const doc = new MadyDocument();
      const t = doc.importTable("T", "xy", ["X", "Y"], [[1, 2], [3, 4]]);
      const r0 = t.rows[0]!.id, cY = t.columns[1]!.id;
      doc.setCellsPattern(t.id, [{ rowId: r0, colId: cY }], { kind: "dots", color: "#a00" });
      expect(patOf(doc, t.id, r0, cY)).toEqual({ kind: "dots", color: "#a00" });
      doc.setCellsPattern(t.id, [{ rowId: r0, colId: cY }], null);
      expect(patOf(doc, t.id, r0, cY)).toBeUndefined();
      expect(doc.toJSON().tables.find((x) => x.id === t.id)!.cellPatterns).toBeUndefined(); // empty → dropped
      doc.commands.undo();
      expect(patOf(doc, t.id, r0, cY)).toEqual({ kind: "dots", color: "#a00" }); // the clear was one undo
    });

    it("is purely visual — patterning a cell does not make a dependent graph stale", () => {
      const doc = new MadyDocument();
      const t = doc.importTable("T", "xy", ["X", "Y"], [[1, 2]]);
      const plot = doc.addPlot("P", t.id);
      doc.recompute();
      expect(doc.plotStatus(plot.id)).toBe("ok");
      doc.setCellsPattern(t.id, [{ rowId: t.rows[0]!.id, colId: t.columns[1]!.id }], { kind: "grid", color: "#333" });
      expect(doc.plotStatus(plot.id), "a cell pattern must not invalidate the graph").toBe("ok");
    });

    it("survives a sort — the pattern follows its cell (keyed by id, not position)", () => {
      const doc = new MadyDocument();
      const t = doc.importTable("T", "xy", ["Dose", "Y"], [[2, 20], [1, 10]]);
      const bottomRow = t.rows[1]!.id, cY = t.columns[1]!.id;
      doc.setCellsPattern(t.id, [{ rowId: bottomRow, colId: cY }], { kind: "hatch", color: "#0a0" });
      doc.sortRowsByColumn(t.id, t.columns[0]!.id, "asc");
      const after = doc.toJSON().tables.find((x) => x.id === t.id)!;
      expect(after.rows[0]!.id).toBe(bottomRow);
      expect(patOf(doc, t.id, bottomRow, cY)).toEqual({ kind: "hatch", color: "#0a0" });
    });
  });

  it("deleteColumns removes several columns atomically (one undo) + cascades stale", () => {
    const doc = new MadyDocument();
    const t = doc.importTable("T", "grouped", ["X", "A1", "A2", "B"], [[1, 2, 3, 4], [5, 6, 7, 8]]);
    const plot = doc.addPlot("G", t.id);
    doc.recompute();
    const cols = () => doc.toJSON().tables.find((x) => x.id === t.id)!.columns.map((c) => c.name);
    // delete the "A" dataset (cols 1 and 2) in one step
    doc.deleteColumns(t.id, [1, 2]);
    expect(cols()).toEqual(["X", "B"]);
    // its cells are gone from every row
    expect(doc.toJSON().tables.find((x) => x.id === t.id)!.rows.every((r) => Object.keys(r.cells).length === 2)).toBe(true);
    // the graph went stale (data changed)
    expect(doc.toJSON().plots.find((p) => p.id === plot.id)!.status).toBe("stale");
    // single undo restores all of them
    doc.commands.undo();
    expect(cols()).toEqual(["X", "A1", "A2", "B"]);
  });

  it("duplicateAnnotation clones with a fresh id + offset, on top, undoable", () => {
    const doc = new MadyDocument();
    const t = doc.importTable("T", "xy", ["X", "Y"], [[1, 2]]);
    const plot = doc.addPlot("G", t.id);
    const src = doc.addAnnotation(plot.id, { kind: "text", label: "hi", x: 0.4, y: 0.5 });
    const copy = doc.duplicateAnnotation(plot.id, src.id)!;
    expect(copy.id).not.toBe(src.id);
    expect(copy.label).toBe("hi");
    expect(copy.x).toBeCloseTo(0.43, 6); // offset so it doesn't hide the original
    expect(copy.y).toBeCloseTo(0.53, 6);
    const anns = () => doc.toJSON().plots.find((p) => p.id === plot.id)!.annotations ?? [];
    expect(anns()).toHaveLength(2);
    expect(anns()[anns().length - 1]!.id).toBe(copy.id); // on top (front)
    doc.commands.undo();
    expect(anns()).toHaveLength(1);
  });

  it("renaming a synthesized (non-persisted) label persists a text override; delete still no-ops", () => {
    const doc = new MadyDocument();
    const t = doc.importTable("T", "xy", ["X", "Y"], [[1, 2]]);
    const plot = doc.addPlot("G", t.id);
    const grf = () => doc.toJSON().plots.find((p) => p.id === plot.id)!;
    doc.addAnnotation(plot.id, { kind: "text", label: "real", x: 0.4, y: 0.5 });
    // A builder-synthesized label id (pyramid value / PCA loading) is absent from
    // plot.annotations → a rename is persisted as a presentation text override instead.
    doc.updateAnnotation(plot.id, "pyr-val-ds-r0", { label: "12.5%" });
    expect(grf().pyramid?.valueLabelText?.["ds-r0"]).toBe("12.5%");
    doc.updateAnnotation(plot.id, "pca-vlabel-2", { label: "Height" });
    expect(grf().pcaStyle?.varLabelText?.["2"]).toBe("Height");
    // Blank restores the data-derived default (the override is dropped).
    doc.updateAnnotation(plot.id, "pca-vlabel-2", { label: "  " });
    expect(grf().pcaStyle?.varLabelText).toBeUndefined();
    // Undoable, creates no real annotation, and Delete of a synth id stays a no-op.
    doc.commands.undo();
    expect(grf().pcaStyle?.varLabelText?.["2"]).toBe("Height");
    expect(() => doc.removeAnnotation(plot.id, "pca-vlabel-2")).not.toThrow();
    const anns = grf().annotations ?? [];
    expect(anns).toHaveLength(1); // the real annotation is untouched
    expect(anns[0]!.label).toBe("real");
  });

  it("recolouring a synthesized PCA loading vector (via its arrow or its label) persists a per-vector colour", () => {
    const doc = new MadyDocument();
    const t = doc.importTable("T", "xy", ["X", "Y"], [[1, 2]]);
    const plot = doc.addPlot("G", t.id);
    const grf = () => doc.toJSON().plots.find((p) => p.id === plot.id)!;
    // Selecting the arrow and picking a colour → keyed by the variable index.
    doc.updateAnnotation(plot.id, "pca-arrow-1", { color: "#ff0055" });
    expect(grf().pcaStyle?.arrowColors?.["1"]).toBe("#ff0055");
    /**
     * Note: the label and the arrow of a loading vector have separate colours. Selecting the
     * label writes `varLabelColors`, its own map, so the variable name can be coloured
     * differently from its arrow.
     *
     * The rest is asserted below: the colour persists from either id, vectors stay independent
     * of each other, reset drops just that entry, an emptied map disappears, it is undoable,
     * and it never mints a real annotation. The builder falls back label → arrow, so an
     * untouched chart draws both in the arrow's colour.
     */
    doc.updateAnnotation(plot.id, "pca-vlabel-1", { color: "#00aa88" });
    expect(grf().pcaStyle?.varLabelColors?.["1"]).toBe("#00aa88");
    expect(grf().pcaStyle?.arrowColors?.["1"], "the label's colour overwrote its arrow's").toBe("#ff0055");
    // A different vector is independent.
    doc.updateAnnotation(plot.id, "pca-arrow-0", { color: "#123456" });
    expect(grf().pcaStyle?.arrowColors).toEqual({ "0": "#123456", "1": "#ff0055" });
    // Reset (undefined) drops just that override; emptying the map drops it entirely.
    doc.updateAnnotation(plot.id, "pca-arrow-1", { color: undefined });
    expect(grf().pcaStyle?.arrowColors).toEqual({ "0": "#123456" });
    doc.updateAnnotation(plot.id, "pca-arrow-0", { color: undefined });
    expect(grf().pcaStyle?.arrowColors).toBeUndefined();
    // Undoable, and it never mints a real annotation.
    doc.commands.undo();
    expect(grf().pcaStyle?.arrowColors).toEqual({ "0": "#123456" });
    expect(grf().annotations ?? []).toHaveLength(0);
    // A rename patch on an arrow is a deliberate no-op (an arrow has no text of its own — the
    // variable name is the sibling pca-vlabel-*, and no editor opens on the arrow), so it is
    // exempt from the strict unresolved-target check rather than silently swallowed.
    expect(() => doc.updateAnnotation(plot.id, "pca-arrow-0", { label: "x" })).not.toThrow();
  });

  it("renaming a builder-owned reference-line readout (Bland-Altman bias / LoA) persists; the line stays put", () => {
    const doc = new MadyDocument();
    const t = doc.importTable("T", "xy", ["X", "Y"], [[1, 2]]);
    const plot = doc.addPlot("G", t.id);
    const grf = () => doc.toJSON().plots.find((p) => p.id === plot.id)!;
    doc.updateAnnotation(plot.id, "ba-bias", { label: "Mean difference" });
    expect(grf().refLineLabels?.["ba-bias"]).toBe("Mean difference");
    doc.updateAnnotation(plot.id, "ba-loa-hi", { label: "Upper LoA" });
    expect(grf().refLineLabels).toEqual({ "ba-bias": "Mean difference", "ba-loa-hi": "Upper LoA" });
    // blank restores the generated readout; undoable; no real annotation is minted
    doc.updateAnnotation(plot.id, "ba-bias", { label: "  " });
    expect(grf().refLineLabels).toEqual({ "ba-loa-hi": "Upper LoA" });
    doc.commands.undo();
    expect(grf().refLineLabels?.["ba-bias"]).toBe("Mean difference");
    expect(grf().annotations ?? []).toHaveLength(0);
    // The line's position is a computed statistic — a drag must never be silently dropped;
    // it is refused at the renderer (locked), so the document never sees one.
    expect(() => doc.moveAnnotation(plot.id, "ba-bias", { value: 99 })).toThrow(/could not resolve/);
  });

  /**
   * Matching panel styles leaves each panel's axis titles alone.
   *
   * Guards against title matching in panel assembly deleting axis titles. `MATCH_KEYS.axes`
   * copies `xAxis`/`yAxis` wholesale and `applyPlotTemplateMany` replaces the target's spec,
   * so without the guard every panel takes the reference's axis title, and a reference with
   * no title leaves the rest blank.
   */
  it("matching panel styles keeps each panel's own axis titles", () => {
    const doc = new MadyDocument();
    const t = doc.importTable("T", "xy", ["X", "Y"], [[1, 2]]);
    const ref = doc.addPlot("Ref", t.id);
    const other = doc.addPlot("Other", t.id);
    const grf = (id: string) => doc.toJSON().plots.find((p) => p.id === id)!;

    doc.setPlotOptions(ref.id, { xAxis: { title: "Dose (µM)", scale: "log10", tickLen: 9 } });
    doc.setPlotOptions(other.id, { xAxis: { title: "Time (min)" } });

    // Match the reference's axes onto the other panel.
    doc.applyPlotTemplateMany([other.id], { xAxis: { title: "Dose (µM)", scale: "log10", tickLen: 9 } }, ["xAxis"]);

    const after = grf(other.id).xAxis!;
    expect(after.title, "the panel was relabelled with another panel's axis title").toBe("Time (min)");
    // …while every presentation setting is copied.
    expect(after.scale).toBe("log10");
    expect(after.tickLen).toBe(9);
  });

  it("a panel with no axis title of its own does not gain the reference's", () => {
    // The other half: a reference with a title must not
    // stamp it onto panels measuring something else.
    const doc = new MadyDocument();
    const t = doc.importTable("T", "xy", ["X", "Y"], [[1, 2]]);
    const other = doc.addPlot("Other", t.id);
    const grf = () => doc.toJSON().plots.find((p) => p.id === other.id)!;
    doc.applyPlotTemplateMany([other.id], { xAxis: { title: "Dose (µM)", scale: "log10" } }, ["xAxis"]);
    expect(grf().xAxis?.title).toBeUndefined();
    expect(grf().xAxis?.scale).toBe("log10");
  });

  // The same rule holds on every other style-copy path — siblings, saved templates and user
  // presets all replace the axis spec wholesale, so without `keepAxisTitle` they would stamp
  // (or wipe) axis titles the same way panel matching would.
  it("copying a look to same-source siblings keeps each sibling's own axis title", () => {
    const doc = new MadyDocument();
    const t = doc.importTable("T", "xy", ["X", "Y"], [[1, 2]]);
    const a = doc.addPlot("A", t.id);
    const b = doc.addPlot("B", t.id);
    const grf = (id: string) => doc.toJSON().plots.find((p) => p.id === id)!;
    doc.setPlotOptions(a.id, { xAxis: { title: "Dose (µM)", scale: "log10", tickLen: 9 } });
    doc.setPlotOptions(b.id, { xAxis: { title: "Time (min)" } });
    doc.copyPlotStyleToSiblings(a.id);
    expect(grf(b.id).xAxis?.title, "the sibling was relabelled with the source's axis title").toBe("Time (min)");
    expect(grf(b.id).xAxis?.scale, "the presentation half of the spec did not copy").toBe("log10");
    expect(grf(b.id).xAxis?.tickLen).toBe(9);
  });

  it("a saved graph template does not stamp its axis title", () => {
    const doc = new MadyDocument();
    const t = doc.importTable("T", "xy", ["X", "Y"], [[1, 2]]);
    const a = doc.addPlot("A", t.id);
    const b = doc.addPlot("B", t.id);
    const grf = (id: string) => doc.toJSON().plots.find((p) => p.id === id)!;
    doc.setPlotOptions(a.id, { yAxis: { title: "Viability (%)" } });
    doc.applyPlotTemplate(a.id, { yAxis: { title: "Absorbance", tickLen: 9 } });
    expect(grf(a.id).yAxis?.title, "the template's axis title overwrote the graph's own").toBe("Viability (%)");
    expect(grf(a.id).yAxis?.tickLen).toBe(9);
    // A graph with no title of its own does not gain the template's.
    doc.applyPlotTemplate(b.id, { yAxis: { title: "Absorbance", tickLen: 9 } });
    expect(grf(b.id).yAxis?.title).toBeUndefined();
    expect(grf(b.id).yAxis?.tickLen).toBe(9);
  });

  it("a user preset does not stamp its axis title", () => {
    const doc = new MadyDocument();
    const t = doc.importTable("T", "xy", ["X", "Y"], [[1, 2]]);
    const a = doc.addPlot("A", t.id);
    const grf = () => doc.toJSON().plots.find((p) => p.id === a.id)!;
    doc.setPlotOptions(a.id, { xAxis: { title: "Time (min)" } });
    doc.applyUserPreset(a.id, { xAxis: { title: "Dose (µM)", tickLen: 9 } }, [], ["xAxis"]);
    expect(grf().xAxis?.title, "the preset's axis title overwrote the graph's own").toBe("Time (min)");
    expect(grf().xAxis?.tickLen).toBe(9);
  });

  it("a reference line's caption moves and the line does not", () => {
    const doc = new MadyDocument();
    const t = doc.importTable("T", "xy", ["X", "Y"], [[1, 2]]);
    const plot = doc.addPlot("G", t.id);
    const grf = () => doc.toJSON().plots.find((p) => p.id === plot.id)!;

    doc.moveRefLineLabel(plot.id, "ba-loa-hi", -40, -12);
    expect(grf().refLineLabelOffsets).toEqual({ "ba-loa-hi": { dx: -40, dy: -12 } });
    // A whole drag is one undo step (coalesced), so the second sample replaces the first.
    doc.moveRefLineLabel(plot.id, "ba-loa-hi", -55, -18);
    expect(grf().refLineLabelOffsets).toEqual({ "ba-loa-hi": { dx: -55, dy: -18 } });
    doc.commands.undo();
    expect(grf().refLineLabelOffsets).toBeUndefined();
    doc.commands.redo();

    // Dragged back to the anchor = no override at all, rather than an entry meaning "zero".
    doc.moveRefLineLabel(plot.id, "ba-loa-hi", 0, 0);
    expect(grf().refLineLabelOffsets).toBeUndefined();

    // Moving the caption mints no real annotation — the line is still the builder's.
    expect(grf().annotations ?? []).toHaveLength(0);
    // And an id nobody owns is refused loudly, not silently pocketed.
    expect(() => doc.moveRefLineLabel(plot.id, "not-a-ref-line", 1, 1)).toThrow(/could not resolve/);
  });

  it("removing an annotation that isn't there does not push a phantom undo step", () => {
    const doc = new MadyDocument();
    const t = doc.importTable("T", "xy", ["X", "Y"], [[1, 2]]);
    const plot = doc.addPlot("G", t.id);
    doc.addAnnotation(plot.id, { kind: "text", label: "real", x: 0.4, y: 0.5 });
    // A synth id is a deliberate no-op (builder-owned, regenerated on every rebuild). It must
    // not execute a command — filtering a list that does not contain the id and executing
    // anyway would make the next Undo spend a step doing nothing.
    doc.removeAnnotation(plot.id, "pca-vlabel-2");
    doc.commands.undo();
    // The symptom of a phantom step is precisely this: one undo after the no-op should undo
    // the real add. If the no-op had executed, this undo would be absorbed by it and the
    // annotation would still be there — Undo appearing to "do nothing".
    expect(
      doc.toJSON().plots.find((p) => p.id === plot.id)!.annotations ?? [],
      "undo hit a phantom step instead of undoing the real add",
    ).toHaveLength(0);
  });

  it("dragging a synthesized label (pyramid value / PCA loading) persists a fractional position override", () => {
    const doc = new MadyDocument();
    const t = doc.importTable("T", "xy", ["X", "Y"], [[1, 2]]);
    const plot = doc.addPlot("G", t.id);
    const grf = () => doc.toJSON().plots.find((p) => p.id === plot.id)!;
    // A pyramid value label drag → written under plot.pyramid.valueLabelPos keyed by <ds>-<row>.
    doc.moveAnnotation(plot.id, "pyr-val-ds9-r3", { x: 0.62, y: 0.18 });
    expect(grf().pyramid?.valueLabelPos?.["ds9-r3"]).toEqual({ x: 0.62, y: 0.18 });
    // A PCA loading label drag → written under plot.pcaStyle.labelPos keyed by the variable index.
    doc.moveAnnotation(plot.id, "pca-vlabel-2", { x: 0.4, y: 0.7 });
    expect(grf().pcaStyle?.labelPos?.["2"]).toEqual({ x: 0.4, y: 0.7 });
    // Each is undoable and does not create a real annotation.
    expect(grf().annotations ?? []).toHaveLength(0);
    doc.commands.undo();
    expect(grf().pcaStyle?.labelPos?.["2"]).toBeUndefined();
    doc.commands.undo();
    expect(grf().pyramid?.valueLabelPos?.["ds9-r3"]).toBeUndefined();
  });

  it("a synthesized-label drag coalesces to one undo per gesture (reverts to the pre-drag position)", () => {
    const doc = new MadyDocument();
    const t = doc.importTable("T", "xy", ["X", "Y"], [[1, 2]]);
    const plot = doc.addPlot("G", t.id);
    const grf = () => doc.toJSON().plots.find((p) => p.id === plot.id)!;
    // Simulate a drag = many moves with the same id; they collapse into one undo entry.
    doc.moveAnnotation(plot.id, "pca-vlabel-0", { x: 0.1, y: 0.1 });
    doc.moveAnnotation(plot.id, "pca-vlabel-0", { x: 0.2, y: 0.2 });
    doc.moveAnnotation(plot.id, "pca-vlabel-0", { x: 0.33, y: 0.44 });
    expect(grf().pcaStyle?.labelPos?.["0"]).toEqual({ x: 0.33, y: 0.44 }); // final position wins
    doc.commands.undo(); // a single undo clears the whole gesture
    expect(grf().pcaStyle?.labelPos?.["0"]).toBeUndefined();
  });

  it("loads the built-in sample: dose-response + a heatmap + bar/violin/lollipop experiments + a PCA-demo table + treemap/network/paireddot", () => {
    const doc = createSampleDocument();
    const project = doc.toJSON();
    // dose-response + heatmap (both in Experiment 1) + bar + violin + lollipop + a multivariable PCA demo (no graph) + treemap + network + paireddot
    expect(project.tables).toHaveLength(9);
    expect(project.tables[0]!.rows).toHaveLength(7); // the dose-response table
    expect(project.plots).toHaveLength(8);
    expect(project.plots.map((p) => p.kind)).toEqual([undefined, "heatmap", "bar", "violin", "lollipop", "treemap", "network", "paireddot"]);
    expect(doc.plotStatus(project.plots[0]!.id)).toBe("ok");
    expect(doc.plotStatus(project.plots[1]!.id)).toBe("ok"); // the heatmap builds
    // The PCA-demo table uses the dedicated PCA / ordination format (3 groups × 6 cases).
    const mv = project.tables.find((t) => t.kind === "pca")!;
    expect(mv.rows).toHaveLength(18);
    expect(mv.columns[0]!.name).toBe("Cell type");
    // Everything is filed under one project (Project 1) across 8 experiments. Experiment 1
    // holds two datasets + graphs (dose-response + heatmap = 4 members); experiments 2–4 and
    // 6–8 hold a dataset + graph (2 members); the PCA-demo experiment (5) holds just its table.
    // The sheets that support an analysis also file one beside them (see
    // `sample-analyses.test`): 4PL fit + clustering in Experiment 1, ANOVA in 2 and 3, PCA in 5,
    // Wilcoxon in 8 — so those experiments carry one more member each.
    expect(project.workspace.loose).toHaveLength(0);
    expect(project.workspace.folders).toHaveLength(1);
    const exps = project.workspace.folders[0]!.experiments;
    expect(exps).toHaveLength(8);
    expect(exps.map((e) => e.members.length)).toEqual([6, 3, 3, 2, 2, 2, 2, 3]);
    expect(project.analyses).toHaveLength(6);
  });

  it("serializes to a stable, known shape (golden file)", () => {
    // Ids are deterministic per fresh document (IdFactory per-prefix counters).
    const doc = new MadyDocument();
    const table = doc.addTable("T", "xy", ["X", "Y"]);
    doc.addRow(table.id, [1, 10]);
    doc.recompute();
    expect(doc.toJSON()).toEqual({
      schemaVersion: 5,
      tables: [
        {
          id: "tbl_1",
          kind: "xy",
          name: "T",
          columns: [
            { id: "col_1", name: "X" },
            { id: "col_2", name: "Y" },
          ],
          rows: [{ id: "row_1", cells: { col_1: 1, col_2: 10 } }],
        },
      ],
      plots: [],
      // A newly added table is auto-filed as a loose ref in the workspace tree.
      analyses: [],
      log: [],
      workspace: { folders: [], loose: [{ kind: "table", id: "tbl_1" }] },
    });
  });
});

describe("MadyDocument — importTable", () => {
  it("creates a fully-populated table in one undoable command", () => {
    const doc = new MadyDocument();
    const table = doc.importTable("Imported", "xy", ["Dose", "Response"], [
      [1, 10],
      [2, 20],
      [3, null],
    ]);
    const t = doc.toJSON().tables[0]!;
    expect(t.id).toBe(table.id);
    expect(t.columns.map((c) => c.name)).toEqual(["Dose", "Response"]);
    expect(t.rows).toHaveLength(3);
    expect(t.rows[0]!.cells[t.columns[0]!.id]).toBe(1);
    expect(t.rows[0]!.cells[t.columns[1]!.id]).toBe(10);
    expect(t.rows[2]!.cells[t.columns[1]!.id]).toBeNull();
    // Filed loose; entities + tree drop together on undo, restore on redo.
    expect(doc.toJSON().workspace.loose).toEqual([{ kind: "table", id: table.id }]);
    doc.commands.undo();
    expect(doc.toJSON().tables).toHaveLength(0);
    expect(doc.toJSON().workspace.loose).toHaveLength(0);
    doc.commands.redo();
    expect(doc.toJSON().tables).toHaveLength(1);
    expect(doc.toJSON().tables[0]!.rows).toHaveLength(3);
  });

  it("gives every row a stable, distinct id (no collisions after import)", () => {
    const doc = new MadyDocument();
    const table = doc.importTable("T", "xy", ["X", "Y"], [
      [1, 2],
      [3, 4],
    ]);
    const ids = doc.toJSON().tables[0]!.rows.map((r) => r.id);
    expect(new Set(ids).size).toBe(2);
    // A later edit must not collide with imported ids.
    const newRow = doc.addRow(table.id, [5, 6]);
    expect(ids).not.toContain(newRow.id);
  });

  it("pads short rows against the declared columns", () => {
    const doc = new MadyDocument();
    doc.importTable("T", "xy", ["A", "B", "C"], [[1, 2]]);
    const t = doc.toJSON().tables[0]!;
    expect(t.rows[0]!.cells[t.columns[2]!.id] ?? null).toBeNull();
  });

  it("applies per-column types passed at import (Excel date auto-typing)", () => {
    const doc = new MadyDocument();
    const t = doc.importTable("T", "xy", ["When", "Y"], [[19737, 10]], ["date", undefined]);
    expect(t.columns[0]!.type).toBe("date");
    expect(t.columns[1]!.type).toBeUndefined();
  });
});

describe("MadyDocument — relinkTableData (linked-file refresh)", () => {
  it("preserves excluded cells across a refresh", () => {
    const doc = new MadyDocument();
    const t = doc.importTable("Linked", "xy", ["Dose", "Response"], [
      [1, 10],
      [2, 999], // a contaminated replicate the user excludes
      [3, 30],
    ]);
    const rowId = t.rows[1]!.id;
    const respCol = t.columns[1]!.id;
    doc.setCellsExcluded(t.id, [{ rowId, colId: respCol }], true);
    expect(isCellExcluded(t, rowId, respCol)).toBe(true);

    // The source file is touched (or Refresh pressed) — same shape, the outlier still there.
    doc.relinkTableData(t.id, {
      columnNames: ["Dose", "Response"],
      rows: [[1, 10], [2, 999], [3, 30]],
    });

    // Row ids are preserved by position, so the exclusion still lands on row 2 / Response
    // instead of being orphaned onto a dead id (which would silently readmit the outlier).
    const t2 = doc.toJSON().tables[0]!;
    expect(t2.rows[1]!.id).toBe(rowId);
    expect(t2.columns[1]!.id).toBe(respCol); // column ids preserved too
    expect(isCellExcluded(t2, t2.rows[1]!.id, t2.columns[1]!.id)).toBe(true);
  });

  it("keeps a user's formula column across a refresh and recomputes it", () => {
    const doc = new MadyDocument();
    const t = doc.importTable("Linked", "xy", ["A", "B"], [[1, 2], [3, 4]]);
    const calc = doc.addFormulaColumn(t.id, "Sum", "A+B"); // computed column at position 2
    doc.recompute();
    doc.relinkTableData(t.id, { columnNames: ["A", "B"], rows: [[10, 20], [30, 40]] });
    const t2 = doc.toJSON().tables[0]!;
    const sum = t2.columns.find((c) => c.id === calc.id);
    expect(sum?.formula).toBe("A+B"); // not dropped
    expect(t2.rows[0]!.cells[calc.id]).toBe(30); // recomputed from the new file values (10+20)
    expect(t2.rows[0]!.cells[t2.columns[0]!.id]).toBe(10); // file column refreshed
  });

  it("does not let file data land on / overwrite a formula column when the file grows", () => {
    const doc = new MadyDocument();
    const t = doc.importTable("Linked", "xy", ["A"], [[1], [2]]);
    const calc = doc.addFormulaColumn(t.id, "Double", "A*2");
    doc.recompute();
    // The file now has a second column (a structural change → force to apply); the file's
    // 2nd column must fill a new column, not the formula slot.
    doc.relinkTableData(t.id, { columnNames: ["A", "B"], rows: [[5, 99], [6, 88]] }, { force: true });
    const t2 = doc.toJSON().tables[0]!;
    expect(t2.columns.find((c) => c.id === calc.id)?.formula).toBe("A*2");
    expect(t2.rows[0]!.cells[calc.id]).toBe(10); // 5*2 — not the file's 99
    const b = t2.columns.find((c) => c.name === "B" && c.id !== calc.id)!;
    expect(t2.rows[0]!.cells[b.id]).toBe(99); // the file's 2nd column landed on a real new column
  });

  it("remaps a calculated column's positional refs across insert / move / delete (no silent corruption)", () => {
    const cells = (doc: MadyDocument, tid: string, colId: string): unknown[] =>
      doc.toJSON().tables.find((t) => t.id === tid)!.rows.map((r) => r.cells[colId]);

    // Insert a column to the left of the refs → the letters must shift so "A/B" keeps meaning X/Y.
    {
      const doc = new MadyDocument();
      const t = doc.addTable("T", "xy", ["X", "Y"]);
      doc.editCellAt(t.id, 0, 0, 4); doc.editCellAt(t.id, 0, 1, 10);
      const f = doc.addFormulaColumn(t.id, "Ratio", "A/B"); // X/Y = 0.4
      expect(cells(doc, t.id, f.id)).toEqual([0.4]);
      doc.insertColumn(t.id, 0); // blank column lands at 0; X,Y,Ratio shift right
      expect(cells(doc, t.id, f.id)).toEqual([0.4]); // not [null] — the ref followed its column
      doc.commands.undo();
      expect(cells(doc, t.id, f.id)).toEqual([0.4]); // undo restores the original formula + value
    }

    // Move (swap the two data columns) → "A/B" must become "B/A" so it still computes X/Y.
    {
      const doc = new MadyDocument();
      const t = doc.addTable("T2", "xy", ["X", "Y"]);
      doc.editCellAt(t.id, 0, 0, 4); doc.editCellAt(t.id, 0, 1, 10);
      const f = doc.addFormulaColumn(t.id, "Ratio", "A/B");
      doc.moveColumn(t.id, 0, 1); // swap X <-> Y
      expect(cells(doc, t.id, f.id)).toEqual([0.4]); // not 2.5 (the inverted Y/X)
    }

    // Delete a column the formula does not reference → the surviving refs still follow their columns.
    {
      const doc = new MadyDocument();
      const t = doc.addTable("T3", "xy", ["X", "Y", "Z"]);
      doc.editCellAt(t.id, 0, 0, 4); doc.editCellAt(t.id, 0, 1, 10); doc.editCellAt(t.id, 0, 2, 99);
      const f = doc.addFormulaColumn(t.id, "Ratio", "A/B"); // X/Y, does not use Z
      doc.deleteColumn(t.id, 2); // delete Z
      expect(cells(doc, t.id, f.id)).toEqual([0.4]); // unchanged — A/B still X/Y
    }
  });

  it("setLinkError flags and clears a linked-file auto-update failure", () => {
    const doc = new MadyDocument();
    const t = doc.importTable("Linked", "xy", ["X"], [[1]]);
    doc.setLinkError(t.id, "unreadable");
    expect(doc.toJSON().tables[0]!.linkError).toBe("unreadable");
    doc.setLinkError(t.id, undefined);
    expect(doc.toJSON().tables[0]!.linkError).toBeUndefined();
  });

  it("refuses a zero-width read and keeps the current data", () => {
    const doc = new MadyDocument();
    const t = doc.importTable("Linked", "xy", ["X", "Y"], [[1, 2], [3, 4]]);
    // A non-atomic writer caught mid-save can yield an empty grid; applying it would wipe
    // the table. relinkTableData must refuse and report that nothing was applied.
    const res = doc.relinkTableData(t.id, { columnNames: [], rows: [] });
    expect(res).toBe("empty");
    const t2 = doc.toJSON().tables[0]!;
    expect(t2.columns.map((c) => c.name)).toEqual(["X", "Y"]); // unchanged
    expect(t2.rows).toHaveLength(2);
  });

  it("applies a normal same-shape refresh", () => {
    const doc = new MadyDocument();
    const t = doc.importTable("Linked", "xy", ["X", "Y"], [[1, 2]]);
    expect(doc.relinkTableData(t.id, { columnNames: ["X", "Y"], rows: [[9, 8]] })).toBe("applied");
    expect(doc.toJSON().tables[0]!.rows[0]!.cells[t.columns[0]!.id]).toBe(9);
  });

  it("does not silently apply a structural change; force applies it", () => {
    const doc = new MadyDocument();
    const t = doc.importTable("Linked", "xy", ["Dose", "Response"], [[1, 10], [2, 20]]);
    // The file gained a leading id column — applying by position would re-bind every plot to
    // the wrong data. Auto-refresh must refuse and report the structural change.
    const grid = { columnNames: ["SampleID", "Dose", "Response"], rows: [["a", 1, 10], ["b", 2, 20]] };
    expect(doc.relinkTableData(t.id, grid)).toBe("structural");
    expect(doc.toJSON().tables[0]!.columns.map((c) => c.name)).toEqual(["Dose", "Response"]); // untouched
    // The user can explicitly accept the new shape.
    expect(doc.relinkTableData(t.id, grid, { force: true })).toBe("applied");
    expect(doc.toJSON().tables[0]!.columns.map((c) => c.name)).toEqual(["SampleID", "Dose", "Response"]);
  });

  it("gives newly-appended rows a fresh, distinct id while reusing existing ones", () => {
    const doc = new MadyDocument();
    const t = doc.importTable("Linked", "xy", ["X", "Y"], [[1, 2], [3, 4]]);
    const [r0, r1] = [t.rows[0]!.id, t.rows[1]!.id];

    // The file grew by one row.
    doc.relinkTableData(t.id, { columnNames: ["X", "Y"], rows: [[1, 2], [3, 4], [5, 6]] });

    const rows = doc.toJSON().tables[0]!.rows;
    expect(rows[0]!.id).toBe(r0);
    expect(rows[1]!.id).toBe(r1);
    expect(new Set(rows.map((r) => r.id)).size).toBe(3); // the appended row's id is distinct
    expect(rows[2]!.id).not.toBe(r0);
    expect(rows[2]!.id).not.toBe(r1);
  });
});

describe("MadyDocument — insertGraph (gallery → editable graph)", () => {
  // A card-like table whose 2nd Y column is a replicate of the 1st (group ref),
  // plus a plot of an explicit kind whose source points at the table.
  const card = () => {
    const table: DataTable = {
      id: "g-src",
      kind: "xy",
      name: "Card",
      columns: [
        { id: "x", name: "X", role: "x" },
        { id: "y1", name: "Ctrl", role: "y" },
        { id: "y2", name: "rep", role: "y", group: "y1" },
      ],
      rows: [{ id: "g-r0", cells: { x: 1, y1: 10, y2: 12 } }],
    };
    const plot: Plot = {
      id: "g-plot", name: "Card", kind: "box", source: "g-src", status: "ok",
      styleOverrides: {}, seriesStyles: { y1: { color: "#123456" } },
    };
    return { table, plot };
  };

  it("inserts table+plot with fresh ids, remapped group + source, filed loose", () => {
    const doc = new MadyDocument();
    const { table, plot } = card();
    const r = doc.insertGraph(table, plot, "From gallery");

    // fresh ids (not the card's literal ids)
    expect(r.table.id).not.toBe("g-src");
    expect(r.plot.id).not.toBe("g-plot");
    // plot.source points at the new table; kind + name carried over
    expect(r.plot.source).toBe(r.table.id);
    expect(r.plot.kind).toBe("box");
    expect(r.table.name).toBe("From gallery");

    // the replicate column's group was rewritten to the new lead-column id
    const lead = r.table.columns[1]!;
    const rep = r.table.columns[2]!;
    expect(rep.group).toBe(lead.id);
    // seriesStyles key was remapped from "y1" to the new lead id
    expect(r.plot.seriesStyles?.[lead.id]?.color).toBe("#123456");

    // both filed loose
    expect(doc.toJSON().workspace.loose).toEqual(
      expect.arrayContaining([{ kind: "table", id: r.table.id }, { kind: "plot", id: r.plot.id }]),
    );
  });

  it("can insert the same card twice with no id collision, and undoes atomically", () => {
    const doc = new MadyDocument();
    const { table, plot } = card();
    const a = doc.insertGraph(table, plot);
    const b = doc.insertGraph(table, plot);
    expect(a.table.id).not.toBe(b.table.id);
    expect(a.plot.id).not.toBe(b.plot.id);
    expect(doc.toJSON().tables).toHaveLength(2);
    expect(doc.toJSON().plots).toHaveLength(2);

    doc.commands.undo(); // drops the 2nd table and plot together
    expect(doc.toJSON().tables).toHaveLength(1);
    expect(doc.toJSON().plots).toHaveLength(1);
  });

  it("rewrites a heatmap's annotation-strip references (row strip column, column strip keys) to the fresh ids", () => {
    // Guards against a card with a Pathway row strip and a Treatment column strip opening with
    // both strips grey: unless remapped, the strips still name the card's column ids after every
    // column has been given a fresh one, so each reads nothing. An un-remapped row-strip column
    // is not excluded from the matrix either, so it draws as a column of NaN.
    const doc = new MadyDocument();
    const table: DataTable = {
      id: "g-hm", kind: "grouped", name: "HM",
      columns: [
        { id: "g", name: "Gene", role: "x" }, { id: "pw", name: "Pathway" },
        { id: "s1", name: "S1", role: "y" }, { id: "s2", name: "S2", role: "y" },
      ],
      rows: [{ id: "r0", cells: { g: "A", pw: "Cycle", s1: 1, s2: 2 } }],
    };
    const plot: Plot = {
      id: "g-p", name: "HM", kind: "heatmap", source: "g-hm", status: "ok", styleOverrides: {},
      heatmap: {
        rowTracks: [{ column: "pw", name: "Pathway" }],
        colTracks: [{ name: "Treatment", values: { s1: "Ctrl", s2: "Drug" } }],
      },
    };
    const r = doc.insertGraph(table, plot);
    const id = (name: string) => r.table.columns.find((c) => c.name === name)!.id;
    expect(id("Pathway")).not.toBe("pw"); // the premise: ids really were re-minted
    expect(r.plot.heatmap?.rowTracks?.[0]?.column).toBe(id("Pathway"));
    expect(r.plot.heatmap?.colTracks?.[0]?.values).toEqual({ [id("S1")]: "Ctrl", [id("S2")]: "Drug" });
  });

  it("carries the sheet's cell colours, patterns, excluded marks and survival unit across, on fresh ids", () => {
    // Guards against insertGraph rebuilding the table from columns + rows alone, which makes a
    // card or template with coloured / patterned / excluded cells (or a survival sheet's date
    // unit) lose them on insert — silently, since nothing reads them back.
    const doc = new MadyDocument();
    const table: DataTable = {
      id: "g-t", kind: "survival", name: "T",
      columns: [{ id: "cx", name: "Weeks", role: "x" }, { id: "c1", name: "A" }],
      rows: [{ id: "row1", cells: { cx: 1, c1: 1 } }, { id: "row2", cells: { cx: 2, c1: 0 } }],
      excluded: { row1: ["c1"] },
      cellFills: { row2: { cx: "#ff0000" } },
      cellPatterns: { row2: { c1: "stripes" as never } },
      survivalDates: { unit: "days" as never },
    };
    const plot: Plot = { id: "g-p", name: "P", kind: "survival", source: "g-t", status: "ok", styleOverrides: {} };
    const r = doc.insertGraph(table, plot);
    const col = (name: string) => r.table.columns.find((c) => c.name === name)!.id;
    const [r1, r2] = r.table.rows.map((x) => x.id);
    expect(r.table.excluded).toEqual({ [r1!]: [col("A")] });
    expect(r.table.cellFills).toEqual({ [r2!]: { [col("Weeks")]: "#ff0000" } });
    expect(r.table.cellPatterns).toEqual({ [r2!]: { [col("A")]: "stripes" } });
    expect(r.table.survivalDates).toEqual({ unit: "days" });
    // A sheet without them stays without them — no empty maps appear.
    const bare = doc.insertGraph({ ...table, excluded: undefined, cellFills: undefined, cellPatterns: undefined, survivalDates: undefined }, plot);
    expect("excluded" in bare.table && bare.table.excluded !== undefined).toBe(false);
    expect(bare.table.cellFills).toBeUndefined();
  });

  it("rewrites every column / row / table reference a plot can hold — none of the card's ids survives", () => {
    // Every binding is remapped, not only the common ones (treemap, parallel, alluvial, network,
    // point bindings, heatmap strips) but also qq / manhattan / sunburst / chord / oncoprint
    // columns, barSeriesGroups, per-point styles, venn / upset / ternary label offsets and an
    // axis's category groups. A binding left on a card's old id is lost on insert, silently.
    // The test points every binding at the card's own ids, inserts, and
    // requires that no old id is left anywhere in the plot.
    const doc = new MadyDocument();
    const table: DataTable = {
      id: "g-t", kind: "xy", name: "T",
      columns: [{ id: "cx", name: "X", role: "x" }, { id: "c1", name: "A", role: "y" }, { id: "c2", name: "B", role: "y" }, { id: "c3", name: "C" }],
      rows: [{ id: "row1", cells: { cx: 1, c1: 2, c2: 3, c3: "g" } }, { id: "row2", cells: { cx: 2, c1: 3, c2: 4, c3: "h" } }],
    };
    const plot: Plot = {
      id: "g-p", name: "P", kind: "xy", source: "g-t", status: "ok", styleOverrides: {},
      seriesStyles: { c1: { colorFromColumn: "c3", symbolFromColumn: "c3", pointLabelColumn: "c3" } },
      pointStyles: { "c1:row2": { color: "#123456" } },
      barSeriesGroups: { c1: "G1", c2: "G2" },
      xAxis: { categoryGroups: { column: "c3" } },
      treemap: { groupColumn: "c3", iconColumn: "c2" },
      parallel: { colorColumn: "c3", axisOrder: ["c2", "c1"], brushes: { c1: [0, 1] }, perAxis: { c2: { tickCount: 5 } } },
      alluvial: { columns: ["c3", "c1"] },
      network: { groupColumn: "c3", sizeColumn: "c2" },
      heatmap: { rowTracks: [{ column: "c3" }], colTracks: [{ values: { c1: "a", c2: "b" } }] },
      qq: { pColumn: "c2" },
      manhattan: { pColumn: "c2", chrColumn: "c1", posColumn: "cx" },
      sunburst: { levelColumns: ["c3"], valueColumn: "c1" },
      chord: { sourceColumn: "c3", targetColumn: "c1", weightColumn: "c2", groupColumn: "cx" },
      oncoprint: { sampleColumn: "cx", geneColumn: "c1", alterationColumn: "c3" },
      venn: { labelOffsets: { c1: { dx: 1, dy: 1 } } },
      upset: { labelOffsets: { c2: { dx: 1, dy: 1 } } },
      ternary: { axisLabelOff: { c1: { dx: 1, dy: 1 } } },
    };
    const r = doc.insertGraph(table, plot);
    const oldIds = ["cx", "c1", "c2", "c3", "row1", "row2"];
    const json = JSON.stringify(r.plot);
    const leaked = oldIds.filter((id) => new RegExp(`"${id}"|"${id}:|:${id}"`).test(json));
    expect(leaked, `old ids still referenced somewhere in the inserted plot: ${leaked.join(", ")}`).toEqual([]);
    // …and the references point at the columns / rows that replaced them.
    const col = (name: string) => r.table.columns.find((c) => c.name === name)!.id;
    expect(r.plot.qq?.pColumn).toBe(col("B"));
    expect(r.plot.oncoprint?.geneColumn).toBe(col("A"));
    expect(Object.keys(r.plot.barSeriesGroups ?? {})).toEqual([col("A"), col("B")]);
    expect(Object.keys(r.plot.pointStyles ?? {})).toEqual([`${col("A")}:${r.table.rows[1]!.id}`]);
    expect(r.plot.xAxis?.categoryGroups?.column).toBe(col("C"));
  });

  it("rewrites plot-level column references (treemap group/icon, parallel colour, point bindings) to the fresh column ids", () => {
    const doc = new MadyDocument();
    const table: DataTable = {
      id: "g-tm", kind: "partsofwhole", name: "GDP",
      columns: [
        { id: "state", name: "State", role: "x" },
        { id: "gdp", name: "GDP", role: "y" },
        { id: "region", name: "Region", role: "x" },
        { id: "flag", name: "Flag", role: "x" },
      ],
      rows: [{ id: "g-r0", cells: { state: "CA", gdp: 40, region: "West", flag: "🐻" } }],
    };
    const plot: Plot = {
      id: "g-tm-plot", name: "T", kind: "treemap", source: "g-tm", status: "ok", styleOverrides: {},
      treemap: { groupColumn: "region", iconColumn: "flag" },
      seriesStyles: { gdp: { colorFromColumn: "region", pointLabelColumn: "state" } },
    };
    const r = doc.insertGraph(table, plot);
    const colId = (name: string) => r.table.columns.find((c) => c.name === name)!.id;
    // Old literal ids are gone; the refs now point at the freshly-minted column ids.
    expect(r.plot.treemap?.groupColumn).toBe(colId("Region"));
    expect(r.plot.treemap?.iconColumn).toBe(colId("Flag"));
    expect(r.plot.treemap?.groupColumn).not.toBe("region");
    // seriesStyles: the key and its inner column bindings are remapped.
    const gdpStyle = r.plot.seriesStyles?.[colId("GDP")];
    expect(gdpStyle?.colorFromColumn).toBe(colId("Region"));
    expect(gdpStyle?.pointLabelColumn).toBe(colId("State"));
  });
});

describe("MadyDocument — reuse suite (clone / duplicate / apply-look)", () => {
  it("clonePlot copies all style with a fresh id + re-minted annotation ids; same source", () => {
    const doc = new MadyDocument();
    const table = doc.addTable("T", "xy", ["X", "Y"]);
    const plot = doc.addPlot("Graph", table.id);
    doc.setSeriesStyle(plot.id, table.columns[1]!.id, { color: "#abcdef" });
    const ann = doc.addAnnotation(plot.id, { kind: "rect", x: 0.2, y: 0.2, w: 0.3, h: 0.3 });

    const clone = doc.clonePlot(plot.id);
    expect(clone.id).not.toBe(plot.id);
    expect(clone.source).toBe(plot.source); // same data
    expect(clone.seriesStyles?.[table.columns[1]!.id]?.color).toBe("#abcdef");
    // annotation copied but with a new id (plot-scoped uniqueness)
    expect(clone.annotations?.[0]?.id).not.toBe(ann.id);
    expect(clone.annotations?.[0]?.kind).toBe("rect");
    expect(doc.toJSON().plots).toHaveLength(2);
    doc.commands.undo();
    expect(doc.toJSON().plots).toHaveLength(1);
  });

  it("clonePlot deep-copies styles so editing the copy doesn't change the original", () => {
    const doc = new MadyDocument();
    const table = doc.addTable("T", "xy", ["X", "Y"]);
    const plot = doc.addPlot("Graph", table.id);
    doc.setSeriesStyle(plot.id, table.columns[1]!.id, { color: "#111111" });
    const clone = doc.clonePlot(plot.id);
    doc.setSeriesStyle(clone.id, table.columns[1]!.id, { color: "#222222" });
    const original = doc.toJSON().plots.find((p) => p.id === plot.id)!;
    expect(original.seriesStyles?.[table.columns[1]!.id]?.color).toBe("#111111"); // unchanged
  });

  it("duplicateTable deep-copies with fresh column/row ids + rewritten group refs", () => {
    const doc = new MadyDocument();
    const table = doc.importTable("Data", "xy", ["X", "Y"], [[1, 10], [2, 20]]);
    const dup = doc.duplicateTable(table.id);
    expect(dup.id).not.toBe(table.id);
    expect(dup.columns.map((c) => c.id)).not.toEqual(table.columns.map((c) => c.id));
    expect(dup.rows).toHaveLength(2);
    // values preserved under the new column ids
    expect(dup.rows[0]!.cells[dup.columns[0]!.id]).toBe(1);
    expect(dup.rows[1]!.cells[dup.columns[1]!.id]).toBe(20);
    doc.commands.undo();
    expect(doc.toJSON().tables.find((t) => t.id === dup.id)).toBeUndefined();
  });

  it("adoptImportedTable transplants an external scratch table intact (types/decimals/excluded, fresh ids, undoable)", () => {
    const doc = new MadyDocument();
    // A table shaped outside the doc (as the interactive import grid produces it), with a type,
    // a decimals pref, and a deliberately-excluded cell — none of which must be lost.
    const src = {
      id: "scratch", kind: "xy" as const, name: "scratch",
      columns: [
        { id: "sc0", name: "date", type: "date" as const },
        { id: "sc1", name: "n", decimals: 2 },
      ],
      rows: [
        { id: "sr0", cells: { sc0: 18283, sc1: 5 } },
        { id: "sr1", cells: { sc0: 18284, sc1: 6 } },
      ],
      excluded: { sr1: ["sc1"] },
    };
    const t = doc.adoptImportedTable(src, "COVID");
    const json = doc.toJSON();
    expect(json.tables.find((x) => x.id === t.id), "in the doc").toBeTruthy();
    expect(json.workspace.loose.some((r) => r.kind === "table" && r.id === t.id), "filed loose").toBe(true);
    expect(t.name).toBe("COVID");
    // Fresh ids — not the scratch ones (avoids collisions with the real document).
    expect(t.id).not.toBe("scratch");
    expect(t.columns.map((c) => c.id)).not.toContain("sc0");
    // Every field carried: type, decimals, and the excluded cell (re-keyed onto the fresh ids).
    expect(t.columns[0]!.type).toBe("date");
    expect(t.columns[1]!.decimals).toBe(2);
    expect(t.rows[0]!.cells[t.columns[0]!.id]).toBe(18283);
    expect(isCellExcluded(t, t.rows[1]!.id, t.columns[1]!.id), "excluded cell survived").toBe(true);
    doc.commands.undo();
    expect(doc.toJSON().tables.find((x) => x.id === t.id), "undo removes it").toBeUndefined();
  });

  it("removePlot / removeAnalysis delete the entity + unfile it (undoable)", () => {
    const doc = new MadyDocument();
    const table = doc.addTable("T", "xy", ["X", "Y"]);
    const plot = doc.addPlot("P", table.id);
    doc.removePlot(plot.id);
    expect(doc.toJSON().plots).toHaveLength(0);
    expect(doc.toJSON().workspace.loose.some((r) => r.kind === "plot")).toBe(false);
    doc.commands.undo();
    expect(doc.toJSON().plots).toHaveLength(1);
    expect(doc.toJSON().workspace.loose.some((r) => r.id === plot.id)).toBe(true);
  });

  it("removeTable cascades: deletes the dataset + every graph/analysis from it (undoable)", () => {
    const doc = new MadyDocument();
    const t = doc.addTable("T", "xy", ["X", "Y"]);
    const other = doc.addTable("Other", "xy", ["X", "Y"]);
    const p1 = doc.addPlot("P1", t.id);
    doc.addPlot("P2", other.id); // different source — survives
    doc.addAnalysis("a", "ttest", t.id, { columns: [t.columns[1]!.id] });
    doc.removeTable(t.id);
    expect(doc.toJSON().tables.map((x) => x.id)).toEqual([other.id]);
    expect(doc.toJSON().plots.map((x) => x.source)).toEqual([other.id]); // p1 cascaded out
    expect(doc.toJSON().analyses).toHaveLength(0);
    expect(doc.toJSON().workspace.loose.some((r) => r.id === p1.id)).toBe(false);
    doc.commands.undo();
    expect(doc.toJSON().tables).toHaveLength(2);
    expect(doc.toJSON().plots).toHaveLength(2);
    expect(doc.toJSON().analyses).toHaveLength(1);
  });

  it("deleteFolder / deleteExperiment remove the node and cascade-delete its objects", () => {
    const doc = new MadyDocument();
    const folder = doc.addFolder("Proj");
    const exp = doc.addExperiment(folder.id, "Exp");
    const t = doc.addTable("T", "xy", ["X", "Y"]);
    const p = doc.addPlot("P", t.id);
    doc.fileObject({ kind: "table", id: t.id }, { level: "experiment", folderId: folder.id, experimentId: exp.id });
    doc.fileObject({ kind: "plot", id: p.id }, { level: "experiment", folderId: folder.id, experimentId: exp.id });

    doc.deleteExperiment(folder.id, exp.id);
    expect(doc.toJSON().tables).toHaveLength(0); // table + its plot cascaded
    expect(doc.toJSON().plots).toHaveLength(0);
    expect(doc.toJSON().workspace.folders.find((f) => f.id === folder.id)?.experiments ?? []).toHaveLength(0);
    doc.commands.undo();
    expect(doc.toJSON().tables).toHaveLength(1);
    expect(doc.toJSON().plots).toHaveLength(1);

    doc.deleteFolder(folder.id);
    expect(doc.toJSON().workspace.folders).toHaveLength(0);
    expect(doc.toJSON().tables).toHaveLength(0);
  });

  it("setAxisLength sets/clears an axis length; resizeFigure for that dim clears it (last gesture wins)", () => {
    const doc = new MadyDocument();
    const table = doc.addTable("T", "xy", ["X", "Y"]);
    const plot = doc.addPlot("P", table.id);
    doc.setAxisLength(plot.id, "x", 320);
    expect(doc.toJSON().plots[0]!.xAxisLength).toBe(320);
    // A figure width resize clears xAxisLength (figure gesture takes over) but leaves yAxisLength.
    doc.setAxisLength(plot.id, "y", 200);
    doc.resizeFigure(plot.id, { figureWidth: 700 });
    expect(doc.toJSON().plots[0]!.xAxisLength).toBeUndefined();
    expect(doc.toJSON().plots[0]!.yAxisLength).toBe(200);
    expect(doc.toJSON().plots[0]!.figureWidth).toBe(700);
    // clamp + clear
    doc.setAxisLength(plot.id, "y", 5); // below min → clamped to 40
    expect(doc.toJSON().plots[0]!.yAxisLength).toBe(40);
    doc.setAxisLength(plot.id, "y", null);
    expect(doc.toJSON().plots[0]!.yAxisLength).toBeUndefined();
  });

  it("setFontSizeForPlots homogenises one role's size across graphs, preserving other font fields", () => {
    const doc = new MadyDocument();
    const table = doc.addTable("T", "xy", ["X", "Y"]);
    const a = doc.addPlot("A", table.id);
    const b = doc.addPlot("B", table.id);
    // a already has a bold axis title at 11px; b has nothing.
    doc.setPlotFont(a.id, "axisTitle", { size: 11, bold: true });
    doc.setFontSizeForPlots([a.id, b.id], "axisTitle", 20);
    const A = doc.toJSON().plots.find((p) => p.id === a.id)!;
    const B = doc.toJSON().plots.find((p) => p.id === b.id)!;
    expect(A.fonts?.axisTitle?.size).toBe(20);
    expect(A.fonts?.axisTitle?.bold).toBe(true); // other fields preserved
    expect(B.fonts?.axisTitle?.size).toBe(20);
    doc.commands.undo();
    expect(doc.toJSON().plots.find((p) => p.id === b.id)!.fonts?.axisTitle).toBeUndefined();
  });

  it("copyPlotStyleToSiblings applies a graph's look to same-source graphs only", () => {
    const doc = new MadyDocument();
    const table = doc.addTable("T", "xy", ["X", "Y"]);
    const other = doc.addTable("Other", "xy", ["X", "Y"]);
    const a = doc.addPlot("A", table.id);
    const b = doc.addPlot("B", table.id);
    const c = doc.addPlot("C", other.id); // different source — untouched
    doc.setSeriesStyle(a.id, table.columns[1]!.id, { color: "#ff0000" });
    doc.setGridStyle(a.id, { show: false });

    const n = doc.copyPlotStyleToSiblings(a.id);
    expect(n).toBe(1); // only B shares A's source
    const bb = doc.toJSON().plots.find((p) => p.id === b.id)!;
    expect(bb.seriesStyles?.[table.columns[1]!.id]?.color).toBe("#ff0000");
    expect(bb.grid?.show).toBe(false);
    const cc = doc.toJSON().plots.find((p) => p.id === c.id)!;
    expect(cc.seriesStyles).toBeUndefined();
    doc.commands.undo();
    const bUndo = doc.toJSON().plots.find((p) => p.id === b.id)!;
    expect(bUndo.seriesStyles).toBeUndefined();
  });
});

describe("MadyDocument — analyses", () => {
  it("adds a first-class analysis (undoable) filed loose, starting stale", () => {
    const doc = new MadyDocument();
    const table = doc.addTable("T", "xy", ["X", "Y"]);
    const an = doc.addAnalysis("t test", "ttest", table.id, { columns: [table.columns[1]!.id], variant: "one-sample", mu: 0 });
    expect(doc.toJSON().analyses).toHaveLength(1);
    expect(doc.analysisStatus(an.id)).toBe("stale");
    expect(doc.toJSON().workspace.loose).toContainEqual({ kind: "analysis", id: an.id });
    doc.commands.undo();
    expect(doc.toJSON().analyses).toHaveLength(0);
    doc.commands.redo();
    expect(doc.toJSON().analyses).toHaveLength(1);
  });

  it("attaches a tidy result (→ ok) and resolves the ref", () => {
    const doc = new MadyDocument();
    const table = doc.addTable("T", "xy", ["X", "Y"]);
    const an = doc.addAnalysis("desc", "describe", table.id, { columns: [table.columns[1]!.id] });
    doc.setAnalysisResult(an.id, { method: "describe", title: "Descriptives", terms: [], glance: { n: 0 }, summary: "ok" });
    expect(doc.analysisStatus(an.id)).toBe("ok");
    expect(doc.resolveRef({ kind: "analysis", id: an.id })).toMatchObject({ id: an.id, status: "ok" });
  });

  it("goes stale when its source table is edited", () => {
    const doc = new MadyDocument();
    const table = doc.addTable("T", "xy", ["X", "Y"]);
    doc.addRow(table.id, [1, 2]);
    const an = doc.addAnalysis("desc", "describe", table.id, { columns: [table.columns[1]!.id] });
    doc.setAnalysisResult(an.id, { method: "describe", title: "D", terms: [], glance: {}, summary: "" });
    expect(doc.analysisStatus(an.id)).toBe("ok");
    doc.editCellAt(table.id, 0, 1, 99);
    expect(doc.analysisStatus(an.id)).toBe("stale");
  });

  it("locationOf reports where a ref is filed (for the family model)", () => {
    const doc = new MadyDocument();
    const t = doc.addTable("T", "xy", ["X", "Y"]);
    const f = doc.addFolder("P");
    const e = doc.addExperiment(f.id, "E");
    doc.fileObject({ kind: "table", id: t.id }, { level: "experiment", folderId: f.id, experimentId: e.id });
    expect(doc.locationOf({ kind: "table", id: t.id })).toEqual({
      level: "experiment",
      folderId: f.id,
      experimentId: e.id,
    });
    // an analysis filed to the table's location lands in the same experiment
    const an = doc.addAnalysis("A", "describe", t.id, { columns: [t.columns[1]!.id] });
    doc.fileObject({ kind: "analysis", id: an.id }, doc.locationOf({ kind: "table", id: t.id }));
    expect(e.id && doc.toJSON().workspace.folders[0]!.experiments[0]!.members).toContainEqual({
      kind: "analysis",
      id: an.id,
    });
    // an unfiled ref → loose
    const t2 = doc.addTable("T2", "xy", ["X"]);
    expect(doc.locationOf({ kind: "table", id: t2.id })).toEqual({ level: "loose" });
  });

  it("records an engine error", () => {
    const doc = new MadyDocument();
    const table = doc.addTable("T", "xy", ["X", "Y"]);
    const an = doc.addAnalysis("t", "ttest", table.id, { columns: [] });
    doc.setAnalysisError(an.id, "need two groups");
    expect(doc.analysisStatus(an.id)).toBe("error");
    expect(doc.toJSON().analyses[0]!.error).toBe("need two groups");
  });
});

describe("MadyDocument — fitted curve overlay", () => {
  it("sets and clears a plot fit (undoable)", () => {
    const doc = new MadyDocument();
    const table = doc.addTable("T", "xy", ["X", "Y"]);
    const plot = doc.addPlot("P", table.id);
    doc.setPlotFit(plot.id, { label: "4PL", points: [[1, 2], [3, 4]] });
    expect(doc.toJSON().plots[0]!.fit).toEqual({ label: "4PL", points: [[1, 2], [3, 4]] });
    doc.commands.undo();
    expect(doc.toJSON().plots[0]!.fit).toBeUndefined();
    doc.commands.redo();
    expect(doc.toJSON().plots[0]!.fit?.label).toBe("4PL");
    doc.setPlotFit(plot.id, null);
    expect(doc.toJSON().plots[0]!.fit).toBeUndefined();
  });

  it("sets and clears the per-dataset global-fit curves (undoable)", () => {
    const doc = new MadyDocument();
    const table = doc.addTable("T", "xy", ["X", "Y1", "Y2"]);
    const plot = doc.addPlot("P", table.id);
    const fits = [
      { label: "A", points: [[1, 2], [3, 4]] as Array<[number, number]>, color: "#0072B2" },
      { label: "B", points: [[1, 1], [3, 3]] as Array<[number, number]>, color: "#E69F00" },
    ];
    doc.setPlotFits(plot.id, fits);
    expect(doc.toJSON().plots[0]!.fits).toHaveLength(2);
    expect(doc.toJSON().plots[0]!.fits![1]!.label).toBe("B");
    doc.commands.undo();
    expect(doc.toJSON().plots[0]!.fits).toBeUndefined();
    doc.commands.redo();
    expect(doc.toJSON().plots[0]!.fits).toHaveLength(2);
    // an empty array clears (treated as null).
    doc.setPlotFits(plot.id, []);
    expect(doc.toJSON().plots[0]!.fits).toBeUndefined();
  });
});

describe("MadyDocument — figure layouts (the assembler)", () => {
  it("creates a layout, adds graph panels in order, and de-dupes (undoable)", () => {
    const doc = new MadyDocument();
    const table = doc.addTable("T", "xy", ["X", "Y"]);
    const a = doc.addPlot("A", table.id);
    const b = doc.addPlot("B", table.id);
    const layout = doc.addLayout("Figure 1");
    expect(doc.toJSON().layouts).toHaveLength(1);
    // a default applies at creation: new figures scale panel fonts; saved ones are untouched
    expect(layout.panelFontScale).toBe(true);
    doc.addLayoutPanel(layout.id, a.id);
    doc.addLayoutPanel(layout.id, b.id);
    doc.addLayoutPanel(layout.id, a.id); // duplicate → ignored
    expect(doc.toJSON().layouts![0]!.panels).toEqual([a.id, b.id]);
    doc.commands.undo(); // undo add b
    expect(doc.toJSON().layouts![0]!.panels).toEqual([a.id]);
  });

  it("applies a style template (full + key-restricted) undoably", () => {
    const doc = new MadyDocument();
    const table = doc.addTable("T", "xy", ["X", "Y"]);
    const a = doc.addPlot("A", table.id);
    const tpl = { figureWidth: 700, figureHeight: 500, frame: "box" as const, palette: "Vibrant" };
    doc.applyPlotTemplate(a.id, tpl);
    let p = doc.toJSON().plots.find((x) => x.id === a.id)!;
    expect([p.figureWidth, p.figureHeight, p.frame, p.palette]).toEqual([700, 500, "box", "Vibrant"]);
    doc.commands.undo();
    p = doc.toJSON().plots.find((x) => x.id === a.id)!;
    expect(p.figureWidth).toBeUndefined();
    // key-restricted apply: only the listed keys transfer
    doc.applyPlotTemplate(a.id, { figureWidth: 320, palette: "Warm" }, ["palette"]);
    p = doc.toJSON().plots.find((x) => x.id === a.id)!;
    expect(p.palette).toBe("Warm");
    expect(p.figureWidth).toBeUndefined(); // figureWidth not in the key list
  });

  it("applies a custom user preset (style keys + ordered series colours) undoably", () => {
    const doc = new MadyDocument();
    const table = doc.addTable("T", "xy", ["X", "Y", "Z"]); // two datasets (Y, Z)
    const a = doc.addPlot("A", table.id);
    const style = { figureWidth: 660, frame: "box" as const, fonts: { title: { size: 30, family: "Helvetica" } } };
    doc.applyUserPreset(a.id, style, ["#111111", "#222222"], ["figureWidth", "frame", "fonts"]);
    let p = doc.toJSON().plots.find((x) => x.id === a.id)!;
    expect([p.figureWidth, p.frame]).toEqual([660, "box"]);
    expect(p.fonts?.title?.size).toBe(30);
    const dsIds = tableDatasets(table).map((d) => d.id);
    expect(p.seriesStyles![dsIds[0]!]!.color).toBe("#111111");
    expect(p.seriesStyles![dsIds[1]!]!.color).toBe("#222222"); // ordered palette → each dataset
    doc.commands.undo();
    p = doc.toJSON().plots.find((x) => x.id === a.id)!;
    expect(p.figureWidth).toBeUndefined();
    expect(p.seriesStyles).toBeUndefined(); // colours restored too
  });

  it("user preset with an empty palette leaves series colours untouched", () => {
    const doc = new MadyDocument();
    const table = doc.addTable("T", "xy", ["X", "Y"]);
    const a = doc.addPlot("A", table.id);
    doc.applyUserPreset(a.id, { figureWidth: 500 }, [], ["figureWidth"]);
    const p = doc.toJSON().plots.find((x) => x.id === a.id)!;
    expect(p.figureWidth).toBe(500);
    expect(p.seriesStyles).toBeUndefined();
  });

  it("matches one style across many panels (auto-scale) undoably", () => {
    const doc = new MadyDocument();
    const table = doc.addTable("T", "xy", ["X", "Y"]);
    const a = doc.addPlot("A", table.id);
    const b = doc.addPlot("B", table.id);
    const c = doc.addPlot("C", table.id);
    doc.applyPlotTemplateMany([b.id, c.id], { figureWidth: 640, fonts: { title: { size: 22 } } }, ["figureWidth", "fonts"]);
    const get = (id: string) => doc.toJSON().plots.find((p) => p.id === id)!;
    expect(get(b.id).figureWidth).toBe(640);
    expect(get(c.id).figureWidth).toBe(640);
    expect(get(a.id).figureWidth).toBeUndefined(); // reference untouched
    doc.commands.undo();
    expect(get(b.id).figureWidth).toBeUndefined();
    expect(get(c.id).figureWidth).toBeUndefined();
  });

  it("edits a layout's arrangement (columns / gutter / lettering) undoably", () => {
    const doc = new MadyDocument();
    doc.addTable("T", "xy", ["X", "Y"]);
    const layout = doc.addLayout("Figure 1");
    doc.setLayoutOptions(layout.id, { columns: 2, gutter: 24, lettering: "numeric" });
    let l = doc.toJSON().layouts![0]!;
    expect([l.columns, l.gutter, l.lettering]).toEqual([2, 24, "numeric"]);
    doc.commands.undo();
    l = doc.toJSON().layouts![0]!;
    expect([l.columns, l.gutter, l.lettering]).toEqual([undefined, undefined, undefined]);
  });

  it("removes a panel and a whole layout (undoable)", () => {
    const doc = new MadyDocument();
    const table = doc.addTable("T", "xy", ["X", "Y"]);
    const a = doc.addPlot("A", table.id);
    const b = doc.addPlot("B", table.id);
    const layout = doc.addLayout("Figure 1");
    doc.addLayoutPanel(layout.id, a.id);
    doc.addLayoutPanel(layout.id, b.id);
    doc.removeLayoutPanel(layout.id, a.id);
    expect(doc.toJSON().layouts![0]!.panels).toEqual([b.id]);
    doc.commands.undo(); // restore a at its index
    expect(doc.toJSON().layouts![0]!.panels).toEqual([a.id, b.id]);
    doc.removeLayout(layout.id);
    expect(doc.toJSON().layouts).toHaveLength(0);
    doc.commands.undo();
    expect(doc.toJSON().layouts).toHaveLength(1);
  });

  it("duplicates a linked panel into a real, workspace-filed copy — offset, same size, one undo", () => {
    const doc = new MadyDocument();
    const table = doc.addTable("T", "xy", ["X", "Y"]);
    const a = doc.addPlot("A", table.id);
    const layout = doc.addLayout("Figure 1");
    doc.addLayoutPanel(layout.id, a.id);
    doc.setLayoutOptions(layout.id, {
      panelPositions: { [a.id]: { x: 40, y: 30 } },
      panelSizes: { [a.id]: { w: 500, h: 300 } },
    });
    const dup = doc.duplicateLayoutPanel(layout.id, a.id);
    const l = doc.toJSON().layouts![0]!;
    expect(l.panels).toEqual([a.id, dup.id]);
    expect(dup.name).toBe("A copy");
    // a real graph: present in the plot store and filed in the workspace
    expect(doc.toJSON().plots.some((p) => p.id === dup.id)).toBe(true);
    expect(doc.toJSON().workspace.loose.some((r) => r.kind === "plot" && r.id === dup.id)).toBe(true);
    // the copy lands just below-right of the original, at the same size
    expect(l.panelPositions![dup.id]).toEqual({ x: 64, y: 54 });
    expect(l.panelSizes![dup.id]).toEqual({ w: 500, h: 300 });
    // A single undo removes the panel, the plot and the workspace ref together
    doc.commands.undo();
    const after = doc.toJSON();
    expect(after.layouts![0]!.panels).toEqual([a.id]);
    expect(after.plots.some((p) => p.id === dup.id)).toBe(false);
    expect(after.workspace.loose.some((r) => r.id === dup.id)).toBe(false);
    expect(after.layouts![0]!.panelPositions![dup.id]).toBeUndefined();
  });

  it("duplicates an unlinked panel as another detached clone of the same source (not filed)", () => {
    const doc = new MadyDocument();
    const table = doc.addTable("T", "xy", ["X", "Y"]);
    const a = doc.addPlot("A", table.id);
    const layout = doc.addLayout("Figure 1");
    doc.addLayoutPanel(layout.id, a.id);
    doc.setLayoutLinked(layout.id, false);
    const cloneId = doc.toJSON().layouts![0]!.panels[0]!;
    expect(cloneId).not.toBe(a.id); // sanity: unlinking swapped in a clone
    const dup = doc.duplicateLayoutPanel(layout.id, cloneId);
    const l = doc.toJSON().layouts![0]!;
    expect(l.panels).toEqual([cloneId, dup.id]);
    // chained to the original source graph, so re-linking can resolve it
    expect(l.panelSource![dup.id]).toBe(a.id);
    // a figure-private clone — never filed in the workspace tree
    expect(doc.toJSON().workspace.loose.some((r) => r.id === dup.id)).toBe(false);
    expect(doc.toJSON().plots.some((p) => p.id === dup.id)).toBe(true);
  });

  it("re-linking a figure with a duplicated panel restores each source once (no duplicate ids)", () => {
    const doc = new MadyDocument();
    const table = doc.addTable("T", "xy", ["X", "Y"]);
    const a = doc.addPlot("A", table.id);
    const layout = doc.addLayout("Figure 1");
    doc.addLayoutPanel(layout.id, a.id);
    doc.setLayoutLinked(layout.id, false);
    const cloneId = doc.toJSON().layouts![0]!.panels[0]!;
    doc.duplicateLayoutPanel(layout.id, cloneId);
    doc.setLayoutLinked(layout.id, true);
    // both clones resolve to source A — restored once, not [A, A]
    expect(doc.toJSON().layouts![0]!.panels).toEqual([a.id]);
  });

  it("throws when the panel is not in the layout (silent no-op is a defect)", () => {
    const doc = new MadyDocument();
    const table = doc.addTable("T", "xy", ["X", "Y"]);
    const a = doc.addPlot("A", table.id);
    const layout = doc.addLayout("Figure 1");
    expect(() => doc.duplicateLayoutPanel(layout.id, a.id)).toThrow(/not in layout/);
  });

  it("round-trips layouts through persist (collectIds seeds layout ids)", () => {
    const doc = new MadyDocument();
    const table = doc.addTable("T", "xy", ["X", "Y"]);
    const a = doc.addPlot("A", table.id);
    const layout = doc.addLayout("Figure 1");
    doc.addLayoutPanel(layout.id, a.id);
    const json = JSON.parse(JSON.stringify(doc.toJSON()));
    const reloaded = new MadyDocument(json);
    expect(reloaded.toJSON().layouts![0]!.panels).toEqual([a.id]);
    // a fresh id after reload must not collide with the layout id
    const next = reloaded.addLayout("Figure 2");
    expect(next.id).not.toBe(layout.id);
  });
});

describe("MadyDocument — insert/delete rows & columns (datasheet grid)", () => {
  it("inserts a blank row at an index, shifting the rest down (undoable, stale)", () => {
    const doc = new MadyDocument();
    const table = doc.addTable("T", "xy", ["X", "Y"]);
    const r0 = doc.addRow(table.id, [0, 0]);
    const r1 = doc.addRow(table.id, [1, 1]);
    const r2 = doc.addRow(table.id, [2, 2]);
    const plot = doc.addPlot("P", table.id);
    doc.recompute();
    doc.insertRow(table.id, 1);
    const rows = doc.toJSON().tables[0]!.rows;
    expect(rows).toHaveLength(4);
    expect(rows.map((r) => r.id)).toEqual([r0.id, rows[1]!.id, r1.id, r2.id]);
    expect(rows[1]!.cells).toEqual({}); // blank
    expect(doc.plotStatus(plot.id)).toBe("stale");
    doc.commands.undo();
    expect(doc.toJSON().tables[0]!.rows).toHaveLength(3);
  });

  it("deletes the row at an index (undoable)", () => {
    const doc = new MadyDocument();
    const table = doc.addTable("T", "xy", ["X", "Y"]);
    const r0 = doc.addRow(table.id, [0, 0]);
    doc.addRow(table.id, [1, 1]);
    const r2 = doc.addRow(table.id, [2, 2]);
    doc.deleteRow(table.id, 1);
    expect(doc.toJSON().tables[0]!.rows.map((r) => r.id)).toEqual([r0.id, r2.id]);
    doc.commands.undo();
    expect(doc.toJSON().tables[0]!.rows).toHaveLength(3);
  });

  it("inserts a blank column at an index, shifting the rest right (undoable)", () => {
    const doc = new MadyDocument();
    const table = doc.addTable("T", "xy", ["X", "Y"]);
    const [x, y] = table.columns;
    doc.insertColumn(table.id, 1);
    const cols = doc.toJSON().tables[0]!.columns;
    expect(cols).toHaveLength(3);
    expect(cols.map((c) => c.id)).toEqual([x!.id, cols[1]!.id, y!.id]);
    doc.commands.undo();
    expect(doc.toJSON().tables[0]!.columns).toHaveLength(2);
  });

  it("deletes the column at an index and drops its cells (undoable)", () => {
    const doc = new MadyDocument();
    const table = doc.addTable("T", "xy", ["X", "Y", "Z"]);
    const [x, , z] = table.columns;
    const yId = table.columns[1]!.id;
    const row = doc.addRow(table.id, [1, 2, 3]);
    doc.deleteColumn(table.id, 1);
    const out = doc.toJSON().tables[0]!;
    expect(out.columns.map((c) => c.id)).toEqual([x!.id, z!.id]);
    expect(out.rows[0]!.cells[yId]).toBeUndefined(); // cell removed
    expect(out.rows[0]!.cells[z!.id]).toBe(3); // sibling cell intact
    doc.commands.undo();
    expect(doc.toJSON().tables[0]!.columns).toHaveLength(3);
    expect(doc.toJSON().tables[0]!.rows[0]!.cells[yId]).toBe(2); // restored
    expect(row.id).toBeTruthy();
  });

  /**
   * Deleting a group's lead column promotes a new lead. Guards against the sub-columns
   * pointing at the deleted id, the series being renamed "Control·2" and the plot's
   * seriesStyles for it being orphaned, which silently loses the graph's colour.
   */
  it("deleting a replicate group's lead promotes the next sub-column: name, group and styles follow", () => {
    const doc = new MadyDocument();
    const t = doc.addTable("T", "column", ["Group", "Control", "Treated"]);
    doc.setReplicateCount(t.id, 3);
    const p = doc.addPlot("P", t.id);
    const tb = () => doc.toJSON().tables.find((x) => x.id === t.id)!;
    const lead = tb().columns[1]!; // Control (lead)
    const second = tb().columns[2]!; // Control·2
    doc.setSeriesStyle(p.id, lead.id, { color: "#ff0000" });
    doc.setPointStyle(p.id, lead.id, tb().rows[0]?.id ?? "r", { color: "#00ff00" }); // a per-point highlight on that series
    doc.deleteColumn(t.id, 1); // delete the lead
    const after = tb();
    const ds = tableDatasets(after);
    expect(ds.map((d) => d.name)).toEqual(["Control", "Treated"]); // not "Control·2"
    expect(ds[0]!.id).toBe(second.id); // the heir is the new lead…
    expect(ds[0]!.replicates).toHaveLength(2); // …with the remaining sibling
    expect(after.columns.find((c) => c.id === second.id)!.group).toBeUndefined();
    expect(after.columns.filter((c) => c.group === lead.id)).toHaveLength(0); // nobody points at the ghost
    const plot = doc.toJSON().plots.find((x) => x.id === p.id)!;
    expect(plot.seriesStyles?.[second.id]?.color, "the series style must follow the new lead").toBe("#ff0000");
    expect(plot.seriesStyles?.[lead.id], "no orphaned style under the deleted id").toBeUndefined();
    expect(Object.keys(plot.pointStyles ?? {}).some((k) => k.startsWith(`${second.id}:`)), "per-point highlight re-keyed").toBe(true);
    // A single undo puts everything back — the old lead, its style key, the old grouping.
    doc.commands.undo();
    expect(tableDatasets(tb()).map((d) => d.id)).toEqual([lead.id, tb().columns[4]!.id]);
    expect(doc.toJSON().plots.find((x) => x.id === p.id)!.seriesStyles?.[lead.id]?.color).toBe("#ff0000");
  });

  it("deleting a non-lead sub-column, or a plain column, is unchanged (no re-lead)", () => {
    const doc = new MadyDocument();
    const t = doc.addTable("T", "column", ["Group", "Control"]);
    doc.setReplicateCount(t.id, 3);
    const tb = () => doc.toJSON().tables.find((x) => x.id === t.id)!;
    const lead = tb().columns[1]!;
    doc.deleteColumn(t.id, 2); // delete Control·2 (a sub-column)
    expect(tableDatasets(tb())[0]!.id).toBe(lead.id); // lead untouched
    expect(tableDatasets(tb())[0]!.replicates).toHaveLength(2);
  });

  it("moves a row to a new index (drag-reorder, undoable)", () => {
    const doc = new MadyDocument();
    const table = doc.addTable("T", "xy", ["X", "Y"]);
    const r0 = doc.addRow(table.id, [0, 0]);
    const r1 = doc.addRow(table.id, [1, 1]);
    const r2 = doc.addRow(table.id, [2, 2]);
    doc.moveRow(table.id, 0, 2); // move first to last
    expect(doc.toJSON().tables[0]!.rows.map((r) => r.id)).toEqual([r1.id, r2.id, r0.id]);
    doc.commands.undo();
    expect(doc.toJSON().tables[0]!.rows.map((r) => r.id)).toEqual([r0.id, r1.id, r2.id]);
  });

  it("moves a column to a new index (drag-reorder, undoable)", () => {
    const doc = new MadyDocument();
    const table = doc.addTable("T", "xy", ["X", "Y", "Z"]);
    const [x, y, z] = table.columns;
    doc.moveColumn(table.id, 2, 0); // move Z to the front
    expect(doc.toJSON().tables[0]!.columns.map((c) => c.id)).toEqual([z!.id, x!.id, y!.id]);
    doc.commands.undo();
    expect(doc.toJSON().tables[0]!.columns.map((c) => c.id)).toEqual([x!.id, y!.id, z!.id]);
  });

  it("no-ops a move to the same index or out of range (data unchanged)", () => {
    const doc = new MadyDocument();
    const table = doc.addTable("T", "xy", ["X", "Y"]);
    doc.addRow(table.id, [1, 1]);
    const before = JSON.stringify(doc.toJSON().tables[0]);
    doc.moveColumn(table.id, 0, 0); // same index
    doc.moveRow(table.id, 5, 0); // from out of range
    expect(JSON.stringify(doc.toJSON().tables[0])).toBe(before);
  });

  it("clamps insert indices and no-ops out-of-range deletes", () => {
    const doc = new MadyDocument();
    const table = doc.addTable("T", "xy", ["X", "Y"]);
    doc.addRow(table.id, [1, 1]);
    doc.insertColumn(table.id, 999); // clamps to end
    expect(doc.toJSON().tables[0]!.columns).toHaveLength(3);
    doc.deleteRow(table.id, 50); // out of range → no-op
    expect(doc.toJSON().tables[0]!.rows).toHaveLength(1);
    doc.deleteColumn(table.id, 50); // out of range → no-op
    expect(doc.toJSON().tables[0]!.columns).toHaveLength(3);
  });
});

describe("MadyDocument — replicates + error bars (replicate model)", () => {
  it("sets a uniform table-wide replicate count across every Y dataset (undoable, stale)", () => {
    const doc = new MadyDocument();
    const table = doc.addTable("T", "xy", ["Dose", "Drug A", "Drug B"]);
    const [x, a, b] = table.columns;
    const plot = doc.addPlot("P", table.id);
    doc.recompute();
    doc.setReplicateCount(table.id, 3);
    const cols = doc.toJSON().tables[0]!.columns;
    // X first, then each dataset's 3 replicate subcolumns, contiguous + grouped.
    expect(cols.map((c) => c.id).slice(0, 4)).toEqual([x!.id, a!.id, cols[2]!.id, cols[3]!.id]);
    expect(cols).toHaveLength(1 + 3 + 3);
    expect(cols[0]).toMatchObject({ id: x!.id, role: "x" });
    expect(cols[2]).toMatchObject({ role: "y", group: a!.id });
    expect(cols[3]).toMatchObject({ role: "y", group: a!.id });
    expect(cols[4]).toMatchObject({ id: b!.id, role: "y" });
    expect(cols[5]).toMatchObject({ role: "y", group: b!.id });
    expect(doc.plotStatus(plot.id)).toBe("stale");
    // reducing the count drops the surplus subcolumns
    doc.setReplicateCount(table.id, 1);
    expect(doc.toJSON().tables[0]!.columns).toHaveLength(3);
    doc.commands.undo();
    expect(doc.toJSON().tables[0]!.columns).toHaveLength(7);
  });

  it("clamps the replicate count to ≥1", () => {
    const doc = new MadyDocument();
    const table = doc.addTable("T", "xy", ["X", "Y"]);
    doc.setReplicateCount(table.id, 0);
    expect(doc.toJSON().tables[0]!.columns).toHaveLength(2); // floor at 1 → X + 1 rep
  });

  it("sets a column role/group for the summary entry mode", () => {
    const doc = new MadyDocument();
    const table = doc.addTable("T", "xy", ["X", "Mean", "SD"]);
    const sd = table.columns[2]!;
    doc.setColumnRole(table.id, sd.id, "sd", table.columns[1]!.id);
    const col = doc.toJSON().tables[0]!.columns[2]!;
    expect(col).toMatchObject({ role: "sd", group: table.columns[1]!.id });
    doc.commands.undo();
    expect(doc.toJSON().tables[0]!.columns[2]!.role).toBeUndefined();
  });

  /**
   * Leaving replicate entry computes the summary instead of discarding the data.
   * Guards against a 3-replicate sheet switched to Mean+SD+N losing replicates 2 and 3,
   * leaving the lead's raw first value under a "Mean" header with SD and N blank.
   */
  it("replicates → Mean+SD+N: the mean / SD / N are computed from the replicates, not blanked", () => {
    const doc = new MadyDocument();
    const t = doc.addTable("T", "column", ["Group", "Control"]);
    doc.setReplicateCount(t.id, 3);
    doc.editCellAt(t.id, 0, 0, "A"); doc.editCellAt(t.id, 0, 1, 10); doc.editCellAt(t.id, 0, 2, 12); doc.editCellAt(t.id, 0, 3, 14);
    doc.editCellAt(t.id, 1, 0, "B"); doc.editCellAt(t.id, 1, 1, 5); doc.editCellAt(t.id, 1, 2, 7); // 3rd replicate blank → n = 2
    const tb = () => doc.toJSON().tables.find((x) => x.id === t.id)!;
    doc.setEntryMode(t.id, "mean-sd-n");
    const cols = tb().columns;
    const [lead, sd, n] = [cols[1]!, cols[2]!, cols[3]!];
    expect(sd.role).toBe("sd"); expect(n.role).toBe("n");
    const r0 = tb().rows[0]!.cells; const r1 = tb().rows[1]!.cells;
    expect(r0[lead.id]).toBe(12); // mean of 10, 12, 14 — not the raw first replicate 10
    expect(r0[sd.id]).toBeCloseTo(2, 10); // sample SD
    expect(r0[n.id]).toBe(3);
    expect(r1[lead.id]).toBe(6); expect(r1[n.id]).toBe(2); // a blank replicate is not counted
    // no orphaned cells left behind for the dropped replicate columns
    expect(Object.keys(r0)).toHaveLength(4);
    // one Undo brings the raw replicates back, exactly
    doc.commands.undo();
    expect(tb().columns).toHaveLength(4);
    expect(tb().rows[0]!.cells).toMatchObject({ [tb().columns[1]!.id]: 10, [tb().columns[2]!.id]: 12, [tb().columns[3]!.id]: 14 });
  });

  it("replicates → other summary formats compute the right centre and spread", () => {
    const mk = (mode: Parameters<MadyDocument["setEntryMode"]>[1]) => {
      const doc = new MadyDocument();
      const t = doc.addTable("T", "column", ["Group", "G"]);
      doc.setReplicateCount(t.id, 4);
      [1, 2, 3, 10].forEach((v, i) => doc.editCellAt(t.id, 0, i + 1, v));
      doc.setEntryMode(t.id, mode);
      const tb = doc.toJSON().tables.find((x) => x.id === t.id)!;
      const byRole = (role: string) => tb.rows[0]!.cells[tb.columns.find((c) => (c.role ?? "y") === role)!.id];
      return { lead: tb.rows[0]!.cells[tb.columns[1]!.id], byRole };
    };
    // mean 4, sample SD ≈ 4.0825, sem ≈ 2.0412, median 2.5, q1 1.75, q3 4.75, min 1, max 10
    let r = mk("mean-sem"); expect(r.lead).toBe(4); expect(r.byRole("sem")).toBeCloseTo(2.0412, 3);
    r = mk("mean-range"); expect(r.byRole("min")).toBe(1); expect(r.byRole("max")).toBe(10);
    r = mk("median-iqr"); expect(r.lead).toBe(2.5); expect(r.byRole("q1")).toBeCloseTo(1.75, 6); expect(r.byRole("q3")).toBeCloseTo(4.75, 6);
    r = mk("mean-cv-n"); expect(r.byRole("cv")).toBeCloseTo((4.0825 / 4) * 100, 1); expect(r.byRole("n")).toBe(4);
    r = mk("mean-limits"); expect(r.byRole("errlow")).toBeCloseTo(4 - 4.0825, 3); expect(r.byRole("errhigh")).toBeCloseTo(4 + 4.0825, 3); // absolute bounds
    r = mk("mean-err"); expect(r.byRole("errhigh")).toBeCloseTo(4.0825, 3); // one symmetric ± value
    r = mk("geomean-sd"); expect(r.lead).toBeCloseTo(Math.pow(60, 0.25), 6); // geometric mean of 1,2,3,10
  });

  it("switching between summary formats (no replicates) leaves the entered numbers alone", () => {
    const doc = new MadyDocument();
    const t = doc.addTable("T", "column", ["Group", "G"]);
    doc.setEntryMode(t.id, "mean-sd-n");
    const c = doc.toJSON().tables.find((x) => x.id === t.id)!.columns;
    doc.editCellAt(t.id, 0, 1, 50); doc.editCellAt(t.id, 0, 2, 3); doc.editCellAt(t.id, 0, 3, 8); // mean 50, SD 3, N 8 as entered
    doc.setEntryMode(t.id, "mean-sem-n"); // SD column is re-pooled as the SEM column
    const tb = doc.toJSON().tables.find((x) => x.id === t.id)!;
    expect(tb.rows[0]!.cells[c[1]!.id]).toBe(50); // the entered mean is untouched — nothing was "recomputed"
    expect(tb.rows[0]!.cells[c[2]!.id]).toBe(3);
  });

  it("switches a table to Mean+SD+N summary entry mode (mints SD + N per dataset)", () => {
    const doc = new MadyDocument();
    const table = doc.addTable("T", "xy", ["Dose", "Drug A", "Drug B"]);
    const [x, a, b] = table.columns;
    const plot = doc.addPlot("P", table.id);
    doc.recompute();
    doc.setEntryMode(table.id, "mean-sd-n");
    expect(tableEntryMode(doc.toJSON().tables[0]!)).toBe("mean-sd-n");
    const cols = doc.toJSON().tables[0]!.columns;
    // X · [meanA · SD · N] · [meanB · SD · N]
    expect(cols).toHaveLength(1 + 3 + 3);
    expect(cols[0]).toMatchObject({ id: x!.id, role: "x" });
    expect(cols[1]).toMatchObject({ id: a!.id, role: "y" });
    expect(cols[2]).toMatchObject({ role: "sd", group: a!.id });
    expect(cols[3]).toMatchObject({ role: "n", group: a!.id });
    expect(cols[4]).toMatchObject({ id: b!.id, role: "y" });
    expect(cols[5]).toMatchObject({ role: "sd", group: b!.id });
    expect(cols[6]).toMatchObject({ role: "n", group: b!.id });
    const ds = tableDatasets(doc.toJSON().tables[0]!);
    expect(ds[0]!.sd).toBe(cols[2]!.id);
    expect(ds[0]!.n).toBe(cols[3]!.id);
    expect(doc.plotStatus(plot.id)).toBe("stale");
    // one undo restores the original two-column shape
    doc.commands.undo();
    expect(doc.toJSON().tables[0]!.columns).toHaveLength(3);
    expect(tableEntryMode(doc.toJSON().tables[0]!)).toBe("replicates");
  });

  it("resyncs a stranded error type when the entry mode can no longer draw it (one undo restores both)", () => {
    const doc = new MadyDocument();
    const table = doc.addTable("T", "column", ["", "Drug A"]);
    doc.setReplicateCount(table.id, 3); // replicates → 95% CI is drawable
    const dsId = tableDatasets(doc.toJSON().tables[0]!)[0]!.id;
    const plot = doc.addPlot("P", table.id);
    doc.setPlotKind(plot.id, "bar");
    doc.setErrorBars(plot.id, dsId, { errorBars: "ci95" });
    expect(doc.toJSON().plots[0]!.seriesStyles?.[dsId]?.errorBars).toBe("ci95");
    // Mean+SD without N can't produce a 95% CI → repair the plot's type to SD.
    doc.setEntryMode(table.id, "mean-sd");
    expect(doc.toJSON().plots[0]!.seriesStyles?.[dsId]?.errorBars).toBe("sd");
    // A single undo restores the columns and the stranded type together.
    doc.commands.undo();
    expect(tableEntryMode(doc.toJSON().tables[0]!)).toBe("replicates");
    expect(doc.toJSON().plots[0]!.seriesStyles?.[dsId]?.errorBars).toBe("ci95");
  });

  it("leaves a still-drawable error type untouched on an entry-mode switch", () => {
    const doc = new MadyDocument();
    const table = doc.addTable("T", "column", ["", "Drug A"]);
    doc.setReplicateCount(table.id, 3);
    const dsId = tableDatasets(doc.toJSON().tables[0]!)[0]!.id;
    const plot = doc.addPlot("P", table.id);
    doc.setErrorBars(plot.id, dsId, { errorBars: "sem" });
    doc.setEntryMode(table.id, "mean-sd-n"); // SD+N can still draw SEM → unchanged
    expect(doc.toJSON().plots[0]!.seriesStyles?.[dsId]?.errorBars).toBe("sem");
  });

  it("switches to the pre-computed centre+spread formats (range/IQR/geometric/CI)", () => {
    const doc = new MadyDocument();
    const table = doc.addTable("T", "xy", ["Dose", "Drug A"]);
    const aId = table.columns[1]!.id;
    doc.setEntryMode(table.id, "median-iqr");
    expect(tableEntryMode(doc.toJSON().tables[0]!)).toBe("median-iqr");
    let ds = tableDatasets(doc.toJSON().tables[0]!)[0]!;
    expect(ds.id).toBe(aId); // the lead (now a median) keeps its id
    expect(ds.q1).toBeDefined();
    expect(ds.q3).toBeDefined();
    doc.setEntryMode(table.id, "mean-range");
    expect(tableEntryMode(doc.toJSON().tables[0]!)).toBe("mean-range");
    ds = tableDatasets(doc.toJSON().tables[0]!)[0]!;
    expect(ds.min).toBeDefined();
    expect(ds.max).toBeDefined();
    expect(ds.q1).toBeUndefined(); // switching reformats cleanly (no leftover quartiles)
    doc.setEntryMode(table.id, "geomean-sd");
    expect(tableEntryMode(doc.toJSON().tables[0]!)).toBe("geomean-sd");
    expect(tableDatasets(doc.toJSON().tables[0]!)[0]!.geoSd).toBeDefined();
    doc.setEntryMode(table.id, "mean-ci");
    expect(tableEntryMode(doc.toJSON().tables[0]!)).toBe("mean-ci");
    expect(tableDatasets(doc.toJSON().tables[0]!)[0]!.ci).toBeDefined();
  });

  it("switches to box-values (median lead + min/Q1/Q3/max per group)", () => {
    const doc = new MadyDocument();
    const table = doc.addTable("T", "column", ["", "Ctrl"]);
    doc.setEntryMode(table.id, "box-values");
    expect(tableEntryMode(doc.toJSON().tables[0]!)).toBe("box-values");
    const ds = tableDatasets(doc.toJSON().tables[0]!)[0]!;
    expect(ds.min).toBeDefined();
    expect(ds.q1).toBeDefined();
    expect(ds.q3).toBeDefined();
    expect(ds.max).toBeDefined();
  });

  it("toggles a shared X-error subcolumn (XY) — mint after X, exclude from datasets, remove drops cells", () => {
    const doc = new MadyDocument();
    const table = doc.addTable("T", "xy", ["Dose", "Resp"]);
    const x = table.columns[0]!;
    doc.setXError(table.id, true);
    let cols = doc.toJSON().tables[0]!.columns;
    expect(cols).toHaveLength(3);
    expect(cols[0]!.id).toBe(x.id);
    expect(cols[1]).toMatchObject({ role: "xerr" }); // right after X
    // the X-error column is not a plottable Y dataset
    expect(tableDatasets(doc.toJSON().tables[0]!)).toHaveLength(1);
    // idempotent
    doc.setXError(table.id, true);
    expect(doc.toJSON().tables[0]!.columns).toHaveLength(3);
    // put a value in the X-error cell, then remove → cell dropped
    const xeId = cols[1]!.id;
    const rowId = doc.addRow(table.id, []).id;
    doc.setCell(table.id, rowId, xeId, 2);
    doc.setXError(table.id, false);
    cols = doc.toJSON().tables[0]!.columns;
    expect(cols).toHaveLength(2);
    expect(doc.toJSON().tables[0]!.rows.find((r) => r.id === rowId)!.cells[xeId]).toBeUndefined();
    doc.commands.undo(); // undo remove → restored
    expect(doc.toJSON().tables[0]!.columns).toHaveLength(3);
  });

  it("switches back from summary to replicates (strips SD/SEM + N)", () => {
    const doc = new MadyDocument();
    const table = doc.addTable("T", "xy", ["X", "Y"]);
    doc.setEntryMode(table.id, "mean-sd-n");
    expect(doc.toJSON().tables[0]!.columns).toHaveLength(4); // X · mean · SD · N
    doc.setEntryMode(table.id, "replicates");
    const cols = doc.toJSON().tables[0]!.columns;
    expect(cols).toHaveLength(2); // X · mean
    expect(tableEntryMode(doc.toJSON().tables[0]!)).toBe("replicates");
    expect(cols[1]!.role).toBe("y");
  });

  it("re-roles the existing error column when switching SD ↔ SEM", () => {
    const doc = new MadyDocument();
    const table = doc.addTable("T", "xy", ["X", "Y"]);
    doc.setEntryMode(table.id, "mean-sd-n");
    const sdId = doc.toJSON().tables[0]!.columns[2]!.id;
    doc.setEntryMode(table.id, "mean-sem-n");
    const cols = doc.toJSON().tables[0]!.columns;
    expect(cols).toHaveLength(4); // not duplicated
    expect(cols[2]).toMatchObject({ id: sdId, role: "sem" }); // same column, re-roled
    expect(cols[2]!.name).toContain("SEM");
  });

  it("Mean+SD without N omits the N column (mean-sd)", () => {
    const doc = new MadyDocument();
    const table = doc.addTable("T", "xy", ["X", "Y"]);
    doc.setEntryMode(table.id, "mean-sd");
    const cols = doc.toJSON().tables[0]!.columns;
    expect(cols).toHaveLength(3); // X · mean · SD (no N)
    expect(cols[2]).toMatchObject({ role: "sd" });
    expect(cols.some((c) => c.role === "n")).toBe(false);
    expect(tableEntryMode(doc.toJSON().tables[0]!)).toBe("mean-sd");
  });

  it("Mean+%CV+N lays out mean · CV · N (mean-cv-n)", () => {
    const doc = new MadyDocument();
    const table = doc.addTable("T", "xy", ["X", "Y"]);
    doc.setEntryMode(table.id, "mean-cv-n");
    const cols = doc.toJSON().tables[0]!.columns;
    expect(cols).toHaveLength(4);
    expect(cols[2]).toMatchObject({ role: "cv" });
    expect(cols[2]!.name).toContain("%CV");
    expect(cols[3]).toMatchObject({ role: "n" });
    expect(tableEntryMode(doc.toJSON().tables[0]!)).toBe("mean-cv-n");
  });

  it("Mean±error uses a single errhigh column (mean-err)", () => {
    const doc = new MadyDocument();
    const table = doc.addTable("T", "xy", ["X", "Y"]);
    doc.setEntryMode(table.id, "mean-err");
    const cols = doc.toJSON().tables[0]!.columns;
    expect(cols).toHaveLength(3); // X · mean · Error
    expect(cols[2]).toMatchObject({ role: "errhigh" });
    expect(tableEntryMode(doc.toJSON().tables[0]!)).toBe("mean-err");
  });

  it("Mean with upper/lower limits lays out mean · errlow · errhigh (mean-limits)", () => {
    const doc = new MadyDocument();
    const table = doc.addTable("T", "xy", ["X", "Y"]);
    doc.setEntryMode(table.id, "mean-limits");
    const cols = doc.toJSON().tables[0]!.columns;
    expect(cols).toHaveLength(4); // X · mean · Lower · Upper
    expect(cols[2]).toMatchObject({ role: "errlow" });
    expect(cols[3]).toMatchObject({ role: "errhigh" });
    expect(tableEntryMode(doc.toJSON().tables[0]!)).toBe("mean-limits");
    const ds = tableDatasets(doc.toJSON().tables[0]!);
    expect(ds[0]!.errLow).toBe(cols[2]!.id);
    expect(ds[0]!.errHigh).toBe(cols[3]!.id);
  });

  it("reuses error columns across summary formats (SD+N → limits reuses one id + mints one, drops N)", () => {
    const doc = new MadyDocument();
    const table = doc.addTable("T", "xy", ["X", "Y"]);
    doc.setEntryMode(table.id, "mean-sd-n");
    const sdId = doc.toJSON().tables[0]!.columns[2]!.id;
    doc.setEntryMode(table.id, "mean-limits");
    const cols = doc.toJSON().tables[0]!.columns;
    expect(cols).toHaveLength(4); // X · mean · Lower · Upper (N dropped)
    expect(cols[2]).toMatchObject({ id: sdId, role: "errlow" }); // reused the SD column
    expect(cols[3]!.role).toBe("errhigh"); // minted the second limit
    expect(cols.some((c) => c.role === "n")).toBe(false);
  });

  it("sets chart kind + bar layout (undoable, presentation)", () => {
    const doc = new MadyDocument();
    const table = doc.addTable("T", "xy", ["X", "Y"]);
    const plot = doc.addPlot("P", table.id);
    doc.recompute();
    doc.setPlotKind(plot.id, "bar");
    doc.setBarLayout(plot.id, "stacked");
    expect(doc.toJSON().plots[0]).toMatchObject({ kind: "bar", barLayout: "stacked" });
    expect(doc.plotStatus(plot.id)).toBe("ok"); // presentation only — not stale
    doc.setPlotKind(plot.id, "box");
    doc.setBoxWhisker(plot.id, "minmax");
    expect(doc.toJSON().plots[0]).toMatchObject({ kind: "box", boxWhisker: "minmax" });
    doc.commands.undo(); // undo whisker
    expect(doc.toJSON().plots[0]!.boxWhisker).toBeUndefined();
    doc.commands.undo(); // undo kind→box
    doc.commands.undo(); // undo bar layout
    expect(doc.toJSON().plots[0]!.barLayout).toBeUndefined();
    doc.commands.undo(); // undo kind→bar
    expect(doc.toJSON().plots[0]!.kind).toBeUndefined();
  });

  it("converting a graph to histogram adopts the histogram house marker size (the shell's setKind path)", () => {
    const doc = new MadyDocument();
    const table = doc.addTable("T", "xy", ["X", "Y"]);
    doc.addRow(table.id, [1, 10]);
    doc.addRow(table.id, [2, 20]);
    const plot = doc.addPlot("P", table.id);
    const yId = table.columns[1]!.id;
    doc.setSeriesStyle(plot.id, yId, { symbolSize: 4 }); // an XY graph carrying a tiny marker
    // What the shell's setKind does when converting to a histogram:
    doc.setPlotKind(plot.id, "histogram");
    applyKindHouseDefaults(doc, plot.id, "histogram", tableDatasets);
    const sty = doc.toJSON().plots[0]!.seriesStyles![yId]!;
    expect(sty.symbolSize, "convert-to-histogram kept the source graph's small marker instead of the 11.5 house size").toBe(11.5);
  });

  it("edits the graph title / visibility / subtitle (undoable, presentation)", () => {
    const doc = new MadyDocument();
    const table = doc.addTable("T", "xy", ["X", "Y"]);
    const plot = doc.addPlot("P", table.id);
    doc.recompute();
    doc.setGraphTitle(plot.id, { title: "Figure 1", subtitle: "mean ± SD" });
    expect(doc.toJSON().plots[0]).toMatchObject({ title: "Figure 1", subtitle: "mean ± SD" });
    expect(doc.plotStatus(plot.id)).toBe("ok"); // presentation only — not stale
    doc.setGraphTitle(plot.id, { showTitle: false });
    expect(doc.toJSON().plots[0]!.showTitle).toBe(false);
    doc.commands.undo(); // undo hide
    expect(doc.toJSON().plots[0]!.showTitle).toBeUndefined();
    doc.commands.undo(); // undo title+subtitle
    expect(doc.toJSON().plots[0]!.title).toBeUndefined();
    expect(doc.toJSON().plots[0]!.subtitle).toBeUndefined();
    doc.commands.redo();
    expect(doc.toJSON().plots[0]!.title).toBe("Figure 1");
  });

  it("sets the Y2 and Y3 title fonts on their own axes, merged from their own font, never the main Y's", () => {
    const doc = new MadyDocument();
    const table = doc.addTable("T", "xy", ["X", "Y"]);
    const plot = doc.addPlot("P", table.id);
    doc.setAxisTitleFont(plot.id, "y", { size: 26 });
    doc.setAxisTitleFont(plot.id, "y2", { size: 30 });
    doc.setAxisTitleFont(plot.id, "y2", { bold: true }); // merges into Y2's own font, keeps its size
    doc.setAxisTitleFont(plot.id, "y3", { italic: true });
    const p = () => doc.toJSON().plots[0]!;
    expect(p().y2Axis?.titleFont).toEqual({ size: 30, bold: true });
    expect(p().y3Axis?.titleFont, "Y3 picked up the main Y title's size").toEqual({ italic: true });
    expect(p().yAxis?.titleFont, "a second-axis edit reached the main Y title").toEqual({ size: 26 });
    doc.setAxisTitleFont(plot.id, "y2", { size: undefined, bold: undefined });
    expect(p().y2Axis?.titleFont, "clearing every field should remove Y2's own font").toBeUndefined();
    doc.commands.undo();
    expect(p().y2Axis?.titleFont).toEqual({ size: 30, bold: true });
  });

  it("sets per-element fonts (merge + clear + undo, presentation)", () => {
    const doc = new MadyDocument();
    const table = doc.addTable("T", "xy", ["X", "Y"]);
    const plot = doc.addPlot("P", table.id);
    doc.recompute();
    doc.setPlotFont(plot.id, "title", { size: 24 });
    doc.setPlotFont(plot.id, "title", { bold: true }); // merges, keeps size
    expect(doc.toJSON().plots[0]!.fonts?.title).toEqual({ size: 24, bold: true });
    expect(doc.plotStatus(plot.id)).toBe("ok"); // presentation only
    doc.setPlotFont(plot.id, "tick", { color: "#ff0000" });
    expect(doc.toJSON().plots[0]!.fonts?.tick).toEqual({ color: "#ff0000" });
    // Clearing the last field of an element drops the element; emptying all drops fonts.
    doc.setPlotFont(plot.id, "tick", { color: undefined });
    expect(doc.toJSON().plots[0]!.fonts?.tick).toBeUndefined();
    doc.commands.undo(); // restore tick colour
    expect(doc.toJSON().plots[0]!.fonts?.tick).toEqual({ color: "#ff0000" });
    doc.commands.undo(); // undo tick set
    doc.commands.undo(); // undo title bold
    expect(doc.toJSON().plots[0]!.fonts?.title).toEqual({ size: 24 });
  });

  it("edits the legend (merge / clear / undo, presentation)", () => {
    const doc = new MadyDocument();
    const table = doc.addTable("T", "xy", ["X", "Y"]);
    const plot = doc.addPlot("P", table.id);
    doc.recompute();
    doc.setLegend(plot.id, { position: "topleft" });
    doc.setLegend(plot.id, { border: true }); // merges, keeps position
    expect(doc.toJSON().plots[0]!.legend).toEqual({ position: "topleft", border: true });
    expect(doc.plotStatus(plot.id)).toBe("ok"); // presentation only
    doc.setLegend(plot.id, { border: undefined }); // clear one field
    expect(doc.toJSON().plots[0]!.legend).toEqual({ position: "topleft" });
    doc.commands.undo(); // restore border
    expect(doc.toJSON().plots[0]!.legend).toEqual({ position: "topleft", border: true });
    doc.commands.undo(); // undo border add
    doc.commands.undo(); // undo position
    expect(doc.toJSON().plots[0]!.legend).toBeUndefined();
  });

  it("adds / edits / removes annotations (undoable, presentation)", () => {
    const doc = new MadyDocument();
    const table = doc.addTable("T", "xy", ["X", "Y"]);
    const plot = doc.addPlot("P", table.id);
    doc.recompute();
    const ann = doc.addAnnotation(plot.id, { kind: "hline", value: 10, dash: "dashed" });
    expect(doc.toJSON().plots[0]!.annotations).toEqual([{ id: ann.id, kind: "hline", value: 10, dash: "dashed" }]);
    expect(doc.plotStatus(plot.id)).toBe("ok"); // presentation only
    doc.updateAnnotation(plot.id, ann.id, { value: 20, label: "limit" });
    expect(doc.toJSON().plots[0]!.annotations?.[0]).toMatchObject({ value: 20, label: "limit" });
    doc.updateAnnotation(plot.id, ann.id, { label: undefined }); // clear a field
    expect(doc.toJSON().plots[0]!.annotations?.[0]?.label).toBeUndefined();
    doc.commands.undo(); // restore label
    expect(doc.toJSON().plots[0]!.annotations?.[0]?.label).toBe("limit");
    doc.removeAnnotation(plot.id, ann.id);
    expect(doc.toJSON().plots[0]!.annotations).toBeUndefined();
    doc.commands.undo(); // un-remove
    expect(doc.toJSON().plots[0]!.annotations).toHaveLength(1);
  });

  it("turns a plot into a survival chart (kind + curves), undoable", () => {
    const doc = new MadyDocument();
    const table = doc.addTable("T", "xy", ["X", "Y"]);
    const plot = doc.addPlot("P", table.id);
    doc.recompute();
    doc.setSurvival(plot.id, [{ label: "A", times: [0, 1], surv: [1, 0.5] }]);
    expect(doc.toJSON().plots[0]!.kind).toBe("survival");
    expect(doc.toJSON().plots[0]!.survival).toHaveLength(1);
    expect(doc.plotStatus(plot.id)).toBe("ok"); // presentation only
    doc.commands.undo();
    expect(doc.toJSON().plots[0]!.kind).toBeUndefined();
    expect(doc.toJSON().plots[0]!.survival).toBeUndefined();
  });

  it("drags an annotation, coalescing the move into a single undo", () => {
    const doc = new MadyDocument();
    const table = doc.addTable("T", "xy", ["X", "Y"]);
    const plot = doc.addPlot("P", table.id);
    doc.recompute();
    const ann = doc.addAnnotation(plot.id, { kind: "hline", value: 0 });
    // a drag = many moveAnnotation calls (same coalesce key) → one undo step.
    doc.moveAnnotation(plot.id, ann.id, { value: 1 });
    doc.moveAnnotation(plot.id, ann.id, { value: 2 });
    doc.moveAnnotation(plot.id, ann.id, { value: 3 });
    expect(doc.toJSON().plots[0]!.annotations?.[0]?.value).toBe(3);
    expect(doc.plotStatus(plot.id)).toBe("ok"); // presentation only
    doc.commands.undo(); // one undo reverts the whole drag to the pre-drag value
    expect(doc.toJSON().plots[0]!.annotations?.[0]?.value).toBe(0);
    doc.commands.redo();
    expect(doc.toJSON().plots[0]!.annotations?.[0]?.value).toBe(3);
  });

  it("groups annotations so they translate together, and locks them against dragging", () => {
    const doc = new MadyDocument();
    const table = doc.addTable("T", "xy", ["X", "Y"]);
    const plot = doc.addPlot("P", table.id);
    doc.recompute();
    const a = doc.addAnnotation(plot.id, { kind: "text", label: "A", x: 0.2, y: 0.2 });
    const b = doc.addAnnotation(plot.id, { kind: "rect", x: 0.5, y: 0.5, w: 0.1, h: 0.1 });
    const c = doc.addAnnotation(plot.id, { kind: "text", label: "C", x: 0.8, y: 0.8 });
    const by = (id: string) => doc.toJSON().plots[0]!.annotations!.find((x) => x.id === id)!;

    // Group a + b (c stays independent) → they share a fresh group id.
    doc.groupAnnotations(plot.id, [a.id, b.id]);
    const grp = by(a.id).group;
    expect(grp).toBeDefined();
    expect(by(b.id).group).toBe(grp);
    expect(by(c.id).group).toBeUndefined();

    // Dragging a by (+0.1, +0.1) drags b by the same delta; c is untouched.
    doc.moveAnnotation(plot.id, a.id, { x: 0.3, y: 0.3 });
    expect(by(a.id).x).toBeCloseTo(0.3);
    expect(by(b.id).x).toBeCloseTo(0.6); // moved with the group
    expect(by(b.id).y).toBeCloseTo(0.6);
    expect(by(c.id).x).toBeCloseTo(0.8); // independent — unchanged
    doc.commands.undo(); // one undo reverts the whole grouped move
    expect(by(b.id).x).toBeCloseTo(0.5);

    // Lock b → it no longer moves with its group, nor when dragged directly.
    doc.setAnnotationLocked(plot.id, [b.id], true);
    expect(by(b.id).locked).toBe(true);
    doc.moveAnnotation(plot.id, a.id, { x: 0.4, y: 0.4 });
    expect(by(a.id).x).toBeCloseTo(0.4); // the leader still moves
    expect(by(b.id).x).toBeCloseTo(0.5); // locked member stays put
    doc.moveAnnotation(plot.id, b.id, { x: 0.99, y: 0.99 });
    expect(by(b.id).x).toBeCloseTo(0.5); // a locked object can't be dragged directly

    // Ungroup dissolves the whole group even when only one member is selected.
    doc.ungroupAnnotations(plot.id, [a.id]);
    expect(by(a.id).group).toBeUndefined();
    expect(by(b.id).group).toBeUndefined();
  });

  it("adds a batch of annotations as one undoable step", () => {
    const doc = new MadyDocument();
    const table = doc.addTable("T", "xy", ["X", "Y"]);
    const plot = doc.addPlot("P", table.id);
    doc.recompute();
    const added = doc.addAnnotations(plot.id, [
      { kind: "bracket", from: 1, to: 2, bracketY: 10, label: "*" },
      { kind: "bracket", from: 2, to: 3, bracketY: 12, label: "**" },
    ]);
    expect(added).toHaveLength(2);
    expect(doc.toJSON().plots[0]!.annotations).toHaveLength(2);
    expect(doc.plotStatus(plot.id)).toBe("ok"); // presentation only
    doc.commands.undo(); // a single undo removes the whole batch
    expect(doc.toJSON().plots[0]!.annotations).toBeUndefined();
    doc.commands.redo();
    expect(doc.toJSON().plots[0]!.annotations).toHaveLength(2);
  });

  it("coalesces a box-width drag into a single undo (command coalescing)", () => {
    const doc = new MadyDocument();
    const table = doc.addTable("T", "xy", ["X", "Y"]);
    const plot = doc.addPlot("P", table.id);
    const ds = table.columns[1]!.id;
    // simulate a drag: many live updates
    doc.resizeBoxWidth(plot.id, ds, 0.6);
    doc.resizeBoxWidth(plot.id, ds, 0.7);
    doc.resizeBoxWidth(plot.id, ds, 0.8);
    expect(doc.toJSON().plots[0]!.seriesStyles?.[ds]?.boxWidth).toBeCloseTo(0.8, 10);
    // A single undo jumps straight to pre-drag (not 0.7 then 0.6) → proves coalescing.
    doc.commands.undo();
    expect(doc.toJSON().plots[0]!.seriesStyles?.[ds]?.boxWidth).toBeUndefined();
    doc.commands.redo();
    expect(doc.toJSON().plots[0]!.seriesStyles?.[ds]?.boxWidth).toBeCloseTo(0.8, 10);
  });

  it("coalesces a bar-width drag and clamps to [0.1, 1]", () => {
    const doc = new MadyDocument();
    const table = doc.addTable("T", "xy", ["X", "Y"]);
    const plot = doc.addPlot("P", table.id);
    doc.resizeBarWidth(plot.id, 0.5);
    doc.resizeBarWidth(plot.id, 2); // clamps to 1
    expect(doc.toJSON().plots[0]!.barWidth).toBe(1);
    doc.commands.undo();
    expect(doc.toJSON().plots[0]!.barWidth).toBeUndefined();
  });

  it("coalesces a figure-resize drag into one undo and clamps to [280,1200]×[180,900]", () => {
    const doc = new MadyDocument();
    const table = doc.addTable("T", "xy", ["X", "Y"]);
    const plot = doc.addPlot("P", table.id);
    // simulate a corner drag: many live width+height updates
    doc.resizeFigure(plot.id, { figureWidth: 600, figureHeight: 400 });
    doc.resizeFigure(plot.id, { figureWidth: 700, figureHeight: 500 });
    doc.resizeFigure(plot.id, { figureWidth: 5000, figureHeight: 50 }); // clamps
    expect(doc.toJSON().plots[0]!.figureWidth).toBe(1200); // clamped max
    expect(doc.toJSON().plots[0]!.figureHeight).toBe(180); // clamped min
    // A single undo jumps straight back to the pre-drag (undefined) state.
    doc.commands.undo();
    expect(doc.toJSON().plots[0]!.figureWidth).toBeUndefined();
    expect(doc.toJSON().plots[0]!.figureHeight).toBeUndefined();
    doc.commands.redo();
    expect(doc.toJSON().plots[0]!.figureWidth).toBe(1200);
  });

  // Resizing a graph in its pane is a uniform scale of the whole drawing: it writes displayScale only,
  // never the laid-out size, one undo per drag, clamped to 0.25–4.
  it("scales a figure: one undo per drag, clamped, and the laid-out size untouched", () => {
    const doc = new MadyDocument();
    const table = doc.addTable("T", "xy", ["X", "Y"]);
    const plot = doc.addPlot("P", table.id);
    doc.scaleFigure(plot.id, 0.8);
    doc.scaleFigure(plot.id, 0.6);
    doc.scaleFigure(plot.id, 0.1); // clamps
    const p = doc.toJSON().plots[0]!;
    expect(p.displayScale).toBe(0.25);
    expect(p.figureWidth, "a scale changed the laid-out size").toBeUndefined();
    expect(p.figureHeight).toBeUndefined();
    doc.commands.undo();
    expect(doc.toJSON().plots[0]!.displayScale, "one undo did not undo the whole drag").toBeUndefined();
    doc.scaleFigure(plot.id, 9);
    expect(doc.toJSON().plots[0]!.displayScale).toBe(4);
  });

  it("applies a style preset (fonts + axis thickness + grid + palette) in one undo", () => {
    const doc = new MadyDocument();
    const table = doc.addTable("T", "xy", ["X", "Y1", "Y2"]);
    const plot = doc.addPlot("P", table.id);
    const ds = tableDatasets(table);
    const preset = findPreset("Bold infographic")!;
    doc.applyStylePreset(plot.id, preset);
    const p = doc.toJSON().plots[0]!;
    expect(p.fonts?.title?.size).toBe(preset.titleSize);
    expect(p.fonts?.title?.bold).toBe(true);
    expect(p.xAxis?.lineWidth).toBe(preset.axisThickness);
    expect(p.yAxis?.lineWidth).toBe(preset.axisThickness);
    expect(p.grid?.show).toBe(preset.gridShow);
    // palette mapped to datasets in order
    expect(p.seriesStyles?.[ds[0]!.id]?.color).toBe(preset.palette[0]);
    expect(p.seriesStyles?.[ds[1]!.id]?.color).toBe(preset.palette[1]);
    // A single undo restores the pristine (no fonts / no axis thickness / no series colours) state
    doc.commands.undo();
    const u = doc.toJSON().plots[0]!;
    expect(u.fonts).toBeUndefined();
    expect(u.xAxis?.lineWidth).toBeUndefined();
    expect(u.seriesStyles?.[ds[0]!.id]?.color).toBeUndefined();
  });

  it("style preset preserves a dataset's other (non-colour) series-style fields", () => {
    const doc = new MadyDocument();
    const table = doc.addTable("T", "xy", ["X", "Y1"]);
    const plot = doc.addPlot("P", table.id);
    const ds = tableDatasets(table)[0]!.id;
    doc.setSeriesStyle(plot.id, ds, { lineDash: "dashed", symbol: "square" });
    // No preset sets lineDash or marker shape, so those are preserved across an apply.
    doc.applyStylePreset(plot.id, findPreset("MadY default")!);
    const s = doc.toJSON().plots[0]!.seriesStyles?.[ds];
    expect(s?.lineDash).toBe("dashed"); // preserved
    expect(s?.symbol).toBe("square"); // preserved
    expect(s?.color).toBe(findPreset("MadY default")!.palette[0]); // colour applied
  });

  it("applyStyleParams applies only the given fields, layered on top (no clobber) + undoable", () => {
    const doc = new MadyDocument();
    const table = doc.addTable("T", "xy", ["X", "Y1", "Y2"]);
    const plot = doc.addPlot("P", table.id);
    doc.applyStylePreset(plot.id, findPreset("MadY default")!); // a full base look
    const ds = tableDatasets(table)[0]!.id;
    const beforeFill = doc.toJSON().plots[0]!.seriesStyles?.[ds]?.symbolFill;
    // 30 differs from the MadY-default title size (26), so the post-undo "reverted" check
    // below cannot pass vacuously.
    doc.applyStyleParams(plot.id, { titleSize: 30, titleBold: true, axisThickness: 4, palette: ["#ff0000", "#00ff00"] });
    const out = doc.toJSON().plots[0]!;
    expect(out.fonts?.title?.size).toBe(30); // set
    expect(out.fonts?.title?.bold).toBe(true);
    expect(out.xAxis?.lineWidth).toBe(4);
    expect(out.yAxis?.lineWidth).toBe(4);
    expect(out.seriesStyles?.[ds]?.color).toBe("#ff0000"); // palette recoloured series 0
    // A field the params never touch (the preset's two-tone marker fill) survives.
    expect(out.seriesStyles?.[ds]?.symbolFill).toBe(beforeFill);
    expect(out.seriesStyles?.[ds]?.symbolFill).toBe("twotone");
    doc.commands.undo();
    expect(doc.toJSON().plots[0]!.fonts?.title?.size).not.toBe(30); // reverted
  });

  it("applyStyleParams leaves the plot byte-identical for empty params (no-op)", () => {
    const doc = new MadyDocument();
    const table = doc.addTable("T", "xy", ["X", "Y"]);
    const plot = doc.addPlot("P", table.id);
    const before = JSON.stringify(doc.toJSON().plots[0]);
    doc.applyStyleParams(plot.id, {}); // nothing provided → early return, no change
    expect(JSON.stringify(doc.toJSON().plots[0])).toBe(before);
  });

  it("the MadY default preset captures the house style (thick black axes, big ticks, two-tone open markers)", () => {
    const doc = new MadyDocument();
    const table = doc.addTable("T", "xy", ["X", "Y"]);
    const plot = doc.addPlot("P", table.id);
    doc.applyStylePreset(plot.id, findPreset("MadY default")!);
    const out = doc.toJSON().plots[0]!;
    const ds = tableDatasets(table)[0]!.id;
    // two-tone marker: fill + outline derived from the series colour at render time, so the
    // stored style carries symbolFill "twotone" and no fixed fill/outline colour.
    // First series blue (Okabe–Ito order) at 2px — the gallery look. It is the default
    // everywhere: the gallery cards draw OKABE_ITO[i] traces at 2px, and the house default
    // matches them.
    expect(out.seriesStyles?.[ds]).toMatchObject({
      color: "#0072B2",
      symbolFill: "twotone",
      symbolSize: 6.5,
      borderWidth: 2,
      lineWidth: 2,
    });
    expect(out.seriesStyles?.[ds]?.symbolFillColor).toBeUndefined();
    expect(out.xAxis?.lineWidth).toBe(2.5);
    expect(out.xAxis?.lineColor).toBe("#000000");
    expect(out.grid?.show).toBe(false);
    // The house sizes: title 26 / axis-title 22 / tick 20, for all graph types
    // where they apply.
    expect(out.fonts?.title?.size).toBe(26);
    expect(out.fonts?.tick?.size).toBe(20);
    expect(out.fonts?.tick?.color).toBe("#0a0a0a");
    expect(out.fonts?.axisTitle?.size).toBe(22);
    expect(out.fonts?.title?.family).toContain("Helvetica");
  });

  it("auto-computes a percent-change label from first→last (movable text annotation)", () => {
    const doc = new MadyDocument();
    const table = doc.addTable("T", "xy", ["X", "Y"]);
    doc.addRow(table.id, [1, 100]);
    doc.addRow(table.id, [2, 120]);
    doc.addRow(table.id, [3, 129]); // first 100 → last 129 = +29%
    const plot = doc.addPlot("P", table.id);
    const ann = doc.addPercentChangeLabel(plot.id)!;
    expect(ann.kind).toBe("text");
    expect(ann.label).toBe("+29%");
    expect(ann.color).toBe("#1a8f5a"); // green for an increase
    expect(ann.bold).toBe(true);
    // it lives in the annotations array (editable + movable like any text box)
    expect(doc.toJSON().plots[0]!.annotations?.some((a) => a.id === ann.id)).toBe(true);
    doc.commands.undo();
    expect(doc.toJSON().plots[0]!.annotations ?? []).toHaveLength(0);
  });

  it("the Scientific Journal preset applies the journal palette + thin soft axes + haloed markers + no grid", () => {
    const doc = new MadyDocument();
    const table = doc.addTable("T", "xy", ["X", "Drug A", "Drug B"]);
    const plot = doc.addPlot("P", table.id);
    const nat = findPreset("Scientific Journal")!;
    doc.applyStylePreset(plot.id, nat);
    const out = doc.toJSON().plots[0]!;
    const ds = tableDatasets(table);
    expect(nat.palette[0]).toBe("#E64B35"); // journal palette red (ggsci-derived)
    // small filled markers with a thin white halo (the modern "separated markers" look)
    expect(out.seriesStyles?.[ds[0]!.id]).toMatchObject({
      color: "#E64B35",
      lineWidth: 1.75,
      symbolSize: 4.5,
      symbolFill: "solid",
      symbolOutline: "#FFFFFF",
      borderWidth: 1.3,
    });
    expect(out.seriesStyles?.[ds[1]!.id]?.color).toBe("#4DBBD5"); // journal palette cyan (2nd)
    expect(out.grid?.show).toBe(false);
    expect(out.xAxis?.lineColor).toBe("#2B2B2B"); // soft near-black axis
    expect(out.fonts?.axisTitle?.family).toContain("Helvetica");
    expect(out.frame).toBe("lshape");
    // Fonts are sized for on-screen legibility (printed journal sizes are too small to read
    // on screen) while keeping this the most compact preset.
    expect(nat.tickSize).toBeGreaterThanOrEqual(12);
    expect(nat.axisTitleSize).toBeGreaterThanOrEqual(14);
  });

  it('the preset name "Nature" resolves to Scientific Journal (stored profiles carry it)', () => {
    // A stored profile can name the preset "Nature"; that name must resolve
    // to the "Scientific Journal" look instead of silently falling back to a bare graph.
    const p = findPreset("Nature");
    expect(p).toBeDefined();
    expect(p!.name).toBe("Scientific Journal");
    expect(p!.palette[0]).toBe("#E64B35"); // the same journal palette
  });

  it("the Editorial preset applies the warm palette on a frameless, gridless, heavy-title canvas", () => {
    const doc = new MadyDocument();
    const table = doc.addTable("T", "xy", ["X", "Series 1", "Series 2"]);
    const plot = doc.addPlot("P", table.id);
    const ed = findPreset("Editorial")!;
    expect(ed.palette[0]).toBe("#843CC0"); // the lead violet
    doc.applyStylePreset(plot.id, ed);
    const out = doc.toJSON().plots[0]!;
    const ds = tableDatasets(table);
    expect(out.seriesStyles?.[ds[0]!.id]?.color).toBe("#843CC0");
    expect(out.seriesStyles?.[ds[1]!.id]?.color).toBe("#0C9048"); // green (2nd)
    expect(out.fonts?.title?.bold).toBe(true);
    expect(out.fonts?.title?.size).toBe(26);
    expect(out.grid?.show).toBe(false);
    expect(out.frame).toBe("none");
    expect(out.titleAlign).toBe("left"); // editorial house style
    expect(out.fonts?.title?.family).toContain("Segoe UI"); // native modern sans
    // a non-editorial preset resets the alignment back to centred
    doc.applyStylePreset(plot.id, findPreset("MadY default")!);
    expect(doc.toJSON().plots[0]!.titleAlign).toBe("center");
  });

  it("setPointStyle overrides one point and clearPointStyles resets the series (undoable)", () => {
    const doc = new MadyDocument();
    const table = doc.addTable("T", "xy", ["X", "Y"]);
    const plot = doc.addPlot("P", table.id);
    const col = table.columns[1]!.id;
    doc.setPointStyle(plot.id, col, "row7", { color: "#ff0000" });
    doc.setPointStyle(plot.id, col, "row9", { color: "#00ff00" });
    expect(doc.toJSON().plots[0]!.pointStyles).toEqual({ [`${col}:row7`]: { color: "#ff0000" }, [`${col}:row9`]: { color: "#00ff00" } });
    // setting a field to undefined removes that field; emptying removes the entry
    doc.setPointStyle(plot.id, col, "row7", { color: undefined });
    expect(doc.toJSON().plots[0]!.pointStyles?.[`${col}:row7`]).toBeUndefined();
    // clear wipes every override for the series
    doc.clearPointStyles(plot.id, col);
    expect(doc.toJSON().plots[0]!.pointStyles).toBeUndefined();
    doc.commands.undo();
    expect(doc.toJSON().plots[0]!.pointStyles).toEqual({ [`${col}:row9`]: { color: "#00ff00" } });
  });

  it("setAxisTitleOffset stores a per-axis title drag offset and (0,0) clears it (undoable)", () => {
    const doc = new MadyDocument();
    const table = doc.addTable("T", "xy", ["X", "Y"]);
    const plot = doc.addPlot("P", table.id);
    doc.setAxisTitleOffset(plot.id, "x", 40, 10);
    expect(doc.toJSON().plots[0]!.xAxis?.titleOffset).toEqual({ dx: 40, dy: 10 });
    doc.setAxisTitleOffset(plot.id, "y", -8, 4);
    expect(doc.toJSON().plots[0]!.yAxis?.titleOffset).toEqual({ dx: -8, dy: 4 });
    doc.setAxisTitleOffset(plot.id, "x", 0, 0);
    expect(doc.toJSON().plots[0]!.xAxis?.titleOffset).toBeUndefined();
    doc.commands.undo();
    expect(doc.toJSON().plots[0]!.xAxis?.titleOffset).toEqual({ dx: 40, dy: 10 });
  });

  it("setLegendOffset stores a drag offset and (0,0) clears it (undoable)", () => {
    const doc = new MadyDocument();
    const table = doc.addTable("T", "xy", ["X", "Y"]);
    const plot = doc.addPlot("P", table.id);
    doc.setLegendOffset(plot.id, 40, -12);
    expect(doc.toJSON().plots[0]!.legendOffset).toEqual({ dx: 40, dy: -12 });
    doc.setLegendOffset(plot.id, 0, 0);
    expect(doc.toJSON().plots[0]!.legendOffset).toBeUndefined();
    doc.commands.undo();
    expect(doc.toJSON().plots[0]!.legendOffset).toEqual({ dx: 40, dy: -12 });
  });

  it("setGraphTitle sets/clears title alignment + footer (undoable)", () => {
    const doc = new MadyDocument();
    const table = doc.addTable("T", "xy", ["X", "Y"]);
    const plot = doc.addPlot("P", table.id);
    doc.setGraphTitle(plot.id, { titleAlign: "left", footer: { left: "Source: lab", right: "Fig 1" } });
    expect(doc.toJSON().plots[0]!.titleAlign).toBe("left");
    expect(doc.toJSON().plots[0]!.footer).toEqual({ left: "Source: lab", right: "Fig 1" });
    doc.setGraphTitle(plot.id, { footer: undefined });
    expect(doc.toJSON().plots[0]!.footer).toBeUndefined();
    doc.commands.undo();
    expect(doc.toJSON().plots[0]!.footer).toEqual({ left: "Source: lab", right: "Fig 1" });
  });

  it("merges error-bar style for a dataset (undoable)", () => {
    const doc = new MadyDocument();
    const table = doc.addTable("T", "xy", ["X", "Y"]);
    const plot = doc.addPlot("P", table.id);
    const ds = table.columns[1]!.id;
    doc.setErrorBars(plot.id, ds, { errorBars: "sem" });
    doc.setErrorBars(plot.id, ds, { errorDir: "up" });
    expect(doc.toJSON().plots[0]!.seriesStyles?.[ds]).toMatchObject({ errorBars: "sem", errorDir: "up" });
    doc.commands.undo();
    expect(doc.toJSON().plots[0]!.seriesStyles?.[ds]).toEqual({ errorBars: "sem" });
  });
});

describe("MadyDocument — analysis log", () => {
  it("appends ordered entries with refs and clears", () => {
    const doc = new MadyDocument();
    const e1 = doc.appendLog("import", "Imported data", { detail: "7×2", refKind: "table", refId: "tbl_1" });
    const e2 = doc.appendLog("analyze", "t test");
    const log = doc.toJSON().log;
    expect(log.map((l) => l.id)).toEqual([e1.id, e2.id]); // chronological
    expect(log[0]).toMatchObject({ kind: "import", label: "Imported data", refKind: "table", refId: "tbl_1" });
    doc.clearLog();
    expect(doc.toJSON().log).toEqual([]);
  });
});

describe("MadyDocument — spreadsheet editing", () => {
  it("adds a column (undoable) — a new series for graphs", () => {
    const doc = new MadyDocument();
    const table = doc.addTable("T", "xy", ["X", "Y1"]);
    const col = doc.addColumn(table.id, "Y2");
    expect(doc.toJSON().tables[0]!.columns.map((c) => c.name)).toEqual(["X", "Y1", "Y2"]);
    doc.commands.undo();
    expect(doc.toJSON().tables[0]!.columns).toHaveLength(2);
    expect(col.name).toBe("Y2");
  });

  it("renames a column — the source of truth for axis titles", () => {
    const doc = new MadyDocument();
    const table = doc.addTable("T", "xy", ["X", "Y"]);
    const xCol = table.columns[0]!;
    doc.renameColumn(table.id, xCol.id, "Dose (uM)");
    expect(doc.toJSON().tables[0]!.columns[0]!.name).toBe("Dose (uM)");
    doc.commands.undo();
    expect(doc.toJSON().tables[0]!.columns[0]!.name).toBe("X");
  });

  it("edits a cell by index, growing the grid for a spare cell", () => {
    const doc = new MadyDocument();
    const table = doc.addTable("T", "xy", ["X", "Y"]);
    doc.addRow(table.id, [1, 10]);
    // Edit a spare cell three rows down, one column past the end.
    doc.editCellAt(table.id, 3, 2, 42);
    const t = doc.toJSON().tables[0]!;
    expect(t.rows).toHaveLength(4); // grew from 1 → 4 rows
    expect(t.columns).toHaveLength(3); // grew from 2 → 3 columns
    expect(t.rows[3]!.cells[t.columns[2]!.id]).toBe(42);
    doc.commands.undo();
    const t2 = doc.toJSON().tables[0]!;
    expect(t2.rows).toHaveLength(1);
    expect(t2.columns).toHaveLength(2);
  });

  it("clears a block of cells (Cut / Delete), undoably", () => {
    const doc = new MadyDocument();
    const table = doc.addTable("T", "xy", ["X", "Y"]);
    doc.addRow(table.id, [1, 10]);
    doc.addRow(table.id, [2, 20]);
    doc.clearCells(table.id, 0, 1, 2, 1); // clear the Y cells of both rows
    const t = doc.toJSON().tables[0]!;
    expect(t.rows[0]!.cells[t.columns[1]!.id]).toBeNull();
    expect(t.rows[1]!.cells[t.columns[1]!.id]).toBeNull();
    doc.commands.undo();
    const t2 = doc.toJSON().tables[0]!;
    expect(t2.rows[0]!.cells[t2.columns[1]!.id]).toBe(10);
  });

  it("fills the top of a block down over the rest (Ctrl+D)", () => {
    const doc = new MadyDocument();
    const table = doc.addTable("T", "xy", ["X", "Y"]);
    doc.addRow(table.id, [5, 99]);
    doc.addRow(table.id, [0, 0]);
    doc.addRow(table.id, [0, 0]);
    doc.fillDown(table.id, 0, 0, 3, 2);
    const t = doc.toJSON().tables[0]!;
    expect(t.rows[1]!.cells[t.columns[0]!.id]).toBe(5);
    expect(t.rows[2]!.cells[t.columns[1]!.id]).toBe(99);
  });

  it("transposes a block in place (rows×cols → cols×rows)", () => {
    const doc = new MadyDocument();
    const table = doc.addTable("T", "grouped", ["A", "B", "C"]);
    doc.addRow(table.id, [1, 2, 3]);
    doc.addRow(table.id, [4, 5, 6]);
    // 2×3 block at (0,0) → 3×2.
    doc.transposeRange(table.id, 0, 0, 2, 3);
    const t = doc.toJSON().tables[0]!;
    const at = (r: number, c: number) => t.rows[r]!.cells[t.columns[c]!.id];
    expect([at(0, 0), at(0, 1)]).toEqual([1, 4]);
    expect([at(1, 0), at(1, 1)]).toEqual([2, 5]);
    expect([at(2, 0), at(2, 1)]).toEqual([3, 6]);
    doc.commands.undo();
    const t2 = doc.toJSON().tables[0]!;
    expect(t2.rows[1]!.cells[t2.columns[2]!.id]).toBe(6); // original restored
  });

  it("pastes a 2-D block in one undoable action, growing rows + columns", () => {
    const doc = new MadyDocument();
    const table = doc.addTable("T", "xy", ["X", "Y"]);
    doc.addRow(table.id, [0, 0]);
    const plot = doc.addPlot("P", table.id);
    doc.recompute();
    expect(doc.plotStatus(plot.id)).toBe("ok");

    doc.pasteBlock(table.id, 0, 0, [
      [1, 10, 100],
      [2, 20, 200],
      [3, 30, 300],
    ]);
    const t = doc.toJSON().tables[0]!;
    expect(t.rows).toHaveLength(3);
    expect(t.columns).toHaveLength(3); // X, Y, + new Y2
    expect(t.rows[1]!.cells[t.columns[2]!.id]).toBe(200);
    expect(doc.plotStatus(plot.id)).toBe("stale"); // data changed → dependent plot stale

    doc.commands.undo(); // a single undo reverts the whole paste
    const t2 = doc.toJSON().tables[0]!;
    expect(t2.rows).toHaveLength(1);
    expect(t2.columns).toHaveLength(2);
  });
});

describe("MadyDocument — plot config", () => {
  it("sets and clears an axis scale override (undoable)", () => {
    const doc = new MadyDocument();
    const table = doc.addTable("T", "xy", ["X", "Y"]);
    const plot = doc.addPlot("P", table.id);
    expect(doc.toJSON().plots[0]!.xScale).toBeUndefined(); // auto by default

    doc.setPlotScale(plot.id, "x", "log10");
    expect(doc.toJSON().plots[0]!.xScale).toBe("log10");

    doc.setPlotScale(plot.id, "x", "auto");
    expect(doc.toJSON().plots[0]!.xScale).toBeUndefined();

    doc.commands.undo(); // back to log10
    expect(doc.toJSON().plots[0]!.xScale).toBe("log10");
  });

  it("merges gridline style and undoes it", () => {
    const doc = new MadyDocument();
    const table = doc.addTable("T", "xy", ["X", "Y"]);
    const plot = doc.addPlot("P", table.id);
    doc.setGridStyle(plot.id, { show: false });
    doc.setGridStyle(plot.id, { width: 2 });
    expect(doc.toJSON().plots[0]!.grid).toEqual({ show: false, width: 2 });
    doc.commands.undo();
    expect(doc.toJSON().plots[0]!.grid).toEqual({ show: false });
  });

  it("merges per-series style and undoes it", () => {
    const doc = new MadyDocument();
    const table = doc.addTable("T", "xy", ["X", "Y"]);
    const yCol = table.columns[1]!;
    const plot = doc.addPlot("P", table.id);

    doc.setSeriesStyle(plot.id, yCol.id, { color: "#D55E00" });
    expect(doc.toJSON().plots[0]!.seriesStyles?.[yCol.id]?.color).toBe("#D55E00");

    doc.commands.undo();
    expect(doc.toJSON().plots[0]!.seriesStyles?.[yCol.id]).toBeUndefined();
  });
});

describe("MadyDocument — workspace tree", () => {
  it("files a new table/plot as loose, then can move them under a folder→experiment", () => {
    const doc = new MadyDocument();
    const table = doc.addTable("T", "xy", ["X", "Y"]);
    const plot = doc.addPlot("P", table.id);
    expect(doc.workspace.loose).toHaveLength(2);

    const folder = doc.addFolder("Project 1");
    const exp = doc.addExperiment(folder.id, "Experiment 1");
    const target = { level: "experiment", folderId: folder.id, experimentId: exp.id } as const;
    doc.fileObject({ kind: "table", id: table.id }, target);
    doc.fileObject({ kind: "plot", id: plot.id }, target);

    expect(doc.workspace.loose).toHaveLength(0);
    const members = doc.workspace.folders[0]!.experiments[0]!.members;
    expect(members).toEqual([
      { kind: "table", id: table.id },
      { kind: "plot", id: plot.id },
    ]);
  });

  it("keeps a ref in exactly one place when moved", () => {
    const doc = new MadyDocument();
    const table = doc.addTable("T", "xy", ["X"]);
    const folder = doc.addFolder("F");
    doc.fileObject({ kind: "table", id: table.id }, { level: "folder", folderId: folder.id });
    expect(doc.workspace.loose).toHaveLength(0);
    expect(doc.workspace.folders[0]!.members).toHaveLength(1);

    // Move it back to loose — must not duplicate.
    doc.fileObject({ kind: "table", id: table.id }, { level: "loose" });
    expect(doc.workspace.loose).toHaveLength(1);
    expect(doc.workspace.folders[0]!.members).toHaveLength(0);
  });

  it("removeFolder unfiles its objects to loose rather than deleting them", () => {
    const doc = new MadyDocument();
    const table = doc.addTable("T", "xy", ["X"]);
    const folder = doc.addFolder("F");
    const exp = doc.addExperiment(folder.id, "E");
    doc.fileObject(
      { kind: "table", id: table.id },
      { level: "experiment", folderId: folder.id, experimentId: exp.id },
    );

    doc.removeFolder(folder.id);
    expect(doc.workspace.folders).toHaveLength(0);
    expect(doc.workspace.loose).toEqual([{ kind: "table", id: table.id }]);
    expect(doc.toJSON().tables).toHaveLength(1); // entity survives
  });

  it("undoes a tree mutation", () => {
    const doc = new MadyDocument();
    doc.addFolder("F");
    expect(doc.workspace.folders).toHaveLength(1);
    doc.commands.undo();
    expect(doc.workspace.folders).toHaveLength(0);
    doc.commands.redo();
    expect(doc.workspace.folders).toHaveLength(1);
  });

  it("resolves a ref back to its entity", () => {
    const doc = new MadyDocument();
    const table = doc.addTable("T", "xy", ["X"]);
    expect(doc.resolveRef({ kind: "table", id: table.id })).toBe(
      doc.toJSON().tables[0],
    );
    expect(doc.resolveRef({ kind: "analysis", id: "nope" })).toBeUndefined();
  });
});

describe("figure link / unlink (independent panel styling)", () => {
  function setup() {
    const doc = new MadyDocument();
    const t = doc.addTable("T", "xy", ["X", "Y"]);
    doc.addRow(t.id, [1, 2]);
    const a = doc.addPlot("A", t.id);
    const b = doc.addPlot("B", t.id);
    doc.recompute();
    const lay = doc.addLayout("Fig");
    doc.addLayoutPanel(lay.id, a.id);
    doc.addLayoutPanel(lay.id, b.id);
    return { doc, t, a, b, lay };
  }

  it("unlinking clones every panel; styling a clone does not touch the source graph", () => {
    const { doc, a, lay } = setup();
    doc.setLayoutLinked(lay.id, false);
    const layout = doc.toJSON().layouts![0]!;
    expect(layout.linked).toBe(false);
    // panels now point at clones, not the originals
    expect(layout.panels).not.toContain(a.id);
    expect(Object.values(layout.panelSource!)).toContain(a.id);
    const cloneA = layout.panels[0]!;
    // style the clone — the original A is unchanged
    doc.setSeriesStyle(cloneA, "y", { color: "#ff0000" });
    expect(doc.toJSON().plots.find((p) => p.id === cloneA)!.seriesStyles?.["y"]?.color).toBe("#ff0000");
    expect(doc.toJSON().plots.find((p) => p.id === a.id)!.seriesStyles?.["y"]?.color).toBeUndefined();
    // clones are not filed in the tree (only the 2 originals are loose/filed)
    const refs = [...doc.toJSON().workspace.loose, ...doc.toJSON().workspace.folders.flatMap((f) => f.members)];
    expect(refs.some((r) => r.id === cloneA)).toBe(false);
  });

  it("re-linking restores the originals and discards the clones", () => {
    const { doc, a, b, lay } = setup();
    doc.setLayoutLinked(lay.id, false);
    const cloneIds = doc.toJSON().layouts![0]!.panels.slice();
    doc.setLayoutLinked(lay.id, true);
    const layout = doc.toJSON().layouts![0]!;
    expect(layout.linked).toBe(true);
    expect(layout.panels).toEqual([a.id, b.id]);
    expect(layout.panelSource).toBeUndefined();
    // the clone plots are gone
    for (const c of cloneIds) expect(doc.toJSON().plots.some((p) => p.id === c)).toBe(false);
  });

  it("while unlinked, including/excluding a source graph maps through the clone", () => {
    const { doc, t, a, lay } = setup();
    doc.setLayoutLinked(lay.id, false);
    const c = doc.addPlot("C", t.id);
    doc.recompute();
    doc.addLayoutPanel(lay.id, c.id); // include source C → adds a clone
    let layout = doc.toJSON().layouts![0]!;
    expect(Object.values(layout.panelSource!)).toContain(c.id);
    expect(layout.panels.length).toBe(3);
    doc.removeLayoutPanel(lay.id, c.id); // exclude by source id → removes the clone
    layout = doc.toJSON().layouts![0]!;
    expect(Object.values(layout.panelSource!)).not.toContain(c.id);
    expect(layout.panels.length).toBe(2);
    void a;
  });
});

describe("alignAnnotations — the Arrange-objects toolbar", () => {
  const setup = () => {
    const doc = new MadyDocument();
    const t = doc.importTable("T", "xy", ["X", "Y"], [[1, 2]]);
    const plot = doc.addPlot("G", t.id);
    return { doc, plot };
  };
  const anns = (doc: MadyDocument, pid: string) => doc.toJSON().plots.find((p) => p.id === pid)!.annotations ?? [];

  it("align-left moves every object's left edge to the group min (rect/text/arrow)", () => {
    const { doc, plot } = setup();
    const r = doc.addAnnotation(plot.id, { kind: "rect", x: 0.5, y: 0.2, w: 0.2, h: 0.2 });
    const tx = doc.addAnnotation(plot.id, { kind: "text", label: "hi", x: 0.3, y: 0.6 });
    const ar = doc.addAnnotation(plot.id, { kind: "arrow", x: 0.7, y: 0.8, x2: 0.9, y2: 0.85 });
    doc.alignAnnotations(plot.id, [r.id, tx.id, ar.id], "left");
    const a = anns(doc, plot.id);
    // group min-left = min(0.5, 0.3, min(0.7,0.9)=0.7) = 0.3
    expect(a.find((x) => x.id === r.id)!.x).toBeCloseTo(0.3, 10); // rect left → 0.3
    expect(a.find((x) => x.id === tx.id)!.x).toBeCloseTo(0.3, 10); // text anchor → 0.3
    const arrow = a.find((x) => x.id === ar.id)!;
    expect(Math.min(arrow.x!, arrow.x2!)).toBeCloseTo(0.3, 10); // arrow's leading end → 0.3
    expect(arrow.x2! - arrow.x!).toBeCloseTo(0.2, 10); // arrow keeps its length
  });

  it("distribute-h equalises the gaps (extremes fixed), one undo", () => {
    const { doc, plot } = setup();
    const a = doc.addAnnotation(plot.id, { kind: "rect", x: 0, y: 0, w: 0.1, h: 0.1 });
    const b = doc.addAnnotation(plot.id, { kind: "rect", x: 0.4, y: 0, w: 0.1, h: 0.1 });
    const c = doc.addAnnotation(plot.id, { kind: "rect", x: 0.9, y: 0, w: 0.1, h: 0.1 }); // right edge 1.0
    doc.alignAnnotations(plot.id, [a.id, b.id, c.id], "distribute-h");
    const g = anns(doc, plot.id);
    const xOf = (id: string) => g.find((x) => x.id === id)!.x!;
    // span 0..1, total width 0.3, gap (1-0.3)/2 = 0.35 → B.x = 0.1+0.35 = 0.45.
    expect(xOf(a.id)).toBeCloseTo(0, 10);
    expect(xOf(b.id)).toBeCloseTo(0.45, 10);
    expect(xOf(c.id)).toBeCloseTo(0.9, 10);
    doc.commands.undo();
    expect(anns(doc, plot.id).find((x) => x.id === b.id)!.x).toBeCloseTo(0.4, 10); // one undo restores all
  });

  it("equalize-w resizes rect/ellipse only, skipping text/arrow", () => {
    const { doc, plot } = setup();
    const r1 = doc.addAnnotation(plot.id, { kind: "rect", x: 0, y: 0, w: 0.1, h: 0.1 });
    const r2 = doc.addAnnotation(plot.id, { kind: "ellipse", x: 0.5, y: 0, w: 0.3, h: 0.2 });
    const tx = doc.addAnnotation(plot.id, { kind: "text", label: "t", x: 0.2, y: 0.9 });
    doc.alignAnnotations(plot.id, [r1.id, r2.id, tx.id], "equalize-w");
    const a = anns(doc, plot.id);
    expect(a.find((x) => x.id === r1.id)!.w).toBeCloseTo(0.3, 10); // grown to the max (0.3)
    expect(a.find((x) => x.id === r2.id)!.w).toBeCloseTo(0.3, 10);
    expect(a.find((x) => x.id === r1.id)!.x).toBeCloseTo(0, 10); // top-left held
    expect(a.find((x) => x.id === tx.id)!.w).toBeUndefined(); // text untouched by equalise
  });

  it("treats an image as a box: align-left + equalise-w (like rect), href preserved", () => {
    const { doc, plot } = setup();
    const im1 = doc.addAnnotation(plot.id, { kind: "image", href: "data:image/png;base64,AA==", x: 0.1, y: 0.1, w: 0.2, h: 0.2 });
    const im2 = doc.addAnnotation(plot.id, { kind: "image", href: "data:image/png;base64,BB==", x: 0.6, y: 0.5, w: 0.4, h: 0.3 });
    doc.alignAnnotations(plot.id, [im1.id, im2.id], "left");
    let a = anns(doc, plot.id);
    expect(a.find((x) => x.id === im1.id)!.x).toBeCloseTo(0.1, 10); // both left edges → group min 0.1
    expect(a.find((x) => x.id === im2.id)!.x).toBeCloseTo(0.1, 10);
    doc.alignAnnotations(plot.id, [im1.id, im2.id], "equalize-w"); // image IS sizeable
    a = anns(doc, plot.id);
    expect(a.find((x) => x.id === im1.id)!.w).toBeCloseTo(0.4, 10); // grown to the widest (0.4)
    expect(a.find((x) => x.id === im2.id)!.w).toBeCloseTo(0.4, 10);
    expect(a.find((x) => x.id === im1.id)!.href).toBe("data:image/png;base64,AA=="); // bytes untouched + round-trip through JSON
  });

  it("is a no-op for <2 arrangeable objects and skips axis-locked kinds", () => {
    const { doc, plot } = setup();
    const r = doc.addAnnotation(plot.id, { kind: "rect", x: 0.5, y: 0.5, w: 0.2, h: 0.2 });
    const hl = doc.addAnnotation(plot.id, { kind: "hline", value: 3 }); // axis-locked
    const before = JSON.stringify(anns(doc, plot.id));
    doc.alignAnnotations(plot.id, [r.id, hl.id], "left"); // only 1 arrangeable → no-op
    expect(JSON.stringify(anns(doc, plot.id))).toBe(before); // geometry byte-identical
    doc.commands.undo(); // the last executed command is still the hline add, not an arrange
    expect(anns(doc, plot.id).some((x) => x.id === hl.id)).toBe(false);
  });
});

describe("MadyDocument — saved analysis methods", () => {
  const method = (id: string, name: string) => ({ id, name, method: "ttest", columns: [0, 1], params: { variant: "welch" } });

  it("addMethod persists to project.methods (undoable) and mints unique ids", () => {
    const doc = new MadyDocument();
    const id = doc.nextMethodId();
    const id2 = doc.nextMethodId();
    expect(id).not.toBe(id2); // fresh id each call
    doc.addMethod(method(id, "My t-test"));
    expect(doc.toJSON().methods).toEqual([method(id, "My t-test")]);
    doc.commands.undo();
    expect(doc.toJSON().methods ?? []).toEqual([]); // one undo removes it
  });

  it("removeMethod deletes by id (undoable); renameMethod renames (undoable)", () => {
    const doc = new MadyDocument();
    doc.addMethod(method("m1", "A"));
    doc.addMethod(method("m2", "B"));
    doc.renameMethod("m1", "A2");
    expect(doc.toJSON().methods!.find((m) => m.id === "m1")!.name).toBe("A2");
    doc.commands.undo(); // undo the rename
    expect(doc.toJSON().methods!.find((m) => m.id === "m1")!.name).toBe("A");
    doc.removeMethod("m1");
    expect(doc.toJSON().methods!.map((m) => m.id)).toEqual(["m2"]);
    doc.commands.undo(); // restore
    expect(doc.toJSON().methods!.map((m) => m.id)).toEqual(["m1", "m2"]);
  });

  it("method ids survive a save/reload (no collision with new nodes)", () => {
    const doc = new MadyDocument();
    const mid = doc.nextMethodId();
    doc.addMethod(method(mid, "M"));
    const reloaded = new MadyDocument(JSON.parse(JSON.stringify(doc.toJSON())));
    // A newly-minted method id on the reloaded doc must not equal the existing one.
    expect(reloaded.nextMethodId()).not.toBe(mid);
  });
});

describe("MadyDocument — linked / auto-updating import", () => {
  it("setTableLink sets + clears the file link (undoable)", () => {
    const doc = new MadyDocument();
    const t = doc.importTable("T", "xy", ["X", "Y"], [[1, 2]]);
    doc.setTableLink(t.id, { path: "/data/f.csv", delimiter: "," });
    expect(doc.toJSON().tables[0]!.linkedSource).toEqual({ path: "/data/f.csv", delimiter: "," });
    doc.setTableLink(t.id, undefined);
    expect(doc.toJSON().tables[0]!.linkedSource).toBeUndefined();
    doc.commands.undo(); // undo the clear
    expect(doc.toJSON().tables[0]!.linkedSource).toEqual({ path: "/data/f.csv", delimiter: "," });
  });

  it("relinkTableData replaces rows but preserves column ids by position", () => {
    const doc = new MadyDocument();
    const t = doc.importTable("T", "xy", ["X", "Y"], [[1, 2], [3, 4]]);
    const [cX, cY] = t.columns.map((c) => c.id);
    doc.relinkTableData(t.id, { columnNames: ["X", "Y"], rows: [[10, 20], [30, 40], [50, 60]] });
    const tbl = doc.toJSON().tables[0]!;
    expect(tbl.columns.map((c) => c.id)).toEqual([cX, cY]); // ids unchanged → plots/analyses stay valid
    expect(tbl.rows.length).toBe(3);
    expect(tbl.rows[0]!.cells[cX!]).toBe(10);
    expect(tbl.rows[2]!.cells[cY!]).toBe(60);
  });

  it("relinkTableData grows to a wider file (new column id) + names follow the file", () => {
    const doc = new MadyDocument();
    const t = doc.importTable("T", "xy", ["X", "Y"], [[1, 2]]);
    const cX = t.columns[0]!.id;
    // Widening is a structural change (flagged, not auto-applied) — force to exercise the apply.
    doc.relinkTableData(t.id, { columnNames: ["Dose", "Y", "Z"], rows: [[1, 2, 3]] }, { force: true });
    const tbl = doc.toJSON().tables[0]!;
    expect(tbl.columns.length).toBe(3);
    expect(tbl.columns[0]!.id).toBe(cX); // position 0 kept its id
    expect(tbl.columns[0]!.name).toBe("Dose"); // name follows the file
    expect(tbl.columns[2]!.id).not.toBe(cX); // the new position has a fresh id
  });

  it("relinkTableData marks a dependent plot stale; one undo restores the data", () => {
    const doc = new MadyDocument();
    const t = doc.importTable("T", "xy", ["X", "Y"], [[1, 2]]);
    const cY = t.columns[1]!.id;
    const plot = doc.addPlot("G", t.id);
    doc.relinkTableData(t.id, { columnNames: ["X", "Y"], rows: [[9, 99]] });
    expect(doc.toJSON().plots.find((p) => p.id === plot.id)!.status).toBe("stale");
    doc.commands.undo();
    expect(doc.toJSON().tables[0]!.rows[0]!.cells[cY]).toBe(2); // Y restored to its original value
  });
});

describe("syncAnalysisAnnotations — significance markers bound to an analysis", () => {
  /** A plot carrying: one hand-made bracket, and two markers owned by analysis "an1". */
  const seeded = () => {
    const doc = new MadyDocument();
    const t = doc.importTable("T", "xy", ["X", "Y"], [[1, 2], [2, 4]]);
    const plot = doc.addPlot("G", t.id);
    doc.addAnnotation(plot.id, { kind: "bracket", from: 1, to: 2, label: "mine" });
    doc.addAnnotations(plot.id, [
      { kind: "bracket", from: 1, to: 2, p: 0.01, role: "significance", sig: { analysisId: "an1", term: "A vs B" } },
      { kind: "bracket", from: 2, to: 3, p: 0.04, role: "significance", sig: { analysisId: "an1", term: "B vs C" } },
    ]);
    // …and one owned by a different analysis, which must never be touched.
    doc.addAnnotations(plot.id, [
      { kind: "bracket", from: 1, to: 3, p: 0.02, role: "significance", sig: { analysisId: "an2", term: "A vs C" } },
    ]);
    return { doc, plotId: plot.id };
  };
  const annsOf = (doc: MadyDocument, plotId: string) =>
    doc.toJSON().plots.find((p) => p.id === plotId)!.annotations ?? [];

  it("replaces this analysis's markers and leaves everything else alone", () => {
    const { doc, plotId } = seeded();
    doc.syncAnalysisAnnotations(plotId, "an1", [
      { kind: "bracket", from: 1, to: 2, p: 0.0001, role: "significance", sig: { analysisId: "an1", term: "A vs B" } },
    ]);
    const anns = annsOf(doc, plotId);
    // one hand-made + one from an2 + the single new one
    expect(anns.length).toBe(3);
    expect(anns.filter((a) => a.sig?.analysisId === "an1").length).toBe(1);
    expect(anns.find((a) => a.sig?.analysisId === "an1")!.p, "the p-value was not refreshed").toBe(0.0001);
    expect(anns.some((a) => a.label === "mine"), "a hand-made bracket was swept up").toBe(true);
    expect(anns.some((a) => a.sig?.analysisId === "an2"), "another analysis's markers were swept up").toBe(true);
  });

  it("an empty list removes exactly this analysis's markers (the untick)", () => {
    const { doc, plotId } = seeded();
    doc.syncAnalysisAnnotations(plotId, "an1", []);
    const anns = annsOf(doc, plotId);
    expect(anns.filter((a) => a.sig?.analysisId === "an1").length).toBe(0);
    expect(anns.length).toBe(2); // the hand-made one + an2's
  });

  it("is one undoable step — a re-run never leaves a half-updated figure", () => {
    const { doc, plotId } = seeded();
    const before = annsOf(doc, plotId).map((a) => a.id);
    doc.syncAnalysisAnnotations(plotId, "an1", [
      { kind: "bracket", from: 1, to: 2, p: 0.5, role: "significance", sig: { analysisId: "an1", term: "A vs B" } },
    ]);
    expect(annsOf(doc, plotId).length).toBe(3);
    doc.commands.undo();
    expect(annsOf(doc, plotId).map((a) => a.id)).toEqual(before);
  });

  it("does nothing at all when there is nothing to remove and nothing to add", () => {
    const { doc, plotId } = seeded();
    doc.syncAnalysisAnnotations(plotId, "unknown-analysis", []);
    expect(annsOf(doc, plotId).length).toBe(4);
    // …and it pushed no step, so one undo still reaches the previous real edit (adding
    // an2's marker) rather than being swallowed by an empty command.
    doc.commands.undo();
    expect(annsOf(doc, plotId).some((a) => a.sig?.analysisId === "an2")).toBe(false);
    expect(annsOf(doc, plotId).length).toBe(3);
  });
});
