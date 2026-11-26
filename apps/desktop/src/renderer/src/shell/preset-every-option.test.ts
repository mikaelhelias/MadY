// @vitest-environment jsdom
/**
 * A saved preset brings back every setting it holds, per graph type, the whole way round.
 *
 * A preset is per graph type: its section for a type holds that type's own settings
 * (`KIND_STYLE_KEYS`) and the shared look as it was on a graph of that type (fonts, axes, grid,
 * legend, frame, figure size, colours — `SHARED_KEYS`). For every graph type, every one of those
 * settings is changed on that type's gallery card to a value the option catalogue offers, the
 * preset is saved as the Style tab's Save does it (and as "+ type" adds a type), written to file
 * text and read back as Export… / Import preset… do, and applied to a fresh graph of the same type
 * the way the preset picker applies it. Every changed value is read back.
 *
 * A setting that does not come back must be named in `NOT_CARRIED` with its reason; anything else
 * fails by name. A column, row or sheet reference is stripped when a preset is captured, so the
 * value a preset can hold is the value without them (`carriedValue`).
 */
import { beforeEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { MadyDocument, stripPlotRefs, tableDatasets } from "@mady/core";
import { buildPlotScene } from "@mady/graphics";
import { scenePaletteOpt } from "./scenePalette";
import type { DataTable, Plot, PlotKind, Project } from "@mady/core";
import { galleryItems } from "./gallery";
import { allOptions, applyOption, candidates } from "./optionEffects";
import type { Option } from "./optionEffects";
import { captureKindSection, captureSharedStyle, kindOwnedKeys } from "./presetKeys";
import { SHARED_KEYS } from "./templates";
import { parsePresetFile, serialisePreset } from "./presetFile";
import { applyUserPresetWithKindDefaults } from "./seedStyle";
import { findUserPreset, insertUserPreset, saveUserPreset, setUserPresetKind } from "./userPresets";
import type { UserPreset } from "./userPresets";

type Change = { path: string[]; value: unknown };
type Card = { table: DataTable; plot: Plot; extra: DataTable[] };
const getPath = (o: unknown, path: string[]): unknown => path.reduce<unknown>((cur, k) => (cur && typeof cur === "object" ? (cur as Record<string, unknown>)[k] : undefined), o);
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
const key = (path: string[]): string => path.join(".");
const PALETTE = ["#123456", "#abcdef", "#fedcba"];

/**
 * Settings a preset holds that do not come back on purpose, each with the reason. A path matches
 * its own entry or the entry of any prefix.
 */
const NOT_CARRIED: Record<string, string> = {
  "xAxis.title": "an axis title is the graph's own words; a preset never renames the target's axes",
  "yAxis.title": "an axis title is the graph's own words; a preset never renames the target's axes",
  "y2Axis.title": "an axis title is the graph's own words; a preset never renames the target's axes",
  "y3Axis.title": "an axis title is the graph's own words; a preset never renames the target's axes",
  "zAxis.title": "an axis title is the graph's own words; a preset never renames the target's axes",
};
const notCarriedReason = (path: string[]): string | undefined => {
  for (let i = path.length; i > 0; i--) { const r = NOT_CARRIED[key(path.slice(0, i))]; if (r) return r; }
  return undefined;
};

/** A sheet reference (a column, row or table id): stripped when a preset is captured, by design. */
const isReference = (o: Option): boolean => /NodeId/.test(o.type);

/** What a preset can hold of a value: the value with every sheet reference inside it stripped, as capture does. */
function carriedValue(path: string[], value: unknown): unknown {
  const holder: Record<string, unknown> = {};
  let cur = holder;
  path.forEach((k, i) => { if (i === path.length - 1) cur[k] = value; else { cur[k] = {}; cur = cur[k] as Record<string, unknown>; } });
  return getPath(stripPlotRefs(holder as Partial<Plot>), path);
}

/** One card per graph type: the first the gallery lists. */
function cardsByKind(): Map<PlotKind, Card> {
  const out = new Map<PlotKind, Card>();
  for (const it of galleryItems()) {
    const kind = (it.plot.kind ?? "xy") as PlotKind;
    if (!out.has(kind)) out.set(kind, { table: it.table, plot: it.plot, extra: it.extraTables ?? [] });
  }
  return out;
}

/** Change every setting a preset's section for this type holds to a catalogue value different from what the plot has. */
function changeAll(kind: PlotKind, card: Card): { plot: Plot; changes: Change[]; unvalued: string[] } {
  // What the user can set on a graph of this type and expects a preset of that type to keep: the type's own keys and
  // the shared look. Chosen here, not from `sectionKeys`, so a section that holds too little shows up as a loss.
  const keys = new Set<string>([...kindOwnedKeys(kind), ...SHARED_KEYS] as string[]);
  let next = card.plot;
  const changes: Change[] = [];
  const unvalued: string[] = [];
  for (const o of allOptions()) {
    if (o.perSeries || o.perPoint || isReference(o) || !keys.has(o.path[0]!)) continue;
    const cur = getPath(next, o.path);
    // The full colour scheme is a list of colours, which the catalogue does not synthesise; a preset carries it.
    const offered = o.path[0] === "paletteColors" ? [["#111111", "#222222", "#333333", "#444444", "#555555"]] : candidates(o.type, o.path[o.path.length - 1]!, { table: card.table, plot: next });
    const value = offered.find((v) => !same(v, cur));
    if (value === undefined) { unvalued.push(`${kind}: ${key(o.path)}`); continue; }
    next = applyOption(next, card.table, o, value);
    changes.push({ path: o.path, value });
  }
  return { plot: next, changes, unvalued };
}

/** The preset written to file text and read back, as Export… then Import preset… do. */
function exportedAndImported(p: UserPreset): UserPreset {
  const parsed = parsePresetFile(serialisePreset(p), [p.name]);
  expect(parsed.ok, `${p.name}: the exported file must read back`).toBe(true);
  if (!parsed.ok) throw new Error(parsed.error);
  expect(parsed.dropped, `${p.name}: nothing in a file MadY wrote may be unknown to MadY`).toEqual([]);
  expect(insertUserPreset(parsed.preset)).toEqual({ ok: true });
  return findUserPreset(parsed.preset.id)!;
}

/** Apply a preset to a fresh graph of this type the way the preset picker does; list every change that did not come back. */
function lostOnApply(kind: PlotKind, card: Card, preset: UserPreset, changes: Change[]): string[] {
  const fresh: Plot = { id: "fresh", name: "Fresh", kind, source: card.table.id, status: "ok", styleOverrides: {} };
  const project: Project = { schemaVersion: 4, tables: [card.table, ...card.extra], plots: [fresh], analyses: [], log: [], workspace: { folders: [], loose: [] } };
  const doc = new MadyDocument(project);
  applyUserPresetWithKindDefaults(doc, "fresh", kind, preset);
  const out = doc.toJSON().plots[0]!;
  const lost: string[] = [];
  for (const c of changes) {
    if (same(getPath(out, c.path), carriedValue(c.path, c.value)) || notCarriedReason(c.path)) continue;
    lost.push(`${kind}: ${key(c.path)} = ${JSON.stringify(getPath(out, c.path))}, saved ${JSON.stringify(c.value)}`);
  }
  // The ordered series colours land on the graph's own series, in order.
  const styles = out.seriesStyles ?? {};
  tableDatasets(card.table).slice(0, PALETTE.length).forEach((d, i) => {
    if (styles[d.id]?.color !== PALETTE[i]) lost.push(`${kind}: series ${i + 1} colour = ${styles[d.id]?.color}, saved ${PALETTE[i]}`);
  });
  return lost;
}

const report = (label: string, changed: number, unvalued: string[], lost: string[]): void => {
  if (process.env.PRESET_EVERY_REPORT) process.stdout.write(`\n${label}: ${changed} settings changed; unvalued ${unvalued.length}\n  ${unvalued.join("\n  ")}\nlost:\n  ${lost.join("\n  ")}\n`);
};

/** Settings the catalogue cannot give a value: data-like fields, not looks. A new one shows up here. */
const UNVALUED = ["heatmap: heatmap.colSplits", "heatmap: heatmap.colTracks", "heatmap: heatmap.rowSplits", "heatmap: heatmap.rowTracks", "histogram: histogram.binRanges", "ridgeline: ridgeline.source"];

/**
 * Saved presets keep drawing what they drew. Two preset files are kept as fixtures: one written the way presets were
 * saved before a type's section held the shared look (each section only the type's own block), and one with every
 * type's full section. Each is imported and applied to a fresh graph of every type; the plot and drawing must hash as
 * recorded. A failure is not fixed by re-recording: either a change moved what a saved preset draws, or the recording
 * is being changed on purpose (compare the drawings first, and say why in the commit).
 * Re-record: PRESET_SAVED_WRITE=1 npx vitest run apps/desktop/src/renderer/src/shell/preset-every-option.test.ts
 */
const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), "preset-every-option.fixtures.json");

