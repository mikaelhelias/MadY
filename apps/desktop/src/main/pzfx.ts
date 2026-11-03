/**
 * `.pzfx` (XML) decoding for data-table import.
 *
 * Kept separate from `index.ts` so it is unit-testable without booting Electron, and pure over a
 * string so a fixture can drive it. It reads only the data tables: each `<Table>` becomes one
 * per-sheet grid, exactly the shape the `.xlsx`/legacy paths emit, so a `.pzfx` flows through the
 * same import dialog (the multi-sheet checklist) and the renderer's `coerceGrid` does header +
 * naming. **Graphs, layouts, analyses, fitted results and formatting are not imported** — that
 * source model has no faithful mapping onto MadY's plot/analysis model, so only the numbers come
 * across. The import dialog surfaces that limit as a banner (see PZFX_IMPORT_NOTICE).
 *
 * A `.pzfx` is a single plain-XML document (not a zip). The structure is regular and never
 * self-nests (a Table holds Columns hold Subcolumns hold `<d>` cells; none of those tags contains
 * another of the same tag), so block extraction by regex is safe and avoids an XML-parser
 * dependency in the main process.
 */
import { readFile } from "node:fs/promises";
import type { CellValue, SheetGrid } from "./excel";

/** The warning shown in the import dialog for a `.pzfx` file — only data tables cross over. */
export const PZFX_IMPORT_NOTICE =
  "Only the data tables are imported. Graphs, layouts, analyses and formatting are not — rebuild those from the imported data.";

/** Decode the five predefined XML entities plus numeric references. */
function unescapeXml(s: string): string {
  return s.replace(/&(#x?[0-9a-fA-F]+|amp|lt|gt|quot|apos);/g, (whole, ent: string) => {
    switch (ent) {
      case "amp":
        return "&";
      case "lt":
        return "<";
      case "gt":
        return ">";
      case "quot":
        return '"';
      case "apos":
        return "'";
      default: {
        // &#123; (decimal) or &#x1F; (hex)
        const code = ent[1] === "x" || ent[1] === "X" ? parseInt(ent.slice(2), 16) : parseInt(ent.slice(1), 10);
        return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
      }
    }
  });
}

/** Pull every `<d …>value</d>` cell out of a subcolumn block, in order; empty cells → "". */
function cellStrings(subcolumnXml: string): string[] {
  const out: string[] = [];
  // Matches <d/>, <d></d>, and <d attr="…">text</d>. `[^>]*` skips attributes like Excluded="1".
  const re = /<d\b[^>]*?(?:\/>|>([\s\S]*?)<\/d>)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(subcolumnXml)) !== null) out.push(m[1] == null ? "" : unescapeXml(m[1]).trim());
  return out;
}

/**
 * Decide whether this file writes decimals with a comma (European locale) by counting which
 * decimal pattern dominates across a sample of cells. The value in each `<d>` is stored in the
 * saving machine's locale, so the same reader must handle both "3.14" and "3,14".
 */
function commaIsDecimal(allCells: string[]): boolean {
  let comma = 0;
  let dot = 0;
  for (const c of allCells) {
    if (/^-?\d+,\d+(?:[eE][-+]?\d+)?$/.test(c)) comma++;
    else if (/^-?\d+\.\d+(?:[eE][-+]?\d+)?$/.test(c)) dot++;
  }
  return comma > dot;
}

/** Parse one cell string to a number when it is numeric, else keep the text, empty → null. */
function toCell(raw: string, commaDecimal: boolean): CellValue {
  if (raw === "") return null;
  // A `<d>` stores the raw stored value with no thousands separators, so a lone comma (comma
  // locale) or dot (dot locale) is the decimal point. Normalise to a JS-parseable dot form.
  const normalised = commaDecimal ? raw.replace(/\./g, "").replace(",", ".") : raw.replace(/,/g, "");
  if (/^-?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?$/.test(normalised)) {
    const n = Number(normalised);
    if (Number.isFinite(n)) return n;
  }
  return raw; // a text label (e.g. a category name) — keep it verbatim
}

/** The first `<Title>…</Title>` appearing before the first `<Subcolumn>` = the column's own title. */
function columnTitle(columnXml: string): string {
  const head = columnXml.split("<Subcolumn")[0] ?? columnXml;
  const m = /<Title>([\s\S]*?)<\/Title>/.exec(head);
  return m ? unescapeXml(m[1]!).trim() : "";
}

