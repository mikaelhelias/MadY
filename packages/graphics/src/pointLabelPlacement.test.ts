// @vitest-environment node
/**
 * A point label may not sit on anything either.
 *
 * Guards against drawing a gene name on a volcano, or a value beside a scatter dot, at a fixed
 * offset — always the same side, whatever is already there. With more than a handful of
 * labelled points, fixed offsets land on each other, on neighbouring dots, and along the
 * connecting line.
 *
 * Every fixture here is deliberately crowded: points close enough that a fixed offset
 * collides. A roomy fixture would pass without the placement rule and prove nothing.
 */
import { describe, expect, it } from "vitest";
import type { DataTable, Plot } from "@mady/core";
import { buildPlotScene } from "./buildScene";

const SIZE = { width: 520, height: 360 };
const FONT = 9;
const measure = (t: string, px: number) => t.length * px * 0.6;

/** Where a point label is actually drawn, as a box. */
const boxOf = (s: ReturnType<typeof buildPlotScene>, seriesId: string, rowId: string) => {
  const series = s.series.find((x) => x.id === seriesId)!;
  const m = series.marks.find((x) => x.rowId === rowId)!;
  const text = m.valueText || m.pointLabel || "";
  const w = measure(text, series.pointLabelSize ?? s.fonts.valueLabel.size) * 1.15;
  const x = m.pointLabelDx != null ? m.cx + m.pointLabelDx : m.cx + (m.symbolSize ?? series.symbolSize) + 3;
  const y = m.pointLabelDy != null ? m.cy + m.pointLabelDy : m.cy;
  const h = (series.pointLabelSize ?? s.fonts.valueLabel.size) * 0.6;
  return { id: `${seriesId}:${rowId}`, x1: m.pointLabelAnchor === "end" ? x - w : x, x2: (m.pointLabelAnchor === "end" ? x : x + w), y1: y - h, y2: y + h };
};
const hit = (a: { x1: number; y1: number; x2: number; y2: number }, b: { x1: number; y1: number; x2: number; y2: number }) =>
  a.x1 < b.x2 && b.x1 < a.x2 && a.y1 < b.y2 && b.y1 < a.y2;

/**
 * A crowded volcano: nine genes packed into one corner, plus two far-out points that stretch
 * the axes. Note: without those two the nine spread across the whole plot — the builder scales
 * to the data — and nothing would collide even without the rule.
 */
const geneTable: DataTable = {
  id: "tg", kind: "xy", name: "tg",
  columns: [{ id: "fc", name: "log2FC", role: "x" }, { id: "p", name: "-log10p", role: "y" }, { id: "gene", name: "Gene" }],
  rows: [
    ...Array.from({ length: 9 }, (_v, i) => ({
      id: `g${i}`,
      cells: { fc: 1.6 + (i % 3) * 0.12, p: 3.4 + Math.floor(i / 3) * 0.16, gene: `GENE${i}A` },
    })),
    { id: "far1", cells: { fc: -7, p: 0.2, gene: "FAR1" } },
    { id: "far2", cells: { fc: 7, p: 9, gene: "FAR2" } },
  ],
};
const volcano = (over: Partial<Plot> = {}): Plot => ({
  id: "p", name: "P", source: "tg", status: "ok", styleOverrides: {}, kind: "volcano",
  seriesStyles: { p: { pointLabels: "col", pointLabelColumn: "gene", pointLabelSize: FONT } },
  ...over,
} as Plot);
const built = (over: Partial<Plot> = {}) => buildPlotScene(geneTable, volcano(over), SIZE);
const labelled = (s: ReturnType<typeof buildPlotScene>) =>
  s.series.flatMap((x) => x.marks.filter((m) => m.pointLabel).map((m) => boxOf(s, x.id, m.rowId)));

