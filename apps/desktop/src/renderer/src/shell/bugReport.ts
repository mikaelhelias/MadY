/**
 * Bug-report assembly — pure + DOM-light so it is unit-testable.
 *
 * Two jobs:
 *  1. A small ring buffer that captures recent runtime errors (window `error` /
 *     `unhandledrejection`, `console.error`, and React error boundaries) so a report
 *     filed after something broke still carries what broke — including the silent
 *     failures the UI may have swallowed.
 *  2. Assembling the human-readable report + a structured manifest + the attachment
 *     set that gets zipped. Everything the app captured is redacted of usernames
 *     (file paths) before it leaves, and nothing here reads the user's document — the
 *     dialog passes that in only when the user opts to attach it.
 */

export type ErrorSource = "error" | "unhandledrejection" | "console" | "boundary";

export interface CapturedError {
  /** ISO timestamp. */
  when: string;
  source: ErrorSource;
  message: string;
}

const MAX_ERRORS = 50;
const ring: CapturedError[] = [];
let installed = false;

/** Record one runtime error into the ring buffer (oldest dropped past the cap). */
export function pushCapturedError(source: ErrorSource, message: string): void {
  ring.push({ when: new Date().toISOString(), source, message: String(message).slice(0, 2000) });
  if (ring.length > MAX_ERRORS) ring.splice(0, ring.length - MAX_ERRORS);
}

/** A copy of the captured errors, oldest first. */
export function recentErrors(): CapturedError[] {
  return ring.slice();
}

/** Drop everything captured so far (used by tests). */
export function clearCapturedErrors(): void {
  ring.length = 0;
}

/**
 * Start capturing runtime errors. Idempotent, and installed as early as possible (the
 * renderer entry) so failures during startup are caught too. Wraps `console.error`
 * rather than replacing it — the original still runs.
 */
export function installErrorCapture(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;
  window.addEventListener("error", (e) => {
    const ev = e as ErrorEvent;
    pushCapturedError("error", ev.error?.stack || ev.message || "error");
  });
  window.addEventListener("unhandledrejection", (e) => {
    const reason = (e as PromiseRejectionEvent).reason;
    pushCapturedError("unhandledrejection", reason?.stack || String(reason));
  });
  const original = console.error.bind(console);
  console.error = (...args: unknown[]): void => {
    pushCapturedError("console", args.map((a) => (a instanceof Error ? a.stack || a.message : String(a))).join(" "));
    original(...args);
  };
}

// ─── Interaction trail ───────────────────────────────────────────────────────
//
// The error ring only sees failures that throw or log. A common class of defect —
// an object that does not drag, a click that opens nothing — throws nothing, so a report
// about it would carry no evidence at all. This ring records what the user did: clicks
// and drags (captured globally, no per-handler wiring) with a compact description of the
// element hit, plus the document version at that moment. A drag after which the version
// did not move is the silent no-op, self-reported.

export interface CapturedInteraction {
  when: string;
  kind: "click" | "drag";
  /** Compact target descriptor — tag, id/data hooks, a snip of its text. No free data:
   *  text is capped hard so a cell value cannot ride out in full. */
  target: string;
  /** Drag only: pointer travel in px. */
  travel?: number | undefined;
  /** Document version when the gesture landed — two entries with the same version and a
   *  drag between them = the drag changed nothing. */
  v: number;
}

const MAX_INTERACTIONS = 80;
const interactions: CapturedInteraction[] = [];
let interactionsInstalled = false;
let docVersion = 0;

/** AppShell reports the live document version here so entries can carry it. */
export function noteDocVersion(v: number): void {
  docVersion = v;
}

/** A compact, data-safe description of a clicked element. */
export function describeTarget(el: unknown): string {
  if (!(el instanceof Element)) return "(not an element)";
  const parts: string[] = [el.tagName.toLowerCase()];
  if (el.id) parts.push(`#${el.id}`);
  const cls = (el.getAttribute("class") ?? "").split(/\s+/).filter(Boolean).slice(0, 3).join(".");
  if (cls) parts.push(`.${cls}`);
  for (const a of el.getAttributeNames()) {
    if (a.startsWith("data-")) parts.push(`[${a}=${(el.getAttribute(a) ?? "").slice(0, 24)}]`);
  }
  const label = el.getAttribute("aria-label") ?? el.getAttribute("title");
  if (label) parts.push(`“${label.slice(0, 40)}”`);
  else {
    const txt = (el.textContent ?? "").trim().replace(/\s+/g, " ");
    if (txt) parts.push(`“${txt.slice(0, 30)}${txt.length > 30 ? "…" : ""}”`);
  }
  return parts.join(" ").slice(0, 160);
}

