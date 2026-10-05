// @vitest-environment jsdom
/**
 * The outside-top legend, as drawn — and on every gallery card that has a legend.
 *
 * The builder side (`packages/graphics/src/legend-top.test.ts`) proves the band is reserved.
 * This side proves the renderer puts the rows in that band: every legend word sits below the
 * title and above the plot rect, inside the figure, on the rows the builder decided. Measured
 * off the rendered `<text>` positions, not the scene — a scene field the renderer ignores is
 * exactly the class of defect a scene-only check would miss.
 *
 * Note: the sweep is what makes "every chart kind" a verified claim: the band rides on the
 * plot's top padding, and a builder that ignores its padding would draw the legend on its
 * own plot. Each card is built with "top" and with "none" and the plot rect must move by the
 * band; then each rendered word must be in the band.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import type { Plot } from "@mady/core";
import { buildPlotScene, legendRowMetrics, topLegendBand } from "@mady/graphics";
import type { PlotScene } from "@mady/graphics";
import { PlotFigure } from "./PlotFigure";
import { Inspector } from "./Inspector";
import { galleryItems } from "./gallery";

afterEach(cleanup);

const SIZE = { width: 620, height: 420 };
const estimate = (t: string, px: number): number => t.length * px * 0.6;
type Card = { table: never; plot: Plot };
const withLegend = (plot: Plot, position: "top" | "none"): Plot => ({ ...plot, legend: { ...plot.legend, show: true, position } });

/** The heading's bottom edge (px) — the title band the renderer draws from y = 8. */
const headingBottom = (s: PlotScene): number => {
  if (!s.title && !s.subtitle) return 0;
  const t = s.title ? 8 + s.fonts.title.size * (1 + (s.title.split("\n").length - 1) * 1.2) + 4 : 8;
  return s.subtitle ? t + s.fonts.subtitle.size * (1 + (s.subtitle.split("\n").length - 1) * 1.2) : t;
};

/** Every legend word's (x, y) as rendered. */
function legendWords(s: PlotScene): { text: string; x: number; y: number }[] {
  const { container, unmount } = render(<PlotFigure scene={s} />);
  const out = [...container.querySelectorAll("g.gfx-legend text")].map((t) => ({
    text: t.textContent ?? "",
    x: Number(t.getAttribute("x")),
    y: Number(t.getAttribute("y")),
  }));
  unmount();
  return out;
}

describe("outside-top legend — drawn in its band", () => {
  const xy = (galleryItems() as unknown as Card[]).find((c) => (c.plot.kind ?? "xy") === "xy")!;

  it("every legend word sits below the title and above the plot, inside the figure", () => {
    const s = buildPlotScene(xy.table, withLegend(xy.plot, "top"), SIZE);
    expect(s.legend.length).toBeGreaterThan(1);
    const words = legendWords(s);
    expect(words.length).toBe(s.legend.length);
    for (const w of words) {
      expect(w.y, `"${w.text}" is not above the plot (y ${w.y} vs plot top ${s.plot.y})`).toBeLessThan(s.plot.y);
      expect(w.y - s.fonts.legend.size, `"${w.text}" is on the title (y ${w.y} vs heading bottom ${headingBottom(s)})`).toBeGreaterThanOrEqual(headingBottom(s));
      expect(w.x).toBeGreaterThanOrEqual(0);
      expect(w.x).toBeLessThan(s.width);
    }
  });

  it("the rows are the BUILDER's rows — a wrapped legend draws one line of words per row", () => {
    const wide: Plot = {
      ...xy.plot,
      seriesStyles: undefined,
    };
    // Force a wrap: a narrow figure, big legend type.
    const s = buildPlotScene(xy.table, { ...withLegend(wide, "top"), fonts: { ...wide.fonts, legend: { size: 22 } } }, { width: 360, height: 420 });
    const rows = s.legendLayout.topRows ?? [];
    expect(rows.length, "the fixture did not wrap — it cannot exhibit the bug").toBeGreaterThanOrEqual(2);
    const words = legendWords(s);
    const ys = new Set(words.map((w) => w.y));
    expect(ys.size).toBe(rows.length);
    // …and every row is centred on the plot: its words' extent straddles the plot's midline.
    const mid = s.plot.x + s.plot.width / 2;
    for (const r of rows) {
      const xs = r.map((i) => words[i]!.x);
      expect(Math.min(...xs)).toBeLessThan(mid);
    }
  });

  it("the Inspector's Position control offers it", () => {
    const handlers = {
      onSelect: vi.fn(), onSetAxis: vi.fn(), onSetAxisLength: vi.fn(), onSetAxisTitleFont: vi.fn(),
      onSetSeriesStyle: vi.fn(), onSetSeriesStyleAll: vi.fn(), onSetPointStyle: vi.fn(), onClearPointStyles: vi.fn(),
      onSetGrid: vi.fn(), onSetFrame: vi.fn(), onSetKind: vi.fn(), onSetBarLayout: vi.fn(), onSetBarShape: vi.fn(), onSetBoxWhisker: vi.fn(),
      onSetPlotOptions: vi.fn(), onSetGraphTitle: vi.fn(), onSetPlotFont: vi.fn(), onHomogenizeFont: vi.fn(),
      onSetLegend: vi.fn(), onSetSignificance: vi.fn(), onApplyPreset: vi.fn(), 
      onApplyUserPreset: vi.fn(), onSaveUserPreset: vi.fn(), onDeleteUserPreset: vi.fn(), onSetProfileDefault: vi.fn(),
      annotationOps: { add: vi.fn(), update: vi.fn(), remove: vi.fn(), reorder: vi.fn(), align: vi.fn(), group: vi.fn(), ungroup: vi.fn(), setLocked: vi.fn(), addImage: vi.fn(), replaceImage: vi.fn() },
    };
    const { container } = render(
      <Inspector activeSection="graphs" selection={{ kind: "plot" }} plot={xy.plot} table={xy.table}
        userPresets={[]} profileDefault={null} {...handlers} />,
    );
    const opt = [...container.querySelectorAll("option")].find((o) => (o as HTMLOptionElement).value === "top");
    expect(opt, "no 'top' option in the legend Position control").toBeTruthy();
  });
});

