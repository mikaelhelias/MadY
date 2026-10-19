import { describe, expect, it } from "vitest";
import { buildAnalysisData } from "./analysisData";
import type { DataTable } from "./model";

/**
 * A two-group t test is sent the names of its two columns, so its result can say which group is which: a
 * "Difference (A − B) = −10.3" cannot be read for direction until the reader knows what A was.
 */
describe("a two-group t test is sent its groups' names", () => {
  const table: DataTable = {
    id: "t1", kind: "column", name: "Plates",
    columns: [
      { id: "lb", name: "LB agar", role: "y" },
      { id: "bl", name: "Blood agar", role: "y" },
    ],
    rows: [
      { id: "r0", cells: { lb: 30, bl: 41 } },
      { id: "r1", cells: { lb: 32, bl: 44 } },
    ],
  } as never;
  const payload = (variant: string, columns = ["lb", "bl"]) =>
    buildAnalysisData("ttest", { columns, variant } as never, table) as { labelA?: string; labelB?: string };

  it.each(["welch", "unpaired", "paired", "mann-whitney", "wilcoxon", "ks", "ratio-paired"])("%s: A and B by their column names, in the order picked", (variant) => {
    expect(payload(variant)).toMatchObject({ labelA: "LB agar", labelB: "Blood agar" });
    expect(payload(variant, ["bl", "lb"])).toMatchObject({ labelA: "Blood agar", labelB: "LB agar" });
  });

  it.each([
    ["equivalence", "unpaired"], ["equivalence", "paired"], ["permutation", "unpaired"], ["permutation", "paired"],
    ["bayesfactor", "unpaired"], ["bayesfactor", "paired"],
  ])("%s %s: the groups' names too", (method, variant) => {
    const p = buildAnalysisData(method, { columns: ["lb", "bl"], variant } as never, table) as { labelA?: string; labelB?: string };
    expect(p).toMatchObject({ labelA: "LB agar", labelB: "Blood agar" });
  });

  it("a one-sample test has one group and no names to send", () => {
    expect(payload("one-sample", ["lb"]).labelA).toBeUndefined();
  });
});
