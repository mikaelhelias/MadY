/**
 * A forest plot's confidence interval follows the series' error-bar Direction. It is drawn by the horizontal error-bar
 * path, which on an XY plot is the X half of a ± cross and always draws both ends; on a forest plot it is the only
 * interval, so Direction (both / up / down) was offered and did nothing.
 */
import { describe, expect, it } from "vitest";
import type { DataTable, Plot } from "@mady/core";
import { buildPlotScene } from "@mady/graphics";
import { renderToStaticMarkup } from "react-dom/server";
import { PlotFigure } from "./PlotFigure";
import { galleryItems } from "./gallery";

const item = (galleryItems() as unknown as { table: DataTable; plot: Plot }[]).find((i) => i.plot.kind === "forest")!;
const SIZE = { width: 620, height: 420 };
const markup = (p: Plot): string => renderToStaticMarkup(<PlotFigure scene={buildPlotScene(item.table, p, SIZE)} selected={null} />);
const withDir = (dir: "up" | "down"): Plot => {
  const id = buildPlotScene(item.table, item.plot, SIZE).series[0]!.id;
  return { ...item.plot, seriesStyles: { ...item.plot.seriesStyles, [id]: { ...item.plot.seriesStyles?.[id], errorDir: dir } } } as Plot;
};

describe("forest plot interval direction", () => {
  it("up and down each draw a different interval from both", () => {
    const both = markup(item.plot);
    const up = markup(withDir("up"));
    const down = markup(withDir("down"));
    expect(up).not.toBe(both);
    expect(down).not.toBe(both);
    expect(up).not.toBe(down);
  });
  it("an XY plot's X error stays two-sided whatever the Y direction", () => {
    const xy = (galleryItems() as unknown as { table: DataTable; plot: Plot }[]).find((i) => i.plot.kind === "xy")!;
    const s = buildPlotScene(xy.table, xy.plot, SIZE);
    // Give every mark a two-sided X error and compare Direction "up" with "both": only the Y bars may change.
    const withX = (dir?: "up") => {
      const sc = JSON.parse(JSON.stringify(s)) as typeof s;
      for (const se of sc.series) {
        if (dir) se.errorDir = dir;
        for (const m of se.marks) { if (m.cx != null) { m.errLowCx = m.cx - 10; m.errHighCx = m.cx + 10; delete m.errLowCy; delete m.errHighCy; } }
      }
      return renderToStaticMarkup(<PlotFigure scene={sc} selected={null} />);
    };
    expect(withX("up")).toBe(withX());
  });
});
