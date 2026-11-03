import { basename, extname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { cpus, release, totalmem } from "node:os";
import { decodeTextBuffer } from "./textDecode";
import { mkdirSync, watch, type FSWatcher } from "node:fs";
import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, nativeImage, shell } from "electron";
import log from "electron-log/main";
import { atomicWrite } from "./atomicWrite";
import { zipSync } from "./zip";
import {
  clearSnapshot,
  clearSnapshotSync,
  readSnapshot,
  writeSnapshot,
  type AutosaveSnapshot,
} from "./autosave";
import { buildWorkbook, readLegacyWorkbook, readWorkbook } from "./excel";
import { payloadToBuffer, writeExportBatch, type ExportPayloadLike } from "./exportMany";
import { PZFX_IMPORT_NOTICE, readPzfxFile } from "./pzfx";
import { readLibrary, readLibraryFile, readTextFiles, writeLibrary, type UserLibrary } from "./userLibrary";
import { startLiveAgent } from "./liveAgent";
import { listServerModels, probeModelSidecar, pullModel } from "@mady/core";
import { composeModelStatus, llmEnabled, readModelConfig, resolveModelSettings, writeModelConfig, type ModelConfig } from "./modelConfig";
import { compileLine, testModel } from "./modelCompile";
import { freeSpaceBytes } from "./diskSpace";
import {
  OLLAMA_BLURB,
  OLLAMA_VERSION,
  OllamaRuntime,
  installRuntime,
  runtimeAsset,
  runtimeExePath,
  runtimeInstalled,
  runtimeModelsDir,
} from "./modelRuntime";
import { SidecarError, SidecarSupervisor } from "./sidecar";
import { windowIconPath } from "./windowIcon";
import { projectPathFromArgv, projectPathFromOpenFile } from "./launchFile";
import { nativeMenuTemplate } from "./macMenu";
import { closeOutcome, unsavedChoice, unsavedPromptOptions } from "./unsavedPrompt";
import { profileDirOverride } from "./profileDir";

// A test run keeps its own profile (MADY_PROFILE_DIR), never the user's. It is set before anything
// reads a path: the log file, the one-copy lock and the crash-recovery copy all live in the profile.
const profileDir = profileDirOverride(process.env);
if (profileDir) {
  mkdirSync(profileDir, { recursive: true });
  app.setPath("userData", profileDir);
  app.setPath("sessionData", profileDir);
}

log.initialize();
log.info(`[main] MadY starting${profileDir ? ` with its profile in ${profileDir}` : ""}`);

/**
 * One MadY at a time (installed program only). A double-clicked `.mady` starts a second copy
 * of the program; that copy hands its command line to the MadY already open (the
 * `second-instance` handler below opens the file there) and leaves at once. `app.exit`, not
 * `app.quit`: the quit handlers must not run in the copy — `will-quit` clears the autosave
 * slot, which is the open MadY's crash-recovery copy.
 * Development runs take no lock, so several can run side by side.
 */
const primaryInstance = !app.isPackaged || app.requestSingleInstanceLock();
if (!primaryInstance) {
  log.info("[main] MadY is already open — handing it the command line");
  app.exit(0);
}

/**
 * Startup splash — the program name, version and credit over the brand artwork.
 *
 * Deliberately brief: it is read at a glance, not a progress bar. It stays for
 * `SPLASH_MIN_MS` and then fades, and it never outlives startup — the main window is
 * held back until the splash has had its moment, and the splash is dismissed the instant
 * the window is ready after that. If the renderer never becomes ready (a broken build,
 * a crash on boot) `SPLASH_MAX_MS` still tears it down, so a failure can never leave the
 * user staring at an undismissable image with no way back.
 */
const SPLASH_MIN_MS = 1500;
const SPLASH_MAX_MS = 8000;
const SPLASH_FADE_MS = 260;

let splashWindow: BrowserWindow | null = null;
let splashShownAt = 0;

function splashUrl(): { url: string; isFile: boolean } {
  const devUrl = process.env["ELECTRON_RENDERER_URL"];
  // `public/` is copied verbatim into the renderer output, so the same file serves both.
  if (devUrl) return { url: `${devUrl}/splash.html`, isFile: false };
  return { url: join(__dirname, "../renderer/splash.html"), isFile: true };
}

function createSplash(): void {
  const win = new BrowserWindow({
    width: 720,
    height: 480,
    show: false,
    frame: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    center: true,
    title: "MadY",
    backgroundColor: "#16123a",
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  splashWindow = win;
  win.on("closed", () => {
    if (splashWindow === win) splashWindow = null;
  });

  win.once("ready-to-show", () => {
    splashShownAt = Date.now();
    win.show();
  });

  // The page carries no script of its own (`script-src 'none'`), so the values are written
  // in from here — they are ours, never anything the user or a file supplied.
  win.webContents.on("did-finish-load", () => {
    const version = app.getVersion();
    const stamp = JSON.stringify(`Version ${version}`);
    void win.webContents
      .executeJavaScript(
        `(() => { const v = document.getElementById("version"); if (v) v.textContent = ${stamp}; })()`,
      )
      .catch((e: unknown) => log.warn(`[main] splash text injection failed: ${String(e)}`));
  });

  const { url, isFile } = splashUrl();
  const load = isFile ? win.loadFile(url) : win.loadURL(url);
  load.catch((e: unknown) => {
    // A splash that fails to load must never block startup — drop it and carry on.
    log.warn(`[main] splash failed to load (${String(e)}) — continuing without it`);
    closeSplash(true);
  });

  setTimeout(() => closeSplash(true), SPLASH_MAX_MS);
}

/** Fade the splash out and destroy it. `immediate` skips the fade (error paths). */
function closeSplash(immediate = false): void {
  const win = splashWindow;
  if (!win || win.isDestroyed()) return;
  splashWindow = null;
  if (immediate) {
    win.destroy();
    return;
  }
  const steps = 8;
  let i = 0;
  const tick = setInterval(() => {
    i += 1;
    if (win.isDestroyed()) {
      clearInterval(tick);
      return;
    }
    if (i >= steps) {
      clearInterval(tick);
      win.destroy();
      return;
    }
    win.setOpacity(1 - i / steps);
  }, SPLASH_FADE_MS / steps);
}

/** How long to keep the main window back so the splash gets its full, brief moment. */
function splashRemainingMs(): number {
  if (!splashWindow || splashWindow.isDestroyed()) return 0;
  if (splashShownAt === 0) return SPLASH_MIN_MS; // not painted yet — allow the full read
  return Math.max(0, SPLASH_MIN_MS - (Date.now() - splashShownAt));
}

function createWindow(): void {
  const window = new BrowserWindow({
    width: 1280,
    height: 800,
    show: false,
    title: "MadY",
    /**
     * The window / taskbar / Alt-Tab icon — the purple "Y". Packaged: out/renderer (the only
     * place the asar carries it). Dev: the source tree, because `npm run dev` never writes
     * out/renderer and a fresh checkout would otherwise show Electron's own icon. windowIcon.ts
     * has the full reasoning.
     */
    icon: windowIconPath({ isPackaged: app.isPackaged, mainDir: __dirname, appPath: app.getAppPath() }),
    backgroundColor: "#ffffff",
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      // --- security hardening: the renderer loads
      // untrusted data files later, so it must be isolated and sandboxed, with
      // no Node integration. The renderer never touches the OS or the sidecar
      // directly — only via the typed preload bridge / main-process IPC.
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
    },
  });

  mainWindow = window;
  allowClose = false;

  window.on("ready-to-show", () => {
    // Hold the window back only for whatever is left of the splash's brief moment, so a
    // slow start costs nothing extra and a fast one still gets a readable splash rather
    // than a flash. `splashRemainingMs()` is 0 once the splash is gone.
    const wait = splashRemainingMs();
    setTimeout(() => {
      closeSplash();
      if (window.isDestroyed()) return;
      window.show();
      log.info("[main] window shown");
    }, wait);
  });

  // Unsaved-changes guard: if the document is dirty, intercept the close and ask.
  // Save → tell the renderer to save, then close once it
  // confirms; Don't Save → close now; Cancel → stay open.
  window.on("close", (e) => {
    if (allowClose || !appDirty) return;
    e.preventDefault();
    void dialog
      .showMessageBox(window, unsavedPromptOptions("close"))
      .then(({ response }) => {
        const outcome = closeOutcome(unsavedChoice(response));
        if (outcome.clearRecovery) {
          // Don't Save discards the work: the recovery copy goes with it, and the quit treats the
          // document as clean, so the next launch does not offer back what was thrown away.
          appDirty = false;
          clearSnapshotSync(app.getPath("userData"));
        }
        if (outcome.close) {
          allowClose = true;
          window.close();
          return;
        }
        if (outcome.save) window.webContents.send("menu:action", "save-and-close"); // the renderer saves, then confirmClose
        // Cancel → stay open
      });
  });

  const devUrl = process.env["ELECTRON_RENDERER_URL"];
  const rendererOrigin = devUrl
    ? (() => {
        try {
          return new URL(devUrl).origin;
        } catch {
          return null;
        }
      })()
    : null;
  const rendererFileUrl = pathToFileURL(join(__dirname, '../renderer/index.html')).href;
  // External links open in the OS browser, never inside the app window.
  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", (event, url) => {
    let allowed = false;
    if (rendererOrigin) {
      try {
        allowed = new URL(url).origin === rendererOrigin;
      } catch {
        allowed = false;
      }
    } else {
      allowed = url.split("#", 1)[0] === rendererFileUrl;
    }
    if (!allowed) {
      event.preventDefault();
      log.warn(`[main] blocked renderer navigation to ${url}`);
    }
  });

  if (devUrl) {
    void window.loadURL(devUrl);
  } else {
    void window.loadFile(join(__dirname, "../renderer/index.html"));
  }
}

