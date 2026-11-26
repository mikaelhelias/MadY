/**
 * A treemap with more cells than the palette has colours gives no two cells the same colour.
 *
 * A cell takes the palette colour of its position, cycled; past the palette it takes a tint of the cycled colour, as a
 * pie's slices do, so the ninth of ten stores does not wear the first store's blue, nor the tenth the second's orange,
 * and no two cells or legend keys read as one.
 */
import { describe, expect, it } from "vitest";
import type { DataTable, Plot } from "@mady/core";
import { buildPlotScene } from "./buildScene";

const names = ["Grünerløkka", "Majorstua", "Bryggen", "Markens", "Pollen", "Sentrum", "Forus", "Smedasund", "Bragernes", "Gamlebyen"];
const sheet = (kind: string) => ({
  id: "t", kind, name: "Sales",
  columns: [{ id: "s", name: "Store", role: "x" }, { id: "v", name: "Sales", role: "y" }],
  rows: names.map((n, i) => ({ id: `r${i}`, cells: { s: n, v: 300 + 60 * i } })),
}) as unknown as DataTable;
const plot = { id: "p", name: "P", source: "t", kind: "treemap", treemap: { cellsPer: "row" } } as unknown as Plot;

describe("treemap colours past the palette", () => {
  it.each(["partsofwhole", "multivariable"])("ten cells on a %s sheet: ten different colours, in the cells and the legend", (kind) => {
    const s = buildPlotScene(sheet(kind), plot, { width: 700, height: 560 });
    expect(new Set(s.treemap!.cells.map((c) => c.fill)).size).toBe(10);
    expect(new Set(s.legend.map((l) => l.color)).size).toBe(10);
  });
});
