// @vitest-environment node
/**
 * The preset key tables — three guards, all default-deny.
 *
 *  1. Census: every top-level field of `Plot` (read out of model.ts) is in exactly one of
 *     SHARED_KEYS / KIND_STYLE_KEYS / PRESET_EXCLUDED, no table names a field that no longer
 *     exists, and every graph type named is a real one. A new `Plot` field fails until
 *     someone decides what a preset does with it.
 *  2. Listed types are real: for every (key, graph type) pair, changing the key on that type's gallery
 *     card must change the drawing — checked with `optionEffects.ts`, so a wrong
 *     type (pie → barWidth) cannot sit in the table.
 *  3. Capture: a type's section takes only the keys that type owns (a bar that was once a
 *     pie keeps `pieDonut`; the bar section must not) and carries no sheet ids.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Plot, PlotKind } from "@mady/core";
import { galleryItems, optionDrawables } from "./gallery";
import { allOptions, movesAnyValue } from "./optionEffects";
import { KIND_STYLE_KEYS, PRESET_EXCLUDED, captureKindSection, captureSharedStyle, kindOwnedKeys } from "./presetKeys";
import { SHARED_KEYS } from "./templates";

const HERE = dirname(fileURLToPath(import.meta.url));
const MODEL = readFileSync(join(HERE, "../../../../../../packages/core/src/model.ts"), "utf8").replace(/\r\n/g, "\n");
const stripComments = (s: string): string => s.replace(/\/\*\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

/** Top-level fields of `Plot`, as declared. */
function plotFields(): string[] {
  const block = MODEL.slice(MODEL.indexOf("export interface Plot {"));
  const body = stripComments(block.slice(0, block.indexOf("\n}")));
  return [...body.matchAll(/^\s{2}(\w+)\??:/gm)].map((m) => m[1]!);
}

/** Members of the `PlotKind` union. */
function plotKinds(): string[] {
  // Comments first: the union's own doc comments contain semicolons.
  const from = MODEL.indexOf("export type PlotKind =");
  const clean = stripComments(MODEL.slice(from, from + 6000));
  const body = clean.slice(0, clean.indexOf(";"));
  return [...body.matchAll(/"(\w+)"/g)].map((m) => m[1]!);
}

describe("preset key tables — every Plot field is classified, once", () => {
  const fields = plotFields();
  const kindKeys = Object.keys(KIND_STYLE_KEYS);
  const excluded = Object.keys(PRESET_EXCLUDED);

  it("the reader found the interface", () => {
    expect(fields.length).toBeGreaterThan(100);
    expect(fields).toContain("barWidth");
    expect(plotKinds()).toContain("oncoprint");
  });

  it("every field is in exactly one table", () => {
    const tables: Record<string, string[]> = { SHARED_KEYS: SHARED_KEYS as string[], KIND_STYLE_KEYS: kindKeys, PRESET_EXCLUDED: excluded };
    const unclassified = fields.filter((f) => !Object.values(tables).some((t) => t.includes(f)));
    expect(unclassified, "Plot fields no preset table knows — decide: shared, a type's own, or excluded with a reason").toEqual([]);
    const twice = fields.filter((f) => Object.values(tables).filter((t) => t.includes(f)).length > 1);
    expect(twice, "a field in two tables").toEqual([]);
  });

  it("no table names a field Plot no longer has", () => {
    const stale = [...SHARED_KEYS, ...kindKeys, ...excluded].filter((k) => !fields.includes(k as string));
    expect(stale).toEqual([]);
  });

  it("every listed graph type is real, and every reason is written", () => {
    const kinds = plotKinds();
    const badOwners = Object.entries(KIND_STYLE_KEYS).flatMap(([k, owners]) => owners.filter((o) => !kinds.includes(o)).map((o) => `${k} → ${o}`));
    expect(badOwners).toEqual([]);
    const empty = Object.entries(KIND_STYLE_KEYS).filter(([, owners]) => owners.length === 0).map(([k]) => k);
    expect(empty, "a kind-specific key with no graph type is unreachable").toEqual([]);
    const noReason = Object.entries(PRESET_EXCLUDED).filter(([, why]) => !why || why.length < 12).map(([k]) => k);
    expect(noReason).toEqual([]);
  });
});

