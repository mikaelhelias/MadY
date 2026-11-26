// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import type { DataTable } from "@mady/core";
import { dataColumnRuns, DataGrid, parseCell, parseClipboard } from "./DataGrid";
import { daysToISO } from "@mady/core";

afterEach(cleanup);

const TOTAL_COLS = 26; // matches DataGrid's MIN_COLS for a 2-column table

const table: DataTable = {
  id: "t",
  kind: "xy",
  name: "T",
  columns: [
    { id: "cx", name: "X" },
    { id: "cy", name: "Y" },
  ],
  rows: [{ id: "r1", cells: { cx: 1, cy: 10 } }],
};

function renderGrid() {
  const fns = {
    onEditCell: vi.fn(),
    onRenameColumn: vi.fn(),
    onPaste: vi.fn(),
    onClearCells: vi.fn(),
    onFillDown: vi.fn(),
    onTranspose: vi.fn(),
  };
  const utils = render(<DataGrid table={table} {...fns} />);
  const wrap = utils.container.querySelector(".dgwrap") as HTMLElement;
  const cells = () => utils.container.querySelectorAll(".dgcell");
  const cell = (r: number, c: number) => cells()[r * TOTAL_COLS + c] as HTMLElement;
  return { ...utils, ...fns, wrap, cell };
}

describe("DataGrid parsers (pure)", () => {
  it("parseCell: blank → null, numeric → number, else string", () => {
    expect(parseCell("")).toBeNull();
    expect(parseCell("3.5")).toBe(3.5);
    expect(parseCell("abc")).toBe("abc");
  });

  it("parseClipboard: TSV block, CRLF-tolerant, drops the trailing blank line", () => {
    expect(parseClipboard("1\t2\r\n3\t4\r\n")).toEqual([
      [1, 2],
      [3, 4],
    ]);
  });

  it("parseClipboard (typed): types each token against its destination column", () => {
    const cols = [{ type: "date" as const }, { type: "text" as const }, {}];
    const block = parseClipboard("2024-01-15\t007\t3.50", cols, 0);
    expect(typeof block[0]![0]).toBe("number"); // date → serial number, not the raw string
    expect(block[0]![1]).toBe("007"); // text column keeps leading zeros
    expect(block[0]![2]).toBe(3.5); // generic column → number
  });

  it("parseClipboard (typed): honours startCol so tokens line up with their columns", () => {
    const cols = [{ type: "text" as const }, { type: "date" as const }];
    const block = parseClipboard("2024-06-01", cols, 1); // paste into the date column
    expect(typeof block[0]![0]).toBe("number");
  });

  it("parseClipboard: pasted CSV splits into columns, not one column per row", () => {
    // A genuine Excel copy is still tab-delimited; guards against pasted comma text
    // collapsing to a single column when the parser splits on tab only.
    expect(parseClipboard("1,2,3\n4,5,6")).toEqual([
      [1, 2, 3],
      [4, 5, 6],
    ]);
  });

  it("parseClipboard: keeps an RFC-4180 quoted cell whole instead of tearing it apart", () => {
    const block = parseClipboard('a,"b, c",d');
    expect(block).toEqual([["a", "b, c", "d"]]);
  });
});

