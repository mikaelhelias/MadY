/**
 * A treemap says how it read the sheet when that is not what the sheet looks like.
 *
 * A treemap reads a Parts of whole sheet as one cell per row; any other sheet is drawn one cell per
 * value column unless Treemap › One cell per is set to Row. A Division / Department / Team / Budget
 * sheet therefore comes out as one cell, and a group-by column set on it is not used. The warnings
 * say both, and name the control that draws one cell per row.
 */
import { describe, expect, it } from "vitest";
import type { DataTable, Plot } from "@mady/core";
import { buildPlotScene } from "./buildScene";

const rows = [["Research", "Biology", "Cell lab", 820], ["Research", "Chemistry", "Synthesis", 510], ["Operations", "IT", "Servers", 290], ["Admin", "HR", "Training", 48]];
const sheet = (kind: string, cols: Array<{ id: string; name: string; role?: string }>, data: unknown[][]) =>
  ({ id: "t", kind, name: "Budget", columns: cols, rows: data.map((r, i) => ({ id: `r${i}`, cells: Object.fromEntries(cols.map((c, j) => [c.id, r[j]])) })) }) as unknown as DataTable;
const hierarchy = sheet("multivariable", [{ id: "d", name: "Division", role: "x" }, { id: "p", name: "Department", role: "x" }, { id: "t", name: "Team", role: "x" }, { id: "b", name: "Budget", role: "y" }], rows);
const plot = (treemap: Record<string, unknown> = {}) => ({ id: "p", name: "T", source: "t", kind: "treemap", treemap }) as unknown as Plot;
const build = (t: DataTable, p: Plot) => buildPlotScene(t, p, { width: 560, height: 420 });

describe("the treemap says how it read the sheet", () => {
  it("a hierarchy sheet with one value column: one cell, and the warning says why and what to do", () => {
    const s = build(hierarchy, plot());
    expect(s.warnings.some((w) => /single cell/.test(w) && /Treemap › One cell per › Row/.test(w))).toBe(true);
  });

  it("a group-by column on that sheet is reported as not used", () => {
    const s = build(hierarchy, plot({ groupColumn: "d" }));
    expect(s.warnings.some((w) => /Colour by group/.test(w) && /not used/.test(w))).toBe(true);
  });

  it("a Parts of whole sheet: one cell per row, grouped, and no such warning", () => {
    const pow = sheet("partsofwhole", [{ id: "t", name: "Team", role: "x" }, { id: "b", name: "Budget", role: "y" }, { id: "d", name: "Division" }], rows.map((r) => [r[2], r[3], r[0]]));
    const s = build(pow, plot({ groupColumn: "d" }));
    expect(s.warnings.filter((w) => /single cell|Colour by group/.test(w))).toEqual([]);
  });

  it("a Column sheet with three groups: three cells, no warning about it", () => {
    const col = sheet("column", [{ id: "a", name: "A", role: "y" }, { id: "b", name: "B", role: "y" }, { id: "c", name: "C", role: "y" }], [[1, 2, 3], [4, 5, 6]]);
    const s = build(col, plot());
    expect(s.warnings.filter((w) => /single cell/.test(w))).toEqual([]);
  });
});
