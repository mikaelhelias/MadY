/**
 * Planning significance markers: which comparison goes between which two positions on a
 * graph, at what height, on which axis.
 *
 * DOM-free and in core on purpose — the headless agent/MCP surface can place markers too,
 * and the geometry table below is the kind of thing that must have exactly one home.
 */
import type { Plot, PlotKind, SignificanceThreshold } from "./model";
import { resolveThresholds } from "./model";

/** Where a bracket's endpoints live, and which way values run, for one chart kind. */
export interface BracketGeometry {
  /** The visual axis carrying values (the other one bands the categories). */
  valueAxis: "x" | "y";
  /**
   * What `from`/`to` mean on this kind:
   *  - `category-dataset` — 1-based position among the table's datasets (box, violin…)
   *  - `category-row`     — 1-based position among the table's rows (bar, lollipop…)
   *  - `data-x`           — a continuous X value (xy, survival, ROC…)
   *  - `none`             — this kind cannot carry a bracket at all
   */
  endpoints: "category-dataset" | "category-row" | "data-x" | "none";
}

/** Kinds whose categories come from the table's rows rather than its datasets. */
const ROW_CATEGORY: ReadonlySet<PlotKind> = new Set<PlotKind>(["bar", "histogram", "lollipop", "paireddot", "forest", "pyramid"]);
/** Kinds whose categories are the datasets themselves. */
const DATASET_CATEGORY: ReadonlySet<PlotKind> = new Set<PlotKind>(["box", "violin", "scatter", "raincloud", "floatingbar", "beforeafter", "estimation"]);
/** Kinds with a continuous X a bracket can span. */
const CONTINUOUS_X: ReadonlySet<PlotKind> = new Set<PlotKind>(["xy", "area", "bubble", "volcano", "survival", "roc", "blandaltman", "pcascore", "pcaload", "pcabiplot", "triplot", "scree", "funnel"]);
/** Kinds that always draw transposed, whatever `barOrientation` says. */
const ALWAYS_TRANSPOSED: ReadonlySet<PlotKind> = new Set<PlotKind>(["paireddot", "forest", "pyramid",
  // a swimmer is horizontal by definition (timeline bars); brackets stay refused (endpoints
  // "none" — subject rows are individuals, not group comparisons)
  "swimmer"]);

/**
 * The geometry of one chart kind.
 *
 * Note: deliberately not built on `isTransposedPlot`: that helper reports `false` for
 * lollipop, while the lollipop builder defaults `barOrientation` to "horizontal" and draws
 * transposed. Anything derived from it stacks lollipop brackets on the wrong axis. This
 * mirrors what the builders do, and `value-axis.test.ts` checks it against built pixels.
 */
export function bracketGeometry(plot: Pick<Plot, "kind" | "barOrientation">): BracketGeometry {
  const kind = (plot.kind ?? "xy") as PlotKind;
  // Lollipop's default is horizontal; every other orientable kind defaults to vertical.
  const horizontal =
    ALWAYS_TRANSPOSED.has(kind) ||
    (kind === "lollipop"
      ? (plot.barOrientation ?? "horizontal") === "horizontal"
      : (plot.barOrientation ?? "vertical") === "horizontal");
  const valueAxis: "x" | "y" = horizontal ? "x" : "y";
  // UpSet: from/to are 1-based drawn intersection columns (left→right), not table rows.
  // Manual brackets span them like any category axis; the planner can never target an
  // upset because a "sets" table unlocks no analyses (analyzeGoals), so the category-row
  // name resolution above it is unreachable here. Vertical only.
  if (kind === "upset") return { valueAxis: "y", endpoints: "category-row" };
  if (ROW_CATEGORY.has(kind)) return { valueAxis, endpoints: "category-row" };
  if (DATASET_CATEGORY.has(kind)) return { valueAxis, endpoints: "category-dataset" };
  if (CONTINUOUS_X.has(kind)) return { valueAxis: "y", endpoints: "data-x" };
  return { valueAxis, endpoints: "none" };
}

/**
 * Split a tidy comparison term into its two group names.
 *
 * Three things make the naive `split(" vs ")` wrong on real engine output:
 *  - survival appends a qualifier — `"A vs B (log-rank)"` — which would otherwise ride
 *    along on the second name and never match a group;
 *  - two-way cell means join with `·` (`"Ctrl · Day 1 vs Drug · Day 7"`), which must
 *    survive intact;
 *  - a term containing more than one `" vs "` is ambiguous, and guessing which split is
 *    meant is how a marker ends up drawn between the wrong pair.
 */
export function parseComparisonTerm(term: string): { a: string; b: string } | null {
  const stripped = term.replace(/\s*\([^()]*\)\s*$/, "");
  const parts = stripped.split(" vs ");
  if (parts.length !== 2) return null;
  const a = parts[0]!.trim();
  const b = parts[1]!.trim();
  return a && b ? { a, b } : null;
}

/**
 * Methods whose tidy rows really are pairwise group comparisons.
 *
 * An allow-list rather than a `" vs "` sniff: a correlation matrix also emits `"A vs B"`
 * rows with p-values, and significance brackets between correlation coefficients would be
 * meaningless and misleading.
 */
