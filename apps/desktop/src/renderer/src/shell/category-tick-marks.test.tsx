// @vitest-environment jsdom
/**
 * Lollipop / paired dot tick marks — guards the category-axis tick marks on both kinds.
 * These kinds draw their axes themselves, so the category axis can end up with 0 tick marks for its names (both
 * orientations) while only the value axis has marks, and the value axis can ignore Tick direction (in / both / none
 * all drawing "out"). Checked here per axis, per direction, against the labelled ticks.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import type { DataTable, Plot } from "@mady/core";
import { buildPlotScene } from "@mady/graphics";
import { PlotFigure } from "./PlotFigure";
import { galleryItems, galleryLookup } from "./gallery";

afterEach(cleanup);

const card = (title: string) => {
  const g = galleryItems().find((x) => x.title === title);
  if (!g) throw new Error(`no gallery card "${title}"`);
  return { table: g.table as DataTable, plot: g.plot as Plot, lk: galleryLookup(g) };
};

const CASES: Array<[string, string, Partial<Plot>]> = [
  ["lollipop, horizontal", "Lollipop / dumbbell", { barOrientation: "horizontal" }],
  ["lollipop, vertical", "Lollipop / dumbbell", { barOrientation: "vertical" }],
  ["paired dot", "Paired dot plot", {}],
];

describe.each(CASES)("%s", (_name, title, patch) => {
  const draw = (tickDir: "out" | "in" | "both" | "none") => {
    const c = card(title);
    const plot = { ...c.plot, ...patch, tickDir } as Plot;
    const scene = buildPlotScene(c.table, plot, { width: 640, height: 460, tables: c.lk });
    const { container } = render(<PlotFigure scene={scene} selected={null} />);
    return { scene, marks: (k: string) => [...container.querySelectorAll(`line[data-tick-mark="${k}"]`)] };
  };

  it("draws one mark per category and one per labelled value tick", () => {
    const { scene, marks } = draw("out");
    const rows = scene.lollipop?.rows.length ?? scene.paireddot?.rows.length ?? 0;
    expect(rows, "the card draws no rows").toBeGreaterThan(1);
    expect(marks("category").length).toBe(rows);
    const valueAxis = scene.lollipop ? (scene.lollipop.horizontal ? scene.x : scene.y) : scene.x;
    expect(marks("value").length).toBe(valueAxis.ticks.filter((t) => !t.minor && t.label).length);
  });

  it("honours Tick direction: none draws no marks; in / out / both point the right way", () => {
    expect(draw("none").marks("category").length).toBe(0);
    expect(draw("none").marks("value").length).toBe(0);
    const span = (dir: "out" | "in" | "both") => {
      const l = draw(dir).marks("category")[0]!;
      const n = (a: string) => Number(l.getAttribute(a));
      return { x: [n("x1"), n("x2")], y: [n("y1"), n("y2")] };
    };
    // Along whichever coordinate the mark runs, "in" and "out" point opposite ways from the axis, "both" spans the two.
    const out = span("out"), inn = span("in"), both = span("both");
    const run = out.x[0] !== out.x[1] ? "x" : "y";
    const len = (s: { x: number[]; y: number[] }) => Math.abs(s[run][1]! - s[run][0]!);
    expect(len(both)).toBeCloseTo(len(out) + len(inn), 5);
    const mid = (s: { x: number[]; y: number[] }) => (s[run][0]! + s[run][1]!) / 2;
    expect(Math.sign(mid(out) - mid(both))).toBe(-Math.sign(mid(inn) - mid(both)));
  });
});
