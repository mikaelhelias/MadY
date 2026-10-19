/**
 * An axis left on automatic goes logarithmic when its data are all positive and span two decades (the classic dose axis).
 * A pinned lower bound of 0 (or below) says the reader wants the axis to start at zero, which a log axis cannot do, so
 * a pinned bound at or below zero keeps an automatic axis linear, so the axis starts where it is pinned.
 * A scale chosen by hand is never overridden.
 */
import { describe, expect, it } from "vitest";
import type { DataTable, Plot } from "@mady/core";
import { buildPlotScene } from "./buildScene";
import { suggestScale } from "./scale";

describe("suggestScale with a pinned lower bound", () => {
  const wide = [0.05, 0.1, 0.2, 0.4, 0.8, 1.6, 3.2, 6.4];
  it("a bound at or below zero keeps the axis linear", () => {
    expect(suggestScale(wide)).toBe("log10");
    expect(suggestScale(wide, 0)).toBe("linear");
    expect(suggestScale(wide, -5)).toBe("linear");
  });
  it("a positive bound, or none, leaves the choice to the data", () => {
    expect(suggestScale(wide, 0.01)).toBe("log10");
    expect(suggestScale(wide, undefined)).toBe("log10");
  });
});

function xy(extra: Partial<Plot> = {}, ys = [0.05, 0.1, 0.2, 0.4, 0.8, 1.6, 3.2, 6.4]) {
  const table = {
    id: "t", kind: "xy", name: "t",
    columns: [{ id: "x", name: "S", role: "x" }, { id: "y", name: "v", role: "y" }],
    rows: ys.map((v, i) => ({ id: `r${i}`, cells: { x: ys[i], y: 12 * v / (0.45 + v) } })),
  } as unknown as DataTable;
  const plot = { id: "p", name: "p", source: "t", status: "ok", styleOverrides: {}, kind: "xy", ...extra } as unknown as Plot;
  return buildPlotScene(table, plot, { width: 640, height: 440 });
}

describe("an automatic axis with a pinned zero", () => {
  it("x data over two decades, X minimum pinned at 0: linear, starting at 0", () => {
    expect(xy().x.type, "the unpinned axis is not log — the fixture proves nothing").toBe("log10");
    const s = xy({ xAxis: { min: 0 } } as Partial<Plot>);
    expect(s.x.type).toBe("linear");
    expect(s.x.domain[0]).toBe(0);
  });

  it("the same on Y", () => {
    const ys = [0.05, 0.1, 0.2, 0.4, 0.8, 1.6, 3.2, 6.4];
    const table = {
      id: "t", kind: "xy", name: "t",
      columns: [{ id: "x", name: "x", role: "x" }, { id: "y", name: "v", role: "y" }],
      rows: ys.map((v, i) => ({ id: `r${i}`, cells: { x: i, y: v } })),
    } as unknown as DataTable;
    const build = (extra: Partial<Plot>) => buildPlotScene(table, { id: "p", name: "p", source: "t", status: "ok", styleOverrides: {}, kind: "xy", ...extra } as unknown as Plot, { width: 640, height: 440 });
    expect(build({}).y.type).toBe("log10");
    const s = build({ yAxis: { min: 0 } } as Partial<Plot>);
    expect(s.y.type).toBe("linear");
    expect(s.y.domain[0]).toBe(0);
  });

  it("a positive pinned minimum still lets the data choose log", () => {
    expect(xy({ xAxis: { min: 0.01 } } as Partial<Plot>).x.type).toBe("log10");
  });

  it("a pinned maximum alone does not stop the data choosing log", () => {
    expect(xy({ xAxis: { max: 10 } } as Partial<Plot>).x.type).toBe("log10");
  });

  it("a log scale chosen by hand stays log whatever else is pinned", () => {
    expect(xy({ xAxis: { scale: "log10", min: 0 } } as Partial<Plot>).x.type).toBe("log10");
  });
});
