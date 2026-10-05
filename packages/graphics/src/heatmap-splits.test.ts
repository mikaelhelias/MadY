// @vitest-environment node
/**
 * Split heatmaps — the matrix cut into blocks.
 *
 * What has to be true of the geometry, and is asserted here:
 *  • the space a split opens comes out of the plot, so the matrix still fills its box exactly
 *    and every cell stays the same size as its neighbours (a split must not squash one block);
 *  • labels and dendrogram leaves move with their cells — they go through the same two
 *    position functions, and this proves they did not drift;
 *  • a rule-only split takes no space at all;
 *  • each split's look falls back to the chart-wide default field by field, which is what makes
 *    "change every break at once, or just this one" true rather than a claim;
 *  • a split outside the matrix is refused with a warning, not silently dropped.
 */
import { describe, expect, it } from "vitest";
import type { DataTable, HeatSplit, Plot } from "@mady/core";
import { buildPlotScene } from "./buildScene";

const ROWS = ["GeneA", "GeneB", "GeneC", "GeneD", "GeneE", "GeneF"];
const COLS = ["Ctrl", "DrugA", "DrugB", "DrugC"];
const table: DataTable = {
  id: "t", kind: "xy", name: "T",
  columns: [{ id: "g", name: "Gene" }, ...COLS.map((c, j) => ({ id: `c${j}`, name: c }))],
  rows: ROWS.map((name, i) => ({
    id: `r${i}`,
    cells: Object.fromEntries([["g", name], ...COLS.map((_c, j) => [`c${j}`, (i + 1) * (j + 2)])]),
  })),
};
const SIZE = { width: 640, height: 460, measure: (t: string): number => t.length * 7 };
const build = (heatmap: NonNullable<Plot["heatmap"]>) =>
  buildPlotScene(table, { id: "p", name: "P", source: "t", status: "ok", styleOverrides: {}, kind: "heatmap", heatmap }, SIZE);

const cellsOf = (h: NonNullable<Plot["heatmap"]>) => build(h).heatmap!.cells;
const round = (n: number): number => Math.round(n * 100) / 100;

describe("the space a split opens", () => {
  it("comes out of the plot — every cell keeps one size, and the matrix still fills its box", () => {
    const plain = build({});
    const split = build({ rowSplits: [{ at: 2 }], splitGap: 20 });
    const p = plain.heatmap!.cells;
    const s = split.heatmap!.cells;

    // one cell size across the whole matrix, both before and after
    expect(new Set(s.map((c) => round(c.h))).size).toBe(1);
    // rows are shorter by exactly the gap, shared out
    expect(round(p[0]!.h - s[0]!.h)).toBe(round(20 / 6));
    // and the matrix still ends where the plot ends
    const box = split.plot;
    const last = s[s.length - 1]!;
    expect(round(last.y + last.h)).toBe(round(box.y + box.height));
    expect(round(s[0]!.y)).toBe(round(box.y));
  });

  it("opens exactly where it was placed, and nowhere else", () => {
    const s = cellsOf({ rowSplits: [{ at: 2 }], splitGap: 20 });
    const rowTop = (i: number): number => s.find((c) => c.row === i && c.col === 0)!.y;
    const h = s[0]!.h;
    // rows 0→1 and 1→2 are flush; 2→3 carries the gap; 3→4 flush again
    expect(round(rowTop(1) - rowTop(0))).toBe(round(h));
    expect(round(rowTop(2) - rowTop(1))).toBe(round(h));
    expect(round(rowTop(3) - rowTop(2))).toBe(round(h + 20));
    expect(round(rowTop(4) - rowTop(3))).toBe(round(h));
  });

  it("takes several splits on one axis, and both axes at once", () => {
    const s = cellsOf({ rowSplits: [{ at: 1 }, { at: 3 }], colSplits: [{ at: 0 }], splitGap: 10 });
    const rowTop = (i: number): number => s.find((c) => c.row === i && c.col === 0)!.y;
    const colLeft = (j: number): number => s.find((c) => c.row === 0 && c.col === j)!.x;
    const ch = s[0]!.h;
    const cw = s[0]!.w;
    expect(round(rowTop(2) - rowTop(1))).toBe(round(ch + 10));
    expect(round(rowTop(4) - rowTop(3))).toBe(round(ch + 10));
    expect(round(rowTop(3) - rowTop(2))).toBe(round(ch));
    expect(round(colLeft(1) - colLeft(0))).toBe(round(cw + 10));
    expect(round(colLeft(2) - colLeft(1))).toBe(round(cw));
  });

  it("a rule-only split takes no space — the cells do not move at all", () => {
    const plain = cellsOf({});
    const ruled = cellsOf({ rowSplits: [{ at: 2 }], splitStyle: "line" });
    expect(ruled.map((c) => round(c.y))).toEqual(plain.map((c) => round(c.y)));
    expect(ruled.map((c) => round(c.h))).toEqual(plain.map((c) => round(c.h)));
  });
});

