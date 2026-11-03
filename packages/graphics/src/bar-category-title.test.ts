/**
 * A bar chart's category axis is titled by the column that names its bars — or not at all.
 *
 * With no label column, or with the empty "Labels" column a new Column sheet starts with, the axis
 * has no title: neither "X" nor "Labels" names anything on the graph. As in the box and violin
 * charts, the groups are named on the ticks; only a label column that really names the bars titles
 * the axis. A title the user typed is kept.
 */
import { describe, expect, it } from "vitest";
import type { DataTable, Plot } from "@mady/core";
import { buildPlotScene } from "./buildScene";

const groups = ["Mix A", "Mix B", "Mix C"];
const reps = [[32, 36, 41], [33, 37, 40], [31, 38, 42]];
const columnSheet = (lead?: { name: string; values: (string | null)[] }) => ({
  id: "t", kind: "column", name: "Cubes",
  columns: [...(lead ? [{ id: "l", name: lead.name, role: "x" }] : []), ...groups.map((g, j) => ({ id: `g${j}`, name: g, role: "y" }))],
  rows: reps.map((r, i) => ({ id: `r${i}`, cells: { ...(lead ? { l: lead.values[i] } : {}), ...Object.fromEntries(r.map((v, j) => [`g${j}`, v])) } })),
}) as unknown as DataTable;
const plot = (over: Partial<Plot> = {}) => ({ id: "p", name: "B", source: "t", kind: "bar", ...over }) as unknown as Plot;
const xTitle = (t: DataTable, p = plot()) => buildPlotScene(t, p, { width: 560, height: 400 }).x.title;

describe("the bar chart's category-axis title", () => {
  it("no label column: no title, not \"X\"", () => {
    expect(xTitle(columnSheet())).toBe("");
  });

  it("an empty label column, as a new Column sheet has: no title, not \"Labels\"", () => {
    expect(xTitle(columnSheet({ name: "Labels", values: [null, null, null] }))).toBe("");
  });

  it("a label column that names the bars titles the axis", () => {
    const grouped = {
      id: "t", kind: "grouped", name: "G",
      columns: [{ id: "d", name: "Dose", role: "x" }, { id: "a", name: "Control", role: "y" }, { id: "b", name: "Treated", role: "y" }],
      rows: [["Low", 3, 5], ["High", 4, 9]].map(([d, a, b], i) => ({ id: `r${i}`, cells: { d, a, b } })),
    } as unknown as DataTable;
    expect(xTitle(grouped)).toBe("Dose");
  });

  it("a title the user typed is kept", () => {
    expect(xTitle(columnSheet(), plot({ xAxis: { title: "Concrete mix" } } as Partial<Plot>))).toBe("Concrete mix");
  });
});
