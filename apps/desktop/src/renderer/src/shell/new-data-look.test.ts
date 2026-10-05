// @vitest-environment node
/**
 * Added data takes the graph's look — for the kinds `new-series-look.test.ts` cannot check by
 * adding a Y column, each exercised the way its drawing actually takes new data.
 *
 * For each of these kinds, the test adds data to its graph and checks that the style of the
 * added data matches the default design.
 *
 * Every case: materialise the gallery card as a click does, add data (a row for the row-fed
 * kinds; a matrix column for the matrix kinds; …), rebuild, find the new visual items and
 * compare their style fields to the existing items of the same type. Colour is excluded where a
 * new item takes the next palette colour by design (a new pie slice, a new subject line), and
 * included where every item shares one colour (a bubble, a study, a histogram bar).
 *
 * The analysis-fed kinds (PCA ×4, survival, ROC) draw from a result stored on the
 * plot, not live from the sheet: adding rows must leave the drawing exactly as it was until the
 * analysis is re-run — asserted, since a kind that quietly started reading the sheet would be a
 * behaviour change worth knowing about. (The dendrogram, by contrast, re-clusters live from the
 * sheet, and has its own case.)
 */
import { describe, expect, it } from "vitest";
import { MadyDocument } from "@mady/core";
import type { CellValue } from "@mady/core";
import { buildPlotScene } from "@mady/graphics";
import { galleryItems } from "./gallery";

const SIZE = { width: 900, height: 620 };
type Scene = ReturnType<typeof buildPlotScene>;
type Rec = Record<string, unknown>;

/** Materialise a card; return the doc + a fresh build fn + the live table id. */
function open(kind: string) {
  const item = galleryItems().find((g) => (g.plot.kind ?? "xy") === kind)!;
  const doc = new MadyDocument();
  const { table, plot } = doc.insertGraph(item.table, item.plot, item.title);
  const build = (): Scene => {
    const j = doc.toJSON();
    return buildPlotScene(j.tables.find((t) => t.id === table.id)!, j.plots.find((p) => p.id === plot.id)!, SIZE);
  };
  const tbl = () => doc.toJSON().tables.find((t) => t.id === table.id)!;
  return { doc, build, tableId: table.id, tbl };
}
/** Add a row shaped like the last one (numbers nudged, text suffixed) — a new observation. */
function addRowLikeLast(o: ReturnType<typeof open>, tweak?: (v: CellValue, name: string) => CellValue): void {
  const t = o.tbl();
  const last = t.rows[t.rows.length - 1]!;
  const vals = t.columns.map((c) => {
    const v = last.cells[c.id] ?? null;
    if (tweak) return tweak(v, c.name);
    return typeof v === "number" ? Math.round((v * 1.1 + 1) * 100) / 100 : typeof v === "string" ? `${v}*` : v;
  });
  o.doc.addRow(o.tableId, vals as CellValue[]);
}
/** Add a filled Y column (a new variable / slice). */
function addFilledColumn(o: ReturnType<typeof open>, value: (i: number) => number): void {
  const lead = o.doc.addColumn(o.tableId);
  const ci = o.tbl().columns.findIndex((c) => c.id === lead.id);
  o.tbl().rows.forEach((_r, i) => o.doc.editCellAt(o.tableId, i, ci, value(i)));
}
/** The style-defining fields of a series (everything but its position data). */
const seriesLook = (s: Scene["series"][number]): Rec => ({
  color: s.color, lineWidth: s.lineWidth, symbol: s.symbol, symbolSize: s.symbolSize, symbolFill: s.symbolFill,
  borderWidth: s.borderWidth, symbolOpacity: s.symbolOpacity, dash: s.dash, symbolFillColor: s.symbolFillColor,
});
/** Assert every new item's look equals the existing items' (unanimous) look, on the given fields. */
function expectSameLook(kind: string, existing: Rec[], added: Rec[], fields: string[]): void {
  expect(added.length, `${kind}: adding data produced no new item`).toBeGreaterThan(0);
  for (const f of fields) {
    if (!(f in existing[0]!)) continue;
    const vals = new Set(existing.map((e) => JSON.stringify(e[f])));
    if (vals.size !== 1) continue; // existing items differ on this field — nothing to compare
    for (const a of added) {
      expect(JSON.stringify(a[f]), `${kind}: new item ${f} = ${JSON.stringify(a[f])}, existing = ${[...vals][0]}`).toBe([...vals][0]);
    }
  }
}
const asRec = (xs: readonly unknown[]): Rec[] => xs as Rec[];

