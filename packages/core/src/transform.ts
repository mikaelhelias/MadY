/**
 * Data transforms (the "Transform" analysis) — the function set that
 * derives a new numeric table from an existing one: standard arithmetic of Y,
 * logs/exponentials/powers, statistical re-scalings (z-score, normalise, rank,
 * fraction-of-total) and the linearisers used for proportions and dose-response
 * (logit, probit, arcsine-root, pX). Pure + DOM-free so the Transform dialog can
 * preview cheaply and the result flows straight into `importTable`, exactly like
 * a reshape.
 *
 * Operates on the import pipeline's currency — a `NamedTable` (`{ columnNames,
 * rows }`) — and returns the same shape, with the chosen columns replaced (or
 * appended). Non-numeric / out-of-domain cells become blank (null): a transform
 * that is undefined for a value (log of ≤0, 1/0, logit of a value outside 0–1)
 * yields an empty cell rather than NaN.
 */
import type { CellValue } from "./model";
import type { NamedTable } from "./reshape";
import { makeRng } from "./simulate";

/** Whether a transform needs the per-column context (mean/SD/min/max/Σ/ranks). */
export type TransformScope = "element" | "column";

/** Stable id of each transform function. */
export type TransformId =
  // constant K
  | "add-k"
  | "sub-k"
  | "k-sub"
  | "mul-k"
  | "div-k"
  | "k-div"
  | "pow-k"
  | "k-pow"
  // logs & exponentials
  | "log10"
  | "neglog10"
  | "log2"
  | "ln"
  | "pow10"
  | "exp"
  | "pow2"
  // powers & roots
  | "square"
  | "cube"
  | "sqrt"
  | "cbrt"
  | "reciprocal"
  | "abs"
  | "negate"
  | "round-k"
  // X-combining (each Y combined with the row's X value)
  | "div-x"
  | "x-div"
  | "sub-x"
  | "x-sub"
  | "add-x"
  | "mul-x"
  // statistical re-scalings (column-aware)
  | "zscore"
  | "center"
  | "normalize01"
  | "normalize100"
  | "fraction-total"
  | "percent-total"
  | "rank"
  // proportions / linearisers
  | "logit"
  | "arcsin-sqrt"
  | "probit"
  // trigonometric (Y in degrees)
  | "sin-deg"
  | "cos-deg"
  | "tan-deg"
  // trigonometric (Y in radians) + inverse trig + degree↔radian conversion
  | "sin-rad"
  | "cos-rad"
  | "tan-rad"
  | "asin"
  | "acos"
  | "atan"
  | "deg2rad"
  | "rad2deg"
  // random noise (seeded → reproducible via the transform's `seed`)
  | "random-gauss"
  | "random-uniform";

/** Per-column precomputed context for the column-aware transforms. */
export interface ColumnContext {
  /** Finite values of the column, in row order. */
  readonly values: number[];
  readonly mean: number;
  readonly sd: number;
  readonly min: number;
  readonly max: number;
  readonly sum: number;
  /** Ascending sort of `values` (for ranks). */
  readonly sorted: number[];
}

/** Metadata + implementation of one transform. */
export interface TransformFn {
  id: TransformId;
  /** Menu label using the standard math glyphs, e.g. "Y = log₁₀(Y)". */
  label: string;
  /** Short grouping for the dialog (Arithmetic / Logs / Powers / …). */
  group: string;
  scope: TransformScope;
  /** This function uses the constant K. */
  needsK?: boolean;
  /** Default value for K when first selected. */
  defaultK?: number;
  /** This function combines each Y with the row's X value (X-combining, e.g. Y÷X). */
  needsX?: boolean;
  /** This function adds seeded random noise (needs one uniform draw per cell). */
  random?: boolean;
  /** Default header transform applied to the source column name. */
  rename: (name: string, k: number) => string;
  /**
   * Map one finite value → a finite result, or `null` when the transform is
   * undefined for that value (out of domain). `k` is the constant (0 if unused),
   * `ctx` the column context (only meaningful for column-scope functions), `x` the
   * row's X value (NaN when unavailable — only meaningful for `needsX` functions),
   * `rand` a uniform draw in [0, 1) for this cell (only meaningful for `random`
   * functions; 0.5 otherwise, so non-random transforms stay deterministic).
   */
  apply: (y: number, k: number, ctx: ColumnContext, x: number, rand: number) => number | null;
}