/**
 * The app has one menu bar: the in-app MenuBar next to the MadY brand (renderer `chrome.tsx`, built
 * from `actions.ts`). Electron's native menu is removed — on Windows it would show a second
 * File/Edit/Insert/View row above the real one. A Mac keeps a minimal one (`macMenu.ts`): there the
 * text-editing keys only work through the menu bar at the top of the screen. Keyboard shortcuts live in
 * the renderer's keydown handler (`AppAction.combo`), not in native accelerators.
 */
function suppressNativeMenu(): void {
  const template = nativeMenuTemplate(process.platform);
  Menu.setApplicationMenu(template ? Menu.buildFromTemplate(template) : null);
}

// App / runtime info: the renderer asks main for it through the preload bridge.
ipcMain.handle("app:getInfo", () => ({
  name: "MadY",
  version: app.getVersion(),
  electron: process.versions.electron,
  chromium: process.versions.chrome,
  node: process.versions.node,
}));

/**
 * Clipboard access lives in the main process, not the preload.
 *
 * The renderer runs with `sandbox: true`, and a sandboxed preload gets only a subset of
 * the electron module: `ipcRenderer`, `contextBridge`, `webFrame`, `crashReporter`.
 * `clipboard` and `nativeImage` are `undefined` there, so a `clipboard.writeText(...)` in
 * the preload throws "Cannot read properties of undefined" while the bridge function
 * still type-checks and still reports `typeof === "function"` to the renderer. Copy SVG,
 * Copy image and paste-import would then fail in the packaged app while every jsdom test
 * (which stubs the bridge) passes.
 *
 * `readText` is synchronous (`e.returnValue`) so the paste-import call site keeps its
 * signature; a paste is a user-initiated one-shot, so the brief block is acceptable and
 * far less invasive than making that path async.
 */
ipcMain.on("clipboard:writeText", (_event, text: unknown) => {
  clipboard.writeText(typeof text === "string" ? text : String(text ?? ""));
});
ipcMain.on("clipboard:writeImage", (_event, base64Png: unknown) => {
  if (typeof base64Png !== "string" || base64Png === "") return;
  clipboard.writeImage(nativeImage.createFromDataURL(`data:image/png;base64,${base64Png}`));
});
ipcMain.on("clipboard:readText", (event) => {
  event.returnValue = clipboard.readText();
});

/**
 * What actually computed the statistics: the app's own version plus the interpreter
 * and numeric libraries the engine reported in its handshake. The drafted Methods
 * paragraph cites these, so they are read from the running engine rather than
 * hardcoded — a frozen build ships pinned wheels and reports different numbers from
 * a dev checkout. `libraries` is empty until the engine has spoken.
 */
ipcMain.handle("engine:getInfo", () => {
  const hello = supervisor.info();
  return {
    app: app.getVersion(),
    engine: hello?.version ?? null,
    contractVersion: hello?.contractVersion ?? null,
    libraries: hello?.libraries ?? {},
  };
});

// --- bug report -----------------------------------------------------------
// The user-facing bug reporter gathers everything main can see that the renderer
// cannot — OS details and the tail of the application log (which carries the
// `[main]`/`[sidecar]` lines, including the silent I/O failures the UI may have
// swallowed) — and later zips the renderer's assembled report to a user-chosen file.
// Nothing is uploaded; the reporter is entirely local.

/** Read the tail of the electron-log file (best-effort; empty when unavailable). */
async function readLogTail(maxBytes = 64 * 1024): Promise<string> {
  try {
    const file = log.transports.file.getFile();
    const buf = await readFile(file.path);
    const slice = buf.length > maxBytes ? buf.subarray(buf.length - maxBytes) : buf;
    const text = slice.toString("utf8");
    // Drop a partial first line when truncated mid-file.
    return buf.length > maxBytes ? text.slice(text.indexOf("\n") + 1) : text;
  } catch (error) {
    return `(could not read application log: ${String(error)})`;
  }
}

ipcMain.handle("bugreport:context", async () => ({
  app: {
    name: "MadY",
    version: app.getVersion(),
    electron: process.versions.electron,
    chromium: process.versions.chrome,
    node: process.versions.node,
  },
  engine: (() => {
    const hello = supervisor.info();
    return { engine: hello?.version ?? null, contractVersion: hello?.contractVersion ?? null, libraries: hello?.libraries ?? {} };
  })(),
  os: {
    platform: process.platform,
    release: release(),
    arch: process.arch,
    totalMemMB: Math.round(totalmem() / (1024 * 1024)),
    cpus: cpus().length,
  },
  logTail: await readLogTail(),
}));

ipcMain.handle("bugreport:screenshot", async (event) => {
  // The opt-in screenshot: captured only when the user ticked it in the reporter, at
  // save time — the window shows their data, so nothing here runs unasked.
  try {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return { ok: false, error: "No window to capture." };
    const image = await win.webContents.capturePage();
    return { ok: true, base64: image.toPNG().toString("base64") };
  } catch (error) {
    return { ok: false, error: String(error) };
  }
});

