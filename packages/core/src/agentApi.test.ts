import { describe, expect, it } from "vitest";
import { MadyDocument } from "./document";
import { agentApiSchema, executeAgentBatch, executeAgentCommand, type AgentCommand, type AgentResult } from "./agentApi";

/** Assert success and return the value; fail loudly with the error otherwise. */
function val<T = unknown>(r: AgentResult<T>): T {
  if (!r.ok) throw new Error(`expected ok, got ${r.code}: ${r.error}`);
  return r.value;
}

/** A doc with one table already imported; returns [doc, tableId]. */
function docWithTable(): [MadyDocument, string] {
  const doc = new MadyDocument();
  const r = executeAgentCommand(doc, { op: "createTable", name: "T", kind: "xy", columns: ["dose", "resp"], rows: [[1, 10], [2, 20], [3, 30]] });
  return [doc, (val(r) as { id: string }).id];
}

describe("executeAgentCommand — create + query round trip", () => {
  it("creates a table, lists it, and reports column/row counts", () => {
    const [doc, tid] = docWithTable();
    const tables = val(executeAgentCommand(doc, { op: "listTables" })) as Array<{ id: string; columns: number; rows: number }>;
    expect(tables).toHaveLength(1);
    expect(tables[0]).toMatchObject({ id: tid, columns: 2, rows: 3 });
  });

  it("creates a graph of a table (with a kind), then lists + fetches it", () => {
    const [doc, tid] = docWithTable();
    const gid = (val(executeAgentCommand(doc, { op: "createGraph", name: "G", table: tid, kind: "bar" })) as { id: string }).id;
    const graphs = val(executeAgentCommand(doc, { op: "listGraphs" })) as Array<{ id: string; kind: string; source: string }>;
    expect(graphs).toHaveLength(1);
    expect(graphs[0]).toMatchObject({ id: gid, kind: "bar", source: tid });
    const fetched = val(executeAgentCommand(doc, { op: "getGraph", id: gid })) as { id: string; kind: string };
    expect(fetched.id).toBe(gid);
    expect(fetched.kind).toBe("bar");
  });

  it("runs an analysis and can read its (initially stale) record back", () => {
    const [doc, tid] = docWithTable();
    const aid = (val(executeAgentCommand(doc, { op: "runAnalysis", name: "fit", method: "curvefit", table: tid, params: { columns: ["dose", "resp"], variant: "mm" } })) as { id: string }).id;
    const a = val(executeAgentCommand(doc, { op: "getAnalysis", id: aid })) as { id: string; method: string; status: string };
    expect(a).toMatchObject({ id: aid, method: "curvefit" });
    // The engine hasn't run in this headless unit test, so it is "stale" — the point is
    // the record exists and is queryable, wired to its source table.
    expect(["stale", "ok", "error"]).toContain(a.status);
  });

  it("applies style/axis/option mutations through the document", () => {
    const [doc, tid] = docWithTable();
    const gid = (val(executeAgentCommand(doc, { op: "createGraph", name: "G", table: tid })) as { id: string }).id;
    expect(executeAgentCommand(doc, { op: "setGraphKind", id: gid, kind: "scatter" }).ok).toBe(true);
    expect(executeAgentCommand(doc, { op: "setAxis", id: gid, axis: "x", patch: { title: "Dose (mM)" } }).ok).toBe(true);
    expect(executeAgentCommand(doc, { op: "setGraphOptions", id: gid, patch: { name: "Renamed" } }).ok).toBe(true);
    const g = val(executeAgentCommand(doc, { op: "getGraph", id: gid })) as { kind: string; name: string; xAxis?: { title?: string } };
    expect(g.kind).toBe("scatter");
    expect(g.name).toBe("Renamed");
    expect(g.xAxis?.title).toBe("Dose (mM)");
  });
});

describe("executeAgentCommand — the agent path reuses the validated, undoable document path", () => {
  it("an agent mutation is undoable via the same command stack the UI uses", () => {
    const [doc, tid] = docWithTable();
    executeAgentCommand(doc, { op: "createGraph", name: "G", table: tid });
    expect(doc.toJSON().plots).toHaveLength(1);
    doc.commands.undo();
    expect(doc.toJSON().plots).toHaveLength(0); // the create was one undoable command
  });
});

