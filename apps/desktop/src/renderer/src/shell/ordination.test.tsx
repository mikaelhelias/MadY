// @vitest-environment jsdom
/**
 * Ordination (PCoA / NMDS) — the app half.
 *
 * The engine is checked by `engine.test.ts` (real Python) and `crosscheck.py` (independent
 * oracles). This is everything between the result and the user:
 *   • the payload the dialog sends — the distance and the transformation are what decide what
 *     the map means, so they must actually leave the app;
 *   • the door to the graphs, which is not the PCA suite: an ordination has no loadings, so
 *     offering a loadings plot or a biplot would draw arrows that do not exist;
 *   • the headline numbers, where an NMDS's stress is the whole verdict on the map.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { AnalysisResult, DataTable, Project } from "@mady/core";
import { buildAnalysisData, ordinationGraphPlan } from "@mady/core";
import { buildPlotScene } from "@mady/graphics";
import type { Plot } from "@mady/core";
import { PlotFigure } from "./PlotFigure";
import { AnalysisPane } from "./panes";
import { AnalyzeDialog } from "./AnalyzeDialog";
import { buildCandidateSpecs, profileTable, validateSuggestionSpec } from "./assistant";
import { keyResultCards } from "./keyResults";

afterEach(cleanup);

const table: DataTable = {
  id: "t1", kind: "pca", name: "Sites",
  columns: [
    { id: "site", name: "Site" }, { id: "arm", name: "Habitat" },
    { id: "s1", name: "Sp1" }, { id: "s2", name: "Sp2" }, { id: "s3", name: "Sp3" },
  ],
  rows: [0, 1, 2, 3].map((i) => ({
    id: `r${i}`,
    cells: { site: `Site ${i + 1}`, arm: i < 2 ? "Wet" : "Dry", s1: i + 1, s2: 5 - i, s3: 2 },
  })),
};

describe("the payload carries the two choices that decide what the map means", () => {
  it("PCoA sends the distance, the transformation and the correction", () => {
    const d = buildAnalysisData("pcoa", { columns: ["s1", "s2", "s3"], metric: "braycurtis", transform: "hellinger", correction: "lingoes" }, table) as Record<string, unknown>;
    expect(d["metric"]).toBe("braycurtis");
    expect(d["transform"]).toBe("hellinger");
    expect(d["correction"]).toBe("lingoes");
    expect(d["labels"]).toEqual(["Sp1", "Sp2", "Sp3"]);
    expect((d["columns"] as number[][])[0]).toEqual([1, 2, 3, 4]);
    // NMDS-only knobs must not travel on a PCoA — the engine would ignore them, and a spec
    // that carries settings the method cannot honour reads as if it did.
    expect("tries" in d).toBe(false);
    expect("dimensions" in d).toBe(false);
  });

  it("NMDS sends the dimensions, restarts and seed — a map has to be reproducible", () => {
    const d = buildAnalysisData("nmds", { columns: ["s1", "s2", "s3"], metric: "jaccard", transform: "wisconsin", dimensions: 3, tries: 50, seed: 99 }, table) as Record<string, unknown>;
    expect(d["metric"]).toBe("jaccard");
    expect(d["transform"]).toBe("wisconsin");
    expect(d["dimensions"]).toBe(3);
    expect(d["tries"]).toBe(50);
    expect(d["seed"]).toBe(99);
    expect("correction" in d).toBe(false);
  });

  it("defaults are the ecology ones (Bray-Curtis, untransformed) — not a silent Euclidean", () => {
    const d = buildAnalysisData("pcoa", { columns: ["s1", "s2"] }, table) as Record<string, unknown>;
    expect(d["metric"]).toBe("braycurtis");
    expect(d["transform"]).toBe("none");
  });

  it("the lead column names the sites, and a grouping column colours them without becoming a variable", () => {
    const d = buildAnalysisData("nmds", { columns: ["s1", "s2", "arm"], groupBy: "arm" }, table) as Record<string, unknown>;
    expect(d["caseLabels"]).toEqual(["Site 1", "Site 2", "Site 3", "Site 4"]);
    expect(d["groups"]).toEqual(["Wet", "Wet", "Dry", "Dry"]);
    expect(d["labels"], "the grouping column was left in as a species").toEqual(["Sp1", "Sp2"]);
  });
});

/** A result shaped like the engine's, with only the parts the app reads. */
const ordResult = (method: "pcoa" | "nmds", over: Record<string, unknown> = {}): AnalysisResult =>
  ({
    method, title: method.toUpperCase(), summary: "s", terms: [],
    glance: method === "nmds"
      ? { cases: 4, variables: 3, dimensions: 2, stress: 0.06, nonMetricR2: 0.9964 }
      : { cases: 4, variables: 3, axes: 3, axis1_pct: 61.2, axis2_pct: 24.8, negativeEigenvalues: 1 },
    extra: {
      ordination: {
        varLabels: ["Sp1", "Sp2", "Sp3"],
        pcLabels: method === "nmds" ? ["NMDS1", "NMDS2"] : ["PCoA1", "PCoA2", "PCoA3"],
        scores: [[1, 0.2], [0.4, -1], [-0.9, 0.3], [-0.5, 0.5]],
        caseLabels: ["Site 1", "Site 2", "Site 3", "Site 4"],
        ...(method === "pcoa" ? { eigenvalues: [2.1, 0.9, 0.3], explained: [0.612, 0.248, 0.14] } : {}),
        ...(method === "nmds"
          ? { stress: 0.06, shepard: { dissimilarity: [0.2, 0.5, 0.8], distance: [0.3, 0.6, 0.75], fitted: [0.3, 0.6, 0.7] } }
          : {}),
        ...over,
      },
    },
  }) as unknown as AnalysisResult;

