/**
 * Custom user presets — the user saves a graph's full look as a named, reusable
 * style and (a) applies it to any graph with one click, and (b) can set it as the
 * **MadY default** for every newly created graph (see `profile.ts`).
 *
 * A custom preset sits in the same "Style preset" list as the built-in
 * `STYLE_PRESETS` (core/presets.ts) but is user-authored and machine-local. It is
 * captured as a kind-agnostic `Partial<Plot>` (the `SHARED_KEYS` look — sizes,
 * fonts incl. family/bold/italic, axis styles, grid, frame, legend) plus an
 * ordered series-colour palette, so applying it reproduces the source look
 * (typography + axes + colours) even on a different chart type.
 *
 * This reuses the template capture machinery (`capturePlotStyle`/`SHARED_KEYS`)
 * and is applied via `MadyDocument.applyUserPreset`. Persists per-machine in
 * localStorage, mirroring `templates.ts` and `profile.ts`.
 */
import type { Plot, PlotKind, SymbolShape } from "@mady/core";
import { dGet, dSet } from "./durableStore";

export interface UserPreset {
  /** Stable id (the key the profile/default references). */
  id: string;
  /** Display name shown on the preset card. */
  name: string;
  /** Captured kind-agnostic presentation (a partial Plot, the SHARED_KEYS subset). */
  style: Partial<Plot>;
  /** Ordered series colours sampled from the source graph (for colour-faithful application). */
  palette: string[];
  /**
   * Ordered series marker shapes sampled the same way — so a look that separated its series by
   * shape as well as colour reproduces both, and survives greyscale printing.
   *
   * Note: optional because presets saved before this field existed have none. Applying one of
   * those must leave the target's own shapes alone, not reset them to circles.
   */
  shapes?: SymbolShape[];
  /**
   * Per-type sections: a graph type's own settings (bar width, the pie labels, the heatmap
   * block — `KIND_STYLE_KEYS` in presetKeys.ts), saved from a graph of that type with the
   * "Include this graph type's own settings" box ticked, or added later from another graph.
   * Applied only on a graph of the same type, after the kind house defaults, so what the
   * section says wins and what it does not say comes from the house.
   *
   * Note: optional; presets saved before sections existed have none and apply with the shared
   * look only.
   */
  kinds?: Partial<Record<PlotKind, Partial<Plot>>> | undefined;
  /** Creation timestamp (newest-first ordering until the user orders the list by hand). */
  createdAt: number;
  /**
   * The user's own order, written by `reorderUserPresets` (a drag, or ↑/↓ on the handle).
   * Absent until the list has been ordered once; a preset without one lists after the ordered
   * ones, newest first — so ordering, once begun, is never silently undone by a new save.
   */
  sortIndex?: number | undefined;
}

/** The graph types a preset carries a section for, in a stable order. */
export function presetKinds(p: Pick<UserPreset, "kinds">): PlotKind[] {
  return (Object.keys(p.kinds ?? {}) as PlotKind[]).filter((k) => p.kinds?.[k] !== undefined).sort();
}

const KEY = "mady.userPresets.v1";
const MAX = 60; // the list scrolls fine at this size

function readAll(): UserPreset[] {
  try {
    const raw = dGet(KEY);
    return raw ? (JSON.parse(raw) as UserPreset[]) : [];
  } catch {
    return [];
  }
}

function writeAll(list: UserPreset[]): void {
  // dSet mirrors to the durable userData file so custom presets survive a
  // localStorage wipe / the dev↔packaged origin split (see durableStore).
  dSet(KEY, JSON.stringify(list));
}

/** All custom presets: the user's order first (see `sortIndex`), then newest-first. */
export function listUserPresets(): UserPreset[] {
  return sortPresets(readAll());
}

function sortPresets(all: readonly UserPreset[]): UserPreset[] {
  return all.slice().sort((a, b) => {
    const ai = a.sortIndex ?? Number.POSITIVE_INFINITY;
    const bi = b.sortIndex ?? Number.POSITIVE_INFINITY;
    if (ai !== bi) return ai - bi;
    return b.createdAt - a.createdAt;
  });
}

/** Look up one custom preset by id. */
export function findUserPreset(id: string): UserPreset | undefined {
  return readAll().find((p) => p.id === id);
}

/**
 * Save (or overwrite by name) a custom preset. Returns the stored record. Caps the
 * collection at `MAX` (drops the oldest). Overwriting a name keeps its id so any
 * profile-default reference to it stays valid; it replaces the shared look, palette and
 * shapes, and merges the per-type sections — the types already saved stay, the type being
 * saved is replaced — so a preset can be extended one graph type at a time.
 */
