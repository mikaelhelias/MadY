// @vitest-environment node
/**
 * A new series takes the graph's look, on every chart kind, one by one.
 *
 * Guards against a new series drawing out of style with its siblings: on the gallery XY plot, a
 * third treatment added to two styled ones would otherwise draw a bare curve. Every graph type is
 * tested, one by one: add a series and check that the new series' style matches.
 *
 * Example (XY card): the existing series draw 8-px open two-tone markers, a 2-px line and a
 * 2-px border; an added series left to the bare fallback would draw a 4-px solid dot with a
 * 1.5-px border. The graph's look is stamped per series into `plot.seriesStyles` at creation, and
 * a later column has no entry of its own.
 *
 * This test materialises every gallery card exactly as a click does (`insertGraph`), adds a
 * Y dataset the way the datasheet's "+ Column" does (`addColumn`), fills it, builds the scene,
 * and compares the new series' resolved drawing to its siblings on every shared style field.
 * Colour is deliberately excluded — a new series takes the next palette colour by design.
 */
import { describe, expect, it } from "vitest";
import { KIND_HOUSE_DEFAULTS, MadyDocument, tableDatasets } from "@mady/core";
import type { SeriesStyle } from "@mady/core";
import { buildPlotScene } from "@mady/graphics";
import { galleryItems } from "./gallery";

/** The scene-level fields that make up a series' look (everything a sibling would share). */
// Note: these are scene field names (what is drawn), not Plot style names. `fillType`/`lineDash` are style keys the
// scene resolves into `symbolFill`/`dash`; naming a key the scene lacks compares undefined to undefined
// and proves nothing.
const LOOK_FIELDS = ["lineWidth", "symbol", "symbolSize", "symbolFill", "borderWidth", "dash", "symbolOpacity", "symbolFillColor", "errorCaps", "errorWidth"] as const;

/** Kinds where a "series" is not a Y-dataset column at all (matrix / tree / analysis-fed / parts-of-whole), so "+ Column" adds no comparable series.
 *  Asserted, not skipped: a filled new column adds no series on any of them — survival / roc /
 *  ordination draw the stored analysis result, heatmap / corrmatrix a matrix, pie / treemap parts, the rest links or axes. */
// triplot: its three families come from the analysis blob, not from the sheet's columns, so
// adding a column adds no series — the same reason the other ordination kinds are here.
const NOT_COLUMN_SERIES = new Set(["pie", "treemap", "heatmap", "corrmatrix", "alluvial", "network", "parallel", "dendrogram", "pcascore", "pcaload", "pcabiplot", "triplot", "scree", "survival", "roc"]);
/** Kinds that read a fixed set of columns by role/position (forest = estimate·lower·upper, estimation = two
 *  groups, Bland-Altman = two methods, pyramid = two groups, bubble = x·y·size, histogram = one variable,
 *  before-after = pre·post): a further column is ignored by design, so there is no new series to style.
 *  Asserted as such — a silent skip would hide a kind that started drawing it. */
const FIXED_COLUMNS = new Set(["forest", "funnel", "estimation", "blandaltman", "pyramid", "bubble", "histogram", "beforeafter",
  // venn draws at most three sets — a 4th column is refused with a warning, not styled
  "venn",
  // upset: a new column is drawn, but as a new set (matrix row + intersections), never as a
  // SeriesScene series, so there is no series look to check
  "upset",
  // ternary: the first three columns are the composition (by position); a further column
  // is ignored with a warning naming it — or consumed as a colour binding, never a series
  "ternary",
  // qq: the P-value column is read by position; an added column is not a new QQ series.
  "qq",
  // manhattan: P · Chromosome · Position are read by position; an added column is not a new
  // series (there is one positional marker series, shaded per chromosome).
  "manhattan",
  // chord: Source · Target · Weight are read by position; an added column is not a new series
  // (the "series" are the ring nodes, derived from the endpoint columns' values).
  "chord",
  // oncoprint: Sample · Gene · Alteration are read by position; an added column is not a new
  // series (the "series" are the alteration types, derived from the Alteration column's values).
  "oncoprint"]);

