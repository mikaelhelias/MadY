// @vitest-environment jsdom
/**
 * A triplot's explanatory arrows (and an ordination's species arrows) open their panel.
 *
 * Guards the triplot arrow's dash · head · width controls. Clicking an explanatory arrow —
 * `pca-arrow-e0` — must select it and open its style, not the panel's "This annotation was
 * removed. Click the graph background to add another." Both the panel and the document's recolour
 * match loading keys, and they must accept the `e` (explanatory) and `s` (species) keys the
 * builder draws under, not digits only — otherwise the style the builder honours for the arrow
 * is unreachable, and its colour unchangeable.
 */
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import type { Plot, Project } from "@mady/core";
import { MadyDocument } from "@mady/core";
import { buildPlotScene, type AnnotationScene } from "@mady/graphics";
import { Inspector } from "./Inspector";
import { PlotFigure } from "./PlotFigure";
import { galleryItems } from "./gallery";

afterEach(cleanup);

const triplot = () => galleryItems().find((i) => i.plot.kind === "triplot")!;
/** The gallery triplot draws its species as points; an `s` key only exists as an arrow when asked. */
const withSpeciesArrows = (p: Plot): Plot => ({ ...p, pcaStyle: { ...(p.pcaStyle ?? {}), speciesAs: "arrows" } }) as Plot;

function panel(plot: Plot, id: string) {
  const item = triplot();
  const noop = vi.fn();
  const onSetPlotOptions = vi.fn<(patch: Partial<Plot>) => void>();
  const update = vi.fn();
  // Only the handlers this panel calls are supplied; the rest are never reached here.
  const handlers = {} as ComponentProps<typeof Inspector>;
  const { container } = render(
    <Inspector {...handlers} onSetPlotOptions={onSetPlotOptions} activeSection="graphs" selection={{ kind: "annotation", id }} plot={plot} table={item.table}
      userPresets={[]} profileDefault={null} wholeGraph={false} onSetWholeGraph={noop}
      annotationOps={{ add: noop, update, remove: noop, reorder: noop, align: noop, group: noop, ungroup: noop, setLocked: noop, addImage: noop, replaceImage: noop }} />,
  );
  return { container, onSetPlotOptions, update };
}

const arrowOf = (plot: Plot, id: string): AnnotationScene | undefined => buildPlotScene(triplot().table, plot, {}).annotations.find((a) => a.id === id);

describe("triplot explanatory / species arrows", () => {
  it("the drawn explanatory arrow is clickable and selects itself", () => {
    const item = triplot();
    const onSelect = vi.fn();
    const { container } = render(<PlotFigure scene={buildPlotScene(item.table, item.plot, { width: 640, height: 480 })} selected={null} onSelect={onSelect} />);
    const g = container.querySelector('[data-ann-shape="pca-arrow-e0"]');
    expect(g, "the gallery triplot draws no explanatory arrow e0 — the fixture cannot exhibit this").toBeTruthy();
    // A shape annotation selects on press (ShapeAnnotation's `start`).
    fireEvent.pointerDown(g!.querySelector("line, path")!, { button: 0, pointerId: 1 });
    expect(onSelect).toHaveBeenCalledWith({ kind: "annotation", id: "pca-arrow-e0" });
  });

  for (const id of ["pca-arrow-e0", "pca-arrow-s0"]) {
    it(`${id}: the panel opens (not "removed") and Thickness / Dashes / Arrowhead reach the arrow`, () => {
      const g = triplot();
      const item = id.includes("-s") ? { ...g, plot: withSpeciesArrows(g.plot) } : g;
      expect(arrowOf(item.plot, id), `${id} is not drawn on the gallery triplot`).toBeTruthy();
      const { container, onSetPlotOptions } = panel(item.plot, id);
      expect(container.textContent).not.toContain("This annotation was removed");
      const byLabel = (l: string) => container.querySelector(`[aria-label="${l}"]`) as HTMLInputElement | HTMLSelectElement;
      fireEvent.change(byLabel("Loading arrow thickness"), { target: { value: "4" } });
      fireEvent.change(byLabel("Loading arrow dashes"), { target: { value: "dashed" } });
      fireEvent.click(byLabel("Loading arrowhead"));
      const patch = Object.assign({}, ...onSetPlotOptions.mock.calls.map(([p]) => p.pcaStyle)) as NonNullable<Plot["pcaStyle"]>;
      const before = arrowOf(item.plot, id)!;
      const after = arrowOf({ ...item.plot, pcaStyle: { ...(item.plot.pcaStyle ?? {}), ...patch } }, id)!;
      expect(after.width).toBe(4);
      expect(after.dash).not.toEqual(before.dash);
      expect(after.arrowHead).toBe("none");
    });
  }

  it("the panel names the explanatory variable it edits", () => {
    const item = triplot();
    const label = buildPlotScene(item.table, item.plot, {}).annotations.find((a) => a.id === "pca-vlabel-e0")!.label!;
    const { container } = panel(item.plot, "pca-arrow-e0");
    expect(container.querySelector(".insphd")?.textContent).toBe(`${label} — vector`);
  });

  it("recolouring an explanatory arrow reaches the drawing (document path)", () => {
    const item = triplot();
    const project: Project = { schemaVersion: 4, tables: [item.table], plots: [item.plot], analyses: [], log: [], workspace: { folders: [], loose: [] } };
    const doc = new MadyDocument(project);
    doc.updateAnnotation(item.plot.id, "pca-arrow-e0", { color: "#ff00aa" });
    const plot = doc.toJSON().plots.find((p) => p.id === item.plot.id)!;
    expect(arrowOf(plot, "pca-arrow-e0")!.color).toBe("#ff00aa");
    expect(arrowOf(plot, "pca-arrow-e1")!.color).not.toBe("#ff00aa");
  });
});
