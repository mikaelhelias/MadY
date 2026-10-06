import { describe, expect, it } from "vitest";
import { daysToISO } from "./cells";
import {
  coerceGrid,
  detectDecimalComma,
  detectDelimiter,
  inferHeader,
  parseCellValue,
  parseDelimited,
  parseLinkedText,
  parseWhitespace,
  rowWidths,
  parseA1Range,
  transposeGrid,
  stripCommentLines,
  foldUnitRow,
  jsonToGrid,
} from "./import";

describe("parseLinkedText — re-parse a linked file's text with stored options", () => {
  it("parses delimited text with an inferred header (the common case)", () => {
    const out = parseLinkedText("Dose,Response\n1,10\n2,20\n", { delimiter: "," });
    expect(out.columnNames).toEqual(["Dose", "Response"]);
    expect(out.rows).toEqual([[1, 10], [2, 20]]);
  });

  it("auto-detects the delimiter when none/invalid is stored (tab here)", () => {
    const out = parseLinkedText("A\tB\n1\t2\n", { delimiter: "nonsense" });
    expect(out.columnNames).toEqual(["A", "B"]);
    expect(out.rows).toEqual([[1, 2]]);
  });

  it("recovers when a stored delimiter no longer matches the file", () => {
    // The link stored ",", but the file was re-exported as TSV → comma yields one column.
    const out = parseLinkedText("A\tB\n1\t2", { delimiter: "," });
    expect(out.columnNames).toEqual(["A", "B"]); // auto-detect recovered both columns
    expect(out.rows).toEqual([[1, 2]]);
  });

  it("replays a stored decimal comma on re-read", () => {
    const out = parseLinkedText("dose;response\n1,5;10,2", { delimiter: ";", decimal: "," });
    expect(out.rows).toEqual([[1.5, 10.2]]);
  });

  it("replays transpose (variables-in-rows → columns)", () => {
    const out = parseLinkedText("X,1,2,3\nY,4,5,6", { delimiter: ",", transpose: true, header: true });
    expect(out.columnNames).toEqual(["X", "Y"]);
    expect(out.rows).toEqual([[1, 4], [2, 5], [3, 6]]);
  });

  it("honours a pinned header=false (row 0 is data, names default)", () => {
    const out = parseLinkedText("1,2\n3,4", { delimiter: ",", header: false });
    expect(out.columnNames).toEqual(["Column 1", "Column 2"]);
    expect(out.rows).toEqual([[1, 2], [3, 4]]);
  });

  it("skips preamble rows before the header/data (metadata lines above the table)", () => {
    const text = "# exported 2026-01-01\nrun: 7\nDose,Response\n1,10\n2,20\n";
    const out = parseLinkedText(text, { delimiter: ",", skipRows: 2 });
    // the two metadata lines are dropped → "Dose,Response" is inferred as the header
    expect(out.columnNames).toEqual(["Dose", "Response"]);
    expect(out.rows).toEqual([[1, 10], [2, 20]]);
  });

  it("applies skipRows before transpose (drops file lines, then swaps)", () => {
    const text = "note,line\nX,1,2\nY,3,4";
    const out = parseLinkedText(text, { delimiter: ",", skipRows: 1, transpose: true, header: true });
    expect(out.columnNames).toEqual(["X", "Y"]);
    expect(out.rows).toEqual([[1, 3], [2, 4]]);
  });

  it("replays a stored 'whitespace' delimiter on re-read", () => {
    const out = parseLinkedText("Dose  Response\n1   10\n2\t20", { delimiter: "whitespace" });
    expect(out.columnNames).toEqual(["Dose", "Response"]);
    expect(out.rows).toEqual([[1, 10], [2, 20]]);
  });

  it("replays stored missing-value tokens on re-read", () => {
    const out = parseLinkedText("A,B\n1,NA\nN/A,4", { delimiter: ",", naTokens: ["NA", "N/A"] });
    expect(out.rows).toEqual([[1, null], [null, 4]]);
  });

  it("replays a stored thousands separator on re-read", () => {
    const out = parseLinkedText("v|w\n1,000,000|a\n2,500|b", { delimiter: "|", thousands: "," });
    expect(out.rows).toEqual([[1000000, "a"], [2500, "b"]]);
  });
});

