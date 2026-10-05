// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { DataTable } from "@mady/core";
import { createSampleDocument, tableDatasets } from "@mady/core";
import { buildPlotScene } from "@mady/graphics";
import {
  buildAnalysisData,
  buildLetterAnnotations,
  buildPcaScorePlot,
  buildSignificanceBrackets,
  columnMode,
  columnValues,
  compactLetterDisplay,
  datasetPointSD,
  datasetValues,
  datasetXY,
  defaultAnalysisName,
  detectEquationParams,
  isXYMethod,
  analysesBoundTo,
  planAnalysisMarkers,
  ANALYSIS_GUIDANCE,
  METHOD_GROUPS,
  METHOD_INFO,
  significantPairs,
} from "./analysis";

const table: DataTable = {
  id: "t",
  kind: "xy",
  name: "T",
  columns: [
    { id: "x", name: "Dose" },
    { id: "y", name: "Response" },
  ],
  rows: [
    { id: "r1", cells: { x: 1, y: 10 } },
    { id: "r2", cells: { x: 2, y: "20" } }, // numeric string → counted
    { id: "r3", cells: { x: 3, y: null } }, // blank → skipped
    { id: "r4", cells: { x: 4, y: "abc" } }, // non-numeric → skipped
  ],
};

describe("columnValues", () => {
  it("returns finite numbers only (parses numeric strings, skips blanks/text)", () => {
    expect(columnValues(table, "x")).toEqual([1, 2, 3, 4]);
    expect(columnValues(table, "y")).toEqual([10, 20]);
  });
});

describe("columnMode", () => {
  it("picks one / two / many per method", () => {
    expect(columnMode("describe")).toBe("one");
    expect(columnMode("ttest", "one-sample")).toBe("one");
    expect(columnMode("ttest", "unpaired")).toBe("two");
    expect(columnMode("correlation")).toBe("two");
    expect(columnMode("regression")).toBe("two");
    expect(columnMode("anova")).toBe("many");
  });
});

describe("detectEquationParams (mirrors the engine's user-equation compiler)", () => {
  it("detects parameters in first-appearance order, deduped, excluding X", () => {
    expect(detectEquationParams("Vmax*X/(KM+X)")).toEqual(["Vmax", "KM"]);
    expect(detectEquationParams("A*X + B")).toEqual(["A", "B"]);
    // repeated names collapse; order follows first appearance.
    expect(detectEquationParams("Top + (Bottom-Top)/(1+(X/EC50)^Hill)")).toEqual(["Top", "Bottom", "EC50", "Hill"]);
  });
  it("strips a leading Y = / y = / f(x) = so the LHS name isn't a parameter", () => {
    expect(detectEquationParams("Y = m*X + c")).toEqual(["m", "c"]);
    expect(detectEquationParams("f(x) = A*exp(-k*X)")).toEqual(["A", "k"]);
  });
  it("excludes X (any case), the constants pi/e, and function names", () => {
    // exp/ln/sqrt/sin are functions, not parameters; pi/e are constants.
    expect(detectEquationParams("A*exp(-k*x) + C*ln(x)")).toEqual(["A", "k", "C"]);
    expect(detectEquationParams("A*sin(2*pi*X) + e")).toEqual(["A"]);
    expect(detectEquationParams("amp*sqrt(X)")).toEqual(["amp"]);
  });
  it("returns [] for an empty or parameter-free equation", () => {
    expect(detectEquationParams("")).toEqual([]);
    expect(detectEquationParams("   ")).toEqual([]);
    expect(detectEquationParams("sin(X)")).toEqual([]); // only X + a function
  });
});

describe("buildAnalysisData — equivalence (TOST)", () => {
  it("unpaired → both groups plus the resolved bound parameters", () => {
    expect(
      buildAnalysisData("equivalence", { columns: ["x", "y"], variant: "unpaired", bound: 0.5, boundMode: "sd" }, table),
    ).toEqual({ variant: "unpaired", a: [1, 2, 3, 4], b: [10, 20], bound: 0.5, boundMode: "sd" });
  });

  it("one-sample sends the reference value, not a second group", () => {
    const d = buildAnalysisData("equivalence", { columns: ["x"], variant: "one-sample", mu: 2, bound: 1 }, table) as Record<string, unknown>;
    expect(d).toEqual({ variant: "one-sample", a: [1, 2, 3, 4], mu: 2, bound: 1 });
    expect(d["b"]).toBeUndefined();
  });

  it("paired keeps row-aligned pairs — a blank on either side drops that pair, not the row's partner", () => {
    // Rows 3 and 4 have no usable Y, so only rows 1-2 form pairs. Pooling each column
    // independently would pair x=3 with nothing and silently misalign everything after it.
    expect(
      buildAnalysisData("equivalence", { columns: ["x", "y"], variant: "paired", bound: 0.5 }, table),
    ).toEqual({ variant: "paired", a: [1, 2], b: [10, 20], bound: 0.5 });
  });

  it("omits bound parameters that were not set, rather than inventing defaults", () => {
    const d = buildAnalysisData("equivalence", { columns: ["x", "y"], variant: "unpaired" }, table) as Record<string, unknown>;
    expect(d["bound"]).toBeUndefined();
    expect(d["boundMode"]).toBeUndefined();
    expect(d["alpha"]).toBeUndefined();
  });
});

describe("buildAnalysisData — bayesfactor", () => {
  it("unpaired → two groups plus the prior scale", () => {
    expect(
      buildAnalysisData("bayesfactor", { columns: ["x", "y"], variant: "unpaired", rscale: "wide" }, table),
    ).toEqual({ variant: "unpaired", a: [1, 2, 3, 4], b: [10, 20], rscale: "wide" });
  });

  it("paired pairs by row, like every other paired design", () => {
    expect(
      buildAnalysisData("bayesfactor", { columns: ["x", "y"], variant: "paired" }, table),
    ).toEqual({ variant: "paired", a: [1, 2], b: [10, 20] });
  });

  it("one-sample sends the reference value and no second group", () => {
    const d = buildAnalysisData("bayesfactor", { columns: ["x"], variant: "one-sample", mu: 1 }, table) as Record<string, unknown>;
    expect(d).toEqual({ variant: "one-sample", a: [1, 2, 3, 4], mu: 1 });
    expect(d["b"]).toBeUndefined();
  });

  it("omits the prior scale when unset, letting the engine own the default", () => {
    const d = buildAnalysisData("bayesfactor", { columns: ["x", "y"], variant: "unpaired" }, table) as Record<string, unknown>;
    expect(d["rscale"]).toBeUndefined();
  });
});

describe("buildAnalysisData — permutation", () => {
  it("unpaired → two pooled groups plus the resampling controls", () => {
    expect(
      buildAnalysisData("permutation", { columns: ["x", "y"], variant: "unpaired", nResamples: 5000, seed: 7 }, table),
    ).toEqual({ variant: "unpaired", a: [1, 2, 3, 4], b: [10, 20], tail: "two-sided", nResamples: 5000, seed: 7 });
  });

  it("correlation pairs by row — shuffling needs the pairing intact, not pooled columns", () => {
    // Only rows 1-2 have both values. Pooling independently would give a=[1,2,3,4] and
    // b=[10,20], pairing x=3 and x=4 with nothing — and a correlation permutation test
    // on mismatched lengths is meaningless.
    expect(
      buildAnalysisData("permutation", { columns: ["x", "y"], variant: "correlation" }, table),
    ).toEqual({ variant: "correlation", a: [1, 2], b: [10, 20], tail: "two-sided" });
  });

  it("paired pairs by row too", () => {
    expect(
      buildAnalysisData("permutation", { columns: ["x", "y"], variant: "paired" }, table),
    ).toEqual({ variant: "paired", a: [1, 2], b: [10, 20], tail: "two-sided" });
  });

  it("one-sample sends the reference value and no second group", () => {
    const d = buildAnalysisData("permutation", { columns: ["x"], variant: "one-sample", mu: 3 }, table) as Record<string, unknown>;
    expect(d).toEqual({ variant: "one-sample", a: [1, 2, 3, 4], mu: 3, tail: "two-sided" });
    expect(d["b"]).toBeUndefined();
  });

  it("carries the tail through, so a one-sided permutation is not silently two-sided", () => {
    const d = buildAnalysisData("permutation", { columns: ["x", "y"], variant: "unpaired", tail: "greater" }, table) as Record<string, unknown>;
    expect(d["tail"]).toBe("greater");
  });
});

