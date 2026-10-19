// @vitest-environment node
/**
 * The demo project is there to look around in: closing it, or a crash while exploring it,
 * must not ask to save or offer to recover it. Anything the user made that is not demo
 * material still counts as their work and is protected as usual.
 */
import { describe, expect, it } from "vitest";
import { createSampleDocument, DEMO_FOLDER } from "@mady/core";
import type { MadyDocument } from "@mady/core";
import { galleryItems } from "./gallery";
import { GALLERY_EXPERIMENT, hasOwnWork, isDemoOnlySnapshot } from "./demoSession";

const fresh = (): { doc: MadyDocument; demoTables: Set<string> } => {
  const doc = createSampleDocument();
  return { doc, demoTables: new Set(doc.toJSON().tables.map((t) => t.id)) };
};
const demoFolder = (doc: MadyDocument) => doc.toJSON().workspace.folders.find((f) => f.name === DEMO_FOLDER)!;

describe("hasOwnWork — what in the launch document is the user's own", () => {
  it("the untouched demo holds none", () => {
    const { doc, demoTables } = fresh();
    expect(hasOwnWork(doc.toJSON(), demoTables)).toBe(false);
  });

  it("editing demo data or restyling a demo graph is still exploring", () => {
    const { doc, demoTables } = fresh();
    const p = doc.toJSON();
    const t = p.tables[0]!;
    doc.setCell(t.id, t.rows[0]!.id, t.columns[1]!.id, 999);
    doc.setPlotOptions(p.plots[0]!.id, { name: "Renamed" });
    expect(hasOwnWork(doc.toJSON(), demoTables)).toBe(false);
  });

  it("a gallery card opened into the demo's Gallery experiment is still exploring", () => {
    const { doc, demoTables } = fresh();
    const card = galleryItems()[0]!;
    const made = doc.insertGraph(card.table, card.plot, card.title);
    const folder = demoFolder(doc);
    const exp = folder.experiments.find((e) => e.name === GALLERY_EXPERIMENT) ?? doc.addExperiment(folder.id, GALLERY_EXPERIMENT);
    const target = { level: "experiment", folderId: folder.id, experimentId: exp.id } as const;
    doc.fileObject({ kind: "table", id: made.table.id }, target);
    doc.fileObject({ kind: "plot", id: made.plot.id }, target);
    expect(hasOwnWork(doc.toJSON(), demoTables)).toBe(false);
  });

  it("a new datasheet is the user's work, wherever it is filed", () => {
    const { doc, demoTables } = fresh();
    doc.addTable("My data", "xy", ["X", "Y"]);
    expect(hasOwnWork(doc.toJSON(), demoTables), "unfiled").toBe(true);

    const two = fresh();
    const t = two.doc.addTable("My data", "xy", ["X", "Y"]);
    const folder = demoFolder(two.doc);
    two.doc.fileObject({ kind: "table", id: t.id }, { level: "experiment", folderId: folder.id, experimentId: folder.experiments[0]!.id });
    expect(hasOwnWork(two.doc.toJSON(), two.demoTables), "filed inside the demo folder").toBe(true);
  });

  it("anything in a project of the user's own is their work", () => {
    const { doc, demoTables } = fresh();
    const folder = doc.addFolder("Project 2");
    const t = doc.addTable("Mine", "xy", ["X", "Y"]);
    doc.fileObject({ kind: "table", id: t.id }, { level: "folder", folderId: folder.id });
    expect(hasOwnWork(doc.toJSON(), demoTables)).toBe(true);
  });

  it("a figure the user assembled outside the demo is their work", () => {
    const { doc, demoTables } = fresh();
    const plot = doc.toJSON().plots[0]!;
    const lay = doc.addLayout("Figure 1");
    doc.addLayoutPanel(lay.id, plot.id);
    expect(hasOwnWork(doc.toJSON(), demoTables)).toBe(true);
  });
});

describe("isDemoOnlySnapshot — a crash copy that holds only the demo is not offered back", () => {
  it("a copy of the untouched demo, from a launch of its own, is demo only", () => {
    const { demoTables } = fresh();
    const copy = JSON.stringify(createSampleDocument().toJSON());
    expect(isDemoOnlySnapshot(copy, demoTables)).toBe(true);
  });

  it("a copy of the demo with edited data is demo only", () => {
    const { doc, demoTables } = fresh();
    const t = doc.toJSON().tables[0]!;
    doc.setCell(t.id, t.rows[0]!.id, t.columns[1]!.id, 999);
    expect(isDemoOnlySnapshot(JSON.stringify(doc.toJSON()), demoTables)).toBe(true);
  });

  it("a copy holding a datasheet of the user's own is offered", () => {
    const { doc, demoTables } = fresh();
    doc.addTable("My data", "xy", ["X", "Y"]);
    expect(isDemoOnlySnapshot(JSON.stringify(doc.toJSON()), demoTables)).toBe(false);
  });

  it("a copy that cannot be read is offered, never thrown away unseen", () => {
    const { demoTables } = fresh();
    expect(isDemoOnlySnapshot("not json", demoTables)).toBe(false);
  });
});
