import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DEFAULT_TOOLBAR_GROUPS } from "./toolbar";

const DEFAULT_IDS = DEFAULT_TOOLBAR_GROUPS.flatMap((g) => g.ids);

/**
 * No toolbar button may ship permanently disabled.
 *
 * A button with a hard-coded `disabled: true` makes a feature look unfinished even when it
 * exists and is reachable elsewhere (e.g. the palette and the Significance panel with
 * bracket/CLD generation, both in the Inspector), and a button that fronts nothing is a dead end.
 *
 * A toolbar button must have an action it can run. The toolbar has no way to focus an Inspector
 * section, so it offers no button for the Inspector's interpretation, palette or significance
 * controls; those are reached in the Inspector.
 *
 * A conditional `disabled` is fine and expected — `magic` is disabled with no graph open,
 * `export` with nothing exportable. What this forbids is the literal, which can never
 * become true no matter what the user does.
 */
const HERE = dirname(fileURLToPath(import.meta.url));

describe("the toolbar never offers a button that cannot be pressed", () => {
  it("no item definition hard-codes `disabled: true`", () => {
    const src = readFileSync(join(HERE, "chrome.tsx"), "utf8");
    // Definitions look like `id: { icon: …, title: …, disabled: <expr> }`.
    const offenders = [...src.matchAll(/^\s{4}(\w+): \{[^\n]*disabled: true[^\n]*$/gm)].map((m) => m[1]!);
    expect(
      offenders,
      "These toolbar buttons can never be pressed. Wire them to the feature they name, or " +
        "remove them — a permanently disabled control reads as a broken app:\n  - " +
        offenders.join("\n  - "),
    ).toEqual([]);
  });

  it("the check is reading the real definitions (it cannot pass by matching nothing)", () => {
    // A regex that silently stops matching would make this green forever.
    const src = readFileSync(join(HERE, "chrome.tsx"), "utf8");
    const defs = [...src.matchAll(/^\s{4}(\w+): \{[^\n]*icon: </gm)].map((m) => m[1]!);
    expect(defs.length, "toolbar item definitions must be parseable from chrome.tsx").toBeGreaterThan(4);
    expect(defs).toContain("magic");
    // …and `magic` is the proof that a conditional disabled is still allowed.
    expect(/magic: \{[^\n]*disabled: !props\./.test(src)).toBe(true);
  });

  it("every default-toolbar id has a definition, and none of them needs to focus an Inspector section", () => {
    const src = readFileSync(join(HERE, "chrome.tsx"), "utf8");
    for (const id of DEFAULT_IDS) {
      // Ids with a hyphen are quoted in the object literal (`"new-project": {`). Plain
      // string matching, deliberately — a built-up RegExp needs double escaping and can
      // silently degrade to matching nothing.
      const defined = src.includes(`    ${id}: {`) || src.includes(`    "${id}": {`);
      expect(defined, `no definition for "${id}"`).toBe(true);
    }
    for (const gone of ["interpret", "color", "significance"]) {
      expect(DEFAULT_IDS.includes(gone as never), `"${gone}" is in the default toolbar, but its feature lives in the Inspector`).toBe(false);
    }
  });

  it("`design` is never permanently disabled", () => {
    // The Design button is the one most at risk of a permanent `disabled: true` — a promise
    // the user could never press. It is named here on purpose:
    // if its disabled state is later hardcoded, or drops the
    // condition so it is always live on a chart that cannot take annotations, this fails.
    const src = readFileSync(join(HERE, "chrome.tsx"), "utf8");
    expect(src.includes("    design: {"), "the design button has no definition").toBe(true);
    // Plain string matching, like the sibling checks above: a built-up RegExp here can
    // silently degrade to matching nothing.
    const designDef = src.split(/\r?\n/).find((l) => l.includes("    design: {")) ?? "";
    expect(
      designDef.includes("disabled: !props."),
      "design must be disabled only conditionally (derived from the active graph), never hardcoded",
    ).toBe(true);
    expect(designDef.includes("disabled: true"), "design is permanently disabled — a button that can never be pressed").toBe(false);
    expect(DEFAULT_IDS.includes("design"), "design is not in the default toolbar").toBe(true);
  });

});
