/**
 * A 3-D scatter draws the columns chosen for X, Y and Z.
 *
 * X column · Y column · Z column choose them, so a sheet with a name column first, or with four measures, can show
 * the measures wanted. Unset, each falls back to the first, second and third column, so a saved graph that never
 * chose keeps its columns.
 */
import { describe, expect, it } from "vitest";
import type { DataTable, Plot } from "@mady/core";
import { buildPlotScene, scatter3dColumns } from "./buildScene";

const table = {
  id: "t", kind: "multivariable", name: "Penguins",
  columns: [{ id: "n", name: "Bird" }, { id: "b", name: "Bill (mm)" }, { id: "f", name: "Flipper (mm)" }, { id: "m", name: "Mass (g)" }],
  rows: [["P1", 39, 181, 3750], ["P2", 46, 210, 4500], ["P3", 50, 222, 5600], ["P4", 37, 186, 3450]].map(([n, b, f, m], i) => ({ id: `r${i}`, cells: { n, b, f, m } })),
} as unknown as DataTable;
const plot = (s3?: Record<string, string>) => ({ id: "p", name: "P", source: "t", kind: "scatter3d", ...(s3 ? { scatter3d: s3 } : {}) }) as unknown as Plot;
const scene = (s3?: Record<string, string>) => buildPlotScene(table, plot(s3), { width: 600, height: 460 });

describe("scatter3dColumns", () => {
  it("unset: the first, second and third column", () => {
    const c = scatter3dColumns(table, plot());
    expect([c.x?.id, c.y?.id, c.z?.id]).toEqual(["n", "b", "f"]);
  });
  it("chosen: those; an id that is gone falls back to the position", () => {
    const c = scatter3dColumns(table, plot({ xColumn: "b", yColumn: "m", zColumn: "gone" }));
    expect([c.x?.id, c.y?.id, c.z?.id]).toEqual(["b", "m", "f"]);
  });
});

describe("3-D scatter with chosen columns", () => {
  it("a name column first and nothing chosen: no points, and the warning names the three pickers", () => {
    const s = scene();
    expect(s.scatter3d!.points).toHaveLength(0);
    expect(s.warnings.join(" ")).toMatch(/3-D scatter › X column, Y column and Z column/);
  });

  it("the chosen columns are drawn: every row a point, with their values, and the axes named after them", () => {
    const s = scene({ xColumn: "b", yColumn: "f", zColumn: "m" });
    expect(s.scatter3d!.points).toHaveLength(4);
    const p1 = s.scatter3d!.points.find((p) => p.rowId === "r0")!;
    expect(p1.value).toEqual({ x: 39, y: 181, z: 3750 });
    expect(s.scatter3d!.axes.map((a) => a.label)).toEqual(["Bill (mm)", "Flipper (mm)", "Mass (g)"]);
    expect(s.warnings.filter((w) => /No finite/.test(w))).toEqual([]);
  });

  it("the point style follows the Y column", () => {
    expect(scene({ xColumn: "b", yColumn: "m", zColumn: "f" }).scatter3d!.seriesId).toBe("m");
  });
});
