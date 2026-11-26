// @vitest-environment jsdom
/**
 * Direct editing, for every drawable of heatmap splits and annotation strips: each one is
 * clickable, editable and draggable, and a click opens the correct editing section in the
 * side inspector.
 *
 * Guards four drawables — a split rule, a split's block name, an annotation strip, and a
 * strip's name — against being inert (`pointerEvents="none"`), element by element:
 *
 *   Clickable   → a click reaches `onSelect` with a selection naming that object
 *   Section     → that selection opens the Heatmap section, with the object's own row marked
 *   Editable    → the panel can change it (and the text can be renamed in place)
 *   Draggable   → the two texts move, and the move writes an offset
 *
 * Note: the general checks that click and drag every element enumerate gallery
 * cards, and no gallery card has a split or a strip, so they cannot see these elements on their
 * own. `optionDrawables()` in gallery.ts carries fixtures that do, and both checks read it; this
 * file is the element-by-element version of the same contract.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { DataTable, Plot } from "@mady/core";
import { buildPlotScene } from "@mady/graphics";
import { PlotFigure } from "./PlotFigure";
import { Inspector } from "./Inspector";
import type { GraphSelection } from "./AppShell";

beforeAll(() => {
  // jsdom has no getScreenCTM, and every drag goes through it (see text-draggable.sweep).
  const proto = (globalThis as unknown as { SVGSVGElement?: { prototype: Record<string, unknown> } }).SVGSVGElement?.prototype;
  if (proto && typeof proto.getScreenCTM !== "function") {
    proto.getScreenCTM = function getScreenCTM() {
      return { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0, inverse: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }) };
    };
    proto.createSVGPoint = function createSVGPoint() {
      return { x: 0, y: 0, matrixTransform: (m: { e: number; f: number }) => ({ x: 0 - m.e, y: 0 - m.f }) };
    };
  }
});
afterEach(cleanup);

const table: DataTable = {
  id: "t", kind: "xy", name: "T",
  columns: [
    { id: "g", name: "Gene" }, { id: "grp", name: "Group" },
    { id: "c0", name: "S1" }, { id: "c1", name: "S2" }, { id: "c2", name: "S3" }, { id: "c3", name: "S4" },
  ],
  rows: ["G1", "G2", "G3", "G4", "G5", "G6"].map((g, i) => ({
    id: `r${i}`, cells: { g, grp: i < 3 ? "Ctrl" : "Treated", c0: i + 1, c1: i + 2, c2: i + 3, c3: i + 4 },
  })),
};
/** A heatmap wearing every split and strip drawable. */
const HEATMAP: NonNullable<Plot["heatmap"]> = {
  rowSplits: [{ at: 2, label: "Baseline" }],
  colSplits: [{ at: 1 }],
  splitStyle: "both",
  rowTracks: [{ column: "grp", name: "Group" }],
  colTracks: [{ name: "Batch", values: { c0: "A", c1: "A", c2: "B", c3: "B" } }],
};
const plot: Plot = { id: "p", name: "P", source: "t", status: "ok", styleOverrides: {}, kind: "heatmap", heatmap: HEATMAP };
const scene = () => buildPlotScene(table, plot, { width: 700, height: 520 });

function figure(over: Partial<Parameters<typeof PlotFigure>[0]> = {}) {
  const onSelect = vi.fn();
  const onEditText = vi.fn();
  const onMoveHeatSplitLabel = vi.fn();
  const onMoveHeatTrackName = vi.fn();
  const { container } = render(
    <PlotFigure
      scene={scene()} onSelect={onSelect} onEditText={onEditText}
      onMoveHeatSplitLabel={onMoveHeatSplitLabel} onMoveHeatTrackName={onMoveHeatTrackName}
      {...over}
    />,
  );
  return { container, onSelect, onEditText, onMoveHeatSplitLabel, onMoveHeatTrackName };
}

// ---------------------------------------------------------------- Clickable

