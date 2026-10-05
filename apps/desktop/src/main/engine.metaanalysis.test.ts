// @vitest-environment node
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { DataTable, Plot } from "@mady/core";
import { metaAnalysis } from "@mady/core";
import { buildPlotScene } from "@mady/graphics";
import { SidecarSupervisor } from "./sidecar";

/**
 * The meta-analysis engine method: its numbers. The verification is deliberately three-way:
 *   1. Here — the engine's numbers ≡ the core TypeScript `metaAnalysis` (an independent
 *      implementation the forest/funnel drawings already use), on the same studies.
 *   2. `crosscheck.py` — the engine ≡ statsmodels' `combine_effects` (a library sharing
 *      no code with the engine's hand-rolled formulas) + a stdlib re-derivation.
 *   3. The drawing — the funnel's pooled line must equal the analysis' pooled estimate
 *      on the same sheet (drawing ↔ analysis consistency, asserted here too).
 */
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

function sup(): SidecarSupervisor {
  return new SidecarSupervisor({ command: py, args: [enginePath], startTimeoutMs: 30_000 });
}

const STUDIES = [
  { est: 0.82, lo: 0.64, hi: 1.05, label: "Anderson 2011" },
  { est: 1.14, lo: 0.9, hi: 1.44, label: "Brown 2014" },
  { est: 0.67, lo: 0.49, hi: 0.92, label: "Chen 2016" },
  { est: 0.95, lo: 0.7, hi: 1.3, label: "Davis 2018" },
  { est: 1.21, lo: 0.78, hi: 1.88, label: "Egami 2020" },
];

describe.skipIf(!SCIPY)("engine metaanalysis — three-way agreement + clear refusals", () => {
  it("fixed + random pooling, heterogeneity, and weights all match core metaAnalysis (log space)", async () => {
    const s = sup();
    try {
      const r = await s.request("metaanalysis", { studies: STUDIES, conf: 0.95, log: true });
      expect(r["method"]).toBe("metaanalysis");
      const terms = r["terms"] as Array<Record<string, number | string | null>>;
      const glance = r["glance"] as Record<string, number>;
      const ts = (model: "fixed" | "random") =>
        metaAnalysis(STUDIES, { model, inputConf: 0.95, pooledConf: 0.95, log: true })!;
      const fixed = ts("fixed");
      const random = ts("random");
      const row = (re: RegExp) => terms.find((t) => re.test(String(t["term"])))!;
      const fRow = row(/fixed/i);
      const rRow = row(/random/i);
      expect(fRow["estimate"]).toBeCloseTo(fixed.est, 4);
      expect(fRow["ciLow"]).toBeCloseTo(fixed.lo, 4);
      expect(fRow["ciHigh"]).toBeCloseTo(fixed.hi, 4);
      expect(rRow["estimate"]).toBeCloseTo(random.est, 4);
      expect(rRow["ciLow"]).toBeCloseTo(random.lo, 4);
      expect(rRow["ciHigh"]).toBeCloseTo(random.hi, 4);
      expect(glance["Q"]).toBeCloseTo(fixed.q, 4);
      expect(glance["tau²"]).toBeCloseTo(fixed.tau2, 4);
      expect(glance["I² (%)"]).toBeCloseTo(fixed.i2, 4);
      expect(glance["k"]).toBe(5);
      // per-study rows carry both models' weights, in %, summing to ~100 each
      const studyRows = STUDIES.map((st) => row(new RegExp(st.label)));
      const wFixed = studyRows.map((t) => Number(t["weight fixed (%)"]));
      const wRandom = studyRows.map((t) => Number(t["weight random (%)"]));
      expect(wFixed.reduce((a, b) => a + b, 0)).toBeCloseTo(100, 3);
      expect(wRandom.reduce((a, b) => a + b, 0)).toBeCloseTo(100, 3);
      fixed.weights.forEach((w, i) => expect(wFixed[i]).toBeCloseTo(100 * w, 3));
      // per-study rows report the entered numbers (data space), not transformed ones
      expect(studyRows[0]!["estimate"]).toBeCloseTo(0.82, 8);
      expect(typeof r["summary"]).toBe("string");
    } finally {
      await s.stop();
    }
  }, 20_000);

  it("linear (difference) pooling matches too, at a non-default entered level", async () => {
    const s = sup();
    try {
      const diffs = STUDIES.map((x, i) => ({ est: x.est - 1, lo: x.lo - 1, hi: x.hi - 1, label: `S${i + 1}` }));
      const r = await s.request("metaanalysis", { studies: diffs, conf: 0.9, log: false });
      const fixed = metaAnalysis(diffs, { model: "fixed", inputConf: 0.9, pooledConf: 0.9, log: false })!;
      const terms = r["terms"] as Array<Record<string, number | string | null>>;
      const fRow = terms.find((t) => /fixed/i.test(String(t["term"])))!;
      expect(fRow["estimate"]).toBeCloseTo(fixed.est, 4);
      expect(fRow["ciLow"]).toBeCloseTo(fixed.lo, 4);
    } finally {
      await s.stop();
    }
  }, 20_000);

  it("refuses explicitly: <2 usable studies is an error; unusable ones are counted out loud", async () => {
    const s = sup();
    try {
      await expect(s.request("metaanalysis", { studies: [STUDIES[0]], conf: 0.95, log: false })).rejects.toThrow(/2 studies/i);
      // a backwards CI and a non-positive limit on the log scale are unusable, not fatal
      const r = await s.request("metaanalysis", {
        studies: [...STUDIES, { est: 1, lo: 1.4, hi: 0.6, label: "Backwards" }, { est: 0.5, lo: -0.1, hi: 0.9, label: "NonPos" }],
        conf: 0.95,
        log: true,
      });
      const glance = r["glance"] as Record<string, number>;
      expect(glance["k"]).toBe(5);
      const notes = [...((r["assumptions"] as string[]) ?? []), ...((r["warnings"] as string[]) ?? [])].join(" | ");
      expect(notes).toMatch(/2 stud/); // "...2 studies could not be used" — said, never silent
    } finally {
      await s.stop();
    }
  }, 20_000);

  it("the funnel drawing's pooled line equals the analysis' pooled estimate on the same sheet", async () => {
    const table: DataTable = {
      id: "tm", kind: "meta", name: "M",
      columns: [
        { id: "s", name: "Study", role: "x" },
        { id: "e", name: "Estimate", role: "y" },
        { id: "lo", name: "Lower", role: "y" },
        { id: "hi", name: "Upper", role: "y" },
      ],
      rows: STUDIES.map((x, i) => ({ id: `r${i}`, cells: { s: x.label, e: x.est, lo: x.lo, hi: x.hi } })),
    };
    const plot: Plot = { id: "p", name: "F", source: "tm", status: "ok", styleOverrides: {}, kind: "funnel", funnel: { model: "fixed" } };
    const scene = buildPlotScene(table, plot);
    const s = sup();
    try {
      const r = await s.request("metaanalysis", { studies: STUDIES, conf: 0.95, log: false });
      const terms = r["terms"] as Array<Record<string, number | string | null>>;
      const fRow = terms.find((t) => /fixed/i.test(String(t["term"])))!;
      expect(scene.funnel!.pooled).toBeCloseTo(Number(fRow["estimate"]), 4);
    } finally {
      await s.stop();
    }
  }, 20_000);
});
