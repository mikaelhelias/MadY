// @vitest-environment jsdom
/**
 * 3-D scatter axis numbers take a prefix, suffix, thousands separator and decimal mark.
 *
 * The 3-D builder formats each edge's numbers through the same `tickFormat(spec)` as a 2-D axis and
 * honours all four, so the 3-D edge panel must offer them, not only Format and Decimals. The rows are
 * the 2-D panel's own (`TickAffixRows`), shared by both panels.
 */
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import type { AxisSpec, Plot } from "@mady/core";
import { buildPlotScene } from "@mady/graphics";
import { Inspector } from "./Inspector";
import { galleryItems } from "./gallery";

afterEach(cleanup);

const item = () => galleryItems().find((i) => i.plot.kind === "scatter3d")!;
type Ax = "x" | "y" | "z";

function axisPanel(plot: Plot, axis: Ax) {
  const noop = vi.fn();
  const onSetAxis = vi.fn<(axis: string, patch: Partial<AxisSpec>) => void>();
  // Only the handlers this panel calls are supplied; the rest are never reached here.
  const handlers = {} as ComponentProps<typeof Inspector>;
  const { container } = render(
    <Inspector {...handlers} onSetAxis={onSetAxis} activeSection="graphs" selection={{ kind: "axis", axis }} plot={plot} table={item().table}
      userPresets={[]} profileDefault={null} wholeGraph={false} onSetWholeGraph={noop}
      annotationOps={{ add: noop, update: noop, remove: noop, reorder: noop, align: noop, group: noop, ungroup: noop, setLocked: noop, addImage: noop, replaceImage: noop }} />,
  );
  const row = (label: string) => [...container.querySelectorAll(".frow > span")].find((s) => s.textContent === label)?.parentElement?.querySelector("input, select") as HTMLInputElement | HTMLSelectElement | undefined;
  return { row, onSetAxis };
}

/** Every number drawn on one edge. A big canvas, so all three ladders carry numbers. */
const ladder = (plot: Plot, ai: number): string[] =>
  (buildPlotScene(item().table, plot, { width: 900, height: 800 }).scatter3d as unknown as { axes: { ticks: { label: string }[] }[] }).axes[ai]!.ticks.map((t) => t.label);

