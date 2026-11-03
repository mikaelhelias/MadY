/**
 * A pie with more slices than the palette has colours, with small slices side by side.
 *
 * The palette has eight colours, and on a pie the last slice touches the first, so a ninth slice
 * in the first slice's colour would read as one with it: every slice gets its own colour. A 0.4 %
 * slice reads "<1%", not "0%", and its outside label keeps clear of its neighbour's label.
 */
import { describe, expect, it } from "vitest";
import type { DataTable, Plot } from "@mady/core";
import { buildPlotScene } from "./buildScene";
import { categoryColor, OKABE_ITO, seriesColor } from "./palette";

describe("categoryColor", () => {
  it("the palette as it is, then a lighter and a darker round: 24 categories, 24 colours", () => {
    const cs = Array.from({ length: 24 }, (_, i) => categoryColor(i, OKABE_ITO).toLowerCase());
    expect(new Set(cs).size).toBe(24);
    for (let i = 0; i < 8; i++) expect(categoryColor(i, OKABE_ITO)).toBe(seriesColor(i, OKABE_ITO));
  });
});

/** One width rule for the builder and for the overlap check below. */
const estimateWidth = (t: string, px: number): number => t.length * px * 0.6;

const parties: Array<[string, number]> = [
  ["Social Democratic Alliance", 28.4], ["Christian Democratic Union of the Centre", 24.1], ["Greens and Independents", 14.7], ["Liberal Reform", 11.2],
  ["Workers' Left", 9.3], ["Farmers' League", 7.9], ["Pirate Party", 3.0], ["Others", 1.0], ["Animal Rights Party", 0.4],
];
const table = {
  id: "t", kind: "partsofwhole", name: "Election",
  columns: [{ id: "p", name: "Party", role: "x" }, { id: "v", name: "Vote share (%)", role: "y" }],
  rows: parties.map(([p, v], i) => ({ id: `r${i}`, cells: { p, v } })),
} as unknown as DataTable;
const plot = (over: Partial<Plot> = {}) => ({ id: "g", name: "Vote", source: "t", kind: "pie", ...over }) as unknown as Plot;
const scene = (p: Plot) => buildPlotScene(table, p, { width: 620, height: 460, measure: estimateWidth });

describe("a nine-slice pie", () => {
  it("every slice has its own colour, and the legend keys carry the same colours", () => {
    const s = scene(plot());
    const colours = s.pie!.slices.map((x) => x.color.toLowerCase());
    expect(new Set(colours).size, "two slices share a colour").toBe(9);
    expect(s.legend.map((l) => l.color.toLowerCase())).toEqual(colours);
  });

  it("the 0.4 % slice reads \"<1%\" (outside labels; inside, a slice that small carries none)", () => {
    const s = scene(plot({ pieLabelPosition: "outside" }));
    expect(s.pie!.slices[8]!.labelText).toBe("<1%");
  });

  it("outside labels do not print over each other", () => {
    const s = scene(plot({ pieLabelPosition: "outside" }));
    const boxes = s.pie!.slices.filter((x) => x.labelText && !x.labelInside).map((x) => {
      const size = (x.labelFont?.size ?? s.fonts.sliceLabel.size);
      const w = estimateWidth(x.labelText, size);
      const base = x.labelY + size * 0.34;
      return { t: x.labelText, x1: x.labelX - w / 2, x2: x.labelX + w / 2, y1: base - size * 0.8, y2: base + size * 0.25 };
    });
    const hits: string[] = [];
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i]!, b = boxes[j]!;
      if (Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1) > 0.5 && Math.min(a.y2, b.y2) - Math.max(a.y1, b.y1) > 0.5) hits.push(`${a.t} / ${b.t}`);
    }
    expect(hits).toEqual([]);
  });

  it("spacing the labels does not grow the pie: every outside label stays inside the plot area, clear of the title", () => {
    // A donut as the Editorial look styles it: large left-aligned title, legend on the right.
    const font = (size: number, bold = false) => ({ size, family: "'Segoe UI', system-ui, sans-serif", ...(bold ? { bold } : {}) });
    const p = {
      ...plot({ pieLabelPosition: "outside", pieDonut: 0.55, pieStartAngle: 90 } as Partial<Plot>),
      name: "Vote share (donut, outside labels)", titleAlign: "left", frame: "none",
      fonts: { title: font(26, true), subtitle: font(14), axisTitle: font(13), tick: font(12), legend: font(12) },
      paletteColors: ["#843CC0", "#0C9048", "#CC3024", "#2563EB", "#E0A21E", "#0E9D9D", "#C026D3", "#475569"],
    } as unknown as Plot;
    const s = buildPlotScene(table, p, { width: 580, height: 380 });
    for (const x of s.pie!.slices.filter((x) => x.labelText)) {
      const size = x.labelFont?.size ?? s.fonts.sliceLabel.size;
      expect(x.labelY + size * 0.34 - size * 0.8, `"${x.labelText}" reaches above the plot, into the title`).toBeGreaterThanOrEqual(s.plot.y - 1);
    }
  });

  it("eight slices or fewer take the plain palette, as the first eight slices of a longer pie do", () => {
    const eight = { ...table, rows: table.rows.slice(0, 8) } as DataTable;
    const s = buildPlotScene(eight, plot(), { width: 620, height: 460 });
    const nine = scene(plot());
    expect(s.pie!.slices.map((x) => x.color)).toEqual(nine.pie!.slices.slice(0, 8).map((x) => x.color));
  });
});
