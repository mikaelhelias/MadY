import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { agentApiSchema } from "@mady/core";
import { MadySession } from "./session";
import { buildTools, coveredOps, opToolName, schemaOps, type ToolDescriptor } from "./tools";

/** Grab a tool descriptor by name (throws if missing, so a test cannot pass on an absent tool). */
function tool(tools: ToolDescriptor[], name: string): ToolDescriptor {
  const t = tools.find((x) => x.name === name);
  if (!t) throw new Error(`no tool named '${name}'`);
  return t;
}

describe("tool ⇄ command-union parity (drift guard)", () => {
  it("covers exactly the ops the closed command union declares — no more, no fewer", () => {
    // If someone adds an AgentOp without a matching OP_TOOLS entry (or vice versa),
    // this fails. That is the whole point: the tool surface cannot silently drift.
    expect([...coveredOps()].sort()).toEqual([...schemaOps()].sort());
  });

  it("every schema op has a generated tool with the snake_case name", () => {
    const tools = buildTools(new MadySession());
    const names = new Set(tools.map((t) => t.name));
    for (const { op } of agentApiSchema()) {
      expect(names.has(opToolName(op))).toBe(true);
    }
  });

  it("maps op names to snake_case", () => {
    expect(opToolName("listTables")).toBe("list_tables");
    expect(opToolName("createGraph")).toBe("create_graph");
    expect(opToolName("setGraphKind")).toBe("set_graph_kind");
    expect(opToolName("setSeriesStyle")).toBe("set_series_style");
  });

  it("exposes the lifecycle + NL + compute tools on top of the op tools", () => {
    const names = new Set(buildTools(new MadySession()).map((t) => t.name));
    for (const n of ["new_project", "open_project", "save_project", "project_summary", "run_nl", "compute_analysis"]) {
      expect(names.has(n)).toBe(true);
    }
  });
});

describe("authoring through the validated path", () => {
  it("creates a table + graph and reports them in the summary", async () => {
    const session = new MadySession();
    const tools = buildTools(session);

    const t = (await tool(tools, "create_table").handler({
      name: "Dose",
      columns: ["dose", "response"],
      rows: [
        [1, 10],
        [2, 22],
        [3, 31],
      ],
    })) as { ok: true; value: { id: string } };
    expect(t.ok).toBe(true);

    const g = (await tool(tools, "create_graph").handler({ name: "Curve", table: t.value.id, kind: "scatter" })) as {
      ok: true;
      value: { id: string };
    };
    expect(g.ok).toBe(true);

    const summary = tool(tools, "project_summary").handler({}) as { tables: unknown[]; graphs: unknown[] };
    expect(summary.tables).toHaveLength(1);
    expect(summary.graphs).toHaveLength(1);
  });

  it("run_nl compiles and executes a plain-language instruction", async () => {
    const session = new MadySession();
    const tools = buildTools(session);
    await tool(tools, "create_table").handler({ name: "T", columns: ["x", "y"], rows: [[1, 2]] });

    const res = (await tool(tools, "run_nl").handler({ text: "make a scatter of x vs y" })) as { ok: boolean };
    expect(res.ok).toBe(true);
    expect(session.document.toJSON().plots.length).toBe(1);
  });
});

describe("the destructive confirm-gate is enforced through the tools", () => {
  it("refuses delete_graph without confirm, then deletes with confirm:true", async () => {
    const session = new MadySession();
    const tools = buildTools(session);
    const t = (await tool(tools, "create_table").handler({ name: "T", columns: ["x"], rows: [[1]] })) as {
      value: { id: string };
    };
    const g = (await tool(tools, "create_graph").handler({ name: "G", table: t.value.id })) as { value: { id: string } };

    const refused = (await tool(tools, "delete_graph").handler({ id: g.value.id, confirm: false })) as {
      ok: boolean;
      code?: string;
    };
    expect(refused.ok).toBe(false);
    expect(refused.code).toBe("confirm_required");
    expect(session.document.toJSON().plots).toHaveLength(1); // still there

    const done = (await tool(tools, "delete_graph").handler({ id: g.value.id, confirm: true })) as { ok: boolean };
    expect(done.ok).toBe(true);
    expect(session.document.toJSON().plots).toHaveLength(0); // gone
  });
});