describe("DataGrid editing", () => {
  it("commits a cell edit by index on Enter (exactly once)", () => {
    const g = renderGrid();
    fireEvent.doubleClick(g.cell(0, 1)); // edit (row 0, col 1 = value 10)
    const input = g.container.querySelector(".dgin") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "20" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(g.onEditCell).toHaveBeenCalledTimes(1); // guards against blur+Enter double-commit
    expect(g.onEditCell).toHaveBeenCalledWith(0, 1, 20);
  });

  it("type-to-edit: typing a printable key on a selected cell opens the editor seeded with it (replaces the value)", () => {
    const g = renderGrid();
    fireEvent.mouseDown(g.cell(0, 1)); // select (0,1) = value 10
    // No editor yet — a plain selection.
    expect(g.container.querySelector(".dgin")).toBeNull();
    fireEvent.keyDown(g.wrap, { key: "8" }); // just start typing, like every spreadsheet
    const input = g.container.querySelector(".dgin") as HTMLInputElement;
    expect(input).not.toBeNull(); // the editor opened from a keystroke
    expect(input.value).toBe("8"); // seeded with the char — replaces 10, does not append to it
    fireEvent.change(input, { target: { value: "85" } }); // the user keeps typing
    fireEvent.keyDown(input, { key: "Enter" });
    expect(g.onEditCell).toHaveBeenCalledWith(0, 1, 85);
  });

  it("type-to-edit: a named key (ArrowUp) moves, it does not open an editor", () => {
    const g = renderGrid();
    fireEvent.mouseDown(g.cell(0, 1));
    fireEvent.keyDown(g.wrap, { key: "ArrowUp" });
    expect(g.container.querySelector(".dgin")).toBeNull(); // navigation, not an edit
  });

  it("type-to-edit: a Ctrl/Cmd combo (Ctrl+C) never begins an edit", () => {
    const g = renderGrid();
    fireEvent.mouseDown(g.cell(0, 1));
    fireEvent.keyDown(g.wrap, { key: "c", ctrlKey: true });
    expect(g.container.querySelector(".dgin")).toBeNull();
  });

  it("header rename owns the keyboard: typing a letter mid-rename does not open a stray cell editor", () => {
    const g = renderGrid();
    fireEvent.mouseDown(g.cell(0, 1)); // a cell is selected first
    const yName = [...g.container.querySelectorAll(".dghead .dgname")].find((e) => e.textContent === "Y");
    fireEvent.doubleClick(yName as HTMLElement); // start renaming the column
    expect(g.container.querySelector(".dghead .dgin")).not.toBeNull();
    fireEvent.keyDown(g.wrap, { key: "Z" }); // a keystroke that bubbles from the rename input
    // No cell editor may open, and no cell edit may be committed — the rename input keeps the key.
    expect(g.container.querySelector(".dgcell .dgin")).toBeNull();
    expect(g.onEditCell).not.toHaveBeenCalled();
  });

  it("right-click keeps a multi-cell selection, so Exclude acts on the whole block (not one cell)", () => {
    const block: DataTable = {
      id: "tb", kind: "xy", name: "Blk",
      columns: [{ id: "cx", name: "X" }, { id: "cy", name: "Y" }],
      rows: [{ id: "r1", cells: { cx: 1, cy: 10 } }, { id: "r2", cells: { cx: 2, cy: 20 } }],
    };
    const onToggleExcluded = vi.fn();
    const utils = render(
      <DataGrid table={block} onEditCell={vi.fn()} onRenameColumn={vi.fn()} onPaste={vi.fn()} onClearCells={vi.fn()} onFillDown={vi.fn()} onTranspose={vi.fn()} onToggleExcluded={onToggleExcluded} />,
    );
    const cells = utils.container.querySelectorAll(".dgcell");
    const at = (r: number, c: number) => cells[r * TOTAL_COLS + c] as HTMLElement;
    fireEvent.mouseDown(at(0, 0)); // anchor
    fireEvent.mouseDown(at(1, 1), { shiftKey: true }); // extend → 2×2 block of real cells
    // A real right-click fires mousedown(button 2) then contextmenu; the mousedown must not
    // collapse the block, or the menu's preserve-selection guard sees only one cell.
    fireEvent.mouseDown(at(0, 0), { button: 2 });
    fireEvent.contextMenu(at(0, 0));
    const exclude = [...utils.container.querySelectorAll(".dgmenu-i")].find((b) => /^Exclude/.test(b.textContent ?? "")) as HTMLElement;
    fireEvent.click(exclude);
    expect(onToggleExcluded).toHaveBeenCalledTimes(1);
    expect((onToggleExcluded.mock.calls[0]![0] as unknown[]).length).toBe(4); // all 4 cells, not 1
  });

  it("header rename owns the keyboard: Backspace mid-rename does not clear the selected cell (data loss)", () => {
    const g = renderGrid();
    fireEvent.mouseDown(g.cell(0, 1)); // select the cell holding 10
    const yName = [...g.container.querySelectorAll(".dghead .dgname")].find((e) => e.textContent === "Y");
    fireEvent.doubleClick(yName as HTMLElement);
    fireEvent.keyDown(g.wrap, { key: "Backspace" }); // deleting a char in the title, not the cell
    expect(g.onClearCells).not.toHaveBeenCalled();
  });

  it("creates a column by editing a spare cell", () => {
    const g = renderGrid();
    fireEvent.doubleClick(g.cell(0, 2)); // first spare column
    const input = g.container.querySelector(".dgin") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "7" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(g.onEditCell).toHaveBeenCalledWith(0, 2, 7);
  });

  it("renames a column from its header", () => {
    const g = renderGrid();
    // target the column name span (a separate .dgrole tag also reads "Y")
    const yName = [...g.container.querySelectorAll(".dghead .dgname")].find((e) => e.textContent === "Y");
    fireEvent.doubleClick(yName as HTMLElement);
    const input = g.container.querySelector(".dghead .dgin") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Response (%)" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(g.onRenameColumn).toHaveBeenCalledWith("cy", "Response (%)");
  });

  it("always presents a large spare grid for big pastes", () => {
    const g = renderGrid();
    expect(g.container.querySelectorAll(".dgrh").length).toBeGreaterThanOrEqual(40);
    expect(g.container.querySelectorAll(".dghead").length).toBeGreaterThanOrEqual(20);
    expect(g.container.querySelector(".dgcell.sparecol")).toBeTruthy();
  });
});