describe("parseWhitespace", () => {
  it("splits on runs of spaces/tabs and trims each line", () => {
    expect(parseWhitespace("a   b\tc\n 1  2   3 ")).toEqual([
      ["a", "b", "c"],
      ["1", "2", "3"],
    ]);
  });

  it("drops blank lines and pads ragged rows to the widest", () => {
    expect(parseWhitespace("x y z\n\n1 2\n")).toEqual([
      ["x", "y", "z"],
      ["1", "2", ""],
    ]);
  });
});

describe("parseCellValue", () => {
  it("infers number / string / null", () => {
    expect(parseCellValue("42")).toBe(42);
    expect(parseCellValue("-3.5e2")).toBe(-350);
    expect(parseCellValue("  7 ")).toBe(7);
    expect(parseCellValue("abc")).toBe("abc");
    expect(parseCellValue("")).toBeNull();
    expect(parseCellValue("   ")).toBeNull();
    expect(parseCellValue(".5")).toBe(0.5);
    expect(parseCellValue("5.")).toBe(5);
  });

  it("rejects JS's hex/binary/octal grammar — those stay text IDs", () => {
    expect(parseCellValue("0x1A")).toBe("0x1A");
    expect(parseCellValue("0b101")).toBe("0b101");
    expect(parseCellValue("0o17")).toBe("0o17");
    expect(parseCellValue("Infinity")).toBe("Infinity");
    expect(parseCellValue("1e400")).toBe("1e400"); // overflow → not a finite number
  });

  it("preserves zero-padded identifiers as text, not numbers", () => {
    expect(parseCellValue("007")).toBe("007");
    expect(parseCellValue("012")).toBe("012");
    expect(parseCellValue("-08")).toBe("-08");
    // but a genuine number with a leading zero decimal is still numeric
    expect(parseCellValue("0")).toBe(0);
    expect(parseCellValue("0.5")).toBe(0.5);
    expect(parseCellValue("0e3")).toBe(0);
  });

  it("honours an opt-in decimal comma", () => {
    expect(parseCellValue("3,14", { decimal: "," })).toBe(3.14);
    expect(parseCellValue("0,5", { decimal: "," })).toBe(0.5);
    expect(parseCellValue("-2,0", { decimal: "," })).toBe(-2);
    // default (point) leaves a comma value as text
    expect(parseCellValue("3,14")).toBe("3,14");
  });
});

describe("detectDecimalComma", () => {
  it("detects a European grid (digit-comma-digit cells dominate)", () => {
    expect(detectDecimalComma([["3,14", "2,72"], ["1,0", "9,9"]])).toBe(true);
  });
  it("is false for a point-decimal grid", () => {
    expect(detectDecimalComma([["3.14", "2.72"], ["1.0", "9.9"]])).toBe(false);
  });
  it("is false when there are no decimal cells at all", () => {
    expect(detectDecimalComma([["a", "b"], ["1", "2"]])).toBe(false);
  });
});

describe("transposeGrid", () => {
  it("swaps rows and columns (rectangular grid)", () => {
    expect(transposeGrid([["a", "b", "c"], ["1", "2", "3"]], "")).toEqual([
      ["a", "1"],
      ["b", "2"],
      ["c", "3"],
    ]);
  });

  it("pads ragged rows with fill so the result is rectangular", () => {
    // widest row has 3 cells → 3 output rows; the short row's gap → fill
    expect(transposeGrid([["a", "b", "c"], ["1"]], "")).toEqual([
      ["a", "1"],
      ["b", ""],
      ["c", ""],
    ]);
  });

  it("is its own inverse for a rectangular grid", () => {
    const g = [[1, 2], [3, 4], [5, 6]];
    expect(transposeGrid(transposeGrid(g, 0), 0)).toEqual(g);
  });

  it("preserves null cells (typed grids) rather than treating them as gaps", () => {
    expect(transposeGrid([[1, null], [2, 3]], null)).toEqual([
      [1, 2],
      [null, 3],
    ]);
  });

  it("returns an empty grid for empty input", () => {
    expect(transposeGrid([], "")).toEqual([]);
  });
});

