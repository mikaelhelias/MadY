// @vitest-environment jsdom
/**
 * Sort groups — box, violin, column scatter. The bar chart's Sort control (`Plot.barSort`) also
 * orders the groups of a box / violin by the median it draws, and a column scatter by its drawn centre (the mean or the
 * median chosen under Summary). Colours and significance brackets follow their groups.
 *
 * The fixtures are built so the orders disagree: table order ≠ median order ≠ mean order. A fixture whose table order is
 * already sorted cannot tell a sort from no sort.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import type { DataTable, Plot } from "@mady/core";
import { buildPlotScene } from "@mady/graphics";
import { Inspector } from "./Inspector";
import { galleryItems } from "./gallery";

afterEach(cleanup);
const SIZE = { width: 580, height: 380 };

/** Table order A, B, C. Medians: A 3, B 12, C 7 → by median B, C, A. Means: A 22, B 12, C 7 → by mean A, B, C. */
const table = {
  id: "t-sort", kind: "column", name: "Sort",
  columns: [{ id: "a", name: "A", role: "y" }, { id: "b", name: "B", role: "y" }, { id: "c", name: "C", role: "y" }],
  rows: [[1, 10, 5], [2, 11, 6], [3, 12, 7], [4, 13, 8], [100, 14, 9]].map(([a, b, c], i) => ({ id: `r${i}`, cells: { a, b, c } })),
} as unknown as DataTable;
const plotOf = (kind: string, extra: Partial<Plot> = {}): Plot =>
  ({ id: "p-sort", name: "Sort", source: table.id, status: "ok", styleOverrides: {}, kind, ...extra }) as unknown as Plot;

/** Group names in drawn order: along X upright, down Y horizontal. */
function drawnOrder(plot: Plot): string[] {
  const scene = buildPlotScene(table, plot, SIZE);
  const h = plot.barOrientation === "horizontal";
  return scene.series
    .map((s) => ({ name: s.name, at: h ? s.marks[0]!.cy : s.marks[0]!.cx }))
    .sort((p, q) => p.at - q.at)
    .map((p) => p.name);
}

describe("sort groups — the drawn order", () => {
  it("unsorted: table order", () => {
    expect(drawnOrder(plotOf("box"))).toEqual(["A", "B", "C"]);
  });

  for (const kind of ["box", "violin"]) {
    for (const [label, extra] of [["upright", {}], ["horizontal", { barOrientation: "horizontal" }]] as const) {
      it(`${kind} ${label}: by median — Largest first B, C, A; Smallest first A, C, B`, () => {
        expect(drawnOrder(plotOf(kind, { ...extra, barSort: "desc" }))).toEqual(["B", "C", "A"]);
        expect(drawnOrder(plotOf(kind, { ...extra, barSort: "asc" }))).toEqual(["A", "C", "B"]);
      });
    }
  }

  it("column scatter: by the centre it draws — the mean by default, the median when chosen", () => {
    expect(drawnOrder(plotOf("scatter", { barSort: "desc" }))).toEqual(["A", "B", "C"]); // means 22, 12, 7
    expect(drawnOrder(plotOf("scatter", { barSort: "asc" }))).toEqual(["C", "B", "A"]);
    const median = { columnScatter: { center: "median", error: "iqr" } } as Partial<Plot>;
    expect(drawnOrder(plotOf("scatter", { ...median, barSort: "desc" }))).toEqual(["B", "C", "A"]); // medians 3, 12, 7
    expect(drawnOrder(plotOf("scatter", { ...median, barSort: "desc", barOrientation: "horizontal" }))).toEqual(["B", "C", "A"]);
  });

  it("raincloud and floating bar are not sorted (they offer no Sort control)", () => {
    expect(drawnOrder(plotOf("raincloud", { barSort: "desc" }))).toEqual(["A", "B", "C"]);
    expect(drawnOrder(plotOf("floatingbar", { barSort: "desc" }))).toEqual(["A", "B", "C"]);
  });
});

