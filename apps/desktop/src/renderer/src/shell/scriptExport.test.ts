// @vitest-environment node
import { describe, expect, it } from "vitest";
import { MadyDocument } from "@mady/core";
import { buildPythonScript } from "./scriptExport";

/** A document with a 3-group table + a couple of analyses bound to it. */
function docWithAnalyses(): MadyDocument {
  const doc = new MadyDocument();
  const table = doc.addTable("T", "xy", ["X", "A", "B", "C"]);
  // 3 rows of data across the four columns.
  doc.pasteBlock(table.id, 0, 0, [
    ["1", "10", "12", "20"],
    ["2", "11", "14", "22"],
    ["3", "9", "13", "21"],
  ]);
  doc.recompute();
  const cols = doc.toJSON().tables[0]!.columns;
  const [x, a, b, c] = cols.map((col) => col.id);
  doc.addAnalysis("ANOVA — A, B, C", "anova", table.id, { columns: [a!, b!, c!] });
  doc.addAnalysis("Welch t — A vs B", "ttest", table.id, { columns: [a!, b!], variant: "welch" });
  doc.addAnalysis("Pearson — X vs A", "correlation", table.id, { columns: [x!, a!] });
  return doc;
}

describe("buildPythonScript", () => {
  it("emits a runnable header (numpy + scipy) and a block per analysis", () => {
    const src = buildPythonScript(docWithAnalyses().toJSON());
    expect(src).toContain("import numpy as np");
    expect(src).toContain("from scipy import stats");
    // one titled block per analysis
    expect(src).toContain("# === ANOVA — A, B, C (One-way ANOVA) ===");
    expect(src).toContain("# === Welch t — A vs B (t test, Unpaired — Welch) ===");
    expect(src).toContain("# === Pearson — X vs A (Correlation) ===");
  });

  it("maps each method to the matching scipy call with the real data", () => {
    const src = buildPythonScript(docWithAnalyses().toJSON());
    expect(src).toContain("stats.f_oneway(*groups)");
    expect(src).toContain("stats.tukey_hsd(*groups)");
    expect(src).toContain("stats.ttest_ind(a, b, equal_var=False)"); // Welch
    expect(src).toContain("stats.pearsonr(a, b)");
    // the actual numbers from the table appear as Python lists.
    expect(src).toContain("[10, 11, 9]"); // group A
    expect(src).toContain("[20, 22, 21]"); // group C
  });

  it("emits a stub when the project has no analyses", () => {
    const src = buildPythonScript(new MadyDocument().toJSON());
    expect(src).toContain("no analyses");
    expect(src).toContain("import numpy as np");
  });

  it("covers contingency + roc templates", () => {
    const doc = new MadyDocument();
    const t = doc.addTable("CT", "xy", ["G1", "G2"]);
    doc.pasteBlock(t.id, 0, 0, [
      ["20", "30"],
      ["30", "20"],
    ]);
    doc.recompute();
    const [g1, g2] = doc.toJSON().tables[0]!.columns.map((c) => c.id);
    doc.addAnalysis("χ²", "contingency", t.id, { columns: [g1!, g2!] });
    doc.addAnalysis("ROC", "roc", t.id, { columns: [g1!, g2!] });
    const src = buildPythonScript(doc.toJSON());
    expect(src).toContain("stats.chi2_contingency(table, correction=False)");
    expect(src).toContain('print("AUC:", U / (npos * nneg))');
  });
});

