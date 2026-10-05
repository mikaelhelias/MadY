// `resolveOverlays`: join columns from other datasheets into the
// plot's table at the build choke point.
//
// Join rule: continuous X (xy/area) merges rows by exact numeric X, a foreign X no local row has
// becomes its own row; categorical X (bar) joins by category label, unmatched labels are skipped
// with a warning (appending would reorder every styled bar). Dangling references warn, never
// throw, never silently vanish. Kinds without a shared axis refuse.
import { describe, expect, it } from "vitest";
import type { DataTable, Plot } from "./model";
import { resolveOverlays } from "./overlays";
import { tableDatasets } from "./dataset";

const local: DataTable = {
  id: "A", kind: "xy", name: "Sheet A",
  columns: [
    { id: "ax", name: "Dose", role: "x" },
    { id: "ay", name: "Response", role: "y" },
  ],
  rows: [
    { id: "a1", cells: { ax: 1, ay: 10 } },
    { id: "a2", cells: { ax: 2, ay: 20 } },
    { id: "a3", cells: { ax: 3, ay: 30 } },
  ],
};
const foreign: DataTable = {
  id: "B", kind: "xy", name: "Sheet B",
  columns: [
    { id: "bx", name: "Dose", role: "x" },
    { id: "by", name: "Model", role: "y" },
    { id: "by2", name: "Model", role: "y", group: "by" },
    { id: "bz", name: "Other", role: "y" },
  ],
  rows: [
    { id: "b1", cells: { bx: 2, by: 21, by2: 19, bz: 5 } },
    { id: "b2", cells: { bx: 4, by: 40, by2: 42, bz: 6 } },
  ],
  excluded: { b2: ["by"] },
};
const lookup = (id: string): DataTable | undefined => ({ A: local, B: foreign })[id];
const plot = (over: Partial<Plot> = {}): Plot => ({ id: "p", name: "P", source: "A", kind: "xy", ...over }) as Plot;

describe("resolveOverlays — continuous X (xy)", () => {
  it("no overlays → the same table object, no warnings, nothing foreign", () => {
    const r = resolveOverlays(local, plot(), lookup);
    expect(r.table).toBe(local);
    expect(r.warnings).toEqual([]);
    expect(r.foreign.size).toBe(0);
  });

  it("joins the foreign dataset (lead + its replicate columns) by numeric X; an unmatched X becomes its own row", () => {
    const r = resolveOverlays(local, plot({ overlays: [{ id: "o1", table: "B", column: "by" }] }), lookup);
    expect(r.warnings).toEqual([]);
    // columns: the local ones, then the foreign dataset's own columns (lead + replicate), NOT bz
    expect(r.table.columns.map((c) => c.id)).toEqual(["ax", "ay", "by", "by2"]);
    // x=2 merged into a2; x=4 appended as a new row carrying its foreign row id
    const a2 = r.table.rows.find((row) => row.id === "a2")!;
    expect(a2.cells).toEqual({ ax: 2, ay: 20, by: 21, by2: 19 });
    const b2 = r.table.rows.find((row) => row.id === "b2")!;
    expect(b2.cells.ax).toBe(4);
    expect(b2.cells.ay ?? null).toBeNull();
    // the foreign sheet's own exclusion is honoured before the join (b2.by was excluded)
    expect(b2.cells.by ?? null).toBeNull();
    expect(b2.cells.by2).toBe(42);
    expect(r.table.rows.map((row) => row.id)).toEqual(["a1", "a2", "a3", "b2"]);
    // the foreign series is an ordinary dataset downstream, with replicates
    const ds = tableDatasets(r.table).find((d) => d.id === "by")!;
    expect(ds.replicates).toEqual(["by", "by2"]);
    expect(r.foreign.get("by")).toEqual({ table: "B", name: "Sheet B" });
    // the local table is not mutated
    expect(local.columns).toHaveLength(2);
    expect(local.rows).toHaveLength(3);
  });

  it("dangling references warn (table gone, column gone) and the rest still joins", () => {
    const r = resolveOverlays(
      local,
      plot({ overlays: [{ id: "o1", table: "ZZ", column: "by" }, { id: "o2", table: "B", column: "nope" }, { id: "o3", table: "B", column: "bz" }] }),
      lookup,
    );
    expect(r.warnings).toHaveLength(2);
    expect(r.warnings[0]).toMatch(/datasheet .*no longer exists|was deleted/i);
    expect(r.warnings[1]).toMatch(/column/i);
    expect(r.table.columns.map((c) => c.id)).toEqual(["ax", "ay", "bz"]);
  });

  it("refuses an overlay whose foreign sheet has no X column to join on", () => {
    const noX: DataTable = { id: "C", kind: "column", name: "Groups", columns: [{ id: "c1", name: "G1", role: "y" }], rows: [{ id: "r", cells: { c1: 1 } }] };
    const r = resolveOverlays(local, plot({ overlays: [{ id: "o", table: "C", column: "c1" }] }), (id) => (id === "C" ? noX : lookup(id)));
    expect(r.table.columns).toHaveLength(2);
    expect(r.warnings.some((w) => /no X column|nothing to join/i.test(w))).toBe(true);
  });
});

describe("resolveOverlays — categorical X (bar)", () => {
  const bars: DataTable = {
    id: "A", kind: "grouped", name: "Sheet A",
    columns: [
      { id: "ax", name: "Group", role: "x" },
      { id: "ay", name: "Mean", role: "y" },
    ],
    rows: [
      { id: "a1", cells: { ax: "Ctrl", ay: 10 } },
      { id: "a2", cells: { ax: "Low", ay: 20 } },
      { id: "a3", cells: { ax: "High", ay: 30 } },
    ],
  };
  const other: DataTable = {
    id: "B", kind: "grouped", name: "Sheet B",
    columns: [
      { id: "bx", name: "Group", role: "x" },
      { id: "by", name: "Rate", role: "y" },
    ],
    rows: [
      { id: "b1", cells: { bx: "High", by: 3 } },
      { id: "b2", cells: { bx: "Ctrl", by: 1 } },
      { id: "b3", cells: { bx: "Extra", by: 9 } },
    ],
  };
  const lk = (id: string): DataTable | undefined => ({ A: bars, B: other })[id];

  it("joins by category label in the local order; an unmatched foreign label is skipped and named in a warning", () => {
    const r = resolveOverlays(bars, plot({ kind: "bar", overlays: [{ id: "o", table: "B", column: "by" }] }), lk);
    expect(r.table.rows.map((row) => row.id)).toEqual(["a1", "a2", "a3"]);
    expect(r.table.rows.map((row) => row.cells.by ?? null)).toEqual([1, null, 3]);
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0]).toMatch(/Extra/);
    expect(r.warnings[0]).toMatch(/not on this axis|no such category/i);
  });
});

describe("resolveOverlays — kinds without a shared axis refuse", () => {
  it("a histogram / pie carrying an overlay draws without it and says why", () => {
    for (const kind of ["histogram", "pie"] as const) {
      const r = resolveOverlays(local, plot({ kind, overlays: [{ id: "o", table: "B", column: "by" }] }), lookup);
      expect(r.table.columns).toHaveLength(2);
      expect(r.warnings.some((w) => /cannot take a series from another datasheet|no shared axis/i.test(w)), kind).toBe(true);
    }
  });
});