describe("everything that sits beside the cells moves with them", () => {
  it("row labels stay centred on their own row", () => {
    const s = build({ rowSplits: [{ at: 2 }], splitGap: 24 });
    const cells = s.heatmap!.cells;
    s.heatmap!.rowLabels.forEach((lab, i) => {
      const cell = cells.find((c) => c.row === i && c.col === 0)!;
      expect(round(lab.y), `row label ${i} drifted off its row`).toBe(round(cell.y + cell.h / 2));
    });
  });

  it("column labels stay centred on their own column", () => {
    const s = build({ colSplits: [{ at: 1 }], splitGap: 24 });
    const cells = s.heatmap!.cells;
    s.heatmap!.colLabels.forEach((lab, j) => {
      const cell = cells.find((c) => c.row === 0 && c.col === j)!;
      expect(round(lab.x), `column label ${j} drifted off its column`).toBe(round(cell.x + cell.w / 2));
    });
  });

  it("the dendrogram's leaves land on the split rows, not on their unsplit positions", () => {
    const tree = build({ cluster: "rows", showDendrogram: true, rowSplits: [{ at: 2 }], splitGap: 30 });
    const path = tree.heatmap!.dendrograms?.row;
    expect(path, "no row dendrogram").toBeTruthy();
    const ys = [...path!.matchAll(/[ML]\s*(-?[\d.]+),(-?[\d.]+)/g)].map((m) => Number(m[2]));
    const cells = tree.heatmap!.cells;
    const centres = [...new Set(cells.map((c) => round(c.y + c.h / 2)))];
    // every leaf tip is on some row's centre line (within half a pixel)
    const tips = ys.filter((y) => centres.some((c) => Math.abs(c - y) < 0.6));
    expect(tips.length, "the tree's leaves no longer meet the rows").toBeGreaterThan(3);
    // and the tree spans the gap: its extent covers more than the un-split matrix would
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(0);
  });
});

describe("all breaks, or just one", () => {
  const two: HeatSplit[] = [{ at: 1 }, { at: 3 }];

  it("both breaks follow the chart-wide setting", () => {
    const s = build({ rowSplits: two, splitStyle: "both", splitGap: 12, splitLineWidth: 3, splitColor: "#ff0000" });
    expect(s.heatmap!.splits).toHaveLength(2);
    for (const sp of s.heatmap!.splits!) {
      expect(sp.gap).toBe(12);
      expect(sp.lineWidth).toBe(3);
      expect(sp.color).toBe("#ff0000");
    }
  });

  it("one break can depart from it — field by field — and the other does not follow", () => {
    const s = build({
      rowSplits: [{ at: 1 }, { at: 3, gap: 40, color: "#0000ff" }],
      splitStyle: "both", splitGap: 12, splitLineWidth: 3, splitColor: "#ff0000",
    });
    const [a, b] = s.heatmap!.splits!;
    expect(a!.gap).toBe(12);
    expect(b!.gap).toBe(40);
    expect(b!.color).toBe("#0000ff");
    // …and the fields it did not override still follow the shared setting
    expect(b!.lineWidth).toBe(3);
  });

  it("changing the shared setting moves every break that has not overridden", () => {
    const before = build({ rowSplits: two, splitGap: 8 }).heatmap!.splits!.map((s) => s.gap);
    const after = build({ rowSplits: two, splitGap: 30 }).heatmap!.splits!.map((s) => s.gap);
    expect(before).toEqual([8, 8]);
    expect(after).toEqual([30, 30]);
  });

  it("a per-break style decides which number applies to that break alone", () => {
    const s = build({
      rowSplits: [{ at: 1, style: "line" }, { at: 3, style: "gap" }],
      splitGap: 16, splitLineWidth: 2,
    });
    const [line, gap] = s.heatmap!.splits!;
    expect(line!.gap, "a rule takes no space").toBe(0);
    expect(line!.lineWidth).toBe(2);
    expect(gap!.gap).toBe(16);
    expect(gap!.lineWidth, "a space draws no rule").toBe(0);
  });
});

