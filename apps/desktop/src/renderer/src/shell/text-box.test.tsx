// @vitest-environment jsdom
// Text box: background, border, wrap, alignment — for a text on a graph, a callout, and a text
// object on the figure canvas.
//
// Both halves, as for every option: each setting moves the drawing (a box painted before the words, the words
// wrapped into lines, lined up inside the box) and each control writes its field. And a text with none of them
// set draws exactly as a plain text does (no box, no lines in the scene). The words the user typed stay the label:
// a wrap never writes a line break into it, so the inline editor opens on the real text.
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import type { Annotation, DataTable, FigureLayout, Plot } from "@mady/core";
import { buildPlotScene } from "@mady/graphics";
import { PlotFigure } from "./PlotFigure";
import { Inspector } from "./Inspector";
import { LayoutPane } from "./panes";
import { galleryItems } from "./gallery";
import { proj } from "./layoutPaneFixture";

afterEach(cleanup);

const SIZE = { width: 620, height: 420 };
const fixture = (kind: string): { plot: Plot; table: DataTable } => {
  const g = galleryItems().find((x) => (x.plot.kind ?? "xy") === kind);
  if (!g) throw new Error(`no ${kind} gallery fixture`);
  return { plot: g.plot as Plot, table: g.table as DataTable };
};
const sceneWith = (kind: string, a: Annotation) => {
  const { plot, table } = fixture(kind);
  return buildPlotScene(table, { ...plot, annotations: [a] } as Plot, SIZE);
};
const html = (kind: string, a: Annotation): string => renderToStaticMarkup(createElement(PlotFigure, { scene: sceneWith(kind, a) }));
/** The `<text data-ann-text>` of annotation `id` and the markup just before it. */
const textAt = (markup: string, id: string): { before: string; text: string } => {
  const i = markup.indexOf(`data-ann-text="${id}"`);
  if (i < 0) throw new Error(`text ${id} was not drawn`);
  const open = markup.lastIndexOf("<text", i);
  return { before: markup.slice(0, open), text: markup.slice(open, markup.indexOf("</text>", i)) };
};
const lastRect = (before: string): string => before.slice(before.lastIndexOf("<rect"));

const TEXT = { id: "t1", kind: "text", label: "Treatment started here", x: 0.5, y: 0.2 } as Annotation;

