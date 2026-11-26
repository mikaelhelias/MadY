// "Only these ticks": an axis that carries the user's own ticks and none of the automatic ones.
//
// The automatic ticks fall on multiples of the step (0, 20, 40 …). A figure with ticks at 2, 18, 34 … 98, or one whose
// labels run the other way to the values, can only be drawn from the user's own ticks; with the automatic ones left in,
// both sets are drawn. Gridlines follow the ticks, so the automatic gridlines go with them.
import { describe, expect, it } from "vitest";
import type { DataTable, Plot } from "@mady/core";
import { buildPlotScene } from "./buildScene.js";
import type { AxisScene, PlotScene } from "./scene.js";

const table: DataTable = {
  id: "t", kind: "xy", name: "T",
  columns: [{ id: "x", name: "X" }, { id: "a", name: "A" }],
  rows: [0, 20, 40, 60, 80, 100].map((x, i) => ({ id: `r${i}`, cells: { x, a: 10 + i } })),
};
const SIZE = { width: 640, height: 420 };
const build = (over: Partial<Plot>): PlotScene =>
  buildPlotScene(table, { id: "p", name: "P", source: "t", status: "ok", styleOverrides: {}, kind: "xy", ...over } as Plot, SIZE);

const values = (ax: AxisScene) => ax.ticks.map((t) => t.value);
const OWN = [2, 18, 34, 50, 66, 82, 98];
const own = OWN.map((v) => ({ value: v }));

describe("Only these ticks", () => {
  it("the fixture's automatic ticks are not the user's ticks, so the option has something to remove", () => {
    const auto = values(build({}).x);
    expect(auto.length).toBeGreaterThan(3);
    expect(auto.some((v) => !OWN.includes(v))).toBe(true);
  });

  it("off: the user's ticks are added beside the automatic ones (today's behaviour)", () => {
    const s = build({ xAxis: { extraTicks: own } });
    for (const v of OWN) expect(values(s.x)).toContain(v);
    expect(values(s.x).some((v) => !OWN.includes(v)), "the automatic ticks are gone without the option").toBe(true);
  });

  it("on: the axis carries exactly the user's ticks, with their labels", () => {
    const labelled = OWN.map((v) => ({ value: v, label: String(100 - v) }));
    const s = build({ xAxis: { extraTicks: labelled, onlyExtraTicks: true } });
    expect(values(s.x).slice().sort((a, b) => a - b)).toEqual(OWN);
    expect(s.x.ticks.every((t) => !t.minor)).toBe(true);
    const byValue = new Map(s.x.ticks.map((t) => [t.value, t.label]));
    for (const v of OWN) expect(byValue.get(v)).toBe(String(100 - v));
    expect(s.warnings).toEqual([]);
  });

  it("on: minor ticks between the automatic ones go too", () => {
    const s = build({ xAxis: { extraTicks: own, onlyExtraTicks: true, minorCount: 3 } });
    expect(s.x.ticks.filter((t) => t.minor)).toEqual([]);
  });

  it("on, on Y: the same", () => {
    const s = build({ yAxis: { extraTicks: [{ value: 11 }, { value: 13 }], onlyExtraTicks: true } });
    expect(values(s.y).slice().sort((a, b) => a - b)).toEqual([11, 13]);
  });

  it("on with no ticks of the user's: the automatic ticks stay, and the scene says why", () => {
    const s = build({ xAxis: { onlyExtraTicks: true } });
    expect(values(s.x)).toEqual(values(build({}).x));
    expect(s.warnings.join(" ")).toMatch(/Only these ticks/);
  });

  it("on, with every tick of the user's outside the axis: the automatic ticks stay, and the scene says why", () => {
    const s = build({ xAxis: { extraTicks: [{ value: 5000 }], onlyExtraTicks: true } });
    expect(values(s.x)).toEqual(values(build({}).x));
    expect(s.warnings.join(" ")).toMatch(/Only these ticks/);
  });
});
