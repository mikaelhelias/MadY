// @vitest-environment jsdom
/**
 * Data ▸ Merge datasheets… (a one-time copy). The dialog picks the match columns a
 * reader would (the sheets' ID columns), shows the merged rows and a plain count of what matched and what did not, and
 * hands back an ordinary sheet. The menu entry needs two sheets.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { MadyDocument } from "@mady/core";
import type { DataTable } from "@mady/core";
import { MergeDialog, likelyKeyColumn } from "./MergeDialog";
import type { MergeResult } from "./MergeDialog";
import { buildActions } from "./actions";

afterEach(cleanup);

const sheet = (id: string, name: string, cols: [string, string, string?][], rows: unknown[][]): DataTable =>
  ({
    id, kind: "xy", name,
    columns: cols.map(([cid, cname, type]) => ({ id: cid, name: cname, ...(type ? { type } : {}) })),
    rows: rows.map((r, i) => ({ id: `${id}-r${i}`, cells: Object.fromEntries(cols.map(([cid], j) => [cid, r[j] ?? null])) })),
  }) as unknown as DataTable;

/** Dose first (a number), then the Sample IDs — the ID column is NOT the first one. */
const clinic = sheet("t1", "Clinic", [["dose", "Dose"], ["sid", "Sample", "text"], ["age", "Age"]], [[1, "S1", 40], [2, "S2", 51], [3, "S3", 38]]);
const lab = sheet("t2", "Lab", [["crp", "CRP"], ["id", "sample"]], [[2.2, "S1"], [7.5, "S2"], [1.0, "S4"]]);

function open(onConfirm: (r: MergeResult) => void = () => {}) {
  return render(<MergeDialog tables={[clinic, lab]} firstId="t1" onConfirm={onConfirm} onCancel={() => {}} />).container;
}
const sel = (c: HTMLElement, label: string) => c.querySelector<HTMLSelectElement>(`select[aria-label="${label}"]`)!;

describe("MergeDialog", () => {
  it("likelyKeyColumn: the first column of text, not simply the first column", () => {
    expect(likelyKeyColumn(clinic)).toBe(1);
    expect(likelyKeyColumn(lab)).toBe(1);
  });

  it("opens on the active sheet, matching on the ID columns (the second picked by name), and previews the join", () => {
    const c = open();
    expect(sel(c, "First sheet").value).toBe("t1");
    expect(sel(c, "Second sheet").value).toBe("t2");
    expect(sel(c, "First sheet's match column").value).toBe("1");
    expect(sel(c, "Second sheet's match column").value).toBe("1");
    const head = [...c.querySelectorAll(".importpreview th")].map((t) => t.textContent);
    expect(head).toEqual(["Dose", "Sample", "Age", "CRP"]);
    expect(c.querySelectorAll(".importpreview tbody tr")).toHaveLength(2); // S1, S2 — S3 has no lab row
    expect(c.querySelector('[aria-label="Merge report"]')!.textContent).toBe(
      "2 rows matched · 1 row of the first sheet had no match (left out) · 1 key of the second sheet matched nothing (not in the result).",
    );
  });

  it("keeping every row of the first sheet keeps S3, with a blank CRP", () => {
    const c = open();
    fireEvent.click(c.querySelector('input[aria-label="Keep every row of the first sheet"]')!);
    const rows = [...c.querySelectorAll(".importpreview tbody tr")].map((tr) => [...tr.querySelectorAll("td")].map((td) => td.textContent));
    expect(rows).toEqual([["1", "S1", "40", "2.2"], ["2", "S2", "51", "7.5"], ["3", "S3", "38", ""]]);
  });

  it("Create sheet hands back an ordinary sheet: names, rows, the columns' cell types, and the report", () => {
    const got: MergeResult[] = [];
    const c = open((r) => got.push(r));
    fireEvent.click([...c.querySelectorAll("button")].find((b) => b.textContent === "Create sheet")!);
    expect(got).toHaveLength(1);
    expect(got[0]!.name).toBe("Clinic + Lab");
    expect(got[0]!.rows).toEqual([[1, "S1", 40, 2.2], [2, "S2", 51, 7.5]]);
    expect(got[0]!.columnTypes).toEqual([undefined, "text", undefined, undefined]);
    // …and it lands as a plain sheet (no live derivation) with those cells.
    const doc = new MadyDocument();
    const t = doc.importTable(got[0]!.name, "xy", got[0]!.columnNames, got[0]!.rows, got[0]!.columnTypes);
    expect(t.derivation).toBeUndefined();
    expect(t.columns.map((col) => col.name)).toEqual(["Dose", "Sample", "Age", "CRP"]);
    expect(t.rows.map((r) => t.columns.map((col) => r.cells[col.id]))).toEqual([[1, "S1", 40, 2.2], [2, "S2", 51, 7.5]]);
  });

  it("the Data menu entry is there, and off until the project has two sheets", () => {
    const find = (can: boolean) =>
      buildActions(new Proxy({ canMergeData: can } as Record<string, unknown>, { get: (t, k: string) => (k in t ? t[k] : k.startsWith("can") || k.startsWith("has") ? true : vi.fn()) }) as never)
        .find((a) => a.id === "merge-data");
    const on = find(true);
    expect(on?.menu).toBe("Data");
    expect(on?.label).toBe("Merge datasheets…");
    expect(on?.enabled).toBe(true);
    expect(find(false)?.enabled).toBe(false);
  });
});