describe("a text box on a graph", () => {
  it("background + border: a box painted before the words, with its colours (main figure: bar card)", () => {
    const { before } = textAt(html("bar", { ...TEXT, fill: "#ffcc00", fillOpacity: 0.5, borderColor: "#003366", width: 2 } as Annotation), "t1");
    const rect = lastRect(before);
    expect(rect).toMatch(/data-text-box/);
    expect(rect).toMatch(/fill="#ffcc00"/);
    expect(rect).toMatch(/fill-opacity="0\.5"/);
    expect(rect).toMatch(/stroke="#003366"/);
    expect(rect).toMatch(/stroke-width="2"/);
  });
  it("the same on a chart drawn through the annotation layer (heatmap card)", () => {
    const { before } = textAt(html("heatmap", { ...TEXT, fill: "#ffcc00" } as Annotation), "t1");
    expect(lastRect(before)).toMatch(/data-text-box[^>]*fill="#ffcc00"/);
  });
  it("a dashed border", () => {
    const { before } = textAt(html("bar", { ...TEXT, borderColor: "#000000", dash: "dashed" } as Annotation), "t1");
    expect(lastRect(before)).toMatch(/stroke-dasharray=/);
  });
  it("a wrap width breaks the words into lines; the label keeps what was typed", () => {
    const s = sceneWith("bar", { ...TEXT, w: 0.15 } as Annotation);
    const a = s.annotations.find((x) => x.id === "t1")!;
    expect(a.label).toBe("Treatment started here");
    expect(a.textBox!.lines.length).toBeGreaterThan(1);
    const { text } = textAt(renderToStaticMarkup(createElement(PlotFigure, { scene: s })), "t1");
    expect(text.match(/<tspan/g)?.length).toBe(a.textBox!.lines.length);
  });
  it("double-clicking a wrapped text opens the editor on the typed words, no line breaks", () => {
    const s = sceneWith("bar", { ...TEXT, w: 0.15 } as Annotation);
    const { container } = render(<PlotFigure scene={s} onEditText={() => {}} />);
    fireEvent.doubleClick(container.querySelector('[data-ann-text="t1"]')!);
    const ed = container.querySelector<HTMLTextAreaElement | HTMLInputElement>("textarea, input[type=text]");
    expect(ed?.value).toBe("Treatment started here");
  });
  it("Align Left lines the words up at the box's inside left edge; the box stays put", () => {
    const centred = sceneWith("bar", { ...TEXT, w: 0.3, fill: "#eeeeee" } as Annotation).annotations.find((x) => x.id === "t1")!;
    const left = sceneWith("bar", { ...TEXT, w: 0.3, fill: "#eeeeee", align: "start" } as Annotation).annotations.find((x) => x.id === "t1")!;
    expect(left.textBox!.box).toEqual(centred.textBox!.box);
    expect(left.textBox!.x).toBeCloseTo(left.textBox!.box!.x + 6, 6);
    const { text } = textAt(html("bar", { ...TEXT, w: 0.3, align: "start" } as Annotation), "t1");
    expect(text).toMatch(/text-anchor="start"/);
  });
  it("a selected boxed text's delete handle sits on the box's top-right corner (main figure and layer)", () => {
    for (const kind of ["bar", "heatmap"]) {
      const s = sceneWith(kind, { ...TEXT, w: 0.15, fill: "#ffcc00" } as Annotation);
      const box = s.annotations.find((x) => x.id === "t1")!.textBox!.box!;
      const { container } = render(<PlotFigure scene={s} selected={{ kind: "annotation", id: "t1" } as never} onDeleteAnnotation={() => {}} />);
      const c = container.querySelector(".gfx-anndelete circle")!;
      expect(Number(c.getAttribute("cx")), kind).toBeCloseTo(box.x + box.w, 6);
      expect(Number(c.getAttribute("cy")), kind).toBeCloseTo(box.y, 6);
      cleanup();
    }
  });
  it("a text with none of the box settings draws as a plain text: no box, no lines", () => {
    const a = sceneWith("bar", TEXT).annotations.find((x) => x.id === "t1")!;
    expect(a).not.toHaveProperty("textBox");
    expect(a.labelAnchor).toBe("middle");
    expect(html("bar", TEXT)).not.toMatch(/data-text-box/);
  });
});

describe("a callout's box", () => {
  const CALLOUT = { id: "c1", kind: "callout", label: "Note here", x: 0.2, y: 0.2, x2: 0.6, y2: 0.6, arrowHead: "end" } as Annotation;
  it("a border colour draws the box's outline in the arrow's width", () => {
    const m = html("bar", { ...CALLOUT, borderColor: "#aa0000", width: 3 } as Annotation);
    const shape = m.slice(m.indexOf('data-ann-shape="c1"'));
    expect(shape).toMatch(/<rect[^>]*data-text-box[^>]*stroke="#aa0000"[^>]*stroke-width="3"/);
  });
  it("a wrap width wraps the callout's words", () => {
    const a = sceneWith("bar", { ...CALLOUT, label: "a longer note to wrap", w: 0.12 } as Annotation).annotations.find((x) => x.id === "c1")!;
    expect(a.textBox!.lines.length).toBeGreaterThan(1);
  });
});

// ---- dragging an aligned text -------------------------------------------------------------------------------------
// The box stays centred on the text's point and Align moves the words away from it, so a drag that put the point
// under the pointer would make an aligned text jump sideways on the first move, by the distance between the point and
// where the text was grabbed. The point moves by the pointer's travel instead. `clientToUser` needs getScreenCTM,
// which jsdom lacks: an identity stub makes client px = scene px (PlotFigure.zoom.test.tsx).
describe("dragging an aligned text moves it by the pointer's travel, never to the pointer", () => {
  beforeAll(() => {
    const identity = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0, inverse() { return identity; } };
    (SVGElement.prototype as unknown as { getScreenCTM: () => unknown }).getScreenCTM = () => identity;
    (globalThis as unknown as { DOMPoint: unknown }).DOMPoint = class {
      constructor(public x: number, public y: number) {}
      matrixTransform(): { x: number; y: number } { return { x: this.x, y: this.y }; }
    };
  });
  for (const kind of ["bar", "heatmap"]) {
    it(`${kind === "bar" ? "main figure" : "annotation layer"} (${kind} card)`, () => {
      const s = sceneWith(kind, { ...TEXT, w: 0.3, align: "end", fill: "#eeeeee" } as Annotation);
      const a = s.annotations.find((x) => x.id === "t1")!;
      const onMove = vi.fn();
      const { container } = render(<PlotFigure scene={s} onMoveAnnotation={onMove} onEditText={() => {}} />);
      const t = container.querySelector('[data-ann-text="t1"]')!;
      const grabX = a.textBox!.x - 5; // on the right-aligned words, far from the point
      const y = a.labelY!;
      fireEvent.pointerDown(t, { clientX: grabX, clientY: y, pointerId: 1, button: 0 });
      fireEvent.pointerMove(window, { clientX: grabX + 40, clientY: y, pointerId: 1 });
      fireEvent.pointerUp(window, { clientX: grabX + 40, clientY: y, pointerId: 1 });
      const patch = onMove.mock.calls.at(-1)?.[1] as { x: number } | undefined;
      expect(patch, "the drag reported no move").toBeDefined();
      expect(patch!.x * s.plot.width + s.plot.x).toBeCloseTo(a.labelX! + 40, 4);
    });
  }
});

