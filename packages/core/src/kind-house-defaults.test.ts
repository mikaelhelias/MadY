// @vitest-environment node
import { describe, expect, it } from "vitest";
import { KIND_HOUSE_DEFAULTS, STYLE_PRESETS, applyKindHouseDefaults } from "./presets";
import { MadyDocument } from "./document";
import { tableDatasets } from "./dataset";
import { createSampleDocument } from "./sample";

/**
 * The per-kind house default for bar.
 * A preset is kind-agnostic, so these live apart: 14px data points suit a bar chart
 * and are far too large on an XY scatter.
 */
describe("per-kind house defaults", () => {
  const bar = KIND_HOUSE_DEFAULTS.bar!;

  it("carries the bar house-default values", () => {
    expect(bar, "the bar house default is gone").toBeTruthy();
    expect(bar.series?.symbolSize, "data point size").toBe(14);
    expect(bar.plot?.barWidth, "bar width").toBe(0.38);
    /**
     * Type sizes are not part of the bar default. The shared preset sets title 26 /
     * axis-title 22 / tick 20 for all graph types where it applies, and a per-kind override
     * silently beats the preset — bar would be the one type ignoring the rule. Asserted as
     * absent so no per-kind value shadows them.
     */
    /**
     * Note: checked by name, not as "fonts is empty". Bar carries `fonts.legend` (18px),
     * and legend size is per-kind on purpose — 18 on bar, 17 on the
     * PCA score plot, 18 on XY. There is no global legend size for a per-kind value to shadow,
     * so excluding it hides nothing; the three sizes that are set globally are still asserted
     * absent, by name, which is the purpose of this check.
     */
    expect(bar.fonts?.title, "bar sets its own title size instead of the shared preset's").toBeUndefined();
    expect(bar.fonts?.axisTitle, "bar sets its own axis-title size instead of the shared preset's").toBeUndefined();
    expect(bar.fonts?.tick, "bar sets its own tick size instead of the shared preset's").toBeUndefined();
    expect(bar.axes, "bar sets its own tick fonts instead of the shared preset's").toBeUndefined();
  });

  it("does not carry figure size — graphs stay homogeneous with the others", () => {
    // Design rule: keep the original figure size, so graphs stay homogeneous with each other.
    expect(bar.plot?.figureWidth, "a figure width leaked into the house default").toBeUndefined();
    expect(bar.plot?.figureHeight, "a figure height leaked into the house default").toBeUndefined();
  });

  it("does not carry per-figure content", () => {
    // Axis titles such as "Group"/"Mean" describe one dataset, not a house style, and would
    // otherwise be stamped onto every new bar chart.
    expect(bar.axes?.x?.title, "an axis title leaked into the house default").toBeUndefined();
    expect(bar.axes?.y?.title, "an axis title leaked into the house default").toBeUndefined();
    expect(bar.plot?.title, "a graph title leaked into the house default").toBeUndefined();
  });

  /** Note: "xy", "scatter", "box" and "histogram" have house defaults of their own (XY: 8px
   *  markers, an 18px legend, a 1.4× legend symbol).
   *  The guard's purpose: bar's 14px markers must not leak, and the kinds in the loop below
   *  have no default at all. A kind that gains a default keeps the leak check by name —
   *  removing it outright would be the one edit that makes this test stop measuring. */
  it("applies to bar only — an XY scatter must not inherit 14px markers", () => {
    // 8: XY's own marker size.
    expect(KIND_HOUSE_DEFAULTS.xy?.series?.symbolSize, "XY lost its own marker size").toBe(8);
    expect(KIND_HOUSE_DEFAULTS.xy?.series?.symbolSize, "XY inherited bar's marker size").not.toBe(14);
    expect(KIND_HOUSE_DEFAULTS.scatter?.series?.symbolSize, "column scatter inherited bar's marker size").not.toBe(14);
    // 11.5: the histogram's own number, not bar's.
    expect(KIND_HOUSE_DEFAULTS.histogram?.series?.symbolSize, "histogram lost its own marker size").toBe(11.5);
    expect(KIND_HOUSE_DEFAULTS.histogram?.series?.symbolSize, "histogram inherited bar's marker size").not.toBe(14);
    for (const k of ["violin", "raincloud"] as const) {
      expect(KIND_HOUSE_DEFAULTS[k], `${k} picked up a house default it should not have`).toBeUndefined();
    }
    // …and the kind-agnostic preset still carries the small marker for everything else.
    expect(STYLE_PRESETS[0]!.markerSize, "the shared preset's marker size moved").toBe(6.5);
  });
});