describe("crowded point labels", () => {
  it("the fixture really is crowded — the points are closer than a label is wide", () => {
    const s = built();
    const marks = s.series[0]!.marks;
    expect(marks).toHaveLength(11);
    const dx = Math.abs(marks[1]!.cx - marks[0]!.cx);
    expect(measure("GENE0A", FONT), "the labels are narrower than the gap — nothing would collide")
      .toBeGreaterThan(dx);
  });

  it("no label sits on a data point", () => {
    const s = built();
    for (const b of labelled(s)) {
      for (const series of s.series) {
        for (const m of series.marks) {
          const r = Math.max(2, m.symbolSize ?? series.symbolSize ?? 4);
          expect(hit(b, { x1: m.cx - r, y1: m.cy - r, x2: m.cx + r, y2: m.cy + r }), `${b.id} sits on a point`).toBe(false);
        }
      }
    }
  });

  it("no label sits on another label", () => {
    const bs = labelled(built());
    expect(bs.length).toBe(11);
    for (let i = 0; i < bs.length; i++) {
      for (let j = i + 1; j < bs.length; j++) {
        expect(hit(bs[i]!, bs[j]!), `${bs[i]!.id} and ${bs[j]!.id} print through each other`).toBe(false);
      }
    }
  });

  it("no label sits on a threshold guide — a volcano's fold-change and p lines", () => {
    // Guards against gene names printed across the ±1 fold-change lines of a volcano.
    // A guide is chrome like an axis.
    const s = built();
    const guides = s.annotations.filter((a) => a.kind === "line" || a.kind === "segment");
    expect(guides.length, "no threshold lines — this case would prove nothing").toBeGreaterThan(1);
    for (const b2 of labelled(s)) {
      for (const g of guides) {
        for (let t = 0; t <= 1.0001; t += 0.02) {
          const x = g.x1! + (g.x2! - g.x1!) * t;
          const y = g.y1! + (g.y2! - g.y1!) * t;
          expect(hit(b2, { x1: x - 1.5, y1: y - 1.5, x2: x + 1.5, y2: y + 1.5 }), `${b2.id} sits on a guide line`).toBe(false);
        }
      }
    }
  });

  it("no label leaves the plot", () => {
    const s = built();
    for (const b of labelled(s)) {
      expect(b.x1, `${b.id} runs off the left`).toBeGreaterThanOrEqual(s.plot.x - 1);
      expect(b.x2, `${b.id} runs off the right`).toBeLessThanOrEqual(s.plot.x + s.plot.width + 1);
      expect(b.y1).toBeGreaterThanOrEqual(s.plot.y - 1);
      expect(b.y2).toBeLessThanOrEqual(s.plot.y + s.plot.height + 1);
    }
  });

  it("the user's drag is untouched — the rule places, it never overwrites their nudge", () => {
    // valueDx/valueDy are the user's store; the renderer adds them on top of the placement.
    const s = buildPlotScene(
      geneTable,
      volcano({ pointNudges: { "p:g0": { dx: 20, dy: -12 } } } as Partial<Plot>),
      SIZE,
    );
    const m = s.series[0]!.marks.find((x) => x.rowId === "g0")!;
    expect(m.pointLabelDx, "the rule did not place it at all").toBeDefined();
    // whatever the user's own offset mechanism carries, the builder must not have written it
    expect(m.valueDx === undefined || m.valueDx === 20).toBe(true);
  });
});

describe("a scatter with values labelled", () => {
  /**
   * Note: the points have to be close and the line has to zig-zag, or the default
   * label position (right of the marker, same y) never meets the line and the case below
   * would pass without the rule. Two far points stretch the axes so the eight stay tight.
   */
  const xyTable: DataTable = {
    id: "tx", kind: "xy", name: "tx",
    columns: [{ id: "x", name: "X", role: "x" }, { id: "y", name: "Y", role: "y" }],
    rows: [
      ...Array.from({ length: 8 }, (_v, i) => ({ id: `r${i}`, cells: { x: 5 + i * 0.04, y: 10 + (i % 2) * 0.9 } })),
      { id: "lo", cells: { x: 0, y: 5 } },
      { id: "hi", cells: { x: 12, y: 16 } },
    ],
  };
  const s = () => buildPlotScene(
    xyTable,
    { id: "p", name: "P", source: "tx", status: "ok", styleOverrides: {}, kind: "xy", seriesStyles: { y: { pointLabels: "y", pointLabelSize: FONT } } } as Plot,
    SIZE,
  );

  it("no value label sits on a point or on the connecting line", () => {
    const sc = s();
    const line = sc.series[0]!;
    expect(line.linePath, "no line in this fixture — the line case would prove nothing").toBeTruthy();
    for (const b of labelled(sc)) {
      for (let i = 1; i < line.marks.length; i++) {
        const a = line.marks[i - 1]!;
        const c = line.marks[i]!;
        for (let t = 0; t <= 1.0001; t += 0.05) {
          const x = a.cx + (c.cx - a.cx) * t;
          const y = a.cy + (c.cy - a.cy) * t;
          expect(hit(b, { x1: x - 1.5, y1: y - 1.5, x2: x + 1.5, y2: y + 1.5 }), `${b.id} sits on the line`).toBe(false);
        }
      }
    }
  });

  it("says so when it runs out of room rather than stacking labels silently", () => {
    // 40 points in a thumbnail: there is no way to place them all, and the graph must say so.
    const many: DataTable = {
      ...xyTable,
      rows: Array.from({ length: 40 }, (_v, i) => ({ id: `r${i}`, cells: { x: 1 + i * 0.01, y: 10 + (i % 3) * 0.05 } })),
    };
    const sc = buildPlotScene(
      many,
      { id: "p", name: "P", source: "tx", status: "ok", styleOverrides: {}, kind: "xy", seriesStyles: { y: { pointLabels: "y", pointLabelSize: FONT } } } as Plot,
      { width: 240, height: 180 },
    );
    expect(sc.warnings.some((w) => /point label/i.test(w)), `warnings were ${JSON.stringify(sc.warnings)}`).toBe(true);
  });
});
