import { expect, test, type Locator, type Page } from "@playwright/test";
import { MadyApp, collectErrors } from "./app";

/**
 * The guided tours, driven — every step of every tour completed the way a reader would, with real
 * clicks through the dimmed window. Two things only a browser can prove:
 *
 *  1. The light lands on the right control. `tour.ts` names anchors; jsdom cannot lay them out.
 *     Here the ring's box is checked to contain the control it claims to light — the File title
 *     before the menu drops, the Paste row after, the Import button once the dialog is up, an
 *     Inspector tab before it is open and the row inside it after.
 *  2. Dim only. Every gesture below is a real click on the program while the overlay is up. If
 *     the dark layer ever took pointer events, the first menu click would land on it and the
 *     spec would stop right there.
 *
 * The clipboard is the one stub (the web build has no OS clipboard); everything after the paste
 * is shipping code. The statistics engine is absent in a browser, so an analysis runs (the record
 * appears, the tour's count goes up) but has no result: the markers step is Skipped here and its
 * done-check is proven in `tour.test.ts`.
 */

const SAMPLE = "Dose\tControl\tTreated\n0\t2.1\t2.0\n1\t3.4\t5.9\n2\t4.9\t9.8\n4\t6.2\t14.1";

async function stubBridge(page: Page): Promise<void> {
  await page.addInitScript((tsv: string) => {
    (window as unknown as { mady: unknown }).mady = { readClipboardText: () => tsv };
    (window as unknown as { __alerts: string[] }).__alerts = [];
    window.alert = (m: unknown) => { (window as unknown as { __alerts: string[] }).__alerts.push(String(m)); };
  }, SAMPLE);
}

const stepId = (page: Page): Promise<string | null> => page.locator(".tour").getAttribute("data-tour-step");

/** What is on screen when a light is missing: the step, the active tab, and every figure's box. */
async function diagnose(page: Page): Promise<string> {
  return page.evaluate(() => {
    const step = document.querySelector(".tour")?.getAttribute("data-tour-step");
    const tab = [...document.querySelectorAll("button.tab")].map((t) => t.className + ":" + t.textContent).join("|");
    const insp = [...document.querySelectorAll(".inspcat.on")].map((t) => t.textContent).join(",");
    return `step=${step} tabs=${tab} inspTab=${insp}`;
  });
}

/** The ring's box must contain the control's box: the light is ON the thing, not near it. */
async function expectLit(page: Page, control: Locator, what: string): Promise<void> {
  const deadline = Date.now() + 4000;
  let verdict = "unmeasured";
  while (Date.now() < deadline) {
    try {
      const ring = page.locator(".tour-ring");
      if ((await ring.count()) !== 1) verdict = `no ring (${await diagnose(page)})`;
      else {
        const r = await ring.boundingBox({ timeout: 500 });
        const c = await control.boundingBox({ timeout: 500 });
        if (!r || !c) verdict = `unmeasured: ring ${r ? "yes" : "no"}, control ${c ? "yes" : "no"} (${await diagnose(page)})`;
        else {
          const inside = c.x >= r.x - 1 && c.y >= r.y - 1 && c.x + c.width <= r.x + r.width + 1 && c.y + c.height <= r.y + r.height + 1;
          verdict = inside ? "lit" : `ring ${JSON.stringify(r)} does not contain ${what} ${JSON.stringify(c)} (${await diagnose(page)})`;
        }
      }
    } catch (e) {
      verdict = `error: ${String(e).split("\n")[0]}`;
    }
    if (verdict === "lit") break;
    await page.waitForTimeout(100);
  }
  expect(verdict, `${what} is not lit`).toBe("lit");
}

/** Boot to the Welcome page (no graph open) with the bridge stubbed. */
async function boot(page: Page): Promise<MadyApp> {
  await stubBridge(page);
  await collectErrors(page);
  const app = new MadyApp(page);
  await page.goto("/");
  await page.waitForSelector(".nav", { timeout: 30_000 });
  return app;
}

