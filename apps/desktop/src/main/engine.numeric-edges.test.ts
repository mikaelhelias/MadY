// @vitest-environment node
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

const py = process.platform === "win32" ? "py" : "python3";
let available = false;
try { execFileSync(py, ["-c", "import numpy, scipy, statsmodels"], { stdio: "ignore" }); available = true; } catch { /* optional local numeric stack */ }
it.skipIf(!available)("numerical edge cases and the ROC work bound", () => {
  const cwd = fileURLToPath(new URL("../../../../engines/py/", import.meta.url));
  expect(() => execFileSync(py, ["-m", "unittest", "test_numeric_edges", "-v"], { cwd, encoding: "utf8", stdio: "pipe" })).not.toThrow();
}, 60_000);
