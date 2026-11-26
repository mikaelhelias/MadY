import { DEMO_FOLDER, migrate } from "@mady/core";
import type { NodeId, Project } from "@mady/core";

/** The experiment inside the demo project that gallery cards open into. */
export const GALLERY_EXPERIMENT = "Gallery";

/**
 * Whether the launch document holds anything of the user's own, rather than only the demo
 * project they have been looking around in.
 *
 * The user's own: any table, graph, analysis or figure not filed in the demo project (a project
 * of their own, or unfiled), and any datasheet inside the demo project that is neither one of the
 * demo's own (`demoTableIds`, recorded at launch) nor a gallery card's copy. Changing the demo's
 * data or graphs, and opening gallery cards, is exploring.
 */
export function hasOwnWork(project: Project, demoTableIds: ReadonlySet<NodeId>): boolean {
  const demo = project.workspace.folders.find((f) => f.name === DEMO_FOLDER);
  const inDemo = new Set<NodeId>();
  const fromGallery = new Set<NodeId>();
  if (demo) {
    for (const m of demo.members) inDemo.add(m.id);
    for (const e of demo.experiments) {
      for (const m of e.members) {
        inDemo.add(m.id);
        if (e.name === GALLERY_EXPERIMENT) fromGallery.add(m.id);
      }
    }
  }
  const objects = [...project.tables, ...project.plots, ...project.analyses, ...(project.layouts ?? [])];
  if (objects.some((o) => !inDemo.has(o.id))) return true;
  return project.tables.some((t) => !demoTableIds.has(t.id) && !fromGallery.has(t.id));
}

/**
 * Whether a crash-recovery copy holds only the demo project — nothing of the user's own by
 * `hasOwnWork`. Such a copy is not offered back at launch. A copy that cannot be read is not
 * judged here (false): it is offered as it is, so nothing of the user's is ever thrown away unseen.
 */
export function isDemoOnlySnapshot(json: string, demoTableIds: ReadonlySet<NodeId>): boolean {
  try {
    return !hasOwnWork(migrate(JSON.parse(json) as Record<string, unknown>), demoTableIds);
  } catch {
    return false;
  }
}