describe("buildAnalysisData — ANOVA / correlation / regression", () => {
  it("anova → groups + labels", () => {
    expect(buildAnalysisData("anova", { columns: ["x", "y"], variant: "kruskal" }, table)).toEqual({
      variant: "kruskal",
      groups: [[1, 2, 3, 4], [10, 20]],
      labels: ["Dose", "Response"],
      posthoc: "tukey",
      scheme: "all-pairs",
      control: 0,
    });
  });
  it("correlation/regression pair X with Y per row (incomplete rows dropped)", () => {
    // rows 3,4 have blank/non-numeric Y → no (x,y) pair (proper pairing).
    expect(buildAnalysisData("correlation", { columns: ["x", "y"], variant: "spearman" }, table)).toEqual({
      variant: "spearman",
      a: [1, 2],
      b: [10, 20],
      tail: "two-sided",
      conf: undefined,
    });
    expect(buildAnalysisData("regression", { columns: ["x", "y"] }, table)).toEqual({ x: [1, 2], y: [10, 20], variant: "ols", conf: undefined });
    // Weighting + force-through-a-point flow into the regression payload.
    expect(buildAnalysisData("regression", { columns: ["x", "y"], weighting: "1/Y2", conf: 0.9 }, table))
      .toMatchObject({ variant: "ols", weighting: "1/Y2", conf: 0.9 });
    expect(buildAnalysisData("regression", { columns: ["x", "y"], variant: "point", throughPoint: { x: 2, y: 3 } }, table))
      .toMatchObject({ variant: "point", throughPoint: { x: 2, y: 3 } });
    // "none" weighting is omitted (stays plain OLS).
    expect(buildAnalysisData("regression", { columns: ["x", "y"], weighting: "none" }, table)).not.toHaveProperty("weighting");
  });
  it("ancova builds one (label, x, y) group per dataset, X = the first column", () => {
    expect(buildAnalysisData("ancova", { columns: ["y"] }, table)).toEqual({
      groups: [{ label: "Response", x: [1, 2], y: [10, 20] }],
    });
  });
  it("corrmatrix passes row-aligned variable columns (nulls kept for pairwise-complete)", () => {
    expect(buildAnalysisData("corrmatrix", { columns: ["x", "y"], variant: "pearson" }, table)).toEqual({
      variant: "pearson",
      columns: [
        [1, 2, 3, 4],
        [10, 20, null, null], // "abc"/blank → null, alignment preserved
      ],
      labels: ["Dose", "Response"],
    });
  });
  it("cluster passes row-aligned variable columns + k-means/hierarchical params (defaults filled)", () => {
    expect(buildAnalysisData("cluster", { columns: ["x", "y"], variant: "kmeans", k: 4 }, table)).toEqual({
      columns: [
        [1, 2, 3, 4],
        [10, 20, null, null],
      ],
      labels: ["Dose", "Response"],
      variant: "kmeans",
      k: 4,
      standardize: true,
      seed: 20240704,
      metric: "euclidean",
      linkage: "ward",
    });
    // hierarchical variant carries its linkage/metric through.
    const h = buildAnalysisData("cluster", { columns: ["x", "y"], variant: "hierarchical", k: 2, linkage: "average", metric: "correlation", standardize: false }, table) as Record<string, unknown>;
    expect(h["variant"]).toBe("hierarchical");
    expect(h["linkage"]).toBe("average");
    expect(h["metric"]).toBe("correlation");
    expect(h["standardize"]).toBe(false);
  });
  it("outliers passes one dataset's values + Grubbs variant + default alpha", () => {
    expect(buildAnalysisData("outliers", { columns: ["y"], variant: "single" }, table)).toEqual({
      values: [10, 20],
      variant: "single",
      alpha: 0.05,
    });
  });
  it("outliers ROUT variant passes Q (default 1%) instead of alpha", () => {
    expect(buildAnalysisData("outliers", { columns: ["y"], variant: "rout" }, table)).toEqual({
      values: [10, 20],
      variant: "rout",
      Q: 0.01,
    });
    // conf drives Q for ROUT: 95% → Q 0.05 (float subtraction, so check closely).
    const r = buildAnalysisData("outliers", { columns: ["y"], variant: "rout", conf: 0.95 }, table) as {
      values: number[];
      variant: string;
      Q: number;
    };
    expect(r.values).toEqual([10, 20]);
    expect(r.variant).toBe("rout");
    expect(r.Q).toBeCloseTo(0.05, 10);
  });
  it("cox maps [time, event, ...predictors] to the engine payload", () => {
    const t3: DataTable = {
      id: "t3",
      kind: "multivariable",
      name: "S",
      columns: [
        { id: "tm", name: "Time" },
        { id: "ev", name: "Event" },
        { id: "age", name: "Age" },
      ],
      rows: [
        { id: "a", cells: { tm: 5, ev: 1, age: 60 } },
        { id: "b", cells: { tm: 8, ev: 0, age: 70 } },
      ],
    };
    expect(buildAnalysisData("cox", { columns: ["tm", "ev", "age"], conf: 0.95 }, t3)).toEqual({
      time: [5, 8],
      event: [1, 0],
      predictors: [[60, 70]],
      names: ["Age"],
      conf: 0.95,
    });
  });
  it("goodnessoffit reads value→observed + x-column→labels, skipping blank observed rows", () => {
    const pw: DataTable = {
      id: "pw", kind: "partsofwhole", name: "P",
      columns: [{ id: "s", name: "Slice", role: "x" }, { id: "v", name: "Count" }],
      rows: [
        { id: "r1", cells: { s: "A", v: 10 } },
        { id: "r2", cells: { s: "", v: 5 } }, // blank label → "Category 2" (uses the row index)
        { id: "r3", cells: { s: "C", v: null } }, // blank observed → skipped entirely (label too)
        { id: "r4", cells: { s: "D", v: 8 } },
      ],
    };
    expect(buildAnalysisData("goodnessoffit", { columns: ["v"] }, pw)).toEqual({
      observed: [10, 5, 8],
      labels: ["A", "Category 2", "D"],
    });
  });

  const mv: DataTable = {
    id: "mv", kind: "multivariable", name: "M",
    columns: [{ id: "out", name: "Outcome" }, { id: "a", name: "Age" }, { id: "b", name: "BMI" }],
    rows: [{ id: "r1", cells: { out: 1, a: 60, b: 22 } }, { id: "r2", cells: { out: 0, a: 70, b: 28 } }],
  };
  it("multiple/logistic/poisson map [outcome, ...predictors] to the engine payload", () => {
    for (const method of ["multipleregression", "logistic", "poisson"] as const) {
      expect(buildAnalysisData(method, { columns: ["out", "a", "b"], conf: 0.95 }, mv)).toEqual({
        y: [1, 0],
        predictors: [[60, 70], [22, 28]],
        labels: ["Age", "BMI"],
        outcomeLabel: "Outcome",
        conf: 0.95,
      });
    }
  });
  it("pca maps each selected column to a row-aligned variable + the standardize flag", () => {
    expect(buildAnalysisData("pca", { columns: ["a", "b"], variant: "standardize" }, mv)).toEqual({
      columns: [[60, 70], [22, 28]],
      labels: ["Age", "BMI"],
      standardize: true,
    });
  });

  it("auc pairs X with Y and carries the baseline via variant", () => {
    expect(buildAnalysisData("auc", { columns: ["x", "y"], variant: "min" }, table)).toEqual({
      x: [1, 2],
      y: [10, 20],
      baseline: "min",
    });
    // default baseline = zero when no variant chosen
    expect(buildAnalysisData("auc", { columns: ["x", "y"] }, table)).toEqual({
      x: [1, 2],
      y: [10, 20],
      baseline: "zero",
    });
  });
});

