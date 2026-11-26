import { describe, it, expect } from "vitest";
import { applyTransform, transformById, normInv, TRANSFORMS } from "./transform";
import type { TransformId } from "./transform";
import type { NamedTable } from "./reshape";

/** A small grid: X column + two Y columns. */
function grid(): NamedTable {
  return {
    columnNames: ["Dose", "A", "B"],
    rows: [
      [1, 10, 100],
      [10, 20, 200],
      [100, 40, 400],
    ],
  };
}

describe("transform registry", () => {
  it("has unique ids and stable labels", () => {
    const ids = TRANSFORMS.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(TRANSFORMS.length).toBeGreaterThanOrEqual(33); // a broad transform set
  });

  it("every transform resolves by id", () => {
    for (const t of TRANSFORMS) expect(transformById(t.id)).toBe(t);
  });
});

describe("elementwise transforms", () => {
  const at = (fn: TransformId, k?: number) =>
    applyTransform(grid(), { fn, columns: [1, 2], ...(k != null ? { k } : {}) });

  it("log10 of Y, leaves X intact, renames headers", () => {
    const out = at("log10");
    expect(out.columnNames).toEqual(["Dose", "log(A)", "log(B)"]);
    expect(out.rows[0]).toEqual([1, 1, 2]); // log10(10)=1, log10(100)=2
    expect(out.rows[2]).toEqual([100, Math.log10(40), Math.log10(400)]);
  });

  it("−log10 negates the log", () => {
    const out = at("neglog10");
    expect(out.rows[0]).toEqual([1, -1, -2]);
  });

  it("log of a non-positive value yields a blank cell", () => {
    const t: NamedTable = { columnNames: ["A"], rows: [[0], [-5], [10]] };
    const out = applyTransform(t, { fn: "log10", columns: [0] });
    expect(out.rows.map((r) => r[0])).toEqual([null, null, 1]);
  });

  it("reciprocal guards divide-by-zero", () => {
    const t: NamedTable = { columnNames: ["A"], rows: [[0], [2], [4]] };
    const out = applyTransform(t, { fn: "reciprocal", columns: [0] });
    expect(out.rows.map((r) => r[0])).toEqual([null, 0.5, 0.25]);
  });

  it("Y × K uses the supplied constant", () => {
    const out = at("mul-k", 3);
    expect(out.rows[0]).toEqual([1, 30, 300]);
  });

  it("Y ÷ K with K=0 blanks the cell", () => {
    const out = at("div-k", 0);
    expect(out.rows[0]![1]).toBeNull();
  });

  it("square and sqrt round-trip on non-negative data", () => {
    const sq = at("square");
    expect(sq.rows[0]).toEqual([1, 100, 10000]);
    const sr = applyTransform(sq, { fn: "sqrt", columns: [1, 2] });
    expect(sr.rows[0]![1]).toBeCloseTo(10);
  });

  it("sqrt of a negative yields blank", () => {
    const t: NamedTable = { columnNames: ["A"], rows: [[-4], [9]] };
    const out = applyTransform(t, { fn: "sqrt", columns: [0] });
    expect(out.rows.map((r) => r[0])).toEqual([null, 3]);
  });

  it("abs and negate", () => {
    const t: NamedTable = { columnNames: ["A"], rows: [[-3], [5]] };
    expect(applyTransform(t, { fn: "abs", columns: [0] }).rows.map((r) => r[0])).toEqual([3, 5]);
    expect(applyTransform(t, { fn: "negate", columns: [0] }).rows.map((r) => r[0])).toEqual([3, -5]);
  });

  it("logit is defined only on (0,1)", () => {
    const t: NamedTable = { columnNames: ["p"], rows: [[0], [0.5], [1], [0.25]] };
    const out = applyTransform(t, { fn: "logit", columns: [0] });
    expect(out.rows[0]![0]).toBeNull();
    expect(out.rows[1]![0]).toBeCloseTo(0); // ln(0.5/0.5)=0
    expect(out.rows[2]![0]).toBeNull();
    expect(out.rows[3]![0]).toBeCloseTo(Math.log(0.25 / 0.75));
  });

  it("arcsin-sqrt clamps domain to [0,1]", () => {
    const t: NamedTable = { columnNames: ["p"], rows: [[1], [-0.1], [1.2]] };
    const out = applyTransform(t, { fn: "arcsin-sqrt", columns: [0] });
    expect(out.rows[0]![0]).toBeCloseTo(Math.PI / 2);
    expect(out.rows[1]![0]).toBeNull();
    expect(out.rows[2]![0]).toBeNull();
  });
});

