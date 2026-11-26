// @vitest-environment jsdom
/**
 * Per-curve fitted-curve styling on every graph type that draws a fitted curve (`FIT_KINDS`), on every gallery card of
 * that type: the drawing honours one curve's own style, the panel offers the curve picker, a click on a curve opens the
 * panel on that curve, and several analyses of the same data can each attach their curve.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { MadyDocument } from "@mady/core";
import type { DataTable, Plot, PlotFit } from "@mady/core";
import { buildPlotScene } from "@mady/graphics";
import { FIT_KINDS, Inspector } from "./Inspector";
import { PlotFigure } from "./PlotFigure";
import { galleryItems } from "./gallery";
import { applyAnalysisFit } from "./analysisFits";
import { parseLinePath } from "./fitCurveHit";
import type { GraphSelection } from "./AppShell";

afterEach(cleanup);
afterEach(() => globalThis.localStorage?.clear());
Element.prototype.scrollIntoView = Element.prototype.scrollIntoView ?? (() => {});

const SIZE = { width: 620, height: 420 };
type Card = { title: string; table: DataTable; plot: Plot };
const cards = (galleryItems() as unknown as Card[]).filter((c) => FIT_KINDS.has(c.plot.kind ?? "xy"));

/** Two fitted curves across the card's own X range, so the drawing keeps them in view on every kind. */
function twoFits(c: Card): PlotFit[] {
  const s = buildPlotScene(c.table, c.plot, SIZE);
  const [lo, hi] = s.x.domain as [number, number];
  const [ylo, yhi] = s.y.domain as [number, number];
  const mk = (label: string, f: number): PlotFit => ({
    label,
    points: [0, 0.25, 0.5, 0.75, 1].map((t) => [lo + t * (hi - lo), ylo + (yhi - ylo) * (f * 0.2 + t * 0.6)] as [number, number]),
  });
  return [mk("Curve A", 1), mk("Curve B", 2)];
}
const withFits = (c: Card, over: Partial<Plot> = {}): Plot => ({ ...c.plot, fit: undefined, fits: twoFits(c), ...over }) as Plot;

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

describe("the fixture covers every graph type that draws a fitted curve", () => {
  it("xy, area, bubble and volcano each have a card", () => {
    expect([...new Set(cards.map((c) => c.plot.kind ?? "xy"))].sort()).toEqual([...FIT_KINDS].sort());
  });
  it("a card that draws the two test curves exists for each of them, so the checks below are not vacuous", () => {
    const drawing = cards.filter((c) => (buildPlotScene(c.table, withFits(c), SIZE).fits?.length ?? 0) === 2);
    expect([...new Set(drawing.map((c) => c.plot.kind ?? "xy"))].sort()).toEqual([...FIT_KINDS].sort());
    // the cards that draw none are the ones a fitted curve is refused on (names along X), and they say so
    for (const c of cards.filter((x) => !drawing.includes(x))) {
      expect(buildPlotScene(c.table, withFits(c), SIZE).warnings.join(" ")).toMatch(/No fitted curve/);
    }
  });
});

