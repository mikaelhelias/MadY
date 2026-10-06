// @vitest-environment jsdom
/**
 * The equal-aspect control — offered where the builder can honour it, and nowhere else.
 *
 * `equal-aspect-kinds.test.ts` holds the drawing half (the kinds in `EQUAL_ASPECT_KINDS` really
 * do come out 1:1). This holds the other half of the same promise: the checkbox is in the panel
 * a user already opens to change the scale, it commits, and it is absent on the kinds whose
 * builder refuses — an offered control that could never work is a dead end for the user.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import type { DataTable, Plot, PlotKind } from "@mady/core";
import { EQUAL_ASPECT_KINDS } from "@mady/core";
import { Inspector } from "./Inspector";
import type { GraphSelection } from "./AppShell";

afterEach(cleanup);
afterEach(() => globalThis.localStorage?.clear());

const table: DataTable = {
  id: "t", kind: "xy", name: "T",
  columns: [{ id: "x", name: "X", role: "x" }, { id: "y", name: "Y", role: "y" }],
  rows: [
    { id: "r1", cells: { x: 1, y: 10 } },
    { id: "r2", cells: { x: 2, y: 20 } },
    { id: "r3", cells: { x: 3, y: 30 } },
  ],
} as unknown as DataTable;

type SetPlotOptions = (patch: Partial<Plot>) => void;

const handlers = (onSetPlotOptions: SetPlotOptions) => ({
  onSelect: vi.fn(),
  onSetAxis: vi.fn(), onSetAxisLength: vi.fn(), onSetAxisTitleFont: vi.fn(),
  onSetSeriesStyle: vi.fn(), onSetSeriesStyleAll: vi.fn(), onSetPointStyle: vi.fn(), onClearPointStyles: vi.fn(),
  onSetGrid: vi.fn(), onSetFrame: vi.fn(), onSetKind: vi.fn(), onSetBarLayout: vi.fn(), onSetBarShape: vi.fn(), onSetBoxWhisker: vi.fn(),
  onSetPlotOptions, onSetGraphTitle: vi.fn(), onSetPlotFont: vi.fn(), onHomogenizeFont: vi.fn(),
  onSetLegend: vi.fn(), onSetSignificance: vi.fn(), onApplyPreset: vi.fn(), 
  onApplyUserPreset: vi.fn(), onSaveUserPreset: vi.fn(), onDeleteUserPreset: vi.fn(), onSetProfileDefault: vi.fn(),
  annotationOps: { add: vi.fn(), update: vi.fn(), remove: vi.fn(), reorder: vi.fn(), align: vi.fn(), group: vi.fn(), ungroup: vi.fn(), setLocked: vi.fn(), addImage: vi.fn(), replaceImage: vi.fn() },
});

/** Render the axis panel for one kind and hand back the equal-aspect checkbox, if any. */
function axisPanel(kind: PlotKind, axis: "x" | "y" | "y2" = "x", plotPatch: Partial<Plot> = {}) {
  const onSetPlotOptions = vi.fn<SetPlotOptions>();
  const plot = { id: "p", name: "P", source: "t", status: "ok", styleOverrides: {}, kind, ...plotPatch } as unknown as Plot;
  const selection: GraphSelection = { kind: "axis", axis };
  const { container } = render(
    <Inspector activeSection="graphs" selection={selection} plot={plot} table={table} userPresets={[]} profileDefault={null} {...handlers(onSetPlotOptions)} />,
  );
  const box = container.querySelector<HTMLInputElement>('input[aria-label="Equal aspect (same scale on both axes)"]');
  return { box, onSetPlotOptions };
}

describe("equal aspect — the control", () => {
  it("sits in the Axis panel's Scale section, beside the other things that shape the mapping", () => {
    const { box } = axisPanel("xy");
    expect(box).not.toBeNull();
    // Its own <details> must be the one headed "Scale" — the same place Type, Reversed and the
    // scale bar live, so a user changing how data maps to pixels meets it there.
    const section = box!.closest("details");
    expect(section?.querySelector("summary")?.textContent).toBe("Scale");
  });

  it("commits, and reads back what the plot carries", () => {
    const { box, onSetPlotOptions } = axisPanel("xy");
    expect(box!.checked).toBe(false);
    fireEvent.click(box!);
    expect(onSetPlotOptions).toHaveBeenCalledWith({ equalAspect: true });

    const on = axisPanel("xy", "x", { equalAspect: true });
    expect(on.box!.checked).toBe(true);
    fireEvent.click(on.box!);
    expect(on.onSetPlotOptions).toHaveBeenCalledWith({ equalAspect: false });
  });

  it("is offered on every kind whose builder honours it", () => {
    const missing = [...EQUAL_ASPECT_KINDS].filter((k) => axisPanel(k).box === null);
    expect(missing, "kinds that CAN be 1:1 but have no control for it").toEqual([]);
  });

  it("is withheld where the builder refuses — a category axis, a genome, a time axis", () => {
    for (const kind of ["bar", "box", "manhattan", "survival", "heatmap", "histogram"] as PlotKind[]) {
      expect(axisPanel(kind).box, `${kind} offers a control its builder refuses`).toBeNull();
    }
  });

  it("is not offered on Y2 — a second value axis has its own domain, not a shared plane", () => {
    expect(axisPanel("xy", "y2").box).toBeNull();
  });
});
