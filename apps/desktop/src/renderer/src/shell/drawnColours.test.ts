import { describe, expect, it } from "vitest";
import { buildPlotScene, PALETTES } from "@mady/graphics";
import type { DataTable, Plot } from "@mady/core";
import { galleryItems } from "./gallery";
import { drawnSeriesColours, drawnSeriesList } from "./drawnColours";
import { paletteSwitchPatch } from "./paletteSwitch";
import { scenePaletteOpt } from "./scenePalette";

type Item = { title: string; table: DataTable; plot: Plot };
const card = (title: string): Item => (galleryItems() as unknown as Item[]).find((i) => i.title === title)!;

describe("drawnSeriesColours", () => {
  it("follows the graph's palette after Colour scheme ▸ Palette", () => {
    const c = card("Box & whisker");
    const plot = { ...c.plot, ...paletteSwitchPatch(c.plot, c.table, "Vibrant") } as Plot;
    const colours = [...drawnSeriesColours(c.table, plot).values()];
    expect(colours.slice(0, 3)).toEqual(PALETTES.Vibrant!.slice(0, 3));
  });

  it("gives a swimmer's event series the colour of its place among the events, as drawn", () => {
    const c = card("Swimmer plot");
    const { seriesStyles: _drop, ...bare } = c.plot;
    const plot = bare as Plot;
    const drawn = buildPlotScene(c.table, plot, { width: 620, height: 420, ...scenePaletteOpt(plot) }).series;
    const death = drawn.find((s) => s.name === "Death")!;
    expect(drawnSeriesColours(c.table, plot).get(death.id)).toBe(death.color);
  });

  it("drawnSeriesList: the drawn series in order, repeated names made unique, colours on the graph's palette", () => {
    const c = card("Dendrogram");
    const plot = { ...c.plot, ...paletteSwitchPatch(c.plot, c.table, "Vibrant") } as Plot;
    const drawn = buildPlotScene(c.table, plot, { width: 620, height: 420, ...scenePaletteOpt(plot) }).series;
    const list = drawnSeriesList(c.table, plot);
    expect(list.map((d) => d.id)).toEqual(drawn.map((s) => s.id));
    expect(list.map((d) => d.color)).toEqual(drawn.map((s) => s.color));
    expect(new Set(list.map((d) => d.name)).size, list.map((d) => d.name).join(", ")).toBe(list.length);
    // The card's branches share one name, so the fixture can show a repeated name.
    expect(new Set(drawn.map((s) => s.name)).size).toBeLessThan(drawn.length);
  });

  it("reads the same colours from the first rows of a long sheet as from the whole sheet", () => {
    const c = card("XY (points + fitted curve)");
    const rows = Array.from({ length: 500 }, (_, k) => ({ ...c.table.rows[k % c.table.rows.length]!, id: `long-${k}` }));
    const long: DataTable = { ...c.table, rows };
    const whole = new Map(buildPlotScene(long, c.plot, { width: 620, height: 420, ...scenePaletteOpt(c.plot) }).series.map((s) => [s.id, s.color] as const));
    expect(drawnSeriesColours(long, c.plot)).toEqual(whole);
  });
});
