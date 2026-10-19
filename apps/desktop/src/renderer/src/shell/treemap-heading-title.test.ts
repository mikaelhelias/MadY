/**
 * A treemap's region names never sit on the chart title.
 *
 * Guards against a region name being drawn across the title, which some Arrangement settings
 * and figure sizes can cause. The region names dodge outward past the
 * cells, and a dodge that stops only at the figure's edge can land in the title band.
 *
 * Measured against where the renderer draws both: the title's baseline at 8 + 0.85·size, centred
 * on the figure (the gallery card's alignment), and each region name as a bold, 0.08em-tracked,
 * UPPER-CASE run rotated about its centre. Over the gallery treemap and several arrangements, at
 * figure sizes from a small card to a wide page.
 */
import { describe, expect, it } from "vitest";
import type { Plot } from "@mady/core";
import { buildPlotScene } from "@mady/graphics";
import { galleryItems } from "./gallery";
import { scenePaletteOpt } from "./scenePalette";

const measure = (t: string, px: number): number => t.length * px * 0.6;

describe("treemap region names clear the title", () => {
  it("no region name's box meets the title's, at any size or arrangement", () => {
    const item = galleryItems().find((i) => i.plot.kind === "treemap")!;
    const hits: string[] = [];
    let named = 0;
    for (const seed of [undefined, 1, 3, 7]) {
      for (const [w, h] of [[480, 360], [580, 380], [640, 460], [700, 520], [900, 640]] as const) {
        const plot = { ...item.plot, treemap: { ...(item.plot.treemap ?? {}), ...(seed !== undefined ? { seed } : {}) } } as Plot;
        const s = buildPlotScene(item.table, plot, { measure, width: w, height: h, ...scenePaletteOpt(plot) });
        if (!s.title) continue;
        const ts = s.fonts.title.size;
        const tw = measure(s.title, ts) * 1.1; // bold
        const title = { x1: s.width / 2 - tw / 2, x2: s.width / 2 + tw / 2, y1: 8, y2: 8 + ts * 1.05 };
        for (const g of s.treemap?.groupLabels ?? []) {
          if (!g.text) continue;
          named++;
          const text = g.text.toUpperCase();
          const gw = measure(text, g.fontSize) * 1.06 + g.fontSize * 0.08 * (text.length - 1);
          const gh = g.fontSize;
          const r = (g.angle * Math.PI) / 180;
          const hx = (Math.abs(Math.cos(r)) * gw + Math.abs(Math.sin(r)) * gh) / 2;
          const hy = (Math.abs(Math.sin(r)) * gw + Math.abs(Math.cos(r)) * gh) / 2;
          const cx = g.x + (g.dx ?? 0), cy = g.y + (g.dy ?? 0);
          if (cx - hx < title.x2 && title.x1 < cx + hx && cy - hy < title.y2 && title.y1 < cy + hy)
            hits.push(`${w}×${h} seed ${seed ?? "default"}: "${text}" (${(cy - hy).toFixed(1)}) on the title (bottom ${title.y2.toFixed(1)})`);
        }
      }
    }
    expect(named, "no region names drawn — the fixture cannot exhibit this").toBeGreaterThan(20);
    expect(hits).toEqual([]);
  });
});
