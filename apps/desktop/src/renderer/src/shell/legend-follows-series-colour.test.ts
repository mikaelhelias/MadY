/**
 * A legend row keys its series in the colour the series is drawn in. Every gallery graph: each series that has a legend
 * row is given a colour of its own, and its row must show the colour the series is then drawn in. A row that kept its
 * palette slot would key a red line with a blue dot (the scree plot did), and the renderer draws such a key solid, so
 * the fill no longer matched either.
 */
import { describe, expect, it } from "vitest";
import { buildPlotScene } from "@mady/graphics";
import type { DataTable, Plot } from "@mady/core";
import { galleryItems } from "./gallery";
import { scenePaletteOpt } from "./scenePalette";

const COLOURS = ["#d01c1c", "#1cd01c", "#1c1cd0", "#d0d01c", "#d01cd0", "#1cd0d0", "#7a3b10", "#103b7a"];
type Item = { title: string; table: DataTable; plot: Plot; extraTables?: DataTable[] };
const build = (it: Item, plot: Plot) =>
  buildPlotScene(it.table, plot, { width: 620, height: 420, ...scenePaletteOpt(plot), tables: (id: string) => [it.table, ...(it.extraTables ?? [])].find((t) => t.id === id) });

describe("legend rows follow their series' colour", () => {
  it("on every gallery graph", () => {
    const wrong: string[] = [];
    let checked = 0;
    for (const it of galleryItems() as unknown as Item[]) {
      const before = build(it, it.plot);
      // A colour-by-data row keys one category of the data in the colour its marks are drawn in, not the series colour
      // (the series colour is drawn nowhere there); `legend-keys-match.test.tsx` holds those rows to their marks.
      const ids = before.legend
        .map((e) => (e.select?.as === "series" && !e.dataDriven ? e.select.id : null))
        .filter((id): id is string => !!id && before.series.some((s) => s.id === id));
      if (!ids.length) continue;
      const styles = { ...(it.plot.seriesStyles ?? {}) };
      ids.forEach((id, i) => { styles[id] = { ...(styles[id] ?? {}), color: COLOURS[i % COLOURS.length]! }; });
      const after = build(it, { ...it.plot, seriesStyles: styles });
      ids.forEach((id, i) => {
        const s = after.series.find((x) => x.id === id);
        // A series that does not take a colour of its own (drawn by data) is not this check's question.
        if (!s || s.color.toLowerCase() !== COLOURS[i % COLOURS.length]!.toLowerCase()) return;
        const row = after.legend.find((e) => e.select?.as === "series" && e.select.id === id && !e.dataDriven);
        checked++;
        if (!row || row.color.toLowerCase() !== s.color.toLowerCase()) wrong.push(`${it.title} · ${id}: row ${row?.color}, drawn ${s.color}`);
      });
    }
    expect(checked, "legend rows checked").toBeGreaterThan(40);
    expect(wrong).toEqual([]);
  });
});
