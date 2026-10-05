import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { MadyApp, collectErrors } from "./app";

/**
 * Save a part, end to end: pick one graph, write a real file, open that file in a fresh
 * app, and check the graph is there and draws itself.
 *
 * The web build has no Electron bridge, so `window.mady.saveProject` is stubbed to hand the
 * JSON to Node, which writes it to a temp `.mady`. Everything else is the shipped code: the
 * picker, `extractPicks`, `JSON.stringify` → disk → `JSON.parse` → `migrate`, and the load
 * path (a second page, with no stub at all, opening the file through the browser file input).
 *
 * Note: the stub has to exist before the app boots, because `window.mady` is read at mount.
 */

const SAVE_BTN = 'button[title^="Save → .mady"]';
const OPEN_BTN = 'button[title^="Open a project"]';
const DIALOG = '[role="dialog"][aria-label="Save project"]';

interface SavedFile {
  plots: { id: string; name: string; source: string }[];
  tables: { id: string; name: string; rows: unknown[] }[];
  workspace: { folders: { name: string; experiments: { name: string; members: unknown[] }[]; members: unknown[] }[]; loose: unknown[] };
}

test.describe("saving a part of the project", () => {
  test("one graph → a real file → a fresh app opens it, with its data, and draws it", async ({ page, context }) => {
    await collectErrors(page);
    const dir = mkdtempSync(join(tmpdir(), "mady-save-part-"));
    let written = "";

    await page.exposeBinding("__e2eSave", async (_src, json: string, name: string) => {
      written = join(dir, `${name.replace(/[^\w.-]+/g, "_")}.mady`);
      writeFileSync(written, json, "utf8");
      return { ok: true, path: written };
    });
    await page.addInitScript(() => {
      const w = window as unknown as {
        mady: unknown;
        __e2eSave: (json: string, name: string) => Promise<unknown>;
      };
      w.mady = { saveProject: (json: string, name: string) => w.__e2eSave(json, name) };
    });

    const app = new MadyApp(page);
    await app.open();

    // --- pick exactly one graph
    await page.click(SAVE_BTN);
    await page.waitForSelector(DIALOG);
    await page.click(`${DIALOG} button[aria-label="Expand Demo Project"]`); // the picker starts collapsed + unticked
    await page.click(`${DIALOG} input[aria-label="Treatment bar chart"]`); // tick exactly one graph
    const confirm = page.locator(`${DIALOG} button.btn`);
    await expect(confirm).toHaveText("Save this graph…");
    await confirm.click();
    await expect(page.locator(DIALOG)).toHaveCount(0);

    // --- what actually landed on disk
    await expect.poll(() => written).not.toBe("");
    const file = JSON.parse(readFileSync(written, "utf8")) as SavedFile;
    expect(file.plots.map((p) => p.name)).toEqual(["Treatment bar chart"]);
    expect(file.tables.map((t) => t.name)).toEqual(["Treatment means"]); // the data came along
    expect(file.tables[0]!.rows.length).toBeGreaterThan(0);
    expect(file.plots[0]!.source).toBe(file.tables[0]!.id); // and it is the graph's own table
    expect(file.workspace.folders[0]!.experiments.map((e) => e.name)).toEqual(["Experiment 2"]);
    expect(await app.consoleErrors()).toEqual([]);

    // --- a fresh app (no bridge, no stub) opens the file
    const fresh = await context.newPage();
    await collectErrors(fresh);
    const app2 = new MadyApp(fresh);
    await fresh.goto("/");
    await fresh.waitForSelector(".nav");
    const [chooser] = await Promise.all([fresh.waitForEvent("filechooser"), fresh.click(OPEN_BTN)]);
    await chooser.setFiles(written);

    await fresh.waitForSelector("svg.gfx-figure"); // it opens ON the graph, and the graph draws
    const opened = (await app2.project()) as unknown as SavedFile;
    expect(opened.plots.map((p) => p.name)).toEqual(["Treatment bar chart"]);
    expect(opened.tables.map((t) => t.name)).toEqual(["Treatment means"]);
    expect(opened.tables[0]!.rows.length).toBe(file.tables[0]!.rows.length);
    // both objects are reachable in the tree — a graph whose datasheet you cannot open is not saved
    await app2.expandTree();
    const labels = await fresh.$$eval("button.navlabelbtn", (b) => b.map((x) => (x.textContent ?? "").trim()));
    expect(labels).toContain("Treatment bar chart");
    expect(labels).toContain("Treatment means");
    expect(labels).not.toContain("Dose-response"); // nothing from the experiments we left out
    expect(await app2.consoleErrors()).toEqual([]);
  });

  /**
   * Work made after launch must appear in the save picker: its list must not be
   * frozen at launch. This builds every kind of
   * object after launch with the buttons a user presses, saves the new project folder to a real
   * file, and opens that file in a fresh page with no stub.
   */
  test("new work made after launch → the picker lists it → a real file → a fresh app opens every piece", async ({ page, context }) => {
    await collectErrors(page);
    page.on("dialog", (d) => void d.accept());
    const dir = mkdtempSync(join(tmpdir(), "mady-save-new-"));
    let written = "";
    await page.exposeBinding("__e2eSave", async (_src, json: string, name: string) => {
      written = join(dir, `${name.replace(/[^\w.-]+/g, "_")}.mady`);
      writeFileSync(written, json, "utf8");
      return { ok: true, path: written };
    });
    await page.addInitScript(() => {
      const w = window as unknown as { mady: unknown; __e2eSave: (j: string, n: string) => Promise<unknown> };
      w.mady = { saveProject: (json: string, name: string) => w.__e2eSave(json, name) };
    });

    const app = new MadyApp(page);
    await page.goto("/");
    await page.waitForSelector(".nav");
    const nav = page.locator(".nav");

    // --- make one of everything, the way a user does
    await nav.getByTitle("New project folder").click(); // "Project 2" + "Experiment 1"
    await nav.getByTitle("Add dataset").last().click();
    await nav.getByTitle("Add graph of this experiment's data").last().click();
    await page.locator('[role="dialog"][aria-label="New graph"] button.btn', { hasText: /Create/ }).click();
    await nav.getByTitle("New panel figure for this experiment").last().click();
    await nav.getByTitle("Add experiment").last().click(); // an empty "Experiment 2"

    await app.menu("Graph", "New graph…");
    const wiz = page.locator('[role="dialog"][aria-label="New graph"]');
    await wiz.locator('[data-kind="column"]').click();
    await wiz.locator('[data-genre="bar"]').click();
    await wiz.locator('select[aria-label="Add to project"]').selectOption({ label: "Project 2" });
    await wiz.locator("button.btn", { hasText: /Create/ }).click();
    await app.menu("Analyze", "Analyze…");
    const analyze = page.locator('[role="dialog"][aria-label="Analyze"]');
    await analyze.getByRole("button", { name: "Browse all analyses", exact: true }).click();
    await analyze.locator('[data-method="ttest"]').click();
    await analyze.locator("button.btn", { hasText: /^Run$/ }).click();
    await expect(analyze).toHaveCount(0);

    // --- the picker lists all of it
    await page.click('button[title*="Ctrl+S"]');
    await page.waitForSelector(DIALOG);
    const kinds = (await page.$$eval(`${DIALOG} .saverow .savekind`, (els) => els.map((e) => e.textContent ?? ""))).sort();
    expect(kinds, "rows in the picker, by kind").toEqual(["data", "data", "figure", "graph", "graph", "result"]);
    await expect(page.locator(`${DIALOG} input[aria-label="Experiment 2"]`)).toHaveCount(1);
    const confirm = page.locator(`${DIALOG} button.btn`);
    await expect(confirm).toHaveText("Save this project folder…");
    await confirm.click();
    await expect(page.locator(DIALOG)).toHaveCount(0);

    // --- what landed on disk
    await expect.poll(() => written).not.toBe("");
    expect(written.endsWith("Project_2.mady")).toBe(true);
    const file = JSON.parse(readFileSync(written, "utf8")) as SavedFile & {
      analyses: { id: string; name: string }[];
      layouts?: { id: string; name: string }[];
    };
    expect(file.workspace.folders.map((f) => f.name)).toEqual(["Project 2"]);
    expect(file.workspace.folders[0]!.experiments.map((e) => e.name)).toEqual(["Experiment 1", "Experiment 2"]);
    expect([file.tables.length, file.plots.length, file.analyses.length, (file.layouts ?? []).length]).toEqual([2, 2, 1, 1]);

    // --- a fresh app (no bridge, no stub) opens the file through the browser file input
    const fresh = await context.newPage();
    await collectErrors(fresh);
    const app2 = new MadyApp(fresh);
    await fresh.goto("/");
    await fresh.waitForSelector(".nav");
    const [chooser] = await Promise.all([fresh.waitForEvent("filechooser"), fresh.click(OPEN_BTN)]);
    await chooser.setFiles(written);
    await fresh.waitForSelector("svg.gfx-figure");
    await app2.expandTree();

    const nav2 = fresh.locator(".nav");
    const rowsOf = (kind: string) => nav2.locator(".navrow", { has: fresh.locator(`button[title="Delete ${kind}"]`) });
    const rowText = await nav2.locator(".navrow").allTextContents();
    for (const name of ["Project 2", "Experiment 1", "Experiment 2"]) expect(rowText.map((t) => t.trim()), `"${name}" missing from the reopened tree`).toContain(name);
    expect(rowText.some((t) => t.includes("Demo Project")), "the file carried the demo it was not asked to").toBe(false);
    await expect(rowsOf("table")).toHaveCount(2);
    await expect(rowsOf("plot")).toHaveCount(2);
    await expect(rowsOf("analysis")).toHaveCount(1);
    await expect(rowsOf("layout")).toHaveCount(1);

    // each piece opens from its own row (a new sheet and its graph share a name, so go by row kind)
    for (let i = 0; i < 2; i++) {
      await rowsOf("table").nth(i).locator("button.navlabelbtn").click();
      await expect(fresh.locator(".canvas .dg"), `datasheet #${i + 1} did not open`).toHaveCount(1);
    }
    for (let i = 0; i < 2; i++) {
      await rowsOf("plot").nth(i).locator("button.navlabelbtn").click();
      await expect(fresh.locator(".canvas svg.gfx-figure"), `graph #${i + 1} did not draw`).toHaveCount(1);
    }
    await rowsOf("analysis").first().locator("button.navlabelbtn").click();
    await expect(fresh.locator(".canvas .anhead-title")).toHaveText(file.analyses[0]!.name);
    await rowsOf("layout").first().locator("button.navlabelbtn").click();
    await expect(fresh.locator(".layoutview-title")).toContainText(file.layouts![0]!.name);
    expect(await app2.consoleErrors()).toEqual([]);
  });

  test("one experiment → its own project file, siblings left out", async ({ page }) => {
    await collectErrors(page);
    const dir = mkdtempSync(join(tmpdir(), "mady-save-exp-"));
    let written = "";
    await page.exposeBinding("__e2eSave", async (_src, json: string, name: string) => {
      written = join(dir, `${name.replace(/[^\w.-]+/g, "_")}.mady`);
      writeFileSync(written, json, "utf8");
      return { ok: true, path: written };
    });
    await page.addInitScript(() => {
      const w = window as unknown as { mady: unknown; __e2eSave: (j: string, n: string) => Promise<unknown> };
      w.mady = { saveProject: (json: string, name: string) => w.__e2eSave(json, name) };
    });

    const app = new MadyApp(page);
    await app.open();

    await page.click(SAVE_BTN);
    await page.waitForSelector(DIALOG);
    await page.click(`${DIALOG} button[aria-label="Expand Demo Project"]`); // the picker starts collapsed + unticked
    await page.click(`${DIALOG} input[aria-label="Experiment 1"]`); // tick exactly one experiment
    const confirm = page.locator(`${DIALOG} button.btn`);
    await expect(confirm).toHaveText("Save this experiment…");
    await confirm.click();

    await expect.poll(() => written).not.toBe("");
    expect(written.endsWith("Experiment_1.mady")).toBe(true); // named after what was saved
    const file = JSON.parse(readFileSync(written, "utf8")) as SavedFile;
    expect(file.plots.map((p) => p.name).sort()).toEqual(["Dose-response", "Gene expression heatmap"]);
    expect(file.tables.map((t) => t.name).sort()).toEqual(["Gene expression", "Sample — dose vs response"]);
    expect(file.workspace.folders.map((f) => f.name)).toEqual(["Demo Project"]);
    expect(file.workspace.folders[0]!.experiments.map((e) => e.name)).toEqual(["Experiment 1"]);

    // the live document is untouched — saving a part is not "save as"
    const live = (await app.project()) as unknown as SavedFile;
    expect(live.plots.length).toBeGreaterThan(5);
    expect(await app.consoleErrors()).toEqual([]);
  });
});