describe("outside-top legend — every gallery card that has a legend honours it", () => {
  const cards = (galleryItems() as unknown as Card[]).filter(
    (c) => buildPlotScene(c.table, withLegend(c.plot, "top"), SIZE).legend.length > 0,
  );

  it("a useful number of cards draw a legend — otherwise the sweep is vacuous", () => {
    expect(cards.length).toBeGreaterThan(20);
  });

  it("the plot rect moves down by the band on every one, and every word lands in the band", () => {
    const wrong: string[] = [];
    for (const c of cards) {
      const name = `${c.plot.kind ?? "xy"} (${c.plot.name})`;
      const top = buildPlotScene(c.table, withLegend(c.plot, "top"), SIZE);
      if (top.legendLayout.position !== "top") { wrong.push(`${name}: fell back to ${top.legendLayout.position}`); continue; }
      const none = buildPlotScene(c.table, withLegend(c.plot, "none"), SIZE);
      const band = topLegendBand((top.legendLayout.topRows ?? []).length, legendRowMetrics(top, estimate));
      if (band <= 0) { wrong.push(`${name}: no band`); continue; }
      if (top.fonts.tick.size === none.fonts.tick.size && top.fonts.legend.size === none.fonts.legend.size) {
        // Same type size in both builds: the band is the only difference, so the plot moves by exactly the band.
        if (Math.abs(top.plot.y - none.plot.y - band) > 0.5) wrong.push(`${name}: plot moved ${top.plot.y - none.plot.y}px for a ${band}px band`);
      } else {
        // The kind fits its type to the room (the rose does), so the band's room also shrinks the text and every
        // margin sized from it; a build without a band is at another type size and cannot be the reference. The
        // reference is the same room taken away with no legend: the band reserved from the first pass (as the
        // builder reserves it) added to the top padding. Both builds then fit the same room, so the plot must sit
        // at the same place, and the legend as drawn must fit inside the room reserved for it.
        const first = buildPlotScene(c.table, withLegend(c.plot, "top"), { ...SIZE, topLegendBand: 0 });
        const reserved = topLegendBand((first.legendLayout.topRows ?? []).length, legendRowMetrics(first, estimate));
        const same = buildPlotScene(c.table, { ...withLegend(c.plot, "none"), plotPad: { ...(c.plot.plotPad ?? {}), top: (c.plot.plotPad?.top ?? 0) + reserved } }, SIZE);
        if (Math.abs(top.plot.y - same.plot.y) > 0.5) wrong.push(`${name}: plot at y ${top.plot.y}, but ${same.plot.y} with the same room and no legend`);
        if (band > reserved + 0.5) wrong.push(`${name}: the legend as drawn needs ${band}px, but ${reserved}px was reserved`);
      }
      const words = legendWords(top);
      if (words.length !== top.legend.length) { wrong.push(`${name}: ${words.length} words drawn for ${top.legend.length} rows`); continue; }
      const floor = headingBottom(top);
      for (const w of words) {
        if (!(w.y < top.plot.y)) wrong.push(`${name}: "${w.text}" at y ${w.y} is not above the plot (${top.plot.y})`);
        if (!(w.y - top.fonts.legend.size >= floor)) wrong.push(`${name}: "${w.text}" at y ${w.y} is on the heading (bottom ${floor})`);
        if (!(w.x >= 0 && w.x < top.width)) wrong.push(`${name}: "${w.text}" at x ${w.x} is off the figure`);
      }
    }
    expect(wrong, `outside-top legend defects:\n  - ${wrong.join("\n  - ")}\n`).toEqual([]);
  }, 120_000);
});
