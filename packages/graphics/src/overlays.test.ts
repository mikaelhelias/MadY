// A plot draws a series from another datasheet.
// `buildPlotScene(table, plot, { tables })`: the lookup lets the choke point join `plot.overlays`
// into the table before any builder runs, so the foreign column is an ordinary series downstream
// (Render-as, Y2, legend, click routes all apply). Without a lookup nothing changes.
import { describe, expect, it } from "vitest";
import type { DataTable, Plot } from "@mady/core";
import { buildPlotScene } from "./buildScene";

const SIZE = { width: 640, height: 460 };
const a: DataTable = {
  id: "A", kind: "xy", name: "Measured",
  columns: [{ id: "ax", name: "Dose", role: "x" }, { id: "ay", name: "Response", role: "y" }],
  rows: [
    { id: "a1", cells: { ax: 1, ay: 10 } },
    { id: "a2", cells: { ax: 2, ay: 20 } },
    { id: "a3", cells: { ax: 3, ay: 30 } },
  ],
};
const b: DataTable = {
  id: "B", kind: "xy", name: "Model",
  columns: [{ id: "bx", name: "Dose", role: "x" }, { id: "by", name: "Fit", role: "y" }],
  rows: [
    { id: "b1", cells: { bx: 1, by: 12 } },
    { id: "b2", cells: { bx: 2, by: 19 } },
    { id: "b3", cells: { bx: 3, by: 31 } },
    { id: "b4", cells: { bx: 4, by: 40 } },
  ],
};
const tables = (id: string): DataTable | undefined => ({ A: a, B: b })[id];
const plot = (over: Partial<Plot> = {}): Plot =>
  ({ id: "p", name: "P", source: "A", kind: "xy", overlays: [{ id: "o1", table: "B", column: "by" }], ...over }) as Plot;

describe("overlays at the build choke point", () => {
  it("with a table lookup the foreign column is drawn as a second series, marked with where it came from", () => {
    const scene = buildPlotScene(a, plot(), SIZE ? { ...SIZE, tables } : {});
    expect(scene.series.map((s) => s.id)).toEqual(["ay", "by"]);
    const fit = scene.series.find((s) => s.id === "by")!;
    expect(fit.name).toBe("Fit");
    expect(fit.from).toEqual({ table: "B", name: "Model" });
    expect(scene.series.find((s) => s.id === "ay")!.from).toBeUndefined();
    // four foreign points, incl. x=4 which the local sheet does not have
    expect(fit.marks.filter((m) => Number.isFinite(m.cy))).toHaveLength(4);
    expect(scene.x.domain[1]).toBeGreaterThanOrEqual(4);
    expect(scene.warnings).toEqual([]);
  });

  it("the foreign series honours its own seriesStyles: Render-as line only, on the right axis", () => {
    const scene = buildPlotScene(a, plot({ seriesStyles: { by: { plotAs: "line", axis: "y2", color: "#ab12cd" } } }), { ...SIZE, tables });
    const fit = scene.series.find((s) => s.id === "by")!;
    expect(fit.symbol).toBe("none");
    expect(fit.color).toBe("#ab12cd");
    expect(scene.y2).toBeDefined();
  });

  it("without a lookup the plot draws only its own sheet's series", () => {
    const scene = buildPlotScene(a, plot(), SIZE);
    expect(scene.series.map((s) => s.id)).toEqual(["ay"]);
    expect(scene.warnings).toEqual([]);
  });

  it("a dangling reference reaches the scene's warnings — never a throw, never silence", () => {
    const scene = buildPlotScene(a, plot({ overlays: [{ id: "o1", table: "GONE", column: "by" }] }), { ...SIZE, tables });
    expect(scene.series.map((s) => s.id)).toEqual(["ay"]);
    expect(scene.warnings.some((w) => /another datasheet/i.test(w))).toBe(true);
  });

  it("bars: joined by category label, the foreign series can ride the composite path (line over bars)", () => {
    const bars: DataTable = {
      id: "A", kind: "grouped", name: "Counts",
      columns: [{ id: "ax", name: "Site", role: "x" }, { id: "ay", name: "Cases", role: "y" }],
      rows: [{ id: "a1", cells: { ax: "North", ay: 12 } }, { id: "a2", cells: { ax: "South", ay: 30 } }, { id: "a3", cells: { ax: "East", ay: 22 } }],
    };
    const rates: DataTable = {
      id: "B", kind: "grouped", name: "Rates",
      columns: [{ id: "bx", name: "Site", role: "x" }, { id: "by", name: "Rate %", role: "y" }],
      rows: [{ id: "b1", cells: { bx: "South", by: 4 } }, { id: "b2", cells: { bx: "North", by: 2 } }, { id: "b3", cells: { bx: "West", by: 9 } }],
    };
    const lk = (id: string): DataTable | undefined => ({ A: bars, B: rates })[id];
    const p = plot({ kind: "bar", seriesStyles: { by: { plotAs: "line", axis: "y2" } } });
    const scene = buildPlotScene(bars, p, { ...SIZE, tables: lk });
    const rate = scene.series.find((s) => s.id === "by")!;
    expect(rate.overlayLine ?? "").toMatch(/^M/);
    expect(rate.marks.every((m) => m.bar === undefined)).toBe(true);
    // North=2, South=4, East missing → 2 finite line points; "West" skipped and named
    expect(rate.marks.filter((m) => Number.isFinite(m.cy))).toHaveLength(2);
    expect(scene.warnings.some((w) => /West/.test(w))).toBe(true);
    expect(scene.x.ticks.filter((t) => !t.minor).map((t) => t.label)).toEqual(["North", "South", "East"]);
  });
});