describe("detectDelimiter", () => {
  it("detects comma / tab / semicolon / pipe", () => {
    expect(detectDelimiter("a,b,c\n1,2,3")).toBe(",");
    expect(detectDelimiter("a\tb\tc\n1\t2\t3")).toBe("\t");
    expect(detectDelimiter("a;b;c\n1;2;3")).toBe(";");
    expect(detectDelimiter("a|b|c\n1|2|3")).toBe("|");
  });

  it("prefers the consistent delimiter and defaults to comma when ambiguous", () => {
    // tab is consistent (2 per line); stray commas are inconsistent → tab wins.
    expect(detectDelimiter("a\tb\tc\nx,y\t2\t3")).toBe("\t");
    expect(detectDelimiter("")).toBe(",");
    expect(detectDelimiter("singlecolumn\nvalue")).toBe(",");
  });

  it("samples the whole file, not just a head window", () => {
    // First 25 lines look like a single comma-free column; the pipe structure only
    // starts at line 26, so a detector that read only the first 20 lines would pick comma.
    const head = Array.from({ length: 25 }, (_, i) => `row${i}`).join("\n");
    const tail = Array.from({ length: 200 }, (_, i) => `a${i}|b${i}|c${i}`).join("\n");
    expect(detectDelimiter(`${head}\n${tail}`)).toBe("|");
  });
});

describe("parseA1Range", () => {
  it("parses a closed range to inclusive 0-based bounds", () => {
    expect(parseA1Range("A1:B2", 5, 5)).toEqual({ r0: 0, c0: 0, r1: 1, c1: 1 });
    expect(parseA1Range("B2:D4", 10, 10)).toEqual({ r0: 1, c0: 1, r1: 3, c1: 3 });
  });
  it("extends an open end to the grid edge and is case-insensitive", () => {
    expect(parseA1Range("b2:d", 4, 5)).toEqual({ r0: 1, c0: 1, r1: 3, c1: 3 }); // to last row (3)
    expect(parseA1Range("A1:", 3, 2)).toEqual({ r0: 0, c0: 0, r1: 2, c1: 1 }); // whole grid
  });
  it("handles a single cell and clamps past-the-edge ends", () => {
    expect(parseA1Range("C3", 5, 5)).toEqual({ r0: 2, c0: 2, r1: 2, c1: 2 });
    expect(parseA1Range("A1:Z999", 3, 3)).toEqual({ r0: 0, c0: 0, r1: 2, c1: 2 }); // clamped
  });
  it("returns null for invalid input or a start beyond the grid", () => {
    expect(parseA1Range("nonsense", 5, 5)).toBeNull();
    expect(parseA1Range("", 5, 5)).toBeNull();
    expect(parseA1Range("Z9", 3, 3)).toBeNull(); // starts past the data
  });
});

describe("rowWidths", () => {
  it("reports each row's unpadded field count (parseDelimited pads to the widest)", () => {
    const text = "a,b,c\n1,2\n4,5,6";
    expect(rowWidths(text, ",")).toEqual([3, 2, 3]); // row 2 is short
    // …and parseDelimited pads it, so the raw widths are the only way to see the ragged row
    expect(parseDelimited(text, ",")[1]).toEqual(["1", "2", ""]);
  });

  it("counts quoted fields containing the delimiter as one", () => {
    expect(rowWidths('x,"a,b",z', ",")).toEqual([3]);
  });
});

