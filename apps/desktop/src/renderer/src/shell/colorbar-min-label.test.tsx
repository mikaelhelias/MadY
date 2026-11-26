// @vitest-environment jsdom
/**
 * The colour bar's minimum label must sit inside the figure. The bar's bottom is the plot's
 * bottom, a few px from the figure's edge, so a baseline exactly on the bar's bottom edge would
 * let the descenders hang below and be clipped off the canvas. The maximum label sits with its
 * baseline 0.4 × font inside the bar's top; the minimum sits 0.3 × font above the bottom.
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { DataTable, Plot } from "@mady/core";
import { buildPlotScene } from "@mady/graphics";
import { PlotFigure } from "./PlotFigure";

function matrixTable(rows: number, cols: number): DataTable {
  return {
    id: "t", kind: "grouped", name: "M",
    columns: [{ id: "g", name: "Gene", role: "x" }, ...Array.from({ length: cols }, (_, j) => ({ id: `c${j}`, name: `S${j + 1}`, role: "y" as const }))],
    rows: Array.from({ length: rows }, (_, i) => ({ id: `r${i}`, cells: { g: `G${i + 1}`, ...Object.fromEntries(Array.from({ length: cols }, (_, j) => [`c${j}`, ((i * 3 + j * 5) % 11) - 5.5])) } })),
  };
}
const base = (kind: Plot["kind"], extra: Partial<Plot> = {}): Plot => ({ id: "p", name: "P", source: "t", status: "ok", styleOverrides: {}, kind, ...extra });

/** The y attribute of the <text> whose content is exactly `label`. */
function textY(markup: string, label: string): number {
  const m = markup.match(new RegExp(`<text[^>]*\\sy="([-0-9.]+)"[^>]*>${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}</text>`));
  if (!m) throw new Error(`no <text> reading "${label}"`);
  return Number(m[1]);
}

describe("the colour bar's minimum label stays inside the figure", () => {
  it("heatmap: the min label's baseline is lifted off the bar's bottom edge by its descent", () => {
    const scene = buildPlotScene(matrixTable(8, 4), base("heatmap"), { width: 520, height: 360 });
    const hm = scene.heatmap!;
    expect(hm.showColorbar, "the fixture needs a colour bar").toBe(true);
    const font = (hm.barFont ?? scene.fonts.legend).size;
    const markup = renderToStaticMarkup(<PlotFigure scene={scene} selected={null} />);
    const minLabel = String(Math.round(hm.min * 100) / 100);
    const y = textY(markup, minLabel);
    const bottom = hm.bar.y + hm.bar.h;
    expect(bottom - y, "the min label's baseline must clear the bar's bottom by its descent").toBeGreaterThanOrEqual(font * 0.25);
    expect(y, "…but stay at the bar's foot, not float up it").toBeGreaterThan(bottom - font);
  });
});
