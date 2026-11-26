/**
 * The set-up: the button beside the model bar, and the one screen it opens.
 *
 * Install and configuration take one press and one informed stop; after that nothing else
 * asks anything:
 *
 *   [Activate, install & configure LLM]
 *     → the screen: what is downloaded (one sentence each), how big (exact for Ollama, expected
 *       for the model), where (a folder, with the drive's free space) — and Continue
 *     → download → verify → unpack → start → pull → test → save, each step shown as it runs
 *     → "Ready." The bar appears; the button becomes the model's chip.
 *
 * What it never does: download without stating the size; start onto a full disk (Continue is
 * disabled with the reason); duplicate an Ollama the user already runs (that one is used, and
 * the folder row says its own store is kept); save a config the model has not answered on
 * (the test round trip comes before the save); offer a hosted service (Advanced says so).
 *
 * The bridge is injected so every decision here is tested without Electron.
 */
import { useEffect, useState } from "react";
import { formatBytes } from "@mady/core";
import type {
  ModelChoiceInfo,
  ModelStatusResponse,
  RuntimeInstallProgress,
  RuntimeInstallResponse,
  RuntimeStatusResponse,
} from "../../../preload";

/** The button's label. */
export const SETUP_BUTTON_LABEL = "Activate, install & configure LLM";

/** Where a user goes when MadY's own fetch of the runtime fails and they would rather install it themselves. */
export const RUNTIME_DOWNLOAD_PAGE = "https://ollama.com/download";

export interface SetupBridge {
  modelStatus(): Promise<ModelStatusResponse>;
  runtimeStatus(root?: string): Promise<RuntimeStatusResponse>;
  pickFolder(current: string): Promise<string | null>;
  freeSpace(path: string): Promise<number | null>;
  installRuntime(root: string, onProgress: (p: RuntimeInstallProgress) => void): Promise<RuntimeInstallResponse>;
  pullModel(
    model: string,
    onProgress: (p: { status: string; completed?: number; total?: number }) => void,
  ): Promise<{ ok: boolean; bytes?: number; error?: string; serverMissing?: boolean }>;
  testModel(cfg?: { url?: string; model?: string }): Promise<{ ok: true; ms: number } | { ok: false; error: string }>;
  configureModel(cfg: { root: string; model: string | null; url?: string }): Promise<{ ok: true } | { ok: false; error: string }>;
  openExternal?(url: string): void;
}

/** The bridge the real app hands in — `window.mady`, or null in a browser preview. */
export function setupBridgeFromWindow(): SetupBridge | null {
  const w = window as unknown as { mady?: Record<string, unknown> };
  const m = w.mady;
  if (!m || typeof m.modelStatus !== "function" || typeof m.installRuntime !== "function") return null;
  const f = <T,>(k: string): T => (m[k] as T);
  return {
    modelStatus: f("modelStatus"),
    runtimeStatus: f("runtimeStatus"),
    pickFolder: f("pickModelFolder"),
    freeSpace: f("modelFreeSpace"),
    installRuntime: f("installRuntime"),
    pullModel: f("pullModel"),
    testModel: f("testModel"),
    configureModel: f("configureModel"),
    ...(typeof m.openExternal === "function" ? { openExternal: f<(u: string) => void>("openExternal") } : {}),
  };
}

// ---------------------------------------------------------------------------------------------
// The button
// ---------------------------------------------------------------------------------------------

export function ModelButton({ status, onClick }: { status: ModelStatusResponse | null; onClick: () => void }): React.ReactElement {
  const ready = status?.phase === "ready" && status.settings.model;
  return (
    <button
      className={"chip modelbtn" + (ready ? " on" : "")}
      onClick={onClick}
      title={ready ? "The language model in use — click to change or turn it off" : "Download and set up an on-device language model, in one press"}
    >
      {ready ? `LLM: ${status.settings.model}` : SETUP_BUTTON_LABEL}
    </button>
  );
}

// ---------------------------------------------------------------------------------------------
// The dialog
// ---------------------------------------------------------------------------------------------

type StepId = "runtime" | "pull" | "test" | "save";
interface Step {
  id: StepId;
  label: string;
  state: "pending" | "active" | "done" | "failed";
  detail?: string | undefined;
  error?: string | undefined;
}

type Screen =
  | { kind: "loading" }
  | { kind: "plan" }
  | { kind: "running"; steps: Step[]; failedAt: number | null }
  | { kind: "done"; steps: Step[] }
  | { kind: "advanced" }
  | { kind: "current" };

const gb = (n: number | null | undefined): string => (n === null || n === undefined ? "?" : formatBytes(n));

