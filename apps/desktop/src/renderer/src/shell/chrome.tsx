import { Fragment, useRef, useState } from "react";
import {
  Activity,
  ArrowLeft,
  ArrowLeftRight,
  ArrowRight,
  ArrowUpDown,
  ArrowUpRight,
  Asterisk,
  BarChart3,
  BookOpen,
  Bug,
  Calculator,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Circle,
  ClipboardPaste,
  Code,
  Columns3,
  Copy,
  Dices,
  Divide,
  Download,
  Eye,
  EyeOff,
  FileCode,
  FilePlus2,
  Filter,
  FlaskConical,
  FolderOpen,
  FolderPlus,
  Gauge,
  GitBranch,
  Highlighter,
  Home,
  Image as ImageIcon,
  Info,
  LayoutGrid,
  LineChart,
  Maximize,
  MessageSquare,
  Minus,
  Package,
  Percent,
  Printer,
  Ruler,
  Scissors,
  SeparatorHorizontal,
  SeparatorVertical,
  Settings2,
  Sheet,
  Shuffle,
  Moon,
  Redo2,
  RotateCcw,
  Save,
  Scale,
  Thermometer,
  Search,
  Settings,
  Sigma,
  Sparkles,
  Square,
  StretchHorizontal,
  StretchVertical,
  Sun,
  SunMoon,
  Table,
  Trash2,
  TrendingUp,
  Type,
  Undo2,
  Upload,
  Variable,
  Shapes,
  Wand2,
  ZoomIn,
  ZoomOut,
  Compass,
  Merge,
  Split,
  Replace,
  Grid2x2,
  Unlink,
  FolderOutput,
} from "lucide-react";
import type { ReactNode } from "react";
import type { LogEntry, LogKind, Project } from "@mady/core";
import type { RecentEntry } from "../../../preload";
import { GUIDED_TOURS_SUBMENU } from "./actions";
import type { AppAction, MenuName } from "./actions";
import { TOURS } from "./tour";
import type { ToolbarGroup, ToolbarGroupName, ToolbarItemId } from "./toolbar";
import type { Theme } from "./AppShell";
import { canZoom, zoomLabel } from "./zoom";
import type { Suggestion } from "./assistant";
import { SuggestionsPopover } from "./SuggestionsPopover";

const MENU_ORDER: MenuName[] = ["File", "Edit", "Insert", "Data", "Analyze", "Graph", "Design", "View", "Help"];

/**
 * Per-item dropdown icons, keyed by action id (the action registry can't hold JSX — it stays a
 * pure `.ts` shared by node tests — so the view layer owns the pictures). Reuses the same lucide
 * glyphs the toolbar already shows for the shared actions (open/save/import/export/new-datasheet/
 * duplicate/undo/redo/analyze) so a command reads the same in both places. An id with no entry
 * falls back to a blank leading slot, keeping labels aligned. Icons are `<svg>` (no text), so a
 * row's `textContent` still equals its label and name-based menu lookups keep working.
 */
