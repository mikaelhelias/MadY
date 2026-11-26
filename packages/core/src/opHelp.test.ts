import { describe, expect, it } from "vitest";
import { OP_HELP, PROMPT_EXAMPLES } from "./opHelp";
import { agentApiSchema } from "./agentApi";
import { STYLE_PRESETS } from "./presets";
import { buildPrompt, forbiddenOps } from "./modelCompiler";
import { CORPUS_CONTEXT } from "./commandCorpus";

/**
 * Default-deny. A new op reaching a model as a bare name tells the model nothing about what it
 * does — so an op with no help text fails the build rather than quietly degrading the prompt.
 */
describe("every op a model is offered has help text", () => {
  it("no non-destructive op is missing from OP_HELP", () => {
    const missing = agentApiSchema()
      .filter((m) => !m.destructive)
      .map((m) => m.op)
      .filter((op) => OP_HELP[op] === undefined);
    expect(
      missing,
      "these ops would reach the model as a bare name, with nothing saying what they do:\n  - " +
        missing.join("\n  - "),
    ).toEqual([]);
  });

  it("and no destructive op has help — describing a door that is not offered", () => {
    for (const op of forbiddenOps()) expect(OP_HELP[op as keyof typeof OP_HELP], op).toBeUndefined();
  });

  it("the ops with a free-form object say what may go in it", () => {
    // `patch` / `annotation` / `style` are where a model invents field names, and an invented
    // field is silently ignored by the builder — the worst kind of failure.
    for (const op of ["setAxis", "setGraphOptions", "addAnnotation", "setFont", "setLegend"] as const) {
      expect(OP_HELP[op]?.keys, op).toBeTruthy();
    }
  });
});

describe("the prompt actually carries it", () => {
  const prompt = (): string => buildPrompt("make it a bar chart", CORPUS_CONTEXT, { kinds: ["bar", "violin", "box"] });

  it("describes each op, not just its name", () => {
    // A bare signature such as `- setAxis (needs id, axis, patch)` tells the model nothing.
    expect(prompt()).toContain("setAxis: change one axis of a graph");
    expect(prompt()).toContain("setGraphOptions: change a graph's own settings");
  });

  it("names the keys of the free-form objects", () => {
    const p = prompt();
    expect(p).toContain("patch may contain: title, scale");
    expect(p).toContain("annotation may contain: kind (REQUIRED");
  });

  it("lists the chart kinds when they are supplied, and omits the line when not", () => {
    expect(prompt()).toContain("Chart kinds for setGraphKind: bar, violin, box");
    expect(buildPrompt("x", CORPUS_CONTEXT)).not.toContain("Chart kinds for setGraphKind");
  });

  it("carries worked examples", () => {
    const p = prompt();
    expect(p).toContain("EXAMPLES:");
    for (const e of PROMPT_EXAMPLES) expect(p).toContain(e.answer);
  });

  it("names the style presets — the same gap that listing the chart kinds closes", () => {
    // Style/print requests ("the journal wants it in black and white") fail when the prompt
    // says a preset is "named" but never names one.
    const p = prompt();
    for (const preset of STYLE_PRESETS) expect(p, preset.name).toContain(preset.name);
  });

  it("states the rule for a commonly confused pair of fields", () => {
    // Title-of-the-graph vs title-of-the-axis is confused without an explicit rule.
    expect(prompt()).toContain("setGraphOptions patch.title");
    expect(prompt()).toContain("setAxis patch.title");
  });

  it("still never offers a destructive op", () => {
    const p = buildPrompt("delete everything", CORPUS_CONTEXT, { kinds: ["bar"] });
    for (const op of forbiddenOps()) expect(p, op).not.toContain(op);
  });

  it("the worked examples reuse no request of the command corpus, so a model scored on the corpus is not just copying them", async () => {
    const { COMMAND_CORPUS } = await import("./commandCorpus");
    const asks = new Set(PROMPT_EXAMPLES.map((e) => e.ask.toLowerCase()));
    for (const c of COMMAND_CORPUS) expect(asks.has(c.request.toLowerCase()), c.id).toBe(false);
  });
});
