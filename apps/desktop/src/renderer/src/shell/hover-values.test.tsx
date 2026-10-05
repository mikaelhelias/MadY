// @vitest-environment jsdom
/**
 * Every chart type shows values on hover in the interactive HTML export.
 *
 * The exported page turns each element's `data-mady-tip` (or `<title>`) into a tooltip. A mark without
 * one shows nothing on hover (e.g. a scatter point or a bar), while the export dialog promises
 * "hover for values".
 *
 * For every gallery card this asks, of the drawing the export serializes:
 *   1. some data mark carries hover text (legend rows, drag hints and the in-app hover box excluded);
 *   2. that text carries a value (a digit) — a name alone is not a value;
 *   3. the mouse can reach it: the element, or something inside it, takes pointer events —
 *      a tip on a group whose every child ignores the mouse can never be hovered;
 *   4. on a chart drawn from series marks, every mark has one.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { buildPlotScene } from "@mady/graphics";
import { PlotFigure } from "./PlotFigure";
import { galleryItems, optionDrawables } from "./gallery";

afterEach(cleanup);

const DRAG_HINT = /drag|double-click|click to/i;

/** The hover texts a reader can reach, keyed by element. */
function tips(container: HTMLElement): { el: Element; text: string }[] {
  const out: { el: Element; text: string }[] = [];
  const svg = container.querySelector("svg.gfx-figure");
  if (!svg) return out;
  const usable = (el: Element): boolean => !el.closest("[data-mady-legend], .gfx-tooltip, .gfx-draghit, .gfx-annhandle");
  const reachable = (el: Element): boolean => {
    const self = el.getAttribute("pointer-events");
    if (self !== "none") return true;
    return [...el.querySelectorAll("*")].some((c) => c.getAttribute("pointer-events") !== "none");
  };
  for (const el of svg.querySelectorAll("[data-mady-tip]")) {
    if (usable(el) && reachable(el)) out.push({ el, text: el.getAttribute("data-mady-tip") ?? "" });
  }
  for (const t of svg.querySelectorAll("title")) {
    const el = t.parentElement;
    if (!el || !usable(el) || DRAG_HINT.test(t.textContent ?? "") || !reachable(el)) continue;
    out.push({ el, text: t.textContent ?? "" });
  }
  return out;
}

const seen = new Set<string>();
const cards = [
  ...galleryItems().filter((g) => {
    const k = g.plot.kind ?? "xy";
    if (seen.has(k) || k === "image") return false;
    seen.add(k);
    return true;
  }).map((g) => ({ ...g, label: g.plot.kind ?? "xy" })),
  // What only an option draws (the waffle's cells, a split heatmap) — no gallery card shows it.
  ...optionDrawables().map((d) => ({ ...d, label: `${d.plot.kind} — ${d.title}` })),
];

describe("every chart type shows values on hover (interactive HTML export)", () => {
  it("the sweep reaches the chart types (it cannot pass by checking nothing)", () => {
    expect(cards.length).toBeGreaterThan(40);
  });

  for (const g of cards) {
    const kind = g.label;
    it(`${kind}: data marks carry a reachable hover value`, () => {
      const scene = buildPlotScene(g.table, g.plot, { width: 580, height: 380 });
      const { container } = render(<PlotFigure scene={scene} />);
      const found = tips(container);
      expect(found.length, `${kind}: no data mark carries hover text`).toBeGreaterThan(0);
      const withValue = found.filter((f) => /\d/.test(f.text));
      expect(withValue.length, `${kind}: hover text carries no value — e.g. "${found[0]?.text}"`).toBeGreaterThan(0);
      const marks = scene.series.reduce((a, s) => a + s.marks.length, 0);
      if (marks > 0) {
        const tipped = new Set(found.map((f) => f.el));
        expect(tipped.size, `${kind}: ${marks} series marks, only ${tipped.size} carry hover text`).toBeGreaterThanOrEqual(marks);
      }
    });
  }
});
