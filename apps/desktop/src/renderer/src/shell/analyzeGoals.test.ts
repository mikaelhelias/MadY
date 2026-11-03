// @vitest-environment node
import { describe, expect, it } from "vitest";
import { TABLE_FORMAT_ORDER } from "@mady/core";
import type { TableKind } from "@mady/core";
import { COMMON_ANALYSES, METHOD_KINDS, methodFitsKind, rankGoals } from "./analyzeGoals";
import { METHOD_GROUPS } from "./analysis";

/**
 * The Analyze landing orders and marks its goal tiles by the datasheet, so that a
 * dose-response / enzyme-kinetics / binding row does not sit in front of someone holding
 * a table of groups with nothing marking what actually applies. These tiles are the
 * first thing a user sees, so their order and emphasis must follow the data.
 *
 * Every table kind is covered here: each must surface at least one applicable goal,
 * and the obvious mismatches must be de-emphasised rather than silently offered.
 */
const fits = (kind: TableKind): string[] => rankGoals(kind, []).filter((g) => g.applies).map((g) => g.key);
const dimmed = (kind: TableKind): string[] => rankGoals(kind, []).filter((g) => !g.applies).map((g) => g.key);

/** Formats with no applicable statistics, by design — each with its reason. The every-kind
 *  tests below catch kinds accidentally locked out of Analyze; a drawing-only format is a
 *  decision, recorded here (one registry, read by both tests) so it cannot be a silent
 *  hole. */
const NO_STATISTICS: Record<string, string> = {
  sets: "a membership sheet is a drawing format (Venn/UpSet) — no overlap-enrichment (hypergeometric) test is offered on it",
  timeline: "a subject timeline is a drawing format (swimmer) — a t test over Start vs End columns would be meaningless, which is why the swimmer has its own format rather than the generic Column format",
  // meta is not in this list: the "metaanalysis" method is its statistic.
  edgelist: "an edge list is a drawing format (network) — its rows are links, not cases, so correlation/PCA/regression over the weight and node-attribute columns would be meaningless, which is why the network has its own format rather than the Multiple-variables format; graph-level statistics (degree distribution, modularity) are not offered",
  association: "a GWAS association sheet is a drawing format (Manhattan/QQ) — its rows are pre-computed per-SNP results (Chr/Position/P), not cases, so t tests/ANOVA/regression over them mislead; the only legitimate statistic is the QQ's genomic inflation λ, computed by the drawing",
  alterations: "an alterations sheet is a drawing format (oncoprint) — its rows are alteration events (Sample/Gene/type), not cases, so t tests/ANOVA/regression over them would be meaningless; a per-gene alteration frequency is a count the drawing shows, not an inference",
};

describe("Analyze goal tiles — applicability", () => {
  it("offers every goal for every kind — nothing is ever hidden", () => {
    for (const kind of TABLE_FORMAT_ORDER) {
      expect(rankGoals(kind, []).map((g) => g.key).sort()).toEqual(COMMON_ANALYSES.map((g) => g.key).sort());
    }
  });

  // (NO_STATISTICS — the drawing-only-format registry — is at file scope above, shared
  // with the catalogue-fit test so the two can never disagree.)

  it("marks at least one applicable goal for every table kind", () => {
    for (const kind of TABLE_FORMAT_ORDER) {
      if (NO_STATISTICS[kind]) continue;
      expect(fits(kind), `no goal applies to a "${kind}" datasheet`).not.toHaveLength(0);
    }
  });

  it("an XY sheet leads with the curve/association work, not group comparison", () => {
    expect(fits("xy")).toEqual(expect.arrayContaining(["dose-response", "enzyme", "binding", "curvefit", "correlation", "regression"]));
    expect(dimmed("xy")).toEqual(expect.arrayContaining(["compare", "survival", "contingency"]));
  });

  it("a column sheet leads with group comparison, not dose-response", () => {
    expect(fits("column")).toContain("compare");
    expect(dimmed("column")).toEqual(expect.arrayContaining(["dose-response", "enzyme", "binding", "curvefit"]));
  });

  it("grouped and nested sheets still count as group comparisons", () => {
    expect(fits("grouped")).toContain("compare");
    expect(fits("nested")).toContain("compare");
  });

  it("routes contingency, parts-of-whole, survival and multivariable sheets to their own tiles", () => {
    expect(fits("contingency")).toContain("contingency");
    expect(fits("partsofwhole")).toContain("proportions");
    expect(fits("survival")).toContain("survival");
    expect(fits("multivariable")).toContain("pca");
  });

  it("puts applicable goals first, so the order itself carries the advice", () => {
    const order = rankGoals("column", []).map((g) => g.key);
    const firstDimmed = order.findIndex((k) => dimmed("column").includes(k));
    const lastFitting = order.reduce((acc, k, i) => (fits("column").includes(k) ? i : acc), -1);
    expect(lastFitting).toBeLessThan(firstDimmed);
  });

  it("a live recommendation outranks a merely-applicable goal and is flagged", () => {
    const ranked = rankGoals("xy", ["correlation"]);
    expect(ranked[0]!.key).toBe("correlation");
    expect(ranked[0]!.recommended).toBe(true);
    expect(ranked.filter((g) => g.recommended)).toHaveLength(1);
  });

  it("badges 'Compare groups' for an ANOVA recommendation — the tile stands for the family", () => {
    const ranked = rankGoals("column", ["anova"]);
    expect(ranked[0]!.key).toBe("compare");
    expect(ranked[0]!.recommended).toBe(true);
  });

  it("badges Multivariable for a correlation-matrix recommendation", () => {
    expect(rankGoals("multivariable", ["corrmatrix"])[0]!.key).toBe("pca");
  });
});

