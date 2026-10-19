/**
 * An empty volcano says why. A table of gene names, fold changes and p-values has the names in the first column, which is
 * the X column: a volcano places each point by a number there (the fold change), so nothing can be placed. A bare
 * "No finite data points to plot." would be true and no help, so the message names what a volcano needs and what the
 * first column holds. The same cause on another XY chart is named too.
 */
import { describe, expect, it } from "vitest";
import type { DataTable, Plot } from "@mady/core";
import { buildPlotScene } from "./buildScene";

const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ fc: Math.round((i - n / 2) * 30) / 100, p: Math.round((i % 7 + 1) * 40) / 100 + 0.3, gene: `GENE${i + 1}` }));
const make = (order: ("gene" | "fc" | "p")[], kind = "volcano", extra: Partial<Plot> = {}) => {
  const names = { gene: "Gene", fc: "log2 fold change", p: "-log10 p" };
  const table = {
    id: "t", kind: "xy", name: "t",
    columns: order.map((k) => ({ id: k, name: names[k] })),
    rows: rows(30).map((r, i) => ({ id: `r${i}`, cells: Object.fromEntries(order.map((k) => [k, r[k]])) })),
  } as unknown as DataTable;
  return buildPlotScene(table, { id: "p", name: "p", source: "t", status: "ok", styleOverrides: {}, kind, ...extra } as unknown as Plot, { width: 600, height: 420 });
};
const said = (s: ReturnType<typeof make>) => s.warnings.join(" | ");

describe("an empty volcano", () => {
  it("names the first column and what a volcano needs when that column holds names", () => {
    const s = make(["gene", "fc", "p"]);
    expect(s.series.flatMap((x) => x.marks).length, "the fixture draws points — it proves nothing").toBe(0);
    expect(said(s)).toMatch(/volcano/i);
    expect(said(s)).toMatch(/first column/i);
    expect(said(s)).toMatch(/"Gene"/);
    expect(said(s)).toMatch(/fold change/i);
    expect(said(s), "the bare message is all there is").not.toMatch(/^No finite data points to plot\.$/);
  });

  it("the same data with the names last draws, and says nothing", () => {
    const s = make(["fc", "p", "gene"]);
    expect(s.series.flatMap((x) => x.marks).length).toBeGreaterThan(0);
    expect(said(s)).not.toMatch(/first column|No finite/i);
  });

  it("one numeric column is not a volcano: the message says it needs a fold change and a -log10 p", () => {
    const s = make(["fc"]);
    expect(said(s)).toMatch(/volcano/i);
    expect(said(s)).toMatch(/two numeric columns|fold change/i);
  });

  it("a blank first column is not names: the message does not say it holds names", () => {
    const table = {
      id: "t", kind: "xy", name: "t",
      columns: [{ id: "x", name: "FC" }, { id: "y", name: "P" }],
      rows: Array.from({ length: 5 }, (_, i) => ({ id: `r${i}`, cells: { x: null, y: null } })),
    } as unknown as DataTable;
    const s = buildPlotScene(table, { id: "p", name: "p", source: "t", status: "ok", styleOverrides: {}, kind: "volcano" } as unknown as Plot, { width: 600, height: 420 });
    expect(said(s)).not.toMatch(/holds names/i);
  });
});

describe("the same cause on another XY chart", () => {
  it("a names column in the first place is named, with what to do", () => {
    const s = make(["gene", "fc", "p"], "xy");
    expect(said(s)).toMatch(/"Gene"/);
    expect(said(s)).toMatch(/names/i);
    expect(said(s)).toMatch(/first column/i);
  });

  it("numbers in the first place raise nothing", () => {
    expect(said(make(["fc", "p"], "xy"))).toBe("");
  });
});