export const PAIRWISE_METHODS: ReadonlySet<string> = new Set([
  "ttest", "anova", "rmanova", "twoway", "threeway", "nested", "friedman", "kruskal", "survival", "mixedmodel",
]);

/** A planned marker: 1-based endpoints (or data-x), a height in value units, and its p. */
export interface BracketPlan {
  from: number;
  to: number;
  /** Cell refinement (within-group comparison): the 1-based dataset position inside the
   *  category `from`/`to` names. Set only for plans born from cell terms. */
  fromSeries?: number | undefined;
  toSeries?: number | undefined;
  bracketY: number;
  p: number;
  /** Provenance, carried so the caller never has to re-parse the term. */
  term: string;
  groupA: string;
  groupB: string;
}

/**
 * Why comparisons that had a usable p-value never became plans. An empty plan has three
 * distinct causes — nothing significant, names that match nothing on this graph, the
 * control filter — and a caller who reports the wrong one tells the user something false
 * ("nothing significant" about a p = 0.0004 comparison the graph simply cannot place).
 */
export interface BracketSkips {
  /** Neither name resolved — not to a category, and (for cell terms like
   *  "Day 1 · Control") not to a sub-bar via `cellIndex` — or both sides resolved to the
   *  same position. Cell terms aimed at a graph that has no cellIndex land here. */
  unmatchedName: number;
  /** …of which this many were significant at the current α. While this is > 0, "no
   *  significant comparisons" is a false report. */
  unmatchedSignificant: number;
  /** The first significant-but-unplaceable term, so a message can show a concrete one. */
  unmatchedExample?: string | undefined;
  /** p ≥ α. Counted before names are resolved: a weak comparison is dropped whether or
   *  not it could have been placed. */
  notSignificant: number;
  /** Placeable and significant, but the comparison does not involve the control. */
  controlFiltered: number;
}

/**
 * Stack significance brackets above the data.
 *
 * A general planner, not tied to one chart kind:
 *  - the significance cut-off is the user's loosest rung, not a hardcoded 0.05, so a lab
 *    working at α = 0.10 gets the brackets they asked for;
 *  - a reversed value axis stacks the other way;
 *  - a log value axis stacks multiplicatively, because adding a fixed fraction of the span
 *    in log space collapses every level onto the same line.
 *
 * `planSignificanceBracketsWithSkips` additionally reports what was dropped and why, so an
 * empty plan can be explained truthfully; `planSignificanceBrackets` is the same planner
 * for callers that only draw.
 */
export function planSignificanceBrackets(args: Parameters<typeof planSignificanceBracketsWithSkips>[0]): BracketPlan[] {
  return planSignificanceBracketsWithSkips(args).plans;
}

