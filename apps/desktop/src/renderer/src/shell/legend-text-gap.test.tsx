// @vitest-environment jsdom
/**
 * A legend label starts a fixed gap past its swatch, whatever the dot size.
 *
 * A label starts a fixed gap from the dot's edge, so the gap holds for any dot size. Guards
 * against a layout that reserves room for a smaller dot than it draws (the label then starts
 * inside the line swatch) and against a gap that grows with the dot.
 *
 * Read off the drawing: each legend row's line stub end and the x its words start, for every gallery
 * chart with a line-swatch legend, at three dot sizes. The gap must be positive and the same at every
 * size (it follows the legend font, never the dot).
 */
import { describe, expect, it } from "vitest";
import { render, cleanup } from "@testing-library/react";
import type { Plot } from "@mady/core";
import { buildPlotScene } from "@mady/graphics";
import { PlotFigure } from "./PlotFigure";
import { galleryItems } from "./gallery";
import { scenePaletteOpt } from "./scenePalette";

const measure = (t: string, px: number): number => t.length * px * 0.6;

/** The gap from the end of the first legend row's key — its line stub, or, in a legend with no lines,
 *  the right edge of the key column: every key is centred on one line there, so the labels start one fixed gap past the
 *  widest key (a swimmer's small dot beside its Response block) — to where its words start; null = no such row. */
function rowGap(plot: Plot, item: { table: Parameters<typeof buildPlotScene>[0] }): number | null {
  const scene = buildPlotScene(item.table, plot, { measure, width: 640, height: 460, ...scenePaletteOpt(plot) });
  const { container } = render(<PlotFigure scene={scene} selected={null} />);
  let gap: number | null = null;
  for (const row of container.querySelectorAll('.gfx-legend [data-mady-legend-row="1"]')) {
    const line = row.querySelector(":scope > line");
    const dot = row.querySelector(":scope > circle");
    const text = row.querySelector(":scope > text");
    if (!text || (!line && !dot)) continue;
    const keyRight = (r: Element): number => {
      const c = r.querySelector(":scope > circle");
      if (c) return Number(c.getAttribute("cx")) + Number(c.getAttribute("r"));
      const b = r.querySelector(":scope > .gfx-legbar");
      if (b?.tagName.toLowerCase() === "rect") return Number(b.getAttribute("x")) + Number(b.getAttribute("width"));
      return -Infinity;
    };
    const end = line ? Number(line.getAttribute("x2")) : Math.max(...[...container.querySelectorAll('.gfx-legend [data-mady-legend-row="1"]')].map(keyRight));
    gap = Number(text.getAttribute("x")) - end;
    break;
  }
  cleanup();
  return gap;
}

const withDots = (p: Plot, size: number): Plot => {
  const styles = { ...(p.seriesStyles ?? {}) };
  for (const k of Object.keys(styles)) styles[k] = { ...styles[k], symbolSize: size };
  return { ...p, seriesStyles: styles } as Plot;
};

describe("legend label gap", () => {
  it("is positive and the same at every dot size, on every gallery legend with a line swatch", { timeout: 60_000 }, () => {
    const bad: string[] = [];
    const seen = new Set<string>();
    for (const item of galleryItems()) {
      const gaps = [4, 8, 14].map((sz) => rowGap(withDots(item.plot, sz), item));
      if (gaps.some((g) => g === null)) continue;
      seen.add(item.plot.kind ?? "xy");
      const g = gaps as number[];
      if (g.some((x) => x <= 0) || Math.max(...g) - Math.min(...g) > 0.01)
        bad.push(`${item.plot.kind} "${item.plot.name}": gaps at dot 4/8/14 = ${g.map((x) => x.toFixed(1)).join(" / ")}`);
    }
    // The fixture reaches the triplot, PCA biplot, scree and XY legends.
    for (const k of ["triplot", "pcabiplot", "scree", "xy"]) expect(seen.has(k), k).toBe(true);
    expect(bad).toEqual([]);
  });
});
