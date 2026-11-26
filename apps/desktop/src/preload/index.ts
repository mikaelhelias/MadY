// Import only sandbox-safe electron modules here. The renderer runs with `sandbox: true`,
// so a preload gets just ipcRenderer / contextBridge / webFrame / crashReporter (+ webUtils).
// `clipboard`, `nativeImage`, `shell`, `dialog` etc. are undefined at runtime — importing one
// type-checks fine and then throws on first use. Guarded by `preload-sandbox-safe.test.ts`.
import { contextBridge, ipcRenderer, webUtils } from "electron";

export interface AppInfo {
  name: string;
  version: string;
  electron: string;
  chromium: string;
  node: string;
}

/**
 * What actually computed the statistics — the app version plus the interpreter and
 * numeric library versions the stats engine reported at startup. Cited by the drafted
 * Methods paragraph. `libraries` is empty until the engine has handshaken.
 */
export interface EngineInfo {
  app: string;
  engine: string | null;
  contractVersion: number | null;
  libraries: Record<string, string>;
}

export interface DescribeResults {
  n: number;
  mean: number | null;
  sd: number | null;
}

export type DescribeResponse =
  | { ok: true; results: DescribeResults }
  | { ok: false; code: string; message: string };

/** Generic stats result: the engine's tidy contract, or a typed error. */
export type AnalysisRunResponse =
  | { ok: true; results: Record<string, unknown> }
  | { ok: false; code: string; message: string };

export type SaveResponse =
  | { ok: true; path: string }
  | { ok: false; canceled?: boolean; error?: string };

export type OpenResponse =
  | { ok: true; json: string; path: string }
  | { ok: false; canceled?: boolean; error?: string };

/** A cell value as imported (mirrors core's `CellValue`). */
export type ImportCell = number | string | null;

/** One Excel worksheet decoded to a row-major typed grid. */
export interface ImportSheet {
  name: string;
  grid: ImportCell[][];
}

/** Result of importing a data file: raw text for delimited, grids for Excel. */
export type ImportResponse =
  | { ok: true; source: "text"; name: string; text: string; path?: string }
  | { ok: true; source: "excel"; name: string; sheets: ImportSheet[]; path?: string }
  // `.pzfx` — data tables only, same sheet path as Excel; `notice` is the "no graphs/analyses" banner.
  | { ok: true; source: "pzfx"; name: string; sheets: ImportSheet[]; path?: string; notice: string }
  | { ok: false; canceled?: boolean; error?: string };

/** Re-read of a linked source file (auto-updating import). */
export type LinkedReadResponse = { ok: true; text: string } | { ok: false; error?: string };

/** What `runtime:status` reports — the set-up dialog is drawn from exactly this. */
export interface RuntimeStatusResponse {
  /** The folder everything lands under (the user's choice, or MadY's data folder). */
  root: string;
  /** The pinned Ollama release, e.g. "v0.33.3". */
  version: string;
  /** The executable is on disk under `root`. */
  installed: boolean;
  /** What answers on the loopback port right now. */
  running: "external" | "ours" | "down";
  /** The archive for this platform, or null when none is pinned (then nothing can be fetched). */
  asset: { name: string; bytes: number; unpackedBytes: number | null; blurb: string } | null;
}
/** What `model:status` reports — the bar shows iff `ready`; the button's label follows `phase`. */
export interface ModelStatusResponse {
  settings: { root: string; model: string | null; url: string; source: "env" | "file" | "default" };
  runtimeInstalled: boolean;
  running: "external" | "ours" | "down";
  serverModels: string[] | null;
  ready: boolean;
  phase: "none" | "runtime-only" | "server-only" | "ready";
  pick:
    | { ok: true; model: ModelChoiceInfo; reason: string }
    | { ok: false; reason: string };
  catalogue: ModelChoiceInfo[];
}
export interface ModelChoiceInfo {
  tag: string;
  label: string;
  parameters: string;
  quant: string;
  expectedBytes: number;
  headroomBytes: number;
  blurb: string;
  measured: boolean;
}
export type ConfigureModelResponse = { ok: true } | { ok: false; error: string };
/** Mirrors core's NLContext / NLResult — the preload is bundled apart from core, so shapes only. */
export interface NLContextLike {
  tables: { id: string; name: string; columns: { id: string; name: string }[] }[];
  activeTableId?: string | undefined;
  activeGraphId?: string | undefined;
}
export type NLResultLike =
  | { ok: true; commands: Record<string, unknown>[]; note?: string }
  | { ok: false; error: string; hint?: string };

