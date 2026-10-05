// @vitest-environment node
/**
 * The datasheet hides the browser's text selection without disabling it.
 *
 * Dragging over cells runs two selection models at once: the grid's own range
 * (`.dgcell.insel`, correct) and the browser's native text selection sweeping across every
 * value the pointer passes, whole other columns included. Only the second must go.
 *
 * The obvious approach breaks copy. `user-select: none` removes the document selection, and
 * Chromium raises the `copy` event off that selection — so Ctrl+C would produce nothing and the
 * paste that followed would have nothing to paste. This file guards against that: the blue
 * must go, and it must go by paint, not by disabling selection.
 *
 * A static scan of the stylesheet, because that is where the rule lives and jsdom computes no
 * cascade.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const CSS = readFileSync(fileURLToPath(new URL("../shell.css", import.meta.url)), "utf8");

/** The declaration block of the first rule whose selector contains `needle`. */
function ruleFor(needle: string): string {
  for (const block of CSS.split("}")) {
    const brace = block.indexOf("{");
    if (brace < 0) continue;
    if (block.slice(0, brace).includes(needle)) return block.slice(brace + 1);
  }
  throw new Error(`no CSS rule whose selector contains "${needle}" — the scan is looking at the wrong file`);
}

describe("the datasheet's selection", () => {
  it("scans the real stylesheet (a scan that matches nothing proves nothing)", () => {
    expect(CSS.length).toBeGreaterThan(10000);
    expect(CSS, "the grid's own selection highlight is gone").toContain(".dgcell.insel");
  });

  it("hides the browser's blue selection over the grid", () => {
    expect(
      ruleFor(".dgwrap ::selection"),
      "the browser's text selection is visible over the sheet again",
    ).toMatch(/background:\s*transparent/);
  });

  it("never disables selection over the grid — copy needs it", () => {
    // The main case this file checks. `handleCopy` writes the clipboard itself,
    // but it can only do that if the browser raises the copy event, and Chromium raises it
    // off the document selection.
    expect(
      ruleFor(".dgwrap"),
      "user-select:none is back on the datasheet — Ctrl+C will silently copy nothing",
    ).not.toMatch(/user-select:\s*none/);
  });

  it("still shows the selection inside the grid's text editors", () => {
    // Renaming a column / fixing a cell is ordinary text editing: you have to see what you
    // have selected. A blanket transparent ::selection would have taken that away too.
    expect(CSS, "the editors lost their visible selection").toMatch(
      /\.dgwrap input::selection,\s*\.dgwrap textarea::selection/,
    );
    expect(ruleFor(".dgwrap input::selection")).toMatch(/background:\s*color-mix/);
  });
});
