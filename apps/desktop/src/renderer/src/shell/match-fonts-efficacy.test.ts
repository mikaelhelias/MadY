/**
 * "Match → Fonts" in the panel assembler moves every kind's text.
 *
 * Match to panel A/B/C changes a graph's axis and legend fonts to match the other graphs on
 * every graph type, including those whose labels carry their own font (e.g. the heatmap), so
 * this test covers every gallery kind.
 *
 * The class it guards: text that reads a kind-own font carrier keeps it through
 * a generic `fonts` transfer — the heatmap's row/column labels (`heatmap.labelFont`,
 * stamped at creation), the network's node labels (`network.labelSize`), and any
 * per-axis `tickFont`/`titleFont` override (the pyramid's stamped 22px y-axis title).
 * `kindFontMatchPatch` (templates.ts) is the per-target translation the Match buttons
 * apply alongside `applyPlotTemplateMany`; this test drives that full path for
 * every gallery kind and fails by name on any text a match cannot move.
 */
import { describe, expect, it } from "vitest";
import { MadyDocument } from "@mady/core";
import type { Plot, Project } from "@mady/core";
import { buildPlotScene } from "@mady/graphics";
import { galleryItems } from "./gallery";
import { scenePaletteOpt } from "./scenePalette";
import { capturePlotStyle, kindFontMatchPatch, MATCH_KEYS } from "./templates";

const measure = (t: string, px: number): number => t.length * px * 0.6;
const SIZE = { width: 580, height: 380 };

/** Distinctive reference fonts — sizes that appear nowhere in the house defaults. */
const REF_FONTS: Plot["fonts"] = {
  title: { size: 33, family: "Georgia" }, subtitle: { size: 11, family: "Georgia" },
  axisTitle: { size: 31, family: "Georgia" }, tick: { size: 29, family: "Georgia" },
  legend: { size: 27, family: "Georgia" },
};

function sceneJson(table: Parameters<typeof buildPlotScene>[0], plot: Plot): string {
  return JSON.stringify(buildPlotScene(table, plot, { measure, ...SIZE, ...scenePaletteOpt(plot) }));
}

/** Drive the real match path: the generic fonts transfer + the per-kind patch. */
function matchFonts(doc: MadyDocument, targetId: string, applyKindPatch: boolean): void {
  const plots = doc.toJSON().plots;
  const ref = plots.find((p) => p.id === "ref")!;
  const target = plots.find((p) => p.id === targetId)!;
  doc.applyPlotTemplateMany([targetId], capturePlotStyle(ref, MATCH_KEYS.fonts, true), MATCH_KEYS.fonts);
  if (applyKindPatch) {
    const patch = kindFontMatchPatch(target, ref);
    if (patch) doc.setPlotOptions(targetId, patch);
  }
}

describe("match-fonts efficacy — the Match buttons move every kind's text", () => {
  const items = galleryItems();

  it("covers the whole gallery", () => {
    expect(items.length).toBeGreaterThan(30);
  });

  it("the fixture can show the failure (a bare fonts transfer leaves the heatmap labels stale)", () => {
    const item = items.find((i) => (i.plot.kind ?? "xy") === "heatmap")!;
    const project: Project = {
      schemaVersion: 4, tables: [item.table],
      plots: [JSON.parse(JSON.stringify(item.plot)) as Plot, { id: "ref", name: "ref", source: item.table.id, status: "ok", styleOverrides: {}, fonts: REF_FONTS } as Plot],
      analyses: [], log: [], workspace: { folders: [], loose: [] },
    };
    const doc = new MadyDocument(project);
    // The stamped house size, read before the transfer rather than asserted as a literal: the
    // house default can change while the guarded claim, "a bare fonts transfer cannot move the
    // kind-own carrier", stays the same.
    const stamped = item.plot.heatmap?.labelFont?.size;
    expect(stamped, "the gallery heatmap must stamp a labelFont for this fixture to exhibit anything").toBeGreaterThan(0);
    expect(Object.values(REF_FONTS ?? {}).map((f) => f?.size)).not.toContain(stamped); // else survival is unprovable
    matchFonts(doc, item.plot.id, false); // without the kind patch: the generic transfer alone
    const bare = doc.toJSON().plots.find((p) => p.id === item.plot.id)!;
    expect(bare.heatmap?.labelFont?.size, "without the patch the stamped size must survive — else this test guards nothing").toBe(stamped);
  });

  it.each(items.map((i) => [i.plot.kind ?? "xy", i] as const))("%s", (kind, item) => {
    const project: Project = {
      schemaVersion: 4, tables: [item.table],
      plots: [JSON.parse(JSON.stringify(item.plot)) as Plot, { id: "ref", name: "ref", source: item.table.id, status: "ok", styleOverrides: {}, fonts: REF_FONTS } as Plot],
      analyses: [], log: [], workspace: { folders: [], loose: [] },
    };
    const doc = new MadyDocument(project);
    const before = sceneJson(item.table, doc.toJSON().plots[0]!);
    matchFonts(doc, item.plot.id, true);
    const target = doc.toJSON().plots.find((p) => p.id === item.plot.id)!;
    const after = sceneJson(item.table, target);

    // The drawing moved, and the reference's fonts actually reached it.
    expect(after, "the fonts match changed nothing in the drawing").not.toBe(before);
    expect(after.includes("Georgia") || after.includes(":29") || after.includes(":31"), "no reference font size/family reached the drawing").toBe(true);
    // The known kind carriers rebased onto the reference:
    if (kind === "heatmap") expect(target.heatmap?.labelFont?.size, "heatmap row/col labels must follow the matched tick font").toBe(29);
    if (kind === "network") expect(target.network?.labelSize, "network node labels must follow the matched tick size").toBe(29);
    // …and no per-axis font override survives to beat the matched fonts (the pyramid's 22px).
    expect(target.xAxis?.titleFont ?? target.yAxis?.titleFont ?? undefined, "a stamped per-axis titleFont silently beats a fonts match").toBeUndefined();
  });
});
