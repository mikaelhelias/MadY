// @vitest-environment node
/**
 * The triplot — three families in one picture, which is why it is its own kind.
 *
 * A constrained ordination has something the unconstrained ones do not: explanatory variables,
 * drawn as arrows from the origin. And it has two ways of placing the cases — LC (from the
 * explanatory variables) and WA (from the observed response) — which is the argument the
 * literature has, so the graph must draw one, say which, and let the reader switch.
 *
 * A factor's level is drawn as a centroid, never an arrow: "Management: grazed" names a
 * place in the ordination, and an arrow would claim a direction of increase a category has no
 * such thing as.
 */
import { describe, expect, it } from "vitest";
import type { DataTable, PcaGraphData, Plot } from "@mady/core";
import { buildPlotScene } from "./buildScene";

const SIZE = { width: 640, height: 460 };
const table: DataTable = { id: "t", kind: "pca", name: "T", columns: [{ id: "a", name: "A" }], rows: [] };
const pca: PcaGraphData = {
  varLabels: ["Sph", "Car", "Fes"],
  pcLabels: ["RDA1", "RDA2"],
  loadings: [],
  scores: [[-1.9, 0.5], [0.1, -0.6], [1.7, 0.3], [1.2, -0.9]],
  lcScores: [[-1.9, 0.5], [0.1, -0.6], [1.7, 0.3], [1.2, -0.9]],
  waScores: [[-2.4, 0.9], [0.5, -1.0], [1.2, 0.7], [1.6, -1.3]],
  eigenvalues: [2.04, 0.68],
  explained: [0.51, 0.17],
  speciesScores: [[-2.0, 0.2], [-0.4, -0.5], [1.9, 0.4]],
  speciesLabels: ["Sph", "Car", "Fes"],
  envScores: [[-0.93, 0.12], [0.81, 0.35], [0.44, -0.72]],
  envLabels: ["Water table", "pH", "Management: grazed"],
  envIsFactor: [false, false, true],
};
const build = (style: NonNullable<Plot["pcaStyle"]> = {}, data: PcaGraphData = pca, kind = "triplot") =>
  buildPlotScene(table, { id: "p", name: "P", source: "t", status: "ok", styleOverrides: {}, kind, pca: data, pcaStyle: style } as Plot, SIZE);

const arrows = (s: ReturnType<typeof build>) => s.annotations.filter((a) => a.kind === "arrow" && a.id.startsWith("pca-arrow-"));
const labelOf = (s: ReturnType<typeof build>, id: string) => s.annotations.find((a) => a.id === id);

describe("the three families", () => {
  it("draws all three — cases, response variables, explanatory variables", () => {
    const s = build();
    expect(s.series.find((x) => x.id === "pca-scores")?.marks, "no cases").toHaveLength(4);
    expect(s.series.find((x) => x.id === "pca-species")?.marks, "no response variables").toHaveLength(3);
    expect(arrows(s).map((a) => a.id), "no explanatory arrows — that is what makes it a TRIplot")
      .toEqual(["pca-arrow-e0", "pca-arrow-e1"]);
  });

  it("a factor level is a centroid, not an arrow", () => {
    const s = build();
    // "Management: grazed" is the third explanatory column and is flagged as a factor level.
    expect(arrows(s).some((a) => a.id === "pca-arrow-e2"), "a category was given a direction of increase").toBe(false);
    const centroids = s.series.find((x) => x.id === "pca-env");
    expect(centroids?.marks, "the factor level was dropped instead of being placed").toHaveLength(1);
    expect(labelOf(s, "pca-vlabel-e2")?.label).toBe("Management: grazed");
  });

  it("every explanatory variable is named, arrow or centroid", () => {
    const s = build();
    expect(["e0", "e1", "e2"].map((k) => labelOf(s, `pca-vlabel-${k}`)?.label))
      .toEqual(["Water table", "pH", "Management: grazed"]);
  });

  it("the arrows start at the origin and are locked — an arrow's geometry is the data", () => {
    const s = build();
    for (const a of arrows(s)) {
      expect(a.locked, "a draggable arrow could be moved away from the correlation it draws").toBe(true);
      expect(a.deletable).toBe(false);
      expect(a.x1).toBeCloseTo(arrows(s)[0]!.x1!, 6);
    }
  });
});

