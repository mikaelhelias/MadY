import { describe, expect, it } from "vitest";
import { buildPlotScene } from "./buildScene";
import type { DataTable, Plot } from "@mady/core";

/**
 * A ladder of significance brackets does not cross its own labels.
 *
 * The significance planner spaces its rungs in data units (a fraction of the data span), which
 * says nothing about how tall a drawn symbol is. On a typical figure — three treatments against
 * one control, stars at 18–26 px — data-unit spacing puts the rungs ~12 px apart, and every rail
 * is drawn straight through the stars of the bracket below it.
 *
 * The builder therefore spreads planned rungs by the ink it measured. This checks the drawing:
 * no label may reach past the rail above it, and the ladder must still be a ladder (rungs in the
 * planned order, none dropped).
 */
const table: DataTable = {
  id: "t",
  kind: "column",
  name: "T",
  columns: [
    { id: "c", name: "G", role: "x" },
    { id: "a", name: "Control", role: "y" },
    { id: "b", name: "Drug A", role: "y" },
    { id: "d", name: "Drug B", role: "y" },
    { id: "e", name: "Drug C", role: "y" },
  ],
  rows: [
    { id: "r1", cells: { c: "1", a: 12, b: 28, d: 19, e: 35 } },
    { id: "r2", cells: { c: "2", a: 15, b: 32, d: 22, e: 39 } },
    { id: "r3", cells: { c: "3", a: 9, b: 24, d: 16, e: 31 } },
  ],
};

/** A bar chart takes its categories from rows, so the same four groups are shaped that way. */
const barTable: DataTable = {
  id: "t",
  kind: "column",
  name: "T",
  columns: [
    { id: "c", name: "Group", role: "x" },
    { id: "m", name: "Mean", role: "y" },
    { id: "m2", name: "Rep 2", role: "y", group: "m" },
    { id: "m3", name: "Rep 3", role: "y", group: "m" },
  ],
  rows: [
    { id: "r1", cells: { c: "Control", m: 12, m2: 15, m3: 9 } },
    { id: "r2", cells: { c: "Drug A", m: 28, m2: 32, m3: 24 } },
    { id: "r3", cells: { c: "Drug B", m: 19, m2: 22, m3: 16 } },
    { id: "r4", cells: { c: "Drug C", m: 35, m2: 39, m3: 31 } },
  ],
};

/** Every treatment against the control: three rungs, the planner's own data-unit ladder. */
function plot(kind: string, fontSize?: number): Plot {
  const span = 39 - 9;
  return {
    id: "p", name: "P", source: "t", status: "ok", styleOverrides: {}, kind,
    annotations: [0, 1, 2].map((k) => ({
      id: `b${k}`, kind: "bracket", role: "significance", from: 1, to: k + 2,
      bracketY: 39 + span * (0.06 + k * 0.085),
      p: [0.001, 0.098, 0.0001][k], plannedY: true, sig: { analysisId: "an1" },
    })),
    significance: { hideNs: false, ...(fontSize ? { font: { size: fontSize } } : {}) },
  } as unknown as Plot;
}

const scene = (kind: string, fontSize?: number) =>
  buildPlotScene(kind === "bar" ? barTable : table, plot(kind, fontSize), { width: 700, height: 500, measure: (t: string, px: number) => t.length * px * 0.6 });

describe("a planned bracket ladder clears its own labels", () => {
  for (const kind of ["box", "bar", "violin", "scatter"]) {
    for (const fontSize of [undefined, 26]) {
      it(`${kind}${fontSize ? ` (${fontSize} px symbols)` : ""}`, () => {
        const s = scene(kind, fontSize);
        const rails = (s.annotations ?? [])
          .filter((a) => a.kind === "bracket" && a.y1 != null && a.labelY != null)
          .map((a) => ({
            id: a.id, rail: a.y1!, lift: Math.abs(a.labelY! - a.y1!), fontSize: a.fontSize ?? 12, label: a.label,
            // The lowest pixel the bracket draws — its end legs, not its rail.
            lowest: Math.max(...[...(a.path ?? "").matchAll(/(-?\d+(?:\.\d+)?)[ ,](-?\d+(?:\.\d+)?)/g)].map((m) => Number(m[2]))),
          }));
        expect(rails.length, "all three rungs are drawn").toBe(3);
        // Rungs run upwards in the planned order (smaller y = higher on an ordinary chart).
        const ys = rails.map((r) => r.rail);
        expect([...ys].sort((p, q) => q - p), `rungs out of order: ${ys.join(", ")}`).toEqual(ys);
        // Checked in both directions, in units of the symbol and against the drawn body — a bracket's end legs
        // hang below its rail, so the rail alone is not what a symbol has to clear. Daylight =
        // the gap between one rung's symbol ink (0.78 em above its baseline, the builder's own
        // allowance) and the lowest pixel of the rung above. It must be positive (no crossing)
        // and no larger than the font-proportional `rungGap` allows (no waste). A fixed gap
        // fails one side or the other as soon as the symbol size changes.
        // Note: model space. The real ink of "★" is a little shorter than 0.78 em, so in the drawn
        // figure the daylight is about 1.5 px larger than measured here.
        for (let i = 1; i < rails.length; i++) {
          const below = rails[i - 1]!;
          const above = rails[i]!;
          const inkTop = below.rail - below.lift - below.fontSize * 0.78;
          const daylight = inkTop - above.lowest; // positive = the symbol clears the rung above
          expect(daylight, `"${below.label}" (${below.fontSize} px) is crossed by the rung above it (${daylight.toFixed(1)} px)`).toBeGreaterThan(0.5);
          expect(daylight, `too much air over "${below.label}": ${daylight.toFixed(1)} px`).toBeLessThanOrEqual(below.fontSize * 0.1 + 2);
        }
      });
    }
  }
});
