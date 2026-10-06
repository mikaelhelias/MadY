import { describe, expect, it } from "vitest";
import { buildPlotScene } from "./buildScene";
import type { DataTable, Plot, PlotKind } from "@mady/core";

/**
 * `PlotScene.valueAxis` must agree with how the chart is actually drawn, because the
 * renderer inverts a bracket drag through it: get it wrong and dragging a bracket's height
 * on a horizontal chart moves it along the category axis instead.
 *
 * This is deliberately not written against `isTransposedPlot`. That helper covers only
 * bar, box, violin, scatter and floating bar, and reports `false` for lollipop, which manages its own
 * orientation: the lollipop builder defaults `barOrientation` to "horizontal" and draws
 * transposed — so a test derived from the helper would expect the wrong value axis.
 * Instead the expectation is read off the built pixels: on a transposed chart the value
 * axis is the one whose ticks march along X.
 */
const cat: DataTable = {
  id: "t", kind: "column", name: "T",
  columns: [
    { id: "c", name: "G", role: "x" },
    { id: "a", name: "A", role: "y" },
    { id: "b", name: "B", role: "y" },
  ],
  rows: [
    { id: "r1", cells: { c: "one", a: 5, b: 8 } },
    { id: "r2", cells: { c: "two", a: 9, b: 4 } },
    { id: "r3", cells: { c: "three", a: 6, b: 7 } },
  ],
};

const build = (kind: PlotKind, patch: Record<string, unknown> = {}) =>
  buildPlotScene(cat, { id: "p", name: "P", source: "t", status: "ok", styleOverrides: {}, kind, ...patch } as unknown as Plot, { width: 520, height: 360 });

/** The kinds that draw their values along X. */
const VALUE_ON_X: [PlotKind, Record<string, unknown>][] = [
  ["lollipop", {}], // defaults to horizontal — a case isTransposedPlot does not cover
  ["paireddot", {}],
  ["forest", {}],
  ["pyramid", {}],
  ["bar", { barOrientation: "horizontal" }],
  ["box", { barOrientation: "horizontal" }],
];

const VALUE_ON_Y: [PlotKind, Record<string, unknown>][] = [
  ["bar", {}],
  ["box", {}],
  ["violin", {}],
  ["lollipop", { barOrientation: "vertical" }],
];

describe("PlotScene.valueAxis matches how the chart is really drawn", () => {
  for (const [kind, patch] of VALUE_ON_X) {
    it(`${kind}${Object.keys(patch).length ? " (horizontal)" : ""}: values run along X`, () => {
      expect(build(kind, patch).valueAxis).toBe("x");
    });
  }

  for (const [kind, patch] of VALUE_ON_Y) {
    it(`${kind}${Object.keys(patch).length ? " (vertical)" : ""}: values run along Y`, () => {
      const s = build(kind, patch);
      expect(s.valueAxis ?? "y").toBe("y");
    });
  }

  it("a bracket's bar runs along the category axis, whichever way the chart is drawn", () => {
    // The independent check: on a value-on-Y chart the bracket's long run is horizontal;
    // transposed, it is vertical. Read off the emitted path, not off any flag.
    const span = (kind: PlotKind, patch: Record<string, unknown>) => {
      const s = build(kind, { ...patch, annotations: [{ id: "b", kind: "bracket", from: 1, to: 3, bracketY: 7, p: 0.01 }] });
      const a = s.annotations.find((x) => x.kind === "bracket");
      const nums = [...(a?.path ?? "").matchAll(/(-?[\d.]+),(-?[\d.]+)/g)].map((m) => [Number(m[1]), Number(m[2])] as const);
      const xs = nums.map((n) => n[0]);
      const ys = nums.map((n) => n[1]);
      return { dx: Math.max(...xs) - Math.min(...xs), dy: Math.max(...ys) - Math.min(...ys) };
    };
    const vertical = span("bar", {});
    expect(vertical.dx).toBeGreaterThan(vertical.dy); // runs across the categories on X

    const horizontal = span("bar", { barOrientation: "horizontal" });
    expect(horizontal.dy).toBeGreaterThan(horizontal.dx); // categories band down Y
  });
});
