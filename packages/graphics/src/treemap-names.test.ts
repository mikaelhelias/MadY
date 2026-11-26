import { describe, expect, it } from "vitest";
import type { DataTable, Plot } from "@mady/core";
import { buildPlotScene, isNamesNotDrawnWarning } from "./buildScene.js";

// A treemap cell's name is the one thing that says what the cell is. It tries smaller sizes (never below the
// readable floor) before it is dropped, and a name that is still dropped is named in a warning.

const rows: [string, number, string][] = [
  ["Laptops", 41, "Hardware"], ["Phones", 66, "Hardware"], ["Tablets", 18, "Hardware"], ["Wearables", 9, "Hardware"],
  ["Cloud", 52, "Services"], ["Support", 21, "Services"], ["Training", 7, "Services"],
  ["Apps", 29, "Software"], ["OS licences", 24, "Software"], ["Games", 12, "Software"],
];
const table: DataTable = {
  id: "t", kind: "partsofwhole", name: "Revenue",
  columns: [{ id: "p", name: "Product", role: "x" }, { id: "v", name: "Revenue", role: "y" }, { id: "d", name: "Division", role: "x" }],
  rows: rows.map(([p, v, d], i) => ({ id: `r${i}`, cells: { p, v, d } })),
};
const plot = (treemap: Plot["treemap"] = {}): Plot => ({
  id: "p", name: "P", source: "t", status: "ok", styleOverrides: {}, kind: "treemap",
  treemap: { groupColumn: "d", showValues: true, showGroupLabels: true, ...treemap },
});
const measure = (t: string, px: number): number => t.length * px * 0.6;
const build = (tm?: Plot["treemap"], size = { width: 700, height: 480 }) => buildPlotScene(table, plot(tm), { ...size, measure });
const names = (s: ReturnType<typeof build>): Map<string, string> => new Map(s.treemap!.cells.map((c) => [c.id, c.label]));
const droppedWarning = (s: ReturnType<typeof build>): string | undefined => s.warnings.find((w) => /not drawn/.test(w) && /cell/.test(w));

describe("treemap cell names", () => {
  it("a name that does not fit at the asked size is drawn smaller where it still reads, not dropped", () => {
    const asked = 26;
    const s = build({ labelSize: asked });
    const cells = s.treemap!.cells;
    const shrunk = cells.filter((c) => c.label !== "" && c.labelSize < asked * 0.55 - 0.01);
    // Drawn only at the asked size, six of this fixture's ten cells would show a number and no name.
    expect(cells.filter((c) => c.label === "").length).toBeLessThan(6);
    expect(shrunk.length, "the fixture must need a smaller size somewhere").toBeGreaterThan(0);
  });

  it("never draws a name where it would not read in a figure panel", () => {
    // A treemap in a panel is shown at ~70%, and text there must read at 8 px: 11.4 px for a name alone, and 13.4 px
    // when its value (drawn at 0.85 of the name's size) stays with it.
    for (const c of build({ labelSize: 26 }).treemap!.cells) {
      if (c.label !== "") expect(c.labelSize, c.label).toBeGreaterThanOrEqual(8 / 0.7 - 0.01);
      if (c.label !== "" && c.valueLabel !== "") expect(c.labelSize, `${c.label} with its value`).toBeGreaterThanOrEqual(8 / 0.7 / 0.85 - 0.01);
    }
  });

  it("a name that cannot fit even at the floor is dropped, and named in a warning", () => {
    const s = build({ labelSize: 26 }, { width: 260, height: 220 });
    const dropped = [...names(s)].filter(([, l]) => l === "");
    expect(dropped.length, "the fixture must drop a name").toBeGreaterThan(0);
    const w = droppedWarning(s);
    expect(w, `warnings: ${JSON.stringify(s.warnings)}`).toBeDefined();
    const byId = new Map(rows.map((r, i) => [`r${i}`, r[0]]));
    for (const [id] of dropped) expect(w).toContain(`"${byId.get(id)}"`);
    expect(w).toMatch(/^\d+ cell names? (is|are) not drawn/);
  });

  it("names that all fit raise no warning and keep the size the cell would have had", () => {
    const s = build({ labelSize: 12 }, { width: 900, height: 700 });
    expect(droppedWarning(s)).toBeUndefined();
    expect([...names(s).values()].every((l) => l !== "")).toBe(true);
  });

  it("a region heading that cannot be placed anywhere is named in a warning", () => {
    const s = build({ labelSize: 26 }, { width: 150, height: 130 });
    const heads = s.treemap!.groupLabels ?? [];
    expect(heads.some((g) => g.text === ""), "the fixture must lose a heading").toBe(true);
    const w = s.warnings.find((x) => /region names? (is|are) not drawn/.test(x));
    expect(w, `warnings: ${JSON.stringify(s.warnings)}`).toBeDefined();
    expect(w).toMatch(/"(Hardware|Services|Software)"/);
  });

  it("both warnings are recognised as size-dependent, and an unrelated one is not", () => {
    const names = build({ labelSize: 26 }, { width: 260, height: 220 }).warnings.find((w) => /cell names? (is|are) not drawn/.test(w))!;
    const heads = build({ labelSize: 26 }, { width: 150, height: 130 }).warnings.find((w) => /region names? (is|are) not drawn/.test(w))!;
    expect(isNamesNotDrawnWarning(names)).toBe(true);
    expect(isNamesNotDrawnWarning(heads)).toBe(true);
    expect(isNamesNotDrawnWarning("No survival curves to plot.")).toBe(false);
  });

  it("Show labels off is the user's choice: nothing to report", () => {
    const s = build({ labelSize: 26, showLabels: false }, { width: 260, height: 220 });
    expect(droppedWarning(s)).toBeUndefined();
  });
});
