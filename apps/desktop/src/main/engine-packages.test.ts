// @vitest-environment node
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

/**
 * scripts/engine_packages.py names the Python distributions the frozen engine ships — what the
 * third-party notices list. Its two pure functions are
 * driven here with made-up bundles; the standard library is all they need.
 */
const REPO = join(dirname(fileURLToPath(import.meta.url)), "../../../..");
const SCRIPTS = join(REPO, "scripts");
const py = process.platform === "win32" ? "py" : "python3";
const pyArgs = process.platform === "win32" ? ["-3"] : [];

/** Run `expr` with engine_packages imported as `ep`; its value comes back as JSON. */
function run(expr: string): unknown {
  const code = `import json, sys\nsys.path.insert(0, ${JSON.stringify(SCRIPTS)})\nimport engine_packages as ep\nprint(json.dumps(${expr}))`;
  return JSON.parse(execFileSync(py, [...pyArgs, "-c", code], { encoding: "utf8" }));
}

// A dist-info the bundle "kept", for the branch that lists a distribution with no module of its
// own name. Written under node_modules/.cache (git-ignored, inside the repository).
const KEPT = join(REPO, "node_modules/.cache/engine-packages-test/tqdm-4.67.3.dist-info");
mkdirSync(KEPT, { recursive: true });
writeFileSync(join(KEPT, "METADATA"), "Metadata-Version: 2.1\nName: tqdm\nVersion: 4.67.3\n");
afterAll(() => rmSync(dirname(KEPT), { recursive: true, force: true }));

describe("engine_packages: what the frozen engine ships", () => {
  it("finds modules that live only inside the executable's archive, not just folders in _internal", () => {
    const names = run(
      `ep.top_level_names(` +
        `["numpy", "numpy.libs", "numpy-2.4.2.dist-info", "_ctypes.pyd", "python314.dll", "base_library.zip", "six.py", "_brotli.cp314-win_amd64.pyd"], ` +
        `{"numpy", "numpy.libs", "numpy-2.4.2.dist-info"}, ` +
        `["packaging", "packaging.version", "json.decoder", "typing_extensions"], ` +
        `{"json", "_ctypes"})`,
    );
    // packaging and typing_extensions are archive-only: a listing of _internal would miss them.
    // The standard library, DLLs, the .libs folder and the dist-info are not modules to name.
    expect(names).toEqual(["_brotli", "numpy", "packaging", "six", "typing_extensions"]);
  });

  it("maps each name to its distribution once, keeps metadata-only ones, and reports names no distribution claims", () => {
    const [found, unclaimed] = run(
      `ep.distributions(["numpy", "win32", "win32con", "mystery"], {"numpy": ["numpy"]}, {"tqdm": ${JSON.stringify(KEPT)}})`,
    ) as [{ name: string; module: string | null }[], string[]];
    expect(found.map((d) => [d.name, d.module])).toEqual([
      ["numpy", "numpy"],
      ["pywin32", "win32"], // a folder PyInstaller copies under another name; win32con is the same distribution
      ["tqdm", null], // its dist-info ships; its module goes by another name
    ]);
    expect(unclaimed).toEqual(["mystery"]);
  });
});