const ICO = 14;
export const MENU_ICONS: Record<string, ReactNode> = {
  // File
  open: <FolderOpen size={ICO} />, import: <Upload size={ICO} />, "import-ggplot": <FileCode size={ICO} />, "paste-data": <ClipboardPaste size={ICO} />,
  save: <Save size={ICO} />, export: <Download size={ICO} />, "export-all": <FolderOutput size={ICO} />, print: <Printer size={ICO} />,
  "export-script": <FileCode size={ICO} />, "export-repro": <Package size={ICO} />,
  "new-project": <FolderPlus size={ICO} />, "new-dataset-dialog": <FilePlus2 size={ICO} />,
  // Edit
  undo: <Undo2 size={ICO} />, redo: <Redo2 size={ICO} />, "copy-cells": <Copy size={ICO} />,
  "cut-cells": <Scissors size={ICO} />, "paste-cells": <ClipboardPaste size={ICO} />,
  // Insert
  "new-dataset": <Sheet size={ICO} />, "new-layout": <LayoutGrid size={ICO} />,
  // Data
  "exclude-values": <EyeOff size={ICO} />, "include-values": <Eye size={ICO} />,
  transform: <Variable size={ICO} />, colmath: <Divide size={ICO} />, rowstats: <Sigma size={ICO} />,
  frequency: <BarChart3 size={ICO} />, qqplot: <Activity size={ICO} />, prune: <Filter size={ICO} />,
  extract: <Columns3 size={ICO} />, transpose: <ArrowLeftRight size={ICO} />, reshape: <Shuffle size={ICO} />,
  "sort-data": <ArrowUpDown size={ICO} />, "duplicate-data": <Copy size={ICO} />,
  "merge-data": <Merge size={ICO} />, "split-text": <Split size={ICO} />, "find-replace": <Replace size={ICO} />,
  // Analyze (the Common-analyses children share the curve glyph; comparison gets the scale)
  analyze: <Calculator size={ICO} />, doseresponse: <Activity size={ICO} />, "enzyme-kinetics": <LineChart size={ICO} />,
  binding: <LineChart size={ICO} />, "interpolate-curve": <LineChart size={ICO} />, "method-comparison": <Scale size={ICO} />, "melting-temperature": <Thermometer size={ICO} />,
  power: <Gauge size={ICO} />, simulate: <Dices size={ICO} />, montecarlo: <Sparkles size={ICO} />,
  // Graph
  "new-graph-create": <LineChart size={ICO} />, "new-graph": <TrendingUp size={ICO} />, gallery: <LayoutGrid size={ICO} />,
  "clone-graph": <Copy size={ICO} />, "apply-look": <Wand2 size={ICO} />,
  "copy-picture": <ImageIcon size={ICO} />, "copy-svg": <Code size={ICO} />,
  // Split into small graphs: a grid of small graphs; Detach: the link to the original, broken.
  "split-graph": <Grid2x2 size={ICO} />, "detach-small-graph": <Unlink size={ICO} />,
  // Design
  "design-sig-brackets": <Asterisk size={ICO} />, "design-sig-letters": <Asterisk size={ICO} />,
  "design-sig-bracket": <Asterisk size={ICO} />, "design-sig-options": <Settings2 size={ICO} />,
  "design-text": <Type size={ICO} />, "design-arrow": <ArrowUpRight size={ICO} />, "design-segment": <Minus size={ICO} />,
  "design-rect": <Square size={ICO} />, "design-highlight": <Highlighter size={ICO} />, "design-ellipse": <Circle size={ICO} />,
  "design-callout": <MessageSquare size={ICO} />, "design-hline": <SeparatorHorizontal size={ICO} />,
  "design-vline": <SeparatorVertical size={ICO} />, "design-hband": <StretchHorizontal size={ICO} />,
  "design-vband": <StretchVertical size={ICO} />,
  // View
  "nav-back": <ArrowLeft size={ICO} />, "nav-forward": <ArrowRight size={ICO} />, "command-palette": <Search size={ICO} />,
  "graph-ruler": <Ruler size={ICO} />, "color-vision": <Eye size={ICO} />, layouts: <LayoutGrid size={ICO} />, "reset-layout": <RotateCcw size={ICO} />,
  "reset-toolbar": <RotateCcw size={ICO} />, "set-zoom": <Percent size={ICO} />, settings: <Settings size={ICO} />,
  "toggle-theme": <SunMoon size={ICO} />, "view-lineage": <GitBranch size={ICO} />,
  "zoom-in": <ZoomIn size={ICO} />, "zoom-out": <ZoomOut size={ICO} />, "zoom-reset": <Maximize size={ICO} />,
  // Help
  welcome: <Home size={ICO} />, guide: <BookOpen size={ICO} />, "save-manual": <Download size={ICO} />, "report-bug": <Bug size={ICO} />, about: <Info size={ICO} />,
};
/** Submenu parent rows are keyed by their submenu label (they're not actions). */
export const SUBMENU_ICONS: Record<string, ReactNode> = {
  "New table": <Table size={ICO} />,
  "Common analyses": <FlaskConical size={ICO} />,
  [GUIDED_TOURS_SUBMENU]: <Compass size={ICO} />,
};
// Every tour row carries the same compass — the parent is the door, the rows are its steps.
for (const t of TOURS) MENU_ICONS[`tour-${t.id}`] = <Compass size={ICO} />;
/** The leading icon for an action row: its own, or the shared "new table" glyph for a format child. */
export function iconFor(action: AppAction): ReactNode {
  if (MENU_ICONS[action.id]) return MENU_ICONS[action.id];
  if (action.id.startsWith("new-table-")) return <Table size={ICO} />;
  return null;
}