describe("LC vs WA — the argument the literature has", () => {
  it("defaults to WA (the observed response), and LC draws a different picture", () => {
    const wa = build().series.find((x) => x.id === "pca-scores")!.marks.map((m) => m.dx);
    const lc = build({ siteScores: "lc" }).series.find((x) => x.id === "pca-scores")!.marks.map((m) => m.dx);
    expect(wa).toEqual([-2.4, 0.5, 1.2, 1.6]);
    expect(lc).toEqual([-1.9, 0.1, 1.7, 1.2]);
    expect(lc, "the switch changed nothing — the two placements are the point of the control").not.toEqual(wa);
  });

  it("falls back to `scores` when an analysis carries only one placement", () => {
    const one: PcaGraphData = { ...pca };
    delete (one as { lcScores?: unknown }).lcScores;
    delete (one as { waScores?: unknown }).waScores;
    expect(build({ siteScores: "lc" }, one).series.find((x) => x.id === "pca-scores")!.marks.map((m) => m.dx))
      .toEqual([-1.9, 0.1, 1.7, 1.2]);
  });
});

describe("the picture holds together", () => {
  it("the arrows are stretched to the cloud — correlations never leave the unit circle", () => {
    const s = build();
    const reach = Math.max(...arrows(s).map((a) => Math.abs(a.x2! - a.x1!)));
    const cloud = s.plot.width / 2;
    expect(reach, "the arrows sit in a knot at the origin beside a cloud several units wide")
      .toBeGreaterThan(cloud * 0.3);
    // …and the reach is user-settable: a bigger multiplier draws longer arrows
    const longer = build({ arrowScale: 1.6 });
    expect(Math.max(...arrows(longer).map((a) => Math.abs(a.x2! - a.x1!)))).toBeGreaterThan(reach);
  });

  it("the axes hold every family", () => {
    const s = build();
    const xs = [
      ...s.series.flatMap((f) => f.marks.map((m) => m.cx)),
      ...arrows(s).map((a) => a.x2!),
    ];
    for (const x of xs) {
      expect(x).toBeGreaterThanOrEqual(s.plot.x - 1);
      expect(x).toBeLessThanOrEqual(s.plot.x + s.plot.width + 1);
    }
  });

  it("each switch turns its own family off, and nothing else", () => {
    expect(build({ showEnv: false }).annotations.filter((a) => a.id.startsWith("pca-arrow-"))).toEqual([]);
    expect(build({ showSites: false }).series.find((x) => x.id === "pca-scores")).toBeUndefined();
    expect(build({ showSpecies: false }).series.find((x) => x.id === "pca-species")).toBeUndefined();
    // …and the others survive each time
    expect(build({ showEnv: false }).series.find((x) => x.id === "pca-scores")).toBeTruthy();
    expect(build({ showSites: false }).annotations.filter((a) => a.id.startsWith("pca-arrow-")).length).toBeGreaterThan(0);
  });

  it("response variables can be drawn as arrows instead — and then not also as points", () => {
    const s = build({ speciesAs: "arrows" });
    expect(s.series.find((x) => x.id === "pca-species"), "the same variable drawn twice").toBeUndefined();
    expect(s.annotations.filter((a) => a.kind === "arrow" && a.id.startsWith("pca-arrow-s"))).toHaveLength(3);
  });

  it("a triplot with no explanatory variables says so — without them it is only a score plot", () => {
    const bare: PcaGraphData = { ...pca };
    delete (bare as { envScores?: unknown }).envScores;
    const s = build({}, bare);
    expect(s.warnings.some((w) => /no explanatory variables/i.test(w)), `warnings were ${JSON.stringify(s.warnings)}`).toBe(true);
  });

  it("the other ordination kinds draw no arrows from this data — only the triplot is a triplot", () => {
    expect(arrows(build({}, pca, "pcascore"))).toEqual([]);
  });
});

/**
 * No label sits on anything: a label must not collide with data points, an axis, the legend
 * or any other text.
 *
 * Measured on the built scene: every drawn label's box against every mark, every arrow, the
 * legend and every other label. Pushing labels apart from each other alone, and only
 * vertically, is not enough.
 */