describe("executeAgentCommand — failures are typed values, never throws", () => {
  it("unknown op", () => {
    const r = executeAgentCommand(new MadyDocument(), { op: "frobnicate" });
    expect(r).toMatchObject({ ok: false, code: "unknown_op" });
  });
  it("not an object / missing op", () => {
    expect(executeAgentCommand(new MadyDocument(), 42)).toMatchObject({ ok: false, code: "bad_request" });
    expect(executeAgentCommand(new MadyDocument(), {})).toMatchObject({ ok: false, code: "bad_request" });
  });
  it("missing required fields → bad_request (not a throw)", () => {
    expect(executeAgentCommand(new MadyDocument(), { op: "createGraph", name: "G" })).toMatchObject({ ok: false, code: "bad_request" });
    expect(executeAgentCommand(new MadyDocument(), { op: "setAxis", id: "p1", axis: "z", patch: {} })).toMatchObject({ ok: false, code: "bad_request" });
  });
  it("a missing target surfaces as not_found (the document method threw, caught)", () => {
    expect(executeAgentCommand(new MadyDocument(), { op: "createGraph", name: "G", table: "nope" })).toMatchObject({ ok: false, code: "not_found" });
    expect(executeAgentCommand(new MadyDocument(), { op: "getGraph", id: "nope" })).toMatchObject({ ok: false, code: "not_found" });
  });
});

describe("executeAgentCommand — destructive ops require confirm", () => {
  it("delete without confirm is refused with a clear code, and the target survives", () => {
    const [doc, tid] = docWithTable();
    const gid = (val(executeAgentCommand(doc, { op: "createGraph", name: "G", table: tid })) as { id: string }).id;
    const refused = executeAgentCommand(doc, { op: "deleteGraph", id: gid, confirm: false });
    expect(refused).toMatchObject({ ok: false, code: "confirm_required" });
    expect(doc.toJSON().plots).toHaveLength(1); // untouched
    // omitting confirm entirely is also refused
    expect(executeAgentCommand(doc, { op: "deleteGraph", id: gid } as unknown as AgentCommand)).toMatchObject({ ok: false, code: "confirm_required" });
  });
  it("delete with confirm removes it", () => {
    const [doc, tid] = docWithTable();
    const gid = (val(executeAgentCommand(doc, { op: "createGraph", name: "G", table: tid })) as { id: string }).id;
    expect(executeAgentCommand(doc, { op: "deleteGraph", id: gid, confirm: true }).ok).toBe(true);
    expect(doc.toJSON().plots).toHaveLength(0);
  });
  it("an unconfirmed delete fails before resolving the target (gate is first)", () => {
    // A non-existent id + no confirm must report confirm_required, not not_found —
    // proving nothing is touched until the gate passes.
    expect(executeAgentCommand(new MadyDocument(), { op: "deleteTable", id: "ghost", confirm: false })).toMatchObject({ ok: false, code: "confirm_required" });
  });
});

describe("executeAgentBatch — stops at the first failure", () => {
  it("builds table→graph in one batch, and halts a bad batch without applying later steps", () => {
    const doc = new MadyDocument();
    const good = executeAgentBatch(doc, [
      { op: "createTable", name: "T", columns: ["a", "b"], rows: [[1, 2]] },
      { op: "listTables" },
    ]);
    expect(good.every((r) => r.ok)).toBe(true);

    const before = doc.toJSON().plots.length;
    const bad = executeAgentBatch(doc, [
      { op: "createGraph", name: "G", table: "missing" }, // fails
      { op: "createGraph", name: "G2", table: doc.toJSON().tables[0]!.id }, // must not run
    ]);
    expect(bad).toHaveLength(1); // stopped after the failure
    expect(bad[0]!.ok).toBe(false);
    expect(doc.toJSON().plots).toHaveLength(before); // the second create never happened
  });
});

describe("executeAgentBatch — the $lastGraph sentinel", () => {
  it("resolves to the graph created earlier in the batch", () => {
    const [doc, tid] = docWithTable();
    const results = executeAgentBatch(doc, [
      { op: "createGraph", name: "G", table: tid },
      { op: "setAxis", id: "$lastGraph", axis: "x", patch: { scale: "log10" } },
    ]);
    expect(results.every((r) => r.ok)).toBe(true);
    expect(doc.toJSON().plots[0]!.xAxis?.scale).toBe("log10"); // the edit hit the new graph
  });

  it("errors clearly if nothing was created before the sentinel is used", () => {
    const [doc] = docWithTable();
    const results = executeAgentBatch(doc, [{ op: "setAxis", id: "$lastGraph", axis: "x", patch: { scale: "log10" } }]);
    expect(results[0]).toMatchObject({ ok: false, code: "bad_request" });
  });
});

