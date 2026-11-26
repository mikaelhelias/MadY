/**
 * Lollipop and paired dot plots draw their axes with renderers of their own. The builder gives both of them minor
 * ticks and a corner scale bar, as on every other chart, but those renderers drew neither: Minor ticks and Scale bar
 * changed nothing there.
 */
import { describe, expect, it } from "vitest";
import type { DataTable, Plot } from "@mady/core";
import { buildPlotScene } from "@mady/graphics";
import { renderToStaticMarkup } from "react-dom/server";
import { PlotFigure } from "./PlotFigure";
import { galleryItems } from "./gallery";

const SIZE = { width: 620, height: 420 };
const card = (kind: string) => (galleryItems() as unknown as { table: DataTable; plot: Plot }[]).find((i) => i.plot.kind === kind)!;
const tickMarks = (t: DataTable, p: Plot): number => (renderToStaticMarkup(<PlotFigure scene={buildPlotScene(t, p, SIZE)} selected={null} />).match(/data-tick-mark="value"/g) ?? []).length;
const markup = (t: DataTable, p: Plot): string => renderToStaticMarkup(<PlotFigure scene={buildPlotScene(t, p, SIZE)} selected={null} />);

describe("lollipop and paired dot axis marks", () => {
  for (const kind of ["lollipop", "paireddot"]) {
    it(`${kind}: Minor ticks adds tick marks to the value axis`, () => {
      const c = card(kind);
      const plain = tickMarks(c.table, c.plot);
      const withMinor = tickMarks(c.table, { ...c.plot, xAxis: { ...c.plot.xAxis, minorCount: 4 } });
      expect(withMinor).toBeGreaterThan(plain);
    });
    it(`${kind}: a scale bar on the value axis is drawn with its label`, () => {
      const c = card(kind);
      const p = { ...c.plot, xAxis: { ...c.plot.xAxis, scaleBar: { length: 3, label: "3 units" } } } as Plot;
      expect(buildPlotScene(c.table, p, SIZE).scaleBars?.length ?? 0).toBeGreaterThan(0);
      expect(markup(c.table, p)).toContain("3 units");
    });
  }
});
