import { describe, expect, it } from "vitest";
import { MadyDocument } from "./document";
import { tableToNamedTable, recomputeDerived } from "./derive";
import type { DataTable, NodeId, TableDerivation } from "./model";

/** Read a derived table's cell at (row, col) by index, via its live column ids. */
function cellAt(table: DataTable, row: number, col: number) {
  return table.rows[row]!.cells[table.columns[col]!.id] ?? null;
}

describe("tableToNamedTable", () => {
  it("maps columns→names and rows→a column-ordered cell grid", () => {
    const table: DataTable = {
      id: "t1",
      kind: "xy",
      name: "T",
      columns: [
        { id: "c0", name: "X" },
        { id: "c1", name: "Y" },
      ],
      rows: [
        { id: "r0", cells: { c0: 1, c1: 10 } },
        { id: "r1", cells: { c0: 2, c1: 100 } },
      ],
    };
    expect(tableToNamedTable(table)).toEqual({ columnNames: ["X", "Y"], rows: [[1, 10], [2, 100]] });
  });

  it("fills missing cells with null in column order", () => {
    const table: DataTable = {
      id: "t1",
      kind: "xy",
      name: "T",
      columns: [
        { id: "c0", name: "X" },
        { id: "c1", name: "Y" },
      ],
      rows: [{ id: "r0", cells: { c0: 5 } }],
    };
    expect(tableToNamedTable(table).rows).toEqual([[5, null]]);
  });
});

describe("recomputeDerived", () => {
  it("applies a transform op (log10 of Y, X passes through)", () => {
    const derivation: TableDerivation = { source: "src", op: "transform", spec: { fn: "log10", columns: [1] } };
    const out = recomputeDerived(derivation, { columnNames: ["X", "Y"], rows: [[1, 10], [2, 100], [3, 1000]] });
    expect(out.rows).toEqual([[1, 1], [2, 2], [3, 3]]);
  });

  it("throws on an unknown op (a file from a newer version we don't understand)", () => {
    const bad = { source: "src", op: "nope", spec: {} } as unknown as TableDerivation;
    expect(() => recomputeDerived(bad, { columnNames: [], rows: [] })).toThrow(/Unknown derivation op/);
  });
});

