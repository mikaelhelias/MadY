// @vitest-environment jsdom
/**
 * Lines in the legend.
 * A line the user drew (hline / vline / segment / arrow) or the fitted curves can be listed as a legend
 * row: "Show in legend", or drop the line's caption onto the legend block (it catches within reach and lights up);
 * drag a listed row out of the block to take it back out.
 *
 * Each half is checked where it can be wrong: the scene (the row keys the line exactly; the caption leaves the plot
 * only when the row is really drawn), the document (the caption's own drag), the drawing (dashed key, click, drag in,
 * drag out) and the Inspector (the tick boxes).
 */
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { createSampleDocument, MadyDocument, type Annotation, type DataTable, type Plot } from "@mady/core";
import { buildPlotScene, type PlotScene } from "@mady/graphics";
import { PlotFigure } from "./PlotFigure";
import { Inspector } from "./Inspector";
import { galleryItems, galleryLookup } from "./gallery";
import { captionCentre, keyDash, legendDropBox, nearBox, LEGEND_DOCK_REACH } from "./legendDock";

afterEach(cleanup);
Element.prototype.scrollIntoView = Element.prototype.scrollIntoView ?? (() => {});

const SIZE = { width: 640, height: 460 };
const card = (title: string) => {
  const g = galleryItems().find((x) => x.title === title);
  if (!g) throw new Error(`no gallery card "${title}"`);
  return { table: g.table as DataTable, plot: g.plot as Plot, lk: galleryLookup(g) };
};
const BAR = "Bar / column (+ error bars)"; // two series, legend on the right
const XY = "XY (points + fitted curve)";
const sceneOf = (c: ReturnType<typeof card>, plot: Plot): PlotScene => buildPlotScene(c.table, plot, { ...SIZE, tables: c.lk });
const withAnn = (p: Plot, a: Partial<Annotation> & { kind: Annotation["kind"] }): Plot =>
  ({ ...p, annotations: [...(p.annotations ?? []), { id: "ln1", ...a } as Annotation] }) as Plot;
const HLINE = { kind: "hline" as const, value: 20, label: "Threshold", color: "#cc0000", width: 2, dash: "dashed" as const };
const lineRow = (s: PlotScene) => s.legend.find((e) => e.select?.as === "annotation");
const annOf = (s: PlotScene, id = "ln1") => s.annotations.find((a) => a.id === id);

