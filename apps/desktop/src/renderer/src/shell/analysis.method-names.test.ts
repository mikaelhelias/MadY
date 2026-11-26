/**
 * `defaultAnalysisName` ends in the t-test line, so a method it has no case for is named like a t
 * test ("unpaired t — Yield vs Fert") in the tab, the navigator and the log. Every method must be
 * named as itself.
 */
import { describe, expect, it } from "vitest";
import { MadyDocument } from "@mady/core";
import { defaultAnalysisName, METHOD_INFO } from "./analysis";

describe("defaultAnalysisName — every method is named as itself", () => {
  const doc = new MadyDocument();
  const t = doc.addTable("Trial", "xy", ["Row", "Yield", "Fert", "Variety", "Plot"]);
  const table = doc.toJSON().tables[0]!;
  const cols = t.columns.slice(1).map((c) => c.id);

  it("no method other than the t test carries a t-test name", () => {
    const tName = defaultAnalysisName("ttest", { columns: cols.slice(0, 2) }, table);
    expect(tName).toMatch(/^unpaired t — /);
    for (const method of Object.keys(METHOD_INFO)) {
      if (method === "ttest") continue;
      const name = defaultAnalysisName(method, { columns: cols }, table);
      expect(name, `${method} is named like a t test: "${name}"`).not.toMatch(/^(unpaired t|t test|paired t|Welch t|one-sample t) — /);
    }
  });

  it("multifactor ANOVA names the value and its factors", () => {
    expect(defaultAnalysisName("multifactor", { columns: cols }, table)).toBe("Multifactor ANOVA — Yield ~ Fert × Variety × Plot");
  });

  it("distance-based methods name their distance as a reader knows it, not by its internal id", () => {
    const ids = { columns: cols.slice(0, 3), explanatory: [cols[2]!] };
    expect(defaultAnalysisName("pcoa", { ...ids, metric: "braycurtis" }, table)).toBe("PCoA (Bray-Curtis) — 3 variables");
    expect(defaultAnalysisName("nmds", { ...ids, metric: "cityblock" }, table)).toBe("NMDS (Manhattan) — 3 variables");
    expect(defaultAnalysisName("dbrda", { ...ids, metric: "correlation" }, table)).toBe("db-RDA (1 − correlation) — 2 response ~ 1 explanatory");
    expect(defaultAnalysisName("permanova", { columns: cols.slice(0, 3), groupBy: cols[0]!, metric: "euclidean" }, table)).toMatch(/^PERMANOVA \(Euclidean\) — /);
  });

  it("the mixed model names the value, the fixed factors and the random group, and the fit method", () => {
    expect(defaultAnalysisName("mixedmodel", { columns: cols }, table)).toBe("Mixed-effects model — Yield ~ Variety + Plot (random: Fert)");
    expect(defaultAnalysisName("mixedmodel", { columns: cols.slice(0, 2), variant: "ml" }, table)).toBe("Mixed-effects model (ML) — Yield ~ 1 (random: Fert)");
  });
});
