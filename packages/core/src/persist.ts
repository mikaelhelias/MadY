/**
 * Persistence helpers — a `.mady` file is just a serialized `Project` (JSON),
 * loaded back through the migration framework (`migrate`). These pure functions
 * support save-granularity (whole project vs a part of it) and id-seeding; the
 * actual file dialog + atomic write live in the Electron main process.
 *
 * **A part saves as a whole project.** Saving one experiment — or one graph —
 * writes a normal, self-contained `.mady`: the data table travels with the graph
 * (by design), so the file opens anywhere as a new project. There
 * is no partial format, no merge, and therefore no id collisions to resolve.
 */

import type { NodeId, Project, Workspace, WorkspaceObjectKind, WorkspaceRef } from "./model";

/** Every id used anywhere in a project (entities + organizational tree). */
export function collectIds(project: Project): NodeId[] {
  const ids: NodeId[] = [];
  for (const t of project.tables) {
    ids.push(t.id);
    for (const c of t.columns) ids.push(c.id);
    for (const r of t.rows) ids.push(r.id);
  }
  for (const p of project.plots) ids.push(p.id);
  for (const a of project.analyses) ids.push(a.id);
  for (const m of project.methods ?? []) ids.push(m.id);
  for (const l of project.layouts ?? []) ids.push(l.id);
  for (const l of project.log) ids.push(l.id);
  for (const f of project.workspace.folders) {
    ids.push(f.id);
    for (const e of f.experiments) ids.push(e.id);
  }
  return ids;
}

/**
 * One thing the user ticked in the Save dialog: a project folder, an experiment
 * inside one, or a single object (a graph, a data table, a result, a figure).
 */
export type SavePick =
  | { level: "folder"; id: NodeId }
  | { level: "experiment"; id: NodeId }
  | { level: "object"; kind: WorkspaceObjectKind; id: NodeId };

const refKey = (kind: WorkspaceObjectKind, id: NodeId): string => `${kind}:${id}`;

/** Where an entity is filed in the source project's tree. */
interface Place {
  folderId?: NodeId | undefined;
  experimentId?: NodeId | undefined;
}

/** First location of every filed entity (an object filed twice keeps its first home). */
function placesOf(workspace: Workspace): Map<string, Place> {
  const places = new Map<string, Place>();
  const put = (r: WorkspaceRef, place: Place): void => {
    const k = refKey(r.kind, r.id);
    if (!places.has(k)) places.set(k, place);
  };
  for (const r of workspace.loose) put(r, {});
  for (const f of workspace.folders) {
    for (const r of f.members) put(r, { folderId: f.id });
    for (const e of f.experiments) for (const r of e.members) put(r, { folderId: f.id, experimentId: e.id });
  }
  return places;
}

/**
 * Extract a self-contained sub-project from the ticked parts.
 *
 * Two guarantees, both required:
 * 1. **It carries its data.** A kept graph pulls in its source table (and the analysis it
 *    came from, and that analysis's table); a kept figure pulls in its panel graphs. Chased
 *    to a fixed point, so an analysis pulled in by a graph still gets its own table.
 * 2. **Everything kept is reachable.** The Navigator draws the workspace tree and nothing
 *    else, so an entity that is in `tables` but in no folder is invisible — a saved graph
 *    whose datasheet cannot be opened. Every kept entity is filed: in its original folder /
 *    experiment when that container was ticked too, otherwise at the top level.
 *
 * Folders and experiments are kept only when they were ticked (or hold something ticked), so
 * saving one graph does not resurrect the folder its source table happened to live in.
 */