/**
 * …and it must actually reach the plot. A default that never lands is as dead as none.
 */
describe("applyKindHouseDefaults", () => {
  const makeBar = () => {
    const doc = new MadyDocument();
    const t = doc.addTable("T", "column", ["G", "Y"]);
    doc.addRow(t.id, ["one", 10]);
    const plot = doc.addPlot("P", t.id);
    doc.setPlotOptions(plot.id, { kind: "bar" });
    return { doc, plotId: plot.id, tableId: t.id };
  };

  it("lands every bar value on the plot", () => {
    const { doc, plotId } = makeBar();
    applyKindHouseDefaults(doc, plotId, "bar", tableDatasets);
    const p = doc.toJSON().plots.find((x) => x.id === plotId)!;
    expect(p.barWidth, "bar width never reached the plot").toBe(0.38);
    // Type sizes are the shared preset's job (see above) — this function must not write them.
    expect(p.fonts?.title?.size, "the bar house default wrote its own title size").toBeUndefined();
    const style = Object.values(p.seriesStyles ?? {})[0] as { symbolSize?: number } | undefined;
    expect(style?.symbolSize, "data point size never reached the series style").toBe(14);
  });

  /** Note: violin has no house default, so it is the kind that proves this function is a no-op
   *  where there is nothing to apply. If violin gains a default, the `toBeUndefined` below
   *  fails and signals that another kind without one should be chosen, rather than the test
   *  being deleted. */
  it("leaves a plot with no house default completely alone", () => {
    const doc = new MadyDocument();
    const t = doc.addTable("T", "xy", ["X", "Y"]);
    doc.addRow(t.id, [1, 10]);
    const plot = doc.addPlot("P", t.id);
    expect(KIND_HOUSE_DEFAULTS.violin, "violin grew a house default — pick another kind here").toBeUndefined();
    const before = JSON.stringify(doc.toJSON().plots[0]);
    applyKindHouseDefaults(doc, plot.id, "violin", tableDatasets);
    expect(JSON.stringify(doc.toJSON().plots[0]), "a plot with no house default was modified").toBe(before);
  });
});

/**
 * The demo project ships the same look.
 *
 * Guards against the sample document applying only the kind-agnostic preset: its bar chart
 * would then be the one bar chart in the program without the type's real default — 82%-wide
 * bars, 4px dots, small type — while the user's next bar chart would come out at 0.38 / 14px.
 * A demo meant to show what graphs look like must not be the exception.
 */
describe("the sample document's bar graph carries the bar house default", () => {
  const barPlot = () => {
    const doc = createSampleDocument().toJSON();
    return doc.plots.find((p) => p.kind === "bar")!;
  };

  it("stamps every bar value onto the demo bar chart", () => {
    const p = barPlot();
    expect(p, "the demo bar chart is gone — the guard would prove nothing").toBeTruthy();
    expect(p.barWidth, "bar width").toBe(0.38);
    // The type sizes reach it from the shared preset, not from a bar-only override.
    expect(p.fonts?.title?.size, "title size").toBe(26);
    expect(p.fonts?.axisTitle?.size, "axis title size").toBe(22);
    const sizes = Object.values(p.seriesStyles ?? {}).map((s) => s?.symbolSize);
    expect(sizes.length, "no series styles on the demo bar chart").toBeGreaterThan(0);
    for (const s of sizes) expect(s, "data point size").toBe(14);
  });

  it("leaves the other demo graphs on the shared preset", () => {
    // The positive control for the guard above: if the layering had been applied
    // indiscriminately, the dose-response scatter would be carrying 14px markers too.
    const doc = createSampleDocument().toJSON();
    const xy = doc.plots.find((p) => p.kind === undefined || p.kind === "xy")!;
    const sizes = Object.values(xy.seriesStyles ?? {}).map((s) => s?.symbolSize);
    expect(sizes.length, "no series styles on the demo XY graph").toBeGreaterThan(0);
    // 8 = XY's own house default, never bar's 14 — the leak between kinds is what this
    // guards; the exact number is whatever the XY house default currently sets.
    for (const s of sizes) expect(s, "the XY demo graph inherited the bar marker size").toBe(8);
    expect(xy.barWidth, "the XY demo graph inherited the bar width").toBeUndefined();
  });
});

