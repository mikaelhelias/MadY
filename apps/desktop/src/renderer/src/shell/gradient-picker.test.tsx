// @vitest-environment jsdom
/**
 * Every ramp picker offers the project's own gradients and the way to build one.
 *
 * The editor is only useful if the user can reach it from where they already are. Every
 * picker that lists ramps must end the same way — built-ins, then the project's gradients,
 * then "Edit / new gradient…" — and choosing that entry must open the editor rather than write
 * the sentinel into the document (which would leave the graph pointing at a ramp that does not
 * exist).
 *
 * Note: this also guards against a picker offering only a hardcoded subset of the built-in
 * ramps: a picker that quietly omits most of the
 * program's ramps is the same defect as one that omits the user's own.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { DataTable, Gradient, Plot } from "@mady/core";
import { EDIT_RAMP, Inspector } from "./Inspector";

afterEach(cleanup);

const mine: Gradient = {
  id: "g1", name: "Lab rainbow", mode: "stops",
  stops: [{ pos: 0, color: "#ff0000" }, { pos: 1, color: "#0000ff" }],
};

const handlers = () => ({
  onSelect: vi.fn(),
  onSetAxis: vi.fn(), onSetAxisLength: vi.fn(), onSetAxisTitleFont: vi.fn(),
  onSetSeriesStyle: vi.fn(), onSetSeriesStyleAll: vi.fn(), onSetPointStyle: vi.fn(), onClearPointStyles: vi.fn(),
  onSetGrid: vi.fn(), onSetFrame: vi.fn(), onSetKind: vi.fn(), onSetBarLayout: vi.fn(), onSetBarShape: vi.fn(), onSetBoxWhisker: vi.fn(),
  onSetPlotOptions: vi.fn(), onSetGraphTitle: vi.fn(), onSetPlotFont: vi.fn(), onHomogenizeFont: vi.fn(),
  onSetLegend: vi.fn(), onSetSignificance: vi.fn(), onApplyPreset: vi.fn(), 
  onApplyUserPreset: vi.fn(), onSaveUserPreset: vi.fn(), onDeleteUserPreset: vi.fn(), onSetProfileDefault: vi.fn(),
  annotationOps: { add: vi.fn(), update: vi.fn(), remove: vi.fn(), reorder: vi.fn(), align: vi.fn(), group: vi.fn(), ungroup: vi.fn(), setLocked: vi.fn(), addImage: vi.fn(), replaceImage: vi.fn() },
});

/** Every colormap a chart-wide ramp picker must offer (the 13 that need no series colour). */
const BUILT_IN_COLORMAPS = [
  "viridis", "magma", "plasma", "inferno", "cividis", "turbo", "coolwarm", "spectral",
  "blues", "reds", "greens", "rainbow", "grayscale",
];

const ops = () => ({ save: vi.fn(), remove: vi.fn(), nextId: () => "newid", usedBy: () => [] as string[] });

const table: DataTable = {
  id: "th", kind: "xy", name: "H",
  columns: [
    { id: "g", name: "Gene", role: "x" }, { id: "c1", name: "C1", role: "y" },
    { id: "c2", name: "C2", role: "y" }, { id: "c3", name: "C3", role: "y" },
  ],
  rows: [
    { id: "r1", cells: { g: "G1", c1: 1, c2: 5, c3: 3 } },
    { id: "r2", cells: { g: "G2", c1: 8, c2: 2, c3: 6 } },
    { id: "r3", cells: { g: "G3", c1: 4, c2: 7, c3: 1 } },
  ],
};
const plot = (p: Partial<Plot>): Plot =>
  ({ id: "p", name: "P", source: "th", status: "ok", styleOverrides: {}, ...p }) as Plot;

function show(p: Plot, o = ops(), selection: object = { kind: "plot" }) {
  const h = handlers();
  render(
    <Inspector activeSection="graphs" selection={selection as never} plot={p} table={table}
      userPresets={[]} profileDefault={null} gradients={[mine]} gradientOps={o} {...h} />,
  );
  return { h, o };
}

/** The `<select>` whose current value is `value` (every ramp picker is identified this way). */
const picker = (value: string): HTMLSelectElement => {
  const found = [...document.querySelectorAll("select")].find((s) => (s as HTMLSelectElement).value === value);
  if (!found) throw new Error(`no ramp picker showing "${value}"`);
  return found as HTMLSelectElement;
};
const optionValues = (sel: HTMLSelectElement): string[] => [...sel.options].map((o) => o.value);

const CASES: [string, Plot, string][] = [
  ["heatmap", plot({ kind: "heatmap", heatmap: { colormap: "coolwarm" } }), "coolwarm"],
  ["timeline tracks", plot({ kind: "tracks", tracks: { colormap: "plasma" } }), "plasma"],
  ["parallel coordinates", plot({ kind: "parallel", parallel: { colorColumn: "c1", colorScale: "value", colorRamp: "magma" } }), "magma"],
  ["ridgeline spectrum", plot({ kind: "ridgeline", ridgeline: { spectrum: true, spectrumMap: "turbo" } }), "turbo"],
];

