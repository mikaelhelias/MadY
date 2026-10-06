import { describe, expect, it } from "vitest";
import type { AnalysisResult, Plot } from "@mady/core";
import { analysisResultGrid, analysisToCsv, analysisToTsv, engineBand, tidyColumns, excelSheetName, fitDoseMarker, fitEquationLabel, fitOverlayTarget, keyMetrics, keyMetricLine } from "./analysisExport";

const ttest: AnalysisResult = {
  method: "ttest",
  title: "Unpaired t test (Welch)",
  terms: [
    { term: "Group A mean", estimate: 5 },
    { term: "Difference (A − B)", estimate: -4, ciLow: -6.3, ciHigh: -1.7, statistic: -3.9, df: 8, p: 0.0045 },
    { term: "Cohen's d", estimate: -1.2, ciLow: -2.1, ciHigh: -0.3 },
  ],
  glance: { t: -3.9, df: 8, p: 0.0045, cohens_d: -1.2, hedges_g: -1.08 },
  summary: "Unpaired t test: the difference is significant (p = 0.0045).",
};

describe("analysisResultGrid — PCA/cluster export use correct headers", () => {
  const pca: AnalysisResult = {
    method: "pca", title: "PCA", terms: [{ term: "PC1", estimate: 2.5, ciLow: 0.83 }], glance: {}, summary: "",
    extra: {
      pca: {
        varLabels: ["Gene A", "Gene B"], pcLabels: ["PC1", "PC2"],
        eigenvalues: [2.5, 0.5], explained: [0.83, 0.17],
        loadings: [[0.7, -0.2], [0.6, 0.5]],
      },
    },
  };

  it("PCA exports scree headers + loadings, not the tidy '95% CI low' label", () => {
    const g = analysisResultGrid(pca);
    expect(g.columns).toEqual(["Component", "Eigenvalue", "% variance", "Cumulative %"]);
    expect(g.columns).not.toContain("95% CI low");
    // scree row: eigenvalue 2.5, 83% variance, 83% cumulative (first PC)
    expect(g.rows[0]).toEqual(["PC1", 2.5, 83, 83]);
    // cumulative accumulates on PC2
    expect(g.rows[1]).toEqual(["PC2", 0.5, expect.closeTo(17, 6), expect.closeTo(100, 6)]);
    const flat = analysisToCsv(pca);
    expect(flat).toContain("Loadings (variable → component)");
    expect(flat).toContain("Gene A");
    expect(flat).not.toContain("95% CI low");
  });

  it("cluster exports size/within-SS + centroids", () => {
    const cluster: AnalysisResult = {
      method: "cluster", title: "K-means", terms: [{ term: "Cluster 1", estimate: 3, ciLow: 1.2 }], glance: {}, summary: "",
      extra: { cluster: { sizes: [3, 2], withinSS: [1.2, 0.8], silhouette: 0.61, standardized: true, varLabels: ["x", "y"], centroids: [[0.1, -0.2], [1.1, 0.9]] } },
    };
    const g = analysisResultGrid(cluster);
    expect(g.columns).toEqual(["Cluster", "Size", "% of cases", "Within-SS"]);
    expect(g.rows[0]).toEqual(["Cluster 1", 3, expect.closeTo(60, 6), 1.2]);
    const flat = analysisToTsv(cluster);
    expect(flat).toContain("Mean silhouette width");
    expect(flat).toContain("Centroids (cluster → variable z-score)");
  });
});

describe("fitDoseMarker (EC50/IC50 potency crosshair)", () => {
  // A 4PL fit: bottom 5, top 95, EC50 = 10 (the dose) → response at EC50 is ~50.
  const curve = { x: [0.1, 1, 10, 100, 1000], y: [5.9, 14, 50, 86, 94.1] };
  const drFit = (glance: Record<string, number>): AnalysisResult =>
    ({ method: "curvefit", title: "Dose-response (4PL)", terms: [], glance, summary: "", curve } as unknown as AnalysisResult);

  it("marks the EC50 dose (x) and the response read off the curve (y)", () => {
    const m = fitDoseMarker(drFit({ EC50: 10, top: 95, bottom: 5, r_sq: 1 }))!;
    expect(m.x).toBe(10); // the dose on the X axis — the whole point
    expect(m.y).toBeCloseTo(50, 6); // response at the dose, interpolated off the curve
    expect(m.label).toBe("EC50 = 10");
  });

  it("labels an inhibition fit as IC50", () => {
    const m = fitDoseMarker(drFit({ IC50: 3.2, top: 100, bottom: 0 }))!;
    expect(m.x).toBe(3.2);
    expect(m.label).toBe("IC50 = 3.2");
  });

  it("returns null when there is no potency estimate (e.g. a linear fit)", () => {
    expect(fitDoseMarker(drFit({ slope: 2, intercept: 1, r_sq: 0.98 }))).toBeNull();
  });

  it("returns null when the dose falls outside the sampled curve range", () => {
    expect(fitDoseMarker(drFit({ EC50: 1e6 }))).toBeNull();
  });

  it("returns null when the fit carries no curve to read the response from", () => {
    expect(fitDoseMarker({ method: "curvefit", title: "x", terms: [], glance: { EC50: 10 }, summary: "" } as AnalysisResult)).toBeNull();
  });
});