export function pushInteraction(entry: Omit<CapturedInteraction, "when" | "v">): void {
  interactions.push({ when: new Date().toISOString(), v: docVersion, ...entry });
  if (interactions.length > MAX_INTERACTIONS) interactions.splice(0, interactions.length - MAX_INTERACTIONS);
}

export function recentInteractions(): CapturedInteraction[] {
  return interactions.slice();
}

export function clearInteractions(): void {
  interactions.length = 0;
}

const DRAG_PX = 4;

/**
 * Start recording clicks and drags. Capture phase on `window`, so no component needs
 * wiring and an element that does nothing (the case this trail is for) is recorded exactly like a working one.
 * Idempotent; installed at the renderer entry beside `installErrorCapture`.
 */
export function installInteractionCapture(): void {
  if (interactionsInstalled || typeof window === "undefined") return;
  interactionsInstalled = true;
  let down: { x: number; y: number; target: string } | null = null;
  window.addEventListener(
    "pointerdown",
    (e) => {
      down = { x: e.clientX, y: e.clientY, target: describeTarget(e.target) };
    },
    true,
  );
  window.addEventListener(
    "pointerup",
    (e) => {
      if (!down) return;
      const travel = Math.hypot(e.clientX - down.x, e.clientY - down.y);
      // A drag is recorded from its own gesture; plain presses fall through to `click`
      // below (which jsdom fires too, so both paths stay testable).
      if (travel > DRAG_PX) pushInteraction({ kind: "drag", target: down.target, travel: Math.round(travel) });
      down = null;
    },
    true,
  );
  window.addEventListener(
    "click",
    (e) => {
      pushInteraction({ kind: "click", target: describeTarget(e.target) });
    },
    true,
  );
}

/** The trail as text, one line per gesture, oldest first. */
export function interactionsText(list: CapturedInteraction[]): string {
  if (!list.length) return "None captured.";
  return list
    .map((i) => `[${i.when}] (v${i.v}) ${i.kind}${i.travel != null ? ` ${i.travel}px` : ""} on ${i.target}`)
    .join("\n");
}

// ─── Engine-call ring ────────────────────────────────────────────────────────
//
// The strongest evidence for a wrong-statistics report is the exact request the app
// framed to the Python engine and the exact response — a byte-exact replay. Recorded at
// the one choke point every analysis passes through (`runEngine`). Caution: the request
// holds the analysis' input data, so this ring ships only behind an explicit opt-in.

export interface EngineCallRecord {
  when: string;
  method: string;
  ok: boolean;
  /** Wall-clock duration, ms. */
  ms: number;
  /** JSON of what was sent (params + framed data), truncated at the cap. */
  request: string;
  /** JSON of the result or the error text, truncated at the cap. */
  response: string;
}

const MAX_ENGINE_CALLS = 8;
const REQUEST_CAP = 100_000;
const RESPONSE_CAP = 40_000;
const engineCalls: EngineCallRecord[] = [];

const truncate = (s: string, cap: number): string =>
  s.length > cap ? `${s.slice(0, cap)}\n…(truncated, ${s.length} chars total)` : s;

export function recordEngineCall(entry: { method: string; ok: boolean; ms: number; request: string; response: string }): void {
  engineCalls.push({
    when: new Date().toISOString(),
    method: entry.method,
    ok: entry.ok,
    ms: entry.ms,
    request: truncate(entry.request, REQUEST_CAP),
    response: truncate(entry.response, RESPONSE_CAP),
  });
  if (engineCalls.length > MAX_ENGINE_CALLS) engineCalls.splice(0, engineCalls.length - MAX_ENGINE_CALLS);
}

export function recentEngineCalls(): EngineCallRecord[] {
  return engineCalls.slice();
}

