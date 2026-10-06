import { _electron as electron, expect, test } from "@playwright/test";
import type { ElectronApplication, Page } from "@playwright/test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Closing and crash recovery, in the real app: when MadY asks "Save changes before closing?",
 * and when the next launch offers to recover unsaved work.
 *
 * The demo project MadY opens with is for looking around: closing it asks nothing and leaves
 * nothing to recover. The user's own work is protected: closing asks; a crash leaves a
 * copy the next launch offers back; Don't Save discards it for good, so the next launch does not
 * offer it back.
 *
 * Only the operating system's own dialogs are replaced, inside the main process: the unsaved-
 * changes box answers Don't Save and records that it was asked (in a file, since the app is gone
 * once it closes), and the file picker opens a fixed project. The app runs with its own profile
 * folder under build/, never a user's.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
// The app folder, not its built main file: Electron then reads the folder's package.json and the
// app path is apps/desktop, as in a dev run — the statistics engine and the manual are found from it.
const APP_DIR = resolve(HERE, "../apps/desktop");
const ELECTRON_EXE = resolve(HERE, "../node_modules/electron/dist/electron.exe");
const PROFILE_DIR = resolve(HERE, "../build/e2e-electron-close-profile");
const ASKED = join(PROFILE_DIR, "asked-to-save.txt");
const USER_PROJECT = join(PROFILE_DIR, "my-project.mady");
const RECOVERY = '[role="dialog"][aria-label="Recover unsaved work"]';

test.describe.configure({ mode: "serial" });

async function launch(): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await electron.launch({ executablePath: ELECTRON_EXE, args: [APP_DIR], env: { ...process.env, MADY_PROFILE_DIR: PROFILE_DIR } });
  expect(resolve(await app.evaluate(({ app: a }) => a.getPath("userData")))).toBe(PROFILE_DIR);
  let page = await app.firstWindow();
  while (!page.url().includes("index.html")) {
    const existing = app.windows().find((w) => w.url().includes("index.html"));
    page = existing ?? (await app.waitForEvent("window"));
  }
  await page.waitForSelector(".nav", { timeout: 60_000 });
  // The unsaved-changes box: answer Don't Save, and write down that it was asked.
  await app.evaluate(({ dialog }, asked) => {
    const fs = process.getBuiltinModule("node:fs");
    dialog.showMessageBox = (async () => {
      fs.writeFileSync(asked, "asked");
      return { response: 1, checkboxChecked: false };
    }) as typeof dialog.showMessageBox;
  }, ASKED);
  return { app, page };
}

/** Whether this launch offers to recover unsaved work. */
async function offersRecovery(page: Page): Promise<boolean> {
  return page.locator(RECOVERY).waitFor({ timeout: 6_000 }).then(() => true, () => false);
}

async function menu(page: Page, name: string, item: RegExp): Promise<void> {
  await page.locator(".menubar .menu", { hasText: new RegExp(`^${name}$`) }).click();
  await page.locator(".dropdown .dropitem", { hasText: item }).first().click();
}

/** Close the window the way a user does, and report whether the save question came up. */
async function closeAndAsked(app: ElectronApplication): Promise<boolean> {
  rmSync(ASKED, { force: true });
  await app.close();
  return existsSync(ASKED);
}

/** Let the debounced crash copy be written (1.5 s after the last change). */
const settle = (page: Page) => page.waitForTimeout(2_500);

test.beforeAll(() => {
  rmSync(PROFILE_DIR, { recursive: true, force: true });
  mkdirSync(PROFILE_DIR, { recursive: true });
});

test("the demo, looked around in: closing asks nothing, and nothing is offered back", async () => {
  const { app, page } = await launch();
  expect(await offersRecovery(page), "a fresh profile has nothing to recover").toBe(false);
  await menu(page, "Graph", /^Chart gallery/);
  await page.locator(".gallerycard").first().click();
  await page.waitForSelector("svg.gfx-figure");
  await settle(page);
  expect(await closeAndAsked(app), "closing the demo must not ask to save it").toBe(false);
  const again = await launch();
  expect(await offersRecovery(again.page), "the demo must not be offered back").toBe(false);
  await again.app.close();
});

test("the user's own datasheet: closing asks; Don't Save means it is not offered back", async () => {
  const { app, page } = await launch();
  await menu(page, "Insert", /^New datasheet \(XY\)/);
  await settle(page);
  expect(await closeAndAsked(app), "closing the user's work must ask to save it").toBe(true);
  const again = await launch();
  expect(await offersRecovery(again.page), "work the user chose not to save must not come back").toBe(false);
  await again.app.close();
});