describe("buildPythonScript — curve fits (the fitted model, not always a 4PL)", () => {
  /** A curvefit script for a given model, over a small Dose/Response table. */
  function curvefitScript(params: Record<string, unknown>): string {
    const doc = new MadyDocument();
    const t = doc.addTable("Kinetics", "xy", ["Dose", "Response"]);
    doc.pasteBlock(t.id, 0, 0, [
      ["1", "10"],
      ["2", "18"],
      ["4", "30"],
    ]);
    doc.recompute();
    const [x, y] = doc.toJSON().tables[0]!.columns.map((c) => c.id);
    doc.addAnalysis("Fit", "curvefit", t.id, { columns: [x!, y!], ...params });
    return buildPythonScript(doc.toJSON());
  }

  it("emits the Michaelis-Menten model, not a 4PL", () => {
    const src = curvefitScript({ variant: "mm" });
    expect(src).toContain("from scipy.optimize import curve_fit");
    expect(src).toContain("# Michaelis-Menten model — Y = Vmax·X / (KM + X)");
    expect(src).toContain("def model(x, Vmax, KM):");
    expect(src).toContain("return Vmax*x / (KM + x)");
    expect(src).toContain('print(dict(zip(["Vmax","KM"], popt)))');
    expect(src).not.toContain("fourpl"); // a fit exported as a 4PL regardless of its model fails here
  });

  it("emits the 4-parameter dose-response model when 4PL is chosen", () => {
    const src = curvefitScript({ variant: "4pl" });
    expect(src).toContain("def model(x, Bottom, Top, EC50, HillSlope):");
    expect(src).toContain("return Bottom + (Top - Bottom) / (1 + (EC50/x)**HillSlope)");
  });

  it("reproduces a Gaussian peak with np.exp and superscripts translated", () => {
    const src = curvefitScript({ variant: "gaussian" });
    expect(src).toContain("def model(x, Amplitude, Mean, SD):");
    expect(src).toContain("return Amplitude*np.exp(-0.5*((x - Mean)/SD)**2)");
  });

  it("reproduces a custom user equation (X→x, ^→**) verbatim", () => {
    const src = curvefitScript({ variant: "custom", equation: "A*X^2 + B" });
    expect(src).toContain("# custom user equation: Y = A*X^2 + B");
    expect(src).toContain("def model(x, A, B):");
    expect(src).toContain("return A*x**2 + B");
  });

  it("reproduces Morrison tight-binding Ki, translating √ to np.sqrt", () => {
    const src = curvefitScript({ variant: "morrison_ki" });
    expect(src).toContain("def model(x, V0, Et, Ki):");
    expect(src).toContain("np.sqrt(");
    // The display glyph may appear in the quoted "# … model — Y = …" comment, but must
    // never survive into the executable expression.
    const body = src.split("\n").filter((l) => l.trimStart().startsWith("return "));
    expect(body.length).toBeGreaterThan(0);
    expect(body.join("\n")).not.toContain("√");
  });

  // These models have a display equation (for the fit-config preview), but it must not
  // be mechanically turned into a single-curve fit: `I` is a per-dataset constant, so a
  // naive translation would emit a fit in which KM and Ki are confounded.
  it("refuses to reproduce a global-fit-only mechanism model as a single-curve fit", () => {
    for (const variant of ["competitive_inhibition", "noncompetitive_inhibition", "uncompetitive_inhibition", "mixed_inhibition"]) {
      const src = curvefitScript({ variant });
      expect(src, `${variant} must not emit a curve_fit`).toContain("no closed-form template to reproduce here");
      expect(src, `${variant} must not emit a curve_fit`).not.toContain("curve_fit");
      expect(src, `${variant} must not fit [I] as a parameter`).not.toContain("def model(");
    }
  });

  it("refuses to reproduce the implicit integrated-MM progress curve", () => {
    const src = curvefitScript({ variant: "enzyme_progress" });
    expect(src).toContain("no closed-form template to reproduce here");
    expect(src).not.toContain("curve_fit");
  });

  it("states plainly that an untemplated / smoother model has no template — no wrong fit code", () => {
    const src = curvefitScript({ variant: "some_advanced_model" });
    expect(src).toContain("no closed-form template to reproduce here");
    expect(src).not.toContain("curve_fit");
    expect(src).not.toContain("def model(");
  });
});

