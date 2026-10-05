// @vitest-environment jsdom
/**
 * The legend's frame, paper and padding.
 *
 * `border` and `background` are on/off switches; the frame colour, thickness, corner radius, box
 * fill and padding are separate fields, so a figure on tinted paper, or a journal that wants a
 * hairline key box, can set them. The defaults are a 1 px `var(--line)` stroke, a `var(--bg)`
 * fill, a 4 px corner radius and a 6 px pad.
 *
 * Every field falls back to that default look. Rule: a new parameter must not change the current
 * defaults or any existing preset. The "unset" tests below catch such a change;
 * `preset-invariance.test.ts` covers the same ground across all six built-ins × every gallery
 * card.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { MadyDocument, findPreset } from "@mady/core";
import type { DataTable, LegendSpec, Plot, Project, StylePreset } from "@mady/core";
import { buildPlotScene } from "@mady/graphics";
import { PlotFigure } from "./PlotFigure";

afterEach(cleanup);

const measure = (t: string, px: number): number => t.length * px * 0.6;
const SIZE = { width: 520, height: 360 };
const table: DataTable = {
  id: "t", kind: "xy", name: "t",
  columns: [
    { id: "x", name: "Dose", role: "x", type: "number" },
    { id: "a", name: "Drug A", role: "y", type: "number" },
    { id: "b", name: "Drug B", role: "y", type: "number" },
  ],
  rows: [0, 1, 2, 3].map((i) => ({ id: `r${i}`, cells: { x: i, a: i * 2 + 1, b: i * 1.4 } })),
};
const plotWith = (legend: LegendSpec): Plot =>
  ({ id: "p", name: "p", source: "t", status: "ok", styleOverrides: {}, kind: "xy", legend } as unknown as Plot);
const scene = (legend: LegendSpec) => buildPlotScene(table, plotWith(legend), { measure, ...SIZE });
/** The one <rect> that draws the frame + fill (the drag hit-rect before it is transparent). */
const frame = (legend: LegendSpec): SVGRectElement => {
  const { container } = render(<PlotFigure scene={scene(legend)} />);
  const rects = [...container.querySelectorAll(".gfx-legend rect")] as SVGRectElement[];
  return rects.find((r) => r.getAttribute("fill") !== "transparent")!;
};

const FRAMED: LegendSpec = { show: true, border: true, background: true };

describe("the legend frame keeps its default look unless asked otherwise", () => {
  /** The default is the fixed default look, exactly. */
  it("an untouched legend keeps the 1px line, paper fill and 4px radius", () => {
    const r = frame(FRAMED);
    expect(r.getAttribute("stroke")).toBe("var(--line)");
    expect(r.getAttribute("fill")).toBe("var(--bg)");
    expect(r.getAttribute("stroke-width")).toBe("1");
    expect(r.getAttribute("rx")).toBe("4");
  });

  it("and the scene carries none of the optional frame fields until one is set", () => {
    const L = scene(FRAMED).legendLayout;
    for (const k of ["borderColor", "borderWidth", "borderRadius", "backgroundColor", "padding"] as const) {
      expect(L[k], `${k} appeared on an untouched legend`).toBeUndefined();
    }
  });

  it("honours a frame colour, thickness and radius", () => {
    const r = frame({ ...FRAMED, borderColor: "#883399", borderWidth: 2.5, borderRadius: 0 });
    expect(r.getAttribute("stroke")).toBe("#883399");
    expect(r.getAttribute("stroke-width")).toBe("2.5");
    expect(r.getAttribute("rx")).toBe("0");
  });

  it("honours a box fill", () => {
    expect(frame({ ...FRAMED, backgroundColor: "#FFF3E0" }).getAttribute("fill")).toBe("#FFF3E0");
  });

  /** A colour set while its switch is off must stay off — the switch decides whether, the colour what. */
  it("does not draw a frame just because a frame colour was set", () => {
    const r = frame({ show: true, background: true, borderColor: "#883399" });
    expect(r.getAttribute("stroke")).toBe("none");
  });
});

describe("box padding", () => {
  it("grows the drawn box", () => {
    const box = (legend: LegendSpec): number => Number(frame(legend).getAttribute("height"));
    expect(box({ ...FRAMED, padding: 20 })).toBeGreaterThan(box(FRAMED) + 20);
  });

  /**
   * And the margin that holds it. The margin reservation includes an allowance for the box's own
   * padding; growing the pad without growing that allowance pushes the rows under the figure's
   * edge — the same rule the `LegendSpec.symbolScale` note in the model describes.
   */
  it("grows the outside-right margin with it, so the rows stay on the figure", () => {
    const plotW = (legend: LegendSpec): number => scene(legend).plot.width;
    expect(plotW({ show: true, padding: 24 }), "a bigger pad did not reserve more room").toBeLessThan(plotW({ show: true }));
  });

  it("leaves the reservation exactly as it was when no padding is set", () => {
    // The default allowance is a literal 10, not 2 × the 6px pad — keeping it leaves every
    // existing figure's margin unchanged.
    expect(scene({ show: true }).plot.width).toBe(scene({ show: true, padding: 5 }).plot.width);
  });
});

describe("a preset can carry the legend's look", () => {
  const applied = (preset: StylePreset): Plot => {
    const p = plotWith({ show: true, border: true });
    const project: Project = { schemaVersion: 4, tables: [table], plots: [p], analyses: [], log: [], workspace: { folders: [], loose: [] } };
    const doc = new MadyDocument(project);
    doc.applyStylePreset(p.id, preset);
    return doc.toJSON().plots[0]!;
  };
  const house = (): StylePreset => findPreset("MadY default")!;

  it("merges the preset's legend over the graph's own", () => {
    const out = applied({ ...house(), name: "t", legend: { borderColor: "#123456", padding: 9 } });
    expect(out.legend?.borderColor).toBe("#123456");
    expect(out.legend?.padding).toBe(9);
    // …and does not wipe what the graph already had.
    expect(out.legend?.border, "the merge dropped the graph's own legend settings").toBe(true);
  });

  /** A preset that says nothing about the legend must leave every field of it alone. */
  it("leaves the legend untouched when the preset carries none", () => {
    const out = applied(house());
    expect(out.legend).toEqual({ show: true, border: true });
  });

  /**
   * Only "Universal design" may carry one, by design: its legend gets the same warm paper
   * as the figure. Any other name here is a preset changing its
   * look unannounced.
   */
  it("only Universal design carries a legend look", () => {
    const offenders = [findPreset("MadY default"), findPreset("Scientific Journal"), findPreset("Bold infographic"),
      findPreset("Editorial"), findPreset("Grayscale (print)")]
      .filter((p) => p?.legend !== undefined).map((p) => p!.name);
    expect(offenders, `these presets must not set a legend look: ${offenders.join(", ")}`).toEqual([]);
    // …and the exception is real: Universal design carries its warm paper.
    expect(findPreset("Universal design")?.legend?.backgroundColor?.toUpperCase()).toBe("#FFFEFD");
  });
});
