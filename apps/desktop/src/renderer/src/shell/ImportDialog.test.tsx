// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { ImportDialog } from "./ImportDialog";
import type { ImportSource } from "./ImportDialog";

afterEach(cleanup);

function setup(src: ImportSource, tables?: ReadonlyArray<{ id: string; name: string }>) {
  const onConfirm = vi.fn();
  const onCancel = vi.fn();
  const utils = render(<ImportDialog src={src} tables={tables} onConfirm={onConfirm} onCancel={onCancel} />);
  const confirmBtn = () => utils.container.querySelector(".modalbtns .btn") as HTMLButtonElement;
  // The preview is the real DataGrid, so column names live in its header `.dgname` spans
  // (spare columns render none).
  const headers = () =>
    Array.from(utils.container.querySelectorAll(".importgrid .dgname")).map((el) => el.textContent);
  const dataHeaders = () => utils.container.querySelectorAll(".importgrid th.dghead");
  const menuItem = (label: string) =>
    [...utils.container.querySelectorAll(".dgmenu-i")].find((b) => b.textContent === label) as HTMLButtonElement | undefined;
  const checkboxes = () =>
    Array.from(utils.container.querySelectorAll('.importchk input[type="checkbox"]')) as HTMLInputElement[];
  // Find a checkbox by its label text (robust to control order — a units/link box may sit between).
  const chkByLabel = (text: string) =>
    checkboxes().find((b) => (b.parentElement?.textContent ?? "").includes(text))!;
  const headerBox = () => chkByLabel("header");
  const transposeBox = () => chkByLabel("Transpose");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const lastResults = () => onConfirm.mock.calls[0]![0] as any[];
  const lastResult = () => lastResults()[0]!; // single-sheet/text: the first (only) result
  return { ...utils, onConfirm, onCancel, confirmBtn, headers, dataHeaders, menuItem, headerBox, transposeBox, lastResult, lastResults };
}

const CSV: ImportSource = { source: "text", name: "dose", text: "dose,response\n1,10\n2,20" };