describe("labels collide with nothing", () => {
  const FONT = 11;
  const wide = (t: string) => t.length * FONT * 0.5 * 1.15;
  const boxOf = (a: { label?: string | undefined; labelX?: number | undefined; labelY?: number | undefined; labelAnchor?: string | undefined }) => {
    const w = wide(a.label ?? "");
    const x = a.labelX ?? 0;
    return { x1: a.labelAnchor === "end" ? x - w : x, y1: (a.labelY ?? 0) - FONT * 0.55, x2: a.labelAnchor === "end" ? x : x + w, y2: (a.labelY ?? 0) + FONT * 0.55 };
  };
  const hit = (a: { x1: number; y1: number; x2: number; y2: number }, b: { x1: number; y1: number; x2: number; y2: number }) =>
    a.x1 < b.x2 && b.x1 < a.x2 && a.y1 < b.y2 && b.y1 < a.y2;
  /**
   * A crowded fixture, on purpose. The card's own data does not put a name on an arrow or on
   * another name, so it could not exercise two of the four rules — and a case that cannot fail
   * is not a guard. Here: one species sits on the "pH" arrow, two species sit on top of each
   * other, and one sits under a case dot.
   */
  const carded: PcaGraphData = {
    ...pca,
    groups: ["Bog", "Bog", "Fen", "Grassland"],
    // pH points at (0.81, 0.35); half way along it is (0.4, 0.17) once scaled — and a case dot
    // sits at (0.1, -0.6), which the third species is placed on.
    // Note: WA coordinates: the graph draws WA scores by default, so a species placed at an LC
    // position would not land under a dot and the case would prove nothing.
    speciesScores: [[0.62, 0.27], [0.66, 0.28], [1.2, 0.7]],
    speciesLabels: ["On the arrow", "On its neighbour", "Under a dot"],
  };
  const scene = () => build({}, carded);
  const labels = () => scene().annotations.filter((a) => a.id.startsWith("pca-vlabel-"));

  it("every label is still drawn (the rule moves them, it never hides them)", () => {
    expect(labels()).toHaveLength(6); // 3 species + 3 explanatory
  });

  it("the fixture really is crowded — without this the rules below prove nothing", () => {
    // Each subject starts on top of something: the arrow, its neighbour, a case dot.
    const s = scene();
    const sp = s.series.find((f) => f.id === "pca-species")!;
    const dots = s.series.filter((f) => f.id.startsWith("pca-g") || f.id === "pca-scores").flatMap((f) => f.marks);
    const near = (a: { cx: number; cy: number }, b: { cx: number; cy: number }) => Math.hypot(a.cx - b.cx, a.cy - b.cy) < 14;
    expect(near(sp.marks[0]!, sp.marks[1]!), "the two species are not actually on top of each other").toBe(true);
    expect(dots.some((d) => near(d, sp.marks[2]!)), "no species sits under a case dot").toBe(true);
  });

  it("no label sits on a data point", () => {
    const s = scene();
    for (const l of s.annotations.filter((a) => a.id.startsWith("pca-vlabel-"))) {
      for (const f of s.series) {
        for (const m of f.marks) {
          const r = Math.max(3, f.symbolSize ?? 4);
          const disc = { x1: m.cx - r, y1: m.cy - r, x2: m.cx + r, y2: m.cy + r };
          expect(hit(boxOf(l), disc), `"${l.label}" sits on a mark of ${f.id}`).toBe(false);
        }
      }
    }
  });

  it("no label sits on an arrow", () => {
    const s = scene();
    const arrows = s.annotations.filter((a) => a.kind === "arrow");
    expect(arrows.length, "no arrows in this fixture — the case would prove nothing").toBeGreaterThan(0);
    for (const l of s.annotations.filter((a) => a.id.startsWith("pca-vlabel-"))) {
      for (const a of arrows) {
        // sample the shaft
        for (let t = 0; t <= 1.0001; t += 0.05) {
          const x = a.x1! + (a.x2! - a.x1!) * t;
          const y = a.y1! + (a.y2! - a.y1!) * t;
          expect(hit(boxOf(l), { x1: x - 2, y1: y - 2, x2: x + 2, y2: y + 2 }), `"${l.label}" sits on ${a.id}`).toBe(false);
        }
      }
    }
  });

  // Separating labels from each other is the most basic placement requirement; this guards
  // it in the placer.
  it("no label sits on another label", () => {
    const ls = labels();
    for (let i = 0; i < ls.length; i++) {
      for (let j = i + 1; j < ls.length; j++) {
        expect(hit(boxOf(ls[i]!), boxOf(ls[j]!)), `"${ls[i]!.label}" and "${ls[j]!.label}" print through each other`).toBe(false);
      }
    }
  });

  it("no label runs out over the axis — they stay inside the plot", () => {
    const s = scene();
    for (const l of s.annotations.filter((a) => a.id.startsWith("pca-vlabel-"))) {
      const b = boxOf(l);
      expect(b.x1, `"${l.label}" runs off the left`).toBeGreaterThanOrEqual(s.plot.x - 1);
      expect(b.x2, `"${l.label}" runs off the right`).toBeLessThanOrEqual(s.plot.x + s.plot.width + 1);
      expect(b.y1).toBeGreaterThanOrEqual(s.plot.y - 1);
      expect(b.y2).toBeLessThanOrEqual(s.plot.y + s.plot.height + 1);
    }
  });

  it("a label the user dragged is left exactly where they put it — their placement outranks the rule", () => {
    const s = build({ labelPos: { s0: { x: 0.05, y: 0.05 } } }, carded);
    const l = s.annotations.find((a) => a.id === "pca-vlabel-s0")!;
    expect(l.labelX).toBeCloseTo(s.plot.x + 0.05 * s.plot.width, 6);
    expect(l.labelY).toBeCloseTo(s.plot.y + 0.05 * s.plot.height, 6);
  });
});

