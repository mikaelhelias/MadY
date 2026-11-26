/**
 * The demo project ships analyses, not just datasheets and graphs: analyses that
 * make scientific sense, for demonstration. Each one is the
 * analysis a scientist would actually run on that sheet:
 *
 *   dose–response (7 doses × 3 replicates)  → 4PL dose-response fit (EC50)
 *   gene expression (8 genes × 5 conditions)→ hierarchical clustering of the genes
 *   treatment means (4 treatments in rows)  → one-way ANOVA + Dunnett vs Control (row groups)
 *   replicate readouts (3 dose groups × 8)  → one-way ANOVA + Tukey all pairs
 *   cell profiling (18 cases × 4 variables) → PCA, grouped by cell type
 *   heritability (8 traits, twin vs SNP h²) → Wilcoxon signed-rank (paired, n = 8)
 *
 * The numbers are computed by the real engine when the app boots (`fillMissingAnalysisResults`),
 * never typed into the fixture — so here every analysis is stale with no result, and what is
 * checked is the shape the engine will receive (the same `buildAnalysisData` the app uses).
 * `engine.sample.test.ts` (desktop main) runs these payloads through the Python engine.
 */
import { describe, expect, it } from "vitest";
import { buildAnalysisData } from "./analysisData";
import { rowGroupsUsable } from "./rowGroups";
import { createSampleDocument } from "./sample";
import type { Analysis, DataTable, Project } from "./model";

const project: Project = createSampleDocument().toJSON();
const tableOf = (a: Analysis): DataTable => project.tables.find((t) => t.id === a.source)!;
const byTable = (name: string): Analysis[] => project.analyses.filter((a) => tableOf(a)?.name === name);
const payload = (a: Analysis): Record<string, unknown> => buildAnalysisData(a.method, a.params, tableOf(a));

describe("demo project — analyses", () => {
  it("ships one analysis per sheet that supports one, every one bound to a real table", () => {
    expect(project.analyses.length).toBeGreaterThanOrEqual(6);
    for (const a of project.analyses) expect(tableOf(a), `${a.name}: source table missing`).toBeDefined();
  });

  it("every analysis is filed in the same experiment as its datasheet — nothing loose", () => {
    expect(project.workspace.loose).toEqual([]);
    const exps = project.workspace.folders[0]!.experiments;
    for (const a of project.analyses) {
      const home = exps.find((e) => e.members.some((m) => m.kind === "table" && m.id === a.source))!;
      expect(home.members.some((m) => m.kind === "analysis" && m.id === a.id), `${a.name} is not filed with its sheet`).toBe(true);
    }
  });

  it("no result is baked in: the engine computes every number (stale, result-less)", () => {
    for (const a of project.analyses) {
      expect(a.status, a.name).toBe("stale");
      expect(a.result, a.name).toBeUndefined();
    }
  });

  it("dose–response: a 4PL fit of Response vs Dose over all 21 replicate points", () => {
    const [a] = byTable("Sample — dose vs response");
    expect(a?.method).toBe("curvefit");
    const p = payload(a!) as { model: string; x: number[]; y: number[] };
    expect(p.model).toBe("4pl");
    expect(p.x).toHaveLength(21);
    expect(p.y).toHaveLength(21);
    expect(p.x.every((x) => x > 0), "a log-dose fit needs positive doses").toBe(true);
  });

  it("gene expression: hierarchical clustering of the 8 genes over the 5 conditions", () => {
    const [a] = byTable("Gene expression");
    expect(a?.method).toBe("cluster");
    const p = payload(a!) as { variant: string; columns: (number | null)[][]; labels: string[] };
    expect(p.variant).toBe("hierarchical");
    expect(p.labels).toEqual(["Ctrl", "Drug A", "Drug B", "Drug C", "Combo"]);
    expect(p.columns.every((c) => c.length === 8 && c.every((v) => typeof v === "number"))).toBe(true);
  });

  it("treatment means: one-way ANOVA over the four row groups, Dunnett vs Control", () => {
    const [a] = byTable("Treatment means");
    expect(a?.method).toBe("anova");
    const p = payload(a!) as { groups: number[][]; labels: string[]; posthoc: string; scheme: string; control: number };
    expect(p.labels).toEqual(["Control", "Drug A", "Drug B", "Drug C"]);
    expect(p.groups.map((g) => g.length)).toEqual([3, 3, 3, 3]);
    expect(p.groups[0]).toEqual([12, 15, 9]);
    expect(p.posthoc).toBe("dunnett");
    expect(p.scheme).toBe("vs-control");
    expect(p.control).toBe(0);
    // A user can make this same analysis from the Analyze dialog: the sheet offers row groups.
    expect(rowGroupsUsable(tableOf(a!))).toBe(true);
  });

  it("replicate readouts: one-way ANOVA over the three dose groups, Tukey all pairs", () => {
    const [a] = byTable("Replicate readouts");
    expect(a?.method).toBe("anova");
    const p = payload(a!) as { groups: number[][]; labels: string[]; posthoc: string; scheme: string };
    expect(p.labels).toEqual(["Vehicle", "Low dose", "High dose"]);
    expect(p.groups.map((g) => g.length)).toEqual([8, 8, 8]);
    expect(p.posthoc).toBe("tukey");
    expect(p.scheme).toBe("all-pairs");
  });

  it("cell profiling: PCA of the four measurements, cases grouped by cell type", () => {
    const [a] = byTable("Cell profiling (PCA demo)");
    expect(a?.method).toBe("pca");
    const p = payload(a!) as { columns: (number | null)[][]; labels: string[]; groups: unknown[]; standardize: boolean };
    expect(p.labels).toEqual(["Size", "Granularity", "Marker A", "Marker B"]);
    expect(p.columns.every((c) => c.length === 18)).toBe(true);
    expect(new Set(p.groups)).toEqual(new Set(["Neuron", "Glia", "Stem"]));
    expect(p.standardize).toBe(true);
  });

  it("heritability: Wilcoxon signed-rank on the 8 twin-vs-SNP pairs, row-aligned", () => {
    const [a] = byTable("Heritability");
    expect(a?.method).toBe("ttest");
    const p = payload(a!) as { variant: string; a: number[]; b: number[] };
    expect(p.variant).toBe("wilcoxon");
    expect(p.a).toHaveLength(8);
    expect(p.b).toHaveLength(8);
    expect(p.a[0]).toBe(0.43); // Educational attainment, twin
    expect(p.b[0]).toBe(0.11); // …and its SNP estimate, same row
  });

  it("sheets with nothing to test carry no analysis (single values, a composition, an edge list)", () => {
    for (const name of ["Quarterly scores", "US economy", "Immune signaling"]) expect(byTable(name), name).toEqual([]);
  });
});
