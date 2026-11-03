/**
 * A graph made or edited through the tools carries the same "Out of date" flag the app would give it.
 *
 * A new graph starts out of date. The app re-derives every graph's flag after each edit, so a graph drawn from its table
 * is current as soon as the edit lands; the tools do the same after each edit, so a graph made through them is saved,
 * and reopened in the app, as current. A graph drawn from an analysis result must still say so until that
 * result is computed. The same pass recomputes the tables derived from an edited one and re-makes the small graphs
 * split from an edited graph, as the app does; a change made directly on a small graph is undone and refused in words.
 */
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { MadyDocument } from "@mady/core";
import { MadySession } from "./session";
import { buildTools } from "./tools";

let dir: string | undefined;
afterEach(async () => { if (dir) await rm(dir, { recursive: true, force: true }); dir = undefined; });

/** A saved project holding a two-series graph split into small graphs (as the app makes it), opened through the tools. */
const openWithSmallGraphs = async () => {
  const doc = new MadyDocument();
  const t = doc.importTable("Two", "xy", ["x", "a", "b"], [[1, 2, 3], [2, 4, 5], [3, 9, 7]]);
  const g = doc.addPlot("both", t.id);
  const { plots } = doc.splitIntoSmallGraphs(g.id);
  dir = await mkdtemp(join(tmpdir(), "mady-small-graphs-"));
  const path = join(dir, "p.mady");
  await writeFile(path, JSON.stringify(doc.toJSON()));
  const session = new MadySession();
  expect((await session.openProject(path)).ok).toBe(true);
  const tools = buildTools(session);
  const call = (name: string, args: Record<string, unknown>) => tools.find((x) => x.name === name)!.handler(args) as Promise<{ ok: boolean; error?: string }>;
  return { session, call, original: g.id, copies: plots.map((p) => p.id) };
};

const setup = async () => {
  const session = new MadySession();
  const tools = buildTools(session);
  const call = (name: string, args: Record<string, unknown>) => tools.find((t) => t.name === name)!.handler(args) as Promise<{ ok: boolean; value?: { id: string } }>;
  const t = await call("create_table", { name: "T", kind: "xy", columns: ["x", "y"], rows: [[1, 2], [2, 4], [3, 9]] });
  const g = await call("create_graph", { name: "g", table: t.value!.id, kind: "xy" });
  // What save_project writes: the document as JSON.
  const saved = () => JSON.parse(JSON.stringify(session.document.toJSON())) as { plots: { id: string; status: string }[] };
  const status = () => saved().plots.find((p) => p.id === g.value!.id)!.status;
  return { session, call, gid: g.value!.id, tid: t.value!.id, status };
};

describe("graph status through the tools", () => {
  it("a graph made through the tools is saved current", async () => {
    const { status } = await setup();
    expect(status()).toBe("ok");
  });

  it("stays current through a style edit and a data edit", async () => {
    const { call, session, gid, tid, status } = await setup();
    await call("set_axis", { id: gid, axis: "y", patch: { title: "Y" } });
    expect(status()).toBe("ok");
    const table = session.document.toJSON().tables.find((t) => t.id === tid)!;
    await call("set_cell", { table: tid, row: table.rows[0]!.id, column: table.columns[1]!.id, value: 5 });
    expect(status()).toBe("ok");
  });

  it("a batch leaves its graphs current too", async () => {
    const { session, tid } = await setup();
    session.execBatch([{ op: "createGraph", name: "g2", table: tid, kind: "bar" }]);
    expect(session.document.toJSON().plots.map((p) => p.status)).toEqual(["ok", "ok"]);
  });

  it("a table derived from the edited one is recomputed, as in the app, and a graph of it stays current", async () => {
    const { call, session, tid } = await setup();
    // A project opened with a live transform (the tools cannot make one, the app can): log10 of y.
    const derived = session.document.deriveTable("T (log)", { source: tid, op: "transform", spec: { fn: "log10", columns: [1] } });
    const g = await call("create_graph", { name: "logs", table: derived.id, kind: "xy" });
    const src = session.document.toJSON().tables.find((t) => t.id === tid)!;
    await call("set_cell", { table: tid, row: src.rows[0]!.id, column: src.columns[1]!.id, value: 100 });
    const p = session.document.toJSON();
    const d = p.tables.find((t) => t.id === derived.id)!;
    expect(d.status, "the derived table was left out of date").toBe("ok");
    expect(d.rows[0]!.cells[d.columns[1]!.id], "the derived table still holds the old value").toBeCloseTo(2, 10);
    expect(p.plots.find((x) => x.id === g.value!.id)!.status).toBe("ok");
  });

  it("small graphs split from a graph are re-made from it after an edit through the tools, as in the app", async () => {
    const { session, call, original, copies } = await openWithSmallGraphs();
    await call("set_axis", { id: original, axis: "y", patch: { title: "Signal" } });
    const now = session.document.toJSON().plots.filter((p) => copies.includes(p.id));
    expect(now.map((c) => c.yAxis?.title), "a small graph did not follow its original").toEqual(copies.map(() => "Signal"));
  });

  it("a change made directly on a small graph is undone and the reply says so, not ok", async () => {
    const { session, call, copies } = await openWithSmallGraphs();
    const plots = copies.map((id) => ({ id }));
    const r = (await call("set_axis", { id: plots[0]!.id, axis: "y", patch: { title: "Mine" } })) as unknown as { ok: boolean; error?: string };
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/small graph made from "both".*undone/);
    expect(session.document.toJSON().plots.find((p) => p.id === plots[0]!.id)!.yAxis?.title).toBeUndefined();
  });

  it("a graph drawn from an analysis not yet computed stays out of date", async () => {
    const { call, session, gid, tid, status } = await setup();
    const cols = session.document.toJSON().tables.find((t) => t.id === tid)!.columns.map((c) => c.id);
    const an = await call("run_analysis", { name: "Fit", method: "linear", table: tid, params: { columns: cols } });
    expect((await call("set_fit", { id: gid, fit: { label: "Fit", points: [[1, 2], [3, 9]], analysisSource: an.value!.id } })).ok).toBe(true);
    expect(status()).toBe("stale");
    await call("set_axis", { id: gid, axis: "y", patch: { title: "Y" } });
    expect(status(), "an edit cleared the flag of a graph whose analysis has no result").toBe("stale");
  });
});