describe("clickable — every one of them reaches its own selection", () => {
  it("a split rule selects that break", () => {
    const f = figure();
    const hit = f.container.querySelector('[data-heatsplit-hit="row-2"]')!;
    expect(hit, "the row break has no hit target").toBeTruthy();
    fireEvent.click(hit);
    expect(f.onSelect).toHaveBeenCalledWith({ kind: "heatmap-split", axis: "row", at: 2 });
  });

  it("a column break too, and it names the column axis", () => {
    const f = figure();
    fireEvent.click(f.container.querySelector('[data-heatsplit-hit="col-1"]')!);
    expect(f.onSelect).toHaveBeenCalledWith({ kind: "heatmap-split", axis: "col", at: 1 });
  });

  it("a break drawn as a pure space is clickable too — it is still an object the user placed", () => {
    const s = buildPlotScene(table, { ...plot, heatmap: { ...HEATMAP, splitStyle: "gap" } }, { width: 700, height: 520 });
    const onSelect = vi.fn();
    const { container } = render(<PlotFigure scene={s} onSelect={onSelect} />);
    expect(container.querySelector("line.gfx-heatsplit"), "a space draws no rule").toBeNull();
    fireEvent.click(container.querySelector('[data-heatsplit-hit="row-2"]')!);
    expect(onSelect).toHaveBeenCalledWith({ kind: "heatmap-split", axis: "row", at: 2 });
  });

  it("an annotation strip selects itself, and the two axes are told apart", () => {
    const f = figure();
    fireEvent.click(f.container.querySelector('[data-heattrack="row-0"] rect.gfx-heatblock')!);
    expect(f.onSelect).toHaveBeenCalledWith({ kind: "heatmap-track", axis: "row", index: 0 });
    f.onSelect.mockClear();
    fireEvent.click(f.container.querySelector('[data-heattrack="col-0"] rect.gfx-heatblock')!);
    expect(f.onSelect).toHaveBeenCalledWith({ kind: "heatmap-track", axis: "col", index: 0 });
  });

  it("the two texts select their own object as well", () => {
    // Note: press-and-release, not `click`: DraggableTitle selects on pointer up after a press that
    // did not move, which is how it tells a click from a drag. Same gesture the corr-matrix and
    // heatmap labels are tested with.
    const press = (el: Element): void => {
      fireEvent.pointerDown(el, { clientX: 5, clientY: 5, button: 0 });
      fireEvent.pointerUp(el, { clientX: 5, clientY: 5 });
      fireEvent.mouseDown(el, { clientX: 5, clientY: 5, button: 0 });
      fireEvent.mouseUp(el, { clientX: 5, clientY: 5 });
    };
    const f = figure();
    const label = [...f.container.querySelectorAll("text")].find((t) => t.textContent === "Baseline")!;
    press(label.parentElement ?? label);
    press(label);
    expect(f.onSelect, "the block name selects nothing").toHaveBeenCalledWith({ kind: "heatmap-split", axis: "row", at: 2 });
    f.onSelect.mockClear();
    const name = [...f.container.querySelectorAll("text")].find((t) => t.textContent === "Group")!;
    press(name.parentElement ?? name);
    press(name);
    expect(f.onSelect, "the strip name selects nothing").toHaveBeenCalledWith({ kind: "heatmap-track", axis: "row", index: 0 });
  });
});

// ---------------------------------------------------------------- Draggable