/**
 * One rendered row of a dropdown: either a plain action, or a parent standing for
 * every action sharing a `submenu` label. Actions keep their registry order; a
 * submenu takes the position (and group) of its first member, so separators fall
 * where the flat list would have put them.
 */
type MenuRow =
  | { kind: "action"; action: AppAction; group: number | undefined }
  | { kind: "sub"; label: string; items: AppAction[]; group: number | undefined };

function buildRows(items: AppAction[]): MenuRow[] {
  const rows: MenuRow[] = [];
  const byLabel = new Map<string, Extract<MenuRow, { kind: "sub" }>>();
  for (const action of items) {
    if (!action.submenu) {
      rows.push({ kind: "action", action, group: action.group });
      continue;
    }
    const existing = byLabel.get(action.submenu);
    if (existing) {
      existing.items.push(action);
    } else {
      const row = { kind: "sub" as const, label: action.submenu, items: [action], group: action.group };
      byLabel.set(action.submenu, row);
      rows.push(row);
    }
  }
  return rows;
}

export function MenuBar({
  actions,
  recents,
  onOpenRecent,
  theme,
  onToggleTheme,
  onSettings,
  askBar,
}: {
  actions: AppAction[];
  recents: RecentEntry[];
  onOpenRecent: (path: string) => void;
  theme: Theme;
  onToggleTheme: () => void;
  /** Open the Settings dialog (same command as View ▸ Settings). */
  onSettings: () => void;
  /** The Ask box — rendered last, at the extreme right of the bar. */
  askBar?: ReactNode;
}) {
  const [open, setOpen] = useState<MenuName | null>(null);
  // Label of the nested panel currently showing (only one at a time).
  const [openSub, setOpenSub] = useState<string | null>(null);

  // Opening/closing a top-level menu always resets the nested panel, so a submenu
  // can never survive into a different menu.
  const openMenu = (menu: MenuName | null): void => {
    setOpen(menu);
    setOpenSub(null);
  };

  const run = (a: AppAction): void => {
    if (a.enabled === false) return;
    openMenu(null);
    a.run();
  };

  // Build stamp (define-injected at build time; "dev" when undefined, e.g. tests).
  const build = typeof __MADY_BUILD__ !== "undefined" ? __MADY_BUILD__ : "dev";
  // Edition label — only the Agent edition shows a pill; the standard edition shows the
  // plain brand.
  const edition = typeof __MADY_EDITION__ !== "undefined" ? __MADY_EDITION__ : "Standard";
  return (
    <div className="menubar">
      <span className="brand">
        MadY <span className="brandver" title={`Version, source revision and build time: ${build}`}>{build}</span>
        {edition === "Agent" && <span className="brand-edition" title="Agent edition — includes the command interface another program can use to drive MadY.">Agent</span>}
      </span>
      {MENU_ORDER.map((menu) => {
        const items = actions.filter((a) => a.menu === menu);
        if (items.length === 0 && menu !== "Graph") return null;
        const isOpen = open === menu;
        const rows = buildRows(items);
        return (
          <div className="menuwrap" key={menu}>
            <span
              className={`menu${isOpen ? " open" : ""}`}
              data-tour={`menu:${menu}`}
              onClick={() => openMenu(isOpen ? null : menu)}
              onMouseEnter={() => open && openMenu(menu)}
            >
              {menu}
            </span>
            {isOpen && (
              <div className="dropdown" role="menu">
                {rows.map((row, i) => (
                  <div key={row.kind === "sub" ? `sub:${row.label}` : row.action.id}>
                    {i > 0 && rows[i - 1]!.group !== row.group && <div className="dropsep" />}
                    {row.kind === "sub" ? (
                      <div
                        className="subwrap"
                        onMouseEnter={() => setOpenSub(row.label)}
                        onMouseLeave={() => setOpenSub((s) => (s === row.label ? null : s))}
                      >
                        <button
                          className={`dropitem dropsub${openSub === row.label ? " open" : ""}`}
                          role="menuitem"
                          aria-haspopup="true"
                          aria-expanded={openSub === row.label}
                          onClick={() => setOpenSub(openSub === row.label ? null : row.label)}
                        >
                          <span className="dropitem-label">
                            <span className="dropitem-ico" aria-hidden="true">{SUBMENU_ICONS[row.label] ?? null}</span>
                            {row.label}
                          </span>
                          <ChevronRight size={13} className="subcaret" />
                        </button>
                        {openSub === row.label && (
                          <div className="dropdown subdrop" role="menu">
                            {row.items.map((a) => (
                              <button
                                key={a.id}
                                className="dropitem"
                                data-tour={`cmd:${a.id}`}
                                role="menuitem"
                                disabled={a.enabled === false}
                                onClick={() => run(a)}
                              >
                                <span className="dropitem-label">
                                  <span className="dropitem-ico" aria-hidden="true">{iconFor(a)}</span>
                                  {a.label}
                                </span>
                                {a.shortcut && <span className="kbd">{a.shortcut}</span>}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    ) : (
                      <button
                        className="dropitem"
                        data-tour={`cmd:${row.action.id}`}
                        role={row.action.checked === undefined ? "menuitem" : "menuitemcheckbox"}
                        {...(row.action.checked === undefined ? {} : { "aria-checked": row.action.checked })}
                        disabled={row.action.enabled === false}
                        onClick={() => run(row.action)}
                      >
                        <span className="dropitem-label">
                          {/* A real icon, not a text check mark — keeps the row's textContent equal to the
                              label so menu lookups by name still match. A toggle shows its check in
                              the leading slot; every other row shows its topical icon there. */}
                          {row.action.checked !== undefined ? (
                            <Check size={13} className="dropcheck" style={{ opacity: row.action.checked ? 1 : 0 }} />
                          ) : (
                            <span className="dropitem-ico" aria-hidden="true">{iconFor(row.action)}</span>
                          )}
                          {row.action.label}
                        </span>
                        {row.action.shortcut && <span className="kbd">{row.action.shortcut}</span>}
                      </button>
                    )}
                  </div>
                ))}
                {menu === "File" && recents.length > 0 && (
                  <>
                    <div className="dropsep" />
                    <div className="drophead">Recent files</div>
                    {recents.slice(0, 8).map((r) => (
                      <button
                        key={r.path}
                        className="dropitem"
                        role="menuitem"
                        title={r.path}
                        onClick={() => {
                          openMenu(null);
                          onOpenRecent(r.path);
                        }}
                      >
                        <span className="recname">{r.name}</span>
                      </button>
                    ))}
                  </>
                )}
                {items.length === 0 && <div className="drophead">No actions yet</div>}
              </div>
            )}
          </div>
        );
      })}
      {open && <div className="menu-scrim" onClick={() => openMenu(null)} />}
      <span className="spacer" />
      <button className="tool" style={{ marginLeft: 4 }} onClick={onToggleTheme} aria-label="Toggle theme">
        {theme === "light" ? <Moon size={16} /> : <Sun size={16} />}
      </button>
      <button className="tool" style={{ marginLeft: 4 }} onClick={onSettings} title="Settings — styles & preferences" aria-label="Settings">
        <Settings size={16} />
      </button>
      {askBar}
    </div>
  );
}

interface ToolbarProps {
  onAnalyze: () => void;
  onNewProject: () => void;
  onSave: () => void;
  /** Unsaved-changes flag — draws a dot on the Save button. */
  dirty?: boolean | undefined;
  onOpen: () => void;
  onImport: () => void;
  onExport: () => void;
  canExport: boolean;
  /** New datasheet + duplicate the current one (the Insert/Data actions, surfaced on the toolbar). */
  onNewDataset: () => void;
  onDuplicateData: () => void;
  hasData?: boolean | undefined;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  /** Browser-style back/forward through visited tabs (distinct from undo/redo, which
   *  move through edits — these only change what you are looking at). */
  canBack: boolean;
  canForward: boolean;
  onBack: () => void;
  onForward: () => void;
  /** Customizable grouped layout: ordered groups, each an ordered id list. Drag a group
   *  caption to reorder groups; drag an icon to reorder within its group. */
  groups: ToolbarGroup[];
  onReorderGroups: (name: ToolbarGroupName, toIndex: number) => void;
  onReorderWithinGroup: (name: ToolbarGroupName, fromId: ToolbarItemId, toIndex: number) => void;
  /** Apply this look — apply the active graph's look to a chosen set of graphs (needs a graph). */
  onMagic?: (() => void) | undefined;
  /** Open the Design menu (significance markers + objects drawn on the graph). */
  onDesign?: (() => void) | undefined;
  hasPlot?: boolean | undefined;
  /** Assistant — bring back every dismissed suggestion (the popover footer link). */
  onAssistant?: (() => void) | undefined;
  /** Ranked, not-yet-dismissed next-step suggestions shown in the Assistant popover. */
  suggestions?: Suggestion[] | undefined;
  /** Run a suggestion from the popover. */
  onRunSuggestion?: ((s: Suggestion) => void) | undefined;
  /** Dismiss a suggestion (by id) from the popover. */
  onDismissSuggestion?: ((id: string) => void) | undefined;
  /**
   * The language-model pair, at the ribbon's right end under the menu bar's Ask box:
   * the set-up button (always present) and, to its right, the model bar (present
   * only once a model is ready — the bar renders nothing until then).
   */
  modelButton?: ReactNode;
  modelBar?: ReactNode;
}

interface ToolItem {
  icon: ReactNode;
  title: string;
  onClick?: (() => void) | undefined;
  disabled?: boolean;
}

export function Toolbar(props: ToolbarProps) {
  const [suggOpen, setSuggOpen] = useState(false);
  const suggestions = props.suggestions ?? [];
  // Drag state (refs, not state — no re-render needed while dragging).
  const groupDrag = useRef<ToolbarGroupName | null>(null);
  const itemDrag = useRef<{ group: ToolbarGroupName; id: ToolbarItemId } | null>(null);

  // id → button definition (icons/handlers can't be serialized, so they live here).
  const items: Record<ToolbarItemId, ToolItem> = {
    open: { icon: <FolderOpen size={16} />, title: "Open a project or data file — Ctrl+O", onClick: props.onOpen },
    save: { icon: <span className="toolico">{<Save size={16} />}{props.dirty ? <span className="savedot" aria-hidden="true" /> : null}</span>, title: (props.dirty ? "Save — you have unsaved changes" : "Save → .mady — the whole project, or just one experiment or graph") + " · Ctrl+S", onClick: props.onSave },
    import: { icon: <Upload size={16} />, title: "Import data (CSV/TSV/Excel) — Ctrl+I", onClick: props.onImport },
    export: { icon: <Download size={16} />, title: "Export the active graph / figure / dataset — Ctrl+E", onClick: props.onExport, disabled: !props.canExport },
    "new-dataset": { icon: <Sheet size={16} />, title: "New datasheet", onClick: props.onNewDataset },
    "duplicate-data": { icon: <Copy size={16} />, title: "Duplicate the current datasheet", onClick: props.onDuplicateData, disabled: !props.hasData },
    "new-project": { icon: <FolderPlus size={16} />, title: "New project folder — Ctrl+N", onClick: props.onNewProject },
    analyze: { icon: <Calculator size={16} />, title: "Analyze", onClick: props.onAnalyze },
    design: { icon: <Shapes size={16} />, title: "Design — significance markers and objects drawn on this graph", onClick: props.onDesign, disabled: !props.hasPlot },
    magic: { icon: <Wand2 size={16} />, title: "Apply this look to other graphs", onClick: props.onMagic, disabled: !props.hasPlot },
    undo: { icon: <Undo2 size={16} />, title: "Undo — Ctrl+Z", onClick: props.onUndo, disabled: !props.canUndo },
    redo: { icon: <Redo2 size={16} />, title: "Redo — Ctrl+Y", onClick: props.onRedo, disabled: !props.canRedo },
  };

  const dropGroup = (toIndex: number, e: React.DragEvent): void => {
    e.preventDefault();
    const name = groupDrag.current ?? (e.dataTransfer.getData("text/mady-tbgroup") as ToolbarGroupName);
    groupDrag.current = null;
    if (name) props.onReorderGroups(name, toIndex);
  };
  const dropItem = (group: ToolbarGroupName, toIndex: number, e: React.DragEvent): void => {
    e.preventDefault();
    e.stopPropagation(); // don't also fire the enclosing group drop
    const d = itemDrag.current;
    itemDrag.current = null;
    if (d && d.group === group) props.onReorderWithinGroup(group, d.id, toIndex);
  };

  return (
    <div className="toolbar">
      {/* Back / forward sit FIRST and are not draggable: they are navigation, not a tool,
          and the muscle memory for them is the top-left corner of every browser. */}
      <button className="tool" title="Back — the tab you were on before (Alt+←)" onClick={props.onBack} disabled={!props.canBack}>
        <ArrowLeft size={16} />
      </button>
      <button className="tool" title="Forward (Alt+→)" onClick={props.onForward} disabled={!props.canForward}>
        <ArrowRight size={16} />
      </button>

      {props.groups.map((g, gi) => (
        <Fragment key={g.name}>
          <span
            className="gd"
            onDragOver={(e) => {
              if (groupDrag.current) e.preventDefault();
            }}
            onDrop={(e) => dropGroup(gi, e)}
          />
          <span
            className="grp"
            onDragOver={(e) => {
              if (groupDrag.current) e.preventDefault();
            }}
            onDrop={(e) => (groupDrag.current ? dropGroup(gi, e) : undefined)}
          >
            <span
              className="gl"
              draggable
              title={`${g.name} — drag to reorder this group`}
              onDragStart={(e) => {
                groupDrag.current = g.name;
                e.dataTransfer.setData("text/mady-tbgroup", g.name);
              }}
              onDragEnd={() => {
                groupDrag.current = null;
              }}
            >
              {g.name}
            </span>
            <span className="row">
              {g.ids.map((id, ii) => (
                <button
                  key={id}
                  className="tool draggable"
                  // The button's id, on the element, so a selector such as `[data-tool="save"]`
                  // (used to mark buttons in the manual's pictures) stays stable — a title-text
                  // match would break whenever a tooltip is reworded, and the tooltips here change
                  // with state ("Save — you have unsaved changes").
                  data-tool={id}
                  title={`${items[id].title}  ·  drag to rearrange`}
                  disabled={items[id].disabled}
                  draggable
                  onDragStart={(e) => {
                    itemDrag.current = { group: g.name, id };
                    e.dataTransfer.setData("text/mady-tbitem", id);
                    e.stopPropagation();
                  }}
                  onDragEnd={() => {
                    itemDrag.current = null;
                  }}
                  onDragOver={(e) => {
                    if (itemDrag.current && itemDrag.current.group === g.name) e.preventDefault();
                  }}
                  onDrop={(e) => dropItem(g.name, ii, e)}
                  onClick={items[id].onClick}
                >
                  {items[id].icon}
                </button>
              ))}
            </span>
          </span>
        </Fragment>
      ))}

      <span className="spacer" />
      <span className="sugg-anchor">
        <button
          className={"chip" + (suggOpen ? " on" : "")}
          title="Suggested next steps for your data"
          aria-haspopup="menu"
          aria-expanded={suggOpen}
          onClick={() => setSuggOpen((o) => !o)}
        >
          <Sparkles size={14} /> Assistant
          {suggestions.length > 0 && <span className="chip-badge">{suggestions.length}</span>}
        </button>
        {suggOpen && (
          <SuggestionsPopover
            suggestions={suggestions}
            onRun={(s) => props.onRunSuggestion?.(s)}
            onDismiss={(id) => props.onDismissSuggestion?.(id)}
            onClose={() => setSuggOpen(false)}
            onResetDismissed={props.onAssistant ? () => { props.onAssistant?.(); } : undefined}
          />
        )}
      </span>
      {props.modelButton}
      {props.modelBar}
    </div>
  );
}

const LOG_ICON: Record<LogKind, typeof Sigma> = {
  import: Upload,
  graph: LineChart,
  analyze: Sigma,
  fit: Activity,
  transform: Wand2,
  note: Sparkles,
};

export function LogDrawer({
  collapsed,
  onToggle,
  log,
  onOpen,
  onClear,
}: {
  collapsed: boolean;
  onToggle: () => void;
  log: LogEntry[];
  onOpen: (entry: LogEntry) => void;
  onClear: () => void;
}) {
  return (
    <div className="drawerwrap">
      <div className="drawer" onClick={onToggle} title={collapsed ? "Show analysis log" : "Hide analysis log"}>
        {collapsed ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
        <span className="lbl">Analysis log</span>
        <span style={{ color: "var(--faint)" }}>
          {log.length} step{log.length === 1 ? "" : "s"}
        </span>
        {!collapsed && log.length > 0 && (
          <button
            className="logclear"
            onClick={(e) => {
              e.stopPropagation();
              onClear();
            }}
          >
            <Trash2 size={12} /> Clear
          </button>
        )}
      </div>
      {!collapsed && (
        <div className="logbody">
          {log.length === 0 ? (
            <p className="note" style={{ padding: "6px 11px" }}>
              No steps yet — import data, run an analysis, or make a graph and they appear here.
            </p>
          ) : (
            <ol className="loglist">
              {log.map((e, i) => {
                const Icon = LOG_ICON[e.kind];
                return (
                  <li className="logitem" key={e.id}>
                    <span className="lognum">{i + 1}</span>
                    <Icon size={13} className="logicon" />
                    <button
                      className="loglabel"
                      onClick={() => onOpen(e)}
                      disabled={!e.refId}
                      title={e.refId ? "Open" : undefined}
                    >
                      <span className="logmain">{e.label}</span>
                      {e.detail && <span className="logdetail">{e.detail}</span>}
                    </button>
                  </li>
                );
              })}
            </ol>
          )}
        </div>
      )}
    </div>
  );
}

export function StatusBar({
  project,
  engineReady,
  zoom,
  onZoomIn,
  onZoomOut,
  onZoomMenu,
  onLayoutMenu,
}: {
  project: Project;
  engineReady: boolean;
  zoom: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onZoomMenu: () => void;
  onLayoutMenu: () => void;
}) {
  const tables = project.tables.length;
  const plots = project.plots.length;
  return (
    <div className="status">
      <span>
        {tables} dataset{tables === 1 ? "" : "s"} · {plots} graph{plots === 1 ? "" : "s"}
      </span>
      <span className="statusright">
        <button className="statuslink" onClick={onLayoutMenu} title="Workspace layouts">
          <Columns3 size={13} /> Layout
        </button>
        {/* Each button is DISABLED at its own end of the range, and the readout says which
            end. Both stayed pressable at 400%, so holding + looked like a broken control rather
            than a finished one. */}
        <span className="zoomctl" title="Zoom (Ctrl + / − / 0, or Ctrl+scroll)">
          <button className="zoombtn" onClick={onZoomOut} disabled={!canZoom(zoom, -1)} aria-label="Zoom out">−</button>
          <button className="zoomval" onClick={onZoomMenu} title="Set zoom level…" data-zoom-label>
            {zoomLabel(zoom)}
          </button>
          <button className="zoombtn" onClick={onZoomIn} disabled={!canZoom(zoom, 1)} aria-label="Zoom in">+</button>
        </span>
        <span>{engineReady ? "engine ready" : "engine offline"} · saved</span>
      </span>
    </div>
  );
}
