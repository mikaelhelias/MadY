// @vitest-environment jsdom
// The callout's fill control must reach the drawing.
//
// The annotation editor offers "Fill" + "Fill opacity" for a callout (`hasFill` in Inspector.tsx),
// and the builder passes both into the scene (`buildScene.ts` callout branch). Guards against the
// renderer's callout branch drawing only the leader line, the arrowhead and the text, so the fill
// never reaches the drawing. A control that changes nothing on the figure is a dead control.
//
// Both halves: the field moves the drawing (a box behind the callout text, painted before the
// text so the words stay on top), and the editor's row writes it. And the unfilled callout must
// draw no box and no new element.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import type { Annotation, DataTable, Plot } from "@mady/core";
import { buildPlotScene } from "@mady/graphics";
import { PlotFigure } from "./PlotFigure";
import { Inspector } from "./Inspector";
import { galleryItems } from "./gallery";

afterEach(cleanup);

const SIZE = { width: 620, height: 420 };
const fixture = (): { plot: Plot; table: DataTable } => {
  const g = galleryItems().find((x) => (x.plot.kind ?? "xy") === "bar");
  if (!g) throw new Error("no bar gallery fixture");
  return { plot: g.plot as Plot, table: g.table as DataTable };
};
const render1 = (a: Annotation): string => {
  const { plot, table } = fixture();
  return renderToStaticMarkup(createElement(PlotFigure, {
    scene: buildPlotScene(table, { ...plot, annotations: [a] } as Plot, SIZE),
  }));
};
/** The markup of one shape annotation's group — from its `data-ann-shape` to its closing tag. */
const shapeMarkup = (html: string, id: string): string => {
  const start = html.indexOf(`data-ann-shape="${id}"`);
  if (start < 0) throw new Error(`annotation ${id} was not drawn`);
  const end = html.indexOf("</g>", start);
  return html.slice(start, end);
};

const CALLOUT = { id: "c1", kind: "callout", label: "Note", x: 0.2, y: 0.2, x2: 0.6, y2: 0.6, arrowHead: "end" } as Annotation;

describe("a callout's Fill reaches the drawing", () => {
  it("a filled callout draws a box behind its text — painted before the text, with the fill and its opacity", () => {
    const shape = shapeMarkup(render1({ ...CALLOUT, fill: "#ffcc00", fillOpacity: 0.5 } as Annotation), "c1");
    const rect = shape.match(/<rect\b[^>]*>/)?.[0];
    expect(rect, "no box is drawn behind a filled callout's text").toBeDefined();
    expect(rect).toMatch(/fill="#ffcc00"/);
    expect(rect).toMatch(/fill-opacity="0\.5"/);
    // Paint order is DOM order: the box must come before the words, or it covers them.
    expect(shape.indexOf("<rect")).toBeLessThan(shape.indexOf("<text"));
  });

  it("without a fill, the callout draws no box — only the leader line, the arrowhead and the text", () => {
    const shape = shapeMarkup(render1(CALLOUT), "c1");
    expect(shape).not.toMatch(/<rect/);
    expect(shape).toMatch(/<text/);
  });

  it("the editor's Fill row writes `fill` on a callout", () => {
    const { plot, table } = fixture();
    const wrote: string[] = [];
    const ops = {
      add: vi.fn(), remove: vi.fn(), reorder: vi.fn(), align: vi.fn(), group: vi.fn(), ungroup: vi.fn(),
      setLocked: vi.fn(), addImage: vi.fn(), replaceImage: vi.fn(),
      update: (_id: string, patch: object) => wrote.push(...Object.keys(patch)),
    };
    const { container } = render(
      <Inspector activeSection="graphs" selection={{ kind: "annotation", id: "c1" } as never}
        plot={{ ...plot, annotations: [CALLOUT] } as Plot} table={table} userPresets={[]} profileDefault={null}
        onSelect={vi.fn()}
        onSetAxis={vi.fn()} onSetAxisLength={vi.fn()} onSetAxisTitleFont={vi.fn()}
        onSetSeriesStyle={vi.fn()} onSetSeriesStyleAll={vi.fn()} onSetPointStyle={vi.fn()} onClearPointStyles={vi.fn()}
        onSetGrid={vi.fn()} onSetFrame={vi.fn()} onSetKind={vi.fn()} onSetBarLayout={vi.fn()} onSetBarShape={vi.fn()} onSetBoxWhisker={vi.fn()}
        onSetPlotOptions={vi.fn()} onSetGraphTitle={vi.fn()} onSetPlotFont={vi.fn()} onHomogenizeFont={vi.fn()}
        onSetLegend={vi.fn()} onSetSignificance={vi.fn()} onApplyPreset={vi.fn()}
        onApplyUserPreset={vi.fn()} onSaveUserPreset={vi.fn()} onDeleteUserPreset={vi.fn()} onSetProfileDefault={vi.fn()}
        annotationOps={ops} />,
    );
    const fillInput = container.querySelector<HTMLInputElement>('input[type="color"][aria-label="Fill colour"]');
    expect(fillInput, "the callout editor has no Fill row").not.toBeNull();
    fireEvent.change(fillInput!, { target: { value: "#ffcc00" } });
    expect(wrote).toContain("fill");
  });
});
