// @vitest-environment jsdom
/**
 * Marker shapes as a preset parameter — redundant encoding.
 *
 * A figure that separates its series by colour alone stops working the moment it is printed in
 * greyscale, or read by someone who cannot tell those hues apart. Shape carries the same
 * information through both, so groups stay distinguishable without differing colours.
 *
 * `SeriesStyle.symbol` offers a set of marker shapes and a per-series control; a preset can also say "cycle
 * shape across the series" (`symbolShapes`): `applyStylePreset` cycles it the way it cycles
 * `palette`, and a saved preset captures the shapes along with the colours.
 *
 * Both halves are conditional, and the "leaves it alone" tests are the ones that matter:
 * most built-ins carry no shapes, and an older saved preset carries none, so writing
 * unconditionally would reset every graph's markers to circles on every apply.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { MadyDocument, STYLE_PRESETS, findPreset } from "@mady/core";
import type { DataTable, Plot, Project, StylePreset, SymbolShape } from "@mady/core";
import { buildPlotScene } from "@mady/graphics";
import { PlotFigure } from "./PlotFigure";

afterEach(cleanup);

const measure = (t: string, px: number): number => t.length * px * 0.6;
const SIZE = { width: 520, height: 360 };
const table: DataTable = {
  id: "t", kind: "xy", name: "t",
  columns: [
    { id: "x", name: "Dose", role: "x", type: "number" },
    { id: "a", name: "A", role: "y", type: "number" },
    { id: "b", name: "B", role: "y", type: "number" },
    { id: "c", name: "C", role: "y", type: "number" },
  ],
  rows: [0, 1, 2, 3].map((i) => ({ id: `r${i}`, cells: { x: i, a: i * 2 + 1, b: i * 1.4, c: i * 0.7 } })),
};
/** A graph whose series the user has already shaped by hand. */
const handShaped = (): Plot =>
  ({
    id: "p", name: "p", source: "t", status: "ok", styleOverrides: {}, kind: "xy",
    seriesStyles: { a: { symbol: "star" }, b: { symbol: "star" }, c: { symbol: "star" } },
  } as unknown as Plot);

function applied(plot: Plot, preset: StylePreset): Plot {
  const p = JSON.parse(JSON.stringify(plot)) as Plot;
  const project: Project = { schemaVersion: 4, tables: [table], plots: [p], analyses: [], log: [], workspace: { folders: [], loose: [] } };
  const doc = new MadyDocument(project);
  doc.applyStylePreset(p.id, preset);
  return doc.toJSON().plots[0]!;
}
const house = (): StylePreset => findPreset("MadY default")!;
const CYCLE: SymbolShape[] = ["circle", "square", "triangle"];

describe("a preset can cycle marker shapes across the series", () => {
  it("gives each series the next shape in the cycle", () => {
    const out = applied(handShaped(), { ...house(), name: "t", symbolShapes: CYCLE });
    expect(out.seriesStyles?.a?.symbol).toBe("circle");
    expect(out.seriesStyles?.b?.symbol).toBe("square");
    expect(out.seriesStyles?.c?.symbol).toBe("triangle");
  });

  it("wraps when there are more series than shapes", () => {
    const out = applied(handShaped(), { ...house(), name: "t", symbolShapes: ["diamond", "cross"] });
    expect([out.seriesStyles?.a?.symbol, out.seriesStyles?.b?.symbol, out.seriesStyles?.c?.symbol])
      .toEqual(["diamond", "cross", "diamond"]);
  });

  /** On the drawing, not just in the plot — and as three different marks, which is the point. */
  it("draws three different marks", () => {
    const out = applied(handShaped(), { ...house(), name: "t", symbolShapes: CYCLE });
    const scene = buildPlotScene(table, out, { measure, ...SIZE });
    expect(scene.series.map((s) => s.symbol)).toEqual(["circle", "square", "triangle"]);
    const { container } = render(<PlotFigure scene={scene} />);
    // A circle draws <circle>, a square <rect>, a triangle a <polygon> — three different tags is
    // the greyscale-legible outcome, and a shape that silently fell back to a dot would fail here.
    expect(container.querySelectorAll("circle").length).toBeGreaterThan(0);
    expect(container.querySelectorAll("polygon").length).toBeGreaterThan(0);
  });

  /** A preset that says nothing about shape must not reset the user's own. */
  it("leaves hand-picked shapes alone when the preset carries none", () => {
    const out = applied(handShaped(), house());
    for (const id of ["a", "b", "c"]) {
      expect(out.seriesStyles?.[id]?.symbol, `the preset reset series ${id} to a default marker`).toBe("star");
    }
  });

  /**
   * Only the presets that call for one carry one: "Universal design" (redundant encoding is
   * the point of that preset) and "Grayscale (print)" (in black and white the series differ
   * only by grey level, so the shapes tell them apart). Any other name here is a
   * preset changing without anyone deciding it should.
   */
  it("only the presets meant to carry a shape cycle carry one", () => {
    const ALLOWED = ["Universal design", "Grayscale (print)"];
    const offenders = STYLE_PRESETS.filter((p) => !ALLOWED.includes(p.name) && p.symbolShapes !== undefined).map((p) => p.name);
    expect(offenders, `these presets must not set symbolShapes: ${offenders.join(", ")}`).toEqual([]);
    // …and each exception is real, or the check above protects nothing.
    for (const name of ALLOWED) expect(findPreset(name)?.symbolShapes?.length, `${name} carries no cycle`).toBeGreaterThan(3);
  });
});

/**
 * The saved-preset half. `UserPreset.shapes` is sampled from the source graph exactly as its
 * colours are — this is what "captured when a preset is defined" means for shape.
 */
describe("a saved preset carries the shapes it was saved with", () => {
  const applyUser = (plot: Plot, palette: string[], shapes?: SymbolShape[]): Plot => {
    const p = JSON.parse(JSON.stringify(plot)) as Plot;
    const project: Project = { schemaVersion: 4, tables: [table], plots: [p], analyses: [], log: [], workspace: { folders: [], loose: [] } };
    const doc = new MadyDocument(project);
    doc.applyUserPreset(p.id, {}, palette, [], shapes);
    return doc.toJSON().plots[0]!;
  };

  it("reproduces them on the target, in order", () => {
    const out = applyUser(handShaped(), ["#111", "#222", "#333"], ["hexagon", "plus", "diamond"]);
    expect([out.seriesStyles?.a?.symbol, out.seriesStyles?.b?.symbol, out.seriesStyles?.c?.symbol])
      .toEqual(["hexagon", "plus", "diamond"]);
  });

  /**
   * `UserPreset.shapes` is optional, and a preset saved by a version that did not capture shapes
   * has none. Applying such a preset must leave the target's own shapes alone — not reset every
   * marker to a circle.
   */
  it("leaves the target's shapes alone when the preset predates them", () => {
    const out = applyUser(handShaped(), ["#111", "#222", "#333"], undefined);
    for (const id of ["a", "b", "c"]) {
      expect(out.seriesStyles?.[id]?.symbol, `a preset without shapes reset series ${id}`).toBe("star");
    }
    // …and it still applied the colours, so the check is not passing by doing nothing at all.
    expect(out.seriesStyles?.a?.color).toBe("#111");
  });
});
