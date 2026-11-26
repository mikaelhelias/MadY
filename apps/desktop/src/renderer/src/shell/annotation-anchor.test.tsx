// @vitest-environment jsdom
// Pin to a data value — the editing half. The builder places a pinned point from its
// values (packages/graphics/src/annotation-anchor.test.ts), so every way of moving it must write values back, or a
// drag of a pinned text would change nothing on screen. And the Inspector's "Pin to" row must be offered exactly where
// that works: offered ⇒ a drag writes values; hidden ⇒ the builder really refuses the pin. Checked on every gallery
// chart, in both directions, since a one-directional check cannot detect a control hidden where it works.
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import type { Annotation, DataTable, Plot } from "@mady/core";
import { MadyDocument } from "@mady/core";
import { buildPlotScene } from "@mady/graphics";
import { PlotFigure, toAnchoredPatch } from "./PlotFigure";
import { Inspector, anchorOffer } from "./Inspector";
import { galleryItems } from "./gallery";

afterEach(cleanup);
// `clientToUser` goes through getScreenCTM, which jsdom lacks: an identity stub makes client px = scene px.
beforeAll(() => {
  const identity = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0, inverse() { return identity; } };
  (SVGElement.prototype as unknown as { getScreenCTM: () => unknown }).getScreenCTM = () => identity;
  (globalThis as unknown as { DOMPoint: unknown }).DOMPoint = class {
    constructor(public x: number, public y: number) {}
    matrixTransform(): { x: number; y: number } { return { x: this.x, y: this.y }; }
  };
});

const SIZE = { width: 620, height: 420 };
const card = (kind: string): { plot: Plot; table: DataTable } => {
  const g = galleryItems().find((x) => (x.plot.kind ?? "xy") === kind)!;
  return { plot: g.plot as Plot, table: g.table as DataTable };
};
const withAnn = (plot: Plot, a: Annotation): Plot => ({ ...plot, annotations: [...(plot.annotations ?? []), a] });
const TEXT = { id: "pin", kind: "text", label: "pinned", x: 0.45, y: 0.35 } as Annotation;

describe("toAnchoredPatch", () => {
  it("turns a dragged text's plot fractions into the values the builder draws there (round trip)", () => {
    const { plot, table } = card("xy");
    const s = buildPlotScene(table, withAnn(plot, { ...TEXT, anchorX: 1, anchorY: 1 }), SIZE);
    const a = s.annotations.find((x) => x.id === "pin")!;
    expect(a.anchored).toBe("xy");
    const patch = toAnchoredPatch(a, { x: 0.3, y: 0.6 }, s);
    expect(patch.x).toBe(0.3); // the fraction is kept: back to a plot position never jumps
    const back = buildPlotScene(table, withAnn(plot, { ...TEXT, anchorX: patch.anchorX!, anchorY: patch.anchorY! }), SIZE);
    const b = back.annotations.find((x) => x.id === "pin")!;
    expect(b.labelX).toBeCloseTo(back.plot.x + 0.3 * back.plot.width, 3);
    expect(b.labelY).toBeCloseTo(back.plot.y + 0.6 * back.plot.height, 3);
  });
  it("a callout's pinned point is its TIP (x2/y2); moving only its text writes no value", () => {
    const { plot, table } = card("xy");
    const s = buildPlotScene(table, withAnn(plot, { id: "c", kind: "callout", label: "c", x: 0.1, y: 0.1, anchorY: 1 } as Annotation), SIZE);
    const c = s.annotations.find((x) => x.id === "c")!;
    expect(toAnchoredPatch(c, { x2: 0.5, y2: 0.5 }, s).anchorY).toBeDefined();
    expect(toAnchoredPatch(c, { x: 0.2, y: 0.2 }, s)).toEqual({ x: 0.2, y: 0.2 });
  });
  it("an annotation that is not pinned passes through untouched", () => {
    const { plot, table } = card("xy");
    const s = buildPlotScene(table, withAnn(plot, TEXT), SIZE);
    expect(toAnchoredPatch(s.annotations.find((x) => x.id === "pin")!, { x: 0.3, y: 0.6 }, s)).toEqual({ x: 0.3, y: 0.6 });
  });
});

