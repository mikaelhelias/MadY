// @vitest-environment node
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

const py = process.platform === "win32" ? "py" : "python3";
// `py -3` rather than `py`: given a script and no version, the Windows launcher follows the
// script's `#!` line and can pick another Python found on PATH, one without the packages.
const pyArgs = process.platform === "win32" ? ["-3"] : [];
let available = false;
try { execFileSync(py, [...pyArgs, "-c", "import numpy, scipy, statsmodels"], { stdio: "ignore" }); available = true; } catch { /* optional local numeric stack */ }
it.skipIf(!available)("numerical edge cases and the ROC work bound", () => {
  const cwd = fileURLToPath(new URL("../../../../engines/py/", import.meta.url));
  expect(() => execFileSync(py, [...pyArgs, "-m", "unittest", "test_numeric_edges", "-v"], { cwd, encoding: "utf8", stdio: "pipe" })).not.toThrow();
}, 60_000);
