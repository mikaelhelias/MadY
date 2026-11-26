/**
 * Real data — end-to-end proof that every error/spread type is both computed and
 * plotted at the right values, and that a pre-computed summary entry reproduces the raw
 * result exactly.
 *
 * The oracle is an independent reimplementation of the standard formulas (the crosscheck
 * pattern) — it does not call `summarize`/`errorPoint`/`boxStats`, so agreement confirms
 * the data→builder→geometry wiring (right column, right centre, right interval), not just
 * that the code equals itself. Formula-level validation vs external references lives in
 * `stats.test.ts` + `engines/py/crosscheck.py`; this file proves the plotting.
 */
import { describe, it, expect } from "vitest";
import type { DataTable, ErrorBarType, Plot } from "@mady/core";
import { boxStats } from "@mady/core";
import { buildPlotScene } from "./buildScene.js";

const DATA = [2, 4, 4, 4, 5, 5, 7, 9];

/** Independent reimplementation of the summary statistics (separate from stats.ts). */
function oracle(vals: number[]) {
  const n = vals.length;
  const mean = vals.reduce((a, b) => a + b, 0) / n;
  const ssd = vals.reduce((a, b) => a + (b - mean) ** 2, 0);
  const sd = Math.sqrt(ssd / (n - 1));
  const sem = sd / Math.sqrt(n);
  const t7 = 2.364624251; // t(0.975, df=7), standard table (the one literal borrowed)
  const ci = t7 * sem;
  const s = [...vals].sort((a, b) => a - b);
  const q = (p: number): number => {
    const idx = (n - 1) * p;
    const lo = Math.floor(idx);
    const hi = Math.ceil(idx);
    return lo === hi ? s[lo]! : s[lo]! * (hi - idx) + s[hi]! * (idx - lo);
  };
  const lns = vals.map((v) => Math.log(v));
  const mLn = lns.reduce((a, b) => a + b, 0) / n;
  const geoMean = Math.exp(mLn);
  const geoFactor = Math.exp(Math.sqrt(lns.reduce((a, b) => a + (b - mLn) ** 2, 0) / (n - 1)));
  return { n, mean, sd, sem, ci, min: s[0]!, max: s[n - 1]!, median: q(0.5), q1: q(0.25), q3: q(0.75), geoMean, geoFactor };
}
const O = oracle(DATA);

describe("real data — the oracle matches hand-computed values", () => {
  it("[2,4,4,4,5,5,7,9]: mean 5 · SD √(32/7) · median 4.5 · Q1 4 · Q3 5.5 · min 2 · max 9", () => {
    expect(O.mean).toBe(5);
    expect(O.sd).toBeCloseTo(Math.sqrt(32 / 7), 12);
    expect(O.sd).toBeCloseTo(2.138090, 5);
    expect(O.sem).toBeCloseTo(2.138090 / Math.sqrt(8), 6);
    expect(O.ci).toBeCloseTo(1.78749, 4); // t(0.975,7)=2.364624 × SEM 0.755929
    expect(O.median).toBe(4.5);
    expect(O.q1).toBe(4);
    expect(O.q3).toBe(5.5);
    expect(O.min).toBe(2);
    expect(O.max).toBe(9);
    expect(O.geoMean).toBeCloseTo(4.60326, 4);
  });
});

// ── error-bar family: XY with the 8 values as replicate subcolumns of ONE row ──
function xyReplicates(vals: number[]): DataTable {
  return {
    id: "t", kind: "xy", name: "T",
    columns: [
      { id: "x", name: "X", role: "x" },
      { id: "y1", name: "Y", role: "y" },
      ...vals.slice(1).map((_, i) => ({ id: `y${i + 2}`, name: `Y${i + 2}`, role: "y" as const, group: "y1" })),
    ],
    rows: [{ id: "r0", cells: { x: 1, ...Object.fromEntries(vals.map((v, i) => [`y${i + 1}`, v])) } }],
  };
}
const xyPlot = (type: ErrorBarType, lead = "y1"): Plot => ({ id: "p", name: "P", source: "t", status: "ok", styleOverrides: {}, kind: "xy", seriesStyles: { [lead]: { errorBars: type } } });
const markFor = (t: DataTable, type: ErrorBarType, lead = "y1") => buildPlotScene(t, xyPlot(type, lead), {}).series[0]!.marks[0]!;

