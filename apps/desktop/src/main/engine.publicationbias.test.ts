// @vitest-environment node
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { DataTable, Plot } from "@mady/core";
import { eggerTest, trimAndFill } from "@mady/core";
import { buildPlotScene } from "@mady/graphics";
import { SidecarSupervisor } from "./sidecar";

/**
 * Publication-bias engine method (Egger + trim-and-fill).
 * The verification is deliberately three-way, following the metaanalysis tests:
 *   1. Here — the engine's numbers ≡ the core TypeScript `eggerTest` / `trimAndFill`
 *      (independent implementations the funnel drawing's overlay uses), same studies.
 *   2. `crosscheck.py` — the engine ≡ a statsmodels OLS (Egger) + a stdlib trim-and-fill
 *      re-derivation + a constructed-suppression truth (delete the low tail of a
 *      symmetric funnel → the method must impute there and move back toward the truth).
 *   3. The drawing — the funnel's Trim-and-fill overlay must show the same imputed
 *      studies and adjusted line the analysis reports (asserted here too).
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

// The one-sided funnel core trimAndFill's tests hand-derive (k0 = 1): three precise
// studies at 0 (SE ≈ 0.1) and two imprecise high ones (SE ≈ 1).
const Z95 = 1.959963984540054;
const SKEWED = [
  { est: 0, lo: -Z95 * 0.1, hi: Z95 * 0.1, label: "P1" },
  { est: 0, lo: -Z95 * 0.1, hi: Z95 * 0.1, label: "P2" },
  { est: 0, lo: -Z95 * 0.1, hi: Z95 * 0.1, label: "P3" },
  { est: 1, lo: 1 - Z95, hi: 1 + Z95, label: "S1" },
  { est: 2, lo: 2 - Z95, hi: 2 + Z95, label: "S2" },
];

describe.skipIf(!SCIPY)("engine publicationbias — three-way agreement + clear refusals", () => {
  it("Egger intercept/slope/t/p/CI match core eggerTest (log space)", async () => {
    const s = sup();
    try {
      const r = await s.request("publicationbias", { studies: STUDIES, conf: 0.95, log: true });
      expect(r["method"]).toBe("publicationbias");
      const terms = r["terms"] as Array<Record<string, number | string | null>>;
      const eg = terms.find((t) => /egger intercept/i.test(String(t["term"])))!;
      const sl = terms.find((t) => /egger slope/i.test(String(t["term"])))!;
      const ts = eggerTest(STUDIES, { inputConf: 0.95, log: true, ciConf: 0.95 })!;
      expect(eg["estimate"]).toBeCloseTo(ts.intercept, 4);
      expect(eg["se"]).toBeCloseTo(ts.interceptSe, 4);
      expect(eg["statistic"]).toBeCloseTo(ts.t, 4);
      expect(eg["df"]).toBe(ts.df);
      expect(eg["p"]).toBeCloseTo(ts.p, 4);
      expect(eg["ciLow"]).toBeCloseTo(ts.ciLow, 3);
      expect(eg["ciHigh"]).toBeCloseTo(ts.ciHigh, 3);
      expect(sl["estimate"]).toBeCloseTo(ts.slope, 4);
    } finally {
      await s.stop();
    }
  }, 20_000);

  it("trim-and-fill k0, side, imputed studies and adjusted pooling match core trimAndFill", async () => {
    const s = sup();
    try {
      const r = await s.request("publicationbias", { studies: SKEWED, conf: 0.95, log: false });
      const glance = r["glance"] as Record<string, number | string>;
      const terms = r["terms"] as Array<Record<string, number | string | null>>;
      const ts = trimAndFill(SKEWED, { model: "fixed", inputConf: 0.95, pooledConf: 0.95, log: false })!;
      const tsRandom = trimAndFill(SKEWED, { model: "random", inputConf: 0.95, pooledConf: 0.95, log: false })!;
      expect(ts.k0).toBeGreaterThan(0); // the fixture CAN exhibit imputation
      expect(glance["k₀ (imputed)"]).toBe(ts.k0);
      expect(glance["side"]).toBe(ts.side);
      const impRows = terms.filter((t) => /^Imputed study/.test(String(t["term"])));
      expect(impRows.length).toBe(ts.k0);
      impRows.forEach((row, i) => {
        expect(row["estimate"]).toBeCloseTo(ts.imputed[i]!.est, 4);
        expect(row["ciLow"]).toBeCloseTo(ts.imputed[i]!.lo, 4);
        expect(row["ciHigh"]).toBeCloseTo(ts.imputed[i]!.hi, 4);
      });
      const adjF = terms.find((t) => /adjusted pooled — fixed/i.test(String(t["term"])))!;
      const adjR = terms.find((t) => /adjusted pooled — random/i.test(String(t["term"])))!;
      expect(adjF["estimate"]).toBeCloseTo(ts.adjusted.est, 4);
      expect(adjF["ciLow"]).toBeCloseTo(ts.adjusted.lo, 4);
      expect(adjF["ciHigh"]).toBeCloseTo(ts.adjusted.hi, 4);
      expect(adjR["estimate"]).toBeCloseTo(tsRandom.adjusted.est, 4);
      expect(typeof r["summary"]).toBe("string");
    } finally {
      await s.stop();
    }
  }, 20_000);

  it("refuses with a clear error: <3 usable studies, and equal precisions (a singular Egger)", async () => {
    const s = sup();
    try {
      await expect(s.request("publicationbias", { studies: SKEWED.slice(0, 2), conf: 0.95, log: false })).rejects.toThrow(/3 studies/i);
      const flat = [0.1, 0.5, 0.9].map((e, i) => ({ est: e, lo: e - 1, hi: e + 1, label: `F${i}` }));
      await expect(s.request("publicationbias", { studies: flat, conf: 0.95, log: false })).rejects.toThrow(/precision/i);
    } finally {
      await s.stop();
    }
  }, 20_000);

  it("the funnel DRAWING's trim-and-fill overlay shows the same imputed studies and adjusted line", async () => {
    const table: DataTable = {
      id: "tm", kind: "meta", name: "M",
      columns: [
        { id: "s", name: "Study", role: "x" },
        { id: "e", name: "Estimate", role: "y" },
        { id: "lo", name: "Lower", role: "y" },
        { id: "hi", name: "Upper", role: "y" },
      ],
      rows: SKEWED.map((x, i) => ({ id: `r${i}`, cells: { s: x.label, e: x.est, lo: x.lo, hi: x.hi } })),
    };
    const plot: Plot = { id: "p", name: "F", source: "tm", status: "ok", styleOverrides: {}, kind: "funnel", funnel: { model: "fixed", trimFill: true } };
    const scene = buildPlotScene(table, plot);
    const s = sup();
    try {
      const r = await s.request("publicationbias", { studies: SKEWED, conf: 0.95, log: false });
      const terms = r["terms"] as Array<Record<string, number | string | null>>;
      const impRows = terms.filter((t) => /^Imputed study/.test(String(t["term"])));
      expect(scene.funnel!.imputed!.length).toBe(impRows.length);
      scene.funnel!.imputed!.forEach((d, i) => expect(d.est).toBeCloseTo(Number(impRows[i]!["estimate"]), 4));
      const adjF = terms.find((t) => /adjusted pooled — fixed/i.test(String(t["term"])))!;
      expect(scene.funnel!.trimFill!.adjusted).toBeCloseTo(Number(adjF["estimate"]), 4);
    } finally {
      await s.stop();
    }
  }, 20_000);
});
