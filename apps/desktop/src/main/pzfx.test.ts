// @vitest-environment node
import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { coerceGrid } from "@mady/core";
import { parsePzfx, PZFX_IMPORT_NOTICE, readPzfxFile } from "./pzfx";

// The parser only matches <Table> blocks, so the exact root element is irrelevant here — a
// neutral root keeps the fixtures realistic without tying them to one root tag.
const wrap = (body: string): string => `<?xml version="1.0" encoding="UTF-8"?>\n<file XMLVersion="5.00">${body}</file>`;

/** Rows of the whole-document sample below. */
const SAMPLE_ROWS = 120;
const SAMPLE_Y = ['Sample A &quot;open&quot;', "Sample A closed", "Wild Type", "Mutant 1", "Mutant 2", "Mutant 3", "Blank"];

/**
 * A whole document laid out the way the format is written to disk, with invented numbers: one
 * element per line, Windows line endings, attributes on the table and its columns, a project-info
 * block with its own titles ahead of the tables, a trailing binary block, comma decimals, and a
 * second table that repeats the first one's title. Row r of Y column c holds (r + 1) · (c + 1) / 7,
 * written to six decimals with a comma; the last column leaves every tenth cell empty.
 */
function sampleDocument(): string {
  const value = (r: number, c: number): string => (((r + 1) * (c + 1)) / 7).toFixed(6).replace(".", ",");
  const column = (tag: string, attrs: string, title: string, cells: string[]): string[] => [
    `<${tag} Width="81" ${attrs} Subcolumns="1">`,
    `<Title>${title}</Title>`,
    "<Subcolumn>",
    ...cells,
    "</Subcolumn>",
    `</${tag}>`,
  ];
  const rows = Array.from({ length: SAMPLE_ROWS }, (_, r) => r);
  const table = (id: string): string[] => [
    `<Table ID="${id}" XFormat="numbers" YFormat="replicates" Replicates="1" TableType="XY" EVFormat="AsteriskAfterNumber">`,
    "<Title>Data 1</Title>",
    ...column("XColumn", 'Decimals="0"', "Position", rows.map((r) => `<d>${r + 1}</d>`)),
    ...SAMPLE_Y.flatMap((title, c) =>
      column("YColumn", 'Decimals="6"', title, rows.map((r) => (c === SAMPLE_Y.length - 1 && r % 10 === 9 ? "<d/>" : `<d>${value(r, c)}</d>`))),
    ),
    "</Table>",
  ];
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<file XMLVersion="5.00">',
    "<Created>",
    '<OriginalVersion CreatedByVersion="6.0" DateTime="2000-01-01T00:00:00+00:00"/>',
    "</Created>",
    "<InfoSequence>",
    '<Ref ID="Info0" Selected="1"/>',
    "</InfoSequence>",
    '<Info ID="Info0">',
    "<Title>Project info 1</Title>",
    "<Notes>",
    "</Notes>",
    "<Constant><Name>Experiment Date</Name><Value></Value></Constant>",
    "<Constant><Name>Notebook ID</Name><Value/></Constant>",
    "</Info>",
    "<TableSequence>",
    '<Ref ID="Table0" Selected="1"/>',
    '<Ref ID="Table1"/>',
    "</TableSequence>",
    ...table("Table0"),
    ...table("Table1"),
    '<Template xmlns:dt="urn:schemas-microsoft-com:datatypes" dt:dt="bin.base64">AAAA</Template>',
    "</file>",
    "",
  ].join("\r\n");
}

