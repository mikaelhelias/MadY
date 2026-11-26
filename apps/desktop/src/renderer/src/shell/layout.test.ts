// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  addPreset,
  applyPreset,
  applySaved,
  BUILTIN_PRESETS,
  clampWidth,
  DEFAULT_LAYOUT,
  deletePreset,
  loadLayout,
  MAX_DOCK_WIDTH,
  MIN_DOCK_WIDTH,
  reorderDocks,
  saveLayout,
} from "./layout";

describe("reorderDocks", () => {
  it("moves a dock before another (rearrange)", () => {
    // move inspector to the front → inspector | navigator | document
    expect(reorderDocks(DEFAULT_LAYOUT.order, "inspector", "navigator")).toEqual([
      "inspector",
      "navigator",
      "document",
    ]);
  });

  it("can put both side docks on one side", () => {
    // move inspector before document → navigator | inspector | document (canvas at the edge)
    expect(reorderDocks(DEFAULT_LAYOUT.order, "inspector", "document")).toEqual([
      "navigator",
      "inspector",
      "document",
    ]);
  });

  it("is a no-op for same id or unknown id", () => {
    expect(reorderDocks(DEFAULT_LAYOUT.order, "navigator", "navigator")).toEqual(DEFAULT_LAYOUT.order);
    // @ts-expect-error testing an unknown id
    expect(reorderDocks(DEFAULT_LAYOUT.order, "bogus", "document")).toEqual(DEFAULT_LAYOUT.order);
  });
});

describe("clampWidth", () => {
  it("bounds to [MIN, MAX] and rounds", () => {
    expect(clampWidth(10)).toBe(MIN_DOCK_WIDTH);
    expect(clampWidth(9999)).toBe(MAX_DOCK_WIDTH);
    expect(clampWidth(200.6)).toBe(201);
  });
});

describe("applyPreset", () => {
  it("returns a deep copy (editing it never mutates the preset)", () => {
    const wide = BUILTIN_PRESETS.find((p) => p.name === "Wide canvas")!;
    const live = applyPreset(wide);
    expect(live.collapsed).toEqual({ navigator: true, inspector: true });
    live.collapsed.navigator = false;
    expect(wide.layout.collapsed.navigator).toBe(true); // preset untouched
  });
});

describe("applySaved", () => {
  it("falls back to default for invalid input", () => {
    expect(applySaved(null)).toEqual(DEFAULT_LAYOUT);
    expect(applySaved("garbage")).toEqual(DEFAULT_LAYOUT);
  });

  it("repairs a bad order and clamps sizes", () => {
    const repaired = applySaved({
      order: ["navigator", "navigator"], // invalid (missing ids, dupe)
      sizes: { navigator: 9999, inspector: 5 },
      collapsed: { navigator: true, inspector: false },
      logCollapsed: true,
    });
    expect(repaired.order).toEqual(DEFAULT_LAYOUT.order);
    expect(repaired.sizes.navigator).toBe(MAX_DOCK_WIDTH);
    expect(repaired.sizes.inspector).toBe(MIN_DOCK_WIDTH);
    expect(repaired.collapsed.navigator).toBe(true);
    expect(repaired.logCollapsed).toBe(true);
  });

  it("keeps a valid custom order", () => {
    const r = applySaved({ ...DEFAULT_LAYOUT, order: ["inspector", "document", "navigator"] });
    expect(r.order).toEqual(["inspector", "document", "navigator"]);
  });
});

describe("addPreset / deletePreset", () => {
  it("adds, overwrites by name, and deletes", () => {
    let presets = addPreset([], "Mine", DEFAULT_LAYOUT);
    expect(presets.map((p) => p.name)).toEqual(["Mine"]);
    // overwrite by same name (no dupe)
    presets = addPreset(presets, "Mine", { ...DEFAULT_LAYOUT, logCollapsed: true });
    expect(presets).toHaveLength(1);
    expect(presets[0]!.layout.logCollapsed).toBe(true);
    // blank name ignored
    expect(addPreset(presets, "  ", DEFAULT_LAYOUT)).toHaveLength(1);
    // delete
    expect(deletePreset(presets, "Mine")).toHaveLength(0);
  });
});

/**
 * The log drawer starts collapsed, and that reaches users who already have a stored layout.
 *
 * The layout is written back on every drag and toggle, so a stored copy of an earlier default
 * exists on any machine that has run the app twice. The migration lets a changed default
 * reach those users, not only a fresh install.
 */