test("the user's own datasheet and a crash: the next launch offers it back", async () => {
  const { app, page } = await launch();
  await menu(page, "Insert", /^New datasheet \(XY\)/);
  await settle(page);
  app.process().kill(); // a crash: no close, no quit handlers
  const again = await launch();
  expect(await offersRecovery(again.page), "the crashed session's work must be offered back").toBe(true);
  await again.page.locator(RECOVERY).locator("button", { hasText: "Discard" }).click();
  await again.app.close();
});

test("a crash copy holding only the demo, left by an earlier session: not offered, and removed", async () => {
  const first = await launch();
  const demo = await liveProject(first.page);
  await first.app.close();
  const copy = join(PROFILE_DIR, "autosave.json");
  writeFileSync(copy, JSON.stringify({ v: 1, savedAt: Date.now(), name: "Demo Project", json: JSON.stringify(demo) }));
  const { app, page } = await launch();
  expect(await offersRecovery(page), "a copy of the demo alone must not be offered back").toBe(false);
  await expect.poll(() => existsSync(copy), { message: "the demo copy is removed" }).toBe(false);
  await app.close();
});

test("the user's own datasheet and a crash: Recover brings it back", async () => {
  const { app, page } = await launch();
  const before = new Set((await liveProject(page)).tables.map((t) => t.id));
  await menu(page, "Insert", /^New datasheet \(XY\)/);
  const mine = (await liveProject(page)).tables.find((t) => !before.has(t.id))!;
  expect(mine, "the new datasheet").toBeTruthy();
  await settle(page);
  app.process().kill();
  const again = await launch();
  expect(await offersRecovery(again.page), "the user's work must be offered back").toBe(true);
  await again.page.locator(RECOVERY).locator("button", { hasText: /^Recover$/ }).click();
  await expect.poll(async () => (await liveProject(again.page)).tables.some((t) => t.id === mine.id), { message: "the datasheet came back" }).toBe(true);
  expect(await closeAndAsked(again.app), "recovered work is the user's: closing asks").toBe(true);
});

test("a project of the user's, opened from its file: any change asks on closing", async () => {
  // The user's project on disk: the demo with one datasheet of their own, saved as a .mady.
  const first = await launch();
  await menu(first.page, "Insert", /^New datasheet \(XY\)/);
  await expect(first.page.locator(".savedot"), "the user's datasheet shows as unsaved").toHaveCount(1);
  await first.app.evaluate(({ dialog }, path) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: path }); }, USER_PROJECT);
  await first.page.keyboard.press("Control+s");
  // Save everything: the dialog leaves the demo project unticked, and a partial save keeps the
  // document unsaved by design (the file does not hold all of it).
  const dlg = first.page.locator('[role="dialog"][aria-label="Save project"]');
  for (const box of await dlg.locator('input[type="checkbox"]').all()) if (!(await box.isChecked())) await box.check();
  await expect(dlg.locator(".modalbtns button.btn")).toHaveText(/Save everything/);
  await dlg.locator(".modalbtns button.btn").click();
  await expect.poll(() => existsSync(USER_PROJECT), { timeout: 15_000 }).toBe(true);
  // The save is done when the app says so (the toolbar's unsaved dot goes), not when the file appears.
  await expect(first.page.locator(".savedot")).toHaveCount(0);
  expect(await closeAndAsked(first.app), "just saved: nothing to ask").toBe(false);

  const { app, page } = await launch();
  await app.evaluate(({ dialog }, path) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] }); }, USER_PROJECT);
  await page.keyboard.press("Control+o");
  await expect.poll(async () => page.locator(".nav").innerText(), { timeout: 15_000 }).toContain("Data");
  // A change inside the opened project's demo folder: it is the user's file now, so it counts.
  await menu(page, "Graph", /^Chart gallery/);
  await page.locator(".gallerycard").first().click();
  await page.waitForSelector("svg.gfx-figure");
  await settle(page);
  expect(await closeAndAsked(app), "a change to the user's opened project must ask").toBe(true);
});

/** The live project, read off the app through React (the app exposes no test hook). */
interface LiveProject {
  tables: { id: string; name: string; columns: { id: string; name: string }[]; rows: { cells: Record<string, unknown> }[] }[];
  plots: { id: string; name: string; source: string; kind?: string; fit?: { analysisSource?: string; analysisResultVersion?: number; points: [number, number][] } }[];
  analyses: { id: string; name: string; method: string; source: string; status: string; error?: string; resultVersion?: number; result?: unknown }[];
}

async function liveProject(page: Page): Promise<LiveProject> {
  return page.evaluate(() => {
    const r = document.getElementById("root") as unknown as Record<string, { stateNode?: { current?: unknown } }>;
    const k = Object.keys(r).find((x) => x.startsWith("__reactContainer"))!;
    let hit: unknown = null;
    const seen = new Set<unknown>();
    const go = (n: { memoizedProps?: { project?: { tables?: unknown; plots?: unknown } }; child?: unknown; sibling?: unknown } | null, d: number): void => {
      if (!n || d > 120 || hit || seen.has(n)) return;
      seen.add(n);
      const p = n.memoizedProps;
      if (p?.project?.tables && p.project.plots) { hit = p.project; return; }
      go(n.child as never, d + 1); go(n.sibling as never, d);
    };
    go((r[k] as { stateNode: { current: never } }).stateNode.current, 0);
    return JSON.parse(JSON.stringify(hit));
  });
}