describe("DataGrid selection + clipboard", () => {
  const clip = () => {
    const setData = vi.fn();
    return { setData, init: { clipboardData: { setData, getData: () => "" } } };
  };

  it("intercepts a multi-cell paste at the selection anchor", () => {
    const g = renderGrid();
    fireEvent.mouseDown(g.cell(0, 0)); // select (0,0)
    fireEvent.paste(g.wrap, { clipboardData: { getData: () => "5\t50\n6\t60" } });
    expect(g.onPaste).toHaveBeenCalledWith(0, 0, [
      [5, 50],
      [6, 60],
    ]);
  });

  it("copies the selected range as TSV", () => {
    const g = renderGrid();
    fireEvent.mouseDown(g.cell(0, 0)); // anchor (0,0)
    fireEvent.mouseEnter(g.cell(0, 1)); // drag to (0,1)
    const { setData, init } = clip();
    fireEvent.copy(g.wrap, init);
    expect(setData).toHaveBeenCalledWith("text/plain", "1\t10");
  });

  it("copies full precision, not the display-rounded text", () => {
    const precise: DataTable = {
      id: "t2",
      kind: "xy",
      name: "T2",
      columns: [{ id: "cv", name: "V", type: "number", decimals: 2 }],
      rows: [{ id: "r1", cells: { cv: 0.123456 } }],
    };
    const fns = { onEditCell: vi.fn(), onRenameColumn: vi.fn(), onPaste: vi.fn(), onClearCells: vi.fn(), onFillDown: vi.fn(), onTranspose: vi.fn() };
    const utils = render(<DataGrid table={precise} {...fns} />);
    const wrap = utils.container.querySelector(".dgwrap") as HTMLElement;
    const cell = utils.container.querySelectorAll(".dgcell")[0] as HTMLElement; // (0,0)
    fireEvent.mouseDown(cell);
    const { setData, init } = clip();
    fireEvent.copy(wrap, init);
    // On screen the cell reads "0.12"; the clipboard must carry the round-trippable value.
    expect(setData).toHaveBeenCalledWith("text/plain", "0.123456");
  });

  it("cuts: copies then clears the selected range", () => {
    const g = renderGrid();
    fireEvent.mouseDown(g.cell(0, 1)); // (0,1) = 10
    const { setData, init } = clip();
    fireEvent.cut(g.wrap, init);
    expect(setData).toHaveBeenCalledWith("text/plain", "10");
    expect(g.onClearCells).toHaveBeenCalledWith(0, 1, 1, 1);
  });

  it("clears the selection on Delete", () => {
    const g = renderGrid();
    fireEvent.mouseDown(g.cell(0, 1));
    fireEvent.keyDown(g.wrap, { key: "Delete" });
    expect(g.onClearCells).toHaveBeenCalledWith(0, 1, 1, 1);
  });

  it("fills down over the selection (Ctrl+D)", () => {
    const g = renderGrid();
    fireEvent.mouseDown(g.cell(0, 1)); // anchor (0,1)
    fireEvent.mouseEnter(g.cell(2, 1)); // extend down to (2,1)
    fireEvent.keyDown(g.wrap, { key: "d", ctrlKey: true });
    expect(g.onFillDown).toHaveBeenCalledWith(0, 1, 3, 1);
  });

  it("transposes the selection (Ctrl+Shift+T)", () => {
    const g = renderGrid();
    fireEvent.mouseDown(g.cell(0, 0)); // anchor (0,0)
    fireEvent.mouseEnter(g.cell(0, 1)); // 1×2 selection
    fireEvent.keyDown(g.wrap, { key: "T", ctrlKey: true, shiftKey: true });
    expect(g.onTranspose).toHaveBeenCalledWith(0, 0, 1, 2);
  });

  it("extends the selection with shift-click", () => {
    const g = renderGrid();
    fireEvent.mouseDown(g.cell(0, 0));
    fireEvent.mouseDown(g.cell(2, 1), { shiftKey: true });
    const { setData, init } = clip();
    fireEvent.copy(g.wrap, init);
    // 3 rows × 2 cols; only (0,0)=1 and (0,1)=10 have data, rest blank.
    expect(setData).toHaveBeenCalledWith("text/plain", "1\t10\n\t\n\t");
  });
});

