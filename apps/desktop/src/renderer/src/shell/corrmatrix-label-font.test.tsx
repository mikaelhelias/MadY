// @vitest-environment jsdom
/**
 * The correlation matrix's "Label font" styles its variable names — every field, not only the size.
 *
 * The builder resolves `corrmatrix.labelFont` into the scene. Guards against the renderer ignoring it — drawing the
 * names with the chart-wide tick font and taking only the size from the matrix's own setting — which would make the
 * label font's Bold, Colour, Family and Italic controls that change nothing, while the settings that
 * really style the names - the tick font's - have no control on this chart at all.
 *
 * Resolved field by field, the way the per-axis fonts work: the matrix's own label font over the tick font. Both
 * directions are checked, because a plain swap passes the first check and breaks saved graphs: a graph that set only
 * the label size must keep the family / bold it inherits from the tick font (a style preset writes one).
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import type { FontSpec, Plot } from "@mady/core";
import { buildPlotScene } from "@mady/graphics";
import { PlotFigure } from "./PlotFigure";
import { galleryItems } from "./gallery";

afterEach(cleanup);
const SIZE = { width: 620, height: 460 };
const item = (galleryItems() as unknown as { key: string; table: never; plot: Plot }[]).find((i) => i.plot.kind === "corrmatrix")!;
const NAMES = new Set(["Study hrs", "Test score", "Absences", "Sleep hrs", "Stress"]);

/** The variable-name labels' resolved font attributes (own, or inherited from the nearest ancestor). */
function names(plot: Plot): { weight: string | null; family: string | null; style: string | null; fill: string | null; size: string | null }[] {
  const { container } = render(<PlotFigure scene={buildPlotScene(item.table, plot, SIZE)} />);
  const attr = (el: Element, a: string): string | null => {
    for (let e: Element | null = el; e && e.tagName.toLowerCase() !== "svg"; e = e.parentElement) {
      const v = e.getAttribute(a);
      if (v != null) return v;
    }
    return null;
  };
  const out = [...container.querySelectorAll("text")].filter((t) => NAMES.has((t.textContent ?? "").trim())).map((t) => ({
    weight: attr(t, "font-weight"), family: attr(t, "font-family"), style: attr(t, "font-style"), fill: attr(t, "fill"), size: attr(t, "font-size"),
  }));
  cleanup();
  return out;
}
const withLabelFont = (f: FontSpec, tick?: FontSpec): Plot =>
  ({ ...item.plot, corrmatrix: { ...item.plot.corrmatrix, labelFont: f }, ...(tick ? { fonts: { ...item.plot.fonts, tick } } : {}) }) as Plot;
const one = <T,>(xs: T[]): T[] => [...new Set(xs)];

describe("the correlation matrix's label font reaches the variable names", () => {
  it("the fixture draws the names, so a font that fails to reach them shows here", () => {
    expect(names(item.plot).length).toBeGreaterThanOrEqual(NAMES.size);
  });

  it("Bold", () => expect(one(names(withLabelFont({ bold: true })).map((n) => n.weight))).toEqual(["700"]));
  it("Italic", () => expect(one(names(withLabelFont({ italic: true })).map((n) => n.style))).toEqual(["italic"]));
  it("Family", () => expect(one(names(withLabelFont({ family: "Courier New" })).map((n) => n.family))).toEqual(["Courier New"]));
  it("Colour", () => expect(one(names(withLabelFont({ color: "#ff0088" })).map((n) => n.fill))).toEqual(["#ff0088"]));
  it("Size", () => expect(one(names(withLabelFont({ size: 17 })).map((n) => n.size))).toEqual(["17"]));

  it("setting only the size keeps the family and bold the names inherit from the tick font (the other direction)", () => {
    const n = names(withLabelFont({ size: 14 }, { family: "Georgia", bold: true }));
    expect(one(n.map((x) => x.family))).toEqual(["Georgia"]);
    expect(one(n.map((x) => x.weight))).toEqual(["700"]);
    expect(one(n.map((x) => x.size))).toEqual(["14"]);
  });

  it("an untouched matrix draws its names in the tick font", () => {
    const n = names(item.plot);
    const tick = buildPlotScene(item.table, item.plot, SIZE).fonts.tick;
    expect(one(n.map((x) => x.weight))).toEqual([String(tick.weight)]);
    expect(one(n.map((x) => x.family))).toEqual([tick.family]);
  });
});
