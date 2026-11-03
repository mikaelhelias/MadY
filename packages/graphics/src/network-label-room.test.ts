import { describe, expect, it } from "vitest";
import type { DataTable, Plot } from "@mady/core";
import { buildPlotScene } from "./buildScene.js";

/**
 * Network node names are measured at the size they are drawn.
 *
 * Node names are drawn at the network's own Label size (`network.labelSize`), so the right-hand room kept for them
 * and the flip-to-the-left check measure them at that size, not at the tick font size. Measured at the tick font -
 * which draws nothing on a network - the tick font would move every node, and a large Label size would get the room
 * of a 12 px name.
 *
 * The fixture needs long names: the reserve is capped at 18% of the width, and short names never reach the cap
 * at either size, so a 3-letter fixture reads the same both ways.
 */
const table: DataTable = {
  id: "net", kind: "xy", name: "NET",
  columns: [
    { id: "s", name: "Source", role: "x" },
    { id: "t", name: "Target", role: "y" },
  ],
  rows: Array.from({ length: 10 }, (_, i) => ({ id: `r${i}`, cells: { s: `Gene-${i % 6}`, t: `Gene-${(i * 5 + 1) % 6}` } })),
};
const plot: Plot = { id: "p", name: "P", source: "net", status: "ok", styleOverrides: {}, kind: "network" };
const SIZE = { width: 640, height: 420 };

describe("network node names: the room follows the Label size, not the tick font", () => {
  it("the tick font does not move a network", () => {
    const small = buildPlotScene(table, { ...plot, fonts: { tick: { size: 8 } } }, SIZE);
    const big = buildPlotScene(table, { ...plot, fonts: { tick: { size: 24 } } }, SIZE);
    expect(big.plot.width).toBe(small.plot.width);
    expect(big.network!.nodes.map((n) => [n.cx, n.cy])).toEqual(small.network!.nodes.map((n) => [n.cx, n.cy]));
  });

  it("a larger Label size reserves more room for the names", () => {
    const small = buildPlotScene(table, { ...plot, network: { labelSize: 8 } }, SIZE);
    const big = buildPlotScene(table, { ...plot, network: { labelSize: 20 } }, SIZE);
    expect(big.plot.width).toBeLessThan(small.plot.width);
  });
});
