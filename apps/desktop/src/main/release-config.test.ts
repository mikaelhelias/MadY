import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * What every build carries: the statistics engine and the manual on every system, and MadY's licence
 * and the third-party notices where each system expects them.
 *
 * MadY is GPL-3.0-or-later, whose text must go with every copy, and the permissive licences of what
 * it bundles require their notices to go with it too. On Windows they sit beside MadY.exe (`win:`
 * `extraFiles`); on macOS in MadY.app/Contents/Resources (`mac:` `extraResources`), because a signed
 * app may hold nothing but code directly in Contents/ and codesign refuses a plain file there.
 * electron-builder adds a platform's list to the shared one, so the engine and the manual (the shared
 * `extraResources`) go with both. The config is read as text — the blocks are a few plain lines, and
 * no YAML reader is a declared dependency.
 */
const DESKTOP = join(dirname(fileURLToPath(import.meta.url)), "../..");
const REPO = join(DESKTOP, "../..");

/** The lines under a top-level key of electron-builder.yml, up to the next top-level key. */
export function builderBlock(yml: string, key: string): string[] {
  const lines = yml.split(/\r?\n/);
  const start = lines.findIndex((l) => l.trim() === `${key}:` && !l.startsWith(" "));
  if (start < 0) return [];
  const end = lines.findIndex((l, i) => i > start && /^\S/.test(l) && !l.startsWith("#"));
  return lines.slice(start + 1, end < 0 ? lines.length : end);
}

/** The `from → to` pairs under `key`: a top-level key, or one inside a platform section (`win`, `mac`). */
export function builderEntries(yml: string, key: string, section?: string): { from: string; to: string }[] {
  const lines = section ? builderBlock(yml, section) : yml.split(/\r?\n/);
  const indent = section ? "  " : "";
  const start = lines.findIndex((l) => l === `${indent}${key}:` || l.trimEnd() === `${indent}${key}:`);
  if (start < 0) return [];
  const out: { from: string; to: string }[] = [];
  for (let i = start + 1; i < lines.length; i++) {
    const l = lines[i]!;
    if (l.trim() !== "" && !l.trimStart().startsWith("#") && l.length - l.trimStart().length <= indent.length) break;
    const from = /^\s*-\s*from:\s*(.+?)\s*$/.exec(l);
    const to = /^\s*to:\s*(.+?)\s*$/.exec(lines[i + 1] ?? "");
    if (from && to) out.push({ from: from[1]!, to: to[1]! });
  }
  return out;
}

const LICENCES = [
  { from: "../../LICENSE", to: "LICENSE.txt" },
  { from: "../../THIRD-PARTY-NOTICES.md", to: "THIRD-PARTY-NOTICES.md" },
];

describe("every build carries the engine, the manual and the licences", () => {
  const yml = readFileSync(join(DESKTOP, "electron-builder.yml"), "utf8");
  const mac = builderBlock(yml, "mac");

  it("has a mac section", () => {
    expect(mac.length).toBeGreaterThan(0);
  });

  it("the engine and the manual are in the shared list, so every system ships them", () => {
    const shared = builderEntries(yml, "extraResources");
    expect(shared).toContainEqual({ from: "../../engines/py/dist/mady-engine", to: "engine" });
    expect(shared).toContainEqual({ from: "../../docs/manual/MadY-Manual.html", to: "manual/MadY-Manual.html" });
  });

  it("Windows: the licence and the notices beside MadY.exe", () => {
    const win = builderEntries(yml, "extraFiles", "win");
    for (const l of LICENCES) expect(win).toContainEqual(l);
  });

  it("macOS: the licence and the notices in Contents/Resources, and nothing loose in Contents/", () => {
    const res = builderEntries(yml, "extraResources", "mac");
    for (const l of LICENCES) expect(res).toContainEqual(l);
    // Electron's and Chromium's own licences: electron-builder deletes them from a Mac build (on
    // Windows it puts them beside MadY.exe), so the Mac app carries them from Electron's download.
    expect(res).toContainEqual({ from: "../../node_modules/electron/dist/LICENSE", to: "LICENSE.electron.txt" });
    expect(res).toContainEqual({ from: "../../node_modules/electron/dist/LICENSES.chromium.html", to: "LICENSES.chromium.html" });
    // extraFiles land directly in MadY.app/Contents/ on a Mac, where codesign refuses them.
    expect(builderEntries(yml, "extraFiles"), "a shared extraFiles list also lands in a Mac app's Contents/").toEqual([]);
    expect(builderEntries(yml, "extraFiles", "mac"), "the Mac section has extraFiles").toEqual([]);
  });

  it("an ad-hoc signature goes with hardened runtime off, without which the app does not start", () => {
    if (mac.some((l) => /^ {2}identity:\s*"-"\s*$/.test(l))) {
      expect(mac).toContainEqual(expect.stringMatching(/^ {2}hardenedRuntime:\s*false\s*$/));
    }
  });

  it("builds for Apple Silicon only", () => {
    const arches = mac.flatMap((l) => /^\s*-\s*(arm64|x64|universal)\s*$/.exec(l)?.[1] ?? []);
    expect(arches.length).toBeGreaterThan(0);
    expect(new Set(arches)).toEqual(new Set(["arm64"]));
  });

  it("both licence files exist, and the licence is the GPL, version 3", () => {
    for (const { from } of LICENCES) expect(existsSync(join(DESKTOP, from)), `${from} is missing`).toBe(true);
    expect(readFileSync(join(REPO, "LICENSE"), "utf8")).toMatch(/GNU GENERAL PUBLIC LICENSE\s+Version 3/);
  });
});

describe("the config readers", () => {
  it("the block reader stops at the next top-level key and skips comments between", () => {
    const sample = "mac:\n  a: 1\n# note\n  b: 2\nwin:\n  c: 3\n";
    expect(builderBlock(sample, "mac")).toEqual(["  a: 1", "# note", "  b: 2"]);
    expect(builderBlock(sample, "linux")).toEqual([]);
  });

  it("the entry reader finds a top-level list and a platform section's list, and nothing under a missing key", () => {
    const sample = "a: 1\nextraFiles:\n  - from: x\n    to: y\n  - from: p\n    to: q\nnext:\n  - from: no\n    to: no\n"
      + "mac:\n  icon: i\n  extraResources:\n    - from: m\n      to: n\n  target: dmg\nwin:\n  extraFiles:\n    - from: w\n      to: v\n";
    expect(builderEntries(sample, "extraFiles")).toEqual([{ from: "x", to: "y" }, { from: "p", to: "q" }]);
    expect(builderEntries(sample, "extraResources", "mac")).toEqual([{ from: "m", to: "n" }]);
    expect(builderEntries(sample, "extraFiles", "win")).toEqual([{ from: "w", to: "v" }]);
    expect(builderEntries(sample, "extraFiles", "mac")).toEqual([]);
    expect(builderEntries(sample, "missing")).toEqual([]);
  });
});
