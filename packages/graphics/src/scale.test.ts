import { describe, expect, it } from "vitest";
import { buildScale, makeTickLabel } from "./scale.js";

/** Major (labelled) tick values + labels, dropping minors. */
const majors = (ticks: { value: number; label: string; minor: boolean }[]) =>
  ticks.filter((t) => !t.minor);

describe("buildScale — log bases (log10 / log2 / ln)", () => {
  it("log2 places major ticks at powers of 2 with plain-number labels", () => {
    const s = buildScale("log2", [1, 8], [0, 100]);
    expect(s.domain).toEqual([1, 8]);
    expect(majors(s.ticks).map((t) => t.value)).toEqual([1, 2, 4, 8]);
    expect(majors(s.ticks).map((t) => t.label)).toEqual(["1", "2", "4", "8"]);
    // monotonic pixel positions (1 at left, 8 at right)
    expect(s.scale(1)).toBeCloseTo(0, 6);
    expect(s.scale(8)).toBeCloseTo(100, 6);
    expect(s.scale(2)).toBeLessThan(s.scale(4));
  });

  it("log2 snaps a non-power range out to whole powers (auto)", () => {
    const s = buildScale("log2", [3, 30], [0, 100]); // → [2, 32]
    expect(s.domain).toEqual([2, 32]);
    expect(majors(s.ticks).map((t) => t.value)).toEqual([2, 4, 8, 16, 32]);
  });

  it("ln labels powers of e (e⁰→1, e¹, e²) by default", () => {
    const s = buildScale("ln", [1, Math.E * Math.E], [0, 100]);
    const m = majors(s.ticks);
    expect(m.map((t) => t.label)).toEqual(["1", "e¹", "e²"]);
    expect(m.map((t) => t.value)).toEqual([1, Math.E, Math.E * Math.E].map((v) => v));
  });

  it("log10 keeps decade majors + 2–9 minors", () => {
    const s = buildScale("log10", [1, 100], [0, 100]);
    expect(majors(s.ticks).map((t) => t.label)).toEqual(["1", "10", "100"]);
    expect(s.ticks.some((t) => t.minor)).toBe(true); // sub-decade minors present
  });
});

