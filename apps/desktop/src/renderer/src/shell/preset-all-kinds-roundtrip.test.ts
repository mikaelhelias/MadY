// @vitest-environment jsdom
/**
 * One preset, every graph type, the whole way round: a preset modified for every graph type, saved
 * and imported again, keeps every modification for every graph type.
 *
 * For every graph type the gallery has a card for, every setting the type owns (`KIND_STYLE_KEYS`)
 * is changed to a value the option catalogue (`optionEffects.ts`) knows moves the drawing; the graph's own section is
 * captured exactly as the Style tab's Save (tick on) captures it; all sections are saved into one
 * preset; the preset is written to file text and read back exactly as Export… / Import preset… do
 * it; and the imported preset is applied to a fresh graph of each type, where every changed value
 * is read back. The functions are the ones the buttons call — nothing here is a mock of them.
 *
 * Floors keep it from passing vacuously: at least 40 types and 80 settings must have been driven.
 * Settings the catalogue cannot value (a NodeId, an id-keyed record) are listed, not silently skipped.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { writeFileSync } from "node:fs";
import { MadyDocument } from "@mady/core";
import type { DataTable, Plot, PlotKind, Project } from "@mady/core";
import { galleryItems } from "./gallery";
import { allOptions, applyOption, candidates } from "./optionEffects";
import { KIND_STYLE_KEYS, captureKindSection, captureSharedStyle, kindOwnedKeys } from "./presetKeys";
import { parsePresetFile, serialisePreset } from "./presetFile";
import { applyUserPresetWithKindDefaults } from "./seedStyle";
import { findUserPreset, insertUserPreset, saveUserPreset } from "./userPresets";
import { kindLabel } from "./UserPresetList";

type Change = { kind: PlotKind; path: string[]; value: unknown; alt?: unknown };

const getPath = (o: unknown, path: string[]): unknown => path.reduce<unknown>((cur, k) => (cur && typeof cur === "object" ? (cur as Record<string, unknown>)[k] : undefined), o);
const bare = (t: string): string => t.replace(/\s*\|\s*undefined$/, "").trim();
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/** One card per graph type (the first the gallery lists), with the type's owned keys. */
function cardsByKind(): Map<PlotKind, { table: DataTable; plot: Plot; extra: DataTable[] }> {
  const out = new Map<PlotKind, { table: DataTable; plot: Plot; extra: DataTable[] }>();
  for (const it of galleryItems()) {
    const kind = (it.plot.kind ?? "xy") as PlotKind;
    if (!out.has(kind)) out.set(kind, { table: it.table, plot: it.plot, extra: it.extraTables ?? [] });
  }
  return out;
}

/**
 * Change every owned key of the plot to a value the option catalogue says is drawable, and return the
 * changed plot with the list of changes. A key with no usable value is reported by name.
 */
function modifyEveryOwnedKey(kind: PlotKind, table: DataTable, plot: Plot): { plot: Plot; changes: Change[]; unvalued: string[] } {
  const options = allOptions();
  let next = plot;
  const changes: Change[] = [];
  const unvalued: string[] = [];
  for (const key of kindOwnedKeys(kind)) {
    // Prefer the scalar at the top; else the first nested field with a value. Never a NodeId
    // (a sheet reference — stripped on capture, and not a style) or an id-keyed record.
    const opts = options
      .filter((o) => o.path[0] === key && !o.perSeries && !o.perPoint && !/NodeId/.test(o.type) && !/^Record</.test(bare(o.type)) && o.path.length <= 2)
      .sort((a, b) => a.path.length - b.path.length);
    let done = false;
    for (const o of opts) {
      const cur = getPath(next, o.path);
      const cands = candidates(o.type, o.path[o.path.length - 1]!, { table, plot: next });
      const value = cands.find((v) => !same(v, cur));
      if (value === undefined) continue;
      next = applyOption(next, table, o, value);
      // A second value, different from the first, for the live twin's "put it elsewhere first".
      const alt = cands.find((v) => !same(v, value)) ?? (cur === undefined ? undefined : cur);
      changes.push({ kind, path: o.path, value, ...(alt === undefined ? {} : { alt }) });
      done = true;
      break;
    }
    if (!done) unvalued.push(`${kind}.${key}`);
  }
  return { plot: next, changes, unvalued };
}

