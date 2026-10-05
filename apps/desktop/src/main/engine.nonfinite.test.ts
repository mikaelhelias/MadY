// @vitest-environment node
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { SidecarSupervisor } from "./sidecar";

/**
 * Guards against a non-finite statistic killing the stats engine.
 *
 * JSON has no `Infinity` / `NaN`. Python's `json.dumps` emits those as bare literals,
 * `JSON.parse` rejects them, and `sidecar.ts` answers a frame it cannot parse by
 * SIGTERMing the child. So an ordinary analysis — a 2x2 with a zero cell, a t test on
 * a constant group — would come back to the user as "stats engine crashed" and the result
 * would be lost; the log shows a malformed-JSON protocol error followed by the engine
 * exiting on SIGTERM.
 *
 * Handled at both layers: `_r` maps non-finite to `None` at the source (the tidy
 * contract's "not available"), and `write_frame` sanitises + sets `allow_nan=False`,
 * so a method that bypasses `_r` still cannot send a non-finite number.
 *
 * Note: these must run against the real engine — the failure is in the wire format, so any
 * test that stubs the sidecar or inspects a Python dict in-process cannot see it.
 */
const enginePath = fileURLToPath(new URL("../../../../engines/py/engine.py", import.meta.url));
const py = process.platform === "win32" ? "py" : "python3";
function hasScipy(): boolean {
  try { execSync(`${py} -c "import scipy, numpy"`, { stdio: "ignore" }); return true; } catch { return false; }
}
const SCIPY = hasScipy();

/** Every leaf of a result, so "no Infinity/NaN anywhere" can be asserted wholesale. */
function leaves(o: unknown, path = ""): Array<[string, unknown]> {
  if (o !== null && typeof o === "object") {
    return Object.entries(o as Record<string, unknown>).flatMap(([k, v]) => leaves(v, `${path}.${k}`));
  }
  return [[path, o]];
}

describe.skipIf(!SCIPY)("a degenerate input never kills the engine", () => {
  /** Run one request, then prove the engine is still answering. */
  async function runAndSurvive(method: string, data: Record<string, unknown>): Promise<Record<string, unknown>> {
    const s = new SidecarSupervisor({ command: py, args: [enginePath], startTimeoutMs: 30_000 });
    try {
      const result = await s.request(method, data);
      // The engine must still answer. A killed child is respawned lazily, so this second
      // request alone would pass even after a crash; the crash itself surfaces as the first
      // request rejecting with `engine_crash`, which fails the test.
      const after = await s.request("describe", { values: [1, 2, 3] });
      expect(after["method"]).toBe("describe");
      return result;
    } finally {
      await s.stop();
    }
  }

  const CASES: Array<{ name: string; method: string; data: Record<string, unknown>; nulled: string[] }> = [
    // scipy's conditional-MLE odds ratio is +inf when a cell is 0 — everyday clinical data.
    { name: "2x2 contingency with a zero cell", method: "contingency", data: { table: [[10, 0], [3, 12]] }, nulled: [".glance.odds_ratio"] },
    // Zero within-group variance → t is ±inf and Welch's df is NaN.
    { name: "zero-variance Welch t test", method: "ttest", data: { a: [5, 5, 5, 5], b: [7, 7, 7, 7], variant: "welch" }, nulled: [".glance.t"] },
    { name: "zero-variance unpaired t test", method: "ttest", data: { a: [5, 5, 5, 5], b: [7, 7, 7, 7], variant: "unpaired" }, nulled: [".glance.t"] },
    // A constant column makes Pearson r undefined (0/0).
    { name: "correlation with a constant column", method: "correlation", data: { a: [1, 1, 1, 1], b: [2, 3, 4, 5], variant: "pearson" }, nulled: [".glance.r"] },
  ];

  for (const c of CASES) {
    it(`${c.name}: resolves, reports null, and leaves the engine alive`, async () => {
      const r = await runAndSurvive(c.method, c.data);
      // No non-finite anywhere in the payload — the check that generalises past the
      // specific fields this case happens to blow up.
      const bad = leaves(r).filter(([, v]) => typeof v === "number" && !Number.isFinite(v));
      expect(bad, `non-finite values reached the wire: ${JSON.stringify(bad)}`).toEqual([]);
      // …and the undefined statistic is reported as null, not silently as 0.
      for (const p of c.nulled) {
        const got = leaves(r).find(([k]) => k === p);
        expect(got, `expected ${p} in the result`).toBeDefined();
        expect(got![1], `${p} should be null (undefined), not a number`).toBeNull();
      }
    }, 60_000);
  }

  it("a usable estimate survives alongside the undefined one (nothing is thrown away)", async () => {
    const r = await runAndSurvive("contingency", { table: [[10, 0], [3, 12]] });
    // Fisher's conditional OR is infinite here and reports null, but the clinical block's
    // continuity-corrected "Odds ratio" term is finite — the user still gets a number.
    const terms = r["terms"] as Array<Record<string, unknown>>;
    const or = terms.find((t) => t["term"] === "Odds ratio");
    expect(or, "the Haldane-corrected odds-ratio term should still be present").toBeDefined();
    expect(typeof or!["estimate"]).toBe("number");
    expect(Number.isFinite(or!["estimate"] as number)).toBe(true);
  }, 60_000);
});
