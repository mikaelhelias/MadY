import { describe, expect, it } from "vitest";
import { buildAnalysisData } from "./analysisData";
import type { DataTable } from "./model";

/**
 * The ratio paired t test pairs rows, like the paired t and the Wilcoxon signed-rank.
 *
 * The dialog sends `variant: "ratio-paired"` (the engine's name for it), and the row-aligned
 * branch has to match that name. Guards against a ratio paired run falling through to the
 * unpaired branch and pooling each column on its own: a blank in A on one row and a blank in B
 * on another would slide every later value against the wrong partner, and the engine would
 * compute the ratio of mismatched pairs without any warning.
 *
 * The fixture has to be able to show it: blanks in different rows on each side. With the
 * blanks on the same row (or none), pooling and pairing give the same arrays.
 */
describe("paired variants keep each pair on its own row", () => {
  const table: DataTable = {
    id: "t1", kind: "column", name: "T",
    columns: [
      { id: "ca", name: "Before", role: "y" },
      { id: "cb", name: "After", role: "y" },
    ],
    rows: [
      { id: "r0", cells: { ca: 10, cb: 11 } },
      { id: "r1", cells: { ca: null, cb: 22 } },
      { id: "r2", cells: { ca: 30, cb: null } },
      { id: "r3", cells: { ca: 40, cb: 44 } },
    ],
  } as never;

  const payload = (variant: string) =>
    buildAnalysisData("ttest", { columns: ["ca", "cb"], variant } as never, table) as { variant: string; a: number[]; b: number[] };

  it.each(["ratio-paired", "paired", "wilcoxon"])("%s: only rows with both values, same row on both sides", (variant) => {
    const p = payload(variant);
    expect(p.variant).toBe(variant);
    expect(p.a).toEqual([10, 40]);
    expect(p.b).toEqual([11, 44]);
  });

  it("an unpaired test still pools each column (control)", () => {
    const p = payload("unpaired");
    expect(p.a).toEqual([10, 30, 40]);
    expect(p.b).toEqual([11, 22, 44]);
  });
});
