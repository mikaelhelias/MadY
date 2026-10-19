import { describe, it, expect } from "vitest";
import { manhattanLayout, chromosomeOrder } from "./qqplot";

describe("chromosomeOrder", () => {
  it("orders 1..22 numerically, then X, Y, M", () => {
    expect(chromosomeOrder("1")).toBeLessThan(chromosomeOrder("2"));
    expect(chromosomeOrder("2")).toBeLessThan(chromosomeOrder("10"));
    expect(chromosomeOrder("22")).toBeLessThan(chromosomeOrder("X"));
    expect(chromosomeOrder("X")).toBeLessThan(chromosomeOrder("Y"));
    expect(chromosomeOrder("Y")).toBeLessThan(chromosomeOrder("M"));
    expect(chromosomeOrder("MT")).toBe(chromosomeOrder("M"));
  });
  it("ignores a leading chr/chr_ prefix and is case-insensitive", () => {
    expect(chromosomeOrder("chr7")).toBe(chromosomeOrder("7"));
    expect(chromosomeOrder("chr_7")).toBe(chromosomeOrder("7"));
    expect(chromosomeOrder("chrX")).toBe(chromosomeOrder("x"));
  });
  it("pushes unknown labels to the end", () => {
    expect(chromosomeOrder("scaffold_9")).toBeGreaterThan(chromosomeOrder("M"));
  });
});

describe("manhattanLayout", () => {
  const items = [
    { chr: "2", pos: 500 },
    { chr: "1", pos: 100 },
    { chr: "1", pos: 300 },
    { chr: "2", pos: 900 },
    { chr: "X", pos: 50 },
  ];

  it("orders chromosomes 1, 2, X regardless of input order", () => {
    const lay = manhattanLayout(items);
    expect(lay.chromosomes.map((c) => c.name)).toEqual(["1", "2", "X"]);
  });

  it("lays spans end to end: each offset ≥ the previous chromosome's right edge", () => {
    const lay = manhattanLayout(items);
    for (let i = 1; i < lay.chromosomes.length; i++) {
      const prev = lay.chromosomes[i - 1]!;
      const cur = lay.chromosomes[i]!;
      expect(cur.offset).toBeGreaterThanOrEqual(prev.offset + prev.width);
    }
  });

  it("places a marker at offset + (pos − minPos) on its chromosome", () => {
    const lay = manhattanLayout(items);
    const chr2 = lay.chromosomes.find((c) => c.name === "2")!;
    // chr2 spans 500..900; a marker at 900 sits at offset + 400.
    expect(lay.posOf("2", 900)).toBeCloseTo(chr2.offset + 400, 6);
    // The first marker of chr1 (minPos 100) sits at its offset (0).
    expect(lay.posOf("1", 100)).toBeCloseTo(0, 6);
  });

  it("puts each chromosome's tick at the midpoint of its span", () => {
    const lay = manhattanLayout(items);
    const chr1 = lay.chromosomes.find((c) => c.name === "1")!;
    // chr1 spans 100..300 → width 200 → mid at offset + 100.
    expect(chr1.width).toBeCloseTo(200, 6);
    expect(chr1.mid).toBeCloseTo(chr1.offset + 100, 6);
  });

  it("gives a single-SNP chromosome a floor width of 1 (no zero-width span)", () => {
    const lay = manhattanLayout([{ chr: "1", pos: 42 }, { chr: "2", pos: 7 }]);
    expect(lay.chromosomes.every((c) => c.width >= 1)).toBe(true);
    // Distinct chromosomes must not collapse onto the same genome coordinate.
    expect(lay.posOf("1", 42)).not.toBeCloseTo(lay.posOf("2", 7), 6);
  });

  it("returns NaN for a marker on a chromosome not in the layout", () => {
    const lay = manhattanLayout(items);
    expect(Number.isNaN(lay.posOf("99", 1))).toBe(true);
  });

  it("ignores non-finite positions and blank chromosome labels", () => {
    const lay = manhattanLayout([
      { chr: "1", pos: 10 },
      { chr: "1", pos: NaN },
      { chr: "", pos: 20 },
    ]);
    expect(lay.chromosomes.map((c) => c.name)).toEqual(["1"]);
  });
});