export function extractPicks(project: Project, picks: readonly SavePick[]): Project {
  const pickedFolders = new Set(picks.filter((p) => p.level === "folder").map((p) => p.id));
  const pickedExperiments = new Set(picks.filter((p) => p.level === "experiment").map((p) => p.id));

  // --- which containers survive (an "anchor" is a ticked folder/experiment, or the home
  // of a ticked object — saving one graph keeps the experiment it sits in, for context).
  const keepFolder = new Set<NodeId>(pickedFolders);
  const keepExperiment = new Set<NodeId>(pickedExperiments);
  for (const f of project.workspace.folders) {
    for (const e of f.experiments) if (pickedExperiments.has(e.id)) keepFolder.add(f.id);
  }

  // --- the refs the ticks name directly
  const wanted = new Set<string>();
  const want = (r: WorkspaceRef): void => void wanted.add(refKey(r.kind, r.id));
  for (const p of picks) if (p.level === "object") wanted.add(refKey(p.kind, p.id));
  for (const f of project.workspace.folders) {
    const wholeFolder = pickedFolders.has(f.id);
    if (wholeFolder) for (const r of f.members) want(r);
    for (const e of f.experiments) {
      if (wholeFolder) keepExperiment.add(e.id);
      if (wholeFolder || pickedExperiments.has(e.id)) for (const r of e.members) want(r);
    }
  }
  const places = placesOf(project.workspace);
  for (const p of picks) {
    if (p.level !== "object") continue;
    const place = places.get(refKey(p.kind, p.id));
    if (place?.folderId) keepFolder.add(place.folderId);
    if (place?.experimentId) keepExperiment.add(place.experimentId);
  }

  // --- dependency closure: a part must be able to draw itself
  const plotIds = new Set<NodeId>();
  const analysisIds = new Set<NodeId>();
  const tableIds = new Set<NodeId>();
  const layoutIds = new Set<NodeId>();
  const bucket = { plot: plotIds, analysis: analysisIds, table: tableIds, layout: layoutIds } as const;
  for (const k of wanted) {
    const idx = k.indexOf(":");
    const kind = k.slice(0, idx) as WorkspaceObjectKind;
    bucket[kind]?.add(k.slice(idx + 1));
  }
  const hasAnalysis = (id: NodeId | undefined): id is NodeId => !!id && project.analyses.some((a) => a.id === id);
  const hasTable = (id: NodeId | undefined): id is NodeId => !!id && project.tables.some((t) => t.id === id);
  for (let pass = 0; pass < 32; pass++) {
    const before = plotIds.size + analysisIds.size + tableIds.size;
    for (const l of project.layouts ?? []) if (layoutIds.has(l.id)) for (const pid of l.panels) plotIds.add(pid);
    for (const p of project.plots) {
      if (!plotIds.has(p.id)) continue;
      tableIds.add(p.source);
      if (hasAnalysis(p.analysisSource)) analysisIds.add(p.analysisSource);
      for (const fit of [p.fit, ...(p.fits ?? [])]) {
        if (hasAnalysis(fit?.analysisSource)) analysisIds.add(fit.analysisSource);
      }
      // A series borrowed from another datasheet — without that sheet the graph draws it missing.
      for (const ov of p.overlays ?? []) if (hasTable(ov.table)) tableIds.add(ov.table);
      // The test behind a p-value bracket — without it the bracket can never be re-synced.
      for (const ann of p.annotations ?? []) if (hasAnalysis(ann.sig?.analysisId)) analysisIds.add(ann.sig.analysisId);
    }
    for (const a of project.analyses) if (analysisIds.has(a.id)) tableIds.add(a.source);
    // A transformed sheet's own source ("" for a generated sheet, which has none).
    for (const t of project.tables) if (tableIds.has(t.id) && hasTable(t.derivation?.source)) tableIds.add(t.derivation.source);
    if (plotIds.size + analysisIds.size + tableIds.size === before) break;
  }

  const tables = project.tables.filter((t) => tableIds.has(t.id));
  const plots = project.plots.filter((p) => plotIds.has(p.id));
  const analyses = project.analyses.filter((a) => analysisIds.has(a.id));
  const layouts = (project.layouts ?? []).filter((l) => layoutIds.has(l.id));

  // --- rebuild the tree: keep the original order + containers, file the rest at top level
  const kept = new Set<string>();
  for (const t of tables) kept.add(refKey("table", t.id));
  for (const p of plots) kept.add(refKey("plot", p.id));
  for (const a of analyses) kept.add(refKey("analysis", a.id));
  for (const l of layouts) kept.add(refKey("layout", l.id));

  const filed = new Set<string>();
  const take = (members: readonly WorkspaceRef[]): WorkspaceRef[] => {
    const out = members.filter((r) => kept.has(refKey(r.kind, r.id)) && !filed.has(refKey(r.kind, r.id)));
    for (const r of out) filed.add(refKey(r.kind, r.id));
    return out;
  };

  const folders = project.workspace.folders
    .filter((f) => keepFolder.has(f.id))
    .map((f) => ({
      ...f,
      members: take(f.members),
      experiments: f.experiments
        .filter((e) => keepExperiment.has(e.id))
        .map((e) => ({ ...e, members: take(e.members) })),
    }));

  const loose: WorkspaceRef[] = take(project.workspace.loose);
  // Anything pulled in as a dependency whose home was not kept (or was never filed at all)
  // still has to be visible — file it at the top level.
  for (const t of tables) if (!filed.has(refKey("table", t.id))) loose.push({ kind: "table", id: t.id });
  for (const p of plots) if (!filed.has(refKey("plot", p.id))) loose.push({ kind: "plot", id: p.id });
  for (const a of analyses) if (!filed.has(refKey("analysis", a.id))) loose.push({ kind: "analysis", id: a.id });
  for (const l of layouts) if (!filed.has(refKey("layout", l.id))) loose.push({ kind: "layout", id: l.id });

  return {
    schemaVersion: project.schemaVersion,
    tables,
    plots,
    analyses,
    layouts,
    // Method files are a project-wide reusable library (not folder-scoped), so carry them
    // all rather than silently dropping them from a subset.
    ...(project.methods ? { methods: project.methods } : {}),
    // User-built colour ramps travel with a subset save. A plot references a gradient as
    // `custom:<id>`; dropping the registry here would make "save this graph" produce a file
    // that opens with the graph's colours missing (viridis + a warning) — the exact failure
    // the project-level registry exists to prevent.
    ...(project.gradients ? { gradients: project.gradients } : {}),
    // The log is project-wide; a subset starts with a fresh log.
    log: [],
    workspace: { folders, loose },
  };
}

/**
 * Extract a self-contained sub-project containing only the given folders and the
 * tables/plots they reference. Kept as the folder-shaped entry point onto
 * [[extractPicks]] (used to "save selected folders" to a `.mady`).
 */
export function extractProject(project: Project, folderIds: readonly NodeId[]): Project {
  return extractPicks(project, folderIds.map((id) => ({ level: "folder", id }) as const));
}
