// @vitest-environment node
/**
 * A user-built gradient reaches every place that paints by value.
 *
 * There are twelve sites in buildScene.ts that turn a number into a colour. A site that resolves
 * its ramp itself — its own closure, or indexing COLORMAPS directly and bypassing the ramp
 * layer — is how a site gets left behind: it keeps working with the built-ins, so nothing
 * fails, and only a custom gradient reveals that it never asked the registry.
 *
 * This test pins all twelve. Adding a thirteenth site (or a new kind that paints by value) without
 * routing it through the scene's `RampResolver` leaves its row here failing.
 *
 * The oracle: the gradient is pure red → pure blue interpolated in RGB, so every colour it can
 * produce has a green channel of zero. Viridis — the ramp each site defaults to — has no such
 * colour. So "the custom gradient reached this site" is decidable from the scene alone, without
 * re-implementing the mapping the code under test uses.
 */
import { describe, expect, it } from "vitest";
import type { DataTable, Gradient, Plot } from "@mady/core";
import { buildPlotScene } from "./buildScene";
import { missingGradientWarning } from "./color.js";

const RED_BLUE: Gradient = {
  id: "g1",
  name: "Red to blue",
  mode: "stops",
  stops: [{ pos: 0, color: "#ff0000" }, { pos: 1, color: "#0000ff" }],
};
const registry = (id: string): Gradient | undefined => (id === "g1" ? RED_BLUE : undefined);
const opts = { width: 560, height: 400, gradients: registry } as const;

/** Every colour this gradient can produce has a zero green channel; viridis never does. */
const onRamp = (c: string): boolean => /^#[0-9a-f]{2}00[0-9a-f]{2}$/i.test(c);

/** Assert a site's colours: non-empty, all on the custom ramp, and different from the default. */
function expectSite(name: string, custom: string[], dflt: string[]): void {
  expect(custom.length, `${name}: no colours came out of the scene`).toBeGreaterThan(0);
  expect(dflt.length, `${name}: the default-ramp build drew nothing to compare against`).toBeGreaterThan(0);
  // Not a length check: a site that emits one stop per ramp stop (the ridgeline spectrum)
  // legitimately produces fewer colours for a 2-stop gradient than for 6-stop coolwarm.
  const off = custom.filter((c) => !onRamp(c));
  expect(off, `${name}: these colours are not from the custom gradient`).toEqual([]);
  expect(custom, `${name}: the custom gradient changed nothing`).not.toEqual(dflt);
}

// ---- tables ---------------------------------------------------------------
const catTable: DataTable = {
  id: "tc", kind: "column", name: "C",
  columns: [{ id: "c", name: "Group", role: "x" }, { id: "a", name: "A", role: "y" }, { id: "b", name: "B", role: "y" }],
  rows: [
    { id: "r1", cells: { c: "Alpha", a: 5, b: 8 } },
    { id: "r2", cells: { c: "Beta", a: 9, b: 4 } },
    { id: "r3", cells: { c: "Gamma", a: 6, b: 7 } },
    { id: "r4", cells: { c: "Delta", a: 3, b: 9 } },
  ],
};
const xyTable: DataTable = {
  id: "tx", kind: "xy", name: "X",
  columns: [{ id: "x", name: "X", role: "x" }, { id: "y", name: "Y", role: "y" }, { id: "z", name: "Z", role: "y" }],
  rows: [
    { id: "r1", cells: { x: 1, y: 2, z: 3 } },
    { id: "r2", cells: { x: 2, y: 5, z: 2 } },
    { id: "r3", cells: { x: 3, y: 4, z: 6 } },
    { id: "r4", cells: { x: 4, y: 9, z: 4 } },
    { id: "r5", cells: { x: 5, y: 6, z: 8 } },
  ],
};
const hmTable: DataTable = {
  id: "th", kind: "xy", name: "H",
  columns: [
    { id: "g", name: "Gene", role: "x" }, { id: "c1", name: "Cond1", role: "y" },
    { id: "c2", name: "Cond2", role: "y" }, { id: "c3", name: "Cond3", role: "y" },
  ],
  rows: [
    { id: "r1", cells: { g: "G1", c1: 1, c2: 5, c3: 3 } },
    { id: "r2", cells: { g: "G2", c1: 8, c2: 2, c3: 6 } },
    { id: "r3", cells: { g: "G3", c1: 4, c2: 7, c3: 1 } },
  ],
};
const ternaryTable: DataTable = {
  id: "ttern", kind: "multivariable", name: "Compositions",
  columns: [
    { id: "smp", name: "Sample", role: "x" }, { id: "ca", name: "Sand", role: "y" },
    { id: "cb", name: "Silt", role: "y" }, { id: "cc", name: "Clay", role: "y" },
  ],
  rows: [
    { id: "t1", cells: { smp: "P", ca: 70, cb: 20, cc: 10 } },
    { id: "t2", cells: { smp: "Q", ca: 30, cb: 50, cc: 20 } },
    { id: "t3", cells: { smp: "R", ca: 10, cb: 30, cc: 60 } },
    { id: "t4", cells: { smp: "S", ca: 33, cb: 33, cc: 34 } },
  ],
};
const tracksTable: DataTable = {
  id: "ttracks", kind: "xy", name: "Tracks",
  columns: [
    { id: "t", name: "Week", role: "x" }, { id: "diet", name: "Diet", role: "y" },
    { id: "shan", name: "Shannon", role: "y" }, { id: "bact", name: "Bacteroides", role: "y" },
  ],
  rows: [
    { id: "k0", cells: { t: 0, diet: "Chow", shan: 3.4, bact: 41 } },
    { id: "k1", cells: { t: 1, diet: "Chow", shan: 3.5, bact: 44 } },
    { id: "k2", cells: { t: 2, diet: "High-fat", shan: 2.6, bact: 28 } },
    { id: "k3", cells: { t: 3, diet: "High-fat", shan: 2.4, bact: 22 } },
    { id: "k4", cells: { t: 4, diet: "Chow", shan: 3.1, bact: 36 } },
  ],
};
const ridgeTable: DataTable = {
  id: "tr", kind: "column", name: "R",
  columns: [
    { id: "x", name: "Row", role: "x" }, { id: "a", name: "A", role: "y" },
    { id: "b", name: "B", role: "y" }, { id: "c", name: "C", role: "y" },
  ],
  rows: [10, 11, 12, 13, 14, 15].map((v, i) => ({
    id: `r${i}`, cells: { x: i + 1, a: v, b: v + 10, c: v + 20 },
  })),
};

