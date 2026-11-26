import { describe, expect, it } from "vitest";
import { layoutPresets, packGrid } from "./layoutPresets";
import type { LayoutPreset } from "./layoutPresets";

/** Every preset's cells must tile without overlap — the picker must never promise a
 *  shape the grid cannot draw. */
function assertNoOverlap(p: LayoutPreset): void {
  const taken = new Set<string>();
  for (const cell of p.cells) {
    for (let dc = 0; dc < cell.cs; dc++)
      for (let dr = 0; dr < cell.rs; dr++) {
        const k = `${cell.c + dc},${cell.r + dr}`;
        expect(taken.has(k), `${p.name}: cell ${k} claimed twice`).toBe(false);
        taken.add(k);
      }
  }
}

describe("packGrid — the one occupancy packer", () => {
  it("all 1×1 reduces exactly to index % cols", () => {
    const pos = packGrid(Array.from({ length: 5 }, () => ({ cs: 1, rs: 1 })), 2);
    expect(pos).toEqual([
      { c: 0, r: 0 }, { c: 1, r: 0 },
      { c: 0, r: 1 }, { c: 1, r: 1 },
      { c: 0, r: 2 },
    ]);
  });

  it("a 2-row item makes the others tile around it (tall left)", () => {
    const pos = packGrid([{ cs: 1, rs: 2 }, { cs: 1, rs: 1 }, { cs: 1, rs: 1 }], 2);
    expect(pos).toEqual([{ c: 0, r: 0 }, { c: 1, r: 0 }, { c: 1, r: 1 }]);
  });

  it("a full-width item pushes the rest to the next row (wide top)", () => {
    const pos = packGrid([{ cs: 2, rs: 1 }, { cs: 1, rs: 1 }, { cs: 1, rs: 1 }], 2);
    expect(pos).toEqual([{ c: 0, r: 0 }, { c: 0, r: 1 }, { c: 1, r: 1 }]);
  });
});

describe("layoutPresets — the picker catalog", () => {
  it("3 panels: row, column, 2-column grid, wide top, tall left — no twins, no overlaps", () => {
    const ps = layoutPresets(3);
    expect(ps.map((p) => p.name)).toEqual(["Row", "Column", "2-column grid", "Wide top (2 under)", "Tall left"]);
    for (const p of ps) assertNoOverlap(p);
    const wide = ps.find((p) => p.name.startsWith("Wide top"))!;
    expect(wide.cells[0]).toEqual({ c: 0, r: 0, cs: 2, rs: 1 });
    const tall = ps.find((p) => p.name === "Tall left")!;
    expect(tall.cells[0]).toEqual({ c: 0, r: 0, cs: 1, rs: 2 });
    expect(tall.cells.slice(1).map((c) => c.c)).toEqual([1, 1]); // the rest stack right
  });

  it("2 panels: the row and the column, and nothing that duplicates them", () => {
    const ps = layoutPresets(2);
    expect(ps.map((p) => p.name)).toEqual(["Row", "Column"]);
    for (const p of ps) assertNoOverlap(p);
  });

  it("5 panels: wide top with 2 under fills exactly (a 2×2 block beneath the spanning panel)", () => {
    const wide = layoutPresets(5).find((p) => p.name === "Wide top (2 under)")!;
    expect(wide.cells[0]!.cs).toBe(2);
    expect(new Set(wide.cells.slice(1).map((c) => c.r)).size).toBe(2); // two full rows beneath
  });

  it("6 panels: tall left is NOT offered (5 rows exceeds the grid's rowspan cap of 4)", () => {
    expect(layoutPresets(6).find((p) => p.name === "Tall left")).toBeUndefined();
    for (const p of layoutPresets(6)) assertNoOverlap(p);
  });

  it("every catalog up to 8 panels tiles clean", () => {
    for (let n = 2; n <= 8; n++) for (const p of layoutPresets(n)) assertNoOverlap(p);
  });
});