describe("every chart-wide ramp picker", () => {
  for (const [name, p, current] of CASES) {
    it(`${name}: lists the project's gradients and the editor entry`, () => {
      show(p);
      const vals = optionValues(picker(current));
      expect(vals, `${name} does not offer the user's gradient`).toContain("custom:g1");
      expect(vals, `${name} has no way to reach the editor`).toContain(EDIT_RAMP);
      // …and it offers the whole colormap set, not a hand-picked few. Named, not counted: a
      // picker offering a hardcoded subset has the right kind of entries but misses others, so
      // each missing ramp is exactly what this has to check.
      // (The four base-colour ramps — lightness / transparency / lightness + transparency /
      // two-colour — are correctly absent: a heatmap or a track strip has no series colour for them to derive from.)
      for (const ramp of BUILT_IN_COLORMAPS) expect(vals, `${name} does not offer ${ramp}`).toContain(ramp);
    });

    it(`${name}: the editor entry opens the editor and writes nothing`, () => {
      const { h } = show(p);
      fireEvent.change(picker(current), { target: { value: EDIT_RAMP } });
      expect(screen.getByLabelText("Gradient editor"), `${name} did not open the editor`).toBeTruthy();
      expect(h.onSetPlotOptions, `${name} wrote the menu entry into the document`).not.toHaveBeenCalled();
    });

    it(`${name}: picking the user's gradient sets the ramp normally`, () => {
      const { h } = show(p);
      fireEvent.change(picker(current), { target: { value: "custom:g1" } });
      expect(screen.queryByLabelText("Gradient editor")).toBeNull();
      expect(h.onSetPlotOptions).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(h.onSetPlotOptions.mock.calls[0]![0])).toContain("custom:g1");
    });
  }
});

describe("the editor, opened from a picker", () => {
  it("opens on a copy of the built-in that was showing, named after it", () => {
    show(CASES[0]![1]);
    fireEvent.change(picker("coolwarm"), { target: { value: EDIT_RAMP } });
    expect((screen.getByLabelText("Gradient name") as HTMLInputElement).value).toBe("Coolwarm (custom)");
  });

  it("opens the user's own gradient as itself when that is what the row shows", () => {
    show(plot({ kind: "heatmap", heatmap: { colormap: "custom:g1" } }));
    fireEvent.change(picker("custom:g1"), { target: { value: EDIT_RAMP } });
    expect((screen.getByLabelText("Gradient name") as HTMLInputElement).value).toBe("Lab rainbow");
  });

  it("Done saves the gradient and points the row at it — in that order", () => {
    const { h, o } = show(CASES[0]![1]);
    fireEvent.change(picker("coolwarm"), { target: { value: EDIT_RAMP } });
    fireEvent.click(screen.getByText("Done"));
    expect(o.save).toHaveBeenCalledTimes(1);
    expect(o.save.mock.calls[0]![0].id).toBe("newid");
    expect(h.onSetPlotOptions).toHaveBeenCalledWith({ heatmap: expect.objectContaining({ colormap: "custom:newid" }) });
    expect(screen.queryByLabelText("Gradient editor")).toBeNull();
  });

  it("Cancel writes nothing at all", () => {
    const { h, o } = show(CASES[0]![1]);
    fireEvent.change(picker("coolwarm"), { target: { value: EDIT_RAMP } });
    fireEvent.click(screen.getByText("Cancel"));
    expect(o.save).not.toHaveBeenCalled();
    expect(h.onSetPlotOptions).not.toHaveBeenCalled();
    expect(screen.queryByLabelText("Gradient editor")).toBeNull();
  });
});

describe("the per-series ramps", () => {
  const graduated = plot({ kind: "bar", seriesStyles: { c1: { fillType: "graduated", gradRamp: "viridis" } } });

  it("a graduated fill offers the gradients and the editor entry", () => {
    show(graduated, ops(), { kind: "series", columnId: "c1" });
    const vals = optionValues(picker("viridis"));
    expect(vals).toContain("custom:g1");
    expect(vals).toContain(EDIT_RAMP);
  });

  it("choosing the editor entry does not write the sentinel into the series style", () => {
    const { h } = show(graduated, ops(), { kind: "series", columnId: "c1" });
    fireEvent.change(picker("viridis"), { target: { value: EDIT_RAMP } });
    expect(screen.getByLabelText("Gradient editor")).toBeTruthy();
    expect(h.onSetSeriesStyle).not.toHaveBeenCalled();
    expect(h.onSetSeriesStyleAll).not.toHaveBeenCalled();
  });

  it("and Done points that series at the new gradient", () => {
    const { h } = show(graduated, ops(), { kind: "series", columnId: "c1" });
    fireEvent.change(picker("viridis"), { target: { value: EDIT_RAMP } });
    fireEvent.click(screen.getByText("Done"));
    const wrote = [...h.onSetSeriesStyle.mock.calls, ...h.onSetSeriesStyleAll.mock.calls];
    expect(JSON.stringify(wrote)).toContain("custom:newid");
  });
});

describe("without a gradient registry (gallery cards, fixtures, any caller that passes none)", () => {
  it("the pickers still work and simply do not offer the editor", () => {
    const h = handlers();
    render(
      <Inspector activeSection="graphs" selection={{ kind: "plot" } as never} plot={CASES[0]![1]} table={table}
        userPresets={[]} profileDefault={null} {...h} />,
    );
    const vals = optionValues(picker("coolwarm"));
    expect(vals).not.toContain(EDIT_RAMP);
    for (const ramp of BUILT_IN_COLORMAPS) expect(vals).toContain(ramp);
  });
});
