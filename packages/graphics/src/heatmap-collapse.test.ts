// @vitest-environment node
/**
 * Replicate collapse — the replicates of a treatment shown as one averaged row / column.
 *
 * What has to be true:
 *  • the numbers are the average of the members, and median really is the median (an outlier
 *    moves the mean and not the median — that is the whole reason both exist);
 *  • the grouping is the one the annotation strip shows, so the figure cannot average by one
 *    thing while claiming another;
 *  • the label says it is an average, because collapsing changes what the picture means;
 *  • a blank groups with nothing — two unlabelled rows are not "the same treatment";
 *  • everything downstream counts the collapsed rows/columns: the scale, the clustering, the
 *    splits and the strips;
 *  • with nothing to group by, it is refused with a warning rather than drawing the raw matrix as if
 *    it had worked.
 */
import { describe, expect, it } from "vitest";
import type { DataTable, Plot } from "@mady/core";
import { buildPlotScene } from "./buildScene";

// Six samples: three "Ctrl" replicates, three "Drug" replicates. Row 1 carries an outlier in the
// third Ctrl replicate, so mean and median must part company.
const COLS = ["c0", "c1", "c2", "c3", "c4", "c5"];
const ARM = { c0: "Ctrl", c1: "Ctrl", c2: "Ctrl", c3: "Drug", c4: "Drug", c5: "Drug" };
const VALUES: Record<string, number[]> = {
  //          Ctrl1 Ctrl2 Ctrl3        Drug1 Drug2 Drug3
  GeneA: [1, 3, 20, 10, 12, 14],
  GeneB: [2, 4, 6, 20, 22, 24],
  GeneC: [5, 5, 5, 30, 30, 30],
};
const table: DataTable = {
  id: "t", kind: "xy", name: "T",
  columns: [{ id: "g", name: "Gene" }, ...COLS.map((c, j) => ({ id: c, name: `S${j + 1}` }))],
  rows: Object.entries(VALUES).map(([gene, vals]) => ({
    id: gene, cells: Object.fromEntries([["g", gene], ...COLS.map((c, j) => [c, vals[j]!])]),
  })),
};
const SIZE = { width: 700, height: 460, measure: (t: string): number => t.length * 7 };
const ARM_TRACK = { name: "Arm", values: ARM };
const build = (heatmap: NonNullable<Plot["heatmap"]>) =>
  buildPlotScene(table, { id: "p", name: "P", source: "t", status: "ok", styleOverrides: {}, kind: "heatmap", heatmap }, SIZE);
/** Cell values by (row label, column label). */
const grid = (s: ReturnType<typeof build>): Record<string, Record<string, number | null>> => {
  const out: Record<string, Record<string, number | null>> = {};
  const rows = s.heatmap!.rowLabels.map((l) => l.label);
  const cols = s.heatmap!.colLabels.map((l) => l.label);
  for (const c of s.heatmap!.cells) {
    (out[rows[c.row]!] ??= {})[cols[c.col]!] = c.value;
  }
  return out;
};

describe("collapsing columns", () => {
  it("averages the replicates of each arm into ONE column", () => {
    const s = build({ colTracks: [ARM_TRACK], collapseCols: "mean" });
    expect(s.heatmap!.colLabels).toHaveLength(2);
    const g = grid(s);
    expect(g.GeneA!["Ctrl (mean of 3)"]).toBeCloseTo((1 + 3 + 20) / 3, 6);
    expect(g.GeneA!["Drug (mean of 3)"]).toBeCloseTo((10 + 12 + 14) / 3, 6);
    expect(g.GeneB!["Drug (mean of 3)"]).toBeCloseTo(22, 6);
  });

  it("median is really the median — the outlier moves the mean and not it", () => {
    const mean = grid(build({ colTracks: [ARM_TRACK], collapseCols: "mean" }));
    const med = grid(build({ colTracks: [ARM_TRACK], collapseCols: "median" }));
    expect(mean.GeneA!["Ctrl (mean of 3)"]).toBeCloseTo(8, 6);
    expect(med.GeneA!["Ctrl (median of 3)"]).toBe(3);
  });

  it("the label says it is an average, and by how many", () => {
    const s = build({ colTracks: [ARM_TRACK], collapseCols: "mean" });
    expect(s.heatmap!.colLabels.map((l) => l.label)).toEqual(["Ctrl (mean of 3)", "Drug (mean of 3)"]);
  });

  it("a group of ONE keeps its plain name — nothing was averaged", () => {
    const s = build({
      colTracks: [{ values: { c0: "A", c1: "B", c2: "B", c3: "B", c4: "B", c5: "B" } }],
      collapseCols: "mean",
    });
    expect(s.heatmap!.colLabels.map((l) => l.label)).toEqual(["A", "B (mean of 5)"]);
  });

  it("a blank groups with nothing — two unlabelled columns are not the same treatment", () => {
    const s = build({ colTracks: [{ values: { c0: "A", c1: "A" } }], collapseCols: "mean" });
    // A + four separate blanks
    expect(s.heatmap!.colLabels).toHaveLength(5);
    expect(s.heatmap!.colLabels[0]!.label).toBe("A (mean of 2)");
  });

  it("off (the default) leaves every column alone", () => {
    expect(build({ colTracks: [ARM_TRACK] }).heatmap!.colLabels).toHaveLength(6);
    expect(build({ colTracks: [ARM_TRACK], collapseCols: "off" }).heatmap!.colLabels).toHaveLength(6);
  });
});

