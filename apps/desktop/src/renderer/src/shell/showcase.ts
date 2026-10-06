/**
 * The gallery's rich cards — the figures that show what MadY draws that a spreadsheet cannot.
 *
 * Most replace the plain card of their kind (same key, so the New-graph "sample data" and every
 * by-kind test still find it). The split heatmap (`heatmapsplit`) and the cards in
 * `ADDED_CARD_KEYS` are added beside the plain ones. They are filed under their kind's own family
 * by `GALLERY_ORDER`.
 *
 * Every card is one datasheet + one plot, drawn by the ordinary builders from data + config —
 * there is no engine behind a card, so nothing here is "computed" except what the fixture
 * itself computes directly (a Kaplan–Meier estimate from its own event list, a 4PL curve from
 * its own parameters). Data are generated from a fixed seed so a card never changes between
 * renders.
 */
import { planSignificanceBrackets } from "@mady/core";
import type { CellValue, ColumnRole, DataTable, Plot, PlotFit, PlotKind, SurvivalAtRisk, SurvivalCurve, TableKind } from "@mady/core";

interface Col { id: string; name: string; role?: ColumnRole; group?: string }

function tbl(id: string, cols: Col[], rows: CellValue[][], kind: TableKind): DataTable {
  return {
    id, kind, name: id,
    columns: cols.map((c) => ({ id: c.id, name: c.name, ...(c.role ? { role: c.role } : {}), ...(c.group ? { group: c.group } : {}) })),
    rows: rows.map((r, i) => ({ id: `${id}-r${i}`, cells: Object.fromEntries(cols.map((c, j) => [c.id, r[j] ?? null])) })),
  };
}
function plt(id: string, tableId: string, kind: PlotKind, patch: Partial<Plot> = {}): Plot {
  return { id, name: id, source: tableId, status: "ok", styleOverrides: {}, kind, ...patch };
}

