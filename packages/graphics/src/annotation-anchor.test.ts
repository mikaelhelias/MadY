// Pin an annotation to a data value. A text's point, or a callout / arrow / line's end,
// can carry axis values (`anchorX` / `anchorY`) instead of a place on the plot; it then follows the data when the axis
// range changes. It goes through the same value->pixel route a reference line takes, so the oracle for "where" is a
// reference line at the same value on the same chart. A category axis cannot take a value: the point keeps its plot
// position and a warning says so. On horizontal bars the value axis is X, so `anchorY` moves the point sideways.
import { describe, expect, it } from "vitest";
import type { Annotation, DataTable, Plot } from "@mady/core";
import type { AnnotationScene, PlotScene } from "./scene";
import { buildPlotScene } from "./buildScene";

const SIZE = { width: 640, height: 460 };
const xyT: DataTable = {
  id: "t", kind: "xy", name: "T",
  columns: [{ id: "x", name: "X", role: "x" }, { id: "y", name: "Y", role: "y" }],
  rows: [1, 2, 3, 4, 5, 6, 7, 8].map((v, i) => ({ id: `r${i}`, cells: { x: v, y: v * v } })),
};
const colT: DataTable = {
  id: "c", kind: "column", name: "C",
  columns: [{ id: "g", name: "Group", role: "x" }, { id: "v", name: "Value", role: "y" }],
  rows: [{ id: "r1", cells: { g: "A", v: 2 } }, { id: "r2", cells: { g: "B", v: 6 } }, { id: "r3", cells: { g: "C", v: 10 } }],
};
const xy = (anns: Annotation[], over: Partial<Plot> = {}): PlotScene =>
  buildPlotScene(xyT, { id: "p", name: "P", source: "t", status: "ok", styleOverrides: {}, kind: "xy", annotations: anns, ...over } as Plot, SIZE);
const bar = (anns: Annotation[], over: Partial<Plot> = {}): PlotScene =>
  buildPlotScene(colT, { id: "p", name: "P", source: "c", kind: "bar", annotations: anns, ...over } as Plot, SIZE);
const ann = (s: PlotScene, id: string): AnnotationScene => s.annotations.find((a) => a.id === id)!;

describe("a point pinned to data values", () => {
  it("a text's point sits where reference lines at the same values sit", () => {
    const s = xy([
      { id: "t", kind: "text", label: "peak", anchorX: 5, anchorY: 30 } as Annotation,
      { id: "v", kind: "vline", value: 5 } as Annotation,
      { id: "h", kind: "hline", value: 30 } as Annotation,
    ]);
    expect(ann(s, "t").labelX).toBeCloseTo(ann(s, "v").x1!, 6);
    expect(ann(s, "t").labelY).toBeCloseTo(ann(s, "h").y1!, 6);
    expect(ann(s, "t").anchored).toBe("xy");
  });
  it("a callout's TIP and an arrow's END are pinned; their other end stays on the plot", () => {
    const s = xy([
      { id: "c", kind: "callout", label: "here", x: 0.1, y: 0.1, anchorX: 3, anchorY: 9 } as Annotation,
      { id: "a", kind: "arrow", x: 0.1, y: 0.9, anchorX: 3, anchorY: 9 } as Annotation,
      { id: "v", kind: "vline", value: 3 } as Annotation,
      { id: "h", kind: "hline", value: 9 } as Annotation,
    ]);
    for (const id of ["c", "a"]) {
      expect(ann(s, id).x2, id).toBeCloseTo(ann(s, "v").x1!, 6);
      expect(ann(s, id).y2, id).toBeCloseTo(ann(s, "h").y1!, 6);
      expect(ann(s, id).x1, id).toBeCloseTo(s.plot.x + 0.1 * s.plot.width, 6);
    }
  });
  it("raising the X axis maximum moves the pinned tip, and not a twin at a plot position", () => {
    const anns = [
      { id: "pinned", kind: "arrow", x: 0.1, y: 0.1, x2: 0.5, y2: 0.5, anchorX: 5 } as Annotation,
      { id: "free", kind: "arrow", x: 0.1, y: 0.1, x2: 0.5, y2: 0.5 } as Annotation,
    ];
    const a = xy(anns, { xAxis: { min: 0, max: 10 } } as Partial<Plot>);
    const b = xy(anns, { xAxis: { min: 0, max: 20 } } as Partial<Plot>);
    expect(ann(b, "pinned").x2!).toBeLessThan(ann(a, "pinned").x2! - 50);
    expect(ann(b, "free").x2).toBeCloseTo(ann(a, "free").x2!, 6);
  });
  it("only the pinned axis follows the data", () => {
    const s = xy([{ id: "t", kind: "text", label: "t", x: 0.25, y: 0.5, anchorY: 30 } as Annotation, { id: "h", kind: "hline", value: 30 } as Annotation]);
    expect(ann(s, "t").labelX).toBeCloseTo(s.plot.x + 0.25 * s.plot.width, 6);
    expect(ann(s, "t").labelY).toBeCloseTo(ann(s, "h").y1!, 6);
    expect(ann(s, "t").anchored).toBe("y");
  });
  it("a value off the axis is drawn at the plot's edge, with a warning", () => {
    const s = xy([{ id: "t", kind: "text", label: "t", anchorY: 1e6 } as Annotation]);
    expect(ann(s, "t").labelY).toBeCloseTo(s.plot.y, 6);
    expect(s.warnings.join(" ")).toMatch(/outside the axis range/);
  });
});

describe("where an axis cannot take a value", () => {
  it("a bar chart's category X: the point keeps its plot position, still drawn, with a warning; Y still pins", () => {
    const s = bar([
      { id: "t", kind: "text", label: "t", x: 0.3, y: 0.5, anchorX: 2, anchorY: 6 } as Annotation,
      { id: "h", kind: "hline", value: 6 } as Annotation,
    ]);
    expect(ann(s, "t").labelX).toBeCloseTo(s.plot.x + 0.3 * s.plot.width, 6);
    expect(ann(s, "t").labelY).toBeCloseTo(ann(s, "h").y1!, 6);
    expect(ann(s, "t").anchored).toBe("y");
    expect(s.warnings.join(" ")).toMatch(/X axis does not take values/);
  });
  it("horizontal bars: the value runs across, so anchorY moves the point sideways", () => {
    const s = bar([
      { id: "t", kind: "text", label: "t", x: 0.3, y: 0.4, anchorY: 6 } as Annotation,
      { id: "h", kind: "hline", value: 6 } as Annotation,
    ], { barOrientation: "horizontal" } as Partial<Plot>);
    expect(ann(s, "h").x1).toBeCloseTo(ann(s, "h").x2!, 6); // the reference line is drawn upright here
    expect(ann(s, "t").labelX).toBeCloseTo(ann(s, "h").x1!, 6);
    expect(ann(s, "t").labelY).toBeCloseTo(s.plot.y + 0.4 * s.plot.height, 6);
    expect(ann(s, "t").anchored).toBe("y");
  });
});

describe("without an anchor", () => {
  it("nothing changes: no `anchored`, the plot position as always", () => {
    const s = xy([{ id: "t", kind: "text", label: "t", x: 0.25, y: 0.5 } as Annotation, { id: "a", kind: "arrow", x: 0.1, y: 0.1, x2: 0.5, y2: 0.5 } as Annotation]);
    expect(ann(s, "t")).not.toHaveProperty("anchored");
    expect(ann(s, "a")).not.toHaveProperty("anchored");
    expect(ann(s, "a").x2).toBeCloseTo(s.plot.x + 0.5 * s.plot.width, 6);
  });
});