/** The `<Title>` of a subcolumn block, if it carries one (grouped/replicate tables sometimes do). */
function subcolumnTitle(subcolumnXml: string): string {
  const m = /<Title>([\s\S]*?)<\/Title>/.exec(subcolumnXml);
  return m ? unescapeXml(m[1]!).trim() : "";
}

interface ParsedColumn {
  /** One header + its cells per subcolumn (a replicate/SD/SEM subcolumn becomes its own column). */
  columns: { header: string; cells: CellValue[] }[];
}

/** Expand one X/Y column (with its subcolumns) into flat named columns. */
function parseColumn(columnXml: string, fallback: string, commaDecimal: boolean): ParsedColumn {
  const title = columnTitle(columnXml) || fallback;
  const subs = columnXml.match(/<Subcolumn\b[\s\S]*?<\/Subcolumn>/g) ?? [];
  if (subs.length === 0) return { columns: [{ header: title, cells: [] }] };
  const multi = subs.length > 1;
  return {
    columns: subs.map((sub, i) => {
      const subTitle = subcolumnTitle(sub);
      // Single subcolumn → the column title alone. Multiple → disambiguate by the subcolumn's own
      // title, or a 1-based index when it has none (replicate subcolumns are usually untitled).
      const header = !multi ? title : subTitle ? `${title} — ${subTitle}` : `${title} (${i + 1})`;
      return { header, cells: cellStrings(sub).map((c) => toCell(c, commaDecimal)) };
    }),
  };
}

/** Split one `<Table>…</Table>` block into a named grid (row 0 = headers, rows below = values). */
function parseTable(tableXml: string, commaDecimal: boolean): SheetGrid | null {
  // The table's own <Title> is its first, before any column.
  const tableTitle = columnTitle(tableXml) || "Data";
  // X columns first, then Y columns, in document order.
  const xCols = tableXml.match(/<XColumn\b[\s\S]*?<\/XColumn>/g) ?? [];
  const yCols = tableXml.match(/<YColumn\b[\s\S]*?<\/YColumn>/g) ?? [];
  const rowCols = tableXml.match(/<RowTitlesColumn\b[\s\S]*?<\/RowTitlesColumn>/g) ?? [];
  const blocks = [...rowCols, ...xCols, ...yCols];
  if (blocks.length === 0) return null;

  const flat: { header: string; cells: CellValue[] }[] = [];
  blocks.forEach((block, i) => parseColumn(block, `Column ${i + 1}`, commaDecimal).columns.forEach((c) => flat.push(c)));
  if (flat.length === 0) return null;

  const nRows = flat.reduce((m, c) => Math.max(m, c.cells.length), 0);
  const grid: CellValue[][] = [];
  grid.push(flat.map((c) => c.header)); // header row
  for (let r = 0; r < nRows; r++) grid.push(flat.map((c) => (r < c.cells.length ? c.cells[r]! : null)));
  return { name: tableTitle, grid };
}

/**
 * Parse a `.pzfx` document into per-table grids. Pure over the XML string. Returns one grid per
 * data table (with duplicate table names disambiguated); an empty array means the file carried no
 * data tables (only graphs/analyses), which the caller turns into an actionable message.
 */
export function parsePzfx(xml: string): SheetGrid[] {
  const tables = xml.match(/<Table\b[\s\S]*?<\/Table>/g) ?? [];
  // Decide the decimal locale once for the whole file from every cell it contains.
  const everyCell: string[] = [];
  for (const t of tables) for (const sub of t.match(/<Subcolumn\b[\s\S]*?<\/Subcolumn>/g) ?? []) everyCell.push(...cellStrings(sub));
  const commaDecimal = commaIsDecimal(everyCell);

  const sheets: SheetGrid[] = [];
  const seen = new Map<string, number>();
  for (const t of tables) {
    const sheet = parseTable(t, commaDecimal);
    if (!sheet) continue;
    // Disambiguate duplicate table names (the format happily allows "Data 1" twice).
    const n = seen.get(sheet.name) ?? 0;
    seen.set(sheet.name, n + 1);
    if (n > 0) sheet.name = `${sheet.name} (${n + 1})`;
    sheets.push(sheet);
  }
  return sheets;
}

/** Read a `.pzfx` file from disk into per-table grids (the data-import entry point). */
export async function readPzfxFile(path: string): Promise<SheetGrid[]> {
  return parsePzfx(await readFile(path, "utf8"));
}
