// @vitest-environment jsdom
/**
 * A fit's parameter block and its potency label do not sit inside the plot area's clip.
 * Drawn inside `<g clipPath>`, the block would be cut after 2½ lines when dragged below the
 * X axis and vanish when dragged past the right axis — so a busy graph could not have its
 * numbers moved outside. The curve, band and crosshair stay clipped; only the text leaves.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { buildPlotScene } from "@mady/graphics";
import type { DataTable, Plot, PlotFit } from "@mady/core";
import { PlotFigure } from "./PlotFigure";

afterEach(cleanup);

const table: DataTable = {
  id: "t", kind: "xy", name: "T",
  columns: [{ id: "x", name: "Dose", role: "x" }, { id: "a", name: "A", role: "y" }, { id: "b", name: "B", role: "y" }],
  rows: [[0.1, 5, 6], [1, 20, 12], [10, 80, 40], [100, 95, 85]].map((r, i) => ({ id: `r${i}`, cells: { x: r[0]!, a: r[1]!, b: r[2]! } })),
};
const fit = (ec50: number): PlotFit => ({
  label: "4PL", points: [[0.1, 5], [1, 20], [10, 80], [100, 95]],
  params: [`Top = 9${ec50}`, "Hill = 1.1"], marker: { x: ec50, y: 50, label: `EC50 = ${ec50} µM` },
});
// Offsets that throw both texts well outside the plot rect (below the X axis, past the right edge).
const OUT = { dx: 400, dy: 300 };

const clippedAncestor = (el: Element): Element | null => {
  for (let p = el.parentElement; p; p = p.parentElement) if (p.hasAttribute("clip-path")) return p;
  return null;
};
const textEl = (c: HTMLElement, needle: string) =>
  [...c.querySelectorAll("text")].find((t) => (t.textContent ?? "").includes(needle));

describe("fit texts dragged outside the plot are not cut by the plot's clip", () => {
  it("single fit: parameter block and potency label", () => {
    const plot: Plot = {
      id: "p", name: "P", source: "t", status: "ok", styleOverrides: {}, kind: "xy", xAxis: { scale: "log10" },
      fit: fit(2), fitParams: { offset: OUT }, fitLabelOffset: OUT,
    };
    const { container } = render(<PlotFigure scene={buildPlotScene(table, plot, { width: 720, height: 500 })} />);
    const block = textEl(container, "Hill = 1.1");
    const label = textEl(container, "EC50 = 2 µM");
    expect(block, "the block is drawn").toBeTruthy();
    expect(label, "the label is drawn").toBeTruthy();
    expect(clippedAncestor(block!), "parameter block inside a clip").toBeNull();
    expect(clippedAncestor(label!), "potency label inside a clip").toBeNull();
    // The curve itself stays clipped — it must never spill over the axes.
    const curve = container.querySelector(".gfx-fit path");
    expect(curve, "the fitted curve is drawn").toBeTruthy();
    expect(clippedAncestor(curve!), "fitted curve stays clipped").not.toBeNull();
  });

  it("per-series fits: every block and label", () => {
    const plot: Plot = {
      id: "p", name: "P", source: "t", status: "ok", styleOverrides: {}, kind: "xy", xAxis: { scale: "log10" },
      fits: [fit(2), fit(30)], fitsOffsets: { "0": { label: OUT, params: OUT }, "1": { label: OUT, params: OUT } },
    };
    const { container } = render(<PlotFigure scene={buildPlotScene(table, plot, { width: 720, height: 500 })} />);
    const texts = [...container.querySelectorAll("text")].filter((t) => /Hill = 1\.1|EC50 = (2|30) µM/.test(t.textContent ?? ""));
    expect(texts.length, "two blocks + two labels drawn").toBeGreaterThanOrEqual(4);
    for (const t of texts) expect(clippedAncestor(t), `"${t.textContent}" inside a clip`).toBeNull();
  });
});
