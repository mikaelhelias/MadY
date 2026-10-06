// Export all: file names and the batch run, with the drawing and the disk faked.
import { describe, expect, it, vi } from "vitest";
import { batchFileNames, runBatchExport, safeFileStem, type BatchItem } from "./batchExport";

describe("batchFileNames", () => {
  it("fills {name} {kind} {n}, made safe like the Save dialog's name", () => {
    expect(batchFileNames([{ name: "Dose / response (µM)", kind: "graph" }], "{n}-{kind}-{name}", "png")).toEqual(["1-graph-Dose_response_M.png"]);
    expect(safeFileStem("  ")).toBe("export");
  });
  it("never repeats a name, case-insensitively", () => {
    expect(batchFileNames([{ name: "Fig", kind: "figure" }, { name: "fig", kind: "figure" }, { name: "Fig", kind: "figure" }], "{name}", "svg"))
      .toEqual(["Fig.svg", "fig-2.svg", "Fig-3.svg"]);
  });
  it("an empty pattern means the name", () => {
    expect(batchFileNames([{ name: "A", kind: "graph" }], "", "pdf")).toEqual(["A.pdf"]);
  });
});

describe("runBatchExport", () => {
  const svg = (w = 400, h = 300) => ({ svg: `<svg width="${w}" height="${h}"/>`, width: w, height: h });
  const items: BatchItem[] = [
    { id: "a", kind: "graph", name: "Alpha" },
    { id: "b", kind: "graph", name: "Beta" },
    { id: "c", kind: "figure", name: "Figure 1" },
  ];
  it("exports every item; one that cannot be drawn is reported and the rest still export", async () => {
    const write = vi.fn(async (files: { name: string }[]) => files.map((f) => ({ name: f.name, ok: true })));
    const progress = vi.fn();
    const r = await runBatchExport({
      items, format: "svg", dpi: 300, background: "white", pattern: "{name}",
      mount: async (it) => (it.id === "b" ? null : { serialize: () => svg() }),
      write, onProgress: progress,
    });
    expect(r.written).toEqual(["Alpha.svg", "Figure_1.svg"]);
    expect(r.failed).toEqual([{ name: "Beta.svg", error: "this graph could not be drawn" }]);
    expect(progress).toHaveBeenCalledTimes(3);
    expect(progress).toHaveBeenLastCalledWith(3, 3);
    expect(write.mock.calls[0]![0].map((f: { name: string }) => f.name)).toEqual(["Alpha.svg", "Figure_1.svg"]);
  });
  it("a throwing item is caught; a file the disk refuses is a failure too", async () => {
    const r = await runBatchExport({
      items, format: "svg", dpi: 300, background: "white", pattern: "{name}",
      mount: async (it) => { if (it.id === "a") throw new Error("boom"); return { serialize: () => svg() }; },
      write: async (files) => files.map((f) => (f.name === "Beta.svg" ? { name: f.name, ok: false, error: "already exists" } : { name: f.name, ok: true })),
    });
    expect(r.failed).toEqual([{ name: "Alpha.svg", error: "boom" }, { name: "Beta.svg", error: "already exists" }]);
    expect(r.written).toEqual(["Figure_1.svg"]);
  });
  it("writes in chunks", async () => {
    const write = vi.fn(async (files: { name: string }[]) => files.map((f) => ({ name: f.name, ok: true })));
    await runBatchExport({ items, format: "svg", dpi: 300, background: "white", pattern: "{name}", mount: async () => ({ serialize: () => svg() }), write, chunk: 2 });
    expect(write.mock.calls.map((c) => c[0].length)).toEqual([2, 1]);
  });
  it("a PDF file is the page the Export dialog would write (the item's own drawing size)", async () => {
    const got: { payload: { svg?: string; width?: number } }[] = [];
    await runBatchExport({
      items: [items[0]!], format: "pdf", dpi: 300, background: "white", pattern: "{name}",
      mount: async () => ({ serialize: () => svg(512, 256) }),
      write: async (files) => { got.push(...(files as unknown as typeof got)); return files.map((f) => ({ name: f.name, ok: true })); },
    });
    expect(got[0]!.payload.width).toBe(512);
  });
});