describe("3-D scatter edge numbers: prefix / suffix / separators", () => {
  (["x", "y", "z"] as const).forEach((axis, ai) => {
    it(`${axis} edge: each row writes its own axis and reaches the numbers drawn on it`, () => {
      const base = item().plot;
      expect(ladder(base, ai).length, `the ${axis} edge draws no numbers — the fixture cannot exhibit this`).toBeGreaterThan(1);
      const { row, onSetAxis } = axisPanel(base, axis);
      fireEvent.change(row("Prefix")!, { target: { value: "≈" } });
      fireEvent.change(row("Suffix")!, { target: { value: " u" } });
      fireEvent.change(row("Thousands")!, { target: { value: "space" } });
      fireEvent.change(row("Decimal mark")!, { target: { value: "comma" } });
      expect(onSetAxis.mock.calls.every(([a]) => a === axis)).toBe(true);
      const patch = Object.assign({}, ...onSetAxis.mock.calls.map(([, p]) => p)) as AxisSpec;
      expect(patch).toEqual({ prefix: "≈", suffix: " u", thousands: "space", decimalSep: "comma" });
      const key = axis === "x" ? "xAxis" : axis === "y" ? "yAxis" : "zAxis";
      const next = { ...base, [key]: { ...(base[key] ?? {}), ...patch } } as Plot;
      const drawn = ladder(next, ai);
      expect(drawn.length).toBeGreaterThan(0);
      for (const l of drawn) expect(l.startsWith("≈") && l.endsWith(" u"), l).toBe(true);
    });
  });

  /**
   * A suffix makes the numbers wide. A ladder thinned by line height alone would run the X numbers
   * into one another ("10 cm12 cm"), and a number set a short number's half-width off its edge
   * would be crossed by that edge. Measured with the builder's own text measure over each edge,
   * for plain numbers and for wide labels: no two drawn numbers overlap, and no number's box is
   * crossed by its edge.
   */
  it("wide labels neither overlap each other nor cross their own edge", () => {
    const measure = (t: string, px: number): number => t.length * px * 0.6;
    const wide = { ...item().plot, xAxis: { ...(item().plot.xAxis ?? {}), suffix: " cm" }, yAxis: { ...(item().plot.yAxis ?? {}), prefix: "≈", suffix: " u" }, zAxis: { ...(item().plot.zAxis ?? {}), thousands: "comma", suffix: " kg" } } as Plot;
    const hits: string[] = [];
    let labels = 0;
    for (const plot of [item().plot, wide]) {
      const s3 = buildPlotScene(item().table, plot, { width: 800, height: 640, measure }).scatter3d!;
      s3.axes.forEach((a, ai) => {
        const size = a.tickFont?.size ?? 13;
        const box = (t: { lx: number; ly: number; label: string }) => ({ x1: t.lx - measure(t.label, size) / 2, x2: t.lx + measure(t.label, size) / 2, y1: t.ly - size * 0.75, y2: t.ly + size * 0.2 });
        const ticks = (a.ticks ?? []).filter((t) => t.label);
        labels += ticks.length;
        for (let i = 0; i < ticks.length; i++) {
          const b = box(ticks[i]!);
          for (let j = i + 1; j < ticks.length; j++) {
            const c = box(ticks[j]!);
            if (b.x1 < c.x2 - 1 && c.x1 < b.x2 - 1 && b.y1 < c.y2 - 1 && c.y1 < b.y2 - 1) hits.push(`edge ${ai}: "${ticks[i]!.label}" on "${ticks[j]!.label}"`);
          }
          // Does the edge segment pass through this label's box? Sample it.
          for (let k = 0; k <= 200; k++) {
            const x = a.x1 + ((a.x2 - a.x1) * k) / 200, y = a.y1 + ((a.y2 - a.y1) * k) / 200;
            if (x > b.x1 + 1 && x < b.x2 - 1 && y > b.y1 + 1 && y < b.y2 - 1) { hits.push(`edge ${ai} crosses "${ticks[i]!.label}"`); break; }
          }
        }
      });
    }
    expect(labels, "no numbers drawn — the fixture cannot exhibit this").toBeGreaterThan(6);
    expect(hits).toEqual([]);
  });

  /**
   * Guards against axis numbers clashing with data points (e.g. "≈6 u" or "10 cm" drawn under a
   * point) when the ladders are placed without regard to the points. Measured from each point's
   * edge, so the clearance holds for small and big points alike, over three point sizes, plain and
   * wide labels, and several camera angles.
   */
  it("no drawn number comes within a fixed gap of a data point's edge", () => {
    const measure = (t: string, px: number): number => t.length * px * 0.6;
    const base = item().plot;
    const hits: string[] = [];
    let numbers = 0;
    for (const size of [4, 7, 12]) {
      for (const az of [undefined, 0.3, 1.2]) {
        for (const wide of [false, true]) {
          const styles = Object.fromEntries(Object.entries(base.seriesStyles ?? {}).map(([k, v]) => [k, { ...v, symbolSize: size }]));
          const plot = {
            ...base, seriesStyles: styles,
            ...(az !== undefined ? { scatter3d: { ...(base.scatter3d ?? {}), azimuth: az } } : {}),
            ...(wide ? { yAxis: { ...(base.yAxis ?? {}), prefix: "≈", suffix: " u" }, xAxis: { ...(base.xAxis ?? {}), suffix: " cm" } } : {}),
          } as Plot;
          const s3 = buildPlotScene(item().table, plot, { width: 800, height: 640, measure }).scatter3d!;
          s3.axes.forEach((a, ai) => {
            const fs = a.tickFont?.size ?? 13;
            for (const t of a.ticks ?? []) {
              numbers++;
              const w = measure(t.label, fs);
              const x1 = t.lx - w / 2, x2 = t.lx + w / 2, y1 = t.ly - fs * 0.75, y2 = t.ly + fs * 0.25;
              for (const q of s3.points) {
                const d = Math.hypot(q.x - Math.min(Math.max(q.x, x1), x2), q.y - Math.min(Math.max(q.y, y1), y2));
                if (d < q.r + 3.5) { hits.push(`size ${size} az ${az ?? "default"} ${wide ? "wide" : "plain"} edge ${ai}: "${t.label}" ${(d - q.r).toFixed(1)} px from a point`); break; }
              }
            }
          });
        }
      }
    }
    expect(numbers, "no numbers drawn — cannot exhibit this").toBeGreaterThan(40);
    expect(hits).toEqual([]);
    // …and clearing the points must not cost the scale: dropping every clashing number would leave
    // the 580×380 gallery card with no numbers at all.
    const card = buildPlotScene(item().table, base, { width: 580, height: 380, measure }).scatter3d!;
    expect(card.axes.reduce((n, a) => n + (a.ticks?.length ?? 0), 0)).toBeGreaterThan(0);
    // At a page size, every edge keeps its ladder: the clashing ones step out instead of vanishing.
    const page = buildPlotScene(item().table, { ...base, yAxis: { ...(base.yAxis ?? {}), prefix: "≈", suffix: " u" } } as Plot, { width: 800, height: 640, measure }).scatter3d!;
    expect(page.axes.map((a) => (a.ticks?.length ?? 0) >= 3)).toEqual([true, true, true]);
  });
});
