// @vitest-environment jsdom
/**
 * Goodness of fit against expected shares, through the app's own path.
 *
 * Without an Expected list the engine tests against equal shares. The dialog offers an Expected column, the spec
 * carries it, and the engine payload holds one expected value per category row, in the rows' order, a blank kept
 * blank so the engine names the category.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import type { AnalysisParams, DataTable } from "@mady/core";
import { buildAnalysisData } from "@mady/core";
import { AnalyzeDialog } from "./AnalyzeDialog";

afterEach(cleanup);
Element.prototype.scrollIntoView = Element.prototype.scrollIntoView ?? (() => {});

const table = {
  id: "t", kind: "partsofwhole", name: "Blood groups",
  columns: [
    { id: "g", name: "Group", role: "x" },
    { id: "o", name: "Observed", role: "y" },
    { id: "e", name: "Population share", role: "y" },
  ],
  rows: [["O", 180, 0.45], ["A", 160, 0.4], ["B", 45, 0.11], ["AB", 15, 0.04]].map(([g, o, e], i) => ({ id: `r${i}`, cells: { g, o, e } })),
} as unknown as DataTable;

const run = (pick?: string) => {
  const onRun = vi.fn();
  const c = render(<AnalyzeDialog table={table} onRun={onRun} onCancel={vi.fn()} initialMethod="goodnessoffit" />).container;
  const sel = c.querySelector<HTMLSelectElement>('select[aria-label="Expected"]');
  if (pick !== undefined) fireEvent.change(sel!, { target: { value: pick } });
  fireEvent.click(c.querySelector(".btn") as HTMLButtonElement);
  return { sel, spec: onRun.mock.calls[0]?.[0] as (AnalysisParams & { method: string }) | undefined };
};

describe("Analyze ▸ Goodness of fit ▸ Expected", () => {
  it("is offered with Equal shares first and the sheet's other number columns", () => {
    const { sel } = run();
    expect([...sel!.options].map((o) => o.text)).toEqual(["Equal shares", "Population share"]);
  });

  it("an Expected column reaches the spec and the engine payload, one value per category in row order", () => {
    const { spec } = run("e");
    expect(spec?.expectedColumn).toBe("e");
    const data = buildAnalysisData("goodnessoffit", spec!, table) as { observed: number[]; labels: string[]; expected?: (number | null)[] };
    expect(data.observed).toEqual([180, 160, 45, 15]);
    expect(data.expected).toEqual([0.45, 0.4, 0.11, 0.04]);
  });

  it("Equal shares sends no expected values (the engine's equal-shares test)", () => {
    const { spec } = run("");
    expect(spec?.expectedColumn).toBeUndefined();
    expect("expected" in (buildAnalysisData("goodnessoffit", spec!, table) as object)).toBe(false);
  });

  it("a blank expected cell stays blank in its place, so the engine can name the category", () => {
    const holed = { ...table, rows: table.rows.map((r, i) => (i === 2 ? { ...r, cells: { ...r.cells, e: null } } : r)) } as unknown as DataTable;
    const data = buildAnalysisData("goodnessoffit", { columns: ["o"], expectedColumn: "e" }, holed) as { expected: (number | null)[] };
    expect(data.expected).toEqual([0.45, 0.4, null, 0.04]);
  });
});