export function clearEngineCalls(): void {
  engineCalls.length = 0;
}

/**
 * Replace the user segment of home paths with a placeholder, so a log tail or stack
 * does not leak the account name. Covers Windows (`C:\Users\name`) and POSIX
 * (`/Users/name`, `/home/name`).
 */
export function redactPaths(text: string): string {
  return text
    .replace(/([A-Za-z]:\\Users\\)[^\\/\r\n]+/g, "$1<user>")
    .replace(/(\/Users\/)[^/\r\n]+/g, "$1<user>")
    .replace(/(\/home\/)[^/\r\n]+/g, "$1<user>");
}

export type BugCategory = "crash" | "wrong-result" | "cosmetic" | "other";

/** Fields a caller (e.g. an error boundary) can prefill when opening the reporter. */
export interface BugPrefill {
  title?: string;
  description?: string;
  category?: BugCategory;
}

/** The window event AppShell listens for to open the reporter from anywhere (decoupled
 *  from the component tree, so a class error-boundary can request it without props). */
export const BUG_REPORT_EVENT = "mady:report-bug";

/** Ask the app to open the bug reporter, optionally prefilled. No-op outside a window. */
export function requestBugReport(prefill: BugPrefill = {}): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(BUG_REPORT_EVENT, { detail: prefill }));
  }
}

export const CATEGORY_LABELS: Record<BugCategory, string> = {
  crash: "Crash or error",
  "wrong-result": "Wrong result / output",
  cosmetic: "Cosmetic / layout",
  other: "Something else",
};

/** Main-process context (versions, OS, log tail) — mirrors preload's `BugReportContext`. */
export interface BugReportContext {
  app: { name: string; version: string; electron: string; chromium: string; node: string } | null;
  engine: { engine: string | null; contractVersion: number | null; libraries: Record<string, string> } | null;
  os: { platform: string; release: string; arch: string; totalMemMB: number; cpus: number } | null;
  logTail: string;
}

export interface BugReportForm {
  title: string;
  description: string;
  category: BugCategory;
}

/** What the app was showing when the report was written — the "here" in "the legend
 *  here should be editable". Names and kinds only; no data values. */
export interface AppStateSnapshot {
  activeTab: string;
  plotId?: string | undefined;
  plotKind?: string | undefined;
  plotName?: string | undefined;
  tableId?: string | undefined;
  /** The current graph selection, as JSON (element kinds + ids, not data). */
  selection?: string | undefined;
  zoom?: number | undefined;
  counts?: { tables: number; plots: number; analyses: number } | undefined;
}

/** One analysis + only the source columns it used — the small-consent alternative to
 *  attaching the whole document for a wrong-result report. Caution: carries data. */
export interface AttachedAnalysis {
  name: string;
  method: string;
  params: string;
  result: string;
  /** The used source columns, name → values. */
  data: Record<string, (number | string | null)[]>;
}

/**
 * Per-piece consent. Any information sent must be explicitly disclosed, and
 * the user should be able to opt in or out of sending each piece of info. Every flag
 * here is a tickbox in the dialog; the assembler honours them one by one, and report.md
 * opens with a disclosure table saying which pieces are in and which were withheld.
 */
export interface IncludeFlags {
  /** App/OS/engine versions + the environment section. */
  environment: boolean;
  /** The main-process log tail (paths redacted). */
  logTail: boolean;
  /** The captured-error ring (paths redacted). */
  errors: boolean;
  /** The what-was-on-screen snapshot (names/kinds, no data). */
  state: boolean;
  /** The click/drag trail (element descriptors, no data values). */
  interactions: boolean;
  /** Recent engine requests/responses — carries analysis input data. */
  engineCalls: boolean;
  /** One analysis + its used columns — carries data. */
  analysis: boolean;
  /** A window screenshot — shows whatever is on screen. */
  screenshot: boolean;
  /** The whole document — carries all data. */
  document: boolean;
}

/** The dialog's defaults: description/context on, everything that carries data off. */
export const DEFAULT_INCLUDE: IncludeFlags = {
  environment: true,
  logTail: true,
  errors: true,
  state: true,
  interactions: true,
  engineCalls: false,
  analysis: false,
  screenshot: false,
  document: false,
};

