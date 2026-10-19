/**
 * A preset can carry marker opacity (the "transparent points" look, points at 0.7 opacity).
 * The "Universal design" preset carries it.
 * Written only when the preset defines it: a preset without one must leave a hand-set opacity
 * alone (the shape-cycle rule), or every other preset would reset it on apply.
 */
import { describe, expect, it } from "vitest";
import { MadyDocument, STYLE_PRESETS, findPreset } from "@mady/core";
import type { DataTable, Plot, Project, StylePreset } from "@mady/core";
import { applyPresetWithKindDefaults } from "./seedStyle";

const table: DataTable = {
  id: "t", kind: "xy", name: "T",
  columns: [{ id: "x", name: "X", role: "x" }, { id: "a", name: "A", role: "y" }, { id: "b", name: "B", role: "y" }],
  rows: [{ id: "r0", cells: { x: 1, a: 2, b: 3 } }, { id: "r1", cells: { x: 2, a: 3, b: 4 } }],
};
function apply(plot: Plot, preset: StylePreset): Plot {
  const project: Project = { schemaVersion: 4, tables: [table], plots: [plot], analyses: [], log: [], workspace: { folders: [], loose: [] } };
  const doc = new MadyDocument(project);
  applyPresetWithKindDefaults(doc, plot.id, "xy", preset);
  return doc.toJSON().plots[0]!;
}
const base = (): Plot => ({ id: "p", name: "P", kind: "xy", source: "t", status: "ok", styleOverrides: {} });

describe("a preset can carry marker opacity", () => {
  it("Universal design gives every series a marker opacity of 0.7", () => {
    const out = apply(base(), findPreset("Universal design")!);
    expect(out.seriesStyles?.a?.symbolOpacity).toBe(0.7);
    expect(out.seriesStyles?.b?.symbolOpacity).toBe(0.7);
  });
  it("a preset without one leaves a hand-set opacity alone", () => {
    const plot = { ...base(), seriesStyles: { a: { symbolOpacity: 0.4 } } };
    const out = apply(plot, findPreset("MadY default")!);
    expect(out.seriesStyles?.a?.symbolOpacity).toBe(0.4);
  });
  it("only Universal design carries it (no other built-in changes unannounced)", () => {
    const carriers = STYLE_PRESETS.filter((p) => p.symbolOpacity !== undefined).map((p) => p.name);
    expect(carriers).toEqual(["Universal design"]);
  });
});
