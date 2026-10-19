/**
 * An agent command in the words the model bar's popover shows AFTER applying it.
 *
 * The bar applies at once and shows what it did, with Undo beside it (no
 * preview click). That only works if the list is readable at a glance: names not ids, the axis
 * and what changed, never raw JSON for the ops people actually type. Anything else gets a
 * readable fallback — the op's plain name and its fields as "key → value".
 */

import { methodLabel, VARIANTS } from "./AnalyzeDialog";

export interface NameLookup {
  tables: { id: string; name: string }[];
  graphs: { id: string; name: string }[];
}

const nameOf = (list: { id: string; name: string }[], id: unknown): string => {
  const s = String(id);
  return list.find((x) => x.id === s)?.name ?? s;
};

const quote = (s: unknown): string => `“${String(s)}”`;

/** `setLegend` → "legend", `applyStylePreset` → "style preset". */
const plainOp = (op: string): string =>
  op
    .replace(/^(set|apply|add|update|remove|create|run|list|get)(?=[A-Z])/, "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .trim();

const fields = (patch: unknown): string =>
  typeof patch === "object" && patch !== null
    ? Object.entries(patch as Record<string, unknown>)
        .map(([k, v]) => `${k} → ${typeof v === "object" && v !== null ? JSON.stringify(v).replace(/[{}"]/g, "") : String(v)}`)
        .join(", ")
    : String(patch);

export function describeCommand(cmd: Record<string, unknown>, names: NameLookup): string {
  const op = String(cmd.op);
  const graph = (): string => nameOf(names.graphs, cmd.id);
  switch (op) {
    case "listGraphs":
      return "List graphs";
    case "listTables":
      return "List tables";
    case "listAnalyses":
      return "List analyses";
    case "listFigures":
      return "List figures";
    case "createGraph":
      return `New ${cmd.kind ? `${String(cmd.kind)} ` : ""}graph ${quote(cmd.name)} from ${nameOf(names.tables, cmd.table)}`;
    case "setGraphKind":
      return `${graph()}: graph kind → ${String(cmd.kind)}`;
    case "setAxis": {
      const axis = String(cmd.axis).toUpperCase();
      const patch = (cmd.patch ?? {}) as Record<string, unknown>;
      const parts: string[] = [];
      if ("scale" in patch) parts.push(`scale → ${String(patch.scale)}`);
      if (patch.reversed === true) parts.push("reversed");
      if ("title" in patch) parts.push(`title → ${quote(patch.title)}`);
      const rest = Object.fromEntries(Object.entries(patch).filter(([k]) => !["scale", "reversed", "title"].includes(k)));
      if (Object.keys(rest).length) parts.push(fields(rest));
      return `${graph()}: ${axis} axis ${parts.join(", ")}`.trim();
    }
    case "runAnalysis":
      {
      const method = String(cmd.method);
      const variant = (cmd.params as { variant?: unknown } | undefined)?.variant;
      const variantText = variant ? ` (${VARIANTS[method]?.find((v) => v.id === String(variant))?.label ?? String(variant)})` : "";
      return `Run ${methodLabel(method)}${variantText} on ${nameOf(names.tables, cmd.table)}`;
    }
    case "applyStylePreset":
      return `${graph()}: style preset → ${String(cmd.preset)}`;
    case "createTable":
      return `New table ${quote(cmd.name)}`;
    case "createFigure":
      return `New figure ${quote(cmd.name)}`;
    default: {
      const { op: _op, id, table, ...rest } = cmd;
      const subject = id !== undefined ? graph() : table !== undefined ? nameOf(names.tables, table) : "";
      const body = Object.entries(rest)
        .map(([k, v]) => (typeof v === "object" && v !== null ? fields(v) : `${k} → ${String(v)}`))
        .join(", ");
      return `${subject ? `${subject}: ` : ""}${plainOp(op)}${body ? ` ${body}` : ""}`;
    }
  }
}
