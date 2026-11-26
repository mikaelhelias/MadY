import { describe, expect, it } from "vitest";
import type { DataTable, Plot } from "@mady/core";
import { buildScale, makeTickLabel } from "./scale.js";
import { buildPlotScene } from "./buildScene.js";

// A log axis snaps outward to whole powers of ten. When the data span less than one decade that leaves most of
// the axis empty (estimates between 0.33 and 1.46 on 0.1–10), so it snaps to a finer grid instead and labels it.

const majors = (s: ReturnType<typeof buildScale>): number[] => s.ticks.filter((t) => !t.minor).map((t) => t.value);

describe("buildScale — a log10 axis over less than one decade", () => {
  it("snaps outward to the 1 / 1.5 / 2 / 3 / 5 / 7 grid, not to whole powers", () => {
    const s = buildScale("log10", [0.33, 1.46], [0, 100]);
    expect(s.domain[0]).toBeCloseTo(0.3, 9);
    expect(s.domain[1]).toBeCloseTo(1.5, 9);
  });

  it("labels the grid values it spans", () => {
    const s = buildScale("log10", [0.33, 1.46], [0, 100]);
    expect(majors(s).map((v) => Number(v.toPrecision(6)))).toEqual([0.3, 0.5, 0.7, 1, 1.5]);
    expect(s.ticks.filter((t) => !t.minor).map((t) => t.label)).toEqual(["0.3", "0.5", "0.7", "1", "1.5"]);
  });

  it("keeps the 2–9 minor ticks that carry no label, inside the domain", () => {
    const s = buildScale("log10", [0.33, 1.46], [0, 100]);
    const minors = s.ticks.filter((t) => t.minor).map((t) => Number(t.value.toPrecision(6)));
    expect(minors).toEqual([0.4, 0.6, 0.8, 0.9]);
    for (const t of s.ticks) expect(t.value).toBeGreaterThanOrEqual(s.domain[0] - 1e-12);
    for (const t of s.ticks) expect(t.value).toBeLessThanOrEqual(s.domain[1] + 1e-12);
  });

  it("contains the data, and places a tick at its own pixel", () => {
    const s = buildScale("log10", [2.2, 8.7], [0, 100]);
    expect(s.domain[0]).toBeLessThanOrEqual(2.2);
    expect(s.domain[1]).toBeGreaterThanOrEqual(8.7);
    for (const t of s.ticks) expect(t.pos).toBeCloseTo(s.scale(t.value), 9);
  });

  it("an axis that already sits on a grid value does not widen past it", () => {
    const s = buildScale("log10", [0.5, 2], [0, 100]);
    expect(s.domain[0]).toBeCloseTo(0.5, 9);
    expect(s.domain[1]).toBeCloseTo(2, 9);
  });

  it("a span of a decade or more still snaps to whole powers", () => {
    expect(buildScale("log10", [2, 60], [0, 100]).domain).toEqual([1, 100]);
    expect(buildScale("log10", [0.5, 5], [0, 100]).domain).toEqual([0.1, 10]);
  });

  it("a manual or zoom window (exact) is never snapped", () => {
    expect(buildScale("log10", [0.33, 1.46], [0, 100], 6, true).domain).toEqual([0.33, 1.46]);
  });

  it("other bases keep whole powers", () => {
    expect(buildScale("log2", [1.1, 1.9], [0, 100]).domain).toEqual([1, 2]);
  });
});

describe("a log tick between two powers is labelled with its own value", () => {
  it("0.5, 1.5 and 7 read as themselves", () => {
    expect(makeTickLabel(0.5, "log10", undefined)).toBe("0.5");
    expect(makeTickLabel(1.5, "log10", undefined)).toBe("1.5");
    expect(makeTickLabel(7, "log10", undefined)).toBe("7");
    expect(makeTickLabel(0.03, "log10", undefined)).toBe("0.03");
  });
  it("whole powers read as plain decimals", () => {
    expect(makeTickLabel(0.1, "log10", undefined)).toBe("0.1");
    expect(makeTickLabel(0.001, "log10", undefined)).toBe("0.001");
    expect(makeTickLabel(100, "log10", undefined)).toBe("100");
  });
});

describe("forest and funnel on a log axis fill their axis", () => {
  const studies: [string, number, number, number][] = [
    ["Adams 2012", 0.72, 0.51, 1.02], ["Baker 2013", 0.85, 0.61, 1.18], ["Cruz 2014", 0.66, 0.44, 0.99], ["Dube 2015", 0.91, 0.70, 1.19],
    ["Eklund 2016", 0.58, 0.33, 1.02], ["Fuchs 2017", 0.79, 0.62, 1.01], ["Gomez 2018", 0.70, 0.55, 0.89], ["Hale 2019", 1.04, 0.74, 1.46],
    ["Ito 2020", 0.62, 0.40, 0.96], ["Jones 2021", 0.77, 0.66, 0.90],
  ];
  const table: DataTable = {
    id: "t", kind: "meta", name: "Trials",
    columns: [{ id: "s", name: "Study", role: "x" }, { id: "e", name: "Odds ratio", role: "y" }, { id: "lo", name: "Lower", role: "y" }, { id: "hi", name: "Upper", role: "y" }],
    rows: studies.map(([s, e, lo, hi], i) => ({ id: `r${i}`, cells: { s, e, lo, hi } })),
  };
  const plot = (kind: "forest" | "funnel"): Plot => ({
    id: "p", name: "P", source: "t", status: "ok", styleOverrides: {}, kind, ...(kind === "forest" ? { forest: { showSummary: true } } : {}),
    xAxis: { scale: "log10", title: "Odds ratio" },
  });

  for (const kind of ["forest", "funnel"] as const) {
    it(`${kind}: the axis hugs the data (under 1.5 decades) and still contains every estimate and limit`, () => {
      const s = buildPlotScene(table, plot(kind), { width: 640, height: 420 });
      const [d0, d1] = s.x.domain;
      expect(d1 / d0, `${kind} domain ${d0}–${d1}`).toBeLessThan(10 ** 1.5);
      expect(d0).toBeLessThanOrEqual(0.33);
      expect(d1).toBeGreaterThanOrEqual(kind === "forest" ? 1.46 : 1.04);
    });
  }
});
