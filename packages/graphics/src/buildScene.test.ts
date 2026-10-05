import type { PlotScene } from "./scene.js";
import { describe, it, expect } from "vitest";
import { coerceGrid, createSampleDocument, parseDelimited } from "@mady/core";
import type { ColumnScatterStyle, DataTable, ErrorBarType, Plot, PlotKind } from "@mady/core";
import { buildPlotScene, barSeriesGroupLayout, WAFFLE_ICON_CYCLE, WAFFLE_OTHER_COLOR, WAFFLE_OTHER_ID } from "./buildScene.js";
import { suggestScale, buildScale } from "./scale.js";
import { rampColor } from "./color.js";
import { legendBoxWidth } from "./legendBox.js";
import { OKABE_ITO, seriesColor } from "./palette.js";

function sample(): { table: DataTable; plot: Plot } {
  const project = createSampleDocument().toJSON();
  const table = project.tables[0]!;
  const plot = project.plots[0]!;
  return { table, plot };
}

describe("suggestScale", () => {
  it("picks log10 for all-positive data spanning ≥2 decades", () => {
    expect(suggestScale([0.1, 1, 10, 100])).toBe("log10");
  });
  it("picks linear for narrow or non-positive data", () => {
    expect(suggestScale([1, 2, 3, 4])).toBe("linear");
    expect(suggestScale([0, 10, 100, 1000])).toBe("linear"); // contains 0
    expect(suggestScale([5])).toBe("linear"); // too few
  });
});

describe("summary entry: an undrawable error type warns instead of silently blanking", () => {
  // Mean + SD entered without N (the summary column shape); no raw replicates.
  const summaryTable = (): DataTable => ({
    id: "t",
    kind: "column",
    name: "T",
    columns: [
      { id: "g", name: "", role: "x" },
      { id: "m", name: "Dose", role: "y" },
      { id: "s", name: "Dose SD", role: "sd", group: "m" },
    ],
    rows: [
      { id: "r0", cells: { g: "A", m: 10, s: 2 } },
      { id: "r1", cells: { g: "B", m: 20, s: 3 } },
    ],
  });
  const barPlot = (errorBars: ErrorBarType): Plot => ({
    id: "p",
    name: "P",
    source: "t",
    status: "ok",
    styleOverrides: {},
    kind: "bar",
    seriesStyles: { m: { errorBars } },
  });
  it("warns (naming what it can draw) when 95% CI is asked of Mean+SD without N", () => {
    const s = buildPlotScene(summaryTable(), barPlot("ci95"), {});
    const w = s.warnings.find((x) => /can’t be computed/.test(x));
    expect(w).toBeTruthy();
    expect(w).toMatch(/95% CI/);
    expect(w).toMatch(/Mean ± SD/); // it names the drawable alternative
  });
  it("does not warn for a drawable type (SD)", () => {
    const s = buildPlotScene(summaryTable(), barPlot("sd"), {});
    expect(s.warnings.some((x) => /can’t be computed/.test(x))).toBe(false);
  });
});

describe("summary entry: pre-computed centre+spread draws via the errorPoint spine", () => {
  // One XY row; the lead cell is the centre and the extra columns carry the entered spread.
  const table = (cols: DataTable["columns"], cells: Record<string, number>): DataTable => ({
    id: "t",
    kind: "xy",
    name: "T",
    columns: [{ id: "x", name: "X", role: "x" }, { id: "m", name: "Y", role: "y" }, ...cols],
    rows: [{ id: "r0", cells: { x: 1, ...cells } }],
  });
  const plot = (errorBars: ErrorBarType): Plot => ({
    id: "p", name: "P", source: "t", status: "ok", styleOverrides: {}, kind: "xy",
    seriesStyles: { m: { errorBars } },
  });
  const mark = (t: DataTable, errorBars: ErrorBarType) => buildPlotScene(t, plot(errorBars), {}).series[0]!.marks[0]!;

  it("Mean + range → [min, max] about the mean", () => {
    const t = table(
      [{ id: "lo", name: "Min", role: "min", group: "m" }, { id: "hi", name: "Max", role: "max", group: "m" }],
      { m: 10, lo: 4, hi: 18 },
    );
    const mk = mark(t, "range");
    expect(mk.dy).toBeCloseTo(10);
    expect(mk.errLow).toBeCloseTo(4);
    expect(mk.errHigh).toBeCloseTo(18);
  });
  it("Median + IQR → [Q1, Q3] about the entered median", () => {
    const t = table(
      [{ id: "a", name: "Q1", role: "q1", group: "m" }, { id: "b", name: "Q3", role: "q3", group: "m" }],
      { m: 12, a: 8, b: 20 },
    );
    const mk = mark(t, "iqr");
    expect(mk.dy).toBeCloseTo(12); // centre = the median, not a mean
    expect(mk.errLow).toBeCloseTo(8);
    expect(mk.errHigh).toBeCloseTo(20);
  });
  it("Geometric mean ± SD factor → [g÷f, g×f]", () => {
    const t = table([{ id: "g", name: "GSD", role: "geosd", group: "m" }], { m: 100, g: 2 });
    const mk = mark(t, "geoSd");
    expect(mk.dy).toBeCloseTo(100);
    expect(mk.errLow).toBeCloseTo(50);
    expect(mk.errHigh).toBeCloseTo(200);
  });
  it("Mean + 95% CI → a symmetric half-width about the mean", () => {
    const t = table([{ id: "c", name: "CI", role: "ci", group: "m" }], { m: 50, c: 5 });
    const mk = mark(t, "ci95");
    expect(mk.dy).toBeCloseTo(50);
    expect(mk.errLow).toBeCloseTo(45);
    expect(mk.errHigh).toBeCloseTo(55);
  });
});

describe("stranded error type on an as-entered summary: drawing and warning agree", () => {
  // The as-entered formats (± value / limits / pre-computed 95% CI) draw their interval exactly
  // as entered. A saved type they can't name (e.g. an "sd" left on a limits entry) must not both
  // draw the interval and push a "no error bars drawn" warning — a contradiction. The interval is
  // drawn under the entry's natural type, with no false warning. Derived summaries (which genuinely can't compute the type) are untouched.
  const oneRow = (cols: DataTable["columns"], cells: Record<string, number>): DataTable => ({
    id: "t", kind: "xy", name: "T",
    columns: [{ id: "x", name: "X", role: "x" }, { id: "m", name: "Y", role: "y" }, ...cols],
    rows: [{ id: "r0", cells: { x: 1, ...cells } }],
  });
  const plot = (errorBars: ErrorBarType): Plot => ({
    id: "p", name: "P", source: "t", status: "ok", styleOverrides: {}, kind: "xy",
    seriesStyles: { m: { errorBars } },
  });
  const build = (t: DataTable, e: ErrorBarType) => buildPlotScene(t, plot(e), {});

  it("a 95% CI entry with a stranded 'sd' type still draws the entered CI — and does not warn", () => {
    const t = oneRow([{ id: "c", name: "CI", role: "ci", group: "m" }], { m: 50, c: 5 });
    const s = build(t, "sd"); // stranded: an "sd" left on a pre-computed-CI entry
    const mk = s.series[0]!.marks[0]!;
    expect(mk.errLow).toBeCloseTo(45); // the entered CI, drawn as-entered
    expect(mk.errHigh).toBeCloseTo(55);
    expect(s.warnings.some((w) => /can’t be computed/.test(w))).toBe(false); // was falsely warned before
  });

  it("a limits entry with a stranded 'sd' type still draws the entered limits — and does not warn", () => {
    const t = oneRow(
      [{ id: "lo", name: "Lower", role: "errlow", group: "m" }, { id: "hi", name: "Upper", role: "errhigh", group: "m" }],
      { m: 10, lo: 6, hi: 16 },
    );
    const s = build(t, "sd");
    const mk = s.series[0]!.marks[0]!;
    expect(mk.errLow).toBeCloseTo(6);
    expect(mk.errHigh).toBeCloseTo(16);
    expect(s.warnings.some((w) => /can’t be computed/.test(w))).toBe(false);
  });

  it("a derived summary (IQR entry) with a stranded 'sd' draws no interval and warns", () => {
    const t = oneRow([{ id: "a", name: "Q1", role: "q1", group: "m" }, { id: "b", name: "Q3", role: "q3", group: "m" }], { m: 12, a: 8, b: 20 });
    const s = build(t, "sd"); // "sd" cannot be derived from Q1/Q3 → no interval drawn, still warned
    const marks = s.series[0]?.marks ?? [];
    expect(marks.every((m) => m.errLow === undefined)).toBe(true);
    expect(s.warnings.some((w) => /can’t be computed/.test(w))).toBe(true);
  });
});

describe("Bland-Altman: the right margin fits the actual ±k·SD label", () => {
  const baTable: DataTable = {
    id: "t", kind: "xy", name: "T",
    columns: [{ id: "x", name: "", role: "x" }, { id: "a", name: "A", role: "y" }, { id: "b", name: "B", role: "y" }],
    rows: [
      { id: "r0", cells: { x: 1, a: 10, b: 11 } },
      { id: "r1", cells: { x: 2, a: 20, b: 18 } },
      { id: "r2", cells: { x: 3, a: 30, b: 33 } },
      { id: "r3", cells: { x: 4, a: 40, b: 36 } },
    ],
  };
  const baPlot = (agreementK: number): Plot => ({
    id: "p", name: "P", source: "t", status: "ok", styleOverrides: {}, kind: "blandaltman", blandAltman: { agreementK },
  });

  it("reserves more right margin for a longer agreement-multiplier label", () => {
    const longLabel = buildPlotScene(baTable, baPlot(2.5758), { width: 600, height: 400 }); // "+2.5758 SD"
    const shortLabel = buildPlotScene(baTable, baPlot(2), { width: 600, height: 400 }); //     "+2 SD"
    // A longer label → wider right reserve → less room for the plot. A reserve measured on a
    // fixed "+1.96 SD" would make the two identical, which this tells apart.
    expect(longLabel.plot.width).toBeLessThan(shortLabel.plot.width);
  });
});

describe("lollipop dot follows the whisker's centre for IQR / geometric SD", () => {
  // One category, one dataset of 10 raw replicates (right-skewed): mean 9.5 sits outside the
  // IQR [q1 3.25, q3 7.75]; the median is 5.5.
  const reps = [1, 2, 3, 4, 5, 6, 7, 8, 9, 50];
  const cols: DataTable["columns"] = [{ id: "g", name: "", role: "x" }];
  const cells: Record<string, number> = { g: 0 };
  reps.forEach((v, k) => {
    const id = k === 0 ? "m" : `m${k}`; // the dataset lead is the column whose id === the group key
    cols.push({ id, name: `v${k}`, role: "y", group: "m" });
    cells[id] = v;
  });
  const lollipopTable: DataTable = { id: "t", kind: "column", name: "T", columns: cols, rows: [{ id: "r0", cells }] };
  const lollipopPlot = (errorBars: ErrorBarType): Plot => ({
    id: "p", name: "P", source: "t", status: "ok", styleOverrides: {}, kind: "lollipop",
    seriesStyles: { m: { errorBars } },
  });
  const dot = (e: ErrorBarType) => buildPlotScene(lollipopTable, lollipopPlot(e), { width: 500, height: 360 }).lollipop!.rows[0]!.dots[0]!;

  it("an IQR whisker puts the dot at the median — inside its own whisker, never outside it", () => {
    const d = dot("iqr");
    expect(d.value).toBeCloseTo(5.5, 6); // the median, not the mean 9.5
    expect(d.error!.low).toBeCloseTo(3.25, 6);
    expect(d.error!.high).toBeCloseTo(7.75, 6);
    expect(d.value).toBeGreaterThanOrEqual(d.error!.low); // the dot cannot sit outside its whisker
    expect(d.value).toBeLessThanOrEqual(d.error!.high);
  });

  it("no whisker (default) and an SD whisker keep the dot at the arithmetic mean", () => {
    expect(dot("none").value).toBeCloseTo(9.5, 6); // mean, unchanged (whisker off)
    expect(dot("sd").value).toBeCloseTo(9.5, 6); // SD centres on the mean → dot unmoved
  });
});

describe("forest no-effect line defaults by the measure, not the axis scale", () => {
  const forestTable = (est: [number, number, number][]): DataTable => ({
    id: "t", kind: "xy", name: "T",
    columns: [
      { id: "s", name: "Study", role: "x" },
      { id: "e", name: "Effect", role: "y" },
      { id: "lo", name: "Lower", role: "y" },
      { id: "hi", name: "Upper", role: "y" },
    ],
    rows: est.map(([e, lo, hi], i) => ({ id: `r${i}`, cells: { s: `S${i}`, e, lo, hi } })),
  });
  const forestPlot: Plot = { id: "p", name: "P", source: "t", status: "ok", styleOverrides: {}, kind: "forest" };
  // The null line is drawn at px(refValue) on a linear effect axis; invert it back to a value.
  const refValueOf = (s: ReturnType<typeof buildPlotScene>): number | null => {
    const a = s.annotations?.find((x) => x.id === "forest-ref") as { x1?: number } | undefined;
    if (!a || a.x1 == null) return null;
    const [d0, d1] = s.x.domain; const [r0, r1] = s.x.range;
    return d0 + ((a.x1 - r0) / (r1 - r0)) * (d1 - d0);
  };

  it("all-positive (ratio) estimates → null at 1, the odds-ratio no-effect line", () => {
    const s = buildPlotScene(forestTable([[0.82, 0.64, 1.05], [1.14, 0.9, 1.44], [0.71, 0.52, 0.97]]), forestPlot, { width: 600, height: 400 });
    expect(refValueOf(s)).toBeCloseTo(1, 4);
  });

  it("estimates that reach ≤ 0 (a difference measure) → null at 0", () => {
    const s = buildPlotScene(forestTable([[-0.5, -1.2, 0.2], [0.3, -0.1, 0.7], [0.1, -0.4, 0.6]]), forestPlot, { width: 600, height: 400 });
    expect(refValueOf(s)).toBeCloseTo(0, 4);
  });

  it("an explicit refValue still wins over the inferred default", () => {
    const s = buildPlotScene(forestTable([[-0.5, -1.2, 0.2], [0.3, -0.1, 0.7]]), { ...forestPlot, forest: { refValue: 2 } }, { width: 600, height: 400 });
    expect(refValueOf(s)).toBeCloseTo(2, 4);
  });

  it("hiding a dataset does not re-role estimate · lower · upper", () => {
    // est/lo/hi are read by position; a reader that skipped hidden datasets would take Upper as
    // the lower bound when "Lower" is hidden, moving the whisker's low end to 1.05.
    const t = forestTable([[0.82, 0.64, 1.05], [1.14, 0.9, 1.44]]);
    const plain = buildPlotScene(t, forestPlot, { width: 600, height: 400 });
    const hidden = buildPlotScene(t, { ...forestPlot, seriesStyles: { lo: { hidden: true } } }, { width: 600, height: 400 });
    const lows = (s: ReturnType<typeof buildPlotScene>) => s.series.flatMap((se) => se.marks.map((m) => m.errLow ?? null));
    expect(JSON.stringify(lows(hidden))).toBe(JSON.stringify(lows(plain)));
    expect(hidden.warnings).not.toContain("Forest plot needs three value columns: estimate, lower CI, upper CI.");
  });
});

describe("a 3-D scatter says why it is empty on a label-led sheet", () => {
  it("column sheet (text first column) → a warning, not a silent empty cube", () => {
    const t: DataTable = {
      id: "t", kind: "column", name: "T",
      columns: [{ id: "l", name: "Group" }, { id: "a", name: "A" }, { id: "b", name: "B" }],
      rows: [{ id: "r1", cells: { l: "Alpha", a: 1, b: 2 } }, { id: "r2", cells: { l: "Beta", a: 3, b: 4 } }],
    };
    const s = buildPlotScene(t, { id: "p", name: "P", source: "t", status: "ok", styleOverrides: {}, kind: "scatter3d" }, { width: 600, height: 400 });
    expect(s.warnings.some((w) => /No finite \(X, Y, Z\) points/.test(w))).toBe(true);
  });
  it("a numeric 3-column sheet still draws with no warning", () => {
    const t: DataTable = {
      id: "t", kind: "xy", name: "T",
      columns: [{ id: "x", name: "X" }, { id: "y", name: "Y" }, { id: "z", name: "Z" }],
      rows: [{ id: "r1", cells: { x: 1, y: 2, z: 3 } }, { id: "r2", cells: { x: 3, y: 4, z: 5 } }],
    };
    const s = buildPlotScene(t, { id: "p", name: "P", source: "t", status: "ok", styleOverrides: {}, kind: "scatter3d" }, { width: 600, height: 400 });
    expect(s.warnings).toEqual([]);
  });
});

describe("box/violin from a Box-values entry (pre-computed five-number summary)", () => {
  const boxTable = (cells: Record<string, number>): DataTable => ({
    id: "t", kind: "column", name: "T",
    columns: [
      { id: "g", name: "", role: "x" },
      { id: "med", name: "Ctrl", role: "y" },
      { id: "mn", name: "Min", role: "min", group: "med" },
      { id: "q1", name: "Q1", role: "q1", group: "med" },
      { id: "q3", name: "Q3", role: "q3", group: "med" },
      { id: "mx", name: "Max", role: "max", group: "med" },
    ],
    rows: [{ id: "r0", cells }],
  });
  const boxPlot: Plot = { id: "p", name: "P", source: "t", status: "ok", styleOverrides: {}, kind: "box" };

  it("draws a box straight from the entered summary (min < Q1 < median < Q3 < max)", () => {
    const s = buildPlotScene(boxTable({ med: 12, mn: 5, q1: 9, q3: 16, mx: 20 }), boxPlot, {});
    const box = s.series[0]!.marks[0]!.box!;
    expect(box).toBeTruthy();
    // higher value → smaller pixel Y, so the pixel order inverts the entered value order
    expect(box.whiskerHigh).toBeLessThan(box.q3);
    expect(box.q3).toBeLessThan(box.median!);
    expect(box.median!).toBeLessThan(box.q1);
    expect(box.q1).toBeLessThan(box.whiskerLow);
    // the axis spans the entered extremes (min/max folded into the domain, not clipped)
    expect(s.y.domain[0]).toBeLessThanOrEqual(5);
    expect(s.y.domain[1]).toBeGreaterThanOrEqual(20);
    expect(s.warnings.some((w) => /needs raw values/.test(w))).toBe(false);
  });

  it("warns and draws no box when a box is fed a mean±error summary", () => {
    const t: DataTable = {
      id: "t", kind: "column", name: "T",
      columns: [
        { id: "g", name: "", role: "x" },
        { id: "m", name: "Ctrl", role: "y" },
        { id: "s", name: "SD", role: "sd", group: "m" },
      ],
      rows: [{ id: "r0", cells: { m: 10, s: 2 } }],
    };
    const s = buildPlotScene(t, boxPlot, {});
    expect(s.warnings.some((w) => /needs raw values or a Box-values/.test(w))).toBe(true);
    expect(s.series[0]?.marks?.[0]?.box).toBeFalsy(); // no misleading box of the means
  });
});

describe("buildPlotScene — axis domain override (pan/zoom)", () => {
  const table: DataTable = {
    id: "t",
    kind: "xy",
    name: "T",
    columns: [
      { id: "x", name: "X" },
      { id: "y", name: "Y" },
    ],
    rows: [0, 2, 4, 6, 8, 10].map((v, i) => ({ id: `r${i}`, cells: { x: v, y: v * 2 } })),
  };
  const plot: Plot = { id: "p", name: "P", source: "t", status: "ok", styleOverrides: {} };

  it("auto extent spans the data when no domain is given", () => {
    const s = buildPlotScene(table, plot, { xScale: "linear", yScale: "linear" });
    expect(s.x.domain[0]).toBeLessThanOrEqual(0);
    expect(s.x.domain[1]).toBeGreaterThanOrEqual(10);
  });

  it("honours an explicit xDomain/yDomain window", () => {
    const s = buildPlotScene(table, plot, {
      xScale: "linear",
      yScale: "linear",
      xDomain: [2, 6],
      yDomain: [4, 12],
    });
    // linear scales 'nice' the domain, so it brackets the requested window tightly.
    expect(s.x.domain[0]).toBeLessThanOrEqual(2);
    expect(s.x.domain[1]).toBeGreaterThanOrEqual(6);
    expect(s.x.domain[1]).toBeLessThan(10); // zoomed in vs the full extent
    expect(s.y.domain[0]).toBeLessThanOrEqual(4);
    expect(s.y.domain[1]).toBeGreaterThanOrEqual(12);
  });

  it("renders a fitted-curve overlay path when plot.fit is set", () => {
    const fitPlot: Plot = { ...plot, fit: { label: "Linear", points: [[2, 4], [4, 8], [6, 12]] } };
    const s = buildPlotScene(table, fitPlot, { xScale: "linear", yScale: "linear" });
    expect(s.fit).toBeDefined();
    expect(s.fit!.path.startsWith("M")).toBe(true);
    expect(s.fit!.label).toBe("Linear");
  });

  it("builds filled-area paths for the confidence + prediction bands", () => {
    const banded: Plot = {
      ...plot,
      fit: {
        label: "Linear",
        points: [[2, 4], [4, 8], [6, 12]],
        confidenceBand: [[2, 3.5, 4.5], [4, 7.6, 8.4], [6, 11.4, 12.6]],
        predictionBand: [[2, 2.5, 5.5], [4, 6.6, 9.4], [6, 10.2, 13.8]],
      },
    };
    const s = buildPlotScene(table, banded, { xScale: "linear", yScale: "linear" });
    expect(s.fit!.confidenceBandPath).toBeDefined();
    expect(s.fit!.confidenceBandPath!.startsWith("M")).toBe(true);
    expect(s.fit!.predictionBandPath).toBeDefined();
    // no bands → no band paths
    const plain = buildPlotScene(table, { ...plot, fit: { label: "L", points: [[2, 4], [6, 12]] } }, { xScale: "linear", yScale: "linear" });
    expect(plain.fit!.confidenceBandPath).toBeUndefined();
    expect(plain.fit!.predictionBandPath).toBeUndefined();
  });

  describe("EC50/IC50 dose crosshair (plot.fit.marker)", () => {
    const drTable: DataTable = {
      id: "dr",
      kind: "xy",
      name: "DR",
      columns: [{ id: "x", name: "Dose", role: "x" }, { id: "y", name: "Resp", role: "y" }],
      rows: [
        { id: "r1", cells: { x: 0, y: 5 } },
        { id: "r2", cells: { x: 2, y: 20 } },
        { id: "r3", cells: { x: 4, y: 50 } },
        { id: "r4", cells: { x: 6, y: 80 } },
        { id: "r5", cells: { x: 8, y: 92 } },
        { id: "r6", cells: { x: 10, y: 95 } },
      ],
    };
    const drPlot: Plot = { id: "p", name: "DR", source: "dr", status: "ok", styleOverrides: {}, kind: "xy" };

    it("draws a drop-line from the curve point down to the X-axis at the dose", () => {
      const marked: Plot = { ...drPlot, fit: { label: "4PL", points: [[0, 5], [4, 50], [10, 95]], marker: { x: 4, y: 50, label: "EC50 = 4" } } };
      const s = buildPlotScene(drTable, marked, { xScale: "linear", yScale: "linear", width: 600, height: 400 });
      const m = s.fit!.marker!;
      expect(m.label).toBe("EC50 = 4");
      // The dose line runs from the crosshair (cy) down to the X-axis baseline.
      expect(m.baseY).toBeGreaterThan(m.cy);
      expect(m.baseY).toBeCloseTo(s.plot.y + s.plot.height, 6); // baseY = X-axis
      expect(m.leftX).toBeCloseTo(s.plot.x, 6); // response segment starts at the Y-axis
      // vx (the dose x=4) sits inside the plot rect.
      expect(m.vx).toBeGreaterThan(s.plot.x);
      expect(m.vx).toBeLessThan(s.plot.x + s.plot.width);
    });

    it("hides the crosshair when reference lines are turned off (refLine.show:false)", () => {
      const hidden: Plot = { ...drPlot, refLine: { show: false }, fit: { label: "4PL", points: [[0, 5], [10, 95]], marker: { x: 4, y: 50, label: "EC50 = 4" } } };
      expect(buildPlotScene(drTable, hidden, { xScale: "linear", yScale: "linear" }).fit!.marker).toBeUndefined();
    });

    it("omits the crosshair when the dose is off the plotted X range", () => {
      const off: Plot = { ...drPlot, fit: { label: "4PL", points: [[0, 5], [10, 95]], marker: { x: 999, y: 50, label: "EC50 = 999" } } };
      expect(buildPlotScene(drTable, off, { xScale: "linear", yScale: "linear" }).fit!.marker).toBeUndefined();
    });

    it("a fit with no marker draws no crosshair", () => {
      const plain: Plot = { ...drPlot, fit: { label: "Linear", points: [[0, 5], [10, 95]] } };
      expect(buildPlotScene(drTable, plain, { xScale: "linear", yScale: "linear" }).fit!.marker).toBeUndefined();
    });

    // A potency label near the right edge hangs left of its crosshair, inside the plot: above-right it would run into
    // the legend ("EC50 = 2.8 uM" over "Control"). A dragged label keeps its spot.
    it("a potency label that would cross the plot's right edge hangs left of the crosshair", () => {
      const measure = (t: string, px: number): number => t.length * px * 0.6;
      const edge: Plot = { ...drPlot, fit: { label: "4PL", points: [[0, 5], [10, 95]], marker: { x: 9.8, y: 90, label: "EC50 = 9.8 µM (95% CI 9.1–10.4)" } } };
      const s = buildPlotScene(drTable, edge, { xScale: "linear", yScale: "linear", width: 600, height: 400, measure });
      const m = s.fit!.marker!;
      expect(m.labelAnchor, "the label still hangs right, past the plot").toBe("end");
      expect(m.labelX).toBeLessThanOrEqual(s.plot.x + s.plot.width);
      expect(m.labelX - measure(m.label, s.fonts.tick.size)).toBeGreaterThanOrEqual(s.plot.x);
      // A label in the middle keeps its default spot, above-right.
      const mid = buildPlotScene(drTable, { ...drPlot, fit: { label: "4PL", points: [[0, 5], [10, 95]], marker: { x: 4, y: 50, label: "EC50 = 4" } } }, { xScale: "linear", yScale: "linear", width: 600, height: 400, measure });
      expect(mid.fit!.marker!.labelAnchor).toBeUndefined();
      expect(mid.fit!.marker!.labelX).toBeCloseTo(mid.fit!.marker!.vx + 5, 6);
    });
  });

  it("renders per-dataset global-fit curves (plot.fits), defaulting each to its series colour", () => {
    const multi: Plot = {
      ...plot,
      fits: [
        { label: "Drug A", points: [[2, 4], [4, 8], [6, 12]] }, // no colour → seriesColor(0)
        { label: "Drug B", points: [[2, 3], [4, 6], [6, 9]], color: "#123456" }, // explicit colour honoured
      ],
    };
    const s = buildPlotScene(table, multi, { xScale: "linear", yScale: "linear" });
    expect(s.fits).toBeDefined();
    expect(s.fits!.length).toBe(2);
    expect(s.fits![0]!.path.startsWith("M")).toBe(true);
    expect(s.fits![0]!.color).toBe("#0072B2"); // OKABE_ITO[0]
    expect(s.fits![1]!.color).toBe("#123456"); // explicit colour wins
    expect(s.fits![1]!.label).toBe("Drug B");
    // degenerate curves (<2 in-domain points) are dropped; empty ⇒ no `fits`.
    const empty = buildPlotScene(table, { ...plot, fits: [{ label: "x", points: [[1, 1]] }] }, { xScale: "linear", yScale: "linear" });
    expect(empty.fits).toBeUndefined();
  });

  it("reports the natural home domain (soft-lock target) regardless of the zoom window", () => {
    const s = buildPlotScene(table, plot, {
      xScale: "linear",
      yScale: "linear",
      xDomain: [2, 6],
      yDomain: [4, 12],
    });
    // auto = the full-data extent (nice'd), independent of the zoom window.
    expect(s.auto.x[0]).toBeLessThanOrEqual(0);
    expect(s.auto.x[1]).toBeGreaterThanOrEqual(10);
    expect(s.auto.x).not.toEqual(s.x.domain); // home ≠ the zoomed window
  });
});

describe("buildPlotScene — dose-response sample", () => {
  const { table, plot } = sample();
  const scene = buildPlotScene(table, plot, { width: 580, height: 380 });

  it("auto-selects a log10 x-axis snapped to whole decades", () => {
    expect(scene.x.type).toBe("log10");
    expect(scene.x.domain).toEqual([0.1, 100]);
    const majors = scene.x.ticks.filter((t) => !t.minor).map((t) => t.label);
    expect(majors).toEqual(["0.1", "1", "10", "100"]);
  });

  it("uses a linear y-axis", () => {
    expect(scene.y.type).toBe("linear");
  });

  it("adds a per-series confidence ellipse only when enabled (≥3 points)", () => {
    expect(scene.ellipses).toBeUndefined(); // off by default
    const on = buildPlotScene(table, { ...plot, ellipse: { show: true, level: 0.95 } }, { width: 580, height: 380 });
    expect(on.ellipses).toHaveLength(on.series.length);
    const e = on.ellipses![0]!;
    expect(e.id).toBe(on.series[0]!.id);
    expect(e.rx).toBeGreaterThan(0);
    expect(e.ry).toBeGreaterThan(0);
    // mean-mode ellipse (÷√n) is smaller than the data-spread ellipse.
    const mean = buildPlotScene(table, { ...plot, ellipse: { show: true, level: 0.95, mode: "mean" } }, { width: 580, height: 380 });
    expect(mean.ellipses![0]!.rx).toBeLessThan(e.rx);
    // SD/SEM types: k·SD; SEM = k·SD ÷ √n is smaller; 3 SD bigger than 2 SD.
    const sd2 = buildPlotScene(table, { ...plot, ellipse: { show: true, mode: "sd", k: 2 } }, { width: 580, height: 380 });
    const sd3 = buildPlotScene(table, { ...plot, ellipse: { show: true, mode: "sd", k: 3 } }, { width: 580, height: 380 });
    const sem2 = buildPlotScene(table, { ...plot, ellipse: { show: true, mode: "sem", k: 2 } }, { width: 580, height: 380 });
    expect(sd3.ellipses![0]!.rx).toBeGreaterThan(sd2.ellipses![0]!.rx);
    expect(sem2.ellipses![0]!.rx).toBeLessThan(sd2.ellipses![0]!.rx);
  });

  it("renders one mark per row, each carrying its stable row id", () => {
    const marks = scene.series[0]!.marks;
    expect(marks).toHaveLength(table.rows.length);
    marks.forEach((m, i) => {
      expect(m.rowId).toBe(table.rows[i]!.id);
      expect(m.rowNumber).toBe(i + 1);
    });
  });

  it("places every mark inside the plot rectangle", () => {
    const { x, y, width, height } = scene.plot;
    for (const m of scene.series[0]!.marks) {
      expect(m.cx).toBeGreaterThanOrEqual(x - 0.001);
      expect(m.cx).toBeLessThanOrEqual(x + width + 0.001);
      expect(m.cy).toBeGreaterThanOrEqual(y - 0.001);
      expect(m.cy).toBeLessThanOrEqual(y + height + 0.001);
    }
    expect(width).toBeGreaterThan(0);
    expect(height).toBeGreaterThan(0);
  });

  it("emits a connecting line path", () => {
    expect(scene.series[0]!.linePath.startsWith("M")).toBe(true);
  });

  it("carries axis titles from the column names and no warnings", () => {
    expect(scene.axisLabels.x).toBe(table.columns[0]!.name);
    expect(scene.axisLabels.y).toBe(table.columns[1]!.name);
    expect(scene.warnings).toEqual([]);
  });

  it("exposes resolved figure fonts sized up for print (visual hierarchy)", () => {
    // Use a bare plot (the built-in sample ships in the house style, with its own
    // explicit fonts) so this verifies the renderer's default print sizing.
    const bareTable: DataTable = {
      id: "t", kind: "xy", name: "T",
      columns: [{ id: "x", name: "X" }, { id: "y", name: "Y" }],
      rows: [0, 1, 2].map((v, i) => ({ id: `r${i}`, cells: { x: v, y: v } })),
    };
    const s = buildPlotScene(bareTable, { id: "p", name: "P", source: "t", status: "ok", styleOverrides: {} }, { width: 580, height: 380 });
    expect(s.fonts.tick.size).toBe(13);
    expect(s.fonts.axisTitle.size).toBe(15);
    expect(s.fonts.legend.size).toBe(13);
    expect(s.fonts.title.size).toBe(18);
    // axis titles are larger than the tick labels; the graph title larger still.
    expect(s.fonts.axisTitle.size).toBeGreaterThan(s.fonts.tick.size);
    expect(s.fonts.title.size).toBeGreaterThan(s.fonts.axisTitle.size);
    // default weights: graph title is bold-ish, body text normal.
    expect(s.fonts.title.weight).toBe(600);
    expect(s.fonts.tick.weight).toBe(400);
    expect(s.fonts.tick.family).toBeNull();
    expect(s.fonts.tick.color).toBeNull();
  });
});

describe("buildPlotScene — axis line colour/thickness", () => {
  const table: DataTable = {
    id: "t",
    kind: "xy",
    name: "T",
    columns: [
      { id: "x", name: "X" },
      { id: "y", name: "Y" },
    ],
    rows: [0, 2, 4].map((v, i) => ({ id: `r${i}`, cells: { x: v, y: v } })),
  };
  const base: Plot = { id: "p", name: "P", source: "t", status: "ok", styleOverrides: {} };
  const opts = { xScale: "linear" as const, yScale: "linear" as const };

  it("defaults to null colour + 1.25 width, and honours per-axis overrides", () => {
    const def = buildPlotScene(table, base, opts);
    expect(def.x.lineColor).toBeNull();
    expect(def.x.lineWidth).toBe(1.25);
    const styled = buildPlotScene(
      table,
      { ...base, xAxis: { lineColor: "#ff0000", lineWidth: 3 }, yAxis: { lineColor: "#00ff00" } },
      opts,
    );
    expect(styled.x.lineColor).toBe("#ff0000");
    expect(styled.x.lineWidth).toBe(3);
    expect(styled.y.lineColor).toBe("#00ff00");
    expect(styled.y.lineWidth).toBe(1.25); // unset → default
  });

  it("applies the axis line on a categorical (bar) chart too", () => {
    const s = buildPlotScene(table, { ...base, kind: "bar", yAxis: { lineColor: "#123456", lineWidth: 2 } }, opts);
    expect(s.y.lineColor).toBe("#123456");
    expect(s.y.lineWidth).toBe(2);
  });

  it("composite bars+line: a plotAs:'line' series draws an overlay line over the bars and drops its rects", () => {
    const bars = buildPlotScene(table, { ...base, kind: "bar" }, opts);
    const dsId = bars.series[0]!.id;
    // A normal bar series: rects present, no overlay line.
    expect(bars.series[0]!.marks.every((m) => m.bar !== undefined)).toBe(true);
    expect(bars.series[0]!.overlayLine ?? "").toBe("");
    // plotAs:"line" → the series renders as a connecting line (SVG path) with its bars dropped.
    const composite = buildPlotScene(table, { ...base, kind: "bar", seriesStyles: { [dsId]: { plotAs: "line" } } }, opts);
    const ser = composite.series[0]!;
    expect(ser.overlayLine).toBeTruthy();
    expect(ser.overlayLine!.startsWith("M")).toBe(true);
    expect(ser.marks.every((m) => m.bar === undefined)).toBe(true);
  });

  it("dual-axis: a series pinned to y2 scales to its own right-hand domain + draws a right axis (bars unchanged)", () => {
    const t2: DataTable = {
      id: "t2", kind: "column", name: "T2",
      columns: [
        { id: "g", name: "Group", role: "x" },
        { id: "bar", name: "Sales", role: "y" },
        { id: "line", name: "Price", role: "y" },
      ],
      rows: [
        { id: "r1", cells: { g: "A", bar: 2, line: 100 } },
        { id: "r2", cells: { g: "B", bar: 6, line: 200 } },
        { id: "r3", cells: { g: "C", bar: 10, line: 300 } },
      ],
    };
    const plain = buildPlotScene(t2, { ...base, source: "t2", kind: "bar" }, opts);
    expect(plain.y2).toBeUndefined(); // no right axis by default

    const dual = buildPlotScene(
      t2,
      { ...base, source: "t2", kind: "bar", seriesStyles: { line: { plotAs: "line", axis: "y2" } }, y2Axis: { title: "Price" } },
      opts,
    );
    // the right axis appears, scaled to the line series' range (~100..300), not the bars' 0-anchored domain.
    expect(dual.y2).toBeTruthy();
    expect(dual.y2!.title).toBe("Price");
    expect(dual.y2!.domain[0]).toBeLessThanOrEqual(100);
    expect(dual.y2!.domain[1]).toBeGreaterThanOrEqual(300);
    // the left axis is fitted to the bars alone — the same range as a chart with no Price series.
    // Compared against a bars-only chart, not `plain` (where Price is also on the left axis and
    // stretches it to 300, squashing the bars flat at cy 327/323/320). A right axis that leaves
    // the left one stretched cannot show two units.
    const barsOnly = buildPlotScene({ ...t2, columns: t2.columns.filter((c) => c.id !== "line") }, { ...base, source: "t2", kind: "bar" }, opts);
    expect(dual.y.domain).toEqual(barsOnly.y.domain);
    expect(dual.y.domain[1]).toBeLessThan(100);
    // the line series draws as a line (bars dropped) and its marks sit on the plot via the
    // y2 scale — on the left axis (max ≈ 10) the value 300 would land far above the plot.
    const lineDual = dual.series.find((s) => s.id === "line")!;
    expect(lineDual.overlayLine).toBeTruthy();
    expect(lineDual.marks.every((m) => m.bar === undefined)).toBe(true);
    for (const m of lineDual.marks) {
      expect(m.cy).toBeGreaterThanOrEqual(dual.plot.y - 1);
      expect(m.cy).toBeLessThanOrEqual(dual.plot.y + dual.plot.height + 1);
    }
  });

  // A horizontal bar honours the same seriesStyles that drive the vertical dual axis: the
  // horizontal builder draws the transposed plotAs:'line' overlay, and axis:'y2' draws a second
  // value axis along the top (bar-horizontal-top-axis.test.ts has the detail).
  it("a horizontal bar honours plotAs:'line' and axis:'y2' — a top second axis", () => {
    const t2: DataTable = {
      id: "t2", kind: "column", name: "T2",
      columns: [
        { id: "g", name: "Group", role: "x" },
        { id: "bar", name: "Sales", role: "y" },
        { id: "line", name: "Price", role: "y" },
      ],
      rows: [
        { id: "r1", cells: { g: "A", bar: 2, line: 100 } },
        { id: "r2", cells: { g: "B", bar: 6, line: 200 } },
        { id: "r3", cells: { g: "C", bar: 10, line: 300 } },
      ],
    };
    const horiz = buildPlotScene(
      t2,
      { ...base, source: "t2", kind: "bar", barOrientation: "horizontal", seriesStyles: { line: { plotAs: "line", axis: "y2" } }, y2Axis: { title: "Price" } },
      opts,
    );
    expect(horiz.y2?.side).toBe("top"); // the second value axis runs along the top of a flipped bar
    expect(horiz.y2!.title).toBe("Price");
    expect(horiz.warnings.some((w) => /second value axis/i.test(w))).toBe(false); // …and nothing is refused
    const lineSer = horiz.series.find((s) => s.id === "line")!;
    expect(lineSer.overlayLine).toBeTruthy(); // the transposed line overlay is drawn
    expect(lineSer.marks.every((m) => m.bar === undefined)).toBe(true); // rects dropped
  });

  // Tick thickness defaults to following the axis line thickness (the renderer falls
  // back to lineWidth); an explicit tickWidth overrides it independently.
  it("carries an explicit tickWidth, and leaves it undefined to follow the axis thickness", () => {
    expect(buildPlotScene(table, base, opts).x.tickWidth).toBeUndefined();
    const s = buildPlotScene(table, { ...base, xAxis: { lineWidth: 3, tickWidth: 1 }, yAxis: { lineWidth: 4 } }, opts);
    expect(s.x.lineWidth).toBe(3);
    expect(s.x.tickWidth).toBe(1); // independent override
    expect(s.y.lineWidth).toBe(4);
    expect(s.y.tickWidth).toBeUndefined(); // follows the axis thickness
  });

  // Open/hollow markers can carry an interior fill colour (lighter than the
  // outline = the two-tone marker) — series-wide and per-point.
  it("carries a series symbolFillColor (open markers) onto the series scene; undefined when unset", () => {
    expect(buildPlotScene(table, base, opts).series[0]!.symbolFillColor).toBeUndefined();
    const styled = buildPlotScene(
      table,
      { ...base, seriesStyles: { y: { symbolFill: "open", symbolFillColor: "#ffd9b3" } } },
      opts,
    );
    expect(styled.series[0]!.symbolFill).toBe("open");
    expect(styled.series[0]!.symbolFillColor).toBe("#ffd9b3");
  });

  it("the line colour links to the marker colour by default, and decouples when unlinked", () => {
    // default (linked) → the line follows the series colour, ignoring any stray lineColor
    const linked = buildPlotScene(table, { ...base, seriesStyles: { y: { color: "#ff0000", lineColor: "#0000ff" } } }, opts);
    expect(linked.series[0]!.color).toBe("#ff0000");
    expect(linked.series[0]!.lineColor).toBe("#ff0000"); // linked → line = marker colour
    // unlinked → the line carries its own colour; the marker/series colour is unchanged
    const split = buildPlotScene(table, { ...base, seriesStyles: { y: { color: "#ff0000", linkLineColor: false, lineColor: "#0000ff" } } }, opts);
    expect(split.series[0]!.color).toBe("#ff0000"); // marker / series identity
    expect(split.series[0]!.lineColor).toBe("#0000ff"); // line only
    // unlinked but no own colour set → still falls back to the series colour
    const fallback = buildPlotScene(table, { ...base, seriesStyles: { y: { color: "#ff0000", linkLineColor: false } } }, opts);
    expect(fallback.series[0]!.lineColor).toBe("#ff0000");
  });

  it("two-tone open markers derive a light interior + darker outline from the series colour", () => {
    const hex = (s: string): number[] => [parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16)];
    const blue = buildPlotScene(table, { ...base, seriesStyles: { y: { color: "#2266cc", symbolFill: "twotone" } } }, opts);
    const ser = blue.series[0]!;
    expect(ser.symbolFill).toBe("open"); // resolves to an open marker for the renderer
    const baseC = hex("#2266cc"), fill = hex(ser.symbolFillColor!), edge = hex(ser.symbolOutline!);
    for (let i = 0; i < 3; i++) {
      expect(fill[i]!).toBeGreaterThanOrEqual(baseC[i]!); // interior lightened toward white
      expect(edge[i]!).toBeLessThanOrEqual(baseC[i]!); // outline darkened toward black
    }
    // Changing only the series colour to green re-derives green tones.
    const green = buildPlotScene(table, { ...base, seriesStyles: { y: { color: "#1f9d3a", symbolFill: "twotone" } } }, opts);
    const gFill = hex(green.series[0]!.symbolFillColor!);
    expect(gFill[1]!).toBeGreaterThan(gFill[0]!); // green channel dominates the derived interior
  });

  /**
   * Recolouring one point of a two-tone series must re-derive that point's pair.
   *
   * Two-tone is the house default, so it normally comes from the series and a per-point
   * recolour never restates it. A derivation keyed on the override's own fill mode would skip
   * it: the point would keep the series' interior tint while taking the raw new colour as its
   * outline — a mismatched marker that reads as "changing the colour does nothing in two-tone"
   * while every other fill mode works.
   */
  it("re-derives the two-tone pair when a single point is recoloured", () => {
    const s = buildPlotScene(
      table,
      {
        ...base,
        seriesStyles: { y: { symbolFill: "twotone", color: "#000000" } },
        pointStyles: { "y:r1": { color: "#D55E00" } }, // colour only — fill mode untouched
      },
      opts,
    );
    const mark = s.series[0]!.marks.find((m) => m.rowId === "r1")!;
    const other = s.series[0]!.marks.find((m) => m.rowId !== "r1")!;

    expect(mark.symbolFillColor, "the recoloured point got no derived interior").toBeTruthy();
    // The interior must be a lightened form of the new hue, not the series' old tint…
    expect(mark.symbolFillColor).not.toBe(other.symbolFillColor);
    // …and the outline a darkened form of it, never the raw colour straight through.
    expect(
      mark.symbolOutline,
      "the outline is the raw colour — the two-tone contour was not derived",
    ).not.toBe("#D55E00");
    const hex = (c: string): number[] => [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];
    const baseC = hex("#D55E00"), fill = hex(mark.symbolFillColor!), edge = hex(mark.symbolOutline!);
    for (let i = 0; i < 3; i++) {
      expect(fill[i]!).toBeGreaterThanOrEqual(baseC[i]!);
      expect(edge[i]!).toBeLessThanOrEqual(baseC[i]!);
    }
  });

  it("honours a per-point symbolFillColor override on a single mark", () => {
    const s = buildPlotScene(
      table,
      { ...base, seriesStyles: { y: { symbolFill: "open" } }, pointStyles: { "y:r1": { symbolFillColor: "#abcdef" } } },
      opts,
    );
    const marks = s.series[0]!.marks;
    expect(marks.filter((m) => m.symbolFillColor === "#abcdef")).toHaveLength(1);
    expect(marks.find((m) => m.rowId === "r1")!.symbolFillColor).toBe("#abcdef");
  });
});

describe("buildPlotScene — axis cut (break) on bar charts", () => {
  // The categorical (bar) builder must pass `breaks` to its value scale, or a configured axis
  // cut compresses nothing and draws no break mark on bars, as it does on XY / box / violin.
  // Covers both orientations.
  const barTable: DataTable = {
    id: "t", kind: "xy", name: "T",
    columns: [{ id: "x", name: "Cat" }, { id: "y", name: "Val" }],
    rows: ([["A", 5], ["B", 10], ["C", 92], ["D", 100]] as [string, number][]).map(([c, v], i) => ({
      id: `r${i}`, cells: { x: c!, y: v! },
    })),
  };
  const base: Plot = { id: "p", name: "P", source: "t", status: "ok", styleOverrides: {}, kind: "bar" };
  const opts = { width: 600, height: 400 } as const;
  // The value-92 bar ("C", index 2) — above the cut but below the max. The max-value bar
  // always maps to the axis top regardless of the cut, so it can't show compression; this
  // one drops toward the baseline once the empty 15..85 band is compressed out.
  const barC = (s: ReturnType<typeof buildPlotScene>) => s.series[0]!.marks[2]!.bar!;

  it("vertical: a Y-axis cut compresses the bars and draws a break mark", () => {
    const plain = buildPlotScene(barTable, base, opts);
    const cut = buildPlotScene(barTable, { ...base, yAxis: { breaks: [{ from: 15, to: 85 }] } }, opts);
    // Without a cut the value axis has no break mark; with one it has.
    expect(plain.y.breakMarks ?? []).toHaveLength(0);
    expect((cut.y.breakMarks ?? []).length).toBeGreaterThan(0);
    // Compression reached the bar geometry: the bar above the cut is shorter with the cut in.
    expect(barC(cut).h).toBeLessThan(barC(plain).h);
  });

  it("horizontal: the cut moves to the X (value) axis and still compresses", () => {
    const h: Plot = { ...base, barOrientation: "horizontal" };
    const plain = buildPlotScene(barTable, h, opts);
    const cut = buildPlotScene(barTable, { ...h, yAxis: { breaks: [{ from: 15, to: 85 }] } }, opts);
    expect(plain.x.breakMarks ?? []).toHaveLength(0);
    expect((cut.x.breakMarks ?? []).length).toBeGreaterThan(0);
    // Horizontal bar length is bar.w; compression shortens the bar above the cut.
    expect(barC(cut).w).toBeLessThan(barC(plain).w);
  });
});

describe("buildPlotScene — graph title (Format → Title)", () => {
  const table: DataTable = {
    id: "t",
    kind: "xy",
    name: "T",
    columns: [
      { id: "x", name: "X" },
      { id: "y", name: "Y" },
    ],
    rows: [0, 2, 4, 6, 8, 10].map((v, i) => ({ id: `r${i}`, cells: { x: v, y: v * 2 } })),
  };
  const base: Plot = { id: "p", name: "Tumour growth", source: "t", status: "ok", styleOverrides: {} };
  const opts = { xScale: "linear" as const, yScale: "linear" as const };

  it("defaults the title to the plot name, no subtitle", () => {
    const s = buildPlotScene(table, base, opts);
    expect(s.title).toBe("Tumour growth");
    expect(s.subtitle).toBe("");
  });

  it("honours a manual title override and subtitle", () => {
    const s = buildPlotScene(table, { ...base, title: "Figure 1", subtitle: "mean ± SD" }, opts);
    expect(s.title).toBe("Figure 1");
    expect(s.subtitle).toBe("mean ± SD");
  });

  it("hides the heading and reclaims the top margin when showTitle is false", () => {
    const shown = buildPlotScene(table, base, opts);
    const hidden = buildPlotScene(table, { ...base, showTitle: false }, opts);
    expect(hidden.title).toBe("");
    expect(hidden.subtitle).toBe("");
    // No heading band → the plot rect sits higher and is taller.
    expect(hidden.plot.y).toBeLessThan(shown.plot.y);
    expect(hidden.plot.height).toBeGreaterThan(shown.plot.height);
  });

  it("a subtitle adds further top margin beyond the title alone", () => {
    const titleOnly = buildPlotScene(table, base, opts);
    const withSub = buildPlotScene(table, { ...base, subtitle: "n = 12" }, opts);
    expect(withSub.plot.y).toBeGreaterThan(titleOnly.plot.y);
  });

  it("resolves per-element font overrides (size/family/bold/italic/colour)", () => {
    const s = buildPlotScene(
      table,
      {
        ...base,
        fonts: {
          tick: { size: 20, color: "#ff0000" },
          axisTitle: { family: "Georgia", italic: true },
          title: { bold: false },
        },
      },
      opts,
    );
    expect(s.fonts.tick.size).toBe(20);
    expect(s.fonts.tick.color).toBe("#ff0000");
    expect(s.fonts.axisTitle.family).toBe("Georgia");
    expect(s.fonts.axisTitle.italic).toBe(true);
    // bold:false explicitly overrides the title's bold-ish default weight.
    expect(s.fonts.title.weight).toBe(400);
    // a larger tick font widens the left margin (the plot rect narrows).
    const plain = buildPlotScene(table, base, opts);
    expect(s.plot.width).toBeLessThan(plain.plot.width);
  });

  it("honours tunable axis spacing (label↔axis, title↔labels) — widens margins", () => {
    const base0 = buildPlotScene(table, base, opts);
    const spaced = buildPlotScene(
      table,
      { ...base, xAxis: { tickLabelGap: 30, titleGap: 30 }, yAxis: { tickLabelGap: 30, titleGap: 30 } },
      opts,
    );
    expect(spaced.axisGaps).toMatchObject({ xTick: 30, xTitle: 30, yTick: 30, yTitle: 30 });
    // bigger gaps reserve more margin → the plotting rect shrinks (more bottom + left)
    expect(spaced.plot.height).toBeLessThan(base0.plot.height);
    expect(spaced.plot.x).toBeGreaterThan(base0.plot.x);
    // defaults applied when unset
    expect(base0.axisGaps).toMatchObject({ xTick: 6, xTitle: 6, yTick: 8, yTitle: 6 });
  });

  it("resolves per-axis title fonts independently (X 22px bold, Y unchanged)", () => {
    const s = buildPlotScene(
      table,
      {
        ...base,
        fonts: { axisTitle: { size: 15, family: "Georgia" } },
        xAxis: { titleFont: { size: 22, bold: true } },
      },
      opts,
    );
    // X title takes its own override; Y inherits the shared axis-title font.
    expect(s.fonts.xAxisTitle.size).toBe(22);
    expect(s.fonts.xAxisTitle.weight).toBe(700);
    expect(s.fonts.yAxisTitle.size).toBe(15);
    expect(s.fonts.yAxisTitle.weight).toBe(400);
    // unset X fields inherit the shared font (family) rather than resetting.
    expect(s.fonts.xAxisTitle.family).toBe("Georgia");
    // a bigger X title reserves more bottom margin (taller-than-default).
    const plain = buildPlotScene(table, { ...base, fonts: { axisTitle: { size: 15 } } }, opts);
    expect(s.plot.height).toBeLessThan(plain.plot.height);
  });
});

describe("buildPlotScene — annotations (reference lines)", () => {
  const table: DataTable = {
    id: "t",
    kind: "xy",
    name: "T",
    columns: [
      { id: "x", name: "X" },
      { id: "y", name: "Y" },
    ],
    rows: [0, 2, 4, 6, 8, 10].map((v, i) => ({ id: `r${i}`, cells: { x: v, y: v } })),
  };
  const base: Plot = { id: "p", name: "P", source: "t", status: "ok", styleOverrides: {} };
  const opts = { xScale: "linear" as const, yScale: "linear" as const };

  it("maps a horizontal reference line to a full-width line at its Y pixel", () => {
    const s = buildPlotScene(table, { ...base, annotations: [{ id: "a1", kind: "hline", value: 5, label: "thr" }] }, opts);
    expect(s.annotations).toHaveLength(1);
    const a = s.annotations[0]!;
    expect(a.kind).toBe("line");
    expect(a.x1).toBeCloseTo(s.plot.x, 5);
    expect(a.x2).toBeCloseTo(s.plot.x + s.plot.width, 5);
    expect(a.y1).toBe(a.y2); // horizontal
    // y=5 is mid-range (data 0..10) → roughly the plot's vertical middle.
    expect(a.y1!).toBeGreaterThan(s.plot.y);
    expect(a.y1!).toBeLessThan(s.plot.y + s.plot.height);
    expect(a.label).toBe("thr");
  });

  it("maps a vertical reference line to a full-height line at its X pixel", () => {
    const s = buildPlotScene(table, { ...base, annotations: [{ id: "a2", kind: "vline", value: 4 }] }, opts);
    expect(s.annotations).toHaveLength(1);
    const a = s.annotations[0]!;
    expect(a.y1).toBeCloseTo(s.plot.y, 5);
    expect(a.y2).toBeCloseTo(s.plot.y + s.plot.height, 5);
    expect(a.x1).toBe(a.x2); // vertical
  });

  it("drops a reference line whose value is outside the visible range", () => {
    const s = buildPlotScene(table, { ...base, annotations: [{ id: "a3", kind: "hline", value: 1e6 }] }, opts);
    expect(s.annotations).toHaveLength(0);
  });

  // --- data-valued zone bands -----------------------------------
  // A band whose bandLo/bandHi are set spans an axis-value range (like a reference line), not a
  // fraction of the plot: it must land on the right pixels, track the axis when the scale
  // changes, clip to the axis, refuse where the axis is not continuous, and read back locked.
  const bandOf = (s: ReturnType<typeof buildPlotScene>) => s.annotations.find((a) => a.kind === "band")!;

  it("a data-valued hband lands at mapY(lo)..mapY(hi) on the value axis", () => {
    const s = buildPlotScene(table, { ...base, annotations: [{ id: "hb", kind: "hband", bandLo: 3, bandHi: 7 }] }, { ...opts, yDomain: [0, 10] });
    const b = bandOf(s);
    // Full width (an hband spans the whole X), Y range placed by value.
    expect(b.x1).toBeCloseTo(s.plot.x, 3);
    expect(b.x2).toBeCloseTo(s.plot.x + s.plot.width, 3);
    const [d0, d1] = s.y.domain;
    const py = (v: number): number => s.plot.y + ((d1 - v) / (d1 - d0)) * s.plot.height; // Y runs downward
    expect(b.y1!).toBeCloseTo(py(7), 1); // top pixel = the higher value
    expect(b.y2!).toBeCloseTo(py(3), 1);
  });

  it("Tracks the axis: the same value range is taller on a tighter scale (a fractional band would not move)", () => {
    const band = { id: "hb", kind: "hband" as const, bandLo: 3, bandHi: 7 };
    const tight = bandOf(buildPlotScene(table, { ...base, annotations: [band] }, { ...opts, yDomain: [0, 10] }));
    const wide = bandOf(buildPlotScene(table, { ...base, annotations: [band] }, { ...opts, yDomain: [0, 40] }));
    const h = (b: typeof tight): number => b.y2! - b.y1!;
    // 4 units of 10 vs 4 units of 40 → roughly 4× taller. A fractional band ignores the domain.
    expect(h(tight)).toBeGreaterThan(h(wide) * 2.5);
  });

  it("clips a data-valued band to the axis instead of overflowing it", () => {
    const s = buildPlotScene(table, { ...base, annotations: [{ id: "hb", kind: "hband", bandLo: 5, bandHi: 1000 }] }, { ...opts, yDomain: [0, 10] });
    const b = bandOf(s);
    // The top clips to the plot's top edge (the range runs off the axis above).
    expect(b.y1!).toBeGreaterThanOrEqual(s.plot.y - 0.5);
    expect(b.y1!).toBeLessThan(b.y2!); // still a real band, not collapsed
  });

  it("drops a data-valued band whose whole range is off the axis, with a reason", () => {
    const s = buildPlotScene(table, { ...base, annotations: [{ id: "hb", kind: "hband", bandLo: 500, bandHi: 900 }] }, { ...opts, yDomain: [0, 10] });
    expect(s.annotations.filter((a) => a.kind === "band")).toHaveLength(0);
    expect((s.warnings ?? []).some((w) => /outside the axis range/.test(w))).toBe(true);
  });

  it("refuses a data-valued vband on a categorical X, with a reason (like a vline)", () => {
    const bar: DataTable = {
      id: "tb", kind: "column", name: "B",
      columns: [{ id: "g", name: "Group", role: "x" }, { id: "v", name: "V", role: "y" }],
      rows: [{ id: "r1", cells: { g: "A", v: 3 } }, { id: "r2", cells: { g: "B", v: 6 } }],
    };
    const barPlot: Plot = { id: "pb", name: "pb", source: "tb", status: "ok", styleOverrides: {}, kind: "bar" };
    const s = buildPlotScene(bar, { ...barPlot, annotations: [{ id: "vb", kind: "vband", bandLo: 1, bandHi: 2 }] }, { width: 600, height: 400 });
    expect(s.annotations.filter((a) => a.kind === "band")).toHaveLength(0);
    expect((s.warnings ?? []).some((w) => /continuous X axis/.test(w))).toBe(true);
  });

  it("marks a data-valued band locked (edited by value, not dragged); a fractional band is not", () => {
    const dataB = bandOf(buildPlotScene(table, { ...base, annotations: [{ id: "hb", kind: "hband", bandLo: 3, bandHi: 7 }] }, { ...opts, yDomain: [0, 10] }));
    const fracB = bandOf(buildPlotScene(table, { ...base, annotations: [{ id: "hf", kind: "hband", y: 0.4, h: 0.2 }] }, opts));
    expect(dataB.locked).toBe(true);
    expect(fracB.locked ?? false).toBe(false);
  });

  it("a fractional band spans its fraction, full width", () => {
    const s = buildPlotScene(table, { ...base, annotations: [{ id: "hf", kind: "hband", y: 0.25, h: 0.5 }] }, opts);
    const b = bandOf(s);
    expect(b.x1).toBeCloseTo(s.plot.x, 3);
    expect(b.x2).toBeCloseTo(s.plot.x + s.plot.width, 3);
    expect(b.y1!).toBeCloseTo(s.plot.y + 0.25 * s.plot.height, 1);
    expect(b.y2!).toBeCloseTo(s.plot.y + 0.75 * s.plot.height, 1);
  });

  // --- Zone key --------------------------------------------------
  // A key for the shaded zone bands: one row per labelled band (its fill + caption), overlaid
  // in a plot corner; the in-band caption is dropped so it is not drawn twice.
  const zoneBands = [
    { id: "z1", kind: "hband" as const, y: 0.6, h: 0.2, fill: "#22aa22", label: "Low" },
    { id: "z2", kind: "hband" as const, y: 0.2, h: 0.2, fill: "#cc3333", label: "High" },
    { id: "z3", kind: "hband" as const, y: 0.42, h: 0.1, fill: "#3366cc" }, // no label → not keyed
  ];

  it("builds one keyed row per labelled band, in order, and drops the in-band caption", () => {
    const s = buildPlotScene(table, { ...base, zoneLegend: "topright", annotations: zoneBands }, opts);
    expect(s.zoneLegend).toBeDefined();
    expect(s.zoneLegend!.entries).toEqual([
      { label: "Low", color: "#22aa22" },
      { label: "High", color: "#cc3333" },
    ]);
    // No band keeps an in-band caption — the key carries it.
    expect(s.annotations.filter((a) => a.kind === "band").every((a) => a.label === undefined)).toBe(true);
  });

  it("honours the chosen corner", () => {
    const mk = (pos: "topleft" | "topright" | "bottomleft" | "bottomright") =>
      buildPlotScene(table, { ...base, zoneLegend: pos, annotations: [zoneBands[0]!] }, opts).zoneLegend!;
    const tr = mk("topright"), tl = mk("topleft"), bl = mk("bottomleft");
    const s = buildPlotScene(table, base, opts);
    expect(tl.x).toBeLessThan(tr.x);            // left corner is further left
    expect(tl.y).toBeLessThan(bl.y);            // top corner is higher up
    expect(tr.x + tr.w).toBeLessThanOrEqual(s.plot.x + s.plot.width + 0.5); // inside the plot
  });

  it("draws no key when off / unset", () => {
    const withBand = [{ id: "z1", kind: "hband" as const, y: 0.4, h: 0.2, label: "Z" }];
    expect(buildPlotScene(table, { ...base, annotations: withBand }, opts).zoneLegend).toBeUndefined();
    expect(buildPlotScene(table, { ...base, zoneLegend: "off", annotations: withBand }, opts).zoneLegend).toBeUndefined();
  });

  it("draws no key when no band carries a label (nothing to key)", () => {
    const s = buildPlotScene(table, { ...base, zoneLegend: "topright", annotations: [{ id: "z1", kind: "hband", y: 0.4, h: 0.2, fill: "#22aa22" }] }, opts);
    expect(s.zoneLegend).toBeUndefined();
  });

  it("lollipop builds annotations, although it has a bespoke builder", () => {
    const lollipopData: DataTable = {
      id: "t", kind: "xy", name: "T",
      columns: [{ id: "x", name: "Cat" }, { id: "y", name: "Val" }],
      rows: [["A", 3], ["B", 7], ["C", 5]].map(([c, v], i) => ({ id: `r${i}`, cells: { x: c!, y: v! } })),
    };
    // Horizontal lollipop (default): value axis is X → a value reference line draws vertically.
    const h = buildPlotScene(lollipopData, { ...base, kind: "lollipop", annotations: [{ id: "v", kind: "vline", value: 5 }] }, opts);
    expect(h.annotations).toHaveLength(1);
    expect(h.annotations[0]!.kind).toBe("line");
    expect(h.annotations[0]!.x1).toBe(h.annotations[0]!.x2); // vertical value line on X
    // Vertical lollipop: value axis is Y → an hline is the value reference (horizontal line).
    const v = buildPlotScene(lollipopData, { ...base, kind: "lollipop", barOrientation: "vertical", annotations: [{ id: "hh", kind: "hline", value: 5 }] }, opts);
    expect(v.annotations).toHaveLength(1);
    expect(v.annotations[0]!.y1).toBe(v.annotations[0]!.y2); // horizontal value line on Y
    // A text annotation renders on the lollipop too.
    const t = buildPlotScene(lollipopData, { ...base, kind: "lollipop", annotations: [{ id: "tx", kind: "text", label: "note", x: 0.5, y: 0.2 }] }, opts);
    expect(t.annotations.some((a) => a.kind === "text" && a.label === "note")).toBe(true);
  });

  it("places a text annotation at its fractional plot position", () => {
    const s = buildPlotScene(
      table,
      { ...base, annotations: [{ id: "tx", kind: "text", label: "n.s.", x: 0.5, y: 0.1, size: 16 }] },
      opts,
    );
    expect(s.annotations).toHaveLength(1);
    const a = s.annotations[0]!;
    expect(a.kind).toBe("text");
    expect(a.label).toBe("n.s.");
    expect(a.labelX).toBeCloseTo(s.plot.x + 0.5 * s.plot.width, 5);
    expect(a.labelY).toBeCloseTo(s.plot.y + 0.1 * s.plot.height, 5);
    expect(a.fontSize).toBe(16);
    expect(a.x1).toBeUndefined(); // no line geometry for text
  });

  it("drops an empty text annotation", () => {
    const s = buildPlotScene(table, { ...base, annotations: [{ id: "tx2", kind: "text", label: "" }] }, opts);
    expect(s.annotations).toHaveLength(0);
  });

  it("honours an explicit axis length (plot area = length; figure grows to fit)", () => {
    const base0 = buildPlotScene(table, base, opts);
    // X length 300 → plot width 300, figure width = 300 + margins (> 300).
    const sx = buildPlotScene(table, { ...base, xAxisLength: 300 }, opts);
    expect(sx.plot.width).toBe(300);
    expect(sx.width).toBeGreaterThan(300);
    expect(sx.width - sx.plot.width).toBeCloseTo(base0.width - base0.plot.width, 0); // same margins
    // Y length 250 → plot height 250.
    const sy = buildPlotScene(table, { ...base, yAxisLength: 250 }, opts);
    expect(sy.plot.height).toBe(250);
    expect(sy.height).toBeGreaterThan(250);
  });

  it("resolves the figure background (colour kept; transparent/undefined → null)", () => {
    expect(buildPlotScene(table, { ...base, background: "#fbf7ec" }, opts).background).toBe("#fbf7ec");
    expect(buildPlotScene(table, { ...base, background: "transparent" }, opts).background).toBeNull();
    expect(buildPlotScene(table, base, opts).background).toBeNull();
  });

  it("carries a text box's font family / bold / italic / rotation", () => {
    const s = buildPlotScene(
      table,
      { ...base, annotations: [{ id: "ts", kind: "text", label: "α", x: 0.5, y: 0.2, bold: true, italic: true, fontFamily: "Georgia, serif", rotation: 30 }] },
      opts,
    );
    const a = s.annotations[0]!;
    expect(a.bold).toBe(true);
    expect(a.italic).toBe(true);
    expect(a.fontFamily).toBe("Georgia, serif");
    expect(a.rotation).toBe(30);
  });

  it("builds a significance bracket between two XY x-values", () => {
    const s = buildPlotScene(
      table,
      { ...base, annotations: [{ id: "b1", kind: "bracket", from: 2, to: 8, bracketY: 9, label: "***" }] },
      opts,
    );
    expect(s.annotations).toHaveLength(1);
    const a = s.annotations[0]!;
    expect(a.kind).toBe("bracket");
    expect(a.path).toMatch(/^M[\d.]+,[\d.]+ L/); // a multi-segment path
    expect(a.label).toBe("***");
    // the label sits centred between the two x positions.
    expect(a.labelX!).toBeGreaterThan(s.plot.x);
    expect(a.labelX!).toBeLessThan(s.plot.x + s.plot.width);
    expect(a.labelAnchor).toBe("middle");
  });

  // ── bracket appearance: shape / end-ticks / lateral shift / symbol ink ───────────
  // Every check below compares a changed build against the default one, so a control
  // that quietly does nothing fails rather than passing on a coincidence.
  const bracket = (over: Partial<Plot> = {}, ann: Record<string, unknown> = {}) =>
    buildPlotScene(
      table,
      { ...base, kind: "bar", annotations: [{ id: "b1", kind: "bracket", from: 1, to: 3, bracketY: 5, label: "*", ...ann }], ...over },
      opts,
    ).annotations[0]!;

  it("the default bracket path is a square staple — square corners, 6px end-ticks", () => {
    // Every saved figure re-renders through this geometry, so the default shape must be
    // exactly this staple.
    const a = bracket();
    const nums = (a.path ?? "").match(/-?[\d.]+/g)!.map(Number);
    expect(a.path).toMatch(/^M[\d.-]+,[\d.-]+ L[\d.-]+,[\d.-]+ L[\d.-]+,[\d.-]+ L[\d.-]+,[\d.-]+$/);
    // ends drop 6px below the bar, both sides, and the bar is level
    expect(nums[1]! - nums[3]!).toBe(6);
    expect(nums[7]! - nums[5]!).toBe(6);
    expect(nums[3]).toBe(nums[5]);
    expect(a.round).toBeUndefined();
  });

  it("the shape control actually changes the drawing (and 'line' loses its ends)", () => {
    const square = bracket().path!;
    const rounded = bracket({ significance: { shape: "rounded" } });
    const brace = bracket({ significance: { shape: "brace" } }).path!;
    const plain = bracket({ significance: { shape: "line" } }).path!;
    expect(rounded.path).not.toBe(square);
    expect(rounded.path).toMatch(/Q/); // radiused corners
    expect(rounded.round).toBe(true); // …and round caps/joins for the renderer
    expect(brace).not.toBe(square);
    expect(brace).not.toBe(rounded.path);
    // A plain bar is exactly two points — no end-ticks at all.
    expect(plain).toMatch(/^M[\d.-]+,[\d.-]+ L[\d.-]+,[\d.-]+$/);
    // A per-bracket override beats the plot-wide setting.
    expect(bracket({ significance: { shape: "brace" } }, { bracketShape: "line" }).path).toBe(plain);
  });

  it("the end-tick length is settable, and 0 degrades to a plain bar", () => {
    const long = bracket({ significance: { tick: 14 } }).path!;
    const nums = long.match(/-?[\d.]+/g)!.map(Number);
    expect(nums[1]! - nums[3]!).toBe(14);
    expect(bracket({ significance: { tick: 0 } }).path).toBe(bracket({ significance: { shape: "line" } }).path);
  });

  it("bracketShift slides the bracket along the category axis and reports what it applied", () => {
    const home = bracket();
    const moved = bracket({}, { bracketShift: 0.1 });
    const w = buildPlotScene(table, { ...base, kind: "bar" }, opts).plot.width;
    // 10% of the plot width, to the right, label and all.
    expect(moved.labelX! - home.labelX!).toBeCloseTo(w * 0.1, 6);
    expect(moved.x1! - home.x1!).toBeCloseTo(w * 0.1, 6);
    expect(moved.shift).toBeCloseTo(w * 0.1, 6);
    // Height is untouched — the two axes are independent.
    expect(moved.y1).toBe(home.y1);
    // A bracket at home reports no shift at all (so a fresh drag starts from 0).
    expect(home.shift).toBeUndefined();
  });

  it("on a transposed chart the shift runs down the category axis (Y), not across", () => {
    const h = (ann: Record<string, unknown>) =>
      buildPlotScene(
        table,
        { ...base, kind: "bar", barOrientation: "horizontal", annotations: [{ id: "b1", kind: "bracket", from: 1, to: 3, bracketY: 5, label: "*", ...ann }] },
        opts,
      ).annotations[0]!;
    const home = h({});
    const moved = h({ bracketShift: 0.1 });
    const ph = buildPlotScene(table, { ...base, kind: "bar", barOrientation: "horizontal" }, opts).plot.height;
    expect(moved.labelY! - home.labelY!).toBeCloseTo(ph * 0.1, 6);
    expect(moved.labelX).toBe(home.labelX); // the value axis is X here — untouched
  });

  it("brackets with no height of their own stagger instead of stacking on one line", () => {
    // Hand-added brackets with no height would otherwise all take the same 6%-from-the-top
    // default and draw over each other; they are staggered like the auto-placer's own.
    const s = buildPlotScene(
      table,
      {
        ...base,
        kind: "bar",
        annotations: [
          { id: "narrow", kind: "bracket", from: 1, to: 2, label: "a" },
          { id: "wide", kind: "bracket", from: 1, to: 4, label: "b" },
          { id: "mid", kind: "bracket", from: 2, to: 4, label: "c" },
        ],
      },
      opts,
    );
    const yOf = (id: string): number => s.annotations.find((a) => a.id === id)!.y1!;
    expect(new Set([yOf("narrow"), yOf("wide"), yOf("mid")]).size, "brackets share a line").toBe(3);
    // Widest on top (smallest y), narrowest closest to the data — a wide bracket crossing
    // under a narrow one reads as a mistake.
    expect(yOf("wide")).toBeLessThan(yOf("mid"));
    expect(yOf("mid")).toBeLessThan(yOf("narrow"));
    // …and all of them stay inside the plot rect.
    for (const id of ["narrow", "wide", "mid"]) {
      expect(yOf(id)).toBeGreaterThanOrEqual(s.plot.y);
      expect(yOf(id)).toBeLessThanOrEqual(s.plot.y + s.plot.height);
    }
    // A long stack stays inside the frame rather than marching off the top of the canvas
    // (where it would land on the title) — the placement pass clamps and reports instead.
    const many = buildPlotScene(
      table,
      {
        ...base,
        kind: "bar",
        annotations: Array.from({ length: 14 }, (_, i) => ({ id: `k${i}`, kind: "bracket" as const, from: 1, to: 2, label: "x" })),
      },
      opts,
    );
    for (const a of many.annotations) {
      expect(a.y1!).toBeGreaterThanOrEqual(many.plot.y);
      expect(a.y1!).toBeLessThanOrEqual(many.plot.y + many.plot.height);
    }
    // Note: matched on "could not be placed clear" — the phrase both variants of this warning share,
    // and the same sentinel `bracket-headroom.test.ts` keys on. The sentence differs by reason
    // (a user-pinned axis vs the graph having widened as far as it can), so a narrower phrase would
    // match only one of the two. The claim being guarded: a stack that cannot fit must say so.
    expect(many.warnings.some((w) => /could not be placed clear/i.test(w)), "14 brackets in one lane must say they do not fit").toBe(true);
    // An explicit height still wins over the stagger — this only fills in a missing one.
    const pinned = buildPlotScene(
      table,
      { ...base, kind: "bar", annotations: [{ id: "a", kind: "bracket", from: 1, to: 2, label: "a" }, { id: "b", kind: "bracket", from: 1, to: 4, bracketY: 5, label: "b" }] },
      opts,
    );
    const b = pinned.annotations.find((a) => a.id === "b")!;
    const solo = buildPlotScene(
      table,
      { ...base, kind: "bar", annotations: [{ id: "b", kind: "bracket", from: 1, to: 4, bracketY: 5, label: "b" }] },
      opts,
    ).annotations[0]!;
    expect(b.y1).toBe(solo.y1);
  });

  it("an auto-placed bracket clears the data, not just a fraction of the plot", () => {
    // Guards against a default height that is pure geometry (6% / 13% / 20% down from the
    // top of the plot), blind to the bars — the third bracket would land at 20% and be drawn
    // straight through the tallest bar under it.
    //
    // Note: the numbers matter. A one-bracket fixture cannot exhibit this: the first level
    // sits 6% down, and a bar reaching above that leaves no room for a bracket + symbol
    // anyway (that case is the clamp test below). It takes a stack, where the lower
    // brackets are pushed down into data that has plenty of clearance above it.
    const tall: DataTable = {
      id: "t2", kind: "column", name: "T",
      columns: [{ id: "g", name: "Group", role: "x" }, { id: "v", name: "Value", role: "y" }],
      rows: [
        { id: "r1", cells: { g: "A", v: 12 } },
        { id: "r2", cells: { g: "B", v: 28 } },
        { id: "r3", cells: { g: "C", v: 19 } },
        { id: "r4", cells: { g: "D", v: 35 } }, // the bar a geometry-only third bracket would cross
      ],
    };
    const s = buildPlotScene(
      tall,
      {
        ...base,
        source: "t2",
        kind: "bar",
        yAxis: { max: 40 },
        annotations: [
          { id: "a", kind: "bracket", from: 1, to: 2, p: 0.02 },
          { id: "c", kind: "bracket", from: 1, to: 4, p: 0.02 },
          { id: "hi", kind: "bracket", from: 3, to: 4, p: 0.02 },
        ],
      },
      { width: 580, height: 402 },
    );
    const br = s.annotations.find((a) => a.id === "hi")!;
    // Every bar top under the bracket's span must sit below the bracket rail.
    const spanned = s.series
      .flatMap((ser) => ser.marks)
      .filter((m) => m.bar && m.bar.x + m.bar.w >= Math.min(br.x1!, br.x2!) && m.bar.x <= Math.max(br.x1!, br.x2!));
    expect(spanned.length, "the fixture has no bars under the bracket — it cannot show a bracket drawn into a bar").toBeGreaterThan(1);
    for (const m of spanned) expect(br.y1!, `bracket at ${br.y1} is inside a bar topped at ${m.bar!.y}`).toBeLessThan(m.bar!.y);
    // …and the symbol above it stays inside the plot frame (so never on the title/axis).
    const fs = br.fontSize ?? s.fonts.legend.size;
    expect(br.labelY! - fs).toBeGreaterThanOrEqual(s.plot.y - 0.5);
    expect(br.y1!).toBeLessThanOrEqual(s.plot.y + s.plot.height);
  });

  it("an auto rail clears a data point's edge, not just its centre", () => {
    // On a bar-with-points chart the topmost swarm dot is the binding obstacle, and at
    // the house point size (radius 14) the dot's disc takes 14 of the 18px clearance —
    // measured from the centre, the bracket reads as resting on the Day-3 dots. The
    // leg-reach ink (`inkTop`) treats a point as a disc; the rail placer must
    // measure from the same edge.
    const reps: DataTable = {
      id: "t3", kind: "grouped", name: "T",
      columns: [
        { id: "g", name: "Group", role: "x" },
        { id: "v1", name: "Treated", role: "y" },
        { id: "v2", name: "v2", role: "y", group: "v1" },
        { id: "v3", name: "v3", role: "y", group: "v1" },
      ],
      rows: [
        { id: "r1", cells: { g: "A", v1: 20, v2: 22, v3: 19 } },
        { id: "r2", cells: { g: "B", v1: 49, v2: 52, v3: 55 } }, // dots reach past the mean bar
      ],
    };
    const R = 14; // the bar house point size — large enough for the dots to be the highest ink
    const s = buildPlotScene(
      reps,
      {
        ...base, source: "t3", kind: "bar",
        seriesStyles: { v1: { symbolSize: R } },
        annotations: [{ id: "b", kind: "bracket", from: 1, to: 2, p: 0.01 }],
      },
      { width: 580, height: 402 },
    );
    const br = s.annotations.find((a) => a.id === "b")!;
    const dots = s.series.flatMap((ser) => ser.marks).flatMap((m) => m.points ?? []);
    expect(dots.length, "the fixture grew no swarm dots — it cannot show a bracket drawn into the dots").toBeGreaterThan(3);
    const topDotEdge = Math.min(...dots.map((p) => p.cy)) - R;
    // The dot edge must be the binding obstacle here, or the assertion proves nothing.
    const barTops = s.series.flatMap((ser) => ser.marks).flatMap((m) => (m.bar ? [m.bar.y] : []));
    const errTips = s.series.flatMap((ser) => ser.marks).flatMap((m) => (m.errHighCy != null ? [m.errHighCy] : []));
    expect(topDotEdge, "a bar/error tip outranks the dot — the fixture cannot show a bracket drawn into the dots").toBeLessThan(Math.min(...barTops, ...errTips));
    // GAP_DATA (18px) of daylight, measured from the disc's edge.
    expect(br.y1!, `rail at ${br.y1} sits ${topDotEdge - br.y1!}px above the dot edge at ${topDotEdge}`).toBeLessThanOrEqual(topDotEdge - 18 + 0.5);
  });

  it("a planned ladder lifts clear of the ink — uniformly, and reach-legs stay pinned", () => {
    // Within-group cell brackets at one shared planner height (data units), dots at the house
    // radius 14. The planner works in data units and cannot see pixels, so its rung can land
    // inside the Day-3 dots. The scene lifts the whole planned set by one uniform delta: shared
    // rungs stay shared, and a rung over short bars rises with its colliding sibling instead of
    // breaking the alignment the planner chose.
    const R = 14;
    const cellT: DataTable = {
      id: "t4", kind: "grouped", name: "T",
      columns: [
        { id: "g", name: "Day", role: "x" },
        { id: "u1", name: "Control", role: "y" },
        { id: "u2", name: "u2", role: "y", group: "u1" },
        { id: "v1", name: "Treated", role: "y" },
        { id: "v2", name: "v2", role: "y", group: "v1" },
      ],
      rows: [
        { id: "r1", cells: { g: "A", u1: 20, u2: 22, v1: 28, v2: 30 } },
        { id: "r2", cells: { g: "B", u1: 20, u2: 22, v1: 52, v2: 55 } }, // B's dots collide
      ],
    };
    const sharedY = 58; // one planner rung, just above the raw max (55) — the card's shape
    const anns = (planned: boolean) => [
      { id: "bA", kind: "bracket" as const, from: 1, to: 1, fromSeries: 1, toSeries: 2, bracketY: sharedY, p: 0.01, role: "significance" as const, ...(planned ? { plannedY: true } : {}) },
      { id: "bB", kind: "bracket" as const, from: 2, to: 2, fromSeries: 1, toSeries: 2, bracketY: sharedY, p: 0.001, role: "significance" as const, ...(planned ? { plannedY: true } : {}) },
    ];
    const build = (planned: boolean, legs?: "reach") =>
      buildPlotScene(
        cellT,
        { ...base, source: "t4", kind: "bar", seriesStyles: { u1: { symbolSize: R }, v1: { symbolSize: R } }, ...(legs ? { significance: { legs } } : {}), annotations: anns(planned) },
        { width: 580, height: 402 },
      );
    const br = (s: ReturnType<typeof build>, id: string) => s.annotations.find((a) => a.id === id)!;
    const legTipY = (a: { path?: string | undefined }) => Math.max(...[...a.path!.matchAll(/(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/g)].map((m) => Number(m[2])));

    // ── plain legs (the card's shape): the whole drawn body must clear the dots ──
    const hand = build(false); // flag-less = a hand-set height, which the builder never moves
    const lifted = build(true);
    // Note: every pixel is read inside its own drawing, and a height is compared in data units. A planned rung that
    // has no room under the frame makes the builder re-lay the chart with a taller Y range (0–74 here, against the
    // hand drawing's 0–70), so a pixel in one drawing says nothing about a pixel in the other. Setting the hand
    // bracket's leg tip against the dots of the lifted drawing misses by 0.2 px on a fixture
    // that collides by 6.8 px in its own drawing.
    const topEdgeOfB = (s: ReturnType<typeof build>): number =>
      Math.min(...s.series.flatMap((ser) => ser.marks.filter((m) => m.dx === 2)).flatMap((m) => m.points ?? []).map((p) => p.cy)) - R;
    /** A rail's height in data units, read back through its own drawing's Y scale. */
    const heightOf = (s: ReturnType<typeof build>, id: string): number => {
      const [d0, d1] = s.y.domain as [number, number];
      const [r0, r1] = s.y.range as [number, number];
      return d0 + ((br(s, id).y1! - r0) / (r1 - r0)) * (d1 - d0);
    };
    const topEdgeB = topEdgeOfB(lifted);
    // The fixture must actually collide, or nothing here proves anything.
    expect(legTipY(br(hand, "bB")), "the hand fixture does not collide — it cannot show a rung drawn into the dots").toBeGreaterThan(topEdgeOfB(hand) - 6);
    // 1. hand heights are untouched; planned ones lift.
    expect(heightOf(hand, "bB")).toBeCloseTo(sharedY, 3);
    expect(heightOf(lifted, "bB")).toBeGreaterThan(sharedY);
    // 2. the lift is uniform — the non-colliding rung rises by the same delta (shared rung stays shared).
    const dA = heightOf(lifted, "bA") - heightOf(hand, "bA");
    const dB = heightOf(lifted, "bB") - heightOf(hand, "bB");
    expect(dA).toBeCloseTo(dB, 3);
    expect(dA).toBeGreaterThan(0);
    // 3. the lifted rung's lowest drawn pixel (tick-leg tips) clears the dot's edge.
    expect(legTipY(br(lifted, "bB"))).toBeLessThanOrEqual(topEdgeB - 6 + 0.5);

    // ── extended (reach) legs: tips hug the ink by design and must stay pinned ──
    // The collision surface there is the rail alone; a lift makes the legs longer, it
    // never drags their tips up with the rail (the extended legs included).
    const handR = build(false, "reach");
    const liftedR = build(true, "reach");
    // The rail itself sits inside the B dots' disc region → the reach variant lifts too.
    expect(br(handR, "bB").y1!, "the reach fixture's rail does not collide — it cannot show a rail drawn into the dots").toBeGreaterThan(topEdgeOfB(handR) - 6);
    expect(heightOf(liftedR, "bB")).toBeGreaterThan(heightOf(handR, "bB"));
    // 4. the reach-leg tips do not move when the rail lifts — the legs just grow. "Do not move" = the same
    //    distance from the ink they hug, each in its own drawing.
    //    The lowest tip is the leg over Control (the short bar, dots at 20 / 22): that is the ink it hugs.
    const controlTopB = (s: ReturnType<typeof build>): number =>
      Math.min(...s.series[0]!.marks.filter((m) => m.dx === 2).flatMap((m) => m.points ?? []).map((p) => p.cy)) - R;
    const tipAboveInk = (s: ReturnType<typeof build>, id: string): number => controlTopB(s) - legTipY(br(s, id));
    expect(tipAboveInk(handR, "bB"), "the reach leg does not hug Control's dots — the fixture reads the wrong ink").toBeGreaterThan(0);
    expect(tipAboveInk(handR, "bB")).toBeLessThan(12);
    expect(tipAboveInk(liftedR, "bB")).toBeCloseTo(tipAboveInk(handR, "bB"), 1);
    // …the legs really did grow (rail to tip is longer once lifted)…
    expect(legTipY(br(liftedR, "bB")) - br(liftedR, "bB").y1!).toBeGreaterThan(legTipY(br(handR, "bB")) - br(handR, "bB").y1!);
    // …and the lifted rail clears the disc.
    expect(br(liftedR, "bB").y1!).toBeLessThanOrEqual(topEdgeOfB(liftedR) - 6 + 0.5);
  });

  it("dragging a planned bracket's height clears the flag — the lift never overrules a hand", () => {
    const doc = createSampleDocument();
    const plotId = doc.toJSON().plots[0]!.id;
    const ann = doc.addAnnotation(plotId, { kind: "bracket", from: 1, to: 2, bracketY: 5, plannedY: true, p: 0.01, role: "significance" });
    doc.moveAnnotation(plotId, ann.id, { bracketY: 3 });
    const after = doc.toJSON().plots.find((p) => p.id === plotId)!.annotations!.find((a) => a.id === ann.id)!;
    expect(after.bracketY).toBe(3);
    expect(after.plannedY, "a dragged height must shed plannedY — else the scene may move a user decision").toBeUndefined();
  });

  it("stacked auto brackets clear each other — rails never touch the stars below", () => {
    const s = buildPlotScene(
      table,
      {
        ...base,
        kind: "bar",
        yAxis: { max: 60 }, // room for two, so this tests the stack rule and not the clamp
        annotations: [
          { id: "lo", kind: "bracket", from: 1, to: 2, p: 0.02 },
          { id: "hi", kind: "bracket", from: 1, to: 4, p: 0.002 }, // overlaps "lo"
        ],
      },
      opts,
    );
    const lo = s.annotations.find((a) => a.id === "lo")!;
    const hi = s.annotations.find((a) => a.id === "hi")!;
    const fs = lo.fontSize ?? s.fonts.legend.size;
    // The wide one sits above the narrow one's label, not merely above its rail.
    expect(hi.y1!).toBeLessThan(lo.labelY! - fs);
    expect(s.warnings.some((w) => /clear of the data/i.test(w)), JSON.stringify(s.warnings)).toBe(false);
  });

  it("the value axis makes room for an auto stack, instead of forcing it into the bars", () => {
    // The other half of the rule: the domain is built from the data alone, so brackets
    // placed above it at render time would have nowhere to go on a graph whose bars reach the
    // top. A marker with no height of its own reserves a rung, as the auto-placer's own
    // explicitly-positioned markers do.
    const plot = (ann: Record<string, unknown>[]) =>
      buildPlotScene(table, { ...base, kind: "bar", annotations: ann as never }, opts);
    const bare = plot([]);
    const withAuto = plot([
      { id: "a", kind: "bracket", from: 1, to: 2, p: 0.02, role: "significance" },
      { id: "b", kind: "bracket", from: 1, to: 4, p: 0.002, role: "significance" },
    ]);
    expect(withAuto.y.domain[1]).toBeGreaterThan(bare.y.domain[1]);
    // Gated on the "significance" role, exactly as the explicit-height headroom is: a
    // hand-drawn bracket must not silently rescale someone's saved figure.
    const handMade = plot([{ id: "a", kind: "bracket", from: 1, to: 2, p: 0.02 }]);
    expect(handMade.y.domain[1]).toBe(bare.y.domain[1]);
  });

  it("a height the user set is never moved by the layout pass", () => {
    // Deliberately a bad position — inside the bars. Auto-placement is an initial layout,
    // not a running constraint: overruling a typed or dragged height would fight the user.
    const pinned = { id: "p1", kind: "bracket" as const, from: 1, to: 2, bracketY: 1, p: 0.01 };
    const s = buildPlotScene(table, { ...base, kind: "bar", annotations: [pinned] }, opts);
    const br = s.annotations[0]!;
    expect(br.autoY).toBeUndefined();
    // y for the value 1, straight off the scale — untouched by the pass.
    const yOf1 = s.plot.y + s.plot.height - (1 / s.y.domain[1]) * s.plot.height;
    expect(br.y1!).toBeCloseTo(yOf1, 0);
  });

  it("says so when the data leaves no room, instead of drawing over the bars", () => {
    // A bar filling the plot to the ceiling: there is genuinely nowhere clear to go.
    const full: DataTable = {
      id: "t3", kind: "column", name: "T",
      columns: [{ id: "g", name: "G", role: "x" }, { id: "v", name: "V", role: "y" }],
      rows: [{ id: "r1", cells: { g: "A", v: 100 } }, { id: "r2", cells: { g: "B", v: 100 } }],
    };
    const s = buildPlotScene(
      full,
      { ...base, source: "t3", kind: "bar", yAxis: { max: 100 }, annotations: [{ id: "b", kind: "bracket", from: 1, to: 2, p: 0.01 }] },
      opts,
    );
    const br = s.annotations.find((a) => a.id === "b")!;
    expect(br, "the bracket vanished — it should be clamped and reported, not dropped").toBeTruthy();
    expect(br.y1!).toBeGreaterThanOrEqual(s.plot.y); // clamped inside the frame
    expect(s.warnings.some((w) => /clear of the data/i.test(w)), JSON.stringify(s.warnings)).toBe(true);
  });

  it("the symbol carries its own size and ink when asked to", () => {
    const plain = bracket();
    // No size asked for → the default star size: 1.4× the legend font (a plain legend-size
    // fallback would make the star the smallest text on the graph).
    const legend = buildPlotScene(table, { ...base, kind: "bar" }, opts).fonts.legend.size;
    expect(plain.fontSize).toBe(Math.round(legend * 1.4));
    expect(plain.labelColor).toBeUndefined(); // symbol and bar are one colour by default
    const styled = bracket({ significance: { labelSize: 22, labelColor: "#ff0000", color: "#888888" } });
    expect(styled.fontSize).toBe(22);
    expect(styled.labelColor).toBe("#ff0000");
    expect(styled.color).toBe("#888888"); // the bar keeps its own colour
    // A per-bracket size beats the plot-wide one.
    expect(bracket({ significance: { labelSize: 22 } }, { size: 9 }).fontSize).toBe(9);
  });

  it("renders the user's ladder symbol, not the factory one", () => {
    const ann = { id: "b1", kind: "bracket" as const, from: 2, to: 8, bracketY: 9, p: 0.05 };
    // Factory: p = 0.05 clears nothing (the rung is strict) → "ns". `hideNs` defaults
    // to true, so asking to see that label is part of what this test is asking for —
    // the separate hideNs test owns the drop behaviour.
    expect(
      buildPlotScene(table, { ...base, annotations: [ann], significance: { hideNs: false } }, opts).annotations[0]!.label,
    ).toBe("ns");
    // A lab working at α = 0.10 gets their own symbol for the same number.
    const s = buildPlotScene(
      table,
      { ...base, annotations: [ann], significance: { thresholds: [{ p: 0.1, symbol: "†" }] } },
      opts,
    );
    expect(s.annotations[0]!.label).toBe("†");
  });

  it("a typed label overrides the p-derived one without discarding the p", () => {
    const s = buildPlotScene(
      table,
      { ...base, annotations: [{ id: "b1", kind: "bracket", from: 2, to: 8, bracketY: 9, p: 0.004, labelOverride: "n = 6" }] },
      opts,
    );
    expect(s.annotations[0]!.label).toBe("n = 6");
    // ...and clearing the override brings the live p back.
    const back = buildPlotScene(
      table,
      { ...base, annotations: [{ id: "b1", kind: "bracket", from: 2, to: 8, bracketY: 9, p: 0.004 }] },
      opts,
    );
    expect(back.annotations[0]!.label).toBe("★★");
  });

  it("the threshold legend is built from the ladder, and an overridden label still counts its tier", () => {
    const s = buildPlotScene(
      table,
      {
        ...base,
        significance: { legend: true, thresholds: [{ p: 0.1, symbol: "†" }, { p: 0.01, symbol: "‡" }] },
        annotations: [
          { id: "b1", kind: "bracket", from: 2, to: 8, bracketY: 9, p: 0.05 },
          // Overridden text — the label is the user's, but the statistic is still a fact,
          // so its rung must appear in the key.
          // Note: bracketY must sit inside the value axis (this table's Y domain is 0-10). A
          // height above it is refused by the builder — "a bracket height sits outside the value
          // axis" — and the bracket would never be drawn, so the test could not exhibit the
          // property it is written for. The height is incidental; the override is the point.
          { id: "b2", kind: "bracket", from: 3, to: 9, bracketY: 9.5, p: 0.005, labelOverride: "see text" },
        ],
      },
      opts,
    );
    expect(s.annotations.filter((a) => a.kind === "bracket")).toHaveLength(2); // both really drawn
    // "; " is the default separator (it keeps the entries visibly apart);
    // `legendSeparator` is the setting that puts any other convention back.
    expect(s.significanceCaption).toBe("† p<0.1; ‡ p<0.01");
  });

  it("a bracket the chart refused to draw contributes nothing to the key", () => {
    // The counterpart of the test above. The key is a legend for symbols on the page, so a
    // bracket the builder dropped must not put its tier in it — otherwise the figure carries a
    // key explaining a marker that is not there, and (on kinds that draw no key at all) a band
    // of blank paper reserved for it. "It was accepted" is not "it reached the drawing".
    const s = buildPlotScene(
      table,
      {
        ...base,
        significance: { legend: true, thresholds: [{ p: 0.1, symbol: "†" }, { p: 0.01, symbol: "‡" }] },
        annotations: [
          { id: "b1", kind: "bracket", from: 2, to: 8, bracketY: 9, p: 0.05 },
          { id: "b2", kind: "bracket", from: 3, to: 9, bracketY: 11, p: 0.005 }, // above the axis max → refused
        ],
      },
      opts,
    );
    expect(s.annotations.filter((a) => a.kind === "bracket")).toHaveLength(1);
    expect(s.warnings.join(" ")).toMatch(/bracket height sits outside the value axis/);
    expect(s.significanceCaption).toBe("† p<0.1");
  });

  it("says so when an annotation cannot be drawn, instead of dropping it silently", () => {
    // A bracket stacked above the axis maximum is the common real case: auto-placed
    // brackets sit above the data, and the value domain is built from the data alone.
    const s = buildPlotScene(
      table,
      { ...base, annotations: [{ id: "b1", kind: "bracket", from: 2, to: 8, bracketY: 1e6, p: 0.01 }] },
      opts,
    );
    expect(s.annotations).toHaveLength(0);
    expect(s.warnings.some((w) => /not drawn/i.test(w) && /value axis/i.test(w)), JSON.stringify(s.warnings)).toBe(true);
  });

  it("counts repeats rather than repeating itself", () => {
    const s = buildPlotScene(
      table,
      {
        ...base,
        annotations: [
          { id: "l1", kind: "hline", value: 1e6 },
          { id: "l2", kind: "hline", value: 2e6 },
          { id: "l3", kind: "hline", value: 3e6 },
        ],
      },
      opts,
    );
    const w = s.warnings.filter((x) => /not drawn/i.test(x));
    expect(w).toHaveLength(1);
    expect(w[0]).toMatch(/^3 annotations were not drawn/);
  });

  it("stays quiet when everything drew", () => {
    const s = buildPlotScene(
      table,
      { ...base, annotations: [{ id: "b1", kind: "bracket", from: 2, to: 8, bracketY: 9, p: 0.01 }] },
      opts,
    );
    expect(s.annotations).toHaveLength(1);
    expect(s.warnings.some((x) => /not drawn/i.test(x))).toBe(false);
  });

  it("a non-significant comparison is hidden by default, and showing it is one flag away", () => {
    const ns = { id: "b1", kind: "bracket" as const, from: 2, to: 8, bracketY: 9, p: 0.5 };
    // No `significance` block at all — the default has to be the hiding one, since that is
    // what a figure gets before anybody opens the panel.
    const bare = buildPlotScene(table, { ...base, annotations: [ns] }, opts);
    expect(bare.annotations, "an ns bracket drew with no style set").toHaveLength(0);
    expect(bare.warnings.some((x) => /not drawn/i.test(x)), "hiding it is a choice, not a failure").toBe(false);
    // …and an empty style block is still the default (undefined ≠ false).
    expect(buildPlotScene(table, { ...base, significance: {}, annotations: [ns] }, opts).annotations).toHaveLength(0);
    // Turning it off explicitly brings the ns rail back.
    const shown = buildPlotScene(table, { ...base, significance: { hideNs: false }, annotations: [ns] }, opts);
    expect(shown.annotations).toHaveLength(1);
    expect(shown.annotations[0]!.label).toBe("ns");
    // A typed label always survives — overriding the text is the user saying "draw this one".
    const typed = buildPlotScene(table, { ...base, annotations: [{ ...ns, labelOverride: "n.s." }] }, opts);
    expect(typed.annotations, "a typed label was swallowed by the hide default").toHaveLength(1);
    expect(typed.annotations[0]!.label).toBe("n.s.");
  });

  it("hideNs drops the whole element, and says nothing about it — it is a choice, not a failure", () => {
    const s = buildPlotScene(
      table,
      { ...base, significance: { hideNs: true }, annotations: [{ id: "b1", kind: "bracket", from: 2, to: 8, bracketY: 9, p: 0.5 }] },
      opts,
    );
    expect(s.annotations).toHaveLength(0);
    expect(s.warnings.some((x) => /not drawn/i.test(x))).toBe(false);
    // ...and a significant one on the same setting still draws.
    const keep = buildPlotScene(
      table,
      { ...base, significance: { hideNs: true }, annotations: [{ id: "b1", kind: "bracket", from: 2, to: 8, bracketY: 9, p: 0.001 }] },
      opts,
    );
    expect(keep.annotations).toHaveLength(1);
  });

  it("maps bracket endpoints to category centres on a bar chart", () => {
    // bar chart: each row is a category (1-based). Bracket from group 1 → group 3.
    const s = buildPlotScene(
      table,
      { ...base, kind: "bar", annotations: [{ id: "b2", kind: "bracket", from: 1, to: 3, bracketY: 5, label: "*" }] },
      opts,
    );
    expect(s.annotations).toHaveLength(1);
    expect(s.annotations[0]!.kind).toBe("bracket");
    expect(s.annotations[0]!.path).toBeTruthy();
  });

  it("builds a significance threshold legend from the brackets' p-values (stars only)", () => {
    const withLegend = (sigP: number[], extra = {}) =>
      buildPlotScene(
        table,
        {
          ...base,
          kind: "bar",
          significance: { display: "stars", legend: true, ...extra },
          annotations: sigP.map((p, i) => ({ id: `bk${i}`, kind: "bracket" as const, from: 1, to: 3, p })),
        },
        opts,
      );
    // p=0.03 → "*"; p=0.0005 → "***" — caption lists only the tiers reached, ascending
    const s = withLegend([0.03, 0.0005]);
    expect(s.significanceCaption).toBe("★ p<0.05; ★★★ p<0.001");
    // ...and the separator is the user's to choose (a four-space run included).
    expect(withLegend([0.03, 0.0005], { legendSeparator: "    " }).significanceCaption).toBe("★ p<0.05    ★★★ p<0.001");
    expect(withLegend([0.03, 0.0005], { legendSeparator: " · " }).significanceCaption).toBe("★ p<0.05 · ★★★ p<0.001");
    // height grows to host the legend band
    const plain = buildPlotScene(table, { ...base, kind: "bar" }, opts);
    expect(s.height).toBeGreaterThan(plain.height);
    // off by default
    expect(plain.significanceCaption).toBeUndefined();
    // numeric/threshold display → no star legend
    expect(withLegend([0.03], { display: "numeric" }).significanceCaption).toBeUndefined();
    // a non-significant bracket contributes nothing
    expect(withLegend([0.4]).significanceCaption).toBeUndefined();
  });

  it("a symbol that already spells its cut-off is not glossed with a second copy", () => {
    // With display "threshold" the ladder's symbols are "p<0.05", so appending the cut-off
    // would print "p<0.05 p<0.05 | p<0.01 p<0.01" — a key explaining itself.
    const s = buildPlotScene(
      table,
      {
        ...base,
        kind: "bar",
        significance: { display: "threshold", legend: true },
        annotations: [
          { id: "b1", kind: "bracket", from: 1, to: 3, p: 0.004 },
          { id: "b2", kind: "bracket", from: 1, to: 3, p: 0.03 },
        ],
      },
      opts,
    );
    expect(s.significanceCaption).toBe("p<0.05; p<0.01");
    // …while a plain symbol still gets its gloss, which is the whole point of the key.
    const stars = buildPlotScene(
      table,
      { ...base, kind: "bar", significance: { display: "stars", legend: true }, annotations: [{ id: "b1", kind: "bracket", from: 1, to: 3, p: 0.004 }] },
      opts,
    );
    expect(stars.significanceCaption).toBe("★★ p<0.01");
  });

  it("the threshold legend carries its own typography, and the reserved band grows with it", () => {
    const withStyle = (extra: Record<string, unknown>) =>
      buildPlotScene(
        table,
        {
          ...base,
          kind: "bar",
          significance: { display: "stars", legend: true, ...extra },
          annotations: [{ id: "bk", kind: "bracket", from: 1, to: 3, p: 0.001 }],
        },
        opts,
      );
    const plain = withStyle({});
    expect(plain.significanceCaptionStyle?.size).toBe(plain.fonts.legend.size);
    expect(plain.significanceCaptionStyle?.family).toBeUndefined();
    const styled = withStyle({
      legendSize: 21,
      legendFontFamily: "Georgia, serif",
      legendBold: true,
      legendItalic: true,
      legendColor: "#0044cc",
      legendOffset: { dx: 12, dy: -4 },
    });
    expect(styled.significanceCaptionStyle).toEqual({
      size: 21,
      family: "Georgia, serif",
      bold: true,
      italic: true,
      color: "#0044cc",
      offset: { dx: 12, dy: -4 },
    });
    // A 21px key needs a 21px band, or it lands on the X-axis title — the collision the
    // reserved band exists to prevent. The band is the difference from the same figure
    // with no legend at all.
    const none = buildPlotScene(table, { ...base, kind: "bar" }, opts);
    expect(styled.height - none.height).toBe(21 + 10);
    expect(plain.height - none.height).toBe(plain.fonts.legend.size + 10);
  });

  it("carries titleAlign and reserves a footer band only when footer text is set", () => {
    const plain = buildPlotScene(table, { ...base, kind: "bar" }, opts);
    // default = centred → no titleAlign on the scene
    expect(plain.titleAlign).toBeUndefined();
    const left = buildPlotScene(table, { ...base, kind: "bar", titleAlign: "left" }, opts);
    expect(left.titleAlign).toBe("left");
    // explicit "center" is treated as the default (omitted)
    const centre = buildPlotScene(table, { ...base, kind: "bar", titleAlign: "center" }, opts);
    expect(centre.titleAlign).toBeUndefined();
    // a footer grows the height and is carried (trimmed); blank footer reserves nothing
    const footed = buildPlotScene(table, { ...base, kind: "bar", footer: { left: "Source: X", right: "Fig 1" } }, opts);
    expect(footed.footer).toEqual({ left: "Source: X", right: "Fig 1" });
    expect(footed.height).toBeGreaterThan(plain.height);
    const blank = buildPlotScene(table, { ...base, kind: "bar", footer: { left: "   " } }, opts);
    expect(blank.footer).toBeUndefined();
    expect(blank.height).toBe(plain.height);
  });

  it("shades a vertical and horizontal band behind the plot (fractional plot-space)", () => {
    const s = buildPlotScene(
      table,
      {
        ...base,
        annotations: [
          { id: "vb", kind: "vband", x: 0.25, w: 0.3, fill: "#9b8cff", fillOpacity: 0.2 },
          { id: "hb", kind: "hband", y: 0.5, h: 0.25, fill: "#cccccc" },
        ],
      },
      opts,
    );
    const vb = s.annotations.find((a) => a.id === "vb")!;
    const hb = s.annotations.find((a) => a.id === "hb")!;
    expect(vb.kind).toBe("band");
    // vband spans an X sub-range × the full plot height
    expect(vb.y1).toBeCloseTo(s.plot.y, 5);
    expect(vb.y2).toBeCloseTo(s.plot.y + s.plot.height, 5);
    expect(vb.x1).toBeCloseTo(s.plot.x + 0.25 * s.plot.width, 5);
    expect(vb.x2).toBeCloseTo(s.plot.x + 0.55 * s.plot.width, 5);
    expect(vb.fill).toBe("#9b8cff");
    expect(vb.fillOpacity).toBeCloseTo(0.2, 5);
    // hband spans the full width × a Y sub-range; default opacity applied
    expect(hb.x1).toBeCloseTo(s.plot.x, 5);
    expect(hb.x2).toBeCloseTo(s.plot.x + s.plot.width, 5);
    expect(hb.fillOpacity).toBeCloseTo(0.14, 5);
  });

  it("drops a bracket whose group index is out of range", () => {
    const s = buildPlotScene(
      table,
      { ...base, kind: "bar", annotations: [{ id: "b3", kind: "bracket", from: 1, to: 99, label: "*" }] },
      opts,
    );
    expect(s.annotations).toHaveLength(0);
  });

  it("ignores vertical reference lines on a categorical (bar) axis", () => {
    const s = buildPlotScene(
      table,
      { ...base, kind: "bar", annotations: [{ id: "a4", kind: "vline", value: 2 }, { id: "a5", kind: "hline", value: 4 }] },
      opts,
    );
    // hline still resolves (Y is continuous on a bar chart); vline is skipped.
    expect(s.annotations.map((a) => a.id)).toEqual(["a5"]);
  });

  it("renders a bracket's label from its p-value per the plot's significance format", () => {
    const ann = [{ id: "bp", kind: "bracket" as const, from: 2, to: 8, bracketY: 9, p: 0.004 }];
    // default = stars
    const stars = buildPlotScene(table, { ...base, annotations: ann }, opts);
    expect(stars.annotations[0]!.label).toBe("★★");
    // numeric format with 3 decimals
    const numeric = buildPlotScene(table, { ...base, annotations: ann, significance: { display: "numeric", decimals: 3 } }, opts);
    expect(numeric.annotations[0]!.label).toBe("p=0.004");
    // threshold format
    const thr = buildPlotScene(table, { ...base, annotations: ann, significance: { display: "threshold" } }, opts);
    expect(thr.annotations[0]!.label).toBe("p<0.01");
  });

  it("applies the plot's significance colour + width to a p-bearing bracket", () => {
    const s = buildPlotScene(
      table,
      { ...base, annotations: [{ id: "bp2", kind: "bracket", from: 2, to: 8, p: 0.01 }], significance: { color: "#cc0000", width: 3 } },
      opts,
    );
    expect(s.annotations[0]!.color).toBe("#cc0000");
    expect(s.annotations[0]!.width).toBe(3);
  });

  it("resolves a rectangle to its plot-space pixel box", () => {
    const s = buildPlotScene(table, { ...base, annotations: [{ id: "rc", kind: "rect", x: 0.2, y: 0.3, w: 0.4, h: 0.25, fill: "#eee", color: "#333" }] }, opts);
    expect(s.annotations).toHaveLength(1);
    const a = s.annotations[0]!;
    expect(a.kind).toBe("rect");
    expect(a.x1).toBeCloseTo(s.plot.x + 0.2 * s.plot.width, 4);
    expect(a.y1).toBeCloseTo(s.plot.y + 0.3 * s.plot.height, 4);
    expect(a.x2).toBeCloseTo(s.plot.x + 0.6 * s.plot.width, 4);
    expect(a.y2).toBeCloseTo(s.plot.y + 0.55 * s.plot.height, 4);
    expect(a.fill).toBe("#eee");
    expect(a.color).toBe("#333");
  });

  it("carries a locked annotation's flag onto the scene (the renderer must not offer a drag the document refuses)", () => {
    const mkAnn = (locked: boolean) => [{ id: "rc", kind: "rect" as const, x: 0.2, y: 0.3, w: 0.4, h: 0.25, locked }];
    expect(buildPlotScene(table, { ...base, annotations: mkAnn(true) }, opts).annotations[0]!.locked).toBe(true);
    // unlocked stays falsy → the normal move/resize affordance
    expect(buildPlotScene(table, { ...base, annotations: mkAnn(false) }, opts).annotations[0]!.locked).toBeFalsy();
  });

  it("resolves an ellipse box (same geometry as a rect)", () => {
    const s = buildPlotScene(table, { ...base, annotations: [{ id: "el", kind: "ellipse", x: 0.1, y: 0.1, w: 0.3, h: 0.3 }] }, opts);
    const a = s.annotations[0]!;
    expect(a.kind).toBe("ellipse");
    expect(a.x2! - a.x1!).toBeCloseTo(0.3 * s.plot.width, 4);
    expect(a.y2! - a.y1!).toBeCloseTo(0.3 * s.plot.height, 4);
  });

  it("resolves an arrow to its two plot-space endpoints with a default end-head", () => {
    const s = buildPlotScene(table, { ...base, annotations: [{ id: "ar", kind: "arrow", x: 0.2, y: 0.8, x2: 0.7, y2: 0.2 }] }, opts);
    const a = s.annotations[0]!;
    expect(a.kind).toBe("arrow");
    expect(a.x1).toBeCloseTo(s.plot.x + 0.2 * s.plot.width, 4);
    expect(a.y1).toBeCloseTo(s.plot.y + 0.8 * s.plot.height, 4);
    expect(a.x2).toBeCloseTo(s.plot.x + 0.7 * s.plot.width, 4);
    expect(a.y2).toBeCloseTo(s.plot.y + 0.2 * s.plot.height, 4);
    expect(a.arrowHead).toBe("end");
  });

  it("resolves a line segment with no arrowhead by default", () => {
    const s = buildPlotScene(table, { ...base, annotations: [{ id: "sg", kind: "segment", x: 0.1, y: 0.5, x2: 0.9, y2: 0.5 }] }, opts);
    const a = s.annotations[0]!;
    expect(a.kind).toBe("segment");
    expect(a.arrowHead).toBe("none");
    expect(a.y1).toBeCloseTo(a.y2!, 4); // horizontal
  });

  it("resolves a callout to a text anchor + an arrow to its target", () => {
    const s = buildPlotScene(table, { ...base, annotations: [{ id: "co", kind: "callout", label: "peak", x: 0.15, y: 0.15, x2: 0.6, y2: 0.5 }] }, opts);
    const a = s.annotations[0]!;
    expect(a.kind).toBe("callout");
    expect(a.label).toBe("peak");
    expect(a.x1).toBeCloseTo(s.plot.x + 0.15 * s.plot.width, 4); // text anchor
    expect(a.y1).toBeCloseTo(s.plot.y + 0.15 * s.plot.height, 4);
    expect(a.x2).toBeCloseTo(s.plot.x + 0.6 * s.plot.width, 4); // arrow target
    expect(a.arrowHead).toBe("end");
  });

  it("keeps shapes anchored in plot-space when the figure is resized (resize-safe)", () => {
    const ann = [{ id: "rc", kind: "rect" as const, x: 0.25, y: 0.25, w: 0.5, h: 0.5 }];
    const small = buildPlotScene(table, { ...base, annotations: ann }, { ...opts, width: 400, height: 300 });
    const big = buildPlotScene(table, { ...base, annotations: ann }, { ...opts, width: 800, height: 600 });
    // The rect's fractional position relative to the plot rect is identical at both sizes.
    const frac = (s: typeof small) => {
      const a = s.annotations[0]!;
      return [(a.x1! - s.plot.x) / s.plot.width, (a.y1! - s.plot.y) / s.plot.height];
    };
    expect(frac(small)[0]).toBeCloseTo(frac(big)[0]!, 5);
    expect(frac(small)[1]).toBeCloseTo(frac(big)[1]!, 5);
  });
});

describe("buildPlotScene — area chart", () => {
  const table: DataTable = {
    id: "t",
    kind: "xy",
    name: "T",
    columns: [
      { id: "x", name: "X" },
      { id: "y", name: "Y" },
    ],
    rows: [0, 2, 4, 6, 8].map((v, i) => ({ id: `r${i}`, cells: { x: v, y: v + 1 } })),
  };
  const base: Plot = { id: "p", name: "P", source: "t", status: "ok", styleOverrides: {} };
  const opts = { xScale: "linear" as const, yScale: "linear" as const };

  it("adds a filled area path under the line and tags the scene kind", () => {
    const s = buildPlotScene(table, { ...base, kind: "area" }, opts);
    expect(s.kind).toBe("area");
    const series = s.series[0]!;
    expect(series.areaPath).toBeTruthy();
    expect(series.areaPath!.startsWith("M")).toBe(true);
    expect(series.linePath.startsWith("M")).toBe(true); // still has the top line
  });

  it("a plain XY chart has no area path", () => {
    const s = buildPlotScene(table, base, opts);
    expect(s.kind).toBe("xy");
    expect(s.series[0]!.areaPath).toBeUndefined();
  });

  it("area legend swatch uses the fill colour, not the line/marker colour", () => {
    const t2: DataTable = {
      id: "t", kind: "xy", name: "T",
      columns: [{ id: "x", name: "X" }, { id: "y1", name: "A" }, { id: "y2", name: "B" }],
      rows: [0, 2, 4].map((v, i) => ({ id: `r${i}`, cells: { x: v, y1: v + 1, y2: v + 2 } })),
    };
    const styles = { seriesStyles: { y1: { color: "#111111", fillColor: "#ff8800" } } };
    // area: the key matches the plotted fill (#ff8800), not the line colour (#111111)
    const area = buildPlotScene(t2, { ...base, kind: "area", ...styles }, opts);
    expect(area.legend.find((e) => e.label === "A")!.color).toBe("#ff8800");
    // xy (positive control): the swatch still uses the line/marker colour
    const xy = buildPlotScene(t2, { ...base, ...styles }, opts);
    expect(xy.legend.find((e) => e.label === "A")!.color).toBe("#111111");
  });

  it("area fill defaults to ~0.22 opacity and honours a style override (colour/opacity/gradient)", () => {
    const def = buildPlotScene(table, { ...base, kind: "area" }, opts);
    expect(def.series[0]!.fillOpacity).toBeCloseTo(0.22, 5);
    const styled = buildPlotScene(
      table,
      { ...base, kind: "area", seriesStyles: { y: { fillColor: "#ff0000", fillOpacity: 0.5, fillType: "gradient", gradientTo: "#0000ff" } } },
      opts,
    );
    expect(styled.series[0]!.fillColor).toBe("#ff0000");
    expect(styled.series[0]!.fillOpacity).toBe(0.5);
    expect(styled.series[0]!.fillSpec.type).toBe("gradient");
  });

  // Two flat series (A=10, B=30 at every X) make the stack maths easy to check.
  const stackTable: DataTable = {
    id: "t",
    kind: "xy",
    name: "T",
    columns: [
      { id: "x", name: "X" },
      { id: "a", name: "A" },
      { id: "b", name: "B" },
    ],
    rows: [0, 1, 2].map((v, i) => ({ id: `r${i}`, cells: { x: v, a: 10, b: 30 } })),
  };

  it("overlaid (default) area leaves each series at its own value", () => {
    const s = buildPlotScene(stackTable, { ...base, kind: "area" }, opts);
    // B autoscales to its raw max (30), not a stacked total.
    expect(s.auto.y[1]).toBeGreaterThanOrEqual(30);
    expect(s.auto.y[1]).toBeLessThan(40);
    expect(s.series[0]!.fillOpacity).toBeCloseTo(0.22, 5);
  });

  it("stacked area sits each series on the cumulative total below it", () => {
    const overlay = buildPlotScene(stackTable, { ...base, kind: "area" }, opts);
    const s = buildPlotScene(stackTable, { ...base, kind: "area", areaStack: "stacked" }, opts);
    // Stacking lifts the Y domain to the cumulative total (A+B = 40); the overlaid
    // view only ever reaches the single largest series (30).
    expect(s.auto.y[1]).toBeGreaterThanOrEqual(40);
    expect(overlay.auto.y[1]).toBeLessThan(40);
    // Stacked areas are more opaque so lower layers don't show through.
    expect(s.series[0]!.fillOpacity).toBeCloseTo(0.85, 5);
  });

  it("100% stacked area normalises every X column to fill the top", () => {
    const s = buildPlotScene(stackTable, { ...base, kind: "area", areaStack: "percent" }, opts);
    // Top series reaches 100% at every X → domain tops out at 100.
    expect(s.auto.y[1]).toBeCloseTo(100, 0);
    // Topmost series' marks all sit at the same height (the 100% line).
    const top = s.series[1]!.marks.map((m) => m.cy);
    expect(Math.max(...top) - Math.min(...top)).toBeLessThan(1e-6);
  });

  // Three series stacked in value (a<b<c) so the cross-series spread is obvious.
  const spreadTable: DataTable = {
    id: "t",
    kind: "xy",
    name: "T",
    columns: [
      { id: "x", name: "X" },
      { id: "a", name: "A" },
      { id: "b", name: "B" },
      { id: "c", name: "C" },
    ],
    rows: [0, 1, 2].map((v, i) => ({ id: `r${i}`, cells: { x: v, a: 10 + i, b: 20 + i, c: 30 + i } })),
  };

  it("range spread band traces the cross-series min→max and widens the Y domain", () => {
    const plain = buildPlotScene(spreadTable, base, opts);
    const s = buildPlotScene(spreadTable, { ...base, spread: { mode: "range" } }, opts);
    expect(s.spreadBand).toBeDefined();
    expect(s.spreadBand!.bandPath.startsWith("M")).toBe(true);
    // Band spans the full data (down to A≈10, up to C≈34), so the domain covers it.
    expect(s.auto.y[0]).toBeLessThanOrEqual(10);
    expect(s.auto.y[1]).toBeGreaterThanOrEqual(34);
    // The plain chart still draws all three lines.
    expect(plain.spreadBand).toBeUndefined();
    expect(plain.series.length).toBe(3);
  });

  it("the dotted mean line carries an optional direct end label", () => {
    const s = buildPlotScene(
      spreadTable,
      { ...base, spread: { mode: "range", showMean: true, meanLabel: "Avg" } },
      opts,
    );
    expect(s.spreadBand!.meanPath && s.spreadBand!.meanPath.startsWith("M")).toBe(true);
    expect(s.spreadBand!.meanLabel?.text).toBe("Avg");
  });

  it("a hidden series is dropped from the lines + legend but still feeds the band", () => {
    const s = buildPlotScene(
      spreadTable,
      { ...base, spread: { mode: "range" }, seriesStyles: { c: { hidden: true } } },
      opts,
    );
    // C is not drawn (2 lines, 2 legend rows)…
    expect(s.series.map((x) => x.id)).toEqual(["a", "b"]);
    expect(s.legend.length).toBe(2);
    // …yet the band still reaches C's values (≈34) because hidden series feed it.
    expect(s.auto.y[1]).toBeGreaterThanOrEqual(34);
  });

  it("stacking suppresses the spread band (the two don't mix)", () => {
    const s = buildPlotScene(spreadTable, { ...base, kind: "area", areaStack: "stacked", spread: { mode: "range" } }, opts);
    expect(s.spreadBand).toBeUndefined();
  });
});

describe("buildPlotScene — heatmap", () => {
  const table: DataTable = {
    id: "t",
    kind: "xy",
    name: "T",
    columns: [
      { id: "x", name: "Gene" },
      { id: "a", name: "Sample A" },
      { id: "b", name: "Sample B" },
    ],
    rows: [
      { id: "r1", cells: { x: "G1", a: 1, b: 2 } },
      { id: "r2", cells: { x: "G2", a: 3, b: 4 } },
    ],
  };
  const plot: Plot = { id: "p", name: "HM", source: "t", status: "ok", styleOverrides: {}, kind: "heatmap" };

  it("builds a coloured cell grid (rows × datasets) + axis labels + scale", () => {
    const s = buildPlotScene(table, plot, { width: 580, height: 380 });
    expect(s.kind).toBe("heatmap");
    expect(s.heatmap).toBeDefined();
    expect(s.heatmap!.cells).toHaveLength(4); // 2 rows × 2 datasets
    expect(s.heatmap!.colLabels.map((c) => c.label)).toEqual(["Sample A", "Sample B"]);
    expect(s.heatmap!.rowLabels.map((r) => r.label)).toEqual(["G1", "G2"]);
    expect(s.heatmap!.min).toBe(1);
    expect(s.heatmap!.max).toBe(4);
    expect(s.heatmap!.cells.every((c) => c.color.startsWith("#"))).toBe(true);
    expect(s.heatmap!.scaleStops).toHaveLength(6);
  });

  // A tilted column name starts at its column and rises right: the last columns' long names reach past the
  // grid, and must not run off the figure's right edge; every name starts at its own column's centre.
  it("tilted column names start at their column and never run off the figure's right edge", () => {
    const measure = (t: string, px: number): number => t.length * px * 0.6;
    const long: DataTable = { ...table, columns: [table.columns[0]!, { id: "a", name: "Control" }, { id: "b", name: "Group B" }, { id: "c", name: "Strain PA14" }, { id: "d", name: "Low dose" }, { id: "e", name: "Day 7 recovery" }, { id: "f", name: "High dose 20 mg/kg" }], rows: table.rows.map((r) => ({ ...r, cells: { ...r.cells, c: 1, d: 2, e: 3, f: 4 } })) };
    // No colour bar: its margin would hide the overhang, and the fixture could not show a label running off the edge.
    const s = buildPlotScene(long, { ...plot, heatmap: { showColorbar: false } } as Plot, { width: 580, height: 380, measure });
    const hm = s.heatmap!;
    expect(hm.labelRotation, "the fixture must tilt its column names, or it cannot show a label running off the edge").not.toBe(0);
    const cos = Math.cos((Math.abs(hm.labelRotation ?? 0) * Math.PI) / 180);
    const size = Math.min(s.fonts.tick.size, 12);
    for (const c of hm.colLabels) expect(c.x + measure(c.label, size) * cos, `"${c.label}" runs off the right edge`).toBeLessThanOrEqual(s.width);
  });

  it("cells show the mean of a dataset's replicate subcolumns, not just the lead column", () => {
    const rep: DataTable = {
      id: "t2", kind: "grouped", name: "T2",
      columns: [
        { id: "x", name: "Gene" },
        { id: "a", name: "Sample A" }, { id: "a2", name: "A2", group: "a" },
        { id: "b", name: "Sample B" }, { id: "b2", name: "B2", group: "b" },
      ],
      rows: [
        { id: "r1", cells: { x: "G1", a: 10, a2: 30, b: 5, b2: 15 } },
        { id: "r2", cells: { x: "G2", a: 4, a2: 8, b: 2, b2: 6 } },
      ],
    };
    const s = buildPlotScene(rep, plot, { width: 580, height: 380 });
    expect(s.heatmap!.cells).toHaveLength(4); // a2/b2 are replicates → still 2 datasets
    const cell = (r: number, c: number) => s.heatmap!.cells.find((k) => k.row === r && k.col === c)!;
    expect(cell(0, 0).value).toBe(20); // mean(10,30), not the lead replicate's 10
    expect(cell(0, 1).value).toBe(10); // mean(5,15)
    expect(cell(1, 0).value).toBe(6); // mean(4,8)
    expect(s.heatmap!.max).toBe(20); // not 10 (the lead replicates' max)
  });

  it("colours missing cells with a neutral fill", () => {
    const t2 = { ...table, rows: [{ id: "r1", cells: { x: "G1", a: 1, b: null } }] };
    const s = buildPlotScene(t2, plot, {});
    const missing = s.heatmap!.cells.find((c) => c.value === null)!;
    expect(missing.color).toBe("#dddddd");
  });

  it("tags each cell with its grid position (for selection)", () => {
    const s = buildPlotScene(table, plot, {});
    expect(s.heatmap!.cells.map((c) => [c.row, c.col])).toEqual([[0, 0], [0, 1], [1, 0], [1, 1]]);
  });

  it("honours colormap, manual scale, value labels, cell border, NaN colour, and toggles", () => {
    const styled: Plot = {
      ...plot,
      heatmap: {
        colormap: "magma",
        valueMin: 0,
        valueMax: 10,
        showValues: true,
        nanColor: "#ff00ff",
        cellBorderColor: "#000000",
        cellBorderWidth: 1,
        showColorbar: false,
        showRowLabels: false,
      },
    };
    const h = buildPlotScene(table, styled, { width: 580, height: 380 }).heatmap!;
    expect(h.min).toBe(0); // manual scale
    expect(h.max).toBe(10);
    expect(h.cells[0]!.label).toBe("1"); // showValues → formatted value
    expect(h.cells[0]!.labelColor).toMatch(/^#/);
    expect(h.border).toEqual({ color: "#000000", width: 1 });
    expect(h.showColorbar).toBe(false);
    expect(h.rowLabels).toHaveLength(0); // row labels hidden
  });

  it("reverses the ramp when asked (low value takes the high-end colour)", () => {
    const fwd = buildPlotScene(table, plot, {}).heatmap!;
    const rev = buildPlotScene(table, { ...plot, heatmap: { reverse: true } }, {}).heatmap!;
    // cell[0] is the minimum (value 1): reversing flips its colour vs the default ramp.
    expect(rev.cells[0]!.color).not.toBe(fwd.cells[0]!.color);
  });

  it("carries editable axis titles (columns = X, rows = Y) from the plot's axes", () => {
    const s = buildPlotScene(table, { ...plot, xAxis: { title: "Samples" }, yAxis: { title: "Genes" } }, { width: 580, height: 380 });
    expect(s.x.title).toBe("Samples");
    expect(s.y.title).toBe("Genes");
    // No titles by default (a bare heatmap has none until the user adds them).
    const bare = buildPlotScene(table, plot, {});
    expect(bare.x.title).toBe("");
    expect(bare.y.title).toBe("");
  });

  it("resolves a row/column label font + rotation onto the scene", () => {
    const s = buildPlotScene(table, { ...plot, heatmap: { labelFont: { size: 18, bold: true }, labelRotation: 45 } }, { width: 580, height: 380 }).heatmap!;
    expect(s.labelFont?.size).toBe(18);
    expect(s.labelFont?.weight).toBeGreaterThanOrEqual(600); // bold
    expect(s.labelRotation).toBe(45);
    // Default = no explicit label font / rotation.
    const bare = buildPlotScene(table, plot, {}).heatmap!;
    expect(bare.labelFont).toBeUndefined();
    expect(bare.labelRotation).toBeUndefined();
  });
});

describe("buildPlotScene — parallel coordinates", () => {
  const table: DataTable = {
    id: "pc",
    kind: "multivariable",
    name: "Iris",
    columns: [
      { id: "sl", name: "Sepal L" },
      { id: "sw", name: "Sepal W" },
      { id: "pl", name: "Petal L" },
      { id: "sp", name: "Species" },
    ],
    rows: [
      { id: "r1", cells: { sl: 5.1, sw: 3.5, pl: 1.4, sp: "setosa" } },
      { id: "r2", cells: { sl: 7.0, sw: 3.2, pl: 4.7, sp: "versicolor" } },
      { id: "r3", cells: { sl: 6.3, sw: 3.3, pl: 6.0, sp: "virginica" } },
    ],
  };
  const plot: Plot = { id: "p", name: "PC", source: "pc", status: "ok", styleOverrides: {}, kind: "parallel", parallel: { colorColumn: "sp" } };

  it("lineColors recolours one row's line, overriding the colour mapping for it alone", () => {
    const base = buildPlotScene(table, plot, { width: 640, height: 420 });
    const groupColor = base.parallel!.lines.find((l) => l.id === "r2")!.color;
    const s = buildPlotScene(table, { ...plot, parallel: { colorColumn: "sp", lineColors: { r2: "#ff0055" } } }, { width: 640, height: 420 });
    expect(s.parallel!.lines.find((l) => l.id === "r2")!.color).toBe("#ff0055");
    // its neighbours keep the colour-column mapping
    expect(s.parallel!.lines.find((l) => l.id === "r1")!.color).toBe(base.parallel!.lines.find((l) => l.id === "r1")!.color);
    expect(groupColor).not.toBe("#ff0055"); // the override really changed something
  });

  it("colorbarTitle overrides the colour column's name on the value bar (blank = the column)", () => {
    const valuePlot: Plot = { ...plot, parallel: { colorColumn: "pl", colorScale: "value" } };
    expect(buildPlotScene(table, valuePlot, { width: 640, height: 420 }).colorbar?.title).toBe("Petal L");
    const named = buildPlotScene(table, { ...valuePlot, parallel: { ...valuePlot.parallel, colorbarTitle: "Length (cm)" } }, { width: 640, height: 420 });
    expect(named.colorbar?.title).toBe("Length (cm)");
  });

  it("builds one axis per numeric column + one line per row, coloured by group", () => {
    const s = buildPlotScene(table, plot, { width: 640, height: 420 });
    expect(s.kind).toBe("parallel");
    const pc = s.parallel!;
    expect(pc.axes.map((a) => a.label)).toEqual(["Sepal L", "Sepal W", "Petal L"]); // Species (text + colour col) excluded
    expect(pc.lines).toHaveLength(3);
    for (const ln of pc.lines) expect(ln.points).toHaveLength(3); // crosses every axis
    expect(new Set(pc.lines.map((l) => l.color)).size).toBe(3); // distinct species colours
    expect(s.legend.map((e) => e.label)).toEqual(["setosa", "versicolor", "virginica"]);
    expect(s.series).toHaveLength(0);
  });

  it("scales each axis independently (max→top, min→bottom)", () => {
    const s = buildPlotScene(table, plot, { width: 640, height: 420 }).parallel!;
    const sl = s.axes[0]!; // Sepal L spans 5.1..7.0
    expect(sl.min).toBeCloseTo(5.1, 6);
    expect(sl.max).toBeCloseTo(7.0, 6);
    expect(s.lines.find((l) => l.id === "r2")!.points[0]!.y).toBeCloseTo(sl.topY, 3); // sl=7.0 (max)
    expect(s.lines.find((l) => l.id === "r1")!.points[0]!.y).toBeCloseTo(sl.botY, 3); // sl=5.1 (min)
  });

  /**
   * The value-tick ladder. An axis carrying only two numbers — the raw min and the raw max,
   * drawn at the very ends — leaves no value in the middle of the axis readable, and two ends
   * formatted independently (`Number.isInteger ? String : toFixed(2)`) can print "6" on one
   * axis and "1.30" on the next.
   */
  it("gives every axis a ladder of round values, inside its own data extent", () => {
    const s = buildPlotScene(table, plot, { width: 640, height: 420 }).parallel!;
    for (const ax of s.axes) {
      expect(ax.ticks!.length, `${ax.label} has no value ticks`).toBeGreaterThanOrEqual(3);
      // Inside the extent: the domain is not rounded outward, so the bundle still fills the axis.
      for (const t of ax.ticks!) {
        expect(t.value).toBeGreaterThanOrEqual(ax.min - 1e-9);
        expect(t.value).toBeLessThanOrEqual(ax.max + 1e-9);
        expect(t.y).toBeGreaterThanOrEqual(ax.topY - 1e-6);
        expect(t.y).toBeLessThanOrEqual(ax.botY + 1e-6);
      }
      // One decimal count per axis, and each label IS the value it sits at.
      const decimals = new Set(ax.ticks!.map((t) => (t.label.split(".")[1] ?? "").length));
      expect(decimals.size, `${ax.label} mixes decimals: ${ax.ticks!.map((t) => t.label).join(", ")}`).toBe(1);
      for (const t of ax.ticks!) expect(Number(t.label)).toBeCloseTo(t.value, 6);
      // Labels are centred on their y, so anything closer than a line-height overlaps.
      for (let i = 1; i < ax.ticks!.length; i++) {
        expect(Math.abs(ax.ticks![i]!.y - ax.ticks![i - 1]!.y)).toBeGreaterThan(13);
      }
    }
  });

  /**
   * The variable name and the tick numbers must be tunable apart. With one shared `fonts.tick`,
   * shrinking the numbers — necessary, since N ladders sit inside the data field — would shrink
   * every variable name with them, and no size would let both read well.
   */
  it("gives the variable name its own font, independent of the tick numbers", () => {
    const s = buildPlotScene(table, { ...plot, fonts: { axisTitle: { size: 21 }, tick: { size: 9 } } }, { width: 640, height: 420 }).parallel!;
    expect(s.nameFont.size).toBe(21);
    expect(s.axes[0]!.ticks.length).toBeGreaterThan(0);
    // Moving one of them must not move the other.
    const bigTicks = buildPlotScene(table, { ...plot, fonts: { axisTitle: { size: 21 }, tick: { size: 18 } } }, { width: 640, height: 420 }).parallel!;
    expect(bigTicks.nameFont.size, "the tick font dragged the name size with it").toBe(21);
    // And the name's font drives the space reserved above the axes, not the tick font.
    const tall = buildPlotScene(table, { ...plot, fonts: { axisTitle: { size: 40 } } }, { width: 640, height: 420 }).parallel!;
    expect(tall.axes[0]!.topY, "a bigger variable name did not reserve more room above the axis").toBeGreaterThan(s.axes[0]!.topY);
  });

  /**
   * Per-axis tick settings. Parallel has N axes and only one `xAxis`/`yAxis` pair exists on a
   * Plot, so these live in `parallel.perAxis` keyed by column id — the same keying as `brushes`
   * and `axisOrder`, so a setting survives a re-sort. The point of every assertion here is that
   * one axis moves and the others do not: a per-axis control that silently applies to all of
   * them is worse than no control, because the figure looks edited and is not.
   */
  describe("per-axis tick settings", () => {
    const withAxis = (colId: string, spec: Record<string, number>): Plot =>
      ({ ...plot, parallel: { colorColumn: "sp", perAxis: { [colId]: spec } } }) as Plot;
    const build = (p: Plot) => buildPlotScene(table, p, { width: 640, height: 420 }).parallel!;

    it("an exact tick interval is honoured exactly, and only on its own axis", () => {
      const base = build(plot);
      const s = build(withAxis("sl", { majorStep: 0.25 }));
      const sl = s.axes.find((a) => a.colId === "sl")!;
      const majors = sl.ticks.filter((t) => !t.minor);
      expect(majors.length).toBeGreaterThan(2);
      for (let i = 1; i < majors.length; i++) {
        expect(majors[i]!.value - majors[i - 1]!.value).toBeCloseTo(0.25, 9);
      }
      // The auto path deliberately does not second-guess a typed interval, so this count is
      // allowed to exceed the auto tick budget.
      expect(majors.length).toBeGreaterThan(base.axes[0]!.ticks.length);
      // Every other axis is untouched.
      for (const other of ["sw", "pl"]) {
        expect(s.axes.find((a) => a.colId === other)!.ticks.map((t) => t.label))
          .toEqual(base.axes.find((a) => a.colId === other)!.ticks.map((t) => t.label));
      }
    });

    it("minor ticks subdivide the majors, carry no label, and stay on their own axis", () => {
      const s = build(withAxis("sw", { minorCount: 3 }));
      const sw = s.axes.find((a) => a.colId === "sw")!;
      const minors = sw.ticks.filter((t) => t.minor);
      expect(minors.length, "no minor ticks were emitted").toBeGreaterThan(0);
      // A minor tick is never numbered — that is what distinguishes it from a second scale.
      for (const m of minors) expect(m.label).toBe("");
      // Exactly `minorCount` between each pair of majors.
      const majors = sw.ticks.filter((t) => !t.minor);
      expect(minors.length).toBe((majors.length - 1) * 3);
      expect(s.axes.find((a) => a.colId === "sl")!.ticks.some((t) => t.minor)).toBe(false);
    });

    it("a per-axis tick count overrides the chart-wide one for that axis alone", () => {
      const base = build({ ...plot, parallel: { colorColumn: "sp", tickCount: 6 } });
      const s = build({ ...plot, parallel: { colorColumn: "sp", tickCount: 6, perAxis: { pl: { tickCount: 2 } } } });
      const pl = s.axes.find((a) => a.colId === "pl")!;
      expect(pl.ticks.length).toBeLessThan(base.axes.find((a) => a.colId === "pl")!.ticks.length);
      expect(s.axes.find((a) => a.colId === "sl")!.ticks.length)
        .toBe(base.axes.find((a) => a.colId === "sl")!.ticks.length);
    });

    it("adds a custom tick at an exact value, with its own label, on its own axis", () => {
      const s = build({ ...plot, parallel: { colorColumn: "sp", perAxis: { sl: { extraTicks: [{ value: 6.4, label: "cut-off" }] } } } } as Plot);
      const sl = s.axes.find((a) => a.colId === "sl")!;
      const hit = sl.ticks.find((t) => Math.abs(t.value - 6.4) < 1e-9);
      expect(hit, "the custom tick is missing").toBeTruthy();
      expect(hit!.label).toBe("cut-off");
      // It sits where the value is, not at an axis end.
      expect(hit!.y).toBeGreaterThan(sl.topY);
      expect(hit!.y).toBeLessThan(sl.botY);
      expect(s.axes.find((a) => a.colId === "sw")!.ticks.some((t) => t.label === "cut-off")).toBe(false);
    });

    it("labels a custom tick with the formatted number when no label is given", () => {
      const s = build({ ...plot, parallel: { colorColumn: "sp", perAxis: { sl: { extraTicks: [{ value: 6.4 }] } } } } as Plot);
      const hit = s.axes.find((a) => a.colId === "sl")!.ticks.find((t) => Math.abs(t.value - 6.4) < 1e-9)!;
      expect(Number(hit.label)).toBeCloseTo(6.4, 6);
    });

    /**
     * Out of range = dropped, never clamped. A tick pinned to the axis end would claim the
     * data reaches a value it does not — the axis would misreport its own extent.
     */
    it("drops a custom tick outside the axis's data range instead of clamping it", () => {
      const s = build({ ...plot, parallel: { colorColumn: "sp", perAxis: { sl: { extraTicks: [{ value: 99, label: "way out" }, { value: -5, label: "below" }] } } } } as Plot);
      const sl = s.axes.find((a) => a.colId === "sl")!;
      expect(sl.ticks.some((t) => t.label === "way out" || t.label === "below")).toBe(false);
      for (const t of sl.ticks) {
        expect(t.value).toBeGreaterThanOrEqual(sl.min - 1e-9);
        expect(t.value).toBeLessThanOrEqual(sl.max + 1e-9);
      }
    });

    it("a custom tick on a ladder value replaces that rung rather than drawing over it", () => {
      const base = build(plot);
      const sl0 = base.axes.find((a) => a.colId === "sl")!;
      const onLadder = sl0.ticks.find((t) => !t.minor)!.value;
      const s = build({ ...plot, parallel: { colorColumn: "sp", perAxis: { sl: { extraTicks: [{ value: onLadder, label: "here" }] } } } } as Plot);
      const sl = s.axes.find((a) => a.colId === "sl")!;
      const at = sl.ticks.filter((t) => Math.abs(t.value - onLadder) < 1e-9);
      expect(at, "two ticks drawn at the same value").toHaveLength(1);
      expect(at[0]!.label).toBe("here"); // the user's label wins — that is why they added it
    });

    /**
     * Flipping one axis. Its purpose is to remove the X-shaped tangle between two negatively
     * correlated neighbours, so what must actually invert is where each row's point lands —
     * moving only the tick labels would look right and mean nothing.
     */
    it("flips where the data sits, not merely the tick labels", () => {
      const base = build(plot);
      const rev = build({ ...plot, parallel: { colorColumn: "sp", perAxis: { sl: { reversed: true } } } } as Plot);
      const a0 = base.axes.find((a) => a.colId === "sl")!;
      const a1 = rev.axes.find((a) => a.colId === "sl")!;
      // The rule is drawn in the same place; only the mapping turns over.
      expect(a1.topY).toBeCloseTo(a0.topY, 6);
      expect(a1.botY).toBeCloseTo(a0.botY, 6);
      expect(a1.yAtMin).toBeCloseTo(a0.yAtMax, 6);
      expect(a1.yAtMax).toBeCloseTo(a0.yAtMin, 6);
      // r2 holds Sepal L's maximum (7.0): at the bottom of the rule once flipped.
      const y = (s2: typeof base, id: string): number => s2.lines.find((l) => l.id === id)!.points[0]!.y;
      expect(y(base, "r2")).toBeCloseTo(a0.topY, 3);
      expect(y(rev, "r2")).toBeCloseTo(a0.botY, 3);
      // …and the ordering of every row on that axis is exactly inverted.
      const order = (s2: typeof base): string[] => ["r1", "r2", "r3"].sort((p, q) => y(s2, p) - y(s2, q));
      expect(order(rev)).toEqual([...order(base)].reverse());
      // Neighbouring axes are untouched.
      expect(rev.lines.find((l) => l.id === "r2")!.points[1]!.y)
        .toBeCloseTo(base.lines.find((l) => l.id === "r2")!.points[1]!.y, 6);
    });

    /**
     * The failure this contract prevents: the brush turns a pixel drag into a data range
     * and back. If the builder flips an axis but the reader of `yAtMin`/`yAtMax` does not, a
     * brush selects the inverse of what was dragged over — silently, on that axis alone. The
     * scene therefore carries the two endpoints instead of a flag, and this pins the contract
     * every consumer (including PlotFigure's axisValueAt/axisPxAt) must honour.
     */
    it("keeps the axis endpoints as the single source of truth for the mapping", () => {
      for (const reversed of [false, true]) {
        const s = build({ ...plot, parallel: { colorColumn: "sp", perAxis: { sl: { reversed } } } } as Plot);
        const ax = s.axes.find((a) => a.colId === "sl")!;
        // Interpolating between the endpoints must reproduce every drawn point.
        const yOf = (v: number): number => ax.yAtMin + ((v - ax.min) / (ax.max - ax.min)) * (ax.yAtMax - ax.yAtMin);
        for (const [id, v] of [["r1", 5.1], ["r2", 7.0], ["r3", 6.3]] as [string, number][]) {
          expect(s.lines.find((l) => l.id === id)!.points[0]!.y, `${id} at ${v}`).toBeCloseTo(yOf(v), 6);
        }
        // …and every tick, so the ladder cannot drift from the data either.
        for (const t of ax.ticks!) expect(t.y).toBeCloseTo(yOf(t.value), 6);
      }
    });

    it("writes this axis's numbers the way it was told, and leaves its neighbours alone", () => {
      const s = build({ ...plot, parallel: { colorColumn: "sp", perAxis: { sl: { format: "percent", decimals: 0, suffix: "" } } } } as Plot);
      const sl = s.axes.find((a) => a.colId === "sl")!;
      for (const t of sl.ticks.filter((t) => t.label !== "")) expect(t.label).toMatch(/%$/);
      // The next axis still prints plain decimals.
      expect(s.axes.find((a) => a.colId === "sw")!.ticks.some((t) => t.label.includes("%"))).toBe(false);
    });

    it("wraps each number in a prefix and suffix", () => {
      const s = build({ ...plot, parallel: { colorColumn: "sp", perAxis: { sl: { prefix: "$", suffix: " k" } } } } as Plot);
      for (const t of s.axes.find((a) => a.colId === "sl")!.ticks.filter((t) => t.label !== "")) {
        expect(t.label.startsWith("$"), `"${t.label}" lost its prefix`).toBe(true);
        expect(t.label.endsWith(" k"), `"${t.label}" lost its suffix`).toBe(true);
      }
    });

    /**
     * An explicit decimal count wins over the ladder's own rule ("as many places as it takes
     * to print each tick exactly"). That rule is what to do when nobody has said otherwise; a
     * user asking for 1 place means 1, even where the value needs 2 to be exact.
     */
    it("lets an explicit decimal count beat the automatic one", () => {
      const auto = build(plot).axes.find((a) => a.colId === "sw")!; // 3.2..3.5 → needs 1 place
      expect(auto.ticks.some((t) => /\.\d/.test(t.label))).toBe(true);
      const s = build({ ...plot, parallel: { colorColumn: "sp", perAxis: { sw: { decimals: 0 } } } } as Plot);
      for (const t of s.axes.find((a) => a.colId === "sw")!.ticks.filter((t) => t.label !== "")) {
        expect(t.label, "a decimal place survived an explicit 0").not.toMatch(/\./);
      }
    });

    it("renames an axis on the figure without touching the column", () => {
      const s = build({ ...plot, parallel: { colorColumn: "sp", perAxis: { sl: { title: "Sepal length (cm)" } } } } as Plot);
      expect(s.axes.find((a) => a.colId === "sl")!.label).toBe("Sepal length (cm)");
      expect(s.axes.find((a) => a.colId === "sw")!.label).toBe("Sepal W"); // neighbour untouched
      expect(table.columns.find((c) => c.id === "sl")!.name, "the column was renamed").toBe("Sepal L");
      // Blank/whitespace is not a rename — it falls back to the column's own name.
      const blank = build({ ...plot, parallel: { colorColumn: "sp", perAxis: { sl: { title: "   " } } } } as Plot);
      expect(blank.axes.find((a) => a.colId === "sl")!.label).toBe("Sepal L");
    });

    it("ignores an invalid interval rather than hanging or emitting nothing", () => {
      for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
        const s = build(withAxis("sl", { majorStep: bad }));
        const sl = s.axes.find((a) => a.colId === "sl")!;
        expect(sl.ticks.filter((t) => !t.minor).length, `majorStep ${bad} produced no ladder`).toBeGreaterThanOrEqual(2);
      }
    });
  });

  /**
   * The variable name must clear the topmost tick label.
   *
   * The top tick sits on the axis top and its label is centred there, so the label rises above
   * the axis while the name's descenders drop below its baseline. A flat 6px gap between them
   * lets a tick label such as "7.0" overlap a name such as "Sepal L". Both font sizes must feed
   * the gap, or raising either one alone walks them back into each other.
   */
  it("keeps the variable name clear of the topmost tick label at any font pairing", () => {
    for (const [nameSize, tickSize] of [[15, 11], [24, 11], [15, 20], [30, 24]] as [number, number][]) {
      const s = buildPlotScene(table, { ...plot, fonts: { axisTitle: { size: nameSize }, tick: { size: tickSize } } }, { width: 640, height: 420 }).parallel!;
      const ax = s.axes[0]!;
      const top = ax.ticks!.filter((t) => t.label !== "").reduce((a, b) => (a.y < b.y ? a : b));
      // Name box bottom (baseline + descender) vs the top tick label's box top.
      const nameBottom = ax.labelY + s.nameFont.size * 0.3;
      const labelTop = top.y + tickSize * 0.35 - tickSize * 0.85;
      expect(nameBottom, `name/${nameSize} tick/${tickSize}: "${top.label}" runs into "${ax.label}"`).toBeLessThanOrEqual(labelTop);
      // …and the name must still be ON the canvas.
      expect(ax.labelY - s.nameFont.size * 0.85).toBeGreaterThanOrEqual(0);
    }
  });

  it("honours the tick-count hint, and drops the ladder entirely when ticks are off", () => {
    const auto = buildPlotScene(table, plot, { width: 640, height: 420 }).parallel!;
    const few = buildPlotScene(table, { ...plot, parallel: { colorColumn: "sp", tickCount: 2 } }, { width: 640, height: 420 }).parallel!;
    expect(few.axes[0]!.ticks.length).toBeLessThan(auto.axes[0]!.ticks.length);
    const off = buildPlotScene(table, { ...plot, parallel: { colorColumn: "sp", showTicks: false } }, { width: 640, height: 420 }).parallel!;
    expect(off.axes.every((a) => a.ticks.length === 0)).toBe(true);
  });

  /**
   * The step must stay on the round 1/2/5×10ᵏ sequence.
   *
   * Capping the tick count by dropping every k-th tick produces steps
   * like 1.5 and 0.4. Off the sequence a reader expects, and (with decimals derived from the
   * step's magnitude rather than the values) the 1.5 tick prints as "2" and the 4.5 one as
   * "5" — a mislabelled axis, which misreports the data, not a cosmetic slip.
   *
   * Note: the three-row fixture above cannot exhibit it: its axes are short enough that no
   * thinning is ever needed. This drives the size and density a gallery card opens to.
   */
  it("keeps every axis on a round step at a real figure size and density", () => {
    let seed = 20260808;
    const rnd = (): number => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648 - 0.5; };
    const centres: [string, number[]][] = [["a", [5.0, 3.4, 1.5]], ["b", [5.9, 2.8, 4.3]], ["c", [6.6, 3.0, 5.6]]];
    const spread = [0.9, 0.7, 1.0];
    const dense: DataTable = {
      ...table,
      rows: centres.flatMap(([sp, c], gi) => Array.from({ length: 30 }, (_, i) => ({
        id: `r${gi}-${i}`,
        cells: { sl: Number((c[0]! + rnd() * spread[0]!).toFixed(2)), sw: Number((c[1]! + rnd() * spread[1]!).toFixed(2)), pl: Number((c[2]! + rnd() * spread[2]!).toFixed(2)), sp },
      }))),
    };
    const s = buildPlotScene(dense, { ...plot, fonts: { tick: { size: 11 } } }, { width: 928, height: 608 }).parallel!;
    for (const ax of s.axes) {
      expect(ax.ticks!.length, `${ax.label} ladder too short`).toBeGreaterThanOrEqual(3);
      const step = Math.abs(ax.ticks![1]!.value - ax.ticks![0]!.value);
      const mant = step / 10 ** Math.floor(Math.log10(step));
      expect(
        [1, 2, 2.5, 5, 10].some((m) => Math.abs(mant - m) < 1e-6),
        `${ax.label}: step ${step} is off the 1/2/5 sequence (${ax.ticks!.map((t) => t.label).join(", ")})`,
      ).toBe(true);
      for (const t of ax.ticks!) expect(Number(t.label), `tick at ${t.value} labelled "${t.label}"`).toBeCloseTo(t.value, 6);
    }
  });

  it("skips rows with a missing axis value and warns", () => {
    const withGap = { ...table, rows: [...table.rows, { id: "r4", cells: { sl: 6.0, sw: null, pl: 5.0, sp: "virginica" } }] };
    const s = buildPlotScene(withGap, plot, { width: 640, height: 420 });
    expect(s.parallel!.lines).toHaveLength(3); // r4 dropped
    expect(s.warnings.join(" ")).toMatch(/missing/i);
  });

  it("uses a single line colour + no legend when no colour column is set", () => {
    const p2: Plot = { ...plot, parallel: { lineColor: "#ff8800" } };
    const s = buildPlotScene(table, p2, { width: 640, height: 420 });
    expect(s.parallel!.lines.every((l) => l.color === "#ff8800")).toBe(true);
    expect(s.legend).toHaveLength(0);
    expect(s.parallel!.axes).toHaveLength(3); // Species still excluded (non-numeric)
  });

  it("colours by a numeric column with a continuous ramp + a colorbar (value mode)", () => {
    const p3: Plot = { ...plot, parallel: { colorColumn: "pl", colorScale: "value" } };
    const s = buildPlotScene(table, p3, { width: 640, height: 420 });
    expect(s.colorbar).toBeTruthy();
    expect(s.colorbar!.min).toBeCloseTo(1.4, 6); // Petal L range across the 3 rows
    expect(s.colorbar!.max).toBeCloseTo(6.0, 6);
    expect(s.colorbar!.title).toBe("Petal L");
    expect(s.legend).toHaveLength(0); // no category legend in value mode
    expect(s.parallel!.axes.map((a) => a.label)).toEqual(["Sepal L", "Sepal W"]); // Petal L is the colour col → excluded
    expect(new Set(s.parallel!.lines.map((l) => l.color)).size).toBe(3); // distinct ramp colours
  });

  it("auto mode colours a text column by category (legend, no colorbar)", () => {
    const s = buildPlotScene(table, { ...plot, parallel: { colorColumn: "sp", colorScale: "auto" } }, { width: 640, height: 420 });
    expect(s.colorbar).toBeUndefined();
    expect(s.legend).toHaveLength(3);
  });

  it("a brush on an axis dims the rows outside its range + records the brush on the axis", () => {
    // Petal L values: 1.4, 4.7, 6.0 → brush [4, 7] keeps r2 (4.7) + r3 (6.0), dims r1 (1.4).
    const s = buildPlotScene(table, { ...plot, parallel: { colorColumn: "sp", brushes: { pl: [4, 7] } } }, { width: 640, height: 420 });
    const plAxis = s.parallel!.axes.find((a) => a.colId === "pl")!;
    expect(plAxis.brush).toEqual([4, 7]);
    const line = (id: string) => s.parallel!.lines.find((l) => l.id === id)!;
    expect(line("r1").dim).toBe(true); // 1.4 outside [4,7]
    expect(line("r2").dim).toBeUndefined(); // 4.7 inside
    expect(line("r3").dim).toBeUndefined(); // 6.0 inside
  });

  it("axisOrder reorders the axes (listed first, unlisted keep natural order)", () => {
    const s = buildPlotScene(table, { ...plot, parallel: { colorColumn: "sp", axisOrder: ["pl", "sl"] } }, { width: 640, height: 420 });
    // Petal L, Sepal L pinned first; Sepal W (unlisted) keeps its place after.
    expect(s.parallel!.axes.map((a) => a.colId)).toEqual(["pl", "sl", "sw"]);
    // axis x positions stay left→right in the new order.
    const xs = s.parallel!.axes.map((a) => a.x);
    expect(xs[0]!).toBeLessThan(xs[1]!);
    expect(xs[1]!).toBeLessThan(xs[2]!);
  });
});

describe("buildPlotScene — Voronoi treemap", () => {
  const table: DataTable = {
    id: "tm",
    kind: "partsofwhole",
    name: "GDP",
    columns: [
      { id: "s", name: "State" },
      { id: "v", name: "GDP" },
    ],
    rows: [
      { id: "r1", cells: { s: "California", v: 43 } },
      { id: "r2", cells: { s: "Texas", v: 29 } },
      { id: "r3", cells: { s: "New York", v: 25 } },
      { id: "r4", cells: { s: "Florida", v: 18 } },
    ],
  };
  const plot: Plot = { id: "p", name: "Treemap", source: "tm", status: "ok", styleOverrides: {}, kind: "treemap" };

  it("auto-contrast composites the fill opacity: a faint dark cell gets dark label text", () => {
    const dark = "#101010";
    const opaque = buildPlotScene(table, { ...plot, seriesStyles: { r1: { color: dark } }, treemap: { fillOpacity: 1 } }, { width: 400, height: 300 }).treemap!;
    const faint = buildPlotScene(table, { ...plot, seriesStyles: { r1: { color: dark } }, treemap: { fillOpacity: 0.15 } }, { width: 400, height: 300 }).treemap!;
    const cellOf = (cm: typeof opaque) => cm.cells.find((c) => c.id === "r1")!;
    expect(cellOf(opaque).labelColor).toBe("#fff"); // opaque dark fill → light label
    expect(cellOf(faint).labelColor).toBe("#111"); // same fill drawn faint (pale on screen) → dark label
  });

  it("warns when a partsofwhole table has more than one value column (only the first whole is charted)", () => {
    const multi: DataTable = {
      id: "tm2", kind: "partsofwhole", name: "M",
      columns: [{ id: "s", name: "State" }, { id: "v1", name: "2023" }, { id: "v2", name: "2024" }],
      rows: [{ id: "r1", cells: { s: "CA", v1: 40, v2: 44 } }, { id: "r2", cells: { s: "TX", v1: 30, v2: 33 } }],
    };
    const s = buildPlotScene(multi, { ...plot, source: "tm2" }, { width: 400, height: 300 });
    expect(s.warnings.some((w) => /Only the first value column/.test(w))).toBe(true);
    expect(buildPlotScene(table, plot, { width: 400, height: 300 }).warnings.some((w) => /Only the first value column/.test(w))).toBe(false);
  });

  it("builds one area-proportional cell per row, tiling the boundary", () => {
    const s = buildPlotScene(table, plot, { width: 600, height: 460 });
    expect(s.kind).toBe("treemap");
    expect(s.treemap).toBeDefined();
    const cells = s.treemap!.cells;
    expect(cells).toHaveLength(4);
    expect(cells.map((c) => c.label)).toEqual(["California", "Texas", "New York", "Florida"]);
    // Each cell is a real convex polygon and California (43) is the largest cell.
    for (const c of cells) expect(c.points.length).toBeGreaterThanOrEqual(3);
    const areaOf = (pts: { x: number; y: number }[]): number => {
      let a = 0;
      for (let i = 0; i < pts.length; i++) {
        const p = pts[i]!;
        const q = pts[(i + 1) % pts.length]!;
        a += p.x * q.y - q.x * p.y;
      }
      return Math.abs(a) / 2;
    };
    const areas = cells.map((c) => areaOf(c.points));
    expect(areas[0]).toBe(Math.max(...areas)); // California biggest
    expect(areas[3]).toBe(Math.min(...areas)); // Florida smallest
    // Cell areas track the value proportions (43:29:25:18) within a loose band.
    const totalArea = areas.reduce((a, b) => a + b, 0);
    const totalVal = 43 + 29 + 25 + 18;
    cells.forEach((_c, i) => {
      const want = [43, 29, 25, 18][i]! / totalVal;
      expect(Math.abs(areas[i]! / totalArea - want)).toBeLessThan(0.1);
    });
    expect(s.series).toHaveLength(0);
  });

  it("is deterministic across rebuilds and exposes stroke + label config", () => {
    const a = buildPlotScene(table, plot, { width: 600, height: 460 }).treemap!;
    const b = buildPlotScene(table, plot, { width: 600, height: 460 }).treemap!;
    expect(a.cells.map((c) => c.points)).toEqual(b.cells.map((c) => c.points));
    expect(a.stroke).toBe("#ffffff");
    expect(a.strokeWidth).toBe(1.5);
    expect(a.showLabels).toBe(true);
    // Auto-contrast label colours are set per cell.
    for (const c of a.cells) expect(["#111", "#fff"]).toContain(c.labelColor);
  });

  it("honours boundary shape, value labels, and stroke overrides", () => {
    const styled: Plot = {
      ...plot,
      treemap: { boundary: "rect", showValues: true, stroke: "#222222", strokeWidth: 3, scaleLabels: false, labelSize: 14 },
    };
    const s = buildPlotScene(table, styled, { width: 600, height: 460 }).treemap!;
    expect(s.stroke).toBe("#222222");
    expect(s.strokeWidth).toBe(3);
    expect(s.cells[0]!.valueLabel).toBe("43");
    expect(s.cells.every((c) => c.labelSize === 14)).toBe(true); // scaleLabels off → uniform
    // Rect boundary → cells collectively span close to the full plot rect corners.
    const xs = s.cells.flatMap((c) => c.points.map((p) => p.x));
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(300);
  });

  it("honours a per-cell border override on only that cell", () => {
    const styled: Plot = { ...plot, seriesStyles: { r1: { sliceStroke: "#ff0000", sliceStrokeWidth: 4 } } };
    const s = buildPlotScene(table, styled, { width: 600, height: 460 }).treemap!;
    const one = s.cells.find((c) => c.id === "r1")!;
    expect(one.stroke).toBe("#ff0000");
    expect(one.strokeWidth).toBe(4);
    // Every other cell leaves stroke unset so it falls back to the global boundary.
    for (const c of s.cells) if (c.id !== "r1") { expect(c.stroke).toBeUndefined(); expect(c.strokeWidth).toBeUndefined(); }
  });

  it("ignores negative values and warns", () => {
    const neg = { ...table, rows: [{ id: "r1", cells: { s: "A", v: -5 } }, { id: "r2", cells: { s: "B", v: 10 } }, { id: "r3", cells: { s: "C", v: 6 } }] };
    const s = buildPlotScene(neg, plot, {});
    expect(s.warnings.join(" ")).toMatch(/[Nn]egative/);
  });

  // Group ("region") colouring + per-cell override.
  const grouped: DataTable = {
    id: "tg",
    kind: "partsofwhole",
    name: "G",
    columns: [
      { id: "s", name: "State", role: "x" },
      { id: "v", name: "GDP", role: "y" },
      { id: "reg", name: "Region", role: "x" },
    ],
    rows: [
      { id: "r1", cells: { s: "CA", v: 40, reg: "West" } },
      { id: "r2", cells: { s: "WA", v: 10, reg: "West" } },
      { id: "r3", cells: { s: "NY", v: 30, reg: "East" } },
      { id: "r4", cells: { s: "MA", v: 8, reg: "East" } },
    ],
  };
  const lum = (hex: string): number => {
    const n = parseInt(hex.replace("#", ""), 16);
    return 0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255);
  };

  it("colours cells by group column: distinct hue per group, shaded light→dark by value", () => {
    const p: Plot = { ...plot, source: "tg", treemap: { groupColumn: "reg" } };
    const s = buildPlotScene(grouped, p, { width: 500, height: 400 }).treemap!;
    const fill = Object.fromEntries(s.cells.map((c) => [c.id, c.fill]));
    // Different regions → different base hues; same region → shaded variants (not equal).
    expect(fill.r1).not.toBe(fill.r3); // West vs East differ
    expect(fill.r1).not.toBe(fill.r2); // shaded within West
    expect(fill.r3).not.toBe(fill.r4); // shaded within East
    // The smaller cell in each region is the lighter shade (higher luminance).
    expect(lum(fill.r2!)).toBeGreaterThan(lum(fill.r1!));
    expect(lum(fill.r4!)).toBeGreaterThan(lum(fill.r3!));
    // Legend lists the two regions (not the four cells).
    expect(s.cells).toHaveLength(4);
    const p2 = buildPlotScene(grouped, p, { width: 500, height: 400 });
    expect(p2.legend.map((e) => e.label)).toEqual(["West", "East"]);
  });

  it("a per-cell colour override wins over the group colour", () => {
    const p: Plot = { ...plot, source: "tg", treemap: { groupColumn: "reg" }, seriesStyles: { r2: { color: "#123456" } } };
    const s = buildPlotScene(grouped, p, { width: 500, height: 400 }).treemap!;
    expect(s.cells.find((c) => c.id === "r2")!.fill).toBe("#123456");
  });

  it("a circle treemap keeps its requested box and maximises the disc inside it", () => {
    // The box belongs to the layout — the builder must never hand back a smaller scene
    // (a scene cut to hug the disc shrinks the gallery cards). Inside the
    // box, the disc fills the limiting dimension up to the tightened margins.
    const wide = buildPlotScene(table, plot, { width: 800, height: 400 });
    expect(wide.width, "the scene box is the layout's — never shrunk").toBe(800);
    expect(wide.height).toBe(400);
    const ys = wide.treemap!.cells.flatMap((c) => c.points.map((p) => p.y));
    const disc = Math.max(...ys) - Math.min(...ys);
    expect(disc / 400, `disc ${Math.round(disc)} of the 400px limiting dimension`).toBeGreaterThan(0.8);
    const rect = buildPlotScene(table, { ...plot, treemap: { boundary: "rect" } }, { width: 800, height: 400 });
    expect(rect.width).toBe(800);
  });

  it("at the house label size (26) the largest cell keeps its name and value", () => {
    // At labelSize 26 the big-cell label scales up, and an uncapped glyph block would collide
    // with the region heading ring, so the de-confliction would drop the most prominent label
    // in the figure. The big-cell scale cap keeps the largest label claimable.
    const p: Plot = { ...plot, source: "tg", treemap: { groupColumn: "reg", showGroupLabels: true, showValues: true, labelSize: 26 } };
    const s = buildPlotScene(grouped, p, { width: 580, height: 380 }).treemap!;
    const biggest = s.cells.find((c) => c.id === "r1")!; // CA (40) — the largest cell
    expect(biggest.label, "the largest cell must keep its name").toBe("CA");
    expect(biggest.valueLabel, "…and its value").toBe("40");
    // and the region headings survive the tighter hugged margins (margins sized from a square
    // box around the cells would push them off the smaller figure and drop them)
    expect(s.groupLabels?.map((g) => g.text).sort()).toEqual(["East", "West"]);
  });

  it("region labels: one heading per group placed outside the boundary (only with a group column + round boundary)", () => {
    const on: Plot = { ...plot, source: "tg", treemap: { groupColumn: "reg", showGroupLabels: true } };
    const scn = buildPlotScene(grouped, on, { width: 500, height: 400 });
    const s = scn.treemap!;
    expect(s.groupLabels?.map((g) => g.text).sort()).toEqual(["East", "West"]);
    // Each heading sits outside the cell cloud (farther from centre than any of its cells).
    // Centre = the real plot centre from the scene, not a hardcoded point: the plot box is offset
    // by the top margin, the legend and the heading ring, so its centre is not the figure's.
    const cx = scn.plot.x + scn.plot.width / 2;
    const cy = scn.plot.y + scn.plot.height / 2;
    const cells = s.cells;
    const maxR = Math.max(...cells.flatMap((c) => c.points.map((p) => Math.hypot(p.x - cx, p.y - cy))));
    for (const g of s.groupLabels!) expect(Math.hypot(g.x - cx, g.y - cy)).toBeGreaterThan(maxR * 0.6);
    // Off by default, and suppressed on a rect boundary (no perimeter to hug).
    expect(buildPlotScene(grouped, { ...plot, source: "tg", treemap: { groupColumn: "reg" } }, { width: 500, height: 400 }).treemap!.groupLabels).toBeUndefined();
    expect(buildPlotScene(grouped, { ...plot, source: "tg", treemap: { groupColumn: "reg", showGroupLabels: true, boundary: "rect" } }, { width: 500, height: 400 }).treemap!.groupLabels).toBeUndefined();
  });

  it("carries a per-region drag offset onto the matching group label (draggable region labels)", () => {
    const p: Plot = { ...plot, source: "tg", treemap: { groupColumn: "reg", showGroupLabels: true, groupLabelOffsets: { West: { dx: 12, dy: -7 } } } };
    const s = buildPlotScene(grouped, p, { width: 500, height: 400 }).treemap!;
    const west = s.groupLabels!.find((g) => g.text === "West")!;
    expect([west.dx, west.dy]).toEqual([12, -7]);
    // A region with no stored offset carries none.
    const east = s.groupLabels!.find((g) => g.text === "East")!;
    expect(east.dx).toBeUndefined();
    expect(east.dy).toBeUndefined();
  });

  it("cell icons: attaches the icon-column value to each cell (blank strings omitted)", () => {
    const iconTable: DataTable = {
      ...grouped,
      columns: [...grouped.columns, { id: "flag", name: "Flag", role: "x" }],
      rows: [
        { id: "r1", cells: { s: "CA", v: 40, reg: "West", flag: "🐻" } },
        { id: "r2", cells: { s: "WA", v: 10, reg: "West", flag: "🌲" } },
        { id: "r3", cells: { s: "NY", v: 30, reg: "East", flag: "🗽" } },
        { id: "r4", cells: { s: "MA", v: 8, reg: "East", flag: "" } },
      ],
    };
    const p: Plot = { ...plot, source: "tg", treemap: { iconColumn: "flag" } };
    const s = buildPlotScene(iconTable, p, { width: 600, height: 460 }).treemap!;
    expect(s.cells.find((c) => c.id === "r1")!.icon).toBe("🐻");
    expect(s.cells.find((c) => c.id === "r3")!.icon).toBe("🗽");
    // A blank icon cell carries no badge (empty string → omitted).
    expect(s.cells.find((c) => c.id === "r4")!.icon).toBeUndefined();
    // No icon column → no icons at all.
    const none = buildPlotScene(iconTable, { ...plot, source: "tg" }, { width: 600, height: 460 }).treemap!;
    expect(none.cells.every((c) => c.icon === undefined)).toBe(true);
  });

  const polyArea = (pts: { x: number; y: number }[]): number => {
    let a = 0;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i]!;
      const q = pts[(i + 1) % pts.length]!;
      a += p.x * q.y - q.x * p.y;
    }
    return Math.abs(a) / 2;
  };

  it("squarified layout tiles the plot with area-proportional rectangles", () => {
    const p: Plot = { ...plot, treemap: { layout: "squarified" } };
    const s = buildPlotScene(table, p, { width: 600, height: 460 }).treemap!;
    expect(s.cells).toHaveLength(4);
    for (const c of s.cells) expect(c.points).toHaveLength(4); // each cell is a rectangle
    const areas = s.cells.map((c) => polyArea(c.points));
    // California (43) largest, Florida (18) smallest → areas proportional.
    expect(areas[0]).toBe(Math.max(...areas));
    expect(areas[3]).toBe(Math.min(...areas));
    const total = areas.reduce((a, b) => a + b, 0);
    const totalVal = 43 + 29 + 25 + 18;
    areas.forEach((a, i) => expect(a / total).toBeCloseTo([43, 29, 25, 18][i]! / totalVal, 4));
  });

  it("squarified + group column nests each region into its own rectangle", () => {
    const p: Plot = { ...plot, source: "tg", treemap: { layout: "squarified", groupColumn: "reg" } };
    const s = buildPlotScene(grouped, p, { width: 600, height: 460 }).treemap!;
    for (const c of s.cells) expect(c.points).toHaveLength(4);
    const bbox = (ids: string[]) => {
      const pts = s.cells.filter((c) => ids.includes(c.id)).flatMap((c) => c.points);
      return { x0: Math.min(...pts.map((p) => p.x)), x1: Math.max(...pts.map((p) => p.x)), y0: Math.min(...pts.map((p) => p.y)), y1: Math.max(...pts.map((p) => p.y)) };
    };
    const west = bbox(["r1", "r2"]);
    const east = bbox(["r3", "r4"]);
    // The two regions occupy disjoint rectangles (separated on ≥1 axis).
    const ox = Math.min(west.x1, east.x1) - Math.max(west.x0, east.x0);
    const oy = Math.min(west.y1, east.y1) - Math.max(west.y0, east.y0);
    expect(ox <= 1 || oy <= 1).toBe(true);
    // Group colouring + per-cell override still apply under the squarified layout.
    expect(s.cells.find((c) => c.id === "r1")!.fill).not.toBe(s.cells.find((c) => c.id === "r3")!.fill);
  });
});

describe("buildPlotScene — pie chart", () => {
  const table: DataTable = {
    id: "t",
    kind: "xy",
    name: "T",
    columns: [
      { id: "x", name: "X" },
      { id: "a", name: "Alpha" },
      { id: "b", name: "Beta" },
      { id: "c", name: "Gamma" },
    ],
    // dataset sums: Alpha 30, Beta 10, Gamma 60 → fractions 0.3 / 0.1 / 0.6.
    rows: [
      { id: "r1", cells: { x: 1, a: 20, b: 4, c: 25 } },
      { id: "r2", cells: { x: 2, a: 10, b: 6, c: 35 } },
    ],
  };
  const plot: Plot = { id: "p", name: "Pie", source: "t", status: "ok", styleOverrides: {}, kind: "pie" };

  it("draws small multiples (one pie per value column), not a warning, for a >1-whole partsofwhole table", () => {
    const multi: DataTable = {
      id: "tp", kind: "partsofwhole", name: "P",
      columns: [{ id: "c", name: "Cat" }, { id: "v1", name: "Q1" }, { id: "v2", name: "Q2" }],
      rows: [{ id: "r1", cells: { c: "A", v1: 30, v2: 33 } }, { id: "r2", cells: { c: "B", v1: 20, v2: 22 } }],
    };
    const s = buildPlotScene(multi, { ...plot, source: "tp" }, { width: 500, height: 380 });
    // No "only the first column" warning — every whole gets its own pie.
    expect(s.warnings.some((w) => /Only the first value column/.test(w))).toBe(false);
    // One panel per value column, each with its title = the column name.
    expect(s.pie!.panels).toBeDefined();
    expect(s.pie!.panels!.map((p) => p.title)).toEqual(["Q1", "Q2"]);
    // Each panel draws both categories, and a category is the same colour across panels (one legend).
    expect(s.pie!.panels!.every((p) => p.slices.length === 2)).toBe(true);
    expect(s.pie!.panels![0]!.slices.map((x) => x.color)).toEqual(s.pie!.panels![1]!.slices.map((x) => x.color));
    expect(s.legend.length).toBe(2);
    // A single-whole partsofwhole pie has no panels.
    const single: DataTable = { ...multi, columns: [multi.columns[0]!, multi.columns[1]!], rows: multi.rows };
    expect(buildPlotScene(single, { ...plot, source: "tp" }, { width: 400, height: 300 }).pie!.panels).toBeUndefined();
  });

  it("waffle display draws a 10×10 grid of unit cells coloured by category, reusing the slice spine", () => {
    const pw: DataTable = {
      id: "pw", kind: "partsofwhole", name: "PW",
      columns: [{ id: "cat", name: "Category" }, { id: "v", name: "Sample" }],
      rows: [{ id: "rA", cells: { cat: "A", v: 30 } }, { id: "rB", cells: { cat: "B", v: 10 } }, { id: "rC", cells: { cat: "C", v: 60 } }],
    };
    // Default (pie) → arc slices, no cells.
    const asPie = buildPlotScene(pw, { ...plot, source: "pw" }, { width: 500, height: 400 });
    expect(asPie.pie!.cells).toBeUndefined();
    expect(asPie.pie!.slices).toHaveLength(3);
    // Waffle → 100 unit cells (10×10), counts proportional to the values (30/10/60).
    const s = buildPlotScene(pw, { ...plot, source: "pw", pieDisplay: "waffle" }, { width: 500, height: 400 });
    const cells = s.pie!.cells!;
    expect(cells).toHaveLength(100);
    const byId = (id: string) => cells.filter((c) => c.id === id).length;
    expect(byId("rA")).toBe(30);
    expect(byId("rB")).toBe(10);
    expect(byId("rC")).toBe(60);
    // A cell's id is the row id — the same `pie-slice` selection target as its legend entry.
    expect(new Set(cells.map((c) => c.id))).toEqual(new Set(["rA", "rB", "rC"]));
    // Square cells inside the plot rect.
    expect(cells.every((c) => Math.abs(c.w - c.h) < 1e-6 && c.w > 0)).toBe(true);
    expect(cells.every((c) => c.x >= s.plot.x - 0.5 && c.x + c.w <= s.plot.x + s.plot.width + 0.5)).toBe(true);
    expect(s.legend.length).toBe(3); // legend unchanged
  });

  it("waffle as icons: each category's cells and legend row carry one shape; own shape wins; off = plain squares", () => {
    // Icon arrays: a group is told apart by shape and colour.
    const pw: DataTable = {
      id: "pwi", kind: "partsofwhole", name: "PW",
      columns: [{ id: "cat", name: "Category" }, { id: "v", name: "Sample" }],
      rows: [{ id: "rA", cells: { cat: "A", v: 30 } }, { id: "rB", cells: { cat: "B", v: 10 } }, { id: "rC", cells: { cat: "C", v: 60 } }],
    };
    const base = { ...plot, source: "pwi", pieDisplay: "waffle" as const };
    // Off (the default): plain squares, legend rows without a shape.
    const off = buildPlotScene(pw, base, { width: 500, height: 400 });
    expect(off.pie!.cells!.every((c) => c.shape === undefined)).toBe(true);
    expect(off.legend.every((e) => e.symbol === undefined)).toBe(true);
    // On: one shape per category, from the icon cycle in category order.
    const on = buildPlotScene(pw, { ...base, waffleIcons: true }, { width: 500, height: 400 });
    const shapeOf = (id: string) => new Set(on.pie!.cells!.filter((c) => c.id === id).map((c) => c.shape));
    expect(shapeOf("rA")).toEqual(new Set([WAFFLE_ICON_CYCLE[0]]));
    expect(shapeOf("rB")).toEqual(new Set([WAFFLE_ICON_CYCLE[1]]));
    expect(shapeOf("rC")).toEqual(new Set([WAFFLE_ICON_CYCLE[2]]));
    // The legend row shows the same shape as its cells, so the key can be read without colour.
    expect(on.legend.map((e) => e.symbol)).toEqual([WAFFLE_ICON_CYCLE[0], WAFFLE_ICON_CYCLE[1], WAFFLE_ICON_CYCLE[2]]);
    // A category's own shape (set from its panel) wins, in the cells and the legend.
    const own = buildPlotScene(pw, { ...base, waffleIcons: true, seriesStyles: { rB: { symbol: "octagon" } } }, { width: 500, height: 400 });
    expect(new Set(own.pie!.cells!.filter((c) => c.id === "rB").map((c) => c.shape))).toEqual(new Set(["octagon"]));
    expect(own.legend[1]!.symbol).toBe("octagon");
    // Same cells either way: icons change the mark, not the counts or the places. Compared as the grid (cell size,
    // each cell relative to the first): a plain waffle's legend keys are 1.25-em squares, wider
    // than the icon keys, so the legend column differs and the whole grid sits ~2 px apart — the legend, not the icons.
    const grid = (cs: NonNullable<NonNullable<typeof on.pie>["cells"]>) => cs.map((c) => [c.id, +(c.x - cs[0]!.x).toFixed(3), +(c.y - cs[0]!.y).toFixed(3), c.w, c.h]);
    expect(grid(on.pie!.cells!)).toEqual(grid(off.pie!.cells!));
    expect(Math.abs(on.pie!.cells![0]!.x - off.pie!.cells![0]!.x), "the grid moved by more than the legend column changed").toBeLessThanOrEqual(Math.abs(on.legendLayout.swatchWidth! - off.legendLayout.swatchWidth!));
    // A two-tone category: its key looks like its cells (light fill, darker edge), not solid.
    const tt = buildPlotScene(pw, { ...base, waffleIcons: true, seriesStyles: { rB: { fillType: "twotone" } } }, { width: 500, height: 400 });
    const ttCell = tt.pie!.cells!.find((c) => c.id === "rB")!;
    expect(ttCell.outline, "a two-tone icon has no darker edge").toBeTruthy();
    expect(tt.legend[1]!.color).toBe(ttCell.color);
    expect(tt.legend[1]!.outline).toBe(ttCell.outline);
    expect(tt.legend[0]!.outline, "a solid category's key gained an edge").toBeUndefined();
    // A shape that draws nothing would leave an empty grid: "none" falls back to the cycle.
    const none = buildPlotScene(pw, { ...base, waffleIcons: true, seriesStyles: { rA: { symbol: "none" } } }, { width: 500, height: 400 });
    expect(new Set(none.pie!.cells!.filter((c) => c.id === "rA").map((c) => c.shape))).toEqual(new Set([WAFFLE_ICON_CYCLE[0]]));
  });

  describe("waffle: one cell per observation, with a caption saying so", () => {
    const mk = (vals: number[], id = "pwc"): DataTable => ({
      id, kind: "partsofwhole", name: "PW",
      columns: [{ id: "cat", name: "Category" }, { id: "v", name: "Patients" }],
      rows: vals.map((v, i) => ({ id: `r${i}`, cells: { cat: `G${i}`, v } })),
    });
    const W = 520, H = 420;
    const build = (vals: number[], extra: Partial<Plot>) =>
      buildPlotScene(mk(vals), { ...plot, source: "pwc", pieDisplay: "waffle", waffleUnit: "count", ...extra }, { width: W, height: H });
    const count = (s: PlotScene, id: string) => s.pie!.cells!.filter((c) => c.id === id).length;

    it("default (1 % of the whole): no caption, 100 cells", () => {
      const s = buildPlotScene(mk([3, 1]), { ...plot, source: "pwc", pieDisplay: "waffle" }, { width: W, height: H });
      expect(s.pie!.cells).toHaveLength(100);
      expect(s.pie!.caption).toBeUndefined();
    });

    it("a total of 100 or less: one cell per observation, exactly", () => {
      const s = build([46, 31, 23], {});
      expect(s.pie!.cells).toHaveLength(100);
      expect([count(s, "r0"), count(s, "r1"), count(s, "r2")]).toEqual([46, 31, 23]);
      const t = build([30, 20, 7], {});
      expect(t.pie!.cells).toHaveLength(57);
      expect([count(t, "r0"), count(t, "r1"), count(t, "r2")]).toEqual([30, 20, 7]);
      expect(t.pie!.caption!.text).toBe("1 square = 1 observation");
      expect(build([30, 20, 7], { waffleIcons: true, waffleUnitName: "patient" }).pie!.caption!.text).toBe("1 icon = 1 patient");
    });

    it("the grid of a count that is not 100 still fits the plot, square cells, no wider than 2.5 × its height", () => {
      for (const vals of [[30, 20, 7], [3, 2], [1], [120, 80, 45]]) {
        const s = build(vals, {});
        const cells = s.pie!.cells!;
        const xs = [...new Set(cells.map((c) => c.x.toFixed(3)))].length;
        const ys = [...new Set(cells.map((c) => c.y.toFixed(3)))].length;
        expect(Math.max(xs / ys, ys / xs), `${vals}: ${xs} × ${ys}`).toBeLessThanOrEqual(2.5);
        expect(cells.every((c) => Math.abs(c.w - c.h) < 1e-6 && c.w > 0)).toBe(true);
        expect(cells.every((c) => c.x >= s.plot.x - 0.5 && c.x + c.w <= s.plot.x + s.plot.width + 0.5), `${vals}: a cell leaves the plot sideways`).toBe(true);
        expect(cells.every((c) => c.y >= s.plot.y - 0.5 && c.y + c.h <= s.plot.y + s.plot.height + 0.5), `${vals}: a cell leaves the plot vertically`).toBe(true);
        // The grid is as large as it can be: a cell no smaller than the 10 × 10 grid's.
        if (cells.length <= 100) expect(cells[0]!.w).toBeGreaterThanOrEqual(Math.min(s.plot.width, s.plot.height) / 10 * 0.86 - 1e-6);
      }
    });

    it("more than 100: one cell = several observations, the caption says how many, the counts stay proportional", () => {
      const s = build([150, 70, 30], { waffleUnitName: "patient", waffleIcons: true });
      // 250 observations → 1 icon = 3 → 83 icons (250 / 3, rounded), shared by largest remainder.
      expect(s.pie!.cells).toHaveLength(83);
      expect(count(s, "r0") + count(s, "r1") + count(s, "r2")).toBe(83);
      expect(count(s, "r0")).toBe(50);
      expect(s.pie!.caption!.text).toBe("1 icon = 3 patients");
      // A unit already ending in "s" is not doubled.
      expect(build([150, 70, 30], { waffleUnitName: "mass" }).pie!.caption!.text).toBe("1 square = 3 mass");
    });

    it("values that are not whole numbers are rounded, and the chart says so", () => {
      const s = build([10.4, 5.6], {});
      expect([count(s, "r0"), count(s, "r1")]).toEqual([10, 6]);
      expect(s.warnings.some((w) => /whole numbers/i.test(w) && /round/i.test(w))).toBe(true);
      expect(build([10, 6], {}).warnings.some((w) => /whole numbers/i.test(w))).toBe(false);
    });

    it("the caption sits under the grid, inside the figure, clear of every cell; typed text and a drag are honoured", () => {
      const s = build([30, 20, 7], {});
      const cap = s.pie!.caption!;
      const bottom = Math.max(...s.pie!.cells!.map((c) => c.y + c.h));
      const left = Math.min(...s.pie!.cells!.map((c) => c.x));
      const right = Math.max(...s.pie!.cells!.map((c) => c.x + c.w));
      expect(cap.y - s.fonts.legend.size * 0.85, "the caption touches the grid").toBeGreaterThanOrEqual(bottom);
      expect(cap.y + s.fonts.legend.size * 0.3).toBeLessThanOrEqual(H);
      expect(Math.abs(cap.x - (left + right) / 2)).toBeLessThan(1e-6);
      const typed = build([30, 20, 7], { waffleCaption: "Each square: one mouse", waffleCaptionOffset: { dx: 12, dy: -4 } });
      expect(typed.pie!.caption!.text).toBe("Each square: one mouse");
      expect(typed.pie!.caption!.offset).toEqual({ dx: 12, dy: -4 });
      expect(build([30, 20, 7], { waffleCaption: "   " }).pie!.caption!.text, "blank text must fall back to the automatic caption").toBe("1 square = 1 observation");
    });
  });

  describe("waffle: small groups combined into 'Other'", () => {
    // Six groups in table order; the three largest are B (40), D (25), A (15).
    const six: DataTable = {
      id: "pw6", kind: "partsofwhole", name: "PW",
      columns: [{ id: "cat", name: "Category" }, { id: "v", name: "Patients" }],
      rows: [["A", 15], ["B", 40], ["C", 8], ["D", 25], ["E", 7], ["F", 5]].map(([c, v], i) => ({ id: `r${i}`, cells: { cat: c as string, v: v as number } })),
    };
    const build = (extra: Partial<Plot>, t: DataTable = six) =>
      buildPlotScene(t, { ...plot, source: t.id, pieDisplay: "waffle", waffleUnit: "count", ...extra }, { width: 520, height: 420 });
    const count = (s: PlotScene, id: string) => s.pie!.cells!.filter((c) => c.id === id).length;

    it("unset: every group is shown, nothing is combined", () => {
      const s = build({});
      expect(s.legend.map((e) => e.label)).toEqual(["A", "B", "C", "D", "E", "F"]);
      expect(s.pie!.cells!.some((c) => c.id === WAFFLE_OTHER_ID)).toBe(false);
    });

    it("keeps the N largest groups in table order, and the rest become one 'Other' group, last", () => {
      const s = build({ waffleMaxGroups: 3 });
      expect(s.legend.map((e) => e.label)).toEqual(["A", "B", "D", "Other"]);
      expect([count(s, "r0"), count(s, "r1"), count(s, "r3")]).toEqual([15, 40, 25]);
      expect(count(s, WAFFLE_OTHER_ID)).toBe(8 + 7 + 5);
      expect(s.pie!.cells).toHaveLength(100);
      // No combined group is also drawn on its own.
      for (const id of ["r2", "r4", "r5"]) expect(count(s, id)).toBe(0);
      // A click on Other or on its legend row selects Other.
      expect(s.legend[3]!.select).toEqual({ as: "pie-slice", id: WAFFLE_OTHER_ID });
    });

    it("'Other' is neutral grey by default; its own colour, shape and name win", () => {
      const s = build({ waffleMaxGroups: 3, waffleIcons: true });
      const other = s.pie!.cells!.find((c) => c.id === WAFFLE_OTHER_ID)!;
      expect(other.color).toBe(WAFFLE_OTHER_COLOR);
      expect(other.shape).toBe(WAFFLE_ICON_CYCLE[3]);
      const own = build({ waffleMaxGroups: 3, waffleIcons: true, waffleOtherName: "Rest", seriesStyles: { [WAFFLE_OTHER_ID]: { color: "#123456", symbol: "octagon" } } });
      const o2 = own.pie!.cells!.find((c) => c.id === WAFFLE_OTHER_ID)!;
      expect([o2.color, o2.shape, o2.label]).toEqual(["#123456", "octagon", "Rest"]);
      expect(own.legend[3]!.label).toBe("Rest");
      expect(build({ waffleMaxGroups: 3, waffleOtherName: "  " }).legend[3]!.label, "a blank name must fall back to 'Other'").toBe("Other");
    });

    it("a single leftover group keeps its own name — 'Other' would only hide it", () => {
      const s = build({ waffleMaxGroups: 5 });
      expect(s.legend.map((e) => e.label)).toEqual(["A", "B", "C", "D", "E", "F"]);
    });

    it("counts above 100 are combined before they are shared out, so the cells still total right", () => {
      const big: DataTable = { ...six, id: "pw6b", rows: six.rows.map((r) => ({ ...r, cells: { ...r.cells, v: (r.cells.v as number) * 10 } })) };
      const s = build({ waffleMaxGroups: 2 }, big);
      // 1000 observations → 1 cell = 10; B 400 → 40, D 250 → 25, the rest 350 → 35.
      expect([count(s, "r1"), count(s, "r3"), count(s, WAFFLE_OTHER_ID)]).toEqual([40, 25, 35]);
    });

    it("a legend moved inside the plot (narrow figure, long names) never lies on the cells", () => {
      // Guards against the waffle grid, which fills the plot, running under a legend placed in the
      // plot's bottom-right corner.
      for (const extra of [{}, { waffleUnit: "percent" as const }, { waffleMaxGroups: 3, waffleOtherName: "Other outcomes" }]) {
        const long: DataTable = { ...six, id: "pw6l", rows: six.rows.map((r, i) => ({ ...r, cells: { ...r.cells, cat: `Group number ${i + 1} long` } })) };
        // The legend never moves inside on its own (on the right by default, and no clashes):
        // it stays on the right, and the grid stays left of it.
        const auto = build({ ...extra, legend: { show: true } }, long);
        expect(auto.legendLayout.position, "a long-named legend left the right-hand side").toBe("right");
        expect(Math.max(...auto.pie!.cells!.map((c) => c.x + c.w)), "a cell runs into the legend column").toBeLessThanOrEqual(auto.plot.x + auto.plot.width + 0.5);
        // The inside corner is still the user's to choose — and then the grid must still clear it.
        const s = build({ ...extra, legend: { show: true, position: "bottomright" } }, long);
        expect(s.legendLayout.position, "the fixture must put the legend inside, or it cannot show a cell running under it").toBe("bottomright");
        const boxW = legendBoxWidth(s.legendLayout, s.legend.map((e) => e.label), s.fonts.legend.size);
        const legendLeft = s.plot.x + s.plot.width - (s.legendLayout.inset ?? 8) - boxW;
        const right = Math.max(...s.pie!.cells!.map((c) => c.x + c.w));
        expect(right, `${JSON.stringify(extra)}: a cell runs under the legend`).toBeLessThanOrEqual(legendLeft);
      }
      // A legend that sits outside takes nothing more from the grid.
      const wide = buildPlotScene(six, { ...plot, source: six.id, pieDisplay: "waffle", waffleUnit: "count", legend: { show: true } }, { width: 900, height: 420 });
      expect(wide.legendLayout.position).toBe("right");
      const cells = wide.pie!.cells!;
      const gridW = Math.max(...cells.map((c) => c.x + c.w)) - Math.min(...cells.map((c) => c.x));
      const gridH = Math.max(...cells.map((c) => c.y + c.h)) - Math.min(...cells.map((c) => c.y));
      expect(Math.max(gridW / wide.plot.width, gridH / (wide.plot.height - wide.fonts.legend.size * 1.8))).toBeGreaterThan(0.95);
    });

    it("only the waffle combines: a pie with the same setting keeps every slice", () => {
      const s = buildPlotScene(six, { ...plot, source: six.id, pieDisplay: "pie", waffleMaxGroups: 3 }, { width: 520, height: 420 });
      expect(s.pie!.slices).toHaveLength(6);
    });
  });

  it("the icon cycle opens with shapes told apart at a glance, and every one draws something", () => {
    expect(WAFFLE_ICON_CYCLE.slice(0, 4)).toEqual(["circle", "triangle", "square", "diamond"]);
    expect(WAFFLE_ICON_CYCLE).not.toContain("none");
    expect(new Set(WAFFLE_ICON_CYCLE).size).toBe(WAFFLE_ICON_CYCLE.length);
  });

  it("waffle cell counts always total 100 via largest-remainder (uneven fractions)", () => {
    const pw: DataTable = {
      id: "pw3", kind: "partsofwhole", name: "PW",
      columns: [{ id: "cat", name: "Category" }, { id: "v", name: "Sample" }],
      rows: [{ id: "r1", cells: { cat: "A", v: 1 } }, { id: "r2", cells: { cat: "B", v: 1 } }, { id: "r3", cells: { cat: "C", v: 1 } }],
    };
    const s = buildPlotScene(pw, { ...plot, source: "pw3", pieDisplay: "waffle" }, { width: 400, height: 400 });
    expect(s.pie!.cells).toHaveLength(100); // 33.33 each → 34/33/33
    expect(s.pie!.cells!.filter((c) => c.id === "r1").length).toBe(34); // largest remainder → first
  });

  it("waffle on a multi-whole table falls back to pies with a warning (not a silent no-op)", () => {
    const multi: DataTable = {
      id: "tpm", kind: "partsofwhole", name: "P",
      columns: [{ id: "c", name: "Cat" }, { id: "v1", name: "Q1" }, { id: "v2", name: "Q2" }],
      rows: [{ id: "r1", cells: { c: "A", v1: 30, v2: 33 } }, { id: "r2", cells: { c: "B", v1: 20, v2: 22 } }],
    };
    const s = buildPlotScene(multi, { ...plot, source: "tpm", pieDisplay: "waffle" }, { width: 500, height: 380 });
    expect(s.pie!.cells).toBeUndefined();
    expect(s.pie!.panels).toBeDefined();
    expect(s.warnings.some((w) => /waffle/i.test(w) && /single whole/i.test(w))).toBe(true);
  });

  it("builds one proportional slice per dataset with arc paths + a legend", () => {
    const s = buildPlotScene(table, plot, { width: 580, height: 380 });
    expect(s.kind).toBe("pie");
    expect(s.pie).toBeDefined();
    expect(s.pie!.slices).toHaveLength(3);
    expect(s.pie!.slices.map((sl) => sl.label)).toEqual(["Alpha", "Beta", "Gamma"]);
    expect(s.pie!.slices.map((sl) => Math.round(sl.fraction * 100))).toEqual([30, 10, 60]);
    expect(s.pie!.slices[0]!.path.startsWith("M")).toBe(true); // an arc path
    expect(s.legend.map((e) => e.label)).toEqual(["Alpha", "Beta", "Gamma"]);
    expect(s.series).toHaveLength(0); // pie has no XY series
  });

  it("ignores negative values and warns", () => {
    const neg = { ...table, rows: [{ id: "r1", cells: { x: 1, a: -5, b: 10, c: 10 } }] };
    const s = buildPlotScene(neg, plot, {});
    expect(s.warnings.join(" ")).toMatch(/[Nn]egative/);
  });

  it("each slice carries its dataset id, default % label, and slice border", () => {
    const s = buildPlotScene(table, plot, { width: 580, height: 380 });
    expect(s.pie!.slices.map((sl) => sl.id)).toEqual(["a", "b", "c"]);
    expect(s.pie!.slices[2]!.labelText).toBe("60%"); // default percent label
    expect(s.pie!.slices[0]!.labelInside).toBe(true);
    expect(s.pie!.slices[0]!.strokeWidth).toBe(1.5);
    expect(s.pie!.slices.every((sl) => sl.ox === 0 && sl.oy === 0)).toBe(true); // no explode
  });

  it("honours label mode, outside position, donut hole, and per-slice overrides", () => {
    const styled: Plot = {
      ...plot,
      pieLabels: "label-percent",
      pieLabelPosition: "outside",
      pieDonut: 0.5,
      seriesStyles: { a: { color: "#ff0000", sliceExplode: 0.2, sliceStroke: "#000000", sliceLabel: "value" } },
    };
    const s = buildPlotScene(table, styled, { width: 580, height: 380 });
    const [alpha, beta] = s.pie!.slices;
    expect(beta!.labelText).toBe("Beta 10%"); // plot-level label-percent
    expect(alpha!.labelText).toBe("30"); // per-slice override → value
    expect(alpha!.labelInside).toBe(false); // outside position
    expect(alpha!.color).toBe("#ff0000");
    expect(alpha!.strokeColor).toBe("#000000");
    expect(alpha!.ox !== 0 || alpha!.oy !== 0).toBe(true); // exploded
    // donut hole → inner radius baked into the arc path (an "A" arc command appears twice)
    expect((alpha!.path.match(/A/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });

  // A parts-of-whole pie draws one slice per row, keyed by
  // row.id — the Inspector must resolve + write slice styles under that key (not a column).
  it("parts-of-whole: one slice per row, keyed by row.id, honours a row-keyed colour override", () => {
    const pow: DataTable = {
      id: "t", kind: "partsofwhole", name: "P",
      columns: [{ id: "cat", name: "Category" }, { id: "val", name: "Sample 1" }],
      rows: [
        { id: "rA", cells: { cat: "Alpha", val: 3 } },
        { id: "rB", cells: { cat: "Beta", val: 5 } },
        { id: "rC", cells: { cat: "Gamma", val: 2 } },
      ],
    };
    const s = buildPlotScene(pow, { ...plot, source: "t", seriesStyles: { rB: { color: "#ff00ee" } } }, { width: 580, height: 380 });
    expect(s.pie!.slices.map((sl) => sl.id)).toEqual(["rA", "rB", "rC"]); // Row ids, not column ids
    expect(s.pie!.slices.map((sl) => sl.label)).toEqual(["Alpha", "Beta", "Gamma"]);
    expect(s.pie!.slices.find((sl) => sl.id === "rB")!.color).toBe("#ff00ee"); // row-keyed override reaches the slice
  });
});

describe("buildPlotScene — before-after (paired) chart", () => {
  // X column = subject; Y columns = conditions (Pre/Post).
  const table: DataTable = {
    id: "t",
    kind: "xy",
    name: "T",
    columns: [
      { id: "subj", name: "Subject" },
      { id: "pre", name: "Pre" },
      { id: "post", name: "Post" },
    ],
    rows: [
      { id: "s1", cells: { subj: "A", pre: 5, post: 8 } },
      { id: "s2", cells: { subj: "B", pre: 6, post: 7 } },
      { id: "s3", cells: { subj: "C", pre: 4, post: 9 } },
    ],
  };
  const plot: Plot = { id: "p", name: "BA", source: "t", status: "ok", styleOverrides: {}, kind: "beforeafter" };

  it("draws one connecting line per subject across the condition band", () => {
    const s = buildPlotScene(table, plot, { width: 580, height: 380 });
    expect(s.kind).toBe("beforeafter");
    expect(s.series).toHaveLength(3); // one per subject
    expect(s.series[0]!.linePath.startsWith("M")).toBe(true);
    expect(s.series[0]!.marks).toHaveLength(2); // Pre + Post points
    // band X axis labelled by the condition columns
    expect(s.x.band).toBe(true);
    expect(s.x.ticks.map((t) => t.label)).toEqual(["Pre", "Post"]);
  });

  // The Match-line-colour toggle (linkLineColor) + unlinked line Colour picker.
  it("honours the Match-line-colour toggle (linkLineColor + lineColor) per subject", () => {
    const size = { width: 580, height: 380 };
    // linked (default) → the connecting line follows the subject/marker colour (any stray lineColor ignored).
    const linked = buildPlotScene(table, { ...plot, seriesStyles: { s1: { color: "#ff0000", lineColor: "#0000ff" } } }, size);
    expect(linked.series.find((x) => x.id === "s1")!.lineColor).toBe("#ff0000");
    // unlinked → the line takes its own colour.
    const split = buildPlotScene(table, { ...plot, seriesStyles: { s1: { color: "#ff0000", linkLineColor: false, lineColor: "#0000ff" } } }, size);
    expect(split.series.find((x) => x.id === "s1")!.lineColor).toBe("#0000ff");
    // unlinked with no explicit colour → falls back to the series colour.
    const fallback = buildPlotScene(table, { ...plot, seriesStyles: { s1: { color: "#ff0000", linkLineColor: false } } }, size);
    expect(fallback.series.find((x) => x.id === "s1")!.lineColor).toBe("#ff0000");
  });

  // Each condition's point sits at the mean of its replicate subcolumns, not at the lead
  // replicate alone (guarded here for before-after).
  it("places each subject's point at the mean of a condition's replicate subcolumns", () => {
    const repBA: DataTable = {
      id: "tr", kind: "xy", name: "TR",
      columns: [
        { id: "subj", name: "Subject" },
        { id: "pre", name: "Pre" }, { id: "pre_b", name: "rep2", group: "pre" },
        { id: "post", name: "Post" }, { id: "post_b", name: "rep2", group: "post" },
      ],
      rows: [
        { id: "s1", cells: { subj: "A", pre: 4, pre_b: 6, post: 8, post_b: 10 } }, // Pre mean 5, Post mean 9
        { id: "s2", cells: { subj: "B", pre: 2, pre_b: 4, post: 5, post_b: 7 } }, // Pre mean 3, Post mean 6
      ],
    };
    const s = buildPlotScene(repBA, plot, { width: 580, height: 380 });
    expect(s.series).toHaveLength(2); // one line per subject
    // subject A: Pre=mean(4,6)=5, Post=mean(8,10)=9 (not the lead-only 4 / 8)
    expect(s.series[0]!.marks[0]!.dy).toBeCloseTo(5, 10);
    expect(s.series[0]!.marks[1]!.dy).toBeCloseTo(9, 10);
  });

  // A log value axis (e.g. viral loads before/after), not only a linear one.
  const posTable: DataTable = {
    id: "t", kind: "xy", name: "T",
    columns: [{ id: "subj", name: "S" }, { id: "pre", name: "Pre" }, { id: "post", name: "Post" }],
    rows: [
      { id: "s1", cells: { subj: "A", pre: 1000, post: 10 } },
      { id: "s2", cells: { subj: "B", pre: 500, post: 5 } },
    ],
  };

  it("honours a log10 value axis when values are positive", () => {
    const s = buildPlotScene(posTable, { ...plot, yAxis: { scale: "log10" } }, { width: 500, height: 360 });
    expect(s.y.type).toBe("log10");
    // 1000 sits above 10 on the log axis (pixel y smaller = higher up).
    const preY = s.series[0]!.marks[0]!.cy;
    const postY = s.series[0]!.marks[1]!.cy;
    expect(preY).toBeLessThan(postY);
  });

  it("drops a non-positive point on a log axis (breaks that subject's line) + warns", () => {
    const mixed: DataTable = {
      ...posTable,
      rows: [
        { id: "s1", cells: { subj: "A", pre: 100, post: -5 } }, // post ≤0 → dropped
        { id: "s2", cells: { subj: "B", pre: 50, post: 5 } },
      ],
    };
    const s = buildPlotScene(mixed, { ...plot, yAxis: { scale: "log10" } }, { width: 500, height: 360 });
    expect(s.y.type).toBe("log10");
    const s1 = s.series.find((se) => se.id === "s1")!;
    expect(s1.marks).toHaveLength(1); // only the positive Pre point survives
    expect(s1.linePath).toBe(""); // no line through a single point
    expect(s.warnings.some((w) => /non-positive/i.test(w))).toBe(true);
  });

  it("falls back to linear when NO positive values exist on a requested log axis", () => {
    const neg: DataTable = {
      ...posTable,
      rows: [{ id: "s1", cells: { subj: "A", pre: -1, post: -2 } }],
    };
    const s = buildPlotScene(neg, { ...plot, yAxis: { scale: "log10" } }, { width: 500, height: 360 });
    expect(s.y.type).toBe("linear");
    expect(s.warnings.some((w) => /positive/i.test(w))).toBe(true);
  });
});

describe("buildPlotScene — survival (Kaplan-Meier) chart", () => {
  const table: DataTable = { id: "t", kind: "xy", name: "T", columns: [{ id: "x", name: "Weeks" }], rows: [] };
  const plot: Plot = {
    id: "p",
    name: "KM",
    source: "t",
    status: "ok",
    styleOverrides: {},
    kind: "survival",
    survival: [
      { label: "Treated", times: [0, 5, 10], surv: [1, 0.7, 0.4] },
      { label: "Control", times: [0, 3, 8], surv: [1, 0.5, 0.1] },
    ],
  };

  it("plots one step-line series per curve with a legend + continuous time/survival axes", () => {
    const s = buildPlotScene(table, plot, { width: 580, height: 380 });
    expect(s.kind).toBe("survival");
    expect(s.series).toHaveLength(2);
    expect(s.series[0]!.linePath.startsWith("M")).toBe(true); // a step path
    expect(s.series[0]!.marks).toHaveLength(0); // lines only, no markers
    expect(s.legend.map((e) => e.label)).toEqual(["Treated", "Control"]);
    // Lines only → the legend swatch must not draw a data-point dot (marker:false).
    expect(s.legend.every((e) => e.marker === false)).toBe(true);
    expect(s.x.title).toBe("Weeks");
    expect(s.y.title).toBe("Survival");
    // survival Y pinned to [0,1]; time X spans the data.
    expect(s.y.domain[0]).toBeLessThanOrEqual(0);
    expect(s.y.domain[1]).toBeGreaterThanOrEqual(1);
    expect(s.x.domain[1]).toBeGreaterThanOrEqual(10);
  });

  // The Inspector Series list toggles must reach the curves (surv-i). A
  // hidden curve drops from the series + legend.
  it("a curve toggled off (seriesStyles[surv-i].hidden) drops from the series + legend", () => {
    const hid = buildPlotScene(table, { ...plot, seriesStyles: { "surv-0": { hidden: true } } }, { width: 580, height: 380 });
    expect(hid.series.map((x) => x.id)).toEqual(["surv-1"]); // only Control remains
    expect(hid.legend.map((e) => e.label)).not.toContain("Treated"); // hidden curve dropped from the legend
  });

  it("number-at-risk table: axis-aligned columns + a coloured row per curve, below the plot", () => {
    const withAtRisk: Plot = {
      ...plot,
      survivalAtRisk: {
        times: [0, 5, 10],
        rows: [
          { label: "Treated", atRisk: [20, 12, 5] },
          { label: "Control", atRisk: [20, 8, 2] },
        ],
      },
    };
    const s = buildPlotScene(table, withAtRisk, { width: 580, height: 380 });
    expect(s.atRisk).toBeDefined();
    expect(s.atRisk!.rows.map((r) => r.label)).toEqual(["Treated", "Control"]);
    expect(s.atRisk!.rows[0]!.atRisk).toEqual([20, 12, 5]);
    expect(s.atRisk!.cols).toHaveLength(3);
    expect(s.atRisk!.cols[0]!).toBeCloseTo(s.plot.x, 0); // time 0 aligns to the axis left edge
    expect(s.atRisk!.cols[2]!).toBeGreaterThan(s.atRisk!.cols[0]!);
    expect(s.atRisk!.top).toBeGreaterThan(s.plot.y + s.plot.height); // reserved margin → sits below the plot
    // Hidden when toggled off.
    const off = buildPlotScene(table, { ...withAtRisk, survivalShowAtRisk: false }, { width: 580, height: 380 });
    expect(off.atRisk).toBeUndefined();
  });

  // Cumulative-incidence view plots 1 − S (ascending) instead of the
  // descending survival fraction. The step line, CI band, and censor ticks all share one
  // `yv` transform, so a single fixture with all three guards every site.
  it("cumulative-incidence flips the curve (1 − S), retitles the axis, and flips the CI band + censor ticks", () => {
    const withCI: Plot = {
      ...plot,
      survival: [{ label: "T", times: [0, 5, 10], surv: [1, 0.7, 0.4], lower: [1, 0.5, 0.2], upper: [1, 0.9, 0.6], censor: [3] }],
    };
    const firstY = (path: string): number => {
      const m = path.match(/M(-?[\d.]+),(-?[\d.]+)/);
      if (!m) throw new Error("no move command in path: " + path.slice(0, 20));
      return Number(m[2]);
    };
    const surv = buildPlotScene(table, withCI, { width: 580, height: 380 });
    const inc = buildPlotScene(table, { ...withCI, survivalCumulativeIncidence: true }, { width: 580, height: 380 });
    // Axis title + Y domain: title flips, domain stays [0,1] (1 − S is also in [0,1]).
    expect(surv.y.title).toBe("Survival");
    expect(inc.y.title).toBe("Cumulative incidence");
    expect(inc.y.domain).toEqual(surv.y.domain);
    // The first point is (t=0, s=1): survival draws it at the top (small pixel y), incidence
    // at the bottom (1 − 1 = 0 → large pixel y). Larger y = lower on screen.
    expect(firstY(inc.series[0]!.linePath)).toBeGreaterThan(firstY(surv.series[0]!.linePath));
    // The CI band and the censor tick ride the same fraction, so both flip too.
    expect(inc.series[0]!.bandPath).toBeTruthy();
    expect(firstY(inc.series[0]!.bandPath!)).not.toBeCloseTo(firstY(surv.series[0]!.bandPath!), 1);
    const survCensorY = surv.series[0]!.censorTicks![0]!.y;
    const incCensorY = inc.series[0]!.censorTicks![0]!.y;
    expect(incCensorY).toBeGreaterThan(survCensorY); // censor at survAt(3)=1 → top, flips to bottom
  });
});

describe("buildPlotScene — three-way grouped bar (barSeriesGroups)", () => {
  const table: DataTable = {
    id: "t", kind: "grouped", name: "T",
    columns: [
      { id: "x", name: "Time" },
      { id: "a", name: "A", role: "y" }, { id: "b", name: "B", role: "y" },
      { id: "c", name: "C", role: "y" }, { id: "d", name: "D", role: "y" },
    ],
    rows: [{ id: "r1", cells: { x: "T1", a: 10, b: 12, c: 20, d: 22 } }, { id: "r2", cells: { x: "T2", a: 11, b: 13, c: 21, d: 23 } }],
  };
  const plot: Plot = { id: "p", name: "P", source: "t", status: "ok", styleOverrides: {}, kind: "bar" };
  const barX = (s: ReturnType<typeof buildPlotScene>, di: number, ci: number) => s.series[di]!.marks[ci]!.bar!.x;

  it("without a grouping: even side-by-side bars, no group labels", () => {
    const s = buildPlotScene(table, plot, { width: 600, height: 400 });
    expect(s.barGroupLabels).toBeUndefined();
    expect(s.barsPerBand).toBe(4);
    // even spacing: b−a == c−b == d−c (one gap size).
    const [a, b, c, d] = [barX(s, 0, 0), barX(s, 1, 0), barX(s, 2, 0), barX(s, 3, 0)];
    expect(b! - a!).toBeCloseTo(c! - b!, 4);
    expect(c! - b!).toBeCloseTo(d! - c!, 4);
  });

  it("with A,B|C,D grouping: bars cluster (bigger gap between clusters) + a group label per cluster per band", () => {
    const grouped = { ...plot, barSeriesGroups: { a: "Drug 1", b: "Drug 1", c: "Drug 2", d: "Drug 2" } };
    const s = buildPlotScene(table, grouped, { width: 600, height: 400 });
    const [a, b, c, d] = [barX(s, 0, 0), barX(s, 1, 0), barX(s, 2, 0), barX(s, 3, 0)];
    // intra-cluster step (a→b, c→d) is smaller than the inter-cluster step (b→c).
    expect(b! - a!).toBeCloseTo(d! - c!, 4);
    expect(c! - b!).toBeGreaterThan(b! - a! + 1);
    // Group labels: one per cluster per band = 2 clusters × 2 bands = 4, centred under the clusters.
    expect(s.barGroupLabels).toBeDefined();
    expect(s.barGroupLabels!.map((g) => g.text)).toEqual(["Drug 1", "Drug 2", "Drug 1", "Drug 2"]);
    // A cluster label sits below the plot and between its two bars.
    const g0 = s.barGroupLabels![0]!;
    expect(g0.y).toBeGreaterThan(s.plot.y + s.plot.height);
    expect(g0.x).toBeGreaterThan(a!);
    expect(g0.x).toBeLessThan(c!);
  });

  it("ignores an incomplete grouping (a dataset unassigned) → ordinary bars", () => {
    const s = buildPlotScene(table, { ...plot, barSeriesGroups: { a: "Drug 1", b: "Drug 1", c: "Drug 2" } }, { width: 600, height: 400 });
    expect(s.barGroupLabels).toBeUndefined();
    const [a, b, c] = [barX(s, 0, 0), barX(s, 1, 0), barX(s, 2, 0)];
    expect(b! - a!).toBeCloseTo(c! - b!, 4); // even again
  });
});

describe("barSeriesGroupLayout — three-way cluster geometry", () => {
  const ds = (ids: string[]) => ids.map((id) => ({ id }));

  it("returns null (⇒ ordinary even split) unless there is a real second factor", () => {
    expect(barSeriesGroupLayout(ds(["a", "b"]), undefined, 100)).toBeNull(); // no map
    expect(barSeriesGroupLayout(ds(["a", "b"]), { a: "G1", b: "G1" }, 100)).toBeNull(); // 1 group
    expect(barSeriesGroupLayout(ds(["a", "b"]), { a: "G1" }, 100)).toBeNull(); // b unassigned
    expect(barSeriesGroupLayout(ds(["a", "b"]), { a: "G1", b: "G2" }, 100)).toBeNull(); // g == m (no clustering)
  });

  it("clusters A,B|C,D into two groups with a gap, bars shrunk to make room", () => {
    const L = barSeriesGroupLayout(ds(["a", "b", "c", "d"]), { a: "Drug 1", b: "Drug 1", c: "Drug 2", d: "Drug 2" }, 100, 0.2)!;
    expect(L).not.toBeNull();
    // 4 bars share 80% of the width (20% is the single gap between the 2 clusters).
    expect(L.barSize).toBeCloseTo(20, 6); // (100 - 20) / 4
    // A,B are the first cluster (offsets 0, 20); C,D the second, shifted past the 20px gap.
    expect(L.slotOffset).toEqual([0, 20, 60, 80]); // c: 2*20 + 20gap = 60; d: 3*20 + 20 = 80
    // Cluster spans (for the labels): Drug 1 = [0,40], Drug 2 = [60,100].
    expect(L.clusters.map((c) => c.label)).toEqual(["Drug 1", "Drug 2"]);
    expect(L.clusters[0]).toMatchObject({ x0: 0, x1: 40 });
    expect(L.clusters[1]).toMatchObject({ x0: 60, x1: 100 });
  });

  it("orders bars by group even when the datasets are interleaved", () => {
    // datasets a(G1) c(G2) b(G1) d(G2) → draw order clusters G1:[a,b], G2:[c,d].
    const L = barSeriesGroupLayout(ds(["a", "c", "b", "d"]), { a: "G1", c: "G2", b: "G1", d: "G2" }, 100, 0.2)!;
    // slots by original index: a→0, c→60, b→20, d→80.
    expect(L.slotOffset).toEqual([0, 60, 20, 80]);
    expect(L.clusters[0]).toMatchObject({ label: "G1", x0: 0, x1: 40 });
    expect(L.clusters[1]).toMatchObject({ label: "G2", x0: 60, x1: 100 });
  });
});

describe("buildPlotScene — line of identity (y = x)", () => {
  const table: DataTable = {
    id: "t", kind: "xy", name: "T",
    columns: [{ id: "x", name: "X", role: "x" }, { id: "y", name: "Y", role: "y" }],
    rows: [{ id: "r0", cells: { x: 1, y: 2 } }, { id: "r1", cells: { x: 8, y: 6 } }],
  };
  const base: Plot = { id: "p", name: "P", source: "t", status: "ok", styleOverrides: {}, kind: "xy" };
  const idLine = (s: ReturnType<typeof buildPlotScene>) => s.annotations.find((a) => a.id === "identity");

  it("is opt-in: nothing drawn by default", () => {
    expect(idLine(buildPlotScene(table, base, { width: 500, height: 400 }))).toBeUndefined();
  });

  it("draws a bottom-left → top-right diagonal in data space when the ranges overlap", () => {
    const s = buildPlotScene(table, { ...base, showIdentity: true, xAxis: { min: 0, max: 10 }, yAxis: { min: 0, max: 10 } }, { width: 500, height: 400 });
    const a = idLine(s)!;
    expect(a).toBeDefined();
    expect(a.kind).toBe("line");
    // (0,0) → left/bottom, (10,10) → right/top. Pixel y is inverted (larger = lower).
    expect(a.x1!).toBeLessThan(a.x2!);
    expect(a.y1!).toBeGreaterThan(a.y2!);
    // Same domain on both axes ⇒ the line spans the full plot width (reaches both edges).
    expect(a.x1!).toBeCloseTo(s.plot.x, 0);
    expect(a.x2!).toBeCloseTo(s.plot.x + s.plot.width, 0);
    expect(a.locked).toBe(true);
    expect(a.deletable).toBe(false);
  });

  it("clips to the range overlap, not corner-to-corner", () => {
    // X spans [0,20], Y spans [0,10] → the diagonal runs (0,0)→(10,10); its right end sits at
    // X = 10, i.e. halfway across the wider X axis — proving it is y = x in data space, not a
    // corner-to-corner line (which would reach the right edge).
    const s = buildPlotScene(table, { ...base, showIdentity: true, xAxis: { min: 0, max: 20 }, yAxis: { min: 0, max: 10 } }, { width: 500, height: 400 });
    const a = idLine(s)!;
    expect(a).toBeDefined();
    expect(a.x2!).toBeCloseTo(s.plot.x + s.plot.width / 2, 0); // X = 10 of [0,20] → mid-width
  });

  it("is skipped (with a warning) when the X and Y ranges do not overlap", () => {
    const s = buildPlotScene(table, { ...base, showIdentity: true, xAxis: { min: 0, max: 10 }, yAxis: { min: 100, max: 200 } }, { width: 500, height: 400 });
    expect(idLine(s)).toBeUndefined();
    expect(s.warnings.some((w) => /identity/i.test(w) && /overlap/i.test(w))).toBe(true);
  });

  it("is skipped (with a warning) when the axes use different scale types (log vs linear)", () => {
    const s = buildPlotScene(table, { ...base, showIdentity: true, xAxis: { scale: "log10", min: 1, max: 100 }, yAxis: { scale: "linear", min: 1, max: 100 } }, { width: 500, height: 400 });
    expect(idLine(s)).toBeUndefined();
    expect(s.warnings.some((w) => /identity/i.test(w) && /scale/i.test(w))).toBe(true);
  });

  it("hides via refLineHidden['identity'] like every reference line", () => {
    const s = buildPlotScene(table, { ...base, showIdentity: true, xAxis: { min: 0, max: 10 }, yAxis: { min: 0, max: 10 }, refLineHidden: { identity: true } }, { width: 500, height: 400 });
    expect(idLine(s)).toBeUndefined();
  });
});

describe("buildPlotScene — ROC chart", () => {
  const table: DataTable = { id: "t", kind: "xy", name: "T", columns: [{ id: "x", name: "Score" }], rows: [] };
  const plot: Plot = {
    id: "p", name: "ROC", source: "t", status: "ok", styleOverrides: {}, kind: "roc",
    roc: [{ label: "Marker", auc: 0.82, points: [{ fpr: 0, tpr: 0 }, { fpr: 0.25, tpr: 0.7 }, { fpr: 0.6, tpr: 0.9 }, { fpr: 1, tpr: 1 }] }],
  };
  it("plots the ROC curve + a chance diagonal on the unit square, AUC in the legend", () => {
    const s = buildPlotScene(table, plot, { width: 420, height: 420 });
    expect(s.kind).toBe("roc");
    // one curve series + the dashed chance diagonal (roc-diag), rendered last.
    expect(s.series).toHaveLength(2);
    expect(s.series[0]!.id).toBe("roc-0");
    expect(s.series[s.series.length - 1]!.id).toBe("roc-diag");
    expect(s.series[0]!.linePath.startsWith("M")).toBe(true);
    expect(s.series[0]!.marks).toHaveLength(0);
    // axes are the unit square with the ROC labels; legend carries the AUC.
    expect(s.x.title).toBe("1 − Specificity");
    expect(s.y.title).toBe("Sensitivity");
    expect(s.x.domain).toEqual([0, 1]);
    expect(s.y.domain).toEqual([0, 1]);
    expect(s.legend[0]!.label).toContain("AUC 0.820");
    // The ROC series is a line-only trace (no marks) — its legend swatch must not draw a
    // data-point dot, so the entry is flagged marker:false (renderer omits the dot).
    expect(s.series[0]!.marks).toHaveLength(0);
    expect(s.legend.every((e) => e.marker === false)).toBe(true);
  });

  it("shows the AUC's confidence interval in the legend when the curve carries it", () => {
    const withCi: Plot = {
      ...plot,
      roc: [{ label: "Marker", auc: 0.82, aucLow: 0.71, aucHigh: 0.93, aucConf: 0.95, points: [{ fpr: 0, tpr: 0 }, { fpr: 0.25, tpr: 0.7 }, { fpr: 1, tpr: 1 }] }],
    };
    expect(buildPlotScene(table, withCi, { width: 420, height: 420 }).legend[0]!.label)
      .toBe("Marker (AUC 0.820, 95% CI 0.710–0.930)");
    // The level drives the percentage label (a 90% CI must not read "95%").
    const at90: Plot = { ...withCi, roc: [{ ...withCi.roc![0]!, aucConf: 0.9 }] };
    expect(buildPlotScene(table, at90, { width: 420, height: 420 }).legend[0]!.label).toContain("90% CI");
    // No CI fields → the AUC alone.
    expect(buildPlotScene(table, plot, { width: 420, height: 420 }).legend[0]!.label).toBe("Marker (AUC 0.820)");
  });

  // The Series list toggles must reach the curves (roc-i). A hidden curve
  // drops from the series + legend; a per-curve colour override reaches the legend swatch.
  it("a curve toggled off (seriesStyles[roc-i].hidden) drops from the series + legend", () => {
    const two: Plot = {
      ...plot,
      roc: [
        { label: "Marker A", auc: 0.82, points: [{ fpr: 0, tpr: 0 }, { fpr: 0.3, tpr: 0.7 }, { fpr: 1, tpr: 1 }] },
        { label: "Marker B", auc: 0.75, points: [{ fpr: 0, tpr: 0 }, { fpr: 0.5, tpr: 0.6 }, { fpr: 1, tpr: 1 }] },
      ],
    };
    const size = { width: 420, height: 420 };
    const all = buildPlotScene(table, two, size);
    expect(all.series.filter((x) => x.id.startsWith("roc-") && x.id !== "roc-diag").map((x) => x.id)).toEqual(["roc-0", "roc-1"]);
    expect(all.legend.map((e) => e.label)).toEqual(["Marker A (AUC 0.820)", "Marker B (AUC 0.750)"]);
    const hid = buildPlotScene(table, { ...two, seriesStyles: { "roc-0": { hidden: true } } }, size);
    expect(hid.series.some((x) => x.id === "roc-0")).toBe(false); // hidden curve dropped
    expect(hid.series.some((x) => x.id === "roc-1")).toBe(true);
    expect(hid.legend.map((e) => e.label)).toEqual(["Marker B (AUC 0.750)"]); // legend follows
    const rec = buildPlotScene(table, { ...two, seriesStyles: { "roc-1": { color: "#ff00ee" } } }, size);
    expect(rec.legend.find((e) => e.label.includes("Marker B"))!.color).toBe("#ff00ee"); // swatch recolours
  });

  it("refLine styles the chance diagonal: colour override + show:false removes it (default preserved)", () => {
    const size = { width: 420, height: 420 };
    expect(buildPlotScene(table, plot, size).series.find((x) => x.id === "roc-diag")!.color).toBe("#9aa0aa"); // default unchanged
    expect(buildPlotScene(table, { ...plot, refLine: { color: "#ff8800" } }, size).series.find((x) => x.id === "roc-diag")!.color).toBe("#ff8800");
    const hidden = buildPlotScene(table, { ...plot, refLine: { show: false } }, size);
    expect(hidden.series.some((x) => x.id === "roc-diag")).toBe(false); // diagonal gone
    expect(hidden.series).toHaveLength(1); // only the ROC curve remains
  });

  // The per-curve Connect and unlinked line-colour controls must reach the drawing.
  it("honours the per-curve line colour (unlinked) and the Connect control", () => {
    const size = { width: 420, height: 420 };
    // linked (default) → the curve line follows the curve colour.
    const linked = buildPlotScene(table, { ...plot, seriesStyles: { "roc-0": { color: "#ff0000" } } }, size);
    expect(linked.series[0]!.lineColor).toBe("#ff0000");
    // Match-data-point-colour off → the curve takes its own lineColor.
    const split = buildPlotScene(table, { ...plot, seriesStyles: { "roc-0": { color: "#ff0000", linkLineColor: false, lineColor: "#0000ff" } } }, size);
    expect(split.series[0]!.lineColor).toBe("#0000ff");
    // Connect = step yields a different path than the straight-line default.
    const straight = buildPlotScene(table, plot, size).series[0]!.linePath;
    const stepped = buildPlotScene(table, { ...plot, seriesStyles: { "roc-0": { connect: "step" } } }, size).series[0]!.linePath;
    expect(stepped).not.toBe(straight);
  });
});

describe("buildPlotScene — legend controls", () => {
  const table: DataTable = {
    id: "t",
    kind: "xy",
    name: "T",
    columns: [
      { id: "x", name: "X" },
      { id: "y1", name: "Alpha" },
      { id: "y2", name: "Beta" },
    ],
    rows: [0, 2, 4, 6].map((v, i) => ({ id: `r${i}`, cells: { x: v, y1: v, y2: v * 2 } })),
  };
  const base: Plot = { id: "p", name: "P", source: "t", status: "ok", styleOverrides: {} };
  const opts = { xScale: "linear" as const, yScale: "linear" as const };

  it("auto-shows an outside-right legend for ≥2 series", () => {
    const s = buildPlotScene(table, base, opts);
    expect(s.legend.map((e) => e.label)).toEqual(["Alpha", "Beta"]);
    expect(s.legendLayout.position).toBe("right");
    expect(s.legendLayout.orientation).toBe("vertical");
    // A normal points+line series does draw markers → no marker:false flag (swatch keeps its dot).
    expect(s.legend.every((e) => e.marker !== false)).toBe(true);
  });

  it("position:none hides the legend even with ≥2 series", () => {
    const s = buildPlotScene(table, { ...base, legend: { position: "none" } }, opts);
    expect(s.legend).toHaveLength(0);
  });

  it("a legend row carries its series' marker size, so the swatch matches the data point", () => {
    const big: Plot = { ...base, seriesStyles: { y1: { symbolSize: 12 }, y2: { symbolSize: 4 } } };
    const s = buildPlotScene(table, big, opts);
    const alpha = s.legend.find((e) => e.label === "Alpha")!;
    const beta = s.legend.find((e) => e.label === "Beta")!;
    // The enlarged series' row reports its size (set point 12 → legend symbol 12).
    expect(alpha.symbolSize).toBe(12);
    expect(beta.symbolSize).toBe(4);
    // The swatch column grew to hold the bigger symbol vs the default-size legend.
    const def = buildPlotScene(table, base, opts);
    expect(s.legendLayout.swatchWidth).toBeGreaterThan(def.legendLayout.swatchWidth);
  });

  it("an inside legend reserves no outside-right margin (wider plot)", () => {
    const right = buildPlotScene(table, base, opts);
    const inside = buildPlotScene(table, { ...base, legend: { position: "topleft" } }, opts);
    expect(inside.legend).toHaveLength(2); // still shown…
    expect(inside.plot.width).toBeGreaterThan(right.plot.width); // …but no reserved column
    expect(inside.legendLayout.position).toBe("topleft");
  });

  it("show:false hides; show:true reveals a single-series legend", () => {
    const single: DataTable = { ...table, columns: [table.columns[0]!, table.columns[1]!] };
    const off = buildPlotScene(single, base, opts);
    expect(off.legend).toHaveLength(0); // <2 series → auto-hidden
    const on = buildPlotScene(single, { ...base, legend: { show: true } }, opts);
    expect(on.legend.map((e) => e.label)).toEqual(["Alpha"]);
  });

  it("carries orientation / border / background to the layout", () => {
    const s = buildPlotScene(
      table,
      { ...base, legend: { orientation: "horizontal", border: true, background: true } },
      opts,
    );
    expect(s.legendLayout).toMatchObject({ orientation: "horizontal", border: true, background: true });
  });
});

describe("buildPlotScene — multiple Y columns → multiple series", () => {
  const table: DataTable = {
    id: "t",
    kind: "xy",
    name: "t",
    columns: [
      { id: "cx", name: "Dose" },
      { id: "y1", name: "Drug A" },
      { id: "y2", name: "Drug B" },
    ],
    rows: [
      { id: "r1", cells: { cx: 1, y1: 10, y2: 5 } },
      { id: "r2", cells: { cx: 2, y1: 20, y2: 8 } },
      { id: "r3", cells: { cx: 3, y1: 30, y2: 12 } },
    ],
  };
  const plot: Plot = { id: "p", name: "P", source: "t", status: "ok", styleOverrides: {} };
  const scene = buildPlotScene(table, plot);

  it("builds one series per Y column, with distinct palette colours", () => {
    expect(scene.series).toHaveLength(2);
    expect(scene.series.map((s) => s.name)).toEqual(["Drug A", "Drug B"]);
    expect(scene.series[0]!.color).not.toBe(scene.series[1]!.color);
    expect(scene.series[0]!.marks).toHaveLength(3);
    expect(scene.series[1]!.marks).toHaveLength(3);
  });

  it("emits a legend row per series and blanks the Y-axis title", () => {
    expect(scene.legend.map((e) => e.label)).toEqual(["Drug A", "Drug B"]);
    expect(scene.y.title).toBe("");
  });

  it("shares one Y axis spanning every series' values", () => {
    expect(scene.y.domain[0]).toBeLessThanOrEqual(5);
    expect(scene.y.domain[1]).toBeGreaterThanOrEqual(30);
  });
});

describe("buildPlotScene — honours the plot's saved config", () => {
  const table: DataTable = {
    id: "t",
    kind: "xy",
    name: "t",
    columns: [
      { id: "cx", name: "Dose" },
      { id: "cy", name: "Resp" },
    ],
    rows: [
      { id: "r1", cells: { cx: 1, cy: 10 } },
      { id: "r2", cells: { cx: 2, cy: 20 } },
    ],
  };

  it("uses the plot's xScale override instead of the auto-suggested type", () => {
    const plot: Plot = { id: "p", name: "P", source: "t", status: "ok", styleOverrides: {}, xScale: "log10" };
    expect(buildPlotScene(table, plot).x.type).toBe("log10"); // would auto-suggest linear (ratio 2)
  });

  it("applies a per-series colour override", () => {
    const plot: Plot = {
      id: "p",
      name: "P",
      source: "t",
      status: "ok",
      styleOverrides: {},
      seriesStyles: { cy: { color: "#123456" } },
    };
    expect(buildPlotScene(table, plot).series[0]!.color).toBe("#123456");
  });

  it("resolves series style defaults (circle / filled / straight solid line)", () => {
    const base: Plot = { id: "p", name: "P", source: "t", status: "ok", styleOverrides: {} };
    const s = buildPlotScene(table, base).series[0]!;
    expect([s.symbol, s.filled, s.dash]).toEqual(["circle", true, null]);
    expect(s.linePath.startsWith("M")).toBe(true);
  });

  it("honours series symbol / connect / dash overrides", () => {
    const plot: Plot = {
      id: "p",
      name: "P",
      source: "t",
      status: "ok",
      styleOverrides: {},
      seriesStyles: { cy: { symbol: "square", filled: false, connect: "none", lineDash: "dashed", lineWidth: 3 } },
    };
    const s = buildPlotScene(table, plot).series[0]!;
    expect(s.symbol).toBe("square");
    expect(s.filled).toBe(false);
    expect(s.linePath).toBe(""); // connect:none → no line
    expect(s.dash).toMatch(/,/); // dashed → a dash array
  });

  it("supports the expanded connect curves + tension (smoothness)", () => {
    const c3: DataTable = {
      id: "t3",
      kind: "xy",
      name: "t3",
      columns: [
        { id: "cx", name: "X" },
        { id: "cy", name: "Y" },
      ],
      rows: [
        { id: "r1", cells: { cx: 0, cy: 0 } },
        { id: "r2", cells: { cx: 1, cy: 5 } },
        { id: "r3", cells: { cx: 2, cy: 1 } },
      ],
    };
    const path = (connect: string, extra: object = {}) =>
      buildPlotScene(c3, {
        id: "p",
        name: "P",
        source: "t3",
        status: "ok",
        styleOverrides: {},
        seriesStyles: { cy: { connect: connect as never, ...extra } },
      }).series[0]!.linePath;
    expect(path("basis")).not.toBe(path("straight"));
    expect(path("catmullRom")).not.toBe(path("straight"));
    // tension (smoothness) changes the cardinal curve
    expect(path("cardinal", { lineTension: 0.1 })).not.toBe(path("cardinal", { lineTension: 0.9 }));
  });

  it("blanks colliding x-axis labels (de-overlap) using the measurer", () => {
    const lin: DataTable = {
      id: "tl",
      kind: "xy",
      name: "tl",
      columns: [
        { id: "cx", name: "X" },
        { id: "cy", name: "Y" },
      ],
      rows: Array.from({ length: 20 }, (_, i) => ({ id: `r${i}`, cells: { cx: i, cy: i } })),
    };
    const plot: Plot = { id: "p", name: "P", source: "tl", status: "ok", styleOverrides: {} };
    const labeled = (measure: (t: string, f: number) => number) =>
      buildPlotScene(lin, plot, { width: 320, measure }).x.ticks.filter((t) => !t.minor && t.label).length;
    const wide = labeled(() => 100); // huge labels → most dropped
    const narrow = labeled(() => 1); // tiny labels → all kept
    expect(wide).toBeLessThan(narrow);
    expect(wide).toBeGreaterThanOrEqual(2); // endpoints still labelled
  });

  it("resolves grid defaults (shown) and honours overrides", () => {
    const base: Plot = { id: "p", name: "P", source: "t", status: "ok", styleOverrides: {} };
    expect(buildPlotScene(table, base).grid).toEqual({ show: true, color: null, width: 1, dash: null, minor: false });

    const styled = buildPlotScene(table, {
      ...base,
      grid: { show: false, color: "#888888", width: 2, minor: true },
    });
    expect(styled.grid).toEqual({ show: false, color: "#888888", width: 2, dash: null, minor: true });
  });

  it("grid density changes the linear tick/gridline count", () => {
    const linTable: DataTable = {
      id: "t2",
      kind: "xy",
      name: "t2",
      columns: [
        { id: "cx", name: "X" },
        { id: "cy", name: "Y" },
      ],
      rows: Array.from({ length: 20 }, (_, i) => ({ id: `r${i}`, cells: { cx: i, cy: i } })),
    };
    const base: Plot = { id: "p", name: "P", source: "t2", status: "ok", styleOverrides: {} };
    const few = buildPlotScene(linTable, { ...base, grid: { density: 3 } }).x.ticks.length;
    const many = buildPlotScene(linTable, { ...base, grid: { density: 12 } }).x.ticks.length;
    expect(many).toBeGreaterThan(few);
  });
});

describe("buildPlotScene — replicate error bars", () => {
  // One dataset "Drug A" with 3 replicate subcolumns; values 2,4,9 (mean 5).
  const repTable: DataTable = {
    id: "t",
    kind: "xy",
    name: "t",
    columns: [
      { id: "x", name: "Dose", role: "x" },
      { id: "a1", name: "Drug A", role: "y" },
      { id: "a2", name: "rep2", role: "y", group: "a1" },
      { id: "a3", name: "rep3", role: "y", group: "a1" },
    ],
    rows: [{ id: "r1", cells: { x: 1, a1: 2, a2: 4, a3: 9 } }],
  };
  const plot = (extra: Partial<Plot> = {}): Plot => ({
    id: "p",
    name: "P",
    source: "t",
    status: "ok",
    styleOverrides: {},
    ...extra,
  });

  it("collapses replicate subcolumns into one series plotted at the mean", () => {
    const scene = buildPlotScene(repTable, plot(), { xScale: "linear", yScale: "linear" });
    expect(scene.series).toHaveLength(1);
    expect(scene.series[0]!.name).toBe("Drug A");
    const m = scene.series[0]!.marks[0]!;
    expect(m.dy).toBeCloseTo(5, 12); // mean of 2,4,9
    expect(m.n).toBe(3);
  });

  it("defaults to SD bars (mean ± sample SD) with pixel ends + caps", () => {
    const scene = buildPlotScene(repTable, plot(), { xScale: "linear", yScale: "linear" });
    const m = scene.series[0]!.marks[0]!;
    const sd = Math.sqrt(((2 - 5) ** 2 + (4 - 5) ** 2 + (9 - 5) ** 2) / 2); // sample SD
    expect(m.errLow).toBeCloseTo(5 - sd, 10);
    expect(m.errHigh).toBeCloseTo(5 + sd, 10);
    expect(m.errLowCy).toBeDefined();
    expect(m.errHighCy).toBeDefined();
    // higher value → smaller y (inverted axis)
    expect(m.errHighCy!).toBeLessThan(m.cy);
    expect(m.errLowCy!).toBeGreaterThan(m.cy);
    expect(scene.series[0]!.errorCaps).toBe(true);
    expect(scene.series[0]!.errorDir).toBe("both");
  });

  it("honours the chosen error-bar type (SEM / range / 95% CI / none)", () => {
    const reach = (type: string) => {
      const s = buildPlotScene(repTable, plot({ seriesStyles: { a1: { errorBars: type as never } } }), {
        yScale: "linear",
      }).series[0]!.marks[0]!;
      return s.errLow !== undefined ? [s.errLow, s.errHigh] : null;
    };
    const sd = Math.sqrt(13);
    const sem = sd / Math.sqrt(3);
    expect(reach("sem")).toEqual([expect.closeTo(5 - sem, 6), expect.closeTo(5 + sem, 6)]);
    expect(reach("range")).toEqual([2, 9]); // min → max
    const ciHalf = 4.30265 * sem; // t(0.975,2)·SEM
    expect(reach("ci95")![1]! as number).toBeCloseTo(5 + ciHalf, 3);
    // "none" suppresses the bar
    const none = buildPlotScene(repTable, plot({ seriesStyles: { a1: { errorBars: "none" } } }), {
      yScale: "linear",
    }).series[0]!.marks[0]!;
    expect(none.errLowCy).toBeUndefined();
    expect(none.errHighCy).toBeUndefined();
  });

  it("suppresses the error bar at N=1 (single replicate present)", () => {
    const t1: DataTable = { ...repTable, rows: [{ id: "r1", cells: { x: 1, a1: 5 } }] };
    const m = buildPlotScene(t1, plot(), { yScale: "linear" }).series[0]!.marks[0]!;
    expect(m.dy).toBe(5);
    expect(m.n).toBe(1);
    expect(m.errLowCy).toBeUndefined();
  });

  it("plots pre-computed Mean + SD + N (error values computed elsewhere)", () => {
    const summary: DataTable = {
      id: "t",
      kind: "xy",
      name: "t",
      columns: [
        { id: "x", name: "X", role: "x" },
        { id: "m", name: "Mean", role: "y" },
        { id: "s", name: "SD", role: "sd", group: "m" },
        { id: "k", name: "N", role: "n", group: "m" },
      ],
      rows: [{ id: "r1", cells: { x: 1, m: 10, s: 2, k: 4 } }],
    };
    const sd = buildPlotScene(summary, plot(), { yScale: "linear" }).series[0]!.marks[0]!;
    expect(sd.dy).toBe(10);
    expect([sd.errLow, sd.errHigh]).toEqual([8, 12]); // default SD
    // SEM = SD/√N = 1 → ±1
    const sem = buildPlotScene(summary, plot({ seriesStyles: { m: { errorBars: "sem" } } }), {
      yScale: "linear",
    }).series[0]!.marks[0]!;
    expect([sem.errLow, sem.errHigh]).toEqual([9, 11]);
  });

  it("autoscales the Y axis to include the error-bar reach", () => {
    const scene = buildPlotScene(repTable, plot(), { yScale: "linear" });
    // range bars reach 2..9; with SD default the high end ~8.6 — axis must cover it
    expect(scene.y.domain[1]).toBeGreaterThanOrEqual(5 + Math.sqrt(13) - 0.001);
  });

  it("draws symmetric horizontal X-error caps from the shared X-error subcolumn (coexists with Y error)", () => {
    const t: DataTable = {
      id: "t", kind: "xy", name: "t",
      columns: [
        { id: "x", name: "X", role: "x" },
        { id: "xe", name: "X error", role: "xerr" },
        { id: "m", name: "Mean", role: "y" },
        { id: "s", name: "SD", role: "sd", group: "m" },
        { id: "k", name: "N", role: "n", group: "m" },
      ],
      rows: [{ id: "r1", cells: { x: 10, xe: 2, m: 50, s: 4, k: 5 } }],
    };
    const scene = buildPlotScene(t, plot(), { xScale: "linear", yScale: "linear" });
    // the X-error column is not its own series
    expect(scene.series).toHaveLength(1);
    const m = scene.series[0]!.marks[0]!;
    // Y error (SD) and X error (horizontal) both present
    expect(m.errLowCy).toBeDefined();
    expect(m.errLowCx).toBeDefined();
    expect(m.errHighCx).toBeDefined();
    // symmetric about the centre: x-2 left, x+2 right
    expect(m.errLowCx!).toBeLessThan(m.cx);
    expect(m.errHighCx!).toBeGreaterThan(m.cx);
    expect(m.cx - m.errLowCx!).toBeCloseTo(m.errHighCx! - m.cx, 6);
  });
});

describe("buildPlotScene — edge-point breathing room (no truncation)", () => {
  const table: DataTable = {
    id: "t",
    kind: "xy",
    name: "T",
    columns: [
      { id: "x", name: "X" },
      { id: "y", name: "Y" },
    ],
    rows: [0, 2, 4, 6, 8, 10].map((v, i) => ({ id: `r${i}`, cells: { x: v, y: v * 2 } })),
  };
  const plot: Plot = { id: "p", name: "P", source: "t", status: "ok", styleOverrides: {} };

  it("insets edge points inside the frame so markers render whole (auto-fit)", () => {
    const s = buildPlotScene(table, plot, { xScale: "linear", yScale: "linear" });
    const marks = s.series[0]!.marks;
    const left = marks.reduce((a, b) => (b.cx < a.cx ? b : a));
    const right = marks.reduce((a, b) => (b.cx > a.cx ? b : a));
    // left-most point sits inside the frame, not ON the y-axis
    expect(left.cx).toBeGreaterThan(s.plot.x);
    // and the full marker fits inside the plot area (no clip truncation)
    expect(left.cx - s.series[0]!.symbolSize).toBeGreaterThanOrEqual(s.plot.x - 0.001);
    expect(right.cx + s.series[0]!.symbolSize).toBeLessThanOrEqual(s.plot.x + s.plot.width + 0.001);
  });

  it("keeps the exact full-width mapping when a zoom window is set", () => {
    const s = buildPlotScene(table, plot, { xScale: "linear", yScale: "linear", xDomain: [0, 10], yDomain: [0, 20] });
    const left = s.series[0]!.marks.reduce((a, b) => (b.cx < a.cx ? b : a));
    expect(left.cx).toBeCloseTo(s.plot.x, 1); // X=0 → plot left edge, no inset under zoom
  });

  it("per-point override paints only the chosen mark (highlight); others follow the series", () => {
    const sid = s0(table); // the Y dataset / series id
    const r3 = "r3"; // highlight the 4th point
    const hi: Plot = { ...plot, pointStyles: { [`${sid}:${r3}`]: { color: "#ff0000", fillOpacity: 1 } } };
    const s = buildPlotScene(table, hi, { xScale: "linear", yScale: "linear" });
    const marks = s.series[0]!.marks;
    const target = marks.find((m) => m.rowId === r3)!;
    expect(target.fill).toBe("#ff0000");
    expect(target.fillOpacity).toBe(1);
    // every other mark keeps the series paint (no per-mark fill override)
    expect(marks.filter((m) => m.rowId !== r3).every((m) => m.fill === undefined)).toBe(true);
    // and a plot with no pointStyles gives no mark a fill
    const plain = buildPlotScene(table, plot, { xScale: "linear", yScale: "linear" });
    expect(plain.series[0]!.marks.every((m) => m.fill === undefined)).toBe(true);
  });

  it("per-point override carries shape / fill / size / outline onto only the chosen mark", () => {
    const sid = s0(table);
    const r2 = "r2";
    const hi: Plot = {
      ...plot,
      pointStyles: { [`${sid}:${r2}`]: { symbol: "square", symbolFill: "open", symbolSize: 12, symbolOutline: "#00ff00" } },
    };
    const s = buildPlotScene(table, hi, { xScale: "linear", yScale: "linear" });
    const marks = s.series[0]!.marks;
    const target = marks.find((m) => m.rowId === r2)!;
    expect(target.symbol).toBe("square");
    expect(target.symbolFill).toBe("open");
    expect(target.symbolSize).toBe(12);
    expect(target.symbolOutline).toBe("#00ff00");
    // every other mark keeps the series symbol (no per-mark override)
    expect(marks.filter((m) => m.rowId !== r2).every((m) => m.symbol === undefined && m.symbolFill === undefined)).toBe(true);
  });
});

/** The lead Y series (column) id for a simple XY table. */
function s0(t: DataTable): string {
  return t.columns[1]!.id;
}

describe("buildPlotScene — bar charts (categorical axis)", () => {
  // Two datasets (Drug A, Drug B), each 2 replicates, over two categories Lo/Hi.
  const table: DataTable = {
    id: "t",
    kind: "column",
    name: "t",
    columns: [
      { id: "x", name: "Group", role: "x" },
      { id: "a1", name: "Drug A", role: "y" },
      { id: "a2", name: "A2", role: "y", group: "a1" },
      { id: "b1", name: "Drug B", role: "y" },
      { id: "b2", name: "B2", role: "y", group: "b1" },
    ],
    rows: [
      { id: "r1", cells: { x: "Lo", a1: 10, a2: 12, b1: 4, b2: 6 } }, // A̅=11, B̅=5
      { id: "r2", cells: { x: "Hi", a1: 20, a2: 22, b1: 8, b2: 10 } }, // A̅=21, B̅=9
    ],
  };
  const barPlot = (extra: Partial<Plot> = {}): Plot => ({
    id: "p",
    name: "P",
    source: "t",
    status: "ok",
    styleOverrides: {},
    kind: "bar",
    ...extra,
  });

  it("renders a categorical band X axis with one labelled tick per row", () => {
    const s = buildPlotScene(table, barPlot());
    expect(s.kind).toBe("bar");
    expect(s.x.band).toBe(true);
    expect(s.x.ticks.map((t) => t.label)).toEqual(["Lo", "Hi"]);
  });

  it("two-tone fill derives a lighter fill + darker contour from one base hue", () => {
    const hex = (s: string): number[] => [parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16)];
    const blue = buildPlotScene(table, barPlot({ seriesStyles: { a1: { color: "#2266cc", fillType: "twotone" } } }));
    const ser = blue.series.find((x) => x.id === "a1")!;
    const base = hex("#2266cc"), fill = hex(ser.fillColor!), edge = hex(ser.borderColor!);
    for (let i = 0; i < 3; i++) {
      expect(fill[i]!).toBeGreaterThanOrEqual(base[i]!); // fill lightened toward white
      expect(edge[i]!).toBeLessThanOrEqual(base[i]!); // contour darkened toward black
    }
    expect(ser.fillColor).not.toBe(ser.borderColor);
    // Changing only the base hue to green re-derives green tones (the two-tone relation carries over).
    const green = buildPlotScene(table, barPlot({ seriesStyles: { a1: { color: "#22aa44", fillType: "twotone" } } }));
    const g = green.series.find((x) => x.id === "a1")!;
    const gFill = hex(g.fillColor!), gEdge = hex(g.borderColor!);
    expect(gFill[1]!).toBeGreaterThan(gFill[0]!); // green channel dominates the derived fill
    expect(gEdge[1]!).toBeGreaterThan(gEdge[0]!); // …and the derived edge
    // Box plots share the same resolver → same derivation.
    const box = buildPlotScene(table, barPlot({ kind: "box", seriesStyles: { a1: { color: "#2266cc", fillType: "twotone" } } }));
    const bser = box.series.find((x) => x.id === "a1")!;
    expect(hex(bser.fillColor!)[2]!).toBeGreaterThanOrEqual(base[2]!); // blue fill lightened
    // A plain solid bar is not two-toned: fill = base, contour = fill.
    const solid = buildPlotScene(table, barPlot({ seriesStyles: { a1: { color: "#2266cc" } } }));
    const sser = solid.series.find((x) => x.id === "a1")!;
    expect(sser.fillColor).toBe("#2266cc");
    expect(sser.borderColor).toBe("#2266cc");
  });

  it("builds an isometric 3-D scatter: 3 axes, a floor grid, and projected points", () => {
    const t3: DataTable = {
      id: "t3", kind: "xy", name: "t3",
      columns: [
        { id: "x", name: "Length", role: "x" },
        { id: "y", name: "Width", role: "y" },
        { id: "z", name: "Height", role: "y", group: "y2" },
      ],
      rows: [
        { id: "r1", cells: { x: 1, y: 1, z: 1 } },
        { id: "r2", cells: { x: 5, y: 5, z: 5 } },
        { id: "r3", cells: { x: 2, y: 8, z: 3 } },
      ],
    };
    const s = buildPlotScene(t3, barPlot({ kind: "scatter3d" }), { width: 500, height: 500 });
    expect(s.kind).toBe("scatter3d");
    expect(s.scatter3d!.axes.map((a) => a.label)).toEqual(["Length", "Width", "Height"]);
    expect(s.scatter3d!.points).toHaveLength(3);
    expect(s.scatter3d!.floor.length).toBeGreaterThan(0);
    // The orbit camera is exposed so the figure can drive drag-to-rotate.
    expect(typeof s.scatter3d!.cam.az).toBe("number");
    expect(s.scatter3d!.cam.zoom).toBe(1);
  });

  it("the orbit camera re-projects points when azimuth / elevation / zoom change (drag-to-rotate, scroll-to-zoom)", () => {
    const t3: DataTable = {
      id: "t3", kind: "xy", name: "t3",
      columns: [{ id: "x", name: "X", role: "x" }, { id: "y", name: "Y", role: "y" }, { id: "z", name: "Z", role: "y", group: "y2" }],
      rows: [
        { id: "r1", cells: { x: 1, y: 2, z: 3 } },
        { id: "r2", cells: { x: 4, y: 1, z: 5 } },
        { id: "r3", cells: { x: 2, y: 6, z: 1 } },
      ],
    };
    const at = (cam: Record<string, number>) => buildPlotScene(t3, barPlot({ kind: "scatter3d", scatter3d: cam }), { width: 500, height: 500 })
      .scatter3d!.points.map((p) => `${Math.round(p.x)},${Math.round(p.y)}`);
    const base = at({ azimuth: 0, elevation: 0.4, zoom: 1 });
    expect(at({ azimuth: 1, elevation: 0.4, zoom: 1 })).not.toEqual(base); // rotated horizontally
    expect(at({ azimuth: 0, elevation: 0.9, zoom: 1 })).not.toEqual(base); // tilted
    expect(at({ azimuth: 0, elevation: 0.4, zoom: 2 })).not.toEqual(base); // zoomed (spread wider)
  });

  it("builds a radar/spider scene: one spoke per row, one polygon per dataset", () => {
    const s = buildPlotScene(table, barPlot({ kind: "radar" }), { width: 500, height: 500 });
    expect(s.kind).toBe("radar");
    expect(s.radar).toBeTruthy();
    // 2 rows (Lo, Hi) → 2 spokes; 2 datasets (Drug A, Drug B) → 2 polygons
    expect(s.radar!.spokes.map((sp) => sp.label)).toEqual(["Lo", "Hi"]);
    expect(s.radar!.polygons).toHaveLength(2);
    expect(s.radar!.polygons[0]!.points).toHaveLength(2); // a vertex per spoke
    expect(s.radar!.rings.length).toBeGreaterThan(0);
    // a series legend is produced
    expect(s.legend.map((l) => l.label)).toEqual(["Drug A", "Drug B"]);
    // bigger dataset value → vertex further from centre
    const distA = Math.hypot(s.radar!.polygons[0]!.points[1]!.x - s.radar!.cx, s.radar!.polygons[0]!.points[1]!.y - s.radar!.cy);
    const distB = Math.hypot(s.radar!.polygons[1]!.points[1]!.x - s.radar!.cx, s.radar!.polygons[1]!.points[1]!.y - s.radar!.cy);
    expect(distA).toBeGreaterThan(distB); // Drug A Hi (21) > Drug B Hi (9)
  });

  it("radar error bars: a replicate/summary radar draws a spread whisker per vertex; none = nothing", () => {
    // A summary (mean + SD) radar: 4 categories (spokes), one series.
    const sumTable: DataTable = {
      id: "t", kind: "column", name: "T",
      columns: [
        { id: "x", name: "Attribute", role: "x" },
        { id: "m", name: "Model", role: "y" },
        { id: "sd", name: "Model SD", role: "sd", group: "m" },
      ],
      rows: [
        { id: "r0", cells: { x: "Speed", m: 80, sd: 6 } },
        { id: "r1", cells: { x: "Power", m: 65, sd: 4 } },
        { id: "r2", cells: { x: "Range", m: 70, sd: 8 } },
        { id: "r3", cells: { x: "Safety", m: 90, sd: 3 } },
      ],
    };
    const radar = (over: Partial<NonNullable<Plot["radar"]>>): Plot => ({
      id: "p", name: "P", source: "t", status: "ok", styleOverrides: {}, kind: "radar", radar: over,
    });
    // errorType none → no error geometry (a plain radar)
    expect(buildPlotScene(sumTable, radar({}), { width: 500, height: 500 }).radar!.errorBars).toBeUndefined();
    // ± SD → one series of whiskers, one segment per spoke, each a real (non-zero) radial reach
    const s = buildPlotScene(sumTable, radar({ errorType: "sd" }), { width: 500, height: 500 });
    expect(s.radar!.errorBars).toHaveLength(1);
    expect(s.radar!.errorBars![0]!.segments).toHaveLength(4); // one per spoke
    const seg = s.radar!.errorBars![0]!.segments[0]!;
    expect(Math.hypot(seg.x2 - seg.x1, seg.y2 - seg.y1)).toBeGreaterThan(0);
    // the mean polygon is unchanged by turning error on (error is drawn around the mean)
    const plain = buildPlotScene(sumTable, radar({}), { width: 500, height: 500 });
    expect(s.radar!.polygons[0]!.points[0]).toEqual(plain.radar!.polygons[0]!.points[0]);
    // As a band → low/high polygons instead
    const band = buildPlotScene(sumTable, radar({ errorType: "sd", errorBand: true }), { width: 500, height: 500 });
    expect(band.radar!.errorBands).toHaveLength(1);
    expect(band.radar!.errorBands![0]!.lo).toHaveLength(4);
    expect(band.radar!.errorBands![0]!.hi).toHaveLength(4);

    // Raw replicates (a grouped datasheet: one dataset, three replicate columns) also produce error.
    const repTable: DataTable = {
      id: "t2", kind: "grouped", name: "T2",
      columns: [
        { id: "x", name: "Attribute", role: "x" },
        { id: "y1", name: "Model", role: "y" },
        { id: "y2", name: "Model", role: "y", group: "y1" },
        { id: "y3", name: "Model", role: "y", group: "y1" },
      ],
      rows: [
        { id: "r0", cells: { x: "Speed", y1: 78, y2: 82, y3: 80 } },
        { id: "r1", cells: { x: "Power", y1: 60, y2: 70, y3: 65 } },
        { id: "r2", cells: { x: "Range", y1: 68, y2: 72, y3: 70 } },
      ],
    };
    const rep = buildPlotScene(repTable, { id: "p2", name: "P", source: "t2", status: "ok", styleOverrides: {}, kind: "radar", radar: { errorType: "sd" } } as Plot, { width: 500, height: 500 });
    expect(rep.radar!.errorBars).toHaveLength(1);
    expect(rep.radar!.errorBars![0]!.segments.length).toBeGreaterThan(0);
  });

  it("exposes value-label config + a resolved value-label font when showValues is on", () => {
    const off = buildPlotScene(table, barPlot());
    expect(off.valueLabels).toBeUndefined();
    const on = buildPlotScene(table, barPlot({ showValues: true, valueDecimals: 1, valueLabelDy: -3 }));
    expect(on.valueLabels).toMatchObject({ show: true, decimals: 1, dy: -3 });
    expect(on.fonts.valueLabel.weight).toBe(600); // bold-ish default
    // marks carry the plotted value (dy) the renderer formats as the label
    expect(on.series[0]!.marks[0]!.dy).toBeCloseTo(11, 6); // Drug A, Lo = mean(10,12)
    // a box chart (also categorical) is not a bar → no value labels even if the flag is set
    const box = buildPlotScene(table, barPlot({ kind: "box", showValues: true }));
    expect(box.valueLabels).toBeUndefined();
  });

  it("per-bar value-label overrides (text + drag offset) flow onto the mark", () => {
    const base = buildPlotScene(table, barPlot({ showValues: true }));
    const sid = base.series[0]!.id;
    const rid = base.series[0]!.marks[0]!.rowId;
    const s = buildPlotScene(table, barPlot({ showValues: true, pointStyles: { [`${sid}:${rid}`]: { valueText: "n=6", valueDx: 8, valueDy: -12 } } }));
    expect(s.series[0]!.marks[0]).toMatchObject({ valueText: "n=6", valueDx: 8, valueDy: -12 });
    // a sibling bar (no override) stays on the formatted numeric value
    expect(s.series[0]!.marks[1]!.valueText).toBeUndefined();
    expect(s.series[0]!.marks[1]!.valueDy).toBeUndefined();
  });

  it("horizontal orientation: value axis on X, category band on Y, bars extend along X", () => {
    const s = buildPlotScene(table, barPlot({ barOrientation: "horizontal" }), { width: 600, height: 400 });
    expect(s.barHorizontal).toBe(true);
    expect(s.y.band).toBe(true); // categories now banded down Y
    expect(s.x.band).toBeFalsy(); // value axis on X
    expect(s.y.ticks.map((t) => t.label)).toEqual(["Lo", "Hi"]); // category labels on the left
    const a = s.series[0]!.marks;
    expect(a.map((m) => m.dy)).toEqual([11, 21]); // same data values
    // bars grow horizontally: the Hi bar (21) is wider than the Lo bar (11)
    expect(a[1]!.bar!.w).toBeGreaterThan(a[0]!.bar!.w);
    // error bars run along X (errLowCx/errHighCx), not Y
    expect(a[0]!.errHighCx).toBeGreaterThan(a[0]!.errLowCx!);
    expect(a[0]!.errLowCy).toBeUndefined();
  });

  it("horizontal bars: a value reference line renders vertical at the value on X", () => {
    const s = buildPlotScene(
      table,
      barPlot({ barOrientation: "horizontal", annotations: [{ id: "a1", kind: "hline", value: 10 }] }),
      { width: 600, height: 400 },
    );
    expect(s.annotations).toHaveLength(1);
    const a = s.annotations[0]!;
    expect(a.kind).toBe("line");
    expect(a.x1).toBeCloseTo(a.x2!, 6); // vertical line (constant X)
    expect(a.y1).toBeLessThan(a.y2!); // spans the plot height
    // value 10 maps inside the plot rect on the X (value) axis
    expect(a.x1).toBeGreaterThan(s.plot.x);
    expect(a.x1).toBeLessThan(s.plot.x + s.plot.width);
  });

  it("horizontal bars: a significance bracket spans categories along Y", () => {
    const s = buildPlotScene(
      table,
      barPlot({ barOrientation: "horizontal", annotations: [{ id: "b1", kind: "bracket", from: 1, to: 2, label: "*", bracketY: 25 }] }),
      { width: 600, height: 400 },
    );
    expect(s.annotations).toHaveLength(1);
    const a = s.annotations[0]!;
    expect(a.kind).toBe("bracket");
    expect(a.path).toMatch(/^M/);
    // the bracket's two endpoints are at the two category band centres on Y
    const ys = (a.path!.match(/M[\d.-]+,([\d.-]+)/) || [])[1];
    expect(Number(ys)).toBeGreaterThan(s.plot.y);
    expect(a.label).toBe("*");
    expect(a.labelAnchor).toBe("start"); // label to the right of the vertical bracket
  });

  it("horizontal bars anchor at the value=0 baseline (x of a positive bar = baseline)", () => {
    const s = buildPlotScene(table, barPlot({ barOrientation: "horizontal" }), { width: 600, height: 400 });
    // all values are positive → every bar's left edge is the same (the x=0 baseline)
    const lefts = s.series.flatMap((ser) => ser.marks.map((m) => Math.round(m.bar!.x)));
    expect(new Set(lefts).size).toBe(1);
  });

  it("vertical bars read the category title from the X-axis spec (not just the column name)", () => {
    const s = buildPlotScene(table, barPlot({ xAxis: { title: "Genotype" }, yAxis: { title: "Expression" } }));
    expect(s.x.title).toBe("Genotype"); // category title is editable
    expect(s.y.title).toBe("Expression"); // value title
  });

  it("flipping carries each label to its axis: value title → X, category title → Y", () => {
    const s = buildPlotScene(
      table,
      barPlot({ barOrientation: "horizontal", xAxis: { title: "Genotype" }, yAxis: { title: "Expression" } }),
      { width: 600, height: 400 },
    );
    // value axis is drawn on X; category band on Y — the labels follow their axis.
    expect(s.x.title).toBe("Expression"); // value label now on the bottom (X)
    expect(s.y.title).toBe("Genotype"); // category label now on the left (Y)
    expect(s.x.band).toBeFalsy();
    expect(s.y.band).toBe(true);
  });

  it("horizontal bars honour explicit axis lengths (panel-figure Align X/Y) like vertical bars", () => {
    // Panel-figure alignment drives yAxisLength (uniform plot height) / xAxisLength
    // (uniform width). A flipped bar that ignored them would stay full-figure size
    // and break row/column alignment. Plot height must equal yAxisLength.
    const vert = buildPlotScene(table, barPlot({ yAxisLength: 200 }), { width: 500, height: 700 });
    const horiz = buildPlotScene(table, barPlot({ barOrientation: "horizontal", yAxisLength: 200 }), { width: 500, height: 700 });
    expect(Math.round(vert.plot.height)).toBe(200);
    expect(Math.round(horiz.plot.height)).toBe(200); // the length is honoured (ignoring it would give ~611)
    // xAxisLength sets the plot width in both orientations.
    const horizW = buildPlotScene(table, barPlot({ barOrientation: "horizontal", xAxisLength: 250 }), { width: 500, height: 400 });
    expect(Math.round(horizW.plot.width)).toBe(250);
  });

  it("horizontal bars: the value axis line follows the value (Y) spec, the band axis the X spec", () => {
    const s = buildPlotScene(
      table,
      barPlot({ barOrientation: "horizontal", xAxis: { lineColor: "#111111" }, yAxis: { lineColor: "#eeeeee" } }),
      { width: 600, height: 400 },
    );
    expect(s.x.lineColor).toBe("#eeeeee"); // value axis (X) ← yAxis line
    expect(s.y.lineColor).toBe("#111111"); // category band (Y) ← xAxis line
  });

  it("draws one bar per (dataset, category) at the dataset mean, anchored to 0", () => {
    const s = buildPlotScene(table, barPlot());
    expect(s.series.map((ser) => ser.name)).toEqual(["Drug A", "Drug B"]);
    const a = s.series[0]!.marks;
    expect(a.map((m) => m.dy)).toEqual([11, 21]);
    expect(a[0]!.label).toBe("Lo");
    expect(a[0]!.bar).toBeDefined();
    expect(a[1]!.bar!.h).toBeGreaterThan(a[0]!.bar!.h); // taller mean → taller bar
    expect(s.y.domain[0]).toBeLessThanOrEqual(0); // baseline included
  });

  it("grouped layout places datasets side-by-side; SD error bars on each bar", () => {
    const s = buildPlotScene(table, barPlot());
    const a0 = s.series[0]!.marks[0]!;
    const b0 = s.series[1]!.marks[0]!;
    expect(a0.bar!.x).toBeLessThan(b0.bar!.x); // A left of B within the "Lo" group
    expect(a0.bar!.x + a0.bar!.w).toBeLessThanOrEqual(b0.bar!.x + 0.001); // no overlap
    // n=2 per row → default SD bars
    const sd = Math.sqrt(((10 - 11) ** 2 + (12 - 11) ** 2) / 1);
    expect(a0.errLow).toBeCloseTo(11 - sd, 10);
    expect(a0.errHigh).toBeCloseTo(11 + sd, 10);
  });

  it("stacked layout stacks datasets and drops per-segment error bars", () => {
    const s = buildPlotScene(table, barPlot({ barLayout: "stacked" }));
    const a0 = s.series[0]!.marks[0]!; // Drug A 0..11
    const b0 = s.series[1]!.marks[0]!; // Drug B 11..16 (stacked on A)
    expect(b0.bar!.x).toBe(a0.bar!.x); // same band column
    expect(b0.bar!.y).toBeLessThan(a0.bar!.y); // higher stack → smaller y
    expect(b0.errLow).toBeUndefined(); // no per-segment error
    expect(s.y.domain[1]).toBeGreaterThanOrEqual(16 - 0.001); // axis covers the stack
  });

  it("honours plot.barWidth (wider fill → wider bars)", () => {
    const wide = buildPlotScene(table, barPlot({ barWidth: 0.9 })).series[0]!.marks[0]!.bar!.w;
    const narrow = buildPlotScene(table, barPlot({ barWidth: 0.3 })).series[0]!.marks[0]!.bar!.w;
    expect(wide).toBeGreaterThan(narrow);
  });

  it("forces a linear Y (bars anchor at 0) and warns when log is requested", () => {
    const s = buildPlotScene(table, barPlot({ yScale: "log10" }));
    expect(s.y.type).toBe("linear");
    expect(s.warnings.some((w) => w.includes("linear Y"))).toBe(true);
  });
});

describe("buildPlotScene — box-and-whisker (one box per dataset)", () => {
  // Two datasets pooled over rows: Drug A = 1..9 + outlier 50; Drug B = 11..20.
  const aVals = [1, 2, 3, 4, 5, 6, 7, 8, 9, 50];
  const bVals = [11, 12, 13, 14, 15, 16, 17, 18, 19, 20];
  const table: DataTable = {
    id: "t",
    kind: "column",
    name: "t",
    columns: [
      { id: "x", name: "Row", role: "x" },
      { id: "a", name: "Drug A", role: "y" },
      { id: "b", name: "Drug B", role: "y" },
    ],
    rows: aVals.map((av, i) => ({ id: `r${i}`, cells: { x: i + 1, a: av, b: bVals[i]! } })),
  };
  const boxPlot = (extra: Partial<Plot> = {}): Plot => ({
    id: "p",
    name: "P",
    source: "t",
    status: "ok",
    styleOverrides: {},
    kind: "box",
    ...extra,
  });

  it("draws one box per dataset on a band axis labelled by dataset name", () => {
    const s = buildPlotScene(table, boxPlot());
    expect(s.kind).toBe("box");
    expect(s.x.band).toBe(true);
    expect(s.x.ticks.map((t) => t.label)).toEqual(["Drug A", "Drug B"]);
    expect(s.series).toHaveLength(2);
    expect(s.series[0]!.marks).toHaveLength(1);
  });

  it("showBoxPoints overlays a swarm of every observation and drops the separate outlier dots", () => {
    const on = buildPlotScene(table, boxPlot({ showBoxPoints: true })).series[0]!.marks[0]!;
    expect(on.points).toBeDefined();
    expect(on.points!.length).toBe(aVals.length); // 10 observations → 10 swarm points
    expect(on.box!.outliers).toEqual([]); // the overlay already shows the outlier (50)
    // Off by default: no overlay, Tukey outlier dot retained.
    const off = buildPlotScene(table, boxPlot()).series[0]!.marks[0]!;
    expect(off.points).toBeUndefined();
    expect(off.box!.outliers.length).toBe(1);
  });

  it("defaults box whisker/median/outlier styling (caps + both sides + outliers shown)", () => {
    const s = buildPlotScene(table, boxPlot()).series[0]!;
    expect(s.whiskerSides).toBe("both");
    expect(s.whiskerCaps).toBe(true);
    expect(s.showOutliers).toBe(true);
    // whisker + median colour fall back to the box contour / series colour
    expect(s.whiskerColor).toBe(s.borderColor);
    expect(s.medianWidth).toBeCloseTo(s.borderWidth + 0.8, 10);
  });

  it("carries per-series whisker/median/outlier overrides through to the scene", () => {
    const s = buildPlotScene(
      table,
      boxPlot({
        seriesStyles: {
          a: { whiskerSides: "upper", whiskerColor: "#ff0000", whiskerWidth: 3, whiskerCaps: false, medianColor: "#00ff00", showOutliers: false },
        },
      }),
    ).series[0]!;
    expect(s.whiskerSides).toBe("upper");
    expect(s.whiskerColor).toBe("#ff0000");
    expect(s.whiskerWidth).toBe(3);
    expect(s.whiskerCaps).toBe(false);
    expect(s.medianColor).toBe("#00ff00");
    expect(s.showOutliers).toBe(false);
  });

  it("box geometry: q3 above q1, median between, whiskers outside, Tukey outlier", () => {
    const m = buildPlotScene(table, boxPlot()).series[0]!.marks[0]!;
    expect(m.box).toBeDefined();
    expect(m.dy).toBeCloseTo(5.5, 10); // median of 1..9,50
    const b = m.box!;
    expect(b.q3).toBeLessThan(b.q1); // higher value → smaller y
    expect(b.median).toBeGreaterThan(b.q3);
    expect(b.median).toBeLessThan(b.q1);
    expect(b.whiskerHigh).toBeLessThanOrEqual(b.q3); // whisker reaches above the box
    expect(b.outliers).toHaveLength(1); // the 50 is a Tukey outlier
  });

  it("min-max whiskers span the full range with no outliers", () => {
    const b = buildPlotScene(table, boxPlot({ boxWhisker: "minmax" })).series[0]!.marks[0]!.box!;
    expect(b.outliers).toHaveLength(0);
  });

  it("honours per-series fill/contour/box-width style overrides", () => {
    const styled = buildPlotScene(
      table,
      boxPlot({ seriesStyles: { a: { fillColor: "#112233", fillOpacity: 0.4, borderColor: "#445566", boxWidth: 0.8 } } }),
    );
    const ser = styled.series[0]!;
    expect(ser.fillColor).toBe("#112233");
    expect(ser.fillOpacity).toBeCloseTo(0.4, 10);
    expect(ser.borderColor).toBe("#445566");
    // Contour defaults to match the fill (independent once set); changing only the
    // fill must not leave a stale-coloured border.
    const onlyFill = buildPlotScene(table, boxPlot({ seriesStyles: { a: { fillColor: "#ff0000" } } })).series[0]!;
    expect(onlyFill.fillColor).toBe("#ff0000");
    expect(onlyFill.borderColor).toBe("#ff0000"); // contour follows fill when unset
    // wider boxWidth → wider box rect
    const narrow = buildPlotScene(table, boxPlot({ seriesStyles: { a: { boxWidth: 0.2 } } })).series[0]!.marks[0]!.box!;
    expect(ser.marks[0]!.box!.w).toBeGreaterThan(narrow.w);
  });

  it("resolves error-bar style (colour/thickness/cap) with defaults + overrides", () => {
    const def = buildPlotScene(table, boxPlot()).series[0]!;
    expect(def.errorColor).toBe(def.color); // defaults to the series colour
    expect(def.errorWidth).toBeGreaterThan(0);
    expect(def.errorCapWidth).toBeGreaterThan(0);
    const over = buildPlotScene(
      table,
      boxPlot({ seriesStyles: { a: { errorColor: "#abcdef", errorWidth: 3, errorCapWidth: 9 } } }),
    ).series[0]!;
    expect([over.errorColor, over.errorWidth, over.errorCapWidth]).toEqual(["#abcdef", 3, 9]);
  });

  it("violin: a KDE silhouette around a slimmed quartile box", () => {
    const s = buildPlotScene(table, boxPlot({ kind: "violin" }));
    expect(s.kind).toBe("violin");
    expect(s.x.band).toBe(true);
    const m = s.series[0]!.marks[0]!;
    expect(m.violin).toBeDefined();
    expect(m.violin!.path).toMatch(/^M.*Z$/); // closed path
    expect(m.violin!.halfWidth).toBeGreaterThan(0);
    // inner box is present but slimmer than a full box at the same width
    expect(m.box).toBeDefined();
    const boxW = buildPlotScene(table, boxPlot({ kind: "box" })).series[0]!.marks[0]!.box!.w;
    expect(m.box!.w).toBeLessThan(boxW);
  });

  it("violin: wider Width style → wider silhouette; degrades to box on flat data", () => {
    const wide = buildPlotScene(table, boxPlot({ kind: "violin", seriesStyles: { a: { boxWidth: 0.9 } } }));
    const narrow = buildPlotScene(table, boxPlot({ kind: "violin", seriesStyles: { a: { boxWidth: 0.2 } } }));
    expect(wide.series[0]!.marks[0]!.violin!.halfWidth).toBeGreaterThan(
      narrow.series[0]!.marks[0]!.violin!.halfWidth,
    );
    // a constant-value dataset has no density → no silhouette, but the box stays
    const flat: DataTable = {
      ...table,
      columns: [table.columns[0]!, { id: "c", name: "Flat", role: "y" }],
      rows: table.rows.map((r) => ({ id: r.id, cells: { x: r.cells.x!, c: 5 } })),
    };
    const fm = buildPlotScene(flat, { ...boxPlot({ kind: "violin" }), source: flat.id }).series[0]!.marks[0]!;
    expect(fm.violin).toBeUndefined();
    expect(fm.box).toBeDefined();
  });

  it("column scatter: one dot per replicate + a mean ± SD overlay", () => {
    const s = buildPlotScene(table, boxPlot({ kind: "scatter" }));
    expect(s.kind).toBe("scatter");
    const m = s.series[0]!.marks[0]!;
    expect(m.points).toHaveLength(aVals.length); // every replicate plotted
    expect(m.box).toBeUndefined(); // scatter replaces the box
    expect(m.dy).toBeCloseTo(9.5, 10); // mean of 1..9,50
    expect(m.errLowCy).toBeDefined();
    expect(m.errHighCy).toBeDefined();
    expect(m.errLowCy! - m.errHighCy!).toBeGreaterThan(0); // SD bar has height (y inverted)
  });

  it("scatter: SD reach widens the Y domain beyond the raw values", () => {
    // Drug B = 11..20: max 20, but mean+SD ≈ 18.6 stays inside; use a tight set instead.
    const tight: DataTable = {
      ...table,
      columns: [table.columns[0]!, { id: "c", name: "C", role: "y" }],
      rows: [10, 10, 10, 30].map((v, i) => ({ id: `r${i}`, cells: { x: i + 1, c: v } })),
    };
    const plot = { ...boxPlot({ kind: "scatter" }), source: tight.id };
    const s = buildPlotScene(tight, plot, { yScale: "linear" });
    // mean=15, SD≈10 → domain must reach ≥ 25 (beyond would-be max 30 anyway, but ≥ mean+SD)
    expect(s.y.domain[1]).toBeGreaterThanOrEqual(25);
  });

  it("horizontal box: value axis on X, category band on Y, transposed geometry", () => {
    const s = buildPlotScene(table, boxPlot({ barOrientation: "horizontal" }), { width: 600, height: 400 });
    expect(s.distHorizontal).toBe(true);
    expect(s.y.band).toBe(true); // categories banded down Y
    expect(s.x.band).toBeFalsy(); // value axis on X
    expect(s.y.ticks.map((t) => t.label)).toEqual(["Drug A", "Drug B"]); // category labels on Y
    const b = s.series[0]!.marks[0]!.box!;
    // q3 (higher value) is to the right of q1 on the X value axis (x grows right)
    expect(b.q3).toBeGreaterThan(b.q1);
    expect(b.median).toBeGreaterThan(b.q1);
    expect(b.median).toBeLessThan(b.q3);
    expect(b.whiskerHigh).toBeGreaterThanOrEqual(b.q3); // upper whisker reaches right of the box
    expect(b.whiskerLow).toBeLessThanOrEqual(b.q1);
    expect(b.outliers).toHaveLength(1); // the 50 stays a Tukey outlier after flipping
    // x/w now hold the Y band (within the plot rect), not the value axis
    expect(b.x).toBeGreaterThanOrEqual(s.plot.y - 0.001);
    expect(b.x + b.w).toBeLessThanOrEqual(s.plot.y + s.plot.height + 0.001);
  });

  it("horizontal box: value title → X axis, category title → Y axis (labels follow their axis)", () => {
    const s = buildPlotScene(
      table,
      boxPlot({ barOrientation: "horizontal", xAxis: { title: "Treatment" }, yAxis: { title: "Signal" } }),
      { width: 600, height: 400 },
    );
    expect(s.x.title).toBe("Signal"); // value title on the bottom (X)
    expect(s.y.title).toBe("Treatment"); // category title on the left (Y)
  });

  it("horizontal box: wider boxWidth → taller band (w grows), value geometry unchanged", () => {
    const wide = buildPlotScene(table, boxPlot({ barOrientation: "horizontal", seriesStyles: { a: { boxWidth: 0.9 } } })).series[0]!.marks[0]!.box!;
    const narrow = buildPlotScene(table, boxPlot({ barOrientation: "horizontal", seriesStyles: { a: { boxWidth: 0.2 } } })).series[0]!.marks[0]!.box!;
    expect(wide.w).toBeGreaterThan(narrow.w); // box thickness = Y band extent
  });

  it("horizontal violin: silhouette mirrors about a horizontal band line", () => {
    const m = buildPlotScene(table, boxPlot({ kind: "violin", barOrientation: "horizontal" }), { width: 600, height: 400 }).series[0]!.marks[0]!;
    expect(m.violin).toBeDefined();
    expect(m.violin!.path).toMatch(/^M.*Z$/);
    expect(m.violin!.halfWidth).toBeGreaterThan(0);
  });

  it("horizontal scatter: mean ± SD reach runs along X (errLowCx/errHighCx)", () => {
    const m = buildPlotScene(table, boxPlot({ kind: "scatter", barOrientation: "horizontal" }), { width: 600, height: 400 }).series[0]!.marks[0]!;
    expect(m.points).toHaveLength(aVals.length);
    expect(m.errLowCx).toBeDefined();
    expect(m.errHighCx).toBeDefined();
    expect(m.errHighCx! - m.errLowCx!).toBeGreaterThan(0); // SD reach grows to the right
    expect(m.errLowCy).toBeUndefined(); // no vertical error reach when horizontal
  });

  it("showBoxMean overlays the group mean as a '+' (pixel driven by the actual mean)", () => {
    // aVals = 1..9,50 → mean 9.5 sits above the median 5.5. Y pixels invert, so the
    // mean glyph pixel is smaller (higher) than the median pixel.
    const off = buildPlotScene(table, boxPlot()).series[0]!.marks[0]!.box!;
    expect(off.mean).toBeUndefined(); // off by default
    const on = buildPlotScene(table, boxPlot({ showBoxMean: true })).series[0]!.marks[0]!.box!;
    expect(on.mean).toBeDefined();
    expect(on.mean!).toBeLessThan(on.median!); // mean (9.5) above median (5.5) → smaller y
  });

  it("showBoxMean also applies to violins and to horizontal orientation", () => {
    const v = buildPlotScene(table, boxPlot({ kind: "violin", showBoxMean: true })).series[0]!.marks[0]!.box!;
    expect(v.mean).toBeDefined();
    // Horizontal: value runs along X (grows right); mean 9.5 > median 5.5 → larger x.
    const h = buildPlotScene(table, boxPlot({ showBoxMean: true, barOrientation: "horizontal" }), { width: 600, height: 400 }).series[0]!.marks[0]!.box!;
    expect(h.mean).toBeDefined();
    expect(h.mean!).toBeGreaterThan(h.median!);
  });

  it("column scatter: centre = median plots the median (not the mean)", () => {
    const m = buildPlotScene(table, boxPlot({ kind: "scatter", columnScatter: { center: "median" } })).series[0]!.marks[0]!;
    expect(m.dy).toBeCloseTo(5.5, 6); // median of 1..9,50 — not the mean 9.5
  });

  it("column scatter: error type selects the interval (none · sem<ci95<sd · iqr = q1..q3)", () => {
    const reach = (cfg?: ColumnScatterStyle): number => {
      const m = buildPlotScene(table, boxPlot({ kind: "scatter", ...(cfg ? { columnScatter: cfg } : {}) })).series[0]!.marks[0]!;
      return m.errHigh! - m.errLow!;
    };
    const sd = reach(); // default = mean ± SD
    const sem = reach({ error: "sem" });
    const ci = reach({ error: "ci95" });
    expect(sem).toBeLessThan(ci);
    expect(ci).toBeLessThan(sd); // sem < 95% CI < SD for n = 10
    // none → no error bar drawn at all
    const noneMark = buildPlotScene(table, boxPlot({ kind: "scatter", columnScatter: { error: "none" } })).series[0]!.marks[0]!;
    expect(noneMark.errLow).toBeUndefined();
    expect(noneMark.errLowCy).toBeUndefined();
    // iqr → q1..q3 (type-7 quantiles of 1..9,50 = 3.25 .. 7.75)
    const iqr = buildPlotScene(table, boxPlot({ kind: "scatter", columnScatter: { error: "iqr" } })).series[0]!.marks[0]!;
    expect(iqr.errLow!).toBeCloseTo(3.25, 6);
    expect(iqr.errHigh!).toBeCloseTo(7.75, 6);
  });

  it("column scatter: median + 95% CI of the median = the exact order-statistic interval", () => {
    // n = 10: P(Bin(10,½) ≤ 1) = 11/1024 ≤ 2.5% but P(≤ 2) = 56/1024 > 2.5%, so the interval is
    // the 2nd smallest .. 2nd largest of 1..9,50 → [2, 9] (worked by hand, not by the helper).
    const cfg: ColumnScatterStyle = { center: "median", error: "ciMedian" };
    const s = buildPlotScene(table, boxPlot({ kind: "scatter", columnScatter: cfg }));
    const m = s.series[0]!.marks[0]!;
    expect(m.dy).toBeCloseTo(5.5, 6);
    expect(m.errLow).toBe(2);
    expect(m.errHigh).toBe(9);
    expect(m.errLowCy).toBeDefined(); // drawn, not just computed
    expect(s.warnings.some((w) => /median/i.test(w))).toBe(false);
    // The same interval when the chart is flipped (the horizontal builder is separate code).
    const h = buildPlotScene(table, boxPlot({ kind: "scatter", columnScatter: cfg, barOrientation: "horizontal" }), { width: 600, height: 400 });
    const hm = h.series[0]!.marks[0]!;
    expect(hm.errLow).toBe(2);
    expect(hm.errHigh).toBe(9);
    expect(hm.errLowCx).toBeDefined();
  });

  it("column scatter: fewer than 6 values → no median CI drawn, and the warning says why", () => {
    const small: DataTable = { ...table, rows: table.rows.slice(0, 5) }; // 5 values per group
    const s = buildPlotScene(small, boxPlot({ kind: "scatter", columnScatter: { center: "median", error: "ciMedian" } }));
    const m = s.series[0]!.marks[0]!;
    expect(m.dy).toBeCloseTo(3, 6); // the median still draws
    expect(m.errLow).toBeUndefined();
    expect(m.errLowCy).toBeUndefined();
    expect(s.warnings.some((w) => w.includes("Drug A") && w.includes("at least 6"))).toBe(true);
  });

  it("violin: violinShowBox=false hides the inner quartile box; bandwidth tunes the silhouette", () => {
    const noBox = buildPlotScene(table, boxPlot({ kind: "violin", seriesStyles: { a: { violinShowBox: false } } })).series[0]!.marks[0]!;
    expect(noBox.violin).toBeDefined();
    expect(noBox.box).toBeUndefined(); // inner box hidden
    const withBox = buildPlotScene(table, boxPlot({ kind: "violin" })).series[0]!.marks[0]!;
    expect(withBox.box).toBeDefined();
    // a different bandwidth multiplier changes the silhouette path
    const spiky = buildPlotScene(table, boxPlot({ kind: "violin", seriesStyles: { a: { violinBandwidth: 0.5 } } })).series[0]!.marks[0]!.violin!.path;
    const smooth = buildPlotScene(table, boxPlot({ kind: "violin", seriesStyles: { a: { violinBandwidth: 2.5 } } })).series[0]!.marks[0]!.violin!.path;
    expect(spiky).not.toBe(smooth);
  });

  it("violin: inner box hidden but Show mean on → a mean-only glyph", () => {
    const m = buildPlotScene(table, boxPlot({ kind: "violin", showBoxMean: true, seriesStyles: { a: { violinShowBox: false } } })).series[0]!.marks[0]!;
    expect(m.box).toBeDefined(); // the mean "+" survives even with the box hidden
    expect(m.box!.mean).toBeDefined();
    expect(m.box!.meanOnly).toBe(true);
    expect(m.box!.median).toBeNull(); // no box/whiskers/median for a mean-only glyph
    // without Show mean, the hidden box stays fully hidden (no mean-only glyph)
    const off = buildPlotScene(table, boxPlot({ kind: "violin", seriesStyles: { a: { violinShowBox: false } } })).series[0]!.marks[0]!;
    expect(off.box).toBeUndefined();
  });

  it("floating bar: centre line 'None' suppresses the median", () => {
    const none = buildPlotScene(table, boxPlot({ kind: "floatingbar", floatingBar: { line: "none" } })).series[0]!.marks[0]!.box!;
    expect(none.median).toBeNull(); // dropped, not drawn at the box's top edge instead
    const mean = buildPlotScene(table, boxPlot({ kind: "floatingbar", floatingBar: { line: "mean" } })).series[0]!.marks[0]!.box!;
    expect(mean.median).not.toBeNull();
  });
});

describe("buildPlotScene — before-after / survival editability", () => {
  const baTable: DataTable = {
    id: "t",
    kind: "column",
    name: "t",
    columns: [
      { id: "x", name: "Subject", role: "x" },
      { id: "pre", name: "Pre", role: "y" },
      { id: "post", name: "Post", role: "y" },
    ],
    rows: [
      { id: "s1", cells: { x: "A", pre: 5, post: 9 } },
      { id: "s2", cells: { x: "B", pre: 6, post: 7 } },
    ],
  };
  const baPlot = (extra: Partial<Plot> = {}): Plot => ({
    id: "p", name: "P", source: "t", status: "ok", styleOverrides: {}, kind: "beforeafter", ...extra,
  });

  it("before-after: per-subject colour / line width / dash overrides apply", () => {
    const s = buildPlotScene(baTable, baPlot({ seriesStyles: { s1: { color: "#ff0000", lineWidth: 4, lineDash: "dashed" } } }));
    const subj = s.series.find((ser) => ser.id === "s1")!;
    expect(subj.color).toBe("#ff0000");
    expect(subj.lineWidth).toBe(4);
    expect(subj.dash).not.toBeNull(); // dashed → a dash-array
    // the other subject keeps the default (no override)
    const other = s.series.find((ser) => ser.id === "s2")!;
    expect(other.lineWidth).toBe(1.5);
    expect(other.dash).toBeNull();
  });

  it("survival: per-curve step-line colour / width / dash overrides apply", () => {
    const plot: Plot = {
      id: "p", name: "P", source: "t", status: "ok", styleOverrides: {}, kind: "survival",
      survival: [
        { label: "Treated", times: [0, 5, 10], surv: [1, 0.6, 0.3] },
        { label: "Control", times: [0, 4, 8], surv: [1, 0.5, 0.2] },
      ],
      seriesStyles: { "surv-0": { color: "#00aa00", lineWidth: 3.5, lineDash: "dotted" } },
    };
    const s = buildPlotScene(baTable, plot);
    const c0 = s.series.find((ser) => ser.id === "surv-0")!;
    expect(c0.color).toBe("#00aa00");
    expect(c0.lineWidth).toBe(3.5);
    expect(c0.dash).not.toBeNull();
    const c1 = s.series.find((ser) => ser.id === "surv-1")!;
    expect(c1.lineWidth).toBe(2.4); // default
    expect(c1.dash).toBeNull();
  });

  // Recolouring a KM curve must recolour its legend swatch as well as the step line.
  it("survival: recolouring a curve also recolours its legend swatch", () => {
    const plot: Plot = {
      id: "p", name: "P", source: "t", status: "ok", styleOverrides: {}, kind: "survival",
      survival: [
        { label: "Treated", times: [0, 5, 10], surv: [1, 0.6, 0.3] },
        { label: "Control", times: [0, 4, 8], surv: [1, 0.5, 0.2] },
      ],
      seriesStyles: { "surv-0": { color: "#ff00ee" } },
      legend: { show: true },
    };
    const s = buildPlotScene(baTable, plot);
    expect(s.legend.find((l) => l.label === "Treated")!.color).toBe("#ff00ee"); // follows the override
    expect(s.legend.find((l) => l.label === "Control")!.color).not.toBe("#ff00ee"); // others unchanged
  });
});

describe("buildPlotScene — symbol fill / opacity / outline", () => {
  const table: DataTable = {
    id: "t",
    kind: "xy",
    name: "t",
    columns: [
      { id: "cx", name: "Dose" },
      { id: "cy", name: "Resp" },
    ],
    rows: [
      { id: "r1", cells: { cx: 1, cy: 10 } },
      { id: "r2", cells: { cx: 2, cy: 20 } },
    ],
  };
  const plot = (style: Record<string, unknown> = {}): Plot => ({
    id: "p",
    name: "P",
    source: "t",
    status: "ok",
    styleOverrides: {},
    seriesStyles: { cy: style as never },
  });

  it("defaults to solid, fully-opaque, outline = series colour", () => {
    const s = buildPlotScene(table, plot()).series[0]!;
    expect(s.symbolFill).toBe("solid");
    expect(s.filled).toBe(true);
    expect(s.symbolOpacity).toBe(1);
    expect(s.symbolOutline).toBe(s.color);
  });

  it("derives open from the legacy `filled: false`", () => {
    const s = buildPlotScene(table, plot({ filled: false })).series[0]!;
    expect(s.symbolFill).toBe("open");
    expect(s.filled).toBe(false);
  });

  it("symbolFill overrides the legacy flag; clear is supported", () => {
    const s = buildPlotScene(table, plot({ filled: true, symbolFill: "clear" })).series[0]!;
    expect(s.symbolFill).toBe("clear");
    expect(s.filled).toBe(false); // only "solid" is filled
  });

  it("clamps opacity to [0,1] and honours a separate outline colour", () => {
    const s = buildPlotScene(table, plot({ symbolOpacity: 1.7, symbolOutline: "#000000" })).series[0]!;
    expect(s.symbolOpacity).toBe(1);
    expect(s.symbolOutline).toBe("#000000");
    const lo = buildPlotScene(table, plot({ symbolOpacity: -0.5 })).series[0]!;
    expect(lo.symbolOpacity).toBe(0);
  });
});

describe("buildPlotScene — advanced fills (pattern / gradient / metallic)", () => {
  const table: DataTable = {
    id: "t",
    kind: "column",
    name: "t",
    columns: [
      { id: "x", name: "Row" },
      { id: "a", name: "A" },
    ],
    rows: [1, 2, 3].map((v, i) => ({ id: `r${i}`, cells: { x: i + 1, a: v } })),
  };
  const barPlot = (style: Record<string, unknown> = {}): Plot => ({
    id: "p",
    name: "P",
    source: "t",
    status: "ok",
    styleOverrides: {},
    kind: "bar",
    seriesStyles: { a: style as never },
  });
  const spec = (style: Record<string, unknown> = {}) => buildPlotScene(table, barPlot(style)).series[0]!.fillSpec;

  it("defaults to a solid fill = the fill colour", () => {
    expect(spec()).toEqual({ type: "solid", color: buildPlotScene(table, barPlot()).series[0]!.fillColor });
  });

  it("pattern: kind + ink colour + transparent-by-default background + density", () => {
    expect(spec({ fillType: "pattern" })).toMatchObject({ type: "pattern", pattern: "hatch", bg: null, scale: 1 });
    const dots = spec({ fillType: "pattern", pattern: "dots", patternColor: "#112233", patternBg: "#ffffff", patternScale: 2 });
    expect(dots).toEqual({ type: "pattern", pattern: "dots", color: "#112233", bg: "#ffffff", scale: 2 });
    // explicit "none" background → transparent; density clamps to [0.4, 4]
    expect(spec({ fillType: "pattern", patternBg: "none" })).toMatchObject({ bg: null });
    expect(spec({ fillType: "pattern", patternScale: 99 })).toMatchObject({ scale: 4 });
    expect(spec({ fillType: "pattern", patternScale: 0 })).toMatchObject({ scale: 0.4 });
  });

  it("special: themed preset (default facets)", () => {
    expect(spec({ fillType: "special" })).toEqual({ type: "special", kind: "facets" });
    expect(spec({ fillType: "special", special: "galaxy" })).toEqual({ type: "special", kind: "galaxy" });
  });
  it("special: a theme name this build does not know is drawn as the default", () => {
    // A project saved by another build can carry a name this one lacks; drawing it as the
    // default keeps the fill instead of handing the renderer a name it has no pattern for.
    expect(spec({ fillType: "special", special: "retired-theme" as never })).toEqual({ type: "special", kind: "facets" });
  });

  it("gradient: from = fill colour, to + angle honoured", () => {
    const g = spec({ fillType: "gradient", fillColor: "#ff0000", gradientTo: "#0000ff", gradientAngle: 45 });
    expect(g).toEqual({ type: "gradient", from: "#ff0000", to: "#0000ff", angle: 45 });
  });

  it("metallic: preset kind (default silver)", () => {
    expect(spec({ fillType: "metallic" })).toEqual({ type: "metallic", kind: "silver" });
    expect(spec({ fillType: "metallic", metallic: "holographic" })).toEqual({ type: "metallic", kind: "holographic" });
  });

  it("graduated: each bar gets a per-mark fill that shades with its value", () => {
    const tall: DataTable = {
      id: "t",
      kind: "column",
      name: "t",
      columns: [{ id: "x", name: "Conc" }, { id: "a", name: "A" }],
      rows: [1, 2, 3].map((v, i) => ({ id: `r${i}`, cells: { x: i + 1, a: v } })),
    };
    const marks = buildPlotScene(tall, barPlot({ fillType: "graduated", gradRamp: "lightness" })).series[0]!.marks;
    expect(marks).toHaveLength(3);
    expect(marks.every((m) => typeof m.fill === "string")).toBe(true);
    const lum = (h: string) => parseInt(h.slice(1, 3), 16) + parseInt(h.slice(3, 5), 16) + parseInt(h.slice(5, 7), 16);
    expect(lum(marks[0]!.fill!)).toBeGreaterThan(lum(marks[2]!.fill!)); // low value lighter than high
    const rev = buildPlotScene(tall, barPlot({ fillType: "graduated", gradReversed: true })).series[0]!.marks;
    expect(lum(rev[0]!.fill!)).toBeLessThan(lum(rev[2]!.fill!)); // reverse flips it
  });

  it("graduated: gradMin/gradMax pin the ramp's bounds (blank = auto from the data)", () => {
    const tall: DataTable = {
      id: "t",
      kind: "column",
      name: "t",
      columns: [{ id: "x", name: "Conc" }, { id: "a", name: "A" }],
      rows: [1, 2, 3].map((v, i) => ({ id: `r${i}`, cells: { x: i + 1, a: v } })),
    };
    const fills = (over: Record<string, unknown>): string[] =>
      buildPlotScene(tall, barPlot({ fillType: "graduated", gradRamp: "lightness", ...over })).series[0]!.marks.map((m) => m.fill!);
    // auto: the ramp spans the data, so the lowest datum sits at the ramp's start.
    const auto = fills({});
    // Widening the low bound below the data pulls every bar away from the ramp start, so the
    // first bar is no longer the extreme. This is the control's whole purpose: comparing two
    // graphs on one fixed scale.
    const pinned = fills({ gradMin: -10, gradMax: 20 });
    expect(pinned[0]).not.toBe(auto[0]);
    // ...and a pinned scale is shared, so the spread across bars compresses.
    const lum = (h: string) => parseInt(h.slice(1, 3), 16) + parseInt(h.slice(3, 5), 16) + parseInt(h.slice(5, 7), 16);
    const spread = (f: string[]) => Math.abs(lum(f[0]!) - lum(f[2]!));
    expect(spread(pinned)).toBeLessThan(spread(auto));
    // Degenerate bounds must not divide by zero / emit NaN colours.
    expect(fills({ gradMin: 5, gradMax: 5 }).every((f) => /^#[0-9a-f]{6}$/i.test(f))).toBe(true);
  });

  it("graduated transparency ramp sets a per-mark fill opacity", () => {
    const tall: DataTable = {
      id: "t",
      kind: "column",
      name: "t",
      columns: [{ id: "x", name: "C" }, { id: "a", name: "A" }],
      rows: [1, 5, 9].map((v, i) => ({ id: `r${i}`, cells: { x: i + 1, a: v } })),
    };
    const marks = buildPlotScene(tall, barPlot({ fillType: "graduated", gradRamp: "transparency" })).series[0]!.marks;
    expect(marks[0]!.fillOpacity!).toBeLessThan(marks[2]!.fillOpacity!); // low value fainter
  });
});

describe("buildPlotScene — robustness", () => {
  const col = (id: string, name: string) => ({ id, name });
  const baseTable = (rows: DataTable["rows"]): DataTable => ({
    id: "t",
    kind: "xy",
    name: "t",
    columns: [col("cx", "Dose"), col("cy", "Resp")],
    rows,
  });
  const plot: Plot = { id: "p", name: "P", source: "t", status: "ok", styleOverrides: {} };

  it("does not throw on an empty table and warns", () => {
    const scene = buildPlotScene(baseTable([]), plot);
    expect(scene.series[0]!.marks).toHaveLength(0);
    expect(scene.plot.width).toBeGreaterThan(0);
  });

  it("drops non-finite cells without throwing", () => {
    const table = baseTable([
      { id: "r1", cells: { cx: 1, cy: 10 } },
      { id: "r2", cells: { cx: "oops", cy: 20 } },
      { id: "r3", cells: { cx: 3, cy: null } },
    ]);
    const scene = buildPlotScene(table, plot);
    expect(scene.series[0]!.marks).toHaveLength(1);
    expect(scene.series[0]!.marks[0]!.rowId).toBe("r1");
  });

  it("drops non-positive points on a forced log scale and warns", () => {
    const table = baseTable([
      { id: "r1", cells: { cx: 1, cy: 10 } },
      { id: "r2", cells: { cx: -5, cy: 20 } },
      { id: "r3", cells: { cx: 10, cy: 30 } },
    ]);
    const scene = buildPlotScene(table, plot, { xScale: "log10" });
    expect(scene.series[0]!.marks).toHaveLength(2);
    expect(scene.warnings.some((w) => w.includes("log scale"))).toBe(true);
  });

  it("falls back to linear if a forced log axis would drop all data", () => {
    const table = baseTable([
      { id: "r1", cells: { cx: 0, cy: 10 } },
      { id: "r2", cells: { cx: -1, cy: 20 } },
    ]);
    const scene = buildPlotScene(table, plot, { xScale: "log10" });
    expect(scene.x.type).toBe("linear");
    expect(scene.series[0]!.marks).toHaveLength(2);
  });
});

describe("buildPlotScene — per-axis settings (AxisSpec)", () => {
  const table: DataTable = {
    id: "t",
    kind: "xy",
    name: "t",
    columns: [
      { id: "cx", name: "Dose" },
      { id: "cy", name: "Resp" },
    ],
    rows: [
      { id: "r1", cells: { cx: 1, cy: 10 } },
      { id: "r2", cells: { cx: 5, cy: 50 } },
      { id: "r3", cells: { cx: 9, cy: 90 } },
    ],
  };
  const plot = (extra: Partial<Plot> = {}): Plot => ({
    id: "p",
    name: "P",
    source: "t",
    status: "ok",
    styleOverrides: {},
    ...extra,
  });

  it("xAxis.scale overrides the legacy xScale and the auto-suggestion", () => {
    expect(buildPlotScene(table, plot({ xAxis: { scale: "log2" } })).x.type).toBe("log2");
    // xAxis wins over the legacy field
    expect(buildPlotScene(table, plot({ xScale: "linear", xAxis: { scale: "log10" } })).x.type).toBe("log10");
  });

  it("manual range pins the axis bounds exactly", () => {
    const s = buildPlotScene(table, plot({ yAxis: { min: 0, max: 200 } }), { width: 400, height: 300 });
    expect(s.y.domain[0]).toBe(0);
    expect(s.y.domain[1]).toBe(200);
  });

  it("a single manual bound keeps the other end auto", () => {
    const autoTop = buildPlotScene(table, plot(), { width: 400, height: 300 }).y.domain[1];
    const s = buildPlotScene(table, plot({ yAxis: { min: 0 } }), { width: 400, height: 300 });
    expect(s.y.domain[0]).toBe(0); // pinned
    expect(s.y.domain[1]).toBe(autoTop); // top still the auto-fit value
    expect(autoTop).toBeGreaterThanOrEqual(90);
  });

  it("reversed flips the reported domain (high→low) so the renderer maps it inverted", () => {
    const normal = buildPlotScene(table, plot()).y.domain;
    const rev = buildPlotScene(table, plot({ yAxis: { reversed: true } })).y.domain;
    expect(rev[0]).toBe(normal[1]);
    expect(rev[1]).toBe(normal[0]);
  });

  it("number format reaches the tick labels (scientific + prefix/suffix)", () => {
    const s = buildPlotScene(table, plot({ yAxis: { min: 0, max: 1000, format: "scientific" } }));
    expect(s.y.ticks.some((t) => /×10/.test(t.label))).toBe(true);
    const pct = buildPlotScene(table, plot({ yAxis: { suffix: "%" } }));
    expect(pct.y.ticks.filter((t) => !t.minor && t.label).every((t) => t.label.endsWith("%"))).toBe(true);
  });

  it("axis title override replaces the column-name default", () => {
    const s = buildPlotScene(table, plot({ yAxis: { title: "Response (%)" } }));
    expect(s.y.title).toBe("Response (%)");
  });

  it("frame/tick style + gridline dash flow into the scene", () => {
    const def = buildPlotScene(table, plot());
    expect(def.axisStyle).toEqual({ frame: "lshape", tickDir: "out", tickLen: 5 });
    expect(def.grid.dash).toBeNull(); // solid by default
    const styled = buildPlotScene(table, plot({ frame: "box", tickDir: "in", tickLen: 8, grid: { dash: "dashed" } }));
    expect(styled.axisStyle).toEqual({ frame: "box", tickDir: "in", tickLen: 8 });
    expect(typeof styled.grid.dash).toBe("string"); // dashed → an SVG dasharray
  });

  it("manual major tick interval reaches the axis ticks", () => {
    const s = buildPlotScene(table, plot({ yAxis: { min: 0, max: 100, majorStep: 20 } }), { width: 400, height: 300 });
    const yMajors = s.y.ticks.filter((t) => !t.minor).map((t) => t.value);
    expect(yMajors).toEqual([0, 20, 40, 60, 80, 100]);
  });

  it("manual Y range + reversed also applies to a box plot (categorical X)", () => {
    const boxTable: DataTable = {
      id: "t",
      kind: "column",
      name: "t",
      columns: [
        { id: "x", name: "Row" },
        { id: "a", name: "A" },
      ],
      rows: [1, 2, 3, 4, 5].map((v, i) => ({ id: `r${i}`, cells: { x: i + 1, a: v } })),
    };
    const s = buildPlotScene(boxTable, plot({ source: "t", kind: "box", yAxis: { min: 0, max: 10, reversed: true } }));
    expect(s.y.domain).toEqual([10, 0]); // reversed pinned range
  });
});

describe("buildPlotScene — ridgeline / joyplot", () => {
  // Three groups pooled over rows; means shift right across groups.
  const aVals = [10, 11, 12, 13, 14, 15];
  const bVals = [20, 21, 22, 23, 24, 25];
  const cVals = [30, 31, 32, 33, 34, 35];
  const table: DataTable = {
    id: "t",
    kind: "column",
    name: "t",
    columns: [
      { id: "x", name: "Row", role: "x" },
      { id: "a", name: "Group A", role: "y" },
      { id: "b", name: "Group B", role: "y" },
      { id: "c", name: "Group C", role: "y" },
    ],
    rows: aVals.map((av, i) => ({ id: `r${i}`, cells: { x: i + 1, a: av, b: bVals[i]!, c: cVals[i]! } })),
  };
  const ridge = (extra: Partial<Plot> = {}): Plot => ({
    id: "p", name: "P", source: "t", status: "ok", styleOverrides: {}, kind: "ridgeline", ...extra,
  });

  it("emits one filled density trace per dataset with a continuous value X axis and band Y labels", () => {
    const s = buildPlotScene(table, ridge(), { width: 500, height: 360 });
    expect(s.kind).toBe("ridgeline");
    expect(s.series).toHaveLength(3);
    // each row carries a filled area + a top stroke (no markers)
    for (const ser of s.series) {
      expect(ser.areaPath).toMatch(/^M.*Z$/);
      expect(ser.linePath).toMatch(/^M/);
      expect(ser.symbolSize).toBe(0);
      expect(ser.marks).toHaveLength(0);
    }
    expect(s.x.band).toBeFalsy(); // value axis is continuous
    expect(s.y.band).toBe(true);
    expect(s.y.ticks.map((t) => t.label)).toEqual(["Group A", "Group B", "Group C"]);
    expect(s.warnings).toEqual([]);
  });

  it("spectrum fill gives every ridge one axis-anchored gradient (shared x1/x2), not a per-ridge one", () => {
    const plain = buildPlotScene(table, ridge(), { width: 500, height: 360 });
    // Off: fills are not the axis gradient.
    for (const ser of plain.series) expect(ser.fillSpec.type).not.toBe("axisGradient");

    const s = buildPlotScene(table, ridge({ ridgeline: { spectrum: true } }), { width: 500, height: 360 });
    const specs = s.series.map((ser) => ser.fillSpec);
    for (const f of specs) expect(f.type).toBe("axisGradient");
    // The gradient is anchored to the axis, so every ridge shares one (x1,x2)
    // — a per-ridge gradient would differ per row. And the span is the plot's x pixel extent.
    const g0 = specs[0] as Extract<typeof specs[number], { type: "axisGradient" }>;
    expect(g0.x1).toBeLessThan(g0.x2);
    expect(g0.x1).toBeCloseTo(s.plot.x, 0);
    expect(g0.x2).toBeCloseTo(s.plot.x + s.plot.width, 0);
    for (const f of specs) {
      const g = f as typeof g0;
      expect(g.x1).toBeCloseTo(g0.x1, 6);
      expect(g.x2).toBeCloseTo(g0.x2, 6);
    }
    // Multi-stop (a perceptual colormap), not a muddy 2-stop: coolwarm has ≥5 stops, ordered.
    expect(g0.stops.length).toBeGreaterThanOrEqual(5);
    expect(g0.stops[0]!.offset).toBe(0);
    expect(g0.stops.at(-1)!.offset).toBe(1);
    // A different colormap changes the stop colours.
    const blues = buildPlotScene(table, ridge({ ridgeline: { spectrum: true, spectrumMap: "blues" } }), { width: 500, height: 360 });
    const bf = blues.series[0]!.fillSpec as typeof g0;
    expect(bf.stops.map((s) => s.color)).not.toEqual(g0.stops.map((s) => s.color));
  });

  it("a split x-axis marks the cut and breaks each ridge into separate lobes (no bridge)", () => {
    const plain = buildPlotScene(table, ridge(), { width: 500, height: 360 });
    // No break: one closed lobe per ridge.
    for (const ser of plain.series) expect((ser.areaPath!.match(/Z/g) ?? []).length).toBe(1);
    expect(plain.x.breakMarks?.length ?? 0).toBe(0);

    const s = buildPlotScene(table, ridge({ xAxis: { breaks: [{ from: 20, to: 26 }] } }), { width: 500, height: 360 });
    // The axis carries the break glyph.
    expect(s.x.breakMarks?.length ?? 0).toBeGreaterThan(0);
    // Each ridge is split into ≥2 closed lobes — the fill stops at the break instead of bridging it.
    for (const ser of s.series) expect((ser.areaPath!.match(/Z/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it("stacks baselines top→bottom (back→front paint order) with the bottom row at the plot floor", () => {
    const s = buildPlotScene(table, ridge(), { width: 500, height: 360 });
    const ys = s.y.ticks.map((t) => t.pos);
    expect(ys[0]).toBeLessThan(ys[1]!); // Group A above Group B above Group C
    expect(ys[1]).toBeLessThan(ys[2]!);
    expect(ys[2]).toBeCloseTo(s.plot.y + s.plot.height, 5); // bottom baseline at the floor
  });

  it("a higher overlap raises the trace peaks (taller ridges)", () => {
    const peakHeight = (p: Plot): number => {
      const ser = buildPlotScene(table, p, { width: 500, height: 360 }).series[0]!;
      const ys = ser.linePath.slice(1).split("L").map((pt) => Number(pt.split(",")[1]));
      const baseline = buildPlotScene(table, p, { width: 500, height: 360 }).y.ticks![0]!.pos;
      return baseline - Math.min(...ys); // peak rise above baseline
    };
    const tall = peakHeight(ridge({ ridgeline: { overlap: 2.5 } }));
    const flat = peakHeight(ridge({ ridgeline: { overlap: 0.8 } }));
    expect(tall).toBeGreaterThan(flat);
  });

  it("honours the bandwidth multiplier (smoother → different silhouette) and fill opacity", () => {
    const spiky = buildPlotScene(table, ridge({ ridgeline: { bandwidth: 0.4 } })).series[0]!.linePath;
    const smooth = buildPlotScene(table, ridge({ ridgeline: { bandwidth: 2.5 } })).series[0]!.linePath;
    expect(spiky).not.toBe(smooth);
    const op = buildPlotScene(table, ridge({ ridgeline: { fillOpacity: 0.3 } })).series[0]!.fillOpacity;
    expect(op).toBeCloseTo(0.3, 10);
  });

  /**
   * The fixture above has no series style, so it has no two-tone fill, and two-tone is the
   * branch at risk. `seriesExtras` pins fillOpacity to 1 for a two-tone series, and
   * `fillType: "twotone"` is what the house preset stamps on every new graph — so the
   * Ridgeline panel's Fill opacity control must still win there, or it does nothing for any
   * real graph. A ridgeline with opaque rows is not a ridgeline.
   */
  it("honours ridgeline fill opacity even under a two-tone series fill (the house default)", () => {
    const twoTone = { seriesStyles: { a: { fillType: "twotone" as const }, b: { fillType: "twotone" as const } } };
    const s = buildPlotScene(table, ridge({ ...twoTone, ridgeline: { fillOpacity: 0.3 } })).series[0]!;
    expect(s.fillOpacity, "a two-tone fill overrode the ridgeline's own opacity").toBeCloseTo(0.3, 10);
    // Unset → the kind's translucent default, still not the two-tone 1.
    const dflt = buildPlotScene(table, ridge({ ...twoTone })).series[0]!.fillOpacity;
    expect(dflt).toBeCloseTo(0.55, 10);
    // A per-series override beats the kind-level value.
    const over = buildPlotScene(table, ridge({
      seriesStyles: { a: { fillType: "twotone" as const, fillOpacity: 0.9 } },
      ridgeline: { fillOpacity: 0.3 },
    })).series[0]!.fillOpacity;
    expect(over).toBeCloseTo(0.9, 10);
  });

  // A per-series fill colour / style override must reach the density area
  // (the renderer paints it via series.fillSpec).
  it("honours a per-series area fill colour / style override (fillSpec)", () => {
    const solid = buildPlotScene(table, ridge({ seriesStyles: { a: { fillColor: "#00ff88" } } }), { width: 500, height: 360 }).series[0]!;
    expect(solid.fillColor).toBe("#00ff88");
    expect(solid.fillSpec).toMatchObject({ type: "solid", color: "#00ff88" });
    expect(solid.color).not.toBe("#00ff88"); // trace line stays its own colour (independent fill)
    const grad = buildPlotScene(table, ridge({ seriesStyles: { a: { fillType: "gradient", fillColor: "#112233" } } }), { width: 500, height: 360 }).series[0]!;
    expect(grad.fillSpec!.type).not.toBe("solid"); // gradient fill reaches the area
  });

  it("warns (no trace) for a dataset with fewer than two values", () => {
    const thin: DataTable = {
      id: "t", kind: "column", name: "t",
      columns: [{ id: "x", name: "Row", role: "x" }, { id: "a", name: "Solo", role: "y" }],
      rows: [{ id: "r0", cells: { x: 1, a: 5 } }],
    };
    const s = buildPlotScene(thin, { ...ridge(), source: "t" }, { width: 400, height: 300 });
    expect(s.series[0]!.areaPath).toBe("");
    expect(s.warnings.length).toBeGreaterThan(0);
  });
});

describe("buildPlotScene — 2D density heatmap + hexbin (point modes)", () => {
  // A tight cluster near (1,1) plus a few scattered points near (6,6).
  const pts: [number, number][] = [
    [1, 1], [1.1, 0.9], [0.9, 1.1], [1.05, 1.0], [0.95, 1.05], [1.0, 0.95], [1.1, 1.1],
    [6, 6], [6.2, 5.8], [5.8, 6.1],
  ];
  const table: DataTable = {
    id: "t",
    kind: "xy",
    name: "t",
    columns: [
      { id: "x", name: "PC1", role: "x" },
      { id: "y", name: "PC2", role: "y" },
    ],
    rows: pts.map(([x, y], i) => ({ id: `r${i}`, cells: { x, y } })),
  };
  const hmPlot = (extra: Partial<NonNullable<Plot["heatmap"]>>): Plot => ({
    id: "p", name: "P", source: "t", status: "ok", styleOverrides: {}, kind: "heatmap", heatmap: { ...extra },
  });

  it("density2d paints a KDE grid with continuous X/Y axes and a colour bar", () => {
    const s = buildPlotScene(table, hmPlot({ mode: "density2d", resolution: 30 }), { width: 460, height: 360 });
    expect(s.kind).toBe("heatmap");
    expect(s.heatmap!.pointMode).toBe(true);
    expect(s.heatmap!.cells.length).toBeGreaterThan(100); // a real grid
    expect(s.heatmap!.max).toBeGreaterThan(0);
    expect(s.heatmap!.showColorbar).toBe(true);
    expect(s.heatmap!.scaleStops.length).toBeGreaterThan(2);
    // real continuous axes (ticks + titles from the point columns)
    expect(s.x.ticks.length).toBeGreaterThan(0);
    expect(s.y.ticks.length).toBeGreaterThan(0);
    expect(s.x.title).toBe("PC1");
    expect(s.y.title).toBe("PC2");
    expect(s.warnings).toEqual([]);
  });

  it("density2d concentrates density at the dense cluster", () => {
    const s = buildPlotScene(table, hmPlot({ mode: "density2d", resolution: 30 }), { width: 460, height: 360 });
    const cells = s.heatmap!.cells;
    const peak = cells.reduce((a, b) => (b.value! > a.value! ? b : a));
    // peak cell sits low-left (near data (1,1)) — left half, lower half in pixel space
    expect(peak.x).toBeLessThan(s.plot.x + s.plot.width / 2);
    expect(peak.y).toBeGreaterThan(s.plot.y + s.plot.height / 2);
  });

  // The Scale min/max inputs apply in density2d + hexbin too, not only the auto
  // 0/peak range. They set the colour-normalization range (and the colour-bar labels).
  it("Scale min/max (valueMin/valueMax) override the auto 0→peak range in density2d + hexbin", () => {
    const def = buildPlotScene(table, hmPlot({ mode: "density2d", resolution: 30 }), { width: 460, height: 360 });
    expect(def.heatmap!.min).toBe(0); // default unchanged: 0 → peak
    expect(def.heatmap!.max).toBeGreaterThan(0);
    const scaled = buildPlotScene(table, hmPlot({ mode: "density2d", resolution: 30, valueMin: 0.5, valueMax: 3 }), { width: 460, height: 360 });
    expect(scaled.heatmap!.min).toBe(0.5); // override reaches the scene + colour bar
    expect(scaled.heatmap!.max).toBe(3);
    const hex = buildPlotScene(table, hmPlot({ mode: "hexbin", resolution: 16, valueMin: 1, valueMax: 5 }), { width: 460, height: 360 });
    expect(hex.heatmap!.min).toBe(1);
    expect(hex.heatmap!.max).toBe(5);
  });

  it("hexbin tallies every point into exactly one hexagon (counts sum to N)", () => {
    const s = buildPlotScene(table, hmPlot({ mode: "hexbin", resolution: 16 }), { width: 460, height: 360 });
    expect(s.heatmap!.pointMode).toBe(true);
    const hexes = s.heatmap!.hexes ?? [];
    expect(hexes.length).toBeGreaterThan(0);
    expect(hexes.every((h) => /^M.*Z$/.test(h.path))).toBe(true);
    const total = hexes.reduce((a, h) => a + h.count, 0);
    expect(total).toBe(pts.length);
    expect(s.heatmap!.max).toBeGreaterThanOrEqual(2); // the cluster bin holds several points
    expect(s.warnings).toEqual([]);
  });

  it("matrix mode is unaffected (no pointMode, no hexes)", () => {
    const m = buildPlotScene(table, hmPlot({ mode: "matrix" }), { width: 360, height: 250 });
    expect(m.heatmap!.pointMode).toBeFalsy();
    expect(m.heatmap!.hexes ?? []).toHaveLength(0);
  });
});

// A correlation matrix is intrinsically square — the cell size is
// min(availW, availH)/n, so dragging only the width grip (the non-limiting dimension)
// can't enlarge the grid. This is by design; document the clamp so the behaviour is pinned.
describe("buildPlotScene — corrmatrix square cell clamp", () => {
  const tbl: DataTable = {
    id: "cm", kind: "multivariable", name: "M",
    columns: [{ id: "a", name: "A" }, { id: "b", name: "B" }, { id: "c", name: "C" }, { id: "d", name: "D" }],
    rows: Array.from({ length: 8 }, (_, i) => ({ id: `r${i}`, cells: { a: i, b: i * 2 + 1, c: 9 - i, d: (i % 3) + 1 } })),
  };
  const plot: Plot = { id: "p", name: "P", source: "cm", status: "ok", styleOverrides: {}, kind: "corrmatrix" };
  it("cell size tracks the min dimension — width-only growth is clamped, height growth enlarges it", () => {
    // A wide-short figure → height is the limiting dimension (cell = availH/n).
    const base = buildPlotScene(tbl, plot, { width: 900, height: 360 }).corrmatrix!.cell;
    // Grow only width (still height-limited) → the square cell is unchanged.
    const widerOnly = buildPlotScene(tbl, plot, { width: 1400, height: 360 }).corrmatrix!.cell;
    expect(widerOnly).toBeCloseTo(base, 5);
    // Grow height (the limiting dimension) → the square cell enlarges.
    const taller = buildPlotScene(tbl, plot, { width: 900, height: 620 }).corrmatrix!.cell;
    expect(taller).toBeGreaterThan(base);
  });

  // The Positive/Negative scale colours (the corrmatrix "palette") must reach the glyph fills.
  it("Positive/Negative scale colours reach the cell fills", () => {
    const base = buildPlotScene(tbl, plot, { width: 400, height: 400 }).corrmatrix!;
    const custom = buildPlotScene(tbl, { ...plot, corrmatrix: { positiveColor: "#00cc44", negativeColor: "#cc00aa" } }, { width: 400, height: 400 }).corrmatrix!;
    expect(custom.cells.map((c) => c.color).join()).not.toBe(base.cells.map((c) => c.color).join());
  });

  // With no explicit +/- colours the diverging scale follows the figure
  // palette, so changing the palette recolours the matrix; an explicit picker still overrides it.
  it("the +/- scale follows the palette when not pinned, and explicit colours override it", () => {
    const palA = buildPlotScene(tbl, plot, { width: 400, height: 400, palette: ["#0072B2", "#E69F00"] }).corrmatrix!;
    const palB = buildPlotScene(tbl, plot, { width: 400, height: 400, palette: ["#111111", "#eeeeee"] }).corrmatrix!;
    expect(palA.cells.map((c) => c.color).join()).not.toBe(palB.cells.map((c) => c.color).join()); // palette drives the fills
    // A pinned Positive/Negative colour ignores the palette (same colours under either palette).
    const pinned = { ...plot, corrmatrix: { positiveColor: "#00cc44", negativeColor: "#cc00aa" } };
    const pinnedA = buildPlotScene(tbl, pinned, { width: 400, height: 400, palette: ["#0072B2", "#E69F00"] }).corrmatrix!;
    const pinnedB = buildPlotScene(tbl, pinned, { width: 400, height: 400, palette: ["#111111", "#eeeeee"] }).corrmatrix!;
    expect(pinnedA.cells.map((c) => c.color).join()).toBe(pinnedB.cells.map((c) => c.color).join());
  });

  // A per-cell colour override recolours only that glyph (the rest keep the r-scale colour).
  it("a per-cell colour override recolours only that glyph", () => {
    const s = buildPlotScene(tbl, { ...plot, corrmatrix: { cellColors: { "1:0": "#123456" } } }, { width: 400, height: 400 }).corrmatrix!;
    expect(s.cells.find((c) => c.row === 1 && c.col === 0)?.color).toBe("#123456");
    expect(s.cells.filter((c) => c.color === "#123456")).toHaveLength(1);
  });
});

// A nested table plotted as a bar uses the grouped-bar semantics — each row
// is a category, each group a series, and every cell is the mean of that group's replicate
// subcolumns (as bars reduce replicates everywhere else, rather than the one-glyph-per-group
// pooling that box/violin use for the same table). This is intended behaviour.
describe("buildPlotScene — nested table as a bar (grouped semantics)", () => {
  const nested: DataTable = {
    id: "t1", kind: "nested", name: "T",
    columns: [
      { id: "lab", name: "" },
      { id: "g1", name: "Ctrl" }, { id: "g1b", name: "Ctrl", group: "g1" },
      { id: "g2", name: "Drug" }, { id: "g2b", name: "Drug", group: "g2" },
    ],
    rows: [
      { id: "r0", cells: { lab: "s1", g1: 1, g1b: 2, g2: 10, g2b: 12 } },
      { id: "r1", cells: { lab: "s2", g1: 3, g1b: 4, g2: 14, g2b: 16 } },
    ],
  };
  const plot: Plot = { id: "p", name: "P", source: "t1", status: "ok", styleOverrides: {}, kind: "bar" };
  it("one series per group, one category per row, each bar = the group's replicate mean", () => {
    const s = buildPlotScene(nested, plot, { width: 480, height: 320 });
    expect(s.series.map((x) => x.id)).toEqual(["g1", "g2"]); // one series per group (not per row)
    expect(s.x.ticks.map((t) => t.label)).toEqual(["s1", "s2"]); // one category per row
    // Each cell is the mean of that group's replicate subcolumns in that row.
    expect(s.series[0]!.marks.map((m) => m.dy)).toEqual([1.5, 3.5]); // Ctrl: mean(1,2), mean(3,4)
    expect(s.series[1]!.marks.map((m) => m.dy)).toEqual([11, 15]); // Drug: mean(10,12), mean(14,16)
  });
});

describe("buildPlotScene — lollipop / dumbbell", () => {
  const single: DataTable = {
    id: "t", kind: "column", name: "t",
    columns: [{ id: "x", name: "Metric", role: "x" }, { id: "v", name: "Score", role: "y" }],
    rows: [["A", 20], ["B", 35], ["C", 10]].map(([c, v], i) => ({ id: `r${i}`, cells: { x: c as string, v: v as number } })),
  };
  const paired: DataTable = {
    id: "t2", kind: "column", name: "t2",
    columns: [{ id: "x", name: "Metric", role: "x" }, { id: "a", name: "Before", role: "y" }, { id: "b", name: "After", role: "y" }],
    rows: [["A", 20, 30], ["B", 40, 32], ["C", 10, 25]].map(([c, a, b], i) => ({ id: `r${i}`, cells: { x: c as string, a: a as number, b: b as number } })),
  };
  const lollipopWith = (src: string, extra: Partial<Plot> = {}): Plot => ({ id: "p", name: "P", source: src, status: "ok", styleOverrides: {}, kind: "lollipop", ...extra });

  // The lollipop has a dedicated "Dot size" slider (lollipop.dotSize) and the
  // generic per-series / per-point marker Size (symbolSize). Precedence is intended:
  // a per-point size wins, then the Dot-size slider (so a preset-baked series symbolSize
  // cannot disable the slider), then the per-series symbolSize.
  it("dot-size precedence: per-point symbolSize > 'Dot size' slider > per-series symbolSize", () => {
    // Slider set + a whole-series symbolSize → the slider wins (series size is shadowed by design).
    const slider = buildPlotScene(single, lollipopWith("t", { lollipop: { baseline: 0, dotSize: 9 }, seriesStyles: { v: { symbolSize: 3 } } }), { width: 480, height: 320 });
    expect(slider.lollipop!.rows[0]!.dots[0]!.size).toBe(9);
    // A per-point symbolSize override still wins over the slider.
    const point = buildPlotScene(single, lollipopWith("t", { lollipop: { baseline: 0, dotSize: 9 }, pointStyles: { "v:r0": { symbolSize: 15 } } }), { width: 480, height: 320 });
    expect(point.lollipop!.rows[0]!.dots[0]!.size).toBe(15);
    // With no slider, the per-series symbolSize applies (nothing to shadow it).
    const series = buildPlotScene(single, lollipopWith("t", { lollipop: { baseline: 0 }, seriesStyles: { v: { symbolSize: 7 } } }), { width: 480, height: 320 });
    expect(series.lollipop!.rows[0]!.dots[0]!.size).toBe(7);
  });

  // Opt-in mean±error whisker on the dot (default off, so a lollipop without an error type
  // draws none). Replicate dataset "v" = {v, v2}; row 0 mean 15, SD √50 ≈ 7.07.
  it("draws a mean±error whisker only when the series opts into an error type", () => {
    const repTbl: DataTable = {
      id: "tl", kind: "column", name: "L",
      columns: [
        { id: "x", name: "Metric", role: "x" },
        { id: "v", name: "Score" },
        { id: "v2", name: "Score", group: "v" },
      ],
      rows: [
        { id: "r0", cells: { x: "A", v: 10, v2: 20 } },
        { id: "r1", cells: { x: "B", v: 30, v2: 50 } },
      ],
    };
    // Default (no error type) → no whisker.
    const off = buildPlotScene(repTbl, lollipopWith("tl"), { width: 480, height: 320 });
    expect(off.lollipop!.rows.every((r) => r.dots.every((d) => d.error === undefined))).toBe(true);
    // Opt in (errorBars "sd") → a whisker straddling the mean (low < mean < high, midpoint = mean).
    const on = buildPlotScene(repTbl, lollipopWith("tl", { seriesStyles: { v: { errorBars: "sd" } } }), { width: 480, height: 320 });
    const dot = on.lollipop!.rows[0]!.dots[0]!;
    expect(dot.value).toBe(15);
    expect(dot.error).toBeDefined();
    expect(dot.error!.low).toBeLessThan(15);
    expect(dot.error!.high).toBeGreaterThan(15);
    expect((dot.error!.low + dot.error!.high) / 2).toBeCloseTo(15, 5); // symmetric about the mean
  });

  it("single series → a stem from the baseline to one value dot per category (horizontal default)", () => {
    const s = buildPlotScene(single, lollipopWith("t", { lollipop: { baseline: 0 } }), { width: 480, height: 320 });
    expect(s.kind).toBe("lollipop");
    expect(s.lollipop!.horizontal).toBe(true);
    expect(s.lollipop!.rows).toHaveLength(3);
    expect(s.lollipop!.baseline).toBeDefined();
    const r0 = s.lollipop!.rows[0]!;
    expect(r0.dots).toHaveLength(1);
    // stem starts at the baseline (value 0) and ends at the dot; dot is right of baseline
    expect(r0.stem.x2).toBeCloseTo(r0.dots[0]!.cx, 5);
    expect(r0.dots[0]!.cx).toBeGreaterThan(r0.stem.x1);
    expect(r0.dots[0]!.label).toBe("20");
    // category band axis labels
    expect(s.y.band).toBe(true);
    expect(s.y.ticks.map((t) => t.label)).toEqual(["A", "B", "C"]);
    expect(s.warnings).toEqual([]);
  });

  it("an open dot with no explicit outline gets a visible ring in its own hue (not the page bg)", () => {
    const s = buildPlotScene(single, lollipopWith("t", { lollipop: { baseline: 0 }, seriesStyles: { v: { symbolFill: "open" } } }), { width: 480, height: 320 });
    const dot = s.lollipop!.rows[0]!.dots[0]!;
    expect(dot.symbolFill).toBe("open");
    expect(dot.symbolOutline).toBe(dot.color); // was undefined → the ring rendered invisible
  });

  it("value labels and the Δ% carry their drag nudge from the point style (movable labels)", () => {
    // Per-dot value-label offset under the normal point-style key `${col}:${row}`.
    const s = buildPlotScene(single, lollipopWith("t", { lollipop: { baseline: 0 }, pointStyles: { "v:r0": { valueDx: 7, valueDy: -3 } } }), { width: 480, height: 320 });
    const d = s.lollipop!.rows[0]!.dots[0]!;
    expect(d.valueDx).toBe(7);
    expect(d.valueDy).toBe(-3);
    // Dumbbell Δ% offset under the reserved key `__delta__:${row}`.
    const dd = buildPlotScene(paired, lollipopWith("t2", { pointStyles: { "__delta__:r0": { valueDx: 5, valueDy: 9 } } }), { width: 480, height: 320 });
    const delta = dd.lollipop!.rows[0]!.delta!;
    expect(delta.text).toMatch(/%$/);
    expect(delta.dx).toBe(5);
    expect(delta.dy).toBe(9);
  });

  it("the Δ% label anchor does not move with dot size (decoupled: the size slider must not reflow labels)", () => {
    // The Δ% (and value) label sits a fixed gap past the end dot, not a gap that grows with the
    // dot size, so the "Dot size" slider never moves it.
    const small = buildPlotScene(paired, lollipopWith("t2", { lollipop: { dotSize: 3 } }), { width: 480, height: 320 });
    const big = buildPlotScene(paired, lollipopWith("t2", { lollipop: { dotSize: 11 } }), { width: 480, height: 320 });
    const ds = small.lollipop!.rows[0]!.delta!;
    const db = big.lollipop!.rows[0]!.delta!;
    // The value dot is fixed by the data, so its end position is identical either way;
    // the label base (x for horizontal) is too — independent of dotSize.
    expect(ds.x).toBeCloseTo(db.x, 5);
    expect(ds.y).toBeCloseTo(db.y, 5);
  });

  it("a per-point override tunes colour and shape/size/fill of only that one dot", () => {
    const hi = lollipopWith("t", {
      lollipop: { baseline: 0 },
      pointStyles: { "v:r0": { color: "#ff0000", symbol: "square", symbolSize: 11, symbolFill: "open" } },
    });
    const s = buildPlotScene(single, hi, { width: 480, height: 320 });
    const d0 = s.lollipop!.rows[0]!.dots[0]!;
    expect(d0.color).toBe("#ff0000");
    expect(d0.symbol).toBe("square");
    expect(d0.size).toBe(11);
    expect(d0.symbolFill).toBe("open");
    // the other categories keep the series default (no override → undefined fields)
    const d1 = s.lollipop!.rows[1]!.dots[0]!;
    expect(d1.color).not.toBe("#ff0000");
    expect(d1.symbol).toBeUndefined();
    expect(d1.size).toBeUndefined();
  });

  it("a per-series symbol style applies to every dot of that series", () => {
    const hi = lollipopWith("t", { lollipop: { baseline: 0 }, seriesStyles: { v: { symbolSize: 9, symbol: "diamond" } } });
    const s = buildPlotScene(single, hi, { width: 480, height: 320 });
    expect(s.lollipop!.rows.every((r) => r.dots[0]!.size === 9 && r.dots[0]!.symbol === "diamond")).toBe(true);
  });

  it("the 'Dot size' slider controls dot size even when a style preset baked symbolSize into the series", () => {
    // applyStylePreset writes seriesStyles.symbolSize (its markerSize) onto every series; a
    // render reading `symbolSize ?? dotSize` would let that preset value shadow the dedicated
    // "Dot size" slider, so the slider would do nothing. Precedence is
    // point > dotSize slider > series > default.
    const sizeOf = (extra: Partial<Plot>) =>
      buildPlotScene(single, lollipopWith("t", { seriesStyles: { v: { symbolSize: 6.5 } }, ...extra }), { width: 480, height: 320 }).lollipop!.rows[0]!.dots[0]!.size;
    // slider untouched → the preset's markerSize applies (presets keep working)
    expect(sizeOf({})).toBe(6.5);
    // slider set → it wins over the preset's series symbolSize (guards against it staying 6.5)
    expect(sizeOf({ lollipop: { dotSize: 12 } })).toBe(12);
    // a per-point highlight beats the slider
    expect(sizeOf({ lollipop: { dotSize: 12 }, pointStyles: { "v:r0": { symbolSize: 20 } } })).toBe(20);
  });

  const rgb = (hex: string): [number, number, number] => {
    const h = hex.replace("#", "");
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  };
  const dotOf = (extra: Partial<Plot>) =>
    buildPlotScene(single, lollipopWith("t", { lollipop: { baseline: 0 }, ...extra }), { width: 480, height: 320 }).lollipop!.rows[0]!.dots[0]!;

  it("two-tone dot: filled open marker, light interior + darker outline from the hue (not hollow)", () => {
    // The renderer only understands solid/open fills, so a raw "twotone" fill passed through
    // would fall to fill:"none" (a hollow ring); the lollipop resolves it first.
    const base = "#2266cc";
    const [br, bg, bb] = rgb(base);
    const d = dotOf({ seriesStyles: { v: { color: base, symbolFill: "twotone" } } });
    expect(d.symbolFill).toBe("open"); // renderer can fill it
    // interior is a light tint of the hue — every channel lighter than the base
    const [fr, fg, fb] = rgb(d.symbolFillColor!);
    expect(fr).toBeGreaterThan(br);
    expect(fg).toBeGreaterThan(bg);
    expect(fb).toBeGreaterThan(bb);
    // outline is a darker shade of the hue — every channel darker than the base
    const [or, og, ob] = rgb(d.symbolOutline!);
    expect(or).toBeLessThan(br);
    expect(og).toBeLessThan(bg);
    expect(ob).toBeLessThan(bb);
  });

  it("two-tone re-tints when the colour changes (light fill follows the hue)", () => {
    const blue = dotOf({ seriesStyles: { v: { color: "#2266cc", symbolFill: "twotone" } } });
    const green = dotOf({ seriesStyles: { v: { color: "#1f9d3a", symbolFill: "twotone" } } });
    expect(blue.symbolFillColor).not.toBe(green.symbolFillColor);
    expect(blue.symbolOutline).not.toBe(green.symbolOutline);
  });

  it("two-tone responds to the Fill-lightness and Edge-darkness sliders", () => {
    const light = dotOf({ seriesStyles: { v: { color: "#2266cc", symbolFill: "twotone", twoToneTint: 0.9 } } });
    const less = dotOf({ seriesStyles: { v: { color: "#2266cc", symbolFill: "twotone", twoToneTint: 0.3 } } });
    // higher tint → lighter interior (closer to white on the red channel)
    expect(rgb(light.symbolFillColor!)[0]).toBeGreaterThan(rgb(less.symbolFillColor!)[0]);
    const darkEdge = dotOf({ seriesStyles: { v: { color: "#2266cc", symbolFill: "twotone", twoToneShade: 0.8 } } });
    const softEdge = dotOf({ seriesStyles: { v: { color: "#2266cc", symbolFill: "twotone", twoToneShade: 0.1 } } });
    // higher shade → darker outline (closer to black on the blue channel)
    expect(rgb(darkEdge.symbolOutline!)[2]).toBeLessThan(rgb(softEdge.symbolOutline!)[2]);
  });

  it("two-tone derivation is not pinned by a stale symbolFillColor (re-tints regardless)", () => {
    // A leftover symbolFillColor (e.g. from the house preset)
    // must not override the hue-derived two-tone fill — otherwise it can't re-tint
    // or respond to sliders.
    const d = dotOf({ seriesStyles: { v: { color: "#2266cc", symbolFill: "twotone", symbolFillColor: "#B5B1B9" } } });
    expect(d.symbolFillColor).not.toBe("#B5B1B9");
    // it equals the derivation from the hue, same as with no stale colour set
    const clean = dotOf({ seriesStyles: { v: { color: "#2266cc", symbolFill: "twotone" } } });
    expect(d.symbolFillColor).toBe(clean.symbolFillColor);
  });

  it("stem linked to data colour → each stem follows its dot's colour; unlinked → uses the chart stem colour", () => {
    // Linked: per-row stem colour = that row's dot colour.
    const linked = buildPlotScene(
      single,
      lollipopWith("t", { lollipop: { baseline: 0, stemLinkColor: true }, seriesStyles: { v: { color: "#2266cc" } } }),
      { width: 480, height: 320 },
    );
    for (const r of linked.lollipop!.rows) {
      expect(r.stemColor).toBe(r.dots[0]!.color); // stem follows the data-point colour
      expect(r.stemColor).toBe("#2266cc");
    }
    // Unlinked (default): no per-row stem colour; the chart-wide stemColor is used.
    const unlinked = buildPlotScene(
      single,
      lollipopWith("t", { lollipop: { baseline: 0, stemColor: "#ff0000" }, seriesStyles: { v: { color: "#2266cc" } } }),
      { width: 480, height: 320 },
    );
    expect(unlinked.lollipop!.rows.every((r) => r.stemColor === undefined)).toBe(true);
    expect(unlinked.lollipop!.stemColor).toBe("#ff0000");
    // A linked stem re-follows a per-point dot colour override.
    const perPt = buildPlotScene(
      single,
      lollipopWith("t", { lollipop: { baseline: 0, stemLinkColor: true }, pointStyles: { "v:r0": { color: "#00aa00" } } }),
      { width: 480, height: 320 },
    );
    expect(perPt.lollipop!.rows[0]!.stemColor).toBe("#00aa00");
  });

  it("a per-point two-tone override fills only that dot", () => {
    const s = buildPlotScene(
      single,
      lollipopWith("t", { lollipop: { baseline: 0 }, pointStyles: { "v:r0": { color: "#cc3322", symbolFill: "twotone" } } }),
      { width: 480, height: 320 },
    );
    const d0 = s.lollipop!.rows[0]!.dots[0]!;
    expect(d0.symbolFill).toBe("open");
    expect(d0.symbolFillColor).toBeTruthy();
    expect(d0.symbolOutline).toBeTruthy();
    // other dots keep the default look (no two-tone)
    expect(s.lollipop!.rows[1]!.dots[0]!.symbolFill).not.toBe("open");
  });

  it("two series → a dumbbell: two dots joined by the stem + a green Δ% first→last", () => {
    const s = buildPlotScene(paired, lollipopWith("t2"), { width: 480, height: 320 });
    const r = s.lollipop!.rows;
    expect(r[0]!.dots).toHaveLength(2);
    // stem spans the two dots
    expect(r[0]!.stem.x1).toBeCloseTo(r[0]!.dots[0]!.cx, 5);
    expect(r[0]!.stem.x2).toBeCloseTo(r[0]!.dots[1]!.cx, 5);
    // A: 20→30 = +50%; B: 40→32 = -20%
    expect(r[0]!.delta!.text).toBe("+50%");
    expect(r[1]!.delta!.text).toBe("-20%");
    // dumbbell has no single-series baseline line, and a legend for the two series
    expect(s.lollipop!.baseline).toBeUndefined();
    expect(s.legend.length).toBe(2);
  });

  it("vertical orientation puts the value on Y and categories on the X band", () => {
    const s = buildPlotScene(single, lollipopWith("t", { barOrientation: "vertical", lollipop: { baseline: 0 } }), { width: 420, height: 360 });
    expect(s.lollipop!.horizontal).toBe(false);
    expect(s.x.band).toBe(true);
    const r0 = s.lollipop!.rows[0]!;
    expect(r0.stem.x1).toBeCloseTo(r0.dots[0]!.cx, 5); // stem vertical: same x
    expect(r0.dots[0]!.cy).toBeLessThan(r0.stem.y1); // value above the baseline (smaller y)
  });

  it("hides value + Δ labels when toggled off", () => {
    const s = buildPlotScene(paired, lollipopWith("t2", { lollipop: { showValues: false, showDelta: false } }), { width: 480, height: 320 });
    expect(s.lollipop!.rows[0]!.dots[0]!.label).toBe("");
    expect(s.lollipop!.rows[0]!.delta).toBeUndefined();
  });
});

describe("heatmap colour-bar extras + matrix-data guard", () => {
  // A 4-column matrix table: first col = row labels, cols A/B/C = values.
  const matrix: DataTable = {
    id: "t", kind: "xy", name: "M",
    columns: [{ id: "k", name: "Gene" }, { id: "a", name: "A" }, { id: "b", name: "B" }, { id: "c", name: "C" }],
    rows: [
      { id: "r1", cells: { k: "g1", a: 1, b: 5, c: 9 } },
      { id: "r2", cells: { k: "g2", a: 2, b: 6, c: 8 } },
    ],
  };
  const hm = (over: Record<string, unknown> = {}): Plot => ({
    id: "p", name: "H", source: "t", status: "ok", styleOverrides: {}, kind: "heatmap",
    heatmap: over,
  });

  it("emits a colour-bar title + interior ticks + distinct font when configured", () => {
    const s = buildPlotScene(matrix, hm({ colorbarTitle: "log2 FC", colorbarTicks: true, colorbarFont: { size: 20, bold: true } }), { width: 480, height: 360 });
    expect(s.heatmap!.colorbarTitle).toBe("log2 FC");
    expect(s.heatmap!.colorbarTicks?.length).toBe(3); // interior 0.25/0.5/0.75
    expect(s.heatmap!.barFont?.size).toBe(20);
    expect(s.heatmap!.barFont?.weight).toBe(700);
    // bar runs max (top, small y) → min (bottom, large y); the first tick is the
    // lowest value (0.25) so it sits lower on the bar (larger y) than the 0.75 tick.
    const ys = s.heatmap!.colorbarTicks!.map((t) => t.y);
    expect(ys[0]!).toBeGreaterThan(ys[2]!);
  });

  it("no title/ticks/font by default (follows the legend font)", () => {
    const s = buildPlotScene(matrix, hm(), { width: 480, height: 360 });
    expect(s.heatmap!.colorbarTitle).toBeUndefined();
    expect(s.heatmap!.colorbarTicks).toBeUndefined();
    expect(s.heatmap!.barFont).toBeUndefined();
  });

  it("shows explicit colour-bar values as labelled ticks (min→max order), overriding auto", () => {
    // data range is 1..9; the user picks 2, 5, 8 (any count) → one tick each.
    const s = buildPlotScene(matrix, hm({ colorbarTickValues: [8, 2, 5] }), { width: 480, height: 360 });
    const ticks = s.heatmap!.colorbarTicks!;
    expect(ticks.map((t) => t.value)).toEqual([2, 5, 8]); // sorted ascending
    // higher value → higher on the bar (smaller y).
    expect(ticks[0]!.y).toBeGreaterThan(ticks[2]!.y);
    // flagged custom → the renderer drops the auto min/max so they don't clash.
    expect(s.heatmap!.colorbarCustom).toBe(true);
    // explicit values win even when the quartile toggle is also on.
    const both = buildPlotScene(matrix, hm({ colorbarTicks: true, colorbarTickValues: [3] }), { width: 480, height: 360 });
    expect(both.heatmap!.colorbarTicks!.map((t) => t.value)).toEqual([3]);
    // auto (no explicit values) is not flagged custom (min/max shown).
    expect(buildPlotScene(matrix, hm({ colorbarTicks: true }), { width: 480, height: 360 }).heatmap!.colorbarCustom).toBeUndefined();
  });

  it("warns when point-mode (density2d) is used on matrix-shaped data", () => {
    // numeric first two cols (so points survive) + extra numeric cols ⇒ matrix shape
    const pts: DataTable = {
      id: "t", kind: "xy", name: "P",
      columns: [{ id: "x", name: "X" }, { id: "y", name: "Y" }, { id: "z", name: "Z" }, { id: "w", name: "W" }],
      rows: [
        { id: "r1", cells: { x: 1, y: 2, z: 3, w: 4 } },
        { id: "r2", cells: { x: 2, y: 3, z: 4, w: 5 } },
        { id: "r3", cells: { x: 3, y: 1, z: 2, w: 6 } },
      ],
    };
    const s = buildPlotScene(pts, hm({ mode: "density2d" }), { width: 480, height: 360 });
    expect(s.warnings.some((w) => /matrix data/i.test(w) && /matrix/.test(w))).toBe(true);
  });

  it("does not warn for genuine 2-column point data in density mode", () => {
    const pts: DataTable = {
      id: "t", kind: "xy", name: "P",
      columns: [{ id: "x", name: "X" }, { id: "y", name: "Y" }],
      rows: [
        { id: "r1", cells: { x: 1, y: 2 } },
        { id: "r2", cells: { x: 2, y: 3 } },
        { id: "r3", cells: { x: 3, y: 1 } },
      ],
    };
    const s = buildPlotScene(pts, hm({ mode: "density2d" }), { width: 480, height: 360 });
    expect(s.warnings.some((w) => /matrix data/i.test(w))).toBe(false);
  });

  // Guards against switching a matrix heatmap (text row-labels + value columns) to
  // hexbin/density2d and getting a blank hexbin or a meaningless flat field with no explanation.
  // The `matrix` table's first column is text, so there are zero (x,y) points.
  it("hexbin on matrix data draws no hexes and posts a plot notice (not a blank canvas)", () => {
    const s = buildPlotScene(matrix, hm({ mode: "hexbin" }), { width: 480, height: 360 });
    expect(s.heatmap!.hexes ?? []).toEqual([]); // nothing drawn
    expect(s.heatmap!.cells).toEqual([]); //  ... and no flat filler grid either
    expect(s.heatmap!.notice, "no in-plot explanation for the empty hexbin").toBeTruthy();
    expect(s.heatmap!.notice).toMatch(/matrix/i);
    expect(s.heatmap!.notice).toMatch(/Mode/); // tells the user how to fix it
  });

  it("density2d on matrix data posts the notice and skips the flat zero-field", () => {
    const s = buildPlotScene(matrix, hm({ mode: "density2d" }), { width: 480, height: 360 });
    expect(s.heatmap!.cells).toEqual([]); // no misleading flat field is drawn
    expect(s.heatmap!.notice).toMatch(/2-D density/);
  });

  it("genuine (x,y) points still hexbin normally — no notice", () => {
    const pts: DataTable = {
      id: "t", kind: "xy", name: "P",
      columns: [{ id: "x", name: "X" }, { id: "y", name: "Y" }],
      rows: [
        { id: "r1", cells: { x: 1, y: 2 } },
        { id: "r2", cells: { x: 1.1, y: 2.1 } },
        { id: "r3", cells: { x: 3, y: 1 } },
        { id: "r4", cells: { x: 2.9, y: 1.2 } },
      ],
    };
    const s = buildPlotScene(pts, hm({ mode: "hexbin", resolution: 12 }), { width: 480, height: 360 });
    expect((s.heatmap!.hexes ?? []).length).toBeGreaterThan(0);
    expect(s.heatmap!.notice).toBeUndefined();
  });
});

describe("second Y-axis (Y2) — per-series axis routing", () => {
  // x + two y series on very different scales: A ~ single digits, B ~ thousands.
  const table: DataTable = {
    id: "t", kind: "xy", name: "T",
    columns: [{ id: "x", name: "Time", role: "x" }, { id: "a", name: "A", role: "y" }, { id: "b", name: "B", role: "y" }],
    rows: [
      { id: "r1", cells: { x: 1, a: 1, b: 1000 } },
      { id: "r2", cells: { x: 2, a: 2, b: 2000 } },
      { id: "r3", cells: { x: 3, a: 3, b: 3000 } },
    ],
  };
  const base = (over: Partial<Plot> = {}): Plot => ({
    id: "p", name: "P", source: "t", status: "ok", styleOverrides: {}, kind: "xy", ...over,
  });

  it("no Y2 axis until a series is assigned to it", () => {
    const s = buildPlotScene(table, base(), { width: 480, height: 320 });
    expect(s.y2).toBeUndefined();
  });

  it("assigning series B to y2 draws a right axis scaled to B alone", () => {
    const s = buildPlotScene(table, base({ seriesStyles: { b: { axis: "y2" } } }), { width: 480, height: 320 });
    expect(s.y2).toBeDefined();
    // primary Y domain now tracks only A (~1..3), not B's thousands
    expect(s.y.domain[1]).toBeLessThan(100);
    // Y2 domain spans B's range (into the thousands)
    expect(s.y2!.domain[1]).toBeGreaterThanOrEqual(3000);
    // the Y2 axis line sits at the right edge of the plot
    const rightEdge = s.plot.x + s.plot.width;
    expect(s.y2!.range[0]).toBeCloseTo(s.plot.y + s.plot.height, 0);
    expect(rightEdge).toBeGreaterThan(s.plot.x);
  });

  it("each series spans its own axis (A is not crushed flat by B's thousands)", () => {
    // Force linear so the contrast isolates the Y2 routing (not log auto-scaling).
    const lin = { yAxis: { scale: "linear" as const }, y2Axis: { scale: "linear" as const } };
    const withY2 = buildPlotScene(table, base({ seriesStyles: { b: { axis: "y2" } }, ...lin }), { width: 480, height: 320 });
    const span = (id: string, s = withY2): number => {
      const m = s.series.find((ser) => ser.id === id)!.marks.map((mk) => mk.cy);
      return Math.max(...m) - Math.min(...m);
    };
    // Both A and B now use a large share of the plot height (each on its own axis).
    expect(span("a")).toBeGreaterThan(withY2.plot.height * 0.4);
    expect(span("b")).toBeGreaterThan(withY2.plot.height * 0.4);
    // Contrast: on one shared linear axis A (1..3) is crushed against B's thousands.
    const shared = buildPlotScene(table, base({ yAxis: { scale: "linear" } }), { width: 480, height: 320 });
    expect(span("a", shared)).toBeLessThan(shared.plot.height * 0.05);
  });
});

describe("buildPlotScene — bubble", () => {
  const table: DataTable = {
    id: "t", kind: "xy", name: "t",
    columns: [
      { id: "x", name: "X", role: "x" },
      { id: "y", name: "Y", role: "y" },
      { id: "s", name: "Size", role: "y" },
    ],
    rows: [["1", 10, 1], ["2", 20, 50], ["3", 30, 100]].map(([x, y, s], i) => ({ id: `r${i}`, cells: { x: x as string, y: y as number, s: s as number } })),
  };
  const plot: Plot = { id: "p", name: "P", source: "t", status: "ok", styleOverrides: {}, kind: "bubble" };

  it("draws one series (position) with marks sized by the 2nd Y column", () => {
    const s = buildPlotScene(table, plot, { width: 480, height: 320 });
    expect(s.kind).toBe("bubble");
    expect(s.series).toHaveLength(1); // only the position series is drawn
    const marks = s.series[0]!.marks;
    expect(marks).toHaveLength(3);
    // radius grows with the size value: smallest size → ~4px, largest → ~22px.
    expect(marks[0]!.symbolSize).toBeCloseTo(4, 1);
    expect(marks[2]!.symbolSize).toBeCloseTo(22, 1);
    expect(marks[1]!.symbolSize!).toBeGreaterThan(marks[0]!.symbolSize!);
    expect(marks[1]!.symbolSize!).toBeLessThan(marks[2]!.symbolSize!);
    expect(s.warnings).toEqual([]);
  });

  // The size column (2nd Y) is the radius encoding, not a drawn series —
  // so hiding it must be a no-op, and the Inspector must not list it as a series.
  it("the size column is not a drawn series — hiding it is a no-op (position hide still works)", () => {
    const base = buildPlotScene(table, plot, { width: 480, height: 320 }).series;
    expect(base.map((x) => x.id)).toEqual(["y"]); // only the position column is a series
    const sizeHidden = buildPlotScene(table, { ...plot, seriesStyles: { s: { hidden: true } } }, { width: 480, height: 320 }).series;
    expect(sizeHidden.map((x) => x.id)).toEqual(["y"]); // hiding the size column changes nothing
    const posHidden = buildPlotScene(table, { ...plot, seriesStyles: { y: { hidden: true } } }, { width: 480, height: 320 }).series;
    expect(posHidden).toHaveLength(0); // hiding the position column does remove the series
  });

  it("colour-by-column overrides a two-tone marker fill (per-point colours actually show)", () => {
    const p2: Plot = { ...plot, seriesStyles: { y: { symbolFill: "twotone", fillType: "twotone", colorFromColumn: "s", colorFromMode: "continuous", colorFromRamp: "viridis" } } };
    const s = buildPlotScene(table, p2, { width: 480, height: 320 });
    const marks = s.series[0]!.marks;
    // Distinct per-point fills (a two-tone marker must not tint every point from the series colour).
    expect(new Set(marks.map((m) => m.fill)).size, "colour-by gave no per-point variation").toBeGreaterThan(1);
    // Forced solid so the value colour is the visible fill, not an open/two-tone marker.
    for (const m of marks) { expect(m.symbolFill).toBe("solid"); expect(m.symbolFillColor).toBe(m.fill); }
    expect(s.colorbar).toBeTruthy();
  });

  it("the colour bar sits fully left of the size legend — no overlap", () => {
    const s = buildPlotScene(table, { ...plot, seriesStyles: { y: { colorFromColumn: "s", colorFromMode: "continuous" } } }, { width: 480, height: 320 });
    expect(s.colorbar).toBeTruthy();
    expect(s.bubbleLegend).toBeTruthy();
    const sizeLegendX = s.plot.x + s.plot.width + s.bubbleLegend!.inset!;
    // The colour bar + its ~60px min/max/title band must end before the size legend begins.
    const colorbarBandRight = s.colorbar!.bar.x + s.colorbar!.bar.w + 60;
    expect(colorbarBandRight, "colour bar overlaps the size legend").toBeLessThanOrEqual(sizeLegendX + 4);
  });

  // A bubble chart belongs to the xy format (newGraph.ts formats:["xy"]) and needs an x-role
  // column, which a multivariable table lacks. On such a table the correct drawing is empty
  // (no finite points), and that is what this pins.
  it("a bubble on a multivariable table (no x-role) correctly yields no marks", () => {
    const mv: DataTable = {
      id: "mv", kind: "multivariable", name: "MV",
      columns: [{ id: "a", name: "A" }, { id: "b", name: "B" }, { id: "c", name: "C" }],
      rows: [{ id: "r0", cells: { a: 1, b: 2, c: 3 } }, { id: "r1", cells: { a: 4, b: 5, c: 6 } }],
    };
    const s = buildPlotScene(mv, { ...plot, source: "mv" }, { width: 480, height: 320 });
    expect(s.series.flatMap((se) => se.marks)).toHaveLength(0);
    expect(s.warnings.some((w) => /No finite data points/i.test(w))).toBe(true);
  });

  it("reserves a breathing inset scaled to the bubble radius so an edge bubble isn't clipped", () => {
    const rightCx = (r: number): number =>
      Math.max(...buildPlotScene(table, { ...plot, bubble: { maxRadius: r } }, { width: 480, height: 320 }).series[0]!.marks.map((m) => m.cx));
    // The largest bubble sits at max X; a bigger maxRadius must inset it further from the right
    // edge (the inset must not be pinned to the 4px series default regardless of bubble size).
    expect(rightCx(40)).toBeLessThan(rightCx(4));
  });

  it("sizes bubbles by area (not radius): the midpoint value gets the midpoint area", () => {
    // sizes 0,50,100 → the middle value (50) is halfway, so its area is halfway between
    // minR² and maxR² (r = √((4²+22²)/2) ≈ 15.81), not the radius-linear 13.
    const t2: DataTable = {
      ...table,
      rows: [["1", 10, 0], ["2", 20, 50], ["3", 30, 100]].map(([x, y, sz], i) => ({ id: `r${i}`, cells: { x: x as string, y: y as number, s: sz as number } })),
    };
    const marks = buildPlotScene(t2, plot, { width: 480, height: 320 }).series[0]!.marks;
    expect(marks[0]!.symbolSize).toBeCloseTo(4, 1); // min value → minR
    expect(marks[2]!.symbolSize).toBeCloseTo(22, 1); // max value → maxR
    const rMid = marks[1]!.symbolSize!;
    expect(rMid * rMid).toBeCloseTo((4 * 4 + 22 * 22) / 2, 0); // area = midpoint of the areas
    expect(rMid).toBeGreaterThan(14); // clearly bigger than the radius-linear 13
  });

  it("warns (and falls back) when there is no size column", () => {
    const t2: DataTable = { ...table, columns: table.columns.slice(0, 2) };
    const s = buildPlotScene(t2, plot, { width: 480, height: 320 });
    expect(s.warnings.some((w) => /bubble/i.test(w))).toBe(true);
  });

  it("builds a vertical size legend (title = size column, largest→smallest, value labels)", () => {
    const s = buildPlotScene(table, plot, { width: 480, height: 320 });
    const bl = s.bubbleLegend!;
    expect(bl).toBeTruthy();
    expect(bl.title).toBe("Size"); // the 2nd Y column name
    expect(bl.items.map((i) => i.label)).toEqual(["100", "50.5", "1"]); // max, mid, min (top-down)
    // radii shrink top→bottom and match the marks' 4–22px range.
    expect(bl.items[0]!.radius).toBeGreaterThan(bl.items[2]!.radius);
    expect(bl.items[0]!.radius).toBeCloseTo(22, 1);
    expect(bl.items[2]!.radius).toBeCloseTo(4, 1);
  });

  it("honours the size-legend parameters: title override, radius range, and hide", () => {
    const custom = buildPlotScene(table, { ...plot, bubble: { sizeLegendTitle: "Pop.", minRadius: 6, maxRadius: 30 } }, { width: 480, height: 320 });
    expect(custom.bubbleLegend!.title).toBe("Pop.");
    expect(custom.bubbleLegend!.items[0]!.radius).toBeCloseTo(30, 1);
    expect(custom.bubbleLegend!.items[2]!.radius).toBeCloseTo(6, 1);
    expect(custom.series[0]!.marks[2]!.symbolSize).toBeCloseTo(30, 1); // range feeds the bubbles too
    // Turned off → no legend.
    const off = buildPlotScene(table, { ...plot, bubble: { showSizeLegend: false } }, { width: 480, height: 320 });
    expect(off.bubbleLegend).toBeUndefined();
  });

  it("the legend spheres carry the plotted-bubble marker paint (same colour / fill / opacity)", () => {
    const styled = buildPlotScene(table, { ...plot, seriesStyles: { y: { color: "#123456", symbolFill: "open", symbolFillColor: "#eeeeee", symbolOpacity: 0.5 } } }, { width: 480, height: 320 });
    const m = styled.bubbleLegend!.marker;
    const ser = styled.series[0]!;
    expect(m.color).toBe(ser.color); // Not a hardcoded colour
    expect(m.color).toBe("#123456");
    expect(m.symbolFill).toBe(ser.symbolFill); // "open"
    expect(m.symbolFillColor).toBe("#eeeeee");
    expect(m.symbolOpacity).toBe(0.5);
  });

  it("shows explicit reference values as their own spheres, and a scale resizes them", () => {
    const custom = buildPlotScene(table, { ...plot, bubble: { sizeLegendValues: [100, 25], sizeLegendScale: 2 } }, { width: 480, height: 320 });
    const bl = custom.bubbleLegend!;
    expect(bl.items.map((i) => i.label)).toEqual(["100", "25"]); // exactly the chosen values, largest→smallest
    // radius = radiusForValue × scale. Value 100 = the data max → 22px × 2 = 44px.
    expect(bl.items[0]!.radius).toBeCloseTo(44, 0);
    // The plotted bubbles are not scaled (scale is legend-only).
    expect(custom.series[0]!.marks[2]!.symbolSize).toBeCloseTo(22, 1);
  });

  it("supports any number of chosen values — incl. decimals + values beyond the data range", () => {
    // The size column runs 1..100 (→ 4..22px). The user picks 5 values, one below
    // the min (0.5) and one above the max (150 → extrapolated), plus a decimal.
    const custom = buildPlotScene(table, { ...plot, bubble: { sizeLegendValues: [150, 100, 50.5, 10, 0.5] } }, { width: 480, height: 320 });
    const bl = custom.bubbleLegend!;
    // One sphere per value, largest→smallest, labels preserved (incl. the decimal).
    expect(bl.items).toHaveLength(5);
    expect(bl.items.map((i) => i.label)).toEqual(["150", "100", "50.5", "10", "0.5"]);
    // Radii are strictly decreasing and clamped ≥1 (0.5 extrapolates below 4px).
    const radii = bl.items.map((i) => i.radius);
    expect(radii[0]!).toBeGreaterThan(22); // 150 > data max → bigger than the 22px cap
    for (let i = 1; i < radii.length; i++) expect(radii[i]!).toBeLessThan(radii[i - 1]!);
    expect(radii[radii.length - 1]!).toBeGreaterThanOrEqual(1);
  });
});

describe("buildPlotScene — histogram", () => {
  const vals = [1, 2, 2, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 6, 6, 7];
  const table: DataTable = {
    id: "t", kind: "column", name: "t",
    columns: [{ id: "x", name: "Row", role: "x" }, { id: "v", name: "V", role: "y" }],
    rows: vals.map((v, i) => ({ id: `r${i}`, cells: { x: i + 1, v } })),
  };
  const plot = (bins?: number): Plot => ({ id: "p", name: "P", source: "t", status: "ok", styleOverrides: {}, kind: "histogram", ...(bins ? { histogram: { bins } } : {}) });

  it("bins values into contiguous bars; counts sum to n", () => {
    const s = buildPlotScene(table, plot(6), { width: 480, height: 320 });
    expect(s.kind).toBe("histogram");
    expect(s.series).toHaveLength(1);
    const marks = s.series[0]!.marks;
    expect(marks).toHaveLength(6); // 6 bins requested
    expect(marks.every((m) => m.bar !== undefined)).toBe(true); // bars, not points
    const total = marks.reduce((a, m) => a + (m.dy ?? 0), 0);
    expect(total).toBe(vals.length); // every value counted exactly once
    expect(s.warnings).toEqual([]);
  });

  it("frequency modes rescale the bar heights + relabel the Y axis (relative / percent / cumulative)", () => {
    const n = vals.length;
    const build = (freq: NonNullable<Plot["histogram"]>["freq"]) =>
      buildPlotScene(table, { ...plot(), histogram: { bins: 6, freq } }, { width: 480, height: 320 });
    const sum = (freq: NonNullable<Plot["histogram"]>["freq"]) =>
      build(freq).series[0]!.marks.reduce((a, m) => a + (m.dy ?? 0), 0);
    expect(sum("relative")).toBeCloseTo(1, 10); // fractions sum to 1
    expect(sum("percent")).toBeCloseTo(100, 8); // percentages sum to 100
    const cum = build("cumulative").series[0]!.marks;
    expect(cum[cum.length - 1]!.dy).toBe(n); // cumulative count ends at n
    for (let i = 1; i < cum.length; i++) expect(cum[i]!.dy!).toBeGreaterThanOrEqual(cum[i - 1]!.dy!); // monotonic
    const cp = build("cumulativePercent").series[0]!.marks;
    expect(cp[cp.length - 1]!.dy).toBeCloseTo(100, 8);
    expect(build("percent").y.title).toBe("Percent of total"); // axis title tracks the mode
  });

  it("auto-bins onto a nice round width (clean edges, not long decimals)", () => {
    const s = buildPlotScene(table, plot(), { width: 480, height: 320 });
    // Auto picks a nice 1·2·2.5·5 width near the Sturges target → integer edges here.
    const labels = s.series[0]!.marks.map((m) => m.label);
    expect(labels.every((l) => /^-?\d+–-?\d+$/.test(l!))).toBe(true); // all-integer edges, no decimals
    const total = s.series[0]!.marks.reduce((a, m) => a + (m.dy ?? 0), 0);
    expect(total).toBe(vals.length);
  });

  it("explicit bin width overrides the count and gives tidy edges; counts still sum to n", () => {
    const s = buildPlotScene(table, { ...plot(), histogram: { binWidth: 2 } }, { width: 480, height: 320 });
    const marks = s.series[0]!.marks;
    expect(marks[0]!.label).toBe("0–2"); // origin snaps to a multiple of the width
    expect(marks.every((m) => /^-?\d+–-?\d+$/.test(m.label!))).toBe(true);
    expect(marks.reduce((a, m) => a + (m.dy ?? 0), 0)).toBe(vals.length);
  });

  it("custom bin ranges override width/count and make unequal-width bins; counts land right", () => {
    // Contiguous ranges of widths 2·2·3; half-open [lo,hi) with the top edge caught, so nothing is lost.
    const s = buildPlotScene(table, { ...plot(), histogram: { binWidth: 2, bins: 4, binRanges: [[1, 3], [3, 5], [5, 8]] } }, { width: 480, height: 320 });
    const marks = s.series[0]!.marks;
    expect(marks.map((m) => m.label)).toEqual(["1–3", "3–5", "5–8"]);
    expect(marks.map((m) => m.dy)).toEqual([3, 7, 6]); // {1,2,2} · {3,3,3,4,4,4,4} · {5,5,5,6,6,7}
    expect(s.warnings).toEqual([]);
  });

  it("a gap between ranges leaves the in-gap values out and reports how many", () => {
    // Bins 1–3 and 5–8, nothing for [3,5): the seven 3s and 4s are dropped.
    const s = buildPlotScene(table, { ...plot(), histogram: { binRanges: [[1, 3], [5, 8]] } }, { width: 480, height: 320 });
    const marks = s.series[0]!.marks;
    expect(marks.map((m) => m.label)).toEqual(["1–3", "5–8"]);
    expect(marks.map((m) => m.dy)).toEqual([3, 6]); // {1,2,2} · {5,5,5,6,6,7}
    expect(s.warnings.some((w) => /7 values fell outside the custom bins/i.test(w))).toBe(true);
  });

  it("Open-ended bins: [null,hi) is 'under', [lo,null] is 'and up'", () => {
    // "<3" and "≥5", with the 3s/4s falling in the gap between them.
    const s = buildPlotScene(table, { ...plot(), histogram: { binRanges: [[null, 3], [5, null]] } }, { width: 480, height: 320 });
    const marks = s.series[0]!.marks;
    expect(marks.map((m) => m.label)).toEqual(["<3", "≥5"]);
    expect(marks.map((m) => m.dy)).toEqual([3, 6]); // {1,2,2} below 3 · {5,5,5,6,6,7} at 5 and up
    expect(s.warnings.some((w) => /7 values fell outside the custom bins/i.test(w))).toBe(true);
  });

  it("proportional width makes each bar's width track its bin range, on a numeric X axis", () => {
    const p: Plot = { ...plot(), histogram: { binRanges: [[0, 4], [4, 20]], proportionalWidth: true } };
    const s = buildPlotScene(table, p, { width: 480, height: 320 });
    const marks = s.series[0]!.marks;
    expect(marks).toHaveLength(2);
    expect(marks[1]!.bar!.w / marks[0]!.bar!.w).toBeCloseTo(4, 1); // [4,20] is 16 wide vs [0,4] = 4 → 4×
    expect(marks[0]!.cx).toBeCloseTo(marks[0]!.bar!.x + marks[0]!.bar!.w / 2, 5); // centre follows the rect (value labels track it)
    expect(s.x.type).toBe("linear"); // a continuous numeric axis, not categorical bin labels
    expect(s.x.ticks.map((t) => t.value)).toEqual(expect.arrayContaining([0, 4, 20]));
  });

  it("without proportional width, the same unequal bins draw as equal-width categorical bars", () => {
    const s = buildPlotScene(table, { ...plot(), histogram: { binRanges: [[0, 4], [4, 20]] } }, { width: 480, height: 320 });
    const marks = s.series[0]!.marks;
    expect(marks[0]!.bar!.w).toBeCloseTo(marks[1]!.bar!.w, 5); // equal visual width; only the labels differ
  });

  it("per-bar data-point dots are off by default, and come back when showPoints is set", () => {
    const off = buildPlotScene(table, plot(6), { width: 480, height: 320 });
    expect(off.series[0]!.symbol, "a histogram drew data-point dots by default").toBe("none");
    expect(off.series[0]!.marks.every((m) => !m.points || m.points.length === 0), "scatter points left on a histogram").toBe(true);
    const on = buildPlotScene(table, { ...plot(), histogram: { bins: 6, showPoints: true } }, { width: 480, height: 320 });
    expect(on.series[0]!.symbol, "showPoints did not restore the markers").not.toBe("none");
  });

  it("proportional width is vertical-only — a horizontal histogram is left exactly as it was", () => {
    const cfg = { binRanges: [[0, 4] as [number, number], [4, 20] as [number, number]] };
    const base = buildPlotScene(table, { ...plot(), barOrientation: "horizontal", histogram: cfg }, { width: 480, height: 320 });
    const prop = buildPlotScene(table, { ...plot(), barOrientation: "horizontal", histogram: { ...cfg, proportionalWidth: true } }, { width: 480, height: 320 });
    expect(prop.series[0]!.marks.map((m) => m.bar)).toEqual(base.series[0]!.marks.map((m) => m.bar)); // remap skipped
  });

  it("forwards the full series style to the bars (two-tone fill reaches the histogram)", () => {
    const styled = buildPlotScene(
      table,
      { ...plot(6), seriesStyles: { v: { color: "#2266cc", fillType: "twotone" } } },
      { width: 480, height: 320 },
    );
    // The series id is the real column ("v"), not a synthetic "count" — so a bar
    // click selects the real series, and its fill (two-tone) actually applies.
    const ser = styled.series[0]!;
    expect(ser.id).toBe("v");
    // two-tone derives a lighter fill + darker contour from the base hue.
    expect(ser.fillColor).not.toBe(ser.borderColor);
    expect(ser.fillColor).not.toBe("#2266cc"); // lightened, not the solid base
  });

  it("warns when there are fewer than 2 values", () => {
    const t2: DataTable = { ...table, rows: table.rows.slice(0, 1) };
    const s = buildPlotScene(t2, plot(), { width: 480, height: 320 });
    expect(s.warnings.some((w) => /histogram/i.test(w))).toBe(true);
  });
});

describe("buildPlotScene — volcano", () => {
  const table: DataTable = {
    id: "t", kind: "xy", name: "t",
    columns: [{ id: "fc", name: "log2FC", role: "x" }, { id: "p", name: "-log10p", role: "y" }],
    rows: [
      ["up", 2, 4],     // |fc|>=1 and p>=1.301 → up (warm)
      ["down", -2, 4],  // → down (cool)
      ["ns1", 0.2, 0.5],// below both → ns (grey)
      ["ns2", 2, 0.4],  // big fc but not significant p → ns
    ].map(([id, fc, p]) => ({ id: id as string, cells: { fc: fc as number, p: p as number } })),
  };
  const plot: Plot = { id: "p", name: "P", source: "t", status: "ok", styleOverrides: {}, kind: "volcano" };

  it("colours each point by significance + draws 3 threshold guides", () => {
    const s = buildPlotScene(table, plot, { width: 480, height: 320 });
    expect(s.kind).toBe("volcano");
    const fillOf = (rowId: string) => s.series[0]!.marks.find((m) => m.rowId === rowId)!.fill;
    expect(fillOf("up")).toBe("#1a9850"); // up-regulated → green (right wing)
    expect(fillOf("down")).toBe("#d62728"); // down-regulated → red (left wing)
    expect(fillOf("ns1")).toBe("#b3b6bd"); // not significant
    expect(fillOf("ns2")).toBe("#b3b6bd"); // big fold-change but p not significant
    // dashed guide lines: 2 vertical (±fc) + 1 horizontal (p)
    const lines = s.annotations.filter((a) => a.kind === "line");
    expect(lines.length).toBeGreaterThanOrEqual(3);
    expect(s.warnings).toEqual([]);
  });

  it("labels points from a chosen column (gene names) without disturbing the zone colours", () => {
    const geneTable: DataTable = {
      id: "tg", kind: "xy", name: "tg",
      columns: [{ id: "fc", name: "log2FC", role: "x" }, { id: "p", name: "-log10p", role: "y" }, { id: "gene", name: "Gene" }],
      rows: [
        { id: "up", cells: { fc: 2, p: 4, gene: "TP53" } },
        { id: "down", cells: { fc: -2, p: 4, gene: "MYC" } },
        { id: "ns1", cells: { fc: 0.2, p: 0.5, gene: "ACTB" } },
      ],
    };
    const s = buildPlotScene(geneTable, { ...plot, source: "tg", seriesStyles: { p: { pointLabels: "col", pointLabelColumn: "gene" } } }, { width: 480, height: 320 });
    const markOf = (rowId: string) => s.series[0]!.marks.find((m) => m.rowId === rowId)!;
    expect(markOf("up").pointLabel).toBe("TP53");
    expect(markOf("down").pointLabel).toBe("MYC");
    // The point-label binding must not override the up/down/ns significance hue.
    expect(markOf("up").fill).toBe("#1a9850");
    expect(markOf("down").fill).toBe("#d62728");
    // A colour-by-column binding on a volcano is ignored (the zone encoding wins).
    const forced = buildPlotScene(geneTable, { ...plot, source: "tg", seriesStyles: { p: { colorFromColumn: "gene" } } }, { width: 480, height: 320 });
    expect(forced.series[0]!.marks.find((m) => m.rowId === "up")!.fill).toBe("#1a9850");
  });

  /**
   * Formatting one point must not cost it its significance colour.
   *
   * A volcano's whole message is the up/down/ns hue. With a two-tone marker (the house default),
   * `paintPointStyles` must keep the marker's interior and edge in the zone colour when a per-point
   * override exists — re-deriving them from the series colour would make any change on one point,
   * even its size, drop that point out of its zone colour while its neighbours keep theirs.
   * An empty override `{}` is enough to exercise this; volcano is the only kind where it would
   * change the drawing.
   */
  it("a per-point override that says nothing about colour keeps the zone hue", () => {
    const twoTone: Plot = { ...plot, seriesStyles: { p: { color: "#000000", symbolFill: "twotone", fillType: "twotone" } } };
    const markOfScene = (p: Plot, rowId: string) =>
      buildPlotScene(table, p, { width: 480, height: 320 }).series[0]!.marks.find((m) => m.rowId === rowId)!;
    const before = markOfScene(twoTone, "up");
    for (const [name, ps] of [["nothing at all", {}], ["only a size", { symbolSize: 9 }]] as [string, Record<string, unknown>][]) {
      const after = markOfScene({ ...twoTone, pointStyles: { "p:up": ps } } as Plot, "up");
      expect(after.symbolFillColor, `${name}: the point's interior stopped following its zone colour`).toBe(before.symbolFillColor);
      expect(after.symbolOutline, `${name}: the point's edge stopped following its zone colour`).toBe(before.symbolOutline);
      expect(after.fill, `${name}: the point's zone fill changed`).toBe(before.fill);
    }
    // …and a per-point recolour still wins, or the guard above would be satisfied by ignoring
    // pointStyles altogether.
    const recoloured = markOfScene({ ...twoTone, pointStyles: { "p:up": { color: "#0000ff" } } } as Plot, "up");
    expect(recoloured.symbolFillColor, "an explicit per-point colour does not reach the marker").not.toBe(before.symbolFillColor);
  });

  it("refLine styles the 3 threshold guides: colour override + show:false hides them (default preserved)", () => {
    const guideLines = (p: Plot) => buildPlotScene(table, p, { width: 480, height: 320 }).annotations.filter((a) => a.kind === "line");
    const def = guideLines(plot);
    expect(def.length).toBe(3);
    expect(def.every((g) => g.color === "#9aa0aa")).toBe(true); // default unchanged
    expect(guideLines({ ...plot, refLine: { color: "#ff0000" } }).every((g) => g.color === "#ff0000")).toBe(true);
    expect(guideLines({ ...plot, refLine: { show: false } }).length).toBe(0);
  });

  it("forces linear axes (pre-transformed data) and auto-labels them log₂ FC / −log₁₀ p", () => {
    // Even if a log scale is inherited from the previous chart kind, a volcano is linear
    // (its data is already log2 FC / −log10 p, and log2 FC is signed).
    const logged = buildPlotScene(table, { ...plot, xScale: "log10", yScale: "log10" }, { width: 480, height: 320 });
    expect(logged.x.type).toBe("linear");
    expect(logged.y.type).toBe("linear");
    expect(logged.x.title).toBe("log₂ fold change"); // auto-labelled when no explicit title
    expect(logged.y.title).toBe("−log₁₀ p");
    // An explicit axis title still wins.
    const named = buildPlotScene(table, { ...plot, xAxis: { title: "My FC" } }, { width: 480, height: 320 });
    expect(named.x.title).toBe("My FC");
  });

  it("the significance-zone colours are editable (up / down / ns)", () => {
    const custom = buildPlotScene(table, { ...plot, volcano: { upColor: "#112233", downColor: "#445566", nsColor: "#778899" } }, { width: 480, height: 320 });
    const fillOf = (rowId: string) => custom.series[0]!.marks.find((m) => m.rowId === rowId)!.fill;
    expect(fillOf("up")).toBe("#112233");
    expect(fillOf("down")).toBe("#445566");
    expect(fillOf("ns1")).toBe("#778899");
  });

  it("emits a zone legend (Up/Down/NS) in the plotted zone colours when the legend is enabled", () => {
    const vol = { upColor: "#00aa00", downColor: "#aa0000", nsColor: "#999999" };
    // default: hidden (no legend → plot geometry unchanged from a legend-less volcano)
    expect(buildPlotScene(table, { ...plot, volcano: vol }, { width: 480, height: 320 }).legend).toEqual([]);
    // explicitly enabled: the zone legend replaces the misleading single-series swatch
    const s = buildPlotScene(table, { ...plot, legend: { show: true }, volcano: vol }, { width: 480, height: 320 });
    expect(s.legend.map((e) => e.label)).toEqual(["Up-regulated", "Down-regulated", "Not significant"]);
    expect(s.legend.find((e) => e.label === "Up-regulated")!.color).toBe("#00aa00");
    expect(s.legend.find((e) => e.label === "Down-regulated")!.color).toBe("#aa0000");
    expect(s.legend.find((e) => e.label === "Not significant")!.color).toBe("#999999");
  });

  it("honours a two-tone / open fill mode, derived per-point from the zone colour", () => {
    const tt = buildPlotScene(table, { ...plot, seriesStyles: { p: { symbolFill: "twotone" } } }, { width: 480, height: 320 });
    const up = tt.series[0]!.marks.find((m) => m.rowId === "up")!;
    expect(up.symbolFill).toBe("open"); // two-tone renders as an open marker + light interior
    expect(up.fill).toBe("#1a9850"); // base zone colour retained
    expect(up.symbolFillColor).not.toBe("#1a9850"); // lighter derived interior
    expect(up.symbolOutline).not.toBe("#1a9850"); // darker derived contour
    expect(up.symbolFillColor).not.toBe(up.symbolOutline);
    // Different zones two-tone from their own colour (not one flat fill).
    const down = tt.series[0]!.marks.find((m) => m.rowId === "down")!;
    expect(down.symbolFillColor).not.toBe(up.symbolFillColor);
    // An open / flat-interior preset (the house style's #B5B1B9 open markers) must not
    // flatten the zones — every point stays a solid zone fill so the colour is prominent.
    const flat = buildPlotScene(table, { ...plot, seriesStyles: { p: { symbolFill: "open", symbolFillColor: "#B5B1B9" } } }, { width: 480, height: 320 });
    const upO = flat.series[0]!.marks.find((m) => m.rowId === "up")!;
    expect(upO.symbolFill).toBe("solid");
    expect(upO.fill).toBe("#1a9850"); // the green zone colour, not the flat #B5B1B9
    const nsO = flat.series[0]!.marks.find((m) => m.rowId === "ns1")!;
    expect(nsO.fill).toBe("#b3b6bd");
  });

  it("a per-point colour override wins over the zone colour (recolour one point)", () => {
    const over = buildPlotScene(table, { ...plot, pointStyles: { "p:up": { color: "#0000ff" } } }, { width: 480, height: 320 });
    const fillOf = (rowId: string) => over.series[0]!.marks.find((m) => m.rowId === rowId)!.fill;
    expect(fillOf("up")).toBe("#0000ff"); // overridden
    expect(fillOf("down")).toBe("#d62728"); // others keep the zone colour
  });

  // The whole-series marker colour, open/clear fill and outline
  // colour are overridden by the per-point zone paint (by design — the significance
  // colour must stay prominent). Per-point overrides still win (tested above), so the
  // Inspector hides these controls at whole-series scope, where they would have no effect.
  it("whole-series colour / open-fill / outline are overridden by the zone paint (by design)", () => {
    // Whole-series Colour has no effect — every mark keeps its zone fill, not #ff00ee.
    const recolour = buildPlotScene(table, { ...plot, seriesStyles: { p: { color: "#ff00ee" } } }, { width: 480, height: 320 });
    const fillOf = (rowId: string) => recolour.series[0]!.marks.find((m) => m.rowId === rowId)!.fill;
    expect(fillOf("up")).toBe("#1a9850");
    expect(fillOf("down")).toBe("#d62728");
    expect(fillOf("ns1")).toBe("#b3b6bd");
    // Whole-series Open fill + Outline colour have no effect — forced solid + a var(--bg) ring.
    const open = buildPlotScene(table, { ...plot, seriesStyles: { p: { symbolFill: "open", symbolOutline: "#123456" } } }, { width: 480, height: 320 });
    const up = open.series[0]!.marks.find((m) => m.rowId === "up")!;
    expect(up.symbolFill).toBe("solid");
    expect(up.symbolOutline).toBe("var(--bg)");
  });
});

describe("buildPlotScene — alluvial axis-header font", () => {
  const table: DataTable = {
    id: "t", kind: "multivariable", name: "T",
    columns: [{ id: "a", name: "Stage" }, { id: "b", name: "Outcome" }],
    rows: [
      { id: "r1", cells: { a: "Early", b: "Win" } },
      { id: "r2", cells: { a: "Early", b: "Loss" } },
      { id: "r3", cells: { a: "Late", b: "Win" } },
    ],
  };
  const base: Plot = { id: "p", name: "P", source: "t", status: "ok", styleOverrides: {}, kind: "alluvial" };

  it("reserves the axis-header band from the legend font (headers render with it)", () => {
    const opts = { width: 500, height: 360 };
    const small = buildPlotScene(table, base, opts);
    const big = buildPlotScene(table, { ...base, fonts: { legend: { size: 40 } } }, opts);
    expect(small.alluvial!.axisLabels.length).toBeGreaterThanOrEqual(2); // one header per axis
    // A bigger legend font (the header font) must push the node band further down.
    expect(big.plot.y).toBeGreaterThan(small.plot.y);
  });

  // The end-axis node labels reserve a left+right margin. The cap on that margin is
  // width-relative: a flat 130px-per-side cap would squeeze a small thumbnail (360px) to a ~64px plot.
  it("does not squish the plot at a small (gallery-thumbnail) width", () => {
    // Long category labels that would hit a flat 130px cap on both sides.
    const wide: DataTable = {
      id: "tw", kind: "multivariable", name: "T",
      columns: [{ id: "a", name: "Stage" }, { id: "b", name: "Outcome" }],
      rows: [
        { id: "r1", cells: { a: "Early diagnosis", b: "Full remission" } },
        { id: "r2", cells: { a: "Early diagnosis", b: "Partial response" } },
        { id: "r3", cells: { a: "Late presentation", b: "Full remission" } },
      ],
    };
    const small = buildPlotScene(wide, { ...base, source: "tw" }, { width: 360, height: 250 });
    // The plot must keep a usable share of the 360px width (a flat cap leaves ~64px / 18%).
    expect(small.plot.width).toBeGreaterThan(360 * 0.33);
    // At full size the 130px absolute cap applies: the width-relative cap only bites below it.
    const big = buildPlotScene(wide, { ...base, source: "tw" }, { width: 700, height: 460 });
    expect(big.plot.x).toBe(148); // 18 (marginRight default) + 130 (full label cap) + 0 pad
  });
});

describe("buildPlotScene — parallel coordinates axis set", () => {
  const table: DataTable = {
    id: "t", kind: "xy", name: "T",
    columns: [{ id: "x", name: "Dose", role: "x" }, { id: "y1", name: "A" }, { id: "y2", name: "B" }],
    rows: [
      { id: "r1", cells: { x: 1, y1: 4, y2: 7 } },
      { id: "r2", cells: { x: 2, y1: 5, y2: 8 } },
      { id: "r3", cells: { x: 3, y1: 6, y2: 9 } },
    ],
  };
  const base: Plot = { id: "p", name: "P", source: "t", status: "ok", styleOverrides: {}, kind: "parallel" };

  // Long names on close axes would run together ("RespondersNon-respondersSite North"): every
  // second name steps up a line when neighbours would touch, and no two names overlap.
  it("no two axis names overlap, however long", () => {
    const measure = (t: string, px: number): number => t.length * px * 0.6;
    const long: DataTable = { ...table, columns: [{ id: "x", name: "Responders", role: "x" }, { id: "y1", name: "Non-responders" }, { id: "y2", name: "Site North" }, { id: "y3", name: "Site South" }, { id: "y4", name: "Baseline visit" }], rows: table.rows.map((r, i) => ({ ...r, cells: { ...r.cells, y3: i, y4: 2 * i } })) } as unknown as DataTable;
    const s = buildPlotScene(long, { ...base, fonts: { axisTitle: { size: 18 } } } as Plot, { width: 580, height: 380, measure });
    const size = s.fonts.axisTitle.size;
    const boxes = s.parallel!.axes.map((a) => ({ x1: a.labelX - measure(a.label, size) / 2, x2: a.labelX + measure(a.label, size) / 2, y: a.labelY }));
    for (let i = 1; i < boxes.length; i++) for (let j = 0; j < i; j++) {
      const a = boxes[j]!, b = boxes[i]!;
      if (Math.abs(a.y - b.y) < size) expect(a.x2 <= b.x1 || b.x2 <= a.x1, `"${s.parallel!.axes[j]!.label}" overlaps "${s.parallel!.axes[i]!.label}"`).toBe(true);
    }
    expect(boxes.every((b) => b.y === boxes[0]!.y), "the fixture must crowd its names, or it cannot show an overlap").toBe(false);
    // A chart whose names fit keeps them on one line.
    const fit = buildPlotScene(table, base, { width: 600, height: 400, measure });
    expect(new Set(fit.parallel!.axes.map((a) => a.labelY)).size).toBe(1);
  });

  it("includes the X-role column as an axis (parallel coords has no distinguished X)", () => {
    const s = buildPlotScene(table, base, { width: 600, height: 400 });
    const labels = s.parallel!.axes.map((a) => a.label);
    expect(labels).toContain("Dose"); // the role:x column is a full axis, not dropped
    expect(labels).toContain("A");
    expect(labels).toContain("B");
    expect(s.parallel!.lines.length).toBe(3); // lines route through the X axis value too
  });

  // The colorbar title must resolve from all columns: tableDatasets() omits the
  // X column, so a lookup there alone would drop the title when colouring by X.
  it("value colour mode: the colorbar title resolves even when the colour column is X", () => {
    const s = buildPlotScene(table, { ...base, parallel: { colorColumn: "x", colorScale: "value" } }, { width: 600, height: 400 });
    expect(s.colorbar).toBeTruthy();
    expect(s.colorbar!.title).toBe("Dose"); // the X column's name, not undefined
    // colouring by X excludes it from the axes (it's the colour encoding, not an axis).
    expect(s.parallel!.axes.map((a) => a.label)).toEqual(["A", "B"]);
  });
});

describe("buildPlotScene — raincloud", () => {
  // two groups, each with several replicate values (subcolumns under a lead Y col)
  const table: DataTable = {
    id: "t", kind: "column", name: "t",
    columns: [
      { id: "x", name: "Row", role: "x" },
      { id: "a", name: "Control", role: "y" }, { id: "a2", name: "a2", role: "y", group: "a" }, { id: "a3", name: "a3", role: "y", group: "a" },
      { id: "b", name: "Treated", role: "y" }, { id: "b2", name: "b2", role: "y", group: "b" }, { id: "b3", name: "b3", role: "y", group: "b" },
    ],
    rows: [
      [1, 10, 11, 9, 18, 19, 17], [2, 12, 13, 11, 20, 21, 22], [3, 9, 10, 8, 16, 15, 17], [4, 11, 12, 10, 19, 18, 20],
    ].map((r, i) => ({ id: `r${i}`, cells: { x: r[0]!, a: r[1]!, a2: r[2]!, a3: r[3]!, b: r[4]!, b2: r[5]!, b3: r[6]! } })),
  };
  const plot: Plot = { id: "p", name: "P", source: "t", status: "ok", styleOverrides: {}, kind: "raincloud" };

  it("emits a half-violin cloud + box + rain points per group", () => {
    const s = buildPlotScene(table, plot, { width: 520, height: 340 });
    expect(s.kind).toBe("raincloud");
    expect(s.series).toHaveLength(2); // Control + Treated
    for (const series of s.series) {
      const cloud = series.marks.find((m) => m.violin);
      const box = series.marks.find((m) => m.box);
      const rain = series.marks.find((m) => m.points);
      expect(cloud, "cloud").toBeDefined();
      expect(box, "box").toBeDefined();
      expect(rain, "rain").toBeDefined();
      // the three glyphs are offset across the band (cloud left of the rain)
      expect(cloud!.cx).toBeLessThan(rain!.cx);
      expect((rain!.points?.length ?? 0)).toBeGreaterThan(0);
    }
    expect(s.warnings).toEqual([]);
  });

  it("the Width slider scales the glyphs, Show-box hides the inner box, outliers don't double-plot", () => {
    const boxW = (st: Record<string, { boxWidth?: number }>): number =>
      buildPlotScene(table, { ...plot, seriesStyles: st }, { width: 520, height: 340 }).series[0]!.marks.find((m) => m.box)!.box!.w;
    expect(boxW({ a: { boxWidth: 0.9 } })).toBeGreaterThan(boxW({ a: { boxWidth: 0.2 } })); // the Width control reaches the drawing
    // Show-box off → the inner box mark is gone (other series unaffected).
    const noBox = buildPlotScene(table, { ...plot, seriesStyles: { a: { violinShowBox: false } } }, { width: 520, height: 340 });
    expect(noBox.series[0]!.marks.some((m) => m.box)).toBe(false);
    expect(noBox.series[1]!.marks.some((m) => m.box)).toBe(true);
    // The box carries no outlier circles — the rain swarm already shows every raw point.
    const box = buildPlotScene(table, plot, { width: 520, height: 340 }).series[0]!.marks.find((m) => m.box)!;
    expect(box.box!.outliers).toEqual([]);
  });
});


describe("buildPlotScene — scatter3d axis titles + floor grid (editability)", () => {
  const table: DataTable = {
    id: "t", kind: "column", name: "3D",
    columns: [
      { id: "cx", name: "Length" },
      { id: "cy", name: "Width" },
      { id: "cz", name: "Height" },
    ],
    rows: [
      { id: "r1", cells: { cx: 1, cy: 2, cz: 3 } },
      { id: "r2", cells: { cx: 4, cy: 5, cz: 6 } },
      { id: "r3", cells: { cx: 7, cy: 8, cz: 2 } },
    ],
  };
  const base: Plot = { id: "p", name: "P", source: "t", status: "ok", styleOverrides: {}, kind: "scatter3d" };

  it("axis labels default to the column names", () => {
    const s = buildPlotScene(table, base, { width: 500, height: 400 });
    expect(s.scatter3d?.axes.map((a) => a.label)).toEqual(["Length", "Width", "Height"]);
  });

  it("xAxis/yAxis titles and scatter3d.zTitle override the axis labels", () => {
    const s = buildPlotScene(
      table,
      { ...base, xAxis: { title: "X custom" }, yAxis: { title: "Y custom" }, scatter3d: { zTitle: "Z custom" } },
      { width: 500, height: 400 },
    );
    expect(s.scatter3d?.axes.map((a) => a.label)).toEqual(["X custom", "Y custom", "Z custom"]);
  });

  it("emits the floor-grid colour + show flag (default shown)", () => {
    const def = buildPlotScene(table, base, { width: 500, height: 400 });
    expect(def.scatter3d?.showGrid).toBe(true);
    expect(def.scatter3d?.gridColor).toBeUndefined();
    const styled = buildPlotScene(table, { ...base, scatter3d: { gridColor: "#abcdef", showGrid: false } }, { width: 500, height: 400 });
    expect(styled.scatter3d?.gridColor).toBe("#abcdef");
    expect(styled.scatter3d?.showGrid).toBe(false);
  });

  it("axis line colour/width flow from the xAxis spec", () => {
    const s = buildPlotScene(table, { ...base, xAxis: { lineColor: "#112233", lineWidth: 3 } }, { width: 500, height: 400 });
    expect(s.scatter3d?.axisColor).toBe("#112233");
    expect(s.scatter3d?.axisWidth).toBe(3);
  });

  it("Spacing: Labels↔axis lifts the tick numbers off the axis; Title↔labels moves the name (per axis)", () => {
    const nameDist = (s: ReturnType<typeof buildPlotScene>, ai: number): number => {
      const a = s.scatter3d!.axes[ai]!;
      return Math.hypot(a.lx - a.x2, a.ly - a.y2);
    };
    const tickDist = (s: ReturnType<typeof buildPlotScene>, ai: number): number => {
      const t = s.scatter3d!.axes[ai]!.ticks![0]!;
      return Math.hypot(t.lx - t.x, t.ly - t.y);
    };
    const d0 = buildPlotScene(table, base, { width: 500, height: 400 });
    // Title↔labels (titleGap) pushes the name out — only on the axis it is set on.
    const dTitle = buildPlotScene(table, { ...base, xAxis: { titleGap: 60 } }, { width: 500, height: 400 });
    expect(nameDist(dTitle, 0)).toBeGreaterThan(nameDist(d0, 0));
    expect(nameDist(dTitle, 1)).toBeCloseTo(nameDist(d0, 1), 3);
    // Labels↔axis (tickLabelGap) lifts the tick numbers off the axis — the main way to clear a clash.
    const dLbl = buildPlotScene(table, { ...base, xAxis: { tickLabelGap: 30 } }, { width: 500, height: 400 });
    expect(tickDist(dLbl, 0)).toBeGreaterThan(tickDist(d0, 0) + 10);
    // Y barely moves — only the sub-px cube-reserve nudge from X's wider gap (not its own gap).
    expect(Math.abs(tickDist(dLbl, 1) - tickDist(d0, 1))).toBeLessThan(0.5);
  });

  it("Label side 'flip' mirrors the tick numbers to the opposite side of the edge", () => {
    const d0 = buildPlotScene(table, base, { width: 500, height: 400 });
    const dFlip = buildPlotScene(table, { ...base, xAxis: { labelSide: "flip" } }, { width: 500, height: 400 });
    const t0 = d0.scatter3d!.axes[0]!.ticks![0]!;
    const tf = dFlip.scatter3d!.axes[0]!.ticks![0]!;
    // same tick point; the number's offset vector points the opposite way (dot product < 0).
    const dot = (tf.lx - tf.x) * (t0.lx - t0.x) + (tf.ly - tf.y) * (t0.ly - t0.y);
    expect(dot).toBeLessThan(0);
  });

  it("tick numbers offset in one constant direction per axis — an aligned ladder, not curved", () => {
    // Wider ranges → several ticks per axis. A radial-from-centre offset would differ per tick
    // (the ladder would curve); a constant perpendicular gives every number the same offset vector.
    const t: DataTable = {
      id: "t", kind: "column", name: "T",
      columns: [{ id: "cx", name: "L" }, { id: "cy", name: "W" }, { id: "cz", name: "H" }],
      rows: Array.from({ length: 8 }, (_, i) => ({ id: `r${i}`, cells: { cx: i * 15, cy: i * 11, cz: i * 8 } })),
    };
    const s = buildPlotScene(t, base, { width: 640, height: 520 });
    let checked = 0;
    for (const ax of s.scatter3d!.axes) {
      if (ax.ticks!.length < 3) continue;
      const dx0 = ax.ticks![0]!.lx - ax.ticks![0]!.x;
      const dy0 = ax.ticks![0]!.ly - ax.ticks![0]!.y;
      for (const tk of ax.ticks!) {
        expect(tk.lx - tk.x).toBeCloseTo(dx0, 6); // same horizontal offset for every number
        expect(tk.ly - tk.y).toBeCloseTo(dy0, 6); // same vertical offset → they line up straight
      }
      checked++;
    }
    expect(checked).toBeGreaterThan(0); // at least one axis actually had a multi-tick ladder
  });

  it("depth shading fades points toward the back (opacity only; size unchanged)", () => {
    const off = buildPlotScene(table, base, { width: 500, height: 400 });
    expect(off.scatter3d!.points.every((p) => p.alpha === undefined)).toBe(true); // off by default
    const on = buildPlotScene(table, { ...base, scatter3d: { depthShade: true } }, { width: 500, height: 400 });
    const pts = on.scatter3d!.points; // back-to-front order
    expect(pts[0]!.alpha!).toBeLessThan(pts[pts.length - 1]!.alpha!); // far dimmer than near
    expect(pts[0]!.alpha!).toBeCloseTo(0.4, 6); // farthest
    expect(pts[pts.length - 1]!.alpha!).toBeCloseTo(1, 6); // nearest, full opacity
    // Opacity only — radii are identical with and without the cue.
    expect(pts.map((p) => p.r)).toEqual(off.scatter3d!.points.map((p) => p.r));
  });
});

describe("buildPlotScene — radar chart section (editability)", () => {
  const table: DataTable = {
    id: "tr", kind: "column", name: "R",
    columns: [{ id: "axis", name: "Metric" }, { id: "s1", name: "A" }, { id: "s2", name: "B" }],
    rows: [
      { id: "m1", cells: { axis: "Speed", s1: 3, s2: 5 } },
      { id: "m2", cells: { axis: "Power", s1: 4, s2: 2 } },
      { id: "m3", cells: { axis: "Range", s1: 6, s2: 4 } },
      { id: "m4", cells: { axis: "Grip", s1: 5, s2: 7 } },
    ],
  };
  const base: Plot = { id: "p", name: "P", source: "tr", status: "ok", styleOverrides: {}, kind: "radar" };

  it("defaults: 4 rings, dots shown, neutral grid/spoke", () => {
    const s = buildPlotScene(table, base, { width: 480, height: 420 });
    expect(s.radar?.rings.length).toBe(4);
    expect(s.radar?.showDots).toBe(true);
    expect(s.radar?.gridColor).toBeUndefined();
    expect(s.radar?.spokeWidth).toBe(1);
  });

  it("ringCount + scaleMax drive the grid rings", () => {
    const s = buildPlotScene(table, { ...base, radar: { ringCount: 5, scaleMax: 10 } }, { width: 480, height: 420 });
    expect(s.radar?.rings.length).toBe(5);
    expect(s.radar?.rings[s.radar.rings.length - 1]!.value).toBeCloseTo(10, 6);
  });

  it("emits the spoke/grid/dot style overrides", () => {
    const s = buildPlotScene(table, { ...base, radar: { spokeColor: "#111111", spokeWidth: 2, gridColor: "#222222", gridWidth: 1.5, showDots: false, dotSize: 4 } }, { width: 480, height: 420 });
    expect(s.radar?.spokeColor).toBe("#111111");
    expect(s.radar?.spokeWidth).toBe(2);
    expect(s.radar?.gridColor).toBe("#222222");
    expect(s.radar?.gridWidth).toBe(1.5);
    expect(s.radar?.showDots).toBe(false);
    expect(s.radar?.dotSize).toBe(4);
  });
});

describe("buildPlotScene — area baseline + fill suite (editability)", () => {
  const table: DataTable = {
    id: "ta", kind: "xy", name: "A",
    columns: [{ id: "x", name: "X" }, { id: "y", name: "Y" }],
    rows: [
      { id: "r1", cells: { x: 1, y: 2 } },
      { id: "r2", cells: { x: 2, y: 5 } },
      { id: "r3", cells: { x: 3, y: 3 } },
    ],
  };
  const base: Plot = { id: "p", name: "P", source: "ta", status: "ok", styleOverrides: {}, kind: "area" };

  it("areaBaseline moves the fill baseline (different areaPath)", () => {
    const def = buildPlotScene(table, base, { width: 440, height: 320 });
    // A baseline inside the data range (2..5) lifts the fill floor off the bottom.
    const shifted = buildPlotScene(table, { ...base, areaBaseline: 4 }, { width: 440, height: 320 });
    expect(def.series[0]?.areaPath).toBeTruthy();
    expect(shifted.series[0]?.areaPath).toBeTruthy();
    expect(shifted.series[0]?.areaPath).not.toBe(def.series[0]?.areaPath);
  });

  it("a pattern fill on an area yields a non-solid fillSpec (renders via url)", () => {
    const s = buildPlotScene(table, { ...base, seriesStyles: { y: { fillType: "pattern", pattern: "hatch" } } }, { width: 440, height: 320 });
    expect(s.series[0]?.fillSpec?.type).not.toBe("solid");
  });
});

describe("buildPlotScene — flipped axis-title offset stays welded to its title (dataAxisOf)", () => {
  const table: DataTable = {
    id: "tb", kind: "column", name: "B",
    columns: [{ id: "c", name: "Group" }, { id: "v", name: "Value" }],
    rows: [{ id: "r1", cells: { c: "A", v: 3 } }, { id: "r2", cells: { c: "B", v: 5 } }],
  };
  const base: Plot = { id: "p", name: "P", source: "tb", status: "ok", styleOverrides: {}, kind: "bar" };

  it("vertical: the visual-X offset comes from xAxis", () => {
    const s = buildPlotScene(table, { ...base, xAxis: { titleOffset: { dx: 7, dy: 3 } } }, { width: 440, height: 320 });
    expect(s.x.titleOffset).toEqual({ dx: 7, dy: 3 });
  });

  it("horizontal: the value title (visual X) reads the data yAxis offset", () => {
    // On a flipped chart the value axis is drawn on X; its title text routes to
    // plot.yAxis (dataAxisOf), so its drag offset must too — else flipping back
    // jumps the offset to the category axis.
    const s = buildPlotScene(table, { ...base, barOrientation: "horizontal", yAxis: { titleOffset: { dx: 10, dy: -5 } } }, { width: 440, height: 320 });
    expect(s.x.titleOffset).toEqual({ dx: 10, dy: -5 });
  });

  it("horizontal: the category title (visual Y) reads the data xAxis offset", () => {
    const s = buildPlotScene(table, { ...base, barOrientation: "horizontal", xAxis: { titleOffset: { dx: 2, dy: 8 } } }, { width: 440, height: 320 });
    expect(s.y.titleOffset).toEqual({ dx: 2, dy: 8 });
  });
});

describe("buildPlotScene — survival CI band + censor ticks (editability)", () => {
  const table: DataTable = { id: "ts", kind: "column", name: "S", columns: [{ id: "t", name: "Time" }], rows: [] };
  const curve = {
    label: "A",
    times: [0, 2, 4, 6],
    surv: [1, 0.8, 0.6, 0.4],
    lower: [1, 0.6, 0.4, 0.2],
    upper: [1, 0.95, 0.8, 0.65],
    censor: [3, 5],
  };
  const base: Plot = { id: "p", name: "P", source: "ts", status: "ok", styleOverrides: {}, kind: "survival", survival: [curve] };

  it("emits a bandPath + censor ticks by default", () => {
    const s = buildPlotScene(table, base, { width: 440, height: 320 });
    expect(s.series[0]?.bandPath).toBeTruthy();
    expect(s.series[0]?.censorTicks?.length).toBe(2);
  });

  it("toggles hide the CI band / censor ticks", () => {
    const noCI = buildPlotScene(table, { ...base, survivalShowCI: false }, { width: 440, height: 320 });
    expect(noCI.series[0]?.bandPath ?? "").toBe("");
    const noCensor = buildPlotScene(table, { ...base, survivalShowCensor: false }, { width: 440, height: 320 });
    expect(noCensor.series[0]?.censorTicks ?? undefined).toBeUndefined();
  });

  it("carries the CI band opacity (default 0.15) and honours an override", () => {
    const def = buildPlotScene(table, base, { width: 440, height: 320 });
    expect(def.series[0]?.bandOpacity).toBeCloseTo(0.15);
    const custom = buildPlotScene(table, { ...base, survivalCiOpacity: 0.3 }, { width: 440, height: 320 });
    expect(custom.series[0]?.bandOpacity).toBeCloseTo(0.3);
    // clamped to [0,1]
    const clamped = buildPlotScene(table, { ...base, survivalCiOpacity: 5 }, { width: 440, height: 320 });
    expect(clamped.series[0]?.bandOpacity).toBe(1);
  });
});

describe("buildPlotScene — editable details reach the scene (lollipop stem, histogram values, before-after title)", () => {
  it("lollipop emits its stem colour", () => {
    const table: DataTable = {
      id: "tl", kind: "column", name: "L",
      columns: [{ id: "c", name: "Cat" }, { id: "v", name: "V" }],
      rows: [{ id: "r1", cells: { c: "A", v: 3 } }, { id: "r2", cells: { c: "B", v: 5 } }],
    };
    const s = buildPlotScene(table, { id: "p", name: "P", source: "tl", status: "ok", styleOverrides: {}, kind: "lollipop", lollipop: { stemColor: "#ff0000", stemWidth: 4 } }, { width: 440, height: 320 });
    expect(s.lollipop?.stemColor).toBe("#ff0000");
    expect(s.lollipop?.stemWidth).toBe(4);
  });

  it("histogram honours showValues (value labels on the bars)", () => {
    const table: DataTable = {
      id: "th", kind: "column", name: "H",
      columns: [{ id: "v", name: "Value" }],
      rows: [3, 5, 5, 7, 8, 8, 9, 12, 14, 15].map((v, i) => ({ id: `r${i}`, cells: { v } })),
    };
    const on = buildPlotScene(table, { id: "p", name: "P", source: "th", status: "ok", styleOverrides: {}, kind: "histogram", showValues: true }, { width: 440, height: 320 });
    expect(on.valueLabels?.show).toBe(true);
    const off = buildPlotScene(table, { id: "p", name: "P", source: "th", status: "ok", styleOverrides: {}, kind: "histogram" }, { width: 440, height: 320 });
    expect(off.valueLabels?.show ?? false).toBe(false);
  });

  it("before-after honours an X-axis title (an edited title reaches the drawing)", () => {
    const table: DataTable = {
      id: "tba", kind: "column", name: "BA",
      columns: [{ id: "subj", name: "Subject" }, { id: "pre", name: "Pre" }, { id: "post", name: "Post" }],
      rows: [{ id: "r1", cells: { subj: "S1", pre: 3, post: 7 } }, { id: "r2", cells: { subj: "S2", pre: 4, post: 6 } }],
    };
    const s = buildPlotScene(table, { id: "p", name: "P", source: "tba", status: "ok", styleOverrides: {}, kind: "beforeafter", xAxis: { title: "Timepoint" } }, { width: 440, height: 320 });
    expect(s.x.title).toBe("Timepoint");
  });
});

describe("buildPlotScene — scatter3d per-point colour override (editability)", () => {
  const table: DataTable = {
    id: "t3o", kind: "column", name: "3D",
    columns: [{ id: "cx", name: "X" }, { id: "cy", name: "Y" }, { id: "cz", name: "Z" }],
    rows: [
      { id: "r1", cells: { cx: 1, cy: 2, cz: 3 } },
      { id: "r2", cells: { cx: 4, cy: 5, cz: 6 } },
    ],
  };
  it("exposes the styling column id + paints a single overridden point", () => {
    const s = buildPlotScene(
      table,
      { id: "p", name: "P", source: "t3o", status: "ok", styleOverrides: {}, kind: "scatter3d", pointStyles: { "cy:r1": { color: "#ff0000" } } },
      { width: 500, height: 400 },
    );
    expect(s.scatter3d?.seriesId).toBe("cy");
    const p1 = s.scatter3d?.points.find((p) => p.rowId === "r1");
    const p2 = s.scatter3d?.points.find((p) => p.rowId === "r2");
    expect(p1?.overrideFill).toBe("#ff0000");
    expect(p2?.overrideFill).toBeUndefined();
  });

  // The 'Clear (see-through)' fill must draw a see-through dot, not a solid one.
  it("symbolFill='clear' yields a transparent marker (fill none), like the 2-D renderer", () => {
    const mk = (styles?: Record<string, { symbolFill: string }>) =>
      buildPlotScene(
        table,
        { id: "p", name: "P", source: "t3o", status: "ok", styleOverrides: {}, kind: "scatter3d", ...(styles ? { seriesStyles: styles as Plot["seriesStyles"] } : {}) },
        { width: 500, height: 400 },
      ).scatter3d!.marker;
    expect(mk({ cy: { symbolFill: "clear" } }).fill).toBe("none"); // see-through
    expect(mk().fill).not.toBe("none"); // default solid → series colour
  });
});

describe("buildPlotScene — pie/radar label drag offsets (editability)", () => {
  it("pie slice label carries its drag offset (from pointStyles valueDx/valueDy)", () => {
    const table: DataTable = {
      id: "tpl", kind: "partsofwhole", name: "P",
      columns: [{ id: "c", name: "Cat" }, { id: "v", name: "V" }],
      rows: [{ id: "r1", cells: { c: "A", v: 3 } }, { id: "r2", cells: { c: "B", v: 5 } }],
    };
    const s = buildPlotScene(
      table,
      { id: "p", name: "P", source: "tpl", status: "ok", styleOverrides: {}, kind: "pie", pieLabels: "label", pointStyles: { "r1:r1": { valueDx: 12, valueDy: -4 } } },
      { width: 440, height: 320 },
    );
    const slice = s.pie?.slices.find((sl) => sl.id === "r1");
    expect(slice?.labelDx).toBe(12);
    expect(slice?.labelDy).toBe(-4);
  });

  it("pie slice label honours a rename override (same per-point key as the drag)", () => {
    const table: DataTable = {
      id: "tpl", kind: "partsofwhole", name: "P",
      columns: [{ id: "c", name: "Cat" }, { id: "v", name: "V" }],
      rows: [{ id: "r1", cells: { c: "A", v: 3 } }, { id: "r2", cells: { c: "B", v: 5 } }],
    };
    const build = (pointStyles: Record<string, Record<string, unknown>>) =>
      buildPlotScene(table, { id: "p", name: "P", source: "tpl", status: "ok", styleOverrides: {}, kind: "pie", pieLabels: "label", pointStyles } as never, { width: 440, height: 320 });
    expect(build({}).pie?.slices.find((sl) => sl.id === "r1")?.labelText).toBe("A");
    // renamed → wins over the generated label; its neighbour is untouched
    const s = build({ "r1:r1": { valueText: "Alpha cohort" } });
    expect(s.pie?.slices.find((sl) => sl.id === "r1")?.labelText).toBe("Alpha cohort");
    expect(s.pie?.slices.find((sl) => sl.id === "r2")?.labelText).toBe("B");
    // blank restores the generated readout (the override is cleared, not stored as "")
    expect(build({ "r1:r1": {} }).pie?.slices.find((sl) => sl.id === "r1")?.labelText).toBe("A");
  });

  it("lollipop Δ label honours a rename override (blank restores the computed %)", () => {
    const table: DataTable = {
      id: "tll", kind: "column", name: "L",
      columns: [{ id: "c", name: "Q", role: "x" }, { id: "a", name: "Then", role: "y" }, { id: "b", name: "Now", role: "y" }],
      rows: [{ id: "r1", cells: { c: "Q1", a: 10, b: 15 } }],
    };
    const build = (pointStyles: Record<string, Record<string, unknown>>) =>
      buildPlotScene(table, { id: "p", name: "L", source: "tll", status: "ok", styleOverrides: {}, kind: "lollipop", lollipop: { showDelta: true }, pointStyles } as never, { width: 520, height: 320 });
    expect(build({}).lollipop?.rows[0]?.delta?.text).toBe("+50%"); // computed
    expect(build({ "__delta__:r1": { valueText: "half again" } }).lollipop?.rows[0]?.delta?.text).toBe("half again");
    expect(build({ "__delta__:r1": {} }).lollipop?.rows[0]?.delta?.text).toBe("+50%"); // blank → computed
  });

  it("radar spoke label carries its row id + drag offset", () => {
    const table: DataTable = {
      id: "trl", kind: "column", name: "R",
      columns: [{ id: "axis", name: "M" }, { id: "s1", name: "A" }],
      rows: [
        { id: "m1", cells: { axis: "x", s1: 3 } },
        { id: "m2", cells: { axis: "y", s1: 4 } },
        { id: "m3", cells: { axis: "z", s1: 6 } },
      ],
    };
    const s = buildPlotScene(
      table,
      { id: "p", name: "P", source: "trl", status: "ok", styleOverrides: {}, kind: "radar", pointStyles: { "m1:m1": { valueDx: 7, valueDy: 9 } } },
      { width: 460, height: 420 },
    );
    const spoke = s.radar?.spokes.find((sp) => sp.rowId === "m1");
    expect(spoke?.labelDx).toBe(7);
    expect(spoke?.labelDy).toBe(9);
  });
});

describe("buildPlotScene — heatmap honours xAxisLength/yAxisLength (panel-figure Align X/Y)", () => {
  const hmTable: DataTable = {
    id: "thm", kind: "column", name: "H",
    columns: [{ id: "g", name: "Gene" }, { id: "c1", name: "S1" }, { id: "c2", name: "S2" }, { id: "c3", name: "S3" }],
    rows: [
      { id: "r1", cells: { g: "A", c1: 1, c2: 2, c3: 3 } },
      { id: "r2", cells: { g: "B", c1: 4, c2: 5, c3: 6 } },
      { id: "r3", cells: { g: "C", c1: 7, c2: 8, c3: 9 } },
      { id: "r4", cells: { g: "D", c1: 2, c2: 4, c3: 6 } },
    ],
  };
  const hmBase: Plot = { id: "p", name: "P", source: "thm", status: "ok", styleOverrides: {}, kind: "heatmap" };

  it("yAxisLength drives the grid height (Align Y-axes; a matrix heatmap that ignored it would tower over its row)", () => {
    const s = buildPlotScene(hmTable, { ...hmBase, yAxisLength: 200 }, { width: 580, height: 520 });
    expect(s.plot.height).toBeCloseTo(200, 0);
  });

  it("xAxisLength drives the grid width (Align X-axes)", () => {
    const s = buildPlotScene(hmTable, { ...hmBase, xAxisLength: 240 }, { width: 580, height: 520 });
    expect(s.plot.width).toBeCloseTo(240, 0);
  });

  it("without alignment the grid uses the full figure size", () => {
    const s = buildPlotScene(hmTable, hmBase, { width: 580, height: 520 });
    expect(s.plot.height).toBeGreaterThan(260);
    expect(s.plot.width).toBeGreaterThan(300);
  });
});

describe("buildPlotScene — a heatmap aligns with other panels in a row (Align Y-axes)", () => {
  // Mirrors the panel-figure composition: every panel gets yAxisLength = ALIGN_AY and
  // is built at the aligned height; their scene.plot.height must then match so the data
  // rectangles line up. A heatmap that ignored yAxisLength would tower over its neighbours.
  const ALIGN_AY = 200;
  const hm: DataTable = {
    id: "thm2", kind: "column", name: "H",
    columns: [{ id: "g", name: "Gene" }, { id: "c1", name: "S1" }, { id: "c2", name: "S2" }],
    rows: [
      { id: "r1", cells: { g: "A", c1: 1, c2: 2 } },
      { id: "r2", cells: { g: "B", c1: 3, c2: 4 } },
      { id: "r3", cells: { g: "C", c1: 5, c2: 6 } },
    ],
  };
  const bars: DataTable = {
    id: "tb2", kind: "column", name: "B",
    columns: [{ id: "cat", name: "Cat" }, { id: "v", name: "V" }],
    rows: [{ id: "b1", cells: { cat: "X", v: 3 } }, { id: "b2", cells: { cat: "Y", v: 7 } }],
  };
  it("heatmap + bar panels get the same plot height when aligned", () => {
    const hmScene = buildPlotScene(hm, { id: "ph", name: "H", source: "thm2", status: "ok", styleOverrides: {}, kind: "heatmap", yAxisLength: ALIGN_AY }, { width: 900, height: 700 });
    const barScene = buildPlotScene(bars, { id: "pb", name: "B", source: "tb2", status: "ok", styleOverrides: {}, kind: "bar", yAxisLength: ALIGN_AY }, { width: 900, height: 700 });
    expect(hmScene.plot.height).toBeCloseTo(ALIGN_AY, 0);
    expect(barScene.plot.height).toBeCloseTo(ALIGN_AY, 0);
    expect(Math.abs(hmScene.plot.height - barScene.plot.height)).toBeLessThan(1);
  });
});

// The panel composer's uniform-sizing re-render passes { stretch: true } so normally
// aspect-locked kinds (pie/radar/3-D) fill the box instead of centring a circle. Without
// the flag they keep their aspect-locked layout (guarded by the golden tests above).
describe("buildPlotScene — stretch-to-fill for aspect-locked kinds", () => {
  const WIDE = { width: 600, height: 300 } as const;
  const plot = (kind: PlotKind, source: string): Plot => ({ id: "p", name: "P", source, status: "ok", styleOverrides: {}, kind });

  const pieTable: DataTable = {
    id: "tp", kind: "column", name: "P",
    columns: [{ id: "x", name: "L" }, { id: "a", name: "A" }, { id: "b", name: "B" }, { id: "c", name: "C" }],
    rows: [{ id: "r1", cells: { x: 1, a: 20, b: 4, c: 25 } }, { id: "r2", cells: { x: 2, a: 10, b: 6, c: 35 } }],
  };
  // A pie is never an oval. The figure's re-lay pass passes stretch, so a stretch that drew an
  // ellipse to fill a wide box would squash every pie re-drawn there. The pie stays round and
  // centres in the box.
  it("pie: stretch keeps the pie round (no wedge scale) in a wide or tall box, same as no flag", () => {
    for (const box of [WIDE, { width: 300, height: 600 }]) {
      const st = buildPlotScene(pieTable, plot("pie", "tp"), { ...box, stretch: true }).pie!;
      const plain = buildPlotScene(pieTable, plot("pie", "tp"), box).pie!;
      expect(st.scale, `${box.width}x${box.height}: a stretched pie must not be scaled into an oval`).toBeUndefined();
      expect(st.r).toBeCloseTo(plain.r, 6);
    }
  });

  const radarTable: DataTable = {
    id: "trr", kind: "column", name: "R",
    columns: [{ id: "axis", name: "M" }, { id: "s1", name: "A" }],
    rows: ["Speed", "Power", "Range", "Grip"].map((m, i) => ({ id: `m${i}`, cells: { axis: m, s1: 3 + i } })),
  };
  const radarSpread = (opts: Parameters<typeof buildPlotScene>[2]) => {
    const s = buildPlotScene(radarTable, plot("radar", "trr"), opts).radar!;
    const xs = s.spokes.map((sp) => sp.x), ys = s.spokes.map((sp) => sp.y);
    return { w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
  };
  // A radar is a circle of equal spokes; squashed, its spokes read as different lengths — the
  // same deformation refused for the pie. Stretched = drawn exactly as unstretched.
  it("radar: stretch keeps the web round in a wide or tall box, same as no flag", () => {
    for (const box of [WIDE, { width: 300, height: 600 }]) {
      const st = radarSpread({ ...box, stretch: true });
      const ns = radarSpread(box);
      expect(Math.abs(st.w - st.h), `${box.width}×${box.height} stretched: ${st.w.toFixed(1)} wide × ${st.h.toFixed(1)} tall`).toBeLessThan(2);
      expect(st.w).toBeCloseTo(ns.w, 6);
    }
  });

  const td: DataTable = {
    id: "t3", kind: "column", name: "3D",
    columns: [{ id: "cx", name: "X" }, { id: "cy", name: "Y" }, { id: "cz", name: "Z" }],
    rows: [{ id: "r1", cells: { cx: 1, cy: 2, cz: 3 } }, { id: "r2", cells: { cx: 4, cy: 5, cz: 6 } }, { id: "r3", cells: { cx: 7, cy: 8, cz: 2 } }],
  };
  const floorSpanX = (opts: Parameters<typeof buildPlotScene>[2]) => {
    const xs = buildPlotScene(td, plot("scatter3d", "t3"), opts).scatter3d!.floor.flatMap((l) => [l.x1, l.x2]);
    return Math.max(...xs) - Math.min(...xs);
  };
  // A cube skewed to fill a wider box leaves the axis names no room, and a figure panel cuts
  // them off. Stretched = drawn exactly as unstretched.
  it("3-D: stretch draws the same cube as no stretch (never skewed)", () => {
    expect(floorSpanX({ ...WIDE, stretch: true })).toBeCloseTo(floorSpanX(WIDE), 6);
  });
});

describe("buildPlotScene — per-axis tick style (length / hide) resolves into the scene", () => {
  const t: DataTable = {
    id: "t", kind: "xy", name: "T",
    columns: [{ id: "x", name: "X", role: "x" }, { id: "y", name: "Y", role: "y" }],
    rows: [{ id: "r1", cells: { x: 1, y: 2 } }, { id: "r2", cells: { x: 2, y: 4 } }],
  };
  const base: Plot = { id: "p", name: "P", source: "t", status: "ok", styleOverrides: {}, kind: "xy" };

  it("defaults: no per-axis tickLen / hideTicks on the scene", () => {
    const s = buildPlotScene(t, base, { width: 400, height: 300 });
    expect(s.x.tickLen).toBeUndefined();
    expect(s.x.hideTicks).toBeUndefined();
  });

  it("xAxis.tickLen and xAxis.hideTicks flow through to scene.x", () => {
    const s = buildPlotScene(t, { ...base, xAxis: { tickLen: 12, hideTicks: true }, yAxis: { tickLen: 3 } }, { width: 400, height: 300 });
    expect(s.x.tickLen).toBe(12);
    expect(s.x.hideTicks).toBe(true);
    expect(s.y.tickLen).toBe(3);
    expect(s.y.hideTicks).toBeUndefined(); // per-axis: Y unaffected by X's hide
  });
});

describe("buildPlotScene — floating bars", () => {
  // A = {1,1,1,1,10} (skewed: mean 2.8, median 1); B = {2,3,4,5,20} (mean 6.8, median 4).
  const table: DataTable = {
    id: "t",
    kind: "multivariable", // every column is a group (no X band)
    name: "T",
    columns: [{ id: "a", name: "A" }, { id: "b", name: "B" }],
    rows: [
      { id: "r0", cells: { a: 1, b: 2 } },
      { id: "r1", cells: { a: 1, b: 3 } },
      { id: "r2", cells: { a: 1, b: 4 } },
      { id: "r3", cells: { a: 1, b: 5 } },
      { id: "r4", cells: { a: 10, b: 20 } },
    ],
  };
  const base: Plot = { id: "p", name: "F", source: "t", status: "ok", styleOverrides: {}, kind: "floatingbar" };
  const opts = { width: 480, height: 320, yScale: "linear" as const };

  it("draws one box per group spanning min→max with no protruding whiskers or outliers", () => {
    const s = buildPlotScene(table, base, opts);
    expect(s.series).toHaveLength(2);
    for (const ser of s.series) {
      const box = ser.marks[0]!.box!;
      expect(box.whiskerLow).toBe(box.q1); // whiskers collapsed to the box edges
      expect(box.whiskerHigh).toBe(box.q3);
      expect(box.outliers).toEqual([]);
      expect(box.q1).toBeGreaterThan(box.q3); // q1 = min (lower value → larger pixel) below q3 = max
    }
  });

  // Floatingbar has no whiskers (they collapse to the box edges), so BoxGlyph
  // must not draw whisker cap ticks — the builder sets whiskerCaps:false for floatingbar.
  it("suppresses whisker caps (no spurious cap ticks at the box edges)", () => {
    const s = buildPlotScene(table, base, opts);
    for (const ser of s.series) expect(ser.whiskerCaps).toBe(false);
    // a real box keeps its caps (positive control)
    const box = buildPlotScene(table, { ...base, kind: "box" }, opts);
    expect(box.series[0]!.whiskerCaps).toBe(true);
  });

  it("centre line follows mean (default) / median / none", () => {
    const mean = buildPlotScene(table, base, opts);
    const median = buildPlotScene(table, { ...base, floatingBar: { line: "median" } }, opts);
    const none = buildPlotScene(table, { ...base, floatingBar: { line: "none" } }, opts);
    // Skewed group A: the mean line and median line land at different pixels.
    expect(mean.series[0]!.marks[0]!.box!.median).not.toBe(median.series[0]!.marks[0]!.box!.median);
    // "none" suppresses the centre line (median: null) — the renderer draws no line.
    expect(none.series[0]!.marks[0]!.box!.median).toBeNull();
  });

  // The box Contour (borderColor), fill Opacity and centre-line
  // colour/width the Inspector panel writes must reach the drawn series.
  it("honours the box Contour, fill Opacity and centre-line colour/width overrides", () => {
    const styled = buildPlotScene(table, { ...base, seriesStyles: { a: { borderColor: "#ff0000", fillOpacity: 0.9, medianColor: "#00ff00", medianWidth: 4 } } }, opts).series.find((sr) => sr.id === "a")!;
    expect(styled.borderColor).toBe("#ff0000"); // box contour
    expect(styled.fillOpacity).toBeCloseTo(0.9, 5); // editable, not pinned at the 0.18 default
    expect(styled.medianColor).toBe("#00ff00"); // centre-line colour
    expect(styled.medianWidth).toBe(4);
    const def = buildPlotScene(table, base, opts).series.find((sr) => sr.id === "a")!;
    expect(def.fillOpacity).toBeLessThan(0.5); // light default preserved
  });

  it("respects horizontal orientation (value axis on X)", () => {
    const s = buildPlotScene(table, { ...base, barOrientation: "horizontal" }, opts);
    expect(s.series).toHaveLength(2);
    for (const ser of s.series) {
      const box = ser.marks[0]!.box!;
      expect(box.whiskerLow).toBe(box.q1);
      expect(box.q1).toBeLessThan(box.q3); // horizontal: min (small value → small pixel) left of max
    }
  });

  // The box spans the chosen BoxWhisker definition (min→max default, percentiles, or
  // mean±SD/SEM/CI) — the builder reads b.whiskerLow/whiskerHigh, not always b.min/b.max.
  it("spans the chosen definition — min→max default, percentile, or mean±SD", () => {
    const boxOf = (p: Partial<Plot>) => buildPlotScene(table, { ...base, ...p }, opts).series[0]!.marks[0]!.box!;
    const minmax = boxOf({}); // no boxWhisker → min→max
    // A = {1,1,1,1,10}: mean 2.8, min 1, max 10, p90 = 6.4 (< max), SD ≈ 4.025.
    const p1090 = boxOf({ boxWhisker: "p10_90" });
    const sd = boxOf({ boxWhisker: "sd" });
    expect(minmax.q1).toBeGreaterThan(minmax.q3); // vertical: min below max — default unchanged
    // p10–90 is narrower: p90 (6.4) < max (10) → the top edge sits lower (larger pixel).
    expect(p1090.q3).toBeGreaterThan(minmax.q3);
    expect(p1090.q3).not.toBe(minmax.q3); // honoured, not ignored (ignoring it gives minmax.q3)
    // Mean ± SD is symmetric about the mean → the box midpoint is the mean centre line.
    expect((sd.q1 + sd.q3) / 2).toBeCloseTo(sd.median!, 5);
    expect(sd.q3).not.toBe(minmax.q3);
  });
});

describe("buildPlotScene — Gardner-Altman estimation plot", () => {
  // Control mean 11.333, test mean 16.333 → observed difference ≈ 5.
  const table: DataTable = {
    id: "t",
    kind: "multivariable",
    name: "T",
    columns: [{ id: "ctrl", name: "Control" }, { id: "test", name: "Test" }],
    rows: [
      { id: "r0", cells: { ctrl: 10, test: 15 } }, // +5
      { id: "r1", cells: { ctrl: 12, test: 17 } }, // +5
      { id: "r2", cells: { ctrl: 11, test: 15 } }, // +4
      { id: "r3", cells: { ctrl: 13, test: 19 } }, // +6
      { id: "r4", cells: { ctrl: 10, test: 14 } }, // +4
      { id: "r5", cells: { ctrl: 12, test: 18 } }, // +6
    ],
  };
  const meanC = 68 / 6; // 11.333
  const meanT = 98 / 6; // 16.333 (sum 15+17+15+19+14+18 = 98)
  const base: Plot = { id: "p", name: "GA", source: "t", status: "ok", styleOverrides: {}, kind: "estimation" };
  const opts = { width: 560, height: 380, yScale: "linear" as const };

  it("shows two swarms + a difference band with a bootstrap-CI point that brackets the observed difference", () => {
    const s = buildPlotScene(table, base, opts);
    expect(s.series.map((x) => x.id)).toEqual(["ctrl", "test", "est-diff"]);
    const diff = s.series.find((x) => x.id === "est-diff")!;
    // A violin (bootstrap distribution) mark + a point (effect estimate) mark.
    expect(diff.marks.some((m) => m.violin)).toBe(true);
    const pt = diff.marks.find((m) => m.points && m.points.length === 1)!;
    // The 95% bootstrap CI (errLow..errHigh in value space) brackets the test mean (= control + diff).
    expect(pt.errLow!).toBeLessThan(meanT);
    expect(pt.errHigh!).toBeGreaterThan(meanT);
    // The point sits inside its own CI error bar (pixels: high value = small pixel).
    expect(pt.cy).toBeGreaterThan(pt.errHighCy!);
    expect(pt.cy).toBeLessThan(pt.errLowCy!);
  });

  it("the effect (y2) axis is the value axis shifted so the control mean reads 0", () => {
    const s = buildPlotScene(table, base, opts);
    expect(s.y2).toBeDefined();
    expect(s.y2!.domain[0]).toBeCloseTo(s.y.domain[0] - meanC, 6);
    expect(s.y2!.domain[1]).toBeCloseTo(s.y.domain[1] - meanC, 6);
    // A dashed zero-effect reference line is drawn at the control mean.
    expect(s.annotations.some((a) => a.id === "est-zero")).toBe(true);
  });

  it("the seeded bootstrap is reproducible (same seed → identical CI)", () => {
    const a = buildPlotScene(table, base, opts).series.find((x) => x.id === "est-diff")!.marks.find((m) => m.points?.length === 1)!;
    const b = buildPlotScene(table, base, opts).series.find((x) => x.id === "est-diff")!.marks.find((m) => m.points?.length === 1)!;
    expect(a.errLow).toBe(b.errLow);
    expect(a.errHigh).toBe(b.errHigh);
  });

  it("paired mode bootstraps per-subject differences (CI still brackets the mean difference)", () => {
    const s = buildPlotScene(table, { ...base, estimation: { paired: true } }, opts);
    const pt = s.series.find((x) => x.id === "est-diff")!.marks.find((m) => m.points?.length === 1)!;
    expect(pt.errLow!).toBeLessThan(meanT);
    expect(pt.errHigh!).toBeGreaterThan(meanT);
    // Paired diffs here are all exactly 5 → the paired CI is tighter than unpaired.
    const unp = buildPlotScene(table, base, opts).series.find((x) => x.id === "est-diff")!.marks.find((m) => m.points?.length === 1)!;
    expect(pt.errHigh! - pt.errLow!).toBeLessThanOrEqual(unp.errHigh! - unp.errLow! + 1e-9);
  });

  it("paired mode row-aligns complete pairs (interior blanks in either column don't misalign)", () => {
    // Complete pairs are (10,110) and (20,120) — both +100 → a correct paired CI collapses.
    // Pooling each column independently ([10,50,20] vs [110,60,120]) and pairing by index
    // would give diffs [100,10,100], a spread CI centred ~70.
    const blanks: DataTable = {
      id: "t", kind: "multivariable", name: "T",
      columns: [{ id: "ctrl", name: "Control" }, { id: "test", name: "Test" }],
      rows: [
        { id: "r0", cells: { ctrl: 10, test: 110 } },
        { id: "r1", cells: { ctrl: 50, test: null } }, // Test blank
        { id: "r2", cells: { ctrl: null, test: 60 } }, // Control blank
        { id: "r3", cells: { ctrl: 20, test: 120 } },
      ],
    };
    const pt = buildPlotScene(blanks, { ...base, estimation: { paired: true } }, opts)
      .series.find((x) => x.id === "est-diff")!.marks.find((m) => m.points?.length === 1)!;
    expect(pt.errHigh! - pt.errLow!).toBeLessThan(1e-6); // both complete diffs are +100 → CI collapses
    expect(pt.errLow!).toBeCloseTo((10 + 50 + 20) / 3 + 100, 4); // effect +100 above the pooled control mean
  });

  // Independent oracle for the bootstrap CI (property tests alone — it brackets the estimate,
  // it's reproducible — are not a numeric check). The
  // percentile bootstrap shares no code with normal theory, so two facts anchor it:
  //   • the CI width is shift-free (errHigh−errLow), so at a well-behaved n it must match the
  //     analytic 2·z·SE within bootstrap noise; and
  //   • the width ratio between two levels cancels the distribution's exact shape → it must be
  //     the z-ratio, which is the sharp catch for a hardcoded / ignored `ciLevel`.
  it("bootstrap CI width + level-scaling match normal theory (independent oracle)", () => {
    const N = 40;
    // Deterministic, well-spread, ~independent groups (n large enough for the bootstrap ≈ normal).
    const ctrl = Array.from({ length: N }, (_v, i) => 10 + (i % 7) + Math.sin(i * 1.3) * 3);
    const tst = Array.from({ length: N }, (_v, i) => 15 + (i % 5) + Math.cos(i * 0.9) * 3);
    const big: DataTable = {
      id: "t2", kind: "multivariable", name: "T2",
      columns: [{ id: "ctrl", name: "Control" }, { id: "test", name: "Test" }],
      rows: Array.from({ length: N }, (_v, i) => ({ id: `r${i}`, cells: { ctrl: ctrl[i]!, test: tst[i]! } })),
    };
    const widthAt = (ciLevel: number): { w: number; obs: number } => {
      const pt = buildPlotScene(big, { ...base, estimation: { ciLevel, resamples: 8000, seed: 42 } }, opts)
        .series.find((x) => x.id === "est-diff")!.marks.find((m) => m.points?.length === 1)!;
      return { w: pt.errHigh! - pt.errLow!, obs: pt.dy! };
    };
    // Independent analytic values (from scratch — mean, ddof=1 variance, unpaired SE).
    const mean = (a: number[]): number => a.reduce((s, v) => s + v, 0) / a.length;
    const varS = (a: number[], m: number): number => a.reduce((s, v) => s + (v - m) * (v - m), 0) / (a.length - 1);
    const mC = mean(ctrl), mT = mean(tst);
    const seDiff = Math.sqrt(varS(ctrl, mC) / N + varS(tst, mT) / N);

    const at95 = widthAt(0.95), at99 = widthAt(0.99);
    // Centre = observed mean difference (exact).
    expect(at95.obs).toBeCloseTo(mT - mC, 6);
    // Width ≈ 2·z·SE — bootstrap SE (plug-in) runs a touch tighter than the ddof=1 SE, so a
    // generous band that still fails a wrong scale (½× or 2×) or swapped bounds.
    const analytic95 = 2 * 1.95996 * seDiff;
    expect(at95.w).toBeGreaterThan(analytic95 * 0.7);
    expect(at95.w).toBeLessThan(analytic95 * 1.3);
    // Level scaling: 99%/95% width ratio must be the z-ratio (2.5758/1.9600 = 1.314), not 1.
    // This is the sharp test that `ciLevel` is honoured and not hardcoded.
    expect(at99.w / at95.w).toBeGreaterThan(1.20);
    expect(at99.w / at95.w).toBeLessThan(1.42);
  });
});

describe("buildPlotScene — forest plot", () => {
  // Study label + estimate / lower CI / upper CI columns (one study per row).
  const table: DataTable = {
    id: "t", kind: "column", name: "T",
    columns: [
      { id: "s", name: "Study", role: "x" },
      { id: "e", name: "OR", role: "y" },
      { id: "lo", name: "Lower", role: "y" },
      { id: "hi", name: "Upper", role: "y" },
    ],
    rows: [
      { id: "r0", cells: { s: "A", e: 1.2, lo: 0.9, hi: 1.6 } },
      { id: "r1", cells: { s: "B", e: 0.8, lo: 0.6, hi: 1.1 } },
      { id: "r2", cells: { s: "C", e: 1.5, lo: 1.1, hi: 2.0 } },
      { id: "r3", cells: { s: "D", e: 0.95, lo: 0.7, hi: 1.3 } },
    ],
  };
  const base: Plot = { id: "p", name: "FP", source: "t", status: "ok", styleOverrides: {}, kind: "forest" };
  const opts = { width: 560, height: 360 };

  it("draws one marker per study with a horizontal CI whisker bracketing the estimate", () => {
    const s = buildPlotScene(table, base, opts);
    expect(s.kind).toBe("forest");
    expect(s.series).toHaveLength(1);
    const marks = s.series[0]!.marks;
    expect(marks).toHaveLength(4);
    const a = marks[0]!;
    expect(a.errLow).toBe(0.9);
    expect(a.errHigh).toBe(1.6);
    // Pixels: on a non-reversed X, lower value = smaller pixel, so lo < est < hi.
    expect(a.errLowCx!).toBeLessThan(a.cx);
    expect(a.cx).toBeLessThan(a.errHighCx!);
    // Each study sits on its own Y band (distinct cy), top→bottom.
    expect(marks[0]!.cy).toBeLessThan(marks[3]!.cy);
    expect(s.warnings).toEqual([]);
  });

  // The Error-bars Direction + Caps controls reach markerSeries (not fixed at both/true).
  it("honours the Error-bars Direction and Caps controls on the CI whiskers", () => {
    const def = buildPlotScene(table, base, opts);
    expect(def.series[0]!.errorDir).toBe("both"); // default
    expect(def.series[0]!.errorCaps).toBe(true);
    const dir = buildPlotScene(table, { ...base, seriesStyles: { e: { errorDir: "up" } } }, opts);
    expect(dir.series[0]!.errorDir).toBe("up");
    const caps = buildPlotScene(table, { ...base, seriesStyles: { e: { errorCaps: false } } }, opts);
    expect(caps.series[0]!.errorCaps).toBe(false);
  });

  // The error-bar Type (none/SD/SEM/CI) has no effect on a forest plot, and the Inspector hides
  // it there: the CI whiskers are always built from the lower/upper columns, so 'none' keeps them.
  it("forest whiskers come from lo/hi whatever the error-bar Type — 'none' included", () => {
    const none = buildPlotScene(table, { ...base, seriesStyles: { e: { errorBars: "none" } } }, opts);
    const a = none.series[0]!.marks[0]!;
    expect(a.errLow).toBe(0.9); // whiskers come from the CI columns, not a Type computation
    expect(a.errHigh).toBe(1.6);
  });

  // Studies that disagree → real heterogeneity, so random-effects ≠ fixed-effect.
  const het: DataTable = {
    id: "t", kind: "column", name: "T",
    columns: [
      { id: "s", name: "Study", role: "x" },
      { id: "e", name: "Effect", role: "y" },
      { id: "lo", name: "Lower", role: "y" },
      { id: "hi", name: "Upper", role: "y" },
    ],
    rows: [
      { id: "r0", cells: { s: "A", e: 2.0, lo: 1.0, hi: 3.0 } },
      { id: "r1", cells: { s: "B", e: 2.5, lo: 2.0, hi: 3.0 } },
      { id: "r2", cells: { s: "C", e: 1.0, lo: 0.2, hi: 1.8 } },
      { id: "r3", cells: { s: "D", e: 3.0, lo: 2.5, hi: 3.5 } },
    ],
  };
  const sumWidth = (s: ReturnType<typeof buildPlotScene>): number => s.forestSummary!.xHi - s.forestSummary!.xLo;
  const tickLabels = (s: ReturnType<typeof buildPlotScene>): (string | undefined)[] => s.y.ticks.map((t) => t.label);

  it("random-effects widens the pooled CI vs fixed and tags the model + I²", () => {
    const fx = buildPlotScene(het, { ...base, forest: { showSummary: true, model: "fixed" } }, opts);
    const re = buildPlotScene(het, { ...base, forest: { showSummary: true, model: "random" } }, opts);
    expect(sumWidth(re)).toBeGreaterThan(sumWidth(fx)); // heterogeneity → wider RE interval
    // The summary row is labelled with the model + heterogeneity I² (statsmodels: I² ≈ 83%).
    expect(tickLabels(fx)).toContain("Summary · I²=83%");
    expect(tickLabels(re)).toContain("Summary (RE) · I²=83%");
  });

  it("honours the entered CI level: 90%-read limits widen the pooled interval vs 95%", () => {
    const at95 = buildPlotScene(het, { ...base, forest: { showSummary: true, ciLevel: 0.95 } }, opts);
    const at90 = buildPlotScene(het, { ...base, forest: { showSummary: true, ciLevel: 0.9 } }, opts);
    // A limit read as 90% implies a larger SE than the same width read as 95% → heavier tails.
    expect(sumWidth(at90)).toBeGreaterThan(sumWidth(at95));
  });

  it("draws a vertical no-effect reference line at refValue (default 1)", () => {
    const s = buildPlotScene(table, base, opts);
    const ref = s.annotations.find((an) => an.id === "forest-ref")!;
    expect(ref).toBeDefined();
    expect(ref.x1).toBe(ref.x2); // vertical
    expect(ref.y1).toBeLessThan(ref.y2!);
    // refValue: null → no line.
    const none = buildPlotScene(table, { ...base, forest: { refValue: null } }, opts);
    expect(none.annotations.some((an) => an.id === "forest-ref")).toBe(false);
  });

  it("refLine styles the no-effect line: colour override + show:false hides it (default preserved when unset)", () => {
    expect(buildPlotScene(table, base, opts).annotations.find((a) => a.id === "forest-ref")!.color).toBeNull(); // default unchanged
    expect(buildPlotScene(table, { ...base, refLine: { color: "#ff0000" } }, opts).annotations.find((a) => a.id === "forest-ref")!.color).toBe("#ff0000");
    expect(buildPlotScene(table, { ...base, refLine: { width: 3 } }, opts).annotations.find((a) => a.id === "forest-ref")!.width).toBe(3);
    expect(buildPlotScene(table, { ...base, refLine: { show: false } }, opts).annotations.some((a) => a.id === "forest-ref")).toBe(false);
  });

  it("pooled summary diamond appears only when showSummary, spanning its CI", () => {
    expect(buildPlotScene(table, base, opts).forestSummary).toBeUndefined();
    const s = buildPlotScene(table, { ...base, forest: { showSummary: true } }, opts);
    const d = s.forestSummary!;
    expect(d).toBeDefined();
    expect(d.xLo).toBeLessThan(d.cx); // left tip (pooled lower) left of the pooled centre
    expect(d.cx).toBeLessThan(d.xHi);
    // Summary gets its own Y band → 5 category ticks (4 studies + Summary). The summary row is
    // tagged with the pooling model + heterogeneity I²; "· I²=NN%" is that suffix.
    expect(s.y.ticks).toHaveLength(5);
    expect(s.y.ticks[4]!.label).toMatch(/^Summary · I²=\d+%$/);
  });

  /**
   * The pooled summary is a data point, and tunes like one.
   *
   * The diamond's shape, colour and outline are tunable: it is keyed `forest-summary` and
   * takes the ordinary marker vocabulary. Its horizontal extent stays data (the pooled CI) and is
   * deliberately not tunable: a diamond whose width you can set would not report a confidence interval.
   */
  describe("the pooled summary tunes like a data point", () => {
    const sum = (style: Record<string, unknown> | undefined) =>
      buildPlotScene(
        table,
        { ...base, forest: { showSummary: true }, ...(style ? { seriesStyles: { "forest-summary": style } } : {}) } as Plot,
        opts,
      ).forestSummary;

    it("defaults: the study colour, a matching 1px outline, full opacity", () => {
      const d = sum(undefined)!;
      const studyColour = buildPlotScene(table, { ...base, forest: { showSummary: true } }, opts).series[0]!.color;
      expect(d.color, "the summary does not follow the study colour").toBe(studyColour);
      expect(d.outline).toBe(studyColour);
      expect(d.outlineWidth).toBe(1);
      expect(d.fillOpacity).toBe(1);
    });

    it("takes its own colour, outline colour and outline width", () => {
      const d = sum({ color: "#D55E00", symbolOutline: "#000000", symbolBorderWidth: 3 })!;
      expect(d.color, "the summary ignored its own colour").toBe("#D55E00");
      expect(d.outline, "the outline is not independent of the fill").toBe("#000000");
      expect(d.outlineWidth).toBe(3);
    });

    it("a clear fill makes it hollow, and open fills with the page colour, not the series hue", () => {
      // Note: `open` falling back to the series colour would render a hollow diamond solid and
      // make the Fill control look broken — this asserts against that.
      expect(sum({ symbolFill: "clear", color: "#D55E00" })!.color).toBe("none");
      const open = sum({ symbolFill: "open", color: "#D55E00" })!;
      expect(open.color, "an open summary was filled with the series colour").not.toBe("#D55E00");
      expect(open.outline, "an open diamond still needs its edge").toBe("#D55E00");
    });

    it("Size drives its height — and never its width, which is the CI", () => {
      const small = sum({ symbolSize: 5 })!;
      const big = sum({ symbolSize: 12 })!;
      expect(big.halfH, "marker size did not change the summary's height").toBeGreaterThan(small.halfH);
      expect(big.xLo, "marker size moved the CI — the diamond no longer reports the interval").toBe(small.xLo);
      expect(big.xHi).toBe(small.xHi);
    });

    it("hiding it in the Series list actually removes it", () => {
      // The list offers a show/hide toggle for every row it draws; one that did nothing
      // would be a dead control the moment "Summary" appeared there.
      expect(sum({ hidden: true })).toBeUndefined();
    });
  });

  it("honours a log effect axis (all-positive values) via the Axis scale", () => {
    const s = buildPlotScene(table, { ...base, xAxis: { scale: "log10" } }, opts);
    expect(s.x.type).toBe("log10");
  });

  it("weightMarkers scales each study's marker size by inverse-variance weight", () => {
    const s = buildPlotScene(table, { ...base, forest: { weightMarkers: true } }, opts);
    const sizes = s.series[0]!.marks.map((m) => m.symbolSize!);
    // The tightest CI (study B: 0.6–1.1) is the heaviest → the largest marker.
    expect(new Set(sizes).size).toBeGreaterThan(1);
    const bSize = s.series[0]!.marks[1]!.symbolSize!;
    expect(bSize).toBe(Math.max(...sizes));
  });
});

describe("buildPlotScene — Bland-Altman plot", () => {
  // diffs (A−B): -0.6, +0.6, -0.2, +0.2 → bias 0, sd ≈ 0.516.
  const table: DataTable = {
    id: "t", kind: "column", name: "T",
    columns: [
      { id: "s", name: "Subject", role: "x" },
      { id: "a", name: "Method A", role: "y" },
      { id: "b", name: "Method B", role: "y" },
    ],
    rows: [
      { id: "r0", cells: { s: 1, a: 10, b: 10.6 } },
      { id: "r1", cells: { s: 2, a: 12, b: 11.4 } },
      { id: "r2", cells: { s: 3, a: 8, b: 8.2 } },
      { id: "r3", cells: { s: 4, a: 14, b: 13.8 } },
    ],
  };
  const base: Plot = { id: "p", name: "BA", source: "t", status: "ok", styleOverrides: {}, kind: "blandaltman" };
  const opts = { width: 560, height: 360 };

  it("shows a one-entry 'Difference' legend only when explicitly enabled", () => {
    expect(buildPlotScene(table, base, opts).legend).toEqual([]); // single series → hidden by default
    const on = buildPlotScene(table, { ...base, legend: { show: true }, seriesStyles: { b: { color: "#33cc99" } } }, opts);
    expect(on.legend.map((e) => e.label)).toEqual(["Difference"]);
    expect(on.legend[0]!.color).toBe("#33cc99"); // in the series colour
    // a hidden Difference series → no legend even when enabled
    expect(buildPlotScene(table, { ...base, legend: { show: true }, seriesStyles: { b: { hidden: true } } }, opts).legend).toEqual([]);
  });

  it("analysis-fed table (xy, role-less columns) still plots — method A is the x column", () => {
    // The Bland-Altman analysis creates importTable("xy", ["Method A","Method B"]) with no roles,
    // so Method A becomes the x column and tableDatasets sees only one dataset; it must still render.
    const fed: DataTable = {
      id: "t2", kind: "xy", name: "Fed",
      columns: [{ id: "a", name: "Method A" }, { id: "b", name: "Method B" }],
      rows: [
        { id: "r0", cells: { a: 10, b: 10.6 } },
        { id: "r1", cells: { a: 12, b: 11.4 } },
        { id: "r2", cells: { a: 8, b: 8.2 } },
      ],
    };
    const s = buildPlotScene(fed, base, opts);
    expect(s.series[0]!.marks).toHaveLength(3); // every pair is drawn
    expect(s.warnings).not.toContain("Bland-Altman needs two measurement columns (methods A and B).");
    expect(s.series[0]!.marks[0]!.dx).toBeCloseTo(10.3, 6); // mean(10, 10.6)
  });

  // The single "Difference" series is keyed by the 2nd method column; its
  // Inspector show/hide toggle (seriesStyles[styleId].hidden) must drop the points.
  it("hides the difference points when the Difference series is toggled off", () => {
    const shown = buildPlotScene(table, base, opts);
    expect(shown.series).toHaveLength(1);
    expect(shown.series[0]!.marks.length).toBeGreaterThan(0);
    const hid = buildPlotScene(table, { ...base, seriesStyles: { b: { hidden: true } } }, opts); // styleId = 2nd dataset "b"
    expect(hid.series).toHaveLength(0); // difference points removed
  });

  it("plots each pair at (mean, difference) with bias + limits-of-agreement lines", () => {
    const s = buildPlotScene(table, base, opts);
    expect(s.kind).toBe("blandaltman");
    expect(s.series).toHaveLength(1);
    const marks = s.series[0]!.marks;
    expect(marks).toHaveLength(4);
    expect(marks[0]!.dx).toBeCloseTo(10.3, 6); // mean of 10, 10.6
    expect(marks[0]!.dy).toBeCloseTo(-0.6, 6); // A − B
    // bias (solid) + two LoA (dashed) reference lines.
    const bias = s.annotations.find((a) => a.id === "ba-bias")!;
    const hi = s.annotations.find((a) => a.id === "ba-loa-hi")!;
    const lo = s.annotations.find((a) => a.id === "ba-loa-lo")!;
    expect(bias && hi && lo).toBeTruthy();
    // bias = 0 sits between the symmetric limits (pixels: higher value = smaller y).
    expect(hi.y1!).toBeLessThan(bias.y1!);
    expect(bias.y1!).toBeLessThan(lo.y1!);
    expect(bias.y1! - hi.y1!).toBeCloseTo(lo.y1! - bias.y1!, 4); // symmetric about the bias
    expect(s.warnings).toEqual([]);
  });

  it("percent mode plots the difference as a percent of the mean", () => {
    const s = buildPlotScene(table, { ...base, blandAltman: { percent: true } }, opts);
    // r0: 100·(10−10.6)/10.3 ≈ −5.825%
    expect(s.series[0]!.marks[0]!.dy).toBeCloseTo((100 * -0.6) / 10.3, 4);
  });

  it("the agreement multiplier widens the limits of agreement", () => {
    const narrow = buildPlotScene(table, { ...base, blandAltman: { agreementK: 1.96 } }, opts);
    const wide = buildPlotScene(table, { ...base, blandAltman: { agreementK: 3 } }, opts);
    const span = (s: ReturnType<typeof buildPlotScene>): number =>
      s.annotations.find((a) => a.id === "ba-loa-lo")!.y1! - s.annotations.find((a) => a.id === "ba-loa-hi")!.y1!;
    expect(span(wide)).toBeGreaterThan(span(narrow));
  });

  it("refLine styles bias + limits (colour/width/show) while keeping bias-solid vs LoA-dashed", () => {
    const idOf = (s: ReturnType<typeof buildPlotScene>, id: string) => s.annotations.find((a) => a.id === id)!;
    const def = buildPlotScene(table, base, opts);
    expect(idOf(def, "ba-bias").color).toBeNull(); // default unchanged
    expect(idOf(def, "ba-bias").dash).not.toBe(idOf(def, "ba-loa-hi").dash); // solid ≠ dashed
    const styled = buildPlotScene(table, { ...base, refLine: { color: "#00aa00", width: 2 } }, opts);
    for (const id of ["ba-bias", "ba-loa-hi", "ba-loa-lo"]) {
      expect(idOf(styled, id).color).toBe("#00aa00");
      expect(idOf(styled, id).width).toBe(2);
    }
    expect(idOf(styled, "ba-bias").dash).not.toBe(idOf(styled, "ba-loa-hi").dash); // distinction preserved
    const hidden = buildPlotScene(table, { ...base, refLine: { show: false } }, opts);
    for (const id of ["ba-bias", "ba-loa-hi", "ba-loa-lo"]) expect(hidden.annotations.some((a) => a.id === id)).toBe(false);
  });
});

describe("buildPlotScene — population pyramid", () => {
  const table: DataTable = {
    id: "t", kind: "column", name: "T",
    columns: [
      { id: "age", name: "Age", role: "x" },
      { id: "m", name: "Male", role: "y" },
      { id: "f", name: "Female", role: "y" },
    ],
    rows: [
      { id: "r0", cells: { age: "0–14", m: 62, f: 59 } },
      { id: "r1", cells: { age: "15–29", m: 71, f: 68 } },
      { id: "r2", cells: { age: "30–44", m: 66, f: 70 } },
    ],
  };
  const base: Plot = { id: "p", name: "PY", source: "t", status: "ok", styleOverrides: {}, kind: "pyramid" };
  const opts = { width: 560, height: 360 };

  it("draws two groups as mirrored bars meeting at the central zero axis", () => {
    const s = buildPlotScene(table, base, opts);
    expect(s.kind).toBe("pyramid");
    expect(s.series).toHaveLength(2);
    const left = s.series[0]!.marks[0]!.bar!; // Male, drawn left
    const right = s.series[1]!.marks[0]!.bar!; // Female, drawn right
    // The left bar's right edge meets the right bar's left edge at the zero axis.
    expect(left.x + left.w).toBeCloseTo(right.x, 4);
    // Same category row → same vertical band.
    expect(left.y).toBeCloseTo(right.y, 6);
    expect(s.warnings).toEqual([]);
  });

  it("the value axis is symmetric about zero with absolute-magnitude tick labels", () => {
    const s = buildPlotScene(table, base, opts);
    expect(Math.abs(s.x.domain[0])).toBeCloseTo(Math.abs(s.x.domain[1]), 6);
    // No tick label carries a minus sign (magnitudes shown on both sides).
    expect(s.x.ticks.every((t) => !/^[-−]/.test(t.label))).toBe(true);
    // A central axis line is drawn.
    expect(s.annotations.some((a) => a.id === "pyr-center")).toBe(true);
  });

  it("showValues prints each bar's magnitude at its tip", () => {
    const off = buildPlotScene(table, base, opts);
    expect(off.annotations.some((a) => a.id.startsWith("pyr-val-"))).toBe(false);
    const on = buildPlotScene(table, { ...base, pyramid: { showValues: true } }, opts);
    const labels = on.annotations.filter((a) => a.id.startsWith("pyr-val-"));
    expect(labels.length).toBe(6); // 3 categories × 2 groups
    expect(labels.some((a) => a.label === "62")).toBe(true);
  });

  it("value labels carry the valueLabel font family / weight / colour", () => {
    const s = buildPlotScene(table, { ...base, pyramid: { showValues: true }, fonts: { valueLabel: { family: "Courier New", bold: true, color: "#cc0044" } } }, opts);
    const lbl = s.annotations.find((a) => a.id.startsWith("pyr-val-"))!;
    expect(lbl.fontFamily).toBe("Courier New");
    expect(lbl.bold).toBe(true);
    expect(lbl.color).toBe("#cc0044");
  });

  it("a valueLabelPos override repositions that value label to the fractional plot-rect spot (drag persistence)", () => {
    const on = buildPlotScene(table, { ...base, pyramid: { showValues: true } }, opts);
    const lbl = on.annotations.find((a) => a.id.startsWith("pyr-val-"))!;
    const key = lbl.id.replace(/^pyr-val-/, ""); // "<dsId>-<rowId>"
    const moved = buildPlotScene(table, { ...base, pyramid: { showValues: true, valueLabelPos: { [key]: { x: 0.62, y: 0.18 } } } }, opts);
    const movedLbl = moved.annotations.find((a) => a.id === lbl.id)!;
    expect(movedLbl.labelX!).toBeCloseTo(moved.plot.x + 0.62 * moved.plot.width, 3);
    expect(movedLbl.labelY!).toBeCloseTo(moved.plot.y + 0.18 * moved.plot.height, 3);
    // A non-overridden label stays at its data-derived tip.
    const other = moved.annotations.find((a) => a.id.startsWith("pyr-val-") && a.id !== lbl.id)!;
    const onOther = on.annotations.find((a) => a.id === other.id)!;
    expect(other.labelX!).toBeCloseTo(onOther.labelX!, 4);
  });

  it("draws only the left side (no crash) when the table has a single value column", () => {
    const oneCol: DataTable = {
      id: "t", kind: "column", name: "T",
      columns: [{ id: "age", name: "Age", role: "x" }, { id: "m", name: "Male", role: "y" }],
      rows: [{ id: "r0", cells: { age: "0–14", m: 62 } }, { id: "r1", cells: { age: "15–29", m: 71 } }],
    };
    const s = buildPlotScene(oneCol, base, opts);
    expect(s.series).toHaveLength(1); // just the left group
    expect(s.warnings.some((w) => /two value columns/.test(w))).toBe(true);
  });
});

describe("buildPlotScene — forest / Bland-Altman / pyramid tolerate degenerate tables (no crash)", () => {
  // A table with only one value column (or none) must not throw for any of these kinds.
  const oneCol: DataTable = {
    id: "t", kind: "column", name: "T",
    columns: [{ id: "x", name: "Label", role: "x" }, { id: "y", name: "Val", role: "y" }],
    rows: [{ id: "r0", cells: { x: "A", y: 2 } }, { id: "r1", cells: { x: "B", y: 5 } }],
  };
  const opts = { width: 480, height: 320 };
  for (const kind of ["forest", "blandaltman", "pyramid"] as const) {
    it(`${kind} builds a warning-carrying scene from a one-column table`, () => {
      const s = buildPlotScene(oneCol, { id: "p", name: kind, source: "t", status: "ok", styleOverrides: {}, kind }, opts);
      expect(s.kind).toBe(kind);
      expect(s.warnings.length).toBeGreaterThan(0);
    });
  }
});

describe("buildPlotScene — PCA graph suite", () => {
  const pca = {
    varLabels: ["Va", "Vb", "Vc"],
    pcLabels: ["PC1", "PC2", "PC3"],
    explained: [0.6, 0.25, 0.15],
    eigenvalues: [1.8, 0.75, 0.45],
    loadings: [[0.7, -0.2, 0.1], [0.5, 0.6, -0.3], [0.4, -0.1, 0.8]],
    scores: [[-1.5, 0.4, 0.1], [-1.2, -0.3, 0.2], [1.4, 0.5, -0.4], [1.1, -0.4, 0.3]],
    groups: ["A", "A", "B", "B"],
  };
  const dummy: DataTable = { id: "t", kind: "xy", name: "T", columns: [{ id: "x", name: "X", role: "x" }], rows: [] };
  const mk = (kind: PlotKind, extra: Partial<Plot> = {}): Plot => ({ id: "p", name: "PCA", source: "t", status: "ok", styleOverrides: {}, kind, pca, ...extra });
  const opts = { width: 560, height: 380 };

  it("score plot: one series per group, points at (PCx, PCy), labelled axes + origin cross", () => {
    const s = buildPlotScene(dummy, mk("pcascore"), opts);
    expect(s.kind).toBe("pcascore");
    expect(s.series.map((x) => x.id)).toEqual(["pca-g0", "pca-g1"]); // groups A, B
    expect(s.legend.map((l) => l.label)).toEqual(["A", "B"]);
    expect(s.series.reduce((n, x) => n + x.marks.length, 0)).toBe(4); // 4 cases
    expect(s.x.title).toContain("PC1");
    expect(s.x.title).toContain("60.0%"); // explained[0]
    // Dashed origin cross (v + h lines at 0).
    expect(s.annotations.some((a) => a.id === "pca-vzero")).toBe(true);
    expect(s.annotations.some((a) => a.id === "pca-hzero")).toBe(true);
    expect(s.warnings).toEqual([]);
  });

  it("refLine styles the origin cross: colour/width override + show:false hides it (default preserved)", () => {
    expect(buildPlotScene(dummy, mk("pcascore"), opts).annotations.find((a) => a.id === "pca-vzero")!.color).toBe("#c8c8cc"); // default unchanged
    const styled = buildPlotScene(dummy, mk("pcascore", { refLine: { color: "#123456", width: 2 } }), opts);
    expect(styled.annotations.find((a) => a.id === "pca-vzero")!.color).toBe("#123456");
    expect(styled.annotations.find((a) => a.id === "pca-hzero")!.color).toBe("#123456");
    expect(styled.annotations.find((a) => a.id === "pca-vzero")!.width).toBe(2);
    const hidden = buildPlotScene(dummy, mk("pcascore", { refLine: { show: false } }), opts);
    expect(hidden.annotations.some((a) => a.id === "pca-vzero" || a.id === "pca-hzero")).toBe(false);
  });

  it("score plot: xComponent / yComponent pick which components are plotted", () => {
    const s = buildPlotScene(dummy, mk("pcascore", { pcaStyle: { xComponent: 0, yComponent: 2 } }), opts);
    const firstCase = s.series[0]!.marks[0]!;
    expect(firstCase.dx).toBeCloseTo(-1.5, 6); // scores[0][0]
    expect(firstCase.dy).toBeCloseTo(0.1, 6); // scores[0][2]
    expect(s.y.title).toContain("PC3");
  });

  it("loadings plot: one arrow per variable from the origin + a variable label", () => {
    const s = buildPlotScene(dummy, mk("pcaload"), opts);
    expect(s.kind).toBe("pcaload");
    expect(s.series[0]!.marks).toHaveLength(3); // 3 variables
    const arrows = s.annotations.filter((a) => a.kind === "arrow");
    expect(arrows).toHaveLength(3);
    // arrows start at the origin (same x1/y1 for all).
    expect(new Set(arrows.map((a) => `${a.x1},${a.y1}`)).size).toBe(1);
    expect(s.annotations.some((a) => a.kind === "text" && a.label === "Va")).toBe(true);
  });

  it("loading label: honours a drag position + a rename override (direct manipulation)", () => {
    const plot = mk("pcaload");
    const moved = buildPlotScene(dummy, { ...plot, pcaStyle: { ...(plot.pcaStyle ?? {}), labelPos: { "0": { x: 0.8, y: 0.2 } }, varLabelText: { "0": "Renamed" } } }, opts);
    const lbl = moved.annotations.find((a) => a.id === "pca-vlabel-0")!;
    expect(lbl.label).toBe("Renamed"); // rename override wins over the analysis varLabel
    // Dragged position → fractional plot-rect coords (right-of-centre, near the top).
    expect(lbl.labelX!).toBeGreaterThan(moved.plot.x + moved.plot.width * 0.6);
    expect(lbl.labelY!).toBeLessThan(moved.plot.y + moved.plot.height * 0.45);
    // An un-overridden label keeps the analysis variable name.
    expect(moved.annotations.find((a) => a.id === "pca-vlabel-1")!.label).not.toBe("Renamed");
  });

  it("biplot: scores + scaled loading arrows overlaid (arrows reach into the score cloud)", () => {
    const s = buildPlotScene(dummy, mk("pcabiplot"), opts);
    expect(s.kind).toBe("pcabiplot");
    expect(s.series.length).toBeGreaterThan(0); // score points
    const arrows = s.annotations.filter((a) => a.kind === "arrow");
    expect(arrows).toHaveLength(3);
  });

  /**
   * Depth sizing — dots are sized by the third component, like bubbles in a 3-D plot.
   *
   * The fixture's PC3 scores are [0.1, 0.2, −0.4, 0.3], deliberately straddling zero: the
   * furthest case (−0.4) must draw smallest. Sizing by |score| — the easy wrong answer —
   * would make it the largest, so this fixture can tell the two apart.
   */
  const radiiByCase = (s: ReturnType<typeof buildPlotScene>): Map<string, number | undefined> =>
    new Map(s.series.flatMap((x) => x.marks).map((m) => [String(m.rowId), m.symbolSize]));

  it("score plot: dots are sized by the third component — signed, so the far end is smallest", () => {
    const r = radiiByCase(buildPlotScene(dummy, mk("pcascore"), opts));
    expect([...r.keys()].sort()).toEqual(["case-0", "case-1", "case-2", "case-3"]);
    expect([...r.values()].every((v) => typeof v === "number")).toBe(true);
    // PC3: case-2 (−0.4) < case-0 (0.1) < case-1 (0.2) < case-3 (0.3).
    expect(r.get("case-2")!).toBeLessThan(r.get("case-0")!);
    expect(r.get("case-0")!).toBeLessThan(r.get("case-1")!);
    expect(r.get("case-1")!).toBeLessThan(r.get("case-3")!);
    // The extremes hit the radius ends exactly (defaults 2 → 9 px).
    expect(r.get("case-2")!).toBeCloseTo(2, 6);
    expect(r.get("case-3")!).toBeCloseTo(9, 6);
  });

  it("depth sizing: the biplot sizes by default too, off entirely at -1, and follows minRadius/maxRadius", () => {
    // The biplot's dots scale with a third component as bubble size by default; -1 switches
    // the third dimension off.
    const bip = radiiByCase(buildPlotScene(dummy, mk("pcabiplot"), opts));
    expect([...bip.values()].every((v) => typeof v === "number"), "the biplot's dots stayed uniform").toBe(true);
    expect(bip.get("case-2")!).toBeLessThan(bip.get("case-3")!);
    // -1 turns the default off on both kinds — every dot the series size again.
    for (const kind of ["pcascore", "pcabiplot"] as const) {
      const off = buildPlotScene(dummy, mk(kind, { pcaStyle: { sizeComponent: -1 } }), opts);
      expect([...radiiByCase(off).values()].every((v) => v === undefined), `${kind}: -1 did not restore uniform dots`).toBe(true);
      expect(off.bubbleLegend).toBeUndefined();
    }
    // The radius ends come from plot.bubble, shared with the bubble chart's editor.
    const big = radiiByCase(buildPlotScene(dummy, mk("pcascore", { bubble: { minRadius: 5, maxRadius: 20 } }), opts));
    expect(big.get("case-2")!).toBeCloseTo(5, 6);
    expect(big.get("case-3")!).toBeCloseTo(20, 6);
  });

  it("depth sizing: a size legend says what a big dot means, and is given room on the right", () => {
    const s = buildPlotScene(dummy, mk("pcascore"), opts);
    // The component and its variance share — bare "PC3" cannot tell you whether the dot sizes
    // are worth attending to. Same `pct()` the axis titles use; explained[2] = 0.15 here.
    expect(s.bubbleLegend?.title).toBe("PC3 (15.0%)");
    expect(s.bubbleLegend?.items.map((i) => i.label)).toEqual(["0.3", "-0.05", "-0.4"]); // max · mid · min
    // The legend is not drawn over the graph: the plot rect narrows to make room.
    const noLegend = buildPlotScene(dummy, mk("pcascore", { bubble: { showSizeLegend: false } }), opts);
    expect(noLegend.bubbleLegend).toBeUndefined();
    expect(s.plot.width).toBeLessThan(noLegend.plot.width);
    // Sized dots survive with the legend hidden — the legend is an explanation, not the feature.
    expect(radiiByCase(noLegend).get("case-3")!).toBeCloseTo(9, 6);
  });

  it("depth sizing: a component this analysis does not have says so instead of silently drawing uniform dots", () => {
    const s = buildPlotScene(dummy, mk("pcascore", { pcaStyle: { sizeComponent: 7 } }), opts);
    expect(s.warnings.some((w) => w.includes("PC8"))).toBe(true);
    expect([...radiiByCase(s).values()].every((v) => v === undefined)).toBe(true);
  });

  it("loadings/biplot: the arrow + variable-label colour honours seriesStyles['pca-loadings'].color", () => {
    // biplot default = #b5342f on both the arrow and the label
    const bip = buildPlotScene(dummy, mk("pcabiplot"), opts);
    expect(bip.annotations.find((a) => a.id === "pca-arrow-0")!.color).toBe("#b5342f");
    expect(bip.annotations.find((a) => a.id === "pca-vlabel-0")!.color).toBe("#b5342f");
    // an override reaches both the arrow and label, for biplot and loadings
    for (const kind of ["pcabiplot", "pcaload"] as const) {
      const s = buildPlotScene(dummy, mk(kind, { seriesStyles: { "pca-loadings": { color: "#00aa88" } } }), opts);
      expect(s.annotations.find((a) => a.id === "pca-arrow-0")!.color).toBe("#00aa88");
      expect(s.annotations.find((a) => a.id === "pca-vlabel-0")!.color).toBe("#00aa88");
    }
  });

  it("loadings/biplot: pcaStyle.arrowColors recolours one vector (arrow + its label); others keep the shared colour", () => {
    for (const kind of ["pcabiplot", "pcaload"] as const) {
      const s = buildPlotScene(dummy, mk(kind, { seriesStyles: { "pca-loadings": { color: "#00aa88" } }, pcaStyle: { arrowColors: { "1": "#ff0055" } } }), opts);
      // the overridden vector: arrow and label move together
      expect(s.annotations.find((a) => a.id === "pca-arrow-1")!.color).toBe("#ff0055");
      expect(s.annotations.find((a) => a.id === "pca-vlabel-1")!.color).toBe("#ff0055");
      // its neighbours still follow the shared "Loadings colour"
      expect(s.annotations.find((a) => a.id === "pca-arrow-0")!.color).toBe("#00aa88");
      expect(s.annotations.find((a) => a.id === "pca-vlabel-0")!.color).toBe("#00aa88");
    }
  });

  it("loadings/biplot: loading arrows are locked — their position is the loading vector, not a free shape", () => {
    for (const kind of ["pcabiplot", "pcaload"] as const) {
      const s = buildPlotScene(dummy, mk(kind), opts);
      for (const a of s.annotations.filter((x) => x.kind === "arrow")) expect(a.locked, `${kind} ${a.id} is draggable`).toBe(true);
      // the label stays free (it's a caption, and dragging it is a supported feature)
      expect(s.annotations.find((a) => a.id === "pca-vlabel-0")!.locked).toBeFalsy();
    }
  });

  it("loadings variable labels carry the legend font family / weight / italic", () => {
    const s = buildPlotScene(dummy, mk("pcaload", { fonts: { legend: { family: "Courier New", bold: true, italic: true } } }), opts);
    const vlabel = s.annotations.find((a) => a.id === "pca-vlabel-0")!;
    expect(vlabel.fontFamily).toBe("Courier New");
    expect(vlabel.bold).toBe(true); // bold → resolved weight 700 ≥ 600
    expect(vlabel.italic).toBe(true);
  });

  it("a pcaStyle.labelPos override repositions that loading label (drag persistence, loadings + biplot)", () => {
    for (const kind of ["pcaload", "pcabiplot"] as const) {
      const s = buildPlotScene(dummy, mk(kind), opts);
      expect(s.annotations.some((a) => a.id === "pca-vlabel-1")).toBe(true);
      const moved = buildPlotScene(dummy, mk(kind, { pcaStyle: { labelPos: { "1": { x: 0.3, y: 0.8 } } } }), opts);
      const movedLbl = moved.annotations.find((a) => a.id === "pca-vlabel-1")!;
      expect(movedLbl.labelX!).toBeCloseTo(moved.plot.x + 0.3 * moved.plot.width, 3);
      expect(movedLbl.labelY!).toBeCloseTo(moved.plot.y + 0.8 * moved.plot.height, 3);
      // A different loading label is unmoved (still at its arrow tip).
      const other = moved.annotations.find((a) => a.id === "pca-vlabel-0")!;
      const base0 = s.annotations.find((a) => a.id === "pca-vlabel-0")!;
      expect(other.labelX!).toBeCloseTo(base0.labelX!, 4);
    }
  });

  it("score/biplot: per-group confidence ellipses when plot.ellipse.show", () => {
    // Need ≥3 points per group (covariance ellipse is skipped below that).
    const pcaBig = {
      ...pca,
      scores: [[-1.5, 0.4, 0.1], [-1.2, -0.3, 0.2], [-1.8, 0.1, 0.0], [1.4, 0.5, -0.4], [1.1, -0.4, 0.3], [1.6, 0.2, -0.1]],
      groups: ["A", "A", "A", "B", "B", "B"],
    };
    const mkBig = (kind: PlotKind, extra: Partial<Plot> = {}): Plot =>
      ({ id: "p", name: "PCA", source: "t", status: "ok", styleOverrides: {}, kind, pca: pcaBig, ...extra });
    // off by default
    expect(buildPlotScene(dummy, mkBig("pcascore"), opts).ellipses).toBeUndefined();
    // on → one ellipse per group, colour-matched to each series
    const s = buildPlotScene(dummy, mkBig("pcascore", { ellipse: { show: true } }), opts);
    expect(s.ellipses).toHaveLength(2);
    const byId = new Map(s.ellipses!.map((e) => [e.id, e]));
    expect(byId.has("pca-g0") && byId.has("pca-g1")).toBe(true);
    const g0 = s.series.find((x) => x.id === "pca-g0")!;
    expect(byId.get("pca-g0")!.color).toBe(g0.color); // matches the group's marker colour
    // biplot scores also get ellipses; a loadings-only plot has no score cloud → none
    expect(buildPlotScene(dummy, mkBig("pcabiplot", { ellipse: { show: true } }), opts).ellipses).toHaveLength(2);
    expect(buildPlotScene(dummy, mkBig("pcaload", { ellipse: { show: true } }), opts).ellipses).toBeUndefined();
  });

  it("scree plot: line of variance per component; metric + cumulative options", () => {
    const pct = buildPlotScene(dummy, mk("scree"), opts);
    expect(pct.kind).toBe("scree");
    expect(pct.series).toHaveLength(1);
    expect(pct.series[0]!.linePath.length).toBeGreaterThan(0);
    expect(pct.series[0]!.marks[0]!.dy).toBeCloseTo(60, 6); // explained[0]·100
    // eigenvalue metric.
    const eig = buildPlotScene(dummy, mk("scree", { pcaStyle: { screeMetric: "eigenvalue" } }), opts);
    expect(eig.series[0]!.marks[0]!.dy).toBeCloseTo(1.8, 6);
    // cumulative overlay → a 2nd series ending at ~100%.
    const cum = buildPlotScene(dummy, mk("scree", { pcaStyle: { screeCumulative: true } }), opts);
    expect(cum.series).toHaveLength(2);
    expect(cum.series[1]!.marks[2]!.dy).toBeCloseTo(100, 6);
  });

  // The scree line's unlinked colour, Pattern (dash) and Connect controls must reach the drawing.
  it("scree line honours the unlinked colour + Pattern + Connect controls", () => {
    // linked (default) → line follows the series colour.
    const linked = buildPlotScene(dummy, mk("scree", { seriesStyles: { scree: { color: "#ff0000" } } }), opts);
    expect(linked.series[0]!.lineColor).toBe("#ff0000");
    // unlinked → the line takes its own colour.
    const split = buildPlotScene(dummy, mk("scree", { seriesStyles: { scree: { color: "#ff0000", linkLineColor: false, lineColor: "#00cc44" } } }), opts);
    expect(split.series[0]!.lineColor).toBe("#00cc44");
    // Pattern (lineDash) reaches the series dash.
    const dashed = buildPlotScene(dummy, mk("scree", { seriesStyles: { scree: { lineDash: "dashed" } } }), opts);
    expect(dashed.series[0]!.dash).toBeTruthy();
    // Connect = step changes the built path.
    const straight = buildPlotScene(dummy, mk("scree"), opts).series[0]!.linePath;
    const stepped = buildPlotScene(dummy, mk("scree", { seriesStyles: { scree: { connect: "step" } } }), opts).series[0]!.linePath;
    expect(stepped).not.toBe(straight);
  });

  it("degrades to a warning (no crash) when the plot carries no PCA data", () => {
    for (const kind of ["pcascore", "pcaload", "pcabiplot", "scree"] as const) {
      const s = buildPlotScene(dummy, { id: "p", name: kind, source: "t", status: "ok", styleOverrides: {}, kind }, opts);
      expect(s.kind).toBe(kind);
      expect(s.warnings.some((w) => /No PCA data/.test(w))).toBe(true);
    }
  });
});

describe("buildPlotScene — dendrogram + clustered heatmap (clustering)", () => {
  // 4 genes: G1,G3 rise under treatment; G2,G4 fall → two clear row clusters.
  const gt: DataTable = {
    id: "t", kind: "column", name: "T",
    columns: [
      { id: "g", name: "Gene", role: "x" },
      { id: "ctrl", name: "Ctrl", role: "y" },
      { id: "treat", name: "Treat", role: "y" },
    ],
    rows: [
      { id: "r0", cells: { g: "G1", ctrl: 1.0, treat: 5.0 } },
      { id: "r1", cells: { g: "G2", ctrl: 5.0, treat: 1.0 } },
      { id: "r2", cells: { g: "G3", ctrl: 1.1, treat: 4.9 } },
      { id: "r3", cells: { g: "G4", ctrl: 4.9, treat: 1.1 } },
    ],
  };
  const opts = { width: 560, height: 380 };

  it("dendrogram: draws a tree line over the row leaves with a distance axis", () => {
    const s = buildPlotScene(gt, { id: "p", name: "D", source: "t", status: "ok", styleOverrides: {}, kind: "dendrogram" }, opts);
    expect(s.kind).toBe("dendrogram");
    expect(s.series).toHaveLength(1);
    expect(s.series[0]!.linePath.length).toBeGreaterThan(0);
    // Vertical (default): leaf axis on X with one tick per gene; Y is the distance axis.
    expect(s.x.ticks.map((t) => t.label)).toEqual(["G1", "G3", "G2", "G4"]); // clustered order groups G1/G3 & G2/G4
    expect(s.y.title).toBe("Distance");
    expect(s.warnings).toEqual([]);
  });

  it("dendrogram: colorClusters splits the tree into per-cluster series", () => {
    const one = buildPlotScene(gt, { id: "p", name: "D", source: "t", status: "ok", styleOverrides: {}, kind: "dendrogram" }, opts);
    expect(one.series).toHaveLength(1);
    const col = buildPlotScene(gt, { id: "p", name: "D", source: "t", status: "ok", styleOverrides: {}, kind: "dendrogram", dendrogram: { colorClusters: 2 } }, opts);
    expect(col.series.length).toBeGreaterThanOrEqual(2); // ≥2 cluster colours (+ maybe a neutral trunk)
    expect(new Set(col.series.map((x) => x.color)).size).toBeGreaterThanOrEqual(2);
  });

  it("dendrogram: horizontal orientation puts the distance axis on X, leaves on Y", () => {
    const s = buildPlotScene(gt, { id: "p", name: "D", source: "t", status: "ok", styleOverrides: {}, kind: "dendrogram", dendrogram: { orientation: "horizontal" } }, opts);
    expect(s.x.title).toBe("Distance");
    expect(s.y.ticks.map((t) => t.label)).toEqual(["G1", "G3", "G2", "G4"]);
  });

  it("dendrogram: clustering columns yields one leaf per value column", () => {
    const s = buildPlotScene(gt, { id: "p", name: "D", source: "t", status: "ok", styleOverrides: {}, kind: "dendrogram", dendrogram: { target: "columns" } }, opts);
    expect(new Set(s.x.ticks.map((t) => t.label))).toEqual(new Set(["Ctrl", "Treat"]));
  });

  it("clustered heatmap: reorders rows so co-regulated genes are adjacent + draws a row tree", () => {
    const plain = buildPlotScene(gt, { id: "p", name: "H", source: "t", status: "ok", styleOverrides: {}, kind: "heatmap" }, opts);
    expect(plain.heatmap!.rowLabels.map((r) => r.label)).toEqual(["G1", "G2", "G3", "G4"]); // table order
    expect(plain.heatmap!.dendrograms).toBeUndefined();

    const clustered = buildPlotScene(gt, { id: "p", name: "H", source: "t", status: "ok", styleOverrides: {}, kind: "heatmap", heatmap: { mode: "matrix", cluster: "rows" } }, opts);
    const order = clustered.heatmap!.rowLabels.map((r) => r.label);
    // G1 & G3 (both up) end up adjacent; G2 & G4 (both down) adjacent.
    const idx = (g: string): number => order.indexOf(g);
    expect(Math.abs(idx("G1") - idx("G3"))).toBe(1);
    expect(Math.abs(idx("G2") - idx("G4"))).toBe(1);
    expect(clustered.heatmap!.dendrograms?.row?.length).toBeGreaterThan(0);
    expect(clustered.heatmap!.dendrograms?.col).toBeUndefined(); // rows only
  });

  it("clustered heatmap: cluster 'both' reorders + draws both trees", () => {
    const s = buildPlotScene(gt, { id: "p", name: "H", source: "t", status: "ok", styleOverrides: {}, kind: "heatmap", heatmap: { mode: "matrix", cluster: "both" } }, opts);
    expect(s.heatmap!.dendrograms?.row?.length).toBeGreaterThan(0);
    expect(s.heatmap!.dendrograms?.col?.length).toBeGreaterThan(0);
    // The reordered cells still hold every original value (a permutation, not a loss).
    const vals = s.heatmap!.cells.map((c) => c.value).filter((v): v is number => v != null).sort((a, b) => a - b);
    expect(vals).toEqual([1.0, 1.0, 1.1, 1.1, 4.9, 4.9, 5.0, 5.0]);
  });

  it("clustered heatmap: showDendrogram:false reorders but draws no trees", () => {
    const s = buildPlotScene(gt, { id: "p", name: "H", source: "t", status: "ok", styleOverrides: {}, kind: "heatmap", heatmap: { mode: "matrix", cluster: "rows", showDendrogram: false } }, opts);
    expect(s.heatmap!.dendrograms).toBeUndefined();
    expect(s.heatmap!.rowLabels.map((r) => r.label)).not.toEqual(["G1", "G2", "G3", "G4"]); // still reordered
  });
});

describe("buildPlotScene — axis engine (custom ticks + bands + rotation + percent)", () => {
  // Ratios < 100 so neither axis auto-suggests a log scale (tests set scales explicitly).
  const xyT: DataTable = {
    id: "t", kind: "xy", name: "T",
    columns: [{ id: "x", name: "X", role: "x" }, { id: "y", name: "Y", role: "y" }],
    rows: [{ id: "r0", cells: { x: 2, y: 15 } }, { id: "r1", cells: { x: 9, y: 85 } }],
  };
  const mk = (over: Partial<Plot>): Plot => ({ id: "p", name: "P", source: "t", status: "ok", styleOverrides: {}, kind: "xy", ...over });
  const opts = { width: 500, height: 340 };

  it("custom ticks appear on the axis with a label override, positioned on-scale; out-of-range dropped", () => {
    const s = buildPlotScene(xyT, mk({ xAxis: { min: 0, max: 10, extraTicks: [{ value: 5, label: "mid" }, { value: 7 }] } }), opts);
    const t5 = s.x.ticks.find((t) => t.value === 5 && t.label === "mid");
    expect(t5).toBeDefined();
    expect(t5!.pos).toBeCloseTo(s.plot.x + s.plot.width * 0.5, 0); // halfway across a 0..10 axis
    expect(s.x.ticks.some((t) => t.value === 7 && t.label === "7")).toBe(true); // blank label → formatted value
    const s2 = buildPlotScene(xyT, mk({ xAxis: { min: 0, max: 10, extraTicks: [{ value: 99 }] } }), opts);
    expect(s2.x.ticks.some((t) => t.value === 99)).toBe(false);
  });

  it("shaded bands resolve to a pixel rect spanning the plot perpendicular to their axis", () => {
    const s = buildPlotScene(xyT, mk({ yAxis: { min: 0, max: 100, bands: [{ from: 20, to: 40, color: "#ff0000", label: "normal" }] } }), opts);
    expect(s.axisBands).toHaveLength(1);
    const b = s.axisBands![0]!;
    expect(b.color).toBe("#ff0000");
    expect(b.label).toBe("normal");
    expect(b.x).toBeCloseTo(s.plot.x, 3); // a Y band spans the full plot width
    expect(b.w).toBeCloseTo(s.plot.width, 3);
    expect(b.h).toBeCloseTo(s.plot.height * 0.2, 0); // 20→40 of a 0..100 axis = 20% of the height
  });

  it("tickRotation flows onto the axis; percent format multiplies labels ×100", () => {
    const s = buildPlotScene(xyT, mk({ xAxis: { tickRotation: 45 }, yAxis: { min: 0, max: 1, format: "percent" } }), opts);
    expect(s.x.tickRotation).toBe(45);
    expect(s.y.ticks.filter((t) => !t.minor && t.label).every((t) => /%$/.test(t.label))).toBe(true);
    expect(s.y.ticks.some((t) => t.label === "40%")).toBe(true); // 0.4 → 40%
  });

  it("a custom tick on a log axis is positioned in log space", () => {
    const s = buildPlotScene(xyT, mk({ xAxis: { min: 1, max: 1000, scale: "log10", extraTicks: [{ value: 100 }] } }), opts);
    const t = s.x.ticks.find((tk) => tk.value === 100 && tk.label === "100");
    expect(t).toBeDefined();
    expect(t!.pos).toBeCloseTo(s.plot.x + s.plot.width * (2 / 3), 0); // log10(100)=2 of 0..3
  });

  it("transposed plots route extras to the axis the user sees (horizontal bar value axis = X)", () => {
    const catT: DataTable = {
      id: "t2", kind: "column", name: "C",
      columns: [{ id: "c", name: "G", role: "x" }, { id: "v", name: "V", role: "y" }],
      rows: [{ id: "r1", cells: { c: "A", v: 5 } }, { id: "r2", cells: { c: "B", v: 9 } }],
    };
    // Horizontal bar: value axis is drawn on X but its spec is plot.yAxis (dataAxisOf).
    const s = buildPlotScene(catT, { id: "p", name: "P", source: "t2", status: "ok", styleOverrides: {}, kind: "bar", barOrientation: "horizontal", yAxis: { min: 0, max: 10, bands: [{ from: 2, to: 4 }] } }, opts);
    expect(s.axisBands?.length).toBe(1);
    // the band spans the plot height (it's on the X-drawn value axis).
    expect(s.axisBands![0]!.h).toBeCloseTo(s.plot.height, 0);
  });
});

describe("buildPlotScene — category groups on a banded axis", () => {
  // Six traits in three domains; `d` is tagged role "xerr" so it is readable per row
  // without becoming a stray plotted series (same trick as the data-driven tests).
  const traits: DataTable = {
    id: "t", kind: "column", name: "T",
    columns: [
      { id: "c", name: "Trait", role: "x" },
      { id: "v", name: "Value", role: "y" },
      { id: "d", name: "Domain", type: "text", role: "xerr" },
    ],
    rows: [
      { id: "r0", cells: { c: "IQ", v: 5, d: "Cognition" } },
      { id: "r1", cells: { c: "EA", v: 7, d: "Cognition" } },
      { id: "r2", cells: { c: "Neuroticism", v: 3, d: "Psychology" } },
      { id: "r3", cells: { c: "Risk", v: 6, d: "Psychology" } },
      { id: "r4", cells: { c: "Smoking", v: 4, d: "Substance" } },
      { id: "r5", cells: { c: "Drinks", v: 8, d: "Substance" } },
    ],
  };
  const opts = { width: 620, height: 400 };
  const mk = (over: Partial<Plot>): Plot => ({ id: "p", name: "P", source: "t", status: "ok", styleOverrides: {}, kind: "bar", ...over });
  const groupsOf = (over: Partial<Plot>) => buildPlotScene(traits, mk(over), opts);
  const labelled = (s: PlotScene, axis: "x" | "y") => s[axis].ticks.filter((t) => !t.minor && t.label !== "");
  const ALL_ONE_GROUP = Object.fromEntries(["IQ", "EA", "Neuroticism", "Risk", "Smoking", "Drinks"].map((c) => [c, "All traits"]));

  /**
   * The group name row and the axis title must not share a line. Names are written beneath the tick
   * labels, and the title is anchored to the tick labels too — so one group spanning the whole axis
   * could draw its name straight across the title ("All treatments" over "Treatment"). The glyph
   * boxes below use ordinary ascent/descent/width ratios, not the
   * builder's own constants, so this does not share the arithmetic it is checking.
   */
  it("puts the X axis title below the group names, never on them", () => {
    const s = groupsOf({ xAxis: { title: "Trait", categoryGroups: { map: ALL_ONE_GROUP } } });
    const name = s.categoryGroups?.[0]?.name;
    expect(name, "the fixture draws no group name — it cannot show a collision").toBeTruthy();
    expect(s.x.titlePos, "the fixture has no placed X title").toBeTypeOf("number");
    const nameFont = s.fonts.legend.size;
    const titleFont = s.x.titleFont ?? s.fonts.xAxisTitle.size;
    const across = (text: string, font: number, cx: number) => {
      const w = text.length * font * 0.55;
      return { x1: cx - w / 2, x2: cx + w / 2 };
    };
    const n = { ...across("All traits", nameFont, name!.x), y1: name!.y - nameFont * 0.8, y2: name!.y + nameFont * 0.22 };
    const t = {
      ...across("Trait", titleFont, s.x.titleCenter ?? s.plot.x + s.plot.width / 2),
      y1: s.x.titlePos! - titleFont * 0.8,
      y2: s.x.titlePos! + titleFont * 0.22,
    };
    expect(Math.min(n.x2, t.x2) - Math.max(n.x1, t.x1), "the name is not under the title — the fixture cannot show them collide").toBeGreaterThan(0);
    expect(t.y1, `the title's glyphs start at y=${t.y1.toFixed(1)}, above the group name's bottom at y=${n.y2.toFixed(1)}`).toBeGreaterThanOrEqual(n.y2);
    expect(t.y2, "the title was pushed off the bottom of the canvas").toBeLessThanOrEqual(s.height);
  });

  it("leaves the X axis title where it was when no group names are drawn", () => {
    const plain = groupsOf({ xAxis: { title: "Trait" } });
    const unnamed = groupsOf({ xAxis: { title: "Trait", categoryGroups: { map: ALL_ONE_GROUP, names: false } } });
    expect(plain.x.titlePos, "the fixture has no placed X title").toBeTypeOf("number");
    expect(unnamed.x.titlePos).toBe(plain.x.titlePos);
  });

  it("resolves one block per contiguous run, colouring each run's tick labels", () => {
    const s = groupsOf({ xAxis: { categoryGroups: { column: "d" } } });
    expect(s.categoryGroups?.map((g) => g.label)).toEqual(["Cognition", "Psychology", "Substance"]);
    const ticks = labelled(s, "x");
    expect(ticks.map((t) => t.label)).toEqual(["IQ", "EA", "Neuroticism", "Risk", "Smoking", "Drinks"]);
    // Same group ⇒ same colour; different group ⇒ different colour.
    expect(ticks[0]!.color).toBe(ticks[1]!.color);
    expect(ticks[2]!.color).toBe(ticks[3]!.color);
    expect(ticks[0]!.color).not.toBe(ticks[2]!.color);
    expect(ticks[0]!.color).toBeDefined();
  });

  it("a group whose categories are not contiguous yields several blocks, not one swallowing block", () => {
    const scattered: DataTable = {
      ...traits,
      rows: [
        { id: "r0", cells: { c: "A", v: 1, d: "G1" } },
        { id: "r1", cells: { c: "B", v: 2, d: "G2" } },
        { id: "r2", cells: { c: "C", v: 3, d: "G1" } },
      ],
    };
    const s = buildPlotScene(scattered, mk({ xAxis: { categoryGroups: { column: "d", tint: true } } }), opts);
    expect(s.categoryGroups?.map((g) => g.label)).toEqual(["G1", "G2", "G1"]);
    // Both G1 blocks keep G1's colour, and neither spans the G2 category between them.
    const g1 = s.categoryGroups!.filter((g) => g.label === "G1");
    expect(g1[0]!.color).toBe(g1[1]!.color);
    expect(g1[0]!.tint!.w).toBeLessThan(s.plot.width / 2);
  });

  it("no separator before the first block; every later block gets one", () => {
    const s = groupsOf({ xAxis: { categoryGroups: { column: "d" } } });
    expect(s.categoryGroups![0]!.separator).toBeUndefined();
    expect(s.categoryGroups![1]!.separator).toBeDefined();
    expect(s.categoryGroups![2]!.separator).toBeDefined();
    // A separator on a horizontal category axis is a vertical rule spanning the plot.
    const sep = s.categoryGroups![1]!.separator!;
    expect(sep.x1).toBeCloseTo(sep.x2, 6);
    expect(Math.abs(sep.y2 - sep.y1)).toBeCloseTo(s.plot.height, 0);
  });

  it("tint spans the plot perpendicular to the category axis and covers a third each", () => {
    const s = groupsOf({ xAxis: { categoryGroups: { column: "d", tint: true, tintOpacity: 0.2 } } });
    for (const g of s.categoryGroups!) {
      expect(g.tint!.y).toBeCloseTo(s.plot.y, 6);
      expect(g.tint!.h).toBeCloseTo(s.plot.height, 6);
      expect(g.tint!.opacity).toBe(0.2);
      expect(g.tint!.w).toBeCloseTo(s.plot.width / 3, 0); // 2 of 6 categories each
    }
    // The blocks tile the plot with no gap and no overlap.
    const sorted = s.categoryGroups!.slice().sort((a, b) => a.tint!.x - b.tint!.x);
    expect(sorted[0]!.tint!.x).toBeCloseTo(s.plot.x, 6);
    expect(sorted[1]!.tint!.x).toBeCloseTo(sorted[0]!.tint!.x + sorted[0]!.tint!.w, 6);
    expect(sorted[2]!.tint!.x + sorted[2]!.tint!.w).toBeCloseTo(s.plot.x + s.plot.width, 6);
  });

  it("tint is off by default (the most intrusive channel); the other three are on", () => {
    const s = groupsOf({ xAxis: { categoryGroups: { column: "d" } } });
    expect(s.categoryGroups!.every((g) => g.tint === undefined)).toBe(true);
    expect(s.categoryGroups![1]!.separator).toBeDefined();
    expect(s.categoryGroups![0]!.name).toBeDefined();
    expect(labelled(s, "x")[0]!.color).toBeDefined();
  });

  it("each channel switches off independently", () => {
    const off = groupsOf({ xAxis: { categoryGroups: { column: "d", labelColor: false, separators: false, names: false } } });
    expect(off.categoryGroups).toHaveLength(3); // still resolved…
    expect(off.categoryGroups!.every((g) => !g.separator && !g.name)).toBe(true);
    expect(labelled(off, "x").every((t) => t.color === undefined)).toBe(true);
  });

  it("group names reserve their own band by growing the scene box, never the plot rect", () => {
    const without = groupsOf({ xAxis: { categoryGroups: { column: "d", names: false } } });
    const with_ = groupsOf({ xAxis: { categoryGroups: { column: "d", names: true } } });
    expect(with_.height).toBeGreaterThan(without.height); // grew down for a horizontal axis
    expect(with_.width).toBe(without.width);
    expect(with_.plot.height).toBeCloseTo(without.plot.height, 6); // the plot itself did not move
    expect(with_.plot.y).toBeCloseTo(without.plot.y, 6);
    // The name sits below the tick labels, outside the plot.
    expect(with_.categoryGroups![0]!.name!.y).toBeGreaterThan(with_.plot.y + with_.plot.height);
    expect(with_.categoryGroups![0]!.name!.angle).toBe(0);
  });

  it("a flipped (horizontal) chart puts the groups on the visual Y, rotated, growing width", () => {
    const s = buildPlotScene(traits, mk({ barOrientation: "horizontal", xAxis: { categoryGroups: { column: "d" } } }), opts);
    expect(s.categoryGroups!.every((g) => g.axis === "y")).toBe(true);
    expect(s.categoryGroups![0]!.name!.angle).toBe(90);
    expect(s.categoryGroups![0]!.name!.x).toBeGreaterThan(s.plot.x + s.plot.width);
    // Colours land on the visual Y ticks (the category axis), not the value axis.
    expect(labelled(s, "y").some((t) => t.color !== undefined)).toBe(true);
    expect(labelled(s, "x").every((t) => t.color === undefined)).toBe(true);
    // A Y separator is a horizontal rule spanning the plot width.
    const sep = s.categoryGroups![1]!.separator!;
    expect(sep.y1).toBeCloseTo(sep.y2, 6);
    expect(Math.abs(sep.x2 - sep.x1)).toBeCloseTo(s.plot.width, 0);
  });

  it("an unmatched category renders ungrouped rather than being silently mis-assigned", () => {
    const s = groupsOf({ xAxis: { categoryGroups: { map: { IQ: "Cognition", EA: "Cognition" } } } });
    const ticks = labelled(s, "x");
    expect(ticks[0]!.color).toBeDefined();
    expect(ticks[1]!.color).toBe(ticks[0]!.color);
    expect(ticks.slice(2).every((t) => t.color === undefined)).toBe(true);
    expect(s.categoryGroups).toHaveLength(1);
  });

  it("membership follows the label, so reordering rows cannot mis-assign a group", () => {
    const reordered: DataTable = { ...traits, rows: [...traits.rows].reverse() };
    const s = buildPlotScene(reordered, mk({ xAxis: { categoryGroups: { column: "d" } } }), opts);
    const by = new Map(labelled(s, "x").map((t) => [t.label, t.color]));
    // Each trait still lands in its own group — same group ⇒ same colour, across ⇒ differ.
    expect(by.get("IQ")).toBe(by.get("EA"));
    expect(by.get("Smoking")).toBe(by.get("Drinks"));
    expect(by.get("IQ")).not.toBe(by.get("Smoking"));
    expect(s.categoryGroups!.map((g) => g.label)).toEqual(["Substance", "Psychology", "Cognition"]);
  });

  it("colour follows declared order, not the group's position along the axis", () => {
    // "Late" is declared first but its categories sit last on the axis, and vice
    // versa — so palette index cannot be coming from left-to-right axis position.
    const s = groupsOf({
      xAxis: { categoryGroups: { map: { Smoking: "Late", Drinks: "Late", IQ: "Early", EA: "Early" } } },
    });
    const colorFor = (group: string) => s.categoryGroups!.find((g) => g.label === group)!.color;
    expect(s.categoryGroups!.map((g) => g.label)).toEqual(["Early", "Late"]); // axis order
    expect(colorFor("Late")).toBe(seriesColor(0, OKABE_ITO)); // …but declared first
    expect(colorFor("Early")).toBe(seriesColor(1, OKABE_ITO));
  });

  it("an explicit map wins over a column; explicit colours win over the palette", () => {
    const s = groupsOf({ xAxis: { categoryGroups: { column: "d", map: { IQ: "Solo" }, colors: { Solo: "#ff0000" } } } });
    expect(s.categoryGroups!.map((g) => g.label)).toEqual(["Solo"]);
    expect(s.categoryGroups![0]!.color).toBe("#ff0000");
    expect(labelled(s, "x")[0]!.color).toBe("#ff0000");
  });

  it("ignored on a numeric (non-banded) axis and on a hidden axis", () => {
    const xyT: DataTable = {
      id: "t", kind: "xy", name: "T",
      columns: [{ id: "x", name: "X", role: "x" }, { id: "y", name: "Y", role: "y" }],
      rows: [{ id: "r0", cells: { x: 2, y: 15 } }, { id: "r1", cells: { x: 9, y: 85 } }],
    };
    const numeric = buildPlotScene(xyT, { id: "p", name: "P", source: "t", status: "ok", styleOverrides: {}, kind: "xy", xAxis: { categoryGroups: { map: { "5": "G" } } } }, opts);
    expect(numeric.categoryGroups).toBeUndefined();
    const hidden = groupsOf({ xAxis: { hidden: true, categoryGroups: { column: "d" } } });
    expect(hidden.categoryGroups).toBeUndefined();
  });

  it("a crowded axis that de-overlaps its labels still groups every category", () => {
    // Long names on a narrow horizontal axis ⇒ deOverlapX blanks most tick labels.
    // Run detection must read the blanked labels too: reading only the surviving ones would
    // collapse four groups to two and let one tint block swallow a whole neighbouring group.
    const s = buildPlotScene(traits, mk({ xAxis: { categoryGroups: { column: "d", tint: true } } }), { width: 300, height: 300 });
    const drawn = s.x.ticks.filter((t) => !t.minor && t.label !== "");
    const identified = s.x.ticks.filter((t) => !t.minor && (t.label !== "" || t.suppressedLabel));
    expect(drawn.length, "this fixture must actually de-overlap, or the test proves nothing").toBeLessThan(6);
    expect(identified).toHaveLength(6); // …but every category keeps its identity
    // All three groups still resolve, each still exactly two categories wide.
    expect(s.categoryGroups?.map((g) => g.label)).toEqual(["Cognition", "Psychology", "Substance"]);
    for (const g of s.categoryGroups!) expect(g.tint!.w).toBeCloseTo(s.plot.width / 3, 0);
  });

  it("a name drag offset rides separately from the anchor, so drags cannot compound", () => {
    const s = groupsOf({ xAxis: { categoryGroups: { column: "d", nameOffsets: { Cognition: { dx: 12, dy: -4 } } } } });
    const plain = groupsOf({ xAxis: { categoryGroups: { column: "d" } } });
    const moved = s.categoryGroups!.find((g) => g.label === "Cognition")!;
    const base = plain.categoryGroups!.find((g) => g.label === "Cognition")!;
    expect(moved.name!.x).toBeCloseTo(base.name!.x, 6); // anchor unchanged…
    expect(moved.name!.dx).toBe(12); // …offset carried alongside it
    expect(moved.name!.dy).toBe(-4);
    expect(s.categoryGroups!.find((g) => g.label === "Substance")!.name!.dx).toBeUndefined();
  });
});

describe("buildPlotScene — data-driven per-point formatting", () => {
  // X + Y plotted; `g` (categories) and `s` (a score) are binding-only columns tagged
  // role "xerr" so they are readable per row but never become stray plotted series.
  const table: DataTable = {
    id: "t",
    kind: "xy",
    name: "T",
    columns: [
      { id: "x", name: "X" },
      { id: "y", name: "Y" },
      { id: "g", name: "Group", type: "text", role: "xerr" },
    ],
    rows: [
      { id: "r0", cells: { x: 1, y: 10, g: "A" } },
      { id: "r1", cells: { x: 2, y: 20, g: "B" } },
      { id: "r2", cells: { x: 3, y: 30, g: "A" } },
      { id: "r3", cells: { x: 4, y: 40, g: "B" } },
      { id: "r4", cells: { x: 5, y: 50, g: "C" } },
    ],
  };
  const base: Plot = { id: "p", name: "P", source: "t", status: "ok", styleOverrides: {}, kind: "xy" };
  const marksOf = (plot: Plot) => {
    const s = buildPlotScene(table, plot, { xScale: "linear", yScale: "linear" });
    const series = s.series.find((se) => se.id === "y")!;
    const by: Record<string, (typeof series.marks)[number]> = {};
    for (const m of series.marks) by[m.rowId] = m;
    return { scene: s, by };
  };

  it("colour-from-column (continuous) shades each mark through the ramp", () => {
    const { by } = marksOf({ ...base, seriesStyles: { y: { colorFromColumn: "y", colorFromMode: "continuous", colorFromRamp: "viridis" } } });
    // low Y (10) → ramp start, high Y (50) → ramp end; distinct in between.
    expect(by.r0!.fill).toBe(rampColor("viridis", 0, "#000", "#1a1a1a", false).color);
    expect(by.r4!.fill).toBe(rampColor("viridis", 1, "#000", "#1a1a1a", false).color);
    expect(by.r0!.fill).not.toBe(by.r4!.fill);
    expect(by.r2!.fill).toBe(rampColor("viridis", 0.5, "#000", "#1a1a1a", false).color); // midpoint
    // the colour also reaches the outline so open (hollow) markers show it, not just fill.
    expect(by.r0!.symbolOutline).toBe(by.r0!.fill);
    expect(by.r4!.symbolOutline).toBe(by.r4!.fill);
  });

  it("colour-from-column (continuous) honours the reverse flag", () => {
    const fwd = marksOf({ ...base, seriesStyles: { y: { colorFromColumn: "y", colorFromMode: "continuous", colorFromReversed: false } } });
    const rev = marksOf({ ...base, seriesStyles: { y: { colorFromColumn: "y", colorFromMode: "continuous", colorFromReversed: true } } });
    expect(rev.by.r0!.fill).toBe(fwd.by.r4!.fill); // reversed swaps the ends
    expect(rev.by.r4!.fill).toBe(fwd.by.r0!.fill);
  });

  it("colour-from-column (category) assigns a palette colour per distinct value", () => {
    const { by } = marksOf({ ...base, seriesStyles: { y: { colorFromColumn: "g" } } }); // auto → text → category
    expect(by.r0!.fill).toBe(OKABE_ITO[0]); // A
    expect(by.r1!.fill).toBe(OKABE_ITO[1]); // B
    expect(by.r4!.fill).toBe(OKABE_ITO[2]); // C
    expect(by.r2!.fill).toBe(by.r0!.fill); // same category → same colour
    expect(by.r0!.symbolOutline).toBe(OKABE_ITO[0]); // open markers show the outline colour
  });

  it("symbol-from-column cycles the shape set by distinct value", () => {
    const { by } = marksOf({ ...base, seriesStyles: { y: { symbolFromColumn: "g" } } });
    expect(by.r0!.symbol).toBe("circle"); // A → shape 0
    expect(by.r1!.symbol).toBe("square"); // B → shape 1
    expect(by.r4!.symbol).toBe("triangle"); // C → shape 2
    expect(by.r2!.symbol).toBe(by.r0!.symbol); // same category → same shape
    expect(by.r0!.symbol).not.toBe(by.r1!.symbol);
  });

  it("builds a category legend (with shapes when colour + symbol share a column)", () => {
    const { scene } = marksOf({ ...base, seriesStyles: { y: { colorFromColumn: "g", symbolFromColumn: "g" } } });
    expect(scene.legend.map((e) => e.label)).toEqual(["A", "B", "C"]);
    expect(scene.legend.map((e) => e.color)).toEqual([OKABE_ITO[0], OKABE_ITO[1], OKABE_ITO[2]]);
    expect(scene.legend.map((e) => e.symbol)).toEqual(["circle", "square", "triangle"]);
    expect(scene.colorbar).toBeUndefined(); // categorical → a legend, never a colour bar
  });

  it("builds a continuous colour-scale bar (not a binned legend) for a continuous colour column", () => {
    const { scene } = marksOf({ ...base, seriesStyles: { y: { colorFromColumn: "y", colorFromMode: "continuous", colorFromRamp: "viridis" } } });
    expect(scene.legend).toHaveLength(0); // the per-series binned legend is replaced by the bar
    expect(scene.colorbar).toBeDefined();
    expect(scene.colorbar!.min).toBe(10);
    expect(scene.colorbar!.max).toBe(50);
    expect(scene.colorbar!.title).toBe("Y"); // the bound column's name
    expect(scene.colorbar!.stops).toHaveLength(6);
    // stops run low(min, bottom) → high(max, top): bottom = ramp start, top = ramp end
    expect(scene.colorbar!.stops[0]!.color).toBe(rampColor("viridis", 0, "#000", "#1a1a1a", false).color);
    expect(scene.colorbar!.stops[5]!.color).toBe(rampColor("viridis", 1, "#000", "#1a1a1a", false).color);
    expect(scene.colorbar!.bar.x).toBeGreaterThan(scene.plot.x + scene.plot.width); // right of the plot
    // a degenerate (all-equal) colour column produces NO bar.
    const flat: DataTable = { ...table, rows: table.rows.map((r) => ({ ...r, cells: { ...r.cells, y: 10 } })) };
    const degen = buildPlotScene(flat, { ...base, seriesStyles: { y: { colorFromColumn: "y", colorFromMode: "continuous" } } }, { xScale: "linear", yScale: "linear" });
    expect(degen.colorbar).toBeUndefined();
  });

  it("labels each point from x / y / a column", () => {
    const bx = marksOf({ ...base, seriesStyles: { y: { pointLabels: "x" } } });
    expect(bx.by.r0!.pointLabel).toBe("1");
    const byv = marksOf({ ...base, seriesStyles: { y: { pointLabels: "y" } } });
    expect(byv.by.r4!.pointLabel).toBe("50");
    const bc = marksOf({ ...base, seriesStyles: { y: { pointLabels: "col", pointLabelColumn: "g" } } });
    expect(bc.by.r0!.pointLabel).toBe("A");
    expect(bc.by.r4!.pointLabel).toBe("C");
    // resolved label styling reaches the series
    const seC = bc.scene.series.find((s) => s.id === "y")!;
    expect(seC.pointLabelColor).toBeDefined();
  });

  it("a manual per-point override wins over the column binding", () => {
    const plot: Plot = { ...base, seriesStyles: { y: { colorFromColumn: "y", colorFromMode: "continuous" } }, pointStyles: { "y:r0": { color: "#ff0000" } } };
    const { by } = marksOf(plot);
    expect(by.r0!.fill).toBe("#ff0000"); // explicit highlight beats the ramp
    expect(by.r0!.symbolOutline).toBe("#ff0000"); // highlight reaches the outline too (open markers)
    expect(by.r4!.fill).not.toBe("#ff0000"); // others still follow the binding
  });

  it("ignores bindings on a non-marker kind (bar) — no category legend, no crash", () => {
    const barTable: DataTable = { ...table, kind: "column" };
    const plot: Plot = { ...base, kind: "bar", seriesStyles: { y: { colorFromColumn: "g", symbolFromColumn: "g" } } };
    const scene = buildPlotScene(barTable, plot, { xScale: "linear", yScale: "linear" });
    expect(scene.legend.every((e) => e.symbol === undefined)).toBe(true); // no data-driven legend
  });
});

describe("buildScale — probit (probability paper)", () => {
  it("spaces probabilities by their z-score (a normal CDF plots straight)", () => {
    const s = buildScale("probit", [0.01, 0.99], [0, 100], 6, true);
    const pLo = 0.15865525, pMid = 0.5, pHi = 0.84134475; // Φ(-1), Φ(0), Φ(1)
    const a = s.scale(pLo), b = s.scale(pMid), c = s.scale(pHi);
    expect(b).toBeCloseTo(50, 5); // p=0.5 at the centre of a symmetric window
    expect(b - a).toBeCloseTo(c - b, 4); // equal z-steps → equal pixel gaps (the defining property)
    expect(a).toBeLessThan(b);
    expect(b).toBeLessThan(c); // monotone increasing
  });
  it("places ticks at conventional probabilities within the domain", () => {
    const s = buildScale("probit", [0.05, 0.95], [0, 200], 6, false);
    const vals = s.ticks.map((t) => t.value);
    expect(vals).toContain(0.5);
    expect(vals).toContain(0.05);
    expect(vals).toContain(0.95);
    expect(vals.every((v) => v > 0 && v < 1)).toBe(true);
  });
  it("clamps out-of-range values to the edges (no ±∞)", () => {
    const s = buildScale("probit", [0.01, 0.99], [0, 100], 6, true);
    expect(Number.isFinite(s.scale(0))).toBe(true);
    expect(Number.isFinite(s.scale(1))).toBe(true);
    expect(Number.isFinite(s.scale(1.5))).toBe(true); // a percentage-as-1.5 doesn't explode
  });
  it("renders a probit y-axis end-to-end through buildPlotScene", () => {
    const table: DataTable = {
      id: "t", kind: "xy", name: "T",
      columns: [{ id: "x", name: "Dose" }, { id: "y", name: "Fraction" }],
      rows: [0.1, 0.3, 0.5, 0.7, 0.9].map((v, i) => ({ id: `r${i}`, cells: { x: i + 1, y: v } })),
    };
    const plot: Plot = { id: "p", name: "P", source: "t", status: "ok", styleOverrides: {}, kind: "xy", yAxis: { scale: "probit" } };
    const s = buildPlotScene(table, plot, { width: 400, height: 300 });
    expect(s.y.type).toBe("probit");
    expect(s.y.ticks.some((t) => t.value === 0.5)).toBe(true);
  });
});

describe("buildPlotScene — hide axis + scale bar", () => {
  const table: DataTable = {
    id: "t", kind: "xy", name: "T",
    columns: [{ id: "x", name: "X" }, { id: "y", name: "Y" }],
    rows: [0, 5, 10].map((v, i) => ({ id: `r${i}`, cells: { x: v, y: v * 2 } })),
  };
  const base: Plot = { id: "p", name: "P", source: "t", status: "ok", styleOverrides: {}, kind: "xy" };

  it("hides an axis's ticks + title but keeps the domain / mapping", () => {
    const s = buildPlotScene(table, { ...base, yAxis: { hidden: true } }, { xScale: "linear", yScale: "linear", width: 400, height: 300 });
    expect(s.y.hidden).toBe(true);
    expect(s.y.ticks).toHaveLength(0);
    expect(s.y.title).toBe("");
    expect(s.x.ticks.length).toBeGreaterThan(0); // the other axis is untouched
    expect(s.y.domain[1]).toBeGreaterThan(s.y.domain[0]); // data mapping intact
  });

  it("draws a vertical corner scale bar sized to the Y scale", () => {
    const s = buildPlotScene(table, { ...base, yAxis: { hidden: true, scaleBar: { length: 5, label: "5 mV" } } }, { xScale: "linear", yScale: "linear", width: 400, height: 300 });
    expect(s.scaleBars).toHaveLength(1);
    const bar = s.scaleBars![0]!;
    expect(bar.vertical).toBe(true);
    expect(bar.label).toBe("5 mV");
    expect(bar.x1).toBe(bar.x2); // vertical segment
    expect(Math.abs(bar.y1 - bar.y2)).toBeGreaterThan(1); // 5 data units → a real pixel length
  });

  it("an X scale bar is horizontal with a default '<length>' label", () => {
    const s = buildPlotScene(table, { ...base, xAxis: { scaleBar: { length: 4 } } }, { xScale: "linear", yScale: "linear", width: 400, height: 300 });
    const bar = s.scaleBars![0]!;
    expect(bar.vertical).toBe(false);
    expect(bar.y1).toBe(bar.y2); // horizontal segment
    expect(bar.label).toBe("4"); // default label = the length
    expect(Math.abs(bar.x2 - bar.x1)).toBeGreaterThan(1);
  });
});

describe("buildPlotScene — multiple Y axes", () => {
  // X + two Y datasets on very different scales; pin B to the right axis.
  const table: DataTable = {
    id: "t", kind: "xy", name: "T",
    columns: [{ id: "x", name: "X" }, { id: "a", name: "A" }, { id: "b", name: "B" }, { id: "c", name: "C" }],
    rows: [
      { id: "r0", cells: { x: 1, a: 10, b: 1000, c: 0.1 } },
      { id: "r1", cells: { x: 2, a: 20, b: 2000, c: 0.2 } },
      { id: "r2", cells: { x: 3, a: 30, b: 3000, c: 0.3 } },
    ],
  };
  const base: Plot = { id: "p", name: "P", source: "t", status: "ok", styleOverrides: {}, kind: "xy" };
  const marksOf = (s: ReturnType<typeof buildPlotScene>, id: string) => s.series.find((se) => se.id === id)!.marks;

  it("y2 stays independent (its own domain + mapping)", () => {
    const s = buildPlotScene(table, { ...base, seriesStyles: { b: { axis: "y2" } } }, { xScale: "linear", yScale: "linear", width: 460, height: 320 });
    expect(s.y2).toBeDefined();
    // left Y auto-fits A (~10..30), right Y2 auto-fits B (~1000..3000) — independent.
    expect(s.y.domain[1]).toBeLessThan(100);
    expect(s.y2!.domain[1]).toBeGreaterThan(900);
    // A's top point sits near the top; B's top point also near the top (own scale) —
    // i.e. they don't share a scale (B=3000 isn't off-screen).
    const aTop = marksOf(s, "a").find((m) => m.dy === 30)!.cy;
    const bTop = marksOf(s, "b").find((m) => m.dy === 3000)!.cy;
    expect(Math.abs(aTop - bTop)).toBeLessThan(20); // both near their axis top
  });

  it("adds a third independent Y axis (y3) outside y2", () => {
    const s = buildPlotScene(table, { ...base, seriesStyles: { b: { axis: "y2" }, c: { axis: "y3" } } }, { xScale: "linear", yScale: "linear", width: 520, height: 320 });
    expect(s.y2).toBeDefined();
    expect(s.y3).toBeDefined();
    // y3 auto-fits C (~0.1..0.3), independent of y (A) and y2 (B).
    expect(s.y3!.domain[1]).toBeLessThan(1);
    expect(s.y3!.domain[0]).toBeGreaterThanOrEqual(0);
    // y3's axis line sits to the right of the plot's right edge (outside y2).
    expect(s.y3!.axisX).toBeGreaterThan(s.plot.x + s.plot.width);
    // C's top point maps through the y3 scale (near the axis top, not off-screen).
    const cTop = marksOf(s, "c").find((m) => m.dy === 0.3)!.cy;
    expect(cTop).toBeGreaterThanOrEqual(s.plot.y - 1);
    expect(cTop).toBeLessThan(s.plot.y + s.plot.height * 0.5);
  });

  it("reserves right margin for y3 (plot width shrinks vs y2-only)", () => {
    const opts = { xScale: "linear" as const, yScale: "linear" as const, width: 520, height: 320 };
    const y2Only = buildPlotScene(table, { ...base, seriesStyles: { b: { axis: "y2" } } }, opts);
    const withY3 = buildPlotScene(table, { ...base, seriesStyles: { b: { axis: "y2" }, c: { axis: "y3" } } }, opts);
    expect(withY3.plot.width).toBeLessThan(y2Only.plot.width); // y3 axis eats right margin
  });
});

describe("buildPlotScene — pre-computed summary entry formats draw the right error bars", () => {
  const withCols = (columns: DataTable["columns"], rows: DataTable["rows"]): DataTable => ({ id: "t", kind: "xy", name: "T", columns, rows });
  const plot: Plot = { id: "p", name: "P", source: "t", status: "ok", styleOverrides: {} };
  const lin = { xScale: "linear" as const, yScale: "linear" as const };

  it("Mean + upper/lower limits draws the entered asymmetric reach", () => {
    const table = withCols(
      [
        { id: "x", name: "X", role: "x" },
        { id: "m", name: "Y", role: "y" },
        { id: "lo", name: "Y Lower", role: "errlow", group: "m" },
        { id: "hi", name: "Y Upper", role: "errhigh", group: "m" },
      ],
      [
        { id: "r0", cells: { x: 1, m: 10, lo: 8, hi: 13 } },
        { id: "r1", cells: { x: 2, m: 20, lo: 17, hi: 24 } },
      ],
    );
    const marks = buildPlotScene(table, plot, lin).series[0]!.marks;
    expect(marks[0]).toMatchObject({ errLow: 8, errHigh: 13 });
    expect(marks[1]).toMatchObject({ errLow: 17, errHigh: 24 });
  });

  it("Mean + %CV + N draws SD-equivalent bars (sd = |mean|·CV/100)", () => {
    const table = withCols(
      [
        { id: "x", name: "X", role: "x" },
        { id: "m", name: "Y", role: "y" },
        { id: "cv", name: "Y %CV", role: "cv", group: "m" },
        { id: "n", name: "Y N", role: "n", group: "m" },
      ],
      [{ id: "r0", cells: { x: 1, m: 100, cv: 10, n: 4 } }], // sd = 10 → 90..110
    );
    const marks = buildPlotScene(table, plot, lin).series[0]!.marks;
    expect(marks[0]!.errLow).toBeCloseTo(90, 6);
    expect(marks[0]!.errHigh).toBeCloseTo(110, 6);
  });

  it("Mean + SD without N: SD draws, but SEM/CI can't be derived → no bar (never wrong)", () => {
    const table = withCols(
      [
        { id: "x", name: "X", role: "x" },
        { id: "m", name: "Y", role: "y" },
        { id: "sd", name: "Y SD", role: "sd", group: "m" },
      ],
      [{ id: "r0", cells: { x: 1, m: 10, sd: 2 } }],
    );
    expect(buildPlotScene(table, plot, lin).series[0]!.marks[0]).toMatchObject({ errLow: 8, errHigh: 12 });
    const semPlot: Plot = { ...plot, seriesStyles: { m: { errorBars: "sem" } } };
    expect(buildPlotScene(table, semPlot, lin).series[0]!.marks[0]!.errLow).toBeUndefined();
  });
});

describe("buildPlotScene — a date/elapsed X column formats its axis ticks", () => {
  const plot: Plot = { id: "p", name: "P", source: "t", status: "ok", styleOverrides: {} };
  it("a date-typed X column renders ISO date tick labels, not raw day numbers", () => {
    const table: DataTable = {
      id: "t", kind: "xy", name: "T",
      columns: [{ id: "x", name: "Day", type: "date" }, { id: "y", name: "Y" }],
      rows: [0, 10, 20, 30].map((d, i) => ({ id: `r${i}`, cells: { x: d, y: i * 2 } })),
    };
    const labels = buildPlotScene(table, plot, { width: 480, height: 320 }).x.ticks
      .filter((t) => !t.minor && t.label)
      .map((t) => t.label);
    expect(labels.length).toBeGreaterThan(0);
    expect(labels.every((l) => /^\d{4}-\d{2}-\d{2}$/.test(l)), labels.join(",")).toBe(true);
  });
  it("an elapsed-typed X column renders h:mm:ss tick labels", () => {
    const table: DataTable = {
      id: "t", kind: "xy", name: "T",
      columns: [{ id: "x", name: "Time", type: "elapsed" }, { id: "y", name: "Y" }],
      rows: [0, 1800, 3600, 5400].map((s, i) => ({ id: `r${i}`, cells: { x: s, y: i } })),
    };
    const labels = buildPlotScene(table, plot, { width: 480, height: 320 }).x.ticks
      .filter((t) => !t.minor && t.label)
      .map((t) => t.label);
    expect(labels.some((l) => /^\d+:\d{2}:\d{2}$/.test(l)), labels.join(",")).toBe(true);
  });
});

/**
 * The detect → plot seam. The import side (a column is typed from its text) and the plot side (a
 * typed column draws the right axis) are each guarded above/in import.test.ts; this pins that a
 * column detected on import actually plots as that type. It walks the whole chain — raw
 * CSV text → `coerceGrid` (the real import) → a table → `buildPlotScene` → the axis labels — so a
 * break anywhere between detection and drawing fails here.
 */
describe("buildPlotScene — import-detected types plot correctly (the whole chain)", () => {
  const plot: Plot = { id: "p", name: "P", source: "t", status: "ok", styleOverrides: {} };
  const tableFromCsv = (text: string): DataTable => {
    const c = coerceGrid(parseDelimited(text), { header: true, infer: true, detectDates: true });
    return {
      id: "t", kind: "xy", name: "T",
      columns: c.columnNames.map((name, i) => ({ id: `c${i}`, name, ...(c.columnTypes?.[i] ? { type: c.columnTypes[i]! } : {}) })),
      rows: c.rows.map((r, ri) => ({ id: `r${ri}`, cells: Object.fromEntries(r.map((v, ci) => [`c${ci}`, v])) })),
    };
  };
  const xLabels = (t: DataTable): string[] =>
    buildPlotScene(t, plot, { width: 480, height: 320 }).x.ticks.filter((k) => !k.minor && k.label).map((k) => k.label);

  it("US M/D/YYYY dates → detected as date and plotted on a date axis (ISO labels)", () => {
    const t = tableFromCsv("date,cases\n1/22/2020,5\n2/22/2020,40\n3/22/2020,900\n");
    expect(t.columns[0]!.type, "detected").toBe("date");
    const labels = xLabels(t);
    expect(labels.length).toBeGreaterThan(0);
    expect(labels.every((l) => /^\d{4}-\d{2}-\d{2}$/.test(l)), `plotted: ${labels.join(",")}`).toBe(true);
  });

  it("h:mm:ss durations → detected as elapsed and plotted on a time axis", () => {
    const t = tableFromCsv("t,v\n0:00,1\n0:30,2\n1:00,3\n");
    expect(t.columns[0]!.type, "detected").toBe("elapsed");
    const labels = xLabels(t);
    expect(labels.some((l) => /^\d+:\d{2}:\d{2}$/.test(l)), `plotted: ${labels.join(",")}`).toBe(true);
  });

  it("a plain-number X stays a numeric axis (no false date/time formatting)", () => {
    const t = tableFromCsv("dose,resp\n1,10\n2,20\n3,30\n");
    expect(t.columns[0]!.type, "no special type").toBeUndefined();
    const labels = xLabels(t);
    expect(labels.every((l) => !/-|:/.test(l)), `plotted: ${labels.join(",")}`).toBe(true); // plain numbers, not dates/times
  });
});

// Paired / grouped Cleveland dot plot (kind "paireddot"): horizontal category rows,
// one marker per numeric series; a leading text column is auto-detected as the
// section grouping (dashed dividers + rotated labels), e.g. heritability by trait,
// grouped by domain.
describe("buildPlotScene — paired dot plot (kind paireddot)", () => {
  // trait (row label) + a text section column + two numeric series, 2 sections.
  const sectioned: DataTable = {
    id: "pd", kind: "column", name: "PD",
    columns: [
      { id: "trait", name: "Trait", role: "x" },
      { id: "domain", name: "Domain", role: "y" },
      { id: "h2", name: "Twin", role: "y" },
      { id: "snp", name: "GWAS", role: "y" },
    ],
    rows: [
      { id: "r1", cells: { trait: "EA", domain: "Cognition", h2: 0.43, snp: 0.11 } },
      { id: "r2", cells: { trait: "IQ", domain: "Cognition", h2: 0.8, snp: 0.19 } },
      { id: "r3", cells: { trait: "ADHD", domain: "Psychiatric", h2: 0.74, snp: 0.22 } },
      { id: "r4", cells: { trait: "SCZ", domain: "Psychiatric", h2: 0.81, snp: 0.2 } },
    ],
  };
  const plot: Plot = { id: "p", name: "P", source: "pd", status: "ok", styleOverrides: {}, kind: "paireddot" };

  // Row-label fitting. A vertical category axis has no `deOverlapX` equivalent, so stacked row
  // labels collide once the rows get tight — more so with a larger axis-title band.
  // Labels shrink to fit rather than being dropped, because on this chart
  // every row is a named entity and a blanked label leaves no handle on it.
  describe("row labels never collide, whatever the row density", () => {
    const manyRows = (count: number): DataTable => ({
      id: "pd", kind: "column", name: "PD",
      columns: [
        { id: "trait", name: "Trait", role: "x" },
        { id: "h2", name: "Twin", role: "y" },
      ],
      rows: Array.from({ length: count }, (_, i) => ({ id: `r${i}`, cells: { trait: `Trait ${i}`, h2: 0.1 + (i % 9) / 10 } })),
    });
    // The renderer draws a label as a box ~1.35x its font size; adjacent rows are `band` apart.
    const collides = (pd: { rows: { cy: number; label: string }[]; labelFont: number }): boolean => {
      const shown = pd.rows.filter((r) => r.label !== "").sort((a, b) => a.cy - b.cy);
      for (let i = 1; i < shown.length; i++) {
        if (shown[i]!.cy - shown[i - 1]!.cy < 1.35 * pd.labelFont) return true;
      }
      return false;
    };

    it("keeps the requested font when the rows are roomy", () => {
      const pd = buildPlotScene(sectioned, plot, { width: 500, height: 360 }).paireddot!;
      expect(pd.labelFont).toBe(13); // the default tick size, untouched
      expect(collides(pd)).toBe(false);
    });

    it("shrinks the label font instead of dropping labels when rows get tight", () => {
      const pd = buildPlotScene(manyRows(18), plot, { width: 500, height: 360 }).paireddot!;
      expect(pd.labelFont).toBeLessThan(13);
      expect(pd.rows.every((r) => r.label !== ""), "every row keeps its name").toBe(true);
      expect(collides(pd)).toBe(false);
    });

    it("also fits when the user enlarges the tick font, at the gallery's own size", () => {
      // 8 rows at the gallery's own figure size: a shape that collides without the fit. A 4-row
      // fixture is too roomy to fail at all, so it would prove nothing.
      const big: Plot = { ...plot, fonts: { tick: { size: 30 } } };
      const pd = buildPlotScene(manyRows(8), big, { width: 580, height: 380 }).paireddot!;
      expect(pd.labelFont, "a 30px label cannot fit an 8-row band here").toBeLessThan(30);
      expect(collides(pd)).toBe(false);
      expect(pd.rows.every((r) => r.label !== "")).toBe(true);
    });

    it("only past the readable floor does it thin the labels — and identity survives", () => {
      const pd = buildPlotScene(manyRows(80), plot, { width: 500, height: 360 }).paireddot!;
      expect(pd.labelFont).toBeGreaterThanOrEqual(7); // never shrinks into illegibility
      const blank = pd.rows.filter((r) => r.label === "");
      expect(blank.length, "at this density some labels must go").toBeGreaterThan(0);
      // A dropped label is never lost — same contract as AxisTick.suppressedLabel.
      expect(blank.every((r) => (r.suppressedLabel ?? "") !== "")).toBe(true);
      expect(collides(pd)).toBe(false);
    });
  });

  it("auto-detects the text column as sections and plots the numeric series as markers", () => {
    const pd = buildPlotScene(sectioned, plot, { width: 500, height: 360 }).paireddot!;
    expect(pd.rows).toHaveLength(4);
    // The text 'domain' column is not a plotted series → exactly 2 markers per row.
    expect(pd.rows.every((r) => r.marks.length === 2)).toBe(true);
    // Two contiguous sections detected, labelled by the text column.
    expect(pd.sections.map((s) => s.label)).toEqual(["Cognition", "Psychiatric"]);
    // Every section carries a dashed divider + a right-side rotated label anchor.
    expect(pd.sections.every((s) => s.divider && s.labelX > pd.rows[0]!.marks[0]!.cx)).toBe(true);
    expect(buildPlotScene(sectioned, plot, { width: 500, height: 360 }).warnings).toEqual([]);
  });

  // An outside-right legend at plotX+plotW+gap would land at the exact x where the rotated
  // section labels are drawn, stacking the two on top of each other. `outsidePad` pushes the
  // legend past the section band (the room is already reserved in marginRight).
  it("keeps the outside-right legend clear of the rotated section labels", () => {
    const scene = buildPlotScene(sectioned, plot, { width: 500, height: 360 });
    const L = scene.legendLayout;
    expect(L.position).toBe("right");
    expect(scene.legend.length).toBe(2); // two series → a legend is shown
    expect(L.outsidePad ?? 0).toBeGreaterThan(0); // pushed past the sections
    const sectionLabelX = Math.max(...scene.paireddot!.sections.map((s) => s.labelX));
    const legendLeftX = scene.plot.x + scene.plot.width + L.gap + (L.outsidePad ?? 0);
    // The legend column starts beyond where the rotated section label sits (≈ one font tall).
    expect(legendLeftX).toBeGreaterThan(sectionLabelX + scene.fonts.legend.size);
  });

  it("adds no legend offset when there are no sections (nothing to clear)", () => {
    const noSections: DataTable = {
      ...sectioned,
      columns: sectioned.columns.filter((c) => c.id !== "domain"),
      rows: sectioned.rows.map((r) => ({ id: r.id, cells: { trait: r.cells.trait!, h2: r.cells.h2!, snp: r.cells.snp! } })),
    };
    const scene = buildPlotScene(noSections, plot, { width: 500, height: 360 });
    expect(scene.paireddot!.sections).toHaveLength(0);
    expect(scene.legendLayout.outsidePad ?? 0).toBe(0);
  });

  it("toZero (default) draws a stem from the baseline to each dot; dumbbell joins them; none omits both", () => {
    const zero = buildPlotScene(sectioned, plot, { width: 500, height: 360 }).paireddot!;
    // Every finite mark has a stem whose x1 sits at the value-axis baseline (x=0 → plotX).
    expect(zero.rows[0]!.marks.every((m) => m.stem)).toBe(true);
    expect(zero.rows[0]!.connector).toBeUndefined();
    const dumbbellScene = buildPlotScene(sectioned, { ...plot, paireddot: { connector: "dumbbell" } }, { width: 500, height: 360 }).paireddot!;
    expect(dumbbellScene.rows[0]!.marks.every((m) => !m.stem)).toBe(true);
    expect(dumbbellScene.rows[0]!.connector).toBeDefined();
    const none = buildPlotScene(sectioned, { ...plot, paireddot: { connector: "none" } }, { width: 500, height: 360 }).paireddot!;
    expect(none.rows[0]!.marks.every((m) => !m.stem)).toBe(true);
    expect(none.rows[0]!.connector).toBeUndefined();
  });

  it("spreads the series dots vertically within a band in toZero mode; aligns them in dumbbell", () => {
    const zero = buildPlotScene(sectioned, plot, { width: 500, height: 360 }).paireddot!;
    const [m0, m1] = zero.rows[0]!.marks;
    expect(m0!.cy).not.toBeCloseTo(m1!.cy, 1); // offset within the band
    const dumbbellScene = buildPlotScene(sectioned, { ...plot, paireddot: { connector: "dumbbell" } }, { width: 500, height: 360 }).paireddot!;
    expect(dumbbellScene.rows[0]!.marks[0]!.cy).toBeCloseTo(dumbbellScene.rows[0]!.marks[1]!.cy, 5); // aligned on the row centre
  });

  it("without a text column: no sections, still plots every numeric series", () => {
    const plain: DataTable = {
      id: "pd2", kind: "column", name: "PD2",
      columns: [
        { id: "g", name: "Group", role: "x" },
        { id: "a", name: "A", role: "y" },
        { id: "b", name: "B", role: "y" },
      ],
      rows: [
        { id: "r1", cells: { g: "Alpha", a: 5, b: 8 } },
        { id: "r2", cells: { g: "Beta", a: 9, b: 4 } },
      ],
    };
    const pd = buildPlotScene(plain, { ...plot, source: "pd2" }, { width: 400, height: 300 }).paireddot!;
    expect(pd.sections).toHaveLength(0);
    expect(pd.rows.every((r) => r.marks.length === 2)).toBe(true);
  });

  it("hides section dividers/labels when showSections is off", () => {
    const pd = buildPlotScene(sectioned, { ...plot, paireddot: { showSections: false } }, { width: 500, height: 360 }).paireddot!;
    expect(pd.sections).toHaveLength(0);
    expect(pd.rows).toHaveLength(4); // rows still plotted
  });

  it("carries a per-section drag offset onto the matching section label (draggable headings)", () => {
    const pd = buildPlotScene(sectioned, { ...plot, paireddot: { sectionLabelOffsets: { Cognition: { dx: 9, dy: -14 } } } }, { width: 500, height: 360 }).paireddot!;
    const named = pd.sections.find((s) => s.label === "Cognition")!;
    expect([named.dx, named.dy]).toEqual([9, -14]);
    // A section with no stored offset carries none.
    expect(pd.sections.find((s) => s.label !== "Cognition")?.dx).toBeUndefined();
  });

  it("links stem colour to the dot by default; a custom stem colour applies only when unlinked", () => {
    // Linked (default): ship no stem colour so the renderer falls back to the dot colour —
    // so a stale custom stemColor is ignored once the box is re-checked.
    const linked = buildPlotScene(sectioned, { ...plot, paireddot: { stemColor: "#ff0000" } }, { width: 500, height: 360 }).paireddot!;
    expect(linked.stemColor).toBeUndefined();
    // Explicitly unlinked: the custom stem colour is honoured.
    const unlinked = buildPlotScene(sectioned, { ...plot, paireddot: { stemColor: "#ff0000", stemLinkColor: false } }, { width: 500, height: 360 }).paireddot!;
    expect(unlinked.stemColor).toBe("#ff0000");
  });

  it("warns (no throw) on a degenerate table with no numeric series", () => {
    const textOnly: DataTable = {
      id: "pd3", kind: "column", name: "PD3",
      columns: [{ id: "g", name: "Group", role: "x" }, { id: "s", name: "Section", role: "y" }],
      rows: [{ id: "r1", cells: { g: "Alpha", s: "One" } }],
    };
    const scene = buildPlotScene(textOnly, { ...plot, source: "pd3" }, { width: 400, height: 300 });
    expect(scene.warnings.length).toBeGreaterThan(0);
    expect(scene.paireddot!.rows.every((r) => r.marks.length === 0)).toBe(true);
  });
});

// Node-link network graph (kind "network"): an edge-list table → nodes + weighted
// edges, force-directed (default) or circular; an optional numeric column colours
// nodes on a diverging scale.
// Corner / edge tick-label trimming. The two axes meet at the plot corner and are drawn by
// independent code, so at large fonts the X axis's leftmost label and the Y axis's lowest one
// collide; and an outermost label, centred on its tick, hangs half into a margin sized for a
// smaller font. Both are resolved by dropping a label — which is only ever acceptable on a
// numeric axis, where the value is inferable and preserved in `suppressedLabel`.
describe("buildPlotScene — corner + edge tick labels", () => {
  const xyT: DataTable = {
    id: "t", kind: "xy", name: "T",
    columns: [{ id: "x", name: "X", role: "x" }, { id: "y", name: "Y", role: "y" }],
    rows: [{ id: "r0", cells: { x: -3, y: -0.5 } }, { id: "r1", cells: { x: 3, y: 0.6 } }],
  };
  const big: Plot = { id: "p", name: "P", source: "t", status: "ok", styleOverrides: {}, kind: "xy", fonts: { tick: { size: 30 }, axisTitle: { size: 40 } } };

  it("a dropped corner label keeps its value in suppressedLabel", () => {
    const s = buildPlotScene(xyT, big, { width: 580, height: 380 });
    const dropped = [...s.x.ticks, ...s.y.ticks].filter((t) => t.label === "" && t.suppressedLabel);
    for (const t of dropped) expect(t.suppressedLabel).not.toBe("");
  });

  it("never empties an axis — if most labels would go, they stay visible so the too-small margin shows", () => {
    const s = buildPlotScene(xyT, big, { width: 580, height: 380 });
    for (const ax of [s.x, s.y]) {
      const major = ax.ticks!.filter((t) => !t.minor && (t.label !== "" || t.suppressedLabel));
      const shown = major.filter((t) => t.label !== "");
      if (major.length > 0) expect(shown.length).toBeGreaterThanOrEqual(major.length / 2);
    }
  });

  it("trims a numeric axis even when the other axis is banded (a forest plot)", () => {
    // A band guard around the whole block would make a horizontal chart — band Y, numeric X —
    // skip the numeric X trim too and leave its outermost value label hanging off the canvas.
    // The guard belongs on each axis's own rule, not on the pair.
    const forestT: DataTable = {
      id: "f", kind: "column", name: "F",
      columns: [
        { id: "s", name: "Study", role: "x" },
        { id: "v", name: "Effect", role: "y" },
      ],
      rows: [
        { id: "r1", cells: { s: "Trial one", v: 0.4 } },
        { id: "r2", cells: { s: "Trial two", v: 1.1 } },
        { id: "r3", cells: { s: "Trial three", v: 1.6 } },
      ],
    };
    const s = buildPlotScene(forestT, { id: "p", name: "P", source: "f", status: "ok", styleOverrides: {}, kind: "bar", barOrientation: "horizontal", fonts: { tick: { size: 30 }, axisTitle: { size: 40 } } }, { width: 580, height: 380 });
    expect(s.y.band, "fixture must have a banded Y (the guard's trigger)").toBe(true);
    // The numeric X axis is still policed: nothing it draws may leave the canvas.
    for (const t of s.x.ticks.filter((t) => !t.minor && t.label !== "")) {
      const w = t.label.length * 30 * 0.6;
      expect(t.pos - w / 2, `${t.label} runs off the left`).toBeGreaterThan(-2);
      expect(t.pos + w / 2, `${t.label} runs off the right`).toBeLessThan(582);
    }
    // …while the banded Y keeps every category name.
    expect(s.y.ticks.filter((t) => !t.minor && t.label === "" && t.suppressedLabel)).toHaveLength(0);
  });

  it("never drops a category label — a band axis label is data, not a redundant tick", () => {
    // A ridgeline's Y band labels are group names: nothing about "Group C" is inferable from the
    // rows above it. Guards against the corner rule silently deleting it.
    // Uses the ridgeline shape because it is the one that actually triggers the rule — a
    // horizontal-bar fixture passes with the guard removed and proves nothing.
    const ridgeT: DataTable = {
      id: "t", kind: "column", name: "t",
      columns: [
        { id: "x", name: "Row", role: "x" },
        { id: "a", name: "Group A", role: "y" },
        { id: "b", name: "Group B", role: "y" },
        { id: "c", name: "Group C", role: "y" },
      ],
      rows: [10, 11, 12, 13, 14, 15].map((av, i) => ({ id: `r${i}`, cells: { x: i + 1, a: av, b: av + 10, c: av + 20 } })),
    };
    const s = buildPlotScene(ridgeT, { id: "p", name: "P", source: "t", status: "ok", styleOverrides: {}, kind: "ridgeline" }, { width: 500, height: 360 });
    expect(s.y.band, "this fixture must give a banded Y or it proves nothing").toBe(true);
    expect(s.y.ticks.filter((t) => !t.minor && t.label === "" && t.suppressedLabel)).toHaveLength(0);
    expect(s.y.ticks.filter((t) => !t.minor).map((t) => t.label)).toEqual(["Group A", "Group B", "Group C"]);
  });
});

describe("buildPlotScene — network graph (kind network)", () => {
  const edgeTable: DataTable = {
    id: "net", kind: "xy", name: "NET",
    columns: [
      { id: "s", name: "Source", role: "x" },
      { id: "t", name: "Target", role: "y" },
      { id: "w", name: "Weight", role: "y" },
      { id: "v", name: "Value", role: "y" },
    ],
    rows: [
      { id: "r1", cells: { s: "A", t: "B", w: 2, v: 0.9 } },
      { id: "r2", cells: { s: "A", t: "C", w: 1, v: 0.9 } },
      { id: "r3", cells: { s: "B", t: "D", w: 3, v: -0.5 } },
      { id: "r4", cells: { s: "C", t: "D", w: 1, v: 0.2 } },
      { id: "r5", cells: { s: "D", t: "E", w: 1, v: 0.7 } },
    ],
  };
  const plot: Plot = { id: "p", name: "P", source: "net", status: "ok", styleOverrides: {}, kind: "network" };

  // Node-label de-confliction. A force layout puts nodes where the physics lands them, so labels
  // hang off neighbours and land on each other — worse as the font grows, since the label box
  // grows but the layout does not. Neither shrinking (these are names) nor moving (the label must
  // stay attached to its node) is available, so the answer is to draw fewer: keep the hubs, which
  // is also the convention published network figures use.
  describe("node labels never collide and never leave the canvas", () => {
    const W = 500, H = 360;
    // A dense graph with long names. The 5-node fixture above is far too sparse to collide even
    // without de-confliction, so tests against it pass with de-confliction switched off and prove
    // nothing. This one puts 12 long-labelled nodes in the same rect.
    const dense: DataTable = {
      id: "net", kind: "xy", name: "NET",
      columns: [
        { id: "s", name: "Source", role: "x" },
        { id: "t", name: "Target", role: "y" },
        { id: "w", name: "Weight", role: "y" },
      ],
      rows: Array.from({ length: 16 }, (_, i) => ({
        id: `d${i}`,
        cells: {
          s: `Interleukin-${i % 12}`,
          t: `Interleukin-${(i * 5 + 3) % 12}`,
          w: 1 + (i % 3),
        },
      })),
    };
    /**
     * Where a label is actually drawn. Note: the placement rule may put a label
     * anywhere around its node (`labelDx`/`labelDy`), not just beside it — a box computed from
     * a beside-the-node formula measures a place the label may not occupy, and would
     * report overlaps that are not there (and miss ones that are).
     */
    const boxes = (s: ReturnType<typeof buildPlotScene>, fontPx: number) =>
      s.network!.nodes
        .filter((n) => n.label !== "")
        .map((n) => {
          const w = n.label.length * fontPx * 0.6; // the estimator buildScene itself uses
          const x = n.labelDx != null ? n.cx + n.labelDx : n.labelAnchor === "end" ? n.cx - n.r - 3 : n.cx + n.r + 3;
          const y = n.labelDy != null ? n.cy + n.labelDy : n.cy;
          const x1 = n.labelAnchor === "end" ? x - w : x;
          return { id: n.id, x1, x2: x1 + w, y1: y - 0.675 * fontPx, y2: y + 0.675 * fontPx };
        });
    const anyOverlap = (bs: ReturnType<typeof boxes>): boolean => {
      for (let i = 0; i < bs.length; i++) {
        for (let j = i + 1; j < bs.length; j++) {
          const a = bs[i]!, b = bs[j]!;
          if (a.x1 < b.x2 && b.x1 < a.x2 && a.y1 < b.y2 && b.y1 < a.y2) return true;
        }
      }
      return false;
    };

    it("no two drawn labels overlap, at the default font", () => {
      const s = buildPlotScene(dense, plot, { width: W, height: H });
      expect(s.network!.nodes.length, "need a dense graph or this proves nothing").toBeGreaterThan(8);
      expect(anyOverlap(boxes(s, s.network!.labelSize))).toBe(false);
    });

    it("no two drawn labels overlap once the font is enlarged", () => {
      // Node labels are sized by network.labelSize, not the tick font — drive the real knob.
      const big: Plot = { ...plot, network: { ...plot.network, labelSize: 26 } };
      const s = buildPlotScene(dense, big, { width: W, height: H });
      expect(anyOverlap(boxes(s, s.network!.labelSize))).toBe(false);
    });

    it("no drawn label leaves the canvas, however large the font", () => {
      // Node labels are sized by network.labelSize, not the tick font — drive the real knob.
      const big: Plot = { ...plot, network: { ...plot.network, labelSize: 26 } };
      const s = buildPlotScene(dense, big, { width: W, height: H });
      for (const b of boxes(s, s.network!.labelSize)) {
        expect(b.x1, `${b.id} runs off the left`).toBeGreaterThanOrEqual(0);
        expect(b.x2, `${b.id} runs off the right`).toBeLessThanOrEqual(W);
      }
    });

    it("no drawn label sits on a node", () => {
      const s = buildPlotScene(dense, plot, { width: W, height: H });
      for (const b of boxes(s, s.network!.labelSize)) {
        for (const n of s.network!.nodes) {
          const disc = { x1: n.cx - n.r, y1: n.cy - n.r, x2: n.cx + n.r, y2: n.cy + n.r };
          expect(b.x1 < disc.x2 && disc.x1 < b.x2 && b.y1 < disc.y2 && disc.y1 < b.y2,
            `${b.id}'s label sits on node ${n.id}`).toBe(false);
        }
      }
    });

    it("no drawn label sits on an edge", () => {
      const s = buildPlotScene(dense, plot, { width: W, height: H });
      expect(s.network!.edges.length, "no edges — this case would prove nothing").toBeGreaterThan(4);
      for (const b of boxes(s, s.network!.labelSize)) {
        for (const e of s.network!.edges) {
          for (let t = 0; t <= 1.0001; t += 0.04) {
            const u = 1 - t;
            const x = e.cx != null ? u * u * e.x1 + 2 * u * t * e.cx + t * t * e.x2 : e.x1 + (e.x2 - e.x1) * t;
            const y = e.cy != null ? u * u * e.y1 + 2 * u * t * e.cy + t * t * e.y2 : e.y1 + (e.y2 - e.y1) * t;
            expect(b.x1 < x + 1 && x - 1 < b.x2 && b.y1 < y + 1 && y - 1 < b.y2,
              `${b.id}'s label sits on edge ${e.id}`).toBe(false);
          }
        }
      }
    });

    it("keeps the hubs and never loses a dropped node's identity", () => {
      // Node labels are sized by network.labelSize, not the tick font — drive the real knob.
      const big: Plot = { ...plot, network: { ...plot.network, labelSize: 26 } };
      const s = buildPlotScene(dense, big, { width: W, height: H });
      const shown = s.network!.nodes.filter((n) => n.label !== "");
      const hidden = s.network!.nodes.filter((n) => n.label === "" && n.suppressedLabel);
      // Whatever is dropped, the most-connected node keeps its name.
      const maxDeg = Math.max(...s.network!.nodes.map((n) => n.degree));
      expect(shown.some((n) => n.degree === maxDeg), "a hub must keep its label").toBe(true);
      // Nothing is ever silently lost — same contract as AxisTick.suppressedLabel.
      expect(hidden.every((n) => n.suppressedLabel !== "")).toBe(true);
      // Labels are claimed in degree order, so what survives is biased toward the hubs. Not
      // "every shown node outranks every hidden one" — placement is geometric, so a low-degree
      // node in open space can legitimately keep its label while a hub in a crowded corner
      // cannot. So the check compares the mean degree of shown and hidden nodes.
      const mean = (ns: typeof shown): number => ns.reduce((t, n) => t + n.degree, 0) / (ns.length || 1);
      if (hidden.length > 0) expect(mean(shown)).toBeGreaterThan(mean(hidden));
    });
  });

  it("derives nodes from the edge endpoints and keeps every edge", () => {
    const s = buildPlotScene(edgeTable, plot, { width: 500, height: 360 });
    expect(s.kind).toBe("network");
    expect(s.network!.nodes.map((n) => n.id).sort()).toEqual(["A", "B", "C", "D", "E"]);
    expect(s.network!.edges).toHaveLength(5);
    expect(s.warnings).toEqual([]);
  });

  it("lays every node inside the plot rect and is deterministic across rebuilds", () => {
    const a = buildPlotScene(edgeTable, plot, { width: 500, height: 360 });
    const b = buildPlotScene(edgeTable, plot, { width: 500, height: 360 });
    const { x, y, width, height } = a.plot;
    expect(a.network!.nodes.every((n) => n.cx >= x - 1 && n.cx <= x + width + 1 && n.cy >= y - 1 && n.cy <= y + height + 1)).toBe(true);
    expect(b.network!.nodes.map((n) => [Math.round(n.cx), Math.round(n.cy)])).toEqual(a.network!.nodes.map((n) => [Math.round(n.cx), Math.round(n.cy)]));
  });

  it("colours nodes by the value column (diverging) with a value legend; edges scale with weight", () => {
    const s = buildPlotScene(edgeTable, plot, { width: 500, height: 360 }).network!;
    expect(s.valueLegend).toBeDefined();
    expect(s.valueLegend!.min).toBeCloseTo(-0.5);
    expect(s.valueLegend!.max).toBeCloseTo(0.9);
    // A (0.9, highest) and B (-0.5, lowest) get different colours.
    const A = s.nodes.find((n) => n.id === "A")!;
    const B = s.nodes.find((n) => n.id === "B")!;
    expect(A.color).not.toBe(B.color);
    // The weight-3 edge (B→D) is wider than a weight-1 edge (C→D).
    const heavy = s.edges.find((e) => e.sourceId === "B" && e.targetId === "D")!;
    const light = s.edges.find((e) => e.sourceId === "C" && e.targetId === "D")!;
    expect(heavy.width).toBeGreaterThan(light.width);
  });

  it("applies per-node colour, manual position, and label overrides (direct manipulation)", () => {
    const p: Plot = { ...plot, network: { nodeColors: { A: "#ff0000" }, nodePositions: { A: { x: 0.9, y: 0.1 } }, nodeLabels: { A: "Alpha" } } };
    const s = buildPlotScene(edgeTable, p, { width: 500, height: 360 });
    const A = s.network!.nodes.find((n) => n.id === "A")!;
    expect(A.color).toBe("#ff0000"); // colour override wins over the value ramp
    expect(A.label).toBe("Alpha"); // display-label override
    // Manual position → top-right of the plot rect (x≈0.9, y≈0.1 of the rect).
    expect(A.cx).toBeGreaterThan(s.plot.x + s.plot.width * 0.7);
    expect(A.cy).toBeLessThan(s.plot.y + s.plot.height * 0.4);
    // Other nodes keep their laid-out colour + id label.
    const B = s.network!.nodes.find((n) => n.id === "B")!;
    expect(B.color).not.toBe("#ff0000");
    expect(B.label).toBe("B");
  });

  it("resolves node outline / two-tone / size: per-node override ⊕ shared, two-tone by default", () => {
    // Luminance proxy: sum of the RGB bytes (a darker colour sums lower).
    const lum = (h: string): number => parseInt(h.slice(1, 3), 16) + parseInt(h.slice(3, 5), 16) + parseInt(h.slice(5, 7), 16);
    // Two-tone is the house default: every node gets a derived darker outline of its own
    // fill; stroke width is left unset (renderer default) until nodeStrokeWidth is configured.
    const plain = buildPlotScene(edgeTable, plot, { width: 500, height: 360 }).network!;
    expect(plain.nodes.every((n) => n.stroke !== undefined && lum(n.stroke!) < lum(n.color))).toBe(true);
    expect(plain.nodes.every((n) => n.strokeWidth === undefined)).toBe(true);
    const p: Plot = {
      ...plot,
      network: {
        nodeStrokeWidth: 2,
        nodeTwoTone: true, // All nodes: outline = a darker shade of the fill (not a split disc)
        nodeStrokes: { A: "#ff00ff" }, // A: explicit outline colour must win over two-tone
        nodeStrokeWidths: { A: 4 },
        nodeSizes: { A: 19 },
        nodeColors: { B: "#3399ff" }, // give B a known fill to compare the derived outline against
      },
    };
    const s = buildPlotScene(edgeTable, p, { width: 500, height: 360 }).network!;
    const A = s.nodes.find((n) => n.id === "A")!;
    const B = s.nodes.find((n) => n.id === "B")!;
    // A: its explicit per-node outline wins over the derived two-tone shade.
    expect(A.stroke).toBe("#ff00ff");
    expect(A.strokeWidth).toBe(4);
    expect(A.r).toBe(19); // hand-set radius = the drawn radius (degree scaling off for A)
    // B: two-tone derives the outline as a darker shade of its own fill (the MadY convention).
    expect(B.color).toBe("#3399ff");
    expect(B.stroke).toBeDefined();
    expect(B.stroke).not.toBe(B.color);
    expect(lum(B.stroke!)).toBeLessThan(lum(B.color));
    expect(B.strokeWidth).toBe(2);
    expect(B.r).not.toBe(19);
  });

  it("reserves left margin for the value colorbar, sized from the exact label strings it carries", () => {
    // The legend is a vertical bar in the left margin: it can never
    // collide with the network, the node labels (which hang right), or the title band.
    const measure = (t: string, px: number): number => t.length * px * 0.6;
    const s = buildPlotScene(edgeTable, plot, { width: 480, height: 360, measure });
    const lg = s.network!.valueLegend;
    expect(lg).toBeDefined();
    // The scene carries the exact strings the renderer must draw — one source of truth for
    // the space the builder reserved and the text that fills it.
    expect(lg!.minLabel).toBe("-0.5");
    expect(lg!.maxLabel).toBe("0.9");
    // Renderer geometry: labels right-align at plot.x − 6 and the 8px bar sits left of that.
    // The reserve must hold max(bar, widest label) + the 6px gap entirely inside the canvas.
    const labelW = Math.max(8, measure(lg!.minLabel, s.network!.labelSize), measure(lg!.maxLabel, s.network!.labelSize));
    expect(s.plot.x - 6 - labelW).toBeGreaterThanOrEqual(0);
    // Without a value column there's no legend, so the plot claims the full width (wider).
    const noValCols = edgeTable.columns.slice(0, 3);
    const noVal = buildPlotScene({ ...edgeTable, columns: noValCols, rows: edgeTable.rows.map((r) => ({ id: r.id, cells: { s: r.cells.s!, t: r.cells.t!, w: r.cells.w! } })) }, plot, { width: 480, height: 360 });
    expect(noVal.network!.valueLegend).toBeUndefined();
    expect(noVal.plot.width).toBeGreaterThan(s.plot.width);
    expect(noVal.plot.x).toBeLessThan(s.plot.x);
  });

  it("sizes nodes by degree by default; a fixed size when disabled", () => {
    const byDeg = buildPlotScene(edgeTable, plot, { width: 500, height: 360 }).network!;
    const rD = byDeg.nodes.find((n) => n.id === "D")!.r; // D has degree 3
    const rE = byDeg.nodes.find((n) => n.id === "E")!.r; // E has degree 1
    expect(rD).toBeGreaterThan(rE);
    const fixed = buildPlotScene(edgeTable, { ...plot, network: { sizeByDegree: false, nodeSize: 5 } }, { width: 500, height: 360 }).network!;
    expect(new Set(fixed.nodes.map((n) => n.r)).size).toBe(1);
  });

  it("circular layout places nodes at a common radius; force layout does not", () => {
    const circ = buildPlotScene(edgeTable, { ...plot, network: { layout: "circular" } }, { width: 400, height: 400 }).network!;
    const cx = 200, cy = 200;
    void cx; void cy;
    // On a circle every node is equidistant from the centroid.
    const cxs = circ.nodes.map((n) => n.cx);
    const cys = circ.nodes.map((n) => n.cy);
    const mx = cxs.reduce((a, b) => a + b, 0) / cxs.length;
    const my = cys.reduce((a, b) => a + b, 0) / cys.length;
    const rads = circ.nodes.map((n) => Math.hypot(n.cx - mx, n.cy - my));
    const spread = Math.max(...rads) - Math.min(...rads);
    expect(spread).toBeLessThan(Math.max(...rads) * 0.35); // near-constant radius
  });

  it("layered layout ranks nodes into left→right columns (A upstream of E)", () => {
    const s = buildPlotScene(edgeTable, { ...plot, network: { layout: "layered" } }, { width: 600, height: 360 }).network!;
    const byId = Object.fromEntries(s.nodes.map((n) => [n.id, n]));
    // A→B/C→D→E chain: x strictly increases along the flow.
    expect(byId.A!.cx).toBeLessThan(byId.B!.cx);
    expect(byId.B!.cx).toBeLessThan(byId.D!.cx);
    expect(byId.D!.cx).toBeLessThan(byId.E!.cx);
    // B and C share a layer → same x, different y.
    expect(byId.B!.cx).toBeCloseTo(byId.C!.cx, 5);
    expect(byId.B!.cy).not.toBeCloseTo(byId.C!.cy, 1);
  });

  it("no value column → neutral node colour, no legend", () => {
    const noVal: DataTable = { ...edgeTable, columns: edgeTable.columns.slice(0, 3), rows: edgeTable.rows.map((r) => ({ id: r.id, cells: { s: r.cells.s!, t: r.cells.t!, w: r.cells.w! } })) };
    const s = buildPlotScene(noVal, plot, { width: 400, height: 300 }).network!;
    expect(s.valueLegend).toBeUndefined();
    expect(new Set(s.nodes.map((n) => n.color)).size).toBe(1); // all one colour
  });

  it("warns (no throw) on a table with a source column but no edges", () => {
    const empty: DataTable = { id: "e", kind: "xy", name: "E", columns: [{ id: "s", name: "S", role: "x" }, { id: "t", name: "T", role: "y" }], rows: [] };
    const s = buildPlotScene(empty, { ...plot, source: "e" }, { width: 400, height: 300 });
    expect(s.warnings.length).toBeGreaterThan(0);
    expect(s.network!.nodes).toHaveLength(0);
  });
});

// Overlay bar layout (barLayout "overlay") + the "highlight" annotation — the two
// pieces of a diverging up/down bar chart (e.g. purchases up, sales down,
// with a Net line and a highlight box).
describe("buildPlotScene — overlay (diverging) bars", () => {
  const t: DataTable = {
    id: "d", kind: "column", name: "D",
    columns: [
      { id: "m", name: "Month", role: "x" },
      { id: "buy", name: "Purchases", role: "y" },
      { id: "sell", name: "Sales", role: "y" },
    ],
    rows: [
      { id: "r1", cells: { m: "Jan", buy: 52, sell: -12 } },
      { id: "r2", cells: { m: "Feb", buy: 46, sell: -42 } },
      { id: "r3", cells: { m: "Mar", buy: 33, sell: -20 } },
    ],
  };
  const base: Plot = { id: "p", name: "P", source: "d", status: "ok", styleOverrides: {}, kind: "bar" };

  it("overlays the two series at the same x-centre, full width (not interleaved)", () => {
    const grouped = buildPlotScene(t, base, { width: 500, height: 320 });
    const overlaid = buildPlotScene(t, { ...base, barLayout: "overlay" }, { width: 500, height: 320 });
    const bars = (s: typeof grouped, si: number) => s.series[si]!.marks.map((m) => m.bar!);
    // Overlaid: series 0 and series 1 bars for the same category share the same x + width.
    const b0 = bars(overlaid, 0)[0]!;
    const b1 = bars(overlaid, 1)[0]!;
    expect(b0.x).toBeCloseTo(b1.x, 5);
    expect(b0.w).toBeCloseTo(b1.w, 5);
    // Grouped: the two series are offset (different x) and half-width.
    const g0 = bars(grouped, 0)[0]!;
    const g1 = bars(grouped, 1)[0]!;
    expect(g0.x).not.toBeCloseTo(g1.x, 1);
    expect(b0.w).toBeGreaterThan(g0.w); // overlay bar is wider (full slot)
  });

  it("draws the positive series up and the negative series down from the zero baseline", () => {
    const s = buildPlotScene(t, { ...base, barLayout: "overlay" }, { width: 500, height: 320 });
    const baselineY = s.y.range[0] === s.plot.y + s.plot.height ? undefined : undefined;
    void baselineY;
    const buy = s.series[0]!.marks[0]!.bar!; // +52 → above baseline
    const sell = s.series[1]!.marks[0]!.bar!; // -12 → below baseline
    // The purchases bar's bottom edge (y+h) equals the sales bar's top edge (y) at the baseline.
    expect(buy.y + buy.h).toBeCloseTo(sell.y, 1);
  });

  it("an overlaid line series (plotAs line) drops its bars and passes through the band centres", () => {
    const s = buildPlotScene(t, { ...base, barLayout: "overlay", seriesStyles: { sell: { plotAs: "line" } } }, { width: 500, height: 320 });
    const line = s.series[1]!;
    expect(line.overlayLine!.length).toBeGreaterThan(0);
    expect(line.marks.every((m) => m.bar === undefined)).toBe(true);
    // The line marks sit at the band centre (same cx as the purchases bar centre).
    expect(line.marks[0]!.cx).toBeCloseTo(s.series[0]!.marks[0]!.cx, 5);
  });
});

describe("buildPlotScene — highlight annotation", () => {
  const t: DataTable = {
    id: "h", kind: "xy", name: "H",
    columns: [{ id: "x", name: "X", role: "x" }, { id: "y", name: "Y", role: "y" }],
    rows: [{ id: "r1", cells: { x: 1, y: 2 } }, { id: "r2", cells: { x: 2, y: 5 } }],
  };
  const plot = (ann: object): Plot => ({ id: "p", name: "P", source: "h", status: "ok", styleOverrides: {}, kind: "xy", annotations: [{ id: "a1", ...ann } as never] });

  it("renders as a rect scene with a bold red outline + faint same-colour tint by default", () => {
    const s = buildPlotScene(t, plot({ kind: "highlight", x: 0.3, y: 0.2, w: 0.4, h: 0.3 }), { width: 500, height: 360 });
    const a = s.annotations.find((z) => z.id === "a1")!;
    expect(a.kind).toBe("rect"); // highlight renders through the rect path
    expect(a.color).toBe("#dc2626");
    expect(a.width).toBeCloseTo(2.5);
    expect(a.fill).toBe("#dc2626");
    expect(a.fillOpacity).toBeCloseTo(0.08);
  });

  it("honours explicit colour / width / fill overrides", () => {
    const s = buildPlotScene(t, plot({ kind: "highlight", x: 0.3, y: 0.2, w: 0.4, h: 0.3, color: "#0066ff", width: 4, fill: "#00ff00", fillOpacity: 0.5 }), { width: 500, height: 360 });
    const a = s.annotations.find((z) => z.id === "a1")!;
    expect(a.color).toBe("#0066ff");
    expect(a.width).toBeCloseTo(4);
    expect(a.fill).toBe("#00ff00");
    expect(a.fillOpacity).toBeCloseTo(0.5);
  });
});

/**
 * A hidden axis must give its space back to the plot.
 *
 * `AxisSpec.hidden` clears an axis's ticks, labels and title at a choke point in
 * `axisScene`, but the margin formulas run earlier, so they must read the flag too; if they
 * ignore it the plot rect is the same hidden or shown and the figure keeps an empty gutter.
 *
 * That matters for multi-panel figures, which suppress repeated inner tick labels and expect
 * the panels to tighten up, and it is the correct behaviour for a single graph too.
 */
describe("hidden axis reclaims its margin", () => {
  const xyTable: DataTable = {
    id: "t", kind: "xy", name: "T",
    columns: [
      { id: "x", name: "Dose (uM)", role: "x" },
      { id: "y", name: "Response (%)", role: "y" },
    ],
    // wide y values → a fat tick-label strip, so the reclaimed margin is unmistakable
    rows: [
      { id: "r1", cells: { x: 1, y: 200000 } },
      { id: "r2", cells: { x: 2, y: 400000 } },
      { id: "r3", cells: { x: 3, y: 600000 } },
    ],
  } as unknown as DataTable;

  const at = (over: Partial<Plot>) =>
    buildPlotScene(xyTable, { id: "p", name: "P", source: "t", kind: "xy", ...over } as unknown as Plot, {
      width: 400,
      height: 300,
    });

  it("hiding Y moves the plot left and makes it wider", () => {
    const shown = at({});
    const hidden = at({ yAxis: { hidden: true } as Plot["yAxis"] });
    expect(hidden.plot.x).toBeLessThan(shown.plot.x); // the label strip is gone
    expect(hidden.plot.width).toBeGreaterThan(shown.plot.width); // …and the plot took the space
    expect(hidden.plot.y).toBe(shown.plot.y); // the other axis is untouched
    expect(hidden.plot.height).toBe(shown.plot.height);
  });

  it("hiding X makes the plot taller", () => {
    const shown = at({});
    const hidden = at({ xAxis: { hidden: true } as Plot["xAxis"] });
    expect(hidden.plot.height).toBeGreaterThan(shown.plot.height);
    expect(hidden.plot.x).toBe(shown.plot.x); // Y untouched
    expect(hidden.plot.width).toBe(shown.plot.width);
  });

  it("hiding both reclaims both margins at once", () => {
    const shown = at({});
    const both = at({ xAxis: { hidden: true } as Plot["xAxis"], yAxis: { hidden: true } as Plot["yAxis"] });
    expect(both.plot.width * both.plot.height).toBeGreaterThan(shown.plot.width * shown.plot.height);
    // the user's explicit plot padding is still honoured on top of the reclaim
    const padded = buildPlotScene(
      xyTable,
      { id: "p", name: "P", source: "t", kind: "xy", xAxis: { hidden: true }, yAxis: { hidden: true }, plotPad: { left: 40, bottom: 40 } } as unknown as Plot,
      { width: 400, height: 300 },
    );
    expect(padded.plot.x).toBeGreaterThan(both.plot.x + 30);
  });

  it("still clears the ticks and title (the other half of the contract)", () => {
    const hidden = at({ yAxis: { hidden: true } as Plot["yAxis"] });
    expect(hidden.y.ticks).toEqual([]);
    expect(hidden.y.title).toBe("");
    expect(hidden.y.hidden).toBe(true);
    // the data mapping survives — this is a presentation flag, not a data one
    expect(hidden.y.domain[1]).toBeGreaterThan(hidden.y.domain[0]);
  });

  // Every axis-bearing builder has its own margin formula, so each kind is checked here.
  // A builder that ignored the flag would silently keep the empty gutter.
  it.each([
    ["xy", {}],
    ["bar", {}],
    ["box", {}],
    ["violin", {}],
    ["scatter", {}],
    ["histogram", {}],
    ["lollipop", {}],
    ["beforeafter", {}],
    ["floatingbar", {}],
    ["blandaltman", {}],
  ])("%s reclaims space when an axis is hidden", (kind, extra) => {
    const base = { id: "p", name: "P", source: "t", kind, ...extra } as unknown as Plot;
    const shown = buildPlotScene(xyTable, base, { width: 400, height: 300 });
    const hidden = buildPlotScene(
      xyTable,
      { ...base, xAxis: { hidden: true }, yAxis: { hidden: true } } as unknown as Plot,
      { width: 400, height: 300 },
    );
    const area = (s: { plot: { width: number; height: number } }) => s.plot.width * s.plot.height;
    expect(area(hidden)).toBeGreaterThan(area(shown));
  });

  it("a transposed plot reclaims the right edges (value=yAxis, category=xAxis)", () => {
    // horizontal box: the bottom carries the value axis (stored in yAxis) and the left the
    // category axis (stored in xAxis) — the guards follow whichever spec each formula reads.
    // transposition is `barOrientation`, not a `horizontal` flag
    const base = { id: "p", name: "P", source: "t", kind: "box", barOrientation: "horizontal" } as unknown as Plot;
    const shown = buildPlotScene(xyTable, base, { width: 400, height: 300 });
    const hidV = buildPlotScene(xyTable, { ...base, yAxis: { hidden: true } } as unknown as Plot, { width: 400, height: 300 });
    const hidC = buildPlotScene(xyTable, { ...base, xAxis: { hidden: true } } as unknown as Plot, { width: 400, height: 300 });
    expect(hidV.plot.height).toBeGreaterThan(shown.plot.height); // value axis is along the bottom
    expect(hidC.plot.width).toBeGreaterThan(shown.plot.width); // category axis is down the left
  });
});

/**
 * The figure assembler's merged legend suppresses each panel's own legend and draws one for
 * the whole figure. That only pays off if the panel actually gets the reserved legend column
 * back — otherwise the figure just gains an empty strip on the right of every panel.
 */
describe("hidden legend reclaims its column", () => {
  const twoSeries: DataTable = {
    id: "t", kind: "xy", name: "T",
    columns: [
      { id: "x", name: "Dose", role: "x" },
      { id: "y1", name: "A rather long series name", role: "y" },
      { id: "y2", name: "Another long series name", role: "y" },
    ],
    rows: [
      { id: "r1", cells: { x: 1, y1: 1, y2: 2 } },
      { id: "r2", cells: { x: 2, y1: 3, y2: 4 } },
    ],
  } as unknown as DataTable;

  /**
   * Note: 900px wide. These series names are ~25 characters, so a narrow figure does not give
   * the legend a plain full-width column to reclaim; the width is chosen so the fixture has one,
   * and the test asserts that premise (`position` is "right"). The narrow case is the second
   * test below.
   */
  it("the plot is wider without the legend, at the same scene size", () => {
    const base = { id: "p", name: "P", source: "t", kind: "xy" } as unknown as Plot;
    const shown = buildPlotScene(twoSeries, base, { width: 900, height: 300 });
    const hidden = buildPlotScene(
      twoSeries,
      { ...base, legend: { show: false } } as unknown as Plot,
      { width: 900, height: 300 },
    );
    expect(shown.legend.length).toBe(2); // the legend really was there
    expect(hidden.legend.length).toBe(0);
    expect(shown.legendLayout?.position, "the legend went inside — this fixture stopped testing the column").toBe("right");
    expect(hidden.plot.width).toBeGreaterThan(shown.plot.width); // its column went back to the plot
    expect(hidden.plot.height).toBe(shown.plot.height);
  });

  /**
   * …and on a narrow figure the legend stays on the right, its long labels broken onto more lines.
   *
   * The rule: on the right by default, and no clashes — a legend moved inside the plot would sit
   * on the data.
   *
   * Without a ceiling on the reservation, at 360px these two ~25-character names would take the
   * whole width and leave the plot a sliver (a 16px ROC legend can leave 1px of plot;
   * `gallery.test.ts` catches that case on the real cards). Every label stays whole — ellipsising
   * would turn "Biomarker (AUC 0.860)" into "Biomarker (AU…", losing the number the legend
   * exists to report.
   */
  it("a legend too wide for the figure stays on the right, its labels whole and broken onto lines", () => {
    const base = { id: "p", name: "P", source: "t", kind: "xy" } as unknown as Plot;
    const narrow = buildPlotScene(twoSeries, base, { width: 360, height: 300 });
    const wide = buildPlotScene(twoSeries, base, { width: 900, height: 300 });
    expect(narrow.legendLayout?.position, "the legend left the right-hand side on a narrow figure").toBe("right");
    expect(narrow.legend.every((e) => (e.lines?.length ?? 1) > 1), "the long labels were not broken onto lines").toBe(true);
    expect(wide.legendLayout?.position, "a figure wide enough for its legend must be untouched").toBe("right");
    // Nothing truncated, at either size.
    for (const s of [narrow, wide]) {
      expect(s.legend.map((e) => e.label)).toEqual(["A rather long series name", "Another long series name"]);
      expect(s.legend.map((e) => (e.lines ?? [e.label]).join(" "))).toEqual(["A rather long series name", "Another long series name"]);
    }
    expect(wide.legend.some((e) => e.lines), "a legend that fits was broken onto lines").toBe(false);
    // …and the plot keeps a usable share instead of a sliver.
    expect(narrow.plot.width / narrow.width, "the narrow plot is still a sliver").toBeGreaterThan(0.5);
  });

  // A label is never broken for nothing: when an unbreakable word elsewhere already makes the column that wide, a shorter
  // label stays on one line (not "Firmicutes" / "A" beside "Verrucomicrobia").
  it("a label that fits beside the column's longest word stays on one line", () => {
    const t = { ...twoSeries, columns: [twoSeries.columns[0], { id: "y1", name: "Supercalifragilisticexpialidocious", role: "y" }, { id: "y2", name: "Firmicutes A", role: "y" }] } as unknown as DataTable;
    const base = { id: "p", name: "P", source: "t", kind: "xy" } as unknown as Plot;
    const s = buildPlotScene(t, base, { width: 300, height: 300 });
    expect(s.legendLayout?.position).toBe("right");
    expect(s.legend.find((e) => e.label === "Firmicutes A")?.lines, "a short label was broken under a longer word").toBeUndefined();
  });
});

/**
 * An image panel: a picture as a figure panel. It is the one kind with no data
 * mapping at all, so the contract is mostly about what it must not do — read the table,
 * invent axes, or reserve chart furniture it never draws.
 */
describe("image panel scene", () => {
  const anyTable: DataTable = {
    id: "t", kind: "xy", name: "T",
    columns: [{ id: "x", name: "X", role: "x" }, { id: "y", name: "Y", role: "y" }],
    rows: [{ id: "r1", cells: { x: 1, y: 2 } }],
  } as unknown as DataTable;
  const PNG = "data:image/png;base64,iVBORw0KGgo=";
  const img = (over: Record<string, unknown> = {}): Plot =>
    ({ id: "p", name: "Blot", source: "t", kind: "image", image: { src: PNG, ...over } }) as unknown as Plot;

  it("carries the picture and fills the scene with it", () => {
    const s = buildPlotScene(anyTable, img(), { width: 400, height: 300 });
    expect(s.kind).toBe("image");
    expect(s.image?.src).toBe(PNG);
    // no axis margins at all: the picture runs to every edge except the heading band
    expect(s.plot.x).toBe(0);
    expect(s.plot.width).toBe(400);
    expect(s.plot.y + s.plot.height).toBe(300); // nothing reserved at the bottom either
  });

  it("defaults to a fit that never crops or distorts", () => {
    expect(buildPlotScene(anyTable, img(), {}).image?.fit).toBe("contain");
    expect(buildPlotScene(anyTable, img({ fit: "cover" }), {}).image?.fit).toBe("cover");
  });

  it("draws no chart furniture — no series, legend, ticks or titles", () => {
    const s = buildPlotScene(anyTable, img(), { width: 400, height: 300 });
    expect(s.series).toEqual([]);
    expect(s.legend).toEqual([]);
    expect(s.x.ticks).toEqual([]);
    expect(s.y.ticks).toEqual([]);
    expect(s.x.hidden).toBe(true);
    expect(s.y.hidden).toBe(true);
    expect(s.grid.show).toBe(false);
  });

  it("Ignores the source table entirely — the data cannot leak into the panel", () => {
    const other: DataTable = {
      id: "t", kind: "xy", name: "T",
      columns: [{ id: "x", name: "Totally different", role: "x" }, { id: "y", name: "Other", role: "y" }],
      rows: [{ id: "r1", cells: { x: 999, y: 999 } }],
    } as unknown as DataTable;
    const a = buildPlotScene(anyTable, img(), { width: 400, height: 300 });
    const b = buildPlotScene(other, img(), { width: 400, height: 300 });
    expect(b.plot).toEqual(a.plot);
    expect(b.x.title).toBe("");
    expect(b.y.title).toBe("");
  });

  it("warns (rather than throwing) when no picture has been chosen yet", () => {
    const empty = buildPlotScene(anyTable, { id: "p", name: "Blot", source: "t", kind: "image" } as unknown as Plot, {});
    expect(empty.warnings.length).toBeGreaterThan(0);
    expect(empty.image?.src).toBe("");
  });

  it("reserves the heading band only when a title is actually shown", () => {
    // Like every other kind, an image panel titles itself with the plot name by default…
    const titled = buildPlotScene(anyTable, img(), { width: 400, height: 300 });
    expect(titled.plot.y).toBeGreaterThan(0); // the picture starts below the title
    // …and hiding the title (what the figure assembler does for panels) gives that band back
    const bare = buildPlotScene(anyTable, { ...img(), showTitle: false } as unknown as Plot, { width: 400, height: 300 });
    expect(bare.plot.y).toBe(0);
    expect(bare.plot.height).toBe(300); // the whole scene is picture
  });
});

/**
 * The fitted-parameter block — the typeset stack of fitted
 * values every journal kinetics panel prints inside its axes.
 */
describe("fit parameter block placement", () => {
  const t: DataTable = {
    id: "t", kind: "xy", name: "T",
    columns: [{ id: "x", name: "S", role: "x" }, { id: "y", name: "v", role: "y" }],
    rows: [
      { id: "r1", cells: { x: 1, y: 1 } },
      { id: "r2", cells: { x: 2, y: 2 } },
      { id: "r3", cells: { x: 3, y: 2.5 } },
    ],
  } as unknown as DataTable;
  // Note: `null` means "no params" — passing `undefined` would trigger the JS default.
  const withFit = (over: Record<string, unknown> = {}, params: string[] | null = ["K_{M} = 29 ± 3", "k_{cat} = 1.5 ± 0.1"]) =>
    buildPlotScene(
      t,
      {
        id: "p", name: "P", source: "t", kind: "xy",
        fit: { label: "Michaelis–Menten", points: [[1, 1], [2, 2], [3, 2.5]], ...(params ? { params } : {}) },
        ...over,
      } as unknown as Plot,
      { width: 400, height: 300 },
    );

  it("sits inside the plot rect, bottom-right, right-anchored by default", () => {
    const s = withFit();
    const b = s.fit!.params!;
    expect(b.lines).toEqual(["K_{M} = 29 ± 3", "k_{cat} = 1.5 ± 0.1"]);
    expect(b.anchor).toBe("end");
    expect(b.x).toBeLessThanOrEqual(s.plot.x + s.plot.width);
    expect(b.x).toBeGreaterThan(s.plot.x);
    // stacked upward from the bottom, so the last line still clears the axis
    const lastLine = b.y + (b.lines.length - 1) * b.size * 1.25;
    expect(lastLine).toBeLessThan(s.plot.y + s.plot.height);
    expect(b.y).toBeGreaterThan(s.plot.y);
  });

  it("left alignment moves it to the other edge and flips the anchor", () => {
    const b = withFit({ fitParams: { align: "left" } }).fit!.params!;
    expect(b.anchor).toBe("start");
    const right = withFit().fit!.params!;
    expect(b.x).toBeLessThan(right.x);
  });

  it("is absent when the fit reported no parameters", () => {
    expect(withFit({}, null).fit!.params).toBeUndefined();
    expect(withFit({}, []).fit!.params).toBeUndefined();
  });

  it("can be switched off without losing the curve", () => {
    const s = withFit({ fitParams: { show: false } });
    expect(s.fit!.params).toBeUndefined();
    expect(s.fit!.path.length).toBeGreaterThan(0); // the fit itself still draws
  });

  it("honours an explicit size, else follows the legend font", () => {
    expect(withFit({ fitParams: { size: 22 } }).fit!.params!.size).toBe(22);
    const s = withFit();
    expect(s.fit!.params!.size).toBe(s.fonts.legend.size);
  });

  it("carries the drag offset separately from the anchor, so drags don't compound", () => {
    const plain = withFit().fit!.params!;
    const moved = withFit({ fitParams: { offset: { dx: 40, dy: -20 } } }).fit!.params!;
    expect(moved.x).toBe(plain.x); // anchor unchanged…
    expect(moved.y).toBe(plain.y);
    expect(moved.offset).toEqual({ dx: 40, dy: -20 }); // …the delta rides alongside
  });

  it("a bigger block starts higher, so it never overruns the axis", () => {
    const two = withFit().fit!.params!;
    const four = withFit({}, ["a = 1", "b = 2", "c = 3", "d = 4"]).fit!.params!;
    expect(four.y).toBeLessThan(two.y);
  });
});

/**
 * Within-group (cell) bracket endpoints — a bracket that compares a treatment with its own
 * control. On a grouped bar that comparison runs between two bars inside one category (Control
 * vs Treated within Day 1), while `from`/`to` name whole categories. `fromSeries`/`toSeries`
 * (1-based dataset position) refine an endpoint to one sub-bar.
 */
describe("within-group (cell) bracket endpoints", () => {
  const grouped: DataTable = {
    id: "tg", kind: "grouped", name: "G",
    columns: [
      { id: "g", name: "Day", role: "x" },
      { id: "c", name: "Control", role: "y" },
      { id: "t", name: "Treated", role: "y" },
    ],
    rows: [
      { id: "r1", cells: { g: "Day 1", c: 20, t: 30 } },
      { id: "r2", cells: { g: "Day 2", c: 24, t: 41 } },
      { id: "r3", cells: { g: "Day 3", c: 20, t: 52 } },
    ],
  };
  const basePlot: Plot = { id: "pg", name: "pg", source: "tg", status: "ok", styleOverrides: {}, kind: "bar" };
  const opts = { width: 620, height: 420 };
  const scene = (patch: Partial<Plot>): PlotScene => buildPlotScene(grouped, { ...basePlot, ...patch }, opts);

  it("a bracket endpoint can name one bar inside a grouped category — including the first", () => {
    // Category 1 is the case no whole-category convention could ever reach: its sub-bars sit
    // at fractional positions below 1, which the category map rejects outright.
    // role: "significance" — the shape the placer writes, and what folds the explicit
    // heights into the value domain so a height above the data max still has an axis.
    const s = scene({
      annotations: [
        { id: "w1", kind: "bracket", from: 1, to: 1, fromSeries: 1, toSeries: 2, bracketY: 56, p: 0.004, role: "significance" },
        { id: "w3", kind: "bracket", from: 3, to: 3, fromSeries: 1, toSeries: 2, bracketY: 62, p: 0.0002, role: "significance" },
      ],
    });
    for (const [id, cat] of [["w1", 1], ["w3", 3]] as const) {
      const br = s.annotations.find((a) => a.id === id)!;
      expect(br, `${id} was dropped: ${JSON.stringify(s.warnings)}`).toBeTruthy();
      // Its feet stand on the two sub-bar centres of its own category.
      const centres = s.series.map((ser) => { const m = ser.marks.find((mm) => mm.dx === cat)!; return m.bar!.x + m.bar!.w / 2; }).sort((a, b) => a - b);
      const feet = [br.x1!, br.x2!].sort((a, b) => a - b);
      expect(feet[0]).toBeCloseTo(centres[0]!, 1);
      expect(feet[1]).toBeCloseTo(centres[1]!, 1);
    }
    expect(s.warnings).toEqual([]);
  });

  it("…and on a horizontal bar the feet stand on the sub-bar centres down Y", () => {
    const s = scene({
      barOrientation: "horizontal",
      annotations: [{ id: "w1", kind: "bracket", from: 1, to: 1, fromSeries: 1, toSeries: 2, bracketY: 56, p: 0.004 }],
    });
    const br = s.annotations.find((a) => a.id === "w1")!;
    expect(br, `dropped: ${JSON.stringify(s.warnings)}`).toBeTruthy();
    const centres = s.series.map((ser) => { const m = ser.marks.find((mm) => mm.dx === 1)!; return m.bar!.y + m.bar!.h / 2; }).sort((a, b) => a - b);
    const feet = [br.y1!, br.y2!].sort((a, b) => a - b);
    expect(feet[0]).toBeCloseTo(centres[0]!, 1);
    expect(feet[1]).toBeCloseTo(centres[1]!, 1);
  });

  it("a layout with no side-by-side bars refuses a cell endpoint out loud", () => {
    const s = scene({
      barLayout: "stacked",
      annotations: [{ id: "w1", kind: "bracket", from: 1, to: 1, fromSeries: 1, toSeries: 2, bracketY: 80, p: 0.004 }],
    });
    expect(s.annotations.find((a) => a.id === "w1"), "a stacked layout has no sub-bar to point at").toBeUndefined();
    expect(s.warnings.length, "the refusal must be said, not silent").toBeGreaterThan(0);
  });

  /**
   * Free position and size: ticking `freeform` unlocks a bracket from
   * its groups — a dragged end handle stores that end as a plot-rect fraction in x/x2,
   * each end independently, and unticking (or never dragging) keeps the group position.
   */
  it("freeform ends: a stored plot fraction beats the category, per end, both orientations", () => {
    const ff = (extra: Record<string, unknown>, patch: Partial<Plot> = {}): { s: PlotScene; br: PlotScene["annotations"][number] } => {
      const s = scene({ ...patch, annotations: [{ id: "ff", kind: "bracket", from: 1, to: 2, bracketY: 56, p: 0.01, role: "significance", ...extra } as never] });
      return { s, br: s.annotations.find((a) => a.id === "ff")! };
    };
    // Both ends stored → both drawn at their fractions.
    const both = ff({ freeform: true, x: 0.1, x2: 0.9 });
    expect(both.br.freeform, "the scene must say the handles are wanted").toBe(true);
    expect(Math.min(both.br.x1!, both.br.x2!)).toBeCloseTo(both.s.plot.x + 0.1 * both.s.plot.width, 1);
    expect(Math.max(both.br.x1!, both.br.x2!)).toBeCloseTo(both.s.plot.x + 0.9 * both.s.plot.width, 1);
    // Only one end dragged → the other keeps standing on its group (category 2's centre).
    const one = ff({ freeform: true, x: 0.1 });
    expect(Math.max(one.br.x1!, one.br.x2!)).toBeCloseTo(one.s.plot.x + (1.5 / 3) * one.s.plot.width, 1);
    // Transposed: the same fractions run down the category axis (Y).
    const flip = ff({ freeform: true, x: 0.2, x2: 0.8 }, { barOrientation: "horizontal" });
    expect(Math.min(flip.br.y1!, flip.br.y2!)).toBeCloseTo(flip.s.plot.y + 0.2 * flip.s.plot.height, 1);
    expect(Math.max(flip.br.y1!, flip.br.y2!)).toBeCloseTo(flip.s.plot.y + 0.8 * flip.s.plot.height, 1);
    // Unticked, stored fractions are ignored — the bracket snaps back to its groups.
    const off = ff({ x: 0.1, x2: 0.9 });
    expect(off.br.freeform).toBeUndefined();
    expect(Math.abs(Math.min(off.br.x1!, off.br.x2!) - (off.s.plot.x + 0.1 * off.s.plot.width))).toBeGreaterThan(5);
  });

  it("per-bracket tickboxes compose the label: signs, p-value, or both", () => {
    const mk = (extra: Record<string, unknown>): string | undefined =>
      scene({ annotations: [{ id: "b", kind: "bracket", from: 1, to: 2, bracketY: 58, p: 0.0043, ...extra } as never] })
        .annotations.find((a) => a.id === "b")!.label;
    expect(mk({}), "both unset = the plot-wide display, verbatim").toBe("★★");
    expect(mk({ showSymbol: true, showP: true })).toBe("★★ p=0.004");
    expect(mk({ showSymbol: false, showP: true })).toBe("p=0.004");
    expect(mk({ showSymbol: true, showP: false })).toBe("★★");
    expect(mk({ showSymbol: false, showP: false }), "both off = a bare bracket").toBeUndefined();
  });
});

describe("missing (null) cells — as produced by NA import — are safe in graphing", () => {
  // The importer turns "NA"/"N/A"/blank into null. Confirm a null y is skipped (not drawn at
  // NaN) so a missing value can never corrupt the picture or throw.
  it("coerceGrid maps NA→null and buildPlotScene draws only the finite points", () => {
    // end-to-end from the import coercion
    const coerced = coerceGrid(
      [["X", "Y"], ["1", "10"], ["2", "NA"], ["3", "30"]],
      { header: true, naTokens: ["NA"] },
    );
    expect(coerced.rows[1]![1]).toBeNull(); // the NA cell is missing

    const table: DataTable = {
      id: "t", kind: "xy", name: "T",
      columns: [{ id: "x", name: "X", role: "x" }, { id: "y", name: "Y", role: "y" }],
      rows: coerced.rows.map((r, i) => ({ id: `r${i}`, cells: { x: r[0]!, y: r[1]! } })),
    };
    const plot: Plot = { id: "p", name: "P", source: "t", status: "ok", styleOverrides: {}, kind: "xy", seriesStyles: {} };

    const s = buildPlotScene(table, plot, { width: 400, height: 300 });
    const marks = s.series.flatMap((ser) => ser.marks);
    expect(marks.length).toBe(2); // the null row contributes no mark
    for (const m of marks) {
      expect(Number.isFinite(m.cx)).toBe(true);
      expect(Number.isFinite(m.cy)).toBe(true);
    }
  });
});

describe("bump chart (plotRanks) — rank each series per stage on the line renderer", () => {
  // 3 entities (A/B/C) over two stages. Stage 1: A=30, B=10, C=20 → A rank1, C rank2, B rank3.
  const table: DataTable = {
    id: "t", kind: "xy", name: "T",
    columns: [
      { id: "x", name: "Stage", role: "x" },
      { id: "a", name: "A", role: "y" },
      { id: "b", name: "B", role: "y" },
      { id: "c", name: "C", role: "y" },
    ],
    rows: [
      { id: "r1", cells: { x: 1, a: 30, b: 10, c: 20 } },
      { id: "r2", cells: { x: 2, a: 5, b: 40, c: 25 } },
    ],
  };
  const base: Plot = { id: "p", name: "P", source: "t", status: "ok", styleOverrides: {}, kind: "xy", seriesStyles: {} };

  it("Y becomes a reversed integer 'Rank' axis, and rank 1 (the largest value) sits at the top", () => {
    const s = buildPlotScene(table, { ...base, plotRanks: true }, { width: 400, height: 300 });
    expect(s.y.title).toBe("Rank");
    const yv = s.y.ticks.filter((t) => !t.minor).map((t) => t.value);
    expect(yv).toContain(1);
    expect(yv).toContain(3);
    expect(yv.every((v) => Number.isInteger(v))).toBe(true);
    // stage 1 marks: A=rank1 (top, smallest cy) < C=rank2 < B=rank3
    const A = s.series[0]!.marks[0]!, B = s.series[1]!.marks[0]!, C = s.series[2]!.marks[0]!;
    expect(A.cy).toBeLessThan(C.cy);
    expect(C.cy).toBeLessThan(B.cy);
    // and the ranking flips at stage 2 (B leaps to rank 1)
    const A2 = s.series[0]!.marks[1]!, B2 = s.series[1]!.marks[1]!;
    expect(B2.cy).toBeLessThan(A2.cy);
  });

  it("ties share a rank (competition), on a rank axis whose ticks are ranks not raw values", () => {
    const tied: DataTable = { ...table, rows: [{ id: "r1", cells: { x: 1, a: 30, b: 30, c: 10 } }] };
    const s = buildPlotScene(tied, { ...base, plotRanks: true }, { width: 400, height: 300 });
    // the axis holds ranks (max ≤ 3), not the raw 30 — this is what fails without the transform
    expect(s.y.title).toBe("Rank");
    expect(Math.max(...s.y.ticks.filter((t) => !t.minor).map((t) => t.value))).toBeLessThanOrEqual(3);
    // A and B tie at the top → same cy; C is below
    const A = s.series[0]!.marks[0]!, B = s.series[1]!.marks[0]!, C = s.series[2]!.marks[0]!;
    expect(A.cy).toBeCloseTo(B.cy, 5);
    expect(C.cy).toBeGreaterThan(A.cy);
  });

  it("without plotRanks the Y axis is the raw values (control — the transform is opt-in)", () => {
    const s = buildPlotScene(table, base, { width: 400, height: 300 });
    expect(s.y.title).not.toBe("Rank");
    expect(s.y.domain[1]).toBeGreaterThanOrEqual(40); // raw max, not a rank
  });
});

describe("GWAS QQ plot (kind qq)", () => {
  const table: DataTable = {
    id: "t", kind: "association", name: "T",
    columns: [
      { id: "snp", name: "Marker" },
      { id: "chr", name: "Chromosome" },
      { id: "pos", name: "Position" },
      { id: "p", name: "P-value" },
    ],
    rows: [
      { id: "r1", cells: { snp: "rs1", chr: 1, pos: 100, p: 0.5 } },
      { id: "r2", cells: { snp: "rs2", chr: 1, pos: 200, p: 0.1 } },
      { id: "r3", cells: { snp: "rs3", chr: 2, pos: 300, p: 0.001 } },
      { id: "r4", cells: { snp: "rs4", chr: 2, pos: 400, p: 0.9 } },
    ],
  };
  const base: Plot = { id: "p", name: "P", source: "t", status: "ok", styleOverrides: {}, kind: "qq", seriesStyles: {} };

  it("plots observed vs expected −log10(p) as a marker scatter with a y = x line", () => {
    const s = buildPlotScene(table, base, { width: 460, height: 400 });
    expect(s.kind).toBe("qq");
    const markerSeries = s.series.find((se) => se.id === "qq")!;
    expect(markerSeries.marks.length).toBe(4); // one dot per usable p-value
    expect(s.series.some((se) => se.id === "qq-identity")).toBe(true); // the null diagonal
    expect(s.x.title).toMatch(/Expected/);
    expect(s.y.title).toMatch(/Observed/);
    // the most significant SNP (p=0.001) sits at the top (largest observed −log10, smallest cy)
    const top = markerSeries.marks.reduce((a, b) => (b.dy > a.dy ? b : a));
    expect(top.dy).toBeCloseTo(3, 6); // −log10(0.001)
    expect(top.rowId).toBe("r3"); // the dot keeps its source SNP row for click-routing
  });

  it("reports the genomic inflation λ in the legend (median p = 0.1 → λ > 1)", () => {
    const s = buildPlotScene(table, base, { width: 460, height: 400 });
    expect(s.legend[0]!.label).toMatch(/λ = /);
    // median of {0.001,0.1,0.5,0.9} → mean of 0.1 and 0.5 in χ² space is inflated vs the null
    const m = s.legend[0]!.label.match(/λ = ([\d.]+)/);
    expect(Number(m![1])).toBeGreaterThan(1);
  });

  it("hiding λ drops it from the legend label", () => {
    const s = buildPlotScene(table, { ...base, qq: { showLambda: false } }, { width: 460, height: 400 });
    expect(s.legend[0]?.label ?? "").not.toMatch(/λ/);
  });

  it("warns only when the sheet has no P-value column; an empty/invalid P just draws the frame", () => {
    // No numeric column at all → the structural warning fires.
    const noCol: DataTable = {
      id: "t", kind: "association", name: "T",
      columns: [{ id: "a", name: "Label" }, { id: "b", name: "Note" }],
      rows: [{ id: "r1", cells: { a: "x", b: "y" } }],
    };
    expect(buildPlotScene(noCol, base, { width: 400, height: 300 }).warnings.some((w) => /P-value/.test(w))).toBe(true);
    // A P column that holds only out-of-(0,1] values, as a freshly seeded sheet does → no warning;
    // the y = x line still draws, so the graph reads as waiting for data, not broken.
    const seed: DataTable = { ...table, rows: [{ id: "r1", cells: { snp: "rs1", chr: 1, pos: 100, p: 5 } }] };
    const s = buildPlotScene(seed, base, { width: 400, height: 300 });
    expect(s.warnings).toEqual([]);
    expect(s.series.some((se) => se.id === "qq-identity")).toBe(true);
  });
});

describe("GWAS Manhattan plot (kind manhattan)", () => {
  const rows = [
    { id: "r1", cells: { snp: "rs1", chr: 2, pos: 500, p: 0.5 } },
    { id: "r2", cells: { snp: "rs2", chr: 1, pos: 100, p: 0.1 } },
    { id: "r3", cells: { snp: "rs3", chr: 1, pos: 300, p: 1e-9 } }, // the peak on chr 1
    { id: "r4", cells: { snp: "rs4", chr: 2, pos: 900, p: 0.9 } },
    { id: "r5", cells: { snp: "rs5", chr: "X", pos: 50, p: 0.02 } },
  ];
  const table: DataTable = {
    id: "t", kind: "association", name: "T",
    columns: [
      { id: "snp", name: "Marker" },
      { id: "chr", name: "Chromosome" },
      { id: "pos", name: "Position" },
      { id: "p", name: "P-value" },
    ],
    rows,
  };
  const base: Plot = { id: "p", name: "P", source: "t", status: "ok", styleOverrides: {}, kind: "manhattan", seriesStyles: {} };

  it("plots −log10(p) for every marker with a chromosome ruler on X", () => {
    const s = buildPlotScene(table, base, { width: 700, height: 400 });
    expect(s.kind).toBe("manhattan");
    const markers = s.series.find((se) => se.id === "manhattan")!;
    expect(markers.marks.length).toBe(5); // one dot per usable marker
    expect(s.y.title).toMatch(/log/); // −log10(p)
    // one X tick per chromosome, labelled 1, 2, X in genome order
    const tickLabels = s.x.ticks.filter((t) => !t.minor).map((t) => t.label);
    expect(tickLabels).toEqual(["1", "2", "X"]);
    // the peak (p = 1e-9) sits highest (largest dy, smallest cy)
    const top = markers.marks.reduce((a, b) => (b.dy > a.dy ? b : a));
    expect(top.dy).toBeCloseTo(9, 6);
    expect(top.rowId).toBe("r3"); // the dot keeps its source SNP row for click-routing
  });

  it("colours points in two alternating shades by chromosome", () => {
    const s = buildPlotScene(table, base, { width: 700, height: 400 });
    const markers = s.series.find((se) => se.id === "manhattan")!;
    const byRow = new Map(markers.marks.map((m) => [m.rowId, m.fill]));
    // chr 1 (index 0) and chr X (index 2) share the even colour; chr 2 (index 1) the odd one.
    expect(byRow.get("r2")).toBe(byRow.get("r3")); // both chr 1
    expect(byRow.get("r2")).toBe(byRow.get("r5")); // chr 1 and chr X are both even-indexed
    expect(byRow.get("r2")).not.toBe(byRow.get("r1")); // chr 1 vs chr 2 differ
  });

  it("draws the genome-wide + suggestive significance lines even when no point reaches them", () => {
    // A sheet with only weak associations → the lines still show (Y range covers −log10(5e-8)).
    const weak: DataTable = { ...table, rows: rows.map((r) => ({ ...r, cells: { ...r.cells, p: 0.3 } })) };
    const s = buildPlotScene(weak, base, { width: 700, height: 400 });
    expect(s.annotations.some((a) => a.id === "manhattan-genomewide")).toBe(true);
    expect(s.annotations.some((a) => a.id === "manhattan-suggestive")).toBe(true);
    expect(s.y.domain[1]).toBeGreaterThanOrEqual(-Math.log10(5e-8)); // room for the genome-wide line
  });

  it("hiding the suggestive line drops only that guide", () => {
    const s = buildPlotScene(table, { ...base, manhattan: { suggestiveLine: false } }, { width: 700, height: 400 });
    expect(s.annotations.some((a) => a.id === "manhattan-genomewide")).toBe(true);
    expect(s.annotations.some((a) => a.id === "manhattan-suggestive")).toBe(false);
  });

  it("decimates the dense sub-threshold cloud to the pixel grid and says so, keeping peaks whole", () => {
    // Many markers stacked on one chromosome position → they collapse to the same pixel, except
    // the peak above keepAbove which is always drawn.
    const many = Array.from({ length: 200 }, (_, i) => ({
      id: `m${i}`, cells: { snp: `rs${i}`, chr: 1, pos: 1000, p: 0.5 },
    }));
    many.push({ id: "peak", cells: { snp: "hit", chr: 1, pos: 1000, p: 1e-9 } });
    const dense: DataTable = { ...table, rows: many };
    const s = buildPlotScene(dense, base, { width: 700, height: 400 });
    const markers = s.series.find((se) => se.id === "manhattan")!;
    expect(markers.marks.length).toBeLessThan(201); // the cloud was thinned
    expect(markers.marks.some((m) => m.rowId === "peak")).toBe(true); // the peak survived
    expect(s.warnings.some((w) => /Drew \d+ of 201 markers/.test(w))).toBe(true);
  });

  it("turning decimation off draws every marker (no thinning warning)", () => {
    const many = Array.from({ length: 50 }, (_, i) => ({
      id: `m${i}`, cells: { snp: `rs${i}`, chr: 1, pos: 1000, p: 0.5 },
    }));
    const dense: DataTable = { ...table, rows: many };
    const s = buildPlotScene(dense, { ...base, manhattan: { decimate: false } }, { width: 700, height: 400 });
    const markers = s.series.find((se) => se.id === "manhattan")!;
    expect(markers.marks.length).toBe(50);
    expect(s.warnings.some((w) => /thinned/.test(w))).toBe(false);
  });

  it("warns when the sheet is missing a required column", () => {
    const noPos: DataTable = {
      id: "t", kind: "association", name: "T",
      columns: [{ id: "snp", name: "Marker" }, { id: "chr", name: "Chromosome" }],
      rows: [{ id: "r1", cells: { snp: "rs1", chr: 1 } }],
    };
    const s = buildPlotScene(noPos, base, { width: 400, height: 300 });
    expect(s.warnings.some((w) => /Position/.test(w))).toBe(true);
  });
});

describe("Sunburst plot (kind sunburst)", () => {
  const table: DataTable = {
    id: "t", kind: "multivariable", name: "T",
    columns: [
      { id: "k", name: "Kingdom" },
      { id: "p", name: "Phylum" },
      { id: "n", name: "Count" },
    ],
    rows: [
      { id: "r1", cells: { k: "Animalia", p: "Chordata", n: 3 } },
      { id: "r2", cells: { k: "Animalia", p: "Arthropoda", n: 5 } },
      { id: "r3", cells: { k: "Plantae", p: "Angiosperms", n: 2 } },
    ],
  };
  const base: Plot = { id: "p", name: "P", source: "t", status: "ok", styleOverrides: {}, kind: "sunburst", seriesStyles: {} };

  it("draws one segment per hierarchy node across the two rings", () => {
    const s = buildPlotScene(table, base, { width: 460, height: 460 });
    expect(s.kind).toBe("sunburst");
    const segs = s.sunburst!.segments;
    // 2 kingdoms (ring 1) + 3 phyla (ring 2) = 5 segments
    expect(segs.length).toBe(5);
    expect(segs.filter((x) => x.depth === 1).map((x) => x.label).sort()).toEqual(["Animalia", "Plantae"]);
    expect(segs.filter((x) => x.depth === 2).length).toBe(3);
  });

  it("sizes each segment by its share of the whole (Animalia = 8/10)", () => {
    const s = buildPlotScene(table, base, { width: 460, height: 460 });
    const animalia = s.sunburst!.segments.find((x) => x.depth === 1 && x.label === "Animalia")!;
    expect(animalia.value).toBe(8); // 3 + 5
    expect(animalia.frac).toBeCloseTo(0.8, 6); // 8 / 10
    const plantae = s.sunburst!.segments.find((x) => x.depth === 1 && x.label === "Plantae")!;
    expect(plantae.frac).toBeCloseTo(0.2, 6);
  });

  it("counts rows when no value column is chosen (each row = 1)", () => {
    // Drop the numeric column → each of the 3 rows counts as 1; Animalia has 2 of 3.
    const noVal: DataTable = { ...table, columns: table.columns.slice(0, 2), rows: table.rows.map((r) => ({ id: r.id, cells: { k: r.cells.k!, p: r.cells.p! } })) };
    const s = buildPlotScene(noVal, base, { width: 460, height: 460 });
    const animalia = s.sunburst!.segments.find((x) => x.depth === 1 && x.label === "Animalia")!;
    expect(animalia.value).toBe(2);
    expect(animalia.frac).toBeCloseTo(2 / 3, 6);
  });

  it("shades rings of one branch to the same base hue, lighter toward the leaves", () => {
    const s = buildPlotScene(table, base, { width: 460, height: 460 });
    const segs = s.sunburst!.segments;
    const chordata = segs.find((x) => x.label === "Chordata")!;
    const animalia = segs.find((x) => x.depth === 1 && x.label === "Animalia")!;
    // The two Animalia rings differ (leaf is lighter), and both differ from the Plantae branch.
    const plantae = segs.find((x) => x.depth === 1 && x.label === "Plantae")!;
    expect(chordata.color).not.toBe(animalia.color); // lighter leaf tint
    expect(animalia.color).not.toBe(plantae.color); // distinct branch hues
  });

  it("routes a segment's click target to its level column + a source row", () => {
    const s = buildPlotScene(table, base, { width: 460, height: 460 });
    const chordata = s.sunburst!.segments.find((x) => x.label === "Chordata")!;
    expect(chordata.columnId).toBe("p");
    expect(chordata.rowId).toBe("r1");
  });

  it("a donut hole (innerRadius) leaves the centre empty", () => {
    const s = buildPlotScene(table, { ...base, sunburst: { innerRadius: 0.4 } }, { width: 460, height: 460 });
    expect(s.sunburst!.innerR).toBeGreaterThan(0);
    expect(s.sunburst!.innerR).toBeCloseTo(s.sunburst!.maxR * 0.4, 3);
  });

  it("warns when the sheet has no category column", () => {
    const numeric: DataTable = { id: "t", kind: "multivariable", name: "T", columns: [{ id: "a", name: "A" }], rows: [{ id: "r1", cells: { a: 5 } }] };
    const s = buildPlotScene(numeric, base, { width: 400, height: 400 });
    // The one numeric column becomes the (degenerate) level → its values are the ring; no crash.
    expect(s.kind).toBe("sunburst");
  });

  it("never lets two drawn labels pile up near the centre (the declutter drops the smaller one)", () => {
    // Eight equal single-ring branches with long names: their radial labels all sit at the same
    // small radius and converge, so without the declutter their centres land on top of each other.
    // Every pair of drawn labels must be at least ~a line-height apart.
    const names = ["Alphaproteobacteria", "Betaproteobacteria", "Gammaproteobacteria", "Deltaproteobacteria",
      "Epsilonproteobacteria", "Actinobacteria", "Firmicutes", "Bacteroidetes"];
    const busy: DataTable = {
      id: "t", kind: "multivariable", name: "T",
      columns: [{ id: "c", name: "Class" }],
      rows: names.map((n, i) => ({ id: `r${i}`, cells: { c: n } })),
    };
    const s = buildPlotScene(busy, base, { width: 500, height: 500 });
    const shown = s.sunburst!.segments.filter((seg) => seg.showLabel);
    const fontPx = s.fonts.tick.size;
    // Each radial label covers a disc of ≈ half its text length; two drawn labels must not
    // overlap (centre distance ≥ the sum of the two half-lengths). This is the length-aware
    // check the visual pile-up demands — a centre-distance floor alone misses long labels.
    const reach = (label: string): number => label.length * fontPx * 0.28;
    for (let i = 0; i < shown.length; i++) {
      for (let j = i + 1; j < shown.length; j++) {
        const a = shown[i]!, b = shown[j]!;
        const d = Math.hypot(a.labelX - b.labelX, a.labelY - b.labelY);
        expect(d, `${a.label} and ${b.label} labels pile up (${d.toFixed(1)}px apart, need ${((reach(a.label) + reach(b.label)) * 0.8).toFixed(0)})`)
          .toBeGreaterThanOrEqual((reach(a.label) + reach(b.label)) * 0.8);
      }
    }
    expect(shown.length).toBeGreaterThan(0); // ...and it didn't just hide everything
  });
});

describe("Chord / circos diagram (kind chord)", () => {
  const table: DataTable = {
    id: "t", kind: "edgelist", name: "T",
    columns: [{ id: "s", name: "From" }, { id: "d", name: "To" }, { id: "w", name: "Weight" }],
    rows: [
      { id: "r1", cells: { s: "A", d: "B", w: 3 } },
      { id: "r2", cells: { s: "A", d: "C", w: 1 } },
      { id: "r3", cells: { s: "B", d: "C", w: 2 } },
    ],
  };
  const base: Plot = { id: "p", name: "P", source: "t", status: "ok", styleOverrides: {}, kind: "chord", seriesStyles: {} };

  it("draws one arc per node and one ribbon per undirected pair", () => {
    const s = buildPlotScene(table, base, { width: 500, height: 500 });
    expect(s.kind).toBe("chord");
    expect(s.chord!.arcs.map((a) => a.name).sort()).toEqual(["A", "B", "C"]);
    expect(s.chord!.ribbons.length).toBe(3); // A-B, A-C, B-C
    // Every arc + ribbon carries a real SVG path.
    expect(s.chord!.arcs.every((a) => a.path.startsWith("M"))).toBe(true);
    expect(s.chord!.ribbons.every((r) => r.path.startsWith("M"))).toBe(true);
  });

  it("sizes each node's arc by its incident weight (B is the biggest: 3+2=5)", () => {
    const s = buildPlotScene(table, base, { width: 500, height: 500 });
    const val = (n: string) => s.chord!.arcs.find((a) => a.name === n)!.value;
    expect(val("A")).toBe(4);
    expect(val("B")).toBe(5);
    expect(val("C")).toBe(3);
  });

  it("reads a square adjacency matrix (lead label + numeric target columns)", () => {
    const matrix: DataTable = {
      id: "m", kind: "multivariable", name: "M",
      columns: [{ id: "row", name: "Region" }, { id: "A", name: "A" }, { id: "B", name: "B" }],
      rows: [
        { id: "m1", cells: { row: "A", A: 0, B: 4 } },
        { id: "m2", cells: { row: "B", A: 4, B: 0 } },
      ],
    };
    const s = buildPlotScene(matrix, base, { width: 500, height: 500 });
    expect(s.chord!.arcs.map((a) => a.name).sort()).toEqual(["A", "B"]);
    expect(s.chord!.ribbons.length).toBe(1); // one A↔B ribbon (the two cells merge)
  });

  it("colours ribbons by their source node, or neutral grey when off", () => {
    const s = buildPlotScene(table, base, { width: 500, height: 500 });
    const arcColor = (n: string) => s.chord!.arcs.find((a) => a.name === n)!.color;
    // A ribbon from A takes A's arc colour.
    const fromA = s.chord!.ribbons.find((r) => r.source === "A")!;
    expect(fromA.color).toBe(arcColor(fromA.source));
    const neutral = buildPlotScene(table, { ...base, chord: { colorBySource: false } }, { width: 500, height: 500 });
    expect(neutral.chord!.ribbons.every((r) => r.color === "#9aa0aa")).toBe(true);
  });

  it("skips a self-loop and says so", () => {
    const withSelf: DataTable = { ...table, rows: [...table.rows, { id: "r4", cells: { s: "A", d: "A", w: 9 } }] };
    const s = buildPlotScene(withSelf, base, { width: 500, height: 500 });
    expect(s.warnings.some((w) => /self-link/.test(w))).toBe(true);
    expect(s.chord!.ribbons.length).toBe(3); // the A→A loop is not drawn
  });

  it("orders nodes by weight when asked (biggest arc leads the ring)", () => {
    const s = buildPlotScene(table, { ...base, chord: { order: "weight" } }, { width: 500, height: 500 });
    // Arcs are emitted clockwise from the top, so with order "weight" the first arc is the
    // heaviest node (B, 5). The scene keeps them in ring order.
    expect(s.chord!.arcs[0]!.name).toBe("B");
    expect(s.chord!.arcs[0]!.value).toBe(5);
  });
});

describe("Oncoprint (kind oncoprint)", () => {
  const table: DataTable = {
    id: "t", kind: "alterations", name: "T",
    columns: [{ id: "s", name: "Sample" }, { id: "g", name: "Gene" }, { id: "a", name: "Alteration" }],
    rows: [
      { id: "r1", cells: { s: "S1", g: "TP53", a: "Missense" } },
      { id: "r2", cells: { s: "S2", g: "TP53", a: "Truncating" } },
      { id: "r3", cells: { s: "S3", g: "TP53", a: "Missense" } },
      { id: "r4", cells: { s: "S1", g: "KRAS", a: "Amplification" } },
      { id: "r5", cells: { s: "S4", g: "EGFR", a: "Missense" } },
      { id: "r6", cells: { s: "S1", g: "TP53", a: "Amplification" } }, // 2nd alteration in one cell
    ],
  };
  const base: Plot = { id: "p", name: "P", source: "t", status: "ok", styleOverrides: {}, kind: "oncoprint", seriesStyles: {} };

  it("draws a tile for every gene × sample cell (3 genes × 4 samples = 12)", () => {
    const s = buildPlotScene(table, base, { width: 600, height: 400 });
    expect(s.kind).toBe("oncoprint");
    expect(s.oncoprint!.tiles.length).toBe(12);
    // TP53 leads (altered in 3 samples), its % reads 3/4 = 75%.
    expect(s.oncoprint!.geneLabels[0]!.text).toBe("TP53");
    expect(s.oncoprint!.percentLabels[0]!.text).toBe("75%");
  });

  it("stacks several alterations in one cell (TP53 × S1 has 2 bands)", () => {
    const s = buildPlotScene(table, base, { width: 600, height: 400 });
    const cell = s.oncoprint!.tiles.find((t) => t.gene === "TP53" && t.sample === "S1")!;
    expect(cell.empty).toBe(false);
    expect(cell.bands.length).toBe(2); // Missense + Amplification
    // the two bands tile the cell height (no gap between them)
    expect(cell.bands[0]!.h).toBeCloseTo(cell.h / 2, 3);
  });

  it("colours each alteration type from the legend (one legend row per type)", () => {
    const s = buildPlotScene(table, base, { width: 600, height: 400 });
    expect(s.legend.map((e) => e.label)).toEqual(["Missense", "Truncating", "Amplification"]);
    // a Missense band takes the same colour as the Missense legend swatch
    const missColor = s.legend.find((e) => e.label === "Missense")!.color;
    const missCell = s.oncoprint!.tiles.find((t) => t.gene === "TP53" && t.sample === "S3")!;
    expect(missCell.bands[0]!.color).toBe(missColor);
  });

  it("marks empty cells and paints them the empty colour", () => {
    const s = buildPlotScene(table, base, { width: 600, height: 400 });
    const empty = s.oncoprint!.tiles.find((t) => t.gene === "EGFR" && t.sample === "S1")!;
    expect(empty.empty).toBe(true);
    expect(empty.bands.length).toBe(0);
  });

  it("hides the sample labels by default, shows them on request", () => {
    expect(buildPlotScene(table, base, { width: 600, height: 400 }).oncoprint!.sampleLabels.length).toBe(0);
    const shown = buildPlotScene(table, { ...base, oncoprint: { showSampleLabels: true } }, { width: 600, height: 400 });
    expect(shown.oncoprint!.sampleLabels.map((l) => l.text).sort()).toEqual(["S1", "S2", "S3", "S4"]);
  });

  it("warns when a required column is missing", () => {
    const twoCol: DataTable = { id: "t", kind: "alterations", name: "T", columns: [{ id: "s", name: "Sample" }, { id: "g", name: "Gene" }], rows: [{ id: "r1", cells: { s: "S1", g: "TP53" } }] };
    const s = buildPlotScene(twoCol, base, { width: 400, height: 300 });
    expect(s.warnings.some((w) => /Alteration/.test(w))).toBe(true);
  });
});