/**
 * Leader lines — drawn only where the placement rule had to move a label far enough that the
 * pairing would be a guess, and never where the label is already beside what it names.
 */
describe("leader lines on the triplot", () => {
  const leaders = (s: ReturnType<typeof build>) => s.annotations.filter((a) => a.id.startsWith("pca-leader-"));

  it("a leader is not a label — nothing reading the label family by id can pick one up", () => {
    const s = build({}, { ...pca, groups: ["a", "a", "b", "b"] });
    for (const l of leaders(s)) expect(l.id.startsWith("pca-vlabel-")).toBe(false);
    expect(s.annotations.filter((a) => a.id.startsWith("pca-vlabel-")).every((a) => (a.label ?? "") !== "")).toBe(true);
  });

  it("an uncrowded triplot draws NO leaders — a line to a name already beside its point is clutter", () => {
    const roomy: PcaGraphData = {
      ...pca,
      scores: [[-2, 1.5], [2, -1.5]],
      lcScores: [[-2, 1.5], [2, -1.5]],
      waScores: [[-2, 1.5], [2, -1.5]],
      speciesScores: [[-1.8, -1.6]],
      speciesLabels: ["Alone"],
      envScores: [[1.7, 1.4]],
      envLabels: ["Solo"],
      envIsFactor: [false],
    };
    expect(leaders(build({}, roomy))).toEqual([]);
  });

  it("a crowded one does, and each leader is locked, undeletable, and joins its own label", () => {
    const crowded: PcaGraphData = {
      ...pca,
      speciesScores: [[0.62, 0.27], [0.66, 0.28], [0.64, 0.3]],
      speciesLabels: ["Aaa", "Bbb", "Ccc"],
    };
    const s = build({}, crowded);
    const ls = leaders(s);
    expect(ls.length, "no leaders on a knot of three coincident species").toBeGreaterThan(0);
    for (const l of ls) {
      expect(l.locked, "a leader is geometry, not an annotation the user made").toBe(true);
      expect(l.deletable).toBe(false);
      // it ends where its own label is, not somewhere else
      const own = s.annotations.find((a) => a.id === l.id.replace("pca-leader-", "pca-vlabel-"))!;
      expect(own, "a leader with no label").toBeTruthy();
      const d = Math.hypot((l.x2 ?? 0) - (own.labelX ?? 0), (l.y2 ?? 0) - (own.labelY ?? 0));
      expect(d, `${l.id} does not reach its label`).toBeLessThan(40);
    }
  });
});
