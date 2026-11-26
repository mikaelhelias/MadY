import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { MadyApp, collectErrors } from "./app";

/**
 * The menu bar, end to end — every action under File · Edit · Insert · Data · Analyze ·
 * Graph · Design · View, driven through the real menus and verified by its effect.
 *
 * Every action in these menus is run in the live app and must do what it says.
 *
 * What that means, per action kind:
 *  - a dialog action must put its dialog on screen (matched by aria-label);
 *  - a mutation action must change the document (read back through the fiber);
 *  - a bridge action (native open/save/export) must hand the bridge a sane payload — the
 *    stub below stands in for Electron exactly like the save-part spec's does;
 *  - a gated action must be disabled where it cannot act (e.g. File → Export… must not sit
 *    enabled on the Welcome tab and silently do nothing).
 *  Every test also asserts zero console errors — the backstop for "it ran but broke".
 */

/** Electron-bridge stub, installed before the app boots (window.mady is read at mount). */
async function stubBridge(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const calls: { name: string; detail?: string }[] = [];
    (window as unknown as { __bridgeCalls: typeof calls }).__bridgeCalls = calls;
    (window as unknown as { mady: unknown }).mady = {
      exportFile: (p: { format: string; suggestedName?: string; text?: string }) => {
        calls.push({ name: "exportFile", detail: `${p.format}:${p.suggestedName}:${(p.text ?? "").length}` });
        return Promise.resolve({ ok: true, path: "C:/fake" });
      },
      importData: () => { calls.push({ name: "importData" }); return Promise.resolve({ ok: false, canceled: true }); },
      openFile: () => { calls.push({ name: "openFile" }); return Promise.resolve({ ok: false, canceled: true }); },
      saveProject: (json: string, name: string) => { calls.push({ name: "saveProject", detail: `${name}:${json.length}` }); return Promise.resolve({ ok: true, path: "C:/fake.mady" }); },
      printFigure: (p: { svg?: string; html?: string }) => { calls.push({ name: "printFigure", detail: "svg" in p && p.svg != null ? "svg" : "html" in p && p.html != null ? "html" : "?" }); return Promise.resolve({ ok: true }); },
      readClipboardText: () => "X\tY\n1\t2\n3\t4",
      copyImageToClipboard: (b64: string) => { calls.push({ name: "copyImageToClipboard", detail: b64.slice(0, 11) }); },
      copyTextToClipboard: (t: string) => { calls.push({ name: "copyTextToClipboard", detail: t.slice(0, 4) }); },
    };
    // window.alert blocks the page dead under automation; capture instead.
    (window as unknown as { __alerts: string[] }).__alerts = [];
    window.alert = (m: unknown) => { (window as unknown as { __alerts: string[] }).__alerts.push(String(m)); };
  });
}

const bridgeCalls = (page: Page) => page.evaluate(() => (window as unknown as { __bridgeCalls: { name: string; detail?: string }[] }).__bridgeCalls);
const alerts = (page: Page) => page.evaluate(() => (window as unknown as { __alerts: string[] }).__alerts);

/** Is a menu item present, and is it enabled? Closes the menu again either way.
 *  The menubar does not close on Escape. It closes on its own label, on running an item, or on
 *  a click outside it (the full-screen `.menu-scrim`, which takes that click instead of the page).
 *  Close via a JS click on the open label (dispatch, so an overlapping nested panel cannot
 *  intercept it). */
async function itemState(page: Page, menu: string, label: string): Promise<"enabled" | "disabled" | "missing"> {
  await page.locator(".menubar .menu", { hasText: new RegExp(`^${menu}$`) }).click();
  const subs = page.locator(".dropdown .dropsub");
  for (let i = 0; i < (await subs.count()); i++) await subs.nth(i).click();
  const item = page.locator(".dropdown .dropitem", { hasText: label }).first();
  const state = (await item.count()) === 0 ? "missing" : (await item.isDisabled()) ? "disabled" : "enabled";
  await page.evaluate(() => (document.querySelector(".menubar .menu.open") as HTMLElement | null)?.click());
  await page.locator(".dropdown").waitFor({ state: "detached" });
  return state;
}

/** Close whatever modal is up. Every modal renders inside a full-screen `.modalov` whose own
 *  click cancels; the modal stops propagation — so a click in the overlay's top-left corner is
 *  the universal closer. (Only some dialogs close on Escape.) */