describe("dataColumnRuns (grouped header)", () => {
  it("table without replicate subcolumns → one single-column run per Y (X excluded)", () => {
    const t: DataTable = {
      id: "t", kind: "xy", name: "T",
      columns: [{ id: "x", name: "Dose" }, { id: "a", name: "A" }, { id: "b", name: "B" }],
      rows: [],
    };
    const runs = dataColumnRuns(t);
    expect(runs.map((r) => r.name)).toEqual(["A", "B"]);
    expect(runs.every((r) => r.cols.length === 1)).toBe(true);
  });

  it("groups replicate subcolumns into one run with numbered subcolumns", () => {
    const t: DataTable = {
      id: "t", kind: "xy", name: "T",
      columns: [
        { id: "x", name: "Dose", role: "x" },
        { id: "a1", name: "Drug A", role: "y" },
        { id: "a2", name: "rep2", role: "y", group: "a1" },
        { id: "a3", name: "rep3", role: "y", group: "a1" },
      ],
      rows: [],
    };
    const [run] = dataColumnRuns(t);
    expect(run!.name).toBe("Drug A");
    expect(run!.leadIndex).toBe(1);
    expect(run!.cols.map((c) => c.sub)).toEqual(["1", "2", "3"]);
  });

  it("labels pre-computed summary subcolumns Mean / SD / SEM / N", () => {
    const t: DataTable = {
      id: "t", kind: "xy", name: "T",
      columns: [
        { id: "x", name: "X", role: "x" },
        { id: "m", name: "Mean", role: "y" },
        { id: "s", name: "SD", role: "sd", group: "m" },
        { id: "k", name: "N", role: "n", group: "m" },
      ],
      rows: [],
    };
    // The lone Y column reads as "Mean" (not replicate "1") in summary mode.
    expect(dataColumnRuns(t)[0]!.cols.map((c) => c.sub)).toEqual(["Mean", "SD", "N"]);
  });

  it("labels %CV / lower / upper-limit summary subcolumns", () => {
    const t: DataTable = {
      id: "t", kind: "xy", name: "T",
      columns: [
        { id: "x", name: "X", role: "x" },
        { id: "m", name: "Mean", role: "y" },
        { id: "c", name: "%CV", role: "cv", group: "m" },
        { id: "k", name: "N", role: "n", group: "m" },
        // second dataset entered as lower/upper limits
        { id: "m2", name: "Mean2", role: "y" },
        { id: "lo", name: "Lower", role: "errlow", group: "m2" },
        { id: "hi", name: "Upper", role: "errhigh", group: "m2" },
      ],
      rows: [],
    };
    const runs = dataColumnRuns(t);
    expect(runs[0]!.cols.map((c) => c.sub)).toEqual(["Mean", "%CV", "N"]);
    expect(runs[1]!.cols.map((c) => c.sub)).toEqual(["Mean", "Lower", "Upper"]);
  });

  it("labels range / IQR / geometric subcolumns with the right centre", () => {
    const mk = (dataCols: DataTable["columns"]): DataTable => ({
      id: "t", kind: "xy", name: "T",
      columns: [{ id: "x", name: "X", role: "x" }, { id: "m", name: "Y", role: "y" }, ...dataCols],
      rows: [],
    });
    const iqr = mk([{ id: "a", name: "Q1", role: "q1", group: "m" }, { id: "b", name: "Q3", role: "q3", group: "m" }]);
    expect(dataColumnRuns(iqr)[0]!.cols.map((c) => c.sub)).toEqual(["Median", "Q1", "Q3"]);
    const geo = mk([{ id: "g", name: "GSD", role: "geosd", group: "m" }]);
    expect(dataColumnRuns(geo)[0]!.cols.map((c) => c.sub)).toEqual(["Geo mean", "GSD"]);
    const range = mk([{ id: "lo", name: "Min", role: "min", group: "m" }, { id: "hi", name: "Max", role: "max", group: "m" }]);
    expect(dataColumnRuns(range)[0]!.cols.map((c) => c.sub)).toEqual(["Mean", "Min", "Max"]);
    // Box values: median centre + the four box endpoints.
    const box = mk([
      { id: "mn", name: "Min", role: "min", group: "m" },
      { id: "a", name: "Q1", role: "q1", group: "m" },
      { id: "b", name: "Q3", role: "q3", group: "m" },
      { id: "mx", name: "Max", role: "max", group: "m" },
    ]);
    expect(dataColumnRuns(box)[0]!.cols.map((c) => c.sub)).toEqual(["Median", "Min", "Q1", "Q3", "Max"]);
  });

  it("reads a lone ± error column as '± Err', not a one-sided 'Upper'", () => {
    // "Mean ± error" mode stores a single symmetric value in an errhigh column with no
    // errlow sibling — it is a ± offset, not an upper limit.
    const t: DataTable = {
      id: "t", kind: "xy", name: "T",
      columns: [
        { id: "x", name: "X", role: "x" },
        { id: "m", name: "Mean", role: "y" },
        { id: "e", name: "Error", role: "errhigh", group: "m" },
      ],
      rows: [],
    };
    expect(dataColumnRuns(t)[0]!.cols.map((c) => c.sub)).toEqual(["Mean", "± Err"]);
  });
});