export function saveUserPreset(
  name: string,
  style: Partial<Plot>,
  palette: string[],
  shapes?: SymbolShape[],
  kinds?: Partial<Record<PlotKind, Partial<Plot>>>,
): UserPreset {
  const all = readAll();
  const existing = all.find((p) => p.name === name);
  const merged = { ...(existing?.kinds ?? {}), ...(kinds ?? {}) };
  const rec: UserPreset = {
    id: existing?.id ?? `up_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    name,
    style,
    palette,
    ...(shapes && shapes.length ? { shapes } : {}),
    ...(Object.keys(merged).length ? { kinds: merged } : {}),
    createdAt: Date.now(),
    ...(existing?.sortIndex !== undefined ? { sortIndex: existing.sortIndex } : {}), // an ordered preset keeps its slot
  };
  const others = all.filter((p) => p.id !== rec.id);
  const kept = [rec, ...others].sort((a, b) => b.createdAt - a.createdAt).slice(0, MAX);
  writeAll(kept);
  return rec;
}

/**
 * Write one graph type's section into an existing preset ("Add this graph's type" on a preset
 * card). Everything else on the record — the shared look, palette, shapes, the other types'
 * sections, the timestamp — stays as it is. Throws on an unknown id: a silent no-op here would
 * look like a save that happened.
 */
export function setUserPresetKind(id: string, kind: PlotKind, section: Partial<Plot>): UserPreset {
  const all = readAll();
  const cur = all.find((p) => p.id === id);
  if (!cur) throw new Error(`setUserPresetKind: no preset with id ${id}`);
  const next: UserPreset = { ...cur, kinds: { ...(cur.kinds ?? {}), [kind]: section } };
  writeAll(all.map((p) => (p.id === id ? next : p)));
  return next;
}

/**
 * Add a whole record (an imported preset, a migrated template). Unlike `saveUserPreset` it
 * never evicts: at the cap it refuses and says so, because dropping someone's oldest preset to
 * make room for an import is not a trade they asked for. The caller has already given the
 * record a fresh id and a name that does not clash.
 */
export function insertUserPreset(rec: UserPreset): { ok: true } | { ok: false; reason: string } {
  const all = readAll();
  if (all.some((p) => p.id === rec.id)) return { ok: false, reason: `a preset with id ${rec.id} already exists` };
  if (all.length >= MAX) return { ok: false, reason: `the preset list is full (${MAX}); delete one first` };
  writeAll([rec, ...all]);
  return { ok: true };
}

/** The most presets the store keeps. */
export const MAX_USER_PRESETS = MAX;

/** Remove a custom preset by id. */
export function deleteUserPreset(id: string): void {
  writeAll(readAll().filter((p) => p.id !== id));
}

/** Rename a custom preset (keeps its id + style). */
export function renameUserPreset(id: string, name: string): void {
  writeAll(readAll().map((p) => (p.id === id ? { ...p, name } : p)));
}

/** "Name copy", then "Name copy 2", … — the first that no preset has. */
function copyName(name: string, taken: readonly string[]): string {
  const base = `${name} copy`;
  if (!taken.includes(base)) return base;
  for (let i = 2; ; i++) {
    const cand = `${base} ${i}`;
    if (!taken.includes(cand)) return cand;
  }
}

/**
 * Duplicate a preset: the same look, palette, shapes and sections under a fresh id and a
 * "… copy" name, placed right after the original. At the cap it refuses and says so — like
 * `insertUserPreset`, a copy must never evict someone's oldest preset. Throws on an unknown id.
 */
export function duplicateUserPreset(id: string): { ok: true; preset: UserPreset } | { ok: false; reason: string } {
  const all = readAll();
  const src = all.find((p) => p.id === id);
  if (!src) throw new Error(`duplicateUserPreset: no preset with id ${id}`);
  if (all.length >= MAX) return { ok: false, reason: `the preset list is full (${MAX}); delete one first` };
  const copy: UserPreset = {
    ...JSON.parse(JSON.stringify(src)) as UserPreset,
    id: `up_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    name: copyName(src.name, all.map((p) => p.name)),
    createdAt: Date.now(),
  };
  // Materialise the order so the copy sits right after its original, whatever came before.
  const ordered = sortPresets(all);
  const at = ordered.findIndex((p) => p.id === id);
  const next = [...ordered.slice(0, at + 1), copy, ...ordered.slice(at + 1)].map((p, i) => ({ ...p, sortIndex: i }));
  writeAll(next);
  return { ok: true, preset: next[at + 1]! };
}

/**
 * Drop one graph type's section from a preset (the remove button on its pill). The shared look,
 * palette, shapes and the other sections stay. Throws on an unknown id or a type the preset has
 * no section for — a remove button that removed nothing would look like it worked.
 */
export function removeUserPresetKind(id: string, kind: PlotKind): UserPreset {
  const all = readAll();
  const cur = all.find((p) => p.id === id);
  if (!cur) throw new Error(`removeUserPresetKind: no preset with id ${id}`);
  if (!cur.kinds || cur.kinds[kind] === undefined) throw new Error(`removeUserPresetKind: "${cur.name}" has no ${kind} section`);
  const rest = { ...cur.kinds };
  delete rest[kind];
  const next: UserPreset = { ...cur };
  if (Object.keys(rest).length) next.kinds = rest;
  else delete next.kinds;
  writeAll(all.map((p) => (p.id === id ? next : p)));
  return next;
}

/**
 * The user's order, first to last. Every id named gets its position; a stored preset the list
 * does not name (a save that raced the drag) keeps its place after them. An id the store does
 * not hold throws — the caller's list is stale, and writing it would lose that preset's slot.
 */
export function reorderUserPresets(ids: readonly string[]): void {
  const all = readAll();
  for (const id of ids) if (!all.some((p) => p.id === id)) throw new Error(`reorderUserPresets: no preset with id ${id}`);
  const named = ids.map((id) => all.find((p) => p.id === id)!);
  const rest = sortPresets(all.filter((p) => !ids.includes(p.id)));
  writeAll([...named, ...rest].map((p, i) => ({ ...p, sortIndex: i })));
}
