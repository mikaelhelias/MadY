import { describe, expect, it } from "vitest";
import { figureLegendFont, figureLegendLayout, figureLegendScale } from "./figureLegend";

describe("figureLegendFont — the figure's own font over the panels'", () => {
  const panel = { size: 12, family: "Helvetica" };
  it("is the panels' legend font until the figure sets its own", () => {
    expect(figureLegendFont(panel, undefined)).toEqual({ size: 12, family: "Helvetica" });
  });
  it("each field the figure sets wins; the rest stay the panels'", () => {
    expect(figureLegendFont(panel, { size: 18 })).toEqual({ size: 18, family: "Helvetica" });
    expect(figureLegendFont(panel, { family: "Georgia", bold: true, italic: true, color: "#333333" })).toEqual({ size: 12, family: "Georgia", bold: true, italic: true, color: "#333333" });
  });
  it("a panel font with no family leaves the family out", () => {
    expect(figureLegendFont({ size: 12, family: null }, undefined)).toEqual({ size: 12 });
  });
});

describe("figureLegendScale", () => {
  it("is 1 when unset, and kept inside 0.5–2", () => {
    expect(figureLegendScale(undefined)).toBe(1);
    expect(figureLegendScale(Number.NaN)).toBe(1);
    expect(figureLegendScale(9)).toBe(2);
    expect(figureLegendScale(0.01)).toBe(0.5);
  });
});

describe("figureLegendLayout", () => {
  const labels = ["Compound A", "Compound B"];
  it("lays the keys in one row, each starting after the one before it", () => {
    const l = figureLegendLayout(labels, 12, 1, undefined);
    expect(l.starts[0]).toBe(l.pad);
    expect(l.starts[1]).toBeGreaterThan(l.starts[0]! + l.swatchW);
    expect(l.headH).toBe(0);
  });
  it("a heading takes a row of its own: the drawing grows by it", () => {
    const plain = figureLegendLayout(labels, 12, 1, undefined);
    const headed = figureLegendLayout(labels, 12, 1, "Treatment");
    expect(headed.headH).toBeGreaterThan(0);
    expect(headed.h).toBe(plain.h + headed.headH);
  });
  it("a heading wider than the keys widens the drawing; a short one costs nothing", () => {
    const plain = figureLegendLayout(labels, 12, 1, undefined);
    expect(figureLegendLayout(labels, 12, 1, "A heading that is much wider than the two keys together").w).toBeGreaterThan(plain.w);
    expect(figureLegendLayout(labels, 12, 1, "Dose").w).toBe(plain.w);
  });
  it("the key size scales the swatches and the gaps, and so the width", () => {
    const one = figureLegendLayout(labels, 12, 1, undefined);
    const two = figureLegendLayout(labels, 12, 2, undefined);
    expect(two.swatchW).toBe(one.swatchW * 2);
    expect(two.w).toBeGreaterThan(one.w);
  });
});
