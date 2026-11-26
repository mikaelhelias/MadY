// @vitest-environment node
/**
 * Direct labels — the series named on the drawing instead of in a legend box
 * (`legend.position` = "direct").
 *
 * What must hold, and what each check would catch:
 *  • choosing it draws no legend — otherwise the figure carries a key and the names, which is
 *    the redundancy the whole option exists to remove;
 *  • it gives the plot back the margin an outside column was using;
 *  • every name is placed clear of the data, by the same rule every other label obeys;
 *  • a row that names nothing with geometry is refused with a warning, never silently dropped;
 *  • the user's drag rides on top and the untouched names move around it.
 *
 * Note: the fixture is deliberately crowded — four series ending within a few pixels of each
 * other. With room to spare every name lands at its first candidate spot and the placement rule
 * is never exercised, so the test would pass without measuring anything.
 */
import { describe, expect, it } from "vitest";
import type { DataTable, Plot } from "@mady/core";
import { buildPlotScene } from "./buildScene";

const SIZE = { width: 520, height: 360 };
const measure = (t: string, px: number): number => t.length * px * 0.6;

/** Four curves that converge: their last points sit within a few px, so the four names cannot
 *  all take the spot beside their own end. */
const table: DataTable = {
  id: "t", kind: "xy", name: "convergent",
  columns: [
    { id: "x", name: "Week", role: "x", type: "number" },
    { id: "a", name: "Treated high", role: "y", type: "number" },
    { id: "b", name: "Treated low", role: "y", type: "number" },
    { id: "c", name: "Vehicle", role: "y", type: "number" },
    { id: "d", name: "Untreated", role: "y", type: "number" },
  ],
  rows: [0, 1, 2, 3, 4, 5].map((i) => ({
    id: `r${i}`,
    cells: { x: i, a: 10 - i * 0.9, b: 6 + i * 0.16, c: 2 + i * 0.9, d: 0 + i * 1.3 },
  })),
};
const base: Plot = { id: "p", status: "ok", styleOverrides: {}, source: "t", name: "p", kind: "xy" };
const direct: Plot = { ...base, legend: { show: true, position: "direct" } };
const right: Plot = { ...base, legend: { show: true, position: "right" } };

const build = (p: Plot) => buildPlotScene(table, p, { ...SIZE, measure });

/** The box a direct label actually occupies, offsets and all. */
const boxOf = (s: ReturnType<typeof build>, id: string) => {
  const ser = s.series.find((x) => x.id === id)!;
  const d = ser.directLabel!;
  const w = measure(d.text, s.fonts.legend.size) * 1.15;
  const h = s.fonts.legend.size * 0.6;
  const x = d.x + (d.offset?.dx ?? 0);
  const y = d.y + (d.offset?.dy ?? 0);
  return { x1: d.anchor === "end" ? x - w : x, x2: d.anchor === "end" ? x : x + w, y1: y - h, y2: y + h };
};
type Box = ReturnType<typeof boxOf>;
const hits = (a: Box, b: Box): boolean => a.x1 < b.x2 && b.x1 < a.x2 && a.y1 < b.y2 && b.y1 < a.y2;

