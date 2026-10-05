/**
 * Horizontal bar numbers fit the bars (e.g. 45 rows × 3 series in a small graph draws bars 3 px apart, where
 * full-size numbers would pile onto each other). The numbers follow the names' rule
 * (`fitStackedLabels`): shrink to the gap between neighbouring numbers, thin past the readable floor. With one
 * series the numbers are a whole row apart, so they fit the row exactly as the names do — never the thinner bar.
 */
import { describe, expect, it } from "vitest";
import type { DataTable, Plot } from "@mady/core";
import { buildPlotScene } from "./buildScene";

function hbar(rows: number, series: number, height: number, dots: string[] = []) {
  const ids = Array.from({ length: series }, (_, k) => `s${k}`);
  const table = {
    id: "t", kind: "column", name: "t",
    columns: [{ id: "x", name: "Name", role: "x" }, ...ids.map((id) => ({ id, name: id, role: "y" }))],
    rows: Array.from({ length: rows }, (_, i) => ({ id: `r${i}`, cells: { x: `Row ${i + 1}`, ...Object.fromEntries(ids.map((id, k) => [id, 20 + ((i * 7 + k * 13) % 70)])) } })),
  } as unknown as DataTable;
  const plot = { id: "p", name: "p", source: "t", status: "ok", styleOverrides: {}, kind: "bar", barOrientation: "horizontal", showValues: true,
    seriesStyles: Object.fromEntries(dots.map((id) => [id, { plotAs: "points" }])) } as unknown as Plot;
  return buildPlotScene(table, plot, { width: 600, height });
}
const numbers = (s: ReturnType<typeof hbar>) => s.series.flatMap((ser) => ser.marks.filter((m) => m.bar && m.valueText !== ""));

describe("horizontal bar numbers fit the bars", () => {
  it("3 series, rows too tight: no number is taller than the bar it labels, and neighbours are thinned", () => {
    const s = hbar(45, 3, 620);
    const barH = s.series[0]!.marks[0]!.bar!.h;
    const shown = numbers(s).length;
    expect(shown, "nothing was thinned — the fixture proves nothing").toBeLessThan(45 * 3);
    expect(shown, "every number was dropped").toBeGreaterThan(0);
    expect(s.fonts.valueLabel.size, "the numbers were never shrunk").toBeLessThan(hbar(4, 3, 620).fonts.valueLabel.size);
    // Kept numbers are spaced far enough apart to hold the font: the thinned stride × bar pitch ≥ one line.
    const ys = numbers(s).map((m) => m.bar!.y).sort((a, b) => a - b);
    const gap = Math.min(...ys.slice(1).map((y, i) => y - ys[i]!));
    expect(s.fonts.valueLabel.size * 1.2 + 2, `numbers ${gap.toFixed(1)} px apart at ${s.fonts.valueLabel.size} px (bar ${barH.toFixed(1)} px)`).toBeLessThanOrEqual(gap + 0.01);
  });

  it("one series: the numbers are a row apart — they keep the names' size, never the bar's", () => {
    const s = hbar(25, 1, 480);
    expect(s.fonts.yTick.size, "the names were not shrunk — the fixture proves nothing").toBeLessThan(hbar(4, 1, 480).fonts.yTick.size);
    expect(s.fonts.valueLabel.size).toBe(s.fonts.yTick.size);
    expect(numbers(s).length, "a number was dropped").toBe(25);
  });

  it("one series below the readable floor: numbers are thinned exactly like the names — the same rows keep both", () => {
    const s = hbar(40, 1, 380);
    const byRow = new Map(s.series[0]!.marks.map((m) => [m.bar!.y, m.valueText !== ""]));
    const numbered = [...byRow.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => v);
    const named = [...s.y.ticks].sort((a, b) => a.pos - b.pos).map((t) => !!t.label);
    expect(numbered.filter(Boolean).length, "nothing was thinned — the fixture proves nothing").toBeLessThan(40);
    expect(numbered).toEqual(named);
  });

  it("a series drawn as dots: its numbers are point labels, placed apart by their own placer — never fitted to the rows", () => {
    const full = hbar(4, 1, 620).fonts.valueLabel.size;
    const allDots = hbar(45, 1, 620, ["s0"]);
    expect(allDots.series[0]!.marks.some((m) => m.bar), "the series still draws bars — the fixture proves nothing").toBe(false);
    expect(allDots.fonts.valueLabel.size, "dot numbers were shrunk to the rows").toBe(full);
    // Mixed: the two bar series are still fitted (the dots do not hide them from the count).
    expect(hbar(45, 3, 620, ["s0"]).fonts.valueLabel.size, "the bar numbers beside a dot series were not fitted").toBeLessThan(full);
  });

  it("room to spare: full size, every number drawn", () => {
    const s = hbar(4, 3, 620);
    expect(s.fonts.valueLabel.size).toBe(hbar(4, 3, 900).fonts.valueLabel.size);
    expect(numbers(s).length).toBe(12);
  });
});