describe("MadyDocument — reactive derived tables", () => {
  function withSource(): { doc: MadyDocument; srcId: NodeId; rowIds: NodeId[]; yColId: NodeId } {
    const doc = new MadyDocument();
    const src = doc.addTable("Src", "xy", ["X", "Y"]);
    const r0 = doc.addRow(src.id, [1, 10]);
    const r1 = doc.addRow(src.id, [2, 100]);
    return { doc, srcId: src.id, rowIds: [r0.id, r1.id], yColId: src.columns[1]!.id };
  }

  it("computes the derived grid up front and reports status ok", () => {
    const { doc, srcId } = withSource();
    const derived = doc.deriveTable("Src (log)", { source: srcId, op: "transform", spec: { fn: "log10", columns: [1] } });
    expect(cellAt(derived, 0, 0)).toBe(1); // X passes through
    expect(cellAt(derived, 0, 1)).toBe(1); // log10(10)
    expect(cellAt(derived, 1, 1)).toBe(2); // log10(100)
    expect(doc.tableStatus(derived.id)).toBe("ok");
    expect(doc.tableStatus(srcId)).toBe("ok"); // a plain source table is always "ok"
  });

  it("goes stale when the source changes and recomputes from the new values", () => {
    const { doc, srcId, rowIds, yColId } = withSource();
    const derived = doc.deriveTable("Src (log)", { source: srcId, op: "transform", spec: { fn: "log10", columns: [1] } });

    doc.setCell(srcId, rowIds[0]!, yColId, 1000);
    expect(doc.tableStatus(derived.id)).toBe("stale");

    doc.recomputeStaleDerived();
    expect(doc.tableStatus(derived.id)).toBe("ok");
    expect(cellAt(derived, 0, 1)).toBe(3); // log10(1000)
    expect(cellAt(derived, 1, 1)).toBe(2); // unchanged row still log10(100)
  });

  it("cascades through a derived-of-derived chain and settles in one pass", () => {
    const { doc, srcId, rowIds, yColId } = withSource();
    const d1 = doc.deriveTable("log", { source: srcId, op: "transform", spec: { fn: "log10", columns: [1] } });
    const d2 = doc.deriveTable("log+10", { source: d1.id, op: "transform", spec: { fn: "add-k", columns: [1], k: 10 } });

    doc.setCell(srcId, rowIds[0]!, yColId, 1000);
    expect(doc.tableStatus(d1.id)).toBe("stale");
    expect(doc.tableStatus(d2.id)).toBe("stale");

    doc.recomputeStaleDerived();
    expect(doc.tableStatus(d1.id)).toBe("ok");
    expect(doc.tableStatus(d2.id)).toBe("ok");
    expect(cellAt(d1, 0, 1)).toBe(3); // log10(1000)
    expect(cellAt(d2, 0, 1)).toBe(13); // 3 + 10
  });

  it("deletes derived descendants when the source table is removed", () => {
    const { doc, srcId } = withSource();
    const d1 = doc.deriveTable("log", { source: srcId, op: "transform", spec: { fn: "log10", columns: [1] } });
    const d2 = doc.deriveTable("log+10", { source: d1.id, op: "transform", spec: { fn: "add-k", columns: [1], k: 10 } });
    expect(doc.toJSON().tables).toHaveLength(3);

    doc.removeTable(srcId);
    expect(doc.toJSON().tables.map((t) => t.id)).not.toContain(srcId);
    expect(doc.toJSON().tables.map((t) => t.id)).not.toContain(d1.id);
    expect(doc.toJSON().tables.map((t) => t.id)).not.toContain(d2.id);
    expect(doc.toJSON().tables).toHaveLength(0);
  });

  it("keeps a reshape-derived table reactive (wide → long)", () => {
    const doc = new MadyDocument();
    const src = doc.addTable("Wide", "xy", ["id", "A", "B"]);
    const row = doc.addRow(src.id, ["x", 1, 2]);
    const long = doc.deriveTable("Wide (long)", {
      source: src.id,
      op: "reshape",
      spec: { mode: "wide-to-long", idColumns: [0], valueColumns: [1, 2], keyName: "variable", valueName: "value" },
    });
    expect(long.rows).toHaveLength(2); // one row per (id, value-column)
    expect(cellAt(long, 0, 2)).toBe(1);

    doc.setCell(src.id, row.id, src.columns[1]!.id, 99);
    expect(doc.tableStatus(long.id)).toBe("stale");
    doc.recomputeStaleDerived();
    expect(cellAt(long, 0, 2)).toBe(99);
  });

  it("keeps a frequency-derived table reactive (re-bins on source edit)", () => {
    const doc = new MadyDocument();
    const src = doc.addTable("S", "xy", ["X", "Y"]);
    const r0 = doc.addRow(src.id, [1, 10]);
    doc.addRow(src.id, [2, 20]);
    doc.addRow(src.id, [3, 30]);
    const freq = doc.deriveTable("freq", { source: src.id, op: "frequency", spec: { col: 1, mode: "count", bins: 3 } });
    expect(freq.columns[0]!.name).toContain("Y"); // bin-centre column labelled from the source column
    expect(freq.rows.length).toBeGreaterThan(0);

    doc.setCell(src.id, r0.id, src.columns[1]!.id, 1000);
    expect(doc.tableStatus(freq.id)).toBe("stale");
    doc.recomputeStaleDerived();
    expect(doc.tableStatus(freq.id)).toBe("ok");
  });

  it("keeps a QQ-derived table reactive (re-orders on source edit)", () => {
    const doc = new MadyDocument();
    const src = doc.addTable("S", "xy", ["X", "Y"]);
    const r0 = doc.addRow(src.id, [1, 2]);
    doc.addRow(src.id, [2, 4]);
    doc.addRow(src.id, [3, 6]);
    const qq = doc.deriveTable("qq", { source: src.id, op: "qq", spec: { col: 1, position: "blom" } });
    expect(qq.columns.map((c) => c.name)).toEqual(["Normal quantile (z)", "Y (ordered)", "Reference line"]);
    expect(qq.rows).toHaveLength(3);

    doc.setCell(src.id, r0.id, src.columns[1]!.id, 100);
    expect(doc.tableStatus(qq.id)).toBe("stale");
    doc.recomputeStaleDerived();
    expect(doc.tableStatus(qq.id)).toBe("ok");
  });
});