describe("buildScale — number formats", () => {
  it("scientific renders mantissa×10ⁿ with Unicode superscripts", () => {
    const s = buildScale("linear", [0, 3000], [0, 100], 4, true, { format: "scientific" });
    const lbls = majors(s.ticks).map((t) => t.label);
    expect(lbls).toContain("0");
    expect(lbls).toContain("1×10³");
    expect(lbls.some((l) => /×10/.test(l))).toBe(true);
  });

  it("power10 on a log10 axis shows 10ⁿ exponent labels", () => {
    const s = buildScale("log10", [1, 1000], [0, 100], 6, false, { format: "power10" });
    expect(majors(s.ticks).map((t) => t.label)).toEqual(["1", "10¹", "10²", "10³"]);
  });

  it("decimal honours a fixed decimal count", () => {
    const s = buildScale("linear", [0, 1], [0, 100], 5, true, { format: "decimal", decimals: 2 });
    expect(majors(s.ticks).every((t) => /^\d+\.\d{2}$/.test(t.label) || t.label === "0.00")).toBe(true);
  });

  it("prefix/suffix wrap every label", () => {
    const s = buildScale("linear", [0, 100], [0, 100], 5, true, { prefix: "$", suffix: "%" });
    expect(majors(s.ticks).every((t) => t.label.startsWith("$") && t.label.endsWith("%"))).toBe(true);
  });

  it("percent format multiplies by 100 and appends % (0.25 → 25%)", () => {
    const s = buildScale("linear", [0, 1], [0, 100], 5, true, { format: "percent" });
    const labels = majors(s.ticks).map((t) => t.label);
    expect(labels).toContain("0%");
    expect(labels).toContain("40%"); // 0.4 → 40%
    expect(labels).toContain("100%");
    // decimals apply to the ×100 value.
    const d = buildScale("linear", [0, 0.1], [0, 100], 5, true, { format: "percent", decimals: 1 });
    expect(majors(d.ticks).some((t) => /^\d+\.\d%$/.test(t.label))).toBe(true);
  });

  it("enotation writes mantissa E exponent (1500 → 1.5E3, 0.002 → 2E-3)", () => {
    expect(makeTickLabel(1500, "linear", { format: "enotation" })).toBe("1.5E3");
    expect(makeTickLabel(0.002, "linear", { format: "enotation" })).toBe("2E-3");
    expect(makeTickLabel(-1500, "linear", { format: "enotation" })).toBe("-1.5E3");
    expect(makeTickLabel(0, "linear", { format: "enotation" })).toBe("0");
    expect(makeTickLabel(1000, "linear", { format: "enotation", decimals: 1 })).toBe("1.0E3");
    expect(makeTickLabel(1500, "linear", { format: "enotation", decimalSep: "comma" })).toBe("1,5E3");
    const s = buildScale("linear", [0, 3000], [0, 100], 4, true, { format: "enotation" });
    expect(majors(s.ticks).map((t) => t.label)).toContain("1E3");
  });

  it("antilog writes the plain value on a log axis, never an exponent", () => {
    const s = buildScale("log10", [0.001, 1000], [0, 100], 6, false, { format: "antilog" });
    expect(majors(s.ticks).map((t) => t.label)).toEqual(["0.001", "0.01", "0.1", "1", "10", "100", "1000"]);
    // Where plain Decimal falls back to JS exponent text, Antilog still writes the digits.
    expect(makeTickLabel(1e-7, "log10", { format: "decimal" })).toBe("1e-7");
    expect(makeTickLabel(1e-7, "log10", { format: "antilog" })).toBe("0.0000001");
    expect(makeTickLabel(1e6, "log10", { format: "antilog", thousands: "comma" })).toBe("1,000,000");
    // ln axis: e¹ as a plain number, rounded by the Decimals box.
    const ln = buildScale("ln", [1, Math.E * Math.E], [0, 100], 6, false, { format: "antilog", decimals: 2 });
    expect(majors(ln.ticks).map((t) => t.label)).toEqual(["1.00", "2.72", "7.39"]);
  });

  it("si shortens with k / M / G / T (1500 → 1.5k, 2e6 → 2M)", () => {
    expect(makeTickLabel(1500, "linear", { format: "si" })).toBe("1.5k");
    expect(makeTickLabel(2e6, "linear", { format: "si" })).toBe("2M");
    expect(makeTickLabel(3e9, "linear", { format: "si" })).toBe("3G");
    expect(makeTickLabel(4e12, "linear", { format: "si" })).toBe("4T");
    expect(makeTickLabel(-2500, "linear", { format: "si" })).toBe("-2.5k");
    expect(makeTickLabel(999, "linear", { format: "si" })).toBe("999");
    expect(makeTickLabel(0.5, "linear", { format: "si" })).toBe("0.5");
    expect(makeTickLabel(1000, "linear", { format: "si", decimals: 1 })).toBe("1.0k");
    const s = buildScale("linear", [0, 4000], [0, 100], 5, true, { format: "si" });
    const labels = majors(s.ticks).map((t) => t.label);
    expect(labels).toContain("0");
    expect(labels).toContain("1k");
    expect(labels).toContain("4k");
  });
});