describe("probit / normInv", () => {
  it("matches standard normal quantiles", () => {
    expect(normInv(0.5)).toBeCloseTo(0, 6);
    expect(normInv(0.975)).toBeCloseTo(1.959964, 4);
    expect(normInv(0.025)).toBeCloseTo(-1.959964, 4);
    expect(normInv(0.84134)).toBeCloseTo(1, 3);
  });
  it("returns null outside the open interval", () => {
    expect(normInv(0)).toBeNull();
    expect(normInv(1)).toBeNull();
    expect(normInv(-0.1)).toBeNull();
  });
});

describe("column-aware transforms", () => {
  it("z-score has mean 0 and unit SD", () => {
    const t: NamedTable = { columnNames: ["A"], rows: [[2], [4], [6], [8]] };
    const out = applyTransform(t, { fn: "zscore", columns: [0] });
    const zs = out.rows.map((r) => r[0] as number);
    const mean = zs.reduce((a, b) => a + b, 0) / zs.length;
    expect(mean).toBeCloseTo(0, 10);
    const sd = Math.sqrt(zs.reduce((a, b) => a + b * b, 0) / (zs.length - 1));
    expect(sd).toBeCloseTo(1, 10);
  });

  it("center subtracts the column mean", () => {
    const t: NamedTable = { columnNames: ["A"], rows: [[1], [2], [3]] };
    const out = applyTransform(t, { fn: "center", columns: [0] });
    expect(out.rows.map((r) => r[0])).toEqual([-1, 0, 1]);
  });

  it("normalise 0–100% maps min→0, max→100", () => {
    const t: NamedTable = { columnNames: ["A"], rows: [[10], [20], [30]] };
    const out = applyTransform(t, { fn: "normalize100", columns: [0] });
    expect(out.rows.map((r) => r[0])).toEqual([0, 50, 100]);
  });

  it("percent-of-total sums to 100", () => {
    const t: NamedTable = { columnNames: ["A"], rows: [[1], [3]] };
    const out = applyTransform(t, { fn: "percent-total", columns: [0] });
    expect(out.rows.map((r) => r[0])).toEqual([25, 75]);
  });

  it("rank assigns averaged ties", () => {
    const t: NamedTable = { columnNames: ["A"], rows: [[10], [30], [30], [50]] };
    const out = applyTransform(t, { fn: "rank", columns: [0] });
    // ranks: 1, (2+3)/2=2.5, 2.5, 4
    expect(out.rows.map((r) => r[0])).toEqual([1, 2.5, 2.5, 4]);
  });

  it("constant column (max==min) blanks the normalise", () => {
    const t: NamedTable = { columnNames: ["A"], rows: [[5], [5]] };
    const out = applyTransform(t, { fn: "normalize01", columns: [0] });
    expect(out.rows.map((r) => r[0])).toEqual([null, null]);
  });
});

describe("append mode + selection", () => {
  it("append keeps originals and adds transformed columns", () => {
    const out = applyTransform(grid(), { fn: "log10", columns: [1], append: true });
    expect(out.columnNames).toEqual(["Dose", "A", "B", "log(A)"]);
    expect(out.rows[0]).toEqual([1, 10, 100, 1]);
  });

  it("only the selected columns change", () => {
    const out = applyTransform(grid(), { fn: "square", columns: [2] });
    expect(out.columnNames).toEqual(["Dose", "A", "B²"]);
    expect(out.rows[0]).toEqual([1, 10, 10000]);
  });

  it("non-numeric cells pass through as blank", () => {
    const t: NamedTable = { columnNames: ["A"], rows: [["x"], [4], [null]] };
    const out = applyTransform(t, { fn: "ln", columns: [0] });
    expect(out.rows.map((r) => r[0])).toEqual([null, Math.log(4), null]);
  });

  it("unknown transform id throws", () => {
    expect(() => applyTransform(grid(), { fn: "nope" as TransformId, columns: [0] })).toThrow();
  });
});

