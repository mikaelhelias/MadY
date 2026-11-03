import { describe, expect, it } from "vitest";
import type { DataTable, Plot } from "@mady/core";
import { describeScene, layerSize } from "./describeScene.js";

/**
 * `describeScene` is the agent's read-back: an LLM sets an option and needs to be told
 * what actually reached the drawing. These tests guard against it misreporting in the two
 * ways that would matter most.
 *
 * The main case this file covers: eight kinds draw outside the series layer, so
 * `scene.series` is empty on a perfectly good chart — the `LegendEntry.select` comment in
 * scene.ts names them: pie · treemap · radar · parallel · lollipop · paireddot (+ volcano and
 * ROC nuances). A description that counted `series.length` would report a finished pie chart
 * as "0 series, nothing drawn", and an agent believing it would "fix" a working figure. So
 * the pie test below is the real guard, and `drawn` is collected generically from whatever
 * scene fields are populated — a new kind describes itself without anyone editing a list.
 *
 * Each guard's fixture can exhibit the failure it guards against (see the notes on each).
 */

/** A tiny two-column numeric table. */
function table(): DataTable {
  return {
    id: "t1",
    name: "T",
    kind: "xy",
    columns: [
      { id: "cx", name: "Dose", type: "number" },
      { id: "cy", name: "Response", type: "number" },
    ],
    rows: [
      { id: "r1", cells: { cx: 1, cy: 10 } },
      { id: "r2", cells: { cx: 2, cy: 20 } },
      { id: "r3", cells: { cx: 3, cy: 15 } },
    ],
  } as unknown as DataTable;
}

/** Two Y columns — a legend only appears once there is more than one series to key. */
function twoSeriesTable(): DataTable {
  return {
    id: "t1",
    name: "T",
    kind: "xy",
    columns: [
      { id: "cx", name: "Dose", type: "number" },
      { id: "cy", name: "Response", type: "number" },
      { id: "cz", name: "Control", type: "number" },
    ],
    rows: [
      { id: "r1", cells: { cx: 1, cy: 10, cz: 4 } },
      { id: "r2", cells: { cx: 2, cy: 20, cz: 6 } },
      { id: "r3", cells: { cx: 3, cy: 15, cz: 5 } },
    ],
  } as unknown as DataTable;
}

function plot(over: Partial<Plot> = {}): Plot {
  return { id: "p1", name: "G", source: "t1", kind: "xy", ...over } as unknown as Plot;
}