describe("buildAnalysisData", () => {
  it("describe/normality → values", () => {
    expect(buildAnalysisData("describe", { columns: ["y"] }, table)).toEqual({ values: [10, 20], conf: undefined });
  });
  it("one-sample t → a + mu", () => {
    expect(buildAnalysisData("ttest", { columns: ["x"], variant: "one-sample", mu: 2 }, table)).toEqual({
      variant: "one-sample",
      a: [1, 2, 3, 4],
      mu: 2,
      conf: undefined,
      tail: "two-sided",
    });
  });
  it("two-group t → a + b", () => {
    expect(buildAnalysisData("ttest", { columns: ["x", "y"], variant: "welch" }, table)).toEqual({
      variant: "welch",
      a: [1, 2, 3, 4],
      b: [10, 20],
      conf: undefined,
      tail: "two-sided",
    });
  });
  it("paired t row-aligns complete pairs (interior blanks in either column don't misalign)", () => {
    const t: DataTable = {
      id: "pt", kind: "column", name: "P",
      columns: [{ id: "c0", name: "Before" }, { id: "c1", name: "After" }],
      rows: [
        { id: "r1", cells: { c0: 1, c1: 10 } },
        { id: "r2", cells: { c0: 2, c1: null } }, // After blank → drop the pair
        { id: "r3", cells: { c0: null, c1: 30 } }, // Before blank → drop the pair
        { id: "r4", cells: { c0: 4, c1: 40 } },
        { id: "r5", cells: { c0: 5, c1: 50 } },
      ],
    };
    // Pooling each column independently would give a=[1,2,4,5], b=[10,30,40,50] (misaligned).
    expect(buildAnalysisData("ttest", { columns: ["c0", "c1"], variant: "paired" }, t)).toEqual({
      variant: "paired", a: [1, 4, 5], b: [10, 40, 50], conf: undefined, tail: "two-sided",
    });
    // Wilcoxon signed-rank + ratio-paired t are also paired → same alignment.
    expect(buildAnalysisData("ttest", { columns: ["c0", "c1"], variant: "wilcoxon" }, t)).toMatchObject({ a: [1, 4, 5], b: [10, 40, 50] });
    // Unpaired variants use independent complete-case per column.
    expect(buildAnalysisData("ttest", { columns: ["c0", "c1"], variant: "welch" }, t)).toMatchObject({ a: [1, 2, 4, 5], b: [10, 30, 40, 50] });
  });
  it("curvetransform passes x/y + variant (+ optional smoothing window)", () => {
    expect(buildAnalysisData("curvetransform", { columns: ["x", "y"], variant: "integrate" }, table)).toEqual({
      x: [1, 2], y: [10, 20], variant: "integrate",
    });
    expect(buildAnalysisData("curvetransform", { columns: ["x", "y"], variant: "smooth", smoothWindow: 7 }, table))
      .toMatchObject({ variant: "smooth", smoothWindow: 7 });
    // no window → the key is omitted (engine picks an automatic window)
    expect(buildAnalysisData("curvetransform", { columns: ["x", "y"], variant: "smooth" }, table)).not.toHaveProperty("smoothWindow");
  });
  it("interpolate → complete rows are standards; blank-Y rows become unknownsX", () => {
    // table: r1/r2 complete (standards), r3 (y=null) + r4 (y=\"abc\"→null) → unknown X.
    expect(buildAnalysisData("interpolate", { columns: ["x", "y"], variant: "linear" }, table)).toEqual({
      model: "linear",
      x: [1, 2],
      y: [10, 20],
      weighting: "none",
      unknownsY: [],
      unknownsX: [3, 4],
      conf: undefined,
    });
  });
});

describe("defaultAnalysisName", () => {
  it("names from method + dataset names", () => {
    expect(defaultAnalysisName("describe", { columns: ["y"] }, table)).toBe("Descriptives — Response");
    expect(defaultAnalysisName("ttest", { columns: ["x", "y"], variant: "welch" }, table)).toBe(
      "Welch t — Dose vs Response",
    );
  });
});

// A table with two Y datasets, each carrying replicate subcolumns.
const repTable: DataTable = {
  id: "rt",
  kind: "xy",
  name: "RT",
  columns: [
    { id: "x", name: "Dose", role: "x" },
    { id: "a1", name: "Drug A", role: "y" },
    { id: "a2", name: "A2", role: "y", group: "a1" },
    { id: "b1", name: "Drug B", role: "y" },
    { id: "b2", name: "B2", role: "y", group: "b1" },
  ],
  rows: [
    { id: "r1", cells: { x: 1, a1: 10, a2: 12, b1: 5, b2: 7 } },
    { id: "r2", cells: { x: 2, a1: 20, a2: 22, b1: 8, b2: null } }, // one blank replicate
  ],
};

describe("datasetValues / datasetXY — pool replicates", () => {
  it("pools a dataset's replicate subcolumns row-major, skipping blanks", () => {
    expect(datasetValues(repTable, "a1")).toEqual([10, 12, 20, 22]);
    expect(datasetValues(repTable, "b1")).toEqual([5, 7, 8]); // r2 b2 blank → skipped
    expect(datasetValues(repTable, "x")).toEqual([1, 2]); // X column → its own values
  });

  it("expands XY pairs: each row's X with every replicate Y", () => {
    expect(datasetXY(repTable, "x", "a1")).toEqual({ x: [1, 1, 2, 2], y: [10, 12, 20, 22] });
    expect(datasetXY(repTable, "x", "b1")).toEqual({ x: [1, 1, 2], y: [5, 7, 8] });
  });
});

describe("datasetPointSD — per-point SD for 1/SD² weighting", () => {
  const summary: DataTable = {
    id: "sm", kind: "xy", name: "SM",
    columns: [
      { id: "x", name: "X", role: "x" },
      { id: "m", name: "Mean", role: "y" },
      { id: "s", name: "SD", role: "sd", group: "m" },
    ],
    rows: [
      { id: "r1", cells: { x: 1, m: 10, s: 1.5 } },
      { id: "r2", cells: { x: 2, m: 20, s: 0.5 } },
    ],
  };

  it("uses the entered SD column for summary data — one point per row, aligned to (x,y)", () => {
    expect(datasetPointSD(summary, "x", "m")).toEqual([1.5, 0.5]);
    expect(datasetPointSD(summary, "x", "m")!.length).toBe(datasetXY(summary, "x", "m").x.length);
  });

  it("falls back to the per-row replicate scatter when there is no SD column", () => {
    // repTable dataset a1: each row has replicates [v, v+2] ⇒ sample SD = √2; four points.
    const sd = datasetPointSD(repTable, "x", "a1")!;
    expect(sd).toHaveLength(datasetXY(repTable, "x", "a1").x.length); // 4, aligned
    expect(sd.every((v) => Math.abs(v - Math.SQRT2) < 1e-9)).toBe(true);
  });

  it("returns null when any point lacks a usable SD (a single replicate / blank SD cell)", () => {
    // repTable dataset b1: row r2 has only one replicate (b2 blank) ⇒ no SD ⇒ null.
    expect(datasetPointSD(repTable, "x", "b1")).toBeNull();
    // summary with a blank SD cell ⇒ null (can't 1/SD²-weight that point).
    const blank: DataTable = { ...summary, rows: [summary.rows[0]!, { id: "r2", cells: { x: 2, m: 20, s: null } }] };
    expect(datasetPointSD(blank, "x", "m")).toBeNull();
  });
});