describe("X-combining transforms", () => {
  it("Y ÷ X divides each Y by the row's X + renames headers", () => {
    const out = applyTransform(grid(), { fn: "div-x", columns: [1, 2], xColumn: 0 });
    expect(out.columnNames).toEqual(["Dose", "A÷X", "B÷X"]);
    expect(out.rows[0]).toEqual([1, 10, 100]); // 10/1, 100/1
    expect(out.rows[1]).toEqual([10, 2, 20]); // 20/10, 200/10
    expect(out.rows[2]).toEqual([100, 0.4, 4]); // 40/100, 400/100
  });
  it("the whole X-combining family computes against X", () => {
    const y = (fn: TransformId) => applyTransform(grid(), { fn, columns: [1], xColumn: 0 }).rows.map((r) => r[1]);
    expect(y("sub-x")).toEqual([9, 10, -60]); // A − X
    expect(y("x-sub")).toEqual([-9, -10, 60]); // X − A
    expect(y("mul-x")).toEqual([10, 200, 4000]); // A × X
    expect(y("add-x")).toEqual([11, 30, 140]); // A + X
    expect(y("x-div")).toEqual([0.1, 0.5, 2.5]); // X ÷ A
  });
  it("honours a chosen X column (not always column 0)", () => {
    const out = applyTransform(grid(), { fn: "div-x", columns: [1], xColumn: 2 }); // A ÷ B
    expect(out.rows.map((r) => r[1])).toEqual([0.1, 0.1, 0.1]);
  });
  it("X-combining division by zero → blank cell", () => {
    const t: NamedTable = { columnNames: ["X", "Y"], rows: [[0, 5], [2, 8]] };
    expect(applyTransform(t, { fn: "div-x", columns: [1], xColumn: 0 }).rows.map((r) => r[1])).toEqual([null, 4]);
  });
});

describe("radians trig + round", () => {
  const one = (fn: TransformId, val: number, k?: number) =>
    applyTransform({ columnNames: ["Y"], rows: [[val]] }, { fn, columns: [0], ...(k != null ? { k } : {}) }).rows[0]![0];
  it("trig + inverse trig work in radians", () => {
    expect(one("sin-rad", Math.PI / 2)).toBeCloseTo(1, 12);
    expect(one("cos-rad", 0)).toBeCloseTo(1, 12);
    expect(one("asin", 1)).toBeCloseTo(Math.PI / 2, 12);
    expect(one("acos", 1)).toBeCloseTo(0, 12);
    expect(one("atan", 1)).toBeCloseTo(Math.PI / 4, 12);
    expect(one("deg2rad", 180)).toBeCloseTo(Math.PI, 12);
    expect(one("rad2deg", Math.PI)).toBeCloseTo(180, 12);
  });
  it("arcsin outside [-1,1] → blank", () => {
    expect(one("asin", 2)).toBe(null);
  });
  it("round to K digits", () => {
    expect(one("round-k", 3.14159, 2)).toBe(3.14);
    expect(one("round-k", 2.5, 0)).toBe(3);
    expect(one("round-k", 12345, -2)).toBe(12300); // negative K rounds to the hundreds
  });
});

describe("interchange X↔Y", () => {
  it("swaps two columns' values + names (fn/columns ignored)", () => {
    const out = applyTransform(grid(), { fn: "log10", columns: [], swapXY: { xCol: 0, yCol: 1 } });
    expect(out.columnNames).toEqual(["A", "Dose", "B"]);
    expect(out.rows[0]).toEqual([10, 1, 100]);
    expect(out.rows[2]).toEqual([40, 100, 400]);
  });
  it("no-op when the two columns are identical", () => {
    const out = applyTransform(grid(), { fn: "log10", columns: [], swapXY: { xCol: 1, yCol: 1 } });
    expect(out.columnNames).toEqual(["Dose", "A", "B"]);
    expect(out.rows[0]).toEqual([1, 10, 100]);
  });
});

