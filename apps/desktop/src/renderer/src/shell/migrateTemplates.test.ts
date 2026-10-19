// @vitest-environment jsdom
/**
 * Saved templates become presets once, at start-up — and can never damage what is there.
 */
import { beforeEach, describe, expect, it } from "vitest";
import type { Plot, PlotKind } from "@mady/core";
import { migrateTemplatesIntoPresets, templateMigrationReport } from "./migrateTemplates";
import { MAX_USER_PRESETS, findUserPreset, listUserPresets, saveUserPreset } from "./userPresets";

const TPL = "mady.templates.v1";
const seed = (list: { name: string; kind: PlotKind; style: Partial<Plot> }[]): string => {
  const raw = JSON.stringify(list);
  localStorage.setItem(TPL, raw);
  return raw;
};
const xyStyle: Partial<Plot> = { frame: "box", fonts: { title: { size: 30 } }, paletteColors: ["#123", "#456"], seriesStyles: { c1: { color: "#000" } }, spread: { kind: "sd" } as never };
const barStyle: Partial<Plot> = { frame: "lshape", barWidth: 0.9, barLayout: "stacked" as never, seriesStyles: { c9: { color: "#fff" } } };

describe("migrateTemplatesIntoPresets", () => {
  beforeEach(() => localStorage.clear());

  it("templates sharing a name become ONE preset: shared look from the first, one section per type, no seriesStyles", () => {
    seed([{ name: "Journal", kind: "xy", style: xyStyle }, { name: "Journal", kind: "bar", style: barStyle }]);
    const r = migrateTemplatesIntoPresets(1_000_000);
    expect(r).toEqual({ converted: 1, sectionsAdded: 0, alreadyThere: 0, refused: [] });
    const [p] = listUserPresets();
    expect(p!.name).toBe("Journal");
    expect(p!.style).toEqual({ frame: "box", fonts: { title: { size: 30 } }, paletteColors: ["#123", "#456"] });
    expect(p!.palette).toEqual(["#123", "#456"]);
    expect(p!.kinds).toEqual({ xy: { spread: { kind: "sd" } }, bar: { barWidth: 0.9, barLayout: "stacked" } });
    // Quoted keys only: the preset's id ends in random letters that can spell "c1".
    expect(JSON.stringify(p)).not.toMatch(/"seriesStyles"|"c1"|"c9"/);
    expect(templateMigrationReport()).toEqual(r);
  });

  it("a preset that already has the name gets the sections it lacks; its look is untouched", () => {
    const mine = saveUserPreset("Journal", { frame: "none" as never }, ["#abc"], undefined, { bar: { barWidth: 0.2 } });
    seed([{ name: "Journal", kind: "xy", style: xyStyle }, { name: "Journal", kind: "bar", style: barStyle }]);
    const r = migrateTemplatesIntoPresets();
    expect(r).toEqual({ converted: 0, sectionsAdded: 1, alreadyThere: 1, refused: [] });
    const after = findUserPreset(mine.id)!;
    expect(after.style).toEqual({ frame: "none" });
    expect(after.palette).toEqual(["#abc"]);
    expect(after.kinds).toEqual({ bar: { barWidth: 0.2 }, xy: { spread: { kind: "sd" } } }); // the bar section stayed MINE
    expect(listUserPresets()).toHaveLength(1);
  });

  it("a heatmap template's row-track column is stripped; the store itself is byte-identical afterwards", () => {
    const raw = seed([{ name: "Tissue map", kind: "heatmap", style: { heatmap: { colormap: "reds", rowTracks: [{ column: "c3", name: "Tissue" }] } } }]);
    migrateTemplatesIntoPresets();
    const [p] = listUserPresets();
    expect(p!.kinds).toEqual({ heatmap: { heatmap: { colormap: "reds" } } });
    expect(localStorage.getItem(TPL)).toBe(raw);
  });

  it("runs twice without duplicating, and again when the store changes", () => {
    seed([{ name: "A", kind: "bar", style: barStyle }]);
    expect(migrateTemplatesIntoPresets().converted).toBe(1);
    expect(migrateTemplatesIntoPresets()).toEqual({ converted: 0, sectionsAdded: 0, alreadyThere: 0, refused: [] });
    expect(listUserPresets()).toHaveLength(1);
    seed([{ name: "A", kind: "bar", style: barStyle }, { name: "B", kind: "xy", style: xyStyle }]);
    const r = migrateTemplatesIntoPresets();
    expect(r.converted).toBe(1);
    expect(r.alreadyThere).toBe(1); // A's bar section was already there
    expect(listUserPresets().map((p) => p.name).sort()).toEqual(["A", "B"]);
  });

  it("converted presets sort OLDER than every real one and never push one out; at the cap the rest are refused by name and the run is not marked done", () => {
    const real = [];
    for (let i = 0; i < MAX_USER_PRESETS - 4; i++) real.push(saveUserPreset(`Mine ${i}`, { frame: "box" }, []).id); // four slots left, whatever the cap
    seed(Array.from({ length: 10 }, (_, i) => ({ name: `Old ${i}`, kind: "bar" as const, style: barStyle })));
    const r = migrateTemplatesIntoPresets();
    expect(r.converted).toBe(4);
    expect(r.refused).toHaveLength(6);
    expect(r.refused[0]).toMatch(/^Old 4: .*full/);
    const list = listUserPresets();
    expect(list).toHaveLength(MAX_USER_PRESETS);
    for (const id of real) expect(list.some((p) => p.id === id), `real preset ${id} was evicted`).toBe(true);
    expect(list.slice(-4).map((p) => p.name)).toEqual(["Old 0", "Old 1", "Old 2", "Old 3"]); // newest-first list: converted ones last
    expect(localStorage.getItem("mady.templates.migrated.v1")).toBeNull(); // not done: freeing a slot and restarting converts the rest
  });

  it("no store, or an unreadable one, is a quiet no-op", () => {
    expect(migrateTemplatesIntoPresets()).toEqual({ converted: 0, sectionsAdded: 0, alreadyThere: 0, refused: [] });
    localStorage.setItem(TPL, "not json");
    expect(migrateTemplatesIntoPresets()).toEqual({ converted: 0, sectionsAdded: 0, alreadyThere: 0, refused: [] });
    expect(listUserPresets()).toEqual([]);
  });
});
