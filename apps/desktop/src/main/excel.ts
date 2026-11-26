/**
 * Spreadsheet decoding for data import, and `.xlsx` writing for export. Kept separate from
 * `index.ts` so it is unit-testable without booting the Electron app. exceljs reads
 * Office-Open-XML `.xlsx`; SheetJS reads the legacy binary `.xls`, `.xlsb` and `.ods`
 * (`legacyWorkbookFromBuffer`). Both decode each worksheet to a row-major grid of primitive
 * cell values; the renderer's `coerceGrid` does header + naming.
 */
import ExcelJS from "exceljs";
import { readFile } from "node:fs/promises";
import * as XLSX from "xlsx";

/** A cell as the document model sees it (mirrors core's `CellValue`). */
export type CellValue = number | string | null;

export interface SheetGrid {
  name: string;
  grid: CellValue[][];
}

/** Flatten one exceljs cell to a primitive CellValue (number / string / null). */
export function excelCellToValue(value: ExcelJS.CellValue | undefined): CellValue {
  if (value == null) return null;
  if (typeof value === "number") return value;
  if (typeof value === "string") return value;
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") {
    const v = value as unknown as Record<string, unknown>;
    if ("formula" in v || "sharedFormula" in v) {
      // A formula cell: use the cached result if the writer stored one, else null.
      // The formula is detected by its `formula` / `sharedFormula` key, not by `result`:
      // files written without a cached result (e.g. by openpyxl) have no `result` key and
      // would otherwise fall through to String(value), the literal "[object Object]".
      return "result" in v ? excelCellToValue(v["result"] as ExcelJS.CellValue) : null;
    }
    if ("result" in v) return excelCellToValue(v["result"] as ExcelJS.CellValue); // cached result
    if ("text" in v) return excelCellToValue(v["text"] as ExcelJS.CellValue); // hyperlink
    if ("richText" in v && Array.isArray(v["richText"])) {
      return (v["richText"] as Array<{ text?: string }>).map((r) => r.text ?? "").join("");
    }
    if ("error" in v) return String(v["error"]);
  }
  return String(value);
}

/** Decode every worksheet of an (already-loaded) workbook to name + typed grid. */
export function workbookToSheets(workbook: ExcelJS.Workbook): SheetGrid[] {
  return workbook.worksheets.map((sheet) => {
    const grid: CellValue[][] = [];
    const colCount = sheet.columnCount;
    sheet.eachRow({ includeEmpty: true }, (row) => {
      const cells: CellValue[] = [];
      for (let c = 1; c <= colCount; c++) cells.push(excelCellToValue(row.getCell(c).value));
      grid.push(cells);
    });
    return { name: sheet.name, grid };
  });
}

/** Read an `.xlsx` file from disk into per-sheet grids. */
export async function readWorkbook(path: string): Promise<SheetGrid[]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(path);
  return workbookToSheets(workbook);
}

/** Flatten one SheetJS cell (from `sheet_to_json` with `raw:true`) to a primitive CellValue,
 *  matching the exceljs path: a date becomes its ISO string (so `coerceGrid`'s date detection
 *  types it), a boolean becomes TRUE/FALSE, an empty cell null. */
export function legacyCellToValue(value: unknown): CellValue {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  if (typeof value === "string") return value;
  return String(value);
}

/**
 * Decode a legacy/alternative spreadsheet buffer (`.xls` BIFF, `.ods`, `.xlsb`) to the same
 * per-sheet grid shape as the `.xlsx` path, using SheetJS. Pure over a buffer so it is unit-
 * testable without disk. Each worksheet becomes a row-major grid; `coerceGrid` in the renderer
 * still does header + naming, so these formats flow through the same import dialog.
 */
export function legacyWorkbookFromBuffer(buffer: Buffer): SheetGrid[] {
  const wb = XLSX.read(buffer, { type: "buffer", cellDates: true });
  return wb.SheetNames.map((name) => {
    const ws = wb.Sheets[name];
    const rows = (ws ? XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null, blankrows: true }) : []) as unknown[][];
    return { name, grid: rows.map((row) => row.map(legacyCellToValue)) };
  });
}

/** Read a legacy/alternative spreadsheet (`.xls` / `.ods` / `.xlsb`) from disk into per-sheet grids. */
export async function readLegacyWorkbook(path: string): Promise<SheetGrid[]> {
  return legacyWorkbookFromBuffer(await readFile(path));
}

/**
 * Build an `.xlsx` workbook from a single sheet (header row + data rows) and
 * return it as a binary buffer — the data-export counterpart to `readWorkbook`.
 * Header cells are bold; columns auto-fit to a sensible width.
 */
export async function buildWorkbook(sheet: {
  name: string;
  columns: string[];
  rows: (string | number | null)[][];
}): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "MadY";
  // Excel worksheet names cap at 31 chars and forbid : \ / ? * [ ]. Sanitize here as
  // defence-in-depth: exceljs throws on an illegal name, and MadY's own derived-table
  // names (e.g. "First derivative dY/dX — Data 1") contain a slash, which would make the
  // whole export fail.
  const safeName = sheet.name.replace(/[:\\/?*[\]]/g, " ").trim().slice(0, 31) || "Data";
  const ws = workbook.addWorksheet(safeName);
  const header = ws.addRow(sheet.columns);
  header.font = { bold: true };
  for (const row of sheet.rows) ws.addRow(row.map((v) => (v == null ? "" : v)));
  ws.columns.forEach((col, i) => {
    const headLen = sheet.columns[i]?.length ?? 8;
    col.width = Math.max(10, Math.min(40, headLen + 2));
  });
  const buf = await workbook.xlsx.writeBuffer();
  return Buffer.from(buf);
}
