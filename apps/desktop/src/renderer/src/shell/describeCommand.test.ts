/**
 * `describeCommand` — an agent command in the words the popover shows after the model bar
 * applied it ("Graph kind → violin"). Plain words, the names not the ids, never raw JSON for
 * the ops people actually type, and a readable fallback for the rest.
 */
import { describe, expect, it } from "vitest";
import { describeCommand } from "./describeCommand";

const names = {
  tables: [{ id: "t1", name: "Dose" }],
  graphs: [{ id: "p1", name: "Dose response" }],
};

describe("describeCommand", () => {
  it("names the graph and table by name, never by id", () => {
    expect(describeCommand({ op: "setGraphKind", id: "p1", kind: "violin" }, names)).toBe("Dose response: graph kind → violin");
    expect(describeCommand({ op: "createGraph", name: "Bar — Dose", table: "t1", kind: "bar" }, names)).toBe("New bar graph “Bar — Dose” from Dose");
  });

  it("axis edits say which axis and what changed", () => {
    expect(describeCommand({ op: "setAxis", id: "p1", axis: "y", patch: { scale: "log10" } }, names)).toBe("Dose response: Y axis scale → log10");
    expect(describeCommand({ op: "setAxis", id: "p1", axis: "x", patch: { reversed: true } }, names)).toBe("Dose response: X axis reversed");
    expect(describeCommand({ op: "setAxis", id: "p1", axis: "x", patch: { title: "Dose (mg)" } }, names)).toBe("Dose response: X axis title → “Dose (mg)”");
    expect(describeCommand({ op: "setAxis", id: "p1", axis: "x", patch: { min: 0, max: 10 } }, names)).toBe("Dose response: X axis min → 0, max → 10");
  });

  it("analyses and lists read as actions", () => {
    expect(describeCommand({ op: "runAnalysis", name: "ttest", method: "ttest", table: "t1", params: {} }, names)).toBe("Run t test on Dose");
    expect(describeCommand({ op: "listGraphs" }, names)).toBe("List graphs");
    expect(describeCommand({ op: "applyStylePreset", id: "p1", preset: "Editorial" }, names)).toBe("Dose response: style preset → Editorial");
  });

  it("an unknown id falls back to the id itself rather than 'undefined'", () => {
    expect(describeCommand({ op: "setGraphKind", id: "p9", kind: "bar" }, names)).toBe("p9: graph kind → bar");
  });

  it("any other op is readable: the op name plus its fields, no JSON braces", () => {
    const s = describeCommand({ op: "setLegend", id: "p1", patch: { show: false } }, names);
    expect(s).toContain("Dose response");
    expect(s).toContain("legend");
    expect(s).toContain("show → false");
    expect(s).not.toContain("{");
  });
});