describe("describeScene", () => {
  it("reports the kind, the resolved axes and the series that were drawn", () => {
    const d = describeScene(table(), plot(), { width: 600, height: 400 });

    expect(d.kind).toBe("xy");
    expect(d.size).toEqual({ width: 600, height: 400 });
    expect(d.axes.x).toBeDefined();
    expect(d.axes.y).toBeDefined();
    // A real resolved domain, not the raw data extent.
    expect(d.axes.y!.domain[0]).toBeLessThanOrEqual(10);
    expect(d.axes.y!.domain[1]).toBeGreaterThanOrEqual(20);
    expect(d.axes.y!.tickCount).toBeGreaterThan(0);
    expect(d.series.length).toBeGreaterThan(0);
    expect(d.series[0]!.name).toBe("Response");
    expect(d.drawnTotal).toBeGreaterThan(0);
  });

  it("a pie draws outside the series layer — it must not read as an empty graph", () => {
    // Note: the three-column table is deliberate: it yields a pie of two slices. The
    // two-column fixture gives exactly one, which is indistinguishable from `layerSize`'s
    // atomic-layer fallback — it would pass even if the count were fabricated.
    const d = describeScene(twoSeriesTable(), plot({ kind: "pie" }), { width: 600, height: 400 });

    // What this guards: scene.series is empty here, on a chart that draws fine.
    expect(d.kind).toBe("pie");
    expect(d.series).toHaveLength(0);
    expect(d.drawsOutsideSeriesLayer).toBe(true);
    // A real slice count, not the fallback.
    expect(d.drawn.pie).toBe(2);
    expect(d.drawnTotal).toBe(2);
  });

  /**
   * Note: tested directly, not through a fixture. There is no table that makes a per-kind layer
   * come back with empty parts — a pie with no rows still emits its slices, at value 0, so
   * `describeScene` cannot reach the empty-arrays branch. A fixture that cannot
   * exhibit the case cannot guard it, so the rule is pinned on the function itself.
   */
  describe("layerSize — how many things a drawable layer holds", () => {
    it("uses an array's own length", () => {
      expect(layerSize([1, 2, 3])).toBe(3);
      expect(layerSize([])).toBe(0);
    });

    it("uses the largest part-array of a per-kind layer (pie.slices, heatmap.cells, …)", () => {
      expect(layerSize({ cx: 1, cy: 2, r: 3, slices: [{}, {}, {}] })).toBe(3);
    });

    it("counts 0 — never 1 — when a layer has part-arrays and they are all empty", () => {
      // Falling back to 1 here would report an empty layer as drawn: the same misreport that
      // `drawsOutsideSeriesLayer` exists to prevent, one level down.
      expect(layerSize({ cx: 1, cy: 2, slices: [], cells: [] })).toBe(0);
    });

    it("counts 1 for an atomic layer that has no part-arrays at all", () => {
      expect(layerSize({ from: 0, to: 10, color: "#000" })).toBe(1);
    });

    it("counts 0 for a scalar — a number or string is a setting, never a layer", () => {
      expect(layerSize(7)).toBe(0);
      expect(layerSize("bar")).toBe(0);
      expect(layerSize(null)).toBe(0);
    });
  });

  it("carries a refusal through verbatim — the field an agent most needs", () => {
    // A network diagram has no axes to anchor an annotation to — `refuseAnnotations` is called
    // on exactly one kind, and it returns none while saying so rather than
    // dropping the object silently. Without this passthrough an agent would add a label, be
    // told nothing, and never learn the label is not on the chart.
    const d = describeScene(
      table(),
      plot({ kind: "network", annotations: [{ id: "a1", kind: "text", label: "hi", x: 0.5, y: 0.5 }] } as Partial<Plot>),
      { width: 600, height: 400 },
    );

    expect(d.annotations.text).toBeUndefined(); // it really was not drawn …
    expect(d.warnings.join(" ")).toContain("no axes to place them on"); // … and it says why
  });

  it("resolves the palette the same way the app does (a named palette wins over the default)", () => {
    // "Grayscale" is a real PALETTES key — a misspelt one silently falls back to the default,
    // which would make this test pass for the wrong reason.
    const plain = describeScene(table(), plot(), { width: 600, height: 400 });
    const themed = describeScene(table(), plot({ palette: "Grayscale" }), { width: 600, height: 400 });

    // If the describe path skipped scenePaletteOpt, both would report the same default colour.
    expect(themed.series[0]!.color).not.toBe(plain.series[0]!.color);
  });

  it("counts annotations by kind, so an agent can see what it added", () => {
    // Note: the annotation body is `label`, and x/y are fractions of the plot rect (0..1), not data
    // values — a data-valued fixture places the object off-plot and proves nothing.
    const d = describeScene(
      table(),
      plot({ annotations: [{ id: "a1", kind: "text", label: "hi", x: 0.5, y: 0.5 }] } as Partial<Plot>),
      { width: 600, height: 400 },
    );

    expect(d.annotations.text).toBe(1);
  });

  it("names what each legend row selects, so an agent can target it", () => {
    // Note: this must be a two-series plot. A single-series legend is hidden (`scene.legend` is
    // "empty when hidden/single-series"), so a one-column fixture would leave this test unable
    // to fail against a misspelt legend field, which is what it exists to catch.
    const d = describeScene(twoSeriesTable(), plot(), { width: 600, height: 400 });

    expect(d.legend.length).toBeGreaterThan(0);
    // Reading a misspelt `selects` off the scene yields rows with no target at all.
    expect(d.legend.every((r) => typeof r.selects === "string" && r.selects.includes(":"))).toBe(true);
  });

  it("never throws on a graph the builder cannot draw — it reports the failure as a value", () => {
    // Note: `{}` as the table is the fixture that actually reaches the catch: buildPlotScene
    // throws on it with "Cannot read properties of undefined (reading 'find')". A table with
    // merely no columns/rows builds fine and would prove nothing.
    const broken = { id: "p9", name: "X", source: "nope", kind: "xy" } as unknown as Plot;

    let d!: ReturnType<typeof describeScene>;
    expect(() => {
      d = describeScene({} as unknown as DataTable, broken, { width: 300, height: 200 });
    }).not.toThrow();

    expect(typeof d.error).toBe("string");
    expect(d.error!.length).toBeGreaterThan(0);
    expect(d.drawnTotal).toBe(0);
  });
});