/** Finite result or null (NaN/∞ → null). */
function fin(v: number): number | null {
  return Number.isFinite(v) ? v : null;
}

/**
 * Inverse standard-normal CDF (probit), Φ⁻¹(p) for 0<p<1 — Acklam's rational
 * approximation, |error| < 1.15e-9 over the full range. Used by the probit
 * transform; returns null at or beyond the open interval.
 */
export function normInv(p: number): number | null {
  if (!(p > 0 && p < 1)) return null;
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
  const plow = 0.02425;
  const phigh = 1 - plow;
  let q: number;
  let r: number;
  if (p < plow) {
    q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!) / ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1);
  }
  if (p <= phigh) {
    q = p - 0.5;
    r = q * q;
    return (((((a[0]! * r + a[1]!) * r + a[2]!) * r + a[3]!) * r + a[4]!) * r + a[5]!) * q / (((((b[0]! * r + b[1]!) * r + b[2]!) * r + b[3]!) * r + b[4]!) * r + 1);
  }
  q = Math.sqrt(-2 * Math.log(1 - p));
  return -(((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!) / ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1);
}

const DEG = Math.PI / 180;

/** Average-tie rank (1-based) of `y` within the ascending `sorted` values. */
function averageRank(y: number, sorted: number[]): number {
  // First and last index of values equal to y (ties share the averaged rank).
  let first = sorted.length;
  let last = -1;
  for (let i = 0; i < sorted.length; i++) {
    if (sorted[i] === y) {
      if (i < first) first = i;
      last = i;
    }
  }
  if (last < 0) return NaN;
  return (first + last) / 2 + 1; // mean of the 1-based positions first..last
}

