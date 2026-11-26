// The network graph's node-value key (the small colour ramp in the left margin): its heading and size are
// the plot's own settings, reserved for in the margin and carried on the scene for the renderer.
import { describe, expect, it } from "vitest";
import type { DataTable, Plot } from "@mady/core";
import { buildPlotScene } from "./buildScene";

const table: DataTable = {
  id: "n", kind: "edgelist", name: "N",
  columns: [{ id: "s", name: "Source" }, { id: "t", name: "Target" }, { id: "w", name: "Rho" }, { id: "v", name: "Abundance" }],
  rows: ([["A", "B", 0.8, 4], ["B", "C", -0.5, 9], ["C", "D", 0.6, 2], ["A", "D", 0.4, 7], ["D", "E", -0.7, 5]] as [string, string, number, number][])
    .map((r, i) => ({ id: `r${i}`, cells: { s: r[0], t: r[1], w: r[2], v: r[3] } })),
};
const plotOf = (network?: NonNullable<Plot["network"]>): Plot => ({ id: "p", name: "P", source: "n", status: "ok", styleOverrides: {}, kind: "network", ...(network ? { network } : {}) });
const keyOf = (network?: NonNullable<Plot["network"]>) => buildPlotScene(table, plotOf(network), { width: 800, height: 520 });

describe("network node-value key", () => {
  it("is drawn from the numeric value column, with no heading and the default size", () => {
    const s = keyOf();
    const k = s.network!.valueLegend!;
    expect(k).toBeDefined();
    expect(k.title).toBeUndefined();
    expect(k.barW).toBe(8);
    expect(k.barH).toBeGreaterThanOrEqual(24);
  });

  it("carries a heading the plot sets, and a blank one draws none", () => {
    expect(keyOf({ valueLegendTitle: "Abundance (%)" }).network!.valueLegend!.title).toBe("Abundance (%)");
    expect(keyOf({ valueLegendTitle: "   " }).network!.valueLegend!.title).toBeUndefined();
  });

  it("a heading wider than the number labels widens the margin reserved for the key", () => {
    const plain = keyOf();
    const headed = keyOf({ valueLegendTitle: "Relative abundance across all samples" });
    expect(headed.plot.x).toBeGreaterThan(plain.plot.x);
    // a short heading fits over the numbers and costs nothing
    expect(keyOf({ valueLegendTitle: "n" }).plot.x).toBe(plain.plot.x);
  });

  it("the heading takes a row above the bar, so the bar starts lower", () => {
    const k = keyOf({ valueLegendTitle: "Abundance" }).network!.valueLegend!;
    expect(k.headH).toBeGreaterThan(0);
    expect(keyOf().network!.valueLegend!.headH).toBe(0);
  });

  it("scales the bar's thickness and length, kept inside 0.5–2", () => {
    const one = keyOf().network!.valueLegend!;
    const two = keyOf({ valueLegendScale: 2 }).network!.valueLegend!;
    expect(two.barW).toBe(16);
    expect(two.barH).toBeGreaterThan(one.barH);
    expect(keyOf({ valueLegendScale: 9 }).network!.valueLegend!.barW).toBe(16);
    expect(keyOf({ valueLegendScale: 0.01 }).network!.valueLegend!.barW).toBe(4);
  });
});