describe("what the renderer is handed", () => {
  it("a row split spans the plot horizontally, a column split vertically", () => {
    const s = build({ rowSplits: [{ at: 2 }], colSplits: [{ at: 1 }], splitStyle: "both" });
    const box = s.plot;
    const row = s.heatmap!.splits!.find((x) => x.axis === "row")!;
    const col = s.heatmap!.splits!.find((x) => x.axis === "col")!;
    expect(row.y1).toBe(row.y2);
    expect([round(row.x1), round(row.x2)]).toEqual([round(box.x), round(box.x + box.width)]);
    expect(col.x1).toBe(col.x2);
    expect([round(col.y1), round(col.y2)]).toEqual([round(box.y), round(box.y + box.height)]);
  });

  it("a rule sits in the middle of the space its own split opened", () => {
    const s = build({ rowSplits: [{ at: 2 }], splitStyle: "both", splitGap: 20 });
    const cells = s.heatmap!.cells;
    const above = cells.find((c) => c.row === 2 && c.col === 0)!;
    const below = cells.find((c) => c.row === 3 && c.col === 0)!;
    const rule = s.heatmap!.splits![0]!;
    expect(round(rule.y1)).toBe(round((above.y + above.h + below.y) / 2));
  });

  it("a pure space is still in the scene, with lineWidth 0 — it exists, it just draws no rule", () => {
    const s = build({ rowSplits: [{ at: 2 }], splitStyle: "gap" });
    expect(s.heatmap!.splits).toHaveLength(1);
    expect(s.heatmap!.splits![0]!.lineWidth).toBe(0);
    expect(s.heatmap!.splits![0]!.gap).toBeGreaterThan(0);
  });

  it("carries the block label the user typed", () => {
    const s = build({ rowSplits: [{ at: 2, label: "Treated" }] });
    expect(s.heatmap!.splits![0]!.label).toBe("Treated");
  });

  it("no splits at all leaves the field off the scene entirely", () => {
    expect(build({}).heatmap!.splits).toBeUndefined();
  });
});

describe("a split that cannot cut anything", () => {
  it("is refused with a warning rather than silently dropped", () => {
    const s = build({ rowSplits: [{ at: 9 }] });
    expect(s.heatmap!.splits ?? []).toHaveLength(0);
    expect(s.warnings.join(" ")).toMatch(/split after row 10 is outside this heatmap \(it has 6\)/);
  });

  it("a split after the last row is refused too — there is nothing on the far side", () => {
    const s = build({ rowSplits: [{ at: 5 }] }); // 6 rows: only 0..4 can split
    expect(s.heatmap!.splits ?? []).toHaveLength(0);
    expect(s.warnings.join(" ")).toMatch(/outside this heatmap/);
  });

  it("keeps the usable splits when only one of several is out of range", () => {
    const s = build({ rowSplits: [{ at: 1 }, { at: 99 }] });
    expect(s.heatmap!.splits).toHaveLength(1);
    expect(s.heatmap!.splits![0]!.at).toBe(1);
    expect(s.warnings.join(" ")).toMatch(/outside this heatmap/);
  });
});

describe("room for the block names", () => {
  it("a row-block name is given room, not clipped to its first letters", () => {
    const plain = build({ rowSplits: [{ at: 2 }] });
    const named = build({ rowSplits: [{ at: 2, label: "Responders" }] });
    // the cells give up width to make room…
    expect(named.plot.width).toBeLessThan(plain.plot.width);
    // …and the name fits between the cells and the colour bar
    const measure = SIZE.measure;
    const nameW = measure("Responders");
    const gapToBar = named.heatmap!.bar.x - (named.plot.x + named.plot.width);
    expect(gapToBar, "the block name does not fit before the colour bar").toBeGreaterThanOrEqual(nameW);
    // and the whole thing is still inside the figure
    expect(named.heatmap!.bar.x + named.heatmap!.bar.w).toBeLessThanOrEqual(named.width);
  });

  it("a column-block name takes room at the top, above the column labels", () => {
    const plain = build({ colSplits: [{ at: 1 }] });
    const named = build({ colSplits: [{ at: 1, label: "Treated" }] });
    expect(named.plot.y).toBeGreaterThan(plain.plot.y);
  });

  it("no names, no reservation — an unlabelled split costs nothing", () => {
    expect(build({ rowSplits: [{ at: 2 }] }).plot.width).toBe(build({}).plot.width);
    expect(build({ colSplits: [{ at: 1 }] }).plot.y).toBe(build({}).plot.y);
  });
});

