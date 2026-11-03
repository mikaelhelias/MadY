// @vitest-environment jsdom
/**
 * The count waffle's caption, the WHOLE path: the document stores what the
 * figure's drag and in-place edit send, undoably, and the rebuilt drawing shows it. A figure
 * test alone cannot prove the app writes the field — this drives the document the app uses.
 */
import { describe, expect, it } from "vitest";
import { MadyDocument } from "@mady/core";
import type { DataTable, Plot, Project } from "@mady/core";
import { buildPlotScene } from "@mady/graphics";
import { applyWaffleCaptionEdit, moveWaffleCaption } from "./AppShell";

const table: DataTable = {
  id: "t", kind: "partsofwhole", name: "PW",
  columns: [{ id: "cat", name: "Category", role: "x" }, { id: "v", name: "Count" }],
  rows: [{ id: "rA", cells: { cat: "Alpha", v: 12 } }, { id: "rB", cells: { cat: "Beta", v: 8 } }],
};
const plot: Plot = { id: "p", name: "P", source: "t", status: "ok", styleOverrides: {}, kind: "pie", pieDisplay: "waffle", waffleUnit: "count" };
const doc = (): MadyDocument => new MadyDocument({ schemaVersion: 4, tables: [table], plots: [plot], analyses: [], log: [], workspace: { folders: [], loose: [] } } as Project);
const caption = (d: MadyDocument) => buildPlotScene(table, d.toJSON().plots[0]!, { width: 460, height: 380 }).pie!.caption!;

describe("count waffle caption — stored, undoable, redrawn", () => {
  it("a drag is stored as the caption's offset and moves the drawn caption; undo takes it back", () => {
    const d = doc();
    moveWaffleCaption(d, d.toJSON().plots[0]!, 18, -5);
    expect(d.toJSON().plots[0]!.waffleCaptionOffset).toEqual({ dx: 18, dy: -5 });
    expect(caption(d).offset).toEqual({ dx: 18, dy: -5 });
    d.commands.undo();
    expect(d.toJSON().plots[0]!.waffleCaptionOffset).toBeUndefined();
  });

  it("typed words replace the automatic caption; typing it empty brings the automatic one back", () => {
    const d = doc();
    expect(caption(d).text).toBe("1 square = 1 observation");
    applyWaffleCaptionEdit(d, d.toJSON().plots[0]!, "Each square: one mouse");
    expect(caption(d).text).toBe("Each square: one mouse");
    applyWaffleCaptionEdit(d, d.toJSON().plots[0]!, "  ");
    expect(d.toJSON().plots[0]!.waffleCaption).toBeUndefined();
    expect(caption(d).text).toBe("1 square = 1 observation");
    // Typing exactly the automatic words stores nothing: the caption keeps following the unit.
    applyWaffleCaptionEdit(d, d.toJSON().plots[0]!, "1 square = 1 observation");
    expect(d.toJSON().plots[0]!.waffleCaption).toBeUndefined();
  });
});