describe("makeTickLabel — thousands / decimal separators", () => {
  it("groups the integer part with a comma every three digits", () => {
    expect(makeTickLabel(1234567, "linear", { thousands: "comma" })).toBe("1,234,567");
    expect(makeTickLabel(1000, "linear", { thousands: "comma" })).toBe("1,000");
    expect(makeTickLabel(999, "linear", { thousands: "comma" })).toBe("999"); // < 4 digits: no grouping
  });

  it("supports period / space / apostrophe grouping characters", () => {
    expect(makeTickLabel(1000000, "linear", { thousands: "period" })).toBe("1.000.000");
    expect(makeTickLabel(1000000, "linear", { thousands: "space" })).toBe("1 000 000"); // plain space
    expect(makeTickLabel(1000000, "linear", { thousands: "apostrophe" })).toBe("1’000’000");
  });

  it("swaps the decimal mark to a comma and keeps the fraction", () => {
    expect(makeTickLabel(3.14, "linear", { format: "decimal", decimalSep: "comma" })).toBe("3,14");
    expect(makeTickLabel(0.5, "linear", { format: "decimal", decimalSep: "comma" })).toBe("0,5");
  });

  it("European style: period grouping + comma decimal (1234.5 → 1.234,5)", () => {
    expect(
      makeTickLabel(1234.5, "linear", { format: "decimal", thousands: "period", decimalSep: "comma" }),
    ).toBe("1.234,5");
  });

  it("groups negative numbers, keeping the sign outside the grouping", () => {
    expect(makeTickLabel(-1234, "linear", { thousands: "comma" })).toBe("-1,234");
  });

  it("applies grouping before the percent sign (12.34 → 1,234%)", () => {
    expect(makeTickLabel(12.34, "linear", { format: "percent", thousands: "comma" })).toBe("1,234%");
  });

  it("swaps only the decimal in a scientific mantissa, leaving the superscript exponent", () => {
    expect(makeTickLabel(1500, "linear", { format: "scientific", decimalSep: "comma" })).toBe("1,5×10³");
  });

  it("prefix/suffix still wrap the grouped body", () => {
    expect(makeTickLabel(1000, "linear", { thousands: "comma", prefix: "$" })).toBe("$1,000");
  });

  it("is a strict no-op under the defaults (none / point) — labels stay byte-identical", () => {
    expect(makeTickLabel(1234.5, "linear", { format: "decimal" })).toBe("1234.5");
    expect(makeTickLabel(1234567, "linear", {})).toBe("1234567");
    expect(makeTickLabel(1234567, "linear", { thousands: "none", decimalSep: "point" })).toBe("1234567");
  });

  it("flows through buildScale into the built tick labels", () => {
    const s = buildScale("linear", [0, 4000], [0, 100], 5, true, { format: "decimal", thousands: "comma" });
    const labels = majors(s.ticks).map((t) => t.label);
    expect(labels).toContain("1,000");
    expect(labels).toContain("4,000");
  });

  it("formats date / elapsed columns from their numeric storage (ISO date · h:mm:ss)", () => {
    // date: days since epoch → YYYY-MM-DD (0 = 1970-01-01, 1 = 1970-01-02).
    expect(makeTickLabel(0, "linear", { columnType: "date" })).toBe("1970-01-01");
    expect(makeTickLabel(1, "linear", { columnType: "date" })).toBe("1970-01-02");
    // elapsed: seconds → h:mm:ss.
    expect(makeTickLabel(3665, "linear", { columnType: "elapsed" })).toBe("1:01:05");
    expect(makeTickLabel(0, "linear", { columnType: "elapsed" })).toBe("0:00:00");
    // columnType wins over a numeric NumberFormat.
    expect(makeTickLabel(1, "linear", { columnType: "date", thousands: "comma", format: "scientific" })).toBe("1970-01-02");
  });

  it("date labels flow through buildScale onto every tick", () => {
    const s = buildScale("linear", [0, 30], [0, 100], 4, true, { columnType: "date" });
    const labels = majors(s.ticks).map((t) => t.label);
    expect(labels.length).toBeGreaterThan(0);
    expect(labels.every((l) => /^\d{4}-\d{2}-\d{2}$/.test(l))).toBe(true); // all ISO dates, no raw numbers
  });
});

describe("buildScale — manual tick spacing", () => {
  it("a manual major interval places ticks every `majorStep`", () => {
    const s = buildScale("linear", [0, 100], [0, 100], 6, true, undefined, { majorStep: 25 });
    const m = s.ticks.filter((t) => !t.minor).map((t) => t.value);
    expect(m).toEqual([0, 25, 50, 75, 100]);
  });

  it("minorCount inserts evenly-spaced minor ticks between majors", () => {
    const s = buildScale("linear", [0, 10], [0, 100], 6, true, undefined, { majorStep: 10, minorCount: 1 });
    // majors 0,10 with one minor at the midpoint 5
    expect(s.ticks.filter((t) => t.minor).map((t) => t.value)).toEqual([5]);
  });

  it("ignores an absurd interval (too many ticks) and falls back to auto", () => {
    const s = buildScale("linear", [0, 1e9], [0, 100], 6, true, undefined, { majorStep: 1 });
    expect(s.ticks.filter((t) => !t.minor).length).toBeLessThan(50);
  });
});

