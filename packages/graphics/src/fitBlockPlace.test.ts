/**
 * The fit-parameter block goes to a corner of the plot where it hides no data.
 *
 * Bottom-right is where a decaying curve ends and a growth curve levels off, so a block fixed
 * there would print over those points. It starts bottom-right and stays there when that corner
 * is clear; otherwise it takes the first clear corner, and says so when none is.
 */
import { describe, expect, it } from "vitest";
import type { DataTable, Plot } from "@mady/core";
import { buildPlotScene } from "./buildScene";
import { blockOverlap, chooseFitBlockSpot, fitBlockBox, fitBlockConflicts } from "./fitBlockPlace";

const measure = (t: string, px: number) => t.length * px * 0.55;
const plot = { x: 50, y: 20, width: 400, height: 300 };
const lines = ["Y0 = 5350 ± 29", "K = 0.0488", "R² = 0.9996"];
const base = { lines, size: 12, plot, inset: 8, measure, curve: [] as [number, number][] };

describe("chooseFitBlockSpot", () => {
  it("bottom-right when it is clear — the usual place", () => {
    expect(chooseFitBlockSpot({ ...base, marks: [{ cx: 80, cy: 40, r: 5 }] }).corner).toBe("bottom-right");
  });

  it("a decay's last points sit bottom-right: the block moves to the first clear corner", () => {
    // points along the bottom-right, the start of the curve top-left
    const marks = [{ cx: 70, cy: 30, r: 5 }, ...[330, 360, 390, 420].map((cx) => ({ cx, cy: 300, r: 5 }))];
    const spot = chooseFitBlockSpot({ ...base, marks });
    expect(spot.corner).toBe("top-right");
    expect(spot.covered).toBe(0);
  });

  it("the curve counts too: a corner the curve runs through is passed over while a clear one exists", () => {
    const curve: [number, number][] = [[50, 300], [450, 30]]; // a rising line through bottom-left → top-right
    const spot = chooseFitBlockSpot({ ...base, marks: [], curve });
    expect(spot.crossesCurve).toBe(false);
    expect(spot.corner).toBe("bottom-right");
  });

  it("no corner clear: it stays bottom-right, even where another corner covers fewer marks, with the count to report", () => {
    // inside each corner's box: bottom-right 4 marks, top-right 3, top-left 2, bottom-left 1
    const corners = [[420, 300], [420, 40], [80, 40], [80, 300]];
    const marks = corners.flatMap(([x, y], i) => Array.from({ length: 4 - i }, () => ({ cx: x!, cy: y!, r: 6 })));
    const spot = chooseFitBlockSpot({ ...base, marks });
    expect(spot.corner).toBe("bottom-right");
    expect(spot.covered).toBe(4);
  });

  it("a corner with no marks but the curve through it is not clear, so the block does not move there", () => {
    // bottom-right covered by a mark; the other three corners have the curve running through them
    const curve: [number, number][] = [[60, 30], [440, 30], [440, 31], [60, 300]];
    const spot = chooseFitBlockSpot({ ...base, marks: [{ cx: 420, cy: 300, r: 6 }], curve });
    expect(spot.corner).toBe("bottom-right");
  });

  it("the box spans the lines: wider for a longer line, taller for more lines", () => {
    const a = fitBlockBox(["a"], 12, 100, 100, "end", measure);
    const b = fitBlockBox(["a much longer line", "and another"], 12, 100, 100, "end", measure);
    expect(b.x2 - b.x1).toBeGreaterThan(a.x2 - a.x1);
    expect(b.y2 - b.y1).toBeGreaterThan(a.y2 - a.y1);
    expect(b.x2).toBe(100); // anchored at its right edge
  });
});