/**
 * Kinds that draw series in their own part of the scene (not `scene.series`), with each added column
 * becoming one more mark / polygon / strip. Without these entries such kinds would fall through a
 * "no per-series look" early return and pass without comparing anything. Each entry lists the
 * groups to compare within (a row's dots, the polygons) and the look fields every item carries.
 */
type Item = Record<string, unknown> & { id: string };
/** The scene as the accessors below read it: each kind reads a different optional part, and typing
 *  each against PlotScene would need a non-null assertion per field. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SceneParts = Record<string, any>;
const OWN_MARKS: Record<string, { groups: (scene: SceneParts) => Item[][]; look: readonly string[]; colour: boolean }> = {
  lollipop: { groups: (s) => s.lollipop.rows.map((r: { dots: Item[] }) => r.dots), look: ["symbol", "size", "symbolFill", "symbolOpacity", "symbolFillColor", "borderWidth"], colour: true },
  paireddot: { groups: (s) => s.paireddot.rows.map((r: { marks: Item[] }) => r.marks), look: ["symbol", "size", "symbolFill", "symbolOpacity", "symbolFillColor", "borderWidth"], colour: true },
  radar: { groups: (s) => [s.radar.polygons], look: ["fillOpacity", "lineWidth"], colour: true },
  // A strip's look is its height; its tiles are coloured by the data, so there is no series colour.
  tracks: { groups: (s) => [s.tracks.strips], look: ["h"], colour: false },
};
/** Kinds whose own drawing does not take an added column. Rose and Venn say so in a warning naming it;
 *  the other four read their columns by position (sunburst: the levels + first value). */
const OWN_IGNORED: Record<string, { warns: boolean }> = {
  rose: { warns: true }, venn: { warns: true }, sunburst: { warns: false }, scatter3d: { warns: false }, chord: { warns: false }, oncoprint: { warns: false },
};

/** Add a column the way the datasheet's "+ Column" does and fill it with numbers. */
function addFilledColumn(doc: MadyDocument, tableId: string): { id: string; name: string } {
  const lead = doc.addColumn(tableId);
  const t = () => doc.toJSON().tables.find((x) => x.id === tableId)!;
  const col = t().columns.findIndex((c) => c.id === lead.id);
  t().rows.forEach((_r, i) => doc.editCellAt(tableId, i, col, 5 + i * 3));
  return { id: lead.id, name: t().columns[col]!.name };
}