describe("parsePzfx — data-table import", () => {
  it("reads an XY table: X + Y columns, headers on row 0, values below", () => {
    const xml = wrap(`
      <Table ID="Table0" TableType="XY">
        <Title>Data 1</Title>
        <XColumn Subcolumns="1"><Title>Dose</Title><Subcolumn><d>1</d><d>2</d><d>3</d></Subcolumn></XColumn>
        <YColumn Subcolumns="1"><Title>Response</Title><Subcolumn><d>10.5</d><d>20.5</d><d>31</d></Subcolumn></YColumn>
      </Table>`);
    const [sheet] = parsePzfx(xml);
    expect(sheet!.name).toBe("Data 1");
    expect(sheet!.grid[0]).toEqual(["Dose", "Response"]); // header row
    expect(sheet!.grid[1]).toEqual([1, 10.5]);
    expect(sheet!.grid[3]).toEqual([3, 31]);
  });

  it("handles a comma-decimal (European) file — 3,59707 becomes the number 3.59707, not a string", () => {
    const xml = wrap(`
      <Table ID="T" TableType="XY">
        <Title>EU</Title>
        <YColumn Subcolumns="1"><Title>V</Title><Subcolumn><d>3,59707</d><d>0,8465224</d><d>1,1</d></Subcolumn></YColumn>
      </Table>`);
    const [sheet] = parsePzfx(xml);
    expect(sheet!.grid[1]).toEqual([3.59707]);
    expect(sheet!.grid[2]).toEqual([0.8465224]);
  });

  it("keeps an Excluded value's number (exclusion is analysis metadata MadY does not carry)", () => {
    const xml = wrap(`
      <Table ID="T" TableType="XY">
        <Title>X</Title>
        <YColumn Subcolumns="1"><Title>V</Title><Subcolumn><d Excluded="1">7.25</d><d>8</d></Subcolumn></YColumn>
      </Table>`);
    const [sheet] = parsePzfx(xml);
    expect(sheet!.grid[1]).toEqual([7.25]); // the value survives, the flag is dropped
  });

  it("empty <d/> and <d></d> cells become null (a gap), never 0 or NaN", () => {
    const xml = wrap(`
      <Table ID="T" TableType="XY">
        <Title>Gaps</Title>
        <YColumn Subcolumns="1"><Title>V</Title><Subcolumn><d>1</d><d/><d></d><d>4</d></Subcolumn></YColumn>
      </Table>`);
    const [sheet] = parsePzfx(xml);
    expect(sheet!.grid.slice(1).map((r) => r[0])).toEqual([1, null, null, 4]);
  });

  it("expands replicate subcolumns into separate, index-suffixed columns", () => {
    const xml = wrap(`
      <Table ID="T" TableType="XY">
        <Title>Reps</Title>
        <YColumn Subcolumns="2"><Title>Drug</Title>
          <Subcolumn><d>1</d><d>2</d></Subcolumn>
          <Subcolumn><d>3</d><d>4</d></Subcolumn>
        </YColumn>
      </Table>`);
    const [sheet] = parsePzfx(xml);
    expect(sheet!.grid[0]).toEqual(["Drug (1)", "Drug (2)"]);
    expect(sheet!.grid[1]).toEqual([1, 3]);
  });

  it("unescapes XML entities in titles and keeps text cells verbatim", () => {
    const xml = wrap(`
      <Table ID="T" TableType="Column">
        <Title>Cats &amp; Co</Title>
        <YColumn Subcolumns="1"><Title>Group &quot;A&quot;</Title><Subcolumn><d>Alpha</d><d>Beta</d></Subcolumn></YColumn>
      </Table>`);
    const [sheet] = parsePzfx(xml);
    expect(sheet!.name).toBe("Cats & Co");
    expect(sheet!.grid[0]).toEqual(['Group "A"']);
    expect(sheet!.grid[1]).toEqual(["Alpha"]); // a text label stays a string
  });

  it("disambiguates duplicate table names", () => {
    const one = `<Table ID="a" TableType="XY"><Title>Data 1</Title><YColumn Subcolumns="1"><Title>V</Title><Subcolumn><d>1</d></Subcolumn></YColumn></Table>`;
    const sheets = parsePzfx(wrap(one + one));
    expect(sheets.map((s) => s.name)).toEqual(["Data 1", "Data 1 (2)"]);
  });

  it("a file with no data tables yields no sheets (only graphs/analyses)", () => {
    expect(parsePzfx(wrap(`<Info><Title>Project info</Title></Info>`))).toEqual([]);
  });

  it("PZFX_IMPORT_NOTICE names the limit (data only, not graphs/analyses)", () => {
    expect(PZFX_IMPORT_NOTICE).toMatch(/data tables? are imported/i);
    expect(PZFX_IMPORT_NOTICE.toLowerCase()).toContain("graphs");
    expect(PZFX_IMPORT_NOTICE.toLowerCase()).toContain("analyses");
  });

  it("parses a whole document read from disk: 2 tables, 8 columns × 120 rows, comma decimals", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mady-pzfx-"));
    try {
      const path = join(dir, "sample.pzfx");
      writeFileSync(path, sampleDocument(), "utf8");
      const sheets = await readPzfxFile(path);
      expect(sheets.length).toBe(2);
      const [t0] = sheets;
      // 1 X + 7 Y columns = 8 headers; the project-info titles ahead of the tables are not columns.
      expect(t0!.grid[0]).toEqual(["Position", 'Sample A "open"', "Sample A closed", "Wild Type", "Mutant 1", "Mutant 2", "Mutant 3", "Blank"]);
      expect(t0!.grid.length).toBe(SAMPLE_ROWS + 1);
      // The first X is 1; the first Y is the comma decimal 0,142857.
      expect(t0!.grid[1]![0]).toBe(1);
      expect(t0!.grid[1]![1]).toBeCloseTo(1 / 7, 6);
      expect(t0!.grid[SAMPLE_ROWS]![3]).toBeCloseTo((SAMPLE_ROWS * 3) / 7, 5);
      // An empty cell in the middle of a column is a gap, and the rows after it keep their place.
      expect(t0!.grid[10]![7]).toBeNull();
      expect(t0!.grid[11]![7]).toBeCloseTo((11 * 7) / 7, 6);
      // The repeated "Data 1" title is disambiguated.
      expect(sheets.map((s) => s.name)).toEqual(["Data 1", "Data 1 (2)"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("end-to-end: the parsed grid feeds coerceGrid and the comma-decimal Y column types as numeric", () => {
    const grid = parsePzfx(sampleDocument())[0]!.grid;
    const table = coerceGrid(grid, { header: true });
    expect(table.columnNames[0]).toBe("Position");
    // Every non-null cell in a Y column is a real number (the European commas parsed, not stringified).
    const wildTypeIdx = table.columnNames.indexOf("Wild Type");
    const col = table.rows.map((r) => r[wildTypeIdx]).filter((v) => v != null);
    expect(col.length).toBeGreaterThan(100);
    expect(col.every((v) => typeof v === "number" && Number.isFinite(v))).toBe(true);
  });
});