describe("chooseFitBlockSpot — the other fits on the graph", () => {
  it("keeps off another fit's curve", () => {
    const other = [[300, 280], [500, 300]] as const;
    expect(chooseFitBlockSpot({ ...base, marks: [] }).corner).toBe("bottom-right");
    const spot = chooseFitBlockSpot({ ...base, marks: [], otherCurves: [other] });
    expect(spot.corner).not.toBe("bottom-right");
    expect(spot.crossesCurve).toBe(false);
  });

  it("blocks too big for any two corners to keep apart: the second takes the corner it shares least with the first, never the same one", () => {
    // Six lines at 26 px on a 400 x 300 plot: each block is taller than half the plot and wider than half of it,
    // so every corner touches the first block.
    const big = { ...base, size: 26, lines: ["Bottom = 5.3 ± 1.82", "Top = 94.8 ± 1.8", "logEC50 = 0.462", "Hill slope = 1.14", "EC50 = 2.9", "R² = 0.996"] };
    const first = chooseFitBlockSpot({ ...big, marks: [] });
    const firstBox = fitBlockBox(big.lines, big.size, first.x, first.y, first.anchor, big.measure);
    const second = chooseFitBlockSpot({ ...big, marks: [], taken: [firstBox] });
    const secondBox = fitBlockBox(big.lines, big.size, second.x, second.y, second.anchor, big.measure);
    expect(second.overBlock, "the fixture must leave no corner clear of the first block").toBe(true);
    expect(second.corner).not.toBe(first.corner);
    const shared = blockOverlap(secondBox, [firstBox]);
    const everyCorner = (["bottom-right", "top-right", "top-left", "bottom-left"] as const).map((c) => {
      const right = c.endsWith("right");
      const top = c.startsWith("top");
      const x = right ? big.plot.x + big.plot.width - big.inset : big.plot.x + big.inset;
      const y = top ? big.plot.y + big.inset + big.size * 0.85 : first.y;
      return blockOverlap(fitBlockBox(big.lines, big.size, x, y, right ? "end" : "start", big.measure), [firstBox]);
    });
    expect(shared).toBe(Math.min(...everyCorner));
  });

  it("keeps off a block already placed", () => {
    const first = chooseFitBlockSpot({ ...base, marks: [] });
    const taken = [fitBlockBox(base.lines, base.size, first.x, first.y, first.anchor, base.measure)];
    const second = chooseFitBlockSpot({ ...base, marks: [], taken });
    expect(second.corner).not.toBe(first.corner);
    expect(second.overBlock).toBe(false);
  });
});

describe("fitBlockConflicts", () => {
  const box = { x1: 100, y1: 100, x2: 200, y2: 200 };
  const none = { marks: [], curves: [] };
  it("finds nothing on an empty plot", () => {
    expect(fitBlockConflicts(box, none)).toEqual({ covered: 0, crossesCurve: false, crossesLine: false, overBlock: false });
  });
  it("counts the marks on the box and leaves those beside it", () => {
    expect(fitBlockConflicts(box, { ...none, marks: [{ cx: 150, cy: 150, r: 4 }, { cx: 300, cy: 300, r: 4 }] }).covered).toBe(1);
  });
  it("sees a curve that passes through the box between two far points", () => {
    expect(fitBlockConflicts(box, { ...none, curves: [[[0, 150], [400, 150]]] }).crossesCurve).toBe(true);
    expect(fitBlockConflicts(box, { ...none, curves: [[[0, 50], [400, 50]]] }).crossesCurve).toBe(false);
  });
  it("sees a straight line through the box and a block on it", () => {
    expect(fitBlockConflicts(box, { ...none, refLines: [[[150, 0], [150, 400]]] }).crossesLine).toBe(true);
    expect(fitBlockConflicts(box, { ...none, taken: [{ x1: 190, y1: 190, x2: 250, y2: 250 }] }).overBlock).toBe(true);
    expect(fitBlockConflicts(box, { ...none, taken: [{ x1: 210, y1: 100, x2: 250, y2: 200 }] }).overBlock).toBe(false);
  });
});