describe("agentApiSchema — stays in lock-step with the command union", () => {
  it("describes every op exactly once, with correct mutate/destructive flags", () => {
    const schema = agentApiSchema();
    const ops = schema.map((s) => s.op);
    expect(new Set(ops).size).toBe(ops.length); // no duplicates
    // read ops don't mutate; delete ops are destructive and list confirm as required
    expect(schema.find((s) => s.op === "listTables")).toMatchObject({ mutates: false, destructive: false });
    expect(schema.find((s) => s.op === "createGraph")).toMatchObject({ mutates: true, destructive: false });
    const del = schema.find((s) => s.op === "deleteGraph")!;
    expect(del).toMatchObject({ mutates: true, destructive: true });
    expect(del.required).toContain("confirm");
  });

  it("every op the schema names is actually dispatchable (no phantom ops)", () => {
    // Each op run with empty args must fail with a handled code, never 'unknown_op'
    // (which would mean the schema lists an op the switch doesn't handle).
    for (const { op } of agentApiSchema()) {
      const r = executeAgentCommand(new MadyDocument(), { op });
      expect(r.ok || r.code !== "unknown_op", `schema op '${op}' is not handled by the executor`).toBe(true);
    }
  });
});

/**
 * Editing the data itself.
 *
 * These ops let an agent make edits finer than creating a whole table, such as fixing one wrong
 * number. Every op dispatches to the existing `MadyDocument` method, so it is undoable and
 * carries the same guards as the UI path; what is tested here is the wiring and the addressing.
 *
 * Addressing is always by id. The document's delete methods take a position, and a position
 * handed in from outside goes stale the moment anything reorders the sheet — including another
 * command in the same batch. The id→index lookup lives inside the executor for that reason, and
 * the sort-then-delete test below is what would catch its removal.
 */
