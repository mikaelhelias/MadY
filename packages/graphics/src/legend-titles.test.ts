// The correlation key's heading ("Correlation" by default) and the number-at-risk table's ("Number at risk")
// are the plot's own settings, like every other legend heading.
import { describe, expect, it } from "vitest";
import type { DataTable, Plot } from "@mady/core";
import { buildPlotScene } from "./buildScene";

const corrTable: DataTable = {
  id: "cm", kind: "multivariable", name: "M",
  columns: [{ id: "a", name: "A" }, { id: "b", name: "B" }, { id: "c", name: "C" }, { id: "d", name: "D" }],
  rows: Array.from({ length: 8 }, (_, i) => ({ id: `r${i}`, cells: { a: i, b: i * 2 + 1, c: 9 - i, d: (i % 3) + 1 } })),
};
const corr = (cfg?: NonNullable<Plot["corrmatrix"]>) =>
  buildPlotScene(corrTable, { id: "p", name: "P", source: "cm", status: "ok", styleOverrides: {}, kind: "corrmatrix", ...(cfg ? { corrmatrix: cfg } : {}) }, { width: 900, height: 420 }).corrmatrix!.scaleLegend!;

describe("correlation key heading", () => {
  it("is 'Correlation' until the plot sets its own", () => {
    expect(corr().title).toBe("Correlation");
    expect(corr({ legendTitle: "Pearson r" }).title).toBe("Pearson r");
  });
  it("switching the heading off keeps the rows; a blank title brings the default words back", () => {
    expect(corr({ legendTitle: "  " }).title).toBe("Correlation");
    const k = corr({ legendTitle: "Pearson r", legendShowTitle: false });
    expect(k.title).toBe("");
    expect(k.items.length).toBeGreaterThan(0);
  });
});

const survTable: DataTable = {
  id: "t", kind: "survival", name: "KM",
  columns: [{ id: "time", name: "Time", role: "x" }, { id: "ev", name: "Event", role: "y" }, { id: "g", name: "Group" }],
  rows: Array.from({ length: 24 }, (_, i) => ({ id: `r${i}`, cells: { time: 2 + i * 1.5, ev: i % 3 === 0 ? 0 : 1, g: i % 2 ? "A" : "B" } })),
};
const surv = (extra: Partial<Plot> = {}) =>
  buildPlotScene(survTable, {
    id: "p", name: "P", source: "t", status: "ok", styleOverrides: {}, kind: "survival",
    survivalAtRisk: { times: [0, 10, 20, 30], rows: [{ label: "A", atRisk: [12, 8, 4, 1] }, { label: "B", atRisk: [12, 9, 5, 2] }] },
    ...extra,
  }, { width: 700, height: 460 }).atRisk!;

describe("number-at-risk heading", () => {
  it("is 'Number at risk' until the plot sets its own", () => {
    expect(surv().title).toBe("Number at risk");
    expect(surv({ survivalAtRiskTitle: "Patients at risk" }).title).toBe("Patients at risk");
  });
  it("switching the heading off keeps the rows; a blank title brings the default words back", () => {
    expect(surv({ survivalAtRiskTitle: "  " }).title).toBe("Number at risk");
    const t = surv({ survivalAtRiskTitle: "Patients at risk", survivalShowAtRiskTitle: false });
    expect(t.title).toBe("");
    expect(t.rows.length).toBe(2);
  });
});
