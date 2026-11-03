// @vitest-environment jsdom
/**
 * Heatmap gaps between cells: a thin page-coloured
 * gap between tiles means every colour is compared against the same neutral colour instead of its
 * neighbours (the simultaneous-contrast illusion).
 *
 * Guards against the width slider alone doing nothing: with no colour chosen, the gap is still
 * drawn (in the page colour) rather than left out while the colour box shows white as if a colour
 * were set.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import type { Plot } from "@mady/core";
import { buildPlotScene } from "@mady/graphics";
import { PlotFigure } from "./PlotFigure";
import { Inspector } from "./Inspector";
import { galleryItems } from "./gallery";
import type { GraphSelection } from "./AppShell";

afterEach(cleanup);
afterEach(() => document.documentElement.style.removeProperty("--bg"));

const card = galleryItems().find((i) => i.plot.kind === "heatmap")!;
const withHeat = (hm: NonNullable<Plot["heatmap"]>): Plot => ({ ...card.plot, heatmap: { ...(card.plot.heatmap ?? {}), ...hm } });
/** The value cells: the rects the heatmap draws with its border settings. */
const cellStrokes = (plot: Plot): Set<string> => {
  const s = buildPlotScene(card.table, plot, { width: 500, height: 400 });
  const { container } = render(<PlotFigure scene={s} />);
  const fills = new Set(s.heatmap!.cells.map((c) => c.color));
  const out = new Set([...container.querySelectorAll("rect")].filter((r) => fills.has(r.getAttribute("fill") ?? "")).map((r) => `${r.getAttribute("stroke")}|${r.getAttribute("stroke-width")}`));
  cleanup();
  return out;
};

describe("heatmap gap — the drawing", () => {
  it("the fixture starts with no gap (so it can show a missing gap)", () => {
    expect(card.plot.heatmap?.cellBorderColor).toBeUndefined();
    expect(cellStrokes(card.plot)).toEqual(new Set(["none|0"]));
  });

  it("a width with no colour draws a gap in the page colour (right in dark mode too)", () => {
    expect(cellStrokes(withHeat({ cellBorderWidth: 2 }))).toEqual(new Set(["var(--bg)|2"]));
  });

  it("a chosen colour still wins", () => {
    expect(cellStrokes(withHeat({ cellBorderWidth: 2, cellBorderColor: "#123456" }))).toEqual(new Set(["#123456|2"]));
  });
});

function panel(plot: Plot, opts = vi.fn<(patch: Partial<Plot>) => void>()) {
  const sel: GraphSelection = { kind: "chart-section", title: "Heatmap" };
  const { container } = render(
    <Inspector
      activeSection="graphs" selection={sel} plot={plot} table={card.table}
      userPresets={[]} profileDefault={null} onSelect={vi.fn()}
      onSetAxis={vi.fn()} onSetAxisLength={vi.fn()} onSetAxisTitleFont={vi.fn()}
      onSetSeriesStyle={vi.fn()} onSetSeriesStyleAll={vi.fn()} onSetPointStyle={vi.fn()} onClearPointStyles={vi.fn()}
      onSetGrid={vi.fn()} onSetFrame={vi.fn()} onSetKind={vi.fn()} onSetBarLayout={vi.fn()} onSetBarShape={vi.fn()} onSetBoxWhisker={vi.fn()}
      onSetPlotOptions={opts} onSetGraphTitle={vi.fn()} onSetPlotFont={vi.fn()} onHomogenizeFont={vi.fn()}
      onSetLegend={vi.fn()} onSetSignificance={vi.fn()} onApplyPreset={vi.fn()}
      onApplyUserPreset={vi.fn()} onSaveUserPreset={vi.fn()} onDeleteUserPreset={vi.fn()} onSetProfileDefault={vi.fn()}
      annotationOps={{ add: vi.fn(), update: vi.fn(), remove: vi.fn(), reorder: vi.fn(), align: vi.fn(), group: vi.fn(), ungroup: vi.fn(), setLocked: vi.fn(), addImage: vi.fn(), replaceImage: vi.fn() }}
    />,
  );
  return { container, opts };
}
const row = (container: HTMLElement, label: string): HTMLElement | undefined =>
  [...container.querySelectorAll<HTMLElement>(".frow")].find((r) => (r.querySelector(":scope > span")?.textContent ?? "").trim() === label);

describe("heatmap gap — the controls say what they do", () => {
  it("'Gap between cells' is the width, and its tooltip says why a gap helps", () => {
    const { container, opts } = panel(card.plot);
    const r = row(container, "Gap between cells");
    expect(r, "no 'Gap between cells' control").toBeTruthy();
    expect(r!.getAttribute("title") ?? "").toMatch(/neighbou?r/i);
    const slider = r!.querySelector("input")!;
    fireEvent.change(slider, { target: { value: "1.5" } });
    // The width alone — no colour has to be chosen for the gap to appear.
    expect(opts).toHaveBeenLastCalledWith({ heatmap: expect.objectContaining({ cellBorderWidth: 1.5 }) });
    expect(opts.mock.lastCall![0].heatmap).not.toHaveProperty("cellBorderColor");
  });

  it("'Gap colour' shows the colour actually drawn: the page colour until one is chosen", () => {
    document.documentElement.style.setProperty("--bg", "#14171c");
    const { container } = panel(withHeat({ cellBorderWidth: 2 }));
    const colour = row(container, "Gap colour")?.querySelector("input");
    expect(colour, "no 'Gap colour' control").toBeTruthy();
    expect(colour!.value.toLowerCase()).toBe("#14171c");
    cleanup();
    const chosen = row(panel(withHeat({ cellBorderWidth: 2, cellBorderColor: "#123456" })).container, "Gap colour")!.querySelector("input")!;
    expect(chosen.value.toLowerCase()).toBe("#123456");
  });
});