export function ModelSetupDialog({
  bridge,
  onClose,
  onChanged,
}: {
  bridge: SetupBridge | null;
  onClose: () => void;
  /** The saved config changed — the app re-reads `model:status`. */
  onChanged: () => void;
}): React.ReactElement {
  const [status, setStatus] = useState<ModelStatusResponse | null>(null);
  const [runtime, setRuntime] = useState<RuntimeStatusResponse | null>(null);
  const [root, setRoot] = useState("");
  const [free, setFree] = useState<number | null | undefined>(undefined);
  const [tag, setTag] = useState<string | null>(null);
  const [screen, setScreen] = useState<Screen>({ kind: "loading" });
  // Advanced
  const [advUrl, setAdvUrl] = useState("");
  const [advTag, setAdvTag] = useState("");
  const [advTest, setAdvTest] = useState<{ ok: true; ms: number } | { ok: false; error: string } | null>(null);
  const [advSaved, setAdvSaved] = useState(false);

  useEffect(() => {
    if (!bridge) return;
    let alive = true;
    void (async () => {
      const s = await bridge.modelStatus();
      if (!alive) return;
      const r = await bridge.runtimeStatus(s.settings.root);
      if (!alive) return;
      setStatus(s);
      setRuntime(r);
      setRoot(s.settings.root);
      setTag(s.settings.model ?? (s.pick.ok ? s.pick.model.tag : null));
      setAdvUrl(s.settings.url);
      setAdvTag(s.settings.model ?? "");
      setScreen({ kind: s.phase === "ready" ? "current" : "plan" });
      const f = await bridge.freeSpace(s.settings.root);
      if (alive) setFree(f);
    })();
    return () => {
      alive = false;
    };
    // Once, at mount. The app re-renders on every status refresh — including the one this
    // dialog's own save triggers — and hands in a fresh bridge object each time. Re-running this
    // on that would reset the screen from "Ready." to "in use" under the reader's eyes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!bridge) {
    return (
      <Modal onClose={onClose} title="Language model">
        <p className="note">Setting up a model is not available in this build: it cannot reach a model server.</p>
        <div className="modalbtns">
          <button className="btn" onClick={onClose}>Close</button>
        </div>
      </Modal>
    );
  }
  if (!status || !runtime || screen.kind === "loading") {
    return (
      <Modal onClose={onClose} title="Language model">
        <p className="note">Looking at this computer…</p>
      </Modal>
    );
  }

  // ── what this press would do ──
  const external = status.running === "external";
  const needRuntime = status.running === "down";
  const runtimeDownload = needRuntime && !status.runtimeInstalled;
  const chosen: ModelChoiceInfo | undefined = status.catalogue.find((m) => m.tag === tag);
  const serverHas = tag !== null && (status.serverModels ?? []).some((n) => n === tag || n === `${tag}:latest` || `${n}:latest` === tag);
  const needPull = tag !== null && !serverHas;
  const asset = runtime.asset;
  const runtimeBytes = runtimeDownload && asset ? asset.bytes + (asset.unpackedBytes ?? asset.bytes) : 0;
  const modelBytes = needPull && chosen ? chosen.expectedBytes : 0;
  const needed = runtimeBytes + modelBytes;
  const shortOfSpace = !external && free !== null && free !== undefined && free < needed;
  const canGo = tag !== null && !shortOfSpace && !(runtimeDownload && !asset);
  const downloads = [runtimeDownload && asset ? gb(asset.bytes) : null, needPull && chosen ? `~${gb(chosen.expectedBytes)}` : null].filter(Boolean);
  const goLabel = downloads.length ? `Download ${downloads.join(" + ")}` : "Activate";

  // ── the run ──
  const planSteps = (): Step[] => {
    const s: Step[] = [];
    if (needRuntime) s.push({ id: "runtime", label: runtimeDownload ? "Download, verify, unpack and start Ollama" : "Start Ollama", state: "pending" });
    if (needPull) s.push({ id: "pull", label: `Download ${chosen?.label ?? tag}`, state: "pending" });
    s.push({ id: "test", label: "Test the model", state: "pending" });
    s.push({ id: "save", label: "Save", state: "pending" });
    return s;
  };

  const runFrom = async (steps: Step[], from: number): Promise<void> => {
    const set = (i: number, patch: Partial<Step>): void => {
      steps = steps.map((st, j) => (j === i ? { ...st, ...patch } : st));
      setScreen({ kind: "running", steps, failedAt: null });
    };
    for (let i = from; i < steps.length; i++) {
      set(i, { state: "active", error: undefined });
      const step = steps[i]!;
      let error: string | null = null;
      if (step.id === "runtime") {
        const r = await bridge.installRuntime(root, (p) => {
          const pct = p.received !== undefined && p.total ? ` ${Math.round((p.received / p.total) * 100)}%` : "";
          set(i, { detail: `${p.step}${pct}` });
        });
        if (!r.ok) error = `${r.step}: ${r.error}`;
      } else if (step.id === "pull") {
        const r = await bridge.pullModel(tag!, (p) => {
          const pct = p.completed !== undefined && p.total ? ` ${Math.round((p.completed / p.total) * 100)}%` : "";
          const size = p.total ? ` of ${gb(p.total)}` : "";
          set(i, { detail: `${p.status}${pct}${size}` });
        });
        if (!r.ok) error = r.error ?? "the download failed";
      } else if (step.id === "test") {
        const r = await bridge.testModel({ model: tag! });
        if (!r.ok) error = r.error;
        else set(i, { detail: `answered in ${r.ms} ms` });
      } else {
        const r = await bridge.configureModel({ root, model: tag });
        if (!r.ok) error = r.error;
      }
      if (error) {
        steps = steps.map((st, j) => (j === i ? { ...st, state: "failed", error } : st));
        setScreen({ kind: "running", steps, failedAt: i });
        return;
      }
      set(i, { state: "done" });
    }
    onChanged();
    setScreen({ kind: "done", steps });
  };

  const go = (): void => {
    const steps = planSteps();
    setScreen({ kind: "running", steps, failedAt: null });
    void runFrom(steps, 0);
  };

  const pickFolder = async (): Promise<void> => {
    const picked = await bridge.pickFolder(root);
    if (!picked) return;
    setRoot(picked);
    setFree(undefined);
    setFree(await bridge.freeSpace(picked));
  };

  const turnOff = async (): Promise<void> => {
    const r = await bridge.configureModel({ root, model: null });
    if (r.ok) {
      onChanged();
      onClose();
    }
  };

  // ── screens ──
  if (screen.kind === "current") {
    return (
      <Modal onClose={onClose} title="Language model">
        <p className="note">
          <strong>{status.settings.model}</strong> is in use{status.running === "external" ? " through your own Ollama" : ""}. The bar on the ribbon sends what you type to it, on this machine only.
        </p>
        <div className="modalbtns">
          <button className="btn" onClick={() => setScreen({ kind: "plan" })}>Change model…</button>
          <button className="btn" onClick={() => setScreen({ kind: "advanced" })}>Advanced…</button>
          <button className="btn" onClick={() => void turnOff()}>Turn off</button>
          <button className="btn" onClick={onClose}>Close</button>
        </div>
      </Modal>
    );
  }

  if (screen.kind === "advanced") {
    const dirty = (v: string, t: string): void => {
      setAdvUrl(v);
      setAdvTag(t);
      setAdvTest(null);
      setAdvSaved(false);
    };
    return (
      <Modal onClose={onClose} title="Connect a model server on this machine">
        <p className="note">
          Any Ollama on <strong>this machine</strong> — another port, another store. A hosted online model service
          is not an option: what you type carries your table and column names, and MadY sends that to nothing off this computer.
        </p>
        <label className="frow">
          <span>Server</span>
          <input className="selin setup-url" value={advUrl} onChange={(e) => dirty(e.target.value, advTag)} placeholder="http://127.0.0.1:11434" />
        </label>
        <label className="frow">
          <span>Model</span>
          <input className="selin setup-tag" value={advTag} onChange={(e) => dirty(advUrl, e.target.value)} placeholder="gemma4:12b" />
        </label>
        {advTest && (
          <p className={"note" + (advTest.ok ? "" : " importwarn")} role="status">
            {advTest.ok ? `The model answered in ${advTest.ms} ms.` : advTest.error}
          </p>
        )}
        {advSaved && <p className="note" role="status">Saved.</p>}
        <div className="modalbtns">
          <button
            className="btn"
            disabled={!advUrl.trim() || !advTag.trim()}
            onClick={() => {
              setAdvTest(null);
              void bridge.testModel({ url: advUrl.trim(), model: advTag.trim() }).then(setAdvTest);
            }}
          >
            Test
          </button>
          <button
            className="btn"
            disabled={!advTest?.ok}
            onClick={() => {
              void bridge.configureModel({ root, model: advTag.trim(), url: advUrl.trim() }).then((r) => {
                if (r.ok) {
                  setAdvSaved(true);
                  onChanged();
                }
              });
            }}
          >
            Save
          </button>
          <button className="btn" onClick={() => setScreen({ kind: status.phase === "ready" ? "current" : "plan" })}>Back</button>
          <button className="btn" onClick={onClose}>Close</button>
        </div>
      </Modal>
    );
  }

  if (screen.kind === "running" || screen.kind === "done") {
    const failed = screen.kind === "running" && screen.failedAt !== null ? screen.steps[screen.failedAt]! : null;
    return (
      <Modal onClose={onClose} title={screen.kind === "done" ? "Language model" : "Setting up the language model"}>
        <ul className="setup-steps">
          {screen.steps.map((s) => (
            <li key={s.id} className={`setup-step setup-${s.state}`}>
              <span className="setup-mark" aria-hidden>{s.state === "done" ? "✓" : s.state === "failed" ? "✗" : s.state === "active" ? "…" : "·"}</span>
              <span>{s.label}</span>
              {s.detail && <span className="setup-detail">{s.detail}</span>}
              {s.error && <div className="setup-error">{s.error}</div>}
            </li>
          ))}
        </ul>
        {screen.kind === "done" ? (
          <>
            <p className="note" role="status">
              <strong>Ready.</strong> The LLM bar is now on the ribbon — type what you want changed, and press Enter. Everything it does is undoable.
            </p>
            <div className="modalbtns">
              <button className="btn" onClick={onClose}>Close</button>
            </div>
          </>
        ) : failed ? (
          <>
            <p className="note importwarn" role="alert">
              Stopped at “{failed.label}”. Nothing after it was started.
            </p>
            <div className="modalbtns">
              <button className="btn" onClick={() => void runFrom(screen.steps, screen.failedAt!)}>Retry</button>
              <button className="btn" onClick={() => setScreen({ kind: "advanced" })}>Advanced…</button>
              {failed.id === "runtime" && (
                <button className="btn" onClick={() => bridge.openExternal?.(RUNTIME_DOWNLOAD_PAGE)}>Open Ollama’s download page</button>
              )}
              <button className="btn" onClick={onClose}>Close</button>
            </div>
          </>
        ) : (
          <p className="note">You can keep working; this window can stay open or be closed — the download continues.</p>
        )}
      </Modal>
    );
  }

  // ── before the run: what will be downloaded ──
  return (
    <Modal onClose={onClose} title={SETUP_BUTTON_LABEL}>
      <table className="setup-table">
        <tbody>
          {needRuntime && (
            <tr>
              <th>Ollama</th>
              <td>
                <div>{asset?.blurb ?? "The program that runs the language model on this computer."}</div>
                <div className="note">
                  {runtimeDownload
                    ? asset
                      ? `${gb(asset.bytes)} to download · ${gb(asset.unpackedBytes)} on disk · ${runtime.version}`
                      : "no download available for this platform — use Advanced to connect a server you run yourself"
                    : "on this disk — will start"}
                </div>
              </td>
            </tr>
          )}
          <tr>
            <th>Model</th>
            <td>
              <select className="selin setup-model" value={tag ?? ""} onChange={(e) => setTag(e.target.value || null)} aria-label="Model">
                {tag === null && <option value="">— choose —</option>}
                {status.catalogue.map((m) => (
                  <option key={m.tag} value={m.tag}>
                    {m.label} · {m.parameters} · ~{gb(m.expectedBytes)}
                  </option>
                ))}
              </select>
              {chosen && <div>{chosen.blurb}</div>}
              <div className="note">
                {status.pick.ok ? status.pick.reason : status.pick.reason}
                {chosen && serverHas && external ? " · your Ollama holds it — nothing to download" : ""}
              </div>
            </td>
          </tr>
          <tr>
            <th>Store in</th>
            <td>
              {external ? (
                <div className="note">Using your Ollama’s own store — MadY does not move it.</div>
              ) : (
                <>
                  <code className="setup-path">{root}</code> <button className="btn-mini" onClick={() => void pickFolder()}>Change…</button>
                  <div className="note">{free === undefined ? "reading free space…" : free === null ? "could not read free space" : `${gb(free)} free`}</div>
                </>
              )}
            </td>
          </tr>
        </tbody>
      </table>
      {shortOfSpace && (
        <p className="note importwarn" role="alert">
          Not enough free space: this needs about {gb(needed)} during set-up ({gb(runtimeBytes)} for Ollama including its unpacked files, {gb(modelBytes)} for the model); {gb(free)} is free. Choose another folder.
        </p>
      )}
      <p className="note">Everything downloaded stays on this computer and answers only MadY. Nothing else will ask you anything.</p>
      <div className="modalbtns">
        <button className="btn" disabled={!canGo} onClick={go}>{goLabel}</button>
        <button className="btn" onClick={() => setScreen({ kind: "advanced" })}>Advanced…</button>
        <button className="btn" onClick={onClose}>Cancel</button>
      </div>
    </Modal>
  );
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }): React.ReactElement {
  return (
    <div className="modalov" onClick={onClose}>
      <div className="modal setup-modal" role="dialog" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="modalh-row">
          <h3 className="modalh">{title}</h3>
        </div>
        {children}
      </div>
    </div>
  );
}
