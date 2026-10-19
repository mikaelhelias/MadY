import { describe, expect, it } from "vitest";
import { buildPlotScene } from "./buildScene";
import type { DataTable, Plot } from "@mady/core";

/**
 * Auto-placed brackets stack ABOVE the data, but value domains are built from the data
 * alone — so without headroom the top brackets fall outside the axis and are dropped. The
 * user asks for brackets and gets some, or none, with no way to tell why.
 */
const cat: DataTable = {
  id: "t", kind: "column", name: "T",
  columns: [{ id: "c", name: "G", role: "x" }, { id: "a", name: "A", role: "y" }, { id: "b", name: "B", role: "y" }],
  rows: [
    { id: "r1", cells: { c: "one", a: 5, b: 8 } },
    { id: "r2", cells: { c: "two", a: 9, b: 4 } },
    { id: "r3", cells: { c: "three", a: 6, b: 7 } },
  ],
};

// All three span the same pair at different heights: a box chart’s categories are its
// DATASETS (two here), so an endpoint of 3 would not exist — the drop-reason guard says so.
const stack = (role?: "significance") =>
  [0, 1, 2].map((k) => ({
    id: `b${k}`, kind: "bracket" as const, from: 1, to: 2,
    bracketY: 9 + 9 * (0.06 + k * 0.085), p: 0.001,
    ...(role ? { role } : {}),
  }));

describe("significance brackets get axis headroom", () => {
  for (const kind of ["box", "bar"] as const) {
    it(`${kind}: every auto-placed bracket is drawn, not just the low ones`, () => {
      const s = buildPlotScene(cat, { id: "p", name: "P", source: "t", status: "ok", styleOverrides: {}, kind, annotations: stack("significance") } as unknown as Plot, { width: 520, height: 360 });
      expect(s.annotations.filter((a) => a.kind === "bracket")).toHaveLength(3);
      expect(s.warnings.some((w) => /not drawn/i.test(w))).toBe(false);
    });
  }

  it("a HAND-MADE bracket does not silently grow the axis — no saved figure moves", () => {
    // The headroom is gated on role:"significance", which only auto-placement writes.
    const plain = buildPlotScene(cat, { id: "p", name: "P", source: "t", status: "ok", styleOverrides: {}, kind: "box", annotations: stack() } as unknown as Plot, { width: 520, height: 360 });
    const managed = buildPlotScene(cat, { id: "p", name: "P", source: "t", status: "ok", styleOverrides: {}, kind: "box", annotations: stack("significance") } as unknown as Plot, { width: 520, height: 360 });
    expect(plain.y.domain[1]).toBeLessThan(managed.y.domain[1]);
  });
});