describe("direct labels", () => {
  /**
   * The legend stays the default. Direct labels are opt-in, and this pins it: the regular
   * legend by default, labels on the chart only when chosen.
   *
   * A graph that never asked for them — a brand-new one, or one saved before the option
   * existed — must draw the ordinary legend and no names on the chart. This fails the moment a preset, a
   * kind default or the builder's own fallback starts choosing "direct" for anyone.
   */
  it("a graph that did not ask for them keeps its ordinary legend", () => {
    for (const [what, plot] of [
      ["a brand-new graph, no legend setting at all", base],
      ["the legend switched on, nothing else chosen", { ...base, legend: { show: true } }],
      ["a legend explicitly placed in a corner", { ...base, legend: { show: true, position: "topleft" } }],
    ] as [string, Plot][]) {
      const s = build(plot);
      expect(s.legendLayout.position, `${what}: the default position moved`).not.toBe("direct");
      expect(s.legend.length, `${what}: the legend rows disappeared`).toBeGreaterThan(0);
      expect(s.series.every((x) => x.directLabel == null), `${what}: names appeared on the chart uninvited`).toBe(true);
    }
  });

  it("names every series and draws no legend at all", () => {
    const s = build(direct);
    expect(s.legend).toHaveLength(0);
    expect(s.legendLayout.position).toBe("direct");
    expect(s.series.map((x) => x.directLabel != null)).toEqual([true, true, true, true]);
    expect(s.warnings).toEqual([]);
  });

  it("gives the plot back the margin the outside legend column was taking", () => {
    // Wider than with the column, and exactly as wide as with no legend at all — the second
    // half is the sharp one: it fails the moment "direct" reserves so much as a pixel for a
    // key it does not draw.
    expect(build(direct).plot.width).toBeGreaterThan(build(right).plot.width + 20);
    expect(build(direct).plot.width).toBe(build({ ...base, legend: { show: false } }).plot.width);
  });

  /**
   * Note: this is deliberately not a distance limit (every name within a few line-heights of
   * its series). These four curves end inside a 32 px band and each name is ~90 px wide, so they
   * cannot all sit beside their own end. The placer fans them out, which is right; a radius rule
   * would call that a defect and the only way to pass it would be to print the names through
   * each other.
   *
   * What actually has to hold is the pairing: a name that had to move far carries a thread back
   * to the point it names. Near names get none — a line to a word already beside its point is
   * clutter — so this checks the rule in both directions.
   */
  it("every name that had to move keeps a thread back to its own series", () => {
    const s = build(direct);
    let far = 0;
    for (const ser of s.series) {
      const last = ser.marks[ser.marks.length - 1]!;
      const d = ser.directLabel!;
      const dist = Math.hypot(d.x - last.cx, d.y - last.cy);
      if (dist > s.fonts.legend.size * 2.5) {
        far++;
        expect(d.leader, `"${ser.name}" moved ${dist.toFixed(0)}px and has no leader`).toBeTruthy();
        // The thread must start at the point it names, not somewhere else on the chart.
        expect(Math.hypot(d.leader!.x1 - last.cx, d.leader!.y1 - last.cy)).toBeLessThan(s.fonts.legend.size * 3);
      }
    }
    // The fixture is crowded on purpose: if nothing had to move, it stopped measuring anything.
    expect(far, "no name was displaced — the fixture is no longer crowded").toBeGreaterThan(0);
  });

  it("keeps the names off each other and off the data", () => {
    const s = build(direct);
    const boxes = s.series.map((x) => boxOf(s, x.id));
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        expect(hits(boxes[i]!, boxes[j]!), `"${s.series[i]!.name}" overlaps "${s.series[j]!.name}"`).toBe(false);
      }
    }
    for (const b of boxes) {
      for (const ser of s.series) {
        for (const m of ser.marks) {
          const r = Math.max(2, m.symbolSize ?? ser.symbolSize ?? 4);
          expect(hits(b, { x1: m.cx - r, x2: m.cx + r, y1: m.cy - r, y2: m.cy + r })).toBe(false);
        }
      }
    }
  });

  it("stays inside the plot", () => {
    const s = build(direct);
    for (const b of s.series.map((x) => boxOf(s, x.id))) {
      expect(b.x1).toBeGreaterThanOrEqual(s.plot.x - 0.5);
      expect(b.x2).toBeLessThanOrEqual(s.plot.x + s.plot.width + 0.5);
      expect(b.y1).toBeGreaterThanOrEqual(s.plot.y - 0.5);
      expect(b.y2).toBeLessThanOrEqual(s.plot.y + s.plot.height + 0.5);
    }
  });

  it("a name the user dragged carries its offset, and the others move around it", () => {
    const dragged: Plot = { ...direct, seriesStyles: { a: { directLabelOffset: { dx: 0, dy: 34 } } } };
    const s = build(dragged);
    expect(s.series.find((x) => x.id === "a")!.directLabel!.offset).toEqual({ dx: 0, dy: 34 });
    const boxes = s.series.map((x) => boxOf(s, x.id));
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        expect(hits(boxes[i]!, boxes[j]!), `"${s.series[i]!.name}" overlaps "${s.series[j]!.name}" after a drag`).toBe(false);
      }
    }
  });

  it("hidden means hidden — no legend and no names", () => {
    const s = build({ ...base, legend: { show: false, position: "direct" } });
    expect(s.legend).toHaveLength(0);
    expect(s.series.every((x) => x.directLabel == null)).toBe(true);
  });

  /**
   * Refused with a warning. A pie's legend rows key slices — they are drawn outside the series
   * layer, so there is no line or point for a name to sit beside. The wrong answer is to place
   * nothing and say nothing; the scene has to report what it could not name.
   *
   * The Inspector hides the option on this kind, so the setting can only arrive from a saved
   * project or a copied look — which is exactly when a silent drop would never be noticed.
   */
  /**
   * Two families get no direct labels at all, and both refusals are based on measurement:
   *
   *  • a box chart's groups are already named on the category axis — on the "Box & whisker"
   *    card a direct label prints "Control" beside the tick that says "Control";
   *  • a grouped bar has no clear space beside a bar — both names come out crowded, printed
   *    across the bars.
   *
   * The Inspector hides the option on these kinds, so this can only arrive from a saved project
   * or a copied look — exactly when a silent no-op would never be noticed. So it must warn.
   */
  it("refuses, with a warning, on the kinds where a name would land on the axis or on the ink", () => {
    const groups: DataTable = {
      id: "bx", kind: "column", name: "groups",
      columns: [
        { id: "c0", name: "Site" },
        { id: "a", name: "Control", role: "y" },
        { id: "b", name: "Treated", role: "y" },
      ],
      rows: [0, 1, 2, 3, 4].map((i) => ({ id: `r${i}`, cells: { c0: `s${i}`, a: 10 + i, b: 18 + i * 1.5 } })),
    };
    for (const kind of ["box", "violin", "bar", "histogram"] as const) {
      const s = buildPlotScene(groups, { id: `p-${kind}`, status: "ok", styleOverrides: {}, source: "bx", name: "p", kind, legend: { show: true, position: "direct" } }, { ...SIZE, measure });
      expect(s.series.every((x) => x.directLabel == null), `${kind} drew a direct label`).toBe(true);
      expect(
        s.warnings.filter((w) => w.toLowerCase().includes("direct labels are not drawn")),
        `${kind} refused silently`,
      ).toHaveLength(1);
    }
  });

  it("a row with nothing to sit beside is refused with a warning, and named", () => {
    const pieTable: DataTable = {
      id: "pt", kind: "column", name: "share",
      columns: [
        { id: "g", name: "Segment", role: "x", type: "text" },
        { id: "v", name: "Share", role: "y", type: "number" },
      ],
      rows: [["Alpha", 40], ["Beta", 35], ["Gamma", 25]].map((r, i) => ({ id: `r${i}`, cells: { g: r[0] as string, v: r[1] as number } })),
    };
    const s = buildPlotScene(pieTable, { id: "p2", status: "ok", styleOverrides: {}, source: "pt", name: "p2", kind: "pie", legend: { show: true, position: "direct" } }, { ...SIZE, measure });
    expect(s.series.every((x) => x.directLabel == null)).toBe(true);
    const said = s.warnings.filter((w) => w.toLowerCase().includes("direct label"));
    expect(said, "a refused direct label must reach the scene warnings").toHaveLength(1);
    // …and it must name every row it refused, not just count them — a warning that says
    // "3 labels could not be placed" tells the user nothing about which.
    const rows = s.legendLayout.directEntries ?? [];
    expect(rows.length).toBeGreaterThan(0);
    for (const e of rows) expect(said[0], `the warning does not name "${e.label}"`).toContain(e.label);
  });
});
