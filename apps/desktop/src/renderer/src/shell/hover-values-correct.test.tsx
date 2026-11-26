// @vitest-environment jsdom
/**
 * The hover values are the data. `hover-values.test.tsx` proves every chart type carries a
 * value; this proves the values are correct, against the table cells themselves — never against
 * the scene the renderer read (an oracle sharing that code would agree with any mistake).
 * Radar and parallel coordinates read their values back off the pixels, which is exactly where a
 * wrong direction or a wrong scale would hide.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import type { DataTable, Plot } from "@mady/core";
import { buildPlotScene } from "@mady/graphics";
import { PlotFigure } from "./PlotFigure";
import { galleryItems } from "./gallery";

afterEach(cleanup);

const card = (kind: string) => galleryItems().find((g) => g.plot.kind === kind)!;
const tipsOf = (table: DataTable, plot: Plot): string[] => {
  const { container } = render(<PlotFigure scene={buildPlotScene(table, plot, { width: 580, height: 380 })} onSelect={() => {}} />);
  return [...container.querySelectorAll("[data-mady-tip]")].map((e) => e.getAttribute("data-mady-tip") ?? "");
};
const reps0 = (t: DataTable): boolean => t.columns.some((c) => !!c.group);
const num = (v: unknown): number => (typeof v === "number" ? v : Number(v));
const close = (a: number, b: number): boolean => Math.abs(a - b) <= Math.max(1e-6, Math.abs(b) * 1e-3);
/** The number after "<name>: " on some line of a tip. */
const valueAfter = (tip: string, name: string): number | undefined => {
  const line = tip.split("\n").find((l) => l.startsWith(`${name}: `));
  return line === undefined ? undefined : Number(line.slice(name.length + 2));
};

describe("hover values match the table", () => {
  it("radar: every spoke of every series reads the table cell", () => {
    const g = card("radar");
    const lead = g.table.columns[0]!;
    const tips = tipsOf(g.table, g.plot);
    // A series is a column plus its replicate columns (`group` names the first), drawn at their
    // mean — reading only the first replicate would wrongly report the value as incorrect.
    const heads = g.table.columns.slice(1).filter((c) => !c.group);
    let checked = 0;
    for (const head of heads) {
      const reps = g.table.columns.filter((c) => c.id === head.id || c.group === head.id);
      const tip = tips.find((t) => t.split("\n")[0] === head.name);
      expect(tip, `no hover text for series ${head.name}`).toBeTruthy();
      for (const row of g.table.rows) {
        const v = valueAfter(tip!, String(row.cells[lead.id]));
        if (v === undefined) continue;
        const mean = reps.reduce((a, c) => a + num(row.cells[c.id]), 0) / reps.length;
        expect(close(v, mean), `${head.name} · ${row.cells[lead.id]}: hover ${v}, table mean ${mean}`).toBe(true);
        checked++;
      }
    }
    expect(reps0(g.table), "the fixture has no replicates — it cannot show the mean").toBe(true);
    expect(checked, "no spoke value was compared").toBeGreaterThan(4);
  });

  it("parallel coordinates: every line reads its row on every axis", () => {
    const g = card("parallel");
    const tips = tipsOf(g.table, g.plot);
    const numeric = g.table.columns.filter((c) => g.table.rows.every((r) => Number.isFinite(num(r.cells[c.id]))));
    let checked = 0;
    for (const row of g.table.rows) {
      const want = numeric.map((c) => `${c.name}: ${num(row.cells[c.id])}`);
      const tip = tips.find((t) => numeric.every((c) => { const v = valueAfter(t, c.name); return v !== undefined && close(v, num(row.cells[c.id])); }));
      expect(tip, `no line reads row ${want.join(", ")}`).toBeTruthy();
      checked++;
    }
    expect(checked).toBe(g.table.rows.length);
  });

  it("heatmap: a cell names its row and column and reads that cell", () => {
    const t: DataTable = {
      id: "hm", kind: "xy", name: "H",
      columns: [{ id: "g", name: "Gene" }, { id: "a", name: "S1" }, { id: "b", name: "S2" }],
      rows: [{ id: "r1", cells: { g: "G1", a: 1, b: 7 } }, { id: "r2", cells: { g: "G2", a: 3, b: 5 } }],
    };
    const plot: Plot = { id: "p", name: "P", source: "hm", status: "ok", styleOverrides: {}, kind: "heatmap" };
    const tips = tipsOf(t, plot);
    expect(tips).toEqual(expect.arrayContaining(["G1 · S2\n7", "G2 · S1\n3", "G1 · S1\n1", "G2 · S2\n5"]));
  });

  it("pie: a slice reads its value and its share", () => {
    const g = card("pie");
    const valCol = g.table.columns.find((c) => g.table.rows.every((r) => Number.isFinite(num(r.cells[c.id]))))!;
    const total = g.table.rows.reduce((a, r) => a + num(r.cells[valCol.id]), 0);
    const tips = tipsOf(g.table, g.plot);
    for (const row of g.table.rows) {
      const v = num(row.cells[valCol.id]);
      const pct = Math.round((v / total) * 1000) / 10;
      expect(tips.some((t) => t.split("\n")[1] === `${v} (${pct}%)`), `no slice reads ${v} (${pct}%)`).toBe(true);
    }
  });

  it("XY and bar: a point or bar reads its own row's X and Y", () => {
    const t: DataTable = {
      id: "xyt", kind: "xy", name: "T",
      columns: [{ id: "x", name: "Dose", role: "x" }, { id: "y", name: "Response", role: "y" }],
      rows: [{ id: "r1", cells: { x: 2, y: 5 } }, { id: "r2", cells: { x: 4, y: 9.5 } }],
    };
    const xy = tipsOf(t, { id: "p", name: "P", source: "xyt", status: "ok", styleOverrides: {}, kind: "xy" });
    expect(xy.some((s) => s.includes("Dose: 2") && s.includes("Response: 5") && s.includes("row 1"))).toBe(true);
    expect(xy.some((s) => s.includes("Dose: 4") && s.includes("Response: 9.5") && s.includes("row 2"))).toBe(true);
    cleanup();
    const c: DataTable = {
      id: "ct", kind: "column", name: "C",
      columns: [{ id: "a", name: "Control", role: "y" }, { id: "b", name: "Treated", role: "y" }],
      rows: [{ id: "r1", cells: { a: 2, b: 6 } }, { id: "r2", cells: { a: 4, b: 8 } }],
    };
    const bar = tipsOf(c, { id: "p", name: "P", source: "ct", status: "ok", styleOverrides: {}, kind: "bar" });
    // A column-format bar is the group's mean, with its n.
    expect(bar.some((s) => s.startsWith("Control") && s.includes("mean: 3") && s.includes("n = 2"))).toBe(true);
    expect(bar.some((s) => s.startsWith("Treated") && s.includes("mean: 7") && s.includes("n = 2"))).toBe(true);
  });
});

describe("hover values match the table — 3-D scatter", () => {
  it("every point names each axis with its own row's value", () => {
    const g = card("scatter3d");
    const [cx, cy, cz] = g.table.columns;
    const tips = tipsOf(g.table, g.plot);
    expect(g.table.rows.length).toBeGreaterThan(3);
    for (const row of g.table.rows) {
      const want = [`${cx!.name}: ${num(row.cells[cx!.id])}`, `${cy!.name}: ${num(row.cells[cy!.id])}`, `${cz!.name}: ${num(row.cells[cz!.id])}`].join("\n");
      expect(tips, `no point reads ${want.replace(/\n/g, ", ")}`).toContain(want);
    }
  });
});