export type RuntimeInstallStep = "download" | "verify" | "unpack" | "start";
export interface RuntimeInstallProgress {
  step: RuntimeInstallStep;
  received?: number | undefined;
  total?: number | undefined;
}
export type RuntimeInstallResponse =
  | { ok: true; exe: string; external: boolean }
  | { ok: false; step: RuntimeInstallStep; error: string };

/** A ggplot script picked for import: its text, untouched. */
export type ImportScriptResponse =
  | { ok: true; name: string; path: string; text: string }
  | { ok: false; canceled?: boolean; error?: string };

/** Unified open: a `.mady` project OR a data file — the caller routes on `kind`. */
export type FileOpenResponse =
  | { ok: true; kind: "project"; path: string; json: string }
  | ({ ok: true; kind: "import" } & (
      | { source: "text"; name: string; text: string; path?: string }
      | { source: "excel"; name: string; sheets: ImportSheet[]; path?: string }
      // `.pzfx` — data tables only, flowing through the same sheet path as Excel; `notice`
      // is the "graphs/analyses not imported" banner shown in the import dialog.
      | { source: "pzfx"; name: string; sheets: ImportSheet[]; path?: string; notice: string }
    ))
  | { ok: false; canceled?: boolean; error?: string };

/** A recently opened/saved file. */
export interface RecentEntry {
  path: string;
  name: string;
}

/** A crash-recovery autosave envelope. Mirrors `main/autosave.ts`. */
export interface AutosaveSnapshot {
  v: 1;
  savedAt: number;
  name: string;
  json: string;
}

/** What the renderer hands `exportFile`: vector/text as `text`, raster/binary as base64. */
export interface ExportPayload {
  format: "png" | "svg" | "pdf" | "tiff" | "jpg" | "html" | "eps" | "pptx" | "csv" | "xlsx" | "json" | "py" | "md";
  suggestedName?: string;
  text?: string;
  base64?: string;
  /** Vector PDF source: a serialized standalone SVG + its pixel size. The background is
   *  already baked into the SVG; there is no separate page-background field. */
  svg?: string;
  width?: number;
  height?: number;
  /** PPTX source: one slide per drawing — its SVG, the same drawing as a PNG (base64) and its size. Built in
   *  main (`main/pptx.ts`). */
  pptx?: { slides: { name: string; svg: string; pngBase64: string; width: number; height: number }[] };
  /** XLSX source: a positional data grid (built in main via ExcelJS). */
  sheet?: { name: string; columns: string[]; rows: (string | number | null)[][] };
}

export type ExportResponse =
  | { ok: true; path: string }
  | { ok: false; canceled?: boolean; error?: string };

/** Export all: one result per file written into the picked folder. Mirrors `main/exportMany.ts`. */
export type ExportManyResult = { name: string; ok: true; path: string } | { name: string; ok: false; error: string };
export type ExportManyResponse = { ok: boolean; error?: string; results: ExportManyResult[] };

/** Result of sending a figure to the OS print dialog. A user cancel is `ok: true, canceled`. */
export type PrintResponse =
  | { ok: true; canceled?: boolean }
  | { ok: false; error?: string };

/** Durable user style library (presets/profile mirror). Mirrors `main/userLibrary.ts`. */
export interface UserLibrary {
  v: 1;
  savedAt: number;
  /** localStorage key → its raw JSON string value. */
  data: Record<string, string>;
}
export type UserLibExportResponse =
  | { ok: true; path: string }
  | { ok: false; canceled?: boolean; error?: string };
export type UserLibImportResponse =
  | { ok: true; lib: UserLibrary }
  | { ok: false; canceled?: boolean; error?: string };
/** One-preset import: the picked files' text (or why one could not be read); the renderer parses. */
export type PresetImportResponse =
  | { ok: true; files: ({ name: string; text: string } | { name: string; error: string })[] }
  | { ok: false; canceled?: boolean; error?: string };

/** Main-side context for a bug report: versions, OS, and the tail of the app log. */
export interface BugReportContext {
  app: { name: string; version: string; electron: string; chromium: string; node: string };
  engine: { engine: string | null; contractVersion: number | null; libraries: Record<string, string> };
  os: { platform: string; release: string; arch: string; totalMemMB: number; cpus: number };
  logTail: string;
}
export type BugReportSaveResponse =
  | { ok: true; path: string }
  | { ok: false; canceled?: boolean; error?: string };