const projectWith = (method: "pcoa" | "nmds", result: AnalysisResult): Project =>
  ({ tables: [table], plots: [], analyses: [{ id: "a1", name: `${method} run`, source: "t1", status: "ok", method, params: { columns: ["s1", "s2", "s3"] }, result }] }) as unknown as Project;

describe("the analysis pane offers the right door", () => {
  /** The graph actions live behind the "Add to graph" menu — open it, as a user must. */
  const openMenu = (): void => {
    const btn = screen.queryByText(/Add to graph/);
    if (btn) fireEvent.click(btn);
  };
  const paneFor = (method: "pcoa" | "nmds") => {
    const onPlotOrdination = vi.fn();
    const onPlotPca = vi.fn();
    render(
      <AnalysisPane project={projectWith(method, ordResult(method))} analysisId="a1" onRerun={vi.fn()}
        onPlotOrdination={onPlotOrdination} onPlotPca={onPlotPca} />,
    );
    openMenu();
    return { onPlotOrdination, onPlotPca };
  };

  it("a PCoA result offers PCoA graphs, and the door runs", () => {
    const f = paneFor("pcoa");
    const item = screen.getByText("PCoA graphs");
    expect(item, "no door to the PCoA graphs").toBeTruthy();
    fireEvent.click(item);
    expect(f.onPlotOrdination).toHaveBeenCalledWith("a1");
  });

  it("an NMDS result offers NMDS graphs, named for the method that produced them", () => {
    paneFor("nmds");
    expect(screen.getByText("NMDS graphs")).toBeTruthy();
    expect(screen.queryByText("PCoA graphs")).toBeNull();
  });

  it("neither offers the PCA suite — there are no loadings, so a biplot would draw arrows that do not exist", () => {
    const f = paneFor("pcoa");
    expect(screen.queryByText("PCA graph suite")).toBeNull();
    expect(f.onPlotPca).not.toHaveBeenCalled();
  });

  it("a result with no map offers nothing (an empty door is worse than none)", () => {
    const empty = ordResult("pcoa", { scores: [] });
    render(<AnalysisPane project={projectWith("pcoa", empty)} analysisId="a1" onRerun={vi.fn()} onPlotOrdination={vi.fn()} />);
    openMenu();
    expect(screen.queryByText("PCoA graphs")).toBeNull();
  });
});

describe("the headline says what the method decided", () => {
  it("PCoA leads with the variation its first two axes carry", () => {
    const { cards } = keyResultCards(ordResult("pcoa"), 0.95);
    expect(cards.map((c) => c.label)).toEqual(["PCoA1", "PCoA2", "Cases"]);
    expect(cards[0]!.value).toBe("61.2%");
  });

  it("NMDS leads with stress, and the verdict reads Clarke's bands in words", () => {
    // Stress is the whole verdict on an NMDS map: above 0.3 the layout means nothing, and a
    // reader who is not told that will interpret it anyway.
    expect(keyResultCards(ordResult("nmds"), 0.95).verdict).toBe("Stress < 0.1 — a good map");
    const poor = ordResult("nmds");
    (poor.glance as Record<string, number>)["stress"] = 0.35;
    const bad = keyResultCards(poor, 0.95);
    expect(bad.cards[0]!.label).toBe("Stress");
    expect(bad.verdict).toBe("Stress ≥ 0.3 — close to arbitrary, do not interpret the layout");
    const mid = ordResult("nmds");
    (mid.glance as Record<string, number>)["stress"] = 0.24;
    expect(keyResultCards(mid, 0.95).verdict).toBe("Stress < 0.3 — a poor map, read it with care");
  });
});

/**
 * The dialog. A control the user cannot reach is the same as a setting that does not exist —
 * and here the two settings are the method: a Bray-Curtis NMDS and a Euclidean one on
 * Hellinger-transformed data are different analyses of the same sheet.
 */