describe("blockOverlap", () => {
  const box = { x1: 100, y1: 100, x2: 200, y2: 200 };
  it("is the shared area, summed over the placed blocks", () => {
    expect(blockOverlap(box, [])).toBe(0);
    expect(blockOverlap(box, [{ x1: 150, y1: 150, x2: 250, y2: 250 }])).toBe(2500);
    expect(blockOverlap(box, [{ x1: 150, y1: 150, x2: 250, y2: 250 }, { x1: 0, y1: 0, x2: 110, y2: 120 }])).toBe(2500 + 10 * 20);
  });
  it("is zero for a block that only touches the edge or sits beside it", () => {
    expect(blockOverlap(box, [{ x1: 200, y1: 100, x2: 300, y2: 200 }])).toBe(0);
    expect(blockOverlap(box, [{ x1: 300, y1: 300, x2: 400, y2: 400 }])).toBe(0);
  });
});

describe("chooseFitBlockSpot — reference lines", () => {
  it("a corner a reference line runs through is passed over while a fully clear one exists", () => {
    const refLines: [[number, number], [number, number]][] = [[[50, 310], [450, 295]]]; // shallow, along the bottom
    const spot = chooseFitBlockSpot({ ...base, marks: [], refLines });
    expect(spot.corner).toBe("top-right");
    expect(spot.crossesLine).toBe(false);
  });

  it("a line is passed over only after the data: with no corner clear of both, a corner clear of the data wins", () => {
    // The data fill the top; the line runs along the bottom. Covering a line beats covering points.
    const marks = [{ cx: 420, cy: 40, r: 6 }, { cx: 80, cy: 40, r: 6 }];
    const refLines: [[number, number], [number, number]][] = [[[50, 300], [450, 300]]];
    const spot = chooseFitBlockSpot({ ...base, marks, refLines });
    expect(spot.corner).toBe("bottom-right");
    expect(spot.covered).toBe(0);
  });
});

describe("a fit's parameter block on a graph with the line of identity", () => {
  // Invertase kinetics: rate levels off near 90 by 20 mM, so y = x runs low and shallow, through the bottom-right.
  const xs = [0.25, 0.5, 1, 2, 3, 5, 8, 12, 20];
  const ys = [9.2, 16.81, 27.46, 43.83, 52.05, 67.47, 65.92, 80.71, 79.5];
  const table = {
    id: "t", kind: "xy", name: "Invertase",
    columns: [{ id: "x", name: "Sucrose (mM)", role: "x" }, { id: "y", name: "Rate", role: "y" }],
    rows: xs.map((x, i) => ({ id: `r${i}`, cells: { x, y: ys[i]! } })),
  } as unknown as DataTable;
  const curve = Array.from({ length: 80 }, (_, i) => { const x = 0.25 + (i * 19.75) / 79; return [x, (90.2 * x) / (2.14 + x)] as [number, number]; });
  const plot = {
    id: "p", name: "P", source: "t", status: "ok", styleOverrides: {}, kind: "xy", showIdentity: true,
    fit: { label: "Michaelis-Menten", points: curve, params: ["Vmax = 90.2 ± 3.13", "KM = 2.14 ± 0.251", "R² = 0.988", "Adjusted R² = 0.986", "Sy.x (RMSE) = 3.15", "Sum of squares = 69.4"] },
  } as unknown as Plot;

  it("goes where the identity line does not run through it", () => {
    // At 800 x 540 the top-left corner is clear of points, curve and line. (At 600 x 420 no corner is: the
    // block then keeps the corner clear of the data, bottom-right, with the line under it.)
    const sc = buildPlotScene(table, plot, { width: 800, height: 540, measure });
    const id = sc.annotations.find((a) => a.id === "identity")!;
    expect(id, "the identity line is drawn").toBeTruthy();
    const p = sc.fit!.params!;
    const box = fitBlockBox(p.lines, p.size, p.x, p.y, p.anchor, measure);
    const hits = Array.from({ length: 201 }, (_, i) => [id.x1! + ((id.x2! - id.x1!) * i) / 200, id.y1! + ((id.y2! - id.y1!) * i) / 200])
      .filter(([x, y]) => x! >= box.x1 && x! <= box.x2 && y! >= box.y1 && y! <= box.y2);
    expect(hits.length, `the identity line crosses the block (${JSON.stringify(box)})`).toBe(0);
  });
});