describe("row-fed kinds: a new row draws in the same look as the existing rows", () => {
  it("forest: a new study is one more mark on the same single series — series look unchanged, its marker like the others", () => {
    const o = open("forest"); const b = o.build(); addRowLikeLast(o); const a = o.build();
    expect(a.series).toHaveLength(1);
    expect(a.series[0]!.marks.length).toBe(b.series[0]!.marks.length + 1);
    expect(seriesLook(a.series[0]!)).toEqual(seriesLook(b.series[0]!));
    const marks = a.series[0]!.marks;
    expectSameLook("forest", asRec(marks.slice(0, -1)), asRec([marks[marks.length - 1]!]), ["symbol", "symbolSize", "color", "size"]);
    expect(a.warnings).toEqual(b.warnings);
  });
  it("Bland-Altman: a new subject is another point in the same single series, same look", () => {
    const o = open("blandaltman"); const b = o.build(); addRowLikeLast(o); const a = o.build();
    expect(a.series[0]!.marks.length).toBe(b.series[0]!.marks.length + 1);
    expect(seriesLook(a.series[0]!)).toEqual(seriesLook(b.series[0]!));
    expect(a.warnings).toEqual(b.warnings);
  });
  it("bubble: a new point keeps the series look and gets a bubble size like the others", () => {
    const o = open("bubble"); const b = o.build(); addRowLikeLast(o); const a = o.build();
    expect(a.series[0]!.marks.length).toBe(b.series[0]!.marks.length + 1);
    expect(seriesLook(a.series[0]!)).toEqual(seriesLook(b.series[0]!));
    const marks = a.series[0]!.marks as unknown as Rec[];
    const sizeKey = ["r", "size", "radius"].find((k) => k in marks[0]!);
    if (sizeKey) expect(marks.every((m) => typeof m[sizeKey] === "number"), "every mark incl. the new one carries a bubble size").toBe(true);
  });
  it("histogram: a new observation is rebinned into bars that keep one shared look", () => {
    const o = open("histogram"); const b = o.build(); addRowLikeLast(o); const a = o.build();
    expect(seriesLook(a.series[0]!)).toEqual(seriesLook(b.series[0]!));
    expect(a.series[0]!.marks.every((m) => m.bar)).toBe(true);
    const fills = new Set(a.series[0]!.marks.map((m) => (m as unknown as Rec).color ?? a.series[0]!.color));
    expect(fills.size).toBe(1);
  });
  it("pyramid: a new age band gives both mirrored series one more bar in their own look", () => {
    const o = open("pyramid"); const b = o.build(); addRowLikeLast(o); const a = o.build();
    expect(a.series).toHaveLength(2);
    a.series.forEach((s, i) => {
      expect(s.marks.length).toBe(b.series[i]!.marks.length + 1);
      expect(seriesLook(s)).toEqual(seriesLook(b.series[i]!));
    });
  });
  it("estimation: a new observation lands in its group's swarm; the swarms + the difference keep their look", () => {
    const o = open("estimation"); const b = o.build(); addRowLikeLast(o); const a = o.build();
    // A row holds one observation per replicate sub-column, so a new row adds k points to each swarm.
    const t = o.tbl();
    const reps = (leadName: string) => { const lead = t.columns.find((c) => c.name === leadName)!; return 1 + t.columns.filter((c) => c.group === lead.id).length; };
    const pts = (s: Scene) => s.series.slice(0, 2).map((x) => x.marks[0]!.points?.length ?? 0);
    expect(pts(a)[0]).toBe(pts(b)[0]! + reps(b.series[0]!.name));
    expect(pts(a)[1]).toBe(pts(b)[1]! + reps(b.series[1]!.name));
    a.series.forEach((s, i) => expect(seriesLook(s)).toEqual(seriesLook(b.series[i]!)));
  });
  it("before–after: a new subject is a new paired series in the same look as the other subjects", () => {
    const o = open("beforeafter"); const b = o.build(); addRowLikeLast(o); const a = o.build();
    expect(a.series.length).toBe(b.series.length + 1);
    const added = a.series.filter((s) => !b.series.some((x) => x.id === s.id));
    expectSameLook("beforeafter", b.series.map(seriesLook), added.map(seriesLook), ["lineWidth", "symbol", "symbolSize", "symbolFill", "borderWidth", "dash", "symbolOpacity"]);
  });
  it("pie: a new slice (a new row) wears the slice look — same stroke, its own palette colour", () => {
    // The pie card is the parts-of-whole format (each row a slice, one value column = the whole),
    // exactly what a wizard-made pie is — so a new slice is a new row, not a column. It inherits
    // the value column's two-tone look (a stroke shading its own palette colour) via the builder.
    const o = open("pie"); const b = o.build(); addRowLikeLast(o); const a = o.build();
    expect(a.pie!.slices.length).toBe(b.pie!.slices.length + 1);
    const added = a.pie!.slices.filter((s) => !b.pie!.slices.some((x) => x.id === s.id));
    expectSameLook("pie", asRec(b.pie!.slices), asRec(added), ["strokeWidth"]);
    for (const s of added) expect(b.pie!.slices.map((x) => x.color)).not.toContain(s.color);
    // The default pie is two-tone: every slice's stroke is a darker shade of its own fill
    // (blue→dark blue, yellow→dark yellow…). So the new slice must follow the same rule —
    // a stroke that is its own (≠ its fill, ≠ any sibling's stroke), never a copied sibling stroke.
    const strokes = new Set(b.pie!.slices.map((x) => x.strokeColor));
    expect(strokes.size, "fixture check: the card's slices carry per-slice two-tone strokes").toBe(b.pie!.slices.length);
    for (const s of added) {
      expect(s.strokeColor, "the new slice has no stroke").toBeTruthy();
      expect(s.strokeColor).not.toBe(s.color);
      expect(strokes.has(s.strokeColor), "the new slice copied a sibling's stroke instead of shading its own colour").toBe(false);
    }
  });
  it("treemap: a new state (row) is a new cell with the shared fill opacity / label size, no new warning", () => {
    const o = open("treemap"); const b = o.build();
    addRowLikeLast(o, (v, name) => (name === "State" ? "Newland" : name === "GDP ($T)" ? 1.5 : v)); // same region as the last row
    const a = o.build();
    expect(a.treemap!.cells.length).toBe(b.treemap!.cells.length + 1);
    const added = a.treemap!.cells.filter((c) => !b.treemap!.cells.some((x) => x.id === c.id));
    expectSameLook("treemap", asRec(b.treemap!.cells), asRec(added), ["fillOpacity", "labelSize"]);
    expect(a.warnings).toEqual(b.warnings);
  });
  it("network: a new edge to a new node — the node in the shared node style, the edge in the shared edge style", () => {
    const o = open("network"); const b = o.build();
    addRowLikeLast(o, (v, name) => (name === "Source" ? "Faecalibact." : name === "Target" ? "NEWNODE" : v));
    const a = o.build();
    expect(a.network!.edges.length).toBe(b.network!.edges.length + 1);
    expect(a.network!.nodes.length).toBe(b.network!.nodes.length + 1);
    const addedN = a.network!.nodes.filter((n) => !b.network!.nodes.some((x) => x.id === n.id));
    expectSameLook("network nodes", asRec(b.network!.nodes), asRec(addedN), ["stroke", "strokeWidth", "labelSize", "labelColor"]);
    const key = (e: Rec) => JSON.stringify([e.sourceId, e.targetId]);
    const addedE = a.network!.edges.filter((e) => !b.network!.edges.some((x) => key(x as unknown as Rec) === key(e as unknown as Rec)));
    expectSameLook("network edges", asRec(b.network!.edges), asRec(addedE), ["color", "opacity", "width"]);
  });
  it("alluvial: a new flow (row) with a new category adds a node and ribbons in the shared ribbon look", () => {
    const o = open("alluvial"); const b = o.build();
    addRowLikeLast(o, (v, name) => (name === "Stage" ? "Stage IV" : v));
    const a = o.build();
    expect(a.alluvial!.nodes.length).toBe(b.alluvial!.nodes.length + 1);
    expect(a.alluvial!.ribbons.length).toBeGreaterThan(b.alluvial!.ribbons.length);
    const rk = (r: Rec) => JSON.stringify([r.select, r.count]);
    const addedR = a.alluvial!.ribbons.filter((r) => !b.alluvial!.ribbons.some((x) => rk(x as unknown as Rec) === rk(r as unknown as Rec)));
    expectSameLook("alluvial ribbons", asRec(b.alluvial!.ribbons), asRec(addedR), ["opacity"]);
    expect(a.alluvial!.nodeStroke).toBe(b.alluvial!.nodeStroke);
  });
  it("parallel coordinates: a new case (row) is one more line in the shared width / opacity, coloured by its group", () => {
    const o = open("parallel"); const b = o.build();
    addRowLikeLast(o, (v, name) => (name === "Species" ? "setosa" : v));
    const a = o.build();
    expect(a.parallel!.lines.length).toBe(b.parallel!.lines.length + 1);
    expect(a.parallel!.lineWidth).toBe(b.parallel!.lineWidth);
    expect(a.parallel!.lineOpacity).toBe(b.parallel!.lineOpacity);
    const added = a.parallel!.lines[a.parallel!.lines.length - 1] as unknown as Rec;
    const setosaColours = new Set(b.parallel!.lines.map((l) => (l as unknown as Rec).color));
    expect(setosaColours.has(added.color), "a setosa row must take an existing group colour").toBe(true);
  });
});

