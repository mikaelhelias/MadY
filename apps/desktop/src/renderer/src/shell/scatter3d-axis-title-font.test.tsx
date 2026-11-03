/**
 * A 3D scatter's axis title takes the axis's whole title font — colour, family, weight, italic — not only its size.
 * The scene carried the size alone, so Fonts ▸ Colour (and the rest) on the X, Y and Z axis panels did nothing.
 */
import { describe, expect, it } from "vitest";
import type { DataTable, Plot } from "@mady/core";
import { buildPlotScene } from "@mady/graphics";
import { renderToStaticMarkup } from "react-dom/server";
import { PlotFigure } from "./PlotFigure";
import { galleryItems } from "./gallery";

const item = (galleryItems() as unknown as { table: DataTable; plot: Plot }[]).find((i) => i.plot.kind === "scatter3d")!;
const markup = (p: Plot): string => renderToStaticMarkup(<PlotFigure scene={buildPlotScene(item.table, p, { width: 620, height: 420 })} selected={null} />);

describe("3D scatter axis title font", () => {
  for (const axis of ["xAxis", "yAxis", "zAxis"] as const) {
    it(`${axis}: colour and weight reach the title`, () => {
      const p = { ...item.plot, [axis]: { ...(item.plot[axis] ?? {}), title: "Probe title", titleFont: { color: "#ab12cd", bold: true } } } as Plot;
      const m = markup(p);
      const at = m.indexOf("Probe title");
      expect(at).toBeGreaterThan(0);
      const tag = m.slice(m.lastIndexOf("<text", at), at);
      expect(tag.toLowerCase()).toContain("#ab12cd");
      expect(tag).toMatch(/font-weight="(bold|700)"/);
    });
  }
});
