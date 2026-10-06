// @vitest-environment jsdom
/**
 * The five extra gallery cards (`ADDED_CARD_KEYS`). Each card exists to show a combination
 * its kind's plain card does not, so each guard reads the combination back off the drawing
 * (the built scene), not off the config: a card whose option is accepted but never reaches
 * the picture would show nothing of what it is there to show.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { buildPlotScene } from "@mady/graphics";
import { PlotFigure } from "./PlotFigure";
import type { DataTable, Plot } from "@mady/core";
import { galleryItems } from "./gallery";
import { ADDED_CARD_KEYS } from "./showcase";

afterEach(() => cleanup());
const SIZE = { width: 640, height: 460 };
const card = (key: string) => {
  const c = galleryItems().find((g) => g.key === key);
  expect(c, `no gallery card keyed '${key}'`).toBeDefined();
  return c!;
};
const scene = (key: string) => buildPlotScene(card(key).table as DataTable, card(key).plot as Plot, SIZE);

describe("the five added cards, as drawn", () => {
  it("every added card is filed under a family, draws from its own datasheet, and warns of nothing", () => {
    for (const key of ADDED_CARD_KEYS) {
      const c = card(key);
      expect(c.family, `${key} is not filed under a family (sinks to the end, invisible)`).toBeDefined();
      expect(c.plot.source).toBe(c.table.id);
      expect(scene(key).warnings, `${key} warns`).toEqual([]);
    }
  });

  it("'Ranked dots vs a reference': dots not bars, sorted, every dot labelled, coloured by side of the dashed line", () => {
    const s = scene("rankeddots");
    const marks = s.series[0]!.marks;
    expect(marks.length).toBe(25);
    expect(marks.every((m) => m.bar === undefined), "the series still draws bars").toBe(true);
    expect(marks.every((m) => (m.pointLabel ?? "") !== ""), "a dot without its value").toBe(true);
    const fills = new Set(marks.map((m) => m.fill));
    expect(fills.size, "the two sides of the reference are not two colours").toBe(2);
    // The reference is a "line" in the scene: on horizontal bars the value line stands upright.
    expect(s.annotations.some((a) => a.kind === "line" && a.x1 === a.x2), "the dashed reference line is not on the drawing").toBe(true);
    expect(s.annotations.some((a) => a.kind === "text" && (a.label ?? "").includes("78")), "the reference is not named").toBe(true);
    // Also checked on the rendered drawing, not just in the scene: the scene can carry both the
    // labels and the two colours while the category-kind branch of the renderer draws neither,
    // leaving one blue dot after another with no values.
    const { container } = render(<PlotFigure scene={s} />);
    const texts = [...container.querySelectorAll("text")].map((t) => (t.textContent ?? "").trim());
    expect(texts, "the top value is not written on the drawing").toContain("95");
    expect(texts, "the bottom value is not written on the drawing").toContain("47");
    // The dots are two-tone markers, so what reaches the SVG is each side's derived outline and
    // tint, not the literal override: two distinct outlines among the dots, neither the series'.
    const strokes = new Set([...container.querySelectorAll("circle")].map((c) => c.getAttribute("stroke")).filter((x): x is string => !!x && x !== "none"));
    strokes.delete(s.series[0]!.symbolOutline ?? "");
    expect(strokes.size, `the dots are not two colours on the drawing: ${[...strokes].join(", ")}`).toBeGreaterThanOrEqual(2);
  });

  it("'Stream graph + event markers': six centred areas and four labelled event lines", () => {
    const s = scene("stream");
    expect(card("stream").plot.areaStack).toBe("stream");
    expect(s.series.length).toBe(6);
    for (const ser of s.series) expect(ser.areaPath ?? "", `${ser.name} has no filled area`).not.toBe("");
    const events = s.annotations.filter((a) => a.kind === "line" && a.x1 === a.x2);
    expect(events.map((a) => a.label)).toEqual(["Travel", "Diet change", "Disease onset", "Treatment"]);
  });

  it("'Stacked bars + line (2nd axis)': stacked bars, one line series, a real right-hand axis", () => {
    const s = scene("stackline");
    expect(card("stackline").plot.barLayout).toBe("stacked");
    expect(s.y2, "no second value axis").toBeDefined();
    const lines = s.series.filter((x) => x.overlayLine);
    expect(lines).toHaveLength(1);
    expect(lines[0]!.marks.every((m) => m.bar === undefined)).toBe(true);
    expect(s.series.filter((x) => x.marks.some((m) => m.bar)).length).toBe(3);
  });

  it("'Time course + bands, window, limit': SD bands on both series, the shaded window and the dashed limit", () => {
    const s = scene("timecourse");
    expect(s.series.length).toBe(2);
    for (const ser of s.series) expect(ser.bandPath ?? "", `${ser.name} has no error band`).not.toBe("");
    expect(s.annotations.some((a) => a.kind === "band" && a.label === "Treatment"), "the treatment window is not drawn").toBe(true);
    expect(s.annotations.some((a) => a.kind === "line" && a.y1 === a.y2 && a.label === "LOD"), "the detection limit is not drawn").toBe(true);
  });

  it("'Bubble-grid heatmap': every cell is a disc whose radius follows its value", () => {
    const s = scene("bubblegrid");
    expect(card("bubblegrid").plot.heatmap?.cellShape).toBe("bubble");
    const cells = s.heatmap!.cells;
    expect(cells.length).toBe(60);
    expect(cells.every((c) => (c.r ?? 0) > 0), "a cell drawn as a tile, not a disc").toBe(true);
    expect(new Set(cells.map((c) => c.r)).size, "every disc the same size — the radius does not follow the value").toBeGreaterThan(10);
  });
});
