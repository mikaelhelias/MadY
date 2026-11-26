/**
 * The decorative backdrop defaults to "none", always, by design.
 *
 * "Current behaviour" and "guaranteed behaviour" are different things — this file makes it
 * the latter, so no future preset, gallery card, sample document, or new-graph path can
 * quietly switch decoration on for everyone.
 *
 * Two complementary checks, because either alone has a blind spot:
 *   • Runtime — the documents the app actually creates carry no backdrop.
 *   • Static  — no graph-creating source file even mentions `backdrop`, which also covers
 *     the renderer-side gallery / new-graph paths that this package cannot import.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { MadyDocument } from "./document";
import { STYLE_PRESETS } from "./presets";
import { createSampleDocument } from "./sample";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "../../..");

describe("decorative backdrop — default is None, everywhere", () => {
  it("the sample document that loads on launch has no backdrop on any graph", () => {
    const project = createSampleDocument().toJSON();
    expect(project.plots.length).toBeGreaterThan(0); // guard: an empty doc would pass vacuously
    for (const plot of project.plots) {
      expect(plot.backdrop).toBeUndefined();
    }
  });

  it("a newly created graph has no backdrop", () => {
    const doc = new MadyDocument();
    const table = doc.importTable("T", "xy", ["x", "y"], [[1, 2]]);
    const plot = doc.addPlot("G", table.id);
    expect(plot.backdrop).toBeUndefined();
  });

  it("no built-in style preset turns decoration on", () => {
    expect(STYLE_PRESETS.length).toBeGreaterThan(0);
    for (const preset of STYLE_PRESETS) {
      expect(JSON.stringify(preset)).not.toContain("backdrop");
    }
  });

  /**
   * Static sweep of every path that creates a graph. Catches the renderer-side sources
   * (gallery cards, the new-graph dialog) that this DOM-free package cannot import.
   * A mention is not proof of a default, but zero mentions is proof there isn't one.
   */
  it("no graph-creating source file sets a backdrop", () => {
    const files = [
      "packages/core/src/sample.ts",
      "packages/core/src/presets.ts",
      "apps/desktop/src/renderer/src/shell/gallery.ts",
      "apps/desktop/src/renderer/src/shell/newGraph.ts",
      "apps/desktop/src/renderer/src/shell/NewGraphDialog.tsx",
    ];
    const offenders: string[] = [];
    for (const rel of files) {
      const src = readFileSync(join(REPO, rel), "utf8");
      if (/\bbackdrop\b/.test(src)) offenders.push(rel);
    }
    expect(offenders).toEqual([]);
  });
});
