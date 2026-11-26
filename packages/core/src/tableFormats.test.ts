import { describe, expect, it } from "vitest";
import { TABLE_FORMAT_ORDER, tableFormat, tableFormatList, validateTable } from "./tableFormats";
import { tableDatasets, xColumn } from "./dataset";
import type { CellValue, DataTable, TableKind } from "./model";

/** Minimal DataTable (cells keyed by column id) from a positional grid. */
function makeTable(kind: TableKind, columnNames: string[], rows: CellValue[][]): DataTable {
  const columns = columnNames.map((n, i) => ({ id: `c${i}`, name: n }));
  return {
    id: "t1",
    kind,
    name: "T",
    columns,
    rows: rows.map((vals, r) => ({
      id: `r${r}`,
      cells: Object.fromEntries(columns.map((c, i) => [c.id, vals[i] ?? null])),
    })),
  };
}

describe("table-format registry", () => {
  it("describes all fifteen formats in display order", () => {
    expect(tableFormatList()).toHaveLength(15);
    expect(TABLE_FORMAT_ORDER).toEqual(["xy", "column", "grouped", "contingency", "survival", "partsofwhole", "multivariable", "pca", "nested", "sets", "timeline", "meta", "edgelist", "association", "alterations"]);
    for (const kind of TABLE_FORMAT_ORDER) {
      const f = tableFormat(kind);
      expect(f.kind).toBe(kind);
      expect(f.label.length).toBeGreaterThan(0);
      expect(f.seedColumns.length).toBeGreaterThan(0);
    }
  });

  it("advertises only implemented analyses — no phantom capabilities", () => {
    // Curated set of analysis capabilities that are implemented (engine method + an
    // AnalyzeDialog entry). "Multiple t tests" has no method anywhere in the app or engine, so
    // grouped tables must not advertise it. Adding a label here without a real method behind
    // it creates a phantom, so this set is the accuracy gate for the "Unlocks:" tooltip.
    // The badge phrases are the Analyze catalogue's own labels: the
    // renderer's guard (`dead-controls-and-formats.test`) checks every phrase against the methods
    // `methodFitsKind` ranks as suited to the format; this list stays as the core-side floor.
    const IMPLEMENTED = new Set([
      "Linear regression", "Curve fit", "Correlation", "Area under curve", "Interpolate a standard curve",
      "t test", "One-way ANOVA", "Descriptive statistics", "Normality tests", "Identify outliers",
      "Two-way ANOVA", "Repeated-measures ANOVA", "Mixed-effects model",
      "Contingency (χ² / Fisher)",
      "Survival (Kaplan-Meier)", "Cox regression",
      "Goodness-of-fit (χ² / binomial)",
      "Multiple linear regression", "Logistic regression", "Correlation matrix", "Principal component analysis (PCA)", "Cluster analysis",
      // The ordinations — engine methods "pcoa", "nmds", "ca" and "rda".
      "Principal coordinates (PCoA — any distance)", "Non-metric multidimensional scaling (NMDS)",
      "Correspondence analysis (CA — counts, sites + species)", "Redundancy analysis (RDA — constrained by explanatory variables)",
      "Nested ANOVA / nested t",
      // The meta sheet's statistics — engine methods "metaanalysis"
      // and "publicationbias" (Egger + trim-and-fill).
      "Meta-analysis (pool studies)", "Publication bias (Egger + trim-and-fill)",
    ]);
    for (const kind of TABLE_FORMAT_ORDER) {
      for (const label of tableFormat(kind).analyses) {
        expect(IMPLEMENTED.has(label), `${kind} advertises unimplemented analysis "${label}"`).toBe(true);
      }
    }
    expect(tableFormat("grouped").analyses).not.toContain("Multiple t tests");
  });

  it("offers replicate subcolumns for exactly the multi-value formats — column included", () => {
    // This one flag drives both the datasheet +/- control (panes.tsx `canReplicate`) and the
    // New-Graph popup (NewGraphDialog `showReplicates`). Column graphs (bar/box/violin/…) must
    // offer replicates like XY. Flip any of these and both surfaces move.
    const withReplicates = TABLE_FORMAT_ORDER.filter((k) => tableFormat(k).replicates);
    expect(withReplicates).toEqual(["xy", "column", "grouped", "nested"]);
    // The count/subject/slice/one-value-per-variable formats have no replicate concept.
    for (const k of ["contingency", "survival", "partsofwhole", "multivariable"] as const) {
      expect(tableFormat(k).replicates, `${k} must not offer replicates`).toBe(false);
    }
  });

  it("exposes Multiple-variables as the multivariate keystone format", () => {
    const mv = tableFormat("multivariable");
    expect(mv.label).toBe("Multiple variables");
    expect(mv.analyses.join(" ")).toMatch(/PCA|regression/i);
  });

  it("the column format has no lead column — just group columns, first group never eaten as X", () => {
    // A simple column sheet is the group columns themselves (one per group), values down the
    // rows — no leading label column. Tagged "y" so `xColumn()` finds no
    // implicit X and the first group (Control) survives as data, not as the axis.
    const col = tableFormat("column");
    expect(col.seedColumns).toEqual(["Control", "Treated"]);
    expect(col.seedRoles).toEqual(["y", "y"]);
    // Verify the outcome, not just the seed: build it and confirm no X + both groups survive.
    // (Drop `seedRoles` and this fails — Control is read as the axis and only Treated remains.)
    const t: DataTable = {
      id: "t", kind: "column", name: "T",
      columns: col.seedColumns.map((n, i) => ({ id: `c${i}`, name: n, ...(col.seedRoles?.[i] ? { role: col.seedRoles[i] } : {}) })),
      rows: [{ id: "r0", cells: { c0: 5, c1: 8 } }, { id: "r1", cells: { c0: 6, c1: 9 } }],
    };
    expect(xColumn(t)).toBeUndefined();
    expect(tableDatasets(t).map((d) => d.name)).toEqual(["Control", "Treated"]);
    // `nested` is a two-factor group format — it keeps its leading label column.
    expect(tableFormat("nested").seedColumns[0]).toBe("");
  });
});

