// A heatmap's names are drawn at a size that fits the row height, which can be well under the size asked for. The
// room reserved for them (above the cells for the column names, left of them for the row names) must follow the
// size they are drawn at, not the size asked for — otherwise the room stays empty and the cells lose it.
import { describe, expect, it } from "vitest";
import type { DataTable, Plot } from "@mady/core";
import { buildPlotScene } from "./buildScene";

const TAXA = ["Bacteroides", "Prevotella", "Faecalibacterium", "Ruminococcus", "Akkermansia", "Bifidobacterium", "Escherichia", "Lactobacillus"];

function table(rows: number, rowName = (i: number): string => `S${i + 1}`): DataTable {
  return {
    id: "hm", kind: "multivariable", name: "Microbiome",
    columns: [{ id: "s", name: "Sample", role: "x" }, ...TAXA.map((t, j) => ({ id: `c${j}`, name: t, role: "y" as const }))],
    rows: Array.from({ length: rows }, (_, i) => ({
      id: `r${i}`,
      cells: { s: rowName(i), ...Object.fromEntries(TAXA.map((_t, j) => [`c${j}`, ((i * 7 + j * 13) % 50) + 1])) },
    })),
  };
}
const plotOf = (size: number | undefined, w = 700, h = 560): Plot => ({
  id: "p", name: "P", source: "hm", status: "ok", styleOverrides: {}, kind: "heatmap",
  figureWidth: w, figureHeight: h,
  ...(size !== undefined ? { heatmap: { labelFont: { size } } } : {}),
});
const build = (t: DataTable, size: number | undefined, w = 700, h = 560) => buildPlotScene(t, plotOf(size, w, h), { width: w, height: h });
const drawn = (s: ReturnType<typeof build>): number => s.heatmap!.labelFont?.size ?? 0;

describe("heatmap label room follows the drawn label size", () => {
  const dense = table(24);

  it("the labels really are drawn smaller than asked, on a dense sheet", () => {
    const s = build(dense, 26);
    expect(drawn(s)).toBeLessThan(26);
  });

  it("the room above the cells is the room a label of the DRAWN size needs", () => {
    const asked = build(dense, 26);
    const same = build(dense, drawn(asked)); // the same labels, asked for at the size they are drawn at
    expect(drawn(same)).toBe(drawn(asked));
    expect(asked.plot.y).toBe(same.plot.y);
    expect(asked.plot.height).toBe(same.plot.height);
  });

  it("the cells keep the room that was not needed: taller, and the names larger, than with room sized for the asked size", () => {
    const s = build(dense, 26);
    expect(s.plot.y).toBeLessThan(170); // 250 of 560 with room sized for the asked size
    expect(drawn(s)).toBeGreaterThanOrEqual(9); // 7 with room sized for the asked size: the empty room costs the rows their height
  });

  it("the room left of the cells follows the drawn size too (long row names)", () => {
    const long = table(24, (i) => `Sample ${i + 1} from the north field`);
    const asked = build(long, 26);
    const same = build(long, drawn(asked));
    expect(asked.plot.x).toBe(same.plot.x);
  });

  it("a figure with room for the asked size is untouched: names at the size asked, room sized for it", () => {
    const few = table(5);
    const s = build(few, 26, 700, 900);
    expect(drawn(s)).toBe(26);
    // Room sized for the size asked: names asked for at half the size, also drawn at the size asked, get less room.
    const half = build(few, 13, 700, 900);
    expect(drawn(half)).toBe(13);
    expect(half.plot.y, "the room above the cells does not follow the size asked for").toBeLessThan(s.plot.y);
    expect(half.plot.x, "the room left of the cells does not follow the size asked for").toBeLessThan(s.plot.x);
  });

  it("the names never come out larger than the room reserved for them", () => {
    for (const h of [260, 340, 460, 560, 800]) {
      const s = build(dense, 26, 700, h);
      const same = build(dense, drawn(s), 700, h);
      expect(same.plot.y, `figure ${h} px tall`).toBe(s.plot.y);
      expect(drawn(same), `figure ${h} px tall`).toBe(drawn(s));
    }
  });
});
