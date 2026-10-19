/**
 * Small-multiple pies share one look: a dataset added to a two-tone pie is drawn two-tone too, so the shared legend
 * matches every pie. A pie with no style of its own takes the styled pie's look —
 * border, two-tone, explode — never its colours and never its own label choice. Where each dataset is a slice (a one-row
 * sheet), nothing is copied: that case is `buildScene.test.ts` "per-slice overrides".
 */
import { describe, expect, it } from "vitest";
import type { DataTable, Plot } from "@mady/core";
import { buildPlotScene, contrastInk } from "./buildScene";

const table = {
  id: "t", kind: "partsofwhole", name: "t",
  columns: [{ id: "cat", name: "Compartment", role: "x" }, { id: "p1", name: "Sample 1", role: "y" }, { id: "p2", name: "Sample 2", role: "y" }, { id: "p3", name: "Sample 3", role: "y" }],
  rows: ["Mito", "Cyto", "Nuc"].map((c, i) => ({ id: `r${i}`, cells: { cat: c, p1: 40 - i * 10, p2: 30 + i * 5, p3: 20 + i * 3 } })),
} as unknown as DataTable;
const plot = {
  id: "p", name: "p", source: "t", status: "ok", styleOverrides: {}, kind: "pie",
  seriesStyles: { p1: { fillType: "twotone", sliceStrokeWidth: 2.5, sliceExplode: 0.12, sliceLabel: "value" } },
} as unknown as Plot;

describe("small-multiple pies share one look", () => {
  it("the added pies wear the first pie's border — every panel alike", () => {
    const s = buildPlotScene(table, plot, { width: 760, height: 640 });
    const panels = s.pie!.panels!;
    expect(panels.length, "the fixture draws no small multiples — it proves nothing").toBe(3);
    const widths = panels.map((p) => p.slices.map((sl) => sl.strokeWidth));
    expect(widths[1]).toEqual(widths[0]);
    expect(widths[2]).toEqual(widths[0]);
    expect(widths[0]!.every((w) => w === 2.5)).toBe(true);
  });

  it("…but not the first pie's own label choice", () => {
    const s = buildPlotScene(table, plot, { width: 760, height: 640 });
    const [a, b] = s.pie!.panels!;
    expect(a!.slices[0]!.labelText, "pie 1 shows values, as set").toBe("40");
    expect(b!.slices[0]!.labelText, "pie 2 copied pie 1's label choice").toMatch(/%$/);
  });

  it("a label inside a pale two-tone slice is dark; on a strong colour it stays white", () => {
    const s = buildPlotScene(table, plot, { width: 760, height: 640 });
    const inside = s.pie!.panels!.flatMap((p) => p.slices).filter((sl) => sl.labelInside && sl.labelText);
    expect(inside.length, "no label is drawn inside a slice — the fixture proves nothing").toBeGreaterThan(0);
    for (const sl of inside) expect(sl.labelInk, `"${sl.labelText}" on ${sl.color}`).toBe("#111");
    const solid = buildPlotScene(table, { ...plot, seriesStyles: {} } as Plot, { width: 760, height: 640 });
    const strong = solid.pie!.panels!.flatMap((p) => p.slices).filter((sl) => sl.labelInside && sl.labelText);
    expect(strong.length).toBeGreaterThan(0);
    for (const sl of strong) expect(sl.labelInk, `"${sl.labelText}" on ${sl.color}`).toBe(contrastInk(sl.color, "#fff") === "#fff" ? undefined : "#111");
    expect(strong.some((sl) => sl.labelInk === undefined), "every default slice is pale — the white case is never checked").toBe(true);
  });

  it("the ink rule: dark on light, white on dark, the fallback for a colour it cannot read", () => {
    expect(contrastInk("#f5e6b8")).toBe("#111");
    expect(contrastInk("#0072b2")).toBe("#fff");
    expect(contrastInk("var(--x)", "#fff")).toBe("#fff");
  });
});
