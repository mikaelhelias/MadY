/**
 * Toolbar layout model — the toolbar is organised into named groups (File · Edit ·
 * Data · Analyze · Graph), each a small caption over a row of icons. Group membership
 * is fixed (an icon has one home group); the user can reorder the groups and reorder
 * icons within a group (drag). Stored as an ordered list of groups, each an ordered
 * id list; button *definitions* (icon/handler/disabled) live in `chrome.tsx`, keyed by
 * id, because they can't be serialized. Pure helpers here so reorder + persistence are
 * unit-tested. The nav arrows and the Assistant chip are fixed chrome, outside this model.
 */
export type ToolbarItemId =
  | "open"
  | "save"
  | "import"
  | "export"
  | "new-dataset"
  | "duplicate-data"
  | "new-project"
  | "analyze"
  | "design"
  | "magic"
  | "undo"
  | "redo";

export type ToolbarGroupName = "File" | "Edit" | "Data" | "Analyze" | "Graph";

export interface ToolbarGroup {
  name: ToolbarGroupName;
  ids: ToolbarItemId[];
}

/**
 * Default layout: File → Edit → Data → Analyze → Graph.
 * `export` sits in File as well as above each graph/sheet. It is greyed out while nothing
 * in front can be exported (`canExport`).
 */
export const DEFAULT_TOOLBAR_GROUPS: ToolbarGroup[] = [
  { name: "File", ids: ["new-project", "open", "save", "export"] },
  { name: "Edit", ids: ["undo", "redo"] },
  { name: "Data", ids: ["import", "new-dataset", "duplicate-data"] },
  { name: "Analyze", ids: ["analyze"] },
  { name: "Graph", ids: ["design", "magic"] },
];

/**
 * Fixed membership: which group each id belongs to. An id can only ever appear in its
 * home group, so a reordered/saved layout can never smuggle a button into the wrong
 * group.
 */
export const HOME_GROUP: Record<ToolbarItemId, ToolbarGroupName> = {
  "new-project": "File",
  open: "File",
  save: "File",
  export: "File",
  undo: "Edit",
  redo: "Edit",
  import: "Data",
  "new-dataset": "Data",
  "duplicate-data": "Data",
  analyze: "Analyze",
  design: "Graph",
  magic: "Graph",
};

const clone = (groups: ToolbarGroup[]): ToolbarGroup[] => groups.map((g) => ({ name: g.name, ids: g.ids.slice() }));

/** Move a whole group to sit at `toIndex` in the group order. */
export function reorderGroups(groups: ToolbarGroup[], name: ToolbarGroupName, toIndex: number): ToolbarGroup[] {
  const from = groups.findIndex((g) => g.name === name);
  if (from < 0) return groups;
  const next = groups.slice();
  const [moved] = next.splice(from, 1);
  const insertAt = from < toIndex ? toIndex - 1 : toIndex; // removing the source shifts later indices left
  next.splice(Math.max(0, Math.min(next.length, insertAt)), 0, moved!);
  return next;
}

/** Move an icon within its group to sit at `toIndex`. Cross-group moves are impossible by design. */
export function reorderWithinGroup(
  groups: ToolbarGroup[],
  name: ToolbarGroupName,
  fromId: ToolbarItemId,
  toIndex: number,
): ToolbarGroup[] {
  return groups.map((g) => {
    if (g.name !== name) return g;
    const from = g.ids.indexOf(fromId);
    if (from < 0) return g;
    const ids = g.ids.slice();
    const [moved] = ids.splice(from, 1);
    const insertAt = from < toIndex ? toIndex - 1 : toIndex;
    ids.splice(Math.max(0, Math.min(ids.length, insertAt)), 0, moved!);
    return { name: g.name, ids };
  });
}

/**
 * Reconcile a saved layout against the current defaults: keep saved groups whose name is
 * a known default, and within each keep only ids that belong to that group's home (fixed
 * membership) — dropping unknown/duplicate/mis-homed ids. Then append any missing default
 * groups (in default order) and any missing default ids to their home group, so a newly
 * added button always appears. Invalid/empty saved input falls back to the defaults.
 */
export function applySavedGroups(defaults: ToolbarGroup[], saved: unknown): ToolbarGroup[] {
  if (!Array.isArray(saved)) return clone(defaults);
  const knownNames = new Set(defaults.map((g) => g.name));
  const seenIds = new Set<ToolbarItemId>();
  const out: ToolbarGroup[] = [];
  for (const g of saved) {
    if (!g || typeof g !== "object") continue;
    const name = (g as { name?: unknown }).name as ToolbarGroupName;
    if (!knownNames.has(name) || out.some((o) => o.name === name)) continue; // unknown or duplicate group
    const rawIds = Array.isArray((g as { ids?: unknown }).ids) ? ((g as { ids: unknown[] }).ids) : [];
    const ids: ToolbarItemId[] = [];
    for (const id of rawIds) {
      if (
        typeof id === "string" &&
        (id as ToolbarItemId) in HOME_GROUP &&
        HOME_GROUP[id as ToolbarItemId] === name &&
        !seenIds.has(id as ToolbarItemId)
      ) {
        ids.push(id as ToolbarItemId);
        seenIds.add(id as ToolbarItemId);
      }
    }
    out.push({ name, ids });
  }
  if (out.length === 0) return clone(defaults);
  // Append any missing default groups (in default order) and any missing default ids to their group.
  for (const dg of defaults) {
    let g = out.find((o) => o.name === dg.name);
    if (!g) {
      g = { name: dg.name, ids: [] };
      out.push(g);
    }
    for (const id of dg.ids) {
      if (!seenIds.has(id)) {
        g.ids.push(id);
        seenIds.add(id);
      }
    }
  }
  return out;
}

// The layout is stored under a v2 key. A layout saved under `mady.toolbar` (a flat entry list)
// cannot be mapped onto groups, so it is ignored and the toolbar starts from the default order.
const STORAGE_KEY = "mady.toolbar.v2";

/** Load the persisted layout (reconciled against defaults), or the default. */
export function loadToolbarGroups(): ToolbarGroup[] {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    return raw ? applySavedGroups(DEFAULT_TOOLBAR_GROUPS, JSON.parse(raw)) : clone(DEFAULT_TOOLBAR_GROUPS);
  } catch {
    return clone(DEFAULT_TOOLBAR_GROUPS);
  }
}

/** Persist a layout (best-effort). */
export function saveToolbarGroups(groups: ToolbarGroup[]): void {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(groups));
  } catch {
    /* storage unavailable (e.g. preview) — ignore */
  }
}

/** Clear the persisted layout (Reset toolbar). */
export function clearToolbarGroups(): void {
  try {
    globalThis.localStorage?.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}
