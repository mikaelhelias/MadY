/**
 * SettingsDialog — the user's preferences:
 *   - a global default preset, and a favourite preset per graph type (scatter → Scientific
 *     Journal, bar → Editorial…); a type left on "Use global" inherits the global default;
 *   - common style defaults (title font/size, axis thickness/colour, grid, palette) layered on
 *     top of every new graph's preset;
 *   - the user's own saved presets (rename / delete) and the style library's export / import;
 *   - new-graph defaults, analysis defaults, significance thresholds and application
 *     preferences;
 *   - the on-device language model — a button to the ribbon's set-up dialog (ModelSetup.tsx),
 *     present only when the model is enabled. It never downloads anything without stating the
 *     size first — see ModelSetup.tsx.
 *
 * Self-contained: it reads + persists through `profile.ts` / `userPresets.ts`
 * (durable store), and calls `onChanged` so AppShell re-reads the bits the
 * Inspector also shows (the global default + the saved-preset list). Style defaults affect
 * only new graphs — nothing here restyles existing graphs.
 */
import { useState } from "react";
import type { DateOrder, ErrorBarType, PlotKind } from "@mady/core";
import { STYLE_PRESETS } from "@mady/core";
import { FONT_FAMILIES } from "./Inspector";
import { ColorInput } from "./SchemaForm";
import { ThresholdLadder } from "./ThresholdLadder";
import { NEW_GRAPH_GENRES } from "./newGraph";
import { methodLabel } from "./AnalyzeDialog";
import {
  clearAnalysisDefault,
  DEFAULT_MISSING_VALUES,
  getAppDefaults,
  getGlobalParams,
  getKindDefaults,
  getProfileDefault,
  listAnalysisDefaults,
  setAppDefaults,
  setGlobalParams,
  setKindDefault,
  setProfileDefault,
} from "./profile";
import type { AppDefaults, AppDefaultsPatch, GlobalStyleParams, ProfileDefault } from "./profile";
import { deleteUserPreset, duplicateUserPreset, listUserPresets, removeUserPresetKind, renameUserPreset, reorderUserPresets } from "./userPresets";
import type { UserPreset } from "./userPresets";
import { GuideHelp } from "./guideLink";
import { UserPresetList } from "./UserPresetList";
import { exportPresetFile, importPresetFiles, importSummary } from "./presetFile";
import { exportUserLibrary, importUserLibrary } from "./durableStore";
import { SETUP_BUTTON_LABEL } from "./ModelSetup";

/** Distinct user-creatable graph types (deduped by plot kind), with a friendly label. */
const KIND_ROWS: { kind: PlotKind; label: string }[] = (() => {
  const seen = new Set<string>();
  const rows: { kind: PlotKind; label: string }[] = [];
  for (const g of NEW_GRAPH_GENRES) {
    if (seen.has(g.plotKind)) continue;
    seen.add(g.plotKind);
    rows.push({ kind: g.plotKind, label: g.label });
  }
  return rows;
})();

/** ProfileDefault (or "inherit") ↔ a <select> value. */
function encodeRef(ref: ProfileDefault | "inherit"): string {
  if (ref === "inherit") return "inherit";
  if (ref === null) return "none";
  return ref.kind === "builtin" ? `b:${ref.name}` : `u:${ref.id}`;
}
function decodeRef(v: string): ProfileDefault | "inherit" {
  if (v === "inherit") return "inherit";
  if (v === "none") return null;
  if (v.startsWith("b:")) return { kind: "builtin", name: v.slice(2) };
  if (v.startsWith("u:")) return { kind: "user", id: v.slice(2) };
  return "inherit";
}

