// @vitest-environment node
/**
 * Annotation strips — the bands that say what each row / column is.
 *
 * The things that have to be true, and the ones that would silently be wrong otherwise:
 *  • a strip reads its values in the display order. Clustering reorders the rows, and a strip
 *    built from the table order labels the wrong ones — which looks like bad annotation, not
 *    like a bug in the drawing.
 *  • each block lines up with its own row / column, exactly, splits included;
 *  • the band is reserved (the cells give up room for it) rather than drawn over the labels;
 *  • equal neighbours are labelled once, as a run;
 *  • numbers shade through a ramp, text takes one hue per value, and the user's own colour wins.
 */
import { describe, expect, it } from "vitest";
import type { DataTable, Plot } from "@mady/core";
import { buildPlotScene } from "./buildScene";

const ROWS = ["GeneA", "GeneB", "GeneC", "GeneD", "GeneE", "GeneF"];
const GROUP = ["Ctrl", "Ctrl", "Ctrl", "Treated", "Treated", "Treated"];
const SCORE = [1, 2, 3, 4, 5, 6];
const COLS = ["S1", "S2", "S3", "S4"];
const table: DataTable = {
  id: "t", kind: "xy", name: "T",
  columns: [
    { id: "g", name: "Gene" }, { id: "grp", name: "Group" }, { id: "sc", name: "Score" },
    ...COLS.map((c, j) => ({ id: `c${j}`, name: c })),
  ],
  rows: ROWS.map((name, i) => ({
    id: `r${i}`,
    cells: Object.fromEntries([
      ["g", name], ["grp", GROUP[i]!], ["sc", SCORE[i]!],
      ...COLS.map((_c, j) => [`c${j}`, (i + 1) * (j + 2)]),
    ]),
  })),
};
const SIZE = { width: 700, height: 500, measure: (t: string): number => t.length * 7 };
const build = (heatmap: NonNullable<Plot["heatmap"]>) =>
  buildPlotScene(table, { id: "p", name: "P", source: "t", status: "ok", styleOverrides: {}, kind: "heatmap", heatmap }, SIZE);
const round = (n: number): number => Math.round(n * 100) / 100;

