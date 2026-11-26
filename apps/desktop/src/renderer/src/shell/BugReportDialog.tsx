import type React from "react";
import { useEffect, useMemo, useState } from "react";
import {
  assembleReport,
  buildMailtoUrl,
  BUG_REPORT_EMAIL,
  CATEGORY_LABELS,
  DEFAULT_INCLUDE,
  recentEngineCalls,
  recentErrors,
  recentInteractions,
  redactPaths,
  type AppStateSnapshot,
  type AttachedAnalysis,
  type BugCategory,
  type BugPrefill,
  type BugReportContext,
  type CapturedError,
  type CapturedInteraction,
  type EngineCallRecord,
  type IncludeFlags,
} from "./bugReport";
import { GuideHelp } from "./guideLink";

/**
 * Report a bug — a free-text description plus diagnostics, reviewed and saved as a
 * local `.zip`. Nothing is uploaded.
 *
 * Consent is per piece: every piece of information in the report is disclosed, and the
 * user opts in or out of each one. Every piece is a labelled tickbox below; context pieces
 * (versions, state, errors, clicks, log) start on, and everything that carries data (engine
 * calls, an analysis, the screenshot, the document) starts off. The review pane and the saved
 * report both open with the same disclosure list.
 */
export function BugReportDialog({
  onClose,
  prefill,
  documentName,
  getDocumentJson,
  state,
  analysisName,
  getAnalysis,
}: {
  onClose: () => void;
  prefill?: BugPrefill | undefined;
  /** Name of the current document, for the opt-in "attach my document" line. */
  documentName?: string | undefined;
  /** Serialize the current document to `.mady` JSON — called only on save, only if attached. */
  getDocumentJson?: (() => string) | undefined;
  /** What was on screen when the reporter opened (names/kinds, no data values). */
  state?: AppStateSnapshot | null | undefined;
  /** Name of the open analysis, for the opt-in attach-this-analysis line. */
  analysisName?: string | undefined;
  /** Build the analysis + its used columns — called only on save, only if attached. */
  getAnalysis?: (() => AttachedAnalysis) | undefined;
}) {
  const build = typeof __MADY_BUILD__ !== "undefined" ? __MADY_BUILD__ : "dev";
  const edition = typeof __MADY_EDITION__ !== "undefined" ? __MADY_EDITION__ : "Standard";

  const [title, setTitle] = useState(prefill?.title ?? "");
  const [description, setDescription] = useState(prefill?.description ?? "");
  const [category, setCategory] = useState<BugCategory>(prefill?.category ?? "wrong-result");
  const [include, setInclude] = useState<IncludeFlags>(DEFAULT_INCLUDE);
  const [ctx, setCtx] = useState<BugReportContext | null>(null);
  // Frozen at open: the trail then ends at the moment the user reached for the reporter —
  // exactly the window that holds the bug — instead of filling with the dialog's own clicks.
  const [errors] = useState<CapturedError[]>(() => recentErrors());
  const [interactions] = useState<CapturedInteraction[]>(() => recentInteractions());
  const [engineCalls] = useState<EngineCallRecord[]>(() => recentEngineCalls());
  const [saving, setSaving] = useState(false);
  const [savedPath, setSavedPath] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [emailed, setEmailed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canScreenshot = typeof window.mady?.bugReportScreenshot === "function";

  useEffect(() => {
    let live = true;
    window.mady
      ?.bugReportContext()
      .then((c) => { if (live) setCtx(c as unknown as BugReportContext); })
      .catch(() => { if (live) setError("Could not gather diagnostics from the app."); });
    return () => { live = false; };
  }, []);

  const flag = (key: keyof IncludeFlags) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setInclude((f) => ({ ...f, [key]: e.target.checked }));

  /** The assembly input for preview and copy: names only — neither the document nor the
   *  analysis is serialized until save, and only when ticked. */
  const textInput = (whenISO: string) => ({
    form: { title, description, category },
    ctx: ctx!,
    errors,
    build,
    edition,
    whenISO,
    include,
    state: state ?? null,
    interactions,
    engineCalls,
    analysis: include.analysis && analysisName ? { name: analysisName, method: "", params: "", result: "", data: {} } : null,
    screenshotAttached: include.screenshot && canScreenshot,
    document: include.document ? { name: documentName ?? "your document", json: "" } : null,
  });

  // A live preview of the report.md that will be saved, so the user sees what leaves.
  const preview = useMemo(() => {
    if (!ctx) return null;
    return assembleReport(textInput("(set when you save)")).reportMarkdown;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx, title, description, category, errors, build, edition, include, documentName, analysisName, state, interactions, engineCalls]);

  // The "copied" confirmation must not outlive what it described: edit any field and the
  // text on the clipboard is no longer the report shown below, so the note clears itself.
  useEffect(() => { setCopied(false); setEmailed(false); }, [preview]);

  /**
   * Open the user's own mail app, pre-addressed to the MadY inbox with a compact report as the
   * body. `window.open` routes the `mailto:` through Electron's window-open handler →
   * `shell.openExternal` → the default mail client; the app itself makes no network call. The
   * screenshot / document / full log can't ride in a mailto, so the body says to attach the .zip.
   */
  const emailReport = (): void => {
    if (!ctx) return;
    try {
      window.open(buildMailtoUrl(textInput(new Date().toISOString())));
      setEmailed(true);
      setError(null);
    } catch (e) {
      setError(`Could not open your email app — you can Copy the report instead: ${String(e)}`);
    }
  };

  /**
   * Put the report on the clipboard so it can be pasted straight into an email, chat or
   * issue — the delivery route that needs no server, no account and no network code.
   * What is copied is exactly the markdown in the review pane (already username-redacted);
   * the attachments stay in the `.zip`, and the report's own disclosure list says so.
   */
  const copy = (): void => {
    if (!ctx) return;
    const md = assembleReport(textInput(new Date().toISOString())).reportMarkdown;
    try {
      if (window.mady?.copyTextToClipboard) window.mady.copyTextToClipboard(md);
      else void navigator.clipboard?.writeText(md);
      setCopied(true);
      setError(null);
    } catch (e) {
      setError(`Could not copy the report: ${String(e)}`);
    }
  };

  const save = async (): Promise<void> => {
    if (!ctx || !window.mady) return;
    setSaving(true);
    setError(null);
    try {
      const report = assembleReport({
        ...textInput(new Date().toISOString()),
        analysis: include.analysis && getAnalysis ? getAnalysis() : null,
        document: include.document && getDocumentJson ? { name: documentName ?? "document", json: getDocumentJson() } : null,
      });
      const files: { name: string; content: string; base64?: boolean }[] = [...report.files];
      if (include.screenshot && canScreenshot) {
        const shot = await window.mady.bugReportScreenshot();
        if (shot.ok && shot.base64) files.push({ name: "screenshot.png", content: shot.base64, base64: true });
        else setError(shot.error ?? "Could not capture the screenshot — the report was saved without it.");
      }
      const res = await window.mady.bugReportSave(files, report.stem);
      if (res.ok) setSavedPath(res.path);
      else if (!res.canceled) setError(res.error ?? "Could not save the report.");
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  };

  /** One consent row: a tickbox, the piece's name, and what it carries — in plain words. */
  const row = (key: keyof IncludeFlags, label: string, carries: string, disabled = false): React.ReactNode => (
    <label className="brf-doc">
      <input type="checkbox" checked={include[key]} onChange={flag(key)} disabled={disabled} aria-label={label} />
      <span>
        {label} — <em>{carries}</em>
      </span>
    </label>
  );

  return (
    <div className="modalov" onClick={onClose}>
      <div className="modal modal-wide" role="dialog" aria-label="Report a bug" onClick={(e) => e.stopPropagation()}>
        <div className="modalh-row">
          <h3 className="modalh">Report a bug</h3>
          <GuideHelp target={{ entry: "action:report-bug" }} what="Report a bug" />
        </div>
        <p className="note">
          <strong>Email report</strong> opens your own mail app addressed to us with the details
          filled in — just press send. For a screenshot, your document or the full log,
          <strong> Save report</strong> writes a <strong>local .zip</strong> to attach; or
          <strong> Copy report</strong> to paste elsewhere. Nothing is ever uploaded, and nothing
          you untick leaves this computer.
          {/* Some people want to send without more effort — say so up front. */}
          {" "}<strong>Everything here is optional</strong> — a summary alone is already a useful
          report.
        </p>

        <div className="importopts">
          <label>
            Category
            <select aria-label="Category" value={category} onChange={(e) => setCategory(e.target.value as BugCategory)}>
              {(Object.keys(CATEGORY_LABELS) as BugCategory[]).map((c) => (
                <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>
              ))}
            </select>
          </label>
        </div>

        <label className="brf-label">
          <span>Summary</span>
          <input
            type="text"
            aria-label="Summary"
            placeholder="One line: what went wrong"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>

        <label className="brf-label">
          <span>What happened</span>
          <textarea
            aria-label="What happened"
            rows={4}
            placeholder="What did you do, what did you expect, and what happened instead?"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </label>

        <div className="brf-included">
          <div className="brf-inc-h">What to include — tick what may leave with the report</div>
          {row("environment", "App, OS & stats-engine versions", "version numbers only")}
          {row("state", "What was on screen", "graph kind & names, no data values")}
          {row("errors", `Captured errors (${errors.length})`, "recent error messages, file paths redacted")}
          {row("interactions", `Recent clicks & drags (${interactions.length})`, "element names, no data values")}
          {row("logTail", "Application log", "recent app log, file paths redacted")}
          {row("engineCalls", `Statistics engine calls (${engineCalls.length})`, "includes the analysis input data", engineCalls.length === 0)}
          {analysisName && getAnalysis && row("analysis", `Analysis “${analysisName}” + the columns it used`, "includes that data")}
          {canScreenshot && row("screenshot", "Window screenshot", "shows whatever is on screen")}
          {row("document", `My whole document${documentName ? ` (“${documentName}”)` : ""}`, "includes all your data", !getDocumentJson)}
        </div>

        <details className="brf-review">
          <summary>Review exactly what will be saved</summary>
          <pre className="brf-pre">{preview ?? "Gathering diagnostics…"}</pre>
          {ctx && include.logTail && (
            <>
              <div className="brf-inc-h">app-log-tail.txt (redacted)</div>
              <pre className="brf-pre brf-log">{redactPaths(ctx.logTail || "(empty)")}</pre>
            </>
          )}
        </details>

        {emailed && (
          <p className="note brf-ok">
            Your mail app should have opened, addressed to <strong>{BUG_REPORT_EMAIL}</strong> — just
            press send. For the screenshot, your document or the full log, <strong>Save report
            (.zip)</strong> and attach the file before you send.
          </p>
        )}
        {savedPath && <p className="note brf-ok">Saved to {savedPath}</p>}
        {copied && (
          <p className="note brf-ok">
            Report copied — paste it into an email, chat or issue. The ticked attachments are in
            the <strong>.zip</strong> only; save it too if you were asked for them.
          </p>
        )}
        {error && <p className="note brf-err">{error}</p>}

        <div className="modalbtns">
          <button className="btn-ghost" onClick={onClose}>{savedPath || copied || emailed ? "Done" : "Cancel"}</button>
          <button className="btn-ghost" onClick={copy} disabled={!ctx}>
            {copied ? "Copy again" : "Copy report"}
          </button>
          <button className="btn-ghost" onClick={() => void save()} disabled={!ctx || saving}>
            {saving ? "Saving…" : savedPath ? "Save again" : "Save report (.zip)"}
          </button>
          <button className="btn" onClick={emailReport} disabled={!ctx}>
            {emailed ? "Email again" : "Email report"}
          </button>
        </div>
      </div>
    </div>
  );
}
