// @vitest-environment jsdom
/**
 * Notched box plots. `SeriesStyle.boxNotch` notches the box at the median:
 * the notch spans median ± 1.58·IQR/√n, an approximate 95% CI of the median (McGill, Tukey & Larsen 1978).
 *
 * The notch's ends are checked against an independent recomputation from the raw table (own sort + own quartiles), mapped
 * to pixels through the box's own quartile pixels — nothing shared with the builder. The drawing is checked too: the box
 * becomes a notched outline whose waist sits at the median, a quarter of the box's width in on each side. Refusals come
 * with a warning: mean-centred whiskers draw no median box, so no notch and a warning; a notch past the box is drawn and warned.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import type { DataTable, Plot } from "@mady/core";
import { buildPlotScene } from "@mady/graphics";
import { PlotFigure } from "./PlotFigure";
import { Inspector } from "./Inspector";
import { galleryItems } from "./gallery";

afterEach(cleanup);
const SIZE = { width: 580, height: 380 };
const card = (key: string) => galleryItems().find((g) => g.key === key)!;

/** Every series notched. */
function notched(plot: Plot, ids: string[], extra: Partial<Plot> = {}): Plot {
  const ss = { ...(plot.seriesStyles ?? {}) } as Record<string, object>;
  for (const id of ids) ss[id] = { ...(ss[id] ?? {}), boxNotch: true };
  return { ...plot, ...extra, seriesStyles: ss } as Plot;
}
const seriesIds = (table: DataTable, plot: Plot) => buildPlotScene(table, plot, SIZE).series.map((s) => s.id);

/** The raw values of one column-table group — read straight from the cells. */
function rawValues(table: DataTable, id: string): number[] {
  return table.rows.map((r) => Number((r.cells as Record<string, unknown>)[id])).filter((v) => Number.isFinite(v));
}
/** Quartile by linear interpolation between order statistics (R type 7), written out here, not imported. */
function q(sorted: number[], p: number): number {
  const h = (sorted.length - 1) * p;
  const lo = Math.floor(h);
  return sorted[lo]! + (h - lo) * ((sorted[Math.min(lo + 1, sorted.length - 1)] ?? sorted[lo]!) - sorted[lo]!);
}

describe("notched box — the numbers", () => {
  for (const [label, extra] of [["upright", {}], ["horizontal", { barOrientation: "horizontal" }]] as const) {
    it(`${label}: each notch spans median ± 1.58·IQR/√n of its group's raw values`, () => {
      const g = card("box");
      const ids = seriesIds(g.table, g.plot);
      const scene = buildPlotScene(g.table, notched(g.plot, ids, extra), SIZE);
      let checked = 0;
      for (const s of scene.series) {
        const vals = rawValues(g.table, s.id).sort((a, b) => a - b);
        expect(vals.length, `no raw values for ${s.id} — the oracle reads the wrong cells`).toBeGreaterThan(3);
        const q1 = q(vals, 0.25), med = q(vals, 0.5), q3 = q(vals, 0.75);
        const half = (1.58 * (q3 - q1)) / Math.sqrt(vals.length);
        for (const m of s.marks) {
          const b = m.box;
          if (!b) continue;
          expect(b.notch, `${s.id}: no notch`).toBeDefined();
          // Value → pixel through the box's own quartile pixels (a straight line on a linear axis).
          const px = (v: number) => b.q1 + ((v - q1) * (b.q3 - b.q1)) / (q3 - q1);
          expect(b.median!).toBeCloseTo(px(med), 6);
          expect(b.notch!.low).toBeCloseTo(px(med - half), 6);
          expect(b.notch!.high).toBeCloseTo(px(med + half), 6);
          checked++;
        }
      }
      expect(checked).toBeGreaterThan(1);
    });
  }

  it("off by default: no notch anywhere", () => {
    const g = card("box");
    for (const s of buildPlotScene(g.table, g.plot, SIZE).series) for (const m of s.marks) expect(m.box?.notch).toBeUndefined();
  });

  for (const key of ["violin", "raincloud"]) {
    it(`${key}: the inner box is notched`, () => {
      const g = card(key);
      const scene = buildPlotScene(g.table, notched(g.plot, seriesIds(g.table, g.plot)), SIZE);
      const boxes = scene.series.flatMap((s) => s.marks.map((m) => m.box).filter((b) => b && !b.meanOnly));
      expect(boxes.length).toBeGreaterThan(1);
      for (const b of boxes) expect(b!.notch, key).toBeDefined();
    });
  }
});

