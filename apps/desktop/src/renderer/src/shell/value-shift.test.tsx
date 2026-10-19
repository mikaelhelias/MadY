// @vitest-environment jsdom
/**
 * The value shift — `valueLabelDy`, the chart-wide up/down nudge for every value label.
 *
 * The builder applies it, so a control must write it. Dragging the value labels is not a
 * substitute: that drag writes the per-bar `valueDy`. On UpSet the bar value-label rows never
 * show, so the control is offered there too.
 *
 * Placed where value-label settings already live: under "Value decimals" on bar and histogram, and
 * under "Counts above bars" on UpSet. Shown only while labels are on, like its neighbours.
 *
 * The census at the bottom asks both directions on every gallery chart type: shown ⇒ it moves the
 * drawing (no dead control), and it moves the drawing ⇒ shown (no unreachable capability).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import type { Plot } from "@mady/core";
import { buildPlotScene } from "@mady/graphics";
import { Inspector } from "./Inspector";
import { PlotFigure } from "./PlotFigure";
import { galleryItems } from "./gallery";
import { VALUE_LABEL_SWITCHES } from "./optionEffects";

afterEach(cleanup);
const SIZE = { width: 620, height: 420 };

const handlers = (onSetPlotOptions = vi.fn()) => ({
  onSelect: vi.fn(),
  onSetAxis: vi.fn(), onSetAxisLength: vi.fn(), onSetAxisTitleFont: vi.fn(),
  onSetSeriesStyle: vi.fn(), onSetSeriesStyleAll: vi.fn(), onSetPointStyle: vi.fn(), onClearPointStyles: vi.fn(),
  onSetGrid: vi.fn(), onSetFrame: vi.fn(), onSetKind: vi.fn(), onSetBarLayout: vi.fn(), onSetBarShape: vi.fn(), onSetBoxWhisker: vi.fn(),
  onSetPlotOptions, onSetGraphTitle: vi.fn(), onSetPlotFont: vi.fn(), onHomogenizeFont: vi.fn(),
  onSetLegend: vi.fn(), onSetSignificance: vi.fn(), onApplyPreset: vi.fn(),
  onApplyUserPreset: vi.fn(), onSaveUserPreset: vi.fn(), onDeleteUserPreset: vi.fn(), onSetProfileDefault: vi.fn(),
  annotationOps: { add: vi.fn(), update: vi.fn(), remove: vi.fn(), reorder: vi.fn(), align: vi.fn(), group: vi.fn(), ungroup: vi.fn(), setLocked: vi.fn(), addImage: vi.fn(), replaceImage: vi.fn() },
});

const items = galleryItems() as unknown as { key: string; table: never; plot: Plot }[];
const card = (key: string) => items.find((i) => i.key === key)!;

/** The "Value shift" / "Count shift" number box, if the panel offers it. */
function shiftBox(plot: Plot, table: never, onSetPlotOptions = vi.fn()): HTMLInputElement | undefined {
  const { container } = render(
    <Inspector activeSection="graphs" selection={{ kind: "plot" }} plot={plot} table={table}
      userPresets={[]} profileDefault={null} {...handlers(onSetPlotOptions)} />,
  );
  const row = [...container.querySelectorAll("label.frow")].find((r) => /^(Value|Count) shift$/.test((r.querySelector(":scope > span")?.textContent ?? "").trim()));
  return row?.querySelector<HTMLInputElement>("input") ?? undefined;
}

/** Every value-label switch the model declares, on. */
const labelsOn = (plot: Plot): Plot => {
  const own: Record<string, unknown> = {};
  for (const k of VALUE_LABEL_SWITCHES) own[k] = { ...((plot as unknown as Record<string, object | undefined>)[k] ?? {}), showValues: true };
  return { ...plot, showValues: true, ...own } as Plot;
};

describe("the value shift reaches every value label the drawing moves with it", () => {
  for (const key of ["bar", "histogram", "upset"]) {
    it(`${key}: labels on, the box is there and writes valueLabelDy; blank clears it`, () => {
      const onSetPlotOptions = vi.fn();
      const box = shiftBox(labelsOn(card(key).plot), card(key).table, onSetPlotOptions);
      expect(box, `${key}: no shift box with value labels on`).toBeTruthy();
      fireEvent.change(box!, { target: { value: "-12" } });
      expect(onSetPlotOptions).toHaveBeenLastCalledWith({ valueLabelDy: -12 });
      cleanup();
      // Clearing needs a box that HOLDS a value: the mock never feeds -12 back, and typing "" into an
      // already-empty controlled box fires no change at all.
      const clear = vi.fn();
      const held = shiftBox({ ...labelsOn(card(key).plot), valueLabelDy: 7 } as Plot, card(key).table, clear);
      expect(held!.value).toBe("7");
      fireEvent.change(held!, { target: { value: "" } });
      expect(clear).toHaveBeenLastCalledWith({ valueLabelDy: undefined });
    });

    it(`${key}: labels off, no box (it would move nothing)`, () => {
      const off = { ...card(key).plot, showValues: false } as Plot;
      expect(shiftBox(off, card(key).table)).toBeUndefined();
    });
  }

  it("the drawing moves every bar value label by exactly the shift", () => {
    const { plot, table } = card("bar");
    const ys = (p: Plot): number[] => {
      const scene = buildPlotScene(table, p, SIZE);
      const { container } = render(<PlotFigure scene={scene} />);
      // value labels are the texts the renderer places with valueLabelPlace - read them as numbers
      const out = [...container.querySelectorAll("text")]
        .filter((t) => /^-?\d+(\.\d+)?$/.test((t.textContent ?? "").trim()) && t.getAttribute("font-weight") != null && t.closest("g.gfx-valuelabels, g") != null)
        .map((t) => Number(t.getAttribute("y")));
      cleanup();
      return out;
    };
    const on = labelsOn(plot);
    const before = ys(on);
    const after = ys({ ...on, valueLabelDy: -12 } as Plot);
    expect(before.length).toBeGreaterThan(0);
    const shifted = after.filter((y, i) => Math.round(before[i]! - y) === 12).length;
    expect(shifted, "no text moved up by exactly 12 px").toBeGreaterThan(0);
  });

  describe("census, both directions, every gallery chart type", () => {
    for (const item of items) {
      const kind = item.plot.kind ?? "xy";
      it(`${kind} [${item.key}]`, () => {
        const on = labelsOn(item.plot);
        const draw = (p: Plot): string => renderToStaticMarkup(createElement(PlotFigure, { scene: buildPlotScene(item.table, p, SIZE) }));
        const moves = draw(on) !== draw({ ...on, valueLabelDy: 20 } as Plot);
        const offered = shiftBox(on, item.table) != null;
        expect(
          offered,
          moves
            ? `${kind}: the shift moves value labels here and no box offers it`
            : `${kind}: a shift box for value labels it cannot move`,
        ).toBe(moves);
      });
    }
  });
});
