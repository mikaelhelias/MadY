// @vitest-environment jsdom
/**
 * The 3-D scatter's axes and grid can be reached by clicking them.
 *
 * X/Y/Z titles, axis colour, axis thickness, Floor grid on/off and Grid colour live in the
 * **3-D scatter** section. The drawing must route to them: without routing, a click on an axis
 * or the grid falls through to the <svg> and selects the whole plot, landing in the
 * graph-title fields.
 *
 * This guard checks both halves: the click reaches its target, and the section really owns
 * those controls.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import type { Plot } from "@mady/core";
import { buildPlotScene } from "@mady/graphics";
import { PlotFigure } from "./PlotFigure";
import { Inspector } from "./Inspector";
import { galleryItems } from "./gallery";
import type { GraphSelection } from "./AppShell";

afterEach(cleanup);
const SIZE = { width: 580, height: 380 };
const card = () => galleryItems().find((x) => (x.plot.kind ?? "xy") === "scatter3d")!;
const scene = () => buildPlotScene(card().table, card().plot as Plot, SIZE);
const SECTION: GraphSelection = { kind: "chart-section", title: "3-D scatter" };

const handlers = () => ({
  onSelect: vi.fn(), onSetAxis: vi.fn(), onSetAxisLength: vi.fn(), onSetAxisTitleFont: vi.fn(),
  onSetSeriesStyle: vi.fn(), onSetSeriesStyleAll: vi.fn(), onSetPointStyle: vi.fn(), onClearPointStyles: vi.fn(),
  onSetGrid: vi.fn(), onSetFrame: vi.fn(), onSetKind: vi.fn(), onSetBarLayout: vi.fn(), onSetBarShape: vi.fn(), onSetBoxWhisker: vi.fn(),
  onSetPlotOptions: vi.fn(), onSetGraphTitle: vi.fn(), onSetPlotFont: vi.fn(), onHomogenizeFont: vi.fn(),
  onSetLegend: vi.fn(), onSetSignificance: vi.fn(), onApplyPreset: vi.fn(), 
  onApplyUserPreset: vi.fn(), onSaveUserPreset: vi.fn(), onDeleteUserPreset: vi.fn(), onSetProfileDefault: vi.fn(),
  annotationOps: { add: vi.fn(), update: vi.fn(), remove: vi.fn(), reorder: vi.fn(), align: vi.fn(), group: vi.fn(), ungroup: vi.fn(), setLocked: vi.fn(), addImage: vi.fn(), replaceImage: vi.fn() },
});

/** The three axis edges are the lines that start at the cube's origin corner; the floor grid
 *  the hairlines elsewhere. (Width alone is not enough: the tick marks share the axis stroke,
 *  so "thick" matches 17 lines, not 3.) */
function lines(container: HTMLElement): { axes: Element[]; grid: Element[] } {
  const all = [...container.querySelectorAll("line")];
  const s = scene().scatter3d!;
  const o = { x: s.axes[0]!.x1, y: s.axes[0]!.y1 };
  const at = (l: Element, a: string): number => Number(l.getAttribute(a));
  // …and long: the first tick's 4px mark also starts at the origin corner.
  const isEdge = (l: Element): boolean =>
    Math.abs(at(l, "x1") - o.x) < 0.01 && Math.abs(at(l, "y1") - o.y) < 0.01 &&
    Math.hypot(at(l, "x2") - at(l, "x1"), at(l, "y2") - at(l, "y1")) > 20;
  const w = (l: Element): number => Number(l.getAttribute("stroke-width") ?? 1);
  return { axes: all.filter(isEdge), grid: all.filter((l) => !isEdge(l) && w(l) <= 1.2) };
}

describe("the fixture can exhibit it", () => {
  it("the 3-D card draws three axes and a floor grid", () => {
    const { container } = render(<PlotFigure scene={scene()} zoom={1} onSelect={vi.fn()} onCamera3D={vi.fn()} />);
    const l = lines(container);
    expect(l.axes.length, "no axis lines").toBe(3);
    expect(l.grid.length, "no floor grid").toBeGreaterThan(4);
  });
});