describe("real data — error-bar family plots each type at the oracle values (raw replicates)", () => {
  const t = xyReplicates(DATA);
  it("SD: centre = mean, reach = mean ± SD", () => {
    const m = markFor(t, "sd");
    expect(m.dy).toBeCloseTo(O.mean, 6);
    expect(m.errLow).toBeCloseTo(O.mean - O.sd, 4);
    expect(m.errHigh).toBeCloseTo(O.mean + O.sd, 4);
  });
  it("SEM: mean ± SEM", () => {
    const m = markFor(t, "sem");
    expect(m.errLow).toBeCloseTo(O.mean - O.sem, 4);
    expect(m.errHigh).toBeCloseTo(O.mean + O.sem, 4);
  });
  it("95% CI: mean ± t(0.975, n−1)·SEM", () => {
    const m = markFor(t, "ci95");
    expect(m.errLow).toBeCloseTo(O.mean - O.ci, 3);
    expect(m.errHigh).toBeCloseTo(O.mean + O.ci, 3);
  });
  it("range: min..max, still centred on the mean", () => {
    const m = markFor(t, "range");
    expect(m.dy).toBeCloseTo(O.mean, 6);
    expect(m.errLow).toBeCloseTo(O.min, 6);
    expect(m.errHigh).toBeCloseTo(O.max, 6);
  });
  it("geometric SD: centre = geoMean, reach = geoMean ×/÷ factor", () => {
    const m = markFor(t, "geoSd");
    expect(m.dy).toBeCloseTo(O.geoMean, 3);
    expect(m.errLow).toBeCloseTo(O.geoMean / O.geoFactor, 3);
    expect(m.errHigh).toBeCloseTo(O.geoMean * O.geoFactor, 3);
  });
  it("IQR: centre = MEDIAN, reach = Q1..Q3 (never centred on the mean)", () => {
    const m = markFor(t, "iqr");
    expect(m.dy).toBeCloseTo(O.median, 6);
    expect(m.errLow).toBeCloseTo(O.q1, 6);
    expect(m.errHigh).toBeCloseTo(O.q3, 6);
  });
});

describe("real data — the bar builder (separate code path) plots the same error", () => {
  // Bars go through buildCategoricalScene, not buildPlotSceneInner — verify it independently.
  const barTable: DataTable = {
    id: "t", kind: "column", name: "T",
    columns: [
      { id: "g", name: "", role: "x" },
      { id: "y1", name: "Y", role: "y" },
      ...DATA.slice(1).map((_, i) => ({ id: `y${i + 2}`, name: `Y${i + 2}`, role: "y" as const, group: "y1" })),
    ],
    rows: [{ id: "r0", cells: { g: "A", ...Object.fromEntries(DATA.map((v, i) => [`y${i + 1}`, v])) } }],
  };
  const barMark = (type: ErrorBarType) =>
    buildPlotScene(barTable, { id: "p", name: "P", source: "t", status: "ok", styleOverrides: {}, kind: "bar", seriesStyles: { y1: { errorBars: type } } }, {}).series[0]!.marks[0]!;

  it("SD on a bar: reach = mean ± SD (same as the XY path)", () => {
    const m = barMark("sd");
    expect(m.errLow).toBeCloseTo(O.mean - O.sd, 4);
    expect(m.errHigh).toBeCloseTo(O.mean + O.sd, 4);
  });
  it("IQR on a bar: reach = Q1..Q3", () => {
    const m = barMark("iqr");
    expect(m.errLow).toBeCloseTo(O.q1, 6);
    expect(m.errHigh).toBeCloseTo(O.q3, 6);
  });
});

