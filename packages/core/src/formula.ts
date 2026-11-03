/**
 * In-table calculated variables ("formula columns"). A pure, DOM-free,
 * `eval`-free expression engine: a tokenizer + recursive-descent parser + evaluator
 * over the row's other columns (referenced by letter A/B/C… = column position),
 * with a function library (arithmetic, trig, logs, logical IF/AND/OR/NOT) and
 * column aggregates (MEAN/SUM/SD/COUNT/MIN/MAX/MEDIAN over a whole column).
 *
 * A column with a `formula` is materialised: `recomputeFormulas(table)` writes the
 * evaluated value into each row's cell, so analyses/plots/derived tables/export read
 * it like any other cell. Blank / non-numeric / out-of-domain inputs propagate to a
 * blank (null) result — never NaN. Formula columns may reference earlier formula
 * columns (a bounded number of settling passes resolves chains); circular refs stop
 * at the pass limit rather than looping.
 */
import type { CellValue, DataTable } from "./model";

// --- tokens ---------------------------------------------------------------
type Tok =
  | { t: "num"; v: number }
  | { t: "col"; i: number } // A → 0, B → 1, …
  | { t: "id"; v: string } // function / constant name (upper-cased)
  | { t: "op"; v: string }
  | { t: "("; }
  | { t: ")"; }
  | { t: ","; };

const CMP = new Set(["<", ">", "<=", ">=", "=", "==", "<>", "!="]);

function tokenize(src: string): Tok[] | { error: string } {
  const out: Tok[] = [];
  let i = 0;
  const s = src;
  while (i < s.length) {
    const c = s[i]!;
    if (c === " " || c === "\t" || c === "\n" || c === "\r") { i++; continue; }
    if (c === "(") { out.push({ t: "(" }); i++; continue; }
    if (c === ")") { out.push({ t: ")" }); i++; continue; }
    if (c === ",") { out.push({ t: "," }); i++; continue; }
    // numbers (incl. decimals + scientific)
    if ((c >= "0" && c <= "9") || (c === "." && s[i + 1]! >= "0" && s[i + 1]! <= "9")) {
      const m = /^\d*\.?\d+(?:[eE][+-]?\d+)?/.exec(s.slice(i));
      if (!m) return { error: `Bad number at ${i}` };
      out.push({ t: "num", v: Number(m[0]) });
      i += m[0].length;
      continue;
    }
    // identifiers: a single letter is a column ref; a longer run is a function/const name.
    if ((c >= "A" && c <= "Z") || (c >= "a" && c <= "z") || c === "_") {
      const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(s.slice(i))!;
      const word = m[0];
      i += word.length;
      if (word.length === 1) {
        const up = word.toUpperCase();
        out.push({ t: "col", i: up.charCodeAt(0) - 65 }); // A..Z → 0..25
      } else {
        out.push({ t: "id", v: word.toUpperCase() });
      }
      continue;
    }
    // operators (two-char comparisons first)
    const two = s.slice(i, i + 2);
    if (CMP.has(two)) { out.push({ t: "op", v: two }); i += 2; continue; }
    if ("+-*/^<>=".includes(c)) { out.push({ t: "op", v: c }); i++; continue; }
    return { error: `Unexpected “${c}”` };
  }
  return out;
}

// --- AST ------------------------------------------------------------------
type Node =
  | { k: "num"; v: number }
  | { k: "col"; i: number }
  | { k: "const"; v: number }
  | { k: "neg"; a: Node }
  | { k: "bin"; op: string; a: Node; b: Node }
  | { k: "cmp"; op: string; a: Node; b: Node }
  | { k: "fn"; name: string; args: Node[] }
  | { k: "agg"; name: string; col: number };

/** Column-aggregate names: each takes exactly one bare column reference. */
const AGGS = new Set(["MEAN", "AVERAGE", "SUM", "SD", "STDEV", "STDDEV", "COUNT", "MIN", "MAX", "MEDIAN"]);
/** Value functions: name → arity (−1 = variadic ≥1). */
const FN_ARITY: Record<string, number> = {
  ABS: 1, SQRT: 1, SQR: 1, INT: 1, SIGN: 1, EXP: 1, LN: 1, LOG: 1, LOG10: 1, LOG2: 1,
  SIN: 1, COS: 1, TAN: 1, ASIN: 1, ACOS: 1, ATAN: 1, RAD: 1, DEG: 1, NOT: 1,
  ROUND: 2, MOD: 2, POW: 2, ATAN2: 2,
  IF: 3,
  AND: -1, OR: -1,
};
// Single letters are always column references (A–Z), so constants must be multi-char to
// avoid a clash (no bare `E` — use EXP(1) for Euler's number).
const CONSTS: Record<string, number> = { PI: Math.PI };

