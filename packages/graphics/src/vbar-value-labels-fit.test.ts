/**
 * Vertical bar numbers fit the bars: 30 bars with two-decimal numbers in a 640 px figure print no number on top of
 * another. Like the horizontal bars' numbers (`hbar-value-labels-fit.test.ts`), they shrink to fit down to the
 * smallest readable size and are thinned only past that, and the figure says when a number is dropped.
 */
import { describe, expect, it } from "vitest";
import type { DataTable, Plot } from "@mady/core";
import { buildPlotScene } from "./buildScene";
import { fmtValueLabel, valueLabelPlace } from "./valueLabelPlace";

const measure = (t: string, s: number): number => t.length * s * 0.6;

function vbar(rows: number, series: number, extra: Partial<Plot> = {}, width = 640, valueOf = (i: number, k: number) => Math.max(3, 200 - i * 5 - k * 7) / 100) {
  const ids = Array.from({ length: series }, (_, k) => `s${k}`);
  const table = {
    id: "t", kind: "column", name: "t",
    columns: [{ id: "x", name: "Well", role: "x" }, ...ids.map((id) => ({ id, name: id, role: "y" }))],
    rows: Array.from({ length: rows }, (_, i) => ({ id: `r${i}`, cells: { x: `W${i + 1}`, ...Object.fromEntries(ids.map((id, k) => [id, valueOf(i, k)])) } })),
  } as unknown as DataTable;
  const plot = { id: "p", name: "p", source: "t", status: "ok", styleOverrides: {}, kind: "bar", showValues: true, valueDecimals: 2, ...extra } as unknown as Plot;
  return buildPlotScene(table, plot, { width, height: 420, measure });
}

/** Pairs of drawn numbers that print on each other, by an independent pairwise check at the drawn size. */
function collisions(s: ReturnType<typeof vbar>): number {
  const size = s.fonts.valueLabel.size;
  const boxes = s.series.flatMap((ser) => ser.marks.filter((m) => m.bar && Number.isFinite(m.dy) && m.valueText !== "").map((m) => {
    const text = m.valueText ?? fmtValueLabel(m.dy, s.valueLabels?.decimals);
    const p = valueLabelPlace(s, m.bar!, m.dy, text, undefined);
    const w = measure(text, size);
    return { x1: p.baseX - w / 2, x2: p.baseX + w / 2, y1: p.baseY - size * 0.8, y2: p.baseY + size * 0.2 };
  }));
  let n = 0;
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
    const a = boxes[i]!, b = boxes[j]!;
    if (a.x1 < b.x2 && b.x1 < a.x2 && a.y1 < b.y2 && b.y1 < a.y2) n++;
  }
  return n;
}
const shown = (s: ReturnType<typeof vbar>) => s.series.flatMap((ser) => ser.marks.filter((m) => m.bar && m.valueText !== "")).length;

describe("vertical bar numbers fit the bars", () => {
  it("22 bars, two decimals: the numbers shrink until none prints on another, and none is dropped", () => {
    const full = vbar(4, 1).fonts.valueLabel.size;
    const s = vbar(22, 1);
    expect(s.fonts.valueLabel.size, "the numbers were never shrunk — the fixture proves nothing").toBeLessThan(full);
    expect(s.fonts.valueLabel.size).toBeGreaterThanOrEqual(7);
    expect(collisions(s)).toBe(0);
    expect(shown(s), "a number was dropped though shrinking was enough").toBe(22);
  });

  it("30 bars, two decimals: nothing prints on anything, whether shrunk or thinned", () => {
    const s = vbar(30, 1);
    expect(collisions(s)).toBe(0);
    expect(s.fonts.valueLabel.size).toBeLessThan(vbar(2, 1).fonts.valueLabel.size);
  });

  it("a roomy chart keeps the size asked for and every number", () => {
    const s = vbar(6, 1);
    expect(s.fonts.valueLabel.size).toBe(vbar(2, 1).fonts.valueLabel.size);
    expect(shown(s)).toBe(6);
    expect(s.warnings.join(" ")).not.toMatch(/number/i);
  });

  it("three series side by side: numbers of neighbouring bars clear each other", () => {
    const s = vbar(14, 3);
    expect(s.fonts.valueLabel.size, "not shrunk — the fixture proves nothing").toBeLessThan(vbar(2, 3).fonts.valueLabel.size);
    expect(collisions(s)).toBe(0);
  });

  it("hundreds of bars: past the readable size every k-th number is kept, evenly, and the figure says so", () => {
    const s = vbar(200, 1);
    expect(s.fonts.valueLabel.size).toBe(7);
    expect(shown(s), "nothing was thinned — the fixture proves nothing").toBeLessThan(200);
    expect(shown(s)).toBeGreaterThan(5);
    expect(collisions(s)).toBe(0);
    expect(s.warnings.join(" ")).toMatch(/numbers? .*(not drawn|left out|hidden)/i);
  });

  it("a size the user asked for that had to shrink is reported, as on horizontal bars", () => {
    const s = vbar(30, 1, { fonts: { valueLabel: { size: 14 } } } as Partial<Plot>);
    expect(s.fonts.valueLabel.size).toBeLessThan(14);
    expect(s.warnings.join(" ")).toMatch(/14px/);
  });

  it("stacked columns with thin segments: the numbers of one column clear each other", () => {
    const s = vbar(4, 40, { barLayout: "stacked", valueDecimals: 0 } as Partial<Plot>, 640, () => 1);
    expect(s.fonts.valueLabel.size < vbar(2, 1).fonts.valueLabel.size || shown(s) < 160, "no crowding — the fixture proves nothing").toBe(true);
    expect(collisions(s)).toBe(0);
  });
});
