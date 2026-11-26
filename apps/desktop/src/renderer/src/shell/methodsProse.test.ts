// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { Analysis, AnalysisResult, Project } from "@mady/core";
import { draftMethodsResults, draftProjectMethods, softwareFootnote, softwareNote, softwareReferences } from "./methodsProse";
import { METHOD_GROUPS } from "./analysis";

const project = { tables: [{ id: "t1", name: "Dose data" }] } as unknown as Project;

/**
 * Coverage guard. Every method the app offers must draft a specific Methods
 * sentence — "{Test} was used to {purpose}" — not the bare "{Test} was performed"
 * fallback, and never a placeholder token. A per-method test does not catch a missing
 * purpose clause; only the whole matrix does. This is what makes the purpose clause measurable rather
 * than assumed complete.
 */
describe("every method drafts a specific Methods sentence", () => {
  const ALL_METHODS = [...new Set(METHOD_GROUPS.flatMap((g) => g.methods))];

  it.each(ALL_METHODS)("%s has a purpose clause and no placeholder", (method) => {
    const analysis = {
      id: "a1", name: method, method, source: "t1", status: "ok",
      params: { columns: ["c1", "c2", "c3"], variant: undefined },
      result: { method, title: `${method} result`, terms: [], glance: { p: 0.01 }, summary: "" } as unknown as AnalysisResult,
    } as Analysis;
    const m = draftMethodsResults(analysis, project)!.methods;
    // Specific, not the generic "was performed" fallback.
    expect(m, `${method} fell back to the generic lead`).toContain(" was used to ");
    // No unresolved template value leaked in.
    expect(m).not.toMatch(/\bundefined\b|\bnull\b|\bNaN\b/);
  });

  it("covers all 49 methods (guards against the list drifting)", () => {
    // Includes publicationbias; the ordination methods pcoa, nmds, ca, rda and the
    // constrained cca, dbrda, plus varpart; permanova (do groups differ); meltingtemp
    // (Tm of melt curves); mixedanova (groups × time).
    expect(ALL_METHODS.length).toBe(49);
  });
});

function makeAnalysis(method: string, variant: string | undefined, result: AnalysisResult | undefined): Analysis {
  return {
    id: "a1",
    name: "My analysis",
    method,
    source: "t1",
    params: { columns: ["c1", "c2"], variant },
    status: "ok",
    result,
  };
}

/**
 * The versions are the real ones, read from the running app + engine, but they are
 * informative only, so they live in a footnote. The Methods body names just MadY:
 * from the author's point of view that is the software they used; the Python / NumPy /
 * SciPy / statsmodels stack underneath is not a claim they need to make in the body.
 */
/**
 * The significance sentence is a factual claim about the test that was run, so it has
 * to reflect the actual settings — the direction (tail) and the confidence level the
 * user chose in the dialog — not a hardcoded "two-sided … below 0.05". A one-tailed
 * test at 99% that drafts "two-sided … 0.05" is a false statement in a manuscript.
 */
describe("significance sentence follows the real settings", () => {
  const make = (method: string, params: Record<string, unknown>): Analysis =>
    ({
      id: "a1", name: "A", method, source: "t1", status: "ok",
      params: { columns: ["c1", "c2"], ...params },
      result: { method, title: "T", terms: [], glance: { p: 0.01 }, summary: "s" } as unknown as AnalysisResult,
    }) as Analysis;

  const note = (a: Analysis): string =>
    draftMethodsResults(a, project)!.methods.match(/A [a-z-]+ P value below [0-9.]+ was considered statistically significant\./)![0];

  it("defaults to two-sided at 0.05 when nothing was chosen", () => {
    expect(note(make("ttest", { variant: "welch" }))).toBe(
      "A two-sided P value below 0.05 was considered statistically significant.",
    );
  });

  it("reports a one-sided test when a direction was chosen", () => {
    expect(note(make("ttest", { variant: "welch", tail: "greater" }))).toContain("one-sided");
    expect(note(make("ttest", { variant: "welch", tail: "less" }))).toContain("one-sided");
  });

  it("uses the chosen confidence level as the threshold", () => {
    expect(note(make("ttest", { variant: "welch", conf: 0.99 }))).toContain("below 0.01");
    expect(note(make("ttest", { variant: "welch", conf: 0.9 }))).toContain("below 0.1");
  });

  it("combines direction and level: a one-sided test at 99%", () => {
    expect(note(make("ttest", { variant: "welch", tail: "greater", conf: 0.99 }))).toBe(
      "A one-sided P value below 0.01 was considered statistically significant.",
    );
  });

  it("never claims one-sided for a test that has no direction (ANOVA)", () => {
    // `tail` is meaningless for an F-test; the sentence must stay two-sided.
    expect(note(make("anova", { tail: "greater" }))).toContain("two-sided");
  });

  it("project draft: one shared sentence when the analyses agree", () => {
    const proj = {
      tables: [{ id: "t1", name: "D" }],
      analyses: [make("ttest", { variant: "welch" }), make("correlation", {})],
    } as unknown as Project;
    const m = draftProjectMethods(proj)!.methods;
    expect(m.match(/A two-sided P value below 0\.05 was considered statistically significant\./g)).toHaveLength(1);
  });

  it("project draft: states both thresholds rather than silently picking one", () => {
    const proj = {
      tables: [{ id: "t1", name: "D" }],
      analyses: [
        make("ttest", { variant: "welch" }), // two-sided 0.05
        make("correlation", { tail: "greater", conf: 0.99 }), // one-sided 0.01
      ],
    } as unknown as Project;
    const m = draftProjectMethods(proj)!.methods;
    expect(m).toContain("0.05");
    expect(m).toContain("0.01");
    expect(m).toMatch(/two-sided/);
    expect(m).toMatch(/one-sided/);
  });
});

/**
 * The post-hoc procedure a user chose (Tukey / Dunnett / Holm-Šídák…) is part of the
 * analysis, and the correction used changes the claim, so the draft names it.
 */
