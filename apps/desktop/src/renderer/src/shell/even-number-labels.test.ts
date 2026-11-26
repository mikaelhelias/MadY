/**
 * Numbers along an axis that are thinned for room keep an even step: 0, 40, 80 … — never 0, 20, 60, 100,
 * which reads as an axis with a missing or misplaced tick.
 *
 * A builder that drops crowded labels left to right (keep a label whenever it clears the last one kept)
 * gives exactly that uneven run, and leaves the even rule that runs afterwards (`thinCrowdedNumbers`)
 * nothing to fix. Measured over every gallery card, at its own size and squeezed narrow.
 */
import { describe, expect, it } from "vitest";
import type { AxisScene } from "@mady/graphics";
import { buildPlotScene } from "@mady/graphics";
import type { DataTable, Plot } from "@mady/core";
import { galleryItems } from "./gallery";
import { scenePaletteOpt } from "./scenePalette";

const measure = (t: string, px: number): number => t.length * px * 0.6;

/** For a numeric axis: the steps (in tick positions) between the labels left shown, when thinning made them uneven. */
function unevenSteps(ax: AxisScene | undefined): number[] | null {
  if (!ax || ax.band || ax.hidden || ax.tickRotation) return null;
  const majors = ax.ticks.filter((t) => !t.minor && (t.label !== "" || t.suppressedLabel)).sort((a, b) => a.value - b.value);
  if (majors.length < 3 || !majors.every((t) => /^[−-]?[\d.,]+%?$/.test((t.label || t.suppressedLabel || "").trim()))) return null;
  const kept = majors.flatMap((t, i) => (t.label !== "" ? [i] : []));
  if (kept.length < 2 || kept.length === majors.length) return null;
  const steps = kept.slice(1).map((v, i) => v - kept[i]!);
  return steps.every((s) => s === steps[0]) ? null : steps;
}

describe("thinned numbers keep an even step", () => {
  const items = galleryItems();
  for (const [label, size] of [["card size", null], ["320 px", { width: 320, height: 300 }], ["420 px", { width: 420, height: 320 }], ["520 px", { width: 520, height: 360 }], ["580 px", { width: 580, height: 380 }]] as const) {
    it(`every gallery card, ${label}`, () => {
      const bad: string[] = [];
      for (const item of items) {
        const scene = buildPlotScene(item.table, item.plot, { measure, ...(size ?? {}), ...scenePaletteOpt(item.plot) });
        for (const [name, ax] of [["x", scene.x], ["y", scene.y]] as const) {
          const s = unevenSteps(ax);
          if (s) bad.push(`${item.title} [${item.plot.kind}] ${name}: steps ${s.join(",")} — ${ax.ticks.filter((t) => !t.minor).map((t) => t.label || "·").join(" ")}`);
        }
      }
      expect(bad).toEqual([]);
    });
  }
});

describe("a survival curve's day axis", () => {
  // Two Kaplan-Meier curves over 171 days: ticks every 20 days, too many to label at a panel's width.
  const curve = (label: string, times: number[]) => ({ label, times, surv: times.map((_, i) => 1 - i / times.length), censorTimes: [] });
  const plot = {
    id: "p", name: "S", source: "t", status: "ok", styleOverrides: {}, kind: "survival",
    survival: [curve("Standard chow", [0, 3, 6, 9, 15, 18, 28, 36, 40, 53, 57, 58, 69, 113, 115, 131, 136, 141, 149, 151, 171]), curve("Low-fat diet", [0, 12, 30, 47, 66, 90, 120, 150, 171])],
  } as unknown as Plot;
  const table = { id: "t", kind: "survival", name: "Days", columns: [], rows: [] } as unknown as DataTable;
  it("at every width from 260 to 900 px, the day labels left step evenly", () => {
    const bad: string[] = [];
    for (let w = 260; w <= 900; w += 20) {
      const ax = buildPlotScene(table, plot, { measure, width: w, height: 380 }).x;
      const s = unevenSteps(ax);
      if (s) bad.push(`${w} px: ${ax.ticks.filter((t) => !t.minor).map((t) => t.label || "·").join(" ")}`);
    }
    expect(bad).toEqual([]);
  });
});