// --- parser (recursive descent, precedence-climbing) ----------------------
class Parser {
  private p = 0;
  constructor(private toks: Tok[]) {}
  private peek(): Tok | undefined { return this.toks[this.p]; }
  private next(): Tok | undefined { return this.toks[this.p++]; }
  parse(): Node {
    const n = this.comparison();
    if (this.p !== this.toks.length) throw new Error("Unexpected trailing input");
    return n;
  }
  private comparison(): Node {
    let a = this.additive();
    const t = this.peek();
    if (t && t.t === "op" && CMP.has(t.v)) {
      this.next();
      const b = this.additive();
      a = { k: "cmp", op: t.v, a, b };
    }
    return a;
  }
  private additive(): Node {
    let a = this.multiplicative();
    for (let t = this.peek(); t && t.t === "op" && (t.v === "+" || t.v === "-"); t = this.peek()) {
      this.next();
      a = { k: "bin", op: t.v, a, b: this.multiplicative() };
    }
    return a;
  }
  private multiplicative(): Node {
    let a = this.unary();
    for (let t = this.peek(); t && t.t === "op" && (t.v === "*" || t.v === "/"); t = this.peek()) {
      this.next();
      a = { k: "bin", op: t.v, a, b: this.unary() };
    }
    return a;
  }
  private unary(): Node {
    const t = this.peek();
    if (t && t.t === "op" && (t.v === "-" || t.v === "+")) {
      this.next();
      const a = this.unary();
      return t.v === "-" ? { k: "neg", a } : a;
    }
    return this.power();
  }
  private power(): Node {
    const a = this.primary();
    const t = this.peek();
    if (t && t.t === "op" && t.v === "^") {
      this.next();
      return { k: "bin", op: "^", a, b: this.unary() }; // right-assoc: 2^-3, 2^3^2
    }
    return a;
  }
  private primary(): Node {
    const t = this.next();
    if (!t) throw new Error("Unexpected end of formula");
    if (t.t === "num") return { k: "num", v: t.v };
    if (t.t === "col") return { k: "col", i: t.i };
    if (t.t === "(") {
      const n = this.comparison();
      if (this.next()?.t !== ")") throw new Error("Missing “)”");
      return n;
    }
    if (t.t === "id") {
      const name = t.v;
      if (this.peek()?.t === "(") {
        this.next(); // consume "("
        const args: Node[] = [];
        if (this.peek()?.t !== ")") {
          args.push(this.comparison());
          while (this.peek()?.t === ",") { this.next(); args.push(this.comparison()); }
        }
        if (this.next()?.t !== ")") throw new Error(`Missing “)” after ${name}(`);
        if (AGGS.has(name)) {
          if (args.length !== 1 || args[0]!.k !== "col") throw new Error(`${name}() takes one column letter, e.g. ${name}(A)`);
          return { k: "agg", name, col: (args[0] as { k: "col"; i: number }).i };
        }
        const arity = FN_ARITY[name];
        if (arity === undefined) throw new Error(`Unknown function “${name}”`);
        if (arity >= 0 && args.length !== arity) throw new Error(`${name}() takes ${arity} argument${arity === 1 ? "" : "s"}`);
        if (arity === -1 && args.length < 1) throw new Error(`${name}() needs at least one argument`);
        return { k: "fn", name, args };
      }
      if (name in CONSTS) return { k: "const", v: CONSTS[name]! };
      throw new Error(`Unknown name “${name}” (use a function, or a column letter A–Z)`);
    }
    throw new Error("Unexpected token in formula");
  }
}

// --- evaluation -----------------------------------------------------------
export interface FormulaEnv {
  /** This row's numeric value per column index (null = blank / non-numeric). */
  row: (number | null)[];
  /** Each column's finite values across all rows (for aggregates). */
  colVals: number[][];
}

const fin = (v: number): number | null => (Number.isFinite(v) ? v : null);
const DEG = Math.PI / 180;

/** Sample SD of a finite array (n<2 → 0). */
function sd(a: number[]): number {
  if (a.length < 2) return 0;
  const m = a.reduce((s, x) => s + x, 0) / a.length;
  return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1));
}
function median(a: number[]): number | null {
  if (a.length === 0) return null;
  const s = [...a].sort((x, y) => x - y);
  const h = Math.floor(s.length / 2);
  return s.length % 2 ? s[h]! : (s[h - 1]! + s[h]!) / 2;
}

