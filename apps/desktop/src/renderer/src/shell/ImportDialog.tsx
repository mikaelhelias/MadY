import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { coerceGrid, DELIMITERS, detectDecimalComma, detectDelimiter, foldUnitRow, inferHeader, jsonToGrid, MadyDocument, parseA1Range, parseDelimited, parseWhitespace, rowWidths, stripCommentLines, transposeGrid } from "@mady/core";
import type { CellValue, CoercedTable, DataTable, Delimiter, LinkedSource } from "@mady/core";
import type { ImportCell } from "../../../preload";
import { DataGrid } from "./DataGrid";
import { resolveDateOrder, resolveMissingValues } from "./profile";
import { GuideHelp } from "./guideLink";

/** The decoded file handed to the modal (delimited text, or Excel sheets). */
export interface ImportSource {
  source: "text" | "excel";
  name: string;
  text?: string;
  sheets?: ReadonlyArray<{ name: string; grid: ImportCell[][] }>;
  /** Absolute path of the source file (present for a real file import) — enables "keep linked". */
  path?: string | undefined;
  /** An advisory banner shown above the options (e.g. a .pzfx import: data only, no graphs). */
  notice?: string | undefined;
}

/** What the modal returns on confirm — a ready-to-`importTable` payload. */
export interface ImportResult extends CoercedTable {
  name: string;
  /** The fully-shaped table from the interactive grid — `confirmImport` adopts it intact (types,
   *  column order, decimals, exclusions). The flat CoercedTable fields mirror it for consumers
   *  that don't take a whole table. */
  table?: DataTable | undefined;
  /** When set, keep the imported table live-linked to its file (auto-updating import). */
  link?: LinkedSource | undefined;
  /** When set, append these rows to an existing datasheet instead of creating a new one. */
  appendTo?: { tableId: string; match: "name" | "position" } | undefined;
}

/**
 * ImportDialog — preview + options before committing an import. Auto-detects delimiter (text) and header, shows a live preview, and
 * lets the user correct delimiter / sheet / header before importing. Parsing is
 * the DOM-free `@mady/core` (parseDelimited + coerceGrid).
 */
const DELIM_NAME: Record<string, string> = { ",": "comma", "\t": "tab", ";": "semicolon", "|": "pipe", whitespace: "whitespace" };
const delimName = (d: string): string => DELIM_NAME[d] ?? "comma";

