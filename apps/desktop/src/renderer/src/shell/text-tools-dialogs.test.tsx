// @vitest-environment jsdom
/**
 * Data ▸ Split text column… and Data ▸ Find & replace… — the dialogs. Split previews the new
 * columns and says how many rows split (or that none did); Find & replace says how many cells will change before
 * anything changes, "No matches" out loud, and hands the document exactly what it applies. Find & replace is off on a
 * sheet whose cells cannot be edited.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import type { DataTable } from "@mady/core";
import { SplitDialog, splitSummary } from "./SplitDialog";
import type { SplitResult } from "./SplitDialog";
import { FindReplaceDialog } from "./FindReplaceDialog";
import type { FindReplaceResult } from "./FindReplaceDialog";
import { buildActions } from "./actions";

afterEach(cleanup);

const table = {
  id: "t1", kind: "xy", name: "Samples",
  columns: [{ id: "v", name: "Value" }, { id: "s", name: "Sample", type: "text" }],
  rows: [[1, "Liver_Day7"], [2, "Heart_Day14"], [3, "WT"], [4, "wt"]].map(([v, s], i) => ({ id: `r${i}`, cells: { v, s } })),
} as unknown as DataTable;
const button = (c: HTMLElement, text: string) => [...c.querySelectorAll("button")].find((b) => b.textContent === text)!;

describe("Split text column", () => {
  it("opens on the column of text, splits at _ by default, previews and counts", () => {
    const c = render(<SplitDialog table={table} onConfirm={() => {}} onCancel={() => {}} />).container;
    expect(c.querySelector<HTMLSelectElement>('select[aria-label="Column to split"]')!.value).toBe("1");
    expect([...c.querySelectorAll(".importpreview th")].map((t) => t.textContent)).toEqual(["Value", "Sample 1", "Sample 2"]);
    expect(c.querySelector('[aria-label="Split summary"]')!.textContent).toBe("2 rows split into up to 2 parts · 2 rows without “_” kept whole in part 1.");
  });

  it("says so, and will not create a sheet, when nothing splits", () => {
    const c = render(<SplitDialog table={table} onConfirm={() => {}} onCancel={() => {}} />).container;
    fireEvent.change(c.querySelector('input[aria-label="Separator"]')!, { target: { value: "|" } });
    expect(c.querySelector('[aria-label="Split summary"]')!.textContent).toBe("No cell in this column contains “|” — nothing to split.");
    expect(button(c, "Create sheet").disabled).toBe(true);
    expect(splitSummary({ split: 0, unsplit: 0, parts: 1 }, "")).toBe("Type the separator to split at.");
  });

  it("Create sheet hands back the live derivation's spec", () => {
    const got: SplitResult[] = [];
    const c = render(<SplitDialog table={table} onConfirm={(r) => got.push(r)} onCancel={() => {}} />).container;
    fireEvent.click(button(c, "Create sheet"));
    expect(got).toEqual([{ name: "Samples (split)", spec: { col: 1, sep: "_" }, sourceId: "t1" }]);
  });
});

describe("Find & replace", () => {
  it("counts before changing; No matches out loud; Replace hands the document exactly what to apply", () => {
    const got: FindReplaceResult[] = [];
    const c = render(<FindReplaceDialog table={table} onConfirm={(r) => got.push(r)} onCancel={() => {}} />).container;
    const summary = () => c.querySelector('[aria-label="Find and replace summary"]')!.textContent;
    expect(summary()).toBe("Type the text to find.");
    fireEvent.change(c.querySelector('input[aria-label="Find"]')!, { target: { value: "zzz" } });
    expect(summary()).toBe("No matches.");
    expect(button(c, "Replace").disabled).toBe(true);
    fireEvent.change(c.querySelector('input[aria-label="Find"]')!, { target: { value: "wt" } });
    fireEvent.change(c.querySelector('input[aria-label="Replace with"]')!, { target: { value: "Control" } });
    fireEvent.click(c.querySelector('input[aria-label="Whole cell only"]')!);
    expect(summary()).toBe("2 cells will change.");
    fireEvent.click(c.querySelector('input[aria-label="Match case"]')!);
    expect(summary()).toBe("1 cell will change.");
    fireEvent.change(c.querySelector<HTMLSelectElement>('select[aria-label="Where to look"]')!, { target: { value: "s" } });
    fireEvent.click(button(c, "Replace"));
    expect(got).toEqual([{ tableId: "t1", count: 1, spec: { find: "wt", replace: "Control", matchCase: true, wholeCell: true, columnIds: ["s"] } }]);
  });

  it("the Data menu entries: Split always; Find & replace off when the sheet cannot be edited", () => {
    const acts = (can: boolean) =>
      buildActions(new Proxy({ canFindReplace: can } as Record<string, unknown>, { get: (t, k: string) => (k in t ? t[k] : k.startsWith("can") || k.startsWith("has") ? true : vi.fn()) }) as never);
    expect(acts(true).find((a) => a.id === "split-text")?.menu).toBe("Data");
    expect(acts(true).find((a) => a.id === "find-replace")?.enabled).toBe(true);
    expect(acts(false).find((a) => a.id === "find-replace")?.enabled).toBe(false);
  });
});