/** Start a tour from the Welcome page: its Guided tours tile opens the list tab, Start there begins. */
async function startFromWelcome(page: Page, id: string, firstStep: string): Promise<void> {
  await page.locator(".welcome-action", { hasText: "Guided tours" }).click();
  await expect(page.locator(".tourspane .tours-row")).toHaveCount(9);
  await page.locator(`.tours-start[data-tour-id="${id}"]`).click();
  await expect(page.locator(".tour")).toHaveCount(1);
  await expect.poll(() => stepId(page)).toBe(firstStep);
}

/** Start a tour from Help ▸ Guided tours ▸ … (the Welcome card is not on screen once a graph is). */
async function startFromMenu(page: Page, app: MadyApp, label: string, firstStep: string): Promise<void> {
  await app.menu("Help", label);
  await expect(page.locator(".tour")).toHaveCount(1);
  await expect.poll(() => stepId(page)).toBe(firstStep);
}

/** Type into an Inspector number box the way a reader does: focus, replace, leave. */
async function typeInto(input: Locator, value: string): Promise<void> {
  await input.click();
  await input.fill(value);
  await input.press("Tab");
}

/** Open an Axis-tab group when its rows are folded away, so the row can be typed into. */
async function unfold(page: Page, groupTitle: string, rowLabel: string): Promise<void> {
  if (!(await row(page, rowLabel).isVisible())) await page.locator(".insp .inspsub2 > summary", { hasText: new RegExp(`^${groupTitle}`) }).click();
}

/** An Inspector row by its label — the same address the tour uses. */
const row = (page: Page, label: string): Locator => page.locator(".insp .frow", { has: page.locator(`span:text-is("${label}")`) }).first();
const inspTab = (page: Page, label: string): Locator => page.locator(".insp .inspcat", { hasText: new RegExp(`^${label}$`) });

async function finish(page: Page, app: MadyApp): Promise<void> {
  await expect.poll(() => stepId(page)).toBe("finished");
  await expect(page.locator(".tour-next")).toHaveText("Finish");
  await page.locator(".tour-next").click();
  await expect(page.locator(".tour")).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as { __alerts: string[] }).__alerts)).toEqual([]);
  expect(await app.consoleErrors()).toEqual([]);
}