describe.each(cards.map((c) => [`${c.plot.kind ?? "xy"} — ${c.title}`, c] as const))("%s", (_name, c) => {
  // A bubble chart with names along X draws no fitted curve at all (it says so); nothing to style there.
  const draws = (): boolean => (buildPlotScene(c.table, withFits(c), SIZE).fits?.length ?? 0) === 2;

  it("draws both curves, and one curve's own style reaches that curve only", () => {
    if (!draws()) return;
    const s = buildPlotScene(c.table, withFits(c, { fitStyles: { "1": { color: "#00aa00", width: 7, dash: "dashed" } } }), SIZE);
    expect(s.fits!.map((f) => f.key)).toEqual(["0", "1"]);
    expect(s.fits![1]!.color).toBe("#00aa00");
    expect(s.fits![1]!.width).toBe(7);
    expect(s.fits![1]!.dash).not.toBeNull();
    expect(s.fits![0]!.color).not.toBe("#00aa00");
    expect(s.fits![0]!.width).toBe(2.4);
  });

  it("a click on a curve's hit line opens the panel on that curve", () => {
    if (!draws()) return;
    const got: GraphSelection[] = [];
    const scene = buildPlotScene(c.table, withFits(c), SIZE);
    const { container } = render(<PlotFigure scene={scene} zoom={1} onSelect={(s) => got.push(s)} />);
    for (const el of container.querySelectorAll(".gfx-globalfit .gfx-fit path[stroke='transparent']")) fireEvent.click(el);
    expect(got.map((s) => (s as { item?: string }).item)).toEqual(["0", "1"]);
  });

  it("Alt+click near a curve opens the panel on that curve, even on the data drawn over it; a plain click does not", () => {
    if (!draws()) return;
    const proto = SVGElement.prototype as unknown as { getScreenCTM?: () => unknown };
    const had = proto.getScreenCTM;
    proto.getScreenCTM = () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 });
    try {
      const scene = buildPlotScene(c.table, withFits(c), SIZE);
      const [x, y] = parseLinePath(scene.fits![1]!.path)[2]!;
      const got: GraphSelection[] = [];
      const { container } = render(<PlotFigure scene={scene} zoom={1} onSelect={(s) => got.push(s)} />);
      const over = container.querySelector(".gfx-series path, .gfx-series circle, .gfx-series rect") ?? container.querySelector("svg.gfx-figure")!;
      fireEvent.click(over, { clientX: x, clientY: y + 3 });
      expect(got.some((s) => (s as { item?: string } | null)?.item !== undefined), "a plain click must not pick the curve").toBe(false);
      got.length = 0;
      fireEvent.click(over, { altKey: true, clientX: x, clientY: y + 3 });
      expect(got).toEqual([{ kind: "chart-section", title: "Fitted curve", item: "1" }]);
    } finally {
      if (had) proto.getScreenCTM = had; else delete proto.getScreenCTM;
    }
  });

  it("the panel offers the curve picker and writes one curve's own entry", () => {
    if (!draws()) return;
    const patches: Partial<Plot>[] = [];
    const { container } = render(
      <Inspector activeSection="graphs" selection={{ kind: "chart-section", title: "Fitted curve", item: "1" }} plot={withFits(c)} table={c.table}
        userPresets={[]} profileDefault={null} {...handlers((p) => patches.push(p))} />,
    );
    const sel = container.querySelector<HTMLSelectElement>('[aria-label="Style: fitted curve"]');
    expect(sel, "no curve picker").not.toBeNull();
    expect([...sel!.options].map((o) => o.textContent)).toEqual(["All curves", "Curve A", "Curve B"]);
    expect(sel!.value).toBe("1");
    fireEvent.change(container.querySelector('[aria-label="Fitted curve thickness"]')!, { target: { value: "5" } });
    expect(patches).toEqual([{ fitStyle: undefined, fitStyles: { "1": { width: 5 } } }]);
  });

  it("two analyses of the same data each attach their curve", () => {
    const doc = new MadyDocument();
    const t = doc.importTable("XY", "xy", ["X", "A"], [[1, 2], [2, 4], [3, 6]]);
    const p = doc.addPlot("G", t.id);
    doc.setPlotOptions(p.id, { kind: c.plot.kind ?? "xy" } as Partial<Plot>);
    const cols = t.columns.map((col) => col.id);
    const mk = (name: string, y: number[]) => {
      const a = doc.addAnalysis(name, "regression", t.id, { columns: cols });
      doc.setAnalysisResult(a.id, { method: "regression", title: name, summary: "", glance: {}, terms: [], extra: { curve: { x: [1, 2, 3], y } } } as never);
      return a;
    };
    const a = mk("Line A", [2, 4, 6]);
    const b = mk("Line B", [3, 6, 9]);
    expect(applyAnalysisFit(doc, a.id, p.id)).toBe(true);
    expect(applyAnalysisFit(doc, b.id, p.id)).toBe(true);
    const labels = [p.fit?.label, ...(p.fits ?? []).map((f) => f.label)];
    expect(labels).toEqual(["Line A", "Line B"]);
  });
});
