import { describe, expect, it } from "vitest";
import type { DataTable } from "./model";
import { xyExcludedRows } from "./analysisData";

const table = (rows: Array<Record<string, unknown>>, extraCols: Array<{ id: string; name: string; role?: string; group?: string }> = []): DataTable =>
  ({
    id: "t", kind: "xy", name: "T",
    columns: [{ id: "x", name: "X" }, { id: "y", name: "Y", role: "y" }, ...extraCols],
    rows: rows.map((cells, i) => ({ id: `r${i}`, cells })),
  }) as unknown as DataTable;

describe("xyExcludedRows", () => {
  it("counts rows where exactly one of X / Y is present", () => {
    const t = table([
      { x: 1, y: 10 }, // used
      { x: 2, y: null }, // X only → excluded
      { x: null, y: 30 }, // Y only → excluded
      { x: 4, y: 40 }, // used
    ]);
    expect(xyExcludedRows(t, "x", "y")).toBe(2);
  });

  it("does not count a fully-blank row (it is empty, not excluded)", () => {
    const t = table([{ x: 1, y: 10 }, { x: null, y: null }, { x: "", y: "" }]);
    expect(xyExcludedRows(t, "x", "y")).toBe(0);
  });

  it("treats a row as USED when any replicate Y is present", () => {
    // Y has a replicate subcolumn y2; a row with X and only y2 filled is still used.
    const t = table(
      [{ x: 1, y: null, y2: 11 }, { x: 2, y: null, y2: null }],
      [{ id: "y2", name: "Y2", role: "y", group: "y" }],
    );
    // Row 1: X + y2 → used. Row 2: X only → excluded.
    expect(xyExcludedRows(t, "x", "y")).toBe(1);
  });

  it("is zero for a complete table", () => {
    expect(xyExcludedRows(table([{ x: 1, y: 2 }, { x: 3, y: 4 }]), "x", "y")).toBe(0);
  });
});
