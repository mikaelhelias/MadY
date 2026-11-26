// @vitest-environment node
/**
 * The shaping knobs reach the drawing — every site that has a control for them.
 *
 * `gradient-allsites.test.ts` proves a custom gradient reaches all twelve code sites. This file
 * proves the four per-plot knobs (centre at · detail bias · colour steps · blend) actually
 * change what is drawn at each of the six sites that expose a control for them, and that the
 * one refusal — a midpoint outside the data — is said out loud instead of silently ignored.
 *
 * The oracle for "steps" is countable and needs no reference implementation: n classes must
 * produce exactly n distinct colours in the scene. For the others: the colours change, and
 * with every knob unset the scene is bit-identical to the untouched ramp.
 */
import { describe, expect, it } from "vitest";
import type { DataTable, Gradient, Plot } from "@mady/core";
import { buildPlotScene } from "./buildScene";
import { midpointOutOfRangeWarning } from "./color.js";

const opts = { width: 560, height: 400 } as const;
const distinct = <T>(xs: T[]): number => new Set(xs).size;

const hmTable: DataTable = {
  id: "th", kind: "xy", name: "H",
  columns: [
    { id: "g", name: "Gene", role: "x" }, { id: "c1", name: "Cond1", role: "y" },
    { id: "c2", name: "Cond2", role: "y" }, { id: "c3", name: "Cond3", role: "y" },
  ],
  // 12 distinct values spanning -5..6, so a midpoint at 0 has data on both sides.
  rows: [
    { id: "r1", cells: { g: "G1", c1: -5, c2: -3, c3: -1 } },
    { id: "r2", cells: { g: "G2", c1: 0, c2: 1, c3: 2 } },
    { id: "r3", cells: { g: "G3", c1: 3, c2: 4, c3: 6 } },
  ],
};
const xyTable: DataTable = {
  id: "tx", kind: "xy", name: "X",
  columns: [{ id: "x", name: "X", role: "x" }, { id: "y", name: "Y", role: "y" }, { id: "z", name: "Z", role: "y" }],
  rows: [1, 2, 3, 4, 5, 6].map((i) => ({ id: `r${i}`, cells: { x: i, y: i * 2, z: i } })),
};
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
const tracksTable: DataTable = {
  id: "tt", kind: "xy", name: "T",
  columns: [{ id: "t", name: "Week", role: "x" }, { id: "shan", name: "Shannon", role: "y" }],
  // Note: seven rows, not eight: with eight, every tile lands exactly on one of plasma's eight
  // stops, where all three blend spaces agree — a fixture that cannot exhibit the difference
  // cannot guard against it (it would pass a broken Blend control).
  rows: [0, 1, 2, 3, 4, 5, 6].map((i) => ({ id: `k${i}`, cells: { t: i, shan: i } })),
};
const ridgeTable: DataTable = {
  id: "tr", kind: "column", name: "R",
  columns: [
    { id: "x", name: "Row", role: "x" }, { id: "a", name: "A", role: "y" },
    { id: "b", name: "B", role: "y" }, { id: "c", name: "C", role: "y" },
  ],
  rows: [10, 11, 12, 13, 14, 15].map((v, i) => ({ id: `r${i}`, cells: { x: i + 1, a: v, b: v + 10, c: v + 20 } })),
};
const plot = (p: Partial<Plot> & { source: string }): Plot =>
  ({ id: "p", name: "P", status: "ok", styleOverrides: {}, ...p }) as Plot;

// ---------------------------------------------------------------------------

