/**
 * PowerPoint export — a .pptx built by hand with MadY's own zip writer (no dependency,
 * nothing leaves the machine). One 16:9 slide per graph / figure, each holding one picture: the PNG, carrying the SVG as
 * PowerPoint's `svgBlip` extension, so PowerPoint 2016+ shows the vector (and "Convert to Shape" makes it editable) while
 * older readers and LibreOffice show the PNG. The picture keeps its shape and fills the slide inside half-inch margins.
 *
 * Only the parts PowerPoint needs: content types, package and presentation relationships, one blank master + layout, a
 * complete minimal theme (PowerPoint refuses an incomplete one), the slides and their media, and the two property parts.
 */
import { zipSync, type ZipEntry } from "./zip";

export interface PptxSlide {
  /** The picture's name (the graph / figure name). */
  name: string;
  /** The standalone SVG. */
  svg: string;
  /** The same drawing as a PNG — the fallback every reader can show. */
  png: Buffer;
  /** The drawing's size (px); only its shape is used. */
  width: number;
  height: number;
}

const SLIDE_W = 12192000; // 13.333 in, 16:9
const SLIDE_H = 6858000; // 7.5 in
const MARGIN = 457200; // 0.5 in

const NS_P = "http://schemas.openxmlformats.org/presentationml/2006/main";
const NS_A = "http://schemas.openxmlformats.org/drawingml/2006/main";
const NS_R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const CT = "application/vnd.openxmlformats-officedocument";
const HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function relsXml(items: Array<[id: string, type: string, target: string]>): string {
  return `${HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${items
    .map(([id, type, target]) => `<Relationship Id="${id}" Type="${type}" Target="${target}"/>`)
    .join("")}</Relationships>`;
}
const EMPTY_TREE = `<p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>`;

/** Where a picture of this shape sits: as large as fits inside the margins, centred. EMU. */
export function fitPicture(width: number, height: number): { x: number; y: number; cx: number; cy: number } {
  const aw = SLIDE_W - 2 * MARGIN;
  const ah = SLIDE_H - 2 * MARGIN;
  const w = Math.max(1, width), h = Math.max(1, height);
  const k = Math.min(aw / w, ah / h);
  const cx = Math.round(w * k), cy = Math.round(h * k);
  return { x: Math.round((SLIDE_W - cx) / 2), y: Math.round((SLIDE_H - cy) / 2), cx, cy };
}

function slideXml(s: PptxSlide, n: number): string {
  const f = fitPicture(s.width, s.height);
  const name = esc(s.name || `Graph ${n}`);
  return `${HEAD}<p:sld xmlns:a="${NS_A}" xmlns:r="${NS_R}" xmlns:p="${NS_P}"><p:cSld>${EMPTY_TREE}` +
    `<p:pic><p:nvPicPr><p:cNvPr id="2" name="${name}" descr="${name}"/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr>` +
    `<p:blipFill><a:blip r:embed="rIdPng"><a:extLst><a:ext uri="{96DAC541-7B7A-43D3-8B79-37D633B846F1}">` +
    `<asvg:svgBlip xmlns:asvg="http://schemas.microsoft.com/office/drawing/2016/SVG/main" r:embed="rIdSvg"/></a:ext></a:extLst></a:blip>` +
    `<a:stretch><a:fillRect/></a:stretch></p:blipFill>` +
    `<p:spPr><a:xfrm><a:off x="${f.x}" y="${f.y}"/><a:ext cx="${f.cx}" cy="${f.cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>` +
    `</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`;
}

const CLR_MAP = `<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>`;

const MASTER = `${HEAD}<p:sldMaster xmlns:a="${NS_A}" xmlns:r="${NS_R}" xmlns:p="${NS_P}"><p:cSld><p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg>${EMPTY_TREE}</p:spTree></p:cSld>${CLR_MAP}` +
  `<p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst>` +
  `<p:txStyles><p:titleStyle><a:lvl1pPr><a:defRPr sz="4400"/></a:lvl1pPr></p:titleStyle><p:bodyStyle><a:lvl1pPr><a:defRPr sz="2800"/></a:lvl1pPr></p:bodyStyle><p:otherStyle><a:lvl1pPr><a:defRPr sz="1800"/></a:lvl1pPr></p:otherStyle></p:txStyles></p:sldMaster>`;

const LAYOUT = `${HEAD}<p:sldLayout xmlns:a="${NS_A}" xmlns:r="${NS_R}" xmlns:p="${NS_P}" type="blank" preserve="1"><p:cSld name="Blank">${EMPTY_TREE}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`;

