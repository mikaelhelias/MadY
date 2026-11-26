/**
 * Every analysis method has a key result — default-deny over the engine's own output.
 *
 * `keyResults.fixtures.json` is every method's real result, captured off the engine through
 * `crosscheck.py`'s payloads (engines/py). Guards against a method showing no headline at all
 * (e.g. a Bayes factor, a PCA, a meta-analysis, a Bland-Altman with nothing above the table)
 * and against a method reading a glance key the engine never writes.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { AnalysisResult } from "@mady/core";
import { keyMetricLine, keyMetrics, keyResultCards } from "./keyResults";

const FIX = JSON.parse(readFileSync(fileURLToPath(new URL("./keyResults.fixtures.json", import.meta.url)), "utf8")) as Record<
  string,
  AnalysisResult
>;

/** The engine's dispatch table, read from the source so a new method cannot slip past. */
function engineMethods(): string[] {
  const src = readFileSync(fileURLToPath(new URL("../../../../../../engines/py/engine.py", import.meta.url)), "utf8");
  const block = src.match(/^METHODS = \{([\s\S]*?)^\}/m);
  if (!block) throw new Error("METHODS table not found in engine.py — update this walker, do not delete it");
  return [...block[1]!.matchAll(/^\s*"([a-z0-9_]+)":/gm)].map((m) => m[1]!).filter((k) => k !== "ping" && k !== "anova1");
}

describe("every engine method has a key result", () => {
  const methods = engineMethods();

  it("reads a real dispatch table and a real fixture (a walker that matches nothing proves nothing)", () => {
    expect(methods.length).toBeGreaterThan(35);
    expect(Object.keys(FIX).length).toBeGreaterThan(35);
  });

  it("the fixture covers every method the engine dispatches — capture a new method's output before shipping it", () => {
    const missing = methods.filter((m) => !FIX[m]);
    expect(missing, `no fixture for: ${missing.join(", ")} — capture its result from the engine (a crosscheck.py payload) and add it`).toEqual([]);
  });

  for (const m of methods) {
    it(`${m}: shows 1–4 cards, each with a label and a finite value`, () => {
      const fx = FIX[m];
      if (!fx) return;
      const { cards } = keyResultCards(fx, 0.95);
      expect(cards.length, `${m} has no key result`).toBeGreaterThanOrEqual(1);
      expect(cards.length).toBeLessThanOrEqual(4);
      for (const c of cards) {
        expect(c.label.trim().length).toBeGreaterThan(0);
        expect(c.value).not.toMatch(/NaN|undefined|null|—/);
        expect(c.text).toContain(c.value.replace(/^< /, ""));
      }
      // The line form used on graphs and in captions is never empty either.
      expect(keyMetricLine(fx).length).toBeGreaterThan(0);
    });
  }
});