describe("validateTable", () => {
  it("returns no warnings for XY and column tables with ordinary data", () => {
    expect(validateTable(makeTable("xy", ["X", "Y"], [[1, 2], [3, 4]]))).toEqual([]);
    expect(validateTable(makeTable("column", ["A", "B"], [[1, 2], [3, 4]]))).toEqual([]);
  });

  it("flags non-integer and negative contingency counts", () => {
    const ok = makeTable("contingency", ["", "Yes", "No"], [["A", 10, 5], ["B", 3, 12]]);
    expect(validateTable(ok)).toEqual([]);
    const bad = makeTable("contingency", ["", "Yes", "No"], [["A", 10.5, -2], ["B", 3, 12]]);
    const w = validateTable(bad);
    expect(w.some((m) => /negative/i.test(m))).toBe(true);
    expect(w.some((m) => /whole numbers/i.test(m))).toBe(true);
  });

  it("warns when a contingency table is too small — but not before any data is entered", () => {
    // A label column + a single count column can't make a 2×2 → report the count-column shortfall.
    expect(validateTable(makeTable("contingency", ["", "Yes"], [["A", 1], ["B", 2]]))).toContainEqual(
      expect.stringMatching(/2 count columns/i),
    );
    // Enough count columns, but too few rows — flagged only once data is being entered.
    expect(validateTable(makeTable("contingency", ["", "Yes", "No"], [["A", 1, 2]]))).toContainEqual(
      expect.stringMatching(/at least 2 rows/i),
    );
    // A fresh contingency sheet (2 count columns, no data yet) must not warn — a warning there
    // would falsely claim it needs 2 count columns when it already has them.
    expect(validateTable(makeTable("contingency", ["", "Yes", "No"], []))).toEqual([]);
  });

  it("contingency count checks read the outcome columns, not a numeric row label", () => {
    // Row labels that happen to be numbers (doses) or coded negatives are labels, not counts —
    // scanning column 0 would make the whole-number / negative checks fire falsely on them.
    const numLabels = makeTable("contingency", ["Dose", "Yes", "No"], [[2.5, 10, 5], [5, 8, 12]]);
    expect(validateTable(numLabels)).toEqual([]);
    const negLabels = makeTable("contingency", ["Code", "Yes", "No"], [[-1, 10, 5], [-2, 8, 12]]);
    expect(validateTable(negLabels)).toEqual([]);
    // …but a genuinely negative / fractional count still warns.
    const badCounts = makeTable("contingency", ["Dose", "Yes", "No"], [[2.5, 10.5, -3], [5, 8, 12]]);
    expect(validateTable(badCounts).some((m) => /negative/i.test(m))).toBe(true);
    expect(validateTable(badCounts).some((m) => /whole numbers/i.test(m))).toBe(true);
  });

  it("flags survival event columns that are not 1/0/blank", () => {
    const ok = makeTable("survival", ["Time", "Group A"], [[5, 1], [9, 0], [12, 1]]);
    expect(validateTable(ok)).toEqual([]);
    const bad = makeTable("survival", ["Time", "Group A"], [[5, 1], [9, 2]]);
    expect(validateTable(bad).some((m) => /1 \(event\), 0 \(censored\)/.test(m))).toBe(true);
  });

  it("flags negative parts-of-whole values", () => {
    expect(validateTable(makeTable("partsofwhole", ["Slice", "Whole"], [["a", 3], ["b", -1]]))).toContainEqual(
      expect.stringMatching(/cannot be negative/i),
    );
  });

  it("multivariable: needs ≥2 numeric variables; a lone categorical group column is fine", () => {
    const ok = makeTable("multivariable", ["Age", "BMI", "BP"], [[40, 22, 120], [55, 28, 140]]);
    expect(validateTable(ok)).toEqual([]);
    // ≥2 numeric variables + one categorical group column (Species / Diagnosis / Treatment) is the
    // normal PCA / parallel-coordinates / clustering shape. That group column is required as text —
    // the graphs colour and draw ellipses by it — so it must not be flagged. A rule that flagged
    // every text column would tell users to numeric-code it, which would destroy the grouping;
    // this case fails against such a rule.
    const grouped = makeTable("multivariable", ["Sepal L", "Petal L", "Species"], [[5.0, 1.5, "setosa"], [6.6, 5.6, "virginica"]]);
    expect(validateTable(grouped)).toEqual([]);
    // Fewer than 2 numeric variables → none of these analyses can run at all: warn.
    expect(validateTable(makeTable("multivariable", ["Age"], [[40], [55]]))).toContainEqual(
      expect.stringMatching(/at least 2 numeric variables/i),
    );
    const oneNumeric = makeTable("multivariable", ["Age", "Sex"], [[40, "M"], [55, "F"]]);
    expect(validateTable(oneNumeric).some((m) => /at least 2 numeric variables/i.test(m))).toBe(true);
  });

  /**
   * An XY sheet with a text X column is not flagged.
   *
   * Caution: do not add a "non-numeric X column" warning. validateTable sees only the table
   * and runs while the user is typing, before any graph or analysis exists. It therefore cannot
   * tell a dose-response sheet (which really does need a numeric X) from a labelled matrix —
   * genes x conditions, column 0 being row labels — which draws a correct heatmap. Such a warning
   * would tell every heatmap user their data was wrong (the New-graph wizard offers a heatmap on an
   * XY sheet). The complaint belongs where intent is known — running the analysis, which already
   * fails loudly ("regression needs >= 3 paired values").
   */
  it("xy: a text X column is not flagged; only the missing-Y structure is", () => {
    expect(validateTable(makeTable("xy", ["Dose", "Resp"], [[1, 10], [2, 20]]))).toEqual([]);
    // The exact shape of the demo's "Gene expression" heatmap sheet: text row labels + numbers.
    const matrix = makeTable("xy", ["Gene", "Ctrl", "Drug"], [["GeneA", 1, 2], ["GeneB", 3, 4]]);
    expect(validateTable(matrix), "a labelled matrix must not be told its data is wrong").toEqual([]);
    // …and a two-column text-X sheet is equally fine.
    const textX = makeTable("xy", ["Group", "Resp"], [["low", 10], ["high", 20]]);
    expect(validateTable(textX).join(" "), "a text X column is flagged as needing numbers").not.toMatch(/numeric|is text/i);
    // Structure is still checked — that is knowable without knowing intent.
    expect(validateTable(makeTable("xy", ["X"], [[1], [2]])).some((m) => /at least one Y/i.test(m))).toBe(true);
  });

  it("column / grouped / nested: warn when too few group columns", () => {
    expect(validateTable(makeTable("column", ["", "Control", "Treated"], [[1, 2, 3]]))).toEqual([]);
    expect(validateTable(makeTable("column", ["Labels"], [[1]])).some((m) => /at least two group columns/i.test(m))).toBe(true);
    // grouped needs ≥2 group columns (the column grouping factor)
    expect(validateTable(makeTable("grouped", ["", "G1", "G2"], [["a", 1, 2]]))).toEqual([]);
    expect(validateTable(makeTable("grouped", ["", "G1"], [["a", 1]])).some((m) => /at least two group columns/i.test(m))).toBe(true);
    // nested needs ≥2 group columns…
    expect(validateTable(makeTable("nested", ["", "G1"], [["a", 1]])).some((m) => /at least two group columns/i.test(m))).toBe(true);
    // …and each group needs replicate subcolumns — a single value per group has nothing to nest
    expect(validateTable(makeTable("nested", ["", "G1", "G2"], [["a", 1, 2]])).some((m) => /replicate subcolumns/i.test(m))).toBe(true);
    // with proper subcolumns (G1→g1+g1b, G2→g2+g2b) the nesting is defined → no warning
    const nestedOk: DataTable = {
      id: "t1", kind: "nested", name: "T",
      columns: [
        { id: "lab", name: "" },
        { id: "g1", name: "G1" }, { id: "g1b", name: "G1", group: "g1" },
        { id: "g2", name: "G2" }, { id: "g2b", name: "G2", group: "g2" },
      ],
      rows: [{ id: "r0", cells: { lab: "a", g1: 1, g1b: 2, g2: 3, g2b: 4 } }],
    };
    expect(validateTable(nestedOk)).toEqual([]);
  });
});