describe("recomputeDerived — reshape / frequency / qq", () => {
  it("reshape wide→long unpivots value columns", () => {
    const out = recomputeDerived(
      { source: "s", op: "reshape", spec: { mode: "wide-to-long", idColumns: [0], valueColumns: [1, 2], keyName: "variable", valueName: "value" } },
      { columnNames: ["id", "A", "B"], rows: [["x", 1, 2], ["y", 3, 4]] },
    );
    expect(out.columnNames).toEqual(["id", "variable", "value"]);
    expect(out.rows).toEqual([["x", "A", 1], ["x", "B", 2], ["y", "A", 3], ["y", "B", 4]]);
  });

  it("frequency bins a column and totals to n", () => {
    const out = recomputeDerived(
      { source: "s", op: "frequency", spec: { col: 1, mode: "count", bins: 2 } },
      { columnNames: ["X", "Y"], rows: [[1, 1], [2, 2], [3, 3], [4, 4]] },
    );
    expect(out.columnNames[0]).toBe("Y (bin centre)");
    const totalCount = out.rows.reduce((a, r) => a + (typeof r[1] === "number" ? r[1] : 0), 0);
    expect(totalCount).toBe(4);
  });

  it("frequency with ≥2 cols → per-column counts on a SHARED grid (per-subcolumn)", () => {
    const out = recomputeDerived(
      { source: "s", op: "frequency", spec: { col: 1, cols: [1, 2], mode: "width", binWidth: 4 } },
      { columnNames: ["X", "A", "B"], rows: [[0, 0, 4], [1, 1, 5], [2, 2, 6], [3, 3, 7]] },
    );
    expect(out.columnNames).toEqual(["Bin centre", "A", "B"]); // one count column per input column
    expect(out.rows).toEqual([[2, 4, 0], [6, 0, 4]]); // A in the low bin, B in the high bin — same grid
  });

  it("qq pairs ordered values with normal quantiles", () => {
    const out = recomputeDerived(
      { source: "s", op: "qq", spec: { col: 1, position: "blom" } },
      { columnNames: ["X", "Y"], rows: [[1, 8], [2, 4], [3, 6], [4, 2]] },
    );
    expect(out.columnNames).toEqual(["Normal quantile (z)", "Y (ordered)", "Reference line"]);
    expect(out.rows).toHaveLength(4);
    expect(out.rows[0]![1]).toBe(2); // smallest value first (sorted)
  });

  it("frequency exact mode = unbinned ECDF; fractions add fraction columns", () => {
    const exact = recomputeDerived(
      { source: "s", op: "frequency", spec: { col: 1, mode: "exact" } },
      { columnNames: ["X", "Y"], rows: [[1, 1], [2, 2], [3, 2], [4, 3]] },
    );
    expect(exact.columnNames).toEqual(["Y", "Cumulative count", "Cumulative fraction", "Cumulative %"]);
    expect(exact.rows).toEqual([[1, 1, 0.25, 25], [2, 3, 0.75, 75], [3, 4, 1, 100]]);
    const frac = recomputeDerived(
      { source: "s", op: "frequency", spec: { col: 1, mode: "count", bins: 2, fractions: true } },
      { columnNames: ["X", "Y"], rows: [[1, 1], [2, 2], [3, 3], [4, 4]] },
    );
    expect(frac.columnNames).toContain("Relative fraction");
    expect(frac.columnNames).toContain("Cumulative fraction");
  });

  it("frequency gaussian overlay appends expected-frequency columns from the data's normal", () => {
    const src = { columnNames: ["X", "Y"], rows: [[1, 1], [2, 2], [3, 3], [4, 4], [5, 5], [6, 6]] };
    const out = recomputeDerived({ source: "s", op: "frequency", spec: { col: 1, mode: "count", bins: 3, gaussian: true } }, src);
    expect(out.columnNames).toContain("Expected count");
    expect(out.columnNames).toContain("Expected %");
    // The expected counts total ≈ the mass the bins cover (≤ n = 6, > 0).
    const ec = out.columnNames.indexOf("Expected count");
    const totalExp = out.rows.reduce((a, r) => a + (typeof r[ec] === "number" ? (r[ec] as number) : 0), 0);
    expect(totalExp).toBeGreaterThan(0);
    expect(totalExp).toBeLessThanOrEqual(6.0001);
    // Off by default (no gaussian flag).
    const off = recomputeDerived({ source: "s", op: "frequency", spec: { col: 1, mode: "count", bins: 3 } }, src);
    expect(off.columnNames).not.toContain("Expected count");
  });

  it("qq lognormal variant runs the QQ on log(values)", () => {
    const out = recomputeDerived(
      { source: "s", op: "qq", spec: { col: 1, position: "blom", variant: "lognormal" } },
      { columnNames: ["X", "Y"], rows: [[1, Math.E], [2, Math.E ** 2], [3, Math.E ** 3], [4, 1]] },
    );
    expect(out.rows).toHaveLength(4);
    expect(out.rows[0]![1]).toBeCloseTo(1, 6); // smallest original value first (e⁰ = 1)
  });

  it("simulate op generates a seeded table deterministically, ignoring the source", () => {
    const der: TableDerivation = {
      source: "",
      op: "simulate",
      spec: { kind: "xy", seed: 5, xStart: 0, xEnd: 4, xCount: 5, equation: "line", params: [2, 1] },
    };
    const a = recomputeDerived(der, { columnNames: [], rows: [] });
    const b = recomputeDerived(der, { columnNames: ["ignored"], rows: [[9]] }); // a different "source" → same output
    expect(a).toEqual(b);
    expect(a.columnNames).toEqual(["X", "Y"]);
    expect(a.rows[2]).toEqual([2, 5]); // x = 2 → 2·2 + 1 = 5 (no noise)
  });
});
