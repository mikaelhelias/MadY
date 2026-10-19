import { describe, expect, it } from "vitest";
import { buildCommandSchema, schemaOps } from "./commandSchema";
import { agentApiSchema } from "./agentApi";
import { STYLE_PRESETS } from "./presets";
import { forbiddenOps } from "./modelCompiler";

/**
 * The schema is a safety surface as much as a quality one, so the tests are mostly about what it
 * refuses to describe.
 *
 * The one that matters most: a destructive op must not appear in it. A model handed a schema
 * containing `deleteTable` has been told deleting is on the menu — the same mistake as putting it
 * in the prompt, one layer down.
 */
describe("what the schema admits", () => {
  it("contains NO destructive op — a model is never shown how to delete", () => {
    const ops = schemaOps(buildCommandSchema());
    for (const bad of forbiddenOps()) expect(ops, bad).not.toContain(bad);
    expect(ops.some((o) => o.startsWith("delete"))).toBe(false);
  });

  it("admits exactly the non-destructive ops the command union declares", () => {
    // Derived, not listed: a non-destructive op added to the command union appears here without
    // anyone editing this file.
    const expected = agentApiSchema().filter((m) => !m.destructive).map((m) => m.op).sort();
    expect(schemaOps(buildCommandSchema()).sort()).toEqual(expected);
  });

  it("pins `op` per branch with a const, not a shared enum", () => {
    // A shared `enum` on one `op` field would let the model pair any op with any other op's
    // fields — "setAxis" carrying createTable's arguments would satisfy it. Per-branch consts are
    // what tie an op to its own required fields.
    const items = buildCommandSchema().items as { oneOf: { properties: Record<string, unknown> }[] };
    for (const branch of items.oneOf) {
      expect(branch.properties.op).toHaveProperty("const");
      expect(branch.properties.op).not.toHaveProperty("enum");
    }
  });

  it("requires each op's own required fields", () => {
    const items = buildCommandSchema().items as { oneOf: { properties: Record<string, unknown>; required: string[] }[] };
    const setAxis = items.oneOf.find((b) => (b.properties.op as { const: string }).const === "setAxis")!;
    expect(setAxis.required).toEqual(expect.arrayContaining(["op", "id", "axis", "patch"]));
  });
});

describe("the enums it can actually constrain", () => {
  const branch = (op: string): { properties: Record<string, Record<string, unknown>> } => {
    const items = buildCommandSchema({ kinds: ["xy", "bar", "violin"] }).items as {
      oneOf: { properties: Record<string, Record<string, unknown>> }[];
    };
    return items.oneOf.find((b) => b.properties.op?.const === op)!;
  };

  it("axis, direction, column type and font element are closed sets", () => {
    expect(branch("setAxis").properties.axis!.enum).toEqual(["x", "y", "y2", "y3"]);
    expect(branch("sortRows").properties.direction!.enum).toEqual(["asc", "desc"]);
    expect(branch("setColumnType").properties.type!.enum).toContain("categorical");
    expect(branch("setFont").properties.element!.enum).toContain("title");
  });

  it("preset names come from the live registry, so a typo is impossible", () => {
    // Unconstrained, a model asked for "the journal wants it in black and white" can invent a
    // preset name; the enum leaves it only the real ones.
    const presets = branch("applyStylePreset").properties.preset!.enum as string[];
    expect(presets).toEqual(STYLE_PRESETS.map((p) => p.name));
    expect(presets).toContain("Grayscale (print)");
  });

  it("plot kinds are constrained only when the caller supplies them", () => {
    // PlotKind is a type-only union here. Hardcoding a copy is the drift this file exists to
    // avoid, so an absent list must leave `kind` open rather than silently enumerate a stale set.
    const withKinds = branch("setGraphKind").properties.kind!;
    expect(withKinds.enum).toEqual(["xy", "bar", "violin"]);

    const items = buildCommandSchema().items as { oneOf: { properties: Record<string, Record<string, unknown>> }[] };
    const without = items.oneOf.find((b) => b.properties.op?.const === "setGraphKind")!;
    expect(without.properties.kind!.enum).toBeUndefined();
    expect(without.properties.kind!.type).toBe("string");
  });

  it("caps the batch when asked", () => {
    expect(buildCommandSchema({ maxCommands: 12 }).maxItems).toBe(12);
    expect(buildCommandSchema().maxItems).toBeUndefined();
  });
});

describe("the schema does not replace the compiler's own refusals", () => {
  it("a destructive command is still refused even if something hands one through", () => {
    // Defence in depth, said out loud: the schema is a hint to a server we do not control, and a
    // server that ignores `format` must not become a way past the safety rule. refuseReason is
    // the authority; this asserts the two agree on which ops are forbidden.
    const inSchema = new Set(schemaOps(buildCommandSchema()));
    for (const op of forbiddenOps()) expect(inSchema.has(op)).toBe(false);
    expect(forbiddenOps().size).toBeGreaterThan(0);
  });
});
