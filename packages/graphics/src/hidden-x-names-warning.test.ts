import { describe, it, expect } from "vitest";
import type { AxisSpec, DataTable, Plot, PlotKind } from "@mady/core";
import type { PlotScene } from "./scene.js";
import { buildPlotScene, isHiddenXNamesWarning } from "./buildScene.js";

// A category name on the X axis that is left blank for lack of room is named in a warning, with the remedies
// that would bring it back. Each fixture first proves it hides a name, so the warning has something to report.

const hiddenNames = (s: PlotScene): string[] =>
  s.x.ticks.filter((t) => !t.minor && t.label === "" && !!t.suppressedLabel).sort((a, b) => a.pos - b.pos).map((t) => t.suppressedLabel!);
const hiddenWarning = (s: PlotScene): string | undefined => s.warnings.find((w) => /hidden on the X axis/.test(w));

/** The warning lists exactly the hidden names, in axis order. */
const expectNamed = (s: PlotScene): string => {
  const hidden = hiddenNames(s);
  expect(hidden.length, "the fixture must hide a name").toBeGreaterThan(0);
  const w = hiddenWarning(s);
  expect(w, `no warning for ${JSON.stringify(hidden)}; warnings: ${JSON.stringify(s.warnings)}`).toBeDefined();
  expect(w!.startsWith(`${hidden.length} name${hidden.length === 1 ? " is" : "s are"} hidden on the X axis`)).toBe(true);
  expect(w).toContain(hidden.map((n) => `"${n}"`).join(", "));
  return w!;
};

const bubbleRows: [string, number, number, string][] = [
  ["ribosome", -2.1, 50, "Drug A"], ["Oxidative Phosphorylation", -2.6, 30, "Drug A"], ["Biosynthesis of nucleotide sugars", -1.7, 12, "Drug A"],
  ["ribosome", 1.5, 50, "Drug B"], ["Oxidative Phosphorylation", -2.2, 30, "Drug B"], ["Biosynthesis of nucleotide sugars", -1.9, 12, "Drug B"],
];
const bubbleTable: DataTable = {
  id: "t", kind: "xy", name: "t",
  columns: [{ id: "g", name: "gene group" }, { id: "nes", name: "NES" }, { id: "n", name: "Gene set size" }, { id: "tr", name: "treatment" }],
  rows: bubbleRows.map(([g, nes, n, tr], i) => ({ id: `r${i}`, cells: { g, nes, n, tr } })),
};
const bubble = (extra: Partial<Plot> = {}): Plot => ({ id: "p", name: "P", source: "t", status: "ok", styleOverrides: {}, kind: "bubble", ...extra });

const groupNames = ["Control (untreated)", "Low dose treatment group", "Medium dose treatment group", "High dose treatment group", "Vehicle only control arm", "Positive control reference"];
const groupTable: DataTable = {
  id: "t", kind: "column", name: "t",
  columns: groupNames.map((name, i) => ({ id: `c${i}`, name, role: "y" as const })),
  rows: [0, 1, 2, 3, 4].map((r) => ({ id: `r${r}`, cells: Object.fromEntries(groupNames.map((_, i) => [`c${i}`, 10 + i + r])) })),
};
const groups = (kind: PlotKind, xAxis?: AxisSpec): Plot => ({ id: "p", name: "P", source: "t", status: "ok", styleOverrides: {}, kind, ...(xAxis ? { xAxis } : {}) });

describe("a category name hidden for room is named in a warning", () => {
  it("bubble with names along X: the name squeezed out by the legend is reported", () => {
    const w = expectNamed(buildPlotScene(bubbleTable, bubble({ xAxis: {}, seriesStyles: { nes: { colorFromColumn: "tr" } } }), { width: 640, height: 440 }));
    expect(w).toContain("Oxidative Phosphorylation");
  });

  // "scatter" is the column scatter: one column of dots per group.
  for (const kind of ["bar", "box", "violin", "scatter"] as PlotKind[]) {
    it(`${kind}: long group names that collide even at the smallest size; level names are offered Label rotation`, () => {
      const w = expectNamed(buildPlotScene(groupTable, groups(kind, {}), { width: 640, height: 440 }));
      expect(w).toMatch(/Turn them \(X axis ▸ Label rotation\), widen the figure, or use a smaller name font\.$/);
    });
  }

  it("names already at the smallest size are not offered a smaller font", () => {
    const w = expectNamed(buildPlotScene(groupTable, groups("bar", { tickFont: { size: 8 } }), { width: 400, height: 300 }));
    expect(w).not.toMatch(/smaller name font/);
    expect(w).toMatch(/Turn them \(X axis ▸ Label rotation\) or widen the figure\.$/);
  });

  it("turned names are offered a steeper angle, not Label rotation", () => {
    const w = expectNamed(buildPlotScene(groupTable, groups("bar", { tickRotation: -45 }), { width: 240, height: 300 }));
    expect(w).toMatch(/steeper angle \(up to 90°\)/);
    expect(w).not.toMatch(/Label rotation/);
  });

  it("names turned to 90° are not offered a steeper angle", () => {
    const w = expectNamed(buildPlotScene(groupTable, groups("bar", { tickRotation: -90 }), { width: 160, height: 300 }));
    expect(w).not.toMatch(/steeper angle/);
    expect(w).toMatch(/Widen the figure or use a smaller name font\.$/);
  });

  it("a graph with no X axis settings is reported too", () => {
    expectNamed(buildPlotScene(groupTable, groups("bar"), { width: 640, height: 440 }));
  });

  it("more than ten hidden names: ten are listed, the rest counted", () => {
    const many = Array.from({ length: 30 }, (_, i) => `Treatment group number ${i + 1}`);
    const t: DataTable = {
      id: "t", kind: "column", name: "t",
      columns: many.map((name, i) => ({ id: `c${i}`, name, role: "y" as const })),
      rows: [0, 1, 2].map((r) => ({ id: `r${r}`, cells: Object.fromEntries(many.map((_, i) => [`c${i}`, 10 + i + r])) })),
    };
    const s = buildPlotScene(t, groups("bar", {}), { width: 640, height: 440 });
    const hidden = hiddenNames(s);
    expect(hidden.length).toBeGreaterThan(10);
    const w = hiddenWarning(s)!;
    expect(w.startsWith(`${hidden.length} names are hidden on the X axis`)).toBe(true);
    expect(w).toContain(`${hidden.slice(0, 10).map((n) => `"${n}"`).join(", ")} and ${hidden.length - 10} more`);
    expect(w).not.toContain(`"${hidden[10]}"`);
  });
});

