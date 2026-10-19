// @vitest-environment jsdom
/**
 * PERMANOVA in the Analyze dialog: offered with the ordinations, Run held until a group column
 * is chosen, and the spec reaches the engine payload with the group column left out of the variables - the way PCA's
 * group column is.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import type { DataTable } from "@mady/core";
import { buildAnalysisData, createSampleDocument } from "@mady/core";
import { AnalyzeDialog } from "./AnalyzeDialog";
import { METHOD_GROUPS } from "./analysis";

afterEach(cleanup);

// The real PCA demo sheet: "Cell type" (text) groups the cases, four measures are the variables.
const table = createSampleDocument().toJSON().tables.find((t) => t.name === "Cell profiling (PCA demo)")! as DataTable;
const col = (name: string): string => table.columns.find((c) => c.name === name)!.id;

describe("PERMANOVA in the Analyze dialog", () => {
  it("is listed with the ordinations", () => {
    expect(METHOD_GROUPS.some((g) => g.methods.includes("permanova"))).toBe(true);
  });

  it("Run waits for the group column; the spec and payload carry the groups, distance and permutations", () => {
    const onRun = vi.fn();
    const u = render(<AnalyzeDialog table={table} onRun={onRun} onCancel={vi.fn()} initialMethod="permanova" />);
    const groupSel = u.container.querySelector<HTMLSelectElement>('select[aria-label="PERMANOVA groups"]');
    expect(groupSel, "no group-column control").toBeTruthy();
    const run = () => u.container.querySelector(".btn") as HTMLButtonElement;
    // one text column on the sheet → seeded as the group column; clear it to see Run hold
    expect(groupSel!.value, "the sheet's one text column is offered as the groups").toBe(col("Cell type"));
    fireEvent.change(groupSel!, { target: { value: "" } });
    expect(run().disabled, "Run must wait for a group column").toBe(true);
    fireEvent.change(groupSel!, { target: { value: col("Cell type") } });
    fireEvent.change(u.container.querySelector('select[aria-label="PERMANOVA distance"]')!, { target: { value: "braycurtis" } });
    expect(run().disabled).toBe(false);
    fireEvent.click(run());
    const spec = onRun.mock.calls.at(-1)![0];
    expect(spec).toMatchObject({ method: "permanova", groupBy: col("Cell type"), metric: "braycurtis", permutations: 999 });
    const payload = buildAnalysisData("permanova", spec, table) as { labels: string[]; groups: string[]; metric: string; columns: number[][] };
    expect(payload.labels, "the group column is not a variable").toEqual(["Size", "Granularity", "Marker A", "Marker B"]);
    expect(new Set(payload.groups)).toEqual(new Set(["Neuron", "Glia", "Stem"]));
    expect(payload.metric).toBe("braycurtis");
    expect(payload.columns).toHaveLength(4);
  });
});
