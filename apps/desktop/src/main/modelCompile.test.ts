/**
 * `model:compile` — the one path a typed line takes: the exact parser first, the model second,
 * and no model at all when none is configured. This tests the wiring choice (which compiler,
 * with what options); the compiler's own refusals are tested in core (`modelCompiler.test.ts`).
 */
import { describe, expect, it, vi } from "vitest";
import type { NLContext } from "@mady/core";
import { COMPILE_KINDS, compileLine, testModel } from "./modelCompile";

const CTX: NLContext = {
  tables: [{ id: "t1", name: "Dose", columns: [{ id: "c1", name: "dose" }, { id: "c2", name: "response" }] }],
  activeTableId: "t1",
  activeGraphId: "p1",
};
const URL = "http://127.0.0.1:11434";

/** A fake Ollama: records the request, answers with `reply` as the model's text. */
function fakeServer(reply: string) {
  const calls: { url: string; body: Record<string, unknown> }[] = [];
  const fetchImpl = vi.fn(async (url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown> });
    return new Response(JSON.stringify({ response: reply }), { status: 200 });
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

describe("compileLine", () => {
  it("a line the exact parser understands never reaches the model — with or without one configured", async () => {
    const s = fakeServer("[]");
    const withModel = await compileLine("log the x axis", CTX, { url: URL, model: "gemma4:12b", fetchImpl: s.fetchImpl });
    expect(withModel.ok && withModel.commands).toEqual([{ op: "setAxis", id: "p1", axis: "x", patch: { scale: "log10" } }]);
    const without = await compileLine("log the x axis", CTX, { url: URL, model: null, fetchImpl: s.fetchImpl });
    expect(without.ok && without.commands).toEqual([{ op: "setAxis", id: "p1", axis: "x", patch: { scale: "log10" } }]);
    expect(s.fetchImpl).not.toHaveBeenCalled();
  });

  it("with NO model configured, an unparseable line is the parser's own refusal, and nothing is fetched", async () => {
    const s = fakeServer("[]");
    const r = await compileLine("please tidy the figure up nicely", CTX, { url: URL, model: null, fetchImpl: s.fetchImpl });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/couldn.t parse|could not/i);
    expect(s.fetchImpl).not.toHaveBeenCalled();
  });

  it("with a model, an unparseable line goes to /api/generate for that model, constrained by the command schema, thinking off", async () => {
    const s = fakeServer(JSON.stringify([{ op: "setGraphKind", id: "p1", kind: "violin" }]));
    const r = await compileLine("I would like this shown as a violin please", CTX, { url: URL, model: "gemma4:12b", fetchImpl: s.fetchImpl });
    expect(r.ok && r.commands).toEqual([{ op: "setGraphKind", id: "p1", kind: "violin" }]);
    expect(s.calls).toHaveLength(1);
    expect(s.calls[0]!.url).toBe(`${URL}/api/generate`);
    const body = s.calls[0]!.body;
    expect(body.model).toBe("gemma4:12b");
    expect(body.think).toBe(false);
    expect(body.stream).toBe(false);
    // The schema constraint is what makes `setGraphKind` unspellable any other way.
    expect(body.format).toBeTypeOf("object");
    expect(JSON.stringify(body.format)).toContain("setGraphKind");
    // The prompt names the chart kinds, so the model can pick a real one.
    expect(String(body.prompt)).toContain("violin");
  });

  it("the model's destructive command is refused here as everywhere — the whole batch", async () => {
    const s = fakeServer(JSON.stringify([{ op: "setGraphKind", id: "p1", kind: "bar" }, { op: "deleteTable", id: "t1" }]));
    const r = await compileLine("bar it and clean up", CTX, { url: URL, model: "gemma4:12b", fetchImpl: s.fetchImpl });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/deleteTable|not allowed|refus/i);
  });

  it("a server that is down is a calm error naming the local model, not a throw", async () => {
    const down = vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch;
    const r = await compileLine("something the parser cannot read at all", CTX, { url: URL, model: "gemma4:12b", fetchImpl: down });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/local model/i);
  });

  it("a non-loopback url is refused before any request", async () => {
    const s = fakeServer("[]");
    const r = await compileLine("anything", CTX, { url: "http://models.example.com", model: "gemma4:12b", fetchImpl: s.fetchImpl });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/loopback|this machine/i);
    expect(s.fetchImpl).not.toHaveBeenCalled();
  });

  it("the kind list handed to the model is the option catalogue's, not a hand copy", () => {
    expect(COMPILE_KINDS.length).toBeGreaterThan(30);
    expect(COMPILE_KINDS).toContain("violin");
    expect(COMPILE_KINDS).toContain("scatter");
  });
});

describe("testModel — the tiny round trip every set-up ends with", () => {
  it("asks the model for one word and reports ok with the time taken", async () => {
    const s = fakeServer("OK");
    const r = await testModel({ url: URL, model: "gemma4:12b", fetchImpl: s.fetchImpl });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.ms).toBeGreaterThanOrEqual(0);
    expect(s.calls[0]!.body.model).toBe("gemma4:12b");
    expect(s.calls[0]!.body.think).toBe(false);
  });

  it("a server that is down, or a null model, is a calm failure with the reason", async () => {
    const down = vi.fn(async () => { throw new Error("ECONNREFUSED"); }) as unknown as typeof fetch;
    const r = await testModel({ url: URL, model: "gemma4:12b", fetchImpl: down });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("ECONNREFUSED");
    const none = await testModel({ url: URL, model: null });
    expect(none.ok).toBe(false);
  });

  it("a non-loopback url is refused without a request", async () => {
    const s = fakeServer("OK");
    const r = await testModel({ url: "http://models.example.com", model: "gemma4:12b", fetchImpl: s.fetchImpl });
    expect(r.ok).toBe(false);
    expect(s.fetchImpl).not.toHaveBeenCalled();
  });
});
