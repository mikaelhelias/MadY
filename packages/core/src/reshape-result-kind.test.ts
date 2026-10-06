/**
 * A long→wide reshape (tidy/long → wide) must land as the format the user chose in the reshape
 * dialog, not a default `xy` — otherwise pivoted tidy data never reaches two-way ANOVA etc.
 * The chosen format is stored in the derivation, so it survives the reactive
 * recompute that fires when the source changes.
 *
 * Guards against a `deriveTable` that hard-codes `kind: "xy"` for every derivation: the pivot
 * would come out `xy`.
 */
import { describe, expect, it } from "vitest";
import { MadyDocument } from "./document";

function longSheet(): { doc: MadyDocument; id: string } {
  const doc = new MadyDocument();
  const t = doc.addTable("Long", "multivariable", ["Timepoint", "Treatment", "Value"]);
  for (const r of [["Day1", "Ctrl", 20], ["Day1", "Drug", 30], ["Day2", "Ctrl", 24], ["Day2", "Drug", 41]]) {
    doc.addRow(t.id, r as (string | number)[]);
  }
  return { doc, id: t.id };
}

describe("long→wide reshape adopts the chosen format", () => {
  it("pivots tidy data to a grouped table (id rows × key groups), not xy", () => {
    const { doc, id } = longSheet();
    const wide = doc.deriveTable("Long (wide)", {
      source: id, op: "reshape",
      spec: { mode: "long-to-wide", idColumns: [0], keyColumn: 1, valueColumn: 2, resultKind: "grouped" },
    });
    const w = doc.toJSON().tables.find((t) => t.id === wide.id)!;
    expect(w.kind).toBe("grouped");
    expect(w.columns.map((c) => c.name)).toEqual(["Timepoint", "Ctrl", "Drug"]);
  });

  it("keeps the chosen format through a reactive recompute", () => {
    const { doc, id } = longSheet();
    const wide = doc.deriveTable("Long (wide)", {
      source: id, op: "reshape",
      spec: { mode: "long-to-wide", idColumns: [0], keyColumn: 1, valueColumn: 2, resultKind: "column" },
    });
    // Edit the source → the derived table recomputes; its format must not reset to xy.
    const src = doc.toJSON().tables.find((t) => t.id === id)!;
    doc.setCell(id, src.rows[0]!.id, src.columns[2]!.id, 25);
    doc.recomputeStaleDerived();
    expect(doc.toJSON().tables.find((t) => t.id === wide.id)!.kind).toBe("column");
  });

  it("other derivations still default to xy (only long→wide with a resultKind changes)", () => {
    const { doc, id } = longSheet();
    // A wide→long reshape carries no resultKind → stays xy.
    const long = doc.deriveTable("re-long", {
      source: id, op: "reshape",
      spec: { mode: "wide-to-long", idColumns: [0], valueColumns: [2], keyName: "k", valueName: "v" },
    });
    expect(doc.toJSON().tables.find((t) => t.id === long.id)!.kind).toBe("xy");
  });
});
