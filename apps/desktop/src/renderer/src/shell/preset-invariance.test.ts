/**
 * Adding a preset parameter must not change any existing preset or default.
 *
 * A new parameter is captured when a preset is defined, but the current default and presets do
 * not change — it is an additional parameter, captured when a preset is saved.
 *
 * Every new `StylePreset` field is optional, unset on every built-in that does not deliberately
 * use it (Universal design sets several, and its recorded hashes include them), and written by
 * `applyStylePreset` only when the preset defines it. That is easy to state and easy to break: one
 * field written unconditionally (as the marker fields are, deliberately) would clear whatever the
 * user had set, on every preset apply, on every graph.
 *
 * So this pins the outcome rather than the mechanism: applying each built-in preset to each
 * gallery card must produce the same plot and the same scene as recorded.
 * `preset-invariance.fixtures.json` holds a hash per (card × preset × size); each card is drawn
 * at 580×380 and again at a larger size (keys "…|large", see `largeSize`).
 *
 * A failure here is not fixed by re-recording the fixture. If a hash moves, either a new field is
 * being written when it should not be, or an existing preset was edited — both are what this
 * forbids. Re-record only for a deliberate change to a preset's or a card's look, after
 * comparing the drawing with the change off and on (field by field, and as rendered pictures) and
 * confirming that only the intended entries moved; record the reason in the commit message. A
 * hash says "changed", never "right".
 *
 * Note: the recording measures text with a 0.6 × font-size width estimate, which is wider than
 * the real fonts, so an entry can move here while the card in the app does not.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { MadyDocument, STYLE_PRESETS } from "@mady/core";
import type { Plot, Project } from "@mady/core";
import { buildPlotScene } from "@mady/graphics";
import { galleryItems } from "./gallery";
import { scenePaletteOpt } from "./scenePalette";
import { applyPresetWithKindDefaults } from "./seedStyle";
import { graphLayoutSize } from "./graphDisplay";

const HERE = dirname(fileURLToPath(import.meta.url));
const baseline = JSON.parse(readFileSync(join(HERE, "preset-invariance.fixtures.json"), "utf8")) as Record<string, string>;
const measure = (t: string, px: number): number => t.length * px * 0.6;
const SIZE = { width: 580, height: 380 };
/** The larger drawing (each card is also drawn at a larger size): the size the app lays
 *  the card out at (`graphLayoutSize` — its own figure size), or 1.5× the small size when that is its size. A change that
 *  only shows when there is room — or only when there is not — is caught at one size or the other. Keyed "…|large". */
function largeSize(plot: Plot): { width: number; height: number } {
  const own = graphLayoutSize(plot);
  return own.width === SIZE.width && own.height === SIZE.height ? { width: SIZE.width * 1.5, height: SIZE.height * 1.5 } : own;
}

/** Apply the preset exactly as the app does, and hash the plot + the drawing it produces. */
function fingerprint(item: { table: never; plot: Plot }, preset: (typeof STYLE_PRESETS)[number], large = false): string {
  const p = JSON.parse(JSON.stringify(item.plot)) as Plot;
  const project: Project = { schemaVersion: 4, tables: [item.table], plots: [p], analyses: [], log: [], workspace: { folders: [], loose: [] } };
  const doc = new MadyDocument(project);
  applyPresetWithKindDefaults(doc, p.id, item.plot.kind ?? "xy", preset);
  const plot = doc.toJSON().plots[0]!;
  const scene = buildPlotScene(item.table, plot, { measure, ...(large ? largeSize(plot) : SIZE), ...scenePaletteOpt(plot) });
  // Numbers to 0.01 (px): an iterative layout (the Voronoi treemap) ends a few bits apart on different processors,
  // and that must not read as a changed drawing; a preset that changes the drawing moves far more than 0.01 px.
  const rounded = JSON.stringify({ plot, scene }, (_k, v: unknown) => (typeof v === "number" ? Math.round(v * 100) / 100 : v));
  return createHash("sha256").update(rounded).digest("hex").slice(0, 16);
}

/** Every card × preset × size as drawn now — for re-recording, only after the pictures have been checked. */
export function currentFingerprints(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const item of galleryItems() as unknown as { table: never; plot: Plot }[]) {
    for (const preset of STYLE_PRESETS) {
      out[`${item.plot.name}|${preset.name}`] = fingerprint(item, preset);
      out[`${item.plot.name}|${preset.name}|large`] = fingerprint(item, preset, true);
    }
  }
  return out;
}

describe("a new preset parameter changes nothing that already existed", () => {
  const items = galleryItems() as unknown as { table: never; plot: Plot }[];

  it("the baseline covers every card and every preset (it cannot pass by measuring nothing)", () => {
    expect(Object.keys(baseline).length).toBe(items.length * STYLE_PRESETS.length * 2);
    expect(items.length).toBeGreaterThan(30);
    expect(STYLE_PRESETS.length).toBeGreaterThan(3);
  });

  it("every built-in preset draws every gallery card exactly as it did before", () => {
    const moved: string[] = [];
    for (const item of items) {
      for (const preset of STYLE_PRESETS) {
        for (const large of [false, true]) {
          const key = `${item.plot.name}|${preset.name}${large ? "|large" : ""}`;
          const was = baseline[key];
          if (was === undefined) { moved.push(`${key}: new, not in the baseline`); continue; }
          const now = fingerprint(item, preset, large);
          if (now !== was) moved.push(`${key}: ${was} → ${now}`);
        }
      }
    }
    expect(
      moved,
      "These preset × card combinations no longer draw what they drew before. A new preset " +
        "parameter must be optional, unset on every built-in that does not deliberately use it, " +
        "and written only when defined:\n  - " +
        moved.join("\n  - ") +
        "\n",
    ).toEqual([]);
  }, 300_000);
});
