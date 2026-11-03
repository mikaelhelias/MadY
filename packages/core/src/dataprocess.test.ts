import { describe, it, expect } from "vitest";
import { rowStatistics, pruneRows, removeBaseline, columnMath, transposeTable, extractColumns } from "./dataprocess";
import type { NamedTable } from "./reshape";

describe("rowStatistics", () => {
  const src: NamedTable = {
    columnNames: ["Dose", "R1", "R2", "R3"],
    rows: [
      [1, 2, 4, 6],
      [2, 10, 20, 30],
      [3, 5, 5, 5],
    ],
  };

  it("emits per-row mean/SD/SEM/N across the data columns, keeping the X column", () => {
    const out = rowStatistics(src, { dataColumns: [1, 2, 3], keepColumns: [0], stats: ["mean", "sd", "sem", "n"] });
    expect(out.columnNames).toEqual(["Dose", "Mean", "SD", "SEM", "N"]);
    const r0 = out.rows[0]!; // [2,4,6] → mean 4, sd 2, sem 2/√3
    expect(r0[0]).toBe(1); // Dose carried through
    expect(r0[1]).toBe(4);
    expect(r0[2]).toBe(2);
    expect(r0[3] as number).toBeCloseTo(2 / Math.sqrt(3), 10);
    expect(r0[4]).toBe(3);
  });

  it("computes the full statistic set for a row (median/CV/range/sum/geomean/95% CI)", () => {
    const out = rowStatistics(src, {
      dataColumns: [1, 2, 3], keepColumns: [0],
      stats: ["median", "cv", "min", "max", "range", "sum", "geomean", "ci95lo", "ci95hi"],
    });
    expect(out.columnNames).toEqual(["Dose", "Median", "%CV", "Min", "Max", "Range", "Sum", "Geo. mean", "95% CI low", "95% CI high"]);
    const [, median, cv, min, max, range, sum, geo, lo, hi] = out.rows[0]! as number[];
    expect(median).toBe(4);
    expect(cv).toBeCloseTo(50, 10); // sd/|mean|·100 = 2/4·100
    expect(min).toBe(2);
    expect(max).toBe(6);
    expect(range).toBe(4);
    expect(sum).toBe(12);
    expect(geo).toBeCloseTo(Math.cbrt(2 * 4 * 6), 10); // 48^(1/3)
    // mean ± t(.975,2)·sem = 4 ± 4.302653·(2/√3)
    const half = 4.302653 * (2 / Math.sqrt(3));
    expect(lo).toBeCloseTo(4 - half, 4);
    expect(hi).toBeCloseTo(4 + half, 4);
  });

  it("degenerate rows: all-equal → SD/SEM 0; blanks & non-numeric cells are dropped from N", () => {
    const out = rowStatistics(
      { columnNames: ["X", "A", "B", "C"], rows: [[9, 5, 5, 5], [9, 7, null, "x"]] },
      { dataColumns: [1, 2, 3], keepColumns: [0], stats: ["mean", "sd", "sem", "n"] },
    );
    expect(out.rows[0]).toEqual([9, 5, 0, 0, 3]);
    // second row: only the "7" is numeric → mean 7, SD/SEM undefined (n=1) → null, N=1
    expect(out.rows[1]![1]).toBe(7);
    expect(out.rows[1]![2]).toBeNull();
    expect(out.rows[1]![3]).toBeNull();
    expect(out.rows[1]![4]).toBe(1);
  });

  it("unknown stat ids are dropped; empty stats falls back to Mean/SD/N", () => {
    const out = rowStatistics(src, { dataColumns: [1, 2, 3], stats: ["bogus" as unknown as string] });
    expect(out.columnNames).toEqual(["Mean", "SD", "N"]);
  });
});

describe("pruneRows", () => {
  const src: NamedTable = {
    columnNames: ["X", "Y"],
    rows: [[0, 10], [1, 11], [2, 12], [3, 13], [4, 14], [5, 15]],
  };

  it("firstN / lastN keep the head / tail", () => {
    expect(pruneRows(src, { mode: "firstN", n: 2 }).rows).toEqual([[0, 10], [1, 11]]);
    expect(pruneRows(src, { mode: "lastN", n: 2 }).rows).toEqual([[4, 14], [5, 15]]);
  });

  it("everyNth keeps 1 of every N from the offset", () => {
    expect(pruneRows(src, { mode: "everyNth", n: 2 }).rows).toEqual([[0, 10], [2, 12], [4, 14]]);
    expect(pruneRows(src, { mode: "everyNth", n: 3, offset: 1 }).rows).toEqual([[1, 11], [4, 14]]);
  });

  it("range keeps rows whose column value is within [min,max]", () => {
    expect(pruneRows(src, { mode: "range", col: 0, min: 2, max: 4 }).rows).toEqual([[2, 12], [3, 13], [4, 14]]);
  });

  it("dropBlank removes rows blank in the column (or fully blank)", () => {
    const b: NamedTable = { columnNames: ["A", "B"], rows: [[1, 2], [null, 3], ["", 4], [5, null], [null, null]] };
    expect(pruneRows(b, { mode: "dropBlank", col: 0 }).rows).toEqual([[1, 2], [5, null]]); // col-0 blank drops rows 1,2,4
    expect(pruneRows(b, { mode: "dropBlank" }).rows).toEqual([[1, 2], [null, 3], ["", 4], [5, null]]); // drops only the fully-blank row
  });

  it("preserves column names + copies rows (no source mutation)", () => {
    const out = pruneRows(src, { mode: "firstN", n: 1 });
    expect(out.columnNames).toEqual(["X", "Y"]);
    out.rows[0]![0] = 999;
    expect(src.rows[0]![0]).toBe(0);
  });
});

