import type { CellValue, Column, DataTable, Row } from "@mady/core";

/**
 * Test data for every chart type: each graph type is drawn again from reshaped data, with other numbers of groups
 * and replicates, and checked for layout faults.
 *
 * A gallery card is drawn from one hand-made table, so a layout bug that only shows with 7 groups, 1 replicate or a
 * 24-character group name never shows on it. `newDataVariants` reshapes each card's table into several others —
 * fewer / more groups, fewer / more replicates, fewer / more rows, new numbers, new (long) names — keeping what each
 * column means (an X stays an X, a 0/1 column stays 0/1, a proportion stays in (0, 1], a count stays whole). Seeded: the
 * same "new" data every run, so a failure can be reproduced and looked at.
 */

/** Kinds whose sheet has a fixed layout (each column has its own job): their columns are kept, only rows and numbers change. */
export const FIXED_LAYOUT_KINDS: ReadonlySet<string> = new Set([
  "funnel", "manhattan", "oncoprint", "qq", "scatter3d", "forest", "survival", "blandaltman", "ternary", "roc", "volcano",
  "network", "chord", "alluvial", "swimmer", "tracks", "pcascore", "pcaload", "pcabiplot", "triplot", "scree", "venn",
  "upset", "sunburst", "treemap", "dendrogram", "rose", "heatmap",
]);

/** One reshaped table and what was done to it, for the failure message. */
export interface DataVariant {
  label: string;
  table: DataTable;
  extraTables: DataTable[];
}

/** The shapes every card is redrawn in. */
export const VARIANTS: { label: string; rowFactor: number; seriesDelta: number; replicateDelta: number; longNames: boolean }[] = [
  { label: "fewer groups, fewer rows, fewer replicates", rowFactor: 0.6, seriesDelta: -1, replicateDelta: -1, longNames: false },
  { label: "more groups, more rows, more replicates", rowFactor: 1.8, seriesDelta: 2, replicateDelta: 2, longNames: false },
  { label: "same shape, new numbers, long names", rowFactor: 1, seriesDelta: 0, replicateDelta: 0, longNames: true },
];

const SHORT = ["Treated", "Wild type", "KO-2", "Placebo", "High dose", "Control", "Group B", "PA14", "Day 7", "Low dose", "Responders", "Site N"];
const LONG = ["Treated cohort (week 12)", "Wild type littermates", "Knockout KO-2 homozygous", "Placebo arm, blinded", "High dose 20 mg/kg i.p.", "Untreated control group", "Mutant ΔlasR PA14 strain", "Day 7 recovery samples"];
const PLACES = ["Liver", "Kidney", "Lung", "Spleen", "Heart", "Brain", "Skin", "Bone", "Gut", "Muscle", "Blood", "Retina", "Pancreas", "Thymus"];

/** A small seeded generator, so each card's variants are the same every run. */
function rng(seed: number): { u: () => number; g: () => number } {
  let s = seed >>> 0 || 1;
  const u = (): number => ((s = (Math.imul(s, 1103515245) + 12345) >>> 0) / 4294967296);
  const g = (): number => Math.sqrt(-2 * Math.log(u() + 1e-9)) * Math.cos(2 * Math.PI * u());
  return { u, g };
}

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
/** A data column: not the X, typed as numbers, and not a column of text (a label column often has no type set — a
 *  generator that counted it as data would delete a pie's only value column and copy its names as a "group", and
 *  both would show up as pie anomalies caused by the generator itself). */
const isData = (c: Column, rows: readonly Row[]): boolean => {
  if (c.role === "x" || (c.type ?? "number") !== "number") return false;
  const filled = rows.map((r) => r.cells[c.id]).filter((v) => v !== null && v !== undefined && String(v).trim() !== "");
  return filled.length === 0 || filled.some((v) => isNum(v) || Number.isFinite(Number(v)));
};

/** New numbers: an X keeps its value, 0/1 columns stay 0/1, proportions stay in (0, 1], counts stay whole. */
function renumber(t: DataTable, r: ReturnType<typeof rng>): DataTable {
  const kindOf = new Map<string, "keep" | "int" | "unit" | "real">();
  for (const c of t.columns) {
    const vs = t.rows.map((row) => row.cells[c.id]).filter(isNum);
    if (c.role === "x" || vs.length === 0 || vs.every((v) => v === 0 || v === 1)) kindOf.set(c.id, "keep");
    else if (vs.every((v) => v >= 0 && v <= 1)) kindOf.set(c.id, "unit");
    else if (vs.every((v) => Number.isInteger(v))) kindOf.set(c.id, "int");
    else kindOf.set(c.id, "real");
  }
  const rows = t.rows.map((row) => {
    const cells: Record<string, CellValue> = { ...row.cells };
    for (const [id, k] of kindOf) {
      const v = cells[id];
      if (!isNum(v) || k === "keep") continue;
      let nv = v * Math.max(0.2, 1 + 0.3 * r.g());
      if (k === "unit") nv = Math.min(1, Math.max(0.0005, nv));
      if (k === "int") nv = Math.round(nv);
      cells[id] = nv;
    }
    return { ...row, cells };
  });
  return { ...t, rows };
}