describe("notched box — a notch that cannot be drawn is warned about", () => {
  for (const w of ["sd", "sem", "ci95"] as const) {
    it(`whiskers at mean ± ${w}: no notch, and a warning says why`, () => {
      const g = card("box");
      const scene = buildPlotScene(g.table, notched(g.plot, seriesIds(g.table, g.plot), { boxWhisker: w }), SIZE);
      for (const s of scene.series) for (const m of s.marks) expect(m.box?.notch).toBeUndefined();
      expect(scene.warnings.some((x) => x.includes("no notch") && x.includes("mean"))).toBe(true);
    });
  }

  it("a notch past the box (few values) is drawn, and warned", () => {
    const table: DataTable = {
      id: "t-few", kind: "column", name: "Few",
      columns: [{ id: "a", name: "A", role: "y" }, { id: "b", name: "B", role: "y" }],
      rows: [[1, 4], [2, 5], [3, 9], [9, 6]].map(([a, b], i) => ({ id: `r${i}`, cells: { a, b } })),
    } as DataTable;
    const plot = { id: "p-few", name: "Few", source: table.id, status: "ok", styleOverrides: {}, kind: "box" } as unknown as Plot;
    const scene = buildPlotScene(table, notched(plot, seriesIds(table, plot)), SIZE);
    const b = scene.series[0]!.marks.find((m) => m.box)!.box!;
    expect(b.notch, "the fixture must draw a notch").toBeDefined();
    const past = Math.min(b.notch!.low, b.notch!.high) < Math.min(b.q1, b.q3) || Math.max(b.notch!.low, b.notch!.high) > Math.max(b.q1, b.q3);
    expect(past, "the fixture's notch must reach past its box, or it proves nothing").toBe(true);
    expect(scene.warnings).toContain("“A”: its notch is taller than its box — too few values (or a very lopsided group) to pin down the median.");
  });

  it("equal quartiles: no notch, and a warning says why", () => {
    const table = {
      id: "t-flat", kind: "column", name: "Flat",
      columns: [{ id: "a", name: "A", role: "y" }, { id: "b", name: "B", role: "y" }],
      rows: [5, 5, 5, 5, 5, 9].map((a, i) => ({ id: `r${i}`, cells: { a, b: i + 1 } })),
    } as unknown as DataTable;
    const plot = { id: "p-flat", name: "Flat", source: table.id, status: "ok", styleOverrides: {}, kind: "box" } as unknown as Plot;
    const scene = buildPlotScene(table, notched(plot, seriesIds(table, plot)), SIZE);
    const flat = scene.series.find((x) => x.id === "a");
    expect(flat, "the fixture does not draw the flat group").toBeDefined();
    expect(flat!.marks.find((m) => m.box)!.box!.notch).toBeUndefined();
    expect(scene.warnings.some((x) => x.includes("quartiles are equal"))).toBe(true);
  });
});