/** The full transform registry, in display order. */
export const TRANSFORMS: TransformFn[] = [
  // ---- arithmetic with a constant K ----
  { id: "add-k", label: "Y = Y + K", group: "Arithmetic", scope: "element", needsK: true, defaultK: 1, rename: (n) => `${n}+K`, apply: (y, k) => fin(y + k) },
  { id: "sub-k", label: "Y = Y − K", group: "Arithmetic", scope: "element", needsK: true, defaultK: 1, rename: (n) => `${n}−K`, apply: (y, k) => fin(y - k) },
  { id: "k-sub", label: "Y = K − Y", group: "Arithmetic", scope: "element", needsK: true, defaultK: 1, rename: (n) => `K−${n}`, apply: (y, k) => fin(k - y) },
  { id: "mul-k", label: "Y = Y × K", group: "Arithmetic", scope: "element", needsK: true, defaultK: 2, rename: (n) => `${n}×K`, apply: (y, k) => fin(y * k) },
  { id: "div-k", label: "Y = Y ÷ K", group: "Arithmetic", scope: "element", needsK: true, defaultK: 2, rename: (n) => `${n}÷K`, apply: (y, k) => (k === 0 ? null : fin(y / k)) },
  { id: "k-div", label: "Y = K ÷ Y", group: "Arithmetic", scope: "element", needsK: true, defaultK: 1, rename: (n) => `K÷${n}`, apply: (y, k) => (y === 0 ? null : fin(k / y)) },
  { id: "pow-k", label: "Y = Yᴷ", group: "Powers", scope: "element", needsK: true, defaultK: 2, rename: (n) => `${n}^K`, apply: (y, k) => fin(Math.pow(y, k)) },
  { id: "k-pow", label: "Y = Kʸ", group: "Powers", scope: "element", needsK: true, defaultK: 10, rename: (n) => `K^${n}`, apply: (y, k) => fin(Math.pow(k, y)) },
  // ---- logs & exponentials ----
  { id: "log10", label: "Y = log₁₀(Y)", group: "Logs", scope: "element", rename: (n) => `log(${n})`, apply: (y) => (y > 0 ? fin(Math.log10(y)) : null) },
  { id: "neglog10", label: "Y = −log₁₀(Y)", group: "Logs", scope: "element", rename: (n) => `−log(${n})`, apply: (y) => (y > 0 ? fin(-Math.log10(y)) : null) },
  { id: "log2", label: "Y = log₂(Y)", group: "Logs", scope: "element", rename: (n) => `log₂(${n})`, apply: (y) => (y > 0 ? fin(Math.log2(y)) : null) },
  { id: "ln", label: "Y = ln(Y)", group: "Logs", scope: "element", rename: (n) => `ln(${n})`, apply: (y) => (y > 0 ? fin(Math.log(y)) : null) },
  { id: "pow10", label: "Y = 10^Y", group: "Logs", scope: "element", rename: (n) => `10^${n}`, apply: (y) => fin(Math.pow(10, y)) },
  { id: "exp", label: "Y = eʸ", group: "Logs", scope: "element", rename: (n) => `e^${n}`, apply: (y) => fin(Math.exp(y)) },
  { id: "pow2", label: "Y = 2^Y", group: "Logs", scope: "element", rename: (n) => `2^${n}`, apply: (y) => fin(Math.pow(2, y)) },
  // ---- powers & roots ----
  { id: "square", label: "Y = Y²", group: "Powers", scope: "element", rename: (n) => `${n}²`, apply: (y) => fin(y * y) },
  { id: "cube", label: "Y = Y³", group: "Powers", scope: "element", rename: (n) => `${n}³`, apply: (y) => fin(y * y * y) },
  { id: "sqrt", label: "Y = √Y", group: "Powers", scope: "element", rename: (n) => `√${n}`, apply: (y) => (y >= 0 ? fin(Math.sqrt(y)) : null) },
  { id: "cbrt", label: "Y = ∛Y", group: "Powers", scope: "element", rename: (n) => `∛${n}`, apply: (y) => fin(Math.cbrt(y)) },
  { id: "reciprocal", label: "Y = 1 ÷ Y", group: "Powers", scope: "element", rename: (n) => `1/${n}`, apply: (y) => (y === 0 ? null : fin(1 / y)) },
  { id: "abs", label: "Y = |Y|", group: "Arithmetic", scope: "element", rename: (n) => `|${n}|`, apply: (y) => fin(Math.abs(y)) },
  { id: "negate", label: "Y = −Y", group: "Arithmetic", scope: "element", rename: (n) => `−${n}`, apply: (y) => fin(-y) },
  { id: "round-k", label: "Y = round(Y, K digits)", group: "Arithmetic", scope: "element", needsK: true, defaultK: 2, rename: (n) => `round(${n})`, apply: (y, k) => { const f = Math.pow(10, Math.round(k)); return fin(Math.round(y * f) / f); } },
  // ---- X-combining: each Y combined with the row's X value ----
  { id: "div-x", label: "Y = Y ÷ X", group: "Combine X", scope: "element", needsX: true, rename: (n) => `${n}÷X`, apply: (y, _k, _c, x) => (x === 0 ? null : fin(y / x)) },
  { id: "x-div", label: "Y = X ÷ Y", group: "Combine X", scope: "element", needsX: true, rename: (n) => `X÷${n}`, apply: (y, _k, _c, x) => (y === 0 ? null : fin(x / y)) },
  { id: "sub-x", label: "Y = Y − X", group: "Combine X", scope: "element", needsX: true, rename: (n) => `${n}−X`, apply: (y, _k, _c, x) => fin(y - x) },
  { id: "x-sub", label: "Y = X − Y", group: "Combine X", scope: "element", needsX: true, rename: (n) => `X−${n}`, apply: (y, _k, _c, x) => fin(x - y) },
  { id: "add-x", label: "Y = Y + X", group: "Combine X", scope: "element", needsX: true, rename: (n) => `${n}+X`, apply: (y, _k, _c, x) => fin(y + x) },
  { id: "mul-x", label: "Y = Y × X", group: "Combine X", scope: "element", needsX: true, rename: (n) => `${n}×X`, apply: (y, _k, _c, x) => fin(y * x) },
  // ---- statistical re-scalings (column-aware) ----
  { id: "zscore", label: "Y = (Y − mean) ÷ SD", group: "Standardise", scope: "column", rename: (n) => `z(${n})`, apply: (y, _k, c) => (c.sd > 0 ? fin((y - c.mean) / c.sd) : null) },
  { id: "center", label: "Y = Y − mean", group: "Standardise", scope: "column", rename: (n) => `${n}−mean`, apply: (y, _k, c) => fin(y - c.mean) },
  { id: "normalize01", label: "Normalise → 0…1", group: "Standardise", scope: "column", rename: (n) => `${n} (0–1)`, apply: (y, _k, c) => (c.max > c.min ? fin((y - c.min) / (c.max - c.min)) : null) },
  { id: "normalize100", label: "Normalise → 0…100%", group: "Standardise", scope: "column", rename: (n) => `${n} (%)`, apply: (y, _k, c) => (c.max > c.min ? fin((100 * (y - c.min)) / (c.max - c.min)) : null) },
  { id: "fraction-total", label: "Fraction of total", group: "Standardise", scope: "column", rename: (n) => `${n}/Σ`, apply: (y, _k, c) => (c.sum !== 0 ? fin(y / c.sum) : null) },
  { id: "percent-total", label: "Percent of total", group: "Standardise", scope: "column", rename: (n) => `${n} %total`, apply: (y, _k, c) => (c.sum !== 0 ? fin((100 * y) / c.sum) : null) },
  { id: "rank", label: "Rank (ascending)", group: "Standardise", scope: "column", rename: (n) => `rank(${n})`, apply: (y, _k, c) => fin(averageRank(y, c.sorted)) },
  // ---- proportions / linearisers ----
  { id: "logit", label: "Y = ln(Y ÷ (1 − Y))", group: "Proportions", scope: "element", rename: (n) => `logit(${n})`, apply: (y) => (y > 0 && y < 1 ? fin(Math.log(y / (1 - y))) : null) },
  { id: "arcsin-sqrt", label: "Y = arcsin(√Y)", group: "Proportions", scope: "element", rename: (n) => `asin√(${n})`, apply: (y) => (y >= 0 && y <= 1 ? fin(Math.asin(Math.sqrt(y))) : null) },
  { id: "probit", label: "Y = probit(Y) = Φ⁻¹(Y)", group: "Proportions", scope: "element", rename: (n) => `probit(${n})`, apply: (y) => normInv(y) },
  // ---- trigonometric (degrees) ----
  { id: "sin-deg", label: "Y = sin(Y°)", group: "Trigonometry", scope: "element", rename: (n) => `sin(${n}°)`, apply: (y) => fin(Math.sin(y * DEG)) },
  { id: "cos-deg", label: "Y = cos(Y°)", group: "Trigonometry", scope: "element", rename: (n) => `cos(${n}°)`, apply: (y) => fin(Math.cos(y * DEG)) },
  { id: "tan-deg", label: "Y = tan(Y°)", group: "Trigonometry", scope: "element", rename: (n) => `tan(${n}°)`, apply: (y) => fin(Math.tan(y * DEG)) },
  // ---- trigonometric (radians) + inverse trig + degree↔radian conversion ----
  { id: "sin-rad", label: "Y = sin(Y) [radians]", group: "Trigonometry", scope: "element", rename: (n) => `sin(${n})`, apply: (y) => fin(Math.sin(y)) },
  { id: "cos-rad", label: "Y = cos(Y) [radians]", group: "Trigonometry", scope: "element", rename: (n) => `cos(${n})`, apply: (y) => fin(Math.cos(y)) },
  { id: "tan-rad", label: "Y = tan(Y) [radians]", group: "Trigonometry", scope: "element", rename: (n) => `tan(${n})`, apply: (y) => fin(Math.tan(y)) },
  { id: "asin", label: "Y = arcsin(Y) [radians]", group: "Trigonometry", scope: "element", rename: (n) => `asin(${n})`, apply: (y) => (y >= -1 && y <= 1 ? fin(Math.asin(y)) : null) },
  { id: "acos", label: "Y = arccos(Y) [radians]", group: "Trigonometry", scope: "element", rename: (n) => `acos(${n})`, apply: (y) => (y >= -1 && y <= 1 ? fin(Math.acos(y)) : null) },
  { id: "atan", label: "Y = arctan(Y) [radians]", group: "Trigonometry", scope: "element", rename: (n) => `atan(${n})`, apply: (y) => fin(Math.atan(y)) },
  { id: "deg2rad", label: "Y = degrees → radians", group: "Trigonometry", scope: "element", rename: (n) => `${n} rad`, apply: (y) => fin(y * DEG) },
  { id: "rad2deg", label: "Y = radians → degrees", group: "Trigonometry", scope: "element", rename: (n) => `${n}°`, apply: (y) => fin(y / DEG) },
  // ---- random noise (seeded → reproducible; K = the noise SD / half-width) ----
  // Gaussian noise via the inverse-CDF of a uniform draw: Φ⁻¹(U) ~ N(0, 1), so Y + K·Z
  // adds N(0, K²) scatter. A draw of exactly 0 (→ Φ⁻¹ undefined) leaves the value unchanged.
  { id: "random-gauss", label: "Y = Y + Gaussian noise (SD = K)", group: "Random", scope: "element", needsK: true, defaultK: 1, random: true, rename: (n) => `${n}+noise`, apply: (y, k, _c, _x, rand) => { const z = normInv(rand); return z === null ? fin(y) : fin(y + k * z); } },
  { id: "random-uniform", label: "Y = Y + Uniform noise (±K)", group: "Random", scope: "element", needsK: true, defaultK: 1, random: true, rename: (n) => `${n}+noise`, apply: (y, k, _c, _x, rand) => fin(y + k * (2 * rand - 1)) },
];