ipcMain.handle(
  "bugreport:save",
  async (event, payload: { files: { name: string; content: string; base64?: boolean }[]; stem?: string }) => {
    const win = BrowserWindow.fromWebContents(event.sender) ?? undefined;
    const stem = (payload.stem || "mady-bug-report").replace(/[^\w.-]+/g, "_");
    const { canceled, filePath } = await dialog.showSaveDialog(win!, {
      title: "Save bug report",
      defaultPath: `${stem}.zip`,
      filters: [{ name: "Zip archive", extensions: ["zip"] }],
    });
    if (canceled || !filePath) return { ok: false, canceled: true };
    try {
      // base64 entries are binary (the opt-in screenshot); everything else is UTF-8 text.
      const zip = zipSync(payload.files.map((f) => ({ name: f.name, data: f.base64 ? Buffer.from(f.content, "base64") : f.content })));
      await writeFile(filePath, zip);
      log.info(`[main] bug report saved → ${filePath} (${payload.files.length} file(s))`);
      return { ok: true, path: filePath };
    } catch (error) {
      log.error(`[main] bug report save failed: ${String(error)}`);
      return errorResult(error);
    }
  },
);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

const isFiniteNumberArray = (value: unknown): value is number[] =>
  Array.isArray(value) && value.every((item) => typeof item === "number" && Number.isFinite(item));

// Stats-engine sidecar location:
//  - Dev (not packaged): system Python runs engine.py straight from the repo
//    (app.getAppPath() === apps/desktop → <repo>/engines/py/engine.py). Fast
//    iteration; requires Python + numpy/scipy/statsmodels on the dev machine.
//  - Packaged: the PyInstaller-frozen engine, shipped as an extraResource
//    (resources/engine/), a self-contained binary carrying its own CPython +
//    libraries. The end user installs nothing but MadY. It sits
//    outside the asar and is spawned by absolute path.
function resolveEngine(): { command: string; args: string[] } {
  if (app.isPackaged) {
    const exe = process.platform === "win32" ? "mady-engine.exe" : "mady-engine";
    return { command: join(process.resourcesPath, "engine", exe), args: [] };
  }
  return {
    command: process.platform === "win32" ? "py" : "python3",
    // `py -3`: given a script and no version, the Windows launcher follows its `#!` line and can
    // pick another Python found on PATH, one without the packages.
    args: [...(process.platform === "win32" ? ["-3"] : []), join(app.getAppPath(), "..", "..", "engines", "py", "engine.py")],
  };
}
const engine = resolveEngine();
log.info(`[main] stats engine: ${engine.command}${engine.args.length ? ` ${engine.args.join(" ")}` : ""}`);
const supervisor = new SidecarSupervisor({
  command: engine.command,
  args: engine.args,
  onLog: (message) => log.info(`[sidecar] ${message}`),
});

ipcMain.handle("analysis:describe", async (_event, values: unknown) => {
  if (!isFiniteNumberArray(values)) {
    return { ok: false, code: "bad_request", message: "values must be an array of finite numbers" };
  }
  try {
    return { ok: true, results: await supervisor.request("describe", { values }) };
  } catch (error) {
    const code = error instanceof SidecarError ? error.code : "engine_internal";
    return { ok: false, code, message: error instanceof Error ? error.message : String(error) };
  }
});

// Generic stats channel: run any engine method. The renderer passes the
// method id + raw numeric arrays; the engine returns the tidy result contract.
ipcMain.handle(
  "analysis:run",
  async (_event, payload: unknown) => {
    if (!isRecord(payload) || !isNonEmptyString(payload.method) || !isRecord(payload.data)) {
      return { ok: false, code: "bad_request", message: "method and data are required" };
    }
    try {
      return { ok: true, results: await supervisor.request(payload.method, payload.data) };
    } catch (error) {
      const code = error instanceof SidecarError ? error.code : "engine_internal";
      return { ok: false, code, message: error instanceof Error ? error.message : String(error) };
    }
  },
);

// --- file types ----------------------------------------------------------
const PROJECT_EXTENSIONS = ["mady"];
const TEXT_EXTENSIONS = ["csv", "tsv", "txt", "dat", "prn", "json", "ndjson", "jsonl"];
const EXCEL_EXTENSIONS = ["xlsx"];
// Legacy / alternative spreadsheet formats read via SheetJS (patched 0.20.3 build) → same
// per-sheet grids as .xlsx, so they flow through the same import dialog.
const LEGACY_SHEET_EXTENSIONS = ["xls", "xlsb", "ods"];
// `.pzfx` (XML) — data tables only, decoded to the same per-sheet grids as the spreadsheet paths
// so the file flows through the same import dialog. Graphs/analyses are not imported; the
// dialog shows that as a banner (PZFX_IMPORT_NOTICE).
const PZFX_EXTENSIONS = ["pzfx"];
// Formats MadY cannot read — reject with an actionable message rather than letting them
// fall through to the text default and import as mojibake. `.pzf` is the
// older proprietary binary sibling of `.pzfx` (undocumented) — only the XML `.pzfx` is readable.
const UNSUPPORTED_BINARY = ["numbers", "pzf"];
const ALL_OPENABLE = [...PROJECT_EXTENSIONS, ...TEXT_EXTENSIONS, ...EXCEL_EXTENSIONS, ...LEGACY_SHEET_EXTENSIONS, ...PZFX_EXTENSIONS];

const extensionOf = (path: string): string => extname(path).slice(1).toLowerCase();

/** Read one file by path and tag it as a project (.mady) or imported data. */
async function readAnyFile(path: string): Promise<Record<string, unknown>> {
  const ext = extensionOf(path);
  const name = basename(path, extname(path));
  if (PROJECT_EXTENSIONS.includes(ext)) {
    const json = await readFile(path, "utf8");
    addRecent(path);
    log.info(`[main] opened project ← ${path}`);
    return { ok: true, kind: "project", path, json };
  }
  if (EXCEL_EXTENSIONS.includes(ext)) {
    const sheets = await readWorkbook(path);
    log.info(`[main] imported workbook ← ${path} (${sheets.length} sheet(s))`);
    return { ok: true, kind: "import", source: "excel", name, path, sheets };
  }
  if (LEGACY_SHEET_EXTENSIONS.includes(ext)) {
    const sheets = await readLegacyWorkbook(path);
    log.info(`[main] imported ${ext} workbook ← ${path} (${sheets.length} sheet(s))`);
    return { ok: true, kind: "import", source: "excel", name, path, sheets };
  }
  if (PZFX_EXTENSIONS.includes(ext)) {
    const sheets = await readPzfxFile(path);
    if (sheets.length === 0) {
      return errorResult(
        new Error("That .pzfx file has no data tables to import (it may contain only graphs or analyses)."),
      );
    }
    log.info(`[main] imported .pzfx data ← ${path} (${sheets.length} table(s))`);
    // source "pzfx" so the renderer can show the "data only" banner; the sheets themselves flow
    // through the same multi-sheet import path as Excel.
    return { ok: true, kind: "import", source: "pzfx", name, path, sheets, notice: PZFX_IMPORT_NOTICE };
  }
  if (UNSUPPORTED_BINARY.includes(ext)) {
    const msg =
      ext === "pzf"
        ? "The older .pzf format can't be read (proprietary binary). Re-save it as .pzfx (XML) and open that."
        : `.${ext} files can't be opened directly. Re-save as .xlsx or export to CSV, then open that.`;
    return errorResult(new Error(msg));
  }
  // Default: treat as delimited text (csv/tsv/txt/dat/prn or unknown). BOM-sniff the
  // bytes so a UTF-16 file (e.g. Excel's "Unicode Text" export) isn't read as mojibake.
  const text = decodeTextBuffer(await readFile(path));
  log.info(`[main] imported text ← ${path}`);
  return { ok: true, kind: "import", source: "text", name, path, text };
}

