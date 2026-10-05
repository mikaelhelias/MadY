// @vitest-environment jsdom
/**
 * Applying a user preset that carries a section for the graph's type.
 *
 * The order is shared look → kind house defaults → the type's section last. Why last, and
 * checked here: `applyKindHouseDefaults` floor-merges object values only — a scalar house value
 * such as the bar's width replaces what is there. A section applied before the house defaults
 * would have its bar width silently reset to the house 0.38; the first test is that fixture. Block
 * values merge over the house block, so a section that names only `colormap` keeps the house
 * cell gap. A preset with no section applies byte-for-byte the same as one without sections.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { KIND_HOUSE_DEFAULTS, MadyDocument, applyKindHouseDefaults, findPreset, tableDatasets } from "@mady/core";
import type { Plot } from "@mady/core";
import { setKindDefault, setProfileDefault } from "./profile";
import { applyUserPresetWithKindDefaults, seedPlotStyle } from "./seedStyle";
import { SHARED_KEYS } from "./templates";
import { saveUserPreset } from "./userPresets";

const style: Partial<Plot> = { frame: "box", fonts: { title: { size: 28 } } };

function fresh(kind: "bar" | "heatmap"): { doc: MadyDocument; id: string } {
  const doc = new MadyDocument();
  const table = doc.addTable("T", "column", ["Cat", "Y"]);
  const plot = doc.addPlot("P", table.id);
  doc.setPlotKind(plot.id, kind);
  return { doc, id: plot.id };
}

describe("applying a user preset with a section for the graph's type", () => {
  it("a bar section's width survives the house default (the scalar the floor would reset)", () => {
    const house = KIND_HOUSE_DEFAULTS.bar!.plot!.barWidth;
    expect(house, "the fixture needs a house bar width to fight").toBeDefined();
    const { doc, id } = fresh("bar");
    applyUserPresetWithKindDefaults(doc, id, "bar", { style, palette: [], kinds: { bar: { barWidth: 0.9 } } });
    expect(doc.toJSON().plots[0]!.barWidth).toBe(0.9);
    expect(doc.toJSON().plots[0]!.frame).toBe("box"); // the shared look landed too
  });

  it("a heatmap section merges over the house block instead of replacing it", () => {
    const { doc, id } = fresh("heatmap");
    applyUserPresetWithKindDefaults(doc, id, "heatmap", { style, palette: [], kinds: { heatmap: { heatmap: { colormap: "reds" } } } });
    const hm = doc.toJSON().plots[0]!.heatmap!;
    expect(hm.colormap).toBe("reds");
    for (const [k, v] of Object.entries(KIND_HOUSE_DEFAULTS.heatmap!.plot!.heatmap ?? {})) {
      if (k !== "colormap") expect((hm as Record<string, unknown>)[k], `house heatmap.${k} was lost`).toEqual(v);
    }
  });

  it("a section for another type is ignored on this one", () => {
    const { doc, id } = fresh("bar");
    applyUserPresetWithKindDefaults(doc, id, "bar", { style, palette: [], kinds: { pie: { pieDonut: 0.5 } } });
    expect(doc.toJSON().plots[0]!.pieDonut).toBeUndefined();
  });

  it("a preset with no sections gives exactly the preset followed by the house defaults", () => {
    const a = fresh("bar");
    applyUserPresetWithKindDefaults(a.doc, a.id, "bar", { style, palette: ["#123456"], shapes: ["square"] });
    const b = fresh("bar");
    b.doc.applyUserPreset(b.id, style, ["#123456"], SHARED_KEYS, ["square"]);
    applyKindHouseDefaults(b.doc, b.id, "bar", tableDatasets);
    expect(JSON.stringify(a.doc.toJSON().plots[0])).toBe(JSON.stringify(b.doc.toJSON().plots[0]));
  });
});

describe("a new graph whose per-type default is a user preset with a section", () => {
  beforeEach(() => localStorage.clear());

  it("comes out with that section on it", () => {
    setProfileDefault(null);
    const rec = saveUserPreset("Lab", style, [], undefined, { bar: { barWidth: 0.9 } });
    setKindDefault("bar", { kind: "user", id: rec.id });
    const { doc, id } = fresh("bar");
    seedPlotStyle(doc, id, "bar");
    const out = doc.toJSON().plots[0]!;
    expect(out.barWidth).toBe(0.9);
    expect(out.frame).toBe("box");
    // …and a built-in default seeds the built-in preset and the house bar width, with no user section.
    setKindDefault("bar", { kind: "builtin", name: "Scientific Journal" });
    const other = fresh("bar");
    seedPlotStyle(other.doc, other.id, "bar");
    expect(other.doc.toJSON().plots[0]!.xAxis?.lineWidth).toBe(findPreset("Scientific Journal")!.axisThickness);
    expect(other.doc.toJSON().plots[0]!.barWidth).toBe(KIND_HOUSE_DEFAULTS.bar!.plot!.barWidth);
  });
});
