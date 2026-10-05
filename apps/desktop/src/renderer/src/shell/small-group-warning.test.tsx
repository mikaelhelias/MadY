/**
 * Small-group warning (limits: box below 5 values, violin below 10, a 95% CI of
 * the mean below 3). The chart still draws — the warning names the group and says what it is too small for.
 *
 * Each limit is checked one value below it (warns) and at the limit (silent), so an off-by-one in either direction fails.
 */
import { describe, expect, it } from "vitest";
import type { DataTable, Plot } from "@mady/core";
import { buildPlotScene } from "@mady/graphics";
import { galleryItems } from "./gallery";

const SIZE = { width: 580, height: 380 };
/** Group "Small" with `n` values, group "Big" with 12. */
function scene(kind: string, n: number, extra: Partial<Plot> = {}) {
  const table = {
    id: "t-n", kind: "column", name: "n",
    columns: [{ id: "s", name: "Small", role: "y" }, { id: "b", name: "Big", role: "y" }],
    rows: Array.from({ length: 12 }, (_, i) => ({ id: `r${i}`, cells: { s: i < n ? 10 + ((i * 7) % 5) : "", b: 20 + (i % 6) } })),
  } as unknown as DataTable;
  const plot = { id: "p-n", name: "n", source: table.id, status: "ok", styleOverrides: {}, kind, ...extra } as unknown as Plot;
  return buildPlotScene(table, plot, SIZE);
}
const small = (s: ReturnType<typeof scene>, what: string) => s.warnings.filter((w) => w.startsWith("“Small” has") && w.includes(what));
const big = (s: ReturnType<typeof scene>) => s.warnings.filter((w) => w.startsWith("“Big” has"));

describe("small-group warning", () => {
  for (const [label, extra] of [["upright", {}], ["horizontal", { barOrientation: "horizontal" }]] as const) {
    it(`box (${label}): 4 values warns, 5 does not`, () => {
      const s4 = scene("box", 4, extra);
      expect(small(s4, "box plot")).toEqual(["“Small” has 4 values — too few for a box plot's quartiles and whiskers to be reliable (5 or more recommended). This concerns the drawing only; statistics on these values are not affected."]);
      expect(s4.series.find((x) => x.name === "Small")!.marks.some((m) => m.box), "the chart must still draw the box").toBe(true);
      expect(small(scene("box", 5, extra), "box plot")).toEqual([]);
      expect(big(s4)).toEqual([]);
    });

    it(`violin (${label}): 9 values warns, 10 does not`, () => {
      expect(small(scene("violin", 9, extra), "violin")).toEqual(["“Small” has 9 values — too few for a violin's outline (its smoothed spread) to be reliable (10 or more recommended). This concerns the drawing only; statistics on these values are not affected."]);
      expect(small(scene("violin", 10, extra), "violin")).toEqual([]);
    });
  }

  it("column scatter with a 95% CI of the mean: 2 values warns, 3 does not; SD says nothing", () => {
    const ci = { columnScatter: { error: "ci95" } } as Partial<Plot>;
    expect(small(scene("scatter", 2, ci), "95% CI")).toEqual(["“Small” has 2 values — too few for a 95% CI of the mean (3 or more needed)."]);
    expect(small(scene("scatter", 3, ci), "95% CI")).toEqual([]);
    expect(small(scene("scatter", 2), "")).toEqual([]);
  });

  it("box whiskers at mean ± 95% CI: 2 values warns about the CI too", () => {
    expect(small(scene("box", 2, { boxWhisker: "ci95" }), "95% CI")).toHaveLength(1);
    expect(small(scene("box", 3, { boxWhisker: "ci95" }), "95% CI")).toEqual([]);
  });

  it("one value is still counted (singular)", () => {
    expect(small(scene("box", 1), "box plot")).toEqual(["“Small” has 1 value — too few for a box plot's quartiles and whiskers to be reliable (5 or more recommended). This concerns the drawing only; statistics on these values are not affected."]);
  });

  it("no gallery card of these kinds trips it — their groups are big enough", () => {
    for (const g of galleryItems().filter((x) => ["box", "violin", "scatter"].includes(x.plot.kind ?? ""))) {
      const w = buildPlotScene(g.table, g.plot, SIZE).warnings.filter((x) => x.includes("too few for"));
      expect(w, g.key).toEqual([]);
    }
  });
});
