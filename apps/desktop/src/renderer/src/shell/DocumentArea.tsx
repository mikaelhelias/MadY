import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { Plus, X } from "lucide-react";
import type { TourId } from "./tour";
import { ToursPane } from "./ToursPane";
import type { AxisSpec, DataTable, Lineage, LineageNode, NodeId, Plot, Project } from "@mady/core";
import { tabTitle } from "./AppShell";
import type { GraphSelection, LayoutOps, OpenTab, TableOps } from "./AppShell";
import type { TextTarget } from "./PlotFigure";
import type { PickedPoint } from "./boxSelect";
import type { LegendDock } from "./legendDock";
import { ErrorBoundary } from "./ErrorBoundary";
import { AnalysisPane, DataPane, DocsPane, GraphPane } from "./panes";
import type { GraphRibbonOps } from "./panes";
import { GalleryPane } from "./GalleryPane";
import { LineagePanel } from "./LineagePanel";
import { AboutPane } from "./AboutPane";
import { LicencePane } from "./LicencePane";
import { GuidePane, type GuideTarget } from "./GuidePane";
import { WelcomePane } from "./WelcomePane";
import { useCtrlWheelZoom } from "./ctrlWheelZoom";

interface Props {
  project: Project;
  openTabs: OpenTab[];
  activeKey: string;
  onActivate: (key: string) => void;
  onClose: (key: string) => void;
  onRerunAnalysis: (id: NodeId) => void;
  onAddBrackets: (id: NodeId) => void;
  /** Analysis→graph significance-marker binding for the analysis being viewed. */
  bracketBinding: (id: NodeId) => {
    on: boolean;
    control: string | undefined;
    groups: string[];
    toggle: (on: boolean) => void;
    setControl: (group: string | undefined) => void;
  } | undefined;
  onAddLetters: (id: NodeId) => void;
  onPlotSurvival: (id: NodeId) => void;
  onPlotRoc: (id: NodeId) => void;
  onPlotPca: (id: NodeId) => void;
  onPlotOrdination: (id: NodeId) => void;
  onPlotPartition: (id: NodeId) => void;
  /** Create the forest + funnel pair from a meta-analysis result. */
  onPlotMeta: (id: NodeId) => void;
  /** Create the funnel with the Trim-and-fill overlay from a publication-bias result. */
  onPlotBiasFunnel: (id: NodeId) => void;
  onPlotResiduals: (id: NodeId) => void;
  onExportAnalysis: (id: NodeId, format: "csv" | "xlsx") => void;
  onAnnotateStats: (id: NodeId) => void;
  /** Save an analysis as a reusable Method; apply / delete / export / import saved Methods. */
  onSaveMethod: (id: NodeId) => void;
  onApplyMethod: (methodId: NodeId, tableId: NodeId) => void;
  onDeleteMethod: (methodId: NodeId) => void;
  onExportMethod: (methodId: NodeId) => void;
  onImportMethod: () => void;
  /** Re-read / drop a linked (auto-updating) table's file link. */
  onRefreshLinked: (tableId: NodeId) => void;
  onUnlinkLinked: (tableId: NodeId) => void;
  onEditDocs: (folderId: NodeId, text: string) => void;
  tableOps: TableOps;
  layoutOps: LayoutOps;
  /** Open a graph in its own tab (from a layout panel). */
  onOpenPlot: (plotId: NodeId) => void;
  /** Open a datasheet in its own tab (graph ribbon → "Datasheet"). */
  onOpenTable: (tableId: NodeId) => void;
  /** The datasheet's selected block, so Data ▸ Exclude can act on it from the menu bar. */
  onDataSelectionChange: (sel: { tableId: NodeId; r0: number; c0: number; r1: number; c1: number } | null) => void;
  /** Patch the active plot (the exclusion note's "Hide" button). */
  onSetPlotOptions: (patch: Partial<Plot>) => void;
  /** Contextual export — the active graph, dataset, and multi-panel figure. */
  onExportGraph: () => void;
  onExportData: () => void;
  onExportFigure: () => void;
  /** The graph's right-click menu: the graph in front to the clipboard as a picture / as SVG. */
  onCopyPicture: () => void;
  onCopySvg: () => void;
  /** The Axis tab's own writer — the right-click menu on an axis's numbers sets their format with it. */
  onSetAxis: (axis: "x" | "y" | "y2" | "y3", patch: Partial<AxisSpec>) => void;
  /** Lists a drawn line / the fitted curves in the legend, or takes them out (legendDock.ts). */
  onLegendDock: LegendDock;
  /** Pull a legend row out of the block, move it, or put it back. */
  onLegendLoose: (key: string, at: { x: number; y: number } | null) => void;
  selection: GraphSelection;
  onSelect: (selection: GraphSelection) => void;
  /** View-zoom for the active pane (1 = 100%). */
  zoom: number;
  /** Ctrl+wheel over the canvas → step the active pane's zoom (deltaY sign = direction). */
  onZoomWheel: (deltaY: number) => void;
  /** Transient axis-view window for the active graph (data-domain pan/zoom). */
  graphView: GraphView;
  onGraphViewChange: (view: GraphView) => void;
  /** Live drag-resize of a bar/box width (fraction of its band). Undefined on kinds with no
   *  width command — that is what stops the figure drawing an edge handle it can't commit. */
  onWidthResize?: ((seriesId: NodeId, fraction: number) => void) | undefined;
  onMoveAnnotation: (id: NodeId, patch: { value?: number; x?: number; y?: number; bracketY?: number; bracketShift?: number; x2?: number; y2?: number; w?: number; h?: number; rotation?: number }) => void;
  onMoveRefLineLabel: (id: string, dx: number, dy: number) => void;
  onDeleteAnnotation: (id: NodeId) => void;
  onReorderAnnotation: (id: NodeId, to: "front" | "back") => void;
  onDuplicateAnnotation: (id: NodeId) => void;
  /** Shift-drag box selection on the graph: the action picked, with the points inside the box. */
  onBoxAction?: ((action: "exclude" | "highlight" | "copy", points: PickedPoint[]) => void) | undefined;
  /** Why the box menu's "Highlight by name" cannot run (no column of names); undefined = it can. */
  boxHighlightBlocked?: string | undefined;
  /** Live drag-resize of the whole figure (width/height px) from a canvas handle. */
  onFigureResize: (patch: { figureWidth?: number; figureHeight?: number }) => void;
  /** Resize the graph as a uniform scale of its whole drawing (graphDisplay.ts) — the graph pane's corner handles. */
  onFigureScale?: ((scale: number) => void) | undefined;
  /** Open the in-app Licence page (from the About card). */
  onOpenLicence: () => void;
  /** Where the Documentation tab should land — a chapter, or one function's index entry. */
  guideTarget?: GuideTarget | undefined;
  /** Size for a figure with none of its own - the startup fit (null = renderer default). */
  figureFit?: { width: number; height: number } | null | undefined;
  /** Settings ▸ "Round results tables": significant figures for on-screen results tables; unset/0 = full precision. */
  resultDigits?: number | undefined;
  /** Commit an in-place text edit (title/subtitle/axis-title/text-box body). */
  onEditText: (target: TextTarget, value: string) => void;
  /** Create a text-box annotation at a fractional plot position (double-click empty space). */
  onCreateTextBox: (xFrac: number, yFrac: number) => string | void;
  /** Drag an axis end to set its length (plot width for X / height for Y), in px. */
  onAxisResize: (axis: "x" | "y", lengthPx: number) => void;
  /** Drag the title/subtitle block (magnetic centre snap). */
  onMoveTitle: (dx: number, dy: number) => void;
  onMoveSubtitle: (dx: number, dy: number) => void;
  onMoveLegend: (dx: number, dy: number) => void;
  /** Drag the significance threshold key off its centred anchor. */
  onMoveSignificanceCaption: (dx: number, dy: number) => void;
  onMoveColorbar: (dx: number, dy: number) => void;
  /** Count waffle: the caption under the grid was dragged. */
  onMoveWaffleCaption?: ((dx: number, dy: number) => void) | undefined;
  onMoveFitLabel: (dx: number, dy: number) => void;
  onMoveFitParams: (dx: number, dy: number) => void;
  onMoveFitParamLine: (key: string, dx: number, dy: number) => void;
  onMoveHeatmapLabels: (which: "row" | "col", index: number, dx: number, dy: number) => void;
  /** Heatmap split block name / strip name / a word drawn on a strip — every text on a graph
   *  can be moved, and each needs its writer carried the whole way down. */
  onMoveHeatSplitLabel: (axis: "row" | "col", at: number, dx: number, dy: number) => void;
  onMoveHeatTrackName: (axis: "row" | "col", index: number, dx: number, dy: number) => void;
  onMoveHeatTrackKey: (axis: "row" | "col", index: number, dx: number, dy: number) => void;
  onMoveHeatTrackRunLabel: (axis: "row" | "col", index: number, value: string, dx: number, dy: number) => void;
  /** Drag one Venn set label (offsets into `venn.labelOffsets`). */
  onMoveVennSetLabel: (datasetId: string, dx: number, dy: number) => void;
  /** Drag one UpSet matrix set label (offsets into `upset.labelOffsets`). */
  onMoveUpsetSetLabel: (datasetId: string, dx: number, dy: number) => void;
  onMoveTernaryAxisLabel: (datasetId: string, dx: number, dy: number) => void;
  onMoveRoseDirectionLabel: (key: string, dx: number, dy: number) => void;
  onMoveOncoprintLabel: (axis: "gene" | "sample", name: string, dx: number, dy: number) => void;
  onMoveCorrLabels: (which: "row" | "col", index: number, dx: number, dy: number) => void;
  onMoveCorrLegend: (dx: number, dy: number) => void;
  onMoveAxisTitle: (axis: "x" | "y" | "z" | "y2" | "y3", dx: number, dy: number) => void;
  /** Turn a vertical axis's title from its grip on the graph (Axis tab ▸ Title direction). */
  onRotateAxisTitle?: ((axis: "y" | "y2" | "y3", angle: number) => void) | undefined;
  /** Drag a single bar's value label to a new offset (scene px). */
  onMoveValueLabel: (columnId: NodeId, rowId: NodeId, dx: number, dy: number) => void;
  onMoveDirectLabel: (seriesId: NodeId, dx: number, dy: number) => void;
  /** Drag a treemap region (group) heading to a new offset (scene px). */
  onMoveTreemapRegionLabel: (group: string, dx: number, dy: number) => void;
  onMoveNetworkNode: (nodeId: string, x: number, y: number) => void;
  onMoveSectionLabel: (section: string, dx: number, dy: number) => void;
  onMoveCategoryGroupName: (axis: "x" | "y", group: string, dx: number, dy: number) => void;
  onParallelEdit?: (patch: Partial<NonNullable<Plot["parallel"]>>) => void;
  /** Orbit / zoom the 3-D scatter camera (drag to rotate, scroll to zoom). */
  onCamera3D: (patch: { azimuth?: number; elevation?: number; zoom?: number }, gesture: string) => void;
  /** Quick-action handlers for the graph ribbon (grid/legend/frame/font/zoom). */
  graphRibbon: GraphRibbonOps;
  /** Add a new (default) graph of the active data and open it. */
  /** Open the new-graph flow. With a table id → a graph of that datasheet (the per-group +). */
  onAddGraph: (tableId?: NodeId) => void;
  /** Materialise a Chart-gallery card as a real dataset + graph. */
  onOpenGalleryItem: (table: DataTable, plot: Plot, title: string, extraTables?: DataTable[]) => void;
  /** Whole-project provenance DAG for the Lineage view. */
  lineage: Lineage;
  /** Open a sheet from the Lineage view (table/analysis/plot → tab; layout → its view). */
  onOpenLineageObject: (kind: LineageNode["kind"], id: NodeId) => void;
  /** Re-run every stale analysis + refresh stale derived data (Lineage "Re-run stale"). */
  onRerunStale: () => void;
  /** Welcome-page links: Chart gallery / Documentation / new-graph creator / new project. */
  onOpenGallery: () => void;
  onOpenGuide: () => void;
  onStartNewGraph: () => void;
  onNewProject: () => void;
  /** Help ▸ Guided tours ▸ …, from the Guided tours tab and the manual's Guided tours chapter. */
  onStartTour: (id: TourId) => void;
  /** The Welcome page's "Guided tours" tile → the Guided tours tab. */
  onOpenTours: () => void;
}