describe("a row strip", () => {
  it("draws one block per row, each exactly on its own row", () => {
    const s = build({ rowTracks: [{ column: "grp", name: "Group" }] });
    const tr = s.heatmap!.tracks![0]!;
    expect(tr.axis).toBe("row");
    expect(tr.blocks).toHaveLength(6);
    tr.blocks.forEach((b, i) => {
      const cell = s.heatmap!.cells.find((c) => c.row === i && c.col === 0)!;
      expect(round(b.y), `block ${i} is off its row`).toBe(round(cell.y));
      expect(round(b.h)).toBe(round(cell.h));
    });
  });

  it("sits left of the cells, and the cells gave up the room for it", () => {
    const plain = build({});
    const s = build({ rowTracks: [{ column: "grp" }] });
    const tr = s.heatmap!.tracks![0]!;
    expect(s.plot.x, "the strip must be reserved, not drawn over the labels").toBeGreaterThan(plain.plot.x);
    expect(tr.blocks[0]!.x + tr.blocks[0]!.w).toBeLessThanOrEqual(s.plot.x);
  });

  it("stacks several strips, in the order they were listed, nearest first", () => {
    const s = build({ rowTracks: [{ column: "grp" }, { column: "sc" }], trackSize: 10, trackGap: 4 });
    const [a, b] = s.heatmap!.tracks!;
    expect(round(a!.blocks[0]!.x)).toBeGreaterThan(round(b!.blocks[0]!.x));
    expect(round(a!.blocks[0]!.x - b!.blocks[0]!.x)).toBe(14); // size + gap
  });

  it("follows the clustered order — a strip built from the table order annotates the wrong rows", () => {
    // Note: this test needs its own fixture. The table above clusters back into its original
    // order, so a strip reading the table order would pass while being wrong. Here the two
    // profiles are interleaved, so clustering must permute the rows for the check to mean anything.
    const P = [10, 10, 1, 1];
    const Q = [1, 1, 10, 10];
    const shuffled: DataTable = {
      id: "t3", kind: "xy", name: "T3",
      columns: [{ id: "g", name: "Gene" }, { id: "grp", name: "Group" }, ...COLS.map((c, j) => ({ id: `c${j}`, name: c }))],
      rows: ROWS.map((name, i) => ({
        id: `r${i}`,
        cells: Object.fromEntries([
          ["g", name], ["grp", i % 2 === 0 ? "Pat-P" : "Pat-Q"],
          ...COLS.map((_c, j) => [`c${j}`, (i % 2 === 0 ? P : Q)[j]! + i * 0.01]),
        ]),
      })),
    };
    const s = buildPlotScene(
      shuffled,
      { id: "p", name: "P", source: "t3", status: "ok", styleOverrides: {}, kind: "heatmap", heatmap: { rowTracks: [{ column: "grp" }], cluster: "rows" } },
      SIZE,
    );
    const order = s.heatmap!.rowLabels.map((l) => l.label);
    expect(order, "the fixture must actually be reordered, or this proves nothing").not.toEqual(ROWS);
    const strip = s.heatmap!.tracks![0]!.blocks.map((b) => b.value);
    order.forEach((gene, i) => {
      const want = ROWS.indexOf(gene) % 2 === 0 ? "Pat-P" : "Pat-Q";
      expect(strip[i], `row ${i} shows ${gene} but the strip says ${strip[i]}`).toBe(want);
    });
  });

  it("the column a strip reads drops out of the matrix — it must not be drawn twice", () => {
    const without = build({});
    const withTrack = build({ rowTracks: [{ column: "sc" }] });
    expect(without.heatmap!.colLabels.map((l) => l.label)).toContain("Score");
    expect(
      withTrack.heatmap!.colLabels.map((l) => l.label),
      "Score is drawn as a matrix column and as a strip",
    ).not.toContain("Score");
    // …and only that column left
    expect(withTrack.heatmap!.colLabels).toHaveLength(without.heatmap!.colLabels.length - 1);
  });

  it("moves with the splits, so a strip never drifts off its block", () => {
    const s = build({ rowTracks: [{ column: "grp" }], rowSplits: [{ at: 2 }], splitGap: 24 });
    s.heatmap!.tracks![0]!.blocks.forEach((b, i) => {
      const cell = s.heatmap!.cells.find((c) => c.row === i && c.col === 0)!;
      expect(round(b.y)).toBe(round(cell.y));
    });
  });
});

describe("a column strip", () => {
  // Its own table: `grp`/`sc` above are kept out of the matrix columns only while a row strip is reading
  // them, and these cases have none.
  const plainTable: DataTable = {
    id: "t2", kind: "xy", name: "T2",
    columns: [{ id: "g", name: "Gene" }, ...COLS.map((c, j) => ({ id: `c${j}`, name: c }))],
    rows: ROWS.map((name, i) => ({
      id: `r${i}`,
      cells: Object.fromEntries([["g", name], ...COLS.map((_c, j) => [`c${j}`, (i + 1) * (j + 2)])]),
    })),
  };
  const build = (heatmap: NonNullable<Plot["heatmap"]>) =>
    buildPlotScene(plainTable, { id: "p", name: "P", source: "t2", status: "ok", styleOverrides: {}, kind: "heatmap", heatmap }, SIZE);

  it("takes its values from the plot (a table has none per column) and lines up with the columns", () => {
    const s = build({ colTracks: [{ name: "Batch", values: { c0: "A", c1: "A", c2: "B", c3: "B" } }] });
    const tr = s.heatmap!.tracks![0]!;
    expect(tr.axis).toBe("col");
    expect(tr.blocks.map((b) => b.value)).toEqual(["A", "A", "B", "B"]);
    tr.blocks.forEach((b, j) => {
      const cell = s.heatmap!.cells.find((c) => c.row === 0 && c.col === j)!;
      expect(round(b.x)).toBe(round(cell.x));
      expect(round(b.w)).toBe(round(cell.w));
    });
  });

  it("sits above the cells, which gave up the room", () => {
    const plain = build({});
    const s = build({ colTracks: [{ values: { c0: "A" } }] });
    expect(s.plot.y).toBeGreaterThan(plain.plot.y);
    expect(s.heatmap!.tracks![0]!.blocks[0]!.y).toBeLessThan(s.plot.y);
  });

  it("a column with no value given is drawn as missing, not skipped", () => {
    const s = build({ colTracks: [{ values: { c0: "A" } }] });
    const tr = s.heatmap!.tracks![0]!;
    expect(tr.blocks).toHaveLength(4);
    expect(tr.blocks.map((b) => b.value)).toEqual(["A", "", "", ""]);
    expect(tr.blocks[1]!.color).toBe("#dddddd"); // the NaN colour
  });
});