export interface AssembleInput {
  form: BugReportForm;
  ctx: BugReportContext;
  errors: CapturedError[];
  build: string;
  edition: string;
  whenISO: string;
  /** Which pieces the user ticked. Missing = every piece that carries no data is on. */
  include?: IncludeFlags | undefined;
  state?: AppStateSnapshot | null | undefined;
  interactions?: CapturedInteraction[] | null | undefined;
  engineCalls?: EngineCallRecord[] | null | undefined;
  analysis?: AttachedAnalysis | null | undefined;
  /** True when a screenshot will ride in the zip (captured outside this pure module). */
  screenshotAttached?: boolean | undefined;
  /** The current document, present only when the user opted to attach it. */
  document?: { name: string; json: string } | null;
}

export interface ReportManifest {
  schema: 2;
  when: string;
  title: string;
  category: BugCategory;
  build: string;
  edition: string;
  app: BugReportContext["app"];
  engine: BugReportContext["engine"];
  os: BugReportContext["os"];
  errorCount: number;
  documentAttached: boolean;
  /** Exactly what the user consented to — the disclosure, machine-readable. */
  included: IncludeFlags;
}

export interface AssembledReport {
  /** The `.zip` filename stem (no extension). */
  stem: string;
  /** report.md — also shown in the dialog's review pane. */
  reportMarkdown: string;
  /** Every file that goes into the archive. */
  files: { name: string; content: string }[];
}

/** `mady-bug-YYYYMMDD-HHMMSS` from an ISO timestamp. */
function reportStem(whenISO: string): string {
  const digits = whenISO.replace(/[^\dTZ]/g, "");
  const [date, time = ""] = digits.split("T");
  return `mady-bug-${(date ?? "").slice(0, 8)}-${time.slice(0, 6)}`;
}

function libLine(libs: Record<string, string> | undefined): string {
  const entries = Object.entries(libs ?? {});
  return entries.length ? entries.map(([k, v]) => `${k} ${v}`).join(", ") : "not reported";
}

function errorsText(errors: CapturedError[]): string {
  if (!errors.length) return "None captured.";
  return errors.map((e) => `[${e.when}] (${e.source}) ${e.message}`).join("\n");
}

/** The flags actually in force for an input (absent = the pre-consent defaults, with the
 *  data-bearing pieces derived from whether the piece was passed at all). */
function flagsOf(input: AssembleInput): IncludeFlags {
  return (
    input.include ?? {
      ...DEFAULT_INCLUDE,
      engineCalls: !!input.engineCalls?.length,
      analysis: !!input.analysis,
      screenshot: !!input.screenshotAttached,
      document: !!input.document,
    }
  );
}

/** The structured manifest — machine-readable triage fields (no free-form log). */
export function buildManifest(input: AssembleInput): ReportManifest {
  const include = flagsOf(input);
  return {
    schema: 2,
    when: input.whenISO,
    title: input.form.title.trim(),
    category: input.form.category,
    build: input.build,
    edition: input.edition,
    // Withheld environment = withheld everywhere, the manifest included.
    app: include.environment ? input.ctx.app : null,
    engine: include.environment ? input.ctx.engine : null,
    os: include.environment ? input.ctx.os : null,
    errorCount: include.errors ? input.errors.length : 0,
    documentAttached: include.document && !!input.document,
    included: include,
  };
}

function stateText(s: AppStateSnapshot): string {
  const bits = [
    `active tab: ${s.activeTab}`,
    s.plotKind ? `graph: ${s.plotName ?? "?"} (${s.plotKind}, ${s.plotId ?? "?"})` : null,
    s.tableId ? `datasheet: ${s.tableId}` : null,
    s.selection ? `selection: ${s.selection}` : null,
    s.zoom != null ? `zoom: ${Math.round(s.zoom * 100)}%` : null,
    s.counts ? `project: ${s.counts.tables} datasheets · ${s.counts.plots} graphs · ${s.counts.analyses} analyses` : null,
  ];
  return bits.filter(Boolean).join("\n");
}