describe("matrix kinds: a new column and a new row draw like the rest of the grid", () => {
  it("heatmap: a new sample column + a new gene row — every cell, new ones included, coloured from the same ramp", () => {
    const o = open("heatmap"); const b = o.build();
    addFilledColumn(o, (i) => 1 + i);
    addRowLikeLast(o);
    const a = o.build();
    expect(a.heatmap!.colLabels.length).toBe(b.heatmap!.colLabels.length + 1);
    expect(a.heatmap!.rowLabels.length).toBe(b.heatmap!.rowLabels.length + 1);
    expect(a.heatmap!.cells.length).toBe((b.heatmap!.rowLabels.length + 1) * (b.heatmap!.colLabels.length + 1));
    expect(a.heatmap!.cells.every((c) => c.color && c.color !== "#dddddd"), "every cell incl. the new column/row got a ramp colour").toBe(true);
    expect(a.warnings).toEqual(b.warnings);
  });
  it("correlation matrix: a new variable column makes an (n+1)×(n+1) grid, every glyph in the shared style", () => {
    const o = open("corrmatrix"); const b = o.build();
    addFilledColumn(o, (i) => (i * 7) % 11);
    const a = o.build();
    const n0 = b.corrmatrix!.rowLabels.length; const n1 = a.corrmatrix!.rowLabels.length;
    expect(n1).toBe(n0 + 1);
    // The matrix is drawn as the lower triangle (n(n+1)/2 glyphs), so one more variable adds one more row of n1 glyphs.
    expect(a.corrmatrix!.cells.length).toBe((n1 * (n1 + 1)) / 2);
    expect(a.corrmatrix!.cells.length - b.corrmatrix!.cells.length).toBe(n1);
    // The new variable's row of glyphs vs the old grid, on the look fields only — not w/h/x/y (a
    // 6-variable grid has smaller cells than a 5-variable one; that is geometry, not style) and not
    // r/colour (the glyph fill is the correlation value itself). What must match: the label ink.
    expectSameLook("corrmatrix", asRec(b.corrmatrix!.cells), asRec(a.corrmatrix!.cells.slice(-n1)), ["labelColor"]);
    // …and every glyph, new ones included, carries an outline path drawn the same way.
    expect(a.corrmatrix!.cells.every((c) => typeof (c as unknown as Rec).outlinePath === "string")).toBe(true);
    expect(a.warnings).toEqual(b.warnings);
  });
});

