import { describe, expect, it } from "vitest";
import { drawableErrorTypes, ENTRY_MODE_OPTIONS, kindHasLeadColumn, naturalErrorType, nextColumnName, replicateCount, tableDatasets, tableEntryMode, xColumn } from "./dataset";
import type { Dataset, EntryMode } from "./dataset";
import type { DataTable, TableKind } from "./model";

const table = (columns: DataTable["columns"]): DataTable => ({
  id: "t1",
  kind: "xy",
  name: "T",
  columns,
  rows: [],
});

describe("format-aware column naming", () => {
  const kt = (kind: TableKind, columns: DataTable["columns"]): DataTable => ({ ...table(columns), kind });
  it("names a new data column per the table kind (not always 'Y')", () => {
    expect(nextColumnName(kt("xy", [{ id: "x", name: "X" }, { id: "y", name: "Y1" }]))).toBe("Y2");
    expect(nextColumnName(kt("column", [{ id: "l", name: "" }, { id: "a", name: "Control" }]))).toBe("Group 2");
    expect(nextColumnName(kt("multivariable", [{ id: "a", name: "Age" }, { id: "b", name: "BMI" }]))).toBe("Variable 3");
    expect(nextColumnName(kt("contingency", [{ id: "l", name: "" }, { id: "o", name: "Outcome 1" }]))).toBe("Outcome 2");
    expect(nextColumnName(kt("survival", [{ id: "t", name: "Time" }, { id: "g", name: "Group A" }]))).toBe("Group 2");
    expect(nextColumnName(kt("partsofwhole", [{ id: "s", name: "Slice" }, { id: "v", name: "Sample 1" }]))).toBe("Sample 2");
  });
  it("the first column of a lead format is the lead (X); multivariable has no lead", () => {
    expect(nextColumnName(kt("xy", []))).toBe("X");
    expect(nextColumnName(kt("survival", []))).toBe("Time");
    expect(nextColumnName(kt("multivariable", []))).toBe("Variable 1");
    expect(kindHasLeadColumn("xy")).toBe(true);
    expect(kindHasLeadColumn("multivariable")).toBe(false);
  });
});

describe("tableDatasets", () => {
  it("legacy table: col 0 = X, every other column its own 1-replicate dataset", () => {
    const t = table([
      { id: "x", name: "Dose" },
      { id: "a", name: "A" },
      { id: "b", name: "B" },
    ]);
    expect(xColumn(t)?.id).toBe("x");
    const ds = tableDatasets(t);
    expect(ds).toHaveLength(2);
    expect(ds[0]).toMatchObject({ id: "a", name: "A", replicates: ["a"] });
    expect(ds[1]).toMatchObject({ id: "b", name: "B", replicates: ["b"] });
  });

  it("multivariable table: no implicit X — every column is its own variable/dataset", () => {
    const t: DataTable = { ...table([
      { id: "v1", name: "Age" },
      { id: "v2", name: "BMI" },
      { id: "v3", name: "BP" },
    ]), kind: "multivariable" };
    expect(xColumn(t)).toBeUndefined();
    const ds = tableDatasets(t);
    expect(ds.map((d) => d.id)).toEqual(["v1", "v2", "v3"]);
    expect(ds[0]).toMatchObject({ id: "v1", name: "Age", replicates: ["v1"] });
  });

  it("multivariable table still honours an explicit role:'x' column", () => {
    const t: DataTable = { ...table([
      { id: "v1", name: "Age", role: "x" },
      { id: "v2", name: "BMI" },
    ]), kind: "multivariable" };
    expect(xColumn(t)?.id).toBe("v1");
    expect(tableDatasets(t).map((d) => d.id)).toEqual(["v2"]);
  });

  it("groups replicate subcolumns under one dataset (lead = group key)", () => {
    const t = table([
      { id: "x", name: "Dose", role: "x" },
      { id: "a1", name: "Treated", role: "y" },
      { id: "a2", name: "rep2", role: "y", group: "a1" },
      { id: "a3", name: "rep3", role: "y", group: "a1" },
      { id: "b1", name: "Control", role: "y" },
      { id: "b2", name: "rep2", role: "y", group: "b1" },
    ]);
    const ds = tableDatasets(t);
    expect(ds).toHaveLength(2);
    expect(ds[0]).toMatchObject({ id: "a1", name: "Treated", replicates: ["a1", "a2", "a3"] });
    expect(ds[1]).toMatchObject({ id: "b1", name: "Control", replicates: ["b1", "b2"] });
  });

  it("captures pre-computed sd/sem/n summary columns", () => {
    const t = table([
      { id: "x", name: "X", role: "x" },
      { id: "m", name: "Mean", role: "y" },
      { id: "s", name: "SD", role: "sd", group: "m" },
      { id: "k", name: "N", role: "n", group: "m" },
    ]);
    const ds = tableDatasets(t);
    expect(ds).toHaveLength(1);
    expect(ds[0]).toMatchObject({ id: "m", replicates: ["m"], sd: "s", n: "k" });
    expect(ds[0]!.sem).toBeUndefined();
  });
});

