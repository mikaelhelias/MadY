/**
 * Point labels clear the user's text notes (e.g. a dot's value label "86" must not be printed on
 * a note reading "mean 78%"). The label placer already steers round marks,
 * guide lines and the legend; a note the user put on the plot is ink in the same way.
 */
import { describe, expect, it } from "vitest";
import type { Annotation, DataTable, Plot } from "@mady/core";
import { buildPlotScene, textNoteObstacles } from "./buildScene";

const measure = (t: string, px: number): number => t.length * px * 0.6;
const table = {
  id: "t", kind: "xy", name: "t",
  columns: [{ id: "x", name: "X", role: "x" }, { id: "y", name: "Y", role: "y" }],
  rows: [[1, 2], [3, 5], [5, 3], [7, 8], [9, 6]].map(([x, y], i) => ({ id: `r${i}`, cells: { x, y } })),
} as unknown as DataTable;
const SIZE = { width: 580, height: 380, measure };
function build(annotations: Annotation[] = []) {
  const plot = {
    id: "p", name: "p", source: "t", status: "ok", styleOverrides: {}, kind: "xy", annotations,
    seriesStyles: { y: { pointLabels: "y" } },
  } as unknown as Plot;
  return buildPlotScene(table, plot, SIZE);
}
/** Each point label's box, as the renderer draws it (baseline-centred text beside the mark). */
function labelBoxes(s: ReturnType<typeof build>) {
  const px = s.fonts.valueLabel.size;
  return s.series.flatMap((ser) => ser.marks.filter((m) => m.pointLabel && m.pointLabelDx != null).map((m) => {
    const t = m.valueText || m.pointLabel!;
    const w = measure(t, px);
    const x = m.cx + m.pointLabelDx!, y = m.cy + m.pointLabelDy!;
    // `pointLabelAnchor` is "start" | "end" (scene.ts) and the renderer draws
    // `textAnchor={m.pointLabelAnchor ?? "start"}`, so there is no centred case to handle.
    const x1 = m.pointLabelAnchor === "end" ? x - w : x;
    return { t, x1, y1: y - px / 2, x2: x1 + w, y2: y + px / 2 };
  }));
}
const overlaps = (a: { x1: number; y1: number; x2: number; y2: number }, b: typeof a) =>
  a.x1 < b.x2 && b.x1 < a.x2 && a.y1 < b.y2 && b.y1 < a.y2;

describe("point labels clear the user's text notes", () => {
  it("a note put exactly where a label would sit: the label moves off it", () => {
    const bare = build();
    const target = labelBoxes(bare).find((l) => l.t === "5")!;
    expect(target, "the fixture draws no label '5' — it proves nothing").toBeDefined();
    // Centre the note on that label, in the plot fractions a text annotation is stored in.
    const note: Annotation = {
      id: "n", kind: "text", label: "a long note here",
      x: ((target.x1 + target.x2) / 2 - bare.plot.x) / bare.plot.width,
      y: ((target.y1 + target.y2) / 2 + 4 - bare.plot.y) / bare.plot.height,
    } as Annotation;
    const s = build([note]);
    const [noteBox] = textNoteObstacles(s, measure);
    expect(noteBox, "the note is not in the drawing").toBeDefined();
    expect(overlaps(labelBoxes(bare).find((l) => l.t === "5")!, noteBox!), "the note does not cover the label's old spot — it proves nothing").toBe(true);
    for (const l of labelBoxes(s)) expect(overlaps(l, noteBox!), `"${l.t}" is printed on the note`).toBe(false);
  });

  it("a turned note keeps the box that holds it", () => {
    const s = build([{ id: "n", kind: "text", label: "turned", x: 0.5, y: 0.5, rotation: 90 } as Annotation]);
    const [b] = textNoteObstacles(s, measure);
    expect(b!.y2 - b!.y1, "a note turned upright is taller than it is wide").toBeGreaterThan(b!.x2 - b!.x1);
  });
});