function evalNode(n: Node, env: FormulaEnv): number | null {
  switch (n.k) {
    case "num": return n.v;
    case "const": return n.v;
    case "col": return env.row[n.i] ?? null;
    case "neg": { const a = evalNode(n.a, env); return a === null ? null : fin(-a); }
    case "cmp": {
      const a = evalNode(n.a, env); const b = evalNode(n.b, env);
      if (a === null || b === null) return null;
      switch (n.op) {
        case "<": return a < b ? 1 : 0;
        case ">": return a > b ? 1 : 0;
        case "<=": return a <= b ? 1 : 0;
        case ">=": return a >= b ? 1 : 0;
        case "=": case "==": return a === b ? 1 : 0;
        default: return a !== b ? 1 : 0; // <> !=
      }
    }
    case "bin": {
      const a = evalNode(n.a, env); const b = evalNode(n.b, env);
      if (a === null || b === null) return null;
      switch (n.op) {
        case "+": return fin(a + b);
        case "-": return fin(a - b);
        case "*": return fin(a * b);
        case "/": return b === 0 ? null : fin(a / b);
        default: return fin(Math.pow(a, b)); // ^
      }
    }
    case "agg": {
      const vals = env.colVals[n.col] ?? [];
      if (n.name === "COUNT") return vals.length;
      if (vals.length === 0) return null;
      switch (n.name) {
        case "SUM": return fin(vals.reduce((s, x) => s + x, 0));
        case "MEAN": case "AVERAGE": return fin(vals.reduce((s, x) => s + x, 0) / vals.length);
        case "SD": case "STDEV": case "STDDEV": return fin(sd(vals));
        case "MIN": return fin(Math.min(...vals));
        case "MAX": return fin(Math.max(...vals));
        default: return median(vals); // MEDIAN
      }
    }
    case "fn": return evalFn(n.name, n.args, env);
  }
}

function evalFn(name: string, args: Node[], env: FormulaEnv): number | null {
  // IF short-circuits (only the taken branch is evaluated).
  if (name === "IF") {
    const c = evalNode(args[0]!, env);
    if (c === null) return null;
    return evalNode(c !== 0 ? args[1]! : args[2]!, env);
  }
  if (name === "AND" || name === "OR") {
    let acc = name === "AND" ? 1 : 0;
    for (const a of args) {
      const v = evalNode(a, env);
      if (v === null) return null;
      if (name === "AND") acc = acc && v !== 0 ? 1 : 0;
      else acc = acc || v !== 0 ? 1 : 0;
    }
    return acc;
  }
  const vs = args.map((a) => evalNode(a, env));
  if (vs.some((v) => v === null)) return null;
  const [x, y] = vs as number[];
  switch (name) {
    case "ABS": return fin(Math.abs(x!));
    case "SQRT": return x! < 0 ? null : fin(Math.sqrt(x!));
    case "SQR": return fin(x! * x!);
    case "INT": return fin(Math.trunc(x!));
    case "SIGN": return fin(Math.sign(x!));
    case "EXP": return fin(Math.exp(x!));
    case "LN": return x! > 0 ? fin(Math.log(x!)) : null;
    case "LOG": case "LOG10": return x! > 0 ? fin(Math.log10(x!)) : null;
    case "LOG2": return x! > 0 ? fin(Math.log2(x!)) : null;
    case "SIN": return fin(Math.sin(x!));
    case "COS": return fin(Math.cos(x!));
    case "TAN": return fin(Math.tan(x!));
    case "ASIN": return x! >= -1 && x! <= 1 ? fin(Math.asin(x!)) : null;
    case "ACOS": return x! >= -1 && x! <= 1 ? fin(Math.acos(x!)) : null;
    case "ATAN": return fin(Math.atan(x!));
    case "ATAN2": return fin(Math.atan2(x!, y!));
    case "RAD": return fin(x! * DEG);
    case "DEG": return fin(x! / DEG);
    case "NOT": return x! === 0 ? 1 : 0;
    case "ROUND": { const f = Math.pow(10, Math.round(y!)); return fin(Math.round(x! * f) / f); }
    case "MOD": return y! === 0 ? null : fin(x! - Math.floor(x! / y!) * y!);
    case "POW": return fin(Math.pow(x!, y!));
    default: return null;
  }
}

/** A compiled formula: parse once, evaluate per row. */
export type CompiledFormula = { ok: true; eval: (env: FormulaEnv) => number | null } | { ok: false; error: string };