describe("analysisExport", () => {
  it("grid keeps only present columns, numbers stay numeric", () => {
    const g = analysisResultGrid(ttest);
    expect(g.columns).toEqual(["Term", "Estimate", "Statistic", "df", "p", "95% CI low", "95% CI high"]);
    // "se" column is absent (no term has it); a blank cell is null, numbers are numbers
    expect(g.rows[0]).toEqual(["Group A mean", 5, null, null, null, null, null]);
    expect(g.rows[1]).toEqual(["Difference (A − B)", -4, -3.9, 8, 0.0045, -6.3, -1.7]);
  });

  it("labels extra engine keys instead of dumping raw keys as headers", () => {
    const logistic: AnalysisResult = {
      method: "logistic", title: "Logistic regression",
      terms: [{ term: "dose", estimate: 0.8, oddsRatio: 2.23, orLow: 1.1, orHigh: 4.5, p: 0.03 }],
      glance: {}, summary: "",
    };
    const cols = analysisResultGrid(logistic).columns;
    // raw keys "oddsRatio"/"orLow"/"orHigh" must appear as their proper labels, in canonical order
    expect(cols).toContain("Odds ratio");
    expect(cols).toContain("OR CI low");
    expect(cols).toContain("OR CI high");
    expect(cols).not.toContain("oddsRatio");
    expect(cols.indexOf("Odds ratio")).toBeLessThan(cols.indexOf("OR CI low"));
  });

  it("surfaces curve-fit Dependency + Skewness columns when terms carry them", () => {
    const fit: AnalysisResult = {
      method: "curvefit", title: "Michaelis-Menten",
      terms: [
        { term: "Vmax", estimate: 100, se: 3, ciLow: 94, ciHigh: 106, dependency: 0.91, skewness: 0.12 },
        { term: "KM", estimate: 10, se: 0.8, ciLow: 8.4, ciHigh: 11.6, dependency: 0.91, skewness: 0.31 },
      ],
      glance: { vmax: 100, km: 10, r_sq: 0.999, max_dependency: 0.91, max_skewness: 0.31 }, summary: "",
    };
    const g = analysisResultGrid(fit);
    expect(g.columns).toContain("Dependency");
    expect(g.columns).toContain("Skewness");
    // ordered: … 95% CI high, Dependency, Skewness
    expect(g.columns.indexOf("Dependency")).toBe(g.columns.indexOf("95% CI high") + 1);
    expect(g.columns.indexOf("Skewness")).toBe(g.columns.indexOf("Dependency") + 1);
    expect(g.rows[1]![g.columns.indexOf("Skewness")]).toBe(0.31);
  });

  it("CSV carries the title, header, rows + summary; quotes risky fields", () => {
    const csv = analysisToCsv(ttest);
    const lines = csv.split("\r\n");
    expect(lines[0]).toBe("Unpaired t test (Welch)");
    expect(lines[2]).toBe("Term,Estimate,Statistic,df,p,95% CI low,95% CI high");
    expect(lines[3]).toBe("Group A mean,5,,,,,");
    expect(csv).toContain(ttest.summary); // summary appended after a blank line
  });

  it("TSV is tab-separated for clean clipboard paste", () => {
    const tsv = analysisToTsv(ttest);
    expect(tsv.split("\n")[2]).toBe("Term\tEstimate\tStatistic\tdf\tp\t95% CI low\t95% CI high");
  });

  it("Excel sheet name is sanitised + length-capped", () => {
    expect(excelSheetName("Linear regression: y ~ x [model]")).toBe("Linear regression  y ~ x  model");
    expect(excelSheetName("").length).toBeGreaterThan(0);
    expect(excelSheetName("x".repeat(50)).length).toBe(31);
  });

  it("key metrics pick the headline numbers per method", () => {
    const km = keyMetrics(ttest);
    expect(km[0]!.value).toBe("p = 0.0045");
    expect(km.some((m) => m.value.includes("Cohen's d"))).toBe(true);
    expect(keyMetricLine(ttest)).toContain("·");

    const reg: AnalysisResult = { method: "regression", title: "Linear regression", terms: [], glance: { slope: 2, intercept: 0.1, r_sq: 0.98, p: 0.0001, n: 5 }, summary: "" };
    expect(keyMetrics(reg).map((m) => m.value)).toEqual(["R² = 0.98", "slope = 2", "slope p = 0.0001"]);

    const corr: AnalysisResult = { method: "correlation", title: "Pearson", terms: [], glance: { r: 0.85, p: 0.066, r_sq: 0.72, n: 5 }, summary: "" };
    expect(keyMetrics(corr)[0]!.value).toBe("r = 0.85");
  });

  it("key metrics fall back to any p-value for unmapped methods", () => {
    const odd: AnalysisResult = { method: "mystery", title: "?", terms: [], glance: { p: 0.03 }, summary: "" };
    expect(keyMetrics(odd)).toEqual([{ label: "", value: "p = 0.03" }]);
  });

  it("fitEquationLabel: true equation for templated fits, summary fallback otherwise, null for non-fits", () => {
    // A templated curve fit → the real equation with fitted values.
    const fpl: AnalysisResult = { method: "curvefit", title: "Dose-response (4PL)", terms: [], glance: { bottom: 0, top: 100, logec50: 1, hill_slope: 2, r_sq: 0.99 }, summary: "Bottom = 0, Top = 100…; R² = 0.99." };
    expect(fitEquationLabel("curvefit", "4pl", fpl)).toBe("Y = 0 + (100 − 0) / (1 + (10/X)^2)");
    // Linear regression → its equation.
    const reg: AnalysisResult = { method: "regression", title: "Linear regression", terms: [], glance: { slope: 2, intercept: 3, r_sq: 0.98 }, summary: "y = 2·x + 3." };
    expect(fitEquationLabel("regression", undefined, reg)).toBe("Y = 2·X + 3");
    // An untemplated fit model → fall back to the engine's parameter summary (period dropped).
    const gauss: AnalysisResult = { method: "curvefit", title: "Gaussian", terms: [], glance: { amplitude: 5, mean: 2 }, summary: "Amplitude = 5, Mean = 2; R² = 0.97." };
    expect(fitEquationLabel("curvefit", "gaussian", gauss)).toBe("Amplitude = 5, Mean = 2; R² = 0.97");
    // Not a fit → no equation label.
    expect(fitEquationLabel("ttest", undefined, ttest)).toBeNull();
  });
});