describe("the scene: a listed line is a legend row keyed by the line itself", () => {
  it("the row carries the line's colour, dash and width; the caption leaves the plot", () => {
    const c = card(BAR);
    const off = sceneOf(c, withAnn(c.plot, HLINE));
    expect(lineRow(off), "a line not listed has no row").toBeUndefined();
    expect(annOf(off)?.label, "…and keeps its caption").toBe("Threshold");

    const on = sceneOf(c, withAnn(c.plot, { ...HLINE, inLegend: true }));
    const row = lineRow(on)!;
    expect(row).toMatchObject({ label: "Threshold", color: "#cc0000", marker: false, lineWidth: 2, select: { as: "annotation", id: "ln1" } });
    // The key's dash IS the drawn line's dash.
    expect(row.dash).toBeTruthy();
    expect(row.dash).toBe(annOf(on)!.dash);
    expect(annOf(on)?.label, "the row replaces the caption").toBeUndefined();
    expect(on.legend.filter((e) => e.select?.as === "series").length).toBe(off.legend.length);
  });

  it("a chart that draws no legend shows one once a line is listed (else the tick box would do nothing)", () => {
    const c = card("Box & whisker");
    const mid = ((d) => (d[0] + d[1]) / 2)(sceneOf(c, c.plot).y.domain);
    const off = sceneOf(c, withAnn(c.plot, { ...HLINE, value: mid }));
    expect(off.legend.length, "the card already draws a legend — this proves nothing").toBe(0);
    const on = sceneOf(c, withAnn(c.plot, { ...HLINE, value: mid, inLegend: true }));
    expect(on.legend.map((e) => e.label)).toEqual(["Threshold"]);
    expect(annOf(on)?.label).toBeUndefined();
    // "Hide legend" still wins, and the caption stays.
    const hidden = sceneOf(c, { ...withAnn(c.plot, { ...HLINE, value: mid, inLegend: true }), legend: { show: false } } as Plot);
    expect(hidden.legend).toEqual([]);
    expect(annOf(hidden)?.label).toBe("Threshold");
  });

  it("no legend block (hidden, or labels beside the lines): no row, and the caption stays", () => {
    const c = card(BAR);
    for (const legend of [{ show: false }, { position: "direct" as const }, { position: "none" as const }]) {
      const s = sceneOf(c, { ...withAnn(c.plot, { ...HLINE, inLegend: true }), legend } as Plot);
      expect(lineRow(s), JSON.stringify(legend)).toBeUndefined();
      expect(annOf(s)?.label, JSON.stringify(legend)).toBe("Threshold");
    }
  });

  it("a line that is not drawn (off the axis) lists nothing", () => {
    const c = card(BAR);
    const s = sceneOf(c, withAnn(c.plot, { ...HLINE, value: 1e9, inLegend: true }));
    expect(annOf(s)).toBeUndefined();
    expect(lineRow(s)).toBeUndefined();
  });

  it("a segment / arrow keys solid unless dashed, and is named by its kind when it has no caption", () => {
    const c = card(BAR);
    const s = sceneOf(c, withAnn(c.plot, { kind: "arrow", x: 0.2, y: 0.2, x2: 0.5, y2: 0.4, inLegend: true }));
    expect(lineRow(s)).toMatchObject({ label: "Arrow", marker: false, lineWidth: 1.5 });
    expect(lineRow(s)!.dash).toBeUndefined();
    const d = sceneOf(c, withAnn(c.plot, { kind: "segment", x: 0.2, y: 0.2, x2: 0.5, y2: 0.4, dash: "dotted", label: "Cut-off", inLegend: true }));
    expect(lineRow(d)).toMatchObject({ label: "Cut-off" });
    expect(lineRow(d)!.dash).toBe(annOf(d)!.dash);
  });

  it("the fitted curve: listed as itself — colour, width and dash of the drawn curve", () => {
    const c = card(XY);
    expect(sceneOf(c, c.plot).legend.some((e) => e.select?.as === "fit")).toBe(false);
    const plot = { ...c.plot, fitStyle: { inLegend: true, dash: "dashed", width: 3 } } as Plot;
    const s = sceneOf(c, plot);
    const drawn = s.fit ?? s.fits?.[0];
    expect(drawn, "the card draws no fitted curve — this proves nothing").toBeDefined();
    const row = s.legend.find((e) => e.select?.as === "fit")!;
    expect(row).toMatchObject({ color: drawn!.color, lineWidth: drawn!.width, dash: drawn!.dash, marker: false });
    expect(row.label).toBe(drawn!.label);
    // Listed on its own, the curve is no longer also drawn into the points-only series' key (it would be keyed twice).
    const series = (sc: PlotScene) => sc.legend.filter((e) => e.select?.as === "series");
    expect(series(sceneOf(c, c.plot)).some((e) => e.line !== false), "no series borrows its curve's line — this proves nothing").toBe(true);
    expect(series(s).every((e) => e.line === false)).toBe(true);
    // A hidden curve lists nothing.
    expect(sceneOf(c, { ...plot, fitStyle: { ...plot.fitStyle, show: false } } as Plot).legend.some((e) => e.select?.as === "fit")).toBe(false);
  });

  it("a caption moved on its own is drawn moved; an untouched one carries no offset (saved graphs unchanged)", () => {
    const c = card(BAR);
    expect(annOf(sceneOf(c, withAnn(c.plot, HLINE)))?.labelOffset).toBeUndefined();
    expect(annOf(sceneOf(c, withAnn(c.plot, { ...HLINE, labelOffset: { dx: 12, dy: -30 } })))?.labelOffset).toEqual({ dx: 12, dy: -30 });
  });
});

describe("the document: a drawn line's caption moves on its own", () => {
  const doc = () => {
    const c = card(BAR);
    const d = new MadyDocument({ ...createSampleDocument().toJSON(), tables: [c.table], plots: [withAnn(c.plot, HLINE)], analyses: [] });
    return { d, id: d.toJSON().plots[0]!.id };
  };
  const ann = (d: MadyDocument) => d.toJSON().plots[0]!.annotations!.find((a) => a.id === "ln1")!;

  it("stores the offset on the annotation, undoably; back home clears it", () => {
    const { d, id } = doc();
    d.moveRefLineLabel(id, "ln1", 15, -8);
    expect(ann(d).labelOffset).toEqual({ dx: 15, dy: -8 });
    expect(ann(d).value, "the line itself does not move").toBe(20);
    d.commands.undo();
    expect(ann(d).labelOffset).toBeUndefined();
    d.commands.redo();
    expect(ann(d).labelOffset).toEqual({ dx: 15, dy: -8 });
    d.moveRefLineLabel(id, "ln1", 0, 0);
    expect(ann(d).labelOffset).toBeUndefined();
  });

  it("a line the builder owns still moves its caption through its own record", () => {
    const { d, id } = doc();
    d.moveRefLineLabel(id, "fit-marker", 4, 5);
    expect(d.toJSON().plots[0]!.refLineLabelOffsets?.["fit-marker"]).toEqual({ dx: 4, dy: 5 });
  });
});

