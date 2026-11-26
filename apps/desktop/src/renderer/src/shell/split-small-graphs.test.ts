/**
 * Graph ▸ Split into small graphs, checked against the DRAWING on every gallery chart of every
 * type that can be split: each small graph draws its own series and none of the others, and
 * every numeric axis spans exactly the range the original draws — the reason to split at all
 * is to compare the panels by eye.
 */
import { describe, expect, it } from "vitest";
import { CURRENT_SCHEMA_VERSION, MadyDocument, SPLITTABLE_KINDS, dataAxisOf, splitRefusal, tableDatasets, type Project } from "@mady/core";
import { buildPlotScene, splitPins } from "@mady/graphics";
import { galleryItems, type GalleryItem } from "./gallery";

const measure = (t: string, px: number): number => t.length * px * 0.6;
const SIZE = { width: 480, height: 360, measure };

/** Every text the scene draws as data — axis titles excluded: an axis may be NAMED after a
 *  series (a bar+line chart titles its Y axis "Cases") without that series being drawn. */
function sceneTexts(scene: unknown): string[] {
  const out: string[] = [];
  const walk = (n: unknown, key: string, parent: string): void => {
    if (typeof n === "string") {
      if (/^(label|text|name|title)$/.test(key) && !(key === "title" && /^(x|y|y2|y3)$/.test(parent))) out.push(n);
    } else if (Array.isArray(n)) n.forEach((v) => walk(v, key, parent));
    else if (n && typeof n === "object") for (const [k, v] of Object.entries(n)) walk(v, k, key);
  };
  walk(scene, "", "");
  return out;
}

/** A splittable card with ONE series (the histogram) gets a second, shifted one, so its kind is
 *  really split here instead of skipped. */
function withTwoSeries(g: GalleryItem): GalleryItem {
  if (tableDatasets(g.table).length >= 2) return g;
  const lead = g.table.columns.find((c) => c.role === "x");
  const v = g.table.columns.find((c) => c !== lead);
  if (!v) return g;
  const table = {
    ...g.table,
    columns: [...g.table.columns, { ...v, id: "split-2nd", name: "Second series" }],
    rows: g.table.rows.map((r) => ({ ...r, cells: { ...r.cells, "split-2nd": typeof r.cells[v.id] === "number" ? (r.cells[v.id] as number) * 1.5 + 10 : r.cells[v.id] ?? null } })),
  };
  return { ...g, table };
}

const cases = galleryItems().map(withTwoSeries).filter((g) => {
  if (!SPLITTABLE_KINDS.has(g.plot.kind ?? "xy") || g.extraTables?.length) return false;
  return splitRefusal(g.plot, tableDatasets(g.table).length) === null;
});

describe("split into small graphs — every splittable gallery chart", () => {
  it("reaches every splittable chart type (the check cannot pass on an empty list)", () => {
    const kinds = new Set(cases.map((c) => c.plot.kind ?? "xy"));
    expect([...SPLITTABLE_KINDS].filter((k) => !kinds.has(k as NonNullable<typeof cases[number]["plot"]["kind"]>))).toEqual([]);
  });

  // Pinning the range must change nothing on the original's own drawing: an automatic XY range
  // keeps a gap between the axis and the first point, and an exact min/max removes it — the
  // small graphs would then draw their first point on top of the tick numbers.
  it.each(cases.map((c) => [c.key, c] as const))("%s: the pinned range draws the original exactly as before", (_key, item) => {
    const pins = splitPins(item.table, item.plot);
    const pinned = {
      ...item.plot,
      ...(pins.x ? { xAxis: { ...(item.plot.xAxis ?? {}), min: pins.x[0], max: pins.x[1] } } : {}),
      ...(pins.y ? { yAxis: { ...(item.plot.yAxis ?? {}), min: pins.y[0], max: pins.y[1] } } : {}),
    };
    const a = buildPlotScene(item.table, item.plot, SIZE);
    const b = buildPlotScene(item.table, pinned, SIZE);
    for (const v of ["x", "y"] as const) {
      expect(b[v]?.ticks.map((t) => [t.label, Math.round(t.pos)]), `${v} ticks`).toEqual(a[v]?.ticks.map((t) => [t.label, Math.round(t.pos)]));
    }
  });

  it.each(cases.map((c) => [c.key, c] as const))("%s", (_key, item) => {
    const project: Project = {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      tables: [item.table],
      plots: [item.plot],
      analyses: [],
      log: [],
      workspace: { folders: [], loose: [{ kind: "plot", id: item.plot.id }] },
    };
    const doc = new MadyDocument(project);
    const pinsOf = (p: typeof item.plot) => splitPins(item.table, p);
    const { plots } = doc.splitIntoSmallGraphs(item.plot.id, pinsOf(item.plot));
    expect(doc.syncSplitCopies(pinsOf)).toEqual([]);
    const live = doc.toJSON();
    const original = buildPlotScene(item.table, item.plot, SIZE);
    const series = tableDatasets(item.table);
    expect(plots).toHaveLength(series.length);

    for (const copy of live.plots.filter((p) => p.splitFrom)) {
      const scene = buildPlotScene(item.table, copy, SIZE);
      // Its own series is drawn; the others are not (names long enough not to collide with ticks).
      const texts = sceneTexts(scene);
      for (const d of series) {
        if (d.id === copy.splitFrom!.series || d.name.length < 3) continue;
        expect(texts, `${copy.name} still draws "${d.name}"`).not.toContain(d.name);
      }
      // …and by id: a histogram names its bars "Count", so only the id shows which series is drawn.
      const others = new Set(series.map((d) => d.id).filter((id) => id !== copy.splitFrom!.series));
      expect(scene.series.map((s) => s.id).filter((id) => others.has(id)), `${copy.name} draws another series`).toEqual([]);
      // Same range as the original on every numeric axis.
      for (const visual of ["x", "y"] as const) {
        const a = original[visual];
        if (!a || a.band) continue;
        const axis = dataAxisOf(item.plot, visual);
        if (axis !== "x" && axis !== "y") continue;
        expect(scene[visual]?.domain, `${copy.name} ${visual} range`).toEqual(a.domain);
      }
    }
  });
});
