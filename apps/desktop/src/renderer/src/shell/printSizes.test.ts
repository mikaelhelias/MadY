// The page sizes a figure can be laid out on.
import { describe, expect, it } from "vitest";
import { PAGE_SIZES, pagePx } from "./printSizes";

describe("pagePx", () => {
  it("converts mm to canvas px at 96 dpi, the rulers' convention", () => {
    expect(pagePx({ wMm: 174, hMm: 235 })).toEqual({ w: 658, h: 888 });
    expect(pagePx({ wMm: 210, hMm: 297 })).toEqual({ w: 794, h: 1123 });
  });
});

describe("PAGE_SIZES", () => {
  it("offers the journal columns, A4 and Letter, portrait", () => {
    expect(PAGE_SIZES.map((p) => p.label)).toEqual(["1 column", "1.5 column", "2 columns", "A4", "Letter"]);
    for (const p of PAGE_SIZES) expect(p.hMm).toBeGreaterThan(p.wMm);
  });
});