describe("preset key tables — a listed graph type really draws the key", () => {
  // Gallery cards show each type's default look, so a key that only acts behind another option
  // (the waffle's keys need Display: Waffle) is measured on the option-drawn fixtures too — the
  // fixtures that wear those prerequisites (optionDrawables, gallery.ts).
  const items = [...galleryItems(), ...optionDrawables()];
  const options = allOptions();
  /** Keys `allOptions()` offers no option path for, with the reason — each must still have a card. */
  const NO_CANDIDATE: Record<string, string> = {
    zAxis: "an AxisSpec; allOptions() enumerates the four planar axes only, and scatter3d's builder alone reads it",
  };

  for (const [key, owners] of Object.entries(KIND_STYLE_KEYS)) {
    for (const owner of owners) {
      it(`${key} moves a ${owner}`, () => {
        const cards = items.filter((i) => (i.plot.kind ?? "xy") === owner);
        expect(cards.length, `no gallery card of kind ${owner} to measure on`).toBeGreaterThan(0);
        if (key in NO_CANDIDATE) return;
        const opts = options.filter((o) => o.path[0] === key && !o.perSeries && !o.perPoint);
        expect(opts.length, `no option path under ${key} — add it to NO_CANDIDATE with a reason`).toBeGreaterThan(0);
        const moved = cards.some((c) => opts.some((o) => movesAnyValue(c.table, c.plot, o)));
        expect(moved, `${owner} is listed as a graph type of ${key}, but changing it leaves every ${owner} card's drawing unchanged`).toBe(true);
      });
    }
  }
});

describe("captureKindSection takes only what the type owns, and no sheet ids", () => {
  const base = (kind: PlotKind): Plot => ({ id: "p", name: "P", kind, source: "t", status: "ok", styleOverrides: {} });

  it("a bar that used to be a pie keeps its pie keys out of the bar section", () => {
    const plot: Plot = { ...base("bar"), barWidth: 0.5, pieDonut: 0.4, heatmap: { colormap: "reds" }, fonts: { title: { size: 30 } } };
    expect(captureKindSection(plot)).toEqual({ barWidth: 0.5 });
  });

  it("a heatmap section carries the block without its column bindings", () => {
    const plot: Plot = { ...base("heatmap"), heatmap: { colormap: "reds", rowTracks: [{ column: "c1", name: "Tissue" }] } };
    const section = captureKindSection(plot);
    expect(section).toEqual({ heatmap: { colormap: "reds" } });
    expect(JSON.stringify(section)).not.toContain("c1");
  });

  it("a plot with nothing of its own set gives no section, not an empty one", () => {
    expect(captureKindSection(base("bar"))).toBeUndefined();
    expect(captureKindSection({ ...base("image"), barWidth: 0.5 })).toBeUndefined();
  });

  it("kindOwnedKeys: a bar owns barWidth and not pieDonut; a pie the reverse", () => {
    expect(kindOwnedKeys("bar")).toContain("barWidth");
    expect(kindOwnedKeys("bar")).not.toContain("pieDonut");
    expect(kindOwnedKeys("pie")).toContain("pieDonut");
    expect(kindOwnedKeys("pie")).not.toContain("barWidth");
  });

  it("the shared look drops a category-group column but keeps the axis look", () => {
    const plot: Plot = { ...base("bar"), xAxis: { lineWidth: 2, categoryGroups: { column: "c7", separators: true } } };
    const shared = captureSharedStyle(plot);
    expect(shared.xAxis?.lineWidth).toBe(2);
    expect(JSON.stringify(shared)).not.toContain("c7");
  });
});