describe("buildAnalysisData — replicate datasets", () => {
  it("t-test pools each dataset's replicates as the two samples", () => {
    expect(buildAnalysisData("ttest", { columns: ["a1", "b1"], variant: "unpaired" }, repTable)).toEqual({
      variant: "unpaired",
      a: [10, 12, 20, 22],
      b: [5, 7, 8],
      conf: undefined,
      tail: "two-sided",
    });
  });
  it("ANOVA groups = pooled replicates, labelled by dataset name", () => {
    expect(buildAnalysisData("anova", { columns: ["a1", "b1"] }, repTable)).toEqual({
      variant: "anova",
      groups: [[10, 12, 20, 22], [5, 7, 8]],
      labels: ["Drug A", "Drug B"],
      posthoc: "tukey",
      scheme: "all-pairs",
      control: 0,
    });
  });
  it("curve fit expands replicates into (x, y) pairs", () => {
    expect(buildAnalysisData("curvefit", { columns: ["x", "a1"], variant: "4pl" }, repTable)).toEqual({
      model: "4pl",
      x: [1, 1, 2, 2],
      y: [10, 12, 20, 22],
      weighting: "none",
    });
    // a chosen weighting scheme passes through to the engine payload.
    expect(buildAnalysisData("curvefit", { columns: ["x", "a1"], variant: "mm", weighting: "1/Y2" }, repTable))
      .toMatchObject({ model: "mm", weighting: "1/Y2" });
    // ROUT (automatic outlier removal) rides along when requested; omitted otherwise.
    expect(buildAnalysisData("curvefit", { columns: ["x", "a1"], variant: "4pl", rout: true }, repTable))
      .toMatchObject({ model: "4pl", rout: true });
    expect(buildAnalysisData("curvefit", { columns: ["x", "a1"], variant: "4pl" }, repTable)).not.toHaveProperty("rout");
    // Constraints: fix-to-value + per-parameter bounds flow into the payload.
    expect(buildAnalysisData("curvefit", { columns: ["x", "a1"], variant: "4pl", fixed: { Bottom: 0 }, paramBounds: { "Hill slope": [0.5, 1.5] } }, repTable))
      .toMatchObject({ model: "4pl", fixed: { Bottom: 0 }, paramBounds: { "Hill slope": [0.5, 1.5] } });
    // no constraints → the keys are omitted.
    expect(buildAnalysisData("curvefit", { columns: ["x", "a1"], variant: "4pl" }, repTable)).not.toHaveProperty("fixed");
  });
  it("user-defined (custom) fit forwards the equation + initial values as model:custom", () => {
    const p = buildAnalysisData(
      "curvefit",
      { columns: ["x", "a1"], variant: "custom", equation: "A*X+B", initialValues: { A: 2, B: 1 } },
      repTable,
    );
    expect(p).toMatchObject({ model: "custom", equation: "A*X+B", initialValues: { A: 2, B: 1 } });
    // the equation/initialValues keys only ride along with the custom variant.
    expect(buildAnalysisData("curvefit", { columns: ["x", "a1"], variant: "4pl", equation: "A*X+B" }, repTable))
      .not.toHaveProperty("equation");
  });
  it("global fit builds one {label,x,y} per dataset (shared X) + the shared list", () => {
    const t: DataTable = {
      id: "t", kind: "xy", name: "T",
      columns: [{ id: "x", name: "Dose" }, { id: "A", name: "Drug A" }, { id: "B", name: "Drug B" }],
      rows: [
        { id: "r1", cells: { x: 1, A: 10, B: 5 } },
        { id: "r2", cells: { x: 2, A: 20, B: 9 } },
      ],
    };
    expect(buildAnalysisData("globalfit", { columns: ["A", "B"], variant: "4pl", shared: ["Bottom", "Top"] }, t)).toEqual({
      model: "4pl",
      datasets: [
        { label: "Drug A", x: [1, 2], y: [10, 20] },
        { label: "Drug B", x: [1, 2], y: [5, 9] },
      ],
      shared: ["Bottom", "Top"],
      weighting: "none",
    });
    // With a per-dataset constant (enzyme inhibition): each curve carries its [I] as `consts`.
    expect(
      buildAnalysisData(
        "globalfit",
        { columns: ["A", "B"], variant: "competitive_inhibition", shared: ["Vmax", "KM", "Ki"], consts: { A: 0, B: 10 } },
        t,
      ),
    ).toEqual({
      model: "competitive_inhibition",
      datasets: [
        { label: "Drug A", x: [1, 2], y: [10, 20], consts: [0] },
        { label: "Drug B", x: [1, 2], y: [5, 9], consts: [10] },
      ],
      shared: ["Vmax", "KM", "Ki"],
      weighting: "none",
    });
  });
});

describe("buildAnalysisData — survival", () => {
  // survival table: X = time; each group column holds 1 (event) / 0 (censored).
  const sv: DataTable = {
    id: "sv",
    kind: "xy",
    name: "SV",
    columns: [
      { id: "t", name: "Weeks" },
      { id: "drug", name: "Drug" },
      { id: "ctrl", name: "Control" },
    ],
    rows: [
      { id: "r1", cells: { t: 6, drug: 1, ctrl: null } }, // drug subject, event
      { id: "r2", cells: { t: 9, drug: 0, ctrl: null } }, // drug subject, censored
      { id: "r3", cells: { t: 3, drug: null, ctrl: 1 } }, // control subject, event
      { id: "r4", cells: { t: 5, drug: null, ctrl: 1 } }, // control subject, event
    ],
  };

  it("splits subjects into groups by which column is filled (time from X, event from the cell)", () => {
    expect(buildAnalysisData("survival", { columns: ["drug", "ctrl"] }, sv)).toEqual({
      groups: [
        { label: "Drug", time: [6, 9], event: [1, 0] },
        { label: "Control", time: [3, 5], event: [1, 1] },
      ],
    });
  });

  it("resolves the time column when the table is reordered (group first) + coerces non-0/1 events", () => {
    // Group column at col 0; the time ("Weeks") is col 1. Reading columns[0] would take the
    // group as the time — the resolver must find the intended time column.
    const reordered: DataTable = {
      id: "sv2", kind: "survival", name: "SV2",
      columns: [
        { id: "drug", name: "Drug" },
        { id: "t", name: "Weeks" },
      ],
      rows: [
        { id: "r1", cells: { drug: 1, t: 6 } }, // event at week 6
        { id: "r2", cells: { drug: 2, t: 9 } }, // a non-0/1 code → treated as censored (0)
      ],
    };
    expect(buildAnalysisData("survival", { columns: ["drug"] }, reordered)).toEqual({
      groups: [{ label: "Drug", time: [6, 9], event: [1, 0] }],
    });
  });

  it("survival is a many-column method named from its columns", () => {
    expect(columnMode("survival")).toBe("many");
    expect(defaultAnalysisName("survival", { columns: ["drug", "ctrl"] }, sv)).toBe("Survival — Drug, Control");
  });
});