describe("replicateCount", () => {
  it("is the largest dataset's replicate-subcolumn count (≥1)", () => {
    const flat = table([
      { id: "x", name: "X" },
      { id: "a", name: "A" },
      { id: "b", name: "B" },
    ]);
    expect(replicateCount(flat)).toBe(1);

    const reps = table([
      { id: "x", name: "X", role: "x" },
      { id: "a1", name: "A", role: "y" },
      { id: "a2", name: "A2", role: "y", group: "a1" },
      { id: "a3", name: "A3", role: "y", group: "a1" },
      { id: "b1", name: "B", role: "y" },
      { id: "b2", name: "B2", role: "y", group: "b1" },
    ]);
    expect(replicateCount(reps)).toBe(3); // max(A:3, B:2)

    expect(replicateCount(table([{ id: "x", name: "X" }]))).toBe(1); // no datasets
  });
});

describe("tableEntryMode derivation (most-specific first)", () => {
  const x = { id: "x", name: "X", role: "x" as const };
  const y = { id: "y", name: "Y", role: "y" as const };
  it("plain replicates when no summary columns", () => {
    expect(tableEntryMode(table([x, y]))).toBe("replicates");
  });
  it("SD/SEM derive N-aware (with N → -n, without → no-N)", () => {
    expect(tableEntryMode(table([x, y, { id: "e", name: "SD", role: "sd", group: "y" }]))).toBe("mean-sd");
    expect(tableEntryMode(table([x, y, { id: "e", name: "SD", role: "sd", group: "y" }, { id: "n", name: "N", role: "n", group: "y" }]))).toBe("mean-sd-n");
    expect(tableEntryMode(table([x, y, { id: "e", name: "SEM", role: "sem", group: "y" }, { id: "n", name: "N", role: "n", group: "y" }]))).toBe("mean-sem-n");
  });
  it("%CV, ±error and limits win over a co-present SD (precedence)", () => {
    expect(tableEntryMode(table([x, y, { id: "c", name: "%CV", role: "cv", group: "y" }, { id: "n", name: "N", role: "n", group: "y" }]))).toBe("mean-cv-n");
    // errHigh only → mean-err; errLow+errHigh → mean-limits, even alongside an SD column
    expect(tableEntryMode(table([x, y, { id: "h", name: "Err", role: "errhigh", group: "y" }]))).toBe("mean-err");
    expect(tableEntryMode(table([x, y, { id: "s", name: "SD", role: "sd", group: "y" }, { id: "lo", name: "Lo", role: "errlow", group: "y" }, { id: "hi", name: "Hi", role: "errhigh", group: "y" }]))).toBe("mean-limits");
  });
  it("derives the pre-computed centre+spread formats (range/IQR/geometric/CI)", () => {
    expect(tableEntryMode(table([x, y, { id: "lo", name: "Min", role: "min", group: "y" }, { id: "hi", name: "Max", role: "max", group: "y" }]))).toBe("mean-range");
    expect(tableEntryMode(table([x, y, { id: "a", name: "Q1", role: "q1", group: "y" }, { id: "b", name: "Q3", role: "q3", group: "y" }]))).toBe("median-iqr");
    expect(tableEntryMode(table([x, y, { id: "g", name: "GSD", role: "geosd", group: "y" }]))).toBe("geomean-sd");
    expect(tableEntryMode(table([x, y, { id: "c", name: "CI", role: "ci", group: "y" }]))).toBe("mean-ci");
  });
  it("a full five-number summary reads as box-values, not one of its halves", () => {
    const cols = [
      x, y,
      { id: "mn", name: "Min", role: "min" as const, group: "y" },
      { id: "a", name: "Q1", role: "q1" as const, group: "y" },
      { id: "b", name: "Q3", role: "q3" as const, group: "y" },
      { id: "mx", name: "Max", role: "max" as const, group: "y" },
    ];
    expect(tableEntryMode(table(cols))).toBe("box-values");
    // …and on an error-bar graph it can draw either interval.
    expect(drawableErrorTypes({ id: "y", name: "Y", replicates: ["y"], q1: "a", q3: "b", min: "mn", max: "mx" })).toEqual(["iqr", "range"]);
  });
});