/**
 * The network house default, and the merge it depends on.
 *
 * The bar default is all scalars, so `setPlotOptions` being `Object.assign` does not matter.
 * The network default is a whole `NetworkStyle` object, and a plain assign replaces the key —
 * which would silently discard whatever the plot already had there. The gallery's network card
 * ships `layout: "layered"`, so a naive house default would revert it to force-directed with
 * nothing to indicate why.
 */
describe("the network house default", () => {
  const net = KIND_HOUSE_DEFAULTS.network!;

  const makeNetwork = (existing?: Record<string, unknown>) => {
    const doc = new MadyDocument();
    const t = doc.addTable("T", "xy", ["Source", "Target"]);
    doc.addRow(t.id, ["a", "b"]);
    const plot = doc.addPlot("P", t.id);
    doc.setPlotOptions(plot.id, { kind: "network", ...(existing ? { network: existing } : {}) });
    return { doc, plotId: plot.id };
  };

  it("gives a network curved edges, a page-coloured halo and a clear colour ramp", () => {
    const n = net.plot?.network as Record<string, unknown> | undefined;
    expect(n, "the network house default is gone").toBeTruthy();
    expect(n!.curved, "the edges are not curved").toBe(true);
    expect(n!.nodeStroke, "the halo must be the page colour so it follows the theme").toBe("var(--bg)");
    // The ramp endpoints matter most: with a poorly chosen pair, a straight RGB mix passes
    // through a muddy mauve at the midpoint.
    expect(n!.lowColor).toBe("#6baed6");
    expect(n!.highColor).toBe("#fc8d59");
  });

  /**
   * The house default does not set `nodeTwoTone`.
   *
   * Left unset, each node's ring is the shared page-colour halo (`nodeStroke: var(--bg)`,
   * asserted above), which keeps a dark ring from covering a small node's fill. An explicit
   * `nodeTwoTone` — the Inspector's two-tone switch — overrides that halo, so it is the
   * user's choice and stays out of the preset.
   */
  it("does not carry the nodeTwoTone flag", () => {
    const n = net.plot?.network as Record<string, unknown>;
    expect("nodeTwoTone" in n, "the network house default sets nodeTwoTone, which overrides the page-colour halo").toBe(false);
  });

  it("does not pin the layout — that is a per-graph choice", () => {
    expect((net.plot?.network as Record<string, unknown>).layout).toBeUndefined();
  });

  it("lands on a plain network plot", () => {
    const { doc, plotId } = makeNetwork();
    applyKindHouseDefaults(doc, plotId, "network", tableDatasets);
    const p = doc.toJSON().plots.find((x) => x.id === plotId)!;
    expect(p.network?.curved, "the house default never reached the plot").toBe(true);
    expect(p.network?.nodeSize).toBe(9);
  });

  it("merges — a choice already on the plot survives, and wins", () => {
    // Guards against the house default wiping the plot's own `layout`.
    const { doc, plotId } = makeNetwork({ layout: "layered", nodeSize: 22 });
    applyKindHouseDefaults(doc, plotId, "network", tableDatasets);
    const p = doc.toJSON().plots.find((x) => x.id === plotId)!;
    expect(p.network?.layout, "the plot's own layout was discarded by the house default").toBe("layered");
    expect(p.network?.nodeSize, "the house default overrode a value the user had already set").toBe(22);
    // …while everything the plot did not set still arrives.
    expect(p.network?.curved).toBe(true);
  });
});
