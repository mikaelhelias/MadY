import { describe, expect, it } from "vitest";
import { longToWide, wideToLong, type NamedTable } from "./reshape";

// dose | drugA | drugB  (wide: each drug is its own column)
const WIDE: NamedTable = {
  columnNames: ["dose", "drugA", "drugB"],
  rows: [
    [1, 10, 15],
    [2, 20, 25],
  ],
};

describe("wideToLong", () => {
  it("unpivots value columns into (variable, value) rows, ids repeated", () => {
    expect(wideToLong(WIDE, { idColumns: [0], valueColumns: [1, 2] })).toEqual({
      columnNames: ["dose", "variable", "value"],
      rows: [
        [1, "drugA", 10],
        [1, "drugB", 15],
        [2, "drugA", 20],
        [2, "drugB", 25],
      ],
    });
  });

  it("honours custom key/value names", () => {
    const out = wideToLong(WIDE, {
      idColumns: [0],
      valueColumns: [1, 2],
      keyName: "drug",
      valueName: "response",
    });
    expect(out.columnNames).toEqual(["dose", "drug", "response"]);
  });

  it("drops blank cells with dropEmpty (ragged wide → clean long)", () => {
    const ragged: NamedTable = {
      columnNames: ["id", "a", "b"],
      rows: [
        [1, 10, null],
        [2, "", 25],
      ],
    };
    expect(wideToLong(ragged, { idColumns: [0], valueColumns: [1, 2], dropEmpty: true }).rows).toEqual([
      [1, "a", 10],
      [2, "b", 25],
    ]);
  });

  it("keeps blank cells by default", () => {
    const out = wideToLong(
      { columnNames: ["id", "a"], rows: [[1, null]] },
      { idColumns: [0], valueColumns: [1] },
    );
    expect(out.rows).toEqual([[1, "a", null]]);
  });

  it("supports multiple id columns", () => {
    const out = wideToLong(
      { columnNames: ["g", "t", "a", "b"], rows: [["x", 1, 5, 6]] },
      { idColumns: [0, 1], valueColumns: [2, 3] },
    );
    expect(out).toEqual({
      columnNames: ["g", "t", "variable", "value"],
      rows: [
        ["x", 1, "a", 5],
        ["x", 1, "b", 6],
      ],
    });
  });
});

describe("longToWide", () => {
  // The melted form of WIDE — pivoting it back should recover WIDE.
  const LONG: NamedTable = {
    columnNames: ["dose", "variable", "value"],
    rows: [
      [1, "drugA", 10],
      [1, "drugB", 15],
      [2, "drugA", 20],
      [2, "drugB", 25],
    ],
  };

  it("spreads a key column into headers (round-trips wideToLong)", () => {
    expect(longToWide(LONG, { idColumns: [0], keyColumn: 1, valueColumn: 2 })).toEqual(WIDE);
  });

  it("leaves missing id×key combinations null", () => {
    const sparse: NamedTable = {
      columnNames: ["id", "k", "v"],
      rows: [
        [1, "a", 10],
        [2, "b", 20], // id 1 has no "b", id 2 has no "a"
      ],
    };
    expect(longToWide(sparse, { idColumns: [0], keyColumn: 1, valueColumn: 2 })).toEqual({
      columnNames: ["id", "a", "b"],
      rows: [
        [1, 10, null],
        [2, null, 20],
      ],
    });
  });

  it("keeps the last value on a duplicate id×key (no aggregation)", () => {
    const dup: NamedTable = {
      columnNames: ["id", "k", "v"],
      rows: [
        [1, "a", 10],
        [1, "a", 99],
      ],
    };
    expect(longToWide(dup, { idColumns: [0], keyColumn: 1, valueColumn: 2 }).rows).toEqual([[1, 99]]);
  });

  it("preserves first-appearance order of keys and id-tuples", () => {
    const t: NamedTable = {
      columnNames: ["id", "k", "v"],
      rows: [
        [2, "z", 1],
        [2, "a", 2],
        [1, "z", 3],
      ],
    };
    const out = longToWide(t, { idColumns: [0], keyColumn: 1, valueColumn: 2 });
    expect(out.columnNames).toEqual(["id", "z", "a"]); // z seen before a
    expect(out.rows).toEqual([
      [2, 1, 2],
      [1, 3, null],
    ]);
  });

  it("skips rows whose key cell is null (can't name a column)", () => {
    const t: NamedTable = {
      columnNames: ["id", "k", "v"],
      rows: [
        [1, "a", 10],
        [1, null, 20],
      ],
    };
    expect(longToWide(t, { idColumns: [0], keyColumn: 1, valueColumn: 2 })).toEqual({
      columnNames: ["id", "a"],
      rows: [[1, 10]],
    });
  });
});