describe("engineBand — engine curve arrays → filled band for the overlay", () => {
  it("builds [x, low, high] triples from parallel finite arrays", () => {
    expect(engineBand([1, 2, 3], [0.5, 1.5, 2.5], [1.5, 2.5, 3.5])).toEqual([
      [1, 0.5, 1.5],
      [2, 1.5, 2.5],
      [3, 2.5, 3.5],
    ]);
  });

  it("returns undefined when any array is missing (a fit without a band)", () => {
    expect(engineBand(undefined, [1], [2])).toBeUndefined();
    expect(engineBand([1], undefined, [2])).toBeUndefined();
    expect(engineBand([1], [1], undefined)).toBeUndefined();
  });

  it("drops non-finite points (NaN / Infinity in x, low, or high)", () => {
    // rows 1 (NaN low) and 2 (Infinity high) drop; rows 0 and 3 survive.
    expect(engineBand([1, 2, 3, 4], [0, NaN, 2, 3], [1, 2, Infinity, 4])).toEqual([
      [1, 0, 1],
      [4, 3, 4],
    ]);
  });

  it("returns undefined when fewer than two finite points survive", () => {
    expect(engineBand([1, 2], [NaN, 1], [NaN, 2])).toBeUndefined(); // only one good point
    expect(engineBand([], [], [])).toBeUndefined();
  });

  it("tolerates a shorter low/high array by dropping the unmatched indices", () => {
    expect(engineBand([1, 2, 3], [0.5, 1.5], [1.5, 2.5])).toEqual([
      [1, 0.5, 1.5],
      [2, 1.5, 2.5],
    ]);
  });
});

