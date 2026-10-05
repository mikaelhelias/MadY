/**
 * Pyramid tip labels fit inside the plot (guards against, e.g., a bar of 97 on a 0–100 axis putting its "97" on a
 * row name). The value axis grows just enough for every tip number to sit inside the plot; a
 * pyramid whose numbers already fit keeps its axis; a range the user set is left alone.
 */
import { describe, expect, it } from "vitest";
import type { DataTable, Plot } from "@mady/core";
import { buildPlotScene } from "./buildScene";

const measure = (t: string, px: number): number => t.length * px * 0.55;
function pyramid(left: number[], right: number[], extra: Partial<Plot> = {}) {
  const bands = ["0–14", "15–29", "30–44", "45–59"];
  const table = {
    id: "t", kind: "grouped", name: "t",
    columns: [{ id: "age", name: "Age band", role: "x" }, { id: "m", name: "Male", role: "y" }, { id: "f", name: "Female", role: "y" }],
    rows: bands.map((b, i) => ({ id: `r${i}`, cells: { age: b, m: left[i] ?? null, f: right[i] ?? null } })),
  } as unknown as DataTable;
  const plot = { id: "p", name: "p", source: "t", status: "ok", styleOverrides: {}, kind: "pyramid", pyramid: { showValues: true }, ...extra } as unknown as Plot;
  return buildPlotScene(table, plot, { width: 580, height: 380, measure });
}
/** Every tip number's horizontal extent (anchored at labelX, reaching its measured width). */
function tipLabels(s: ReturnType<typeof pyramid>) {
  return s.annotations.filter((a) => a.id.startsWith("pyr-val-")).map((a) => {
    const w = measure(a.label ?? "", a.fontSize ?? 11);
    const x = a.labelX ?? 0;
    return a.labelAnchor === "end" ? { t: a.label, x0: x - w, x1: x } : { t: a.label, x0: x, x1: x + w };
  });
}

describe("pyramid tip labels fit inside the plot", () => {
  it("a 97 near the axis end: every number stays inside the plot (the axis grew for it)", () => {
    const s = pyramid([41, 59, 97, 56], [40, 60, 70, 50]);
    const labs = tipLabels(s);
    expect(labs.length).toBe(8);
    for (const l of labs) {
      expect(l.x0, `"${l.t}" crosses the plot's left edge`).toBeGreaterThanOrEqual(s.plot.x - 0.5);
      expect(l.x1, `"${l.t}" crosses the plot's right edge`).toBeLessThanOrEqual(s.plot.x + s.plot.width + 0.5);
    }
    expect(Math.max(...s.x.domain.map(Math.abs)), "the axis did not grow — the fixture proves nothing").toBeGreaterThan(100);
  });

  it("numbers that already fit: the axis is exactly the one drawn without numbers", () => {
    // Largest bar 33 on a 0–40 axis: "33" sits well inside. (A bar at the axis end — 40 on 0–40 — does not fit: its
    // number would stick out, so there the axis correctly grows.)
    const withNumbers = pyramid([20, 30, 33, 25], [22, 31, 28, 30]);
    const without = pyramid([20, 30, 33, 25], [22, 31, 28, 30], { pyramid: { showValues: false } } as Partial<Plot>);
    expect(without.x.domain).toEqual([-40, 40]);
    expect(withNumbers.x.domain).toEqual(without.x.domain);
  });

  it("a range the user set is theirs: not grown", () => {
    const s = pyramid([41, 59, 97, 56], [40, 60, 70, 50], { xAxis: { min: -100, max: 100 } });
    expect(s.x.domain.map(Math.abs)).toEqual([100, 100]);
  });
});