describe("editing the data", () => {
  /** The table's column ids and row ids, via the op that exists to expose them. */
  function ids(doc: MadyDocument, tid: string): { cols: string[]; rows: string[] } {
    const t = val(executeAgentCommand(doc, { op: "getTable", id: tid })) as {
      columns: { id: string }[];
      rows: { id: string }[];
    };
    return { cols: t.columns.map((c) => c.id), rows: t.rows.map((r) => r.id) };
  }

  it("getTable exposes row ids — without it setCell cannot address anything", () => {
    const [doc, tid] = docWithTable();
    const t = val(executeAgentCommand(doc, { op: "getTable", id: tid })) as {
      columns: { id: string; name: string }[];
      rows: { id: string; cells: Record<string, unknown> }[];
      rowCount: number;
    };

    expect(t.rowCount).toBe(3);
    expect(t.rows).toHaveLength(3);
    expect(t.rows.every((r) => typeof r.id === "string" && r.id.length > 0)).toBe(true);
    expect(t.columns.map((c) => c.name)).toEqual(["dose", "resp"]);
  });

  it("getTable pages, and says when it held rows back", () => {
    const [doc, tid] = docWithTable();
    const page = val(executeAgentCommand(doc, { op: "getTable", id: tid, limit: 2 })) as {
      rows: unknown[]; rowCount: number; truncated?: boolean;
    };
    expect(page.rows).toHaveLength(2);
    expect(page.rowCount).toBe(3);
    expect(page.truncated).toBe(true);

    const rest = val(executeAgentCommand(doc, { op: "getTable", id: tid, limit: 2, offset: 2 })) as {
      rows: unknown[]; truncated?: boolean;
    };
    expect(rest.rows).toHaveLength(1);
    expect(rest.truncated).toBeUndefined();
  });

  it("sets one cell, and the value is really in the document", () => {
    const [doc, tid] = docWithTable();
    const { cols, rows } = ids(doc, tid);

    val(executeAgentCommand(doc, { op: "setCell", table: tid, row: rows[1]!, column: cols[1]!, value: 99 }));

    expect(doc.toJSON().tables[0]!.rows[1]!.cells[cols[1]!]).toBe(99);
  });

  it("clears a cell with null, and refuses a value that is neither number, string nor null", () => {
    const [doc, tid] = docWithTable();
    const { cols, rows } = ids(doc, tid);

    val(executeAgentCommand(doc, { op: "setCell", table: tid, row: rows[0]!, column: cols[0]!, value: null }));
    expect(doc.toJSON().tables[0]!.rows[0]!.cells[cols[0]!]).toBeNull();

    const bad = executeAgentCommand(doc, { op: "setCell", table: tid, row: rows[0]!, column: cols[0]!, value: { a: 1 } });
    expect(bad.ok).toBe(false);
    expect(bad.ok === false && bad.code).toBe("bad_request");
  });

  it("adds a row and a column", () => {
    const [doc, tid] = docWithTable();
    val(executeAgentCommand(doc, { op: "addRow", table: tid, values: [4, 40] }));
    val(executeAgentCommand(doc, { op: "addColumn", table: tid, name: "extra" }));

    const t = doc.toJSON().tables[0]!;
    expect(t.rows).toHaveLength(4);
    expect(t.columns.map((c) => c.name)).toContain("extra");
  });

  it("renames a column without changing its id, so graphs keep working", () => {
    const [doc, tid] = docWithTable();
    const { cols } = ids(doc, tid);
    val(executeAgentCommand(doc, { op: "renameColumn", table: tid, column: cols[1]!, name: "response" }));

    const t = doc.toJSON().tables[0]!;
    expect(t.columns[1]!.name).toBe("response");
    expect(t.columns[1]!.id).toBe(cols[1]); // the identity a plot's series points at
  });

  it("sorts rows, and refuses a direction that is not asc/desc", () => {
    const [doc, tid] = docWithTable();
    const { cols } = ids(doc, tid);
    val(executeAgentCommand(doc, { op: "sortRows", table: tid, column: cols[0]!, direction: "desc" }));

    expect(doc.toJSON().tables[0]!.rows.map((r) => r.cells[cols[0]!])).toEqual([3, 2, 1]);
    const bad = executeAgentCommand(doc, { op: "sortRows", table: tid, column: cols[0]!, direction: "sideways" });
    expect(bad.ok === false && bad.code).toBe("bad_request");
  });

  it("excludes a cell and puts it back", () => {
    const [doc, tid] = docWithTable();
    const { cols, rows } = ids(doc, tid);
    const cell = [{ row: rows[0]!, column: cols[1]! }];

    val(executeAgentCommand(doc, { op: "setCellsExcluded", table: tid, cells: cell, excluded: true }));
    const on = doc.toJSON().tables[0]!.excluded ?? {};
    expect(Object.values(on).flat().filter(Boolean).length).toBeGreaterThan(0);

    val(executeAgentCommand(doc, { op: "setCellsExcluded", table: tid, cells: cell, excluded: false }));
    const off = doc.toJSON().tables[0]!.excluded ?? {};
    expect(Object.values(off).flat().filter(Boolean)).toHaveLength(0);
  });

  it("sets a column's type, and refuses one that is not a column type", () => {
    const [doc, tid] = docWithTable();
    const { cols } = ids(doc, tid);
    val(executeAgentCommand(doc, { op: "setColumnType", table: tid, column: cols[0]!, type: "text" }));
    expect(doc.toJSON().tables[0]!.columns[0]!.type).toBe("text");

    const bad = executeAgentCommand(doc, { op: "setColumnType", table: tid, column: cols[0]!, type: "colour" });
    expect(bad.ok === false && bad.code).toBe("bad_request");
  });

  it("row and column deletes are confirm-gated, like every other destructive op", () => {
    const [doc, tid] = docWithTable();
    const { cols, rows } = ids(doc, tid);

    const refusedRow = executeAgentCommand(doc, { op: "deleteRow", table: tid, row: rows[0]!, confirm: false });
    expect(refusedRow.ok === false && refusedRow.code).toBe("confirm_required");
    expect(doc.toJSON().tables[0]!.rows).toHaveLength(3); // untouched

    const refusedCol = executeAgentCommand(doc, { op: "deleteColumn", table: tid, column: cols[0]!, confirm: false });
    expect(refusedCol.ok === false && refusedCol.code).toBe("confirm_required");
    expect(doc.toJSON().tables[0]!.columns).toHaveLength(2);
  });

  it("deletes the row the id names, even after a sort has reordered the sheet", () => {
    // The reason for addressing by id. With positions, an agent that read row 0, sorted, then
    // deleted "row 0" would silently destroy a different row than the one it looked at.
    const [doc, tid] = docWithTable();
    const { cols, rows } = ids(doc, tid);
    const rowToDelete = rows[0]!; // the row whose dose is 1

    val(executeAgentCommand(doc, { op: "sortRows", table: tid, column: cols[0]!, direction: "desc" }));
    val(executeAgentCommand(doc, { op: "deleteRow", table: tid, row: rowToDelete, confirm: true }));

    const left = doc.toJSON().tables[0]!;
    expect(left.rows).toHaveLength(2);
    expect(left.rows.map((r) => r.id)).not.toContain(rowToDelete);
    expect(left.rows.map((r) => r.cells[cols[0]!])).toEqual([3, 2]); // 1 went, not 3
  });

  it("deletes a column by id, and reports a missing one rather than hitting the wrong one", () => {
    const [doc, tid] = docWithTable();
    const { cols } = ids(doc, tid);

    val(executeAgentCommand(doc, { op: "deleteColumn", table: tid, column: cols[0]!, confirm: true }));
    expect(doc.toJSON().tables[0]!.columns.map((c) => c.id)).toEqual([cols[1]]);

    const missing = executeAgentCommand(doc, { op: "deleteColumn", table: tid, column: "no-such-col", confirm: true });
    expect(missing.ok === false && missing.code).toBe("not_found");
  });
});

