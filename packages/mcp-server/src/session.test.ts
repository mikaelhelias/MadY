import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MadySession } from "./session";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "mady-mcp-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

/** Configure a `describe` analysis on a fresh one-column table; return the ids. */
function seedAnalysis(session: MadySession): { tableId: string; colId: string; analysisId: string } {
  const t = session.exec({ op: "createTable", name: "T", columns: ["v"], rows: [[1], [2], [3], [4]] }) as {
    ok: true;
    value: { id: string };
  };
  const tableId = t.value.id;
  const colId = session.document.toJSON().tables[0]!.columns[0]!.id;
  const a = session.exec({
    op: "runAnalysis",
    name: "Describe v",
    method: "describe",
    table: tableId,
    params: { columns: [colId], conf: 0.95 },
  }) as { ok: true; value: { id: string } };
  return { tableId, colId, analysisId: a.value.id };
}

describe("project lifecycle", () => {
  it("saves and re-opens a project round-trip", async () => {
    const a = new MadySession();
    a.exec({ op: "createTable", name: "Data", columns: ["x", "y"], rows: [[1, 2]] });
    const path = join(dir, "proj.mady");
    const saved = await a.saveProject(path);
    expect(saved.ok).toBe(true);

    // The file is real JSON on disk.
    const raw = JSON.parse(await readFile(path, "utf8")) as { tables: unknown[] };
    expect(raw.tables).toHaveLength(1);

    const b = new MadySession();
    const opened = await b.openProject(path);
    expect(opened.ok).toBe(true);
    expect(b.summary().tables).toHaveLength(1);
  });

  it("save_project without a path or open project fails cleanly", async () => {
    const s = new MadySession();
    const res = await s.saveProject();
    expect(res.ok).toBe(false);
  });

  it("open_project on a missing file fails cleanly (no throw)", async () => {
    const s = new MadySession();
    const res = await s.openProject(join(dir, "nope.mady"));
    expect(res.ok).toBe(false);
  });
});

describe("compute (with an injected fake engine)", () => {
  it("rejects an obsolete result after data edits", async () => {
    let finish!: (result: Record<string, unknown>) => void;
    const s = new MadySession({ engine: { request: () => new Promise(resolve => { finish = resolve; }) } });
    const { tableId, colId, analysisId } = seedAnalysis(s);
    const pending = s.compute({ analysisId });
    const table = s.document.toJSON().tables[0]!;
    s.document.setCell(tableId, table.rows[0]!.id, colId, 100);
    finish({ method: "describe", title: "Description", terms: [], glance: {}, summary: "Mean 2.5" });
    expect(await pending).toMatchObject({ ok: false, code: "stale_result" });
    expect(s.document.toJSON().analyses[0]!.result).toBeUndefined();
  });

  it("cannot attach a pending result to a replacement project with reused ids", async () => {
    let finish!: (result: Record<string, unknown>) => void;
    const s = new MadySession({ engine: { request: () => new Promise(resolve => { finish = resolve; }) } });
    const { analysisId } = seedAnalysis(s);
    const pending = s.compute({ analysisId });
    s.newProject();
    expect(seedAnalysis(s).analysisId).toBe(analysisId);
    finish({ method: "describe", title: "Description", terms: [], glance: {}, summary: "Old project result" });
    expect(await pending).toMatchObject({ ok: false, code: "stale_result" });
    expect(s.document.toJSON().analyses[0]!.result).toBeUndefined();
  });
  it("builds the payload with buildAnalysisData and stores the result on the analysis", async () => {
    let seenMethod = "";
    let seenData: Record<string, unknown> | undefined;
    const engine = {
      request: async (method: string, data?: Record<string, unknown>) => {
        seenMethod = method;
        seenData = data;
        return { method: "describe", title: "Description", glance: {}, summary: "mean 2.5", terms: [{ term: "mean", value: 2.5 }] };
      },
    };
    const session = new MadySession({ engine });
    const { analysisId } = seedAnalysis(session);

    const res = await session.compute({ analysisId });
    expect(res.ok).toBe(true);
    expect(res.stored).toBe(true);
    // The engine saw the method + the exact payload buildAnalysisData produces for describe.
    expect(seenMethod).toBe("describe");
    expect(seenData).toEqual({ values: [1, 2, 3, 4], conf: 0.95 });

    // The result landed on the document (status ok, result attached).
    const a = session.document.toJSON().analyses[0]!;
    expect(a.status).toBe("ok");
    expect((a.result as { summary?: string }).summary).toBe("mean 2.5");
  });

  it("supports an ad-hoc compute (method+table+params) without storing", async () => {
    const engine = { request: async () => ({ method: "describe", title: "Description", terms: [], glance: {}, summary: "ok" }) };
    const session = new MadySession({ engine });
    session.exec({ op: "createTable", name: "T", columns: ["v"], rows: [[5], [7]] });
    const colId = session.document.toJSON().tables[0]!.columns[0]!.id;
    const tableId = session.document.toJSON().tables[0]!.id;

    const res = await session.compute({ method: "describe", table: tableId, params: { columns: [colId], conf: 0.9 } });
    expect(res.ok).toBe(true);
    expect(res.stored).toBe(false);
    expect(session.document.toJSON().analyses).toHaveLength(0); // nothing persisted
  });

  it("an engine failure is returned as a typed value and recorded on the analysis", async () => {
    const engine = {
      request: async () => {
        throw Object.assign(new Error("boom"), { code: "numerical" });
      },
    };
    const session = new MadySession({ engine });
    const { analysisId } = seedAnalysis(session);

    const res = await session.compute({ analysisId });
    expect(res.ok).toBe(false);
    expect(res.code).toBe("numerical");
    expect(session.document.toJSON().analyses[0]!.status).toBe("error");
  });

  it("compute with neither an id nor a full ad-hoc spec is a bad_request", async () => {
    const session = new MadySession({ engine: { request: async () => ({}) } });
    const res = await session.compute({});
    expect(res.ok).toBe(false);
    expect(res.code).toBe("bad_request");
  });

  it("compute for an unknown analysis id is not_found", async () => {
    const session = new MadySession({ engine: { request: async () => ({}) } });
    const res = await session.compute({ analysisId: "nope" });
    expect(res.ok).toBe(false);
    expect(res.code).toBe("not_found");
  });
});
