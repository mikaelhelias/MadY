// Every chart kind honours all four sides of `plotPad`.
//
// The Inspector offers a "Plot margins" section with Top/Right/Bottom/Left on every kind, so a
// side a builder ignores is a box that does nothing — the user types a number and nothing moves.
// Each side is driven separately here, because setting all four at once moves the rect even when
// only some sides are applied (a builder that honours only the top, or only top and right, would
// still pass).
//
// Caution: two fixture traps both produce a false "ignored side", which is why this file pins the
// figure size and the pad:
//   • at 360×250 the paired-dot fixture's plot rect is already clamped by `Math.max(1, …)` to a
//     1px sliver, so nothing moves it and every side reads as ignored;
//   • a correlation matrix sizes its square cells from `min(availW, availH)`, so a right pad
//     changes nothing until it becomes the binding dimension — a small pad reads as ignored.
import { describe, expect, it } from "vitest";
import { buildPlotScene } from "./buildScene";
import type { DataTable, Plot } from "@mady/core";

/** Kind fixtures come from the desktop gallery, which this package cannot import, so the cases
 *  are built from the same two shapes every builder accepts. */
function tableFor(): DataTable {
  return {
    id: "t", kind: "xy", name: "T",
    columns: [
      { id: "x", name: "X", role: "x" },
      { id: "a", name: "A", role: "y" },
      { id: "b", name: "B", role: "y" },
    ],
    rows: [
      { id: "r1", cells: { x: 1, a: 4, b: 7 } },
      { id: "r2", cells: { x: 2, a: 5, b: 9 } },
      { id: "r3", cells: { x: 3, a: 6, b: 8 } },
      { id: "r4", cells: { x: 4, a: 8, b: 6 } },
    ],
  } as unknown as DataTable;
}

/** Every kind whose builder lays out a plot rect. */
const KINDS = [
  "xy", "area", "bar", "box", "violin", "scatter", "raincloud", "floatingbar", "estimation",
  "forest", "blandaltman", "pyramid", "pcascore", "pcaload", "pcabiplot", "scree", "dendrogram",
  "bubble", "histogram", "volcano", "beforeafter", "pie", "treemap", "heatmap", "corrmatrix",
  "alluvial", "network", "radar", "parallel", "scatter3d", "ridgeline", "lollipop", "paireddot",
  "survival", "roc",
] as const;

/** Pads are escalated rather than fixed, and a side passes as soon as one of them moves the
 *  geometry. A single pad size cannot be fair to every layout: a correlation matrix sizes its
 *  square cells from `min(availW, availH)`, so a right pad legitimately changes nothing until it
 *  becomes the binding dimension — with one small pad that reads as an ignored control, and inflating
 *  the constant until that one kind passes just moves the arbitrariness somewhere else. */
const PADS = [40, 120, 260];
const SIZE = { width: 620, height: 420 };

describe("plotPad — all four sides, every kind", () => {
  const table = tableFor();
  const geom = (plot: Plot): string => {
    const sc = buildPlotScene(table, plot, SIZE);
    return JSON.stringify({ p: sc.plot, w: sc.width, h: sc.height });
  };

  for (const kind of KINDS) {
    it(`${kind} moves for top, right, bottom and left`, () => {
      const plot = { id: `p-${kind}`, tableId: "t", name: kind, kind } as unknown as Plot;
      const base = geom(plot);

      // Fixture check: a rect already collapsed to the `Math.max(1, …)` floor cannot show a pad.
      const rect = buildPlotScene(table, plot, SIZE).plot;
      expect(rect.width, `${kind}: the fixture's plot rect is already collapsed — it cannot exhibit an ignored side`).toBeGreaterThan(1);
      expect(rect.height, `${kind}: the fixture's plot rect is already collapsed — it cannot exhibit an ignored side`).toBeGreaterThan(1);

      const dead: string[] = [];
      for (const side of ["top", "right", "bottom", "left"] as const) {
        if (!PADS.some((px) => geom({ ...plot, plotPad: { [side]: px } }) !== base)) dead.push(side);
      }
      expect(dead, `${kind}: the Plot margins section offers boxes its builder ignores`).toEqual([]);
    });
  }
});
