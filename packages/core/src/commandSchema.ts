/**
 * Constrained decoding — make invalid output impossible for the model, rather than relying on it.
 *
 * A JSON Schema for "an array of MadY commands", handed to the model server as its `format`. A
 * runtime that supports constrained decoding (Ollama, llama.cpp's grammars) then cannot emit a
 * token that would break the schema: an invented op name, a misspelt field, a preset that does
 * not exist become impossible rather than merely refused.
 *
 * Why this rather than a bigger model: unconstrained, models of every size emit some invalid
 * commands, and smaller ones more. The typical failures are not reasoning failures — they are
 * `setAxis` where `setGraphKind` belongs, and invented enum values. That is precisely the class a schema removes, and it removes it at
 * every model size.
 *
 * ## What it constrains, and what it cannot
 *
 *  - **`op`** — a const per branch, so only the real ops exist. This alone removes the whole
 *    "invented command" class.
 *  - **required fields** — present, per op, from `agentApiSchema()`.
 *  - **the enums this package actually knows** — axis, sort direction, column type, font
 *    element, and the style-preset names, all derived from the live registries rather than
 *    copied. A copied list is a list that goes stale.
 *  - **plot kinds** — only if the caller passes them. Note: `PlotKind` is a type-only union with no
 *    runtime array in this package, and inventing a hardcoded copy here is exactly the drift
 *    this file argues against. The app and the MCP server both have a real list; they inject it.
 *
 * It does not make the model correct. A schema stops `setAxis` being spelt `set_axis`; it
 * cannot stop the model choosing `setAxis` when the user asked for a bar chart. `refuseReason`
 * in modelCompiler.ts is still the authority — destructive ops are refused there whatever any
 * schema says, and nothing here is trusted in its place.
 *
 * Destructive ops are not in the schema at all. Same rule as the prompt: a model is never
 * shown the vocabulary for deleting the user's work.
 */
import { agentApiSchema, COLUMN_TYPES, FONT_ELEMENTS } from "./agentApi";
import { STYLE_PRESETS } from "./presets";

/** A JSON Schema fragment. Kept `unknown`-valued: this is data for a model server, not a type. */
export type JsonSchema = Record<string, unknown>;

export interface CommandSchemaOptions {
  /**
   * The plot kinds a `kind` field may take. Omit and `kind` is left an unconstrained string.
   * Note: injected on purpose — see the note above about not copying a type-only union.
   */
  kinds?: readonly string[];
  /** Cap the array length, mirroring the compiler's own batch cap. */
  maxCommands?: number;
}

/** Field name → the schema for it, where this package can say something real about the type. */
function fieldSchema(field: string, opts: CommandSchemaOptions): JsonSchema {
  switch (field) {
    case "axis":
      return { type: "string", enum: ["x", "y", "y2", "y3"] };
    case "direction":
      return { type: "string", enum: ["asc", "desc"] };
    case "type":
      return { type: "string", enum: [...COLUMN_TYPES] };
    case "element":
      return { type: "string", enum: [...FONT_ELEMENTS] };
    case "preset":
      // From the live registry. A model cannot invent a preset name or misspell "Grayscale".
      return { type: "string", enum: STYLE_PRESETS.map((p) => p.name) };
    case "kind":
      return opts.kinds && opts.kinds.length > 0
        ? { type: "string", enum: [...opts.kinds] }
        : { type: "string" };
    case "patch":
    case "style":
    case "params":
    case "annotation":
      return { type: "object" };
    case "values":
    case "commands":
      return { type: "array" };
    case "rows":
      return { type: "array", items: { type: "array" } };
    case "columns":
      return { type: "array", items: { type: "string" } };
    case "cells":
      return {
        type: "array",
        items: {
          type: "object",
          properties: { row: { type: "string" }, column: { type: "string" } },
          required: ["row", "column"],
        },
      };
    case "excluded":
      return { type: "boolean" };
    case "limit":
    case "offset":
      return { type: "number" };
    case "value":
      // A cell: number, text, or cleared.
      return { type: ["number", "string", "null"] };
    default:
      // Ids and names. Everything an op requires that is not listed above is a string.
      return { type: "string" };
  }
}

/**
 * The schema for one command array.
 *
 * `oneOf` with a `const` op per branch is what makes the op name unforgeable — a plain
 * `enum` on a shared `op` field would let the model pair any op with any other op's fields.
 */
export function buildCommandSchema(opts: CommandSchemaOptions = {}): JsonSchema {
  const branches: JsonSchema[] = [];
  for (const meta of agentApiSchema()) {
    // Never show a model how to delete. Same rule as buildPrompt.
    if (meta.destructive) continue;
    const properties: Record<string, JsonSchema> = { op: { const: meta.op } };
    for (const field of meta.required) properties[field] = fieldSchema(field, opts);
    branches.push({
      type: "object",
      properties,
      required: ["op", ...meta.required],
    });
  }
  return {
    type: "array",
    ...(opts.maxCommands !== undefined ? { maxItems: opts.maxCommands } : {}),
    items: { oneOf: branches },
  };
}

/** Every op the schema admits — the mirror of `forbiddenOps()`, for tests and other callers. */
export function schemaOps(schema: JsonSchema): string[] {
  const items = schema.items as { oneOf?: { properties?: { op?: { const?: unknown } } }[] } | undefined;
  return (items?.oneOf ?? []).map((b) => String(b.properties?.op?.const)).filter((s) => s !== "undefined");
}
