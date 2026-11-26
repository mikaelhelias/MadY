/**
 * With several fits on one graph, each shows only its key result: the full parameter blocks would
 * crowd the plot and print over the curves and each other.
 */
import { describe, expect, it } from "vitest";
import type { DataTable, Plot, PlotFit } from "@mady/core";
import { buildPlotScene } from "./buildScene.js";
import { fitKeyLines, severalFitBlocks } from "./fitKeyLines.js";

const DR_KEYS = ["Bottom", "Top", "logEC50", "Hill slope", "EC50", "R²"];

describe("fitKeyLines", () => {
  it("a dose-response with its crosshair label: no line, the label already prints the EC50", () => {
    expect([...fitKeyLines(DR_KEYS, 6, true)]).toEqual([]);
  });
  it("a dose-response without a crosshair: the EC50 line", () => {
    expect([...fitKeyLines(DR_KEYS, 6, false)]).toEqual([4]);
  });
  it("a kinetics fit: its Michaelis constant; a Boltzmann fit: its midpoint", () => {
    expect([...fitKeyLines(["Vmax", "KM", "R²"], 3, false)]).toEqual([1]);
    expect([...fitKeyLines(["Bottom", "Top", "V50", "Slope", "R²"], 5, false)]).toEqual([2]);
  });
  it("a fit with no named key value shows its R², how well it describes the data — not its first parameter", () => {
    expect([...fitKeyLines(["Y0", "K", "R²"], 3, false)]).toEqual([2]);
  });
  it("a fit saved without line names: its first line, as before", () => {
    expect([...fitKeyLines([], 2, false)]).toEqual([0]);
  });
  it("a fit with a crosshair label saved without line keys: no line, the label carries the result", () => {
    expect([...fitKeyLines([], 6, true)]).toEqual([]);
  });
  it("a key past the lines drawn is not counted", () => {
    expect([...fitKeyLines(["Y0", "KM"], 1, false)]).toEqual([]);
  });

  // The term names the engine returns for each model (engine.py, read off its own results).
  const MODEL_TERMS: [string, string[], string[]][] = [
    ["gaussian", ["Amplitude", "Mean", "SD", "R²"], ["Mean"]],
    ["lorentzian", ["Amplitude", "Center", "Width", "R²"], ["Center"]],
    ["exp_growth", ["Y0", "K", "Doubling time", "R²"], ["Doubling time"]],
    ["exp_decay", ["Y0", "Plateau", "K", "Half-life", "R²"], ["Half-life"]],
    ["exp_decay2", ["Plateau", "SpanFast", "Kfast", "SpanSlow", "Kslow", "R²"], ["Kfast", "Kslow"]],
    ["stretched_exp", ["Amplitude", "Tau", "Beta", "R²"], ["Tau"]],
    ["logistic_growth", ["Capacity", "Rate", "Midpoint", "R²"], ["Midpoint"]],
    ["gompertz4", ["Offset", "Span", "Rate", "Inflection", "R²"], ["Inflection"]],
    ["probit_dr", ["Bottom", "Top", "Mu", "Sigma", "R²"], ["Mu"]],
    ["weibull_sigmoid", ["Bottom", "Top", "Scale", "Shape", "R²"], ["Scale"]],
    ["boltzmann", ["Bottom", "Top", "V50", "Slope", "R²"], ["V50"]],
    ["linear", ["Slope", "Intercept"], ["Slope"]],
    ["segmental", ["X0", "Y0", "Slope1", "Slope2", "R²"], ["X0"]],
    ["twosite", ["Bmax1", "Kd1", "Bmax2", "Kd2", "R²"], ["Kd1", "Kd2"]],
    ["biphasic_dr", ["Bottom", "Top", "Frac", "logEC50_1", "nH1", "logEC50_2", "nH2", "EC50_1", "EC50_2", "R²"], ["EC50_1", "EC50_2"]],
    ["kcat", ["Et", "kcat", "KM", "Vmax", "kcat/KM", "R²"], ["kcat", "KM"]],
    ["poly2", ["B0", "B1", "B2", "R²"], ["R²"]],
    ["power", ["A", "B", "R²"], ["R²"]],
    ["lowess", ["Points"], []],
    ["spline", ["Spline order", "Knots", "Points"], []],
  ];
  it.each(MODEL_TERMS)("%s: its key value", (_model, keys, want) => {
    expect([...fitKeyLines(keys, keys.length, false)].map((i) => keys[i])).toEqual(want);
  });
});

