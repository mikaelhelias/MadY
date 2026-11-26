import { describe, it, expect } from "vitest";
import { oncoprintMatrix, type AlterationEvent } from "./oncoprint";

const events: AlterationEvent[] = [
  { sample: "S1", gene: "TP53", alteration: "Missense" },
  { sample: "S2", gene: "TP53", alteration: "Truncating" },
  { sample: "S3", gene: "TP53", alteration: "Missense" },
  { sample: "S1", gene: "KRAS", alteration: "Amplification" },
  { sample: "S4", gene: "EGFR", alteration: "Missense" },
  { sample: "S1", gene: "TP53", alteration: "Amplification" }, // second alteration in one cell
];

describe("oncoprintMatrix", () => {
  it("orders genes by how many samples they are altered in (TP53 = 3, most)", () => {
    const m = oncoprintMatrix(events);
    expect(m.genes[0]).toBe("TP53"); // altered in S1, S2, S3
    expect(m.alteredCount("TP53")).toBe(3);
    expect(m.alteredCount("KRAS")).toBe(1);
    expect(m.alteredCount("EGFR")).toBe(1);
  });

  it("collects every alteration in one cell (TP53 × S1 has both)", () => {
    const m = oncoprintMatrix(events);
    expect(m.cell("TP53", "S1").sort()).toEqual(["Amplification", "Missense"]);
    expect(m.cell("KRAS", "S1")).toEqual(["Amplification"]);
    expect(m.cell("EGFR", "S1")).toEqual([]); // no alteration
  });

  it("lists the distinct alteration types in first-appearance order (the legend key)", () => {
    const m = oncoprintMatrix(events);
    expect(m.alterationTypes).toEqual(["Missense", "Truncating", "Amplification"]);
  });

  it("memo-sorts samples so the most-altered gene's samples lead (the staircase)", () => {
    const m = oncoprintMatrix(events);
    // TP53 (top gene) is altered in S1, S2, S3 → those come before S4 (only EGFR).
    const tp53Samples = m.samples.filter((s) => m.cell("TP53", s).length > 0);
    const idx = (s: string) => m.samples.indexOf(s);
    expect(idx("S4")).toBeGreaterThan(Math.max(...tp53Samples.map(idx))); // S4 sinks to the end
  });

  it("input order is honoured when sorting is turned off", () => {
    const m = oncoprintMatrix(events, { geneSort: "input", sampleSort: "input" });
    expect(m.genes).toEqual(["TP53", "KRAS", "EGFR"]);
    expect(m.samples).toEqual(["S1", "S2", "S3", "S4"]);
  });

  it("ignores rows with a blank field", () => {
    const m = oncoprintMatrix([
      { sample: "S1", gene: "TP53", alteration: "Missense" },
      { sample: "", gene: "KRAS", alteration: "Amp" },
      { sample: "S2", gene: "", alteration: "Amp" },
    ]);
    expect(m.genes).toEqual(["TP53"]);
    expect(m.samples).toEqual(["S1"]);
  });

  it("handles a big matrix without overflowing (100 genes × 200 samples)", () => {
    const big: AlterationEvent[] = [];
    for (let g = 0; g < 100; g++) for (let s = 0; s < 200; s += 3) big.push({ sample: `S${s}`, gene: `G${g}`, alteration: "Missense" });
    const m = oncoprintMatrix(big);
    expect(m.genes.length).toBe(100);
    // the memo sort must still produce a total order (no NaN comparisons collapsing it)
    expect(new Set(m.samples).size).toBe(m.samples.length);
  });
});
