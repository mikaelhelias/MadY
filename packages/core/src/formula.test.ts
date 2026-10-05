import { describe, it, expect } from "vitest";
import { compileFormula, recomputeFormulas, remapFormulaColumns } from "./formula";
import type { DataTable } from "./model";

/** Evaluate a formula against a single row + optional per-column value arrays. */
function ev(src: string, row: (number | null)[], colVals: number[][] = []): number | null {
  const c = compileFormula(src);
  if (!c.ok) throw new Error(`compile failed: ${c.error}`);
  return c.eval({ row, colVals });
}

describe("formula engine — arithmetic + precedence", () => {
  it("respects operator precedence + parentheses", () => {
    expect(ev("A+B*C", [1, 2, 3])).toBe(7);
    expect(ev("(A+B)*C", [1, 2, 3])).toBe(9);
    expect(ev("A/B", [10, 4])).toBe(2.5);
    expect(ev("A-B-C", [10, 3, 2])).toBe(5); // left-assoc
  });
  it("unary minus binds looser than power; power is right-assoc", () => {
    expect(ev("-2^2", [])).toBe(-4);
    expect(ev("2^3^2", [])).toBe(512);
    expect(ev("2*3^2", [])).toBe(18);
  });
  it("column letters read the row by position (A=0, B=1, …)", () => {
    expect(ev("A", [42, 7])).toBe(42);
    expect(ev("B", [42, 7])).toBe(7);
    expect(ev("a+b", [1, 2])).toBe(3); // case-insensitive
  });
});

describe("formula engine — functions", () => {
  it("math + rounding", () => {
    expect(ev("LOG(A)", [100])).toBe(2);
    expect(ev("LN(EXP(1))", [])).toBeCloseTo(1, 12);
    expect(ev("SQRT(A)", [9])).toBe(3);
    expect(ev("ABS(A)", [-5])).toBe(5);
    expect(ev("ROUND(A, 2)", [3.14159])).toBe(3.14);
    expect(ev("MOD(A, 3)", [7])).toBe(1);
    expect(ev("INT(A)", [3.9])).toBe(3);
    expect(ev("SQR(A)", [4])).toBe(16);
  });
  it("trig in radians + rad/deg conversion", () => {
    expect(ev("SIN(PI/2)", [])).toBeCloseTo(1, 12);
    expect(ev("RAD(180)", [])).toBeCloseTo(Math.PI, 12);
    expect(ev("DEG(PI)", [])).toBeCloseTo(180, 12);
    expect(ev("ASIN(1)", [])).toBeCloseTo(Math.PI / 2, 12);
  });
  it("logical IF / AND / OR / NOT + comparisons", () => {
    expect(ev("IF(A>B, A, B)", [3, 5])).toBe(5);
    expect(ev("IF(A>B, A, B)", [7, 5])).toBe(7);
    expect(ev("A>B", [3, 5])).toBe(0);
    expect(ev("A<B", [3, 5])).toBe(1);
    expect(ev("A=B", [5, 5])).toBe(1);
    expect(ev("A<>B", [5, 5])).toBe(0);
    expect(ev("AND(A>0, B>0)", [1, -1])).toBe(0);
    expect(ev("OR(A>0, B>0)", [1, -1])).toBe(1);
    expect(ev("NOT(A)", [0])).toBe(1);
  });
});

describe("formula engine — column aggregates", () => {
  const cols = [[10, 20, 30]]; // column A across 3 rows
  it("MEAN/SUM/COUNT/MIN/MAX/MEDIAN/SD over a whole column", () => {
    expect(ev("MEAN(A)", [0], cols)).toBe(20);
    expect(ev("SUM(A)", [0], cols)).toBe(60);
    expect(ev("COUNT(A)", [0], cols)).toBe(3);
    expect(ev("MIN(A)", [0], cols)).toBe(10);
    expect(ev("MAX(A)", [0], cols)).toBe(30);
    expect(ev("MEDIAN(A)", [0], cols)).toBe(20);
    expect(ev("SD(A)", [0], cols)).toBeCloseTo(10, 12);
  });
  it("mixes the row value with an aggregate (centering)", () => {
    expect(ev("A - MEAN(A)", [30], cols)).toBe(10);
  });
});

