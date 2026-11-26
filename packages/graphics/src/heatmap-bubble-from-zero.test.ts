/**
 * A bubble heatmap can size its bubbles from zero.
 *
 * Bubble area runs from the scale's smallest value to its largest, so on scores of 55–92 the 55 gets no bubble (a
 * floor dot) and the 58–64 are dots behind their numbers. "Bubble size from 0" sizes by |value| ÷ the largest |value|
 * and leaves the colours unchanged.
 */
import { describe, expect, it } from "vitest";
import type { DataTable, Plot } from "@mady/core";
import { buildPlotScene } from "./buildScene";

const table = {
  id: "t", kind: "multivariable", name: "Scores",
  columns: [{ id: "n", name: "Athlete", role: "x" }, { id: "a", name: "Sprint", role: "y" }, { id: "b", name: "Endurance", role: "y" }],
  rows: [{ id: "r1", cells: { n: "Ana", a: 55, b: 92 } }, { id: "r2", cells: { n: "Ben", a: 70, b: 80 } }],
} as unknown as DataTable;
const scene = (bubbleFromZero?: boolean) =>
  buildPlotScene(table, { id: "p", name: "P", source: "t", kind: "heatmap", heatmap: { cellShape: "bubble", ...(bubbleFromZero ? { bubbleFromZero } : {}) } } as unknown as Plot, { width: 520, height: 360 });
const cell = (s: ReturnType<typeof scene>, v: number) => s.heatmap!.cells.find((c) => c.value === v)!;

describe("bubble heatmap: size from 0", () => {
  it("off (the default): the smallest value is a floor dot", () => {
    expect(cell(scene(), 55).r).toBeLessThan(2);
  });

  it("on: every value gets a bubble sized by its share of the largest, area ∝ value", () => {
    const s = scene(true);
    const r55 = cell(s, 55).r!, r92 = cell(s, 92).r!;
    expect(r55).toBeGreaterThan(5);
    expect(r55 / r92).toBeCloseTo(Math.sqrt(55 / 92), 6);
  });

  it("on: the colours are the same as off", () => {
    const off = scene(), on = scene(true);
    for (const v of [55, 70, 80, 92]) expect(cell(on, v).color, String(v)).toBe(cell(off, v).color);
  });

  it("a scale crossing zero is sized from zero either way", () => {
    const signed = { ...table, rows: [{ id: "r1", cells: { n: "Ana", a: -0.8, b: 0.4 } }, { id: "r2", cells: { n: "Ben", a: 0.8, b: -0.2 } }] } as unknown as DataTable;
    const build = (z: boolean) => buildPlotScene(signed, { id: "p", name: "P", source: "t", kind: "heatmap", heatmap: { cellShape: "bubble", bubbleFromZero: z } } as unknown as Plot, { width: 520, height: 360 });
    expect(build(true).heatmap!.cells.map((c) => c.r)).toEqual(build(false).heatmap!.cells.map((c) => c.r));
  });
});
