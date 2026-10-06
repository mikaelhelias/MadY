/**
 * Analysis methods (re-applicable "method files"): capture an analysis'
 * engine method + parameters as a table-independent `MethodSpec`, then re-apply it
 * to a different (same-shaped) table. The trick is that `AnalysisParams` references
 * columns by *id*, which don't exist in another table — so a method stores column
 * positions and remaps them onto the target table's columns at apply time.
 *
 * All pure + DOM-free (unit-testable). The document commands (`addMethod` /
 * `removeMethod`) live in `document.ts`; the save/apply UI wires these helpers.
 */
import type { AnalysisParams, DataTable, MethodSpec, NodeId } from "./model";

/** Type tag identifying a portable method file (`.madymethod` JSON). */
const METHOD_FILE_TYPE = "mady-method";
const METHOD_FILE_VERSION = 1;

/**
 * Build a re-applicable Method from an analysis' `{ method, params }` + the source
 * table it ran on. Column ids are converted to positions (a since-deleted column
 * maps to -1, which `methodApplyParams` then rejects on apply).
 */
export function analysisToMethod(
  id: NodeId,
  name: string,
  analysis: { method: string; params: AnalysisParams },
  table: DataTable,
): MethodSpec {
  const pos = (cid: NodeId): number => table.columns.findIndex((c) => c.id === cid);
  const { columns, groupBy, ...rest } = analysis.params;
  return {
    id,
    name,
    method: analysis.method,
    columns: columns.map(pos),
    ...(groupBy != null ? { groupBy: pos(groupBy) } : {}),
    params: rest,
  };
}

/**
 * Remap a Method onto a target table (positions → the table's column ids) →
 * ready-to-run `AnalysisParams`, or an error when the table doesn't have a column
 * at a required position (i.e. it's a different shape than the method expects).
 */
export function methodApplyParams(
  method: MethodSpec,
  table: DataTable,
): { ok: true; params: AnalysisParams } | { ok: false; error: string } {
  const n = table.columns.length;
  const colId = (i: number): NodeId | undefined => (i >= 0 && i < n ? table.columns[i]!.id : undefined);
  const columns: NodeId[] = [];
  for (const i of method.columns) {
    const id = colId(i);
    if (!id) {
      return {
        ok: false,
        error: `"${table.name}" has no column at position ${i + 1}; this method needs ${method.columns.length} column${method.columns.length === 1 ? "" : "s"}.`,
      };
    }
    columns.push(id);
  }
  const params: AnalysisParams = { ...method.params, columns };
  if (method.groupBy != null) {
    const g = colId(method.groupBy);
    if (!g) return { ok: false, error: `"${table.name}" has no group column at position ${method.groupBy + 1}.` };
    params.groupBy = g;
  }
  return { ok: true, params };
}

/** Serialise a Method to a portable file string (pretty JSON with a type tag). */
export function methodToFile(method: MethodSpec): string {
  const { id: _id, ...rest } = method;
  return JSON.stringify({ type: METHOD_FILE_TYPE, version: METHOD_FILE_VERSION, method: rest }, null, 2);
}

/**
 * Parse + validate a `.madymethod` file's text → the Method (without an id — the
 * caller assigns a fresh one via `addMethod`), or a human-readable error. Rejects
 * anything that isn't a well-formed method file.
 */
export function parseMethodFile(text: string): { ok: true; method: Omit<MethodSpec, "id"> } | { ok: false; error: string } {
  let obj: unknown;
  try {
    obj = JSON.parse(text);
  } catch {
    return { ok: false, error: "Not a valid method file (couldn't parse JSON)." };
  }
  const o = obj as { type?: unknown; method?: unknown };
  if (o?.type !== METHOD_FILE_TYPE) return { ok: false, error: "Not a MadY method file." };
  const m = o.method as Partial<MethodSpec> | undefined;
  if (!m || typeof m.method !== "string" || !m.method) return { ok: false, error: "Method file is missing its analysis method." };
  if (!Array.isArray(m.columns) || !m.columns.every((c) => typeof c === "number")) {
    return { ok: false, error: "Method file has no valid column list." };
  }
  return {
    ok: true,
    method: {
      name: typeof m.name === "string" && m.name ? m.name : "Imported method",
      method: m.method,
      columns: m.columns as number[],
      ...(typeof m.groupBy === "number" ? { groupBy: m.groupBy } : {}),
      params: (m.params ?? {}) as MethodSpec["params"],
    },
  };
}
