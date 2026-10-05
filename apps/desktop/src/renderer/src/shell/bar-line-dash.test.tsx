// @vitest-environment jsdom
/**
 * A bar-chart series drawn as a line takes its Pattern (dashed, dotted…) — on bars + line and on stacked bars + line.
 * The Pattern row writes `lineDash`; guards against the bar builder drawing every series with `dash: null` in both
 * orientations, which would leave the line solid.
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
const build = (c: ReturnType<typeof card>, plot: Plot) => buildPlotScene(c.table, plot, { width: 640, height: 460, tables: c.lk });
const withDash = (plot: Plot, id: string, lineDash: string): Plot =>
  ({ ...plot, seriesStyles: { ...(plot.seriesStyles ?? {}), [id]: { ...(plot.seriesStyles?.[id] ?? {}), lineDash } } }) as Plot;

describe.each([
  ["Bars + line (2nd axis)", "vertical"],
  ["Stacked bars + line (2nd axis)", "vertical"],
  ["Bars + line (2nd axis)", "horizontal"],
  ["Stacked bars + line (2nd axis)", "horizontal"],
])("%s, %s", (title, orientation) => {
  it("the line's Pattern reaches the drawn line", () => {
    const c = card(title);
    const base = { ...c.plot, ...(orientation === "horizontal" ? { barOrientation: "horizontal" } : {}) } as Plot;
    const line = build(c, base).series.find((s) => s.overlayLine);
    expect(line, "the card draws no bar series as a line — this proves nothing").toBeDefined();
    for (const dash of ["dashed", "dotted", "dashdot", "longdash"]) {
      const scene = build(c, withDash(base, line!.id, dash));
      const s = scene.series.find((x) => x.id === line!.id)!;
      expect(s.dash, dash).toBeTruthy();
      const { container } = render(<PlotFigure scene={scene} selected={null} />);
      // The visible stroke, not the transparent click target drawn under it with the same path.
      const drawn = [...container.querySelectorAll("path")].find((p) => p.getAttribute("d") === s.overlayLine && p.getAttribute("stroke") !== "transparent");
      expect(drawn?.getAttribute("stroke-dasharray"), `${dash}: the drawn line`).toBe(s.dash);
      cleanup();
    }
    // Solid (the default) stays solid.
    expect(build(c, withDash(base, line!.id, "solid")).series.find((x) => x.id === line!.id)!.dash).toBeNull();
  });
});