/** A data-domain window for axis pan/zoom; undefined axes = auto extent. */
export interface GraphView {
  xDomain?: [number, number] | undefined;
  yDomain?: [number, number] | undefined;
}

/** A tab group in the strip: one datasheet with everything built from it (its graphs +
 *  analyses), or the trailing "Other" bucket for project-level views. `color` tints the group's
 *  tabs so you can see at a glance which belong together (null = the neutral "Other" group). */
export interface TabGroup { key: string; label: string; sourceId: NodeId | null; tabs: OpenTab[]; color: string | null; }

/** Order within a datasheet group: the table first, then its graphs, then its analyses. */
const TAB_ORDER: Partial<Record<OpenTab["kind"], number>> = { table: 0, plot: 1, analysis: 2 };

/** Distinct, legible tab-tip hues for datasheets that carry no explicit navigator colour. */
const GROUP_PALETTE = ["#4f9dde", "#e8894a", "#5bb97f", "#c85f8e", "#8e78d6", "#d9a441", "#3fb6b6", "#d76a6a", "#82b23f", "#b06fb0"] as const;

/** A group's tip colour: the datasheet's own navigator swatch if set, else a stable colour
 *  derived from its id (same sheet → same colour every render). */
export function groupColorFor(table: { id: NodeId; color?: string | undefined }): string {
  if (table.color) return table.color;
  let h = 0;
  for (let i = 0; i < table.id.length; i++) h = (h * 31 + table.id.charCodeAt(i)) >>> 0;
  return GROUP_PALETTE[h % GROUP_PALETTE.length]!;
}