describe("buildAnalysisData — repeated-measures ANOVA", () => {
  // rows = subjects; columns = conditions (within-subjects).
  const rm: DataTable = {
    id: "rm",
    kind: "xy",
    name: "RM",
    columns: [
      { id: "c1", name: "Pre" },
      { id: "c2", name: "Mid" },
      { id: "c3", name: "Post" },
    ],
    rows: [
      { id: "s1", cells: { c1: 8, c2: 7, c3: 6 } },
      { id: "s2", cells: { c1: 5, c2: 6, c3: 4 } },
      { id: "s3", cells: { c1: 6, c2: 5, c3: null } }, // incomplete subject → dropped
    ],
  };

  it("builds subject×condition rows (complete cases only) + condition labels", () => {
    expect(buildAnalysisData("rmanova", { columns: ["c1", "c2", "c3"] }, rm)).toEqual({
      data: [
        [8, 7, 6],
        [5, 6, 4],
      ],
      labels: ["Pre", "Mid", "Post"],
    });
  });

  it("RM ANOVA is a many-column method named from its columns", () => {
    expect(columnMode("rmanova")).toBe("many");
    expect(defaultAnalysisName("rmanova", { columns: ["c1", "c2", "c3"] }, rm)).toBe("RM ANOVA — Pre, Mid, Post");
  });
});

describe("buildAnalysisData — two-way ANOVA", () => {
  // X = factor-A levels (rows); two datasets (A, B), each with one replicate subcolumn.
  const tw: DataTable = {
    id: "tw",
    kind: "xy",
    name: "TW",
    columns: [
      { id: "x", name: "Time", role: "x" },
      { id: "a1", name: "Drug A", role: "y" },
      { id: "a2", name: "A2", role: "y", group: "a1" },
      { id: "b1", name: "Drug B", role: "y" },
      { id: "b2", name: "B2", role: "y", group: "b1" },
    ],
    rows: [
      { id: "r1", cells: { x: 1, a1: 1, a2: 2, b1: 3, b2: 4 } },
      { id: "r2", cells: { x: 2, a1: 5, a2: 6, b1: 7, b2: 8 } },
    ],
  };

  it("builds cells[rowA][colB] from each dataset's replicates, with row/col labels", () => {
    expect(buildAnalysisData("twoway", { columns: ["a1", "b1"] }, tw)).toEqual({
      cells: [
        [[1, 2], [3, 4]],
        [[5, 6], [7, 8]],
      ],
      rowLabels: ["1", "2"],
      colLabels: ["Drug A", "Drug B"],
    });
  });

  it("two-way is a many-column method named from its columns", () => {
    expect(columnMode("twoway")).toBe("many");
    expect(defaultAnalysisName("twoway", { columns: ["a1", "b1"] }, tw)).toBe("Two-way ANOVA — Drug A, Drug B");
  });
});

describe("buildAnalysisData — multifactor ANOVA", () => {
  const mv: DataTable = {
    id: "mv", kind: "multivariable", name: "MV",
    columns: [
      { id: "y", name: "Yield", role: "y" },
      { id: "diet", name: "Diet", role: "y" },
      { id: "sex", name: "Sex", role: "y" },
    ],
    rows: [
      { id: "r1", cells: { y: 10, diet: "lo", sex: "M" } },
      { id: "r2", cells: { y: 12, diet: "hi", sex: "F" } },
      { id: "r3", cells: { y: 8, diet: "lo", sex: "F" } },
    ],
  };

  it("maps [value, ...factors] — the value numeric, the factor levels kept as raw cell values", () => {
    expect(buildAnalysisData("multifactor", { columns: ["y", "diet", "sex"] }, mv)).toEqual({
      value: [10, 12, 8],
      factors: [["lo", "hi", "lo"], ["M", "F", "F"]],
      factorLabels: ["Diet", "Sex"],
    });
  });

  it("multifactor is a many-column method", () => {
    expect(columnMode("multifactor")).toBe("many");
  });
});

describe("buildAnalysisData — mixed-effects model", () => {
  const mm: DataTable = {
    id: "mm", kind: "grouped", name: "MM",
    columns: [
      { id: "y", name: "Score", role: "y" },
      { id: "subj", name: "Subject", role: "y" },
      { id: "cond", name: "Condition", role: "y" },
    ],
    rows: [
      { id: "r1", cells: { y: 10, subj: "s1", cond: "A" } },
      { id: "r2", cells: { y: 12, subj: "s1", cond: "B" } },
      { id: "r3", cells: { y: 8, subj: "s2", cond: "A" } },
    ],
  };

  it("maps [value, group, ...fixed]; the group is random, the rest are fixed factors", () => {
    expect(buildAnalysisData("mixedmodel", { columns: ["y", "subj", "cond"] }, mm)).toEqual({
      value: [10, 12, 8],
      group: ["s1", "s1", "s2"],
      fixed: [["A", "B", "A"]],
      fixedLabels: ["Condition"],
      groupLabel: "Subject",
      reml: true,
    });
    // variant "ml" flips REML→ML; fixed factors are optional (random-intercept-only model).
    expect(buildAnalysisData("mixedmodel", { columns: ["y", "subj"], variant: "ml" }, mm))
      .toMatchObject({ value: [10, 12, 8], group: ["s1", "s1", "s2"], fixed: [], reml: false });
  });

  it("mixedmodel is a many-column method", () => {
    expect(columnMode("mixedmodel")).toBe("many");
  });
});

describe("buildAnalysisData — contingency", () => {
  const ct: DataTable = {
    id: "ct",
    kind: "xy",
    name: "CT",
    columns: [
      { id: "g1", name: "Treated" },
      { id: "g2", name: "Placebo" },
    ],
    rows: [
      { id: "r1", cells: { g1: 20, g2: 30 } },
      { id: "r2", cells: { g1: 30, g2: 20 } },
      { id: "r3", cells: { g1: null, g2: null } }, // all-blank row → dropped
      { id: "r4", cells: { g1: "", g2: "" } }, // all-blank row → dropped
    ],
  };

  it("builds an r×c counts matrix from the selected columns, dropping all-zero rows", () => {
    expect(buildAnalysisData("contingency", { columns: ["g1", "g2"] }, ct)).toEqual({
      table: [
        [20, 30],
        [30, 20],
      ],
      variant: "independent",
      conf: undefined,
    });
  });

  it("passes the paired variant through for McNemar", () => {
    expect(buildAnalysisData("contingency", { columns: ["g1", "g2"], variant: "paired" }, ct)).toMatchObject({
      variant: "paired",
    });
  });

  it("names a contingency analysis from its column names", () => {
    expect(defaultAnalysisName("contingency", { columns: ["g1", "g2"] }, ct)).toBe("Chi-square — Treated × Placebo");
  });

  it("names the paired contingency variant McNemar, not Chi-square", () => {
    expect(defaultAnalysisName("contingency", { columns: ["g1", "g2"], variant: "paired" }, ct)).toBe("McNemar — Treated × Placebo");
  });

  it("contingency is a many-column method", () => {
    expect(columnMode("contingency")).toBe("many");
  });
});