/**
 * The fit / regression / global-fit overlay goes to a graph that can draw it, not simply the
 * first plot of the source table: a bar or box builder never reads `plot.fit`, so the curve
 * would silently go nowhere. Only the continuous-XY builder draws it (kinds
 * xy · area · bubble · volcano); the active graph wins when it qualifies.
 */
describe("fitOverlayTarget — which graph receives a fitted curve", () => {
  const plot = (id: string, source: string, kind?: string) => ({ id, name: id, source, ...(kind ? { kind } : {}) }) as unknown as Plot;

  it("skips a bar plot that comes first and lands on the xy plot after it", () => {
    const plots = [plot("bar", "t", "bar"), plot("xy", "t", "xy")];
    expect(fitOverlayTarget(plots, "t", undefined)?.id).toBe("xy");
  });

  it("the default (kind-undefined) plot is XY, and area/bubble/volcano qualify too", () => {
    expect(fitOverlayTarget([plot("box", "t", "box"), plot("d", "t")], "t", undefined)?.id).toBe("d");
    for (const k of ["area", "bubble", "volcano"]) expect(fitOverlayTarget([plot("k", "t", k)], "t", undefined)?.id, k).toBe("k");
  });

  it("prefers the ACTIVE plot when it is an XY-family plot of this table", () => {
    const plots = [plot("xy1", "t", "xy"), plot("xy2", "t", "xy"), plot("other", "u", "xy")];
    expect(fitOverlayTarget(plots, "t", "xy2")?.id).toBe("xy2");
    // Active plot of another table, or a non-XY active plot → first qualifying plot.
    expect(fitOverlayTarget(plots, "t", "other")?.id).toBe("xy1");
    expect(fitOverlayTarget([plot("bar", "t", "bar"), plot("xy1", "t", "xy")], "t", "bar")?.id).toBe("xy1");
  });

  it("returns undefined when the table has no XY-family plot (caller logs a note instead)", () => {
    expect(fitOverlayTarget([plot("bar", "t", "bar"), plot("box", "t", "box")], "t", undefined)).toBeUndefined();
    expect(fitOverlayTarget([], "t", undefined)).toBeUndefined();
  });
});

describe("CI column labels follow the analysis's confidence level", () => {
  const result = {
    method: "ttest", title: "t", summary: "",
    terms: [{ term: "Difference", estimate: 1.2, ciLow: 0.4, ciHigh: 2.0 }],
    glance: {}, assumptions: [], cite: "",
  } as never as AnalysisResult;

  it("tidyColumns labels the CI columns with the given conf", () => {
    const labels = tidyColumns(result.terms, 0.9).map((c) => c.label);
    expect(labels).toContain("90% CI low");
    expect(labels).toContain("90% CI high");
    expect(labels).not.toContain("95% CI low");
  });

  it("defaults to 95% when no conf is given", () => {
    const labels = tidyColumns(result.terms).map((c) => c.label);
    expect(labels).toContain("95% CI low");
  });

  it("an outlier row's q-value and critical G are labelled as what they are, not as a confidence limit", () => {
    const rows = [
      { term: "Outlier 1", estimate: 200, statistic: 9.1, p: 0.001, qValue: 0.004 },
      { term: "Outlier 2", estimate: -80, statistic: 6.2, p: 0.002, gCritical: 2.64 },
    ];
    const labels = tidyColumns(rows).map((c) => c.label);
    expect(labels).toContain("q (FDR)");
    expect(labels).toContain("Critical G");
    expect(labels.some((l) => /CI/.test(l))).toBe(false);
    expect(labels).not.toContain("qValue");
    expect(labels).not.toContain("gCritical");
  });

  it("the exported grid and TSV carry the conf-aware header", () => {
    expect(analysisResultGrid(result, 0.99).columns).toContain("99% CI low");
    expect(analysisToTsv(result, 0.9)).toContain("90% CI high");
    expect(analysisToCsv(result, 0.9)).toContain("90% CI low");
  });
});

describe("peak x-extent columns", () => {
  it("labels xFrom/xTo as x-range columns, never as a CI", () => {
    const terms = [{ term: "Peak 1 area", estimate: 12.5, xFrom: 1.0, xTo: 10.0 }] as never;
    const cols = tidyColumns(terms);
    expect(cols.find((c) => c.key === "xFrom")?.label).toBe("From X");
    expect(cols.find((c) => c.key === "xTo")?.label).toBe("To X");
    expect(cols.some((c) => /CI/.test(c.label))).toBe(false);
  });
});
