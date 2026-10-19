import { describe, it, expect } from "vitest";
import type { DataTable, Plot } from "@mady/core";
import { buildPlotScene } from "./buildScene.js";
import { snapRegionBox } from "./snapRegion.js";

// A 3-category diverging bar plot (purchases up, sales down).
const table: DataTable = {
  id: "d", kind: "column", name: "D",
  columns: [
    { id: "m", name: "Month", role: "x" },
    { id: "buy", name: "Purchases", role: "y" },
    { id: "sell", name: "Sales", role: "y" },
  ],
  rows: [
    { id: "r1", cells: { m: "Q1", buy: 52, sell: -12 } },
    { id: "r2", cells: { m: "Q2", buy: 46, sell: -42 } },
    { id: "r3", cells: { m: "Q3", buy: 33, sell: -20 } },
  ],
};
const plot: Plot = { id: "p", name: "P", source: "d", status: "ok", styleOverrides: {}, kind: "bar", barLayout: "overlay" };
const scene = buildPlotScene(table, plot, { width: 500, height: 320 });
const pr = scene.plot;

// Recover the pixel rect of a fractional box for assertions.
const px = (b: NonNullable<ReturnType<typeof snapRegionBox>>) => ({
  x1: pr.x + b.x * pr.width,
  y1: pr.y + b.y * pr.height,
  x2: pr.x + (b.x + b.w) * pr.width,
  y2: pr.y + (b.y + b.h) * pr.height,
});

describe("snapRegionBox", () => {
  it("frames a whole category (rowId) across both series, with a margin", () => {
    const box = snapRegionBox(scene, { rowId: "r1" }, 8)!;
    expect(box).not.toBeNull();
    const b = px(box);
    // Q1 = the purchases (+52, up) and sales (-12, down) bars for row r1.
    const q1bars = scene.series.flatMap((s) => s.marks.filter((m) => m.rowId === "r1").map((m) => m.bar!)).filter(Boolean);
    const minX = Math.min(...q1bars.map((r) => r.x));
    const maxX = Math.max(...q1bars.map((r) => r.x + r.w));
    const minY = Math.min(...q1bars.map((r) => r.y));
    const maxY = Math.max(...q1bars.map((r) => r.y + r.h));
    // The box encloses the whole column (up + down) with an ~8px margin on each side.
    expect(b.x1).toBeGreaterThanOrEqual(pr.x - 0.5);
    expect(b.x1).toBeLessThan(minX);
    expect(b.x2).toBeGreaterThan(maxX);
    expect(b.y1).toBeLessThan(minY);
    expect(b.y2).toBeGreaterThan(maxY);
    expect(minX - b.x1).toBeCloseTo(8, 0);
    expect(maxY < b.y2 && b.y2 - maxY <= 9).toBe(true);
  });

  it("a later category snaps to a different (rightward) column", () => {
    const q1 = px(snapRegionBox(scene, { rowId: "r1" })!);
    const q3 = px(snapRegionBox(scene, { rowId: "r3" })!);
    expect(q3.x1).toBeGreaterThan(q1.x1); // Q3 is to the right of Q1
  });

  it("a series selection (columnId, no rowId) frames that series across all categories", () => {
    const box = snapRegionBox(scene, { columnId: "buy" })!;
    const b = px(box);
    // The purchases series spans all three category x-slots but stays above the baseline.
    const buyBars = scene.series.find((s) => s.id === "buy")!.marks.map((m) => m.bar!);
    const maxBottom = Math.max(...buyBars.map((r) => r.y + r.h));
    const sellBottom = Math.max(...scene.series.find((s) => s.id === "sell")!.marks.map((m) => m.bar!.y + m.bar!.h));
    expect(b.x2 - b.x1).toBeGreaterThan(pr.width * 0.6); // wide (all categories)
    expect(b.y2).toBeLessThan(sellBottom); // doesn't reach the sales (negative) bars
    expect(b.y2).toBeGreaterThanOrEqual(maxBottom); // but covers the purchases baseline
  });

  it("no selection frames the whole data area", () => {
    const box = snapRegionBox(scene, null)!;
    const b = px(box);
    expect(b.x2 - b.x1).toBeGreaterThan(pr.width * 0.7);
    expect(b.y2 - b.y1).toBeGreaterThan(pr.height * 0.5);
  });

  it("clamps to the plot rect and returns a valid [0,1] box", () => {
    const box = snapRegionBox(scene, null, 999)!; // huge margin → clamps to the plot rect
    expect(box.x).toBeCloseTo(0, 6);
    expect(box.y).toBeCloseTo(0, 6);
    expect(box.x + box.w).toBeCloseTo(1, 6);
    expect(box.y + box.h).toBeCloseTo(1, 6);
  });

  it("returns null for a scene with no series marks (e.g. an empty selection target)", () => {
    const empty: DataTable = { id: "e", kind: "column", name: "E", columns: [{ id: "m", name: "M", role: "x" }, { id: "y", name: "Y", role: "y" }], rows: [] };
    const s = buildPlotScene(empty, { ...plot, source: "e" }, { width: 400, height: 300 });
    expect(snapRegionBox(s, { rowId: "nope" })).toBeNull();
  });
});
