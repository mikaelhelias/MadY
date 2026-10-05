import { describe, expect, it } from "vitest";
import { MadyDocument } from "./document";
import { executeAgentBatch } from "./agentApi";
import { compileNL, type NLContext, type NLResult } from "./nlCompiler";

const ctx: NLContext = {
  tables: [
    { id: "t1", name: "Kinetics", columns: [{ id: "c_dose", name: "dose" }, { id: "c_resp", name: "response" }] },
    { id: "t2", name: "Treatment means", columns: [{ id: "c_a", name: "Drug A" }, { id: "c_b", name: "Drug B" }] },
  ],
  activeTableId: "t1",
  activeGraphId: "p1",
};

function cmds(r: NLResult) {
  if (!r.ok) throw new Error(`expected ok, got: ${r.error}`);
  return r.commands;
}

describe("compileNL — create graphs", () => {
  it("makes a scatter and resolves the table from the mentioned columns", () => {
    const r = compileNL("make a scatter of dose vs response", ctx);
    expect(cmds(r)).toEqual([{ op: "createGraph", name: "Scatter — Kinetics", table: "t1", kind: "scatter" }]);
  });

  it("resolves a table by name", () => {
    const r = compileNL("bar chart of the Treatment means", ctx);
    expect(cmds(r)[0]).toMatchObject({ op: "createGraph", table: "t2", kind: "bar" });
  });

  it("falls back to the active table when none is named", () => {
    expect(cmds(compileNL("draw a violin plot", ctx))[0]).toMatchObject({ op: "createGraph", table: "t1", kind: "violin" });
  });

  it("maps common chart phrasings to the right kind", () => {
    const kindOf = (s: string) => (cmds(compileNL(s, ctx))[0] as { kind: string }).kind;
    expect(kindOf("make a box plot")).toBe("box");
    expect(kindOf("plot a histogram")).toBe("histogram");
    expect(kindOf("create a line chart")).toBe("xy");
    expect(kindOf("show me a heat map")).toBe("heatmap");
  });
});

describe("compileNL — change an existing graph", () => {
  it("changes the kind of the active graph", () => {
    expect(cmds(compileNL("make it a bar chart", ctx))).toEqual([{ op: "setGraphKind", id: "p1", kind: "bar" }]);
  });

  it("needs an active graph to change the kind", () => {
    const r = compileNL("turn it into a violin plot", { ...ctx, activeGraphId: undefined });
    expect(r).toMatchObject({ ok: false });
  });
});

describe("compileNL — axis edits", () => {
  it("log / linear scale on the named axis", () => {
    expect(cmds(compileNL("log the x axis", ctx))).toEqual([{ op: "setAxis", id: "p1", axis: "x", patch: { scale: "log10" } }]);
    expect(cmds(compileNL("make the y axis linear", ctx))).toEqual([{ op: "setAxis", id: "p1", axis: "y", patch: { scale: "linear" } }]);
    expect((cmds(compileNL("log2 the x axis", ctx))[0] as { patch: { scale: string } }).patch.scale).toBe("log2");
  });

  it("reverse an axis", () => {
    expect(cmds(compileNL("reverse the y axis", ctx))[0]).toMatchObject({ op: "setAxis", axis: "y", patch: { reversed: true } });
  });

  it("set an axis title", () => {
    expect(cmds(compileNL("title the x axis Dose (mM)", ctx))[0]).toMatchObject({ op: "setAxis", axis: "x", patch: { title: "Dose (mM)" } });
  });

  it("refuses an axis edit with no active graph", () => {
    expect(compileNL("log the x axis", { ...ctx, activeGraphId: undefined })).toMatchObject({ ok: false });
  });
});

describe("compileNL — run analyses", () => {
  it("t-test on two named columns, resolving their table", () => {
    const r = compileNL("run a t-test on Drug A and Drug B", ctx);
    expect(cmds(r)[0]).toMatchObject({ op: "runAnalysis", method: "ttest", table: "t2", params: { columns: ["c_a", "c_b"] } });
  });

  it("does not split 'A and B' into separate clauses (bare 'and' stays in one clause)", () => {
    // if it split on "and", the second clause "Drug B" alone would fail to parse
    expect(compileNL("run a t-test on Drug A and Drug B", ctx).ok).toBe(true);
  });

  it("maps method phrasings + variants", () => {
    const m = (s: string) => cmds(compileNL(s, ctx))[0] as { method: string; params: { variant?: string } };
    expect(m("run a mann-whitney on Drug A and Drug B")).toMatchObject({ method: "ttest", params: { variant: "mann-whitney" } });
    expect(m("fit michaelis-menten on dose vs response")).toMatchObject({ method: "curvefit", params: { variant: "mm" } });
    expect(m("compute the correlation of dose and response")).toMatchObject({ method: "correlation" });
    expect(m("run descriptives on dose")).toMatchObject({ method: "describe", params: { columns: ["c_dose"] } });
  });

  it("'run a t-test' is read as an analysis, not a chart, even though a t-test has no kind word", () => {
    expect(cmds(compileNL("run a t test on Drug A and Drug B", ctx))[0]).toMatchObject({ op: "runAnalysis" });
  });
});

