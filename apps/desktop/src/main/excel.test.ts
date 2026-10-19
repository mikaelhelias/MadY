// @vitest-environment node
import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { coerceGrid, daysToISO } from "@mady/core";
import * as XLSX from "xlsx";
import { buildWorkbook, excelCellToValue, legacyCellToValue, legacyWorkbookFromBuffer, workbookToSheets } from "./excel";

describe("excelCellToValue", () => {
  it("flattens numbers, strings, dates, formulas, and blanks", () => {
    expect(excelCellToValue(42)).toBe(42);
    expect(excelCellToValue("hi")).toBe("hi");
    expect(excelCellToValue(null)).toBeNull();
    expect(excelCellToValue(undefined)).toBeNull();
    expect(excelCellToValue(true)).toBe("TRUE");
    const date = new Date("2026-06-23T00:00:00.000Z");
    expect(excelCellToValue(date)).toBe(date.toISOString());
    // formula cell → its cached result
    expect(excelCellToValue({ formula: "1+1", result: 2 } as ExcelJS.CellValue)).toBe(2);
    // formula cell WITHOUT a cached result (e.g. openpyxl-written) → null, never
    // the literal "[object Object]"
    expect(excelCellToValue({ formula: "B2/A2" } as ExcelJS.CellValue)).toBeNull();
    expect(excelCellToValue({ sharedFormula: "B2/A2" } as unknown as ExcelJS.CellValue)).toBeNull();
    // formula cell whose cached result is itself an error object → the error string
    expect(excelCellToValue({ formula: "1/0", result: { error: "#DIV/0!" } } as unknown as ExcelJS.CellValue)).toBe("#DIV/0!");
    // rich text → concatenated runs
    expect(
      excelCellToValue({ richText: [{ text: "a" }, { text: "b" }] } as unknown as ExcelJS.CellValue),
    ).toBe("ab");
  });
});

describe("legacyCellToValue", () => {
  it("flattens numbers, strings, booleans, dates and blanks like the .xlsx path", () => {
    expect(legacyCellToValue(42)).toBe(42);
    expect(legacyCellToValue("hi")).toBe("hi");
    expect(legacyCellToValue(null)).toBeNull();
    expect(legacyCellToValue(undefined)).toBeNull();
    expect(legacyCellToValue(true)).toBe("TRUE");
    expect(legacyCellToValue(false)).toBe("FALSE");
    const date = new Date("2026-06-23T00:00:00.000Z");
    expect(legacyCellToValue(date)).toBe(date.toISOString());
    expect(legacyCellToValue(NaN)).toBeNull();
  });
});

describe("legacyWorkbookFromBuffer (.xls / .ods via SheetJS)", () => {
  // Build a workbook in memory, write it in a legacy bookType, and read it back — a full
  // round-trip that proves the decoder produces the same per-sheet grid shape as .xlsx.
  const makeBook = (bookType: "xls" | "ods"): Buffer => {
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([["Dose", "Resp"], [1, 10], [2, 20]]);
    XLSX.utils.book_append_sheet(wb, ws, "Raw");
    const ws2 = XLSX.utils.aoa_to_sheet([["g", "m"], ["A", 9]]);
    XLSX.utils.book_append_sheet(wb, ws2, "Sum");
    return XLSX.write(wb, { type: "buffer", bookType }) as Buffer;
  };

  it("reads a legacy .xls into name + typed grids (one per sheet)", () => {
    const sheets = legacyWorkbookFromBuffer(makeBook("xls"));
    expect(sheets.map((s) => s.name)).toEqual(["Raw", "Sum"]);
    expect(sheets[0]!.grid).toEqual([["Dose", "Resp"], [1, 10], [2, 20]]);
    expect(sheets[1]!.grid).toEqual([["g", "m"], ["A", 9]]);
  });

  it("reads an OpenDocument .ods the same way", () => {
    const sheets = legacyWorkbookFromBuffer(makeBook("ods"));
    expect(sheets[0]!.grid).toEqual([["Dose", "Resp"], [1, 10], [2, 20]]);
  });

  it("the decoded grid flows through coerceGrid to a named, number-typed table", () => {
    const grid = legacyWorkbookFromBuffer(makeBook("xls"))[0]!.grid;
    const out = coerceGrid(grid, { header: true, infer: false, detectDates: true });
    expect(out.columnNames).toEqual(["Dose", "Resp"]);
    expect(out.rows).toEqual([[1, 10], [2, 20]]);
  });
});

describe("buildWorkbook — formula-looking cells stay literal text", () => {
  it("writes =/+/-/@ cells as text, aligned with the CSV export (no injected formula)", async () => {
    const buf = await buildWorkbook({ name: "S", columns: ["v"], rows: [["=1+1"], ["+2"], ["-3"], ["@x"]] });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
    const sheets = workbookToSheets(wb);
    // Read back as literal strings, not evaluated formulas.
    expect(sheets[0]!.grid).toEqual([["v"], ["=1+1"], ["+2"], ["-3"], ["@x"]]);
  });
});

describe("workbookToSheets (write → read round-trip)", () => {
  it("decodes every sheet to a typed row-major grid", async () => {
    const wb = new ExcelJS.Workbook();
    const s1 = wb.addWorksheet("Data");
    s1.addRow(["dose", "response"]);
    s1.addRow([1, 10.5]);
    s1.addRow([2, 20]);
    const s2 = wb.addWorksheet("Notes");
    s2.addRow(["label", "value"]);
    s2.addRow(["alpha", 1]);

    const buffer = await wb.xlsx.writeBuffer();
    const reloaded = new ExcelJS.Workbook();
    await reloaded.xlsx.load(buffer);
    const sheets = workbookToSheets(reloaded);

    expect(sheets.map((s) => s.name)).toEqual(["Data", "Notes"]);
    expect(sheets[0]!.grid).toEqual([
      ["dose", "response"],
      [1, 10.5],
      [2, 20],
    ]);
    expect(sheets[1]!.grid).toEqual([
      ["label", "value"],
      ["alpha", 1],
    ]);
  });
});

describe("Excel date columns import as usable date columns", () => {
  it("a Date cell round-trips to an ISO string that detectDates types as a date column", async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("D");
    ws.addRow(["day", "value"]);
    ws.addRow([new Date("2024-01-15T00:00:00.000Z"), 10]);
    ws.addRow([new Date("2024-01-16T00:00:00.000Z"), 20]);
    const buf = await wb.xlsx.writeBuffer();
    const reloaded = new ExcelJS.Workbook();
    await reloaded.xlsx.load(buf);
    const grid = workbookToSheets(reloaded)[0]!.grid;

    // The decoder emits Excel dates as full-ISO strings…
    expect(typeof grid[1]![0]).toBe("string");
    // …and the Excel import path (detectDates) turns that column into a real `date`
    // column of day-serials — end to end, no manual Format → Date needed.
    const out = coerceGrid(grid, { header: true, infer: false, detectDates: true });
    expect(out.columnTypes?.[0]).toBe("date");
    expect(out.columnTypes?.[1]).toBeUndefined();
    expect(daysToISO(out.rows[0]![0] as number)).toBe("2024-01-15");
    expect(daysToISO(out.rows[1]![0] as number)).toBe("2024-01-16");
  });
});