describe("buildScale — axis breaks (cuts)", () => {
  it("compresses a broken range and drops ticks inside it, exposing break marks", () => {
    // domain 0..100, break out 40..60; ticks at 40,50,60 fall inside → dropped (40/60 are edges, kept-out)
    const s = buildScale("linear", [0, 100], [0, 200], 6, true, undefined, { breaks: [{ from: 40, to: 60 }] });
    const vals = s.ticks.filter((t) => !t.minor).map((t) => t.value);
    expect(vals).not.toContain(50); // 50 is strictly inside the cut
    expect(s.breakMarks && s.breakMarks.length).toBe(1);
    // a value just below the cut maps left of a value just above it, with a gap between
    const below = s.scale(39.9);
    const above = s.scale(60.1);
    expect(above).toBeGreaterThan(below);
    // the compressed gap saves pixels: 0→100 with a cut packs the visible data into < full width near the cut
    expect(s.scale(100)).toBeCloseTo(200, 0);
    expect(s.scale(0)).toBeCloseTo(0, 0);
  });

  it("no breaks → identical to a plain linear scale (no breakMarks)", () => {
    const s = buildScale("linear", [0, 100], [0, 200], 6, true);
    expect(s.breakMarks).toBeUndefined();
    expect(s.scale(50)).toBeCloseTo(100, 0);
  });

  it("exposes the visible data segments between cuts (raw units) so callers don't re-derive them", () => {
    const s = buildScale("linear", [0, 100], [0, 200], 6, true, undefined, { breaks: [{ from: 40, to: 60 }] });
    expect(s.segments).toEqual([{ from: 0, to: 40 }, { from: 60, to: 100 }]);
    // no breaks → no segments (a single full-domain segment is implied)
    expect(buildScale("linear", [0, 100], [0, 200], 6, true).segments).toBeUndefined();
  });

  it("segments come back in raw data units on a log axis (inverted from decade space)", () => {
    const s = buildScale("log10", [1, 10000], [0, 300], 6, true, undefined, { breaks: [{ from: 100, to: 1000 }] });
    expect(s.segments).toHaveLength(2);
    expect(s.segments![0]!.from).toBeCloseTo(1, 6);
    expect(s.segments![0]!.to).toBeCloseTo(100, 6);
    expect(s.segments![1]!.from).toBeCloseTo(1000, 6);
    expect(s.segments![1]!.to).toBeCloseTo(10000, 6);
  });

  it("breaks work on log axes — compress a decade band + expose a mark", () => {
    // log10 over 1..10000; cut out 100..1000 (one decade). Ticks inside the cut drop;
    // the gap is taken in decade space so 1..10000 still spans the full range.
    const s = buildScale("log10", [1, 10000], [0, 300], 6, true, undefined, { breaks: [{ from: 100, to: 1000 }] });
    const vals = s.ticks.filter((t) => !t.minor).map((t) => t.value);
    expect(vals).not.toContain(316); // nothing strictly inside the cut
    expect(vals.some((v) => v >= 100 && v <= 1000 && v !== 100 && v !== 1000)).toBe(false);
    expect(s.breakMarks && s.breakMarks.length).toBe(1);
    expect(s.scale(1)).toBeCloseTo(0, 0);
    expect(s.scale(10000)).toBeCloseTo(300, 0);
    // a value just below the cut maps left of one just above (monotone through the gap)
    expect(s.scale(1100)).toBeGreaterThan(s.scale(90));
  });

  it("ignores non-positive break edges on a log axis (no crash, no mark)", () => {
    const s = buildScale("log10", [1, 1000], [0, 100], 6, true, undefined, { breaks: [{ from: -5, to: 0 }] });
    expect(s.breakMarks).toBeUndefined();
  });
});
