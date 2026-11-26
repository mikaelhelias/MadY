// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { createSampleDocument } from "@mady/core";
import { buildPlotScene } from "@mady/graphics";
import { measureText } from "./textMeasure";

/**
 * The real sample GDP treemap at the house label size. At a label base of 26 the biggest
 * cell's glyph block can collide with the region-heading ring, and the de-confliction pass
 * must not drop the most prominent label in the figure; a square-box approximation in the
 * heading pass would also delete rotated headings outright. The gallery fixture in buildScene.test.ts is too small to
 * exhibit either — only the sample's real labels and grouping reproduce them, which is
 * why this guard builds the sample document.
 */
describe("sample GDP treemap — the labels that matter survive the house label size", () => {
  const scene = () => {
    const proj = createSampleDocument().toJSON();
    const plot = proj.plots.find((p) => p.name === "GDP treemap")!;
    const table = proj.tables.find((t) => t.id === plot.source)!;
    return buildPlotScene(table, { ...plot, showTitle: false }, { measure: measureText, width: 580, height: 380 });
  };

  it("the largest cell keeps its name and value", () => {
    const cells = scene().treemap!.cells;
    const areaOf = (c: (typeof cells)[number]): number => {
      let a = 0;
      for (let i = 0, j = c.points.length - 1; i < c.points.length; j = i++)
        a += (c.points[j]!.x + c.points[i]!.x) * (c.points[j]!.y - c.points[i]!.y);
      return Math.abs(a / 2);
    };
    const biggest = [...cells].sort((a, b) => areaOf(b) - areaOf(a))[0]!;
    expect(biggest.label, "the biggest cell must carry its name").not.toBe("");
    expect(biggest.valueLabel, "…and its value").not.toBe("");
  });

  it("every region heading survives", () => {
    const heads = scene().treemap!.groupLabels ?? [];
    expect(heads.length).toBe(4);
    expect(
      heads.filter((g) => g.text === "").length,
      `dropped headings: ${JSON.stringify(heads.map((g) => g.text))}`,
    ).toBe(0);
  });

  it("draws the largest disc the requested box allows, keeping the box size and the legend", () => {
    // The treemap is as large as it can be within the existing card size, and nothing else
    // changes. Shrinking the scene to hug the disc would make the card smaller, and switching
    // the legend off would drop content, so the disc grows only inside the box. What grows the disc inside the
    // same box: the heading ring is sized from its placement math, and the side/bottom margins
    // are 10px rather than the general 18px chart margins.
    const s = scene();
    expect(s.width, "the scene box belongs to the layout — never shrunk").toBe(580);
    expect(s.height).toBe(380);
    expect(s.legend.length, "the legend stays").toBeGreaterThanOrEqual(4);
    const ys = s.treemap!.cells.flatMap((c) => c.points.map((p) => p.y));
    const disc = Math.max(...ys) - Math.min(...ys);
    expect(disc / Math.min(s.width, s.height), `disc ${Math.round(disc)} in ${Math.round(s.width)}×${Math.round(s.height)}`).toBeGreaterThan(0.75);
  });
});
