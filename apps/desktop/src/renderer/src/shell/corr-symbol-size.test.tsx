// @vitest-environment jsdom
/**
 * The correlation matrix's symbol size — in the cells and in the key beside them.
 *
 * Both are adjustable rather than fixed by the grid, and the key's symbol is not capped at a
 * 9px radius, so it grows with the figure and its font.
 *
 * Measured on the rendered figure, not the scene: the scene's `glyphPath` is a string the
 * builder was handed the numbers for, so diffing it would prove only that the builder read its
 * own input. These read the arc radius out of each drawn <path>.
 *
 * Caution: do not measure each path's width as max-x − min-x over every number in the `d`.
 * An arc is `A rx ry rot laf sf x y`, so "every other number" is not a coordinate — the widths
 * would be noise, and the cases would fail against working code.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import type { DataTable, Plot } from "@mady/core";
import { buildPlotScene } from "@mady/graphics";
import { PlotFigure } from "./PlotFigure";

afterEach(cleanup);

const table: DataTable = {
  id: "t", kind: "xy", name: "T",
  columns: [
    { id: "a", name: "Alpha", role: "y" },
    { id: "b", name: "Beta", role: "y" },
    { id: "c", name: "Gamma", role: "y" },
  ],
  rows: [
    { id: "r1", cells: { a: 1, b: 2.2, c: 5 } },
    { id: "r2", cells: { a: 2, b: 4.1, c: 3 } },
    { id: "r3", cells: { a: 3, b: 5.9, c: 4 } },
    { id: "r4", cells: { a: 4, b: 8.4, c: 1 } },
    { id: "r5", cells: { a: 5, b: 9.8, c: 2 } },
  ],
};

const plotWith = (corr: Plot["corrmatrix"]): Plot =>
  ({
    id: "p", name: "Corr", source: "t", kind: "corrmatrix", status: "ok", styleOverrides: {},
    ...(corr ? { corrmatrix: corr } : {}),
  }) as Plot;

const SIZE = { width: 520, height: 600 }; // taller than wide, so the width is what limits the grid

/** Every drawn glyph: where it starts and how big its arc is, split into cells vs the key. */
function glyphs(corr: Plot["corrmatrix"], size = SIZE): { cells: number[]; key: number[]; ds: string[] } {
  const scene = buildPlotScene(table, plotWith(corr), size);
  const cm = scene.corrmatrix!;
  const cxs = cm.cells.map((c) => c.labelX);
  const cell = cxs.length > 1 ? (Math.max(...cxs) - Math.min(...cxs)) / 2 : 0; // 3 columns → 2 gaps
  const gridRight = Math.max(...cxs) + cell / 2; // the key is the only thing drawn past this
  const { container } = render(<PlotFigure scene={scene} zoom={1} onSelect={() => {}} />);
  const cells: number[] = [];
  const key: number[] = [];
  const ds: string[] = [];
  for (const p of container.querySelectorAll("path")) {
    const d = p.getAttribute("d") ?? "";
    ds.push(d);
    const m = /^M\s*(-?[\d.]+)[\s,]+(-?[\d.]+)\s*A\s*(-?[\d.]+)/.exec(d.trim());
    if (!m) continue;
    (Number(m[1]) > gridRight ? key : cells).push(Number(m[3]));
  }
  cleanup();
  return { cells, key, ds };
}

const maxOf = (xs: number[]): number => (xs.length ? Math.max(...xs) : 0);

describe("correlation matrix — symbol size", () => {
  it("the fixture actually draws both a cell glyph and a key glyph", () => {
    // Rule zero: a fixture that cannot exhibit the behaviour cannot measure it.
    const g = glyphs(undefined);
    expect(g.cells.length, "no cell glyphs in the drawing — the tests below would be vacuous").toBeGreaterThan(0);
    expect(g.key.length, "no key glyphs in the drawing — the tests below would be vacuous").toBeGreaterThan(0);
  });

  it("the cell glyphs grow with glyphScale, and 1× is byte-identical to no setting at all", () => {
    expect(glyphs({ glyphScale: 1 }).ds, "1× must draw exactly what no setting draws").toEqual(
      glyphs(undefined).ds,
    );
    // A range, not one perturbation off the default: undefined → 0.8 also passes when the number
    // is read once and then ignored.
    const small = maxOf(glyphs({ glyphScale: 0.4 }).cells);
    const mid = maxOf(glyphs({ glyphScale: 0.8 }).cells);
    const large = maxOf(glyphs({ glyphScale: 1.2 }).cells);
    expect(small, "0.4× is not smaller than 0.8× — the cell glyph ignores its size").toBeLessThan(mid);
    expect(mid, "0.8× is not smaller than 1.2× — the cell glyph ignores its size").toBeLessThan(large);
  });

  it("the key's symbols grow with legendGlyphScale — no fixed cap holds them down", () => {
    const one = maxOf(glyphs({ legendGlyphScale: 1 }).key);
    expect(maxOf(glyphs(undefined).key), "no setting must draw exactly what 1× draws").toBe(one);
    expect(maxOf(glyphs({ legendGlyphScale: 0.5 }).key), "0.5× did not shrink the key symbols").toBeLessThan(one);
    expect(maxOf(glyphs({ legendGlyphScale: 2 }).key), "2× did not grow the key symbols — a fixed cap holds them down").toBeGreaterThan(one);
  });

  it("a bigger key symbol takes a wider strip — the matrix gives up the room", () => {
    // What the reservation is for: without it the key grows to the right, off the canvas.
    const gridWidth = (scale: number): number => {
      const cm = buildPlotScene(table, plotWith({ legendGlyphScale: scale }), SIZE).corrmatrix!;
      const xs = cm.cells.map((c) => c.labelX);
      return Math.max(...xs) - Math.min(...xs);
    };
    expect(gridWidth(2), "the matrix did not give up any width — the key will run off the figure").toBeLessThan(gridWidth(1));

    // …and the proof that it was enough: the key's own labels stay on the canvas.
    const cm = buildPlotScene(table, plotWith({ legendGlyphScale: 2 }), SIZE).corrmatrix!;
    const rightmost = Math.max(...(cm.scaleLegend?.items ?? []).map((i) => i.labelX));
    expect(rightmost, "the key's labels ran off the right edge at 2×").toBeLessThan(SIZE.width);
  });
});