describe("buildPythonScript — further methods", () => {
  /** A 3-column numeric table; `analysis` binds one method to the given columns. */
  function scriptFor(method: string, cols: (ids: string[]) => string[], params: Record<string, unknown> = {}, headers = ["A", "B", "C"]): string {
    const doc = new MadyDocument();
    const t = doc.addTable("T", "xy", headers);
    doc.pasteBlock(t.id, 0, 0, [
      ["1", "2", "1"],
      ["2", "4", "0"],
      ["3", "5", "1"],
      ["4", "8", "0"],
      ["5", "9", "1"],
    ]);
    doc.recompute();
    const ids = doc.toJSON().tables[0]!.columns.map((c) => c.id);
    doc.addAnalysis("A", method, t.id, { columns: cols(ids), ...params });
    return buildPythonScript(doc.toJSON());
  }

  it("regression: force-through-origin uses the through-point formula, not plain OLS", () => {
    const src = scriptFor("regression", (ids) => [ids[0]!, ids[1]!], { variant: "origin" });
    expect(src).toContain("force through the origin");
    expect(src).toContain("slope = np.sum(w*xs*ys) / np.sum(w*xs*xs)");
    expect(src).not.toContain("print(stats.linregress(x, y))"); // not a plain OLS call
  });

  it("regression: force-through-a-point emits the entered (x0, y0)", () => {
    const src = scriptFor("regression", (ids) => [ids[0]!, ids[1]!], { variant: "point", throughPoint: { x: 2, y: 3 } });
    expect(src).toContain("x0, y0 = 2, 3");
    expect(src).toContain("force through the fixed point");
  });

  it("regression: 1/Y² weighting emits the weight expression and weighted normal equations", () => {
    const src = scriptFor("regression", (ids) => [ids[0]!, ids[1]!], { weighting: "1/Y2" });
    expect(src).toContain("w = 1.0 / np.maximum(np.abs(y) + 1e-9, 1e-300)**2");
    expect(src).toContain("Swxx, Swxy = np.sum(w*x*x), np.sum(w*x*y)");
  });

  it("regression: plain OLS still uses linregress", () => {
    expect(scriptFor("regression", (ids) => [ids[0]!, ids[1]!])).toContain("print(stats.linregress(x, y))");
  });

  it("deming: closed-form Deming slope (not a scipy stub)", () => {
    const src = scriptFor("deming", (ids) => [ids[0]!, ids[1]!]);
    expect(src).toContain("Deming slope");
    expect(src).toContain("slope = (syy - lam*sxx + np.sqrt((syy - lam*sxx)**2 + 4*lam*sxy**2)) / (2*sxy)");
    expect(src).not.toContain("no script template");
  });

  it("passingbablok: shifted median of pairwise slopes", () => {
    const src = scriptFor("passingbablok", (ids) => [ids[0]!, ids[1]!]);
    expect(src).toContain("Passing-Bablok slope");
    expect(src).toContain("K = int(np.sum(slopes < -1))");
    expect(src).toContain("def shifted(off):");
  });

  it("blandaltman: bias + limits of agreement (x − y, k from params)", () => {
    const src = scriptFor("blandaltman", (ids) => [ids[0]!, ids[1]!], { agreementK: 2 });
    expect(src).toContain("diffs = x - y");
    expect(src).toContain("sd = diffs.std(ddof=1); k = 2");
    expect(src).toContain("limits of agreement");
  });

  it("ancova: statsmodels y ~ C(group) + covariate", () => {
    const src = scriptFor("ancova", (ids) => [ids[1]!, ids[2]!]); // groups = B, C; covariate = col 0
    expect(src).toContain('smf.ols("y ~ C(group) + x", data=df)');
    expect(src).toContain("anova_lm(");
  });

  it("logistic / multiple / poisson regression via statsmodels", () => {
    const logit = scriptFor("logistic", (ids) => [ids[2]!, ids[0]!]); // outcome C (0/1), predictor A
    expect(logit).toContain('smf.logit("y ~ x1", data=df)');
    const mult = scriptFor("multipleregression", (ids) => [ids[1]!, ids[0]!]);
    expect(mult).toContain('smf.ols("y ~ x1", data=df)');
    const pois = scriptFor("poisson", (ids) => [ids[1]!, ids[0]!]);
    expect(pois).toContain('smf.poisson("y ~ x1", data=df)');
  });

  it("mixedmodel: statsmodels mixedlm with a random intercept per group", () => {
    const src = scriptFor("mixedmodel", (ids) => [ids[0]!, ids[1]!, ids[2]!]);
    expect(src).toContain("smf.mixedlm(");
    expect(src).toContain('groups=df["grp"]');
  });

  it("pca: SVD-based explained variance + loadings", () => {
    const src = scriptFor("pca", (ids) => [ids[0]!, ids[1]!, ids[2]!]);
    expect(src).toContain("np.linalg.svd(Xc, full_matrices=False)");
    expect(src).toContain("explained variance ratio");
  });

  it("cluster: k-means procedure (default)", () => {
    const src = scriptFor("cluster", (ids) => [ids[0]!, ids[1]!, ids[2]!], { variant: "kmeans", k: 2 });
    expect(src).toContain("from scipy.cluster.vq import kmeans2");
    expect(src).toContain("cluster sizes");
  });

  it("corrmatrix: pairwise-complete Pearson correlations", () => {
    const src = scriptFor("corrmatrix", (ids) => [ids[0]!, ids[1]!, ids[2]!]);
    expect(src).toContain("Pearson correlation matrix");
    expect(src).toContain("pearsonr");
  });

  it("multifactor: statsmodels full-factorial N-way ANOVA", () => {
    const src = scriptFor("multifactor", (ids) => [ids[0]!, ids[1]!, ids[2]!]);
    expect(src).toContain('smf.ols("y ~ C(f1)*C(f2)", data=df)');
    expect(src).toContain("anova_lm(");
  });
});