describe("the helpers", () => {
  it("reads the legend block off the drawing, drag offset included", () => {
    const host = document.createElement("div");
    host.innerHTML = `<svg><g class="gfx-legend" transform="translate(10 -4)"><rect data-legend-box="1" x="100" y="50" width="80" height="40"/></g></svg>`;
    expect(legendDropBox(host.querySelector("svg"))).toEqual({ x: 110, y: 46, w: 80, h: 40 });
    host.innerHTML = `<svg></svg>`;
    expect(legendDropBox(host.querySelector("svg"))).toBeNull();
  });

  it("the reach is a margin round the box", () => {
    const b = { x: 100, y: 100, w: 50, h: 20 };
    expect(nearBox(b, 125, 110, 24)).toBe(true);
    expect(nearBox(b, 100 - 24, 110, 24)).toBe(true);
    expect(nearBox(b, 100 - 25, 110, 24)).toBe(false);
    expect(nearBox(null, 125, 110, 24)).toBe(false);
  });

  it("a key's dash is shrunk in proportion until 2½ repeats fit — never stretched", () => {
    expect(keyDash("9,6", 15)).toBe("3.6 2.4"); // 15 / (2.5 × 15) = 0.4
    expect(keyDash("1.5 3", 20)).toBe("1.5 3"); // 20 px already holds 4 repeats: as drawn
    expect(keyDash("6", 12)).toBe("2.4"); // odd length: 6 on, 6 off — a 12 px period; 2.4 on/off = 2½ in 12 px
    expect(keyDash("", 12)).toBe("");
  });

  it("a caption's middle follows its text anchor and the drag", () => {
    const a = { labelX: 200, labelY: 100, label: "abcd" }; // 4 × 10 × 0.55 = 22 wide
    expect(captionCentre({ ...a, labelAnchor: "end" }, 10, 0, 0)).toEqual({ x: 189, y: 96.5 });
    expect(captionCentre({ ...a, labelAnchor: "start" }, 10, 5, 5)).toEqual({ x: 216, y: 101.5 });
    expect(captionCentre({ ...a, labelAnchor: "middle" }, 10, 0, 0).x).toBe(200);
  });
});

