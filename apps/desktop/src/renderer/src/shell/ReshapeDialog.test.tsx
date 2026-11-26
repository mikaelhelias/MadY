// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import type { CellValue, DataTable } from "@mady/core";
import { ReshapeDialog } from "./ReshapeDialog";

afterEach(cleanup);

/** Build a minimal DataTable (cells keyed by column id) from a positional grid. */
function makeTable(name: string, columnNames: string[], rows: CellValue[][]): DataTable {
  const columns = columnNames.map((n, i) => ({ id: `c${i}`, name: n }));
  return {
    id: "t1",
    kind: "xy",
    name,
    columns,
    rows: rows.map((vals, r) => ({
      id: `r${r}`,
      cells: Object.fromEntries(columns.map((c, i) => [c.id, vals[i] ?? null])),
    })),
  };
}

// dose | drugA | drugB
const WIDE = makeTable("dose", ["dose", "drugA", "drugB"], [
  [1, 10, 15],
  [2, 20, 25],
]);

function setup(table: DataTable) {
  const onConfirm = vi.fn();
  const onCancel = vi.fn();
  const utils = render(<ReshapeDialog table={table} onConfirm={onConfirm} onCancel={onCancel} />);
  const headers = () =>
    Array.from(utils.container.querySelectorAll(".importpreview th")).map((th) => th.textContent);
  const bodyRows = () => utils.container.querySelectorAll(".importpreview tbody tr");
  const confirmBtn = () => utils.container.querySelector(".btn") as HTMLButtonElement;
  const direction = () => utils.container.querySelector('select[aria-label="Direction"]') as HTMLSelectElement;
  return { ...utils, onConfirm, onCancel, headers, bodyRows, confirmBtn, direction };
}

describe("ReshapeDialog — wide → long", () => {
  it("defaults to melting all non-first columns and previews the long form", () => {
    const d = setup(WIDE);
    expect(d.headers()).toEqual(["dose", "variable", "value"]);
    expect(d.bodyRows()).toHaveLength(4); // 2 rows × 2 value cols
  });

  it("confirms the melted payload with a derived name", () => {
    const d = setup(WIDE);
    fireEvent.click(d.confirmBtn());
    expect(d.onConfirm).toHaveBeenCalledWith({
      name: "dose (long)",
      columnNames: ["dose", "variable", "value"],
      rows: [
        [1, "drugA", 10],
        [1, "drugB", 15],
        [2, "drugA", 20],
        [2, "drugB", 25],
      ],
      spec: { mode: "wide-to-long", idColumns: [0], valueColumns: [1, 2], keyName: "variable", valueName: "value", dropEmpty: false },
      sourceId: "t1",
    });
  });

  it("renames the key/value output columns", () => {
    const d = setup(WIDE);
    fireEvent.change(d.container.querySelector('input[aria-label="Key column name"]')!, {
      target: { value: "drug" },
    });
    fireEvent.change(d.container.querySelector('input[aria-label="Value column name"]')!, {
      target: { value: "response" },
    });
    expect(d.headers()).toEqual(["dose", "drug", "response"]);
  });
});

describe("ReshapeDialog — long → wide", () => {
  // The melted form of WIDE — pivoting should recover the wide shape.
  const LONG = makeTable("tidy", ["dose", "variable", "value"], [
    [1, "drugA", 10],
    [1, "drugB", 15],
    [2, "drugA", 20],
    [2, "drugB", 25],
  ]);

  it("pivots key values into headers (round-trips the melt)", () => {
    const d = setup(LONG);
    fireEvent.change(d.direction(), { target: { value: "long-to-wide" } });
    expect(d.headers()).toEqual(["dose", "drugA", "drugB"]);
    fireEvent.click(d.confirmBtn());
    expect(d.onConfirm).toHaveBeenCalledWith({
      name: "tidy (wide)",
      columnNames: ["dose", "drugA", "drugB"],
      rows: [
        [1, 10, 15],
        [2, 20, 25],
      ],
      spec: { mode: "long-to-wide", idColumns: [0], keyColumn: 1, valueColumn: 2, resultKind: "grouped" },
      sourceId: "t1",
    });
  });

  it("disables confirm when no key/value column is chosen", () => {
    const d = setup(LONG);
    fireEvent.change(d.direction(), { target: { value: "long-to-wide" } });
    // Demote the key column to ignore → invalid.
    fireEvent.change(d.container.querySelector('select[aria-label="Role for variable"]')!, {
      target: { value: "ignore" },
    });
    expect(d.confirmBtn().disabled).toBe(true);
  });
});