describe("stripCommentLines", () => {
  it("drops whole lines that start with the marker (after leading whitespace)", () => {
    const text = "# exported by rig\nx,y\n1,2\n  # a note\n3,4";
    expect(stripCommentLines(text, "#")).toBe("x,y\n1,2\n3,4");
  });

  it("keeps a marker that appears mid-line (it's data, not a comment)", () => {
    expect(stripCommentLines("a,b\n1,x#3\n2,y", "#")).toBe("a,b\n1,x#3\n2,y");
  });

  it("supports a multi-character marker", () => {
    expect(stripCommentLines("// header\nA,B\n1,2", "//")).toBe("A,B\n1,2");
  });

  it("is a no-op with no marker", () => {
    expect(stripCommentLines("#a\nb", "")).toBe("#a\nb");
    expect(stripCommentLines("#a\nb", undefined)).toBe("#a\nb");
  });

  it("a comment line carrying delimiters is removed whole (not parsed into columns)", () => {
    // Without whole-line removal, "# a,b,c" would parse as 3 stray columns and widen the grid.
    const cleaned = stripCommentLines("# a,b,c,d\nx,y\n1,2", "#");
    expect(parseDelimited(cleaned, ",")).toEqual([["x", "y"], ["1", "2"]]);
  });
});

describe("foldUnitRow", () => {
  it("folds a units row into the header as 'Name (unit)' and removes it from the body", () => {
    const grid = [["Time", "Conc"], ["s", "µM"], [0, 1], [10, 2]];
    expect(foldUnitRow(grid, 1)).toEqual([["Time (s)", "Conc (µM)"], [0, 1], [10, 2]]);
  });

  it("leaves a column with a blank unit as the bare name", () => {
    expect(foldUnitRow([["A", "B"], ["kg", ""], [1, 2]], 1)).toEqual([["A (kg)", "B"], [1, 2]]);
  });

  it("is a no-op when unitRows < 1 or fewer than two rows", () => {
    expect(foldUnitRow([["A", "B"], [1, 2]], 0)).toEqual([["A", "B"], [1, 2]]);
    expect(foldUnitRow([["A", "B"]], 1)).toEqual([["A", "B"]]);
  });

  it("composes with coerceGrid(header:true) to name the columns and type the body", () => {
    const folded = foldUnitRow([["Dose", "Resp"], ["mg", "%"], ["1", "10"], ["2", "20"]], 1);
    const t = coerceGrid(folded, { header: true });
    expect(t.columnNames).toEqual(["Dose (mg)", "Resp (%)"]);
    expect(t.rows).toEqual([[1, 10], [2, 20]]);
  });
});

describe("jsonToGrid", () => {
  it("array of objects → union of keys header + one row each (missing key = blank)", () => {
    const grid = jsonToGrid('[{"x":1,"y":2},{"x":3,"z":9}]');
    expect(grid).toEqual([["x", "y", "z"], [1, 2, null], [3, null, 9]]);
  });

  it("keeps JSON types (numbers stay numbers; booleans → TRUE/FALSE) with coerceGrid(infer:false)", () => {
    const grid = jsonToGrid('[{"n":5,"ok":true},{"n":6,"ok":false}]');
    const t = coerceGrid(grid, { header: true, infer: false });
    expect(t.columnNames).toEqual(["n", "ok"]);
    expect(t.rows).toEqual([[5, "TRUE"], [6, "FALSE"]]);
  });

  it("NDJSON: one object per line", () => {
    expect(jsonToGrid('{"a":1,"b":2}\n{"a":3,"b":4}')).toEqual([["a", "b"], [1, 2], [3, 4]]);
  });

  it("array of arrays → rows used directly (no synthetic header)", () => {
    expect(jsonToGrid('[["x","y"],[1,2],[3,4]]')).toEqual([["x", "y"], [1, 2], [3, 4]]);
  });

  it("array of scalars → a single 'value' column", () => {
    expect(jsonToGrid("[10,20,30]")).toEqual([["value"], [10], [20], [30]]);
  });

  it("nested object/array cells are stringified, not '[object Object]'", () => {
    expect(jsonToGrid('[{"id":1,"meta":{"k":2}}]')).toEqual([["id", "meta"], [1, '{"k":2}']]);
  });

  it("returns [] for non-JSON text", () => {
    expect(jsonToGrid("dose,response\n1,2")).toEqual([]);
    expect(jsonToGrid("")).toEqual([]);
  });
});

