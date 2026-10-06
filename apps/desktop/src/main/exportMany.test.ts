// @vitest-environment node
// Export files to disk: the bytes of a payload, and a batch written into the folder the user picked.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import JSZip from "jszip";
import { payloadToBuffer, writeExportBatch } from "./exportMany";

const deps = {
  svgToPdf: async (svg: string, w: number, h: number) => Buffer.from(`PDF ${w}x${h} ${svg.length}`),
  workbook: async (sheet: { name: string }) => Buffer.from(`XLSX ${sheet.name}`),
};

describe("payloadToBuffer — the bytes file:export writes", () => {
  it("text as UTF-8, raster from base64, PDF and Excel through their writers", async () => {
    expect((await payloadToBuffer({ format: "svg", text: "<svg>µ</svg>" }, deps)).equals(Buffer.from("<svg>µ</svg>", "utf8"))).toBe(true);
    expect((await payloadToBuffer({ format: "png", base64: Buffer.from([1, 2, 3]).toString("base64") }, deps)).equals(Buffer.from([1, 2, 3]))).toBe(true);
    expect((await payloadToBuffer({ format: "pdf", svg: "<svg/>", width: 10, height: 20 }, deps)).toString()).toBe("PDF 10x20 6");
    expect((await payloadToBuffer({ format: "xlsx", sheet: { name: "S", columns: [], rows: [] } }, deps)).toString()).toBe("XLSX S");
    expect((await payloadToBuffer({ format: "csv" }, deps)).length).toBe(0);
  });
  it("a PowerPoint payload becomes a deck with its slide and both pictures", async () => {
    const buf = await payloadToBuffer({ format: "pptx", pptx: { slides: [{ name: "G", svg: "<svg/>", pngBase64: Buffer.from([7, 8]).toString("base64"), width: 4, height: 3 }] } }, deps);
    const z = await JSZip.loadAsync(buf);
    expect(z.file("ppt/slides/slide1.xml")).not.toBeNull();
    expect((await z.file("ppt/media/image1.png")!.async("nodebuffer")).equals(Buffer.from([7, 8]))).toBe(true);
    expect(await z.file("ppt/media/image1.svg")!.async("string")).toBe("<svg/>");
  });
});

describe("writeExportBatch", () => {
  // The picked folder sits two levels inside its own temp folder, so a name that did escape ("../../x") would still land
  // inside the temp tree — checked, then removed — never in a real folder of the user's.
  let root = "";
  let dir = "";
  beforeEach(async () => { root = await mkdtemp(join(tmpdir(), "mady-batch-")); dir = join(root, "a", "b"); await mkdir(dir, { recursive: true }); });
  afterEach(async () => { await rm(root, { recursive: true, force: true }); });
  const svg = (t: string) => ({ format: "svg", text: t });

  it("writes every file into the picked folder", async () => {
    const r = await writeExportBatch(dir, [{ name: "a.svg", payload: svg("A") }, { name: "b.svg", payload: svg("B") }], { replace: false, pickedDir: dir }, deps);
    expect(r.map((x) => x.ok)).toEqual([true, true]);
    expect((await readdir(dir)).sort()).toEqual(["a.svg", "b.svg"]);
    expect(await readFile(join(dir, "b.svg"), "utf8")).toBe("B");
  });
  it("refuses a folder that was not picked", async () => {
    const r = await writeExportBatch(dir, [{ name: "a.svg", payload: svg("A") }], { replace: false, pickedDir: join(dir, "other") }, deps);
    expect(r[0]!.ok).toBe(false);
    expect(await readdir(dir)).toEqual([]);
    const none = await writeExportBatch(dir, [{ name: "a.svg", payload: svg("A") }], { replace: false, pickedDir: null }, deps);
    expect(none[0]!.ok).toBe(false);
  });
  it("keeps only the file name: no path can land outside the folder", async () => {
    const r = await writeExportBatch(dir, [{ name: "../../evil.svg", payload: svg("x") }, { name: "sub\\\\x.svg", payload: svg("y") }], { replace: false, pickedDir: dir }, deps);
    expect(r.every((x) => x.ok)).toBe(true);
    expect((await readdir(dir)).sort()).toEqual(["evil.svg", "x.svg"]);
    expect(await readdir(root)).toEqual(["a"]); // nothing escaped upward
  });
  it("an existing file is a per-file failure unless Replace; the others still write", async () => {
    await writeFile(join(dir, "a.svg"), "OLD");
    const r = await writeExportBatch(dir, [{ name: "a.svg", payload: svg("NEW") }, { name: "b.svg", payload: svg("B") }], { replace: false, pickedDir: dir }, deps);
    expect(r[0]).toMatchObject({ ok: false });
    expect((r[0] as { error: string }).error).toMatch(/already exists/);
    expect(r[1]!.ok).toBe(true);
    expect(await readFile(join(dir, "a.svg"), "utf8")).toBe("OLD");
    const again = await writeExportBatch(dir, [{ name: "a.svg", payload: svg("NEW") }], { replace: true, pickedDir: dir }, deps);
    expect(again[0]!.ok).toBe(true);
    expect(await readFile(join(dir, "a.svg"), "utf8")).toBe("NEW");
  });
});