describe("post-hoc test is named", () => {
  const anova = (posthoc: string, extra: Record<string, unknown> = {}): Analysis =>
    ({
      id: "a1", name: "ANOVA", method: "anova", source: "t1", status: "ok",
      params: { columns: ["c1", "c2", "c3"], variant: "anova", posthoc, ...extra },
      result: { method: "anova", title: "One-way ANOVA", terms: [], glance: { p: 0.01 }, summary: "s" } as unknown as AnalysisResult,
    }) as Analysis;

  const methods = (a: Analysis): string => draftMethodsResults(a, project)!.methods;

  it("names Tukey for all-pairs comparisons", () => {
    expect(methods(anova("tukey", { scheme: "all-pairs" }))).toMatch(/Tukey/);
  });

  it("names Dunnett and says it is against a control", () => {
    const m = methods(anova("dunnett", { scheme: "vs-control", control: 0 }));
    expect(m).toMatch(/Dunnett/);
    expect(m).toMatch(/control/i);
  });

  it("names the correction family (Holm-Šídák) for a vs-control scheme", () => {
    expect(methods(anova("holm-sidak", { scheme: "vs-control", control: 0 }))).toMatch(/Holm-Šídák/);
  });

  it("says nothing about a post-hoc when none was configured (Kruskal-Wallis)", () => {
    const kw = ({
      id: "a1", name: "KW", method: "anova", source: "t1", status: "ok",
      params: { columns: ["c1", "c2", "c3"], variant: "kruskal" },
      result: { method: "anova", title: "Kruskal-Wallis", terms: [], glance: { p: 0.01 }, summary: "s" } as unknown as AnalysisResult,
    }) as Analysis;
    expect(methods(kw)).not.toMatch(/post-hoc|Tukey|Dunnett/i);
  });
});

/**
 * Two curve fits with the same model and different weighting (or fixed
 * parameters, or ROUT outlier removal) are different analyses. The draft states these
 * details so the paragraph can distinguish them.
 */
describe("curve-fit details are stated", () => {
  const fit = (params: Record<string, unknown>): Analysis =>
    ({
      id: "a1", name: "Curve fit", method: "curvefit", source: "t1", status: "ok",
      params: { columns: ["c0", "c1"], variant: "4pl", ...params },
      result: { method: "curvefit", title: "Nonlinear fit (4PL)", terms: [], glance: { r_sq: 0.99 }, summary: "s" } as unknown as AnalysisResult,
    }) as Analysis;
  const methods = (a: Analysis): string => draftMethodsResults(a, project)!.methods;

  it("names the weighting scheme when one was chosen", () => {
    expect(methods(fit({ weighting: "1/Y2" }))).toMatch(/1\/Y².*weight/i);
    expect(methods(fit({ weighting: "poisson" }))).toMatch(/Poisson weight/i);
  });

  it("says nothing extra for an unweighted least-squares fit", () => {
    const m = methods(fit({ weighting: "none" }));
    expect(m).not.toMatch(/weight/i);
    // …and the same when weighting is simply absent.
    expect(methods(fit({}))).not.toMatch(/weight/i);
  });

  it("states which parameters were constrained, with their values", () => {
    const m = methods(fit({ fixed: { Bottom: 0, Top: 100 } }));
    expect(m).toMatch(/Bottom.*0/);
    expect(m).toMatch(/Top.*100/);
    expect(m).toMatch(/constrain|fixed|held/i);
  });

  it("reports ROUT outlier removal", () => {
    expect(methods(fit({ rout: true }))).toMatch(/ROUT/);
    expect(methods(fit({ rout: false }))).not.toMatch(/ROUT/);
  });

  it("combines several fit settings into the paragraph", () => {
    const m = methods(fit({ weighting: "1/SD2", fixed: { Bottom: 0 }, rout: true }));
    expect(m).toMatch(/1\/SD²/);
    expect(m).toMatch(/Bottom/);
    expect(m).toMatch(/ROUT/);
  });
});

/**
 * A bare purpose verb is not enough for the tests whose whole point is a parameter:
 * equivalence needs its ±Δ bound, a Bayes factor needs its prior.
 */
describe("parameterised tests state their key setting", () => {
  const make = (method: string, params: Record<string, unknown>): Analysis =>
    ({
      id: "a1", name: method, method, source: "t1", status: "ok",
      params: { columns: ["c1", "c2"], variant: "unpaired", ...params },
      result: { method, title: method, terms: [], glance: { p: 0.2 }, summary: "s" } as unknown as AnalysisResult,
    }) as Analysis;
  const methods = (a: Analysis): string => draftMethodsResults(a, project)!.methods;

  it("states the equivalence bound and its units", () => {
    expect(methods(make("equivalence", { bound: 0.5, boundMode: "sd" }))).toMatch(/0\.5.*SD|bound.*0\.5/i);
    expect(methods(make("equivalence", { bound: 2, boundMode: "absolute" }))).toMatch(/±?2/);
  });

  it("states asymmetric equivalence bounds when given", () => {
    expect(methods(make("equivalence", { boundLow: -1, boundHigh: 2 }))).toMatch(/-1.*2|2.*-1/);
  });

  it("names the Bayes-factor prior scale", () => {
    expect(methods(make("bayesfactor", { rscale: "wide" }))).toMatch(/prior/i);
  });
});

/**
 * The draft names the user's own columns rather than writing "the two groups" /
 * "the variables".
 */
