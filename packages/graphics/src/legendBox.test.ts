// The legend box width — one formula for the box the renderer draws and for what must clear it.
import { describe, expect, it } from "vitest";
import { legendBoxWidth, legendLabelText, wrapLegendLabel } from "./legendBox.js";

describe("legendBoxWidth", () => {
  it("is the symbol column + the widest label at 0.6 of the font per character + padding on both sides", () => {
    expect(legendBoxWidth({ swatchWidth: 30, padding: 5 }, ["ab", "abcd"], 10)).toBeCloseTo(30 + 4 * 10 * 0.6 + 2 * 5);
  });

  it("grows with the symbol column — a big legend marker widens the box", () => {
    expect(legendBoxWidth({ swatchWidth: 40 }, ["abc"], 10)).toBeGreaterThan(legendBoxWidth({ swatchWidth: 18 }, ["abc"], 10));
  });

  it("uses the renderer's own constants when the layout sets none (18px column, 6px padding)", () => {
    expect(legendBoxWidth({}, ["abc"], 10)).toBeCloseTo(18 + 3 * 10 * 0.6 + 12);
  });

  it("is just the symbol column and padding when there are no labels", () => {
    expect(legendBoxWidth({ swatchWidth: 20 }, [], 12)).toBe(20 + 12);
  });
});

const m = (t: string): number => t.length * 10; // 10 px a character

describe("wrapLegendLabel", () => {
  it("keeps a label that fits on one line", () => {
    expect(wrapLegendLabel("Cases", 100, m)).toEqual(["Cases"]);
  });
  it("breaks a long label at its spaces, every line within the room", () => {
    const lines = wrapLegendLabel("Biomarker (AUC 0.860, 95% CI 0.790–0.930)", 120, m);
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.join(" ")).toBe("Biomarker (AUC 0.860, 95% CI 0.790–0.930)");
    for (const l of lines) expect(m(l)).toBeLessThanOrEqual(120);
  });
  it("never cuts a word longer than the room", () => {
    expect(wrapLegendLabel("Supercalifragilistic word", 50, m)).toEqual(["Supercalifragilistic", "word"]);
  });
  it("never splits a value from its sign", () => {
    const lines = wrapLegendLabel("Markers (λ = 2.938)", 80, m);
    expect(lines).toEqual(["Markers", "(λ = 2.938)"]);
  });
  it("keeps a line break the user typed", () => {
    expect(wrapLegendLabel("A\nB", 500, m)).toEqual(["A", "B"]);
  });
});

describe("legendBoxWidth with wrapped labels", () => {
  it("is as wide as the widest line, not the whole label", () => {
    const one = legendBoxWidth({}, ["Biomarker (AUC 0.860)"], 10);
    const two = legendBoxWidth({}, [legendLabelText({ label: "Biomarker (AUC 0.860)", lines: ["Biomarker", "(AUC 0.860)"] })], 10);
    expect(two).toBeLessThan(one);
    expect(two).toBe(legendBoxWidth({}, ["(AUC 0.860)"], 10));
  });
});