describe("DataGrid header adapts to the table format", () => {
  const mk = (kind: DataTable["kind"], cols: Array<{ id: string; name: string }>): DataTable => ({
    id: "t", kind, name: "T", columns: cols, rows: [{ id: "r", cells: {} }],
  });
  const roleTags = (c: HTMLElement) => [...c.querySelectorAll(".dghead .dgrole")].map((e) => e.textContent);

  it("XY: a tinted lead 'X' column + 'Y' data columns", () => {
    const { container } = render(<DataGrid table={mk("xy", [{ id: "x", name: "Dose" }, { id: "y", name: "Resp" }])} {...fns()} />);
    expect(roleTags(container)).toEqual(["X", "Y"]);
    // the lead column is visually distinguished (dgx) and it's the first header
    const lead = container.querySelector(".dghead.dgx .dgname");
    expect(lead?.textContent).toBe("Dose");
  });

  it("Column: a 'Labels' lead + 'Group' data columns (the first group is not taken as X)", () => {
    const { container } = render(<DataGrid table={mk("column", [{ id: "l", name: "" }, { id: "a", name: "Control" }, { id: "b", name: "Treated" }])} {...fns()} />);
    expect(roleTags(container)).toEqual(["Labels", "Group", "Group"]);
  });

  it("Multivariable: no lead column — every column is a 'Variable'", () => {
    const { container } = render(<DataGrid table={mk("multivariable", [{ id: "a", name: "Age" }, { id: "b", name: "BMI" }])} {...fns()} />);
    expect(roleTags(container)).toEqual(["Variable", "Variable"]);
    expect(container.querySelector(".dghead.dgx")).toBeNull(); // no X column
  });

  it("Survival: a 'Time' lead + 'Group' columns", () => {
    const { container } = render(<DataGrid table={mk("survival", [{ id: "t", name: "Time" }, { id: "g", name: "Group A" }])} {...fns()} />);
    expect(roleTags(container)).toEqual(["Time", "Group"]);
  });
});

function fns() {
  return {
    onEditCell: vi.fn(), onRenameColumn: vi.fn(), onPaste: vi.fn(),
    onClearCells: vi.fn(), onFillDown: vi.fn(), onTranspose: vi.fn(),
  };
}

describe("DataGrid grouped header (rendered)", () => {
  it("renders a dataset band over numbered subcolumns when replicates exist", () => {
    const t: DataTable = {
      id: "t", kind: "xy", name: "T",
      columns: [
        { id: "x", name: "Dose", role: "x" },
        { id: "a1", name: "Drug A", role: "y" },
        { id: "a2", name: "rep2", role: "y", group: "a1" },
      ],
      rows: [{ id: "r1", cells: { x: 1, a1: 10, a2: 12 } }],
    };
    const fns = {
      onEditCell: vi.fn(), onRenameColumn: vi.fn(), onPaste: vi.fn(),
      onClearCells: vi.fn(), onFillDown: vi.fn(), onTranspose: vi.fn(),
    };
    const { container } = render(<DataGrid table={t} {...fns} />);
    const groups = [...container.querySelectorAll(".dggrouphead .dgname")].map((e) => e.textContent);
    expect(groups).toContain("Drug A");
    const subs = [...container.querySelectorAll(".dgsubhead")].map((e) => e.textContent);
    expect(subs).toEqual(["1", "2"]);
    // double-click the dataset band renames the lead column
    fireEvent.doubleClick(container.querySelector(".dggrouphead") as HTMLElement);
    const input = container.querySelector(".dggrouphead .dgin") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Treated" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(fns.onRenameColumn).toHaveBeenCalledWith("a1", "Treated");
  });
});

