/**
 * Dock-layout model — the shell's three columns (Navigator · the document canvas ·
 * Inspector) are **resizable, collapsible, and rearrangeable**, and arrangements
 * can be saved as **named layout presets**. One serializable layout object drives
 * the `.main` grid; pure helpers here so reordering/persistence are unit-tested
 * (mirrors `toolbar.ts`).
 */
export type DockId = "navigator" | "document" | "inspector";
export type SideDockId = "navigator" | "inspector";

export interface DockLayout {
  /** Left→right column order (a permutation including "document", which flexes). */
  order: DockId[];
  /** Side-dock widths in px ("document" always flexes to fill the rest). */
  sizes: Record<SideDockId, number>;
  /** Collapsed side docks render as a thin rail. */
  collapsed: Record<SideDockId, boolean>;
  /** The bottom log drawer collapsed (hidden). */
  logCollapsed: boolean;
}

export const SIDE_DOCKS: SideDockId[] = ["navigator", "inspector"];
export const DOCK_TITLE: Record<SideDockId, string> = {
  navigator: "Project",
  inspector: "Inspector",
};

export const MIN_DOCK_WIDTH = 140;
export const MAX_DOCK_WIDTH = 560;
/** Width of a collapsed dock's rail. */
export const RAIL_WIDTH = 30;

export const DEFAULT_LAYOUT: DockLayout = {
  order: ["navigator", "document", "inspector"],
  // The Inspector defaults to 300px so long control values (e.g. "Value-graduated",
  // "Tukey (1.5·IQR)", palette names) show in full instead of ellipsis-clipping.
  sizes: { navigator: 216, inspector: 300 },
  // Inspector starts collapsed — there is nothing to format until something is selected,
  // and selecting a graph element auto-expands it (see the `selection` effect in
  // AppShell.tsx). A per-dock collapse is a real user choice (see `loadLayout` below), so
  // this only reaches fresh installs — an existing "mady.layout" keeps whatever the
  // user already chose.
  collapsed: { navigator: false, inspector: true },
  // The log is a thing you go and look at when something surprised you, not a thing you
  // watch. Open by default it would spend a strip of every window on a pane nobody is reading.
  logCollapsed: true,
};

export interface LayoutPreset {
  name: string;
  layout: DockLayout;
  /** Built-ins can't be deleted. */
  builtin?: boolean;
}

export const BUILTIN_PRESETS: LayoutPreset[] = [
  { name: "Default", builtin: true, layout: DEFAULT_LAYOUT },
  {
    name: "Wide canvas",
    builtin: true,
    layout: { ...DEFAULT_LAYOUT, collapsed: { navigator: true, inspector: true } },
  },
  {
    name: "Analysis",
    builtin: true,
    layout: {
      order: ["navigator", "document", "inspector"],
      sizes: { navigator: 216, inspector: 300 },
      collapsed: { navigator: true, inspector: false },
      logCollapsed: true,
    },
  },
];

export const clampWidth = (px: number): number =>
  Math.max(MIN_DOCK_WIDTH, Math.min(MAX_DOCK_WIDTH, Math.round(px)));

/** Move `fromId` to sit just before `beforeId` in the column order. */
export function reorderDocks(order: DockId[], fromId: DockId, beforeId: DockId): DockId[] {
  if (fromId === beforeId || !order.includes(fromId) || !order.includes(beforeId)) return order;
  const without = order.filter((d) => d !== fromId);
  const at = without.indexOf(beforeId);
  return [...without.slice(0, at), fromId, ...without.slice(at)];
}

/** Apply a preset → a fresh current layout (deep copy so edits don't mutate the preset). */
export function applyPreset(preset: LayoutPreset): DockLayout {
  return JSON.parse(JSON.stringify(preset.layout)) as DockLayout;
}

const ALL_IDS: DockId[] = ["navigator", "document", "inspector"];

/** Reconcile a parsed/saved layout against the schema; fall back to default on anything invalid. */
export function applySaved(saved: unknown): DockLayout {
  if (!saved || typeof saved !== "object") return clone(DEFAULT_LAYOUT);
  const s = saved as Partial<DockLayout>;
  const order = Array.isArray(s.order)
    ? (s.order.filter((d): d is DockId => ALL_IDS.includes(d as DockId)))
    : [];
  // The order must contain exactly the three ids once each; else use the default order.
  const validOrder = ALL_IDS.every((id) => order.filter((o) => o === id).length === 1)
    ? (order as DockId[])
    : [...DEFAULT_LAYOUT.order];
  return {
    order: validOrder,
    sizes: {
      navigator: clampWidth(Number(s.sizes?.navigator) || DEFAULT_LAYOUT.sizes.navigator),
      inspector: clampWidth(Number(s.sizes?.inspector) || DEFAULT_LAYOUT.sizes.inspector),
    },
    collapsed: {
      navigator: Boolean(s.collapsed?.navigator),
      inspector: Boolean(s.collapsed?.inspector),
    },
    logCollapsed: Boolean(s.logCollapsed),
  };
}