/**
 * The catalogue list under the tiles ("Browse all analyses") is data-aware too: without
 * it, every method in it reads the same whether it suits the sheet or not.
 * `methodFitsKind` is what lets that list mark the ones that fit.
 */
describe("catalogue — method ↔ datasheet fit", () => {
  it("maps a method that belongs to several data types to all of them", () => {
    // Cox regression is both a survival method and a multivariable one. A single-valued
    // map would keep only the last, so it would vanish from one of the filters.
    expect(METHOD_KINDS["cox"]).toEqual(expect.arrayContaining(["survival", "multivariable"]));
    expect(methodFitsKind("cox", "survival")).toBe(true);
    expect(methodFitsKind("cox", "multivariable")).toBe(true);
  });

  it("matches the group tests to group sheets and the curve tests to XY", () => {
    expect(methodFitsKind("ttest", "column")).toBe(true);
    expect(methodFitsKind("anova", "grouped")).toBe(true);
    expect(methodFitsKind("curvefit", "column")).toBe(false);
    expect(methodFitsKind("curvefit", "xy")).toBe(true);
    expect(methodFitsKind("goodnessoffit", "partsofwhole")).toBe(true);
    expect(methodFitsKind("contingency", "contingency")).toBe(true);
  });

  it("finds a fitting method for every table kind", () => {
    for (const kind of TABLE_FORMAT_ORDER) {
      if (NO_STATISTICS[kind]) continue; // drawing-only formats — the one registry above
      const any = Object.keys(METHOD_KINDS).some((m) => methodFitsKind(m, kind));
      expect(any, `no catalogue method fits a "${kind}" datasheet`).toBe(true);
    }
  });

  /**
   * Guards against three mapping faults: a catalogue method on no data-type card reads
   * "Not typical for this datasheet" everywhere and vanishes under every filter; the
   * multivariable sheet must not "fit" the whole XY set (dose-response for Iris); the
   * survival sheet must not "fit" the column tests (a t test on censored times).
   */
  it("every catalogue method belongs to at least one data-type card (default-deny)", () => {
    for (const m of METHOD_GROUPS.flatMap((g) => g.methods)) {
      expect(METHOD_KINDS[m]?.length ?? 0, `"${m}" is on no data-type card`).toBeGreaterThan(0);
    }
  });

  it("the two-group family (equivalence · permutation · Bayes factor) is column work; curve transform is XY work", () => {
    for (const m of ["equivalence", "permutation", "bayesfactor"]) {
      expect(methodFitsKind(m, "column"), m).toBe(true);
      expect(methodFitsKind(m, "xy"), m).toBe(false);
    }
    expect(methodFitsKind("curvetransform", "xy")).toBe(true);
    expect(methodFitsKind("curvetransform", "column")).toBe(false);
  });

  it("a multivariable sheet fits correlation + regression, not the whole XY set", () => {
    expect(methodFitsKind("correlation", "multivariable")).toBe(true);
    expect(methodFitsKind("regression", "multivariable")).toBe(true);
    expect(methodFitsKind("multipleregression", "multivariable")).toBe(true);
    for (const m of ["curvefit", "roc", "blandaltman", "deming", "interpolate"]) {
      expect(methodFitsKind(m, "multivariable"), m).toBe(false);
    }
  });

  it("a survival sheet does not fit the column tests", () => {
    expect(methodFitsKind("ttest", "survival")).toBe(false);
    expect(methodFitsKind("anova", "survival")).toBe(false);
    expect(methodFitsKind("survival", "survival")).toBe(true);
    expect(methodFitsKind("cox", "survival")).toBe(true);
  });

  it("a recommendation for a goal that does not match the kind still counts as applicable", () => {
    // The suggester saw the actual values; it outranks the coarse kind mapping.
    const ranked = rankGoals("column", ["curvefit"]);
    const curve = ranked.find((g) => g.key === "curvefit")!;
    expect(curve.recommended).toBe(true);
    expect(curve.applies).toBe(true);
  });
});
