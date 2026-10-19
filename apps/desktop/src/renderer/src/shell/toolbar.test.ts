// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  applySavedGroups,
  DEFAULT_TOOLBAR_GROUPS,
  reorderGroups,
  reorderWithinGroup,
} from "./toolbar";
import type { ToolbarGroup } from "./toolbar";

const names = (groups: ToolbarGroup[]): string[] => groups.map((g) => g.name);
const idsOf = (groups: ToolbarGroup[], name: string): string[] =>
  groups.find((g) => g.name === name)?.ids ?? [];

describe("reorderGroups", () => {
  it("moves a group to a new position", () => {
    const moved = reorderGroups(DEFAULT_TOOLBAR_GROUPS, "Graph", 0);
    expect(names(moved)[0]).toBe("Graph");
    // same set, no loss/dupe
    expect(new Set(names(moved))).toEqual(new Set(names(DEFAULT_TOOLBAR_GROUPS)));
    expect(moved.length).toBe(DEFAULT_TOOLBAR_GROUPS.length);
  });

  it("moves a group later (Edit after Data → index 3)", () => {
    // default: File Edit Data Analyze Graph
    const moved = reorderGroups(DEFAULT_TOOLBAR_GROUPS, "Edit", 3);
    // Edit lands after Data (the from<to shift): File Data Edit Analyze Graph
    expect(names(moved)).toEqual(["File", "Data", "Edit", "Analyze", "Graph"]);
  });

  it("is a no-op for an unknown group", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(reorderGroups(DEFAULT_TOOLBAR_GROUPS, "Nope" as any, 0)).toEqual(DEFAULT_TOOLBAR_GROUPS);
  });
});

describe("reorderWithinGroup", () => {
  it("moves an icon within its group", () => {
    // File: new-project, open, save, export → move save to front; nothing lost or duplicated
    const moved = reorderWithinGroup(DEFAULT_TOOLBAR_GROUPS, "File", "save", 0);
    expect(idsOf(moved, "File")[0]).toBe("save");
    expect([...idsOf(moved, "File")].sort()).toEqual([...idsOf(DEFAULT_TOOLBAR_GROUPS, "File")].sort());
    // other groups untouched
    expect(idsOf(moved, "Data")).toEqual(idsOf(DEFAULT_TOOLBAR_GROUPS, "Data"));
  });

  it("cannot move an icon into a group it doesn't belong to", () => {
    // asking Data to reorder `save` (a File id) is a no-op for Data
    const moved = reorderWithinGroup(DEFAULT_TOOLBAR_GROUPS, "Data", "save", 0);
    expect(idsOf(moved, "Data")).toEqual(idsOf(DEFAULT_TOOLBAR_GROUPS, "Data"));
  });
});

describe("applySavedGroups", () => {
  it("falls back to defaults for invalid input", () => {
    expect(applySavedGroups(DEFAULT_TOOLBAR_GROUPS, null)).toEqual(DEFAULT_TOOLBAR_GROUPS);
    expect(applySavedGroups(DEFAULT_TOOLBAR_GROUPS, "garbage")).toEqual(DEFAULT_TOOLBAR_GROUPS);
    // an array with no recognisable group → defaults
    expect(applySavedGroups(DEFAULT_TOOLBAR_GROUPS, [{ name: "Bogus", ids: [] }])).toEqual(DEFAULT_TOOLBAR_GROUPS);
  });

  it("honours a saved group order and drops unknown ids / mis-homed ids", () => {
    const saved: unknown = [
      { name: "Graph", ids: ["magic", "design", "bogus"] }, // reordered + an unknown id
      { name: "File", ids: ["save", "open", "new-project", "import"] }, // `import` is a Data id → dropped from File
      { name: "Ghost", ids: ["open"] }, // unknown group → dropped
    ];
    const out = applySavedGroups(DEFAULT_TOOLBAR_GROUPS, saved);
    // saved order first, then appended missing default groups in default order
    expect(names(out)).toEqual(["Graph", "File", "Edit", "Data", "Analyze"]);
    expect(idsOf(out, "Graph")).toEqual(["magic", "design"]); // bogus dropped, order kept
    // import (mis-homed) dropped; saved order kept; export (a default the saved layout lacks) appended after it
    expect(idsOf(out, "File")).toEqual(["save", "open", "new-project", "export"]);
    expect(idsOf(out, "Data")).toEqual(["import", "new-dataset", "duplicate-data"]); // appended intact
    // every default id present exactly once across all groups
    const all = out.flatMap((g) => g.ids);
    const defaultIds = DEFAULT_TOOLBAR_GROUPS.flatMap((g) => g.ids);
    expect(new Set(all)).toEqual(new Set(defaultIds));
    expect(all.length).toBe(defaultIds.length);
  });

  it("appends a default id missing from a saved layout to its home group", () => {
    // a saved layout whose Data group lacks the default `duplicate-data` button
    const saved: unknown = [
      { name: "Data", ids: ["import", "new-dataset"] },
    ];
    const out = applySavedGroups(DEFAULT_TOOLBAR_GROUPS, saved);
    expect(idsOf(out, "Data")).toContain("duplicate-data");
    // and it lands in Data, not anywhere else
    expect(out.filter((g) => g.ids.includes("duplicate-data")).map((g) => g.name)).toEqual(["Data"]);
  });

  // Export is on the top toolbar (as well as the graph's own ribbon); a layout saved without it must gain it
  // too, or users with a saved toolbar layout would never see it.
  it("Export is on the top toolbar, in File, and a saved layout without it gains it", () => {
    expect(idsOf(DEFAULT_TOOLBAR_GROUPS, "File")).toContain("export");
    const old: unknown = [{ name: "File", ids: ["new-project", "open", "save"] }];
    expect(idsOf(applySavedGroups(DEFAULT_TOOLBAR_GROUPS, old), "File")).toContain("export");
  });

  it("does not duplicate a saved id", () => {
    const saved: unknown = [{ name: "File", ids: ["open", "open", "save"] }];
    const out = applySavedGroups(DEFAULT_TOOLBAR_GROUPS, saved);
    expect(idsOf(out, "File").filter((x) => x === "open")).toHaveLength(1);
  });
});