/**
 * Things on the graph, how it looks, figures, project structure.
 *
 * Same contract as every other op: dispatch to the existing `MadyDocument` method, so each is
 * undoable and carries the guards the UI path carries. What is tested here is that the command
 * reaches the document and that the document really changed — "it was accepted" is never the
 * same claim as "it landed".
 */
describe("things on the graph", () => {
  /** A doc with one table and one graph of it; returns [doc, graphId]. */
  function docWithGraph(): [MadyDocument, string] {
    const [doc, tid] = docWithTable();
    const gid = (val(executeAgentCommand(doc, { op: "createGraph", name: "G", table: tid })) as { id: string }).id;
    return [doc, gid];
  }

  it("adds a label, patches it, and removes it", () => {
    const [doc, gid] = docWithGraph();

    const added = val(executeAgentCommand(doc, {
      op: "addAnnotation",
      id: gid,
      // Note: `label` is the body (not `text`), and x/y are fractions of the plot rect.
      annotation: { kind: "text", label: "hello", x: 0.5, y: 0.5 },
    })) as { annotation: string };
    expect(doc.toJSON().plots[0]!.annotations).toHaveLength(1);

    val(executeAgentCommand(doc, { op: "updateAnnotation", id: gid, annotation: added.annotation, patch: { label: "goodbye" } }));
    expect(doc.toJSON().plots[0]!.annotations![0]!.label).toBe("goodbye");

    val(executeAgentCommand(doc, { op: "removeAnnotation", id: gid, annotation: added.annotation }));
    expect(doc.toJSON().plots[0]!.annotations ?? []).toHaveLength(0);
  });

  it("refuses an annotation with no kind, rather than filing a shapeless one", () => {
    const [doc, gid] = docWithGraph();
    const bad = executeAgentCommand(doc, { op: "addAnnotation", id: gid, annotation: { label: "no kind" } });

    expect(bad.ok === false && bad.code).toBe("bad_request");
    expect(doc.toJSON().plots[0]!.annotations ?? []).toHaveLength(0);
  });

  it("sets the significance style, and a fitted curve, and takes the fit away again", () => {
    const [doc, gid] = docWithGraph();

    val(executeAgentCommand(doc, { op: "setSignificance", id: gid, patch: { style: "stars" } }));
    expect(doc.toJSON().plots[0]!.significance).toMatchObject({ style: "stars" });

    val(executeAgentCommand(doc, { op: "setFit", id: gid, fit: { kind: "linear" } }));
    expect(doc.toJSON().plots[0]!.fit).toBeTruthy();

    val(executeAgentCommand(doc, { op: "setFit", id: gid, fit: null }));
    expect(doc.toJSON().plots[0]!.fit ?? null).toBeNull();
  });

  it("refuses a fit that is neither an object nor null", () => {
    const [doc, gid] = docWithGraph();
    const bad = executeAgentCommand(doc, { op: "setFit", id: gid, fit: "linear" });
    expect(bad.ok === false && bad.code).toBe("bad_request");
  });
});