describe("parseLinkedText — comment + unit-row replay", () => {
  it("replays a stored comment marker on re-read", () => {
    const out = parseLinkedText("# run 7\nx,y\n1,2\n3,4", { delimiter: ",", comment: "#" });
    expect(out.columnNames).toEqual(["x", "y"]);
    expect(out.rows).toEqual([[1, 2], [3, 4]]);
  });

  it("replays a stored units row (folds it into the header, forces header on)", () => {
    const out = parseLinkedText("Time,Conc\ns,µM\n0,1\n10,2", { delimiter: ",", unitRows: 1 });
    expect(out.columnNames).toEqual(["Time (s)", "Conc (µM)"]);
    expect(out.rows).toEqual([[0, 1], [10, 2]]);
  });
});

describe("parseDelimited", () => {
  it("parses a simple CSV with autodetect", () => {
    expect(parseDelimited("x,y\n1,2\n3,4")).toEqual([
      ["x", "y"],
      ["1", "2"],
      ["3", "4"],
    ]);
  });

  it("honours RFC-4180 quoting: embedded delimiter, newline, escaped quote", () => {
    const text = 'name,note\n"Doe, Jane","line1\nline2"\n"a ""quoted"" word",ok';
    expect(parseDelimited(text, ",")).toEqual([
      ["name", "note"],
      ["Doe, Jane", "line1\nline2"],
      ['a "quoted" word', "ok"],
    ]);
  });

  it("normalizes CRLF, strips a BOM, and drops a single trailing newline", () => {
    expect(parseDelimited("﻿x,y\r\n1,2\r\n")).toEqual([
      ["x", "y"],
      ["1", "2"],
    ]);
  });

  it("pads ragged rows to the widest row", () => {
    expect(parseDelimited("a,b,c\n1,2\n3", ",")).toEqual([
      ["a", "b", "c"],
      ["1", "2", ""],
      ["3", "", ""],
    ]);
  });

  it("returns an empty grid for empty input", () => {
    expect(parseDelimited("")).toEqual([]);
  });

  it("treats a mid-field quote as a literal, not a field opener", () => {
    // Guards against an inch mark flipping into quoted mode and swallowing the rest of the file.
    expect(parseDelimited('id,len\n1,5" long\n2,3', ",")).toEqual([
      ["id", "len"],
      ["1", '5" long'],
      ["2", "3"],
    ]);
    // A foot/inch value with an unbalanced quote must not eat subsequent rows.
    expect(parseDelimited('h\n6\'2"\n5\'11"', ",")).toEqual([
      ["h"],
      ["6'2\""],
      ["5'11\""],
    ]);
  });
});

describe("inferHeader", () => {
  it("detects a text header over a numeric body", () => {
    expect(
      inferHeader([
        ["dose", "response"],
        ["1", "10"],
        ["2", "20"],
      ]),
    ).toBe(true);
  });

  it("detects a header whose corner cell is blank", () => {
    // The commonest shape there is: a matrix copied out of a spreadsheet, where the
    // row-label column has no title. Requiring every header cell to be non-empty would let
    // that single blank corner turn the names into data and leave the columns called A, B, C
    // when a block is pasted in.
    expect(
      inferHeader([
        ["", "Ctrl", "Drug A", "Drug B"],
        ["GeneA", "1", "2", "3"],
        ["GeneB", "4", "5", "6"],
      ]),
      "a blank corner cell defeated header detection",
    ).toBe(true);
  });

  it("still refuses a header row that is entirely blank", () => {
    // Ignoring blanks must not become "any row of nothing is a header".
    expect(
      inferHeader([
        ["", "", ""],
        ["1", "2", "3"],
      ]),
    ).toBe(false);
  });

  it("still refuses when a filled header cell is numeric", () => {
    // A blank is not evidence either way; a number is evidence this is data.
    expect(
      inferHeader([
        ["", "Ctrl", "2024"],
        ["GeneA", "1", "2"],
      ]),
    ).toBe(false);
  });

  it("is false for all-numeric or all-text grids", () => {
    expect(
      inferHeader([
        ["1", "2"],
        ["3", "4"],
      ]),
    ).toBe(false);
    expect(
      inferHeader([
        ["a", "b"],
        ["c", "d"],
      ]),
    ).toBe(false);
  });
});

