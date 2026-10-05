// @vitest-environment node
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Independent cross-check gate. `engines/py/crosscheck.py` recomputes each engine
 * calculation through a code path that shares NO implementation with the engine's
 * scipy/statsmodels stack — Python stdlib `statistics`, `mpmath` at 50-digit
 * precision, and closed-form re-derivations — and exits non-zero if any disagree.
 * This wires that check into `npx vitest run` alongside the reference-value tests.
 */
const crosscheckPath = fileURLToPath(new URL("../../../../engines/py/crosscheck.py", import.meta.url));
const engineDir = fileURLToPath(new URL("../../../../engines/py/", import.meta.url));
const py = process.platform === "win32" ? "py" : "python3";

/** Needs the engine's numeric stack + the independent oracles (mpmath, sklearn). */
function hasDeps(): boolean {
  try {
    execFileSync(py, ["-c", "import scipy, numpy, mpmath, sklearn, statsmodels"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}
const DEPS = hasDeps();

describe.skipIf(!DEPS)("engine — independent cross-check (stdlib statistics / mpmath / closed-form)", () => {
  it("every checked calculation matches an implementation sharing no code with the engine", () => {
    let out = "";
    let threw = false;
    try {
      out = execFileSync(py, [crosscheckPath], {
        cwd: engineDir,
        env: { ...process.env, PYTHONPATH: engineDir, PYTHONIOENCODING: "utf-8" },
        encoding: "utf-8",
      });
    } catch (e) {
      threw = true;
      const err = e as { stdout?: string; stderr?: string };
      out = (err.stdout ?? "") + (err.stderr ?? "");
    }
    // The harness exits non-zero (→ throws) on any mismatch; surface its table.
    if (threw || /[1-9]\d* failed/.test(out)) throw new Error("independent cross-check FAILED:\n" + out);
    expect(out).toMatch(/\bpassed, 0 failed\b/);
    // The battery spawns a real Python process and runs over 1,300 oracle checks, which
    // can take well over a minute while the rest of the suite competes for CPU. Running out
    // of time is a TIMEOUT, never a mismatch, hence the 240 s budget; a genuine
    // disagreement still fails immediately above.
  }, 240_000);
});