describe("ENTRY_MODE_OPTIONS — the single source both entry dropdowns render", () => {
  // Pins the exact set (the datasheet rail and the New-Graph dialog both map over this
  // constant, so they cannot offer different modes; this pins WHICH modes those are and
  // catches an accidental removal/reorder). Every mode `tableEntryMode` can return must
  // be here, or a table in that mode shows an <option>-less blank in the dropdown.
  const EXPECTED: readonly EntryMode[] = [
    "replicates",
    "mean-sd-n",
    "mean-sem-n",
    "mean-sd",
    "mean-sem",
    "mean-cv-n",
    "mean-err",
    "mean-limits",
    "mean-range",
    "median-iqr",
    "geomean-sd",
    "mean-ci",
    "box-values",
  ];
  it("offers exactly the thirteen entry modes, in display order", () => {
    expect(ENTRY_MODE_OPTIONS.map((o) => o.id)).toEqual(EXPECTED);
  });
  it("every option carries both a descriptive and a compact label", () => {
    for (const o of ENTRY_MODE_OPTIONS) {
      expect(o.label.length).toBeGreaterThan(0);
      expect(o.short.length).toBeGreaterThan(0);
    }
  });
  it("ids are unique", () => {
    expect(new Set(ENTRY_MODE_OPTIONS.map((o) => o.id)).size).toBe(ENTRY_MODE_OPTIONS.length);
  });
});

describe("drawableErrorTypes / naturalErrorType — what an entry can actually draw", () => {
  const ds = (over: Partial<Dataset>): Dataset => ({ id: "d", name: "D", replicates: ["d"], ...over });
  it("raw replicates (≥2) draw every interval; the entered default is SD", () => {
    const many = ds({ replicates: ["a", "b", "c"] });
    expect(drawableErrorTypes(many)).toEqual(["sd", "sem", "ci95", "range", "geoSd", "iqr"]);
    expect(naturalErrorType(many)).toBe("sd");
  });
  it("a single replicate draws nothing (no spread)", () => {
    expect(drawableErrorTypes(ds({ replicates: ["a"] }))).toEqual([]);
    expect(naturalErrorType(ds({ replicates: ["a"] }))).toBe("none");
  });
  it("SD+N converts to SEM/CI; SD without N is SD only", () => {
    expect(drawableErrorTypes(ds({ sd: "s", n: "n" }))).toEqual(["sd", "sem", "ci95"]);
    expect(drawableErrorTypes(ds({ sd: "s" }))).toEqual(["sd"]);
    expect(naturalErrorType(ds({ sd: "s" }))).toBe("sd");
  });
  it("SEM entry leads with SEM (its natural type), converting only with N", () => {
    expect(drawableErrorTypes(ds({ sem: "e", n: "n" }))).toEqual(["sem", "sd", "ci95"]);
    expect(naturalErrorType(ds({ sem: "e", n: "n" }))).toBe("sem");
    expect(drawableErrorTypes(ds({ sem: "e" }))).toEqual(["sem"]);
  });
  it("%CV+N behaves like SD+N (CV → SD)", () => {
    expect(drawableErrorTypes(ds({ cv: "c", n: "n" }))).toEqual(["sd", "sem", "ci95"]);
    expect(drawableErrorTypes(ds({ cv: "c" }))).toEqual(["sd"]);
  });
  it("± value / lower-upper limits draw only the entered interval ('asymmetric')", () => {
    expect(drawableErrorTypes(ds({ errHigh: "h" }))).toEqual(["asymmetric"]);
    expect(drawableErrorTypes(ds({ errLow: "lo", errHigh: "hi" }))).toEqual(["asymmetric"]);
    expect(naturalErrorType(ds({ errLow: "lo", errHigh: "hi" }))).toBe("asymmetric");
  });
  it("pre-computed range / IQR / geometric / CI each draw exactly their one type", () => {
    expect(drawableErrorTypes(ds({ min: "lo", max: "hi" }))).toEqual(["range"]);
    expect(drawableErrorTypes(ds({ q1: "a", q3: "b" }))).toEqual(["iqr"]);
    expect(drawableErrorTypes(ds({ geoSd: "g" }))).toEqual(["geoSd"]);
    expect(drawableErrorTypes(ds({ ci: "c" }))).toEqual(["ci95"]);
    expect(naturalErrorType(ds({ q1: "a", q3: "b" }))).toBe("iqr");
    expect(naturalErrorType(ds({ geoSd: "g" }))).toBe("geoSd");
  });
});
