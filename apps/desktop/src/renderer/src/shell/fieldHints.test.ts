// @vitest-environment node
/**
 * The Inspector's hover hints.
 *
 * The failure this guards is not "a hint is missing" — the table is deliberately partial.
 * It is a hint keyed to a field that no longer exists, which is invisible: nothing breaks,
 * the tooltip simply never appears again, and the table gradually fills with inaccurate
 * entries about controls that were renamed or removed.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { FIELD_HINTS } from "./fieldHints";

const INSPECTOR = readFileSync(fileURLToPath(new URL("./Inspector.tsx", import.meta.url)), "utf8");
/** Every `key: "…"` used in a schema field descriptor. */
const schemaKeys = (): Set<string> =>
  new Set([...INSPECTOR.matchAll(/\bkey: "([A-Za-z0-9_]+)", label:/g)].map((m) => m[1]!));

describe("FIELD_HINTS", () => {
  it("reads real field keys out of Inspector.tsx (a walker matching nothing proves nothing)", () => {
    const keys = schemaKeys();
    // about a hundred distinct keys across about 150 descriptor occurrences — the same control (twoToneTint,
    // fillType…) is declared once per chart kind, which is exactly why hints key off `key`.
    expect(keys.size).toBeGreaterThan(60);
    expect(keys.has("connect"), "the walker missed a key it should obviously find").toBe(true);
  });

  it("has no hint for a field that no longer exists", () => {
    const keys = schemaKeys();
    const orphans = Object.keys(FIELD_HINTS).filter((k) => !keys.has(k));
    expect(
      orphans,
      `these hints point at fields that are gone from the Inspector — rename or delete them: ${orphans.join(", ")}`,
    ).toEqual([]);
  });

  it("keeps them short enough to read in a tooltip", () => {
    // A tooltip is a glance, not a paragraph. Anything longer belongs in the manual.
    for (const [k, v] of Object.entries(FIELD_HINTS)) {
      expect(v.length, `the hint for "${k}" is too long for a tooltip (${v.length} chars)`).toBeLessThanOrEqual(160);
      expect(v.trim(), `the hint for "${k}" is blank`).not.toBe("");
      expect(v, `the hint for "${k}" ends with a full stop — these are labels, not sentences`).not.toMatch(/\.$/);
    }
  });

  it("never just restates the label", () => {
    // The whole editorial rule. A hint that repeats its label costs a hover and teaches
    // nothing, and trains people to stop hovering at all.
    const labels = new Map<string, string>();
    for (const m of INSPECTOR.matchAll(/\bkey: "([A-Za-z0-9_]+)", label: "([^"]+)"/g)) labels.set(m[1]!, m[2]!);
    for (const [k, v] of Object.entries(FIELD_HINTS)) {
      const label = labels.get(k);
      if (!label) continue;
      expect(v.toLowerCase(), `the hint for "${k}" is just its label again`).not.toBe(label.toLowerCase());
    }
  });
});
