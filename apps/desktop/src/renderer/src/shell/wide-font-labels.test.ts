/**
 * Labels laid out for a font wider than this machine's, as on macOS, where the system font runs a few percent wider:
 *   · a treemap's region headings are drawn in capitals, so a heading has to be measured in capitals, or a font whose
 *     capitals are much wider than its small letters pushes it past the figure's edge;
 *   · a parallel plot's long variable names, spread over lines, must not touch a name on the same line, including the
 *     name two axes along when every second name is moved up.
 * Each check measures with the width the test gives the builder, so it holds whatever font a system has.
 */
import { describe, expect, it } from "vitest";
import { buildPlotScene } from "@mady/graphics";
import type { DataTable, Plot } from "@mady/core";
import { galleryItems } from "./gallery";
import { newDataVariants } from "./newDataVariants";
import { scenePaletteOpt } from "./scenePalette";

/** A font whose capitals are half again as wide as its small letters. */
const capsWide = (t: string, px: number): number =>
  [...t].reduce((w, ch) => w + (/[A-Z]/.test(ch) ? 0.78 : /[a-z]/.test(ch) ? 0.5 : 0.42), 0) * px;

function scenesOf(key: string, measure: (t: string, px: number) => number, width?: number) {
  const g = galleryItems().find((x) => x.key === key)!;
  const kind = g.plot.kind ?? "xy";
  const shapes = [{ label: "as in the gallery", table: g.table }, ...newDataVariants(g.key, kind, g.table)];
  return shapes.map((s) => ({
    label: s.label,
    scene: buildPlotScene(s.table as DataTable, g.plot as Plot, { width: width ?? g.plot.figureWidth ?? 580, height: g.plot.figureHeight ?? 380, measure, ...scenePaletteOpt(g.plot) }),
  }));
}

describe("treemap region headings measured as drawn", () => {
  it("every heading, drawn in capitals, stays inside the figure", () => {
    let checked = 0;
    for (const { label, scene } of scenesOf("treemap", capsWide)) {
      for (const h of scene.treemap?.groupLabels ?? []) {
        if (!h.text) continue;
        const shown = h.text.toUpperCase();
        // The drawn run: capitals at the drawn size plus the 0.08em letter-spacing between them.
        const w = capsWide(shown, h.fontSize) + h.fontSize * 0.08 * (shown.length - 1);
        const rad = (h.angle * Math.PI) / 180;
        const ex = (Math.abs(Math.cos(rad)) * w + Math.abs(Math.sin(rad)) * h.fontSize) / 2;
        const ey = (Math.abs(Math.sin(rad)) * w + Math.abs(Math.cos(rad)) * h.fontSize) / 2;
        const x = h.x + (h.dx ?? 0), y = h.y + (h.dy ?? 0);
        expect(x - ex, `${label}: "${shown}" runs past the left edge`).toBeGreaterThanOrEqual(0);
        expect(x + ex, `${label}: "${shown}" runs past the right edge`).toBeLessThanOrEqual(scene.width);
        expect(y - ey, `${label}: "${shown}" runs past the top edge`).toBeGreaterThanOrEqual(0);
        expect(y + ey, `${label}: "${shown}" runs past the bottom edge`).toBeLessThanOrEqual(scene.height);
        checked++;
      }
    }
    expect(checked, "fixture: no region heading was drawn").toBeGreaterThan(4);
  });
});

describe("parallel-coordinates names on a narrow figure", () => {
  it("no two names on one line touch, at any width the gallery's sheets are drawn at", () => {
    const wide = (t: string, px: number): number => t.length * px * 0.64;
    let moved = 0;
    for (const width of [580, 480, 420]) {
      for (const { label, scene } of scenesOf("parallel", wide, width)) {
        const fs = scene.fonts.axisTitle.size;
        const boxes = scene.parallel!.axes.map((a) => {
          const w = wide(a.label, fs);
          const x = a.labelX + ((a as { labelDx?: number }).labelDx ?? 0);
          return { name: a.label, x1: x - w / 2, x2: x + w / 2, y: a.labelY };
        });
        if (new Set(boxes.map((b) => b.y)).size > 2) moved++;
        for (let i = 0; i < boxes.length; i++) {
          for (let j = i + 1; j < boxes.length; j++) {
            const a = boxes[i]!, b = boxes[j]!;
            const sameLine = Math.abs(a.y - b.y) < fs * 0.9;
            expect(sameLine && a.x2 > b.x1 && b.x2 > a.x1, `${width}px, ${label}: "${a.name}" touches "${b.name}"`).toBe(false);
          }
        }
      }
    }
    expect(moved, "fixture: no figure needed more than two lines of names").toBeGreaterThan(0);
  });
});
