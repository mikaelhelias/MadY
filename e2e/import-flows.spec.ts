import { expect, test } from "@playwright/test";
import * as XLSX from "xlsx";
import { MadyApp, collectErrors } from "./app";
import { legacyWorkbookFromBuffer } from "../apps/desktop/src/main/excel";
import type { Page } from "@playwright/test";

/**
 * End-to-end import flows — the layer no unit/component test reaches: the whole path from the
 * Import dialog through Confirm to a real datasheet in the document. Only the file-read bridge is
 * stubbed (the OS file picker can't be driven); everything after — parse, options, the interactive
 * preview, confirm, table creation — is the shipping code.
 */

type TableView = { name: string; columns: string[]; rows: unknown[][] };

async function tables(page: Page): Promise<TableView[]> {
  const app = new MadyApp(page);
  const proj = (await app.project()) as { tables?: { name: string; columns: { id: string; name: string }[]; rows: { cells: Record<string, unknown> }[] }[] };
  return (proj.tables ?? []).map((t) => ({
    name: t.name,
    columns: t.columns.map((c) => c.name),
    rows: t.rows.map((r) => t.columns.map((c) => (c.id in r.cells ? r.cells[c.id] : null))),
  }));
}

/** Stub the file-read bridge with `src`, run File ▸ Import data…, set options, confirm; return the
 *  table(s) created by this import. */
async function importSource(
  page: Page,
  src: Record<string, unknown>,
  setup?: (page: Page) => Promise<void>,
): Promise<TableView[]> {
  const before = (await tables(page)).length;
  await page.evaluate((s) => {
    (window as unknown as { mady: unknown }).mady = { importData: async () => ({ ok: true, ...s }) };
  }, src);
  await page.locator(".menubar .menu", { hasText: /^File$/ }).click();
  await page.locator(".dropdown .dropitem", { hasText: /^Import data/ }).first().click();
  await page.waitForSelector(".modal-import", { timeout: 15000 });
  if (setup) await setup(page);
  await page.locator(".modal-import .btn").click();
  await expect(page.locator(".modal-import")).toHaveCount(0);
  return (await tables(page)).slice(before);
}

