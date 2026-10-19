import { describe, expect, it, vi } from "vitest";
import {
  allowedOps,
  buildPrompt,
  extractCommands,
  forbiddenOps,
  makeModelCompiler,
  refuseReason,
  type LocalModel,
} from "./modelCompiler";
import type { NLContext } from "./nlCompiler";

/**
 * These tests treat the model as an attacker, because that is the realistic threat model.
 *
 * A language model asked for JSON will sometimes emit a plausible command nobody asked for, and
 * no prompt wording prevents that entirely. So the fake model below is
 * used to emit exactly the outputs that would hurt — a delete, an invented op, a `confirm: true`,
 * a hundred commands at once — and every one must be refused before anything reaches the
 * executor.
 *
 * The most important test in the file is the delete one. The deterministic parser leaves delete
 * verbs out on purpose; a model must not become the back door around that.
 */
const CTX: NLContext = {
  tables: [{ id: "t1", name: "Doses", columns: [{ id: "c1", name: "Dose" }, { id: "c2", name: "Response" }] }],
  activeTableId: "t1",
  activeGraphId: "g1",
};

/** A model that says whatever the test tells it to. */
function fakeModel(reply: string | (() => Promise<string>)): LocalModel & { calls: () => number } {
  const complete = vi.fn(async () => (typeof reply === "string" ? reply : reply()));
  return { complete, calls: () => complete.mock.calls.length };
}

const json = (v: unknown): string => JSON.stringify(v);

describe("the deterministic parser keeps the model off the common path", () => {
  it("never calls the model when the exact parser understood the line", async () => {
    const model = fakeModel(json([{ op: "deleteTable", id: "t1", confirm: true }]));
    const compile = makeModelCompiler({ model });

    const r = await compile("make a scatter of dose vs response", CTX);

    expect(r.ok).toBe(true);
    expect(model.calls(), "the model was consulted for a line the parser handles").toBe(0);
  });

  it("falls back to the model only when the parser could not", async () => {
    const model = fakeModel(json([{ op: "setGraphKind", id: "g1", kind: "violin" }]));
    const compile = makeModelCompiler({ model });

    const r = await compile("please make it look more like a distribution thing", CTX);

    expect(model.calls()).toBe(1);
    expect(r.ok).toBe(true);
    expect(r.ok && r.commands).toEqual([{ op: "setGraphKind", id: "g1", kind: "violin" }]);
    expect(r.ok && r.note).toContain("on-device model");
  });
});

describe("what a model is never allowed to do", () => {
  it("refuses a delete, however it was asked for", async () => {
    // The line that matters. "Tidy up my project" must never become deleteTable.
    const model = fakeModel(json([{ op: "deleteTable", id: "t1", confirm: true }]));
    const compile = makeModelCompiler({ model });

    const r = await compile("tidy up my project please", CTX);

    expect(r.ok).toBe(false);
    expect(r.ok === false && r.error).toContain("destroys data");
  });

  it("refuses the whole batch when one command in it is destructive", async () => {
    // Running the acceptable prefix would leave the project half-changed in a way nobody
    // previewed — worse than doing nothing.
    const model = fakeModel(json([
      { op: "setGraphKind", id: "g1", kind: "bar" },
      { op: "deleteGraph", id: "g1", confirm: true },
    ]));
    const compile = makeModelCompiler({ model });

    const r = await compile("redo this chart", CTX);

    expect(r.ok).toBe(false);
    expect(r.ok === false && r.error).toContain("destroys data");
  });

  it("refuses a `confirm` field on any op — a model may not consent on the user's behalf", async () => {
    const model = fakeModel(json([{ op: "setGraphKind", id: "g1", kind: "bar", confirm: true }]));
    const compile = makeModelCompiler({ model });

    const r = await compile("something the parser will not get", CTX);

    expect(r.ok).toBe(false);
    expect(r.ok === false && r.error).toContain("confirm");
  });

  it("refuses an op the program does not have, rather than hoping the executor catches it", async () => {
    const model = fakeModel(json([{ op: "sendEmail", to: "someone" }]));
    const compile = makeModelCompiler({ model });

    const r = await compile("something the parser will not get", CTX);

    expect(r.ok).toBe(false);
    expect(r.ok === false && r.error).toContain("not a command this program has");
  });

  it("caps the batch, so one confused completion cannot emit a hundred edits", async () => {
    const many = Array.from({ length: 40 }, () => ({ op: "setGraphKind", id: "g1", kind: "bar" }));
    const compile = makeModelCompiler({ model: fakeModel(json(many)), maxCommands: 12 });

    const r = await compile("something the parser will not get", CTX);

    expect(r.ok).toBe(false);
    expect(r.ok === false && r.error).toContain("limit is 12");
  });

  it("the forbidden set is derived from the schema, not a hand-kept list", () => {
    // A new destructive op must be refused automatically. A copied list would go stale silently.
    const forbidden = forbiddenOps();
    expect(forbidden.has("deleteTable")).toBe(true);
    expect(forbidden.has("deleteRow")).toBe(true); // derived from the schema; this file does not list it
    expect(allowedOps().some((o) => o.op.startsWith("delete"))).toBe(false);
  });
});