describe("colour", () => {
  it("one hue per distinct value, and equal values share it", () => {
    const tr = build({ rowTracks: [{ column: "grp" }] }).heatmap!.tracks![0]!;
    const byValue = new Map(tr.blocks.map((b) => [b.value, b.color]));
    expect(byValue.size).toBe(2);
    expect(tr.blocks[0]!.color).toBe(tr.blocks[1]!.color);
    expect(tr.blocks[0]!.color).not.toBe(tr.blocks[3]!.color);
  });

  it("the user's own colour wins over the automatic hue", () => {
    const tr = build({ rowTracks: [{ column: "grp", colors: { Treated: "#ff0000" } }] }).heatmap!.tracks![0]!;
    expect(tr.blocks[3]!.color).toBe("#ff0000");
    expect(tr.blocks[0]!.color).not.toBe("#ff0000"); // Ctrl keeps its automatic hue
  });

  it("numbers shade through a ramp instead of taking six unrelated hues", () => {
    const tr = build({ rowTracks: [{ column: "sc" }] }).heatmap!.tracks![0]!;
    expect(tr.numeric).toBe(true);
    expect(new Set(tr.blocks.map((b) => b.color)).size).toBe(6);
    // …and it really is a ramp: it moves one way in lightness from one end to the other
    const lum = (c: string): number => parseInt(c.slice(1, 3), 16) + parseInt(c.slice(3, 5), 16) + parseInt(c.slice(5, 7), 16);
    const lums = tr.blocks.map((b) => lum(b.color));
    expect(lums[0]!).not.toBe(lums[5]!);
    for (let i = 1; i < lums.length; i++) expect(Math.sign(lums[i]! - lums[i - 1]!)).toBe(Math.sign(lums[1]! - lums[0]!));
  });

  it("the reading can be forced — numbers as categories", () => {
    const tr = build({ rowTracks: [{ column: "sc", scale: "category" }] }).heatmap!.tracks![0]!;
    expect(tr.numeric).toBe(false);
  });
});