describe("the cards say what the method decided", () => {
  const cards = (m: string) => keyResultCards(FIX[m]!, 0.95);

  it("a p-value card is toned by the threshold and the verdict says so in words", () => {
    const anova = cards("anova");
    expect(anova.cards[0]).toMatchObject({ label: "p", isP: true, tone: "sig", value: "< 0.0001" });
    expect(anova.verdict).toBe("Statistically significant at α = 0.05");
    const t = cards("ttest");
    expect(t.cards[0]).toMatchObject({ label: "p", tone: "ns", value: "0.212" });
    expect(t.verdict).toBe("Not statistically significant at α = 0.05");
  });

  it("an F card carries its df, an estimate card its CI at the analysis's own level", () => {
    const f = cards("anova").cards.find((c) => c.label === "F");
    expect(f?.detail).toBe("df 2, 9");
    const diff = keyResultCards(FIX["ttest"]!, 0.9).cards.find((c) => c.label === "Difference");
    expect(diff?.detail).toMatch(/^90% CI -21\.9 to 5\.568$/);
  });

  it("Bayes factor leads with BF10 and reads the engine's own interpretation as the verdict", () => {
    const b = cards("bayesfactor");
    expect(b.cards.map((c) => c.label)).toEqual(["BF10", "BF01", "Cohen's d"]);
    expect(b.cards[0]!.value).toBe("1564");
    expect(b.verdict).toBe("Extreme evidence for H1 (an effect)");
  });

  it("equivalence, model comparison and normality state their decision, not a p", () => {
    expect(cards("equivalence").verdict).toBe("Equivalent within the bounds");
    expect(cards("comparefits").verdict).toMatch(/^AICc prefers /);
    expect(cards("normality").verdict).toMatch(/^Consistent with normal · more consistent with lognormal$/);
  });

  it("method comparison verdicts read the slope and intercept CIs", () => {
    expect(cards("deming").verdict).toMatch(/^The methods agree/);
    // Passing-Bablok's fixture is y = 2x + 3 exactly: both CIs exclude the identity.
    expect(cards("passingbablok").verdict).toBe("The methods differ");
  });

  it("outliers reports its count from the engine's `removed` field", () => {
    expect(cards("outliers").cards[0]).toMatchObject({ label: "Outliers removed", value: "2" });
  });

  it("a curve fit leads with R² then the model's own named parameters", () => {
    const c = cards("curvefit").cards.map((x) => x.label);
    expect(c[0]).toBe("R²");
    expect(c).toContain("EC50");
    expect(c).toContain("Hill slope");
  });

  it("survival leads with the log-rank p and the hazard ratio; meta-analysis with the pooled random effect and I²", () => {
    expect(cards("survival").cards.map((c) => c.label).slice(0, 2)).toEqual(["Log-rank p", "Hazard ratio"]);
    const m = cards("metaanalysis").cards;
    expect(m[0]!.label).toBe("Pooled (random)");
    expect(m[0]!.detail).toMatch(/^95% CI /);
    expect(m.map((c) => c.label)).toContain("I²");
  });

  it("percentages read as percentages (PCA variance, ROC sensitivity, logistic accuracy)", () => {
    expect(cards("pca").cards[0]).toMatchObject({ label: "PC1", value: "67.3%" });
    expect(cards("roc").cards.find((c) => c.label === "Sensitivity")?.value).toBe("100%");
    expect(cards("logistic").cards.find((c) => c.label === "Accuracy")?.value).toBe("75%");
  });
});

describe("keyMetrics keeps its shape for the prose and caption consumers", () => {
  it("t test → p first (blank label), then the effect size", () => {
    const km = keyMetrics(FIX["ttest"]!);
    expect(km[0]).toEqual({ label: "", value: "p = 0.212" });
    expect(km.some((m) => m.value.startsWith("Cohen's d = "))).toBe(true);
    expect(km.length).toBeLessThanOrEqual(3);
  });

  it("regression → R², slope, slope p — the strings the Results sentence prints", () => {
    const reg: AnalysisResult = { method: "regression", title: "Linear regression", terms: [], glance: { slope: 2, intercept: 0.1, r_sq: 0.98, p: 0.0001, n: 5 }, summary: "" };
    expect(keyMetrics(reg).map((m) => m.value)).toEqual(["R² = 0.98", "slope = 2", "slope p = 0.0001"]);
  });

  it("an unknown method still surfaces any p it has", () => {
    const odd: AnalysisResult = { method: "mystery", title: "?", terms: [], glance: { p: 0.03 }, summary: "" };
    expect(keyMetrics(odd)).toEqual([{ label: "", value: "p = 0.03" }]);
    expect(keyResultCards(odd).verdict).toBe("Statistically significant at α = 0.05");
  });
});

/**
 * ROC comparing two markers (DeLong) — the same method id, a different result shape.
 *
 * The engine returns `method: "roc"` for both a single marker (auc, sensitivity, specificity) and a comparison of two
 * markers on the same subjects (auc1, auc2, auc_diff, and the DeLong p). Guards against the comparison showing only
 * the first marker's AUC ("AUC = 1", not saying which, with no p and no verdict) while the engine's own summary reads
 * "the two ROC curves differ significantly, p = 0.02105". That line goes on the graph ("Show key stats"), into the
 * results pane and into captions.
 *
 * `roc_compare` in the fixture is real engine output (engine.roc with scores, labels and scores2 - CRP vs PCT on 20
 * subjects).
 */