/** One card's table in a new shape. */
function reshape(t: DataTable, kind: string, v: (typeof VARIANTS)[number], r: ReturnType<typeof rng>, tag: string): DataTable {
  let cols: Column[] = t.columns.map((c) => ({ ...c }));
  let rows: Row[] = t.rows.map((row) => ({ ...row, cells: { ...row.cells } }));
  let uid = 0;
  const fresh = (p: string): string => `${tag}-${p}${uid++}`;
  const fixed = FIXED_LAYOUT_KINDS.has(kind);
  // A dataset = its lead data column + the replicate columns grouped under it.
  const leads = (): Column[] => cols.filter((c) => isData(c, rows) && (!c.group || c.group === c.id));
  const membersOf = (lead: Column): Column[] => cols.filter((c) => c.id === lead.id || c.group === lead.id);
  if (!fixed) {
    // Groups: drop the last dataset, or copy random ones (scaled, so they differ).
    if (v.seriesDelta < 0 && leads().length > 1) {
      const drop = new Set(membersOf(leads()[leads().length - 1]!).map((c) => c.id));
      cols = cols.filter((c) => !drop.has(c.id));
    }
    for (let k = 0; k < v.seriesDelta && leads().length > 0; k++) {
      const all = leads();
      const src = all[Math.floor(r.u() * all.length)]!;
      const map = new Map<string, string>();
      for (const c of membersOf(src)) map.set(c.id, fresh("c"));
      const lead = map.get(src.id)!;
      for (const c of membersOf(src)) cols.push({ ...c, id: map.get(c.id)!, ...(c.group ? { group: lead } : {}) });
      const f = 0.5 + r.u() * 1.2;
      for (const row of rows) for (const [o, n] of map) {
        const x = row.cells[o];
        row.cells[n] = isNum(x) ? (Number.isInteger(x) ? Math.round(x * f) : x * f) : (x ?? null);
      }
    }
    // Replicates: a dataset that already has replicate subcolumns loses one or gains copies (with scatter).
    for (const lead of leads()) {
      const mem = membersOf(lead);
      if (mem.length < 2) continue;
      if (v.replicateDelta < 0) {
        const last = mem[mem.length - 1]!;
        cols = cols.filter((c) => c.id !== last.id);
      } else {
        for (let k = 0; k < v.replicateDelta; k++) {
          const src = mem[Math.floor(r.u() * mem.length)]!;
          const id = fresh("rep");
          cols.push({ ...src, id, group: lead.id, name: `${lead.name} ${mem.length + k + 1}` });
          for (const row of rows) {
            const x = row.cells[src.id];
            row.cells[id] = isNum(x) ? (Number.isInteger(x) ? Math.round(x * (1 + 0.15 * r.g())) : x * (1 + 0.15 * r.g())) : (x ?? null);
          }
        }
      }
    }
  }
  // Rows: fewer (keep the first ones) or more (copies of random rows; a numeric X continues its own spacing; unique
  // text labels get new names so categories stay distinct).
  const target = Math.max(3, Math.round(rows.length * v.rowFactor));
  if (target < rows.length) rows = rows.slice(0, target);
  const xCol = cols.find((c) => c.role === "x");
  const textCols = cols.filter((c) => c.type === "text" || c.type === "categorical" || rows.some((row) => typeof row.cells[c.id] === "string"));
  while (rows.length < target && rows.length > 0) {
    const src = rows[Math.floor(r.u() * rows.length)]!;
    const cells: Record<string, CellValue> = { ...src.cells };
    if (xCol && isNum(cells[xCol.id])) {
      const xs = rows.map((row) => row.cells[xCol.id]).filter(isNum).sort((a, b) => a - b);
      const step = xs.length > 1 ? (xs[xs.length - 1]! - xs[0]!) / (xs.length - 1) : 1;
      cells[xCol.id] = xs[xs.length - 1]! + (step || 1);
    }
    for (const c of textCols) {
      const vals = rows.map((row) => row.cells[c.id]);
      if (typeof cells[c.id] === "string" && new Set(vals).size === vals.length) cells[c.id] = `${PLACES[uid % PLACES.length]} ${uid++}`;
    }
    rows.push({ id: fresh("r"), cells });
  }
  // Names: every dataset lead gets a new name (long ones in the long-names variant) — replicate subcolumns keep theirs.
  if (!fixed) {
    let n = 0;
    const pool = v.longNames ? LONG : SHORT;
    cols = cols.map((c) => (isData(c, rows) && (!c.group || c.group === c.id) ? { ...c, name: pool[(n++ + tag.length) % pool.length]! } : c));
  }
  return renumber({ ...t, columns: cols, rows }, r);
}

/** Every variant of one gallery card's table(s). A variant whose reshaping breaks the sheet's own rules is skipped by
 *  the caller (it reports it) — the rest still run. */
export function newDataVariants(key: string, kind: string, table: DataTable, extraTables: DataTable[] = []): DataVariant[] {
  let h = 2166136261;
  for (const ch of key) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return VARIANTS.map((v, i) => {
    const r = rng((h >>> 0) + i * 7919);
    return {
      label: v.label,
      table: reshape(table, kind, v, r, `nd${i}`),
      extraTables: extraTables.map((t) => reshape(t, kind, { ...v, seriesDelta: 0, replicateDelta: 0 }, r, `nd${i}x`)),
    };
  });
}
