// @vitest-environment node
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Default-deny: the preload may import only the electron modules a sandbox provides.
 *
 * The window is created with `sandbox: true` (main/index.ts), and a sandboxed preload
 * receives only a subset of the electron module. Everything else — `clipboard`,
 * `nativeImage`, `shell`, `dialog`, `app`, `BrowserWindow` — is `undefined` there.
 *
 * Nothing catches this failure before a user does:
 *   • it type-checks (the type comes from `@types/electron`, not from what's loaded);
 *   • `typeof window.mady.copyTextToClipboard` still reports `"function"`;
 *   • every renderer test stubs `window.mady`, so the real binding is never called;
 *   • the `:8849`/`:8850` preview has no preload at all.
 * A `clipboard.writeText` in the preload throws "Cannot read properties of undefined",
 * which silently breaks Copy SVG, Copy image and paste-import in the packaged app, so
 * clipboard work happens in the main process over IPC.
 *
 * If you need another main-process capability, add an IPC handler; do not add the
 * module here. The allow-list is deliberately the documented sandbox subset.
 */
const SANDBOX_SAFE = new Set(["contextBridge", "ipcRenderer", "webFrame", "crashReporter", "webUtils"]);

const SRC = fileURLToPath(new URL("./index.ts", import.meta.url));

/** Every named binding imported from "electron", across all import statements. */
function electronImports(source: string): string[] {
  const names: string[] = [];
  const re = /import\s*\{([^}]*)\}\s*from\s*["']electron["']/g;
  for (let m = re.exec(source); m; m = re.exec(source)) {
    for (const raw of m[1]!.split(",")) {
      const name = raw.trim().split(/\s+as\s+/)[0]!.trim();
      if (name) names.push(name);
    }
  }
  return names;
}

describe("preload imports only sandbox-safe electron modules", () => {
  const source = readFileSync(SRC, "utf8");

  it("finds the electron import (the walker must not silently match nothing)", () => {
    // A regex that quietly stops matching would make this whole file vacuously green.
    expect(electronImports(source).length).toBeGreaterThan(0);
    expect(electronImports(source)).toContain("ipcRenderer");
  });

  it("imports nothing that is undefined under `sandbox: true`", () => {
    const banned = electronImports(source).filter((n) => !SANDBOX_SAFE.has(n));
    expect(
      banned,
      `preload/index.ts imports ${banned.join(", ")} from "electron", which a sandboxed ` +
        `preload does not provide — it will be undefined at runtime and throw on first use. ` +
        `Move the work to the main process behind an ipcMain handler instead.`,
    ).toEqual([]);
  });

  it("detects a banned import if one is added", () => {
    // Proves the check can fail; otherwise a passing run means nothing.
    expect(electronImports(`import { contextBridge, clipboard } from "electron";`).filter((n) => !SANDBOX_SAFE.has(n)))
      .toEqual(["clipboard"]);
  });

  it("the clipboard is reached over IPC, not by touching the module directly", () => {
    expect(source).toContain('ipcRenderer.send("clipboard:writeText"');
    expect(source).toContain('ipcRenderer.sendSync("clipboard:readText")');
    expect(source).not.toMatch(/\bclipboard\.(writeText|readText|writeImage)\s*\(/);
  });
});
