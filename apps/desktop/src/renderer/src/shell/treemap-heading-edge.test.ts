// @vitest-environment node
/**
 * A treemap's region headings stay inside the figure even when the font draws them a little wider
 * than measured. Headings are drawn bold with letter-spacing; the measurer knows neither exactly, and
 * the bold face differs between systems. So a heading must keep a margin from the edge, not end on it:
 * every heading is checked as if its text were 12% wider than the builder's estimate (a bold face can be that much wider).
 */
import { expect, it } from "vitest";
import { buildPlotScene } from "@mady/graphics";
import type { DataTable, Plot } from "@mady/core";
import { galleryItems } from "./gallery";
import { newDataVariants } from "./newDataVariants";

const measure = (t: string, px: number): number => t.length * px * 0.58;
const WIDER = 1.12;

it("treemap region headings keep inside the figure, with room for a slightly wider font", () => {
  const out: string[] = [];
  let headings = 0;
  for (const g of galleryItems().filter((x) => x.key === "treemap")) {
    const extra = (g as { extraTables?: DataTable[] }).extraTables ?? [];
    const shapes = [{ label: "as in the gallery", table: g.table, extraTables: extra }, ...newDataVariants(g.key, g.plot.kind ?? "xy", g.table, extra)];
    for (const s of shapes) for (let w = 520; w <= 660; w += 4) for (const h of [340, 380, 420]) {
      const tables = [s.table, ...s.extraTables];
      const scene = buildPlotScene(s.table, g.plot as Plot, { width: w, height: h, measure, tables: (id: string) => tables.find((t) => t.id === id) });
      for (const hd of scene.treemap?.groupLabels ?? []) {
        if (!hd.text) continue;
        headings++;
        const fh = hd.fontSize;
        // The drawn run as the builder models it (bold slack and 0.08em tracking), made 12% wider.
        const len = measure(hd.text, fh) * 1.15 * 1.06 * WIDER + fh * 0.08 * Math.max(0, hd.text.length - 1);
        const rad = (hd.angle * Math.PI) / 180;
        const exX = (Math.abs(Math.cos(rad)) * len + Math.abs(Math.sin(rad)) * fh) / 2;
        const exY = (Math.abs(Math.sin(rad)) * len + Math.abs(Math.cos(rad)) * fh) / 2;
        const x = hd.x + (hd.dx ?? 0), y = hd.y + (hd.dy ?? 0);
        if (x - exX < 0 || x + exX > w || y - exY < 0 || y + exY > h) {
          out.push(`${s.label} @ ${w}×${h}: "${hd.text}" reaches ${Math.max(-(x - exX), x + exX - w, -(y - exY), y + exY - h).toFixed(1)} px past the edge`);
        }
      }
    }
  }
  expect(headings, "the fixture draws headings").toBeGreaterThan(100);
  expect(out, `headings past the edge:\n  - ${out.slice(0, 12).join("\n  - ")}\n`).toEqual([]);
}, 120_000);
