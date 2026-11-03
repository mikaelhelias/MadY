// @vitest-environment jsdom
// Starter cards that make the composite graphs discoverable in the gallery, not just reachable:
// "Bars + line (2nd axis)", "Histogram + density" and "Two sheets, one graph".
// Each card is built from existing options and data only. A card carries `seriesStyles`, and
// `insertGraph` remaps their keys to the fresh column ids.
import { describe, expect, it } from "vitest";
import { buildPlotScene } from "@mady/graphics";
import { MadyDocument } from "@mady/core";
import type { DataTable, Plot } from "@mady/core";
import { galleryItems, galleryLookup } from "./gallery";

const SIZE = { width: 640, height: 460 };
const card = (key: string) => galleryItems().find((g) => g.key === key);

describe("gallery composite starter cards", () => {
  it("'Bars + line (2nd axis)': a bar chart whose rate series draws as a line on the right axis", () => {
    const c = card("barline");
    expect(c, "no gallery card keyed 'barline'").toBeDefined();
    expect(c!.plot.kind).toBe("bar");
    expect(c!.plot.source).toBe(c!.table.id);
    const scene = buildPlotScene(c!.table as DataTable, c!.plot as Plot, SIZE);
    expect(scene.y2, "the card must show a real second value axis").toBeDefined();
    const lines = scene.series.filter((s) => s.overlayLine);
    expect(lines).toHaveLength(1);
    expect(lines[0]!.marks.every((m) => m.bar === undefined)).toBe(true);
    expect(scene.series.filter((s) => s.marks.some((m) => m.bar)).length).toBeGreaterThan(0);
    expect(scene.warnings).toEqual([]);
  });

  it("'Histogram + density': the density curve is on, the bars stay", () => {
    const c = card("histdensity");
    expect(c, "no gallery card keyed 'histdensity'").toBeDefined();
    expect(c!.plot.kind).toBe("histogram");
    expect(c!.plot.source).toBe(c!.table.id);
    const scene = buildPlotScene(c!.table as DataTable, c!.plot as Plot, SIZE);
    const curves = (scene as unknown as { distributionCurves?: { label: string }[] }).distributionCurves ?? [];
    expect(curves.map((k) => k.label)).toContain("density");
    expect(scene.series[0]!.marks.filter((m) => m.bar).length).toBeGreaterThan(2);
    expect(scene.warnings).toEqual([]);
  });

  it("brackets over bars + a Y2 line: the graph makes room by widening both value axes, not by asking the user", () => {
    // The line on Y2 keeps its ink at the plot top when only the left axis widens, so a
    // two-bracket stack could never fit unless Y2 widens too.
    const c = card("barline")!;
    const plain = buildPlotScene(c.table as DataTable, c.plot as Plot, SIZE);
    const withBrackets: Plot = {
      ...(c.plot as Plot),
      annotations: [
        { id: "sig-0", kind: "bracket", from: 1, to: 2, p: 0.01, label: "*", role: "significance" },
        { id: "sig-1", kind: "bracket", from: 1, to: 3, p: 0.005, label: "**", role: "significance" },
      ] as Plot["annotations"],
    };
    const scene = buildPlotScene(c.table as DataTable, withBrackets, SIZE);
    expect(scene.annotations.filter((a) => String(a.id).startsWith("sig-"))).toHaveLength(2);
    expect(scene.warnings.filter((w) => /could not be placed clear/.test(w))).toEqual([]);
    expect(scene.y2!.domain[1]).toBeGreaterThan(plain.y2!.domain[1]);
  });

  it("'Two sheets, one graph': the card ships a second sheet, draws the borrowed curve, and inserts both sheets with remapped references", () => {
    const c = card("twosheets");
    expect(c, "no gallery card keyed 'twosheets'").toBeDefined();
    expect(c!.extraTables).toHaveLength(1);
    expect(c!.plot.overlays).toHaveLength(1);
    // the card draws its promise: two series, the borrowed one marked with its sheet
    const scene = buildPlotScene(c!.table as DataTable, c!.plot as Plot, { ...SIZE, tables: galleryLookup(c!) });
    expect(scene.series).toHaveLength(2);
    const borrowed = scene.series.find((s) => s.from)!;
    expect(borrowed.from!.name).toBe(c!.extraTables![0]!.name);
    expect(borrowed.marks.filter((m) => Number.isFinite(m.cy)).length).toBeGreaterThan(10);
    expect(scene.warnings).toEqual([]);
    // inserting the card inserts both sheets; the overlay points at the new second sheet + its new column
    const doc = new MadyDocument();
    const before = doc.toJSON().tables.length;
    const { table, plot } = doc.insertGraph(c!.table as DataTable, c!.plot as Plot, "Two sheets", c!.extraTables);
    const after = doc.toJSON();
    expect(after.tables.length).toBe(before + 2);
    const ov = plot.overlays![0]!;
    const second = after.tables.find((t) => t.id === ov.table);
    expect(second, "the overlay must reference the inserted second sheet").toBeDefined();
    expect(second!.id).not.toBe(table.id);
    expect(second!.columns.some((col) => col.id === ov.column)).toBe(true);
    expect(Object.keys(plot.seriesStyles ?? {})).toContain(ov.column); // the curve's look followed the remap
    const live = buildPlotScene(table, plot, { ...SIZE, tables: (id) => after.tables.find((t) => t.id === id) });
    expect(live.series.filter((s) => s.from)).toHaveLength(1);
    doc.commands.undo();
    expect(doc.toJSON().tables.length).toBe(before);
  });

  it("the composite survives insertion into a project: the line series keeps plotAs + axis on its new column id", () => {
    const c = card("barline")!;
    const doc = new MadyDocument();
    const { table, plot } = doc.insertGraph(c.table as DataTable, c.plot as Plot, "Bars + line");
    const styled = Object.entries(plot.seriesStyles ?? {}).filter(([, s]) => s.plotAs === "line" && s.axis === "y2");
    expect(styled).toHaveLength(1);
    expect(table.columns.some((col) => col.id === styled[0]![0]), "the style key must be a column of the inserted table").toBe(true);
    const scene = buildPlotScene(table, plot, SIZE);
    expect(scene.y2).toBeDefined();
    expect(scene.series.some((s) => s.overlayLine)).toBe(true);
  });
});