describe("variable names appear in the draft", () => {
  const named = {
    tables: [{
      id: "t1", name: "Assay",
      columns: [
        { id: "c0", name: "Dose", role: "y" }, { id: "c1", name: "Response", role: "y" },
        { id: "c2", name: "Vehicle", role: "y" }, { id: "c3", name: "Drug A", role: "y" },
        { id: "c4", name: "Drug B", role: "y" },
      ],
    }],
  } as unknown as Project;

  const draft = (method: string, cols: string[], extra: Record<string, unknown> = {}): string =>
    draftMethodsResults(
      {
        id: "a1", name: method, method, source: "t1", status: "ok",
        params: { columns: cols, ...extra },
        result: { method, title: method, terms: [], glance: { p: 0.01 }, summary: "s" } as unknown as AnalysisResult,
      } as Analysis,
      named,
    )!.methods;

  it("names the two measurement methods in a Deming / Bland-Altman comparison", () => {
    expect(draft("deming", ["c2", "c3"])).toMatch(/Vehicle.*Drug A|Drug A.*Vehicle/);
    expect(draft("blandaltman", ["c2", "c3"])).toMatch(/Vehicle/);
    expect(draft("passingbablok", ["c2", "c3"])).toMatch(/Drug A/);
  });

  it("names the variables in a curve fit (response vs dose)", () => {
    const m = draft("curvefit", ["c0", "c1"], { variant: "4pl" });
    expect(m).toMatch(/Response/);
    expect(m).toMatch(/Dose/);
  });

  it("names the conditions in a repeated-measures ANOVA", () => {
    const m = draft("rmanova", ["c2", "c3", "c4"]);
    expect(m).toMatch(/Vehicle/);
    expect(m).toMatch(/Drug B/);
  });

  it("names the two groups in equivalence / permutation / Bayes-factor tests", () => {
    expect(draft("equivalence", ["c2", "c3"], { variant: "unpaired" })).toMatch(/Vehicle/);
    expect(draft("permutation", ["c2", "c3"], { variant: "unpaired" })).toMatch(/Drug A/);
    expect(draft("bayesfactor", ["c2", "c3"], { variant: "unpaired" })).toMatch(/Vehicle.*Drug A|Drug A.*Vehicle/);
  });

  it("names the outcome in a multiple / logistic / Poisson regression", () => {
    expect(draft("multipleregression", ["c1", "c2", "c3"])).toMatch(/Response/);
    expect(draft("logistic", ["c1", "c2", "c3"])).toMatch(/Response/);
    expect(draft("poisson", ["c1", "c2", "c3"])).toMatch(/Response/);
  });

  it("names the measured variable in an outliers screen and an AUC", () => {
    expect(draft("outliers", ["c1"], { variant: "iterative" })).toMatch(/Response/);
    expect(draft("auc", ["c0", "c1"])).toMatch(/Response/);
  });

  it("still falls back to generic wording when names cannot be resolved", () => {
    // A partial group list must not misname the comparison — drop to generic.
    const bareTable = { tables: [{ id: "t1", name: "T" }] } as unknown as Project;
    const m = draftMethodsResults(
      {
        id: "a1", name: "deming", method: "deming", source: "t1", status: "ok",
        params: { columns: ["x", "y"] },
        result: { method: "deming", title: "Deming", terms: [], glance: {}, summary: "s" } as unknown as AnalysisResult,
      } as Analysis,
      bareTable,
    )!.methods;
    expect(m).toContain("measurement methods");
    expect(m).not.toMatch(/undefined/);
  });
});

/**
 * Guards against deduping the project bundle on the rendered lead sentence, which
 * collapses two different analyses that happen to render the same opening into one.
 * The bundle dedupes on the analysis identity (method, variant, columns) instead.
 */
describe("project bundle dedupes on identity, not the rendered sentence", () => {
  const bare = { tables: [{ id: "t1", name: "T" }] } as unknown as Project;
  const mk = (id: string, method: string, variant: string, columns: string[]): Analysis =>
    ({
      id, name: method, method, source: "t1", status: "ok",
      params: { columns, variant },
      result: { method, title: `${method} result`, terms: [], glance: { p: 0.01 }, summary: "" } as unknown as AnalysisResult,
    }) as Analysis;

  it("keeps two different tests even when their leads read identically", () => {
    // Same generic lead text, but different methods on different columns — both must appear.
    const proj = { ...bare, analyses: [mk("a1", "permutation", "unpaired", ["c1", "c2"]), mk("a2", "bayesfactor", "unpaired", ["c3", "c4"])] } as unknown as Project;
    const m = draftProjectMethods(proj)!.methods;
    expect(m).toMatch(/permutation result/);
    expect(m).toMatch(/bayesfactor result/);
  });

  it("still collapses the same test on the same columns", () => {
    const proj = { ...bare, analyses: [mk("a1", "ttest", "welch", ["c1", "c2"]), mk("a2", "ttest", "welch", ["c1", "c2"])] } as unknown as Project;
    const m = draftProjectMethods(proj)!.methods;
    expect(m.match(/ttest result was used to/g)).toHaveLength(1);
  });

  it("keeps the same test run on different columns", () => {
    const proj = { ...bare, analyses: [mk("a1", "ttest", "welch", ["c1", "c2"]), mk("a2", "ttest", "welch", ["c3", "c4"])] } as unknown as Project;
    expect(draftProjectMethods(proj)!.methods.match(/ttest result was used to/g)).toHaveLength(2);
  });
});

/**
 * An XY fit drops rows with missing data before the engine sees them, so the
 * Methods paragraph states the complete-case handling; otherwise the exclusion is silent.
 */
describe("excluded rows are reported (complete-case)", () => {
  const table = {
    id: "t1", name: "Dose curve",
    columns: [{ id: "x", name: "Dose" }, { id: "y", name: "Response", role: "y" }],
    rows: [
      { id: "r1", cells: { x: 1, y: 10 } },
      { id: "r2", cells: { x: 2, y: 20 } },
      { id: "r3", cells: { x: 3, y: null } }, // finite X, missing Y → excluded
      { id: "r4", cells: { x: 4, y: 40 } },
      { id: "r5", cells: { x: null, y: 50 } }, // missing X, finite Y → excluded
    ],
  };
  const proj = { tables: [table] } as unknown as Project;
  const draft = (method: string): string =>
    draftMethodsResults(
      {
        id: "a1", name: method, method, source: "t1", status: "ok",
        params: { columns: ["x", "y"], variant: method === "curvefit" ? "4pl" : undefined },
        result: { method, title: method, terms: [], glance: { p: 0.01 }, summary: "s" } as unknown as AnalysisResult,
      } as Analysis,
      proj,
    )!.methods;

  it("states the number of excluded rows for a regression / curve fit", () => {
    expect(draft("regression")).toMatch(/2 (rows|observations).*(excluded|complete-case)/i);
    expect(draft("curvefit")).toMatch(/2 (rows|observations)/);
    expect(draft("correlation")).toMatch(/2 (rows|observations)/);
  });

  it("says nothing when there is nothing to exclude", () => {
    const clean = {
      tables: [{ id: "t1", name: "C", columns: [{ id: "x", name: "X" }, { id: "y", name: "Y", role: "y" }],
        rows: [{ id: "r1", cells: { x: 1, y: 2 } }, { id: "r2", cells: { x: 2, y: 3 } }] }],
    } as unknown as Project;
    const m = draftMethodsResults(
      { id: "a1", name: "regression", method: "regression", source: "t1", status: "ok",
        params: { columns: ["x", "y"] },
        result: { method: "regression", title: "r", terms: [], glance: {}, summary: "s" } as unknown as AnalysisResult } as Analysis,
      clean,
    )!.methods;
    expect(m).not.toMatch(/excluded|complete-case/i);
  });

  it("uses singular for a single excluded row", () => {
    const one = {
      tables: [{ id: "t1", name: "C", columns: [{ id: "x", name: "X" }, { id: "y", name: "Y", role: "y" }],
        rows: [{ id: "r1", cells: { x: 1, y: 2 } }, { id: "r2", cells: { x: 2, y: null } }] }],
    } as unknown as Project;
    const m = draftMethodsResults(
      { id: "a1", name: "regression", method: "regression", source: "t1", status: "ok",
        params: { columns: ["x", "y"] },
        result: { method: "regression", title: "r", terms: [], glance: {}, summary: "s" } as unknown as AnalysisResult } as Analysis,
      one,
    )!.methods;
    expect(m).toMatch(/1 row\b/);
    expect(m).not.toMatch(/1 rows/);
  });
});