describe("reading what the model actually sent back", () => {
  it("finds the array inside prose and a code fence", () => {
    const reply = 'Sure! Here you go:\n```json\n[{"op":"listGraphs"}]\n```\nHope that helps.';
    expect(extractCommands(reply)).toEqual([{ op: "listGraphs" }]);
  });

  it("is not fooled by a bracket inside a string", () => {
    const reply = '[{"op":"setGraphOptions","id":"g1","patch":{"title":"a ] bracket"}}]';
    expect(extractCommands(reply)).toEqual([
      { op: "setGraphOptions", id: "g1", patch: { title: "a ] bracket" } },
    ]);
  });

  it("returns null for a reply with no array, and for malformed JSON", () => {
    expect(extractCommands("I am afraid I cannot do that")).toBeNull();
    expect(extractCommands("[{op: listGraphs}]")).toBeNull();
  });

  it("an empty array is an explicit 'I could not', not a silent success", async () => {
    const compile = makeModelCompiler({ model: fakeModel("[]") });
    const r = await compile("something the parser will not get", CTX);
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.error).toContain("neither the built-in command reader nor the local model");
  });

  it("a model that throws is reported, not propagated", async () => {
    const model = fakeModel(() => Promise.reject(new Error("no model loaded")));
    const compile = makeModelCompiler({ model });

    const r = await compile("something the parser will not get", CTX);

    expect(r.ok).toBe(false);
    expect(r.ok === false && r.error).toContain("no model loaded");
  });
});

describe("the prompt", () => {
  it("lists the real ops and the project's real ids", () => {
    const prompt = buildPrompt("make a bar chart", CTX);
    expect(prompt).toContain("createGraph");
    expect(prompt).toContain("t1");
    expect(prompt).toContain("Response");
  });

  it("never offers a destructive op to the model in the first place", () => {
    // Defence in depth: refuseReason is the control, but the model should not be shown the
    // vocabulary at all. A prompt that lists deleteTable invites the very command the compiler then refuses.
    const prompt = buildPrompt("delete everything", CTX);
    for (const op of forbiddenOps()) expect(prompt, op).not.toContain(op);
  });
});

describe("refuseReason", () => {
  const forbidden = forbiddenOps();
  const known = new Set(allowedOps().map((o) => o.op).concat([...forbidden]));

  it("rejects non-objects and missing ops", () => {
    expect(refuseReason("listGraphs", forbidden, known)).toContain("JSON object");
    expect(refuseReason([], forbidden, known)).toContain("JSON object");
    expect(refuseReason({}, forbidden, known)).toContain("string 'op'");
  });

  it("allows an ordinary constructive command", () => {
    expect(refuseReason({ op: "listGraphs" }, forbidden, known)).toBeNull();
  });
});