describe("removeBaseline", () => {
  const src: NamedTable = {
    columnNames: ["Time", "A", "B", "Blank"],
    rows: [[0, 10, 100, 5], [1, 12, 110, 5], [2, 15, 130, 6]],
  };

  it("column baseline: subtract the baseline column per row", () => {
    const out = removeBaseline(src, { dataColumns: [1, 2], keepColumns: [0], baselineFrom: "column", baselineCol: 3, operation: "subtract" });
    expect(out.columnNames).toEqual(["Time", "A", "B"]);
    expect(out.rows).toEqual([[0, 5, 95], [1, 7, 105], [2, 9, 124]]);
  });

  it("firstRow baseline: subtract each data column's row-0 value", () => {
    const out = removeBaseline(src, { dataColumns: [1, 2], keepColumns: [0], baselineFrom: "firstRow" });
    expect(out.rows).toEqual([[0, 0, 0], [1, 2, 10], [2, 5, 30]]);
  });

  it("meanRows baseline: subtract the mean over a row range", () => {
    const out = removeBaseline(src, { dataColumns: [1, 2], keepColumns: [0], baselineFrom: "meanRows", from: 0, to: 1 });
    // mean(A over rows 0..1) = 11, mean(B) = 105
    expect(out.rows[2]).toEqual([2, 4, 25]);
  });

  it("divide operation: ratio to baseline; ÷0 → blank", () => {
    const s2: NamedTable = { columnNames: ["A", "base"], rows: [[10, 2], [20, 0]] };
    const out = removeBaseline(s2, { dataColumns: [0], keepColumns: [], baselineFrom: "column", baselineCol: 1, operation: "divide" });
    expect(out.rows).toEqual([[5], [null]]);
  });
});

describe("columnMath", () => {
  const src: NamedTable = { columnNames: ["X", "A", "B"], rows: [[1, 10, 4], [2, 20, 0], [3, 30, 5]] };

  it("computes A op B into a labelled result column, keeping X (÷0 → blank)", () => {
    const sub = columnMath(src, { keepColumns: [0], a: 1, b: 2, operator: "subtract" });
    expect(sub.columnNames).toEqual(["X", "A − B"]);
    expect(sub.rows).toEqual([[1, 6], [2, 20], [3, 25]]);
    const div = columnMath(src, { keepColumns: [0], a: 1, b: 2, operator: "divide" });
    expect(div.columnNames).toEqual(["X", "A ÷ B"]);
    expect(div.rows).toEqual([[1, 2.5], [2, null], [3, 6]]);
  });

  it("honours a custom result name", () => {
    const out = columnMath(src, { a: 1, b: 2, operator: "add", resultName: "Total" });
    expect(out.columnNames).toEqual(["Total"]);
    expect(out.rows[0]).toEqual([14]);
  });
});

describe("transposeTable", () => {
  const src: NamedTable = {
    columnNames: ["Gene", "S1", "S2", "S3"],
    rows: [["A", 1, 2, 3], ["B", 4, 5, 6]],
  };

  it("uses the label column values as new headers; other columns become rows", () => {
    const out = transposeTable(src, { labelCol: 0 });
    expect(out.columnNames).toEqual(["Gene", "A", "B"]);
    expect(out.rows).toEqual([["S1", 1, 4], ["S2", 2, 5], ["S3", 3, 6]]);
  });

  it("labelCol < 0 → plain transpose with generic Row N headers over all columns", () => {
    const out = transposeTable(src, { labelCol: -1 });
    expect(out.columnNames).toEqual(["", "Row 1", "Row 2"]);
    expect(out.rows).toEqual([["Gene", "A", "B"], ["S1", 1, 4], ["S2", 2, 5], ["S3", 3, 6]]);
  });

  it("round-trips (transpose twice restores the original)", () => {
    const twice = transposeTable(transposeTable(src, { labelCol: 0 }), { labelCol: 0 });
    expect(twice.columnNames).toEqual(["Gene", "S1", "S2", "S3"]);
    expect(twice.rows).toEqual([["A", 1, 2, 3], ["B", 4, 5, 6]]);
  });
});

describe("extractColumns", () => {
  const src: NamedTable = { columnNames: ["A", "B", "C", "D"], rows: [[1, 2, 3, 4], [5, 6, 7, 8]] };

  it("outputs the chosen columns in the given order (subset + reorder)", () => {
    const out = extractColumns(src, { columns: [2, 0] });
    expect(out.columnNames).toEqual(["C", "A"]);
    expect(out.rows).toEqual([[3, 1], [7, 5]]);
  });

  it("drops out-of-range indices", () => {
    const out = extractColumns(src, { columns: [1, 9, 3] });
    expect(out.columnNames).toEqual(["B", "D"]);
    expect(out.rows).toEqual([[2, 4], [6, 8]]);
  });

  it("can duplicate a column", () => {
    const out = extractColumns(src, { columns: [0, 0] });
    expect(out.columnNames).toEqual(["A", "A"]);
    expect(out.rows[0]).toEqual([1, 1]);
  });
});
