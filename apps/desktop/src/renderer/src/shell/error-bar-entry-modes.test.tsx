// @vitest-environment jsdom
/**
 * Every way a user can enter a spread reaches the Error bars controls.
 *
 * The Error bars section is refused with a message when the chart can draw no interval for a
 * series. That gate is only safe if it is wrong about nothing a real sheet can hold — so
 * this drives the real panel once per entry mode, across the formats that carry each one.
 *
 * Every data type is checked for whether it carries a spread. The gallery cards cover
 * three of these ten shapes. This covers all of them.
 */
import { describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import type { Column, DataTable, Plot, PlotKind } from "@mady/core";
import { Inspector } from "./Inspector";

Element.prototype.scrollIntoView = Element.prototype.scrollIntoView ?? (() => {});

const H = () => ({
  onSelect: vi.fn(),
  onSetAxis: vi.fn(), onSetAxisLength: vi.fn(), onSetAxisTitleFont: vi.fn(),
  onSetSeriesStyle: vi.fn(), onSetSeriesStyleAll: vi.fn(), onSetPointStyle: vi.fn(), onClearPointStyles: vi.fn(),
  onSetGrid: vi.fn(), onSetFrame: vi.fn(), onSetKind: vi.fn(), onSetBarLayout: vi.fn(), onSetBarShape: vi.fn(), onSetBoxWhisker: vi.fn(),
  onSetPlotOptions: vi.fn(), onSetGraphTitle: vi.fn(), onSetPlotFont: vi.fn(), onHomogenizeFont: vi.fn(),
  onSetLegend: vi.fn(), onSetSignificance: vi.fn(), onApplyPreset: vi.fn(),
  onApplyUserPreset: vi.fn(), onSaveUserPreset: vi.fn(), onDeleteUserPreset: vi.fn(), onSetProfileDefault: vi.fn(),
  annotationOps: { add: vi.fn(), update: vi.fn(), remove: vi.fn(), reorder: vi.fn(), align: vi.fn(), group: vi.fn(), ungroup: vi.fn(), setLocked: vi.fn(), addImage: vi.fn(), replaceImage: vi.fn() },
});

/**
 * Build a 3-row sheet whose Y dataset "a" carries the given extra columns.
 *
 * Note: `group: "a"` on every spread column. `tableDatasets` keys a dataset by
 * `col.group ?? col.id`, so an ungrouped SD column becomes its own dataset and the Y it was meant
 * to describe still has no spread — every summary mode would then fail against a fixture that
 * cannot exhibit them.
 */
const sheet = (kind: DataTable["kind"], extra: Column[], cells: Record<string, number>[]): DataTable => ({
  id: "t", kind, name: "T",
  columns: [
    { id: "x", name: "X", role: "x" },
    { id: "a", name: "A", role: "y" },
    ...extra.map((c) => ({ ...c, group: "a" })),
  ],
  rows: cells.map((c, i) => ({ id: `r${i}`, cells: { x: i + 1, a: 10 * (i + 1), ...c } })),
});

/** The Error bars section as a user sees it: the rows on screen, and any refusal. */
function panel(table: DataTable, kind: PlotKind) {
  const plot: Plot = { id: "p", name: "P", source: "t", status: "ok", styleOverrides: {}, kind };
  const { container } = render(
    <Inspector activeSection="graphs" selection={{ kind: "series", columnId: "a", part: "points" }}
      plot={plot} table={table} userPresets={[]} profileDefault={null} {...H()} />,
  );
  const rows: string[] = [];
  for (const el of container.querySelectorAll<HTMLElement>("label.frow, div.frow")) {
    const label = (el.querySelector(":scope > span")?.textContent ?? "").trim();
    if (!label) continue;
    let shown = true;
    for (let n: HTMLElement | null = el; n; n = n.parentElement) if (n.hidden) shown = false;
    if (!shown) continue;
    let group = "";
    for (let n: Element | null = el.previousElementSibling; n; n = n.previousElementSibling) {
      if (n.classList.contains("inspsub")) { group = (n.textContent ?? "").trim().replace(/^[^\p{L}]+/u, ""); break; }
    }
    if (group === "Error bars") rows.push(label);
  }
  const refused = !!container.querySelector('[data-refusal="Error bars"]');
  const types = [...(container.querySelectorAll<HTMLSelectElement>("select"))]
    .map((s) => [...s.options].map((o) => o.value))
    .find((o) => o.includes("sd") || o.includes("iqr") || o.includes("range")) ?? [];
  return { rows, refused, types };
}

/** Every shape `drawableErrorTypes` recognises, as a real sheet. */
const WITH_SPREAD: [string, DataTable][] = [
  ["raw replicates (subcolumns)", {
    id: "t", kind: "xy", name: "T",
    columns: [{ id: "x", name: "X", role: "x" }, { id: "a", name: "A", role: "y" }, { id: "a2", name: "A", role: "y", group: "a" }],
    rows: [0, 1, 2].map((i) => ({ id: `r${i}`, cells: { x: i + 1, a: 10 * (i + 1), a2: 11 * (i + 1) } })),
  }],
  ["Mean + SD", sheet("xy", [{ id: "s", name: "SD", role: "sd" }], [{ s: 2 }, { s: 3 }, { s: 4 }])],
  ["Mean + SD + N", sheet("xy", [{ id: "s", name: "SD", role: "sd" }, { id: "nn", name: "N", role: "n" }], [{ s: 2, nn: 5 }, { s: 3, nn: 5 }, { s: 4, nn: 5 }])],
  ["Mean + SEM + N", sheet("xy", [{ id: "e", name: "SEM", role: "sem" }, { id: "nn", name: "N", role: "n" }], [{ e: 1, nn: 6 }, { e: 2, nn: 6 }, { e: 3, nn: 6 }])],
  ["Mean + %CV", sheet("xy", [{ id: "c", name: "CV", role: "cv" }], [{ c: 12 }, { c: 9 }, { c: 15 }])],
  ["Mean + 95% CI half-width", sheet("xy", [{ id: "ci", name: "CI", role: "ci" }], [{ ci: 3 }, { ci: 4 }, { ci: 5 }])],
  ["asymmetric ± (errLow / errHigh)", sheet("xy", [{ id: "lo", name: "-", role: "errlow" }, { id: "hi", name: "+", role: "errhigh" }], [{ lo: 1, hi: 2 }, { lo: 2, hi: 3 }, { lo: 1, hi: 4 }])],
  ["min / max (range)", sheet("xy", [{ id: "mn", name: "Min", role: "min" }, { id: "mx", name: "Max", role: "max" }], [{ mn: 5, mx: 15 }, { mn: 15, mx: 25 }, { mn: 25, mx: 35 }])],
  ["median + Q1 / Q3 (IQR)", sheet("xy", [{ id: "q1", name: "Q1", role: "q1" }, { id: "q3", name: "Q3", role: "q3" }], [{ q1: 8, q3: 12 }, { q1: 18, q3: 22 }, { q1: 28, q3: 32 }])],
  ["geometric mean + geometric SD", sheet("xy", [{ id: "g", name: "GSD", role: "geosd" }], [{ g: 1.5 }, { g: 1.6 }, { g: 1.4 }])],
];

/** Values pooled down the rows — no per-row spread columns at all, and still an error bar. */
const POOLED: DataTable = {
  id: "t", kind: "column", name: "T",
  columns: [{ id: "a", name: "A", role: "y" }, { id: "b", name: "B", role: "y" }],
  rows: [1, 2, 3, 5].map((v, i) => ({ id: `r${i}`, cells: { a: v, b: v + 4 } })),
};

describe("every entry mode that carries a spread keeps its Error bars controls", () => {
  for (const [name, table] of WITH_SPREAD) {
    it(`${name} — offered, not refused`, () => {
      const p = panel(table, "xy");
      expect(p.refused, `${name}: the section was refused on data that HAS a spread`).toBe(false);
      expect(p.rows, `${name}: no Type row`).toContain("Type");
      cleanup();
    });
  }

  it("values pooled down the rows (a column bar) — offered, not refused", () => {
    const p = panel(POOLED, "bar");
    expect(p.refused, "a column bar pools its rows; its mean ± SD is drawable").toBe(false);
    expect(p.rows).toContain("Type");
    cleanup();
  });

  /** The negative control: the one shape that really carries nothing. */
  it("one plain value per row and nothing else — refused, and it says why", () => {
    const p = panel(sheet("xy", [], [{}, {}, {}]), "xy");
    expect(p.refused, "a single value per row has no spread of any kind").toBe(true);
    expect(p.rows, "refused, so no rows at all").toEqual([]);
    cleanup();
  });
});
