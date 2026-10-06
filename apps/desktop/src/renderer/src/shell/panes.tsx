import type React from "react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ToolbarMenu } from "./ToolbarMenu";
import { BarChart3, Download, Link2, Table2, Unlink } from "lucide-react";
import type { AlignOp, Annotation, DataTable, FigureLayout, FrameStyle, GridStyle, LegendSpec, MethodSpec, NodeId, Plot, Project, StylePreset, TidyTerm } from "@mady/core";
import type { Analysis } from "@mady/core";
import type { AxisSpec, NumberFormat } from "@mady/core";
import { NUMBER_FORMAT_CHOICES } from "./numberFormats";
import type { LegendDock } from "./legendDock";
import { keyDash } from "./legendDock";
import type { PickedPoint } from "./boxSelect";
import type { EntryMode, SurvivalTimeUnit, TableKind } from "@mady/core";
import { arrangeBoxes, canJoinLegend, CONSTRAINED_METHODS, dataAxisOf, excludedCount, DEFAULT_FIGURE_GUTTER, ENTRY_MODE_OPTIONS, findPreset, ORDINATION_LABELS, replicateCount, STYLE_PRESETS, tableEntryMode, tableFormat, tableFormatList, validateTable, xErrorColumn } from "@mady/core";
import { buildPlotScene, OKABE_ITO, resolveFigureAnnotations, snapRegionBox } from "@mady/graphics";
import { cornerResize, graphDisplayScale, graphLayoutSize } from "./graphDisplay";
import { scenePaletteOpt } from "./scenePalette";
import { SCATTER_SUMMARY_OPTS, scatterSummaryKey } from "./columnScatterSummary";
import type { ColorVision, LegendEntry } from "@mady/graphics";
import { colorVisionFilter } from "./ColorVisionDefs";
import type { GraphSelection, TableOps } from "./AppShell";
import type { GraphView } from "./DocumentArea";
import { cellsInBounds, DataGrid } from "./DataGrid";
import { CellFillMenu } from "./CellFillMenu";
import { CellPatternMenu } from "./CellPatternMenu";
import { analysisToTsv, keyMetricLine, tidyColumns } from "./analysisExport";
import { P_THRESHOLD, keyResultCards } from "./keyResults";
import { splitTerms } from "./analysisEmphasis";
import { figureCaption, figureTextBlock, multiPanelCaption } from "./figureCaption";
import type { CaptionPanel } from "./figureCaption";
import { draftMethodsResults } from "./methodsProse";
import type { SoftwareVersions } from "./methodsProse";
import { methodValidation, validationStatement } from "./validation";
import { capturePlotStyle, kindFontMatchPatch, MATCH_KEYS } from "./templates";
import { canZoom, ZOOM_MAX, ZOOM_MIN, zoomLabel } from "./zoom";
import { useCtrlWheelZoom } from "./ctrlWheelZoom";
import { captureFigureTemplate, deleteFigureTemplate, figureTemplatePatch, listFigureTemplates, saveFigureTemplate } from "./figureTemplates";
import { layoutPresets, packGrid } from "./layoutPresets";
import type { LayoutPreset } from "./layoutPresets";
import { AnnotationsLayer, clientToUserOf, Marker, PlotFigure, RichText } from "./PlotFigure";
import { growFigureToDrawing, holdHeightWhileResizing, unclipWhileDragging } from "./figureGrowth";
import { FONT_FAMILIES, NO_SERIES_LEGEND } from "./Inspector";
import { ColorInput } from "./SchemaForm";
import type { AnnotationMovePatch, TextTarget } from "./PlotFigure";
import { measureText } from "./textMeasure";
import { MM_PER_IN, PAGE_SIZES, pagePx } from "./printSizes";

/** localStorage key for the "Wheel zoom" preference. Exported so tests can set the state. */
export const WHEEL_ZOOM_KEY = "mady.wheelZoom";

/**
 * Persisted "does the mouse wheel zoom the graph" preference — off by default, so
 * the wheel scrolls a page past a figure instead of zooming the graph's axes.
 * Same pattern as `useWholeSeries` in the Inspector; app-wide, not per graph.
 */
function useWheelZoomPref(): { value: boolean; set: (v: boolean) => void } {
  const [value, setValue] = useState<boolean>(() => globalThis.localStorage?.getItem(WHEEL_ZOOM_KEY) === "1");
  const set = (v: boolean): void => {
    setValue(v);
    globalThis.localStorage?.setItem(WHEEL_ZOOM_KEY, v ? "1" : "0");
  };
  return { value, set };
}

/** localStorage key for the "Show graph ruler" preference. Exported so tests can set it. */
export const GRAPH_RULER_KEY = "mady.graphRuler";
/** Window event that syncs every `useGraphRulerPref` instance the moment one flips the
 *  preference — the toggle lives in the View menu (AppShell) while the reader is the graph
 *  pane (a different component tree), so a plain localStorage write would not re-render it. */
const GRAPH_RULER_EVENT = "mady-graph-ruler-change";

/**
 * Persisted "show a measuring ruler around the graph" preference — off by default. App-wide,
 * not per graph (the ruler is a workspace aid like the panel assembler's ruler, not a figure
 * property). The View-menu toggle and the graph pane both use this hook; the custom window
 * event keeps the menu's checkmark and the pane in lock-step.
 */
export function useGraphRulerPref(): { value: boolean; set: (v: boolean) => void } {
  const read = (): boolean => globalThis.localStorage?.getItem(GRAPH_RULER_KEY) === "1";
  const [value, setValue] = useState<boolean>(read);
  useEffect(() => {
    const sync = (): void => setValue(read());
    window.addEventListener(GRAPH_RULER_EVENT, sync);
    return () => window.removeEventListener(GRAPH_RULER_EVENT, sync);
  }, []);
  const set = (v: boolean): void => {
    globalThis.localStorage?.setItem(GRAPH_RULER_KEY, v ? "1" : "0");
    window.dispatchEvent(new Event(GRAPH_RULER_EVENT));
  };
  return { value, set };
}

/** localStorage key for the colour-vision preview (off · deuteranopia · protanopia · tritanopia · grayscale). */
export const COLOR_VISION_KEY = "mady.colorVision";
export type ColorVisionPref = ColorVision | "off";
const COLOR_VISION_VALUES = new Set<string>(["deuteranopia", "protanopia", "tritanopia", "grayscale"]);
/**
 * Persisted "preview the figure as a colour-blind reader sees it" preference — off by default,
 * app-wide, screen-only (a CSS filter on the pane's wrapper, never on the drawing, so no export
 * can carry it). Synced through the same window event as the ruler toggle so the View-menu
 * check, the ribbon select, the graph pane and the assembler agree.
 */
export function useColorVisionPref(): { value: ColorVisionPref; set: (v: ColorVisionPref) => void } {
  const read = (): ColorVisionPref => {
    const v = globalThis.localStorage?.getItem(COLOR_VISION_KEY);
    return v && COLOR_VISION_VALUES.has(v) ? (v as ColorVision) : "off";
  };
  const [value, setValue] = useState<ColorVisionPref>(read);
  useEffect(() => {
    const sync = (): void => setValue(read());
    window.addEventListener(GRAPH_RULER_EVENT, sync);
    return () => window.removeEventListener(GRAPH_RULER_EVENT, sync);
  }, []);
  const set = (v: ColorVisionPref): void => {
    globalThis.localStorage?.setItem(COLOR_VISION_KEY, v);
    window.dispatchEvent(new Event(GRAPH_RULER_EVENT));
  };
  return { value, set };
}
/** Human name for a preview kind. */
export const COLOR_VISION_NAME: Record<ColorVision, string> = { deuteranopia: "Deuteranopia (red–green, most common)", protanopia: "Protanopia (red–green)", tritanopia: "Tritanopia (blue–yellow)", grayscale: "Greyscale (print)" };

/** The unit the graph ruler labels in. */
export type RulerUnit = "px" | "in" | "cm";
/** localStorage key for the ruler's unit. Exported so tests can set it. */
export const RULER_UNIT_KEY = "mady.rulerUnit";
/** MadY's logical resolution: a scene/export pixel is a 96-dpi CSS pixel (its PDF math is
 *  points = px × 72/96, see exporters.ts), so inches/cm are truthful at this ppi. */
const PX_PER_INCH = 96;
/** Screen/scene px per one unit. */
export function pxPerUnit(u: RulerUnit): number {
  return u === "in" ? PX_PER_INCH : u === "cm" ? PX_PER_INCH / 2.54 : 1;
}

/** A size/position field's text for a px value, in the ruler's unit: px whole, in/cm to 2 dp. */
export function fmtFieldValue(px: number, unit: RulerUnit): string {
  const v = px / pxPerUnit(unit);
  return unit === "px" ? String(Math.round(v)) : v.toFixed(2);
}
/** A typed field value back to whole px (never rounded to the unit); null when it is not a number. */
export function parseFieldValue(text: string, unit: RulerUnit): number | null {
  const t = text.trim();
  if (t === "") return null;
  const v = Number(t);
  return Number.isFinite(v) ? Math.round(v * pxPerUnit(unit)) : null;
}
/**
 * One typed size/position field (X · Y · W · H). Holds its own text while you type and commits
 * once, on blur or Enter — one undo per edit; Escape puts the shown value back. Re-displays the
 * value it is given whenever that changes, so a clamped commit reads back accurately.
 */
function NumField({ label, valuePx, unit, disabled, title, onCommit }: {
  label: string; valuePx: number; unit: RulerUnit; disabled?: boolean | undefined; title: string; onCommit: (px: number) => void;
}) {
  const shown = fmtFieldValue(valuePx, unit);
  const [text, setText] = useState(shown);
  useEffect(() => setText(shown), [shown]);
  const commit = (): void => {
    const px = parseFieldValue(text, unit);
    // A disabled field (a locked object) refuses the commit itself — never trust the input alone.
    if (disabled || px == null || px === Math.round(valuePx)) { setText(shown); return; }
    onCommit(px);
  };
  return (
    <label className="laypick-l laylbl layfield" title={title}>
      {label}
      <input
        type="text" inputMode="decimal" className="numin" style={{ width: 58 }} value={text} disabled={disabled}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); commit(); (e.target as HTMLInputElement).blur(); }
          else if (e.key === "Escape") { setText(shown); (e.target as HTMLInputElement).blur(); }
        }}
      />
    </label>
  );
}

/** Persisted "which unit does the ruler count in" preference (px by default). App-wide, synced
 *  through the same window event as the on/off toggle so every graph and control agrees. */
export function useRulerUnitPref(): { value: RulerUnit; set: (v: RulerUnit) => void } {
  const read = (): RulerUnit => {
    const v = globalThis.localStorage?.getItem(RULER_UNIT_KEY);
    return v === "in" || v === "cm" ? v : "px";
  };
  const [value, setValue] = useState<RulerUnit>(read);
  useEffect(() => {
    const sync = (): void => setValue(read());
    window.addEventListener(GRAPH_RULER_EVENT, sync);
    return () => window.removeEventListener(GRAPH_RULER_EVENT, sync);
  }, []);
  const set = (v: RulerUnit): void => {
    globalThis.localStorage?.setItem(RULER_UNIT_KEY, v);
    window.dispatchEvent(new Event(GRAPH_RULER_EVENT));
  };
  return { value, set };
}

/** Is a resolved axis scale logarithmic (any base)? Used to reflect the effective
 *  scale in the ribbon's log toggle, including a renderer auto-suggested log axis. */
function isLogScale(type: string | undefined): boolean {
  return type === "log10" || type === "log2" || type === "ln";
}

/** A compact, modern "Export …" action button for a pane header. */
function ExportButton({ label, onClick }: { label: string; onClick?: (() => void) | undefined }) {
  return (
    <button className="paneact" title={`${label} (PNG · SVG · PDF · …)`} onClick={onClick} disabled={!onClick}>
      <Download size={14} /> Export
    </button>
  );
}

/**
 * The saved-Methods control in the data rail: a dropdown to apply a re-applicable
 * analysis Method to the current table, export/delete each, or import one from a
 * file. Empty state still offers Import (methods come from an analysis' "Save as
 * Method"). Applying runs the analysis on this table (columns remapped by position).
 */
export function MethodsMenu({
  methods,
  onApply,
  onDelete,
  onExport,
  onImport,
}: {
  methods: MethodSpec[];
  onApply: (id: NodeId) => void;
  onDelete?: ((id: NodeId) => void) | undefined;
  onExport?: ((id: NodeId) => void) | undefined;
  onImport?: (() => void) | undefined;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="methodsmenu" style={{ position: "relative", display: "inline-block" }}>
      <button
        type="button"
        className="railbtn"
        aria-label="Saved methods"
        aria-expanded={open}
        title="Apply a saved analysis Method to this table, or import one"
        onClick={() => setOpen((o) => !o)}
      >
        Methods{methods.length ? ` (${methods.length})` : ""} ▾
      </button>
      {open && (
        <div
          className="methodspop"
          role="menu"
          onMouseLeave={() => setOpen(false)}
          style={{ position: "absolute", zIndex: 30, top: "100%", right: 0, minWidth: 200, background: "var(--panel, #fff)", border: "1px solid var(--line, #ccc)", borderRadius: 6, padding: 6, boxShadow: "0 6px 20px rgba(0,0,0,.18)" }}
        >
          {methods.length === 0 && (
            <div className="note" style={{ fontSize: 11, padding: "2px 4px 6px" }}>
              No saved methods yet. Run an analysis, then click <b>Save as Method</b>.
            </div>
          )}
          {methods.map((m) => (
            <div key={m.id} className="methodrow" style={{ display: "flex", gap: 4, alignItems: "center", marginBottom: 2 }}>
              <button
                type="button"
                className="methodapply"
                title={`Apply "${m.name}" to this table`}
                style={{ flex: 1, textAlign: "left", padding: "3px 6px", border: "none", background: "transparent", cursor: "pointer", borderRadius: 4 }}
                onClick={() => {
                  onApply(m.id);
                  setOpen(false);
                }}
              >
                {m.name}
              </button>
              {onExport && (
                <button type="button" className="btn-mini" title="Export this method to a file" aria-label={`Export method ${m.name}`} onClick={() => onExport(m.id)}>
                  ⤓
                </button>
              )}
              {onDelete && (
                <button type="button" className="btn-mini" title="Delete this method" aria-label={`Delete method ${m.name}`} onClick={() => onDelete(m.id)}>
                  ×
                </button>
              )}
            </div>
          ))}
          {onImport && (
            <>
              <div style={{ borderTop: "1px solid var(--line, #eee)", margin: "4px 0" }} />
              <button
                type="button"
                className="btn-mini"
                onClick={() => {
                  onImport();
                  setOpen(false);
                }}
              >
                Import method…
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

export function DataPane({
  project,
  tableId,
  ops,
  zoom = 1,
  onExport,
  onApplyMethod,
  onDeleteMethod,
  onExportMethod,
  onImportMethod,
  onRefreshLinked,
  onUnlinkLinked,
  onSelectionChange,
  onOpenPlot,
}: {
  project: Project;
  tableId?: NodeId | undefined;
  ops: TableOps;
  zoom?: number;
  onExport?: () => void;
  /** Report the selected block upward so the Data menu / palette can exclude it too. */
  onSelectionChange?: ((sel: { tableId: NodeId; r0: number; c0: number; r1: number; c1: number } | null) => void) | undefined;
  /** Apply a saved analysis Method to this table (remap + run). Enables the Methods menu. */
  onApplyMethod?: ((methodId: NodeId, tableId: NodeId) => void) | undefined;
  onDeleteMethod?: ((methodId: NodeId) => void) | undefined;
  onExportMethod?: ((methodId: NodeId) => void) | undefined;
  onImportMethod?: (() => void) | undefined;
  /** Re-read / drop the live file link of a linked (auto-updating) table. */
  onRefreshLinked?: ((tableId: NodeId) => void) | undefined;
  onUnlinkLinked?: ((tableId: NodeId) => void) | undefined;
  /** Open one of the graphs drawn from this datasheet (the reverse of the graph ribbon's
   *  "Datasheet" button). Undefined = not offered. */
  onOpenPlot?: ((plotId: NodeId) => void) | undefined;
}) {
  // Mirror of the grid's selected block, for the Exclude/Include buttons above it.
  // Note: declared before the `!table` early return below — a hook after a conditional
  // return changes hook order between renders.
  const [selBounds, setSelBounds] = useState<{ r0: number; c0: number; r1: number; c1: number } | null>(null);
  const table = project.tables.find((t) => t.id === tableId) ?? project.tables[0];
  if (!table) return <p className="note">No data.</p>;
  const reps = replicateCount(table);
  const entry = tableEntryMode(table);
  const summaryMode = entry !== "replicates";
  const hasXError = Boolean(xErrorColumn(table));
  const fmt = tableFormat(table.kind);
  const warnings = validateTable(table);
  const canReplicate = fmt.replicates;
  return (
    <div>
      <div className="datarail">
        <h2 className="datarail-title" title={table.name}>{table.name}</h2>
        <select
          className="fmt-badge fmt-badge-sel"
          aria-label="Table format"
          value={table.kind}
          disabled={Boolean(table.frozen)}
          title={`Table format — click to change.\n\n${fmt.description}${fmt.analyses.length ? `\n\nUnlocks: ${fmt.analyses.join(", ")}` : ""}`}
          onChange={(e) => ops.setTableKind(table.id, e.target.value as TableKind)}
        >
          {tableFormatList().map((f) => (
            <option key={f.kind} value={f.kind}>
              {f.label}
            </option>
          ))}
        </select>
        <span className="datarail-sep" />
        <button className="railbtn" data-tour="rail-addcolumn" title="Add a column to this table" onClick={() => ops.addColumn(table.id)}>
          <span className="railbtn-plus">＋</span> Column
        </button>
        {canReplicate && (
          <label
            className="railsel"
            title="How Y values are entered — raw replicates (mean ± error computed across them), or a pre-computed Mean + SD/SEM + N per dataset (error values already computed)"
          >
            <span className="railsel-l">Entry</span>
            <select
              aria-label="Data entry mode"
              value={entry}
              onChange={(e) => ops.setEntryMode(table.id, e.target.value as EntryMode)}
            >
              {/* Same shared list the New-Graph dialog offers (`ENTRY_MODE_OPTIONS`), so the
                  two dropdowns can't drift; `short` labels for the compact rail. */}
              {ENTRY_MODE_OPTIONS.map((o) => (
                <option key={o.id} value={o.id}>{o.short}</option>
              ))}
            </select>
          </label>
        )}
        {canReplicate && (
          <div
            className="repctl"
            title={
              table.kind === "column"
                ? "A Column datasheet has no replicate subcolumns — enter replicates as rows (one value per cell), and add a row instead."
                : summaryMode
                ? "Replicate count applies in Replicates entry mode (summary mode uses Mean + SD/SEM + N columns)"
                : "Replicate subcolumns per Y dataset (mean ± error bars are computed across them)"
            }
          >
            <span className="repctl-l">Replicates</span>
            <button
              className="repctl-b"
              aria-label="Fewer replicates"
              disabled={table.kind === "column" || summaryMode || reps <= 1}
              onClick={() => ops.setReplicates(table.id, reps - 1)}
            >
              −
            </button>
            <span className="repctl-n">{reps}</span>
            <button
              className="repctl-b"
              aria-label="More replicates"
              disabled={table.kind === "column" || summaryMode}
              onClick={() => ops.setReplicates(table.id, reps + 1)}
            >
              ＋
            </button>
          </div>
        )}
        {table.kind === "xy" && (
          <label className="railtog" title="Add a shared X-error subcolumn — drawn as a horizontal ± cap on every point">
            <input type="checkbox" checked={hasXError} onChange={(e) => ops.setXError(table.id, e.target.checked)} /> X error
          </label>
        )}
        {table.kind === "survival" && (
          <label
            className="railsel"
            title="How survival time is entered — an elapsed-time column, or a Start-date/End-date pair whose difference is the elapsed time (computed in the chosen unit)"
          >
            <span className="railsel-l">Time from</span>
            <select
              aria-label="Survival time entry"
              value={table.survivalDates ? "dates" : "elapsed"}
              onChange={(e) => ops.setSurvivalDates(table.id, e.target.value === "dates")}
            >
              <option value="elapsed">Elapsed time</option>
              <option value="dates">Start &amp; end dates</option>
            </select>
          </label>
        )}
        {table.kind === "survival" && table.survivalDates && (
          <label className="railsel" title="Unit the elapsed span (end − start) is computed in. Months ≈ 30.44 days, years ≈ 365.25 days (approximate).">
            <span className="railsel-l">Unit</span>
            <select
              aria-label="Survival time unit"
              value={table.survivalDates.unit}
              onChange={(e) => ops.setSurvivalTimeUnit(table.id, e.target.value as SurvivalTimeUnit)}
            >
              <option value="days">Days</option>
              <option value="weeks">Weeks</option>
              <option value="months">Months</option>
              <option value="years">Years</option>
            </select>
          </label>
        )}
        <label className="railtog" title="Freeze the table — make it read-only so the data can't be edited by accident">
          <input type="checkbox" checked={Boolean(table.frozen)} onChange={(e) => ops.setFrozen(table.id, e.target.checked)} /> Freeze
        </label>
        {/* The reverse of the graph ribbon's "Datasheet" button: that button links a graph to
            its datasheet, this one links a datasheet to its graphs — a dropdown menu, since
            there can be many graphs per dataset. One table can feed many graphs, so it is a
            menu rather than a button — and it names them, so you pick the one you meant. */}
        {onOpenPlot && <GraphsFromTableMenu project={project} tableId={table.id} onOpenPlot={onOpenPlot} />}
        {table.linkedSource && onRefreshLinked && (
          <span className="linkedbadge" style={{ display: "inline-flex", alignItems: "center", gap: 4 }} title={`Linked to ${table.linkedSource.path} — this table re-reads automatically when the file changes on disk`}>
            {table.linkError ? "⚠️" : "🔗"} {table.linkedSource.path.split(/[\\/]/).pop()}
            {table.linkError && (
              <span className="note" style={{ color: "var(--danger)" }} title={table.linkError}>
                (could not update from the file)
              </span>
            )}
            <button type="button" className="railbtn" title="Re-read the linked file now" onClick={() => onRefreshLinked(table.id)}>
              Refresh
            </button>
            <button type="button" className="railbtn" title="Stop auto-updating (keep the current data)" onClick={() => onUnlinkLinked?.(table.id)}>
              Unlink
            </button>
          </span>
        )}
        {/* Exclude / include the selected values. Conditionally disabled off a real
            selection — a button that is always pressable but does nothing is a dead
            control. The right-click menu still works; this is the visible route. */}
        <button
          type="button"
          className="railbtn"
          disabled={!selBounds}
          title={
            selBounds
              ? "Exclude the selected values — kept in the sheet, omitted from every graph and analysis"
              : "Select one or more cells to exclude them"
          }
          onClick={() => {
            if (selBounds) ops.setExcluded(table.id, cellsInBounds(table, selBounds), true);
          }}
        >
          Exclude
        </button>
        <button
          type="button"
          className="railbtn"
          disabled={!selBounds}
          title={selBounds ? "Put the selected values back into every graph and analysis" : "Select one or more excluded cells to restore them"}
          onClick={() => {
            if (selBounds) ops.setExcluded(table.id, cellsInBounds(table, selBounds), false);
          }}
        >
          Include
        </button>
        <CellFillMenu
          disabled={!selBounds}
          onPick={(color) => { if (selBounds) ops.setCellFills(table.id, cellsInBounds(table, selBounds), color); }}
        />
        <CellPatternMenu
          disabled={!selBounds}
          onPick={(pattern) => { if (selBounds) ops.setCellPatterns(table.id, cellsInBounds(table, selBounds), pattern); }}
        />
        <span className="paneact-spacer" />
        {onApplyMethod && (
          <MethodsMenu
            methods={project.methods ?? []}
            onApply={(id) => onApplyMethod(id, table.id)}
            onDelete={onDeleteMethod}
            onExport={onExportMethod}
            onImport={onImportMethod}
          />
        )}
        <ExportButton label="Export this dataset (CSV · Excel · JSON)" onClick={onExport} />
      </div>
      {warnings.length > 0 && (
        <ul className="scene-warnings" role="status" style={{ marginBottom: 10 }}>
          {warnings.map((w, i) => (
            <li key={i}>{w}</li>
          ))}
        </ul>
      )}
      <DataGrid
        table={table}
        zoom={zoom}
        onEditCell={(r, c, v) => ops.editCell(table.id, r, c, v)}
        onRenameColumn={(colId, name) => ops.renameColumn(table.id, colId, name)}
        onPaste={(r, c, block) => ops.paste(table.id, r, c, block)}
        onClearCells={(r, c, rows, cols) => ops.clearCells(table.id, r, c, rows, cols)}
        onFillDown={(r, c, rows, cols) => ops.fillDown(table.id, r, c, rows, cols)}
        onTranspose={(r, c, rows, cols) => ops.transpose(table.id, r, c, rows, cols)}
        onInsertRow={(i) => ops.insertRow(table.id, i)}
        onDeleteRow={(i) => ops.deleteRow(table.id, i)}
        onInsertColumn={(i) => ops.insertColumn(table.id, i)}
        onDeleteColumn={(i) => ops.deleteColumn(table.id, i)}
        onDeleteColumns={(idx) => ops.deleteColumns(table.id, idx)}
        onMoveRow={(from, to) => ops.moveRow(table.id, from, to)}
        onMoveColumn={(from, to) => ops.moveColumn(table.id, from, to)}
        onSetXColumn={(index) => ops.setXColumn(table.id, index)}
        onSortColumn={(index, direction) => { const col = table.columns[index]; if (col) ops.sortRowsByColumn(table.id, col.id, direction); }}
        onSetColumnType={(colId, type) => ops.setColumnType(table.id, colId, type)}
        onSetColumnDecimals={(colId, dec) => ops.setColumnDecimals(table.id, colId, dec)}
        onSetColumnFormula={(colId, f) => ops.setColumnFormula(table.id, colId, f)}
        onToggleExcluded={(cells, excluded) => ops.setExcluded(table.id, cells, excluded)}
        onSelectionChange={(b) => {
          setSelBounds(b);
          onSelectionChange?.(b ? { tableId: table.id, ...b } : null);
        }}
      />
      <ul className="viewhints" aria-label="Datasheet shortcuts">
        <li><b>Click</b> a cell to type; <b>double-click</b> a header to rename it (axis titles follow)</li>
        <li><b>Paste</b> a block from Excel and the sheet grows to fit</li>
        <li>Filling an empty column adds a series. Every edit is undoable</li>
      </ul>
    </div>
  );
}

/** Quick-action handlers for the graph ribbon (wired to the same commands as the inspector). */
export interface GraphRibbonOps {
  onSetGrid: (delta: GridStyle) => void;
  onSetLegend: (patch: Partial<LegendSpec>) => void;
  onSetFrame: (patch: { frame?: FrameStyle }) => void;
  onSetAxisScale: (axis: "x" | "y", scale: "log10" | "linear" | "auto") => void;
  onSetPlotFont: (element: FontElementName, patch: { size?: number | undefined; bold?: boolean | undefined; italic?: boolean | undefined; family?: string | undefined }) => void;
  /** Insert an annotation (text box / line / arrow / shape) from the ribbon. */
  onAddAnnotation: (ann: Omit<Annotation, "id">) => void;
  /** Pick + insert an image onto the graph (opens the OS file picker). */
  onInsertImage: () => void;
  /** Auto-compute the first→last % change and drop it as an editable label. */
  onAddPercentChange: () => void;
  /** Toggle bar value labels (bar charts). */
  onSetShowValues: (show: boolean) => void;
  /** Toggle the individual-replicate swarm over each bar. */
  onSetShowBarPoints: (show: boolean) => void;
  /** Set the graph's centre & spread — maps to boxWhisker (box/violin/raincloud) or the
   *  per-series error-bar type (bar/scatter/…). Value is a BoxWhisker or ErrorBarType string. */
  onSetSummary: (value: string) => void;
  zoom: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onZoomReset: () => void;
}

/** Centre & spread options for the ribbon's Summary dropdown — each names its own centre
 *  (no invalid median±SD). Error-bar family (bar/scatter) and whisker family (box/violin). */
const RIBBON_ERROR_OPTS: ReadonlyArray<[string, string]> = [
  ["none", "None"],
  ["sd", "Mean ± SD"],
  ["sem", "Mean ± SEM"],
  ["ci95", "Mean ± 95% CI"],
  ["range", "Mean + range"],
  ["geoSd", "Geometric (×/÷ SD)"],
  ["iqr", "Median + IQR (Q1–Q3)"],
];
const RIBBON_WHISKER_OPTS: ReadonlyArray<[string, string]> = [
  ["tukey", "Median (Tukey 1.5·IQR)"],
  ["minmax", "Median (min → max)"],
  ["p10_90", "Median (10–90%)"],
  ["p5_95", "Median (5–95%)"],
  ["p2_5_97_5", "Median (2.5–97.5%)"],
  ["p1_99", "Median (1–99%)"],
  ["sd", "Mean ± SD"],
  ["sem", "Mean ± SEM"],
  ["ci95", "Mean ± 95% CI"],
];

/** Insert presets surfaced in the ribbon — the same annotation kinds as the inspector Draw bar. */
const INSERT_ITEMS: { label: string; title: string; make: () => Omit<Annotation, "id"> }[] = [
  { label: "Text", title: "Text box", make: () => ({ kind: "text", label: "Text", x: 0.5, y: 0.12 }) },
  { label: "Line", title: "Line segment", make: () => ({ kind: "segment", x: 0.3, y: 0.5, x2: 0.6, y2: 0.5 }) },
  { label: "Arrow", title: "Arrow", make: () => ({ kind: "arrow", x: 0.3, y: 0.55, x2: 0.6, y2: 0.35, arrowHead: "end" }) },
  { label: "Box", title: "Rectangle / box", make: () => ({ kind: "rect", x: 0.34, y: 0.3, w: 0.26, h: 0.2 }) },
  { label: "Highlight", title: "Highlight box (bold outline + faint tint over a region). Select a bar/series first to snap it around that data.", make: () => ({ kind: "highlight", x: 0.34, y: 0.3, w: 0.26, h: 0.2 }) },
  { label: "Ellipse", title: "Ellipse", make: () => ({ kind: "ellipse", x: 0.34, y: 0.3, w: 0.26, h: 0.2 }) },
  { label: "Callout", title: "Callout (text + arrow)", make: () => ({ kind: "callout", label: "Note", x: 0.2, y: 0.2, x2: 0.5, y2: 0.5, arrowHead: "end" }) },
  { label: "V-band", title: "Vertical shaded band behind the plot (highlight an X range)", make: () => ({ kind: "vband", x: 0.4, w: 0.2, fill: "#9b8cff", fillOpacity: 0.16 }) },
  { label: "H-band", title: "Horizontal shaded band behind the plot (highlight a Y range)", make: () => ({ kind: "hband", y: 0.4, h: 0.2, fill: "#9b8cff", fillOpacity: 0.16 }) },
];

/** Which figure text element the ribbon's font controls target, from the selection. */
type FontElementName = "title" | "subtitle" | "axisTitle" | "tick" | "legend" | "valueLabel";

// --- ribbon math/symbol insertion → the currently-open inline text editor -------
/** The inline text editor that's open over the figure (focused, or the only one). */
function activeFigureEditor(): HTMLInputElement | HTMLTextAreaElement | null {
  const a = document.activeElement as HTMLElement | null;
  if (a && (a.tagName === "INPUT" || a.tagName === "TEXTAREA") && a.closest(".gfx-figwrap"))
    return a as HTMLInputElement | HTMLTextAreaElement;
  return document.querySelector<HTMLInputElement | HTMLTextAreaElement>(".gfx-figwrap input, .gfx-figwrap textarea");
}
/** Set a controlled input's value the React way (native setter + input event), then restore selection. */
function setEditorValue(el: HTMLInputElement | HTMLTextAreaElement, value: string, selStart: number, selEnd: number): void {
  const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
  requestAnimationFrame(() => {
    el.focus();
    el.setSelectionRange(selStart, selEnd);
  });
}
/** Insert a symbol at the caret of the active figure editor (no-op if none open). */
function insertSymbolInEditor(sym: string): void {
  const el = activeFigureEditor();
  if (!el) return;
  const s = el.selectionStart ?? el.value.length;
  const e = el.selectionEnd ?? s;
  setEditorValue(el, el.value.slice(0, s) + sym + el.value.slice(e), s + sym.length, s + sym.length);
}
/** Wrap the active editor's selection in pre…post (e.g. ^{…} / _{…}). */
function wrapSelectionInEditor(pre: string, post: string): void {
  const el = activeFigureEditor();
  if (!el) return;
  let s = el.selectionStart ?? el.value.length;
  let e = el.selectionEnd ?? s;
  // Never wrap the entire title (that turns "Dose (uM)" into "^{Dose (uM)}" — the
  // whole label becomes superscript). A full-field selection → collapse to the end
  // and insert a placeholder the user then types over.
  if (s === 0 && e === el.value.length && el.value.length > 0) s = e = el.value.length;
  const sel = el.value.slice(s, e) || "x";
  setEditorValue(el, el.value.slice(0, s) + pre + sel + post + el.value.slice(e), s + pre.length, s + pre.length + sel.length);
}

const RIBBON_SYMBOLS = ["α", "β", "γ", "δ", "μ", "σ", "ρ", "λ", "π", "η", "χ", "Δ", "Σ", "±", "×", "÷", "°", "·", "≤", "≥", "≠", "→", "∞", "√"];

/**
 * Ribbon "Ω" symbol palette — a button that toggles a small grid of insert
 * buttons. A native <select> can't be used here: preventDefault (needed to keep
 * the inline editor focused) blocks the dropdown from opening. Buttons work
 * because preventDefault on a button's mousedown keeps focus without side effects.
 */
function SymbolPopover() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);
  return (
    <span className="symbwrap" ref={ref}>
      <button
        type="button"
        className={"grbbtn" + (open ? " on" : "")}
        title="Insert a Greek letter or maths symbol into the text you're editing"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setOpen((o) => !o)}
      >
        Ω
      </button>
      {open && (
        <div className="symbpop" onMouseDown={(e) => e.preventDefault()}>
          {RIBBON_SYMBOLS.map((s) => (
            <button
              key={s}
              type="button"
              className="symbbtn"
              title={`Insert ${s}`}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => insertSymbolInEditor(s)}
            >
              {s}
            </button>
          ))}
        </div>
      )}
    </span>
  );
}

/**
 * Word-level style: bold, italicise or colour only the selected words of the text being edited, by
 * wrapping them in `*{…}`, `/{…}` or `#{colour|…}` — the same way x² wraps them in `^{…}`. (The B / I beside the font
 * style the whole text.) Colour is a swatch grid, not a colour picker: a picker takes the focus and the edit would commit
 * before the colour could apply. Every press keeps the editor focused (mousedown default prevented).
 */
export function WordStyleButtons() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);
  return (
    <>
      <button type="button" className="grbbtn" title="Bold the selected words only — wraps them in *{…}. Edit a text first." onMouseDown={(e) => e.preventDefault()} onClick={() => wrapSelectionInEditor("*{", "}")}>
        <b>w</b>
      </button>
      <button type="button" className="grbbtn" title="Italicise the selected words only — wraps them in /{…}. Edit a text first." onMouseDown={(e) => e.preventDefault()} onClick={() => wrapSelectionInEditor("/{", "}")}>
        <i>w</i>
      </button>
      <span className="symbwrap" ref={ref}>
        <button
          type="button"
          className={"grbbtn" + (open ? " on" : "")}
          title="Colour the selected words only — pick a colour; wraps them in #{colour|…}. Edit a text first."
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => setOpen((o) => !o)}
        >
          <span style={{ borderBottom: `3px solid ${OKABE_ITO[5]}` }}>w</span>
        </button>
        {open && (
          <div className="symbpop" onMouseDown={(e) => e.preventDefault()}>
            {OKABE_ITO.map((c) => (
              <button
                key={c}
                type="button"
                className="symbbtn"
                data-word-colour={c}
                title={`Colour the selected words ${c}`}
                style={{ background: c, width: 22, height: 22 }}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => { wrapSelectionInEditor(`#{${c}|`, "}"); setOpen(false); }}
              />
            ))}
          </div>
        )}
      </span>
    </>
  );
}

const RIBBON_FONTS: { label: string; value: string }[] = [
  { label: "Default", value: "" },
  { label: "Sans", value: "system-ui, sans-serif" },
  { label: "Serif", value: "Georgia, 'Times New Roman', serif" },
  { label: "Arial", value: "Arial, Helvetica, sans-serif" },
  { label: "Times", value: "'Times New Roman', Times, serif" },
  { label: "Mono", value: "'Courier New', Courier, monospace" },
];

/**
 * A quick-action ribbon above the graph: grid / minor-grid /
 * legend toggles, frame style, zoom, and — when a text element is selected — its
 * font controls (family / size / bold / italic), so editing an axis, title, or
 * label is one click away. Mirrors inspector commands; nothing here is new state.
 */
const RIBBON_ROLES: { value: FontElementName; label: string }[] = [
  { value: "title", label: "Title" },
  { value: "subtitle", label: "Subtitle" },
  { value: "axisTitle", label: "Axis titles" },
  { value: "tick", label: "Tick numbers" },
  { value: "legend", label: "Legend" },
  { value: "valueLabel", label: "Bar values" },
];

export function GraphRibbon({
  plot,
  selected,
  focusRole,
  ops,
  title,
  zoomed,
  onResetView,
  onExport,
  onCaption,
  onOpenTable,
  linkedSheets,
  xLogResolved,
  yLogResolved,
  wheelZoom,
  rulerPref,
  rulerUnit,
  colorVision,
}: {
  plot: Plot;
  selected: GraphSelection;
  /** Text role of an open inline editor (title/subtitle/axis title) — overrides the
   *  role picker so the font controls format the text the user is editing. A fresh
   *  object each focus so re-opening the same role re-syncs. */
  focusRole?: { role: "title" | "subtitle" | "axisTitle" } | null | undefined;
  ops: GraphRibbonOps;
  title: string;
  zoomed?: boolean | undefined;
  onResetView?: (() => void) | undefined;
  onExport?: (() => void) | undefined;
  /** Draft a figure caption + alt-text for this graph (opt-in; nothing auto-inserted). */
  onCaption?: (() => void) | undefined;
  /** Open one of the datasheets this graph is drawn from, by id. Absent when there are none to open. */
  onOpenTable?: ((tableId: NodeId) => void) | undefined;
  /** Every datasheet this graph draws from: its own source sheet first, then any sheet a series is
   *  borrowed from (`plot.overlays`, composite graphs). One item → a plain button; more → a menu. */
  linkedSheets?: { id: NodeId; name: string }[] | undefined;
  /** Effective (resolved) log state from the built scene — so the toggle reflects
   *  an auto-suggested log axis, not just an explicit one. */
  xLogResolved?: boolean | undefined;
  yLogResolved?: boolean | undefined;
  /** The "Wheel zoom" tickbox — present only for a graph the wheel can zoom (a zoomable axis or
   *  the 3-D camera), so it never shows as a dead control on a pie or a treemap. */
  wheelZoom?: { value: boolean; set: (v: boolean) => void } | undefined;
  /** The "Ruler" tickbox — a measuring ruler framed outside the figure (app-wide preference).
   *  Always offered on a graph; it frames any figure, so it is never a dead control. */
  rulerPref?: { value: boolean; set: (v: boolean) => void } | undefined;
  /** View ▸ Colour-blind preview — screen-only, never exported. */
  colorVision?: { value: ColorVisionPref; set: (v: ColorVisionPref) => void } | undefined;
  /** The ruler's unit picker — shown only while the ruler is on. */
  rulerUnit?: { value: RulerUnit; set: (v: RulerUnit) => void } | undefined;
}) {
  const gridShow = plot.grid?.show ?? true;
  const minor = plot.grid?.minor ?? false;
  const legendShow = plot.legend?.show ?? true;
  const frame = plot.frame ?? "lshape";
  // The font controls target whichever text role the user picks here — so each
  // piece of text (title / subtitle / axis titles / ticks / legend) is editable
  // individually. Clicking an axis on the graph jumps the picker to axis titles.
  const [role, setRole] = useState<FontElementName>("title");
  useEffect(() => {
    if (selected?.kind === "axis") setRole("axisTitle");
  }, [selected]);
  // Editing a title / subtitle / axis title points the font controls at it.
  useEffect(() => {
    if (focusRole) setRole(focusRole.role);
  }, [focusRole]);
  const spec = plot.fonts?.[role] ?? {};
  // Reflect the effective scale: an explicit log, or one the renderer auto-picked.
  const xLog = xLogResolved ?? ((plot.xAxis?.scale ?? plot.xScale) === "log10");
  const yLog = yLogResolved ?? ((plot.yAxis?.scale ?? plot.yScale) === "log10");
  return (
    <div className="graphribbon">
      <span className="grbtitle" title={title}>{title}</span>
      {(zoomed || (ops.zoom ?? 1) !== 1) && (
        <button type="button" className="grbbtn grbwide" title="Reset the view — zoom back to 100% and pan back to the full data (or double-click the plot)" onClick={() => { onResetView?.(); ops.onZoomReset(); }}>
          Reset view
        </button>
      )}
      <span className="grbsep" />

      {/* View toggles */}
      <span className="grbgroup" role="group" aria-label="View">
        <label className="grbtog"><input type="checkbox" checked={gridShow} onChange={(e) => ops.onSetGrid({ show: e.target.checked })} /> Grid</label>
        <label className="grbtog"><input type="checkbox" checked={minor} onChange={(e) => ops.onSetGrid({ minor: e.target.checked })} /> Minor</label>
        {wheelZoom && (
          <label className="grbtog" title="Let the mouse wheel zoom this graph. Off (the default), the wheel scrolls the page and the graph stays put — drag, double-click and Ctrl+wheel still work. Remembered for every graph.">
            <input type="checkbox" checked={wheelZoom.value} onChange={(e) => wheelZoom.set(e.target.checked)} /> Wheel zoom
          </label>
        )}
        {rulerPref && (
          <label className="grbtog" title="Show a measuring ruler around this graph (top & left). It tracks resize and zoom. Remembered for every graph.">
            <input type="checkbox" checked={rulerPref.value} onChange={(e) => rulerPref.set(e.target.checked)} /> Ruler
          </label>
        )}
        {rulerPref?.value && rulerUnit && (
          <select
            className="grbunit"
            value={rulerUnit.value}
            onChange={(e) => rulerUnit.set(e.target.value as RulerUnit)}
            title="Ruler unit — figure pixels (96 dpi), inches, or centimetres"
            aria-label="Ruler unit"
          >
            <option value="px">px</option>
            <option value="in">inch</option>
            <option value="cm">cm</option>
          </select>
        )}
        {colorVision && (
          <select
            className="grbunit"
            value={colorVision.value}
            onChange={(e) => colorVision.set(e.target.value as ColorVisionPref)}
            aria-label="Colour-vision preview"
            title="Colour-vision preview — see this graph (and every figure) as a colour-blind reader or a greyscale printer would. Screen only: exports are never changed."
          >
            <option value="off">Normal colour</option>
            {(Object.keys(COLOR_VISION_NAME) as ColorVision[]).map((k) => <option key={k} value={k}>{COLOR_VISION_NAME[k]}</option>)}
          </select>
        )}
        {/* The same promise as the Inspector's Legend section, and it has to follow the same
            rule: nine kinds build no legend at all (their datasets are not what the drawing
            distinguishes), so this tickbox would do nothing there. `legend-offered.test.tsx`
            derives that list from the builder. */}
        {!NO_SERIES_LEGEND.has(plot.kind ?? "xy") && (
          <label className="grbtog"><input type="checkbox" checked={legendShow} onChange={(e) => ops.onSetLegend({ show: e.target.checked })} /> Legend</label>
        )}
      </span>
      <span className="grbsep" />

      {/* Centre & spread — the mean/median + SD/SEM/CI/IQR choice, reachable from the top bar
          as well as the Inspector. Box family drives boxWhisker; bar/scatter the error-bar type. */}
      {(() => {
        const k = plot.kind ?? "xy";
        const boxFam = k === "box" || k === "violin" || k === "raincloud";
        // Column scatter carries centre+spread on `plot.columnScatter` (a coherent single
        // choice), not the per-series error-bar type the bar family uses — so it reads/writes
        // through SCATTER_SUMMARY_OPTS; the scatter builder never reads seriesStyles.errorBars.
        const scatterFam = k === "scatter";
        const errFam = k === "bar";
        if (!boxFam && !errFam && !scatterFam) return null;
        const value = boxFam
          ? plot.boxWhisker ?? "tukey"
          : scatterFam
          ? scatterSummaryKey(plot.columnScatter)
          : Object.values(plot.seriesStyles ?? {}).find((s) => s?.errorBars)?.errorBars ?? "sd";
        const opts: ReadonlyArray<readonly [string, string]> = boxFam
          ? RIBBON_WHISKER_OPTS
          : scatterFam
          ? SCATTER_SUMMARY_OPTS.map((o) => [o.key, o.label] as const)
          : RIBBON_ERROR_OPTS;
        return (
          <>
            <span className="grbgroup" role="group" aria-label="Summary">
              <label className="grbtog" title="Centre & spread — what the bar/box shows and its error/whiskers. Each option names its own centre (mean or median); no invalid median±SD. Changeable anytime.">
                Summary{" "}
                <select aria-label="Summary" className="selin" value={value} onChange={(e) => ops.onSetSummary(e.target.value)}>
                  {opts.map(([v, l]) => (
                    <option key={v} value={v}>{l}</option>
                  ))}
                </select>
              </label>
            </span>
            <span className="grbsep" />
          </>
        );
      })()}

      {/* Scale */}
      <span className="grbgroup" role="group" aria-label="Scale">
        <label className="grbtog" title="Log10 scale on the X axis"><input type="checkbox" checked={xLog} onChange={(e) => ops.onSetAxisScale("x", e.target.checked ? "log10" : "linear")} /> X log</label>
        <label className="grbtog" title="Log10 scale on the Y axis"><input type="checkbox" checked={yLog} onChange={(e) => ops.onSetAxisScale("y", e.target.checked ? "log10" : "linear")} /> Y log</label>
      </span>
      <span className="grbsep" />

      {/* Frame */}
      <span className="grbgroup" role="group" aria-label="Frame">
        {(plot.kind === "bar" || plot.kind === "histogram") && (
          <label className="grbtog" title="Show each bar's value as a label (style it via Text → Bar values)">
            <input
              type="checkbox"
              checked={plot.showValues ?? false}
              onChange={(e) => ops.onSetShowValues(e.target.checked)}
            /> Values
          </label>
        )}
        {/* Individual replicates over each bar — on by default, because a bar alone hides
            the distribution. Beside "Values" since both answer "what else goes on the bar?".
            Bar only: a histogram's bars are counted bins, so there are no replicates to show. */}
        {plot.kind === "bar" && (
          <label className="grbtog" title="Show every replicate as a dot over its own bar. Click a dot to style the points like any other data points.">
            <input
              type="checkbox"
              checked={plot.showBarPoints ?? true}
              onChange={(e) => ops.onSetShowBarPoints(e.target.checked)}
            /> Points
          </label>
        )}
        <label className="grbsel">
          Frame
          <select value={frame} onChange={(e) => ops.onSetFrame({ frame: e.target.value as FrameStyle })}>
            <option value="lshape">L-shape</option>
            <option value="box">Box</option>
            <option value="offset">Offset</option>
            <option value="none">None</option>
          </select>
        </label>
      </span>
      <span className="grbsep" />

      {/* Insert */}
      <span className="grbgroup" role="group" aria-label="Insert">
        <label className="grbsel" title="Insert a text box, line, arrow, or shape on the graph">
          Insert
          <select
            aria-label="Insert annotation"
            value=""
            onChange={(e) => {
              const v = e.target.value;
              e.currentTarget.value = "";
              if (v === "__image__") {
                ops.onInsertImage();
                return;
              }
              const item = INSERT_ITEMS.find((it) => it.label === v);
              if (item) ops.onAddAnnotation(item.make());
            }}
          >
            <option value="">＋ Add…</option>
            {INSERT_ITEMS.map((it) => (
              <option key={it.label} value={it.label} title={it.title}>
                {it.label}
              </option>
            ))}
            <option value="__image__" title="Insert an image (PNG / JPG / SVG) onto the graph">
              Image…
            </option>
          </select>
        </label>
        <button
          type="button"
          className="grbbtn grbwide"
          title="Auto % change — compute the first→last change of the data and drop an editable label"
          onClick={ops.onAddPercentChange}
        >
          Δ%
        </button>
      </span>
      <span className="grbsep" />

      {/* Text & typography. The math/symbol toolbox acts on the open inline text
          editor (double-click any text first); preventDefault on mousedown keeps
          the editor focused so its blur-commit doesn't fire. */}
      <span className="grbgroup" role="group" aria-label="Text">
        <label className="grbsel" title="Choose which text to format">
          Text
          <select aria-label="Text element" value={role} onChange={(e) => setRole(e.target.value as FontElementName)}>
            {RIBBON_ROLES.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
        </label>
        <select
          className="grbfont"
          aria-label="Font family"
          value={spec.family ?? ""}
          onChange={(e) => ops.onSetPlotFont(role, { family: e.target.value || undefined })}
        >
          {RIBBON_FONTS.map((f) => (
            <option key={f.label} value={f.value}>
              {f.label}
            </option>
          ))}
        </select>
        <input
          className="grbsize"
          type="number"
          aria-label="Font size"
          min={4}
          max={96}
          value={spec.size ?? ""}
          placeholder="auto"
          onChange={(e) => ops.onSetPlotFont(role, { size: e.target.value.trim() === "" ? undefined : Number(e.target.value) })}
        />
        <button
          type="button"
          className={"grbbtn grbb" + (spec.bold ? " on" : "")}
          title="Bold"
          // keep the inline text editor focused (don't blur-commit) so Bold applies live while editing
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => ops.onSetPlotFont(role, { bold: !spec.bold || undefined })}
        >
          B
        </button>
        <button
          type="button"
          className={"grbbtn grbi" + (spec.italic ? " on" : "")}
          title="Italic"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => ops.onSetPlotFont(role, { italic: !spec.italic || undefined })}
        >
          I
        </button>
        <button
          type="button"
          className="grbbtn"
          title="Superscript — wrap the selected text in ^{…} (e.g. cm² ). Edit a text first."
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => wrapSelectionInEditor("^{", "}")}
        >
          x²
        </button>
        <button
          type="button"
          className="grbbtn"
          title="Subscript — wrap the selected text in _{…} (e.g. H₂O). Edit a text first."
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => wrapSelectionInEditor("_{", "}")}
        >
          x₂
        </button>
        <SymbolPopover />
        <WordStyleButtons />
      </span>

      <span className="grbspacer" />

      {/* Disabled at each end, and the readout names the end it has reached, so + at 400%
          does not light up while nothing moves. */}
      <span className="grbzoom" role="group" aria-label="Zoom">
        <button type="button" className="grbbtn" onClick={ops.onZoomOut} disabled={!canZoom(ops.zoom, -1)} title={canZoom(ops.zoom, -1) ? "Zoom out" : "Already at the smallest zoom"}>−</button>
        <button type="button" className="grbbtn grbzval" onClick={ops.onZoomReset} title="Reset zoom to 100%" data-zoom-label>
          {zoomLabel(ops.zoom)}
        </button>
        <button type="button" className="grbbtn" onClick={ops.onZoomIn} disabled={!canZoom(ops.zoom, 1)} title={canZoom(ops.zoom, 1) ? "Zoom in" : "Already at the largest zoom"}>+</button>
      </span>
      {onCaption && (
        <>
          <span className="grbsep" />
          <button
            type="button"
            className="grbbtn"
            title="Draft a figure caption + an accessibility alt-text description you can copy into a manuscript — editable, and never inserted automatically"
            onClick={onCaption}
          >
            Caption
          </button>
        </>
      )}
      {/* The numbers behind the picture. A graph opened from the gallery (or from the tree)
          leaves its datasheet unopened; this button leads from the figure back to the data it
          is drawn from without hunting the project tree for a matching name. When a graph
          borrows a series from another datasheet (a composite graph), it is drawn from more than
          one sheet — so this becomes a menu listing every linked sheet, mirroring the datasheet's
          own "Graphs" menu (the reverse direction). */}
      {onOpenTable && linkedSheets && linkedSheets.length > 0 && (
        <>
          <span className="grbsep" />
          {linkedSheets.length === 1 ? (
            <button
              type="button"
              className="grbbtn"
              title={`Open the datasheet this graph is drawn from — “${linkedSheets[0]!.name}”`}
              onClick={() => onOpenTable(linkedSheets[0]!.id)}
            >
              <Table2 size={13} /> Datasheet
            </button>
          ) : (
            <SheetsForGraphMenu sheets={linkedSheets} onOpenTable={onOpenTable} />
          )}
        </>
      )}
      {onExport && (
        <>
          <span className="grbsep" />
          <button type="button" className="grbbtn grbexport" title="Export this graph (PNG · SVG · PDF · …)" onClick={onExport}>
            <Download size={13} /> Export
          </button>
        </>
      )}
    </div>
  );
}

/** Ruler band thickness (px) — matches the panel assembler's `RULER`. */
const GRAPH_RULER = 22;

/**
 * Pick a "nice" tick step (1 / 2 / 5 × 10ᵏ) closest to `rawStep` — e.g. 0.5, 1, 2, 5, 10.
 * `rawStep` is in the display unit (px / inch / cm), so fractional steps are allowed (a ruler
 * in inches wants 0.5-in ticks, not a 1-unit floor).
 */
export function niceRulerStep(rawStep: number): number {
  const mag = Math.pow(10, Math.floor(Math.log10(Math.max(rawStep, 1e-9))));
  const norm = rawStep / mag; // 1..10
  const mult = norm >= 5 ? 5 : norm >= 2 ? 2 : 1;
  return mult * mag;
}

/** Format a tick value for a given step: whole numbers for px / coarse steps, else just enough
 *  decimals for the step (e.g. 0.5, 1.5) with trailing zeros trimmed. */
export function fmtRulerTick(value: number, step: number): string {
  if (step >= 1) return String(Math.round(value));
  const dec = Math.min(3, Math.max(0, Math.ceil(-Math.log10(step))));
  return value.toFixed(dec).replace(/\.?0+$/, "");
}

/**
 * A measuring ruler wrapped outside the figure — a top band and a left band (plus the corner),
 * reserving margin and never painting over the plot (a ruler drawn inside would hide data). It
 * sizes itself to the figure's measured rendered box (a `ResizeObserver` on the `.gfx-figure`
 * svg), so it stays aligned through figure resize, view zoom, and pane-narrowing — at zoom ≤ 1 the figure shrinks to fit the pane (`maxWidth:100%`) and
 * the measured box follows, which `scene.width * zoom` would not.
 *
 * Ticks are labelled in the chosen `unit` (figure px = export px, inches, or cm — a scene px is
 * a 96-dpi CSS pixel), 0 at the top-left corner. The label step adapts to the zoom so the
 * on-screen spacing stays readable. Built to match `RulerBands`.
 */
function FigureRuler({ sceneW, sceneH, zoom, unit, children }: { sceneW: number; sceneH: number; zoom: number; unit: RulerUnit; children: React.ReactNode }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<{ w: number; h: number }>({ w: sceneW, h: sceneH });
  useEffect(() => {
    const host = wrapRef.current;
    if (!host) return;
    // Observe the HTML wrapper, not the <svg>: a ResizeObserver does not reliably fire for an
    // SVG element in Chromium (neither a width-attribute change at zoom nor a maxWidth:100%
    // clamp on pane-narrowing is reported). The `.gfx-figwrap` div is an inline-block box that
    // shrink-wraps the figure, so its border-box tracks the rendered figure through resize,
    // zoom, and pane-narrowing, and an HTML box is observed reliably.
    const figwrap = host.querySelector<HTMLElement>(".gfx-figwrap");
    if (!figwrap) return;
    const measure = (): void => {
      const r = figwrap.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) setBox({ w: r.width, h: r.height });
    };
    measure();
    // `zoom` in the deps re-queries + re-measures on a zoom change too, in case the observer
    // is slow to report an attribute-driven resize.
    const ro = new ResizeObserver(measure);
    ro.observe(figwrap);
    // A window resize narrows the pane (the figure clamps to maxWidth:100% at zoom ≤ 1) and is
    // reported synchronously — a second trigger alongside the observer, which alone catches
    // pane-narrowing from an internal splitter drag (Inspector / Project panel) that fires no
    // window event. `measure` reads getBoundingClientRect, so it needs no layout-settle wait.
    window.addEventListener("resize", measure);
    // A frame later the layout has settled (the figure's own resize/zoom effects have run),
    // so a second read corrects any value measured mid-transition.
    const raf = requestAnimationFrame(measure);
    return () => { ro.disconnect(); window.removeEventListener("resize", measure); cancelAnimationFrame(raf); };
  }, [sceneW, sceneH, zoom]);

  // Screen px per scene px; multiplied by px-per-unit gives screen px per display unit, so ticks
  // are chosen and labelled in the chosen unit while positions stay in real pixels.
  const scaleX = box.w / Math.max(sceneW, 1);
  const scaleY = box.h / Math.max(sceneH, 1);
  const ppu = pxPerUnit(unit);
  const stepX = niceRulerStep(80 / (scaleX * ppu)); // in display units
  const stepY = niceRulerStep(80 / (scaleY * ppu));
  const top: React.ReactNode[] = [];
  const left: React.ReactNode[] = [];
  const spanUX = sceneW / ppu; // figure width in display units
  const spanUY = sceneH / ppu;
  for (let i = 0, u = 0; u <= spanUX + stepX / 10; i++, u = i * (stepX / 5)) {
    const major = i % 5 === 0;
    const sx = u * ppu * scaleX; // display unit → scene px → screen px
    top.push(<line key={`tx${i}`} x1={sx} y1={GRAPH_RULER} x2={sx} y2={GRAPH_RULER - (major ? 8 : 4)} stroke="var(--muted)" strokeWidth={1} />);
    if (major && u > 0) top.push(<text key={`txl${i}`} x={sx + 2} y={GRAPH_RULER - 11} fontSize={9} fill="var(--muted)">{fmtRulerTick(u, stepX)}</text>);
  }
  for (let i = 0, u = 0; u <= spanUY + stepY / 10; i++, u = i * (stepY / 5)) {
    const major = i % 5 === 0;
    const sy = u * ppu * scaleY;
    left.push(<line key={`ly${i}`} x1={GRAPH_RULER} y1={sy} x2={GRAPH_RULER - (major ? 8 : 4)} y2={sy} stroke="var(--muted)" strokeWidth={1} />);
    if (major && u > 0) left.push(<text key={`lyl${i}`} x={3} y={sy - 3} fontSize={9} fill="var(--muted)">{fmtRulerTick(u, stepY)}</text>);
  }
  return (
    <div ref={wrapRef} className="figruler" style={{ position: "relative", display: "inline-block", paddingLeft: GRAPH_RULER, paddingTop: GRAPH_RULER }}>
      <svg className="layruler figruler-band figruler-top" width={box.w} height={GRAPH_RULER} style={{ position: "absolute", left: GRAPH_RULER, top: 0 }}>{top}</svg>
      <svg className="layruler figruler-band figruler-left" width={GRAPH_RULER} height={box.h} style={{ position: "absolute", left: 0, top: GRAPH_RULER }}>{left}</svg>
      {/* The corner names the unit the numbers are in. */}
      <div className="layruler-corner figruler-corner" style={{ position: "absolute", left: 0, top: 0, width: GRAPH_RULER, height: GRAPH_RULER }}>{unit}</div>
      {children}
    </div>
  );
}

/**
 * How a graph is built for its own pane — and for Export all, which draws every graph
 * off screen exactly as its pane would (one set of options, so a batch file matches the on-screen graph).
 */
export function graphSceneOptions(
  project: Project,
  plot: Plot,
  view?: { xDomain?: [number, number] | undefined; yDomain?: [number, number] | undefined } | null | undefined,
): Parameters<typeof buildPlotScene>[2] {
  return {
    measure: measureText,
    // Laid out at its own size (or the renderer's default) — never at the window fit: the fit, like every resize, is a
    // uniform scale of that drawing (`shownScale` in the pane): resizing keeps proportions.
    ...(plot.figureWidth ? { width: plot.figureWidth } : {}),
    ...(plot.figureHeight ? { height: plot.figureHeight } : {}),
    ...scenePaletteOpt(plot),
    xDomain: view?.xDomain,
    yDomain: view?.yDomain,
    // Series borrowed from other datasheets (plot.overlays) resolve through the project.
    // The pane re-renders on every project change, so an edit to the other sheet
    // redraws the borrowed series live, exactly like an edit to the plot's own sheet.
    tables: (id) => project.tables.find((t) => t.id === id),
    // User-built colour ramps (`custom:<id>`) resolve through the same project, for the same
    // reason: editing the gradient redraws every graph using it.
    gradients: (id) => project.gradients?.find((gr) => gr.id === id),
  };
}

export function GraphPane({
  project,
  plotId,
  selected,
  onSelect,
  zoom = 1,
  view,
  onViewChange,
  onWidthResize,
  onMoveAnnotation,
  onMoveRefLineLabel,
  onDeleteAnnotation,
  onReorderAnnotation,
  onDuplicateAnnotation,
  onBoxAction,
  boxHighlightBlocked,
  onFigureResize,
  onFigureScale,
  figureFit,
  onEditText,
  onCreateTextBox,
  onAxisResize,
  onMoveTitle,
  onMoveSubtitle,
  onMoveLegend,
  onMoveSignificanceCaption,
  onMoveColorbar,
  onMoveWaffleCaption,
  onMoveFitLabel,
  onMoveFitParams,
  onMoveFitParamLine,
  onMoveHeatmapLabels,
  onMoveHeatSplitLabel,
  onMoveHeatTrackName,
  onMoveHeatTrackKey,
  onMoveHeatTrackRunLabel,
  onMoveVennSetLabel,
  onMoveUpsetSetLabel,
  onMoveTernaryAxisLabel,
  onMoveRoseDirectionLabel,
  onMoveOncoprintLabel,
  onMoveCorrLabels,
  onMoveCorrLegend,
  onMoveAxisTitle,
  onRotateAxisTitle,
  onMoveValueLabel,
  onMoveDirectLabel,
  onMoveTreemapRegionLabel,
  onMoveNetworkNode,
  onMoveSectionLabel,
  onMoveCategoryGroupName,
  onParallelEdit,
  onCamera3D,
  ribbon,
  onExport,
  onCopyPicture,
  onCopySvg,
  onSetAxis,
  onLegendDock,
  onLegendLoose,
  onOpenSource,
  onSetPlotOptions,
}: {
  project: Project;
  plotId?: NodeId | undefined;
  selected?: GraphSelection;
  onSelect?: (selection: GraphSelection) => void;
  zoom?: number;
  view?: GraphView;
  onViewChange?: (view: GraphView) => void;
  /** `| undefined` on purpose (exactOptionalPropertyTypes): kinds with no width command pass
   *  it explicitly as undefined, which is what hides the edge handle. */
  onWidthResize?: ((seriesId: NodeId, fraction: number) => void) | undefined;
  onMoveAnnotation?: (id: NodeId, patch: { value?: number; x?: number; y?: number; bracketY?: number; bracketShift?: number; x2?: number; y2?: number; w?: number; h?: number; rotation?: number }) => void;
  /** Nudge a computed reference line's caption (the line itself never moves). */
  onMoveRefLineLabel?: (id: string, dx: number, dy: number) => void;
  onDeleteAnnotation?: (id: NodeId) => void;
  onReorderAnnotation?: (id: NodeId, to: "front" | "back") => void;
  onDuplicateAnnotation?: (id: NodeId) => void;
  onBoxAction?: ((action: "exclude" | "highlight" | "copy", points: PickedPoint[]) => void) | undefined;
  boxHighlightBlocked?: string | undefined;
  onFigureResize?: (patch: { figureWidth?: number; figureHeight?: number }) => void;
  /** Resize = a uniform scale of the whole drawing (graphDisplay.ts). When given, the figure's corner handles call it
   *  with the new scale instead of `onFigureResize` re-laying the graph out at a new size. */
  onFigureScale?: ((scale: number) => void) | undefined;
  /** Startup fit for a figure with no size of its own; null/undefined = renderer default. */
  figureFit?: { width: number; height: number } | null | undefined;
  onEditText?: (target: TextTarget, value: string) => void;
  onCreateTextBox?: (xFrac: number, yFrac: number) => string | void;
  onAxisResize?: (axis: "x" | "y", lengthPx: number) => void;
  onMoveTitle?: (dx: number, dy: number) => void;
  onMoveSubtitle?: (dx: number, dy: number) => void;
  onMoveLegend?: (dx: number, dy: number) => void;
  onMoveSignificanceCaption?: (dx: number, dy: number) => void;
  onMoveColorbar?: (dx: number, dy: number) => void;
  onMoveWaffleCaption?: ((dx: number, dy: number) => void) | undefined;
  onMoveFitLabel?: (dx: number, dy: number) => void;
  onMoveFitParams?: (dx: number, dy: number) => void;
  onMoveFitParamLine?: (key: string, dx: number, dy: number) => void;
  onMoveHeatmapLabels?: (which: "row" | "col", index: number, dx: number, dy: number) => void;
  /** Heatmap split-block name / annotation strip name / a word drawn on a strip — every text on
   *  a graph can be moved, so every one of them needs its own writer here. */
  onMoveHeatSplitLabel?: (axis: "row" | "col", at: number, dx: number, dy: number) => void;
  onMoveHeatTrackName?: (axis: "row" | "col", index: number, dx: number, dy: number) => void;
  onMoveHeatTrackKey?: (axis: "row" | "col", index: number, dx: number, dy: number) => void;
  onMoveHeatTrackRunLabel?: (axis: "row" | "col", index: number, value: string, dx: number, dy: number) => void;
  onMoveVennSetLabel?: (datasetId: string, dx: number, dy: number) => void;
  onMoveUpsetSetLabel?: (datasetId: string, dx: number, dy: number) => void;
  onMoveTernaryAxisLabel?: (datasetId: string, dx: number, dy: number) => void;
  onMoveRoseDirectionLabel?: (key: string, dx: number, dy: number) => void;
  onMoveOncoprintLabel?: (axis: "gene" | "sample", name: string, dx: number, dy: number) => void;
  onMoveCorrLabels?: (which: "row" | "col", index: number, dx: number, dy: number) => void;
  onMoveCorrLegend?: (dx: number, dy: number) => void;
  onMoveAxisTitle?: (axis: "x" | "y" | "z" | "y2" | "y3", dx: number, dy: number) => void;
  onRotateAxisTitle?: ((axis: "y" | "y2" | "y3", angle: number) => void) | undefined;
  onMoveValueLabel?: (columnId: NodeId, rowId: NodeId, dx: number, dy: number) => void;
  onMoveDirectLabel?: (seriesId: NodeId, dx: number, dy: number) => void;
  onMoveTreemapRegionLabel?: (group: string, dx: number, dy: number) => void;
  onMoveNetworkNode?: (nodeId: string, x: number, y: number) => void;
  onMoveSectionLabel?: (section: string, dx: number, dy: number) => void;
  onMoveCategoryGroupName?: (axis: "x" | "y", group: string, dx: number, dy: number) => void;
  onParallelEdit?: ((patch: Partial<NonNullable<Plot["parallel"]>>) => void) | undefined;
  onCamera3D?: (patch: { azimuth?: number; elevation?: number; zoom?: number }, gesture: string) => void;
  ribbon?: GraphRibbonOps;
  onExport?: () => void;
  /** The graph's right-click menu (Copy as picture · Copy as SVG · Export…). An annotation's own
   *  right-click menu keeps winning: it stops the event before it reaches the pane. */
  onCopyPicture?: (() => void) | undefined;
  onCopySvg?: (() => void) | undefined;
  /** Patch one axis's AxisSpec (the data axis — the same writer as the Axis tab). Given, a
   *  right-click on a value axis's numbers leads the graph's menu with that axis's number formats. */
  onSetAxis?: ((axis: "x" | "y" | "y2" | "y3", patch: Partial<AxisSpec>) => void) | undefined;
  /** List a drawn line / the fitted curves in the legend, or take them back out (legendDock.ts). Given, a line's
   *  caption drops onto the legend block and a listed row drags back out of it. */
  onLegendDock?: LegendDock | undefined;
  /** Pull a legend row out of the block, move it, or put it back (`Plot.legendLoose`). */
  onLegendLoose?: ((key: string, at: { x: number; y: number } | null) => void) | undefined;
  /** Open this graph's source datasheet in its own tab (ribbon → "Datasheet"). */
  onOpenSource?: ((tableId: NodeId) => void) | undefined;
  /** Patch the active plot (used here to hide the exclusion note for this graph). */
  onSetPlotOptions?: ((patch: Partial<Plot>) => void) | undefined;
}) {
  // "Wheel zoom" — does the mouse wheel zoom the graph? Off by default, so the wheel
  // scrolls a page past a figure instead of zooming it. One
  // remembered app preference (not a per-graph field): the same hand scrolls every graph.
  // Declared before the early return below so the hook order stays stable.
  const wheel = useWheelZoomPref();
  // "Show graph ruler" — a measuring ruler framed outside the figure (graph toolbar tickbox +
  // View menu). App-wide prefs; declared before the early return so the hook order stays stable.
  const ruler = useGraphRulerPref();
  const colorVision = useColorVisionPref();
  const rulerUnit = useRulerUnitPref();
  // Which text element an open inline editor is targeting — drives the ribbon's
  // font-role picker so editing a title/axis-title formats that text.
  // A fresh object per focus so re-opening the same role still re-syncs the picker.
  const [focusRole, setFocusRoleState] = useState<{ role: "title" | "subtitle" | "axisTitle" } | null>(null);
  const setFocusRole = (role: "title" | "subtitle" | "axisTitle"): void => setFocusRoleState({ role });
  // Drafted figure caption + alt-text (opt-in; null = panel closed). Declared before the
  // early return below so the hook order stays stable.
  const [captionText, setCaptionText] = useState<string | null>(null);
  const [captionCopied, setCaptionCopied] = useState(false);
  // The graph's right-click menu (screen position; null = closed). Closes on Escape or any press
  // outside it. Declared before the early return below so the hook order stays stable.
  // `numbers`: the visual axis whose tick numbers were right-clicked — the menu then leads with
  // that axis's number formats.
  const [graphMenu, setGraphMenu] = useState<{ left: number; top: number; numbers?: "x" | "y" | "y2" | "y3" | undefined } | null>(null);
  useEffect(() => {
    if (!graphMenu) return;
    const onKey = (e: KeyboardEvent): void => { if (e.key === "Escape") setGraphMenu(null); };
    const onPress = (e: PointerEvent): void => {
      if (!(e.target instanceof Element) || !e.target.closest(".gfx-graphmenu")) setGraphMenu(null);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onPress, true);
    return () => { window.removeEventListener("keydown", onKey); window.removeEventListener("pointerdown", onPress, true); };
  }, [graphMenu]);
  // The drawing grows to include anything dragged past the figure's edge:
  // after every commit, widen the visible area to the figure box + what is drawn, with the same
  // measurement the export uses. A frame later again, for text whose layout settles late.
  // Declared before the early return below so the hook order stays stable.
  const growHostRef = useRef<HTMLDivElement>(null);
  const growSizeRef = useRef<{ w: number; h: number; zoom: number } | null>(null);
  useLayoutEffect(() => {
    const grow = (): void => {
      const svg = growHostRef.current?.querySelector<SVGSVGElement>("svg.gfx-figure");
      const size = growSizeRef.current;
      if (svg && size) growFigureToDrawing(svg, size.w, size.h, size.zoom);
    };
    grow();
    const raf = requestAnimationFrame(grow);
    return () => cancelAnimationFrame(raf);
  });
  // …and while the drag is happening the figure may draw past its edge, because nothing grows
  // until the pointer is released (otherwise a dragged legend just disappears).
  // Note: not `[]`: the host div only exists once there is a graph, so a pane that first rendered
  // "No graph to display" would bind nothing and never bind again. Runs every render, binds once
  // per host.
  const unclipRef = useRef<{ host: HTMLElement; off: () => void } | null>(null);
  useEffect(() => {
    const host = growHostRef.current;
    if (unclipRef.current && unclipRef.current.host !== host) {
      unclipRef.current.off();
      unclipRef.current = null;
    }
    if (host && !unclipRef.current) unclipRef.current = { host, off: unclipWhileDragging(host) };
  });
  useEffect(() => () => { unclipRef.current?.off(); unclipRef.current = null; }, []);
  // A corner / edge resize: the page keeps its height while the grip is held (so the scroll cannot snap back and move
  // the graph under the pointer), and the release ends the drag's `cornerResize` record. Bound like the unclip above.
  const cornerDragRef = useRef<{ start: number; axis: "w" | "h" | null } | null>(null);
  const holdRef = useRef<{ host: HTMLElement; off: () => void } | null>(null);
  useEffect(() => {
    const host = growHostRef.current;
    if (holdRef.current && holdRef.current.host !== host) {
      holdRef.current.off();
      holdRef.current = null;
    }
    if (host && !holdRef.current) holdRef.current = { host, off: holdHeightWhileResizing(host, () => { cornerDragRef.current = null; }) };
  });
  useEffect(() => () => { holdRef.current?.off(); holdRef.current = null; }, []);
  const plot = project.plots.find((p) => p.id === plotId) ?? project.plots[0];
  const table = project.tables.find((t) => t.id === plot?.source);
  if (!table || !plot) return <p className="note">No graph to display.</p>;

  const toggleCaption = (): void => {
    if (captionText !== null) {
      setCaptionText(null);
      return;
    }
    // Fold in the most recent linked analysis's headline statistic, when there is one —
    // the caption never invents a number that wasn't computed.
    const linked = [...project.analyses].reverse().find((a) => a.source === plot.source && a.result && keyMetricLine(a.result));
    const statLine = linked?.result ? keyMetricLine(linked.result) : "";
    setCaptionText(figureTextBlock(figureCaption(plot, table, statLine ? { statLine } : {})));
  };
  const copyCaption = (): void => {
    if (captionText == null) return;
    void navigator.clipboard.writeText(captionText).then(() => {
      setCaptionCopied(true);
      window.setTimeout(() => setCaptionCopied(false), 1500);
    });
  };

  // Every Y column becomes a series, drawn with the colourblind-safe palette.
  // Real Canvas text measurement → accurate margins + tick-label de-overlap.
  // A view window (axis pan/zoom) overrides the auto data extent.
  // Size precedence: the figure's own size wins, then the startup fit, then the renderer's
  // default. The first of those is a decision the user made by dragging or typing, so the fit
  // must never reach past it - it only fills in for figures that never had one.
  const scene = buildPlotScene(table, plot, graphSceneOptions(project, plot, view));
  // How big the graph is shown: its scale (the corner, the Graph size box, the window fit) times the view zoom. The
  // drawing is scaled as a whole through the renderer's zoom — never re-laid-out (graphDisplay.ts).
  const shownScale = graphDisplayScale(plot, figureFit);
  const shownZoom = zoom * shownScale;
  // The scale a drag starts from is the one on screen: the pane can show the graph smaller than its scale asks (it never
  // overflows the pane), and the corner must land where the pointer is — so read the drawing's rendered width.
  const figureResize = onFigureScale
    ? (patch: { figureWidth?: number; figureHeight?: number }) => {
        const svg = growHostRef.current?.querySelector<SVGSVGElement>("svg.gfx-figure");
        const vbW = svg?.viewBox?.baseVal?.width || scene.width;
        const onScreen = svg ? svg.getBoundingClientRect().width / Math.max(1, vbW * zoom) : shownScale;
        const current = onScreen > 0 ? onScreen : shownScale;
        // One drag = one `drag` record: the scale at the press and, once picked, the direction a corner follows.
        cornerDragRef.current ??= { start: current, axis: null };
        onFigureScale(cornerResize(cornerDragRef.current, current, { width: scene.width, height: scene.height }, patch));
      }
    : onFigureResize;
  const zoomed = Boolean(view?.xDomain || view?.yDomain);

  // Snap-to-region: when a data element (a category bar or a whole series) is selected,
  // a Highlight inserted from the ribbon frames that data region — rows snap to the whole
  // category column, a series to its extent — instead of dropping a generic centred box
  // the user has to hand-align. Falls back to the item's default box when nothing is selected.
  const dataSel = selected?.kind === "series" ? { columnId: selected.columnId, rowId: selected.rowId } : null;
  const snapBox = dataSel ? snapRegionBox(scene, dataSel) : null;
  // Resolved here rather than passed in: the pane already holds the project, and a graph
  // whose table has been deleted must not offer a button that opens nothing (a dead
  // control).
  const sourceTable = project.tables.find((t) => t.id === plot.source);
  const exclCount = sourceTable ? excludedCount(sourceTable) : 0;
  // Every datasheet this graph draws from: its own source sheet first, then any sheet a series is
  // borrowed from (`plot.overlays`, composite graphs), de-duplicated and skipping any that no
  // longer exist. One → a plain "Datasheet" button; more → the SheetsForGraphMenu dropdown, so a
  // two-sheet graph can reach both sheets — the mirror of the datasheet's
  // "Graphs" menu.
  const linkedSheets = (() => {
    const seen = new Set<NodeId>();
    const out: { id: NodeId; name: string }[] = [];
    const add = (id: NodeId): void => {
      if (seen.has(id)) return;
      const t = project.tables.find((x) => x.id === id);
      if (t) { seen.add(id); out.push({ id, name: t.name }); }
    };
    add(plot.source);
    for (const ov of plot.overlays ?? []) add(ov.table);
    return out;
  })();
  // Analysis-derived content on this graph that has gone out of date. A plain data graph
  // redraws live when its table changes, so nothing on it is left obsolete — but significance
  // brackets and analysis-spawned graphs (survival / ROC / PCA / residuals) hold a snapshot of
  // a result that does not recompute by itself. After the data changes, those marks can
  // disagree with the sheet until the analysis is re-run, so the graph flags it as well as the
  // analysis tab: the graph is where the out-of-date bracket is on show.
  const staleBoundAnalyses = project.analyses.filter(
    (a) =>
      a.status !== "ok" &&
      (plot.analysisSource === a.id || plot.fit?.analysisSource === a.id || plot.fits?.some((f) => f.analysisSource === a.id)
        || (plot.annotations ?? []).some((x) => x.sig?.analysisId === a.id)),
  );
  const ribbonForGraph: GraphRibbonOps | undefined =
    ribbon && snapBox
      ? {
          ...ribbon,
          onAddAnnotation: (ann) =>
            ribbon.onAddAnnotation(ann.kind === "highlight" ? { ...ann, x: snapBox.x, y: snapBox.y, w: snapBox.w, h: snapBox.h } : ann),
        }
      : ribbon;

  return (
    <div>
      {ribbonForGraph ? (
        <GraphRibbon
          plot={plot}
          selected={selected ?? null}
          focusRole={focusRole}
          ops={ribbonForGraph}
          title={plot.name}
          zoomed={zoomed}
          onResetView={() => onViewChange?.({})}
          onExport={onExport}
          onCaption={toggleCaption}
          {...(onOpenSource && linkedSheets.length > 0
            ? { onOpenTable: onOpenSource, linkedSheets }
            : {})}
          xLogResolved={isLogScale(scene.x?.type)}
          yLogResolved={isLogScale(scene.y?.type)}
          {...((scene.zoomable?.length ?? 0) > 0 || scene.kind === "scatter3d" ? { wheelZoom: wheel } : {})}
          rulerPref={ruler}
          rulerUnit={rulerUnit}
          colorVision={colorVision}
        />
      ) : (
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 7 }}>
          <h2 className="h" style={{ margin: 0 }}>{plot.name}</h2>
          <span className="paneact-spacer" />
          <ExportButton label="Export this graph" onClick={onExport} />
        </div>
      )}
      {captionText !== null && (
        <div className="prosepanel">
          <div className="prosepanel-head">
            <strong>Caption &amp; alt-text — draft</strong>
            <span className="prosepanel-note">Editable — review before use; nothing is inserted into your document.</span>
            <button className="btn-mini" onClick={copyCaption}>{captionCopied ? "Copied ✓" : "Copy"}</button>
            <button className="btn-mini" title="Close" aria-label="Close draft" onClick={() => setCaptionText(null)}>✕</button>
          </div>
          <textarea
            className="prosepanel-text"
            value={captionText}
            onChange={(e) => setCaptionText(e.target.value)}
            spellCheck={false}
            rows={8}
            aria-label="Drafted figure caption and alt-text"
          />
        </div>
      )}
      {/* The graph's own scale may be above 1 (the window fit, a graph resized up): it still fits the pane unless the
          view is zoomed in - the drawing lifts its fit-to-pane limit for any zoom above 1, so the pane holds it here. */}
      <div
        className={zoom <= 1 ? "graphzoom fitpane" : "graphzoom"}
        ref={growHostRef}
        // The colour-vision preview rides on this wrapper, never on the svg: the export clones the
        // svg alone, so a filter here can never reach a file (colorVision.test.tsx).
        style={colorVision.value !== "off" ? { filter: colorVisionFilter(colorVision.value) } : undefined}
        onContextMenu={(e) => {
          // The graph's own menu. Only when there is something to run, and never over a menu
          // that is already open (an annotation's menu stops its event before it gets here).
          if (e.target instanceof Element && e.target.closest(".gfx-annmenu, .gfx-graphmenu")) return;
          // A value axis's numbers carry the axis they belong to (PlotFigure `numbersAttr`).
          const mark = e.target instanceof Element ? e.target.closest("[data-axis-numbers]")?.getAttribute("data-axis-numbers") : null;
          const numbers = onSetAxis && (mark === "x" || mark === "y" || mark === "y2" || mark === "y3") ? mark : undefined;
          if (!numbers && !onCopyPicture && !onCopySvg && !onExport) return;
          e.preventDefault();
          setGraphMenu({ left: e.clientX, top: e.clientY, numbers });
        }}
      >
        {graphMenu && (() => {
          const act = (fn: (() => void) | undefined) => () => { fn?.(); setGraphMenu(null); };
          const numbers = graphMenu.numbers;
          // The clicked axis is the on-screen one; its numbering lives on the data axis (they swap on a horizontal chart).
          const dataAxis = numbers ? dataAxisOf(plot, numbers) : undefined;
          const spec: AxisSpec = (dataAxis === "x" ? plot.xAxis : dataAxis === "y2" ? plot.y2Axis : dataAxis === "y3" ? plot.y3Axis : plot.yAxis) ?? {};
          const current = spec.format ?? "auto";
          const pick = (f: NumberFormat) => act(() => onSetAxis?.(dataAxis!, { format: f === "auto" ? undefined : f }));
          const hasCopy = !!(onCopyPicture || onCopySvg || onExport);
          return (
            <div className="gfx-annmenu gfx-graphmenu" role="menu" aria-label="Graph" style={{ position: "fixed", left: graphMenu.left, top: graphMenu.top }} onContextMenu={(e) => e.preventDefault()}>
              {numbers && dataAxis && (
                <>
                  <div className="gfx-annmenu-h">Numbers on this axis</div>
                  {[{ value: "auto" as const, label: "Auto" }, ...NUMBER_FORMAT_CHOICES].map((c) => (
                    <button key={c.value} type="button" role="menuitemradio" aria-checked={current === c.value} className="gfx-annmenu-i" onClick={pick(c.value)}>{c.label}</button>
                  ))}
                  {onSelect && <button type="button" className="gfx-annmenu-i" onClick={act(() => onSelect({ kind: "axis", axis: numbers, focus: "numbers" }))}>More numbering options…</button>}
                  {hasCopy && <div className="gfx-annmenu-sep" role="separator" />}
                </>
              )}
              {onCopyPicture && <button type="button" className="gfx-annmenu-i" onClick={act(onCopyPicture)}>Copy as picture</button>}
              {onCopySvg && <button type="button" className="gfx-annmenu-i" onClick={act(onCopySvg)}>Copy as SVG</button>}
              {onExport && <button type="button" className="gfx-annmenu-i" onClick={act(onExport)}>Export…</button>}
            </div>
          );
        })()}
        {(() => {
          growSizeRef.current = { w: scene.width, h: scene.height, zoom: shownZoom };
          const figureEl = (
          <PlotFigure
          scene={scene}
          selected={selected ?? null}
          onSelect={onSelect}
          legendDock={onLegendDock ? { lines: new Set((plot.annotations ?? []).filter((a) => canJoinLegend(a.kind)).map((a) => a.id)), set: onLegendDock, onLegendLoose } : undefined}
          wheelZoom={wheel.value}
          onViewChange={onViewChange}
          onResetView={() => { onViewChange?.({}); ribbon?.onZoomReset(); }}
          onWidthResize={onWidthResize}
          onMoveAnnotation={onMoveAnnotation}
          onMoveRefLineLabel={onMoveRefLineLabel}
          onDeleteAnnotation={onDeleteAnnotation}
          onReorderAnnotation={onReorderAnnotation}
          onDuplicateAnnotation={onDuplicateAnnotation}
          onBoxAction={onBoxAction}
          boxHighlightBlocked={boxHighlightBlocked}
          onFigureResize={figureResize}
          onEditText={onEditText}
          onCreateTextBox={onCreateTextBox}
          onAxisResize={onAxisResize}
          onMoveTitle={onMoveTitle}
          onMoveSubtitle={onMoveSubtitle}
          onMoveLegend={onMoveLegend}
          onMoveSignificanceCaption={onMoveSignificanceCaption}
          onMoveColorbar={onMoveColorbar}
          onMoveWaffleCaption={onMoveWaffleCaption}
          onMoveFitLabel={onMoveFitLabel}
          onMoveFitParams={onMoveFitParams}
          onMoveFitParamLine={onMoveFitParamLine}
          onMoveHeatmapLabels={onMoveHeatmapLabels}
          onMoveHeatSplitLabel={onMoveHeatSplitLabel}
          onMoveHeatTrackName={onMoveHeatTrackName}
          onMoveHeatTrackKey={onMoveHeatTrackKey}
          onMoveHeatTrackRunLabel={onMoveHeatTrackRunLabel}
          onMoveVennSetLabel={onMoveVennSetLabel}
          onMoveUpsetSetLabel={onMoveUpsetSetLabel}
          onMoveTernaryAxisLabel={onMoveTernaryAxisLabel}
          onMoveRoseDirectionLabel={onMoveRoseDirectionLabel}
          onMoveOncoprintLabel={onMoveOncoprintLabel}
          onMoveCorrLabels={onMoveCorrLabels}
          onMoveCorrLegend={onMoveCorrLegend}
          onMoveAxisTitle={onMoveAxisTitle}
          onRotateAxisTitle={onRotateAxisTitle}
          onMoveValueLabel={onMoveValueLabel}
          onMoveDirectLabel={onMoveDirectLabel}
          onMoveTreemapRegionLabel={onMoveTreemapRegionLabel}
          onMoveNetworkNode={onMoveNetworkNode}
          onMoveSectionLabel={onMoveSectionLabel}
          onMoveCategoryGroupName={onMoveCategoryGroupName}
          onParallelEdit={onParallelEdit}
          onCamera3D={onCamera3D}
          onTextFocus={setFocusRole}
          zoom={shownZoom}
        />
          );
          // Framed outside the figure, never over it; the ruler measures the rendered box so it
          // tracks resize + zoom + pane-narrowing alike.
          return ruler.value ? (
            <FigureRuler sceneW={scene.width * shownScale} sceneH={scene.height * shownScale} zoom={zoom} unit={rulerUnit.value}>{figureEl}</FigureRuler>
          ) : figureEl;
        })()}
      </div>
      {/* Out-of-date analysis output, stated under the graph it sits on. On-screen only —
          like the exclusion note below, it is deliberately not drawn into the figure, so it
          can never turn up in an export. Derived every render, never stored, so re-running the
          analysis clears it on the next paint. */}
      {staleBoundAnalyses.length > 0 && (
        <p className="stalenote" role="status">
          <b>Out of date.</b> The source data changed after this graph&rsquo;s
          {staleBoundAnalyses.length === 1 ? " analysis" : " analyses"} ran, so the results shown here
          {" "}— including any significance markers — may no longer match the sheet. Re-run
          {staleBoundAnalyses.length === 1 ? " it" : " them"} in the analysis tab. If this notice remains,
          recreate the graph from the updated analysis.
        </p>
      )}
      {plot.status === "stale" && staleBoundAnalyses.length === 0 && (
        <p className="stalenote" role="status"><b>Out of date.</b> This graph still contains an earlier
          analysis result. Recreate it from the updated analysis to refresh the drawing.</p>
      )}
      {/* Excluded values, stated under the graph they are missing from.
          Derived on every render from the live table, never stored on the Plot: exclude
          two more points and this recounts itself. A stored copy could go stale unnoticed
          on a figure about to be published.
          On-screen only — deliberately not drawn into the figure, so it can never appear
          in an export the user did not ask for. */}
      {exclCount > 0 && !plot.hideExclusionNote && (
        <p className="exclnote" role="status">
          <b>{exclCount}</b> {exclCount === 1 ? "value is" : "values are"} excluded in{" "}
          {sourceTable ? <>“{sourceTable.name}”</> : "this dataset"} — kept in the sheet, and left out of
          this graph and every analysis of it.
          <button
            type="button"
            className="btn-mini exclnote-hide"
            title="Hide this note for this graph. It comes back if you clear the exclusions and exclude again."
            onClick={() => onSetPlotOptions?.({ hideExclusionNote: true })}
          >
            Hide
          </button>
        </p>
      )}
      {scene.warnings.length > 0 && (
        <ul className="scene-warnings" role="status">
          {scene.warnings.map((w, i) => (
            <li key={i}>{w}</li>
          ))}
        </ul>
      )}
      {/* Note: each hint is one line. JSX drops the newline between an element and the text
          after it — no space — so a wrapped hint would read "resetthe axes". */}
      <ul className="viewhints" aria-label="Graph shortcuts">
        {/* Shown only where the gesture works. A hint promising something that does nothing
            is the same defect as a dead button. `scene.zoomable` is the builder's own answer,
            so the hint cannot drift from the behaviour. */}
        {/* …and only while it applies: scrolling zooms only with Wheel zoom ticked. Showing "Scroll to zoom"
            with the box off would suggest the wheel zoom cannot be turned off. */}
        {scene.zoomable?.length ? (
          <li>
            {wheel.value ? (
              <><b>Scroll</b> to zoom{scene.zoomable.length === 1 ? " the value axis" : ""}, </>
            ) : (
              <>Tick <b>Wheel zoom</b> to zoom{scene.zoomable.length === 1 ? " the value axis" : ""} with the scroll wheel; </>
            )}
            <b>drag</b> to pan, <b>double-click</b> to reset the axes
          </li>
        ) : null}
        <li><b>Ctrl+scroll</b> zooms the whole view</li>
        <li><b>Click</b> any element to edit it; hover a point for its values</li>
        {/* Quiet on purpose — a reassurance, not a banner. Scientists do ask whether a free
            program puts strings on the figures they publish. It does not, and the one place
            the question occurs to you is while looking at the figure. */}
        <li className="viewhints-quiet">You own your work with MadY, always</li>
      </ul>
    </div>
  );
}

/**
 * One results-table cell. `digits` is Settings ▸ "Round results tables" (0/undefined = off,
 * the engine's full precision — rounding is an option, never systematic). A p keeps its own
 * 3-figure / "<0.0001" convention either way; df and counts are integers and are left alone.
 */
function fmtCell(key: string, v: number | string | boolean | null | undefined, digits = 0): string {
  if (v === null || v === undefined) return "—";
  if (typeof v !== "number") return String(v);
  if (key === "p") return v < 0.0001 ? "<0.0001" : String(Number(v.toPrecision(3)));
  if (digits > 0 && Number.isFinite(v) && !Number.isInteger(v)) return String(Number(v.toPrecision(digits)));
  return String(v);
}

/**
 * The results table, led by the rows that answer the question. Assumption checks and
 * alternative estimators fold into a disclosure (see `analysisEmphasis`) — the reader
 * should not have to find the mean among 22 rows. Columns are computed from the
 * visible rows, so collapsing the detail narrows the table in both directions.
 * Nothing is removed: expanding shows the full table, and exports are unaffected.
 */
function TidyTable({ terms, method, conf, digits }: { terms: TidyTerm[]; method: string; conf?: number | undefined; digits?: number | undefined }) {
  const [showAll, setShowAll] = useState(false);
  const { primary, secondary } = splitTerms(method, terms);
  const shown = showAll ? terms : primary;
  const lead = primary.find((t) => typeof t.statistic === "number" && typeof t.p === "number");
  // Shared column builder so the on-screen CI headers name the analysis's actual
  // confidence level, exactly like the export does.
  const cols = tidyColumns(shown, conf);
  return (
    <>
      <table className="tidytable">
        <thead>
          <tr>{cols.map((c) => <th key={c.key}>{c.label}</th>)}</tr>
        </thead>
        <tbody>
          {shown.map((t, i) => {
            // The headline test row: the first primary row carrying a statistic and a p —
            // the same row the drafted Results sentence reports. Every p cell under the
            // threshold is emphasised, so a significant comparison reads at a glance.
            const isLead = t === lead;
            const cls = [showAll && secondary.includes(t) ? "tidyrow-detail" : "", isLead ? "tidyrow-lead" : ""].filter(Boolean).join(" ") || undefined;
            return (
              <tr key={i} className={cls}>
                {cols.map((c) => {
                  const v = t[c.key];
                  const sig = c.key === "p" && typeof v === "number" && v < P_THRESHOLD;
                  return (
                    <td key={c.key} className={`${c.key === "term" ? "tidyterm" : "tidynum"}${sig ? " tidyp-sig" : ""}`}>
                      {fmtCell(c.key, v, digits)}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
      {secondary.length > 0 && (
        <button type="button" className="tidymore" aria-expanded={showAll} onClick={() => setShowAll(!showAll)}>
          {showAll
            ? "Show key results only"
            : `Show ${secondary.length} more — assumption checks and secondary estimates`}
        </button>
      )}
    </>
  );
}

/** Diverging cell tint for a correlation r ∈ [−1,1]: red = +, blue = −, magnitude = opacity. */
function corrTint(r: number | null): string {
  if (r === null || !Number.isFinite(r)) return "transparent";
  const a = Math.min(1, Math.abs(r)) * 0.85;
  return r >= 0 ? `rgba(200, 64, 52, ${a})` : `rgba(48, 92, 200, ${a})`;
}

interface CorrMatrixData {
  labels: string[];
  r: (number | null)[][];
  r2?: (number | null)[][];
}

/** A compact correlation heat-grid (the R² heat-map): K×K cells tinted by r. */
function CorrMatrix({ m }: { m: CorrMatrixData }) {
  const { labels, r } = m;
  return (
    <table className="tidytable corrmatrix">
      <thead>
        <tr>
          <th />
          {labels.map((l, i) => <th key={i} className="tidynum">{l}</th>)}
        </tr>
      </thead>
      <tbody>
        {labels.map((row, i) => (
          <tr key={i}>
            <td className="tidyterm">{row}</td>
            {labels.map((_c, j) => {
              const v = r[i]?.[j] ?? null;
              return (
                <td
                  key={j}
                  className="tidynum"
                  style={{ background: corrTint(v), textAlign: "center", fontVariantNumeric: "tabular-nums" }}
                  title={`${row} vs ${labels[j]}: r = ${v ?? "—"}`}
                >
                  {v === null ? "—" : v.toFixed(2)}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

interface PcaData {
  varLabels: string[];
  pcLabels: string[];
  loadings: number[][]; // variables × PCs
  scores: number[][]; // cases × PCs (for the score/biplot graphs)
  eigenvalues: number[];
  explained: number[]; // fraction per PC
  groups?: string[]; // optional per-case group label
  /** How many components the engine's selection rule kept. */
  retained?: number;
  /** Per-component keep/drop, straight from the engine — never re-derived here. */
  retainedFlags?: boolean[];
  /** Which rule decided it: kaiser | fixedk | variance | parallel | all. */
  selection?: string;
}

/** Plain-English name of the component-selection rule the engine applied. */
const PCA_SELECTION_LABEL: Record<string, string> = {
  kaiser: "Kaiser (eigenvalue > 1)",
  fixedk: "a fixed count",
  variance: "cumulative variance",
  parallel: "parallel analysis",
  all: "all components",
};

/** Cluster-analysis result (from `extra.cluster`): per-cluster sizes + within-SS +
 *  centroids + the mean silhouette. */
interface ClusterData {
  variant: string;
  k: number;
  labels: (number | null)[];
  sizes: number[];
  silhouette: number;
  withinSS: number[];
  centroids: number[][];
  varLabels: string[];
  standardized: boolean;
}

/** ROC result: the curve points + a per-cutoff sensitivity/specificity table. */
interface RocData {
  points: { fpr: number; tpr: number }[];
  cutoffs: { cutoff: number; sensitivity: number; specificity: number; fpr: number; youden: number;
             sensLow?: number; sensHigh?: number; specLow?: number; specHigh?: number }[];
  auc: number;
  label: string;
}

/** A Wilson 95% CI rendered compactly as "lo–hi" (blank when absent). */
function ciCell(lo?: number, hi?: number): string {
  return lo == null || hi == null ? "" : `${fmtCell("estimate", lo)}–${fmtCell("estimate", hi)}`;
}

/** The ROC per-cutoff table (cutoff → sensitivity/specificity/1−specificity/Youden J),
 * scrollable — the sens/spec-per-threshold detail. The plotted curve is a
 * separate `roc` graph (via "Plot ROC curve"). */
function RocCutoffs({ d }: { d: RocData }) {
  // Every threshold belongs in a lookup table, so nothing is folded away here — but
  // one row is the answer people quote. Mark the maximum-Youden cutoff (the standard
  // "optimal" choice); on a tie the first wins, so exactly one row is ever marked.
  const best = d.cutoffs.reduce(
    (acc, c, i) => (c.youden > acc.j ? { i, j: c.youden } : acc),
    { i: -1, j: -Infinity },
  ).i;
  return (
    <div className="anmatrix-wrap" style={{ maxHeight: 220, overflow: "auto" }}>
      <table className="antable">
        <thead>
          <tr><th>Cutoff</th><th>Sensitivity</th><th>95% CI</th><th>Specificity</th><th>95% CI</th><th>1−Spec</th><th>Youden J</th></tr>
        </thead>
        <tbody>
          {d.cutoffs.map((c, i) => (
            <tr key={i} className={i === best ? "is-optimal" : undefined} title={i === best ? "Highest Youden J — the conventional optimal cutoff" : undefined}>
              <td>{fmtCell("estimate", c.cutoff)}</td>
              <td>{fmtCell("estimate", c.sensitivity)}</td>
              <td style={{ opacity: 0.7 }}>{ciCell(c.sensLow, c.sensHigh)}</td>
              <td>{fmtCell("estimate", c.specificity)}</td>
              <td style={{ opacity: 0.7 }}>{ciCell(c.specLow, c.specHigh)}</td>
              <td>{fmtCell("estimate", c.fpr)}</td>
              <td>
                {fmtCell("estimate", c.youden)}
                {i === best && <span className="roc-optimal"> optimal</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Number-at-risk table (from a survival analysis' `extra.atrisk`) — the risk-set size
 * per group at evenly-spaced times, the strip conventionally shown under a KM plot. */
interface AtRiskData {
  times: number[];
  rows: { label: string; atRisk: number[] }[];
}
function AtRiskTable({ d }: { d: AtRiskData }) {
  return (
    <div className="anmatrix-wrap" style={{ maxHeight: 200, overflow: "auto" }}>
      <table className="antable">
        <thead>
          <tr><th>Number at risk</th>{d.times.map((t, i) => <th key={i}>{fmtCell("estimate", t)}</th>)}</tr>
        </thead>
        <tbody>
          {d.rows.map((row, i) => (
            <tr key={i}>
              <td>{row.label}</td>
              {row.atRisk.map((v, j) => <td key={j}>{v}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** PCA result: a scree table (eigenvalue / % variance / cumulative) + a loadings
 * heat-grid (variables × components, tinted by loading sign + magnitude). The PCA graphs
 * (scree, scores, biplot) are separate graph kinds; this view shows the numbers. */
function PcaView({ d }: { d: PcaData }) {
  const { varLabels, pcLabels, loadings, eigenvalues, explained, retainedFlags, retained, selection } = d;
  let cum = 0;
  // Which components were kept comes from the engine, which already applied the
  // selection rule the user chose. Re-deriving it here (say, eigenvalue > 1) would
  // silently disagree the moment they pick cumulative variance or parallel analysis.
  const keeps = (k: number): boolean => retainedFlags?.[k] === true;
  const ruleName = selection ? PCA_SELECTION_LABEL[selection] ?? selection : null;
  return (
    <>
      {retained != null && retainedFlags && (
        <p className="note pca-retained">
          <b>{retained}</b> of {pcLabels.length} component{pcLabels.length === 1 ? "" : "s"} retained
          {ruleName ? <> by {ruleName}</> : null} — highlighted below.
        </p>
      )}
      <table className="tidytable">
        <thead>
          <tr>
            <th></th><th>Eigenvalue</th><th>% variance</th><th>Cumulative %</th>
          </tr>
        </thead>
        <tbody>
          {pcLabels.map((pc, k) => {
            cum += (explained[k] ?? 0) * 100;
            return (
              <tr
                key={pc}
                className={keeps(k) ? "is-retained" : retainedFlags ? "is-dropped" : undefined}
                title={retainedFlags ? (keeps(k) ? "Retained by the selection rule" : "Not retained") : undefined}
              >
                <td className="tidyterm">{pc}</td>
                <td className="tidynum">{eigenvalues[k]?.toFixed(4)}</td>
                <td className="tidynum">{((explained[k] ?? 0) * 100).toFixed(2)}</td>
                <td className="tidynum">{cum.toFixed(2)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="note" style={{ margin: "6px 0 2px" }}>Loadings (variable → component)</p>
      <table className="tidytable corrmatrix">
        <thead>
          <tr>
            <th />
            {pcLabels.map((pc) => <th key={pc} className="tidynum">{pc}</th>)}
          </tr>
        </thead>
        <tbody>
          {varLabels.map((v, i) => (
            <tr key={v}>
              <td className="tidyterm">{v}</td>
              {pcLabels.map((_pc, k) => {
                const val = loadings[i]?.[k] ?? null;
                return (
                  <td
                    key={k}
                    className="tidynum"
                    style={{ background: corrTint(val), textAlign: "center", fontVariantNumeric: "tabular-nums" }}
                    title={`${v} on ${pcLabels[k]}: ${val ?? "—"}`}
                  >
                    {val === null ? "—" : val.toFixed(3)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

/** Cluster analysis: a per-cluster table (size · within-SS · share) + the mean
 * silhouette + the centroid grid (cluster × variable). */
function ClusterView({ d }: { d: ClusterData }) {
  const total = d.sizes.reduce((a, b) => a + b, 0) || 1;
  return (
    <>
      <table className="tidytable">
        <thead>
          <tr><th>Cluster</th><th>Size</th><th>% of cases</th><th>Within-SS</th></tr>
        </thead>
        <tbody>
          {d.sizes.map((sz, c) => (
            <tr key={c}>
              <td className="tidyterm">Cluster {c + 1}</td>
              <td className="tidynum">{sz}</td>
              <td className="tidynum">{((sz / total) * 100).toFixed(1)}</td>
              <td className="tidynum">{d.withinSS[c] != null ? d.withinSS[c]!.toFixed(3) : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="note" style={{ margin: "6px 0 2px" }}>
        Mean silhouette width <b>{Number.isFinite(d.silhouette) ? d.silhouette.toFixed(3) : "—"}</b> (−1…1, higher = better separated)
        {d.standardized ? " · variables standardized" : " · raw variables"}
      </p>
      {d.centroids.length > 0 && d.varLabels.length > 0 && (
        <>
          <p className="note" style={{ margin: "6px 0 2px" }}>Centroids (cluster → variable {d.standardized ? "z-score" : "mean"})</p>
          <table className="tidytable corrmatrix">
            <thead>
              <tr>
                <th />
                {d.varLabels.map((v, j) => <th key={j} className="tidynum">{v}</th>)}
              </tr>
            </thead>
            <tbody>
              {d.centroids.map((row, c) => (
                <tr key={c}>
                  <td className="tidyterm">Cluster {c + 1}</td>
                  {row.map((val, j) => (
                    <td key={j} className="tidynum" style={{ background: corrTint(Math.max(-1, Math.min(1, val / 2))), textAlign: "center", fontVariantNumeric: "tabular-nums" }}>
                      {val.toFixed(2)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </>
  );
}

/**
 * AnalysisPane — a first-class analysis object: tidy results table + at-a-glance
 * + plain-language summary + assumptions + how-to-cite, with a Re-run button and
 * stale/error states.
 */
/**
 * The "✓ Validated" trust badge. For most methods the number is computed with an
 * established library (SciPy / statsmodels / NumPy); for the rest MadY implements the
 * estimator itself (KM survival, Deming, ROC/AUC, ROUT/Grubbs, …) and it is validated
 * against the published procedure — `v.computedWith` decides which the badge says. Most
 * are also independently cross-checked by a second from-scratch recomputation. Hover for
 * the basis + references; click to copy a citeable validation statement. Non-intrusive
 * (a small positive badge, never a repeated warning); hidden for methods with no validation record.
 */
function ValidationBadge({ method, title }: { method: string; title: string }) {
  const v = methodValidation(method);
  const [copied, setCopied] = useState(false);
  if (!v) return null;
  const refs = v.references.join(", ");
  const tip =
    (v.computedWith ? `Computed with ${refs}.` : `Computed in MadY, validated against ${refs}.`) +
    `\n${v.basis}` +
    (v.crossChecked ? "\n\n✓ Independently cross-checked by a second recomputation, written from scratch." : "") +
    "\n\nClick to copy a citeable validation statement.";
  return (
    <button
      type="button"
      className="valbadge"
      title={tip}
      aria-label={`Validation: ${v.basis}`}
      onClick={() => {
        void navigator.clipboard.writeText(validationStatement(title, v)).then(() => {
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1600);
        });
      }}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 3,
        fontSize: 11,
        lineHeight: 1.4,
        padding: "1px 8px",
        borderRadius: 10,
        border: "1px solid rgba(18,183,106,0.4)",
        background: "rgba(18,183,106,0.12)",
        color: "#12b76a",
        cursor: "pointer",
        whiteSpace: "nowrap",
      }}
    >
      {copied ? "Copied ✓" : v.crossChecked ? "✓ Validated" : "✓ Verified"}
    </button>
  );
}

export function AnalysisPane({
  project,
  analysisId,
  onRerun,
  onAddBrackets,
  bracketBinding,
  onAddLetters,
  onPlotSurvival,
  onPlotRoc,
  onPlotPca,
  onPlotOrdination,
  onPlotPartition,
  onPlotMeta,
  onPlotBiasFunnel,
  onPlotResiduals,
  onExportAnalysis,
  onAnnotateStats,
  onSaveMethod,
  resultDigits,
}: {
  project: Project;
  analysisId?: NodeId | undefined;
  onRerun: (id: NodeId) => void;
  /** Settings ▸ "Round results tables": significant figures for the on-screen table; unset/0 = full precision. */
  resultDigits?: number | undefined;
  onSaveMethod?: ((id: NodeId) => void) | undefined;
  onAddBrackets?: (id: NodeId) => void;
  /** Live state of the analysis→graph marker binding. `on` is derived from the markers'
   *  own provenance, so the tick-box cannot drift from what is actually drawn — delete
   *  them on the canvas and it unticks itself. */
  bracketBinding?: {
    on: boolean;
    control: string | undefined;
    groups: string[];
    toggle: (on: boolean) => void;
    setControl: (group: string | undefined) => void;
  } | undefined;
  onAddLetters?: (id: NodeId) => void;
  onPlotSurvival?: (id: NodeId) => void;
  onPlotRoc?: (id: NodeId) => void;
  onPlotPca?: (id: NodeId) => void;
  /** Create the PCoA / NMDS graphs (the map, plus the scree or the Shepard plot). */
  onPlotOrdination?: (id: NodeId) => void;
  onPlotPartition?: ((id: NodeId) => void) | undefined;
  /** Create the forest + funnel pair from a meta-analysis result. */
  onPlotMeta?: (id: NodeId) => void;
  /** Create the funnel with the Trim-and-fill overlay from a publication-bias result. */
  onPlotBiasFunnel?: (id: NodeId) => void;
  onPlotResiduals?: (id: NodeId) => void;
  onExportAnalysis?: (id: NodeId, format: "csv" | "xlsx") => void;
  onAnnotateStats?: (id: NodeId) => void;
}) {
  const [copied, setCopied] = useState(false);
  // Opt-in "Draft methods text" panel: editable prose, never auto-inserted.
  const [proseText, setProseText] = useState<string | null>(null);
  const [proseCopied, setProseCopied] = useState(false);
  /** "Add to graph" menu — collapses up to seven method-dependent actions. */
  const [graphMenu, setGraphMenu] = useState(false);
  const analysis: Analysis | undefined =
    project.analyses.find((a) => a.id === analysisId) ?? project.analyses[0];
  if (!analysis) return <p className="note">No analysis.</p>;
  const r = analysis.result;
  // The key result: 1–4 stat cards + the verdict they support, from the one registry the
  // prose and the on-graph annotation also read (`keyResults.ts`).
  const key = r ? keyResultCards(r, analysis.params?.conf) : { cards: [] };
  const copyResults = (): void => {
    if (!r) return;
    void navigator.clipboard.writeText(analysisToTsv(r, analysis.params?.conf)).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    });
  };
  const toggleProse = (): void => {
    if (proseText !== null) {
      setProseText(null);
      return;
    }
    // Ask the app + engine what versions actually ran, so the drafted paragraph cites
    // real numbers. The call is async and may be unavailable (headless preview, or an
    // engine that has not handshaken) — draft immediately either way, then refine.
    const write = (v?: SoftwareVersions): void => {
      const draft = draftMethodsResults(analysis, project, v);
      if (!draft) return;
      // The stack versions are informative only — a footnote, never in the Methods body.
      const refs = draft.references?.length ? `\n\nSoftware references\n\n${draft.references.join("\n")}` : "";
      setProseText(`Methods\n\n${draft.methods}\n\nResults\n\n${draft.results}\n\nFootnote\n\n${draft.footnote}${refs}`);
    };
    const api = window.mady?.getEngineInfo;
    if (!api) return write();
    void api()
      .then((info) => write({ app: info.app, libraries: info.libraries }))
      .catch(() => write());
  };
  const copyProse = (): void => {
    if (proseText == null) return;
    void navigator.clipboard.writeText(proseText).then(() => {
      setProseCopied(true);
      window.setTimeout(() => setProseCopied(false), 1500);
    });
  };
  // The analysis carries pairwise comparisons (Tukey "A vs B" rows w/ p) → brackets.
  const hasPairwise = !!r?.terms.some((t) => t.term.includes(" vs ") && t.p != null);
  // A survival analysis ships KM step curves in `extra.curves` → can be plotted.
  const hasCurves = Array.isArray((r?.extra as { curves?: unknown } | undefined)?.curves);
  // …and a number-at-risk table in `extra.atrisk` → shown under the results.
  const atRiskData = (r?.extra as { atrisk?: AtRiskData } | undefined)?.atrisk;
  // A ROC analysis ships curve points + a per-cutoff table in `extra.roc` → plottable.
  const rocData = (r?.extra as { roc?: RocData } | undefined)?.roc;
  const hasRoc = Array.isArray(rocData?.points);
  // A PCA analysis ships scores + loadings in `extra.pca` → the score/loadings/scree graph suite.
  const pcaGraph = (r?.extra as { pca?: PcaData } | undefined)?.pca;
  const hasPca = Array.isArray(pcaGraph?.scores) && Array.isArray(pcaGraph?.loadings);
  // An ordination (any of the six: PCoA · NMDS · CA · RDA · CCA · db-RDA) ships its map in
  // `extra.ordination` — and no loadings, which is why it is a separate entry and not the PCA
  // suite (see OrdinationData). Gated on the result shape, never on the method, so a new
  // ordination reaches this button the moment its engine method returns a map.
  const ordGraph = (r?.extra as { ordination?: { scores?: unknown } } | undefined)?.ordination;
  // Variance partitioning ships no map — it ships the fractions, which are their own readout.
  const partGraph = (r?.extra as { varpart?: { fractions?: unknown } } | undefined)?.varpart;
  const hasPartition = Array.isArray(partGraph?.fractions) && (partGraph.fractions as unknown[]).length > 0;
  const hasOrdination = Array.isArray(ordGraph?.scores) && (ordGraph.scores as unknown[]).length > 0;
  // Regression / ANOVA / parametric t-tests ship residual arrays → diagnostic graphs.
  const hasResiduals = Array.isArray(
    (r?.extra as { residuals?: { resid?: unknown } } | undefined)?.residuals?.resid,
  );
  // Everything that puts this analysis onto a graph. Collapsed into one menu: as a
  // flat row they would be up to seven more buttons competing with Re-run, and which of
  // them exist depends on the method, so the row's width would change per analysis.
  const graphActions: Array<{ label: string; title: string; run: () => void }> = [
    ...(r && onAnnotateStats
      ? [{ label: "Key stats as a label", title: "Show the key result (e.g. p-value, effect size) as a movable text label on a graph of this data", run: () => onAnnotateStats(analysis.id) }]
      : []),
    // Once brackets are bound, "Significance brackets" is the tick-box below, not an item
    // here: the markers stay bound to this analysis (re-run refreshes them, untick removes
    // them), and a menu entry that only added another copy would read as a duplicate.
    ...(hasPairwise && onAddBrackets && !bracketBinding
      ? [{ label: "Significance brackets", title: "Add significance brackets (p < 0.05) to a box / violin / column-scatter graph of this data", run: () => onAddBrackets(analysis.id) }]
      : []),
    ...(hasPairwise && onAddLetters
      ? [{ label: "Letters (CLD)", title: "Add a Compact Letter Display (shared letter = not significantly different) above each group on a box / violin / column-scatter graph", run: () => onAddLetters(analysis.id) }]
      : []),
    ...(hasCurves && onPlotSurvival
      ? [{ label: "Survival curves", title: "Plot the Kaplan-Meier survival curves as a new graph", run: () => onPlotSurvival(analysis.id) }]
      : []),
    ...(hasRoc && onPlotRoc
      ? [{ label: "ROC curve", title: "Plot the ROC curve (sensitivity vs 1−specificity) as a new graph", run: () => onPlotRoc(analysis.id) }]
      : []),
    ...(hasPca && onPlotPca
      ? [{ label: "PCA graph suite", title: "Create the PCA graph suite: a score plot (cases in PC space, coloured by group), a loadings plot (variable vectors), and a scree plot (variance per component)", run: () => onPlotPca(analysis.id) }]
      : []),
    ...(hasOrdination && onPlotOrdination
      ? [{
        // Named from the method, not hardcoded: six methods reach this button, so a fixed
        // label would read "PCoA graphs" on a CCA result.
        label: `${ORDINATION_LABELS[analysis.method] ?? "Ordination"} graphs`,
        title: analysis.method === "nmds"
          ? "Create the NMDS map (cases in ordination space, coloured by group) and the Shepard plot that shows how well it fits"
          : CONSTRAINED_METHODS.has(analysis.method)
            ? "Create the triplot (cases, response variables and the explanatory arrows in one picture) and a scree plot of the constrained axes"
            : "Create the ordination map (cases in ordination space, coloured by group) and a scree plot of the axis eigenvalues",
        run: () => onPlotOrdination(analysis.id),
      }]
      : []),
    ...(hasPartition && onPlotPartition
      ? [{
        label: "Plot the fractions",
        title: "Draw each variance fraction as a bar — what each block explains alone, what they share, and what nothing explains. A bar, not a Venn: a shared fraction can be negative, and no area can be drawn negative.",
        run: () => onPlotPartition(analysis.id),
      }]
      : []),
    ...(analysis.method === "metaanalysis" && r && onPlotMeta
      ? [{ label: "Plot forest + funnel", title: "Create the forest plot and the funnel plot of these studies — their pooled diamond and pooled line use the same maths this analysis reports", run: () => onPlotMeta(analysis.id) }]
      : []),
    ...(analysis.method === "publicationbias" && r && onPlotBiasFunnel
      ? [{ label: "Funnel + imputed studies", title: "Create the funnel plot with the Trim-and-fill overlay on — the hollow dots and adjusted centre line are the same imputed studies this analysis reports", run: () => onPlotBiasFunnel(analysis.id) }]
      : []),
    ...(hasResiduals && onPlotResiduals
      ? [{ label: "Residual diagnostics", title: "Plot residual diagnostics: residual-vs-predicted (homoscedasticity / linearity), QQ of residuals (normality), residual histogram (distribution shape), and scale-location (non-constant variance)", run: () => onPlotResiduals(analysis.id) }]
      : []),
  ];

  return (
    <div>
      <div className="anhead">
        <h2 className="anhead-title">{analysis.name}</h2>
        {analysis.status === "stale" && <span className="badge badge-warn">source changed</span>}
        {analysis.status === "error" && <span className="badge badge-err">error</span>}
        <ValidationBadge method={analysis.method} title={analysis.name} />
      </div>
      <div className="antoolbar" role="toolbar" aria-label="Analysis actions">
        <button className="antb antb-primary" title="Re-run on the current data" onClick={() => onRerun(analysis.id)}>
          Re-run
        </button>
        {onSaveMethod && (
          <button className="antb" title="Save this analysis as a reusable Method — apply the same test + settings to another table" onClick={() => onSaveMethod(analysis.id)}>
            Save as Method
          </button>
        )}
        {r && (
          <>
            <span className="antb-sep" aria-hidden="true" />
            <button className="antb" title="Copy the results table (with title + summary) to the clipboard — pastes cleanly into Excel, Sheets or Word" onClick={copyResults}>
              {copied ? "Copied ✓" : "Copy"}
            </button>
            {onExportAnalysis && (
              <>
                <button className="antb" title="Export the results table to a CSV file" onClick={() => onExportAnalysis(analysis.id, "csv")}>
                  CSV
                </button>
                <button className="antb" title="Export the results table to an Excel (.xlsx) file" onClick={() => onExportAnalysis(analysis.id, "xlsx")}>
                  Excel
                </button>
              </>
            )}
            <button
              className={`antb${proseText !== null ? " is-on" : ""}`}
              title="Draft a Methods paragraph + a Results sentence you can copy into a manuscript — editable, and never inserted automatically"
              aria-pressed={proseText !== null}
              onClick={toggleProse}
            >
              Methods text
            </button>
          </>
        )}
        {graphActions.length > 0 && (
          <>
            <span className="antb-sep" aria-hidden="true" />
            <div className="antb-menuwrap">
              <button
                className={`antb antb-menu${graphMenu ? " is-on" : ""}`}
                aria-haspopup="true"
                aria-expanded={graphMenu}
                title="Put this result onto a graph"
                onClick={() => setGraphMenu(!graphMenu)}
              >
                Add to graph <span className="antb-caret">▾</span>
              </button>
              {graphMenu && (
                <div className="antb-menupanel" role="menu">
                  {graphActions.map((a) => (
                    <button
                      key={a.label}
                      className="antb-menuitem"
                      role="menuitem"
                      title={a.title}
                      onClick={() => { setGraphMenu(false); a.run(); }}
                    >
                      {a.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
            {/* Outside-click scrim — the MenuBar's close idiom. Never close this menu on
                mouseleave: the panel sits 4px below the button, so the pointer leaves the
                wrapper while crossing the gap and the menu vanished before it could be used. */}
            {graphMenu && <div className="menu-scrim" onClick={() => setGraphMenu(false)} />}
          </>
        )}
      </div>

      {/* Significance markers on the graph — a binding, not a one-shot action. Ticked, the
          markers are a readout of this analysis: a re-run refreshes every p-value and drops
          whatever stopped being significant; unticking removes exactly the ones it drew.
          Anything you added by hand is untouched either way. */}
      {hasPairwise && bracketBinding && (
        <div className="anbind" role="group" aria-label="Significance markers">
          <label className="anbind-toggle" title="Show this analysis's significant comparisons on the graph, and keep them in step with it">
            <input
              type="checkbox"
              checked={bracketBinding.on}
              onChange={(e) => bracketBinding.toggle(e.target.checked)}
            />
            <span>Significance markers on the graph</span>
          </label>
          <label className="anbind-control" title="Compare every group against one reference (control), instead of every pair">
            <span>Compare</span>
            <select
              className="selin"
              value={bracketBinding.control ?? ""}
              onChange={(e) => bracketBinding.setControl(e.target.value || undefined)}
            >
              <option value="">all pairs</option>
              {bracketBinding.groups.map((g) => (
                <option key={g} value={g}>vs {g}</option>
              ))}
            </select>
          </label>
          {bracketBinding.control && (
            <span className="anbind-note">
              A filter over this test&rsquo;s comparisons — the p-values keep whatever correction the test applied.
              For a designed control experiment, run Dunnett&rsquo;s instead.
            </span>
          )}
        </div>
      )}

      {proseText !== null && (
        <div className="prosepanel">
          <div className="prosepanel-head">
            <strong>Methods &amp; Results — draft</strong>
            <span className="prosepanel-note">Editable — review before use; nothing is inserted into your document.</span>
            <button className="btn-mini" onClick={copyProse}>{proseCopied ? "Copied ✓" : "Copy"}</button>
            <button className="btn-mini" title="Close" aria-label="Close draft" onClick={() => setProseText(null)}>✕</button>
          </div>
          <textarea
            className="prosepanel-text"
            value={proseText}
            onChange={(e) => setProseText(e.target.value)}
            spellCheck={false}
            rows={9}
            aria-label="Drafted methods and results text"
          />
        </div>
      )}

      {analysis.status === "error" && (
        <p className="note" style={{ color: "var(--danger)" }}>{analysis.error}</p>
      )}
      {analysis.status === "stale" && (
        <p className="note">The source data changed since this ran — Re-run to update.</p>
      )}

      {r ? (
        <>
          <p className="antitle">{r.title}</p>
          {r.flagged && (
            <div className="anflag" role="status" title="This fit breached one or more of the flag thresholds you set.">
              <span className="anflag-mark" aria-hidden="true">⚑</span>
              <span>
                <strong>Fit flagged as questionable.</strong>
                {r.flagReasons && r.flagReasons.length > 0 && <> {r.flagReasons.join("; ")}.</>}
              </span>
            </div>
          )}
          {key.cards.length > 0 && (
            <section className="ankey" aria-label="Key result">
              <span className="ankey-l">Key result</span>
              <div className="ankey-cards">
                {key.cards.map((c, i) => (
                  <div key={i} className={`ankey-card is-${c.tone}`} title={c.text}>
                    <span className="ankey-k">{c.label}</span>
                    <span className="ankey-v">{c.value}</span>
                    {c.detail && <span className="ankey-d">{c.detail}</span>}
                  </div>
                ))}
              </div>
              {key.verdict && (
                <p className={`ankey-verdict${key.cards.some((c) => c.isP && c.tone === "sig") ? " is-sig" : ""}`}>{key.verdict}</p>
              )}
            </section>
          )}
          {(() => {
            const m = (r.extra as { matrix?: CorrMatrixData } | undefined)?.matrix;
            return m && Array.isArray(m.r) ? <CorrMatrix m={m} /> : null;
          })()}
          {(() => {
            const pcaData = (r.extra as { pca?: PcaData } | undefined)?.pca;
            const clusterData = (r.extra as { cluster?: ClusterData } | undefined)?.cluster;
            // PCA / cluster render their own views (the generic tidy headers
            // — Estimate/Statistic/CI — would mislabel their columns).
            if (pcaData && Array.isArray(pcaData.loadings)) return <PcaView d={pcaData} />;
            if (clusterData && Array.isArray(clusterData.sizes)) return <ClusterView d={clusterData} />;
            return <TidyTable terms={r.terms} method={r.method} conf={analysis.params?.conf} digits={resultDigits} />;
          })()}
          {rocData && rocData.cutoffs.length > 0 && <RocCutoffs d={rocData} />}
          {atRiskData && atRiskData.rows.length > 0 && <AtRiskTable d={atRiskData} />}
          <p className="ansummary">{r.summary}</p>
          {r.assumptions && r.assumptions.length > 0 && (
            <ul className="note anassume">
              {r.assumptions.map((a, i) => <li key={i}>{a}</li>)}
            </ul>
          )}
          {r.cite && <p className="note ancite">{r.cite}</p>}
        </>
      ) : (
        <p className="note">No result yet — Re-run to compute.</p>
      )}

      {/* Caution: beta-version notice — under every analysis, not just the ones that computed.
          Deliberately outside the `r ?` branch: a stale or errored analysis is still a
          number the user may be reading off the screen, and an "error" state is exactly
          when someone re-runs, gets a plausible figure, and stops questioning it.
          Not dismissible: a warning that can be turned off soon stops being read, and the
          cost here (publishing a wrong statistic) does not fall with familiarity. Says the same thing as the Docs tab banner (`.beta-banner`) — keep the
          two in step; `AnalysisPane.results.test.tsx` pins this one. */}
      <p className="anbeta" role="note">
        <strong>Beta version</strong> — assess this analysis critically. MadY&rsquo;s statistics are still
        under development and may contain inaccuracies; check anything you intend to publish against an
        established statistics package before you rely on it.
      </p>
    </div>
  );
}

export function DocsPane({
  project,
  folderId,
  onChange,
}: {
  project: Project;
  folderId?: NodeId | undefined;
  onChange: (text: string) => void;
}) {
  const folder = project.workspace.folders.find((f) => f.id === folderId);
  if (!folder) return <p className="note">No project documentation.</p>;
  return (
    <div>
      <h2 className="h">{folder.name} — Methods &amp; notes</h2>
      <textarea
        className="docedit"
        value={folder.documentation}
        placeholder="Free-form notes for this project: methods, decisions, how to cite…"
        onChange={(e) => onChange(e.target.value)}
      />
      {/* No promises about features that do not exist yet: "will attach here" reads as a
          broken feature rather than a plan. The methods paragraph and the analysis log are
          both real and reachable, so the hints point at them. */}
      <ul className="viewhints" aria-label="About these notes">
        <li>Free-form notes for this project — saved with the file</li>
        <li>A draft methods paragraph is on each analysis, under <b>Methods text</b></li>
        <li>The reproducible record of what was run is in <b>Lineage</b></li>
      </ul>
    </div>
  );
}

/**
 * LayoutPane — the multi-panel figure assembler. A graph-picker adds the
 * project's graphs as panels; the chosen graphs tile in a responsive grid
 * (read-only `PlotFigure`) with automatic A/B/C panel lettering, magnetic
 * alignment and shared axes. Membership + order persist in the model
 * (`project.layouts`).
 */
/** Nominal free-drag panel box (px): the 380×260 scene + header + padding. Used for
 *  default positions, the container size, and snap edges. */
const PANEL_W = 396;
const PANEL_H = 308;

/**
 * The one legend a merged figure shows, drawn below the panels.
 *
 * Deliberately mirrors `PlotFigure`'s own `Legend` swatch geometry (a 12px rule with a dot,
 * or the series' marker shape, then the label at +18) so the merged key is visually the same
 * object the per-panel legends were — just once. Laid out as a single centred horizontal row,
 * which is how a figure-wide key reads.
 *
 * Rendered as its own `<svg>` so the exporter can place it exactly like a panel: it is picked
 * up by the same DOM readers, with no letter of its own.
 */
function FigureLegend({ entries, font }: { entries: readonly LegendEntry[]; font: { size: number; family?: string | null | undefined } }) {
  const fs = font.size;
  const swatchW = 18;
  const gap = 14;
  const pad = 6;
  const estW = (s: string): number => s.length * fs * 0.6;
  const itemW = (e: LegendEntry): number => swatchW + estW(e.label);
  const w = Math.max(1, entries.reduce((a, e) => a + itemW(e) + gap, 0) - gap + pad * 2);
  const h = fs + 6 + pad * 2;
  let acc = pad;
  return (
    <svg
      className="gfx-figure"
      width={w}
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      xmlns="http://www.w3.org/2000/svg"
      style={{ ...(font.family ? { fontFamily: font.family } : {}), fontSize: fs, fill: "var(--ink)" }}
    >
      {entries.map((e, i) => {
        const lx = acc;
        const ly = h / 2;
        acc += itemW(e) + gap;
        return (
          <g key={`${e.label}-${i}`}>
            {e.symbol ? (
              <Marker shape={e.symbol} cx={lx + 6} cy={ly} size={4} color={e.color} fill="solid" fillColor={undefined} opacity={1} outline={e.color} borderWidth={1} />
            ) : (
              // The key draws what the row's mark draws: no dot for a line-only row (a listed reference line or fitted
              // curve, a Kaplan-Meier trace), no line for a points-only one, and a listed line's own dash and width.
              <>
                {e.line !== false && <line x1={lx} x2={lx + 12} y1={ly} y2={ly} stroke={e.color} strokeWidth={e.lineWidth ?? 2.4} {...(e.dash ? { strokeDasharray: keyDash(e.dash, 12) } : {})} />}
                {e.marker !== false && <circle cx={lx + 6} cy={ly} r={3} fill={e.color} />}
              </>
            )}
            <text x={lx + swatchW} y={ly + fs * 0.34} fill="var(--ink)">
              <RichText text={e.label} />
            </text>
          </g>
        );
      })}
    </svg>
  );
}

/**
 * "Add image…" — pick a picture and add it to the figure as a panel.
 *
 * Reads the file to a data URI in the renderer (no IPC), so the bytes travel inside the
 * .mady project rather than as a path that can go stale — the same contract as an image
 * annotation. The file name seeds the panel name and the initial alt text, because a caption
 * drafter cannot see the picture and an unlabelled image is invisible to a screen reader.
 */
/**
 * Whether this figure's panels are still linked to the graphs they came from — shown as the
 * state it is in, not as a box to tick.
 *
 * The distinction is the most consequential one in the assembler (edit a panel and you may be
 * editing the original), and a bare checkbox in a toolbar of eight controls is easy to miss.
 * So it says which mode it is in, in words, and it is the only control on that bar with a
 * state colour, so it reads as a mode rather than a preference.
 */
function LinkStateChip({ linked, onSetLinked }: { linked: boolean; onSetLinked: (linked: boolean) => void }) {
  return (
    <button
      type="button"
      className={`laylink${linked ? " laylink-on" : " laylink-off"}`}
      aria-pressed={linked}
      data-linked={linked ? "yes" : "no"}
      title={
        linked
          ? "Linked — styling a panel also changes its source graph, and a change to the source shows up here. Click to make this figure an independent copy."
          : "Independent — each panel is a private copy; editing it does not touch the source graph. Click to re-link (which discards this figure's own edits)."
      }
      onClick={() => {
        // Re-linking deletes the copies' own edits (setLayoutLinked drops every clone
        // plot), so it asks first. Unlinking makes a copy and destroys nothing.
        if (!linked && !window.confirm("Re-link this figure to its source graphs?\n\nThe copies' own edits will be discarded. (Ctrl+Z to undo.)")) return;
        onSetLinked(!linked);
      }}
    >
      {linked ? <Link2 size={15} aria-hidden /> : <Unlink size={15} aria-hidden />}
      <span className="laylink-state">{linked ? "Linked to sources" : "Independent copy"}</span>
      {/* People look for "the button to connect or disconnect" — so the chip names the
          action a click performs, not only the mode it is in. The verb is what they went
          looking for; the state colour + word say where it is now. */}
      <span className="laylink-act">{linked ? "click to disconnect" : "click to reconnect"}</span>
    </button>
  );
}

/**
 * The graphs drawn from this datasheet, as a menu.
 *
 * Disabled rather than hidden when there are none, with the reason in the tooltip: a control
 * that appears and disappears is harder to learn than one that is always in the same place and
 * tells you why it is not available. It is never unconditionally disabled — the moment a graph
 * exists it opens (see `toolbar.no-dead-buttons.test.ts` for the same rule on toolbar buttons).
 */
function GraphsFromTableMenu({ project, tableId, onOpenPlot }: { project: Project; tableId: NodeId; onOpenPlot: (plotId: NodeId) => void }) {
  const [open, setOpen] = useState(false);
  // Figure-internal clones are not graphs the user filed anywhere; listing them would offer
  // rows that open a panel copy rather than the graph it was cloned from.
  const cloneIds = new Set((project.layouts ?? []).flatMap((l) => Object.keys(l.panelSource ?? {})));
  // A graph is drawn from this sheet if it is its source or it borrows a series from it
  // (`plot.overlays`, composite graphs). Without the overlay clause the borrowed sheet — e.g.
  // the "Model curve" sheet of a two-sheet graph — would show an empty menu, breaking the
  // link from the sheet back to the graph. Holds for every graph kind.
  const mine = project.plots.filter(
    (p) => (p.source === tableId || (p.overlays ?? []).some((o) => o.table === tableId)) && !cloneIds.has(p.id),
  );
  return (
    <span className="antb-menuwrap">
      <button
        type="button"
        className="railbtn"
        disabled={mine.length === 0}
        data-graphs-from-table={mine.length}
        title={
          mine.length === 0
            ? "No graphs are drawn from this datasheet yet — make one from Insert ▸ New graph."
            : `Open one of the ${mine.length} graph${mine.length === 1 ? "" : "s"} drawn from this datasheet`
        }
        onClick={() => setOpen((v) => !v)}
      >
        <BarChart3 size={13} /> Graphs{mine.length ? ` (${mine.length})` : ""}
      </button>
      {open && mine.length > 0 && (
        <div className="antb-menupanel" role="menu">
          {mine.map((p) => (
            <button
              key={p.id}
              type="button"
              role="menuitem"
              className="antb-menuitem"
              onClick={() => { setOpen(false); onOpenPlot(p.id); }}
            >
              {p.name}
            </button>
          ))}
        </div>
      )}
    </span>
  );
}

/**
 * The datasheets this graph is drawn from, as a menu — the mirror of {@link GraphsFromTableMenu}.
 *
 * A plain graph has one source sheet and gets a single "Datasheet" button (in the ribbon). But a
 * composite (a series borrowed from another datasheet, `plot.overlays`) is drawn from more than one
 * sheet, and the single button could only ever open the first — so here it becomes a named menu, the
 * same shape the datasheet uses to reach its many graphs. Only rendered when there are ≥2 sheets.
 */
function SheetsForGraphMenu({
  sheets,
  onOpenTable,
}: {
  sheets: { id: NodeId; name: string }[];
  onOpenTable: (tableId: NodeId) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <span className="antb-menuwrap">
      <button
        type="button"
        className="grbbtn"
        data-sheets-for-graph={sheets.length}
        title={`This graph is drawn from ${sheets.length} datasheets — open ${sheets.map((s) => `“${s.name}”`).join(", ")}`}
        onClick={() => setOpen((v) => !v)}
      >
        <Table2 size={13} /> Datasheets ({sheets.length})
      </button>
      {open && (
        <div className="antb-menupanel" role="menu">
          {sheets.map((s) => (
            <button
              key={s.id}
              type="button"
              role="menuitem"
              className="antb-menuitem"
              onClick={() => { setOpen(false); onOpenTable(s.id); }}
            >
              {s.name}
            </button>
          ))}
        </div>
      )}
    </span>
  );
}

function AddImageButton({ onAdd }: { onAdd: (name: string, src: string, alt?: string | undefined, naturalW?: number | undefined, naturalH?: number | undefined) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const pick = (file: File): void => {
    setError(null);
    const reader = new FileReader();
    reader.onerror = () => setError(`Could not read ${file.name}.`);
    reader.onload = () => {
      const src = typeof reader.result === "string" ? reader.result : "";
      if (!src) { setError(`Could not read ${file.name}.`); return; }
      const base = file.name.replace(/\.[^.]+$/, "");
      // Capture the source's pixel size while we have it — crop/rotate
      // need the true aspect. A decode failure still adds the panel, just without it — and
      // a decoder that never answers at all (jsdom; a pathological file) must not swallow
      // the add, so a fallback timer adds the panel unsized. `done` is once-only.
      let settled = false;
      const done = (w?: number, h?: number): void => {
        if (settled) return;
        settled = true;
        onAdd(base || "Image", src, base || undefined, w, h);
      };
      const img = new Image();
      img.onload = () => done(img.naturalWidth || undefined, img.naturalHeight || undefined);
      img.onerror = () => done();
      img.src = src;
      // Benign if it wins a slow decode: the panel adds unsized, and the renderer's own
      // runtime measure supplies the aspect the moment crop/rotate need it.
      setTimeout(() => done(), 600);
    };
    reader.readAsDataURL(file);
  };
  return (
    <>
      <button
        className="addbtn"
        title="Add a picture (micrograph, blot, schematic) as a panel of this figure — it is embedded in the project, not linked"
        onClick={() => inputRef.current?.click()}
      >
        Add image…
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        aria-label="Choose an image to add as a figure panel"
        style={{ display: "none" }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) pick(f);
          e.target.value = ""; // let the same file be chosen again
        }}
      />
      {error && <span className="note" role="alert">{error}</span>}
    </>
  );
}

/** A panel's data-rectangle (axis) edge offsets from its card's top-left, in px. */
export interface AxisOffsets { dl: number; dr: number; dt: number; db: number }

/** Snap a dragged panel's edges/centre — and its axis (data-rect) edges — to other
 *  panels' card edges/centres and axis edges, plus the canvas edges/centre. Returns
 *  the snapped top-left + the active guide line positions (container coords). When the
 *  winning guide is an axis line, `vxAxis`/`hyAxis` flag it so the guide can render
 *  emphasised (an axis-alignment cue rather than a plain edge cue). */
export function snapPanels(
  x: number,
  y: number,
  w: number,
  h: number,
  others: { left: number; top: number; w: number; h: number; axis?: AxisOffsets | undefined }[],
  cw: number,
  ch: number,
  threshold = 6,
  myAxis?: AxisOffsets | undefined,
  guides?: FigureLayout["guides"],
): { x: number; y: number; vx?: number | undefined; hy?: number | undefined; vxAxis?: boolean; hyAxis?: boolean } {
  // "my" candidate vertical lines (relative to x): left · centre · right [· axis L/R]
  const myX: { off: number; axis: boolean }[] = [
    { off: 0, axis: false }, { off: w / 2, axis: false }, { off: w, axis: false },
  ];
  const myY: { off: number; axis: boolean }[] = [
    { off: 0, axis: false }, { off: h / 2, axis: false }, { off: h, axis: false },
  ];
  if (myAxis) {
    myX.push({ off: myAxis.dl, axis: true }, { off: myAxis.dr, axis: true });
    myY.push({ off: myAxis.dt, axis: true }, { off: myAxis.db, axis: true });
  }
  const targX: { pos: number; axis: boolean }[] = [{ pos: 0, axis: false }, { pos: cw / 2, axis: false }, { pos: cw, axis: false }];
  const targY: { pos: number; axis: boolean }[] = [{ pos: 0, axis: false }, { pos: ch / 2, axis: false }, { pos: ch, axis: false }];
  for (const o of others) {
    targX.push({ pos: o.left, axis: false }, { pos: o.left + o.w / 2, axis: false }, { pos: o.left + o.w, axis: false });
    targY.push({ pos: o.top, axis: false }, { pos: o.top + o.h / 2, axis: false }, { pos: o.top + o.h, axis: false });
    if (o.axis) {
      targX.push({ pos: o.left + o.axis.dl, axis: true }, { pos: o.left + o.axis.dr, axis: true });
      targY.push({ pos: o.top + o.axis.dt, axis: true }, { pos: o.top + o.axis.db, axis: true });
    }
  }
  // Guides dragged out of the rulers are targets exactly like a panel edge.
  for (const gx of guides?.v ?? []) targX.push({ pos: gx, axis: false });
  for (const gy of guides?.h ?? []) targY.push({ pos: gy, axis: false });
  let sx = x, vx: number | undefined, vxAxis = false, bestDX = threshold + 1;
  for (const m of myX) for (const t of targX) {
    // Axis-to-axis snaps win ties (slightly larger effective threshold) — axis alignment
    // is what matters most for figure panels.
    const d = Math.abs((x + m.off) - t.pos);
    const eff = m.axis && t.axis ? threshold + 2 : threshold;
    if (d <= eff && d < bestDX) { bestDX = d; sx = x + (t.pos - (x + m.off)); vx = t.pos; vxAxis = m.axis && t.axis; }
  }
  let sy = y, hy: number | undefined, hyAxis = false, bestDY = threshold + 1;
  for (const m of myY) for (const t of targY) {
    const d = Math.abs((y + m.off) - t.pos);
    const eff = m.axis && t.axis ? threshold + 2 : threshold;
    if (d <= eff && d < bestDY) { bestDY = d; sy = y + (t.pos - (y + m.off)); hy = t.pos; hyAxis = m.axis && t.axis; }
  }
  return { x: sx, y: sy, vx, hy, vxAxis, hyAxis };
}

/** The canvas grid's spacing (px) — the drawn grid and "Snap to grid" share it. */
export const GRID_STEP = 32;

/** "Snap to grid": round a dragged panel's corner to the grid, only on an axis that did not already
 *  snap to an edge or a guide (`vx` / `hy` set by `snapPanels`) — an edge or guide the user can see
 *  wins over the grid. */
export function applyGridSnap(s: { x: number; y: number; vx?: number | undefined; hy?: number | undefined }, step: number): { x: number; y: number } {
  return {
    x: s.vx !== undefined ? s.x : Math.round(s.x / step) * step,
    y: s.hy !== undefined ? s.y : Math.round(s.y / step) * step,
  };
}

/** A panel's current geometry on the arrange canvas: card top-left + card footprint
 *  (incl. padding/header) + the underlying scene (graph) size. */
export interface PanelBox { id: NodeId; x: number; y: number; cardW: number; cardH: number; sceneW: number; sceneH: number }

/**
 * Compute the panelPositions / panelSizes patch to align / distribute / equalise a
 * set of graph panels on a layout page (the "magnetic alignment" one-click
 * Arrange). Align / distribute / centre reposition the card footprints (→ positions);
 * equalise resizes the scene (→ sizes; the card follows affinely, so equalising the
 * scene equalises the card too). Pure — reuses the shared `arrangeBoxes` engine, so
 * it's the same geometry as annotation arrange. <2 panels → an empty patch.
 */
export function arrangePanels(
  panels: PanelBox[],
  op: AlignOp,
): { positions?: Record<NodeId, { x: number; y: number }>; sizes?: Record<NodeId, { w: number; h: number }> } {
  if (panels.length < 2) return {};
  if (op === "equalize-w" || op === "equalize-h") {
    const out = arrangeBoxes(panels.map((p) => ({ x: 0, y: 0, w: p.sceneW, h: p.sceneH })), op);
    const sizes: Record<NodeId, { w: number; h: number }> = {};
    panels.forEach((p, i) => { sizes[p.id] = { w: Math.round(out[i]!.w), h: Math.round(out[i]!.h) }; });
    return { sizes };
  }
  const out = arrangeBoxes(panels.map((p) => ({ x: p.x, y: p.y, w: p.cardW, h: p.cardH })), op);
  const positions: Record<NodeId, { x: number; y: number }> = {};
  panels.forEach((p, i) => { positions[p.id] = { x: Math.round(out[i]!.x), y: Math.round(out[i]!.y) }; });
  return { positions };
}

/** DOM (= paint) order for absolutely-positioned panels: ascending `panelZ` (missing = 0),
 *  ties keep the given (`panels` = lettering) order. The figure exporter reads panels in DOM
 *  order, so sorting the DOM is what keeps the on-screen stacking and the export identical. */
export function stackOrder<T>(items: T[], idOf: (t: T) => NodeId, z: Record<NodeId, number> | undefined): T[] {
  return items
    .map((t, i) => ({ t, i }))
    .sort((a, b) => (z?.[idOf(a.t)] ?? 0) - (z?.[idOf(b.t)] ?? 0) || a.i - b.i)
    .map((x) => x.t);
}

/** The `panelZ` patch that puts `ids` in front of (or behind) every other panel, keeping the
 *  moved panels' own relative order. Pure; existing entries for other panels are preserved. */
export function restackPanels(
  allIds: NodeId[],
  z: Record<NodeId, number> | undefined,
  ids: NodeId[],
  to: "front" | "back",
): Record<NodeId, number> {
  const zs = allIds.map((id) => z?.[id] ?? 0);
  const hi = zs.length > 0 ? Math.max(...zs) : 0;
  const lo = zs.length > 0 ? Math.min(...zs) : 0;
  const out: Record<NodeId, number> = { ...(z ?? {}) };
  ids.forEach((id, k) => { out[id] = to === "front" ? hi + 1 + k : lo - ids.length + k; });
  return out;
}

/** Positions patch that centres the selected panels — moved together, as one rigid group — on
 *  the figure's content box (the union of all panels' cards: the box that exports as the
 *  page). `axis` "h" centres left–right, "v" top–bottom. Selecting every panel leaves nothing
 *  to centre against (the group would define its own box) → empty patch. */
export function centerPanelsOnFigure(
  all: PanelBox[],
  selIds: ReadonlySet<NodeId>,
  axis: "h" | "v",
): Record<NodeId, { x: number; y: number }> {
  const sel = all.filter((p) => selIds.has(p.id));
  if (sel.length === 0 || sel.length === all.length) return {};
  const box = (ps: PanelBox[]) => ({
    x0: Math.min(...ps.map((p) => p.x)),
    y0: Math.min(...ps.map((p) => p.y)),
    x1: Math.max(...ps.map((p) => p.x + p.cardW)),
    y1: Math.max(...ps.map((p) => p.y + p.cardH)),
  });
  const uni = box(all);
  const grp = box(sel);
  const dx = axis === "h" ? (uni.x0 + uni.x1) / 2 - (grp.x0 + grp.x1) / 2 : 0;
  const dy = axis === "v" ? (uni.y0 + uni.y1) / 2 - (grp.y0 + grp.y1) / 2 : 0;
  const out: Record<NodeId, { x: number; y: number }> = {};
  for (const p of sel) out[p.id] = { x: Math.round(p.x + dx), y: Math.round(p.y + dy) };
  return out;
}

/** Measuring ruler along the top + left of the arrange canvas, labelled in the chosen `unit`
 *  (figure px = export px, inches, or cm — a scene px is a 96-dpi CSS pixel). The canvas is
 *  drawn 1:1 in px, so tick positions are canvas px and only the label values convert. Purely
 *  visual — helps gauge sizes + manual alignment. */
function RulerBands({ w, h, size, unit, zoom = 1, onPointerDown }: {
  w: number; h: number; size: number; unit: RulerUnit; zoom?: number;
  /** Given → the bands take presses: the top band pulls out a horizontal guide, the left a vertical one. */
  onPointerDown?: ((axis: "v" | "h", e: React.PointerEvent) => void) | undefined;
}) {
  // `w`/`h` are the canvas's on-screen size (already ×zoom); `ppu * zoom` is screen px per unit,
  // so a label value in units sits at `u * ppu * zoom`. The step targets ~80 screen px so the
  // spacing stays readable and refines as you zoom in, exactly like the graph ruler.
  const ppu = pxPerUnit(unit);
  const spanU = (denom: number): number => denom / (ppu * zoom); // canvas span in display units
  const step = niceRulerStep(80 / (ppu * zoom));
  const minor = step / 5;
  const top: React.ReactNode[] = [];
  const left: React.ReactNode[] = [];
  for (let i = 0, u = 0; u <= spanU(w) + minor / 2; i++, u = i * minor) {
    const major = i % 5 === 0;
    const px = u * ppu * zoom;
    top.push(<line key={`tx${i}`} x1={px} y1={size} x2={px} y2={size - (major ? 8 : 4)} stroke="var(--muted)" strokeWidth={1} />);
    if (major && u > 0) top.push(<text key={`txl${i}`} x={px + 2} y={size - 10} fontSize={9} fill="var(--muted)">{fmtRulerTick(u, step)}</text>);
  }
  for (let i = 0, u = 0; u <= spanU(h) + minor / 2; i++, u = i * minor) {
    const major = i % 5 === 0;
    const px = u * ppu * zoom;
    left.push(<line key={`ly${i}`} x1={size} y1={px} x2={size - (major ? 8 : 4)} y2={px} stroke="var(--muted)" strokeWidth={1} />);
    if (major && u > 0) left.push(<text key={`lyl${i}`} x={3} y={px - 3} fontSize={9} fill="var(--muted)">{fmtRulerTick(u, step)}</text>);
  }
  return (
    <>
      <svg
        className={`layruler${onPointerDown ? " layruler-live" : ""}`}
        width={w} height={size} style={{ position: "absolute", left: size, top: 0 }}
        onPointerDown={onPointerDown ? (e) => onPointerDown("h", e) : undefined}
      >{top}</svg>
      <svg
        className={`layruler${onPointerDown ? " layruler-live" : ""}`}
        width={size} height={h} style={{ position: "absolute", left: 0, top: size }}
        onPointerDown={onPointerDown ? (e) => onPointerDown("v", e) : undefined}
      >{left}</svg>
      <div className="layruler-corner figruler-corner" style={{ position: "absolute", left: 0, top: 0, width: size, height: size }}>{unit}</div>
    </>
  );
}

/**
 * The figure's page (Layout group): a preset (journal column, A4, Letter) or Custom, a swap
 * button (portrait ↔ landscape), and the page's W / H / margin in mm once a page is set.
 * Disabled in the plain flow grid, where there is no canvas to draw a page on — storing one
 * there would change nothing the user could see.
 */
function PageControls({ page, disabled, onSet }: {
  page: FigureLayout["page"];
  disabled: boolean;
  onSet: (page: FigureLayout["page"]) => void;
}) {
  const preset = page ? PAGE_SIZES.find((p) => (p.wMm === page.wMm && p.hMm === page.hMm) || (p.wMm === page.hMm && p.hMm === page.wMm)) : undefined;
  const value = !page ? "none" : preset ? preset.label : "custom";
  const withMargin = (wMm: number, hMm: number, marginMm = page?.marginMm): NonNullable<FigureLayout["page"]> =>
    ({ wMm, hMm, ...(marginMm ? { marginMm } : {}) });
  const num = (v: string): number => Math.round(Number(v) * 10) / 10;
  return (
    <>
      <label
        className="laypick-l laylbl"
        title={disabled ? "No page in the plain grid: switch on Free drag or an Align mode to lay the figure out on a page" : "The page the figure is laid out on: its outline shows behind the panels, and the export is the page"}
      >
        Page
        <select
          className="selin"
          style={{ width: "auto" }}
          value={value}
          disabled={disabled}
          onChange={(e) => {
            const v = e.target.value;
            if (v === "none") return onSet(undefined);
            if (v === "custom") return onSet(page ?? { wMm: 150, hMm: 200 });
            const p = PAGE_SIZES.find((x) => x.label === v);
            if (p) onSet(withMargin(p.wMm, p.hMm));
          }}
        >
          <option value="none">None</option>
          {PAGE_SIZES.map((p) => <option key={p.label} value={p.label}>{p.label}</option>)}
          <option value="custom">Custom</option>
        </select>
      </label>
      {page && !disabled && (
        <>
          <button
            type="button"
            className="laychip"
            title={`Swap the page to ${page.wMm > page.hMm ? "portrait" : "landscape"}`}
            onClick={() => onSet(withMargin(page.hMm, page.wMm))}
          >
            ⇄
          </button>
          <input type="number" className="numin" style={{ width: 56 }} min={20} step={1} title="Page width (mm)" value={page.wMm}
            onChange={(e) => { const v = num(e.target.value); if (v > 0) onSet(withMargin(v, page.hMm)); }} />
          ×
          <input type="number" className="numin" style={{ width: 56 }} min={20} step={1} title="Page height (mm)" value={page.hMm}
            onChange={(e) => { const v = num(e.target.value); if (v > 0) onSet(withMargin(page.wMm, v)); }} />
          mm
          <input type="number" className="numin" style={{ width: 48 }} min={0} step={1} title="Page margin (mm): a dashed line inside the page" value={page.marginMm ?? 0}
            onChange={(e) => { const v = num(e.target.value); if (v >= 0) onSet(withMargin(page.wMm, page.hMm, v || undefined)); }} />
        </>
      )}
    </>
  );
}

/** 1-D clustering: group sorted values within `tol` of each other; return cluster centres
 *  (sorted). Used to auto-detect a figure's columns (cluster panel x) and rows (cluster y). */
function cluster1D(vals: number[], tol: number): number[] {
  const sorted = [...vals].sort((a, b) => a - b);
  const clusters: number[][] = [];
  for (const v of sorted) {
    const last = clusters[clusters.length - 1];
    if (last && v - last[last.length - 1]! <= tol) last.push(v);
    else clusters.push([v]);
  }
  return clusters.map((c) => c.reduce((a, b) => a + b, 0) / c.length);
}
/** Index of the nearest cluster centre to `v`. */
function nearestIdx(v: number, centres: number[]): number {
  let bi = 0, bd = Infinity;
  centres.forEach((c, i) => { const d = Math.abs(c - v); if (d < bd) { bd = d; bi = i; } });
  return bi;
}
function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)]!;
}

/** Default panel scene (graph) size in px before any per-panel resize. */
const DEFAULT_SCENE_W = 380;
const DEFAULT_SCENE_H = 260;
/** Card chrome around the scene: `.laypanel` padding (8) on each side. */
const CARD_PAD = 8;
/** Uniform data-rectangle size (px) every panel's axes are stretched to when Auto-align
 *  is on — equal axis lengths make the X-axes line up per column, Y-axes per row. */
const ALIGN_AX = 300;
const ALIGN_AY = 200;
/**
 * Kinds with no cartesian data axis that also ignore the align axis-length overrides — they
 * render at the raw scene size, so under Align X/Y `geomOf` would build them at the full 900×700
 * and the grid placer would stack them on top of each other. These tile by
 * their outer footprint, not by a data-rect they don't have: excluded from the align
 * axis-length build and from the data-rect shift, so they sit in the grid at their natural
 * size like any tile.
 *
 * Heatmap is deliberately not here: a matrix heatmap consumes the axis lengths to grow its
 * cell grid (measured 444×310, not 900×700), so it keeps its own `isAxisless` expansion pass.
 * Derived by measurement (each kind built with the align
 * overrides and checked for whether it shrank); `align-footprint-kinds.test.ts` re-runs that
 * classification and fails when a kind's measured behaviour disagrees with this list.
 */
export const FOOTPRINT_ALIGN_KINDS = new Set<string>([
  "treemap", "network", "pie", "radar", "alluvial", "parallel", "scatter3d",
  // paireddot ignores the width override specifically (it stretches to fit its row labels
  // instead of aligning to the data length), so under Align X it would grow to ~800px and
  // drive its whole column too wide — leaving a large gap beside the panel below it. It has
  // no numeric X axis to align anyway, so it tiles by its outer box like the rest.
  "paireddot",
  // Venn: discs, no axes — the builder ignores axis-length overrides,
  // so the measured membership test demands it here.
  "venn",
  // Ternary: a triangle, no cartesian axes — same box-tiling rule as the venn.
  "ternary",
  // Rose: a circle in a box — same rule.
  "rose",
  // Sunburst: concentric rings in a box, no cartesian axes — same box-tiling rule.
  "sunburst",
  // Chord: a ring of arcs + ribbons in a box, no cartesian axes — same rule.
  "chord",
  // Oncoprint: a genes×samples tile grid with its own gene/sample labels — no cartesian
  // axis to align to, tiles by its outer box.
  "oncoprint",
]);
const alignsByFootprint = (p: Plot): boolean => FOOTPRINT_ALIGN_KINDS.has(p.kind ?? "xy");
/**
 * The smallest scale a panel may draw at: the one at which its smallest designed text still reaches 8 px on
 * screen (the panel readability rule), never below the 0.7 floor re-laid panels already
 * use, never above 1. Align shrinks each graph so its plot area hits the shared size, and without this floor a
 * graph with a big plot area in its own figure shrinks to 0.37–0.46 — its 12 px legend and labels drawn at
 * 4.5–5.5 px. `fonts` is the scene's resolved font table.
 */
export function readableScale(fonts: object): number {
  const sizes = Object.values(fonts as Record<string, { size?: unknown } | undefined>)
    .map((v) => (v && typeof v.size === "number" && v.size > 0 ? v.size : Infinity));
  const smallest = Math.min(...sizes);
  return Number.isFinite(smallest) ? Math.min(1, Math.max(0.7, 8 / smallest)) : 0.7;
}
/**
 * The scale at which a matrix heatmap's smallest drawn text reaches 8 px: its row/column names (their own font, else the
 * tick font capped at 12 — as PlotFigure draws them), split-block names, track names and colour-bar labels. Those sizes
 * live on `scene.heatmap`, not in `scene.fonts`, so `readableScale` cannot see them. Not floored at 0.7: a heatmap
 * designed with 26 px names may shrink below that and stay readable. 0 when the scene is not a heatmap.
 */
export function heatmapReadableScale(scene: {
  fonts: { tick: { size: number }; legend: { size: number } };
  heatmap?: { labelFont?: { size: number } | undefined; splitLabelFont?: { size: number } | undefined; trackFont?: { size: number } | undefined; barFont?: { size: number } | undefined } | undefined;
}): number {
  const hm = scene.heatmap;
  if (!hm) return 0;
  const names = hm.labelFont?.size ?? Math.min(scene.fonts.tick.size, 12);
  const sizes = [names, hm.splitLabelFont?.size ?? names, hm.trackFont?.size ?? names, hm.barFont?.size ?? scene.fonts.legend.size].filter((x) => x > 0);
  return sizes.length ? Math.min(1, 8 / Math.min(...sizes)) : 0;
}
/**
 * A grid found from where the cards sit can have an empty slot before its last card: a figure with B and C placed
 * above-right and A below-left keeps that in its three columns, and Align all would leave the top-left slot empty and
 * half the figure white. Such a grid is repacked in reading order (row, then column, then the
 * card's own x), no holes, same column count. A grid with no hole is returned as it is, and so is any grid when
 * `canPack` is false (a spanning card owns more than one slot).
 */
export function packHoles(assign: readonly { c: number; r: number }[], cols: number, xs: readonly number[], canPack: boolean): { c: number; r: number }[] {
  if (!canPack || assign.length === 0) return [...assign];
  const taken = new Set(assign.map((a) => a.r * cols + a.c));
  const last = Math.max(...taken);
  let hole = false;
  for (let k = 0; k < last && !hole; k++) hole = !taken.has(k);
  if (!hole) return [...assign];
  const order = assign.map((a, i) => ({ i, k: a.r * cols + a.c, x: xs[i] ?? 0 })).sort((p, q) => p.k - q.k || p.x - q.x);
  const out = new Array<{ c: number; r: number }>(assign.length);
  order.forEach((o, n) => { out[o.i] = { c: n % cols, r: Math.floor(n / cols) }; });
  return out;
}
/** A plain number as an axis tick label: "12", "−0.5", "1,200", "40%", "1e-5". */
const NUMERIC_TICK = /^[−+-]?(\d[\d,]*(\.\d*)?|\.\d+)(e[−+-]?\d+)?\s*%?$/i;
/**
 * A chart whose left axis shows names, not numbers (horizontal bar / lollipop / paired dot / forest /
 * pyramid / swimmer / tracks — `valueAxis: "x"` — and the ridgeline, whose left axis names its rows).
 * Its long names sit inside its own left margin, so if it set a column's Y-axis line it would push every
 * numbers chart in the column right, off its column edge (its letter left in the gutter), leaving
 * large empty spaces between cards. It sets the line only where no numbers chart can — the rule
 * already used for the paired-dot. Rows are unaffected: the names are on the left.
 */
/**
 * The box (scene px) the Y-axis title is drawn in, placed exactly as PlotFigure places it: turned −90° and centred on
 * the plot at `titlePos` (else 1.08 × its font from the left edge), or the user's own turn (`titleTurn`), plus a
 * dragged offset. A corner letter checked against the axis numbers alone misses a long title ("Difference (Method A −
 * Method B)") that reaches up into the corner under the letter. Undefined when there is no title.
 */
export function yTitleBox(
  scene: { plot: { x: number; y: number; width: number; height: number }; fonts: { yAxisTitle: { size: number } }; y?: { title?: string; titlePos?: number | undefined; titleCenter?: number | undefined; titleFont?: number | undefined; titleOffset?: { dx: number; dy: number } | undefined; titleTurn?: { angle: number; x: number; y: number; anchor: "start" | "middle" | "end"; text?: string | undefined } | undefined } | undefined },
  measure: (text: string, px: number) => number,
): { l: number; t: number; r: number; b: number } | undefined {
  const y = scene.y;
  const turn = y?.titleTurn;
  const text = turn?.text ?? y?.title ?? "";
  if (!y || !text.trim()) return undefined;
  const F = y.titleFont ?? scene.fonts.yAxisTitle.size;
  const w = measure(text, F);
  const anchor = turn?.anchor ?? "middle";
  const a = ((turn?.angle ?? -90) * Math.PI) / 180;
  const ox = (turn?.x ?? y.titlePos ?? Math.max(14, Math.round(F * 1.08))) + (y.titleOffset?.dx ?? 0);
  const oy = (turn?.y ?? y.titleCenter ?? scene.plot.y + scene.plot.height / 2) + (y.titleOffset?.dy ?? 0);
  const x0 = anchor === "start" ? 0 : anchor === "middle" ? -w / 2 : -w;
  const pts = [[x0, -0.8 * F], [x0 + w, -0.8 * F], [x0, 0.25 * F], [x0 + w, 0.25 * F]].map(([px, py]) => [ox + px! * Math.cos(a) - py! * Math.sin(a), oy + px! * Math.sin(a) + py! * Math.cos(a)]);
  return { l: Math.min(...pts.map((p) => p[0]!)), r: Math.max(...pts.map((p) => p[0]!)), t: Math.min(...pts.map((p) => p[1]!)), b: Math.max(...pts.map((p) => p[1]!)) };
}
// A matrix heatmap names its rows down its left too: drawn readable, its names + dendrogram would set a line far
// right of every numbers chart in the column (pushing them in from their cards) — so it follows the line like the rest.
const namesOnLeft = (scene: { kind?: string; heatmap?: { pointMode?: unknown } | undefined; valueAxis?: "x" | "y" | undefined; y?: { ticks?: { label?: string }[] } | undefined }): boolean =>
  scene.valueAxis === "x" || (scene.kind === "heatmap" && !!scene.heatmap && !scene.heatmap.pointMode) || (scene.y?.ticks ?? []).some((t) => !!t.label && !NUMERIC_TICK.test(t.label.trim()));
/** Preset panel-label colours (first = the theme default). */
const LABEL_SWATCHES = ["#1a1a1a", "#000000", "#ffffff", "#d11a2a", "#1f6feb", "#138000", "#e36209", "#6f42c1"];
/** Breathing room (px) around the canvas so a label dragged beyond its card (incl. left/up)
 *  stays visible and isn't clipped by the scroll container. */
// Base cushion around the arrange canvas. Kept small: dragged A/B/C labels that overflow
// the canvas are handled dynamically (the offL/offT + maxLX/maxLY math grows the wrap to
// fit them), so this only needs to be a slim resting margin — not a big empty border.
const LABEL_ROOM = 24;

// --- panel-figure graph selection: group + order graphs by tree proximity ---
interface TreeLoc { folderId?: NodeId; experimentId?: NodeId }

/** Where a workspace object (plot / layout) is filed in the tree. {} = loose/unfiled. */
function treeLocOf(project: Project, kind: "plot" | "layout", id: NodeId): TreeLoc {
  const ws = project.workspace;
  for (const f of ws.folders) {
    if (f.members.some((m) => m.kind === kind && m.id === id)) return { folderId: f.id };
    for (const e of f.experiments) {
      if (e.members.some((m) => m.kind === kind && m.id === id)) return { folderId: f.id, experimentId: e.id };
    }
  }
  return {};
}

/** Proximity of a group's location to the figure's: 0 = same experiment, 1 = same
 *  project, 2 = another project, 3 = unfiled. Lower sorts first (closest on top). */
function proximityRank(grp: TreeLoc, fig: TreeLoc): number {
  if (fig.folderId && grp.folderId === fig.folderId) {
    return fig.experimentId && grp.experimentId === fig.experimentId ? 0 : 1;
  }
  return grp.folderId ? 2 : 3;
}

interface SelGroup { key: string; project: string | null; experiment: string | null; rank: number; plots: Plot[] }

/** Group every plot by its tree location, ordered by proximity to the figure. */
function groupPlotsForFigure(project: Project, figureId: NodeId): SelGroup[] {
  const ws = project.workspace;
  const figLoc = treeLocOf(project, "layout", figureId);
  const folderOf = (fid?: NodeId) => ws.folders.find((f) => f.id === fid);
  // Figure-internal clone plots (any unlinked figure's panels) are not real,
  // selectable graphs — keep them out of the selection list.
  const cloneIds = new Set((project.layouts ?? []).flatMap((l) => Object.keys(l.panelSource ?? {})));
  const groups = new Map<string, SelGroup & { fi: number; ei: number }>();
  for (const p of project.plots) {
    if (cloneIds.has(p.id)) continue;
    const loc = treeLocOf(project, "plot", p.id);
    const key = `${loc.folderId ?? "_"}/${loc.experimentId ?? "_"}`;
    let g = groups.get(key);
    if (!g) {
      const folder = folderOf(loc.folderId);
      g = {
        key,
        project: folder?.name ?? null,
        experiment: folder?.experiments.find((e) => e.id === loc.experimentId)?.name ?? null,
        rank: proximityRank(loc, figLoc),
        plots: [],
        fi: ws.folders.findIndex((f) => f.id === loc.folderId),
        ei: folder ? folder.experiments.findIndex((e) => e.id === loc.experimentId) : -1,
      };
      groups.set(key, g);
    }
    g.plots.push(p);
  }
  return [...groups.values()]
    .sort((a, b) => a.rank - b.rank || a.fi - b.fi || a.ei - b.ei)
    .map(({ fi: _fi, ei: _ei, ...g }) => g);
}

/**
 * Panel-figure selection page (the dedicated landing view opened from the tree):
 * every graph as a thumbnail card, grouped Project → Experiment and ordered by
 * proximity to where the figure lives in the tree (same experiment on top, other
 * projects at the bottom). Ticking a card includes/excludes it as a panel; the
 * "Build / Arrange" button opens the arrangement tab.
 */
export function LayoutSelectPane({
  project,
  layoutId,
  onAddPanel,
  onRemovePanel,
  onSetLayoutOptions,
  onMatchStyles,
  onAddImagePanel,
  onBuild,
  onSetLinked,
}: {
  project: Project;
  layoutId: NodeId;
  onAddPanel: (plotId: NodeId) => void;
  onRemovePanel: (plotId: NodeId) => void;
  onSetLayoutOptions?: (patch: Partial<FigureLayout>) => void;
  onMatchStyles?: ((plotIds: NodeId[], style: Partial<Plot>, keys: (keyof Plot)[]) => void) | undefined;
  /** Add a picture panel to this figure (undefined = not offered). */
  onAddImagePanel?: ((name: string, src: string, alt?: string | undefined, naturalW?: number | undefined, naturalH?: number | undefined) => void) | undefined;
  onBuild: () => void;
  /** Flip linked/independent (undefined = the chip is not offered). */
  onSetLinked?: ((linked: boolean) => void) | undefined;
}) {
  const [ownOnly, setOwnOnly] = useState(false);
  // Each card's preview shows the whole drawing, as the graph view does: the visible area grows to what is
  // drawn past the figure's edge (a heatmap's last rows, its colour bar), measured as the export measures it.
  const selectRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const grow = (): void => {
      selectRef.current?.querySelectorAll<HTMLElement>(".laycard-thumb[data-fig-w]").forEach((thumb) => {
        const svg = thumb.querySelector<SVGSVGElement>("svg.gfx-figure");
        if (svg) growFigureToDrawing(svg, Number(thumb.dataset.figW), Number(thumb.dataset.figH), 1);
      });
    };
    grow();
    const raf = requestAnimationFrame(grow);
    return () => cancelAnimationFrame(raf);
  });
  const layout = project.layouts?.find((l) => l.id === layoutId);
  if (!layout) return <p className="note">This figure no longer exists.</p>;
  // The selection page always operates on the source (original) graphs. When the
  // figure is unlinked, its panels are clones, so inclusion is resolved via panelSource.
  const includedSet = layout.linked === false
    ? new Set(Object.values(layout.panelSource ?? {}))
    : new Set(layout.panels);
  const included = (id: NodeId): boolean => includedSet.has(id);
  const panelPlots = layout.panels.map((id) => project.plots.find((p) => p.id === id)).filter(Boolean) as Plot[];
  const toggle = (id: NodeId): void => {
    if (included(id)) { onRemovePanel(id); return; }
    const ref = panelPlots[0]; // existing first panel = the auto-scale reference
    onAddPanel(id);
    if (layout.autoScale && onMatchStyles && ref && ref.id !== id) {
      onMatchStyles([id], capturePlotStyle(ref, MATCH_KEYS.all), MATCH_KEYS.all);
    }
  };
  const allGroups = groupPlotsForFigure(project, layout.id);
  // "This experiment only" — an option beside the whole-project default.
  // A view filter, off by default, session-only: cross-experiment stays the rule.
  // A group holding an already-included graph never hides — hiding one would make it
  // impossible to untick, which is a dead end the filter must not create.
  const groups = ownOnly ? allGroups.filter((g) => g.rank === 0 || g.plots.some((p) => included(p.id))) : allGroups;
  const sourceCount = groups.reduce((n, g) => n + g.plots.length, 0);
  return (
    <div className="layselect" ref={selectRef}>
      <div className="laypick layselect-bar">
        <span className="laypick-l">{includedSet.size} of {sourceCount} graph{sourceCount === 1 ? "" : "s"} selected</span>
        {/* The same state chip as the Arrange bar: picking graphs is exactly when you should
            know whether ticking one links the figure to it or copies it. */}
        {onSetLinked && <LinkStateChip linked={layout.linked !== false} onSetLinked={onSetLinked} />}
        {allGroups.length > 1 && allGroups.some((g) => g.rank === 0) && (
          <label className="laypick-l" style={{ display: "flex", alignItems: "center", gap: 6 }} title="Show only graphs filed in this figure's own experiment. Graphs already in the figure stay listed wherever they live.">
            <input type="checkbox" checked={ownOnly} onChange={(e) => setOwnOnly(e.target.checked)} />
            This experiment only
          </label>
        )}
        {/* States that the list is the whole project. `groupPlotsForFigure` lists every
            experiment, sorted with this figure's own first, but headings alone make a figure
            created inside an experiment read as if it were confined to it. Figures can be
            assembled from different experiments, and the docs say how. (Hidden while the
            filter narrows the list — it would be false.) */}
        {!ownOnly && groups.length > 1 && (
          <span className="note" data-cross-experiment-hint>
            Every graph in the project is listed — this figure&rsquo;s own experiment first. Tick any of them.
          </span>
        )}
        {onSetLayoutOptions && (
          <label className="laypick-l" style={{ display: "flex", alignItems: "center", gap: 6 }} title="Match each newly-included panel to the first panel's size/fonts/axes/colours">
            <input type="checkbox" checked={layout.autoScale ?? false} onChange={(e) => onSetLayoutOptions({ autoScale: e.target.checked || undefined })} />
            Auto-scale on include
          </label>
        )}
        {onAddImagePanel && <AddImageButton onAdd={onAddImagePanel} />}
        <span className="paneact-spacer" />
        <button className="addbtn" disabled={panelPlots.length === 0} title="Open the arrangement tab to lay these panels out" onClick={onBuild}>
          Build / Arrange →
        </button>
      </div>
      <div className="layselect-scroll">
        {sourceCount === 0 ? (
          <p className="note" style={{ marginTop: 14 }}>No graphs yet — make a graph first, then come back to assemble a figure.</p>
        ) : (
          groups.map((g, i) => {
            // Show the project header only when the project changes — groups are sorted
            // so a project's experiments are consecutive (one "Project 1", then E1, E2…).
            const showProject = i === 0 || groups[i - 1]!.project !== g.project;
            return (
            <div key={g.key} className="layselect-group">
              {showProject && <div className="layselect-projhd">{g.project ?? "Unfiled"}</div>}
              <div className="layselect-exphd">{g.experiment ?? "(no experiment)"}</div>
              <div className="laycards">
                {g.plots.map((p) => {
                  const table = project.tables.find((t) => t.id === p.source);
                  // Built at the graph's own size, as the gallery's cards are, and scaled to the card: at a
                  // thumbnail's size the graph's own type sizes do not fit (titles cut, heatmaps squashed).
                  const scene = table ? buildPlotScene(table, p, { measure: measureText, ...graphLayoutSize(p), ...scenePaletteOpt(p), tables: (id) => project.tables.find((t) => t.id === id), gradients: (id) => project.gradients?.find((gr) => gr.id === id) }) : null;
                  const on = included(p.id);
                  return (
                    <button key={p.id} type="button" className={`laycard${on ? " laycard-on" : ""}`} aria-pressed={on} title={`${on ? "Remove" : "Add"} “${p.name}”`} onClick={() => toggle(p.id)}>
                      <span className="laycard-thumb" data-fig-w={graphLayoutSize(p).width} data-fig-h={graphLayoutSize(p).height}>{scene ? <PlotFigure scene={scene} selected={null} zoom={1} /> : <span className="note">no data</span>}</span>
                      <span className="laycard-name">
                        <input type="checkbox" checked={on} readOnly tabIndex={-1} />
                        {p.name}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
            );
          })
        )}
      </div>
    </div>
  );
}

/** Full per-panel editing wiring for the arrange view — the selected panel becomes
 *  the active plot, so every callback (bound to it in AppShell) edits that panel.
 *  Mirrors PlotFigure's interactive callbacks so panels are fully editable. */
export interface PanelEditing {
  selection: GraphSelection;
  selectedPlot: NodeId | null;
  onSelectPanel: (plotId: NodeId) => void;
  /** Deselect the panel (a canvas object was picked). One selection at a time: the right panel shows the picked
   *  object's settings, never an object's on top of a graph's. */
  onClearPanel?: (() => void) | undefined;
  onSelect: (selection: GraphSelection) => void;
  /** Undefined on kinds with no width command — see `DocumentArea`'s note. */
  onWidthResize?: ((seriesId: NodeId, fraction: number) => void) | undefined;
  onMoveAnnotation: (id: NodeId, patch: { value?: number; x?: number; y?: number; bracketY?: number; bracketShift?: number; x2?: number; y2?: number; w?: number; h?: number; rotation?: number }) => void;
  onMoveRefLineLabel: (id: string, dx: number, dy: number) => void;
  onDeleteAnnotation: (id: NodeId) => void;
  onReorderAnnotation: (id: NodeId, to: "front" | "back") => void;
  onDuplicateAnnotation: (id: NodeId) => void;
  onFigureResize: (patch: { figureWidth?: number; figureHeight?: number }) => void;
  onEditText: (target: TextTarget, value: string) => void;
  onCreateTextBox: (xFrac: number, yFrac: number) => string | void;
  onAxisResize: (axis: "x" | "y", lengthPx: number) => void;
  onMoveTitle: (dx: number, dy: number) => void;
  onMoveSubtitle: (dx: number, dy: number) => void;
  onMoveLegend: (dx: number, dy: number) => void;
  onMoveSignificanceCaption: (dx: number, dy: number) => void;
  onMoveColorbar: (dx: number, dy: number) => void;
  onMoveWaffleCaption?: ((dx: number, dy: number) => void) | undefined;
  onMoveFitLabel: (dx: number, dy: number) => void;
  onMoveFitParams: (dx: number, dy: number) => void;
  onMoveFitParamLine: (key: string, dx: number, dy: number) => void;
  onMoveAxisTitle: (axis: "x" | "y" | "z" | "y2" | "y3", dx: number, dy: number) => void;
  onRotateAxisTitle?: ((axis: "y" | "y2" | "y3", angle: number) => void) | undefined;
  onMoveValueLabel: (columnId: NodeId, rowId: NodeId, dx: number, dy: number) => void;
  onMoveDirectLabel: (seriesId: NodeId, dx: number, dy: number) => void;
  onParallelEdit: (patch: Partial<NonNullable<Plot["parallel"]>>) => void;
  onCamera3D: (patch: { azimuth?: number; elevation?: number; zoom?: number }, gesture: string) => void;
}

// --- persistent panel groups — a movement bond, nothing more -----------

/** The next free group tag: grp-1, grp-2, … — deterministic, never colliding with a tag
 *  already in use (tags are opaque; only equality matters). */
export function nextPanelGroupTag(groups: Record<NodeId, string>): string {
  let max = 0;
  for (const tag of Object.values(groups)) {
    const m = /^grp-(\d+)$/.exec(tag);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `grp-${max + 1}`;
}

/** Expand a panel selection to whole groups — the keyboard nudge and the drag both move
 *  every member of any group the selection touches. */
export function withGroupMembers(layout: FigureLayout, ids: ReadonlySet<NodeId>): Set<NodeId> {
  const groups = layout.panelGroups ?? {};
  const tags = new Set([...ids].map((id) => groups[id]).filter((t): t is string => !!t));
  const out = new Set(ids);
  if (tags.size === 0) return out;
  for (const [id, tag] of Object.entries(groups)) if (tags.has(tag)) out.add(id);
  return out;
}

/** Positions patch for the dragged panel's group mates: every other unlocked member of its
 *  group translated by the same delta the drag applied ((fx,fy) − its old position).
 *  Empty for an ungrouped panel — the drag stays a solo move. */
export function groupDragPatch(
  layout: FigureLayout,
  draggedId: NodeId,
  fx: number,
  fy: number,
  posOf: (id: NodeId) => { x: number; y: number },
): Record<NodeId, { x: number; y: number }> {
  const tag = layout.panelGroups?.[draggedId];
  if (!tag) return {};
  const from = posOf(draggedId);
  const dx = fx - from.x;
  const dy = fy - from.y;
  const out: Record<NodeId, { x: number; y: number }> = {};
  for (const [id, t] of Object.entries(layout.panelGroups ?? {})) {
    if (t !== tag || id === draggedId) continue;
    if (layout.panelLocked?.[id]) continue; // the lock outranks the group
    if (!layout.panels.includes(id)) continue; // a stale entry for a removed panel
    const p = posOf(id);
    out[id] = { x: Math.max(0, p.x + dx), y: Math.max(0, p.y + dy) };
  }
  return out;
}

/** Default geometry (canvas px, centred on `cx`/`cy`) for a newly-inserted figure object —
 *  the assembler's Insert group. Sizes echo the graph ribbon's fractional defaults at a
 *  typical canvas scale, and every kind starts fully visible so nothing lands off-page. */
export function figureAnnotationDefaults(
  kind: "text" | "arrow" | "segment" | "rect" | "ellipse",
  cx: number,
  cy: number,
): Omit<Annotation, "id"> {
  switch (kind) {
    case "text":
      return { kind, label: "Text", x: cx, y: cy, size: 15 };
    case "arrow":
    case "segment":
      return { kind, x: cx - 70, y: cy, x2: cx + 70, y2: cy };
    case "rect":
    case "ellipse":
      return { kind, x: cx - 80, y: cy - 50, w: 160, h: 100 };
  }
}

/**
 * The figure-annotation overlay: text / arrows / lines / boxes / ellipses
 * drawn on the assembler canvas, between and across panels. One canvas-spanning `<svg>` on
 * top of the panel cards, rendering the same `AnnotationsLayer` every graph uses — select,
 * drag, resize, rotate, inline-edit and × all come from that shared layer. Objects store
 * canvas px ([[FigureLayout.figureAnnotations]]); the layer works in fractions of the rect
 * it is given, so the move/resize patches convert back to px here at the boundary.
 *
 * Export: `composeActiveFigureSvg` reads this element (`svg.layannot`) from the DOM and
 * hands it to `composeFigureSvg` to paint on top of the panels — what you arrange is what
 * exports.
 */
function LayoutAnnotations({
  annotations,
  w,
  h,
  selectedId,
  onSelect,
  onMove,
  onUpdate,
  onRemove,
}: {
  annotations: Annotation[];
  /** Canvas box (logical px — the same space as panelPositions). */
  w: number;
  h: number;
  selectedId: NodeId | null;
  onSelect: (id: NodeId | null) => void;
  onMove?: ((id: NodeId, patch: Partial<Pick<Annotation, "x" | "y" | "x2" | "y2" | "w" | "h" | "rotation">>) => void) | undefined;
  onUpdate?: ((id: NodeId, patch: Partial<Omit<Annotation, "id" | "kind">>) => void) | undefined;
  onRemove?: ((id: NodeId) => void) | undefined;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [edit, setEdit] = useState<{ id: string; value: string } | null>(null);
  const warnings: string[] = [];
  const scenes = resolveFigureAnnotations(annotations, warnings);
  const boxW = w || 1;
  const boxH = h || 1;
  /** Fraction-of-canvas patch (what the shared layer emits) → the stored canvas px. */
  const toPx = (p: AnnotationMovePatch): Partial<Pick<Annotation, "x" | "y" | "x2" | "y2" | "w" | "h" | "rotation">> => ({
    ...(p.x !== undefined ? { x: p.x * boxW } : {}),
    ...(p.y !== undefined ? { y: p.y * boxH } : {}),
    ...(p.x2 !== undefined ? { x2: p.x2 * boxW } : {}),
    ...(p.y2 !== undefined ? { y2: p.y2 * boxH } : {}),
    ...(p.w !== undefined ? { w: p.w * boxW } : {}),
    ...(p.h !== undefined ? { h: p.h * boxH } : {}),
    ...(p.rotation !== undefined ? { rotation: p.rotation } : {}),
  });
  const editingScene = edit ? scenes.find((a) => a.id === edit.id) : null;
  const commitEdit = (): void => {
    if (!edit) return;
    const value = edit.value;
    setEdit(null);
    if (value.trim() === "") onRemove?.(edit.id); // an emptied text box is a deletion, like on a graph
    else onUpdate?.(edit.id, { label: value });
  };
  return (
    <>
      <svg
        ref={svgRef}
        className="layannot"
        width={boxW}
        height={boxH}
        viewBox={`0 0 ${boxW} ${boxH}`}
        overflow="visible"
        aria-label="Figure objects"
      >
        <AnnotationsLayer
          annotations={scenes}
          selected={selectedId ? { kind: "annotation", id: selectedId } : undefined}
          plot={{ x: 0, y: 0, width: boxW, height: boxH }}
          legendFont={13}
          accent="var(--accent)"
          onSelect={(s) => onSelect(s?.kind === "annotation" ? s.id : null)}
          onMoveAnnotation={onMove ? (id, patch) => onMove(id, toPx(patch)) : undefined}
          onDeleteAnnotation={onRemove}
          clientToUser={clientToUserOf(svgRef)}
          patch={(_a, ux, uy) => ({ x: ux / boxW, y: uy / boxH })}
          beginEdit={(e, target, value) => {
            e.stopPropagation();
            setEdit({ id: target.kind === "annotation" ? target.id : "", value });
          }}
          editingText={(target) => target.kind === "annotation" && target.id === edit?.id}
          onEditText={onUpdate ? (target, value) => { if (target.kind === "annotation") onUpdate(target.id, { label: value }); } : undefined}
        />
      </svg>
      {edit && editingScene && (
        <textarea
          className="layannot-editor"
          style={{
            position: "absolute",
            left: (editingScene.labelX ?? 0) - 80,
            top: (editingScene.labelY ?? 0) - (editingScene.fontSize ?? 13),
            width: 160,
            fontSize: editingScene.fontSize ?? 13,
          }}
          value={edit.value}
          autoFocus
          onFocus={(e) => e.target.select()}
          onChange={(e) => setEdit({ id: edit.id, value: e.target.value })}
          onBlur={commitEdit}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); commitEdit(); }
            if (e.key === "Escape") { e.stopPropagation(); setEdit(null); }
          }}
        />
      )}
    </>
  );
}

/**
 * Panel-builder page (the dedicated full-area view opened from the tree). It is a
 * self-contained workspace with its own local tab strip — a "Choose graphs"
 * selection tab plus an "Arrange" tab that "Build / Arrange" opens here on
 * the same page (not in the global document tab rail).
 */
export function PanelBuilderView({
  project,
  layoutId,
  onAddPanel,
  onRemovePanel,
  onDuplicatePanel,
  onSetLayoutOptions,
  onMatchStyles,
  onPatchPanels,
  onApplyPanelPreset,
  onAddImagePanel,
  onOpenPlot,
  onExport,
  onClose,
  onSetLinked,
  onAddFigureAnnotation,
  onMoveFigureAnnotation,
  onUpdateFigureAnnotation,
  onRemoveFigureAnnotation,
  editing,
  inspectorSlot,
  viewZoom,
  onViewZoom,
  onZoomWheel,
  onArrangeShown,
  startArranged = false,
}: {
  project: Project;
  layoutId: NodeId;
  /** Open on the Arrange tab (a figure the program built, e.g. by Split into small graphs). */
  startArranged?: boolean | undefined;
  onAddPanel: (plotId: NodeId) => void;
  onRemovePanel: (plotId: NodeId) => void;
  /** Duplicate a panel in place (undefined = not offered). */
  onDuplicatePanel?: ((plotId: NodeId) => void) | undefined;
  onSetLayoutOptions: (patch: Partial<FigureLayout>) => void;
  onMatchStyles?: ((plotIds: NodeId[], style: Partial<Plot>, keys: (keyof Plot)[]) => void) | undefined;
  /** Per-panel patches (the kind-specific half of a fonts match). */
  onPatchPanels?: ((patches: Array<{ id: NodeId; patch: Partial<Plot> }>) => void) | undefined;
  /** Restyle every graph panel with a built-in style preset (kind defaults included). */
  onApplyPanelPreset?: ((plotIds: NodeId[], preset: StylePreset) => void) | undefined;
  /** Add a picture panel to this figure (undefined = not offered). */
  onAddImagePanel?: ((name: string, src: string, alt?: string | undefined, naturalW?: number | undefined, naturalH?: number | undefined) => void) | undefined;
  onOpenPlot: (plotId: NodeId) => void;
  onExport?: (() => void) | undefined;
  onClose: () => void;
  onSetLinked?: ((linked: boolean) => void) | undefined;
  /** Figure objects (text/arrow/line/box/ellipse on the canvas) — see [[LayoutPane]]. */
  onAddFigureAnnotation?: ((ann: Omit<Annotation, "id">) => Annotation | void) | undefined;
  onMoveFigureAnnotation?: ((id: NodeId, patch: Partial<Pick<Annotation, "x" | "y" | "x2" | "y2" | "w" | "h" | "rotation">>) => void) | undefined;
  onUpdateFigureAnnotation?: ((id: NodeId, patch: Partial<Omit<Annotation, "id" | "kind">>) => void) | undefined;
  onRemoveFigureAnnotation?: ((id: NodeId) => void) | undefined;
  editing?: PanelEditing | undefined;
  /** Where the selection's settings go — the top of the Inspector (see LayoutPaneContent's `inspectorSlot`). */
  inspectorSlot?: HTMLElement | null | undefined;
  /** The figure's view zoom, shared with the status bar (see LayoutPaneContent's `viewZoom`). */
  viewZoom?: number | undefined;
  onViewZoom?: ((z: number) => void) | undefined;
  /** Ctrl+wheel over the figure page → that same zoom (the status bar says "Ctrl+scroll"). */
  onZoomWheel?: ((deltaY: number) => void) | undefined;
  /** The Arrange tab has just come into view (AppShell opens the Inspector — see the effect below). */
  onArrangeShown?: (() => void) | undefined;
}) {
  const layout = project.layouts?.find((l) => l.id === layoutId);
  // A figure that already has panels exposes its Arrange tab immediately (no need to
  // re-click Build); empty figures start on selection only.
  const hasPanels = (layout?.panels.length ?? 0) > 0;
  const [tab, setTab] = useState<"select" | "arrange">(startArranged ? "arrange" : "select");
  const [arrangeOpened, setArrangeOpened] = useState(hasPanels);
  const bodyRef = useRef<HTMLDivElement>(null);
  useCtrlWheelZoom(bodyRef, onZoomWheel);
  // A figure the program just built (Graph ▸ Split into small graphs) has nothing left to choose:
  // show it arranged. The page is reused across figures, so follow the figure id too.
  useEffect(() => {
    if (startArranged) { setArrangeOpened(true); setTab("arrange"); }
  }, [layoutId, startArranged]);
  // Arriving at Arrange opens the Inspector: the figure's own settings and the picked object's live
  // there, as a graph's do — so arriving opens it, the rule AppShell already applies on
  // arriving at a graph. Keyed on the arrival (this tab, this figure), never on a re-render: collapsing it while
  // working here sticks. The Choose graphs tab has nothing for it and leaves it alone.
  useEffect(() => {
    if (tab === "arrange") onArrangeShown?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, layoutId]);
  if (!layout) return <p className="note" style={{ padding: 12 }}>This figure no longer exists.</p>;
  const openArrange = (): void => { setArrangeOpened(true); setTab("arrange"); };
  return (
    <div className="layoutview">
      <div className="layoutview-bar">
        <button className="btn-mini" title="Back to the document" onClick={onClose}>← Back</button>
        <span className="layoutview-title">{layout.name}</span>
        <div className="layoutview-tabs">
          <button className={`layoutview-tab${tab === "select" ? " on" : ""}`} onClick={() => setTab("select")}>Choose graphs</button>
          {arrangeOpened && (
            <button className={`layoutview-tab${tab === "arrange" ? " on" : ""}`} onClick={() => setTab("arrange")}>Arrange</button>
          )}
        </div>
      </div>
      <div className="layoutview-body" ref={bodyRef}>
        {tab === "select" ? (
          <LayoutSelectPane
            project={project}
            layoutId={layout.id}
            onAddPanel={onAddPanel}
            onRemovePanel={onRemovePanel}
            onSetLayoutOptions={onSetLayoutOptions}
            onMatchStyles={onMatchStyles}
            onAddImagePanel={onAddImagePanel}
            onBuild={openArrange}
            onSetLinked={onSetLinked}
          />
        ) : (
          <LayoutPane
            project={project}
            layoutId={layout.id}
            onRemovePanel={onRemovePanel}
            onDuplicatePanel={onDuplicatePanel}
            onOpenPlot={onOpenPlot}
            onSetLayoutOptions={onSetLayoutOptions}
            onMatchStyles={onMatchStyles}
            onPatchPanels={onPatchPanels}
            onApplyPanelPreset={onApplyPanelPreset}
            onAddImagePanel={onAddImagePanel}
            onAddPanel={onAddPanel}
            onExport={onExport}
            onSetLinked={onSetLinked}
            onAddFigureAnnotation={onAddFigureAnnotation}
            onMoveFigureAnnotation={onMoveFigureAnnotation}
            onUpdateFigureAnnotation={onUpdateFigureAnnotation}
            onRemoveFigureAnnotation={onRemoveFigureAnnotation}
            editing={editing}
            inspectorSlot={inspectorSlot}
            viewZoom={viewZoom}
            onViewZoom={onViewZoom}
          />
        )}
      </div>
    </div>
  );
}

/**
 * Pointer "slop" (px) a press may travel before a panel gesture counts as a drag rather than a
 * click. A panel is draggable anywhere on its body — including over its graph's own clickable
 * elements — so this threshold is also the click/drag arbiter for those elements. At a small
 * value such as 4px, an ordinary click on a small target (e.g. a clipped category label on a
 * lollipop) jitters past it: the gesture becomes a micro-drag that commits a tiny move and installs a
 * capture-phase click-swallower, eating the label's own click — the panel is selected
 * ({kind:"plot"}, the Chart tab) but the label's text/font tab does not open.
 * 8px tolerates hand jitter on a precise click while a real drag still arms cleanly.
 */
const PANEL_DRAG_SLOP = 8;

/** A rubber-band rectangle on the canvas, canvas px, any corner order. */
export interface MarqueeRect { x0: number; y0: number; x1: number; y1: number }
/** The ids of the boxes a marquee touches (any overlap, edges included). Pure — LayoutPane.marquee.test.tsx. */
export function marqueeHits(r: MarqueeRect, boxes: ReadonlyArray<{ id: string; left: number; top: number; w: number; h: number }>): string[] {
  const l = Math.min(r.x0, r.x1), t = Math.min(r.y0, r.y1), rr = Math.max(r.x0, r.x1), b = Math.max(r.y0, r.y1);
  return boxes.filter((k) => k.left <= rr && k.left + k.w >= l && k.top <= b && k.top + k.h >= t).map((k) => k.id);
}
/** Has a panel press travelled far enough (Euclidean px) to count as a drag rather than a click?
 *  Pure so the click/drag boundary is unit-testable — jsdom has no layout to drive the real drag. */
export function exceedsPanelDragSlop(dx: number, dy: number): boolean {
  return dx * dx + dy * dy >= PANEL_DRAG_SLOP * PANEL_DRAG_SLOP;
}

export function LayoutPane(props: Parameters<typeof LayoutPaneContent>[0]) {
  if (!(props.project.layouts?.find(l => l.id === props.layoutId) ?? props.project.layouts?.[0]))
    return <p className="note">No layout yet — use “New layout” to create one.</p>;
  return <LayoutPaneContent {...props} />;
}

function LayoutPaneContent({
  project,
  layoutId,
  onRemovePanel,
  onOpenPlot,
  onSetLayoutOptions,
  onMatchStyles,
  onPatchPanels,
  onApplyPanelPreset,
  onAddImagePanel,
  onExport,
  onAddPanel,
  onDuplicatePanel,
  onSetLinked,
  onAddFigureAnnotation,
  onMoveFigureAnnotation,
  onUpdateFigureAnnotation,
  onRemoveFigureAnnotation,
  editing,
  inspectorSlot,
  viewZoom: viewZoomProp,
  onViewZoom,
}: {
  project: Project;
  layoutId?: NodeId | undefined;
  onRemovePanel: (plotId: NodeId) => void;
  onOpenPlot: (plotId: NodeId) => void;
  onSetLayoutOptions?: ((patch: Partial<FigureLayout>) => void) | undefined;
  onMatchStyles?: ((plotIds: NodeId[], style: Partial<Plot>, keys: (keyof Plot)[]) => void) | undefined;
  /** Per-panel patches (the kind-specific half of a fonts match — see kindFontMatchPatch). */
  onPatchPanels?: ((patches: Array<{ id: NodeId; patch: Partial<Plot> }>) => void) | undefined;
  /** Restyle every graph panel with a built-in style preset (kind defaults included). */
  onApplyPanelPreset?: ((plotIds: NodeId[], preset: StylePreset) => void) | undefined;
  /** Add a picture panel to this figure (undefined = not offered). */
  onAddImagePanel?: ((name: string, src: string, alt?: string | undefined, naturalW?: number | undefined, naturalH?: number | undefined) => void) | undefined;
  onExport?: (() => void) | undefined;
  /** Add a graph to this figure from the arrange view (no round trip to Choose graphs). */
  onAddPanel?: ((plotId: NodeId) => void) | undefined;
  /** Duplicate a panel in place (the copy lands offset below-right, painted on top). */
  onDuplicatePanel?: ((plotId: NodeId) => void) | undefined;
  /** Link / unlink the figure from its source graphs (independent clones when off). */
  onSetLinked?: ((linked: boolean) => void) | undefined;
  /** Figure objects: Insert-group add — text/arrow/line/box/ellipse on the
   *  canvas, in canvas px. Returns the created object so it can be selected for editing.
   *  All four callbacks absent = the Insert group is not offered. */
  onAddFigureAnnotation?: ((ann: Omit<Annotation, "id">) => Annotation | void) | undefined;
  /** Drag-move/resize a figure object (canvas px; coalesced to one undo per drag upstream). */
  onMoveFigureAnnotation?: ((id: NodeId, patch: Partial<Pick<Annotation, "x" | "y" | "x2" | "y2" | "w" | "h" | "rotation">>) => void) | undefined;
  /** Restyle / relabel a figure object (colour, width, dash, text …). */
  onUpdateFigureAnnotation?: ((id: NodeId, patch: Partial<Omit<Annotation, "id" | "kind">>) => void) | undefined;
  /** Delete a figure object (× handle / Delete key). */
  onRemoveFigureAnnotation?: ((id: NodeId) => void) | undefined;
  /** Per-panel editing wiring — makes every panel fully selectable + editable. */
  editing?: PanelEditing | undefined;
  /**
   * The selection's settings go to the Inspector.
   * A picked canvas object's settings and the
   * X / Y / W / H of a picked object or panel are drawn at the top of the Inspector, where every graph element's
   * settings already live — so the toolbar never grows when something is clicked and the canvas never jumps.
   * The same controls and handlers as in the toolbar (`figure-controls.census.test` holds them to it).
   * Absent (the Inspector is collapsed, an export stage, a test) → they stay in the toolbar: never lost.
   */
  inspectorSlot?: HTMLElement | null | undefined;
  /**
   * One zoom for the figure: given, the canvas zoom is the app's — the
   * status bar, Ctrl + / − / 0 and the toolbar's slider all show and set this one value. Absent (an export stage, a test)
   * the page keeps its own.
   */
  viewZoom?: number | undefined;
  onViewZoom?: ((z: number) => void) | undefined;
}) {
  const rawLayout = (project.layouts?.find((l) => l.id === layoutId) ?? project.layouts?.[0])!;
  // --- manual-nudge freeze -------------------------------------------------
  // When the user hand-drags or resizes one panel while an automated-alignment mode
  // (Align X/Y, Uniform row/col) is on, we freeze the currently-rendered geometry of
  // every panel and locally render as free-drag seeded with it, so nothing jumps. The
  // commit (one undo entry) writes the same snapshot + the single change, then this
  // local state is cleared. While null it has no effect.
  const [freeze, setFreeze] = useState<
    { pos: Record<NodeId, { x: number; y: number }>; size: Record<NodeId, { w: number; h: number }>; card: Record<NodeId, { w: number; h: number }> } | null
  >(null);
  // The measuring ruler's unit (px / inch / cm) — the same app-wide preference the graph ruler
  // uses, so a change in one place is reflected in both.
  const rulerUnit = useRulerUnitPref();
  // View zoom for the whole assembler canvas (1 = 100%). A pure view scale: the stored layout
  // (positions/sizes in logical px) is untouched — only the canvas is drawn scaled. The panels'
  // own editing stays correct because PlotFigure maps pointers through getScreenCTM (transform-
  // aware); only the assembler-level HTML drag handlers divide their screen deltas by `viewZoom`.
  const [ownZoom, setOwnZoom] = useState(1);
  const viewZoom = viewZoomProp ?? ownZoom;
  const setViewZoom = onViewZoom ?? setOwnZoom;
  // Note: `freeze` is cleared deterministically at the end of the gesture (in the drag /
  // resize pointer-up + pointer-cancel handlers), not via an effect. `doc.toJSON()` returns
  // the same project object mutated in place, so `rawLayout`'s identity is stable across
  // renders — an identity-keyed effect would never re-fire after an in-place commit and the
  // freeze would get stuck on (masking the real layout: align boxes un-re-tickable, resizes
  // reverting). The commit mutates `rawLayout` synchronously before the next render, so
  // clearing inline shows the committed free-drag view with no flash.
  const layout: FigureLayout = freeze
    ? {
        ...rawLayout,
        freeform: true,
        alignX: undefined,
        alignY: undefined,
        uniformRowHeight: undefined,
        uniformColumnWidth: undefined,
        panelPositions: freeze.pos,
        panelSizes: freeze.size,
        // Cards pinned at their frozen boxes so nothing visually moves during the gesture
        // (the graph being resized changes only inside its pinned card).
        cardSizes: freeze.card,
      }
    : rawLayout;
  const panelPlots = layout.panels
    .map((id) => project.plots.find((p) => p.id === id))
    .filter((p): p is Plot => Boolean(p));
  const lettering = layout.lettering ?? "upper";
  /** The letter the scheme generates for panel position `i` ("" when lettering is off). */
  const schemeLetter = (i: number): string =>
    lettering === "none" ? "" : lettering === "numeric" ? String(i + 1) : String.fromCharCode((lettering === "lower" ? 97 : 65) + i);
  /** The letter a panel actually shows: its custom text if it has been edited, else the
   *  scheme's. Unedited labels keep re-lettering themselves when panels are reordered. */
  const letterOf = (id: NodeId, i: number): string => {
    if (lettering === "none") return "";
    const custom = layout.letterText?.[id];
    return custom != null ? custom : schemeLetter(i);
  };
  /** Draft (or close) a caption + alt-text for the whole figure — every panel described in
   *  its own clause under the letter it actually shows. Opt-in; nothing is auto-inserted. */
  const toggleCaption = (): void => {
    if (captionText !== null) {
      setCaptionText(null);
      return;
    }
    const panels: CaptionPanel[] = panelPlots.map((p, i) => {
      // Fold in the most recent linked analysis's headline statistic, when there is one —
      // the caption never invents a number that wasn't computed.
      const linked = [...project.analyses].reverse().find((a) => a.source === p.source && a.result && keyMetricLine(a.result));
      const statLine = linked?.result ? keyMetricLine(linked.result) : "";
      return {
        plot: p,
        table: project.tables.find((t) => t.id === p.source),
        letter: letterOf(p.id, i),
        ...(statLine ? { statLine } : {}),
      };
    });
    const idx = (project.layouts ?? []).findIndex((l) => l.id === layout.id);
    setCaptionText(figureTextBlock(multiPanelCaption(layout.name, panels, idx >= 0 ? { index: idx + 1 } : {})));
  };
  const copyCaption = (): void => {
    if (captionText == null) return;
    void navigator.clipboard.writeText(captionText).then(() => {
      setCaptionCopied(true);
      window.setTimeout(() => setCaptionCopied(false), 1500);
    });
  };
  // Per-figure display options — both default off: a multi-panel figure reads by its A/B/C
  // letters, so neither the in-graph title nor the editing-only card name shows by default.
  const showTitles = layout.showPanelTitles ?? false;
  const showNames = layout.showPanelNames ?? false;
  // Fully customizable A/B/C panel-letter typography (family / size / weight / colour).
  const letterStyle: React.CSSProperties = {
    ...(layout.letterFont ? { fontFamily: layout.letterFont } : {}),
    ...(layout.letterSize ? { fontSize: layout.letterSize } : {}),
    ...(layout.letterBold === false ? { fontWeight: 400 } : {}),
    ...(layout.letterColor ? { color: layout.letterColor } : {}),
  };
  const freeform = layout.freeform ?? true; // free-drag is the default arrange mode
  // Axis auto-alignment (X and/or Y, independent). Either one switches the figure to a
  // computed aligned grid (overrides free-drag); free-drag is the manual alternative.
  const alignX = (layout.alignX ?? false) && !freeform;
  const alignY = (layout.alignY ?? false) && !freeform;
  // Uniform sizing: make every graph in a detected row share its height / column its width.
  const uRow = (layout.uniformRowHeight ?? false) && !freeform;
  const uCol = (layout.uniformColumnWidth ?? false) && !freeform;
  // Shared-axis labelling needs a detected grid to know which panel is on which edge, so it
  // is a grid-mode feature like the align toggles.
  const sharedAxisLabels = (layout.sharedAxisLabels ?? false) && !freeform;
  // A card can't have both a fixed data-rect length and a fixed total size on one axis, so
  // uniform sizing supersedes axis-align on the same axis (turning it on asks for equal card
  // sizes). The other axis's align is untouched. `alignX/alignY` (raw) still drive the UI.
  const alignXeff = alignX && !uCol;
  const alignYeff = alignY && !uRow;
  const aligned = alignXeff || alignYeff; // effective axis-align used by the layout math
  const gridMode = aligned || uRow || uCol; // computed-grid layout (vs free-drag)
  const labelAlignX = layout.labelAlignX ?? false; // "Align ↔": each column's labels share one X position
  const labelAlignY = layout.labelAlignY ?? false; // "Align ↕": each row's labels share one Y position
  // "Align all" master state: every alignment (X + Y axes, ↕ + ↔ labels) engaged.
  const allAligned = alignX && alignY && labelAlignX && labelAlignY;
  /** "Centre no-axis" (Align ▾): a graph with no axes keeps its own width and sits centred
   *  in its column — not widened to it — its letter with it. Only in an aligned grid; axis graphs untouched. */
  const centredNoAxis = (p: Plot): boolean => (layout.centreNoAxisPanels ?? false) && aligned && alignsByFootprint(p);
  /** The design width a centred no-axis graph needs at design height `h`: at least a square plot area plus its own
   *  side margins and legend (a round treemap / pie / Venn then fills the height), and its natural proportions
   *  where those are wider (a network, an alluvial). Measured on its current drawing (keeping the plain
   *  aspect can give a 198 px-wide plot beside a 124 px legend — a smaller disc and lost cell labels). */
  const ownWidthAt = (sc: { width: number; height: number; plot: { width: number; height: number } }, h: number): number => {
    const plotH = h - (sc.height - sc.plot.height);
    return Math.max(60, plotH + (sc.width - sc.plot.width), (h * sc.width) / Math.max(1, sc.height));
  };
  const layoutCols = layout.columns ?? 2;
  const gutter = layout.gutter ?? DEFAULT_FIGURE_GUTTER;
  // Grid + ruler assist overlays are on by default (undefined → true). Their toggles store an
  // explicit boolean so unticking persists (a `|| undefined` clear would spring back to on).
  const showGrid = layout.showGrid ?? true;
  const showRuler = layout.showRuler ?? true;
  // The A/B/C label is a draggable overlay (LABEL_DEFAULT), not a header row, so the
  // header band only exists when card titles are shown. Less wasted background.
  const headerShown = showNames;
  const headerOff = CARD_PAD + (headerShown ? 22 : 0);
  // --- interaction state: free-drag + per-panel resize ---
  const canvasRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ id: NodeId; x: number; y: number; ox?: number | undefined; oy?: number | undefined; vx?: number | undefined; hy?: number | undefined; vxAxis?: boolean; hyAxis?: boolean } | null>(null);
  const dragRef = useRef<{ id: NodeId; sx: number; sy: number; ox: number; oy: number; w: number; h: number; others: { left: number; top: number; w: number; h: number; axis?: AxisOffsets | undefined }[]; myAxis?: AxisOffsets | undefined; cw: number; ch: number; curX: number; curY: number } | null>(null);
  const [resize, setResize] = useState<{ id: NodeId; w: number; h: number } | null>(null);
  const resizeRef = useRef<{ id: NodeId; sx: number; sy: number; w0: number; h0: number; cw: number; ch: number } | null>(null);
  // Live card-edge resize (two-level resize): the card's outer box while its edge is dragged.
  const [cardResize, setCardResize] = useState<{ id: NodeId; w: number; h: number } | null>(null);
  const [matchRef, setMatchRef] = useState<NodeId | null>(null);
  // Multi-panel selection for the Arrange toolbar (align / distribute / equalise
  // panels on the page — the magnetic-alignment feature). Shift-click a panel
  // to add/remove; a plain click clears it back to single-edit. Local (not persisted).
  const [arrangeSel, setArrangeSel] = useState<Set<NodeId>>(new Set());
  // The selected figure object (text/arrow/box on the canvas) — one selection at a time
  // across both worlds: picking an object clears the panel selection, and vice versa.
  const [annSel, setAnnSel] = useState<NodeId | null>(null);
  // The size fields' "Lock aspect" tick (a view aid, not stored). Forced on under Keep
  // proportions, where the graph is one uniform scale and W/H cannot move apart.
  const [lockAspect, setLockAspect] = useState(false);
  // Colour-vision preview: a filter on the canvas wrapper (never on a panel's svg — the export
  // reads those), so every panel previews at once and no file can carry it.
  const colorVision = useColorVisionPref();
  const cvdStyle = colorVision.value !== "off" ? { filter: colorVisionFilter(colorVision.value) } : {};
  // Marquee (rubber-band) selection on empty canvas: live rectangle while dragging, null otherwise.
  const [marquee, setMarquee] = useState<MarqueeRect | null>(null);
  // A guide being dragged (out of a ruler, or an existing one moved): its live line.
  const [guideDrag, setGuideDrag] = useState<{ axis: "v" | "h"; idx?: number | undefined; pos: number } | null>(null);
  // Ctrl+A / Ctrl+D on the canvas reach the latest closures through refs, like the arrow nudge.
  const selectAllRef = useRef<() => boolean>(() => false);
  const duplicateRef = useRef<() => boolean>(() => false);
  // The flow-grid (non-absolute) canvas box, measured so the annotation overlay knows its
  // coordinate space there too — the absolute branch knows canvasSize already. RO-guarded:
  // jsdom has no ResizeObserver, and there the one-shot offset measure is enough.
  const flowGridRef = useRef<HTMLDivElement>(null);
  const [flowBox, setFlowBox] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  useEffect(() => {
    const el = flowGridRef.current;
    if (!el) return;
    const measure = (): void => setFlowBox((prev) => {
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      return prev.w === w && prev.h === h ? prev : { w, h };
    });
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  });
  const figureAnns = layout.figureAnnotations ?? [];
  const selectedAnn = annSel ? figureAnns.find((a) => a.id === annSel) ?? null : null;
  const selectAnn = (id: NodeId | null): void => {
    setAnnSel(id);
    if (id) { setArrangeSel(new Set()); editing?.onClearPanel?.(); }
  };
  // Delete/Backspace removes the selected object (locked ones stay); Escape deselects;
  // arrows nudge 1px (Shift = 10) — the same keyboard the panels answer to.
  useEffect(() => {
    if (!annSel) return;
    const onKey = (e: KeyboardEvent): void => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      const ann = (layout.figureAnnotations ?? []).find((a) => a.id === annSel);
      if (!ann) return;
      if ((e.key === "Delete" || e.key === "Backspace") && onRemoveFigureAnnotation && !ann.locked) {
        e.preventDefault();
        setAnnSel(null);
        onRemoveFigureAnnotation(annSel);
        return;
      }
      if (e.key === "Escape") { setAnnSel(null); return; }
      if (onMoveFigureAnnotation && !ann.locked && (e.key === "ArrowLeft" || e.key === "ArrowRight" || e.key === "ArrowUp" || e.key === "ArrowDown")) {
        e.preventDefault();
        const d = e.shiftKey ? 10 : 1;
        const dx = e.key === "ArrowLeft" ? -d : e.key === "ArrowRight" ? d : 0;
        const dy = e.key === "ArrowUp" ? -d : e.key === "ArrowDown" ? d : 0;
        onMoveFigureAnnotation(annSel, {
          ...(ann.x != null ? { x: ann.x + dx } : {}),
          ...(ann.y != null ? { y: ann.y + dy } : {}),
          ...(ann.x2 != null ? { x2: ann.x2 + dx } : {}),
          ...(ann.y2 != null ? { y2: ann.y2 + dy } : {}),
        });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [annSel, layout.figureAnnotations, onRemoveFigureAnnotation, onMoveFigureAnnotation]);
  /** Graphs that could still be added to this figure — the same set the Choose-graphs step
   *  offers, minus the ones already in. Inclusion resolves through `panelSource` exactly as
   *  that step does, so an unlinked figure (whose panels are clones) never offers a graph
   *  it already holds a copy of. */
  const includedIds = layout.linked === false
    ? new Set(Object.values(layout.panelSource ?? {}))
    : new Set(layout.panels);
  const addable = groupPlotsForFigure(project, layout.id)
    .flatMap((g) => g.plots)
    .filter((p) => !includedIds.has(p.id));
  const togglePanelSel = (id: NodeId): void => {
    setAnnSel(null); // picking a panel leaves the figure-object selection
    setArrangeSel((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  // How many of the current panels are in the Arrange selection (gates the toolbar).
  const nArrSel = panelPlots.filter((p) => arrangeSel.has(p.id)).length;
  /** Is this panel's layout locked (no drag / resize / nudge / arrange / remove)? */
  const lockedOf = (id: NodeId): boolean => !!layout.panelLocked?.[id];
  /** The panels the object tools (front/back, centre, lock, duplicate) act on: the
   *  shift-selection when there is one, else the single click-selected panel. */
  const actIds = (): NodeId[] =>
    nArrSel >= 1
      ? panelPlots.filter((p) => arrangeSel.has(p.id)).map((p) => p.id)
      : editing?.selectedPlot && panelPlots.some((p) => p.id === editing.selectedPlot)
        ? [editing.selectedPlot]
        : [];
  // How many selected panels the align tools can actually move (locked ones won't budge).
  const nArrMovable = panelPlots.filter((p) => arrangeSel.has(p.id) && !lockedOf(p.id)).length;
  // Draggable A/B/C label: live drag state + the container-relative guide lines.
  const [labelDrag, setLabelDrag] = useState<{ id: NodeId; x: number; y: number; gx?: number | undefined; gy?: number | undefined } | null>(null);
  // Saved figure templates (house styles). Kept in state so the picker refreshes the moment
  // one is saved or deleted — the store itself is synchronous localStorage + a file mirror.
  const [figTemplates, setFigTemplates] = useState(() => listFigureTemplates());
  /** Name being typed for a new template; null = the Save form is closed. */
  const [templateName, setTemplateName] = useState<string | null>(null);
  /** Panel label being retyped (double-click), with its in-progress text. null = none. */
  const [editLetter, setEditLetter] = useState<{ id: NodeId; text: string } | null>(null);
  /** The layout-preset picker popover (the table-format-style chooser). */
  const [presetOpen, setPresetOpen] = useState(false);
  // Drafted whole-figure caption + alt-text (opt-in; null = panel closed).
  const [captionText, setCaptionText] = useState<string | null>(null);
  const [captionCopied, setCaptionCopied] = useState(false);
  const labelDragRef = useRef<{ id: NodeId; sx: number; sy: number; ox: number; oy: number; w: number; h: number; sl: number; st: number; cl: number; ct: number; others: { cx: number; cy: number }[]; curX: number; curY: number } | null>(null);
  const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));
  const sizeOf = (id: NodeId): { w: number; h: number } => layout.panelSizes?.[id] ?? { w: DEFAULT_SCENE_W, h: DEFAULT_SCENE_H };
  // Column spanning needs a grid and a known column count to be a fraction of. In free-drag
  // you size a panel by dragging it, and with auto-fill columns "span 2 of ?" is undefined.
  const spanEnabled = !freeform && (layout.columns ?? 0) >= 2;
  /** How many columns a panel spans (always 1 unless spanning is available + set). */
  const spanOf = (id: NodeId): number =>
    spanEnabled ? clamp(Math.round(layout.panelSpan?.[id] ?? 1), 1, layout.columns!) : 1;
  /** How many rows a panel spans — same preconditions as the column span. Capped at 4:
   *  rows are emergent (unlike the fixed column count), so the cap is a sanity bound,
   *  not a fraction of anything. */
  const rowSpanOf = (id: NodeId): number =>
    autoRowSpan.get(id) ?? (spanEnabled ? clamp(Math.round(layout.panelRowSpan?.[id] ?? 1), 1, 4) : 1);
  /** Row spans Align all chose by itself (see "Auto row span" below) — filled once the cards are measured. */
  const autoRowSpan = new Map<NodeId, number>();
  const liveSizeOf = (id: NodeId): { w: number; h: number } => (resize && resize.id === id ? { w: resize.w, h: resize.h } : sizeOf(id));

  // --- precompute each panel's scene + geometry (axis-rect offsets) ---
  interface PanelGeom {
    p: Plot;
    i: number;
    table: DataTable;
    scene: ReturnType<typeof buildPlotScene>;
    /** Uniform render scale (PlotFigure zoom). 1 in re-layout mode; the miniature factor otherwise. */
    k: number;
    cardW: number;
    cardH: number;
    axisOff: AxisOffsets;
    /** Where the graph sits inside the card (left/top): CARD_PAD/header exactly, plus half
     *  of any extra space a stored cardSizes entry adds (the graph centres in its card). */
    insetL: number;
    insetT: number;
  }
  // A matrix heatmap is the one alignable chart with a rectangular plot but no axes
  // (no axis-title / tick strips). When aligned with axis-bearing panels it should grow
  // its cell grid to fill the space those panels reserve for axis titles, so the outer
  // footprints match — see the axis-less expansion pass below. (Pie/radar/3-D aren't
  // rectangular, so they're never treated this way.)
  const isAxisless = (p: Plot): boolean => p.kind === "heatmap" && (p.heatmap?.mode ?? "matrix") === "matrix";
  // "Keep proportions": each panel is a true uniform-scale
  // miniature of the full graph instead of a re-layout at card size. The stored field is
  // named `panelFontScale`, and the name is kept so saved figures keep their setting;
  // the chip and tooltip say what it does.
  const miniatures = layout.panelFontScale ?? false;
  const geomOf = (
    p: Plot,
    table: DataTable,
    extra?: { xExtra?: number; yExtra?: number; w?: number; h?: number; stretch?: boolean; hideVX?: boolean; hideVY?: boolean; hideLegend?: boolean; forceK?: number },
  ): Omit<PanelGeom, "p" | "i" | "table"> => {
    // Hide the in-graph title unless opted in (the plot reclaims the freed band).
    let base = showTitles ? p : { ...p, showTitle: false };
    // Shared-axis labelling: hide a visual axis (as drawn) on an inner panel. The flag has
    // to land on the data spec the renderer reads, which for a transposed categorical chart
    // is the other one — `dataAxisOf` does that mapping, so a flipped panel hides the axis
    // the user actually sees. buildPlotScene gives the freed margin back to the plot.
    // Merged legend: this panel's own key is replaced by one for the whole figure.
    if (extra?.hideLegend) base = { ...base, legend: { ...(base.legend ?? {}), show: false } };
    if (extra?.hideVX || extra?.hideVY) {
      const hide: Partial<Plot> = {};
      for (const visual of ["x", "y"] as const) {
        if (!(visual === "x" ? extra.hideVX : extra.hideVY)) continue;
        const key = `${dataAxisOf(p, visual)}Axis` as "xAxis" | "yAxis";
        hide[key] = { ...(base[key] ?? {}), hidden: true };
      }
      base = { ...base, ...hide };
    }
    // Align X/Y: stretch that axis to one data length across the figure so the axes line
    // up (X down each column, Y across each row). Non-destructive — render-only override.
    // `extra` grows an axis-less panel's grid to absorb the sibling axis-title margins.
    // `w`/`h` force the scene size for uniform sizing — on a forced axis the align fixed data rect
    // is dropped (over-constraint) so the graph fills that size (stretch).
    const sz = liveSizeOf(p.id);
    // Miniatures ("keep proportions"): the card is a uniform scale of the
    // full graph — built at the plot's own figure size and drawn with PlotFigure's zoom, so
    // fonts, markers, strokes and margins all shrink together. A re-layout at card size is a
    // different drawing (fonts scaled, marks not), which makes panel typography inconsistent.
    // Under align, k fits the graph's own data rect to the shared box (min of the two
    // ratios — one uniform scale cannot hit both unless the aspect matches); otherwise k
    // fits the whole scene into the panel box. Axis lengths may differ slightly per panel:
    // that is the unavoidable cost of true proportions.
    if (miniatures) {
      // A spanning rebuild passes an explicit design box + forceK together: the panel is
      // re-laid-out at its slot's aspect (a landscape graph cannot become tall by uniform
      // scaling — it only becomes huge) and rendered at the figure's common scale so its
      // typography still matches the miniature siblings.
      const boxed = extra?.forceK !== undefined && extra?.w !== undefined && extra?.h !== undefined;
      let scene = buildPlotScene(table, base, {
        measure: measureText,
        tables: (id) => project.tables.find((t) => t.id === id),
        gradients: (id) => project.gradients?.find((gr) => gr.id === id),
        width: boxed ? extra.w! : p.figureWidth ?? 580,
        height: boxed ? extra.h! : p.figureHeight ?? 380,
        ...(boxed && extra?.stretch ? { stretch: true } : {}),
        // Drawn at a known scale: a kind that shrinks its names to fill (radar/chord/rose/3-D) stops where they still
        // reach 8 px on screen — fitted to 8 and then drawn at 0.7, the rose's legend would be 5.6 px.
        ...(extra?.forceK !== undefined ? { minTextPx: 8 / extra.forceK } : {}),
        ...scenePaletteOpt(p),
      });
      const box = { w: extra?.w ?? sz.w, h: extra?.h ?? sz.h };
      // `forceK` = the axis-less row-height match: axis panels always
      // keep the min-ratio fit below — so their axes always stay aligned — but a kind with
      // no axes to align (treemap/network/pie/…) is rescaled by the pass after gridAssign
      // so its content height equals its row's axis reference. Never set for axis kinds.
      let k =
        extra?.forceK !== undefined
          ? extra.forceK
          : aligned
            ? Math.min(
                alignXeff ? ALIGN_AX / Math.max(1, scene.plot.width) : 9,
                alignYeff ? ALIGN_AY / Math.max(1, scene.plot.height) : 9,
                1.25,
              )
            : Math.min(1.25, box.w / Math.max(1, scene.width), box.h / Math.max(1, scene.height));
      // Readable under Align: an axis graph never draws below the scale at
      // which its smallest designed text reaches 8 px. Below it, the graph is re-laid at the aligned axis
      // lengths ÷ that scale — the same axis-length override the non-miniature mode uses — so its plot area
      // still lands exactly on the shared lines while its text stays readable. Heatmaps keep their own
      // exemption (fonts designed for their natural scale); kinds with no axes have their own floor below.
      if (aligned && extra?.forceK === undefined && !alignsByFootprint(p) && (alignXeff || alignYeff)) {
        // A matrix heatmap's floor comes from the text it actually draws — its own name / block / track sizes, which
        // `scene.fonts` does not hold. Without it a clustered heatmap's 9–10 px names draw at 4.8 px; a heatmap
        // designed with 26 px names still shrinks as far as its own floor allows.
        const floor = isAxisless(p) ? heatmapReadableScale(scene) : readableScale(scene.fonts);
        if (isAxisless(p) && k < floor - 1e-6) {
          // A matrix heatmap fits its names to its cells, so shrinking its grid to the shared plot size and enlarging the
          // design to compensate gives the same names on screen either way (7 px drawn at 0.8 = 5.6). The only readable
          // heatmap is one whose grid is larger than the shared box: it draws at its own size, scaled so its smallest
          // text reaches 8 px — like a chart with names down its left keeps its own height.
          const own = buildPlotScene(table, base, {
            measure: measureText,
            tables: (id) => project.tables.find((t) => t.id === id),
            gradients: (id) => project.gradients?.find((gr) => gr.id === id),
            width: p.figureWidth ?? 580,
            height: p.figureHeight ?? 380,
            ...scenePaletteOpt(p),
          });
          const ownFloor = heatmapReadableScale(own);
          if (k < ownFloor - 1e-6) {
            scene = own;
            k = Math.min(1, ownFloor);
          }
        } else if (k < floor - 1e-6) {
          // A chart with names down its left keeps its own height: its rows are as tall as its names need, and
          // squeezing them to the shared plot height would shrink 25 names to 4.9 px (ranked dots).
          const fixY = alignYeff && !namesOnLeft(scene);
          scene = buildPlotScene(
            table,
            { ...base, ...(alignXeff ? { xAxisLength: ALIGN_AX / floor } : {}), ...(fixY ? { yAxisLength: ALIGN_AY / floor } : {}) },
            {
              measure: measureText,
              tables: (id) => project.tables.find((t) => t.id === id),
              gradients: (id) => project.gradients?.find((gr) => gr.id === id),
              width: alignXeff ? 900 / floor : p.figureWidth ?? 580,
              height: fixY ? 700 / floor : p.figureHeight ?? 380,
              ...scenePaletteOpt(p),
            },
          );
          k = floor;
        }
      }
      // A paired dot cuts what does not fit its box — row names ("Educational attai…") when too narrow, the
      // rotated group headings ("Cogniti…") when a group's rows are too short. In a panel,
      // its design box grows (wider for names, taller for headings) and it draws smaller to keep the card's
      // size — never below the readable scale; past that the card grows instead. Names are never cut here.
      if (p.kind === "paireddot") {
        const rowsCut = (sc: typeof scene): boolean => sc.warnings.some((w) => w.includes("were shortened"));
        const headsCut = (sc: typeof scene): boolean => (sc.paireddot?.sections ?? []).some((x) => x.display !== undefined);
        if (rowsCut(scene) || headsCut(scene)) {
          const drawnW = scene.width * k;
          const drawnH = scene.height * k;
          const floor = readableScale(scene.fonts);
          let w = scene.width;
          let h = scene.height;
          for (let i = 0; i < 12 && (rowsCut(scene) || headsCut(scene)); i++) {
            if (rowsCut(scene)) w *= 1.2;
            if (headsCut(scene)) h *= 1.2;
            scene = buildPlotScene(table, base, {
              measure: measureText,
              tables: (id) => project.tables.find((t) => t.id === id),
              gradients: (id) => project.gradients?.find((gr) => gr.id === id),
              width: w,
              height: h,
              ...scenePaletteOpt(p),
            });
          }
          k = Math.max(floor, Math.min(k, drawnW / scene.width, drawnH / scene.height));
        }
      }
      const baseW = scene.width * k + 2 * CARD_PAD;
      const baseH = headerOff + scene.height * k + CARD_PAD;
      const storedCard = gridMode ? undefined : layout.cardSizes?.[p.id];
      const liveC = cardResize && cardResize.id === p.id ? cardResize : null;
      const cw = Math.max(baseW, liveC?.w ?? storedCard?.w ?? 0);
      const ch = Math.max(baseH, liveC?.h ?? storedCard?.h ?? 0);
      const iL = CARD_PAD + (cw - baseW) / 2;
      const iT = headerOff + (ch - baseH) / 2;
      return {
        scene,
        k,
        cardW: cw,
        cardH: ch,
        insetL: iL,
        insetT: iT,
        axisOff: {
          dl: iL + scene.plot.x * k,
          dr: iL + (scene.plot.x + scene.plot.width) * k,
          dt: iT + scene.plot.y * k,
          db: iT + (scene.plot.y + scene.plot.height) * k,
        },
      };
    }
    // A footprint-aligned kind (treemap/network/pie/…) ignores the axis-length overrides, so
    // building it under Align X/Y would just render it at the raw 900×700. Keep it at its
    // natural size and let it tile by its outer box instead.
    const footprint = alignsByFootprint(p);
    const useAX = alignXeff && extra?.w === undefined && !footprint;
    const useAY = alignYeff && extra?.h === undefined && !footprint;
    const plotForScene = (useAX || useAY)
      ? { ...base, ...(useAX ? { xAxisLength: ALIGN_AX + (extra?.xExtra ?? 0) } : {}), ...(useAY ? { yAxisLength: ALIGN_AY + (extra?.yExtra ?? 0) } : {}) }
      : base;
    const buildOpts = {
      measure: measureText,
      tables: (id: NodeId) => project.tables.find((t) => t.id === id),
      gradients: (id: string) => project.gradients?.find((gr) => gr.id === id),
      width: extra?.w ?? (useAX ? 900 : sz.w),
      height: extra?.h ?? (useAY ? 700 : sz.h),
      ...(extra?.stretch ? { stretch: true } : {}),
      ...scenePaletteOpt(p),
    };
    const scene = buildPlotScene(table, plotForScene, buildOpts);
    // The card floors at the graph + chrome; a stored cardSizes entry can only enlarge it,
    // and the graph centres in the extra space (two-level resize).
    // Computed alignment modes ignore cardSizes — exactly as they ignore panelSizes.
    // The align tools produce a dense aligned figure derived from scratch; honouring stored
    // card boxes there would keep the figure sparse and push each panel's content off the
    // shared lines (the shift math assumes the graph sits at CARD_PAD).
    const baseW = scene.width + 2 * CARD_PAD;
    const baseH = headerOff + scene.height + CARD_PAD;
    const stored = gridMode ? undefined : layout.cardSizes?.[p.id];
    const liveCard = cardResize && cardResize.id === p.id ? cardResize : null;
    const cardW = Math.max(baseW, liveCard?.w ?? stored?.w ?? 0);
    const cardH = Math.max(baseH, liveCard?.h ?? stored?.h ?? 0);
    const insetL = CARD_PAD + (cardW - baseW) / 2;
    const insetT = headerOff + (cardH - baseH) / 2;
    return {
      scene,
      k: 1,
      cardW,
      cardH,
      insetL,
      insetT,
      axisOff: {
        dl: insetL + scene.plot.x,
        dr: insetL + scene.plot.x + scene.plot.width,
        dt: insetT + scene.plot.y,
        db: insetT + scene.plot.y + scene.plot.height,
      },
    };
  };
  const geoms: PanelGeom[] = [];
  for (let i = 0; i < panelPlots.length; i++) {
    const p = panelPlots[i]!;
    const table = project.tables.find((t) => t.id === p.source);
    if (!table) continue;
    geoms.push({ p, i, table, ...geomOf(p, table) });
  }
  const axislessLeftExtra = new Map<NodeId, number>();
  /** Scene size a sizing pass explicitly forced for a panel (span / uniform). The later
   *  passes must re-apply exactly this when they rebuild, and must not invent one — an
   *  explicit size makes geomOf drop the axis-align fixed data rect. */
  const forcedSize = new Map<NodeId, { w?: number; h?: number }>();
  /** Miniature scale a sizing pass forced for a panel (the axis-less row-height match).
   *  Re-applied on every rebuild, exactly like forcedSize. */
  const forcedK = new Map<NodeId, number>();
  /** Render-only suppressions accumulated for a panel (merged legend, shared axes). Passes
   *  add to this and rebuild from the whole set, so a later pass can never silently undo an
   *  earlier one's override. */
  const suppress = new Map<NodeId, { hideVX?: boolean; hideVY?: boolean; hideLegend?: boolean }>();
  /** Rebuild a panel's geometry from every override accumulated for it so far. */
  const rebuildGeom = (g: PanelGeom): void => {
    const forced = forcedSize.get(g.p.id);
    const fk = forcedK.get(g.p.id);
    Object.assign(
      g,
      geomOf(g.p, g.table, {
        ...(suppress.get(g.p.id) ?? {}),
        ...(forced ?? {}),
        ...(forced ? { stretch: true } : {}),
        ...(fk !== undefined ? { forceK: fk } : {}),
      }),
    );
  };

  // --- Auto row span: under Align all, a card much taller than the rest of
  //     its row — a 25-name chart kept readable, a paired dot with its full names — would make the whole row
  //     that tall and leave a hole beside the short cards. It spans two rows
  //     instead and the next card moves up into the hole — the Tall-left shape, chosen automatically. Only when a
  //     card actually lands beside it on the second row (otherwise nothing changes), never when the user set
  //     spans of their own, and the card is re-laid to exactly the two rows' height at its own scale.
  if (allAligned && miniatures && !freeform && Object.keys(layout.panelRowSpan ?? {}).length === 0 && Object.keys(layout.panelSpan ?? {}).length === 0) {
    const cols = Math.max(1, layout.columns ?? layoutCols);
    if (cols >= 2 && geoms.length > cols) {
      const spans = new Map<number, number>();
      const pack = () => packGrid(geoms.map((_, i) => ({ cs: 1, rs: spans.get(i) ?? 1 })), cols);
      let assign = pack();
      const rowsIn = (as: { r: number }[]) => Math.max(...as.map((a, i) => a.r + (spans.get(i) ?? 1)));
      for (let r = 0; r < rowsIn(assign) && r < 64; r++) {
        const starts = geoms.map((g, i) => ({ g, i })).filter(({ i }) => assign[i]!.r === r && !spans.has(i));
        if (starts.length < 2) continue;
        const [tall, next] = [...starts].sort((x, y) => y.g.cardH - x.g.cardH);
        if (tall!.g.cardH < 1.45 * next!.g.cardH) continue;
        spans.set(tall!.i, 2);
        const trial = pack();
        const filled = trial.some((a, j) => j !== tall!.i && a.r === r + 1 && a.c !== trial[tall!.i]!.c);
        if (filled) assign = trial;
        else spans.delete(tall!.i);
      }
      if (spans.size) {
        for (const [i, rs] of spans) autoRowSpan.set(geoms[i]!.p.id, rs);
        const rowH = new Array<number>(rowsIn(assign)).fill(0);
        geoms.forEach((g, i) => { if (!spans.has(i)) rowH[assign[i]!.r] = Math.max(rowH[assign[i]!.r]!, g.cardH); });
        // A tall no-axis card also takes its column's width (the widest axis graph there): two spanning cards
        // in one column leave it with no axis line, and a narrower one would be centred in from the column edge,
        // its letter left at the edge.
        const colW = new Array<number>(cols).fill(0);
        geoms.forEach((g, i) => { if (!alignsByFootprint(g.p)) colW[assign[i]!.c] = Math.max(colW[assign[i]!.c]!, g.cardW); });
        for (const [i, rs] of spans) {
          const g = geoms[i]!;
          const r = assign[i]!.r;
          let slotH = (rs - 1) * gutter;
          for (let q = r; q < r + rs; q++) slotH += rowH[q] ?? 0;
          const designH = Math.max(60, (Math.max(slotH, g.cardH) - headerOff - CARD_PAD) / g.k);
          // "Centre no-axis": a tall no-axis card keeps its own proportions at its new height (not the column's width)
          const designW = centredNoAxis(g.p)
            ? ownWidthAt(g.scene, designH)
            : Math.max(60, ((alignsByFootprint(g.p) ? Math.max(g.cardW, colW[assign[i]!.c]!) : g.cardW) - 2 * CARD_PAD) / g.k);
          if (slotH <= g.cardH + 0.5 && Math.abs(designW - g.scene.width) < 0.5) continue; // already fills its slot
          forcedSize.set(g.p.id, { w: designW, h: designH });
          forcedK.set(g.p.id, g.k);
          rebuildGeom(g);
        }
      }
    }
  }

  // --- Span sizing (columns and rows in one pass): a spanning panel fills its whole
  //     slot — cs columns wide, rs rows tall (the wide-top / tall-left journal shapes).
  //     Only in grid mode with an explicit column count. The targets derive from the
  //     non-spanning panels' cards (a spanning panel is deliberately bigger, so letting
  //     it set the base sizes would feed back on itself).
  //
  //     A spanning panel is re-laid-out to fill its slot, never scaled: under Keep
  //     proportions a uniform rescale of a landscape graph to 2 rows tall makes it 2
  //     columns wide too, and a uniform rescale of a column
  //     span only fits inside the spanned width instead of filling it (the wide-top
  //     preset's panel A would stop at one column). Both spans build at
  //     the slot's aspect ÷ the figure's median panel scale and render at that scale, so
  //     the spanned card lands on its slot exactly and its typography still matches the
  //     miniature siblings. With Keep proportions off, a span is a stretched re-layout.
  if (spanEnabled) {
    const singles = geoms.filter((g) => spanOf(g.p.id) === 1 && rowSpanOf(g.p.id) === 1);
    const baseColW = singles.length ? Math.max(...singles.map((g) => g.cardW)) : DEFAULT_SCENE_W + 2 * CARD_PAD;
    const baseRowH = singles.length ? Math.max(...singles.map((g) => g.cardH)) : DEFAULT_SCENE_H + headerOff + CARD_PAD;
    const kMed = median(singles.filter((x) => !alignsByFootprint(x.p)).map((x) => x.k)) || 0.65;
    // A row-spanning card is as tall as the rows it covers — their tallest single cards — not rs × the tallest card in
    // the whole figure: otherwise a tall heatmap two rows further down makes a two-row ridgeline 1000 px tall,
    // overlapping the heatmap. A covered row with no single card falls back to the figure's tallest.
    const spanAssign = packGrid(geoms.map((g) => ({ cs: spanOf(g.p.id), rs: rowSpanOf(g.p.id) })), Math.max(1, layout.columns ?? layoutCols));
    const rowHOf = new Map<number, number>();
    geoms.forEach((g, i) => {
      if (spanOf(g.p.id) !== 1 || rowSpanOf(g.p.id) !== 1) return;
      const r = spanAssign[i]!.r;
      rowHOf.set(r, Math.max(rowHOf.get(r) ?? 0, g.cardH));
    });
    for (const g of geoms) {
      const cs = spanOf(g.p.id);
      const rs = rowSpanOf(g.p.id);
      if (cs <= 1 && rs <= 1) continue;
      if (autoRowSpan.has(g.p.id)) continue; // sized to its own two rows above
      const r0 = spanAssign[geoms.indexOf(g)]!.r;
      let rowsH = 0;
      for (let q = r0; q < r0 + rs; q++) rowsH += rowHOf.get(q) ?? baseRowH;
      const targetW = cs * baseColW + (cs - 1) * gutter - 2 * CARD_PAD;
      const targetH = rowsH + (rs - 1) * gutter - headerOff - CARD_PAD;
      if (Math.abs(targetW - (g.cardW - 2 * CARD_PAD)) < 0.5 && Math.abs(targetH - (g.cardH - headerOff - CARD_PAD)) < 0.5) continue;
      if (miniatures) {
        forcedSize.set(g.p.id, { w: Math.max(60, targetW / kMed), h: Math.max(60, targetH / kMed) });
        forcedK.set(g.p.id, kMed);
      } else {
        forcedSize.set(g.p.id, {
          ...(forcedSize.get(g.p.id) ?? {}),
          ...(cs > 1 ? { w: targetW } : {}),
          ...(rs > 1 ? { h: targetH } : {}),
        });
      }
      rebuildGeom(g); // rebuildGeom re-applies forcedSize (with stretch) + forcedK
    }
  }

  /** A panel's base (pre-alignment) top-left: stored free-drag position, else a grid default. */
  const basePos = (id: NodeId, i: number): { x: number; y: number } =>
    layout.panelPositions?.[id] ?? {
      x: 8 + (i % layoutCols) * (PANEL_W + gutter),
      y: 8 + Math.floor(i / layoutCols) * (PANEL_H + gutter),
    };

  // Row/column assignment (auto-detected by clustering the base positions, or a fixed
  // Columns count). Computed up-front because the axis-less expansion below needs to know
  // which panels share a row (→ match the row's X-title bottom) or a column (→ match the
  // column's Y-title left).
  const gridAssign: { cols: number; rows: number; assign: { c: number; r: number }[] } | null = (() => {
    // A known grid is enough to assign rows/columns: either a computed grid mode (align /
    // uniform), or the plain CSS grid with an explicit column count. The assignment alone
    // changes nothing — `posOf` still only applies `alignedLayout` in gridMode — but it lets
    // features that merely need to know "which panel is on which edge" (shared axis labels,
    // column spans) work in the plain grid too.
    const knownGrid = gridMode || (!freeform && !!layout.columns);
    if (!knownGrid || geoms.length === 0) return null;
    const medW = median(geoms.map((g) => g.cardW)) || PANEL_W;
    const medH = median(geoms.map((g) => g.cardH)) || PANEL_H;
    const bases = geoms.map((g, idx) => basePos(g.p.id, idx));
    let cols: number;
    let assign: { c: number; r: number }[];
    if (layout.columns || autoRowSpan.size > 0) {
      cols = Math.max(1, layout.columns ?? layoutCols);
      // 2-D occupancy packing (rowspan-aware, like an HTML table) — `packGrid` is the one
      // packer, shared with the layout picker's thumbnails so a thumbnail can never
      // promise a tiling this grid won't produce. With all panels 1×1 it reduces exactly
      // to a left-to-right wrap (`idx % cols`).
      assign = packGrid(
        geoms.map((g) => ({ cs: spanOf(g.p.id), rs: rowSpanOf(g.p.id) })),
        cols,
      );
    } else {
      const colCentres = cluster1D(geoms.map((g, idx) => bases[idx]!.x + g.cardW / 2), medW * 0.5);
      const rowCentres = cluster1D(geoms.map((g, idx) => bases[idx]!.y + g.cardH / 2), medH * 0.5);
      cols = colCentres.length;
      assign = geoms.map((g, idx) => ({ c: nearestIdx(bases[idx]!.x + g.cardW / 2, colCentres), r: nearestIdx(bases[idx]!.y + g.cardH / 2, rowCentres) }));
      assign = packHoles(assign, cols, bases.map((b) => b.x), geoms.every((g) => spanOf(g.p.id) === 1 && rowSpanOf(g.p.id) === 1));
    }
    // A row-spanning panel's bottom row counts — rows = the deepest occupied slot.
    const rows = Math.max(1, ...assign.map((a, i) => a.r + rowSpanOf(geoms[i]!.p.id)));
    return { cols, rows, assign };
  })();

  // --- miniature row-height match: a kind with no axes to align
  //     (treemap/network/pie/radar/…) is rescaled so its content-box height equals its
  //     row's reference — the tallest rendered data rect among the row's axis-bearing
  //     panels (heatmap grid included: it references like an axis panel here). Axis
  //     panels are never touched, so their axes always stay aligned; equal-height applies
  //     only where there is no axis to align. A row with only footprint kinds keeps their own min-ratio fit.
  /** Does this figure have any axis-bearing panel at all? Without one, "data lines" and
   *  content-rect matching are meaningless — a different sizing contract applies below. */
  const hasBearing = geoms.some((g) => !isAxisless(g.p) && !alignsByFootprint(g.p));
  if (aligned && gridAssign && miniatures && hasBearing) {
    const { rows, cols, assign } = gridAssign;
    const rowRef = new Array<number>(rows).fill(0);
    // The drawn width of the widest axis graph in each column: a footprint kind re-lays to it, so
    // it fills its column instead of leaving a hole beside it (large empty spaces
    // between cards). A pie stays round and centres in that
    // width; a treemap / network uses it. 0 = no axis graph in the column → own width kept.
    const colRefW = new Array<number>(cols).fill(0);
    geoms.forEach((g, idx) => {
      if (alignsByFootprint(g.p)) return;
      // A tall (row-spanning) axis graph is still one column wide, so it sets its column's width — with Align
      // all's automatic spans it can be the only axis graph in its column.
      if (spanOf(g.p.id) === 1) colRefW[assign[idx]!.c] = Math.max(colRefW[assign[idx]!.c]!, g.scene.width * g.k);
      if (rowSpanOf(g.p.id) > 1) return; // a tall panel references no single row
      const r = assign[idx]!.r;
      rowRef[r] = Math.max(rowRef[r]!, g.scene.plot.height * g.k);
    });
    /** Design width that draws at the column's width at scale k, when the panel would otherwise draw
     *  narrower (its own width at the row-matched scale kFit); undefined = keep its own width. */
    const fillW = (g: PanelGeom, idx: number, k: number, kFit: number): number | undefined => {
      if (centredNoAxis(g.p)) return undefined; // "Centre no-axis": keeps its own width, centred below
      const target = spanOf(g.p.id) === 1 ? colRefW[assign[idx]!.c]! : 0;
      return target > g.scene.width * kFit + 0.5 ? Math.max(60, target / k) : undefined;
    };
    geoms.forEach((g, idx) => {
      if (!alignsByFootprint(g.p) || rowSpanOf(g.p.id) > 1) return; // row-span sizing owns a tall footprint panel
      const ref = rowRef[assign[idx]!.r]!;
      if (ref <= 0) {
        // Footprint-only row inside a mixed figure: no reference exists, but the
        // readability floor still applies (without it a treemap here can draw at 0.36 →
        // 4.3px). Re-lay at the panel's own footprint at 0.7.
        // It still takes its column's width (a sunburst + 3-D on a row of their own would
        // otherwise leave a hole — the fill below only runs for rows holding an axis graph).
        const floor = readableScale(g.scene.fonts); // 0.7, or more where its smallest designed text needs it
        const k = Math.max(g.k, floor);
        const w = fillW(g, idx, k, g.k);
        if (g.k >= floor && w === undefined) return;
        forcedSize.set(g.p.id, { w: w ?? Math.max(60, (g.scene.width * g.k) / k), h: Math.max(60, (g.scene.height * g.k) / k) });
        forcedK.set(g.p.id, k);
        rebuildGeom(g);
        return;
      }
      const kFit = Math.min(1.25, ref / Math.max(1, g.scene.plot.height));
      const floor = readableScale(g.scene.fonts); // 0.7, or more where its smallest designed text needs it
      if (kFit >= floor) {
        // readable as-is → the pure uniform rescale; re-laid wider only to fill its column
        const w = fillW(g, idx, kFit, kFit);
        if (Math.abs(kFit - g.k) < 0.005 && w === undefined) return;
        if (w !== undefined) forcedSize.set(g.p.id, { w, h: g.scene.height });
        forcedK.set(g.p.id, kFit);
        rebuildGeom(g);
      } else {
        // Readability floor 0.7 (the same floor as the all-axis-less pass):
        // the pure rescale would render this kind's designed fonts below ~8px (the square
        // treemap would reach 0.36). An aspect-free kind re-lays instead: the same rendered
        // footprint and the same row-matched content height, drawn from a smaller design
        // box at 0.7 — fonts readable, row alignment kept. One deterministic step; the
        // slightly different margins after the rebuild are accepted as-is.
        const k = floor;
        const marginH = g.scene.height - g.scene.plot.height;
        const h = Math.max(60, ref / k + marginH);
        forcedSize.set(g.p.id, {
          // "Centre no-axis": its own proportions at the new height — keeping the old width would give a tall
          // narrow box, a smaller disc and lost cell labels.
          w: fillW(g, idx, k, kFit) ?? (centredNoAxis(g.p) ? ownWidthAt(g.scene, h) : Math.max(60, (g.scene.width * kFit) / k)),
          h,
        });
        forcedK.set(g.p.id, k);
        rebuildGeom(g);
      }
    });
  }

  // --- All-axis-less figure: with
  //     no axis panel anywhere, matching content rects is meaningless — matching a
  //     treemap's disc to a heatmap's grid height would shrink the treemap to a tiny size
  //     while their cards stay mismatched. The contract here is the one used for the
  //     non-miniature mode: same outer box. Every panel re-lays-out at the reference
  //     box — the heatmap's scene if there is one, else the largest panel's — and renders
  //     at the reference's own scale: equal cards, full-size content, a tidy grid. The
  //     conditional centring then only has residual pixels to absorb.
  if (aligned && gridAssign && miniatures && !hasBearing && geoms.length > 1) {
    const ref =
      geoms.find((g) => isAxisless(g.p) && rowSpanOf(g.p.id) === 1 && spanOf(g.p.id) === 1) ??
      [...geoms]
        .filter((g) => rowSpanOf(g.p.id) === 1 && spanOf(g.p.id) === 1)
        .sort((a, b) => b.scene.width * b.scene.height - a.scene.width * a.scene.height)[0];
    if (ref) {
      // Every panel keeps its own scale — rendering everything at the
      // reference's scale (the heatmap's 0.39) would shrink the network's and the
      // paired-dot's designed fonts to ~6px, below the readable-font requirement.
      // Each panel's design box is the shared card divided
      // by its own natural miniature scale: the cards come out identical while each
      // kind's typography renders at the size it was designed for.
      const refW = ref.cardW;
      const refH = ref.cardH;
      for (const g of geoms) {
        if (g === ref || rowSpanOf(g.p.id) > 1 || spanOf(g.p.id) > 1) continue; // span sizing owns spanning panels
        // Scale floor 0.7: a re-laid panel is aspect-free, so its scale is free too — and
        // an inherited align-fit scale can be tiny (the square treemap's is 0.36, which
        // renders its value labels at 4.3px; criterion: readable fonts).
        // At ≥0.7 of design scale every kind's smallest designed text stays ≥ ~8px on
        // screen; the design box compensates, so the card is identical either way.
        const k = Math.max(g.k, isAxisless(g.p) ? 0.7 : readableScale(g.scene.fonts));
        forcedSize.set(g.p.id, {
          w: Math.max(60, (refW - 2 * CARD_PAD) / k),
          h: Math.max(60, (refH - headerOff - CARD_PAD) / k),
        });
        forcedK.set(g.p.id, k);
        rebuildGeom(g);
      }
      // The reference gets the floor too when it is not a heatmap: the heatmap exemption
      // exists because its fonts are designed for its own scale — a treemap that happens
      // to be the reference has no such reason (it could draw at 0.36 →
      // 4.3px). Floored after the followers so they match its original card box.
      if (!isAxisless(ref.p) && ref.k < readableScale(ref.scene.fonts)) {
        const k = readableScale(ref.scene.fonts);
        forcedSize.set(ref.p.id, {
          w: Math.max(60, (refW - 2 * CARD_PAD) / k),
          h: Math.max(60, (refH - headerOff - CARD_PAD) / k),
        });
        forcedK.set(ref.p.id, k);
        rebuildGeom(ref);
      }
    }
  }

  // --- stretch the odd last panel: an aligned grid whose last row holds
  //     a single panel leaves a hole beside it.
  //     Opted in via the "Stretch last" chip, that panel grows to the widest full row's
  //     width — a uniform rescale under Keep proportions, a re-layout otherwise (the same
  //     stretch semantics the span pass uses). It follows the alignment lines but never
  //     defines them: its axes span the whole row, so no column can share its axis line.
  const stretchedIds = new Set<NodeId>();
  if (aligned && gridAssign && (layout.stretchLastPanel ?? false)) {
    const { cols, rows, assign } = gridAssign;
    const lastRow = geoms.map((g, idx) => ({ g, idx })).filter(({ idx }) => assign[idx]!.r === rows - 1);
    if (cols >= 2 && rows >= 2 && lastRow.length === 1 && rowSpanOf(lastRow[0]!.g.p.id) === 1) {
      const lone = lastRow[0]!.g;
      const rowW = new Array<number>(rows).fill(0);
      const rowN = new Array<number>(rows).fill(0);
      geoms.forEach((g, idx) => {
        const r = assign[idx]!.r;
        rowW[r]! += g.cardW;
        rowN[r]! += 1;
      });
      const targetCardW = Math.max(...rowW.slice(0, rows - 1).map((w, r) => w + (rowN[r]! - 1) * gutter));
      if (targetCardW > lone.cardW + 8) {
        stretchedIds.add(lone.p.id);
        if (miniatures) {
          forcedK.set(lone.p.id, Math.min(1.25, (targetCardW - 2 * CARD_PAD) / Math.max(1, lone.scene.width)));
          rebuildGeom(lone);
          // The scale was taken from the drawing it had — which the readability floor may have re-laid at other
          // axis lengths — but a forced scale rebuilds the graph's natural drawing. Take it once more from the
          // drawing it now has, so the card lands exactly on the row width.
          if (Math.abs(lone.cardW - targetCardW) > 0.5) {
            const kNeed = (targetCardW - 2 * CARD_PAD) / Math.max(1, lone.scene.width);
            if (kNeed > 1.25) {
              // A uniform rescale cannot reach the row past the 1.25 cap (the readable floor made the row above
              // wider): re-lay it wider at 1.25 instead — the stretch this pass already does without Keep proportions.
              forcedSize.set(lone.p.id, { ...(forcedSize.get(lone.p.id) ?? {}), w: (targetCardW - 2 * CARD_PAD) / 1.25, h: lone.scene.height });
            }
            forcedK.set(lone.p.id, Math.min(1.25, kNeed));
            rebuildGeom(lone);
          }
        } else {
          const w = targetCardW - 2 * CARD_PAD;
          forcedSize.set(lone.p.id, { ...(forcedSize.get(lone.p.id) ?? {}), w });
          Object.assign(lone, geomOf(lone.p, lone.table, { w, stretch: true }));
        }
      }
    }
  }

  // --- axis-less expansion: size heatmap grids so their outer footprint matches the
  //     neighbours' (axis titles + tick labels included), so a matrix heatmap doesn't look
  //     inset (too short) or — because its colour-bar sits outside its grid — too wide.
  //     Vertical (per row): add the row's max below-plot margin (X ticks + X-title) to the
  //       heatmap's yAxisLength → the cells grow down until the bottom reaches the row's
  //       X-title bottom.
  //     Horizontal (figure-wide width): set xAxisLength so the heatmap's total scene width
  //       (row labels + grid + colour-bar + labels — all counted) equals the graphs' total
  //       width. The colour-bar is thus counted in the size, so the grid shrinks to fit and
  //       the heatmap is no wider than a graph.
  //     Left align (per column): shift the heatmap left by the column's Y-margin gap so its
  //       row-label strip (its de-facto Y-axis) lands on the neighbours' Y-title.
  //     Only axis-less panels are rebuilt; axis-bearing panels are untouched. A heatmap alone
  //     in its row/column gets no vertical/left change there (its width still matches).
  if (aligned && gridAssign && !miniatures) {
    const { cols, rows, assign } = gridAssign;
    // Space below the plot rect down to the axis-title band bottom — excluding any explicit
    // bottom margin the graph set (plotPad.bottom), so the heatmap grows to the graph's title,
    // not to a padded card edge. (The ~2px of font-descender reserve inside the title band is
    // left alone: shaving it needs per-font glyph metrics and would risk a hairline gap.)
    const belowOf = (g: PanelGeom): number =>
      Math.max(0, g.scene.height - (g.scene.plot.y + g.scene.plot.height) - (g.p.plotPad?.bottom ?? 0));
    // A spanning panel is deliberately wider than a column, so it must not set the width
    // every axis-less panel matches itself to — that would drag heatmaps out to the wide
    // panel's size. It still receives the match (below) like any other panel.
    // A footprint-aligned kind is not axis-bearing, so it must not define the width a heatmap
    // matches itself to (it would drag heatmaps out to a treemap/network's natural size).
    const bearing = geoms.filter((g) => !isAxisless(g.p) && !alignsByFootprint(g.p) && spanOf(g.p.id) === 1);
    // Target outer width = the widest axis-bearing panel's scene width (its plot + axis
    // titles/ticks). A heatmap's scene width includes its colour-bar, so matching to this
    // makes the whole heatmap — legend and all — the same width as a graph.
    const targetW = alignXeff && bearing.length ? Math.max(...bearing.map((g) => g.scene.width)) : 0;
    const rowBelow = new Array<number>(rows).fill(0);
    const colLeft = new Array<number>(cols).fill(0);
    geoms.forEach((g, idx) => {
      // Only axis-bearing panels set the target margins — a footprint kind's own margins
      // (a network's left colour-bar, a radar's padding) are consumers, not references.
      if (isAxisless(g.p) || alignsByFootprint(g.p)) return;
      const { c, r } = assign[idx]!;
      rowBelow[r] = Math.max(rowBelow[r]!, belowOf(g));
      colLeft[c] = Math.max(colLeft[c]!, g.scene.plot.x);
    });
    geoms.forEach((g, idx) => {
      if (!isAxisless(g.p) || rowSpanOf(g.p.id) > 1) return; // a tall heatmap is sized by the row-span pass
      const { c, r } = assign[idx]!;
      const yExtra = alignYeff ? rowBelow[r]! : 0;
      // Width match (colour-bar included): grow/shrink the grid so scene.width → targetW.
      // A spanning heatmap keeps its spanned width — matching it to a single column's
      // target would silently undo the span. Its vertical match still applies.
      const xExtra = targetW > 0 && spanOf(g.p.id) === 1 ? targetW - g.scene.width : 0;
      if (yExtra === 0 && xExtra === 0) return;
      Object.assign(g, geomOf(g.p, g.table, { yExtra, xExtra }));
      // Left alignment within the column (row labels → the neighbours' Y-title).
      const shift = alignXeff ? Math.max(0, colLeft[c]! - g.scene.plot.x) : 0;
      if (shift > 0) axislessLeftExtra.set(g.p.id, shift);
    });

    // --- heatmap-as-reference: a row with no axis-bearing panel still needs a band target,
    //     or a footprint kind sharing a row with only a heatmap ends up shorter than it.
    //     The heatmap (already sized above) stands in as that row's reference: its below-
    //     space becomes the row band. Same for the width when the whole figure has no axis
    //     panel — the widest heatmap becomes the outer-width target for footprint kinds.
    const rowHasBearing = new Array<boolean>(rows).fill(false);
    geoms.forEach((g, idx) => {
      if (!isAxisless(g.p) && !alignsByFootprint(g.p)) rowHasBearing[assign[idx]!.r] = true;
    });
    geoms.forEach((g, idx) => {
      if (!isAxisless(g.p)) return;
      const { r } = assign[idx]!;
      if (!rowHasBearing[r]) rowBelow[r] = Math.max(rowBelow[r]!, belowOf(g));
    });
    const heatmaps = geoms.filter((g) => isAxisless(g.p) && spanOf(g.p.id) === 1);
    const fpTargetW = targetW > 0 ? targetW : alignXeff && heatmaps.length > 0 ? Math.max(...heatmaps.map((g) => g.scene.width)) : 0;

    // --- footprint kinds (treemap/network/pie/radar/3-D/…): the same strategy the heatmap
    //     uses, generalised. They ignore the axis-length overrides, so the shared box is
    //     imposed by solving the outer size from each panel's measured margins:
    //     1) content rect = the axis panels' shared data box (ALIGN_AX × ALIGN_AY), then
    //     2) absorb the sibling margins exactly as the heatmap does — outer width grows to
    //        `targetW` (the widest axis panel), content bottom grows down to the row's
    //        X-title band bottom (`rowBelow`) — so the outer edges line up too.
    //     The shift pass below then puts every content edge on the shared row/column lines.
    //     No stretch. Building at the target box and letting the kind lay out at its
    //     natural aspect is what keeps a pie/radar circular and a network's edge labels
    //     inside the frame; stretch:true would squash the pie and dot-plot proportions and
    //     push the network's left labels off the card. A circular
    //     kind simply centres in the box.
    geoms.forEach((g, idx) => {
      if (!alignsByFootprint(g.p) || spanOf(g.p.id) > 1) return;
      const { r } = assign[idx]!;
      // 1) shared data box + own margins (margins can change with a rebuild — legend
      //    rewrap — so iterate a couple of times and stop when stable).
      for (let it = 0; it < 3; it++) {
        const mx = g.scene.width - g.scene.plot.width;
        const my = g.scene.height - g.scene.plot.height;
        const w = alignXeff ? ALIGN_AX + mx : g.scene.width;
        const h = alignYeff ? ALIGN_AY + my : g.scene.height;
        if (Math.abs(w - g.scene.width) < 1 && Math.abs(h - g.scene.height) < 1) break;
        Object.assign(g, geomOf(g.p, g.table, { w, h }));
      }
      // 2) absorb sibling margins (outer-edge match, heatmap-style). The panel's own
      //    below-space already fills part of the sibling band, so only the difference is
      //    added — that makes the card bottoms land exactly flush once the shift pass
      //    aligns the content tops. The reference is an axis panel where the row/figure
      //    has one, else the heatmap (see heatmap-as-reference above). In an all-footprint
      //    figure both extras are 0 and the shared data box from step 1 is the whole story.
      const yExtra = alignYeff ? Math.max(0, rowBelow[r]! - belowOf(g)) : 0;
      const xExtra = fpTargetW > 0 ? fpTargetW - g.scene.width : 0;
      if (Math.abs(xExtra) >= 1 || yExtra >= 1) {
        Object.assign(g, geomOf(g.p, g.table, { w: g.scene.width + xExtra, h: g.scene.height + yExtra }));
      }
    });
  }

  // --- uniform sizing: make every card in a row share the row's height (uRow) and/or every
  //     card in a column share the column's width (uCol). Runs after axis-less expansion so a
  //     heatmap starts from its neighbour footprint. Each undersized panel is re-laid-out to
  //     fill the target (stretch: pie/radar/3-D fill the box too). Row/column detection is from
  //     base positions, so resizing cards here never re-clusters the grid.
  if (gridAssign && (uRow || uCol)) {
    const { cols, rows, assign } = gridAssign;
    const rowTargetH = new Array<number>(rows).fill(0);
    const colTargetW = new Array<number>(cols).fill(0);
    geoms.forEach((g, idx) => {
      const { c, r } = assign[idx]!;
      // A spanning panel's width covers several columns, so it neither sets a column's
      // target nor takes one — its width was chosen explicitly by the span. Row height
      // still applies to it like any other panel. A row-spanning panel is the vertical
      // case: its height covers several rows, so it neither sets nor takes a row target.
      if (rowSpanOf(g.p.id) === 1) rowTargetH[r] = Math.max(rowTargetH[r]!, g.cardH);
      if (spanOf(g.p.id) === 1 && rowSpanOf(g.p.id) === 1) colTargetW[c] = Math.max(colTargetW[c]!, g.cardW);
    });
    geoms.forEach((g, idx) => {
      const { c, r } = assign[idx]!;
      const spanning = spanOf(g.p.id) > 1;
      const useCol = uCol && !spanning && rowSpanOf(g.p.id) === 1;
      const tH = uRow && rowSpanOf(g.p.id) === 1 ? rowTargetH[r]! : g.cardH;
      const tW = useCol ? colTargetW[c]! : g.cardW;
      if (Math.abs(tH - g.cardH) < 0.5 && Math.abs(tW - g.cardW) < 0.5) return; // already at target
      const forced = {
        ...(useCol ? { w: tW - 2 * CARD_PAD } : {}),
        ...(uRow ? { h: tH - headerOff - CARD_PAD } : {}),
      };
      forcedSize.set(g.p.id, { ...(forcedSize.get(g.p.id) ?? {}), ...forced });
      Object.assign(g, geomOf(g.p, g.table, { ...forced, stretch: true }));
    });
  }

  // --- merged legend: a figure whose panels all plot the same series needs one key, not N
  //     copies of it. Each panel's own legend is suppressed and a single legend is drawn for
  //     the whole figure; the space the per-panel legends were reserving goes back to the
  //     graphs (buildPlotScene stops reserving the outside column).
  //
  //     Note: the same accuracy check as the shared axes: every panel that shows a legend must carry
  //     identical entries (labels, colours, marker shapes). If any differ, nothing is merged
  //     — one key cannot speak for series that don't match. Panels with no legend at all
  //     (single-series graphs) neither block the merge nor take part in it.
  //
  //     Runs before the shared-axis pass, and through `suppress`, so the two compose.
  const legendKeyOf = (g: PanelGeom): string =>
    g.scene.legend.length === 0 ? "" : JSON.stringify(g.scene.legend.map((e) => [e.label, e.color, e.symbol ?? null, e.dash ?? null]));
  const legendPanels = geoms.filter((g) => legendKeyOf(g) !== "");
  /** The one legend the whole figure shares, or null when the panels don't agree. */
  const sharedLegend =
    legendPanels.length >= 2 && new Set(legendPanels.map(legendKeyOf)).size === 1
      ? { entries: legendPanels[0]!.scene.legend, font: legendPanels[0]!.scene.fonts.legend }
      : null;
  const mergeLegend = (layout.mergedLegend ?? false) && sharedLegend !== null;
  if (mergeLegend) {
    for (const g of legendPanels) {
      suppress.set(g.p.id, { ...(suppress.get(g.p.id) ?? {}), hideLegend: true });
      rebuildGeom(g);
    }
  }

  // --- shared-axis labelling: label only the figure's outer edges, so a grid of panels
  //     reads as one figure. A panel not in the first column drops its Y tick labels +
  //     title; a panel not at the bottom of its column drops its X ones. The freed margin
  //     goes back to the plot (buildPlotScene reclaims it), so the figure tightens up.
  //
  //     Note: accuracy check: a label is only dropped when the panel genuinely shares that axis
  //     with the edge panel it defers to — same title, same scale type, same tick labels.
  //     Two panels with different units or ranges keep their own scales, because hiding
  //     one's axis would invite the reader to read it off the other's. This is why the
  //     toggle can be left on without silently misrepresenting a mixed figure.
  //
  //     Runs after the axis-less expansion and uniform sizing so neither is affected by
  //     it; this pass only ever shrinks a panel's own margins.
  if (sharedAxisLabels && gridAssign && geoms.length > 1) {
    const { assign } = gridAssign;
    /** What a rendered axis actually says — two panels share an axis iff these match. */
    const axisKey = (ax: { title: string; type: string; band?: boolean; ticks: { label: string; minor?: boolean }[] } | undefined): string =>
      ax ? JSON.stringify([ax.title, ax.type, ax.band ?? false, ax.ticks.filter((t) => !t.minor).map((t) => t.label)]) : "";
    const cellOf = (idx: number) => assign[idx]!;
    // The panel each inner panel defers to: leftmost in its row (Y), lowest in its column (X).
    const firstInRow = new Map<number, number>();
    const lastInCol = new Map<number, number>();
    geoms.forEach((_, idx) => {
      const { c, r } = cellOf(idx);
      const fr = firstInRow.get(r);
      if (fr === undefined || cellOf(fr).c > c) firstInRow.set(r, idx);
      const lc = lastInCol.get(c);
      if (lc === undefined || cellOf(lc).r < r) lastInCol.set(c, idx);
    });
    const hides: Array<{ g: PanelGeom; hideVX: boolean; hideVY: boolean }> = [];
    geoms.forEach((g, idx) => {
      const { c, r } = cellOf(idx);
      const yRef = firstInRow.get(r);
      const xRef = lastInCol.get(c);
      // defer only to a different panel whose axis says the same thing
      const hideVY = yRef !== undefined && yRef !== idx && axisKey(geoms[yRef]!.scene.y) === axisKey(g.scene.y);
      const hideVX = xRef !== undefined && xRef !== idx && axisKey(geoms[xRef]!.scene.x) === axisKey(g.scene.x);
      if (hideVX || hideVY) hides.push({ g, hideVX, hideVY });
      void c;
    });
    // Rebuild in a second pass so the comparisons above all ran against the original scenes.
    // Re-apply only the size the span / uniform passes explicitly forced (if any): passing a
    // w/h that nobody forced would make geomOf drop the axis-align fixed data rect (it treats an
    // explicit size as over-constraining) and the panels' axes would stop lining up. With no
    // forced size, the aligned data rect stays fixed and the shrunken margin simply makes the
    // panel narrower/shorter, so the panels pack closer together.
    for (const { g, hideVX, hideVY } of hides) {
      suppress.set(g.p.id, {
        ...(suppress.get(g.p.id) ?? {}),
        ...(hideVX ? { hideVX: true } : {}),
        ...(hideVY ? { hideVY: true } : {}),
      });
      rebuildGeom(g);
    }
  }

  const axisOffById: Record<NodeId, AxisOffsets> = {};
  for (const g of geoms) axisOffById[g.p.id] = g.axisOff;

  // --- Align X/Y: compute absolute positions that line the data rectangles into a grid.
  //     Rows/columns are auto-detected (cluster the base positions) unless Columns is fixed.
  const alignedLayout = (() => {
    if (!gridAssign || geoms.length === 0) return null;
    const { cols, rows, assign } = gridAssign;
    const colMaxLeft = new Array<number>(cols).fill(0);
    const rowMaxTop = new Array<number>(rows).fill(0);
    // Which columns/rows actually have a line (an axis-bearing or heatmap voter). Where
    // none does, there is nothing to align to — see the conditional centring below.
    const colHasLine = new Array<boolean>(cols).fill(false);
    const rowHasLine = new Array<boolean>(rows).fill(false);
    // Which columns hold a chart with numbers on its left — there, a names chart follows the line.
    const colHasNumbers = new Array<boolean>(cols).fill(false);
    geoms.forEach((g, idx) => {
      if (alignsByFootprint(g.p) || stretchedIds.has(g.p.id) || rowSpanOf(g.p.id) > 1) return;
      if (!namesOnLeft(g.scene)) colHasNumbers[assign[idx]!.c] = true;
    });
    // A matrix heatmap follows the column line and never sets it: drawn readable, its dendrogram + row names
    // are wide, and as a line-setter it would push the other charts in the column far in from their cards.
    const followsColumnLine = (g: PanelGeom, c: number): boolean => alignsByFootprint(g.p) || isAxisless(g.p) || (namesOnLeft(g.scene) && colHasNumbers[c]!);
    geoms.forEach((g, idx) => {
      // Footprint kinds follow the lines but never define them. Letting them vote
      // spreads the figure apart as soon as one has a big internal label block:
      // a paired-dot's ~200px trait labels sit inside its plot.x, so it would drag the whole
      // column's line out and Align would spread the cards. Only axis-bearing
      // panels and the heatmap (whose own pass absorbs its labels) set the lines.
      if (alignsByFootprint(g.p) || stretchedIds.has(g.p.id) || rowSpanOf(g.p.id) > 1) return;
      const { c, r } = assign[idx]!;
      if (!followsColumnLine(g, c)) {
        colMaxLeft[c] = Math.max(colMaxLeft[c]!, g.scene.plot.x * g.k);
        colHasLine[c] = true;
      }
      rowMaxTop[r] = Math.max(rowMaxTop[r]!, g.scene.plot.y * g.k);
      rowHasLine[r] = true;
    });
    // Axis-less panels that grew leftward (see axislessLeftExtra) get shifted left by that
    // gap so the extra grid lands on the left — its row-label strip lands on the neighbours'
    // Y-title and its grid fills the gap (rather than overhanging to the right).
    // A footprint kind's shift is clamped at 0: with a label block wider than the line the
    // raw shift goes negative, and a negative shift overlaps the previous column — dense
    // placement wins over perfect line-up for label-heavy kinds.
    const shiftXof = (g: PanelGeom, c: number) => {
      if (!alignXeff) return 0;
      // A kind with no axis (pie / treemap / network …) has no Y-axis line to put on the column's: it
      // sits flush on the column edge, its card edges on its neighbours' (otherwise pie charts and
      // network panels line up with nothing — a pie set in from the graph below it).
      if (alignsByFootprint(g.p) && !stretchedIds.has(g.p.id)) return 0; // a tall (spanning) one too
      const s = colMaxLeft[c]! - (axislessLeftExtra.get(g.p.id) ?? 0) - g.scene.plot.x * g.k;
      return followsColumnLine(g, c) || stretchedIds.has(g.p.id) || rowSpanOf(g.p.id) > 1 ? Math.max(0, s) : s;
    };
    const shiftYof = (g: PanelGeom, r: number) => {
      if (!alignYeff) return 0;
      const s = rowMaxTop[r]! - g.scene.plot.y * g.k;
      return alignsByFootprint(g.p) || stretchedIds.has(g.p.id) || rowSpanOf(g.p.id) > 1 ? Math.max(0, s) : s;
    };
    const colSlotW = new Array<number>(cols).fill(0);
    const rowSlotH = new Array<number>(rows).fill(0);
    geoms.forEach((g, idx) => {
      const { c, r } = assign[idx]!;
      // A spanning panel covers several columns, so its width is not one column's width —
      // letting it set colSlotW would inflate its starting column and push the rest right.
      // Its own width is already the sum of the columns it covers (the span pass above).
      // A stretched odd last panel covers the whole row — same rule. A row-spanning panel
      // covers several rows, so it never sets rowSlotH — but its width is a proper
      // single-column width (the re-layout keeps it), and it may be alone in its column
      // (the tall-left shape), so it does set colSlotW like any other panel.
      if (spanOf(g.p.id) === 1 && !stretchedIds.has(g.p.id)) colSlotW[c] = Math.max(colSlotW[c]!, shiftXof(g, c) + g.cardW);
      if (rowSpanOf(g.p.id) === 1) rowSlotH[r] = Math.max(rowSlotH[r]!, shiftYof(g, r) + g.cardH);
    });
    // A card spanning several rows can be taller than those rows together (a chart with many readable names, or a
    // paired dot lowered to line up its plot top): the rows below start where the spanned rows end, so it would run
    // into them, over a neighbour's axis title. Its last spanned row grows by what it lacks.
    geoms.forEach((g, idx) => {
      const rs = Math.min(rowSpanOf(g.p.id), rows - assign[idx]!.r);
      if (rs <= 1) return;
      const r0 = assign[idx]!.r;
      let have = (rs - 1) * gutter;
      for (let q = r0; q < r0 + rs; q++) have += rowSlotH[q]!;
      const need = shiftYof(g, r0) + g.cardH;
      if (need > have + 0.5) rowSlotH[r0 + rs - 1]! += need - have;
    });
    const colBaseX: number[] = []; let ax = 8; for (let c = 0; c < cols; c++) { colBaseX[c] = ax; ax += colSlotW[c]! + gutter; }
    const rowBaseY: number[] = []; let ay = 8; for (let r = 0; r < rows; r++) { rowBaseY[r] = ay; ay += rowSlotH[r]! + gutter; }
    // Conditional centring: a panel follows its
    // column/row line when one exists; where a column/row has no line at all (only
    // axis-less/footprint panels — nothing voted), pinning flush-left gives no alignment
    // and leaves ragged one-sided gaps, so the
    // panel centres in its slot instead. Axis panels always have a line, so this can never
    // touch them. A spanning panel centres across all the slots it covers, and only when
    // none of them carries a line.
    const slotWFor = (c: number, cs: number): number => {
      let w = 0;
      for (let i = 0; i < cs && c + i < cols; i++) w += colSlotW[c + i]!;
      return w + (Math.min(cs, cols - c) - 1) * gutter;
    };
    const slotHFor = (r: number, rs: number): number => {
      let h = 0;
      for (let i = 0; i < rs && r + i < rows; i++) h += rowSlotH[r + i]!;
      return h + (Math.min(rs, rows - r) - 1) * gutter;
    };
    const pos: Record<NodeId, { x: number; y: number }> = {};
    /** Cards centred across their column (no line to follow, or "Centre no-axis"): their letter goes with them. */
    const centred = new Set<NodeId>();
    geoms.forEach((g, idx) => {
      const { c, r } = assign[idx]!;
      const cs = Math.min(spanOf(g.p.id), cols - c);
      const rs = Math.min(rowSpanOf(g.p.id), rows - r);
      const anyColLine = Array.from({ length: cs }, (_, i) => colHasLine[c + i]).some(Boolean);
      const anyRowLine = Array.from({ length: rs }, (_, i) => rowHasLine[r + i]).some(Boolean);
      // A graph with axes never centres for want of a line — it sits flush on its column edge like every axis graph. A
      // tall (spanning) one sets no line, and in a column whose other cards follow (a heatmap, a treemap) it would
      // otherwise be centred in from its column edge.
      const hasAxes = !alignsByFootprint(g.p) && !isAxisless(g.p);
      const centreX = anyColLine ? centredNoAxis(g.p) && !stretchedIds.has(g.p.id) : !hasAxes;
      const inset = Math.max(0, (slotWFor(c, cs) - g.cardW) / 2);
      if (centreX && inset > 0.5) centred.add(g.p.id);
      pos[g.p.id] = {
        x: colBaseX[c]! + (centreX ? inset : shiftXof(g, c)),
        y: rowBaseY[r]! + (anyRowLine ? shiftYof(g, r) : Math.max(0, (slotHFor(r, rs) - g.cardH) / 2)),
      };
    });
    return { pos, centred, w: ax - gutter + 8, h: ay - gutter + 8 };
  })();

  /**
   * Move the selected panel(s) by a keyboard nudge.
   *
   * Deliberately the same commit path a drag takes: from a computed grid mode it bakes the
   * frozen geometry first (one patch, one undo, nothing else jumps), exactly as dragging one
   * panel out of an aligned grid does. Without that, a nudge would silently re-flow the
   * whole figure. Only offered where dragging is — see the guard in `startPanelDrag`.
   */
  const nudgeSelectedBy = (dx: number, dy: number): boolean => {
    if (!onSetLayoutOptions || !absolute) return false;
    // A group moves as one: expand the selection to whole groups, then drop locked members.
    const ids = [...withGroupMembers(layout, new Set(actIds()))]
      .filter((id) => panelPlots.some((p) => p.id === id))
      .filter((id) => !lockedOf(id)); // a locked panel ignores nudges
    if (ids.length === 0) return false;
    const needFreeze = !freeform && gridMode;
    const snap = needFreeze ? snapshotGeometry() : null;
    const pos: Record<NodeId, { x: number; y: number }> = { ...(snap ? snap.pos : (layout.panelPositions ?? {})) };
    for (const id of ids) {
      const i = panelPlots.findIndex((p) => p.id === id);
      const cur = pos[id] ?? posOf(id, i < 0 ? 0 : i);
      pos[id] = { x: Math.max(0, Math.round(cur.x + dx)), y: Math.max(0, Math.round(cur.y + dy)) };
    }
    if (snap) onSetLayoutOptions({ ...FREEZE_FLAGS, panelPositions: pos, panelSizes: snap.size });
    else onSetLayoutOptions({ panelPositions: pos });
    return true;
  };

  /**
   * Apply a picked layout preset: columns + per-slot spans (slot i = panels[i], the A/B/C
   * order — the same order the aligned grid packs by) + the aligned-grid flags, in one
   * undoable patch. Graphs are never reassigned; only the shape changes. `undefined`
   * span/rowSpan clears any previous preset's spans, so switching presets never leaves a
   * stale span behind.
   */
  const applyLayoutPreset = (pr: LayoutPreset): void => {
    if (!onSetLayoutOptions) return;
    const span: Record<NodeId, number> = {};
    const rowSpan: Record<NodeId, number> = {};
    panelPlots.forEach((p, i) => {
      const cs = pr.span?.[i] ?? 1;
      const rs = pr.rowSpan?.[i] ?? 1;
      if (cs > 1) span[p.id] = cs;
      if (rs > 1) rowSpan[p.id] = rs;
    });
    onSetLayoutOptions({
      columns: pr.columns,
      panelSpan: Object.keys(span).length > 0 ? span : undefined,
      panelRowSpan: Object.keys(rowSpan).length > 0 ? rowSpan : undefined,
      alignX: true,
      alignY: true,
      labelAlignX: true,
      labelAlignY: true,
      freeform: false,
    });
  };

  /** Stamp a saved house style onto this figure. Only the arrangement travels —
   *  never which graphs are in the figure, nor anything keyed by plot id. */
  const applyFigureTemplate = (name: string): void => {
    const t = figTemplates.find((x) => x.name === name);
    if (!t || !onSetLayoutOptions) return;
    // figureTemplatePatch, not t.layout: the stored JSON has lost the explicit-undefined
    // markers, so a plain template must re-assert them to be able to turn options off.
    onSetLayoutOptions(figureTemplatePatch(t));
  };
  /** Save the current arrangement as a reusable house style. */
  const commitTemplateSave = (): void => {
    const name = (templateName ?? "").trim();
    setTemplateName(null);
    if (!name) return;
    saveFigureTemplate(name, captureFigureTemplate(layout));
    setFigTemplates(listFigureTemplates());
  };
  const removeFigureTemplate = (name: string): void => {
    deleteFigureTemplate(name);
    setFigTemplates(listFigureTemplates());
  };

  /**
   * Re-letter the panels to match reading order: left-to-right within a row,
   * rows top-to-bottom. Letters follow `panels` order, so after dragging panels around the
   * lettering can stop matching what the eye does — with no way back but manual reordering.
   *
   * Rows are detected by clustering the panels' vertical centres, so "the same row" means
   * what it looks like rather than requiring pixel-identical tops. Panels the figure lists
   * but cannot resolve (a deleted source table) are kept, at the end, so renumbering can
   * never silently drop one.
   */
  /** Panels in reading order of the current arrangement: row bands top-to-bottom
   *  (clustered, so "same row" means what it looks like), then left-to-right. */
  const readingOrder = (): NodeId[] => {
    const centres = geoms.map((g) => posOf(g.p.id, g.i).y + g.cardH / 2);
    const rowBands = cluster1D(centres, (median(geoms.map((g) => g.cardH)) || PANEL_H) * 0.5);
    return geoms
      .map((g, i) => ({ id: g.p.id, row: nearestIdx(centres[i]!, rowBands), x: posOf(g.p.id, g.i).x }))
      .sort((a, b) => a.row - b.row || a.x - b.x)
      .map((k) => k.id);
  };
  /**
   * Engage "Align all": flags + a reset of the panel positions to the canonical dense grid,
   * in reading order. The aligner derives rows/columns by clustering the stored positions,
   * so scattered ones (hand-dragged, or stale saved state) would be reproduced faithfully as
   * a sprawling grid. The one-click button's contract is a dense aligned figure from any
   * arrangement, so it re-seeds the grid itself; the individual Align X/Y chips still
   * respect the current arrangement. One patch, one undo.
   */
  const engageAlignAll = (): void => {
    if (!onSetLayoutOptions) return;
    const pos: Record<NodeId, { x: number; y: number }> = {};
    readingOrder().forEach((id, k) => {
      pos[id] = { x: 8 + (k % layoutCols) * (PANEL_W + gutter), y: 8 + Math.floor(k / layoutCols) * (PANEL_H + gutter) };
    });
    onSetLayoutOptions({
      alignX: true,
      alignY: true,
      labelAlignX: true,
      labelAlignY: true,
      freeform: false,
      ...(Object.keys(pos).length > 0 ? { panelPositions: pos } : {}),
    });
  };
  const renumberByPosition = (): void => {
    if (!onSetLayoutOptions || geoms.length < 2) return;
    const ordered = readingOrder();
    const known = new Set(ordered);
    const unresolved = layout.panels.filter((id) => !known.has(id)); // never drop a panel
    const next = [...ordered, ...unresolved];
    if (next.length === layout.panels.length && next.every((id, i) => id === layout.panels[i])) return; // already in order
    onSetLayoutOptions({ panels: next });
  };

  // Arrow keys nudge the selection by 1px, Shift+arrow by 10 — the ruler, grid and magnetic
  // snap all promise a precision the mouse alone cannot give. Registered once and driven
  // through a ref, so the handler can never close over a stale layout.
  const nudgeRef = useRef(nudgeSelectedBy);
  nudgeRef.current = nudgeSelectedBy;
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const t = e.target as HTMLElement | null;
      // never steal the arrow keys from a field the user is typing/choosing in
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      if (e.defaultPrevented) return; // the datasheet (Ctrl+D fill-down) or a graph got it first
      if ((e.ctrlKey || e.metaKey) && !e.altKey) {
        const k = e.key.toLowerCase();
        if (k === "a") { if (selectAllRef.current()) e.preventDefault(); return; }
        if (k === "d") { if (duplicateRef.current()) e.preventDefault(); return; }
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const step = e.shiftKey ? 10 : 1;
      const d =
        e.key === "ArrowLeft" ? [-step, 0]
        : e.key === "ArrowRight" ? [step, 0]
        : e.key === "ArrowUp" ? [0, -step]
        : e.key === "ArrowDown" ? [0, step]
        : null;
      if (!d) return;
      // Only swallow the key when something is actually selected to move, so arrow keys
      // still scroll the page when the figure has no selection.
      const moved = nudgeRef.current(d[0]!, d[1]!);
      if (moved) e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  /** A panel's top-left: aligned position when aligning, else its base position. */
  const posOf = (id: NodeId, i: number): { x: number; y: number } => {
    const a = gridMode ? alignedLayout?.pos[id] : undefined;
    return a ?? basePos(id, i);
  };
  const absolute = freeform || gridMode;
  // Snapshot the current rendered geometry of every panel (aligned/grid positions +
  // the scene sizes actually shown, incl. axis-align & uniform stretch). Used to freeze
  // the figure into free-drag when the user hand-nudges/resizes a single panel from a
  // grid mode: seeding panelPositions/panelSizes with these values means nothing jumps.
  // Reads the pre-freeze `geoms`/`posOf` (this closure is built while freeze is null).
  const snapshotGeometry = (): { pos: Record<NodeId, { x: number; y: number }>; size: Record<NodeId, { w: number; h: number }>; card: Record<NodeId, { w: number; h: number }> } => {
    const pos: Record<NodeId, { x: number; y: number }> = {};
    const size: Record<NodeId, { w: number; h: number }> = {};
    const card: Record<NodeId, { w: number; h: number }> = {};
    for (const g of geoms) {
      const p = posOf(g.p.id, g.i);
      pos[g.p.id] = { x: Math.round(p.x), y: Math.round(p.y) };
      size[g.p.id] = { w: Math.round(g.scene.width * g.k), h: Math.round(g.scene.height * g.k) };
      card[g.p.id] = { w: Math.round(g.cardW), h: Math.round(g.cardH) };
    }
    return { pos, size, card };
  };
  // Patch keys that switch a frozen figure to free-drag (drop every auto-align flag).
  const FREEZE_FLAGS: Partial<FigureLayout> = { freeform: true, alignX: undefined, alignY: undefined, uniformRowHeight: undefined, uniformColumnWidth: undefined };
  // --- Arrange: align / distribute / equalise the selected panels in one click ---
  // Freeze the whole figure into free-drag (so nothing else moves + it works from any
  // mode), then bake the engine's new positions/sizes for the selected panels. One undo.
  const applyArrange = (op: AlignOp): void => {
    if (!onSetLayoutOptions) return;
    const snap = snapshotGeometry();
    const gById = new Map(geoms.map((g) => [g.p.id, g]));
    const sel = [...arrangeSel].filter((id) => gById.has(id) && !lockedOf(id)); // locked panels stay put
    if (sel.length < 2) return;
    const panels: PanelBox[] = sel.map((id) => {
      const g = gById.get(id)!;
      return { id, x: snap.pos[id]!.x, y: snap.pos[id]!.y, cardW: g.cardW, cardH: g.cardH, sceneW: snap.size[id]!.w, sceneH: snap.size[id]!.h };
    });
    const patch = arrangePanels(panels, op);
    onSetLayoutOptions({
      ...FREEZE_FLAGS,
      panelPositions: patch.positions ? { ...snap.pos, ...patch.positions } : snap.pos,
      panelSizes: patch.sizes ? { ...snap.size, ...patch.sizes } : snap.size,
    });
  };
  // --- Object tools: front/back, centre on figure, lock, duplicate ---
  /** Restack the selection above (or below) every other panel. `panelZ`, not `panels`:
   *  the panels order is the A/B/C lettering, and stacking must never renumber it. */
  const restack = (to: "front" | "back"): void => {
    const ids = actIds();
    if (!onSetLayoutOptions || ids.length === 0) return;
    onSetLayoutOptions({ panelZ: restackPanels(panelPlots.map((p) => p.id), layout.panelZ, ids, to) });
  };
  /** Centre the selection (rigid group) on the union of all panels — the exported page. */
  const centerSel = (axis: "h" | "v"): void => {
    if (!onSetLayoutOptions) return;
    const snap = snapshotGeometry();
    const all: PanelBox[] = geoms.map((g) => ({
      id: g.p.id,
      x: snap.pos[g.p.id]!.x,
      y: snap.pos[g.p.id]!.y,
      cardW: g.cardW,
      cardH: g.cardH,
      sceneW: snap.size[g.p.id]!.w,
      sceneH: snap.size[g.p.id]!.h,
    }));
    const sel = new Set(actIds().filter((id) => !lockedOf(id)));
    const patch = centerPanelsOnFigure(all, sel, axis);
    if (Object.keys(patch).length === 0) return;
    onSetLayoutOptions({ ...FREEZE_FLAGS, panelPositions: { ...snap.pos, ...patch }, panelSizes: snap.size });
  };
  /** Lock the selection if any of it is unlocked; unlock it when everything already is. */
  const toggleLock = (): void => {
    const ids = actIds();
    if (!onSetLayoutOptions || ids.length === 0) return;
    const lockAll = ids.some((id) => !lockedOf(id));
    const cur = { ...(layout.panelLocked ?? {}) };
    for (const id of ids) {
      if (lockAll) cur[id] = true;
      else delete cur[id];
    }
    onSetLayoutOptions({ panelLocked: Object.keys(cur).length > 0 ? cur : undefined });
  };
  const duplicateSel = (): void => {
    if (!onDuplicatePanel) return;
    for (const id of actIds()) onDuplicatePanel(id);
  };
  // Ctrl+A selects every panel; Ctrl+D duplicates the selection (never while a graph's own
  // annotation is selected — PlotFigure's Ctrl+D duplicates that). Both report whether they acted.
  selectAllRef.current = (): boolean => {
    if (panelPlots.length === 0) return false;
    setArrangeSel(new Set(panelPlots.map((p) => p.id)));
    setAnnSel(null);
    return true;
  };
  duplicateRef.current = (): boolean => {
    if (!onDuplicatePanel || actIds().length === 0 || editing?.selection?.kind === "annotation") return false;
    duplicateSel();
    return true;
  };
  /**
   * Marquee selection: press on empty canvas — the root itself, never a panel or an
   * object, which handle their own presses — and drag past the click slop to rubber-band the
   * panels whose cards it touches (Shift adds to the selection). A press that never moves is a
   * click on nothing: it clears the panel and object selections.
   */
  const startMarquee = (e: React.PointerEvent): void => {
    const root = canvasRef.current;
    if (e.button !== 0 || !root || e.target !== root) return;
    const cr = root.getBoundingClientRect();
    const sx = e.clientX, sy = e.clientY, shift = e.shiftKey;
    const toCanvas = (cx: number, cy: number): { x: number; y: number } => ({ x: (cx - cr.left) / viewZoom, y: (cy - cr.top) / viewZoom });
    const o = toCanvas(sx, sy);
    let armed = false;
    const onMove = (ev: PointerEvent): void => {
      if (!armed && !exceedsPanelDragSlop(ev.clientX - sx, ev.clientY - sy)) return;
      armed = true;
      const p = toCanvas(ev.clientX, ev.clientY);
      setMarquee({ x0: o.x, y0: o.y, x1: p.x, y1: p.y });
    };
    const onUp = (ev: PointerEvent): void => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      setMarquee(null);
      // A click on nothing picks nothing — the panel being edited too, which brings back the Inspector's Figure view.
      if (!armed) { setArrangeSel(new Set()); setAnnSel(null); editing?.onClearPanel?.(); return; }
      const p = toCanvas(ev.clientX, ev.clientY);
      const boxes = geoms.map((g) => { const pos = posOf(g.p.id, g.i); return { id: g.p.id, left: pos.x, top: pos.y, w: g.cardW, h: g.cardH }; });
      const hits = marqueeHits({ x0: o.x, y0: o.y, x1: p.x, y1: p.y }, boxes);
      setArrangeSel((prev) => (shift || ev.shiftKey ? new Set([...prev, ...hits]) : new Set(hits)));
      setAnnSel(null);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };
  /**
   * guides: a press on a ruler pulls out a new guide (`idx` undefined); a press on a drawn guide moves
   * it (`idx` = its place in the list). The line follows the pointer in canvas px; dropped on the
   * canvas it is stored, dropped back past the canvas edge (onto the ruler) it is dropped / removed.
   * Window listeners, so the drop is seen wherever the pointer ends up.
   */
  const commitGuides = (axis: "v" | "h", list: number[]): void => {
    if (!onSetLayoutOptions) return;
    const next: NonNullable<FigureLayout["guides"]> = { ...(layout.guides ?? {}) };
    if (list.length > 0) next[axis] = list;
    else delete next[axis];
    onSetLayoutOptions({ guides: next.v || next.h ? next : undefined });
  };
  const removeGuide = (axis: "v" | "h", idx: number): void =>
    commitGuides(axis, (layout.guides?.[axis] ?? []).filter((_, k) => k !== idx));
  const startGuideDrag = (axis: "v" | "h", e: React.PointerEvent, idx?: number): void => {
    const canvas = canvasRef.current;
    if (!onSetLayoutOptions || !canvas || e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    const cr = canvas.getBoundingClientRect();
    const at = (ev: { clientX: number; clientY: number }): number =>
      Math.round(axis === "v" ? (ev.clientX - cr.left) / viewZoom : (ev.clientY - cr.top) / viewZoom);
    let moved = false;
    const onMove = (ev: PointerEvent): void => { moved = true; setGuideDrag({ axis, idx, pos: at(ev) }); };
    const onUp = (ev: PointerEvent): void => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      setGuideDrag(null);
      if (!moved) return; // a click on a ruler or a guide adds / moves nothing
      const pos = at(ev);
      const cur = layout.guides?.[axis] ?? [];
      if (pos < 0) { if (idx !== undefined) removeGuide(axis, idx); return; }
      commitGuides(axis, idx === undefined ? [...cur, pos] : cur.map((g, k) => (k === idx ? pos : g)));
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };
  // Free-drag: pressing a panel arms a move; it only actually starts once the pointer moves
  // past a small threshold. So a click still selects + edits the graph (colour / axes / bar
  // width / …), while a real drag-with-the-mouse moves the panel. Window listeners drive it.
  const startPanelDrag = (e: React.PointerEvent, id: NodeId, i: number): void => {
    if (e.shiftKey) return; // shift-click = Arrange multi-select (mousedown), never a drag
    if (lockedOf(id)) return; // locked panel: a click still edits the graph, it just can't move
    if ((!freeform && !gridMode) || !onSetLayoutOptions || e.button !== 0) return; // need a positionable mode
    const t = e.target as HTMLElement;
    if (t.closest(".laypanel-x") || t.closest(".laypanel-resize") || t.closest(".laypanel-letter")) return;
    const canvas = canvasRef.current;
    const fig = (e.currentTarget as HTMLElement).closest(".laypanel") as HTMLElement | null;
    if (!canvas || !fig) return;
    // Dragging from an auto-align mode: the first real move freezes the current geometry
    // into free-drag (below), so the others stay put and only this panel follows.
    const didFreeze = gridMode && !freeform;
    let snap: ReturnType<typeof snapshotGeometry> | null = null;
    const sx = e.clientX, sy = e.clientY;
    let d: { id: NodeId; sx: number; sy: number; ox: number; oy: number; w: number; h: number; others: { left: number; top: number; w: number; h: number; axis?: AxisOffsets | undefined }[]; myAxis?: AxisOffsets | undefined; cw: number; ch: number; curX: number; curY: number } | null = null;
    // getBoundingClientRect is in screen px; the canvas is drawn at `viewZoom`, so divide every
    // screen distance by it to get the logical (stored) coordinates the snap math works in.
    const z = viewZoom;
    const begin = (): void => {
      const cr = canvas.getBoundingClientRect();
      const others: { left: number; top: number; w: number; h: number; axis?: AxisOffsets | undefined }[] = [];
      canvas.querySelectorAll<HTMLElement>(".laypanel").forEach((el) => {
        if (el === fig) return;
        const r = el.getBoundingClientRect();
        const pid = el.getAttribute("data-pid");
        others.push({ left: (r.left - cr.left) / z, top: (r.top - cr.top) / z, w: r.width / z, h: r.height / z, axis: pid ? axisOffById[pid] : undefined });
      });
      const fr = fig.getBoundingClientRect();
      const p0 = posOf(id, i);
      d = { id, sx, sy, ox: p0.x, oy: p0.y, w: fr.width / z, h: fr.height / z, others, myAxis: axisOffById[id], cw: cr.width / z, ch: cr.height / z, curX: p0.x, curY: p0.y };
      dragRef.current = d;
      // Freeze the aligned geometry into free-drag on the first real move (not a click).
      if (didFreeze && !snap) { snap = snapshotGeometry(); setFreeze(snap); }
      setDrag({ id, x: p0.x, y: p0.y, ox: p0.x, oy: p0.y });
    };
    const onMove = (ev: PointerEvent): void => {
      if (!d) {
        // Euclidean slop: a click on a small target commonly jitters a few px in one axis, which a
        // per-axis test would read as a drag. Keep it a click until the press travels PANEL_DRAG_SLOP.
        if (!exceedsPanelDragSlop(ev.clientX - sx, ev.clientY - sy)) return; // below threshold = still a click
        begin();
      }
      ev.preventDefault();
      const nx = Math.max(0, d!.ox + (ev.clientX - d!.sx) / z);
      const ny = Math.max(0, d!.oy + (ev.clientY - d!.sy) / z);
      const s0 = snapPanels(nx, ny, d!.w, d!.h, d!.others, d!.cw, d!.ch, 6, d!.myAxis, layout.guides);
      const s = showGrid && layout.snapToGrid ? { ...s0, ...applyGridSnap(s0, GRID_STEP) } : s0;
      d!.curX = s.x; d!.curY = s.y;
      setDrag({ id: d!.id, ox: d!.ox, oy: d!.oy, ...s });
    };
    const onUp = (): void => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      if (!d) { if (snap) setFreeze(null); return; } // threshold not crossed → a click; undo any freeze
      // Swallow the click the browser fires after a drag so it doesn't also select an element.
      fig.addEventListener("click", (ce) => { ce.stopPropagation(); ce.preventDefault(); }, { capture: true, once: true });
      const fx = Math.round(d.curX), fy = Math.round(d.curY);
      dragRef.current = null;
      setDrag(null);
      // Grouped panels follow: every other unlocked member of the dragged panel's group
      // translates by the same delta, in the same patch (one undo).
      const dd = d;
      if (didFreeze && snap) {
        const frozen = snap.pos;
        const mates = groupDragPatch(layout, dd.id, fx, fy, (mid) => (mid === dd.id ? { x: dd.ox, y: dd.oy } : frozen[mid] ?? { x: 0, y: 0 }));
        // One patch, one undo: bake the frozen positions/sizes + this panel's new spot,
        // and drop the auto-align flags. Reproduces the frozen view → nothing else moves.
        onSetLayoutOptions({ ...FREEZE_FLAGS, panelPositions: { ...snap.pos, [d.id]: { x: fx, y: fy }, ...mates }, panelSizes: snap.size });
        setFreeze(null); // committed layout already encodes the freeze (in place) → clear now, no flash
      } else {
        const mates = groupDragPatch(layout, dd.id, fx, fy, (mid) => (mid === dd.id ? { x: dd.ox, y: dd.oy } : posOf(mid, layout.panels.indexOf(mid))));
        onSetLayoutOptions({ panelPositions: { ...(layout.panelPositions ?? {}), [d.id]: { x: fx, y: fy }, ...mates } });
      }
    };
    // Robustness: a pointercancel must never leave the freeze stuck on. Abort without committing.
    const onCancel = (): void => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      dragRef.current = null;
      setDrag(null);
      if (snap) setFreeze(null);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
  };
  // --- per-panel graph resize (drag the corner handle at the graph's corner) ---
  // Two-level resize: this handle resizes the graph only. The card is
  // pinned at its pre-gesture box (all cards, when a grid freeze is involved), so resizing
  // the drawing does not move the card — or the aligned grid around it. The card still
  // floors at the graph, so growing past the pinned box grows the card with it.
  /**
   * Commit a panel's graph size — the one path the resize handle and the typed W/H fields share.
   * From an auto-align mode the layout is frozen first (`snap`: the handle takes it at the
   * gesture's first move, a typed field takes it here) and every card is pinned at its frozen
   * box, so the aligned look survives the resize — one patch, one undo. In free-drag: the size
   * alone, with no hidden card pinning (invisible cardSizes writes would distort later
   * aligns); the card follows the graph, decoupled only where the user sized it by its edges.
   */
  const commitPanelSize = (id: NodeId, size: { w: number; h: number }, snap: ReturnType<typeof snapshotGeometry> | null): void => {
    if (!onSetLayoutOptions) return;
    const sz = { w: clamp(Math.round(size.w), 200, 1100), h: clamp(Math.round(size.h), 140, 820) };
    const frozen = snap ?? (gridMode && !freeform ? snapshotGeometry() : null);
    if (frozen) {
      onSetLayoutOptions({
        ...FREEZE_FLAGS,
        panelPositions: frozen.pos,
        panelSizes: { ...frozen.size, [id]: sz },
        cardSizes: { ...(layout.cardSizes ?? {}), ...frozen.card },
      });
    } else {
      onSetLayoutOptions({ panelSizes: { ...(layout.panelSizes ?? {}), [id]: sz } });
    }
  };
  const startResize = (e: React.PointerEvent, id: NodeId): void => {
    if (!onSetLayoutOptions || e.button !== 0 || lockedOf(id)) return;
    e.preventDefault(); e.stopPropagation();
    // Origin from the currently rendered size (scene incl. align/uniform stretch), not the
    // stored panelSizes — so the handle is continuous in every mode.
    const g = geoms.find((x) => x.p.id === id);
    const sz = g ? { w: Math.round(g.scene.width * g.k), h: Math.round(g.scene.height * g.k) } : sizeOf(id);
    // Resizing from an auto-align mode: the first real drag freezes the geometry into
    // free-drag so the graph can escape the forced axis/uniform size and grow live.
    const didFreeze = gridMode && !freeform;
    let snap: ReturnType<typeof snapshotGeometry> | null = null;
    const r = { id, sx: e.clientX, sy: e.clientY, w0: sz.w, h0: sz.h, cw: sz.w, ch: sz.h };
    resizeRef.current = r;
    setResize({ id, w: sz.w, h: sz.h });
    const onMove = (ev: PointerEvent): void => {
      if (didFreeze && !snap) {
        if (Math.abs(ev.clientX - r.sx) < 3 && Math.abs(ev.clientY - r.sy) < 3) return; // click, not a resize
        snap = snapshotGeometry(); setFreeze(snap);
      }
      r.cw = clamp(Math.round(r.w0 + (ev.clientX - r.sx) / viewZoom), 200, 1100);
      r.ch = clamp(Math.round(r.h0 + (ev.clientY - r.sy) / viewZoom), 140, 820);
      setResize({ id: r.id, w: r.cw, h: r.ch });
    };
    const onUp = (): void => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      resizeRef.current = null;
      setResize(null);
      if (didFreeze) {
        if (!snap) return; // never moved → it was a click, don't switch modes
        commitPanelSize(r.id, { w: r.cw, h: r.ch }, snap);
        setFreeze(null); // committed layout already encodes the freeze (in place) → clear now, no flash
      } else {
        commitPanelSize(r.id, { w: r.cw, h: r.ch }, null);
      }
    };
    // Robustness: a pointercancel must never leave the freeze stuck on. Abort without committing.
    const onCancel = (): void => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      resizeRef.current = null;
      setResize(null);
      if (snap) setFreeze(null);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
  };
  // --- per-panel card resize (drag the card's edges): sizes the outer box only. ---
  const startCardResize = (e: React.PointerEvent, id: NodeId, dir: "e" | "s" | "se"): void => {
    if (!onSetLayoutOptions || e.button !== 0 || lockedOf(id)) return;
    e.preventDefault(); e.stopPropagation();
    const g = geoms.find((x) => x.p.id === id);
    if (!g) return;
    const c0 = { w: Math.round(g.cardW), h: Math.round(g.cardH) };
    // the card can never shrink below its graph + chrome (no clipping, ever)
    const minW = Math.round(g.scene.width * g.k + 2 * CARD_PAD);
    const minH = Math.round(headerOff + g.scene.height * g.k + CARD_PAD);
    const r = { id, sx: e.clientX, sy: e.clientY, w: c0.w, h: c0.h };
    setCardResize({ id, w: c0.w, h: c0.h });
    const onMove = (ev: PointerEvent): void => {
      r.w = dir === "s" ? r.w : Math.max(minW, Math.round(c0.w + (ev.clientX - r.sx) / viewZoom));
      r.h = dir === "e" ? r.h : Math.max(minH, Math.round(c0.h + (ev.clientY - r.sy) / viewZoom));
      setCardResize({ id, w: r.w, h: r.h });
    };
    const done = (commit: boolean): void => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      setCardResize(null);
      if (!commit || (Math.abs(r.w - c0.w) < 2 && Math.abs(r.h - c0.h) < 2)) return;
      const cur = { ...(layout.cardSizes ?? {}) };
      // shrunk back to the derived floor → store nothing (the card hugs the graph again)
      if (r.w <= minW + 1 && r.h <= minH + 1) delete cur[id];
      else cur[id] = { w: r.w, h: r.h };
      onSetLayoutOptions({ cardSizes: Object.keys(cur).length > 0 ? cur : undefined });
    };
    const onUp = (): void => done(true);
    const onCancel = (): void => done(false);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
  };
  // --- draggable A/B/C label (with magnetic snap to other labels) ---
  const LABEL_DEFAULT = { x: 4, y: headerOff }; // top-left corner of the graph, minimal background
  /** Default letter placement: the graph's top-left corner — but never on its ink.
   *
   *  The corner only works while the graph's top-left margin can hold the letter, and a
   *  miniature (k<1) shrinks that margin while the HTML letter keeps its screen size
   *  (e.g. a letter landing on a heatmap's first row label, or on a violin's top
   *  tick label — a violin's label margin can be too thin even at k=1). Whether the
   *  corner is clear is computed from the scene, never guessed: the letter must clear the
   *  y tick labels horizontally (their real measured width) or vertically (the topmost
   *  labelled tick's glyph box). A panel with no labelled y ticks (heatmap grid, treemap,
   *  network…) has content everywhere — its corner is never clear.
   *
   *  If any panel's corner fails, every letter floats just above its panel's svg instead —
   *  one rule per figure, because corner letters and floating letters mixed in one figure
   *  read as a mistake. The canvas already grows for labels above cards, and a stored
   *  labelPos always wins — only letters nobody has touched move. */
  const LETTER_GAP = 2;
  const letterSizePx = layout.letterSize ?? 22; // matches .laypanel-letter-float's CSS font-size
  const letterBoxH = Math.round(letterSizePx * 1.1) + 4; // line-height 1.1 + 2px padding each way
  const lettersLifted =
    lettering !== "none" &&
    geoms.some((g) => {
      const letterW = Math.ceil(measureText(letterOf(g.p.id, g.i) || "W", letterSizePx)) + 8;
      // The Y-axis title can reach the corner too (a long one, centred on the plot): the letter must clear it.
      const tb = yTitleBox(g.scene, measureText);
      if (tb) {
        const tl = g.insetL + tb.l * g.k, tr = g.insetL + tb.r * g.k, tt = g.insetT + tb.t * g.k, tbm = g.insetT + tb.b * g.k;
        const hitsTitle = LABEL_DEFAULT.x < tr + LETTER_GAP && tl - LETTER_GAP < LABEL_DEFAULT.x + letterW && LABEL_DEFAULT.y < tbm + LETTER_GAP && tt - LETTER_GAP < LABEL_DEFAULT.y + letterBoxH;
        if (hitsTitle) return true;
      }
      const labelled = g.scene.y?.ticks?.filter((t) => t.label) ?? [];
      if (labelled.length === 0) return true;
      const F = g.scene.fonts?.yTick?.size ?? 13;
      const maxW = Math.max(...labelled.map((t) => measureText(t.label, F)));
      const labelsLeft = g.insetL + (g.scene.plot.x - 10 - maxW) * g.k;
      const topLabelTop = g.insetT + (Math.min(...labelled.map((t) => t.pos)) - 0.75 * F) * g.k;
      const fitsLeft = LABEL_DEFAULT.x + letterW + LETTER_GAP <= labelsLeft;
      const fitsAbove = LABEL_DEFAULT.y + letterBoxH + LETTER_GAP <= topLabelTop;
      return !(fitsLeft || fitsAbove);
    });
  const defaultLabelPos = (_id: NodeId): { x: number; y: number } =>
    lettersLifted ? { x: LABEL_DEFAULT.x, y: headerOff - letterBoxH - LETTER_GAP } : LABEL_DEFAULT;
  // Label auto-align works per column / per row (like the axis alignment) so labels never
  // superimpose: "Align ↔" (labelAlignX) gives every label in a column the same screen X (the
  // column's left-most label); "Align ↕" (labelAlignY) gives every label in a row the same
  // screen Y (the row's top-most label). A panel
  // whose card sits elsewhere gets whatever offset lines it up — even one outside its card.
  /** A card centred in its column (no axis line to follow, or "Centre no-axis") keeps its letter at its own card —
   *  pulled to the column's letter line it would sit away from its card. */
  const letterWithCard = (p: Plot): boolean => centredNoAxis(p) || (gridMode && !!alignedLayout?.centred.has(p.id));
  const labelGrid = (() => {
    if ((!labelAlignX && !labelAlignY) || geoms.length === 0) return null;
    const bases = geoms.map((g, i) => posOf(g.p.id, i));
    const medW = median(geoms.map((g) => g.cardW)) || PANEL_W;
    const medH = median(geoms.map((g) => g.cardH)) || PANEL_H;
    // On a known grid, the letters' rows/columns are the grid's: a spanning card sits in the row
    // (column) of its first slot, where its letter is. Guessing rows from card centres puts a
    // Tall-left card's centre in the middle row and pulls that row's letter up onto the first
    // row's (one letter drawn on top of another, far above its own card). Free drag has no grid
    // (and no spans), so there the rows are still found from where the cards sit.
    const colCentres = cluster1D(geoms.map((g, i) => bases[i]!.x + g.cardW / 2), medW * 0.5);
    const rowCentres = cluster1D(geoms.map((g, i) => bases[i]!.y + g.cardH / 2), medH * 0.5);
    const col = geoms.map((g, i) => gridAssign?.assign[i]?.c ?? nearestIdx(bases[i]!.x + g.cardW / 2, colCentres));
    const row = geoms.map((g, i) => gridAssign?.assign[i]?.r ?? nearestIdx(bases[i]!.y + g.cardH / 2, rowCentres));
    // Reference per column / row = the top-most (row) / left-most (column) label anchor of
    // its members — not "the first panel encountered". With different-sized panels the first
    // panel's anchor can sit well below another card's top, and snapping to it would drop that
    // panel's letter into its own graph (e.g. a tall heatmap's letter landing inside its
    // plot, or a narrow card's letter pushed into the gutter). The min pulls
    // letters only ever up / left — into whitespace, never into a panel's drawing.
    const colRefX: Record<number, number> = {};
    const rowRefY: Record<number, number> = {};
    geoms.forEach((g, i) => {
      const b = layout.labelPos?.[g.p.id] ?? defaultLabelPos(g.p.id);
      const lx = bases[i]!.x + b.x;
      const ly = bases[i]!.y + b.y;
      if (!letterWithCard(g.p)) colRefX[col[i]!] = Math.min(colRefX[col[i]!] ?? Infinity, lx);
      rowRefY[row[i]!] = Math.min(rowRefY[row[i]!] ?? Infinity, ly);
    });
    const byId: Record<NodeId, { col: number; row: number }> = {};
    geoms.forEach((g, i) => { byId[g.p.id] = { col: col[i]!, row: row[i]! }; });
    return { byId, colRefX, rowRefY };
  })();
  /** A label's offset within its card: live drag, else stored, else default — with the
   *  auto-align toggles snapping it to its column's screen X (vertical) / row's screen Y. */
  const labelPosOf = (id: NodeId, i: number): { x: number; y: number } => {
    if (labelDrag && labelDrag.id === id) return { x: labelDrag.x, y: labelDrag.y };
    const base = layout.labelPos?.[id] ?? defaultLabelPos(id);
    if (!labelGrid) return base;
    const cardPos = posOf(id, i);
    const cell = labelGrid.byId[id];
    const p = panelPlots[i];
    // A card the aligner set lower than its row (its plot top lined up with its neighbours', a short card centred) keeps
    // its letter at its own card: pulled up to the row's letter line it would float well above its card.
    // Letters still share the row's line wherever that line touches their card. Free drag
    // is untouched: there the heights are the user's own, and the shared row line is what "align labels" asks for.
    const rowY = labelAlignY && cell ? labelGrid.rowRefY[cell.row] : undefined;
    const ownY = cardPos.y + base.y;
    const keepOwn = gridMode && rowY !== undefined && ownY - rowY > letterBoxH;
    return {
      x: labelAlignX && cell && !(p && letterWithCard(p)) && labelGrid.colRefX[cell.col] !== undefined ? labelGrid.colRefX[cell.col]! - cardPos.x : base.x,
      y: rowY !== undefined && !keepOwn ? rowY - cardPos.y : base.y,
    };
  };
  /** Commit an edited panel label. Text matching what the scheme would generate stores
   *  nothing — the label stays automatic, so it keeps re-lettering itself when panels are
   *  reordered. Anything else (including "" to hide just this one) is stored as an override. */
  const commitLetter = (id: NodeId, i: number): void => {
    const next = editLetter?.id === id ? editLetter.text : null;
    setEditLetter(null);
    if (next == null || !onSetLayoutOptions) return;
    const cur = layout.letterText ?? {};
    const isAuto = next === schemeLetter(i);
    if (isAuto ? cur[id] === undefined : cur[id] === next) return; // no-op — don't churn undo
    const letterText = { ...cur };
    if (isAuto) delete letterText[id];
    else letterText[id] = next;
    onSetLayoutOptions({ letterText: Object.keys(letterText).length > 0 ? letterText : undefined });
  };
  // Drag is driven by window pointer listeners (not element pointer-capture) so the move
  // is tracked even though the graph SVG paints over the label — robust + testable.
  const startLabelDrag = (e: React.PointerEvent, id: NodeId): void => {
    if (!onSetLayoutOptions) return;
    e.preventDefault(); e.stopPropagation();
    const labelEl = e.currentTarget as HTMLElement;
    const container = labelEl.closest(".laycanvas, .laygrid") as HTMLElement | null;
    const lr = labelEl.getBoundingClientRect();
    const cr = container ? container.getBoundingClientRect() : ({ left: 0, top: 0 } as DOMRect);
    const others: { cx: number; cy: number }[] = [];
    (container ?? document).querySelectorAll<HTMLElement>(".laypanel-letter").forEach((el) => {
      if (el === labelEl) return;
      const r = el.getBoundingClientRect();
      others.push({ cx: r.left + r.width / 2, cy: r.top + r.height / 2 });
    });
    const base = layout.labelPos?.[id] ?? defaultLabelPos(id);
    const d = { id, sx: e.clientX, sy: e.clientY, ox: base.x, oy: base.y, w: lr.width, h: lr.height, sl: lr.left, st: lr.top, cl: cr.left, ct: cr.top, others, curX: base.x, curY: base.y };
    labelDragRef.current = d;
    setLabelDrag({ id, x: base.x, y: base.y });
    const z = viewZoom;
    const onMove = (ev: PointerEvent): void => {
      // nx/ny are logical (stored) coords, so screen deltas divide by the view zoom; the snap
      // comparison stays in screen space (getBoundingClientRect centres), converting back to
      // logical (/z) only where it feeds nx/ny and the guide-line positions inside the canvas.
      let nx = d.ox + (ev.clientX - d.sx) / z;
      let ny = d.oy + (ev.clientY - d.sy) / z;
      const cx = d.sl + (ev.clientX - d.sx) + d.w / 2; // dragged label centre (screen)
      const cy = d.st + (ev.clientY - d.sy) + d.h / 2;
      const TH = 7;
      let snapX: number | null = null, snapY: number | null = null, bdx = TH + 1, bdy = TH + 1;
      for (const o of d.others) {
        const dx = Math.abs(cx - o.cx); if (dx < bdx && dx <= TH) { bdx = dx; snapX = o.cx; }
        const dy = Math.abs(cy - o.cy); if (dy < bdy && dy <= TH) { bdy = dy; snapY = o.cy; }
      }
      let gx: number | undefined, gy: number | undefined;
      if (snapX != null) { nx += (snapX - cx) / z; gx = (snapX - d.cl) / z; }
      if (snapY != null) { ny += (snapY - cy) / z; gy = (snapY - d.ct) / z; }
      // No clamp — the label may sit outside its card (incl. negative = left/above), so it
      // can clear the axes and line up with labels on differently-framed cards.
      d.curX = Math.round(nx);
      d.curY = Math.round(ny);
      setLabelDrag({ id: d.id, x: d.curX, y: d.curY, gx, gy });
    };
    const onUp = (): void => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      labelDragRef.current = null;
      setLabelDrag(null);
      onSetLayoutOptions({ labelPos: { ...(layout.labelPos ?? {}), [d.id]: { x: d.curX, y: d.curY } } });
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };
  // Canvas size grows to hold all panels (absolute layouts only).
  // The page: its outline sits behind the panels at the canvas origin, and the canvas is
  // at least the page. Only positionable canvases have one — the flow grid has nothing to draw on.
  const pageBox = layout.page ? pagePx(layout.page) : null;
  const canvasContent = gridMode && alignedLayout
    ? { w: alignedLayout.w, h: alignedLayout.h }
    : freeform
    ? geoms.reduce(
        (acc, g) => {
          const pos = (() => {
            if (drag && drag.id === g.p.id) return drag;
            const base = posOf(g.p.id, g.i);
            // Live group-follow: while a group mate drags, this member previews the same delta.
            if (drag && drag.ox != null && drag.oy != null) {
              const tag = layout.panelGroups?.[drag.id];
              if (tag && layout.panelGroups?.[g.p.id] === tag && !lockedOf(g.p.id)) {
                return { x: Math.max(0, base.x + drag.x - drag.ox), y: Math.max(0, base.y + drag.y - drag.oy) };
              }
            }
            return base;
          })();
          return { w: Math.max(acc.w, pos.x + g.cardW + 8), h: Math.max(acc.h, pos.y + g.cardH + 8) };
        },
        { w: 480, h: 320 },
      )
    : { w: 0, h: 0 };
  const canvasSize = pageBox && (freeform || gridMode)
    ? { w: Math.max(canvasContent.w, pageBox.w), h: Math.max(canvasContent.h, pageBox.h) }
    : canvasContent;
  const gridBg: React.CSSProperties = showGrid
    ? {
        backgroundImage:
          "linear-gradient(var(--line) 1px, transparent 1px), linear-gradient(90deg, var(--line) 1px, transparent 1px)",
        backgroundSize: `${GRID_STEP}px ${GRID_STEP}px`,
        borderRadius: 8,
      }
    : {};
  const gridStyle: React.CSSProperties = {
    gap: gutter,
    gridTemplateColumns: layout.columns ? `repeat(${layout.columns}, max-content)` : `repeat(auto-fill, max-content)`,
    justifyContent: "start",
    ...(showGrid ? { ...gridBg, padding: 8 } : {}),
  };
  /** X / Y / W / H of the one picked object or panel, in the ruler's unit (null when nothing single is picked). */
  const positionFields = (() => {
    // Size & position: X Y W H for
    // the one selected panel or canvas object, shown in the ruler's unit, committed in
    // whole px through the same paths a gesture uses — the nudge for X/Y (freezes a
    // computed grid, moves group mates, refuses a lock) and `commitPanelSize` for W/H.
    // Nothing renders unless exactly one thing is selected.
    const unit = rulerUnit.value;
    const unitName = unit === "px" ? "pixels" : unit === "in" ? "inches" : "centimetres";
    if (selectedAnn && onUpdateFigureAnnotation) {
      const a = selectedAnn;
      const locked = !!a.locked;
      const t = (what: string): string => (locked ? "Locked — unlock the object to move or size it" : `${what} of the object, in ${unitName}`);
      const isBox = a.kind === "rect" || a.kind === "ellipse" || a.kind === "image";
      const isLine = a.kind === "arrow" || a.kind === "segment" || a.kind === "callout";
      const moveTo = (nx: number, ny: number): void => {
        const patch: Partial<Annotation> = { x: nx, y: ny };
        if (isLine) { patch.x2 = (a.x2 ?? 0) + (nx - (a.x ?? 0)); patch.y2 = (a.y2 ?? 0) + (ny - (a.y ?? 0)); }
        onUpdateFigureAnnotation(a.id, patch);
      };
      return (
        <div className="layseg layfields" role="group">
          <NumField label="X" valuePx={a.x ?? 0} unit={unit} disabled={locked} title={t("Left edge")} onCommit={(px) => moveTo(px, a.y ?? 0)} />
          <NumField label="Y" valuePx={a.y ?? 0} unit={unit} disabled={locked} title={t("Top edge")} onCommit={(px) => moveTo(a.x ?? 0, px)} />
          {isBox && (
            <>
              <NumField label="W" valuePx={a.w ?? 0} unit={unit} disabled={locked} title={t("Width")}
                onCommit={(px) => onUpdateFigureAnnotation(a.id, lockAspect && a.w ? { w: px, h: Math.round(((a.h ?? 0) * px) / a.w) } : { w: px })} />
              <NumField label="H" valuePx={a.h ?? 0} unit={unit} disabled={locked} title={t("Height")}
                onCommit={(px) => onUpdateFigureAnnotation(a.id, lockAspect && a.h ? { h: px, w: Math.round(((a.w ?? 0) * px) / a.h) } : { h: px })} />
              <label className={`laychip${lockAspect ? " on" : ""}`} title="Keep the width-to-height ratio when you type one of them">
                <input type="checkbox" checked={lockAspect} onChange={(e) => setLockAspect(e.target.checked)} /> Lock aspect
              </label>
            </>
          )}
        </div>
      );
    }
    const one = actIds();
    if (selectedAnn || one.length !== 1) return null;
    const id = one[0]!;
    const i = panelPlots.findIndex((p) => p.id === id);
    const g = geoms.find((x) => x.p.id === id);
    if (!g || i < 0) return null;
    const pos = posOf(id, i);
    const w = Math.round(g.scene.width * g.k);
    const h = Math.round(g.scene.height * g.k);
    const locked = lockedOf(id);
    const aspectLocked = miniatures || lockAspect;
    const t = (what: string): string =>
      locked ? "Locked — unlock the panel to move or size it" : !absolute && (what === "Left edge" || what === "Top edge") ? "Positions apply in free-drag mode (or an aligned grid)" : `${what} of the panel's graph, in ${unitName}`;
    return (
      <div className="layseg layfields" role="group">
        <NumField label="X" valuePx={pos.x} unit={unit} disabled={locked || !absolute} title={t("Left edge")} onCommit={(px) => { nudgeSelectedBy(px - pos.x, 0); }} />
        <NumField label="Y" valuePx={pos.y} unit={unit} disabled={locked || !absolute} title={t("Top edge")} onCommit={(px) => { nudgeSelectedBy(0, px - pos.y); }} />
        <NumField label="W" valuePx={w} unit={unit} disabled={locked} title={t("Width")} onCommit={(px) => commitPanelSize(id, { w: px, h: aspectLocked ? Math.round((h * px) / w) : h }, null)} />
        <NumField label="H" valuePx={h} unit={unit} disabled={locked} title={t("Height")} onCommit={(px) => commitPanelSize(id, { w: aspectLocked ? Math.round((w * px) / h) : w, h: px }, null)} />
        <label className={`laychip${aspectLocked ? " on" : ""}`} title={miniatures ? "Keep proportions is on: the graph is one uniform scale, so width and height always change together" : "Keep the width-to-height ratio when you type one of them"}>
          <input type="checkbox" checked={aspectLocked} disabled={miniatures} onChange={(e) => setLockAspect(e.target.checked)} /> Lock aspect
        </label>
      </div>
    );
  })();
  /** The picked canvas object's own settings (colour, fill, text box, line, lock, delete). */
  const objectFields = selectedAnn && onUpdateFigureAnnotation ? (
    <>
      <label className="laypick-l laylbl" title="Object colour (line / text)">
        Colour
        <ColorInput
          value={selectedAnn.color ?? "#1a1a1a"}
          onChange={(v) => onUpdateFigureAnnotation(selectedAnn.id, { color: v || undefined })}
        />
      </label>
      {(selectedAnn.kind === "rect" || selectedAnn.kind === "ellipse" || selectedAnn.kind === "text") && (
        <label className="laypick-l laylbl" title={selectedAnn.kind === "text" ? "Background behind the words (empty = none)" : "Interior fill colour (empty = transparent)"}>
          {selectedAnn.kind === "text" ? "Background" : "Fill"}
          <ColorInput
            value={selectedAnn.fill ?? ""}
            onChange={(v) => onUpdateFigureAnnotation(selectedAnn.id, { fill: v || undefined })}
          />
        </label>
      )}
      {selectedAnn.kind === "text" && (
        // Text box: the same settings as a graph's text box (Inspector `TextBoxRows`), laid out for the
        // ribbon. Wrap width is canvas px here. Width / Dash below become the box border's once it has one.
        <>
          <label className="laypick-l laylbl" title="Box border colour (empty = none)">
            Border
            <ColorInput value={selectedAnn.borderColor ?? ""} onChange={(v) => onUpdateFigureAnnotation(selectedAnn.id, { borderColor: v || undefined })} />
          </label>
          <label className="laypick-l laylbl" title="Line the words up inside their box">
            Align
            <select
              className="selin"
              style={{ width: "auto" }}
              value={selectedAnn.align ?? "middle"}
              onChange={(e) => onUpdateFigureAnnotation(selectedAnn.id, { align: e.target.value === "middle" ? undefined : (e.target.value as "start" | "end") })}
            >
              <option value="start">Left</option>
              <option value="middle">Centre</option>
              <option value="end">Right</option>
            </select>
          </label>
          <label className="laypick-l laylbl" title="Wrap the words at this width (px); blank = no wrap">
            Wrap
            <input
              type="number" className="numin" style={{ width: 56 }} min={20} max={2000} step={10} placeholder="none"
              value={selectedAnn.w ?? ""}
              onChange={(e) => { const v = Number(e.target.value); onUpdateFigureAnnotation(selectedAnn.id, { w: e.target.value.trim() === "" || !(v > 0) ? undefined : v }); }}
            />
          </label>
          <label className="laypick-l laylbl" title="Space between the words and the box edge (px); blank = default">
            Pad
            <input
              type="number" className="numin" style={{ width: 42 }} min={0} max={60} step={1} placeholder="6"
              value={selectedAnn.padding ?? ""}
              onChange={(e) => onUpdateFigureAnnotation(selectedAnn.id, { padding: e.target.value.trim() === "" ? undefined : Number(e.target.value) })}
            />
          </label>
          <label className="laypick-l laylbl" title="Corner radius of the box (px); blank = default">
            Corner
            <input
              type="number" className="numin" style={{ width: 42 }} min={0} max={60} step={1} placeholder="4"
              value={selectedAnn.radius ?? ""}
              onChange={(e) => onUpdateFigureAnnotation(selectedAnn.id, { radius: e.target.value.trim() === "" ? undefined : Number(e.target.value) })}
            />
          </label>
        </>
      )}
      {(selectedAnn.kind !== "text" || selectedAnn.borderColor) && (
        <>
          <label className="laypick-l laylbl" title={selectedAnn.kind === "text" ? "Box border width (px)" : "Line width (px)"}>
            Width
            <input
              type="number"
              className="numin"
              style={{ width: 46 }}
              min={0.5}
              max={12}
              step={0.5}
              value={selectedAnn.width ?? (selectedAnn.kind === "text" ? 1 : 1.5)}
              onChange={(e) => onUpdateFigureAnnotation(selectedAnn.id, { width: Number(e.target.value) || undefined })}
            />
          </label>
          <label className="laypick-l laylbl" title="Line style">
            Dash
            <select
              className="selin"
              style={{ width: "auto" }}
              value={selectedAnn.dash ?? "solid"}
              onChange={(e) => onUpdateFigureAnnotation(selectedAnn.id, { dash: e.target.value === "solid" ? undefined : (e.target.value as Annotation["dash"]) })}
            >
              <option value="solid">Solid</option>
              <option value="dashed">Dashed</option>
              <option value="dotted">Dotted</option>
            </select>
          </label>
        </>
      )}
      {selectedAnn.kind === "text" && (
        <>
          <label className="laypick-l laylbl" title="Text size (px)">
            Size
            <input
              type="number"
              className="numin"
              style={{ width: 46 }}
              min={7}
              max={72}
              step={1}
              value={selectedAnn.size ?? 15}
              onChange={(e) => onUpdateFigureAnnotation(selectedAnn.id, { size: Number(e.target.value) || undefined })}
            />
          </label>
          <label className={`laychip${selectedAnn.bold ? " on" : ""}`} title="Bold">
            <input type="checkbox" checked={!!selectedAnn.bold} onChange={(e) => onUpdateFigureAnnotation(selectedAnn.id, { bold: e.target.checked || undefined })} />
            B
          </label>
          <label className={`laychip${selectedAnn.italic ? " on" : ""}`} title="Italic">
            <input type="checkbox" checked={!!selectedAnn.italic} onChange={(e) => onUpdateFigureAnnotation(selectedAnn.id, { italic: e.target.checked || undefined })} />
            I
          </label>
        </>
      )}
      <button
        type="button"
        className="layseg-btn"
        title={selectedAnn.locked ? "Unlock the object — allow moving / resizing / deleting again" : "Lock the object in place — no drag, resize or delete"}
        onClick={() => onUpdateFigureAnnotation(selectedAnn.id, { locked: selectedAnn.locked ? undefined : true })}
      >
        {selectedAnn.locked ? "🔓" : "🔒"}
      </button>
      {onRemoveFigureAnnotation && !selectedAnn.locked && (
        <button
          type="button"
          className="layseg-btn"
          title="Delete the object (Delete)"
          onClick={() => { const id = selectedAnn.id; setAnnSel(null); onRemoveFigureAnnotation(id); }}
        >
          ✕
        </button>
      )}
</>
  ) : null;
  /**
   * The figure's own settings — panel lettering, what each panel card shows, shared axes, one legend.
   * Set once per figure, so they live in the Inspector's Figure view (nothing
   * picked) instead of taking permanent toolbar rows. Absent a way to change
   * the figure (`onSetLayoutOptions`), there are none.
   */
  const figureControls = onSetLayoutOptions ? {
    renumber: (
    <button
      className="layseg-btn"
      disabled={panelPlots.length < 2}
      title="Re-letter the panels to match reading order — left to right, then top to bottom. Letters follow panel order, so dragging panels around can leave A/B/C out of step with the eye."
      onClick={renumberByPosition}
    >
      Renumber
    </button>
    ),
    oneLegend: (
    <label
      className={`laychip${mergeLegend ? " on" : ""}${sharedLegend ? "" : " laychip-na"}`}
      title={
        sharedLegend
          ? "One legend for the whole figure: the panels all plot the same series, so their repeated keys are merged into a single key below the figure and the space goes back to the graphs."
          : "Merged legend is unavailable here — the panels' legends differ (or fewer than two have one), and a single key cannot speak for series that don't match."
      }
    >
      <input
        type="checkbox"
        checked={mergeLegend}
        disabled={!sharedLegend}
        onChange={(e) => onSetLayoutOptions({ mergedLegend: e.target.checked || undefined })}
      />
      One&nbsp;legend
    </label>
    ),
    sharedAxes: (
    <label
      className={`laychip${sharedAxisLabels ? " on" : ""}`}
      title="Shared axes: label only the figure's outer edges — inner panels drop their repeated tick labels and axis titles, and the freed space goes back to the graph. Applied only where a panel genuinely shares that axis (same title, scale and ticks); panels with their own units keep their labels."
    >
      <input
        type="checkbox"
        checked={sharedAxisLabels}
        onChange={(e) => onSetLayoutOptions({ sharedAxisLabels: e.target.checked || undefined })}
      />
      Shared&nbsp;axes
    </label>
    ),
    labels: (
      <>
      <label className="laypick-l laylbl" title="Panel-label scheme (A B C · a b c · 1 2 3 · none)">
        Lettering
        <select
          className="selin"
          style={{ width: "auto" }}
          value={layout.lettering ?? "upper"}
          onChange={(e) => onSetLayoutOptions({ lettering: e.target.value as NonNullable<FigureLayout["lettering"]> })}
        >
          <option value="upper">A B C</option>
          <option value="lower">a b c</option>
          <option value="numeric">1 2 3</option>
          <option value="none">None</option>
        </select>
      </label>
      <label className="laypick-l laylbl" title="Font family for the panel labels (A, B, C…)">
        Font
        <select
          className="selin"
          style={{ width: "auto" }}
          value={layout.letterFont ?? ""}
          onChange={(e) => onSetLayoutOptions({ letterFont: e.target.value || undefined })}
        >
          {FONT_FAMILIES.map((f) => (
            <option key={f.label} value={f.value}>{f.label}</option>
          ))}
        </select>
      </label>
      <label className="laypick-l laylbl" title="Panel-label font size (px)">
        Size
        <input
          type="number"
          className="numin"
          style={{ width: 50 }}
          min={8}
          max={72}
          step={1}
          value={layout.letterSize ?? 22}
          onChange={(e) => onSetLayoutOptions({ letterSize: Number(e.target.value) === 22 ? undefined : Number(e.target.value) })}
        />
      </label>
      <label className={`laychip${(layout.letterBold ?? true) ? " on" : ""}`} title="Bold panel labels">
        <input type="checkbox" checked={layout.letterBold ?? true} onChange={(e) => onSetLayoutOptions({ letterBold: e.target.checked ? undefined : false })} />
        Bold
      </label>
      <span className="laycolour" title="Panel-label colour — pick a preset or a custom colour">
        {LABEL_SWATCHES.map((c) => (
          <button
            key={c}
            className={`layswatch${(layout.letterColor ?? "#1a1a1a").toLowerCase() === c ? " on" : ""}`}
            style={{ background: c }}
            title={c}
            onClick={() => onSetLayoutOptions({ letterColor: c === "#1a1a1a" ? undefined : c })}
          />
        ))}
        <ColorInput
          aria-label="Custom panel-label colour"
          className="colorin"
          value={layout.letterColor ?? "#1a1a1a"}
          onChange={(c) => onSetLayoutOptions({ letterColor: c })}
        />
      </span>
      </>
    ),
    panels: (
      <>
      <label className={`laychip${(layout.showPanelTitles ?? false) ? " on" : ""}`} title="Show each panel's own graph title inside the plot. Off by default — the figure reads by its A/B/C letters, and the graph grows to fill the freed space.">
        <input type="checkbox" checked={layout.showPanelTitles ?? false} onChange={(e) => onSetLayoutOptions({ showPanelTitles: e.target.checked || undefined })} />
        Graph titles
      </label>
      <label className={`laychip${(layout.showPanelNames ?? false) ? " on" : ""}`} title="Show the graph name in each panel's card header (editing aid only — never part of the exported figure)">
        <input type="checkbox" checked={layout.showPanelNames ?? false} onChange={(e) => onSetLayoutOptions({ showPanelNames: e.target.checked ? true : undefined })} />
        Card titles
      </label>
      <label className={`laychip${(layout.panelFontScale ?? false) ? " on" : ""}`} title="Draw each panel as a true miniature of the full graph — fonts, markers, line widths and margins all shrink together, so the card keeps the graph's designed proportions. Off = the graph re-lays-out at card size (identical card boxes, but fonts and marks read out of proportion).">
        <input type="checkbox" checked={layout.panelFontScale ?? false} onChange={(e) => onSetLayoutOptions({ panelFontScale: e.target.checked ? true : undefined })} />
        Keep proportions
      </label>
      </>
    ),
  } : null;
  /** The Inspector's Figure view: shown while nothing on the figure is picked (no object, no panel being edited). */
  const figurePanel = figureControls ? (
    <div className="figsel" role="group" aria-label="The figure">
      <div className="figsel-h">Figure</div>
      <p className="note figsel-note">Click a panel or an object on the figure to edit it.</p>
      <div className="inspsub">Panel letters</div>
      <div className="figsel-body">
        {figureControls.labels}
        {figureControls.renumber}
      </div>
      <div className="inspsub">Panel content</div>
      <div className="figsel-body">
        {figureControls.panels}
        {figureControls.sharedAxes}
        {figureControls.oneLegend}
      </div>
    </div>
  ) : null;
  /** What the Inspector shows for the selection: its name, its settings, its place on the figure. */
  const selectionPanel = (() => {
    if (!objectFields && !positionFields) return null;
    const OBJECT_NAME: Record<string, string> = { text: "Text box", arrow: "Arrow", segment: "Line", rect: "Box", ellipse: "Ellipse", image: "Picture", callout: "Callout" };
    const onePanel = !selectedAnn ? actIds()[0] : undefined;
    const pi = onePanel ? panelPlots.findIndex((p) => p.id === onePanel) : -1;
    const title = selectedAnn
      ? OBJECT_NAME[selectedAnn.kind] ?? "Object"
      : pi >= 0 ? `Panel ${letterOf(panelPlots[pi]!.id, pi) || pi + 1} — ${panelPlots[pi]!.name}` : "Selection";
    return (
      <div className="figsel" role="group" aria-label="Selected on the figure">
        <div className="figsel-h">{title}</div>
        {objectFields && <div className="figsel-body">{objectFields}</div>}
        {positionFields && (
          <>
            <div className="inspsub">Position on the figure</div>
            <div className="figsel-body">{positionFields}</div>
          </>
        )}
      </div>
    );
  })();
  /**
   * The panel tools that act on the picked panel(s): stack front / back, centre on the figure, lock, group, duplicate.
   * (Built here so the centring pair can sit in Line up ▾ and the rest in the toolbar row.)
   */
  const objTools = (() => {
    const objSel = actIds();
        const nObj = objSel.length;
        const nObjMovable = objSel.filter((id) => !lockedOf(id)).length;
        const allLocked = nObj > 0 && nObjMovable === 0;
        const canCenter = nObjMovable >= 1 && panelPlots.length > nObj;
    return {
      canCenter,
      front: <button type="button" className="layseg-btn" title={absolute ? "Bring the selected panel(s) in front of the others" : "Stacking applies in free-drag mode (panels never overlap in a grid)"} disabled={nObj < 1 || !absolute} onClick={() => restack("front")}>Front</button>,
      back: <button type="button" className="layseg-btn" title={absolute ? "Send the selected panel(s) behind the others" : "Stacking applies in free-drag mode (panels never overlap in a grid)"} disabled={nObj < 1 || !absolute} onClick={() => restack("back")}>Back</button>,
      centreAcross: <button type="button" className="layseg-btn" title="Centre the selected panel(s) on the figure, left–right (needs at least one unselected panel to centre against)" disabled={!canCenter} onClick={() => centerSel("h")}>Ctr&nbsp;↔</button>,
      centreDown: <button type="button" className="layseg-btn" title="Centre the selected panel(s) on the figure, top–bottom (needs at least one unselected panel to centre against)" disabled={!canCenter} onClick={() => centerSel("v")}>Ctr&nbsp;↕</button>,
      lock: <button type="button" className="layseg-btn" title={allLocked ? "Unlock the selected panel(s) — allow moving / resizing / removing again" : "Lock the selected panel(s) in place — no drag, resize, nudge or remove (the graph itself stays editable)"} disabled={nObj < 1} onClick={toggleLock}>{allLocked ? "🔓" : "🔒"}</button>,
      group: onSetLayoutOptions ? (() => {
            // Persistent group: the selection keeps moving as one —
            // drag and nudge translate every member — until ungrouped. Movement only.
            const sel = [...arrangeSel].filter((sid) => panelPlots.some((p) => p.id === sid));
            const gmap = layout.panelGroups ?? {};
            const tags = new Set(sel.map((sid) => gmap[sid]));
            const oneGroup = sel.length >= 1 && tags.size === 1 && !tags.has(undefined);
            if (oneGroup) {
              const tag = gmap[sel[0]!]!;
              const clear = (): void => {
                const next = { ...gmap };
                for (const k of Object.keys(next)) if (next[k] === tag) delete next[k];
                onSetLayoutOptions({ panelGroups: Object.keys(next).length ? next : undefined });
              };
              return (
                <button type="button" className="layseg-btn" title="Dissolve the group — its panels move independently again" onClick={clear}>Ungroup</button>
              );
            }
            const group = (): void => {
              const tag = nextPanelGroupTag(gmap);
              const next = { ...gmap };
              for (const sid of sel) next[sid] = tag;
              onSetLayoutOptions({ panelGroups: next });
            };
            return (
              <button type="button" className="layseg-btn" title="Group the selected panels — they keep moving as one (drag and arrow keys) until ungrouped. Movement only: grouping never resizes them, and Align still re-derives the grid." disabled={sel.length < 2} onClick={group}>Group</button>
            );
          })() : null,
      duplicate: onDuplicatePanel ? <button type="button" className="layseg-btn" title="Duplicate the selected panel(s) — the copy lands just below-right, on top" disabled={nObj < 1} onClick={duplicateSel}>⧉</button> : null,
    };
  })();
  /** Style ▾ — Match to: the others copy one reference panel's look (any panel, not just A). */
  const matchSection = onMatchStyles && panelPlots.length > 1 ? (() => {
    // Reference panel = the explicit dropdown choice, else the selected panel, else A.
    const selIdx = panelPlots.findIndex((p) => p.id === (matchRef ?? editing?.selectedPlot));
    const refIdx = selIdx >= 0 ? selIdx : 0;
    const ref = panelPlots[refIdx]!;
    const rest = panelPlots.filter((p) => p.id !== ref.id).map((p) => p.id);
    // includeUndefined so matching a default-styled reference resets the others
    // (otherwise nothing copies and the buttons appear to do nothing).
    const match = (aspect: keyof typeof MATCH_KEYS) => {
      onMatchStyles(rest, capturePlotStyle(ref, MATCH_KEYS[aspect], true), MATCH_KEYS[aspect]);
      // The per-kind font carriers a generic `fonts` transfer cannot reach
      // (heatmap labelFont · network labelSize · per-axis font overrides) —
      // see kindFontMatchPatch. Without this, "Match → Fonts" would leave a heatmap's
      // row/column labels untouched.
      if ((aspect === "fonts" || aspect === "all") && onPatchPanels) {
        const patches = panelPlots
          .filter((p) => p.id !== ref.id)
          .map((p) => ({ id: p.id, patch: kindFontMatchPatch(p, ref) }))
          .filter((x): x is { id: NodeId; patch: Partial<Plot> } => x.patch !== null);
        if (patches.length) onPatchPanels(patches);
      }
    };
    return (
      <>
      <select
        className="selin"
        style={{ width: "auto" }}
        title="Choose which panel the others copy from — any panel, not just A"
        value={ref.id}
        onChange={(e) => { setMatchRef(e.target.value); editing?.onSelectPanel(e.target.value); }}
      >
        {panelPlots.map((p, i) => (
          <option key={p.id} value={p.id}>{(letterOf(p.id, i) ? `${letterOf(p.id, i)} — ` : "") + p.name}</option>
        ))}
      </select>
      <div className="layseg" role="group" aria-label="Match panels">
        <button className="layseg-btn primary" title="Same size, fonts, axes & colours" onClick={() => match("all")}>Everything</button>
        <button className="layseg-btn" title="Match graph size" onClick={() => match("size")}>Size</button>
        <button className="layseg-btn" title="Match fonts" onClick={() => match("fonts")}>Fonts</button>
        <button className="layseg-btn" title="Match axes, ticks & frame" onClick={() => match("axes")}>Axes</button>
        <button className="layseg-btn" title="Match the colour palette" onClick={() => match("colours")}>Colours</button>
      </div>
      </>
    );
  })() : null;
  const RULER = 20;
  return (
    <div>
      {inspectorSlot && (() => {
        // The picked thing's settings, else — with no panel being edited — the figure's own.
        const shown = selectionPanel ?? (editing?.selectedPlot ? null : figurePanel);
        return shown ? createPortal(shown, inspectorSlot) : null;
      })()}
      {/* The row wraps: at a narrow window an unwrapped row runs past the right edge and the Export
          button sits off screen with no way to reach it. */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10, flexWrap: "wrap" }}>
        <h2 className="h" style={{ margin: 0 }}>{layout.name}</h2>
        <span className="note">{panelPlots.length} panel{panelPlots.length === 1 ? "" : "s"}</span>
        {/* Add graph / Add image are in the toolbar's Insert ▾; Choose graphs is the tab above. */}
        {/* A state chip, not a checkbox in a row of eight.
            The button that connects or disconnects the changes made to a graph in the panel
            assembly tab from its source graph has to be prominent: an unlabelled tickbox
            reads as one more setting rather than as the mode the whole figure is in. The chip
            states which mode it is in, in words, and colours itself accordingly. */}
        {onSetLinked && <LinkStateChip linked={layout.linked !== false} onSetLinked={onSetLinked} />}
        <span className="paneact-spacer" />
        {panelPlots.length > 0 && (
          <button
            className="paneact"
            title="Draft a caption + an accessibility alt-text description for the whole figure, panel by panel — editable, and never inserted automatically"
            onClick={toggleCaption}
          >
            Caption
          </button>
        )}
        <ExportButton label="Export this figure (all panels)" onClick={panelPlots.length > 0 ? onExport : undefined} />
      </div>
      {captionText !== null && (
        <div className="prosepanel">
          <div className="prosepanel-head">
            <strong>Figure caption &amp; alt-text — draft</strong>
            <span className="prosepanel-note">Editable — review before use; nothing is inserted into your document.</span>
            <button className="btn-mini" onClick={copyCaption}>{captionCopied ? "Copied ✓" : "Copy"}</button>
            <button className="btn-mini" title="Close" aria-label="Close draft" onClick={() => setCaptionText(null)}>✕</button>
          </div>
          <textarea
            className="prosepanel-text"
            value={captionText}
            onChange={(e) => setCaptionText(e.target.value)}
            spellCheck={false}
            rows={9}
            aria-label="Drafted figure caption and alt-text"
          />
        </div>
      )}
      {panelPlots.length === 0 && (
        <p className="note" style={{ marginBottom: 10 }}>
          No panels yet — use the Choose graphs tab above to pick graphs for this figure.
        </p>
      )}
      {panelPlots.length > 0 && (onSetLayoutOptions || (onMatchStyles && panelPlots.length > 1) || onApplyPanelPreset) && (
        <div className="layribbon layribbon-rows">
          {/* Two rows. Row 1, always
              in view (the layout and the guide items stay visible at all times): Layout · Columns ·
              Gutter · Page · Grid · Snap · Ruler · zoom. Row 2: actions on the canvas, the rarer parts behind menus.
              `figure-controls.census.test` holds the controls and handlers in place. */}
          {onSetLayoutOptions && (
            <div className="layrow" role="group" aria-label="Layout and guides">
                          {panelPlots.length >= 2 && (
                            <div className="laypreset-wrap">
                              <button
                                type="button"
                                className={`laychip${presetOpen ? " on" : ""}`}
                                title="Pick a figure layout — like choosing a table format. Each thumbnail is a shape (grid, wide top, tall left…); your graphs fill its slots in A/B/C order, in one undoable step."
                                onClick={() => setPresetOpen((o) => !o)}
                              >
                                Layout&nbsp;▾
                              </button>
                              {presetOpen && (
                                <div className="laypreset-pop" role="menu">
                                  {layoutPresets(panelPlots.length).map((pr) => {
                                    const cols = Math.max(...pr.cells.map((c) => c.c + c.cs));
                                    const rows = Math.max(...pr.cells.map((c) => c.r + c.rs));
                                    return (
                                      <button
                                        key={pr.name}
                                        type="button"
                                        className="laypreset-item"
                                        title={`${pr.name} — apply this shape to the figure`}
                                        onClick={() => {
                                          applyLayoutPreset(pr);
                                          setPresetOpen(false);
                                        }}
                                      >
                                        <svg viewBox={`0 0 ${cols * 12} ${rows * 12}`} width={cols * 12} height={rows * 12} aria-hidden>
                                          {pr.cells.map((c, i) => (
                                            <rect
                                              key={i}
                                              x={c.c * 12 + 1}
                                              y={c.r * 12 + 1}
                                              width={c.cs * 12 - 2}
                                              height={c.rs * 12 - 2}
                                              rx={1.5}
                                              fill={i === 0 ? "var(--accent)" : "var(--line)"}
                                              opacity={i === 0 ? 0.85 : 0.7}
                                            />
                                          ))}
                                        </svg>
                                        {pr.name}
                                      </button>
                                    );
                                  })}
                                </div>
                              )}
                            </div>
                          )}
                          <label className="laypick-l laylbl" title="How many columns to tile the panels into (Auto detects from their positions)">
                            Columns
                            <select
                              className="selin"
                              style={{ width: "auto" }}
                              value={layout.columns ?? "auto"}
                              onChange={(e) => onSetLayoutOptions({ columns: e.target.value === "auto" ? undefined : Number(e.target.value) })}
                            >
                              <option value="auto">Auto</option>
                              {[1, 2, 3, 4, 5, 6].map((n) => (
                                <option key={n} value={n}>{n}</option>
                              ))}
                            </select>
                          </label>
                          <label className="laypick-l laylbl" title="Gap between panels (px)">
                            Gutter
                            <input
                              type="number"
                              className="numin"
                              style={{ width: 52 }}
                              min={0}
                              max={80}
                              step={2}
                              value={layout.gutter ?? DEFAULT_FIGURE_GUTTER}
                              onChange={(e) => onSetLayoutOptions({ gutter: Number(e.target.value) })}
                            />
                          </label>
                          <PageControls page={layout.page} disabled={!absolute} onSet={(page) => onSetLayoutOptions({ page })} />
              <span className="laychip-sep" />
                          <label className={`laychip${showGrid ? " on" : ""}`} title="Show an alignment grid behind the panels">
                            <input type="checkbox" checked={showGrid} onChange={(e) => onSetLayoutOptions({ showGrid: e.target.checked })} />
                            Grid
                          </label>
                          {showGrid && (
                            <label className={`laychip${layout.snapToGrid ? " on" : ""}`} title="A dragged panel's corner lands on the grid (an edge or guide it meets still wins)">
                              <input type="checkbox" checked={layout.snapToGrid ?? false} onChange={(e) => onSetLayoutOptions({ snapToGrid: e.target.checked || undefined })} />
                              Snap to grid
                            </label>
                          )}
                          <label className={`laychip${showRuler ? " on" : ""}`} title="Show a measuring ruler along the top & left of the canvas">
                            <input type="checkbox" checked={showRuler} onChange={(e) => onSetLayoutOptions({ showRuler: e.target.checked })} />
                            Ruler
                          </label>
                          {showRuler && (
                            <select
                              className="laychip-unit"
                              value={rulerUnit.value}
                              onChange={(e) => rulerUnit.set(e.target.value as RulerUnit)}
                              title="Ruler unit — figure pixels (96 dpi), inches, or centimetres"
                              aria-label="Ruler unit"
                            >
                              <option value="px">px</option>
                              <option value="in">inch</option>
                              <option value="cm">cm</option>
                            </select>
                          )}
                          <span className="laychip-sep" />
                          <span className="laychip-zoom" title="Zoom the figure canvas — a view aid only; it does not change the figure or its export">
                            🔍
                            <input
                              type="range"
                              min={ZOOM_MIN}
                              max={ZOOM_MAX}
                              step={0.05}
                              value={viewZoom}
                              onChange={(e) => setViewZoom(Number(e.target.value))}
                              aria-label="Canvas zoom"
                            />
                            <button type="button" className="laychip-zoomval" onClick={() => setViewZoom(1)} title="Reset zoom to 100%">
                              {Math.round(viewZoom * 100)}%
                            </button>
                          </span>
            </div>
          )}
          <div className="layrow" role="group" aria-label="Arrange">
            {onSetLayoutOptions && (
              <>
                <button
                  type="button"
                  className={`laychip laychip-go${allAligned ? " on" : ""}`}
                  title="Align everything in one click — tidies the panels into a dense grid and aligns the X & Y axes and the ↕/↔ labels. Click again to release; or switch any pair off individually."
                  onClick={() => (allAligned
                    ? onSetLayoutOptions({ alignX: undefined, alignY: undefined, labelAlignX: undefined, labelAlignY: undefined })
                    : engageAlignAll())}
                >
                  Align all
                </button>
                <ToolbarMenu label="Align" title="Line up the panels' axes and their letters, and even out their sizes — tick as many as you need">
                  <div className="inspsub">Axes</div>
                  <label className={`laychip${alignX ? " on" : ""}`} title="Align X-axes: every panel down a column gets the same horizontal data extent, so their X-axes start and end at the same left and right positions. Rows/columns auto-detect (or set Columns).">
                    <input type="checkbox" checked={alignX} onChange={(e) => onSetLayoutOptions({ alignX: e.target.checked || undefined, ...(e.target.checked ? { freeform: false } : {}) })} />
                    Align X
                  </label>
                  <label className={`laychip${alignY ? " on" : ""}`} title="Align Y-axes: every panel across a row gets the same vertical data extent, so their Y-axes start and end at the same heights. Rows/columns auto-detect (or set Columns).">
                    <input type="checkbox" checked={alignY} onChange={(e) => onSetLayoutOptions({ alignY: e.target.checked || undefined, ...(e.target.checked ? { freeform: false } : {}) })} />
                    Align Y
                  </label>
                  <div className="inspsub">Panel letters</div>
                  <label className={`laychip${labelAlignY ? " on" : ""}`} title="Put the A/B/C letters of each row at the same height: each letter moves up or down to the row's top-most letter.">
                    <input type="checkbox" checked={labelAlignY} onChange={(e) => onSetLayoutOptions({ labelAlignY: e.target.checked || undefined })} />
                    Align&nbsp;↕
                  </label>
                  <label className={`laychip${labelAlignX ? " on" : ""}`} title="Put the A/B/C letters of each column at the same left position: each letter moves left or right to the column's left-most letter.">
                    <input type="checkbox" checked={labelAlignX} onChange={(e) => onSetLayoutOptions({ labelAlignX: e.target.checked || undefined })} />
                    Align&nbsp;↔
                  </label>
                  <div className="inspsub">Sizes</div>
                  <label className={`laychip${uRow ? " on" : ""}`} title="Uniform row height: every graph in a detected row is stretched to the same height (the row's tallest). Rows can still differ from each other. Supersedes Align Y-axes on the height.">
                    <input type="checkbox" checked={uRow} onChange={(e) => onSetLayoutOptions({ uniformRowHeight: e.target.checked || undefined, ...(e.target.checked ? { freeform: false } : {}) })} />
                    Equal rows
                  </label>
                  <label className={`laychip${uCol ? " on" : ""}`} title="Uniform column width: every graph in a detected column is stretched to the same width (the column's widest). Columns can still differ. Supersedes Align X-axes on the width.">
                    <input type="checkbox" checked={uCol} onChange={(e) => onSetLayoutOptions({ uniformColumnWidth: e.target.checked || undefined, ...(e.target.checked ? { freeform: false } : {}) })} />
                    Equal cols
                  </label>
                  <label className={`laychip${(layout.stretchLastPanel ?? false) ? " on" : ""}`} title="When the aligned grid's last row holds a single panel, stretch that panel across the full row instead of leaving a hole beside it. The stretched panel spans the row, so its axes don't share a column's axis line.">
                    <input type="checkbox" checked={layout.stretchLastPanel ?? false} onChange={(e) => onSetLayoutOptions({ stretchLastPanel: e.target.checked || undefined })} />
                    Stretch&nbsp;last
                  </label>
                  <label className={`laychip${(layout.centreNoAxisPanels ?? false) ? " on" : ""}`} title="Graphs with no axes (pie, treemap, network, Venn, sunburst…) keep their own width and sit centred in their column, instead of being widened to it — the empty space is shared evenly either side. Their letter goes with them. Graphs with axes are unaffected.">
                    <input type="checkbox" checked={layout.centreNoAxisPanels ?? false} onChange={(e) => onSetLayoutOptions({ centreNoAxisPanels: e.target.checked || undefined })} />
                    Centre&nbsp;no-axis
                  </label>
                </ToolbarMenu>
                <label className={`laychip${freeform ? " on" : ""}`} title="Drag any panel by its graph to reposition it; alignment guides snap card edges and graph axes (dashed) so you can line axes up by hand. On by default; turning it on clears axis auto-alignment.">
                  <input type="checkbox" checked={freeform} onChange={(e) => onSetLayoutOptions({ freeform: e.target.checked, ...(e.target.checked ? { alignX: undefined, alignY: undefined, uniformRowHeight: undefined, uniformColumnWidth: undefined } : {}) })} />
                  Free drag
                </label>
                <span className="laychip-sep" />
              </>
            )}
            <ToolbarMenu
              label="Line up"
              closeOnPick
              disabled={nArrMovable < 2 && !objTools.canCenter}
              title={nArrMovable >= 2 || objTools.canCenter
                ? `${nArrSel >= 2 ? `${nArrSel} panels picked` : "The picked panel"}: line up edges, space out, equalise, or centre on the figure`
                : "Shift-click two or more panels to line them up (or pick one to centre it on the figure)"}
            >
              <div className="inspsub">Edges (2+ picked)</div>
              <div className="layseg" role="group" aria-label="Align panels">
                <button type="button" className="layseg-btn" title="Align left edges" disabled={nArrMovable < 2} onClick={() => applyArrange("left")}>⇤</button>
                <button type="button" className="layseg-btn" title="Align horizontal centres" disabled={nArrMovable < 2} onClick={() => applyArrange("center-x")}>⇔</button>
                <button type="button" className="layseg-btn" title="Align right edges" disabled={nArrMovable < 2} onClick={() => applyArrange("right")}>⇥</button>
                <button type="button" className="layseg-btn" title="Align top edges" disabled={nArrMovable < 2} onClick={() => applyArrange("top")}>⤒</button>
                <button type="button" className="layseg-btn" title="Align vertical centres" disabled={nArrMovable < 2} onClick={() => applyArrange("center-y")}>⇕</button>
                <button type="button" className="layseg-btn" title="Align bottom edges" disabled={nArrMovable < 2} onClick={() => applyArrange("bottom")}>⤓</button>
              </div>
              <div className="inspsub">Even spacing (3+)</div>
              <div className="layseg" role="group" aria-label="Distribute panels">
                <button type="button" className="layseg-btn" title="Distribute horizontal spacing evenly (needs 3+)" disabled={nArrMovable < 3} onClick={() => applyArrange("distribute-h")}>↔</button>
                <button type="button" className="layseg-btn" title="Distribute vertical spacing evenly (needs 3+)" disabled={nArrMovable < 3} onClick={() => applyArrange("distribute-v")}>↕</button>
              </div>
              <div className="inspsub">Same size (2+)</div>
              <div className="layseg" role="group" aria-label="Equalise panel sizes">
                <button type="button" className="layseg-btn" title="Make the graphs the same width" disabled={nArrMovable < 2} onClick={() => applyArrange("equalize-w")}>Equal&nbsp;W</button>
                <button type="button" className="layseg-btn" title="Make the graphs the same height" disabled={nArrMovable < 2} onClick={() => applyArrange("equalize-h")}>Equal&nbsp;H</button>
              </div>
              <div className="inspsub">On the figure</div>
              <div className="layseg" role="group" aria-label="Centre panels">
                {objTools.centreAcross}
                {objTools.centreDown}
              </div>
            </ToolbarMenu>
            <div className="layseg" role="group" aria-label="Object tools">
              {objTools.front}
              {objTools.back}
              {objTools.lock}
              {objTools.group}
              {objTools.duplicate}
            </div>
            {(onAddFigureAnnotation || (onAddPanel && addable.length > 0) || onAddImagePanel) && (
              <>
                <span className="laychip-sep" />
                <ToolbarMenu label="Insert" closeOnPick title="Add a graph or a picture as a panel, or put a text, arrow, line, box or ellipse on the figure">
                  {onAddPanel && addable.length > 0 && (
                    <label className="laypick-l" title="Add another graph to this figure without leaving the arrangement">
                      <select
                        className="selin"
                        aria-label="Add a graph to this figure"
                        value=""
                        onChange={(e) => { if (e.target.value) onAddPanel(e.target.value); }}
                      >
                        <option value="">+ Add graph…</option>
                        {addable.map((p) => (
                          <option key={p.id} value={p.id}>{p.name}</option>
                        ))}
                      </select>
                    </label>
                  )}
                  {/* Its file picker lives inside it: the menu must not close (and unmount it) on its click. */}
                  {onAddImagePanel && <span data-keep-open><AddImageButton onAdd={onAddImagePanel} /></span>}
                  {onAddFigureAnnotation && (
                    <>
                      <div className="inspsub">On the figure</div>
                      <div className="laymenu-items">
                        {(
                          [
                            { kind: "text", label: "Text", title: "Text box on the figure canvas — a shared heading or note between panels" },
                            { kind: "arrow", label: "Arrow", title: "Arrow on the figure canvas — e.g. from panel A to panel B" },
                            { kind: "segment", label: "Line", title: "Plain line on the figure canvas — e.g. a divider between panel groups" },
                            { kind: "rect", label: "Box", title: "Rectangle on the figure canvas — e.g. framing related panels" },
                            { kind: "ellipse", label: "Ellipse", title: "Ellipse on the figure canvas" },
                          ] as const
                        ).map((k) => (
                          <button
                            key={k.kind}
                            type="button"
                            className="layseg-btn"
                            title={k.title}
                            onClick={() => {
                              const at = canvasSize.w > 0 ? { x: canvasSize.w / 2, y: canvasSize.h / 2 } : { x: 240, y: 160 };
                              const created = onAddFigureAnnotation(figureAnnotationDefaults(k.kind, at.x, at.y));
                              if (created) selectAnn(created.id);
                            }}
                          >
                            {k.label}
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </ToolbarMenu>
              </>
            )}
            <ToolbarMenu label="Style" title="Make the panels look alike: match one panel, apply a style preset to all, or save / apply a house style">
              {matchSection && (
                <>
                  <div className="inspsub">Match every panel to</div>
                  {matchSection}
                </>
              )}
              {onApplyPanelPreset && panelPlots.some((p) => p.kind !== "image") && (
                <>
                  <div className="inspsub">Style preset (every panel)</div>
                  <label className="laypick-l" title="Restyle every graph in this figure with a built-in style preset — fonts, axes, grid, palette, plus each chart type's own defaults. One pick, all panels; each step undoable.">
                    <select
                      className="selin"
                      style={{ width: "auto" }}
                      aria-label="Apply a style preset to every panel"
                      value=""
                      onChange={(e) => {
                        const preset = findPreset(e.target.value);
                        if (preset) onApplyPanelPreset(panelPlots.filter((p) => p.kind !== "image").map((p) => p.id), preset);
                      }}
                    >
                      <option value="">Whole figure…</option>
                      {STYLE_PRESETS.map((p) => (
                        <option key={p.name} value={p.name}>{p.name}</option>
                      ))}
                    </select>
                  </label>
                </>
              )}
              <div className="inspsub">House style</div>
              <div className="laymenu-items">
                {figTemplates.length > 0 && (
                  <label className="laypick-l" title="Apply a saved figure arrangement to this figure">
                    <select
                      className="selin"
                      aria-label="Apply a saved figure template"
                      value=""
                      onChange={(e) => { if (e.target.value) applyFigureTemplate(e.target.value); }}
                    >
                      <option value="">Apply…</option>
                      {figTemplates.map((t) => (
                        <option key={t.name} value={t.name}>{t.name}</option>
                      ))}
                    </select>
                  </label>
                )}
                {templateName === null ? (
                  <button
                    className="layseg-btn"
                    title="Save this figure's arrangement — columns, gutter, lettering, alignment, shared axes and legend — as a reusable house style"
                    onClick={() => setTemplateName("")}
                  >
                    Save as template…
                  </button>
                ) : (
                  <>
                    <input
                      className="selin"
                      aria-label="Name for this figure template"
                      placeholder="Template name"
                      autoFocus
                      style={{ width: 130 }}
                      value={templateName}
                      onChange={(e) => setTemplateName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") { e.preventDefault(); commitTemplateSave(); }
                        else if (e.key === "Escape") { e.preventDefault(); setTemplateName(null); }
                      }}
                    />
                    <button className="layseg-btn" disabled={!templateName.trim()} onClick={commitTemplateSave}>Save</button>
                    <button className="layseg-btn" onClick={() => setTemplateName(null)}>Cancel</button>
                  </>
                )}
                {figTemplates.length > 0 && (
                  <label className="laypick-l" title="Delete a saved house style">
                    <select
                      className="selin"
                      aria-label="Delete a saved figure template"
                      value=""
                      onChange={(e) => { if (e.target.value) removeFigureTemplate(e.target.value); }}
                    >
                      <option value="">Delete…</option>
                      {figTemplates.map((t) => (
                        <option key={t.name} value={t.name}>{t.name}</option>
                      ))}
                    </select>
                  </label>
                )}
              </div>
            </ToolbarMenu>
          </div>
          {/* With the Inspector collapsed there is nowhere else for the picked thing's and the figure's own settings:
              they stay here. */}
          {!inspectorSlot && (objectFields || figureControls || positionFields) && (
            <div className="layrow layrow-more">
              {objectFields && (
                <div className="laygroup">
                  <span className="laygroup-h">Object</span>
                  <div className="laygroup-body">
                    {objectFields}
                  </div>
                </div>
              )}
              {positionFields}
              {figureControls && (
                <>
                  <div className="laygroup">
                    <span className="laygroup-h">Labels</span>
                    <div className="laygroup-body">
                      {figureControls.labels}
                      {figureControls.renumber}
                    </div>
                  </div>
                  <div className="laygroup">
                    <span className="laygroup-h">Panels</span>
                    <div className="laygroup-body">
                      {figureControls.panels}
                      {figureControls.sharedAxes}
                      {figureControls.oneLegend}
                    </div>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      )}
      {panelPlots.length === 0 ? (
        <p className="note" style={{ marginTop: 14 }}>
          Pick graphs above to tile them into a multi-panel figure with automatic A/B/C lettering.
        </p>
      ) : (() => {
        // One key for the whole figure, centred under the panels. Its own element (not part
        // of any panel) so the exporter places it exactly as it sits on screen.
        const mergedLegendNode = mergeLegend && sharedLegend ? (
          <div className="layfiglegend" title="One legend for the whole figure — every panel plots the same series, so their repeated keys were merged">
            <FigureLegend entries={sharedLegend.entries} font={sharedLegend.font} />
          </div>
        ) : null;
        const panelNode = (g: PanelGeom, dr/* dragging */: boolean) => {
          const { p, i, scene, cardW } = g;
          const isSel = !!editing && editing.selectedPlot === p.id;
          const locked = lockedOf(p.id);
          const pos = absolute ? (drag && drag.id === p.id ? drag : posOf(p.id, i)) : null;
          // Extra room a stored cardSizes entry adds beyond the graph + chrome — the graph
          // centres in it (two-level resize). 0/0 when the card hugs the graph (default).
          const exX = Math.max(0, g.insetL - CARD_PAD);
          const exY = Math.max(0, g.insetT - headerOff);
          const figStyle: React.CSSProperties = absolute
            ? { position: "absolute", left: pos!.x, top: pos!.y, width: cardW, height: g.cardH, margin: 0, boxSizing: "border-box", zIndex: dr ? 6 : isSel ? 5 : undefined, ...((freeform || gridMode) && !locked ? { userSelect: "none", cursor: "move" } : {}) }
            : {
                width: cardW,
                height: g.cardH,
                boxSizing: "border-box",
                position: "relative",
                margin: 0,
                // CSS-grid path: claim the cells the span covers. The scene was already
                // re-laid-out to that width above, so the max-content tracks agree.
                ...(spanOf(p.id) > 1 ? { gridColumn: `span ${spanOf(p.id)}` } : {}),
              };
          return (
            <figure
              key={p.id}
              data-pid={p.id}
              className={`laypanel${isSel ? " laypanel-sel" : ""}${arrangeSel.has(p.id) ? " laypanel-arrsel" : ""}${locked ? " laypanel-locked" : ""}`}
              style={figStyle}
              // Shift-click a panel toggles it in the Arrange selection (align/distribute);
              // a plain click clears that set and edits the single graph.
              onMouseDown={editing ? (e) => { if (e.shiftKey) { togglePanelSel(p.id); } else { if (arrangeSel.size) setArrangeSel(new Set()); editing.onSelectPanel(p.id); } } : undefined}
              // Free-drag: press-and-drag anywhere on the panel (incl. the graph) to move it;
              // a plain click still selects + edits the graph (threshold-armed, see startPanelDrag).
              onPointerDown={(freeform || gridMode) ? (e) => startPanelDrag(e, p.id, i) : undefined}
            >
              {headerShown && (
                <figcaption className="laypanel-hd" style={freeform && !locked ? { cursor: "move" } : undefined}>
                  <span className="laypanel-name" title="Double-click to open this graph in its own tab" onDoubleClick={() => onOpenPlot(p.id)}>
                    {p.name}
                  </span>
                </figcaption>
              )}
              {freeform && !locked && (
                <button className="laypanel-move" title="Drag to move this panel (or drag anywhere on it; a click still edits the graph)" tabIndex={-1}>⠿</button>
              )}
              {locked && onSetLayoutOptions && (
                <button
                  className="laypanel-lock"
                  title="Locked — this panel can't be moved, resized or removed. Click to unlock."
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    const cur = { ...(layout.panelLocked ?? {}) };
                    delete cur[p.id];
                    onSetLayoutOptions({ panelLocked: Object.keys(cur).length > 0 ? cur : undefined });
                  }}
                >
                  🔒
                </button>
              )}
              <button
                className="laypanel-x laypanel-x-float"
                title={locked ? "Locked — unlock this panel to remove it" : "Remove from figure"}
                disabled={locked}
                onClick={(e) => { e.stopPropagation(); if (!locked) onRemovePanel(p.id); }}
              >
                ×
              </button>
              {spanEnabled && onSetLayoutOptions && (() => {
                const s = spanOf(p.id);
                const cols = layout.columns!;
                const next = s >= cols ? 1 : s + 1; // cycle 1 → 2 → … → cols → 1
                return (
                  <button
                    className="laypanel-span laypanel-span-float"
                    title={`Panel width: spans ${s} of ${cols} columns — click for ${next}`}
                    aria-label={`Panel width for ${p.name}: spans ${s} of ${cols} columns`}
                    onPointerDown={(e) => e.stopPropagation()} // don't start a panel drag
                    onClick={(e) => {
                      e.stopPropagation();
                      const cur = { ...(layout.panelSpan ?? {}) };
                      if (next === 1) delete cur[p.id]; // back to a plain cell → store nothing
                      else cur[p.id] = next;
                      onSetLayoutOptions({ panelSpan: Object.keys(cur).length > 0 ? cur : undefined });
                    }}
                  >
                    {s}×
                  </button>
                );
              })()}
              {spanEnabled && onSetLayoutOptions && (() => {
                const rs = rowSpanOf(p.id);
                const next = rs >= 4 ? 1 : rs + 1; // cycle 1 → 2 → 3 → 4 → 1
                return (
                  <button
                    className="laypanel-span laypanel-rowspan-float"
                    title={`Panel height: spans ${rs} row${rs === 1 ? "" : "s"} of the grid — click for ${next}. The others tile around it (tall-left / wide-top layouts).`}
                    aria-label={`Panel height for ${p.name}: spans ${rs} rows`}
                    onPointerDown={(e) => e.stopPropagation()} // don't start a panel drag
                    onClick={(e) => {
                      e.stopPropagation();
                      const cur = { ...(layout.panelRowSpan ?? {}) };
                      if (next === 1) delete cur[p.id]; // back to a plain cell → store nothing
                      else cur[p.id] = next;
                      onSetLayoutOptions({ panelRowSpan: Object.keys(cur).length > 0 ? cur : undefined });
                    }}
                  >
                    {rs}⇕
                  </button>
                );
              })()}
              {lettering !== "none" && (() => {
                const lp = labelPosOf(p.id, i);
                const text = letterOf(p.id, i);
                // Editing: an input in place of the glyph. Rendered even when the text is
                // empty so a label the user blanked can still be recovered by double-click
                // (the empty span below keeps a small hit area alive for exactly that).
                if (editLetter?.id === p.id) {
                  return (
                    <input
                      className="laypanel-letter laypanel-letter-float laypanel-letter-in"
                      style={{ position: "absolute", left: lp.x, top: lp.y, ...letterStyle, zIndex: 13 }}
                      aria-label={`Panel label for ${p.name}`}
                      autoFocus
                      value={editLetter.text}
                      onPointerDown={(e) => e.stopPropagation()}
                      onChange={(e) => setEditLetter({ id: p.id, text: e.target.value })}
                      onBlur={() => commitLetter(p.id, i)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") { e.preventDefault(); commitLetter(p.id, i); }
                        else if (e.key === "Escape") { e.preventDefault(); setEditLetter(null); }
                      }}
                    />
                  );
                }
                return (
                  <span
                    className="laypanel-letter laypanel-letter-float"
                    style={{ position: "absolute", left: lp.x, top: lp.y, ...letterStyle, ...(labelDrag?.id === p.id ? { zIndex: 12 } : {}) }}
                    title="Drag to move this label; it snaps to the other labels. Double-click to retype it (e.g. “(a)” or “S1”)."
                    onPointerDown={(e) => startLabelDrag(e, p.id)}
                    {...(onSetLayoutOptions ? { onDoubleClick: (e: React.MouseEvent) => { e.stopPropagation(); setEditLetter({ id: p.id, text }); } } : {})}
                  >
                    {text}
                  </span>
                );
              })()}
              {/* the graph centres in any extra card room (two-level resize) */}
              <div style={exX || exY ? { marginLeft: exX, marginTop: exY } : undefined}>
              {editing ? (
                <PlotFigure
                  scene={scene}
                  zoom={g.k}
                  selected={isSel ? editing.selection : null}
                  onSelect={(sel) => { editing.onSelectPanel(p.id); editing.onSelect(sel); }}
                  {...(isSel
                    ? {
                        onEditText: editing.onEditText,
                        onMoveTitle: editing.onMoveTitle,
                        onMoveSubtitle: editing.onMoveSubtitle,
                        onMoveLegend: editing.onMoveLegend,
                        onMoveSignificanceCaption: editing.onMoveSignificanceCaption,
                        onMoveColorbar: editing.onMoveColorbar,
                        onMoveWaffleCaption: editing.onMoveWaffleCaption,
                        onMoveFitLabel: editing.onMoveFitLabel,
                        onMoveFitParams: editing.onMoveFitParams,
                        onMoveFitParamLine: editing.onMoveFitParamLine,
                        onMoveAxisTitle: editing.onMoveAxisTitle,
                        onRotateAxisTitle: editing.onRotateAxisTitle,
                        onMoveValueLabel: editing.onMoveValueLabel,
                        onMoveDirectLabel: editing.onMoveDirectLabel,
                        onParallelEdit: editing.onParallelEdit,
                        onCamera3D: editing.onCamera3D,
                        onMoveAnnotation: editing.onMoveAnnotation,
                        onMoveRefLineLabel: editing.onMoveRefLineLabel,
                        onDeleteAnnotation: editing.onDeleteAnnotation,
                        onReorderAnnotation: editing.onReorderAnnotation,
                        onDuplicateAnnotation: editing.onDuplicateAnnotation,
                        onFigureResize: editing.onFigureResize,
                        onCreateTextBox: editing.onCreateTextBox,
                        onAxisResize: editing.onAxisResize,
                        onWidthResize: editing.onWidthResize,
                      }
                    : {})}
                />
              ) : (
                <PlotFigure scene={scene} selected={null} zoom={g.k} />
              )}
              </div>
              {onSetLayoutOptions && !locked && (
                <div
                  className="laypanel-resize"
                  title="Drag to resize the graph inside the card — the axes re-lay-out to fit; the card keeps its size"
                  // sits at the graph's corner (which centres inside an enlarged card)
                  style={{ right: Math.max(2, cardW - g.insetL - scene.width * g.k - 6), bottom: Math.max(2, g.cardH - g.insetT - scene.height * g.k - 6) }}
                  onPointerDown={(e) => startResize(e, p.id)}
                />
              )}
              {/* card-edge grips (two-level resize): the edges size the outer box only.
                  Not in a computed grid mode — the aligner derives card boxes from scratch
                  there and ignores cardSizes, so the grips would do nothing. */}
              {onSetLayoutOptions && !locked && !gridMode && (
                <>
                  <div className="laypanel-cardedge laypanel-cardedge-e" title="Drag to resize the card — the graph keeps its size and centres inside" onPointerDown={(e) => startCardResize(e, p.id, "e")} />
                  <div className="laypanel-cardedge laypanel-cardedge-s" title="Drag to resize the card — the graph keeps its size and centres inside" onPointerDown={(e) => startCardResize(e, p.id, "s")} />
                  <div className="laypanel-cardedge laypanel-cardedge-se" title="Drag to resize the card — the graph keeps its size and centres inside" onPointerDown={(e) => startCardResize(e, p.id, "se")} />
                </>
              )}
            </figure>
          );
        };
        if (absolute) {
          // Grow the canvas to fit labels wherever they're dragged — even far outside their
          // cards (incl. negative = left/above) — so nothing is clipped by the scroll edge.
          // Use committed positions only (never the live `drag`/`labelDrag`); tying
          // the canvas origin to a live drag shifts the origin as you drag and cancels the
          // motion (a feedback loop that breaks free-drag). The canvas re-fits on release.
          const lsz = (layout.letterSize ?? 22) * 1.6;
          let minLX = 0, minLY = 0, maxLX = canvasSize.w, maxLY = canvasSize.h;
          for (const g of geoms) {
            const cp = posOf(g.p.id, g.i);
            // The same placement the letters are drawn at — a separate copy here could miss the centred-card and
            // lowered-card rules and size the canvas for letters that are somewhere else.
            const lp = labelPosOf(g.p.id, g.i);
            const lx = cp.x + lp.x, ly = cp.y + lp.y;
            minLX = Math.min(minLX, lx); minLY = Math.min(minLY, ly);
            maxLX = Math.max(maxLX, lx + lsz); maxLY = Math.max(maxLY, ly + lsz);
          }
          const rulerSz = showRuler ? RULER : 0;
          const z = viewZoom;
          // The canvas + its labels draw scaled by `z`; the ruler and the label/scroll margins
          // are screen-fixed, so every logical extent that reserves room multiplies by `z`.
          const offL = LABEL_ROOM + rulerSz + Math.max(0, -minLX) * z;
          const offT = LABEL_ROOM + rulerSz + Math.max(0, -minLY) * z;
          const rW = offL + Math.max(canvasSize.w, maxLX) * z + LABEL_ROOM;
          const rH = offT + Math.max(canvasSize.h, maxLY) * z + LABEL_ROOM;
          return (
            <div className="laywrap" style={{ position: "relative", width: rW, minHeight: rH, marginTop: 8, ...cvdStyle }}>
              {showRuler && (
                <div style={{ position: "absolute", left: offL - RULER, top: offT - RULER }}>
                  <RulerBands w={canvasSize.w * z} h={canvasSize.h * z} size={RULER} unit={rulerUnit.value} zoom={z} onPointerDown={onSetLayoutOptions ? startGuideDrag : undefined} />
                </div>
              )}
              <div
                ref={canvasRef}
                className="laygrid laycanvas"
                onPointerDown={startMarquee}
                data-freeform={freeform ? "1" : undefined}
                data-abs="1"
                data-page-w={pageBox ? pageBox.w : undefined}
                data-page-h={pageBox ? pageBox.h : undefined}
                style={{ position: "absolute", left: offL, top: offT, width: canvasSize.w, height: canvasSize.h, transform: z === 1 ? undefined : `scale(${z})`, transformOrigin: "top left", ...gridBg }}
              >
                {pageBox && (
                  <div className="laypage" style={{ width: pageBox.w, height: pageBox.h }}>
                    {(layout.page?.marginMm ?? 0) > 0 && (() => {
                      const m = (layout.page!.marginMm! / MM_PER_IN) * 96;
                      return <div className="laypage-margin" style={{ left: m, top: m, right: m, bottom: m }} />;
                    })()}
                  </div>
                )}
                {/* DOM order = paint order = export order: sorted by panelZ (front/back). */}
                {stackOrder(geoms, (g) => g.p.id, layout.panelZ).map((g) => panelNode(g, drag?.id === g.p.id))}
                {(["v", "h"] as const).flatMap((axis) =>
                  (layout.guides?.[axis] ?? []).map((pos, k) =>
                    guideDrag?.axis === axis && guideDrag.idx === k ? null : (
                      <div
                        key={`guide-${axis}${k}`}
                        className={`layguide layguide-${axis}${onSetLayoutOptions ? " layguide-live" : ""}`}
                        style={axis === "v" ? { left: pos } : { top: pos }}
                        title={onSetLayoutOptions ? "Guide: drag to move; drag onto the ruler or double-click to remove" : undefined}
                        onPointerDown={onSetLayoutOptions ? (e) => startGuideDrag(axis, e, k) : undefined}
                        onDoubleClick={onSetLayoutOptions ? (e) => { e.stopPropagation(); removeGuide(axis, k); } : undefined}
                      />
                    ),
                  ),
                )}
                {guideDrag && guideDrag.pos >= 0 && <div className={`layguide layguide-${guideDrag.axis}`} style={guideDrag.axis === "v" ? { left: guideDrag.pos } : { top: guideDrag.pos }} />}
                {freeform && drag?.vx !== undefined && <div className={`laysnap laysnap-v${drag.vxAxis ? " laysnap-axis" : ""}`} style={{ left: drag.vx }} />}
                {freeform && drag?.hy !== undefined && <div className={`laysnap laysnap-h${drag.hyAxis ? " laysnap-axis" : ""}`} style={{ top: drag.hy }} />}
                {marquee && (
                  <div className="laymarquee" style={{ left: Math.min(marquee.x0, marquee.x1), top: Math.min(marquee.y0, marquee.y1), width: Math.abs(marquee.x1 - marquee.x0), height: Math.abs(marquee.y1 - marquee.y0) }} />
                )}
                {labelDrag?.gx !== undefined && <div className="laysnap laysnap-v laysnap-label" style={{ left: labelDrag.gx }} />}
                {labelDrag?.gy !== undefined && <div className="laysnap laysnap-h laysnap-label" style={{ top: labelDrag.gy }} />}
                {figureAnns.length > 0 && (
                  <LayoutAnnotations
                    annotations={figureAnns}
                    w={canvasSize.w}
                    h={canvasSize.h}
                    selectedId={annSel}
                    onSelect={selectAnn}
                    onMove={onMoveFigureAnnotation}
                    onUpdate={onUpdateFigureAnnotation}
                    onRemove={onRemoveFigureAnnotation ? (id) => { setAnnSel((s) => (s === id ? null : s)); onRemoveFigureAnnotation(id); } : undefined}
                  />
                )}
              </div>
              {mergedLegendNode && (
                <div style={{ position: "absolute", left: offL, top: offT + canvasSize.h * z, width: canvasSize.w * z }}>
                  {mergedLegendNode}
                </div>
              )}
            </div>
          );
        }
        return (
          <>
            <div ref={flowGridRef} className="laygrid" style={{ ...gridStyle, position: "relative", padding: LABEL_ROOM, ...cvdStyle }}>
              {geoms.map((g) => panelNode(g, false))}
              {labelDrag?.gx !== undefined && <div className="laysnap laysnap-v laysnap-label" style={{ left: labelDrag.gx }} />}
              {labelDrag?.gy !== undefined && <div className="laysnap laysnap-h laysnap-label" style={{ top: labelDrag.gy }} />}
              {figureAnns.length > 0 && (
                <LayoutAnnotations
                  annotations={figureAnns}
                  w={flowBox.w}
                  h={flowBox.h}
                  selectedId={annSel}
                  onSelect={selectAnn}
                  onMove={onMoveFigureAnnotation}
                  onUpdate={onUpdateFigureAnnotation}
                  onRemove={onRemoveFigureAnnotation ? (id) => { setAnnSel((s) => (s === id ? null : s)); onRemoveFigureAnnotation(id); } : undefined}
                />
              )}
            </div>
            {mergedLegendNode}
          </>
        );
      })()}
    </div>
  );
}
