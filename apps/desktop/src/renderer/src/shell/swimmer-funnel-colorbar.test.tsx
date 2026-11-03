/**
 * Swimmer and funnel plots coloured by a column of numbers paint their marks along a ramp; the colour bar is the key to
 * that ramp, as on the XY family and the ternary plot. Both builders painted the marks and drew no bar, so the colours
 * had no key and the Colour bar (legend) section's controls changed nothing.
 */
import { describe, expect, it } from "vitest";
import type { DataTable, Plot } from "@mady/core";
import { buildPlotScene } from "@mady/graphics";
import { galleryItems } from "./gallery";
import { renderFingerprint } from "./drawingMarkup";

const SIZE = { width: 620, height: 420 };
const card = (kind: string) => (galleryItems() as unknown as { table: DataTable; plot: Plot }[]).find((i) => i.plot.kind === kind)!;
/** The card coloured by its first all-numeric column, on the series the drawing paints. */
const coloured = (kind: string, byNames = false): { table: DataTable; plot: Plot; colName: string } => {
  const c = card(kind);
  const id = buildPlotScene(c.table, c.plot, SIZE).series.find((s) => s.marks.length > 0)!.id;
  const numeric = (col: { id: string }) => c.table.rows.every((r) => Number.isFinite(Number(r.cells[col.id])));
  const col = byNames
    ? c.table.columns.find((x) => !numeric(x))
    : [...c.table.columns].reverse().find((x) => numeric(x) && new Set(c.table.rows.map((r) => Number(r.cells[x.id]))).size > 2);
  if (!col) throw new Error(`${kind}: no ${byNames ? "names" : "numbers"} column on the card`);
  const plot = { ...c.plot, seriesStyles: { ...c.plot.seriesStyles, [id]: { ...c.plot.seriesStyles?.[id], colorFromColumn: col.id, colorFromMode: byNames ? "category" : "continuous" } } } as Plot;
  return { table: c.table, plot, colName: col.name };
};

describe("colour bar on swimmer and funnel plots", () => {
  for (const kind of ["swimmer", "funnel"]) {
    it(`${kind}: coloured by numbers, a colour bar is drawn right of the plot`, () => {
      const { table, plot } = coloured(kind);
      const s = buildPlotScene(table, plot, SIZE);
      expect(s.colorbar, "no colour bar").toBeDefined();
      expect(s.colorbar!.max).toBeGreaterThan(s.colorbar!.min);
      expect(s.colorbar!.bar.x).toBeGreaterThanOrEqual(s.plot.x + s.plot.width);
      expect(s.colorbar!.bar.x + s.colorbar!.bar.w).toBeLessThanOrEqual(s.width);
    });
    it(`${kind}: the Colour bar title and size controls change the drawing`, () => {
      const { table, plot } = coloured(kind);
      const base = renderFingerprint(table, plot, SIZE);
      expect(renderFingerprint(table, { ...plot, colorbarTitle: "Probe heading" } as Plot, SIZE)).not.toBe(base);
      expect(renderFingerprint(table, { ...plot, colorbarScale: 1.6 } as Plot, SIZE)).not.toBe(base);
    });
    it(`${kind}: coloured by names, no colour bar`, () => {
      const { table, plot } = coloured(kind, true);
      expect(buildPlotScene(table, plot, SIZE).colorbar).toBeUndefined();
    });
  }
});