const errorResult = (error: unknown): Record<string, unknown> => ({
  ok: false,
  error: error instanceof Error ? error.message : String(error),
});

// --- recent files (persisted in userData) --------------------------------
interface RecentEntry {
  path: string;
  name: string;
}
let recents: RecentEntry[] = [];
const recentsFile = (): string => join(app.getPath("userData"), "recents.json");

async function loadRecents(): Promise<void> {
  try {
    const parsed: unknown = JSON.parse(await readFile(recentsFile(), "utf8"));
    recents = Array.isArray(parsed)
      ? parsed
          .filter(
            (entry): entry is RecentEntry =>
              isRecord(entry) && isNonEmptyString(entry.path) && isNonEmptyString(entry.name),
          )
          .slice(0, 10)
      : [];
  } catch {
    recents = []; // first run / unreadable → empty
  }
}

function addRecent(path: string): void {
  recents = [{ path, name: basename(path) }, ...recents.filter((r) => r.path !== path)].slice(0, 10);
  void writeFile(recentsFile(), JSON.stringify(recents), "utf8").catch((e) =>
    log.warn(`[main] recents write failed: ${String(e)}`),
  );
}

ipcMain.handle("recents:list", () => recents);

// --- autosave + crash-recovery (data safety) ---------------------------
// The renderer writes the latest in-memory project to a single userData slot
// (never the user's `.mady` file). On a clean quit we remove the slot; if it
// survives to the next launch the previous session crashed. We capture that
// snapshot once at startup so the renderer's own first autosave can't clobber
// the recoverable copy before the user decides what to do with it.
let recovered: AutosaveSnapshot | null = null;

ipcMain.handle("autosave:write", async (_event, snapshot: AutosaveSnapshot) => {
  try {
    await writeSnapshot(app.getPath("userData"), snapshot);
    return { ok: true };
  } catch (error) {
    log.warn(`[main] autosave write failed: ${String(error)}`);
    return { ok: false };
  }
});

ipcMain.handle("autosave:recovered", () => recovered);

ipcMain.handle("autosave:clear", async () => {
  await clearSnapshot(app.getPath("userData"));
  recovered = null;
  return { ok: true };
});

// --- durable user style library (presets/profile) ---------------
// Mirror of the renderer's fragile localStorage into a userData JSON file, so the
// user's custom presets/templates/default-profile survive a localStorage wipe and
// the dev↔packaged origin split. Plus Export/Import to a portable .json.
/**
 * The user manual, as one self-contained HTML file.
 *
 * Packaged, it is an extraResource (resources/manual/) — many megabytes of base64 images, which is why it
 * sits outside the asar rather than being bundled into the renderer. In development it is read
 * from `docs/manual/`, where `scripts/gen-manual-html.mjs` writes it.
 *
 * It is generated, and the generated file is gitignored on purpose (byte-for-byte rewritten on
 * every regeneration). So a dev checkout that has never run the generator has no file here, and
 * this returns `null` rather than throwing — "Help ▸ Save the manual…" then says how to make it,
 * which is a better failure than a stack trace.
 */
/**
 * The model: probe, and download through the local server.
 *
 * Both handlers talk to 127.0.0.1 — the model server does the downloading of weights, and
 * `pullModel` refuses a non-loopback URL outright. The one place MadY's own process fetches
 * from the internet is `runtime:install` below (the runtime itself, pinned + hashed, on the
 * user's press) — the exception the manual describes.
 *
 * Note: it lives in main, not the renderer, for a plain reason: the renderer is a browser context,
 * so a fetch to 127.0.0.1 is cross-origin and CORS would refuse it. Every other native
 * capability here goes the same way.
 */
ipcMain.handle("model:probe", async (_event, model?: string) => {
  const env = model ? { ...process.env, MADY_MODEL_NAME: model } : process.env;
  return probeModelSidecar(env as Record<string, string | undefined>);
});

ipcMain.handle("model:pull", async (event, model: string) => {
  const sender = event.sender;
  // The saved (or env) loopback url — an Advanced set-up may have pointed at another port.
  const { url } = await modelSettings();
  return pullModel(String(model), {
    url,
    // Progress is pushed to the window that asked, so the button can show real bytes. Guarded:
    // a long download easily outlives the dialog, and posting to a destroyed view throws.
    onProgress: (p) => {
      if (!sender.isDestroyed()) sender.send("model:pull-progress", p);
    },
  });
});

/**
 * The runtime itself — Ollama, fetched on request (one press, nothing to install by
 * hand). See `modelRuntime.ts` for what keeps a downloaded program trustworthy: pinned
 * version + SHA-256, verified before unpack, portable under a folder the user chose, loopback
 * only, stopped on quit, and an Ollama the user already runs is used rather than duplicated.
 *
 * The renderer never hands main a URL. `runtime:install` takes a folder and nothing else;
 * what is fetched is the pinned asset for this platform, full stop.
 *
 * `runtime:status` is what the set-up dialog is drawn from: the pinned archive's name, size,
 * unpacked size and one-line blurb, plus whether the runtime is on disk and whether anything
 * answers on the loopback port right now (ours, the user's own, or nothing).
 */
let modelRuntime: OllamaRuntime | null = null;

/**
 * Off unless `MADY_LLM=1`: the everyday version is the one without the LLM. No
 * button, no bar, no download, no runtime at boot — in the installed program and in the
 * everyday `npm run dev` alike. `npm run dev:llm` sets the variable. The renderer reads this
 * once, synchronously, at preload time, so nothing ever flashes.
 */
const LLM_ENABLED = llmEnabled(process.env);
ipcMain.on("app:llmEnabled", (event) => {
  event.returnValue = LLM_ENABLED;
});

/** env → model.json → defaults, read fresh each time (the dialog may have just saved). */
async function modelSettings(): Promise<ReturnType<typeof resolveModelSettings>> {
  const userData = app.getPath("userData");
  return resolveModelSettings(process.env, await readModelConfig(userData), userData);
}

/** The folder everything lands under: the one passed, else the saved/default one. */
const runtimeRoot = async (root: unknown): Promise<string> =>
  typeof root === "string" && root.trim() ? root : (await modelSettings()).root;

/**
 * The status the bar and the button key off — settings, whether our runtime is on disk, what
 * answers on the loopback port and which models it holds, whether that makes us ready, and
 * the automatic pick for this machine's memory. One object, composed by a pure function so
 * the phases are tested without Electron (`modelConfig.test.ts`).
 */
ipcMain.handle("model:status", async () => {
  const settings = await modelSettings();
  const probe = modelRuntime ?? new OllamaRuntime({ exe: runtimeExePath(settings.root), modelsDir: runtimeModelsDir(settings.root), url: settings.url });
  return composeModelStatus({
    settings,
    runtimeInstalled: await runtimeInstalled(settings.root),
    running: await probe.status(),
    serverModels: await listServerModels(settings.url),
    totalMemBytes: totalmem(),
  });
});