export function planSignificanceBracketsWithSkips(args: {
  terms: { term: string; p?: number | null | undefined }[];
  categoryIndex: Map<string, number>;
  /** Cell names → position: `"Day 1 · Control"` → the Control sub-bar inside category
   *  "Day 1". What lets a two-way run's cell comparisons (`"Day 1 · Control vs Day 1 ·
   *  Treated"`) become within-group brackets instead of being silently skipped.
   *  Tried only after `categoryIndex` fails both names. */
  cellIndex?: Map<string, { cat: number; series: number }> | undefined;
  range: { min: number; max: number; span: number };
  thresholds?: readonly SignificanceThreshold[] | undefined;
  onlySignificant?: boolean | undefined;
  scale?: "linear" | "log" | undefined;
  reversed?: boolean | undefined;
  /** First offset and per-level step, as a fraction of the span. Defaults: 0.06 / 0.085. */
  gap?: number | undefined;
  step?: number | undefined;
  /**
   * Reference (control) group name. Set it and only comparisons involving that group are
   * planned — the "every treatment against the control" figure — and each marker's
   * `groupA` is the control, so provenance reads the way the comparison does.
   *
   * A filter over whatever the test produced, not a change of test: an all-pairs Tukey run
   * keeps its all-pairs correction and simply shows the control column of it. When the
   * analysis itself was run vs-control (Dunnett), every term already involves the control
   * and this is a no-op — which is the correct arrangement, since only the analysis can
   * decide what the p-values mean.
   */
  control?: string | undefined;
}): { plans: BracketPlan[]; skips: BracketSkips } {
  const { terms, categoryIndex, range } = args;
  const onlySig = args.onlySignificant ?? true;
  const control = args.control?.trim() || undefined;
  const ladder = resolveThresholds(args.thresholds);
  const alpha = ladder.length ? Math.max(...ladder.map((t) => t.p)) : 0;
  const gap = args.gap ?? 0.06;
  const step = args.step ?? 0.085;

  const skips: BracketSkips = { unmatchedName: 0, unmatchedSignificant: 0, notSignificant: 0, controlFiltered: 0 };
  const comps: { a: number; b: number; aSer?: number | undefined; bSer?: number | undefined; p: number; term: string; ga: string; gb: string }[] = [];
  for (const t of terms) {
    if (t.p == null || !Number.isFinite(t.p)) continue;
    const names = parseComparisonTerm(t.term);
    if (!names) continue;
    if (onlySig && t.p >= alpha) {
      skips.notSignificant += 1;
      continue;
    }
    const ia = categoryIndex.get(names.a);
    const ib = categoryIndex.get(names.b);
    if (ia != null && ib != null && ia !== ib) {
      // Control mode: keep only the comparisons this group takes part in.
      if (control != null && names.a !== control && names.b !== control) {
        skips.controlFiltered += 1;
        continue;
      }
      // Provenance reads control-first, so `groupA` is the reference in every marker even
      // where the engine happened to name the treatment first. The geometry still runs
      // low index → high index, because a bracket is drawn left to right.
      const first = control != null && names.b === control ? names.b : names.a;
      const second = first === names.a ? names.b : names.a;
      comps.push({
        a: Math.min(ia, ib),
        b: Math.max(ia, ib),
        p: t.p,
        term: t.term,
        ga: control != null ? first : ia <= ib ? names.a : names.b,
        gb: control != null ? second : ia <= ib ? names.b : names.a,
      });
      continue;
    }
    // Cell comparison — "Day 1 · Control vs Day 1 · Treated": both names resolve to a
    // sub-bar rather than a whole category. The control matches the full cell name or
    // either of its components, so control="Control" keeps every within-group pair
    // against the Control series.
    const ca = args.cellIndex?.get(names.a);
    const cb = args.cellIndex?.get(names.b);
    if (!ca || !cb || (ca.cat === cb.cat && ca.series === cb.series)) {
      skips.unmatchedName += 1;
      if (t.p < alpha) {
        skips.unmatchedSignificant += 1;
        skips.unmatchedExample ??= t.term;
      }
      continue;
    }
    const involves = (nm: string): boolean =>
      control != null && (nm === control || nm.split("·").some((part) => part.trim() === control));
    if (control != null && !involves(names.a) && !involves(names.b)) {
      skips.controlFiltered += 1;
      continue;
    }
    const aFirst = ca.cat < cb.cat || (ca.cat === cb.cat && ca.series <= cb.series);
    const controlFirst = control != null && involves(names.b) && !involves(names.a);
    comps.push({
      a: aFirst ? ca.cat : cb.cat,
      b: aFirst ? cb.cat : ca.cat,
      aSer: aFirst ? ca.series : cb.series,
      bSer: aFirst ? cb.series : ca.series,
      p: t.p,
      term: t.term,
      ga: control != null ? (controlFirst ? names.b : names.a) : aFirst ? names.a : names.b,
      gb: control != null ? (controlFirst ? names.a : names.b) : aFirst ? names.b : names.a,
    });
  }
  // Narrower spans first, so nested brackets read as nested rather than crossing.
  comps.sort((x, y) => x.b - x.a - (y.b - y.a) || x.a - y.a || (x.aSer ?? 0) - (y.aSer ?? 0));

  const unit = range.span > 0 ? range.span : Math.max(Math.abs(range.max), 1);
  const heightFor = (k: number): number => {
    const frac = gap + k * step;
    if (args.scale === "log" && range.max > 0) {
      // Multiplicative in log space: a fixed fraction of the visible decades.
      const decades = Math.log10(Math.max(range.max, 1e-12)) - Math.log10(Math.max(range.min, 1e-12));
      const span = decades > 0 ? decades : 1;
      return range.max * Math.pow(10, span * frac);
    }
    return args.reversed ? range.min - unit * frac : range.max + unit * frac;
  };

  /**
   * Rung assignment: each bracket takes the lowest level it does not horizontally overlap
   * on. A separate rung per bracket would staircase even brackets that never touch — three
   * within-group pairs, one per category, would climb three levels to state three
   * independent facts. Overlap is judged with margins: a whole-category bracket's feet sit
   * exactly on its endpoints, a cell bracket's inside ±¼ band; brackets whose gap is under
   * a quarter category (e.g. the 1–2 / 2–3 pair sharing a foot) still stack, so end-ticks
   * never collide.
   */
  const MARGIN = 0.25;
  const extentOf = (c: (typeof comps)[number]): [number, number] => {
    const pad = c.aSer != null || c.bSer != null ? 0.25 : 0;
    return [Math.min(c.a, c.b) - pad, Math.max(c.a, c.b) + pad];
  };
  const levels: [number, number][][] = [];
  const levelOf = comps.map((c) => {
    const [lo, hi] = extentOf(c);
    let k = 0;
    while (k < levels.length && levels[k]!.some(([l2, h2]) => lo - h2 < MARGIN && l2 - hi < MARGIN)) k += 1;
    (levels[k] ??= []).push([lo, hi]);
    return k;
  });

  const plans = comps.map((c, i) => ({
    from: c.a,
    to: c.b,
    ...(c.aSer != null ? { fromSeries: c.aSer } : {}),
    ...(c.bSer != null ? { toSeries: c.bSer } : {}),
    bracketY: heightFor(levelOf[i]!),
    p: c.p,
    term: c.term,
    groupA: c.ga,
    groupB: c.gb,
  }));
  return { plans, skips };
}