const clone = (l: DockLayout): DockLayout => JSON.parse(JSON.stringify(l)) as DockLayout;

// --- persistence (app-level localStorage) --------------------------------
const LAYOUT_KEY = "mady.layout";
const PRESETS_KEY = "mady.layouts";

/**
 * Stamp on the saved layout, bumped when a change to `DEFAULT_LAYOUT` should reach people
 * who already have a layout on disk.
 *
 * The layout is written back on every drag and every toggle, so within a session or two
 * everyone has a stored copy of whatever the defaults were when they first ran the app.
 * That copy records the old default as if it were a decision (e.g. the log drawer open
 * only because it was never closed). Without this, changing a default only ever reaches
 * new installs.
 *
 * Note: only fields listed in `MIGRATED_DEFAULTS` are taken back; sizes, order and the
 * per-dock collapse state are real choices and are never overwritten. Applied in
 * `loadLayout` only — a saved *preset* is deliberate by definition, so `applySaved` (which
 * presets also go through) stays pure.
 */
const LAYOUT_DEFAULTS_VERSION = 1;
const MIGRATED_DEFAULTS = ["logCollapsed"] as const;

/**
 * One-time repair of a stored layout.
 *
 * The Docs tab collapses both side docks as a render-time override, never a write. A stored
 * layout can still hold that override as `collapsed: {navigator: true, inspector: true}`,
 * which is indistinguishable from someone having collapsed both panels on purpose; the
 * Inspector would then not come back on leaving the Docs tab. This clears that state once.
 *
 * Deliberately not folded into `MIGRATED_DEFAULTS`: that list means "a default changed and
 * should reach existing users", and `collapsed` is a real choice that a default change must
 * never overwrite. Its guard stays exactly as strict. This is a different claim — "specific
 * stored state must be cleared, once" — so it gets its own key and its own expiry.
 */
const COLLAPSE_REPAIR_KEY = "mady.layout.repair.collapse-2026-08-05";

export function loadLayout(): DockLayout {
  try {
    const raw = globalThis.localStorage?.getItem(LAYOUT_KEY);
    if (!raw) return clone(DEFAULT_LAYOUT);
    const parsed = JSON.parse(raw) as (Partial<DockLayout> & { v?: number }) | null;
    const layout = applySaved(parsed);
    if (!parsed || parsed.v !== LAYOUT_DEFAULTS_VERSION)
      for (const key of MIGRATED_DEFAULTS) layout[key] = DEFAULT_LAYOUT[key];
    if (!globalThis.localStorage?.getItem(COLLAPSE_REPAIR_KEY)) {
      layout.collapsed = { ...DEFAULT_LAYOUT.collapsed };
      try {
        globalThis.localStorage?.setItem(COLLAPSE_REPAIR_KEY, "1");
      } catch {
        /* storage unavailable — the repair simply runs again next launch */
      }
    }
    return layout;
  } catch {
    return clone(DEFAULT_LAYOUT);
  }
}

export function saveLayout(layout: DockLayout): void {
  try {
    globalThis.localStorage?.setItem(LAYOUT_KEY, JSON.stringify({ ...layout, v: LAYOUT_DEFAULTS_VERSION }));
  } catch {
    /* storage unavailable — ignore */
  }
}

/** User-saved presets (built-ins are code-defined and prepended by the UI). */
export function loadUserPresets(): LayoutPreset[] {
  try {
    const raw = globalThis.localStorage?.getItem(PRESETS_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw) as unknown;
    if (!Array.isArray(arr)) return [];
    return arr
      .filter((p): p is { name: string; layout: unknown } => !!p && typeof (p as LayoutPreset).name === "string")
      .map((p) => ({ name: p.name, layout: applySaved(p.layout) }));
  } catch {
    return [];
  }
}

function saveUserPresets(presets: LayoutPreset[]): void {
  try {
    globalThis.localStorage?.setItem(PRESETS_KEY, JSON.stringify(presets.map((p) => ({ name: p.name, layout: p.layout }))));
  } catch {
    /* ignore */
  }
}

/** Add (or overwrite by name) a user preset; returns the new user-preset list. */
export function addPreset(existing: LayoutPreset[], name: string, layout: DockLayout): LayoutPreset[] {
  const trimmed = name.trim();
  if (!trimmed) return existing;
  const next = [...existing.filter((p) => p.name !== trimmed), { name: trimmed, layout: clone(layout) }];
  saveUserPresets(next);
  return next;
}

/** Delete a user preset by name; returns the new list. */
export function deletePreset(existing: LayoutPreset[], name: string): LayoutPreset[] {
  const next = existing.filter((p) => p.name !== name);
  saveUserPresets(next);
  return next;
}
