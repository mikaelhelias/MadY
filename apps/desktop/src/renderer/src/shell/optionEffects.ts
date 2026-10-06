/**
 * Option effects — does each option change the drawing, on each chart kind.
 *
 * Answers one question exhaustively, for every (option × chart kind): **does setting it change
 * the drawing?** Not "does a control exist", and not "does it write to the document" — the
 * control tests cover both, and both are satisfied by an option the builder ignores.
 *
 * Affordable because `buildPlotScene` is pure: set a field, rebuild, diff the scene.
 *
 * Three rules, each of which prevents a wrong answer:
 *
 *  1. **Enumerate by recursion, not by hand.** The options that matter most to a user — fonts,
 *     colours, thickness, symbols — are not top-level fields. They live one level down, in
 *     `fonts.<element>.<prop>`, in `SeriesStyle`, and in the 26 per-kind `*Style` interfaces. A
 *     flat pass over `Plot` sees 79 fields and misses thousands of real knobs.
 *  2. **A reference value must be proven, on any kind — not assumed, and not XY-only.** XY is the
 *     reference for the shared surface, but `barShape` cannot move an XY plot and is not thereby
 *     untestable. Taking XY as the sole reference would discard every kind-specific option.
 *  3. **"No value could be synthesised" is never "it works".** Those options are returned as
 *     untestable with their declared type, so they stay visible.
 */
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { DataTable, Plot } from "@mady/core";
import { referenceLinesFor, tableDatasets } from "@mady/core";
import { buildPlotScene } from "@mady/graphics";

const HERE = dirname(fileURLToPath(import.meta.url));
const CORE_SRC = join(HERE, "../../../../../../packages/core/src");
const MODEL = join(CORE_SRC, "model.ts");
const SRC = (): string => readFileSync(MODEL, "utf8");

/**
 * `export type X = "a" | "b" | …` from anywhere in `packages/core/src`, resolved once.
 *
 * Named unions. `candidates()` below reads a union directly only when it is written inline at
 * the field. Nearly every union in this model is a named type, and to the synthesiser a name is
 * just an identifier it cannot value — without this map, every option typed by a named union
 * would be filed "not measurable" and never tested, including `scale` and `format` on all four axes, `symbol`,
 * `fillType`, `lineDash`, `errorBars`, `connect`, `pattern` and `gradRamp` on both the series
 * and the per-point surface.
 *
 * Three types (`ClusterMetric`, `ClusterLinkage`, `CorrelationMethod`) live in `cluster.ts` and
 * `correlation.ts`, not `model.ts`, which is why this reads the whole directory.
 *
 * Note: comments are stripped before splitting: `PlotKind` and several others carry a doc comment
 * on each member, and leaving them in makes the union look like it contains non-literals.
 * Note: the literal-count guard below keeps `NodeId = string` and `number | null` out — an
 * invalid value for a field that wants a live column id renders nothing and would read as a
 * false "this option has no effect".
 */
