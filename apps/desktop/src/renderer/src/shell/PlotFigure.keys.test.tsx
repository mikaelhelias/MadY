// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { buildPlotScene } from "@mady/graphics";
import { galleryItems } from "./gallery";
import { PlotFigure } from "./PlotFigure";

afterEach(cleanup);

/**
 * React keys must be unique among siblings — including on before–after.
 *
 * Most kinds give each series one mark per row, so `${series.id}-${m.rowId}` is unique.
 * Before–after inverts that: each subject (row) becomes its own series, and every one of that
 * subject's condition marks carries the same `rowId` as the series it belongs to. A key built
 * that way collapses to `mark-g-ba-r0-g-ba-r0` for every point on the trajectory, and the same
 * collision hits the `err-`, `plabel-` and `hit-` siblings. React then cannot tell two
 * marks apart across a re-render, which is how a mark goes missing or keeps a stale position
 * after an edit — a class of bug nothing else here catches.
 *
 * The oracle is React's own reconciler warning, because a duplicate key has no other
 * observable signature on a first render: both children are still emitted, and only the
 * update misbehaves. `console.error` is where React puts it.
 *
 * Note: deliberately not restricted to before–after. Every gallery kind is rendered, so the next
 * builder that reuses an id across marks is caught the day it lands.
 */
describe("no duplicate React keys in any gallery figure", () => {
  const items = galleryItems();

  it("covers the gallery (checks the guard itself)", () => {
    expect(items.length).toBeGreaterThan(20);
    expect(items.some((i) => i.plot.kind === "beforeafter"), "before–after, whose marks share their series' row id, must be among the kinds checked").toBe(true);
  });

  for (const item of items) {
    it(`${item.title} renders without a duplicate-key warning`, () => {
      const scene = buildPlotScene(item.table, item.plot, { width: 520, height: 380 });
      const spy = vi.spyOn(console, "error").mockImplementation(() => {});
      try {
        render(<PlotFigure scene={scene} />);
        const dupes = spy.mock.calls
          .map((c) => c.map((a) => String(a)).join(" "))
          .filter((m) => /same key|Encountered two children/i.test(m));
        expect(dupes, `${item.plot.kind}: React reported colliding sibling keys`).toEqual([]);
      } finally {
        spy.mockRestore();
      }
    });
  }
});
