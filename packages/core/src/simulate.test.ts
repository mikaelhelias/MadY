import { describe, it, expect } from "vitest";
import {
  makeRng,
  drawFrom,
  simulateColumn,
  simulateXY,
  simXValues,
  simulate,
  GENERATORS,
  type SimColumnSpec,
  type SimXYSpec,
} from "./simulate";

const mean = (a: number[]): number => a.reduce((s, v) => s + v, 0) / a.length;
const sd = (a: number[]): number => {
  const m = mean(a);
  return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / (a.length - 1));
};

describe("makeRng — seeded PRNG", () => {
  it("is deterministic in the seed and spreads over [0,1)", () => {
    const a = Array.from({ length: 1000 }, makeRng(42));
    const b = Array.from({ length: 1000 }, makeRng(42));
    expect(a).toEqual(b); // same seed → identical stream
    expect(Array.from({ length: 5 }, makeRng(43))).not.toEqual(a.slice(0, 5)); // different seed differs
    expect(Math.min(...a)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...a)).toBeLessThan(1);
    expect(mean(a)).toBeCloseTo(0.5, 1); // roughly uniform
  });
});

describe("drawFrom — distribution samplers match their (mean, sd)", () => {
  const N = 20000;
  const sample = (dist: Parameters<typeof drawFrom>[1], m: number, s: number): number[] => {
    const rng = makeRng(7);
    return Array.from({ length: N }, () => drawFrom(rng, dist, m, s));
  };
  it("gaussian → N(mean, sd)", () => {
    const x = sample("gaussian", 50, 10);
    expect(mean(x)).toBeCloseTo(50, 0);
    expect(sd(x)).toBeCloseTo(10, 0);
  });
  it("uniform → the given mean and SD (spread = sd·√3)", () => {
    const x = sample("uniform", 5, 2);
    expect(mean(x)).toBeCloseTo(5, 1);
    expect(sd(x)).toBeCloseTo(2, 1);
  });
  it("poisson → mean ≈ variance ≈ λ", () => {
    const x = sample("poisson", 8, 0);
    expect(mean(x)).toBeCloseTo(8, 0);
    expect(sd(x) ** 2).toBeCloseTo(8, 0); // Poisson variance = mean
    expect(x.every((v) => Number.isInteger(v) && v >= 0)).toBe(true);
  });
  it("exponential → mean = the given mean, SD = mean", () => {
    const x = sample("exponential", 4, 0);
    expect(mean(x)).toBeCloseTo(4, 0);
    expect(sd(x)).toBeCloseTo(4, 0);
    expect(x.every((v) => v >= 0)).toBe(true);
  });
  it("lognormal → geometric mean = the given mean", () => {
    const x = sample("lognormal", 10, 1.5);
    expect(Math.exp(mean(x.map((v) => Math.log(v))))).toBeCloseTo(10, 0);
    expect(x.every((v) => v > 0)).toBe(true);
  });
});

describe("simulateColumn", () => {
  const spec: SimColumnSpec = {
    kind: "column",
    seed: 123,
    groups: [
      { label: "Control", n: 5000, mean: 100, sd: 15 },
      { label: "Treated", n: 3000, mean: 120, sd: 15, dist: "gaussian" },
    ],
  };
  it("one column per group, padded to the tallest group, reproducible", () => {
    const t = simulateColumn(spec);
    expect(t.columnNames).toEqual(["Control", "Treated"]);
    expect(t.rows).toHaveLength(5000); // max(n)
    expect(t.rows[4999]![1]).toBeNull(); // Treated (3000) padded with blanks past its n
    expect(t.rows[2999]![1]).not.toBeNull();
    expect(simulateColumn(spec)).toEqual(t); // deterministic
  });
  it("each group's samples recover its mean/SD", () => {
    const t = simulateColumn(spec);
    const control = t.rows.map((r) => r[0]).filter((v): v is number => v !== null);
    const treated = t.rows.map((r) => r[1]).filter((v): v is number => v !== null);
    expect(mean(control)).toBeCloseTo(100, 0);
    expect(sd(control)).toBeCloseTo(15, 0);
    expect(mean(treated)).toBeCloseTo(120, 0);
    expect(treated).toHaveLength(3000);
  });
});

describe("simXValues", () => {
  it("arithmetic spacing", () => {
    expect(simXValues({ xStart: 0, xEnd: 10, xCount: 6 })).toEqual([0, 2, 4, 6, 8, 10]);
  });
  it("geometric spacing (xLog)", () => {
    const xs = simXValues({ xStart: 1, xEnd: 1000, xCount: 4, xLog: true });
    expect(xs[0]).toBeCloseTo(1, 6);
    expect(xs[1]).toBeCloseTo(10, 6);
    expect(xs[2]).toBeCloseTo(100, 6);
    expect(xs[3]).toBeCloseTo(1000, 6);
  });
});