describe("buildAnalysisData — ROC", () => {
  const roc: DataTable = {
    id: "rc",
    kind: "xy",
    name: "RC",
    columns: [
      { id: "score", name: "Biomarker" },
      { id: "label", name: "Disease" },
    ],
    rows: [
      { id: "r1", cells: { score: 0.1, label: 0 } },
      { id: "r2", cells: { score: 0.8, label: 1 } },
      { id: "r3", cells: { score: 0.4, label: null } }, // incomplete row → dropped
    ],
  };

  it("pairs predictor → scores and outcome → labels per row (drops incomplete rows)", () => {
    expect(buildAnalysisData("roc", { columns: ["score", "label"] }, roc)).toEqual({
      scores: [0.1, 0.8],
      labels: [0, 1],
    });
  });

  it("ROC is a paired XY, two-column method", () => {
    expect(isXYMethod("roc")).toBe(true);
    expect(columnMode("roc")).toBe("two");
    expect(defaultAnalysisName("roc", { columns: ["score", "label"] }, roc)).toBe("ROC — Disease by Biomarker");
  });

  it("DeLong compare: marker2 → {scores, scores2, labels}, complete-case across all three columns", () => {
    const rc2: DataTable = {
      id: "rc2",
      kind: "xy",
      name: "RC2",
      columns: [
        { id: "m1", name: "Marker A" },
        { id: "m2", name: "Marker B" },
        { id: "lab", name: "Disease" },
      ],
      rows: [
        { id: "r1", cells: { m1: 0.1, m2: 0.2, lab: 0 } },
        { id: "r2", cells: { m1: 0.8, m2: 0.6, lab: 1 } },
        { id: "r3", cells: { m1: 0.5, m2: null, lab: 1 } }, // incomplete → dropped
        { id: "r4", cells: { m1: 0.9, m2: 0.7, lab: 1 } },
      ],
    };
    expect(buildAnalysisData("roc", { columns: ["m1", "lab"], marker2: "m2" }, rc2)).toEqual({
      scores: [0.1, 0.8, 0.9],
      scores2: [0.2, 0.6, 0.7],
      labels: [0, 1, 1],
    });
    expect(defaultAnalysisName("roc", { columns: ["m1", "lab"], marker2: "m2" }, rc2)).toBe("Compare ROC — Marker A vs Marker B");
  });
});

describe("buildSignificanceBrackets", () => {
  const idx = new Map([
    ["A", 1],
    ["B", 2],
    ["C", 3],
  ]);
  const range = { max: 100, span: 100 };

  it("builds a bracket per significant pairwise comparison, mapping names → 1-based groups", () => {
    const terms = [
      { term: "A vs B", p: 0.0001 },
      { term: "A vs C", p: 0.2 }, // ns → dropped by default
      { term: "B vs C", p: 0.03 },
    ];
    const out = buildSignificanceBrackets(terms, idx, range);
    expect(out).toHaveLength(2);
    // both are width-1 spans → ordered by left endpoint; A vs B then B vs C
    // The plan carries the P, not a frozen label: the symbol is derived at build time
    // through the plot's threshold ladder, so a plan cannot pin one vocabulary.
    // (That derivation is covered in significance.test.ts + buildScene.test.ts.)
    expect(out.map((b) => [b.from, b.to, b.p])).toEqual([
      [1, 2, 0.0001],
      [2, 3, 0.03],
    ]);
    // stacked at increasing heights above the data max
    expect(out[1]!.bracketY).toBeGreaterThan(out[0]!.bracketY);
    expect(out[0]!.bracketY).toBeGreaterThan(range.max);
  });

  it("stacks narrower spans below wider ones (nested look)", () => {
    const terms = [
      { term: "A vs C", p: 0.01 }, // span 2 (wide)
      { term: "A vs B", p: 0.01 }, // span 1 (narrow)
    ];
    const out = buildSignificanceBrackets(terms, idx, range);
    // narrow (A vs B) gets the lower height, wide (A vs C) the higher
    const ab = out.find((b) => b.from === 1 && b.to === 2)!;
    const ac = out.find((b) => b.from === 1 && b.to === 3)!;
    expect(ab.bracketY).toBeLessThan(ac.bracketY);
  });

  it("skips pairs whose names aren't on the graph and rows with no p", () => {
    const terms = [
      { term: "A vs Z", p: 0.001 }, // Z not a category → skipped
      { term: "A vs B", p: null }, // no p → skipped
      { term: "Between groups", p: 0.001 }, // not an "X vs Y" row → skipped
    ];
    expect(buildSignificanceBrackets(terms, idx, range)).toHaveLength(0);
  });

  it("can include non-significant comparisons when asked", () => {
    const terms = [{ term: "A vs B", p: 0.4 }];
    expect(buildSignificanceBrackets(terms, idx, range, { onlySignificant: false })).toHaveLength(1);
    // A non-significant pair still plans when the caller asks for all pairs; how it is
    // labelled (or whether it is hidden) is the ladder's business, not the planner's.
    expect(buildSignificanceBrackets(terms, idx, range, { onlySignificant: false })[0]!.p).toBe(0.4);
  });
});

describe("Analyze chooser metadata (grouping + per-test reference)", () => {
  const grouped = METHOD_GROUPS.flatMap((g) => g.methods);

  it("groups every method exactly once (no dupes, no orphans)", () => {
    // every method listed in a group has equation + explanation metadata
    for (const m of grouped) {
      expect(METHOD_INFO[m], `info for ${m}`).toBeDefined();
    }
    // no method appears in two groups
    expect(new Set(grouped).size).toBe(grouped.length);
    // every method with info is reachable from a group
    for (const m of Object.keys(METHOD_INFO)) expect(grouped).toContain(m);
  });

  it("each test has a non-trivial equation outline and a multi-sentence explanation", () => {
    for (const [id, info] of Object.entries(METHOD_INFO)) {
      expect(info.equation.length, `equation for ${id}`).toBeGreaterThan(5);
      // at least two sentences of plain-language explanation
      const sentences = info.explain.split(/[.!?]\s/).filter((s) => s.trim().length > 0);
      expect(sentences.length, `explanation sentences for ${id}`).toBeGreaterThanOrEqual(2);
    }
  });

  it("every test carries 'when to use' guidance (and a meaningful 'when not to use' where present)", () => {
    for (const [id, info] of Object.entries(METHOD_INFO)) {
      expect(info.whenToUse.length, `whenToUse for ${id}`).toBeGreaterThan(20);
      if (info.whenNotToUse !== undefined) {
        expect(info.whenNotToUse.length, `whenNotToUse for ${id}`).toBeGreaterThan(20);
        // the two lines must not be identical boilerplate
        expect(info.whenNotToUse).not.toEqual(info.whenToUse);
      }
    }
  });

  // The structured guidance panel (assumptions/warnings/alternatives) is keyed by method; a
  // method with only METHOD_INFO silently degrades. Guard that every grouped method has a
  // full ANALYSIS_GUIDANCE entry, so a newly grouped method cannot be left uncovered.
  it("every grouped method has a complete ANALYSIS_GUIDANCE entry", () => {
    for (const m of grouped) {
      const g = ANALYSIS_GUIDANCE[m];
      expect(g, `ANALYSIS_GUIDANCE for ${m}`).toBeDefined();
      expect(g!.explain.length, `explain for ${m}`).toBeGreaterThan(20);
      expect(g!.whenToUse.length, `whenToUse for ${m}`).toBeGreaterThan(20);
      expect(Array.isArray(g!.assumptions) && g!.assumptions.length > 0, `assumptions for ${m}`).toBe(true);
      expect(Array.isArray(g!.warnings) && g!.warnings.length > 0, `warnings for ${m}`).toBe(true);
    }
  });
});

describe("compactLetterDisplay", () => {
  it("gives the classic a / ab / bc / c pattern (means A<B<C<D)", () => {
    // Significant: A-C, A-D, B-D; non-sig: A-B, B-C, C-D.
    const cld = compactLetterDisplay(
      ["A", "B", "C", "D"],
      [["A", "C"], ["A", "D"], ["B", "D"]],
    );
    expect(Object.fromEntries(cld.map((g) => [g.name, g.letters]))).toEqual({
      A: "a",
      B: "ab",
      C: "bc",
      D: "c",
    });
  });

  it("gives every group the same single letter when nothing is significant", () => {
    const cld = compactLetterDisplay(["A", "B", "C"], []);
    expect(cld.every((g) => g.letters === "a")).toBe(true);
  });

  it("separates a group that differs from all others", () => {
    // A differs from B and C; B and C do not differ → B,C share, A alone.
    const cld = compactLetterDisplay(["A", "B", "C"], [["A", "B"], ["A", "C"]]);
    const m = new Map(cld.map((g) => [g.name, g.letters] as const));
    const A = m.get("A")!;
    const B = m.get("B")!;
    const C = m.get("C")!;
    const shares = (x: string, y: string): boolean => [...x].some((l) => y.includes(l));
    expect(shares(A, B)).toBe(false); // A differs from B → no shared letter
    expect(shares(A, C)).toBe(false); // A differs from C → no shared letter
    expect(shares(B, C)).toBe(true); // B and C not different → shared letter
  });
});