export function savedHashes(fileTexts: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  const measure = (t: string, px: number): number => t.length * px * 0.6;
  for (const [label, text] of Object.entries(fileTexts)) {
    localStorage.clear();
    const parsed = parsePresetFile(text, [], 0, () => "fixed");
    if (!parsed.ok) throw new Error(`${label}: ${parsed.error}`);
    for (const [kind, card] of cardsByKind()) {
      const fresh: Plot = { id: "fresh", name: "Fresh", kind, source: card.table.id, status: "ok", styleOverrides: {} };
      const project: Project = { schemaVersion: 4, tables: [card.table, ...card.extra], plots: [fresh], analyses: [], log: [], workspace: { folders: [], loose: [] } };
      const doc = new MadyDocument(project);
      applyUserPresetWithKindDefaults(doc, "fresh", kind, parsed.preset);
      const plot = doc.toJSON().plots[0]!;
      const tables = doc.toJSON().tables;
      const scene = buildPlotScene(card.table, plot, { measure, width: 580, height: 380, tables: (id: string) => tables.find((t) => t.id === id), ...scenePaletteOpt(plot) });
      const rounded = JSON.stringify({ plot, scene }, (_k, v: unknown) => (typeof v === "number" ? Math.round(v * 100) / 100 : v));
      out[`${label}|${kind}`] = createHash("sha256").update(rounded).digest("hex").slice(0, 16);
    }
  }
  return out;
}