describe("coerceGrid", () => {
  it("treats configured naTokens as missing (null), case-insensitively, body only", () => {
    const grid = [
      ["dose", "NA"], // header row is never nulled — this column is literally named "NA"
      ["1", "na"],
      ["NA", "5"],
    ];
    const out = coerceGrid(grid, { header: true, naTokens: ["NA"] });
    expect(out.columnNames).toEqual(["dose", "NA"]); // header kept
    expect(out.rows).toEqual([[1, null], [null, 5]]); // "na"/"NA" body cells → null
  });

  it("strips a thousands separator to read grouped numbers, keeping genuine text intact", () => {
    const out = coerceGrid([["n", "label"], ["1,000,000", "a,b"], ["2,500", "x"]], { header: true, thousands: "," });
    expect(out.rows).toEqual([[1000000, "a,b"], [2500, "x"]]); // number ungrouped; "a,b" stays text
  });

  it("supports European grouping (dot thousands + comma decimal): 1.234,56 → 1234.56", () => {
    const out = coerceGrid([["v"], ["1.234,56"]], { header: true, thousands: ".", decimal: "," });
    expect(out.rows).toEqual([[1234.56]]);
  });

  it("uses the header row for names and type-infers the body", () => {
    const grid = [
      ["dose", "response"],
      ["1", "10.5"],
      ["2", "x"],
    ];
    expect(coerceGrid(grid, { header: true })).toEqual({
      columnNames: ["dose", "response"],
      rows: [
        [1, 10.5],
        [2, "x"],
      ],
    });
  });

  it("defaults column names when header is off", () => {
    expect(coerceGrid([["1", "2"]], { header: false })).toEqual({
      columnNames: ["Column 1", "Column 2"],
      rows: [[1, 2]],
    });
  });

  it("fills blank header names and de-duplicates collisions", () => {
    const grid = [
      ["x", "", "x"],
      ["1", "2", "3"],
    ];
    expect(coerceGrid(grid, { header: true }).columnNames).toEqual(["x", "Column 2", "x (2)"]);
  });

  it("detectDates: an all-ISO-date column becomes a date column of day-serials", () => {
    const grid = [
      ["Day", "Value"],
      ["2024-01-15T00:00:00.000Z", "10"],
      ["2024-01-16T00:00:00.000Z", "20"],
    ];
    const out = coerceGrid(grid, { header: true, infer: false, detectDates: true });
    expect(out.columnTypes?.[0]).toBe("date");
    expect(out.columnTypes?.[1]).toBeUndefined();
    // stored as day-serials, not the ISO strings
    expect(typeof out.rows[0]![0]).toBe("number");
    expect(daysToISO(out.rows[0]![0] as number)).toBe("2024-01-15");
  });

  it("detectDates is default-deny: a column with any non-date value is left untyped", () => {
    // Detection covers plain ISO / US / Euro dates (not just Excel's T…Z form), so the guard is
    // "every cell must be a date". One stray non-date value keeps the whole column as text.
    const grid = [["Label"], ["2024-01-15"], ["not a date"]];
    const out = coerceGrid(grid, { header: true, infer: false, detectDates: true });
    expect(out.columnTypes).toBeUndefined();
    expect(out.rows[0]![0]).toBe("2024-01-15");
  });

  it("detectDates: a plain-ISO column (YYYY-MM-DD, no T…Z) is a date column", () => {
    const grid = [["Day"], ["2024-01-15"], ["2024-01-16"]];
    const out = coerceGrid(grid, { header: true, infer: true, detectDates: true });
    expect(out.columnTypes?.[0]).toBe("date");
    expect(daysToISO(out.rows[0]![0] as number)).toBe("2024-01-15");
  });

  it("detectDates: US M/D/YYYY imports as dates", () => {
    const grid = [["date"], ["1/22/2020"], ["12/31/2021"]];
    const out = coerceGrid(grid, { header: true, infer: true, detectDates: true });
    expect(out.columnTypes?.[0]).toBe("date");
    expect(daysToISO(out.rows[0]![0] as number)).toBe("2020-01-22");
    expect(daysToISO(out.rows[1]![0] as number)).toBe("2021-12-31");
  });

  it("detectDates: Euro D/M/YYYY is read day-first when a day > 12 disambiguates it", () => {
    const grid = [["date"], ["22/1/2020"], ["31/12/2021"]];
    const out = coerceGrid(grid, { header: true, infer: true, detectDates: true });
    expect(out.columnTypes?.[0]).toBe("date");
    expect(daysToISO(out.rows[0]![0] as number)).toBe("2020-01-22"); // 22 Jan, not month 22
  });

  it("detectDates: an all-ambiguous slash column defaults to US month-first", () => {
    const grid = [["date"], ["3/4/2020"], ["5/6/2020"]];
    const out = coerceGrid(grid, { header: true, infer: true, detectDates: true });
    expect(out.columnTypes?.[0]).toBe("date");
    expect(daysToISO(out.rows[0]![0] as number)).toBe("2020-03-04"); // March 4 (US), not April 3
  });

  it("detectDates: a ratio column (1/2, 3/4 — no 4-digit year) is not mistaken for dates", () => {
    const grid = [["ratio"], ["1/2"], ["3/4"]];
    const out = coerceGrid(grid, { header: true, infer: true, detectDates: true });
    expect(out.columnTypes).toBeUndefined();
  });

  it("detectDates: a date-shaped but out-of-range column (13/40/2020) is rejected", () => {
    const grid = [["code"], ["13/40/2020"], ["12/34/2019"]];
    const out = coerceGrid(grid, { header: true, infer: true, detectDates: true });
    expect(out.columnTypes).toBeUndefined();
  });

  it("detectDates: an h:mm:ss column imports as an elapsed (duration) column of seconds", () => {
    const grid = [["t"], ["0:30"], ["1:05:00"]];
    const out = coerceGrid(grid, { header: true, infer: true, detectDates: true });
    expect(out.columnTypes?.[0]).toBe("elapsed");
    expect(out.rows[0]![0]).toBe(30); // 0:30 → 30 s
    expect(out.rows[1]![0]).toBe(3900); // 1:05:00 → 3900 s
  });

  it("de-dup never emits a suffix that collides with a later literal", () => {
    // "x","x" → "x","x (2)"; the third literal is also "x (2)" → it must be bumped again
    // rather than producing a second "x (2)". The names stay distinct (the invariant that
    // matters); the colliding literal's own suffix is bumped rather than guess it belongs to
    // the "x" family (a column could legitimately be named "x (2)").
    const grid = [
      ["x", "x", "x (2)"],
      ["1", "2", "3"],
    ];
    const names = coerceGrid(grid, { header: true }).columnNames;
    expect(names).toEqual(["x", "x (2)", "x (2) (2)"]);
    expect(new Set(names).size).toBe(3);
  });

  it("collapses blank cells to null and pads short rows to width", () => {
    const grid = [
      ["a", "b"],
      ["1", ""],
      ["2"],
    ];
    expect(coerceGrid(grid, { header: true }).rows).toEqual([
      [1, null],
      [2, null],
    ]);
  });

  it("preserves already-typed Excel cells when infer is off", () => {
    const grid = [
      ["label", "value"],
      ["007", 5],
      ["", null],
    ];
    expect(coerceGrid(grid, { header: true, infer: false })).toEqual({
      columnNames: ["label", "value"],
      rows: [
        ["007", 5],
        [null, null],
      ],
    });
  });
});
