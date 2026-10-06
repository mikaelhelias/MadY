// @vitest-environment node
/**
 * The project's gradient registry — the document half of the colour editor.
 *
 * A gradient is a project-wide library like `methods`, NOT a workspace object: it is a
 * material a graph is made of, not something the Navigator lists. What must hold:
 * save/replace/delete are undoable, deleting something that is not there is a DEFECT rather
 * than a no-op, and the document can say which graphs still paint with one — because the
 * editor refuses to delete a gradient that is in use and has to name the graphs.
 */
import { describe, expect, it } from "vitest";
import { MadyDocument } from "./document";
import type { Gradient } from "./model";

const g = (id: string, name = "Mine"): Gradient => ({
  id, name, mode: "stops",
  stops: [{ pos: 0, color: "#ff0000" }, { pos: 1, color: "#0000ff" }],
});

describe("gradients in the document", () => {
  it("saves, replaces by id, and undoes", () => {
    const doc = new MadyDocument();
    doc.saveGradient(g("a", "First"));
    expect(doc.toJSON().gradients?.map((x) => x.name)).toEqual(["First"]);
    doc.saveGradient(g("a", "Renamed"));
    expect(doc.toJSON().gradients?.map((x) => x.name)).toEqual(["Renamed"]);
    doc.commands.undo();
    expect(doc.toJSON().gradients?.map((x) => x.name)).toEqual(["First"]);
    doc.commands.undo();
    expect(doc.toJSON().gradients).toBeUndefined(); // back to a project with no registry at all
  });

  it("keeps two gradients apart", () => {
    const doc = new MadyDocument();
    doc.saveGradient(g("a", "A"));
    doc.saveGradient(g("b", "B"));
    expect(doc.toJSON().gradients?.map((x) => x.id)).toEqual(["a", "b"]);
  });

  it("deletes, and undoes the delete", () => {
    const doc = new MadyDocument();
    doc.saveGradient(g("a"));
    doc.removeGradient("a");
    expect(doc.toJSON().gradients).toBeUndefined();
    doc.commands.undo();
    expect(doc.toJSON().gradients?.map((x) => x.id)).toEqual(["a"]);
  });

  it("deleting a gradient that is not there THROWS — the editor only ever passes an id it read", () => {
    const doc = new MadyDocument();
    expect(() => doc.removeGradient("ghost")).toThrow(/gradient/i);
  });

  it("mints distinct ids", () => {
    const doc = new MadyDocument();
    expect(doc.nextGradientId()).not.toBe(doc.nextGradientId());
  });

  describe("plotsUsingGradient — every ramp field that can hold a custom:<id>", () => {
    const setup = () => {
      const doc = new MadyDocument();
      const t = doc.addTable("T", "xy", ["X", "Y"]);
      doc.saveGradient(g("a"));
      return { doc, t };
    };

    it("finds none when nothing uses it", () => {
      const { doc } = setup();
      expect(doc.plotsUsingGradient("a")).toEqual([]);
    });

    for (const [what, patch] of [
      ["a heatmap's colormap", { heatmap: { colormap: "custom:a" } }],
      ["parallel coordinates", { parallel: { colorRamp: "custom:a" } }],
      ["timeline tracks", { tracks: { colormap: "custom:a" } }],
      ["a ridgeline spectrum", { ridgeline: { spectrumMap: "custom:a" } }],
      ["a graduated series fill", { seriesStyles: { y: { fillType: "graduated", gradRamp: "custom:a" } } }],
      ["colour-by-a-column", { seriesStyles: { y: { colorFromRamp: "custom:a" } } }],
      ["ONE point's override", { pointStyles: { "y:r1": { gradRamp: "custom:a" } } }],
    ] as [string, object][]) {
      it(`finds ${what}`, () => {
        const { doc, t } = setup();
        const p = doc.addPlot("Fig 1", t.id);
        doc.setPlotOptions(p.id, patch as never);
        expect(doc.plotsUsingGradient("a").map((x) => x.name)).toEqual(["Fig 1"]);
        // …and does not confuse it with a different gradient
        expect(doc.plotsUsingGradient("b")).toEqual([]);
      });
    }
  });
});