describe("real data — a summary entry reproduces the raw error bar EXACTLY", () => {
  // Mean + SD + N entered with the same summary the raw data yields.
  const summaryTable: DataTable = {
    id: "t", kind: "xy", name: "T",
    columns: [
      { id: "x", name: "X", role: "x" },
      { id: "m", name: "Y", role: "y" },
      { id: "sd", name: "SD", role: "sd", group: "m" },
      { id: "nn", name: "N", role: "n", group: "m" },
    ],
    rows: [{ id: "r0", cells: { x: 1, m: O.mean, sd: O.sd, nn: O.n } }],
  };
  const raw = xyReplicates(DATA);
  for (const type of ["sd", "sem", "ci95"] as ErrorBarType[]) {
    it(`${type}: the mean+SD+N entry reproduces the raw replicate error bar`, () => {
      const r = markFor(raw, type);
      const sMark = buildPlotScene(summaryTable, xyPlot(type, "m"), {}).series[0]!.marks[0]!;
      expect(sMark.dy).toBeCloseTo(r.dy!, 6);
      expect(sMark.errLow).toBeCloseTo(r.errLow!, 6);
      expect(sMark.errHigh).toBeCloseTo(r.errHigh!, 6);
    });
  }
});

describe("real data — box: computed quartiles + a Box-values entry plots the same box", () => {
  it("boxStats computes the type-7 quartiles (median 4.5 · Q1 4 · Q3 5.5 · whiskers 2..9)", () => {
    const b = boxStats(DATA, "minmax");
    expect(b.median).toBe(O.median);
    expect(b.q1).toBe(O.q1);
    expect(b.q3).toBe(O.q3);
    expect(b.whiskerLow).toBe(O.min);
    expect(b.whiskerHigh).toBe(O.max);
  });

  // Invert a box mark's pixels back to data values using the scene's own domain + rect,
  // so we check what is actually drawn, not just what boxStats returns.
  const rawBox: DataTable = {
    id: "t", kind: "column", name: "T",
    columns: [{ id: "g", name: "", role: "x" }, { id: "y", name: "G", role: "y" }],
    rows: DATA.map((v, i) => ({ id: `r${i}`, cells: { g: "A", y: v } })),
  };
  const boxValues: DataTable = {
    id: "t", kind: "column", name: "T",
    columns: [
      { id: "g", name: "", role: "x" },
      { id: "med", name: "G", role: "y" },
      { id: "mn", name: "Min", role: "min", group: "med" },
      { id: "q1", name: "Q1", role: "q1", group: "med" },
      { id: "q3", name: "Q3", role: "q3", group: "med" },
      { id: "mx", name: "Max", role: "max", group: "med" },
    ],
    rows: [{ id: "r0", cells: { g: "A", med: O.median, mn: O.min, q1: O.q1, q3: O.q3, mx: O.max } }],
  };
  const boxPlot: Plot = { id: "p", name: "P", source: "t", status: "ok", styleOverrides: {}, kind: "box", boxWhisker: "minmax" };
  const plottedBox = (t: DataTable) => {
    const s = buildPlotScene(t, boxPlot, { yDomain: [0, 10] });
    const box = s.series[0]!.marks[0]!.box!;
    const [dmin, dmax] = s.y.domain;
    const rect = s.plot;
    const inv = (px: number): number => dmax - ((px - rect.y) / rect.height) * (dmax - dmin);
    return { median: inv(box.median!), q1: inv(box.q1), q3: inv(box.q3), lo: inv(box.whiskerLow), hi: inv(box.whiskerHigh) };
  };

  it("the RAW data draws the box at median 4.5 · Q1 4 · Q3 5.5 · whiskers 2..9", () => {
    const p = plottedBox(rawBox);
    expect(p.median).toBeCloseTo(4.5, 4);
    expect(p.q1).toBeCloseTo(4, 4);
    expect(p.q3).toBeCloseTo(5.5, 4);
    expect(p.lo).toBeCloseTo(2, 4);
    expect(p.hi).toBeCloseTo(9, 4);
  });
  it("a Box-values entry draws the IDENTICAL box (same plotted values)", () => {
    const r = plottedBox(rawBox);
    const v = plottedBox(boxValues);
    expect(v.median).toBeCloseTo(r.median, 6);
    expect(v.q1).toBeCloseTo(r.q1, 6);
    expect(v.q3).toBeCloseTo(r.q3, 6);
    expect(v.lo).toBeCloseTo(r.lo, 6);
    expect(v.hi).toBeCloseTo(r.hi, 6);
  });
});
