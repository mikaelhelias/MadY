// A Venn zone's text is its count, and "Percent of union" adds the zone's share of the union. With the counts switched off the
// percentage stands alone, so ticking the box always changes the text.
import { describe, expect, it } from "vitest";
import type { DataTable, Plot } from "@mady/core";
import { buildPlotScene } from "./buildScene";

/** |A| = 8, |B| = 4, |A∩B| = 2, union 10: A only 6 (60%), B only 2 (20%), both 2 (20%). */
const table: DataTable = {
  id: "ts", kind: "sets", name: "S",
  columns: [{ id: "item", name: "Item", role: "x" }, { id: "a", name: "Set A", role: "y" }, { id: "b", name: "Set B", role: "y" }],
  rows: Array.from({ length: 10 }, (_, i) => ({ id: `r${i}`, cells: { item: `item${i}`, a: i < 8 ? 1 : "", b: i >= 6 ? 1 : "" } })),
};
const textOf = (venn: NonNullable<Plot["venn"]>): Record<string, string> => {
  const s = buildPlotScene(table, { id: "p", name: "P", source: "ts", status: "ok", styleOverrides: {}, kind: "venn", venn } as Plot, { width: 520, height: 460 });
  return Object.fromEntries(s.venn!.zones.map((z) => [z.key, z.text]));
};

describe("Venn zone text", () => {
  it("counts alone: the count only", () => {
    expect(Object.values(textOf({})).sort()).toEqual(["2", "2", "6"]);
  });

  it("counts and percent: the percent follows the count", () => {
    expect(Object.values(textOf({ showPercents: true })).sort()).toEqual(["2 (20%)", "2 (20%)", "6 (60%)"]);
  });

  it("percent with the counts off: the percent stands alone", () => {
    expect(Object.values(textOf({ showCounts: false, showPercents: true })).sort()).toEqual(["20%", "20%", "60%"]);
  });

  it("counts off and no percent: no text", () => {
    expect(Object.values(textOf({ showCounts: false })).every((t) => t === "")).toBe(true);
  });

  it("the same zones exist whichever way the text is shown", () => {
    const keys = (v: NonNullable<Plot["venn"]>) => Object.keys(textOf(v)).sort();
    expect(keys({ showCounts: false, showPercents: true })).toEqual(keys({ showCounts: false }));
  });
});