async function saveEverything(app: ElectronApplication, page: Page, path: string): Promise<void> {
  rmSync(path, { force: true });
  await app.evaluate(({ dialog }, p) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: p }); }, path);
  await menu(page, "File", /^Save…/);
  const dlg = page.locator('[role="dialog"][aria-label="Save project"]');
  for (const box of await dlg.locator('input[type="checkbox"]').all()) if (!(await box.isChecked())) await box.check();
  await dlg.locator(".modalbtns button.btn", { hasText: /Save everything/ }).click();
  await expect.poll(() => existsSync(path), { timeout: 15_000 }).toBe(true);
  await expect(page.locator(".savedot")).toHaveCount(0);
}

/** Least-squares line through the points, computed here and not by the engine. */
function leastSquares(points: [number, number][]): { slope: number; intercept: number } {
  const n = points.length;
  const mx = points.reduce((s, p) => s + p[0], 0) / n;
  const my = points.reduce((s, p) => s + p[1], 0) / n;
  const sxy = points.reduce((s, p) => s + (p[0] - mx) * (p[1] - my), 0);
  const sxx = points.reduce((s, p) => s + (p[0] - mx) ** 2, 0);
  const slope = sxy / sxx;
  return { slope, intercept: my - slope * mx };
}

/** Every point of the drawn fit lies on the least-squares line of the data (the engine sends
 *  curve points rounded to 6 decimals, so they are compared to 4). */
function expectOnLine(fit: [number, number][], data: [number, number][], what: string): void {
  const { slope, intercept } = leastSquares(data);
  expect(fit.length, `${what}: the fitted line has points`).toBeGreaterThanOrEqual(2);
  for (const [x, y] of fit) expect(y, `${what}: the fit at x = ${x}`).toBeCloseTo(intercept + slope * x, 4);
}