describe("the drawing: dashed key, click, drag in, drag out", () => {
  const draw = (plot: Plot, extra: Partial<ComponentProps<typeof PlotFigure>> = {}) => {
    const c = card(BAR);
    const scene = sceneOf(c, plot);
    const set = vi.fn();
    const onSelect = vi.fn();
    const onMoveRefLineLabel = vi.fn();
    const r = render(
      <PlotFigure scene={scene} selected={null} onSelect={onSelect} onMoveRefLineLabel={onMoveRefLineLabel}
        legendDock={{ lines: new Set((plot.annotations ?? []).map((a) => a.id)), set }} {...extra} />,
    );
    return { ...r, scene, set, onSelect, onMoveRefLineLabel };
  };
  const c = card(BAR);

  it("the listed line's key is a dashed line at the line's own width, with no dot", () => {
    const { container, scene } = draw(withAnn(c.plot, { ...HLINE, inLegend: true }));
    const row = container.querySelector('[data-legend-line="ln1"]')!;
    expect(row, "no row drawn for the listed line").not.toBeNull();
    const stub = row.querySelector("line")!;
    // The key's dash is the LINE's pattern, in proportion, short enough that it reads as dashed in the stub.
    const nums = (s: string | null | undefined) => (s ?? "").split(/[\s,]+/).map(Number).filter(Number.isFinite);
    const line = nums(lineRow(scene)!.dash);
    const key = nums(stub.getAttribute("stroke-dasharray"));
    expect(key.length).toBe(line.length);
    key.forEach((k, j) => expect(k / key[0]!).toBeCloseTo(line[j]! / line[0]!, 1));
    const stubLen = Number(stub.getAttribute("x2")) - Number(stub.getAttribute("x1"));
    expect(stubLen / key.reduce((a, b) => a + b, 0), "fewer than 2½ dashes fit in the key").toBeGreaterThanOrEqual(2.49);
    expect(stub.getAttribute("stroke")).toBe("#cc0000");
    expect(Number(stub.getAttribute("stroke-width"))).toBeCloseTo(2 * (scene.fonts.legend.size / 13), 5);
    expect(row.querySelector("circle, path, polygon, rect:not([fill=transparent])"), "a line key draws no dot").toBeNull();
    // …and its caption is gone from the plot.
    expect(container.querySelector('[data-ann-text="ln1"]')).toBeNull();
  });

  it("clicking the row opens the line's own panel", () => {
    const { container, onSelect } = draw(withAnn(c.plot, { ...HLINE, inLegend: true }));
    fireEvent.click(container.querySelector('[data-legend-line="ln1"]')!);
    expect(onSelect).toHaveBeenLastCalledWith({ kind: "annotation", id: "ln1" });
  });

  it("dragging the row out of the block takes the line out; a drag inside it does not", () => {
    const r = draw(withAnn(c.plot, { ...HLINE, inLegend: true }));
    const row = r.container.querySelector('[data-legend-line="ln1"]')!;
    fireEvent.pointerDown(row, { clientX: 0, clientY: 0, pointerId: 1 });
    fireEvent.pointerMove(window, { clientX: 5, clientY: 2, pointerId: 1 });
    fireEvent.pointerUp(window, { clientX: 5, clientY: 2, pointerId: 1 });
    expect(r.set).not.toHaveBeenCalled();
    fireEvent.pointerDown(row, { clientX: 0, clientY: 0, pointerId: 1 });
    fireEvent.pointerMove(window, { clientX: -300, clientY: 120, pointerId: 1 });
    fireEvent.pointerUp(window, { clientX: -300, clientY: 120, pointerId: 1 });
    expect(r.set).toHaveBeenCalledWith({ kind: "annotation", id: "ln1" }, false);
  });

  it("the magnet: a caption held near the legend lights it up, and letting go there lists the line", () => {
    const r = draw(withAnn(c.plot, HLINE));
    const text = r.container.querySelector('[data-ann-text="ln1"]')!;
    const grip = text.closest("g")!; // the caption's own drag group
    const a = annOf(r.scene)!;
    const box = legendDropBox(r.container.querySelector("svg"))!;
    expect(box, "the card draws no legend block").not.toBeNull();
    const from = captionCentre(a, a.fontSize ?? r.scene.fonts.legend.size, 0, 0);
    const to = { x: box.x + box.w / 2, y: box.y + box.h + LEGEND_DOCK_REACH / 2 }; // just under the block: within reach
    expect(nearBox(box, from.x, from.y, LEGEND_DOCK_REACH), "the caption starts inside the reach — this proves nothing").toBe(false);
    fireEvent.pointerDown(grip, { clientX: 0, clientY: 0, pointerId: 1 });
    fireEvent.pointerMove(grip, { clientX: to.x - from.x, clientY: to.y - from.y, pointerId: 1 });
    expect(r.container.querySelector("[data-legend-dock]"), "the block did not light up").not.toBeNull();
    fireEvent.pointerUp(grip, { clientX: to.x - from.x, clientY: to.y - from.y, pointerId: 1 });
    expect(r.set).toHaveBeenCalledWith({ kind: "annotation", id: "ln1" }, true);
    expect(r.onMoveRefLineLabel, "a dock is not also a move").not.toHaveBeenCalled();
    expect(r.container.querySelector("[data-legend-dock]")).toBeNull();
  });

  it("…and let go anywhere else, the caption simply moves there", () => {
    const r = draw(withAnn(c.plot, HLINE));
    const grip = r.container.querySelector('[data-ann-text="ln1"]')!.closest("g")!;
    fireEvent.pointerDown(grip, { clientX: 0, clientY: 0, pointerId: 1 });
    fireEvent.pointerMove(grip, { clientX: -40, clientY: 30, pointerId: 1 });
    fireEvent.pointerUp(grip, { clientX: -40, clientY: 30, pointerId: 1 });
    expect(r.set).not.toHaveBeenCalled();
    expect(r.onMoveRefLineLabel).toHaveBeenCalledWith("ln1", -40, 30);
  });

  it("a segment's caption drags and docks the same way", () => {
    const r = draw(withAnn(c.plot, { kind: "segment", x: 0.1, y: 0.8, x2: 0.3, y2: 0.8, label: "Cut-off" }));
    const text = [...r.container.querySelectorAll("svg text")].find((t) => t.textContent === "Cut-off")!;
    const grip = text.closest("g")!;
    const a = annOf(r.scene)!;
    const box = legendDropBox(r.container.querySelector("svg"))!;
    const from = captionCentre(a, a.fontSize ?? r.scene.fonts.legend.size, 0, 0);
    const to = { x: box.x + box.w / 2, y: box.y + box.h / 2 };
    fireEvent.pointerDown(grip, { clientX: 0, clientY: 0, pointerId: 1 });
    fireEvent.pointerMove(grip, { clientX: to.x - from.x, clientY: to.y - from.y, pointerId: 1 });
    fireEvent.pointerUp(grip, { clientX: to.x - from.x, clientY: to.y - from.y, pointerId: 1 });
    expect(r.set).toHaveBeenCalledWith({ kind: "annotation", id: "ln1" }, true);
  });

  it("a read-only drawing offers no drag (an export, a thumbnail) but still draws a moved caption where it was moved", () => {
    const scene = sceneOf(c, withAnn(c.plot, { ...HLINE, labelOffset: { dx: 9, dy: -7 } }));
    const { container } = render(<PlotFigure scene={scene} selected={null} />);
    const g = container.querySelector('[data-ann-text="ln1"]')!.parentElement!;
    expect(g.getAttribute("transform")).toBe("translate(9 -7)");
  });
});