/** The minimal, allow-listed API exposed to the renderer (no raw ipcRenderer). */
const api = {
  getAppInfo: (): Promise<AppInfo> => ipcRenderer.invoke("app:getInfo"),
  /** Versions of the app + the interpreter/libraries that compute the statistics. */
  getEngineInfo: (): Promise<EngineInfo> => ipcRenderer.invoke("engine:getInfo"),
  describe: (values: number[]): Promise<DescribeResponse> =>
    ipcRenderer.invoke("analysis:describe", values),
  /** Run a stats method with raw numeric arrays; returns the tidy result. */
  runAnalysis: (method: string, data: Record<string, unknown>): Promise<AnalysisRunResponse> =>
    ipcRenderer.invoke("analysis:run", { method, data }),
  /** Save a serialized project (JSON) to a user-chosen `.mady` file. */
  saveProject: (json: string, suggestedName?: string): Promise<SaveResponse> =>
    ipcRenderer.invoke("project:save", { json, suggestedName }),
  /** Open a `.mady` file; returns its raw JSON for the renderer to migrate + load. */
  openProject: (): Promise<OpenResponse> => ipcRenderer.invoke("project:open"),
  /** Import a data file (delimited text, JSON, .xlsx/.xls/.xlsb/.ods or .pzfx); renderer parses + coerces. */
  importData: (): Promise<ImportResponse> => ipcRenderer.invoke("file:import"),
  /** Start watching a linked source file for on-disk changes (auto-updating import). */
  watchLinked: (path: string): Promise<{ ok: boolean }> => ipcRenderer.invoke("linked:watch", path),
  /** Stop watching a linked source file (on Unlink / table delete). */
  unwatchLinked: (path: string): Promise<{ ok: boolean }> => ipcRenderer.invoke("linked:unwatch", path),
  /** Re-read a linked source file's text (for re-parse on change / manual Refresh). */
  readLinked: (path: string): Promise<LinkedReadResponse> => ipcRenderer.invoke("linked:read", path),
  /** Subscribe to "a watched linked file changed" events. Returns an unsubscribe fn. */
  /**
   * The on-device model. Both go through main, which talks to 127.0.0.1 — the local model
   * server does any downloading, so these calls reach nothing beyond this computer.
   *
   * `pullModel` reports progress through a listener you pass in; the returned promise settles
   * when the download finishes or fails. Unsubscribe happens automatically.
   */
  probeModel: (model?: string): Promise<{
    configured: boolean; reachable: boolean; model?: string; url?: string; error?: string;
  }> => ipcRenderer.invoke("model:probe", model),
  pullModel: (
    model: string,
    onProgress: (p: { status: string; completed?: number; total?: number }) => void,
  ): Promise<{ ok: boolean; model?: string; bytes?: number; serverMissing?: boolean; error?: string }> => {
    const listener = (_e: unknown, p: { status: string; completed?: number; total?: number }): void => onProgress(p);
    ipcRenderer.on("model:pull-progress", listener);
    return ipcRenderer
      .invoke("model:pull", model)
      .finally(() => ipcRenderer.removeListener("model:pull-progress", listener));
  },
  /**
   * The runtime (Ollama), fetched on request — the one place this program contacts the
   * internet, and only when the user presses the button that says so. `runtimeStatus` is what
   * the set-up dialog is drawn from; `installRuntime` walks download → verify → unpack → start
   * and reports each step through `onProgress`. Both take only a folder; what is fetched is the
   * pinned release for this platform, chosen in main, never by the page.
   */
  /**
   * Whether the language model exists in this run — only when MadY was started with
   * `MADY_LLM=1`. False otherwise: no button, no bar. Read once,
   * synchronously, so nothing flashes before a status arrives.
   */
  llmEnabled: ipcRenderer.sendSync("app:llmEnabled") === true,
  /** Settings + runtime + server + the automatic pick, in one object. Ask it at boot and after set-up. */
  modelStatus: (): Promise<ModelStatusResponse> => ipcRenderer.invoke("model:status"),
  /**
   * A typed line → commands (not executed): the exact parser first, the configured model second,
   * parser only when no model is set. `ctx` is the same NLContext the Ask box builds.
   */
  compileWithModel: (text: string, ctx: NLContextLike): Promise<NLResultLike> => ipcRenderer.invoke("model:compile", text, ctx),
  /** One tiny completion — the proof a set-up ends with. Optional url/model override the saved ones. */
  testModel: (cfg?: { url?: string; model?: string }): Promise<{ ok: true; ms: number } | { ok: false; error: string }> =>
    ipcRenderer.invoke("model:test", cfg),
  /** Open an https page in the OS browser (Ollama's download page). Anything else is refused. */
  openExternal: (url: string): Promise<boolean> => ipcRenderer.invoke("shell:openExternal", url),
  /** The OS folder picker for where the runtime and weights go; null when cancelled. */
  pickModelFolder: (current?: string): Promise<string | null> => ipcRenderer.invoke("model:pickFolder", current),
  /** Free bytes on the drive that folder lives on (its nearest existing ancestor); null if unreadable. */
  modelFreeSpace: (path: string): Promise<number | null> => ipcRenderer.invoke("model:freeSpace", path),
  /** Save the choice: the folder, the model tag (or null), optionally a loopback url. */
  configureModel: (cfg: { root: string; model: string | null; url?: string }): Promise<ConfigureModelResponse> =>
    ipcRenderer.invoke("model:configure", cfg),
  runtimeStatus: (root?: string): Promise<RuntimeStatusResponse> => ipcRenderer.invoke("runtime:status", root),
  installRuntime: (root: string | undefined, onProgress: (p: RuntimeInstallProgress) => void): Promise<RuntimeInstallResponse> => {
    const listener = (_e: unknown, p: RuntimeInstallProgress): void => onProgress(p);
    ipcRenderer.on("runtime:install-progress", listener);
    return ipcRenderer
      .invoke("runtime:install", root)
      .finally(() => ipcRenderer.removeListener("runtime:install-progress", listener));
  },
  onLinkedChanged: (cb: (path: string) => void): (() => void) => {
    const listener = (_e: unknown, path: string): void => cb(path);
    ipcRenderer.on("linked:changed", listener);
    return () => ipcRenderer.removeListener("linked:changed", listener);
  },
  /** Unified Open: pick any file; returns `kind: "project" | "import"`. */
  openFile: (): Promise<FileOpenResponse> => ipcRenderer.invoke("file:open"),
  /** Pick a ggplot script (.R): the file's text. The renderer translates it (`translateGgplot`)
   *  and shows the report; nothing is parsed or run here. */
  importScript: (): Promise<ImportScriptResponse> => ipcRenderer.invoke("file:importScript"),
  /** Subscribe to native-menu actions (File → Open, Save, …). Returns an unsubscribe fn. */
  onMenuAction: (cb: (action: string) => void): (() => void) => {
    const listener = (_e: unknown, action: string): void => cb(action);
    ipcRenderer.on("menu:action", listener);
    return () => ipcRenderer.removeListener("menu:action", listener);
  },
  /** Open/import a specific path (recent files, drag-and-drop). */
  openPath: (path: string): Promise<FileOpenResponse> => ipcRenderer.invoke("file:openPath", path),
  /** The `.mady` MadY was started to open (a double-click in Explorer), once; else null. */
  launchFile: (): Promise<string | null> => ipcRenderer.invoke("launch:file"),
  /** A `.mady` double-clicked while MadY is already open. Returns an unsubscribe fn. */
  onLaunchOpen: (cb: (path: string) => void): (() => void) => {
    const listener = (_e: unknown, path: string): void => cb(path);
    ipcRenderer.on("launch:open", listener);
    return () => ipcRenderer.removeListener("launch:open", listener);
  },
  /** Unsaved work is about to be replaced by another project: Save / Don't Save / Cancel. */
  askUnsaved: (): Promise<"save" | "discard" | "cancel"> => ipcRenderer.invoke("app:ask-unsaved"),
  /** Resolve a dropped File to its absolute path (drag-and-drop import). */
  getPathForFile: (file: File): string => webUtils.getPathForFile(file),
  /** Read the OS clipboard as plain text (paste-import). Synchronous IPC so the
   * paste-import call site stays sync; the read itself happens in main, because a
   * sandboxed preload has no `clipboard` module (see the clipboard block in main). */
  readClipboardText: (): string => {
    const text: unknown = ipcRenderer.sendSync("clipboard:readText");
    return typeof text === "string" ? text : "";
  },
  /** List recently opened/saved files. */
  recentFiles: (): Promise<RecentEntry[]> => ipcRenderer.invoke("recents:list"),
  /** Write the latest in-memory project to the userData autosave slot (crash-recovery). */
  autosaveWrite: (snapshot: AutosaveSnapshot): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke("autosave:write", snapshot),
  /** The snapshot captured at startup if the previous session crashed, else null. */
  autosaveRecovered: (): Promise<AutosaveSnapshot | null> =>
    ipcRenderer.invoke("autosave:recovered"),
  /** Discard the autosave slot (after recover or discard). */
  autosaveClear: (): Promise<{ ok: boolean }> => ipcRenderer.invoke("autosave:clear"),
  /** Tell main whether the document has unsaved changes, so a clean quit keeps the
   *  crash-recovery snapshot when there is unsaved work (and can warn before closing). */
  setDirty: (dirty: boolean): void => ipcRenderer.send("app:dirty", dirty),
  /** After the "Save" choice on the unsaved-changes close prompt has saved, tell main it
   *  may now close the window (the renderer only calls this once the save succeeded). */
  confirmClose: (): void => ipcRenderer.send("app:close-confirmed"),
  /** The whole user manual as one self-contained HTML file, or null when it has not been
   *  generated (a dev checkout that has never run `scripts/gen-manual-html.mjs`). */
  readManual: (): Promise<string | null> => ipcRenderer.invoke("manual:read"),
  /** Read the durable user style-library slot (presets/profile), or null. */
  userLibRead: (): Promise<UserLibrary | null> => ipcRenderer.invoke("userlib:read"),
  /** Mirror the durable user style library to the userData slot. */
  userLibWrite: (lib: UserLibrary): Promise<{ ok: boolean }> => ipcRenderer.invoke("userlib:write", lib),
  /** Export the style library to a user-chosen portable `.json`. */
  userLibExport: (lib: UserLibrary): Promise<UserLibExportResponse> => ipcRenderer.invoke("userlib:export", lib),
  /** Pick + read a previously exported style-library `.json` (Import). */
  userLibImport: (): Promise<UserLibImportResponse> => ipcRenderer.invoke("userlib:import"),
  /** Pick one or more exported preset files (`.mady-preset.json`) and read their text. */
  presetImport: (): Promise<PresetImportResponse> => ipcRenderer.invoke("preset:import"),
  /**
   * Export bytes in any export format (graph PNG/SVG/PDF/TIFF/JPG/EPS/HTML/PPTX, data
   * CSV/XLSX/JSON, Python script, Markdown) to a user-chosen file.
   */
  exportFile: (payload: ExportPayload): Promise<ExportResponse> =>
    ipcRenderer.invoke("file:export", payload),
  /** Export all: pick the folder every graph / figure is written into (null = cancelled). */
  pickExportFolder: (): Promise<string | null> => ipcRenderer.invoke("export:pickFolder"),
  /** Export all: write files into the folder picked with `pickExportFolder` (any other folder is refused). */
  exportMany: (req: { dir: string; files: { name: string; payload: ExportPayload }[]; replace: boolean }): Promise<ExportManyResponse> =>
    ipcRenderer.invoke("file:exportMany", req),
  /** Print a graph/figure SVG (fixed page) or a datasheet as HTML (flowing, paginated page)
   *  via the OS print dialog, rendered in a hidden window. */
  printFigure: (payload: { svg: string; width: number; height: number } | { html: string }): Promise<PrintResponse> =>
    ipcRenderer.invoke("figure:print", payload),
  /** Copy a base64 PNG to the OS clipboard as an image, ready to paste into another program. */
  copyImageToClipboard: (base64Png: string): void => {
    ipcRenderer.send("clipboard:writeImage", base64Png);
  },
  /** Copy text (e.g. an SVG string, or a bug report) to the OS clipboard. */
  copyTextToClipboard: (text: string): void => {
    ipcRenderer.send("clipboard:writeText", text);
  },
  /** Gather main-side diagnostics (versions, OS, app-log tail) for a bug report. */
  bugReportContext: (): Promise<BugReportContext> => ipcRenderer.invoke("bugreport:context"),
  /** Zip an assembled report's files to a user-chosen `.zip` (local; nothing is uploaded).
   *  An entry with `base64: true` carries binary content (e.g. the opt-in screenshot). */
  bugReportSave: (files: { name: string; content: string; base64?: boolean }[], stem: string): Promise<BugReportSaveResponse> =>
    ipcRenderer.invoke("bugreport:save", { files, stem }),
  /** Capture the window as a PNG for the bug report's opt-in screenshot attachment. */
  bugReportScreenshot: (): Promise<{ ok: boolean; base64?: string; error?: string }> =>
    ipcRenderer.invoke("bugreport:screenshot"),
};

export type MadyBridge = typeof api;

// contextIsolation is enforced on in main; expose the bridge through it.
if (process.contextIsolated) {
  contextBridge.exposeInMainWorld("mady", api);
} else {
  throw new Error("[preload] contextIsolation must be enabled");
}
