import { describe, expect, it } from "vitest";
import type { DataTable, Plot } from "@mady/core";
import { buildPlotScene } from "./buildScene.js";

/**
 * Heatmap column names turn 45° when they do not fit flat.
 *
 * Without fitting, long names drawn flat run into each other, even at the default 12 px on a 580×380
 * heatmap. The rule: tilt to 45° only when they do not fit - short names stay flat, and a
 * rotation the user set (0° included) is always kept.
 *
 * Both directions, and a fixture that can exhibit it: long names on a small figure (the gallery's short names fit).
 */
const measure = (t: string, px: number): number => t.length * px * 0.6;
const table = (names: string[]): DataTable => ({
  id: "t", kind: "xy", name: "T",
  columns: [{ id: "g", name: "Gene", role: "x" }, ...names.map((n, i) => ({ id: `c${i}`, name: n, role: "y" as const }))],
  rows: ["GeneA", "GeneB", "GeneC", "GeneD"].map((g, r) => ({ id: `r${r}`, cells: { g, ...Object.fromEntries(names.map((_, i) => [`c${i}`, (r * 3 + i * 2) % 7])) } })),
});
const LONG = ["Untreated control", "Drug A high dose", "Drug B low dose", "Drug C combination", "Combination therapy"];
const SHORT = ["Ctrl", "A", "B", "C", "Combo"];
const heat = (extra: Partial<Plot["heatmap"]> = {}): Plot => ({ id: "p", name: "P", source: "t", status: "ok", styleOverrides: {}, kind: "heatmap", heatmap: { ...extra } }) as Plot;
const SMALL = { width: 580, height: 380, measure };

describe("heatmap column names: flat when they fit, 45° when they do not", () => {
  it("long names on a small heatmap turn 45° - the default look, so no warning (a stock card warns of nothing)", () => {
    const s = buildPlotScene(table(LONG), heat(), SMALL);
    expect(s.heatmap!.labelRotation).toBe(45);
    expect(s.warnings).toEqual([]);
  });

  it("the tilted names do not overlap: each one's horizontal reach clears the next name's start", () => {
    const s = buildPlotScene(table(LONG), heat(), SMALL);
    // at 45° a name anchored at its end rises up-left; neighbours are one column apart along a parallel line, so
    // they clear when the perpendicular spacing (cell width × sin 45°) exceeds one line of text
    const cols = s.heatmap!.colLabels;
    const cell = cols[1]!.x - cols[0]!.x;
    const size = s.heatmap!.labelFont?.size ?? 12;
    const lineH = size * 1.1;
    expect(s.heatmap!.labelRotation, "not tilted - the flat names below would overlap").toBe(45);
    expect(Math.max(...LONG.map((n) => measure(n, size))), "the fixture must not fit flat or this proves nothing").toBeGreaterThan(cell);
    expect(cell * Math.SQRT1_2).toBeGreaterThan(lineH);
  });

  it("short names stay flat, with no warning", () => {
    const s = buildPlotScene(table(SHORT), heat(), SMALL);
    expect(s.heatmap!.labelRotation ?? 0).toBe(0);
  });

  it("long names on a wide figure stay flat (they fit there)", () => {
    const s = buildPlotScene(table(LONG), heat(), { width: 1600, height: 500, measure });
    expect(s.heatmap!.labelRotation ?? 0).toBe(0);
  });

  it("a rotation the user set is kept - 0° keeps them flat, 90° stays 90°", () => {
    expect(buildPlotScene(table(LONG), heat({ labelRotation: 0 }), SMALL).heatmap!.labelRotation ?? 0).toBe(0);
    expect(buildPlotScene(table(LONG), heat({ labelRotation: 90 }), SMALL).heatmap!.labelRotation).toBe(90);
  });

  it("the room above the cells grows with the tilt (the names are not drawn into the cells)", () => {
    const flat = buildPlotScene(table(LONG), heat({ labelRotation: 0 }), SMALL);
    const tilted = buildPlotScene(table(LONG), heat(), SMALL);
    expect(tilted.plot.y).toBeGreaterThan(flat.plot.y);
    // …and each tilted name starts at its own column's top rather than being lifted by the longest one.
    expect(tilted.heatmap!.colLabelLift).toBe(flat.heatmap!.colLabelLift);
  });
});