describe("sort groups — what follows the group", () => {
  it("each group keeps its own colour", () => {
    const colours = (p: Plot) => Object.fromEntries(buildPlotScene(table, p, SIZE).series.map((s) => [s.name, s.color]));
    const before = colours(plotOf("box"));
    expect(new Set(Object.values(before)).size, "the fixture's groups must differ in colour").toBe(3);
    expect(colours(plotOf("box", { barSort: "desc" }))).toEqual(before);
  });

  for (const [label, extra] of [["upright", {}], ["horizontal", { barOrientation: "horizontal" }]] as const) {
    it(`${label}: a bracket still joins the groups it names`, () => {
      // A (group 1) vs B (group 2) in table order; sorted desc they are drawn 3rd and 1st.
      const annotations = [{ id: "br1", kind: "bracket", from: 1, to: 2, label: "*" }];
      const plot = plotOf("box", { ...extra, barSort: "desc", annotations } as Partial<Plot>);
      const scene = buildPlotScene(table, plot, SIZE);
      const h = extra.barOrientation === "horizontal";
      const centre = Object.fromEntries(scene.series.map((s) => [s.name, h ? s.marks[0]!.cy : s.marks[0]!.cx]));
      const br = scene.annotations.find((a) => a.kind === "bracket");
      expect(br, "no bracket drawn").toBeDefined();
      const across = [...(br!.path ?? "").matchAll(/(-?[\d.]+)[ ,](-?[\d.]+)/g)].map((m) => (h ? +m[2]! : +m[1]!));
      const nearest = (at: number) => Object.entries(centre).reduce((x, y) => (Math.abs(y[1] - at) < Math.abs(x[1] - at) ? y : x))[0];
      expect(new Set([nearest(Math.min(...across)), nearest(Math.max(...across))])).toEqual(new Set(["A", "B"]));
    });
  }
});

const handlers = (onSetPlotOptions: (p: Partial<Plot>) => void) => ({
  onSelect: vi.fn(),
  onSetAxis: vi.fn(), onSetAxisLength: vi.fn(), onSetAxisTitleFont: vi.fn(),
  onSetSeriesStyle: vi.fn(), onSetSeriesStyleAll: vi.fn(), onSetPointStyle: vi.fn(), onClearPointStyles: vi.fn(),
  onSetGrid: vi.fn(), onSetFrame: vi.fn(), onSetKind: vi.fn(), onSetBarLayout: vi.fn(), onSetBarShape: vi.fn(), onSetBoxWhisker: vi.fn(),
  onSetPlotOptions, onSetGraphTitle: vi.fn(), onSetPlotFont: vi.fn(), onHomogenizeFont: vi.fn(),
  onSetLegend: vi.fn(), onSetSignificance: vi.fn(), onApplyPreset: vi.fn(),
  onApplyUserPreset: vi.fn(), onSaveUserPreset: vi.fn(), onDeleteUserPreset: vi.fn(), onSetProfileDefault: vi.fn(),
  annotationOps: { add: vi.fn(), update: vi.fn(), remove: vi.fn(), reorder: vi.fn(), align: vi.fn(), group: vi.fn(), ungroup: vi.fn(), setLocked: vi.fn(), addImage: vi.fn(), replaceImage: vi.fn() },
});
const sortSelect = (plot: Plot, t: DataTable, onSet: (p: Partial<Plot>) => void = () => {}) =>
  render(<Inspector activeSection="graphs" selection={{ kind: "plot" }} plot={plot} table={t as never} userPresets={[]} profileDefault={null} {...handlers(onSet)} />)
    .container.querySelector<HTMLSelectElement>('select[aria-label="Sort groups"]');

describe("sort groups — the control", () => {
  for (const key of ["box", "violin", "scatter"]) {
    it(`${key}: a Sort groups choice that writes the field the builder reads`, () => {
      const g = galleryItems().find((x) => x.key === key)!;
      const writes: Partial<Plot>[] = [];
      const sel = sortSelect(g.plot, g.table, (p) => writes.push(p));
      expect(sel, `${key}: no Sort groups control`).not.toBeNull();
      expect(sel!.value).toBe("none");
      fireEvent.change(sel!, { target: { value: "desc" } });
      expect(writes).toContainEqual({ barSort: "desc" });
    });
  }

  it("not on a raincloud or a floating bar — it would move nothing", () => {
    for (const key of ["raincloud", "floatingbar"]) {
      const g = galleryItems().find((x) => x.key === key)!;
      expect(sortSelect(g.plot, g.table), key).toBeNull();
    }
  });
});
