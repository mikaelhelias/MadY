// @vitest-environment jsdom
/**
 * Every number in a per-kind house default must change the drawing.
 *
 * `KIND_HOUSE_DEFAULTS` holds each kind's tuned look. A refactor that stopped (say) radar's
 * 21px legend from reaching the figure would revert the tuned look silently: nothing else
 * reports it, and the only sign is a smaller legend on screen.
 *
 * Derived from the map, leaf by leaf: a new entry is covered the moment it is added, and a
 * failure names the exact path that does not change the drawing rather than "this kind broke".
 *
 * Method — perturb one value at a time on the real gallery plot for that kind, and compare the
 * rendered markup:
 *
 *   Note: compare the markup, not the scene. A scene carries the spec it was handed
 *   (`scene.fonts.legend` is literally the number passed in), so comparing scenes reports
 *   "it moved" for a value nothing draws with — e.g. a heatmap colour-bar font or a
 *   column-scatter swarm width that the renderer ignores.
 *
 *   Note: use the gallery plot, not a bare one. A plot built from `{kind, source}` alone has
 *   no groups and no second series, so it draws no legend and no group dots, and pcascore /
 *   pcaload / survival / roc defaults would be reported as having no effect, with nothing for
 *   them to style.
 *   A fixture that cannot exhibit the value cannot measure it.
 *
 * This checks the defaults are alive. `kind-house-defaults.test.ts` checks that specific
 * defaults still hold their tuned values.
 */
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { KIND_HOUSE_DEFAULTS, type PlotKind, type Plot, type DataTable } from "@mady/core";
import { buildPlotScene } from "@mady/graphics";
import { galleryItems } from "./gallery";
import { PlotFigure } from "./PlotFigure";

const SIZE = { width: 620, height: 420 };
const KINDS = Object.keys(KIND_HOUSE_DEFAULTS) as PlotKind[];
type J = Record<string, unknown>;
const isObj = (v: unknown): v is J => !!v && typeof v === "object" && !Array.isArray(v);

const card = (kind: PlotKind): { table: DataTable; plot: Plot } => {
  const item = galleryItems().find((i) => (i.plot.kind ?? "xy") === kind);
  if (!item) throw new Error(`no gallery card for "${kind}" — its card is what previews the default, so a kind default without one cannot be measured`);
  return item as unknown as { table: DataTable; plot: Plot };
};

/**
 * Note: the plot's own size wins when it has one. Passing a fixed width/height would override
 * `figureWidth`/`figureHeight`, so every figure-size default would measure as dead — the
 * measurement would be holding fixed the very thing it tests.
 */
const draw = (table: DataTable, plot: Plot): string => {
  const size = {
    width: (plot as unknown as J).figureWidth as number ?? SIZE.width,
    height: (plot as unknown as J).figureHeight as number ?? SIZE.height,
  };
  return renderToStaticMarkup(createElement(PlotFigure, { scene: buildPlotScene(table, plot, size) }));
};

/** Every numeric / boolean leaf of a house-default entry, as a dotted path. Strings are skipped:
 *  there is no safe "different" value for an enum or a colour name, so they are reported instead
 *  of guessed at (see the `strings` test below). */
function leaves(v: unknown, path: string[] = []): { path: string[]; value: number | boolean }[] {
  if (typeof v === "number" || typeof v === "boolean") return [{ path, value: v }];
  if (isObj(v)) return Object.entries(v).flatMap(([k, x]) => leaves(x, [...path, k]));
  return [];
}

/**
 * A value that is definitely different — and different enough to be visible once rendered.
 * Note: halving a small number is not: `symbolSize` 2 → 1 rounds to the same drawn radius and
 * would report a live default as dead. Small values move up by 3 instead, which survives rounding
 * (and survives clamping: a 0–1 field pinned to its maximum still differs from 0.22).
 */
const perturb = (v: number | boolean): number | boolean =>
  typeof v === "boolean" ? !v : v > 2 ? Math.round(v / 2) : v + 3;