/** Save the choice (root · model · optional loopback url) and report the new status. */
ipcMain.handle("model:configure", async (_event, cfg: unknown) => {
  if (!isRecord(cfg) || !isNonEmptyString(cfg.root) || (cfg.model !== null && !isNonEmptyString(cfg.model))) {
    return { ok: false, error: "root (a folder) and model (a tag or null) are required" };
  }
  const next: ModelConfig = { root: cfg.root, model: cfg.model === null ? null : cfg.model };
  if (isNonEmptyString(cfg.url)) next.url = cfg.url;
  try {
    await writeModelConfig(app.getPath("userData"), next); // refuses a non-loopback url
  } catch (error) {
    return errorResult(error);
  }
  return { ok: true };
});

/**
 * Compile a typed line: exact parser first, the configured model second (none → parser only).
 * Nothing is executed here — the renderer previews or runs the commands through its own
 * `mutate`. Runs in main because the model server is loopback HTTP the renderer cannot reach.
 */
ipcMain.handle("model:compile", async (_event, text: unknown, ctx: unknown) => {
  if (!LLM_ENABLED) return { ok: false, error: "the language model is not part of this build" };
  if (!isNonEmptyString(text) || !isRecord(ctx) || !Array.isArray(ctx.tables)) {
    return { ok: false, error: "text and a context with tables are required" };
  }
  const settings = await modelSettings();
  return compileLine(text, ctx as unknown as Parameters<typeof compileLine>[1], { url: settings.url, model: settings.model });
});

/** The tiny round trip the set-up ends with. Optional url/model override the saved ones (Advanced). */
ipcMain.handle("model:test", async (_event, cfg?: unknown) => {
  const settings = await modelSettings();
  const url = isRecord(cfg) && isNonEmptyString(cfg.url) ? cfg.url : settings.url;
  const model = isRecord(cfg) && isNonEmptyString(cfg.model) ? cfg.model : settings.model;
  return testModel({ url, model });
});

/** The folder for the runtime and the weights — the OS picker, so the user chooses where 9 GB go. */
ipcMain.handle("model:pickFolder", async (event, current?: unknown) => {
  const win = BrowserWindow.fromWebContents(event.sender) ?? undefined;
  const { canceled, filePaths } = await dialog.showOpenDialog(win!, {
    title: "Where should the model runtime and its weights be stored?",
    ...(isNonEmptyString(current) ? { defaultPath: current } : {}),
    properties: ["openDirectory", "createDirectory"],
  });
  return canceled || !filePaths?.[0] ? null : filePaths[0];
});

/** Open an https page in the OS browser — the runtime's own download page when MadY's fetch fails. */
ipcMain.handle("shell:openExternal", async (_event, url: unknown) => {
  if (!isNonEmptyString(url) || !/^https:\/\//.test(url)) return false;
  await shell.openExternal(url);
  return true;
});

/** Free space on the drive a (possibly not yet existing) folder lives on. */
ipcMain.handle("model:freeSpace", async (_event, path: unknown) => (isNonEmptyString(path) ? freeSpaceBytes(path) : null));

/**
 * At boot: if our runtime is on disk (the user set it up once), start it so the bar is ready
 * without a press — using the user's own Ollama instead if one already answers. Never
 * downloads anything: an absent runtime at boot is simply "not set up".
 */
async function bootModelRuntime(): Promise<void> {
  if (!LLM_ENABLED) return;
  const settings = await modelSettings();
  if (!(await runtimeInstalled(settings.root))) return;
  const rt = new OllamaRuntime({
    exe: runtimeExePath(settings.root),
    modelsDir: runtimeModelsDir(settings.root),
    url: settings.url,
    onLog: (line) => log.info(`[ollama] ${line}`),
  });
  const r = await rt.start();
  if (r.ok) {
    modelRuntime = rt;
    log.info(`[main] model runtime ${r.external ? "found running (the user's own)" : "started"} at ${settings.url}`);
  } else {
    log.warn(`[main] model runtime did not start: ${r.error}`);
  }
}

ipcMain.handle("runtime:status", async (_event, root?: unknown) => {
  const r = await runtimeRoot(root);
  const asset = runtimeAsset();
  const probe = modelRuntime ?? new OllamaRuntime({ exe: runtimeExePath(r), modelsDir: runtimeModelsDir(r) });
  return {
    root: r,
    version: OLLAMA_VERSION,
    installed: await runtimeInstalled(r),
    running: await probe.status(),
    asset: asset
      ? { name: asset.name, bytes: asset.bytes, unpackedBytes: asset.unpackedBytes ?? null, blurb: OLLAMA_BLURB }
      : null,
  };
});

ipcMain.handle("runtime:install", async (event, root?: unknown) => {
  // The shipped build downloads nothing. This is the one place MadY's process could, and it
  // is shut unless the feature is on.
  if (!LLM_ENABLED) return { ok: false, step: "download", error: "the language model is not part of this build" };
  const sender = event.sender;
  const result = await installRuntime({
    root: await runtimeRoot(root),
    onProgress: (p) => {
      if (!sender.isDestroyed()) sender.send("runtime:install-progress", p);
    },
    onLog: (line) => log.info(`[ollama] ${line}`),
  });
  // Only one runtime is ever ours; a second successful install re-uses the first's process
  // (start() finds it answering and reports it as external-to-this-call, which is fine).
  if (result.ok && result.runtime && !modelRuntime) modelRuntime = result.runtime;
  const { runtime: _process, ...serialisable } = result;
  return serialisable;
});

ipcMain.handle("manual:read", async (): Promise<string | null> => {
  const path = app.isPackaged
    ? join(process.resourcesPath, "manual", "MadY-Manual.html")
    : join(app.getAppPath(), "..", "..", "docs", "manual", "MadY-Manual.html");
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    log.warn(`[main] manual not readable at ${path}: ${String(error)}`);
    return null;
  }
});

ipcMain.handle("userlib:read", () => readLibrary(app.getPath("userData")));

ipcMain.handle("userlib:write", async (_event, lib: UserLibrary) => {
  try {
    await writeLibrary(app.getPath("userData"), lib);
    return { ok: true };
  } catch (error) {
    log.warn(`[main] userlib write failed: ${String(error)}`);
    return { ok: false };
  }
});

ipcMain.handle("userlib:export", async (event, lib: UserLibrary) => {
  const win = BrowserWindow.fromWebContents(event.sender) ?? undefined;
  const { canceled, filePath } = await dialog.showSaveDialog(win!, {
    title: "Export style library",
    defaultPath: "mady-style-library.json",
    filters: [{ name: "MadY style library", extensions: ["json"] }],
  });
  if (canceled || !filePath) return { ok: false, canceled: true };
  try {
    await atomicWrite(filePath, JSON.stringify(lib, null, 2));
    return { ok: true, path: filePath };
  } catch (error) {
    return { ok: false, error: String(error) };
  }
});

ipcMain.handle("userlib:import", async (event) => {
  const win = BrowserWindow.fromWebContents(event.sender) ?? undefined;
  const { canceled, filePaths } = await dialog.showOpenDialog(win!, {
    title: "Import style library",
    filters: [{ name: "MadY style library", extensions: ["json"] }],
    properties: ["openFile"],
  });
  if (canceled || !filePaths?.[0]) return { ok: false, canceled: true };
  const lib = await readLibraryFile(filePaths[0]);
  if (!lib) return { ok: false, error: "Not a valid MadY style library file." };
  return { ok: true, lib };
});

/**
 * One-preset import: pick one or more `.mady-preset.json` files and hand their text to the
 * renderer. No parsing here — `presetFile.ts` (renderer) decides what is a preset, drops what it
 * does not know and gives every import a fresh id, and it is a pure function with its own tests.
 */
