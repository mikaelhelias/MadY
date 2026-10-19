// @vitest-environment jsdom
/**
 * ΔTm beside each Tm on the graph: a melting-temperature analysis with a control gives every other
 * sample's Tm marker its shift from the control, as a second line under the Tm ("ΔTm +4.0 °C"). One setting,
 * `fitStyle.markerDelta`, shown by default, reached from the marker's own panel in the Inspector and
 * from the analysis sheet.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { MadyDocument } from "@mady/core";
import type { Analysis, Plot, Project } from "@mady/core";
import { buildPlotScene } from "@mady/graphics";
import { applyAnalysisFit, deltaTmPlots } from "./analysisFits";
import { meltMarker } from "./analysisExport";
import { Inspector } from "./Inspector";
import { AnalysisPane } from "./panes";
import { PlotFigure } from "./PlotFigure";

afterEach(cleanup);
afterEach(() => globalThis.localStorage?.clear());
Element.prototype.scrollIntoView = Element.prototype.scrollIntoView ?? (() => {});

const xs = Array.from({ length: 41 }, (_, i) => 30 + i);
const sig = (tm: number) => xs.map((x) => 100 + 800 / (1 + Math.exp((tm - x) / 2.5)));

describe("meltMarker — the ΔTm text", () => {
  it("is signed, one decimal, in X's unit", () => {
    expect(meltMarker({ x: xs, y: sig(56) }, 56, "°C", 4.77)!.delta).toBe("ΔTm +4.8 °C");
    expect(meltMarker({ x: xs, y: sig(50) }, 50, "°C", -1.23)!.delta).toBe("ΔTm −1.2 °C");
    expect(meltMarker({ x: xs, y: sig(56) }, 56, "", 4)!.delta).toBe("ΔTm +4.0");
  });
  it("is absent without a shift (the control itself, or no control chosen)", () => {
    expect(meltMarker({ x: xs, y: sig(52) }, 52, "°C")).not.toHaveProperty("delta");
    expect(meltMarker({ x: xs, y: sig(52) }, 52, "°C", undefined)).not.toHaveProperty("delta");
  });
});

/** Three samples, Apo as the control: Ligand A +4, Ligand B +8. */
function melted(control: boolean) {
  const doc = new MadyDocument();
  const labels = ["Apo", "Ligand A", "Ligand B"];
  const t = doc.importTable("Melt", "xy", ["Temperature (°C)", ...labels], xs.map((x, i) => [x, ...labels.map((_, k) => sig(52 + 4 * k)[i]!)]));
  const p = doc.addPlot("Melt", t.id);
  const a = doc.addAnalysis("Tm", "meltingtemp", t.id, { columns: t.columns.slice(1).map((c) => c.id) });
  doc.setAnalysisResult(a.id, {
    method: "meltingtemp", title: "Tm", summary: "", glance: {},
    terms: labels.map((l, k) => ({ term: `Tm (fit) — ${l}`, estimate: 52 + 4 * k })),
    extra: {
      unit: "°C",
      curves: labels.map((l, k) => ({ label: l, x: xs, y: sig(52 + 4 * k), tm: 52 + 4 * k })),
      samples: labels.map((l, k) => ({ label: l, tm_fit: 52 + 4 * k, ...(control && k > 0 ? { dtm: 4 * k } : {}) })),
    },
  } as never);
  expect(applyAnalysisFit(doc, a.id, p.id)).toBe(true);
  return { doc, t, p, a };
}
const labelsDrawn = (doc: MadyDocument, over: Partial<Plot> = {}) => {
  const j = doc.toJSON();
  const scene = buildPlotScene(j.tables[0]!, { ...j.plots[0]!, ...over }, { width: 700, height: 420 });
  return (scene.fits ?? []).map((f) => [f.marker?.label, f.marker?.delta?.text]);
};

describe("on the graph", () => {
  it("with a control: every other sample's Tm carries its ΔTm; the control's does not", () => {
    const { p } = melted(true);
    expect(p.fits?.map((f) => f.marker?.delta)).toEqual([undefined, "ΔTm +4.0 °C", "ΔTm +8.0 °C"]);
  });

  it("drawn by default; `fitStyle.markerDelta: false` takes it off again", () => {
    const { doc } = melted(true);
    expect(labelsDrawn(doc)).toEqual([["Tm = 52.0 °C", undefined], ["Tm = 56.0 °C", "ΔTm +4.0 °C"], ["Tm = 60.0 °C", "ΔTm +8.0 °C"]]);
    expect(labelsDrawn(doc, { fitStyle: { markerDelta: false } })).toEqual([["Tm = 52.0 °C", undefined], ["Tm = 56.0 °C", undefined], ["Tm = 60.0 °C", undefined]]);
  });

  it("without a control the labels are unchanged", () => {
    const { doc } = melted(false);
    expect(labelsDrawn(doc)).toEqual([["Tm = 52.0 °C", undefined], ["Tm = 56.0 °C", undefined], ["Tm = 60.0 °C", undefined]]);
  });
});