export function ImportDialog({
  src,
  tables = [],
  onConfirm,
  onCancel,
}: {
  src: ImportSource;
  /** Existing datasheets offered as append targets ("merge into"). */
  tables?: ReadonlyArray<{ id: string; name: string }> | undefined;
  onConfirm: (results: ImportResult[]) => void;
  onCancel: () => void;
}) {
  const isText = src.source === "text";
  const sheets = useMemo(() => src.sheets ?? [], [src.sheets]);
  // Multi-sheet Excel: a checklist + per-sheet options → one datasheet per checked sheet.
  const multi = !isText && sheets.length > 1;
  // Per-sheet size, and which sheets to import (data-looking ones checked by default).
  const sheetInfo = useMemo(
    () => sheets.map((s, i) => ({ i, name: s.name, rows: s.grid.length, cols: s.grid.reduce((m, r) => Math.max(m, r.length), 0) })),
    [sheets],
  );
  const [checked, setChecked] = useState<Set<number>>(() => new Set(sheetInfo.filter((s) => s.rows > 0 && s.cols > 0).map((s) => s.i)));
  // Remembered per-sheet controls + the shaped table you last saw for a sheet (so switching
  // sheets and switching back preserves its options and grid edits).
  const optsBySheet = useRef<Record<number, { skipRows: number; transpose: boolean; rangeText: string }>>({});
  const editedBySheet = useRef<Record<number, DataTable>>({});
  const seedRef = useRef<DataTable | null>(null);
  // Auto-pick the JSON format when the file's first non-blank character opens a JSON document
  // (`[` array or `{` object) — the common case for a .json/.ndjson import.
  const looksJson = isText && /^\s*[[{]/.test(src.text ?? "");
  const [delimiter, setDelimiter] = useState<Delimiter | "auto" | "whitespace" | "json">(looksJson ? "json" : "auto");
  const isJson = isText && delimiter === "json";
  const [sheetIndex, setSheetIndex] = useState(0);
  const [transpose, setTranspose] = useState(false);
  const [skipRows, setSkipRows] = useState(0);
  // Comment marker whose lines are dropped (scientific exporters prefix notes with '#'). Off by
  // default so a legitimate value starting with the marker is never silently lost.
  const [commentSel, setCommentSel] = useState<"none" | "#" | "//" | "%">("none");
  const comment = isText && !isJson && commentSel !== "none" ? commentSel : undefined;
  // Fold a units row (row 2) into the header — "Time"/"s" → "Time (s)". Delimited/text only.
  const [unitRow, setUnitRow] = useState(false);
  const [linkFile, setLinkFile] = useState(false);
  const [decimalSel, setDecimalSel] = useState<"auto" | "." | ",">("auto");
  const [thousandsSel, setThousandsSel] = useState<"none" | "," | " " | ".">("none");
  const thousands = isText && thousandsSel !== "none" ? thousandsSel : undefined;
  // Tokens to read as missing — seeded from the Settings default (Settings ▸ Missing values),
  // editable per-import. Text imports only (Excel cells are already typed, so a literal "NA"
  // there is a deliberate label).
  const [naText, setNaText] = useState(resolveMissingValues);
  const naTokens = useMemo(() => (isText ? naText.split(",").map((t) => t.trim()).filter((t) => t !== "") : []), [naText, isText]);
  // Excel-only: import just a cell range of the sheet (e.g. "A1:D50"). Blank = whole sheet.
  const [rangeText, setRangeText] = useState("");
  // Destination: a new datasheet (default) or an append onto an existing one; matched by column
  // name or by position. Offered only for a single-source import (not multi-sheet Excel).
  const [target, setTarget] = useState<"new" | string>("new");
  const [matchMode, setMatchMode] = useState<"name" | "position">("name");

  // Raw grid for the current options: string cells (text) or already-typed
  // (Excel), optionally with preamble rows dropped, optionally transposed
  // (variables-in-rows → variables-in-columns).
  const grid: CellValue[][] = useMemo(() => {
    let parsed: CellValue[][];
    if (isText) {
      // Drop comment lines first (they may carry delimiters), then parse by the chosen format.
      const cleaned = stripCommentLines(src.text ?? "", comment);
      parsed = isJson
        ? jsonToGrid(cleaned)
        : delimiter === "whitespace"
          ? (parseWhitespace(cleaned) as CellValue[][])
          : parseDelimited(cleaned, delimiter === "auto" ? undefined : (delimiter as Delimiter));
    } else {
      parsed = (src.sheets?.[sheetIndex]?.grid ?? []) as CellValue[][];
    }
    // Excel: restrict to a cell range (e.g. A1:D50) when one is given and parseable.
    if (!isText && rangeText.trim()) {
      const rng = parseA1Range(rangeText, parsed.length, parsed.reduce((m, r) => Math.max(m, r.length), 0));
      if (rng) parsed = parsed.slice(rng.r0, rng.r1 + 1).map((r) => r.slice(rng.c0, rng.c1 + 1));
    }
    // Drop metadata/notes rows above the table before transpose, so the remaining first
    // row is the header/data the rest of the pipeline sees.
    const trimmed = skipRows > 0 ? parsed.slice(skipRows) : parsed;
    const oriented = transpose ? transposeGrid<CellValue>(trimmed, isText ? "" : null) : trimmed;
    // Fold a units row into the header (only when asked — it consumes the second row).
    return unitRow ? foldUnitRow(oriented, 1) : oriented;
  }, [isText, isJson, src, delimiter, comment, sheetIndex, transpose, skipRows, rangeText, unitRow]);

  // Effective decimal mark: explicit choice, or auto-detect a European (comma) grid. Only
  // "," changes anything; point is the default. Text imports only (Excel cells are typed).
  const decimal = useMemo<"," | undefined>(() => {
    if (!isText || isJson) return undefined; // JSON cells are already typed
    if (decimalSel === ",") return ",";
    if (decimalSel === ".") return undefined;
    return detectDecimalComma(grid) ? "," : undefined;
  }, [decimalSel, isText, isJson, grid]);

  // Suggested header, recomputed when the grid or decimal changes; the user can override it.
  const suggestedHeader = useMemo(
    () => inferHeader(grid.map((r) => r.map((c) => (c == null ? "" : String(c)))), decimal ? { decimal } : undefined),
    [grid, decimal],
  );
  const [header, setHeader] = useState(suggestedHeader);
  useEffect(() => setHeader(suggestedHeader), [suggestedHeader]);
  // A units row implies the first row IS a header — force it on so the fold is well-defined.
  const effHeader = unitRow ? true : header;

  // Detect date/duration columns for BOTH text (CSV/TSV) and Excel imports, so a CSV date
  // column (ISO, US M/D/YYYY, Euro D/M/YYYY) and an h:mm:ss column come in as usable typed
  // columns instead of raw strings. Detection is default-deny (every cell must match).
  const coerced = useMemo(() => coerceGrid(grid, { header: effHeader, infer: isText && !isJson, decimal, detectDates: true, naTokens, thousands }), [grid, effHeader, isText, isJson, decimal, naTokens, thousands]);
  const rowCount = coerced.rows.length;

  // Ragged-file warning: with a real column delimiter, any line narrower than the widest is
  // padded without a word — usually a wrong delimiter or a misaligned line. (Whitespace mode has no
  // fixed column count, so this check doesn't apply there.)
  const ragged = useMemo(() => {
    if (!isText || isJson || delimiter === "whitespace") return null;
    // Compare on the comment-stripped text, so a dropped '# note' line isn't counted as short.
    const cleaned = stripCommentLines(src.text ?? "", comment);
    const cur = delimiter === "auto" ? undefined : (delimiter as Delimiter);
    const widths = rowWidths(cleaned, cur).slice(skipRows);
    if (widths.length < 2) return null;
    const max = Math.max(...widths);
    const short = widths.map((w, i) => ({ row: i + 1, w })).filter((r) => r.w < max);
    if (!short.length) return null;
    // Suggest a delimiter that would make the file rectangular (all rows the same width > 1).
    const effCur = cur ?? detectDelimiter(cleaned);
    let suggest: { value: Delimiter; name: string } | null = null;
    for (const cand of DELIMITERS) {
      if (cand === effCur) continue;
      const w = rowWidths(cleaned, cand).slice(skipRows);
      if (w.length >= 2 && Math.min(...w) === Math.max(...w) && w[0]! > 1) {
        suggest = { value: cand, name: delimName(cand) };
        break;
      }
    }
    return { max, short, suggest };
  }, [isText, isJson, delimiter, comment, src, skipRows]);

  // What the importer is actually reading the file as — auto-detection made visible so the user
  // can trust it or override. Reflects the effective (post-override) settings, live.
  const readingAs = useMemo(() => {
    if (!isText) return null;
    if (isJson) return { json: true, header: effHeader } as const;
    const eff = delimiter === "auto" ? detectDelimiter(src.text ?? "") : (delimiter as Delimiter);
    return {
      json: false as const,
      delim: delimName(eff),
      decimal: decimal === "," ? "comma" : "point",
      header: effHeader,
    };
  }, [isText, isJson, delimiter, src, decimal, effHeader]);

  // The interactive preview is the real datasheet grid, over a throwaway document holding the
  // coerced table — so retype / reorder / rename / Use-as-X / edit / delete all use the exact
  // datasheet tools (no parallel column-editor). Rebuilt whenever a parse option changes the
  // coerced result (a re-parse starts fresh, discarding manual grid edits). `force` re-renders
  // after each in-place edit; Confirm adopts the shaped table intact.
  const previewDoc = useMemo(() => {
    const doc = new MadyDocument();
    // Seed from a snapshot when switching back to an already-edited sheet (multi-sheet); a
    // one-shot ref, so a later option change re-parses fresh like the single-sheet path.
    const seed = seedRef.current;
    seedRef.current = null;
    const t = seed
      ? doc.adoptImportedTable(seed, seed.name)
      : doc.importTable(src.name, "xy", coerced.columnNames, coerced.rows, coerced.columnTypes);
    return { doc, tableId: t.id };
  }, [coerced, src.name]);
  const [, force] = useReducer((n: number) => n + 1, 0);
  const previewTable = previewDoc.doc.toJSON().tables.find((t) => t.id === previewDoc.tableId)!;
  const colCount = previewTable.columns.length;
  const gridOp = (fn: (d: MadyDocument) => void): void => {
    fn(previewDoc.doc);
    force();
  };
  const id = previewDoc.tableId;

  // Switch which sheet is previewed/edited (multi-sheet). Snapshot the outgoing sheet's controls
  // + shaped table, restore the incoming sheet's, and seed its preview copy from any prior edits.
  const switchSheet = (next: number): void => {
    if (next === sheetIndex) return;
    optsBySheet.current[sheetIndex] = { skipRows, transpose, rangeText };
    editedBySheet.current[sheetIndex] = previewTable;
    const o = optsBySheet.current[next];
    setSkipRows(o?.skipRows ?? 0);
    setTranspose(o?.transpose ?? false);
    setRangeText(o?.rangeText ?? "");
    seedRef.current = editedBySheet.current[next] ?? null;
    setSheetIndex(next);
  };

  /** The active sheet's fully-shaped result (honours interactive grid edits). */
  const activeResult = (): ImportResult => ({
    name: multi ? (sheets[sheetIndex]?.name ?? src.name) : src.name,
    table: previewTable,
    columnNames: previewTable.columns.map((c) => c.name),
    rows: previewTable.rows.map((row) => previewTable.columns.map((c) => row.cells[c.id] ?? null)),
    ...(previewTable.columns.some((c) => c.type) ? { columnTypes: previewTable.columns.map((c) => c.type) } : {}),
    ...(linkFile && src.path && !isJson && target === "new"
      ? { link: { path: src.path, delimiter: delimiter === "auto" ? undefined : (delimiter as string), transpose, header: effHeader, ...(skipRows > 0 ? { skipRows } : {}), ...(naTokens.length ? { naTokens } : {}), ...(thousands ? { thousands } : {}), ...(decimal ? { decimal } : {}), ...(comment ? { comment } : {}), ...(unitRow ? { unitRows: 1 } : {}) } }
      : {}),
    ...(target !== "new" ? { appendTo: { tableId: target, match: matchMode } } : {}),
  });

  const shapedResult = (name: string, t: DataTable): ImportResult => ({
    name,
    table: t,
    columnNames: t.columns.map((c) => c.name),
    rows: t.rows.map((row) => t.columns.map((c) => row.cells[c.id] ?? null)),
    ...(t.columns.some((c) => c.type) ? { columnTypes: t.columns.map((c) => c.type) } : {}),
  });

  /** A never-opened checked sheet: coerce its grid with its stored (or default) options. */
  const coerceSheetFlat = (i: number): ImportResult => {
    const o = optsBySheet.current[i];
    let g = (sheets[i]?.grid ?? []) as CellValue[][];
    if (o?.rangeText?.trim()) {
      const rng = parseA1Range(o.rangeText, g.length, g.reduce((m, r) => Math.max(m, r.length), 0));
      if (rng) g = g.slice(rng.r0, rng.r1 + 1).map((r) => r.slice(rng.c0, rng.c1 + 1));
    }
    if (o && o.skipRows > 0) g = g.slice(o.skipRows);
    if (o?.transpose) g = transposeGrid<CellValue>(g, null);
    const hdr = inferHeader(g.map((r) => r.map((c) => (c == null ? "" : String(c)))));
    const c = coerceGrid(g, { header: hdr, infer: false, detectDates: true });
    return { name: sheets[i]?.name ?? src.name, columnNames: c.columnNames, rows: c.rows, ...(c.columnTypes ? { columnTypes: c.columnTypes } : {}) };
  };

  const doImport = (): void => {
    if (!multi) {
      onConfirm([activeResult()]);
      return;
    }
    const results: ImportResult[] = [];
    for (const i of [...checked].sort((a, b) => a - b)) {
      if (i === sheetIndex) results.push(activeResult());
      else if (editedBySheet.current[i]) results.push(shapedResult(sheets[i]?.name ?? src.name, editedBySheet.current[i]!));
      else results.push(coerceSheetFlat(i));
    }
    onConfirm(results);
  };

  return (
    <div className="modalov" onClick={onCancel}>
      <div
        className="modal modal-import"
        role="dialog"
        aria-label="Import data"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modalh-row">
          <h3 className="modalh">Import “{src.name}”</h3>
          <GuideHelp target={{ entry: "action:import" }} what="Import data" />
        </div>

        {src.notice && (
          <div className="importnotice" role="note">
            {src.notice}
          </div>
        )}

        <div className="importopts">
          {isText ? (
            <label>
              Format{" "}
              <select
                aria-label="Delimiter"
                value={delimiter}
                onChange={(e) => setDelimiter(e.target.value as Delimiter | "auto" | "whitespace" | "json")}
              >
                <option value="auto">Auto-detect</option>
                <option value=",">Comma</option>
                <option value={"\t"}>Tab</option>
                <option value=";">Semicolon</option>
                <option value="|">Pipe</option>
                <option value="whitespace">Whitespace (spaces/tabs)</option>
                <option value="json">JSON / NDJSON</option>
              </select>
            </label>
          ) : null}
          {isText && !isJson ? (
            <label title="Decimal mark for numeric cells. Auto detects European '3,14' when the delimiter isn't a comma.">
              Decimal{" "}
              <select
                aria-label="Decimal separator"
                value={decimalSel}
                onChange={(e) => setDecimalSel(e.target.value as "auto" | "." | ",")}
              >
                <option value="auto">Auto{decimal === "," ? " (comma)" : " (point)"}</option>
                <option value=".">Point (1.5)</option>
                <option value=",">Comma (1,5)</option>
              </select>
            </label>
          ) : null}
          {isText && !isJson ? (
            <label title="Grouping separator to strip from numbers, e.g. 1,000,000 or 1 000. Must differ from the delimiter. None = leave numbers as-is.">
              Thousands{" "}
              <select
                aria-label="Thousands separator"
                value={thousandsSel}
                onChange={(e) => setThousandsSel(e.target.value as "none" | "," | " " | ".")}
              >
                <option value="none">None</option>
                <option value=",">Comma (1,000)</option>
                <option value=" ">Space (1 000)</option>
                <option value=".">Dot (1.000)</option>
              </select>
            </label>
          ) : null}
          {isText && !isJson ? (
            <label title="Ignore lines that start with this marker — the '#'-prefixed notes many instruments and exporters put above or between data rows. None = keep every line.">
              Comment{" "}
              <select
                aria-label="Comment marker"
                value={commentSel}
                onChange={(e) => setCommentSel(e.target.value as "none" | "#" | "//" | "%")}
              >
                <option value="none">None</option>
                <option value="#"># hash</option>
                <option value="//">// slashes</option>
                <option value="%">% percent</option>
              </select>
            </label>
          ) : null}
          {!isText && (
            <label title="Import only this cell range of the sheet, e.g. A1:D50 (open-ended B2:D reaches the last column). Blank = the whole sheet.">
              Range{" "}
              <input
                type="text"
                aria-label="Cell range"
                value={rangeText}
                placeholder="A1:D50"
                style={{ width: 90 }}
                onChange={(e) => setRangeText(e.target.value)}
              />
            </label>
          )}
          <label title="Ignore this many rows at the top of the file — for files with metadata, notes, or blank lines above the table. The header/data starts on the next row.">
            Skip rows{" "}
            <input
              type="number"
              min={0}
              aria-label="Skip rows"
              value={skipRows}
              style={{ width: 56 }}
              onChange={(e) => setSkipRows(Math.max(0, Math.floor(Number(e.target.value) || 0)))}
            />
          </label>
          {isText && !isJson && (
            <label title="Optional tokens to treat as missing (blank) — e.g. NA, N/A, null. Empty (the default) keeps every value as imported; a truly empty cell is always blank regardless.">
              Missing values{" "}
              <input
                type="text"
                aria-label="Missing-value tokens"
                value={naText}
                placeholder="NA, N/A, null"
                style={{ width: 130 }}
                onChange={(e) => setNaText(e.target.value)}
              />
            </label>
          )}
          <label className="importchk" title={unitRow ? "A units row implies the first row is a header." : undefined}>
            <input type="checkbox" checked={effHeader} disabled={unitRow} onChange={(e) => setHeader(e.target.checked)} />
            First row is a header
          </label>
          {isText && !isJson && (
            <label className="importchk" title="The row below the header holds units — fold it into each column name as 'Name (unit)' and drop it from the data.">
              <input type="checkbox" checked={unitRow} onChange={(e) => setUnitRow(e.target.checked)} />
              Second row is units
            </label>
          )}
          <label className="importchk">
            <input
              type="checkbox"
              checked={transpose}
              onChange={(e) => setTranspose(e.target.checked)}
            />
            Transpose (swap rows / columns)
          </label>
          {isText && src.path && !isJson && target === "new" && (
            <label className="importchk" title="Keep this table connected to the file — it re-reads automatically when the file changes on disk (auto-updating import)">
              <input type="checkbox" checked={linkFile} onChange={(e) => setLinkFile(e.target.checked)} />
              Keep linked to file (auto-update)
            </label>
          )}
          {!multi && tables.length > 0 && (
            <label title="Where the imported rows go: a brand-new datasheet, or appended to the bottom of an existing one.">
              Destination{" "}
              <select aria-label="Destination" value={target} onChange={(e) => setTarget(e.target.value)}>
                <option value="new">New datasheet</option>
                {tables.map((t) => (
                  <option key={t.id} value={t.id}>Append to “{t.name}”</option>
                ))}
              </select>
            </label>
          )}
          {!multi && target !== "new" && (
            <label title="How imported columns line up with the target sheet: by matching column name (any order), or by position (1st→1st).">
              Match by{" "}
              <select aria-label="Append match mode" value={matchMode} onChange={(e) => setMatchMode(e.target.value as "name" | "position")}>
                <option value="name">Column name</option>
                <option value="position">Position</option>
              </select>
            </label>
          )}
        </div>

        {readingAs && (
          <p className="note" aria-label="Detected import settings">
            {readingAs.json
              ? <>Reading as: JSON records · header {readingAs.header ? "row 1" : "off"}</>
              : <>Reading as: {readingAs.delim === "whitespace" ? "whitespace-separated" : `${readingAs.delim}-separated`} ·{" "}
                {readingAs.decimal} decimal · header {readingAs.header ? "row 1" : "off"}</>}
          </p>
        )}

        <div className={multi ? "importsplit" : undefined}>
        {multi && (
          <div className="sheetrail">
            <div className="sheetrail-h">Sheets to import</div>
            {sheetInfo.map((s) => (
              <div
                key={s.i}
                className={"srow" + (s.i === sheetIndex ? " on" : "") + (s.cols === 0 ? " muted" : "")}
                onClick={() => switchSheet(s.i)}
              >
                <input
                  type="checkbox"
                  aria-label={`Import sheet ${s.name}`}
                  disabled={s.cols === 0}
                  checked={checked.has(s.i)}
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) =>
                    setChecked((prev) => {
                      const n = new Set(prev);
                      if (e.target.checked) n.add(s.i);
                      else n.delete(s.i);
                      return n;
                    })
                  }
                />
                <span className="sn" title={s.name}>{s.name}</span>
                <span className="sz">{s.cols === 0 ? "empty" : `${s.rows} × ${s.cols}`}</span>
              </div>
            ))}
          </div>
        )}
        {colCount === 0 ? (
          <p className="note">No data found in this {multi ? "sheet" : "file"}.</p>
        ) : (
          <div className="importgrid">
            <DataGrid
              table={previewTable}
              onEditCell={(r, c, v) => gridOp((d) => d.editCellAt(id, r, c, v))}
              onRenameColumn={(colId, name) => gridOp((d) => d.renameColumn(id, colId, name))}
              onPaste={(r, c, block) => gridOp((d) => d.pasteBlock(id, r, c, block))}
              onClearCells={(r, c, rows, cols) => gridOp((d) => d.clearCells(id, r, c, rows, cols))}
              onFillDown={(r, c, rows, cols) => gridOp((d) => d.fillDown(id, r, c, rows, cols))}
              onTranspose={(r, c, rows, cols) => gridOp((d) => d.transposeRange(id, r, c, rows, cols))}
              onInsertRow={(i) => gridOp((d) => d.insertRow(id, i))}
              onDeleteRow={(i) => gridOp((d) => d.deleteRow(id, i))}
              onInsertColumn={(i) => gridOp((d) => d.insertColumn(id, i))}
              onDeleteColumn={(i) => gridOp((d) => d.deleteColumn(id, i))}
              onDeleteColumns={(idx) => gridOp((d) => d.deleteColumns(id, idx))}
              onMoveRow={(from, to) => gridOp((d) => d.moveRow(id, from, to))}
              onMoveColumn={(from, to) => gridOp((d) => d.moveColumn(id, from, to))}
              onSetXColumn={(index) => gridOp((d) => d.setXColumn(id, index))}
              onSetColumnType={(colId, type) => gridOp((d) => d.setColumnType(id, colId, type, resolveDateOrder()))}
              onSetColumnDecimals={(colId, dec) => gridOp((d) => d.setColumnDecimals(id, colId, dec))}
              onSetColumnFormula={(colId, f) => gridOp((d) => d.setColumnFormula(id, colId, f))}
              onToggleExcluded={(cells, exc) => gridOp((d) => d.setCellsExcluded(id, cells, exc))}
            />
          </div>
        )}
        </div>

        {ragged && (
          <p className="note importwarn" role="status">
            ⚠️ {ragged.short.length} row{ragged.short.length === 1 ? "" : "s"} have fewer columns than the widest
            ({ragged.max}) and were padded with blanks — e.g. row {ragged.short[0]!.row} has {ragged.short[0]!.w}.{" "}
            {ragged.suggest ? (
              <>
                The file looks even with{" "}
                <button type="button" className="linkbtn" onClick={() => setDelimiter(ragged.suggest!.value)}>
                  {ragged.suggest.name}
                </button>{" "}
                — try that delimiter.
              </>
            ) : (
              "Check the delimiter, or that the row isn’t misaligned."
            )}
          </p>
        )}
        <p className="note">
          {multi ? "Options and grid edits apply to the open sheet — each sheet is remembered separately. " : ""}
          {rowCount} row{rowCount === 1 ? "" : "s"} × {colCount} column{colCount === 1 ? "" : "s"} — reorder, rename,
          set a column's type or the X axis, edit cells, or delete columns right in the grid before importing
          (double-click a header to rename, right-click for type / delete / “Use as X axis”).
        </p>

        <div className="modalbtns">
          <button className="btn-ghost" onClick={onCancel}>
            Cancel
          </button>
          <button
            className="btn"
            data-tour="import-confirm"
            disabled={colCount === 0 || (multi && checked.size === 0)}
            onClick={doImport}
          >
            {multi
              ? `Import ${checked.size} sheet${checked.size === 1 ? "" : "s"}`
              : target !== "new"
                ? `Append ${rowCount} row${rowCount === 1 ? "" : "s"}`
                : `Import ${rowCount} row${rowCount === 1 ? "" : "s"}`}
          </button>
        </div>
      </div>
    </div>
  );
}