describe("DataGrid direct-delete crosses", () => {
  it("the column × calls onDeleteColumn; the row × calls onDeleteRow", () => {
    const onDeleteColumn = vi.fn();
    const onDeleteRow = vi.fn();
    const { container } = render(
      <DataGrid
        table={table}
        onEditCell={vi.fn()}
        onRenameColumn={vi.fn()}
        onPaste={vi.fn()}
        onClearCells={vi.fn()}
        onFillDown={vi.fn()}
        onTranspose={vi.fn()}
        onDeleteColumn={onDeleteColumn}
        onDeleteRow={onDeleteRow}
      />,
    );
    const colX = container.querySelector(".dgcolx") as HTMLButtonElement;
    expect(colX).toBeTruthy();
    fireEvent.click(colX);
    expect(onDeleteColumn).toHaveBeenCalledWith(0); // first column

    const rowX = container.querySelector(".dgrowx") as HTMLButtonElement;
    expect(rowX).toBeTruthy();
    fireEvent.click(rowX);
    expect(onDeleteRow).toHaveBeenCalledWith(0); // first row

    // no crosses on a frozen (read-only) table
    cleanup();
    const frozen = render(
      <DataGrid table={{ ...table, frozen: true }} onEditCell={vi.fn()} onRenameColumn={vi.fn()} onPaste={vi.fn()} onClearCells={vi.fn()} onFillDown={vi.fn()} onTranspose={vi.fn()} onDeleteColumn={onDeleteColumn} onDeleteRow={onDeleteRow} />,
    );
    expect(frozen.container.querySelector(".dgcolx")).toBeNull();
    expect(frozen.container.querySelector(".dgrowx")).toBeNull();
  });
});

describe("DataGrid 'Use as X axis' menu item", () => {
  const menuItem = (container: HTMLElement, label: string): HTMLButtonElement | undefined =>
    [...container.querySelectorAll(".dgmenu-i")].find((b) => b.textContent === label) as HTMLButtonElement | undefined;

  it("offers 'Use as X axis' on a non-X column (calls onSetXColumn) and hides it on the current X", () => {
    const onSetXColumn = vi.fn();
    const { container } = render(
      <DataGrid table={table} onEditCell={vi.fn()} onRenameColumn={vi.fn()} onPaste={vi.fn()} onClearCells={vi.fn()} onFillDown={vi.fn()} onTranspose={vi.fn()} onInsertColumn={vi.fn()} onSetXColumn={onSetXColumn} onMoveColumn={vi.fn()} />,
    );
    const heads = container.querySelectorAll("th.dghead"); // [0]=X, [1]=Y, then spares
    // Right-click the Y column → the option appears and re-roles column 1.
    fireEvent.contextMenu(heads[1]!);
    expect(menuItem(container, "Use as X axis"), "offered on a non-X column").toBeTruthy();
    fireEvent.click(menuItem(container, "Use as X axis")!);
    expect(onSetXColumn).toHaveBeenCalledWith(1);
    // Right-click the X column → it is already the X, so no such option.
    fireEvent.contextMenu(heads[0]!);
    expect(menuItem(container, "Use as X axis"), "hidden on the current X").toBeFalsy();
  });

  it("is hidden for a multivariable sheet (no single X column)", () => {
    const mv: DataTable = {
      id: "m", kind: "multivariable", name: "M",
      columns: [{ id: "a", name: "A" }, { id: "b", name: "B" }],
      rows: [{ id: "r1", cells: { a: 1, b: 2 } }],
    };
    const { container } = render(
      <DataGrid table={mv} onEditCell={vi.fn()} onRenameColumn={vi.fn()} onPaste={vi.fn()} onClearCells={vi.fn()} onFillDown={vi.fn()} onTranspose={vi.fn()} onInsertColumn={vi.fn()} onSetXColumn={vi.fn()} onMoveColumn={vi.fn()} />,
    );
    fireEvent.contextMenu(container.querySelectorAll("th.dghead")[0]!);
    expect(menuItem(container, "Use as X axis")).toBeFalsy();
  });
});

// Typing a numeric slash date into a date column must follow the app's
// date-order setting, end to end — the real commit() → resolveDateOrder() → parseCellInput seam.
describe("DataGrid — date entry follows the app's date-order setting", () => {
  afterEach(() => localStorage.clear());
  const dateTable: DataTable = {
    id: "t", kind: "xy", name: "T",
    columns: [{ id: "d", name: "When", type: "date" }, { id: "y", name: "Y" }],
    rows: [{ id: "r1", cells: { d: null, y: 1 } }],
  };
  const typeInto00 = (): ReturnType<typeof vi.fn> => {
    const onEditCell = vi.fn();
    const u = render(<DataGrid table={dateTable} onEditCell={onEditCell} onRenameColumn={vi.fn()} onPaste={vi.fn()} onClearCells={vi.fn()} onFillDown={vi.fn()} onTranspose={vi.fn()} />);
    const cell00 = u.container.querySelectorAll(".dgcell")[0] as HTMLElement;
    fireEvent.doubleClick(cell00);
    const input = u.container.querySelector(".dgin") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "05/06/2020" } });
    fireEvent.keyDown(input, { key: "Enter" });
    return onEditCell;
  };

  it("International (dmy) reads 05/06/2020 as 5 June; US (mdy) as 6 May", () => {
    localStorage.setItem("mady.profile.app", JSON.stringify({ dateOrder: "dmy" }));
    expect(daysToISO(typeInto00().mock.calls[0]![2] as number)).toBe("2020-06-05");
    cleanup();
    localStorage.setItem("mady.profile.app", JSON.stringify({ dateOrder: "mdy" }));
    expect(daysToISO(typeInto00().mock.calls[0]![2] as number)).toBe("2020-05-06");
  });
});