describe("default-layout migration", () => {
  const store = new Map<string, string>();
  beforeEach(() => {
    store.clear();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("starts the log drawer collapsed", () => {
    expect(DEFAULT_LAYOUT.logCollapsed).toBe(true);
    // …and no built-in preset quietly re-opens it.
    for (const p of BUILTIN_PRESETS)
      expect(p.layout.logCollapsed, `the "${p.name}" preset re-opens the log drawer`).toBe(true);
  });

  it("takes the current default over an unstamped stored layout", () => {
    store.set("mady.layout", JSON.stringify({ ...DEFAULT_LAYOUT, logCollapsed: false }));
    expect(loadLayout().logCollapsed, "an unstamped saved layout kept the earlier default").toBe(true);
  });

  it("respects the user's own choice once the layout has been stamped", () => {
    // They opened the drawer themselves and it was saved. That is a decision — leave it.
    saveLayout({ ...DEFAULT_LAYOUT, logCollapsed: false });
    expect(loadLayout().logCollapsed, "the migration overwrote a deliberate choice").toBe(false);
  });

  it("migrates only the listed fields — sizes, order and dock collapse are real choices", () => {
    const mine = {
      order: ["inspector", "document", "navigator"],
      sizes: { navigator: 300, inspector: 180 },
      collapsed: { navigator: true, inspector: false },
      logCollapsed: false,
    };
    store.set("mady.layout", JSON.stringify(mine));
    // Mark the one-time collapse repair as already done, so this stays a test of the
    // migration and not of that repair.
    store.set("mady.layout.repair.collapse-2026-08-05", "1");
    const got = loadLayout();
    expect(got.logCollapsed, "the migrated field did not change").toBe(true);
    expect(got.order, "the migration clobbered the column order").toEqual(mine.order);
    expect(got.sizes, "the migration clobbered the dock widths").toEqual(mine.sizes);
    expect(got.collapsed, "the migration clobbered the collapsed docks").toEqual(mine.collapsed);
  });

  it("leaves saved presets alone — a preset is deliberate by definition", () => {
    // Presets go through `applySaved`, not `loadLayout`, precisely so this holds.
    expect(applySaved({ ...DEFAULT_LAYOUT, logCollapsed: false }).logCollapsed).toBe(false);
  });
});

/**
 * The one-time repair of a stored layout (see `COLLAPSE_REPAIR_KEY` in layout.ts).
 *
 * A stored layout can hold both side docks as collapsed. That reads exactly like a
 * deliberate choice, so it cannot be detected — only undone, once.
 */
describe("one-time repair of both docks stored as collapsed", () => {
  const REPAIR = "mady.layout.repair.collapse-2026-08-05";
  const store = new Map<string, string>();
  beforeEach(() => {
    store.clear();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  const savedWithBothCollapsed = (): void => {
    saveLayout({ ...DEFAULT_LAYOUT, collapsed: { navigator: true, inspector: true } });
  };

  it("re-opens docks saved as both collapsed, and records that it has run", () => {
    savedWithBothCollapsed();
    expect(store.get(REPAIR), "the repair should not be marked before it runs").toBeUndefined();
    expect(loadLayout().collapsed, "the docks stayed collapsed").toEqual(DEFAULT_LAYOUT.collapsed);
    expect(store.get(REPAIR), "the repair did not record itself — it would run forever").toBe("1");
  });

  it("runs once — a later deliberate collapse is left alone", () => {
    savedWithBothCollapsed();
    loadLayout(); // repair fires here
    // Then the user collapses the Inspector and it is saved.
    saveLayout({ ...DEFAULT_LAYOUT, collapsed: { navigator: false, inspector: true } });
    expect(loadLayout().collapsed.inspector, "the repair re-ran and undid a real choice").toBe(true);
  });

  it("does not disturb anything else on the way past", () => {
    saveLayout({
      order: ["inspector", "document", "navigator"],
      sizes: { navigator: 300, inspector: 180 },
      collapsed: { navigator: true, inspector: true },
      logCollapsed: false,
    });
    const got = loadLayout();
    expect(got.order).toEqual(["inspector", "document", "navigator"]);
    expect(got.sizes).toEqual({ navigator: 300, inspector: 180 });
    expect(got.logCollapsed, "the repair should not touch the log drawer").toBe(false);
  });

  it("hands back a copy of the default, never the shared object", () => {
    // `DEFAULT_LAYOUT` is a module-level constant; handing out its inner object would let the
    // next collapse mutate the default for the rest of the session.
    savedWithBothCollapsed();
    const got = loadLayout();
    expect(got.collapsed).not.toBe(DEFAULT_LAYOUT.collapsed);
    got.collapsed.navigator = true;
    expect(DEFAULT_LAYOUT.collapsed.navigator, "loadLayout leaked the shared default").toBe(false);
  });
});
