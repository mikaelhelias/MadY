// Rotated X labels — the layout makes room for the length they hang down, and everything written
// beneath them (group names, the axis title) goes below them. Guards against rotated labels running off
// the bottom of the figure or under the title, and against the By-hand group names overlapping
// them. The plot area itself must not move: the canvas grows downward, as it does for the group names.
import { describe, expect, it } from "vitest";
import type { DataTable, Plot } from "@mady/core";
import { buildPlotScene } from "./buildScene.js";
import type { PlotScene } from "./scene.js";
import { xTickLabelPlacement } from "./xTickLabel.js";

const traits: DataTable = {
  id: "t", kind: "column", name: "T",
  columns: [
    { id: "c", name: "Trait", role: "x" },
    { id: "v", name: "Value", role: "y" },
  ],
  rows: [
    { id: "r0", cells: { c: "IQ", v: 5 } },
    { id: "r1", cells: { c: "EA", v: 7 } },
    { id: "r2", cells: { c: "Neuroticism", v: 3 } },
    { id: "r3", cells: { c: "Risk", v: 6 } },
    { id: "r4", cells: { c: "Smoking", v: 4 } },
    { id: "r5", cells: { c: "Drinks", v: 8 } },
  ],
};
const opts = { width: 620, height: 400 };
const mk = (over: Partial<Plot>): Plot => ({ id: "p", name: "P", source: "t", status: "ok", styleOverrides: {}, kind: "bar", ...over });
const TWO_GROUPS = { IQ: "Cognition", EA: "Cognition", Neuroticism: "Cognition", Risk: "Substance", Smoking: "Substance", Drinks: "Substance" };

/**
 * The corners of every X label as the renderer draws it (`xTickLabelPlacement` gives the anchor and the
 * turn), sized with ordinary glyph ratios — 0.55 of the font per character, 0.8 above the baseline, 0.2
 * below — rather than the builder's own text measure, and turned with SVG's rotate() arithmetic.
 */
type Pt = { x: number; y: number };
function drawnLabelQuads(s: PlotScene): Pt[][] {
  const rot = s.x.tickRotation ?? 0;
  const font = s.fonts.xTick.size;
  const a = (rot * Math.PI) / 180;
  const out: Pt[][] = [];
  for (const t of s.x.ticks) {
    if (t.minor || t.label === "") continue;
    const w = t.label.length * font * 0.55;
    const p = xTickLabelPlacement(t.pos, s.plot.y + s.plot.height, font, s.axisGaps?.xTick ?? 6, rot, w);
    const x0 = p.anchor === "start" ? p.x : p.anchor === "end" ? p.x - w : p.x - w / 2;
    const cx = p.pivot?.x ?? p.x;
    const cy = p.pivot?.y ?? p.y;
    // Corners in order round the rectangle.
    out.push([[x0, p.y - 0.8 * font], [x0 + w, p.y - 0.8 * font], [x0 + w, p.y + 0.2 * font], [x0, p.y + 0.2 * font]]
      .map(([x, y]) => ({ x: cx + (x! - cx) * Math.cos(a) - (y! - cy) * Math.sin(a), y: cy + (x! - cx) * Math.sin(a) + (y! - cy) * Math.cos(a) })));
  }
  return out;
}
const drawnLabelCorners = (s: PlotScene): Pt[] => drawnLabelQuads(s).flat();

/** Do two drawn (possibly turned) rectangles overlap by more than `tol` px? Separating-axis test. */
function quadsOverlap(qa: Pt[], qb: Pt[], tol = 0.5): boolean {
  for (const q of [qa, qb]) {
    for (let k = 0; k < 4; k++) {
      const p1 = q[k]!;
      const p2 = q[(k + 1) % 4]!;
      const nx = p1.y - p2.y;
      const ny = p2.x - p1.x;
      const len = Math.hypot(nx, ny) || 1;
      const proj = (pts: Pt[]) => pts.map((p) => (p.x * nx + p.y * ny) / len);
      const pa = proj(qa);
      const pb = proj(qb);
      if (Math.min(Math.max(...pa), Math.max(...pb)) - Math.max(Math.min(...pa), Math.min(...pb)) <= tol) return false;
    }
  }
  return true;
}

