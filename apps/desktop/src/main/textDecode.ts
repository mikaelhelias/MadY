/**
 * Decode a text-file buffer honouring a leading byte-order mark. Kept separate from
 * `index.ts` so it is unit-testable without booting Electron.
 *
 * Reading every file as UTF-8 would decode a UTF-16 file — including Excel's
 * own "Unicode Text" (.txt) and "Unicode CSV" exports, which are UTF-16LE — as
 * NUL-riddled mojibake with no error, turning every numeric column into text and
 * doubling the apparent row count.
 *
 * BOM handling: FF FE = UTF-16LE, FE FF = UTF-16BE (byte-swapped to LE before decode),
 * EF BB BF = UTF-8. A BOM-less file is decoded as UTF-8, but if that yields the replacement
 * character U+FFFD — i.e. the bytes are not valid UTF-8 — it is re-decoded as Latin-1 /
 * Windows-1252 (Node's "latin1"), the other common single-byte encoding for European exports.
 * Without that fallback a BOM-less Windows-1252 file (é/ñ/°/µ as single high bytes) would turn
 * every accented value into mojibake without any error. (Latin-1 and Windows-1252 agree on 0xA0–0xFF, where almost all accented
 * letters live; only the rare 0x80–0x9F punctuation differs.)
 */
export function decodeTextBuffer(buf: Buffer): string {
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) return buf.toString("utf16le", 2);
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) {
    // Big-endian: swap a copy to little-endian (Node decodes only utf16le), then skip the BOM.
    const le = buf.length % 2 === 0 ? Buffer.from(buf).swap16() : buf;
    return le.toString("utf16le", 2);
  }
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) return buf.toString("utf8", 3);
  const utf8 = buf.toString("utf8");
  // U+FFFD only appears when Node hit bytes that aren't valid UTF-8 → assume Latin-1/Windows-1252.
  return utf8.includes(String.fromCharCode(0xfffd)) ? buf.toString("latin1") : utf8;
}