describe("formula engine — null / domain propagation", () => {
  it("blank input, division by zero, out-of-domain → blank (null), never NaN", () => {
    expect(ev("A+B", [1, null])).toBe(null);
    expect(ev("A/B", [10, 0])).toBe(null);
    expect(ev("SQRT(A)", [-1])).toBe(null);
    expect(ev("LOG(A)", [0])).toBe(null);
    expect(ev("ASIN(A)", [2])).toBe(null);
  });
});

describe("formula engine — parse errors", () => {
  const bad = (s: string) => {
    const c = compileFormula(s);
    return c.ok ? null : c.error;
  };
  it("rejects malformed / unknown / wrong-arity input", () => {
    expect(bad("A +")).toBeTruthy();
    expect(bad("FOO(A)")).toMatch(/Unknown function/);
    expect(bad("ROUND(A)")).toMatch(/argument/);
    expect(bad("MEAN(A+B)")).toMatch(/column letter/);
    expect(bad("")).toBeTruthy();
    expect(bad("(A+B")).toBeTruthy();
    expect(bad("A B")).toBeTruthy();
  });

  it("with a column count, a reference past the last column is a visible error, not a silent blank", () => {
    const on3 = (s: string) => { const c = compileFormula(s, 3); return c.ok ? null : c.error; };
    expect(on3("A+D")).toMatch(/Column D doesn't exist.*3 columns \(A–C\)/); // D on an A–C sheet
    expect(on3("MEAN(Z)")).toMatch(/Column Z doesn't exist/); // aggregates are checked too
    expect(on3("A+C")).toBeNull(); // last real column is fine
    // Without a count the engine stays lenient (recompute path) — evaluation reads blank, no error.
    expect(bad("A+D")).toBeNull();
    // singular grammar
    expect((compileFormula("B", 1) as { error: string }).error).toMatch(/1 column \(A–A\)/);
  });
});

describe("recomputeFormulas — materialisation + reactivity", () => {
  const table = (): DataTable => ({
    id: "t", kind: "xy", name: "T",
    columns: [
      { id: "a", name: "A" },
      { id: "b", name: "B" },
      { id: "c", name: "Ratio", formula: "A/B" },
    ],
    rows: [
      { id: "r0", cells: { a: 10, b: 2 } },
      { id: "r1", cells: { a: 9, b: 3 } },
      { id: "r2", cells: { a: 8, b: 0 } }, // B=0 → blank
    ],
  });
  it("writes each formula column's cells from its siblings", () => {
    const t = table();
    recomputeFormulas(t);
    expect(t.rows.map((r) => r.cells.c)).toEqual([5, 3, null]);
  });
  it("re-reads new values on the next recompute (reactive)", () => {
    const t = table();
    recomputeFormulas(t);
    t.rows[0]!.cells.b = 5; // edit a source cell
    recomputeFormulas(t);
    expect(t.rows[0]!.cells.c).toBe(2); // 10/5
  });
  it("resolves a formula-references-formula chain", () => {
    const t: DataTable = {
      id: "t", kind: "xy", name: "T",
      columns: [
        { id: "a", name: "A" },
        { id: "c", name: "twice", formula: "A*2" },
        { id: "d", name: "plus1", formula: "B+1" }, // B = the 2nd column = twice
      ],
      rows: [{ id: "r0", cells: { a: 5 } }],
    };
    recomputeFormulas(t);
    expect(t.rows[0]!.cells.c).toBe(10);
    expect(t.rows[0]!.cells.d).toBe(11); // (A*2)+1
  });
  it("settles a deep formula chain fully, even in reverse column order (no fixed pass limit)", () => {
    // Formula columns are evaluated left→right within a pass, so a chain laid out in dependency
    // order settles in one pass and could never show a pass limit. The chain has to run the other way:
    // each formula column reads the column to its right, so every pass propagates the value only
    // one step left — a 10-deep chain needs 10 passes, and a fixed limit of 8 passes would leave
    // the leftmost columns permanently stale.
    //   layout: [f10, f9, …, f1, A]  with f1 = A+1 (=L+1), f2 = f1+1 (=K+1), … f10 = f9+1
    const n = 10;
    const columns: { id: string; name: string; formula?: string }[] = [];
    for (let k = n; k >= 1; k--) {
      // column index of f_k is (n - k); it references the column immediately to its right (index n-k+1)
      const right = String.fromCharCode(65 + (n - k) + 1);
      columns.push({ id: `f${k}`, name: `f${k}`, formula: `${right}+1` });
    }
    columns.push({ id: "a", name: "A" }); // the source, at the far right
    const t: DataTable = { id: "t", kind: "xy", name: "T", columns, rows: [{ id: "r0", cells: { a: 5 } }] };
    recomputeFormulas(t);
    expect(t.rows[0]!.cells.f10).toBe(15); // A + 10, at the far left — needs all 10 passes
    // and a source edit propagates all the way on the next recompute
    t.rows[0]!.cells.a = 100;
    recomputeFormulas(t);
    expect(t.rows[0]!.cells.f10).toBe(110);
  });

  it("a circular reference still terminates", () => {
    const t: DataTable = {
      id: "t", kind: "xy", name: "T",
      columns: [{ id: "p", name: "p", formula: "B+1" }, { id: "q", name: "q", formula: "A+1" }],
      rows: [{ id: "r0", cells: {} }],
    };
    expect(() => recomputeFormulas(t)).not.toThrow();
  });

  it("a bad formula blanks its column without throwing", () => {
    const t: DataTable = {
      id: "t", kind: "xy", name: "T",
      columns: [{ id: "a", name: "A" }, { id: "z", name: "Bad", formula: "A +" }],
      rows: [{ id: "r0", cells: { a: 1 } }],
    };
    expect(() => recomputeFormulas(t)).not.toThrow();
    expect(t.rows[0]!.cells.z).toBe(null);
  });
});

describe("remapFormulaColumns — column refs are positions, so structural edits must remap them", () => {
  const shiftRightBy1 = (i: number): number => i + 1; // e.g. a column inserted at 0
  it("remaps standalone letter refs, leaving function/constant names alone", () => {
    expect(remapFormulaColumns("A/B", shiftRightBy1)).toBe("B/C");
    expect(remapFormulaColumns("LOG(A) + IF(B>0, C, A)", shiftRightBy1)).toBe("LOG(B) + IF(C>0, D, B)");
    expect(remapFormulaColumns("MEAN(A) + PI", shiftRightBy1)).toBe("MEAN(B) + PI"); // MEAN, PI untouched
  });
  it("applies an arbitrary permutation (a column swap)", () => {
    const swap01 = (i: number): number => (i === 0 ? 1 : i === 1 ? 0 : i);
    expect(remapFormulaColumns("A/B", swap01)).toBe("B/A"); // still computes the same ratio after a swap
  });
  it("returns null (keep the original) when a referenced column is deleted or would pass Z", () => {
    const deleteCol1 = (i: number): number | null => (i === 1 ? null : i > 1 ? i - 1 : i);
    expect(remapFormulaColumns("A+B", deleteCol1)).toBeNull(); // B was deleted → can't safely remap
    expect(remapFormulaColumns("A+C", deleteCol1)).toBe("A+B"); // C survives (shifts to B), A stays
    expect(remapFormulaColumns("A", (i) => i + 26)).toBeNull(); // would move past 'Z'
  });
});