// ---- the controls -------------------------------------------------------------------------------------------------

const inspectorFor = (a: Annotation) => {
  const { plot, table } = fixture("bar");
  const patches: Array<Record<string, unknown>> = [];
  const ops = {
    add: vi.fn(), remove: vi.fn(), reorder: vi.fn(), align: vi.fn(), group: vi.fn(), ungroup: vi.fn(),
    setLocked: vi.fn(), addImage: vi.fn(), replaceImage: vi.fn(),
    update: (_id: string, patch: Record<string, unknown>) => patches.push(patch),
  };
  const r = render(
    <Inspector activeSection="graphs" selection={{ kind: "annotation", id: a.id } as never}
      plot={{ ...plot, annotations: [a] } as Plot} table={table} userPresets={[]} profileDefault={null}
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
/** The input / select of the Inspector row whose caption is `name`. */
const row = (c: HTMLElement, name: string): HTMLInputElement | HTMLSelectElement | null => {
  const lab = [...c.querySelectorAll("label.frow")].find((l) => l.querySelector("span")?.textContent?.trim() === name);
  return lab?.querySelector("input, select") ?? null;
};

describe("the Inspector's text box rows", () => {
  it("a text: every row writes its field", () => {
    const { container, patches } = inspectorFor({ ...TEXT, borderColor: "#000000", fill: "#ffffff" } as Annotation);
    fireEvent.change(row(container, "Align")!, { target: { value: "start" } });
    expect(patches.at(-1)).toEqual({ align: "start" });
    fireEvent.change(row(container, "Wrap width %")!, { target: { value: "40" } });
    expect(patches.at(-1)).toEqual({ w: 0.4 });
    fireEvent.change(row(container, "Background")!, { target: { value: "#ffcc00" } });
    expect(patches.at(-1)).toEqual({ fill: "#ffcc00" });
    fireEvent.change(row(container, "Background opacity")!, { target: { value: "0.5" } });
    expect(patches.at(-1)).toEqual({ fillOpacity: 0.5 });
    fireEvent.change(row(container, "Box border")!, { target: { value: "#aa0000" } });
    expect(patches.at(-1)).toEqual({ borderColor: "#aa0000" });
    fireEvent.change(row(container, "Border width")!, { target: { value: "2" } });
    expect(patches.at(-1)).toEqual({ width: 2 });
    fireEvent.change(row(container, "Border style")!, { target: { value: "dashed" } });
    expect(patches.at(-1)).toEqual({ dash: "dashed" });
    fireEvent.change(row(container, "Padding")!, { target: { value: "10" } });
    expect(patches.at(-1)).toEqual({ padding: 10 });
    fireEvent.change(row(container, "Corner radius")!, { target: { value: "0" } });
    expect(patches.at(-1)).toEqual({ radius: 0 });
  });
  it("a blank wrap width clears it", () => {
    const { container, patches } = inspectorFor({ ...TEXT, w: 0.4 } as Annotation);
    expect((row(container, "Wrap width %") as HTMLInputElement).value).toBe("40");
    fireEvent.change(row(container, "Wrap width %")!, { target: { value: "" } });
    expect(patches.at(-1)).toEqual({ w: undefined });
  });
  it("border width / style show only once the box has a border", () => {
    const { container } = inspectorFor(TEXT);
    expect(row(container, "Border width")).toBeNull();
    expect(row(container, "Box border")).not.toBeNull();
  });
  it("a callout: its Fill row is the Background; its Box border and Align rows write their fields", () => {
    const { container, patches } = inspectorFor({ id: "c1", kind: "callout", label: "Note", x: 0.2, y: 0.2, x2: 0.6, y2: 0.6 } as Annotation);
    expect(row(container, "Background")).not.toBeNull();
    expect(row(container, "Border width")).toBeNull(); // the arrow's Thickness is the border width
    fireEvent.change(row(container, "Box border")!, { target: { value: "#aa0000" } });
    expect(patches.at(-1)).toEqual({ borderColor: "#aa0000" });
    fireEvent.change(row(container, "Align")!, { target: { value: "end" } });
    expect(patches.at(-1)).toEqual({ align: "end" });
  });
});

describe("a text object on the figure canvas", () => {
  const mountCanvas = (ann: Record<string, unknown>) => {
    const onUpdate = vi.fn();
    const ed = { selectedPlot: null, selection: null, onSelectPanel: () => {}, onSelect: () => {} };
    const r = render(
      <LayoutPane
        project={proj({ panels: ["A"], freeform: true, panelPositions: { A: { x: 100, y: 40 } }, figureAnnotations: [ann as never] } as Partial<FigureLayout>)}
        layoutId="L" onRemovePanel={() => {}} onOpenPlot={() => {}} onSetLayoutOptions={() => {}} editing={ed as never}
        onUpdateFigureAnnotation={onUpdate} onAddFigureAnnotation={() => {}} onRemoveFigureAnnotation={() => {}} onMoveFigureAnnotation={() => {}}
      />,
    );
    return { ...r, onUpdate };
  };
  const OBJ = { id: "o1", kind: "text", label: "a canvas note to wrap", x: 300, y: 120 };
  it("draws its box and wraps at a width in canvas px", () => {
    const { container } = mountCanvas({ ...OBJ, fill: "#ffcc00", w: 60 });
    const rect = container.querySelector(".layannot rect[data-text-box]");
    expect(rect?.getAttribute("fill")).toBe("#ffcc00");
    expect(Number(rect?.getAttribute("width"))).toBe(60 + 12);
    expect(container.querySelectorAll('.layannot [data-ann-text="o1"] tspan').length).toBeGreaterThan(1);
  });
  it("its Object row writes every text box setting", () => {
    const { container, onUpdate } = mountCanvas(OBJ);
    fireEvent.click(container.querySelector('.layannot [data-ann-text="o1"]')!);
    const ctl = (title: string): HTMLInputElement | HTMLSelectElement =>
      container.querySelector(`label[title^="${title}"]`)!.querySelector("input, select")!;
    fireEvent.change(ctl("Background behind the words"), { target: { value: "#ffcc00" } });
    expect(onUpdate).toHaveBeenLastCalledWith("o1", { fill: "#ffcc00" });
    fireEvent.change(ctl("Box border colour"), { target: { value: "#aa0000" } });
    expect(onUpdate).toHaveBeenLastCalledWith("o1", { borderColor: "#aa0000" });
    fireEvent.change(ctl("Line the words up"), { target: { value: "end" } });
    expect(onUpdate).toHaveBeenLastCalledWith("o1", { align: "end" });
    fireEvent.change(ctl("Wrap the words"), { target: { value: "120" } });
    expect(onUpdate).toHaveBeenLastCalledWith("o1", { w: 120 });
    fireEvent.change(ctl("Space between the words"), { target: { value: "8" } });
    expect(onUpdate).toHaveBeenLastCalledWith("o1", { padding: 8 });
    fireEvent.change(ctl("Corner radius of the box"), { target: { value: "0" } });
    expect(onUpdate).toHaveBeenLastCalledWith("o1", { radius: 0 });
  });
  it("border width shows for a text only once it has a border", () => {
    const { container } = mountCanvas(OBJ);
    fireEvent.click(container.querySelector('.layannot [data-ann-text="o1"]')!);
    expect(container.querySelector('label[title="Box border width (px)"]')).toBeNull();
    cleanup();
    const b = mountCanvas({ ...OBJ, borderColor: "#000000" });
    fireEvent.click(b.container.querySelector('.layannot [data-ann-text="o1"]')!);
    expect((b.container.querySelector('label[title="Box border width (px)"] input') as HTMLInputElement).value).toBe("1");
  });
});