/**
 * Reporting guidelines want the sample size stated. It is computed from the
 * table with the same helpers that build the payload, so it matches what the test
 * used (finite values, pooling replicates, after exclusions).
 */
describe("sample size is stated", () => {
  const table = {
    id: "t1", name: "Assay",
    columns: [
      { id: "g", name: "Row" },
      { id: "a", name: "Vehicle", role: "y" }, { id: "b", name: "Drug A", role: "y" }, { id: "c", name: "Drug B", role: "y" },
    ],
    rows: [
      { id: "r1", cells: { g: 1, a: 10, b: 20, c: 30 } },
      { id: "r2", cells: { g: 2, a: 11, b: 21, c: 31 } },
      { id: "r3", cells: { g: 3, a: 12, b: 22, c: null } }, // Drug B has only 2
    ],
  };
  const proj = { tables: [table] } as unknown as Project;
  const draft = (method: string, cols: string[], variant?: string): string =>
    draftMethodsResults(
      { id: "a1", name: method, method, source: "t1", status: "ok",
        params: { columns: cols, variant },
        result: { method, title: method, terms: [], glance: { p: 0.01 }, summary: "s" } as unknown as AnalysisResult } as Analysis,
      proj,
    )!.methods;

  it("states equal group sizes as 'each group had n = X'", () => {
    // Vehicle and Drug A both have 3.
    expect(draft("ttest", ["a", "b"], "welch")).toMatch(/each group had n = 3/i);
  });

  it("lists unequal group sizes across an ANOVA", () => {
    // 3, 3, 2 across the three groups.
    expect(draft("anova", ["a", "b", "c"])).toMatch(/n = 3, 3,? and 2|n = 3, 3, 2/i);
  });

  it("states a single sample size for descriptives", () => {
    expect(draft("describe", ["a"])).toMatch(/n = 3/);
  });

  it("counts observations for an XY fit", () => {
    const xyTable = { id: "t1", name: "XY", columns: [{ id: "x", name: "X" }, { id: "y", name: "Y", role: "y" }],
      rows: [{ id: "r1", cells: { x: 1, y: 2 } }, { id: "r2", cells: { x: 2, y: 4 } }, { id: "r3", cells: { x: 3, y: 6 } }] };
    const m = draftMethodsResults(
      { id: "a1", name: "regression", method: "regression", source: "t1", status: "ok",
        params: { columns: ["x", "y"] },
        result: { method: "regression", title: "r", terms: [], glance: {}, summary: "s" } as unknown as AnalysisResult } as Analysis,
      { tables: [xyTable] } as unknown as Project,
    )!.methods;
    expect(m).toMatch(/n = 3 observations|3 observations/);
  });

  it("does not fabricate n when it cannot be counted (no table)", () => {
    const m = draftMethodsResults(
      { id: "a1", name: "ttest", method: "ttest", source: "t1", status: "ok",
        params: { columns: ["a", "b"], variant: "welch" },
        result: { method: "ttest", title: "t", terms: [], glance: {}, summary: "s" } as unknown as AnalysisResult } as Analysis,
      { tables: [] } as unknown as Project,
    )!.methods;
    expect(m).not.toMatch(/\bn = /);
  });
});

/**
 * The effect size appears in the Results sentence, but Methods should name
 * which one was used. Only the well-defined cases; nonparametric variants are gated
 * out rather than mislabelled.
 */
