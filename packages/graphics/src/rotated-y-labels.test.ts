// Rotated Y labels — stay left of the plot, the Y title clears them, and turned category names that are longer
// than their rows are drawn level with a warning. Label corners come from SVG's
// rotate() arithmetic with ordinary glyph ratios (0.55 of the font per character, 0.8 above the baseline, 0.2
// below), not the builder's own text measure.
import { describe, expect, it } from "vitest";
import type { DataTable, Plot } from "@mady/core";
import { buildPlotScene } from "./buildScene.js";
import type { PlotScene } from "./scene.js";
import { yTickLabelPlacement } from "./xTickLabel.js";

const three: DataTable = {
  id: "t", kind: "column", name: "T",
  columns: [{ id: "c", name: "Group", role: "x" }, { id: "v", name: "Value", role: "y" }],
  rows: [
    { id: "r0", cells: { c: "Control", v: 5 } },
    { id: "r1", cells: { c: "Low dose", v: 8 } },
    { id: "r2", cells: { c: "High dose", v: 7 } },
  ],
};
const crowded: DataTable = {
  ...three,
  rows: Array.from({ length: 25 }, (_, i) => ({ id: `r${i}`, cells: { c: `Player number ${i + 1}`, v: 50 + i } })),
};
const mk = (over: Partial<Plot>): Plot => ({ id: "p", name: "P", source: "t", status: "ok", styleOverrides: {}, kind: "bar", ...over });

type Pt = { x: number; y: number };
function drawnYLabelQuads(s: PlotScene): { label: string; pts: Pt[] }[] {
  const rot = s.y.tickRotation ?? 0;
  const font = s.fonts.yTick.size;
  const a = (rot * Math.PI) / 180;
  return s.y.ticks.filter((t) => !t.minor && t.label !== "").map((t) => {
    const w = t.label.length * font * 0.55;
    const p = yTickLabelPlacement(t.pos, s.plot.x, font, s.axisGaps?.yTick ?? 8, rot, w);
    const x0 = p.anchor === "start" ? p.x : p.anchor === "end" ? p.x - w : p.x - w / 2;
    const cx = p.pivot?.x ?? p.x;
    const cy = p.pivot?.y ?? p.y;
    const pts = [[x0, p.y - 0.8 * font], [x0 + w, p.y - 0.8 * font], [x0 + w, p.y + 0.2 * font], [x0, p.y + 0.2 * font]]
      .map(([x, y]) => ({ x: cx + (x! - cx) * Math.cos(a) - (y! - cy) * Math.sin(a), y: cy + (x! - cx) * Math.sin(a) + (y! - cy) * Math.cos(a) }));
    return { label: t.label, pts };
  });
}

