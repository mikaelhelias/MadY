// By-hand category group names never run into each other — every gallery card, and its flipped form.
//
// Guards against a group name longer than its group overlapping its neighbour. The hardest case is the flipped
// "Bars + line (2nd axis)" card split into two halves: its plot is 194 px tall (the second axis sits on top), so
// each group spans 97 px, while a name written down the right edge is 94–111 px long.
//
// This is the fast (pure scene) form of the browser check in `e2e/category-groups-by-hand.spec.ts`. Name lengths are recomputed
// here from Arial's widths, not read from the builder.
import { describe, expect, it } from "vitest";
import type { DataTable, Plot } from "@mady/core";
import { buildPlotScene } from "@mady/graphics";
import { galleryItems } from "./gallery";
import { graphLayoutSize } from "./graphDisplay";
import { arialWidth } from "./arialWidth.testutil";

/** Names longer than the group they name on the short flipped cards, yet short enough to fit the figure once moved — the sweep's own
 *  "First group" / "Second group" overlap by under a pixel at Arial widths, too little to prove anything. */
const FIRST = "First drug group";
const SECOND = "Second drug group";

const FLIPPABLE = new Set(["bar", "box", "violin", "scatter", "floatingbar", "lollipop"]);

const cases = galleryItems().flatMap((g) => {
  const plot = g.plot as Plot;
  const kind = plot.kind ?? "xy";
  const forms: Array<{ name: string; plot: Plot }> = [{ name: g.title, plot }];
  if (FLIPPABLE.has(kind)) {
    const other = (plot.barOrientation ?? (kind === "lollipop" ? "horizontal" : "vertical")) === "horizontal" ? "vertical" : "horizontal";
    forms.push({ name: `${g.title} (flipped)`, plot: { ...plot, barOrientation: other } as Plot });
  }
  return forms.map((f) => ({ ...f, table: g.table as DataTable }));
});

describe("by-hand group names never run into each other", () => {
  let judged = 0; // drawings that really carried two names - counted, so the sweep cannot pass by judging nothing
  it.each(cases)("$name", ({ table, plot }) => {
    const bare = buildPlotScene(table, plot, { ...graphLayoutSize(plot), measure: arialWidth });
    for (const key of ["xAxis", "yAxis"] as const) {
      // The category axis may be either spec (a flipped chart keeps its categories on `xAxis`): try both,
      // and judge whichever one the drawing actually answers.
      const band = [bare.x, bare.y].find((ax) => ax?.band && !ax.hidden);
      if (!band) continue;
      const cats = band.ticks.filter((t) => !t.minor).map((t) => t.label || t.suppressedLabel || "").filter(Boolean);
      if (cats.length < 2) continue;
      const half = Math.ceil(cats.length / 2);
      const map = Object.fromEntries(cats.map((c, i) => [c, i < half ? FIRST : SECOND]));
      const s = buildPlotScene(table, { ...plot, [key]: { ...(plot[key] ?? {}), categoryGroups: { map } } } as Plot, { ...graphLayoutSize(plot), measure: arialWidth });
      const names = (s.categoryGroups ?? []).filter((g) => g.name);
      if (names.length < 2) continue;
      judged++;
      const font = s.fonts.legend.size;
      const spans = names
        .map((g) => {
          const c = g.axis === "y" ? g.name!.y : g.name!.x;
          const len = arialWidth(g.label, font);
          return { label: g.label, lo: c - len / 2, hi: c + len / 2 };
        })
        .sort((a, b) => a.lo - b.lo);
      const limit = names[0]!.axis === "y" ? s.height : s.width;
      const clashes: string[] = [];
      for (let i = 1; i < spans.length; i++) {
        if (spans[i]!.lo < spans[i - 1]!.hi - 1.5) clashes.push(`"${spans[i - 1]!.label}"×"${spans[i]!.label}" overlap ${(spans[i - 1]!.hi - spans[i]!.lo).toFixed(1)} px`);
      }
      for (const sp of spans) if (sp.lo < -1 || sp.hi > limit + 1) clashes.push(`"${sp.label}" runs off the figure (${sp.lo.toFixed(0)}–${sp.hi.toFixed(0)} of ${limit})`);
      // Overlap that could not be avoided must be reported with a warning, never silent.
      if (clashes.length && s.warnings.some((w) => w.includes("group names are together longer"))) continue;
      expect(clashes, `groups on plot.${key}`).toEqual([]);
    }
  });

  it("judged a real share of the gallery, not nothing", () => {
    expect(judged).toBeGreaterThanOrEqual(20);
  });

  it("the fixture can collide: on the hardest card each name is longer than the group it names", () => {
    const g = galleryItems().find((x) => x.title === "Bars + line (2nd axis)")!;
    const plot = { ...(g.plot as Plot), barOrientation: "horizontal" } as Plot;
    const map = { Jan: FIRST, Feb: FIRST, Mar: FIRST, Apr: SECOND, May: SECOND, Jun: SECOND };
    const s = buildPlotScene(g.table as DataTable, { ...plot, xAxis: { ...(plot.xAxis ?? {}), categoryGroups: { map } } } as Plot, { ...graphLayoutSize(plot), measure: arialWidth });
    const names = (s.categoryGroups ?? []).filter((x) => x.name);
    expect(names.map((x) => x.label)).toEqual([FIRST, SECOND]);
    expect(names.every((x) => x.axis === "y")).toBe(true);
    const groupSpan = s.plot.height / 2;
    expect(arialWidth(FIRST, s.fonts.legend.size)).toBeGreaterThan(groupSpan + 20);
    // …and they were moved off their groups' centres to clear each other.
    expect(names[1]!.name!.y - names[0]!.name!.y).toBeGreaterThan(groupSpan + 20);
  });

  it("names too long to fit the figure at all raise a warning, not drawn over each other in silence", () => {
    const g = galleryItems().find((x) => x.title === "Bars + line (2nd axis)")!;
    const plot = { ...(g.plot as Plot), barOrientation: "horizontal" } as Plot;
    const a = "The first group of three months";
    const b = "The second group of three months";
    const map = { Jan: a, Feb: a, Mar: a, Apr: b, May: b, Jun: b };
    const s = buildPlotScene(g.table as DataTable, { ...plot, xAxis: { ...(plot.xAxis ?? {}), categoryGroups: { map } } } as Plot, { ...graphLayoutSize(plot), measure: arialWidth });
    expect(arialWidth(a, s.fonts.legend.size) + arialWidth(b, s.fonts.legend.size)).toBeGreaterThan(s.height);
    expect(s.warnings.filter((w) => w.includes("group names are together longer"))).toHaveLength(1);
  });
});
