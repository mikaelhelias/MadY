// @vitest-environment node
/**
 * A drawn label must carry what it names.
 *
 * The drawn order is not the table order, in three separate ways:
 *   • clustering reorders the rows/columns;
 *   • an annotation strip takes its column out of the matrix;
 *   • a collapse joins several rows/columns into one.
 * A renderer that hands back only a position therefore makes every rename land on whatever
 * happens to sit at that index. Position-only labels fail in all three cases:
 *   clustered  → drawn [G1,G3,G5,G2,G4,G6] vs table [G1…G6]: renaming the 2nd row renames G2;
 *   strip on   → drawn ["Group","S2","S3"] vs datasets ["Group","S1","S2"]: renames S1;
 *   collapsed  → drawn ["Ctrl (mean of 2)"] vs table [G1]: renames one replicate's gene name.
 *
 * So each label carries `ids` (the source objects it stands for) and, when it names a collapsed
 * group, `groupValue` — the annotation value the group shares, which is the thing a rename
 * should change, and what the editor opens with so the "(mean of 3)" suffix is never typed back.
 */
import { describe, expect, it } from "vitest";
import { tableDatasets, xColumn } from "@mady/core";
import type { DataTable, Plot } from "@mady/core";
import { buildPlotScene } from "./buildScene";

const SIZE = { width: 700, height: 460 };
const build = (table: DataTable, heatmap: NonNullable<Plot["heatmap"]>) =>
  buildPlotScene(table, { id: "p", name: "P", source: table.id, status: "ok", styleOverrides: {}, kind: "heatmap", heatmap }, SIZE);

const plain: DataTable = {
  id: "t", kind: "xy", name: "T",
  columns: [
    { id: "g", name: "Gene" }, { id: "grp", name: "Group" },
    { id: "c0", name: "S1" }, { id: "c1", name: "S2" }, { id: "c2", name: "S3" },
  ],
  rows: ["G1", "G2", "G3", "G4"].map((g, i) => ({
    id: `r${i}`, cells: { g, grp: i < 2 ? "Ctrl" : "Treated", c0: i + 1, c1: i + 2, c2: i + 3 },
  })),
};
/** Interleaved profiles, so clustering must permute the rows (a fixture that cannot be
 *  reordered proves nothing about reordering). */
const interleaved: DataTable = {
  id: "ti", kind: "xy", name: "TI",
  columns: [{ id: "g", name: "Gene" }, { id: "c0", name: "S1" }, { id: "c1", name: "S2" }, { id: "c2", name: "S3" }, { id: "c3", name: "S4" }],
  rows: ["G1", "G2", "G3", "G4", "G5", "G6"].map((g, i) => ({
    id: `r${i}`,
    cells: Object.fromEntries([["g", g], ...[0, 1, 2, 3].map((j) => [`c${j}`, (i % 2 === 0 ? [10, 10, 1, 1] : [1, 1, 10, 10])[j]! + i * 0.01])]),
  })),
};
const labelOf = (t: DataTable, rowId: string): string => String(t.rows.find((r) => r.id === rowId)!.cells[xColumn(t)!.id]);

describe("plain heatmap", () => {
  it("every label names its own row / dataset", () => {
    const s = build(plain, {});
    s.heatmap!.rowLabels.forEach((l) => {
      expect(l.ids).toHaveLength(1);
      expect(labelOf(plain, l.ids![0]!)).toBe(l.label);
    });
    s.heatmap!.colLabels.forEach((l) => {
      expect(l.ids).toHaveLength(1);
      expect(tableDatasets(plain).find((d) => d.id === l.ids![0])!.name).toBe(l.label);
    });
    expect(s.heatmap!.rowLabels[0]!.groupValue, "nothing is collapsed here").toBeUndefined();
  });
});