describe("the Analyze dialog exposes the choices, and sends them", () => {
  const sheet: DataTable = {
    id: "t2", kind: "pca", name: "Quadrats",
    columns: [
      { id: "q", name: "Quadrat" },
      { id: "a", name: "Sp A" }, { id: "b", name: "Sp B" }, { id: "c", name: "Sp C" },
    ],
    rows: [0, 1, 2, 3, 4].map((i) => ({
      id: `r${i}`, cells: { q: `Q${i + 1}`, a: i, b: 5 - i, c: (i % 2) + 1 },
    })),
  };
  const open = (method: "pcoa" | "nmds") => {
    const onRun = vi.fn();
    const u = render(<AnalyzeDialog table={sheet} onRun={onRun} onCancel={vi.fn()} initialMethod={method} />);
    const sel = (label: string) => u.container.querySelector(`select[aria-label="${label}"]`) as HTMLSelectElement | null;
    const num = (label: string) => u.container.querySelector(`input[aria-label="${label}"]`) as HTMLInputElement | null;
    const run = () => fireEvent.click(u.container.querySelector(".btn") as HTMLButtonElement);
    return { ...u, onRun, sel, num, run };
  };

  it("PCoA offers the distance, the transformation and the correction — and no NMDS-only knobs", () => {
    const u = open("pcoa");
    expect(u.sel("Ordination distance"), "no distance control — the map's meaning is unreachable").toBeTruthy();
    expect(u.sel("Ordination transformation")).toBeTruthy();
    expect(u.sel("Negative eigenvalue correction")).toBeTruthy();
    expect(u.num("Random starts"), "a PCoA is not restarted — it is an eigendecomposition").toBeNull();
  });

  it("NMDS offers the dimensions, restarts and seed — and no correction (it has no eigenvalues)", () => {
    const u = open("nmds");
    expect(u.num("Dimensions")).toBeTruthy();
    expect(u.num("Random starts")).toBeTruthy();
    expect(u.num("Ordination seed")).toBeTruthy();
    expect(u.sel("Negative eigenvalue correction")).toBeNull();
  });

  it("what is picked reaches the run — a control that is drawn and dropped is worse than none", () => {
    const u = open("nmds");
    fireEvent.change(u.sel("Ordination distance")!, { target: { value: "euclidean" } });
    fireEvent.change(u.sel("Ordination transformation")!, { target: { value: "hellinger" } });
    fireEvent.change(u.num("Random starts")!, { target: { value: "35" } });
    u.run();
    expect(u.onRun).toHaveBeenCalled();
    const spec = u.onRun.mock.calls[0]![0] as Record<string, unknown>;
    expect(spec["method"]).toBe("nmds");
    expect(spec["metric"]).toBe("euclidean");
    expect(spec["transform"]).toBe("hellinger");
    expect(spec["tries"]).toBe(35);
  });
});

/**
 * Correspondence analysis — the ordination whose species are first-class: sites and species
 * come out of the same decomposition, so the joint plot is the method.
 */
describe("correspondence analysis, end to end in the app", () => {
  it("sends the scaling — and no distance or transformation, because the chi-square metric is the method", () => {
    const d = buildAnalysisData("ca", { columns: ["s1", "s2", "s3"], scaling: "sites" }, table) as Record<string, unknown>;
    expect(d["scaling"]).toBe("sites");
    expect("metric" in d, "a distance control on a CA would be a choice that changes nothing").toBe(false);
    expect("transform" in d).toBe(false);
    expect(d["caseLabels"]).toEqual(["Site 1", "Site 2", "Site 3", "Site 4"]);
  });

  it("defaults to the symmetric scaling — the one that lets both families be read together", () => {
    const d = buildAnalysisData("ca", { columns: ["s1", "s2"] }, table) as Record<string, unknown>;
    expect(d["scaling"]).toBe("symmetric");
  });

  it("the dialog offers the scaling and nothing that does not apply", () => {
    const sheet: DataTable = {
      id: "t3", kind: "pca", name: "Counts",
      columns: [{ id: "q", name: "Quadrat" }, { id: "a", name: "Sp A" }, { id: "b", name: "Sp B" }],
      rows: [0, 1, 2, 3].map((i) => ({ id: `r${i}`, cells: { q: `Q${i}`, a: i + 1, b: 4 - i } })),
    };
    const onRun = vi.fn();
    const u = render(<AnalyzeDialog table={sheet} onRun={onRun} onCancel={vi.fn()} initialMethod="ca" />);
    const scaling = u.container.querySelector('select[aria-label="CA scaling"]') as HTMLSelectElement | null;
    expect(scaling).toBeTruthy();
    expect(u.container.querySelector('select[aria-label="Ordination distance"]'), "a CA has no distance to choose").toBeNull();
    expect(u.container.querySelector('input[aria-label="Random starts"]')).toBeNull();
    // …and the pick reaches the run: the scaling decides whose distances the drawn
    // picture preserves, so a control that is drawn and dropped changes the figure's meaning
    // without telling anyone.
    fireEvent.change(scaling!, { target: { value: "species" } });
    fireEvent.click(u.container.querySelector(".btn") as HTMLButtonElement);
    expect((onRun.mock.calls[0]![0] as Record<string, unknown>)["scaling"]).toBe("species");
  });

  it("its headline is the inertia the first axes carry", () => {
    const res = {
      method: "ca", title: "CA", summary: "s", terms: [],
      glance: { cases: 4, variables: 3, axes: 2, axis1_pct: 67.5, axis2_pct: 25, inertia: 1.0276 },
      extra: { ordination: { varLabels: [], pcLabels: ["CA1", "CA2"], scores: [[1, 0]], speciesScores: [[0.5, 0.2]] } },
    } as unknown as AnalysisResult;
    const { cards } = keyResultCards(res, 0.95);
    expect(cards.map((c) => c.label)).toEqual(["CA1", "CA2", "Inertia"]);
    expect(cards[0]!.value).toBe("67.5%");
  });
});

