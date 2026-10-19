// @vitest-environment jsdom
/**
 * The fit-parameter block is drawn at the steps `fitBlockSteps` gives: a line with a subscript leaves room below it and a
 * line with a superscript room above it, so "EC₅₀" over "R²" does not put one run on the other. A plain block keeps the
 * 1.2 em step. Checked on the drawing, in both forms of the block (lines moved together, and each line its own text).
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import type { DataTable, Plot, PlotFit } from "@mady/core";
import { buildPlotScene, FIT_LINE_EM, SCRIPT_CLEARANCE_EM } from "@mady/graphics";
import { PlotFigure } from "./PlotFigure";

afterEach(cleanup);

const table = {
  id: "t", kind: "xy", name: "t",
  columns: [{ id: "x", name: "x", role: "x" }, { id: "y", name: "y", role: "y" }],
  rows: [1, 2, 3, 4, 5].map((v, i) => ({ id: `r${i}`, cells: { x: v, y: v * 2 } })),
} as unknown as DataTable;
const draw = (params: string[], together: boolean) => {
  const fit: PlotFit = { label: "f", points: [[1, 2], [5, 10]], params, paramKeys: params.map((_, i) => `k${i}`) };
  const plot = { id: "p", name: "p", source: "t", status: "ok", styleOverrides: {}, kind: "xy", fit, fitParams: { together } } as unknown as Plot;
  const scene = buildPlotScene(table, plot, { width: 600, height: 400 });
  const { container } = render(<PlotFigure scene={scene} />);
  return { scene, texts: [...container.querySelectorAll("g.gfx-fit-texts text")] };
};
const lines = ["EC_{50} = 1", "R² = 0.99", "Top = 2"];
const size = (s: ReturnType<typeof draw>["scene"]) => s.fit!.params!.size;

describe("the fit block's line steps", () => {
  it("together: each line's tspan steps by what the line above and itself need", () => {
    const { scene, texts } = draw(lines, true);
    expect(texts).toHaveLength(1);
    const dy = [...texts[0]!.querySelectorAll("tspan[dy]")].slice(1).map((t) => parseFloat(t.getAttribute("dy")!));
    // line 2 follows a subscript and is a superscript line; line 3 follows a superscript line and carries neither.
    expect(dy).toHaveLength(2);
    expect(dy[0]).toBeCloseTo(FIT_LINE_EM + 2 * SCRIPT_CLEARANCE_EM, 3);
    expect(dy[1]).toBeCloseTo(FIT_LINE_EM, 3);
    expect(size(scene)).toBeGreaterThan(0);
  });

  it("each line its own text: the lines are placed at the same steps", () => {
    const { scene, texts } = draw(lines, false);
    expect(texts).toHaveLength(3);
    const ys = texts.map((t) => Number(t.getAttribute("y")));
    const s = size(scene);
    expect((ys[1]! - ys[0]!) / s).toBeCloseTo(FIT_LINE_EM + 2 * SCRIPT_CLEARANCE_EM, 6);
    expect((ys[2]! - ys[1]!) / s).toBeCloseTo(FIT_LINE_EM, 6);
  });

  it("plain lines keep the 1.2 em step in both forms", () => {
    const plain = ["Top = 1", "Bottom = 2", "Slope = 3"];
    const a = draw(plain, false);
    const ys = a.texts.map((t) => Number(t.getAttribute("y")));
    expect((ys[1]! - ys[0]!) / size(a.scene)).toBeCloseTo(1.2, 6);
    cleanup();
    const b = draw(plain, true);
    expect([...b.texts[0]!.querySelectorAll("tspan[dy]")].slice(1).map((t) => t.getAttribute("dy"))).toEqual(["1.2em", "1.2em"]);
  });
});