describe("simulateXY", () => {
  it("no noise → Y is exactly f(x, params)", () => {
    const spec: SimXYSpec = { kind: "xy", seed: 1, xStart: 0, xEnd: 5, xCount: 6, equation: "line", params: [2, 3] };
    const t = simulateXY(spec);
    expect(t.columnNames).toEqual(["X", "Y"]);
    t.rows.forEach(([x, y]) => expect(y as number).toBeCloseTo(2 * (x as number) + 3, 6));
  });
  it("Gaussian scatter is reproducible and centred on the model", () => {
    const spec: SimXYSpec = { kind: "xy", seed: 99, xStart: 1, xEnd: 200, xCount: 200, equation: "line", params: [0, 10], noise: { type: "sd", value: 5 } };
    const t = simulateXY(spec);
    const resid = t.rows.map((r) => (r[1] as number) - 10); // model is constant 10 (slope 0)
    expect(mean(resid)).toBeCloseTo(0, 0); // noise centred at 0
    expect(sd(resid)).toBeCloseTo(5, 0); // SD ≈ requested
    expect(simulateXY(spec)).toEqual(t); // deterministic in the seed
  });
  it("replicates → one Y column each", () => {
    const spec: SimXYSpec = { kind: "xy", seed: 3, xStart: 0, xEnd: 4, xCount: 5, equation: "line", params: [1, 0], replicates: 3, noise: { type: "sd", value: 1 } };
    const t = simulateXY(spec);
    expect(t.columnNames).toEqual(["X", "Y1", "Y2", "Y3"]);
    expect(t.rows[0]).toHaveLength(4);
  });
  it("positive-only models (4PL log dose) blank non-positive X", () => {
    const spec: SimXYSpec = { kind: "xy", seed: 1, xStart: -1, xEnd: 1000, xCount: 5, xLog: false, equation: "dr4pl", params: [0, 100, 1, 1] };
    const t = simulateXY(spec);
    expect(t.rows[0]![1]).toBeNull(); // X = -1 → blank Y
    expect(t.rows[t.rows.length - 1]![1]).not.toBeNull(); // X = 1000 → defined
  });
  it("unknown equation id → blank Y (no throw)", () => {
    const t = simulateXY({ kind: "xy", seed: 1, xStart: 0, xEnd: 1, xCount: 2, equation: "nope", params: [] });
    expect(t.rows.every((r) => r[1] === null)).toBe(true);
  });
});

describe("simulateXY — custom typed equation (Plot a function)", () => {
  it("evaluates a user f(X) over the grid (the letter X = the grid value)", () => {
    const t = simulateXY({ kind: "xy", seed: 1, xStart: 0, xEnd: 4, xCount: 5, equation: "custom", params: [], customEquation: "X^2 + 1" });
    expect(t.columnNames).toEqual(["X", "Y"]);
    t.rows.forEach(([x, y]) => expect(y as number).toBeCloseTo((x as number) ** 2 + 1, 6));
  });
  it("supports the formula function library (SIN / EXP / …)", () => {
    const t = simulateXY({ kind: "xy", seed: 1, xStart: 0, xEnd: 3, xCount: 4, equation: "custom", params: [], customEquation: "3*SIN(X) + EXP(0)" });
    t.rows.forEach(([x, y]) => expect(y as number).toBeCloseTo(3 * Math.sin(x as number) + 1, 6));
  });
  it("an invalid equation → all-blank Y (no throw)", () => {
    const t = simulateXY({ kind: "xy", seed: 1, xStart: 0, xEnd: 2, xCount: 3, equation: "custom", params: [], customEquation: "X +* 2" });
    expect(t.rows.every((r) => r[1] === null)).toBe(true);
  });
  it("out-of-domain values blank that cell, never NaN (LN(X) at X=0)", () => {
    const t = simulateXY({ kind: "xy", seed: 1, xStart: 0, xEnd: 2, xCount: 3, equation: "custom", params: [], customEquation: "LN(X)" });
    expect(t.rows[0]![1]).toBeNull(); // LN(0) → blank
    expect(t.rows[t.rows.length - 1]![1]).toBeCloseTo(Math.log(2), 6);
  });
  it("adds reproducible scatter to a custom function", () => {
    const spec: SimXYSpec = { kind: "xy", seed: 7, xStart: 1, xEnd: 100, xCount: 100, equation: "custom", params: [], customEquation: "10", noise: { type: "sd", value: 2 } };
    const t = simulateXY(spec);
    const resid = t.rows.map((r) => (r[1] as number) - 10);
    expect(mean(resid)).toBeCloseTo(0, 0);
    expect(sd(resid)).toBeCloseTo(2, 0);
    expect(simulateXY(spec)).toEqual(t); // seeded → identical
  });
  it("empty / whitespace custom equation → blank Y (no throw)", () => {
    const t = simulateXY({ kind: "xy", seed: 1, xStart: 0, xEnd: 1, xCount: 2, equation: "custom", params: [], customEquation: "  " });
    expect(t.rows.every((r) => r[1] === null)).toBe(true);
  });
});

describe("GENERATORS produce the expected model values", () => {
  it("spot-check line / Michaelis-Menten / 4PL / Gaussian", () => {
    expect(GENERATORS.line!.fn(3, [2, 1])).toBe(7); // 2·3+1
    expect(GENERATORS.mm!.fn(5, [20, 5])).toBeCloseTo(10, 10); // Vmax·S/(KM+S) = 20·5/10
    expect(GENERATORS.dr4pl!.fn(10, [0, 100, 1, 1])).toBeCloseTo(50, 10); // at EC50 (logEC50=1) → midpoint
    expect(GENERATORS.gaussian!.fn(5, [10, 5, 2])).toBeCloseTo(10, 10); // peak at the mean
  });
  it("simulate() dispatches on kind", () => {
    expect(simulate({ kind: "xy", seed: 1, xStart: 0, xEnd: 1, xCount: 2, equation: "line", params: [1, 0] }).columnNames).toEqual(["X", "Y"]);
    expect(simulate({ kind: "column", seed: 1, groups: [{ label: "G", n: 3, mean: 0, sd: 1 }] }).columnNames).toEqual(["G"]);
  });
});