const PRESET_FILE_CAP_BYTES = 2 * 1024 * 1024;
ipcMain.handle("preset:import", async (event) => {
  const win = BrowserWindow.fromWebContents(event.sender) ?? undefined;
  const { canceled, filePaths } = await dialog.showOpenDialog(win!, {
    title: "Import preset files",
    filters: [{ name: "MadY preset", extensions: ["json"] }],
    properties: ["openFile", "multiSelections"],
  });
  if (canceled || !filePaths?.length) return { ok: false, canceled: true };
  return { ok: true, files: await readTextFiles(filePaths, PRESET_FILE_CAP_BYTES) };
});

// --- project persistence (.mady = serialized Project JSON) -------------
// The OS dialog confirms overwrite; we write via atomicWrite (temp file + rename). The
// rename path is atomic — an existing file is never left half-written on a crash. Note:
// the EXDEV copy+replace fallback for redirected drives is not
// atomic — a crash mid-copy can truncate the target — so it is best-effort, not a guarantee.
ipcMain.handle(
  "project:save",
  async (event, payload: { json: string; suggestedName?: string }) => {
    const win = BrowserWindow.fromWebContents(event.sender) ?? undefined;
    const { canceled, filePath } = await dialog.showSaveDialog(win!, {
      title: "Save MadY project",
      defaultPath: `${payload.suggestedName?.replace(/[^\w.-]+/g, "_") || "project"}.mady`,
      filters: [{ name: "MadY project", extensions: ["mady"] }],
    });
    if (canceled || !filePath) return { ok: false, canceled: true };
    try {
      await atomicWrite(filePath, payload.json);
      addRecent(filePath);
      log.info(`[main] saved project → ${filePath}`);
      return { ok: true, path: filePath };
    } catch (error) {
      log.error(`[main] save failed: ${String(error)}`);
      return errorResult(error);
    }
  },
);

// --- unified open (projects and data) ------------------------------------
// One dialog that accepts a .mady project OR a data file; the caller routes
// on `kind`. Every dialog ends with an "All files" filter so nothing is hidden.
ipcMain.handle("file:open", async (event) => {
  const win = BrowserWindow.fromWebContents(event.sender) ?? undefined;
  const { canceled, filePaths } = await dialog.showOpenDialog(win!, {
    title: "Open",
    properties: ["openFile"],
    filters: [
      { name: "All supported", extensions: ALL_OPENABLE },
      { name: "MadY project", extensions: PROJECT_EXTENSIONS },
      { name: "Delimited text", extensions: TEXT_EXTENSIONS },
      { name: "Excel workbook", extensions: EXCEL_EXTENSIONS },
      { name: "Data tables (.pzfx)", extensions: PZFX_EXTENSIONS },
      { name: "All files", extensions: ["*"] },
    ],
  });
  const path = filePaths[0];
  if (canceled || !path) return { ok: false, canceled: true };
  try {
    return await readAnyFile(path);
  } catch (error) {
    log.error(`[main] open failed: ${String(error)}`);
    return errorResult(error);
  }
});

// Open/import a specific path (recent files, drag-and-drop).
ipcMain.handle("file:openPath", async (_event, path: unknown) => {
  if (!isNonEmptyString(path)) return errorResult("path must be a non-empty string");
  try {
    return await readAnyFile(path);
  } catch (error) {
    log.error(`[main] openPath failed: ${String(error)}`);
    return errorResult(error);
  }
});

// A double-clicked `.mady` (Windows starts MadY with the file's path). The renderer asks for it
// once, when it is ready to open things (after any crash-recovery choice); a file double-clicked
// while MadY is already open arrives through `second-instance` → "launch:open" instead.
let launchPath: string | null = projectPathFromArgv(process.argv, PROJECT_EXTENSIONS);
if (launchPath) log.info(`[main] started to open ${launchPath}`);
ipcMain.handle("launch:file", () => {
  const path = launchPath;
  launchPath = null; // once: a renderer reload must not open it again over later work
  return path;
});

/** Open a project file handed to MadY from outside (a second launch, or macOS's `open-file`). */
function openFromOutside(path: string, how: string): void {
  const win = mainWindow;
  log.info(`[main] asked to open ${path} by ${how}`);
  // No window yet, or a page still loading (no listener, so the message would be dropped): hold
  // the file for the renderer to collect ("launch:file") like the one MadY was started with.
  if (!win || win.isDestroyed() || win.webContents.isLoading()) {
    launchPath = path;
    return;
  }
  if (win.isMinimized()) win.restore();
  if (win.isVisible()) win.focus(); // still starting (splash up): it shows itself when ready
  win.webContents.send("launch:open", path);
}

app.on("second-instance", (_event, argv) => {
  const win = mainWindow;
  if (!win || win.isDestroyed()) return;
  if (win.isMinimized()) win.restore();
  if (win.isVisible()) win.focus(); // still starting (splash up): it shows itself when ready
  const path = projectPathFromArgv(argv, PROJECT_EXTENSIONS);
  if (path) openFromOutside(path, "a second launch");
});

// macOS hands a double-clicked document (or one dropped on the Dock icon) to the app as an
// `open-file` event — at launch, before the window exists, and while MadY is running.
app.on("open-file", (event, filePath) => {
  const path = projectPathFromOpenFile(filePath, PROJECT_EXTENSIONS);
  if (!path) return;
  event.preventDefault();
  openFromOutside(path, "macOS (open-file)");
});

// Replacing the open project with another: the same Save / Don't Save / Cancel as closing.
// The renderer asks only when its project has unsaved changes.
ipcMain.handle("app:ask-unsaved", async (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const { response } = win
    ? await dialog.showMessageBox(win, unsavedPromptOptions("open"))
    : await dialog.showMessageBox(unsavedPromptOptions("open"));
  return unsavedChoice(response);
});

// Project-only open, exposed on the preload bridge as `openProject`; the UI opens files through file:open.
ipcMain.handle("project:open", async (event) => {
  const win = BrowserWindow.fromWebContents(event.sender) ?? undefined;
  const { canceled, filePaths } = await dialog.showOpenDialog(win!, {
    title: "Open MadY project",
    properties: ["openFile"],
    filters: [
      { name: "MadY project", extensions: PROJECT_EXTENSIONS },
      { name: "All files", extensions: ["*"] },
    ],
  });
  const path = filePaths[0];
  if (canceled || !path) return { ok: false, canceled: true };
  try {
    const json = await readFile(path, "utf8");
    addRecent(path);
    return { ok: true, json, path };
  } catch (error) {
    return errorResult(error);
  }
});

// --- data import ---------------------------------------------------------
// Explicit "Import data" dialog (data files only). Delimited text is parsed in
// the renderer (DOM-free core); .xlsx is decoded here with exceljs.
// A ggplot script (R source): the text only — parsing and the report happen in the renderer
// (`@mady/core` `translateGgplot`), where the project's datasheets are, so nothing here
// runs R or reads data. `.txt` is accepted because scripts get mailed around as text.
const SCRIPT_EXTENSIONS = ["r", "rmd", "qmd", "txt"];
ipcMain.handle("file:importScript", async (event) => {
  const win = BrowserWindow.fromWebContents(event.sender) ?? undefined;
  const { canceled, filePaths } = await dialog.showOpenDialog(win!, {
    title: "Import a ggplot script",
    properties: ["openFile"],
    filters: [
      { name: "R scripts", extensions: SCRIPT_EXTENSIONS },
      { name: "All files", extensions: ["*"] },
    ],
  });
  const path = filePaths[0];
  if (canceled || !path) return { ok: false, canceled: true };
  try {
    const text = await readFile(path, "utf8");
    log.info(`[main] read ggplot script ← ${path} (${text.length} chars)`);
    return { ok: true, name: basename(path, extname(path)), path, text };
  } catch (error) {
    log.error(`[main] script read failed: ${String(error)}`);
    return errorResult(error);
  }
});

