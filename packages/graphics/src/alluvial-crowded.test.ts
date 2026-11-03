/**
 * An alluvial with a crowded stage stays on its figure and says what it could not label.
 *
 * At a gap of 2 % of the plot height per category, 89 gaps under 90 categories would take more
 * than the whole plot and push the nodes of that stage (and the ribbons into them) off the bottom
 * of the figure. The gaps shrink when there are that many; labels that cannot be placed at the
 * smallest size are left out, and the graph says so.
 */
import { describe, expect, it } from "vitest";
import type { DataTable, Plot } from "@mady/core";
import { buildPlotScene } from "./buildScene";

const measure = (t: string, px: number): number => t.length * px * 0.6;
const majors = ["Biology", "Chemistry", "Physics", "Maths"];
const jobs = ["Research", "Health", "Teaching", "Industry", "Tech"];
const sheet = (n: number) => ({
  id: "t", kind: "multivariable", name: "Paths",
  columns: [{ id: "s", name: "Student", role: "x" }, { id: "m", name: "Major", role: "x" }, { id: "j", name: "Job", role: "x" }],
  rows: Array.from({ length: n }, (_, i) => ({ id: `r${i}`, cells: { s: `S${i + 1}`, m: majors[i % 4], j: jobs[(i * 7) % 5] } })),
}) as unknown as DataTable;
const plot = { id: "p", name: "Paths", source: "t", kind: "alluvial" } as unknown as Plot;
const build = (n: number) => buildPlotScene(sheet(n), plot, { width: 580, height: 380, measure });

describe("a crowded alluvial stage", () => {
  it("every node stays inside the plot", () => {
    const s = build(60);
    const bottom = s.plot.y + s.plot.height + 0.5;
    const out = s.alluvial!.nodes.filter((n) => n.y + n.h > bottom);
    expect(out.length, `${out.length} nodes run past the plot's bottom edge`).toBe(0);
  });

  it("every label it shows is on the figure and clear of the others; the hidden ones are counted", () => {
    const s = build(60);
    const font = s.fonts.tick.size;
    const shown = s.alluvial!.nodes.filter((n) => n.label);
    expect(shown.every((n) => n.labelY - font >= 0 && n.labelY <= s.height), "a label is off the figure").toBe(true);
    const box = (n: (typeof shown)[number]) => {
      const w = measure(n.label, font);
      const x1 = n.labelAnchor === "end" ? n.labelX - w : n.labelX;
      return { x1, x2: x1 + w, y1: n.labelY - font * 0.8, y2: n.labelY + font * 0.25 };
    };
    const hits: string[] = [];
    for (let i = 0; i < shown.length; i++) for (let j = i + 1; j < shown.length; j++) {
      const a = box(shown[i]!), b = box(shown[j]!);
      if (Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1) > 0.5 && Math.min(a.y2, b.y2) - Math.max(a.y1, b.y1) > 0.5) hits.push(`${shown[i]!.label} / ${shown[j]!.label}`);
    }
    expect(hits.slice(0, 5)).toEqual([]);
    const hidden = s.alluvial!.nodes.length - shown.length;
    expect(hidden).toBeGreaterThan(0);
    expect(s.warnings.some((w) => w.includes(`${hidden} node label`) && /"Student"/.test(w))).toBe(true);
  });

  it("in the crowded stage, a label it shows sits beside its own node, not a neighbour's", () => {
    const s = build(60);
    const font = s.fonts.tick.size;
    const far = s.alluvial!.nodes.filter((n) => n.label && n.axis === 0).filter((n) => Math.abs(n.labelY - font * 0.34 - (n.y + n.h / 2)) > n.h / 2 + font * 1.5);
    expect(far.map((n) => n.label).slice(0, 5), "a label pushed beside another student's node names the wrong row").toEqual([]);
  });

  it("the warning names the control that leaves the crowded column out", () => {
    const w = build(60).warnings.find((x) => /node label/.test(x)) ?? "";
    expect(w).toMatch(/untick "Student" under Alluvial \/ parallel sets › Axes/);
  });

  it("a small alluvial shows every label and adds no warning", () => {
    const s = buildPlotScene({ ...sheet(12), columns: sheet(12).columns.slice(1) } as DataTable, plot, { width: 580, height: 380, measure });
    expect(s.alluvial!.nodes.every((n) => n.label)).toBe(true);
    expect(s.warnings.filter((w) => /node label/.test(w))).toEqual([]);
  });
});
