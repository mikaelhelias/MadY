// @vitest-environment jsdom
/**
 * The oncoprint's axis labels are clickable and editable, like every other text on a graph.
 * The gene names (left) and the sample names (bottom, with Sample labels on) drag one by one
 * (`OncoprintStyle.geneLabelOffsets` / `sampleLabelOffsets`, keyed by the name) and double-click renames them. A name is
 * the data — the heatmap's row-name rule — so a rename edits every cell of the gene (or sample) column that holds it, in
 * one step, and a dragged name keeps its place under its new name. A click still opens Chart type. The % numbers are
 * computed counts and stay put.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import type { DataTable, Plot } from "@mady/core";
import { buildPlotScene } from "@mady/graphics";
import { PlotFigure } from "./PlotFigure";
import { galleryItems, galleryLookup } from "./gallery";
import { oncoprintLabelMove, oncoprintRename } from "./oncoprintLabels";

beforeAll(() => {
  // jsdom has no getScreenCTM: without it every drag is a no-op in the harness (see text-draggable.sweep.test.tsx).
  const proto = (globalThis as unknown as { SVGSVGElement?: { prototype: Record<string, unknown> } }).SVGSVGElement?.prototype;
  if (proto && typeof proto.getScreenCTM !== "function") {
    proto.getScreenCTM = function getScreenCTM() {
      return { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0, inverse: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }) };
    };
  }
  if (typeof (globalThis as { DOMPoint?: unknown }).DOMPoint !== "function") {
    class P { x: number; y: number; constructor(x = 0, y = 0) { this.x = x; this.y = y; } matrixTransform() { return this; } }
    (globalThis as { DOMPoint?: unknown }).DOMPoint = P;
  }
});
afterEach(cleanup);

const onco = (patch: NonNullable<Plot["oncoprint"]> = {}) => {
  const g = galleryItems().find((x) => x.plot.kind === "oncoprint");
  if (!g) throw new Error("no oncoprint card");
  const plot = { ...g.plot, oncoprint: { ...(g.plot.oncoprint ?? {}), ...patch } } as Plot;
  return { table: g.table as DataTable, plot, scene: buildPlotScene(g.table, plot, { width: 640, height: 480, tables: galleryLookup(g) }) };
};
const textEl = (c: HTMLElement, t: string) => [...c.querySelectorAll(".gfx-oncoprint text")].find((x) => x.textContent === t);
const drag = (el: Element) => {
  fireEvent.pointerDown(el, { clientX: 100, clientY: 100, pointerId: 1 });
  fireEvent.pointerMove(el, { clientX: 125, clientY: 110, pointerId: 1 });
  fireEvent.pointerUp(el, { clientX: 125, clientY: 110, pointerId: 1 });
};

describe("oncoprint labels — the drawing", () => {
  it("untouched: the scene is exactly what it was", () => {
    const s = onco({ showSampleLabels: true }).scene.oncoprint!;
    expect(s.geneLabels.length, "no gene names - this proves nothing").toBeGreaterThan(2);
    expect(s.sampleLabels.length, "no sample names - this proves nothing").toBeGreaterThan(2);
    expect(Object.keys(s.geneLabels[0]!).sort()).toEqual(["text", "x", "y"]);
    expect(Object.keys(s.sampleLabels[0]!).sort()).toEqual(["angle", "text", "x", "y"]);
  });

  it("a moved gene or sample name carries its offset; the others do not", () => {
    const s0 = onco({ showSampleLabels: true }).scene.oncoprint!;
    const gene = s0.geneLabels[2]!.text, sample = s0.sampleLabels[1]!.text;
    const s = onco({ showSampleLabels: true, geneLabelOffsets: { [gene]: { dx: 5, dy: 3 } }, sampleLabelOffsets: { [sample]: { dx: -4, dy: 6 } } }).scene.oncoprint!;
    expect(s.geneLabels.find((g) => g.text === gene)!.off).toEqual({ dx: 5, dy: 3 });
    expect(s.geneLabels.filter((g) => g.off)).toHaveLength(1);
    expect(s.sampleLabels.find((g) => g.text === sample)!.off).toEqual({ dx: -4, dy: 6 });
    expect(s.sampleLabels.filter((g) => g.off)).toHaveLength(1);
  });
});

describe("oncoprint labels — drag, rename, click", () => {
  it("dragging a gene name reports the gene and where it went", () => {
    const { scene } = onco();
    const gene = scene.oncoprint!.geneLabels[1]!.text;
    const onMove = vi.fn();
    const { container } = render(<PlotFigure scene={scene} onMoveOncoprintLabel={onMove} onSelect={vi.fn()} />);
    drag(textEl(container, gene)!);
    expect(onMove).toHaveBeenCalled();
    const [axis, name, dx, dy] = onMove.mock.calls.at(-1)!;
    expect([axis, name]).toEqual(["gene", gene]);
    expect(Math.abs(dx) + Math.abs(dy)).toBeGreaterThan(0);
  });

  it("dragging a sample name reports the sample", () => {
    const { scene } = onco({ showSampleLabels: true });
    const sample = scene.oncoprint!.sampleLabels[0]!.text;
    const onMove = vi.fn();
    const { container } = render(<PlotFigure scene={scene} onMoveOncoprintLabel={onMove} onSelect={vi.fn()} />);
    drag(textEl(container, sample)!);
    expect(onMove.mock.calls.at(-1)!.slice(0, 2)).toEqual(["sample", sample]);
  });

  it("double-click a gene name opens an editor; Enter renames it", () => {
    const { scene } = onco();
    const gene = scene.oncoprint!.geneLabels[0]!.text;
    const onEditText = vi.fn();
    const { container } = render(<PlotFigure scene={scene} onEditText={onEditText} onSelect={vi.fn()} />);
    fireEvent.doubleClick(textEl(container, gene)!);
    const editor = container.querySelector<HTMLInputElement | HTMLTextAreaElement>("textarea, input");
    expect(editor, "no editor on double-click").toBeTruthy();
    fireEvent.change(editor!, { target: { value: "p53" } });
    fireEvent.keyDown(editor!, { key: "Enter" });
    expect(onEditText).toHaveBeenCalledWith({ kind: "oncoprintLabel", axis: "gene", name: gene }, "p53");
  });

  it("a click on a gene name still opens Chart type", () => {
    const { scene } = onco();
    const onSelect = vi.fn();
    const { container } = render(<PlotFigure scene={scene} onSelect={onSelect} />);
    const el = textEl(container, scene.oncoprint!.geneLabels[0]!.text)!;
    fireEvent.pointerDown(el, { clientX: 50, clientY: 50, pointerId: 1 });
    fireEvent.pointerUp(el, { clientX: 50, clientY: 50, pointerId: 1 });
    expect(onSelect).toHaveBeenCalledWith({ kind: "chart-section", title: "Chart type" });
  });
});

describe("oncoprint labels — what gets written", () => {
  const table: DataTable = {
    id: "t", kind: "column", name: "T",
    columns: [{ id: "s", name: "Sample", role: "x" }, { id: "g", name: "Gene", role: "y" }, { id: "a", name: "Alteration", role: "y" }],
    rows: [
      { id: "r1", cells: { s: "P1", g: "TP53", a: "Missense" } },
      { id: "r2", cells: { s: "P2", g: " TP53 ", a: "Truncating" } },
      { id: "r3", cells: { s: "P2", g: "KRAS", a: "Missense" } },
    ],
  };

  it("a gene rename edits every cell of the gene column that holds it (trimmed, as the chart reads it)", () => {
    expect(oncoprintRename(table, undefined, "gene", "TP53", " p53 ").cells).toEqual([
      { rowId: "r1", columnId: "g", value: "p53" },
      { rowId: "r2", columnId: "g", value: "p53" },
    ]);
  });

  it("a sample rename edits the sample column; blank or unchanged edits nothing", () => {
    expect(oncoprintRename(table, undefined, "sample", "P2", "Patient 2").cells.map((c) => c.rowId)).toEqual(["r2", "r3"]);
    expect(oncoprintRename(table, undefined, "sample", "P2", "  ").cells).toEqual([]);
    expect(oncoprintRename(table, undefined, "gene", "KRAS", "KRAS").cells).toEqual([]);
  });

  it("the chosen columns win over the defaults", () => {
    const swapped = { ...table, columns: [table.columns[1]!, table.columns[0]!, table.columns[2]!] };
    expect(oncoprintRename(swapped, { geneColumn: "g", sampleColumn: "s" }, "gene", "KRAS", "K").cells).toEqual([{ rowId: "r3", columnId: "g", value: "K" }]);
  });

  it("a dragged name keeps its place under its new name", () => {
    const r = oncoprintRename(table, { geneLabelOffsets: { TP53: { dx: 4, dy: 1 }, KRAS: { dx: 2, dy: 2 } } }, "gene", "TP53", "p53");
    expect(r.patch?.oncoprint?.geneLabelOffsets).toEqual({ p53: { dx: 4, dy: 1 }, KRAS: { dx: 2, dy: 2 } });
    expect(oncoprintRename(table, undefined, "gene", "TP53", "p53").patch).toBeUndefined();
  });

  it("a move stores the offset under the name, the others kept", () => {
    expect(oncoprintLabelMove({ sampleLabelOffsets: { P1: { dx: 1, dy: 1 } } }, "sample", "P2", 3, -2)).toEqual({
      oncoprint: { sampleLabelOffsets: { P1: { dx: 1, dy: 1 }, P2: { dx: 3, dy: -2 } } },
    });
  });
});