let ALIAS_UNIONS: Map<string, string[]> | null = null;
export function stringUnions(): Map<string, string[]> {
  if (ALIAS_UNIONS) return ALIAS_UNIONS;
  const m = new Map<string, string[]>();
  for (const f of readdirSync(CORE_SRC)) {
    if (!f.endsWith(".ts") || f.endsWith(".test.ts")) continue;
    const src = readFileSync(join(CORE_SRC, f), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/\/\/[^\n]*/g, " ");
    for (const d of src.matchAll(/^export type ([A-Za-z0-9_]+)\s*=\s*([^;]*);/gm)) {
      const parts = d[2]!.split("|").map((p) => p.trim()).filter(Boolean);
      const lits = parts.filter((p) => /^"[^"]*"$/.test(p)).map((p) => p.slice(1, -1));
      // Template-literal members. Requiring every member to be a quoted literal keeps
      // `NodeId = string` out, but it also drops a union such as `GradRamp`, which has a
      // `custom:${string}` member (a reference to a user-built gradient); four live options —
      // heatmap.colormap, parallel.colorRamp, gradRamp, colorFromRamp — would silently leave the
      // measured set.
      // A union that is mostly literals is still drivable: use the literals it does have. A
      // template-literal member is a real member and does not make the others unreachable; what
      // must stay excluded is a union with no literal alternatives at all (`string`, `number`).
      const templates = parts.filter((p) => /^`[^`]*`$/.test(p));
      if (lits.length >= 2 && lits.length + templates.length === parts.length) m.set(d[1]!, lits);
    }
  }
  ALIAS_UNIONS = m;
  return m;
}

/**
 * Fields that are not tunable options and must never be driven, with the reason.
 *
 * `kind` resolves to a union like any other, but setting it does not restyle the chart — it draws
 * a different chart. It would move the drawing on every kind and mean nothing.
 * `id` / `source` / `analysisSource` are identity, and are already excluded by the `NodeId` guard
 * above; they are named here so the exclusion is a decision rather than an accident.
 */
/**
 * Not knobs.
 *
 * `kind` · `id` · `source` · `analysisSource` identify the plot rather than style it.
 *
 * Analysis results. `fits` · `fit*` · `survival` · `roc` · `pca*` · `survivalAtRisk*` are what
 * an analysis produced — the model's own doc comments say so ("from a curve-fit analysis",
 * "from a survival analysis", "from a ROC analysis"). They are data the chart draws, not
 * settings a user picks, and their correctness belongs to the stats cross-checks, not to a
 * "does this option change the drawing" measurement. Counting them as unmeasured options would
 * overstate what is unmeasured; measuring them would assert nothing.
 *
 * Result provenance. `analysisResultVersion` (on the plot and on `fit`) and `snapshotStale` are
 * bookkeeping the app stamps to know whether a stored snapshot is still in step with the
 * analysis that produced it. They are the same class as `analysisSource` beside them.
 *
 * Note: these exclusions are checked, not assumed — an exclusion must say what it would have
 * caught. Rendered on every gallery kind, `analysisResultVersion`, `snapshotStale` and
 * `fit.analysisResultVersion` (on plots that already have a fit) change the drawing on none of
 * them, exactly like the already-excluded `analysisSource`, while `title` changes it on all of
 * them. (Adding a `fit` where none existed draws a curve, which is the added fit moving the
 * picture, not the field.) So measuring them asserts nothing about styling. Their real
 * correctness — does a stale snapshot get noticed — belongs to the analysis-lifecycle tests.
 */
const NOT_AN_OPTION = new Set([
  "kind", "id", "source", "analysisSource",
  "fits", "survival", "roc",
  "points", "params", "marker", "confidenceBand", "predictionBand",
  "loadings", "scores", "eigenvalues", "explained", "varLabels", "pcLabels", "groups",
  "times", "rows",
]);

export interface FieldDecl { name: string; type: string }

/** Fields of one interface in `model.ts`, in source order. */
export function interfaceFields(name: string, src = SRC()): FieldDecl[] {
  const m = new RegExp(`export interface ${name} \\{([\\s\\S]*?)\\n\\}`).exec(src);
  if (!m) return [];
  return [...m[1]!.matchAll(/^ {2}([a-zA-Z_][a-zA-Z0-9_]*)\??:\s*([^;]+);/gm)].map((x) => ({
    name: x[1]!,
    type: x[2]!.replace(/\s+/g, " ").trim(),
  }));
}

/** An option is a path into the plot plus the declared type at its end. */
export interface Option {
  /** e.g. `["fonts","title","size"]`, `["xAxis","tickRotation"]`, `["heatmap","cellBorder"]`. */
  path: string[];
  type: string;
  /** Human-facing group, for the results. */
  group: string;
  /** Series options are keyed by a live column id, filled in per kind. */
  perSeries?: boolean;
  perPoint?: boolean;
}

export const label = (o: Option): string => o.path.join(".") + (o.perPoint ? " (per point)" : "");

const bare = (t: string): string => t.replace(/\s*\|\s*undefined$/, "").trim();

/**
 * Candidate values for a declared type. `[]` = cannot responsibly synthesise one.
 *
 * Caution: conservative on purpose — a wrong value produces a false "no effect" result
 * (`categoryGroups` is an object not an array; an annotation's body is `label` not `text`; a
 * bracket spans tick values). Colour-like names get a real hex rather than the generic string,
 * because an invalid string can be rejected downstream and read as "no effect".
 */
/**
 * The fixture's own ids — every string this plot actually uses as a key.
 *
 * Many options have a type keyed by a live id (`Record<string, …>` for per-node / per-line /
 * per-label styling) or that is one (`NodeId` for the "which column?" fields). Given only a type
 * and a name, `candidates()` cannot invent a key that any builder would look up, and every one
 * of them would be returned as untestable — an option nobody measured is not an option that works.
 *
 * Scene first, table as the fallback — the same rule `liveKey()` follows. A network node's id
 * comes from the scene (`IFNγ`, `STAT1`), not from any table column, and a mark's `rowId` is not
 * the table's row on many kinds.
 */
function liveIds(table: DataTable, plot: Plot): string[][] {
  const fams: string[][] = [];
  try {
    const scene = buildPlotScene(table, plot, SIZE) as unknown as {
      network?: { nodes?: { id: string }[]; edges?: { id: string }[] };
      series?: { id: string; marks?: { rowId?: unknown }[] }[];
      annotations?: { id: string; locked?: boolean; deletable?: boolean }[];
      forestSummary?: unknown;
    };
    fams.push((scene.network?.nodes ?? []).map((n) => n.id));
    // Edge keys are their own family — `networkEdgeKey(source, target)`, not a node id.
    // Without them `edgeColors` / `edgeWidths` / `edgeOpacities` all show no change.
    fams.push((scene.network?.edges ?? []).map((e) => e.id));
    fams.push((scene.series ?? []).map((se) => se.id));
    fams.push((scene.series ?? []).flatMap((se) => (se.marks ?? []).filter((m) => m.rowId != null).map((m) => String(m.rowId))));
    // Synthetic reference-line keys — `ba-bias`, `ba-loa-hi`, `ba-loa-lo`. They are not in the
    // table at all (the builder computes those lines from the data), so probing `refLineHidden` /
    // `refLineLabels` / `refLineLabelOffsets` with a column id, which no builder looks up, would
    // show no change on the one kind that honours them. Read off the drawing rather than listed
    // here, so a new reference line joins on its own: a builder-owned shape is `locked` +
    // non-deletable.
    fams.push((scene.annotations ?? []).filter((a) => a.locked && a.deletable === false).map((a) => a.id));
    // …and the EC50 / IC50 marker, which is a reference line drawn from `scene.fit`, not an
    // annotation — its key is the registry id.
    if ((scene as { fit?: { marker?: unknown } }).fit?.marker) fams.push(["fit-marker"]);
    // …and every registry reference line of this chart type (`refLines.ts`). The forest no-effect line,
    // the QQ / ROC diagonals, the PCA origin lines, the pyramid centre are drawn from their own scene fields,
    // not as locked annotations, so the family above does not name them; without this `refLineHidden`
    // shows no change on every chart that draws those lines.
    fams.push(referenceLinesFor(plot.kind, plot).map((l) => l.id));
  } catch {
    /* a kind that cannot build still has its table */
  }
  fams.push(tableDatasets(table).map((d) => d.id));
  fams.push(table.columns.map((c) => c.id));
  fams.push(table.rows.map((r) => r.id));
  // Index-pair keys — a correlation matrix keys its per-cell colour by `${i}:${j}`, which is not
  // an id at all. Without this family `cellColors` shows no change.
  fams.push(["0:0", "0:1", "1:0"]);
  // Axis:category keys — an alluvial node is `${axisIndex}:${categoryValue}` ("0:Online"), so
  // the numeric pair above does not reach it. Built from the fixture's own cell values.
  {
    const col = table.columns[0];
    const cats = col ? [...new Set(table.rows.map((r) => String(r.cells[col.id] ?? "")).filter(Boolean))] : [];
    fams.push(cats.slice(0, 3).map((c) => `0:${c}`));
  }
  return fams.map((f) => [...new Set(f)].filter(Boolean)).filter((f) => f.length > 0);
}

/** Plausible values for the value half of a `Record<…, V>`, chosen from V's declared type. */
function recordValues(t: string, name: string): unknown[] {
  if (/Record<[^,]+,\s*string>/.test(t)) {
    // A per-element `Record<string,string>` is a colour on every kind that has one except the
    // *Labels / *Text records, which are captions. An invalid colour shows no change (see the header).
    return /label|text|name/i.test(name) ? ["ZZ-label"] : ["#ff0000", "#00aa55"];
  }
  if (/Record<[^,]+,\s*number>/.test(t)) return [7, 2];
  if (/Record<[^,]+,\s*boolean>/.test(t)) return [true, false];
  if (/Record<[^,]+,\s*\[number,\s*number\]>/.test(t)) return [[0.2, 0.8] as [number, number]];
  if (/\{\s*dx/.test(t)) return [{ dx: 17, dy: 13 }];
  if (/\{\s*x:/.test(t)) return [{ x: 140, y: 90 }];
  if (/ParallelAxisSpec/.test(t)) return [{ reversed: true }, { title: "ZZ" }];
  if (/StyleDelta/.test(t)) return [{ color: "#ff0000" }];
  return [];
}

export function candidates(type: string, name = "", ctx?: { table: DataTable; plot: Plot }): unknown[] {
  const t = bare(type);
  if (NOT_AN_OPTION.has(name)) return [];
  /**
   * Live-id options. Needs the fixture, so it only fires when a caller passes one — without
   * `ctx` these stay untestable and are returned as such rather than silently skipped.
   */
  if (ctx) {
    // `NodeId` names a column the user picks (`treemap.groupColumn`, `parallel.colorColumn`,
    // `seriesStyles.colorFromColumn`…). Offer the table's real columns, not a synthetic string.
    if (/^NodeId$/.test(t)) return ctx.table.columns.map((c) => c.id).slice(0, 4);
    /*
     * "Centre at" is a data value of the bound colour column. The generic ladder (7, 2, 0.35) lands
     * outside most columns, where it cannot move a colour, and shows no change on charts where a
     * centre inside the range recolours the marks. Offer the range's quarters — not its middle,
     * which is the default centre and draws the same.
     */
    /*
     * A custom tick outside its axis is dropped, correctly — so the fixed ladder below can only
     * measure an axis whose range happens to hold one of its values. The second axis on raincloud,
     * floating bar, box, violin, column scatter and lollipop spans 26..38 / 60..90 / 65..105, holds
     * none, and shows no change there while a tick inside the range draws on all six.
     * Offer a value inside each drawn axis's own domain first; the ladder stays as the fallback.
     */
    if (name === "extraTicks") {
      const s = buildPlotScene(ctx.table, ctx.plot, SIZE) as unknown as Record<string, { domain?: [number, number] } | undefined>;
      const inside: unknown[] = [];
      for (const a of ["x", "y", "y2", "y3"]) {
        const d = s[a]?.domain;
        if (d && Number.isFinite(d[0]) && Number.isFinite(d[1]) && d[1] !== d[0]) inside.push([{ value: d[0] + (d[1] - d[0]) * 0.37, label: "here" }]);
      }
      return [...inside, ...EXTRA_TICK_LADDER];
    }
    // Axis breaks, the same way: the fixed spans below all lie outside the lollipop's second axis
    // (60..90), where a cut is correctly dropped and shows no change.
    if (name === "breaks") {
      const s = buildPlotScene(ctx.table, ctx.plot, SIZE) as unknown as Record<string, { domain?: [number, number] } | undefined>;
      const inside: unknown[] = [];
      for (const a of ["x", "y", "y2", "y3"]) {
        const d = s[a]?.domain;
        if (d && Number.isFinite(d[0]) && Number.isFinite(d[1]) && d[1] > d[0]) inside.push([{ from: d[0] + (d[1] - d[0]) * 0.4, to: d[0] + (d[1] - d[0]) * 0.55 }]);
      }
      return [...inside, ...BREAK_LADDER];
    }
    // The graduated fill's "Centre at" is a data value too, and it only moves a colour while it sits
    // inside the range of the values the fill is mapped by — on box / violin / floating bar that is the
    // spread of the medians, far narrower than the cells. 7, 2 and 0.35 sit outside it, and so do the
    // cells' quarters (29.0 recolours the middle box on the Box card; 35 is its default centre): no change on
    // charts that honour it. Several points across the cells' range, plus 0..1 for a
    // fill mapped by position.
    if (name === "gradMidpoint") {
      const nums = ctx.table.columns.filter((c) => c.role === "y").flatMap((c) => ctx.table.rows.map((r) => Number(r.cells[c.id]))).filter(Number.isFinite);
      if (nums.length >= 2) {
        const lo = Math.min(...nums), hi = Math.max(...nums);
        if (hi > lo) return [0.25, 0.3, 0.4, 0.6, 0.7, 0.75].map((f) => lo + (hi - lo) * f).concat([0.2, 0.8]);
      }
    }
    if (name === "colorFromMidpoint") {
      const colId = Object.values(ctx.plot.seriesStyles ?? {}).find((s) => s?.colorFromColumn)?.colorFromColumn;
      const nums = colId ? ctx.table.rows.map((r) => Number(r.cells[colId])).filter(Number.isFinite) : [];
      if (nums.length >= 2) {
        const lo = Math.min(...nums), hi = Math.max(...nums);
        if (hi > lo) return [lo + (hi - lo) * 0.25, lo + (hi - lo) * 0.75];
      }
    }
    if (/^NodeId\[\]$/.test(t)) {
      const cols = ctx.table.columns.map((c) => c.id);
      // Reordering needs a different order to be visible, so reverse rather than repeat.
      return cols.length >= 2 ? [[...cols].reverse(), cols.slice(0, 2)] : [];
    }
    /*
     * A category-group spec groups the ticks of a categorical axis, and its `column` names a real
     * column — so it needs the fixture exactly like the live-id options. `map` is offered too,
     * because a kind whose groups come from labels rather than a column ignores `column`.
     */
    if (/^CategoryGroupSpec$/.test(t)) {
      const col = ctx.table.columns[0]?.id;
      const firstCat = ctx.table.rows[0] && col ? String(ctx.table.rows[0]!.cells[col] ?? "") : "";
      const out: unknown[] = [];
      for (const c of ctx.table.columns.slice(0, 3)) out.push({ column: c.id, labelColor: true, separators: true });
      if (firstCat) out.push({ map: { [firstCat]: "ZZ-group" }, labelColor: true, separators: true });
      // …and keyed by the category names the chart draws. On a column-format chart (box, violin, column
      // scatter, raincloud, floating bar, before–after) the categories are the column names, not a cell of
      // row 1, so the map above names no category and By hand would show no change on those charts.
      try {
        const s = buildPlotScene(ctx.table, ctx.plot, SIZE) as unknown as Record<string, { band?: unknown; ticks?: { label?: string }[] } | undefined>;
        for (const a of ["x", "y"]) {
          const labels = s[a]?.band ? (s[a]!.ticks ?? []).map((tk) => tk.label ?? "").filter(Boolean) : [];
          if (labels.length >= 2) {
            const half = Math.ceil(labels.length / 2);
            out.push({ map: Object.fromEntries(labels.map((l, i) => [l, i < half ? "ZZ-A" : "ZZ-B"])), labelColor: true, separators: true, tint: true });
          }
        }
      } catch {
        /* the column / row-1 candidates above still stand */
      }
      return out;
    }
    // `annotations` is an array of 13 kinds and is measured properly elsewhere
    // (`annotation-shape-label.test.tsx` drives each kind against its editor). One text box here
    // proves the array reaches the drawing at all, which is this module's question.
    if (/^Annotation\[\]$/.test(t)) return [[{ id: "zz", kind: "text", x: 0.5, y: 0.2, label: "ZZ" }]];
    // The polar histogram's band colours are keyed by band number and its compass letters by their own words ("N", or
    // "0°" under the mathematical convention) — no data id names either, so with the live ids below all
    // three would show no change.
    if (name === "bandColors") return [{ "0": "#ff0000" }, { "1": "#ff0000" }];
    // The oncoprint's dragged gene / sample names are keyed by the name the chart draws.
    if (name === "geneLabelOffsets" || name === "sampleLabelOffsets") {
      const op = (buildPlotScene(ctx.table, ctx.plot, SIZE) as unknown as { oncoprint?: { geneLabels: { text: string }[]; sampleLabels: { text: string }[] } }).oncoprint;
      const names = (name === "geneLabelOffsets" ? op?.geneLabels : op?.sampleLabels) ?? [];
      if (names.length > 0) return [{ [names[0]!.text]: { dx: 17, dy: 13 } }];
    }
    if (name === "directionText") return [{ N: "ZZ", "0°": "ZZ" }];
    if (name === "directionOffsets") return [{ N: { dx: 17, dy: 13 }, "0°": { dx: 17, dy: 13 } }];
    // A legend row renamed on the graph is keyed by the row's words as built, not by any data id - so the
    // live ids below name no row and the rename would show no change on every chart. Offer the rows the
    // chart actually draws.
    // A loose row (pulled out of the legend block) is keyed the same way.
    if (name === "legendLabels" || name === "legendLoose") {
      try {
        const rows = (buildPlotScene(ctx.table, ctx.plot, SIZE).legend ?? []).map((e) => e.label).filter(Boolean);
        const value = name === "legendLoose" ? { x: 140, y: 90 } : "ZZ-renamed";
        if (rows.length > 0) return rows.slice(0, 2).map((l) => ({ [l]: value }));
      } catch {
        /* the generic record values below still stand */
      }
    }
    if (/^Record</.test(t)) {
      const vals = recordValues(t, name);
      if (vals.length === 0) return [];
      /**
       * One key from each family, not the first N of a flat list.
       *
       * A record keyed by an id the builder never looks up is indistinguishable from an option the
       * builder ignores — the same false result `bands` guards against below. Flattening and taking the first four would
       * spend all four on dataset ids on a parallel plot and never reach a row id, so
       * `lineColors` / `lineWidths` / `lineOpacities` (keyed by `r.id`) would all show no change.
       * Sampling per family keeps the cost bounded while guaranteeing every family gets a turn.
       */
      const ids = liveIds(ctx.table, ctx.plot).map((f) => f[0]!).filter(Boolean);
      const out: unknown[] = [];
      for (const id of ids) for (const v of vals.slice(0, 2)) out.push({ [id]: v });
      return out;
    }
  }
  // A named string union — see `stringUnions()`. Every member is offered, because the first one
  // may be the current value: a truncated list produces a false "no effect".
  const alias = stringUnions().get(t);
  if (alias) return alias;
  if (/^boolean$/.test(t)) return [true, false];
  if (/^number$/.test(t)) {
    // Size-like fields need plausible values. `figureWidth: 7` clamps to the minimum, so every
    // candidate would produce the same scene and both figure dimensions would show no change.
    if (/^(figureWidth|figureHeight|width|height|xAxisLength|yAxisLength)$/.test(name)) return [900, 300];
    return [7, 2, 0.35];
  }
  const literals = [...t.matchAll(/"([^"]+)"/g)].map((x) => x[1]!);
  if (literals.length >= 1 && /^"/.test(t)) return literals;
  if (/^string$/.test(t)) {
    if (name === "palette") return ["Vibrant", "Warm", "Grayscale"]; // a named palette; "zz" falls back to the default
    // Note: `outline` and `edge` both name a colour: `symbolOutline` and `twoToneEdge` are
    // `string` pins for a marker's contour. Driven with the placeholder `"zz"`, they land in the
    // markup as `stroke="zz"` — a diff in the file that no browser would paint. An invalid colour
    // can also be rejected downstream and show no change, the fault this function's header
    // describes.
    return /colou?r|fill|stroke|ink|bg|paper|tint|shade|outline|edge/i.test(name) ? ["#ff0000", "#00aa55"] : ["zz"];
  }
  /*
   * Structural options. Arrays of structures and inline object literals that are user
   * settings (the analysis results are excluded above). Each shape is written out because
   * the type alone does not say what a builder will accept.
   */
  // `number | null | undefined` — the plain-number branch above does not match the union.
  if (name === "refValue") return [0.5, 2];
  // Axis breaks: a cut in the scale. Several spans, because one outside the domain is dropped and
  // a dropped break is indistinguishable from an ignored option (as with `bands` below).
  if (name === "breaks") return BREAK_LADDER;
  // Display ladders — a colour-bar's own ticks, a matrix's block sizes, a bubble legend's stops.
  if (/^(colorbarTickValues|blockSizes|sizeLegendValues)$/.test(name)) return [[1, 2, 3], [0.2, 0.5, 0.8]];
  if (name === "footer") return [{ left: "ZZ-left", right: "ZZ-right" }];
  // A 1x1 transparent PNG — a real `src` the renderer can lay out, not a placeholder string.
  if (name === "image") return [{ src: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", alt: "ZZ", fit: "contain" }];
  if (name === "fitParams") return [{ show: true }, { show: false }];
  if (name === "refLine") return [{ color: "#ff0000", width: 4, show: true }, { show: false }];
  if (name === "thresholds") return [[{ p: 0.5, symbol: "ZZ" }, { p: 0.9, symbol: "QQ" }]];
  if (/^\{\s*top\?/.test(t)) return [{ top: 40, right: 40, bottom: 40, left: 40 }];
  if (/^\{\s*dx/.test(t)) return [{ dx: 17, dy: 13 }];
  if (/^\{\s*length/.test(t)) return [{ length: 2, label: "2 s" }];
  /*
   * The two axis arrays — synthesised explicitly so they are measured rather than filed under
   * untestable.
   *
   * Several values, because a tick or a band outside the axis domain is dropped, and a dropped
   * tick is indistinguishable from an ignored option. A single fixed `value: 2` sits outside the
   * domain of most fixtures (`[0.4,1.6]` on forest, `[9,17]` on Bland-Altman, `[0,1]` on ROC) and
   * both options would show no change on many kinds; with a value inside each domain, most of them
   * move. `movesAnyValue` tries candidates until one moves, so spanning the plausible ranges costs one
   * extra render per miss and removes a whole class of false "this kind ignores it".
   */
  if (name === "bands")
    return [
      [{ from: 1, to: 2, color: "#ff0000", opacity: 0.3, label: "band" }],
      [{ from: 0.2, to: 0.6, color: "#ff0000", opacity: 0.3, label: "band" }],
      [{ from: 11, to: 14, color: "#ff0000", opacity: 0.3, label: "band" }],
      [{ from: -1, to: -0.2, color: "#ff0000", opacity: 0.3, label: "band" }],
    ];
  if (name === "extraTicks") return EXTRA_TICK_LADDER;
  return [];
}

const BREAK_LADDER: unknown[] = [[{ from: 1.2, to: 1.8 }], [{ from: 0.3, to: 0.7 }], [{ from: 12, to: 16 }], [{ from: 25, to: 45 }]];

const EXTRA_TICK_LADDER: unknown[] = [
  [{ value: 2, label: "here" }],
  [{ value: 0.5, label: "here" }],
  [{ value: 12, label: "here" }],
  [{ value: -0.5, label: "here" }],
  [{ value: 55, label: "here" }],
];

/** Interfaces reachable one level down from a plot field, so the recursion knows where to go. */
function isInterface(t: string, src: string): boolean {
  return /^[A-Z][A-Za-z0-9]*$/.test(bare(t)) && new RegExp(`export interface ${bare(t)} \\{`).test(src);
}

const FONT_ELEMENTS = ["title", "subtitle", "axisTitle", "tick", "legend", "sliceLabel", "valueLabel"];
const AXES = ["xAxis", "yAxis", "y2Axis", "y3Axis"];

/**
 * Every option this program exposes on a plot, as paths.
 *
 * Covers: plot scalars · the 4 axis specs (and the FontSpec nested in each) · per-series and
 * per-point style · the plot-wide font table · and every per-kind `*Style` interface hanging off
 * `Plot` (which is where colours, thickness and symbols live for the bespoke kinds).
 */
export function allOptions(): Option[] {
  const src = SRC();
  const out: Option[] = [];
  const plotFields = interfaceFields("Plot", src);

  for (const f of plotFields) {
    const t = bare(f.type);
    if (f.name === "fonts") {
      for (const el of FONT_ELEMENTS)
        for (const p of interfaceFields("FontSpec", src))
          out.push({ path: ["fonts", el, p.name], type: p.type, group: "Fonts" });
      continue;
    }
    if (f.name === "seriesStyles" || f.name === "pointStyles") continue; // handled below
    // Note: the four axis specs are enumerated by the AXES loop below, with their nested FontSpec.
    // Letting the generic interface recursion take them too would produce every axis option twice
    // and a phantom "Kind style — AxisSpec" group in the results.
    if (t === "AxisSpec") continue;
    if (isInterface(t, src)) {
      for (const p of interfaceFields(t, src)) {
        if (isInterface(bare(p.type), src)) {
          for (const q of interfaceFields(bare(p.type), src))
            out.push({ path: [f.name, p.name, q.name], type: q.type, group: `Kind style — ${t}` });
          continue;
        }
        out.push({ path: [f.name, p.name], type: p.type, group: `Kind style — ${t}` });
      }
      continue;
    }
    out.push({ path: [f.name], type: f.type, group: "Plot" });
  }

  for (const ax of AXES)
    for (const f of interfaceFields("AxisSpec", src)) {
      if (bare(f.type) === "FontSpec") {
        for (const p of interfaceFields("FontSpec", src))
          out.push({ path: [ax, f.name, p.name], type: p.type, group: "Axis fonts" });
        continue;
      }
      out.push({ path: [ax, f.name], type: f.type, group: "Axis" });
    }

  for (const f of interfaceFields("SeriesStyle", src)) {
    out.push({ path: ["seriesStyles", f.name], type: f.type, group: "Series", perSeries: true });
    out.push({ path: ["pointStyles", f.name], type: f.type, group: "Per point", perPoint: true });
  }
  return out;
}

/** Immutably set a nested path on a plain object. */
function setPath<T>(obj: T, path: string[], value: unknown): T {
  const [head, ...rest] = path;
  if (head === undefined) return value as T;
  const src = (obj ?? {}) as Record<string, unknown>;
  return { ...src, [head]: rest.length ? setPath(src[head] as never, rest, value) : value } as T;
}

/**
 * The key a per-series / per-point override has to carry to reach a mark that is actually drawn.
 *
 * Stale ids. Keying by `tableDatasets(table)[0].id` and `table.rows[0].id` assumes which mark
 * exists, and is wrong on many kinds. Box, violin, scatter, raincloud, floating bar and
 * estimation draw glyphs whose row is not the table's first row; histogram draws bins; the PCA
 * kinds and scree draw synthetic series keyed independently of the table. With those keys
 * `pointStyles.*` shows no change on those kinds for no reason but the key.
 *
 * The other way round agrees: clicking an element of a figure and styling the
 * `(columnId, rowId)` the selection emits changes the drawing on every kind where a click
 * reaches a point, while the table-derived key changes nothing on those same kinds.
 *
 * So the key comes from the scene, which is where the ids the Inspector writes actually live
 * (`roc-0`, `surv-0`, a PCA series id…), with the table as a fallback for a kind that draws
 * nothing.
 */
function liveKey(plot: Plot, table: DataTable, perPoint: boolean, nth = 0): string | null {
  try {
    const scene = buildPlotScene(table, plot, SIZE);
    if (!perPoint && scene.series[nth]) return scene.series[nth]!.id;
    // A chart that draws its own layer (paired dot) has no scene series: fall back to the table's
    // numeric datasets by index. The first dataset there is a text column ("domain"), so without the
    // numeric filter every paired-dot series option would land on a column the chart never draws.
    if (!perPoint && scene.series.length === 0) {
      const numeric = tableDatasets(table).filter((d) => table.rows.some((r) => Number.isFinite(Number(r.cells[d.id])) && r.cells[d.id] !== ""));
      return numeric[nth]?.id ?? null;
    }
    if (!perPoint && nth > 0) return null;
    for (const se of scene.series) {
      if (!perPoint) return se.id;
      const mark = se.marks.find((m) => m.rowId != null);
      if (mark) return `${se.id}:${String(mark.rowId)}`;
    }
  } catch {
    /* fall through to the table */
  }
  const ds = tableDatasets(table)[0];
  const row = table.rows[0];
  if (!ds) return null;
  if (!perPoint) return ds.id;
  return row ? `${ds.id}:${row.id}` : null;
}

/** Does this (table, plot) actually draw a pooled summary? Read off the scene rather than
 *  assumed from the kind — a forest without `showSummary` has no summary to style. */
function hasForestSummary(plot: Plot, table: DataTable): boolean {
  try {
    return Boolean((buildPlotScene(table, plot, SIZE) as unknown as { forestSummary?: unknown }).forestSummary);
  } catch {
    return false;
  }
}

/** Apply one option to a plot, resolving live ids for the series / per-point surfaces. */
export function applyOption(plot: Plot, table: DataTable, o: Option, value: unknown, nth = 0): Plot {
  if (o.perSeries || o.perPoint) {
    const key = liveKey(plot, table, o.perPoint === true, o.perPoint ? 0 : nth);
    if (!key) return plot;
    const next = setPath(plot, [o.path[0]!, key, o.path[1]!], value);
    /**
     * A series-style key with no series. The forest pooled summary is styled through
     * `seriesStyles["forest-summary"]`, but it is `scene.forestSummary` — its own scene field,
     * not a `SeriesScene` — so `liveKey` (which returns the first series id) can only ever hand
     * back a study. Driven that way, `summaryShape` and `linkSummaryToStudies` would both show
     * no change on the one kind that honours them, as `refLineHidden` would with a column id.
     *
     * Writing the value under both keys keeps the question accurate — "does setting this on a
     * series change the drawing?" — and cannot manufacture a false "works": a field no builder reads
     * still moves nothing under either key.
     */
    if (!o.perPoint && o.path[0] === "seriesStyles" && key !== "forest-summary" && hasForestSummary(plot, table)) {
      return setPath(next, ["seriesStyles", "forest-summary", o.path[1]!], value);
    }
    return next;
  }
  return setPath(plot, o.path, value);
}

/**
 * Which series to write a per-series option onto: the first, then the next few drawn series.
 *
 * The first series is not every series. A graduated fill's "Centre at" recolours the boxes between
 * the ends of the ramp — and on the Box card the first series is the lowest median, pinned to the start
 * of the ramp whatever the centre says, so trying series 0 alone shows no change on box / violin / raincloud /
 * floating bar while the middle box moves. A user can select any series; the question is whether
 * setting it on one changes the drawing. Series 0 is tried first, so no result can change
 * except from "nothing moved" to "moved".
 */
export function seriesTries(plot: Plot, table: DataTable, o: Option): number[] {
  if (!o.perSeries || o.perPoint) return [0];
  try {
    const n = buildPlotScene(table, plot, SIZE).series.length || tableDatasets(table).length;
    return Array.from({ length: Math.max(1, Math.min(4, n)) }, (_, i) => i);
  } catch {
    return [0];
  }
}

const SIZE = { width: 620, height: 420 };

/**
 * Options that do nothing until something else turns their feature on. Without these the whole
 * group shows no change — a false result from the harness, not a defect in the app.
 *
 * Deliberately explicit. An option that changes nothing anywhere and has no entry here is reported
 * as having no effect rather than excused: "it might need an unlisted prerequisite" is a reason to look,
 * not a reason to pass.
 */
export const PREREQ: { match: RegExp; patch: (plot: Plot, o: Option, table?: DataTable) => Plot; why: string }[] = [
  {
    /*
     * A shared stroke pin beats two-tone, by design — `stroke = nodeStrokes?.[id] ?? nodeStroke
     * ?? (twoTone ? twoToneContour(fill) : undefined)`. The network fixture sets both
     * `nodeStroke: "var(--bg)"` and `nodeTwoTone: false`, so a per-node two-tone flag could never
     * show: the explicit colour short-circuits it, and `false` already matches the default.
     * Clearing both is what makes the option observable; without it the option shows no change,
     * and the cause is a prerequisite, not a defect.
     */
    match: /^network\.nodeTwoTones$/,
    patch: (p) => ({
      ...p,
      network: { ...(p.network ?? {}), nodeStroke: undefined, nodeTwoTone: false },
    }) as Plot,
    why: "an explicit `nodeStroke` (shared or per-node) always wins over two-tone, so the flag cannot show while one is pinned",
  },
  {
    match: /^spread\./,
    patch: (p) => ({ ...p, spread: { ...(p.spread ?? {}), mode: "sd" } }) as Plot,
    why: "a spread band draws nothing until `spread.mode` is set — `mode:'none'` is the off switch",
  },
  {
    /*
     * The legend symbol has to have a row to sit in. Most gallery fixtures leave `legend.show`
     * unset, and the default is "only with ≥2 series", so most kinds resolve zero entries — the
     * swatch is never drawn and its size cannot show. With `show:true` the question becomes the
     * one worth asking on every kind that can draw a legend at all.
     *
     * Note: `legend.border` and `legend.background` change the drawing even on charts whose
     * legend has no rows, because the renderer draws their box outside the entries loop — a
     * change that says nothing about a visible legend. Widening this prerequisite to all of
     * `legend.*` would expose that.
     */
    /* A radar tick's length and colour need a tick to exist; `showTicks` is off by default, so
     * without this both are never measured. Same shape as the spread band's mode. */
    match: /^radar\.tick(Len|Color)$/,
    patch: (p) => ({ ...p, radar: { ...(p.radar ?? {}), showTicks: true } }) as Plot,
    why: "radar tick marks are off by default, so their length/colour cannot show until showTicks is on",
  },
  {
    // The bar value-label options style labels that exist only while `showValues` is on — off in
    // every fixture, so `valueLabelDy` / `valuePlacement` / `valueDecimals` show no change unless the
    // patch turns showValues on. Same shape as radar ticks.
    match: /^value(Placement|LabelDy|Decimals)$/,
    patch: (p) => ({ ...p, showValues: true }) as Plot,
    why: "bar value labels are drawn only while showValues is on, and every fixture leaves it off",
  },
  {
    match: /^legend\.symbolScale$/,
    patch: (p) => ({ ...p, legend: { ...(p.legend ?? {}), show: true } }) as Plot,
    why: "the swatch is drawn per legend row, and most fixtures resolve none (legend.show defaults to ≥2 series)",
  },
  {
    // A bubble chart draws a legend only for a colour/symbol column (`hasDataDrivenLegend` gates its
    // Legend controls on exactly that). The stock card binds none, so without this every `legend.*`
    // option shows no change there, although the controls appear and work once a column is bound.
    // Bubble only: widening `legend.*` elsewhere re-opens the frame note above.
    match: /^legend\./,
    patch: (p, _o, t) => {
      if (p.kind !== "bubble") return p;
      const ys = (t?.columns ?? []).filter((c) => c.role === "y");
      const col = ys[1] ?? ys[0];
      const first = ys[0];
      if (!col || !first) return p;
      const ss = { ...(p.seriesStyles ?? {}) };
      ss[first.id] = { ...(ss[first.id] ?? {}), colorFromColumn: ss[first.id]?.colorFromColumn ?? col.id, colorFromMode: "category" };
      return { ...p, seriesStyles: ss } as Plot;
    },
    why: "a bubble chart's legend exists only while a colour column is bound, and its gallery card binds none",
  },
  {
    /*
     * Three separate switches, all off by default, and each hides a whole sub-family:
     *  - a bracket carrying a p-value, or there is nothing to style at all;
     *  - `legend: true`, or the threshold key is not drawn and the eight `legend*` fields that
     *    style that one caption move nothing;
     *  - a non-significant comparison, and `hideNs: false` so it is drawn — otherwise `hideNs`
     *    and `nsSymbol` are asked to change something the fixture never contains.
     */
    match: /^significance\./,
    patch: (p, _o, t) => {
      const [a, b, c] = bracketSpan(p, t);
      return {
        ...p,
        significance: { ...(p.significance ?? {}), legend: true, hideNs: false },
        annotations: [
          ...(p.annotations ?? []),
          // Two significant brackets on different rungs — the key lists only the rungs actually
          // drawn, so with one bracket it has a single entry and `legendSeparator` (what goes
          // between entries) has nothing to separate, and shows no change on every kind.
          { id: "prereq-bracket", kind: "bracket", from: a, to: b, p: 0.03, label: "*" },
          { id: "prereq-bracket-2", kind: "bracket", from: a, to: c, p: 0.0002, label: "***" },
          { id: "prereq-bracket-ns", kind: "bracket", from: b, to: c, p: 0.5, label: "ns" },
        ],
      } as Plot;
    },
    why: "significance styling needs a bracket, the threshold key switched on, and a non-significant comparison to be drawn",
  },
  {
    /*
     * An axis title font styles text that is not there: most fixtures leave `xAxis.title` /
     * `yAxis.title` unset, so all five `titleFont.*` props plus `titleGap` show no change there.
     * Same shape as the subtitle prerequisite. The axis-less kinds still show no change, which
     * is the correct answer — they draw no axis title however it is styled.
     */
    match: /^(x|y|y2|y3)Axis\.(titleFont\.|titleGap$)/,
    patch: (p, o) => {
      const ax = o.path[0] as "xAxis" | "yAxis" | "y2Axis" | "y3Axis";
      const cur = ((p as unknown as Record<string, Record<string, unknown>>)[ax] ?? {}) as Record<string, unknown>;
      return { ...p, [ax]: { ...cur, title: (cur["title"] as string) || "Prerequisite axis title" } } as Plot;
    },
    why: "an axis-title font/gap cannot show without an axis title, and most fixtures set none",
  },
  {
    /*
     * The fitted curve's look (`fitStyle.*`) styles what an analysis attached — a curve, its two
     * bands, the EC50 marker — and no fixture carries one. So the prerequisite is a fit: the
     * five-point curve + bands + marker an Analyze → Dose-response run would have written via
     * `setPlotFit`, on the fixture's own X range. Without it all eleven fields show no change on
     * every kind that draws a fit.
     *
     * The same fit is the prerequisite for `refLine` / `refLineHidden` / `refLineStyles` on the
     * XY family, whose only reference line is that marker: the control appears once a fit
     * exists, so on the bare plot they show no change on xy. Kinds with their
     * own reference lines draw no `plot.fit`, so the patch changes nothing there.
     */
    match: /^(fit|fitStyle)\.|^refLine(Hidden|Styles)?$/,
    patch: (p) => ({
      ...p,
      fit: {
        label: "Prerequisite fit",
        points: [[1, 2.2], [2, 3.8], [3, 5.1], [4, 6.6], [5, 7.9]],
        confidenceBand: [[1, 1.6, 2.8], [2, 3.3, 4.3], [3, 4.6, 5.6], [4, 6.0, 7.2], [5, 7.1, 8.7]],
        predictionBand: [[1, 0.5, 3.9], [2, 2.2, 5.4], [3, 3.5, 6.7], [4, 4.9, 8.3], [5, 6.0, 9.8]],
        marker: { x: 3, y: 5.1, label: "EC50 = 3" },
        ...(p.fit ?? {}),
      },
    }) as Plot,
    why: "fit styling needs a fit (curve + bands + marker) to exist, and no fixture carries one",
  },
  {
    // `decimals` is documented as "Fixed decimal places (decimal/scientific)" — under the default
    // "auto" format it changes nothing, so without this it shows no change on nearly every kind.
    match: /Axis\.decimals$/,
    patch: (p, o) => {
      const ax = o.path[0] as "xAxis" | "yAxis" | "y2Axis" | "y3Axis";
      return { ...p, [ax]: { ...((p as unknown as Record<string, unknown>)[ax] ?? {}), format: "decimal" } } as Plot;
    },
    why: "decimals only reaches the drawing under a numeric format ('auto' trims them)",
  },
  {
    // The gallery fixtures set an explicit per-series colour, and that wins over the palette — so
    // changing the palette moves nothing and it shows no change on nearly every kind.
    match: /^palette$/,
    patch: (p) => ({ ...p, seriesStyles: Object.fromEntries(
      Object.entries(p.seriesStyles ?? {}).map(([k, v]) => [k, { ...v, color: undefined }]),
    ) }) as Plot,
    why: "an explicit seriesStyles.color wins over the palette; the fixtures set one",
  },
  {
    match: /^ellipse\./,
    patch: (p) => ({ ...p, ellipse: { ...(p.ellipse ?? {}), show: true } }) as unknown as Plot,
    why: "the confidence ellipse is off by default",
  },
  /*
   * The render comparison depends on the prerequisites below. Measuring "the drawing changed"
   * rather than "the scene JSON changed" (a changed scene is not a changed drawing) exposes an
   * opposite fault: an option whose element is not on the page draws nothing, so it reads as
   * "this kind ignores it" just as confidently as a genuinely ignored option. `fonts.subtitle.*` +
   * `subtitleOffset` (no fixture has a subtitle) and `y2Axis.tickFont.*` / `y3Axis.tickFont.*`
   * (no fixture puts a series on Y2 or Y3) are of this shape on nearly every kind. A fixture that
   * cannot exhibit the behaviour reports absence just as confidently as presence.
   */
  {
    // The gallery fixtures ship `grid: { show: false }`, so colour / width / minor had nothing
    // to draw on and `grid.*` shows no change on nearly every kind. With the grid switched on,
    // all three move the drawing.
    match: /^grid\./,
    patch: (p) => ({ ...p, grid: { ...(p.grid ?? {}), show: true } }) as Plot,
    why: "grid colour/width/minor cannot show while the grid itself is off, and the fixtures ship it off",
  },
  {
    // A minor gridline is drawn per minor tick, and an axis has none until it is told how many to
    // put between majors. With the grid merely switched on, `grid.minor` moves nothing on most
    // kinds — it has no tick to draw at. (Under this prerequisite it still moves nothing on kinds
    // whose builder hard-codes `minor:false`.)
    match: /^grid\.minor$/,
    patch: (p) => ({
      ...p,
      xAxis: { ...(p.xAxis ?? {}), minorCount: 4 },
      yAxis: { ...(p.yAxis ?? {}), minorCount: 4 },
    }) as Plot,
    why: "minor gridlines need minor ticks, which exist only once an axis carries a minorCount",
  },
  {
    /*
     * Two separate conditions in one option.
     *
     * (a) `twoToneTint` / `twoToneShade` / `twoToneEdge` are the two-tone fill's parameters — they
     *     do nothing until the fill mode is two-tone, and no fixture sets it.
     * (b) A shade of black is black. The edge colour is `mix(base, BLACK, shade)`, so on a
     *     fixture whose series colour is `#000000` — which the XY one is — every shade value
     *     produces the same black and the option shows no change however it is driven. The base
     *     colour therefore has to be forced too. With (a) alone, `twoToneShade` still shows no
     *     change wherever the series colour is black.
     */
    match: /^(series|point)Styles\.twoTone(Tint|Shade|Edge)$/,
    patch: (p, _o, t) => {
      const ss = { ...(p.seriesStyles ?? {}) };
      for (const c of styleKeys(p, t)) {
        ss[c] = { ...(ss[c] ?? {}), color: "#2266cc", fillColor: "#2266cc", fillType: "twotone", symbolFill: "twotone" };
      }
      return { ...p, seriesStyles: ss } as Plot;
    },
    why: "two-tone parameters need the two-tone fill mode and a non-black base (shading black is black)",
  },
  {
    /*
     * The fill mode is a gate, and five more families sit behind it — the same condition as the
     * two-tone rule above.
     *
     * `resolveFill()` (`buildScene.ts`) branches on `fillType` and reads nothing else. Under
     * the default `"solid"`, `pattern` / `patternBg` / `patternColor` / `patternScale`,
     * `gradientTo` / `gradientAngle`, `metallic`, `special` and the six graduated `grad*` fields
     * are never looked at, so all of them show no change on every kind — a false result from the
     * harness, not a defect in the app.
     *
     * Note: set on the series even when the option is per-point. The builder merges series + point
     * style and branches on the merged `fillType`, so a per-point pattern needs its series to be
     * in pattern mode first — exactly like two-tone.
     * Note: a non-black base for the same reason as two-tone: `graduated` ramps from the base
     * colour to `gradTo` (default `#1a1a1a`), and a ramp from black to near-black is flat whatever
     * value is driven.
     */
    // gradGamma / gradMidpoint / gradSteps / gradSpace show no change without this entry on the kinds
    // with a fill, while each moves the graduated fill. They
    // shape a two-colour ramp's middle, so they get `twocolor` like gradTo.
    match: /^(series|point)Styles\.(pattern|patternBg|patternColor|patternScale|gradientTo|gradientAngle|metallic|special|gradRamp|gradMap|gradMin|gradMax|gradTo|gradReversed|gradGamma|gradMidpoint|gradSteps|gradSpace)$/,
    patch: (p, o, t) => {
      const f = o.path[o.path.length - 1]!;
      const fillType = f.startsWith("pattern")
        ? "pattern"
        : f.startsWith("gradient")
          ? "gradient"
          : f === "metallic" || f === "special"
            ? f
            : "graduated";
      // Note: chained. `gradTo` is the far end of a two-colour ramp and `rampColor()`
      // (`color.ts`) reads it under `"twocolor"` and nowhere else — the default `"lightness"`
      // ramp shades the base colour and ignores it entirely. Selecting `graduated` alone leaves it
      // showing no change on every kind while its five siblings move.
      const grad = /^grad(To|Gamma|Midpoint|Steps|Space)$/.test(f) ? { gradRamp: "twocolor" as const, gradTo: "#ee3311" } : {};
      const ss = { ...(p.seriesStyles ?? {}) };
      for (const c of styleKeys(p, t)) {
        ss[c] = { ...(ss[c] ?? {}), color: "#2266cc", fillColor: "#2266cc", fillType, ...grad };
      }
      return { ...p, seriesStyles: ss } as Plot;
    },
    why: "pattern / gradient / metallic / special / graduated parameters are ignored until the fill mode selects them",
  },
  {
    /*
     * The marker's fill mode is a gate too. The house default marker is two-tone, and the panel
     * shows the outline colour under every marker fill except two-tone and the interior colour
     * only under "open" — so on the default marker both show no change on chart types
     * whose markers take them the moment the panel would offer them.
     */
    // Whole-series only: the per-point options change the drawing without it, and on volcano a series
    // forced to "open" is refused (its zone colours stay solid), which would make a working per-point option show no change.
    match: /^seriesStyles\.(symbolOutline|symbolFillColor)$/,
    patch: (p, o, t) => {
      const symbolFill = o.path[o.path.length - 1] === "symbolFillColor" ? "open" : "solid";
      const ss = { ...(p.seriesStyles ?? {}) };
      for (const c of styleKeys(p, t)) ss[c] = { ...(ss[c] ?? {}), color: "#2266cc", symbolFill };
      return { ...p, seriesStyles: ss } as Plot;
    },
    why: "the outline colour is offered under a non-two-tone marker, the interior colour under a hollow one",
  },
  {
    // Box / violin draw their dots only with "Show all points" on, and the gallery cards have it off: Point spread
    // (the graph's or a series' own) shows no change there while it moves every dot once they are drawn.
    match: /^(seriesStyles\.)?pointSpread$/,
    patch: (p) => (p.kind === "box" || p.kind === "violin" ? ({ ...p, showBoxPoints: true } as Plot) : p),
    why: "box / violin draw their dots only with Show all points on",
  },
  {
    // An oncoprint draws its sample names only with Sample labels on (off by default: a cohort has hundreds).
    match: /^oncoprint\.sampleLabelOffsets$/,
    patch: (p) => ({ ...p, oncoprint: { ...(p.oncoprint ?? {}), showSampleLabels: true } }) as Plot,
    why: "the sample names are drawn only with Sample labels on",
  },
  {
    // The sunburst's grand total is printed in the centre hole, which exists only with a non-zero inner radius.
    match: /^sunburst\.showTotal$/,
    patch: (p) => ({ ...p, sunburst: { ...(p.sunburst ?? {}), innerRadius: 0.35 } }) as Plot,
    why: "the total is printed in the centre hole, which needs an inner radius",
  },
  {
    // The Contour colour is offered only while the fill is not two-tone (a two-tone edge is derived from the fill),
    // and the bar-family cards default to two-tone, so on those cards it would show no change without this entry.
    match: /^seriesStyles\.borderColor$/,
    patch: (p, _o, t) => {
      const ss = { ...(p.seriesStyles ?? {}) };
      for (const c of styleKeys(p, t)) ss[c] = { ...(ss[c] ?? {}), fillType: "solid", borderWidth: 2 };
      return { ...p, seriesStyles: ss } as Plot;
    },
    why: "the Contour colour is offered (and read) only under a non-two-tone fill",
  },
  {
    // The connecting line's own colour is read only while the line is unlinked from the series colour
    // (`linkLineColor === false`), and unlinking changes nothing until a colour differs from the series'.
    // Each needs the other, so neither changes the drawing on its own.
    match: /^seriesStyles\.(lineColor|linkLineColor)$/,
    patch: (p, o, t) => {
      const other = o.path[o.path.length - 1] === "lineColor" ? { linkLineColor: false } : { lineColor: "#ee3311" };
      const ss = { ...(p.seriesStyles ?? {}) };
      for (const c of styleKeys(p, t)) ss[c] = { ...(ss[c] ?? {}), ...other };
      return { ...p, seriesStyles: ss } as Plot;
    },
    why: "a line colour is read only while unlinked from the series, and unlinking shows only with a different colour",
  },
  {
    // A point label's size and colour exist only once Label points is set; the panel shows both rows only
    // then. With labels off they change nothing on any kind.
    match: /^seriesStyles\.pointLabel(Size|Color)$/,
    patch: (p, _o, t) => {
      const ss = { ...(p.seriesStyles ?? {}) };
      for (const c of styleKeys(p, t)) ss[c] = { ...(ss[c] ?? {}), pointLabels: "y" };
      return { ...p, seriesStyles: ss } as Plot;
    },
    why: "point-label size / colour need point labels switched on",
  },
  {
    /*
     * The per-point panel's own fill select gates its own rows: "Fill colour" under a hollow dot, the
     * two-tone sliders under a two-tone dot. Set on the dot, where the panel sets it — the series-level
     * mode alone does not reach Manhattan's or the ternary's dots.
     */
    match: /^pointStyles\.(symbolFillColor|twoTone(Tint|Shade|Edge))$/,
    patch: (p, o, t) => {
      if (!t) return p;
      const leaf = o.path[o.path.length - 1]!;
      const mode = leaf === "symbolFillColor" ? { symbolFill: "open" } : { symbolFill: "twotone", fillType: "twotone", color: "#2266cc" };
      const ps = { ...(p.pointStyles ?? {}) } as Record<string, Record<string, unknown>>;
      try {
        for (const se of buildPlotScene(t, p, SIZE).series) for (const m of se.marks) if (m.rowId != null) ps[`${se.id}:${String(m.rowId)}`] = { ...(ps[`${se.id}:${String(m.rowId)}`] ?? {}), ...mode };
      } catch {
        return p;
      }
      return { ...p, pointStyles: ps } as Plot;
    },
    why: "a dot's own fill colour / two-tone rows are offered only once that dot's fill is hollow / two-tone",
  },
  {
    // Legend styling — placement, framing, gap, font — cannot show while no legend is drawn, and
    // the box / violin / scatter / raincloud / floating-bar / ridgeline / before–after legends
    // default to off (they repeat the category axis, so they are opt-in). Without this the whole
    // `legend.*` family shows no change on those kinds.
    match: /^(legend\.|fonts\.legend\.|legendOffset$)/,
    patch: (p) => ({ ...p, legend: { ...(p.legend ?? {}), show: true } }) as Plot,
    why: "legend styling needs a legend on the page, and seven kinds default it off",
  },
  {
    match: /^(fonts\.subtitle\.|subtitleOffset$)/,
    patch: (p) => ({ ...p, subtitle: p.subtitle || "Prerequisite subtitle" }) as Plot,
    why: "a subtitle font/offset cannot show without a subtitle, and no gallery fixture sets one",
  },
  {
    match: /^y2Axis\./,
    patch: (p, _o, t) => putSeriesOnAxis(p, t, "y2"),
    why: "Y2 axis options need a series actually assigned to Y2 — no fixture assigns one",
  },
  {
    match: /^y3Axis\./,
    patch: (p, _o, t) => putSeriesOnAxis(p, t, "y3"),
    why: "Y3 axis options need a series actually assigned to Y3 — no fixture assigns one",
  },
  {
    // Note: two switches, because there are two label paths and they live on different objects:
    // the plot-wide `showValues` (bar/histogram/lollipop/pyramid value labels) and the per-series
    // `pointLabels` (the XY/scatter point labels). `pointLabels` is a `SeriesStyle` field, not a
    // `Plot` one — setting it on the plot type-errors, and setting it on a spread variable
    // compiles and is silently ignored.
    match: /^fonts\.valueLabel\./,
    patch: (p, _o, t) => labelsOn(p, t),
    why: "the value-label font cannot show until value labels are switched on (plot showValues and per-series pointLabels)",
  },
  {
    // `heatmap.cluster` defaults to "none", so the metric, the linkage and the dendrogram switch
    // are all parameters of a reordering that never runs. All three show no change on every kind.
    match: /^heatmap\.(clusterMetric|clusterLinkage|showDendrogram)$/,
    patch: (p) => ({ ...p, heatmap: { ...(p.heatmap ?? {}), cluster: "both" } }) as Plot,
    why: "the clustering metric/linkage/tree need clustering switched on — `cluster` defaults to 'none'",
  },
  {
    // The parallel-coordinates colouring exists only once a column is chosen to colour by, and
    // the continuous ramp + its colour bar only under the "value" scale. With neither, the ramp,
    // its reverse switch and the bar's title style nothing.
    // colorMidpoint / colorGamma / colorSteps / colorSpace shape the same ramp and need the same column
    // (without it all four show no change on parallel).
    match: /^parallel\.(colorRamp|colorReverse|colorbarTitle|colorMidpoint|colorGamma|colorSteps|colorSpace)$/,
    patch: (p, _o, t) => {
      const col = (t?.columns ?? []).find((c) => c.role === "y") ?? (t?.columns ?? [])[0];
      if (!col) return p;
      return { ...p, parallel: { ...(p.parallel ?? {}), colorColumn: col.id, colorScale: "value" } } as Plot;
    },
    why: "a colour ramp and its bar need a colour column and the continuous scale; neither is set by default",
  },
  {
    /*
     * A digit-grouping separator cannot show on numbers below 1,000, and no gallery fixture has an
     * axis that reaches four digits — so all four `thousands` options show no change on every kind
     * for a reason that belongs to the fixture. Widening the axis is the same move as giving it a title.
     *
     * Note: `format:"decimal"` too: under the default "auto" a large span is abbreviated, and the
     * abbreviation has no group to separate.
     * Note: the category kinds still show no change, which is the correct answer — a named tick has no digits.
     */
    match: /Axis\.thousands$/,
    patch: (p, o) => {
      const ax = o.path[0] as "xAxis" | "yAxis" | "y2Axis" | "y3Axis";
      const cur = ((p as unknown as Record<string, unknown>)[ax] ?? {}) as Record<string, unknown>;
      return { ...p, [ax]: { ...cur, min: 0, max: 5_000_000, format: "decimal" } } as Plot;
    },
    why: "a thousands separator needs tick numbers of at least four digits, and no fixture has one",
  },
  {
    // A decimal mark cannot show on a whole number. Under the default "auto" format the Y2 and Y3
    // fixtures tick in integers, so `decimalSep` shows no change there while the X and Y options
    // move — the same shape as the `decimals` prerequisite above, whose pattern does not match
    // `decimalSep` (it does not end in `decimals`); hence this rule of its own.
    match: /Axis\.decimalSep$/,
    patch: (p, o) => {
      const ax = o.path[0] as "xAxis" | "yAxis" | "y2Axis" | "y3Axis";
      const cur = ((p as unknown as Record<string, unknown>)[ax] ?? {}) as Record<string, unknown>;
      return { ...p, [ax]: { ...cur, format: "decimal", decimals: 2 } } as Plot;
    },
    why: "a decimal separator needs a fractional part on the tick, and 'auto' trims it away",
  },
  {
    // Colour-by-column: the mode, the ramp and its reverse switch are parameters of a mapping that
    // does not exist until a column is named. `colorFromColumn` itself is still unmeasurable (it
    // wants a live id, which `candidates()` cannot synthesise) — but its three dependents can be
    // measured under it instead of showing no change.
    // The four shaping knobs too: without a bound column they read "draws nothing" on every
    // chart — the same fixture fault this entry exists to fix.
    match: /^(series|point)Styles\.colorFrom(Mode|Ramp|Reversed|Midpoint|Gamma|Steps|Space)$/,
    patch: (p, _o, t) => {
      // The y column with the most distinct values, not the first. Centre at / Detail bias / Blend move
      // only the colours between the ends of the range, so a column whose drawn marks all sit at an end
      // cannot show them. The swimmer card's first y column is Start (0 / 1 / 2), and its event marks fall
      // only on rows where Start is 0 or 2: with that column all three show no change while working.
      const distinct = (id: string): number => new Set((t?.rows ?? []).map((r) => Number(r.cells[id])).filter((v) => Number.isFinite(v))).size;
      const col = (t?.columns ?? []).filter((c) => c.role === "y").sort((a, b) => distinct(b.id) - distinct(a.id))[0];
      if (!col) return p;
      const ss = { ...(p.seriesStyles ?? {}) };
      for (const c of t?.columns ?? []) {
        ss[c.id] = { ...(ss[c.id] ?? {}), colorFromColumn: col.id, colorFromMode: "continuous" };
      }
      return { ...p, seriesStyles: ss } as Plot;
    },
    why: "colour-by-column's mode/ramp/reverse do nothing until a column is chosen to colour by",
  },
];

/**
 * Three tick values on the category axis, for the prerequisite brackets to span.
 *
 * Hard-coded `from:1, to:2` is wrong on a transposed kind. On ridgeline the categories are the
 * Y ticks (0..4) and X is the value axis (5..30), so 1 and 2 map onto the value axis and the
 * bracket resolves to x = −43 … −21 — off the canvas. The drawing "changes", so every
 * significance option would read as changing the drawing there without any visible effect:
 * a false result produced entirely by the bracket's own placement. Asking the built scene which axis is banded costs one
 * extra build and removes that whole class.
 */
function bracketSpan(plot: Plot, table: DataTable | undefined): [number, number, number] {
  const FALLBACK: [number, number, number] = [1, 2, 3];
  if (!table) return FALLBACK;
  try {
    const s = buildPlotScene(table, plot, SIZE);
    // Note: do not guess which axis carries the categories. `band` is unset on ridgeline and
    // estimation, and "the axis whose labels are names" picks the wrong one whenever both are
    // numeric. Try each span and keep the one whose brackets actually land inside the figure —
    // the same discipline as the rest of this file: measure, don't assume.
    const spans: [number, number, number][] = [];
    for (const ax of [s.x, s.y]) {
      const v = ax.ticks.filter((t) => !t.minor).map((t) => t.value);
      if (v.length >= 3) spans.push([v[0]!, v[1]!, v[2]!]);
    }
    spans.push(FALLBACK);
    for (const span of spans) {
      const probe = buildPlotScene(table, { ...plot, annotations: [{ id: "span-probe", kind: "bracket", from: span[0], to: span[1], p: 0.01, label: "*" }] } as Plot, SIZE);
      const a = probe.annotations.find((x) => x.id === "span-probe") as unknown as Record<string, number> | undefined;
      if (!a) continue;
      const xs = [a["x1"], a["x2"]].filter((n): n is number => typeof n === "number");
      const ys = [a["y1"], a["y2"]].filter((n): n is number => typeof n === "number");
      if (xs.every((n) => n >= 0 && n <= probe.width) && ys.every((n) => n >= 0 && n <= probe.height)) return span;
    }
    return FALLBACK;
  } catch {
    return FALLBACK;
  }
}

/**
 * Every kind that carries its own `showValues` switch, beside the plot-wide one.
 *
 * Kept in step with `packages/core/src/model.ts` by `value-label-switches.test.ts`, which reads
 * the model for every `showValues?:` and fails if a kind declares one that is not listed here, so
 * a kind cannot drop out of this hand-list unnoticed.
 */
export const VALUE_LABEL_SWITCHES = ["heatmap", "corrmatrix", "pyramid", "lollipop", "paireddot", "treemap", "sunburst"] as const;

/** Switch on both value-label paths so the value-label font has something to style. */
function labelsOn(plot: Plot, table: DataTable | undefined): Plot {
  const styles = { ...(plot.seriesStyles ?? {}) };
  for (const c of table?.columns ?? []) {
    if (c.role === "y") styles[c.id] = { ...(styles[c.id] ?? {}), pointLabels: "y" };
  }
  /*
   * Note: more routes than the two shared ones. Every kind that carries its own `showValues` needs it set, or the
   * value-label font shows no change there for a reason that is the prerequisite's, not the app's.
   * (The lollipop house default turns its labels off at creation, so the shared flags alone
   * leave it drawing none.)
   *
   * For example, with only the plot-wide flag set the paired dot draws no labels and its
   * value-label font shows no change; with the paired dot's own switch on, the font moves the drawing.
   * `VALUE_LABEL_SWITCHES` is checked against the model, so a new kind with its own switch cannot
   * be left out.
   */
  const own: Record<string, unknown> = {};
  for (const k of VALUE_LABEL_SWITCHES) {
    own[k] = { ...((plot as unknown as Record<string, object | undefined>)[k] ?? {}), showValues: true };
  }
  return { ...plot, showValues: true, seriesStyles: styles, ...own } as Plot;
}

/**
 * Move a y-role column onto a secondary axis, so `y2Axis.*` / `y3Axis.*` have something to
 * tick. Uses the table's own columns rather than `plot.seriesStyles`, because most gallery plots
 * carry no seriesStyles at all and a patch keyed off them would silently no-op — which is how a
 * prerequisite quietly fails to apply and the option still shows no change.
 *
 * A column the drawing actually plots, not simply the last one. A bubble chart's last y-role
 * column is its colour channel and an xy time course's last four are replicates: none of them is
 * a series, so moving one to Y2 builds no axis and every `y2Axis.*` / `y3Axis.*` option on those
 * kinds would show no change (and bubble would appear to have no second or third axis, which it has).
 * The scene's own series list says which columns are plotted; the last-column pick stays as the
 * fallback for a kind that builds no series.
 */
function putSeriesOnAxis(plot: Plot, table: DataTable | undefined, axis: "y2" | "y3"): Plot {
  const ys = (table?.columns ?? []).filter((c) => c.role === "y");
  let target = ys[ys.length - 1];
  if (table) {
    try {
      const plotted = new Set(buildPlotScene(table, plot, SIZE).series.map((s) => s.id));
      const real = ys.filter((c) => plotted.has(c.id));
      if (real.length > 0) target = real[real.length - 1];
    } catch {
      /* a fixture the builder refuses: keep the last-column fallback */
    }
  }
  if (!target) return plot;
  return {
    ...plot,
    seriesStyles: { ...(plot.seriesStyles ?? {}), [target.id]: { ...(plot.seriesStyles?.[target.id] ?? {}), axis } },
  } as Plot;
}

/** The plot with any prerequisite for this option applied. */
/** Numbers or names — shared with the figure, whose right-click number menu asks the same question. */
export { axisTicksAreNumbers } from "./axisNumbers";

/**
 * Every id a prerequisite style must be written under: the table's columns and the series the chart
 * actually draws. The ordination charts, scree, dendrogram and QQ key their series under ids of their
 * own, so a fill mode written against the columns alone never reaches a drawn mark and its dependent
 * options show no change (the stale-id condition described at `liveKey`).
 */
export function styleKeys(plot: Plot, table: DataTable | undefined): string[] {
  if (!table) return [];
  let drawn: string[] = [];
  try {
    drawn = buildPlotScene(table, plot, SIZE).series.map((s) => s.id);
  } catch {
    /* a plot that cannot build keeps the column ids */
  }
  return [...new Set([...table.columns.map((c) => c.id), ...drawn])];
}

export function withPrereq(plot: Plot, o: Option, table?: DataTable): Plot {
  const key = o.path.join(".");
  let out = plot;
  for (const r of PREREQ) if (r.match.test(key)) out = r.patch(out, o, table);
  return out;
}

/** The rendered geometry as a comparable string — the scene is deterministic, so equality here
 *  means "the drawing did not change". A throw is recorded, never swallowed. */
export function fingerprint(table: DataTable, plot: Plot, size: { width: number; height: number } | null = SIZE): string {
  try {
    return JSON.stringify(size ? buildPlotScene(table, plot, size) : buildPlotScene(table, plot, {}));
  } catch (e) {
    return `THREW:${(e as Error).message}`;
  }
}

/** Note: `figureWidth`/`figureHeight` are overridden by an explicit size argument, so measuring them
 *  under one shows no change. They are measured with the size argument withheld instead. */
/** Note: returns `null`, not `undefined`. Returning undefined would let the default parameter re-apply
 *  `SIZE`, so the size argument would never be withheld and both figure dimensions would stay masked. */
export const sizeFor = (o: Option, plot?: Plot): { width: number; height: number } | null => {
  if (/^figure(Width|Height)$/.test(o.path[0] ?? "")) return null;
  // A leader exists only where a name had to move off its point, which depends on the figure's real size: at the fixed
  // 620 x 420 (and at the builder's own 580 x 380 fallback) the time-course card places "Treated" beside its point and
  // draws none. The app draws it at its figure size, so leader options are measured there.
  if (/^leader(Show|Color|Width)$/.test(o.path[o.path.length - 1] ?? "") && plot?.figureWidth && plot.figureHeight) {
    return { width: plot.figureWidth, height: plot.figureHeight };
  }
  return SIZE;
};

export function moves(table: DataTable, plot: Plot, o: Option, value: unknown): boolean {
  const base = withPrereq(plot, o, table);
  const sz = sizeFor(o, base);
  return fingerprint(table, base, sz) !== fingerprint(table, applyOption(base, table, o, value), sz);
}

/** Does this option move this kind under any candidate value? */
export function movesAnyValue(table: DataTable, plot: Plot, o: Option): boolean {
  // Candidates from the prerequisite'd plot, so record keys a prerequisite creates are offered.
  const base = withPrereq(plot, o, table);
  for (const v of candidates(o.type, o.path[o.path.length - 1]!, { table, plot: base })) if (moves(table, plot, o, v)) return true;
  return false;
}