describe("the words on a strip", () => {
  it("labels a run of equal values once, not once per row", () => {
    const tr = build({ rowTracks: [{ column: "grp" }], trackSize: 30 }).heatmap!.tracks![0]!;
    expect(tr.runs).toHaveLength(2);
    expect(tr.runs.map((r) => r.label)).toEqual(["Ctrl", "Treated"]);
    // the run spans its three rows
    expect(round(tr.runs[0]!.h)).toBe(round(tr.blocks[0]!.h * 3));
  });

  it("drops a label the run cannot hold rather than clipping it", () => {
    const thin = build({ rowTracks: [{ column: "grp" }], trackSize: 4 }).heatmap!.tracks![0]!;
    expect(thin.runs.every((r) => r.label === "")).toBe(true);
  });

  it("a numeric strip carries no words — the ramp is the message", () => {
    const tr = build({ rowTracks: [{ column: "sc" }], trackSize: 30 }).heatmap!.tracks![0]!;
    expect(tr.runs.every((r) => r.label === "")).toBe(true);
  });

  it("the strip's name is drawn under it, in room reserved at the bottom", () => {
    const plain = build({ rowTracks: [{ column: "grp" }] });
    const named = build({ rowTracks: [{ column: "grp", name: "Group" }] });
    const tr = named.heatmap!.tracks![0]!;
    expect(tr.name).toBe("Group");
    // under the cells, centred on its own strip, and still inside the figure
    expect(tr.nameY).toBeGreaterThan(named.plot.y + named.plot.height);
    expect(tr.nameY).toBeLessThan(named.height);
    expect(round(tr.nameX)).toBe(round(tr.blocks[0]!.x + tr.blocks[0]!.w / 2));
    // …and the room was reserved: the cells are shorter than without a name
    expect(named.plot.height).toBeLessThan(plain.plot.height);
  });

  it("a column strip names itself to the left of the band", () => {
    const s = build({ colTracks: [{ name: "Batch", values: { c0: "A" } }] });
    const tr = s.heatmap!.tracks![0]!;
    expect(tr.nameX).toBeLessThan(s.plot.x);
    expect(round(tr.nameY)).toBe(round(tr.blocks[0]!.y + tr.blocks[0]!.h / 2));
  });
});

describe("nothing to draw", () => {
  it("no tracks leaves the field off the scene", () => {
    expect(build({}).heatmap!.tracks).toBeUndefined();
  });

  it("a row strip with no column chosen draws blanks rather than throwing", () => {
    const tr = build({ rowTracks: [{}] }).heatmap!.tracks![0]!;
    expect(tr.blocks).toHaveLength(6);
    expect(tr.blocks.every((b) => b.value === "")).toBe(true);
  });
});

describe("the strips do not collide with the labels", () => {
  it("the labels move out by the strip band, so a strip never draws through a label", () => {
    const none = build({});
    const one = build({ rowTracks: [{ column: "grp" }], colTracks: [{ values: { c0: "A" } }], trackSize: 14, trackGap: 3 });
    expect(none.heatmap!.labelInset).toBeUndefined();
    expect(one.heatmap!.labelInset).toEqual({ left: 17, top: 17 });
  });

  it("the inset is the whole band, so two strips push the labels twice as far", () => {
    const two = build({ rowTracks: [{ column: "grp" }, { column: "sc" }], trackSize: 10, trackGap: 2 });
    expect(two.heatmap!.labelInset!.left).toBe(24);
    expect(two.heatmap!.labelInset!.top).toBe(0);
  });

  it("the strips still sit between the cells and where the labels now are", () => {
    const s = build({ rowTracks: [{ column: "grp", name: "Group" }], trackSize: 14, trackGap: 3 });
    const tr = s.heatmap!.tracks![0]!;
    const labelX = s.plot.x - 6 - s.heatmap!.labelInset!.left; // where the renderer draws them
    expect(tr.blocks[0]!.x).toBeGreaterThanOrEqual(labelX);
    expect(tr.blocks[0]!.x + tr.blocks[0]!.w).toBeLessThanOrEqual(s.plot.x);
  });
});

describe("the drawing agrees with the measurement", () => {
  it("the scene carries the track font whenever it carries tracks", () => {
    const s = build({ rowTracks: [{ column: "grp" }] });
    expect(s.heatmap!.trackFont, "the renderer would fall back to the bigger label font").toBeTruthy();
    // the size the builder measured `fits` with — not the row/column label size
    expect(s.heatmap!.trackFont!.size).toBeLessThanOrEqual(10);
    expect(build({}).heatmap!.trackFont).toBeUndefined();
  });

  it("a word is kept only when its own band can hold it at that size", () => {
    const wide = build({ rowTracks: [{ column: "grp" }], trackSize: 30 }).heatmap!.tracks![0]!;
    const thin = build({ rowTracks: [{ column: "grp" }], trackSize: 12 }).heatmap!.tracks![0]!;
    expect(wide.runs.some((r) => r.label !== "")).toBe(true);
    expect(thin.runs.every((r) => r.label === ""), "a 12px band cannot hold a 10px word with room").toBe(true);
  });
});