describe("X-combining is reactive through recomputeDerived", async () => {
  const { recomputeDerived } = await import("./derive");
  it("flows through the reactive derive path", () => {
    const out = recomputeDerived({ source: "t", op: "transform", spec: { fn: "div-x", columns: [1], xColumn: 0 } }, grid());
    expect(out.rows.map((r) => r[1])).toEqual([10, 2, 0.4]);
  });
});

describe("random-noise transforms (seeded, reproducible)", () => {
  // A column of a constant base → each output IS base + noise, so we can read the noise.
  const constCol = (n: number, base = 0): NamedTable => ({ columnNames: ["Y"], rows: Array.from({ length: n }, () => [base]) });

  it("gaussian noise is reproducible for a seed and differs across seeds", () => {
    const t = constCol(60, 100);
    const a = applyTransform(t, { fn: "random-gauss", columns: [0], k: 1, seed: 7 });
    const b = applyTransform(t, { fn: "random-gauss", columns: [0], k: 1, seed: 7 });
    const c = applyTransform(t, { fn: "random-gauss", columns: [0], k: 1, seed: 8 });
    expect(a.rows).toEqual(b.rows); // same seed → identical scatter
    expect(a.rows).not.toEqual(c.rows); // different seed → different scatter
    expect(a.columnNames).toEqual(["Y+noise"]);
  });

  it("gaussian noise has ~0 mean and ~K SD over many draws", () => {
    const N = 4000;
    const vals = applyTransform(constCol(N, 0), { fn: "random-gauss", columns: [0], k: 2, seed: 123 }).rows.map((r) => r[0] as number);
    const mean = vals.reduce((s, v) => s + v, 0) / N;
    const sd = Math.sqrt(vals.reduce((s, v) => s + (v - mean) ** 2, 0) / (N - 1));
    expect(Math.abs(mean)).toBeLessThan(0.2); // ≈ 0 (SE ≈ 0.03)
    expect(sd).toBeGreaterThan(1.75);
    expect(sd).toBeLessThan(2.25); // ≈ K = 2
  });

  it("uniform noise stays within ±K of the base and is reproducible", () => {
    const spec = { fn: "random-uniform" as const, columns: [0], k: 3, seed: 99 };
    const out = applyTransform(constCol(200, 5), spec);
    for (const r of out.rows) {
      const v = r[0] as number;
      expect(v).toBeGreaterThanOrEqual(5 - 3 - 1e-9);
      expect(v).toBeLessThanOrEqual(5 + 3 + 1e-9);
    }
    expect(applyTransform(constCol(200, 5), spec).rows).toEqual(out.rows); // reproducible
  });

  it("blank / non-numeric cells stay blank; each column gets an independent stream", () => {
    const t: NamedTable = { columnNames: ["A", "B"], rows: [[10, 10], [null, 10], ["x", 10], [10, 10]] };
    const out = applyTransform(t, { fn: "random-gauss", columns: [0, 1], k: 1, seed: 5 });
    expect(out.rows[1]![0]).toBeNull(); // blank → blank
    expect(out.rows[2]![0]).toBeNull(); // non-numeric → blank
    expect(out.rows[0]![0]).not.toBe(out.rows[0]![1]); // A (seed+0) vs B (seed+1): different noise
    expect(out.rows[3]![0]).not.toBe(out.rows[3]![1]);
  });

  it("non-random transforms are unaffected by seed", () => {
    const a = applyTransform(grid(), { fn: "square", columns: [1], seed: 1 });
    const b = applyTransform(grid(), { fn: "square", columns: [1], seed: 999 });
    expect(a.rows).toEqual(b.rows);
  });

  it("is reactive + the seed round-trips through recomputeDerived", async () => {
    const { recomputeDerived } = await import("./derive");
    const deriv = { source: "t", op: "transform" as const, spec: { fn: "random-gauss", columns: [0], k: 1, seed: 42 } };
    const r1 = recomputeDerived(deriv, constCol(20, 0));
    const r2 = recomputeDerived(deriv, constCol(20, 0));
    expect(r1.rows).toEqual(r2.rows); // seeded → stable across recomputes
    expect(r1.rows.some((row) => row[0] !== 0)).toBe(true); // noise actually applied
  });
});