/**
 * The nudge. A PCA is offered on any three numeric columns — including a species matrix, where
 * it is the classic misuse. Nothing in the dialog tells the user that, so the analysis suggestions do.
 */
describe("counts with many zeros are nudged toward correspondence analysis", () => {
  /** A species matrix: non-negative whole numbers, most cells empty. */
  const speciesSheet = (): DataTable => ({
    id: "tz", kind: "multivariable", name: "Quadrats",
    columns: [{ id: "q", name: "Quadrat" }, { id: "a", name: "Sp A" }, { id: "b", name: "Sp B" }, { id: "c", name: "Sp C" }],
    rows: [0, 1, 2, 3, 4, 5].map((i) => ({
      id: `r${i}`,
      cells: { q: `Q${i}`, a: i < 2 ? 4 : 0, b: i >= 2 && i < 4 ? 7 : 0, c: i >= 4 ? 3 : 0 },
    })),
  });
  /** The same shape, but measurements: no zeros, not whole numbers. */
  const measureSheet = (): DataTable => ({
    ...speciesSheet(),
    rows: [0, 1, 2, 3, 4, 5].map((i) => ({
      id: `r${i}`, cells: { q: `Q${i}`, a: 1.5 + i, b: 20.25 - i, c: 3.75 + i * 0.5 },
    })),
  });
  const suggestions = (t: DataTable) => {
    const profile = profileTable(t);
    return buildCandidateSpecs({ tables: [t], plots: [], analyses: [] } as unknown as Project, t, undefined, profile, undefined);
  };

  it("a species matrix is offered correspondence analysis, above the PCA", () => {
    const out = suggestions(speciesSheet());
    const ca = out.find((s) => s.method === "ca");
    expect(ca, "no nudge — a PCA on a species matrix is offered with nothing said").toBeTruthy();
    expect(ca!.text).toMatch(/looks like counts/);
    expect(ca!.text).toMatch(/\d+% of the values are zero/);
    const pca = out.find((s) => s.method === "pca");
    if (pca) expect(ca!.score).toBeGreaterThan(pca.score);
    // …and it names the other valid answer rather than presenting CA as the only one
    expect(ca!.caveats?.join(" ")).toMatch(/NMDS/);
  });

  it("measurements are not nudged — the rule must not fire on ordinary data", () => {
    expect(suggestions(measureSheet()).find((s) => s.method === "ca")).toBeUndefined();
  });

  it("zeros are not enough — fractional values are not counts, and the rule says counts", () => {
    // The measurement fixture above has no zeros at all, so the zero rule alone rejects it and
    // the whole-number rule is never exercised. This one has plenty of zeros and fractional
    // values, so it can only be turned away by the rule the nudge actually claims to apply.
    const fractional: DataTable = {
      ...speciesSheet(),
      rows: [0, 1, 2, 3, 4, 5].map((i) => ({
        id: `r${i}`,
        cells: { q: `Q${i}`, a: i < 2 ? 4.25 : 0, b: i >= 2 && i < 4 ? 7.5 : 0, c: i >= 4 ? 3.75 : 0 },
      })),
    };
    expect(suggestions(fractional).find((s) => s.method === "ca")).toBeUndefined();
  });

  it("a matrix with few zeros is not nudged either", () => {
    const dense: DataTable = {
      ...speciesSheet(),
      rows: [0, 1, 2, 3, 4, 5].map((i) => ({ id: `r${i}`, cells: { q: `Q${i}`, a: i + 1, b: 6 - i, c: i === 0 ? 0 : 2 } })),
    };
    expect(suggestions(dense).find((s) => s.method === "ca")).toBeUndefined();
  });

  it("the suggestion survives validation — an unsupported method would be filtered out silently", () => {
    const t = speciesSheet();
    const ca = suggestions(t).find((s) => s.method === "ca")!;
    expect(validateSuggestionSpec(t, ca)).toEqual({ ok: true });
  });
});

/**
 * Redundancy analysis — a constrained ordination, which reads two blocks
 * of columns from one sheet (an analysis has one source
 * table, so both blocks come from it).
 */
