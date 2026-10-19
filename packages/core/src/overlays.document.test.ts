// A plot that borrows a series from another datasheet depends on it:
//  • an edit to the other sheet marks the plot stale, exactly as an edit to its own sheet does
//    (a graph that ignores an edit to data it draws would show out-of-date values);
//  • deleting the other sheet strips the overlays that referenced it — the plot survives (it is
//    still a valid graph of its own sheet), one undoable command with the deletion.
import { describe, expect, it } from "vitest";
import { MadyDocument } from "./document";

function setup() {
  const doc = new MadyDocument();
  const a = doc.addTable("Measured", "xy", ["X", "Y"]);
  const b = doc.addTable("Model", "xy", ["X", "Fit"]);
  const plot = doc.addPlot("P", a.id);
  doc.setPlotOptions(plot.id, { overlays: [{ id: "o1", table: b.id, column: b.columns[1]!.id }] });
  doc.setPlotOptions(plot.id, { status: "ok" });
  return { doc, a, b, plot };
}

describe("overlays — document dependencies", () => {
  it("an edit to the borrowed sheet marks the plot stale (and an edit to an unrelated sheet does not)", () => {
    const { doc, b, plot } = setup();
    const c = doc.addTable("Unrelated", "xy", ["X", "Y"]);
    const cRow = doc.addRow(c.id, [1, 1]);
    const bRow = doc.addRow(b.id, [1, 1]);
    doc.setPlotOptions(plot.id, { status: "ok" });
    expect(doc.toJSON().plots.find((p) => p.id === plot.id)!.status ?? "ok").toBe("ok");
    doc.setCell(c.id, cRow.id, c.columns[1]!.id, 5);
    expect(doc.toJSON().plots.find((p) => p.id === plot.id)!.status ?? "ok").toBe("ok");
    doc.setCell(b.id, bRow.id, b.columns[1]!.id, 42);
    expect(doc.toJSON().plots.find((p) => p.id === plot.id)!.status).toBe("stale");
  });

  it("deleting the borrowed sheet strips the overlay; the plot survives; undo restores both", () => {
    const { doc, a, b, plot } = setup();
    doc.removeTable(b.id);
    const after = doc.toJSON();
    expect(after.tables.map((t) => t.id)).toEqual([a.id]);
    const p = after.plots.find((x) => x.id === plot.id);
    expect(p, "the plot must survive — it is still a valid graph of its own sheet").toBeDefined();
    expect(p!.overlays ?? []).toEqual([]);
    doc.commands.undo();
    const back = doc.toJSON();
    expect(back.tables.map((t) => t.id)).toEqual([a.id, b.id]);
    expect(back.plots.find((x) => x.id === plot.id)!.overlays).toEqual([{ id: "o1", table: b.id, column: b.columns[1]!.id }]);
  });

  it("deleting the plot's own sheet cascades the plot away", () => {
    const { doc, a, plot } = setup();
    doc.removeTable(a.id);
    expect(doc.toJSON().plots.some((x) => x.id === plot.id)).toBe(false);
  });
});