/** The human-readable report.md — opens with the disclosure, one line per piece. */
export function buildReportMarkdown(input: AssembleInput): string {
  const { form, ctx } = input;
  const include = flagsOf(input);
  const app = ctx.app;
  const os = ctx.os;
  const engine = ctx.engine;
  const inOut = (on: boolean, label: string): string => `- [${on ? "x" : " "}] ${label}${on ? "" : " — withheld"}`;
  const lines: string[] = [
    "# MadY bug report",
    "",
    `**Title:** ${form.title.trim() || "(none)"}`,
    `**Category:** ${CATEGORY_LABELS[form.category]}`,
    `**When:** ${input.whenISO}`,
    "",
    // The disclosure — every piece this report could carry, and whether it does. The
    // withheld lines stay listed on purpose: "not sent" is information the reader needs.
    "## What this report contains",
    inOut(include.environment, "App, OS & stats-engine versions"),
    inOut(include.state, "What was on screen (graph kind & names, no data)"),
    inOut(include.errors, `Captured errors (${input.errors.length})`),
    inOut(include.interactions, "Recent clicks & drags (element names, no data)"),
    inOut(include.logTail, "Application log tail"),
    inOut(include.engineCalls, "Statistics engine calls — includes analysis input data"),
    inOut(include.analysis, "One analysis + the columns it used — includes data"),
    inOut(include.screenshot, "Window screenshot"),
    inOut(include.document, "The whole document — includes all data"),
    "",
    "## What happened",
    form.description.trim() || "(no description provided)",
    "",
  ];
  if (include.environment) {
    lines.push(
      "## Environment",
      `- MadY ${app?.version ?? "?"} — build \`${input.build}\`, ${input.edition} edition`,
      os
        ? `- OS: ${os.platform} ${os.release} (${os.arch}) · ${os.cpus} CPUs · ${os.totalMemMB} MB RAM`
        : "- OS: unavailable",
      app ? `- Electron ${app.electron} · Chromium ${app.chromium} · Node ${app.node}` : "- Runtime: unavailable",
      "",
      "## Stats engine",
      `- Engine: ${engine?.engine ?? "not started"}${engine?.contractVersion != null ? ` (contract v${engine.contractVersion})` : ""}`,
      `- Libraries: ${libLine(engine?.libraries)}`,
      "",
    );
  }
  if (include.state && input.state) {
    lines.push("## What was on screen", stateText(input.state), "");
  }
  if (include.errors) {
    lines.push(
      `## Recent errors (${input.errors.length})`,
      // Redacted here too, not only in console-errors.log: this markdown is what the review
      // pane shows and what "Copy report" puts on the clipboard, so it is the copy most likely
      // to be pasted somewhere public. An error message routinely carries a stack frame with
      // the user's home directory in it.
      redactPaths(errorsText(input.errors)),
      "",
    );
  }
  if (include.interactions && input.interactions) {
    lines.push(
      `## Recent clicks & drags (${input.interactions.length})`,
      "A drag whose document version (vN) does not move afterwards changed nothing, which is what a control that does nothing looks like here.",
      redactPaths(interactionsText(input.interactions)),
      "",
    );
  }
  const att: string[] = ["## Attachments", "- `manifest.json` — structured fields for triage, incl. the consent list"];
  if (include.logTail) att.push("- `app-log-tail.txt` — recent application log (paths redacted)");
  if (include.errors) att.push("- `console-errors.log` — captured runtime errors (paths redacted)");
  if (include.interactions && input.interactions) att.push("- `interactions.log` — the click/drag trail (paths redacted)");
  if (include.engineCalls && input.engineCalls?.length) att.push("- `engine-calls.json` — recent engine requests/responses (includes analysis input data)");
  if (include.analysis && input.analysis) att.push(`- \`analysis.json\` — "${input.analysis.name}" + the columns it used (includes data)`);
  if (include.screenshot && input.screenshotAttached) att.push("- `screenshot.png` — the window as it looked when you saved");
  if (include.document && input.document) att.push(`- \`document.mady\` — the document you attached ("${input.document.name}")`);
  if (att.length === 2 && !include.logTail) att.push("- (nothing else attached)");
  lines.push(...att, "");
  return lines.join("\n");
}

/**
 * Assemble the full report: the markdown, the manifest, and every file that goes into
 * the `.zip`. Each piece is included only behind its consent flag; the log tail, captured
 * errors and interaction trail are redacted of usernames. (The screenshot binary is
 * added by the dialog at save time — this pure module only lists it.)
 */