ipcMain.handle("file:import", async (event) => {
  const win = BrowserWindow.fromWebContents(event.sender) ?? undefined;
  const { canceled, filePaths } = await dialog.showOpenDialog(win!, {
    title: "Import data",
    properties: ["openFile"],
    filters: [
      { name: "All supported", extensions: [...TEXT_EXTENSIONS, ...EXCEL_EXTENSIONS, ...LEGACY_SHEET_EXTENSIONS, ...PZFX_EXTENSIONS] },
      { name: "Delimited text", extensions: TEXT_EXTENSIONS },
      { name: "Spreadsheet", extensions: [...EXCEL_EXTENSIONS, ...LEGACY_SHEET_EXTENSIONS] },
      { name: "Data tables (.pzfx)", extensions: PZFX_EXTENSIONS },
      { name: "All files", extensions: ["*"] },
    ],
  });
  const path = filePaths[0];
  if (canceled || !path) return { ok: false, canceled: true };
  try {
    const result = await readAnyFile(path);
    // The import dialog expects the bare import payload (no `kind`).
    if (result["kind"] === "import") {
      const { kind: _kind, ...payload } = result;
      return payload;
    }
    return result;
  } catch (error) {
    log.error(`[main] import failed: ${String(error)}`);
    return errorResult(error);
  }
});

// --- linked / auto-updating import: watch source files, push change events ---
// A table imported "linked" keeps a live tie to its file; when the file changes on
// disk we notify the renderer (debounced — fs.watch fires 1–2 events per save),
// which re-reads via `linked:read` and re-parses onto the same columns.
const linkedWatchers = new Map<string, FSWatcher>();
const linkedDebounce = new Map<string, ReturnType<typeof setTimeout>>();

function watchLinkedFile(path: string, sender: Electron.WebContents): void {
  if (linkedWatchers.has(path)) return; // already watching this file
  try {
    const w = watch(path, () => {
      clearTimeout(linkedDebounce.get(path));
      linkedDebounce.set(
        path,
        setTimeout(() => {
          if (!sender.isDestroyed()) sender.send("linked:changed", path);
        }, 150),
      );
    });
    w.on("error", () => unwatchLinkedFile(path));
    linkedWatchers.set(path, w);
    log.info(`[main] watching linked file ← ${path}`);
  } catch (error) {
    log.error(`[main] watch failed for ${path}: ${String(error)}`);
  }
}

function unwatchLinkedFile(path: string): void {
  linkedWatchers.get(path)?.close();
  linkedWatchers.delete(path);
  const pending = linkedDebounce.get(path);
  if (pending) {
    clearTimeout(pending);
    linkedDebounce.delete(path);
  }
}

ipcMain.handle("linked:watch", (event, path: unknown) => {
  if (!isNonEmptyString(path)) return errorResult("path must be a non-empty string");
  watchLinkedFile(path, event.sender);
  return { ok: true };
});
ipcMain.handle("linked:unwatch", (_event, path: unknown) => {
  if (!isNonEmptyString(path)) return errorResult("path must be a non-empty string");
  unwatchLinkedFile(path);
  return { ok: true };
});
ipcMain.handle("linked:read", async (_event, path: unknown) => {
  if (!isNonEmptyString(path)) return errorResult("path must be a non-empty string");
  try {
    return { ok: true, text: decodeTextBuffer(await readFile(path)) };
  } catch (error) {
    return errorResult(error);
  }
});

// --- export (graphs as images, PDF, EPS, HTML or PowerPoint; data/results as CSV, Excel, JSON and more) ---
// The renderer sends the content (serialized SVG, a PNG rasterized via canvas, the SVG for a
// PDF, text, a sheet or slides); main runs the save dialog, turns the content into the file's
// bytes (exportMany.ts) and writes them.
ipcMain.handle(
  "file:export",
  async (
    event,
    payload: {
      format: string;
      suggestedName?: string;
      text?: string;
      base64?: string;
      svg?: string;
      width?: number;
      height?: number;
      sheet?: { name: string; columns: string[]; rows: (string | number | null)[][] };
      pptx?: { slides: { name: string; svg: string; pngBase64: string; width: number; height: number }[] };
    },
  ) => {
    const win = BrowserWindow.fromWebContents(event.sender) ?? undefined;
    const ext = payload.format.toLowerCase();
    const FILTER_NAMES: Record<string, string> = {
      png: "PNG image",
      svg: "SVG vector",
      pdf: "PDF document",
      tiff: "TIFF image",
      jpg: "JPEG image",
      html: "HTML document",
      eps: "EPS (PostScript)",
      pptx: "PowerPoint presentation",
      csv: "CSV (comma-separated)",
      xlsx: "Excel workbook",
      json: "JSON data",
      py: "Python script",
      md: "Markdown document",
    };
    const { canceled, filePath } = await dialog.showSaveDialog(win!, {
      title: "Export",
      defaultPath: `${payload.suggestedName?.replace(/[^\w.-]+/g, "_") || "export"}.${ext}`,
      filters: [{ name: FILTER_NAMES[ext] ?? ext.toUpperCase(), extensions: [ext] }],
    });
    if (canceled || !filePath) return { ok: false, canceled: true };
    try {
      // The bytes come from the one writer Export all shares (exportMany.ts).
      await writeFile(filePath, await payloadToBuffer(payload, EXPORT_DEPS));
      log.info(`[main] exported ${ext} → ${filePath}`);
      return { ok: true, path: filePath };
    } catch (error) {
      log.error(`[main] export failed: ${String(error)}`);
      return errorResult(error);
    }
  },
);

// --- Export all: a folder the user picks, then every graph / figure written into it ----------------
/** The PDF and Excel writers the shared export bytes need (exportMany.ts stays plain Node). */
const EXPORT_DEPS = { svgToPdf: (svg: string, w: number, h: number) => svgToPdfBuffer(svg, w, h), workbook: buildWorkbook };
/** The folder picked in the Export all dialog this session — the only folder `file:exportMany` will write to. */
let pickedExportDir: string | null = null;
ipcMain.handle("export:pickFolder", async (event) => {
  const win = BrowserWindow.fromWebContents(event.sender) ?? undefined;
  const { canceled, filePaths } = await dialog.showOpenDialog(win!, {
    title: "Export all graphs and figures into…",
    ...(pickedExportDir ? { defaultPath: pickedExportDir } : {}),
    properties: ["openDirectory", "createDirectory"],
  });
  if (canceled || !filePaths?.[0]) return null;
  pickedExportDir = filePaths[0];
  return pickedExportDir;
});
ipcMain.handle("file:exportMany", async (_event, req: unknown) => {
  const r = req as { dir?: unknown; files?: unknown; replace?: unknown } | null;
  if (!r || !isNonEmptyString(r.dir) || !Array.isArray(r.files)) return { ok: false, error: "bad request", results: [] };
  const files = (r.files as { name?: unknown; payload?: unknown }[])
    .filter((f) => isNonEmptyString(f?.name) && f?.payload && typeof f.payload === "object")
    .map((f) => ({ name: f.name as string, payload: f.payload as ExportPayloadLike }));
  const results = await writeExportBatch(r.dir, files, { replace: r.replace === true, pickedDir: pickedExportDir }, EXPORT_DEPS);
  log.info(`[main] export all → ${r.dir}: ${results.filter((x) => x.ok).length}/${results.length} written`);
  return { ok: true, results };
});

