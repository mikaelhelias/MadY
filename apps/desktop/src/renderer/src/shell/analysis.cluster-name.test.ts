/**
 * Guards against `defaultAnalysisName` lacking a case for the cluster method: a cluster analysis
 * would fall through to the t-test line and be named like a t test ("unpaired t — Ctrl vs Drug A").
 * A name that says the wrong test is worse than none.
 */
import { describe, expect, it } from "vitest";
import { MadyDocument } from "@mady/core";
import { defaultAnalysisName } from "./analysis";

describe("defaultAnalysisName — cluster analysis", () => {
  const doc = new MadyDocument();
  const t = doc.addTable("Genes", "xy", ["Gene", "Ctrl", "Drug A", "Drug B"]);
  const cols = t.columns.slice(1).map((c) => c.id);

  it("hierarchical clustering is named as clustering, with k and the variable count", () => {
    const name = defaultAnalysisName("cluster", { columns: cols, variant: "hierarchical", k: 3 }, doc.toJSON().tables[0]!);
    expect(name).toBe("Hierarchical clustering (k = 3) — 3 variables");
    expect(name).not.toMatch(/\bt\b/);
  });

  it("k-means is named as k-means, with the default k", () => {
    const name = defaultAnalysisName("cluster", { columns: cols }, doc.toJSON().tables[0]!);
    expect(name).toBe("k-means clustering (k = 3) — 3 variables");
  });
});
