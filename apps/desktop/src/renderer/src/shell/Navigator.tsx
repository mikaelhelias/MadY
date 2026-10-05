import { useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import {
  ChevronDown,
  ChevronRight,
  FileText,
  FlaskConical,
  Folder,
  LayoutGrid,
  LineChart,
  Pin,
  Plus,
  Search,
  Sigma,
  Table,
  Trash2,
} from "lucide-react";
import { DEMO_FOLDER } from "@mady/core";
import type { Experiment, NodeId, Project, ProjectFolder, WorkspaceRef } from "@mady/core";

interface NavProps {
  project: Project;
  activeKey: string;
  /** Id of the layout currently open in the dedicated assembler view (for highlighting). */
  activeLayoutId?: NodeId | null;
  onOpenObject: (kind: "table" | "plot" | "analysis", id: NodeId) => void;
  /** Open a figure layout in its dedicated full-area assembler view. */
  onOpenLayout: (id: NodeId) => void;
  /** Create a new panel figure filed under the given location (folder / experiment / loose). */
  onAddLayout: (folderId?: NodeId, experimentId?: NodeId) => void;
  onOpenDocs: (folderId: NodeId) => void;
  onAddProject: () => void;
  onAddExperiment: (folderId: NodeId) => void;
  onAddDataset: (folderId?: NodeId, experimentId?: NodeId) => void;
  onAddGraph: (sourceTableId: NodeId, folderId?: NodeId, experimentId?: NodeId) => void;
  onRename: (kind: "folder" | "experiment", folderId: NodeId, name: string, experimentId?: NodeId) => void;
  /** Rename a graph - double-click its name, the same gesture as a folder or an experiment. */
  onRenameObject?: (kind: "plot", id: NodeId, name: string) => void;
  onDeleteObject: (kind: "table" | "plot" | "analysis" | "layout", id: NodeId) => void;
  onDeleteExperiment: (folderId: NodeId, experimentId: NodeId) => void;
  onDeleteFolder: (folderId: NodeId) => void;
  /** Set (or clear) a sheet's Navigator highlight colour. */
  onSetColor?: (kind: OpenKind, id: NodeId, color: string | undefined) => void;
  /** Pin / unpin a sheet (pinned sheets sort first). */
  onSetPinned?: (kind: OpenKind, id: NodeId, pinned: boolean) => void;
}

type OpenKind = "table" | "plot" | "analysis" | "layout";

interface SheetMeta { name: string; kind: OpenKind; color?: string | undefined; pinned?: boolean | undefined; status?: "ok" | "stale" | "error" | undefined; }

/** Resolve a workspace ref to its display name + the kind to open + its sheet metadata. */
function resolve(project: Project, ref: WorkspaceRef): SheetMeta | null {
  if (ref.kind === "table") {
    const t = project.tables.find((x) => x.id === ref.id);
    return t ? { name: t.name, kind: "table", color: t.color, pinned: t.pinned, status: t.status } : null;
  }
  if (ref.kind === "plot") {
    const p = project.plots.find((x) => x.id === ref.id);
    return p ? { name: p.name, kind: "plot", color: p.color, pinned: p.pinned, status: p.status } : null;
  }
  if (ref.kind === "analysis") {
    const a = project.analyses.find((x) => x.id === ref.id);
    return a ? { name: a.name, kind: "analysis", color: a.color, pinned: a.pinned, status: a.status } : null;
  }
  if (ref.kind === "layout") {
    const l = project.layouts?.find((x) => x.id === ref.id);
    return l ? { name: l.name, kind: "layout", color: l.color, pinned: l.pinned } : null;
  }
  return null;
}

/** Preset Navigator highlight colours (+ "None"). */
const SHEET_COLORS = ["#e8554e", "#f0a730", "#4a9e5c", "#3f8fd0", "#8b6fc4", "#c94f9c", "#7a8896"] as const;

const KIND_ICON = { table: Table, plot: LineChart, analysis: Sigma, layout: LayoutGrid } as const;

const firstTableId = (project: Project, members: WorkspaceRef[]): NodeId | undefined =>
  members.find((m) => m.kind === "table" && project.tables.some((t) => t.id === m.id))?.id;

export function Navigator(props: NavProps) {
  const { project, activeKey } = props;
  /**
   * Collapsed rows. Starts with the demo project folded shut and nothing else.
   *
   * It is eight experiments of synthetic content, and expanded it fills the panel on first
   * run — so a new user's first impression of the tree is a wall of sample data rather than
   * the shape of the thing. Folded, the panel shows what it is: one project you can open.
   *
   * Note: matched by name, so it only ever applies to the folder the sample builds. A folder the
   * user made — or renamed — is theirs and opens normally. Session state, not persisted:
   * expanding it holds for as long as the app is open, and a fresh launch starts folded
   * again, because sample content should stay out of the way until the user opens it.
   */
  const [collapsed, setCollapsed] = useState<Set<string>>(
    () => new Set(project.workspace.folders.filter((f) => f.name === DEMO_FOLDER).map((f) => `fld:${f.id}`)),
  );
  const [query, setQuery] = useState("");
  const [colorFor, setColorFor] = useState<string | null>(null); // row key whose colour palette is open
  // Row key whose name is being edited. Held here, not in ObjectRow: that component is re-created on
  // every render, so state inside it would be thrown away mid-edit.
  const [renaming, setRenaming] = useState<string | null>(null);
  const isOpen = (id: string) => !collapsed.has(id);
  const toggle = (id: string) =>
    setCollapsed((s) => {
      const next = new Set(s);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  // Filter: an optional "@kind" facet (e.g. "@graph foo") + case-insensitive name substring.
  const raw = query.trim().toLowerCase();
  const facet = raw.match(/^@(\w+)\s*(.*)$/);
  const facetKind = facet
    ? ({ table: "table", data: "table", graph: "plot", plot: "plot", analysis: "analysis", result: "analysis", layout: "layout", figure: "layout" } as Record<string, OpenKind>)[facet[1]!]
    : undefined;
  const nameQuery = facet ? facet[2]! : raw;
  const searching = raw.length > 0;
  const match = (m: SheetMeta): boolean => (!facetKind || m.kind === facetKind) && m.name.toLowerCase().includes(nameQuery);
  const anyMatch = (members: WorkspaceRef[]): boolean => members.some((mm) => { const r = resolve(project, mm); return r != null && match(r); });
  // Pinned sheets sort to the top of their container (stable otherwise).
  const sortMembers = (members: WorkspaceRef[]): WorkspaceRef[] =>
    [...members].sort((a, b) => (resolve(project, b)?.pinned ? 1 : 0) - (resolve(project, a)?.pinned ? 1 : 0));

  // The dataset a graph / analysis was made from (its `source` table). Tables and figure
  // layouts have no parent dataset. Used to indent a graph/analysis under its dataset in the tree.
  const sourceOf = (ref: WorkspaceRef): NodeId | undefined => {
    if (ref.kind === "plot") return project.plots.find((p) => p.id === ref.id)?.source;
    if (ref.kind === "analysis") return project.analyses.find((a) => a.id === ref.id)?.source;
    return undefined;
  };

  /**
   * Render a container's members with each graph / analysis indented one level under the dataset it
   * was made from, so analyses and graphs are clearly visually linked to their
   * dataset. A graph whose dataset is not in this container (filed elsewhere, or a figure layout,
   * which has no single source) stays at the base depth. Otherwise members keep their order,
   * with pinned sheets first.
   */
  function renderMembers(members: WorkspaceRef[], baseDepth: number) {
    const sorted = sortMembers(members);
    const tableIds = new Set(sorted.filter((m) => m.kind === "table").map((m) => m.id));
    const childrenByTable = new Map<NodeId, WorkspaceRef[]>();
    const claimed = new Set<NodeId>();
    for (const m of sorted) {
      const src = sourceOf(m);
      if (src && tableIds.has(src)) {
        const arr = childrenByTable.get(src);
        if (arr) arr.push(m);
        else childrenByTable.set(src, [m]);
        claimed.add(m.id);
      }
    }
    const rows: ReactNode[] = [];
    for (const m of sorted) {
      if (claimed.has(m.id)) continue; // rendered under its dataset, below
      if (m.kind === "table") {
        const childItems = childrenByTable.get(m.id) ?? [];
        const meMatch = (() => { const r = resolve(project, m); return r != null && match(r); })();
        const childMatch = childItems.some((k) => { const r = resolve(project, k); return r != null && match(r); });
        if (searching && !meMatch && !childMatch) continue; // nothing here matches the search
        rows.push(<ObjectRow key={m.kind + m.id} refItem={m} depth={baseDepth} forceShow={searching && !meMatch && childMatch} />);
        for (const k of childItems) rows.push(<ObjectRow key={k.kind + k.id} refItem={k} depth={baseDepth + 1} isChild />);
      } else {
        rows.push(<ObjectRow key={m.kind + m.id} refItem={m} depth={baseDepth} />);
      }
    }
    return rows;
  }

  function ObjectRow({ refItem, depth, forceShow = false, isChild = false }: { refItem: WorkspaceRef; depth: number; forceShow?: boolean; isChild?: boolean }) {
    const r = resolve(project, refItem);
    if (!r) return null;
    // `forceShow` keeps a dataset row visible during a search when the search matched one of its
    // graphs/analyses but not the dataset name itself — so the match isn't left indented under nothing.
    if (!forceShow && !match(r)) return null;
    const padLeft = 8 + depth * 16 + 18;
    const rowStyle: CSSProperties = { paddingLeft: padLeft, boxShadow: r.color ? `inset 3px 0 0 ${r.color}` : undefined };
    // For an indented child, drop the guide elbow from the dataset one level up (its icon column).
    if (isChild) (rowStyle as Record<string, string | number>)["--guide"] = `${padLeft - 16 - 2}px`;
    const key = `${r.kind}:${refItem.id}`;
    const Icon = KIND_ICON[r.kind];
    // Layouts open in their own full-area view (not a tab) and highlight via activeLayoutId.
    const isLayout = r.kind === "layout";
    const active = isLayout ? props.activeLayoutId === refItem.id : key === activeKey;
    const open = (): void => (isLayout ? props.onOpenLayout(refItem.id) : props.onOpenObject(r.kind as "table" | "plot" | "analysis", refItem.id));
    const paletteOpen = colorFor === key;
    // Graphs rename like folders and experiments. A graph with no title of its own draws its name as
    // the title, so renaming it also changes the drawn title.
    const renamable = r.kind === "plot" && props.onRenameObject != null;
    return (
      // Leaves have no twist button, so add a twist-width offset (18) to sit
      // clearly under the parent label rather than aligning with its chevron.
      <div className={"navrow" + (active ? " on" : "") + (isChild ? " child" : "")} style={rowStyle}>
        {renamable && renaming === key ? (
          <>
            <Icon size={13} />
            <NameEditInput value={r.name} onCommit={(name) => props.onRenameObject!("plot", refItem.id, name)} onDone={() => setRenaming(null)} />
          </>
        ) : (
          <button className="navlabelbtn" onClick={open} title={renamable ? `${r.name} — double-click to rename` : r.name}>
            <Icon size={13} /> <span className="navlabel" {...(renamable ? { onDoubleClick: () => setRenaming(key) } : {})}>{r.name}</span>
            {r.pinned && <Pin size={10} style={{ fill: "currentColor", opacity: 0.5, marginLeft: 4, flexShrink: 0 }} />}
            {r.status === "stale" && <span className="badge badge-warn" style={{ marginLeft: 6 }}>stale</span>}
          </button>
        )}
        <span className="navacts">
          {props.onSetPinned && (
            <button className={"mini" + (r.pinned ? " on" : "")} title={r.pinned ? "Unpin" : "Pin to top"} onClick={() => props.onSetPinned!(r.kind, refItem.id, !r.pinned)}>
              <Pin size={12} style={{ fill: r.pinned ? "currentColor" : "none" }} />
            </button>
          )}
          {props.onSetColor && (
            <button className="mini" title="Highlight colour" onClick={() => setColorFor(paletteOpen ? null : key)}>
              <span style={{ width: 11, height: 11, borderRadius: 3, display: "inline-block", background: r.color ?? "transparent", border: r.color ? "none" : "1.5px solid currentColor", opacity: r.color ? 1 : 0.6 }} />
            </button>
          )}
          <button className="mini" title={`Delete ${r.kind}`} onClick={() => props.onDeleteObject(r.kind, refItem.id)}>
            <Trash2 size={12} />
          </button>
        </span>
        {paletteOpen && props.onSetColor && (
          <span className="navpalette" role="group" aria-label="Highlight colour">
            <button className="swatch none" title="None" onClick={() => { props.onSetColor!(r.kind, refItem.id, undefined); setColorFor(null); }} />
            {SHEET_COLORS.map((c) => (
              <button key={c} className="swatch" title={c} style={{ background: c }} onClick={() => { props.onSetColor!(r.kind, refItem.id, c); setColorFor(null); }} />
            ))}
          </span>
        )}
      </div>
    );
  }

  function ExperimentNode({ folder, exp }: { folder: ProjectFolder; exp: Experiment }) {
    const id = `exp:${exp.id}`;
    const open = isOpen(id) || (searching && anyMatch(exp.members));
    const srcTable = firstTableId(project, exp.members);
    return (
      <div>
        <div className="navrow" style={{ paddingLeft: 8 + 16 }}>
          <button className="twist" onClick={() => toggle(id)} aria-label="Toggle">
            {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          </button>
          <FlaskConical size={13} />
          <EditableLabel
            value={exp.name}
            onCommit={(name) => props.onRename("experiment", folder.id, name, exp.id)}
          />
          <span className="navacts">
            <button className="mini" title="Add dataset" onClick={() => props.onAddDataset(folder.id, exp.id)}>
              <Table size={12} />
              <Plus size={9} />
            </button>
            <button
              className="mini"
              title={srcTable ? "Add graph of this experiment's data" : "Add a dataset first"}
              disabled={!srcTable}
              onClick={() => srcTable && props.onAddGraph(srcTable, folder.id, exp.id)}
            >
              <LineChart size={12} />
              <Plus size={9} />
            </button>
            <button className="mini" title="New panel figure for this experiment" onClick={() => props.onAddLayout(folder.id, exp.id)}>
              <LayoutGrid size={12} />
              <Plus size={9} />
            </button>
            <button className="mini" title="Delete experiment (and its objects)" onClick={() => props.onDeleteExperiment(folder.id, exp.id)}>
              <Trash2 size={12} />
            </button>
          </span>
        </div>
        {open && renderMembers(exp.members, 2)}
      </div>
    );
  }

  function FolderNode({ folder }: { folder: ProjectFolder }) {
    const id = `fld:${folder.id}`;
    const open = isOpen(id) || (searching && (anyMatch(folder.members) || folder.experiments.some((e) => anyMatch(e.members))));
    return (
      <div className="navfolder">
        <div className="navrow">
          <button className="twist" onClick={() => toggle(id)} aria-label="Toggle">
            {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          </button>
          <Folder size={13} />
          <EditableLabel value={folder.name} onCommit={(name) => props.onRename("folder", folder.id, name)} />
          <span className="navacts">
            <button className="mini" title="Open documentation" onClick={() => props.onOpenDocs(folder.id)}>
              <FileText size={12} />
            </button>
            <button className="mini" title="Add experiment" onClick={() => props.onAddExperiment(folder.id)}>
              <FlaskConical size={12} />
              <Plus size={9} />
            </button>
            <button className="mini" title="New panel figure for this project (panels can span its experiments)" onClick={() => props.onAddLayout(folder.id)}>
              <LayoutGrid size={12} />
              <Plus size={9} />
            </button>
            <button className="mini" title="Delete project (and everything in it)" onClick={() => props.onDeleteFolder(folder.id)}>
              <Trash2 size={12} />
            </button>
          </span>
        </div>
        {open && (
          <>
            {renderMembers(folder.members, 1)}
            {folder.experiments.map((e) => (
              <ExperimentNode key={e.id} folder={folder} exp={e} />
            ))}
          </>
        )}
      </div>
    );
  }

  const loose = project.workspace.loose;

  return (
    <div className="nav">
      <div className="search">
        <Search size={14} />
        <input
          className="searchin"
          placeholder="Find… (try @graph)"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      <div className="navtop">
        <span className="navtitle">Project tree</span>
        <button className="mini" title="New project folder" onClick={props.onAddProject}>
          <Folder size={12} />
          <Plus size={9} />
        </button>
        <button className="mini" title="New standalone panel figure" onClick={() => props.onAddLayout()}>
          <LayoutGrid size={12} />
          <Plus size={9} />
        </button>
      </div>

      {project.workspace.folders.map((f) => (
        <FolderNode key={f.id} folder={f} />
      ))}

      {loose.length > 0 && (
        <div>
          <div className="navsec">Unfiled</div>
          {renderMembers(loose, 0)}
        </div>
      )}

      {project.workspace.folders.length === 0 && loose.length === 0 && (
        <p className="note" style={{ padding: "4px 6px" }}>
          Empty project — add a project folder to begin.
        </p>
      )}
    </div>
  );
}

/**
 * The rename box: Enter or blur commits a changed, non-blank name; Escape cancels. One implementation
 * for folders, experiments and graphs, so the three cannot drift apart.
 * `cancelled` guards the blur some browsers fire when a focused input is removed - without it, Escape
 * could still commit the draft on the way out.
 */
function NameEditInput({ value, onCommit, onDone }: { value: string; onCommit: (v: string) => void; onDone: () => void }) {
  const [draft, setDraft] = useState(value);
  const cancelled = useRef(false);
  return (
    <input
      className="navedit"
      autoFocus
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        onDone();
        const next = draft.trim();
        if (!cancelled.current && next && next !== value) onCommit(next);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") {
          cancelled.current = true;
          onDone();
        }
      }}
    />
  );
}

/** Double-click to rename; Enter / blur commits, Escape cancels. */
function EditableLabel({ value, onCommit }: { value: string; onCommit: (v: string) => void }) {
  const [editing, setEditing] = useState(false);
  if (editing) return <NameEditInput value={value} onCommit={onCommit} onDone={() => setEditing(false)} />;
  return (
    <span className="navlabel" onDoubleClick={() => setEditing(true)} title="Double-click to rename">
      {value}
    </span>
  );
}
