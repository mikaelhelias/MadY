import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The installer carries MadY's licence and the third-party notices.
 *
 * MadY is GPL-3.0-or-later, whose text must go with every copy, and the permissive licences of what
 * it bundles require their notices to go with it too. Both are listed under `extraFiles` in
 * electron-builder.yml, which places them beside MadY.exe. The config is read as text — the block is
 * a few plain lines, and no YAML reader is a declared dependency.
 */
const DESKTOP = join(dirname(fileURLToPath(import.meta.url)), "../..");
const REPO = join(DESKTOP, "../..");

/** The `from → to` pairs under a top-level key of electron-builder.yml. */
export function builderEntries(yml: string, key: string): { from: string; to: string }[] {
  const lines = yml.split(/\r?\n/);
  const start = lines.findIndex((l) => l.trim() === `${key}:` && !l.startsWith(" "));
  if (start < 0) return [];
  const out: { from: string; to: string }[] = [];
  for (let i = start + 1; i < lines.length; i++) {
    const l = lines[i]!;
    if (/^\S/.test(l)) break; // the next top-level key
    const from = /^\s*-\s*from:\s*(.+?)\s*$/.exec(l);
    const to = /^\s*to:\s*(.+?)\s*$/.exec(lines[i + 1] ?? "");
    if (from && to) out.push({ from: from[1]!, to: to[1]! });
  }
  return out;
}

/** The lines under a top-level key of electron-builder.yml, up to the next top-level key. */
export function builderBlock(yml: string, key: string): string[] {
  const lines = yml.split(/\r?\n/);
  const start = lines.findIndex((l) => l.trim() === `${key}:` && !l.startsWith(" "));
  if (start < 0) return [];
  const end = lines.findIndex((l, i) => i > start && /^\S/.test(l) && !l.startsWith("#"));
  return lines.slice(start + 1, end < 0 ? lines.length : end);
}

describe("the Mac build keeps what the Windows build ships", () => {
  const yml = readFileSync(join(DESKTOP, "electron-builder.yml"), "utf8");
  const mac = builderBlock(yml, "mac");

  it("has a mac section", () => {
    expect(mac.length).toBeGreaterThan(0);
  });

  it("does not replace the shared file lists — a mac-level list would ship the app without its engine or licences", () => {
    const overrides = mac.filter((l) => /^ {2}(files|extraResources|extraFiles):/.test(l));
    expect(overrides).toEqual([]);
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

  it("the block reader stops at the next top-level key and skips comments between", () => {
    const sample = "mac:\n  a: 1\n# note\n  b: 2\nwin:\n  c: 3\n";
    expect(builderBlock(sample, "mac")).toEqual(["  a: 1", "# note", "  b: 2"]);
    expect(builderBlock(sample, "linux")).toEqual([]);
  });
});

describe("the installer carries the licences", () => {
  const yml = readFileSync(join(DESKTOP, "electron-builder.yml"), "utf8");
  const extra = builderEntries(yml, "extraFiles");

  it("ships MadY's own licence and the third-party notices beside MadY.exe", () => {
    expect(extra).toContainEqual({ from: "../../LICENSE", to: "LICENSE.txt" });
    expect(extra).toContainEqual({ from: "../../THIRD-PARTY-NOTICES.md", to: "THIRD-PARTY-NOTICES.md" });
  });

  it("both source files exist, and the licence is the GPL, version 3", () => {
    for (const { from } of extra) expect(existsSync(join(DESKTOP, from)), `${from} is missing`).toBe(true);
    expect(readFileSync(join(REPO, "LICENSE"), "utf8")).toMatch(/GNU GENERAL PUBLIC LICENSE\s+Version 3/);
  });

  it("the reader finds entries under the key it is asked for, and none under a key that has none", () => {
    const sample = "a: 1\nextraFiles:\n  - from: x\n    to: y\n  - from: p\n    to: q\nnext:\n  - from: no\n    to: no\n";
    expect(builderEntries(sample, "extraFiles")).toEqual([{ from: "x", to: "y" }, { from: "p", to: "q" }]);
    expect(builderEntries(sample, "missing")).toEqual([]);
  });
});
