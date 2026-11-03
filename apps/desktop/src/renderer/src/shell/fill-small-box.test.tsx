// @vitest-environment jsdom
/**
 * A chord, a rose and a 3-D scatter fill a small box: the graph always occupies as much space as possible.
 * Laid out at a figure card's size with Keep proportions off, full-size text would take the room from the drawing.
 * The chord's name room is measured per name in its own direction, the rose's ring may sit under its legend, and
 * all three shrink their names just enough to fill (never below 8 px), saying so when that size was set. At their own
 * size and at the default 580×380 the rose and the 3-D scatter keep full-size text; the chord keeps its 20 px names at
 * its own size.
 * The radar's own guard is packages/graphics/src/radar-fill.test.ts.
 */
import { describe, expect, it } from "vitest";
import { buildPlotScene } from "@mady/graphics";
import type { Plot } from "@mady/core";
import { galleryItems } from "./gallery";
import { measureText } from "./textMeasure";

const card = (title: string) => galleryItems().find((x) => x.title === title)!;

describe("chord: the ring fills its box", () => {
  const g = card("Chord / circos");
  const at = (w: number, h: number, showTitle = false) => buildPlotScene(g.table, { ...g.plot, showTitle } as Plot, { measure: measureText, width: w, height: h });
  it("at its own size the names keep their 20 px and nothing is said", () => {
    const s = at(g.plot.figureWidth ?? 700, g.plot.figureHeight ?? 620, true);
    expect(s.chord!.labelSize).toBe(20);
    expect(s.warnings.filter((x) => x.startsWith("Chord names"))).toEqual([]);
  });
  for (const [w, h] of [[378, 259], [350, 227], [580, 380], [230, 400]] as const) {
    it(`${w}×${h} (a card, no title): the ring is ≥ 35% of the shorter side, every name inside the box, text ≥ 8 px`, () => {
      const s = at(w, h);
      const c = s.chord!;
      expect((2 * c.r) / Math.min(w, h), `ring ${Math.round(2 * c.r)} px in ${w}×${h}`).toBeGreaterThanOrEqual(0.35);
      expect(c.labelSize).toBeGreaterThanOrEqual(8);
      expect(c.arcs.filter((a) => a.showLabel).length, "every node keeps its name").toBe(c.arcs.length);
      for (const a of c.arcs) {
        const tw = measureText(a.name, c.labelSize);
        const ang = ((a.labelAngle + (a.labelAnchor === "end" ? 180 : 0)) * Math.PI) / 180;
        const ex = a.labelX + Math.cos(ang) * tw;
        const ey = a.labelY + Math.sin(ang) * tw;
        expect(ex >= -0.5 && ex <= w + 0.5 && ey >= -0.5 && ey <= h + 0.5, `"${a.name}" runs past the box edge`).toBe(true);
      }
      if (c.labelSize < 20) expect(s.warnings.some((x) => x.startsWith("Chord names are drawn at"))).toBe(true);
    });
  }
});

describe("rose: the ring fills its box", () => {
  const g = card("Polar histogram (wind rose)");
  const at = (w: number, h: number) => buildPlotScene(g.table, { ...g.plot, showTitle: false } as Plot, { measure: measureText, width: w, height: h });
  for (const [w, h] of [[g.plot.figureWidth ?? 640, g.plot.figureHeight ?? 600], [580, 380]] as const) {
    it(`${w}×${h}: full-size labels, nothing said`, () => {
      const s = at(w, h);
      expect(s.fonts.tick.size).toBe(20);
      expect(s.warnings.filter((x) => x.startsWith("Rose direction labels"))).toEqual([]);
    });
  }
  for (const [w, h] of [[230, 400], [260, 180], [350, 227]] as const) {
    it(`${w}×${h} (a card): the ring spans ≥ 50% of the shorter side, text ≥ 8 px`, () => {
      const s = at(w, h);
      const rose = s.rose!;
      expect((2 * rose.maxR) / Math.min(w, h), `ring ${Math.round(2 * rose.maxR)} px in ${w}×${h}`).toBeGreaterThanOrEqual(0.5);
      expect(s.fonts.tick.size).toBeGreaterThanOrEqual(8);
      if (s.fonts.tick.size < 20) expect(s.warnings.some((x) => x.startsWith("Rose direction labels are drawn at"))).toBe(true);
    });
  }
});

describe("3-D scatter: the cube fills its box", () => {
  const g = card("3D scatter");
  const cube = (s: ReturnType<typeof buildPlotScene>): number => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    const pt = (x: number, y: number) => { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); };
    for (const a of s.scatter3d!.axes) if (!a.hidden) { pt(a.x1, a.y1); pt(a.x2, a.y2); }
    for (const f of s.scatter3d!.floor) { pt(f.x1, f.y1); pt(f.x2, f.y2); }
    return Math.max((x1 - x0) / s.width, (y1 - y0) / s.height);
  };
  const at = (w: number, h: number) => buildPlotScene(g.table, { ...g.plot, showTitle: false } as Plot, { measure: measureText, width: w, height: h });
  for (const [w, h] of [[g.plot.figureWidth ?? 720, g.plot.figureHeight ?? 608], [580, 380]] as const) {
    it(`${w}×${h}: full-size text, nothing said`, () => {
      const s = at(w, h);
      expect(s.fonts.axisTitle.size).toBe(22);
      expect(s.warnings.filter((x) => x.startsWith("3-D axis names"))).toEqual([]);
    });
  }
  for (const [w, h] of [[378, 259], [350, 227]] as const) {
    it(`${w}×${h} (a card): the cube spans ≥ 50% of the box, text ≥ 8 px, and it says so (its sizes are set)`, () => {
      const s = at(w, h);
      expect(cube(s), `cube in ${w}×${h}`).toBeGreaterThanOrEqual(0.5);
      expect(s.fonts.tick.size).toBeGreaterThanOrEqual(8);
      expect(s.fonts.axisTitle.size).toBeGreaterThanOrEqual(8);
      expect(s.warnings.some((x) => x.startsWith("3-D axis names are drawn at"))).toBe(true);
    });
  }
});
