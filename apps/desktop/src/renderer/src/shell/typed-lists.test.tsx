// @vitest-environment jsdom
/**
 * Boxes that take a typed list ("10, 30, 50", "4, 5, 5", "10-30, 90+"). Typed key by key, the
 * list is only whole at the end: a box that saved on every key press threw away a lone "1" (not a
 * list of bins yet, so the box emptied) or ate each comma ("4, 5, 5" became 455). These boxes keep
 * what is typed until Enter or leaving the box, and leaving one without a change saves nothing, so
 * Undo never holds a step that changes nothing.
 *
 * The harness feeds every save back into the graph, as the app does; with a spy alone the box
 * would never re-render with the saved value and a box that throws text away would look fine.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { useState } from "react";
import type { DataTable, Plot, PlotKind } from "@mady/core";
import { Inspector } from "./Inspector";

afterEach(cleanup);
afterEach(() => globalThis.localStorage?.clear());

const table: DataTable = {
  id: "t",
  kind: "column",
  name: "T",
  columns: [
    { id: "a", name: "A" },
    { id: "b", name: "B" },
    { id: "c", name: "C" },
  ],
  rows: [1, 2, 3, 4, 5].map((i) => ({ id: "r" + i, cells: { a: i, b: i * 2 + (i % 2), c: 10 - i } })),
};

const noop = (): void => {};
const handlers = {
  onSelect: noop, onSetAxis: noop, onSetAxisLength: noop, onSetAxisTitleFont: noop,
  onSetSeriesStyle: noop, onSetSeriesStyleAll: noop, onSetPointStyle: noop, onClearPointStyles: noop,
  onSetGrid: noop, onSetFrame: noop, onSetKind: noop, onSetBarLayout: noop, onSetBarShape: noop, onSetBoxWhisker: noop,
  onSetGraphTitle: noop, onSetPlotFont: noop, onHomogenizeFont: noop,
  onSetLegend: noop, onSetSignificance: noop, onApplyPreset: noop,
  onApplyUserPreset: noop, onSaveUserPreset: () => null, onDeleteUserPreset: noop, onSetProfileDefault: noop,
  annotationOps: { add: noop, update: noop, remove: noop, reorder: noop, align: noop, group: noop, ungroup: noop, setLocked: noop, addImage: noop, replaceImage: noop },
};

/** The Inspector over a graph that takes every saved patch, and counts the saves. */
function live(kind: PlotKind, start: Partial<Plot> = {}) {
  const saves = vi.fn();
  let current: Plot = { id: "p", name: "P", source: "t", status: "ok", styleOverrides: {}, kind, ...start };
  function Harness() {
    const [plot, setPlot] = useState<Plot>(current);
    return (
      <Inspector
        activeSection="graphs" selection={{ kind: "plot" }} plot={plot} table={table} userPresets={[]} profileDefault={null} {...handlers}
        onSetPlotOptions={(patch: Partial<Plot>) => { saves(patch); current = { ...current, ...patch }; setPlot(current); }}
      />
    );
  }
  const u = render(<Harness />);
  return { ...u, saves, plot: () => current };
}

function field(container: HTMLElement, label: string): HTMLInputElement {
  const span = [...container.querySelectorAll(".frow > span")].find((s) => s.textContent === label);
  if (!span) throw new Error(`no field labelled "${label}"`);
  return span.parentElement!.querySelector("input") as HTMLInputElement;
}

/** Type `text` one key at a time, as a user does: each key goes onto what the box shows now. */
function typeKeys(input: HTMLInputElement, text: string): void {
  fireEvent.focus(input);
  for (const ch of text) fireEvent.change(input, { target: { value: input.value + ch } });
}

describe("typed lists, key by key", () => {
  it("Correlation matrix ▸ Domain blocks: '4, 5, 5' gives three blocks, not 455", () => {
    const d = live("corrmatrix");
    const box = field(d.container, "Domain blocks");
    typeKeys(box, "4, 5, 5");
    fireEvent.blur(box);
    expect(d.plot().corrmatrix?.blockSizes).toEqual([4, 5, 5]);
  });

  it("Histogram ▸ Custom bins: '10, 30, 50' gives two bins, and the box keeps the text while it is typed", () => {
    const d = live("histogram");
    const box = field(d.container, "Custom bins");
    typeKeys(box, "10, 30, 50");
    expect(box.value).toBe("10, 30, 50");
    fireEvent.keyDown(box, { key: "Enter" });
    expect(d.plot().histogram?.binRanges).toEqual([[10, 30], [30, 50]]);
  });
});

describe("leaving a list box without a change saves nothing", () => {
  it("Bubble ▸ Reference values, empty and filled", () => {
    for (const start of [undefined, [10, 20]]) {
      const d = live("bubble", start ? { bubble: { sizeLegendValues: start } } : {});
      const box = field(d.container, "Reference values");
      fireEvent.focus(box); fireEvent.blur(box);
      fireEvent.keyDown(box, { key: "Enter" });
      expect(d.saves, `start ${JSON.stringify(start)}`).not.toHaveBeenCalled();
      cleanup();
    }
  });

  it("Heatmap ▸ colour bar Values", () => {
    const d = live("heatmap", { heatmap: { colorbarTickValues: [0, 5] } });
    const box = field(d.container, "Values");
    fireEvent.focus(box); fireEvent.blur(box);
    expect(d.saves).not.toHaveBeenCalled();
    // …while a real change still saves, once.
    fireEvent.change(box, { target: { value: "0, 5, 10" } });
    fireEvent.keyDown(box, { key: "Enter" });
    fireEvent.blur(box);
    expect(d.saves).toHaveBeenCalledTimes(1);
    expect(d.plot().heatmap?.colorbarTickValues).toEqual([0, 5, 10]);
  });
});
