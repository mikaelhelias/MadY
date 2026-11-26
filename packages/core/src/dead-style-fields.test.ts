/**
 * Dead style-option detector — every style field is read by a builder and reachable
 * from a control.
 *
 * It targets the two halves of one defect class:
 *   • Unreachable — a builder honours an option, but no control can set it, so the feature
 *     ships invisible.
 *   • Dead control — a control writes an option that no builder reads, so it looks live and
 *     does nothing. This is the same class of
 *     misleading control as a dead drag affordance, one layer up.
 *
 * Scope: the per-kind `*Style` interfaces, which are pure presentation. `Plot` itself is a
 * mix of data (pca / survival / roc payloads written by analyses) and style, so a single rule
 * cannot cover it without a long list of exemptions that would go stale.
 *
 * Note: this is static evidence, not proof. It greps identifiers, so it shows a name is
 * mentioned, not that it is wired correctly (only the builder tests can show that). Its
 * precision is deliberately asymmetric:
 *   • Zero mentions outside the model  → definitive. Nothing can be using it.
 *   • Some mentions                    → weak. It could still be misread.
 * So it fails only on zero, where there is no room for interpretation and no false positive.
 * Test files are excluded from the evidence: a field exercised only by tests is dead in the
 * app, and counting them would hide exactly that case.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "../../..");

/** Every `export interface *Style` block in the model → its declared field names. */
function styleInterfaces(): { iface: string; keys: string[] }[] {
  const src = readFileSync(join(HERE, "model.ts"), "utf8");
  const out: { iface: string; keys: string[] }[] = [];
  for (const m of src.matchAll(/export interface ([A-Za-z]+Style) \{([\s\S]*?)\n\}/g)) {
    const keys = [...m[2]!.matchAll(/^ {2}([a-zA-Z_][a-zA-Z0-9_]*)\??:/gm)].map((x) => x[1]!);
    out.push({ iface: m[1]!, keys });
  }
  return out;
}

/** Recursively collect source files under `root`, excluding tests + build output. */
function sources(root: string, exts: string[]): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const e of entries) {
      const p = join(dir, e);
      if (e === "node_modules" || e === "dist" || e === "out") continue;
      if (statSync(p).isDirectory()) {
        walk(p);
        continue;
      }
      // A field used only by tests is still dead in the app, so tests never count as evidence.
      if (/\.(test|spec)\.[tj]sx?$/.test(e)) continue;
      if (exts.some((x) => e.endsWith(x))) out.push(p);
    }
  };
  walk(root);
  return out;
}

const read = (files: string[]): string => files.map((f) => readFileSync(f, "utf8")).join("\n");

/** Builders: what turns a style option into pixels. */
const BUILDER_SRC = read(sources(join(REPO, "packages/graphics/src"), [".ts"]));
/** UI: what a user can actually reach (Inspector panels, dialogs, the shell). */
const UI_SRC = read(sources(join(REPO, "apps/desktop/src/renderer/src"), [".ts", ".tsx"]));

const mentions = (hay: string, key: string): number => (hay.match(new RegExp(`\\b${key}\\b`, "g")) ?? []).length;

/**
 * Fields exempt from one side of the rule, each with the reason. Keep these specific and
 * few — a growing exemption list means the rule is wrong, or the code is.
 */
const EXEMPT: Record<string, string> = {
  // Written by the analysis→graph plumbing, not by an Inspector control.
  "PcaStyle.labelPos": "written by dragging a loading label on the canvas (moveSynthLabel), not by a control",
  "PcaStyle.varLabelText": "written by double-click-renaming a loading label (updateSynthElement), not by a control",
  "PcaStyle.arrowColors": "written by the per-vector editor via annotationOps.update → updateSynthElement (no direct control binding)",
  "PyramidStyle.valueLabelPos": "written by dragging a pyramid value label (moveSynthLabel), not by a control",
  "PyramidStyle.valueLabelText": "written by double-click-renaming a pyramid value label (updateSynthElement), not by a control",
};

describe("dead style-option detector — every *Style field must be built and reachable", () => {
  const IFACES = styleInterfaces();

  it("finds the style interfaces (guards the parser itself)", () => {
    // If the regex silently stops matching, every check below passes vacuously.
    expect(IFACES.length, "no *Style interfaces parsed from model.ts — the pattern no longer matches the file").toBeGreaterThan(15);
    expect(IFACES.every((i) => i.keys.length > 0), "a style interface parsed with zero fields").toBe(true);
    expect(BUILDER_SRC.length, "no builder sources read").toBeGreaterThan(10_000);
    expect(UI_SRC.length, "no UI sources read").toBeGreaterThan(10_000);
  });

  it("no style option is unbuilt (declared, but no builder ever reads it)", () => {
    const dead: string[] = [];
    for (const { iface, keys } of IFACES) {
      for (const key of keys) {
        if (EXEMPT[`${iface}.${key}`]) continue;
        if (mentions(BUILDER_SRC, key) === 0) dead.push(`${iface}.${key}`);
      }
    }
    expect(
      dead,
      "These style options are declared on the model but NO builder mentions them — nothing can draw them, " +
        "so setting one does nothing. Either wire the builder or delete the field:\n  - " +
        dead.join("\n  - ") +
        "\n",
    ).toEqual([]);
  });

  it("no style option is unreachable (built, but no control can set it)", () => {
    const unreachable: string[] = [];
    for (const { iface, keys } of IFACES) {
      for (const key of keys) {
        if (EXEMPT[`${iface}.${key}`]) continue;
        if (mentions(UI_SRC, key) === 0) unreachable.push(`${iface}.${key}`);
      }
    }
    expect(
      unreachable,
      "These style options are built but nothing in the UI mentions them — the feature exists and no user " +
        "can reach it. Add a control, or record why it is unreachable in EXEMPT:\n  - " +
        unreachable.join("\n  - ") +
        "\n",
    ).toEqual([]);
  });

  it("carries no stale exemptions", () => {
    const declared = new Set(IFACES.flatMap(({ iface, keys }) => keys.map((k) => `${iface}.${k}`)));
    const stale = Object.keys(EXEMPT).filter((k) => !declared.has(k));
    expect(stale, `EXEMPT names fields that no longer exist — delete them:\n  - ${stale.join("\n  - ")}\n`).toEqual([]);
  });
});