describe("ROC comparing two markers shows the comparison, not one marker's AUC", () => {
  const delong = FIX["roc_compare"]!;

  it("the fixture is the comparison shape (it can show the single-marker misreading)", () => {
    expect(delong.method).toBe("roc");
    expect(typeof delong.glance["auc_diff"]).toBe("number");
    expect(delong.glance["sensitivity"], "a comparison carries no single-marker sensitivity").toBeUndefined();
  });

  it("leads with the DeLong p, then the AUC difference with its CI, then each marker's AUC by name", () => {
    const { cards, verdict } = keyResultCards(delong, 0.95);
    expect(cards[0]).toMatchObject({ isP: true, label: "DeLong p", value: "0.021" });
    expect(cards[1]!.label).toBe("AUC difference (CRP − PCT)");
    expect(cards[1]!.value).toBe("0.26");
    expect(cards[1]!.detail).toMatch(/^95% CI 0\.0391/);
    expect(cards.slice(2).map((c) => c.text)).toEqual(["AUC (CRP) = 1", "AUC (PCT) = 0.74"]);
    expect(verdict).toBe("Statistically significant at α = 0.05");
  });

  it("the line on the graph states the comparison", () => {
    expect(keyMetricLine(delong)).toBe("DeLong p = 0.021  ·  AUC difference (CRP − PCT) = 0.26  ·  AUC (CRP) = 1");
  });

  it("a single-marker ROC keeps its single-marker line (the other direction)", () => {
    expect(keyMetricLine(FIX["roc"]!)).toBe("AUC = 0.75  ·  Sensitivity = 100%  ·  Specificity = 50%");
  });
});

/**
 * Every result shape, not one per method.
 *
 * A method returns different shapes depending on its options (the ROC case above is one instance). Every option
 * branch of every method is run through the real engine and this registry; each `shape_*` fixture below is that real
 * output. Where a shape needs no special handling, a counterpart is pinned so a change for one shape cannot break it.
 */
