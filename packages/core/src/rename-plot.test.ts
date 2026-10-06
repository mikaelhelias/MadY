/**
 * Renaming a graph — `MadyDocument.renamePlot`.
 *
 * Guards against a graph that cannot be renamed at all: the navigator renames folders and
 * experiments, and this is the command that writes `plot.name` after creation. It matters on the
 * page: a graph with no title of its own draws its name as the title.
 */
import { describe, expect, it } from "vitest";
import { MadyDocument } from "./document";
import type { Plot, Project } from "./model";

const project = (): Project => ({
  schemaVersion: 4,
  tables: [{ id: "t", kind: "column", name: "T", columns: [{ id: "a", name: "A", role: "y" }], rows: [] }],
  plots: [{ id: "p", name: "Graph 1", source: "t", status: "ok", styleOverrides: {}, kind: "bar" } as Plot],
  analyses: [], log: [], workspace: { folders: [], loose: [] },
});

describe("renamePlot", () => {
  it("renames the graph, trimmed", () => {
    const doc = new MadyDocument(project());
    doc.renamePlot("p", "  Dose response  ");
    expect(doc.toJSON().plots[0]!.name).toBe("Dose response");
  });

  it("is one undoable step", () => {
    const doc = new MadyDocument(project());
    doc.renamePlot("p", "Dose response");
    doc.commands.undo();
    expect(doc.toJSON().plots[0]!.name).toBe("Graph 1");
    doc.commands.redo();
    expect(doc.toJSON().plots[0]!.name).toBe("Dose response");
  });

  it("refuses an unknown graph out loud, never a silent no-op", () => {
    const doc = new MadyDocument(project());
    expect(() => doc.renamePlot("nope", "X")).toThrow(/plot nope not found/);
  });

  it("refuses a blank name - a graph always has one", () => {
    const doc = new MadyDocument(project());
    expect(() => doc.renamePlot("p", "   ")).toThrow(/needs a name/);
    expect(doc.toJSON().plots[0]!.name).toBe("Graph 1");
  });
});