function PresetOptions({ presets, includeInherit }: { presets: UserPreset[]; includeInherit: boolean }) {
  return (
    <>
      {includeInherit && <option value="inherit">Use global default</option>}
      <option value="none">None (blank canvas)</option>
      <optgroup label="Built-in">
        {STYLE_PRESETS.map((p) => (
          <option key={p.name} value={`b:${p.name}`}>{p.name}</option>
        ))}
      </optgroup>
      {presets.length > 0 && (
        <optgroup label="My presets">
          {presets.map((p) => (
            <option key={p.id} value={`u:${p.id}`}>{p.name}</option>
          ))}
        </optgroup>
      )}
    </>
  );
}

export function SettingsDialog({
  onClose,
  onChanged,
  onOpenModelSetup,
}: {
  onClose: () => void;
  onChanged: () => void;
  /** Opens the model set-up (the same dialog as the ribbon button) — one implementation. */
  onOpenModelSetup?: (() => void) | undefined;
}) {
  const [globalDef, setGlobalDef] = useState<ProfileDefault>(() => getProfileDefault());
  const [perKind, setPerKind] = useState<Partial<Record<PlotKind, ProfileDefault>>>(() => getKindDefaults());
  const [params, setParams] = useState<GlobalStyleParams>(() => getGlobalParams());
  const [presets, setPresets] = useState<UserPreset[]>(() => listUserPresets());
  // Application-level defaults + the list of methods with a saved analysis default.
  const [appDef, setAppDef] = useState<AppDefaults>(() => getAppDefaults());
  const [savedMethods, setSavedMethods] = useState<string[]>(() => listAnalysisDefaults());

  const updateGlobal = (v: string): void => {
    const ref = decodeRef(v);
    const next = ref === "inherit" ? null : ref;
    setProfileDefault(next);
    setGlobalDef(next);
    onChanged();
  };
  const updateKind = (kind: PlotKind, v: string): void => {
    setKindDefault(kind, decodeRef(v));
    setPerKind(getKindDefaults());
    onChanged();
  };
  /** Set (or clear, when value is empty) one global param. */
  const setParam = <K extends keyof GlobalStyleParams>(key: K, value: GlobalStyleParams[K] | undefined): void => {
    const next: GlobalStyleParams = { ...params };
    if (value === undefined || value === "" || (Array.isArray(value) && value.length === 0)) delete next[key];
    else next[key] = value;
    setGlobalParams(next);
    setParams(getGlobalParams());
    onChanged();
  };
  const clearParams = (): void => {
    setGlobalParams({});
    setParams({});
    onChanged();
  };
  // Preset files and the library bundle — the same functions the Inspector's Style tab calls.
  const [transferMsg, setTransferMsg] = useState("");
  const dupPreset = (id: string): void => {
    const r = duplicateUserPreset(id);
    setPresets(listUserPresets());
    setTransferMsg(r.ok ? "" : `Not duplicated: ${r.reason}.`);
  };
  const removeKindPreset = (id: string, kind: PlotKind): void => {
    removeUserPresetKind(id, kind);
    setPresets(listUserPresets());
    onChanged();
  };
  const reorderPresets = (ids: string[]): void => {
    reorderUserPresets(ids);
    setPresets(listUserPresets());
    onChanged();
  };
  const delPreset = (id: string): void => {
    deleteUserPreset(id);
    setPresets(listUserPresets());
    setPerKind(getKindDefaults()); // a per-kind ref to it may have been cleared
    setGlobalDef(getProfileDefault());
    onChanged();
  };
  const refreshAfterImport = (): void => {
    setPresets(listUserPresets());
    setGlobalDef(getProfileDefault());
    setPerKind(getKindDefaults());
    onChanged();
  };
  const exportPreset = (p: UserPreset): void => {
    void exportPresetFile(p).then((r) => setTransferMsg(r.ok ? `Exported "${p.name}".` : r.canceled ? "" : `Export failed: ${r.error ?? "unknown error"}`));
  };
  const importPresets = (): void => {
    void importPresetFiles().then((r) => {
      if (r.ok && r.added.length) refreshAfterImport();
      setTransferMsg(importSummary(r));
    });
  };
  const exportLibrary = (): void => {
    void exportUserLibrary().then((r) => setTransferMsg(r.ok ? "Exported your style library." : r.canceled ? "" : `Export failed: ${r.error ?? "unknown error"}`));
  };
  const importLibrary = (): void => {
    void importUserLibrary().then((r) => {
      if (r.ok) { refreshAfterImport(); setTransferMsg("Imported — your presets were merged in."); }
      else setTransferMsg(r.canceled ? "" : `Import failed: ${r.error ?? "unknown error"}`);
    });
  };
  /** The star button on a preset row: the global default for new graphs, exactly as the Inspector's star. */
  const setDefaultFromList = (d: ProfileDefault): void => {
    setProfileDefault(d);
    setGlobalDef(d);
    onChanged();
  };
  const renPreset = (id: string, name: string): void => {
    const n = name.trim();
    if (!n) return;
    renameUserPreset(id, n);
    setPresets(listUserPresets());
    onChanged();
  };
  /** Patch one or more application defaults (undefined ⇒ revert to the built-in). */
  const patchApp = (patch: AppDefaultsPatch): void => {
    setAppDefaults(patch);
    setAppDef(getAppDefaults());
    onChanged(); // AppShell re-reads the theme from here so it applies live.
  };
  const clearMethodDefault = (method: string): void => {
    clearAnalysisDefault(method);
    setSavedMethods(listAnalysisDefaults());
    onChanged();
  };

  const anyParams = Object.keys(params).length > 0;

  return (
    <div className="modalov" onClick={onClose}>
      <div className="modal modal-settings" role="dialog" aria-label="Settings" onClick={(e) => e.stopPropagation()}>
        <div className="modalh-row">
          <h3 className="modalh">Settings</h3>
          <GuideHelp target={{ entry: "action:settings" }} what="Settings" />
        </div>
        <p className="note" style={{ marginTop: -4 }}>
          Style defaults apply to <strong>new</strong> graphs only — existing graphs are untouched (use a graph's Inspector or “Apply this look” to restyle those). Application preferences take effect right away.
        </p>

        <div className="set-scroll">
          {/* Global default */}
          <div className="an-group-h">Default look for new graphs</div>
          <label className="frow">
            <span>Global default</span>
            <select className="selin" aria-label="Global default preset" value={encodeRef(globalDef)} onChange={(e) => updateGlobal(e.target.value)}>
              <PresetOptions presets={presets} includeInherit={false} />
            </select>
          </label>

          {/* Per graph type */}
          <div className="an-group-h">Favourite style per graph type</div>
          <p className="note" style={{ margin: "0 0 6px" }}>Pick a preset for a specific type, or leave it on “Use global default”.</p>
          <div className="set-kinds">
            {KIND_ROWS.map((r) => (
              <label className="frow" key={r.kind}>
                <span>{r.label}</span>
                <select
                  className="selin"
                  aria-label={`Default preset for ${r.label}`}
                  value={encodeRef(r.kind in perKind ? (perKind[r.kind] ?? null) : "inherit")}
                  onChange={(e) => updateKind(r.kind, e.target.value)}
                >
                  <PresetOptions presets={presets} includeInherit />
                </select>
              </label>
            ))}
          </div>

          {/* Common style defaults for all graphs */}
          <div className="an-group-h">
            Common defaults (all graphs)
            {anyParams && (
              <button type="button" className="btn-mini" style={{ marginLeft: 8 }} onClick={clearParams}>Reset</button>
            )}
          </div>
          <p className="note" style={{ margin: "0 0 6px" }}>Layered on top of the preset above — leave a field blank to defer to the preset.</p>
          <label className="frow">
            <span>Title font</span>
            <select className="selin" aria-label="Title font family" value={params.fontFamily ?? ""} onChange={(e) => setParam("fontFamily", e.target.value || undefined)}>
              <option value="">— use preset —</option>
              {FONT_FAMILIES.map((f) => (
                <option key={f.value} value={f.value}>{f.label}</option>
              ))}
            </select>
          </label>
          <label className="frow">
            <span>Title size</span>
            <input
              type="number"
              className="numin"
              min={6}
              max={72}
              placeholder="—"
              aria-label="Title size"
              value={params.titleSize ?? ""}
              onChange={(e) => setParam("titleSize", e.target.value === "" ? undefined : Number(e.target.value))}
            />
          </label>
          <label className="frow">
            <span>Axis thickness</span>
            <input
              type="number"
              className="numin"
              min={0.25}
              max={8}
              step={0.25}
              placeholder="—"
              aria-label="Axis thickness"
              value={params.axisThickness ?? ""}
              onChange={(e) => setParam("axisThickness", e.target.value === "" ? undefined : Number(e.target.value))}
            />
          </label>
          <label className="frow">
            <span>Axis colour</span>
            <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <ColorInput className="colorin" value={params.axisColor ?? "#2b2b2b"} aria-label="Axis colour" onChange={(c) => setParam("axisColor", c)} />
              {params.axisColor && <button type="button" className="btn-mini" onClick={() => setParam("axisColor", undefined)}>clear</button>}
            </span>
          </label>
          <label className="frow">
            <span>Gridlines</span>
            <select
              className="selin"
              aria-label="Gridlines"
              value={params.gridShow === undefined ? "" : params.gridShow ? "on" : "off"}
              onChange={(e) => setParam("gridShow", e.target.value === "" ? undefined : e.target.value === "on")}
            >
              <option value="">— use preset —</option>
              <option value="on">Show</option>
              <option value="off">Hide</option>
            </select>
          </label>
          <label className="frow">
            <span>Colour palette</span>
            <select
              className="selin"
              aria-label="Colour palette"
              value={params.palette ? (STYLE_PRESETS.find((p) => p.palette.join() === params.palette!.join())?.name ?? "custom") : ""}
              onChange={(e) => setParam("palette", e.target.value === "" ? undefined : STYLE_PRESETS.find((p) => p.name === e.target.value)?.palette)}
            >
              <option value="">— use preset —</option>
              {STYLE_PRESETS.map((p) => (
                <option key={p.name} value={p.name}>{p.name} palette</option>
              ))}
            </select>
          </label>

          {/* The user's saved presets */}
          <div className="an-group-h">My saved presets</div>
          {presets.length === 0 ? (
            <p className="note" style={{ margin: 0 }}>None yet — style a graph, then “Save as preset” in its Inspector.</p>
          ) : (
            <UserPresetList
              variant="settings"
              presets={presets}
              profileDefault={globalDef}
              onRename={renPreset}
              onDuplicate={dupPreset}
              onRemoveKind={removeKindPreset}
              onReorder={reorderPresets}
              onDelete={delPreset}
              onSetProfileDefault={setDefaultFromList}
              onExport={exportPreset}
            />
          )}
          <div className="an-group-h">Back up &amp; transfer</div>
          <div className="frow" style={{ gap: 6 }}>
            <button type="button" className="btn-mini" aria-label="Import a preset file" title="Add one or more preset files (.mady-preset.json) someone exported. Each gets a fresh id; a name you already have gets (2)." onClick={importPresets}>Import preset…</button>
            <button type="button" className="btn-mini" aria-label="Export the style library" title="Export your presets & defaults to a portable .json file (a backup, or to move to another computer)" onClick={exportLibrary}>Export library…</button>
            <button type="button" className="btn-mini" aria-label="Import a style library" title="Import a previously exported style library (adds to your presets, never deletes)" onClick={importLibrary}>Import library…</button>
          </div>
          {transferMsg && <p className="note" style={{ margin: "4px 0 0" }}>{transferMsg}</p>}

          {/* New-graph defaults (type + error bars) */}
          <div className="an-group-h">New-graph defaults</div>
          <label className="frow">
            <span>Default graph type</span>
            <select className="selin" aria-label="Default graph type" value={appDef.defaultGenre ?? "xy"} onChange={(e) => patchApp({ defaultGenre: e.target.value })}>
              {NEW_GRAPH_GENRES.map((g) => (
                <option key={g.key} value={g.key}>{g.label}</option>
              ))}
            </select>
          </label>
          <label className="frow">
            <span>Default error bars</span>
            <select className="selin" aria-label="Default error bars" value={appDef.errorBars ?? "sd"} onChange={(e) => patchApp({ errorBars: e.target.value as ErrorBarType })}>
              <option value="sd">Standard deviation</option>
              <option value="sem">Standard error (SEM)</option>
              <option value="ci95">95% confidence interval</option>
              <option value="range">Range (min–max)</option>
              <option value="none">None</option>
            </select>
          </label>
          <label className="frow">
            <span>Date entry format</span>
            <select className="selin" aria-label="Date entry format" value={appDef.dateOrder ?? "auto"} onChange={(e) => patchApp({ dateOrder: e.target.value === "auto" ? undefined : (e.target.value as DateOrder) })}>
              <option value="auto">Auto (from your system)</option>
              <option value="dmy">International — day/month/year (05/06 = 5 Jun)</option>
              <option value="mdy">US — month/day/year (05/06 = 6 May)</option>
            </select>
          </label>
          <label className="frow" title="Optional comma-separated tokens the importer treats as missing (blank) — e.g. NA, N/A, null. Empty (the default) keeps every value as imported; only a truly empty cell is ever blank. Set tokens here to exclude them by default in every import.">
            <span>Missing values (import)</span>
            <input
              className="selin"
              type="text"
              aria-label="Default missing-value tokens"
              value={appDef.missingValues ?? DEFAULT_MISSING_VALUES}
              placeholder="NA, N/A, null"
              onChange={(e) => patchApp({ missingValues: e.target.value })}
            />
          </label>

          {/* Analysis defaults (confidence + saved per-method) */}
          <div className="an-group-h">Analysis defaults</div>
          <label className="frow">
            <span>Default confidence</span>
            <select className="selin" aria-label="Default confidence level" value={appDef.conf ?? 95} onChange={(e) => patchApp({ conf: Number(e.target.value) })}>
              <option value={90}>90%</option>
              <option value={95}>95%</option>
              <option value={99}>99%</option>
            </select>
          </label>
          {/* Rounding is an option and off by default; the results table then shows the
              engine's full precision. Display only: exports, Copy
              and the numbers themselves are never rounded by this. */}
          <label className="frow" title="Round the numbers in on-screen results tables to this many significant figures. Off = full precision. Display only — exports and Copy keep every digit; p-values keep their own 3-figure convention.">
            <span>Round results tables</span>
            <select className="selin" aria-label="Round results tables" value={appDef.resultDigits ?? 0} onChange={(e) => patchApp({ resultDigits: Number(e.target.value) })}>
              <option value={0}>Off (full precision)</option>
              <option value={3}>3 significant figures</option>
              <option value={4}>4 significant figures</option>
              <option value={5}>5 significant figures</option>
              <option value={6}>6 significant figures</option>
            </select>
          </label>
          {savedMethods.length === 0 ? (
            <p className="note" style={{ margin: 0 }}>No saved per-analysis defaults — tick “Make default” in the Analyze dialog to remember an analysis’s options.</p>
          ) : (
            <div className="set-presets">
              {savedMethods.map((m) => (
                <div className="frow" key={m}>
                  <span>{methodLabel(m)}</span>
                  <button type="button" className="btn-mini" aria-label={`Clear saved default for ${methodLabel(m)}`} onClick={() => clearMethodDefault(m)}>Clear</button>
                </div>
              ))}
            </div>
          )}

          {/* Significance thresholds — the default ladder new graphs start from. Per the
              note at the top of this dialog, style defaults apply to new graphs only, so
              changing it here never rewrites a figure someone already made. */}
          <div className="an-group-h">Significance</div>
          <ThresholdLadder
            value={appDef.significanceThresholds}
            nsSymbol={appDef.significanceNsSymbol}
            hideNs={undefined}
            scope="settings"
            onChange={(thresholds) => patchApp({ significanceThresholds: thresholds })}
            onChangeNs={(nsSymbol) => patchApp({ significanceNsSymbol: nsSymbol })}
            onChangeHideNs={() => {}}
          />

          {/* Application preferences (take effect immediately) */}
          <div className="an-group-h">Application</div>
          <label className="frow">
            <span>Theme</span>
            <select className="selin" aria-label="Theme" value={appDef.theme ?? "light"} onChange={(e) => patchApp({ theme: e.target.value as "light" | "dark" })}>
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </select>
          </label>
          {/* The startup fit, and the way back out of it. Nothing it changes is written to a
              document, so switching this off puts every fitted figure back to 580 × 380 at
              once — there is no undo to perform and no file to re-save. */}
          <label className="frow" title="Scale a graph that has no size of its own up to the space available, measured once when the app starts. Graphs you have sized yourself are never touched, and the window is not re-measured when you resize it.">
            <span>Fit graphs to the window at startup</span>
            <select
              className="selin"
              aria-label="Fit graphs to the window at startup"
              value={appDef.fitGraphsToWindow === false ? "off" : "on"}
              onChange={(e) => patchApp({ fitGraphsToWindow: e.target.value === "on" })}
            >
              <option value="on">On</option>
              <option value="off">Off — always 580 × 380</option>
            </select>
          </label>
          <label className="frow" title="An interactive HTML export shows each point, bar, slice or cell's values when a reader hovers it. This is the default; the Export dialog's “Show values on hover” box can change it for one export.">
            <span>Hover values in interactive HTML export</span>
            <select
              className="selin"
              aria-label="Hover values in interactive HTML export"
              value={appDef.exportHoverValues === false ? "off" : "on"}
              onChange={(e) => patchApp({ exportHoverValues: e.target.value === "on" })}
            >
              <option value="on">On</option>
              <option value="off">Off</option>
            </select>
          </label>
          <label className="frow">
            <span>Autosave</span>
            <select className="selin" aria-label="Autosave" value={appDef.autosaveEnabled === false ? "off" : "on"} onChange={(e) => patchApp({ autosaveEnabled: e.target.value === "on" })}>
              <option value="on">On</option>
              <option value="off">Off</option>
            </select>
          </label>
          <label className="frow">
            <span>Autosave every (seconds)</span>
            <input
              type="number"
              className="numin"
              min={1}
              max={300}
              step={0.5}
              placeholder="1.5"
              aria-label="Autosave interval in seconds"
              disabled={appDef.autosaveEnabled === false}
              value={appDef.autosaveMs != null ? appDef.autosaveMs / 1000 : ""}
              onChange={(e) => patchApp({ autosaveMs: e.target.value === "" ? undefined : Math.round(Number(e.target.value) * 1000) })}
            />
          </label>
        </div>

        {/* The on-device language model — one implementation: the ribbon's set-up dialog.
            Absent (no heading, no button) unless MadY was started with MADY_LLM=1. */}
        {onOpenModelSetup && (
          <>
            <div className="an-group-h">Language model</div>
            <p className="note">
              An on-device model turns a typed sentence into MadY commands, on this machine only. It is set up from the ribbon;
              this button opens the same screen.
            </p>
            <p className="frow">
              <button
                type="button"
                className="btn"
                onClick={() => {
                  onClose();
                  onOpenModelSetup();
                }}
              >
                {SETUP_BUTTON_LABEL}…
              </button>
            </p>
          </>
        )}

        <div className="modalbtns">
          <button type="button" className="btn" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );
}
