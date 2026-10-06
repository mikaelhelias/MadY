// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { DataTable } from "@mady/core";
import { encodeEpsRaster, encodeTiffCmyk, encodeTiffRgb, htmlWrap, interactiveHtmlWrap, rgbToCmyk, tableToCsv, tableToGrid, tableToJson, tableToPrintHtml } from "./exporters";

const table: DataTable = {
  id: "t1",
  kind: "xy",
  name: "T",
  columns: [
    { id: "c1", name: "dose" },
    { id: "c2", name: "note, label" },
  ],
  rows: [
    { id: "r1", cells: { c1: 1, c2: 'has "quote"' } },
    { id: "r2", cells: { c1: 2, c2: null } },
    { id: "r3", cells: { c1: null, c2: "line\nbreak" } },
  ],
};

describe("interactiveHtmlWrap", () => {
  // A serialized figure SVG the way serializeGraphSvg emits it: a root <svg> with a
  // class (the live figure carries class="gfx-figure"), a tagged series group, a legend
  // row, a data-bearing <title>, and an editing-hint <title> that must not survive.
  const svg = [
    '<svg class="gfx-figure" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300" width="400" height="300">',
    '<g class="gfx-series" data-mady-series="s1"><circle cx="10" cy="20" r="3"><title>dose 5, response 42</title></circle></g>',
    '<g data-mady-series="s1" data-mady-legend="1"><text>Drug A</text></g>',
    '<rect x="0" y="0" width="8" height="8"><title>Drag to set the X-axis length</title></rect>',
    "</svg>",
  ].join("");

  it("produces a self-contained document with the runtime and no external references", () => {
    const html = interactiveHtmlWrap(svg, "My figure");
    expect(html.startsWith("<!DOCTYPE html>")).toBe(true);
    expect(html).toContain("<script>");
    expect(html).toContain("data-mady-tip"); // the runtime hoists <title> to this
    expect(html).toContain("mady-tip"); // tooltip styling
    // Self-contained: nothing is fetched over the network.
    expect(html).not.toMatch(/\b(?:src|href)\s*=\s*["']https?:/i);
    expect(html).not.toMatch(/https?:\/\/(?!www\.w3\.org)/); // the SVG namespace URI is allowed
  });

  it("tags the root svg without duplicating its class attribute", () => {
    const html = interactiveHtmlWrap(svg, "t");
    expect(html).toContain('class="gfx-figure mady-fig"');
    expect(html).not.toContain('class="mady-fig"'); // never a second, replacing class attr
    expect((html.match(/class="[^"]*mady-fig/g) ?? []).length).toBe(1); // exactly one root tag tagged
  });

  it("strips in-app editing-hint <title>s so they don't become tooltips, keeps data ones", () => {
    const html = interactiveHtmlWrap(svg, "t");
    expect(html).not.toContain("Drag to set the X-axis length");
    expect(html).toContain("dose 5, response 42"); // real data tooltip preserved
  });

  it("preserves the series/legend toggle hooks the runtime needs", () => {
    const html = interactiveHtmlWrap(svg, "t");
    expect(html).toContain('data-mady-series="s1"');
    expect(html).toContain('data-mady-legend="1"');
  });

  it("hover values off: the page carries no hover text at all — neither data-mady-tip nor <title>", () => {
    const tipped = svg.replace('<circle cx="10"', '<circle data-mady-tip="Dose: 5&#10;Response: 42" cx="10"');
    const on = interactiveHtmlWrap(tipped, "t", "white");
    expect(on).toContain('data-mady-tip="Dose: 5');
    expect(on).toContain("dose 5, response 42");
    const off = interactiveHtmlWrap(tipped, "t", "white", { hoverValues: false });
    expect(off).not.toContain("data-mady-tip=");
    expect(off).not.toContain("dose 5, response 42");
    expect(off).not.toMatch(/<svg[sS]*<title>/);
    expect(off).toContain('data-mady-hover="off"');
    expect(on).not.toContain("data-mady-hover");
    // Zoom, pan and the legend toggle stay.
    expect(off).toContain('data-mady-series="s1"');
    expect(off).toContain("<script>");
  });

  it("escapes the document title but the static wrapper stays a strict subset (no runtime)", () => {
    expect(interactiveHtmlWrap(svg, 'a "b" <c>')).toContain("a &quot;b&quot; &lt;c&gt;");
    expect(htmlWrap(svg, "t")).not.toContain("<script>"); // the static export is inert
  });
});

describe("tableToCsv", () => {
  it("emits a header + one row per data row", () => {
    const lines = tableToCsv(table).split("\r\n");
    expect(lines).toHaveLength(4); // header + 3 rows
  });

  it("quotes fields with commas, quotes, or newlines (RFC-4180) and blanks nulls", () => {
    const csv = tableToCsv(table);
    expect(csv.split("\r\n")[0]).toBe('dose,"note, label"');
    expect(csv).toContain('1,"has ""quote"""');
    expect(csv).toContain("2,"); // null → empty field
    expect(csv).toContain('"line\nbreak"');
  });

  it("preserves a formula-looking cell verbatim — no CSV-injection neutralising", () => {
    const t = {
      id: "t", kind: "xy", name: "T",
      columns: [{ id: "c", name: "expr" }],
      rows: [{ id: "r1", cells: { c: "=1+1" } }, { id: "r2", cells: { c: "+5" } }, { id: "r3", cells: { c: "@x" } }],
    } as unknown as Parameters<typeof tableToCsv>[0];
    const csv = tableToCsv(t);
    // No ' prefix is added, so the value round-trips into pandas/R unchanged.
    expect(csv).toContain("\r\n=1+1");
    expect(csv).toContain("\r\n+5");
    expect(csv).toContain("\r\n@x");
    expect(csv).not.toContain("'=1+1");
  });
});

describe("tableToPrintHtml", () => {
  it("emits a captioned table: name heading + header row + one <tr> per data row", () => {
    const html = tableToPrintHtml(table);
    expect(html).toContain('<h2 class="print-title">T</h2>');
    expect(html).toContain("<th>dose</th>");
    expect((html.match(/<tr>/g) ?? []).length).toBe(4); // header row + 3 data rows
  });

  it("escapes HTML in names and cells (no tag injection from data)", () => {
    const t = {
      id: "t", kind: "xy", name: "A & <B>",
      columns: [{ id: "c", name: "x<y" }],
      rows: [{ id: "r1", cells: { c: "<script>alert(1)</script>" } }],
    } as unknown as Parameters<typeof tableToPrintHtml>[0];
    const html = tableToPrintHtml(t);
    expect(html).toContain("A &amp; &lt;B&gt;");
    expect(html).toContain("<th>x&lt;y</th>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).not.toContain("<script>"); // the raw tag never survives into the markup
  });

  it("blanks a null cell", () => {
    expect(tableToPrintHtml(table)).toContain("<td></td>"); // the null cell renders empty
  });
});

describe("tableToGrid", () => {
  it("flattens id-keyed cells into a positional grid, nulls for gaps", () => {
    expect(tableToGrid(table)).toEqual({
      columnNames: ["dose", "note, label"],
      rows: [
        [1, 'has "quote"'],
        [2, null],
        [null, "line\nbreak"],
      ],
    });
  });
});

describe("tableToJson", () => {
  it("emits { name, columns, rows: [{col: value}] } with nulls preserved", () => {
    const parsed = JSON.parse(tableToJson(table));
    expect(parsed.name).toBe("T");
    expect(parsed.columns).toEqual(["dose", "note, label"]);
    expect(parsed.rows).toHaveLength(3);
    expect(parsed.rows[0]).toEqual({ dose: 1, "note, label": 'has "quote"' });
    expect(parsed.rows[1]).toEqual({ dose: 2, "note, label": null });
  });
});

describe("encodeTiffRgb", () => {
  it("writes a valid little-endian baseline TIFF header at the right total size", () => {
    const w = 3;
    const h = 2;
    const rgba = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) {
      rgba[i * 4] = 10;
      rgba[i * 4 + 1] = 20;
      rgba[i * 4 + 2] = 30;
      rgba[i * 4 + 3] = 255;
    }
    const tiff = encodeTiffRgb(w, h, rgba);
    // "II" + 42 magic (little-endian).
    expect(tiff[0]).toBe(0x49);
    expect(tiff[1]).toBe(0x49);
    expect(tiff[2]).toBe(42);
    expect(tiff[3]).toBe(0);
    // 8-byte header + RGB strip (w·h·3) + IFD (2 + 12·12 + 4) + 6 BitsPerSample + 16 X/YRes.
    const stripLen = w * h * 3;
    const ifdLen = 2 + 12 * 12 + 4;
    expect(tiff.length).toBe(8 + stripLen + ifdLen + 6 + 16);
    // First pixel's RGB lands right after the header (opaque → unchanged).
    expect([tiff[8], tiff[9], tiff[10]]).toEqual([10, 20, 30]);
  });

  it("records the chosen DPI as X/YResolution RATIONALs, unit=inch", () => {
    const tiff = encodeTiffRgb(1, 1, new Uint8ClampedArray([0, 0, 0, 255]), 600);
    const dv = new DataView(tiff.buffer, tiff.byteOffset, tiff.byteLength);
    const ifdOffset = dv.getUint32(4, true);
    const n = dv.getUint16(ifdOffset, true);
    let xres: number | null = null;
    let yres: number | null = null;
    let unit: number | null = null;
    let prevTag = 0;
    for (let i = 0; i < n; i++) {
      const e = ifdOffset + 2 + i * 12;
      const tag = dv.getUint16(e, true);
      expect(tag).toBeGreaterThan(prevTag); // TIFF requires ascending tag order
      prevTag = tag;
      if (tag === 282 || tag === 283) {
        const off = dv.getUint32(e + 8, true);
        const value = dv.getUint32(off, true) / dv.getUint32(off + 4, true);
        if (tag === 282) xres = value;
        else yres = value;
      }
      if (tag === 296) unit = dv.getUint16(e + 8, true);
    }
    expect(xres).toBe(600);
    expect(yres).toBe(600);
    expect(unit).toBe(2); // ResolutionUnit = inch
  });

  it("composites a transparent pixel onto white", () => {
    const rgba = new Uint8ClampedArray([0, 0, 0, 0]); // fully transparent black
    const tiff = encodeTiffRgb(1, 1, rgba);
    expect([tiff[8], tiff[9], tiff[10]]).toEqual([255, 255, 255]); // → white
  });

  it("word-aligns the IFD for an odd-strip image", () => {
    // 1x1 RGB → stripLen 3 (odd); the IFD must start on an even byte, not offset 11.
    const tiff = encodeTiffRgb(1, 1, new Uint8ClampedArray([1, 2, 3, 255]));
    const dv = new DataView(tiff.buffer, tiff.byteOffset, tiff.byteLength);
    const ifdOffset = dv.getUint32(4, true);
    expect(ifdOffset % 2).toBe(0);
    // StripByteCounts (tag 279) still reports the true 3 bytes, not the padded length.
    const n = dv.getUint16(ifdOffset, true);
    let stripBytes = -1;
    for (let i = 0; i < n; i++) {
      const e = ifdOffset + 2 + i * 12;
      if (dv.getUint16(e, true) === 279) stripBytes = dv.getUint32(e + 8, true);
    }
    expect(stripBytes).toBe(3);
  });
});

describe("rgbToCmyk", () => {
  it("maps colours to CMYK ink amounts (0 = no ink)", () => {
    expect(rgbToCmyk(255, 255, 255)).toEqual([0, 0, 0, 0]); // white → no ink
    expect(rgbToCmyk(0, 0, 0)).toEqual([0, 0, 0, 255]); // black → K only
    expect(rgbToCmyk(255, 0, 0)).toEqual([0, 255, 255, 0]); // red → M+Y
    expect(rgbToCmyk(0, 255, 0)).toEqual([255, 0, 255, 0]); // green → C+Y
    expect(rgbToCmyk(0, 0, 255)).toEqual([255, 255, 0, 0]); // blue → C+M
  });
});

describe("encodeTiffCmyk", () => {
  it("writes a 4-sample Separated (CMYK) TIFF at the right size", () => {
    const w = 2;
    const h = 2;
    const rgba = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) { rgba[i * 4] = 255; rgba[i * 4 + 1] = 255; rgba[i * 4 + 2] = 255; rgba[i * 4 + 3] = 255; }
    const tiff = encodeTiffCmyk(w, h, rgba);
    expect([tiff[0], tiff[1], tiff[2]]).toEqual([0x49, 0x49, 42]);
    // 8 header + strip(w·h·4) + IFD(2 + 13·12 + 4) + 8 BitsPerSample + 16 X/YRes.
    expect(tiff.length).toBe(8 + w * h * 4 + (2 + 13 * 12 + 4) + 8 + 16);
    expect([tiff[8], tiff[9], tiff[10], tiff[11]]).toEqual([0, 0, 0, 0]); // white → no ink
  });

  it("composites a transparent pixel onto white (→ no ink)", () => {
    const tiff = encodeTiffCmyk(1, 1, new Uint8ClampedArray([0, 0, 0, 0]));
    expect([tiff[8], tiff[9], tiff[10], tiff[11]]).toEqual([0, 0, 0, 0]);
  });
});

describe("encodeEpsRaster", () => {
  it("emits a valid EPS: DSC header, BoundingBox, colorimage + hex data", () => {
    const rgba = new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 255]); // 2×1: red, green
    const eps = encodeEpsRaster(2, 1, rgba, 144, 72);
    expect(eps.startsWith("%!PS-Adobe-3.0 EPSF-3.0")).toBe(true);
    expect(eps).toContain("%%BoundingBox: 0 0 144 72");
    expect(eps).toContain("2 1 8");
    expect(eps).toContain("[2 0 0 -1 0 1]");
    expect(eps).toContain("false 3 colorimage");
    expect(eps).toContain("showpage");
    expect(eps).toContain("ff000000ff00"); // red then green
  });

  it("composites alpha onto white", () => {
    const eps = encodeEpsRaster(1, 1, new Uint8ClampedArray([0, 0, 0, 0]), 72, 72);
    expect(eps).toContain("ffffff");
  });
});