describe("rotated Y labels", () => {
  for (const rot of [45, 90, -45, -90]) {
    it(`${rot}° on a number axis: every label stays left of the plot and the Y title stays left of every label`, () => {
      // Single-digit numbers in a large font: a turned "8" reaches further left than its flat width, so a title
      // placed from the flat width would sit on the labels (e.g. on the "4" of a volcano plot).
      const s = buildPlotScene(three, mk({ yAxis: { title: "Value", tickRotation: rot, min: 0, max: 8, tickFont: { size: 24 } } }), { width: 480, height: 360 });
      expect(s.y.tickRotation).toBe(rot);
      const quads = drawnYLabelQuads(s);
      expect(quads.length).toBeGreaterThan(2);
      for (const q of quads) for (const c of q.pts) expect(c.x, `"${q.label}" reaches into the plot`).toBeLessThanOrEqual(s.plot.x);
      // The title is drawn turned −90° about titlePos: its glyphs reach 0.2 of its size to the right.
      const titleFont = s.y.titleFont ?? s.fonts.yAxisTitle.size;
      expect(s.y.titlePos, "no placed Y title").toBeTypeOf("number");
      const leftmost = Math.min(...quads.flatMap((q) => q.pts.map((c) => c.x)));
      expect(s.y.titlePos! + 0.2 * titleFont, `${rot}°: the Y title sits on the labels`).toBeLessThanOrEqual(leftmost);
      expect(s.y.titlePos! - 0.8 * titleFont, `${rot}°: the Y title runs off the figure`).toBeGreaterThanOrEqual(0);
    });

    it(`${rot}° on a category axis with room: the names keep the turn, stay left of the plot, and ±90° sits on its tick`, () => {
      const s = buildPlotScene(three, mk({ barOrientation: "horizontal", xAxis: { tickRotation: rot } }), { width: 420, height: 320 });
      expect(s.y.tickRotation, `${rot}°: the turn was dropped though the names fit`).toBe(rot);
      expect(s.warnings.join(" ")).not.toMatch(/drawn level/);
      for (const q of drawnYLabelQuads(s)) {
        for (const c of q.pts) expect(c.x).toBeLessThanOrEqual(s.plot.x);
        if (Math.abs(rot) === 90) {
          const tick = s.y.ticks.find((t) => t.label === q.label)!.pos;
          const ys = q.pts.map((c) => c.y);
          expect(Math.abs((Math.min(...ys) + Math.max(...ys)) / 2 - tick), `"${q.label}" is not centred on its tick`).toBeLessThan(1);
        }
      }
    });
  }

  // Short category names in a large font on a horizontal bar chart: turned, "P7" reaches further left than its
  // flat width, so a category margin sized from the flat width is too narrow (e.g. "P07" × "Patient" on the
  // waterfall). Fixture choice: the Y title already sits against the figure's left edge, so a clash needs a
  // turned name to reach further past its flat width than the gap between the labels and the title. "P01" at
  // 24px turned 45° reaches to 19.7 against a title ending at 19.2 — clear even with the widening switched off,
  // so it cannot show the defect. A one-letter name at 36px is ~20px wide flat but reaches ~43px turned. It
  // must be the shared tick font: this builder measures names with it, so a per-axis font would leave spare
  // room. Four rows keep 45° and 90° from being crowded and drawn level.
  const shortNames: DataTable = {
    ...three,
    rows: ["D", "C", "B", "A"].map((c, i) => ({ id: `r${i}`, cells: { c, v: 40 - 10 * i } })),
  };
  for (const rot of [45, -45, 90, -90]) {
    it(`${rot}° on short category names: the category margin makes room, so the Y title stays left of every name`, () => {
      const s = buildPlotScene(shortNames, mk({ barOrientation: "horizontal", fonts: { tick: { size: 36 } }, xAxis: { title: "Patient", tickRotation: rot } }));
      expect(s.y.tickRotation, `${rot}°: the turn was dropped`).toBe(rot);
      const quads = drawnYLabelQuads(s);
      expect(quads.length).toBe(4);
      const titleFont = s.y.titleFont ?? s.fonts.yAxisTitle.size;
      expect(s.y.titlePos, "no placed Y title").toBeTypeOf("number");
      const leftmost = Math.min(...quads.flatMap((q) => q.pts.map((c) => c.x)));
      expect(s.y.titlePos! + 0.2 * titleFont, `${rot}°: the Y title sits on the names`).toBeLessThanOrEqual(leftmost);
      for (const q of quads) for (const c of q.pts) expect(c.x, `"${q.label}" reaches into the plot`).toBeLessThanOrEqual(s.plot.x);
    });
  }

  // Turning labels must never make the left margin smaller than the flat labels had. A number turned 90° needs
  // only its line height of room; if the margin shrank to that, the plot would grow wider, and on a chart held
  // at a 1:1 aspect (the ordination biplot) the wider plot would change the Y range and could drop the top tick.
  // Rotating a label is not a reason for the axis to show different values.
  it("turning wide number labels to ±90° leaves the plot area exactly where the flat labels put it", () => {
    const wide = (rot: number | undefined) =>
      buildPlotScene(three, mk({ yAxis: { title: "Value", tickRotation: rot, min: 0, max: 1_000_000 } }), { width: 480, height: 360 });
    const flat = wide(undefined);
    expect(Math.max(...flat.y.ticks.filter((t) => !t.minor).map((t) => t.label.length)), "the fixture's labels are not wide — it cannot show the margin shrinking").toBeGreaterThan(4);
    for (const rot of [90, -90]) {
      const s = wide(rot);
      expect(s.y.tickRotation).toBe(rot);
      expect(s.plot.x, `${rot}°: the left margin shrank, so the plot moved`).toBe(flat.plot.x);
      expect(s.plot.width).toBe(flat.plot.width);
    }
  });

  it("names longer than their rows are drawn level at 90° and 45°, and the chart says why", () => {
    for (const rot of [90, -90, 45]) {
      const s = buildPlotScene(crowded, mk({ barOrientation: "horizontal", xAxis: { tickRotation: rot } }), { width: 500, height: 320 });
      expect(s.y.tickRotation, `${rot}°: crowded names were still turned`).toBeUndefined();
      expect(s.warnings.join(" ")).toMatch(new RegExp(`names are drawn level: turned ${rot}°`));
      expect(s.y.ticks.filter((t) => !t.minor && t.label !== "").length, "a name was hidden").toBeGreaterThan(0);
    }
  });

  it("the same crowded names drawn level from the start carry no warning", () => {
    const s = buildPlotScene(crowded, mk({ barOrientation: "horizontal" }), { width: 500, height: 320 });
    expect(s.warnings.join(" ")).not.toMatch(/drawn level/);
  });
});