describe("blocks from the tree", () => {
  // Two tight groups of three, far apart: the tree has an obvious 2-way cut, and a 3-way one.
  const grouped: DataTable = {
    id: "tg", kind: "xy", name: "TG",
    columns: [{ id: "g", name: "Gene" }, ...COLS.map((c, j) => ({ id: `c${j}`, name: c }))],
    rows: ROWS.map((name, i) => ({
      id: `r${i}`,
      cells: Object.fromEntries([["g", name], ...COLS.map((_c, j) => [`c${j}`, (i < 3 ? 1 : 30) + i * 0.1 + j * 0.01])]),
    })),
  };
  const g = (heatmap: NonNullable<Plot["heatmap"]>) =>
    buildPlotScene(grouped, { id: "p", name: "P", source: "tg", status: "ok", styleOverrides: {}, kind: "heatmap", heatmap }, SIZE);

  it("cuts the row tree into k blocks — k-1 breaks, and they fall between the groups", () => {
    const s = g({ cluster: "rows", rowSplitK: 2, splitGap: 20 });
    expect(s.heatmap!.splits).toHaveLength(1);
    // the break separates the two groups of three, wherever clustering put them
    const at = s.heatmap!.splits![0]!.at;
    const order = s.heatmap!.rowLabels.map((l) => l.label);
    const groupOf = (name: string): number => (ROWS.indexOf(name) < 3 ? 0 : 1);
    expect(groupOf(order[at]!)).not.toBe(groupOf(order[at + 1]!));
    // …and nothing inside a block is broken
    for (let i = 0; i < order.length - 1; i++) {
      const same = groupOf(order[i]!) === groupOf(order[i + 1]!);
      expect(i === at, `position ${i}`).toBe(!same);
    }
  });

  it("k = 3 gives two breaks", () => {
    expect(g({ cluster: "rows", rowSplitK: 3 }).heatmap!.splits).toHaveLength(2);
  });

  it("off (blank, 0 or 1) leaves the hand-placed breaks in charge", () => {
    for (const k of [undefined, 0, 1]) {
      const s = g({ cluster: "rows", rowSplitK: k, rowSplits: [{ at: 1 }] });
      expect(s.heatmap!.splits).toHaveLength(1);
      expect(s.heatmap!.splits![0]!.at, `k=${String(k)}`).toBe(1);
    }
  });

  it("needs a tree — asking on an unclustered axis is refused with a warning", () => {
    const s = g({ rowSplitK: 3 });
    expect(s.heatmap!.splits ?? []).toHaveLength(0);
    expect(s.warnings.join(" ")).toMatch(/needs them clustered/);
  });

  it("says so when it overrides breaks the user placed by hand", () => {
    const s = g({ cluster: "rows", rowSplitK: 2, rowSplits: [{ at: 4 }] });
    expect(s.heatmap!.splits).toHaveLength(1);
    expect(s.heatmap!.splits![0]!.at, "the hand-placed break must not win").not.toBe(4);
    expect(s.warnings.join(" ")).toMatch(/breaks you placed by hand are not drawn/);
  });

  it("stays silent when there was no hand-placed list to override", () => {
    const s = g({ cluster: "rows", rowSplitK: 2 });
    expect(s.warnings.join(" ")).not.toMatch(/placed by hand/);
  });

  it("derived breaks take the shared look, like any other break", () => {
    const s = g({ cluster: "rows", rowSplitK: 2, splitStyle: "both", splitGap: 18, splitLineWidth: 4, splitColor: "#00ff00" });
    const sp = s.heatmap!.splits![0]!;
    expect(sp.gap).toBe(18);
    expect(sp.lineWidth).toBe(4);
    expect(sp.color).toBe("#00ff00");
  });

  it("the columns can be cut the same way, independently", () => {
    const s = g({ cluster: "both", colSplitK: 2 });
    expect(s.heatmap!.splits!.filter((x) => x.axis === "col")).toHaveLength(1);
    expect(s.heatmap!.splits!.filter((x) => x.axis === "row")).toHaveLength(0);
  });
});