/**
 * `describe_graph` — the agent's read-back. Everything else here is write-only from the
 * agent's point of view; without this tool it could set an option and never learn whether the
 * option landed or whether the builder refused it.
 */
describe("describe_graph reads back what the graph actually draws", () => {
  /** Create a two-series table + a graph of it; return the tool list and the graph id. */
  async function seedGraph(kind?: string): Promise<{ tools: ToolDescriptor[]; graphId: string; session: MadySession }> {
    const session = new MadySession();
    const tools = buildTools(session);
    const t = (await tool(tools, "create_table").handler({
      name: "Data",
      columns: ["Dose", "Response", "Control"],
      rows: [[1, 10, 4], [2, 20, 6], [3, 15, 5]],
    })) as { value: { id: string } };
    const g = (await tool(tools, "create_graph").handler({
      name: "G",
      table: t.value.id,
      ...(kind ? { kind } : {}),
    })) as { value: { id: string } };
    return { tools, graphId: g.value.id, session };
  }

  it("is exposed as a tool", () => {
    const names = new Set(buildTools(new MadySession()).map((x) => x.name));
    expect(names.has("describe_graph")).toBe(true);
  });

  it("reports the resolved axes, the series and the drawn total", async () => {
    const { tools, graphId } = await seedGraph();
    const d = (await tool(tools, "describe_graph").handler({ id: graphId })) as {
      ok: boolean;
      kind: string;
      axes: Record<string, { domain: [number, number]; tickCount: number }>;
      series: { name: string; marks: number }[];
      drawnTotal: number;
      warnings: string[];
    };

    expect(d.ok).toBe(true);
    expect(d.axes.y!.tickCount).toBeGreaterThan(0);
    expect(d.series.length).toBeGreaterThan(0);
    expect(d.series[0]!.marks).toBeGreaterThan(0);
    expect(d.drawnTotal).toBeGreaterThan(0);
    expect(Array.isArray(d.warnings)).toBe(true);
  });

  it("shows an option change landing — the purpose of the tool", async () => {
    const { tools, graphId } = await seedGraph();
    const before = (await tool(tools, "describe_graph").handler({ id: graphId })) as { axes: Record<string, { type: string }> };
    expect(before.axes.y!.type).not.toBe("log");

    await tool(tools, "set_axis").handler({ id: graphId, axis: "y", patch: { scale: "log" } });

    const after = (await tool(tools, "describe_graph").handler({ id: graphId })) as { axes: Record<string, { type: string }> };
    expect(after.axes.y!.type).toBe("log");
  });

  it("a pie is not reported as empty just because the series layer is", async () => {
    const { tools, graphId } = await seedGraph("pie");
    const d = (await tool(tools, "describe_graph").handler({ id: graphId })) as {
      drawnTotal: number;
      drawsOutsideSeriesLayer: boolean;
    };

    expect(d.drawnTotal).toBeGreaterThan(0);
    expect(d.drawsOutsideSeriesLayer).toBe(true);
  });

  it("fails as a value on an unknown id, never a throw", async () => {
    const { tools } = await seedGraph();
    const d = (await tool(tools, "describe_graph").handler({ id: "no-such-graph" })) as {
      ok: boolean;
      code: string;
    };

    expect(d.ok).toBe(false);
    expect(d.code).toBe("not_found");
  });

  it("mutates nothing — the project is byte-identical afterwards", async () => {
    const { tools, graphId, session } = await seedGraph();
    const before = JSON.stringify(session.document.toJSON());
    await tool(tools, "describe_graph").handler({ id: graphId });
    expect(JSON.stringify(session.document.toJSON())).toBe(before);
  });
});

