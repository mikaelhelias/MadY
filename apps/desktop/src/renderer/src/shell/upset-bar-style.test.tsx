// @vitest-environment jsdom
/**
 * UpSet intersection bars can be styled from the UpSet section.
 *
 * The bar builder draws an UpSet's intersection bars and honours their shape, width, fill type,
 * opacity, outline, a single highlighted bar, the count's position and bracket legs that reach
 * the bars — and a click on a bar opens the UpSet section, so that section must offer more than
 * "Bar colour". Each row below is pressed in the real panel, what it sends is applied
 * to the plot the way the document applies it, and the scene is rebuilt to read it back.
 */
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import type { Annotation, BarShape, Plot, SeriesStyle } from "@mady/core";
import { buildPlotScene } from "@mady/graphics";
import { Inspector } from "./Inspector";
import { galleryItems } from "./gallery";

afterEach(cleanup);

const item = () => galleryItems().find((i) => i.plot.kind === "upset")!;
const COUNT = "__upsetn__";

/** Render the UpSet section, and apply every patch it emits to a live copy of the plot. */
function drive(start: Plot) {
  let plot = start;
  const noop = vi.fn();
  const onSetPlotOptions = (patch: Partial<Plot>) => { plot = { ...plot, ...patch }; };
  const onSetBarShape = (shape: BarShape) => { plot = { ...plot, barShape: shape }; };
  const onSetSeriesStyle = (id: string, delta: SeriesStyle) => { plot = { ...plot, seriesStyles: { ...(plot.seriesStyles ?? {}), [id]: { ...(plot.seriesStyles?.[id] ?? {}), ...delta } } }; };
  const onSetPointStyle = (id: string, rowId: string, delta: SeriesStyle) => {
    const key = `${id}:${rowId}`;
    const merged: Record<string, unknown> = { ...(plot.pointStyles?.[key] ?? {}), ...delta };
    for (const k of Object.keys(merged)) if (merged[k] === undefined) delete merged[k];
    const map = { ...(plot.pointStyles ?? {}) };
    if (Object.keys(merged).length) map[key] = merged as SeriesStyle; else delete map[key];
    plot = { ...plot, pointStyles: map };
  };
  const view = () => {
    cleanup();
    return render(
      <Inspector {...({} as ComponentProps<typeof Inspector>)} onSetPlotOptions={onSetPlotOptions} onSetBarShape={onSetBarShape} onSetSeriesStyle={onSetSeriesStyle} onSetPointStyle={onSetPointStyle}
        activeSection="graphs" selection={{ kind: "plot" }} plot={plot} table={item().table} userPresets={[]} profileDefault={null} wholeGraph={false} onSetWholeGraph={noop}
        annotationOps={{ add: noop, update: noop, remove: noop, reorder: noop, align: noop, group: noop, ungroup: noop, setLocked: noop, addImage: noop, replaceImage: noop }} />,
    ).container;
  };
  const control = (c: HTMLElement, label: string) => [...c.querySelectorAll(".frow > span")].find((s) => s.textContent === label)?.parentElement?.querySelector("input, select") as HTMLInputElement | HTMLSelectElement | undefined;
  return { view, control, get plot() { return plot; } };
}

const bars = (plot: Plot) => buildPlotScene(item().table, plot, { width: 640, height: 480 }).series.find((s) => s.id === COUNT)!;
/** The bars AND the scene-level bar settings (shape rides the scene, not the series). */
const barsJSON = (plot: Plot) => {
  const sc = buildPlotScene(item().table, plot, { width: 640, height: 480 });
  return JSON.stringify([sc.series.find((s) => s.id === COUNT), (sc as { barShape?: unknown }).barShape]);
};