describe("DataGrid right-click clipboard (Copy/Cut/Paste/Paste transposed)", () => {
  const block: DataTable = {
    id: "tb", kind: "xy", name: "Blk",
    columns: [{ id: "cx", name: "X" }, { id: "cy", name: "Y" }],
    rows: [{ id: "r1", cells: { cx: 1, cy: 10 } }, { id: "r2", cells: { cx: 2, cy: 20 } }],
  };
  let restoreClip: (() => void) | null = null;
  function mockClipboard(readValue = "5\t6\n7\t8") {
    const writeText = vi.fn(() => Promise.resolve());
    const readText = vi.fn(() => Promise.resolve(readValue));
    const prev = Object.getOwnPropertyDescriptor(navigator, "clipboard");
    Object.defineProperty(navigator, "clipboard", { value: { writeText, readText }, configurable: true });
    restoreClip = () => {
      if (prev) Object.defineProperty(navigator, "clipboard", prev);
      else delete (navigator as unknown as { clipboard?: unknown }).clipboard;
    };
    return { writeText, readText };
  }
  afterEach(() => { restoreClip?.(); restoreClip = null; });

  function mountBlock() {
    const onPaste = vi.fn();
    const onClearCells = vi.fn();
    const utils = render(
      <DataGrid table={block} onEditCell={vi.fn()} onRenameColumn={vi.fn()} onPaste={onPaste} onClearCells={onClearCells} onFillDown={vi.fn()} onTranspose={vi.fn()} onToggleExcluded={vi.fn()} />,
    );
    const cells = utils.container.querySelectorAll(".dgcell");
    const at = (r: number, c: number) => cells[r * TOTAL_COLS + c] as HTMLElement;
    // select the 2×2 real block, then open the cell context menu
    const openMenu = () => {
      fireEvent.mouseDown(at(0, 0));
      fireEvent.mouseDown(at(1, 1), { shiftKey: true });
      fireEvent.mouseDown(at(0, 0), { button: 2 });
      fireEvent.contextMenu(at(0, 0));
    };
    const item = (label: string) =>
      [...utils.container.querySelectorAll(".dgmenu-i")].find((b) => (b.textContent ?? "").trim() === label) as HTMLElement;
    return { ...utils, onPaste, onClearCells, openMenu, item };
  }

  it("Copy writes the selected block to the clipboard as TSV", () => {
    const { writeText } = mockClipboard();
    const g = mountBlock();
    g.openMenu();
    fireEvent.click(g.item("Copy"));
    expect(writeText).toHaveBeenCalledWith("1\t10\n2\t20");
  });

  it("Cut writes the block AND clears the selected cells", () => {
    const { writeText } = mockClipboard();
    const g = mountBlock();
    g.openMenu();
    fireEvent.click(g.item("Cut"));
    expect(writeText).toHaveBeenCalledWith("1\t10\n2\t20");
    expect(g.onClearCells).toHaveBeenCalledWith(0, 0, 2, 2);
  });

  it("Paste reads the clipboard and pastes at the selection's top-left", async () => {
    mockClipboard("5\t6\n7\t8");
    const g = mountBlock();
    g.openMenu();
    fireEvent.click(g.item("Paste"));
    await waitFor(() => expect(g.onPaste).toHaveBeenCalledWith(0, 0, [[5, 6], [7, 8]]));
  });

  it("Paste transposed swaps rows/columns of the pasted block", async () => {
    mockClipboard("5\t6\n7\t8");
    const g = mountBlock();
    g.openMenu();
    fireEvent.click(g.item("Paste transposed"));
    await waitFor(() => expect(g.onPaste).toHaveBeenCalledWith(0, 0, [[5, 7], [6, 8]]));
  });
});

