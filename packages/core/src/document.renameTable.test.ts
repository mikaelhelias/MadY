import { describe, expect, it } from "vitest";
import { MadyDocument } from "./document";

describe("MadyDocument.renameTable", () => {
  it("renames a datasheet, trimmed, in one undoable step", () => {
    const d = new MadyDocument();
    const t = d.addTable("Column", "column", ["A", "B"]);
    d.renameTable(t.id, "  Oximeter readings  ");
    expect(d.toJSON().tables[0]!.name).toBe("Oximeter readings");
    d.commands.undo();
    expect(d.toJSON().tables[0]!.name).toBe("Column");
    d.commands.redo();
    expect(d.toJSON().tables[0]!.name).toBe("Oximeter readings");
  });

  it("refuses a blank name and an unknown sheet instead of doing nothing", () => {
    const d = new MadyDocument();
    const t = d.addTable("Column", "column", ["A", "B"]);
    expect(() => d.renameTable(t.id, "   ")).toThrow(/needs a name/);
    expect(() => d.renameTable("nope", "x")).toThrow();
    expect(d.toJSON().tables[0]!.name).toBe("Column");
  });

  it("graphs and analyses of the sheet keep pointing at it", () => {
    const d = new MadyDocument();
    const t = d.addTable("Column", "column", ["A", "B"]);
    const p = d.addPlot("G", t.id);
    d.renameTable(t.id, "Renamed");
    expect(d.toJSON().plots.find((x) => x.id === p.id)!.source).toBe(t.id);
  });
});
