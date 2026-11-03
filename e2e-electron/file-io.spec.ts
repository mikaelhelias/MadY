import { _electron as electron, expect, test } from "@playwright/test";
import type { ElectronApplication, Page } from "@playwright/test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// ESM spec: no __dirname, so it is derived from import.meta.url.
const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * The Electron tests: what the browser harness structurally cannot verify, verified in the
 * real app: the shipped preload bridge (`window.mady`), real IPC, the real main-process
 * handlers (`atomicWrite`, `readAnyFile`, the CSV decoder), and real files on a real disk.
 *
 * The only stubbed part is `dialog.showSaveDialog` / `showOpenDialog` inside the main
 * process: those show the operating system's own dialog, which automation cannot reliably
 * click. The stub replaces exactly the OS picker and nothing else — every byte on both
 * sides of it (renderer → IPC → main → disk, and back) is the shipped code.
 *
 * The app runs with its own profile folder (`MADY_PROFILE_DIR`, under the repository's build/),
 * so it never touches a user's profile. A save/open here adds temp paths to its
 * recents.json; the suite snapshots it on launch and restores it on close, so later runs do not
 * inherit those paths.
 */

// The app folder, not its built main file: Electron then reads the folder's package.json and the
// app path is apps/desktop, as in a dev run — the statistics engine and the manual are found from it.
const APP_DIR = resolve(HERE, "../apps/desktop");
const ELECTRON_EXE = resolve(HERE, "../node_modules/electron/dist/electron.exe");
const PROFILE_DIR = resolve(HERE, "../build/e2e-electron-profile");
/** The files these tests save, open and import: under the repository's build/, not the system temp folder. */
const FILES_DIR = resolve(HERE, "../build/e2e-electron-files");

let app: ElectronApplication;
let page: Page;
let recentsPath = "";
let recentsBefore: string | null = null;

test.beforeAll(async () => {
  test.setTimeout(180_000);
  mkdirSync(FILES_DIR, { recursive: true });
  app = await electron.launch({ executablePath: ELECTRON_EXE, args: [APP_DIR], env: { ...process.env, MADY_PROFILE_DIR: PROFILE_DIR } });
  // Snapshot recents.json so the fake temp paths this suite saves/opens don't stay behind.
  // The built main process is ESM — no `require` in evaluate. Join the path on the test side.
  const userData = await app.evaluate(({ app: a }) => a.getPath("userData"));
  // Stop before touching anything if the profile is not the suite's own.
  expect(resolve(userData)).toBe(PROFILE_DIR);
  recentsPath = join(userData, "recents.json");
  recentsBefore = existsSync(recentsPath) ? readFileSync(recentsPath, "utf8") : null;
  // The app shows a splash window first; firstWindow() hands that one back and it closes as
  // the main window appears — "Target closed". Wait for the real renderer window.
  page = await app.firstWindow();
  while (!page.url().includes("index.html")) {
    const existing = app.windows().find((w) => w.url().includes("index.html"));
    page = existing ?? (await app.waitForEvent("window"));
  }
  await page.waitForSelector(".nav", { timeout: 60_000 });
  // A run that was killed leaves an autosave in this launch's profile, and the next launch asks
  // to recover it — over the whole window, and a click on the backdrop does not dismiss it. The
  // tests start from the fresh demo project, so set the leftover aside. (This launch has its own
  // profile folder, not the one `npm run dev` or the installed app uses.)
  const recovery = page.locator('[role="dialog"][aria-label="Recover unsaved work"]');
  if (await recovery.waitFor({ timeout: 5_000 }).then(() => true, () => false)) {
    await recovery.locator("button", { hasText: "Discard" }).click();
  }
});

test.afterAll(async () => {
  if (recentsBefore !== null) writeFileSync(recentsPath, recentsBefore, "utf8");
  // The tests leave unsaved changes, so closing puts up the OS's own "Save / Don't Save / Cancel"
  // box, which no automation can press — the close then hangs, the run is killed, and the next
  // launch finds an autosave to recover. Answer it the way the file pickers are answered: in the
  // main process, "Don't Save" (the tests' changes are throwaway).
  await app?.evaluate(({ dialog }) => {
    dialog.showMessageBox = (async () => ({ response: 1, checkboxChecked: false })) as typeof dialog.showMessageBox;
  }).catch(() => {});
  await app?.close();
});

/** Point both native dialogs at fixed paths, inside the real main process. */
async function aimDialogs(savePath: string | null, openPath: string | null): Promise<void> {
  await app.evaluate(({ dialog }, { savePath: sp, openPath: op }) => {
    if (sp !== null) dialog.showSaveDialog = async () => ({ canceled: false, filePath: sp });
    if (op !== null) dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [op] });
  }, { savePath, openPath });
}

