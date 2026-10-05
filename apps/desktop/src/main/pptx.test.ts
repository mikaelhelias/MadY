// @vitest-environment node
// PowerPoint export: one slide per graph / figure, a picture whose SVG stays editable in
// PowerPoint 2016+ (Convert to Shape) with the PNG as the fallback. Built by hand with MadY's own zip writer; read back
// here with a real unzipper and checked part by part — PowerPoint refuses a file whose parts do not line up.
import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { buildPptx } from "./pptx";

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const slide = (name: string, w = 800, h = 400) => ({ name, svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"/>`, png: PNG, width: w, height: h });
const open = async (buf: Buffer) => JSZip.loadAsync(buf);
const text = async (z: JSZip, p: string): Promise<string> => {
  const f = z.file(p);
  if (!f) throw new Error(`missing part ${p}`);
  return f.async("string");
};
/** Relationship targets by id, from a .rels part. */
const rels = (xml: string): Record<string, { type: string; target: string }> =>
  Object.fromEntries([...xml.matchAll(/<Relationship\b[^>]*?Id="([^"]+)"[^>]*?Type="([^"]+)"[^>]*?Target="([^"]+)"/g)].map((m) => [m[1]!, { type: m[2]!, target: m[3]! }]));

describe("buildPptx", () => {
  it("is a zip holding every part PowerPoint needs", async () => {
    const buf = buildPptx([slide("A")]);
    expect(buf.readUInt32LE(0)).toBe(0x04034b50);
    const z = await open(buf);
    for (const p of [
      "[Content_Types].xml", "_rels/.rels", "ppt/presentation.xml", "ppt/_rels/presentation.xml.rels",
      "ppt/slideMasters/slideMaster1.xml", "ppt/slideMasters/_rels/slideMaster1.xml.rels",
      "ppt/slideLayouts/slideLayout1.xml", "ppt/slideLayouts/_rels/slideLayout1.xml.rels",
      "ppt/theme/theme1.xml", "ppt/slides/slide1.xml", "ppt/slides/_rels/slide1.xml.rels",
      "ppt/media/image1.png", "ppt/media/image1.svg",
    ]) expect(z.file(p), p).not.toBeNull();
  });
  it("declares the content types: png and svg by extension, every xml part by name", async () => {
    const z = await open(buildPptx([slide("A"), slide("B")]));
    const ct = await text(z, "[Content_Types].xml");
    expect(ct).toMatch(/<Default Extension="png" ContentType="image\/png"\/>/);
    expect(ct).toMatch(/<Default Extension="svg" ContentType="image\/svg\+xml"\/>/);
    expect(ct).toMatch(/PartName="\/ppt\/presentation.xml" ContentType="application\/vnd.openxmlformats-officedocument.presentationml.presentation.main\+xml"/);
    for (const n of [1, 2]) expect(ct).toMatch(new RegExp(`PartName="/ppt/slides/slide${n}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide\\+xml"`));
    expect(ct).toMatch(/slideMaster\+xml/);
    expect(ct).toMatch(/slideLayout\+xml/);
    expect(ct).toMatch(/theme\+xml/);
  });
  it("the presentation lists one slide per item, 16:9, each id resolving to its slide part", async () => {
    const z = await open(buildPptx([slide("A"), slide("B"), slide("C")]));
    const pres = await text(z, "ppt/presentation.xml");
    expect(pres).toMatch(/<p:sldSz cx="12192000" cy="6858000"/);
    const ids = [...pres.matchAll(/<p:sldId id="(\d+)" r:id="([^"]+)"\/>/g)];
    expect(ids).toHaveLength(3);
    const r = rels(await text(z, "ppt/_rels/presentation.xml.rels"));
    expect(ids.map((m) => r[m[2]!]!.target)).toEqual(["slides/slide1.xml", "slides/slide2.xml", "slides/slide3.xml"]);
    expect(ids.every((m) => Number(m[1]) >= 256)).toBe(true);
    const master = [...pres.matchAll(/<p:sldMasterId id="(\d+)" r:id="([^"]+)"\/>/g)];
    expect(master).toHaveLength(1);
    expect(r[master[0]![2]!]!.target).toBe("slideMasters/slideMaster1.xml");
  });
  it("a slide's picture: the PNG blip with the SVG extension, both resolving to the media given", async () => {
    const z = await open(buildPptx([slide("A")]));
    const s1 = await text(z, "ppt/slides/slide1.xml");
    const r = rels(await text(z, "ppt/slides/_rels/slide1.xml.rels"));
    const png = s1.match(/<a:blip r:embed="([^"]+)"/)![1]!;
    const svg = s1.match(/<asvg:svgBlip [^>]*r:embed="([^"]+)"/)![1]!;
    expect(s1).toMatch(/uri="\{96DAC541-7B7A-43D3-8B79-37D633B846F1\}"/);
    expect(r[png]!.target).toBe("../media/image1.png");
    expect(r[svg]!.target).toBe("../media/image1.svg");
    expect(Object.values(r).some((x) => x.target === "../slideLayouts/slideLayout1.xml")).toBe(true);
    expect((await z.file("ppt/media/image1.png")!.async("nodebuffer")).equals(PNG)).toBe(true);
    expect(await z.file("ppt/media/image1.svg")!.async("string")).toBe(slide("A").svg);
  });
  it("the picture keeps its shape and fits the slide inside the margins, centred", async () => {
    const z = await open(buildPptx([slide("wide", 1000, 250), slide("tall", 300, 900)]));
    for (const n of [1, 2]) {
      // The PICTURE's own position (the slide's empty shape group carries a 0,0 frame first).
      const s = (await text(z, `ppt/slides/slide${n}.xml`)).match(/<p:pic>[\s\S]*<\/p:pic>/)![0];
      const [, x, y] = s.match(/<a:off x="(\d+)" y="(\d+)"\/>/)!.map(Number);
      const [, cx, cy] = s.match(/<a:ext cx="(\d+)" cy="(\d+)"\/>/)!.map(Number);
      expect(cx! / cy!).toBeCloseTo(n === 1 ? 4 : 1 / 3, 2);
      expect(x!).toBeGreaterThanOrEqual(457200 - 1);
      expect(y!).toBeGreaterThanOrEqual(457200 - 1);
      expect(x! + cx!).toBeLessThanOrEqual(12192000 - 457200 + 1);
      expect(y! + cy!).toBeLessThanOrEqual(6858000 - 457200 + 1);
      expect(Math.abs(x! + cx! / 2 - 12192000 / 2)).toBeLessThan(2);
    }
  });
  it("names are XML-escaped", async () => {
    const z = await open(buildPptx([slide("Dose & response <µM>")]));
    const s1 = await text(z, "ppt/slides/slide1.xml");
    expect(s1).toContain('name="Dose &amp; response &lt;µM&gt;"');
  });
  it("the theme is complete: 12 colours, both fonts, three of each style", async () => {
    const z = await open(buildPptx([slide("A")]));
    const th = await text(z, "ppt/theme/theme1.xml");
    for (const c of ["dk1", "lt1", "dk2", "lt2", "accent1", "accent2", "accent3", "accent4", "accent5", "accent6", "hlink", "folHlink"]) expect(th, c).toContain(`<a:${c}>`);
    expect(th).toMatch(/<a:majorFont>[\s\S]*<a:latin typeface=/);
    expect(th).toMatch(/<a:minorFont>[\s\S]*<a:latin typeface=/);
    for (const lst of ["fillStyleLst", "lnStyleLst", "effectStyleLst", "bgFillStyleLst"]) {
      const body = th.match(new RegExp(`<a:${lst}>([\\s\\S]*?)</a:${lst}>`))![1]!;
      const tag = lst === "lnStyleLst" ? "a:ln" : lst === "effectStyleLst" ? "a:effectStyle" : "a:solidFill";
      expect((body.match(new RegExp(`<${tag}[ >]`, "g")) ?? []).length, lst).toBe(3);
    }
  });
  it("refuses an empty deck", () => {
    expect(() => buildPptx([])).toThrow(/at least one/);
  });
});