const fit = (ec50: number, extra: Partial<PlotFit> = {}): PlotFit => ({
  label: "Dose-response (4PL, variable slope)",
  points: [[1, 5], [10, 30], [100, 70], [1000, 95]],
  params: ["Bottom = 3", "Top = 100", "logEC_{50} = 1.7", "Hill slope = 1", `EC_{50} = ${ec50}`, "R² = 0.99"],
  paramKeys: DR_KEYS,
  marker: { x: ec50, y: 50, label: `EC50 = ${ec50}` },
  ...extra,
});

describe("severalFitBlocks", () => {
  it("counts the fits that carry fitted values", () => {
    expect(severalFitBlocks({ fit: fit(3) })).toBe(false);
    expect(severalFitBlocks({ fit: fit(3), fits: [fit(50)] })).toBe(true);
    expect(severalFitBlocks({ fits: [fit(3), fit(50)] })).toBe(true);
    // A global fit's per-sample curves carry no block.
    expect(severalFitBlocks({ fits: [fit(3, { params: [] }), fit(50, { params: [] })] })).toBe(false);
  });
});

describe("the blocks on a graph of two analyses", () => {
  const table: DataTable = {
    id: "t", kind: "xy", name: "T",
    columns: [{ id: "x", name: "Dose", role: "x" }, { id: "a", name: "A", role: "y" }, { id: "b", name: "B", role: "y" }],
    rows: [[1, 5, 4], [10, 30, 10], [100, 70, 40], [1000, 95, 80]].map((r, i) => ({ id: `r${i}`, cells: { x: r[0]!, a: r[1]!, b: r[2]! } })),
  };
  const plotOf = (extra: Partial<Plot> = {}): Plot => ({
    id: "p", name: "P", source: "t", status: "ok", styleOverrides: {}, kind: "xy", xAxis: { scale: "log10" },
    fit: fit(3), fits: [fit(50)], ...extra,
  });
  const size = { width: 600, height: 420 };

  it("dose-responses: no blocks, each EC50 is on its own crosshair label", () => {
    const s = buildPlotScene(table, plotOf(), size);
    expect(s.fit!.params).toBeUndefined();
    expect(s.fits![0]!.params).toBeUndefined();
    expect(s.fit!.marker!.label).toBe("EC50 = 3");
    expect(s.fits![0]!.marker!.label).toBe("EC50 = 50");
  });

  it("fits without a crosshair keep a one-line block of their key value", () => {
    const s = buildPlotScene(table, plotOf({ fit: fit(3, { marker: undefined }), fits: [fit(50, { marker: undefined })] }), size);
    expect(s.fit!.params!.lines).toEqual(["EC_{50} = 3"]);
    expect(s.fits![0]!.params!.lines).toEqual(["EC_{50} = 50"]);
  });

  it("Show all brings the full blocks back; a line ticked on its own shows too", () => {
    const all = buildPlotScene(table, plotOf({ fitParams: { show: true } }), size);
    expect(all.fit!.params!.lines).toHaveLength(6);
    expect(all.fits![0]!.params!.lines).toHaveLength(6);
    const ticked = buildPlotScene(table, plotOf({ fitParams: { lines: { "R²": { show: true } } } }), size);
    expect(ticked.fit!.params!.lines).toEqual(["R² = 0.99"]);
  });

  it("one fit alone keeps its six lines", () => {
    const s = buildPlotScene(table, plotOf({ fits: undefined }), size);
    expect(s.fit!.params!.lines).toHaveLength(6);
  });
});
