// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { Project } from "@mady/core";
import { buildTabGroups, groupColorFor, tabSourceId } from "./DocumentArea";
import type { OpenTab } from "./AppShell";

// A minimal project: two datasheets; a graph + an analysis on t1, a graph on t2.
const project = {
  tables: [{ id: "t1", name: "Doses" }, { id: "t2", name: "Repeats" }],
  plots: [{ id: "p1", source: "t1" }, { id: "p2", source: "t2" }],
  analyses: [{ id: "a1", source: "t1" }],
} as unknown as Project;

const tab = (kind: OpenTab["kind"], id?: string): OpenTab => ({ key: id ? `${kind}:${id}` : kind, kind, ...(id ? { id } : {}) });

describe("tabSourceId", () => {
  it("resolves a tab to its source datasheet (table = itself; plot/analysis = .source)", () => {
    expect(tabSourceId(project, tab("table", "t1"))).toBe("t1");
    expect(tabSourceId(project, tab("plot", "p1"))).toBe("t1");
    expect(tabSourceId(project, tab("analysis", "a1"))).toBe("t1");
    expect(tabSourceId(project, tab("plot", "p2"))).toBe("t2");
    expect(tabSourceId(project, tab("welcome"))).toBeNull(); // singleton
    expect(tabSourceId(project, tab("gallery"))).toBeNull();
  });
});

describe("buildTabGroups", () => {
  it("groups tabs BY source datasheet, table→graphs→analyses within a group", () => {
    const groups = buildTabGroups(project, [
      tab("plot", "p1"), tab("analysis", "a1"), tab("table", "t1"), // deliberately out of order
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.label).toBe("Doses");
    expect(groups[0]!.tabs.map((t) => t.kind)).toEqual(["table", "plot", "analysis"]); // sorted
  });

  it("orders groups by the project's table order, sourceless tabs in a trailing 'Other'", () => {
    const groups = buildTabGroups(project, [
      tab("welcome"), tab("plot", "p2"), tab("plot", "p1"),
    ]);
    expect(groups.map((g) => g.label)).toEqual(["Doses", "Repeats", "Other"]);
    expect(groups.at(-1)!.sourceId).toBeNull();
    expect(groups.at(-1)!.tabs.map((t) => t.kind)).toEqual(["welcome"]);
  });

  it("never drops a tab whose source table was deleted — it falls into 'Other'", () => {
    const groups = buildTabGroups(project, [tab("plot", "pX")]); // pX not in project.plots → source null
    expect(groups).toHaveLength(1);
    expect(groups[0]!.label).toBe("Other");
    expect(groups[0]!.tabs).toHaveLength(1);
  });

  it("a datasheet with only its graph open still forms its own group (no table tab needed)", () => {
    const groups = buildTabGroups(project, [tab("plot", "p1")]);
    expect(groups.map((g) => g.label)).toEqual(["Doses"]);
    expect(groups[0]!.sourceId).toBe("t1");
  });

  it("tints each datasheet group (its own colour if set, else a stable derived one); Other = null", () => {
    const groups = buildTabGroups(project, [tab("table", "t1"), tab("plot", "p2"), tab("welcome")]);
    const byLabel = Object.fromEntries(groups.map((g) => [g.label, g.color] as const));
    expect(byLabel["Doses"]).toBeTruthy();
    expect(byLabel["Repeats"]).toBeTruthy();
    expect(byLabel["Doses"]).not.toBe(byLabel["Repeats"]); // distinct sheets read as distinct colours
    expect(byLabel["Other"]).toBeNull();
  });
});

describe("groupColorFor", () => {
  it("uses the datasheet's own navigator colour when set", () => {
    expect(groupColorFor({ id: "t1", color: "#123456" })).toBe("#123456");
  });
  it("derives a STABLE colour from the id when none is set (same id → same colour)", () => {
    const a = groupColorFor({ id: "tbl_abc" });
    expect(a).toMatch(/^#[0-9a-f]{6}$/i);
    expect(groupColorFor({ id: "tbl_abc" })).toBe(a); // deterministic
  });
});
