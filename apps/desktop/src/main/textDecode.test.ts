// @vitest-environment node
import { describe, expect, it } from "vitest";
import { decodeTextBuffer } from "./textDecode";

const csv = "id,value\n1,3.14\n2,2.72";

describe("decodeTextBuffer (UTF-16 import must not mojibake)", () => {
  it("decodes a plain UTF-8 buffer (no BOM)", () => {
    expect(decodeTextBuffer(Buffer.from(csv, "utf8"))).toBe(csv);
  });

  it("decodes a UTF-8 buffer with a BOM (BOM left for downstream stripBom)", () => {
    const buf = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(csv, "utf8")]);
    expect(decodeTextBuffer(buf)).toBe(csv);
  });

  it("decodes UTF-16LE — Excel's 'Unicode Text' export — instead of mojibake", () => {
    const buf = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(csv, "utf16le")]);
    const out = decodeTextBuffer(buf);
    expect(out).toBe(csv);
    // Reading these bytes as UTF-8 interleaves a NUL after each ASCII
    // char; assert the mojibake signature (embedded NUL) is absent.
    expect(out.indexOf("\u0000")).toBe(-1);
  });

  it("decodes UTF-16BE by byte-swapping to LE", () => {
    const le = Buffer.from(csv, "utf16le");
    const be = Buffer.from(le).swap16();
    const buf = Buffer.concat([Buffer.from([0xfe, 0xff]), be]);
    expect(decodeTextBuffer(buf)).toBe(csv);
  });

  it("leaves an empty buffer as an empty string", () => {
    expect(decodeTextBuffer(Buffer.alloc(0))).toBe("");
  });

  it("falls back to Latin-1/Windows-1252 for a BOM-less non-UTF-8 file (accented chars)", () => {
    // "café,Genève" written in Windows-1252 (é = 0xE9, è = 0xE8) — invalid as UTF-8.
    const latin1 = Buffer.from("café,Genève", "latin1");
    expect(latin1.toString("utf8")).toContain(String.fromCharCode(0xfffd)); // UTF-8 would mojibake
    expect(decodeTextBuffer(latin1)).toBe("café,Genève"); // fallback recovers the letters
  });

  it("does not disturb valid UTF-8 multibyte content (no false fallback)", () => {
    const utf8 = "café,Genève,µg,°C"; // genuine UTF-8
    expect(decodeTextBuffer(Buffer.from(utf8, "utf8"))).toBe(utf8);
  });
});