describe("significantPairs + buildLetterAnnotations", () => {
  it("extracts only the p < 0.05 pairs", () => {
    const pairs = significantPairs([
      { term: "A vs B", p: 0.001 },
      { term: "A vs C", p: 0.2 },
      { term: "B vs C", p: null },
    ]);
    expect(pairs).toEqual([["A", "B"]]);
  });

  it("centres one letter label above each group's band (resize-safe fractions)", () => {
    const anns = buildLetterAnnotations(["A", "B", "C"], [["A", "C"]]);
    expect(anns).toHaveLength(3);
    expect(anns.map((a) => a.x)).toEqual([0.5 / 3, 1.5 / 3, 2.5 / 3]);
    expect(anns.every((a) => a.y === 0.05 && typeof a.label === "string")).toBe(true);
  });

  describe("buildPcaScorePlot", () => {
    const pca = {
      pcLabels: ["PC1", "PC2", "PC3"],
      explained: [0.6, 0.25, 0.15],
      scores: [
        [1, 2, 0],
        [1.5, 2.5, 0],
        [-1, -2, 0],
        [-1.5, -2.5, 0],
      ],
    };

    it("ungrouped → a single PC1/PC2 series with %-variance axis titles", () => {
      const out = buildPcaScorePlot(pca, "Cells")!;
      expect(out.grouped).toBe(false);
      expect(out.columnNames).toEqual(["PC1", "PC2"]);
      expect(out.rows).toEqual([
        [1, 2],
        [1.5, 2.5],
        [-1, -2],
        [-1.5, -2.5],
      ]);
      expect(out.xTitle).toBe("PC1 (60.0%)");
      expect(out.yTitle).toBe("PC2 (25.0%)");
      expect(out.tableName).toBe("PCA scores — Cells");
    });

    it("grouped → shared X (PC1) with a sparse PC2 column per group (one series each)", () => {
      const out = buildPcaScorePlot({ ...pca, groups: ["WT", "WT", "KO", "KO"] }, "Cells")!;
      expect(out.grouped).toBe(true);
      expect(out.columnNames).toEqual(["PC1", "WT", "KO"]);
      // every case keeps its own PC1 (col 0); PC2 lands only in its group's column.
      expect(out.rows).toEqual([
        [1, 2, null],
        [1.5, 2.5, null],
        [-1, null, -2],
        [-1.5, null, -2.5],
      ]);
    });

    it("a single distinct group collapses to the ungrouped (single-ellipse) layout", () => {
      const out = buildPcaScorePlot({ ...pca, groups: ["X", "X", "X", "X"] }, "Cells")!;
      expect(out.grouped).toBe(false);
      expect(out.columnNames).toEqual(["PC1", "PC2"]);
    });

    it("returns null when there are too few cases or components", () => {
      expect(buildPcaScorePlot({ pcLabels: ["PC1", "PC2"], explained: [1], scores: [[1, 2]] }, "x")).toBeNull();
      expect(buildPcaScorePlot({ pcLabels: ["PC1"], explained: [1], scores: [[1], [2], [3]] }, "x")).toBeNull();
    });

    // End-to-end render glue: the exact confirmAnalyze pipeline (buildPcaScorePlot →
    // importTable → addPlot → ellipse on → buildPlotScene) must yield one confidence
    // ellipse per group, positioned at each group's cluster.
    it("integration: a grouped score plot renders one confidence ellipse per group", () => {
      const built = buildPcaScorePlot(
        {
          pcLabels: ["PC1", "PC2"],
          explained: [0.6, 0.3],
          scores: [
            [2, 2], [2.5, 1.8], [1.8, 2.3], [2.2, 2.1], // cluster A (top-right)
            [-2, -2], [-2.4, -1.7], [-1.7, -2.2], [-2.1, -2.3], // cluster B (bottom-left)
          ],
          groups: ["A", "A", "A", "A", "B", "B", "B", "B"],
        },
        "Cells",
      )!;
      const doc = createSampleDocument();
      const tbl = doc.importTable(built.tableName, "xy", built.columnNames, built.rows);
      const plot = doc.addPlot(built.plotName, tbl.id);
      doc.setPlotOptions(plot.id, { ellipse: { show: true, mode: "data", level: 0.95 } });
      for (const ds of tableDatasets(tbl)) doc.setSeriesStyle(plot.id, ds.id, { connect: "none" });

      const proj = doc.toJSON();
      const tblJ = proj.tables.find((t) => t.id === tbl.id)!;
      const plotJ = proj.plots.find((p) => p.id === plot.id)!;
      const scene = buildPlotScene(tblJ, plotJ, { width: 580, height: 380 });

      expect(scene.series).toHaveLength(2); // one series per group
      expect(scene.ellipses).toHaveLength(2); // ⇒ one ellipse per group
      const [e0, e1] = scene.ellipses!;
      expect(e0!.rx).toBeGreaterThan(0);
      expect(e1!.rx).toBeGreaterThan(0);
      // The two clusters are on opposite corners → their ellipse centres differ markedly.
      expect(Math.abs(e0!.cx - e1!.cx)).toBeGreaterThan(50);
      expect(Math.abs(e0!.cy - e1!.cy)).toBeGreaterThan(50);
    });
  });
});