describe("a preset saved today draws the same in later versions", () => {
  beforeEach(() => localStorage.clear());

  it("both kept preset files, applied to every graph type, draw as recorded", () => {
    if (process.env.PRESET_SAVED_WRITE) {
      const runs = new Map<PlotKind, ReturnType<typeof changeAll>>();
      for (const [kind, card] of cardsByKind()) runs.set(kind, changeAll(kind, card));
      const xy = runs.get("xy")!;
      const full: Partial<Record<PlotKind, Partial<Plot>>> = {};
      const ownOnly: Partial<Record<PlotKind, Partial<Plot>>> = {};
      for (const [kind, run] of runs) {
        const s = captureKindSection(run.plot);
        if (!s) continue;
        full[kind] = s;
        const own = Object.fromEntries(Object.entries(s).filter(([k]) => (kindOwnedKeys(kind) as string[]).includes(k)));
        if (Object.keys(own).length) ownOnly[kind] = own as Partial<Plot>;
      }
      const at = (name: string, kinds: Partial<Record<PlotKind, Partial<Plot>>>): string =>
        serialisePreset({ id: "fixture", name, style: captureSharedStyle(xy.plot), palette: PALETTE, shapes: ["square", "triangle"], kinds, createdAt: 0 });
      const files = { "own sections": at("Own sections", ownOnly), "full sections": at("Full sections", full) };
      writeFileSync(FIXTURE, JSON.stringify({ files, hashes: savedHashes(files) }, null, 2) + "\n");
    }
    const fixture = JSON.parse(readFileSync(FIXTURE, "utf8")) as { files: Record<string, string>; hashes: Record<string, string> };
    expect(Object.keys(fixture.hashes).length, "the recording covers both files on every graph type").toBe(2 * cardsByKind().size);
    const now = savedHashes(fixture.files);
    const moved = Object.keys(fixture.hashes).filter((k) => now[k] !== fixture.hashes[k]);
    expect(moved, "saved presets that no longer draw what they drew").toEqual([]);
  }, 300_000);
});

describe("a preset per graph type brings every setting back, through save, export, import and apply", () => {
  beforeEach(() => localStorage.clear());

  it("saved from a graph of each type, applied to a fresh graph of that type", () => {
    let changed = 0;
    const unvalued: string[] = [];
    const lost: string[] = [];
    for (const [kind, card] of cardsByKind()) {
      localStorage.clear();
      const run = changeAll(kind, card);
      changed += run.changes.length;
      unvalued.push(...run.unvalued);
      // The Style tab's Save with "Include this graph type's own settings" ticked.
      const section = captureKindSection(run.plot);
      const saved = saveUserPreset(`Mine ${kind}`, captureSharedStyle(run.plot), PALETTE, undefined, section ? { [kind]: section } : undefined);
      lost.push(...lostOnApply(kind, card, exportedAndImported(saved), run.changes));
    }
    report("one preset per type", changed, unvalued, lost);
    expect(changed, "too few settings changed for this to prove anything").toBeGreaterThan(5000);
    expect([...new Set(unvalued)].sort()).toEqual(UNVALUED);
    expect(lost, "settings a preset saved from a graph did not bring back on the same graph type").toEqual([]);
  }, 300_000);

  it("one preset holding every type (saved from the XY graph, each other type added with + type)", () => {
    const cards = cardsByKind();
    const runs = new Map<PlotKind, ReturnType<typeof changeAll>>();
    for (const [kind, card] of cards) runs.set(kind, changeAll(kind, card));
    const xy = runs.get("xy")!;
    let preset = saveUserPreset("Every type", captureSharedStyle(xy.plot), PALETTE, undefined, { xy: captureKindSection(xy.plot)! });
    for (const [kind, run] of runs) {
      if (kind === "xy") continue;
      const section = captureKindSection(run.plot);
      if (section) preset = setUserPresetKind(preset.id, kind, section);
    }
    const imported = exportedAndImported(preset);
    const lost: string[] = [];
    for (const [kind, card] of cards) lost.push(...lostOnApply(kind, card, imported, runs.get(kind)!.changes));
    report("one preset, every type", [...runs.values()].reduce((n, r) => n + r.changes.length, 0), [], lost);
    expect(lost, "settings the one preset did not bring back on their own graph type").toEqual([]);
  }, 300_000);
});
