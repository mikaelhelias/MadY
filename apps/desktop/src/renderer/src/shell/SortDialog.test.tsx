// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { SortDialog } from "./SortDialog";
import type { DataTable } from "@mady/core";

afterEach(cleanup);

const TABLE: DataTable = {
  id: "tbl-1",
  kind: "xy",
  name: "Experiment",
  columns: [
    { id: "c-dose", name: "Dose" },
    { id: "c-resp", name: "Response" },
  ],
  rows: [
    { id: "r1", cells: { "c-dose": 2, "c-resp": 20 } },
    { id: "r2", cells: { "c-dose": 1, "c-resp": 10 } },
  ],
};

function setup(table: DataTable = TABLE) {
  const onConfirm = vi.fn();
  const onCancel = vi.fn();
  const utils = render(<SortDialog table={table} onConfirm={onConfirm} onCancel={onCancel} />);
  const colSel = () => utils.container.querySelector('select[aria-label="Sort column"]') as HTMLSelectElement;
  const dirSel = () => utils.container.querySelector('select[aria-label="Sort direction"]') as HTMLSelectElement;
  const sortBtn = () => utils.container.querySelector(".modalbtns .btn") as HTMLButtonElement;
  return { ...utils, onConfirm, onCancel, colSel, dirSel, sortBtn };
}

describe("SortDialog", () => {
  it("lists the table's columns and defaults to the first, ascending", () => {
    const d = setup();
    expect([...d.colSel().options].map((o) => o.textContent)).toEqual(["Dose", "Response"]);
    expect(d.colSel().value).toBe("c-dose");
    expect(d.dirSel().value).toBe("asc");
  });

  it("confirms with the chosen column id and direction", () => {
    const d = setup();
    fireEvent.change(d.colSel(), { target: { value: "c-resp" } });
    fireEvent.change(d.dirSel(), { target: { value: "desc" } });
    fireEvent.click(d.sortBtn());
    expect(d.onConfirm).toHaveBeenCalledWith("c-resp", "desc");
  });

  it("disables Sort when the table has no columns", () => {
    const d = setup({ ...TABLE, columns: [], rows: [] });
    expect(d.sortBtn().disabled).toBe(true);
  });

  it("cancels", () => {
    const d = setup();
    fireEvent.click(d.container.querySelector(".btn-ghost") as HTMLButtonElement);
    expect(d.onCancel).toHaveBeenCalled();
  });
});
