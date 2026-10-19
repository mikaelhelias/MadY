// @vitest-environment jsdom
// The Y2 / Y3 buttons must match what the builder actually draws — checked against the drawing.
//
// `rightValueAxes` (Inspector) is the one gate for the Axis tab's Y2/Y3 buttons, its "Series on
// this axis" tickboxes and the series panel's "Plot on" row. It is checked against the drawing,
// not against a list of kind names: a list checked by a test that repeats it agrees with itself
// and can still be wrong. The histogram, for example, is drawn by the bar builder, which draws one right-hand
// axis and refuses Y3 explicitly — offering a Y3 button there leads to a refusal.
//
// Both directions are checked, because each alone hides half the trouble:
//   • offered but not drawn  → a button that leads to a refusal (e.g. Y3 on a histogram);
//   • drawn but not offered  → a working second axis nobody can reach from the Axis tab (the
//     UpSet plot, below, on purpose).
//
// Note: what "drawn" has to mean here:
//   1. Not "the scene has a `y2` field". The estimation plot always carries one — its own
//      "Difference" axis — and moving a series onto Y2 leaves it identical. A button there would
//      promise something the drawing does not do. So: the axis must be created or changed by the
//      assignment.
//   2. Not "the markup changed". Moving a series rescales it, so the picture changes either way.
//      So: delete the axis from the finished scene and re-render — if the picture is the same,
//      the renderer never drew it.
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import type { Plot } from "@mady/core";
import { buildPlotScene } from "@mady/graphics";
import { PlotFigure } from "./PlotFigure";
import { rightValueAxes } from "./Inspector";
import { galleryItems } from "./gallery";

const SIZE = { width: 620, height: 420 };
const measure = (t: string, px: number): number => t.length * px * 0.6;

/**
 * Right-hand axes a kind draws but offers no button for. Not a licence to ignore them — each entry
 * asserts both halves below, so the day the drawing or the gate changes, this fails.
 *
 * upset · y2: moving the intersection-size bars onto Y2 builds a real second axis, titled by the
 * series, and the renderer draws it. An UpSet plot has one series, so "Y2" there would only mean
 * "draw my only value axis on the right", never "compare two units".
 * UpSet has no Y2 button: a button would suggest a comparison the chart
 * cannot make. If the count axis is ever wanted on the right, that is a plain "axis side" setting,
 * not a second axis. This entry holds that: offer Y2 on UpSet and the test below fails.
 */
const DRAWN_BUT_NOT_OFFERED: Record<string, ("y2" | "y3")[]> = { upset: ["y2"] };

describe("the right-hand value axes offered are the ones the drawing has", () => {
  const items = galleryItems() as unknown as { key: string; table: never; plot: Plot }[];

  it("covers the gallery (it cannot pass by measuring nothing)", () => {
    expect(items.length).toBeGreaterThan(30);
    // …and reaches kinds that do draw one, so a green run is not an empty run.
    expect(items.some((i) => rightValueAxes(i.plot).length > 0)).toBe(true);
  });

  for (const item of items) {
    const kind = item.plot.kind ?? "xy";
    it(`${kind} [${item.key}]`, () => {
      const draw = (p: Plot): ReturnType<typeof buildPlotScene> => buildPlotScene(item.table, p, { measure, ...SIZE });
      const base = draw(item.plot);
      // Caution: use a real plotted series, never "the last y column". A bubble's last y-role
      // column is its colour channel and an xy time course's are replicates — none is a series, so
      // moving one to Y2 draws nothing and the axis reads as unused. Picking such a column would
      // report bubble and histogram as having no second or third axis; the drawing shows bubble has both.
      const series = base.series[0];
      if (!series) return; // a kind whose drawing has no per-series marks — nothing to move
      const offered = rightValueAxes(item.plot);
      for (const axis of ["y2", "y3"] as const) {
        const moved = draw({
          ...item.plot,
          seriesStyles: { ...(item.plot.seriesStyles ?? {}), [series.id]: { ...(item.plot.seriesStyles?.[series.id] ?? {}), axis } },
        } as Plot);
        const now = moved[axis];
        const before = base[axis];
        const created = Boolean(now) && JSON.stringify(before ?? null) !== JSON.stringify(now);
        const rendered = created
          && renderToStaticMarkup(createElement(PlotFigure, { scene: moved }))
            !== renderToStaticMarkup(createElement(PlotFigure, { scene: { ...moved, [axis]: undefined } }));
        const expected = (DRAWN_BUT_NOT_OFFERED[kind] ?? []).includes(axis) ? true : offered.includes(axis);
        expect(
          rendered,
          expected
            ? `${kind}: putting "${series.name}" on ${axis.toUpperCase()} draws no such axis — the Axis tab's button leads to a refusal`
            : `${kind}: putting "${series.name}" on ${axis.toUpperCase()} does draw that axis, and the Axis tab offers no button for it`,
        ).toBe(expected);
        if ((DRAWN_BUT_NOT_OFFERED[kind] ?? []).includes(axis)) {
          expect(offered, `${kind}: ${axis.toUpperCase()} is listed as drawn-but-unoffered and the Axis tab now offers it — delete the entry`).not.toContain(axis);
        }
      }
    });
  }
});
