/**
 * Ordination → graphs: the pure decision about what an ordination result (CA, PCoA, NMDS, RDA,
 * CCA or db-RDA) gets drawn as.
 *
 * Kept out of the shell for the reason `residualDiagnostics` is: the decision is the part
 * worth testing, and it must not need an app, a browser or the stats engine to check. The
 * shell only files the tables and plots this returns.
 *
 * The decision is not "the PCA suite with different data". An ordination has no loadings —
 * PCA's arrows are the variables' directions in the same space as the cases, and neither a
 * PCoA (which maps a distance matrix) nor an NMDS (which fits ranks) has such a direction. So
 * there is no loadings plot and no biplot here, ever. What each does have:
 *   CA, PCoA  eigenvalues → the map and a scree plot, exactly like PCA's.
 *   NMDS      no eigenvalues at all → the map, plus the Shepard plot, which is the diagnostic
 *             that says whether the map may be read.
 *   RDA, CCA, db-RDA  constrained → the triplot (the map with its explanatory arrows), and a
 *             scree plot when there are eigenvalues to show.
 */
import type { OrdinationData } from "./model";

/**
 * The engine methods this plan knows how to draw, and the short name each axis carries.
 *
 * One list, not a chain of `method === …` tests, so adding a method is one edit in one place.
 * The constrained set is separate because that is the only distinction the plan makes: a
 * constrained result gets the triplot, an unconstrained one the plain map.
 */
export const ORDINATION_LABELS: Record<string, string> = {
  ca: "CA", pcoa: "PCoA", nmds: "NMDS", rda: "RDA", cca: "CCA", dbrda: "db-RDA",
};
const ORDINATION_METHODS = new Set(Object.keys(ORDINATION_LABELS));
/** …and of those, the ones whose axes are built from explanatory variables. */
export const CONSTRAINED_METHODS: ReadonlySet<string> = new Set(["rda", "cca", "dbrda"]);

/** One graph an ordination result earns. */
export interface OrdinationGraph {
  /** "map" and "scree" are drawn by the existing PCA kinds; "shepard" is an ordinary xy graph. */
  role: "map" | "scree" | "shepard";
  /** The plot kind to create. */
  kind: "pcascore" | "triplot" | "scree" | "xy";
  /** Graph name suffix, after the analysis name. */
  label: string;
  /** Shepard only: the xy table to import (already sorted by dissimilarity, so the fitted
   *  step reads as a monotone line rather than a scribble). */
  table?: { columns: string[]; rows: number[][] } | undefined;
  /** Shepard only: the axis titles, which name what the diagram compares. */
  axisTitles?: { x: string; y: string } | undefined;
}

/**
 * The graphs to build for one ordination result — empty when there is no map to draw.
 * `method` is the engine method id ("ca" | "pcoa" | "nmds" | "rda" | "cca" | "dbrda"); anything
 * else returns nothing. A constrained map is its constrained axes; the environment arrows that
 * make it a triplot are a separate graph kind and are not drawn here.
 */
export function ordinationGraphPlan(method: string, ord: OrdinationData | undefined): OrdinationGraph[] {
  if (!ord || !Array.isArray(ord.scores) || ord.scores.length === 0) return [];
  if (!ORDINATION_METHODS.has(method)) return [];
  const isNmds = method === "nmds";
  const label = ORDINATION_LABELS[method] ?? "Ordination";
  // A constrained ordination gets the triplot, not the plain map: its explanatory arrows are
  // the half that makes it constrained, and a score plot would silently drop them.
  const constrained = CONSTRAINED_METHODS.has(method) && (ord.envScores?.length ?? 0) > 0;
  const out: OrdinationGraph[] = [
    constrained
      ? { role: "map", kind: "triplot", label: `${label} triplot` }
      : { role: "map", kind: "pcascore", label: `${label} map` },
  ];
  // A scree plot of one eigenvalue says nothing, and NMDS has none at all — so it is offered
  // only when there is really a spectrum to show.
  if (!isNmds && (ord.eigenvalues?.length ?? 0) > 1) {
    out.push({ role: "scree", kind: "scree", label: `${label} scree` });
  }
  const sh = ord.shepard;
  if (isNmds && sh && Array.isArray(sh.dissimilarity) && sh.dissimilarity.length > 1) {
    const n = Math.min(sh.dissimilarity.length, sh.distance.length, sh.fitted.length);
    const idx = Array.from({ length: n }, (_, i) => i).sort((a, b) => sh.dissimilarity[a]! - sh.dissimilarity[b]!);
    out.push({
      role: "shepard",
      kind: "xy",
      label: "Shepard plot",
      table: {
        columns: ["Dissimilarity", "Map distance", "Fitted (monotone)"],
        rows: idx.map((i) => [sh.dissimilarity[i]!, sh.distance[i]!, sh.fitted[i]!]),
      },
      axisTitles: { x: "Observed dissimilarity", y: "Distance on the map" },
    });
  }
  return out;
}
