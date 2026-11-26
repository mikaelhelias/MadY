import { expect, it } from "vitest";
import { MadySession } from "./session";
it("rejects an injected malformed result and retains the prior result with an error status", async () => {
  const session = new MadySession({ engine: { request: async () => ({ garbage: true }) } });
  const doc = session.document;
  const t = doc.importTable("T", "column", ["Y"], [[1],[2],[3]]);
  const a = doc.addAnalysis("Mean", "describe", t.id, { columns: [t.columns[0]!.id] });
  const prior = { method: "describe", title: "Mean", terms: [], glance: {}, summary: "Prior result" };
  doc.setAnalysisResult(a.id, prior);
  expect(await session.compute({ analysisId: a.id })).toMatchObject({ ok: false, code: "engine_internal" });
  expect(a.status).toBe("error");
  expect(a.result).toBe(prior);
});

it("an analysis with no column list is refused in words that say what to send, before the engine is asked", async () => {
  let asked = false;
  const session = new MadySession({ engine: { request: async () => { asked = true; return {}; } } });
  const doc = session.document;
  const t = doc.importTable("T", "xy", ["X", "Y"], [[1, 2], [2, 4], [3, 6]]);
  const a = doc.addAnalysis("Fit", "regression", t.id, {} as never);
  const stored = await session.compute({ analysisId: a.id });
  expect(stored).toMatchObject({ ok: false, code: "bad_request" });
  expect((stored as { error: string }).error).toMatch(/params\.columns/);
  const adHoc = await session.compute({ method: "regression", table: t.id, params: {} as never });
  expect(adHoc).toMatchObject({ ok: false, code: "bad_request" });
  expect(asked, "the engine was asked with no columns").toBe(false);
});