test.describe("import flows (dialog → confirm → datasheet)", () => {
  test("text: CSV, missing values, thousands, whitespace, skip rows", async ({ page }) => {
    await collectErrors(page);
    await new MadyApp(page).open();

    let t = await importSource(page, { source: "text", name: "csv", text: "dose,response\n1,10\n2,20" });
    expect(t[0]!.columns).toEqual(["dose", "response"]);
    expect(t[0]!.rows).toEqual([[1, 10], [2, 20]]);

    // Keep-all is the default — NA stays as text unless the user opts in by typing the token.
    t = await importSource(page, { source: "text", name: "na-keep", text: "a,b\n1,NA\n2,20" });
    expect(t[0]!.rows).toEqual([[1, "NA"], [2, 20]]); // NA kept — nothing to clear
    t = await importSource(page, { source: "text", name: "na-opt", text: "a,b\n1,NA\n2,20" }, async (p) => {
      await p.fill('.modal-import input[aria-label="Missing-value tokens"]', "NA");
    });
    expect(t[0]!.rows).toEqual([[1, null], [2, 20]]); // opted in → NA → missing

    t = await importSource(page, { source: "text", name: "grp", text: "v\tlabel\n1,000,000\ta\n2,500\tb" }, async (p) => {
      await p.selectOption('.modal-import select[aria-label="Thousands separator"]', ",");
    });
    expect(t[0]!.rows).toEqual([[1000000, "a"], [2500, "b"]]);

    t = await importSource(page, { source: "text", name: "ws", text: "a  b   c\n1 2 3\n4 5 6" }, async (p) => {
      await p.selectOption('.modal-import select[aria-label="Delimiter"]', "whitespace");
    });
    expect(t[0]!.columns).toEqual(["a", "b", "c"]);
    expect(t[0]!.rows).toEqual([[1, 2, 3], [4, 5, 6]]);

    t = await importSource(page, { source: "text", name: "skip", text: "# note\nx,y\n1,2\n3,4" }, async (p) => {
      await p.fill('.modal-import input[aria-label="Skip rows"]', "1");
    });
    expect(t[0]!.columns).toEqual(["x", "y"]);
    expect(t[0]!.rows).toEqual([[1, 2], [3, 4]]);

    expect(await new MadyApp(page).consoleErrors()).toEqual([]);
  });

  test("text: comment lines, units row, JSON and NDJSON", async ({ page }) => {
    await collectErrors(page);
    await new MadyApp(page).open();

    // Comment marker drops '#' preamble lines so the real header is detected.
    let t = await importSource(page, { source: "text", name: "rig", text: "# rig export\n# note\ndose,resp\n1,10\n2,20" }, async (p) => {
      await p.selectOption('.modal-import select[aria-label="Comment marker"]', "#");
    });
    expect(t[0]!.columns).toEqual(["dose", "resp"]);
    expect(t[0]!.rows).toEqual([[1, 10], [2, 20]]);

    // Units row folds into the column names and leaves the data numeric.
    t = await importSource(page, { source: "text", name: "kin", text: "Time,Conc\ns,uM\n0,1\n10,2" }, async (p) => {
      await p.locator('.modal-import .importchk', { hasText: "units" }).locator('input').check();
    });
    expect(t[0]!.columns).toEqual(["Time (s)", "Conc (uM)"]);
    expect(t[0]!.rows).toEqual([[0, 1], [10, 2]]);

    // JSON array-of-objects auto-selects the JSON format and keys the table.
    t = await importSource(page, { source: "text", name: "json", text: '[{"x":1,"y":2},{"x":3,"y":4}]' });
    expect(t[0]!.columns).toEqual(["x", "y"]);
    expect(t[0]!.rows).toEqual([[1, 2], [3, 4]]);

    // NDJSON via the explicit Format selection.
    t = await importSource(page, { source: "text", name: "nd", text: '{"a":1,"b":2}\n{"a":3,"b":4}' }, async (p) => {
      await p.selectOption('.modal-import select[aria-label="Delimiter"]', "json");
    });
    expect(t[0]!.columns).toEqual(["a", "b"]);
    expect(t[0]!.rows).toEqual([[1, 2], [3, 4]]);

    expect(await new MadyApp(page).consoleErrors()).toEqual([]);
  });

  test("text: append onto an existing datasheet (match by name)", async ({ page }) => {
    await collectErrors(page);
    await new MadyApp(page).open();

    // First import creates the sheet…
    let t = await importSource(page, { source: "text", name: "batch1", text: "Dose,Resp\n1,10\n2,20" });
    expect(t[0]!.rows).toEqual([[1, 10], [2, 20]]);

    // …then a second import appends to it. Incoming columns are in the opposite order → name-match
    // must realign them, and no new table is created.
    const before = (await tables(page)).length;
    await page.evaluate(() => {
      (window as unknown as { mady: unknown }).mady = { importData: async () => ({ ok: true, source: "text", name: "batch2", text: "Resp,Dose\n30,3\n40,4" }) };
    });
    await page.locator(".menubar .menu", { hasText: /^File$/ }).click();
    await page.locator(".dropdown .dropitem", { hasText: /^Import data/ }).first().click();
    await page.waitForSelector(".modal-import", { timeout: 15000 });
    await page.selectOption('.modal-import select[aria-label="Destination"]', { label: "Append to “batch1”" });
    await page.locator(".modal-import .btn").click();
    await expect(page.locator(".modal-import")).toHaveCount(0);

    const after = await tables(page);
    expect(after.length).toBe(before); // no new datasheet — appended in place
    const merged = after.find((x) => x.name === "batch1")!;
    expect(merged.columns).toEqual(["Dose", "Resp"]);
    expect(merged.rows).toEqual([[1, 10], [2, 20], [3, 30], [4, 40]]); // realigned + appended

    expect(await new MadyApp(page).consoleErrors()).toEqual([]);
  });

  test("excel: multi-sheet makes one datasheet each; range restricts a sheet", async ({ page }) => {
    await collectErrors(page);
    await new MadyApp(page).open();

    let t = await importSource(page, {
      source: "excel", name: "book.xlsx",
      sheets: [
        { name: "Raw", grid: [["x", "y"], [1, 2], [3, 4]] },
        { name: "Sum", grid: [["g", "m"], ["A", 9]] },
        { name: "Empty", grid: [] },
      ],
    });
    expect(t.map((x) => x.name)).toEqual(["Raw", "Sum"]); // empty sheet excluded
    expect(t[0]!.rows).toEqual([[1, 2], [3, 4]]);

    // Legacy .xls: build a real .xls buffer, decode it with the production SheetJS reader, and
    // import the decoded sheets through the same dialog path — real bytes → decode → datasheet.
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Dose", "Resp"], [1, 10], [2, 20]]), "Sheet1");
    const xlsBuf = XLSX.write(wb, { type: "buffer", bookType: "xls" }) as Buffer;
    const sheets = legacyWorkbookFromBuffer(xlsBuf);
    t = await importSource(page, { source: "excel", name: "legacy.xls", sheets });
    expect(t[0]!.columns).toEqual(["Dose", "Resp"]);
    expect(t[0]!.rows).toEqual([[1, 10], [2, 20]]);

    t = await importSource(page, {
      source: "excel", name: "ranged.xlsx",
      sheets: [{ name: "S", grid: [["title", "", "", "note"], ["", "Dose", "Resp", "q"], ["", 1, 10, "y"], ["", 2, 20, "z"]] }],
    }, async (p) => {
      await p.fill('.modal-import input[aria-label="Cell range"]', "B2:C4");
    });
    expect(t[0]!.columns).toEqual(["Dose", "Resp"]);
    expect(t[0]!.rows).toEqual([[1, 10], [2, 20]]);

    expect(await new MadyApp(page).consoleErrors()).toEqual([]);
  });
});