/** Deterministic pseudo-random stream (mulberry32) — the same card every render. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** Standard normal via Box–Muller on a seeded stream. */
function gauss(r: () => number): number {
  let u = 0, v = 0;
  while (u === 0) u = r();
  while (v === 0) v = r();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
const r2 = (x: number): number => Math.round(x * 100) / 100;
const r3 = (x: number): number => Math.round(x * 1000) / 1000;

export interface RichCard { key: string; title: string; note: string; table: DataTable; plot: Plot }

// ── 1 · Clustered + split heatmap with annotation strips ─────────────────────────────────────
function heatmapCard(): RichCard {
  const r = rng(11);
  const blocks = [["Control", 4], ["Drug A", 4], ["Drug B", 4]] as const;
  const samples: Col[] = [];
  const treatment: Record<string, string> = {};
  blocks.forEach(([name, n], bi) => {
    for (let i = 0; i < n; i++) {
      const id = `s${bi}${i}`;
      samples.push({ id, name: `${name === "Control" ? "C" : name.replace("Drug ", "")}${i + 1}`, role: "y" });
      treatment[id] = name;
    }
  });
  const pathways = ["Inflammation", "Cell cycle", "Metabolism"];
  const genes = ["IL6", "TNF", "CXCL8", "NFKB1", "IL1B", "CCL2", "STAT3", "SOCS3",
    "CCNB1", "CDK1", "MKI67", "TOP2A", "PLK1", "AURKA", "BUB1", "CCNA2",
    "PPARG", "ACADM", "CPT1A", "HMGCS2", "PDK4", "FABP4", "LPL", "ACOX1"];
  const rows: CellValue[][] = genes.map((g, gi) => {
    const cluster = Math.floor(gi / 8);
    const cells: CellValue[] = [g, pathways[cluster]!];
    samples.forEach((s) => {
      const b = blocks.findIndex(([n]) => n === treatment[s.id]);
      // each pathway is UP in one treatment block, mildly down in another
      const mu = cluster === b ? 1.6 : cluster === (b + 1) % 3 ? -0.9 : 0;
      cells.push(r2(mu + 0.45 * gauss(r)));
    });
    return cells;
  });
  const table = tbl("g-hmsplit", [{ id: "g", name: "Gene", role: "x" }, { id: "pw", name: "Pathway" }, ...samples], rows, "grouped");
  return {
    key: "heatmapsplit", title: "Heatmap — clustered, split, annotated",
    note: "24 genes × 12 samples, z-scored expression. Both axes clustered (dendrograms), the tree cut into 3 blocks each way, a Pathway strip on the rows and a Treatment strip on the columns.",
    table,
    plot: plt("p-hmsplit", table.id, "heatmap", {
      name: "Expression — three treatments, three programmes",
      figureWidth: 760, figureHeight: 640,
      heatmap: {
        labelFont: { size: 13 },
        cluster: "both", showDendrogram: true, rowSplitK: 3, colSplitK: 3, splitStyle: "gap",
        rowTracks: [{ column: "pw", name: "Pathway" }],
        colTracks: [{ name: "Treatment", values: treatment }],
        colorbarTitle: "z-score",
      },
    }),
  };
}

// ── 2 · Volcano with the zone key and named hits ─────────────────────────────────────────────
function volcanoCard(): RichCard {
  const r = rng(22);
  const hits: [string, number, number][] = [
    ["IL6", 3.4, 7.8], ["CXCL8", 2.9, 6.1], ["TNF", 2.2, 5.2], ["CCL2", 1.8, 4.4], ["SOCS3", 2.6, 3.9],
    ["PPARG", -2.7, 6.6], ["FABP4", -3.3, 5.5], ["CPT1A", -1.9, 4.1], ["ACADM", -2.1, 3.3], ["LPL", -1.5, 2.6],
  ];
  const rows: CellValue[][] = [];
  for (let i = 0; i < 260; i++) {
    const fc = 0.55 * gauss(r);
    // −log10 p loosely tied to |fc|, kept under the threshold so these stay "ns"
    const lp = Math.min(1.25, Math.abs(fc) * 1.2 + 0.7 * r());
    rows.push([r3(fc), r3(lp), ""]);
  }
  for (let i = 0; i < 26; i++) {
    // significant but unnamed (p clears the line, fold-change modest)
    const sign = r() < 0.5 ? -1 : 1;
    rows.push([r3(sign * (1.05 + 0.9 * r())), r3(1.4 + 2.2 * r()), ""]);
  }
  hits.forEach(([g, fc, lp]) => rows.push([fc, lp, g]));
  const table = tbl("g-volcano", [
    { id: "fc", name: "log2 fold-change", role: "x" }, { id: "p", name: "-log10 p", role: "y" }, { id: "gene", name: "Gene" },
  ], rows, "xy");
  return {
    key: "volcano", title: "Volcano",
    note: "296 genes; up / down / not-significant zones keyed in the legend, the ten strongest hits named beside their points (labels placed clear of neighbours).",
    table,
    plot: plt("p-volcano", table.id, "volcano", {
      name: "Treated vs control — differential expression",
      figureWidth: 700, figureHeight: 520,
      seriesStyles: { p: { pointLabels: "col", pointLabelColumn: "gene" } },
    }),
  };
}

// ── 3 · Kaplan–Meier with censor marks and the number-at-risk table ──────────────────────────
/** Kaplan–Meier estimate with Greenwood 95% CI, computed from the fixture's own event list. */
function kaplanMeier(label: string, times: number[], events: number[]): SurvivalCurve {
  const order = times.map((_, i) => i).sort((a, b) => times[a]! - times[b]!);
  const outT = [0], outS = [1], lo = [1], hi = [1];
  const censor: number[] = [];
  let s = 1, atRisk = times.length, gw = 0;
  for (let k = 0; k < order.length;) {
    const t = times[order[k]!]!;
    let d = 0, n = atRisk, c = 0;
    while (k < order.length && times[order[k]!] === t) { if (events[order[k]!]) d++; else c++; k++; }
    if (d > 0) {
      s *= 1 - d / n;
      gw += d / (n * (n - d));
      const se = s * Math.sqrt(gw);
      outT.push(t); outS.push(r3(s)); lo.push(r3(Math.max(0, s - 1.96 * se))); hi.push(r3(Math.min(1, s + 1.96 * se)));
    }
    if (c > 0) censor.push(t);
    atRisk -= d + c;
  }
  return { label, times: outT, surv: outS, lower: lo, upper: hi, censor };
}
function survivalCard(): RichCard {
  const r = rng(33);
  const arms = [["Placebo", 0.075], ["Standard", 0.045], ["Combination", 0.026]] as const;
  const per = 48;
  const subjects: { arm: number; t: number; e: number }[] = [];
  arms.forEach(([, hz], ai) => {
    for (let i = 0; i < per; i++) {
      const event = -Math.log(1 - r()) / hz; // exponential event time
      const cens = 6 + 36 * r(); // uniform administrative censoring ≤ 42 months
      const t = Math.min(event, cens, 42);
      subjects.push({ arm: ai, t: r2(t), e: event <= Math.min(cens, 42) ? 1 : 0 });
    }
  });
  const curves = arms.map(([name], ai) => {
    const mine = subjects.filter((s) => s.arm === ai);
    return kaplanMeier(name, mine.map((s) => s.t), mine.map((s) => s.e));
  });
  const atTimes = [0, 6, 12, 18, 24, 30, 36, 42];
  const atRisk: SurvivalAtRisk = {
    times: atTimes,
    rows: arms.map(([name], ai) => ({
      label: name,
      atRisk: atTimes.map((t) => subjects.filter((s) => s.arm === ai && s.t >= t).length),
    })),
  };
  const rows: CellValue[][] = subjects.map((s) => [s.t, ...arms.map((_, ai) => (ai === s.arm ? s.e : null))]);
  const table = tbl("t-surv", [
    { id: "t", name: "Months", role: "x" }, { id: "a0", name: "Placebo" }, { id: "a1", name: "Standard" }, { id: "a2", name: "Combination" },
  ], rows, "survival");
  return {
    key: "survival", title: "Survival (Kaplan-Meier)",
    note: "144 subjects in three arms; the estimate, its 95% band and every censoring tick come from the sheet's own event list, and the risk table under the axis counts who is still being followed.",
    table,
    plot: plt("p-surv", table.id, "survival", {
      name: "Overall survival by treatment arm",
      figureWidth: 720, figureHeight: 560,
      survival: curves, survivalAtRisk: atRisk, survivalShowAtRisk: true, survivalShowCI: true,
      xAxis: { title: "Months from randomisation" }, yAxis: { title: "Survival probability" },
    }),
  };
}

// ── 4 · Raincloud with significance brackets ─────────────────────────────────────────────────
function raincloudCard(): RichCard {
  const r = rng(88);
  const groups: [string, number, number][] = [["Control", 48, 9], ["Low dose", 55, 10], ["High dose", 71, 12], ["Combination", 84, 9]];
  const n = 30;
  const rows: CellValue[][] = [];
  for (let i = 0; i < n; i++) rows.push(groups.map(([, mu, sd]) => r2(mu + sd * gauss(r))));
  const table = tbl("g-rain", groups.map(([g], i) => ({ id: `g${i}`, name: g, role: "y" as const })), rows, "column");
  const vals = rows.flat().map(Number);
  const range = { min: Math.min(...vals), max: Math.max(...vals), span: Math.max(...vals) - Math.min(...vals) };
  const brackets = planSignificanceBrackets({
    terms: [
      { term: "Control vs Low dose", p: 0.031 },
      { term: "Control vs High dose", p: 0.0004 },
      { term: "Control vs Combination", p: 0.00001 },
    ],
    categoryIndex: new Map(groups.map(([g], i) => [g, i + 1])),
    range, control: "Control",
  }).map((b, i) => ({
    id: `p-raincloud-sig${i + 1}`, kind: "bracket" as const, from: b.from, to: b.to, bracketY: b.bracketY, plannedY: true, p: b.p, role: "significance" as const,
  }));
  return {
    key: "raincloud", title: "Raincloud",
    note: "Four groups of 30: half-violin, box and every raw point side by side, each treatment tested against Control with the brackets stacked clear of the data.",
    table,
    plot: plt("p-raincloud", table.id, "raincloud", {
      name: "Response by treatment — every observation shown",
      figureWidth: 720, figureHeight: 520,
      annotations: brackets, significanceControl: "Control",
      xAxis: { title: "Treatment" }, yAxis: { title: "Response (a.u.)" },
    }),
  };
}

// ── 5 · Dose–response 4PL with the EC50 marker ───────────────────────────────────────────────
function fourPL(x: number, bottom: number, top: number, ec50: number, hill: number): number {
  return bottom + (top - bottom) / (1 + Math.pow(ec50 / x, hill));
}
function doseResponseCard(): RichCard {
  const r = rng(99);
  const doses = [0.01, 0.03, 0.1, 0.3, 1, 3, 10, 30, 100, 300, 1000];
  const drugs: [string, number, number, number, number][] = [["Compound A", 4, 96, 2.8, 1.15], ["Compound B", 6, 88, 41, 0.95]];
  const rows: CellValue[][] = doses.map((d) => [d, ...drugs.map(([, b, t, e, h]) => r2(fourPL(d, b, t, e, h) + 3.5 * gauss(r)))]);
  const table = tbl("g-xy", [{ id: "x", name: "Concentration (µM)", role: "x" }, { id: "ya", name: "Compound A", role: "y" }, { id: "yb", name: "Compound B", role: "y" }], rows, "xy");
  const grid: number[] = [];
  for (let e = -2.3; e <= 3.3; e += 0.05) grid.push(Math.pow(10, e));
  const fits: PlotFit[] = drugs.map(([name, b, t, e, h]) => ({
    label: `${name} (4PL)`,
    points: grid.map((x) => [x, r2(fourPL(x, b, t, e, h))] as [number, number]),
    // No parameter block (Hill slope / Top / Bottom) on this card — with two fits, two
    // four-line blocks plus the two routed EC50 labels would crowd the axes. The EC50 crosshair
    // and its label say the one thing the card is about. `fits-labels-render.test` keeps its own
    // fixture for the block drawing.
    marker: { x: e, y: r2((t + b) / 2), label: `EC50 = ${e} µM` },
  }));
  return {
    key: "xy", title: "XY (points + fitted curve)",
    note: "Two compounds over five decades of concentration; each fitted curve drawn from its parameters, with the EC50 dropped to the axis and labelled.",
    table,
    plot: plt("p-xy", table.id, "xy", {
      name: "Potency — two compounds",
      figureWidth: 720, figureHeight: 500,
      fits, seriesStyles: { ya: { plotAs: "points" }, yb: { plotAs: "points" } },
      // The potency labels need no hand placement: with two fits the builder routes both
      // "EC50 = …" labels clear of the crosshairs, the curves and each other (`potency-labels.test.ts`).
      xAxis: { scale: "log10", title: "Concentration (µM)" }, yAxis: { title: "Response (% of max)" },
    }),
  };
}

// ── 6 · Oncoprint over 40 samples ────────────────────────────────────────────────────────────
function oncoprintCard(): RichCard {
  const r = rng(1010);
  const genes: [string, number, string[]][] = [
    ["TP53", 0.62, ["Missense", "Truncating", "Deep deletion"]],
    ["KRAS", 0.34, ["Missense", "Amplification"]],
    ["EGFR", 0.22, ["Amplification", "Missense"]],
    ["BRAF", 0.11, ["Missense"]],
    ["PIK3CA", 0.28, ["Missense", "Amplification"]],
    ["PTEN", 0.19, ["Deep deletion", "Truncating"]],
    ["CDKN2A", 0.31, ["Deep deletion", "Truncating"]],
    ["ALK", 0.07, ["Fusion"]],
    ["MYC", 0.16, ["Amplification"]],
    ["STK11", 0.14, ["Truncating", "Missense"]],
  ];
  const rows: CellValue[][] = [];
  for (let s = 1; s <= 40; s++) {
    const id = `P${String(s).padStart(2, "0")}`;
    let driver = false; // KRAS / EGFR / BRAF / ALK are mutually exclusive drivers
    for (const [g, f, kinds] of genes) {
      const exclusive = g === "KRAS" || g === "EGFR" || g === "BRAF" || g === "ALK";
      if (exclusive && driver) continue;
      if (r() < f) {
        rows.push([id, g, kinds[Math.floor(r() * kinds.length)]!]);
        if (exclusive) driver = true;
      }
    }
    if (!rows.some((row) => row[0] === id)) rows.push([id, "TP53", "Missense"]);
  }
  const table = tbl("g-onco", [{ id: "smp", name: "Sample", role: "x" }, { id: "gene", name: "Gene", role: "y" }, { id: "alt", name: "Alteration", role: "y" }], rows, "alterations");
  return {
    key: "oncoprint", title: "Oncoprint",
    note: "Genes ordered by how often they are altered, samples sorted into the mutual-exclusivity staircase (KRAS, EGFR, BRAF and ALK never co-occur), each cell coloured by alteration type.",
    table,
    plot: plt("p-onco", table.id, "oncoprint", { name: "Alteration landscape — 40 tumours", figureWidth: 900, figureHeight: 440 }),
  };
}

// ── 7 · Chord diagram of a signalling network ────────────────────────────────────────────────
function chordCard(): RichCard {
  const edges: [string, string, number][] = [
    ["Macrophage", "T cell", 42], ["Macrophage", "Fibroblast", 28], ["Macrophage", "Endothelial", 19],
    ["T cell", "B cell", 33], ["T cell", "Tumour", 51], ["T cell", "Macrophage", 24],
    ["Fibroblast", "Tumour", 47], ["Fibroblast", "Endothelial", 22], ["Fibroblast", "Macrophage", 15],
    ["Tumour", "Macrophage", 38], ["Tumour", "Endothelial", 44], ["Tumour", "Fibroblast", 29],
    ["Endothelial", "T cell", 17], ["Endothelial", "Tumour", 21],
    ["B cell", "T cell", 26], ["B cell", "Macrophage", 12],
    ["NK cell", "Tumour", 31], ["NK cell", "Macrophage", 14], ["Tumour", "NK cell", 9],
  ];
  const table = tbl("g-chord", [{ id: "from", name: "Sender", role: "x" }, { id: "to", name: "Receiver", role: "y" }, { id: "n", name: "Interactions", role: "y" }], edges, "edgelist");
  return {
    key: "chord", title: "Chord / circos",
    note: "Seven cell types around a ring; each ribbon a ligand–receptor interaction count from sender to receiver, coloured by sender, each arc sized by its total traffic.",
    table,
    plot: plt("p-chord", table.id, "chord", { name: "Tumour microenvironment — who signals to whom", figureWidth: 700, figureHeight: 620 }),
  };
}

// ── 8 · Ridgeline horizon fold ───────────────────────────────────────────────────────────────
function ridgelineCard(): RichCard {
  const r = rng(1313);
  // Note: genus names ≤ 13 characters: at the gallery's narrow 360-px preview the row labels plus the
  // band key must still leave room to draw (gallery.test "no kind collapses on a narrow figure").
  const taxa = ["Bacteroides", "Prevotella", "Roseburia", "Blautia", "Clostridium", "Akkermansia", "Escherichia", "Lactobacillus"];
  const weeks = 26;
  const rows: CellValue[][] = [];
  for (let w = 0; w < weeks; w++) {
    const antibiotic = w >= 8 && w < 12;
    rows.push([w, ...taxa.map((_t, ti) => {
      const base = 18 - ti * 1.8;
      const season = 4 * Math.sin((w / weeks) * Math.PI * 2 + ti);
      let v = base + season + 1.5 * gauss(r);
      if (antibiotic) v = ti === 6 ? v + 22 : v * 0.35; // Escherichia blooms, the rest crash
      if (w >= 12 && w < 16 && ti !== 6) v *= 0.55 + 0.11 * (w - 12); // recovery
      return r2(Math.max(0.2, v));
    })]);
  }
  const table = tbl("g-ridge", [{ id: "w", name: "Week", role: "x" }, ...taxa.map((t, i) => ({ id: `t${i}`, name: t, role: "y" as const }))], rows, "xy");
  return {
    key: "ridgeline", title: "Ridgeline / horizon fold",
    note: "Eight taxa over 26 weeks, each row its abundance relative to its own median, folded into four shaded bands: the antibiotic course at weeks 8–11 empties every row but Escherichia.",
    table,
    plot: plt("p-ridge", table.id, "ridgeline", {
      name: "Gut community through an antibiotic course",
      figureWidth: 760, figureHeight: 520,
      ridgeline: { source: "profile", bands: 4, origin: "median", overlap: 1 },
      xAxis: { title: "Week" }, yAxis: { title: "Taxon" },
    }),
  };
}

// ── 9 · Alluvial of patient flow ─────────────────────────────────────────────────────────────
function alluvialCard(): RichCard {
  const r = rng(1414);
  const pick = <T,>(xs: [T, number][]): T => { let u = r(); for (const [v, p] of xs) { u -= p; if (u <= 0) return v; } return xs[xs.length - 1]![0]; };
  const rows: CellValue[][] = [];
  for (let i = 0; i < 120; i++) {
    const stage = pick<string>([["Stage I", 0.35], ["Stage II", 0.4], ["Stage III", 0.25]]);
    const tx = stage === "Stage I" ? pick<string>([["Surgery", 0.8], ["Chemotherapy", 0.2]]) : stage === "Stage II" ? pick<string>([["Surgery", 0.45], ["Chemotherapy", 0.4], ["Immunotherapy", 0.15]]) : pick<string>([["Chemotherapy", 0.5], ["Immunotherapy", 0.4], ["Surgery", 0.1]]);
    const good = stage === "Stage I" ? 0.85 : stage === "Stage II" ? 0.6 : tx === "Immunotherapy" ? 0.5 : 0.3;
    const resp = pick<string>([["Complete response", good * 0.6], ["Partial response", good * 0.4], ["Progression", 1 - good]]);
    const out = resp === "Progression" ? pick<string>([["Alive", 0.35], ["Deceased", 0.65]]) : pick<string>([["Alive", 0.92], ["Deceased", 0.08]]);
    rows.push([stage, tx, resp, out]);
  }
  const table = tbl("g-alluvial", [{ id: "st", name: "Stage" }, { id: "tx", name: "Treatment" }, { id: "rs", name: "Response" }, { id: "ou", name: "Outcome" }], rows, "grouped");
  return {
    key: "alluvial", title: "Alluvial / parallel sets",
    note: "Stage → treatment → response → outcome; every ribbon is a set of patients who took the same path, so where the flows thin and where they split is the story.",
    table,
    plot: plt("p-alluvial", table.id, "alluvial", { name: "Patient journey — stage to outcome", figureWidth: 820, figureHeight: 520 }),
  };
}

// ── 10 · Sunburst of a three-level taxonomy ──────────────────────────────────────────────────
function sunburstCard(): RichCard {
  const rows: CellValue[][] = [
    ["Bacteria", "Firmicutes", "Clostridia", 320, 48], ["Bacteria", "Firmicutes", "Bacilli", 140, 22], ["Bacteria", "Firmicutes", "Negativicutes", 45, 9],
    ["Bacteria", "Bacteroidetes", "Bacteroidia", 410, 31], ["Bacteria", "Bacteroidetes", "Flavobacteriia", 60, 11],
    ["Bacteria", "Proteobacteria", "Gammaproteobacteria", 95, 27], ["Bacteria", "Proteobacteria", "Alphaproteobacteria", 40, 14], ["Bacteria", "Proteobacteria", "Deltaproteobacteria", 25, 8],
    ["Bacteria", "Actinobacteria", "Actinomycetia", 85, 19], ["Bacteria", "Actinobacteria", "Coriobacteriia", 55, 7],
    ["Bacteria", "Verrucomicrobia", "Verrucomicrobiae", 70, 3],
    ["Archaea", "Euryarchaeota", "Methanobacteria", 38, 6], ["Archaea", "Euryarchaeota", "Halobacteria", 9, 4], ["Archaea", "Thaumarchaeota", "Nitrososphaeria", 14, 2],
    ["Eukaryota", "Ascomycota", "Saccharomycetes", 30, 12], ["Eukaryota", "Ascomycota", "Eurotiomycetes", 12, 5], ["Eukaryota", "Basidiomycota", "Agaricomycetes", 16, 6],
  ];
  const table = tbl("g-sunburst", [{ id: "d", name: "Domain" }, { id: "p", name: "Phylum" }, { id: "c", name: "Class" }, { id: "n", name: "Reads (k)", role: "y" }, { id: "g", name: "Genera", role: "y" }], rows, "multivariable");
  // Two numeric variables (Reads, Genera): the multivariable format needs ≥2, and the sunburst
  // sizes its leaves by the first one.
  return {
    key: "sunburst", title: "Sunburst",
    note: "Domain → phylum → class as three rings, each arc sized by its read count and shaded from its domain's hue outward.",
    table,
    plot: plt("p-sunburst", table.id, "sunburst", { name: "Community composition — domain to class", figureWidth: 640, figureHeight: 620 }),
  };
}

// ── 11 · Swimmer plot of a 20-patient cohort ─────────────────────────────────────────────────
function swimmerCard(): RichCard {
  const r = rng(1616);
  const rows: CellValue[][] = [];
  for (let i = 1; i <= 20; i++) {
    const start = r() < 0.7 ? 0 : Math.round(r() * 3);
    const dur = Math.round(4 + 32 * Math.pow(r(), 0.8));
    const end = start + dur;
    const responded = r() < 0.6;
    const rs = responded ? start + Math.round(2 + 4 * r()) : "";
    const re = responded ? Math.min(end, (rs as number) + Math.round(3 + (end - (rs as number)) * r())) : "";
    const ongoing = end >= 30 && r() < 0.8 ? 1 : "";
    const progression = !ongoing && r() < 0.65 ? Math.max(start + 1, end - Math.round(1 + 4 * r())) : "";
    const death = !ongoing && progression !== "" && r() < 0.4 ? end : "";
    rows.push([`Pt ${String(i).padStart(2, "0")}`, start, end, rs, re, ongoing, death, progression]);
  }
  rows.sort((a, b) => (Number(b[2]) - Number(b[1])) - (Number(a[2]) - Number(a[1])));
  const table = tbl("g-swim", [
    { id: "subj", name: "Patient", role: "x" }, { id: "s", name: "Start", role: "y" }, { id: "e", name: "End", role: "y" },
    { id: "rs", name: "Response start", role: "y" }, { id: "re", name: "Response end", role: "y" },
    { id: "on", name: "Ongoing", role: "y" }, { id: "d", name: "Death", role: "y" }, { id: "pg", name: "Progression", role: "y" },
  ], rows, "timeline");
  return {
    key: "swimmer", title: "Swimmer plot",
    note: "One lane per patient, longest first: time on therapy, the response interval inside the bar, an arrow for those still on treatment, and progression / death glyphs.",
    table,
    plot: plt("p-swim", table.id, "swimmer", { name: "Time on treatment — phase II cohort", figureWidth: 760, figureHeight: 620, xAxis: { title: "Months on treatment" }, showValues: true }),
  };
}


// ── Cards added beside the plain ones ──────────────────────────────────────────────────────
const r1 = (x: number): number => Math.round(x * 10) / 10;

// Ranked dots against a dashed reference line.
function rankedDots(): RichCard {
  const values = [95, 94, 93, 90, 90, 86, 86, 85, 85, 84, 84, 84, 84, 81, 81, 80, 78, 77, 76, 76, 75, 73, 68, 62, 47];
  const labs: [string, number][] = values.map((v, i) => [`Lab ${String.fromCharCode(65 + i)}`, v]);
  const table = tbl("c-dots", [{ id: "x", name: "Laboratory", role: "x" }, { id: "ft", name: "Recovery (%)", role: "y" }], labs.map(([p, v]) => [p, v]), "column");
  const REF = 78;
  const pointStyles = Object.fromEntries(labs.map(([, v], i) => [`ft:c-dots-r${i}`, { color: v >= REF ? "#1a9e5c" : "#d0342c", pointColor: v >= REF ? "#1a9e5c" : "#d0342c" }]));
  return {
    key: "rankeddots", title: "Ranked dots vs a reference",
    note: "One value per name, sorted, drawn as dots on a horizontal bar chart; every dot carries its value and is coloured by which side of the dashed reference it falls.",
    table,
    plot: plt("p-cand-dots", table.id, "bar", {
      name: "Assay recovery by laboratory — target 78%", figureWidth: 640, figureHeight: 620,
      barOrientation: "horizontal", barSort: "desc", showBarPoints: false, showValues: true,
      seriesStyles: { ft: { plotAs: "points", symbolSize: 9, filled: true, pointLabels: "y", pointLabelColor: "#374151" } }, pointStyles,
      // The line carries no label of its own: at the top of the column it would collide with the
      // 95% dot, so the name sits as a text annotation in the empty lower-right.
      annotations: [
        { id: "c-dots-ref", kind: "hline", value: REF, dash: "dashed", color: "#6b7280" },
        { id: "c-dots-reft", kind: "text", label: "target 78%", x: 0.3, y: 0.55, color: "#6b7280" },
      ],
      legend: { show: false }, xAxis: { title: "Laboratory" }, yAxis: { title: "Recovery (%)" },
    }),
  };
}

// Stream graph with event markers.
function stream(): RichCard {
  const r = rng(21);
  const t: number[] = []; for (let i = 0; i <= 40; i++) t.push(i);
  const lineages = ["Bacteroides", "Firmicutes A", "Firmicutes B", "Proteobacteria", "Actinobacteria", "Verrucomicrobia"];
  const shape = (k: number, x: number): number => {
    const c = [8, 18, 26, 34, 12, 30][k]!, w = [14, 9, 8, 7, 20, 6][k]!, a = [30, 22, 18, 26, 12, 16][k]!;
    return Math.max(0.5, a * Math.exp(-((x - c) ** 2) / (2 * w * w)) + 2 + 1.2 * gauss(r));
  };
  const rows: CellValue[][] = t.map((x) => [x, ...lineages.map((_, k) => r1(shape(k, x)))]);
  const table = tbl("c-stream", [{ id: "x", name: "Time (weeks)", role: "x" }, ...lineages.map((l, k) => ({ id: `l${k}`, name: l, role: "y" as const }))], rows, "xy");
  const noDots = Object.fromEntries(lineages.map((_, k) => [`l${k}`, { symbol: "none" as const }]));
  const ev: [number, string][] = [[6, "Travel"], [15, "Diet change"], [26, "Disease onset"], [33, "Treatment"]];
  return {
    key: "stream", title: "Stream graph + event markers",
    note: "Six lineages stacked and centred on the time axis (the area chart's stream mode) with the four events that shaped them drawn as dashed markers.",
    table,
    plot: plt("p-cand-stream", table.id, "area", {
      name: "Frequency of microbial lineages", figureWidth: 760, figureHeight: 460,
      areaStack: "stream", seriesStyles: noDots,
      annotations: ev.map(([x, l], i) => ({ id: `c-stream-ev${i}`, kind: "vline" as const, value: x, label: l, dash: "dashed", color: "#374151" })),
      legend: { position: "right" }, xAxis: { title: "Time (weeks)" }, yAxis: { title: "Frequency" },
    }),
  };
}

// Stacked bars with the growth of the total as a line on a second axis.
function stackedTotal(): RichCard {
  const q = ["Q1", "Q2", "Q3", "Q4", "Q5", "Q6", "Q7", "Q8"];
  const a = [12, 14, 15, 18, 21, 22, 26, 28], b = [8, 9, 11, 10, 13, 15, 14, 17], c = [4, 5, 5, 7, 6, 8, 9, 11];
  const rows: CellValue[][] = q.map((n, i) => [n, a[i]!, b[i]!, c[i]!, i === 0 ? 0 : r1((a[i]! + b[i]! + c[i]!) / (a[i - 1]! + b[i - 1]! + c[i - 1]!) * 100 - 100)]);
  const table = tbl("c-stack", [{ id: "x", name: "Quarter", role: "x" }, { id: "a", name: "Product A", role: "y" }, { id: "b", name: "Product B", role: "y" }, { id: "c", name: "Product C", role: "y" }, { id: "g", name: "Growth (%)", role: "y" }], rows, "grouped");
  return {
    key: "stackline", title: "Stacked bars + line (2nd axis)",
    note: "Three products stacked per quarter, with the quarter-on-quarter growth of the total drawn as a line against a right-hand axis.",
    table,
    plot: plt("p-cand-stack", table.id, "bar", {
      name: "Revenue by product, and its growth", figureWidth: 700, figureHeight: 440,
      barLayout: "stacked", showBarPoints: false,
      seriesStyles: { g: { plotAs: "line", axis: "y2", symbol: "circle", color: "#111827", lineWidth: 2 } },
      yAxis: { title: "Revenue (M€)" }, y2Axis: { title: "Growth (%)" }, legend: { show: true },
    }),
  };
}

// Time course: replicate means with SD bands, a treatment window and a detection limit.
function timeCourse(): RichCard {
  const r = rng(13);
  const t = [0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24];
  const treated = (x: number) => (x < 6 ? 2 + 0.2 * x : x <= 14 ? 3 + 9 * (1 - Math.exp(-(x - 6) / 3)) : 3 + 9 * Math.exp(-(x - 14) / 4));
  const control = (x: number) => 2 + 0.25 * x;
  const rows: CellValue[][] = t.map((x) => [x, ...[0, 1, 2, 3].map(() => r2(treated(x) + 0.7 * gauss(r))), ...[0, 1, 2, 3].map(() => r2(control(x) + 0.5 * gauss(r)))]);
  const cols: Col[] = [{ id: "x", name: "Time (h)", role: "x" }, { id: "tr", name: "Treated", role: "y" }, { id: "tr2", name: "tr2", role: "y", group: "tr" }, { id: "tr3", name: "tr3", role: "y", group: "tr" }, { id: "tr4", name: "tr4", role: "y", group: "tr" },
    { id: "ct", name: "Control", role: "y" }, { id: "ct2", name: "ct2", role: "y", group: "ct" }, { id: "ct3", name: "ct3", role: "y", group: "ct" }, { id: "ct4", name: "ct4", role: "y", group: "ct" }];
  const table = tbl("c-tc", cols, rows, "xy");
  return {
    key: "timecourse", title: "Time course + bands, window, limit",
    note: "Two groups of four replicates as mean lines with SD bands, the treatment window shaded, the assay's detection limit dashed, and the series named at their ends.",
    table,
    plot: plt("p-cand-tc", table.id, "xy", {
      name: "Biomarker over 24 h", figureWidth: 700, figureHeight: 440,
      seriesStyles: { tr: { errorBars: "sd", errorDisplay: "band", connect: "cardinal" }, ct: { errorBars: "sd", errorDisplay: "band", connect: "cardinal" } },
      annotations: [
        { id: "c-tc-win", kind: "vband", bandLo: 6, bandHi: 14, fill: "#7c3aed", fillOpacity: 0.08, label: "Treatment" },
        { id: "c-tc-lod", kind: "hline", value: 2.5, label: "LOD", dash: "dashed", color: "#6b7280" },
      ],
      legend: { position: "direct" }, xAxis: { title: "Time (h)" }, yAxis: { title: "Concentration (ng/mL)" },
    }),
  };
}

// Bubble-grid heatmap.
function bubbleGrid(): RichCard {
  const r = rng(31);
  const genes = ["IL6", "TNF", "IFNG", "IL10", "CXCL8", "CCL2", "IL1B", "TGFB1", "IL2", "IL17A"];
  const conds = ["Rest", "LPS 1h", "LPS 6h", "LPS 24h", "IL-4", "IFN-γ"];
  const rows: CellValue[][] = genes.map((g, i) => [g, ...conds.map((_, j) => r2(3.5 * Math.sin(i * 0.9 + j * 1.3) + 1.5 * gauss(r)))]);
  const table = tbl("c-bub", [{ id: "g", name: "Gene", role: "x" }, ...conds.map((c, j) => ({ id: `c${j}`, name: c, role: "y" as const }))], rows, "grouped");
  return {
    key: "bubblegrid", title: "Bubble-grid heatmap",
    note: "The heatmap's cells drawn as discs — area for the size of the change, colour for its direction — the dot-plot that gene-expression figures use.",
    table,
    plot: plt("p-cand-bub", table.id, "heatmap", {
      name: "Cytokine expression (log2 FC)", figureWidth: 560, figureHeight: 520,
      heatmap: { cellShape: "bubble" },
    }),
  };
}


/** The rich cards (ten replacing plain cards, the split heatmap and five more added beside them), built fresh per call like `galleryItems()`. */
export function richCards(): RichCard[] {
  return [
    heatmapCard(), volcanoCard(), survivalCard(), raincloudCard(), doseResponseCard(), oncoprintCard(),
    chordCard(), ridgelineCard(), alluvialCard(), sunburstCard(), swimmerCard(),
    rankedDots(), stream(), stackedTotal(), timeCourse(), bubbleGrid(),
  ];
}
/** Cards added beside the plain ones, each a combination the plain card of its kind does not show. */
export const ADDED_CARD_KEYS: readonly string[] = ["rankeddots", "stream", "stackline", "timecourse", "bubblegrid"];
/** The other rich cards: the ten that replace a plain card under the same key, plus the split heatmap. */
export const RICH_CARD_KEYS: readonly string[] = ["volcano", "survival", "raincloud", "xy", "oncoprint", "chord", "ridgeline", "alluvial", "sunburst", "swimmer", "heatmapsplit"];