test("a new graph and an analysis of new data are saved, and the file opens back with the same data, graph and analysis", async () => {
  test.setTimeout(240_000);
  const csv = join(PROFILE_DIR, "enzyme-assay.csv");
  const rows: [number, number][] = [[0.5, 3.1], [1, 5.8], [2, 10.4], [4, 17.9], [8, 26.2], [16, 33.0]];
  writeFileSync(csv, "Substrate (mM),Velocity (uM/min)\n" + rows.map((r) => r.join(",")).join("\n") + "\n", "utf8");
  const saved = join(PROFILE_DIR, "enzyme-project.mady");

  // Make it: import the data, draw a graph of it, run a linear regression on it, save everything.
  const first = await launch();
  await first.app.evaluate(({ dialog }, p) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] }); }, csv);
  await menu(first.page, "File", /^Import data…/);
  const imp = first.page.locator('[role="dialog"][aria-label="Import data"]');
  await expect(imp).toBeVisible();
  await imp.locator("button.btn", { hasText: /Import|Add/ }).first().click();
  await menu(first.page, "Graph", /^New graph of this data/);
  // The New graph dialog opens on the data's own format (XY) and graph; the user creates it.
  await first.page.locator('[role="dialog"] button', { hasText: /^Create graph$/ }).click();
  await first.page.waitForSelector("svg.gfx-figure");
  const made = await liveProject(first.page);
  const table = made.tables.find((t) => t.name.includes("enzyme-assay"))!;
  expect(table, "the imported datasheet").toBeTruthy();
  const graph = made.plots.find((p) => p.source === table.id)!;
  expect(graph, "a graph of the new data").toBeTruthy();

  // Analyze → Browse all analyses → Linear regression → Run, with the graph on screen. The
  // statistics engine computes it, and the fitted line lands on the graph.
  await first.page.locator('button[title^="Analyze"]').click();
  const an = first.page.locator('[role="dialog"][aria-label="Analyze"]');
  await an.locator("button", { hasText: /^Browse all analyses$/ }).click();
  await an.locator('button[data-method="regression"]').click();
  await an.locator(".modalbtns button.btn", { hasText: /^Run$/ }).click();
  await expect.poll(async () => (await liveProject(first.page)).analyses.find((a) => a.source === table.id)?.status ?? "none",
    { timeout: 60_000, message: "the regression of the new data finishes" }).not.toMatch(/^(none|stale)$/);
  const fitted = await liveProject(first.page);
  const analysis = fitted.analyses.find((a) => a.source === table.id)!;
  expect({ status: analysis.status, error: analysis.error }, "the engine computed the regression").toEqual({ status: "ok", error: undefined });
  expect(analysis.method).toBe("regression");
  const fit = fitted.plots.find((p) => p.id === graph.id)!.fit;
  expect(fit?.analysisSource, "the fitted line on the graph comes from the analysis").toBe(analysis.id);
  expectOnLine(fit!.points, rows, "after the run");
  await first.page.locator("button.navlabelbtn", { hasText: graph.name }).first().click();
  await expect(first.page.locator("svg.gfx-figure .gfx-fit").first(), "the fitted line is drawn").toBeVisible();

  await saveEverything(first.app, first.page, saved);
  await first.app.close();

  // The file holds the data, the graph with its fitted line, and the analysis with its result.
  const file = JSON.parse(readFileSync(saved, "utf8")) as typeof made;
  const ft = file.tables.find((t) => t.id === table.id)!;
  expect(ft.rows.map((r) => ft.columns.map((c) => r.cells[c.id]))).toEqual(rows);
  expect(file.plots.find((p) => p.id === graph.id)?.source).toBe(table.id);
  const fa = file.analyses.find((a) => a.id === analysis.id)!;
  expect(fa, "the analysis is in the file").toBeTruthy();
  expect({ status: fa.status, method: fa.method, source: fa.source }).toEqual({ status: "ok", method: "regression", source: table.id });
  expect(fa.result, "the analysis result is in the file").toEqual(analysis.result);
  expect(file.plots.find((p) => p.id === graph.id)?.fit, "the fitted line is in the file").toEqual(fit);

  // Open it in a new session: the same data, the same graph, and it draws.
  const { app, page } = await launch();
  await app.evaluate(({ dialog }, p) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] }); }, saved);
  await menu(page, "File", /^Open…/);
  await expect.poll(async () => (await liveProject(page)).plots.some((p) => p.id === graph.id), { timeout: 20_000 }).toBe(true);
  await page.waitForTimeout(1500);
  await expect(page.locator(".savedot"), "a project just opened is not unsaved").toHaveCount(0, { timeout: 2_000 });
  const loaded = await liveProject(page);
  const lt = loaded.tables.find((t) => t.id === table.id)!;
  expect(lt.rows.map((r) => lt.columns.map((c) => r.cells[c.id])), "the data came back as saved").toEqual(rows);
  const lp = loaded.plots.find((p) => p.id === graph.id)!;
  expect({ name: lp.name, source: lp.source, kind: lp.kind }).toEqual({ name: graph.name, source: graph.source, kind: graph.kind });
  await page.locator("button.navlabelbtn", { hasText: graph.name }).first().click().catch(() => {});
  await expect(page.locator("svg.gfx-figure").first(), "the reopened graph draws").toBeVisible();
  expect(await page.locator("svg.gfx-figure .gfx-mark, svg.gfx-figure circle").count(), "its points are drawn").toBeGreaterThanOrEqual(rows.length);

  // The analysis came back with its result, still current, and its fitted line is drawn.
  const la = loaded.analyses.find((a) => a.id === analysis.id)!;
  expect(la, "the analysis came back").toBeTruthy();
  expect({ status: la.status, resultVersion: la.resultVersion }, "the analysis is current after Open").toEqual({ status: "ok", resultVersion: fa.resultVersion });
  expect(la.result, "the analysis result came back as saved").toEqual(fa.result);
  expect(lp.fit, "the fitted line came back as saved").toEqual(fit);
  expectOnLine(lp.fit!.points, lt.rows.map((r) => lt.columns.map((c) => r.cells[c.id]) as [number, number]), "after Open");
  await expect(page.locator("svg.gfx-figure .gfx-fit").first(), "the reopened graph draws its fitted line").toBeVisible();
  await expect(page.locator(".stalenote"), "the reopened graph is not marked out of date").toHaveCount(0);
  await page.locator("button.navlabelbtn", { hasText: analysis.name }).first().click();
  await expect(page.locator(".anhead-title"), "the reopened analysis opens in its tab").toHaveText(analysis.name);
  await expect(page.locator(".anhead .badge"), "the reopened analysis shows no 'source changed' or 'error' badge").toHaveCount(0);

  // Saved again unchanged, the file is the same project.
  const again = join(PROFILE_DIR, "enzyme-project-again.mady");
  await saveEverything(app, page, again);
  const second = JSON.parse(readFileSync(again, "utf8")) as typeof made;
  expect(second.tables, "tables after a load and a save").toEqual(file.tables);
  expect(second.plots, "graphs after a load and a save").toEqual(file.plots);
  expect(second.analyses, "analyses after a load and a save").toEqual(file.analyses);
  expect(await closeAndAsked(app), "just opened and saved: nothing to ask").toBe(false);
});
