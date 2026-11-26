// @vitest-environment jsdom
// Axis bound inputs must never commit a value that crashes or blanks the figure.
//
// The axis Min/Max field fires on every keystroke, so a half-typed value reaches the document.
//
// The first three cases guard against a minimum of `0` — or any non-positive number — on a log
// axis (they fail without the guard). Log is undefined at/below 0, so the tick loop would spin
// forever and exhaust the heap, killing the renderer process. That is unrecoverable: a heap
// OOM cannot be caught by an ErrorBoundary, so every unsaved edit would go with it. Typing the
// leading `0` of `0.5` is enough to trigger it. `scale.degenerate.test.ts` covers the builder
// side; this covers the input side.
//
// The NaN cases below pass with or without the guard, because an `<input type="number">`
// sanitises invalid text ("-", ".", "1e") to "" before the handler ever sees it. They hold the
// guard in place for a field of `type="text"`, or one driven from the agent API, where a NaN
// domain ([NaN, NaN] → zero ticks, zero finite marks, a blank figure) could otherwise reach the drawing.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import type { AxisSpec, DataTable, Plot } from "@mady/core";
import { Inspector } from "./Inspector";
import type { GraphSelection } from "./AppShell";

afterEach(cleanup);
afterEach(() => globalThis.localStorage?.clear());

const table: DataTable = {
  id: "t", kind: "xy", name: "T",
  columns: [{ id: "x", name: "X", role: "x" }, { id: "y", name: "Y", role: "y" }],
  rows: [
    { id: "r1", cells: { x: 1, y: 10 } },
    { id: "r2", cells: { x: 2, y: 100 } },
    { id: "r3", cells: { x: 3, y: 1000 } },
  ],
} as unknown as DataTable;

type SetAxis = (axis: "x" | "y" | "y2" | "y3" | "z", patch: Partial<AxisSpec>) => void;

const handlers = (onSetAxis: SetAxis) => ({
  onSelect: vi.fn(),
  onSetAxis, onSetAxisLength: vi.fn(), onSetAxisTitleFont: vi.fn(),
  onSetSeriesStyle: vi.fn(), onSetSeriesStyleAll: vi.fn(), onSetPointStyle: vi.fn(), onClearPointStyles: vi.fn(),
  onSetGrid: vi.fn(), onSetFrame: vi.fn(), onSetKind: vi.fn(), onSetBarLayout: vi.fn(), onSetBarShape: vi.fn(), onSetBoxWhisker: vi.fn(),
  onSetPlotOptions: vi.fn(), onSetGraphTitle: vi.fn(), onSetPlotFont: vi.fn(), onHomogenizeFont: vi.fn(),
  onSetLegend: vi.fn(), onSetSignificance: vi.fn(), onApplyPreset: vi.fn(), 
  onApplyUserPreset: vi.fn(), onSaveUserPreset: vi.fn(), onDeleteUserPreset: vi.fn(), onSetProfileDefault: vi.fn(),
  annotationOps: { add: vi.fn(), update: vi.fn(), remove: vi.fn(), reorder: vi.fn(), align: vi.fn(), group: vi.fn(), ungroup: vi.fn(), setLocked: vi.fn(), addImage: vi.fn(), replaceImage: vi.fn() },
});

/** Render the Y-axis panel, optionally on a log scale, and return its field driver. */
function axisPanel(yAxis: AxisSpec = {}) {
  const onSetAxis = vi.fn<SetAxis>();
  const plot: Plot = { id: "p", name: "P", source: "t", status: "ok", styleOverrides: {}, kind: "xy", yAxis } as unknown as Plot;
  const selection: GraphSelection = { kind: "axis", axis: "y" };
  const { container } = render(
    <Inspector activeSection="graphs" selection={selection} plot={plot} table={table} userPresets={[]} profileDefault={null} {...handlers(onSetAxis)} />,
  );
  /** Type into a numeric field on the row labelled `label`. The bounds live on one row
   *  ("Min / Max") with two inputs, so `nth` selects which: 0 = min, 1 = max. */
  const type = (label: string, text: string, nth = 0): void => {
    const row = [...container.querySelectorAll<HTMLElement>("label.frow, div.frow")]
      .find((r) => (r.querySelector(":scope > span")?.textContent ?? "").trim() === label);
    if (!row) {
      const seen = [...container.querySelectorAll<HTMLElement>("label.frow, div.frow")]
        .map((r) => (r.querySelector(":scope > span")?.textContent ?? "").trim());
      throw new Error(`no axis field labelled "${label}". Saw: ${JSON.stringify(seen)}`);
    }
    const input = row.querySelectorAll<HTMLInputElement>('input[type="number"]')[nth];
    if (!input) throw new Error(`"${label}" has no numeric input at index ${nth}`);
    fireEvent.change(input, { target: { value: text } });
  };
  /** Every axis patch the panel committed. */
  const patches = (): Record<string, unknown>[] => onSetAxis.mock.calls.map((c) => c[1] as Record<string, unknown>);
  return { type, patches };
}

describe("axis Minimum / Maximum never commit an unusable value", () => {
  it.each(["-", ".", "1e", "e5", "-."])("ignores the half-typed %o instead of writing NaN", (text) => {
    const p = axisPanel();
    p.type("Min / Max", text);
    for (const patch of p.patches()) {
      for (const v of Object.values(patch)) expect(Number.isNaN(v as number)).toBe(false);
    }
  });

  it("still commits a normal number", () => {
    const p = axisPanel();
    p.type("Min / Max", "5");
    expect(p.patches()).toContainEqual(expect.objectContaining({ min: 5 }));
  });

  it("blank still clears the override (auto)", () => {
    // Driven from a panel that already has a min: the field is a controlled input, so
    // clearing it is only a real change event when it starts non-empty.
    const p = axisPanel({ min: 5 });
    p.type("Min / Max", "");
    expect(p.patches()).toContainEqual(expect.objectContaining({ min: undefined }));
  });

  it("still commits a negative number on a linear axis (only log forbids it)", () => {
    const p = axisPanel();
    p.type("Min / Max", "-20");
    expect(p.patches()).toContainEqual(expect.objectContaining({ min: -20 }));
  });

  it.each(["0", "-1", "-0.5"])("refuses %o as a log-axis minimum (log is undefined at/below 0)", (text) => {
    const p = axisPanel({ scale: "log10" });
    p.type("Min / Max", text);
    for (const patch of p.patches()) {
      if ("min" in patch) expect(patch.min as number).toBeGreaterThan(0);
    }
  });

  it("still commits a positive log-axis minimum", () => {
    const p = axisPanel({ scale: "log10" });
    p.type("Min / Max", "0.5");
    expect(p.patches()).toContainEqual(expect.objectContaining({ min: 0.5 }));
  });
});