describe("the two-line labels have room", () => {
  /** The thermal-shift case the feature is for: Tm 52.1 / 56.9 / 61.4 °C over 25–85 °C, three
   *  curves close together, at the graph size the app opens with. One-line labels
   *  ("Tm = 56.9 °C (ΔTm +4.8 °C)") would run over each other and over the curves here. */
  function thermalShift() {
    const doc = new MadyDocument();
    const T = Array.from({ length: 61 }, (_, i) => 25 + i);
    const tms = [52.1, 56.9, 61.4];
    const curve = (tm: number) => T.map((x) => 1200 + 7800 / (1 + Math.exp((tm - x) / 1.9)));
    const labels = ["Apo", "Ligand A", "Ligand B"];
    const t = doc.importTable("Melt", "xy", ["Temperature (°C)", ...labels], T.map((x, i) => [x, ...tms.map((tm) => curve(tm)[i]!)]));
    const p = doc.addPlot("Melt", t.id);
    const a = doc.addAnalysis("Tm", "meltingtemp", t.id, { columns: t.columns.slice(1).map((c) => c.id) });
    doc.setAnalysisResult(a.id, {
      method: "meltingtemp", title: "Tm", summary: "", glance: {}, terms: [],
      extra: {
        unit: "°C",
        curves: labels.map((l, k) => ({ label: l, x: T, y: curve(tms[k]!), tm: tms[k]! })),
        samples: labels.map((l, k) => ({ label: l, tm_fit: tms[k]!, ...(k > 0 ? { dtm: tms[k]! - tms[0]! } : {}) })),
      },
    } as never);
    expect(applyAnalysisFit(doc, a.id, p.id)).toBe(true);
    const j = doc.toJSON();
    // At the tick font the app's house style gives a new graph (20 px).
    return buildPlotScene(j.tables[0]!, { ...j.plots[0]!, fonts: { tick: { size: 20 } } }, { width: 900, height: 560, measure });
  }
  /** Text width, deliberately generous; the builder places with it and the check below measures with it. */
  const measure = (t: string, px: number) => t.length * px * 0.62;
  type Box = { x1: number; y1: number; x2: number; y2: number };
  /** Each Tm label's ink — both lines when it has a ΔTm — worked out from where it is drawn. */
  const labelBlocks = (scene: ReturnType<typeof thermalShift>): Box[] => (scene.fits ?? []).flatMap((f) => {
    const m = f.marker;
    if (!m) return [];
    const px = 20;
    const w = Math.max(measure(m.label, px), m.delta ? measure(m.delta.text, px) : 0);
    const x = m.labelX + (m.labelOffset?.dx ?? 0);
    const y = m.labelY + (m.labelOffset?.dy ?? 0);
    return [{ x1: m.labelAnchor === "end" ? x - w : x, y1: y - px * 0.8, x2: m.labelAnchor === "end" ? x : x + w, y2: y + (m.delta?.dy ?? 0) + px * 0.25 }];
  });
  const hit = (a: Box, b: Box) => a.x1 < b.x2 && b.x1 < a.x2 && a.y1 < b.y2 && b.y1 < a.y2;

  it("every Tm label, ΔTm line included, finds a clear spot and no two overlap", () => {
    const scene = thermalShift();
    expect(scene.warnings.filter((w) => w.includes("no clear spot")), "a Tm label had no clear spot").toEqual([]);
    const blocks = labelBlocks(scene);
    expect(blocks.length).toBe(3);
    for (let a = 0; a < blocks.length; a++) for (let b = a + 1; b < blocks.length; b++) expect(hit(blocks[a]!, blocks[b]!), `Tm labels ${a} and ${b} overlap`).toBe(false);
    // …and no label lies on a data point.
    const dots = scene.series.flatMap((s) => s.marks.map((mk) => ({ x1: mk.cx - 2, y1: mk.cy - 2, x2: mk.cx + 2, y2: mk.cy + 2 })));
    for (const [k, bl] of blocks.entries()) expect(dots.filter((d) => hit(bl, d)).length, `Tm label ${k} lies on data points`).toBe(0);
    const ms = (scene.fits ?? []).map((f) => f.marker!);
    expect(ms.map((m) => m.delta?.text)).toEqual([undefined, "ΔTm +4.8 °C", "ΔTm +9.3 °C"]);
  });

  it("the ΔTm line sits one line below its Tm, and both are drawn", () => {
    const scene = thermalShift();
    const m = scene.fits![1]!.marker!;
    expect(m.delta!.dy).toBeGreaterThan(0);
    const { container } = render(<PlotFigure scene={scene} zoom={1} />);
    const texts = [...container.querySelectorAll("text")];
    const tm = texts.find((t) => t.textContent === "Tm = 56.9 °C");
    const dtm = texts.find((t) => t.textContent === "ΔTm +4.8 °C");
    expect(tm, "the Tm line is not drawn").toBeTruthy();
    expect(dtm, "the ΔTm line is not drawn").toBeTruthy();
    expect(Number(dtm!.getAttribute("y")) - Number(tm!.getAttribute("y"))).toBeCloseTo(m.delta!.dy, 6);
  });
});

