// @vitest-environment node
// A significance bracket must land on the two groups it names.
//
// `annotations-drawn.test.tsx` asks the weaker question — "can a bracket be drawn at all" — which
// cannot catch a bracket that is drawn but compares nothing (as on a ridgeline). This file asks the
// sharper one: **do the drawn endpoints line up with the two categories they name, on those
// categories' own axis?**
//
// The endpoint convention is a 1-based category index, not a tick value.
// The composer writes `{from: 1, to: 2}` (Inspector.tsx, "Add bracket"), and every categorical
// builder resolves index → band centre with `c >= 1 && c <= n ? band(c - 1) : undefined`.
// Band tick values are 1-based on bar/box/violin — so the two coincide there — and 0-based on
// lollipop, paired-dot and dendrogram. Feeding tick values instead of indices makes lollipop and
// paired-dot appear to place no bracket at all: `from: 0` is rejected outright and every bracket
// is dropped. Measured with indices, both kinds place every adjacent pair exactly.
//
// Categorical axes only. On a continuous axis (xy, volcano, roc, survival, the PCA family…) an
// endpoint is a data value, so feeding indices there measures nothing.
import { describe, expect, it } from "vitest";
import type { Annotation, Plot } from "@mady/core";
import { buildPlotScene } from "@mady/graphics";
import { galleryItems } from "./gallery";

const SIZE = { width: 620, height: 420 };

/** Kinds whose Inspector does not offer the Significance brackets section. */
const NO_SECTION = new Set([
  "heatmap", "network", "corrmatrix", "alluvial", "radar", "parallel", "pie", "treemap", "sunburst", "chord", "oncoprint", "scatter3d", "ridgeline",
  // Both axes continuous, so a bracket spans two data values and compares nothing — the same
  // reasoning as for the ridgeline. `annotations-drawn` guards the other direction (that these
  // really have no groups).
  "xy", "area", "blandaltman", "pcascore", "pcaload", "pcabiplot", "bubble", "volcano", "survival", "roc",
  // Swimmer: its bands are individual subjects, not
  // groups — a bracket between two patients' timelines compares nothing. The builder drops
  // a saved bracket with that reason; `annotations-drawn` guards the section stays hidden.
  "swimmer",
  // Tracks: its bands name whole tracks (columns/variables), not groups of one
  // measurement — a bracket between two tracks compares nothing. Refused entirely.
  "tracks",
  // Manhattan: the X axis is a genome-position ruler (chromosome ticks), Y is −log10 p — a
  // bracket would span two genome coordinates and compare nothing (the volcano/xy reasoning).
  "manhattan",
]);

describe("a significance bracket lands on the two categories it names", () => {
  for (const item of galleryItems()) {
    const kind = item.plot.kind ?? "xy";
    if (NO_SECTION.has(kind)) continue;

    it(`${kind}: every adjacent pair, or a stated reason not to ask`, () => {
      const base = buildPlotScene(item.table, item.plot as Plot, SIZE);
      // The axis the placer treats as the category axis — the same rule bracket-headroom uses.
      const catIsX = base.valueAxis !== "x";
      const ticks = (catIsX ? base.x : base.y).ticks.filter((t) => !t.minor);
      // A continuous axis takes data values, not indices: not this test's question.
      // Note: counted, not `every()`. A forest plot's first band is a blank label above the
      // studies, and `every(label !== "")` would exclude the whole kind — it places all 6 pairs exactly.
      const named = ticks.filter((t) => t.label !== "" && Number.isNaN(Number(t.label)));
      if (ticks.length < 2 || named.length < 2) return;

      // The bracket contract: `from`/`to` are table-order category indices. A value-sorted
      // bar chart (barSort — the waterfall card) draws those categories elsewhere, and the
      // bracket must follow its categories through the sort — so the probe names the drawn
      // tick's category by its table index and still expects the endpoint on that tick.
      // Unsorted charts: drawn order == table order, probeIdx is the identity.
      const p = item.plot as Plot;
      const sortActive = kind === "bar" && p.barSort != null && p.barSort !== "none";
      const tableOrder = sortActive ? item.table.rows.map((r) => String(r.cells[item.table.columns[0]!.id])) : null;
      const probeIdx = (drawnIdx: number): number => (tableOrder ? tableOrder.indexOf(ticks[drawnIdx - 1]!.label) + 1 : drawnIdx);
      for (let idx = 1; idx + 1 <= ticks.length; idx += 1) {
        const c1 = ticks[idx - 1]!, c2 = ticks[idx]!;
        if (tableOrder && (probeIdx(idx) === 0 || probeIdx(idx + 1) === 0)) continue; // thinned/blank label — can't name it
        const ann: Annotation = { id: "probe", kind: "bracket", from: probeIdx(idx), to: probeIdx(idx + 1), label: "*" };
        const sc = buildPlotScene(item.table, { ...(item.plot as Plot), annotations: [ann] }, SIZE);
        const d = sc.annotations.find((a) => a.id === "probe") as
          | { x1: number; y1: number; x2: number; y2: number } | undefined;
        expect(d, `${kind}: a bracket over ${c1.label} → ${c2.label} was dropped`).toBeTruthy();
        const ends = catIsX ? [d!.x1, d!.x2] : [d!.y1, d!.y2];
        // Half a band would still "draw"; the endpoints have to be on the two ticks — the ticks
        // of this scene. The bracket build may widen a value axis for headroom (the "Bars + line
        // (2nd axis)" card grows its Y2 labels, which moves the right margin and every tick by a
        // few px), so the bracket-less `base` ticks name the pair but cannot measure the landing.
        // Same categories in both builds → same tick list; match by index (labels can be blank
        // where the axis thins them, so a label lookup would find the wrong blank tick).
        const drawn = (catIsX ? sc.x : sc.y).ticks.filter((t) => !t.minor);
        expect(drawn.length, `${kind}: the bracket build changed the tick count`).toBe(ticks.length);
        const d1 = drawn[idx - 1]!, d2 = drawn[idx]!;
        expect(ends[0], `${kind}: the bracket's first end is not on ${c1.label}`).toBeCloseTo(d1.pos, 1);
        expect(ends[1], `${kind}: the bracket's second end is not on ${c2.label}`).toBeCloseTo(d2.pos, 1);
      }
    });
  }

  /**
   * Guards the guard. If no kind reached the assertions above — a filter too tight, a fixture
   * that stopped being categorical — every test here would pass by doing nothing.
   */
  it("the check actually ran on the kinds it is meant to cover", () => {
    const covered: string[] = [];
    for (const item of galleryItems()) {
      const kind = item.plot.kind ?? "xy";
      if (NO_SECTION.has(kind)) continue;
      const base = buildPlotScene(item.table, item.plot as Plot, SIZE);
      const ticks = (base.valueAxis !== "x" ? base.x : base.y).ticks.filter((t) => !t.minor);
      const named = ticks.filter((t) => t.label !== "" && Number.isNaN(Number(t.label)));
      if (ticks.length >= 2 && named.length >= 2) covered.push(kind);
    }
    // The categorical kinds. A kind leaving this list is the important
    // failure: it means its category axis stopped being categorical and nothing checked it.
    for (const kind of ["bar", "box", "violin", "scatter", "raincloud", "floatingbar", "estimation",
                        "pyramid", "scree", "dendrogram", "histogram", "beforeafter", "lollipop", "paireddot",
                        "forest"]) {
      expect(covered, `${kind} is no longer being checked by this file`).toContain(kind);
    }
  });
});