describe("compileNL — lists", () => {
  it("routes list/show to the right query", () => {
    expect(cmds(compileNL("list the graphs", ctx))).toEqual([{ op: "listGraphs" }]);
    expect(cmds(compileNL("show me the tables", ctx))).toEqual([{ op: "listTables" }]);
    expect(cmds(compileNL("what analyses are there", ctx))).toEqual([{ op: "listAnalyses" }]);
  });
});

describe("compileNL — multi-command sequencing", () => {
  it("splits on ';' / 'then' into several commands", () => {
    const r = compileNL("make a scatter of dose vs response; then log the x axis", ctx);
    const c = cmds(r);
    expect(c).toHaveLength(2);
    expect(c[0]).toMatchObject({ op: "createGraph", kind: "scatter" });
    expect(c[1]).toMatchObject({ op: "setAxis", axis: "x", patch: { scale: "log10" } });
  });

  it("a create-then-edit targets the just-created graph, not the previously active one", () => {
    // The batch has no pre-existing active graph, yet "log the x axis" after the create
    // must still resolve — to the graph the first clause makes (via the batch sentinel).
    const noActive: NLContext = { ...ctx, activeGraphId: undefined };
    const r = compileNL("make a scatter of dose vs response; then log the x axis", noActive);
    const c = cmds(r);
    expect(c).toHaveLength(2);
    expect((c[1] as { id: string }).id).toBe("$lastGraph"); // the sentinel, not undefined

    // And executing it end to end logs the new graph's axis, not some other graph's.
    const doc = new MadyDocument();
    const table = doc.importTable("Kinetics", "xy", ["dose", "response"], [[1, 10], [2, 20]]);
    const live: NLContext = { tables: [{ id: table.id, name: "Kinetics", columns: table.columns.map((x) => ({ id: x.id, name: x.name })) }] };
    const compiled = compileNL("make a scatter of dose vs response; then log the x axis", live);
    if (!compiled.ok) throw new Error(compiled.error);
    const results = executeAgentBatch(doc, compiled.commands);
    expect(results.every((x) => x.ok)).toBe(true);
    const plot = doc.toJSON().plots[0]!;
    expect(plot.xAxis?.scale).toBe("log10"); // the created graph got the axis edit
  });

  it("fails the whole line, naming the offending clause", () => {
    const r = compileNL("make a scatter of dose vs response; then reticulate the widgets", ctx);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/reticulate the widgets/);
  });
});

describe("compileNL — clear failures", () => {
  it("returns a helpful error (never throws) for unparseable input", () => {
    const r = compileNL("please water the plants", ctx);
    expect(r).toMatchObject({ ok: false });
    if (!r.ok) expect(r.hint).toBeTruthy();
  });
});

describe("compileNL → executeAgentBatch — end to end on a real document", () => {
  it("compiles 'scatter of dose vs response' and executing it creates the plot", () => {
    const doc = new MadyDocument();
    // seed a real table matching the ctx
    const table = doc.importTable("Kinetics", "xy", ["dose", "response"], [[1, 10], [2, 20], [3, 30]]);
    const liveCtx: NLContext = {
      tables: [{ id: table.id, name: "Kinetics", columns: table.columns.map((c) => ({ id: c.id, name: c.name })) }],
      activeTableId: table.id,
    };
    const r = compileNL("make a scatter of dose vs response", liveCtx);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const results = executeAgentBatch(doc, r.commands);
    expect(results.every((x) => x.ok)).toBe(true);
    expect(doc.toJSON().plots).toHaveLength(1);
    expect(doc.toJSON().plots[0]!.kind).toBe("scatter");
    expect(doc.toJSON().plots[0]!.source).toBe(table.id);
  });
});

describe("compileNL — a half-understood line is refused, never half-applied", () => {
  // Guards against accepting this line and applying only the log-scale half, with no word
  // about the rest. "and <verb>" opens a second clause that must parse — or the whole line
  // fails, so the model (which can express both halves) gets it instead.
  it("refuses 'log scale and call the graph …' instead of doing only the first half", () => {
    const r = compileNL("put the response axis on a log scale and call the graph Dose response", ctx);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("call the graph Dose response");
  });

  it("two instructions joined by 'and' both run when both parse", () => {
    const r = compileNL("make a bar chart of the Treatment means and log the y axis", { ...ctx, activeGraphId: undefined });
    const c = cmds(r);
    expect(c.map((x) => x.op)).toEqual(["createGraph", "setAxis"]);
    expect(c[1]).toMatchObject({ axis: "y", patch: { scale: "log10" } });
  });

  it("'and' between nouns stays inside one clause, so a single request is not split in two", () => {
    expect(cmds(compileNL("run a t-test on Drug A and Drug B", ctx))[0]).toMatchObject({ op: "runAnalysis", method: "ttest" });
    expect(cmds(compileNL("make a scatter of dose and response", ctx))[0]).toMatchObject({ op: "createGraph", kind: "scatter" });
    expect(cmds(compileNL("compute the correlation of dose and response", ctx))[0]).toMatchObject({ op: "runAnalysis", method: "correlation" });
  });

  it("'and' before a verb that happens to be a column name is still a noun", () => {
    const c: NLContext = { ...ctx, tables: [{ id: "t9", name: "Fits", columns: [{ id: "c1", name: "log" }, { id: "c2", name: "dose" }] }], activeTableId: "t9" };
    expect(cmds(compileNL("make a scatter of dose and log", c))[0]).toMatchObject({ op: "createGraph", table: "t9" });
  });
});
