/**
 * Data simulation: generate a data table from a seeded RNG — either a
 * grouped **column** sample from a chosen distribution, or an **XY** dataset from a
 * built-in equation with random scatter. Everything is driven by an integer `seed`
 * so a simulation is exactly reproducible and can be
 * regenerated from its spec. Pure + DOM-free, so it round-trips like a derived table
 * and is unit-testable without the Python engine.
 */
import type { NamedTable } from "./reshape";
import { compileFormula } from "./formula";
import type { FormulaEnv } from "./formula";

// ── seeded PRNG ──────────────────────────────────────────────────────────────
/**
 * `mulberry32` — a small, fast, well-distributed 32-bit PRNG. Deterministic: the
 * same integer seed always yields the same stream (that's the point). Returns a
 * function producing floats in [0, 1).
 */
export function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return function next(): number {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Standard-normal draw via Box-Muller (two uniforms → one normal; spare discarded). */
function stdNormal(rng: () => number): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = rng(); // avoid log(0)
  while (v === 0) v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** Poisson(λ) via Knuth's multiplicative algorithm (fine for the modest λ used here). */
function poisson(rng: () => number, lambda: number): number {
  if (lambda <= 0) return 0;
  const L = Math.exp(-lambda);
  let k = 0;
  let p = 1;
  do {
    k += 1;
    p *= rng();
  } while (p > L);
  return k - 1;
}

export type SimDist = "gaussian" | "lognormal" | "uniform" | "poisson" | "exponential";

/**
 * A sampler that draws a value with the requested (mean, sd) interpretation:
 * - gaussian    → N(mean, sd)
 * - lognormal   → exp(N(ln mean, ln sd)); `mean` = geometric mean, `sd` = geo-SD factor
 * - uniform     → U(mean − sd·√3, mean + sd·√3) so its SD is exactly `sd`
 * - poisson     → Poisson(mean)     (count data; variance = mean, `sd` ignored)
 * - exponential → Exp(rate = 1/mean)  (SD = mean, `sd` ignored)
 */
export function drawFrom(rng: () => number, dist: SimDist, mean: number, sd: number): number {
  switch (dist) {
    case "lognormal": {
      if (mean <= 0 || sd <= 1) return mean; // out of domain → the point estimate
      return Math.exp(Math.log(mean) + Math.log(sd) * stdNormal(rng));
    }
    case "uniform": {
      const half = sd * Math.SQRT2 * Math.sqrt(1.5); // sd·√3
      return mean - half + rng() * 2 * half;
    }
    case "poisson":
      return poisson(rng, mean);
    case "exponential":
      return mean > 0 ? -mean * Math.log(1 - rng()) : 0;
    default:
      return mean + sd * stdNormal(rng);
  }
}

// ── Simulate Column ──────────────────────────────────────────────────────────
export interface SimGroup {
  label: string;
  /** Number of values to draw for this group. */
  n: number;
  mean: number;
  sd: number;
  /** Distribution to sample from (default gaussian). */
  dist?: SimDist;
}

export interface SimColumnSpec {
  kind: "column";
  seed: number;
  groups: SimGroup[];
}

/**
 * Simulate a grouped column table: one column per group, each holding `n` draws
 * from the group's distribution. Columns are padded to the tallest group with
 * blanks so the grid is rectangular. Deterministic in `seed`.
 */
export function simulateColumn(spec: SimColumnSpec): NamedTable {
  const rng = makeRng(spec.seed);
  const groups = spec.groups.filter((g) => g.n > 0);
  const cols = groups.map((g) => {
    const dist = g.dist ?? "gaussian";
    return Array.from({ length: Math.max(0, Math.floor(g.n)) }, () => round6(drawFrom(rng, dist, g.mean, g.sd)));
  });
  const maxN = cols.reduce((m, c) => Math.max(m, c.length), 0);
  const rows: (number | null)[][] = [];
  for (let r = 0; r < maxN; r++) rows.push(cols.map((c) => (r < c.length ? c[r]! : null)));
  return { columnNames: groups.map((g) => g.label), rows };
}

// ── Simulate XY (equation + scatter) ─────────────────────────────────────────
/** A built-in generator equation: parameter names + f(x, params). */
export interface Generator {
  label: string;
  params: string[];
  fn: (x: number, p: number[]) => number;
  /** Needs x > 0 (log-dose / log / power models). */
  positiveX?: boolean;
}

/** Curated generator library for Simulate XY (the common bench shapes). */
export const GENERATORS: Record<string, Generator> = {
  line: { label: "Straight line", params: ["Slope", "Intercept"], fn: (x, p) => p[0]! * x + p[1]! },
  poly2: { label: "Quadratic", params: ["B0", "B1", "B2"], fn: (x, p) => p[0]! + p[1]! * x + p[2]! * x * x },
  exp_decay: { label: "One-phase decay", params: ["Y0", "Plateau", "K"], fn: (x, p) => p[1]! + (p[0]! - p[1]!) * Math.exp(-p[2]! * x) },
  exp_growth: { label: "Exponential growth", params: ["Y0", "K"], fn: (x, p) => p[0]! * Math.exp(p[1]! * x) },
  assoc: { label: "One-phase association", params: ["Y0", "Plateau", "K"], fn: (x, p) => p[0]! + (p[1]! - p[0]!) * (1 - Math.exp(-p[2]! * x)) },
  mm: { label: "Michaelis-Menten", params: ["Vmax", "KM"], fn: (x, p) => (p[0]! * x) / (p[1]! + x) },
  onesite: { label: "One-site binding", params: ["Bmax", "Kd"], fn: (x, p) => (p[0]! * x) / (p[1]! + x) },
  dr4pl: {
    label: "Dose-response (4PL, log dose)",
    params: ["Bottom", "Top", "logEC50", "Hill slope"],
    fn: (x, p) => p[0]! + (p[1]! - p[0]!) / (1 + Math.pow(10, (p[2]! - Math.log10(x)) * p[3]!)),
    positiveX: true,
  },
  gaussian: { label: "Gaussian peak", params: ["Amplitude", "Mean", "SD"], fn: (x, p) => p[0]! * Math.exp(-((x - p[1]!) ** 2) / (2 * p[2]! ** 2)) },
};

export interface SimXYSpec {
  kind: "xy";
  seed: number;
  /** X series: `count` points from `xStart` to `xEnd`, arithmetic or (xLog) geometric. */
  xStart: number;
  xEnd: number;
  xCount: number;
  xLog?: boolean;
  /** Generator id (key of GENERATORS), or `"custom"` to use `customEquation`. */
  equation: string;
  params: number[];
  /** A user-typed function of X (formula.ts syntax; the letter `X` = the grid value),
   *  used when `equation === "custom"` — a "Plot a function" with your own
   *  equation. Invalid / out-of-domain inputs give a blank Y (never NaN). */
  customEquation?: string;
  /** Y replicates per X (each its own noisy column). Default 1. */
  replicates?: number;
  /** Random scatter added to each Y: none, absolute Gaussian SD, or relative %. */
  noise?: { type: "none" | "sd" | "relative"; value: number };
}

/** Build the X grid (arithmetic or geometric spacing). */
export function simXValues(spec: Pick<SimXYSpec, "xStart" | "xEnd" | "xCount" | "xLog">): number[] {
  const n = Math.max(1, Math.floor(spec.xCount));
  if (n === 1) return [spec.xStart];
  if (spec.xLog) {
    const a = Math.log10(spec.xStart);
    const b = Math.log10(spec.xEnd);
    return Array.from({ length: n }, (_, i) => 10 ** (a + ((b - a) * i) / (n - 1)));
  }
  return Array.from({ length: n }, (_, i) => spec.xStart + ((spec.xEnd - spec.xStart) * i) / (n - 1));
}

/**
 * Simulate an XY dataset: evaluate the chosen equation over the X grid and add
 * random scatter, producing an X column + one Y column per replicate. Deterministic
 * in `seed`. Unknown equation ids or out-of-domain X (positive-only models) yield
 * blank Y cells rather than throwing.
 */
export function simulateXY(spec: SimXYSpec): NamedTable {
  const gen = GENERATORS[spec.equation];
  const rng = makeRng(spec.seed);
  const xs = simXValues(spec);
  const reps = Math.max(1, Math.floor(spec.replicates ?? 1));
  const noise = spec.noise ?? { type: "none", value: 0 };
  // A user-typed f(X): compile once; the letter `X` is column index 23 in formula.ts's
  // letter-based refs, so evaluating with row[23] = x plots the equation over the grid.
  const custom = spec.equation === "custom" && spec.customEquation?.trim() ? compileFormula(spec.customEquation) : null;
  const evalBase = (x: number): number | null => {
    if (custom) {
      if (!custom.ok) return null;
      const env: FormulaEnv = { row: [], colVals: [] };
      env.row[23] = x; // "X"
      return custom.eval(env);
    }
    if (gen && (!gen.positiveX || x > 0)) return gen.fn(x, spec.params);
    return null;
  };
  const columnNames = ["X", ...(reps === 1 ? ["Y"] : Array.from({ length: reps }, (_, r) => `Y${r + 1}`))];
  const rows: (number | null)[][] = xs.map((x) => {
    const row: (number | null)[] = [round6(x)];
    const base = evalBase(x);
    for (let r = 0; r < reps; r++) {
      let y: number | null = null;
      if (base !== null && Number.isFinite(base)) {
        const s = noise.type === "sd" ? noise.value : noise.type === "relative" ? (Math.abs(base) * noise.value) / 100 : 0;
        const val = s > 0 ? base + s * stdNormal(rng) : base;
        y = Number.isFinite(val) ? round6(val) : null;
      }
      row.push(y);
    }
    return row;
  });
  return { columnNames, rows };
}

/** The combined spec stored on a simulated table's derivation. */
export type SimulateSpec = SimColumnSpec | SimXYSpec;

/** Generate the table for either simulation kind. */
export function simulate(spec: SimulateSpec): NamedTable {
  return spec.kind === "column" ? simulateColumn(spec) : simulateXY(spec);
}

function round6(v: number): number {
  return Math.round(v * 1e6) / 1e6;
}