describe("buildPythonScript — Cox / nested / goodness-of-fit", () => {
  it("cox: statsmodels PHReg with Efron ties (matches the engine)", () => {
    const doc = new MadyDocument();
    const t = doc.addTable("Surv", "xy", ["Time", "Event", "Age"]);
    doc.pasteBlock(t.id, 0, 0, [["5", "1", "60"], ["8", "0", "55"], ["3", "1", "70"], ["10", "1", "50"], ["6", "0", "65"]]);
    doc.recompute();
    const [time, ev, age] = doc.toJSON().tables[0]!.columns.map((c) => c.id);
    doc.addAnalysis("Cox", "cox", t.id, { columns: [time!, ev!, age!] });
    const src = buildPythonScript(doc.toJSON());
    expect(src).toContain("from statsmodels.duration.hazard_regression import PHReg");
    expect(src).toContain('ties="efron"');
    expect(src).toContain("np.column_stack([x1])");
    expect(src).not.toContain("no script template");
  });

  it("goodnessoffit: chisquare vs uniform, no binomial for 3+ categories", () => {
    const doc = new MadyDocument();
    const t = doc.addTable("GOF", "xy", ["Cat", "Count"]);
    doc.pasteBlock(t.id, 0, 0, [["A", "20"], ["B", "30"], ["C", "25"]]);
    doc.recompute();
    const count = doc.toJSON().tables[0]!.columns[1]!.id;
    doc.addAnalysis("GOF", "goodnessoffit", t.id, { columns: [count] });
    const src = buildPythonScript(doc.toJSON());
    expect(src).toContain("stats.chisquare(observed)");
    expect(src).not.toContain("binomtest");
  });

  it("goodnessoffit: adds an exact binomial test for exactly two categories", () => {
    const doc = new MadyDocument();
    const t = doc.addTable("GOF2", "xy", ["Cat", "Count"]);
    doc.pasteBlock(t.id, 0, 0, [["A", "18"], ["B", "32"]]);
    doc.recompute();
    const count = doc.toJSON().tables[0]!.columns[1]!.id;
    doc.addAnalysis("GOF", "goodnessoffit", t.id, { columns: [count] });
    const src = buildPythonScript(doc.toJSON());
    expect(src).toContain("stats.binomtest(");
  });

  it("nested: SS decomposition with the group tested against the subgroup MS", () => {
    const nestedTable = {
      id: "nt", kind: "xy", name: "Nested",
      columns: [
        { id: "x", name: "Idx", role: "x" },
        { id: "a1", name: "GroupA", role: "y" },
        { id: "a2", name: "A2", role: "y", group: "a1" },
        { id: "a3", name: "A3", role: "y", group: "a1" },
        { id: "b1", name: "GroupB", role: "y" },
        { id: "b2", name: "B2", role: "y", group: "b1" },
        { id: "b3", name: "B3", role: "y", group: "b1" },
      ],
      rows: [
        { id: "r1", cells: { x: 1, a1: 10, a2: 12, a3: 11, b1: 20, b2: 22, b3: 21 } },
        { id: "r2", cells: { x: 2, a1: 11, a2: 13, a3: 10, b1: 21, b2: 23, b3: 22 } },
        { id: "r3", cells: { x: 3, a1: 9, a2: 12, a3: 12, b1: 19, b2: 24, b3: 20 } },
      ],
    };
    const project = {
      tables: [nestedTable],
      analyses: [{ id: "n", name: "N", method: "nested", source: "nt", status: "ok", params: { columns: ["a1", "b1"] } }],
    } as unknown as Parameters<typeof buildPythonScript>[0];
    const src = buildPythonScript(project);
    expect(src).toContain("Nested (hierarchical) ANOVA");
    expect(src).toContain("Fg = (ssg/dfg) / (sss/dfs); Fs = (sss/dfs) / (ssw/dfw)");
    expect(src).toContain("stats.f.sf(Fg, dfg, dfs)");
    // the group's replicate subgroups became Python nested lists
    expect(src).toContain('("GroupA", [[10, 11, 9], [12, 13, 12], [11, 10, 12]])');
  });
});