describe("key results are right for each result shape a method can return", () => {
  const kr = (name: string, conf = 0.95) => keyResultCards(FIX[`shape_${name}`]!, conf);
  const texts = (name: string, conf = 0.95) => kr(name, conf).cards.map((c) => c.text);

  it("the verdict decides on the real p, not the rounded one (p = 0.049975 is significant)", () => {
    const r = kr("rda_p_just_under_05_perm2000");
    expect(r.cards[0]).toMatchObject({ isP: true, tone: "sig" });
    expect(r.verdict).toBe("Statistically significant at α = 0.05");
  });

  it("normality judges at the analysis's own confidence level, as the engine does", () => {
    // p = 0.0119: departs at α 0.05, consistent at α 0.01
    expect(kr("norm_conf99_p03", 0.99).verdict).toMatch(/^Consistent with normal/);
    expect(kr("norm_conf99_p03", 0.95).verdict).toMatch(/^Departs from normal/);
    // p = 0.0658: consistent at α 0.05, departs at α 0.1
    expect(kr("norm_conf90_p07", 0.9).verdict).toMatch(/^Departs from normal/);
    expect(kr("norm_conf90_p07", 0.95).verdict).toMatch(/^Consistent with normal/);
  });

  it("t test family: each variant shows its own effect and statistic", () => {
    expect(texts("t_wilcoxon_1samp")).toContain("Difference = 2");
    expect(texts("t_ks")).toContain("D = 1");
    const ratio = kr("t_ratio_paired").cards;
    expect(ratio.map((c) => c.label)).toContain("Geometric mean ratio");
    expect(ratio.map((c) => c.label)).not.toContain("Difference");
  });

  it("permutation names the statistic it permuted", () => {
    expect(texts("perm_correlation")).toContain("Pearson r = 0.999");
    expect(kr("perm_unpaired_exact").cards[1]!.label).toBe("Difference in means");
  });

  it("equivalence shows both bounds", () => {
    expect(texts("eq_unpaired_equiv")).toContain("Bounds = -0.5 to 0.5");
  });

  it("power says n per group only when the design has groups", () => {
    expect(kr("pow_anova_n").cards.map((c) => c.label)).not.toContain("n per group");
    expect(texts("pow_anova_n")).toContain("Total N = 158");
    expect(texts("pow_ttest-two_n")).toEqual(expect.arrayContaining(["n per group = 64", "Total N = 128"]));
  });

  it("two-way ANOVA: the verdict names the effect that is significant, whichever it is", () => {
    expect(kr("twoway_col_only").verdict).toBe("Significant at α = 0.05: column factor");
  });

  it("multifactor ANOVA: every factor gets its p, and the verdict names the significant one", () => {
    expect(texts("multifactor_2_second_only")).toEqual(["p (Diet) = 0.255", "p (Sex) = 0.000108", "p (Diet × Sex) = 0.53", "R² = 0.8656"]);
    expect(kr("multifactor_2_second_only").verdict).toBe("Significant at α = 0.05: Sex");
    expect(texts("multifactor_3_third_only").slice(0, 3)).toEqual(["p (Diet) = 0.787", "p (Sex) = 0.332", "p (Dose) < 0.0001"]);
    expect(kr("multifactor_3_third_only").verdict).toBe("Significant at α = 0.05: Dose");
  });

  it("McNemar leads with the p its summary reports - exact when discordant pairs are few", () => {
    const few = kr("cont_mcnemar_flip");
    expect(few.cards[0]!.text).toBe("p (exact) = 0.049");
    expect(few.verdict).toBe("Statistically significant at α = 0.05");
    const many = kr("cont_mcnemar_large");
    expect(many.cards[0]!.text).toBe("p = 0.00266");
    expect(many.cards.map((c) => c.text)).toContain("McNemar χ² = 9.025");
  });

  it("Monte-Carlo convergence reads as a percentage", () => {
    expect(texts("mc_4pl_partial")).toContain("Converged = 95%");
  });

  it("Spearman shows ρ, not r - for one pair and for a matrix", () => {
    expect(texts("corr_spearman_sig").slice(0, 1)).toEqual(["ρ = 0.972"]);
    expect(texts("corr_spearman_sig").some((t) => /^r = |^R² = /.test(t))).toBe(false);
    expect(texts("cm_spearman")[0]).toBe("ρ(A vs B) = 1");
    // Pearson shows r
    expect(keyResultCards(FIX["correlation"]!).cards[0]!.label).toBe("r");
  });

  it("ANCOVA: parallel slopes with different intercepts is a finding, and the verdict says so", () => {
    expect(kr("anc_parallel_int_differ").verdict).toBe("Parallel slopes — the intercepts differ");
    expect(kr("anc_slopes_differ").verdict).toBe("The slopes differ — the lines are not parallel");
  });

  it("a percent Bland-Altman prints its bias and limits in %", () => {
    expect(texts("ba_percent")).toEqual(["Bias = -18.35%", "Lower LoA = -19.2%", "Upper LoA = -17.5%"]);
    expect(keyResultCards(FIX["blandaltman"]!).cards[0]!.value).not.toMatch(/%$/);
  });

  it("model comparison: P (preferred) is the preferred model's, and the verdict names it", () => {
    // 3PL preferred as model A, and as model B
    expect(texts("cmp_3pl_4pl_yup")).toContain("P (preferred) = 0.9888");
    expect(texts("cmp_4pl_3pl_yup")).toContain("P (preferred) = 0.9888");
    expect(kr("cmp_3pl_4pl_yup").verdict).toBe("AICc prefers Dose-response (3PL, fixed slope)");
    expect(kr("cmp_nonnested").verdict).toBe("AICc prefers Michaelis-Menten");
  });

  it("interpolation counts the unknowns it read, not the standards", () => {
    expect(texts("interp_4pl_both")).toContain("Unknowns read = 3");
  });

  it("a global fit shows its fitted parameters, shared ones first", () => {
    expect(kr("gf_4pl_shared_tb").cards.map((c) => c.label)).toEqual(["R²", "EC50 — Cpd A", "EC50 — Cpd B"]);
    expect(kr("gf_4pl_shared_ec50").cards[1]!.label).toBe("EC50 (shared)");
    expect(kr("gf_competitive").cards.map((c) => c.label)).toContain("Ki (shared)");
  });

  it("curve transforms and fits: the integral's area, a decay's half-life, a biphasic fit's two EC50s", () => {
    expect(texts("ct_integrate")).toEqual(["Area = 22.33"]);
    expect(kr("cf_exp_decay").cards.map((c) => c.label)).toContain("Half-life");
    expect(kr("cf_biphasic").cards.map((c) => c.label)).toEqual(["R²", "1st EC50", "2nd EC50"]);
  });
});

