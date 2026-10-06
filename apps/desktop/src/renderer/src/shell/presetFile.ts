/**
 * One preset as a file — export a saved preset for someone else, import theirs.
 *
 * The file is small and self-describing: `{ format: "mady-preset", v: 1, savedAt, preset }`.
 * Reading one is deliberately strict and deliberately forgiving in different places:
 *   • strict on what it is — a library file (the whole Back-up bundle) or anything that is not
 *     a MadY preset is refused with a sentence that says so;
 *   • forgiving on what it holds — a key this MadY does not know (a newer version's, a typo, a
 *     data reference) is dropped and reported, never applied; the keys kept are exactly those
 *     the preset tables allow (`SHARED_KEYS` for the shared look, `kindOwnedKeys` per section),
 *     with sheet references stripped;
 *   • the file's id is never trusted — every import gets a fresh one, and a name that clashes
 *     with one of yours gets " (2)", so nothing of yours is overwritten.
 *
 * Main only reads bytes (`preset:import`); everything that decides is here, and pure.
 */
import type { Plot, PlotKind, SymbolShape } from "@mady/core";
import { stripPlotRefs } from "@mady/core";
import { KIND_STYLE_KEYS, kindOwnedKeys } from "./presetKeys";
import { SHARED_KEYS } from "./templates";
import { insertUserPreset, listUserPresets } from "./userPresets";
import type { UserPreset } from "./userPresets";

export const PRESET_FILE_FORMAT = "mady-preset";

export interface PresetFile {
  format: typeof PRESET_FILE_FORMAT;
  v: 1;
  savedAt: number;
  preset: Pick<UserPreset, "name" | "style" | "palette"> & Partial<Pick<UserPreset, "shapes" | "kinds">>;
}

/** The marker shapes a file may name — `presetFile.test.ts` checks this against the model's union. */
export const KNOWN_SHAPES: ReadonlySet<string> = new Set<SymbolShape>([
  "circle", "square", "triangle", "diamond", "triangle-down", "star", "hexagon", "octagon", "pentagon", "plus", "cross", "ring", "squircle", "oval", "waffle", "none",
]);

/** The graph types a section may be for: every graph type named in the key tables. */
const KNOWN_KINDS: ReadonlySet<string> = new Set(Object.values(KIND_STYLE_KEYS).flat());

const HEX = /^#[0-9a-f]{3,8}$/i;

/** The text of a preset file for this record. */
export function serialisePreset(p: UserPreset): string {
  const file: PresetFile = {
    format: PRESET_FILE_FORMAT,
    v: 1,
    savedAt: Date.now(),
    preset: {
      name: p.name,
      style: p.style,
      palette: p.palette,
      ...(p.shapes && p.shapes.length ? { shapes: p.shapes } : {}),
      ...(p.kinds && Object.keys(p.kinds).length ? { kinds: p.kinds } : {}),
    },
  };
  return JSON.stringify(file, null, 2);
}

/** The file name offered in the save dialog (main sanitises it further). */
export function presetFileName(p: Pick<UserPreset, "name">): string {
  return `${p.name}.mady-preset`;
}

export type ParsedPreset =
  | { ok: true; preset: UserPreset; dropped: string[] }
  | { ok: false; error: string };

/** A name that is not already taken: "Lab", then "Lab (2)", "Lab (3)"… */
export function freeName(name: string, taken: Iterable<string>): string {
  const set = new Set(taken);
  if (!set.has(name)) return name;
  for (let n = 2; ; n++) {
    const candidate = `${name} (${n})`;
    if (!set.has(candidate)) return candidate;
  }
}

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/**
 * Read one preset file's text into a record ready to insert. `existingNames` decides the
 * " (2)" suffix; `now` and `random` are injectable for tests.
 */