describe("effect size is named in Methods", () => {
  const mk = (method: string, variant: string | undefined): Analysis =>
    ({ id: "a1", name: method, method, source: "t1", status: "ok",
      params: { columns: ["c1", "c2"], variant },
      result: { method, title: method, terms: [], glance: { p: 0.01 }, summary: "s" } as unknown as AnalysisResult }) as Analysis;
  const methods = (a: Analysis): string => draftMethodsResults(a, project)!.methods;

  it("names Cohen's d for a parametric t test", () => {
    expect(methods(mk("ttest", "welch"))).toMatch(/Cohen's d/);
  });

  it("names eta-squared for a one-way ANOVA", () => {
    expect(methods(mk("anova", "anova"))).toMatch(/η²|eta.squared/i);
  });

  it("names Cramér's V for a contingency table", () => {
    expect(methods(mk("contingency", undefined))).toMatch(/Cramér/);
  });

  it("does not claim Cohen's d for a rank-based test", () => {
    expect(methods(mk("ttest", "mann-whitney"))).not.toMatch(/Cohen's d/);
    expect(methods(mk("anova", "kruskal"))).not.toMatch(/eta|η²/i);
  });
});

describe("software citation", () => {
  const versions = {
    app: "0.4.1",
    libraries: { python: "3.14.3", numpy: "2.4.2", scipy: "1.17.1" },
  };

  it("Methods names only MadY — the stack is not a claim the author makes", () => {
    expect(softwareNote(versions)).toBe("Statistical analysis was performed in MadY 0.4.1.");
    for (const lib of ["Python", "NumPy", "SciPy", "statsmodels"]) {
      expect(softwareNote(versions)).not.toContain(lib);
    }
  });

  it("the footnote names the real versions of everything that ran", () => {
    const note = softwareFootnote(versions);
    expect(note).toContain("MadY 0.4.1");
    expect(note).toContain("Python 3.14.3");
    expect(note).toContain("NumPy 2.4.2");
    expect(note).toContain("SciPy 1.17.1");
  });

  it("only names libraries the engine actually reported", () => {
    // statsmodels was not loaded — citing it would be a false claim in a paper.
    expect(softwareFootnote(versions)).not.toContain("statsmodels");
    expect(softwareReferences(versions).join(" ")).not.toContain("Seabold");
    const withSm = { ...versions, libraries: { ...versions.libraries, statsmodels: "0.14.6" } };
    expect(softwareFootnote(withSm)).toContain("statsmodels 0.14.6");
    expect(softwareReferences(withSm).join(" ")).toContain("Seabold");
  });

  it("gives a formal citation for each cited library", () => {
    const refs = softwareReferences(versions);
    expect(refs.join(" ")).toContain("Harris CR"); // NumPy
    expect(refs.join(" ")).toContain("Virtanen P"); // SciPy
    expect(refs.join(" ")).toContain("doi:10.1038/s41586-020-2649-2");
  });

  it("degrades to a version-free sentence rather than printing a placeholder", () => {
    for (const v of [undefined, {}, { app: undefined, libraries: {} }]) {
      for (const note of [softwareNote(v), softwareFootnote(v)]) {
        expect(note).not.toMatch(/undefined|null|NaN/);
        expect(note).toContain("MadY");
      }
    }
  });

  it("carries the footnote + references through a drafted analysis", () => {
    const result: AnalysisResult = {
      method: "ttest", title: "t test", terms: [], glance: { p: 0.01 },
      summary: "s", assumptions: [], cite: "",
    } as unknown as AnalysisResult;
    const draft = draftMethodsResults(makeAnalysis("ttest", "welch", result), project, versions)!;
    expect(draft.methods).toContain("MadY 0.4.1");
    expect(draft.methods).not.toContain("NumPy");
    expect(draft.footnote).toContain("NumPy 2.4.2");
    expect(draft.references!.length).toBeGreaterThanOrEqual(2);
  });
});

/**
 * Guards against the drafted curve-fit Methods paragraph reading as fragments or as
 * software-internal bookkeeping that no manuscript would state: "… non-positive doses
 * excluded. 95% confidence intervals are profile-likelihood intervals … where the profile
 * converged, and are standard-error-based … otherwise." A curve fit's engine `assumptions`
 * are results-pane caveats, not Methods prose. The draft authors its own clean description
 * of how the fit was done and never reproduces those notes; the redundant model `cite` is
 * dropped too.
 */
describe("curve-fit Methods paragraph reads as clean manuscript prose", () => {
  const dose = {
    id: "t1", name: "Sample — dose vs response",
    columns: [{ id: "x", name: "Dose (uM)" }, { id: "y", name: "Response (%)", role: "y" }],
    rows: Array.from({ length: 3 }, (_, i) => ({ id: `r${i}`, cells: { x: i + 1, y: 10 * (i + 1) } })),
  };
  const proj = { tables: [dose] } as unknown as Project;
  const ENGINE_NOTES = [
    "The model was fit by nonlinear least squares, with dose log10-transformed and non-positive doses excluded.",
    "95% confidence intervals are profile-likelihood intervals (asymmetric) where the profile converged, and are standard-error-based (symmetric) otherwise.",
  ];
  const fit = (params: Record<string, unknown>, result: Partial<AnalysisResult>): Analysis =>
    ({
      id: "a1", name: "Dose-response", method: "curvefit", source: "t1", status: "ok",
      params: { columns: ["x", "y"], variant: "4pl", ...params },
      result: {
        method: "curvefit", title: "Dose-response (4PL, variable slope)", terms: [], glance: { r_sq: 0.99 },
        summary: "EC50 = 1.2 µM; R² = 0.99", ...result,
      } as unknown as AnalysisResult,
    }) as Analysis;
  const methods = (a: Analysis): string => draftMethodsResults(a, proj)!.methods;

  it("authors the whole paragraph cleanly, reproducing none of the engine's diagnostics", () => {
    const m = methods(fit({}, {
      assumptions: ENGINE_NOTES,
      cite: "Four-parameter logistic (Hill) dose-response; EC50 from the log fit.",
    }));
    expect(m).toBe(
      "Dose-response (4PL, variable slope) was used to fit the model of Response (%) against Dose (uM) " +
        "(data: “Sample — dose vs response”). The fit used n = 3 observations. " +
        "The curve was fit by nonlinear least-squares regression. " +
        "95% confidence intervals for the fitted parameters were computed by the profile-likelihood method. " +
        "Statistical analysis was performed in MadY. " +
        "A two-sided P value below 0.05 was considered statistically significant.",
    );
  });

  it("never leaks the log-transform / dropped-dose or CI-fallback bookkeeping into prose", () => {
    const m = methods(fit({}, { assumptions: ENGINE_NOTES }));
    expect(m).not.toMatch(/non-positive doses|log10-transformed|log10\(dose\)/i);
    // No per-parameter fallback branch — the CI method is stated plainly, no "otherwise".
    expect(m).not.toMatch(/where the profile converged|standard-error-based|\botherwise\b|\belse\b/i);
    expect(m).toContain("The curve was fit by nonlinear least-squares regression.");
  });

  it("states the profile-likelihood CI method only when the fit actually profiled", () => {
    expect(methods(fit({}, { assumptions: ENGINE_NOTES }))).toContain(
      "95% confidence intervals for the fitted parameters were computed by the profile-likelihood method.",
    );
    // No profile note (e.g. Poisson-weighted, which skips profiling) → no CI sentence.
    expect(methods(fit({}, { assumptions: ["The model was fit by nonlinear least squares."] }))).not.toMatch(
      /confidence intervals for the fitted parameters/,
    );
  });

  it("drops the cite that only restates the model already named in the lead", () => {
    const m = methods(fit({}, { cite: "Four-parameter logistic (Hill) dose-response; EC50 from the log fit." }));
    expect(m).toContain("Dose-response (4PL, variable slope) was used to");
    expect(m).not.toContain("Four-parameter logistic (Hill) dose-response; EC50 from the log fit.");
  });

  it("states the weighting once (from the fit-details sentence), not the engine note", () => {
    const m = methods(fit({ weighting: "1/Y2" }, { assumptions: ["Weighting: 1/Y2.", ...ENGINE_NOTES] }));
    expect(m).not.toContain("Weighting: 1/Y2.");
    expect(m.match(/1\/Y²/g) ?? []).toHaveLength(1);
    expect(m).toMatch(/1\/Y².*weighting/i);
    // The base "nonlinear least-squares regression" line is omitted so it isn't said twice.
    expect(m).not.toContain("The curve was fit by nonlinear least-squares regression.");
  });
});

describe("citation sits before the software note, not after", () => {
  it("orders a genuine reference ahead of 'performed in MadY'", () => {
    const result: AnalysisResult = {
      method: "ttest", title: "Unpaired t test (Welch)",
      terms: [{ term: "Difference", statistic: 3.42, df: 18, p: 0.003 }],
      glance: { p: 0.003 }, summary: "The groups differed.",
      cite: "Welch, B. L. (1947)",
    };
    const m = draftMethodsResults(makeAnalysis("ttest", "welch", result), project)!.methods;
    expect(m).toContain("Welch, B. L. (1947).");
    expect(m.indexOf("Welch, B. L. (1947).")).toBeLessThan(m.indexOf("Statistical analysis was performed in MadY."));
  });
});

describe("draftMethodsResults", () => {
  it("returns null when the analysis has not produced a result", () => {
    expect(draftMethodsResults(makeAnalysis("ttest", "welch", undefined), project)).toBeNull();
  });

  it("drafts a t-test Methods paragraph + a classic t(df) Results sentence", () => {
    const result: AnalysisResult = {
      method: "ttest",
      title: "Unpaired t test (Welch)",
      terms: [{ term: "Difference", estimate: 2.1, statistic: 3.42, df: 18, p: 0.003 }],
      glance: { p: 0.003, cohens_d: 1.2 },
      summary: "Group A had a higher mean than group B.",
      cite: "Welch, B. L. (1947)",
    };
    const prose = draftMethodsResults(makeAnalysis("ttest", "welch", result), project)!;
    // Methods: purpose clause + source name + software + cite + threshold.
    expect(prose.methods).toContain("Unpaired t test (Welch) was used to compare the means of the two groups");
    expect(prose.methods).toContain("(data: “Dose data”)");
    expect(prose.methods).toContain("Statistical analysis was performed in MadY.");
    expect(prose.methods).not.toContain("NumPy");
    expect(prose.footnote).toBe("MadY performs its statistical computations using NumPy and SciPy.");
    expect(prose.methods).toContain("Welch, B. L. (1947).");
    expect(prose.methods).toContain("A two-sided P value below 0.05 was considered statistically significant.");
    // Results: summary + "(t(18) = 3.42, p = 0.003, Cohen's d = 1.2)."; no double period.
    expect(prose.results).toBe(
      "Group A had a higher mean than group B (t(18) = 3.42, p = 0.003, Cohen's d = 1.2).",
    );
  });

  it("uses H for Kruskal-Wallis and floors tiny p-values", () => {
    const result: AnalysisResult = {
      method: "anova1",
      title: "Kruskal-Wallis test",
      terms: [{ term: "Kruskal-Wallis", statistic: 21.4, df: 2, p: 0.0000004 }],
      glance: { H: 21.4, p: 0.0000004 },
      summary: "At least one group differs",
    };
    const prose = draftMethodsResults(makeAnalysis("anova", "kruskal", result), project)!;
    expect(prose.results).toBe("At least one group differs (H(2) = 21.4, p < 0.0001).");
  });

  it("reports F(df1, df2) with an effect size for one-way ANOVA", () => {
    const result: AnalysisResult = {
      method: "anova1",
      title: "One-way ANOVA",
      terms: [{ term: "Between groups", statistic: 5.1, df: "2, 27", p: 0.013 }],
      glance: { F: 5.1, p: 0.013, eta_sq: 0.27 },
      summary: "Group means differed",
    };
    const prose = draftMethodsResults(makeAnalysis("anova", undefined, result), project)!;
    expect(prose.results).toBe("Group means differed (F(2, 27) = 5.1, p = 0.013, η² = 0.27).");
  });

  it("reports the coefficient (r), not the raw t, for correlation", () => {
    const result: AnalysisResult = {
      method: "correlation",
      title: "Spearman correlation",
      terms: [{ term: "ρ", estimate: 0.62, statistic: 4.1, p: 0.0002 }],
      glance: { r: 0.62, p: 0.0002, r_sq: 0.38 },
      summary: "The two variables were positively associated",
    };
    const prose = draftMethodsResults(makeAnalysis("correlation", "spearman", result), project)!;
    // key-metric path: the coefficient · p · its square (never "ρ = 4.1", the t). A Spearman run: the coefficient is
    // ρ, not "r = 0.62 … R² = 0.38" (the label is also pinned by keyResults.test.ts).
    expect(prose.results).toBe(
      "The two variables were positively associated (ρ = 0.62, p = 0.0002, ρ² = 0.38).",
    );
    expect(prose.results).not.toContain("4.1");
    expect(prose.methods).toContain("quantify the association between the two variables");
  });

  it("folds the engine's assumption notes into the Methods paragraph", () => {
    const result: AnalysisResult = {
      method: "ttest",
      title: "Paired t test",
      terms: [{ term: "Mean difference", statistic: 2.0, df: 9, p: 0.076 }],
      glance: { p: 0.076 },
      summary: "No significant difference",
      assumptions: ["Assumes the paired differences are normally distributed."],
    };
    const prose = draftMethodsResults(makeAnalysis("ttest", "paired", result), project)!;
    expect(prose.methods).toContain("Assumes the paired differences are normally distributed.");
  });

  it("falls back to a bare test name when there is no summary or statistic", () => {
    const result: AnalysisResult = {
      method: "mystery",
      title: "Custom analysis",
      terms: [],
      glance: {},
      summary: "",
    };
    const prose = draftMethodsResults(makeAnalysis("mystery", undefined, result), project)!;
    expect(prose.results).toBe("Custom analysis was completed.");
    // No purpose clause for an unknown method → "was performed on the data in …".
    expect(prose.methods).toContain("Custom analysis was performed on the data in “Dose data”.");
  });
});

describe("draftProjectMethods", () => {
  const ttest: AnalysisResult = {
    method: "ttest",
    title: "Unpaired t test (Welch)",
    terms: [{ term: "Difference", estimate: 2.1, statistic: 3.42, df: 18, p: 0.003 }],
    glance: { p: 0.003, cohens_d: 1.2 },
    summary: "Group A had a higher mean than group B.",
    cite: "Welch, B. L. (1947)",
    assumptions: ["Assumes both groups are approximately normal."],
  };
  const corr: AnalysisResult = {
    method: "correlation",
    title: "Pearson correlation",
    terms: [{ term: "r", estimate: 0.62, statistic: 4.1, p: 0.0002 }],
    glance: { r: 0.62, p: 0.0002, r_sq: 0.38 },
    summary: "The two variables were positively associated",
  };
  const proj = {
    tables: [{ id: "t1", name: "Dose data" }],
    analyses: [
      { id: "a1", name: "T test", method: "ttest", source: "t1", status: "ok", params: { columns: ["c1", "c2"], variant: "welch" }, result: ttest },
      { id: "a2", name: "Correlation", method: "correlation", source: "t1", status: "ok", params: { columns: ["c1", "c2"] }, result: corr },
    ],
  } as unknown as Project;

  it("returns null when no analysis has run", () => {
    const empty = {
      tables: [],
      analyses: [{ id: "a", name: "x", method: "ttest", source: "t", status: "stale", params: { columns: [] }, result: undefined }],
    } as unknown as Project;
    expect(draftProjectMethods(empty)).toBeNull();
  });

  it("assembles one Methods paragraph (shared boilerplate once) + a Results item per analysis", () => {
    const p = draftProjectMethods(proj)!;
    expect(p.methods).toContain(
      "Unpaired t test (Welch) was used to compare the means of the two groups (data: “Dose data”).",
    );
    expect(p.methods).toContain(
      "Pearson correlation was used to quantify the association between the two variables (data: “Dose data”).",
    );
    expect(p.methods).toContain("Assumes both groups are approximately normal.");
    expect(p.methods).toContain("Welch, B. L. (1947).");
    // Shared boilerplate appears exactly once even with two analyses.
    expect(p.methods.match(/Statistical analysis was performed in MadY\./g)).toHaveLength(1);
    expect(p.methods).not.toContain("NumPy");
    expect(p.footnote).toContain("NumPy");
    expect(p.methods.match(/A two-sided P value below 0\.05 was considered statistically significant\./g)).toHaveLength(1);
    // One Results sentence per analysis, statistically exact.
    expect(p.results).toHaveLength(2);
    expect(p.results[0]).toEqual({
      name: "T test",
      results: "Group A had a higher mean than group B (t(18) = 3.42, p = 0.003, Cohen's d = 1.2).",
    });
    expect(p.results[1]!.results).toBe(
      "The two variables were positively associated (r = 0.62, p = 0.0002, R² = 0.38).",
    );
  });

  it("de-duplicates an identical lead but still lists every result", () => {
    const dup = {
      tables: [{ id: "t1", name: "Dose data" }],
      analyses: [proj.analyses[0], { ...proj.analyses[0], id: "a3", name: "T test again" }],
    } as unknown as Project;
    const p = draftProjectMethods(dup)!;
    expect(p.methods.match(/Unpaired t test \(Welch\) was used/g)).toHaveLength(1);
    expect(p.results).toHaveLength(2);
  });
});

describe("draftMethodsResults — two-way ANOVA (all three effects)", () => {
  it("reports both main effects + the interaction from the glance scalars", () => {
    const result: AnalysisResult = {
      method: "twoway",
      title: "Two-way ANOVA",
      terms: [],
      glance: {
        F_a: 5, F_b: 12.3, F_ab: 2.1,
        df_a: 1, df_b: 2, df_ab: 2, df_resid: 42,
        p_a: 0.031, p_b: 0.00005, p_ab: 0.134,
      },
      summary: "Two-way ANOVA — row factor p = 0.031, column factor p = 5e-05, interaction p = 0.134.",
    };
    const prose = draftMethodsResults(makeAnalysis("twoway", undefined, result), project)!;
    expect(prose.results).toBe(
      "A two-way ANOVA found a significant main effect of the row factor (F(1, 42) = 5, p = 0.031), " +
        "a significant main effect of the column factor (F(2, 42) = 12.3, p < 0.0001), " +
        "and no significant interaction (F(2, 42) = 2.1, p = 0.134).",
    );
  });

  it("falls back to the generic results path when the two-way glance scalars are absent", () => {
    const result: AnalysisResult = {
      method: "twoway", title: "Two-way ANOVA", terms: [], glance: {}, summary: "Two-way ANOVA completed",
    };
    const prose = draftMethodsResults(makeAnalysis("twoway", undefined, result), project)!;
    expect(prose.results).toBe("Two-way ANOVA completed.");
  });
});

describe("draftMethodsResults — variable/group names", () => {
  const xyTable = {
    id: "gt", kind: "xy", name: "Assay",
    columns: [{ id: "x", name: "Dose" }, { id: "A", name: "Drug A" }, { id: "B", name: "Drug B" }],
    rows: [{ id: "r1", cells: { x: 1, A: 10, B: 5 } }, { id: "r2", cells: { x: 2, A: 20, B: 9 } }],
  };
  const proj = { tables: [xyTable] } as unknown as Project;
  const analysisWith = (method: string, variant: string | undefined, result: AnalysisResult): Analysis =>
    ({ id: "a1", name: "A", method, source: "gt", params: { columns: ["A", "B"], variant }, status: "ok", result }) as Analysis;

  it("names the two groups in a t-test Methods lead", () => {
    const result: AnalysisResult = {
      method: "ttest", title: "Unpaired t test (Welch)",
      terms: [{ term: "Difference", statistic: 3.42, df: 18, p: 0.003 }],
      glance: { p: 0.003, cohens_d: 1.2 }, summary: "The groups differed.",
    };
    const prose = draftMethodsResults(analysisWith("ttest", "welch", result), proj)!;
    expect(prose.methods).toContain("was used to compare the means of Drug A and Drug B (data: “Assay”)");
  });

  it("names the two variables in a correlation Methods lead", () => {
    const result: AnalysisResult = {
      method: "correlation", title: "Pearson correlation",
      terms: [{ term: "r", estimate: 0.6, p: 0.01 }],
      glance: { r: 0.6, p: 0.01, r_sq: 0.36 }, summary: "Associated.",
    };
    const prose = draftMethodsResults(analysisWith("correlation", undefined, result), proj)!;
    expect(prose.methods).toContain("quantify the association between Drug A and Drug B");
  });

  it("keeps generic wording when the columns cannot be resolved to names", () => {
    const result: AnalysisResult = {
      method: "ttest", title: "Unpaired t test (Welch)",
      terms: [{ term: "Difference", statistic: 3.42, df: 18, p: 0.003 }],
      glance: { p: 0.003 }, summary: "x",
    };
    // `project` (t1) has no columns → names unresolved → generic phrasing.
    const prose = draftMethodsResults(makeAnalysis("ttest", "welch", result), project)!;
    expect(prose.methods).toContain("compare the means of the two groups");
  });
});

/**
 * The Results sentence is `summary` + a stats parenthetical. Guards against it stating the
 * same numbers twice (a 4PL summary already carries R² and the Hill slope, which the
 * parenthetical would otherwise repeat).
 *
 * Note: every summary below is the verbatim string the engine emits (taken by calling
 * `engine.METHODS[...]` directly). The fixtures elsewhere in this file use short summaries
 * like "Group A had a higher mean than group B", which state no statistics at all, so they
 * cannot detect a method whose Results sentence repeats its numbers.
 */
describe("Results sentence never states the same quantity twice", () => {
  it("curve fit: drops the repeated R² and Hill, keeps EC50 (the only new number)", () => {
    const result: AnalysisResult = {
      method: "curvefit", title: "Dose-response (4PL, variable slope)",
      terms: [{ term: "logEC50", estimate: 0.5364 }],
      glance: { r_sq: 0.999, EC50: 3.439, hill_slope: 1.01 },
      summary: "Bottom = 1.093, Top = 97.74, logEC50 = 0.5364, Hill slope = 1.01; R² = 0.999.",
    };
    const prose = draftMethodsResults(makeAnalysis("curvefit", "4pl", result), project)!;
    expect(prose.results).toBe(
      "Bottom = 1.093, Top = 97.74, logEC50 = 0.5364, Hill slope = 1.01; R² = 0.999 (EC50 = 3.439).",
    );
  });

  it("curve fit: 'EC50' survives even though the summary contains 'logEC50'", () => {
    const result: AnalysisResult = {
      method: "curvefit", title: "Dose-response (4PL, variable slope)",
      terms: [{ term: "logEC50", estimate: 0.5364 }],
      glance: { EC50: 3.439 },
      summary: "Bottom = 1.093, logEC50 = 0.5364.",
    };
    // A word-boundary match, not a substring one: logEC50 is a different quantity.
    expect(draftMethodsResults(makeAnalysis("curvefit", "4pl", result), project)!.results).toContain("EC50 = 3.439");
  });

  it("t test: drops p (stated inline) but keeps t and the effect size", () => {
    const result: AnalysisResult = {
      method: "ttest", title: "Unpaired t test (Welch)",
      terms: [{ term: "Difference", estimate: 17.4, statistic: 15.2, df: 12.9, p: 1.782e-9 }],
      glance: { p: 1.782e-9, cohens_d: 7.6 },
      summary: "Unpaired t test (Welch) (two-tailed): the difference is statistically significant (p = 1.782e-09).",
    };
    const r = draftMethodsResults(makeAnalysis("ttest", "welch", result), project)!.results;
    expect(r).toContain("t(12.9) = 15.2");
    expect(r).toContain("Cohen's d = 7.6");
    // Both renderings of the same p in one sentence would read as two results.
    expect(r).not.toContain("p < 0.0001");
    expect(r.match(/p\s*[=<]/g) ?? []).toHaveLength(1);
  });

  it("one-way ANOVA: the summary is already a full report, so the parenthetical goes", () => {
    const summary =
      "F(2, 21) = 125.7, p = 2.062e-12 — the group means differ significantly (η² = 0.923); post-hoc: Tukey HSD, all pairs.";
    const result: AnalysisResult = {
      method: "anova1", title: "One-way ANOVA",
      terms: [{ term: "Between groups", statistic: 125.7, df: "2, 21", p: 2.062e-12 }],
      glance: { F: 125.7, p: 2.062e-12, eta_sq: 0.923 },
      summary,
    };
    // F, p and η² are all in the summary → nothing fresh is left to add.
    expect(draftMethodsResults(makeAnalysis("anova", undefined, result), project)!.results).toBe(summary);
  });

  it("regression: every headline metric is already in the summary", () => {
    const summary = "y = 0.7566·x + 32.54; R² = 0.5364 (slope p = 0.06124, not statistically significant).";
    const result: AnalysisResult = {
      method: "regression", title: "Linear regression",
      terms: [{ term: "Slope", estimate: 0.7566, p: 0.06124 }],
      glance: { r_sq: 0.5364, slope: 0.7566, p: 0.06124 },
      summary,
    };
    expect(draftMethodsResults(makeAnalysis("regression", undefined, result), project)!.results).toBe(summary);
  });

  it("a terse summary still gets the full parenthetical (nothing to dedupe)", () => {
    const result: AnalysisResult = {
      method: "correlation", title: "Spearman correlation",
      terms: [{ term: "ρ", estimate: 0.62, statistic: 4.1, p: 0.0002 }],
      glance: { r: 0.62, p: 0.0002, r_sq: 0.38 },
      summary: "The two variables were positively associated",
    };
    expect(draftMethodsResults(makeAnalysis("correlation", "spearman", result), project)!.results).toBe(
      "The two variables were positively associated (ρ = 0.62, p = 0.0002, ρ² = 0.38).",
    );
  });
});
