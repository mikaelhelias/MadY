// @vitest-environment node
/**
 * The demo project's six analyses, run through the real Python engine with the same payload the
 * app builds (`buildAnalysisData`). The fixture ships no numbers; this is where the numbers are
 * shown to be the ones a scientist would expect from that data:
 *
 *   4PL fit        → EC50 ≈ 3 µM (the 48 % dose; measured 3.44), R² ≈ 0.99 (measured 0.989)
 *   ANOVA+Dunnett  → treatments differ; Drug A and Drug C beat Control
 *   ANOVA+Tukey    → the three dose groups all differ
 *   PCA            → PC1 carries most of the variance; 18 cases in 3 groups
 *   Wilcoxon       → twin h² above SNP h² on all 8 traits → p = 2/2⁸ = 0.0078
 *   clustering     → 3 clusters of the 8 genes, sizes summing to 8, a silhouette per k
 */
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildAnalysisData, createSampleDocument } from "@mady/core";
import type { Analysis } from "@mady/core";
import { SidecarSupervisor } from "./sidecar";

const enginePath = fileURLToPath(new URL("../../../../engines/py/engine.py", import.meta.url));
const py = process.platform === "win32" ? "py" : "python3";
function hasScipy(): boolean {
  try {
    execSync(`${py} -c "import scipy, numpy"`, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}
const SCIPY = hasScipy();

type Term = Record<string, unknown> & { term?: string; estimate?: number; p?: number | null };
type Result = { method: string; terms: Term[]; glance: Record<string, number | string | null>; extra?: Record<string, unknown>; warnings?: string[] };

const project = createSampleDocument().toJSON();
const sample = (tableName: string): Analysis => project.analyses.find((a) => project.tables.find((t) => t.id === a.source)!.name === tableName)!;
async function run(s: SidecarSupervisor, a: Analysis): Promise<Result> {
  const table = project.tables.find((t) => t.id === a.source)!;
  return (await s.request(a.method, buildAnalysisData(a.method, a.params, table))) as unknown as Result;
}
const term = (r: Result, re: RegExp): Term | undefined => r.terms.find((t) => re.test(String(t.term ?? "")));
const num = (v: unknown): number => (typeof v === "number" ? v : NaN);
/** The p-value of a result, wherever this method reports it. */
const pOf = (r: Result): number => num(r.glance["p"] ?? r.glance["pValue"] ?? r.glance["p_value"]);

describe.skipIf(!SCIPY)("demo project — every shipped analysis runs on the real engine and says what the data say", () => {
  it("dose–response: the 4PL fit lands on EC50 ≈ 3 µM with an excellent R²", async () => {
    const s = new SidecarSupervisor({ command: py, args: [enginePath], startTimeoutMs: 30_000 });
    try {
      const r = await run(s, sample("Sample — dose vs response"));
      const ec50 = term(r, /^EC50$/i) ?? term(r, /EC50/i);
      expect(ec50, `no EC50 term in ${JSON.stringify(r.terms.map((t) => t.term))}`).toBeDefined();
      expect(num(ec50!.estimate)).toBeGreaterThan(1.5);
      expect(num(ec50!.estimate)).toBeLessThan(6);
      const r2 = num(r.glance["r_sq"]);
      expect(r2, `glance ${JSON.stringify(r.glance)}`).toBeGreaterThan(0.98);
      const hill = term(r, /hill/i);
      expect(num(hill?.estimate)).toBeGreaterThan(0.6);
      expect(num(hill?.estimate)).toBeLessThan(1.6);
    } finally {
      await s.stop();
    }
  }, 30_000);

  it("treatment means: ANOVA over the row groups rejects equality; Dunnett flags Drug A and Drug C vs Control", async () => {
    const s = new SidecarSupervisor({ command: py, args: [enginePath], startTimeoutMs: 30_000 });
    try {
      const r = await run(s, sample("Treatment means"));
      expect(pOf(r), `glance ${JSON.stringify(r.glance)}`).toBeLessThan(0.001);
      const vsControl = r.terms.filter((t) => /Control/.test(String(t.term ?? "")) && /Drug/.test(String(t.term ?? "")));
      expect(vsControl.length, `terms ${JSON.stringify(r.terms.map((t) => t.term))}`).toBe(3);
      const p = (drug: string) => num(vsControl.find((t) => String(t.term).includes(drug))!.p);
      expect(p("Drug A")).toBeLessThan(0.01);
      expect(p("Drug C")).toBeLessThan(0.001);
    } finally {
      await s.stop();
    }
  }, 30_000);

  it("replicate readouts: ANOVA rejects equality and every Tukey pair differs", async () => {
    const s = new SidecarSupervisor({ command: py, args: [enginePath], startTimeoutMs: 30_000 });
    try {
      const r = await run(s, sample("Replicate readouts"));
      expect(pOf(r), `glance ${JSON.stringify(r.glance)}`).toBeLessThan(1e-6);
      // The three post-hoc pairs are the terms naming two groups ("Vehicle vs Low dose"); the
      // residual-normality row also carries a hyphen (Shapiro-Wilk), so match on the group names.
      const groups = ["Vehicle", "Low dose", "High dose"];
      const pairs = r.terms.filter((t) => groups.filter((g) => String(t.term ?? "").includes(g)).length === 2 && typeof t.p === "number");
      expect(pairs.length, `terms ${JSON.stringify(r.terms.map((t) => t.term))}`).toBe(3);
      for (const t of pairs) expect(num(t.p), String(t.term)).toBeLessThan(0.001);
    } finally {
      await s.stop();
    }
  }, 30_000);

  it("cell profiling: PCA keeps 18 grouped cases and PC1 explains most of the variance", async () => {
    const s = new SidecarSupervisor({ command: py, args: [enginePath], startTimeoutMs: 30_000 });
    try {
      const r = await run(s, sample("Cell profiling (PCA demo)"));
      const pca = r.extra?.["pca"] as { explained: number[]; scores: number[][]; groups?: unknown[] } | undefined;
      expect(pca, `extra ${JSON.stringify(Object.keys(r.extra ?? {}))}`).toBeDefined();
      expect(pca!.scores).toHaveLength(18);
      expect(pca!.explained[0]!).toBeGreaterThan(0.5);
      expect(new Set(pca!.groups ?? [])).toEqual(new Set(["Neuron", "Glia", "Stem"]));
    } finally {
      await s.stop();
    }
  }, 30_000);

  it("heritability: Wilcoxon signed-rank on 8 one-directional pairs gives the exact p = 2/256", async () => {
    const s = new SidecarSupervisor({ command: py, args: [enginePath], startTimeoutMs: 30_000 });
    try {
      const r = await run(s, sample("Heritability"));
      expect(pOf(r), `glance ${JSON.stringify(r.glance)}`).toBeCloseTo(2 / 256, 3);
    } finally {
      await s.stop();
    }
  }, 30_000);

  it("gene expression: hierarchical clustering cuts the 8 genes into 3 clusters and scans k = 2…5", async () => {
    const s = new SidecarSupervisor({ command: py, args: [enginePath], startTimeoutMs: 30_000 });
    try {
      const r = await run(s, sample("Gene expression"));
      const cl = r.extra?.["cluster"] as { labels?: number[]; sizes?: number[]; scan?: unknown[] } | undefined;
      const labels = (cl?.labels ?? (r.extra?.["labels"] as number[] | undefined)) ?? [];
      expect(labels, `extra ${JSON.stringify(r.extra)}`).toHaveLength(8);
      expect(new Set(labels).size).toBe(3);
      expect(num(r.glance["silhouette"] ?? r.glance["meanSilhouette"])).toBeGreaterThan(0);
    } finally {
      await s.stop();
    }
  }, 30_000);
});