describe("how the graph looks", () => {
  function docWithGraph(): [MadyDocument, string] {
    const [doc, tid] = docWithTable();
    const gid = (val(executeAgentCommand(doc, { op: "createGraph", name: "G", table: tid })) as { id: string }).id;
    return [doc, gid];
  }

  it("applies a style preset by name, and really restyles the plot", () => {
    const [doc, gid] = docWithGraph();
    const before = JSON.stringify(doc.toJSON().plots[0]);

    val(executeAgentCommand(doc, { op: "applyStylePreset", id: gid, preset: "Grayscale (print)" }));

    expect(JSON.stringify(doc.toJSON().plots[0])).not.toBe(before);
  });

  it("refuses an unknown preset and names the real ones — a typo must not read as applied", () => {
    const [doc, gid] = docWithGraph();
    const before = JSON.stringify(doc.toJSON().plots[0]);

    const bad = executeAgentCommand(doc, { op: "applyStylePreset", id: gid, preset: "Greyscale" });

    expect(bad.ok === false && bad.code).toBe("bad_request");
    expect(bad.ok === false && bad.error).toContain("Grayscale (print)"); // the correct spelling is offered
    expect(JSON.stringify(doc.toJSON().plots[0])).toBe(before); // nothing changed
  });

  it("sets a font element, and refuses one that is not a font element", () => {
    const [doc, gid] = docWithGraph();
    val(executeAgentCommand(doc, { op: "setFont", id: gid, element: "title", patch: { size: 22 } }));
    expect(doc.toJSON().plots[0]!.fonts?.title).toMatchObject({ size: 22 });

    const bad = executeAgentCommand(doc, { op: "setFont", id: gid, element: "caption", patch: { size: 9 } });
    expect(bad.ok === false && bad.code).toBe("bad_request");
  });

  it("patches the legend, the gridlines and the frame", () => {
    const [doc, gid] = docWithGraph();

    val(executeAgentCommand(doc, { op: "setLegend", id: gid, patch: { show: false } }));
    val(executeAgentCommand(doc, { op: "setGrid", id: gid, patch: { y: true } }));
    val(executeAgentCommand(doc, { op: "setFrame", id: gid, patch: { frame: "lshape", tickDir: "in" } }));

    const p = doc.toJSON().plots[0]!;
    expect(p.legend).toMatchObject({ show: false });
    expect(p.grid).toMatchObject({ y: true });
    expect(p.frame).toBe("lshape");
    expect(p.tickDir).toBe("in");
  });
});

describe("multi-panel figures", () => {
  it("creates a figure, puts a graph on it, patches its options, and lists it", () => {
    const [doc, tid] = docWithTable();
    const gid = (val(executeAgentCommand(doc, { op: "createGraph", name: "G", table: tid })) as { id: string }).id;

    const fig = val(executeAgentCommand(doc, { op: "createFigure", name: "Figure 1" })) as { id: string };
    val(executeAgentCommand(doc, { op: "addFigurePanel", figure: fig.id, graph: gid }));
    val(executeAgentCommand(doc, { op: "setFigureOptions", figure: fig.id, patch: { columns: 2 } }));

    const figures = val(executeAgentCommand(doc, { op: "listFigures" })) as { id: string; name: string; panels: number }[];
    expect(figures).toHaveLength(1);
    expect(figures[0]).toMatchObject({ id: fig.id, name: "Figure 1", panels: 1 });
    expect(doc.toJSON().layouts![0]!.columns).toBe(2);
  });

  it("reports a missing figure rather than silently doing nothing", () => {
    const [doc, tid] = docWithTable();
    const gid = (val(executeAgentCommand(doc, { op: "createGraph", name: "G", table: tid })) as { id: string }).id;
    const bad = executeAgentCommand(doc, { op: "addFigurePanel", figure: "no-such-figure", graph: gid });
    expect(bad.ok).toBe(false);
  });
});

describe("project structure", () => {
  it("adds a folder and an experiment, and renames both", () => {
    const doc = new MadyDocument();

    const folder = val(executeAgentCommand(doc, { op: "addFolder", name: "Study" })) as { id: string };
    const exp = val(executeAgentCommand(doc, { op: "addExperiment", folder: folder.id, name: "Run 1" })) as { id: string };

    val(executeAgentCommand(doc, { op: "renameFolder", folder: folder.id, name: "Study A" }));
    val(executeAgentCommand(doc, { op: "renameExperiment", folder: folder.id, experiment: exp.id, name: "Run 2" }));

    const f = doc.toJSON().workspace.folders.find((x) => x.id === folder.id)!;
    expect(f.name).toBe("Study A");
    expect(f.experiments.find((e) => e.id === exp.id)!.name).toBe("Run 2");
  });

  it("reports a missing folder as not_found", () => {
    const doc = new MadyDocument();
    const bad = executeAgentCommand(doc, { op: "renameFolder", folder: "nope", name: "X" });
    expect(bad.ok).toBe(false);
  });
});
