// @vitest-environment jsdom
/**
 * A heatmap's axis titles can be styled, not only typed.
 *
 * The Heatmap section offers "Column axis title" and "Row axis title" text boxes, and a matrix
 * heatmap has no Axis tab, so the per-axis title font (size, bold, italic, family, colour) and the
 * row title's gap need controls in the Heatmap section — the drawing applies every one of them.
 *
 * Each control is pressed in the real panel, the patch it sends is applied to the plot, and the
 * scene is rebuilt to read the value back from what is drawn.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import type { AxisSpec, FontSpec, Plot } from "@mady/core";
import { buildPlotScene } from "@mady/graphics";
import { Inspector } from "./Inspector";
import { galleryItems } from "./gallery";

afterEach(cleanup);

function renderPanel(plot: Plot) {
  const item = galleryItems().find((i) => i.plot.kind === "heatmap")!;
  const noop = vi.fn();
  const onSetAxisTitleFont = vi.fn<(axis: "x" | "y" | "y2" | "y3", patch: Partial<FontSpec>) => void>();
  const onSetAxis = vi.fn<(axis: string, patch: Partial<AxisSpec>) => void>();
  const h = {
    onSelect: noop, onSetAxis, onSetAxisLength: noop, onSetAxisTitleFont,
    onSetSeriesStyle: noop, onSetSeriesStyleAll: noop, onSetPointStyle: noop, onClearPointStyles: noop,
    onSetGrid: noop, onSetFrame: noop, onSetKind: noop, onSetBarLayout: noop, onSetBarShape: noop, onSetBoxWhisker: noop,
    onSetPlotOptions: noop, onSetGraphTitle: noop, onSetPlotFont: noop, onHomogenizeFont: noop,
    onSetLegend: noop, onSetSignificance: noop, onApplyPreset: noop,
    onApplyUserPreset: noop, onSaveUserPreset: noop, onDeleteUserPreset: noop, onSetProfileDefault: noop,
    annotationOps: { add: noop, update: noop, remove: noop, reorder: noop, align: noop, group: noop, ungroup: noop, setLocked: noop, addImage: noop, replaceImage: noop },
  };
  const { container } = render(
    <Inspector activeSection="graphs" selection={{ kind: "plot" }} plot={plot} table={item.table} userPresets={[]} profileDefault={null} wholeGraph={false} onSetWholeGraph={noop} {...h} />,
  );
  return { container, onSetAxisTitleFont, onSetAxis, table: item.table };
}

/** The rows under one FontControls heading, by their row label. */
function fontRows(c: HTMLElement, heading: string): Map<string, HTMLElement> {
  const head = [...c.querySelectorAll(".inspsub")].find((d) => d.textContent === heading);
  const rows = new Map<string, HTMLElement>();
  let el = head?.nextElementSibling ?? null;
  while (el && el.classList.contains("frow")) {
    rows.set(el.querySelector(":scope > span")?.textContent ?? "", el as HTMLElement);
    el = el.nextElementSibling;
  }
  return rows;
}

const titled = (): Plot => {
  const p = galleryItems().find((i) => i.plot.kind === "heatmap")!.plot;
  return { ...p, xAxis: { ...(p.xAxis ?? {}), title: "Samples" }, yAxis: { ...(p.yAxis ?? {}), title: "Genes" } };
};

