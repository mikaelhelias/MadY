// The zone key (the small legend for the shaded zone bands): its heading, size and drag offset are the
// plot's own settings, and each row knows which band it keys so its words can be edited on the graph.
import { describe, expect, it } from "vitest";
import type { DataTable, Plot } from "@mady/core";
import { buildPlotScene } from "./buildScene";

const table: DataTable = {
  id: "t", kind: "xy", name: "T",
  columns: [{ id: "x", name: "X" }, { id: "y", name: "Y" }],
  rows: [1, 2, 3, 4, 5].map((i) => ({ id: `r${i}`, cells: { x: i, y: i * 10 } })),
};
const bands = [
  { id: "z1", kind: "hband" as const, y: 0.6, h: 0.2, fill: "#22aa22", label: "Low" },
  { id: "z2", kind: "hband" as const, y: 0.2, h: 0.2, fill: "#cc3333", label: "High" },
];
const base: Plot = { id: "p", name: "P", source: "t", status: "ok", styleOverrides: {}, kind: "xy", zoneLegend: "topright", annotations: bands };
const keyOf = (extra: Partial<Plot> = {}) => buildPlotScene(table, { ...base, ...extra }, { width: 800, height: 500 }).zoneLegend!;

describe("zone key options", () => {
  it("each row carries the id of the band it keys", () => {
    expect(keyOf().entries.map((e) => e.id)).toEqual(["z1", "z2"]);
  });

  it("has no heading by default, and a heading when the plot sets one", () => {
    expect(keyOf().title).toBeUndefined();
    expect(keyOf({ zoneLegendTitle: "   " }).title).toBeUndefined();
    const k = keyOf({ zoneLegendTitle: "Risk zones" });
    expect(k.title).toBe("Risk zones");
    // The heading takes a row of its own, above the entries, and the box grows by that row.
    expect(k.titleH).toBeGreaterThan(0);
    expect(k.h).toBe(keyOf().h + k.titleH);
  });

  it("a long heading widens the box", () => {
    expect(keyOf({ zoneLegendTitle: "A very long heading for this small key" }).w).toBeGreaterThan(keyOf().w);
  });

  it("scales the swatches and the rows with the key size", () => {
    const one = keyOf();
    const two = keyOf({ zoneLegendScale: 2 });
    expect(two.sw).toBe(one.sw * 2);
    expect(two.rowH).toBeGreaterThan(one.rowH);
    expect(two.h).toBeGreaterThan(one.h);
    expect(two.w).toBeGreaterThan(one.w);
  });

  it("keeps the key size inside 0.5–2", () => {
    expect(keyOf({ zoneLegendScale: 9 }).sw).toBe(keyOf({ zoneLegendScale: 2 }).sw);
    expect(keyOf({ zoneLegendScale: 0.01 }).sw).toBe(keyOf({ zoneLegendScale: 0.5 }).sw);
  });

  it("carries the drag offset the plot stores, and none otherwise", () => {
    expect(keyOf({ zoneLegendOffset: { dx: -30, dy: 12 } }).offset).toEqual({ dx: -30, dy: 12 });
    expect(keyOf().offset).toBeUndefined();
  });
});