/** The source datasheet a tab belongs to, or null for a project-level / singleton view. */
export function tabSourceId(project: Project, tab: OpenTab): NodeId | null {
  if (tab.kind === "table") return tab.id ?? null;
  if (tab.kind === "plot") return project.plots.find((p) => p.id === tab.id)?.source ?? null;
  if (tab.kind === "analysis") return project.analyses.find((a) => a.id === tab.id)?.source ?? null;
  return null;
}

/**
 * Group open tabs by their source datasheet — a datasheet and the graphs/analyses drawn from it
 * sit together (the same tie the project tree makes). Groups follow the
 * project's table order; within a group the table tab comes first, then graphs, then analyses.
 * Tabs with no source (docs, gallery, lineage, welcome) — and any orphaned by a deleted table —
 * fall into a trailing "Other" group so nothing is ever dropped from the strip.
 */
export function buildTabGroups(project: Project, openTabs: readonly OpenTab[]): TabGroup[] {
  const bySource = new Map<NodeId, OpenTab[]>();
  const other: OpenTab[] = [];
  for (const t of openTabs) {
    const src = tabSourceId(project, t);
    if (src) { const arr = bySource.get(src) ?? []; arr.push(t); bySource.set(src, arr); }
    else other.push(t);
  }
  const groups: TabGroup[] = [];
  const rendered = new Set<NodeId>();
  for (const tbl of project.tables) {
    const tabs = bySource.get(tbl.id);
    if (!tabs?.length) continue;
    tabs.sort((a, b) => (TAB_ORDER[a.kind] ?? 9) - (TAB_ORDER[b.kind] ?? 9));
    groups.push({ key: tbl.id, label: tbl.name, sourceId: tbl.id, tabs, color: groupColorFor(tbl) });
    rendered.add(tbl.id);
  }
  for (const [src, tabs] of bySource) if (!rendered.has(src)) other.push(...tabs); // orphans → Other
  if (other.length) groups.push({ key: "__other__", label: "Other", sourceId: null, tabs: other, color: null });
  return groups;
}