describe("heatmap axis titles — styled from the Heatmap section", () => {
  it("every title font control reaches the drawing, on both titles", () => {
    for (const [heading, axis, sceneFont] of [["Column title font", "x", "xAxisTitle"], ["Row title font", "y", "yAxisTitle"]] as const) {
      const plot = titled();
      const { container, onSetAxisTitleFont, table } = renderPanel(plot);
      const rows = fontRows(container, heading);
      expect([...rows.keys()]).toEqual(["Font", "Size", "Style", "Colour"]);
      fireEvent.change(rows.get("Size")!.querySelector("input")!, { target: { value: "31" } });
      const [bold, italic] = [...rows.get("Style")!.querySelectorAll('input[type="checkbox"]')] as HTMLInputElement[];
      fireEvent.click(bold!);
      fireEvent.click(italic!);
      const fam = rows.get("Font")!.querySelector("select")!;
      const famValue = [...fam.options].map((o) => o.value).find((v) => v)!;
      fireEvent.change(fam, { target: { value: famValue } });
      fireEvent.click(rows.get("Colour")!.nextElementSibling!.querySelector("button")!); // first swatch

      expect(onSetAxisTitleFont.mock.calls.every(([a]) => a === axis)).toBe(true);
      const patch = Object.assign({}, ...onSetAxisTitleFont.mock.calls.map(([, p]) => p)) as FontSpec;
      const spec = axis === "x" ? plot.xAxis : plot.yAxis;
      const next = { ...plot, [axis === "x" ? "xAxis" : "yAxis"]: { ...spec, titleFont: patch } } as Plot;
      const before = buildPlotScene(table, plot, {}).fonts[sceneFont];
      const drawn = buildPlotScene(table, next, {}).fonts[sceneFont];
      expect(drawn.size).toBe(31);
      expect(drawn.weight).toBe(700);
      expect(drawn.italic).toBe(true);
      expect(drawn.family).not.toBe(before.family);
      expect(drawn.color).toBe(patch.color);
      expect(drawn.color).toBeTruthy();
      cleanup();
    }
  });

  it("the row title's gap reaches the drawing", () => {
    const plot = titled();
    const { container, onSetAxis, table } = renderPanel(plot);
    const span = [...container.querySelectorAll(".frow > span")].find((s) => s.textContent === "Row title ↔ labels")!;
    fireEvent.change(span.parentElement!.querySelector("input")!, { target: { value: "30" } });
    expect(onSetAxis).toHaveBeenCalledWith("y", { titleGap: 30 });
    const next = { ...plot, yAxis: { ...plot.yAxis, titleGap: 30 } } as Plot;
    // The gap is the space between the title and what stands right of it: the title keeps its place at
    // the left edge and the names + grid move over by the difference (30 − the default 6).
    const room = (p: Plot) => { const s = buildPlotScene(table, p, {}); return s.plot.x - s.y.titlePos!; };
    expect(room(next) - room(plot)).toBeCloseTo(24, 0);
  });

  it("no title, no title-styling rows (nothing to letter)", () => {
    const p = galleryItems().find((i) => i.plot.kind === "heatmap")!.plot;
    const plot = { ...p, xAxis: { ...(p.xAxis ?? {}), title: undefined }, yAxis: { ...(p.yAxis ?? {}), title: undefined } } as Plot;
    const { container } = renderPanel(plot);
    expect(fontRows(container, "Column title font").size).toBe(0);
    expect(fontRows(container, "Row title font").size).toBe(0);
    // …while the text boxes to type one are there.
    expect([...container.querySelectorAll(".frow > span")].some((s) => s.textContent === "Column axis title")).toBe(true);
  });

  /**
   * Guards against the row title sitting on top of the row names. The shared post-pass anchors a
   * Y title left of the axis's tick labels; a matrix heatmap has none (its row names are its own
   * layer), so without its own placement the anchor would fall back to the grid's edge. Measured here against where
   * the renderer draws the row names (right-aligned at plot.x − 6 − the strip inset), with the same
   * text measure the builder was given, over every gallery heatmap, at two title sizes and two gaps.
   */
  it("the row title clears the row names on every gallery heatmap", () => {
    const measure = (t: string, px: number): number => t.length * px * 0.6;
    const hits: string[] = [];
    let checked = 0;
    for (const item of galleryItems().filter((i) => i.plot.kind === "heatmap" && (i.plot.heatmap?.mode ?? "matrix") === "matrix")) {
      for (const size of [15, 30]) {
        for (const gap of [undefined, 20]) {
          const plot = { ...item.plot, yAxis: { ...(item.plot.yAxis ?? {}), title: "Genes", titleFont: { size }, ...(gap !== undefined ? { titleGap: gap } : {}) } } as Plot;
          const s = buildPlotScene(item.table, plot, { measure, width: 640, height: 460 });
          const hm = s.heatmap!;
          const lsize = hm.labelFont?.size ?? Math.min(s.fonts.tick.size, 12);
          const right = s.plot.x - 6 - (hm.labelInset?.left ?? 0);
          const namesLeft = Math.min(...hm.rowLabels.filter((r) => r.label).map((r) => right - measure(r.label, lsize)));
          const x = s.y.titlePos!;
          // A −90° title: glyph tops reach `ascent` to the left of its anchor, descenders to the right.
          const glyphRight = x + s.fonts.yAxisTitle.size * 0.27;
          const glyphLeft = x - s.fonts.yAxisTitle.size * 1.08;
          checked++;
          if (glyphRight > namesLeft - (gap ?? 6) + 0.5 || glyphLeft < -0.5)
            hits.push(`"${item.plot.name}" size ${size} gap ${gap ?? "auto"}: title ${glyphLeft.toFixed(1)}–${glyphRight.toFixed(1)}, names start ${namesLeft.toFixed(1)}`);
        }
      }
    }
    expect(checked).toBeGreaterThanOrEqual(8);
    expect(hits).toEqual([]);
  });
});
