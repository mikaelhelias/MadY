// @vitest-environment jsdom
/**
 * The column labels' pivot comes from the builder, not from a constant in the figure.
 *
 * A rotated column label anchored at its end and rotated about that point hangs down-left by
 * `width × sin(angle)`. Two simpler rules fail: a flat 5 px lift lets the labels drop into the
 * first row of cells at 45°, and lifting every label by the longest one's drop leaves a short name
 * floating far above its column. So a tilted label starts at the top of its own column and rises up-right: it
 * cannot reach the cells, and it touches its column whatever its length.
 *
 * What this file can and cannot prove: jsdom has no text metrics, so it cannot measure where
 * a rotated label's box lands — `e2e/heatmap-label-rotation.spec.ts` does that in a real
 * browser. What it can prove, and what keeps the lift from being a constant in the figure, is the wiring:
 * every tilted label is anchored at its start, a small fixed gap above the grid, the reserved band
 * is tall enough for the tallest label, and the `y` the figure draws at is exactly
 * `plot.y − colLabelLift`.
 */
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { buildPlotScene } from "@mady/graphics";
import type { DataTable, Plot } from "@mady/core";
import { PlotFigure } from "./PlotFigure";

const table = {
  id: "t1", name: "Expression", kind: "xy",
  columns: [
    { id: "c0", name: "Gene", role: "x" },
    { id: "c1", name: "Control" },
    { id: "c2", name: "Drug A" },
    { id: "c3", name: "Combination therapy" },
  ],
  rows: [
    { id: "r1", cells: { c0: "GeneA", c1: 1, c2: 2.2, c3: 6 } },
    { id: "r2", cells: { c0: "GeneB", c1: 6, c2: 4.8, c3: 1 } },
    { id: "r3", cells: { c0: "GeneC", c1: 2, c2: 2.1, c3: 2.2 } },
  ],
} as unknown as DataTable;

const scene = (rotation?: number) =>
  buildPlotScene(
    table,
    { id: "p1", name: "hm", table: "t1", kind: "heatmap", heatmap: rotation ? { labelRotation: rotation } : {} } as unknown as Plot,
    { width: 580, height: 380 },
  );

describe("the heatmap's rotated column labels", () => {
  it("the fixture can exhibit labels hanging into the cells — long names, drawn, rotatable", () => {
    // Short names would hang by a few px and a flat 5 px constant would look fine.
    // "Combination therapy" is ~100 px at 12 px, so at 45° it drops ~70 px into the cells.
    const s = scene(45);
    expect(s.heatmap?.colLabels.map((c) => c.label)).toContain("Combination therapy");
    expect(s.heatmap?.labelRotation).toBe(45);
  });

  it("every label starts the same small gap above the grid, at every angle — none floats, none hangs into the cells", () => {
    // Anchored at its start and rising, a label's lowest point is its start: a fixed 5 px above the grid, whatever its
    // length. (Anchored at its end and lifted by the longest name, "Control" would float ~50 px higher than needed.)
    for (const a of [0, 15, 30, 45, 60, 90]) expect(scene(a || undefined)!.heatmap!.colLabelLift, `at ${a}°`).toBe(5);
  });

  it("the band above the grid is tall enough for the tallest tilted label", () => {
    // Rising from the grid, the longest name reaches width × sin(angle) up: the figure must have that room above.
    for (const a of [30, 45, 60, 90]) {
      const s = scene(a)!;
      const tallest = Math.max(...s.heatmap!.colLabels.map((c) => c.label.length * 12 * 0.6)) * Math.sin((a * Math.PI) / 180);
      expect(s.plot.y - s.heatmap!.colLabelLift, `at ${a}° the tallest label leaves the figure`).toBeGreaterThan(tallest * 0.9);
    }
  });

  it("the margin the builder reserves is big enough for the lift it asks for", () => {
    // The two numbers come from the same place and must not drift: if the pivot is lifted higher
    // than the reserved band, the label leaves the figure instead of the cells.
    for (const a of [0, 30, 45, 60, 90]) {
      const s = scene(a || undefined)!;
      expect(s.plot.y, `at ${a}° the reserved top margin is under the lift`).toBeGreaterThan(s.heatmap!.colLabelLift);
    }
  });

  it("the figure draws the labels at plot.y − colLabelLift — not at a constant of its own", () => {
    const s = scene(45)!;
    const { container } = render(<PlotFigure scene={s} />);
    const texts = [...container.querySelectorAll("text")].filter((t) => t.textContent === "Combination therapy");
    expect(texts.length, "the column label was not drawn").toBe(1);
    const y = Number(texts[0]!.getAttribute("y"));
    expect(y, "the figure is not using the builder's lift").toBeCloseTo(s.plot.y - s.heatmap!.colLabelLift, 5);
    expect(texts[0]!.getAttribute("transform") ?? "", "the label is not rotated").toContain("rotate(-45");
    expect(texts[0]!.getAttribute("text-anchor"), "a tilted label must start at its column").toBe("start");
  });
});