describe("planAnalysisMarkers — the analysis→graph binding, as pure data", () => {
  /** A three-group column table, a violin of it, and an ANOVA with pairwise rows. */
  const fixture = (over: { control?: string; plotKind?: string } = {}) => {
    const table = {
      id: "t1", kind: "column" as const, name: "Doses",
      columns: [
        { id: "cg", name: "Group", role: "x" as const },
        { id: "c1", name: "Vehicle", role: "y" as const },
        { id: "c2", name: "Low dose", role: "y" as const },
        { id: "c3", name: "High dose", role: "y" as const },
      ],
      rows: [
        { id: "r1", cells: { cg: "1", c1: 10, c2: 20, c3: 30 } },
        { id: "r2", cells: { cg: "2", c1: 11, c2: 21, c3: 32 } },
        { id: "r3", cells: { cg: "3", c1: 12, c2: 19, c3: 31 } },
      ],
    };
    const plot = {
      id: "p1", name: "G", source: "t1", status: "ok" as const, styleOverrides: {},
      kind: (over.plotKind ?? "violin") as never,
      ...(over.control ? { significanceControl: over.control } : {}),
    };
    const analysis = {
      id: "an1", name: "One-way ANOVA", method: "anova", source: "t1",
      params: { columns: ["c1", "c2", "c3"] }, status: "ok" as const,
      result: {
        method: "anova", title: "One-way ANOVA",
        terms: [
          { term: "Vehicle vs Low dose", p: 0.03 },
          { term: "Vehicle vs High dose", p: 0.0002 },
          { term: "Low dose vs High dose", p: 0.004 },
        ],
        glance: { p: 0.001 }, summary: "", assumptions: [], cite: "",
      },
    };
    return { tables: [table], plots: [plot], analyses: [analysis] } as never;
  };

  /** The same fixture with one comparison that is not significant (p = 0.098). */
  const withNs = (over: { hideNs?: boolean } = {}) => {
    const f = fixture() as unknown as { plots: Record<string, unknown>[]; analyses: { result: { terms: { term: string; p: number }[] } }[] };
    f.analyses[0]!.result.terms = [
      { term: "Vehicle vs Low dose", p: 0.098 },
      { term: "Vehicle vs High dose", p: 0.0002 },
      { term: "Low dose vs High dose", p: 0.004 },
    ];
    if (over.hideNs !== undefined) f.plots[0]!.significance = { hideNs: over.hideNs };
    return f as never;
  };

  it("analysesBoundTo lists the analyses whose markers a graph carries, once each", () => {
    const project = {
      plots: [
        { id: "p1", annotations: [{ id: "a1", kind: "bracket", sig: { analysisId: "an1" } }, { id: "a2", kind: "bracket", sig: { analysisId: "an1" } }, { id: "a3", kind: "text" }] },
        { id: "p2", annotations: [{ id: "a4", kind: "bracket", sig: { analysisId: "an2" } }] },
      ],
    } as never;
    expect(analysesBoundTo(project, "p1")).toEqual(["an1"]);
    expect(analysesBoundTo(project, "p2")).toEqual(["an2"]);
    expect(analysesBoundTo(project, "nope")).toEqual([]);
  });

  it("by default a comparison that is not significant gets no bracket", () => {
    const out = planAnalysisMarkers(withNs(), "an1");
    if (!("plotId" in out)) throw new Error(out.reason);
    expect(out.annotations.map((a) => [a.from, a.to]).sort()).toEqual([[1, 3], [2, 3]]);
  });

  it("with the graph's ns markers shown, every comparison gets a bracket", () => {
    // The case under test: every treatment against the control must appear, the ones that did
    // not reach significance included ("ns"), not silently dropped.
    const out = planAnalysisMarkers(withNs({ hideNs: false }), "an1");
    if (!("plotId" in out)) throw new Error(out.reason);
    expect(out.annotations.map((a) => [a.from, a.to]).sort()).toEqual([[1, 2], [1, 3], [2, 3]]);
    const ns = out.annotations.find((a) => a.from === 1 && a.to === 2);
    expect(ns?.p, "the ns bracket carries its p so the label reads \"ns\"").toBeCloseTo(0.098, 4);
  });

  it("places one marker per significant comparison, with provenance on each", () => {
    const out = planAnalysisMarkers(fixture(), "an1");
    if (!("plotId" in out)) throw new Error(out.reason);
    expect(out.plotId).toBe("p1");
    expect(out.groups).toEqual(["Vehicle", "Low dose", "High dose"]);
    expect(out.annotations.length).toBe(3);
    for (const a of out.annotations) {
      expect(a.kind).toBe("bracket");
      expect(a.role).toBe("significance");
      // Provenance is what lets a re-run replace exactly this set.
      expect(a.sig?.analysisId).toBe("an1");
      expect(a.sig?.term).toBeTruthy();
      expect(a.sig?.domain).toBe("dataset"); // violin categories are the datasets
    }
    // Endpoints are 1-based category positions, in the group order above.
    expect(out.annotations.map((a) => [a.from, a.to]).sort()).toEqual([[1, 2], [1, 3], [2, 3]]);
  });

  it("a control keeps only that group's comparisons — the vs-control figure", () => {
    const out = planAnalysisMarkers(fixture({ control: "Vehicle" }), "an1");
    if (!("plotId" in out)) throw new Error(out.reason);
    expect(out.annotations.length).toBe(2);
    expect(out.annotations.every((a) => a.from === 1)).toBe(true);
    expect(out.annotations.every((a) => a.sig?.groupA === "Vehicle")).toBe(true);
    expect(out.annotations.some((a) => a.sig?.term === "Low dose vs High dose")).toBe(false);
  });

  it("the caller can override the control in the same tick it stores one", () => {
    // The picker writes the plot option and re-plans immediately; `project` is still last
    // render's snapshot at that point, so the override is the only correct source.
    const out = planAnalysisMarkers(fixture(), "an1", { control: "High dose" });
    if (!("plotId" in out)) throw new Error(out.reason);
    expect(out.annotations.every((a) => a.to === 3)).toBe(true);
    // …and passing an explicit undefined means all pairs, even when the plot stores one.
    const cleared = planAnalysisMarkers(fixture({ control: "Vehicle" }), "an1", { control: undefined });
    if (!("plotId" in cleared)) throw new Error(cleared.reason);
    expect(cleared.annotations.length).toBe(3);
  });

  it("a bar chart maps to row categories, not datasets — the pair would be wrong otherwise", () => {
    const out = planAnalysisMarkers(fixture({ plotKind: "bar" }), "an1");
    if (!("plotId" in out)) throw new Error(out.reason);
    expect(out.groups).toEqual(["1", "2", "3"]); // the X column's row labels
    expect(out.annotations.length, "group names are not row labels here, so nothing maps").toBe(0);
    expect(out.reason).toBeTruthy();
  });

  it("cell comparisons a bar cannot place are reported as a placement problem, never as non-significance", () => {
    // A two-way ANOVA emits cell terms ("Day 1 · Control vs Day 1 · Treated"); on a bar
    // the categories are the row labels ("Day 1", "Day 2"…), so neither side matches and
    // every term is skipped. These comparisons are significant — telling the user
    // "no significant comparisons" is a false report of the wrong cause.
    const f = fixture({ plotKind: "bar" }) as never as { analyses: { result: { terms: { term: string; p: number }[] } }[] };
    f.analyses[0]!.result.terms = [
      { term: "1 · Control vs 1 · Treated", p: 0.0004 },
      { term: "2 · Control vs 2 · Treated", p: 0.03 },
    ];
    const out = planAnalysisMarkers(f as never, "an1");
    if (!("plotId" in out)) throw new Error(out.reason);
    expect(out.annotations).toEqual([]);
    expect(out.reason).not.toMatch(/no significant/i);
    // The reason must say the groups aren't categories on this graph…
    expect(out.reason).toMatch(/categor/i);
    // …name one of the comparisons so the user can see which ones it means…
    expect(out.reason).toContain("1 · Control vs 1 · Treated");
    // …and carry the count of significant comparisons that exist but cannot be drawn.
    expect(out.reason).toMatch(/\b2\b/);
  });

  it("says why when nothing can be placed, instead of failing silently", () => {
    const noGraph = { ...(fixture() as never as { tables: unknown[]; analyses: unknown[] }), plots: [] } as never;
    const out = planAnalysisMarkers(noGraph, "an1");
    expect("plotId" in out).toBe(false);
    expect((out as { reason: string }).reason).toMatch(/category axis/i);
    // …and an analysis with no result yet is a reason too, not a crash.
    const noResult = { tables: [], plots: [], analyses: [{ id: "an1", name: "x", method: "anova", source: "t", params: {}, status: "ok" }] } as never;
    expect((planAnalysisMarkers(noResult, "an1") as { reason: string }).reason).toMatch(/no result/i);
  });

  it("an empty marker list is a result, not a failure — a re-run must be able to clear", () => {
    // Every comparison non-significant: the plan is empty AND names the plot, so the
    // caller still syncs and the previously-drawn markers come off.
    const f = fixture() as never as { analyses: { result: { terms: { p: number }[] } }[] };
    for (const t of f.analyses[0]!.result.terms) t.p = 0.9;
    const out = planAnalysisMarkers(f as never, "an1");
    if (!("plotId" in out)) throw new Error(out.reason);
    expect(out.annotations).toEqual([]);
    expect(out.reason).toMatch(/no significant/i);
  });
});
