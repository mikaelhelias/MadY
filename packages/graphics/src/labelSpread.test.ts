// Value labels printed over the dots of one row must not print over each other. Labels sit centred above their dot,
// so two close values collide; the left value's label then ends at its dot and the right value's starts at its dot.
import { describe, expect, it } from "vitest";
import type { DataTable, Plot } from "@mady/core";
import { buildPlotScene } from "./buildScene";
import { spreadRowLabels, type Spread, type SpreadItem } from "./labelSpread";

type Box = { x0: number; x1: number; y: number };
/** The horizontal extent of a label drawn as the renderer draws it, and its line (0 = the usual line above the dot). */
function boxOf(item: SpreadItem, s: Spread): Box {
  const left = s.anchor === "end" ? item.x + s.dx - item.w : s.anchor === "start" ? item.x + s.dx : item.x + s.dx - item.w / 2;
  return { x0: left, x1: left + item.w, y: s.dy };
}
const clash = (a: Box, b: Box, lineH: number): boolean => Math.abs(a.y - b.y) < lineH && a.x0 < b.x1 && b.x0 < a.x1;
const GAP = 4;
const LINE = 12;

describe("spreadRowLabels", () => {
  it("leaves labels that do not collide exactly where they were: centred, no shift", () => {
    const out = spreadRowLabels([{ x: 100, w: 30, r: 6 }, { x: 200, w: 30, r: 6 }], GAP, LINE);
    expect(out).toEqual([{ anchor: "middle", dx: 0, dy: 0 }, { anchor: "middle", dx: 0, dy: 0 }]);
  });

  it("two close labels: the left one ends at its dot, the right one starts at its dot, and they no longer meet", () => {
    const items = [{ x: 100, w: 30, r: 6 }, { x: 110, w: 30, r: 6 }];
    const out = spreadRowLabels(items, GAP, LINE);
    expect(out[0]!.anchor).toBe("end");
    expect(out[1]!.anchor).toBe("start");
    expect(clash(boxOf(items[0]!, out[0]!), boxOf(items[1]!, out[1]!), LINE)).toBe(false);
  });

  it("each label stays beside its own dot, not further than a dot's radius past its centre", () => {
    const items = [{ x: 100, w: 30, r: 6 }, { x: 108, w: 30, r: 6 }];
    const [a, b] = spreadRowLabels(items, GAP, LINE);
    expect(a!.dx).toBeLessThanOrEqual(items[0]!.r);
    expect(b!.dx).toBeGreaterThanOrEqual(-items[1]!.r);
  });

  it("two dots on exactly the same value: the labels sit side by side over the one dot", () => {
    const items = [{ x: 150, w: 28, r: 6 }, { x: 150, w: 28, r: 6 }];
    const out = spreadRowLabels(items, GAP, LINE);
    expect(clash(boxOf(items[0]!, out[0]!), boxOf(items[1]!, out[1]!), LINE)).toBe(false);
  });

  it("does not depend on the order the items are given in: the smaller x is always the one that goes left", () => {
    const items = [{ x: 110, w: 30, r: 6 }, { x: 100, w: 30, r: 6 }];
    const out = spreadRowLabels(items, GAP, LINE);
    expect(out[0]!.anchor).toBe("start"); // x = 110, the right-hand dot
    expect(out[1]!.anchor).toBe("end");
  });

  it("a mark with no label takes no part", () => {
    const out = spreadRowLabels([{ x: 100, w: 0, r: 6 }, { x: 102, w: 30, r: 6 }], GAP, LINE);
    expect(out.map((s) => s.anchor)).toEqual(["middle", "middle"]);
  });

  it("three close labels: the outer two go outward and the one between is raised a line, so no two meet", () => {
    const items = [{ x: 100, w: 30, r: 6 }, { x: 108, w: 30, r: 6 }, { x: 116, w: 30, r: 6 }];
    const out = spreadRowLabels(items, GAP, LINE);
    expect([out[0]!.anchor, out[2]!.anchor]).toEqual(["end", "start"]);
    expect(out[1]!.dy).toBeLessThan(0);
    for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++) expect(clash(boxOf(items[i]!, out[i]!), boxOf(items[j]!, out[j]!), LINE), `${i} vs ${j}`).toBe(false);
  });

  it("only the colliding pair moves: a third label far away stays put", () => {
    const out = spreadRowLabels([{ x: 100, w: 30, r: 6 }, { x: 106, w: 30, r: 6 }, { x: 400, w: 30, r: 6 }], GAP, LINE);
    expect(out[2]).toEqual({ anchor: "middle", dx: 0, dy: 0 });
  });
});

describe("paired dot value labels on a drawn chart", () => {
  const rows: Array<[string, number, number]> = [["A", 48.4, 47.5], ["B", 49.0, 55.1], ["C", 53.2, 52.8], ["D", 61.7, 62.9], ["E", 60.9, 60.0], ["F", 50.4, 59.8]];
  const table: DataTable = {
    id: "pd", kind: "column", name: "Schools",
    columns: [{ id: "n", name: "School", role: "x" }, { id: "b", name: "Before", role: "y" }, { id: "a", name: "After", role: "y" }],
    rows: rows.map(([n, b, a], i) => ({ id: `r${i}`, cells: { n, b, a } })),
  };
  const plotOf = (extra?: Partial<Plot>): Plot => ({ id: "p", name: "P", source: "pd", status: "ok", styleOverrides: {}, kind: "paireddot", figureWidth: 640, figureHeight: 480, paireddot: { showValues: true, connector: "dumbbell" }, ...extra });
  const scene = (extra?: Partial<Plot>) => buildPlotScene(table, plotOf(extra), { width: 640, height: 480 });
  const px = (s: ReturnType<typeof scene>) => s.fonts.valueLabel.size;

  it("no two value labels of a row overlap, close values or not", () => {
    const s = scene();
    const size = px(s);
    for (const r of s.paireddot!.rows) {
      const items = r.marks.map((m) => ({ item: { x: m.cx, w: m.label.length * size * 0.6, r: m.size ?? s.paireddot!.dotSize }, m }));
      const boxes = items.map(({ item, m }) => boxOf(item, { anchor: m.labelAnchor ?? "middle", dx: m.labelDx ?? 0, dy: m.labelDy ?? 0 }));
      for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) expect(clash(boxes[i]!, boxes[j]!, size), `row ${r.label}`).toBe(false);
    }
  });

  it("rows whose values are far apart keep their labels centred: no anchor, no shift", () => {
    const s = scene();
    const far = s.paireddot!.rows.find((r) => r.label === "B")!;
    for (const m of far.marks) {
      expect(m.labelAnchor).toBeUndefined();
      expect(m.labelDx).toBeUndefined();
      expect(m.labelDy).toBeUndefined();
    }
  });

  it("a row whose values are close is spread", () => {
    const s = scene();
    const close = s.paireddot!.rows.find((r) => r.label === "C")!;
    expect(close.marks.some((m) => m.labelAnchor !== undefined)).toBe(true);
  });

  it("a label the user has dragged keeps its place in the spread: the nudge is added to it, so a drag stays continuous", () => {
    const plain = scene().paireddot!.rows.find((r) => r.label === "C")!;
    const s = scene({ pointStyles: { "b:r2": { valueDx: 5, valueDy: -3 } } });
    const close = s.paireddot!.rows.find((r) => r.label === "C")!;
    const dragged = close.marks.find((m) => m.valueDx === 5)!;
    const before = plain.marks.find((m) => m.id === dragged.id)!;
    expect([dragged.labelAnchor, dragged.labelDx]).toEqual([before.labelAnchor, before.labelDx]);
  });
});