/**
 * The tables pass-through. `describeGraph` hands `buildPlotScene` the project's tables so a
 * graph that borrows a series from another datasheet (`plot.overlays`)
 * resolves it — exactly as the live pane does. Dropping that argument does not fail: the
 * overlay is simply left out, silently, and the description then disagrees with the app. No
 * other test catches that.
 */
describe("describe_graph resolves a series borrowed from another datasheet", () => {
  it("includes the overlay series, naming the sheet it came from", async () => {
    const session = new MadySession();
    const tools = buildTools(session);
    const a = (await tool(tools, "create_table").handler({
      name: "Sheet A", columns: ["Dose", "Response"], rows: [[1, 10], [2, 20], [3, 15]],
    })) as { value: { id: string } };
    const b = (await tool(tools, "create_table").handler({
      name: "Sheet B", columns: ["Dose", "Borrowed"], rows: [[1, 3], [2, 6], [3, 9]],
    })) as { value: { id: string } };
    const g = (await tool(tools, "create_graph").handler({ name: "G", table: a.value.id })) as { value: { id: string } };

    const project = session.document.toJSON();
    const sheetB = project.tables.find((t) => t.id === b.value.id)!;
    const borrowedCol = sheetB.columns.find((c) => c.name === "Borrowed")!;
    await tool(tools, "set_graph_options").handler({
      id: g.value.id,
      patch: { overlays: [{ id: "ov1", table: sheetB.id, column: borrowedCol.id }] },
    });

    const d = (await tool(tools, "describe_graph").handler({ id: g.value.id })) as {
      series: { name: string; fromTable?: string }[];
    };

    const borrowed = d.series.find((s) => s.fromTable !== undefined);
    expect(borrowed, "the borrowed series is missing — were the project's tables passed to buildPlotScene?").toBeDefined();
    expect(borrowed!.fromTable).toBe("Sheet B");
  });
});

/**
 * `describe_options` — the answer to "what can I set on this?", which `set_graph_options` alone
 * leaves an agent guessing at. Backed by the option catalogue (generated by rendering every chart
 * kind with and without each option), so it reports what changes the drawing rather than what a
 * control exists for.
 */
describe("describe_options tells the agent what is settable", () => {
  it("is exposed as a tool", () => {
    const names = new Set(buildTools(new MadySession()).map((x) => x.name));
    expect(names.has("describe_options")).toBe(true);
  });

  it("answers for a kind, with a value known to work", async () => {
    const tools = buildTools(new MadySession());
    const r = (await tool(tools, "describe_options").handler({ kind: "heatmap", group: "Axis" })) as {
      ok: boolean;
      kind: string;
      total: number;
      options: { option: string; group: string; example: unknown }[];
    };

    expect(r.ok).toBe(true);
    expect(r.kind).toBe("heatmap");
    expect(r.total).toBeGreaterThan(0);
    expect(r.options.every((o) => o.group === "Axis")).toBe(true);
  });

  it("takes a graph_id and answers for that graph's kind", async () => {
    // The convenient path: an agent holds ids, not kind names. Getting this wrong would answer
    // about the default kind while the graph is something else.
    const session = new MadySession();
    const tools = buildTools(session);
    const t = (await tool(tools, "create_table").handler({
      name: "T", columns: ["a", "b", "c"], rows: [[1, 2, 3], [4, 5, 6]],
    })) as { value: { id: string } };
    const g = (await tool(tools, "create_graph").handler({ name: "P", table: t.value.id, kind: "pie" })) as {
      value: { id: string };
    };

    const r = (await tool(tools, "describe_options").handler({ graph_id: g.value.id })) as { kind: string };
    expect(r.kind).toBe("pie");
  });

  it("answers about one option: which kinds it works on", async () => {
    const tools = buildTools(new MadySession());
    const r = (await tool(tools, "describe_options").handler({ option: "xAxis.scale" })) as {
      known: boolean;
      kinds: string[];
    };

    expect(r.known).toBe(true);
    expect(r.kinds).toContain("xy");
  });

  it("refuses with a clear message when given none of kind / graph_id / option", async () => {
    const tools = buildTools(new MadySession());
    const r = (await tool(tools, "describe_options").handler({})) as { ok: boolean; code: string; knownKinds: string[] };

    expect(r.ok).toBe(false);
    expect(r.code).toBe("bad_request");
    expect(r.knownKinds.length).toBeGreaterThan(40);
  });

  it("fails as a value on an unknown graph_id", async () => {
    const tools = buildTools(new MadySession());
    const r = (await tool(tools, "describe_options").handler({ graph_id: "nope" })) as { ok: boolean; code: string };

    expect(r.ok).toBe(false);
    expect(r.code).toBe("not_found");
  });
});