describe("heatmap cells + colour bar", () => {
  const build = (h: NonNullable<Plot["heatmap"]>) =>
    buildPlotScene(hmTable, plot({ source: "th", kind: "heatmap", heatmap: { colormap: "coolwarm", ...h } }), opts);
  const cells = (h: NonNullable<Plot["heatmap"]>): string[] => build(h).heatmap!.cells.map((c) => c.color);

  it("with no knob set, the ramp is exactly the untouched one", () => {
    expect(cells({})).toEqual(cells({ colorMidpoint: undefined, colorGamma: undefined, colorSteps: undefined, colorSpace: undefined }));
  });

  it("colour steps: 3 classes → exactly 3 colours across 9 cells", () => {
    expect(distinct(cells({}))).toBe(9);
    expect(distinct(cells({ colorSteps: 3 }))).toBe(3);
    expect(distinct(cells({ colorSteps: 5 }))).toBe(5);
  });

  it("centre at 0 moves the mid colour onto the zero cell (a diverging map)", () => {
    // Data runs -5..6, so the auto middle is 0.5 — the zero cell is left of centre and reads
    // as a cool colour. Pinning the midpoint to 0 gives that cell the ramp's middle colour.
    const zeroCellAuto = build({}).heatmap!.cells.find((c) => c.value === 0)!.color;
    const zeroCellPinned = build({ colorMidpoint: 0 }).heatmap!.cells.find((c) => c.value === 0)!.color;
    expect(zeroCellPinned).not.toBe(zeroCellAuto);
    // …and it is the ramp's own centre: the same colour a symmetric scale would put there.
    const symmetric = buildPlotScene(
      hmTable,
      plot({ source: "th", kind: "heatmap", heatmap: { colormap: "coolwarm", valueMin: -6, valueMax: 6 } }),
      opts,
    ).heatmap!.cells.find((c) => c.value === 0)!.color;
    expect(zeroCellPinned).toBe(symmetric);
    // the ends are untouched by the remap
    expect(cells({ colorMidpoint: 0 })[0]).toBe(cells({})[0]);
  });

  it("a midpoint outside the data is refused out loud, not silently dropped", () => {
    const s = build({ colorMidpoint: 99 });
    expect(s.heatmap!.cells.map((c) => c.color)).toEqual(cells({}));
    expect(s.warnings).toContain(midpointOutOfRangeWarning(99, -5, 6));
  });

  it("detail bias and blend space both change the cells", () => {
    expect(cells({ colorGamma: 2 })).not.toEqual(cells({}));
    expect(cells({ colorSpace: "lab" })).not.toEqual(cells({}));
    expect(cells({ colorSpace: "hsl" })).not.toEqual(cells({ colorSpace: "lab" }));
  });

  it("the colour bar follows the cells — a stepped map gets a stepped key", () => {
    const smooth = build({}).heatmap!.scaleStops.map((x) => x.color);
    const stepped = build({ colorSteps: 3 }).heatmap!.scaleStops.map((x) => x.color);
    expect(stepped).not.toEqual(smooth);
    expect(distinct(stepped)).toBeLessThanOrEqual(3);
  });
});

describe("graduated fills", () => {
  const fills = (extra: Record<string, unknown>): string[] =>
    buildPlotScene(catTable, plot({
      source: "tc", kind: "bar",
      seriesStyles: { a: { fillType: "graduated", gradRamp: "viridis", gradMap: "value", ...extra } as never },
    }), opts).series.find((s) => s.id === "a")!.marks.map((m) => m.fill ?? "");

  it("steps quantise the bars", () => {
    expect(distinct(fills({}))).toBe(4);
    expect(distinct(fills({ gradSteps: 2 }))).toBe(2);
  });

  it("centre / bias / blend each change the fills, and nothing set changes nothing", () => {
    expect(fills({ gradMidpoint: 4 })).not.toEqual(fills({}));
    expect(fills({ gradGamma: 0.4 })).not.toEqual(fills({}));
    expect(fills({ gradSpace: "hsl" })).not.toEqual(fills({}));
    expect(fills({ gradMidpoint: undefined, gradGamma: undefined })).toEqual(fills({}));
  });
});

describe("colour from a data column — and the colour bar that keys it", () => {
  const build = (extra: Record<string, unknown>) =>
    buildPlotScene(xyTable, plot({
      source: "tx", kind: "xy",
      seriesStyles: { y: { colorFromColumn: "z", colorFromMode: "continuous", colorFromRamp: "turbo", ...extra } as never },
    }), opts);

  it("steps quantise the points and the bar that explains them", () => {
    const marks = (e: Record<string, unknown>): string[] => build(e).series.find((s) => s.id === "y")!.marks.map((m) => m.fill ?? "");
    expect(distinct(marks({}))).toBe(6);
    expect(distinct(marks({ colorFromSteps: 3 }))).toBe(3);
    // the key must not stay smooth while the marks are stepped, or it misrepresents the picture
    expect(build({ colorFromSteps: 3 }).colorbar!.stops.map((x) => x.color))
      .not.toEqual(build({}).colorbar!.stops.map((x) => x.color));
  });

  it("centre / bias / blend reach the points", () => {
    const marks = (e: Record<string, unknown>): string[] => build(e).series.find((s) => s.id === "y")!.marks.map((m) => m.fill ?? "");
    expect(marks({ colorFromMidpoint: 2 })).not.toEqual(marks({}));
    expect(marks({ colorFromGamma: 3 })).not.toEqual(marks({}));
    expect(marks({ colorFromSpace: "lab" })).not.toEqual(marks({}));
  });
});

describe("parallel coordinates", () => {
  const build = (extra: Record<string, unknown>) =>
    buildPlotScene(hmTable, plot({
      source: "th", kind: "parallel",
      // c2 (-3, 1, 4), not c1: c1's middle row normalises to exactly 0.625 — a viridis stop,
      // where every blend space gives the same colour and the Blend knob looks inert.
      parallel: { colorColumn: "c2", colorScale: "value", colorRamp: "viridis", ...extra },
    }), opts);

  it("steps quantise the lines and their colour bar", () => {
    expect(distinct(build({}).parallel!.lines.map((l) => l.color))).toBe(3);
    expect(distinct(build({ colorSteps: 2 }).parallel!.lines.map((l) => l.color))).toBe(2);
    expect(build({ colorSteps: 2 }).colorbar!.stops.map((x) => x.color))
      .not.toEqual(build({}).colorbar!.stops.map((x) => x.color));
  });

  it("centre / bias / blend reach the lines", () => {
    const lines = (e: Record<string, unknown>): string[] => build(e).parallel!.lines.map((l) => l.color);
    expect(lines({ colorMidpoint: 0 })).not.toEqual(lines({}));
    expect(lines({ colorGamma: 2.5 })).not.toEqual(lines({}));
    expect(lines({ colorSpace: "hsl" })).not.toEqual(lines({}));
  });
});

