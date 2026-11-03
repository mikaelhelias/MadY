// @vitest-environment jsdom
/**
 * One fitted curve can be styled on its own: clicking a curve (or its legend row) opens the Fitted curve panel on that
 * curve, the panel's Style picker chooses one curve or all of them, and what it writes is what the builder reads.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import type { Plot, PlotFit } from "@mady/core";
import { buildPlotScene } from "@mady/graphics";
import { PlotFigure } from "./PlotFigure";
import { Inspector } from "./Inspector";
import { xyTable } from "./plot-fixtures";
import { parseLinePath } from "./fitCurveHit";
import type { GraphSelection } from "./AppShell";

afterEach(cleanup);
afterEach(() => globalThis.localStorage?.clear());
Element.prototype.scrollIntoView = Element.prototype.scrollIntoView ?? (() => {});

const fit = (label: string, k: number): PlotFit => ({
  label,
  points: [0, 1, 2, 3].map((x) => [x, k * x] as [number, number]),
  confidenceBand: [0, 1, 2, 3].map((x) => [x, k * x - 0.3, k * x + 0.3] as [number, number, number]),
});
const plot = (over: Partial<Plot> = {}): Plot => ({ id: "p", name: "P", source: xyTable.id, status: "ok", styleOverrides: {}, kind: "xy", fits: [fit("Compound A", 1), fit("Compound B", 2)], ...over }) as Plot;
const SIZE = { width: 620, height: 420 };

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
function panel(sel: GraphSelection, over: Partial<Plot> = {}) {
  const patches: Partial<Plot>[] = [];
  const { container } = render(
    <Inspector activeSection="graphs" selection={sel} plot={plot(over)} table={xyTable}
      userPresets={[]} profileDefault={null} {...handlers((p) => patches.push(p))} />,
  );
  return { container, patches };
}
const byAria = <T extends HTMLElement = HTMLInputElement>(c: HTMLElement, aria: string): T => {
  const el = c.querySelector<T>(`[aria-label="${aria}"]`);
  if (!el) throw new Error(`no control labelled "${aria}"`);
  return el;
};
const FITTED: GraphSelection = { kind: "chart-section", title: "Fitted curve" };

describe("clicking a curve picks it", () => {
  it("each curve's hit line opens the panel on its own curve", () => {
    const got: GraphSelection[] = [];
    const { container } = render(<PlotFigure scene={buildPlotScene(xyTable, plot(), SIZE)} zoom={1} onSelect={(s) => got.push(s)} />);
    for (const el of container.querySelectorAll(".gfx-globalfit .gfx-fit path[stroke='transparent']")) fireEvent.click(el);
    expect(got).toEqual([
      { kind: "chart-section", title: "Fitted curve", item: "0" },
      { kind: "chart-section", title: "Fitted curve", item: "1" },
    ]);
  });

  it("a curve's legend row opens the panel on that curve", () => {
    const got: GraphSelection[] = [];
    const scene = buildPlotScene(xyTable, plot({ fitStyle: { inLegend: true } }), SIZE);
    const { container } = render(<PlotFigure scene={scene} zoom={1} onSelect={(s) => got.push(s)} />);
    const rows = [...container.querySelectorAll<SVGElement>("[data-legend-line]")];
    expect(rows.length, "the fit rows are in the legend").toBe(2);
    for (const r of rows) fireEvent.click(r);
    expect(got.map((s) => (s as { item?: string }).item)).toEqual(["0", "1"]);
  });
});

describe("Alt+click picks the fitted curve under the pointer", () => {
  const identity = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
  const proto = SVGElement.prototype as unknown as { getScreenCTM?: () => unknown };
  const had = proto.getScreenCTM;
  afterEach(() => { if (had) proto.getScreenCTM = had; else delete proto.getScreenCTM; });

  /** A point on curve 1's drawn path, and a figure rendered with identity screen geometry (jsdom has none of its own). */
  function figure() {
    proto.getScreenCTM = () => identity;
    const scene = buildPlotScene(xyTable, plot(), SIZE);
    const [x, y] = parseLinePath(scene.fits![1]!.path)[2]!;
    const got: GraphSelection[] = [];
    const view = render(<PlotFigure scene={scene} zoom={1} onSelect={(s) => got.push(s)} />);
    return { ...view, scene, got, x, y };
  }

  // The data line is the series element with a click handler of its own: a plain click on it selects the series.
  const dataLine = (c: HTMLElement) => c.querySelector<SVGElement>(".gfx-series path")!;

  it("a plain click on the data line selects the series, as ever (the target is a real one)", () => {
    const { container, got, x, y } = figure();
    fireEvent.click(dataLine(container), { clientX: x, clientY: y + 4 });
    expect(got.map((s) => s?.kind)).toEqual(["series"]);
  });

  it("Alt+click on the figure near a curve opens the panel on that curve", () => {
    const { container, got, x, y } = figure();
    fireEvent.click(container.querySelector("svg.gfx-figure")!, { altKey: true, clientX: x, clientY: y + 4 });
    expect(got).toEqual([{ kind: "chart-section", title: "Fitted curve", item: "1" }]);
  });

  it("Alt+click lands on the curve even when the click's target is the data line drawn over it, and the data line gets nothing", () => {
    const { container, got, x, y } = figure();
    fireEvent.click(dataLine(container), { altKey: true, clientX: x, clientY: y + 4 });
    expect(got).toEqual([{ kind: "chart-section", title: "Fitted curve", item: "1" }]);
  });

  it("Alt+click near neither curve, even on the data line, is left alone and selects the series as a plain click does", () => {
    const { container, got, x, y } = figure();
    fireEvent.click(dataLine(container), { altKey: true, clientX: x + 400, clientY: y + 400 });
    expect(got.map((s) => s?.kind)).toEqual(["series"]);
  });

  it("a point just outside a curve's reach is not picked, and one just inside is", () => {
    const { container, got, x, y } = figure();
    fireEvent.click(container.querySelector("svg.gfx-figure")!, { altKey: true, clientX: x, clientY: y + 40 });
    expect(got, "outside every curve's reach it is an ordinary click on the blank figure").toEqual([{ kind: "plot" }]);
    fireEvent.click(container.querySelector("svg.gfx-figure")!, { altKey: true, clientX: x, clientY: y + 5 });
    expect(got.at(-1)).toEqual({ kind: "chart-section", title: "Fitted curve", item: "1" });
  });

  it("the panel's hint says to Alt+click the curve", () => {
    const { container } = panel(FITTED);
    expect(container.textContent).toContain("Alt+click");
  });
});

