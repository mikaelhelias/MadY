/**
 * insertGraph carries every DataTable field by default (a spread), so the one way a NEW field
 * can still go wrong is silently: a field keyed by row / column ids would be carried VERBATIM,
 * pointing at the source sheet's ids — it would look right and address nothing. This census
 * reads the model and refuses an id-keyed DataTable field that insertGraph does not re-key.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const MODEL = readFileSync(join(HERE, "model.ts"), "utf8").replace(/\r\n/g, "\n");
const DOCUMENT = readFileSync(join(HERE, "document.ts"), "utf8").replace(/\r\n/g, "\n");

/** DataTable fields whose TYPE names an id (row / column keyed maps, id lists). */
function idKeyedTableFields(): string[] {
  const m = MODEL.match(/^export interface DataTable \{\n([\s\S]*?)^\}/m);
  expect(m, "DataTable interface not found").toBeTruthy();
  const clean = m![1]!.replace(/\/\*\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  return [...clean.matchAll(/^\s*(\w+)\??:\s*([^;]+);/gm)]
    .filter(([, name, type]) => /\bNodeId\b/.test(type!) && !["id", "columns", "rows"].includes(name!))
    .map(([, name]) => name!)
    .sort();
}

/** Re-keyed onto the fresh ids by insertGraph's `carry` (see document.ts). */
const REKEYED = ["excluded", "cellFills", "cellPatterns"].sort();

describe("insertGraph re-keys every id-addressed DataTable field", () => {
  it("census: an id-keyed table field is re-keyed or this test names it", () => {
    const found = idKeyedTableFields();
    expect(found.length, "the census read nothing — the model parse is broken").toBeGreaterThan(0);
    expect(found, "id-keyed DataTable fields insertGraph would carry VERBATIM — re-key them in `carry` and list them here").toEqual(REKEYED);
  });
  it("…and insertGraph's carry really re-keys each one (not just spreads it)", () => {
    const carry = DOCUMENT.match(/const carry = \(src: DataTable[\s\S]*?\n    \};/);
    expect(carry, "insertGraph's `carry` helper not found in document.ts").toBeTruthy();
    for (const f of REKEYED) expect(carry![0], `${f} is not re-keyed by carry`).toMatch(new RegExp(`remap\\w+\\(${f},`));
  });
});
