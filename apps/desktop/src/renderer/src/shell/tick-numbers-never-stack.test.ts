// The numbers along an axis never sit on each other — at any tick font, on every chart.
//
// A large tick font (30) is where this is at risk: Y numbers spaced closer than their own height,
// neighbouring X numbers running into each other, and a last category name meeting the right-hand
// axis's first number at the plot corner. Each is checked below.
//
// A graph is laid out at its own size (580×380 unless it carries one) and zoomed, not re-laid-out at
// the window's size (958×608). A tick count that does not follow the axis's pixel length
// (`TARGET_TICKS` is a constant) packs the same ladder tighter on a smaller canvas.
//
// This is the fast (pure scene, no browser) form of the text-overlap check in `e2e/figure-geometry.spec.ts`, over every
// gallery card, at the house font and the enlarged one. The label boxes are recomputed here from the tick positions —
// not read back from the builder's own placement helpers — so the check does not share its answer
// with the code it judges.
import { describe, expect, it } from "vitest";
import type { DataTable, Plot } from "@mady/core";
import { buildPlotScene, type AxisScene } from "@mady/graphics";
import { galleryItems } from "./gallery";
import { graphLayoutSize } from "./graphDisplay";
import { arialWidth } from "./arialWidth.testutil";

const measure = arialWidth; // Arial's own advance widths, checked against the browser - see the helper
/** A line of digits is drawn this many font-sizes tall: the browser boxes 30 px numbers at 33-34 px (measured). */
const LINE = 1.12;
const TOL = 1.5;

interface Box { x1: number; x2: number; y1: number; y2: number; label: string }
const hit = (a: Box, b: Box): boolean =>
  Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1) > TOL && Math.min(a.y2, b.y2) - Math.max(a.y1, b.y1) > TOL;

const drawn = (ax: AxisScene | undefined) => (!ax || ax.hidden ? [] : ax.ticks.filter((t) => !t.minor && t.label !== ""));

const FONTS: Array<[string, Plot["fonts"]]> = [
  ["house fonts", undefined],
  ["tick 30 / title 40", { tick: { size: 30 }, axisTitle: { size: 40 } }],
];

const cases = galleryItems().flatMap((g) =>
  FONTS.map(([fontName, fonts]) => ({
    name: `${g.title} · ${fontName}`,
    table: g.table as DataTable,
    plot: (fonts ? { ...g.plot, fonts: { ...(g.plot.fonts ?? {}), tick: { ...(g.plot.fonts?.tick ?? {}), ...fonts.tick }, axisTitle: { ...(g.plot.fonts?.axisTitle ?? {}), ...fonts.axisTitle } } } : g.plot) as Plot,
  })),
);

describe("the numbers along an axis never sit on each other", () => {
  it.each(cases)("$name", ({ table, plot }) => {
    // The size the app lays this card out at — its own, or the default — not one picked for the test.
    const s = buildPlotScene(table, plot, { ...graphLayoutSize(plot), measure });
    const clashes: string[] = [];
    const xBottom = s.plot.y + s.plot.height;

    // Boxes of the labels along the bottom axis (flat only — turned labels have their own guard).
    const xBoxes: Box[] = s.x.tickRotation ? [] : drawn(s.x).map((t) => {
      const w = measure(t.label, s.fonts.xTick.size);
      return { x1: t.pos - w / 2, x2: t.pos + w / 2, y1: xBottom + 6, y2: xBottom + 6 + LINE * s.fonts.xTick.size, label: t.label };
    });
    // Boxes of the labels up a vertical axis: right-aligned left of the plot, or left-aligned right of it.
    const vBoxes = (ax: AxisScene | undefined, font: number, side: "left" | "right", axisX: number): Box[] =>
      !ax || ax.tickRotation || ax.side === "top" ? [] : drawn(ax).map((t) => {
        const w = measure(t.label, font);
        const h = (LINE * font) / 2;
        return side === "left"
          ? { x1: axisX - 8 - w, x2: axisX - 8, y1: t.pos - h, y2: t.pos + h, label: t.label }
          : { x1: axisX + 8, x2: axisX + 8 + w, y1: t.pos - h, y2: t.pos + h, label: t.label };
      });
    const yBoxes = vBoxes(s.y, s.fonts.yTick.size, "left", s.plot.x);
    const y2Boxes = vBoxes(s.y2, (s.fonts.y2Tick ?? s.fonts.yTick).size, "right", s.plot.x + s.plot.width);

    // 1 · On one numeric axis, no two numbers overlap. (Category names are fitted by their own rule.)
    const within = (name: string, ax: AxisScene | undefined, boxes: Box[]): void => {
      if (!ax || ax.band) return;
      for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
        if (hit(boxes[i]!, boxes[j]!)) clashes.push(`${name}: "${boxes[i]!.label}"×"${boxes[j]!.label}"`);
      }
    };
    within("x", s.x, xBoxes);
    within("y", s.y, yBoxes);
    within("y2", s.y2, y2Boxes);

    // 2 · At the plot's bottom-right corner, the right-hand axis's numbers stay clear of the X labels.
    for (const a of y2Boxes) for (const b of xBoxes) if (hit(a, b)) clashes.push(`corner: x "${b.label}"×y2 "${a.label}"`);

    expect(clashes).toEqual([]);
  });
});