describe("ImportDialog — delimited text", () => {
  it("auto-detects a header and shows the column names in the grid", () => {
    const d = setup(CSV);
    expect(d.headerBox().checked).toBe(true);
    expect(d.headers()).toEqual(["dose", "response"]);
  });

  it("detected types ride into the import: a date column is typed, its cells are day-serials", () => {
    const d = setup({ source: "text", name: "covid", text: "date,cases,note\n1/22/2020,5,first\n2/22/2020,40,peak" });
    expect(d.headers()).toEqual(["date", "cases", "note"]);
    fireEvent.click(d.confirmBtn());
    const t = d.lastResult().table!;
    expect(t.columns[0]!.type).toBe("date"); // detected
    expect(t.columns[1]!.type).toBeUndefined(); // plain number
    expect(t.columns[2]!.type).toBeUndefined(); // text label (untyped, string cells)
    expect(typeof t.rows[0]!.cells[t.columns[0]!.id]).toBe("number"); // date stored as a serial
    expect(t.rows[0]!.cells[t.columns[2]!.id]).toBe("first"); // label kept as text
  });

  it("confirms with the shaped table + mirrored flat CoercedTable fields", () => {
    const d = setup(CSV);
    fireEvent.click(d.confirmBtn());
    const arg = d.lastResult();
    expect(arg.name).toBe("dose");
    expect(arg.columnNames).toEqual(["dose", "response"]);
    expect(arg.rows).toEqual([[1, 10], [2, 20]]);
    // the full table is carried so confirmImport can adopt it intact
    expect(arg.table.columns.map((c: { name: string }) => c.name)).toEqual(["dose", "response"]);
  });

  it("a grid edit flows into the import (right-click ▸ Use as X axis reorders the columns)", () => {
    const d = setup(CSV);
    fireEvent.contextMenu(d.dataHeaders()[1]!); // the 'response' (Y) header
    fireEvent.click(d.menuItem("Use as X axis")!);
    fireEvent.click(d.confirmBtn());
    // 'response' moved to the lead (X) position — the preview grid's edit is what imports.
    expect(d.lastResult().columnNames).toEqual(["response", "dose"]);
  });

  it("toggling the header flips the first row between names and data", () => {
    const d = setup(CSV);
    fireEvent.click(d.headerBox());
    expect(d.headers()).toEqual(["Column 1", "Column 2"]);
  });

  it("re-parses when the delimiter is changed", () => {
    const d = setup({ source: "text", name: "t", text: "a;b\n1;2" });
    const select = d.container.querySelector('select[aria-label="Delimiter"]') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: ";" } });
    expect(d.headers()).toEqual(["a", "b"]);
  });

  it("auto-detects a European decimal comma and imports numeric columns", () => {
    const d = setup({ source: "text", name: "eu", text: "dose;response\n1,5;10,2\n2,0;20,4" });
    fireEvent.click(d.confirmBtn());
    expect(d.lastResult().rows).toEqual([[1.5, 10.2], [2, 20.4]]);
  });

  it("cancels", () => {
    const d = setup(CSV);
    fireEvent.click(d.container.querySelector(".btn-ghost") as HTMLButtonElement);
    expect(d.onCancel).toHaveBeenCalled();
  });

  it("transpose swaps rows/columns (variables-in-rows → columns)", () => {
    const d = setup({ source: "text", name: "wide", text: "name,x,y\nA,1,2\nB,3,4" });
    fireEvent.click(d.transposeBox());
    expect(d.headers()).toEqual(["name", "A", "B"]);
    fireEvent.click(d.confirmBtn());
    expect(d.lastResult().rows).toEqual([["x", 1, 3], ["y", 2, 4]]);
  });

  it("Skip rows drops preamble lines so the real header is detected", () => {
    // two metadata lines sit above the table
    const d = setup({ source: "text", name: "meta", text: "# exported\nrun: 7\ndose,response\n1,10\n2,20" });
    // before skipping, the first line is (wrongly) treated as the header
    expect(d.headers()).not.toEqual(["dose", "response"]);
    const skip = d.container.querySelector('input[aria-label="Skip rows"]') as HTMLInputElement;
    fireEvent.change(skip, { target: { value: "2" } });
    expect(d.headers()).toEqual(["dose", "response"]);
    fireEvent.click(d.confirmBtn());
    expect(d.lastResult().rows).toEqual([[1, 10], [2, 20]]);
  });

  it("Whitespace delimiter parses a space-aligned table into columns", () => {
    const d = setup({ source: "text", name: "aligned", text: "Dose   Response\n1      10\n2      20" });
    const select = d.container.querySelector('select[aria-label="Delimiter"]') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "whitespace" } });
    expect(d.headers()).toEqual(["Dose", "Response"]); // runs of spaces collapse to one break
    fireEvent.click(d.confirmBtn());
    expect(d.lastResult().rows).toEqual([[1, 10], [2, 20]]);
  });

  it("shows what the importer auto-detected (delimiter / decimal / header)", () => {
    const d = setup({ source: "text", name: "csv", text: "dose,response\n1,10\n2,20" });
    const line = d.container.querySelector('[aria-label="Detected import settings"]');
    expect(line, "no detected-settings line").toBeTruthy();
    expect(line!.textContent).toMatch(/comma-separated/);
    expect(line!.textContent).toMatch(/point decimal/);
    expect(line!.textContent).toMatch(/header row 1/);
  });

  it("ragged warning suggests a delimiter that makes the file rectangular, and applies it", () => {
    // tab-delimited, but one row also has a comma → ragged when read as comma
    const d = setup({ source: "text", name: "tabs", text: "a\tb\tc\n1\t2\t3\n4,5\t6\t7" });
    const select = d.container.querySelector('select[aria-label="Delimiter"]') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "," } }); // force comma → now ragged
    const warn = d.container.querySelector(".importwarn");
    expect(warn, "no ragged warning under comma").toBeTruthy();
    const btn = warn!.querySelector("button.linkbtn") as HTMLButtonElement;
    expect(btn?.textContent).toBe("tab"); // suggests the delimiter that makes it rectangular
    fireEvent.click(btn);
    expect(d.headers()).toEqual(["a", "b", "c"]); // switched to tab → clean columns
  });

  it("warns when a file has ragged rows (a line with fewer columns than the rest)", () => {
    const d = setup({ source: "text", name: "ragged", text: "a,b,c\n1,2,3\n4,5" });
    const warn = d.container.querySelector(".importwarn");
    expect(warn, "no ragged-row warning shown").toBeTruthy();
    expect(warn!.textContent).toMatch(/fewer columns/);
  });

  it("shows no ragged warning for a rectangular file", () => {
    const d = setup({ source: "text", name: "ok", text: "a,b\n1,2\n3,4" });
    expect(d.container.querySelector(".importwarn")).toBeNull();
  });

  it("Thousands separator reads grouped numbers as one value", () => {
    // tab-delimited, so a comma is free to be the thousands grouping
    const d = setup({ source: "text", name: "grp", text: "v\tlabel\n1,000,000\ta,b\n2,500\tx" });
    const sel = d.container.querySelector('select[aria-label="Thousands separator"]') as HTMLSelectElement;
    fireEvent.change(sel, { target: { value: "," } });
    fireEvent.click(d.confirmBtn());
    expect(d.lastResult().rows).toEqual([[1000000, "a,b"], [2500, "x"]]);
  });

  it("keep-all by default: NA stays as text unless the user opts in by typing the token", () => {
    // Keeping every value is the default; excluding NA is opt-in.
    const d = setup({ source: "text", name: "na", text: "dose,response\n1,NA\n2,20" });
    expect((d.container.querySelector('input[aria-label="Missing-value tokens"]') as HTMLInputElement).value, "the field must start empty").toBe("");
    fireEvent.click(d.confirmBtn());
    expect(d.lastResult().rows).toEqual([[1, "NA"], [2, 20]]); // NA kept — nothing to clear
    // Opt in: type NA → now it reads as missing.
    const d2 = setup({ source: "text", name: "na", text: "dose,response\n1,NA\n2,20" });
    fireEvent.change(d2.container.querySelector('input[aria-label="Missing-value tokens"]') as HTMLInputElement, { target: { value: "NA" } });
    fireEvent.click(d2.confirmBtn());
    expect(d2.lastResult().rows).toEqual([[1, null], [2, 20]]);
  });

  it("a Settings default of NA tokens still applies (opt-in, once, for every import)", () => {
    localStorage.setItem("mady.profile.app", JSON.stringify({ missingValues: "NA, null" }));
    try {
      const d = setup({ source: "text", name: "na", text: "code,response\nNA,10\nX,20" });
      fireEvent.click(d.confirmBtn());
      expect(d.lastResult().rows).toEqual([[null, 10], ["X", 20]]); // NA excluded because the user set a default
    } finally {
      localStorage.removeItem("mady.profile.app");
    }
  });

  it("clearing the Missing-values field keeps the tokens as text", () => {
    const d = setup({ source: "text", name: "na", text: "code,response\nNA,10\nX,20" });
    const na = d.container.querySelector('input[aria-label="Missing-value tokens"]') as HTMLInputElement;
    fireEvent.change(na, { target: { value: "" } });
    fireEvent.click(d.confirmBtn());
    expect(d.lastResult().rows).toEqual([["NA", 10], ["X", 20]]); // NA kept as a label
  });

  it("Comment marker drops '#' lines so the real header is detected", () => {
    const d = setup({ source: "text", name: "rig", text: "# exported by rig\n# 2 header notes\ndose,response\n1,10\n2,20" });
    // before selecting a comment marker, the first '#' line is (wrongly) the header
    expect(d.headers()).not.toEqual(["dose", "response"]);
    const sel = d.container.querySelector('select[aria-label="Comment marker"]') as HTMLSelectElement;
    fireEvent.change(sel, { target: { value: "#" } });
    expect(d.headers()).toEqual(["dose", "response"]);
    fireEvent.click(d.confirmBtn());
    expect(d.lastResult().rows).toEqual([[1, 10], [2, 20]]);
  });

  it("Second-row-is-units folds a units row into the column names and drops it from data", () => {
    const d = setup({ source: "text", name: "kinetics", text: "Time,Conc\ns,µM\n0,1\n10,2" });
    const unitsBox = [...d.container.querySelectorAll('.importchk input[type="checkbox"]')].find(
      (b) => (b.parentElement?.textContent ?? "").includes("units"),
    ) as HTMLInputElement;
    fireEvent.click(unitsBox);
    expect(d.headers()).toEqual(["Time (s)", "Conc (µM)"]);
    fireEvent.click(d.confirmBtn());
    expect(d.lastResult().rows).toEqual([[0, 1], [10, 2]]);
  });

  it("JSON array-of-objects imports as a keyed table (auto-selected when the text looks like JSON)", () => {
    const d = setup({ source: "text", name: "data", text: '[{"x":1,"y":2},{"x":3,"y":4}]' });
    // auto-picked JSON, so the delimiter select reads "json"
    const sel = d.container.querySelector('select[aria-label="Delimiter"]') as HTMLSelectElement;
    expect(sel.value).toBe("json");
    expect(d.headers()).toEqual(["x", "y"]);
    fireEvent.click(d.confirmBtn());
    expect(d.lastResult().rows).toEqual([[1, 2], [3, 4]]);
  });

  it("NDJSON (one object per line) imports as a table", () => {
    const d = setup({ source: "text", name: "log", text: '{"a":1,"b":2}\n{"a":3,"b":4}' });
    const sel = d.container.querySelector('select[aria-label="Delimiter"]') as HTMLSelectElement;
    fireEvent.change(sel, { target: { value: "json" } });
    expect(d.headers()).toEqual(["a", "b"]);
    fireEvent.click(d.confirmBtn());
    expect(d.lastResult().rows).toEqual([[1, 2], [3, 4]]);
  });

  it("JSON keeps its own types — a numeric-looking string is not re-parsed to a number", () => {
    const d = setup({ source: "text", name: "codes", text: '[{"code":"007","n":5}]' });
    const sel = d.container.querySelector('select[aria-label="Delimiter"]') as HTMLSelectElement;
    expect(sel.value).toBe("json");
    fireEvent.click(d.confirmBtn());
    expect(d.lastResult().rows).toEqual([["007", 5]]); // "007" stays a string; 5 stays a number
  });

  it("no Destination selector when there are no existing datasheets", () => {
    const d = setup(CSV);
    expect(d.container.querySelector('select[aria-label="Destination"]')).toBeNull();
  });

  it("choosing an existing sheet as Destination confirms with appendTo (default match: name)", () => {
    const d = setup(CSV, [{ id: "tbl-9", name: "Experiment" }]);
    const dest = d.container.querySelector('select[aria-label="Destination"]') as HTMLSelectElement;
    fireEvent.change(dest, { target: { value: "tbl-9" } });
    // the button now offers to append
    expect(d.container.querySelector(".modalbtns .btn")!.textContent).toMatch(/^Append 2 rows$/);
    fireEvent.click(d.confirmBtn());
    expect(d.lastResult().appendTo).toEqual({ tableId: "tbl-9", match: "name" });
  });

  it("append can match by position, and does not emit a link even with a path", () => {
    const d = setup({ ...CSV, path: "C:/x/dose.csv" }, [{ id: "tbl-1", name: "T" }]);
    fireEvent.change(d.container.querySelector('select[aria-label="Destination"]') as HTMLSelectElement, { target: { value: "tbl-1" } });
    fireEvent.change(d.container.querySelector('select[aria-label="Append match mode"]') as HTMLSelectElement, { target: { value: "position" } });
    fireEvent.click(d.confirmBtn());
    expect(d.lastResult().appendTo).toEqual({ tableId: "tbl-1", match: "position" });
    expect(d.lastResult().link).toBeUndefined(); // linking is only for a new datasheet
  });

  it("Skip rows is recorded on the linked source for auto-updating re-reads", () => {
    const d = setup({ source: "text", name: "meta", text: "note\ndose,response\n1,10", path: "C:/x/meta.csv" });
    const skip = d.container.querySelector('input[aria-label="Skip rows"]') as HTMLInputElement;
    fireEvent.change(skip, { target: { value: "1" } });
    // tick "Keep linked to file"
    const linkBox = [...d.container.querySelectorAll('.importchk input[type="checkbox"]')].at(-1) as HTMLInputElement;
    fireEvent.click(linkBox);
    fireEvent.click(d.confirmBtn());
    expect(d.lastResult().link).toMatchObject({ path: "C:/x/meta.csv", skipRows: 1 });
  });
});