describe("every gallery kind: an added series draws in the graph's look, one by one", () => {
  const seen = new Set<string>();
  for (const item of galleryItems()) {
    const kind = item.plot.kind ?? "xy";
    if (seen.has(kind)) continue;
    seen.add(kind);
    it(`${kind}: the new series matches its siblings on every shared look field`, () => {
      const doc = new MadyDocument();
      const { table, plot } = doc.insertGraph(item.table, item.plot, item.title);
      const before = doc.toJSON();
      const t0 = before.tables.find((t) => t.id === table.id)!;
      const p0 = before.plots.find((p) => p.id === plot.id)!;
      const sceneBefore = buildPlotScene(t0, p0, { width: 900, height: 620 });
      const siblingIds = new Set(sceneBefore.series.map((s) => s.id));
      if (NOT_COLUMN_SERIES.has(kind)) {
        // No column series exists to style. Assert exactly that — a skipped test here would never notice
        // a kind that starts drawing an added column as a series (and then needs the look check below).
        addFilledColumn(doc, table.id);
        const now = doc.toJSON();
        const drawn = buildPlotScene(now.tables.find((t) => t.id === table.id)!, now.plots.find((p) => p.id === plot.id)!, { width: 900, height: 620 });
        expect(drawn.series.filter((s) => !siblingIds.has(s.id)).map((s) => s.name), `${kind} now draws an added column as a series — move it out of NOT_COLUMN_SERIES and let the look check run`).toEqual([]);
        return;
      }
      // Fixture check: the card's siblings must carry a real, shared per-series look — else
      // the fixture cannot exhibit the defect and this proves nothing.
      const styled = tableDatasets(t0).map((d) => p0.seriesStyles?.[d.id]).filter((s): s is SeriesStyle => !!s && Object.keys(s).length > 0);
      const own = OWN_MARKS[kind];
      if (own) {
        const before = own.groups(sceneBefore as unknown as SceneParts);
        const oldIds = new Set(before.flat().map((m) => m.id));
        const added = addFilledColumn(doc, table.id);
        const now = doc.toJSON();
        const drawn = own.groups(buildPlotScene(now.tables.find((t) => t.id === table.id)!, now.plots.find((p) => p.id === plot.id)!, { width: 900, height: 620 }) as unknown as SceneParts);
        expect(drawn.flat().filter((m) => !oldIds.has(m.id)).length, `${kind}: the added column "${added.name}" drew nothing`).toBeGreaterThan(0);
        for (const group of drawn) {
          const sib = group.filter((m) => oldIds.has(m.id));
          const neu = group.filter((m) => !oldIds.has(m.id));
          for (const key of own.look) {
            const vals = new Set(sib.map((m) => JSON.stringify(m[key])));
            if (vals.size !== 1) continue; // siblings differ on this field — nothing to inherit
            for (const n of neu) expect(JSON.stringify(n[key]), `${kind}: "${added.name}" ${key} = ${JSON.stringify(n[key])}, siblings = ${[...vals][0]}`).toBe([...vals][0]);
          }
          if (own.colour) for (const n of neu) expect(sib.map((m) => m.color), `${kind}: "${added.name}" took a sibling's colour ${String(n.color)}`).not.toContain(n.color);
        }
        return;
      }
      if (kind in OWN_IGNORED) {
        const drawnBefore = JSON.stringify((sceneBefore as unknown as Record<string, unknown>)[kind]);
        const added = addFilledColumn(doc, table.id);
        const now = doc.toJSON();
        const after = buildPlotScene(now.tables.find((t) => t.id === table.id)!, now.plots.find((p) => p.id === plot.id)!, { width: 900, height: 620 });
        expect(drawnBefore, `fixture: ${kind} has no scene.${kind}`).toBeTruthy();
        expect(JSON.stringify((after as unknown as Record<string, unknown>)[kind]), `${kind} now draws the added column "${added.name}" — give it a look check in OWN_MARKS`).toBe(drawnBefore);
        if (OWN_IGNORED[kind]!.warns) expect(after.warnings.join(" | "), `${kind} stopped saying "${added.name}" is not drawn`).toContain(added.name);
        return;
      }
      // Every other kind must reach the comparison below: a card with no per-series look, or no series,
      // fails here instead of returning early and passing having checked nothing.
      expect(styled.length, `${kind}: the card ships no per-series look to inherit — add it to OWN_MARKS / OWN_IGNORED or give it a look`).toBeGreaterThan(0);
      expect(sceneBefore.series.length, `${kind}: draws no scene.series — add it to OWN_MARKS / OWN_IGNORED`).toBeGreaterThan(0);

      // "+ Column", then fill it with numbers, exactly as a user would.
      const lead = doc.addColumn(table.id);
      const rows = doc.toJSON().tables.find((t) => t.id === table.id)!.rows;
      rows.forEach((_r, i) => doc.editCellAt(table.id, i, doc.toJSON().tables.find((t) => t.id === table.id)!.columns.findIndex((c) => c.id === lead.id), 5 + i * 3));
      const after = doc.toJSON();
      const scene = buildPlotScene(after.tables.find((t) => t.id === table.id)!, after.plots.find((p) => p.id === plot.id)!, { width: 900, height: 620 });
      const added = scene.series.filter((s) => !siblingIds.has(s.id));
      const sib = scene.series.filter((s) => siblingIds.has(s.id));
      if (FIXED_COLUMNS.has(kind)) {
        // Fixed-column kinds ignore the extra column by design — assert exactly that, so a kind
        // that quietly starts drawing a 4th column shows up here and gets the look check added.
        expect(added.length, `${kind} now draws an added column — move it out of FIXED_COLUMNS and let the look check run`).toBe(0);
        return;
      }
      expect(added.length, `${kind}: adding a column produced no new series`).toBeGreaterThan(0);
      /**
       * Note: one styled sibling (the area / volcano cards ship a single series). The stamped look
       * on a lone series is indistinguishable from a per-series edit, so the builder inherits
       * only the kind's house `series` block from it (unambiguous), not the preset's marker fill
       * / border / 6.5-px size, which the plot does not record. So for a single-series graph the
       * newcomer matches its sibling on the house-default fields and falls to the builder default
       * for the preset-only ones. Asserted as such, not skipped: it is the one case where the
       * newcomer does not match its sibling on every field.
       */
      const houseSeries = (KIND_HOUSE_DEFAULTS[kind as keyof typeof KIND_HOUSE_DEFAULTS]?.series ?? {}) as Record<string, unknown>;
      const compareFields = sib.length >= 2 ? LOOK_FIELDS : (LOOK_FIELDS.filter((k) => k in houseSeries) as unknown as typeof LOOK_FIELDS);
      for (const key of compareFields) {
        const vals = new Set(sib.map((s) => JSON.stringify((s as unknown as Record<string, unknown>)[key])));
        if (vals.size !== 1) continue; // siblings differ on this field — nothing to inherit
        const want = [...vals][0];
        for (const n of added) {
          expect(JSON.stringify((n as unknown as Record<string, unknown>)[key]), `${kind}: new series "${n.name}" ${key} = ${JSON.stringify((n as unknown as Record<string, unknown>)[key])}, siblings = ${want}`).toBe(want);
        }
      }
      // …and it still gets its own colour (the next palette entry), not a sibling's — unless the
      // siblings already use every hue: the palette has 8 and a 9th series wraps by design.
      const paletteExhausted = new Set(sib.map((s) => s.color)).size >= 8;
      if (!paletteExhausted) for (const n of added) expect(sib.map((s) => s.color)).not.toContain(n.color);
    });
  }
});