const solid = (v: string): string => `<a:solidFill><a:schemeClr val="${v}"/></a:solidFill>`;
const THEME = `${HEAD}<a:theme xmlns:a="${NS_A}" name="MadY"><a:themeElements>` +
  `<a:clrScheme name="MadY"><a:dk1><a:srgbClr val="000000"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="1F2937"/></a:dk2><a:lt2><a:srgbClr val="F3F4F6"/></a:lt2>` +
  `<a:accent1><a:srgbClr val="0072B2"/></a:accent1><a:accent2><a:srgbClr val="E69F00"/></a:accent2><a:accent3><a:srgbClr val="009E73"/></a:accent3><a:accent4><a:srgbClr val="D55E00"/></a:accent4>` +
  `<a:accent5><a:srgbClr val="CC79A7"/></a:accent5><a:accent6><a:srgbClr val="56B4E9"/></a:accent6><a:hlink><a:srgbClr val="0072B2"/></a:hlink><a:folHlink><a:srgbClr val="7F3C8D"/></a:folHlink></a:clrScheme>` +
  `<a:fontScheme name="MadY"><a:majorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme>` +
  `<a:fmtScheme name="MadY"><a:fillStyleLst>${solid("phClr")}${solid("phClr")}${solid("phClr")}</a:fillStyleLst>` +
  `<a:lnStyleLst><a:ln w="6350">${solid("phClr")}</a:ln><a:ln w="12700">${solid("phClr")}</a:ln><a:ln w="19050">${solid("phClr")}</a:ln></a:lnStyleLst>` +
  `<a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst>` +
  `<a:bgFillStyleLst>${solid("phClr")}${solid("phClr")}${solid("phClr")}</a:bgFillStyleLst></a:fmtScheme>` +
  `</a:themeElements><a:objectDefaults/><a:extraClrSchemeLst/></a:theme>`;

/** The deck: one slide per item. At least one is required. */
export function buildPptx(slides: PptxSlide[]): Buffer {
  if (slides.length === 0) throw new Error("a PowerPoint file needs at least one slide");
  const n = slides.length;
  const idx = slides.map((_, i) => i + 1);
  const entries: ZipEntry[] = [];
  const add = (name: string, data: string | Buffer): void => { entries.push({ name, data }); };

  add("[Content_Types].xml", `${HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>` +
    `<Default Extension="png" ContentType="image/png"/><Default Extension="svg" ContentType="image/svg+xml"/>` +
    `<Override PartName="/ppt/presentation.xml" ContentType="${CT}.presentationml.presentation.main+xml"/>` +
    `<Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="${CT}.presentationml.slideMaster+xml"/>` +
    `<Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="${CT}.presentationml.slideLayout+xml"/>` +
    `<Override PartName="/ppt/theme/theme1.xml" ContentType="${CT}.theme+xml"/>` +
    idx.map((i) => `<Override PartName="/ppt/slides/slide${i}.xml" ContentType="${CT}.presentationml.slide+xml"/>`).join("") +
    `<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>` +
    `<Override PartName="/docProps/app.xml" ContentType="${CT}.extended-properties+xml"/></Types>`);
  add("_rels/.rels", relsXml([
    ["rId1", `${REL}/officeDocument`, "ppt/presentation.xml"],
    ["rId2", "http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties", "docProps/core.xml"],
    ["rId3", `${REL}/extended-properties`, "docProps/app.xml"],
  ]));
  add("docProps/core.xml", `${HEAD}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>MadY graphs</dc:title><dc:creator>MadY</dc:creator></cp:coreProperties>`);
  add("docProps/app.xml", `${HEAD}<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>MadY</Application><Slides>${n}</Slides></Properties>`);

  // presentation: rId1 = master, rId2..rId(n+1) = slides, then theme
  add("ppt/presentation.xml", `${HEAD}<p:presentation xmlns:a="${NS_A}" xmlns:r="${NS_R}" xmlns:p="${NS_P}" saveSubsetFonts="1">` +
    `<p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>` +
    `<p:sldIdLst>${idx.map((i) => `<p:sldId id="${255 + i}" r:id="rId${i + 1}"/>`).join("")}</p:sldIdLst>` +
    `<p:sldSz cx="${SLIDE_W}" cy="${SLIDE_H}"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>`);
  add("ppt/_rels/presentation.xml.rels", relsXml([
    ["rId1", `${REL}/slideMaster`, "slideMasters/slideMaster1.xml"],
    ...idx.map((i): [string, string, string] => [`rId${i + 1}`, `${REL}/slide`, `slides/slide${i}.xml`]),
    [`rId${n + 2}`, `${REL}/theme`, "theme/theme1.xml"],
  ]));
  add("ppt/slideMasters/slideMaster1.xml", MASTER);
  add("ppt/slideMasters/_rels/slideMaster1.xml.rels", relsXml([
    ["rId1", `${REL}/slideLayout`, "../slideLayouts/slideLayout1.xml"],
    ["rId2", `${REL}/theme`, "../theme/theme1.xml"],
  ]));
  add("ppt/slideLayouts/slideLayout1.xml", LAYOUT);
  add("ppt/slideLayouts/_rels/slideLayout1.xml.rels", relsXml([["rId1", `${REL}/slideMaster`, "../slideMasters/slideMaster1.xml"]]));
  add("ppt/theme/theme1.xml", THEME);
  slides.forEach((s, k) => {
    const i = k + 1;
    add(`ppt/slides/slide${i}.xml`, slideXml(s, i));
    add(`ppt/slides/_rels/slide${i}.xml.rels`, relsXml([
      ["rId1", `${REL}/slideLayout`, "../slideLayouts/slideLayout1.xml"],
      ["rIdPng", `${REL}/image`, `../media/image${i}.png`],
      ["rIdSvg", `${REL}/image`, `../media/image${i}.svg`],
    ]));
    add(`ppt/media/image${i}.png`, s.png);
    add(`ppt/media/image${i}.svg`, s.svg);
  });
  return zipSync(entries);
}