describe("notched box — the drawing", () => {
  /** The outline paths' points as [x, y] pairs. */
  const outlines = (c: HTMLElement) =>
    [...c.querySelectorAll("svg.gfx-figure path")]
      .map((p) => [...(p.getAttribute("d") ?? "").matchAll(/(-?[\d.]+),(-?[\d.]+)/g)].map((m) => [+m[1]!, +m[2]!] as const))
      .filter((pts) => pts.length === 10);

  for (const [label, key, extra] of [
    ["box", "box", {}],
    ["horizontal box", "box", { barOrientation: "horizontal" }],
    ["violin inner box", "violin", {}],
    ["raincloud inner box", "raincloud", {}],
  ] as [string, string, Partial<Plot>][]) {
    it(`${label}: the box is drawn notched — its waist at the median, a quarter of its width in on each side`, () => {
      const g = card(key);
      const scene = buildPlotScene(g.table, notched(g.plot, seriesIds(g.table, g.plot), extra), SIZE);
      const h = extra.barOrientation === "horizontal";
      const { container } = render(<PlotFigure scene={scene} />);
      const drawn = outlines(container);
      const boxes = scene.series.flatMap((s) => s.marks.map((m) => m.box).filter((b) => b?.notch));
      expect(boxes.length).toBeGreaterThan(1);
      for (const b of boxes) {
        // The two waist points: at the median on the value axis, x + w/4 and x + 3w/4 across.
        const waist = (side: number) => drawn.some((pts) => pts.some(([x, y]) => Math.abs((h ? x : y) - b!.median!) < 0.02 && Math.abs((h ? y : x) - side) < 0.02));
        expect(waist(b!.x + b!.w / 4), "no notch waist drawn on one side").toBe(true);
        expect(waist(b!.x + (3 * b!.w) / 4), "no notch waist drawn on the other side").toBe(true);
      }
    });
  }

  it("without the notch the box is a plain rectangle", () => {
    const g = card("box");
    const { container } = render(<PlotFigure scene={buildPlotScene(g.table, g.plot, SIZE)} />);
    expect(outlines(container).length).toBe(0);
  });
});

const handlers = (onSetSeriesStyle: (id: string, p: object) => void) => ({
  onSelect: vi.fn(),
  onSetAxis: vi.fn(), onSetAxisLength: vi.fn(), onSetAxisTitleFont: vi.fn(),
  // Violin / raincloud restyle every group at once by default ("changes restyle every violin"): that write is caught too.
  onSetSeriesStyle, onSetSeriesStyleAll: (_ids: string[], p: object) => onSetSeriesStyle("*", p), onSetPointStyle: vi.fn(), onClearPointStyles: vi.fn(),
  onSetGrid: vi.fn(), onSetFrame: vi.fn(), onSetKind: vi.fn(), onSetBarLayout: vi.fn(), onSetBarShape: vi.fn(), onSetBoxWhisker: vi.fn(),
  onSetPlotOptions: vi.fn(), onSetGraphTitle: vi.fn(), onSetPlotFont: vi.fn(), onHomogenizeFont: vi.fn(),
  onSetLegend: vi.fn(), onSetSignificance: vi.fn(), onApplyPreset: vi.fn(),
  onApplyUserPreset: vi.fn(), onSaveUserPreset: vi.fn(), onDeleteUserPreset: vi.fn(), onSetProfileDefault: vi.fn(),
  annotationOps: { add: vi.fn(), update: vi.fn(), remove: vi.fn(), reorder: vi.fn(), align: vi.fn(), group: vi.fn(), ungroup: vi.fn(), setLocked: vi.fn(), addImage: vi.fn(), replaceImage: vi.fn() },
});
function notchBox(plot: Plot, table: DataTable, onSet: (id: string, p: object) => void = () => {}) {
  const id = seriesIds(table, plot)[0]!;
  const { container } = render(
    <Inspector activeSection="graphs" selection={{ kind: "series", columnId: id } as never} plot={plot} table={table as never}
      userPresets={[]} profileDefault={null} wholeGraph={false} onSetWholeGraph={() => {}} {...handlers(onSet)} />,
  );
  const lab = [...container.querySelectorAll("label")].find((l) => (l.querySelector("span:first-child")?.textContent ?? "").trim() === "Notch");
  return lab?.querySelector<HTMLInputElement>('input[type="checkbox"]') ?? null;
}

describe("notched box — the control", () => {
  for (const key of ["box", "violin", "raincloud"]) {
    it(`${key}: a Notch switch beside the median controls, writing the field the builder reads`, () => {
      const g = card(key);
      const writes: object[] = [];
      const box = notchBox(g.plot, g.table, (_id, p) => writes.push(p));
      expect(box, `${key}: no Notch switch`).not.toBeNull();
      expect(box!.checked).toBe(false);
      fireEvent.click(box!);
      expect(writes).toContainEqual({ boxNotch: true });
    });
  }

  it("hidden where nothing can be notched: mean-centred whiskers, and a floating bar's range", () => {
    const g = card("box");
    expect(notchBox({ ...g.plot, boxWhisker: "sd" } as Plot, g.table)).toBeNull();
    const f = card("floatingbar");
    expect(notchBox(f.plot, f.table)).toBeNull();
  });
});