async function closeDialog(page: Page): Promise<void> {
  const ov = page.locator(".modalov").last();
  if (await ov.count()) {
    await ov.click({ position: { x: 4, y: 4 } });
    await page.locator(".modalov").waitFor({ state: "detached" }).catch(() => {});
  }
}

const dialog = (page: Page, label: string) => page.locator(`[role="dialog"][aria-label="${label}"]`);

/** Open a menu item and expect the named dialog; close it again. */
async function expectDialog(page: Page, app: MadyApp, menu: string, item: string, label: string): Promise<void> {
  await app.menu(menu, item);
  await expect(dialog(page, label), `${menu} → ${item} did not open "${label}"`).toBeVisible();
  await closeDialog(page);
  await expect(dialog(page, label)).toHaveCount(0);
}

test.describe("menu bar — every action does its thing", () => {
  test("File", async ({ page }) => {
    await collectErrors(page);
    await stubBridge(page);
    const app = new MadyApp(page);
    await page.goto("/");
    await page.waitForSelector(".nav");

    // Gating first, on the Welcome tab: Export… and Print… must be disabled (nothing printable).
    expect(await itemState(page, "File", "Export…"), "Export… must be disabled on Welcome").toBe("disabled");
    expect(await itemState(page, "File", "Print…"), "Print… must be disabled on Welcome").toBe("disabled");

    // Open… → the bridge's native dialog (browser fallback only exists without a bridge)
    await app.menu("File", "Open…");
    expect((await bridgeCalls(page)).some((c) => c.name === "openFile")).toBe(true);

    // Import data… → the bridge
    await app.menu("File", "Import data…");
    expect((await bridgeCalls(page)).some((c) => c.name === "importData")).toBe(true);

    // Paste data → the Import dialog, fed from the stubbed clipboard
    await app.menu("File", "Paste data as new datasheet…");
    await expect(dialog(page, "Import data")).toBeVisible();
    await closeDialog(page);

    // Save… → the scope picker (whole project / experiment / graph)
    await app.menu("File", "Save…");
    await expect(dialog(page, "Save project")).toBeVisible();
    await closeDialog(page);

    // Export… with a graph active → the Export dialog
    await app.openGraph("Dose-response");
    await expectDialog(page, app, "File", "Export…", "Export");

    // Print… with a graph active → prints the graph as an SVG (bridge stubbed for the OS dialog)
    expect(await itemState(page, "File", "Print…"), "Print must be enabled on a graph").toBe("enabled");
    await app.menu("File", "Print…");
    expect((await bridgeCalls(page)).find((c) => c.name === "printFigure")?.detail, "graph print did not send an SVG").toBe("svg");

    // Export analysis script / repro bundle → exportFile payloads with real content
    await app.menu("File", "Export analysis script");
    await app.menu("File", "Export reproducibility bundle…");
    const calls = await bridgeCalls(page);
    const py = calls.find((c) => c.detail?.startsWith("py:"));
    const md = calls.find((c) => c.detail?.startsWith("md:"));
    expect(py, "no Python script reached the bridge").toBeTruthy();
    expect(Number(py!.detail!.split(":")[2]), "the Python script is empty").toBeGreaterThan(100);
    expect(md, "no repro bundle reached the bridge").toBeTruthy();
    expect(Number(md!.detail!.split(":")[2]), "the repro bundle is empty").toBeGreaterThan(1000);

    // New project → a folder lands in the workspace
    const before = ((await app.project()) as { workspace: { folders: unknown[] } }).workspace.folders.length;
    await app.menu("File", "New project");
    const after = ((await app.project()) as { workspace: { folders: unknown[] } }).workspace.folders.length;
    expect(after, "New project added no folder").toBe(before + 1);

    // New datasheet / graph… → the creator dialog
    await expectDialog(page, app, "File", "New datasheet / graph…", "New graph");

    expect(await app.consoleErrors()).toEqual([]);
  });

  test("Edit + Insert", async ({ page }) => {
    await collectErrors(page);
    await stubBridge(page);
    const app = new MadyApp(page);
    await page.goto("/");
    await page.waitForSelector(".nav");

    // Undo starts disabled (nothing to undo on a fresh document)
    expect(await itemState(page, "Edit", "Undo"), "Undo must start disabled").toBe("disabled");
    expect(await itemState(page, "Edit", "Redo"), "Redo must start disabled").toBe("disabled");

    // Insert → New datasheet (XY): a table appears…
    const tables = async () => ((await app.project()) as { tables: { id: string; kind: string }[] }).tables;
    const t0 = (await tables()).length;
    await app.menu("Insert", "New datasheet");
    expect((await tables()).length).toBe(t0 + 1);

    // …Undo removes it, Redo restores it
    await app.menu("Edit", "Undo");
    expect((await tables()).length, "Undo did not revert the new dataset").toBe(t0);
    await app.menu("Edit", "Redo");
    expect((await tables()).length, "Redo did not restore the new dataset").toBe(t0 + 1);

    // Insert → New table ▸ each remaining format creates a table of that kind.
    // Driven through app.menu (which walks submenus the way the Analyze test does) — hand-rolled
    // nested-panel clicks would race the panel's mouse-leave.
    const FORMATS: [string, string][] = [
      ["column", "Column table"], ["grouped", "Grouped table"], ["contingency", "Contingency table"],
      ["survival", "Survival table"], ["partsofwhole", "Parts of whole table"],
      ["multivariable", "Multiple variables table"], ["nested", "Nested table"],
    ];
    for (const [kind, label] of FORMATS) {
      const n = (await tables()).length;
      await app.menu("Insert", label);
      const now = await tables();
      expect(now.length, `New ${kind} table added nothing`).toBe(n + 1);
      expect(now.at(-1)!.kind, `the new table is not a ${kind} table`).toBe(kind);
    }

    // Insert → New layout: a figure layout appears
    const layouts = async () => ((await app.project()) as { layouts?: unknown[] }).layouts ?? [];
    const l0 = (await layouts()).length;
    await app.menu("Insert", "New layout");
    expect((await layouts()).length, "New layout added nothing").toBe(l0 + 1);

    expect(await app.consoleErrors()).toEqual([]);
  });

  test("Data", async ({ page }) => {
    await collectErrors(page);
    await stubBridge(page);
    const app = new MadyApp(page);
    await page.goto("/");
    await page.waitForSelector(".nav");

    // Exclude/include are disabled without a data selection
    expect(await itemState(page, "Data", "Exclude selected values"), "Exclude must be disabled with no selection").toBe("disabled");
    expect(await itemState(page, "Data", "Include selected values")).toBe("disabled");
    // Edit ▸ Copy/Cut/Paste are the menu route to the grid clipboard — disabled with no selection.
    expect(await itemState(page, "Edit", "Copy"), "Copy must be disabled with no selection").toBe("disabled");
    expect(await itemState(page, "Edit", "Cut")).toBe("disabled");
    expect(await itemState(page, "Edit", "Paste")).toBe("disabled");

    // Open a datasheet and select a value cell
    await app.expandTree();
    await page.locator("button.navlabelbtn", { hasText: "Sample — dose vs response" }).first().click();
    await page.waitForSelector("table.dg");
    await page.locator("table.dg tbody td").nth(2).click(); // a Y value
    expect(await itemState(page, "Data", "Exclude selected values"), "a selected cell must enable Exclude").toBe("enabled");
    // …and a selection lights up the Edit clipboard items (table isn't frozen → Cut/Paste too).
    expect(await itemState(page, "Edit", "Copy"), "Copy must enable with a selection").toBe("enabled");
    expect(await itemState(page, "Edit", "Cut")).toBe("enabled");
    expect(await itemState(page, "Edit", "Paste")).toBe("enabled");

    // Data ▸ Sort rows by column — the menu route to the datasheet sort (dialog → reorder).
    const firstColNums = async (): Promise<number[]> => {
      const p = (await app.project()) as { tables: { name: string; columns: { id: string }[]; rows: { cells: Record<string, unknown> }[] }[] };
      const t = p.tables.find((x) => x.name.includes("dose vs response"))!;
      const c = t.columns[0]!.id;
      return t.rows.map((r) => r.cells[c]).filter((v): v is number => typeof v === "number");
    };
    await app.menu("Data", "Sort rows by column…");
    await page.waitForSelector('[aria-label="Sort by column"]');
    await page.selectOption('[aria-label="Sort by column"] select[aria-label="Sort direction"]', "desc");
    await page.locator('[aria-label="Sort by column"] .modalbtns .btn').click();
    await expect(page.locator('[aria-label="Sort by column"]')).toHaveCount(0);
    const desc = await firstColNums();
    for (let i = 1; i < desc.length; i++) expect(desc[i]! <= desc[i - 1]!, `row ${i} not descending after Sort`).toBe(true);
    // Sort back ascending (default direction) and confirm the reverse order.
    await app.menu("Data", "Sort rows by column…");
    await page.waitForSelector('[aria-label="Sort by column"]');
    await page.locator('[aria-label="Sort by column"] .modalbtns .btn').click();
    await expect(page.locator('[aria-label="Sort by column"]')).toHaveCount(0);
    const asc = await firstColNums();
    for (let i = 1; i < asc.length; i++) expect(asc[i]! >= asc[i - 1]!, `row ${i} not ascending after Sort`).toBe(true);
    // Re-select a value cell for the exclude/include checks below (Sort rebuilt the rows).
    await page.locator("table.dg tbody td").nth(2).click();

    // Exclude marks the value; Include clears it (both read back from the document)
    const excludedCount = async () => {
      const p = (await app.project()) as { tables: { excluded?: Record<string, string[]> }[] };
      return p.tables.reduce((n, t) => n + Object.values(t.excluded ?? {}).reduce((m, ids) => m + ids.length, 0), 0);
    };
    const e0 = await excludedCount();
    await app.menu("Data", "Exclude selected values");
    expect(await excludedCount(), "Exclude wrote nothing into the document").toBeGreaterThan(e0);
    await page.locator("table.dg tbody td").nth(2).click();
    await app.menu("Data", "Include selected values");
    expect(await excludedCount(), "Include did not clear the exclusion").toBe(e0);

    // Every reshaping dialog opens on the active datasheet
    await expectDialog(page, app, "Data", "Transform values…", "Transform data");
    await expectDialog(page, app, "Data", "Remove baseline & column math…", "Remove baseline and column math");
    await expectDialog(page, app, "Data", "Row statistics…", "Row statistics");
    await expectDialog(page, app, "Data", "Frequency distribution…", "Frequency distribution");
    await expectDialog(page, app, "Data", "Normal probability", "QQ plot");
    await expectDialog(page, app, "Data", "Prune rows…", "Prune rows");
    await expectDialog(page, app, "Data", "Extract & rearrange columns…", "Extract and rearrange");
    await expectDialog(page, app, "Data", "Transpose rows and columns…", "Transpose");
    await expectDialog(page, app, "Data", "Reshape data", "Reshape data");

    // Print… on a datasheet tab prints it as an HTML table.
    expect(await itemState(page, "File", "Print…"), "Print must be enabled on a datasheet").toBe("enabled");
    await app.menu("File", "Print…");
    expect((await bridgeCalls(page)).find((c) => c.name === "printFigure")?.detail, "datasheet print did not send HTML").toBe("html");

    // Duplicate datasheet: tables + 1, same kind and shape
    const tables = async () => ((await app.project()) as { tables: { kind: string; rows: unknown[] }[] }).tables;
    const t0 = await tables();
    await app.menu("Data", "Duplicate datasheet");
    const t1 = await tables();
    expect(t1.length, "Duplicate datasheet added nothing").toBe(t0.length + 1);
    expect(t1.at(-1)!.rows.length, "the duplicate lost its rows").toBeGreaterThan(0);

    expect(await app.consoleErrors()).toEqual([]);
  });

  test("Analyze", async ({ page }) => {
    await collectErrors(page);
    await stubBridge(page);
    const app = new MadyApp(page);
    await app.open();

    await expectDialog(page, app, "Analyze", "Analyze…", "Analyze");
    // These five Common analyses items all open the same Analyze dialog, pre-configured
    for (const item of ["Dose-response…", "Enzyme kinetics…", "Receptor binding…", "Interpolate a standard curve…", "Method comparison…"]) {
      await page.locator(".menubar .menu", { hasText: /^Analyze$/ }).click();
      await page.locator(".dropdown .dropsub", { hasText: "Common analyses" }).click();
      await page.locator(".dropdown .dropitem", { hasText: item }).first().click();
      await expect(dialog(page, "Analyze"), `${item} did not open the Analyze dialog`).toBeVisible();
      await closeDialog(page);
    }
    await expectDialog(page, app, "Analyze", "Sample size & power…", "Sample size and power");
    await expectDialog(page, app, "Analyze", "Simulate data…", "Simulate data");
    await expectDialog(page, app, "Analyze", "Monte-Carlo simulation…", "Monte-Carlo simulation");

    expect(await app.consoleErrors()).toEqual([]);
  });

  test("Graph", async ({ page }) => {
    await collectErrors(page);
    await stubBridge(page);
    const app = new MadyApp(page);
    await page.goto("/");
    await page.waitForSelector(".nav");

    // Duplicate / apply-look are disabled with no graph active (Welcome tab)
    expect(await itemState(page, "Graph", "Duplicate graph"), "Duplicate must be disabled on Welcome").toBe("disabled");
    expect(await itemState(page, "Graph", "Apply this look to other graphs")).toBe("disabled");
    expect(await itemState(page, "Graph", "Copy as picture"), "Copy as picture must be disabled on Welcome").toBe("disabled");
    expect(await itemState(page, "Graph", "Copy as SVG"), "Copy as SVG must be disabled on Welcome").toBe("disabled");

    await expectDialog(page, app, "Graph", "New graph…", "New graph");
    await app.menu("Graph", "Chart gallery…");
    await page.waitForSelector(".gallerycard");
    expect(await page.locator(".gallerycard").count(), "the gallery shows no cards").toBeGreaterThan(20);

    // On a real graph: New graph of this data → the New-graph dialog on that data (not a blind
    // addPlot() of an XY graph, which is empty on most sheets); Create graph → plots + 1 on
    // the same table.
    await app.openGraph("Dose-response");
    const plots = async () => ((await app.project()) as { plots: { source: string; kind?: string }[] }).plots;
    const p0 = await plots();
    await app.menu("Graph", "New graph of this data");
    const dlg = dialog(page, "New graph");
    await expect(dlg, "New graph of this data did not open the New-graph dialog").toBeVisible();
    await expect(dlg.locator(".modalh"), "the dialog is not on the open sheet").toContainText("New graph of");
    await dlg.locator("button.btn", { hasText: /^Create graph$/ }).click();
    await expect(dlg).toHaveCount(0);
    const p1 = await plots();
    expect(p1.length, "New graph of this data added nothing").toBe(p0.length + 1);
    expect(p1.at(-1)!.source, "the new graph is not on the same data").toBe(p0.find((x) => x.kind === "xy")?.source ?? p1.at(-1)!.source);

    // Duplicate graph → plots + 1, same kind as the active one
    await app.openGraph("Dose-response");
    const p2 = await plots();
    await app.menu("Graph", "Duplicate graph");
    const p3 = await plots();
    expect(p3.length, "Duplicate graph added nothing").toBe(p2.length + 1);

    await expectDialog(page, app, "Graph", "Apply this look to other graphs", "Apply this look");

    // Copy as picture / as SVG: enabled on a graph, and the clipboard bridge
    // receives a PNG (its base64 starts with the PNG signature) / the SVG markup.
    expect(await itemState(page, "Graph", "Copy as picture")).toBe("enabled");
    await app.menu("Graph", "Copy as picture");
    await expect.poll(async () => (await bridgeCalls(page)).some((c) => c.name === "copyImageToClipboard" && c.detail === "iVBORw0KGgo"), "Copy as picture put no PNG on the clipboard").toBe(true);
    await app.menu("Graph", "Copy as SVG");
    await app.settle();
    expect((await bridgeCalls(page)).some((c) => c.name === "copyTextToClipboard" && c.detail === "<svg"), "Copy as SVG put no markup on the clipboard").toBe(true);
    expect(await alerts(page)).toEqual([]);

    expect(await app.consoleErrors()).toEqual([]);
  });

  test("Design", async ({ page }) => {
    await collectErrors(page);
    await stubBridge(page);
    const app = new MadyApp(page);
    await page.goto("/");
    await page.waitForSelector(".nav");

    // Everything is disabled with no graph on screen
    for (const item of ["Text box", "Arrow", "Add a blank significance bracket"]) {
      expect(await itemState(page, "Design", item), `${item} must be disabled on Welcome`).toBe("disabled");
    }

    // On a bar graph (a bracket kind): every annotation action lands one annotation of its kind
    await app.openGraph("Treatment bar chart");
    const annotations = async () => {
      const p = (await app.project()) as { plots: { name: string; annotations?: { kind: string }[] }[] };
      return p.plots.find((x) => x.name === "Treatment bar chart")?.annotations ?? [];
    };
    const CASES: [string, string][] = [
      ["Text box", "text"],
      ["Arrow", "arrow"],
      ["Line", "segment"],
      ["Box", "rect"],
      ["Highlight", "highlight"],
      ["Ellipse", "ellipse"],
      ["Callout", "callout"],
      ["Horizontal reference line", "hline"],
      ["Vertical reference line", "vline"],
      ["Vertical band", "vband"],
      ["Horizontal band", "hband"],
      ["Add a blank significance bracket", "bracket"],
    ];
    for (const [item, kind] of CASES) {
      const n = (await annotations()).length;
      await app.menu("Design", item);
      const now = await annotations();
      expect(now.length, `Design → ${item} added no annotation`).toBe(n + 1);
      expect(now.at(-1)!.kind, `Design → ${item} added the wrong kind`).toBe(kind);
    }

    // From-analysis items stay disabled without a pairwise analysis on this data
    const hasPairwise = await page.evaluate(() => false); // the sample ships none for this table
    if (!hasPairwise) {
      expect(await itemState(page, "Design", "Significance brackets from an analysis…")).toBe("disabled");
      expect(await itemState(page, "Design", "Significance letters (CLD) from an analysis…")).toBe("disabled");
    }

    // Thresholds & labels: clears the sub-selection so the plot panel (which owns the
    // Significance section, on its Annotate rail tab) is what the user lands on.
    await app.menu("Design", "Significance thresholds & labels…");
    // The action clears the sub-selection; make the plot panel current the way a user would
    // (click the figure background), then its Annotate rail tab owns the Significance section.
    await page.locator("svg.gfx-figure").click({ position: { x: 8, y: 8 } });
    await page.locator(".inspcat", { hasText: "Annotate" }).click();
    await expect(page.locator("details.inspsec summary", { hasText: "Significance brackets" })).toBeVisible();

    expect(await app.consoleErrors()).toEqual([]);
  });

  test("View", async ({ page }) => {
    await collectErrors(page);
    await stubBridge(page);
    const app = new MadyApp(page);
    await app.open();

    // Back / Forward move through the tab history
    await app.openGraph("Treatment bar chart");
    await app.menu("View", "Back");
    await expect(page.locator(".tab.on").first()).toContainText(/Dose-response/);
    await app.menu("View", "Forward");
    await expect(page.locator(".tab.on").first()).toContainText(/Treatment bar chart/);

    // Command palette
    await app.menu("View", "Command palette…");
    await expect(dialog(page, "Command palette")).toBeVisible();
    await page.keyboard.press("Escape"); // the palette does close on Escape (its own handler)
    await page.locator('[aria-label="Command palette"]').waitFor({ state: "detached" }).catch(() => {});

    // Lineage opens its pane
    await app.menu("View", "Lineage");
    await expect(page.locator(".lineage").first()).toBeVisible();

    // Settings dialog
    await app.openGraph("Dose-response");
    await expectDialog(page, app, "View", "Settings — styles & preferences…", "Settings");

    // Zoom in / out / reset move the status-bar zoom label
    const zoomLabel = () => page.locator(".zoomval").innerText(); // the status-bar one (the graph toolbar carries a twin)
    const z0 = await zoomLabel();
    await app.menu("View", "Zoom in");
    const z1 = await zoomLabel();
    expect(z1, "Zoom in did not change the zoom").not.toBe(z0);
    await app.menu("View", "Zoom out");
    expect(await zoomLabel(), "Zoom out did not change the zoom").toBe(z0);
    await app.menu("View", "Zoom in");
    await app.menu("View", "Reset zoom");
    expect(await zoomLabel(), "Reset zoom did not return to 100%").toBe("100%");
    await expectDialog(page, app, "View", "Set zoom level…", "Set zoom");

    // Theme flips the document attribute, and flips back
    const theme = () => page.evaluate(() => document.documentElement.dataset.theme);
    const th0 = await theme();
    await app.menu("View", "Toggle light/dark");
    expect(await theme(), "the theme did not flip").not.toBe(th0);
    await app.menu("View", "Toggle light/dark");
    expect(await theme()).toBe(th0);

    // Layouts dialog; the two resets run clean (their effect is the dock itself)
    await app.menu("View", "Layouts…");
    await expect(dialog(page, "Layouts")).toBeVisible();
    await closeDialog(page);
    await app.menu("View", "Reset layout");
    await app.menu("View", "Reset toolbar layout");

    expect(await app.consoleErrors()).toEqual([]);
  });
});