export function DocumentArea(props: Props) {
  const { project, openTabs, activeKey, onActivate, onClose, onZoomWheel } = props;
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const active = openTabs.find((t) => t.key === activeKey);
  const canvasRef = useRef<HTMLDivElement>(null);
  const tabsRef = useRef<HTMLDivElement>(null);

  // Ctrl+wheel → view zoom; a plain wheel falls through to the pane (axis zoom). Shared with the figure page.
  useCtrlWheelZoom(canvasRef, onZoomWheel);

  // The tab strip stays within the window width (it scrolls instead of widening
  // the document). Let a plain vertical wheel scroll it horizontally so a mouse
  // (no shift, no h-wheel) can reach off-screen tabs.
  useEffect(() => {
    const el = tabsRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent): void => {
      if (e.ctrlKey || e.deltaY === 0) return;
      if (el.scrollWidth <= el.clientWidth) return; // nothing to scroll
      e.preventDefault();
      el.scrollLeft += e.deltaY;
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  // Keep the active tab visible when it changes (e.g. opened from the tree).
  useEffect(() => {
    const on = tabsRef.current?.querySelector(".tab.on");
    if (on && typeof on.scrollIntoView === "function") {
      on.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
  }, [activeKey, openTabs.length]);

  function toggleGroup(group: string): void {
    setCollapsedGroups((s) => {
      const next = new Set(s);
      next.has(group) ? next.delete(group) : next.add(group);
      return next;
    });
  }

  return (
    <div className="doc">
      <div className="tabs" ref={tabsRef}>
        {buildTabGroups(project, openTabs).map((g) => {
          const groupCollapsed = collapsedGroups.has(g.key);
          const tint = g.color ?? "var(--line-2)";
          return (
            <div className="tabgroup" key={g.key}>
              {/* The group label is thin while expanded (the member tabs already show, so it is
                  just a coloured collapse handle) and wider when collapsed (then it is the only
                  thing standing for the whole group, so it shows the name + count). */}
              <button
                className={"tabgrouplabel" + (g.sourceId ? " datasheet" : "") + (groupCollapsed ? " collapsed" : " expanded")}
                style={{ ["--groupcolor" as string]: tint } as CSSProperties}
                onClick={() => toggleGroup(g.key)}
                title={
                  g.sourceId
                    ? `“${g.label}” and every graph and analysis built from it — click to ${groupCollapsed ? "show" : "hide"} them`
                    : `Notes, gallery, lineage and other project views — click to ${groupCollapsed ? "show" : "hide"} them`
                }
              >
                {groupCollapsed ? (
                  <><span className="groupdot" aria-hidden="true" /> {g.label} <span className="tabcount">{g.tabs.length}</span></>
                ) : (
                  <span className="grouphandle" aria-hidden="true" />
                )}
              </button>
              {!groupCollapsed &&
                g.tabs.map((t) => (
                  <button
                    key={t.key}
                    className={"tab" + (t.key === activeKey ? " on" : "")}
                    style={{ ["--tabtip" as string]: tint } as CSSProperties}
                    title={`${tabTitle(project, t)} — click to open, × to close`}
                    onClick={() => onActivate(t.key)}
                  >
                    {tabTitle(project, t)}
                    <X
                      className="x"
                      size={13}
                      onClick={(e) => {
                        e.stopPropagation();
                        onClose(t.key);
                      }}
                    />
                  </button>
                ))}
              {!groupCollapsed && g.sourceId && (
                <button className="tab tabadd" style={{ ["--tabtip" as string]: tint } as CSSProperties} data-tour={g.tabs.some((t) => t.key === activeKey) ? "rail-newgraph" : undefined} title={`New graph of “${g.label}”`} onClick={() => props.onAddGraph(g.sourceId ?? undefined)}>
                  <Plus size={14} />
                </button>
              )}
            </div>
          );
        })}
      </div>
      <div className="canvas" ref={canvasRef}>
        {active ? (
          <ErrorBoundary label={tabTitle(project, active)}>{renderPane(active, props)}</ErrorBoundary>
        ) : (
          <p className="note">No open sheets — pick an object from the project tree.</p>
        )}
      </div>
    </div>
  );
}

function renderPane(tab: OpenTab, props: Props) {
  const { zoom } = props;
  switch (tab.kind) {
    case "table":
      // The grid zooms via a prop (keeps virtualization math in one coord system).
      return <DataPane project={props.project} tableId={tab.id} ops={props.tableOps} zoom={zoom} onExport={props.onExportData} onApplyMethod={props.onApplyMethod} onDeleteMethod={props.onDeleteMethod} onExportMethod={props.onExportMethod} onImportMethod={props.onImportMethod} onRefreshLinked={props.onRefreshLinked} onUnlinkLinked={props.onUnlinkLinked} onSelectionChange={props.onDataSelectionChange} onOpenPlot={props.onOpenPlot} />;
    case "plot":
      return (
        <GraphPane
          project={props.project}
          plotId={tab.id}
          selected={props.selection}
          onSelect={props.onSelect}
          zoom={zoom}
          view={props.graphView}
          onViewChange={props.onGraphViewChange}
          onWidthResize={props.onWidthResize}
          onMoveAnnotation={props.onMoveAnnotation}
          onMoveRefLineLabel={props.onMoveRefLineLabel}
          onDeleteAnnotation={props.onDeleteAnnotation}
          onReorderAnnotation={props.onReorderAnnotation}
          onDuplicateAnnotation={props.onDuplicateAnnotation}
          onBoxAction={props.onBoxAction}
          boxHighlightBlocked={props.boxHighlightBlocked}
          onFigureResize={props.onFigureResize}
          onFigureScale={props.onFigureScale}
          figureFit={props.figureFit}
          onEditText={props.onEditText}
          onCreateTextBox={props.onCreateTextBox}
          onAxisResize={props.onAxisResize}
          onMoveTitle={props.onMoveTitle}
          onMoveSubtitle={props.onMoveSubtitle}
          onMoveLegend={props.onMoveLegend}
          onMoveSignificanceCaption={props.onMoveSignificanceCaption}
          onMoveColorbar={props.onMoveColorbar}
          onMoveWaffleCaption={props.onMoveWaffleCaption}
          onMoveHeatmapLabels={props.onMoveHeatmapLabels}
          onMoveHeatSplitLabel={props.onMoveHeatSplitLabel}
          onMoveHeatTrackName={props.onMoveHeatTrackName}
          onMoveHeatTrackKey={props.onMoveHeatTrackKey}
          onMoveHeatTrackRunLabel={props.onMoveHeatTrackRunLabel}
          onMoveVennSetLabel={props.onMoveVennSetLabel}
          onMoveUpsetSetLabel={props.onMoveUpsetSetLabel}
          onMoveTernaryAxisLabel={props.onMoveTernaryAxisLabel}
          onMoveRoseDirectionLabel={props.onMoveRoseDirectionLabel}
          onMoveOncoprintLabel={props.onMoveOncoprintLabel}
          onMoveCorrLabels={props.onMoveCorrLabels}
          onMoveCorrLegend={props.onMoveCorrLegend}
          onMoveAxisTitle={props.onMoveAxisTitle}
          onRotateAxisTitle={props.onRotateAxisTitle}
          onMoveFitLabel={props.onMoveFitLabel}
          onMoveFitParams={props.onMoveFitParams}
          onMoveFitParamLine={props.onMoveFitParamLine}
          onMoveValueLabel={props.onMoveValueLabel}
          onMoveDirectLabel={props.onMoveDirectLabel}
          onMoveTreemapRegionLabel={props.onMoveTreemapRegionLabel}
          onMoveNetworkNode={props.onMoveNetworkNode}
          onMoveSectionLabel={props.onMoveSectionLabel}
          onMoveCategoryGroupName={props.onMoveCategoryGroupName}
          onParallelEdit={props.onParallelEdit}
          onCamera3D={props.onCamera3D}
          ribbon={props.graphRibbon}
          onExport={props.onExportGraph}
          onCopyPicture={props.onCopyPicture}
          onCopySvg={props.onCopySvg}
          onSetAxis={props.onSetAxis}
          onLegendDock={props.onLegendDock}
          onLegendLoose={props.onLegendLoose}
          onOpenSource={props.onOpenTable}
          onSetPlotOptions={props.onSetPlotOptions}
        />
      );
    case "analysis":
      return (
        <div style={{ zoom }}>
          <AnalysisPane project={props.project} analysisId={tab.id} onRerun={props.onRerunAnalysis} onAddBrackets={props.onAddBrackets} bracketBinding={tab.id ? props.bracketBinding(tab.id) : undefined} onAddLetters={props.onAddLetters} onPlotSurvival={props.onPlotSurvival} onPlotRoc={props.onPlotRoc} onPlotPca={props.onPlotPca} onPlotOrdination={props.onPlotOrdination} onPlotPartition={props.onPlotPartition} onPlotMeta={props.onPlotMeta} onPlotBiasFunnel={props.onPlotBiasFunnel} onPlotResiduals={props.onPlotResiduals} onExportAnalysis={props.onExportAnalysis} onAnnotateStats={props.onAnnotateStats} onSaveMethod={props.onSaveMethod} resultDigits={props.resultDigits} />
        </div>
      );
    case "docs":
      return (
        <div style={{ zoom }}>
          <DocsPane
            project={props.project}
            folderId={tab.id}
            onChange={(text) => {
              if (tab.id) props.onEditDocs(tab.id, text);
            }}
          />
        </div>
      );
    case "layout":
      // Figures do not open as a document tab — they live in the tree's builder
      // page. Kept as a no-op so a persisted layout tab renders nothing.
      return null;
    case "gallery":
      return (
        <div style={{ zoom }}>
          <GalleryPane onOpen={props.onOpenGalleryItem} figureFit={props.figureFit} />
        </div>
      );
    case "tours":
      return (
        <div style={{ zoom }}>
          <ToursPane onStartTour={props.onStartTour} />
        </div>
      );
    case "lineage":
      return (
        <LineagePanel lineage={props.lineage} onOpen={props.onOpenLineageObject} onRerunStale={props.onRerunStale} />
      );
    case "guide":
      return (
        <div style={{ zoom }}>
          <GuidePane version={typeof __MADY_BUILD__ !== "undefined" ? __MADY_BUILD__ : undefined} onOpenLicence={props.onOpenLicence} onStartTour={props.onStartTour} target={props.guideTarget} />
        </div>
      );
    case "about":
      return (
        <div style={{ zoom }}>
          <AboutPane version={typeof __MADY_BUILD__ !== "undefined" ? __MADY_BUILD__ : undefined} onOpenLicence={props.onOpenLicence} />
        </div>
      );
    case "licence":
      return (
        <div style={{ zoom }}>
          <LicencePane />
        </div>
      );
    case "welcome":
      return (
        <div style={{ zoom }}>
          <WelcomePane
            version={typeof __MADY_BUILD__ !== "undefined" ? __MADY_BUILD__ : undefined}
            onOpenGallery={props.onOpenGallery}
            onOpenGuide={props.onOpenGuide}
            onStartNewGraph={props.onStartNewGraph}
            onNewProject={props.onNewProject}
            onOpenTours={props.onOpenTours}
          />
        </div>
      );
    default:
      return null;
  }
}