describe("the Inspector: the tick boxes", () => {
  const inspector = (plot: Plot, selection: object, extra: Record<string, unknown> = {}) => {
    const update = vi.fn();
    const onSetPlotOptions = vi.fn();
    const ops = { add: vi.fn(), update, remove: vi.fn(), reorder: vi.fn(), align: vi.fn(), group: vi.fn(), ungroup: vi.fn(), setLocked: vi.fn(), addImage: vi.fn(), replaceImage: vi.fn() };
    const r = render(
      <Inspector {...({} as ComponentProps<typeof Inspector>)} activeSection="graphs" selection={selection as never} plot={plot} table={card(BAR).table}
        userPresets={[]} profileDefault={null} wholeGraph={false} onSetWholeGraph={() => {}} onSelect={vi.fn()} annotationOps={ops as never}
        onSetPlotOptions={onSetPlotOptions} {...extra} />,
    );
    const box = (label: string) => r.container.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`);
    return { ...r, update, onSetPlotOptions, box };
  };
  const c = card(BAR);

  it.each([
    ["a horizontal line", HLINE],
    ["a segment", { kind: "segment" as const, x: 0.1, y: 0.1, x2: 0.4, y2: 0.4, label: "Cut-off" }],
    ["an arrow", { kind: "arrow" as const, x: 0.1, y: 0.1, x2: 0.4, y2: 0.4 }],
  ])("%s: 'Show in legend' lists it (and sends its caption home); unticking takes it out", (_n, a) => {
    const on = inspector(withAnn(c.plot, a), { kind: "annotation", id: "ln1" });
    fireEvent.click(on.box("Show this line in the legend")!);
    expect(on.update).toHaveBeenCalledWith("ln1", { inLegend: true, labelOffset: undefined });
    cleanup();
    const off = inspector(withAnn(c.plot, { ...a, inLegend: true }), { kind: "annotation", id: "ln1" });
    expect(off.box("Show this line in the legend")!.checked).toBe(true);
    fireEvent.click(off.box("Show this line in the legend")!);
    expect(off.update).toHaveBeenCalledWith("ln1", { inLegend: undefined });
  });

  it("a box or a band has no such row (it is not a line)", () => {
    const r = inspector(withAnn(c.plot, { kind: "rect", x: 0.1, y: 0.1, w: 0.2, h: 0.2 }), { kind: "annotation", id: "ln1" });
    expect(r.box("Show this line in the legend")).toBeNull();
  });

  it("says why when the graph draws no legend block", () => {
    const r = inspector({ ...withAnn(c.plot, { ...HLINE, inLegend: true }), legend: { position: "direct" } } as Plot, { kind: "annotation", id: "ln1" });
    expect(r.container.textContent).toContain("keeps its label on the graph");
  });

  it("the fitted curve's panel: 'Show in legend' writes fitStyle.inLegend, and is withheld while the curve is hidden", () => {
    const xy = card(XY);
    const r = inspector(xy.plot, { kind: "chart-section", title: "Fitted curve" });
    const box = r.box("Show fitted curve in legend");
    expect(box, "no 'Show in legend' on the fitted-curve panel").not.toBeNull();
    fireEvent.click(box!);
    expect(r.onSetPlotOptions).toHaveBeenCalledWith({ fitStyle: expect.objectContaining({ inLegend: true }) });
    cleanup();
    const hidden = inspector({ ...xy.plot, fitStyle: { show: false } } as Plot, { kind: "chart-section", title: "Fitted curve" });
    expect(hidden.box("Show fitted curve in legend")).toBeNull();
  });
});