/**
 * Render a standalone SVG string to a single-page, vector PDF via an off-screen
 * BrowserWindow + `printToPDF`. The page size is the figure's px size at 96 dpi
 * (so 1 SVG px = 1/96 inch), with no margins — a tight, text-stays-vector PDF
 * without adding a PDF library. The window is destroyed afterwards.
 */
async function svgToPdfBuffer(svg: string, width: number, height: number): Promise<Buffer> {
  const offscreen = new BrowserWindow({
    show: false,
    width: Math.max(1, Math.ceil(width)),
    height: Math.max(1, Math.ceil(height)),
    webPreferences: { offscreen: true, sandbox: true, contextIsolation: true },
  });
  try {
    const html = `<!doctype html><html><head><meta charset="utf-8"><style>*{margin:0;padding:0;box-sizing:border-box}html,body{width:${width}px;height:${height}px;overflow:hidden}svg{display:block;width:${width}px;height:${height}px}</style></head><body>${svg}</body></html>`;
    await offscreen.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    const pdf = await offscreen.webContents.printToPDF({
      pageSize: { width: width / 96, height: height / 96 },
      margins: { marginType: "none" },
      printBackground: true,
    });
    return Buffer.from(pdf);
  } finally {
    offscreen.destroy();
  }
}

/**
 * Print a standalone figure SVG. Renders it into a hidden (not offscreen — printing needs a
 * real compositor) BrowserWindow sized to the figure, then opens the OS print dialog via
 * `webContents.print`. A user cancel is reported as `ok: true, canceled` (not an error). The
 * window is destroyed only after the print callback fires, or the job never reaches the spooler.
 */
ipcMain.handle("figure:print", async (_event, payload: { svg?: string; width?: number; height?: number; html?: string }) => {
  // A graph/figure prints as a fixed page sized to the artwork (svg, clipped); a datasheet
  // prints as a flowing, paginated page (html table). The window is only a compositor for the
  // print job — its on-screen size doesn't gate an html page's pagination.
  const isHtml = typeof payload?.html === "string";
  const width = Math.max(1, Math.ceil(payload?.width ?? 680));
  const height = Math.max(1, Math.ceil(payload?.height ?? 420));
  const win = new BrowserWindow({
    show: false,
    width: isHtml ? 900 : width,
    height: isHtml ? 700 : height,
    webPreferences: { sandbox: true, contextIsolation: true },
  });
  try {
    const html = isHtml
      ? `<!doctype html><html><head><meta charset="utf-8"><style>` +
        `@page{margin:14mm}` +
        `*{box-sizing:border-box}body{margin:0;font:13px/1.4 system-ui,-apple-system,"Segoe UI",sans-serif;color:#111}` +
        `.print-title{font-size:16px;font-weight:600;margin:0 0 10px}` +
        `table.print-table{border-collapse:collapse;width:100%}` +
        `.print-table th,.print-table td{border:1px solid #bbb;padding:3px 7px;text-align:right;white-space:nowrap}` +
        `.print-table th{background:#f0f0f0;font-weight:600;text-align:center}` +
        `.print-table thead{display:table-header-group}` /* repeat the header on each printed page */ +
        `.print-table tr{page-break-inside:avoid}` +
        `</style></head><body>${payload.html}</body></html>`
      : `<!doctype html><html><head><meta charset="utf-8"><style>*{margin:0;padding:0;box-sizing:border-box}html,body{width:${width}px;height:${height}px;overflow:hidden}svg{display:block;width:${width}px;height:${height}px}</style></head><body>${payload.svg}</body></html>`;
    await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    const result = await new Promise<{ success: boolean; failureReason: string }>((resolve) => {
      win.webContents.print({ printBackground: true }, (success, failureReason) => resolve({ success, failureReason }));
    });
    if (result.success) return { ok: true } as const;
    // "cancelled" (the user closed the print dialog) is a normal outcome, not an error.
    if (/cancel/i.test(result.failureReason)) return { ok: true, canceled: true } as const;
    return { ok: false, error: result.failureReason || "Printing failed." } as const;
  } catch (error) {
    return errorResult(error);
  } finally {
    if (!win.isDestroyed()) win.destroy();
  }
});

// Whether the renderer's document has unsaved changes (reported via "app:dirty").
// Drives crash-recovery retention on quit + the unsaved-changes close guard.
let appDirty = false;
ipcMain.on("app:dirty", (_event, dirty: unknown) => {
  appDirty = dirty === true;
});

// The primary window + a latch that lets the unsaved-changes close guard through once the
// user has chosen (Don't Save, or a Save that completed). Reset per window in createWindow.
let mainWindow: BrowserWindow | null = null;
let allowClose = false;
ipcMain.on("app:close-confirmed", () => {
  allowClose = true; // the renderer saved successfully → close now
  mainWindow?.close();
});

app.on("will-quit", () => {
  void supervisor.stop();
  // The model runtime we spawned goes with us; one the user runs themselves is left alone.
  void modelRuntime?.stop();
  // Clean exit with the work saved → nothing to recover, clear the slot. But if the
  // document has unsaved changes, the snapshot is kept so the next launch can recover it
  // instead of losing it on quit. A crash also skips this. Sync so it completes before the process exits.
  if (!appDirty) clearSnapshotSync(app.getPath("userData"));
});

void app.whenReady().then(async () => {
  if (!primaryInstance) return; // this copy only handed its file to the open MadY (top of file)
  // The splash comes first, before any disk work: it exists to cover startup, so creating it
  // after the mkdir / recents / autosave-snapshot awaits would have it cover only the part
  // that is already fast. Nothing that touches the disk comes before the first paint.
  createSplash();
  await mkdir(app.getPath("userData"), { recursive: true }).catch(() => {});
  await loadRecents();
  // Capture any leftover autosave before the window (and its autosave loop) starts.
  recovered = await readSnapshot(app.getPath("userData"));
  if (recovered) log.info(`[main] autosave found — offering recovery (saved ${recovered.savedAt})`);
  suppressNativeMenu();
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
  // After the window, never before it: a model runtime is seconds of work the first paint
  // must not wait for. Fire-and-forget; the renderer asks `model:status` when it needs to know.
  void bootModelRuntime().catch((e) => log.warn(`[main] model runtime boot: ${String(e)}`));

  /**
   * Live attach, opt-in only. With `MADY_LIVE_AGENT_PORT` set, an outside agent can drive this
   * window over a loopback endpoint that accepts nothing but an `AgentCommand` — see
   * liveAgent.ts for why it is a narrow endpoint rather than Chromium's debugging port, and for
   * the three rules that keep it shut. Without the variable this is a no-op and no socket is
   * opened. Everything it can do goes through `window.madyAgent`, i.e. the app's own mutate.
   */
  const liveAgent = startLiveAgent(
    process.env,
    {
      hasWindow: () => mainWindow !== null && !mainWindow.isDestroyed(),
      evaluate: (js) => {
        if (!mainWindow || mainWindow.isDestroyed()) throw new Error("no MadY window is open");
        return mainWindow.webContents.executeJavaScript(js, true);
      },
    },
    (port) => log.info(`[main] live agent listening on 127.0.0.1:${port} (opt-in)`),
  );
  app.on("will-quit", () => liveAgent?.close());
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