describe("draggable — both texts move, and the move is written down", () => {
  const drag = (el: Element): void => {
    fireEvent.pointerDown(el, { clientX: 0, clientY: 0, button: 0 });
    fireEvent.pointerMove(el, { clientX: 14, clientY: 9 });
    fireEvent.pointerUp(el, { clientX: 14, clientY: 9 });
    fireEvent.mouseDown(el, { clientX: 0, clientY: 0, button: 0 });
    fireEvent.mouseMove(el, { clientX: 14, clientY: 9 });
    fireEvent.mouseUp(el, { clientX: 14, clientY: 9 });
  };

  it("a split's block name", () => {
    const f = figure();
    const label = [...f.container.querySelectorAll("text")].find((t) => t.textContent === "Baseline")!;
    drag(label.parentElement ?? label);
    drag(label);
    expect(f.onMoveHeatSplitLabel, "the block name is stuck").toHaveBeenCalled();
    expect(f.onMoveHeatSplitLabel.mock.calls[0]!.slice(0, 2)).toEqual(["row", 2]);
  });

  it("the row strip's name is drawn rotated — and still drags from there", () => {
    // Two 16px bands cannot hold two horizontal names side by side (they would print through
    // each other). The scene says -90; this is the half that proves the drawing honours it.
    const f = figure();
    const name = [...f.container.querySelectorAll("text")].find((t) => t.textContent === "Group")!;
    const tf = (name.parentElement?.getAttribute("transform") ?? "") + (name.getAttribute("transform") ?? "");
    expect(tf, "the row strip's name is still drawn level").toMatch(/rotate\(-90/);
    drag(name.parentElement ?? name);
    drag(name);
    expect(f.onMoveHeatTrackName, "rotating it made it undraggable").toHaveBeenCalled();
  });

  it("a strip's name", () => {
    const f = figure();
    const name = [...f.container.querySelectorAll("text")].find((t) => t.textContent === "Group")!;
    drag(name.parentElement ?? name);
    drag(name);
    expect(f.onMoveHeatTrackName, "the strip name is stuck").toHaveBeenCalled();
    expect(f.onMoveHeatTrackName.mock.calls[0]!.slice(0, 2)).toEqual(["row", 0]);
  });

  it("and the offset reaches the drawing", () => {
    const s = buildPlotScene(
      table,
      { ...plot, heatmap: { ...HEATMAP, rowSplits: [{ at: 2, label: "Baseline", labelOffset: { dx: 12, dy: -4 } }] } },
      { width: 700, height: 520 },
    );
    expect(s.heatmap!.splits!.find((x) => x.axis === "row")!.labelOff).toEqual({ dx: 12, dy: -4 });
  });
});

// ---------------------------------------------------------------- Editable (in place)

describe("editable — both texts rename where they are drawn", () => {
  const openEditor = (container: HTMLElement, text: string): HTMLElement => {
    const t = [...container.querySelectorAll("text")].find((x) => x.textContent === text)!;
    fireEvent.doubleClick(t);
    const box = (container.querySelector("textarea, input[type=text]") ?? document.querySelector("textarea, input[type=text]")) as HTMLElement | null;
    expect(box, `no inline editor opened on "${text}"`).toBeTruthy();
    return box!;
  };

  it("a split's block name renames in place", () => {
    const f = figure();
    const box = openEditor(f.container, "Baseline");
    fireEvent.change(box, { target: { value: "Responders" } });
    fireEvent.blur(box);
    expect(f.onEditText).toHaveBeenCalledWith({ kind: "heatSplitLabel", axis: "row", at: 2 }, "Responders");
  });

  it("a strip's name renames in place", () => {
    const f = figure();
    const box = openEditor(f.container, "Group");
    fireEvent.change(box, { target: { value: "Arm" } });
    fireEvent.blur(box);
    expect(f.onEditText).toHaveBeenCalledWith({ kind: "heatTrackName", axis: "row", index: 0 }, "Arm");
  });
});

// ---------------------------------------------------------------- The right section

describe("section — the click opens the editor for the thing that was clicked", () => {
  const handlers = () => ({
    onSelect: vi.fn(), onSetAxis: vi.fn(), onSetAxisLength: vi.fn(), onSetAxisTitleFont: vi.fn(),
    onSetSeriesStyle: vi.fn(), onSetSeriesStyleAll: vi.fn(), onSetPointStyle: vi.fn(), onClearPointStyles: vi.fn(),
    onSetGrid: vi.fn(), onSetFrame: vi.fn(), onSetKind: vi.fn(), onSetBarLayout: vi.fn(), onSetBarShape: vi.fn(), onSetBoxWhisker: vi.fn(),
    onSetPlotOptions: vi.fn(), onSetGraphTitle: vi.fn(), onSetPlotFont: vi.fn(), onHomogenizeFont: vi.fn(),
    onSetLegend: vi.fn(), onSetSignificance: vi.fn(), onApplyPreset: vi.fn(), 
    onApplyUserPreset: vi.fn(), onSaveUserPreset: vi.fn(), onDeleteUserPreset: vi.fn(), onSetProfileDefault: vi.fn(),
    annotationOps: { add: vi.fn(), update: vi.fn(), remove: vi.fn(), reorder: vi.fn(), align: vi.fn(), group: vi.fn(), ungroup: vi.fn(), setLocked: vi.fn(), addImage: vi.fn(), replaceImage: vi.fn() },
  });
  const panel = (selection: GraphSelection) => {
    const h = handlers();
    render(
      <Inspector activeSection="graphs" selection={selection} plot={plot} table={table}
        userPresets={[]} profileDefault={null} {...h} />,
    );
    return h;
  };

  it("a split selection lands on the panel that edits splits — not on a note pointing elsewhere", () => {
    panel({ kind: "heatmap-split", axis: "row", at: 2 });
    expect(screen.getByLabelText("row split 1 position"), "the split editor is not on screen").toBeTruthy();
    expect(screen.getByLabelText("Break style for all splits")).toBeTruthy();
  });

  it("…and marks that break's row, not another one", () => {
    panel({ kind: "heatmap-split", axis: "row", at: 2 });
    const row = document.querySelector('[data-split-row="row-2"]')!;
    expect(row.className).toContain("on");
    expect(document.querySelector('[data-split-row="col-1"]')!.className).not.toContain("on");
  });

  it("a strip selection marks that strip", () => {
    panel({ kind: "heatmap-track", axis: "col", index: 0 });
    expect(document.querySelector('[data-track-row="col-0"]')!.className).toContain("on");
    expect(document.querySelector('[data-track-row="row-0"]')!.className).not.toContain("on");
  });

  it("the panel can change what was clicked — a break's dash, and a strip's ramp", () => {
    const h = panel({ kind: "heatmap-split", axis: "row", at: 2 });
    fireEvent.change(screen.getByLabelText("row split 1 rule dash"), { target: { value: "dotted" } });
    expect((h.onSetPlotOptions.mock.calls[0]![0] as Plot).heatmap!.rowSplits).toEqual([
      { at: 2, label: "Baseline", dash: "dotted" },
    ]);
    cleanup();
    const h2 = panel({ kind: "heatmap-track", axis: "row", index: 0 });
    fireEvent.change(screen.getByLabelText("row strip 1 reading"), { target: { value: "value" } });
    expect((h2.onSetPlotOptions.mock.calls[0]![0] as Plot).heatmap!.rowTracks![0]).toMatchObject({ scale: "value" });
  });

  it("the strip's ramp has a control, so a user can change it", () => {
    const h = panel({ kind: "heatmap-track", axis: "row", index: 0 });
    fireEvent.change(screen.getByLabelText("row strip 1 reading"), { target: { value: "value" } });
    cleanup();
    const withRamp = { ...HEATMAP, rowTracks: [{ column: "grp", name: "Group", scale: "value" as const }] };
    const h2 = handlers();
    render(
      <Inspector activeSection="graphs" selection={{ kind: "heatmap-track", axis: "row", index: 0 }}
        plot={{ ...plot, heatmap: withRamp }} table={table} userPresets={[]} profileDefault={null} {...h2} />,
    );
    fireEvent.change(screen.getByLabelText("row strip 1 ramp"), { target: { value: "magma" } });
    expect((h2.onSetPlotOptions.mock.calls[0]![0] as Plot).heatmap!.rowTracks![0]).toMatchObject({ ramp: "magma" });
    expect(h).toBeTruthy();
  });
});

// ---------------------------------------------- The key for a numeric strip

/**
 * A numeric strip shades through a ramp with nothing to decode it, so it draws a small colour
 * bar. That bar is a drawable like any other and owes the same four things — and its own
 * fixture, because a strip of words never has one.
 */
describe("a numeric strip's key is clickable, editable and draggable", () => {
  const nTable: DataTable = {
    id: "tn", kind: "xy", name: "TN",
    columns: [{ id: "g", name: "Gene" }, { id: "pur", name: "Tumour purity" }, { id: "c0", name: "S1" }, { id: "c1", name: "S2" }],
    rows: [0, 1, 2, 3].map((i) => ({ id: `r${i}`, cells: { g: `G${i + 1}`, pur: 10 + i * 5, c0: i + 1, c1: i + 2 } })),
  };
  const nPlot: Plot = {
    id: "pn", name: "PN", source: "tn", status: "ok", styleOverrides: {}, kind: "heatmap",
    heatmap: { rowTracks: [{ column: "pur", name: "Purity" }] },
  };
  const nScene = (over: Partial<NonNullable<Plot["heatmap"]>> = {}) =>
    buildPlotScene(nTable, { ...nPlot, heatmap: { ...nPlot.heatmap, ...over } }, { width: 700, height: 520 });
  const nFigure = () => {
    const onSelect = vi.fn();
    const onEditText = vi.fn();
    const onMoveHeatTrackKey = vi.fn();
    const { container } = render(
      <PlotFigure scene={nScene()} onSelect={onSelect} onEditText={onEditText} onMoveHeatTrackKey={onMoveHeatTrackKey} />,
    );
    return { container, onSelect, onEditText, onMoveHeatTrackKey };
  };
  const keyEl = (c: HTMLElement): Element => {
    const el = c.querySelector('[data-heattrackkey="row-0"]');
    expect(el, "the numeric strip drew no key — its ramp means nothing").toBeTruthy();
    return el!;
  };

  it("drawn — and it says the range, so the shading can be read", () => {
    const f = nFigure();
    const texts = [...keyEl(f.container).querySelectorAll("text")].map((t) => t.textContent);
    expect(texts).toContain("25");
    expect(texts).toContain("10");
    expect(texts, "the key does not say what it decodes").toContain("Purity");
  });

  it("clickable — it selects the strip it decodes", () => {
    const f = nFigure();
    fireEvent.click(keyEl(f.container).querySelector("rect")!);
    expect(f.onSelect).toHaveBeenCalledWith({ kind: "heatmap-track", axis: "row", index: 0 });
  });

  it("editable — its caption renames the strip in place", () => {
    const f = nFigure();
    const cap = [...keyEl(f.container).querySelectorAll("text")].find((t) => t.textContent === "Purity")!;
    fireEvent.doubleClick(cap);
    const box = (f.container.querySelector("textarea") ?? document.querySelector("textarea")) as HTMLElement;
    expect(box, "no inline editor opened on the key's caption").toBeTruthy();
    fireEvent.change(box, { target: { value: "Purity (%)" } });
    fireEvent.blur(box);
    expect(f.onEditText).toHaveBeenCalledWith({ kind: "heatTrackName", axis: "row", index: 0 }, "Purity (%)");
  });

  it("draggable — the whole block moves, and the move is written down", () => {
    const f = nFigure();
    const el = keyEl(f.container);
    fireEvent.pointerDown(el, { clientX: 0, clientY: 0, button: 0 });
    fireEvent.pointerMove(el, { clientX: 14, clientY: 9 });
    fireEvent.pointerUp(el, { clientX: 14, clientY: 9 });
    expect(f.onMoveHeatTrackKey, "the key is stuck").toHaveBeenCalled();
    expect(f.onMoveHeatTrackKey.mock.calls[0]!.slice(0, 2)).toEqual(["row", 0]);
  });

  it("…and the offset reaches the drawing", () => {
    const s = nScene({ rowTracks: [{ column: "pur", name: "Purity", keyOffset: { dx: 9, dy: -3 } }] });
    expect(s.heatmap!.tracks![0]!.key!.off).toEqual({ dx: 9, dy: -3 });
  });

  it("switchable — the panel can turn keys off, and then nothing is drawn", () => {
    const onSetPlotOptions = vi.fn();
    render(
      <Inspector activeSection="graphs" selection={{ kind: "heatmap-track", axis: "row", index: 0 }}
        plot={nPlot} table={nTable} userPresets={[]} profileDefault={null}
        onSelect={vi.fn()} onSetAxis={vi.fn()} onSetAxisLength={vi.fn()} onSetAxisTitleFont={vi.fn()}
        onSetSeriesStyle={vi.fn()} onSetSeriesStyleAll={vi.fn()} onSetPointStyle={vi.fn()} onClearPointStyles={vi.fn()}
        onSetGrid={vi.fn()} onSetFrame={vi.fn()} onSetKind={vi.fn()} onSetBarLayout={vi.fn()} onSetBarShape={vi.fn()} onSetBoxWhisker={vi.fn()}
        onSetPlotOptions={onSetPlotOptions} onSetGraphTitle={vi.fn()} onSetPlotFont={vi.fn()} onHomogenizeFont={vi.fn()}
        onSetLegend={vi.fn()} onSetSignificance={vi.fn()} onApplyPreset={vi.fn()} 
        onApplyUserPreset={vi.fn()} onSaveUserPreset={vi.fn()} onDeleteUserPreset={vi.fn()} onSetProfileDefault={vi.fn()}
        annotationOps={{ add: vi.fn(), update: vi.fn(), remove: vi.fn(), reorder: vi.fn(), align: vi.fn(), group: vi.fn(), ungroup: vi.fn(), setLocked: vi.fn(), addImage: vi.fn(), replaceImage: vi.fn() }} />,
    );
    const box = screen.getByLabelText("Key for numeric strips") as HTMLInputElement;
    expect(box.checked, "the numeric-strip key is off by default, which leaves a numeric strip with nothing to decode it").toBe(true);
    fireEvent.click(box);
    expect((onSetPlotOptions.mock.calls[0]![0] as Plot).heatmap).toMatchObject({ trackKeys: false });
    cleanup();
    const { container } = render(<PlotFigure scene={nScene({ trackKeys: false })} />);
    expect(container.querySelector('[data-heattrackkey="row-0"]')).toBeNull();
  });
});