/**
 * Parse + validate a formula string. `ok:false` carries a human-readable error.
 *
 * Pass `columnCount` (the table's column count) to also reject a reference to a column that does
 * not exist ("A+D" on a three-column table). Evaluation is deliberately lenient — a missing column
 * reads as blank — so without this check a mistyped letter would silently blank the whole column and
 * look like a data problem, not a formula problem. The column-menu editor passes it; recompute
 * does not (an existing formula keeps computing leniently while the user edits the table).
 */
export function compileFormula(src: string, columnCount?: number): CompiledFormula {
  if (!src.trim()) return { ok: false, error: "Empty formula" };
  const toks = tokenize(src);
  if ("error" in toks) return { ok: false, error: toks.error };
  if (toks.length === 0) return { ok: false, error: "Empty formula" };
  if (columnCount != null) {
    const bad = toks.find((t): t is { t: "col"; i: number } => t.t === "col" && t.i >= columnCount);
    if (bad) {
      const letter = String.fromCharCode(65 + bad.i);
      const last = String.fromCharCode(65 + Math.max(0, columnCount - 1));
      return { ok: false, error: `Column ${letter} doesn't exist — this table has ${columnCount} column${columnCount === 1 ? "" : "s"} (A–${last})` };
    }
  }
  try {
    const ast = new Parser(toks).parse();
    return { ok: true, eval: (env) => evalNode(ast, env) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Invalid formula" };
  }
}

/**
 * Rewrite a formula's column-letter references through a column-index map (old index → new index,
 * or `null` if that column was deleted). The letters are positions (A = column 0), so a structural
 * column edit — insert / move / delete — must rewrite them or the formula silently starts reading a
 * different column: insert a column left of "A/B" and it computes blank; swap the two columns and it
 * inverts to "B/A". Only a standalone single letter is a reference; letters inside a longer name
 * (LOG, IF, MEAN, PI…) are left untouched.
 *
 * Returns the rewritten formula, or `null` when it cannot be safely remapped — a referenced column
 * was deleted, or would move past 'Z' (only 26 columns are addressable) — so the caller can keep the
 * original string unchanged (no worse than before the edit) rather than write a wrong reference.
 */
export function remapFormulaColumns(
  formula: string,
  mapIndex: (index: number) => number | null,
): string | null {
  let ok = true;
  const isWord = (ch: string | undefined): boolean => ch != null && /[A-Za-z0-9_]/.test(ch);
  const out = formula.replace(/[A-Za-z]/g, (letter: string, offset: number, src: string): string => {
    if (isWord(src[offset - 1]) || isWord(src[offset + 1])) return letter; // part of a name, not a ref
    const to = mapIndex(letter.toUpperCase().charCodeAt(0) - 65);
    if (to == null || to < 0 || to > 25) { ok = false; return letter; }
    return String.fromCharCode(65 + to);
  });
  return ok ? out : null;
}

/** A cell → a finite number, or null (blank / non-numeric). */
function num(v: CellValue | undefined): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "") { const n = Number(v); return Number.isFinite(n) ? n : null; }
  return null;
}

/**
 * Recompute every formula column's cells in place from the table's other columns.
 * A no-op when no column has a `formula`. Formula columns may reference earlier
 * formula columns; settling passes resolve such chains — a chain n deep needs n passes,
 * so the bound is the number of formula columns (+1 to confirm nothing moved). Passes
 * stop early as soon as one changes no cell, which is the common case. A circular
 * reference never settles and simply stops at the bound (its cells left as computed).
 * A fixed cap (e.g. 8 passes) would leave the last column of a deeper chain one pass stale
 * on every recompute.
 */
export function recomputeFormulas(table: DataTable): void {
  const formulaCols = table.columns.filter((c) => c.formula && c.formula.trim());
  if (formulaCols.length === 0) return;
  const compiled = new Map(formulaCols.map((c) => [c.id, compileFormula(c.formula!)]));
  const colIds = table.columns.map((c) => c.id);
  const maxPasses = formulaCols.length + 1;
  for (let pass = 0; pass < maxPasses; pass++) {
    // Per-column finite value arrays (for aggregates), refreshed each pass.
    const colVals = colIds.map((id) => {
      const out: number[] = [];
      for (const r of table.rows) { const n = num(r.cells[id]); if (n !== null) out.push(n); }
      return out;
    });
    let changed = false;
    for (const col of formulaCols) {
      const c = compiled.get(col.id)!;
      for (const r of table.rows) {
        const next = c.ok ? c.eval({ row: colIds.map((id) => num(r.cells[id])), colVals }) : null;
        if (r.cells[col.id] !== next) { r.cells[col.id] = next; changed = true; }
      }
    }
    if (!changed) break; // settled — every dependent already read the freshest values
  }
}