describe("DataGrid column right-click — Sort", () => {
  function mount(onSortColumn = vi.fn(), tbl: DataTable = table) {
    const utils = render(
      // onInsertColumn/onDeleteColumn make the grid "structural" so the column context menu opens.
      <DataGrid table={tbl} onEditCell={vi.fn()} onRenameColumn={vi.fn()} onPaste={vi.fn()} onClearCells={vi.fn()} onFillDown={vi.fn()} onTranspose={vi.fn()} onInsertColumn={vi.fn()} onDeleteColumn={vi.fn()} onSortColumn={onSortColumn} />,
    );
    // The data (Y) column header always opens the column context menu (it may be a
    // grouped-dataset header, so target the name's enclosing <th>, not a class).
    const yName = [...utils.container.querySelectorAll(".dgname")].find((n) => n.textContent === "Y");
    const yHead = yName?.closest("th") as HTMLElement;
    const item = (label: string) =>
      [...utils.container.querySelectorAll(".dgmenu-i")].find((b) => (b.textContent ?? "").trim() === label) as HTMLElement | undefined;
    return { ...utils, yHead, item, onSortColumn };
  }

  it("Sort ascending / descending dispatch onSortColumn with the column index + direction", () => {
    const g = mount();
    fireEvent.contextMenu(g.yHead); // right-click the Y column header (index 1)
    fireEvent.click(g.item("Sort ascending")!);
    expect(g.onSortColumn).toHaveBeenCalledWith(1, "asc");
    fireEvent.contextMenu(g.yHead);
    fireEvent.click(g.item("Sort descending")!);
    expect(g.onSortColumn).toHaveBeenLastCalledWith(1, "desc");
  });

  it("offers no Sort on a frozen (read-only) table", () => {
    const g = mount(vi.fn(), { ...table, frozen: true });
    fireEvent.contextMenu(g.yHead);
    expect(g.item("Sort ascending")).toBeUndefined();
  });
});

describe("DataGrid cell colours (fills)", () => {
  it("renders a cell's fill as its background colour", () => {
    const t: DataTable = { ...table, cellFills: { r1: { cy: "#ffcc00" } } };
    const g = renderGrid2(t);
    // the Y cell (row 0, col 1) is coloured; the X cell (col 0) is not. `backgroundColor`
    // (not the `background` shorthand) so a pattern overlay's backgroundImage can coexist.
    expect(g.cell(0, 1).style.backgroundColor).not.toBe("");
    expect(g.cell(0, 0).style.backgroundColor).toBe("");
  });

  it("renders a cell's pattern as a repeating background image, over its fill", () => {
    const t: DataTable = {
      ...table,
      cellFills: { r1: { cy: "#ffcc00" } },
      cellPatterns: { r1: { cy: { kind: "hatch", color: "#333333" } } },
    };
    const g = renderGrid2(t);
    const cell = g.cell(0, 1);
    expect(cell.style.backgroundImage, "the pattern draws no background image").toContain("data:image/svg+xml");
    expect(cell.style.backgroundRepeat).toBe("repeat");
    expect(cell.style.backgroundColor, "the fill colour must survive under the pattern").not.toBe("");
    // a cell with no pattern gets none
    expect(g.cell(0, 0).style.backgroundImage).toBe("");
  });

  it("the right-click menu offers no cell colour (it is set from the datasheet toolbar)", () => {
    const g = renderGrid2(table, { onToggleExcluded: vi.fn() });
    fireEvent.mouseDown(g.cell(0, 1));
    fireEvent.contextMenu(g.cell(0, 1));
    expect(g.container.querySelector('input[aria-label="Cell colour"]')).toBeNull();
    expect([...g.container.querySelectorAll(".dgmenu-i")].some((b) => /colour/i.test(b.textContent || ""))).toBe(false);
  });
});

describe("DataGrid right-click reaches empty cells (so Paste works there)", () => {
  it("opens the cell menu on an empty cell of an active column", () => {
    // the table has one data row (r1); right-click row index 3 (empty) in column 0
    const g = renderGrid2(table, { onToggleExcluded: vi.fn() });
    fireEvent.contextMenu(g.cell(3, 0));
    const items = [...g.container.querySelectorAll(".dgmenu .dgmenu-i")].map((b) => b.textContent);
    expect(items, "the cell menu did not open on an empty cell").toContain("Paste");
  });

  it("opens on a spare-column empty cell too", () => {
    const g = renderGrid2(table, { onToggleExcluded: vi.fn() });
    fireEvent.contextMenu(g.cell(0, 5)); // a spare column, no data
    expect([...g.container.querySelectorAll(".dgmenu .dgmenu-i")].map((b) => b.textContent)).toContain("Paste");
  });
});

/** Render with an arbitrary table + extra props (the base renderGrid uses a fixed table). */
function renderGrid2(t: DataTable, extra: Record<string, unknown> = {}) {
  const fns = { onEditCell: vi.fn(), onRenameColumn: vi.fn(), onPaste: vi.fn(), onClearCells: vi.fn(), onFillDown: vi.fn(), onTranspose: vi.fn() };
  const utils = render(<DataGrid table={t} {...fns} {...extra} />);
  const cells = () => utils.container.querySelectorAll(".dgcell");
  const cell = (r: number, c: number) => cells()[r * TOTAL_COLS + c] as HTMLElement;
  return { ...utils, cell };
}
