// @vitest-environment jsdom
/**
 * Text is measured in the font it is drawn in. Guards against measuring tick labels in the app's sans-serif when the
 * graph draws them in a wider font: with Match Fonts setting 30 px Georgia on every panel, the ROC's axis numbers would
 * collide ("0 0.20.40.60.8 1") because the collision check sees narrower text. `buildPlotScene` passes the graph's own
 * tick font to every measurement.
 */
import { describe, expect, it } from "vitest";
import { buildPlotScene } from "@mady/graphics";
import type { Plot } from "@mady/core";
import { galleryItems } from "./gallery";

// A measure that knows Georgia is wider than the app font (as it is on screen).
const measure = (t: string, px: number, family?: string | null): number => t.length * px * (family?.includes("Georgia") ? 0.72 : 0.5);

describe("the builder measures text in the graph's own font", () => {
  const g = galleryItems().find((x) => x.title === "ROC curve")!;
  const georgia = { ...g.plot, fonts: { ...(g.plot.fonts ?? {}), tick: { size: 30, family: "Georgia" } }, xAxisLength: 300, yAxisLength: 200 } as Plot;

  it("every measurement is asked in the graph's tick font", () => {
    const seen = new Set<string>();
    buildPlotScene(g.table, georgia, { width: 900, height: 700, measure: (t, px, fam) => { seen.add(String(fam)); return measure(t, px, fam); } });
    expect([...seen]).toEqual(["Georgia"]);
  });

  it("ROC at 30 px Georgia on the aligned 300 px axis: the numbers do not collide", () => {
    const s = buildPlotScene(g.table, georgia, { width: 900, height: 700, measure });
    const px = s.fonts.xTick.size;
    const boxes = s.x.ticks.filter((t) => t.label).map((t) => ({ l: t.label, a: t.pos - measure(t.label, px, "Georgia") / 2, b: t.pos + measure(t.label, px, "Georgia") / 2 })).sort((p, q) => p.a - q.a);
    expect(boxes.length, "fixture: some numbers are drawn").toBeGreaterThan(1);
    const hits: string[] = [];
    for (let i = 1; i < boxes.length; i++) if (boxes[i]!.a < boxes[i - 1]!.b) hits.push(`${boxes[i - 1]!.l} × ${boxes[i]!.l}`);
    expect(hits).toEqual([]);
  });

  it("a graph in the app font is measured with no font family asked", () => {
    const plain = { ...g.plot, fonts: { ...(g.plot.fonts ?? {}), tick: { size: 20 } } } as Plot;
    const seen = new Set<string>();
    buildPlotScene(g.table, plain, { width: 580, height: 380, measure: (t, px, fam) => { seen.add(String(fam)); return measure(t, px, fam); } });
    expect([...seen]).toEqual(["undefined"]);
  });
});

describe("a network drops no node name while a smaller one fits", () => {
  const g = galleryItems().find((x) => x.title === "Network graph")!;
  const m = (t: string, px: number): number => t.length * px * 0.56;
  for (const [label, px, w, h] of [["Match Fonts: 30 px names", 30, 580, 380], ["its own 16 px names at 580×380", 16, 580, 380]] as const) {
    it(`${label}: every node keeps its name, never below 8 px, no two names overlap`, () => {
      const plot = { ...g.plot, network: { ...(g.plot.network ?? {}), labelSize: px } } as Plot;
      const s = buildPlotScene(g.table, plot, { width: w, height: h, measure: m });
      const nw = s.network!;
      const named = nw.nodes.filter((n) => n.label);
      expect(named.length, "names drawn").toBe(nw.nodes.length);
      expect(nw.labelSize).toBeGreaterThanOrEqual(8);
      const boxes = named.map((n) => {
        const tw = m(n.label!, nw.labelSize);
        const x = n.cx + (n.labelDx ?? n.r + 3);
        const x1 = n.labelAnchor === "end" ? x - tw : x;
        const y = n.cy + (n.labelDy ?? 0);
        return { l: n.label!, x1, x2: x1 + tw, y1: y - nw.labelSize * 0.7, y2: y + nw.labelSize * 0.3 };
      });
      const hits: string[] = [];
      for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
        const A = boxes[i]!, B = boxes[j]!;
        if (Math.min(A.x2, B.x2) - Math.max(A.x1, B.x1) > 0.5 && Math.min(A.y2, B.y2) - Math.max(A.y1, B.y1) > 0.5) hits.push(`${A.l} × ${B.l}`);
      }
      expect(hits).toEqual([]);
      expect(s.warnings.filter((x) => x.startsWith("Node names")), "fitted quietly — every name is still drawn").toEqual([]);
    });
  }
  it("in a card too small for every name even at 8 px, a name is dropped only at 8 px — never while a smaller one fits", () => {
    // 420×260: the nodes sit too close for three names at any readable size (a real geometric limit).
    const s = buildPlotScene(g.table, { ...g.plot, network: { ...(g.plot.network ?? {}), labelSize: 30 } } as Plot, { width: 420, height: 260, measure: m });
    const nw = s.network!;
    expect(nw.nodes.filter((n) => !n.label).length, "fixture: some names cannot be placed").toBeGreaterThan(0);
    expect(nw.labelSize).toBe(8);
  });
});

describe("a category name is never hidden while a smaller one fits", () => {
  const m = (t: string, px: number): number => t.length * px * 0.56;
  const names = (s: ReturnType<typeof buildPlotScene>) => s.x.ticks.filter((t) => !t.minor && t.label).map((t) => t.label);
  for (const [title, w, h] of [["Simple column bar (one factor)", 580, 380], ["Simple column bar (one factor)", 420, 300], ["Box & whisker", 420, 300]] as const) {
    it(`${title} at 30 px names in ${w}×${h}: every category named, no two names touch, never below 8 px`, () => {
      const g = galleryItems().find((x) => x.title === title)!;
      const plot = { ...g.plot, fonts: { ...(g.plot.fonts ?? {}), tick: { size: 30 } } } as Plot;
      const s = buildPlotScene(g.table, plot, { width: w, height: h, measure: m });
      const all = s.x.ticks.filter((t) => !t.minor && (t.label || t.suppressedLabel));
      expect(all.length, "fixture: a category axis").toBeGreaterThan(1);
      expect(names(s).length, `named: ${names(s).join(", ")}`).toBe(all.length);
      const px = s.fonts.xTick.size;
      expect(px).toBeGreaterThanOrEqual(8);
      const boxes = s.x.ticks.filter((t) => t.label).map((t) => ({ l: t.label, a: t.pos - m(t.label, px) / 2, b: t.pos + m(t.label, px) / 2 })).sort((p, q) => p.a - q.a);
      for (let i = 1; i < boxes.length; i++) expect(boxes[i]!.a, `${boxes[i - 1]!.l} touches ${boxes[i]!.l}`).toBeGreaterThanOrEqual(boxes[i - 1]!.b);
    });
  }
});