describe("one preset carries every graph type's modified settings through save, export, import and apply", () => {
  beforeEach(() => localStorage.clear());

  it("every changed setting of every type is captured, survives the file, and lands on a fresh graph of that type", () => {
    const cards = cardsByKind();
    const changes: Change[] = [];
    const unvalued: string[] = [];
    const sections: Partial<Record<PlotKind, Partial<Plot>>> = {};
    const modifiedCards = new Map<PlotKind, { table: DataTable; plot: Plot; extra: DataTable[] }>();

    // 1. Modify, and capture as the Style tab's Save (tick on) does.
    for (const [kind, card] of cards) {
      if (kindOwnedKeys(kind).length === 0) continue; // e.g. "image": nothing of its own to carry
      const m = modifyEveryOwnedKey(kind, card.table, card.plot);
      unvalued.push(...m.unvalued);
      const section = captureKindSection(m.plot);
      expect(section, `${kind}: a modified graph must capture a section`).toBeDefined();
      for (const c of m.changes) {
        expect(getPath(section, c.path), `${kind}: captured section lost ${c.path.join(".")}`).toEqual(c.value);
      }
      sections[kind] = section!;
      changes.push(...m.changes);
      modifiedCards.set(kind, { ...card, plot: m.plot });
    }
    const kindsDriven = Object.keys(sections).length;
    if (process.env.PRESET_WALK_REPORT) {
      const perKind = new Map<string, string[]>();
      for (const c of changes) perKind.set(c.kind, [...(perKind.get(c.kind) ?? []), c.path.join(".")]);
      const lines = [...perKind.entries()].map(([k, keys]) => `${k.padEnd(12)} ${keys.length.toString().padStart(2)}  ${keys.join(", ")}`);
      process.stdout.write(`\nPreset round trip — ${kindsDriven} types, ${changes.length} settings changed; unvalued: ${unvalued.join(", ") || "none"}\n${lines.join("\n")}\n`);
    }
    /**
     * Generator mode for the live twin (`e2e/preset-all-kinds-live.spec.ts`): the same walk,
     * written out as a fixture the real-browser run drives through the app's own buttons.
     *   PRESET_WALK_OUT=1 npx vitest run apps/desktop/src/renderer/src/shell/preset-all-kinds-roundtrip.test.ts
     */
    if (process.env.PRESET_WALK_OUT) {
      const cardTitle = new Map<string, string>();
      for (const it of galleryItems()) { const k = it.plot.kind ?? "xy"; if (!cardTitle.has(k)) cardTitle.set(k, it.title); }
      const out = [...modifiedCards.keys()].map((kind) => ({
        kind, card: cardTitle.get(kind)!, label: kindLabel(kind),
        changes: changes.filter((c) => c.kind === kind).map((c) => ({ path: c.path, value: c.value, ...(c.alt === undefined ? {} : { alt: c.alt }) })),
      }));
      // vitest runs from the repo root (jsdom gives import.meta.url no file: scheme).
      writeFileSync(`${process.cwd()}/e2e/fixtures/preset-walk.json`, JSON.stringify(out, null, 2) + "\n");
    }
    expect(kindsDriven, "too few graph types were driven for this to prove anything").toBeGreaterThanOrEqual(40);
    expect(changes.length, "too few settings were changed for this to prove anything").toBeGreaterThanOrEqual(80);
    // What could not be valued is a known list, not a growing one.
    expect(unvalued.sort()).toEqual(["scatter3d.zAxis"].sort());

    // 2. Save one preset holding every section (the Save box, then "+ type" for each type).
    const first = [...modifiedCards.values()][0]!.plot;
    const saved = saveUserPreset("Every type", captureSharedStyle(first), ["#123456", "#abcdef"], ["square"], sections);
    expect(Object.keys(saved.kinds ?? {}).length).toBe(kindsDriven);

    // 3. Export… then Import preset… — the file text and the parser the buttons use.
    const text = serialisePreset(saved);
    const parsed = parsePresetFile(text, ["Every type"]);
    expect(parsed.ok, "the exported file must read back").toBe(true);
    if (!parsed.ok) return;
    expect(parsed.dropped, "nothing in a file MadY wrote may be unknown to MadY").toEqual([]);
    expect(parsed.preset.name).toBe("Every type (2)");
    expect(parsed.preset.id).not.toBe(saved.id);
    expect(insertUserPreset(parsed.preset)).toEqual({ ok: true });
    const imported = findUserPreset(parsed.preset.id)!;
    for (const c of changes) {
      expect(getPath(imported.kinds?.[c.kind], c.path), `${c.kind}: the imported preset lost ${c.path.join(".")}`).toEqual(c.value);
    }
    expect(imported.kinds, "the imported sections must equal the saved ones exactly").toEqual(saved.kinds);
    expect(imported.style).toEqual(saved.style);
    expect(imported.palette).toEqual(saved.palette);
    expect(imported.shapes).toEqual(saved.shapes);

    // 4. Apply the imported preset to a fresh graph of each type; every change must land.
    for (const [kind, card] of modifiedCards) {
      const fresh: Plot = { id: "fresh", name: "Fresh", kind, source: card.table.id, status: "ok", styleOverrides: {} };
      const project: Project = { schemaVersion: 4, tables: [card.table, ...card.extra], plots: [fresh], analyses: [], log: [], workspace: { folders: [], loose: [] } };
      const doc = new MadyDocument(project);
      applyUserPresetWithKindDefaults(doc, "fresh", kind, imported);
      const out = doc.toJSON().plots[0]!;
      for (const c of changes.filter((x) => x.kind === kind)) {
        expect(getPath(out, c.path), `${kind}: after applying the imported preset, ${c.path.join(".")} is not the modified value`).toEqual(c.value);
      }
    }
  });

  it("the key-to-kind table (KIND_STYLE_KEYS) is what the walk covers (no owned key is silently outside the walk)", () => {
    const cards = cardsByKind();
    const uncovered = (Object.entries(KIND_STYLE_KEYS) as [string, readonly PlotKind[]][])
      .flatMap(([key, owners]) => owners.filter((o) => !cards.has(o)).map((o) => `${key} → ${o} (no gallery card)`));
    expect(uncovered).toEqual([]);
  });
});