describe("the Fitted curve panel", () => {
  it("offers a Style picker with every curve when there are two or more, and none for one curve", () => {
    const { container } = panel(FITTED);
    const sel = byAria<HTMLSelectElement>(container, "Style: fitted curve");
    expect([...sel.options].map((o) => o.textContent)).toEqual(["All curves", "Compound A", "Compound B"]);
    cleanup();
    const one = panel(FITTED, { fits: undefined, fit: fit("Only", 1) });
    expect(one.container.querySelector('[aria-label="Style: fitted curve"]')).toBeNull();
  });

  it("opens on the clicked curve, and a change writes that curve's own entry, not fitStyle", () => {
    const { container, patches } = panel({ ...FITTED, item: "1" });
    expect(byAria<HTMLSelectElement>(container, "Style: fitted curve").value).toBe("1");
    fireEvent.change(byAria(container, "Fitted curve thickness"), { target: { value: "5" } });
    expect(patches).toEqual([{ fitStyle: undefined, fitStyles: { "1": { width: 5 } } }]);
    // …and the builder draws it on that curve only.
    const s = buildPlotScene(xyTable, plot({ fitStyles: { "1": { width: 5 } } }), SIZE);
    expect(s.fits!.map((f) => f.width)).toEqual([2.4, 5]);
  });

  it("with All curves picked, a change writes fitStyle and clears that field from the curves' own entries", () => {
    const { container, patches } = panel(FITTED, { fitStyles: { "0": { width: 9, dash: "dashed" } } });
    fireEvent.change(byAria(container, "Fitted curve thickness"), { target: { value: "4" } });
    expect(patches).toEqual([{ fitStyle: { width: 4 }, fitStyles: { "0": { dash: "dashed" } } }]);
  });

  it("picking a curve in the Style select shows that curve's own value", () => {
    const { container } = panel(FITTED, { fitStyles: { "1": { width: 7 } } });
    expect(byAria(container, "Fitted curve thickness").getAttribute("value")).toBe("2.4");
    fireEvent.change(byAria<HTMLSelectElement>(container, "Style: fitted curve"), { target: { value: "1" } });
    expect(byAria(container, "Fitted curve thickness").getAttribute("value")).toBe("7");
  });

  it("Reset this curve clears only that curve's entry", () => {
    const { container, patches } = panel({ ...FITTED, item: "1" }, { fitStyle: { width: 3 }, fitStyles: { "0": { color: "#111111" }, "1": { color: "#00aa00" } } });
    fireEvent.click([...container.querySelectorAll("button")].find((b) => b.textContent === "Reset this curve")!);
    expect(patches).toEqual([{ fitStyle: { width: 3 }, fitStyles: { "0": { color: "#111111" } } }]);
  });

  it("Remove this curve takes that curve off the graph and keeps the other", () => {
    const { container, patches } = panel({ ...FITTED, item: "1" }, { fitStyles: { "1": { color: "#00aa00" } } });
    fireEvent.click([...container.querySelectorAll("button")].find((b) => b.textContent === "Remove this curve")!);
    expect(patches).toHaveLength(1);
    expect(patches[0]!.fits?.map((f) => f.label)).toEqual(["Compound A"]);
    expect(patches[0]!.fitStyles).toBeUndefined();
  });

  it("with All curves picked there is no Remove button", () => {
    const { container } = panel(FITTED);
    expect([...container.querySelectorAll("button")].some((b) => b.textContent === "Remove this curve")).toBe(false);
  });

  it("two curves of one name (two analyses of the same data) are told apart by their number", () => {
    const twin = (src: string): PlotFit => ({ ...fit("Dose-response", 1), analysisSource: src });
    const { container } = panel(FITTED, { fit: undefined, fits: [twin("an1"), twin("an2")] });
    const sel = byAria<HTMLSelectElement>(container, "Style: fitted curve");
    expect([...sel.options].map((o) => o.textContent)).toEqual(["All curves", "Dose-response (1)", "Dose-response (2)"]);
    expect([...sel.options].map((o) => o.value)).toEqual(["all", "an1:Dose-response", "an2:Dose-response"]);
  });

  it("the colour shown for a curve that has none set is the colour it is drawn in", () => {
    const { container } = panel({ ...FITTED, item: "1" });
    const drawn = buildPlotScene(xyTable, plot(), SIZE).fits![1]!.color;
    expect(byAria(container, "Fitted curve colour").getAttribute("value")?.toLowerCase()).toBe(drawn.toLowerCase());
  });
});
