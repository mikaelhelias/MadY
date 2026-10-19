// @vitest-environment jsdom
/**
 * The fitted curve and its bands — click one, get the panel, and the edit reaches the drawing.
 *
 * After a fit, MadY draws its results on the graph: the curve, dashed lines marking a value and
 * coloured bands marking a range. Each can be selected, edited (colour, opacity, line thickness,
 * dash) and shown or hidden.
 *
 * Defaults: the curve is 2.4px solid, the bands `fillOpacity` 0.08 / 0.18, and the EC50 marker's
 * dash `"4 3"`; the marker is in the reference-line registry. Guards against a fit layer that is
 * not clickable and has no controls.
 *
 * Note: every case here ends at the drawing (the scene the builder emits, and the SVG attributes
 * the renderer writes from it). A panel that writes a field no builder reads looks exactly like
 * one that works — this file checks for exactly that.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import type { Plot } from "@mady/core";
import { referenceLine } from "@mady/core";
import { buildPlotScene } from "@mady/graphics";
import { PlotFigure } from "./PlotFigure";
import { FIT_KINDS, Inspector } from "./Inspector";
import { FIX, buildFor, xyTable } from "./plot-fixtures";
import { galleryItems } from "./gallery";
import type { GraphSelection } from "./AppShell";

afterEach(cleanup);
afterEach(() => globalThis.localStorage?.clear());
Element.prototype.scrollIntoView = Element.prototype.scrollIntoView ?? (() => {});

const XY = FIX.find((f) => f.kind === "xy")!;
const basePlot = (): Plot => ({ id: "p", name: "P", source: xyTable.id, kind: "xy", ...(XY.extra ?? {}) }) as Plot;
const build = (over: Partial<Plot> = {}) => buildPlotScene(xyTable, { ...basePlot(), ...over }, { width: 620, height: 420 });

// ─────────────────────────────────────────────────────────────────────────────
// 1. The fixture can exhibit the behaviour: the curve, both bands and the marker are drawn.
// ─────────────────────────────────────────────────────────────────────────────
describe("guarding the guard — the fixture really draws every part", () => {
  it("curve + confidence band + prediction band + marker", () => {
    const s = buildFor(XY);
    expect(s.fit, "the xy fixture builds no fit — every assertion below would be vacuous").toBeDefined();
    expect(s.fit!.confidenceBandPath).toBeDefined();
    expect(s.fit!.predictionBandPath).toBeDefined();
    expect(s.fit!.marker).toBeDefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. An untouched graph draws exactly the default look.
// ─────────────────────────────────────────────────────────────────────────────
describe("an untouched graph is byte-identical", () => {
  it("resolves the default look when fitStyle is absent", () => {
    const f = build().fit!;
    expect(f.showCurve).toBe(true);
    expect(f.width).toBe(2.4);
    expect(f.dash).toBeNull();
    expect(f.opacity).toBe(1);
    expect(f.ciOpacity).toBe(0.18);
    expect(f.piOpacity).toBe(0.08);
    expect(f.ciColor).toBe(f.color);
    expect(f.piColor).toBe(f.color);
    // The marker's default is the exact "4 3" dash pattern.
    expect(f.marker!.dash).toBe("4 3");
    expect(f.marker!.width).toBe(1.5);
  });

  it("the renderer writes those resolved values as SVG attributes (not its own constants)", () => {
    const { container } = render(<PlotFigure scene={build()} zoom={1} />);
    const curve = container.querySelector<SVGPathElement>(".gfx-fit path[stroke]:not([stroke='transparent']):not([stroke='none'])")!;
    expect(curve.getAttribute("stroke-width")).toBe("2.4");
    const bands = container.querySelectorAll<SVGPathElement>(".gfx-fit path[fill]:not([fill='none'])");
    expect([...bands].map((b) => b.getAttribute("fill-opacity")).sort()).toEqual(["0.08", "0.18"]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Every knob reaches the drawing.
// ─────────────────────────────────────────────────────────────────────────────
describe("the edit reaches the drawing", () => {
  it("curve colour · thickness · dashes · opacity", () => {
    const f = build({ fitStyle: { color: "#123456", width: 5, dash: "dotted", opacity: 0.4 } }).fit!;
    expect(f.color).toBe("#123456");
    expect(f.width).toBe(5);
    // The dash pattern scales with the resolved width.
    expect(f.dash).toBe("5.0,15.0");
    expect(f.opacity).toBe(0.4);
    // …and the bands follow the curve's colour unless given their own.
    expect(f.ciColor).toBe("#123456");
    expect(f.piColor).toBe("#123456");
  });

  it("band colour and opacity, each on its own", () => {
    const f = build({ fitStyle: { ciColor: "#00ff00", ciOpacity: 0.5, piColor: "#0000ff", piOpacity: 0.3 } }).fit!;
    expect(f.ciColor).toBe("#00ff00");
    expect(f.ciOpacity).toBe(0.5);
    expect(f.piColor).toBe("#0000ff");
    expect(f.piOpacity).toBe(0.3);
    expect(f.color, "a band colour must not recolour the curve").not.toBe("#00ff00");
  });

  it("hiding the curve keeps the bands and the marker; hiding a band removes only that band", () => {
    const noCurveScene = build({ fitStyle: { show: false } });
    const noCurve = noCurveScene.fit!;
    expect(noCurve.showCurve).toBe(false);
    expect(noCurve.confidenceBandPath).toBeDefined();
    expect(noCurve.predictionBandPath).toBeDefined();
    expect(noCurve.marker).toBeDefined();
    const noCi = build({ fitStyle: { ciShow: false } }).fit!;
    expect(noCi.confidenceBandPath).toBeUndefined();
    expect(noCi.predictionBandPath).toBeDefined();
    const noPi = build({ fitStyle: { piShow: false } }).fit!;
    expect(noPi.predictionBandPath).toBeUndefined();
    expect(noPi.confidenceBandPath).toBeDefined();
    // The renderer honours showCurve: no visible curve path, bands still there.
    const { container } = render(<PlotFigure scene={noCurveScene} zoom={1} />);
    expect(container.querySelector(".gfx-fit path[stroke-width='2.4']")).toBeNull();
    expect(container.querySelectorAll(".gfx-fit path[fill]:not([fill='none'])").length).toBe(2);
  });

  it("the multi-fit form (plot.fits) honours the same style", () => {
    const AREA = FIX.find((f) => f.kind === "area")!;
    const s = buildPlotScene(xyTable, { id: "p", name: "P", source: xyTable.id, kind: "area", ...(AREA.extra ?? {}), fitStyle: { width: 6, dash: "dashed" } } as Plot, { width: 620, height: 420 });
    expect(s.fits?.length).toBe(2);
    for (const f of s.fits!) {
      expect(f.width).toBe(6);
      expect(f.dash).toBe("36.0,24.0");
    }
  });

  it("the EC50 / IC50 marker is a reference line: its own style, the all-lines style, hide — all land", () => {
    const own = build({ refLineStyles: { "fit-marker": { color: "#abcdef", width: 3, dash: "longdash" } } }).fit!.marker!;
    expect(own.color).toBe("#abcdef");
    expect(own.width).toBe(3);
    expect(own.dash).toBe("33.0,15.0");
    const all = build({ refLine: { color: "#ff0000", dash: "dotted" } }).fit!.marker!;
    expect(all.color).toBe("#ff0000");
    expect(all.dash).toBe("1.5,4.5");
    expect(build({ refLineHidden: { "fit-marker": true } }).fit!.marker, "refLineHidden did not hide the marker").toBeUndefined();
    expect(build({ refLine: { show: false } }).fit!.marker, "refLine.show:false did not hide the marker").toBeUndefined();
    // …and the curve is untouched by any of it.
    expect(build({ refLineHidden: { "fit-marker": true } }).fit!.path).toBe(build().fit!.path);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Clicking routes: curve / bands → the Fitted curve section; marker → its reference line.
// ─────────────────────────────────────────────────────────────────────────────
describe("clicking one selects it", () => {
  const clicksOn = (selector: string): GraphSelection[] => {
    const got: GraphSelection[] = [];
    const { container } = render(<PlotFigure scene={build()} zoom={1} onSelect={(s) => got.push(s)} />);
    for (const el of container.querySelectorAll(selector)) fireEvent.click(el);
    cleanup();
    return got;
  };
  it("a band opens the Fitted curve section", () => {
    const got = clicksOn(".gfx-fit path[fill]:not([fill='none'])");
    expect(got.length).toBe(2);
    for (const s of got) expect(s).toEqual({ kind: "chart-section", title: "Fitted curve" });
  });
  it("the curve (via its hit line) opens the Fitted curve section", () => {
    const got = clicksOn(".gfx-fit path[stroke='transparent']");
    expect(got.length).toBeGreaterThan(0);
    for (const s of got) expect(s).toEqual({ kind: "chart-section", title: "Fitted curve" });
  });
  it("either leg of the marker opens the fit-marker reference line", () => {
    const got = clicksOn(".gfx-fit-marker line[stroke='transparent']");
    expect(got.length).toBe(2);
    for (const s of got) expect(s).toEqual({ kind: "refline", id: "fit-marker" });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. The panel: reachable, and its controls write what the builder reads.
// ─────────────────────────────────────────────────────────────────────────────
const handlers = (onSetPlotOptions: (p: Partial<Plot>) => void, onSelect = vi.fn()) => ({
  onSelect,
  onSetAxis: vi.fn(), onSetAxisLength: vi.fn(), onSetAxisTitleFont: vi.fn(),
  onSetSeriesStyle: vi.fn(), onSetSeriesStyleAll: vi.fn(), onSetPointStyle: vi.fn(), onClearPointStyles: vi.fn(),
  onSetGrid: vi.fn(), onSetFrame: vi.fn(), onSetKind: vi.fn(), onSetBarLayout: vi.fn(), onSetBarShape: vi.fn(), onSetBoxWhisker: vi.fn(),
  onSetPlotOptions, onSetGraphTitle: vi.fn(), onSetPlotFont: vi.fn(), onHomogenizeFont: vi.fn(),
  onSetLegend: vi.fn(), onSetSignificance: vi.fn(), onApplyPreset: vi.fn(), 
  onApplyUserPreset: vi.fn(), onSaveUserPreset: vi.fn(), onDeleteUserPreset: vi.fn(), onSetProfileDefault: vi.fn(),
  annotationOps: { add: vi.fn(), update: vi.fn(), remove: vi.fn(), reorder: vi.fn(), align: vi.fn(), group: vi.fn(), ungroup: vi.fn(), setLocked: vi.fn(), addImage: vi.fn(), replaceImage: vi.fn() },
});

function panel(sel: GraphSelection, plotOver: Partial<Plot> = {}) {
  const patches: Partial<Plot>[] = [];
  const onSelect = vi.fn();
  const { container } = render(
    <Inspector activeSection="graphs" selection={sel} plot={{ ...basePlot(), ...plotOver }} table={xyTable}
      userPresets={[]} profileDefault={null} {...handlers((p) => patches.push(p), onSelect)} />,
  );
  return { container, patches, onSelect };
}

const byAria = <T extends HTMLElement = HTMLInputElement>(c: HTMLElement, aria: string): T => {
  const el = c.querySelector<T>(`[aria-label="${aria}"]`);
  if (!el) throw new Error(`no control labelled "${aria}"`);
  return el;
};

describe("the panel", () => {
  it("clicking a band pins a visible, open 'Fitted curve' section", () => {
    const { container } = panel({ kind: "chart-section", title: "Fitted curve" });
    const secs = [...container.querySelectorAll<HTMLElement>(".inspsec")].filter((s) => !s.hidden);
    expect(secs.length, "the pinned section must be the only one shown").toBe(1);
    expect(secs[0]!.textContent).toContain("Fitted curve");
    expect((secs[0] as HTMLDetailsElement).open, "the pinned section was shown but left collapsed").toBe(true);
  });

  it("offers show / colour / thickness / dashes / opacity for the curve and show / colour / opacity per band", () => {
    const { container } = panel({ kind: "chart-section", title: "Fitted curve" });
    for (const a of ["Show fitted curve", "Fitted curve colour", "Fitted curve thickness", "Fitted curve dashes", "Fitted curve opacity",
      "Show confidence band", "Confidence band colour", "Confidence band opacity",
      "Show prediction band", "Prediction band colour", "Prediction band opacity"]) {
      expect(container.querySelector(`[aria-label="${a}"]`), `no control "${a}"`).not.toBeNull();
    }
  });

  it("a fit with no bands offers no band controls (no control over nothing)", () => {
    const { container } = panel({ kind: "chart-section", title: "Fitted curve" }, { fit: { label: "F", points: [[1, 2], [5, 8]] } });
    expect(container.querySelector('[aria-label="Show confidence band"]')).toBeNull();
    expect(container.querySelector('[aria-label="Show prediction band"]')).toBeNull();
    expect(container.querySelector('[aria-label="Show fitted curve"]')).not.toBeNull();
  });

  it("a graph with no fit has no section", () => {
    const { container } = panel({ kind: "plot" }, { fit: undefined });
    expect(container.textContent).not.toContain("Fitted curve");
  });

  it("FIT_KINDS is exactly the set of kinds whose builder draws plot.fit — derived, not asserted", () => {
    // An analysis attaches its fit to the first graph of its table whatever the kind; the section
    // must be offered on precisely the kinds that then draw it, or it is controls over nothing
    // (gated on the fit alone, it would do nothing on most kinds).
    const draws = new Set<string>();
    const seen = new Set<string>();
    for (const g of galleryItems()) {
      const kind = g.plot.kind ?? "xy";
      if (seen.has(kind)) continue;
      seen.add(kind);
      try {
        const s = buildPlotScene(g.table, { ...g.plot, fit: { label: "F", points: [[0.5, 1], [2, 4], [50, 9]] } } as Plot, { width: 600, height: 400 });
        if (s.fit) draws.add(kind);
      } catch { /* a kind that cannot build from its card draws nothing */ }
    }
    expect(seen.size, "the gallery enumerated no kinds").toBeGreaterThan(20);
    expect([...FIT_KINDS].sort()).toEqual([...draws].sort());
    // …and the EC50 / IC50 marker's registry entry names the same kinds — it is drawn wherever
    // the fit is, so offering it elsewhere (or withholding it here) would be equally wrong.
    expect([...referenceLine("fit-marker")!.kinds].sort()).toEqual([...draws].sort());
    // …and a kind outside the list gets no section even with a fit attached.
    const bar = galleryItems().find((g) => g.plot.kind === "bar")!;
    const { container } = render(
      <Inspector activeSection="graphs" selection={{ kind: "plot" }} plot={{ ...bar.plot, fit: basePlot().fit } as Plot} table={bar.table}
        userPresets={[]} profileDefault={null} {...handlers(vi.fn())} />,
    );
    expect(container.textContent).not.toContain("Fitted curve");
  });

  it("each control writes what the builder reads — applied and rebuilt", () => {
    const { container, patches } = panel({ kind: "chart-section", title: "Fitted curve" });
    fireEvent.change(byAria<HTMLSelectElement>(container, "Fitted curve dashes"), { target: { value: "longdash" } });
    fireEvent.change(byAria(container, "Fitted curve thickness"), { target: { value: "4" } });
    fireEvent.change(byAria(container, "Confidence band opacity"), { target: { value: "0.5" } });
    fireEvent.click(byAria(container, "Show prediction band"));
    fireEvent.click(byAria(container, "Show fitted curve"));
    expect(patches.length).toBe(5);
    // Each patch is written against the panel's current props (unchanged between events here),
    // so apply the union of what they set — that is what a live document would end up with.
    const merged = Object.assign({}, ...patches.map((p) => p.fitStyle ?? {}));
    const f = build({ fitStyle: merged }).fit!;
    expect(f.dash).toBe("44.0,20.0"); // longdash at width 4
    expect(f.width).toBe(4);
    expect(f.ciOpacity).toBe(0.5);
    expect(f.predictionBandPath).toBeUndefined();
    expect(f.showCurve).toBe(false);
  });

  it("Reset clears fitStyle entirely, and the marker link opens the reference-line panel", () => {
    const { container, patches, onSelect } = panel({ kind: "chart-section", title: "Fitted curve" }, { fitStyle: { width: 9 } });
    fireEvent.click([...container.querySelectorAll("button")].find((b) => b.textContent === "Reset")!);
    expect(patches).toEqual([{ fitStyle: undefined }]);
    fireEvent.click([...container.querySelectorAll("button")].find((b) => (b.textContent ?? "").startsWith("EC50 / IC50 marker"))!);
    expect(onSelect).toHaveBeenCalledWith({ kind: "refline", id: "fit-marker" });
  });

  it("the marker's panel opens on the drawn values (1.5 px, the curve's colour), and the marker follows fitStyle.color", () => {
    const { container } = panel({ kind: "refline", id: "fit-marker" });
    expect((container.querySelector('[aria-label="Reference line thickness"]') as HTMLInputElement).value).toBe("1.5");
    const drawn = build().fit!;
    expect((container.querySelector('[aria-label="Reference line colour"]') as HTMLInputElement).value.toLowerCase()).toBe(drawn.marker!.color.toLowerCase());
    // Recolour the curve → the crosshair follows (its own refLineStyles colour still wins).
    expect(build({ fitStyle: { color: "#112233" } }).fit!.marker!.color).toBe("#112233");
    expect(build({ fitStyle: { color: "#112233" }, refLineStyles: { "fit-marker": { color: "#445566" } } }).fit!.marker!.color).toBe("#445566");
  });

  it("the marker's reference-line panel is the real one, and lists under Chart → EC50 / IC50 marker", () => {
    const { container } = panel({ kind: "refline", id: "fit-marker" });
    expect(container.textContent).toContain("EC50 / IC50 marker");
    expect(container.textContent).not.toContain("This annotation was removed");
    expect(container.querySelector('[aria-label="Reference line dashes"]')).not.toBeNull();
    const chart = panel({ kind: "plot" });
    expect(chart.container.querySelector('input[aria-label="Show EC50 / IC50 marker"]')).not.toBeNull();
  });
});
