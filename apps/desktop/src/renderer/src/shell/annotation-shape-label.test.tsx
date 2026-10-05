// @vitest-environment jsdom
// Every shape annotation draws its label, so every one must be able to set it.
//
// `Annotation` fields live in an array (`annotations`), so the generic per-option tests cannot
// drive them; this file checks two of them per annotation kind:
//
//   `label` — all six shapes (box · highlight · ellipse · arrow · line · callout) render a real
//     `<text>` carrying it, so the editor must offer a Text row on every one, not only on the
//     callout.
//   `size`  — it scales that label on all six, so each labelled shape needs a size row.
//
// Both halves per kind: the field moves the drawing, and a row on the editor writes it.
//
// `fillOpacity` is not checked here: its row appears once a fill is set, so a fixture without
// `fill` does not show it.
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
/** The words the figure actually draws — not the markup, the readable text. */
const drawnText = (html: string): string[] =>
  [...html.matchAll(/<text\b[^>]*>([^<]*)</g)].map((m) => m[1]!.trim()).filter(Boolean);

const SHAPES = ["rect", "highlight", "ellipse", "arrow", "segment", "callout"] as const;
const geomFor = (kind: string): Record<string, number> =>
  kind === "arrow" || kind === "segment" || kind === "callout"
    ? { x: 0.2, y: 0.2, x2: 0.6, y2: 0.6 }
    : { x: 0.3, y: 0.3, w: 0.2, h: 0.2 };

/** Render the annotation editor for `a` and return every labelled row it offers. */
function editorRows(a: Annotation): { rows: string[]; drive: (label: string) => string[] } {
  const { plot, table } = fixture();
  const wrote: string[] = [];
  const ops = {
    add: vi.fn(), remove: vi.fn(), reorder: vi.fn(), align: vi.fn(), group: vi.fn(), ungroup: vi.fn(),
    setLocked: vi.fn(), addImage: vi.fn(), replaceImage: vi.fn(),
    update: (_id: string, patch: object) => wrote.push(...Object.keys(patch)),
  };
  const { container } = render(
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
  const rows = [...container.querySelectorAll("label > span:first-child")].map((e) => (e.textContent ?? "").trim()).filter(Boolean);
  const drive = (label: string): string[] => {
    wrote.length = 0;
    for (const lab of container.querySelectorAll("label")) {
      if ((lab.querySelector("span:first-child")?.textContent ?? "").trim() !== label) continue;
      const txt = lab.querySelector<HTMLInputElement>('input[type="text"]');
      const num = lab.querySelector<HTMLInputElement>('input[type="number"]');
      if (txt) fireEvent.change(txt, { target: { value: "REGION-A" } });
      else if (num) fireEvent.change(num, { target: { value: "20" } });
      break;
    }
    return [...wrote];
  };
  return { rows, drive };
}

describe("a shape annotation can set the label it draws", () => {
  for (const kind of SHAPES) {
    const bare = { id: "a", kind, ...geomFor(kind) } as Annotation;
    const labelled = { ...bare, label: "REGION-A" } as Annotation;

    it(`${kind}: draws the label, and a Text row writes it`, () => {
      // The drawing half first — a control for something the figure ignores is worse than none.
      expect(drawnText(render1(labelled)), `a ${kind} does not draw its label`).toContain("REGION-A");
      expect(drawnText(render1(bare)), `a ${kind} invents a label from nowhere`).not.toContain("REGION-A");

      const e = editorRows(bare);
      expect(e.rows, `a ${kind} draws a label but its editor has no Text row`).toContain("Text");
      expect(e.drive("Text"), `the ${kind} Text row wrote nothing`).toContain("label");
    });

    it(`${kind}: once labelled, a Text size row scales it`, () => {
      expect(render1({ ...labelled, size: 10 } as Annotation),
        `a ${kind}'s label ignores \`size\``).not.toBe(render1({ ...labelled, size: 28 } as Annotation));

      const e = editorRows(labelled);
      expect(e.rows, `a labelled ${kind} has no Text size row`).toContain("Text size");
      expect(e.drive("Text size"), `the ${kind} Text size row wrote nothing`).toContain("size");
    });

    it(`${kind}: with no label there is nothing to size, so no size row`, () => {
      expect(editorRows(bare).rows,
        `an unlabelled ${kind} offers a Text size row that sizes nothing`).not.toContain("Text size");
    });
  }
});