describe("ImportDialog — Excel", () => {
  const XLSX: ImportSource = {
    source: "excel",
    name: "book",
    sheets: [
      { name: "S1", grid: [["x", "y"], [1, 2]] },
      { name: "S2", grid: [["p", "q"], [9, 8]] },
    ],
  };

  const sheetRow = (d: ReturnType<typeof setup>, name: string) =>
    [...d.container.querySelectorAll(".sheetrail .srow")].find((r) => r.querySelector(".sn")?.textContent === name) as HTMLElement;

  it("shows a sheet checklist and switches the preview when a sheet is clicked", () => {
    const d = setup(XLSX);
    expect(d.headers()).toEqual(["x", "y"]); // first sheet previewed
    expect(d.container.querySelectorAll(".sheetrail .srow")).toHaveLength(2);
    fireEvent.click(sheetRow(d, "S2")); // click the row (not the checkbox)
    expect(d.headers()).toEqual(["p", "q"]);
  });

  it("imports every checked sheet as its own datasheet (one result each)", () => {
    const d = setup(XLSX);
    fireEvent.click(d.confirmBtn());
    const results = d.lastResults();
    expect(results.map((r) => r.name)).toEqual(["S1", "S2"]); // both data sheets checked by default
    expect(results[0]!.columnNames).toEqual(["x", "y"]);
    expect(results[1]!.columnNames).toEqual(["p", "q"]);
  });

  it("unchecking a sheet drops it from the import", () => {
    const d = setup(XLSX);
    const cb = sheetRow(d, "S2").querySelector('input[type="checkbox"]') as HTMLInputElement;
    fireEvent.click(cb);
    expect(d.container.querySelector(".btn")!.textContent).toMatch(/Import 1 sheet$/);
    fireEvent.click(d.confirmBtn());
    expect(d.lastResults().map((r) => r.name)).toEqual(["S1"]);
  });

  it("remembers per-sheet options: a skip-rows on one sheet doesn't affect the other", () => {
    const d = setup({
      source: "excel", name: "book",
      sheets: [
        { name: "Clean", grid: [["a", "b"], [1, 2], [3, 4]] },
        { name: "Preamble", grid: [["note", ""], ["x", "y"], [5, 6]] },
      ],
    });
    // On the 2nd sheet, skip the note row so "x,y" becomes the header
    fireEvent.click(sheetRow(d, "Preamble"));
    const skip = d.container.querySelector('input[aria-label="Skip rows"]') as HTMLInputElement;
    fireEvent.change(skip, { target: { value: "1" } });
    expect(d.headers()).toEqual(["x", "y"]);
    fireEvent.click(d.confirmBtn());
    const results = d.lastResults();
    const clean = results.find((r) => r.name === "Clean")!;
    const pre = results.find((r) => r.name === "Preamble")!;
    expect(clean.columnNames).toEqual(["a", "b"]); // untouched by the other sheet's skip
    expect(pre.columnNames).toEqual(["x", "y"]); // its own skip applied
  });

  it("preserves already-typed Excel cells (no re-inference)", () => {
    const d = setup({ source: "excel", name: "b", sheets: [{ name: "S", grid: [["code"], ["007"]] }] });
    expect(d.headerBox().checked).toBe(true);
    fireEvent.click(d.confirmBtn());
    expect(d.lastResult().rows).toEqual([["007"]]);
  });

  it("imports only the given cell range of the sheet", () => {
    // a sheet with a title row + a note column around the real B1:C3 table
    const d = setup({
      source: "excel", name: "ranged",
      sheets: [{ name: "S", grid: [
        ["title", "", "", "note"],
        ["", "Dose", "Resp", "x"],
        ["", 1, 10, "y"],
        ["", 2, 20, "z"],
      ] }],
    });
    const range = d.container.querySelector('input[aria-label="Cell range"]') as HTMLInputElement;
    fireEvent.change(range, { target: { value: "B2:C4" } });
    expect(d.headers()).toEqual(["Dose", "Resp"]);
    fireEvent.click(d.confirmBtn());
    expect(d.lastResult().rows).toEqual([[1, 10], [2, 20]]);
  });
});

describe("ImportDialog — pzfx data-only notice", () => {
  // A `.pzfx` reaches the dialog as excel-shaped sheets + a notice banner.
  const pzfxSrc = (notice?: string): ImportSource => ({
    source: "excel",
    name: "sample tables",
    notice,
    sheets: [{ name: "Data 1", grid: [["Residue", "Wild Type"], [1, 3.6], [2, 1.8]] }],
  });

  it("shows the 'data only, no graphs/analyses' banner when a notice is present, and still imports the data", () => {
    const d = setup(pzfxSrc("Only the data tables are imported. Graphs, layouts, analyses and formatting are not."));
    const banner = d.container.querySelector(".importnotice");
    expect(banner, "the notice banner must render for a .pzfx import").toBeTruthy();
    expect(banner!.textContent).toMatch(/graphs.*analyses|analyses.*graphs/i);
    // The data still flows through unchanged.
    expect(d.headers()).toEqual(["Residue", "Wild Type"]);
  });

  it("does not show a banner for an ordinary import with no notice", () => {
    const d = setup(pzfxSrc(undefined));
    expect(d.container.querySelector(".importnotice")).toBeNull();
  });
});