test.describe("Help ▸ Guided tours", () => {
  test("first graph: the whole path end to end, lighting each control, through a dim that takes no clicks", async ({ page }) => {
    const app = await boot(page);
    const before = (await app.project()) as { tables: unknown[]; plots: unknown[] };

    // The Welcome page's card starts it.
    await startFromWelcome(page, "first-graph", "copy");
    await expect(page.locator(".tour-dim")).toHaveCount(1); // no anchor: the whole window dims
    await expect(page.locator(".tour-sample")).toHaveCount(1);
    await page.locator(".tour-next").click();

    // 2. Paste — the File title is lit; once the menu drops the light moves to the row.
    expect(await stepId(page)).toBe("paste");
    const fileTitle = page.locator('[data-tour="menu:File"]');
    await expectLit(page, fileTitle, "the File menu title");
    await fileTitle.click(); // through the dim
    const pasteRow = page.locator('[data-tour="cmd:paste-data"]');
    await expectLit(page, pasteRow, "the Paste row");
    await pasteRow.click();

    // 3. Import — the dialog is up (its own backdrop too), the Import button is lit.
    await expect.poll(() => stepId(page)).toBe("import");
    const importBtn = page.locator('[data-tour="import-confirm"]');
    await expectLit(page, importBtn, "the Import button");
    await expect(importBtn).toHaveText(/Import \d+ rows/);
    await importBtn.click();
    await app.settle();

    // 4. Format chip — a look step; the chip on the new sheet is lit.
    await expect.poll(() => stepId(page)).toBe("format");
    const mid = (await app.project()) as { tables: unknown[] };
    expect(mid.tables.length).toBe(before.tables.length + 1);
    await expectLit(page, page.locator(".fmt-badge-sel"), "the format chip");
    await page.locator(".tour-next").click();

    // 5. "New graph of this data" — the rail button above the new sheet is lit (the menu's
    //    New graph… would make a fresh sheet and land there; the walkthrough means this one).
    expect(await stepId(page)).toBe("newgraph");
    const railBtn = page.locator('[data-tour="rail-newgraph"]');
    await expectLit(page, railBtn, "the rail's New graph button");
    await railBtn.click();

    // 6. Create graph.
    await expect.poll(() => stepId(page)).toBe("create");
    const createBtn = page.locator('[data-tour="newgraph-create"]');
    await expectLit(page, createBtn, "the Create button");
    await createBtn.click();
    await app.settle();
    await expect.poll(() => stepId(page)).toBe("select");
    const after = (await app.project()) as { plots: unknown[] };
    expect(after.plots.length).toBe(before.plots.length + 1);

    // 7. Click a part of the graph — the figure is lit; a real click on a series mark selects.
    await expectLit(page, page.locator(".graphzoom svg.gfx-figure").first(), "the figure");
    await app.clickFirstSeriesMark();
    await expect.poll(() => stepId(page)).toBe("colour");

    // 8. Change something in the Inspector — a real control, through the dim.
    await expectLit(page, page.locator(".insp"), "the Inspector");
    await inspTab(page, "Data").click(); // the tab the card names
    const colour = page.locator('.insp input[type="color"]').first();
    await expect(colour, "no colour control on the Data tab").toBeVisible({ timeout: 5000 });
    await colour.fill("#ff0000");
    await expect.poll(() => stepId(page)).toBe("title");

    // 9. Retitle in place.
    const title = page.locator('[data-tour="plot-title"]');
    await expectLit(page, title, "the title");
    await title.dblclick();
    const editor = page.locator(".gfx-figwrap input, .gfx-figwrap textarea").first();
    await editor.fill("Response to dose");
    await editor.press("Control+Enter"); // the title editor is multi-line: plain Enter is a new line
    await expect.poll(() => stepId(page)).toBe("export");

    // 10. File ▸ Export… then 11. the dialog's button is lit; cancelling still completes the step
    //     (the check is "the dialog closed after being open", so the reader is never stuck on a
    //     browser that cannot write the file).
    await expectLit(page, fileTitle, "the File menu title (export)");
    await fileTitle.click();
    const exportRow = page.locator('[data-tour="cmd:export"]');
    await expectLit(page, exportRow, "the Export row");
    await exportRow.click();
    await expect.poll(() => stepId(page)).toBe("exportgo");
    await expectLit(page, page.locator('[data-tour="export-confirm"]'), "the Export button");
    await page.locator(".modalov .btn-ghost", { hasText: /^Cancel$/ }).click();
    await finish(page, app);
  });

  test("axes: the light goes tab → group → row as the reader opens each, and the axis gets a range, ticks and a cut", async ({ page }) => {
    const app = await boot(page);
    // No graph in front: the tour's first card asks for one and lights the Project tree.
    await startFromWelcome(page, "axes", "open-graph");
    await expectLit(page, page.locator(".nav"), "the Project tree");
    await app.openGraph("Dose-response");
    await expect.poll(() => stepId(page)).toBe("select-axis");

    // The Y axis line is the second clickable axis line drawn (X first, then Y).
    await expectLit(page, page.locator(".graphzoom svg.gfx-figure").first(), "the figure");
    await page.locator('.graphzoom svg.gfx-figure line[style*="cursor: pointer"]').nth(1).click({ force: true });
    await app.settle();
    expect(((await app.selection()) as { kind?: string } | null)?.kind).toBe("axis");
    await expect.poll(() => stepId(page)).toBe("range");

    // Range: a distinctive value — the demo axis may already sit at 0.
    await unfold(page, "Range", "Min / Max");
    await expectLit(page, row(page, "Min / Max"), "the Min / Max row");
    await typeInto(row(page, "Min / Max").locator("input").first(), "3");
    await expect.poll(() => stepId(page)).toBe("ticks");

    await unfold(page, "Ticks", "Tick interval");
    await expectLit(page, row(page, "Tick interval"), "the Tick interval row");
    await typeInto(row(page, "Tick interval").locator("input").first(), "7");
    await expect.poll(() => stepId(page)).toBe("minor");

    await expectLit(page, row(page, "Minor ticks"), "the Minor ticks row");
    await typeInto(row(page, "Minor ticks").locator("input").first(), "3");
    await expect.poll(() => stepId(page)).toBe("break");

    // Breaks (cuts) is a closed group: its rows are not laid out, so the light sits on the
    // heading; opening it moves the light in to the Add cut row.
    const breaksHead = page.locator(".insp .inspsub2 > summary", { hasText: /^Breaks \(cuts\)/ });
    await expectLit(page, breaksHead, "the Breaks (cuts) heading");
    await breaksHead.click();
    const addCut = page.locator(".insp .frow", { has: page.locator('button:text-is("Add cut")') });
    await expectLit(page, addCut, "the Add cut row");
    await page.locator('.insp input[aria-label="Break start"]').fill("30");
    await page.locator('.insp input[aria-label="Break end"]').fill("60");
    await page.locator('.insp button:text-is("Add cut")').click();
    await finish(page, app);
  });

  test("datasheet: add a column, type into it, select cells, exclude them, bring them back", async ({ page }) => {
    const app = await boot(page);
    await startFromWelcome(page, "datasheet", "open-sheet");
    await expectLit(page, page.locator(".nav"), "the Project tree");
    // Open the demo's XY sheet from the tree (the same label button a graph has).
    await app.expandTree();
    await page.locator('button.navlabelbtn[title^="Sample"]').first().click();
    await expect.poll(() => stepId(page)).toBe("add-column");

    const cols = async () => ((await app.project()) as { tables: { name: string; columns: unknown[] }[] }).tables.find((t) => t.name.startsWith("Sample"))!.columns.length;
    const before = await cols();
    const addCol = page.locator('[data-tour="rail-addcolumn"]');
    await expectLit(page, addCol, "the + Column button");
    await addCol.click();
    await expect.poll(() => stepId(page)).toBe("type-values");
    // An XY sheet with replicate sub-columns adds the new Y with its replicates: more, not one more.
    expect(await cols()).toBeGreaterThan(before);

    // Type into the new (last) column of the first row: double-click opens the cell editor, Enter keeps it.
    await expectLit(page, page.locator("table.dg"), "the grid");
    const newCell = page.locator("table.dg tbody tr").first().locator("td.dgcell").last();
    await newCell.dblclick();
    const editor = page.locator("table.dg input").first();
    await editor.fill("5");
    await editor.press("Enter");
    // Typing leaves the edited cell selected, so "select some values" is normally skipped.
    await expect.poll(() => stepId(page)).toMatch(/^(select-cells|exclude)$/);

    // A click on a cell selects it → Exclude wakes up.
    await page.locator("table.dg tbody tr").nth(1).locator("td.dgcell").nth(1).click();
    await expect.poll(() => stepId(page)).toBe("exclude");
    const excl = page.locator(".datarail .railbtn", { hasText: /^Exclude$/ });
    await expectLit(page, excl, "the Exclude button");
    await excl.click();
    await expect.poll(() => stepId(page)).toBe("see-effect");
    await expect(page.locator("td.dgcell.dgexcl")).toHaveCount(1);
    // The card says to look at a graph: the reader does, then presses Next. The next step works on
    // the sheet, so the tour brings the sheet back in front on its own.
    await app.openGraph("Dose-response");
    await expect(page.locator("table.dg")).toHaveCount(0);
    await page.locator(".tour-next").click();
    await expect.poll(() => stepId(page)).toBe("include");
    await expect(page.locator("table.dg")).toHaveCount(1);
    // The excluded cell must be selected again for Include. The card sits over the top of the grid,
    // so do what a reader would: drag it away by its header, then click the cell.
    const head = page.locator(".tour-card-head");
    const hb = (await head.boundingBox())!;
    await page.mouse.move(hb.x + 40, hb.y + hb.height / 2);
    await page.mouse.down();
    await page.mouse.move(hb.x + 40, hb.y + hb.height / 2 + 420, { steps: 6 });
    await page.mouse.up();
    await page.locator("td.dgcell.dgexcl").first().click();

    // Include: the button is lit and pressing it restores the value.
    const incl = page.locator(".datarail .railbtn", { hasText: /^Include$/ });
    await expectLit(page, incl, "the Include button");
    await incl.click();
    await expect(page.locator("td.dgcell.dgexcl")).toHaveCount(0);
    await finish(page, app);
  });

  test("first graph without data: the first card offers a sample datasheet; paste and import skip; the chip and the + tab are on that sheet", async ({ page }) => {
    const app = await boot(page);
    await startFromWelcome(page, "first-graph", "copy");
    const reach = page.locator(".tour-reach");
    await expect(reach).toHaveText("Use a sample datasheet");
    await reach.click();
    await expect(page.locator("button.tab.on", { hasText: "(tour sample)" })).toHaveCount(1);
    // The sheet's arrival completes the card; paste and import skip: straight to the format chip.
    await expect.poll(() => stepId(page)).toBe("format");
    await expectLit(page, page.locator(".fmt-badge-sel"), "the format chip");
    // Wander to the Welcome tab and press Next: the "+" tab step needs the sheet → it comes back.
    await page.locator("button.tab", { hasText: /^Welcome/ }).click();
    await expect(page.locator("table.dg")).toHaveCount(0);
    await page.locator(".tour-next").click();
    await expect.poll(() => stepId(page)).toBe("newgraph");
    await expect(page.locator("table.dg")).toHaveCount(1);
    await expectLit(page, page.locator('[data-tour="rail-newgraph"]'), "the rail's New graph button");
    expect(await app.consoleErrors()).toEqual([]);
  });

  test("Next only: pressing nothing but Next through the datasheet and first-graph tours makes the program do every step, and the states are real", async ({ page }) => {
    const app = await boot(page);
    // Datasheet tour: sample sheet, then Next × N.
    await startFromWelcome(page, "datasheet", "open-sheet");
    await page.locator(".tour-reach").click();
    await expect.poll(() => stepId(page)).toBe("add-column");
    const sampleCols = async () => ((await app.project()) as { tables: { name: string; columns: unknown[] }[] }).tables.find((t) => t.name.endsWith("(tour sample)"))!.columns.length;
    const cols0 = await sampleCols();
    for (let i = 0; i < 10 && (await stepId(page)) !== "finished"; i++) {
      await page.locator(".tour-next").click();
      await expect(page.locator(".tour-busy")).toHaveCount(0, { timeout: 5000 }); // the program did it
    }
    await expect.poll(() => stepId(page)).toBe("finished");
    expect(await sampleCols(), "no column was added").toBeGreaterThan(cols0);
    await expect(page.locator("td.dgcell.dgexcl"), "the value excluded by Next was not brought back by Next").toHaveCount(0);
    await page.locator(".tour-next").click();
    await expect(page.locator(".tour")).toHaveCount(0);

    // First-graph tour: sample sheet, then Next × N: a graph gets created, coloured, titled, and the export dialog opened and closed.
    await page.locator("button.tab", { hasText: /^Guided tours/ }).click();
    await page.locator('.tours-start[data-tour-id="first-graph"]').click();
    await expect.poll(() => stepId(page)).toBe("copy");
    const plots0 = ((await app.project()) as { plots: unknown[] }).plots.length;
    await page.locator(".tour-reach").click();
    for (let i = 0; i < 14 && (await stepId(page)) !== "finished"; i++) {
      await page.locator(".tour-next").click();
      await expect(page.locator(".tour-busy")).toHaveCount(0, { timeout: 5000 });
    }
    await expect.poll(() => stepId(page)).toBe("finished");
    const proj = (await app.project()) as { plots: { title?: string; name: string }[] };
    expect(proj.plots.length, "no graph was created").toBe(plots0 + 1);
    expect(proj.plots[proj.plots.length - 1]!.title, "the title step did not retitle").toMatch(/titled$/);
    await expect(page.locator(".modalov")).toHaveCount(0); // the export dialog was opened and closed again
    expect(await app.consoleErrors()).toEqual([]);

  });

  test("annotate, dose-response and panel figure: Next-only through each, and the document shows the work", async ({ page }) => {
    const app = await boot(page);
    const nextUntilFinished = async (max: number) => {
      for (let i = 0; i < max && (await stepId(page)) !== "finished"; i++) {
        await page.locator(".tour-next").click();
        await expect(page.locator(".tour-busy")).toHaveCount(0, { timeout: 5000 });
      }
      await expect.poll(() => stepId(page)).toBe("finished");
      await page.locator(".tour-next").click();
      await expect(page.locator(".tour")).toHaveCount(0);
    };

    // The annotate tour on the demo graph: three annotations appear on that graph.
    await app.openGraph("Dose-response");
    const plotId = await app.activePlotId();
    const annCount = async () => (((await app.plot(plotId)) as { annotations?: unknown[] })?.annotations ?? []).length;
    const ann0 = await annCount();
    await startFromMenu(page, app, "Tour: annotate", "add-text");
    await expectLit(page, page.locator(".graphribbon .grbsel", { hasText: /^Insert/ }), "the Insert chooser");
    await nextUntilFinished(6);
    expect(await annCount(), "three annotations were not added").toBe(ann0 + 3);

    // The dose-response tour on the same graph: the door opens Analyze; Run records an analysis (the engine
    // is absent here, so it records an error — the record still exists).
    const analyses0 = ((await app.project()) as { analyses: unknown[] }).analyses.length;
    await startFromMenu(page, app, "Tour: dose-response", "dose-door");
    await expectLit(page, page.locator('[data-tour="menu:Analyze"]'), "the Analyze menu title");
    await page.locator(".tour-next").click(); // the door
    await expect.poll(() => stepId(page)).toBe("run-fit");
    await expectLit(page, page.locator(".modal-analyze .btn"), "the Run button");
    await nextUntilFinished(6);
    expect(((await app.project()) as { analyses: unknown[] }).analyses.length).toBe(analyses0 + 1);

    // Panel figure from the Welcome page: a figure with two panels, arranged, exported (dialog closed again).
    await page.locator("button.tab", { hasText: /^Welcome/ }).click();
    await startFromWelcome(page, "figure", "new-figure");
    await expectLit(page, page.locator('[data-tour="menu:Insert"]'), "the Insert menu title");
    await expect(page.locator(".tour-reach")).toHaveText("Make a figure from my graphs");
    await page.locator(".tour-reach").click(); // the choice: make one now
    await expect.poll(() => stepId(page)).toBe("pick-graphs");
    await expect(page.locator(".layselect")).toHaveCount(1);
    await expectLit(page, page.locator(".laycards").first(), "the graph cards");
    await page.locator(".tour-next").click(); // two graphs picked for you
    await expect.poll(() => stepId(page)).toBe("arrange");
    await expect(page.locator(".laycard-on")).toHaveCount(2);
    await expectLit(page, page.locator(".addbtn", { hasText: "Build / Arrange" }), "the Build / Arrange button");
    await page.locator(".tour-next").click(); // Build / Arrange pressed for you, columns set
    await expect.poll(() => stepId(page)).toBe("export-figure");
    await expect(page.locator(".layoutview-tab.on")).toHaveText("Arrange");
    await expectLit(page, page.locator('.paneact[title^="Export this figure"]'), "the Export this figure button");
    await nextUntilFinished(6);
    const layouts = ((await app.project()) as { layouts?: { panels: string[]; columns?: number }[] }).layouts ?? [];
    expect(layouts[layouts.length - 1]!.panels.length).toBe(2);
    await expect(page.locator(".modalov")).toHaveCount(0);
    expect(await app.consoleErrors()).toEqual([]);
  });

  test("sample data: a tour started with nothing suitable in front offers a generated sheet, and it lands in front", async ({ page }) => {
    const app = await boot(page);
    await startFromWelcome(page, "datasheet", "open-sheet");
    const reach = page.locator(".tour-reach");
    await expect(reach).toHaveText("Use a sample datasheet");
    await reach.click();
    await expect(page.locator("button.tab", { hasText: "(tour sample)" })).toHaveCount(1);
    await expect.poll(() => stepId(page)).toBe("add-column");
    await expect(page.locator("table.dg")).toHaveCount(1);
    expect(await app.consoleErrors()).toEqual([]);
  });

  test("looks: grid, frame, background and a preset on the graph in front — the open-graph step is skipped", async ({ page }) => {
    const app = await boot(page);
    await app.openGraph("Dose-response");
    await startFromMenu(page, app, "Tour: looks", "grid"); // a graph is in front: "Open a graph" never shows

    const grid = page.locator(".graphribbon .grbtog", { hasText: "Grid" }).first();
    await expectLit(page, grid, "the Grid tickbox");
    await grid.locator("input").click();
    await expect.poll(() => stepId(page)).toBe("frame");

    const frame = page.locator(".graphribbon .grbsel", { hasText: /^Frame/ });
    await expectLit(page, frame, "the Frame chooser");
    await frame.locator("select").selectOption("box");
    await expect.poll(() => stepId(page)).toBe("select-plot");

    // The Inspector's tabs exist only once something is selected: the tour says so and lights the figure.
    await expectLit(page, page.locator(".graphzoom svg.gfx-figure").first(), "the figure");
    await app.clickFirstSeriesMark();
    await expect.poll(() => stepId(page)).toBe("background");

    // Another tab, a closed section, then the row: three lights in turn.
    await expectLit(page, inspTab(page, "Frame"), "the Frame tab");
    await inspTab(page, "Frame").click();
    // The light lands on the nearest thing that exists: the row when its section is open, else
    // the section heading until the reader opens it.
    const paper = row(page, "Paper");
    if (!(await paper.isVisible())) {
      const bgHead = page.locator(".insp .insphd", { hasText: /^Background/ });
      await expectLit(page, bgHead, "the Background heading");
      await bgHead.click();
    }
    await expectLit(page, paper, "the Paper row");
    await paper.locator("button", { hasText: /^Transparent$/ }).click();
    await expect.poll(() => stepId(page)).toBe("preset");

    await expectLit(page, inspTab(page, "Style"), "the Style tab");
    await inspTab(page, "Style").click();
    // The light moves in to the Style preset heading; open it and press a preset.
    const presetHead = page.locator(".insp .insphd", { hasText: /^Style preset/ });
    await expectLit(page, presetHead, "the Style preset heading");
    const presetBtn = page.locator("#insp-style-preset .btn-mini").first();
    if (!(await presetBtn.isVisible())) await presetHead.click();
    await presetBtn.click();
    await finish(page, app);
  });

  test("series: colour, shape, connection, thickness, then a curve fit through Analyze", async ({ page }) => {
    const app = await boot(page);
    await app.openGraph("Dose-response");
    await startFromMenu(page, app, "Tour: series", "select-series");

    await expectLit(page, page.locator(".graphzoom svg.gfx-figure").first(), "the figure");
    await app.clickFirstSeriesMark();
    await expect.poll(() => stepId(page)).toBe("colour");

    // A series click lands the Inspector on Data (derivedTab), so the row is laid out at once.
    await expectLit(page, row(page, "Colour"), "the Colour row");
    await row(page, "Colour").locator('input[type="color"]').fill("#00aa00");
    await expect.poll(() => stepId(page)).toBe("shape");

    await expectLit(page, row(page, "Shape"), "the Shape row");
    expect(await app.setControl("Shape", "square")).toBe("set");
    await expect.poll(() => stepId(page)).toBe("connect");

    await expectLit(page, row(page, "Connect"), "the Connect row");
    expect(await app.setControl("Connect", "smooth")).toBe("set");
    await expect.poll(() => stepId(page)).toBe("thickness");

    await expectLit(page, row(page, "Thickness"), "the Thickness row");
    expect(await app.setControl("Thickness", 4)).toBe("set");
    await expect.poll(() => stepId(page)).toBe("analyze");

    const analyzeTitle = page.locator('[data-tour="menu:Analyze"]');
    await expectLit(page, analyzeTitle, "the Analyze menu title");
    await analyzeTitle.click();
    const analyzeRow = page.locator('[data-tour="cmd:analyze"]');
    await expectLit(page, analyzeRow, "the Analyze… row");
    await analyzeRow.click();
    await expect.poll(() => stepId(page)).toBe("fit-run");

    const fitTile = page.locator('[data-goal="curvefit"]');
    await expectLit(page, fitTile, "the Curve fitting tile");
    await fitTile.click();
    await expectLit(page, page.locator(".modal-analyze .btn"), "the Run button");
    // The configure page needs picks a click-through cannot guess; the dialog's own onRun is the
    // same path Run takes (see MadyApp.analyzeRun). The engine is absent here, so the analysis
    // records an error — the record still exists, which is what the step waits for.
    const table = ((await app.project()) as { tables: { name: string; columns: { id: string }[] }[] }).tables.find((t) => t.name.startsWith("Sample"))!;
    await app.analyzeRun({ method: "regression", variant: "linear", columns: table.columns.slice(0, 2).map((c) => c.id) });
    await finish(page, app);
  });

  test("compare groups: Analyze on a Column sheet, Run, the markers step (no engine here → Skip), then the bracket style", async ({ page }) => {
    const app = await boot(page);
    await app.openGraph("Dose-group violin"); // its sheet is Column: the open-column step is skipped
    await startFromMenu(page, app, "Tour: compare groups", "analyze");

    const analyzeTitle = page.locator('[data-tour="menu:Analyze"]');
    await expectLit(page, analyzeTitle, "the Analyze menu title");
    await analyzeTitle.click();
    await page.locator('[data-tour="cmd:analyze"]').click();
    await expect.poll(() => stepId(page)).toBe("compare-run");

    const compareTile = page.locator('[data-goal="compare"]');
    await expectLit(page, compareTile, "the Compare groups tile");
    await compareTile.click();
    const run = page.locator(".modal-analyze .btn");
    await expectLit(page, run, "the Run button");
    // The groups are pre-picked for a Column sheet; if not, pick two by their chips.
    if (!(await run.isEnabled())) for (const name of ["Vehicle", "Low dose"]) await page.locator(".modal-analyze .angroup", { hasText: name }).first().click();
    await expect(run).toBeEnabled();
    await run.click();
    await expect.poll(() => stepId(page)).toBe("markers");

    // No engine in the browser: the analysis has no pairwise result, so no tickbox. Next has
    // nothing to do here and moves on; the check itself is proven in tour.test.ts.
    await expect(page.locator(".anbind-toggle")).toHaveCount(0);
    await page.locator(".tour-next").click();
    await expect.poll(() => stepId(page)).toBe("sig-style");

    // Back on the graph (the Design title is lit even here; its command is disabled off-graph),
    // then the command pins the Significance brackets section open and the light lands on its row.
    await page.locator("button.tab", { hasText: /^Dose-group violin/ }).click();
    const designTitle = page.locator('[data-tour="menu:Design"]');
    await expectLit(page, designTitle, "the Design menu title");
    await designTitle.click();
    const sigCmd = page.locator('[data-tour="cmd:design-sig-options"]');
    await expectLit(page, sigCmd, "the Significance thresholds row");
    await sigCmd.click();
    const shape = row(page, "Bracket shape");
    await expectLit(page, shape, "the Bracket shape row");
    await shape.locator("select").selectOption("rounded");
    await finish(page, app);
  });

  test("Help ▸ Guided tours ▸ … starts one too, and ✕ leaves it without touching the document", async ({ page }) => {
    const app = await boot(page);
    const before = JSON.stringify(await app.project());

    await app.menu("Help", "Tour: first graph");
    await expect(page.locator(".tour")).toHaveCount(1);
    await page.locator(".tour-x").click();
    await expect(page.locator(".tour")).toHaveCount(0);
    expect(JSON.stringify(await app.project())).toBe(before);
    expect(await app.consoleErrors()).toEqual([]);
  });

  test("the manual's Guided tours chapter lists every tour with a Start button that starts it", async ({ page }) => {
    const app = await boot(page);
    await app.menu("Help", "Documentation");
    const chapter = page.locator("#guide-guided-tours");
    await chapter.scrollIntoViewIfNeeded();
    await expect(chapter.locator(".guide-tours li")).toHaveCount(9);
    await chapter.locator('.guide-tourstart[data-tour-id="looks"]').click();
    await expect(page.locator(".tour")).toHaveCount(1);
    await page.locator(".tour-x").click();
  });
});
