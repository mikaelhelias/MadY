// @vitest-environment jsdom
/**
 * Rename a legend row on the graph. Every text on a graph is editable, including the legends on the polar
 * histogram, sunburst, oncoprint, ordination and XY charts: double-clicking a row's words opens an editor, and
 * the new words land where the row's name lives: the data column (a series), the line's caption (a listed
 * line), or the row's display name (everything else).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import type { DataTable, Plot } from "@mady/core";
import { buildPlotScene } from "@mady/graphics";
import { PlotFigure } from "./PlotFigure";
import { galleryItems, galleryLookup } from "./gallery";
import { legendRowEdit } from "./legendRename";

afterEach(cleanup);

const byKind = (kind: string) => {
  const g = galleryItems().find((x) => x.plot.kind === kind && x.plot.legend?.position !== "direct");
  if (!g) throw new Error(`no ${kind} card`);
  return { table: g.table as DataTable, plot: g.plot as Plot, lk: galleryLookup(g) };
};
const sceneOf = (c: ReturnType<typeof byKind>, plot: Plot = c.plot) => buildPlotScene(c.table, plot, { width: 640, height: 480, tables: c.lk });

describe("what a rename changes", () => {
  const table = { columns: [{ id: "c1" }, { id: "c2" }] } as unknown as DataTable;
  it("a row naming a data column renames the column", () => {
    expect(legendRowEdit({}, table, { kind: "legendRow", label: "Control", seriesId: "c1" }, " Vehicle ")).toEqual({ do: "renameColumn", columnId: "c1", name: "Vehicle" });
    expect(legendRowEdit({}, table, { kind: "legendRow", label: "Control", seriesId: "c1" }, "  ")).toEqual({ do: "nothing" });
  });
  it("a listed line's row renames the line's caption", () => {
    expect(legendRowEdit({}, table, { kind: "legendRow", label: "LOD", annotationId: "a1" }, "Limit")).toEqual({ do: "annotationLabel", id: "a1", label: "Limit" });
  });
  it("any other row stores its display name; empty or the built label puts it back", () => {
    const t = { kind: "legendRow" as const, label: "Missense", seriesId: "pca-g0" }; // not a column
    expect(legendRowEdit({}, table, t, "Point mutation")).toEqual({ do: "legendLabels", legendLabels: { Missense: "Point mutation" } });
    expect(legendRowEdit({ legendLabels: { Missense: "X", Other: "Y" } }, table, t, "")).toEqual({ do: "legendLabels", legendLabels: { Other: "Y" } });
    expect(legendRowEdit({ legendLabels: { Missense: "X" } }, table, t, "Missense")).toEqual({ do: "legendLabels", legendLabels: undefined });
  });
});

// The main figure's kinds listed above, plus a bar (a column series) and a pie (its own figure family).
const KINDS = ["xy", "rose", "sunburst", "oncoprint", "pcascore", "bar", "pie"];

describe("dragging the legend never captures the pointer", () => {
  // Guards against two browser-only faults (jsdom has no pointer capture, so only the built app shows them):
  //  - captured on the press, the click / double-click that follows goes to the legend block, not the row's words —
  //    the rename editor never opens;
  //  - captured only once the press moves, a drag whose first move leaves the block is lost.
  // The drag follows window listeners instead. Measured here: no capture at all, and a drag whose every move happens
  // outside the legend still moves it.
  it("no capture; moves anywhere on the page carry the legend", () => {
    const c = byKind("bar");
    const proto = Element.prototype as unknown as { setPointerCapture?: ((id: number) => void) | undefined };
    const had = proto.setPointerCapture;
    const capture = vi.fn();
    proto.setPointerCapture = capture;
    try {
      const onMoveLegend = vi.fn();
      const { container } = render(<PlotFigure scene={sceneOf(c)} selected={null} onSelect={vi.fn()} onMoveLegend={onMoveLegend} onEditText={vi.fn()} />);
      const words = container.querySelector(".gfx-legend text[data-legend-text]")!;
      fireEvent.pointerDown(words, { clientX: 100, clientY: 100, pointerId: 1, button: 0 });
      fireEvent.pointerMove(document.body, { clientX: 100, clientY: 140, pointerId: 1 });
      fireEvent.pointerUp(document.body, { clientX: 100, clientY: 160, pointerId: 1 });
      expect(capture, "the legend captured the pointer").not.toHaveBeenCalled();
      expect(onMoveLegend, "a drag whose moves were outside the legend was lost").toHaveBeenCalledWith(0, 60);
    } finally {
      proto.setPointerCapture = had;
    }
  });
});

describe.each(KINDS)("%s", (kind) => {
  it("a stored display name reaches the drawn row (and remembers the built label)", () => {
    const c = byKind(kind);
    const built = sceneOf(c).legend;
    expect(built.length, "the card draws no legend — this proves nothing").toBeGreaterThan(0);
    const key = built[0]!.label;
    const scene = sceneOf(c, { ...c.plot, legendLabels: { [key]: "Renamed row" } } as Plot);
    expect(scene.legend[0]).toMatchObject({ label: "Renamed row", labelKey: key });
    const { container } = render(<PlotFigure scene={scene} selected={null} />);
    expect([...container.querySelectorAll(".gfx-legend text")].some((t) => t.textContent === "Renamed row")).toBe(true);
  });

  it("double-clicking a row's words opens an editor, and Enter commits the rename for that row", () => {
    const c = byKind(kind);
    const scene = sceneOf(c);
    const onEditText = vi.fn();
    const { container } = render(<PlotFigure scene={scene} selected={null} onSelect={vi.fn()} onEditText={onEditText} />);
    const words = container.querySelector(`.gfx-legend text[data-legend-text]`)!;
    expect(words, "no legend words drawn").not.toBeNull();
    fireEvent.doubleClick(words);
    const box = container.querySelector<HTMLInputElement | HTMLTextAreaElement>("input, textarea");
    expect(box, "double-click opened no editor").not.toBeNull();
    fireEvent.change(box!, { target: { value: "New name" } });
    fireEvent.keyDown(box!, { key: "Enter" });
    expect(onEditText).toHaveBeenCalled();
    const [target, value] = onEditText.mock.calls.at(-1)!;
    expect(target).toMatchObject({ kind: "legendRow", label: words.getAttribute("data-legend-text") });
    expect(value).toBe("New name");
  });
});