export function assembleReport(input: AssembleInput): AssembledReport {
  const include = flagsOf(input);
  const reportMarkdown = buildReportMarkdown(input);
  const files: { name: string; content: string }[] = [
    { name: "report.md", content: reportMarkdown },
    { name: "manifest.json", content: JSON.stringify(buildManifest(input), null, 2) },
  ];
  if (include.logTail) files.push({ name: "app-log-tail.txt", content: redactPaths(input.ctx.logTail || "(empty)") });
  if (include.errors) files.push({ name: "console-errors.log", content: redactPaths(errorsText(input.errors)) });
  if (include.interactions && input.interactions) {
    files.push({ name: "interactions.log", content: redactPaths(interactionsText(input.interactions)) });
  }
  if (include.engineCalls && input.engineCalls?.length) {
    files.push({ name: "engine-calls.json", content: JSON.stringify(input.engineCalls, null, 2) });
  }
  if (include.analysis && input.analysis) {
    files.push({ name: "analysis.json", content: JSON.stringify(input.analysis, null, 2) });
  }
  if (include.document && input.document) {
    files.push({ name: "document.mady", content: input.document.json });
  }
  return { stem: reportStem(input.whenISO), reportMarkdown, files };
}

// ─── One-click email delivery (mailto:) ───────────────────────────────────────
//
// The delivery route: a button that opens the user's own mail app,
// pre-addressed, with a compact report as the body. The app makes no network call — it hands a
// `mailto:` URL to the OS exactly like clicking a link — so the offline / no-telemetry rule
// holds. `mailto` cannot attach a file, and its URL is length-limited (~2 KB on Windows once the
// address, subject and percent-encoding are counted), so the email carries only the text report;
// the screenshot, document and full log stay in the saved .zip, and the body says to attach it.

/** Where a filed bug report is emailed — a dedicated inbox, not a personal address. */
export const BUG_REPORT_EMAIL = "madygrapher@gmail.com";

/** Cap on the mailto body (raw chars, before percent-encoding) to keep the whole URL under the
 *  limit some mail clients / the Windows shell impose. */
const EMAIL_BODY_CAP = 1400;

/**
 * A compact, mailto-safe report body: the description, what was on screen, recent errors and the
 * versions — everything that is text and fits — honouring the same consent flags and path
 * redaction as the .zip. Binary pieces (screenshot, document) and the full log stay in the zip.
 */
export function buildEmailBody(input: AssembleInput): string {
  const { form, ctx } = input;
  const include = flagsOf(input);
  const parts: string[] = [
    `Category: ${CATEGORY_LABELS[form.category]}`,
    "",
    "What happened:",
    form.description.trim() || "(no description provided)",
  ];
  if (include.state && input.state) parts.push("", "What was on screen:", stateText(input.state));
  if (include.errors && input.errors.length) parts.push("", `Recent errors (${input.errors.length}):`, errorsText(input.errors));
  if (include.environment) {
    const { app, os, engine } = ctx;
    parts.push(
      "",
      `MadY ${app?.version ?? "?"} — build ${input.build}, ${input.edition} edition`,
      os ? `OS: ${os.platform} ${os.release} (${os.arch})` : "OS: unavailable",
      engine?.engine ? `Engine: ${engine.engine}` : "Engine: not started",
    );
  }
  parts.push("", "— For the screenshot, your document or the full log, click “Save report (.zip)” and attach the file to this email.");
  const body = redactPaths(parts.join("\n"));
  return body.length > EMAIL_BODY_CAP ? `${body.slice(0, EMAIL_BODY_CAP)}\n…(truncated — the full detail is in the .zip)` : body;
}

/**
 * A `mailto:` URL that files this report to {@link BUG_REPORT_EMAIL}: the summary as the subject,
 * {@link buildEmailBody} as the body. Open it with `window.open` so Electron's window-open
 * handler routes it to the OS mail client via `shell.openExternal`.
 */
export function buildMailtoUrl(input: AssembleInput): string {
  const subject = `MadY bug: ${input.form.title.trim() || "(no summary)"}`.slice(0, 200);
  const body = buildEmailBody(input);
  return `mailto:${BUG_REPORT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
