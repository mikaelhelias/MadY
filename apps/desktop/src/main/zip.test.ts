// @vitest-environment node
import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { crc32, zipSync } from "./zip";

describe("crc32", () => {
  it("matches the standard IEEE check values", () => {
    expect(crc32(Buffer.from(""))).toBe(0);
    // The canonical CRC-32 test vector.
    expect(crc32(Buffer.from("123456789"))).toBe(0xcbf43926);
  });
});

describe("zipSync", () => {
  it("produces an archive a real unzipper reads back byte-for-byte", async () => {
    const entries = [
      { name: "report.md", data: "# Bug report\n\nSomething broke." },
      { name: "manifest.json", data: JSON.stringify({ version: "1.2.3", ok: false }) },
      // A larger, compressible payload to exercise the deflate path.
      { name: "app-log-tail.txt", data: "log line\n".repeat(500) },
    ];
    const buf = zipSync(entries);

    // Standard signatures: local file header at the start, end-of-central-directory present.
    expect(buf.readUInt32LE(0)).toBe(0x04034b50);
    expect(buf.subarray(-22).readUInt32LE(0)).toBe(0x06054b50);

    const zip = await JSZip.loadAsync(buf);
    expect(Object.keys(zip.files).sort()).toEqual(["app-log-tail.txt", "manifest.json", "report.md"]);
    for (const e of entries) {
      expect(await zip.file(e.name)!.async("string")).toBe(e.data);
    }
  });

  it("round-trips UTF-8 content and names", async () => {
    const zip = await JSZip.loadAsync(zipSync([{ name: "µ-note.txt", data: "EC₅₀ ± 0.5 — café" }]));
    expect(await zip.file("µ-note.txt")!.async("string")).toBe("EC₅₀ ± 0.5 — café");
  });

  it("handles an empty archive", async () => {
    const zip = await JSZip.loadAsync(zipSync([]));
    expect(Object.keys(zip.files)).toHaveLength(0);
  });
});
