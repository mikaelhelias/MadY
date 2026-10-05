// @vitest-environment jsdom
// Colour-blind preview (View ▸ Colour-blind preview): the whole graph or figure seen as
// a deuteranope / protanope / tritanope / a greyscale printer would. Screen only.
//
// The one thing that must never happen: the filter reaching an export. The export clones the
// `svg.gfx-figure` alone, so the filter rides on the pane's wrapper and this file proves the
// serialized export carries neither the filter reference nor any `filter` at all while the
// preview is on. Moving the filter onto the svg makes these tests fail.
import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, render, renderHook } from "@testing-library/react";
import { createSampleDocument } from "@mady/core";
import { visionMatrixValues } from "@mady/graphics";
import { COLOR_VISION_KEY, GraphPane, LayoutPane, useColorVisionPref } from "./panes";
import { ColorVisionDefs } from "./ColorVisionDefs";
import { serializeGraphSvg } from "./exporters";
import { composeActiveFigureSvg } from "./ExportDialog";
import { proj } from "./layoutPaneFixture";

afterEach(() => { cleanup(); localStorage.removeItem(COLOR_VISION_KEY); });

describe("the preference", () => {
  it("is off by default, round-trips, and syncs a second instance", () => {
    const a = renderHook(() => useColorVisionPref());
    const b = renderHook(() => useColorVisionPref());
    expect(a.result.current.value).toBe("off");
    act(() => a.result.current.set("protanopia"));
    expect(localStorage.getItem(COLOR_VISION_KEY)).toBe("protanopia");
    expect(b.result.current.value).toBe("protanopia");
    act(() => b.result.current.set("off"));
    expect(a.result.current.value).toBe("off");
  });
});

describe("the filter definitions", () => {
  it("define the four kinds in linear light with the shared matrix", () => {
    const { container } = render(<ColorVisionDefs />);
    const filters = [...container.querySelectorAll("filter")];
    expect(filters.map((f) => f.id)).toEqual(["mady-cvd-deuteranopia", "mady-cvd-protanopia", "mady-cvd-tritanopia", "mady-cvd-grayscale"]);
    for (const f of filters) {
      expect(f.getAttribute("color-interpolation-filters")).toBe("linearRGB");
      expect(f.querySelector("feColorMatrix")!.getAttribute("values")).toBe(visionMatrixValues(f.id.replace("mady-cvd-", "") as never));
    }
  });
});

describe("a graph pane", () => {
  const mount = () => {
    const doc = createSampleDocument();
    const plot = doc.toJSON().plots[0]!;
    return render(<GraphPane project={doc.toJSON()} plotId={plot.id} />);
  };
  it("carries the filter on its wrapper when the preview is on, and nothing when off", () => {
    const off = mount();
    expect((off.container.querySelector(".graphzoom") as HTMLElement).style.filter).toBe("");
    cleanup();
    localStorage.setItem(COLOR_VISION_KEY, "deuteranopia");
    const on = mount();
    expect((on.container.querySelector(".graphzoom") as HTMLElement).style.filter).toContain("mady-cvd-deuteranopia");
  });
  it("the export never carries the filter while the preview is on", () => {
    localStorage.setItem(COLOR_VISION_KEY, "deuteranopia");
    const { container } = mount();
    const svg = container.querySelector("svg.gfx-figure") as SVGSVGElement;
    const out = serializeGraphSvg(svg, { background: "white" }).svg;
    expect(out).not.toMatch(/mady-cvd/);
    expect(out).not.toMatch(/\bfilter\s*[:=]/);
  });
});

describe("the panel assembler", () => {
  it("carries the filter on the canvas wrapper, and the composed figure export never does", () => {
    localStorage.setItem(COLOR_VISION_KEY, "grayscale");
    const { container } = render(
      <LayoutPane project={proj({ panels: ["A", "B"], freeform: true })} layoutId="L" onRemovePanel={() => {}} onOpenPlot={() => {}} onSetLayoutOptions={() => {}} />,
    );
    expect((container.querySelector(".laywrap") as HTMLElement).style.filter).toContain("mady-cvd-grayscale");
    const composed = composeActiveFigureSvg({ background: "white", margin: 0 });
    expect(composed, "no figure composed").not.toBeNull();
    expect(composed!.svg).not.toMatch(/mady-cvd/);
    expect(composed!.svg).not.toMatch(/\bfilter\s*[:=]/);
  });
});