describe("the boundary: a per-series edit never spreads to a new sibling", () => {
  it("one styled series (a user's 'only this one') is not a house look — the newcomer inherits nothing from it", () => {
    // Two-series XY where only series A has its own style; the newcomer must not inherit that.
    const item = galleryItems().find((g) => (g.plot.kind ?? "xy") === "xy")!;
    const doc = new MadyDocument();
    const { table, plot } = doc.insertGraph(item.table, item.plot, item.title);
    const ds = tableDatasets(doc.toJSON().tables.find((t) => t.id === table.id)!);
    // Replace the card's stamped styles with a single per-series edit.
    doc.setPlotOptions(plot.id, { seriesStyles: { [ds[0]!.id]: { symbolSize: 20, lineWidth: 6 } } });
    const lead = doc.addColumn(table.id);
    doc.editCellAt(table.id, 0, doc.toJSON().tables.find((t) => t.id === table.id)!.columns.findIndex((c) => c.id === lead.id), 1);
    const after = doc.toJSON();
    const scene = buildPlotScene(after.tables.find((t) => t.id === table.id)!, after.plots.find((p) => p.id === plot.id)!, { width: 900, height: 620 });
    const added = scene.series.find((s) => s.id === lead.id)!;
    expect(added.symbolSize, "a lone series' size spread to the newcomer").not.toBe(20);
    expect(added.lineWidth, "a lone series' line width spread to the newcomer").not.toBe(6);
  });
});
