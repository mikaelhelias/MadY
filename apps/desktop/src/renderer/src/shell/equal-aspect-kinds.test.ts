// @vitest-environment node
/**
 * Equal aspect — the list of kinds that can honour it is derived from the builder, not asserted.
 *
 * `EQUAL_ASPECT_KINDS` (core) decides where the control is offered. This gate holds both halves
 * of that claim against what the builder actually draws, so the list and the drawing cannot
 * drift apart (hand-kept lists such as `FRAME_DEAD_KINDS` and `NO_MARKER_KINDS` are prone to it):
 *
 *   • every kind in the list really does end up with one data unit the same number of pixels on
 *     X as on Y — measured off the built axes, on a deliberately non-square figure whose scales
 *     start out unequal (the "off" build is asserted unequal first, so the fixture is known to be
 *     able to exhibit what is being checked);
 *   • every kind outside the list is untouched by the flag and says so in a warning.
 */
import { describe, expect, it } from "vitest";
import { buildPlotScene } from "@mady/graphics";
import { EQUAL_ASPECT_KINDS } from "@mady/core";
import type { Plot } from "@mady/core";
import { galleryItems, galleryLookup } from "./gallery";

/**
 * Pixels per data unit, measured off the ticks the axis actually drew.
 *
 * Not `range / domain`: the XY builder insets the data mapping by ~one marker so an edge
 * point is not clipped by the plot frame, and that inset is not the same on both axes. The
 * axis `range` is the frame; the ticks are where the numbers really land, which is what a
 * reader measures a distance against.
 */
function perUnit(ax: { ticks: { value: number; pos: number; minor: boolean }[] }): number {
  const majors = ax.ticks.filter((t) => !t.minor);
  const a = majors[0];
  const b = majors[majors.length - 1];
  if (!a || !b || a.value === b.value) throw new Error("axis drew fewer than two distinct major ticks");
  return Math.abs(b.pos - a.pos) / Math.abs(b.value - a.value);
}

/** A wide, short figure — so an un-equalised chart has visibly different scales. */
const SIZE = { width: 640, height: 300 };

const items = galleryItems();

/** Build one card, with `equalAspect` forced either way and the axes made plainly linear. */
function build(item: (typeof items)[number], on: boolean) {
  const plot: Plot = {
    ...item.plot,
    equalAspect: on,
    xAxis: { ...(item.plot.xAxis ?? {}), scale: "linear", min: undefined, max: undefined, breaks: undefined },
    yAxis: { ...(item.plot.yAxis ?? {}), scale: "linear", min: undefined, max: undefined, breaks: undefined },
  };
  return buildPlotScene(item.table, plot, { ...SIZE, tables: galleryLookup(item) });
}

describe("equal aspect — the kinds that can honour it", () => {
  const supported = items.filter((it) => EQUAL_ASPECT_KINDS.has(it.plot.kind ?? "xy"));

  it("covers every kind in the list (a kind with no gallery card is never measured)", () => {
    const seen = new Set(supported.map((it) => it.plot.kind ?? "xy"));
    expect([...EQUAL_ASPECT_KINDS].filter((k) => !seen.has(k))).toEqual([]);
  });

  for (const kind of EQUAL_ASPECT_KINDS) {
    const item = supported.find((it) => (it.plot.kind ?? "xy") === kind);
    it(`${kind}: one data unit draws the same pixels on X and Y`, () => {
      if (!item) throw new Error(`no gallery card for ${kind}`);
      const off = build(item, false);
      const on = build(item, true);
      // The fixture must be able to exhibit the defect, or the assertion below proves nothing.
      const offRatio = perUnit(off.x) / perUnit(off.y);
      expect(Math.abs(offRatio - 1), `${kind}: this fixture is already 1:1 with the option OFF, so it cannot test it`).toBeGreaterThan(0.02);
      expect(on.warnings.filter((w) => /equal aspect/i.test(w))).toEqual([]);
      expect(perUnit(on.x) / perUnit(on.y)).toBeCloseTo(1, 6);
    });

    it(`${kind}: stays 1:1 through a zoom, and \`auto\` still reports the un-zoomed home`, () => {
      if (!item) throw new Error(`no gallery card for ${kind}`);
      const home = build(item, true);
      // A window on X only. The Y axis must follow it — a map that stops being 1:1 the moment
      // it is zoomed into is the distortion this option exists to remove.
      const win: [number, number] = [home.x.domain[0] + 0.25 * (home.x.domain[1] - home.x.domain[0]), home.x.domain[1]];
      const item2 = item;
      const plot: Plot = {
        ...item2.plot, equalAspect: true,
        xAxis: { ...(item2.plot.xAxis ?? {}), scale: "linear", min: undefined, max: undefined, breaks: undefined },
        yAxis: { ...(item2.plot.yAxis ?? {}), scale: "linear", min: undefined, max: undefined, breaks: undefined },
      };
      const zoomed = buildPlotScene(item2.table, plot, { ...SIZE, xDomain: win, tables: galleryLookup(item2) });
      // The window really applied — otherwise the rest is about nothing.
      expect(zoomed.x.domain[0]).toBeCloseTo(win[0], 6);
      expect(perUnit(zoomed.x) / perUnit(zoomed.y)).toBeCloseTo(1, 6);
      // And the home the detent/reset targets is the UN-zoomed one, not an echo of the window.
      expect(zoomed.auto.x).toEqual(home.auto.x);
      expect(zoomed.auto.y).toEqual(home.auto.y);
    });

    it(`${kind}: widening only ever adds plane — no drawn point is pushed out of view`, () => {
      if (!item) throw new Error(`no gallery card for ${kind}`);
      const off = build(item, false);
      const on = build(item, true);
      expect(on.x.domain[0]).toBeLessThanOrEqual(off.x.domain[0] + 1e-9);
      expect(on.x.domain[1]).toBeGreaterThanOrEqual(off.x.domain[1] - 1e-9);
      expect(on.y.domain[0]).toBeLessThanOrEqual(off.y.domain[0] + 1e-9);
      expect(on.y.domain[1]).toBeGreaterThanOrEqual(off.y.domain[1] - 1e-9);
    });
  }

  const REFUSAL = /Equal aspect \(1:1 scale\) needs two continuous value axes/;

  for (const item of items.filter((it) => !EQUAL_ASPECT_KINDS.has(it.plot.kind ?? "xy"))) {
    it(`${item.key}: refuses out loud and changes nothing`, () => {
      const off = build(item, false);
      const on = build(item, true);
      expect(on.warnings.some((w) => REFUSAL.test(w))).toBe(true);
      expect({ x: on.x.domain, y: on.y.domain, xr: on.x.range, yr: on.y.range })
        .toEqual({ x: off.x.domain, y: off.y.domain, xr: off.x.range, yr: off.y.range });
    });
  }
});