describe("deltaTmPlots — the graphs a ΔTm setting reaches", () => {
  it("the graphs drawing this analysis's ΔTm markers; none without a control", () => {
    const withCtrl = melted(true);
    expect(deltaTmPlots(withCtrl.doc.toJSON(), withCtrl.a.id).map((q) => q.id)).toEqual([withCtrl.p.id]);
    expect(deltaTmPlots(withCtrl.doc.toJSON(), "an_other")).toEqual([]);
    const noCtrl = melted(false);
    expect(deltaTmPlots(noCtrl.doc.toJSON(), noCtrl.a.id)).toEqual([]);
  });
});

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

describe("the Tm marker's panel in the Inspector", () => {
  const panelFor = (control: boolean, over: Partial<Plot> = {}) => {
    const { doc } = melted(control);
    const j = doc.toJSON();
    const patches: Partial<Plot>[] = [];
    const u = render(
      <Inspector activeSection="graphs" selection={{ kind: "refline", id: "fit-marker" }} plot={{ ...j.plots[0]!, ...over }} table={j.tables[0]!}
        userPresets={[]} profileDefault={null} {...handlers((q) => patches.push(q))} />,
    );
    return { container: u.container, patches, doc };
  };
  const box = (c: HTMLElement) => c.querySelector<HTMLInputElement>('input[aria-label="Show ΔTm after each Tm"]');

  it("offers the tick-box, ticked, when the markers carry a ΔTm; unticking writes what the builder reads", () => {
    const { container, patches, doc } = panelFor(true);
    expect(box(container), "no ΔTm tick-box on the marker's panel").not.toBeNull();
    expect(box(container)!.checked).toBe(true);
    fireEvent.click(box(container)!);
    expect(patches.at(-1)).toEqual({ fitStyle: { markerDelta: false } });
    expect(labelsDrawn(doc, patches.at(-1))).toEqual([["Tm = 52.0 °C", undefined], ["Tm = 56.0 °C", undefined], ["Tm = 60.0 °C", undefined]]);
  });

  it("reflects the setting when it is off, and is absent when there is no ΔTm to show", () => {
    expect(box(panelFor(true, { fitStyle: { markerDelta: false } }).container)!.checked).toBe(false);
    cleanup();
    expect(box(panelFor(false).container)).toBeNull();
  });
});

describe("the analysis sheet", () => {
  const tm: Analysis = {
    id: "an_tm", name: "Melting temperature (Tm)", method: "meltingtemp", source: "t", params: { columns: ["a", "b"] }, status: "ok",
    result: { method: "meltingtemp", title: "Melting temperature (Tm)", terms: [{ term: "ΔTm vs Apo — Ligand A", estimate: 4 }], glance: {}, summary: "", assumptions: [], cite: "" },
  };
  const project = (): Project => ({ schemaVersion: 4, tables: [], plots: [], analyses: [tm], log: [], workspace: { folders: [], loose: [] } });
  const sheet = (binding: { on: boolean; toggle: (on: boolean) => void } | undefined) =>
    render(<AnalysisPane project={project()} analysisId={tm.id} onRerun={vi.fn()} deltaTmBinding={binding} />);
  const box = (c: HTMLElement) => c.querySelector<HTMLInputElement>('input[aria-label="ΔTm on the graph"]');

  it("shows the tick-box with the graph's state, and ticking / unticking asks for it", () => {
    const toggle = vi.fn();
    const on = sheet({ on: true, toggle });
    expect(box(on.container), "no ΔTm tick-box on the analysis sheet").not.toBeNull();
    expect(box(on.container)!.checked).toBe(true);
    fireEvent.click(box(on.container)!);
    expect(toggle).toHaveBeenCalledWith(false);
    cleanup();
    const toggle2 = vi.fn();
    const off = sheet({ on: false, toggle: toggle2 });
    fireEvent.click(box(off.container)!);
    expect(toggle2).toHaveBeenCalledWith(true);
  });

  it("is absent when no graph draws this analysis's ΔTm", () => {
    expect(box(sheet(undefined).container)).toBeNull();
  });
});
