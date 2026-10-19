// @vitest-environment jsdom
/**
 * The fit's parameter block, line by line: each line can be edited, split apart, or removed
 * when the statistic is not needed.
 *
 * Each line drags on its own ("Move lines together" joins them), typed text is kept through a
 * re-fit with a warning, and every number the fit reports can be switched on or off.
 *
 * Every case ends at the drawing — the scene the builder emits or the SVG the renderer writes.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import type { Plot, PlotFit } from "@mady/core";
import { buildPlotScene } from "@mady/graphics";
import { PlotFigure } from "./PlotFigure";
import { Inspector } from "./Inspector";
import { xyTable } from "./plot-fixtures";

afterEach(cleanup);
Element.prototype.scrollIntoView = Element.prototype.scrollIntoView ?? (() => {});

// The nine rows a Boltzmann fit reports (engine.py), as `fitParamRows` types them.
const KEYS = ["Bottom", "Top", "V50", "Slope", "R²", "Adjusted R²", "Sy.x (RMSE)", "Sum of squares", "Runs test (lack of fit)"];
const TEXT = ["Bottom = -0.057 ± 0.448", "Top = 99.9 ± 0.447", "V_{50} = 55 ± 0.093", "Slope = 3 ± 0.083", "R² = 1", "Adjusted R² = 1", "Sy.x (RMSE) = 0.807", "Sum of squares = 4.56", "Runs test (lack of fit) = 11"];
const pts: [number, number][] = Array.from({ length: 11 }, (_, i) => [i, 10 * i] as [number, number]);
const FIT: PlotFit = { label: "Boltzmann", points: pts, params: TEXT, paramKeys: KEYS };
const basePlot = (over: Partial<Plot> = {}): Plot =>
  ({ id: "p", name: "P", source: xyTable.id, kind: "xy", status: "ok", styleOverrides: {}, fit: FIT, ...over }) as Plot;
const scene = (over: Partial<Plot> = {}) => buildPlotScene(xyTable, basePlot(over), { width: 620, height: 420 });
const drawn = (c: HTMLElement) => [...c.querySelectorAll(".gfx-fit-texts text")].map((t) => (t.textContent ?? "").trim());

describe("the builder", () => {
  it("guarding the guard: the fixture draws a block", () => {
    expect(scene().fit?.params, "no block — every case below would be vacuous").toBeDefined();
  });
  it("shows the first six of the nine by default, each carrying its key", () => {
    const p = scene().fit!.params!;
    expect(p.items!.map((i) => i.key)).toEqual(KEYS.slice(0, 6));
    expect(p.lines).toEqual(TEXT.slice(0, 6));
  });
  it("a line switched on or off is shown or dropped, and the block re-stacks from the bottom", () => {
    const p = scene({ fitParams: { lines: { "Top": { show: false }, "Sum of squares": { show: true } } } }).fit!.params!;
    expect(p.items!.map((i) => i.key)).toEqual(["Bottom", "V50", "Slope", "R²", "Adjusted R²", "Sum of squares"]);
  });
  it("typed text replaces the line; a changed fitted value keeps it and warns", () => {
    const same = scene({ fitParams: { lines: { V50: { text: "Tm = 55 °C", fittedText: TEXT[2] } } } });
    expect(same.fit!.params!.lines[2]).toBe("Tm = 55 °C");
    expect(same.warnings.some((w) => w.includes("V50"))).toBe(false);
    const moved = scene({ fitParams: { lines: { V50: { text: "Tm = 55 °C", fittedText: "V_{50} = 54 ± 0.1" } } } });
    expect(moved.fit!.params!.lines[2]).toBe("Tm = 55 °C");
    expect(moved.warnings.some((w) => w.includes("fitted value of V50 changed"))).toBe(true);
  });
  it("hiding every line draws no block at all", () => {
    const lines = Object.fromEntries(KEYS.map((k) => [k, { show: false }]));
    expect(scene({ fitParams: { lines } }).fit!.params).toBeUndefined();
  });
  it("a fit whose parameter lines carry no keys is addressed by position", () => {
    const old: PlotFit = { label: "old", points: pts, params: ["a = 1", "b = 2"] };
    const p = scene({ fit: old, fitParams: { lines: { "#0": { show: false } } } }).fit!.params!;
    expect(p.items!.map((i) => i.key)).toEqual(["#1"]);
  });
});

describe("the drawing", () => {
  it("each shown line is its own text; a drag on one reports that line, measured from its place", () => {
    const onMoveFitParamLine = vi.fn();
    const onMoveFitParams = vi.fn();
    const s = scene({ fitParams: { offset: { dx: 10, dy: 5 }, lines: { V50: { offset: { dx: 1, dy: 2 } } } } });
    const { container } = render(<PlotFigure scene={s} onMoveFitParamLine={onMoveFitParamLine} onMoveFitParams={onMoveFitParams} />);
    // RichText sets "V_{50}" as V with a subscript tspan, so the drawn text reads "V50".
    expect(drawn(container)).toEqual(TEXT.slice(0, 6).map((t) => t.replace(/[\^_]\{([^}]*)\}/g, "$1")));
    const v50 = [...container.querySelectorAll(".gfx-fit-texts text")].find((t) => t.textContent?.startsWith("V"))!;
    fireEvent.pointerDown(v50, { clientX: 100, clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(v50, { clientX: 130, clientY: 80, pointerId: 1 });
    fireEvent.pointerUp(v50, { clientX: 130, clientY: 80, pointerId: 1 });
    // total offset (10+1+30, 5+2-20) minus the block's (10, 5)
    expect(onMoveFitParamLine).toHaveBeenLastCalledWith("V50", 31, -18);
    expect(onMoveFitParams).not.toHaveBeenCalled();
  });
  it("'Move lines together' draws one block, and a drag moves the block", () => {
    const onMoveFitParamLine = vi.fn();
    const onMoveFitParams = vi.fn();
    const { container } = render(<PlotFigure scene={scene({ fitParams: { together: true } })} onMoveFitParamLine={onMoveFitParamLine} onMoveFitParams={onMoveFitParams} />);
    const texts = [...container.querySelectorAll(".gfx-fit-texts text")];
    expect(texts).toHaveLength(1);
    fireEvent.pointerDown(texts[0]!, { clientX: 100, clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(texts[0]!, { clientX: 120, clientY: 100, pointerId: 1 });
    fireEvent.pointerUp(texts[0]!, { clientX: 120, clientY: 100, pointerId: 1 });
    expect(onMoveFitParams).toHaveBeenLastCalledWith(20, 0);
    expect(onMoveFitParamLine).not.toHaveBeenCalled();
  });
  it("a click on a line opens Fit parameters, not the curve's panel", () => {
    const onSelect = vi.fn();
    const { container } = render(<PlotFigure scene={scene()} onSelect={onSelect} />);
    const line = container.querySelector(".gfx-fit-texts text")!;
    fireEvent.pointerDown(line, { clientX: 50, clientY: 50, pointerId: 1 });
    fireEvent.pointerUp(line, { clientX: 50, clientY: 50, pointerId: 1 });
    expect(onSelect).toHaveBeenLastCalledWith({ kind: "chart-section", title: "Fit parameters" });
  });
  it("a double-click opens the editor on that line, and committing reports its key", () => {
    const onEditText = vi.fn();
    const { container } = render(<PlotFigure scene={scene()} onEditText={onEditText} />);
    const top = [...container.querySelectorAll(".gfx-fit-texts text")].find((t) => t.textContent?.startsWith("Top"))!;
    fireEvent.doubleClick(top);
    const box = container.querySelector<HTMLInputElement | HTMLTextAreaElement>("input, textarea");
    expect(box, "no inline editor opened").toBeTruthy();
    fireEvent.change(box!, { target: { value: "Top = 100 RFU" } });
    fireEvent.keyDown(box!, { key: "Enter" });
    expect(onEditText).toHaveBeenCalledWith({ kind: "fitParams", keys: ["Top"] }, "Top = 100 RFU");
  });
});

describe("the Fit parameters panel", () => {
  const handlers = (onSetPlotOptions: (p: Partial<Plot>) => void) => ({
    onSelect: vi.fn(),
    onSetAxis: vi.fn(), onSetAxisLength: vi.fn(), onSetAxisTitleFont: vi.fn(),
    onSetSeriesStyle: vi.fn(), onSetSeriesStyleAll: vi.fn(), onSetPointStyle: vi.fn(), onClearPointStyles: vi.fn(),
    onSetGrid: vi.fn(), onSetFrame: vi.fn(), onSetKind: vi.fn(), onSetBarLayout: vi.fn(), onSetBarShape: vi.fn(), onSetBoxWhisker: vi.fn(),
    onSetPlotOptions, onSetGraphTitle: vi.fn(), onSetPlotFont: vi.fn(), onHomogenizeFont: vi.fn(),
    onSetLegend: vi.fn(), onSetSignificance: vi.fn(), onApplyPreset: vi.fn(),
    onApplyUserPreset: vi.fn(), onSaveUserPreset: vi.fn(), onDeleteUserPreset: vi.fn(), onSetProfileDefault: vi.fn(),
    annotationOps: { add: vi.fn(), update: vi.fn(), remove: vi.fn(), reorder: vi.fn(), align: vi.fn(), group: vi.fn(), ungroup: vi.fn(), setLocked: vi.fn(), addImage: vi.fn(), replaceImage: vi.fn() },
  });
  const panel = (over: Partial<Plot> = {}) => {
    const patches: Partial<Plot>[] = [];
    const plot = basePlot(over);
    const { container } = render(
      <Inspector activeSection="graphs" selection={{ kind: "chart-section", title: "Fit parameters" }} plot={plot} table={xyTable}
        userPresets={[]} profileDefault={null} {...handlers((p) => patches.push(p))} />,
    );
    const applied = () => patches.reduce<Plot>((acc, p) => ({ ...acc, ...p }), plot);
    return { container, patches, applied };
  };
  const byAria = (c: HTMLElement, aria: string): HTMLElement => {
    const el = c.querySelector<HTMLElement>(`[aria-label="${aria}"]`);
    if (!el) throw new Error(`no control labelled "${aria}"`);
    return el;
  };

  it("lists all nine statistics, the first six ticked", () => {
    const { container } = panel();
    const boxes = KEYS.map((k) => byAria(container, `Show ${k}`) as HTMLInputElement);
    expect(boxes.map((b) => b.checked)).toEqual([true, true, true, true, true, true, false, false, false]);
  });
  it("ticking and unticking reaches the drawing", () => {
    const { container, applied } = panel();
    fireEvent.click(byAria(container, "Show R²"));
    const p = buildPlotScene(xyTable, applied(), { width: 620, height: 420 }).fit!.params!;
    expect(p.items!.map((i) => i.key)).not.toContain("R²");
    cleanup();
    const second = panel();
    fireEvent.click(byAria(second.container, "Show Sum of squares"));
    const q = buildPlotScene(xyTable, second.applied(), { width: 620, height: 420 }).fit!.params!;
    expect(q.items!.map((i) => i.key)).toContain("Sum of squares");
  });
  it("an edited line says so, warns when its value changed, and Reset puts the fitted text back in the drawing", () => {
    const { container, applied } = panel({ fitParams: { lines: { V50: { text: "Tm = 55 °C", fittedText: "V_{50} = 54" } } } });
    expect(container.textContent).toContain("value changed");
    fireEvent.click(byAria(container, "Reset V50 to the fitted text"));
    expect(buildPlotScene(xyTable, applied(), { width: 620, height: 420 }).fit!.params!.lines[2]).toBe(TEXT[2]);
  });
  it("'Move lines together' joins them into one block and drops their own positions", () => {
    const { container, applied } = panel({ fitParams: { lines: { V50: { offset: { dx: 40, dy: 40 }, text: "Tm" } } } });
    fireEvent.click(byAria(container, "Move fit parameter lines together"));
    const p = buildPlotScene(xyTable, applied(), { width: 620, height: 420 }).fit!.params!;
    expect(p.together).toBe(true);
    expect(p.items!.every((i) => !i.offset)).toBe(true);
    expect(p.lines[2]).toBe("Tm");
  });
});