/**
 * A global fit that also tests "one curve for all datasets?". The test is the result, so its p
 * leads and the verdict says which way it went; real engine output, EC50s equal vs ten-fold apart.
 */
describe("global fit with the one-curve test leads with the test", () => {
  it("curves apart: the p leads and the verdict says they need separate curves", () => {
    const k = keyResultCards(FIX["shape_gf_one_curve_apart"]!, 0.95);
    expect(k.cards[0]).toMatchObject({ label: "p (one curve for all)", isP: true, tone: "sig" });
    expect(k.cards.map((c) => c.label)).toContain("R²");
    expect(k.verdict).toBe("The datasets need separate curves");
  });

  it("curves alike: one curve fits all", () => {
    const k = keyResultCards(FIX["shape_gf_one_curve_same"]!, 0.95);
    expect(k.cards[0]).toMatchObject({ label: "p (one curve for all)", tone: "ns" });
    expect(k.verdict).toBe("One curve fits all the datasets");
  });

  it("a global fit without the test keeps its usual cards and no verdict (the other direction)", () => {
    expect(keyResultCards(FIX["shape_gf_4pl_shared_tb"]!, 0.95).cards.map((c) => c.label)).toEqual(["R²", "EC50 — Cpd A", "EC50 — Cpd B"]);
    expect(keyResultCards(FIX["shape_gf_4pl_shared_tb"]!, 0.95).verdict).toBeUndefined();
  });
});

/**
 * PERMANOVA. The permutation p leads; PERMDISP's p is shown and the verdict says which of three
 * readings holds, because a significant PERMANOVA with unequal spread is ambiguous. Real engine output, four designs.
 */
describe("PERMANOVA's key result tells location from spread", () => {
  it("groups apart, equal spread: p leads, R² and the pseudo-F with its df, the PERMDISP p, and 'differ in position'", () => {
    const k = keyResultCards(FIX["permanova"]!, 0.95);
    expect(k.cards.map((c) => c.label)).toEqual(["p (permutation)", "R²", "Pseudo-F", "PERMDISP p"]);
    expect(k.cards[2]!.detail).toBe("df 2, 9");
    expect(k.cards[0]!.tone).toBe("sig");
    expect(k.verdict).toBe("The groups differ in position (their spread does not differ significantly)");
  });

  it("apart AND unequal spread: the verdict warns the difference may be dispersion", () => {
    expect(keyResultCards(FIX["shape_permanova_both"]!, 0.95).verdict).toBe("The groups differ — but so does their spread, so the difference may be in dispersion");
  });

  it("no difference: says so, even when the spread alone differs", () => {
    expect(keyResultCards(FIX["shape_permanova_ns"]!, 0.95).verdict).toBe("No significant difference between the groups at α = 0.05");
    const spread = keyResultCards(FIX["shape_permanova_spread"]!, 0.95);
    expect(spread.verdict).toBe("No significant difference between the groups at α = 0.05");
    expect(spread.cards.find((c) => c.label === "PERMDISP p")!.tone, "the spread difference is still visible").toBe("sig");
  });

  it("the line on the graph leads with the permutation p", () => {
    expect(keyMetricLine(FIX["permanova"]!)).toMatch(/^p \(permutation\) = 0\.001/);
  });
});