export function parsePresetFile(
  text: string,
  existingNames: Iterable<string>,
  now: number = Date.now(),
  random: () => string = () => Math.random().toString(36).slice(2, 7),
): ParsedPreset {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: "not a preset file (the text is not JSON)" };
  }
  if (!isRecord(raw)) return { ok: false, error: "not a preset file" };
  if (raw.format === undefined && raw.v === 1 && isRecord(raw.data)) {
    return { ok: false, error: "this is a whole style library, not one preset — use Import… under Back up & transfer" };
  }
  if (raw.format !== PRESET_FILE_FORMAT) return { ok: false, error: "not a MadY preset file" };
  if (raw.v !== 1) return { ok: false, error: `preset file version ${String(raw.v)} is not one this MadY reads` };
  const p = raw.preset;
  if (!isRecord(p)) return { ok: false, error: "the file has no preset in it" };
  const name = typeof p.name === "string" ? p.name.trim() : "";
  if (!name) return { ok: false, error: "the preset has no name" };

  const dropped: string[] = [];
  // Shared look: only the shared keys, references stripped.
  const style: Record<string, unknown> = {};
  if (isRecord(p.style)) {
    for (const [k, v] of Object.entries(p.style)) {
      if ((SHARED_KEYS as string[]).includes(k)) style[k] = v;
      else dropped.push(`style.${k}`);
    }
  }
  // Palette: hex colours only.
  const palette: string[] = [];
  if (Array.isArray(p.palette)) {
    for (const c of p.palette) {
      if (typeof c === "string" && HEX.test(c)) palette.push(c);
      else dropped.push(`palette: ${String(c)}`);
    }
  }
  // Shapes: names the drawing knows.
  const shapes: SymbolShape[] = [];
  if (Array.isArray(p.shapes)) {
    for (const s of p.shapes) {
      if (typeof s === "string" && KNOWN_SHAPES.has(s)) shapes.push(s as SymbolShape);
      else dropped.push(`shapes: ${String(s)}`);
    }
  }
  // Per-type sections: a known type, that type's own keys only, references stripped.
  const kinds: Partial<Record<PlotKind, Partial<Plot>>> = {};
  if (isRecord(p.kinds)) {
    for (const [kind, section] of Object.entries(p.kinds)) {
      if (!KNOWN_KINDS.has(kind) || !isRecord(section)) {
        dropped.push(`kinds.${kind}`);
        continue;
      }
      const owned = kindOwnedKeys(kind as PlotKind) as string[];
      const kept: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(section)) {
        if (owned.includes(k)) kept[k] = v;
        else dropped.push(`kinds.${kind}.${k}`);
      }
      const clean = stripPlotRefs(kept as Partial<Plot>);
      if (Object.keys(clean).length) kinds[kind as PlotKind] = clean;
    }
  }
  const preset: UserPreset = {
    id: `up_${now.toString(36)}_${random()}`, // never the file's
    name: freeName(name, existingNames),
    style: stripPlotRefs(style as Partial<Plot>),
    palette,
    ...(shapes.length ? { shapes } : {}),
    ...(Object.keys(kinds).length ? { kinds } : {}),
    createdAt: now,
  };
  return { ok: true, preset, dropped };
}

// ---- the two bridge calls (the desktop app only; the browser preview says so) ----------------

export type ExportPresetResult = { ok: true; path: string } | { ok: false; canceled?: boolean; error?: string };
export type ImportPresetsResult =
  | { ok: true; added: string[]; skipped: { file: string; reason: string }[]; dropped: string[] }
  | { ok: false; canceled?: boolean; error?: string };

const bridge = (): typeof window.mady | undefined => (typeof window !== "undefined" ? window.mady : undefined);

/** Write one preset to a file of the user's choosing. */
export async function exportPresetFile(p: UserPreset): Promise<ExportPresetResult> {
  const g = bridge();
  if (!g?.exportFile) return { ok: false, error: "Export needs the desktop app." };
  const res = await g.exportFile({ format: "json", suggestedName: presetFileName(p), text: serialisePreset(p) });
  return res.ok ? { ok: true, path: res.path } : { ok: false, ...(res.canceled ? { canceled: true } : {}), ...(res.error ? { error: res.error } : {}) };
}

/**
 * Pick preset files and add each one that parses. Adds through `insertUserPreset`, which
 * refuses at the cap rather than evicting; a refused or unreadable file is reported by name.
 */
export async function importPresetFiles(): Promise<ImportPresetsResult> {
  const g = bridge();
  if (!g?.presetImport) return { ok: false, error: "Import needs the desktop app." };
  const res = await g.presetImport();
  if (!res.ok) return res;
  const added: string[] = [];
  const skipped: { file: string; reason: string }[] = [];
  const dropped: string[] = [];
  const names = new Set(listUserPresets().map((p) => p.name));
  for (const f of res.files) {
    if (!("text" in f)) { skipped.push({ file: f.name, reason: f.error }); continue; }
    const parsed = parsePresetFile(f.text, names);
    if (!parsed.ok) { skipped.push({ file: f.name, reason: parsed.error }); continue; }
    const ins = insertUserPreset(parsed.preset);
    if (!ins.ok) { skipped.push({ file: f.name, reason: ins.reason }); continue; }
    names.add(parsed.preset.name);
    added.push(parsed.preset.name);
    dropped.push(...parsed.dropped.map((d) => `${f.name}: ${d}`));
  }
  return { ok: true, added, skipped, dropped };
}

/** One sentence for the panel's message line. */
export function importSummary(r: ImportPresetsResult): string {
  if (!r.ok) return r.canceled ? "" : `Import failed: ${r.error ?? "unknown error"}`;
  const parts: string[] = [];
  if (r.added.length) parts.push(`Imported ${r.added.map((n) => `"${n}"`).join(", ")}.`);
  for (const s of r.skipped) parts.push(`Skipped ${s.file}: ${s.reason}.`);
  if (r.dropped.length) parts.push(`Left out ${r.dropped.length} setting${r.dropped.length === 1 ? "" : "s"} this MadY does not know.`);
  return parts.join(" ") || "Nothing imported.";
}