/** Lookup a transform by id (undefined if unknown). */
export function transformById(id: TransformId): TransformFn | undefined {
  return TRANSFORMS.find((t) => t.id === id);
}

export interface TransformSpec {
  /** The function to apply. */
  fn: TransformId;
  /** Indices (0-based) of the columns to transform. */
  columns: readonly number[];
  /** Constant for the K-functions (ignored otherwise). */
  k?: number;
  /**
   * Append the transformed values as new columns (true) vs replace the source
   * columns in place (default false — the "Transform" analysis replaces).
   */
  append?: boolean;
  /** Which column supplies X for the X-combining functions (`needsX`). Default 0. */
  xColumn?: number;
  /**
   * Interchange X and Y: swap two columns (values + names) and return — the `fn`/
   * `columns` are ignored. `xCol`/`yCol` are 0-based indices. undefined = off.
   */
  swapXY?: { xCol: number; yCol: number };
  /** Seed for the random-noise transforms (`random` fns) — makes the added scatter
   *  reproducible. Ignored by non-random functions. Default 0. */
  seed?: number;
}

/** Parse a cell to a finite number, or null (blank / non-numeric). */
function asNumber(v: CellValue | undefined): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Build a column's numeric context from the grid (finite cells only). */
function columnContext(rows: CellValue[][], col: number): ColumnContext {
  const values: number[] = [];
  for (const row of rows) {
    const n = asNumber(row[col]);
    if (n !== null) values.push(n);
  }
  const n = values.length;
  let sum = 0;
  let min = Infinity;
  let max = -Infinity;
  for (const v of values) {
    sum += v;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const mean = n > 0 ? sum / n : NaN;
  let sd = NaN;
  if (n > 1) {
    let ss = 0;
    for (const v of values) ss += (v - mean) * (v - mean);
    sd = Math.sqrt(ss / (n - 1));
  }
  return {
    values,
    mean,
    sd,
    min: n > 0 ? min : NaN,
    max: n > 0 ? max : NaN,
    sum,
    sorted: [...values].sort((a, b) => a - b),
  };
}

/**
 * Apply a transform to a `NamedTable`, returning a new grid. Selected columns are
 * either replaced in place (default) or appended after the originals (when
 * `append`). Out-of-domain / non-numeric cells become blank (null). Columns not
 * selected pass through verbatim, so the X column (or identifiers) can be kept.
 */
export function applyTransform(table: NamedTable, spec: TransformSpec): NamedTable {
  // Interchange X and Y: a pure column swap (values + header), fn/columns ignored.
  if (spec.swapXY) {
    const { xCol, yCol } = spec.swapXY;
    const nCols = table.columnNames.length;
    if (xCol < 0 || yCol < 0 || xCol >= nCols || yCol >= nCols || xCol === yCol) return { columnNames: [...table.columnNames], rows: table.rows.map((r) => [...r]) };
    const columnNames = [...table.columnNames];
    [columnNames[xCol], columnNames[yCol]] = [columnNames[yCol]!, columnNames[xCol]!];
    const rows = table.rows.map((row) => {
      const next = [...row];
      [next[xCol], next[yCol]] = [next[yCol] ?? null, next[xCol] ?? null];
      return next;
    });
    return { columnNames, rows };
  }
  const fn = transformById(spec.fn);
  if (!fn) throw new Error(`Unknown transform: ${spec.fn}`);
  const k = spec.k ?? fn.defaultK ?? 0;
  const cols = [...new Set(spec.columns)].filter((c) => c >= 0 && c < table.columnNames.length);
  const ctx = new Map<number, ColumnContext>();
  for (const c of cols) ctx.set(c, columnContext(table.rows, c));
  // X-combining functions read the row's X from `xColumn` (default the first column).
  const xCol = spec.xColumn ?? 0;
  // Random transforms: one seeded uniform draw per (column, row), precomputed so the
  // added scatter is reproducible from `seed` and independent of column / iteration
  // order (each column gets its own stream seeded `seed + col`).
  const noise = fn.random ? new Map<number, number[]>() : null;
  if (noise) {
    for (const c of cols) {
      const rng = makeRng((spec.seed ?? 0) + c);
      noise.set(c, table.rows.map(() => rng()));
    }
  }

  const transformCell = (raw: CellValue, col: number, row: CellValue[], rowIndex: number): CellValue => {
    const num = asNumber(raw);
    if (num === null) return null;
    const x = fn.needsX ? asNumber(row[xCol]) ?? NaN : NaN;
    const rand = noise ? noise.get(col)?.[rowIndex] ?? 0.5 : 0.5;
    const out = fn.apply(num, k, ctx.get(col)!, x, rand);
    return out === null ? null : out;
  };

  if (spec.append) {
    const columnNames = [...table.columnNames];
    for (const c of cols) columnNames.push(fn.rename(table.columnNames[c] ?? `C${c + 1}`, k));
    const rows = table.rows.map((row, rowIndex) => {
      const next = [...row];
      for (const c of cols) next.push(transformCell(row[c] ?? null, c, row, rowIndex));
      return next;
    });
    return { columnNames, rows };
  }

  const columnNames = table.columnNames.map((name, c) => (cols.includes(c) ? fn.rename(name, k) : name));
  const rows = table.rows.map((row, rowIndex) => row.map((cell, c) => (cols.includes(c) ? transformCell(cell ?? null, c, row, rowIndex) : cell)));
  return { columnNames, rows };
}
