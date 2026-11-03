// @vitest-environment jsdom
// Image-panel crop + rotate. Besides contain/cover/fill, an image panel can be cropped and
// turned, so a micrograph with a scale bar in the wrong corner, or scanned sideways, is fixed
// in place. This holds the whole spine: the crop/rotate fields reach the scene, the
// renderer really shows only the cropped window (at the right aspect), and the Inspector's
// controls write them — a field without a control, or a control without a drawing, both fail.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import type { DataTable, Plot } from "@mady/core";
import { buildPlotScene } from "@mady/graphics";
import { PlotFigure } from "./PlotFigure";
import { Inspector } from "./Inspector";

afterEach(cleanup);

const table: DataTable = {
  id: "t", kind: "xy", name: "T",
  columns: [{ id: "x", name: "X", role: "x" }, { id: "y", name: "Y", role: "y" }],
  rows: [{ id: "r1", cells: { x: 1, y: 2 } }],
};
const PIXEL = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

function imagePlot(over: Partial<NonNullable<Plot["image"]>> = {}): Plot {
  return {
    id: "p", name: "Micrograph", source: "t", status: "ok", styleOverrides: {}, kind: "image",
    image: { src: PIXEL, naturalWidth: 200, naturalHeight: 100, ...over },
  };
}

describe("image panel crop/rotate — scene passthrough", () => {
  it("crop, rotate and the natural size all reach scene.image", () => {
    const scene = buildPlotScene(table, imagePlot({ rotate: 90, crop: { x: 0.25, y: 0, w: 0.5, h: 1 } }));
    expect(scene.image?.rotate).toBe(90);
    expect(scene.image?.crop).toEqual({ x: 0.25, y: 0, w: 0.5, h: 1 });
    expect(scene.image?.naturalWidth).toBe(200);
    expect(scene.image?.naturalHeight).toBe(100);
  });
});

describe("image panel crop/rotate — the drawing", () => {
  it("a crop draws only the cropped window of the source (nested viewBox in source px)", () => {
    const scene = buildPlotScene(table, imagePlot({ crop: { x: 0.25, y: 0, w: 0.5, h: 1 } }));
    const { container } = render(<PlotFigure scene={scene} selected={null} zoom={1} />);
    const inner = container.querySelector("svg.gfx-figure svg");
    expect(inner, "crop must nest the image in a windowing <svg>").toBeTruthy();
    // 0.25..0.75 of a 200px-wide source → viewBox x=50 w=100; full height → y=0 h=100
    expect(inner!.getAttribute("viewBox")).toBe("50 0 100 100");
    const img = inner!.querySelector("image")!;
    expect(Number(img.getAttribute("width"))).toBe(200);
    expect(Number(img.getAttribute("height"))).toBe(100);
  });

  it("rotate 90 swaps the displayed frame and rotates the bitmap inside it", () => {
    const scene = buildPlotScene(table, imagePlot({ rotate: 90 }));
    const { container } = render(<PlotFigure scene={scene} selected={null} zoom={1} />);
    const inner = container.querySelector("svg.gfx-figure svg")!;
    // displayed space of a rotated 200×100 source is 100×200
    expect(inner.getAttribute("viewBox")).toBe("0 0 100 200");
    const g = inner.querySelector("g")!;
    expect(g.getAttribute("transform")).toContain("rotate(90");
  });

  it("no crop and no rotate keeps the plain single-<image> drawing (saved panels look the same)", () => {
    const scene = buildPlotScene(table, imagePlot());
    const { container } = render(<PlotFigure scene={scene} selected={null} zoom={1} />);
    expect(container.querySelector("svg.gfx-figure svg")).toBeNull();
    const img = container.querySelector("svg.gfx-figure image")!;
    expect(img.getAttribute("preserveAspectRatio")).toBe("xMidYMid meet");
  });
});

describe("image panel crop/rotate — the Inspector controls", () => {
  function renderInspector(plot: Plot) {
    const onSetPlotOptions = vi.fn();
    const h = {
      onSelect: vi.fn(), onSetAxis: vi.fn(), onSetAxisLength: vi.fn(), onSetAxisTitleFont: vi.fn(),
      onSetSeriesStyle: vi.fn(), onSetSeriesStyleAll: vi.fn(), onSetPointStyle: vi.fn(), onClearPointStyles: vi.fn(),
      onSetGrid: vi.fn(), onSetFrame: vi.fn(), onSetKind: vi.fn(), onSetBarLayout: vi.fn(), onSetBarShape: vi.fn(), onSetBoxWhisker: vi.fn(),
      onSetPlotOptions, onSetGraphTitle: vi.fn(), onSetPlotFont: vi.fn(), onHomogenizeFont: vi.fn(),
      onSetLegend: vi.fn(), onSetSignificance: vi.fn(), onApplyPreset: vi.fn(), 
      onApplyUserPreset: vi.fn(), onSaveUserPreset: vi.fn(), onDeleteUserPreset: vi.fn(), onSetProfileDefault: vi.fn(),
      annotationOps: { add: vi.fn(), update: vi.fn(), remove: vi.fn(), reorder: vi.fn(), align: vi.fn(), group: vi.fn(), ungroup: vi.fn(), setLocked: vi.fn(), addImage: vi.fn(), replaceImage: vi.fn() },
    };
    const { container } = render(
      <Inspector activeSection="graphs" selection={{ kind: "plot" }} plot={plot} table={table}
        userPresets={[]} profileDefault={null} wholeGraph={false} onSetWholeGraph={() => {}} {...h} />,
    );
    return { container, onSetPlotOptions };
  }

  it("Rotate writes image.rotate", () => {
    const { container, onSetPlotOptions } = renderInspector(imagePlot());
    const rot = [...container.querySelectorAll("label")].find((l) => (l.querySelector("span:first-child")?.textContent ?? "").trim() === "Rotate");
    expect(rot, "no Rotate control on the image panel").toBeTruthy();
    fireEvent.change(rot!.querySelector("select")!, { target: { value: "90" } });
    expect(onSetPlotOptions).toHaveBeenCalled();
    const patch = onSetPlotOptions.mock.calls.at(-1)![0] as { image: { rotate?: number } };
    expect(patch.image.rotate).toBe(90);
  });

  it("Crop % inputs write image.crop (left+right → x/w)", () => {
    const { container, onSetPlotOptions } = renderInspector(imagePlot());
    const left = container.querySelector<HTMLInputElement>('input[aria-label="Crop left %"]');
    expect(left, "no crop inputs on the image panel").toBeTruthy();
    fireEvent.change(left!, { target: { value: "25" } });
    const patch = onSetPlotOptions.mock.calls.at(-1)![0] as { image: { crop?: { x: number; w: number } } };
    expect(patch.image.crop?.x).toBeCloseTo(0.25);
    expect(patch.image.crop?.w).toBeCloseTo(0.75);
  });
});
