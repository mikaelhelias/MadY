/**
 * duplicateTable carries every DataTable field by default (a spread), then overrides what must
 * be fresh (ids), re-keyed (anything addressed by row / column id) or independent (derivation,
 * links); `document.ts` points to this file for that rule. Two ways a new field can still go
 * wrong, both silent:
 *
 *  1. an id-keyed field carried verbatim — it points at the source sheet's ids, looks right,
 *     and addresses nothing on the copy;
 *  2. a field quietly dropped (`field: undefined`) without the reason the others carry.
 *
 * This census reads the model and the method and refuses both. Twin of
 * `insert-table-census.test.ts`, which guards the insert path the same way.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { MadyDocument } from "./document.js";
import type { DataTable, Project } from "./model.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const MODEL = readFileSync(join(HERE, "model.ts"), "utf8").replace(/\r\n/g, "\n");
const DOCUMENT = readFileSync(join(HERE, "document.ts"), "utf8").replace(/\r\n/g, "\n");

/** DataTable fields whose type names an id (row / column keyed maps, id lists). */
function idKeyedTableFields(): string[] {
  const m = MODEL.match(/^export interface DataTable \{\n([\s\S]*?)^\}/m);
  expect(m, "DataTable interface not found").toBeTruthy();
  const clean = m![1]!.replace(/\/\*\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  return [...clean.matchAll(/^\s*(\w+)\??:\s*([^;]+);/gm)]
    .filter(([, name, type]) => /\bNodeId\b/.test(type!) && !["id", "columns", "rows"].includes(name!))
    .map(([, name]) => name!)
    .sort();
}

/** The object literal duplicateTable builds the copy from. */
function duplicateLiteral(): string {
  const start = DOCUMENT.indexOf("  duplicateTable(tableId: NodeId");
  expect(start, "duplicateTable not found in document.ts").toBeGreaterThan(-1);
  const body = DOCUMENT.slice(start);
  const m = body.match(/const table: DataTable = \{\n\s*\.\.\.src,([\s\S]*?)\n    \};/);
  expect(m, "duplicateTable's `{ ...src, … }` literal not found — the spread is the contract").toBeTruthy();
  return m![1]!;
}

/** Re-keyed onto the fresh ids. */
const REKEYED = ["excluded", "cellFills", "cellPatterns"].sort();
/** Deliberately not carried, each with its reason in the comment beside it (a copy is an
 *  independent working sheet: no derivation to recompute from, no second link to a file). */
const DROPPED = ["derivation", "status", "linkedSource", "linkError"].sort();
/** Fresh on every copy. */
const FRESH = ["id", "name", "columns", "rows"].sort();

describe("duplicateTable re-keys every id-addressed DataTable field", () => {
  it("census: an id-keyed table field is re-keyed or this test names it", () => {
    const found = idKeyedTableFields();
    expect(found.length, "the census read nothing — the model parse is broken").toBeGreaterThan(0);
    expect(found, "id-keyed DataTable fields duplicateTable would carry verbatim — re-key them and list them here").toEqual(REKEYED);
  });

  it("…and the literal really re-keys each one (not just spreads it)", () => {
    const lit = duplicateLiteral();
    for (const f of REKEYED) expect(lit, `${f} is not re-keyed`).toMatch(new RegExp(`\\b${f}: remap\\w+\\(src\\.${f},`));
  });

  it("every key the literal overrides is fresh, re-keyed, or a documented drop — nothing else", () => {
    const lit = duplicateLiteral().replace(/\/\/.*$/gm, "");
    // `key: value` and the shorthand `key,` (columns, rows) both override the spread.
    const keys = [...lit.matchAll(/^\s{6}(\w+)(?::|,$)/gm)].map((m) => m[1]!).sort();
    expect(keys).toEqual([...FRESH, ...REKEYED, ...DROPPED].sort());
    // A drop is `undefined`, never a value — a copy that "resets" a field to something is a
    // different feature and needs its own line here.
    for (const f of DROPPED) expect(lit).toMatch(new RegExp(`\\b${f}: undefined,`));
  });
});

describe("duplicateTable — the copy addresses its own ids", () => {
  const src: DataTable = {
    id: "t1",
    kind: "xy",
    name: "Source",
    columns: [{ id: "c1", name: "X" }, { id: "c2", name: "Y", group: "c1" }],
    rows: [{ id: "r1", cells: { c1: 1, c2: 2 } }, { id: "r2", cells: { c1: 3, c2: 4 } }],
    excluded: { r2: ["c2"] },
    cellFills: { r1: { c2: "#ff0000" } },
    cellPatterns: { r2: { c1: "hatch" as never } },
    frozen: true,
    color: "#123456",
    status: "stale",
    linkError: "old",
  };
  const project: Project = { schemaVersion: 4, tables: [src], plots: [], analyses: [], log: [], workspace: { folders: [], loose: [] } };

  it("re-keys the excluded cells, fills and patterns onto the copy's row and column ids", () => {
    const doc = new MadyDocument(JSON.parse(JSON.stringify(project)) as Project);
    const copy = doc.duplicateTable("t1");
    expect(copy.id).not.toBe("t1");
    const [c1, c2] = copy.columns.map((c) => c.id);
    const [r1, r2] = copy.rows.map((r) => r.id);
    expect(new Set([c1, c2, r1, r2])).not.toContain("c1");
    expect(copy.excluded).toEqual({ [r2!]: [c2] });
    expect(copy.cellFills).toEqual({ [r1!]: { [c2!]: "#ff0000" } });
    expect(copy.cellPatterns).toEqual({ [r2!]: { [c1!]: "hatch" } });
    expect(copy.columns[1]!.group).toBe(c1); // a column group points at the copy's own column
  });

  it("carries the plain fields and drops only the documented ones", () => {
    const doc = new MadyDocument(JSON.parse(JSON.stringify(project)) as Project);
    const copy = doc.duplicateTable("t1");
    expect(copy.frozen).toBe(true);
    expect(copy.color).toBe("#123456");
    expect(copy.status).toBeUndefined();
    expect(copy.linkError).toBeUndefined();
    expect(copy.derivation).toBeUndefined();
    expect(copy.linkedSource).toBeUndefined();
  });
});