/** Deep-clone `plot` with one path set — mirroring where each house-default block is applied. */
function withLeaf(plot: Plot, section: string, path: string[], value: number | boolean): Plot {
  const next = JSON.parse(JSON.stringify(plot)) as J;
  const setIn = (root: J, keys: string[]): void => {
    let cur = root;
    for (const k of keys.slice(0, -1)) {
      if (!isObj(cur[k])) cur[k] = {};
      cur = cur[k] as J;
    }
    cur[keys[keys.length - 1]!] = value;
  };
  if (section === "plot") setIn(next, path);
  else if (section === "fonts") setIn(next, ["fonts", ...path]);
  else if (section === "axes") setIn(next, [`${path[0]}Axis`, ...path.slice(1)]);
  else if (section === "series") {
    const ss = (next.seriesStyles ?? {}) as J;
    for (const id of Object.keys(ss)) setIn(ss, [id, ...path]);
    next.seriesStyles = ss;
  } else if (section === "seriesStyles") setIn(next, ["seriesStyles", ...path]);
  return next as unknown as Plot;
}

describe("guarding the guard", () => {
  it("covers every kind in the map, derived rather than listed", () => {
    expect(KINDS.length, "the map shrank — this file is measuring less than it claims").toBeGreaterThanOrEqual(20);
    for (const k of ["xy", "radar", "roc", "pcascore"]) expect(KINDS).toContain(k);
  });

  it("finds a real number to perturb in most entries", () => {
    // If `leaves` silently returned nothing, every case below would pass vacuously.
    const counted = KINDS.map((k) => Object.entries(KIND_HOUSE_DEFAULTS[k]!).flatMap(([s, v]) => leaves(v).map((l) => `${k}.${s}.${l.path.join(".")}`)).length);
    expect(counted.filter((n) => n > 0).length, "no house default has a numeric value — `leaves` is broken").toBeGreaterThan(15);
  });
});

/**
 * A card that draws no legend cannot exhibit a `legend.*` default — the same trap as the bare
 * plot in the header, one section down. The bar card is single-series (one factor, so its
 * vs-control significance brackets read correctly), so bar's `legend.symbolScale` would measure
 * as dead on it. The default is alive: a user's bar graph with two datasets draws the 1.6× key.
 * So a legend leaf on a legend-less card gets the lead dataset cloned as a second series —
 * fixture completion, applied to both sides of the comparison; every other leaf still
 * measures on the card exactly as shipped.
 */
function withLegend(table: DataTable, plot: Plot): { table: DataTable; plot: Plot } {
  if (buildPlotScene(table, plot, SIZE).legend.length > 0) return { table, plot };
  const lead = table.columns.find((c) => c.role === "y" && !c.group);
  if (!lead) return { table, plot };
  const clone = `${lead.id}-efficacy-b`;
  return {
    plot,
    table: {
      ...table,
      columns: [...table.columns, { id: clone, name: `${lead.name} B`, role: "y" }],
      rows: table.rows.map((r) => ({ ...r, cells: { ...r.cells, [clone]: (Number(r.cells[lead.id]) || 0) + 2 } })),
    },
  };
}

describe("every value in a per-kind house default reaches the drawing", () => {
  for (const kind of KINDS) {
    const entry = KIND_HOUSE_DEFAULTS[kind]! as unknown as J;
    for (const [section, block] of Object.entries(entry)) {
      for (const leaf of leaves(block)) {
        const label = `${section}.${leaf.path.join(".")}`;
        it(`${kind} — ${label}`, () => {
          const raw = card(kind);
          const { table, plot } = section === "plot" && leaf.path[0] === "legend" ? withLegend(raw.table, raw.plot) : raw;
          const other = perturb(leaf.value);
          const as_is = draw(table, plot);
          const changed = draw(table, withLeaf(plot, section, leaf.path, other));
          expect(
            changed,
            `${kind}: ${label} is ${JSON.stringify(leaf.value)}, and rendering it as ${JSON.stringify(other)} changes NOTHING — the default is dead (either the drawing ignores the field on this kind, or something overwrites it first)`,
          ).not.toBe(as_is);
        });
      }
    }
  }
});

/**
 * The values this file cannot perturb, listed so they are visible rather than silently uncovered.
 * A string default (a colour, an enum, an axis title) has no safe "different" value to swap in.
 */
describe("what is not covered above", () => {
  it("names every string-valued default", () => {
    const strings: string[] = [];
    const walk = (v: unknown, p: string[]): void => {
      if (typeof v === "string") { strings.push(p.join(".")); return; }
      if (isObj(v)) for (const [k, x] of Object.entries(v)) walk(x, [...p, k]);
    };
    for (const kind of KINDS) walk(KIND_HOUSE_DEFAULTS[kind], [kind]);
    // Not an assertion about which ones — just that the list is knowable and small enough to review.
    expect(strings.length, `string defaults are unmeasured by this file: ${strings.join(", ")}`).toBeLessThan(12);
  });
});
