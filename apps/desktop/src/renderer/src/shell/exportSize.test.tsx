// @vitest-environment jsdom
// One size rule. Graph ▸ Copy as picture must put on the clipboard the picture the Export
// dialog would start with — the same pixel count for the same graph. `defaultExportSize` is
// that rule, and this file proves the dialog's Width/Height fields agree with it for both
// branches: a plain graph (its on-screen scale × 300 dpi) and a graph with its own print
// width (the millimetres held, the pixels following the DPI).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";

vi.mock("./exporters", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./exporters")>()),
  // The serializer's box: wider than the raw viewBox, margin folded in — like the real one.
  serializeGraphSvg: (_svg: unknown, opts: { margin?: number } = {}) => {
    const m = opts.margin ?? 0;
    return { svg: "<svg/>", width: 600 + 2 * m, height: 100 + 2 * m };
  },
  svgToPngBase64: () => Promise.resolve("PNG"),
}));

const { ExportDialog } = await import("./ExportDialog");
const { defaultExportSize } = await import("./exportSize");
const { mmToPx } = await import("./printSizes");

afterEach(cleanup);
beforeEach(() => {
  document.body.innerHTML = "";
  const s = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  s.setAttribute("class", "gfx-figure");
  s.setAttribute("viewBox", "0 0 600 100");
  document.body.appendChild(s);
});

/** The dialog's Width / Height fields as numbers. */
function dialogSize(container: HTMLElement): { width: number; height: number } {
  const field = (word: string): number => {
    const lab = [...container.querySelectorAll("label")].find((l) => (l.textContent ?? "").trim().startsWith(word));
    const inp = lab?.querySelector<HTMLInputElement>('input[type="number"]');
    if (!inp) throw new Error(`no ${word} field`);
    return Number(inp.value);
  };
  return { width: field("Width"), height: field("Height") };
}

describe("defaultExportSize is the Export dialog's starting size", () => {
  it("a plain graph: the shown size × 300 dpi", () => {
    expect(defaultExportSize({ w: 600, h: 100, displayScale: 0.5, dpi: 300 })).toEqual({ width: 938, height: 156 });
  });
  it("a graph with a print width: the millimetres are held, the pixels follow the DPI", () => {
    const width = mmToPx(85, 300);
    expect(defaultExportSize({ w: 600, h: 100, printWidthMm: 85, dpi: 300 })).toEqual({ width, height: Math.round(width / 6) });
  });
  it("the dialog's fields show exactly these numbers — shown-scale branch", () => {
    const { container } = render(
      <ExportDialog kind="plot" suggestedName="g" displayScale={0.5} onExport={() => Promise.resolve()} onCancel={() => {}} />,
    );
    expect(dialogSize(container)).toEqual(defaultExportSize({ w: 600, h: 100, displayScale: 0.5, dpi: 300 }));
  });
  it("the dialog's fields show exactly these numbers — print-width branch", () => {
    const { container } = render(
      <ExportDialog kind="plot" suggestedName="g" printWidthMm={85} onExport={() => Promise.resolve()} onCancel={() => {}} />,
    );
    expect(dialogSize(container)).toEqual(defaultExportSize({ w: 600, h: 100, printWidthMm: 85, dpi: 300 }));
  });
});
