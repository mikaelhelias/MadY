// @vitest-environment node
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { SidecarSupervisor } from "./sidecar";

/**
 * Guards against a blank cell silently re-pairing every row after it.
 *
 * `_num` compacts: dropping a blank slides every later value up one row. Two columns
 * cleaned independently and then truncated to the shorter length are no longer the same
 * rows. Sending x = [1, blank, 3, 4] against y = [10, 20, 30, 40] would pair 3 with 20 and
 * 4 with 30 — pairs the user never had — and report a plausible r = 0.982 for data whose
 * true correlation is exactly 1.
 *
 * Note: the desktop UI pre-aligns rows before it calls the engine, so clicking through the
 * app cannot show this. The MCP/agent API and the exported reproduction scripts call the
 * engine directly. These tests go straight to the engine for that reason — a test routed
 * through the renderer's payload builder cannot see a mispairing.
 *
 * The data below is chosen so a mispairing is unmistakable: y = 10x exactly, so correct
 * pairing gives r = 1 and slope = 10, and any misalignment breaks both.
 */
const enginePath = fileURLToPath(new URL("../../../../engines/py/engine.py", import.meta.url));
const py = process.platform === "win32" ? "py" : "python3";
// `py -3` rather than `py`: given a script and no version, the Windows launcher follows the
// script's `#!` line and can pick another Python found on PATH, one without the packages.
const pyArgs = process.platform === "win32" ? ["-3"] : [];
function hasScipy(): boolean {
  try { execSync(`${[py, ...pyArgs].join(" ")} -c "import scipy, numpy"`, { stdio: "ignore" }); return true; } catch { return false; }
}
const SCIPY = hasScipy();
const sup = (): SidecarSupervisor => new SidecarSupervisor({ command: py, args: [...pyArgs, enginePath], startTimeoutMs: 30_000 });

/** A blank in the middle of x; y complete. True complete-case pairs: (1,10) (3,30) (4,40). */
const X_GAPPY = [1, null, 3, 4];
const Y_FULL = [10, 20, 30, 40];

describe.skipIf(!SCIPY)("a blank drops its whole row instead of shifting the column up", () => {
  it("correlation: pairs stay together (r = 1, not the mispaired 0.982)", async () => {
    const s = sup();
    try {
      const r = await s.request("correlation", { a: X_GAPPY, b: Y_FULL, variant: "pearson", conf: 0.95 });
      expect(r["glance"]).toMatchObject({ n: 3 });
      expect((r["glance"] as Record<string, number>)["r"]).toBeCloseTo(1, 10);
    } finally {
      await s.stop();
    }
  }, 40_000);

  it("regression: slope is 10 (the true relation), not a mispaired approximation", async () => {
    const s = sup();
    try {
      const r = await s.request("regression", { x: X_GAPPY, y: Y_FULL, conf: 0.95 });
      expect((r["glance"] as Record<string, number>)["slope"]).toBeCloseTo(10, 10);
      expect((r["glance"] as Record<string, number>)["r_sq"]).toBeCloseTo(1, 10);
    } finally {
      await s.stop();
    }
  }, 40_000);

  it("paired t: differences are per-ROW (mean 24), and a blank does not make it refuse", async () => {
    const s = sup();
    try {
      // Cleaning the columns separately would leave them 3 and 4 long and raise
      // "paired t needs equal-length groups", although the user sent equal columns.
      const r = await s.request("ttest", { a: X_GAPPY, b: Y_FULL, variant: "paired", conf: 0.95 });
      const diff = (r["terms"] as Array<Record<string, unknown>>).find((t) => String(t["term"]).startsWith("Mean difference"));
      expect(diff, "expected a Mean difference term").toBeDefined();
      // mean([10-1, 30-3, 40-4]) = 24, sign per the engine's (A − B) convention.
      expect(Math.abs(diff!["estimate"] as number)).toBeCloseTo(24, 10);
    } finally {
      await s.stop();
    }
  }, 40_000);

  it("Bland-Altman: bias is the per-row mean difference", async () => {
    const s = sup();
    try {
      const r = await s.request("blandaltman", { x: X_GAPPY, y: Y_FULL, conf: 0.95 });
      const g = r["glance"] as Record<string, number>;
      const bias = g["bias"] ?? g["mean_diff"];
      expect(bias, "expected a bias / mean_diff in the glance").toBeDefined();
      expect(Math.abs(bias!)).toBeCloseTo(24, 6);
    } finally {
      await s.stop();
    }
  }, 40_000);

  it("AUC: the curve keeps its own points", async () => {
    const s = sup();
    try {
      // Correct pairs (1,10) (3,30) (4,40) → trapezoids: 2*20 + 1*35 = 75.
      const r = await s.request("auc", { x: X_GAPPY, y: Y_FULL });
      expect((r["glance"] as Record<string, number>)["net"]).toBeCloseTo(75, 6);
    } finally {
      await s.stop();
    }
  }, 40_000);

  /**
   * The other half of the contract. Row-alignment is only right for paired data —
   * applying it to independent samples would drop a real observation from one group
   * because the other has a blank in that row, quietly shrinking someone's n.
   */
  it("contrast: independent samples are not row-aligned — each group keeps its own values", async () => {
    const s = sup();
    try {
      const r = await s.request("ttest", { a: X_GAPPY, b: Y_FULL, variant: "welch", conf: 0.95 });
      const g = r["glance"] as Record<string, number>;
      // A loses only its own blank (4 → 3); B keeps all 4. If alignment leaked into the
      // unpaired path both would read 3.
      expect(g["n_A"]).toBe(3);
      expect(g["n_B"]).toBe(4);
    } finally {
      await s.stop();
    }
  }, 40_000);

  it("contrast: ANOVA groups are independent too — a blank in one does not shrink another", async () => {
    const s = sup();
    try {
      const r = await s.request("anova1", {
        groups: [[1, null, 3, 4], [10, 20, 30, 40], [5, 6, 7, 8]],
        labels: ["A", "B", "C"], variant: "oneway",
      });
      const df = (r["terms"] as Array<Record<string, unknown>>)
        .filter((t) => ["A", "B", "C"].includes(String(t["term"])))
        .map((t) => t["df"]);
      expect(df).toEqual([2, 3, 3]); // n-1 per group: A lost its blank, B and C intact
    } finally {
      await s.stop();
    }
  }, 40_000);
});
