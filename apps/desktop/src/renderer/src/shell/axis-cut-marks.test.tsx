// @vitest-environment jsdom
/**
 * A hand-set axis range that cuts the data must cut the drawing at the axis.
 *
 * The data layer's clip is padded past the plot rect by about a marker width so a dot sitting
 * on an axis is drawn whole. A box, a whisker, a bar or an error bar cut by the range is clipped
 * at the axis line instead, so it never reaches over the category names.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { buildPlotScene } from "@mady/graphics";
import type { DataTable, Plot, PlotKind } from "@mady/core";
import { PlotFigure } from "./PlotFigure";

afterEach(cleanup);

// Two clinics' waiting times (minutes); both groups reach down to 1–3, well below a minimum of 7.
const north = [11, 28, 12, 30, 18, 12, 14, 1, 8, 7, 3, 26, 70, 1, 60, 2, 3, 13, 26, 1, 5];
const south = [20, 50, 20, 93, 4, 96, 25, 22, 61, 3, 83, 126, 17, 27, 49, 12, 32, 4, 9, 30, 16];
const table: DataTable = {
  id: "t", kind: "column", name: "Waiting",
  columns: [{ id: "n", name: "North clinic (min)", role: "y" }, { id: "s", name: "South clinic (min)", role: "y" }],
  rows: north.map((v, i) => ({ id: `r${i}`, cells: { n: v, s: south[i]! } })),
};

const num = (el: Element, a: string): number => Number(el.getAttribute(a) ?? NaN);

/** Rects and lines in the clipped data layer, by how far they reach below the plot (px). */
function spillBelow(kind: PlotKind, extra: Partial<Plot> & { dotsOnAxis?: boolean } = {}): { el: string; over: number }[] {
  const plot = { id: "p", name: "P", source: "t", status: "ok", styleOverrides: {}, kind, yAxis: { min: 7 }, ...extra } as Plot;
  const scene = buildPlotScene(table, plot, { width: 600, height: 420 });
  const bottom = scene.plot.y + scene.plot.height;
  const { container } = render(<PlotFigure scene={scene} />);
  const layer = container.querySelector("g[clip-path]");
  if (!layer) throw new Error("no clipped data layer");
  // What is visible is the drawn extent cut at the nearest clip (on the element or an ancestor).
  const clipBottom = (el: Element): number => {
    for (let e: Element | null = el; e; e = e.parentElement) {
      const ref = e.getAttribute("clip-path")?.match(/url\(#(.+)\)/)?.[1];
      if (!ref) continue;
      const r = [...container.querySelectorAll("clipPath")].find((c) => c.id === ref)?.querySelector("rect");
      if (r) return num(r, "y") + num(r, "height");
    }
    return Infinity;
  };
  const out: { el: string; over: number }[] = [];
  for (const el of layer.querySelectorAll("rect, line")) {
    if (el.closest("[transform]") && el.closest("[transform]") !== layer) continue; // positions not in plot pixels
    if (el.closest("clipPath")) continue;
    const drawn = el.tagName === "rect" ? num(el, "y") + num(el, "height") : Math.max(num(el, "y1"), num(el, "y2"));
    // Up to 1 px past the plot edge lies under the axis line itself.
    const y = Math.min(drawn, clipBottom(el));
    if (Number.isFinite(y) && y > bottom + 1.01) out.push({ el: el.outerHTML.slice(0, 160), over: Math.round((y - bottom) * 10) / 10 });
  }
  return extra.dotsOnAxis ? dotsCut(container, layer) : out;
}

/** Dots whose nearest clip cuts into them — a dot on the axis must be drawn whole. */
function dotsCut(container: HTMLElement, layer: Element): { el: string; over: number }[] {
  const out: { el: string; over: number }[] = [];
  for (const c of layer.querySelectorAll("circle")) {
    if (c.getAttribute("fill") === "transparent") continue; // hit areas
    let bottom = Infinity;
    for (let e: Element | null = c; e; e = e.parentElement) {
      const ref = e.getAttribute("clip-path")?.match(/url\(#(.+)\)/)?.[1];
      const r = ref ? [...container.querySelectorAll("clipPath")].find((x) => x.id === ref)?.querySelector("rect") : null;
      if (r) { bottom = num(r, "y") + num(r, "height"); break; }
    }
    const edge = num(c, "cy") + num(c, "r");
    if (edge > bottom + 0.01) out.push({ el: c.outerHTML.slice(0, 160), over: Math.round((edge - bottom) * 10) / 10 });
  }
  return out;
}

describe("data cut by a hand-set axis minimum is drawn up to the axis, not past it", () => {
  for (const kind of ["box", "bar", "scatter", "violin"] as PlotKind[]) {
    it(kind, () => {
      expect(spillBelow(kind)).toEqual([]);
    });
  }
  // The other side of the same rule: the dots keep the wider clip, so a dot lying on the axis stays whole.
  for (const kind of ["scatter", "bar"] as PlotKind[]) {
    it(`${kind}: a dot on the axis is drawn whole`, () => {
      expect(spillBelow(kind, { yAxis: { min: 1 }, dotsOnAxis: true } as Partial<Plot>)).toEqual([]);
    });
  }
});
