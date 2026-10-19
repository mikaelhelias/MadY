// @vitest-environment node
import { describe, expect, it } from "vitest";
import { MadyDocument } from "@mady/core";
import type { AgentResult } from "@mady/core";
import { installAgentBridge, type AgentBridge } from "./agentBridge";

/** A real doc + a mutate-like `apply` that records how many times it ran (a real mutate
 *  would recompute derived tables and re-render here). */
function harness(active: { tableId?: string; graphId?: string } = {}) {
  const doc = new MadyDocument();
  let applies = 0;
  const apply = (fn: (d: MadyDocument) => void): void => {
    applies += 1;
    fn(doc);
  };
  const target: Record<string, unknown> = {};
  const dispose = installAgentBridge(target, apply, "Agent", () => active);
  return { doc, target, dispose, applies: () => applies, setActive: (a: typeof active) => Object.assign(active, a) };
}

describe("installAgentBridge", () => {
  it("installs window.madyAgent with execute/batch/schema and the edition", () => {
    const { target } = harness();
    const bridge = target.madyAgent as AgentBridge;
    expect(typeof bridge.execute).toBe("function");
    expect(typeof bridge.batch).toBe("function");
    expect(typeof bridge.schema).toBe("function");
    expect(bridge.edition).toBe("Agent");
    expect(bridge.schema().some((s) => s.op === "createGraph")).toBe(true);
  });

  it("execute drives the live document through apply (the app's mutate)", () => {
    const { doc, target, applies } = harness();
    const bridge = target.madyAgent as AgentBridge;
    const r = bridge.execute({ op: "createTable", name: "T", columns: ["a", "b"], rows: [[1, 2]] }) as AgentResult<{ id: string }>;
    expect(r.ok).toBe(true);
    expect(doc.toJSON().tables).toHaveLength(1); // the mutation landed on the real doc
    expect(applies()).toBe(1); // it went through mutate, so the UI would re-render
  });

  it("batch runs a build-on-itself sequence and returns each result", () => {
    const { doc, target } = harness();
    const bridge = target.madyAgent as AgentBridge;
    const tid = (bridge.execute({ op: "createTable", name: "T", columns: ["a"], rows: [[1]] }) as AgentResult<{ id: string }>);
    const results = bridge.batch([
      { op: "createGraph", name: "G", table: (tid as { ok: true; value: { id: string } }).value.id },
      { op: "listGraphs" },
    ]);
    expect(results.every((r) => r.ok)).toBe(true);
    expect(doc.toJSON().plots).toHaveLength(1);
  });

  it("a failure comes back as a value, without throwing out of the bridge", () => {
    const { target } = harness();
    const bridge = target.madyAgent as AgentBridge;
    expect(() => bridge.execute({ op: "nope" })).not.toThrow();
    expect(bridge.execute({ op: "nope" })).toMatchObject({ ok: false });
  });

  it("compile parses NL to commands without executing (a dry run)", () => {
    const { doc, target } = harness();
    const bridge = target.madyAgent as AgentBridge;
    doc.importTable("Kinetics", "xy", ["dose", "response"], [[1, 10], [2, 20]]);
    const r = bridge.compile("make a scatter of dose vs response");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.commands[0]).toMatchObject({ op: "createGraph", kind: "scatter" });
    expect(doc.toJSON().plots).toHaveLength(0); // dry run — nothing created
  });

  it("run compiles NL and executes it against the live doc", () => {
    const { doc, target } = harness();
    const bridge = target.madyAgent as AgentBridge;
    doc.importTable("Kinetics", "xy", ["dose", "response"], [[1, 10], [2, 20]]);
    const out = bridge.run("make a scatter of dose vs response");
    expect(out.compiled.ok).toBe(true);
    expect(out.results?.every((x) => x.ok)).toBe(true);
    expect(doc.toJSON().plots).toHaveLength(1);
    expect(doc.toJSON().plots[0]!.kind).toBe("scatter");
  });

  it("NL resolves 'the graph' through the live active-selection context", () => {
    const h = harness();
    const bridge = h.target.madyAgent as AgentBridge;
    const table = h.doc.importTable("K", "xy", ["dose", "response"], [[1, 10], [2, 20]]);
    const created = bridge.run("make a bar chart");
    const gid = (created.results?.[0] as { ok: true; value: { id: string } }).value.id;
    // point the active context at the freshly-made graph, then edit "the axis"
    h.setActive({ graphId: gid, tableId: table.id });
    const out = bridge.run("log the x axis");
    expect(out.results?.[0]?.ok).toBe(true);
    // the compiled command targeted the active graph id
    if (out.compiled.ok) expect(out.compiled.commands[0]).toMatchObject({ op: "setAxis", id: gid, axis: "x" });
  });

  it("run surfaces an NL parse failure without executing anything", () => {
    const { doc, target } = harness();
    const bridge = target.madyAgent as AgentBridge;
    const out = bridge.run("what is the weather tomorrow");
    expect(out.compiled.ok).toBe(false);
    expect(out.results).toBeUndefined();
    expect(doc.toJSON().plots).toHaveLength(0);
  });

  it("dispose removes the bridge (used on unmount)", () => {
    const { target, dispose } = harness();
    expect(target.madyAgent).toBeDefined();
    dispose();
    expect(target.madyAgent).toBeUndefined();
  });
});