describe("rotated X labels", () => {
  for (const rot of [45, 90, -45, -90]) {
    it(`${rot}°: the figure grows to hold the labels; they stay below the plot, on the canvas, above the title`, () => {
      const flat = buildPlotScene(traits, mk({ xAxis: { title: "Trait" } }), opts);
      const s = buildPlotScene(traits, mk({ xAxis: { title: "Trait", tickRotation: rot } }), opts);
      const pts = drawnLabelCorners(s);
      const lowest = Math.max(...pts.map((p) => p.y));
      expect(lowest, "the labels do not reach past the unrotated figure — this fixture cannot show labels running off the figure").toBeGreaterThan(flat.height);
      expect(s.plot, "the plot area moved — the canvas should grow instead").toEqual(flat.plot);
      for (const p of pts) {
        expect(p.y, "a label reaches up into the plot").toBeGreaterThan(s.plot.y + s.plot.height);
        expect(p.y, "a label runs off the bottom of the figure").toBeLessThanOrEqual(s.height);
        expect(p.x).toBeGreaterThanOrEqual(0);
        expect(p.x).toBeLessThanOrEqual(s.width);
      }
      const titleFont = s.x.titleFont ?? s.fonts.xAxisTitle.size;
      expect(s.x.titlePos, "no placed X title").toBeTypeOf("number");
      expect(s.x.titlePos! - 0.8 * titleFont, "the title sits on the labels").toBeGreaterThan(lowest);
      expect(s.x.titlePos! + 0.2 * titleFont, "the title runs off the bottom of the figure").toBeLessThanOrEqual(s.height);
    });

    it(`${rot}°: group names sit below the lowest label, and the title below the names`, () => {
      const s = buildPlotScene(traits, mk({ xAxis: { title: "Trait", tickRotation: rot, categoryGroups: { map: TWO_GROUPS } } }), opts);
      const lowest = Math.max(...drawnLabelCorners(s).map((p) => p.y));
      const nameFont = s.fonts.legend.size;
      const names = (s.categoryGroups ?? []).filter((g) => g.name).map((g) => g.name!);
      expect(names, "the fixture draws no group names — it cannot show a collision").toHaveLength(2);
      for (const n of names) {
        expect(n.y - 0.8 * nameFont, "a group name sits on the labels").toBeGreaterThan(lowest);
        expect(n.y + 0.2 * nameFont, "a group name runs off the bottom of the figure").toBeLessThanOrEqual(s.height);
      }
      const titleFont = s.x.titleFont ?? s.fonts.xAxisTitle.size;
      expect(s.x.titlePos! - 0.8 * titleFont, "the title sits on the group names").toBeGreaterThan(Math.max(...names.map((n) => n.y + 0.2 * nameFont)));
      expect(s.x.titlePos! + 0.2 * titleFont).toBeLessThanOrEqual(s.height);
    });
  }

  // Twelve long names on a narrow figure: horizontally most of them must be hidden to avoid collisions.
  const crowded: DataTable = {
    id: "t", kind: "column", name: "T",
    columns: [{ id: "c", name: "Cause", role: "x" }, { id: "v", name: "Count", role: "y" }],
    rows: Array.from({ length: 12 }, (_, i) => ({ id: `r${i}`, cells: { c: `Failure mode ${i + 1}`, v: 12 - i } })),
  };
  const narrow = { width: 420, height: 360 };
  const shownNames = (s: PlotScene) => s.x.ticks.filter((t) => !t.minor && t.label !== "").map((t) => t.label);

  it("a name hidden for room on a crowded axis comes back when the labels are turned 90°, and no two touch", () => {
    const flat = buildPlotScene(crowded, mk({ source: "t" }), narrow);
    expect(shownNames(flat).length, "no name is hidden when horizontal — this fixture cannot show a hidden name coming back").toBeLessThan(12);
    for (const rot of [90, -90]) {
      const s = buildPlotScene(crowded, mk({ source: "t", xAxis: { tickRotation: rot } }), narrow);
      expect(shownNames(s), `${rot}°: names still hidden although a turned label needs only a line of room`).toHaveLength(12);
      const quads = drawnLabelQuads(s);
      for (let i = 1; i < quads.length; i++) expect(quadsOverlap(quads[i - 1]!, quads[i]!), `${rot}°: labels ${i} and ${i + 1} touch`).toBe(false);
    }
  });

  it("at 45° more names show than horizontally, none of them touching; a hidden name keeps its text", () => {
    const flat = buildPlotScene(crowded, mk({ source: "t" }), narrow);
    for (const rot of [45, -45]) {
      const s = buildPlotScene(crowded, mk({ source: "t", xAxis: { tickRotation: rot } }), narrow);
      expect(shownNames(s).length).toBeGreaterThan(shownNames(flat).length);
      const quads = drawnLabelQuads(s);
      for (let i = 0; i < quads.length; i++) {
        for (let j = i + 1; j < quads.length; j++) expect(quadsOverlap(quads[i]!, quads[j]!), `${rot}°: labels ${i + 1} and ${j + 1} touch`).toBe(false);
      }
      for (const t of s.x.ticks.filter((k) => !k.minor && k.label === "")) expect(t.suppressedLabel).toMatch(/^Failure mode/);
    }
  });
});