/**
 * `import_csv` — loads a CSV file. `create_table` takes only data an agent already has in
 * hand; this reads a file off disk, which is where a scientist's data actually
 * lives. Reuses the app's own `parseLinkedText`, so these tests are about the wiring and the
 * failure modes, not about re-testing the parser.
 */
describe("import_csv reads a real file into a table", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "mady-csv-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function write(name: string, text: string): Promise<string> {
    const p = join(dir, name);
    await writeFile(p, text, "utf8");
    return p;
  }

  it("imports a comma file, taking the header row and the file's name", async () => {
    const session = new MadySession();
    const tools = buildTools(session);
    const path = await write("Doses.csv", "Dose,Response\n1,10\n2,20\n3,15\n");

    const r = (await tool(tools, "import_csv").handler({ path })) as {
      ok: boolean; id: string; name: string; columns: string[]; rows: number;
    };

    expect(r.ok).toBe(true);
    expect(r.name).toBe("Doses"); // the file's own name, extension dropped
    expect(r.columns).toEqual(["Dose", "Response"]);
    expect(r.rows).toBe(3);
    // …and it really landed in the document, through the validated createTable path.
    const t = session.document.toJSON().tables[0]!;
    expect(t.name).toBe("Doses");
    expect(t.rows).toHaveLength(3);
  });

  it("detects a tab-separated file without being told — the parser the app uses, not a second one", async () => {
    const session = new MadySession();
    const tools = buildTools(session);
    const path = await write("tabs.tsv", "A\tB\n1\t2\n3\t4\n");

    const r = (await tool(tools, "import_csv").handler({ path })) as { columns: string[]; rows: number };

    // A naive split-on-comma would give one column holding the whole line.
    expect(r.columns).toEqual(["A", "B"]);
    expect(r.rows).toBe(2);
  });

  it("honours an explicit name and skip_rows for a file with a preamble", async () => {
    const session = new MadySession();
    const tools = buildTools(session);
    const path = await write("meta.csv", "# exported by the plate reader\n\nDose,Response\n1,10\n2,20\n");

    const r = (await tool(tools, "import_csv").handler({ path, name: "Plate 1", skip_rows: 2 })) as {
      name: string; columns: string[]; rows: number;
    };

    expect(r.name).toBe("Plate 1");
    expect(r.columns).toEqual(["Dose", "Response"]);
    expect(r.rows).toBe(2);
  });

  it("fails as a value on a missing file, never a throw", async () => {
    const tools = buildTools(new MadySession());
    const r = (await tool(tools, "import_csv").handler({ path: join(dir, "nope.csv") })) as {
      ok: boolean; code: string;
    };

    expect(r.ok).toBe(false);
    expect(r.code).toBe("not_found");
  });

  it("refuses a file with nothing tabular in it, rather than filing an empty sheet", async () => {
    const session = new MadySession();
    const tools = buildTools(session);
    const path = await write("empty.csv", "");

    const r = (await tool(tools, "import_csv").handler({ path })) as { ok: boolean; code: string };

    expect(r.ok).toBe(false);
    expect(r.code).toBe("bad_request");
    expect(session.document.toJSON().tables).toHaveLength(0);
  });
});