describe("every gallery chart: the Pin row is offered exactly where pinning works", () => {
  const items = galleryItems();
  it.each(items.map((g) => [g.plot.kind ?? "xy", g] as const))("%s", (_kind, g) => {
    const plot = withAnn(g.plot as Plot, TEXT);
    const table = g.table as DataTable;
    const offer = anchorOffer(TEXT, plot, table);
    if (offer.x === undefined && offer.y === undefined) {
      // Hidden ⇒ the builder refuses: pinning at the axis midpoint resolves nothing.
      const s0 = buildPlotScene(table, plot, SIZE);
      const probe = buildPlotScene(table, withAnn(g.plot as Plot, { ...TEXT, anchorX: s0.x.domain[0], anchorY: s0.y.domain[0] }), SIZE);
      expect(probe.annotations.find((x) => x.id === "pin")?.anchored ?? null, "hidden, yet the builder pins it").toBeNull();
      return;
    }
    // Offered ⇒ a drag of the pinned text writes values for every offered axis.
    const pinned = withAnn(g.plot as Plot, { ...TEXT, ...(offer.x !== undefined ? { anchorX: offer.x } : {}), ...(offer.y !== undefined ? { anchorY: offer.y } : {}) });
    const s = buildPlotScene(table, pinned, SIZE);
    const a = s.annotations.find((x) => x.id === "pin")!;
    const onMove = vi.fn();
    const { container } = render(<PlotFigure scene={s} onMoveAnnotation={onMove} onEditText={() => {}} />);
    const t = container.querySelector('[data-ann-text="pin"]')!;
    fireEvent.pointerDown(t, { clientX: a.labelX!, clientY: a.labelY!, pointerId: 1, button: 0 });
    fireEvent.pointerMove(window, { clientX: a.labelX! + 25, clientY: a.labelY! + 15, pointerId: 1 });
    fireEvent.pointerUp(window, { clientX: a.labelX! + 25, clientY: a.labelY! + 15, pointerId: 1 });
    const patch = onMove.mock.calls.at(-1)?.[1] as Record<string, number> | undefined;
    expect(patch, "the drag reported nothing").toBeDefined();
    if (offer.x !== undefined) expect(patch!.anchorX, "offered X, but a drag writes no X value").toBeDefined();
    if (offer.y !== undefined) expect(patch!.anchorY, "offered Y, but a drag writes no Y value").toBeDefined();
    // …and the right values: rebuilt from the written patch, the pinned text lands on the spot the drag wrote (its plot
    // fraction). Compared with that spot, not the raw pointer: a text drag snaps to nearby guides, so where it lands
    // can sit a few px from the pointer — that is the snap, not the conversion.
    const moved = withAnn(g.plot as Plot, { ...TEXT, ...patch } as Annotation);
    const sb = buildPlotScene(table, moved, SIZE);
    const b = sb.annotations.find((x) => x.id === "pin")!;
    expect(Math.abs(b.labelX! - (sb.plot.x + patch!.x! * sb.plot.width)), "the written values put the text somewhere else (across)").toBeLessThan(0.5);
    expect(Math.abs(b.labelY! - (sb.plot.y + patch!.y! * sb.plot.height)), "the written values put the text somewhere else (down)").toBeLessThan(0.5);
  });
});

describe("the arrow-key nudge of a pinned text writes values too", () => {
  it("xy card", () => {
    const { plot, table } = card("xy");
    const s = buildPlotScene(table, withAnn(plot, { ...TEXT, anchorX: 1, anchorY: 1 }), SIZE);
    const onMove = vi.fn();
    render(<PlotFigure scene={s} onMoveAnnotation={onMove} selected={{ kind: "annotation", id: "pin" } as never} />);
    fireEvent.keyDown(window, { key: "ArrowRight" });
    const patch = onMove.mock.calls.at(-1)?.[1] as Record<string, number> | undefined;
    expect(patch?.anchorX).toBeDefined();
    expect(patch?.anchorY).toBeDefined();
  });
});

describe("the document stores and clears the values", () => {
  it("moveAnnotation carries anchorX / anchorY; updateAnnotation clears them", () => {
    const doc = new MadyDocument();
    const t = doc.importTable("T", "xy", ["X", "Y"], [[1, 2], [3, 4]]);
    const plot = doc.addPlot("G", t.id);
    const a = doc.addAnnotation(plot.id, { kind: "text", label: "p", x: 0.5, y: 0.5, anchorY: 2 });
    doc.moveAnnotation(plot.id, a.id, { x: 0.6, y: 0.4, anchorX: 2.5, anchorY: 3.5 });
    const got = () => doc.toJSON().plots.find((p) => p.id === plot.id)!.annotations!.find((x) => x.id === a.id)!;
    expect(got().anchorX).toBe(2.5);
    expect(got().anchorY).toBe(3.5);
    doc.updateAnnotation(plot.id, a.id, { anchorX: undefined, anchorY: undefined });
    expect(got()).not.toHaveProperty("anchorX");
    expect(got().x).toBe(0.6);
  });
});