describe("isHiddenXNamesWarning tells the hidden-names warning from the others", () => {
  it("recognises it on every kind and angle, and nothing else the same scenes warn", () => {
    const scenes = [
      ...(["bar", "box", "violin", "scatter"] as PlotKind[]).map((k) => buildPlotScene(groupTable, groups(k, {}), { width: 640, height: 440 })),
      buildPlotScene(groupTable, groups("bar", { tickRotation: -45 }), { width: 240, height: 300 }),
      buildPlotScene(groupTable, groups("bar", { tickFont: { size: 30 } }), { width: 1400, height: 440 }),
      // Refusals on a names axis are real problems, worded close to this one ("the X axis holds names").
      buildPlotScene(bubbleTable, bubble({ xAxis: { scale: "log10" }, ellipse: { show: true }, equalAspect: true }), { width: 640, height: 440 }),
    ];
    const ours = scenes.map(hiddenWarning).filter((w): w is string => !!w);
    expect(ours.length).toBe(5);
    for (const w of ours) expect(isHiddenXNamesWarning(w), w).toBe(true);
    const others = scenes.flatMap((s) => s.warnings).filter((w) => !ours.includes(w));
    // The violin's "too few values" warnings, the "drawn at N px, not the 30px asked for" one and the bubble's refusals.
    expect(others.some((w) => /too few/.test(w))).toBe(true);
    expect(others.some((w) => /not the 30px asked for/.test(w))).toBe(true);
    expect(others.filter((w) => /X axis holds names/.test(w)).length).toBe(3);
    for (const w of others) expect(isHiddenXNamesWarning(w), w).toBe(false);
  });
});

describe("names that are all drawn raise no warning", () => {
  it("a graph with no X axis settings still gets its names fitted smaller before any is hidden", () => {
    const s = buildPlotScene(bubbleTable, bubble(), { width: 640, height: 440 });
    expect(s.x.ticks.map((t) => t.label)).toEqual(["ribosome", "Oxidative Phosphorylation", "Biosynthesis of nucleotide sugars"]);
    expect(s.fonts.xTick.size).toBeLessThan(13);
    expect(hiddenWarning(s)).toBeUndefined();
  });

  it("a wide figure: every name drawn, no warning", () => {
    const s = buildPlotScene(bubbleTable, bubble({ xAxis: {}, seriesStyles: { nes: { colorFromColumn: "tr" } } }), { width: 1200, height: 440 });
    expect(hiddenNames(s)).toEqual([]);
    expect(hiddenWarning(s)).toBeUndefined();
  });

  it("a histogram shows every other range when crowded, by design, without a warning", () => {
    const vals = Array.from({ length: 200 }, (_, i) => 1000 + ((i * 37) % 200) * 7.3);
    const t: DataTable = {
      id: "t", kind: "column", name: "t",
      columns: [{ id: "x", name: "Row", role: "x" }, { id: "v", name: "V", role: "y" }],
      rows: vals.map((v, i) => ({ id: `r${i}`, cells: { x: i + 1, v } })),
    };
    const s = buildPlotScene(t, { id: "p", name: "P", source: "t", status: "ok", styleOverrides: {}, kind: "histogram", histogram: { bins: 30 }, xAxis: {} }, { width: 320, height: 300 });
    expect(hiddenNames(s).length, "the fixture must thin the ranges").toBeGreaterThan(0);
    expect(hiddenWarning(s)).toBeUndefined();
  });

  it("…and the ranges it keeps are evenly spaced: the first, then every k-th", () => {
    // 90 right-skewed values in 4-wide bins on a 580 px figure: the ranges are wide enough that
    // neighbours touch, but not so wide that every other one is dropped by the same margin.
    const vals = Array.from({ length: 90 }, (_, i) => 1 + 59 * (((i + 1) * 0.6180339887) % 1) ** 2);
    const t: DataTable = {
      id: "t", kind: "column", name: "t",
      columns: [{ id: "x", name: "Row", role: "x" }, { id: "v", name: "V", role: "y" }],
      rows: vals.map((v, i) => ({ id: `r${i}`, cells: { x: i + 1, v } })),
    };
    for (const width of [440, 580, 760]) {
      const s = buildPlotScene(t, { id: "p", name: "P", source: "t", status: "ok", styleOverrides: {}, kind: "histogram", histogram: { binWidth: 4 }, xAxis: {} }, { width, height: 380 });
      const names = s.x.ticks.filter((k) => !k.minor).sort((a, b) => a.pos - b.pos);
      const idx = names.map((k, i) => (k.label !== "" ? i : -1)).filter((i) => i >= 0);
      const steps = idx.slice(1).map((v, i) => v - idx[i]!);
      expect(idx[0], `width ${width}`).toBe(0);
      expect(new Set(steps).size, `width ${width}: kept ${idx.join(",")} of ${names.length}`).toBeLessThanOrEqual(1);
    }
  });
});