describe("clicking an axis / the grid opens the controls that edit them", () => {
  const clickFirst = (pick: "axes" | "grid", movePx = 0): GraphSelection[] => {
    const got: GraphSelection[] = [];
    const s = scene();
    const { container } = render(
      <PlotFigure scene={s} zoom={1} onSelect={(x) => got.push(x)} onCamera3D={vi.fn()} onMoveAxisTitle={vi.fn()} />,
    );
    const el = lines(container)[pick][0]!;
    const svg = container.querySelector("svg")!;
    fireEvent.pointerDown(el, { clientX: 100, clientY: 100, pointerId: 1 });
    if (movePx) fireEvent.pointerMove(svg, { clientX: 100 + movePx, clientY: 100, pointerId: 1 });
    fireEvent.pointerUp(svg, { clientX: 100 + movePx, clientY: 100, pointerId: 1 });
    fireEvent.click(el, { clientX: 100 + movePx, clientY: 100 });
    cleanup();
    return got;
  };

  /** The cube edges are real axes (range/scale/ticks on the x/y/z AxisSpecs), so clicking
   *  one selects that axis and lights the Axis tab — the same contract as every 2-D chart.
   *  The floor grid opens the 3-D section, which owns it. */
  it("an axis line selects its axis", () => {
    expect(clickFirst("axes")).toContainEqual({ kind: "axis", axis: "x" });
  });

  it("a floor-grid line", () => {
    expect(clickFirst("grid")).toContainEqual(SECTION);
  });

  /** A small wobble during a click must not be read as a camera drag. */
  it("…and a click that moves 4px still opens it, instead of orbiting", () => {
    expect(clickFirst("axes", 4), "an ordinary click on the axis was read as a camera drag").toContainEqual({ kind: "axis", axis: "x" });
  });

  it("an axis label opens it too", () => {
    const got: GraphSelection[] = [];
    const s = scene();
    const { container } = render(
      <PlotFigure scene={s} zoom={1} onSelect={(x) => got.push(x)} onCamera3D={vi.fn()} onMoveAxisTitle={vi.fn()} />,
    );
    const label = [...container.querySelectorAll("text")].find((t) => (t.textContent ?? "").trim() === s.scatter3d!.axes[0]!.label)!;
    fireEvent.pointerDown(label, { clientX: 100, clientY: 100, pointerId: 1 });
    fireEvent.pointerUp(label, { clientX: 100, clientY: 100, pointerId: 1 });
    cleanup();
    // As with the edges, the name selects its axis.
    expect(got).toContainEqual({ kind: "axis", axis: "x" });
  });
});

describe("…and that section really owns those controls", () => {
  it("it offers the axis titles, axis colour + thickness, and the grid", () => {
    const g = card();
    const { container } = render(
      <Inspector activeSection="graphs" selection={SECTION} plot={g.plot as Plot} table={g.table}
        userPresets={[]} profileDefault={null} {...handlers()} />,
    );
    const rows = [...container.querySelectorAll(".frow > span:first-child")].map((e) => (e.textContent ?? "").trim());
    cleanup();
    for (const want of ["X axis title", "Y axis title", "Z axis title", "Axis colour", "Axis thickness", "Floor grid", "Grid colour"]) {
      expect(rows, `the 3-D section lost its "${want}" control`).toContain(want);
    }
  });

  it("the grid controls REACH the drawing — the option is not merely present", () => {
    const g = card();
    const draw = (patch: Partial<Plot>): string => {
      const s = buildPlotScene(g.table, { ...g.plot, ...patch } as Plot, SIZE);
      const { container } = render(<PlotFigure scene={s} zoom={1} onSelect={vi.fn()} onCamera3D={vi.fn()} />);
      const html = container.innerHTML;
      cleanup();
      return html;
    };
    const base = draw({});
    const off = draw({ scatter3d: { ...(g.plot.scatter3d ?? {}), showGrid: false } } as Partial<Plot>);
    const pink = draw({ scatter3d: { ...(g.plot.scatter3d ?? {}), gridColor: "#ff00ff" } } as Partial<Plot>);
    expect(off, "turning the floor grid off changed nothing").not.toBe(base);
    expect(pink.includes("#ff00ff"), "the grid colour never reached the drawing").toBe(true);
  });
});