describe("collapsing rows", () => {
  const rowTable: DataTable = {
    id: "tr", kind: "xy", name: "TR",
    columns: [{ id: "g", name: "Gene" }, { id: "rep", name: "Replicate of" }, { id: "v", name: "V" }, { id: "w", name: "W" }],
    rows: [
      { id: "a1", cells: { g: "A1", rep: "A", v: 2, w: 10 } },
      { id: "a2", cells: { g: "A2", rep: "A", v: 4, w: 20 } },
      { id: "b1", cells: { g: "B1", rep: "B", v: 9, w: 30 } },
    ],
  };
  const b = (heatmap: NonNullable<Plot["heatmap"]>) =>
    buildPlotScene(rowTable, { id: "p", name: "P", source: "tr", status: "ok", styleOverrides: {}, kind: "heatmap", heatmap }, SIZE);

  it("averages the rows that share a strip value", () => {
    const s = b({ rowTracks: [{ column: "rep", name: "Replicate of" }], collapseRows: "mean" });
    expect(s.heatmap!.rowLabels.map((l) => l.label)).toEqual(["A (mean of 2)", "B"]);
    const byLabel = (row: number, col: number): number | null =>
      s.heatmap!.cells.find((c) => c.row === row && c.col === col)!.value;
    expect(byLabel(0, 0)).toBeCloseTo(3, 6); // (2 + 4) / 2
    expect(byLabel(0, 1)).toBeCloseTo(15, 6);
    expect(byLabel(1, 0)).toBe(9);
  });

  it("the colour scale follows the collapsed numbers, not the raw ones", () => {
    const raw = b({ rowTracks: [{ column: "rep" }] });
    const col = b({ rowTracks: [{ column: "rep" }], collapseRows: "mean" });
    expect(raw.heatmap!.max).toBe(30);
    expect(col.heatmap!.max).toBe(30); // W of B is untouched
    expect(raw.heatmap!.min).toBe(2);
    expect(col.heatmap!.min, "the lowest cell is now the average, not the raw 2").toBe(3);
  });
});

describe("what it needs, and what it says when it does not have it", () => {
  it("with no strip to group by it is refused with a warning, and the matrix is untouched", () => {
    const s = build({ collapseCols: "mean" });
    expect(s.heatmap!.colLabels).toHaveLength(6);
    expect(s.warnings.join(" ")).toMatch(/needs a column strip saying which columns belong together/);
  });

  it("refused too when the strip groups nothing — every column already stands alone", () => {
    const s = build({ colTracks: [{ values: { c0: "a", c1: "b", c2: "c", c3: "d", c4: "e", c5: "f" } }], collapseCols: "mean" });
    expect(s.heatmap!.colLabels).toHaveLength(6);
    expect(s.warnings.join(" ")).toMatch(/at least two columns sharing a value/);
  });

  it("picks the strip it was told to, not always the first", () => {
    const two = build({
      colTracks: [
        { name: "Batch", values: { c0: "B1", c1: "B1", c2: "B1", c3: "B1", c4: "B1", c5: "B1" } },
        ARM_TRACK,
      ],
      collapseCols: "mean", collapseColsBy: 1,
    });
    expect(two.heatmap!.colLabels.map((l) => l.label)).toEqual(["Ctrl (mean of 3)", "Drug (mean of 3)"]);
  });
});

describe("everything downstream sees the collapsed matrix", () => {
  it("the strip itself shows one block per collapsed column", () => {
    const s = build({ colTracks: [ARM_TRACK], collapseCols: "mean" });
    const tr = s.heatmap!.tracks![0]!;
    expect(tr.blocks).toHaveLength(2);
    expect(tr.blocks.map((x) => x.value)).toEqual(["Ctrl", "Drug"]);
  });

  it("a second strip whose members disagree carries nothing rather than picking one", () => {
    const s = build({
      colTracks: [ARM_TRACK, { name: "Day", values: { c0: "D1", c1: "D2", c2: "D1", c3: "D3", c4: "D3", c5: "D3" } }],
      collapseCols: "mean",
    });
    const day = s.heatmap!.tracks!.find((t) => t.name === "Day")!;
    expect(day.blocks.map((b) => b.value), "Ctrl mixes D1 and D2, so it can claim neither").toEqual(["", "D3"]);
  });

  it("splits count the collapsed columns", () => {
    const s = build({ colTracks: [ARM_TRACK], collapseCols: "mean", colSplits: [{ at: 0 }] });
    expect(s.heatmap!.splits).toHaveLength(1);
    // a split after the (now non-existent) 3rd column is refused
    const bad = build({ colTracks: [ARM_TRACK], collapseCols: "mean", colSplits: [{ at: 3 }] });
    expect(bad.heatmap!.splits ?? []).toHaveLength(0);
    expect(bad.warnings.join(" ")).toMatch(/outside this heatmap \(it has 2\)/);
  });

  it("clustering runs on the collapsed matrix — two columns, one merge", () => {
    const s = build({ colTracks: [ARM_TRACK], collapseCols: "mean", cluster: "columns" });
    expect(s.heatmap!.colLabels).toHaveLength(2);
    expect(s.heatmap!.dendrograms?.col, "no column tree over the collapsed columns").toBeTruthy();
  });
});