describe("clustered — the drawn order is not the table order", () => {
  it("the fixture really is permuted (or this proves nothing)", () => {
    const s = build(interleaved, { cluster: "rows" });
    expect(s.heatmap!.rowLabels.map((l) => l.label)).not.toEqual(["G1", "G2", "G3", "G4", "G5", "G6"]);
  });

  it("each label still names the row it draws — not the row at that index", () => {
    const s = build(interleaved, { cluster: "rows" });
    s.heatmap!.rowLabels.forEach((l, i) => {
      expect(l.ids, `drawn row ${i} carries no identity`).toHaveLength(1);
      expect(labelOf(interleaved, l.ids![0]!), `drawn row ${i} names the wrong row`).toBe(l.label);
    });
    // …and at least one of them is not the row that shares its index (the whole point)
    const drifted = s.heatmap!.rowLabels.some((l, i) => l.ids![0] !== interleaved.rows[i]!.id);
    expect(drifted, "the fixture no longer exercises reordering").toBe(true);
  });

  it("columns too", () => {
    const s = build(interleaved, { cluster: "columns" });
    s.heatmap!.colLabels.forEach((l) => {
      expect(tableDatasets(interleaved).find((d) => d.id === l.ids?.[0])!.name).toBe(l.label);
    });
  });
});

describe("an annotation strip takes its column out of the matrix", () => {
  it("the remaining column labels still name their own datasets", () => {
    const s = build(plain, { rowTracks: [{ column: "c0" }] });
    const drawn = s.heatmap!.colLabels.map((l) => l.label);
    expect(drawn, "the strip's column must leave the matrix").not.toContain("S1");
    s.heatmap!.colLabels.forEach((l, j) => {
      const named = tableDatasets(plain).find((d) => d.id === l.ids?.[0]);
      expect(named?.name, `drawn column ${j} names the wrong dataset`).toBe(l.label);
    });
    // and the index-based reading really is wrong here — the case this guards against
    expect(tableDatasets(plain)[1]!.name).not.toBe(drawn[1]);
  });
});

describe("collapsed — one label stands for several rows", () => {
  it("a collapsed row label carries its members and the value they share", () => {
    const s = build(plain, { rowTracks: [{ column: "grp" }], collapseRows: "mean" });
    const [ctrl, treated] = s.heatmap!.rowLabels;
    expect(ctrl!.label).toBe("Ctrl (mean of 2)");
    expect(ctrl!.groupValue, "the editor must open with the VALUE, not the decorated label").toBe("Ctrl");
    expect(ctrl!.groupColumn, "a rename has to know which column holds the value").toBe("grp");
    expect(ctrl!.ids).toEqual(["r0", "r1"]);
    expect(treated!.ids).toEqual(["r2", "r3"]);
  });

  it("a collapsed column label carries its members, its value, and which strip grouped them", () => {
    const s = build(plain, {
      // Note: every matrix column needs a value, "Group" included: it is still a column here (only
      // a row strip reading it would take it out), and an unlabelled column groups with nothing,
      // so it would otherwise be the first label and this case would measure the wrong one.
      colTracks: [{ name: "Arm", values: { grp: "A", c0: "A", c1: "B", c2: "B" } }],
      collapseCols: "mean",
    });
    const [a, b] = s.heatmap!.colLabels;
    expect(a!.label).toBe("A (mean of 2)");
    expect(a!.groupValue).toBe("A");
    expect(a!.trackIndex).toBe(0);
    expect(a!.ids).toEqual(["grp", "c0"]);
    expect(b!.ids).toEqual(["c1", "c2"]);
    expect(b!.label).toBe("B (mean of 2)");
  });

  it("the second strip can be the one that groups, and the label says so", () => {
    const s = build(plain, {
      colTracks: [
        { name: "Batch", values: { grp: "X", c0: "X", c1: "X", c2: "X" } },
        { name: "Arm", values: { grp: "A", c0: "A", c1: "B", c2: "B" } },
      ],
      collapseCols: "mean", collapseColsBy: 1,
    });
    expect(s.heatmap!.colLabels[0]!.trackIndex).toBe(1);
    expect(s.heatmap!.colLabels[0]!.groupValue).toBe("A");
  });
});