describe("redundancy analysis, end to end in the app", () => {
  const sheet: DataTable = {
    id: "tr", kind: "pca", name: "Field",
    columns: [
      { id: "site", name: "Site" },
      { id: "s1", name: "Sp1" }, { id: "s2", name: "Sp2" }, { id: "s3", name: "Sp3" },
      { id: "temp", name: "Temp" }, { id: "hab", name: "Habitat" },
    ],
    rows: [0, 1, 2, 3, 4, 5].map((i) => ({
      id: `r${i}`,
      cells: { site: `S${i + 1}`, s1: i + 1, s2: 6 - i, s3: (i % 2) + 1, temp: 10 + i * 2, hab: i < 3 ? "wet" : "dry" },
    })),
  };

  it("splits the one sheet into a response block and an explanatory block", () => {
    const d = buildAnalysisData("rda", { columns: ["s1", "s2", "s3", "temp"], explanatory: ["temp"] }, sheet) as Record<string, unknown>;
    expect(d["labels"], "the explanatory column must not also be a response").toEqual(["Sp1", "Sp2", "Sp3"]);
    expect(d["explanatoryLabels"]).toEqual(["Temp"]);
    expect((d["explanatory"] as unknown[][])[0]).toEqual([10, 12, 14, 16, 18, 20]);
    expect(d["permutations"]).toBe(999);
    expect(d["scaling"]).toBe("symmetric");
  });

  it("a categorical explanatory column travels as its raw labels — coercing it would blank every level", () => {
    const d = buildAnalysisData("rda", { columns: ["s1", "s2", "hab"], explanatory: ["hab"] }, sheet) as Record<string, unknown>;
    expect((d["explanatory"] as unknown[][])[0]).toEqual(["wet", "wet", "wet", "dry", "dry", "dry"]);
  });

  it("the dialog offers both blocks, and will not run with only one", () => {
    const onRun = vi.fn();
    const u = render(<AnalyzeDialog table={sheet} onRun={onRun} onCancel={vi.fn()} initialMethod="rda" />);
    const box = (name: string) => u.container.querySelector(`input[aria-label="Explanatory ${name}"]`) as HTMLInputElement;
    expect(box("Temp"), "no explanatory picker — a constrained ordination cannot be specified").toBeTruthy();
    const runBtn = u.container.querySelector(".btn") as HTMLButtonElement;
    expect(runBtn.disabled, "runnable with no explanatory variable — that is not a constrained ordination").toBe(true);
    fireEvent.click(box("Temp"));
    expect((u.container.querySelector(".btn") as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(u.container.querySelector(".btn") as HTMLButtonElement);
    const spec = onRun.mock.calls[0]![0] as Record<string, unknown>;
    expect(spec["method"]).toBe("rda");
    expect(spec["explanatory"]).toEqual(["temp"]);
    expect(spec["permutations"]).toBe(999);
  });

  it("its headline is the p, the adjusted R² and the pseudo-F — the one ordination that tests something", () => {
    const res = {
      method: "rda", title: "RDA", summary: "s", terms: [],
      glance: { cases: 24, variables: 5, explanatory: 2, axes: 2, r2: 0.921, adjR2: 0.913, pseudoF: 122.35, p: 0.005 },
      extra: { ordination: { varLabels: [], pcLabels: ["RDA1", "RDA2"], scores: [[1, 0]] } },
    } as unknown as AnalysisResult;
    const { cards } = keyResultCards(res, 0.95);
    expect(cards.map((c) => c.label)).toEqual(["p", "Adjusted R²", "Pseudo-F"]);
    expect(cards[0]!.isP).toBe(true);
  });

  it("earns the map and a scree — the environment arrows are the triplot's job, not this graph's", () => {
    const ord = {
      varLabels: ["a"], pcLabels: ["RDA1", "RDA2"], scores: [[1, 0], [0, 1]],
      eigenvalues: [2, 1], explained: [0.66, 0.34],
      envScores: [[0.9, 0.1]], envLabels: ["Temp"],
    };
    expect(ordinationGraphPlan("rda", ord).map((g) => g.role)).toEqual(["map", "scree"]);
  });
});

/**
 * CCA and db-RDA reach the user through the same door RDA does — one explanatory picker, one
 * payload builder, one graph plan. What differs is small and each difference is load-bearing,
 * so each is held here:
 *   • db-RDA is the constrained method whose answer depends on a distance, so it gets the
 *     distance picker (RDA and CCA carry their geometry in the method itself);
 *   • CCA takes no transformation — the chi-square geometry is the standardisation, applied
 *     inside the method — so offering the control would be a knob the engine ignores.
 */
describe("the other two constrained ordinations", () => {
  const sheet: DataTable = {
    id: "t-cca", kind: "pca", name: "Sites",
    columns: [
      { id: "site", name: "Site" },
      { id: "s1", name: "Sp1" }, { id: "s2", name: "Sp2" }, { id: "s3", name: "Sp3" },
      { id: "temp", name: "Temp" },
    ],
    rows: [0, 1, 2, 3, 4, 5].map((i) => ({
      id: `r${i}`,
      cells: { site: `S${i + 1}`, s1: i + 1, s2: 6 - i, s3: (i % 2) + 1, temp: 10 + i * 2 },
    })),
  };

  it.each(["cca", "dbrda"])("%s splits the one sheet the same way RDA does", (method) => {
    const d = buildAnalysisData(method, { columns: ["s1", "s2", "s3", "temp"], explanatory: ["temp"] }, sheet) as Record<string, unknown>;
    expect(d["labels"]).toEqual(["Sp1", "Sp2", "Sp3"]);
    expect(d["explanatoryLabels"]).toEqual(["Temp"]);
    expect((d["explanatory"] as unknown[][])[0]).toEqual([10, 12, 14, 16, 18, 20]);
    expect(d["permutations"]).toBe(999);
  });

  it("only db-RDA carries a distance — the other two have no use for one", () => {
    const db = buildAnalysisData("dbrda", { columns: ["s1", "s2", "temp"], explanatory: ["temp"], metric: "jaccard" }, sheet) as Record<string, unknown>;
    expect(db["metric"]).toBe("jaccard");
    const dflt = buildAnalysisData("dbrda", { columns: ["s1", "s2", "temp"], explanatory: ["temp"] }, sheet) as Record<string, unknown>;
    expect(dflt["metric"], "a distance-based method must not silently default to nothing").toBe("braycurtis");
    for (const m of ["rda", "cca"]) {
      const other = buildAnalysisData(m, { columns: ["s1", "s2", "temp"], explanatory: ["temp"], metric: "jaccard" }, sheet) as Record<string, unknown>;
      expect(other["metric"], `${m} must not send a distance it does not use`).toBeUndefined();
    }
  });

  it("db-RDA's dialog offers the distance picker; RDA's does not", () => {
    const u = render(<AnalyzeDialog table={sheet} onRun={vi.fn()} onCancel={vi.fn()} initialMethod="dbrda" />);
    expect(u.container.querySelector('select[aria-label="Ordination distance"]'), "no distance picker on a distance-based method").toBeTruthy();
    cleanup();
    const v = render(<AnalyzeDialog table={sheet} onRun={vi.fn()} onCancel={vi.fn()} initialMethod="rda" />);
    expect(v.container.querySelector('select[aria-label="Ordination distance"]'), "RDA has no distance to pick").toBeNull();
  });

  it("CCA offers no transformation, and says why instead of showing a control that does nothing", () => {
    const u = render(<AnalyzeDialog table={sheet} onRun={vi.fn()} onCancel={vi.fn()} initialMethod="cca" />);
    expect(u.container.querySelector('select[aria-label="Ordination transformation"]'), "a control the engine ignores").toBeNull();
    expect(u.container.textContent).toMatch(/chi-square geometry/i);
    cleanup();
    const v = render(<AnalyzeDialog table={sheet} onRun={vi.fn()} onCancel={vi.fn()} initialMethod="rda" />);
    expect(v.container.querySelector('select[aria-label="Ordination transformation"]'), "RDA does need one").toBeTruthy();
  });

  it("the run spec carries what each method uses and nothing it does not", () => {
    const onRun = vi.fn();
    const u = render(<AnalyzeDialog table={sheet} onRun={onRun} onCancel={vi.fn()} initialMethod="cca" />);
    fireEvent.click(u.container.querySelector('input[aria-label="Explanatory Temp"]') as HTMLInputElement);
    fireEvent.click(u.container.querySelector(".btn") as HTMLButtonElement);
    const spec = onRun.mock.calls[0]![0] as Record<string, unknown>;
    expect(spec["method"]).toBe("cca");
    expect(spec["explanatory"]).toEqual(["temp"]);
    expect(spec["transform"], "CCA must not be sent a transformation").toBeUndefined();
    expect(spec["metric"], "CCA takes no distance").toBeUndefined();
    expect(spec["permutations"]).toBe(999);
  });

  it("their headline is the same three numbers RDA's is — they answer the same question", () => {
    for (const method of ["cca", "dbrda"]) {
      const res = {
        method, title: method, summary: "s", terms: [],
        glance: { cases: 20, variables: 6, explanatory: 2, axes: 2, r2: 0.64, adjR2: 0.59, pseudoF: 14.8, p: 0.005 },
        extra: { ordination: { varLabels: [], pcLabels: ["A1", "A2"], scores: [[1, 0]] } },
      } as unknown as AnalysisResult;
      const { cards } = keyResultCards(res, 0.95);
      expect(cards.map((c) => c.label), `${method} has no headline`).toEqual(["p", "Adjusted R²", "Pseudo-F"]);
      expect(cards[0]!.isP).toBe(true);
    }
  });
});

/**
 * Variance partitioning reaches the user through the constrained-ordination door with one
 * difference that is the whole method: the explanatory side arrives in two or three blocks,
 * and a column may sit in only one of them. Each of those is held here.
 */
describe("variance partitioning", () => {
  const sheet: DataTable = {
    id: "t-vp", kind: "pca", name: "Sites",
    columns: [
      { id: "site", name: "Site" },
      { id: "s1", name: "Sp1" }, { id: "s2", name: "Sp2" },
      { id: "t", name: "Temp" }, { id: "ph", name: "pH" }, { id: "x", name: "Lat" },
    ],
    rows: [0, 1, 2, 3, 4, 5].map((i) => ({
      id: `r${i}`,
      cells: { site: `S${i + 1}`, s1: i + 1, s2: 6 - i, t: 10 + i * 2, ph: 5 + i, x: i * 3 },
    })),
  };

  it("splits the sheet into a response block and two explanatory blocks", () => {
    const d = buildAnalysisData("varpart", {
      columns: ["s1", "s2", "t", "ph"], explanatory: ["t"], explanatory2: ["ph"],
      blockLabels: ["Climate", "Soil"],
    }, sheet) as Record<string, unknown>;
    expect(d["labels"], "a column in a block must not also be a response").toEqual(["Sp1", "Sp2"]);
    expect(d["explanatoryLabels"]).toEqual(["Temp"]);
    expect(d["explanatoryLabels2"]).toEqual(["pH"]);
    expect((d["explanatory"] as unknown[][])[0]).toEqual([10, 12, 14, 16, 18, 20]);
    expect((d["explanatory2"] as unknown[][])[0]).toEqual([5, 6, 7, 8, 9, 10]);
    expect(d["blockLabels"]).toEqual(["Climate", "Soil"]);
    expect(d["explanatory3"], "an unused third block must not be sent as empty").toBeUndefined();
  });

  it("carries a third block when there is one", () => {
    const d = buildAnalysisData("varpart", {
      columns: ["s1", "s2", "t", "ph", "x"], explanatory: ["t"], explanatory2: ["ph"], explanatory3: ["x"],
    }, sheet) as Record<string, unknown>;
    expect(d["labels"]).toEqual(["Sp1", "Sp2"]);
    expect(d["explanatoryLabels3"]).toEqual(["Lat"]);
  });

  it("will not run with only one block — with one block there is nothing to partition", () => {
    const onRun = vi.fn();
    const u = render(<AnalyzeDialog table={sheet} onRun={onRun} onCancel={vi.fn()} initialMethod="varpart" />);
    const box = (block: string, name: string) => u.container.querySelector(`input[aria-label="Block ${block} ${name}"]`) as HTMLInputElement;
    expect(box("A", "Temp"), "no block picker — a partition cannot be specified").toBeTruthy();
    expect(box("C", "Temp"), "the optional third block must be offered too").toBeTruthy();
    const runBtn = () => u.container.querySelector(".btn") as HTMLButtonElement;
    fireEvent.click(box("A", "Temp"));
    expect(runBtn().disabled, "one block is not a partition").toBe(true);
    fireEvent.click(box("B", "pH"));
    expect(runBtn().disabled).toBe(false);
  });

  it("a column can be in only one block — a column shared with itself is not a partition", () => {
    const u = render(<AnalyzeDialog table={sheet} onRun={vi.fn()} onCancel={vi.fn()} initialMethod="varpart" />);
    const box = (block: string, name: string) => u.container.querySelector(`input[aria-label="Block ${block} ${name}"]`) as HTMLInputElement;
    fireEvent.click(box("A", "Temp"));
    expect(box("B", "Temp").disabled, "Temp is in block A and must be unavailable in B").toBe(true);
    expect(box("C", "Temp").disabled).toBe(true);
    expect(box("B", "pH").disabled, "an unused column stays available").toBe(false);
  });

  it("the run spec carries the blocks and their names", () => {
    const onRun = vi.fn();
    const u = render(<AnalyzeDialog table={sheet} onRun={onRun} onCancel={vi.fn()} initialMethod="varpart" />);
    const box = (block: string, name: string) => u.container.querySelector(`input[aria-label="Block ${block} ${name}"]`) as HTMLInputElement;
    fireEvent.click(box("A", "Temp"));
    fireEvent.click(box("B", "pH"));
    fireEvent.change(u.container.querySelector('input[aria-label="Block A name"]') as HTMLInputElement, { target: { value: "Climate" } });
    fireEvent.click(u.container.querySelector(".btn") as HTMLButtonElement);
    const spec = onRun.mock.calls[0]![0] as Record<string, unknown>;
    expect(spec["method"]).toBe("varpart");
    expect(spec["explanatory"]).toEqual(["t"]);
    expect(spec["explanatory2"]).toEqual(["ph"]);
    expect(spec["explanatory3"], "an empty third block must not travel").toBeUndefined();
    // A typed name travels; an untyped one falls back rather than reaching the engine blank.
    expect(spec["blockLabels"]).toEqual(["Climate", "Block B"]);
  });

  it("its headline is the split itself — there is no single p to lead with", () => {
    const res = {
      method: "varpart", title: "Variance partitioning", summary: "s", terms: [],
      glance: { cases: 40, variables: 4, blocks: 3, explained: 0.9475, residual: 0.0525, largest: "[d] Climate ∩ Soil", largest_pct: 58.8, negativeFractions: 4 },
      extra: { varpart: { fractions: [{ label: "[a]", adjR2: 0.26, testable: true, p: 0.005 }], residual: 0.0525, explained: 0.9475, blocks: [], blockLabels: [] } },
    } as unknown as AnalysisResult;
    const { cards, verdict } = keyResultCards(res, 0.95);
    expect(cards.map((c) => c.label)).toEqual(["Explained", "Unexplained", "Blocks"]);
    expect(cards.some((c) => c.isP), "a partition has no single p-value to lead with").toBe(false);
    expect(verdict).toMatch(/Largest fraction/);
  });

  it("offers the fractions as a bar — a shared fraction can be negative, and no area draws negative", () => {
    const onPlotPartition = vi.fn();
    const project = {
      tables: [{ id: "t1", name: "Sites" }],
      plots: [],
      analyses: [{
        id: "a1", name: "Partition", method: "varpart", source: "t1", status: "ok",
        params: { columns: ["s1"] },
        result: {
          method: "varpart", title: "Variance partitioning", summary: "s", terms: [], glance: {},
          extra: { varpart: { fractions: [{ label: "[a]", adjR2: 0.26, testable: true }], residual: 0.05, explained: 0.95, blocks: [], blockLabels: [] } },
        },
      }],
    } as unknown as Project;
    render(<AnalysisPane project={project} analysisId="a1" onRerun={vi.fn()} onPlotPartition={onPlotPartition} />);
    // The graph doors live behind one "Add to graph" menu — as a flat row they would be up to
    // seven buttons wide, and their number would change per method.
    const opener = screen.queryByText(/Add to graph/);
    if (opener) fireEvent.click(opener);
    const btn = screen.getByText("Plot the fractions");
    expect(btn, "no readout offered for a partition").toBeTruthy();
    fireEvent.click(btn);
    expect(onPlotPartition).toHaveBeenCalledWith("a1");
  });
});

/**
 * Every text on the triplot is editable and draggable.
 * The species names, the explanatory names and the factor-level names are all
 * builder-made annotations, so they ride the generic annotation layer: cursor:move, bound to
 * `onMoveAnnotation`, and double-click renamed through `onEditText`.
 *
 * Note: jsdom cannot prove the drop (no `getScreenCTM`, so the pixel→fraction step never runs) —
 * that is `e2e/dead-affordance.spec.ts`'s job, and the triplot's row there passes. This proves
 * the element is emitted as draggable and renameable rather than as inert text.
 */
describe("the triplot's texts are editable and draggable", () => {
  const dummy: DataTable = { id: "td", kind: "pca", name: "T", columns: [{ id: "x", name: "X" }], rows: [] };
  const triplotPca = {
    varLabels: ["Sph", "Car"], pcLabels: ["RDA1", "RDA2"], loadings: [],
    scores: [[-1.2, 0.4], [1.1, -0.5]], lcScores: [[-1.2, 0.4], [1.1, -0.5]], waScores: [[-1.4, 0.6], [1.3, -0.7]],
    eigenvalues: [1.8, 0.6], explained: [0.5, 0.17],
    speciesScores: [[-1.5, 0.2], [1.4, -0.3]], speciesLabels: ["Sph", "Car"],
    envScores: [[-0.9, 0.1], [0.7, 0.4]], envLabels: ["Water table", "pH"], envIsFactor: [false, false],
  };
  const scene = () => buildPlotScene(dummy, { id: "p", name: "P", source: "td", status: "ok", styleOverrides: {}, kind: "triplot", pca: triplotPca } as Plot, { width: 520, height: 380 });

  it("every label is drawn as a draggable annotation", () => {
    const { container } = render(<PlotFigure scene={scene()} selected={null} onMoveAnnotation={vi.fn()} onEditText={vi.fn()} />);
    const labels = [...container.querySelectorAll('[data-ann-text^="pca-vlabel-"]')];
    expect(labels.length, "no triplot labels rendered").toBe(4); // 2 species + 2 explanatory
    for (const l of labels) {
      expect((l.closest("g") as unknown as HTMLElement).style.cursor, `${l.textContent} is not draggable`).toBe("move");
    }
  });

  it("double-clicking a label opens the inline editor and the rename routes to that label", () => {
    const onEditText = vi.fn();
    const { container } = render(<PlotFigure scene={scene()} selected={null} onMoveAnnotation={vi.fn()} onEditText={onEditText} />);
    const label = [...container.querySelectorAll('[data-ann-text^="pca-vlabel-"]')].find((l) => l.textContent?.includes("Water table"))!;
    fireEvent.doubleClick(label);
    const box = (container.querySelector("textarea, input[type=text]") ?? document.querySelector("textarea")) as HTMLElement | null;
    expect(box, "no inline editor opened on an explanatory label").toBeTruthy();
    fireEvent.change(box!, { target: { value: "Water depth" } });
    fireEvent.blur(box!);
    expect(onEditText).toHaveBeenCalled();
    const [target, text] = onEditText.mock.calls[0]!;
    expect(text).toBe("Water depth");
    expect((target as { id?: string }).id, "the rename did not name the label it was typed on").toBe("pca-vlabel-e0");
  });

  it("the arrows are locked — their geometry is the data, so they offer no drag", () => {
    const s = scene();
    for (const a of s.annotations.filter((x) => x.kind === "arrow")) expect(a.locked).toBe(true);
  });
});