describe("the Inspector's Pin row", () => {
  const inspect = (kind: string, a: Annotation) => {
    const { plot, table } = card(kind);
    const patches: Array<Record<string, unknown>> = [];
    const ops = {
      add: vi.fn(), remove: vi.fn(), reorder: vi.fn(), align: vi.fn(), group: vi.fn(), ungroup: vi.fn(),
      setLocked: vi.fn(), addImage: vi.fn(), replaceImage: vi.fn(),
      update: (_id: string, patch: Record<string, unknown>) => patches.push(patch),
    };
    const r = render(
      <Inspector activeSection="graphs" selection={{ kind: "annotation", id: a.id } as never}
        plot={withAnn(plot, a)} table={table} userPresets={[]} profileDefault={null}
        onSelect={vi.fn()}
        onSetAxis={vi.fn()} onSetAxisLength={vi.fn()} onSetAxisTitleFont={vi.fn()}
        onSetSeriesStyle={vi.fn()} onSetSeriesStyleAll={vi.fn()} onSetPointStyle={vi.fn()} onClearPointStyles={vi.fn()}
        onSetGrid={vi.fn()} onSetFrame={vi.fn()} onSetKind={vi.fn()} onSetBarLayout={vi.fn()} onSetBarShape={vi.fn()} onSetBoxWhisker={vi.fn()}
        onSetPlotOptions={vi.fn()} onSetGraphTitle={vi.fn()} onSetPlotFont={vi.fn()} onHomogenizeFont={vi.fn()}
        onSetLegend={vi.fn()} onSetSignificance={vi.fn()} onApplyPreset={vi.fn()}
        onApplyUserPreset={vi.fn()} onSaveUserPreset={vi.fn()} onDeleteUserPreset={vi.fn()} onSetProfileDefault={vi.fn()}
        annotationOps={ops} />,
    );
    return { ...r, patches };
  };
  const row = (c: HTMLElement, name: string): HTMLInputElement | HTMLSelectElement | null =>
    [...c.querySelectorAll("label.frow")].find((l) => l.querySelector("span")?.textContent?.trim() === name)?.querySelector("input, select") ?? null;

  it("xy: Data value pins both axes at where the text sits; Plot position clears both", () => {
    const { container, patches } = inspect("xy", TEXT);
    fireEvent.change(row(container, "Pin to")!, { target: { value: "data" } });
    const p = patches.at(-1) as { anchorX?: number; anchorY?: number };
    expect(p.anchorX).toBeTypeOf("number");
    expect(p.anchorY).toBeTypeOf("number");
    // …at the values where it already sits: the pinned text draws on the same spot
    const { plot, table } = card("xy");
    const before = buildPlotScene(table, withAnn(plot, TEXT), SIZE).annotations.find((x) => x.id === "pin")!;
    const after = buildPlotScene(table, withAnn(plot, { ...TEXT, ...p }), SIZE).annotations.find((x) => x.id === "pin")!;
    expect(Math.abs(after.labelX! - before.labelX!)).toBeLessThan(1);
    expect(Math.abs(after.labelY! - before.labelY!)).toBeLessThan(1);
    cleanup();
    const pinned = inspect("xy", { ...TEXT, anchorX: 2, anchorY: 3 });
    expect((row(pinned.container, "X value") as HTMLInputElement).value).toBe("2");
    fireEvent.change(row(pinned.container, "Y value")!, { target: { value: "5" } });
    expect(pinned.patches.at(-1)).toEqual({ anchorY: 5 });
    fireEvent.change(row(pinned.container, "Pin to")!, { target: { value: "plot" } });
    expect(pinned.patches.at(-1)).toEqual({ anchorX: undefined, anchorY: undefined });
  });
  it("a bar chart offers Y only (its X axis holds categories)", () => {
    const { container, patches } = inspect("bar", TEXT);
    fireEvent.change(row(container, "Pin to")!, { target: { value: "data" } });
    expect(Object.keys(patches.at(-1)!)).toEqual(["anchorY"]);
  });
  it("a horizontal chart (lollipop) labels its value row \"Value (across)\", and pins only that axis", () => {
    const { container, patches } = inspect("lollipop", TEXT);
    fireEvent.change(row(container, "Pin to")!, { target: { value: "data" } });
    expect(Object.keys(patches.at(-1)!)).toEqual(["anchorY"]);
    cleanup();
    const pinned = inspect("lollipop", { ...TEXT, anchorY: 60 });
    expect(row(pinned.container, "Value (across)")).not.toBeNull();
    expect(row(pinned.container, "Y value")).toBeNull();
  });
  it("estimation: its X shows group names, so only Y is offered", () => {
    const { container, patches } = inspect("estimation", TEXT);
    fireEvent.change(row(container, "Pin to")!, { target: { value: "data" } });
    expect(Object.keys(patches.at(-1)!)).toEqual(["anchorY"]);
  });
  it("an arrow's end can be pinned from its editor", () => {
    const { container } = inspect("xy", { id: "ar", kind: "arrow", x: 0.1, y: 0.1, x2: 0.5, y2: 0.5 } as Annotation);
    expect(row(container, "Pin to")).not.toBeNull();
  });
});