/** Whatever modal is up, name it in the log and close it — a stray dialog must never make
 *  the next test's failure unreadable. */
async function clearModals(): Promise<void> {
  for (let i = 0; i < 3; i++) {
    const ov = page.locator(".modalov").last();
    if (!(await ov.count())) return;
    const label = await ov.locator('[role="dialog"]').first().getAttribute("aria-label").catch(() => null);
    console.log(`[e2e] closing a stray modal: ${label ?? "(unlabelled)"}`);
    await ov.click({ position: { x: 4, y: 4 } }).catch(() => {});
    await page.waitForTimeout(200);
  }
}

async function menu(m: string, item: string): Promise<void> {
  await clearModals();
  await page.locator(".menubar .menu", { hasText: new RegExp(`^${m}$`) }).click();
  const target = page.locator(".dropdown .dropitem", { hasText: item }).first();
  await target.click();
}

test.describe("the real app, the real disk", () => {
  test("the shipped preload bridge is present — no stub anywhere", async () => {
    const keys = await page.evaluate(() => Object.keys((window as unknown as { mady: object }).mady ?? {}));
    expect(keys, "window.mady is missing — this is not the real preload").toContain("saveProject");
    expect(keys).toContain("openFile");
    expect(keys).toContain("exportFile");
  });

  test("File → Save → Save everything writes a real .mady through real IPC + atomicWrite", async () => {
    const dir = mkdtempSync(join(FILES_DIR, "mady-el-save-"));
    const out = join(dir, "whole.mady");
    await aimDialogs(out, null);

    await menu("File", "Save…");
    // The demo project starts unticked in the picker (so a first save is never the demo by
    // accident): tick it, and the button offers the whole project.
    const dlg = page.locator('[role="dialog"][aria-label="Save project"]');
    await dlg.locator('input[aria-label="Demo Project"]').click();
    await dlg.locator("button.btn", { hasText: "Save everything" }).click();
    await expect.poll(() => existsSync(out), { timeout: 15_000 }).toBe(true);

    const file = JSON.parse(readFileSync(out, "utf8")) as { tables: unknown[]; plots: unknown[]; schemaVersion: unknown };
    expect(file.tables.length, "the saved project has no tables").toBeGreaterThan(5);
    expect(file.plots.length, "the saved project has no plots").toBeGreaterThan(5);
    expect(file.schemaVersion, "no schemaVersion — migrate() could never load this").toBeTruthy();
  });

  test("saving one graph through the picker writes a file that carries its datasheet", async () => {
    const dir = mkdtempSync(join(FILES_DIR, "mady-el-part-"));
    const out = join(dir, "one-graph.mady");
    await aimDialogs(out, null);

    await menu("File", "Save…");
    const dlg = page.locator('[role="dialog"][aria-label="Save project"]');
    // The demo project starts unticked and collapsed: open it, then tick the one graph.
    await dlg.locator('button[aria-label="Expand Demo Project"]').click();
    await dlg.locator('input[aria-label="Treatment bar chart"]').click();
    await expect(dlg.locator("button.btn")).toHaveText("Save this graph…");
    await dlg.locator("button.btn").click();
    await expect.poll(() => existsSync(out), { timeout: 15_000 }).toBe(true);

    const file = JSON.parse(readFileSync(out, "utf8")) as { tables: { name: string; rows: unknown[] }[]; plots: { name: string }[] };
    expect(file.plots.map((p) => p.name)).toEqual(["Treatment bar chart"]);
    expect(file.tables.map((t) => t.name)).toEqual(["Treatment means"]);
    expect(file.tables[0]!.rows.length, "the data did not travel with the graph").toBeGreaterThan(0);
  });

  test("File → Open reads that file back through the real readAnyFile + migrate", async () => {
    const dir = mkdtempSync(join(FILES_DIR, "mady-el-open-"));
    const out = join(dir, "roundtrip.mady");
    await aimDialogs(out, out);

    // Save one graph, then open the file — the app becomes that one-graph project.
    await menu("File", "Save…");
    const dlg = page.locator('[role="dialog"][aria-label="Save project"]');
    await dlg.locator('button[aria-label="Expand Demo Project"]').click();
    await dlg.locator('input[aria-label="Dose-response"]').click();
    await dlg.locator("button.btn").click();
    await expect.poll(() => existsSync(out), { timeout: 15_000 }).toBe(true);

    await menu("File", "Open…");
    await page.waitForSelector("svg.gfx-figure", { timeout: 20_000 });
    // The tree opens folded — unfold every chevron so the labels exist (same loop as e2e/app.ts).
    for (let pass = 0; pass < 6; pass++) {
      const opened = await page.evaluate(() => {
        const collapsed = [...document.querySelectorAll("button.twist")].filter((t) => t.querySelector("svg.lucide-chevron-right"));
        for (const t of collapsed) (t as HTMLElement).click();
        return collapsed.length;
      });
      if (!opened) break;
      await page.waitForTimeout(150);
    }
    const labels = await page.$$eval("button.navlabelbtn", (b) => b.map((x) => (x.textContent ?? "").trim()));
    expect(labels).toContain("Dose-response");
    expect(labels).not.toContain("Treatment bar chart"); // the rest of the demo did not come along
  });

  test("File → Import data parses a real CSV through the main-process decoder", async () => {
    const dir = mkdtempSync(join(FILES_DIR, "mady-el-csv-"));
    const csv = join(dir, "assay.csv");
    writeFileSync(csv, "Conc,Signal\n1,10\n2,42\n5,88\n", "utf8");
    await aimDialogs(null, csv);

    await menu("File", "Import data…");
    const dlg = page.locator('[role="dialog"][aria-label="Import data"]');
    await expect(dlg, "the import preview never appeared").toBeVisible();
    await expect(dlg.locator("text=Signal").first()).toBeVisible(); // the header was parsed
    await dlg.locator("button.btn", { hasText: /Import|Add/ }).first().click();

    const added = await page.evaluate(() => {
      // the freshly imported table is the newest; read it off the document via the fiber
      const r = document.getElementById("root") as unknown as Record<string, { stateNode?: { current?: unknown } }>;
      const k = Object.keys(r).find((x) => x.startsWith("__reactContainer"))!;
      let hit: { tables: { name: string; rows: unknown[] }[] } | null = null;
      const seen = new Set<unknown>();
      const go = (n: { memoizedProps?: { project?: { tables: { name: string; rows: unknown[] }[]; plots: unknown } }; child?: unknown; sibling?: unknown } | null, d: number): void => {
        if (!n || d > 120 || hit || seen.has(n)) return;
        seen.add(n);
        const p = n.memoizedProps;
        if (p?.project?.tables && p.project.plots) { hit = p.project; return; }
        go(n.child as never, d + 1); go(n.sibling as never, d);
      };
      go((r[k] as { stateNode: { current: never } }).stateNode.current, 0);
      const t = hit!.tables.at(-1)!;
      return { name: t.name, rows: t.rows.length };
    });
    expect(added.name, "the imported table did not land").toContain("assay");
    expect(added.rows, "the CSV's rows did not survive the trip").toBe(3);
  });

  test("File → Export writes a real SVG of the active graph to disk", async () => {
    const dir = mkdtempSync(join(FILES_DIR, "mady-el-svg-"));
    const out = join(dir, "graph.svg");
    await aimDialogs(out, null);

    // The previous test leaves the imported table active — Export would export data. Put a
    // graph on screen (the one-graph project holds Dose-response) so an SVG is what exports.
    await clearModals();
    for (let pass = 0; pass < 6; pass++) {
      const opened = await page.evaluate(() => {
        const collapsed = [...document.querySelectorAll("button.twist")].filter((t) => t.querySelector("svg.lucide-chevron-right"));
        for (const t of collapsed) (t as HTMLElement).click();
        return collapsed.length;
      });
      if (!opened) break;
      await page.waitForTimeout(150);
    }
    await page.locator("button.navlabelbtn", { hasText: "Dose-response" }).first().click();
    await page.waitForSelector("svg.gfx-figure");
    await menu("File", "Export…");
    const dlg = page.locator('[role="dialog"][aria-label="Export"]');
    await expect(dlg).toBeVisible();
    // The button names the chosen format ("Export PNG…"); pick SVG, the file this test checks.
    await dlg.locator('select[aria-label="Format"]').selectOption("svg");
    await dlg.locator("button", { hasText: /^Export SVG/ }).first().click();
    await expect.poll(() => existsSync(out), { timeout: 20_000 }).toBe(true);
    const svg = readFileSync(out, "utf8");
    expect(svg.startsWith("<svg") || svg.startsWith("<?xml"), "the exported file is not an SVG").toBe(true);
    expect(svg.length, "the exported SVG is empty").toBeGreaterThan(5_000);
  });
});