describe("analysis-fed kinds: adding rows changes nothing until the analysis is re-run", () => {
  for (const kind of ["pcascore", "pcaload", "pcabiplot", "scree", "survival", "roc"]) {
    it(`${kind}: a new row leaves the drawing byte-identical (it draws the stored result, not the sheet)`, () => {
      const o = open(kind); const b = o.build(); addRowLikeLast(o); const a = o.build();
      const pick = (s: Scene) => JSON.stringify({ series: s.series, annotations: s.annotations, warnings: s.warnings });
      expect(pick(a)).toBe(pick(b));
    });
  }
});

describe("dendrogram: it re-clusters live from the sheet — a new leaf joins the tree in the shared branch look", () => {
  it("a new gene row: same number of cluster series, each keeping its width / dash / colour, tree paths regrown", () => {
    const o = open("dendrogram"); const b = o.build(); addRowLikeLast(o); const a = o.build();
    expect(a.series.length).toBe(b.series.length); // the k colour clusters are a setting, not a data count
    a.series.forEach((s, i) => {
      const bb = b.series[i]!;
      expect({ lineWidth: s.lineWidth, dash: s.dash, color: s.color }).toEqual({ lineWidth: bb.lineWidth, dash: bb.dash, color: bb.color });
    });
    expect(a.series.map((s) => s.linePath).join()).not.toBe(b.series.map((s) => s.linePath).join()); // the tree did change: the leaf is in it
    expect(a.warnings).toEqual(b.warnings);
  });
});