const plot = (p: Partial<Plot> & { source: string }): Plot => ({
  id: "p", name: "P", status: "ok", styleOverrides: {}, ...p,
} as Plot);

/** Build the same plot twice — once with the custom gradient, once with the default ramp. */
function pair(mk: (ramp: string) => { table: DataTable; plot: Plot }, dflt = "viridis") {
  const a = mk("custom:g1");
  const b = mk(dflt);
  return {
    custom: buildPlotScene(a.table, a.plot, opts),
    dflt: buildPlotScene(b.table, b.plot, opts),
  };
}

const gradFill = (ramp: string) => ({ fillType: "graduated" as const, gradRamp: ramp as never, gradMap: "value" as const });
const colorFrom = (ramp: string) => ({ colorFromColumn: "z", colorFromMode: "continuous" as const, colorFromRamp: ramp as never });

describe("a custom gradient reaches every value-painting site", () => {
  it("1. graduated bar fills (buildCategoricalScene)", () => {
    const s = pair((r) => ({
      table: catTable,
      plot: plot({ source: "tc", kind: "bar", seriesStyles: { a: gradFill(r), b: gradFill(r) } }),
    }));
    const marks = (sc: typeof s.custom): string[] => sc.series.flatMap((se) => se.marks.map((m) => m.fill ?? ""));
    expectSite("graduated bar", marks(s.custom), marks(s.dflt));
  });

  it("2. graduated box fills, vertical (buildDistributionScene)", () => {
    const s = pair((r) => ({
      table: catTable,
      plot: plot({ source: "tc", kind: "box", seriesStyles: { a: gradFill(r), b: gradFill(r) } }),
    }));
    const marks = (sc: typeof s.custom): string[] => sc.series.flatMap((se) => se.marks.map((m) => m.fill ?? ""));
    expectSite("graduated box", marks(s.custom), marks(s.dflt));
  });

  it("3. graduated box fills, horizontal (buildDistributionSceneHorizontal)", () => {
    const s = pair((r) => ({
      table: catTable,
      plot: plot({ source: "tc", kind: "box", barOrientation: "horizontal", seriesStyles: { a: gradFill(r), b: gradFill(r) } }),
    }));
    const marks = (sc: typeof s.custom): string[] => sc.series.flatMap((se) => se.marks.map((m) => m.fill ?? ""));
    expectSite("graduated box (horizontal)", marks(s.custom), marks(s.dflt));
  });

  it("4. per-point colour from a data column (paintDataDriven)", () => {
    const s = pair((r) => ({
      table: xyTable,
      plot: plot({ source: "tx", kind: "xy", seriesStyles: { y: colorFrom(r) } }),
    }));
    const marks = (sc: typeof s.custom): string[] =>
      sc.series.find((se) => se.id === "y")!.marks.map((m) => m.fill ?? "");
    expectSite("colour from column", marks(s.custom), marks(s.dflt));
  });

  it("5. the plot colour bar (buildPlotSceneInner)", () => {
    const s = pair((r) => ({
      table: xyTable,
      plot: plot({ source: "tx", kind: "xy", seriesStyles: { y: colorFrom(r) } }),
    }));
    expect(s.custom.colorbar, "no colour bar was emitted").toBeTruthy();
    expectSite("plot colour bar", s.custom.colorbar!.stops.map((x) => x.color), s.dflt.colorbar!.stops.map((x) => x.color));
  });

  it("6. parallel-coordinates lines + 7. their colour bar (buildParallelScene)", () => {
    const s = pair((r) => ({
      table: hmTable,
      plot: plot({ source: "th", kind: "parallel", parallel: { colorColumn: "c1", colorScale: "value", colorRamp: r as never } }),
    }));
    expectSite("parallel lines", s.custom.parallel!.lines.map((l) => l.color), s.dflt.parallel!.lines.map((l) => l.color));
    expect(s.custom.colorbar, "no parallel colour bar").toBeTruthy();
    expectSite("parallel colour bar", s.custom.colorbar!.stops.map((x) => x.color), s.dflt.colorbar!.stops.map((x) => x.color));
  });

  it("8. heatmap matrix cells + its colour scale (buildHeatmapScene)", () => {
    const s = pair((r) => ({
      table: hmTable,
      plot: plot({ source: "th", kind: "heatmap", heatmap: { colormap: r as never } }),
    }));
    expectSite("heatmap cells", s.custom.heatmap!.cells.map((c) => c.color), s.dflt.heatmap!.cells.map((c) => c.color));
    expectSite("heatmap colour bar", s.custom.heatmap!.scaleStops.map((x) => x.color), s.dflt.heatmap!.scaleStops.map((x) => x.color));
  });

  it("9. heatmap density / hexbin mode (buildDensityScene)", () => {
    const s = pair((r) => ({
      table: xyTable,
      plot: plot({ source: "tx", kind: "heatmap", heatmap: { mode: "density2d", colormap: r as never, resolution: 8 } }),
    }), "blues");
    expectSite("density cells", s.custom.heatmap!.cells.map((c) => c.color), s.dflt.heatmap!.cells.map((c) => c.color));
  });

  it("10. the ternary colour bar (buildTernaryScene)", () => {
    const s = pair((r) => ({
      table: ternaryTable,
      plot: plot({ source: "ttern", kind: "ternary", seriesStyles: { ca: { colorFromColumn: "cc", colorFromMode: "continuous", colorFromRamp: r as never } } }),
    }));
    expect(s.custom.colorbar, "no ternary colour bar").toBeTruthy();
    expectSite("ternary colour bar", s.custom.colorbar!.stops.map((x) => x.color), s.dflt.colorbar!.stops.map((x) => x.color));
  });

  it("11. timeline-track tiles + their strip colour bar (buildTracksScene)", () => {
    const s = pair((r) => ({
      table: tracksTable,
      plot: plot({ source: "ttracks", kind: "tracks", tracks: { colormap: r as never } }),
    }));
    const tiles = (sc: typeof s.custom): string[] =>
      sc.tracks!.strips.filter((st) => st.numeric).flatMap((st) => st.tiles.map((t) => t.color));
    expectSite("track tiles", tiles(s.custom), tiles(s.dflt));
    const bars = (sc: typeof s.custom): string[] =>
      sc.tracks!.strips.flatMap((st) => st.colorbar?.stops.map((x) => x.color) ?? []);
    expectSite("track colour bars", bars(s.custom), bars(s.dflt));
  });

  it("12. the ridgeline spectrum fill (buildRidgelineScene)", () => {
    const s = pair((r) => ({
      table: ridgeTable,
      plot: plot({ source: "tr", kind: "ridgeline", ridgeline: { spectrum: true, spectrumMap: r } }),
    }), "coolwarm");
    const stops = (sc: typeof s.custom): string[] =>
      sc.series.flatMap((se) => (se.fillSpec?.type === "axisGradient" ? se.fillSpec.stops.map((x) => x.color) : []));
    expectSite("ridgeline spectrum", stops(s.custom), stops(s.dflt));
  });
});

describe("a gradient the project no longer has", () => {
  const missing = plot({ source: "th", kind: "heatmap", heatmap: { colormap: "custom:gone" as never } });

  it("falls back to viridis and says so in the scene's warnings", () => {
    const s = buildPlotScene(hmTable, missing, { width: 560, height: 400, gradients: registry });
    const viridis = buildPlotScene(hmTable, plot({ source: "th", kind: "heatmap", heatmap: { colormap: "viridis" } }), { width: 560, height: 400 });
    expect(s.heatmap!.cells.map((c) => c.color)).toEqual(viridis.heatmap!.cells.map((c) => c.color));
    expect(s.warnings).toContain(missingGradientWarning("gone"));
  });

  it("says it once even though the cells, the colour bar and the labels all resolve the ramp", () => {
    const s = buildPlotScene(hmTable, missing, { width: 560, height: 400, gradients: registry });
    expect(s.warnings.filter((w) => w === missingGradientWarning("gone"))).toHaveLength(1);
  });

  it("a caller with no registry at all (gallery cards, fixtures) is warned the same way", () => {
    const s = buildPlotScene(hmTable, missing, { width: 560, height: 400 });
    expect(s.warnings).toContain(missingGradientWarning("gone"));
  });
});
