// @vitest-environment jsdom
// PowerPoint export: the format in the export registry and its payload. The rasteriser is stood in for (jsdom has no canvas),
// exactly as ExportDialog.test does; what is checked is what reaches the file: the vector drawing with its background,
// the PNG made at the chosen pixel size from the transparent drawing, and the drawing's own shape for the slide.
import { describe, expect, it, vi } from "vitest";

// Hoisted with the mock (vi.mock runs before the module's own top level).
const { png } = vi.hoisted(() => ({ png: vi.fn(async (_svg: string, _w: number, _h: number, _bg: string) => "UE5H") }));
vi.mock("./exporters", async (orig) => ({ ...(await orig<typeof import("./exporters")>()), svgToPngBase64: png }));

import { EXPORT_FORMAT_LABEL, PLOT_EXPORT_FORMATS } from "./exporters";
import { payloadForFormat } from "./exportPayload";

describe("the PowerPoint format", () => {
  it("is offered for graphs and figures, last (PNG stays the first choice), with a plain label", () => {
    expect(PLOT_EXPORT_FORMATS.at(-1)).toBe("pptx");
    expect(PLOT_EXPORT_FORMATS[0]).toBe("png");
    expect(EXPORT_FORMAT_LABEL.pptx).toMatch(/PowerPoint/);
  });
  it("a payload carries one slide: the vector with its background, the PNG at the chosen size, the drawing's shape", async () => {
    const serialize = vi.fn((bg: string) => ({ svg: `<svg data-bg="${bg}"/>`, width: 640, height: 400 }));
    const p = await payloadForFormat({ format: "pptx", suggestedName: "Dose response", serialize: serialize as never, background: "white", width: 2667, height: 1667 });
    expect(p!.format).toBe("pptx");
    const s = p!.pptx!.slides;
    expect(s).toHaveLength(1);
    expect(s[0]).toEqual({ name: "Dose response", svg: '<svg data-bg="white"/>', pngBase64: "UE5H", width: 640, height: 400 });
    expect(png).toHaveBeenLastCalledWith('<svg data-bg="transparent"/>', 2667, 1667, "white");
  });
  it("nothing drawn → no file", async () => {
    expect(await payloadForFormat({ format: "pptx", suggestedName: "x", serialize: () => null, background: "white", width: 10, height: 10 })).toBeNull();
  });
});