describe("timeline tracks", () => {
  const tiles = (extra: Record<string, unknown>): string[] =>
    buildPlotScene(tracksTable, plot({ source: "tt", kind: "tracks", tracks: { colormap: "plasma", ...extra } }), opts)
      .tracks!.strips.filter((s) => s.numeric).flatMap((s) => s.tiles.map((t) => t.color));

  it("steps quantise the tiles; the other knobs recolour them", () => {
    expect(distinct(tiles({}))).toBe(7);
    expect(distinct(tiles({ colorSteps: 4 }))).toBe(4);
    expect(tiles({ colorMidpoint: 2 })).not.toEqual(tiles({}));
    expect(tiles({ colorGamma: 0.5 })).not.toEqual(tiles({}));
    expect(tiles({ colorSpace: "lab" })).not.toEqual(tiles({}));
  });
});

describe("the ridgeline spectrum", () => {
  const stops = (extra: Record<string, unknown>): string[] =>
    buildPlotScene(ridgeTable, plot({
      source: "tr", kind: "ridgeline", ridgeline: { spectrum: true, spectrumMap: "rainbow", ...extra },
    }), opts).series.flatMap((s) => (s.fillSpec?.type === "axisGradient" ? s.fillSpec.stops.map((x) => x.color) : []));

  it("steps turn the smooth sweep into bands; blend + bias recolour it", () => {
    const plain = stops({});
    expect(plain.length).toBeGreaterThan(0);
    const stepped = stops({ spectrumSteps: 4 });
    expect(distinct(stepped)).toBe(4);
    expect(stops({ spectrumGamma: 2 })).not.toEqual(plain);
    expect(stops({ spectrumSpace: "hsl" })).not.toEqual(plain);
  });
});

describe("the colour bar draws what the marks draw", () => {
  const build = (h: NonNullable<Plot["heatmap"]>) =>
    buildPlotScene(hmTable, plot({ source: "th", kind: "heatmap", heatmap: { colormap: "coolwarm", ...h } }), opts);

  it("a stepped map's key is a staircase — two stops per class, edges that are edges", () => {
    const stops = build({ colorSteps: 4 }).heatmap!.scaleStops;
    expect(stops).toHaveLength(8);
    expect(stops.map((s) => s.offset)).toEqual([0, 0.25, 0.25, 0.5, 0.5, 0.75, 0.75, 1]);
    expect(distinct(stops.map((s) => s.color))).toBe(4);
    // the pairs are flat: without this the SVG gradient blends across every class edge
    for (let k = 0; k < 8; k += 2) expect(stops[k]!.color).toBe(stops[k + 1]!.color);
  });

  it("…and the key's colours are the cells' colours, not a second opinion", () => {
    const s = build({ colorSteps: 4 });
    const cellColours = new Set(s.heatmap!.cells.map((c) => c.color));
    for (const st of s.heatmap!.scaleStops) expect(cellColours.has(st.color)).toBe(true);
  });

  it("a smooth map's key stays a smooth sample", () => {
    const stops = build({}).heatmap!.scaleStops;
    expect(distinct(stops.map((s) => s.offset))).toBe(stops.length); // no duplicate offsets
    expect(stops.length).toBeGreaterThan(4);
  });
});

describe("out-of-range colours on a pinned scale", () => {
  it("a value under a pinned minimum takes the gradient's under colour", () => {
    const under: Gradient = {
      id: "u", name: "U", mode: "stops",
      stops: [{ pos: 0, color: "#0000ff" }, { pos: 1, color: "#ff0000" }],
      underColor: "#00ff00", overColor: "#ffff00",
    };
    // data runs -5..6; pin the scale to 0..3 so cells fall off both ends
    const s = buildPlotScene(
      hmTable,
      plot({ source: "th", kind: "heatmap", heatmap: { colormap: "custom:u", valueMin: 0, valueMax: 3 } }),
      { ...opts, gradients: (id) => (id === "u" ? under : undefined) },
    );
    const byValue = new Map(s.heatmap!.cells.map((c) => [c.value, c.color]));
    expect(byValue.get(-5), "a value below the pinned minimum").toBe("#00ff00");
    expect(byValue.get(6), "a value above the pinned maximum").toBe("#ffff00");
    expect(byValue.get(0), "the pinned minimum itself is IN range").toBe("#0000ff");
    expect(byValue.get(3), "the pinned maximum itself is IN range").toBe("#ff0000");
  });
});