describe("UpSet intersection bars — styled from the UpSet section", () => {
  it("shape, width, fill, opacity and outline each reach the bars", () => {
    const d = drive(item().plot);
    const steps: [string, (el: HTMLInputElement | HTMLSelectElement) => void][] = [
      ["Bar shape", (el) => fireEvent.change(el, { target: { value: "rounded" } })],
      ["Bar width", (el) => fireEvent.change(el, { target: { value: "0.4" } })],
      ["Bar opacity", (el) => fireEvent.change(el, { target: { value: "0.4" } })],
      ["Outline width", (el) => fireEvent.change(el, { target: { value: "3" } })],
      ["Outline colour", (el) => fireEvent.change(el, { target: { value: "#ff0000" } })],
      // Last: two-tone derives the outline, so the Outline colour row leaves (checked below).
      ["Bar fill", (el) => fireEvent.change(el, { target: { value: "twotone" } })],
    ];
    for (const [label, press] of steps) {
      const before = barsJSON(d.plot);
      const el = d.control(d.view(), label);
      expect(el, `no "${label}" row in the UpSet section`).toBeTruthy();
      press(el!);
      expect(barsJSON(d.plot), `"${label}" did not reach the intersection bars`).not.toBe(before);
    }
    // Two-tone: the outline is derived from the bar colour, so its colour row is not offered.
    expect(d.control(d.view(), "Outline colour")).toBeUndefined();
  });

  it("one highlighted bar changes that bar only, can move, and can be removed", () => {
    const d = drive(item().plot);
    const base = bars(d.plot);
    expect(base.marks.length, "the gallery UpSet has fewer than two bars — cannot exhibit 'that bar only'").toBeGreaterThan(1);
    const pick = d.control(d.view(), "Highlight bar")!;
    expect([...(pick as HTMLSelectElement).options].length).toBe(base.marks.length + 1);
    fireEvent.change(pick, { target: { value: "ix-1" } });
    let now = bars(d.plot);
    expect(JSON.stringify(now.marks[1])).not.toBe(JSON.stringify(base.marks[1]));
    expect(JSON.stringify(now.marks[0])).toBe(JSON.stringify(base.marks[0]));
    fireEvent.change(d.control(d.view(), "Highlight opacity")!, { target: { value: "0.3" } });
    expect(bars(d.plot).marks[1]!.fillOpacity).toBe(0.3);
    // Move it: bar 2 returns to its plain look, bar 1 takes the highlight with its settings.
    fireEvent.change(d.control(d.view(), "Highlight bar")!, { target: { value: "ix-0" } });
    now = bars(d.plot);
    expect(JSON.stringify(now.marks[1])).toBe(JSON.stringify(base.marks[1]));
    expect(now.marks[0]!.fillOpacity).toBe(0.3);
    // Remove it.
    fireEvent.change(d.control(d.view(), "Highlight bar")!, { target: { value: "" } });
    expect(JSON.stringify(bars(d.plot))).toBe(JSON.stringify(base));
  });

  it("removing a highlight keeps a count label's own drag on that bar", () => {
    const start = { ...item().plot, showValues: true, pointStyles: { [`${COUNT}:ix-0`]: { valueDy: -12 } } } as Plot;
    const d = drive(start);
    fireEvent.change(d.control(d.view(), "Highlight bar")!, { target: { value: "ix-0" } });
    fireEvent.change(d.control(d.view(), "Highlight bar")!, { target: { value: "" } });
    expect(d.plot.pointStyles?.[`${COUNT}:ix-0`]).toEqual({ valueDy: -12 });
  });

  it("Count position is offered with the counts on, and reaches them", () => {
    const d = drive({ ...item().plot, showValues: true });
    const el = d.control(d.view(), "Count position");
    expect(el).toBeTruthy();
    const before = barsJSON(d.plot);
    fireEvent.change(el!, { target: { value: "insideEnd" } });
    expect(barsJSON(d.plot)).not.toBe(before);
    const off = drive({ ...item().plot, showValues: false });
    expect(off.control(off.view(), "Count position")).toBeUndefined();
  });

  it("a bracket on an UpSet offers Legs, and Reach the bars draws (no refusal)", () => {
    const br: Annotation = { id: "ub", kind: "bracket", from: 1, to: 4, p: 0.01, role: "significance" } as Annotation;
    const plot = { ...item().plot, annotations: [br] } as Plot;
    const noop = vi.fn();
    const { container } = render(
      <Inspector {...({} as ComponentProps<typeof Inspector>)} onSetSignificance={noop} activeSection="graphs" selection={{ kind: "annotation", id: "ub" }} plot={plot} table={item().table} userPresets={[]} profileDefault={null} wholeGraph={false} onSetWholeGraph={noop}
        annotationOps={{ add: noop, update: noop, remove: noop, reorder: noop, align: noop, group: noop, ungroup: noop, setLocked: noop, addImage: noop, replaceImage: noop }} />,
    );
    expect(container.querySelector('select[aria-label="Bracket legs"]'), "no Legs on an UpSet bracket").not.toBeNull();
    const equal = buildPlotScene(item().table, plot, { width: 640, height: 480 });
    const reach = buildPlotScene(item().table, { ...plot, significance: { legs: "reach" } } as Plot, { width: 640, height: 480 });
    expect(reach.warnings.some((w) => /Bracket legs that reach/.test(w))).toBe(false);
    const path = (s: typeof equal) => s.annotations.find((a) => a.id === "ub")?.path;
    expect(path(equal)).toBeTruthy();
    expect(path(reach)).not.toBe(path(equal));
  });
});
