/**
 * The correlation key matches the cells. Each key is the same mark as the cells' at the value it names: the pie's
 * wedge, the circle whose area follows |r|, the colour-only square, the tilted ellipse. A matrix
 * of bare numbers has no colour or shape to key, so it draws no key and says so.
 */
import { describe, expect, it } from "vitest";
import type { DataTable, Plot } from "@mady/core";
import { buildPlotScene } from "./buildScene";

const table = {
  id: "t", kind: "multivariable", name: "t",
  columns: [{ id: "s", name: "Subject", role: "x" }, { id: "a", name: "A", role: "y" }, { id: "b", name: "B", role: "y" }, { id: "c", name: "C", role: "y" }],
  rows: [[1, 2, 9], [2, 4, 7], [3, 5, 8], [4, 8, 4], [5, 9, 5], [6, 11, 1]].map((r, i) => ({ id: `r${i}`, cells: { s: `S${i + 1}`, a: r[0], b: r[1], c: r[2] } })),
} as unknown as DataTable;
const build = (glyph: string, extra: Record<string, unknown> = {}) =>
  buildPlotScene(table, { id: "p", name: "p", source: "t", status: "ok", styleOverrides: {}, kind: "corrmatrix", corrmatrix: { glyph, triangle: "full", ...extra } } as unknown as Plot, { width: 640, height: 480 });

const keys = (glyph: string) => build(glyph).corrmatrix!.scaleLegend!.items;
const radius = (path: string): number => Number(/A ([\d.]+) /.exec(path)![1]);
const value = (label: string): number => Number(label);

describe("the correlation key is drawn in the cells' own mark", () => {
  it("pie: a wedge in an outlined circle", () => {
    for (const it of keys("pie")) expect(it.outlinePath).not.toBe("");
    expect(keys("pie")[0]!.glyphPath).toMatch(/^M [\d.]+ [\d.]+ A /); // the full circle at +1
  });

  it("circle: a disc whose area follows |r|, no outline, in the cells' colours", () => {
    const ks = keys("circle");
    for (const it of ks) expect(it.outlinePath, "a circle key has no pie outline").toBe("");
    const full = radius(ks.find((k) => value(k.label) === 1)!.glyphPath);
    const quarter = radius(ks.find((k) => value(k.label) === 0.25)!.glyphPath);
    expect(quarter / full).toBeCloseTo(Math.sqrt(0.25), 3);
    // +1 and -1 are the same size and differ in colour only.
    expect(radius(ks.find((k) => value(k.label) === -1)!.glyphPath)).toBeCloseTo(full, 6);
    expect(ks.find((k) => value(k.label) === 1)!.color).not.toBe(ks.find((k) => value(k.label) === -1)!.color);
  });

  it("square: colour only — every key the same square, no outline", () => {
    const ks = keys("square");
    for (const it of ks) {
      expect(it.outlinePath).toBe("");
      expect(it.glyphPath, "a square key is a square").toMatch(/^M [-\d.]+ [-\d.]+ H [-\d.]+ V [-\d.]+ H [-\d.]+ Z$/);
    }
    const side = (p: string) => { const n = p.match(/[-\d.]+/g)!.map(Number); return n[2]! - n[0]!; };
    const sides = ks.map((k) => side(k.glyphPath));
    expect(Math.max(...sides) - Math.min(...sides)).toBeLessThan(1e-6);
    expect(new Set(ks.map((k) => k.color)).size, "the keys differ by colour").toBeGreaterThan(2);
  });

  it("ellipse: a polygon that leans one way for + and the other for -, and is a line at +-1", () => {
    const ks = keys("ellipse");
    for (const it of ks) { expect(it.outlinePath).toBe(""); expect(it.glyphPath).toMatch(/^M .* L .* Z$/); }
    // The lean is the sign of the covariance of the outline's points (screen y runs down, so "/" is negative).
    const stats = (p: string) => {
      const n = p.match(/[-\d.]+/g)!.map(Number);
      const xs = n.filter((_, i) => i % 2 === 0), ys = n.filter((_, i) => i % 2 === 1);
      const mx = xs.reduce((a, b) => a + b, 0) / xs.length, my = ys.reduce((a, b) => a + b, 0) / ys.length;
      const cov = xs.reduce((s, x, i) => s + (x - mx) * (ys[i]! - my), 0) / xs.length;
      const vx = xs.reduce((s, x) => s + (x - mx) ** 2, 0) / xs.length, vy = ys.reduce((s, y) => s + (y - my) ** 2, 0) / ys.length;
      return { cov, vx, vy };
    };
    const pos = stats(ks.find((k) => value(k.label) === 0.5)!.glyphPath);
    const neg = stats(ks.find((k) => value(k.label) === -0.5)!.glyphPath);
    expect(Math.sign(pos.cov)).toBe(-Math.sign(neg.cov));
    expect(Math.abs(pos.cov)).toBeGreaterThan(1);
    const one = stats(ks.find((k) => value(k.label) === 1)!.glyphPath);
    expect(one.cov ** 2 / (one.vx * one.vy), "a perfect correlation is a line").toBeCloseTo(1, 3);
  });
  it("the +1 key is coloured as the r = 1 cell on the diagonal", () => {
    for (const g of ["pie", "circle", "square", "ellipse"]) {
      const s = build(g);
      const diag = s.corrmatrix!.cells.find((c) => c.row === 0 && c.col === 0)!;
      expect(s.corrmatrix!.scaleLegend!.items.find((k) => value(k.label) === 1)!.color, g).toBe(diag.color);
    }
  });

  it("numbers: nothing is coloured or shaped, so no key is drawn, the room is given back, and the figure says so", () => {
    const s = build("number");
    expect(s.corrmatrix!.scaleLegend).toBeUndefined();
    expect(s.warnings.join(" ")).toMatch(/key/i);
    expect(s.plot.width, "the key's room was kept").toBeGreaterThan(build("pie").plot.width - 1);
  });

  it("numbers with the key switched off say nothing", () => {
    expect(build("number", { showLegend: false }).warnings.join(" ")).not.toMatch(/key/i);
  });
});
