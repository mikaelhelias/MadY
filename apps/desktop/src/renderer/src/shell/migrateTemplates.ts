/**
 * Saved templates → presets, once, at start-up.
 *
 * A saved template (the "My templates" store) holds a graph's full look for one graph type. A
 * preset holds the same thing as a per-type section, can be the default for new graphs, and
 * travels as a file — so every saved template is converted into (part of) a preset.
 *
 *   • templates sharing a name become one preset: the shared look from the first of them, one
 *     section per graph type (the template's own keys, sheet references stripped, `seriesStyles`
 *     never copied — it is keyed by dead column ids);
 *   • a preset that already has that name gets the sections it lacks and nothing else changes;
 *   • converted presets are dated older than every existing preset, and are added with
 *     `insertUserPreset`, so a conversion can never push a real preset out of the list; at the
 *     cap the rest are refused and named, and the marker is not set, so freeing a slot and
 *     restarting converts them;
 *   • the template store is never touched (it stays exactly as it was);
 *   • idempotent: keyed on a signature of the raw store, and by (name, type) inside — the
 *     userData restore can land after the first run and re-trigger it safely.
 */
import type { Plot, PlotKind } from "@mady/core";
import { stripPlotRefs } from "@mady/core";
import { dGet, dSet } from "./durableStore";
import { kindOwnedKeys } from "./presetKeys";
import { SHARED_KEYS, allTemplates, capturePlotStyle } from "./templates";
import type { GraphTemplate } from "./templates";
import { insertUserPreset, listUserPresets, setUserPresetKind } from "./userPresets";
import type { UserPreset } from "./userPresets";

const TEMPLATES_KEY = "mady.templates.v1";
const MARKER_KEY = "mady.templates.migrated.v1";

export interface TemplateMigrationReport {
  /** New presets made from templates. */
  converted: number;
  /** Sections added to presets that already existed (by name). */
  sectionsAdded: number;
  /** Templates whose (name, type) was already a preset section — nothing to do. */
  alreadyThere: number;
  /** Presets that could not be added, by name, with the reason (the list is full). */
  refused: string[];
}

const EMPTY: TemplateMigrationReport = { converted: 0, sectionsAdded: 0, alreadyThere: 0, refused: [] };
let last: TemplateMigrationReport = EMPTY;

/** What the last run did — the Style tab shows a note when something was refused. */
export function templateMigrationReport(): TemplateMigrationReport {
  return last;
}

/** A short stable signature of the raw store, so an unchanged store is not walked again. */
function signature(raw: string): string {
  let h = 5381;
  for (let i = 0; i < raw.length; i++) h = ((h << 5) + h + raw.charCodeAt(i)) | 0;
  return `${raw.length}:${(h >>> 0).toString(36)}`;
}

/** One template's own settings as a preset section, or undefined when it has none. */
function sectionOf(t: GraphTemplate): Partial<Plot> | undefined {
  const section = stripPlotRefs(capturePlotStyle(t.style as Plot, kindOwnedKeys(t.kind)));
  return Object.keys(section).length ? section : undefined;
}

export function migrateTemplatesIntoPresets(now: number = Date.now()): TemplateMigrationReport {
  const raw = dGet(TEMPLATES_KEY);
  if (!raw) return (last = EMPTY);
  const sig = signature(raw);
  if (dGet(MARKER_KEY) === sig) return (last = EMPTY);

  const report: TemplateMigrationReport = { converted: 0, sectionsAdded: 0, alreadyThere: 0, refused: [] };
  const byName = new Map<string, GraphTemplate[]>();
  for (const t of allTemplates()) {
    if (!t || typeof t.name !== "string" || typeof t.kind !== "string" || !t.style) continue;
    byName.set(t.name, [...(byName.get(t.name) ?? []), t]);
  }
  let existing = listUserPresets();
  // Older than everything already saved, so the list order — and the cap's "oldest" — is theirs.
  let stamp = Math.min(now, ...existing.map((p) => p.createdAt)) - 1;

  for (const [name, group] of byName) {
    const sections: Partial<Record<PlotKind, Partial<Plot>>> = {};
    for (const t of group) {
      const s = sectionOf(t);
      if (s) sections[t.kind] = s;
    }
    const ex = existing.find((p) => p.name === name);
    if (ex) {
      for (const [kind, section] of Object.entries(sections) as [PlotKind, Partial<Plot>][]) {
        if (ex.kinds?.[kind]) { report.alreadyThere++; continue; }
        setUserPresetKind(ex.id, kind, section);
        report.sectionsAdded++;
      }
      if (Object.keys(sections).length === 0) report.alreadyThere++;
      existing = listUserPresets();
      continue;
    }
    const first = group[0]!;
    const style = stripPlotRefs(capturePlotStyle(first.style as Plot, SHARED_KEYS));
    const palette = Array.isArray(first.style.paletteColors) ? [...first.style.paletteColors] : [];
    const rec: UserPreset = {
      id: `up_${now.toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
      name,
      style,
      palette,
      ...(Object.keys(sections).length ? { kinds: sections } : {}),
      createdAt: stamp--,
    };
    const ins = insertUserPreset(rec);
    if (ins.ok) { report.converted++; existing = listUserPresets(); }
    else report.refused.push(`${name}: ${ins.reason}`);
  }
  if (report.refused.length === 0) dSet(MARKER_KEY, sig);
  return (last = report);
}
